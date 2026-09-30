\set ON_ERROR_STOP on

begin;

insert into product_categories(slug, name) values ('checkout-test', 'Checkout Test');
insert into inventory_locations(code, name) values ('CHECKOUT-A', 'Checkout Warehouse A'), ('CHECKOUT-B', 'Checkout Warehouse B');
insert into delivery_methods(code, name, fee_minor, currency, requires_address)
values ('checkout-delivery', 'Test Delivery', 150000, 'NGN', true);

insert into products(
  sku, slug, name, product_kind, category_id, short_description,
  axle_position, publication_status, owner_verified_at, owner_verified_by, published_at
)
select 'D-CHECKOUT', 'd-checkout', 'Checkout Test Product', 'brake_pad', id,
  'Verified checkout test product', 'front', 'published', now(), 'schema-test', now()
from product_categories where slug = 'checkout-test';

insert into product_prices(product_id, amount_minor, approved_at, approved_by)
select id, 500000, now(), 'schema-test' from products where sku = 'D-CHECKOUT';

insert into inventory(product_id, location_id, quantity_on_hand, quantity_reserved)
select p.id, l.id, case l.code when 'CHECKOUT-A' then 2 else 3 end, 0
from products p cross join inventory_locations l
where p.sku = 'D-CHECKOUT' and l.code in ('CHECKOUT-A','CHECKOUT-B');

do $$
declare
  token text := repeat('c', 64);
  cart_record carts;
  created_order orders;
  repeated_order orders;
  paid_order orders;
  expiry_cart carts;
  expiry_order orders;
  reserved integer;
  released_orders integer;
  rejected boolean;
begin
  cart_record := create_anonymous_cart(token, interval '1 day');
  perform set_cart_item(cart_record.id, token, 'D-CHECKOUT', 4);

  created_order := create_order_from_anonymous_cart(
    cart_record.id, token, repeat('i', 32), 'Ada Okafor', '+2348012345678',
    'ada@example.com', 'checkout-delivery', '12 Test Road', null,
    'Nnewi', 'Anambra', 'Call on arrival', 'Test order', interval '30 minutes'
  );

  if created_order.subtotal_minor <> 2000000 or created_order.delivery_minor <> 150000 or created_order.total_minor <> 2150000 then
    raise exception 'Order totals are incorrect: %', row_to_json(created_order);
  end if;
  select coalesce(sum(quantity), 0) into reserved
  from inventory_reservations where order_id = created_order.id and status = 'held';
  if reserved <> 4 then
    raise exception 'Expected four reserved units, got %', reserved;
  end if;
  if (select status from carts where id = cart_record.id) <> 'converted' then
    raise exception 'Cart was not converted';
  end if;

  repeated_order := create_order_from_anonymous_cart(
    cart_record.id, token, repeat('i', 32), 'Ada Okafor', '+2348012345678',
    'ada@example.com', 'checkout-delivery', '12 Test Road', null,
    'Nnewi', 'Anambra', null, null, interval '30 minutes'
  );
  if repeated_order.id <> created_order.id then
    raise exception 'Checkout idempotency failed';
  end if;

  rejected := false;
  begin
    perform record_verified_payment(created_order.id, 'test-provider', 'bad-amount', repeat('p', 32), 1, 'NGN', '{}'::jsonb);
  exception when others then
    rejected := true;
  end;
  if not rejected then
    raise exception 'Mismatched payment amount was accepted';
  end if;

  paid_order := record_verified_payment(
    created_order.id, 'test-provider', 'verified-reference', repeat('q', 32),
    2150000, 'NGN', '{"verified":true}'::jsonb
  );
  if paid_order.status <> 'paid' then
    raise exception 'Order was not marked paid';
  end if;
  if exists(select 1 from inventory_reservations where order_id = created_order.id and status <> 'committed') then
    raise exception 'Reservations were not committed after payment';
  end if;

  rejected := false;
  begin
    perform release_order_inventory(created_order.id, 'Must not release paid stock');
  exception when others then
    rejected := true;
  end;
  if not rejected then
    raise exception 'Paid order inventory was released';
  end if;

  expiry_cart := create_anonymous_cart(repeat('e', 64), interval '1 day');
  perform set_cart_item(expiry_cart.id, repeat('e', 64), 'D-CHECKOUT', 1);
  expiry_order := create_order_from_anonymous_cart(
    expiry_cart.id, repeat('e', 64), repeat('x', 32), 'Emeka Obi', '+2348098765432',
    null, 'checkout-delivery', '4 Market Road', null,
    'Nnewi', 'Anambra', null, null, interval '30 minutes'
  );
  update inventory_reservations
  set expires_at = now() - interval '1 minute'
  where order_id = expiry_order.id and status = 'held';
  released_orders := release_expired_order_reservations();
  if released_orders <> 1 or (select status from orders where id = expiry_order.id) <> 'cancelled' then
    raise exception 'Expired order was not cancelled and released';
  end if;
  if exists(select 1 from inventory_reservations where order_id = expiry_order.id and status <> 'released') then
    raise exception 'Expired order reservations were not released';
  end if;
  select coalesce(sum(quantity_reserved), 0) into reserved
  from inventory where product_id = (select id from products where sku = 'D-CHECKOUT');
  if reserved <> 4 then
    raise exception 'Expired order stock was not returned; reserved is %', reserved;
  end if;
end;
$$;

rollback;
