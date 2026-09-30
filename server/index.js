import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createDatabase } from "./db.js";
import { createOidcAdminAuthenticator } from "./admin-auth.js";

const config = loadConfig();
const db = createDatabase(config);
const adminDb = config.adminDatabaseUrl ? createDatabase(config, { connectionString: config.adminDatabaseUrl, applicationName: "fiaa-administration-api" }) : null;
const adminAuthenticator = config.adminOidc ? createOidcAdminAuthenticator(config.adminOidc) : null;
const app = await buildApp({ db, adminDb, adminAuthenticator, config, logger: { level: config.nodeEnv === "production" ? "info" : "debug" } });

let closing = false;
async function shutdown(signal) {
  if (closing) return;
  closing = true;
  app.log.info({ signal }, "Shutting down");
  const forced = setTimeout(() => process.exit(1), 10_000).unref();
  try {
    await app.close();
    await db.close();
    if (adminDb) await adminDb.close();
    clearTimeout(forced);
    process.exit(0);
  } catch (error) {
    app.log.error(error, "Shutdown failed");
    process.exit(1);
  }
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

try {
  await app.listen({ host: config.host, port: config.port });
} catch (error) {
  app.log.error(error, "API failed to start");
  await db.close();
  if (adminDb) await adminDb.close();
  process.exit(1);
}
