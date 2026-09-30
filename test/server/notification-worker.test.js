import assert from "node:assert/strict";
import { test } from "node:test";
import { createNotificationWorker } from "../../server/notification-worker.js";

test("notification worker completes delivered jobs with provider idempotency", async () => {
  const calls = [];
  const db = { async query(text, params) {
    calls.push({ text, params });
    if (text.includes("claim_notification_jobs")) return { rows: [{ id: 7, channel: "email", recipient: "customer@example.com", template_key: "order-created", payload: { orderNumber: "FIAA-1" }, event_key: "order-created:1" }] };
    return { rows: [] };
  } };
  const sent = [];
  const providers = new Map([["email", { async send(message) { sent.push(message); return { messageId: "provider-42" }; } }]]);
  const result = await createNotificationWorker({ db, providers, workerId: "worker-test" }).runBatch();
  assert.deepEqual(result, { claimed: 1, sent: 1, failed: 0 });
  assert.equal(sent[0].idempotencyKey, "order-created:1");
  assert.deepEqual(calls[1].params, [7, "worker-test", "provider-42"]);
});

test("notification worker fails closed when a channel is not configured", async () => {
  const calls = [];
  const db = { async query(text, params) {
    calls.push({ text, params });
    if (text.includes("claim_notification_jobs")) return { rows: [{ id: 8, channel: "whatsapp", recipient: "+2348012345678", template_key: "order-created", payload: {}, event_key: "order-created:2" }] };
    return { rows: [] };
  } };
  const result = await createNotificationWorker({ db, providers: new Map(), workerId: "worker-test", logger: { error() {} } }).runBatch();
  assert.deepEqual(result, { claimed: 1, sent: 0, failed: 1 });
  assert.match(calls[1].params[2], /No approved whatsapp/);
});
