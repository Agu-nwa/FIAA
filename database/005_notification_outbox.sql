-- FIAA Evolution transactional notification outbox.
-- Apply after 004_checkout_orders.sql.

begin;

create table notification_outbox (
  id bigint generated always as identity primary key,
  event_key text not null unique,
  event_type text not null check (event_type in (
    'order.created','order.status_changed','payment.successful','shipment.status_changed'
  )),
  aggregate_type text not null check (aggregate_type in ('order','payment','shipment')),
  aggregate_id uuid not null,
  channel text not null check (channel in ('email','whatsapp','sms','internal')),
  recipient text,
  template_key text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending','processing','sent','failed','cancelled')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  sent_at timestamptz,
  last_error text,
  provider_message_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index notification_outbox_claim_idx
on notification_outbox(status, available_at, id)
where status in ('pending','failed');

create trigger notification_outbox_set_updated_at
before update on notification_outbox
for each row execute function set_updated_at();

create or replace function enqueue_order_notification()
returns trigger
language plpgsql
set search_path = public, pg_temp as $$
declare
  customer_record customers;
  status_event_key text;
begin
  select * into customer_record from customers where id = new.customer_id;

  if tg_op = 'INSERT' then
    insert into notification_outbox(
      event_key, event_type, aggregate_type, aggregate_id, channel,
      recipient, template_key, payload
    ) values (
      'order-created:' || new.id, 'order.created', 'order', new.id, 'whatsapp',
      customer_record.phone_e164, 'order-created',
      jsonb_build_object('orderId', new.id, 'orderNumber', new.order_number, 'status', new.status)
    ) on conflict (event_key) do nothing;

    if customer_record.email is not null then
      insert into notification_outbox(
        event_key, event_type, aggregate_type, aggregate_id, channel,
        recipient, template_key, payload
      ) values (
        'order-created-email:' || new.id, 'order.created', 'order', new.id, 'email',
        customer_record.email, 'order-created',
        jsonb_build_object('orderId', new.id, 'orderNumber', new.order_number, 'status', new.status)
      ) on conflict (event_key) do nothing;
    end if;
  elsif new.status is distinct from old.status then
    status_event_key := 'order-status:' || new.id || ':' || new.status;
    insert into notification_outbox(
      event_key, event_type, aggregate_type, aggregate_id, channel,
      recipient, template_key, payload
    ) values (
      status_event_key, 'order.status_changed', 'order', new.id, 'whatsapp',
      customer_record.phone_e164, 'order-status-' || replace(new.status, '_', '-'),
      jsonb_build_object(
        'orderId', new.id,
        'orderNumber', new.order_number,
        'previousStatus', old.status,
        'status', new.status
      )
    ) on conflict (event_key) do nothing;
  end if;
  return new;
end;
$$;

create trigger orders_enqueue_notification
after insert or update of status on orders
for each row execute function enqueue_order_notification();

create or replace function enqueue_payment_notification()
returns trigger
language plpgsql
set search_path = public, pg_temp as $$
declare
  order_record orders;
  customer_record customers;
begin
  if new.status = 'successful' then
    select * into order_record from orders where id = new.order_id;
    select * into customer_record from customers where id = order_record.customer_id;
    insert into notification_outbox(
      event_key, event_type, aggregate_type, aggregate_id, channel,
      recipient, template_key, payload
    ) values (
      'payment-successful:' || new.id, 'payment.successful', 'payment', new.id, 'whatsapp',
      customer_record.phone_e164, 'payment-successful',
      jsonb_build_object(
        'orderId', order_record.id,
        'orderNumber', order_record.order_number,
        'paymentId', new.id,
        'amountMinor', new.amount_minor,
        'currency', new.currency
      )
    ) on conflict (event_key) do nothing;
  end if;
  return new;
end;
$$;

create trigger payments_enqueue_notification
after insert or update of status on payments
for each row execute function enqueue_payment_notification();

create or replace function enqueue_shipment_notification()
returns trigger
language plpgsql
set search_path = public, pg_temp as $$
declare
  order_record orders;
  customer_record customers;
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    select * into order_record from orders where id = new.order_id;
    select * into customer_record from customers where id = order_record.customer_id;
    insert into notification_outbox(
      event_key, event_type, aggregate_type, aggregate_id, channel,
      recipient, template_key, payload
    ) values (
      'shipment-status:' || new.id || ':' || new.status,
      'shipment.status_changed', 'shipment', new.id, 'whatsapp',
      customer_record.phone_e164, 'shipment-status-' || replace(new.status, '_', '-'),
      jsonb_build_object(
        'orderId', order_record.id,
        'orderNumber', order_record.order_number,
        'shipmentId', new.id,
        'status', new.status,
        'carrier', new.carrier,
        'trackingNumber', new.tracking_number
      )
    ) on conflict (event_key) do nothing;
  end if;
  return new;
end;
$$;

create trigger shipments_enqueue_notification
after insert or update of status on shipments
for each row execute function enqueue_shipment_notification();

create or replace function claim_notification_jobs(
  worker_id text,
  batch_size integer default 20,
  lease_duration interval default interval '5 minutes'
)
returns setof notification_outbox
language plpgsql security definer
set search_path = public, pg_temp as $$
begin
  if nullif(trim(worker_id), '') is null then
    raise exception 'Worker identifier is required' using errcode = '22023';
  end if;
  if batch_size < 1 or batch_size > 100 then
    raise exception 'Batch size must be between 1 and 100' using errcode = '22023';
  end if;
  if lease_duration < interval '30 seconds' or lease_duration > interval '30 minutes' then
    raise exception 'Lease duration must be between 30 seconds and 30 minutes' using errcode = '22023';
  end if;

  -- Recover jobs abandoned by a dead worker before claiming new work.
  update notification_outbox
  set status = 'failed', locked_at = null, locked_by = null,
      available_at = now(), last_error = 'Worker lease expired'
  where status = 'processing' and locked_at < now() - lease_duration;

  return query
  with claimable as (
    select id
    from notification_outbox
    where status in ('pending','failed') and available_at <= now() and attempt_count < 8
    order by available_at, id
    for update skip locked
    limit batch_size
  )
  update notification_outbox job
  set status = 'processing', attempt_count = attempt_count + 1,
      locked_at = now(), locked_by = worker_id, last_error = null
  from claimable
  where job.id = claimable.id
  returning job.*;
end;
$$;

create or replace function complete_notification_job(
  job_id bigint,
  worker_id text,
  external_message_id text default null
)
returns notification_outbox
language plpgsql security definer
set search_path = public, pg_temp as $$
declare
  completed notification_outbox;
begin
  update notification_outbox
  set status = 'sent', sent_at = now(), provider_message_id = external_message_id,
      locked_at = null, locked_by = null
  where id = job_id and status = 'processing' and locked_by = worker_id
  returning * into completed;
  if not found then
    raise exception 'Notification job is not owned by this worker' using errcode = 'P0001';
  end if;
  return completed;
end;
$$;

create or replace function fail_notification_job(
  job_id bigint,
  worker_id text,
  error_message text
)
returns notification_outbox
language plpgsql security definer
set search_path = public, pg_temp as $$
declare
  failed notification_outbox;
begin
  update notification_outbox
  set status = case when attempt_count >= 8 then 'cancelled' else 'failed' end,
      available_at = now() + make_interval(secs => least(3600, (30 * power(2, greatest(attempt_count - 1, 0)))::integer)),
      last_error = left(coalesce(error_message, 'Unknown delivery error'), 2000),
      locked_at = null, locked_by = null
  where id = job_id and status = 'processing' and locked_by = worker_id
  returning * into failed;
  if not found then
    raise exception 'Notification job is not owned by this worker' using errcode = 'P0001';
  end if;
  return failed;
end;
$$;

revoke all on function claim_notification_jobs(text,integer,interval) from public;
revoke all on function complete_notification_job(bigint,text,text) from public;
revoke all on function fail_notification_job(bigint,text,text) from public;

comment on table notification_outbox is
'Durable transactional queue for customer notifications. Provider delivery happens outside the database through leased, retryable worker jobs.';

commit;
