\set ON_ERROR_STOP on

begin;

insert into product_categories(slug, name) values ('test-brake-pads', 'Test Brake Pads');
insert into inventory_locations(code, name) values ('TEST-WH', 'Test Warehouse');
insert into vehicle_makes(name, slug) values ('Toyota', 'toyota');
insert into vehicle_models(make_id, name, slug)
select id, 'Camry', 'camry' from vehicle_makes where slug = 'toyota';

insert into products(
  sku, slug, name, product_kind, category_id, short_description,
  axle_position, publication_status, owner_verified_at, owner_verified_by, published_at
)
select
  'D-5468', 'test-d-5468', 'FIAA Front Brake Pad D-5468', 'brake_pad', id,
  'Verified test brake pad', 'front', 'published', now(), 'schema-test', now()
from product_categories where slug = 'test-brake-pads';

insert into products(
  sku, slug, name, product_kind, category_id, short_description,
  axle_position, publication_status
)
select
  'D-DRAFT', 'test-d-draft', 'Hidden Draft Brake Pad', 'brake_pad', id,
  'Must never appear', 'front', 'draft'
from product_categories where slug = 'test-brake-pads';

insert into product_oem_references(product_id, reference, manufacturer)
select id, '04465-33480', 'Toyota' from products where sku = 'D-5468';

insert into product_prices(product_id, currency, amount_minor, approved_at, approved_by)
select id, 'NGN', 2500000, now(), 'schema-test' from products where sku = 'D-5468';

insert into inventory(product_id, location_id, quantity_on_hand, quantity_reserved)
select p.id, l.id, 12, 2
from products p cross join inventory_locations l
where p.sku = 'D-5468' and l.code = 'TEST-WH';

insert into product_fitments(
  product_id, model_id, year_from, year_to, engine, axle_position,
  source_reference, owner_verified_at
)
select p.id, vm.id, 2018, 2022, '2.5L', 'front', 'test-source', now()
from products p cross join vehicle_models vm
where p.sku = 'D-5468' and vm.slug = 'camry';

do $$
declare
  matched_count integer;
  first_sku text;
  available integer;
begin
  select count(*), min(sku), min(available_quantity)
  into matched_count, first_sku, available
  from search_storefront('D-5468', null, null, null, null, 24, 0);

  if matched_count <> 1 or first_sku <> 'D-5468' or available <> 10 then
    raise exception 'Exact SKU search failed: count %, sku %, available %', matched_count, first_sku, available;
  end if;

  select count(*) into matched_count
  from search_storefront('04465-33480', null, null, null, null, 24, 0)
  where sku = 'D-5468';
  if matched_count <> 1 then
    raise exception 'OEM reference search failed';
  end if;

  select count(*) into matched_count
  from search_storefront(null, 'Toyota', 'Camry', 2020::smallint, 'front', 24, 0)
  where sku = 'D-5468';
  if matched_count <> 1 then
    raise exception 'Structured vehicle search failed';
  end if;

  select count(*) into matched_count
  from search_storefront(null, 'Toyota', 'Camry', 2010::smallint, 'front', 24, 0);
  if matched_count <> 0 then
    raise exception 'Year exclusion failed';
  end if;

  select count(*) into matched_count
  from storefront_search_documents where sku = 'D-DRAFT';
  if matched_count <> 0 then
    raise exception 'Draft product leaked into storefront search';
  end if;
end;
$$;

rollback;
