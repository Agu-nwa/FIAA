# Shared layouts

The project uses server documents and one static storefront rather than layout components.

## Public storefront shell

- Source: `index.html`
- Sticky dark header, public content sections, four-column footer, mobile bottom navigation, and native-dialog overlays.

```html
<header class="site-header">
  <div class="utility-bar"><div class="shell utility-inner"><p>Brake parts • Car accessories</p><a href="tel:+2348163321810">Call 0816 332 1810</a></div></div>
  <div class="shell header-main">
    <a class="brand" href="#home" aria-label="FIAA Evolution home"><img src="assets/fiaa-logo-pack.png" alt="FIAA Evolution" /></a>
    <nav class="desktop-nav" aria-label="Primary navigation"><a href="#catalogue">Parts catalogue</a><a href="#accessories">Accessories</a><a href="#guides">Car guide</a><a href="#support">Support</a></nav>
    <div class="header-actions"><button class="icon-button" id="openSearch" aria-label="Open search"></button><button class="cart-button" id="openCart" aria-label="Open cart"><span>Cart</span><b id="cartCount">0</b></button><button class="menu-button" id="menuButton" aria-expanded="false" aria-controls="mobileMenu"></button></div>
  </div>
</header>
<main id="main"><!-- hero, finder, catalogue, accessories, guides, support --></main>
<footer class="site-footer"><div class="shell footer-grid"><!-- brand, shop, help, address --></div><div class="shell footer-bottom"><span>© 2026 FIAA Evolution.</span><span>Built for Nigerian roads.</span></div></footer>
<nav class="bottom-nav" aria-label="Quick navigation"><a href="#home">Home</a><a href="#catalogue">Catalogue</a><button id="bottomSearch">Search</button><a href="#accessories">Accessories</a><button id="bottomCart">Cart</button></nav>
```

## Server-rendered detail shell

- Source: `server/app.js`
- Used by `/products/:slug`, `/pages/:slug`, and `/orders/:orderNumber`.

```html
<body class="content-page">
  <header class="product-page-header"><div class="shell"><a href="/" aria-label="FIAA Evolution home"><img src="/assets/fiaa-logo-pack.png" alt="FIAA Evolution" width="142" height="56"></a><a class="button button-secondary" href="/">Back home</a></div></header>
  <main class="shell"><!-- route-specific verified content --></main>
</body>
```
