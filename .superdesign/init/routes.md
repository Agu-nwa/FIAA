# Route map

| URL | Source | Layout | Purpose |
|---|---|---|---|
| `/` | `index.html`, `app.js` | Public storefront shell | Hero, part finder, catalogue, accessories, guide, support, cart, checkout |
| `/products/:slug` | `server/app.js`, `product-page.js` | Server-rendered detail shell | Published product detail and add-to-cart |
| `/pages/:slug` | `server/app.js` | Server-rendered detail shell | Published policy, guide, support, or company content |
| `/orders/:orderNumber` | `server/app.js`, `order-page.js` | Server-rendered detail shell | Private no-index order status shell |
| `/admin` | Not implemented | New authenticated admin shell | Planned catalogue, content, orders, readiness administration |

The public API and administration API are under `/v1/*`; health, sitemap, and robots routes are also served by `server/app.js`.
