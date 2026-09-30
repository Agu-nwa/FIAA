-- FIAA Evolution policy, guide and customer-information governance.
-- Apply after 006_admin_governance.sql.

begin;

alter table content_pages
  add column meta_title text,
  add column meta_description text,
  add column owner_verified_at timestamptz,
  add column owner_verified_by text,
  add column current_version integer not null default 1 check (current_version > 0);

create table content_page_versions (
  id uuid primary key default gen_random_uuid(),
  page_id uuid not null references content_pages(id) on delete restrict,
  version integer not null check (version > 0),
  title text not null,
  excerpt text,
  body_html text not null,
  meta_title text,
  meta_description text,
  change_summary text not null,
  created_by uuid references staff_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique(page_id, version)
);

create table required_content_pages (
  slug text primary key,
  page_type text not null check (page_type in ('guide','policy','support','company')),
  display_name text not null,
  required_for_launch boolean not null default true,
  position integer not null default 0
);

insert into required_content_pages(slug, page_type, display_name, position) values
  ('delivery', 'policy', 'Delivery information', 10),
  ('returns-refunds', 'policy', 'Returns and refunds', 20),
  ('warranty', 'policy', 'Warranty', 30),
  ('privacy', 'policy', 'Privacy policy', 40),
  ('terms', 'policy', 'Terms and conditions', 50),
  ('contact', 'support', 'Contact FIAA', 60),
  ('about', 'company', 'About FIAA Evolution', 70);

create or replace function content_publication_problems(requested_page_id uuid)
returns jsonb
language sql stable
set search_path = public, pg_temp as $$
  with page_record as (
    select * from content_pages where id = requested_page_id
  ), checks as (
    select problem from page_record p
    cross join lateral (
      values
        (case when nullif(trim(p.title), '') is null then 'Missing title' end),
        (case when length(trim(p.body_html)) < 120 then 'Body content is incomplete' end),
        (case when nullif(trim(p.meta_title), '') is null then 'Missing SEO title' end),
        (case when length(coalesce(p.meta_title, '')) > 60 then 'SEO title exceeds 60 characters' end),
        (case when nullif(trim(p.meta_description), '') is null then 'Missing SEO description' end),
        (case when length(coalesce(p.meta_description, '')) > 160 then 'SEO description exceeds 160 characters' end),
        (case when p.owner_verified_at is null or p.owner_verified_by is null then 'Missing owner verification' end),
        (case when not exists (
          select 1 from content_page_versions cpv
          where cpv.page_id = p.id and cpv.version = p.current_version
        ) then 'Missing immutable content version' end)
    ) as required(problem)
    where problem is not null
  )
  select coalesce(jsonb_agg(problem order by problem), '[]'::jsonb) from checks;
$$;

create or replace function enforce_content_publication()
returns trigger
language plpgsql
set search_path = public, pg_temp as $$
declare
  problems jsonb;
begin
  if new.publication_status = 'published' then
    problems := content_publication_problems(new.id);
    if jsonb_array_length(problems) > 0 then
      raise exception 'Content page cannot be published: %', problems using errcode = '23514';
    end if;
  end if;
  return null;
end;
$$;

create constraint trigger content_pages_enforce_publication
after insert or update of publication_status on content_pages
deferrable initially immediate
for each row execute function enforce_content_publication();

create or replace function admin_save_content(
  requested_page_id uuid,
  requested_slug text,
  requested_title text,
  requested_page_type text,
  requested_excerpt text,
  requested_body_html text,
  requested_meta_title text,
  requested_meta_description text,
  change_summary text
)
returns content_pages
language plpgsql security definer
set search_path = public, pg_temp as $$
declare
  staff staff_profiles := require_staff_role(array['owner','content_manager']);
  page_record content_pages;
  next_version integer;
begin
  if nullif(trim(change_summary), '') is null then
    raise exception 'A change summary is required' using errcode = '22023';
  end if;
  if requested_page_type not in ('guide','policy','support','company') then
    raise exception 'Unsupported page type' using errcode = '22023';
  end if;
  if requested_page_id is null then
    insert into content_pages(
      slug, title, page_type, excerpt, body_html, meta_title, meta_description,
      publication_status, current_version
    ) values (
      requested_slug, requested_title, requested_page_type, requested_excerpt,
      requested_body_html, requested_meta_title, requested_meta_description, 'draft', 1
    ) returning * into page_record;
    next_version := 1;
  else
    select * into page_record from content_pages where id = requested_page_id for update;
    if not found then
      raise exception 'Content page not found' using errcode = 'P0001';
    end if;
    next_version := page_record.current_version + 1;
    update content_pages
    set slug = requested_slug,
        title = requested_title,
        page_type = requested_page_type,
        excerpt = requested_excerpt,
        body_html = requested_body_html,
        meta_title = requested_meta_title,
        meta_description = requested_meta_description,
        current_version = next_version,
        publication_status = case when publication_status = 'published' then 'review' else publication_status end,
        owner_verified_at = null,
        owner_verified_by = null,
        published_at = case when publication_status = 'published' then null else published_at end
    where id = requested_page_id
    returning * into page_record;
  end if;

  insert into content_page_versions(
    page_id, version, title, excerpt, body_html, meta_title, meta_description,
    change_summary, created_by
  ) values (
    page_record.id, next_version, page_record.title, page_record.excerpt,
    page_record.body_html, page_record.meta_title, page_record.meta_description,
    trim(change_summary), staff.id
  );
  return page_record;
end;
$$;

create or replace function admin_publish_content(
  requested_page_id uuid,
  approval_reason text
)
returns content_pages
language plpgsql security definer
set search_path = public, pg_temp as $$
declare
  staff staff_profiles := require_staff_role(array['owner']);
  page_record content_pages;
begin
  if nullif(trim(approval_reason), '') is null then
    raise exception 'Approval reason is required' using errcode = '22023';
  end if;
  update content_pages
  set owner_verified_at = now(), owner_verified_by = staff.full_name,
      publication_status = 'published', published_at = now()
  where id = requested_page_id
  returning * into page_record;
  if not found then
    raise exception 'Content page not found' using errcode = 'P0001';
  end if;
  insert into audit_log(staff_id, entity_type, entity_id, action, after_data)
  values (
    staff.id, 'content_pages', page_record.id::text, 'publish',
    jsonb_build_object('version', page_record.current_version, 'reason', trim(approval_reason))
  );
  return page_record;
end;
$$;

create trigger content_pages_audit
after insert or update or delete on content_pages
for each row execute function audit_data_change();

create view public_content_pages as
select slug, title, page_type, excerpt, body_html, meta_title, meta_description,
  current_version, published_at, updated_at
from content_pages
where publication_status = 'published' and owner_verified_at is not null;

create view content_launch_readiness as
select
  required.slug,
  required.display_name,
  case when page.slug is not null then 'ready' else 'missing' end as status,
  page.current_version,
  page.published_at
from required_content_pages required
left join public_content_pages page on page.slug = required.slug
where required.required_for_launch = true
order by required.position;

revoke all on function admin_save_content(uuid,text,text,text,text,text,text,text,text) from public;
revoke all on function admin_publish_content(uuid,text) from public;

comment on view content_launch_readiness is
'Lists every mandatory customer-information page and whether an owner-approved public version exists.';

commit;
