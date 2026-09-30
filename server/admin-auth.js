import { createRemoteJWKSet, jwtVerify } from "jose";

export function createOidcAdminAuthenticator(options, dependencies = {}) {
  const jwks = dependencies.jwks || createRemoteJWKSet(new URL(options.jwksUrl), {
    cooldownDuration: 30_000,
    cacheMaxAge: 10 * 60_000,
    timeoutDuration: 5_000
  });

  return {
    async authenticate(token) {
      try {
        const { payload } = await jwtVerify(token, jwks, {
          issuer: options.issuer,
          audience: options.audience,
          algorithms: ["RS256"],
          clockTolerance: 5,
          maxTokenAge: "15 minutes"
        });
        if (typeof payload.sub !== "string" || !payload.sub.trim()) return null;
        return { subject: payload.sub, expiresAt: payload.exp };
      } catch {
        return null;
      }
    }
  };
}
