\set ON_ERROR_STOP on

begin;

insert into customers(full_name, phone_e164, email)
values ('Notification Test', '+2348011112222', 'notify@example.com');
insert into delivery_methods(code, name, fee_minor, currency, requires_address)
values ('notification-pickup', 'Notification Pickup', 0, 'NGN', false);

insert into orders(
  customer_id, delivery_method_id, status, currency,
  subtotal_minor, delivery_minor, discount_minor, total_minor, placed_at
)
select c.id, dm.id, 'pending_payment', 'NGN', 100000, 0, 0, 100000, now()
from customers c cross join delivery_methods dm
where c.phone_e164 = '+2348011112222' and dm.code = 'notification-pickup';

insert into payments(
  order_id, provider, provider_reference, status, amount_minor, currency,
  idempotency_key, provider_payload, paid_at
)
select id, 'test-provider', 'notify-payment-1', 'successful', total_minor, currency,
  'notify-payment-idempotency-1', '{"verified":true}'::jsonb, now()
from orders where customer_id = (select id from customers where phone_e164 = '+2348011112222');

do $$
declare
  test_order orders;
  claimed notification_outbox;
  failed_job notification_outbox;
  sent_job notification_outbox;
  job_count integer;
  rejected boolean;
begin
  select * into test_order from orders where customer_id = (
    select id from customers where phone_e164 = '+2348011112222'
  );

  select count(*) into job_count
  from notification_outbox where aggregate_id = test_order.id and event_type = 'order.created';
  if job_count <> 2 then
    raise exception 'Expected WhatsApp and email order-created jobs, found %', job_count;
  end if;

  select count(*) into job_count
  from notification_outbox where event_type = 'payment.successful'
    and payload->>'orderNumber' = test_order.order_number;
  if job_count <> 1 then
    raise exception 'Successful payment notification was not enqueued';
  end if;

  update orders set status = 'processing' where id = test_order.id;
  select count(*) into job_count
  from notification_outbox where aggregate_id = test_order.id and event_type = 'order.status_changed';
  if job_count <> 1 then
    raise exception 'Order status notification was not enqueued exactly once';
  end if;

  select * into claimed from claim_notification_jobs('worker-a', 1, interval '2 minutes') limit 1;
  if claimed.status <> 'processing' or claimed.attempt_count <> 1 or claimed.locked_by <> 'worker-a' then
    raise exception 'Notification claim failed: %', row_to_json(claimed);
  end if;

  rejected := false;
  begin
    perform complete_notification_job(claimed.id, 'wrong-worker', null);
  exception when others then
    rejected := true;
  end;
  if not rejected then
    raise exception 'Wrong worker completed a leased job';
  end if;

  failed_job := fail_notification_job(claimed.id, 'worker-a', 'Temporary provider failure');
  if failed_job.status <> 'failed' or failed_job.last_error <> 'Temporary provider failure' then
    raise exception 'Retryable failure was not recorded';
  end if;

  update notification_outbox set available_at = now() where id = failed_job.id;
  select * into claimed from claim_notification_jobs('worker-b', 1, interval '2 minutes')
  where id = failed_job.id limit 1;
  if claimed.attempt_count <> 2 or claimed.locked_by <> 'worker-b' then
    raise exception 'Failed notification was not reclaimed';
  end if;
  sent_job := complete_notification_job(claimed.id, 'worker-b', 'provider-message-1');
  if sent_job.status <> 'sent' or sent_job.provider_message_id <> 'provider-message-1' or sent_job.sent_at is null then
    raise exception 'Notification completion failed';
  end if;

  insert into shipments(order_id, carrier, tracking_number, status)
  values (test_order.id, 'Test Carrier', 'TRACK-1', 'in_transit');
  select count(*) into job_count
  from notification_outbox where event_type = 'shipment.status_changed' and payload->>'trackingNumber' = 'TRACK-1';
  if job_count <> 1 then
    raise exception 'Shipment notification was not enqueued';
  end if;
end;
$$;

rollback;
