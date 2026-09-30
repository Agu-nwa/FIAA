import Fastify from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import staticFiles from "@fastify/static";
import sanitizeHtml from "sanitize-html";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { assetUrl, createOpaqueToken, deriveOpaqueToken, hashOpaqueToken, money, problem } from "./lib.js";

const uuid = z.string().uuid();
const searchQuery = z.object({
  q: z.string().trim().max(120).optional(),
  make: z.string().trim().max(80).optional(),
  model: z.string().trim().max(100).optional(),
  year: z.coerce.number().int().min(1900).max(2200).optional(),
  position: z.enum(["front", "rear", "front_or_rear"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(24),
  offset: z.coerce.number().int().min(0).default(0)
});
const slugParam = z.object({ slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/) });
const cartParam = z.object({ cartId: uuid });
const cartItemParam = z.object({ cartId: uuid, sku: z.string().min(1).max(100) });
const quantityBody = z.object({ quantity: z.number().int().min(0).max(100) }).strict();
const checkoutBody = z.object({
  cartId: uuid,
  customer: z.object({
    fullName: z.string().trim().min(2).max(150),
    phone: z.string().regex(/^\+[1-9][0-9]{7,14}$/),
    email: z.string().email().nullable().optional()
  }).strict(),
  deliveryMethod: z.string().trim().min(2).max(80),
  address: z.object({
    line1: z.string().trim().min(3).max(200), line2: z.string().trim().max(200).nullable().optional(),
    city: z.string().trim().min(2).max(100), state: z.string().trim().min(2).max(100),
    notes: z.string().trim().max(500).nullable().optional()
  }).strict().nullable().optional(),
  customerNote: z.string().trim().max(1000).nullable().optional()
}).strict();
const orderParam = z.object({ orderNumber: z.string().regex(/^FIAA-[0-9]{8}-[0-9]{6}$/) });
const idempotencyHeader = z.string().min(24).max(200).regex(/^[A-Za-z0-9._~-]+$/);
const providerParam = z.object({ provider: z.string().regex(/^[a-z0-9][a-z0-9-]{1,49}$/) });
const productAdminParam = z.object({ productId: uuid });
const contentAdminParam = z.object({ pageId: uuid });
const productStatusBody = z.object({ status: z.enum(["draft", "review", "approved", "published", "archived"]), reason: z.string().trim().min(5).max(1000) }).strict();
const publishContentBody = z.object({ reason: z.string().trim().min(5).max(1000) }).strict();
const saveContentBody = z.object({
  pageId: uuid.nullable().optional(),
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  title: z.string().trim().min(2).max(200),
  pageType: z.enum(["guide", "policy", "support", "company"]),
  excerpt: z.string().trim().max(500).nullable().optional(),
  bodyHtml: z.string().min(120).max(100000),
  metaTitle: z.string().trim().min(1).max(60),
  metaDescription: z.string().trim().min(1).max(160),
  changeSummary: z.string().trim().min(5).max(1000)
}).strict();
const adminProductListQuery = z.object({
  q: z.string().trim().max(120).optional(),
  status: z.enum(["draft", "review", "approved", "published", "archived"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).default(0)
});
const adminOrderListQuery = z.object({
  q: z.string().trim().max(120).optional(),
  status: z.enum(["pending_payment", "paid", "processing", "ready_for_pickup", "shipped", "delivered", "cancelled", "refunded"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).default(0)
});
const orderAdminParam = z.object({ orderId: uuid });
const orderStatusBody = z.object({
  status: z.enum(["pending_payment", "paid", "processing", "ready_for_pickup", "shipped", "delivered", "cancelled", "refunded"]),
  reason: z.string().trim().min(5).max(1000)
}).strict();
const shipmentBody = z.object({
  carrier: z.string().trim().min(2).max(120),
  trackingNumber: z.string().trim().min(3).max(200),
  status: z.enum(["ready", "collected", "in_transit", "delivered", "returned", "cancelled"]),
  reason: z.string().trim().min(5).max(1000)
}).strict();
const adminContentListQuery = z.object({
  q: z.string().trim().max(120).optional(),
  status: z.enum(["draft", "review", "published", "archived"]).optional(),
  pageType: z.enum(["guide", "policy", "support", "company"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).default(0)
});

function parseOrReply(schema, value, request, reply) {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  reply.code(400).type("application/problem+json").send({
    ...problem(400, "invalid-request", "Invalid request", "One or more request values are invalid.", request.url),
    errors: result.error.issues.map(issue => ({ field: issue.path.join("."), message: issue.message }))
  });
  return null;
}

function mapImage(image, config) {
  return {
    url: assetUrl(config.publicAssetBaseUrl, image.storageKey),
    alt: image.alt,
    role: image.role,
    width: image.width,
    height: image.height
  };
}

function mapProductSummary(row, config) {
  const images = row.images || [];
  const primary = images.find?.(image => image.role === "primary");
  return {
    id: row.id,
    sku: row.sku,
    slug: row.slug,
    name: row.name,
    productKind: row.product_kind,
    category: row.category_name,
    shortDescription: row.short_description,
    axlePosition: row.axle_position,
    price: money(row.currency, row.amount_minor),
    availableQuantity: Number(row.available_quantity),
    primaryImage: primary ? mapImage(primary, config) : null
  };
}

function mapProductDetail(row, config) {
  const images = (row.images || []).map(image => mapImage(image, config));
  return {
    ...mapProductSummary(row, config),
    description: row.description,
    widthMm: row.width_mm == null ? null : Number(row.width_mm),
    heightMm: row.height_mm == null ? null : Number(row.height_mm),
    thicknessMm: row.thickness_mm == null ? null : Number(row.thickness_mm),
    warrantyText: row.warranty_text,
    primaryImage: images.find(image => image.role === "primary") || null,
    images,
    oemReferences: (row.oem_references || []).map(item => item.reference),
    fitments: row.fitments || []
  };
}

function mapCart(cart) {
  const currency = String(cart.currency || "NGN").trim();
  return {
    id: cart.id,
    status: cart.status,
    expiresAt: cart.expiresAt,
    currency,
    itemCount: Number(cart.itemCount),
    subtotal: money(currency, cart.subtotalMinor),
    items: (cart.items || []).map(item => ({
      sku: item.sku,
      slug: item.slug,
      name: item.name,
      quantity: Number(item.quantity),
      availableQuantity: Number(item.availableQuantity),
      unitPrice: money(currency, item.unitAmountMinor),
      lineTotal: money(currency, item.lineAmountMinor)
    }))
  };
}

function mapOrder(order) {
  const currency = String(order.currency).trim();
  return {
    orderNumber: order.orderNumber, status: order.status, currency,
    subtotal: money(currency, order.subtotalMinor), delivery: money(currency, order.deliveryMinor),
    discount: money(currency, order.discountMinor), total: money(currency, order.totalMinor),
    items: (order.items || []).map(item => ({
      sku: item.sku, name: item.name, quantity: Number(item.quantity),
      unitPrice: money(currency, item.unitAmountMinor), lineTotal: money(currency, item.lineAmountMinor)
    })),
    placedAt: order.placedAt
  };
}

function html(value) {
  return String(value ?? "").replace(/[&<>'"]/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
}

function xml(value) {
  return html(value);
}

function productDocument(row, config, scriptNonce) {
  const product = mapProductDetail(row, config);
  const canonical = `${config.publicWebOrigin.replace(/\/$/, "")}/products/${encodeURIComponent(product.slug)}`;
  const title = `${product.sku} — ${product.name} | FIAA Evolution`;
  const fitments = product.fitments.map(item => [item.make, item.model, item.yearFrom && item.yearTo ? `${item.yearFrom}–${item.yearTo}` : item.yearFrom || item.yearTo, item.engine, item.trim].filter(Boolean).join(" "));
  const structured = JSON.stringify({
    "@context": "https://schema.org", "@type": "Product", name: product.name, sku: product.sku,
    description: product.shortDescription, image: product.images.map(image => image.url),
    brand: { "@type": "Brand", name: "FIAA Evolution" },
    offers: { "@type": "Offer", url: canonical, priceCurrency: product.price.currency,
      price: (product.price.amountMinor / 100).toFixed(2), availability: product.availableQuantity > 0 ? "https://schema.org/InStock" : "https://schema.org/OutOfStock" }
  }).replace(/</g, "\\u003c");
  const moneyText = new Intl.NumberFormat("en-NG", { style: "currency", currency: product.price.currency }).format(product.price.amountMinor / 100);
  return `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${html(title)}</title><meta name="description" content="${html(product.shortDescription)}"><link rel="canonical" href="${html(canonical)}"><meta property="og:type" content="product"><meta property="og:title" content="${html(title)}"><meta property="og:description" content="${html(product.shortDescription)}"><meta property="og:url" content="${html(canonical)}">${product.primaryImage ? `<meta property="og:image" content="${html(product.primaryImage.url)}">` : ""}<link rel="stylesheet" href="/styles.css"><script type="application/ld+json" nonce="${html(scriptNonce)}">${structured}</script></head><body class="product-page"><header class="product-page-header"><div class="shell"><a href="/" aria-label="FIAA Evolution home"><img src="/assets/fiaa-logo-pack.png" alt="FIAA Evolution" width="142" height="56"></a><a class="button button-secondary" href="/#catalogue">Back to catalogue</a></div></header><main class="shell product-detail-page"><div class="product-detail-media">${product.primaryImage ? `<img src="${html(product.primaryImage.url)}" alt="${html(product.primaryImage.alt)}" width="${product.primaryImage.width}" height="${product.primaryImage.height}">` : ""}</div><article class="product-detail-copy"><span class="eyebrow">${html(product.category)}</span><h1>${html(product.sku)}</h1><h2>${html(product.name)}</h2><p class="product-lead">${html(product.description)}</p><div class="product-page-price"><strong>${html(moneyText)}</strong><span>${product.availableQuantity > 0 ? "Available" : "Currently unavailable"}</span></div>${fitments.length ? `<section class="product-page-fitment"><h3>Verified vehicle fitment</h3><ul>${fitments.map(item => `<li>${html(item)}</li>`).join("")}</ul></section>` : ""}<dl class="spec-list"><div><dt>Product number</dt><dd>${html(product.sku)}</dd></div>${product.axlePosition && product.axlePosition !== "not_applicable" ? `<div><dt>Position</dt><dd>${html(positionLabelServer(product.axlePosition))}</dd></div>` : ""}${product.oemReferences.length ? `<div><dt>OEM references</dt><dd>${product.oemReferences.map(html).join(", ")}</dd></div>` : ""}</dl>${product.availableQuantity > 0 ? `<button class="button button-primary product-page-add" data-sku="${html(product.sku)}">Add to cart</button>` : ""}<p class="product-page-status" role="status" aria-live="polite"></p></article></main><script src="/product-page.js" defer></script></body></html>`;
}

function cleanPublishedHtml(value) {
  return sanitizeHtml(value, {
    allowedTags: ["p", "h2", "h3", "h4", "ul", "ol", "li", "strong", "em", "blockquote", "a", "br", "hr"],
    allowedAttributes: { a: ["href"] },
    allowedSchemes: ["http", "https", "mailto", "tel"],
    allowProtocolRelative: false,
    disallowedTagsMode: "completelyDiscard",
    nonTextTags: ["style", "script", "textarea", "option", "xmp", "noscript", "iframe", "object", "embed"]
  });
}

function contentDocument(row, config) {
  const origin = config.publicWebOrigin.replace(/\/$/, "");
  const canonical = `${origin}/pages/${encodeURIComponent(row.slug)}`;
  return `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${html(row.meta_title)}</title><meta name="description" content="${html(row.meta_description)}"><link rel="canonical" href="${html(canonical)}"><meta property="og:type" content="article"><meta property="og:title" content="${html(row.meta_title)}"><meta property="og:description" content="${html(row.meta_description)}"><meta property="og:url" content="${html(canonical)}"><link rel="stylesheet" href="/styles.css"></head><body class="content-page"><header class="product-page-header"><div class="shell"><a href="/" aria-label="FIAA Evolution home"><img src="/assets/fiaa-logo-pack.png" alt="FIAA Evolution" width="142" height="56"></a><a class="button button-secondary" href="/">Back home</a></div></header><main class="shell content-document"><span class="eyebrow">${html(row.page_type)}</span><h1>${html(row.title)}</h1>${row.excerpt ? `<p class="content-excerpt">${html(row.excerpt)}</p>` : ""}<article class="prose">${cleanPublishedHtml(row.body_html)}</article><p class="content-version">Published version ${Number(row.current_version)}</p></main></body></html>`;
}

function positionLabelServer(value) {
  return ({ front: "Front", rear: "Rear", front_or_rear: "Front or rear" })[value] || value;
}

function cartAccess(request, reply) {
  const signed = request.cookies.fiaa_cart;
  if (!signed) {
    reply.code(401).type("application/problem+json").send(problem(401, "cart-authentication-required", "Cart authentication required", "The cart cookie is missing.", request.url));
    return null;
  }
  const result = request.unsignCookie(signed);
  if (!result.valid) {
    reply.code(401).type("application/problem+json").send(problem(401, "invalid-cart-token", "Invalid cart token", "The cart cookie could not be verified.", request.url));
    return null;
  }
  return { token: result.value, tokenHash: hashOpaqueToken(result.value) };
}

export async function buildApp({ db, adminDb = null, config, logger = false, paymentProviders = new Map(), adminAuthenticator = null }) {
  if (config.nodeEnv === "production" && (!config.paymentProvider || !paymentProviders.has(config.paymentProvider))) {
    throw new Error("Production checkout requires the configured approved payment provider adapter");
  }
  const app = Fastify({ logger, trustProxy: config.trustProxy, bodyLimit: 256 * 1024 });
  app.removeContentTypeParser("application/json");
  app.addContentTypeParser("application/json", { parseAs: "buffer" }, (request, body, done) => {
    request.rawBody = body;
    try { done(null, JSON.parse(body.toString("utf8"))); }
    catch (error) { error.statusCode = 400; done(error); }
  });
  await app.register(helmet, {
    global: true,
    enableCSPNonces: true,
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'self'"],
        connectSrc: ["'self'"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        imgSrc: ["'self'", "https:", "data:"],
        objectSrc: ["'none'"],
        scriptSrc: ["'self'"],
        scriptSrcAttr: ["'none'"],
        styleSrc: ["'self'", "https://fonts.googleapis.com"],
        upgradeInsecureRequests: config.nodeEnv === "production" ? [] : null
      }
    },
    crossOriginEmbedderPolicy: false,
    referrerPolicy: { policy: "strict-origin-when-cross-origin" }
  });
  await app.register(cors, { origin: config.publicWebOrigin, credentials: true, methods: ["GET", "POST", "PUT", "OPTIONS"] });
  await app.register(cookie, { secret: config.cookieSecret, hook: "onRequest" });
  await app.register(rateLimit, { global: true, max: 120, timeWindow: "1 minute" });

  app.get("/products/:slug", async (request, reply) => {
    const params = parseOrReply(slugParam, request.params, request, reply);
    if (!params) return;
    const result = await db.query("select * from storefront_product_details where slug = $1 limit 1", [params.slug]);
    if (!result.rows[0]) return reply.code(404).type("text/html").send("<!doctype html><title>Product not found | FIAA Evolution</title><h1>Product not found</h1><p><a href='/#catalogue'>Return to the catalogue</a></p>");
    return reply.type("text/html; charset=utf-8").send(productDocument(result.rows[0], config, reply.cspNonce.script));
  });

  app.get("/pages/:slug", async (request, reply) => {
    const params = parseOrReply(slugParam, request.params, request, reply);
    if (!params) return;
    const result = await db.query("select * from public_content_pages where slug = $1 limit 1", [params.slug]);
    if (!result.rows[0]) return reply.code(404).type("text/html").send("<!doctype html><title>Page not found | FIAA Evolution</title><h1>Page not found</h1><p><a href='/'>Return home</a></p>");
    return reply.type("text/html; charset=utf-8").send(contentDocument(result.rows[0], config));
  });

  app.get("/orders/:orderNumber", async (request, reply) => {
    const params = parseOrReply(orderParam, request.params, request, reply);
    if (!params) return;
    const number = html(params.orderNumber);
    return reply.type("text/html; charset=utf-8").send(`<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Order ${number} | FIAA Evolution</title><link rel="stylesheet" href="/styles.css"></head><body class="content-page"><header class="product-page-header"><div class="shell"><a href="/" aria-label="FIAA Evolution home"><img src="/assets/fiaa-logo-pack.png" alt="FIAA Evolution" width="142" height="56"></a><a class="button button-secondary" href="/">Back home</a></div></header><main class="shell order-status-page" data-order-number="${number}"><span class="eyebrow">Private order status</span><h1>Order <span>${number}</span></h1><div id="orderStatus" class="order-status-card" aria-live="polite"><p>Loading your order securely…</p></div></main><script src="/order-page.js" defer></script></body></html>`);
  });

  app.get("/robots.txt", { config: { rateLimit: false } }, async (_request, reply) => {
    const origin = config.publicWebOrigin.replace(/\/$/, "");
    const rules = config.publicIndexing ? "User-agent: *\nAllow: /" : "User-agent: *\nDisallow: /";
    return reply.type("text/plain; charset=utf-8").send(`${rules}\nSitemap: ${origin}/sitemap.xml\n`);
  });

  app.get("/sitemap.xml", { config: { rateLimit: false } }, async (_request, reply) => {
    const origin = config.publicWebOrigin.replace(/\/$/, "");
    const [products, pages] = await Promise.all([
      db.query("select slug from storefront_products order by slug"),
      db.query("select slug from public_content_pages order by slug")
    ]);
    const urls = [`${origin}/`, ...products.rows.map(row => `${origin}/products/${encodeURIComponent(row.slug)}`), ...pages.rows.map(row => `${origin}/pages/${encodeURIComponent(row.slug)}`)];
    const document = `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map(url => `<url><loc>${xml(url)}</loc></url>`).join("")}</urlset>`;
    return reply.type("application/xml; charset=utf-8").send(document);
  });

  if (config.serveStorefront !== false) {
    const publicRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
    await app.register(staticFiles, {
      root: publicRoot,
      prefix: "/",
      index: "index.html",
      wildcard: true,
      allowedPath(pathName) {
        const safe = pathName.split(sep).join("/").replace(/^\/+/, "");
        return safe === "index.html" || safe === "app.js" || safe === "product-page.js" || safe === "order-page.js" || safe === "styles.css" || safe.startsWith("assets/");
      },
      setHeaders(response, pathName) {
        const set = typeof response.setHeader === "function" ? response.setHeader.bind(response) : response.header.bind(response);
        if (pathName.endsWith("index.html") || pathName.endsWith("app.js") || pathName.endsWith("styles.css")) {
          set("Cache-Control", "no-cache");
        } else {
          set("Cache-Control", "public, max-age=86400");
        }
      }
    });
    app.get("/", { config: { rateLimit: false } }, (_request, reply) => reply.sendFile("index.html"));
  }

  app.setErrorHandler((error, request, reply) => {
    if (reply.sent) return;
    request.log.error({ err: error, code: error.code }, "Request failed");
    const status = error.code === "42501" ? 403 : error.code === "22023" || error.code === "23514" ? 422 : error.code === "P0001" || error.code === "23505" ? 409 : 500;
    const code = status === 403 ? "forbidden" : status === 422 ? "validation-failed" : status === 409 ? "request-conflict" : "internal-error";
    const title = status === 403 ? "Forbidden" : status === 422 ? "Validation failed" : status === 409 ? "Request conflict" : "Internal server error";
    const detail = status === 500 ? "The server could not complete the request." : "The request cannot be completed in its current form or state.";
    reply.code(status).type("application/problem+json").send(problem(status, code, title, detail, request.url));
  });

  async function staffSubject(request, reply) {
    const match = (request.headers.authorization || "").match(/^Bearer (\S+)$/);
    if (!match || !adminAuthenticator) {
      reply.code(401).type("application/problem+json").send(problem(401, "admin-authentication-required", "Administration authentication required", "A valid staff session is required.", request.url));
      return null;
    }
    const identity = await adminAuthenticator.authenticate(match[1]);
    if (!identity?.subject) {
      reply.code(401).type("application/problem+json").send(problem(401, "invalid-admin-session", "Invalid administration session", "The staff session is invalid or expired.", request.url));
      return null;
    }
    return identity.subject;
  }

  async function asStaff(subject, work) {
    if (!adminDb || typeof adminDb.transaction !== "function") throw new Error("Dedicated administration database credentials are required");
    return adminDb.transaction(async client => {
      await client.query("select set_config('app.auth_subject',$1,true)", [subject]);
      return work(client);
    });
  }

  app.get("/health/live", { config: { rateLimit: false } }, async () => ({ status: "ok" }));
  app.get("/health/ready", { config: { rateLimit: false } }, async (_request, reply) => {
    await db.query("select 1 as ready");
    return reply.send({ status: "ready" });
  });

  app.get("/v1/search", async (request, reply) => {
    const query = parseOrReply(searchQuery, request.query, request, reply);
    if (!query) return;
    const result = await db.query(
      "select result.*, details.images from search_storefront($1,$2,$3,$4,$5,$6,$7) result join storefront_product_details details using(id)",
      [query.q || null, query.make || null, query.model || null, query.year || null, query.position || null, query.limit, query.offset]
    );
    return { items: result.rows.map(row => mapProductSummary(row, config)), count: result.rows.length, limit: query.limit, offset: query.offset };
  });

  app.get("/v1/products/:slug", async (request, reply) => {
    const params = parseOrReply(slugParam, request.params, request, reply);
    if (!params) return;
    const result = await db.query("select * from storefront_product_details where slug = $1 limit 1", [params.slug]);
    if (!result.rows[0]) return reply.code(404).type("application/problem+json").send(problem(404, "product-not-found", "Product not found", "No approved published product matches this address.", request.url));
    return mapProductDetail(result.rows[0], config);
  });

  app.get("/v1/content/:slug", async (request, reply) => {
    const params = parseOrReply(slugParam, request.params, request, reply);
    if (!params) return;
    const result = await db.query("select * from public_content_pages where slug = $1 limit 1", [params.slug]);
    const row = result.rows[0];
    if (!row) return reply.code(404).type("application/problem+json").send(problem(404, "content-not-found", "Page not found", "No approved public page matches this address.", request.url));
    return {
      slug: row.slug, title: row.title, pageType: row.page_type, excerpt: row.excerpt,
      bodyHtml: row.body_html, metaTitle: row.meta_title, metaDescription: row.meta_description,
      version: row.current_version, publishedAt: row.published_at
    };
  });

  app.get("/v1/delivery-methods", async () => {
    const result = await db.query("select * from public_delivery_methods");
    return { items: result.rows.map(row => ({
      code: row.code, name: row.name, description: row.description,
      fee: money(row.currency, row.fee_minor), requiresAddress: row.requires_address
    })) };
  });

  app.post("/v1/carts", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (_request, reply) => {
    const token = createOpaqueToken();
    const tokenHash = hashOpaqueToken(token);
    const result = await db.query("select (create_anonymous_cart($1,$2::interval)).*", [tokenHash, "30 days"]);
    const cart = result.rows[0];
    reply.setCookie("fiaa_cart", token, {
      path: "/v1",
      httpOnly: true,
      secure: config.nodeEnv === "production",
      sameSite: "lax",
      signed: true,
      maxAge: 60 * 60 * 24 * 30
    });
    reply.code(201);
    return { id: cart.id, status: cart.status, expiresAt: cart.expires_at, currency: "NGN", itemCount: 0, subtotal: money("NGN", 0), items: [] };
  });

  app.get("/v1/carts/:cartId", async (request, reply) => {
    const params = parseOrReply(cartParam, request.params, request, reply);
    if (!params) return;
    const access = cartAccess(request, reply);
    if (!access) return;
    const result = await db.query("select get_anonymous_cart($1,$2) as cart", [params.cartId, access.tokenHash]);
    return mapCart(result.rows[0].cart);
  });

  app.put("/v1/carts/:cartId/items/:sku", async (request, reply) => {
    const params = parseOrReply(cartItemParam, request.params, request, reply);
    const body = parseOrReply(quantityBody, request.body, request, reply);
    if (!params || !body) return;
    const access = cartAccess(request, reply);
    if (!access) return;
    await db.query("select * from set_cart_item($1,$2,$3,$4)", [params.cartId, access.tokenHash, params.sku, body.quantity]);
    const result = await db.query("select get_anonymous_cart($1,$2) as cart", [params.cartId, access.tokenHash]);
    return mapCart(result.rows[0].cart);
  });

  app.post("/v1/checkout", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (request, reply) => {
    const body = parseOrReply(checkoutBody, request.body, request, reply);
    const keyResult = idempotencyHeader.safeParse(request.headers["idempotency-key"]);
    if (!body) return;
    if (!keyResult.success) {
      return reply.code(400).type("application/problem+json").send(problem(400, "invalid-idempotency-key", "Invalid idempotency key", "Send a unique 24–200 character Idempotency-Key header.", request.url));
    }
    const access = cartAccess(request, reply);
    if (!access) return;
    const orderToken = deriveOpaqueToken(config.cookieSecret, "order-access", access.token, keyResult.data);
    const address = body.address || {};
    const checkout = await db.query(
      "select * from create_customer_checkout($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)",
      [body.cartId, access.tokenHash, keyResult.data, hashOpaqueToken(orderToken), body.customer.fullName,
        body.customer.phone, body.customer.email || null, body.deliveryMethod, address.line1 || null,
        address.line2 || null, address.city || null, address.state || null, address.notes || null,
        body.customerNote || null]
    );
    const created = checkout.rows[0];
    const result = await db.query("select get_customer_order($1,$2) as order", [created.order_number, hashOpaqueToken(orderToken)]);
    let payment = { status: "pending", authorizationUrl: null };
    if (config.paymentProvider) {
      const provider = paymentProviders.get(config.paymentProvider);
      if (!provider?.createAuthorization) throw new Error("Configured payment provider cannot create payment authorizations");
      const authorization = await provider.createAuthorization({
        orderId: created.order_id, orderNumber: created.order_number,
        amountMinor: result.rows[0].order.totalMinor, currency: result.rows[0].order.currency,
        customer: body.customer, idempotencyKey: keyResult.data,
        callbackUrl: `${config.publicWebOrigin.replace(/\/$/, "")}/orders/${encodeURIComponent(created.order_number)}`
      });
      const authorizationUrl = new URL(authorization.authorizationUrl);
      if (authorizationUrl.protocol !== "https:") throw new Error("Payment authorization URL must use HTTPS");
      payment = { status: "requires_action", authorizationUrl: authorizationUrl.href };
    }
    reply.setCookie("fiaa_order", orderToken, {
      path: `/v1/orders/${created.order_number}`,
      httpOnly: true,
      secure: config.nodeEnv === "production",
      sameSite: "strict",
      maxAge: 60 * 60 * 24 * 90
    });
    reply.code(created.was_created ? 201 : 200);
    return { order: mapOrder(result.rows[0].order), orderAccess: { mode: "httpOnlyCookie" }, payment };
  });

  app.get("/v1/orders/:orderNumber", async (request, reply) => {
    const params = parseOrReply(orderParam, request.params, request, reply);
    if (!params) return;
    const authorization = request.headers.authorization || "";
    const match = authorization.match(/^Bearer ([A-Za-z0-9_-]{43})$/);
    const token = match?.[1] || request.cookies.fiaa_order;
    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return reply.code(401).type("application/problem+json").send(problem(401, "order-authentication-required", "Order authentication required", "A valid private order session is required.", request.url));
    const result = await db.query("select get_customer_order($1,$2) as order", [params.orderNumber, hashOpaqueToken(token)]);
    return mapOrder(result.rows[0].order);
  });

  app.post("/v1/webhooks/payments/:provider", { config: { rateLimit: { max: 300, timeWindow: "1 minute" } } }, async (request, reply) => {
    const params = parseOrReply(providerParam, request.params, request, reply);
    if (!params) return;
    const provider = paymentProviders.get(params.provider);
    if (!provider) return reply.code(404).type("application/problem+json").send(problem(404, "payment-provider-not-configured", "Payment provider not configured", "This payment webhook is not enabled.", request.url));
    const event = await provider.verifyAndNormalize({ headers: request.headers, rawBody: request.rawBody, body: request.body });
    if (!event) return reply.code(401).type("application/problem+json").send(problem(401, "invalid-webhook-signature", "Invalid webhook signature", "The payment notification could not be authenticated.", request.url));
    if (!event.successful) return { received: true, processed: false };
    await db.query("select (record_verified_payment($1,$2,$3,$4,$5,$6,$7)).id as order_id", [
      event.orderId, params.provider, event.reference, event.idempotencyKey,
      event.amountMinor, event.currency, event.payload
    ]);
    return { received: true, processed: true };
  });

  app.get("/v1/admin/products", async (request, reply) => {
    const query = parseOrReply(adminProductListQuery, request.query, request, reply);
    if (!query) return;
    const subject = await staffSubject(request, reply);
    if (!subject) return;
    const result = await asStaff(subject, async client => {
      await client.query("select require_staff_role(array['owner','catalogue_manager'])");
      return client.query(
        `select p.id, p.sku, p.slug, p.name, p.product_kind, p.publication_status,
                p.owner_verified_at, p.updated_at, product_publication_problems(p.id) as problems,
                count(*) over()::integer as total_count
           from products p
          where ($1::text is null or p.publication_status = $1)
            and ($2::text is null or p.sku ilike '%' || $2 || '%' or p.name ilike '%' || $2 || '%')
          order by p.updated_at desc, p.id
          limit $3 offset $4`,
        [query.status || null, query.q || null, query.limit, query.offset]
      );
    });
    return {
      items: result.rows.map(row => ({
        id: row.id, sku: row.sku, slug: row.slug, name: row.name, productKind: row.product_kind,
        status: row.publication_status, ownerVerifiedAt: row.owner_verified_at, updatedAt: row.updated_at,
        problems: row.problems || [], ready: (row.problems || []).length === 0
      })),
      total: Number(result.rows[0]?.total_count || 0), limit: query.limit, offset: query.offset
    };
  });

  app.get("/v1/admin/products/:productId", async (request, reply) => {
    const params = parseOrReply(productAdminParam, request.params, request, reply);
    if (!params) return;
    const subject = await staffSubject(request, reply);
    if (!subject) return;
    const result = await asStaff(subject, async client => {
      await client.query("select require_staff_role(array['owner','catalogue_manager'])");
      return client.query(
        `select p.*, c.name as category_name, product_publication_problems(p.id) as problems,
                coalesce((select jsonb_agg(jsonb_build_object(
                  'amountMinor', pp.amount_minor, 'currency', trim(pp.currency), 'validFrom', pp.valid_from,
                  'validUntil', pp.valid_until, 'approvedAt', pp.approved_at, 'approvedBy', pp.approved_by
                ) order by pp.valid_from desc, pp.id) from product_prices pp where pp.product_id=p.id), '[]'::jsonb) as prices,
                coalesce((select jsonb_agg(jsonb_build_object(
                  'storageKey', pi.storage_key, 'alt', pi.alt_text, 'role', pi.image_role,
                  'mimeType', pi.mime_type, 'width', pi.width_px, 'height', pi.height_px,
                  'ownerVerifiedAt', pi.owner_verified_at
                ) order by pi.position, pi.id) from product_images pi where pi.product_id=p.id), '[]'::jsonb) as images,
                coalesce((select jsonb_agg(jsonb_build_object(
                  'reference', r.reference, 'manufacturer', r.manufacturer
                ) order by r.reference) from product_oem_references r where r.product_id=p.id), '[]'::jsonb) as oem_references,
                coalesce((select jsonb_agg(jsonb_build_object(
                  'make', vmk.name, 'model', vm.name, 'yearFrom', f.year_from, 'yearTo', f.year_to,
                  'engine', f.engine, 'trim', f.trim, 'position', f.axle_position,
                  'sourceReference', f.source_reference, 'ownerVerifiedAt', f.owner_verified_at
                ) order by vmk.name, vm.name, f.year_from) from product_fitments f
                  join vehicle_models vm on vm.id=f.model_id join vehicle_makes vmk on vmk.id=vm.make_id
                 where f.product_id=p.id), '[]'::jsonb) as fitments,
                coalesce((select jsonb_agg(jsonb_build_object(
                  'location', l.name, 'code', l.code, 'onHand', i.quantity_on_hand,
                  'reserved', i.quantity_reserved, 'available', i.quantity_on_hand-i.quantity_reserved,
                  'reorderLevel', i.reorder_level
                ) order by l.name) from inventory i join inventory_locations l on l.id=i.location_id
                 where i.product_id=p.id), '[]'::jsonb) as inventory,
                coalesce((select jsonb_agg(jsonb_build_object(
                  'action', a.action, 'before', a.before_data, 'after', a.after_data, 'createdAt', a.created_at
                ) order by a.created_at desc, a.id desc) from audit_log a
                 where a.entity_type='products' and a.entity_id=p.id::text), '[]'::jsonb) as history
           from products p join product_categories c on c.id=p.category_id
          where p.id=$1 limit 1`, [params.productId]
      );
    });
    const row = result.rows[0];
    if (!row) return reply.code(404).type("application/problem+json").send(problem(404, "admin-product-not-found", "Product not found", "No catalogue record matches this identifier.", request.url));
    const problems = row.problems || [];
    return {
      id: row.id, sku: row.sku, slug: row.slug, name: row.name, productKind: row.product_kind,
      category: row.category_name, status: row.publication_status, shortDescription: row.short_description,
      description: row.description, axlePosition: row.axle_position,
      dimensionsMm: { width: row.width_mm == null ? null : Number(row.width_mm), height: row.height_mm == null ? null : Number(row.height_mm), thickness: row.thickness_mm == null ? null : Number(row.thickness_mm) },
      warrantyText: row.warranty_text, ownerVerifiedAt: row.owner_verified_at, ownerVerifiedBy: row.owner_verified_by,
      publishedAt: row.published_at, updatedAt: row.updated_at, problems, ready: problems.length === 0,
      prices: row.prices || [], images: row.images || [], oemReferences: row.oem_references || [],
      fitments: row.fitments || [], inventory: row.inventory || [], history: row.history || []
    };
  });

  app.get("/v1/admin/orders", async (request, reply) => {
    const query = parseOrReply(adminOrderListQuery, request.query, request, reply);
    if (!query) return;
    const subject = await staffSubject(request, reply);
    if (!subject) return;
    const result = await asStaff(subject, async client => {
      await client.query("select require_staff_role(array['owner','order_manager','support'])");
      return client.query(
        `select o.id, o.order_number, o.status, o.currency, o.total_minor, o.placed_at, o.updated_at,
                c.full_name as customer_name, c.phone_e164 as customer_phone,
                count(*) over()::integer as total_count
           from orders o
           join customers c on c.id = o.customer_id
          where ($1::text is null or o.status = $1)
            and ($2::text is null or o.order_number ilike '%' || $2 || '%' or c.full_name ilike '%' || $2 || '%' or c.phone_e164 ilike '%' || $2 || '%')
          order by o.placed_at desc, o.id
          limit $3 offset $4`,
        [query.status || null, query.q || null, query.limit, query.offset]
      );
    });
    return {
      items: result.rows.map(row => ({
        id: row.id, orderNumber: row.order_number, status: row.status,
        total: money(row.currency, row.total_minor), placedAt: row.placed_at, updatedAt: row.updated_at,
        customer: { name: row.customer_name, phone: row.customer_phone }
      })),
      total: Number(result.rows[0]?.total_count || 0), limit: query.limit, offset: query.offset
    };
  });

  app.get("/v1/admin/orders/:orderId", async (request, reply) => {
    const params = parseOrReply(orderAdminParam, request.params, request, reply);
    if (!params) return;
    const subject = await staffSubject(request, reply);
    if (!subject) return;
    const result = await asStaff(subject, async client => {
      await client.query("select require_staff_role(array['owner','order_manager','support'])");
      return client.query(
        `select o.*, c.full_name as customer_name, c.phone_e164 as customer_phone, c.email as customer_email,
                dm.code as delivery_code, dm.name as delivery_name,
                case when a.id is null then null else jsonb_build_object(
                  'recipientName', a.recipient_name, 'phone', a.phone_e164, 'line1', a.line1,
                  'line2', a.line2, 'city', a.city, 'state', a.state,
                  'countryCode', trim(a.country_code), 'notes', a.delivery_notes
                ) end as address,
                coalesce((select jsonb_agg(jsonb_build_object(
                  'sku', i.sku_snapshot, 'name', i.name_snapshot, 'quantity', i.quantity,
                  'unitAmountMinor', i.unit_price_minor, 'lineAmountMinor', i.line_total_minor,
                  'fitment', i.fitment_snapshot
                ) order by i.created_at, i.id) from order_items i where i.order_id=o.id), '[]'::jsonb) as items,
                coalesce((select jsonb_agg(jsonb_build_object(
                  'provider', p.provider, 'reference', p.provider_reference, 'status', p.status,
                  'amountMinor', p.amount_minor, 'currency', trim(p.currency), 'paidAt', p.paid_at
                ) order by p.created_at, p.id) from payments p where p.order_id=o.id), '[]'::jsonb) as payments,
                coalesce((select jsonb_agg(jsonb_build_object(
                  'carrier', s.carrier, 'trackingNumber', s.tracking_number, 'status', s.status,
                  'shippedAt', s.shipped_at, 'deliveredAt', s.delivered_at
                ) order by s.created_at, s.id) from shipments s where s.order_id=o.id), '[]'::jsonb) as shipments
           from orders o
           join customers c on c.id=o.customer_id
           join delivery_methods dm on dm.id=o.delivery_method_id
           left join customer_addresses a on a.id=o.delivery_address_id
          where o.id=$1 limit 1`, [params.orderId]
      );
    });
    const row = result.rows[0];
    if (!row) return reply.code(404).type("application/problem+json").send(problem(404, "admin-order-not-found", "Order not found", "No order matches this identifier.", request.url));
    const currency = String(row.currency).trim();
    return {
      id: row.id, orderNumber: row.order_number, status: row.status,
      customer: { name: row.customer_name, phone: row.customer_phone, email: row.customer_email },
      delivery: { code: row.delivery_code, name: row.delivery_name, address: row.address },
      items: (row.items || []).map(item => ({
        sku: item.sku, name: item.name, quantity: Number(item.quantity), fitment: item.fitment,
        unitPrice: money(currency, item.unitAmountMinor), lineTotal: money(currency, item.lineAmountMinor)
      })),
      subtotal: money(currency, row.subtotal_minor), deliveryFee: money(currency, row.delivery_minor),
      discount: money(currency, row.discount_minor), total: money(currency, row.total_minor),
      payments: row.payments || [], shipments: row.shipments || [], customerNote: row.customer_note,
      internalNote: row.internal_note, placedAt: row.placed_at, updatedAt: row.updated_at
    };
  });

  app.post("/v1/admin/orders/:orderId/status", async (request, reply) => {
    const params = parseOrReply(orderAdminParam, request.params, request, reply);
    const body = parseOrReply(orderStatusBody, request.body, request, reply);
    if (!params || !body) return;
    const subject = await staffSubject(request, reply);
    if (!subject) return;
    const result = await asStaff(subject, client => client.query(
      "select (admin_transition_order($1,$2,$3)).*", [params.orderId, body.status, body.reason]
    ));
    const row = result.rows[0];
    return { id: row.id, orderNumber: row.order_number, status: row.status, updatedAt: row.updated_at };
  });

  app.put("/v1/admin/orders/:orderId/shipment", async (request, reply) => {
    const params = parseOrReply(orderAdminParam, request.params, request, reply);
    const body = parseOrReply(shipmentBody, request.body, request, reply);
    if (!params || !body) return;
    const subject = await staffSubject(request, reply);
    if (!subject) return;
    const result = await asStaff(subject, client => client.query(
      "select (admin_upsert_shipment($1,$2,$3,$4,$5)).*",
      [params.orderId, body.carrier, body.trackingNumber, body.status, body.reason]
    ));
    const row = result.rows[0];
    return {
      id: row.id, orderId: row.order_id, carrier: row.carrier, trackingNumber: row.tracking_number,
      status: row.status, shippedAt: row.shipped_at, deliveredAt: row.delivered_at, updatedAt: row.updated_at
    };
  });

  app.get("/v1/admin/content", async (request, reply) => {
    const query = parseOrReply(adminContentListQuery, request.query, request, reply);
    if (!query) return;
    const subject = await staffSubject(request, reply);
    if (!subject) return;
    const result = await asStaff(subject, async client => {
      await client.query("select require_staff_role(array['owner','content_manager'])");
      return client.query(
        `select p.id, p.slug, p.title, p.page_type, p.publication_status, p.current_version,
                p.owner_verified_at, p.published_at, p.updated_at,
                content_publication_problems(p.id) as problems,
                count(*) over()::integer as total_count
           from content_pages p
          where ($1::text is null or p.publication_status=$1)
            and ($2::text is null or p.page_type=$2)
            and ($3::text is null or p.slug ilike '%' || $3 || '%' or p.title ilike '%' || $3 || '%')
          order by p.updated_at desc, p.id
          limit $4 offset $5`,
        [query.status || null, query.pageType || null, query.q || null, query.limit, query.offset]
      );
    });
    return {
      items: result.rows.map(row => ({
        id: row.id, slug: row.slug, title: row.title, pageType: row.page_type,
        status: row.publication_status, version: Number(row.current_version),
        ownerVerifiedAt: row.owner_verified_at, publishedAt: row.published_at, updatedAt: row.updated_at,
        problems: row.problems || [], ready: (row.problems || []).length === 0
      })),
      total: Number(result.rows[0]?.total_count || 0), limit: query.limit, offset: query.offset
    };
  });

  app.get("/v1/admin/products/:productId/publication-problems", async (request, reply) => {
    const params = parseOrReply(productAdminParam, request.params, request, reply);
    if (!params) return;
    const subject = await staffSubject(request, reply);
    if (!subject) return;
    const result = await asStaff(subject, client => client.query("select product_publication_problems($1) as problems", [params.productId]));
    const problems = result.rows[0]?.problems || [];
    return { problems, ready: problems.length === 0 };
  });

  app.post("/v1/admin/products/:productId/status", async (request, reply) => {
    const params = parseOrReply(productAdminParam, request.params, request, reply);
    const body = parseOrReply(productStatusBody, request.body, request, reply);
    if (!params || !body) return;
    const subject = await staffSubject(request, reply);
    if (!subject) return;
    const result = await asStaff(subject, client => client.query("select (admin_transition_product($1,$2,$3)).*", [params.productId, body.status, body.reason]));
    const row = result.rows[0];
    return { id: row.id, sku: row.sku, status: row.publication_status, updatedAt: row.updated_at };
  });

  app.post("/v1/admin/content/:pageId/publish", async (request, reply) => {
    const params = parseOrReply(contentAdminParam, request.params, request, reply);
    const body = parseOrReply(publishContentBody, request.body, request, reply);
    if (!params || !body) return;
    const subject = await staffSubject(request, reply);
    if (!subject) return;
    const result = await asStaff(subject, client => client.query("select (admin_publish_content($1,$2)).*", [params.pageId, body.reason]));
    const row = result.rows[0];
    return { slug: row.slug, title: row.title, pageType: row.page_type, excerpt: row.excerpt, bodyHtml: row.body_html, metaTitle: row.meta_title, metaDescription: row.meta_description, version: row.current_version, publishedAt: row.published_at };
  });

  app.post("/v1/admin/content/drafts", async (request, reply) => {
    const body = parseOrReply(saveContentBody, request.body, request, reply);
    if (!body) return;
    const subject = await staffSubject(request, reply);
    if (!subject) return;
    const safeBody = cleanPublishedHtml(body.bodyHtml);
    if (safeBody.replace(/<[^>]+>/g, "").trim().length < 80) {
      return reply.code(422).type("application/problem+json").send(problem(422, "content-incomplete-after-sanitization", "Content is incomplete", "The page does not contain enough safe customer-facing text after sanitization.", request.url));
    }
    const result = await asStaff(subject, client => client.query(
      "select (admin_save_content($1,$2,$3,$4,$5,$6,$7,$8,$9)).*",
      [body.pageId || null, body.slug, body.title, body.pageType, body.excerpt || null, safeBody, body.metaTitle, body.metaDescription, body.changeSummary]
    ));
    const row = result.rows[0];
    reply.code(body.pageId ? 200 : 201);
    return { id: row.id, slug: row.slug, title: row.title, pageType: row.page_type, status: row.publication_status, version: row.current_version, updatedAt: row.updated_at };
  });

  app.get("/v1/admin/launch-readiness", async (request, reply) => {
    const subject = await staffSubject(request, reply);
    if (!subject) return;
    return asStaff(subject, async client => {
      await client.query("select require_staff_role(array['owner','catalogue_manager','content_manager'])");
      const [content, products, outbox] = await Promise.all([
        client.query("select slug, display_name, status, current_version, published_at from content_launch_readiness"),
        client.query("select publication_status as status, count(*)::integer as count from products group by publication_status order by publication_status"),
        client.query("select status, count(*)::integer as count from notification_outbox group by status order by status")
      ]);
      const requiredContentReady = content.rows.every(row => row.status === "ready");
      return { requiredContentReady, content: content.rows.map(row => ({ slug: row.slug, name: row.display_name, status: row.status, version: row.current_version, publishedAt: row.published_at })), products: products.rows, notifications: outbox.rows };
    });
  });

  return app;
}
