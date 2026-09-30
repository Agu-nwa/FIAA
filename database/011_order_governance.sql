-- Audited staff order workflow. Apply after 010_delivery_discovery.sql.
begin;

create or replace function admin_transition_order(
  requested_order_id uuid,
  target_status text,
  change_reason text
)
returns orders
language plpgsql security definer
set search_path = public, pg_temp as $$
declare
  staff staff_profiles := require_staff_role(array['owner','order_manager']);
  order_record orders;
  previous_status text;
begin
  if nullif(trim(change_reason), '') is null then
    raise exception 'A reason is required for order status changes' using errcode = '22023';
  end if;
  if target_status not in ('pending_payment','paid','processing','ready_for_pickup','shipped','delivered','cancelled','refunded') then
    raise exception 'Unsupported order status' using errcode = '22023';
  end if;

  select * into order_record from orders where id = requested_order_id for update;
  if not found then
    raise exception 'Order not found' using errcode = 'P0001';
  end if;
  previous_status := order_record.status;

  if target_status in ('paid','refunded') and target_status is distinct from previous_status then
    raise exception 'Payment and refund states may only be changed by verified payment processing' using errcode = 'P0001';
  end if;
  if not (
    previous_status = target_status or
    (previous_status = 'pending_payment' and target_status = 'cancelled') or
    (previous_status = 'paid' and target_status = 'processing') or
    (previous_status = 'processing' and target_status in ('ready_for_pickup','shipped')) or
    (previous_status in ('ready_for_pickup','shipped') and target_status = 'delivered')
  ) then
    raise exception 'Invalid order transition from % to %', previous_status, target_status using errcode = 'P0001';
  end if;
  if target_status = 'shipped' and not exists (
    select 1 from shipments s
    where s.order_id = order_record.id
      and nullif(trim(s.carrier), '') is not null
      and nullif(trim(s.tracking_number), '') is not null
      and s.status in ('ready','collected','in_transit','delivered')
  ) then
    raise exception 'A tracked shipment is required before marking an order shipped' using errcode = '23514';
  end if;

  update orders set status = target_status where id = requested_order_id returning * into order_record;
  if previous_status is distinct from target_status then
    insert into audit_log(staff_id, entity_type, entity_id, action, before_data, after_data)
    values (
      staff.id, 'orders', order_record.id::text, 'status_transition',
      jsonb_build_object('status', previous_status),
      jsonb_build_object('status', target_status, 'reason', trim(change_reason))
    );
  end if;
  return order_record;
end;
$$;

revoke all on function admin_transition_order(uuid,text,text) from public;
grant execute on function admin_transition_order(uuid,text,text) to fiaa_admin;

comment on function admin_transition_order is
'Allows authorized fulfilment progress only through valid order states; payment/refund state remains provider-verified and shipment dispatch requires tracking.';

commit;
