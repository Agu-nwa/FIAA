# FIAA Evolution Commerce API

`openapi.yaml` is the production contract between the storefront, server application, PostgreSQL functions, payment webhooks, notification workers and staff administration.

## Security boundaries

- Browsers never receive database credentials.
- Product responses come only from the approved storefront projections.
- Cart tokens are opaque, random and stored as hashes server-side.
- Cart cookies must be `HttpOnly`, `Secure` and `SameSite=Lax` in production.
- Checkout requires an idempotency key.
- Order access uses a separate high-entropy token, never the public order number alone.
- Staff endpoints require verified identity-provider JWTs and database role checks.
- Payment webhooks require provider-specific raw-body signature verification before database state changes.
- Error responses use `application/problem+json` and must not expose database messages or secrets.

## Implementation rule

The API server is responsible for request validation, authentication, rate limiting, secure cookies, provider signature verification, secret-manager access, response mapping and observability. PostgreSQL remains authoritative for publication gates, prices, inventory, carts, order totals, reservations and audit history.

## Still required before implementation

- Production runtime and hosting selection
- Identity provider selection
- Payment provider and merchant credentials
- Email/WhatsApp/SMS providers and sender identities
- Object-storage provider for verified product images
- Final production domains and CORS origins

Provider credentials must never be committed to this repository.
