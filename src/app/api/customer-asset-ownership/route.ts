import { getD1 } from "../../../../db";
import { requireFirebaseIdentity } from "@/lib/firebase-server";
import { adminJson, cleanAdminText, sameOrigin } from "@/lib/admin-server";
import { adminNotificationStatement } from "@/lib/admin-notifications";
import { dispatchAdminNotificationDeliveries } from "@/lib/admin-notification-delivery";
import {
  canCustomerAccessHandover,
  expireAssetTransfers,
  materializeOriginalOwnership,
  transferEventStatement,
} from "@/lib/customer-asset-ownership-server";
import { correctionFieldLabel } from "@/lib/handover-corrections.mjs";

export const runtime = "edge";

type CustomerIdentity = { uid: string };
const ACTIVE_TRANSFER_STATUSES = new Set(["awaiting_recipient", "awaiting_admin"]);

async function customerIdentity(request: Request): Promise<CustomerIdentity> {
  const identity = await requireFirebaseIdentity(request);
  if (!identity.emailVerified) throw new Error("EMAIL_UNVERIFIED");
  const account = await getD1().prepare("SELECT account_status FROM customer_accounts WHERE firebase_uid = ?")
    .bind(identity.uid).first<Record<string, unknown>>();
  if (!account) throw new Error("PROFILE_REQUIRED");
  if (account.account_status !== "active") throw new Error("ACCOUNT_INACTIVE");
  return { uid: identity.uid };
}

function errorResponse(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  if (code === "AUTH_REQUIRED") return adminJson({ ok: false, error: "Sign in to continue." }, 401);
  if (code === "PROFILE_REQUIRED") return adminJson({ ok: false, error: "Complete your private household profile first." }, 404);
  if (code === "ACCOUNT_INACTIVE") return adminJson({ ok: false, error: "This customer account is not active." }, 403);
  if (code === "EMAIL_UNVERIFIED") return adminJson({ ok: false, error: "Verify your account email before transferring a protected asset record." }, 403);
  if (code === "PACK_NOT_FOUND") return adminJson({ ok: false, error: "This asset record is not available in your account." }, 404);
  if (code === "TRANSFER_EXISTS") return adminJson({ ok: false, error: "A transfer is already active for this asset record." }, 409);
  if (code === "INVALID_CODE") return adminJson({ ok: false, error: "This transfer code is invalid, expired or no longer available." }, 404);
  if (code === "SELF_TRANSFER") return adminJson({ ok: false, error: "An asset record cannot be transferred back into the same customer account." }, 409);
  return adminJson({ ok: false, error: "The private asset ownership request could not be completed." }, 500);
}

function normalizeClaimCode(value: unknown) {
  return cleanAdminText(value, 40).toUpperCase().replace(/[^A-Z2-7]/g, "").replace(/^AEA/, "");
}

function createClaimCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ234567";
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const characters = Array.from(bytes, (value) => alphabet[value % alphabet.length]).join("");
  return `AEA-${characters.slice(0, 4)}-${characters.slice(4, 8)}-${characters.slice(8, 12)}-${characters.slice(12, 16)}`;
}

async function claimCodeHash(code: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(normalizeClaimCode(code)));
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
}

async function ownershipPayload(customerUid: string) {
  const db = getD1();
  const now = new Date().toISOString();
  await expireAssetTransfers(now);
  const [packRows, transferRows] = await Promise.all([
    db.prepare(`SELECT DISTINCT p.id, p.service_category, p.published_at, p.updated_at, w.work_number,
      COALESCE(o.source_type, 'original') source_type, COALESCE(o.started_at, p.published_at) ownership_started_at
      FROM trade_handover_packs p JOIN trade_work_orders w ON w.id = p.work_order_id
      LEFT JOIN customer_asset_ownerships o ON o.handover_pack_id = p.id
        AND o.customer_uid = ? AND o.status = 'active'
      WHERE p.status = 'published' AND (
        o.id IS NOT NULL OR (
          NOT EXISTS (SELECT 1 FROM customer_asset_ownerships history WHERE history.handover_pack_id = p.id)
          AND EXISTS (SELECT 1 FROM customer_projects c WHERE c.id = p.customer_project_id AND c.firebase_uid = ?)
        )
      ) ORDER BY ownership_started_at DESC`).bind(customerUid, customerUid).all<Record<string, unknown>>(),
    db.prepare(`SELECT id, handover_pack_id, from_customer_uid, to_customer_uid, status,
      sender_consent_at, recipient_consent_at, expires_at, review_note, reviewed_at, created_at, updated_at
      FROM customer_asset_transfer_requests
      WHERE from_customer_uid = ? OR to_customer_uid = ? ORDER BY created_at DESC LIMIT 100`)
      .bind(customerUid, customerUid).all<Record<string, unknown>>(),
  ]);
  const packIds = packRows.results.map((row: Record<string, unknown>) => String(row.id));
  const transferIds = transferRows.results.map((row: Record<string, unknown>) => String(row.id));
  const slots = packIds.map(() => "?").join(",");
  const transferSlots = transferIds.map(() => "?").join(",");
  const [assetRows, documentRows, correctionRows, eventRows] = await Promise.all([
    packIds.length ? db.prepare(`SELECT id, handover_pack_id, asset_category, brand, model_number,
      serial_number, quantity, installed_at, warranty_provider, warranty_reference, warranty_start, warranty_end
      FROM trade_installed_assets WHERE handover_pack_id IN (${slots}) AND record_status = 'active'
      ORDER BY created_at`).bind(...packIds).all<Record<string, unknown>>() : { results: [] as Record<string, unknown>[] },
    packIds.length ? db.prepare(`SELECT id, handover_pack_id, category, file_name, content_type, size_bytes, created_at
      FROM trade_handover_documents WHERE handover_pack_id IN (${slots}) AND customer_visible = 1
      ORDER BY created_at DESC`).bind(...packIds).all<Record<string, unknown>>() : { results: [] as Record<string, unknown>[] },
    packIds.length ? db.prepare(`SELECT id, handover_pack_id, asset_id, version_number, field_key, previous_value,
      proposed_value, reason, published_at FROM trade_handover_corrections
      WHERE handover_pack_id IN (${slots}) AND status = 'published'
      ORDER BY version_number DESC`).bind(...packIds).all<Record<string, unknown>>() : { results: [] as Record<string, unknown>[] },
    transferIds.length ? db.prepare(`SELECT id, transfer_id, event_type, actor_type, summary, created_at
      FROM customer_asset_transfer_events WHERE transfer_id IN (${transferSlots}) ORDER BY created_at DESC`)
      .bind(...transferIds).all<Record<string, unknown>>() : { results: [] as Record<string, unknown>[] },
  ]);
  const transfers = transferRows.results.map((row: Record<string, unknown>) => ({
    id: String(row.id), handoverPackId: String(row.handover_pack_id),
    direction: row.from_customer_uid === customerUid ? "outgoing" : "incoming",
    status: String(row.status), senderConsentAt: String(row.sender_consent_at),
    recipientConsentAt: String(row.recipient_consent_at || ""), expiresAt: String(row.expires_at),
    reviewNote: String(row.review_note || ""), reviewedAt: String(row.reviewed_at || ""),
    createdAt: String(row.created_at), updatedAt: String(row.updated_at),
    canCancel: ACTIVE_TRANSFER_STATUSES.has(String(row.status)),
    events: eventRows.results.filter((event: Record<string, unknown>) => event.transfer_id === row.id).map((event: Record<string, unknown>) => ({
      id: String(event.id), eventType: String(event.event_type), actorType: String(event.actor_type),
      summary: String(event.summary), createdAt: String(event.created_at),
    })),
  }));
  return {
    packs: packRows.results.map((row: Record<string, unknown>) => ({
      id: String(row.id), serviceCategory: String(row.service_category), workNumber: String(row.work_number),
      publishedAt: String(row.published_at), ownershipStartedAt: String(row.ownership_started_at), sourceType: String(row.source_type),
      assets: assetRows.results.filter((item: Record<string, unknown>) => item.handover_pack_id === row.id).map((item: Record<string, unknown>) => ({
        id: String(item.id), assetCategory: String(item.asset_category), brand: String(item.brand), modelNumber: String(item.model_number),
        serialNumber: String(item.serial_number || ""), quantity: Number(item.quantity || 1), installedAt: String(item.installed_at || ""),
        warrantyProvider: String(item.warranty_provider || ""), warrantyReference: String(item.warranty_reference || ""),
        warrantyStart: String(item.warranty_start || ""), warrantyEnd: String(item.warranty_end || ""),
      })),
      documents: documentRows.results.filter((item: Record<string, unknown>) => item.handover_pack_id === row.id).map((item: Record<string, unknown>) => ({
        id: String(item.id), category: String(item.category), fileName: String(item.file_name),
        contentType: String(item.content_type), sizeBytes: Number(item.size_bytes || 0), createdAt: String(item.created_at),
      })),
      corrections: correctionRows.results.filter((item: Record<string, unknown>) => item.handover_pack_id === row.id).map((item: Record<string, unknown>) => ({
        id: String(item.id), assetId: String(item.asset_id), versionNumber: Number(item.version_number),
        fieldKey: String(item.field_key), fieldLabel: correctionFieldLabel(item.field_key), previousValue: String(item.previous_value || ""),
        proposedValue: String(item.proposed_value || ""), reason: String(item.reason), publishedAt: String(item.published_at),
      })),
      activeTransfer: transfers.find((transfer: { handoverPackId: string; status: string }) => transfer.handoverPackId === row.id && ACTIVE_TRANSFER_STATUSES.has(transfer.status)) || null,
    })),
    transfers,
  };
}

export async function GET(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const identity = await customerIdentity(request);
    return adminJson({ ok: true, ...(await ownershipPayload(identity.uid)) });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const identity = await customerIdentity(request);
    const body = await request.json() as Record<string, unknown>;
    const action = cleanAdminText(body.action, 40);
    const db = getD1();
    const now = new Date().toISOString();
    await expireAssetTransfers(now);

    if (action === "create_transfer") {
      const handoverPackId = cleanAdminText(body.handoverPackId, 180);
      if (body.consent !== true) return adminJson({ ok: false, error: "Confirm that you intend to transfer this asset record." }, 400);
      if (!await canCustomerAccessHandover(identity.uid, handoverPackId)) throw new Error("PACK_NOT_FOUND");
      const active = await db.prepare(`SELECT id FROM customer_asset_transfer_requests
        WHERE handover_pack_id = ? AND status IN ('awaiting_recipient', 'awaiting_admin')`)
        .bind(handoverPackId).first();
      if (active) throw new Error("TRANSFER_EXISTS");
      if (!await materializeOriginalOwnership(identity.uid, handoverPackId, now)) throw new Error("PACK_NOT_FOUND");
      const transferId = crypto.randomUUID();
      const claimCode = createClaimCode();
      const codeHash = await claimCodeHash(claimCode);
      const expiresAt = new Date(Date.now() + 7 * 86400000).toISOString();
      await db.batch([
        db.prepare(`INSERT INTO customer_asset_transfer_requests
          (id, handover_pack_id, from_customer_uid, to_customer_uid, claim_code_hash, status,
           sender_consent_at, recipient_consent_at, expires_at, review_note, reviewed_by_uid,
           reviewed_at, created_at, updated_at)
          VALUES (?, ?, ?, '', ?, 'awaiting_recipient', ?, '', ?, '', '', '', ?, ?)`)
          .bind(transferId, handoverPackId, identity.uid, codeHash, now, expiresAt, now, now),
        transferEventStatement(db, transferId, "transfer_created", "customer", identity.uid,
          "Current owner created a private transfer invitation.", now),
        adminNotificationStatement(db, {
          eventKey: `customer-asset-transfer-started:${transferId}`,
          eventType: "customer.asset_transfer_started",
          category: "customer",
          priority: "low",
          title: "Private asset transfer started",
          summary: "A customer created an expiring asset transfer invitation. No action is required until another customer accepts it.",
          entityType: "customer_asset_transfer",
          entityId: transferId,
          actorType: "customer",
          actorUid: identity.uid,
          requiresAction: false,
          metadata: { handoverPackId, status: "awaiting_recipient" },
          occurredAt: now,
        }),
      ]);
      await dispatchAdminNotificationDeliveries();
      return adminJson({ ok: true, claimCode, ...(await ownershipPayload(identity.uid)) }, 201);
    }

    if (action !== "claim_transfer") return adminJson({ ok: false, error: "Choose a supported asset transfer action." }, 400);
    if (body.consent !== true) return adminJson({ ok: false, error: "Confirm that you accept responsibility for this asset record." }, 400);
    const normalized = normalizeClaimCode(body.claimCode);
    if (normalized.length !== 16) throw new Error("INVALID_CODE");
    const codeHash = await claimCodeHash(normalized);
    const transfer = await db.prepare(`SELECT id, handover_pack_id, from_customer_uid, status, expires_at
      FROM customer_asset_transfer_requests WHERE claim_code_hash = ?`).bind(codeHash).first<Record<string, unknown>>();
    if (!transfer || transfer.status !== "awaiting_recipient" || String(transfer.expires_at) < now) throw new Error("INVALID_CODE");
    if (transfer.from_customer_uid === identity.uid) throw new Error("SELF_TRANSFER");
    if (!await canCustomerAccessHandover(String(transfer.from_customer_uid), String(transfer.handover_pack_id))) throw new Error("INVALID_CODE");
    await db.batch([
      db.prepare(`UPDATE customer_asset_transfer_requests SET to_customer_uid = ?, status = 'awaiting_admin',
        recipient_consent_at = ?, updated_at = ? WHERE id = ? AND status = 'awaiting_recipient'`)
        .bind(identity.uid, now, now, transfer.id),
      transferEventStatement(db, String(transfer.id), "recipient_consented", "customer", identity.uid,
        "Receiving customer accepted the private asset transfer for administrator review.", now),
      adminNotificationStatement(db, {
        eventKey: `customer-asset-transfer-ready:${transfer.id}`,
        eventType: "customer.asset_transfer_ready",
        category: "approval",
        priority: "high",
        title: "Asset transfer ready for review",
        summary: "Both customer accounts consented to an asset ownership transfer. Review the asset record before changing access.",
        entityType: "customer_asset_transfer",
        entityId: String(transfer.id),
        actorType: "customer",
        actorUid: identity.uid,
        requiresAction: true,
        metadata: { handoverPackId: transfer.handover_pack_id, status: "awaiting_admin" },
        occurredAt: now,
      }),
    ]);
    await dispatchAdminNotificationDeliveries();
    return adminJson({ ok: true, ...(await ownershipPayload(identity.uid)) });
  } catch (error) {
    if (error instanceof SyntaxError) return adminJson({ ok: false, error: "Invalid private asset transfer request." }, 400);
    return errorResponse(error);
  }
}

export async function PATCH(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const identity = await customerIdentity(request);
    const body = await request.json() as Record<string, unknown>;
    const transferId = cleanAdminText(body.transferId, 180);
    const db = getD1();
    const transfer = await db.prepare(`SELECT id, from_customer_uid, to_customer_uid, status
      FROM customer_asset_transfer_requests WHERE id = ?`).bind(transferId).first<Record<string, unknown>>();
    if (!transfer || !ACTIVE_TRANSFER_STATUSES.has(String(transfer.status)) ||
      (transfer.from_customer_uid !== identity.uid && transfer.to_customer_uid !== identity.uid)) {
      return adminJson({ ok: false, error: "This transfer can no longer be cancelled from your account." }, 409);
    }
    const now = new Date().toISOString();
    await db.batch([
      db.prepare(`UPDATE customer_asset_transfer_requests SET status = 'cancelled', updated_at = ?
        WHERE id = ? AND status IN ('awaiting_recipient', 'awaiting_admin')`).bind(now, transferId),
      transferEventStatement(db, transferId, "transfer_cancelled", "customer", identity.uid,
        "A customer withdrew consent before the ownership transfer was completed.", now),
      db.prepare(`UPDATE admin_notifications SET status = 'resolved', resolved_at = ?, resolved_by_uid = ?,
        resolution_note = 'Customer withdrew transfer consent.', updated_at = ?
        WHERE entity_type = 'customer_asset_transfer' AND entity_id = ? AND status != 'resolved'`)
        .bind(now, identity.uid, now, transferId),
    ]);
    return adminJson({ ok: true, ...(await ownershipPayload(identity.uid)) });
  } catch (error) {
    if (error instanceof SyntaxError) return adminJson({ ok: false, error: "Invalid asset transfer update." }, 400);
    return errorResponse(error);
  }
}
