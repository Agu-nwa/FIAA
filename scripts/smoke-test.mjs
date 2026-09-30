const requiredSecurityHeaders = [
  "content-security-policy",
  "x-content-type-options",
  "x-frame-options",
  "referrer-policy"
];

export async function runSmoke({ baseUrl, expectIndexing = false, fetchImpl = fetch }) {
  const origin = new URL(baseUrl).origin;
  const checks = [];

  async function request(path, options = {}) {
    const response = await fetchImpl(new URL(path, `${origin}/`), { redirect: "manual", ...options });
    checks.push({ path, status: response.status });
    return response;
  }

  const live = await request("/health/live");
  assertStatus(live, 200, "liveness");
  assertJson(await live.json(), value => value.status === "ok", "liveness payload");

  const ready = await request("/health/ready");
  assertStatus(ready, 200, "readiness");
  assertJson(await ready.json(), value => value.status === "ready", "readiness payload");

  const home = await request("/");
  assertStatus(home, 200, "storefront");
  assertIncludes(home.headers.get("content-type"), "text/html", "storefront content type");
  for (const header of requiredSecurityHeaders) {
    if (!home.headers.get(header)) throw new Error(`Storefront is missing required ${header} header`);
  }
  const html = await home.text();
  assertIncludes(html, "FIAA Evolution", "storefront brand");
  if (/sample|demo product|coming soon/i.test(html)) throw new Error("Storefront contains prohibited placeholder language");

  const robots = await request("/robots.txt");
  assertStatus(robots, 200, "robots.txt");
  const robotsText = await robots.text();
  if (expectIndexing) {
    if (/Disallow:\s*\//i.test(robotsText)) throw new Error("Production indexing was expected but robots.txt blocks the site");
    assertIncludes(robotsText, "Sitemap:", "robots sitemap declaration");
  } else {
    assertIncludes(robotsText, "Disallow: /", "non-production indexing protection");
  }

  const sitemap = await request("/sitemap.xml");
  assertStatus(sitemap, 200, "sitemap");
  assertIncludes(sitemap.headers.get("content-type"), "xml", "sitemap content type");

  const invalidSearch = await request("/v1/search?year=invalid");
  assertStatus(invalidSearch, 400, "API validation");
  assertIncludes(invalidSearch.headers.get("content-type"), "application/problem+json", "API problem response");

  const privateFile = await request("/.env.example");
  assertStatus(privateFile, 404, "private file protection");

  return { origin, indexing: expectIndexing, checks };
}

function assertStatus(response, expected, label) {
  if (response.status !== expected) throw new Error(`${label} returned ${response.status}; expected ${expected}`);
}

function assertIncludes(value, expected, label) {
  if (!String(value || "").includes(expected)) throw new Error(`${label} does not include ${expected}`);
}

function assertJson(value, predicate, label) {
  if (!predicate(value)) throw new Error(`${label} is invalid`);
}

async function main() {
  const baseUrl = process.env.SMOKE_BASE_URL;
  if (!baseUrl) throw new Error("SMOKE_BASE_URL is required");
  const result = await runSmoke({ baseUrl, expectIndexing: process.env.EXPECT_INDEXING === "true" });
  console.log(`Production smoke checks passed for ${result.origin} (${result.checks.length} requests).`);
}

if (!process.env.NODE_TEST_CONTEXT && process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
