-- Least-privilege group roles for runtime services. Login credentials are provisioned outside SQL migrations.
begin;

do $$ begin
  if not exists(select 1 from pg_roles where rolname='fiaa_api') then create role fiaa_api nologin; end if;
  if not exists(select 1 from pg_roles where rolname='fiaa_worker') then create role fiaa_worker nologin; end if;
  if not exists(select 1 from pg_roles where rolname='fiaa_admin') then create role fiaa_admin nologin; end if;
end $$;

revoke all on all tables in schema public from public;
revoke all on all sequences in schema public from public;
revoke all on all functions in schema public from public;
grant usage on schema public to fiaa_api, fiaa_worker, fiaa_admin;

grant select on storefront_products, storefront_product_details, public_content_pages to fiaa_api;
grant execute on function search_storefront(text,text,text,smallint,text,integer,integer) to fiaa_api;
grant execute on function create_anonymous_cart(text,interval), get_anonymous_cart(uuid,text), set_cart_item(uuid,text,text,integer) to fiaa_api;
grant execute on function create_customer_checkout(uuid,text,text,text,text,text,text,text,text,text,text,text,text,text,interval,interval) to fiaa_api;
grant execute on function get_customer_order(text,text) to fiaa_api;
grant execute on function record_verified_payment(uuid,text,text,text,bigint,char,jsonb) to fiaa_api;

grant execute on function claim_notification_jobs(text,integer,interval), complete_notification_job(bigint,text,text), fail_notification_job(bigint,text,text) to fiaa_worker;
grant execute on function release_expired_order_reservations() to fiaa_worker;
grant execute on function purge_expired_carts() to fiaa_worker;

grant select, insert, update on all tables in schema public to fiaa_admin;
grant usage, select on all sequences in schema public to fiaa_admin;
grant execute on all functions in schema public to fiaa_admin;

alter default privileges in schema public revoke all on tables from public;
alter default privileges in schema public revoke all on functions from public;
commit;
