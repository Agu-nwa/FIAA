# FIAA Evolution production commerce platform

Mobile-first FIAA storefront, commerce API and governed PostgreSQL catalogue. The public application never exposes draft products, inferred fitments, generated inventory, unapproved prices or unverified images.

## Current production status

The application and data-governance foundation are implemented, but launch is not approved yet. Thirty-nine transcribed or proposed records remain deliberately unpublished until FIAA verifies their commercial fields and supplies genuine product photography.

Authoritative verification registers:

- `data/catalogue-verification.csv`
- `data/accessories-verification.csv`
- `data/phase-1-business-verification.md`

## Implemented

- Responsive branded storefront and mobile navigation
- Approved product search by FIAA/OEM number, vehicle, year and axle position
- Owner-verified product images and fitments only
- Server-side anonymous carts with signed `HttpOnly` cookies
- Active delivery-method and approved-fee discovery
- Atomic idempotent checkout and inventory reservations
- Private token-authenticated customer order lookup using a path-scoped `HttpOnly`, `SameSite=Strict` cookie
- Idempotent payment-authorization and verified-webhook adapter boundaries with HTTPS, signature and exact amount/currency enforcement
- Durable retryable email/WhatsApp notification outbox
- Governed product and content publication workflows with audit history
- Separate least-privilege public API, worker and administration database roles
- OIDC/JWKS staff-token verification and separate administration credentials

## Not yet launch-ready

- FIAA approval of catalogue, prices, inventory, fitments and genuine product images
- Final delivery methods and charges
- Selected live payment provider and credentials
- Selected email and WhatsApp providers and approved templates
- Selected staff identity provider and provisioned owner accounts
- Owner-approved delivery, returns, warranty, privacy, terms, contact and company wording
- Hosting, production database, object storage, DNS, TLS, monitoring, analytics and backup credentials

These missing external decisions do not cause the application to fabricate substitutes. The corresponding public records or integrations remain unavailable until configured.
Production startup fails closed unless `PAYMENT_PROVIDER` names a registered approved adapter; checkout cannot silently create a dead-end unpaid order.

## Local API

Copy `.env.example` to a private environment file and provide a PostgreSQL database containing migrations `001` through `012`.

```bash
npm install
npm run dev
```

Serve the static frontend from `http://localhost:4173`. It calls the same-origin `/v1` API, so local deployment should proxy `/v1` to port `3000`.

## Verification

```bash
npm run validate
```

This checks publication registers, the OpenAPI contract and server tests. Database tests require an empty disposable PostgreSQL database:

```bash
DATABASE_URL=postgresql://localhost/fiaa_test npm run test:database
```

The database runner deliberately executes each regression test immediately after its corresponding migration. Later governance migrations enforce stricter invariants than early migration fixtures.

## Container

`Dockerfile` builds a non-root Node 24 image, installs only locked production dependencies, exposes the unified storefront/API on port `3000`, and checks database readiness. See `ops/DEPLOYMENT.md` for the provider-neutral release and launch runbook.

When PostgreSQL command-line tools are installed, `npm run test:database:local` creates an isolated temporary PostgreSQL cluster, runs every migration and staged database regression test, then removes the cluster. It never uses the developer's existing databases.

## Security boundaries

- `DATABASE_URL` must use a login inheriting only `fiaa_api`.
- `ADMIN_DATABASE_URL` must be a separate login inheriting `fiaa_admin` and is accepted only with complete OIDC settings.
- Notification workers use a login inheriting only `fiaa_worker`.
- Payment state changes only after provider-specific raw-body signature verification.
- Order numbers are public references, never authentication secrets.
- Customer order tokens and cart tokens are stored only as SHA-256 hashes; the browser order token is never exposed to JavaScript.
- Secrets and login-role creation never belong in migrations or source control.
