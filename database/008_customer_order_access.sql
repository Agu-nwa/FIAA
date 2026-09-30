-- Private customer order access. Apply after 007_content_governance.sql.
begin;

create table order_access_tokens (
  order_id uuid primary key references orders(id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz,
  check (expires_at > created_at)
);
create index order_access_tokens_expiry_idx on order_access_tokens(expires_at) where revoked_at is null;

create or replace function create_customer_checkout(
  requested_cart_id uuid, cart_token_hash text, idempotency_key text, order_token_hash text,
  customer_name text, customer_phone_e164 text, customer_email text, delivery_code text,
  address_line1 text default null, address_line2 text default null, address_city text default null,
  address_state text default null, address_notes text default null, order_note text default null,
  reservation_lifetime interval default interval '30 minutes', access_lifetime interval default interval '90 days'
)
returns table(order_id uuid, order_number text, was_created boolean)
language plpgsql security definer set search_path = public, pg_temp as $$
declare existing_id uuid; created_order orders;
begin
  if order_token_hash is null or order_token_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'A valid order access token hash is required' using errcode = '22023';
  end if;
  if access_lifetime < interval '1 day' or access_lifetime > interval '1 year' then
    raise exception 'Order access lifetime must be between 1 day and 1 year' using errcode = '22023';
  end if;
  select o.id into existing_id from orders o where o.checkout_idempotency_key = idempotency_key;
  created_order := create_order_from_anonymous_cart(
    requested_cart_id, cart_token_hash, idempotency_key, customer_name, customer_phone_e164,
    customer_email, delivery_code, address_line1, address_line2, address_city, address_state,
    address_notes, order_note, reservation_lifetime
  );
  insert into order_access_tokens(order_id, token_hash, expires_at)
  values (created_order.id, order_token_hash, now() + access_lifetime)
  on conflict on constraint order_access_tokens_pkey do nothing;
  return query select created_order.id, created_order.order_number, existing_id is null;
end;
$$;

create or replace function get_customer_order(requested_order_number text, order_token_hash text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare order_record orders; result jsonb;
begin
  select o.* into order_record from orders o
  join order_access_tokens oat on oat.order_id = o.id
  where o.order_number = requested_order_number and oat.token_hash = order_token_hash
    and oat.revoked_at is null and oat.expires_at > now();
  if not found then
    raise exception 'Order is unavailable or access token is invalid' using errcode = 'P0001';
  end if;
  update order_access_tokens set last_used_at = now() where order_id = order_record.id;
  select jsonb_build_object(
    'id', order_record.id, 'orderNumber', order_record.order_number, 'status', order_record.status,
    'currency', trim(order_record.currency), 'subtotalMinor', order_record.subtotal_minor,
    'deliveryMinor', order_record.delivery_minor, 'discountMinor', order_record.discount_minor,
    'totalMinor', order_record.total_minor, 'placedAt', order_record.placed_at,
    'items', coalesce((select jsonb_agg(jsonb_build_object(
      'sku', oi.sku_snapshot, 'name', oi.name_snapshot, 'quantity', oi.quantity,
      'unitAmountMinor', oi.unit_price_minor, 'lineAmountMinor', oi.line_total_minor
    ) order by oi.created_at, oi.id) from order_items oi where oi.order_id = order_record.id), '[]'::jsonb)
  ) into result;
  return result;
end;
$$;

revoke all on table order_access_tokens from public;
revoke all on function create_customer_checkout(uuid,text,text,text,text,text,text,text,text,text,text,text,text,text,interval,interval) from public;
revoke all on function get_customer_order(text,text) from public;
comment on table order_access_tokens is 'Stores only SHA-256 hashes of customer order tokens; order numbers alone never authorize access.';
commit;
