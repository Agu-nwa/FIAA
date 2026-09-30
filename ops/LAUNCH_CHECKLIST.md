# FIAA production launch checklist

Every item requires recorded evidence and an accountable owner. “Configured” without a successful test is not complete.

## Business and catalogue

- [ ] Owner-approved legal/business name, address, phone, email and operating hours are recorded.
- [ ] Every public product has owner-approved SKU, description, price, genuine image, inventory and fitment evidence.
- [ ] Delivery destinations, fees, service expectations and pickup rules are approved.
- [ ] Delivery, returns/refunds, warranty, privacy, terms, contact and about pages are owner-published.

## Commerce providers

- [ ] Payment provider contract, live credentials and webhook secret are stored in the secret manager.
- [ ] Successful, failed, duplicate, delayed and amount-mismatch payment cases pass in sandbox and live low-value testing.
- [ ] Email/WhatsApp providers and templates are approved; delivery, retry and opt-out behavior is verified.
- [ ] Staff OIDC provider, owner accounts, MFA and role assignments are verified.

## Infrastructure and security

- [ ] Production image digest is recorded and runs as non-root.
- [ ] Separate API, admin, worker and migration database identities use least privilege.
- [ ] Migrations and staged PostgreSQL tests pass against the release candidate.
- [ ] TLS, canonical domain, DNS and trusted-proxy settings are verified.
- [ ] Encrypted backups, point-in-time recovery and an isolated restore drill pass.
- [ ] Security headers, rate limits, CSP and secret scanning pass.

## Quality and discovery

- [ ] Desktop and supported mobile browser journeys pass using production-like data.
- [ ] Keyboard, focus, landmark, label, contrast and reduced-motion checks pass.
- [ ] Search by exact SKU, OEM reference and verified vehicle returns correct records.
- [ ] Cart, delivery, checkout, payment, confirmation, order access and notifications pass end to end.
- [ ] Performance targets are measured on the deployed production candidate.
- [ ] Sitemap contains only published pages/products; `PUBLIC_INDEXING=true` only at the approved launch.

## Operations

- [ ] Error, latency, readiness, payment, notification, database, backup, certificate and DNS alerts are tested.
- [ ] Maintenance and notification workers run under the worker identity and alerts fire on failure.
- [ ] Staff complete catalogue, content, order, refund and incident training.
- [ ] Rollback image, rollback decision owner and database rollback strategy are recorded.
- [ ] `SMOKE_BASE_URL=https://www.fiaaevolution.com EXPECT_INDEXING=true npm run smoke` passes immediately before and after traffic cutover.
