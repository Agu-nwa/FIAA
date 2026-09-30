import { z } from "zod";

const booleanFromString = z.string().transform(value => value === "true");

const configSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().default("127.0.0.1"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.string().min(1),
  ADMIN_DATABASE_URL: z.string().min(1).optional(),
  ADMIN_OIDC_ISSUER: z.string().url().optional(),
  ADMIN_OIDC_AUDIENCE: z.string().min(1).optional(),
  ADMIN_OIDC_JWKS_URL: z.string().url().optional(),
  DATABASE_SSL: booleanFromString.default("false"),
  COOKIE_SECRET: z.string().min(32),
  PUBLIC_WEB_ORIGIN: z.string().url(),
  PUBLIC_ASSET_BASE_URL: z.string().url(),
  SERVE_STOREFRONT: booleanFromString.default("true"),
  PUBLIC_INDEXING: booleanFromString.default("false"),
  TRUST_PROXY: booleanFromString.default("false"),
  PAYMENT_PROVIDER: z.string().regex(/^[a-z0-9][a-z0-9-]{1,49}$/).optional()
}).superRefine((value, context) => {
  const identity = [value.ADMIN_OIDC_ISSUER, value.ADMIN_OIDC_AUDIENCE, value.ADMIN_OIDC_JWKS_URL];
  if (identity.some(Boolean) && !identity.every(Boolean)) {
    context.addIssue({ code: "custom", path: ["ADMIN_OIDC_ISSUER"], message: "All ADMIN_OIDC settings must be configured together" });
  }
  if (value.ADMIN_DATABASE_URL && !identity.every(Boolean)) {
    context.addIssue({ code: "custom", path: ["ADMIN_DATABASE_URL"], message: "Administration database access requires complete OIDC verification settings" });
  }
  if (value.NODE_ENV === "production" && !value.PAYMENT_PROVIDER) {
    context.addIssue({ code: "custom", path: ["PAYMENT_PROVIDER"], message: "A live payment provider is required in production" });
  }
});

export function loadConfig(environment = process.env) {
  const parsed = configSchema.safeParse(environment);
  if (!parsed.success) {
    const details = parsed.error.issues.map(issue => `${issue.path.join(".")}: ${issue.message}`).join("; ");
    throw new Error(`Invalid server configuration: ${details}`);
  }
  return {
    nodeEnv: parsed.data.NODE_ENV,
    host: parsed.data.HOST,
    port: parsed.data.PORT,
    databaseUrl: parsed.data.DATABASE_URL,
    adminDatabaseUrl: parsed.data.ADMIN_DATABASE_URL,
    adminOidc: parsed.data.ADMIN_OIDC_ISSUER ? {
      issuer: parsed.data.ADMIN_OIDC_ISSUER,
      audience: parsed.data.ADMIN_OIDC_AUDIENCE,
      jwksUrl: parsed.data.ADMIN_OIDC_JWKS_URL
    } : null,
    databaseSsl: parsed.data.DATABASE_SSL,
    cookieSecret: parsed.data.COOKIE_SECRET,
    publicWebOrigin: parsed.data.PUBLIC_WEB_ORIGIN,
    publicAssetBaseUrl: parsed.data.PUBLIC_ASSET_BASE_URL.replace(/\/$/, ""),
    serveStorefront: parsed.data.SERVE_STOREFRONT,
    publicIndexing: parsed.data.PUBLIC_INDEXING,
    trustProxy: parsed.data.TRUST_PROXY,
    paymentProvider: parsed.data.PAYMENT_PROVIDER || null
  };
}
