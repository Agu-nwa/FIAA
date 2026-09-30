# FIAA incident response

## Severity

- **SEV-1:** suspected customer-data exposure, payment verification bypass, widespread checkout failure, corrupted inventory/orders, or full production outage.
- **SEV-2:** material search/cart/order defect, notification backlog, deployment failure, or degraded service without confirmed data exposure.
- **SEV-3:** isolated content, presentation or noncritical operational defect.

## First response

1. Record UTC and local time, reporter, affected URL/order identifiers, symptoms and first known occurrence. Do not copy secrets or full customer data into the incident record.
2. For SEV-1, stop risky releases and assign one incident lead. If payment integrity is uncertain, disable new checkout at the edge while preserving verified webhooks and existing order evidence.
3. Preserve application, edge, database and provider logs. Never alter provider payloads or audit rows.
4. Check `/health/live`, `/health/ready`, error rate, database pressure, payment signature failures, notification backlog and inventory-reservation cleanup.
5. Identify the last known-good image and schema version before deciding rollback versus forward fix.

## Payment incident rules

- Never mark an order paid manually.
- Compare provider reference, verified signature result, amount, currency and order ID.
- A mismatch is treated as a security/integrity incident, not a customer-service override.
- Refunds require the approved provider workflow and reconciliation evidence.

## Data exposure rules

- Restrict access immediately and preserve evidence.
- Record the data categories and affected records without spreading the data further.
- The owner determines required customer/regulatory notification with qualified legal advice.
- Rotate only credentials plausibly exposed; do not destroy evidence before capture.

## Recovery and closure

1. Confirm health and run `SMOKE_BASE_URL=https://<host> EXPECT_INDEXING=<true|false> npm run smoke`.
2. Exercise a controlled search, cart and approved checkout path.
3. Reconcile payment, order, notification and inventory records affected during the incident window.
4. Document cause, impact, corrective actions, owner and due date.
5. Add a regression test or monitoring control before closure whenever technically possible.
