\set ON_ERROR_STOP on

begin;

insert into staff_profiles(auth_subject, full_name, role)
values ('auth-shipping-manager','Shipping Manager','order_manager'),
       ('auth-shipping-support','Shipping Support','support');
insert into customers(full_name,phone_e164) values ('Shipment Customer','+2348011114444');
insert into delivery_methods(code,name,requires_address) values ('shipment-delivery','Shipment Delivery',false);
insert into orders(customer_id,delivery_method_id,status,currency,subtotal_minor,total_minor,placed_at)
select c.id,d.id,'processing','NGN',100000,100000,now()
from customers c cross join delivery_methods d
where c.phone_e164='+2348011114444' and d.code='shipment-delivery';

do $$
declare
  order_record orders;
  shipment_record shipments;
  rejected boolean;
  notification_count integer;
begin
  if not has_function_privilege('fiaa_admin','admin_upsert_shipment(uuid,text,text,text,text)','execute') then
    raise exception 'Administration role cannot manage shipments';
  end if;
  if has_function_privilege('public','admin_upsert_shipment(uuid,text,text,text,text)','execute') then
    raise exception 'Public role can manage shipments';
  end if;
  select o.* into order_record from orders o join customers c on c.id=o.customer_id where c.phone_e164='+2348011114444';

  perform set_config('app.auth_subject','auth-shipping-support',true);
  rejected := false;
  begin
    perform admin_upsert_shipment(order_record.id,'DHL','TRACK-100','ready','Support attempted dispatch');
  exception when insufficient_privilege then rejected := true;
  end;
  if not rejected then raise exception 'Support staff created a shipment'; end if;

  perform set_config('app.auth_subject','auth-shipping-manager',true);
  rejected := false;
  begin
    perform admin_upsert_shipment(order_record.id,'DHL','TRACK-100','in_transit','Attempted initial status jump');
  exception when raise_exception then rejected := true;
  end;
  if not rejected then raise exception 'New shipment skipped ready status'; end if;

  shipment_record := admin_upsert_shipment(order_record.id,'DHL','TRACK-100','ready','Carrier booking confirmed');
  shipment_record := admin_upsert_shipment(order_record.id,'DHL','TRACK-100','in_transit','Carrier collected order');
  if shipment_record.shipped_at is null then raise exception 'Shipment dispatch time was not recorded'; end if;
  order_record := admin_transition_order(order_record.id,'shipped','Tracked shipment dispatched');
  shipment_record := admin_upsert_shipment(order_record.id,'DHL','TRACK-100','delivered','Carrier confirmed delivery');
  order_record := admin_transition_order(order_record.id,'delivered','Tracked delivery completed');

  select count(*) into notification_count from notification_outbox
  where aggregate_type='shipment' and aggregate_id=shipment_record.id;
  if notification_count < 3 then raise exception 'Shipment changes did not enqueue notifications'; end if;
end;
$$;

rollback;
