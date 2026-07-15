import { getD1 } from "../../../../../db";
import { adminError, adminJson, cleanAdminText, requireAdminIdentity, sameOrigin, writeAdminAudit } from "@/lib/admin-server";
import { expireAssetTransfers, transferEventStatement } from "@/lib/customer-asset-ownership-server";

export const runtime = "edge";

const DECISIONS = new Set(["approve", "reject"]);
const CONTACT_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b|(?:\+?61|0)[2-478](?:[\s-]?\d){8}\b/i;

async function transferPayload() {
  const db = getD1();
  const now = new Date().toISOString();
  await expireAssetTransfers(now);
  const [transferRows, assetRows, eventRows] = await Promise.all([
    db.prepare(`SELECT t.id, t.handover_pack_id, t.status, t.sender_consent_at, t.recipient_consent_at,
      t.expires_at, t.review_note, t.reviewed_at, t.created_at, t.updated_at,
      p.service_category, w.work_number,
      sender.account_status sender_account_status, recipient.account_status recipient_account_status,
      (SELECT COUNT(*) FROM customer_asset_ownerships o
        WHERE o.handover_pack_id = t.handover_pack_id AND o.customer_uid = t.from_customer_uid AND o.status = 'active') sender_owns,
      (SELECT COUNT(*) FROM trade_handover_documents d
        WHERE d.handover_pack_id = t.handover_pack_id AND d.customer_visible = 1) customer_document_count
      FROM customer_asset_transfer_requests t
      JOIN trade_handover_packs p ON p.id = t.handover_pack_id
      JOIN trade_work_orders w ON w.id = p.work_order_id
      LEFT JOIN customer_accounts sender ON sender.firebase_uid = t.from_customer_uid
      LEFT JOIN customer_accounts recipient ON recipient.firebase_uid = t.to_customer_uid
      ORDER BY CASE t.status WHEN 'awaiting_admin' THEN 0 WHEN 'awaiting_recipient' THEN 1 ELSE 2 END,
        t.updated_at DESC LIMIT 250`).all<Record<string, unknown>>(),
    db.prepare(`SELECT a.id, a.handover_pack_id, a.asset_category, a.brand, a.model_number, a.serial_number,
      a.quantity, a.warranty_end FROM trade_installed_assets a
      WHERE a.record_status = 'active' AND a.handover_pack_id IN
        (SELECT handover_pack_id FROM customer_asset_transfer_requests ORDER BY updated_at DESC LIMIT 250)
      ORDER BY a.created_at`).all<Record<string, unknown>>(),
    db.prepare(`SELECT id, transfer_id, event_type, actor_type, summary, created_at
      FROM customer_asset_transfer_events WHERE transfer_id IN
        (SELECT id FROM customer_asset_transfer_requests ORDER BY updated_at DESC LIMIT 250)
      ORDER BY created_at DESC`).all<Record<string, unknown>>(),
  ]);
  return transferRows.results.map((row: Record<string, unknown>) => ({
    id: String(row.id), handoverPackId: String(row.handover_pack_id), status: String(row.status),
    workNumber: String(row.work_number), serviceCategory: String(row.service_category),
    senderConsentAt: String(row.sender_consent_at), recipientConsentAt: String(row.recipient_consent_at || ""),
    expiresAt: String(row.expires_at), reviewNote: String(row.review_note || ""), reviewedAt: String(row.reviewed_at || ""),
    createdAt: String(row.created_at), updatedAt: String(row.updated_at),
    senderAccountActive: row.sender_account_status === "active", recipientAccountActive: row.recipient_account_status === "active",
    senderStillOwns: Number(row.sender_owns || 0) === 1, customerDocumentCount: Number(row.customer_document_count || 0),
    assets: assetRows.results.filter((asset: Record<string, unknown>) => asset.handover_pack_id === row.handover_pack_id).map((asset: Record<string, unknown>) => ({
      id: String(asset.id), assetCategory: String(asset.asset_category), brand: String(asset.brand),
      modelNumber: String(asset.model_number), serialNumber: String(asset.serial_number || ""),
      quantity: Number(asset.quantity || 1), warrantyEnd: String(asset.warranty_end || ""),
    })),
    events: eventRows.results.filter((event: Record<string, unknown>) => event.transfer_id === row.id).map((event: Record<string, unknown>) => ({
      id: String(event.id), eventType: String(event.event_type), actorType: String(event.actor_type),
      summary: String(event.summary), createdAt: String(event.created_at),
    })),
  }));
}

export async function GET(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    await requireAdminIdentity(request);
    return adminJson({ ok: true, transfers: await transferPayload() });
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
    if (decision === "reject" && !reviewNote) return adminJson({ ok: false, error: "Add a clear reason when rejecting an ownership transfer." }, 400);
    if (CONTACT_PATTERN.test(reviewNote)) return adminJson({ ok: false, error: "Keep customer contact details out of the transfer review note." }, 400);
    const db = getD1();
    const now = new Date().toISOString();
    await expireAssetTransfers(now);
    const transfer = await db.prepare(`SELECT id, handover_pack_id, from_customer_uid, to_customer_uid,
      status, sender_consent_at, recipient_consent_at, expires_at
      FROM customer_asset_transfer_requests WHERE id = ?`).bind(id).first<Record<string, unknown>>();
    if (!transfer) return adminJson({ ok: false, error: "Asset transfer not found." }, 404);
    if (transfer.status !== "awaiting_admin" || !transfer.to_customer_uid || !transfer.sender_consent_at ||
      !transfer.recipient_consent_at || String(transfer.expires_at) < now) {
      return adminJson({ ok: false, error: "This transfer is not ready for administrator approval." }, 409);
    }

    if (decision === "approve") {
      const [sender, recipient, ownership] = await Promise.all([
        db.prepare("SELECT account_status FROM customer_accounts WHERE firebase_uid = ?").bind(transfer.from_customer_uid).first<Record<string, unknown>>(),
        db.prepare("SELECT account_status FROM customer_accounts WHERE firebase_uid = ?").bind(transfer.to_customer_uid).first<Record<string, unknown>>(),
        db.prepare(`SELECT id FROM customer_asset_ownerships WHERE handover_pack_id = ?
          AND customer_uid = ? AND status = 'active' AND active_key = ?`)
          .bind(transfer.handover_pack_id, transfer.from_customer_uid, transfer.handover_pack_id).first<Record<string, unknown>>(),
      ]);
      if (sender?.account_status !== "active" || recipient?.account_status !== "active" || !ownership) {
        return adminJson({ ok: false, error: "Both customer accounts must be active and the sender must still own the asset record." }, 409);
      }
      await db.batch([
        db.prepare(`UPDATE customer_asset_ownerships SET active_key = NULL, status = 'transferred_out',
          ended_at = ?, updated_at = ? WHERE id = ? AND status = 'active'`).bind(now, now, ownership.id),
        db.prepare(`INSERT INTO customer_asset_ownerships
          (id, handover_pack_id, customer_uid, active_key, status, source_type, transfer_id,
           started_at, ended_at, created_at, updated_at)
          VALUES (?, ?, ?, ?, 'active', 'transfer', ?, ?, '', ?, ?)`)
          .bind(crypto.randomUUID(), transfer.handover_pack_id, transfer.to_customer_uid,
            transfer.handover_pack_id, id, now, now, now),
        db.prepare(`UPDATE customer_asset_transfer_requests SET status = 'approved', review_note = ?,
          reviewed_by_uid = ?, reviewed_at = ?, updated_at = ? WHERE id = ? AND status = 'awaiting_admin'`)
          .bind(reviewNote, admin.uid, now, now, id),
        transferEventStatement(db, id, "transfer_approved", "admin", admin.uid,
          "Administrator approved the dual-consent asset ownership transfer.", now),
        db.prepare(`UPDATE admin_notifications SET status = 'resolved', read_at = CASE WHEN read_at = '' THEN ? ELSE read_at END,
          read_by_uid = CASE WHEN read_by_uid = '' THEN ? ELSE read_by_uid END, resolved_at = ?, resolved_by_uid = ?,
          resolution_note = 'Dual-consent asset ownership transfer approved.', updated_at = ?
          WHERE entity_type = 'customer_asset_transfer' AND entity_id = ? AND status != 'resolved'`)
          .bind(now, admin.uid, now, admin.uid, now, id),
      ]);
      await writeAdminAudit(admin, "customer_asset_transfer.approve", "customer_asset_transfer", id,
        "Approved a dual-consent private asset ownership transfer.", { handoverPackId: transfer.handover_pack_id });
    } else {
      await db.batch([
        db.prepare(`UPDATE customer_asset_transfer_requests SET status = 'rejected', review_note = ?,
          reviewed_by_uid = ?, reviewed_at = ?, updated_at = ? WHERE id = ? AND status = 'awaiting_admin'`)
          .bind(reviewNote, admin.uid, now, now, id),
        transferEventStatement(db, id, "transfer_rejected", "admin", admin.uid,
          "Administrator rejected the asset ownership transfer. Existing ownership remains unchanged.", now),
        db.prepare(`UPDATE admin_notifications SET status = 'resolved', read_at = CASE WHEN read_at = '' THEN ? ELSE read_at END,
          read_by_uid = CASE WHEN read_by_uid = '' THEN ? ELSE read_by_uid END, resolved_at = ?, resolved_by_uid = ?,
          resolution_note = 'Asset ownership transfer rejected.', updated_at = ?
          WHERE entity_type = 'customer_asset_transfer' AND entity_id = ? AND status != 'resolved'`)
          .bind(now, admin.uid, now, admin.uid, now, id),
      ]);
      await writeAdminAudit(admin, "customer_asset_transfer.reject", "customer_asset_transfer", id,
        "Rejected a private asset ownership transfer. Existing ownership was retained.", { reviewNote: true });
    }
    return adminJson({ ok: true, transfers: await transferPayload() });
  } catch (error) {
    if (error instanceof SyntaxError) return adminJson({ ok: false, error: "Invalid asset transfer review request." }, 400);
    return adminError(error);
  }
}
