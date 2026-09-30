\set ON_ERROR_STOP on

begin;

insert into staff_profiles(auth_subject, full_name, role)
values ('auth-owner', 'FIAA Owner', 'owner'), ('auth-catalogue', 'Catalogue Manager', 'catalogue_manager');
insert into product_categories(slug, name) values ('admin-test', 'Admin Test');
insert into inventory_locations(code, name) values ('ADMIN-WH', 'Admin Warehouse');
insert into vehicle_makes(name, slug) values ('Admin Toyota', 'admin-toyota');
insert into vehicle_models(make_id, name, slug)
select id, 'Admin Camry', 'admin-camry' from vehicle_makes where slug = 'admin-toyota';

insert into products(
  sku, slug, name, product_kind, category_id, short_description, description,
  axle_position, width_mm, height_mm, thickness_mm
)
select 'D-ADMIN', 'd-admin', 'Admin Test Brake Pad', 'brake_pad', id,
  'Owner-approved test pad', 'Full production description', 'front', 120, 55, 16
from product_categories where slug = 'admin-test';

do $$
declare
  product_record products;
  rejected boolean;
  problems jsonb;
  audit_count integer;
begin
  select * into product_record from products where sku = 'D-ADMIN';

  perform set_config('app.auth_subject', 'auth-catalogue', true);
  product_record := admin_transition_product(product_record.id, 'review', 'Catalogue entry completed');
  if product_record.publication_status <> 'review' then
    raise exception 'Catalogue manager could not submit review';
  end if;

  rejected := false;
  begin
    perform admin_transition_product(product_record.id, 'approved', 'Attempted manager approval');
  exception when insufficient_privilege then
    rejected := true;
  end;
  if not rejected then
    raise exception 'Catalogue manager approved a product';
  end if;

  perform set_config('app.auth_subject', 'auth-owner', true);
  product_record := admin_transition_product(product_record.id, 'approved', 'Owner approved catalogue facts');
  rejected := false;
  begin
    perform admin_transition_product(product_record.id, 'published', 'Attempt before commercial readiness');
  exception when check_violation then
    rejected := true;
  end;
  if not rejected then
    raise exception 'Incomplete product was published';
  end if;

  problems := product_publication_problems(product_record.id);
  if not (problems ? 'Missing approved current price') or not (problems ? 'Missing owner-verified primary image') then
    raise exception 'Publication problem report is incomplete: %', problems;
  end if;

  insert into product_oem_references(product_id, reference, manufacturer)
  values (product_record.id, 'ADMIN-OEM-1', 'Admin Toyota');
  insert into product_prices(product_id, amount_minor, approved_at, approved_by)
  values (product_record.id, 650000, now(), 'FIAA Owner');
  insert into product_images(
    product_id, storage_key, alt_text, image_role, mime_type, owner_verified_at
  ) values (
    product_record.id, 'verified/admin-test.webp', 'Verified admin test pad', 'primary', 'image/webp', now()
  );
  insert into inventory(product_id, location_id, quantity_on_hand)
  select product_record.id, id, 10 from inventory_locations where code = 'ADMIN-WH';
  insert into product_fitments(
    product_id, model_id, year_from, year_to, axle_position, source_reference, owner_verified_at
  ) select product_record.id, id, 2018, 2022, 'front', 'admin-test-source', now()
  from vehicle_models where slug = 'admin-camry';

  problems := product_publication_problems(product_record.id);
  if jsonb_array_length(problems) <> 0 then
    raise exception 'Complete product still reports problems: %', problems;
  end if;
  product_record := admin_transition_product(product_record.id, 'published', 'All production gates satisfied');
  if product_record.publication_status <> 'published' then
    raise exception 'Complete product was not published';
  end if;

  select count(*) into audit_count from audit_log
  where entity_type = 'products' and entity_id = product_record.id::text;
  if audit_count < 4 then
    raise exception 'Expected product audit history, found % rows', audit_count;
  end if;
end;
$$;

rollback;
