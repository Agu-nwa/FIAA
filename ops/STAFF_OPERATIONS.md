# FIAA staff operations

This runbook governs routine catalogue, content and order work. Staff must use individual OIDC accounts; shared passwords and direct production database edits are prohibited.

## Catalogue workflow

1. Create or update the product record while it remains `draft`.
2. Record the familiar FIAA product number exactly as printed on the approved pack or catalogue.
3. Add only fitments supported by an owner-approved source reference. Never infer compatibility from a similar model or part shape.
4. Upload genuine product/packaging media, record useful alt text, and obtain owner verification.
5. Add the approved current price and real inventory location/count.
6. Resolve every publication problem shown by the administration interface.
7. A catalogue manager submits `draft → review`; only an owner may approve and publish.
8. After publication, verify the public product page, search by product number, and at least one approved vehicle query.

Archiving removes a product from public discovery without deleting its history. Never reuse an existing SKU for a different part.

## Content workflow

1. A content manager creates or revises a draft with a meaningful change summary.
2. Preview customer-facing wording and confirm contact, delivery, return, warranty and legal facts with the owner.
3. Publishing is owner-only. Any edit to published text returns it to review and removes prior owner approval.
4. Confirm the public page and metadata after publication.

Required launch pages are delivery, returns/refunds, warranty, privacy, terms, contact and about. Do not publish generic or copied policy language.

## Order workflow

- `pending_payment`: no verified payment. Staff may cancel; stock remains held only until reservation expiry.
- `paid`: set only by a verified payment callback. Staff cannot set this manually.
- `processing`: payment verified and order accepted for fulfilment.
- `ready_for_pickup`: collection order is prepared.
- `shipped`: requires a shipment record with carrier and tracking number.
- `delivered`: customer collection or tracked delivery completed.
- `refunded`: may be set only through verified refund/payment processing when that provider integration is approved.

Every staff status change requires a specific reason and is audited. Never send goods based on a screenshot or customer claim; use the payment record in the administration system.

## Customer support and privacy

- Confirm an order using the secure administration session, not an order number alone.
- Do not paste customer addresses, phone numbers or order tokens into personal messaging, documents or spreadsheets.
- Public order links require the private order token stored in the customer’s checkout browser session.
- Escalate suspected account compromise, unusual refund requests or mismatched payment amounts immediately.

## Start-of-day checks

- Administration launch/readiness panel loads successfully.
- No notification job is at its final retry.
- No paid order remains unreviewed beyond the approved service target.
- No inventory reservation cleanup or readiness alert is failing.

## End-of-day checks

- Paid and processing orders have an owner.
- Dispatched orders have carrier/tracking details.
- Failed customer notifications are investigated.
- Catalogue/content changes awaiting owner approval are documented in the administration system.
