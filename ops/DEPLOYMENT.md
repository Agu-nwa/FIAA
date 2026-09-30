# Production deployment runbook

This runbook is provider-neutral until FIAA approves a host, database, DNS and storage vendor.

## Required services

- One OCI-compatible container service running the FIAA image
- PostgreSQL 17 with encrypted connections and automated point-in-time recovery
- Object storage or CDN for owner-approved product media
- OIDC identity provider for staff administration
- Approved payment, email and WhatsApp providers
- DNS access for `fiaaevolution.com` and its chosen canonical host

## Runtime identities

Provision separate random login credentials outside migrations:

- Public API login inheriting only `fiaa_api`
- Administration login inheriting only `fiaa_admin`
- Notification/maintenance worker login inheriting only `fiaa_worker`
- Migration login used only during controlled releases

Never give the public API login membership in `fiaa_admin` or `fiaa_worker`.

## Release sequence

1. Take and verify a pre-release database backup.
2. Build the image from the pinned lockfile and record its immutable digest.
3. Apply unapplied numbered migrations using the migration identity.
4. Run `npm run validate` and the staged database tests against a disposable database.
5. Deploy one non-public instance and wait for `/health/ready`.
6. Run smoke tests for storefront, search, cart and an approved low-risk checkout path.
7. Shift traffic gradually and watch error rate, latency, payment-webhook failures and notification backlog.
8. Retain the previous image and documented rollback migration decision.

Run the read-only deployment smoke suite with `SMOKE_BASE_URL=https://<candidate-host> EXPECT_INDEXING=false npm run smoke` before traffic cutover. At approved public launch, run it against the canonical domain with `EXPECT_INDEXING=true`.

Schedule `npm run maintenance` at least every five minutes using `WORKER_DATABASE_URL`. It releases stock held by expired unpaid orders and expires abandoned carts. Alert on any failed run.

## Required secret configuration

Use the hosting provider’s encrypted secret manager for every value in `.env.example`. Do not upload an environment file. `ADMIN_DATABASE_URL` is accepted only when all three OIDC verification settings are present.

## TLS and proxy

- Redirect HTTP to HTTPS at the edge.
- Use a valid automatically renewed certificate.
- Forward the original protocol and client address only from trusted proxies.
- Set `TRUST_PROXY=true` only behind that trusted proxy.
- Keep the API and storefront on the same canonical origin when possible.

## Monitoring alerts

Alert on:

- readiness failure or repeated container restart;
- elevated HTTP 5xx or checkout 409 rates;
- payment signature failures and webhook processing failures;
- notification jobs reaching their eighth attempt;
- expired inventory reservations not being released;
- database storage, connection or replication pressure;
- backup failure or failed restore drill;
- TLS certificate expiry and domain-resolution changes.

## Backups

- Enable encrypted daily backups and point-in-time recovery on PostgreSQL.
- Keep a separate retention copy according to FIAA’s approved retention policy.
- Back up the owner-approved media bucket with versioning.
- Perform and record a restore drill before launch and at a scheduled interval thereafter.
- A backup is not considered valid until a restore succeeds in an isolated environment.

## Launch gate

Do not direct public traffic until:

- every public product passes the publication gate;
- mandatory policy pages are owner-approved;
- delivery fees and destinations are approved;
- payment and messaging providers pass sandbox and live low-value tests;
- analytics and monitoring consent behavior is approved;
- backup restore and rollback exercises pass;
- staff complete the catalogue, order, refund and incident runbooks.

Operational procedures are documented in `ops/STAFF_OPERATIONS.md`, `ops/INCIDENT_RESPONSE.md` and `ops/LAUNCH_CHECKLIST.md`.
