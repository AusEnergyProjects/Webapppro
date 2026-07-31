import { getD1 } from "../../db";
import { dispatchAdminNotificationDeliveries } from "@/lib/admin-notification-delivery";
import { drainOpportunityNotificationDeliveries } from "@/lib/opportunity-notification-server";
import { allocateNearestInstallers } from "@/lib/opportunity-server";

export const CUSTOMER_OPPORTUNITY_DISPATCH_HEADER =
  "X-AEA-Customer-Opportunity-Dispatch";

const MAX_ATTEMPTS = 5;
const CLAIM_TIMEOUT_MS = 10 * 60 * 1000;

type DispatchJobRow = {
  id: string;
  opportunity_id: string;
  admin_notification_id: string;
  status: string;
  attempts: number;
};

type DrainOptions = {
  jobId?: string;
  limit?: number;
  fetchImpl?: typeof fetch;
};

function boundedError(error: unknown) {
  return (
    error instanceof Error ? error.message : "Customer opportunity dispatch failed."
  ).trim().slice(0, 300);
}

function retryAt(attempts: number) {
  const delayMinutes = [5, 30, 120, 360, 720][
    Math.min(Math.max(Number(attempts) - 1, 0), 4)
  ];
  return new Date(Date.now() + delayMinutes * 60 * 1000).toISOString();
}

async function outstandingNotificationCounts(row: DispatchJobRow) {
  const db = getD1();
  const [admin, trade] = await Promise.all([
    db.prepare(`SELECT COUNT(*) count
      FROM admin_notification_deliveries
      WHERE notification_id = ?
        AND status IN ('pending', 'failed', 'waiting_for_channel')`)
      .bind(row.admin_notification_id)
      .first<{ count: number }>(),
    db.prepare(`SELECT COUNT(*) count
      FROM trade_opportunity_notification_deliveries delivery
      WHERE delivery.status IN ('pending', 'failed', 'waiting_for_channel', 'sending')
        AND EXISTS (
          SELECT 1 FROM trade_opportunity_matches assignment
          WHERE assignment.id = delivery.match_id
            AND assignment.opportunity_id = ?
        )`)
      .bind(row.opportunity_id)
      .first<{ count: number }>(),
  ]);
  return {
    admin: Number(admin?.count || 0),
    trade: Number(trade?.count || 0),
  };
}

async function recoverInterruptedJobs(jobId = "") {
  const db = getD1();
  const now = new Date().toISOString();
  const cutoff = new Date(Date.now() - CLAIM_TIMEOUT_MS).toISOString();
  const idFilter = jobId ? " AND id = ?" : "";
  const statement = db.prepare(`UPDATE customer_opportunity_dispatch_jobs
    SET status = 'failed', failed_at = ?, last_error = 'Recovered an interrupted dispatch attempt.',
      next_attempt_at = ?, claimed_at = '', updated_at = ?
    WHERE status = 'processing' AND claimed_at <> '' AND claimed_at <= ?${idFilter}`);
  if (jobId) await statement.bind(now, now, now, cutoff, jobId).run();
  else await statement.bind(now, now, now, cutoff).run();
}

async function claimJobs(jobId: string, limit: number) {
  const db = getD1();
  const now = new Date().toISOString();
  const boundedLimit = Math.max(1, Math.min(20, Math.floor(Number(limit) || 10)));
  const idFilter = jobId ? " AND id = ?" : "";
  const query = db.prepare(`SELECT id, opportunity_id, admin_notification_id, status, attempts
    FROM customer_opportunity_dispatch_jobs
    WHERE status IN ('pending', 'failed') AND attempts < ?
      AND (next_attempt_at = '' OR next_attempt_at <= ?)${idFilter}
    ORDER BY created_at, id
    LIMIT ?`);
  const rows = jobId
    ? await query.bind(MAX_ATTEMPTS, now, jobId, boundedLimit).all<DispatchJobRow>()
    : await query.bind(MAX_ATTEMPTS, now, boundedLimit).all<DispatchJobRow>();
  const claimed: DispatchJobRow[] = [];
  for (const row of rows.results) {
    const result = await db.prepare(`UPDATE customer_opportunity_dispatch_jobs
      SET status = 'processing', attempts = ?, claimed_at = ?, next_attempt_at = '',
        failed_at = '', last_error = '', updated_at = ?
      WHERE id = ? AND status = ? AND attempts = ?`)
      .bind(Number(row.attempts || 0) + 1, now, now, row.id, row.status, row.attempts)
      .run();
    if (Number(result.meta.changes || 0) === 1) {
      claimed.push({ ...row, attempts: Number(row.attempts || 0) + 1 });
    }
  }
  return claimed;
}

async function dispatchJob(row: DispatchJobRow, fetchImpl: typeof fetch) {
  const db = getD1();
  const adminAttempt = dispatchAdminNotificationDeliveries({
    notificationId: row.admin_notification_id,
    force: true,
    fetchImpl,
  }).then(
    (result) => ({ result, error: "" }),
    (error) => ({ result: null, error: boundedError(error) }),
  );
  try {
    await allocateNearestInstallers(row.opportunity_id, "customer-platform");
    const [adminOutcome, tradeOutcome] = await Promise.all([
      adminAttempt,
      drainOpportunityNotificationDeliveries({
        opportunityId: row.opportunity_id,
        limit: 20,
        fetchImpl,
      }),
    ]);
    if (adminOutcome.error) {
      throw new Error(`Admin alert delivery failed: ${adminOutcome.error}`);
    }
    const deliveryFailures = [
      Number(adminOutcome.result?.failed || 0) > 0
        ? `${adminOutcome.result?.failed} admin alert delivery attempt failed.`
        : "",
      Number(tradeOutcome.failed || 0) > 0
        ? `${tradeOutcome.failed} trade notification delivery attempt failed.`
        : "",
    ].filter(Boolean);
    if (deliveryFailures.length) {
      throw new Error(deliveryFailures.join(" "));
    }
    const outstanding = await outstandingNotificationCounts(row);
    if (outstanding.admin > 0 || outstanding.trade > 0) {
      throw new Error(
        `${outstanding.admin} admin and ${outstanding.trade} trade notification deliveries remain pending.`,
      );
    }
    const completedAt = new Date().toISOString();
    await db.prepare(`UPDATE customer_opportunity_dispatch_jobs
      SET status = 'completed', completed_at = ?, claimed_at = '', failed_at = '',
        last_error = '', next_attempt_at = '', updated_at = ?
      WHERE id = ? AND status = 'processing' AND attempts = ?`)
      .bind(completedAt, completedAt, row.id, row.attempts)
      .run();
    return "completed" as const;
  } catch (error) {
    const adminError = (await adminAttempt).error;
    const failedAt = new Date().toISOString();
    const message = [
      boundedError(error),
      adminError ? `Admin alert: ${adminError}` : "",
    ].filter(Boolean).join(" ").slice(0, 300);
    await db.prepare(`UPDATE customer_opportunity_dispatch_jobs
      SET status = 'failed', failed_at = ?, claimed_at = '', last_error = ?,
        next_attempt_at = ?, updated_at = ?
      WHERE id = ? AND status = 'processing' AND attempts = ?`)
      .bind(
        failedAt,
        message,
        retryAt(row.attempts),
        failedAt,
        row.id,
        row.attempts,
      )
      .run();
    return "failed" as const;
  }
}

export async function drainCustomerOpportunityDispatchJobs({
  jobId = "",
  limit = 10,
  fetchImpl = fetch,
}: DrainOptions = {}) {
  await recoverInterruptedJobs(jobId);
  const jobs = await claimJobs(jobId, limit);
  const outcomes = await Promise.all(
    jobs.map((row) => dispatchJob(row, fetchImpl)),
  );
  return {
    attempted: jobs.length,
    completed: outcomes.filter((outcome) => outcome === "completed").length,
    failed: outcomes.filter((outcome) => outcome === "failed").length,
  };
}
