import assert from "node:assert/strict";
import { test } from "node:test";
import { loadConfig } from "../../server/config.js";

const base = {
  DATABASE_URL: "postgresql://localhost/fiaa",
  COOKIE_SECRET: "a-secure-cookie-secret-with-at-least-32-characters",
  PUBLIC_WEB_ORIGIN: "https://www.fiaaevolution.com",
  PUBLIC_ASSET_BASE_URL: "https://cdn.fiaaevolution.com/assets"
};

test("production configuration fails closed without a payment provider", () => {
  assert.throws(() => loadConfig({ ...base, NODE_ENV: "production" }), /PAYMENT_PROVIDER/);
  const config = loadConfig({ ...base, NODE_ENV: "production", PAYMENT_PROVIDER: "approved-provider" });
  assert.equal(config.paymentProvider, "approved-provider");
});

test("non-production configuration may leave live payment disabled", () => {
  const config = loadConfig({ ...base, NODE_ENV: "test" });
  assert.equal(config.paymentProvider, null);
});
