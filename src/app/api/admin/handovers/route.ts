import { getD1 } from "../../../../../db";
import { adminError, adminJson, cleanAdminText, requireAdminIdentity, sameOrigin, writeAdminAudit } from "@/lib/admin-server";

export const runtime = "edge";

const DECISIONS = new Set(["approve", "changes_requested", "reject"]);
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const PHONE_PATTERN = /(?:\+?\d[\s().-]*){8,}/;

function shapeRows(rows: Record<string, unknown>[], key: string, value: unknown) {
  return rows.filter((row) => row[key] === value);
}

export async function GET(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    await requireAdminIdentity(request);
    const db = getD1();
    const [packRows, assetRows, complianceRows, documentRows] = await Promise.all([
      db.prepare(`SELECT p.id, p.work_order_id, p.firebase_uid, p.customer_project_id, p.service_category,
        p.status, p.submitted_at, p.published_at, p.review_note, p.reviewed_at, p.created_at, p.updated_at,
        w.work_number, w.title work_title, w.stage work_stage, a.business_name installer_business
        FROM trade_handover_packs p
        JOIN trade_work_orders w ON w.id = p.work_order_id
        JOIN trade_accounts a ON a.firebase_uid = p.firebase_uid
        ORDER BY CASE p.status WHEN 'submitted' THEN 0 WHEN 'changes_requested' THEN 1
          WHEN 'published' THEN 2 ELSE 3 END, p.updated_at DESC LIMIT 200`).all<Record<string, unknown>>(),
      db.prepare(`SELECT id, handover_pack_id, asset_category, brand, model_number, serial_number,
        quantity, installed_at, warranty_provider, warranty_reference, warranty_start, warranty_end
        FROM trade_installed_assets WHERE record_status = 'active'
          AND handover_pack_id IN (SELECT id FROM trade_handover_packs ORDER BY updated_at DESC LIMIT 200)
        ORDER BY created_at`).all<Record<string, unknown>>(),
      db.prepare(`SELECT id, handover_pack_id, template_key, label, guidance, status, completed_at
        FROM trade_compliance_items
        WHERE handover_pack_id IN (SELECT id FROM trade_handover_packs ORDER BY updated_at DESC LIMIT 200)
        ORDER BY created_at`).all<Record<string, unknown>>(),
      db.prepare(`SELECT id, handover_pack_id, category, file_name, content_type, size_bytes,
        customer_visible, created_at FROM trade_handover_documents
        WHERE handover_pack_id IN (SELECT id FROM trade_handover_packs ORDER BY updated_at DESC LIMIT 200)
        ORDER BY created_at DESC`).all<Record<string, unknown>>(),
    ]);
    return adminJson({
      ok: true,
      handovers: packRows.results.map((row: Record<string, unknown>) => ({
        id: row.id,
        workOrderId: row.work_order_id,
        customerLinked: Boolean(row.customer_project_id),
        serviceCategory: row.service_category,
        status: row.status,
        submittedAt: row.submitted_at,
        publishedAt: row.published_at,
        reviewNote: row.review_note,
        reviewedAt: row.reviewed_at,
        updatedAt: row.updated_at,
        workNumber: row.work_number,
        workTitle: row.work_title,
        workStage: row.work_stage,
        installerBusiness: row.installer_business,
        assets: shapeRows(assetRows.results, "handover_pack_id", row.id).map((item) => ({
          id: item.id,
          assetCategory: item.asset_category,
          brand: item.brand,
          modelNumber: item.model_number,
          serialNumber: item.serial_number,
          quantity: Number(item.quantity || 1),
          installedAt: item.installed_at,
          warrantyProvider: item.warranty_provider,
          warrantyReference: item.warranty_reference,
          warrantyStart: item.warranty_start,
          warrantyEnd: item.warranty_end,
        })),
        complianceItems: shapeRows(complianceRows.results, "handover_pack_id", row.id).map((item) => ({
          id: item.id,
          templateKey: item.template_key,
          label: item.label,
          guidance: item.guidance,
          status: item.status,
          completedAt: item.completed_at,
        })),
        documents: shapeRows(documentRows.results, "handover_pack_id", row.id).map((item) => ({
          id: item.id,
          category: item.category,
          fileName: item.file_name,
          contentType: item.content_type,
          sizeBytes: Number(item.size_bytes || 0),
          customerVisible: Boolean(item.customer_visible),
          createdAt: item.created_at,
        })),
      })),
    });
  } catch (error) {
    return adminError(error);
  }
}

export async function PATCH(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const admin = await requireAdminIdentity(request, ["owner", "admin", "reviewer"]);
    let body: Record<string, unknown>;
    try { body = await request.json() as Record<string, unknown>; }
    catch { return adminJson({ ok: false, error: "Invalid handover review decision." }, 400); }
    const id = cleanAdminText(body.id, 180);
    const decision = cleanAdminText(body.decision, 40);
    const reviewNote = cleanAdminText(body.reviewNote, 1200);
    if (!id || !DECISIONS.has(decision)) return adminJson({ ok: false, error: "Choose a valid handover review decision." }, 400);
    if (["changes_requested", "reject"].includes(decision) && !reviewNote) {
      return adminJson({ ok: false, error: "Add a clear review note for the installer." }, 400);
    }
    if (EMAIL_PATTERN.test(reviewNote) || PHONE_PATTERN.test(reviewNote)) {
      return adminJson({ ok: false, error: "Keep customer email addresses and phone numbers out of the installer review note." }, 400);
    }
    const db = getD1();
    const current = await db.prepare(`SELECT p.id, p.status, p.work_order_id, p.customer_project_id,
      w.work_number, w.stage work_stage, a.business_name, c.status customer_project_status,
      (SELECT COUNT(*) FROM trade_installed_assets x WHERE x.handover_pack_id = p.id AND x.record_status = 'active') asset_count,
      (SELECT COUNT(*) FROM trade_compliance_items c WHERE c.handover_pack_id = p.id AND c.status NOT IN ('complete', 'not_applicable')) unresolved_count,
      (SELECT COUNT(*) FROM trade_handover_documents d WHERE d.handover_pack_id = p.id AND d.customer_visible = 1) visible_document_count
      FROM trade_handover_packs p
      JOIN trade_work_orders w ON w.id = p.work_order_id
      JOIN trade_accounts a ON a.firebase_uid = p.firebase_uid
      LEFT JOIN customer_projects c ON c.id = p.customer_project_id
      WHERE p.id = ?`).bind(id).first<Record<string, unknown>>();
    if (!current) return adminJson({ ok: false, error: "Handover pack not found." }, 404);
    if (current.status !== "submitted") return adminJson({ ok: false, error: "Only submitted handover packs can be reviewed." }, 409);
    if ((!current.customer_project_id || ["withdrawn", "archived"].includes(String(current.customer_project_status || ""))) && decision === "approve") {
      return adminJson({ ok: false, error: "A customer handover cannot be published without a linked private customer project." }, 409);
    }
    if (decision === "approve" && (current.work_stage !== "completed" || Number(current.asset_count || 0) < 1 || Number(current.unresolved_count || 0) > 0 || Number(current.visible_document_count || 0) < 1)) {
      return adminJson({ ok: false, error: "The handover no longer meets the completion, asset, checklist or customer-document safeguards." }, 409);
    }
    const nextStatus = decision === "approve" ? "published" : decision === "changes_requested" ? "changes_requested" : "rejected";
    const now = new Date().toISOString();
    await db.batch([
      db.prepare(`UPDATE trade_handover_packs SET status = ?, published_at = ?, review_note = ?,
        reviewed_by_uid = ?, reviewed_at = ?, updated_at = ? WHERE id = ? AND status = 'submitted'`)
        .bind(nextStatus, decision === "approve" ? now : "", reviewNote, admin.uid, now, now, id),
      db.prepare(`UPDATE admin_notifications SET status = 'resolved', read_at = CASE WHEN read_at = '' THEN ? ELSE read_at END,
        read_by_uid = CASE WHEN read_by_uid = '' THEN ? ELSE read_by_uid END, resolved_at = ?, resolved_by_uid = ?,
        resolution_note = ?, updated_at = ? WHERE entity_type = 'trade_handover_pack' AND entity_id = ? AND status != 'resolved'`)
        .bind(now, admin.uid, now, admin.uid, `Handover review: ${nextStatus}`, now, id),
      db.prepare(`INSERT INTO trade_work_order_events
        (id, work_order_id, firebase_uid, event_type, summary, created_at)
        SELECT ?, work_order_id, firebase_uid, ?, ?, ? FROM trade_handover_packs WHERE id = ?`)
        .bind(crypto.randomUUID(), decision === "approve" ? "handover_published" : "handover_reviewed",
          decision === "approve" ? "Customer handover pack approved and published." : `Customer handover review returned as ${nextStatus.replaceAll("_", " ")}.`, now, id),
    ]);
    await writeAdminAudit(admin, "handover.review", "trade_handover_pack", id,
      `${String(current.work_number)} handover reviewed: ${nextStatus}.`, {
        before: current.status,
        after: nextStatus,
        reviewNote: Boolean(reviewNote),
        installerBusiness: current.business_name,
      });
    return adminJson({ ok: true, status: nextStatus });
  } catch (error) {
    return adminError(error);
  }
}
