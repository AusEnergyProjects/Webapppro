import { getD1 } from "../../../../db";
import { requireFirebaseIdentity } from "@/lib/firebase-server";
import {
  getCustomerProjectEvidenceBucket as getEvidenceBucket,
} from "@/lib/customer-project-evidence-bucket";
import {
  CUSTOMER_EVIDENCE_QUOTING_PHOTO_CATEGORIES as QUOTING_PHOTO_CATEGORIES,
  cleanCustomerEvidenceId,
  type CustomerEvidenceRecord as EvidenceRecord,
} from "@/lib/customer-project-evidence";
import { verifiedTradeAccountPredicate } from "@/lib/trade-access-server";
import { customerAccountRetired } from "@/lib/customer-account-retirement.mjs";

export const runtime = "edge";

function json(body: object, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}

async function identity(request: Request) {
  try { return await requireFirebaseIdentity(request); }
  catch { return null; }
}

async function installerCanAccess(installerUid: string, record: EvidenceRecord) {
  if (record.sharing_scope !== "allocated-installers") return false;
  const access = await getD1().prepare(`SELECT m.id
    FROM customer_projects p
    JOIN trade_opportunity_matches m ON m.opportunity_id = p.opportunity_id
    JOIN trade_opportunities o ON o.id = m.opportunity_id
    JOIN trade_accounts a ON a.firebase_uid = m.firebase_uid
    WHERE p.id = ? AND p.firebase_uid = ? AND m.firebase_uid = ?
      AND m.status IN ('offered', 'viewed', 'interested', 'connected')
      AND o.status IN ('open', 'paused') AND a.partner_type = 'installer'
      AND EXISTS (
        SELECT 1 FROM customer_consent_receipts consent
        WHERE consent.project_id = p.id AND consent.firebase_uid = p.firebase_uid
          AND consent.purpose = 'installer_evidence_sharing' AND consent.withdrawn_at = ''
      )
      AND ${verifiedTradeAccountPredicate("a")} LIMIT 1`)
    .bind(record.project_id, record.customer_uid, installerUid).first();
  return Boolean(access);
}

function installerDownloadName(record: EvidenceRecord) {
  if (!QUOTING_PHOTO_CATEGORIES.has(record.category)) return `customer-project-document.${record.content_type === "application/pdf" ? "pdf" : "bin"}`;
  const extension = record.content_type === "image/png" ? "png"
    : record.content_type === "image/webp" ? "webp"
      : record.content_type === "image/heic" ? "heic"
        : record.content_type === "image/heif" ? "heif" : "jpg";
  return `customer-quoting-photo.${extension}`;
}

export async function GET(request: Request) {
  if (!sameOrigin(request)) return json({ ok: false, error: "Request origin was not accepted." }, 403);
  const user = await identity(request);
  if (!user) return json({ ok: false, error: "Sign in to continue." }, 401);
  const url = new URL(request.url);
  const downloadId = cleanCustomerEvidenceId(url.searchParams.get("download"));
  if (downloadId) {
    const record = await getD1().prepare(`SELECT * FROM customer_project_evidence WHERE id = ? AND status = 'active'`)
      .bind(downloadId).first<EvidenceRecord>();
    if (!record) return json({ ok: false, error: "Project evidence not found." }, 404);
    const installerAccess = await installerCanAccess(user.uid, record);
    if (!installerAccess) return json({ ok: false, error: "Project evidence access was not accepted." }, 403);
    const object = await getEvidenceBucket().get(record.object_key);
    if (!object) return json({ ok: false, error: "Stored project evidence was not found." }, 404);
    if (installerAccess) {
      await getD1().prepare(`INSERT INTO customer_project_evidence_events
        (id, evidence_id, project_id, customer_uid, installer_uid, actor_type, actor_uid, event_type, created_at)
        VALUES (?, ?, ?, ?, ?, 'installer', ?, 'viewed', ?)`)
        .bind(crypto.randomUUID(), record.id, record.project_id, record.customer_uid, user.uid, user.uid, new Date().toISOString()).run();
    }
    return new Response(object.body, {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Disposition": `attachment; filename="${installerDownloadName(record)}"`,
        "Content-Type": object.httpMetadata?.contentType || record.content_type,
        "X-Content-Type-Options": "nosniff",
      },
    });
  }
  return customerAccountRetired();
}

export const POST = customerAccountRetired;
export const PATCH = customerAccountRetired;
export const DELETE = customerAccountRetired;
