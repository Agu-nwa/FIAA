\set ON_ERROR_STOP on

begin;

insert into staff_profiles(auth_subject, full_name, role)
values ('auth-order-manager', 'Order Manager', 'order_manager'),
       ('auth-catalogue-only', 'Catalogue Only', 'catalogue_manager');
insert into customers(full_name, phone_e164) values ('Order Test Customer', '+2348011113333');
insert into delivery_methods(code, name, requires_address) values ('order-test-pickup', 'Order Test Pickup', false);
insert into orders(customer_id, delivery_method_id, status, currency, subtotal_minor, total_minor, placed_at)
select c.id, d.id, 'paid', 'NGN', 100000, 100000, now()
from customers c cross join delivery_methods d
where c.phone_e164 = '+2348011113333' and d.code = 'order-test-pickup';

do $$
declare
  order_record orders;
  rejected boolean;
  transition_count integer;
begin
  if not has_function_privilege('fiaa_admin','admin_transition_order(uuid,text,text)','execute') then
    raise exception 'Administration role cannot execute governed order transitions';
  end if;
  if has_function_privilege('public','admin_transition_order(uuid,text,text)','execute') then
    raise exception 'Public role can execute governed order transitions';
  end if;

  select o.* into order_record from orders o join customers c on c.id=o.customer_id where c.phone_e164='+2348011113333';
  perform set_config('app.auth_subject', 'auth-catalogue-only', true);
  rejected := false;
  begin
    perform admin_transition_order(order_record.id, 'processing', 'Catalogue staff attempted fulfilment');
  exception when insufficient_privilege then rejected := true;
  end;
  if not rejected then raise exception 'Catalogue manager changed an order state'; end if;

  perform set_config('app.auth_subject', 'auth-order-manager', true);

  rejected := false;
  begin
    perform admin_transition_order(order_record.id, 'delivered', 'Attempted invalid shortcut');
  exception when raise_exception then rejected := true;
  end;
  if not rejected then raise exception 'Invalid paid-to-delivered transition was accepted'; end if;

  order_record := admin_transition_order(order_record.id, 'processing', 'Payment confirmed and order accepted');
  order_record := admin_transition_order(order_record.id, 'ready_for_pickup', 'Order prepared for customer collection');
  order_record := admin_transition_order(order_record.id, 'delivered', 'Customer collected the order');
  if order_record.status <> 'delivered' then raise exception 'Valid fulfilment workflow failed'; end if;

  rejected := false;
  begin
    perform admin_transition_order(order_record.id, 'refunded', 'Attempted unverified refund');
  exception when raise_exception then rejected := true;
  end;
  if not rejected then raise exception 'Staff changed refund status without verified payment processing'; end if;

  select count(*) into transition_count from audit_log
  where entity_type='orders' and entity_id=order_record.id::text and action='status_transition';
  if transition_count <> 3 then raise exception 'Expected three audited order transitions, found %', transition_count; end if;
end;
$$;

rollback;
