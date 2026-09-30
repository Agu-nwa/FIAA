\set ON_ERROR_STOP on

do $$
begin
  if not has_function_privilege('fiaa_api','record_verified_payment(uuid,text,text,text,bigint,character,jsonb)','execute') then
    raise exception 'API cannot record verified payments';
  end if;
  if has_function_privilege('fiaa_api','claim_notification_jobs(text,integer,interval)','execute') then
    raise exception 'API can claim notification jobs';
  end if;
  if not has_function_privilege('fiaa_worker','claim_notification_jobs(text,integer,interval)','execute') then
    raise exception 'Worker cannot claim notification jobs';
  end if;
  if not has_function_privilege('fiaa_worker','release_expired_order_reservations()','execute') or
     not has_function_privilege('fiaa_worker','purge_expired_carts()','execute') then
    raise exception 'Worker cannot run commerce maintenance';
  end if;
  if has_table_privilege('fiaa_api','customers','select') then
    raise exception 'API has direct customer-table access';
  end if;
end;
$$;
