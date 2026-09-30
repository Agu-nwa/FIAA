\set ON_ERROR_STOP on

begin;

insert into staff_profiles(auth_subject, full_name, role)
values ('content-owner', 'Content Owner', 'owner'), ('content-editor', 'Content Editor', 'content_manager');

do $$
declare
  page_record content_pages;
  rejected boolean;
  problems jsonb;
  missing_count integer;
begin
  perform set_config('app.auth_subject', 'content-editor', true);
  page_record := admin_save_content(
    null, 'delivery', 'Delivery information', 'policy',
    'How FIAA delivers customer orders.',
    '<p>FIAA Evolution confirms each order, delivery destination, delivery charge and estimated delivery window before dispatch. Customers receive an order reference and are contacted if delivery circumstances change. Orders must be inspected promptly after delivery, and any visible transit issue should be reported to FIAA using the official contact details supplied with the order.</p>',
    'Delivery information | FIAA Evolution',
    'Read how FIAA Evolution confirms delivery charges, destinations, dispatch timing and customer order updates.',
    'Initial reviewed delivery policy'
  );
  if page_record.current_version <> 1 or page_record.publication_status <> 'draft' then
    raise exception 'Initial content version was not created correctly';
  end if;

  rejected := false;
  begin
    perform admin_publish_content(page_record.id, 'Editor attempted publication');
  exception when insufficient_privilege then
    rejected := true;
  end;
  if not rejected then
    raise exception 'Content editor published a policy';
  end if;

  perform set_config('app.auth_subject', 'content-owner', true);
  page_record := admin_publish_content(page_record.id, 'Owner approved delivery policy');
  if page_record.publication_status <> 'published' then
    raise exception 'Owner could not publish complete content';
  end if;
  if not exists(select 1 from public_content_pages where slug = 'delivery') then
    raise exception 'Published content is missing from public view';
  end if;
  if (select status from content_launch_readiness where slug = 'delivery') <> 'ready' then
    raise exception 'Launch readiness did not recognize published delivery page';
  end if;

  page_record := admin_save_content(
    page_record.id, 'delivery', 'Delivery information', 'policy',
    'Updated FIAA delivery information.',
    '<p>FIAA Evolution confirms each order, destination, delivery charge and delivery window before dispatch. The customer receives an order reference and status updates. Changes to an approved delivery address must be confirmed by FIAA before dispatch, and visible transit issues should be reported promptly through official support channels.</p>',
    'Delivery information | FIAA Evolution',
    'Understand FIAA Evolution delivery confirmation, charges, dispatch timing, address changes and support.',
    'Clarified address-change process'
  );
  if page_record.current_version <> 2 or page_record.publication_status <> 'review' then
    raise exception 'Editing published content did not create a review version';
  end if;
  if exists(select 1 from public_content_pages where slug = 'delivery') then
    raise exception 'Unapproved edited content remained public';
  end if;

  problems := content_publication_problems(page_record.id);
  if not (problems ? 'Missing owner verification') then
    raise exception 'Edited content did not require renewed owner verification';
  end if;

  select count(*) into missing_count from content_launch_readiness where status = 'missing';
  if missing_count <> 7 then
    raise exception 'Expected all seven required pages to be missing after unpublishing, found %', missing_count;
  end if;
end;
$$;

rollback;
