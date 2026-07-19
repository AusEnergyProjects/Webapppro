import { getD1 } from "../../../../db";
import { adminJson, cleanAdminText, sameOrigin } from "@/lib/admin-server";
import { requireInstallerTeamAccess, type TeamAccess } from "@/lib/trade-team-server";

export const runtime = "edge";

type Row = Record<string, unknown>;

function notificationError(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  if (code === "AUTH_REQUIRED") return adminJson({ ok: false, error: "Sign in to continue." }, 401);
  if (["ACCOUNT_INACTIVE", "INSTALLER_ONLY", "FULL_ACCESS_REQUIRED", "TEAM_ACCESS_REQUIRED", "TEAM_MEMBERSHIP_REQUIRED"].includes(code)) {
    return adminJson({ ok: false, error: "An active installer account is required." }, 403);
  }
  return adminJson({ ok: false, error: "Job notifications could not be loaded." }, 500);
}

function key(id: unknown) {
  return `customer-photos-ready:${String(id)}`;
}

async function notifications(access: TeamAccess) {
  const rows = await getD1().prepare(`SELECT completion.id, completion.work_order_id, completion.supplied_count,
      completion.completed_at, work.work_number, work.title,
      CASE WHEN reads.notification_key IS NULL THEN 0 ELSE 1 END is_read
    FROM trade_crm_photo_request_completions completion
    JOIN trade_work_orders work ON work.id = completion.work_order_id AND work.firebase_uid = completion.firebase_uid
      AND work.record_status = 'active'
    LEFT JOIN trade_job_notification_reads reads ON reads.firebase_uid = completion.firebase_uid
      AND reads.read_by_uid = ? AND reads.notification_key = 'customer-photos-ready:' || completion.id
    WHERE completion.firebase_uid = ? AND (? <> 'technician' OR work.assignee_member_id = ?)
    ORDER BY completion.completed_at DESC LIMIT 40`)
    .bind(access.actorUid, access.ownerUid, access.role, access.memberId).all<Row>();
  const items = rows.results.map((row) => ({
    id: key(row.id),
    workOrderId: String(row.work_order_id),
    workNumber: String(row.work_number),
    title: "Customer photos ready",
    summary: `${Number(row.supplied_count)} ${Number(row.supplied_count) === 1 ? "file is" : "files are"} ready to review for ${String(row.title)}.`,
    createdAt: String(row.completed_at),
    read: Boolean(row.is_read),
  }));
  return { items, unreadCount: items.filter((item) => !item.read).length };
}

export async function GET(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const access = await requireInstallerTeamAccess(request, false);
    return adminJson({ ok: true, ...(await notifications(access)) });
  } catch (error) { return notificationError(error); }
}

export async function PATCH(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const access = await requireInstallerTeamAccess(request, false);
    const body = await request.json().catch(() => ({})) as Row;
    const notificationKey = cleanAdminText(body.notificationKey, 240);
    if (!notificationKey.startsWith("customer-photos-ready:")) {
      return adminJson({ ok: false, error: "Choose a job notification." }, 400);
    }
    const completionId = notificationKey.slice("customer-photos-ready:".length);
    const completion = await getD1().prepare(`SELECT completion.id FROM trade_crm_photo_request_completions completion
      JOIN trade_work_orders work ON work.id = completion.work_order_id AND work.firebase_uid = completion.firebase_uid
      WHERE completion.id = ? AND completion.firebase_uid = ? AND (? <> 'technician' OR work.assignee_member_id = ?)`)
      .bind(completionId, access.ownerUid, access.role, access.memberId).first<Row>();
    if (!completion) return adminJson({ ok: false, error: "Job notification not found." }, 404);
    await getD1().prepare(`INSERT OR IGNORE INTO trade_job_notification_reads
      (id, firebase_uid, notification_key, read_by_uid, read_at) VALUES (?, ?, ?, ?, ?)`)
      .bind(crypto.randomUUID(), access.ownerUid, notificationKey, access.actorUid, new Date().toISOString()).run();
    return adminJson({ ok: true, ...(await notifications(access)) });
  } catch (error) { return notificationError(error); }
}
