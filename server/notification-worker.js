import { randomUUID } from "node:crypto";

export function createNotificationWorker({ db, providers, workerId = `notification-${randomUUID()}`, logger = console }) {
  async function runBatch(batchSize = 20) {
    const claimed = await db.query("select * from claim_notification_jobs($1,$2,$3::interval)", [workerId, batchSize, "5 minutes"]);
    let sent = 0;
    let failed = 0;
    for (const job of claimed.rows) {
      const provider = providers.get(job.channel);
      try {
        if (!provider) throw new Error(`No approved ${job.channel} notification provider is configured`);
        const result = await provider.send({
          recipient: job.recipient, template: job.template_key, data: job.payload,
          idempotencyKey: job.event_key
        });
        await db.query("select complete_notification_job($1,$2,$3)", [job.id, workerId, result?.messageId || null]);
        sent += 1;
      } catch (error) {
        logger.error?.({ jobId: job.id, channel: job.channel, error: error.message }, "Notification delivery failed");
        await db.query("select fail_notification_job($1,$2,$3)", [job.id, workerId, error.message]);
        failed += 1;
      }
    }
    return { claimed: claimed.rows.length, sent, failed };
  }
  return { workerId, runBatch };
}
