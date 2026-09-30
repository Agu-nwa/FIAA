-- FIAA Evolution server-side cart service.
-- Apply after 001_initial_schema.sql and 002_storefront_discovery.sql.

begin;

create or replace function create_anonymous_cart(
  token_hash text,
  lifetime interval default interval '30 days'
)
returns carts
language plpgsql security definer
set search_path = public, pg_temp as $$
declare
  created_cart carts;
begin
  if token_hash is null or length(trim(token_hash)) < 32 then
    raise exception 'A cryptographically hashed cart token is required' using errcode = '22023';
  end if;
  if lifetime <= interval '0 seconds' or lifetime > interval '90 days' then
    raise exception 'Cart lifetime must be between 1 second and 90 days' using errcode = '22023';
  end if;

  insert into carts(anonymous_token_hash, expires_at)
  values (token_hash, now() + lifetime)
  returning * into created_cart;
  return created_cart;
end;
$$;

create or replace function assert_cart_access(
  requested_cart_id uuid,
  token_hash text
)
returns carts
language plpgsql security definer
set search_path = public, pg_temp as $$
declare
  matched_cart carts;
begin
  select * into matched_cart
  from carts c
  where c.id = requested_cart_id
    and c.anonymous_token_hash = token_hash
    and c.status = 'active'
    and c.expires_at > now()
  for update;

  if not found then
    raise exception 'Cart is unavailable or access token is invalid' using errcode = 'P0001';
  end if;
  return matched_cart;
end;
$$;

create or replace function set_cart_item(
  requested_cart_id uuid,
  token_hash text,
  requested_sku text,
  requested_quantity integer
)
returns table (
  cart_id uuid,
  sku text,
  quantity integer,
  available_quantity integer,
  currency char(3),
  unit_amount_minor bigint,
  line_amount_minor bigint
)
language plpgsql security definer
set search_path = public, pg_temp as $$
declare
  matched_product storefront_products%rowtype;
begin
  perform assert_cart_access(requested_cart_id, token_hash);

  if requested_quantity < 0 or requested_quantity > 100 then
    raise exception 'Quantity must be between 0 and 100' using errcode = '22023';
  end if;

  select * into matched_product
  from storefront_products sp
  where normalize_catalogue_key(sp.sku) = normalize_catalogue_key(requested_sku);

  if not found then
    raise exception 'Product is not available for sale' using errcode = 'P0001';
  end if;

  if requested_quantity > matched_product.available_quantity then
    raise exception 'Requested quantity exceeds available stock' using errcode = 'P0001';
  end if;

  if requested_quantity = 0 then
    delete from cart_items ci
    where ci.cart_id = requested_cart_id and ci.product_id = matched_product.id;
    return;
  end if;

  insert into cart_items(cart_id, product_id, quantity)
  values (requested_cart_id, matched_product.id, requested_quantity)
  on conflict on constraint cart_items_pkey
  do update set quantity = excluded.quantity;

  return query
  select
    requested_cart_id,
    matched_product.sku,
    requested_quantity,
    matched_product.available_quantity,
    matched_product.currency,
    matched_product.amount_minor,
    matched_product.amount_minor * requested_quantity;
end;
$$;

create or replace function get_anonymous_cart(
  requested_cart_id uuid,
  token_hash text
)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp as $$
declare
  cart_record carts;
  cart_json jsonb;
begin
  cart_record := assert_cart_access(requested_cart_id, token_hash);

  select jsonb_build_object(
    'id', cart_record.id,
    'status', cart_record.status,
    'expiresAt', cart_record.expires_at,
    'currency', coalesce(min(sp.currency), 'NGN'::char(3)),
    'itemCount', coalesce(sum(ci.quantity), 0),
    'subtotalMinor', coalesce(sum(ci.quantity * sp.amount_minor), 0),
    'items', coalesce(
      jsonb_agg(
        jsonb_build_object(
          'sku', sp.sku,
          'slug', sp.slug,
          'name', sp.name,
          'quantity', ci.quantity,
          'availableQuantity', sp.available_quantity,
          'unitAmountMinor', sp.amount_minor,
          'lineAmountMinor', ci.quantity * sp.amount_minor
        ) order by ci.created_at
      ) filter (where ci.product_id is not null),
      '[]'::jsonb
    )
  ) into cart_json
  from carts c
  left join cart_items ci on ci.cart_id = c.id
  left join storefront_products sp on sp.id = ci.product_id
  where c.id = cart_record.id
  group by c.id;

  return cart_json;
end;
$$;

create or replace function purge_expired_carts()
returns integer
language plpgsql security definer
set search_path = public, pg_temp as $$
declare
  affected integer;
begin
  update carts
  set status = 'expired'
  where status = 'active' and expires_at <= now();
  get diagnostics affected = row_count;
  return affected;
end;
$$;

revoke all on function create_anonymous_cart(text, interval) from public;
revoke all on function assert_cart_access(uuid, text) from public;
revoke all on function set_cart_item(uuid, text, text, integer) from public;
revoke all on function get_anonymous_cart(uuid, text) from public;
revoke all on function purge_expired_carts() from public;

comment on function set_cart_item is
'Adds, changes or removes a cart line using only published products, current approved prices and live available inventory.';

commit;
