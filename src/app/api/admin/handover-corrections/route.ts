import { getD1 } from "../../../../../db";
import { adminError, adminJson, cleanAdminText, requireAdminIdentity, sameOrigin, writeAdminAudit } from "@/lib/admin-server";
import { correctionFieldLabel } from "@/lib/handover-corrections.mjs";

export const runtime = "edge";

const DECISIONS = new Set(["approve", "reject"]);
const CONTACT_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b|(?:\+?61|0)[2-478](?:[\s-]?\d){8}\b/i;
const UPDATE_SQL: Record<string, string> = {
  brand: "UPDATE trade_installed_assets SET brand = ?, updated_at = ? WHERE id = ? AND handover_pack_id = ? AND firebase_uid = ? AND record_status = 'active'",
  model_number: "UPDATE trade_installed_assets SET model_number = ?, updated_at = ? WHERE id = ? AND handover_pack_id = ? AND firebase_uid = ? AND record_status = 'active'",
  serial_number: "UPDATE trade_installed_assets SET serial_number = ?, updated_at = ? WHERE id = ? AND handover_pack_id = ? AND firebase_uid = ? AND record_status = 'active'",
  quantity: "UPDATE trade_installed_assets SET quantity = ?, updated_at = ? WHERE id = ? AND handover_pack_id = ? AND firebase_uid = ? AND record_status = 'active'",
  installed_at: "UPDATE trade_installed_assets SET installed_at = ?, updated_at = ? WHERE id = ? AND handover_pack_id = ? AND firebase_uid = ? AND record_status = 'active'",
  warranty_provider: "UPDATE trade_installed_assets SET warranty_provider = ?, updated_at = ? WHERE id = ? AND handover_pack_id = ? AND firebase_uid = ? AND record_status = 'active'",
  warranty_reference: "UPDATE trade_installed_assets SET warranty_reference = ?, updated_at = ? WHERE id = ? AND handover_pack_id = ? AND firebase_uid = ? AND record_status = 'active'",
  warranty_start: "UPDATE trade_installed_assets SET warranty_start = ?, updated_at = ? WHERE id = ? AND handover_pack_id = ? AND firebase_uid = ? AND record_status = 'active'",
  warranty_end: "UPDATE trade_installed_assets SET warranty_end = ?, updated_at = ? WHERE id = ? AND handover_pack_id = ? AND firebase_uid = ? AND record_status = 'active'",
};

async function correctionPayload() {
  const rows = await getD1().prepare(`SELECT c.id, c.handover_pack_id, c.work_order_id, c.asset_id,
    c.version_number, c.field_key, c.previous_value, c.proposed_value, c.reason, c.status,
    c.submitted_at, c.published_at, c.review_note, c.reviewed_at, c.updated_at,
    a.brand, a.model_number, w.work_number, w.title work_title, t.business_name installer_business
    FROM trade_handover_corrections c
    JOIN trade_installed_assets a ON a.id = c.asset_id
    JOIN trade_work_orders w ON w.id = c.work_order_id
    JOIN trade_accounts t ON t.firebase_uid = c.firebase_uid
    ORDER BY CASE c.status WHEN 'submitted' THEN 0 WHEN 'published' THEN 1 ELSE 2 END,
      c.updated_at DESC LIMIT 250`).all<Record<string, unknown>>();
  return rows.results.map((row: Record<string, unknown>) => ({
    id: String(row.id), handoverPackId: String(row.handover_pack_id), workOrderId: String(row.work_order_id),
    assetId: String(row.asset_id), versionNumber: Number(row.version_number), fieldKey: String(row.field_key),
    fieldLabel: correctionFieldLabel(row.field_key), previousValue: String(row.previous_value || ""),
    proposedValue: String(row.proposed_value || ""), reason: String(row.reason), status: String(row.status),
    submittedAt: String(row.submitted_at), publishedAt: String(row.published_at || ""),
    reviewNote: String(row.review_note || ""), reviewedAt: String(row.reviewed_at || ""), updatedAt: String(row.updated_at),
    assetLabel: `${String(row.brand)} ${String(row.model_number)}`, workNumber: String(row.work_number),
    workTitle: String(row.work_title), installerBusiness: String(row.installer_business),
  }));
}

export async function GET(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    await requireAdminIdentity(request);
    return adminJson({ ok: true, corrections: await correctionPayload() });
  } catch (error) { return adminError(error); }
}

export async function PATCH(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const admin = await requireAdminIdentity(request, ["owner", "admin", "reviewer"]);
    const body = await request.json() as Record<string, unknown>;
    const id = cleanAdminText(body.id, 180);
    const decision = cleanAdminText(body.decision, 30);
    const reviewNote = cleanAdminText(body.reviewNote, 800);
    if (!DECISIONS.has(decision)) return adminJson({ ok: false, error: "Choose approve or reject." }, 400);
    if (decision === "reject" && !reviewNote) return adminJson({ ok: false, error: "Add a clear reason when rejecting a correction." }, 400);
    if (CONTACT_PATTERN.test(reviewNote)) return adminJson({ ok: false, error: "Keep customer contact details out of the correction review note." }, 400);
    const db = getD1();
    const correction = await db.prepare(`SELECT c.id, c.handover_pack_id, c.work_order_id, c.firebase_uid,
      c.asset_id, c.version_number, c.field_key, c.previous_value, c.proposed_value, c.status,
      a.brand, a.model_number, a.serial_number, a.quantity, a.installed_at, a.warranty_provider,
      a.warranty_reference, a.warranty_start, a.warranty_end
      FROM trade_handover_corrections c JOIN trade_installed_assets a ON a.id = c.asset_id
      WHERE c.id = ?`).bind(id).first<Record<string, unknown>>();
    if (!correction) return adminJson({ ok: false, error: "Handover correction not found." }, 404);
    if (correction.status !== "submitted") return adminJson({ ok: false, error: "Only submitted corrections can be reviewed." }, 409);
    if (!UPDATE_SQL[String(correction.field_key)]) return adminJson({ ok: false, error: "This correction field is no longer supported." }, 409);
    const currentValue = String(correction[String(correction.field_key)] ?? "");
    if (decision === "approve" && currentValue !== String(correction.previous_value || "")) {
      return adminJson({ ok: false, error: "The approved asset value changed after this correction was submitted. Reject it and ask the installer to submit a new version." }, 409);
    }
    const futureWarrantyStart = correction.field_key === "warranty_start" ? String(correction.proposed_value || "") : String(correction.warranty_start || "");
    const futureWarrantyEnd = correction.field_key === "warranty_end" ? String(correction.proposed_value || "") : String(correction.warranty_end || "");
    if (decision === "approve" && futureWarrantyStart && futureWarrantyEnd && futureWarrantyEnd < futureWarrantyStart) {
      return adminJson({ ok: false, error: "This correction would make the warranty end before its start date." }, 409);
    }
    const now = new Date().toISOString();
    if (decision === "approve") {
      await db.batch([
        db.prepare(UPDATE_SQL[String(correction.field_key)]).bind(
          correction.field_key === "quantity" ? Number(correction.proposed_value) : correction.proposed_value,
          now, correction.asset_id, correction.handover_pack_id, correction.firebase_uid,
        ),
        db.prepare(`UPDATE trade_handover_corrections SET status = 'published', published_at = ?,
          review_note = ?, reviewed_by_uid = ?, reviewed_at = ?, updated_at = ?
          WHERE id = ? AND status = 'submitted'`).bind(now, reviewNote, admin.uid, now, now, id),
        db.prepare(`INSERT INTO trade_work_order_events
          (id, work_order_id, firebase_uid, event_type, summary, created_at)
          VALUES (?, ?, ?, 'handover_correction_published', ?, ?)`)
          .bind(crypto.randomUUID(), correction.work_order_id, correction.firebase_uid,
            `Version ${Number(correction.version_number)} ${correctionFieldLabel(correction.field_key)} correction approved and published.`, now),
        db.prepare(`UPDATE admin_notifications SET status = 'resolved', read_at = CASE WHEN read_at = '' THEN ? ELSE read_at END,
          read_by_uid = CASE WHEN read_by_uid = '' THEN ? ELSE read_by_uid END, resolved_at = ?, resolved_by_uid = ?,
          resolution_note = 'Versioned handover correction approved.', updated_at = ?
          WHERE entity_type = 'trade_handover_correction' AND entity_id = ? AND status != 'resolved'`)
          .bind(now, admin.uid, now, admin.uid, now, id),
      ]);
      await writeAdminAudit(admin, "handover_correction.approve", "trade_handover_correction", id,
        `Approved version ${Number(correction.version_number)} ${correctionFieldLabel(correction.field_key)} correction.`,
        { handoverPackId: correction.handover_pack_id, previousValueRetained: true });
    } else {
      await db.batch([
        db.prepare(`UPDATE trade_handover_corrections SET status = 'rejected', review_note = ?,
          reviewed_by_uid = ?, reviewed_at = ?, updated_at = ? WHERE id = ? AND status = 'submitted'`)
          .bind(reviewNote, admin.uid, now, now, id),
        db.prepare(`UPDATE admin_notifications SET status = 'resolved', read_at = CASE WHEN read_at = '' THEN ? ELSE read_at END,
          read_by_uid = CASE WHEN read_by_uid = '' THEN ? ELSE read_by_uid END, resolved_at = ?, resolved_by_uid = ?,
          resolution_note = 'Versioned handover correction rejected.', updated_at = ?
          WHERE entity_type = 'trade_handover_correction' AND entity_id = ? AND status != 'resolved'`)
          .bind(now, admin.uid, now, admin.uid, now, id),
      ]);
      await writeAdminAudit(admin, "handover_correction.reject", "trade_handover_correction", id,
        `Rejected version ${Number(correction.version_number)} handover correction.`, { reviewNote: true });
    }
    return adminJson({ ok: true, corrections: await correctionPayload() });
  } catch (error) {
    if (error instanceof SyntaxError) return adminJson({ ok: false, error: "Invalid correction review request." }, 400);
    return adminError(error);
  }
}
