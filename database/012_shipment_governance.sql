-- Audited shipment creation and tracking workflow. Apply after 011_order_governance.sql.
begin;

create or replace function admin_upsert_shipment(
  requested_order_id uuid,
  requested_carrier text,
  requested_tracking_number text,
  target_status text,
  change_reason text
)
returns shipments
language plpgsql security definer
set search_path = public, pg_temp as $$
declare
  staff staff_profiles := require_staff_role(array['owner','order_manager']);
  order_record orders;
  shipment_record shipments;
  previous_status text;
begin
  if nullif(trim(requested_carrier), '') is null or nullif(trim(requested_tracking_number), '') is null then
    raise exception 'Carrier and tracking number are required' using errcode = '22023';
  end if;
  if nullif(trim(change_reason), '') is null then
    raise exception 'A reason is required for shipment changes' using errcode = '22023';
  end if;
  if target_status not in ('ready','collected','in_transit','delivered','returned','cancelled') then
    raise exception 'Unsupported shipment status' using errcode = '22023';
  end if;

  select * into order_record from orders where id=requested_order_id for update;
  if not found then raise exception 'Order not found' using errcode = 'P0001'; end if;
  if order_record.status not in ('paid','processing','ready_for_pickup','shipped','delivered') then
    raise exception 'Order is not eligible for shipment' using errcode = 'P0001';
  end if;

  select * into shipment_record from shipments
  where order_id=requested_order_id order by created_at desc, id desc limit 1 for update;

  if not found then
    if target_status <> 'ready' then
      raise exception 'A new shipment must begin in ready status' using errcode = 'P0001';
    end if;
    insert into shipments(order_id, carrier, tracking_number, status)
    values (requested_order_id, trim(requested_carrier), trim(requested_tracking_number), 'ready')
    returning * into shipment_record;
    previous_status := null;
  else
    previous_status := shipment_record.status;
    if not (
      previous_status = target_status or
      (previous_status = 'pending' and target_status in ('ready','cancelled')) or
      (previous_status = 'ready' and target_status in ('collected','in_transit','cancelled')) or
      (previous_status = 'collected' and target_status in ('in_transit','delivered','returned')) or
      (previous_status = 'in_transit' and target_status in ('delivered','returned'))
    ) then
      raise exception 'Invalid shipment transition from % to %', previous_status, target_status using errcode = 'P0001';
    end if;
    update shipments
    set carrier=trim(requested_carrier), tracking_number=trim(requested_tracking_number), status=target_status,
        shipped_at=case when target_status in ('collected','in_transit','delivered') then coalesce(shipped_at,now()) else shipped_at end,
        delivered_at=case when target_status='delivered' then coalesce(delivered_at,now()) else delivered_at end
    where id=shipment_record.id returning * into shipment_record;
  end if;

  insert into audit_log(staff_id, entity_type, entity_id, action, before_data, after_data)
  values (
    staff.id, 'shipments', shipment_record.id::text,
    case when previous_status is null then 'create' else 'status_transition' end,
    case when previous_status is null then null else jsonb_build_object('status',previous_status) end,
    jsonb_build_object('orderId',requested_order_id,'status',shipment_record.status,'carrier',shipment_record.carrier,'trackingNumber',shipment_record.tracking_number,'reason',trim(change_reason))
  );
  return shipment_record;
end;
$$;

revoke all on function admin_upsert_shipment(uuid,text,text,text,text) from public;
grant execute on function admin_upsert_shipment(uuid,text,text,text,text) to fiaa_admin;

comment on function admin_upsert_shipment is
'Creates and advances tracked shipments through an audited fulfilment workflow for authorized staff.';

commit;
