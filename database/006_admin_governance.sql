-- FIAA Evolution administration, publication governance and audit history.
-- Apply after 005_notification_outbox.sql.

begin;

create or replace function session_staff()
returns staff_profiles
language plpgsql stable security definer
set search_path = public, pg_temp as $$
declare
  staff staff_profiles;
  subject text := nullif(current_setting('app.auth_subject', true), '');
begin
  if subject is null then
    raise exception 'Authenticated staff context is required' using errcode = '42501';
  end if;
  select * into staff from staff_profiles where auth_subject = subject and is_active = true;
  if not found then
    raise exception 'Active staff profile was not found' using errcode = '42501';
  end if;
  return staff;
end;
$$;

create or replace function require_staff_role(allowed_roles text[])
returns staff_profiles
language plpgsql stable security definer
set search_path = public, pg_temp as $$
declare
  staff staff_profiles := session_staff();
begin
  if not (staff.role = any(allowed_roles)) then
    raise exception 'Staff role % is not authorized for this action', staff.role using errcode = '42501';
  end if;
  return staff;
end;
$$;

create or replace function product_publication_problems(requested_product_id uuid)
returns jsonb
language sql stable
set search_path = public, pg_temp as $$
  with product_record as (
    select * from products where id = requested_product_id
  ), checks as (
    select problem from product_record p
    cross join lateral (
      values
        (case when nullif(trim(p.sku), '') is null then 'Missing SKU' end),
        (case when nullif(trim(p.name), '') is null then 'Missing product name' end),
        (case when nullif(trim(p.short_description), '') is null then 'Missing short description' end),
        (case when nullif(trim(p.description), '') is null then 'Missing full description' end),
        (case when p.owner_verified_at is null or p.owner_verified_by is null then 'Missing owner verification' end),
        (case when not exists (
          select 1 from product_prices pp
          where pp.product_id = p.id and pp.valid_until is null and pp.approved_at is not null and pp.approved_by is not null
        ) then 'Missing approved current price' end),
        (case when not exists (
          select 1 from product_images pi
          where pi.product_id = p.id and pi.image_role = 'primary' and pi.owner_verified_at is not null
        ) then 'Missing owner-verified primary image' end),
        (case when not exists (
          select 1 from inventory i where i.product_id = p.id
        ) then 'Missing inventory record' end),
        (case when p.product_kind in ('brake_pad','brake_shoe','fitting_kit') and p.axle_position is null
          then 'Missing axle position' end),
        (case when p.product_kind in ('brake_pad','brake_shoe') and (p.width_mm is null or p.height_mm is null or p.thickness_mm is null)
          then 'Missing brake dimensions' end),
        (case when p.product_kind in ('brake_pad','brake_shoe','fitting_kit') and not exists (
          select 1 from product_oem_references por where por.product_id = p.id
        ) then 'Missing OEM reference' end),
        (case when p.product_kind in ('brake_pad','brake_shoe','fitting_kit') and not exists (
          select 1 from product_fitments pf where pf.product_id = p.id and pf.owner_verified_at is not null
        ) then 'Missing owner-verified vehicle fitment' end)
    ) as required(problem)
    where problem is not null
  )
  select coalesce(jsonb_agg(problem order by problem), '[]'::jsonb) from checks;
$$;

create or replace function enforce_product_publication()
returns trigger
language plpgsql
set search_path = public, pg_temp as $$
declare
  problems jsonb;
begin
  if new.publication_status = 'published' then
    problems := product_publication_problems(new.id);
    if jsonb_array_length(problems) > 0 then
      raise exception 'Product cannot be published: %', problems using errcode = '23514';
    end if;
    if new.published_at is null then
      update products set published_at = now() where id = new.id;
    end if;
  end if;
  return null;
end;
$$;

create constraint trigger products_enforce_publication
after insert or update of publication_status on products
deferrable initially immediate
for each row execute function enforce_product_publication();

create or replace function admin_transition_product(
  requested_product_id uuid,
  target_status text,
  change_reason text
)
returns products
language plpgsql security definer
set search_path = public, pg_temp as $$
declare
  staff staff_profiles;
  product_record products;
begin
  if nullif(trim(change_reason), '') is null then
    raise exception 'A reason is required for product status changes' using errcode = '22023';
  end if;
  if target_status not in ('draft','review','approved','published','archived') then
    raise exception 'Unsupported product status' using errcode = '22023';
  end if;

  if target_status in ('approved','published') then
    staff := require_staff_role(array['owner']);
  else
    staff := require_staff_role(array['owner','catalogue_manager']);
  end if;

  select * into product_record from products where id = requested_product_id for update;
  if not found then
    raise exception 'Product not found' using errcode = 'P0001';
  end if;

  if not (
    (product_record.publication_status = 'draft' and target_status in ('review','archived')) or
    (product_record.publication_status = 'review' and target_status in ('draft','approved','archived')) or
    (product_record.publication_status = 'approved' and target_status in ('review','published','archived')) or
    (product_record.publication_status = 'published' and target_status in ('review','archived')) or
    (product_record.publication_status = 'archived' and target_status = 'draft') or
    product_record.publication_status = target_status
  ) then
    raise exception 'Invalid product transition from % to %', product_record.publication_status, target_status using errcode = 'P0001';
  end if;

  update products
  set publication_status = target_status,
      owner_verified_at = case when target_status in ('approved','published') then coalesce(owner_verified_at, now()) else owner_verified_at end,
      owner_verified_by = case when target_status in ('approved','published') then coalesce(owner_verified_by, staff.full_name) else owner_verified_by end,
      published_at = case when target_status = 'published' then coalesce(published_at, now()) else published_at end
  where id = requested_product_id
  returning * into product_record;

  insert into audit_log(staff_id, entity_type, entity_id, action, after_data)
  values (
    staff.id, 'products', product_record.id::text, 'status_transition',
    jsonb_build_object('status', target_status, 'reason', trim(change_reason))
  );
  return product_record;
end;
$$;

create or replace function audit_data_change()
returns trigger
language plpgsql
set search_path = public, pg_temp as $$
declare
  staff_id_value uuid;
  before_value jsonb;
  after_value jsonb;
  entity_value text;
  action_value text;
begin
  select id into staff_id_value
  from staff_profiles
  where auth_subject = nullif(current_setting('app.auth_subject', true), '') and is_active = true;

  before_value := case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) else null end;
  after_value := case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) else null end;
  entity_value := coalesce(
    after_value->>'id', before_value->>'id',
    concat_ws(':', coalesce(after_value->>'product_id', before_value->>'product_id'), coalesce(after_value->>'location_id', before_value->>'location_id'))
  );
  action_value := lower(tg_op);

  insert into audit_log(staff_id, entity_type, entity_id, action, before_data, after_data)
  values (staff_id_value, tg_table_name, entity_value, action_value, before_value, after_value);
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger products_audit after insert or update or delete on products for each row execute function audit_data_change();
create trigger product_prices_audit after insert or update or delete on product_prices for each row execute function audit_data_change();
create trigger product_images_audit after insert or update or delete on product_images for each row execute function audit_data_change();
create trigger product_fitments_audit after insert or update or delete on product_fitments for each row execute function audit_data_change();
create trigger inventory_audit after insert or update or delete on inventory for each row execute function audit_data_change();
create trigger orders_audit after insert or update or delete on orders for each row execute function audit_data_change();

revoke all on function session_staff() from public;
revoke all on function require_staff_role(text[]) from public;
revoke all on function admin_transition_product(uuid,text,text) from public;

comment on function product_publication_problems is
'Returns every missing production requirement. The publication trigger rejects a product until the returned array is empty.';
comment on function admin_transition_product is
'Enforces product workflow transitions and restricts approval/publication to active owners.';

commit;
