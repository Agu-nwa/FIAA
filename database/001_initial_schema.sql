-- FIAA Evolution production schema (PostgreSQL 15+)
-- Commercial records remain private until publication_status = 'published'
-- and every required approval field has been supplied.

begin;

create extension if not exists pgcrypto;

create table product_categories (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  name text not null unique,
  parent_id uuid references product_categories(id) on delete restrict,
  position integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table products (
  id uuid primary key default gen_random_uuid(),
  sku text not null unique,
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  name text not null,
  product_kind text not null check (product_kind in ('brake_pad','brake_shoe','fitting_kit','accessory')),
  category_id uuid not null references product_categories(id) on delete restrict,
  short_description text,
  description text,
  axle_position text check (axle_position in ('front','rear','front_or_rear','not_applicable')),
  width_mm numeric(8,2) check (width_mm > 0),
  height_mm numeric(8,2) check (height_mm > 0),
  thickness_mm numeric(8,2) check (thickness_mm > 0),
  warranty_text text,
  publication_status text not null default 'draft' check (publication_status in ('draft','review','approved','published','archived')),
  owner_verified_at timestamptz,
  owner_verified_by text,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint published_product_is_verified check (
    publication_status <> 'published' or (
      owner_verified_at is not null and
      owner_verified_by is not null and
      short_description is not null
    )
  )
);

create index products_publication_idx on products(publication_status, product_kind);
create index products_category_idx on products(category_id);

create table product_oem_references (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id) on delete cascade,
  reference text not null,
  manufacturer text,
  created_at timestamptz not null default now(),
  unique(product_id, reference)
);

create index product_oem_reference_search_idx on product_oem_references(lower(reference));

create table product_images (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id) on delete cascade,
  storage_key text not null unique,
  alt_text text not null,
  image_role text not null default 'gallery' check (image_role in ('primary','gallery','packaging','dimension_diagram')),
  width_px integer check (width_px > 0),
  height_px integer check (height_px > 0),
  mime_type text not null check (mime_type in ('image/jpeg','image/png','image/webp','image/avif')),
  checksum_sha256 text,
  position integer not null default 0,
  owner_verified_at timestamptz,
  created_at timestamptz not null default now(),
  unique(product_id, image_role, position)
);

create unique index one_primary_image_per_product on product_images(product_id) where image_role = 'primary';

create table vehicle_makes (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  slug text not null unique,
  created_at timestamptz not null default now()
);

create table vehicle_models (
  id uuid primary key default gen_random_uuid(),
  make_id uuid not null references vehicle_makes(id) on delete restrict,
  name text not null,
  slug text not null,
  created_at timestamptz not null default now(),
  unique(make_id, name),
  unique(make_id, slug)
);

create table product_fitments (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id) on delete cascade,
  model_id uuid not null references vehicle_models(id) on delete restrict,
  year_from smallint check (year_from between 1900 and 2200),
  year_to smallint check (year_to between 1900 and 2200),
  engine text,
  trim text,
  body_style text,
  axle_position text check (axle_position in ('front','rear','front_or_rear')),
  notes text,
  source_reference text not null,
  owner_verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint valid_fitment_years check (year_from is null or year_to is null or year_to >= year_from)
);

create index product_fitments_vehicle_idx on product_fitments(model_id, year_from, year_to);
create index product_fitments_product_idx on product_fitments(product_id);

create table product_prices (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id) on delete cascade,
  currency char(3) not null default 'NGN',
  amount_minor bigint not null check (amount_minor >= 0),
  valid_from timestamptz not null default now(),
  valid_until timestamptz,
  approved_at timestamptz not null,
  approved_by text not null,
  created_at timestamptz not null default now(),
  constraint valid_price_period check (valid_until is null or valid_until > valid_from)
);

create unique index one_current_price_per_product on product_prices(product_id, currency) where valid_until is null;

create table inventory_locations (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  address_text text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table inventory (
  product_id uuid not null references products(id) on delete restrict,
  location_id uuid not null references inventory_locations(id) on delete restrict,
  quantity_on_hand integer not null default 0 check (quantity_on_hand >= 0),
  quantity_reserved integer not null default 0 check (quantity_reserved >= 0 and quantity_reserved <= quantity_on_hand),
  reorder_level integer not null default 0 check (reorder_level >= 0),
  updated_at timestamptz not null default now(),
  primary key(product_id, location_id)
);

create table customers (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  phone_e164 text not null check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  email text,
  marketing_consent boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index customers_phone_idx on customers(phone_e164);
create index customers_email_idx on customers(lower(email)) where email is not null;

create table customer_addresses (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers(id) on delete cascade,
  label text,
  recipient_name text not null,
  phone_e164 text not null,
  line1 text not null,
  line2 text,
  city text not null,
  state text not null,
  country_code char(2) not null default 'NG',
  delivery_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table carts (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references customers(id) on delete set null,
  anonymous_token_hash text unique,
  status text not null default 'active' check (status in ('active','converted','abandoned','expired')),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cart_has_owner check (customer_id is not null or anonymous_token_hash is not null)
);

create table cart_items (
  cart_id uuid not null references carts(id) on delete cascade,
  product_id uuid not null references products(id) on delete restrict,
  quantity integer not null check (quantity > 0 and quantity <= 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(cart_id, product_id)
);

create table delivery_methods (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  description text,
  fee_minor bigint not null default 0 check (fee_minor >= 0),
  currency char(3) not null default 'NGN',
  estimated_min_days smallint check (estimated_min_days >= 0),
  estimated_max_days smallint check (estimated_max_days >= estimated_min_days),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create sequence order_number_seq start 1000;

create table orders (
  id uuid primary key default gen_random_uuid(),
  order_number text not null unique default ('FIAA-' || to_char(current_date, 'YYYYMMDD') || '-' || lpad(nextval('order_number_seq')::text, 6, '0')),
  customer_id uuid not null references customers(id) on delete restrict,
  delivery_address_id uuid references customer_addresses(id) on delete restrict,
  delivery_method_id uuid not null references delivery_methods(id) on delete restrict,
  status text not null default 'pending_payment' check (status in ('pending_payment','paid','processing','ready_for_pickup','shipped','delivered','cancelled','refunded')),
  currency char(3) not null default 'NGN',
  subtotal_minor bigint not null check (subtotal_minor >= 0),
  delivery_minor bigint not null default 0 check (delivery_minor >= 0),
  discount_minor bigint not null default 0 check (discount_minor >= 0),
  total_minor bigint not null check (total_minor >= 0),
  customer_note text,
  internal_note text,
  placed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint correct_order_total check (total_minor = subtotal_minor + delivery_minor - discount_minor)
);

create index orders_customer_idx on orders(customer_id, created_at desc);
create index orders_status_idx on orders(status, created_at desc);

create table order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete restrict,
  product_id uuid not null references products(id) on delete restrict,
  sku_snapshot text not null,
  name_snapshot text not null,
  unit_price_minor bigint not null check (unit_price_minor >= 0),
  quantity integer not null check (quantity > 0),
  line_total_minor bigint not null check (line_total_minor = unit_price_minor * quantity),
  fitment_snapshot jsonb,
  created_at timestamptz not null default now()
);

create table payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete restrict,
  provider text not null,
  provider_reference text unique,
  status text not null default 'initiated' check (status in ('initiated','pending','successful','failed','cancelled','partially_refunded','refunded')),
  amount_minor bigint not null check (amount_minor >= 0),
  currency char(3) not null default 'NGN',
  idempotency_key text not null unique,
  provider_payload jsonb,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index payments_order_idx on payments(order_id, created_at desc);

create table shipments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete restrict,
  carrier text,
  tracking_number text,
  status text not null default 'pending' check (status in ('pending','ready','collected','in_transit','delivered','returned','cancelled')),
  shipped_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table content_pages (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  page_type text not null check (page_type in ('guide','policy','support','company')),
  excerpt text,
  body_html text not null,
  publication_status text not null default 'draft' check (publication_status in ('draft','review','published','archived')),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table staff_profiles (
  id uuid primary key default gen_random_uuid(),
  auth_subject text not null unique,
  full_name text not null,
  role text not null check (role in ('owner','catalogue_manager','order_manager','content_manager','support')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table audit_log (
  id bigint generated always as identity primary key,
  staff_id uuid references staff_profiles(id) on delete set null,
  entity_type text not null,
  entity_id text not null,
  action text not null,
  before_data jsonb,
  after_data jsonb,
  request_id text,
  created_at timestamptz not null default now()
);

create index audit_log_entity_idx on audit_log(entity_type, entity_id, created_at desc);

create function set_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'product_categories','products','product_fitments','inventory','customers',
    'customer_addresses','carts','cart_items','delivery_methods','orders',
    'payments','shipments','content_pages','staff_profiles'
  ] loop
    execute format('create trigger %I before update on %I for each row execute function set_updated_at()', table_name || '_set_updated_at', table_name);
  end loop;
end;
$$;

-- Public storefront queries must use this view, which excludes every
-- unapproved or unpublished product and requires an approved current price.
create view storefront_products as
select
  p.id,
  p.sku,
  p.slug,
  p.name,
  p.product_kind,
  p.category_id,
  p.short_description,
  p.description,
  p.axle_position,
  p.width_mm,
  p.height_mm,
  p.thickness_mm,
  pp.currency,
  pp.amount_minor,
  coalesce(sum(i.quantity_on_hand - i.quantity_reserved), 0)::integer as available_quantity
from products p
join product_prices pp on pp.product_id = p.id and pp.valid_until is null
left join inventory i on i.product_id = p.id
where p.publication_status = 'published'
group by p.id, pp.currency, pp.amount_minor;

commit;
