\set ON_ERROR_STOP on

begin;

insert into product_categories(slug, name) values ('cart-test-parts', 'Cart Test Parts');
insert into inventory_locations(code, name) values ('CART-WH', 'Cart Test Warehouse');

insert into products(
  sku, slug, name, product_kind, category_id, short_description,
  axle_position, publication_status, owner_verified_at, owner_verified_by, published_at
)
select 'D-CART-1', 'd-cart-1', 'Published Cart Test Product', 'brake_pad', id,
  'Published test product', 'front', 'published', now(), 'schema-test', now()
from product_categories where slug = 'cart-test-parts';

insert into products(
  sku, slug, name, product_kind, category_id, short_description,
  axle_position, publication_status
)
select 'D-CART-DRAFT', 'd-cart-draft', 'Draft Cart Test Product', 'brake_pad', id,
  'Draft test product', 'front', 'draft'
from product_categories where slug = 'cart-test-parts';

insert into product_prices(product_id, amount_minor, approved_at, approved_by)
select id, 375000, now(), 'schema-test' from products where sku = 'D-CART-1';

insert into inventory(product_id, location_id, quantity_on_hand, quantity_reserved)
select p.id, l.id, 5, 1
from products p cross join inventory_locations l
where p.sku = 'D-CART-1' and l.code = 'CART-WH';

do $$
declare
  token text := repeat('a', 64);
  test_cart carts;
  payload jsonb;
  rejected boolean;
begin
  test_cart := create_anonymous_cart(token, interval '1 day');

  perform set_cart_item(test_cart.id, token, 'D-CART-1', 3);
  payload := get_anonymous_cart(test_cart.id, token);
  if (payload->>'itemCount')::integer <> 3 or (payload->>'subtotalMinor')::bigint <> 1125000 then
    raise exception 'Cart totals are incorrect: %', payload;
  end if;

  rejected := false;
  begin
    perform set_cart_item(test_cart.id, token, 'D-CART-1', 5);
  exception when others then
    rejected := true;
  end;
  if not rejected then
    raise exception 'Overselling was not rejected';
  end if;

  rejected := false;
  begin
    perform set_cart_item(test_cart.id, token, 'D-CART-DRAFT', 1);
  exception when others then
    rejected := true;
  end;
  if not rejected then
    raise exception 'Draft product was accepted into cart';
  end if;

  rejected := false;
  begin
    perform get_anonymous_cart(test_cart.id, repeat('b', 64));
  exception when others then
    rejected := true;
  end;
  if not rejected then
    raise exception 'Invalid cart token was accepted';
  end if;

  perform set_cart_item(test_cart.id, token, 'D-CART-1', 0);
  payload := get_anonymous_cart(test_cart.id, token);
  if (payload->>'itemCount')::integer <> 0 or jsonb_array_length(payload->'items') <> 0 then
    raise exception 'Cart line removal failed: %', payload;
  end if;
end;
$$;

rollback;
