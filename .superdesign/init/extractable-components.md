# Extractable components

The project is static HTML rather than a component framework. Only cross-page shells are worthwhile extraction candidates; basic controls should remain inline.

## PublicHeader

- Source: `index.html`
- Category: layout
- Description: Sticky dark storefront header with utility line, logo, desktop links, search, cart, and mobile menu.
- Extractable props: `activeItem`, `cartCount`
- Hardcoded: FIAA logo, navigation labels, icons, brand colors

## DetailHeader

- Source: `server/app.js` (`productDocument`, `contentDocument`, order route)
- Category: layout
- Description: Compact dark header for product, policy, and private order pages.
- Extractable props: `backHref`, `backLabel`
- Hardcoded: FIAA logo and dark/red treatment

## PublicFooter

- Source: `index.html`
- Category: layout
- Description: Storefront brand statement, shop/help links, verified shop address, hours, and copyright row.
- Extractable props: none
- Hardcoded: all approved business content and links

## MobileBottomNav

- Source: `index.html`
- Category: layout
- Description: Five-item fixed mobile navigation for home, catalogue, search, accessories, and cart.
- Extractable props: `activeItem`, `cartCount`
- Hardcoded: labels, icons, destinations
