-- FIAA Evolution storefront discovery and product-detail projections.
-- Apply after 001_initial_schema.sql.

begin;

create extension if not exists pg_trgm;

create view storefront_search_documents as
select
  sp.id,
  sp.sku,
  sp.slug,
  sp.name,
  sp.product_kind,
  sp.category_id,
  pc.name as category_name,
  sp.short_description,
  sp.axle_position,
  sp.currency,
  sp.amount_minor,
  sp.available_quantity,
  coalesce(oem.references, '') as oem_references,
  coalesce(fitment.make_names, '') as make_names,
  coalesce(fitment.model_names, '') as model_names,
  coalesce(fitment.fitment_text, '') as fitment_text,
  setweight(to_tsvector('simple', coalesce(sp.sku, '')), 'A') ||
  setweight(to_tsvector('simple', coalesce(oem.references, '')), 'A') ||
  setweight(to_tsvector('simple', coalesce(sp.name, '')), 'B') ||
  setweight(to_tsvector('simple', coalesce(fitment.make_names, '') || ' ' || coalesce(fitment.model_names, '')), 'B') ||
  setweight(to_tsvector('simple', coalesce(sp.short_description, '') || ' ' || coalesce(fitment.fitment_text, '')), 'C') as search_vector
from storefront_products sp
join product_categories pc on pc.id = sp.category_id and pc.is_active = true
left join lateral (
  select string_agg(por.reference, ' ' order by por.reference) as references
  from product_oem_references por
  where por.product_id = sp.id
) oem on true
left join lateral (
  select
    string_agg(distinct vmk.name, ' ' order by vmk.name) as make_names,
    string_agg(distinct vmo.name, ' ' order by vmo.name) as model_names,
    string_agg(
      concat_ws(' ', vmk.name, vmo.name, pf.year_from::text, pf.year_to::text, pf.engine, pf.trim, pf.body_style, pf.axle_position, pf.notes),
      ' | ' order by concat_ws(' ', vmk.name, vmo.name, pf.year_from::text, pf.year_to::text)
    ) as fitment_text
  from product_fitments pf
  join vehicle_models vmo on vmo.id = pf.model_id
  join vehicle_makes vmk on vmk.id = vmo.make_id
  where pf.product_id = sp.id and pf.owner_verified_at is not null
) fitment on true;

create function normalize_catalogue_key(value text) returns text
language sql immutable strict parallel safe as $$
  select regexp_replace(lower(value), '[^a-z0-9]+', '', 'g');
$$;

create function search_storefront(
  query_text text default null,
  make_filter text default null,
  model_filter text default null,
  year_filter smallint default null,
  axle_filter text default null,
  result_limit integer default 24,
  result_offset integer default 0
)
returns table (
  id uuid,
  sku text,
  slug text,
  name text,
  product_kind text,
  category_name text,
  short_description text,
  axle_position text,
  currency char(3),
  amount_minor bigint,
  available_quantity integer,
  matched_vehicles text,
  relevance numeric
)
language plpgsql stable as $$
declare
  safe_query text := nullif(trim(query_text), '');
  query_terms tsquery;
begin
  if safe_query is not null then
    query_terms := websearch_to_tsquery('simple', safe_query);
  end if;

  return query
  select
    doc.id,
    doc.sku,
    doc.slug,
    doc.name,
    doc.product_kind,
    doc.category_name,
    doc.short_description,
    doc.axle_position,
    doc.currency,
    doc.amount_minor,
    doc.available_quantity,
    doc.fitment_text,
    (
      case
        when safe_query is null then 0
        when normalize_catalogue_key(doc.sku) = normalize_catalogue_key(safe_query) then 100
        when normalize_catalogue_key(doc.oem_references) = normalize_catalogue_key(safe_query) then 90
        when normalize_catalogue_key(doc.sku) like normalize_catalogue_key(safe_query) || '%' then 70
        else 0
      end +
      case when query_terms is null then 0 else ts_rank_cd(doc.search_vector, query_terms, 32) * 40 end +
      case when safe_query is null then 0 else greatest(
        similarity(lower(doc.name), lower(safe_query)),
        similarity(lower(doc.sku), lower(safe_query)),
        similarity(lower(doc.model_names), lower(safe_query))
      ) * 20 end
    )::numeric as relevance
  from storefront_search_documents doc
  where
    (safe_query is null or doc.search_vector @@ query_terms or
      similarity(lower(doc.name), lower(safe_query)) > 0.18 or
      similarity(lower(doc.sku), lower(safe_query)) > 0.18 or
      normalize_catalogue_key(doc.oem_references) like '%' || normalize_catalogue_key(safe_query) || '%')
    and (make_filter is null or lower(doc.make_names) like '%' || lower(trim(make_filter)) || '%')
    and (model_filter is null or lower(doc.model_names) like '%' || lower(trim(model_filter)) || '%')
    and (axle_filter is null or doc.axle_position = lower(trim(axle_filter)))
    and (
      year_filter is null or exists (
        select 1
        from product_fitments pf
        where pf.product_id = doc.id
          and pf.owner_verified_at is not null
          and (pf.year_from is null or pf.year_from <= year_filter)
          and (pf.year_to is null or pf.year_to >= year_filter)
      )
    )
  order by relevance desc, doc.name asc
  limit least(greatest(result_limit, 1), 100)
  offset greatest(result_offset, 0);
end;
$$;

create view storefront_product_details as
select
  sp.*,
  pc.name as category_name,
  pc.slug as category_slug,
  coalesce(images.items, '[]'::jsonb) as images,
  coalesce(oems.items, '[]'::jsonb) as oem_references,
  coalesce(fitments.items, '[]'::jsonb) as fitments
from storefront_products sp
join product_categories pc on pc.id = sp.category_id and pc.is_active = true
left join lateral (
  select jsonb_agg(
    jsonb_build_object(
      'storageKey', pi.storage_key,
      'alt', pi.alt_text,
      'role', pi.image_role,
      'width', pi.width_px,
      'height', pi.height_px,
      'mimeType', pi.mime_type
    ) order by case pi.image_role when 'primary' then 0 when 'packaging' then 1 else 2 end, pi.position
  ) as items
  from product_images pi
  where pi.product_id = sp.id and pi.owner_verified_at is not null
) images on true
left join lateral (
  select jsonb_agg(
    jsonb_build_object('reference', por.reference, 'manufacturer', por.manufacturer)
    order by por.reference
  ) as items
  from product_oem_references por
  where por.product_id = sp.id
) oems on true
left join lateral (
  select jsonb_agg(
    jsonb_build_object(
      'make', vmk.name,
      'model', vmo.name,
      'yearFrom', pf.year_from,
      'yearTo', pf.year_to,
      'engine', pf.engine,
      'trim', pf.trim,
      'bodyStyle', pf.body_style,
      'position', pf.axle_position,
      'notes', pf.notes
    ) order by vmk.name, vmo.name, pf.year_from nulls first
  ) as items
  from product_fitments pf
  join vehicle_models vmo on vmo.id = pf.model_id
  join vehicle_makes vmk on vmk.id = vmo.make_id
  where pf.product_id = sp.id and pf.owner_verified_at is not null
) fitments on true;

comment on function search_storefront is
'Searches only approved published products. Exact FIAA SKU and OEM matches rank above product, make and model text matches; structured vehicle filters are applied independently.';

commit;
