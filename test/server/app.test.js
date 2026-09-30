import assert from "node:assert/strict";
import { test } from "node:test";
import { buildApp } from "../../server/app.js";

const config = {
  nodeEnv: "test",
  trustProxy: false,
  cookieSecret: "test-cookie-secret-that-is-at-least-32-characters",
  publicWebOrigin: "https://www.fiaaevolution.com",
  publicAssetBaseUrl: "https://cdn.fiaaevolution.com"
};

function database(handler = async () => ({ rows: [] })) {
  const calls = [];
  const db = {
    calls,
    async query(text, params = []) {
      calls.push({ text, params });
      return handler(text, params, calls.length);
    }
  };
  db.transaction = async work => work(db);
  return db;
}

async function application(db) {
  const app = await buildApp({ db, config });
  test.after(() => app.close());
  return app;
}

const cartRow = {
  id: "8a89245b-8a92-4b63-8526-f5337067cedf",
  status: "active",
  expiresAt: "2026-10-27T12:00:00.000Z",
  currency: "NGN",
  itemCount: 2,
  subtotalMinor: 250000,
  items: [{
    sku: "D5468",
    slug: "fiaa-d5468-front-brake-pad",
    name: "FIAA D5468 Front Brake Pad",
    quantity: 2,
    availableQuantity: 8,
    unitAmountMinor: 125000,
    lineAmountMinor: 250000
  }]
};

test("liveness does not require a database connection", async () => {
  const db = database(() => { throw new Error("database should not be queried"); });
  const app = await application(db);
  const response = await app.inject({ method: "GET", url: "/health/live" });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { status: "ok" });
  assert.equal(db.calls.length, 0);
});

test("readiness verifies the database", async () => {
  const db = database(async () => ({ rows: [{ ready: 1 }] }));
  const app = await application(db);
  const response = await app.inject({ method: "GET", url: "/health/ready" });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { status: "ready" });
  assert.equal(db.calls[0].text, "select 1 as ready");
});

test("search validates filters and maps database money safely", async () => {
  const db = database(async () => ({ rows: [{
    id: "0068f486-d9cb-4201-8fe2-6194025b787e",
    sku: "D5468",
    slug: "fiaa-d5468-front-brake-pad",
    name: "FIAA D5468 Front Brake Pad",
    product_kind: "brake_pad",
    category_name: "Brake Pads",
    short_description: "Front brake pad set",
    axle_position: "front",
    currency: "NGN",
    amount_minor: 125000,
    available_quantity: 8,
    images: [{ storageKey: "products/D5468/main.webp", alt: "FIAA D5468 brake pad", role: "primary", width: 1200, height: 900 }]
  }] }));
  const app = await application(db);
  const response = await app.inject({ method: "GET", url: "/v1/search?q=D5468&make=Toyota&year=2016&limit=10" });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(db.calls[0].params, ["D5468", "Toyota", null, 2016, null, 10, 0]);
  assert.deepEqual(response.json().items[0].price, { currency: "NGN", amountMinor: 125000 });
  assert.equal(response.json().items[0].primaryImage.url, "https://cdn.fiaaevolution.com/products/D5468/main.webp");

  const invalid = await app.inject({ method: "GET", url: "/v1/search?year=not-a-year" });
  assert.equal(invalid.statusCode, 400);
  assert.equal(invalid.headers["content-type"], "application/problem+json; charset=utf-8");
  assert.equal(invalid.json().code, "invalid-request");
});

test("product and content routes return public records and safe not-found responses", async () => {
  const db = database(async text => {
    if (text.includes("storefront_product_details")) return { rows: [{
      id: "0068f486-d9cb-4201-8fe2-6194025b787e", sku: "D5468", slug: "fiaa-d5468-front-brake-pad",
      name: "FIAA D5468 Front Brake Pad", product_kind: "brake_pad", category_name: "Brake Pads",
      short_description: "Front brake pad set", description: "Verified product description", axle_position: "front",
      currency: "NGN", amount_minor: 125000, available_quantity: 8, width_mm: "120.5", height_mm: null,
      thickness_mm: "16.0", warranty_text: "Published warranty terms apply.",
      images: [{ storageKey: "products/D5468/main image.webp", alt: "FIAA D5468 brake pad", role: "primary", width: 1200, height: 900 }],
      oem_references: [{ reference: "04465-0E010" }], fitments: [{ make: "Toyota", model: "Camry", yearStart: 2012, yearEnd: 2017 }]
    }] };
    return { rows: [] };
  });
  const app = await application(db);
  const product = await app.inject({ method: "GET", url: "/v1/products/fiaa-d5468-front-brake-pad" });
  assert.equal(product.statusCode, 200);
  assert.equal(product.json().primaryImage.url, "https://cdn.fiaaevolution.com/products/D5468/main%20image.webp");
  assert.equal(product.json().widthMm, 120.5);

  const page = await app.inject({ method: "GET", url: "/products/fiaa-d5468-front-brake-pad" });
  assert.equal(page.statusCode, 200);
  assert.match(page.headers["content-type"], /text\/html/);
  assert.match(page.body, /<link rel="canonical" href="https:\/\/www\.fiaaevolution\.com\/products\/fiaa-d5468-front-brake-pad">/);
  assert.match(page.body, /"@type":"Product"/);
  assert.match(page.body, /data-sku="D5468"/);
  const pageNonce = page.body.match(/application\/ld\+json" nonce="([^"]+)"/)?.[1];
  assert.ok(pageNonce);
  assert.match(page.headers["content-security-policy"], new RegExp(`nonce-${pageNonce}`));

  const content = await app.inject({ method: "GET", url: "/v1/content/privacy-policy" });
  assert.equal(content.statusCode, 404);
  assert.equal(content.json().code, "content-not-found");
});

test("published content pages render durable metadata and sanitized owner content", async () => {
  const db = database(async () => ({ rows: [{
    slug: "delivery", title: "Delivery information", page_type: "policy", excerpt: "How FIAA delivers orders.",
    body_html: '<h2>Delivery</h2><p>Approved wording.</p><script>alert(1)</script><a href="javascript:alert(2)" onclick="alert(3)">unsafe</a><a href="https://www.fiaaevolution.com/support">support</a>',
    meta_title: "FIAA Delivery Information", meta_description: "Owner-approved FIAA delivery information for customer orders.",
    current_version: 2, published_at: "2026-09-29T12:00:00.000Z"
  }] }));
  const app = await application(db);
  const response = await app.inject({ method: "GET", url: "/pages/delivery" });
  assert.equal(response.statusCode, 200);
  assert.match(response.body, /<title>FIAA Delivery Information<\/title>/);
  assert.match(response.body, /Approved wording/);
  assert.match(response.body, /href="https:\/\/www\.fiaaevolution\.com\/support"/);
  assert.doesNotMatch(response.body, /<script|onclick|javascript:/);
});

test("cart creation stores only a token hash and sets a checkout-compatible secure cookie", async () => {
  const db = database(async () => ({ rows: [{ id: cartRow.id, status: "active", expires_at: cartRow.expiresAt }] }));
  const app = await application(db);
  const response = await app.inject({ method: "POST", url: "/v1/carts" });
  assert.equal(response.statusCode, 201);
  assert.match(db.calls[0].params[0], /^[a-f0-9]{64}$/);
  const cookie = response.headers["set-cookie"];
  assert.match(cookie, /fiaa_cart=/);
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /Path=\/v1(?:;|$)/);
  assert.match(cookie, /SameSite=Lax/i);
});

test("cart access requires its signed cookie and returns server-calculated totals", async () => {
  let created = false;
  const db = database(async text => {
    if (text.includes("create_anonymous_cart")) {
      created = true;
      return { rows: [{ id: cartRow.id, status: "active", expires_at: cartRow.expiresAt }] };
    }
    if (text.includes("get_anonymous_cart")) return { rows: [{ cart: cartRow }] };
    return { rows: [] };
  });
  const app = await application(db);
  const missing = await app.inject({ method: "GET", url: `/v1/carts/${cartRow.id}` });
  assert.equal(missing.statusCode, 401);

  const create = await app.inject({ method: "POST", url: "/v1/carts" });
  assert.equal(created, true);
  const cookie = create.headers["set-cookie"].split(";")[0];
  const response = await app.inject({ method: "GET", url: `/v1/carts/${cartRow.id}`, headers: { cookie } });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json().subtotal, { currency: "NGN", amountMinor: 250000 });
  assert.equal(response.json().items[0].lineTotal.amountMinor, 250000);
});

test("cart mutations reject invalid quantities before touching the database", async () => {
  const db = database();
  const app = await application(db);
  const response = await app.inject({
    method: "PUT",
    url: `/v1/carts/${cartRow.id}/items/D5468`,
    payload: { quantity: 101 }
  });
  assert.equal(response.statusCode, 400);
  assert.equal(db.calls.length, 0);
});

test("responses include security and configured CORS headers", async () => {
  const app = await application(database());
  const response = await app.inject({
    method: "GET", url: "/health/live", headers: { origin: config.publicWebOrigin }
  });
  assert.equal(response.headers["access-control-allow-origin"], config.publicWebOrigin);
  assert.equal(response.headers["access-control-allow-credentials"], "true");
  assert.equal(response.headers["x-content-type-options"], "nosniff");
  assert.equal(response.headers["x-frame-options"], "SAMEORIGIN");
  assert.match(response.headers["content-security-policy"], /default-src 'self'/);
  assert.match(response.headers["content-security-policy"], /frame-ancestors 'none'/);
  assert.match(response.headers["content-security-policy"], /script-src-attr 'none'/);
});

test("production process serves only public storefront files", async () => {
  const app = await application(database());
  const home = await app.inject({ method: "GET", url: "/" });
  assert.equal(home.statusCode, 200);
  assert.match(home.headers["content-type"], /text\/html/);
  assert.match(home.headers["cache-control"], /no-cache/);
  const script = await app.inject({ method: "GET", url: "/app.js" });
  assert.equal(script.statusCode, 200);
  const privateFile = await app.inject({ method: "GET", url: "/README.md" });
  assert.equal(privateFile.statusCode, 404);
  const environment = await app.inject({ method: "GET", url: "/.env.example" });
  assert.equal(environment.statusCode, 404);
  const productScript = await app.inject({ method: "GET", url: "/product-page.js" });
  assert.equal(productScript.statusCode, 200);
  const orderScript = await app.inject({ method: "GET", url: "/order-page.js" });
  assert.equal(orderScript.statusCode, 200);
});

test("robots default to no-index and sitemap contains only published database slugs", async () => {
  const db = database(async text => {
    if (text.includes("from storefront_products")) return { rows: [{ slug: "approved-brake-pad" }] };
    if (text.includes("from public_content_pages")) return { rows: [{ slug: "delivery" }] };
    return { rows: [] };
  });
  const app = await application(db);
  const robots = await app.inject({ method: "GET", url: "/robots.txt" });
  assert.equal(robots.statusCode, 200);
  assert.match(robots.body, /Disallow: \//);
  assert.match(robots.body, /https:\/\/www\.fiaaevolution\.com\/sitemap\.xml/);
  const sitemap = await app.inject({ method: "GET", url: "/sitemap.xml" });
  assert.equal(sitemap.statusCode, 200);
  assert.match(sitemap.body, /https:\/\/www\.fiaaevolution\.com\/products\/approved-brake-pad/);
  assert.match(sitemap.body, /https:\/\/www\.fiaaevolution\.com\/pages\/delivery/);
  assert.doesNotMatch(sitemap.body, /draft/);
});

test("checkout is authenticated, idempotent and establishes a private HttpOnly order session", async () => {
  const order = {
    orderNumber: "FIAA-20260927-001000", status: "pending_payment", currency: "NGN",
    subtotalMinor: 250000, deliveryMinor: 50000, discountMinor: 0, totalMinor: 300000,
    placedAt: "2026-09-27T12:00:00.000Z", items: [{ sku: "D5468", name: "FIAA D5468", quantity: 2, unitAmountMinor: 125000, lineAmountMinor: 250000 }]
  };
  const checkoutHashes = [];
  const db = database(async (text, params) => {
    if (text.includes("create_anonymous_cart")) return { rows: [{ id: cartRow.id, status: "active", expires_at: cartRow.expiresAt }] };
    if (text.includes("create_customer_checkout")) { checkoutHashes.push(params[3]); return { rows: [{ order_id: "0068f486-d9cb-4201-8fe2-6194025b787e", order_number: order.orderNumber, was_created: checkoutHashes.length === 1 }] }; }
    if (text.includes("get_customer_order")) return { rows: [{ order }] };
    return { rows: [] };
  });
  const app = await application(db);
  const createdCart = await app.inject({ method: "POST", url: "/v1/carts" });
  const cookie = createdCart.headers["set-cookie"].split(";")[0];
  const request = {
    method: "POST", url: "/v1/checkout", headers: { cookie, "idempotency-key": "checkout-20260927-unique-0001" },
    payload: { cartId: cartRow.id, customer: { fullName: "Ada Okafor", phone: "+2348012345678", email: "ada@example.com" }, deliveryMethod: "lagos", address: { line1: "12 Test Street", city: "Lagos", state: "Lagos" } }
  };
  const first = await app.inject(request);
  const replay = await app.inject(request);
  assert.equal(first.statusCode, 201);
  assert.equal(replay.statusCode, 200);
  assert.deepEqual(first.json().orderAccess, { mode: "httpOnlyCookie" });
  assert.deepEqual(replay.json().orderAccess, { mode: "httpOnlyCookie" });
  assert.match(first.headers["set-cookie"], /fiaa_order=/);
  assert.match(first.headers["set-cookie"], /HttpOnly/i);
  assert.match(first.headers["set-cookie"], /SameSite=Strict/i);
  assert.match(first.headers["set-cookie"], new RegExp(`Path=/v1/orders/${order.orderNumber}`));
  assert.equal(first.json().order.total.amountMinor, 300000);
  assert.equal(first.json().payment.status, "pending");
  assert.deepEqual(checkoutHashes, [checkoutHashes[0], checkoutHashes[0]]);
});

test("checkout creates an idempotent HTTPS payment authorization through the configured provider", async () => {
  const orderId = "0068f486-d9cb-4201-8fe2-6194025b787e";
  const orderNumber = "FIAA-20260927-001000";
  const order = { orderNumber, status: "pending_payment", currency: "NGN", subtotalMinor: 250000, deliveryMinor: 50000, discountMinor: 0, totalMinor: 300000, placedAt: "2026-09-27T12:00:00.000Z", items: [{ sku: "D5468", name: "FIAA D5468", quantity: 2, unitAmountMinor: 125000, lineAmountMinor: 250000 }] };
  const db = database(async text => {
    if (text.includes("create_anonymous_cart")) return { rows: [{ id: cartRow.id, status: "active", expires_at: cartRow.expiresAt }] };
    if (text.includes("create_customer_checkout")) return { rows: [{ order_id: orderId, order_number: orderNumber, was_created: true }] };
    if (text.includes("get_customer_order")) return { rows: [{ order }] };
    return { rows: [] };
  });
  let authorizationInput;
  const paymentProviders = new Map([["approved-provider", { async createAuthorization(input) {
    authorizationInput = input;
    return { authorizationUrl: "https://payments.example.com/authorize/secure-123" };
  } }]]);
  const app = await buildApp({ db, config: { ...config, paymentProvider: "approved-provider" }, paymentProviders });
  test.after(() => app.close());
  const createdCart = await app.inject({ method: "POST", url: "/v1/carts" });
  const cookie = createdCart.headers["set-cookie"].split(";")[0];
  const response = await app.inject({
    method: "POST", url: "/v1/checkout", headers: { cookie, "idempotency-key": "checkout-provider-unique-0001" },
    payload: { cartId: cartRow.id, customer: { fullName: "Ada Okafor", phone: "+2348012345678", email: "ada@example.com" }, deliveryMethod: "lagos", address: { line1: "12 Test Street", city: "Lagos", state: "Lagos" } }
  });
  assert.equal(response.statusCode, 201);
  assert.deepEqual(response.json().payment, { status: "requires_action", authorizationUrl: "https://payments.example.com/authorize/secure-123" });
  assert.equal(authorizationInput.orderId, orderId);
  assert.equal(authorizationInput.amountMinor, 300000);
  assert.equal(authorizationInput.currency, "NGN");
  assert.equal(authorizationInput.idempotencyKey, "checkout-provider-unique-0001");
  assert.equal(authorizationInput.callbackUrl, `https://www.fiaaevolution.com/orders/${orderNumber}`);
});

test("production application refuses to start without the selected payment adapter", async () => {
  await assert.rejects(
    () => buildApp({ db: database(), config: { ...config, nodeEnv: "production", paymentProvider: "approved-provider" } }),
    /approved payment provider adapter/
  );
});

test("delivery methods expose only database-approved choices and server fees", async () => {
  const db = database(async text => {
    assert.equal(text, "select * from public_delivery_methods");
    return { rows: [{ code: "lagos", name: "Lagos delivery", description: "Owner-approved delivery", fee_minor: 250000, currency: "NGN", requires_address: true }] };
  });
  const app = await application(db);
  const response = await app.inject({ method: "GET", url: "/v1/delivery-methods" });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json().items[0], { code: "lagos", name: "Lagos delivery", description: "Owner-approved delivery", fee: { currency: "NGN", amountMinor: 250000 }, requiresAddress: true });
});

test("customer order lookup accepts only a matching private cookie or bearer token", async () => {
  let receivedHash;
  const db = database(async (_text, params) => {
    receivedHash = params[1];
    return { rows: [{ order: { orderNumber: "FIAA-20260927-001000", status: "paid", currency: "NGN", subtotalMinor: 1, deliveryMinor: 0, discountMinor: 0, totalMinor: 1, placedAt: "2026-09-27T12:00:00.000Z", items: [{ sku: "A", name: "Accessory", quantity: 1, unitAmountMinor: 1, lineAmountMinor: 1 }] } }] };
  });
  const app = await application(db);
  const unauthorized = await app.inject({ method: "GET", url: "/v1/orders/FIAA-20260927-001000" });
  assert.equal(unauthorized.statusCode, 401);
  const token = "A".repeat(43);
  const response = await app.inject({ method: "GET", url: "/v1/orders/FIAA-20260927-001000", headers: { authorization: `Bearer ${token}` } });
  assert.equal(response.statusCode, 200);
  assert.match(receivedHash, /^[a-f0-9]{64}$/);

  const cookieResponse = await app.inject({ method: "GET", url: "/v1/orders/FIAA-20260927-001000", headers: { cookie: `fiaa_order=${token}` } });
  assert.equal(cookieResponse.statusCode, 200);
  assert.match(receivedHash, /^[a-f0-9]{64}$/);
});

test("private order status page is noindex and does not query order data by public number", async () => {
  const db = database(() => {
    throw new Error("HTML shell must not query private order data");
  });
  const app = await application(db);
  const response = await app.inject({ method: "GET", url: "/orders/FIAA-20260930-001234" });
  assert.equal(response.statusCode, 200);
  assert.match(response.body, /name="robots" content="noindex,nofollow"/);
  assert.match(response.body, /data-order-number="FIAA-20260930-001234"/);
  assert.doesNotMatch(response.body, /customer|address|phone/i);
  assert.equal(db.calls.length, 0);
});

test("payment webhook verifies the exact raw body before recording payment", async () => {
  let verified;
  const providers = new Map([["approved-provider", { async verifyAndNormalize(input) {
    verified = input;
    return { successful: true, orderId: "0068f486-d9cb-4201-8fe2-6194025b787e", reference: "pay-123", idempotencyKey: "approved-provider:event-123", amountMinor: 300000, currency: "NGN", payload: input.body };
  } }]]);
  const db = database(async () => ({ rows: [{ order_id: "0068f486-d9cb-4201-8fe2-6194025b787e" }] }));
  const app = await buildApp({ db, config, paymentProviders: providers });
  test.after(() => app.close());
  const raw = '{"event":"payment.success","amount":300000}';
  const response = await app.inject({ method: "POST", url: "/v1/webhooks/payments/approved-provider", headers: { "content-type": "application/json", "x-signature": "signed" }, payload: raw });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { received: true, processed: true });
  assert.equal(verified.rawBody.toString("utf8"), raw);
  assert.deepEqual(db.calls[0].params.slice(0, 6), ["0068f486-d9cb-4201-8fe2-6194025b787e", "approved-provider", "pay-123", "approved-provider:event-123", 300000, "NGN"]);
});

test("payment webhook rejects disabled providers and bad signatures", async () => {
  const providers = new Map([["enabled", { async verifyAndNormalize() { return null; } }]]);
  const app = await buildApp({ db: database(), config, paymentProviders: providers });
  test.after(() => app.close());
  const disabled = await app.inject({ method: "POST", url: "/v1/webhooks/payments/disabled", payload: {} });
  assert.equal(disabled.statusCode, 404);
  const invalid = await app.inject({ method: "POST", url: "/v1/webhooks/payments/enabled", payload: {} });
  assert.equal(invalid.statusCode, 401);
});

test("admin routes fail closed and inject verified staff identity transactionally", async () => {
  const productId = "0068f486-d9cb-4201-8fe2-6194025b787e";
  const db = database(async text => {
    if (text.includes("set_config")) return { rows: [] };
    if (text.includes("product_publication_problems")) return { rows: [{ problems: ["Missing owner-verified primary image"] }] };
    if (text.includes("admin_transition_product")) return { rows: [{ id: productId, sku: "D5468", publication_status: "review", updated_at: "2026-09-27T12:00:00.000Z" }] };
    return { rows: [] };
  });
  const app = await buildApp({ db, adminDb: db, config, adminAuthenticator: { async authenticate(token) { return token === "valid-staff-token" ? { subject: "identity|owner-1" } : null; } } });
  test.after(() => app.close());

  const missing = await app.inject({ method: "GET", url: `/v1/admin/products/${productId}/publication-problems` });
  assert.equal(missing.statusCode, 401);
  const response = await app.inject({ method: "GET", url: `/v1/admin/products/${productId}/publication-problems`, headers: { authorization: "Bearer valid-staff-token" } });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { problems: ["Missing owner-verified primary image"], ready: false });
  assert.deepEqual(db.calls.at(-2).params, ["identity|owner-1"]);

  const changed = await app.inject({ method: "POST", url: `/v1/admin/products/${productId}/status`, headers: { authorization: "Bearer valid-staff-token" }, payload: { status: "review", reason: "Ready for owner review" } });
  assert.equal(changed.statusCode, 200);
  assert.equal(changed.json().status, "review");
});

test("admin catalogue and order lists are role-gated, filtered and paginated", async () => {
  const productId = "0068f486-d9cb-4201-8fe2-6194025b787e";
  const orderId = "d62a06f7-0cc4-4d31-b05f-08e0861b32d2";
  const db = database(async text => {
    if (text.includes("set_config") || text.includes("require_staff_role")) return { rows: [] };
    if (text.includes("from products p") && text.includes("count(*) over")) return { rows: [{
      id: productId, sku: "D5468", slug: "fiaa-d5468-front-brake-pad", name: "FIAA D5468 Front Brake Pad",
      product_kind: "brake_pad", publication_status: "review", owner_verified_at: null,
      updated_at: "2026-09-30T12:00:00.000Z", problems: ["Missing owner verification"], total_count: 1
    }] };
    if (text.includes("from products p") && text.includes("where p.id=$1")) return { rows: [{
      id: productId, sku: "D5468", slug: "fiaa-d5468-front-brake-pad", name: "FIAA D5468 Front Brake Pad",
      product_kind: "brake_pad", category_name: "Brake Pads", publication_status: "review",
      short_description: "Front brake pad set", description: "Owner-reviewed product description", axle_position: "front",
      width_mm: "120.5", height_mm: "55", thickness_mm: "16", warranty_text: null,
      owner_verified_at: null, owner_verified_by: null, published_at: null, updated_at: "2026-09-30T12:00:00.000Z",
      problems: ["Missing owner verification"], prices: [], images: [], oem_references: [{ reference: "04465-0E010" }],
      fitments: [], inventory: [{ location: "Main", code: "MAIN", onHand: 5, reserved: 1, available: 4, reorderLevel: 2 }], history: []
    }] };
    if (text.includes("from orders o") && text.includes("count(*) over")) return { rows: [{
      id: orderId, order_number: "FIAA-20260930-001234", status: "paid", currency: "NGN", total_minor: 250000,
      placed_at: "2026-09-30T12:00:00.000Z", updated_at: "2026-09-30T12:05:00.000Z",
      customer_name: "Ada Okafor", customer_phone: "+2348012345678", total_count: 1
    }] };
    if (text.includes("from orders o") && text.includes("where o.id=$1")) return { rows: [{
      id: orderId, order_number: "FIAA-20260930-001234", status: "paid", currency: "NGN",
      subtotal_minor: 240000, delivery_minor: 10000, discount_minor: 0, total_minor: 250000,
      customer_name: "Ada Okafor", customer_phone: "+2348012345678", customer_email: "ada@example.com",
      delivery_code: "lagos", delivery_name: "Lagos delivery", address: { recipientName: "Ada Okafor", line1: "12 Test Street", city: "Lagos", state: "Lagos" },
      items: [{ sku: "D5468", name: "FIAA D5468", quantity: 2, unitAmountMinor: 120000, lineAmountMinor: 240000, fitment: { position: "front" } }],
      payments: [{ provider: "approved", status: "successful", amountMinor: 250000, currency: "NGN" }], shipments: [],
      customer_note: null, internal_note: null, placed_at: "2026-09-30T12:00:00.000Z", updated_at: "2026-09-30T12:05:00.000Z"
    }] };
    if (text.includes("admin_transition_order")) return { rows: [{
      id: orderId, order_number: "FIAA-20260930-001234", status: "processing", updated_at: "2026-09-30T12:10:00.000Z"
    }] };
    if (text.includes("admin_upsert_shipment")) return { rows: [{
      id: "4572bb8d-f75b-43e5-86df-9f3d64c8f662", order_id: orderId, carrier: "DHL", tracking_number: "TRACK-100",
      status: "ready", shipped_at: null, delivered_at: null, updated_at: "2026-09-30T12:11:00.000Z"
    }] };
    return { rows: [] };
  });
  const app = await buildApp({ db, adminDb: db, config, adminAuthenticator: { async authenticate() { return { subject: "identity|staff-1" }; } } });
  test.after(() => app.close());

  const products = await app.inject({ method: "GET", url: "/v1/admin/products?q=D5468&status=review&limit=10&offset=5", headers: { authorization: "Bearer valid" } });
  assert.equal(products.statusCode, 200);
  assert.equal(products.json().items[0].ready, false);
  assert.equal(products.json().total, 1);
  const productQuery = db.calls.find(call => call.text.includes("from products p"));
  assert.deepEqual(productQuery.params, ["review", "D5468", 10, 5]);

  const product = await app.inject({ method: "GET", url: `/v1/admin/products/${productId}`, headers: { authorization: "Bearer valid" } });
  assert.equal(product.statusCode, 200);
  assert.equal(product.json().dimensionsMm.width, 120.5);
  assert.equal(product.json().inventory[0].available, 4);
  assert.equal(product.json().ready, false);

  const orders = await app.inject({ method: "GET", url: "/v1/admin/orders?q=001234&status=paid", headers: { authorization: "Bearer valid" } });
  assert.equal(orders.statusCode, 200);
  assert.deepEqual(orders.json().items[0].total, { currency: "NGN", amountMinor: 250000 });
  assert.equal(orders.json().items[0].customer.phone, "+2348012345678");

  const order = await app.inject({ method: "GET", url: `/v1/admin/orders/${orderId}`, headers: { authorization: "Bearer valid" } });
  assert.equal(order.statusCode, 200);
  assert.equal(order.json().items[0].sku, "D5468");
  assert.deepEqual(order.json().total, { currency: "NGN", amountMinor: 250000 });

  const transitioned = await app.inject({ method: "POST", url: `/v1/admin/orders/${orderId}/status`, headers: { authorization: "Bearer valid" }, payload: { status: "processing", reason: "Payment confirmed and order accepted" } });
  assert.equal(transitioned.statusCode, 200);
  assert.equal(transitioned.json().status, "processing");
  const transitionQuery = db.calls.find(call => call.text.includes("admin_transition_order"));
  assert.deepEqual(transitionQuery.params, [orderId, "processing", "Payment confirmed and order accepted"]);

  const shipment = await app.inject({ method: "PUT", url: `/v1/admin/orders/${orderId}/shipment`, headers: { authorization: "Bearer valid" }, payload: { carrier: "DHL", trackingNumber: "TRACK-100", status: "ready", reason: "Carrier booking confirmed" } });
  assert.equal(shipment.statusCode, 200);
  assert.equal(shipment.json().trackingNumber, "TRACK-100");
  const shipmentQuery = db.calls.find(call => call.text.includes("admin_upsert_shipment"));
  assert.deepEqual(shipmentQuery.params, [orderId, "DHL", "TRACK-100", "ready", "Carrier booking confirmed"]);

  const invalid = await app.inject({ method: "GET", url: "/v1/admin/orders?status=unknown", headers: { authorization: "Bearer valid" } });
  assert.equal(invalid.statusCode, 400);
});

test("admin content queue reports governed publication readiness", async () => {
  const pageId = "d62a06f7-0cc4-4d31-b05f-08e0861b32d2";
  const db = database(async text => {
    if (text.includes("set_config") || text.includes("require_staff_role")) return { rows: [] };
    if (text.includes("from content_pages p")) return { rows: [{
      id: pageId, slug: "delivery", title: "Delivery information", page_type: "policy",
      publication_status: "review", current_version: 3, owner_verified_at: null, published_at: null,
      updated_at: "2026-09-30T12:00:00.000Z", problems: ["Missing owner verification"], total_count: 1
    }] };
    return { rows: [] };
  });
  const app = await buildApp({ db, adminDb: db, config, adminAuthenticator: { async authenticate() { return { subject: "identity|content-1" }; } } });
  test.after(() => app.close());
  const response = await app.inject({ method: "GET", url: "/v1/admin/content?q=delivery&status=review&pageType=policy&limit=10", headers: { authorization: "Bearer valid" } });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().items[0].version, 3);
  assert.equal(response.json().items[0].ready, false);
  const query = db.calls.find(call => call.text.includes("from content_pages p"));
  assert.deepEqual(query.params, ["review", "policy", "delivery", 10, 0]);
});

test("admin content drafting sanitizes HTML and launch readiness remains owner-governed", async () => {
  const pageId = "d62a06f7-0cc4-4d31-b05f-08e0861b32d2";
  let saveParams;
  const db = database(async (text, params) => {
    if (text.includes("set_config") || text.includes("require_staff_role")) return { rows: [] };
    if (text.includes("admin_save_content")) {
      saveParams = params;
      return { rows: [{ id: pageId, slug: "delivery", title: "Delivery information", page_type: "policy", publication_status: "draft", current_version: 1, updated_at: "2026-09-30T12:00:00.000Z" }] };
    }
    if (text.includes("content_launch_readiness")) return { rows: [{ slug: "delivery", display_name: "Delivery information", status: "ready", current_version: 2, published_at: "2026-09-30T12:00:00.000Z" }, { slug: "privacy", display_name: "Privacy policy", status: "missing", current_version: null, published_at: null }] };
    if (text.includes("from products group")) return { rows: [{ status: "draft", count: 39 }] };
    if (text.includes("notification_outbox group")) return { rows: [{ status: "pending", count: 2 }] };
    return { rows: [] };
  });
  const auth = { async authenticate() { return { subject: "identity|content-1" }; } };
  const app = await buildApp({ db, adminDb: db, config, adminAuthenticator: auth });
  test.after(() => app.close());
  const longText = "FIAA confirms delivery destinations, charges and timing before dispatch. ".repeat(3);
  const saved = await app.inject({ method: "POST", url: "/v1/admin/content/drafts", headers: { authorization: "Bearer valid" }, payload: { slug: "delivery", title: "Delivery information", pageType: "policy", excerpt: "How delivery works.", bodyHtml: `<h2>Delivery</h2><p>${longText}</p><script>alert(1)</script>`, metaTitle: "FIAA Delivery Information", metaDescription: "Read owner-approved FIAA delivery information for customer orders.", changeSummary: "Initial approved operational draft" } });
  assert.equal(saved.statusCode, 201);
  assert.equal(saved.json().status, "draft");
  assert.doesNotMatch(saveParams[5], /script|alert/);

  const readiness = await app.inject({ method: "GET", url: "/v1/admin/launch-readiness", headers: { authorization: "Bearer valid" } });
  assert.equal(readiness.statusCode, 200);
  assert.equal(readiness.json().requiredContentReady, false);
  assert.equal(readiness.json().content.length, 2);
});
