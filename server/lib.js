import { createHash, createHmac, randomBytes } from "node:crypto";

export function hashOpaqueToken(token) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function createOpaqueToken(bytes = 32) {
  return randomBytes(bytes).toString("base64url");
}

export function deriveOpaqueToken(secret, purpose, ...parts) {
  return createHmac("sha256", secret).update([purpose, ...parts].join("\u0000"), "utf8").digest("base64url");
}

export function money(currency, amountMinor) {
  const parsed = Number(amountMinor);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error("Unsafe monetary value returned by database");
  return { currency: String(currency).trim(), amountMinor: parsed };
}

export function problem(status, code, title, detail, instance) {
  return {
    type: `https://api.fiaaevolution.com/problems/${code}`,
    title,
    status,
    detail,
    instance,
    code
  };
}

export function assetUrl(baseUrl, storageKey) {
  const path = String(storageKey).split("/").map(encodeURIComponent).join("/");
  return `${baseUrl}/${path}`;
}
