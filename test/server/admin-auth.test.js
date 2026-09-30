import assert from "node:assert/strict";
import { test } from "node:test";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { createOidcAdminAuthenticator } from "../../server/admin-auth.js";

const options = { issuer: "https://identity.example.com/", audience: "https://api.fiaaevolution.com/admin", jwksUrl: "https://identity.example.com/.well-known/jwks.json" };

async function fixture() {
  const { publicKey, privateKey } = await generateKeyPair("RS256", { extractable: true });
  const publicJwk = await exportJWK(publicKey);
  publicJwk.kid = "test-key"; publicJwk.use = "sig"; publicJwk.alg = "RS256";
  const authenticator = createOidcAdminAuthenticator(options, { jwks: createLocalJWKSet({ keys: [publicJwk] }) });
  return { privateKey, authenticator };
}

async function token(privateKey, changes = {}) {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ scope: "fiaa:admin" }).setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .setSubject(changes.subject ?? "identity|owner-1").setIssuer(changes.issuer ?? options.issuer)
    .setAudience(changes.audience ?? options.audience).setIssuedAt(changes.issuedAt ?? now)
    .setExpirationTime(changes.expiresAt ?? now + 300).sign(privateKey);
}

test("OIDC authenticator accepts a signed current token with exact issuer and audience", async () => {
  const { privateKey, authenticator } = await fixture();
  assert.deepEqual((await authenticator.authenticate(await token(privateKey))).subject, "identity|owner-1");
});

test("OIDC authenticator rejects wrong audience and expired tokens", async () => {
  const { privateKey, authenticator } = await fixture();
  assert.equal(await authenticator.authenticate(await token(privateKey, { audience: "wrong" })), null);
  const past = Math.floor(Date.now() / 1000) - 3600;
  assert.equal(await authenticator.authenticate(await token(privateKey, { issuedAt: past, expiresAt: past + 60 })), null);
});
