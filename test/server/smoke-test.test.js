import assert from "node:assert/strict";
import { test } from "node:test";
import { runSmoke } from "../../scripts/smoke-test.mjs";

function response(body, { status = 200, type = "application/json", headers = {} } = {}) {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "content-type": type, ...headers } });
}

test("deployment smoke test verifies health, security, indexing and private-file protection", async () => {
  const security = { "content-security-policy": "default-src 'self'", "x-content-type-options": "nosniff", "x-frame-options": "SAMEORIGIN", "referrer-policy": "strict-origin-when-cross-origin" };
  const seen = [];
  const fetchImpl = async url => {
    const path = new URL(url).pathname + new URL(url).search;
    seen.push(path);
    if (path === "/health/live") return response({ status: "ok" });
    if (path === "/health/ready") return response({ status: "ready" });
    if (path === "/") return response("<!doctype html><title>FIAA Evolution</title>", { type: "text/html", headers: security });
    if (path === "/robots.txt") return response("User-agent: *\nDisallow: /\nSitemap: https://www.fiaaevolution.com/sitemap.xml", { type: "text/plain" });
    if (path === "/sitemap.xml") return response("<urlset></urlset>", { type: "application/xml" });
    if (path === "/v1/search?year=invalid") return response({ code: "invalid-request" }, { status: 400, type: "application/problem+json" });
    if (path === "/.env.example") return response({ code: "not-found" }, { status: 404 });
    throw new Error(`Unexpected request ${path}`);
  };
  const result = await runSmoke({ baseUrl: "https://staging.fiaaevolution.com", fetchImpl });
  assert.equal(result.checks.length, 7);
  assert.deepEqual(seen, ["/health/live", "/health/ready", "/", "/robots.txt", "/sitemap.xml", "/v1/search?year=invalid", "/.env.example"]);
});

test("deployment smoke test rejects placeholder copy", async () => {
  const fetchImpl = async url => {
    const path = new URL(url).pathname;
    if (path === "/health/live") return response({ status: "ok" });
    if (path === "/health/ready") return response({ status: "ready" });
    return response("FIAA Evolution coming soon", { type: "text/html", headers: { "content-security-policy": "x", "x-content-type-options": "x", "x-frame-options": "x", "referrer-policy": "x" } });
  };
  await assert.rejects(() => runSmoke({ baseUrl: "https://staging.fiaaevolution.com", fetchImpl }), /placeholder language/);
});
