import { env } from "cloudflare:workers";
import { getD1 } from "../../../../db";
import { adminJson, cleanAdminText, sameOrigin } from "@/lib/admin-server";
import { assignedJob, canViewQuotes, requireInstallerTeamAccess } from "@/lib/trade-team-server";

export const runtime = "edge";

type JobMediaBucket = {
  get(key: string): Promise<{ body: BodyInit; httpMetadata?: { contentType?: string } } | null>;
};
type Row = Record<string, unknown>;

function bucket() {
  const value = (env as unknown as { EVIDENCE?: JobMediaBucket }).EVIDENCE;
  if (!value) throw new Error("STORAGE_UNAVAILABLE");
  return value;
}

function errorResponse(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  if (code === "AUTH_REQUIRED") return adminJson({ ok: false, error: "Sign in to continue." }, 401);
  if (code === "QUOTE_VIEW_REQUIRED") return adminJson({ ok: false, error: "Your team access does not include customer quotes." }, 403);
  if (code === "JOB_NOT_ASSIGNED") return adminJson({ ok: false, error: "This quote belongs to a job outside your assigned work." }, 403);
  if (code === "JOB_NOT_FOUND" || code === "MEDIA_NOT_FOUND") return adminJson({ ok: false, error: "Customer-shared job file not found." }, 404);
  if (code === "STORAGE_UNAVAILABLE") return adminJson({ ok: false, error: "Job file storage is temporarily unavailable." }, 503);
  return adminJson({ ok: false, error: "Customer-shared job files could not be opened." }, 500);
}

export async function GET(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const access = await requireInstallerTeamAccess(request);
    if (!canViewQuotes(access)) throw new Error("QUOTE_VIEW_REQUIRED");
    const search = new URL(request.url).searchParams;
    const workOrderId = cleanAdminText(search.get("workOrderId"), 180);
    const mediaId = cleanAdminText(search.get("mediaId"), 240);
    const job = await assignedJob(access, workOrderId);
    if (job.source_type === "opportunity" || job.customer_source === "platform_private") {
      throw new Error("MEDIA_NOT_FOUND");
    }
    if (!mediaId) {
      const rows = await getD1().prepare(`SELECT id, caption, content_type, size_bytes, created_at
        FROM trade_crm_job_media
        WHERE firebase_uid = ? AND work_order_id = ? AND source = 'accepted_public_lead'
          AND content_type IN ('image/jpeg', 'image/png')
        ORDER BY created_at, id`)
        .bind(access.ownerUid, workOrderId).all<Row>();
      return adminJson({ ok: true, acceptedPhotos: rows.results.map((row) => ({
        id: String(row.id), label: String(row.caption || "Customer-shared quote photo"),
        contentType: String(row.content_type), sizeBytes: Number(row.size_bytes),
        createdAt: String(row.created_at),
        contentUrl: `/api/trade-job-quote-photos?workOrderId=${encodeURIComponent(workOrderId)}&mediaId=${encodeURIComponent(String(row.id))}`,
      })) });
    }
    const row = await getD1().prepare(`SELECT id, object_key, content_type, file_name
      FROM trade_crm_job_media
      WHERE id = ? AND firebase_uid = ? AND work_order_id = ?
        AND source = 'accepted_public_lead' AND content_type IN ('image/jpeg', 'image/png')
      LIMIT 1`).bind(mediaId, access.ownerUid, workOrderId).first<Row>();
    if (!row) throw new Error("MEDIA_NOT_FOUND");
    const object = await bucket().get(String(row.object_key));
    if (!object) throw new Error("MEDIA_NOT_FOUND");
    await getD1().prepare(`INSERT INTO trade_crm_job_media_events
      (id, firebase_uid, work_order_id, job_media_id, actor_uid, actor_member_id, event_type, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 'viewed', ?)`)
      .bind(crypto.randomUUID(), access.ownerUid, workOrderId, mediaId,
        access.actorUid, access.memberId, new Date().toISOString()).run();
    return new Response(object.body, { headers: {
      "Cache-Control": "private, no-store", "Content-Type": String(row.content_type),
      "Content-Disposition": `inline; filename="${String(row.file_name || "customer-photo").replace(/[\r\n"\\/]/g, "_")}"`,
      "Content-Security-Policy": "sandbox", "X-Content-Type-Options": "nosniff",
    } });
  } catch (error) { return errorResponse(error); }
}
