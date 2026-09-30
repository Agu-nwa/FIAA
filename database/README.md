# Production data foundation

The schema in `001_initial_schema.sql` is designed for PostgreSQL 15 or newer. It separates catalogue facts, fitment, imagery, pricing and inventory so that none of those concerns has to be inferred from customer-facing text.

## Publication safety

- Products begin as `draft`.
- A product cannot be marked `published` without owner verification and a description.
- The storefront reads only from `storefront_products`.
- `storefront_products` requires a published product and an approved current price.
- Images carry independent owner verification timestamps.
- Vehicle fitments store a source reference and independent approval timestamp.
- Price history is preserved rather than overwritten.
- Inventory keeps on-hand and reserved quantities separately.

## Commerce integrity

- Cart ownership works for customers and anonymous sessions.
- Orders store immutable product and price snapshots.
- Order totals are protected by database constraints.
- Payment requests use unique idempotency keys.
- Delivery and payment statuses use constrained state values.
- Staff actions can be recorded in the audit log.
- Staff authentication is intentionally delegated to an identity provider; this database does not store passwords.

## Before applying the migration

1. Select the production hosting and database provider.
2. Store database credentials only in server-side environment variables.
3. Run the migration using a least-privilege deployment role.
4. Configure automated backups and point-in-time recovery.
5. Add application-level authorization and row-level security policies appropriate to the selected platform.
6. Load only owner-approved rows from the Phase 1 verification registers.

The unified Fastify process connects the storefront and commerce API to these governed projections and functions. Public routes use only the `fiaa_api` identity; administration and workers use separate credentials described below.

## Storefront discovery

Apply `002_storefront_discovery.sql` after the initial schema. It adds:

- exact FIAA SKU and OEM-reference matching;
- full-text and typo-tolerant product search;
- independent make, model, year and axle filters;
- ranking that prioritizes exact catalogue identifiers;
- a product-detail projection containing only owner-verified images and fitments;
- a maximum page size of 100 results.

Both storefront views inherit the publication gate from `storefront_products`; draft and review records cannot appear in their results.

## Server-side cart

Apply `003_cart_service.sql` after the discovery migration. The cart service:

- stores anonymous carts server-side using only a hash of the browser token;
- rejects expired carts and invalid access tokens;
- accepts only published products with approved current prices;
- checks live available inventory whenever quantity changes;
- rejects overselling and quantities outside the permitted range;
- calculates totals from server-side prices rather than browser values;
- removes lines by setting quantity to zero;
- provides an expiry job for abandoned-cart cleanup.

Application roles receive access to these functions explicitly during deployment. They are revoked from PostgreSQL's public role by default.

## Checkout and order reservation

Apply `004_checkout_orders.sql` after the cart service. It provides:

- idempotent order creation, preventing duplicate orders from repeat taps or retries;
- customer and delivery-address capture with required-address enforcement;
- immutable SKU, name, fitment and price snapshots in order lines;
- inventory allocation across one or more locations under row locks;
- expiring stock reservations for pending payments;
- exact amount and currency enforcement for verified payment callbacks;
- reservation commitment after successful payment;
- safe cancellation and release of unpaid stock;
- scheduled cleanup for expired payment windows.

Payment-provider webhook signatures must be verified by the application before `record_verified_payment` is called. The database function deliberately cannot verify provider-specific cryptography.

## Transactional notifications

Apply `005_notification_outbox.sql` after checkout. It adds a durable outbox for:

- order creation confirmations;
- order-status updates;
- successful-payment receipts;
- shipment and tracking updates.

Workers claim jobs using row locks and leases, so multiple workers can run safely. Failed sends use exponential retry delays, abandoned leases are recovered, jobs stop after eight attempts, and only the worker holding a lease can complete or fail it. Provider credentials and message delivery stay in the server worker, never in PostgreSQL or the browser.

## Administration and publication governance

Apply `006_admin_governance.sql` after notifications. It adds:

- authenticated staff context mapped to active staff profiles;
- role checks for owner and catalogue-manager operations;
- controlled draft → review → approval → publication transitions;
- owner-only product approval and publication;
- database rejection of products missing approved price, verified primary image, inventory, fitment, OEM reference, axle position or brake dimensions;
- structured publication-problem reporting for the admin interface;
- audit history for products, images, fitments, prices, inventory and orders.

The application must set `app.auth_subject` from a verified server-side identity session. It must never accept that value directly from a browser request.

## Customer information and policy content

Apply `007_content_governance.sql` after administration governance. It adds:

- immutable content versions and editor change summaries;
- content-manager drafting with owner-only publication;
- renewed owner approval whenever published text changes;
- SEO title and description validation;
- public views containing only approved versions;
- a launch-readiness view for delivery, returns, warranty, privacy, terms, contact and about pages.

The migration does not invent FIAA's commercial policies. The real policy wording must be supplied and approved by FIAA before those required pages become launch-ready.

## Customer order access

Apply `008_customer_order_access.sql` after content governance. It stores only hashes of high-entropy order tokens, assigns one token during idempotent checkout, and exposes a customer-safe order projection only when the private token is valid. An order number by itself never authorizes access.

## Runtime roles

Apply `009_application_roles.sql` after customer order access. It creates non-login group roles for the public API, background worker and administration service, revokes PostgreSQL `public` access, and grants each runtime only its required projections and functions. Deployment creates separate login roles and assigns them to these groups; credentials never belong in migrations.

Apply `010_delivery_discovery.sql` after runtime roles. It exposes only active, owner-configured delivery methods and their approved fees to the checkout interface.

Apply `011_order_governance.sql` after delivery discovery. It adds audited, role-restricted fulfilment transitions, prevents staff from bypassing verified payment/refund processing, rejects invalid workflow jumps, and requires a carrier plus tracking number before an order can be marked shipped.

Apply `012_shipment_governance.sql` after order governance. It provides role-restricted carrier/tracking creation, validates shipment status transitions, records dispatch/delivery timestamps, writes audit evidence and activates the existing shipment notification outbox trigger.
