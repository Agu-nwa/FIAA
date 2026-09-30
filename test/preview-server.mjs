import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

export const previewRoot = fileURLToPath(new URL("../", import.meta.url));
const root = previewRoot;
const product = { id: "0068f486-d9cb-4201-8fe2-6194025b787e", sku: "QA-ONLY", slug: "qa-only-product", name: "QA-only verified product", productKind: "brake_pad", category: "Brake Pads", shortDescription: "Browser-test fixture, never production inventory.", axlePosition: "front", price: { currency: "NGN", amountMinor: 125000 }, availableQuantity: 8, primaryImage: { url: "/assets/hero/fiaa-products.webp", alt: "FIAA packaged brake products", role: "primary", width: 1600, height: 900 } };
let cart = { id: "8a89245b-8a92-4b63-8526-f5337067cedf", status: "active", expiresAt: "2026-10-27T12:00:00.000Z", currency: "NGN", itemCount: 0, subtotal: { currency: "NGN", amountMinor: 0 }, items: [] };
let qaOrder;
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".webp": "image/webp", ".jpg": "image/jpeg", ".png": "image/png" };

const server = createServer(async (request, response) => {
  const url = new URL(request.url, "http://127.0.0.1:4173");
  if (url.pathname === "/v1/search") return json(response, 200, { items: [product], count: 1, limit: 100, offset: 0 });
  if (url.pathname === "/v1/products/qa-only-product") return json(response, 200, { ...product, description: product.shortDescription, widthMm: 120, heightMm: 55, thicknessMm: 16, warrantyText: null, images: [product.primaryImage], oemReferences: ["QA-REFERENCE"], fitments: [{ make: "QA", model: "Test vehicle", yearFrom: 2020, yearTo: 2026 }] });
  if (url.pathname === "/v1/delivery-methods") return json(response, 200, { items: [{ code: "qa-delivery", name: "QA delivery", description: "Browser-test fixture", fee: { currency: "NGN", amountMinor: 50000 }, requiresAddress: true }] });
  if (url.pathname === "/v1/carts" && request.method === "POST") return json(response, 201, cart);
  if (url.pathname === `/v1/carts/${cart.id}`) return json(response, 200, cart);
  if (url.pathname === `/v1/carts/${cart.id}/items/${product.sku}` && request.method === "PUT") {
    const body = await readJson(request);
    const quantity = body.quantity;
    cart = { ...cart, itemCount: quantity, subtotal: { currency: "NGN", amountMinor: quantity * product.price.amountMinor }, items: quantity ? [{ sku: product.sku, slug: product.slug, name: product.name, quantity, availableQuantity: 8, unitPrice: product.price, lineTotal: { currency: "NGN", amountMinor: quantity * product.price.amountMinor } }] : [] };
    return json(response, 200, cart);
  }
  if (url.pathname === "/v1/checkout" && request.method === "POST") {
    await readJson(request);
    qaOrder = { orderNumber: "FIAA-20260927-009999", status: "pending_payment", currency: "NGN", subtotal: cart.subtotal, delivery: { currency: "NGN", amountMinor: 50000 }, discount: { currency: "NGN", amountMinor: 0 }, total: { currency: "NGN", amountMinor: cart.subtotal.amountMinor + 50000 }, items: cart.items, placedAt: "2026-09-27T12:00:00.000Z" };
    response.setHeader("Set-Cookie", "fiaa_order=qa-only-private-cookie; Path=/v1/orders/FIAA-20260927-009999; HttpOnly; SameSite=Strict");
    return json(response, 201, { order: qaOrder, orderAccess: { mode: "httpOnlyCookie" }, payment: { status: "pending", authorizationUrl: null } });
  }
  if (url.pathname === "/v1/orders/FIAA-20260927-009999") {
    if (!request.headers.cookie?.includes("fiaa_order=qa-only-private-cookie")) return json(response, 401, { detail: "A valid private order session is required." });
    return json(response, 200, qaOrder);
  }
  const relative = url.pathname === "/" ? "index.html" : normalize(url.pathname).replace(/^\/+/, "");
  const file = join(root, relative);
  if (!file.startsWith(root)) return json(response, 404, { error: "not found" });
  try {
    const info = await stat(file);
    if (!info.isFile()) throw new Error();
    response.writeHead(200, { "Content-Type": types[extname(file)] || "application/octet-stream" });
    createReadStream(file).pipe(response);
  } catch { json(response, 404, { error: "not found" }); }
});

if (!process.env.NODE_TEST_CONTEXT) {
  server.listen(4180, "localhost", () => console.log("FIAA preview running at http://localhost:4180"));
}

function json(response, status, body) {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}
