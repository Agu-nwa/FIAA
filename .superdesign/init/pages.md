# Page dependency trees

## `/` — Storefront

Entry: `index.html`

- `index.html`
  - `styles.css`
  - `app.js`
  - `assets/fiaa-logo-pack.png`
  - `assets/hero/fiaa-products.webp`
  - `assets/hero/everyday-transporter.webp`
  - `assets/hero/super-quality.webp`

## `/products/:slug` — Product detail

Entry: `server/app.js` (`productDocument`)

- `server/app.js`
  - `server/lib.js`
  - `styles.css`
  - `product-page.js`
  - `assets/fiaa-logo-pack.png`

## `/pages/:slug` — Content page

Entry: `server/app.js` (`contentDocument`)

- `server/app.js`
  - `styles.css`
  - `assets/fiaa-logo-pack.png`

## `/orders/:orderNumber` — Private order page

Entry: `server/app.js`

- `server/app.js`
  - `styles.css`
  - `order-page.js`
  - `assets/fiaa-logo-pack.png`

## `/admin` — Planned administration

New target in the existing codebase. It should reuse the brand logo, theme tokens, buttons, form fields, badges, cards, and server security model. There is no existing render branch to reproduce.
