-- FIAA Evolution atomic checkout, stock reservation and verified-payment state.
-- Apply after 003_cart_service.sql.

begin;

alter table delivery_methods
  add column requires_address boolean not null default true;

alter table orders
  add column source_cart_id uuid unique references carts(id) on delete restrict,
  add column checkout_idempotency_key text unique;

create table inventory_reservations (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete restrict,
  product_id uuid not null references products(id) on delete restrict,
  location_id uuid not null references inventory_locations(id) on delete restrict,
  quantity integer not null check (quantity > 0),
  status text not null default 'held' check (status in ('held','committed','released')),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index inventory_reservations_order_idx on inventory_reservations(order_id, status);
create index inventory_reservations_expiry_idx on inventory_reservations(expires_at) where status = 'held';

create trigger inventory_reservations_set_updated_at
before update on inventory_reservations
for each row execute function set_updated_at();

create or replace function create_order_from_anonymous_cart(
  requested_cart_id uuid,
  token_hash text,
  idempotency_key text,
  customer_name text,
  customer_phone_e164 text,
  customer_email text,
  delivery_code text,
  address_line1 text default null,
  address_line2 text default null,
  address_city text default null,
  address_state text default null,
  address_notes text default null,
  order_note text default null,
  reservation_lifetime interval default interval '30 minutes'
)
returns orders
language plpgsql security definer
set search_path = public, pg_temp as $$
declare
  existing_order orders;
  cart_record carts;
  delivery_record delivery_methods;
  created_customer customers;
  created_address customer_addresses;
  created_order orders;
  cart_line record;
  inventory_line record;
  subtotal bigint := 0;
  remaining integer;
  allocated integer;
  item_count integer := 0;
begin
  if idempotency_key is null or length(trim(idempotency_key)) < 24 then
    raise exception 'A strong checkout idempotency key is required' using errcode = '22023';
  end if;
  if reservation_lifetime < interval '5 minutes' or reservation_lifetime > interval '2 hours' then
    raise exception 'Reservation lifetime must be between 5 minutes and 2 hours' using errcode = '22023';
  end if;

  select * into existing_order
  from orders o
  where o.checkout_idempotency_key = idempotency_key;
  if found then
    if existing_order.source_cart_id <> requested_cart_id then
      raise exception 'Idempotency key belongs to another checkout' using errcode = 'P0001';
    end if;
    return existing_order;
  end if;

  cart_record := assert_cart_access(requested_cart_id, token_hash);

  select * into delivery_record
  from delivery_methods dm
  where dm.code = delivery_code and dm.is_active = true;
  if not found then
    raise exception 'Delivery method is unavailable' using errcode = 'P0001';
  end if;
  if delivery_record.requires_address and (
    nullif(trim(address_line1), '') is null or
    nullif(trim(address_city), '') is null or
    nullif(trim(address_state), '') is null
  ) then
    raise exception 'A complete delivery address is required' using errcode = '22023';
  end if;

  select count(*), coalesce(sum(ci.quantity * sp.amount_minor), 0)
  into item_count, subtotal
  from cart_items ci
  join storefront_products sp on sp.id = ci.product_id
  where ci.cart_id = requested_cart_id;
  if item_count = 0 then
    raise exception 'Cart contains no purchasable products' using errcode = 'P0001';
  end if;

  insert into customers(full_name, phone_e164, email)
  values (trim(customer_name), trim(customer_phone_e164), nullif(lower(trim(customer_email)), ''))
  returning * into created_customer;

  if delivery_record.requires_address then
    insert into customer_addresses(
      customer_id, recipient_name, phone_e164, line1, line2, city, state, delivery_notes
    ) values (
      created_customer.id, trim(customer_name), trim(customer_phone_e164), trim(address_line1),
      nullif(trim(address_line2), ''), trim(address_city), trim(address_state), nullif(trim(address_notes), '')
    ) returning * into created_address;
  end if;

  insert into orders(
    customer_id, delivery_address_id, delivery_method_id, source_cart_id,
    checkout_idempotency_key, status, currency, subtotal_minor, delivery_minor,
    discount_minor, total_minor, customer_note, placed_at
  ) values (
    created_customer.id, created_address.id, delivery_record.id, requested_cart_id,
    idempotency_key, 'pending_payment', delivery_record.currency, subtotal,
    delivery_record.fee_minor, 0, subtotal + delivery_record.fee_minor,
    nullif(trim(order_note), ''), now()
  ) returning * into created_order;

  for cart_line in
    select ci.product_id, ci.quantity, sp.sku, sp.name, sp.amount_minor,
      sp.axle_position, sp.available_quantity
    from cart_items ci
    join storefront_products sp on sp.id = ci.product_id
    where ci.cart_id = requested_cart_id
    order by sp.sku
  loop
    if cart_line.quantity > cart_line.available_quantity then
      raise exception 'Insufficient stock for %', cart_line.sku using errcode = 'P0001';
    end if;

    insert into order_items(
      order_id, product_id, sku_snapshot, name_snapshot, unit_price_minor,
      quantity, line_total_minor, fitment_snapshot
    ) values (
      created_order.id, cart_line.product_id, cart_line.sku, cart_line.name,
      cart_line.amount_minor, cart_line.quantity, cart_line.amount_minor * cart_line.quantity,
      jsonb_build_object('position', cart_line.axle_position)
    );

    remaining := cart_line.quantity;
    for inventory_line in
      select i.location_id, i.quantity_on_hand, i.quantity_reserved
      from inventory i
      where i.product_id = cart_line.product_id
        and i.quantity_on_hand > i.quantity_reserved
      order by (i.quantity_on_hand - i.quantity_reserved) desc, i.location_id
      for update
    loop
      exit when remaining = 0;
      allocated := least(remaining, inventory_line.quantity_on_hand - inventory_line.quantity_reserved);
      update inventory i
      set quantity_reserved = quantity_reserved + allocated
      where i.product_id = cart_line.product_id and i.location_id = inventory_line.location_id;
      insert into inventory_reservations(
        order_id, product_id, location_id, quantity, expires_at
      ) values (
        created_order.id, cart_line.product_id, inventory_line.location_id,
        allocated, now() + reservation_lifetime
      );
      remaining := remaining - allocated;
    end loop;
    if remaining > 0 then
      raise exception 'Inventory allocation failed for %', cart_line.sku using errcode = 'P0001';
    end if;
  end loop;

  update carts set status = 'converted' where id = requested_cart_id;
  return created_order;
end;
$$;

create or replace function record_verified_payment(
  requested_order_id uuid,
  payment_provider text,
  payment_reference text,
  payment_idempotency_key text,
  paid_amount_minor bigint,
  paid_currency char(3),
  verified_provider_payload jsonb default null
)
returns orders
language plpgsql security definer
set search_path = public, pg_temp as $$
declare
  locked_order orders;
  existing_payment payments;
begin
  select * into locked_order from orders where id = requested_order_id for update;
  if not found then
    raise exception 'Order not found' using errcode = 'P0001';
  end if;

  select * into existing_payment
  from payments where idempotency_key = payment_idempotency_key;
  if found then
    if existing_payment.order_id <> requested_order_id then
      raise exception 'Payment idempotency key belongs to another order' using errcode = 'P0001';
    end if;
    return locked_order;
  end if;

  if locked_order.status not in ('pending_payment','paid') then
    raise exception 'Order cannot accept payment in its current state' using errcode = 'P0001';
  end if;
  if paid_amount_minor <> locked_order.total_minor or paid_currency <> locked_order.currency then
    raise exception 'Verified payment amount or currency does not match order' using errcode = 'P0001';
  end if;

  insert into payments(
    order_id, provider, provider_reference, status, amount_minor, currency,
    idempotency_key, provider_payload, paid_at
  ) values (
    locked_order.id, payment_provider, payment_reference, 'successful',
    paid_amount_minor, paid_currency, payment_idempotency_key,
    verified_provider_payload, now()
  );

  update inventory_reservations
  set status = 'committed'
  where order_id = locked_order.id and status = 'held';
  update orders set status = 'paid' where id = locked_order.id returning * into locked_order;
  return locked_order;
end;
$$;

create or replace function release_order_inventory(
  requested_order_id uuid,
  cancellation_note text default null
)
returns orders
language plpgsql security definer
set search_path = public, pg_temp as $$
declare
  locked_order orders;
  held_line record;
begin
  select * into locked_order from orders where id = requested_order_id for update;
  if not found then
    raise exception 'Order not found' using errcode = 'P0001';
  end if;
  if locked_order.status not in ('pending_payment','cancelled') then
    raise exception 'Inventory cannot be released for this order state' using errcode = 'P0001';
  end if;

  for held_line in
    select * from inventory_reservations
    where order_id = locked_order.id and status = 'held'
    for update
  loop
    update inventory
    set quantity_reserved = quantity_reserved - held_line.quantity
    where product_id = held_line.product_id and location_id = held_line.location_id;
    update inventory_reservations set status = 'released' where id = held_line.id;
  end loop;

  update orders
  set status = 'cancelled', internal_note = concat_ws(E'\n', internal_note, nullif(trim(cancellation_note), ''))
  where id = locked_order.id
  returning * into locked_order;
  return locked_order;
end;
$$;

create or replace function release_expired_order_reservations()
returns integer
language plpgsql security definer
set search_path = public, pg_temp as $$
declare
  order_row record;
  released_count integer := 0;
begin
  for order_row in
    select distinct ir.order_id
    from inventory_reservations ir
    join orders o on o.id = ir.order_id
    where ir.status = 'held' and ir.expires_at <= now() and o.status = 'pending_payment'
  loop
    perform release_order_inventory(order_row.order_id, 'Payment window expired');
    released_count := released_count + 1;
  end loop;
  return released_count;
end;
$$;

revoke all on function create_order_from_anonymous_cart(uuid,text,text,text,text,text,text,text,text,text,text,text,text,interval) from public;
revoke all on function record_verified_payment(uuid,text,text,text,bigint,char,jsonb) from public;
revoke all on function release_order_inventory(uuid,text) from public;
revoke all on function release_expired_order_reservations() from public;

comment on function create_order_from_anonymous_cart is
'Creates an idempotent pending-payment order from a valid cart, snapshots approved prices and atomically reserves live inventory.';
comment on function record_verified_payment is
'Records payment only after the application has verified the provider webhook signature and enforces exact order amount and currency.';

commit;
