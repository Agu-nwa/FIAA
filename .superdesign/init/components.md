# Shared UI primitives

The storefront is framework-free HTML/CSS/JavaScript. It has no component directory or imported component library. Reusable primitives are source-defined in `index.html` and `styles.css`; the complete implementations used by the public UI are below.

## Button

- Source: `styles.css`
- Variants: primary, secondary, dark, ghost, outline-light, WhatsApp

```css
.button { min-height: 48px; display: inline-flex; align-items: center; justify-content: center; border: 1px solid transparent; border-radius: 9px; padding: 12px 20px; font-weight: 800; transition: transform .18s, background .18s, color .18s, border-color .18s; }
.button:hover { transform: translateY(-2px); }
.button-primary { background: var(--red); color: var(--white); }
.button-primary:hover { background: #c5002e; }
.button-secondary { background: transparent; color: inherit; border-color: #b6bcc0; }
.button-secondary:hover { border-color: var(--ink); background: var(--ink); color: var(--white); }
.button-ghost { color:var(--white); border-color:rgba(255,255,255,.7); background:rgba(8,10,11,.25); backdrop-filter:blur(8px); }
.button-ghost:hover { background:var(--white); color:var(--ink); border-color:var(--white); }
.button-dark { background: var(--ink); color: var(--white); }
.button-outline-light { color: var(--white); border-color: rgba(255,255,255,.55); }
.whatsapp-button { background: #22a95e; color: var(--white); }
```

## SearchControl

- Source: `index.html`, `styles.css`

```html
<div class="search-control">
  <svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"></circle><path d="m20 20-4-4"></path></svg>
  <input type="search" autocomplete="off" />
  <button>Search catalogue</button>
</div>
```

```css
.search-control { min-height: 58px; display: flex; align-items: center; gap: 12px; border: 1px solid #bec3c6; border-radius: 10px; background: var(--white); padding: 6px 7px 6px 16px; }
.search-control:focus-within { outline: 3px solid rgba(169,0,38,.16); border-color: var(--red); }
.search-control input { min-width: 0; flex: 1; height: 44px; border: 0; outline: 0; font-size: 1rem; color: var(--ink); }
.search-control button { min-height: 44px; border: 0; border-radius: 7px; padding: 8px 18px; background: var(--ink); color: var(--white); font-weight: 800; }
```

## Drawer

- Source: `index.html`, `styles.css`
- Native dialog shell used by product details, cart, and checkout.

```html
<dialog class="drawer">
  <div class="drawer-header"><h2>Title</h2><button class="icon-button close-dialog" aria-label="Close">×</button></div>
  <div class="drawer-content"></div>
</dialog>
```

```css
.drawer { width: min(470px, 100%); max-width: none; height: 100%; max-height: none; margin: 0 0 0 auto; padding: 0; border: 0; background: var(--paper); color: var(--ink); box-shadow: -20px 0 50px rgba(0,0,0,.2); }
.drawer::backdrop { background: rgba(0,0,0,.56); backdrop-filter: blur(3px); }
.drawer[open] { animation: slide-in .22s ease-out; }
.drawer-header { min-height: 70px; display:flex; align-items:center; justify-content:space-between; padding:12px 20px; background:var(--white); border-bottom:1px solid var(--line); font-weight:800; }
```
