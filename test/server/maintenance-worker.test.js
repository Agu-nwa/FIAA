import assert from "node:assert/strict";
import { test } from "node:test";
import { createMaintenanceWorker } from "../../server/maintenance-worker.js";

test("maintenance worker releases unpaid reservations and expires abandoned carts", async () => {
  const calls = [];
  const db = { async query(text) {
    calls.push(text);
    if (text.includes("release_expired")) return { rows: [{ released_orders: 3 }] };
    return { rows: [{ expired_carts: 7 }] };
  } };
  const result = await createMaintenanceWorker({ db, logger: { info() {} } }).runOnce();
  assert.deepEqual(result, { releasedOrders: 3, expiredCarts: 7 });
  assert.equal(calls.length, 2);
  assert.match(calls[1], /purge_expired_carts/);
});
