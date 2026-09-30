const API = "/v1";
const categoryDefinitions = [
  ["Interior", "Mats, organizers, seat and steering covers", "01"],
  ["Electronics", "Chargers, cameras, trackers and audio", "02"],
  ["Safety", "Emergency equipment and roadside essentials", "03"],
  ["Car care", "Cleaning and vehicle-care products", "04"],
  ["Exterior", "Covers, wipers, trims and protection", "05"],
  ["Tools", "Jacks, gauges, spanners and tool kits", "06"]
];
const guides = [
  ["Brake care", "5 signs your brake pads need attention", "Simple warnings you can notice before braking becomes unsafe.", "!"],
  ["Buying guide", "How to find your brake-pad number", "Use the box, old pad or vehicle details to find the correct match.", "#"],
  ["Road safety", "What every driver should keep in the car", "A practical emergency checklist for everyday Nigerian roads.", "+"]
];
const state = { products: [], filter: "all", query: "", accessoryFilter: "all", accessoryQuery: "", cart: null, deliveryMethods: [], checkoutKey: null, loading: true };
const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const escapeHtml = value => String(value ?? "").replace(/[&<>'"]/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
const formatMoney = value => new Intl.NumberFormat("en-NG", { style: "currency", currency: value.currency, maximumFractionDigits: 0 }).format(value.amountMinor / 100);
const typeLabel = kind => ({ brake_pad: "Brake Pad", brake_shoe: "Brake Shoe", fitting_kit: "Kit", accessory: "Accessory" })[kind] || "Product";
const positionLabel = value => ({ front: "Front", rear: "Rear", front_or_rear: "Front or rear", not_applicable: "" })[value] || "";

async function api(path, options = {}) {
  const response = await fetch(`${API}${path}`, { credentials: "include", headers: { Accept: "application/json", ...(options.body ? { "Content-Type": "application/json" } : {}), ...options.headers }, ...options });
  const body = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(body?.detail || "The request could not be completed.");
    error.status = response.status;
    throw error;
  }
  return body;
}

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove("show"), 2800);
}

function productImage(product, className = "product-art") {
  if (!product.primaryImage) return "";
  return `<div class="${className}"><img src="${escapeHtml(product.primaryImage.url)}" alt="${escapeHtml(product.primaryImage.alt)}" width="${product.primaryImage.width}" height="${product.primaryImage.height}" loading="lazy"></div>`;
}

function productCard(product) {
  const accessory = product.productKind === "accessory";
  return `<article class="${accessory ? "accessory-product-card" : "product-card"}">
    ${productImage(product, accessory ? "accessory-product-art" : "product-art")}
    <div class="${accessory ? "accessory-product-body" : "product-body"}">
      <span class="${accessory ? "accessory-category" : "eyebrow"}">${escapeHtml(product.category)}</span>
      <div class="product-number"><h3>${escapeHtml(product.sku)}</h3><span class="product-type">${escapeHtml(typeLabel(product.productKind))}</span></div>
      <p>${escapeHtml(product.shortDescription)}</p>
      ${positionLabel(product.axlePosition) ? `<p class="fit-list">${escapeHtml(positionLabel(product.axlePosition))}</p>` : ""}
      <div class="price-row"><span class="price">${formatMoney(product.price)}</span><span class="stock">${product.availableQuantity > 0 ? "Available" : "Unavailable"}</span></div>
      <div class="product-actions"><a class="view-product" href="/products/${encodeURIComponent(product.slug)}">View details</a>${product.availableQuantity > 0 ? `<button class="quick-add" data-sku="${escapeHtml(product.sku)}" aria-label="Add ${escapeHtml(product.name)} to cart">+</button>` : ""}</div>
    </div>
  </article>`;
}

function renderProducts() {
  const parts = state.products.filter(product => product.productKind !== "accessory" && (state.filter === "all" || typeLabel(product.productKind) === state.filter));
  $("#partsGrid").innerHTML = parts.map(productCard).join("");
  $("#partsEmpty").hidden = state.loading || parts.length > 0;
  $("#partsEmptyTitle").textContent = state.query ? "No verified match found" : "No catalogue products are available online right now";
  $("#partsEmptyText").textContent = state.query ? "Try a shorter product number or contact FIAA to confirm the correct part." : "Contact FIAA to confirm the correct product, current price and availability.";
  $("#showAllParts").hidden = true;
  $("#clearFilters").hidden = !state.query && state.filter === "all";
}

function renderAccessories() {
  const query = state.accessoryQuery.trim().toLowerCase();
  const products = state.products.filter(product => product.productKind === "accessory" && (state.accessoryFilter === "all" || product.category === state.accessoryFilter) && (!query || `${product.sku} ${product.name} ${product.shortDescription} ${product.category}`.toLowerCase().includes(query)));
  $("#accessoryGrid").innerHTML = products.map(productCard).join("");
  $("#accessoryCount").textContent = `${products.length} ${products.length === 1 ? "product" : "products"}`;
  $("#accessoryEmpty").hidden = state.loading || products.length > 0;
  $("#accessoryEmptyTitle").textContent = state.accessoryQuery ? "No verified accessories found" : "No accessories are available online right now";
  $("#accessoryEmptyText").textContent = state.accessoryQuery ? "Try another word or category." : "Contact FIAA for verified products, current prices and availability.";
  $("#resetAccessories").hidden = !state.accessoryQuery && state.accessoryFilter === "all";
}

async function searchProducts(filters = {}) {
  state.loading = true;
  renderProducts(); renderAccessories();
  const params = new URLSearchParams({ limit: "100", ...Object.fromEntries(Object.entries(filters).filter(([, value]) => value)) });
  try {
    const result = await api(`/search?${params}`);
    state.products = result.items;
  } catch {
    state.products = [];
    showToast("Catalogue unavailable. Please try again or contact FIAA.");
  } finally {
    state.loading = false;
    renderProducts(); renderAccessories();
  }
}

async function openProduct(slug) {
  try {
    const product = await api(`/products/${encodeURIComponent(slug)}`);
    const fitments = product.fitments.length ? `<div class="fitment-box"><h3>Verified vehicle fitment</h3><ul>${product.fitments.map(item => `<li>${escapeHtml([item.make, item.model, item.yearFrom && item.yearTo ? `${item.yearFrom}–${item.yearTo}` : item.yearFrom || item.yearTo, item.engine, item.trim].filter(Boolean).join(" "))}</li>`).join("")}</ul></div>` : "";
    $("#productDialogContent").innerHTML = `${productImage(product, "dialog-art")}<div class="dialog-body"><span class="eyebrow">${escapeHtml(product.category)}</span><h2 id="dialogTitle">${escapeHtml(product.sku)}</h2><p class="dialog-subtitle">${escapeHtml(product.description)}</p>${fitments}<dl class="spec-list"><div><dt>Product number</dt><dd>${escapeHtml(product.sku)}</dd></div>${positionLabel(product.axlePosition) ? `<div><dt>Position</dt><dd>${escapeHtml(positionLabel(product.axlePosition))}</dd></div>` : ""}${product.oemReferences.length ? `<div><dt>OEM references</dt><dd>${product.oemReferences.map(escapeHtml).join(", ")}</dd></div>` : ""}</dl></div><div class="dialog-buy"><div class="price">${formatMoney(product.price)}<small>${product.availableQuantity > 0 ? "Available" : "Unavailable"}</small></div>${product.availableQuantity > 0 ? `<button class="button button-primary" data-sku="${escapeHtml(product.sku)}">Add to cart</button>` : ""}</div>`;
    $("#productDialog").showModal(); document.body.classList.add("no-scroll");
  } catch { showToast("Product details are unavailable right now."); }
}

async function ensureCart() {
  if (state.cart) return state.cart;
  const savedId = localStorage.getItem("fiaaCartId");
  if (savedId) {
    try { state.cart = await api(`/carts/${encodeURIComponent(savedId)}`); return state.cart; }
    catch { localStorage.removeItem("fiaaCartId"); }
  }
  state.cart = await api("/carts", { method: "POST" });
  localStorage.setItem("fiaaCartId", state.cart.id);
  return state.cart;
}

function updateCartCount() {
  const count = state.cart?.itemCount || 0;
  $("#cartCount").textContent = count; $("#mobileCartCount").textContent = count;
}

async function setCartItem(sku, quantity) {
  try {
    const cart = await ensureCart();
    state.cart = await api(`/carts/${cart.id}/items/${encodeURIComponent(sku)}`, { method: "PUT", body: JSON.stringify({ quantity }) });
    updateCartCount(); return true;
  } catch (error) { showToast(error.status === 409 ? "That quantity is no longer available." : "Cart unavailable. Please try again."); return false; }
}

async function addToCart(sku) {
  const cart = await ensureCart().catch(() => null);
  if (!cart) return showToast("Cart unavailable. Please try again.");
  const existing = cart.items.find(item => item.sku === sku);
  if (await setCartItem(sku, (existing?.quantity || 0) + 1)) showToast(`${sku} added to cart`);
}

async function openCart() {
  try { await ensureCart(); } catch { showToast("Cart unavailable. Please try again."); return; }
  const list = $("#cartItems");
  if (!state.cart.items.length) {
    list.innerHTML = '<div class="cart-empty"><h3>Your cart is empty</h3><p>Add a verified product from the catalogue.</p></div>';
    $("#cartSummary").innerHTML = "";
  } else {
    list.innerHTML = state.cart.items.map(item => `<div class="cart-line"><div class="cart-thumb">${escapeHtml(item.sku)}</div><div><h3>${escapeHtml(item.name)}</h3><p>Qty ${item.quantity} • ${formatMoney(item.lineTotal)}</p></div><button class="remove-item" data-remove-sku="${escapeHtml(item.sku)}" aria-label="Remove ${escapeHtml(item.name)}">×</button></div>`).join("");
    $("#cartSummary").innerHTML = `<div class="cart-total"><span>Subtotal</span><span>${formatMoney(state.cart.subtotal)}</span></div><button class="button button-primary" id="continueCheckout">Continue to checkout</button>`;
  }
  $("#cartDialog").showModal(); document.body.classList.add("no-scroll");
}

function selectedDelivery() {
  return state.deliveryMethods.find(method => method.code === $("#deliveryMethod").value);
}

function updateDeliveryForm() {
  const method = selectedDelivery();
  const address = $("#deliveryAddress");
  address.hidden = !method?.requiresAddress;
  address.querySelectorAll("input[name='line1'],input[name='city'],input[name='state']").forEach(input => { input.required = Boolean(method?.requiresAddress); });
}

async function openCheckout() {
  if (!state.cart?.items.length) return showToast("Your cart is empty.");
  closeDialog($("#cartDialog"));
  $("#checkoutForm").hidden = false;
  $("#orderConfirmation").hidden = true;
  $("#checkoutError").hidden = true;
  $("#checkoutSubtotal").textContent = formatMoney(state.cart.subtotal);
  const select = $("#deliveryMethod");
  select.innerHTML = '<option value="">Loading available methods…</option>';
  $("#checkoutDialog").showModal(); document.body.classList.add("no-scroll");
  try {
    const response = await api("/delivery-methods");
    state.deliveryMethods = response.items;
    select.innerHTML = '<option value="">Choose delivery method</option>' + state.deliveryMethods.map(method => `<option value="${escapeHtml(method.code)}">${escapeHtml(method.name)} — ${formatMoney(method.fee)}</option>`).join("");
    if (!state.deliveryMethods.length) throw new Error("No delivery methods are currently available.");
    $(".checkout-submit").disabled = false;
  } catch (error) {
    select.innerHTML = '<option value="">No delivery methods available</option>';
    $(".checkout-submit").disabled = true;
    $("#checkoutError").textContent = error.message || "Delivery methods are unavailable. Please contact FIAA.";
    $("#checkoutError").hidden = false;
  }
}

async function submitCheckout(event) {
  event.preventDefault();
  const form = event.currentTarget;
  if (!form.reportValidity()) return;
  const method = selectedDelivery();
  if (!method) return;
  const values = Object.fromEntries(new FormData(form));
  const submit = form.querySelector("button[type='submit']");
  submit.disabled = true; submit.textContent = "Placing order…";
  $("#checkoutError").hidden = true;
  state.checkoutKey ||= `web-${crypto.randomUUID()}`;
  const address = method.requiresAddress ? { line1: values.line1, line2: values.line2 || null, city: values.city, state: values.state, notes: values.addressNotes || null } : null;
  try {
    const result = await api("/checkout", {
      method: "POST", headers: { "Idempotency-Key": state.checkoutKey },
      body: JSON.stringify({ cartId: state.cart.id, customer: { fullName: values.fullName, phone: values.phone, email: values.email || null }, deliveryMethod: method.code, address, customerNote: values.customerNote || null })
    });
    state.checkoutKey = null;
    localStorage.removeItem("fiaaCartId"); state.cart = null; updateCartCount();
    const paymentMessage = result.payment.status === "requires_action" && result.payment.authorizationUrl
      ? `<a class="button button-primary" href="${escapeHtml(result.payment.authorizationUrl)}" rel="nofollow">Continue to secure payment</a>`
      : '<p>Payment is pending. Use only payment instructions provided through FIAA’s official contact channels.</p>';
    $("#checkoutForm").hidden = true;
    $("#orderConfirmation").innerHTML = `<div class="confirmation-mark">✓</div><span class="eyebrow">Order received</span><h3>Thank you, ${escapeHtml(values.fullName)}.</h3><p>Your order number is <strong>${escapeHtml(result.order.orderNumber)}</strong>.</p><div class="confirmation-total"><span>Total</span><strong>${formatMoney(result.order.total)}</strong></div>${paymentMessage}<a class="button button-secondary" href="/orders/${encodeURIComponent(result.order.orderNumber)}">View private order status</a><button class="button button-secondary close-confirmation" type="button">Continue browsing</button>`;
    $("#orderConfirmation").hidden = false;
  } catch (error) {
    $("#checkoutError").textContent = error.status === 409 ? "Availability changed while you were checking out. Review your cart and try again." : error.message;
    $("#checkoutError").hidden = false;
  } finally {
    submit.disabled = false; submit.textContent = "Place order";
  }
}

function closeDialog(dialog) { dialog.close(); document.body.classList.remove("no-scroll"); }

const heroSlides = $$(".hero-slide"); const heroDots = $$("[data-hero-dot]"); const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");
let heroIndex = 0; let heroTimer; let heroPaused = false; let touchStart;
function showHero(index, pause = false) { heroIndex = (index + heroSlides.length) % heroSlides.length; heroSlides.forEach((slide, i) => { slide.classList.toggle("is-active", i === heroIndex); slide.setAttribute("aria-hidden", String(i !== heroIndex)); }); heroDots.forEach((dot, i) => { dot.classList.toggle("is-active", i === heroIndex); dot.setAttribute("aria-selected", String(i === heroIndex)); }); if (pause) heroPaused = true; restartHero(); }
function restartHero() { clearInterval(heroTimer); if (!reduceMotion.matches && !heroPaused) heroTimer = setInterval(() => showHero(heroIndex + 1), 6000); }
heroDots.forEach(dot => dot.addEventListener("click", () => showHero(Number(dot.dataset.heroDot), true)));
$("#heroPrev").addEventListener("click", () => showHero(heroIndex - 1, true)); $("#heroNext").addEventListener("click", () => showHero(heroIndex + 1, true));
$("#heroToggle").addEventListener("click", () => { heroPaused = !heroPaused; $("#heroToggle").setAttribute("aria-pressed", String(heroPaused)); $("#heroToggle").setAttribute("aria-label", heroPaused ? "Play automatic slides" : "Pause automatic slides"); restartHero(); });
$(".hero-carousel").addEventListener("pointerdown", event => { touchStart = event.clientX; }); $(".hero-carousel").addEventListener("pointerup", event => { if (touchStart != null && Math.abs(event.clientX - touchStart) > 55) showHero(heroIndex + (event.clientX < touchStart ? 1 : -1), true); touchStart = null; });
showHero(0);

$("#categoryGrid").innerHTML = categoryDefinitions.map(([name, detail, symbol]) => `<button class="category-card" data-category-jump="${name}"><span>${symbol}</span><div><h3>${name}</h3><p>${detail}</p></div></button>`).join("");
$("#accessoryFilters").innerHTML = ['<button class="active" data-accessory-filter="all">All accessories</button>', ...categoryDefinitions.map(([name]) => `<button data-accessory-filter="${name}">${name}</button>`)].join("");
$("#guideGrid").innerHTML = guides.map(([category, title, summary, symbol]) => `<article class="guide-card"><div class="guide-art" data-symbol="${symbol}"></div><div class="guide-content"><small>${category}</small><h3>${title}</h3><p>${summary}</p></div></article>`).join("");

document.addEventListener("click", async event => {
  const slug = event.target.closest("[data-slug]")?.dataset.slug;
  const sku = event.target.closest("[data-sku]")?.dataset.sku;
  const removeSku = event.target.closest("[data-remove-sku]")?.dataset.removeSku;
  if (slug) await openProduct(slug);
  if (sku) await addToCart(sku);
  if (removeSku) { await setCartItem(removeSku, 0); closeDialog($("#cartDialog")); await openCart(); }
  if (event.target.closest("#continueCheckout")) await openCheckout();
  if (event.target.closest(".close-confirmation")) closeDialog($("#checkoutDialog"));
  const category = event.target.closest("[data-category-jump]")?.dataset.categoryJump;
  if (category) { state.accessoryFilter = category; renderAccessories(); $("#accessoryCatalogueTitle").scrollIntoView({ behavior: "smooth" }); }
});

$$('.close-dialog').forEach(button => button.addEventListener("click", () => closeDialog(button.closest("dialog"))));
$$('dialog').forEach(dialog => dialog.addEventListener("click", event => { if (event.target === dialog) closeDialog(dialog); }));
$$('[data-finder-tab]').forEach(button => button.addEventListener("click", () => { $$('[data-finder-tab]').forEach(item => item.setAttribute("aria-selected", String(item === button))); $("#numberPanel").hidden = button.dataset.finderTab !== "number"; $("#vehiclePanel").hidden = button.dataset.finderTab !== "vehicle"; }));
$$('[data-filter]').forEach(button => button.addEventListener("click", () => { state.filter = button.dataset.filter; $$('[data-filter]').forEach(item => item.classList.toggle("active", item === button)); renderProducts(); }));
$$('[data-accessory-filter]').forEach(button => button.addEventListener("click", () => { state.accessoryFilter = button.dataset.accessoryFilter; $$('[data-accessory-filter]').forEach(item => item.classList.toggle("active", item === button)); renderAccessories(); }));
$("#accessorySearch").addEventListener("input", event => { state.accessoryQuery = event.target.value; renderAccessories(); });
$("#resetAccessories").addEventListener("click", () => { state.accessoryFilter = "all"; state.accessoryQuery = ""; $("#accessorySearch").value = ""; renderAccessories(); });
$("#clearFilters").addEventListener("click", () => { state.query = ""; state.filter = "all"; searchProducts(); });
$("#resetSearch").addEventListener("click", () => searchProducts());
async function numberSearch(value) { state.query = value.trim(); state.filter = "all"; await searchProducts({ q: state.query }); $("#catalogue").scrollIntoView({ behavior: "smooth" }); }
$("#partSearchButton").addEventListener("click", () => numberSearch($("#partSearch").value)); $("#partSearch").addEventListener("keydown", event => { if (event.key === "Enter") numberSearch(event.target.value); });
$("#vehiclePanel").addEventListener("submit", async event => { event.preventDefault(); const year = $("#vehicleYear").value; if (year && !/^\d{4}$/.test(year)) return showToast("Enter a four-digit vehicle year."); await searchProducts({ make: $("#vehicleMake").value.trim(), model: $("#vehicleModel").value.trim(), year, position: $("#vehiclePosition").value }); $("#catalogue").scrollIntoView({ behavior: "smooth" }); });
$("#openCart").addEventListener("click", openCart); $("#bottomCart").addEventListener("click", openCart);
$("#deliveryMethod").addEventListener("change", updateDeliveryForm);
$("#checkoutForm").addEventListener("submit", submitCheckout);

const overlay = $("#searchOverlay");
function openSearch() { overlay.hidden = false; document.body.classList.add("no-scroll"); setTimeout(() => $("#globalSearch").focus(), 30); }
function closeSearch() { overlay.hidden = true; document.body.classList.remove("no-scroll"); }
$("#openSearch").addEventListener("click", openSearch); $("#bottomSearch").addEventListener("click", openSearch); $("#closeSearch").addEventListener("click", closeSearch);
async function globalSearch() { const query = $("#globalSearch").value.trim(); if (!query) return; closeSearch(); await numberSearch(query); }
$("#globalSearchButton").addEventListener("click", globalSearch); $("#globalSearch").addEventListener("keydown", event => { if (event.key === "Enter") globalSearch(); if (event.key === "Escape") closeSearch(); });
$$('[data-query]').forEach(button => button.addEventListener("click", () => { $("#globalSearch").value = button.dataset.query; globalSearch(); }));

const menuButton = $("#menuButton"); const mobileMenu = $("#mobileMenu");
menuButton.addEventListener("click", () => { const open = menuButton.getAttribute("aria-expanded") === "true"; menuButton.setAttribute("aria-expanded", String(!open)); mobileMenu.hidden = open; });
mobileMenu.querySelectorAll("a").forEach(link => link.addEventListener("click", () => { mobileMenu.hidden = true; menuButton.setAttribute("aria-expanded", "false"); }));

renderProducts(); renderAccessories(); updateCartCount(); searchProducts();
