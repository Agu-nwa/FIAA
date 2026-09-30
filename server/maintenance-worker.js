import { loadConfig } from "./config.js";
import { createDatabase } from "./db.js";

export function createMaintenanceWorker({ db, logger = console }) {
  async function runOnce() {
    const released = await db.query("select release_expired_order_reservations() as released_orders");
    const expired = await db.query("select purge_expired_carts() as expired_carts");
    const result = {
      releasedOrders: Number(released.rows[0]?.released_orders || 0),
      expiredCarts: Number(expired.rows[0]?.expired_carts || 0)
    };
    logger.info?.(result, "Commerce maintenance completed");
    return result;
  }
  return { runOnce };
}

async function main() {
  const config = loadConfig();
  const workerUrl = process.env.WORKER_DATABASE_URL;
  if (!workerUrl) throw new Error("WORKER_DATABASE_URL is required and must inherit only fiaa_worker");
  const db = createDatabase(config, { connectionString: workerUrl, applicationName: "fiaa-maintenance-worker" });
  try { await createMaintenanceWorker({ db }).runOnce(); }
  finally { await db.close(); }
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
