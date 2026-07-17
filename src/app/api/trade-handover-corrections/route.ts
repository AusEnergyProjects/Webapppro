import { getD1 } from "../../../../db";
import { requireFirebaseIdentity } from "@/lib/firebase-server";
import { accountEntitlements } from "@/lib/direct-trade-entitlements-server";
import { adminJson, cleanAdminText, sameOrigin } from "@/lib/admin-server";
import { adminNotificationStatement } from "@/lib/admin-notifications";
import { dispatchAdminNotificationDeliveries } from "@/lib/admin-notification-delivery";
import { HANDOVER_CORRECTION_DATE_FIELDS, HANDOVER_CORRECTION_FIELDS, correctionFieldLabel } from "@/lib/handover-corrections.mjs";
import { isIsoDate } from "@/lib/trade-handover.mjs";

export const runtime = "edge";

const FIELD_KEYS = new Set(HANDOVER_CORRECTION_FIELDS.map((item: string[]) => item[0]));
const REQUIRED_FIELDS = new Set(["brand", "model_number", "quantity"]);
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const PHONE_PATTERN = /(?:\+?61|0)[2-478](?:[\s-]?\d){8}\b/;

type TradeIdentity = { uid: string };

async function tradeIdentity(request: Request): Promise<TradeIdentity> {
  const identity = await requireFirebaseIdentity(request);
  const account = await getD1().prepare(`SELECT partner_type, account_status, billing_status
    FROM trade_accounts WHERE firebase_uid = ?`).bind(identity.uid).first<Record<string, unknown>>();
  if (!account) throw new Error("PROFILE_REQUIRED");
  if (account.account_status !== "active") throw new Error("ACCOUNT_INACTIVE");
  if (account.partner_type !== "installer") throw new Error("INSTALLER_REQUIRED");
  const entitlements = await accountEntitlements(identity.uid, "installer", account.billing_status);
  if (!entitlements.features.business_operations) throw new Error("FULL_ACCESS_REQUIRED");
  return { uid: identity.uid };
}

function errorResponse(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  if (code === "AUTH_REQUIRED") return adminJson({ ok: false, error: "Sign in to continue." }, 401);
  if (code === "PROFILE_REQUIRED") return adminJson({ ok: false, error: "Complete the installer profile first." }, 404);
  if (code === "ACCOUNT_INACTIVE") return adminJson({ ok: false, error: "This installer account is not active." }, 403);
  if (code === "INSTALLER_REQUIRED") return adminJson({ ok: false, error: "Handover corrections are available to installer accounts." }, 403);
  if (code === "FULL_ACCESS_REQUIRED") return adminJson({ ok: false, error: "Complete trade verification before using versioned handover corrections." }, 403);
  if (code === "PACK_NOT_FOUND") return adminJson({ ok: false, error: "A published handover record was not found for this work order." }, 404);
  if (code === "ASSET_NOT_FOUND") return adminJson({ ok: false, error: "Installed asset not found." }, 404);
  if (code === "PRIVATE_DATA") return adminJson({ ok: false, error: "Keep customer contact details and addresses out of correction records." }, 400);
  return adminJson({ ok: false, error: "The versioned handover correction could not be completed." }, 500);
}

async function publishedPack(firebaseUid: string, workOrderId: string) {
  return getD1().prepare(`SELECT p.id, p.work_order_id, p.firebase_uid, w.work_number
    FROM trade_handover_packs p JOIN trade_work_orders w ON w.id = p.work_order_id
    WHERE p.work_order_id = ? AND p.firebase_uid = ? AND p.status = 'published' AND w.record_status = 'active'`)
    .bind(workOrderId, firebaseUid).first<Record<string, unknown>>();
}

async function correctionPayload(firebaseUid: string, workOrderId: string) {
  const rows = await getD1().prepare(`SELECT c.id, c.handover_pack_id, c.asset_id, c.version_number, c.field_key,
    c.previous_value, c.proposed_value, c.reason, c.status, c.submitted_at, c.published_at,
    c.review_note, c.reviewed_at, a.brand, a.model_number
    FROM trade_handover_corrections c JOIN trade_installed_assets a ON a.id = c.asset_id
    WHERE c.work_order_id = ? AND c.firebase_uid = ? ORDER BY c.version_number DESC`)
    .bind(workOrderId, firebaseUid).all<Record<string, unknown>>();
  return rows.results.map((row: Record<string, unknown>) => ({
    id: String(row.id), handoverPackId: String(row.handover_pack_id), assetId: String(row.asset_id),
    versionNumber: Number(row.version_number), fieldKey: String(row.field_key), fieldLabel: correctionFieldLabel(row.field_key),
    previousValue: String(row.previous_value || ""), proposedValue: String(row.proposed_value || ""),
    reason: String(row.reason), status: String(row.status), submittedAt: String(row.submitted_at),
    publishedAt: String(row.published_at || ""), reviewNote: String(row.review_note || ""),
    reviewedAt: String(row.reviewed_at || ""), assetLabel: `${String(row.brand)} ${String(row.model_number)}`,
  }));
}

function proposedValue(fieldKey: string, value: unknown) {
  const clean = cleanAdminText(value, fieldKey === "quantity" ? 8 : 180);
  if (REQUIRED_FIELDS.has(fieldKey) && !clean) throw new Error("INVALID_VALUE");
  if (fieldKey === "quantity") {
    const quantity = Number(clean);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 9999) throw new Error("INVALID_VALUE");
    return String(quantity);
  }
  if (HANDOVER_CORRECTION_DATE_FIELDS.has(fieldKey) && !isIsoDate(clean)) throw new Error("INVALID_VALUE");
  if (EMAIL_PATTERN.test(clean)) throw new Error("PRIVATE_DATA");
  return clean;
}

export async function GET(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const identity = await tradeIdentity(request);
    const workOrderId = cleanAdminText(new URL(request.url).searchParams.get("workOrderId"), 180);
    const pack = await publishedPack(identity.uid, workOrderId);
    if (!pack) throw new Error("PACK_NOT_FOUND");
    return adminJson({ ok: true, corrections: await correctionPayload(identity.uid, workOrderId) });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const identity = await tradeIdentity(request);
    const body = await request.json() as Record<string, unknown>;
    const workOrderId = cleanAdminText(body.workOrderId, 180);
    const pack = await publishedPack(identity.uid, workOrderId);
    if (!pack) throw new Error("PACK_NOT_FOUND");
    const assetId = cleanAdminText(body.assetId, 180);
    const fieldKey = cleanAdminText(body.fieldKey, 50);
    if (!FIELD_KEYS.has(fieldKey)) return adminJson({ ok: false, error: "Choose a supported installed asset field." }, 400);
    const reason = cleanAdminText(body.reason, 600);
    if (reason.length < 10) return adminJson({ ok: false, error: "Explain why the approved handover record needs this correction." }, 400);
    if (EMAIL_PATTERN.test(reason) || PHONE_PATTERN.test(reason)) throw new Error("PRIVATE_DATA");
    const asset = await getD1().prepare(`SELECT id, brand, model_number, serial_number, quantity, installed_at,
      warranty_provider, warranty_reference, warranty_start, warranty_end
      FROM trade_installed_assets WHERE id = ? AND handover_pack_id = ? AND firebase_uid = ? AND record_status = 'active'`)
      .bind(assetId, pack.id, identity.uid).first<Record<string, unknown>>();
    if (!asset) throw new Error("ASSET_NOT_FOUND");
    const nextValue = proposedValue(fieldKey, body.proposedValue);
    const currentValue = String(asset[fieldKey] ?? "");
    if (nextValue === currentValue) return adminJson({ ok: false, error: "The proposed value is already in the approved record." }, 409);
    const pending = await getD1().prepare(`SELECT COUNT(*) count FROM trade_handover_corrections
      WHERE handover_pack_id = ? AND status = 'submitted'`).bind(pack.id).first<{ count: number }>();
    if (Number(pending?.count || 0) >= 20) return adminJson({ ok: false, error: "Resolve the existing correction queue before submitting another change." }, 409);
    const latest = await getD1().prepare(`SELECT COALESCE(MAX(version_number), 0) version_number
      FROM trade_handover_corrections WHERE handover_pack_id = ?`).bind(pack.id).first<{ version_number: number }>();
    const versionNumber = Number(latest?.version_number || 0) + 1;
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const db = getD1();
    await db.batch([
      db.prepare(`INSERT INTO trade_handover_corrections
        (id, handover_pack_id, work_order_id, firebase_uid, asset_id, version_number, field_key,
         previous_value, proposed_value, reason, status, submitted_at, published_at, review_note,
         reviewed_by_uid, reviewed_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'submitted', ?, '', '', '', '', ?, ?)`)
        .bind(id, pack.id, workOrderId, identity.uid, assetId, versionNumber, fieldKey,
          currentValue, nextValue, reason, now, now, now),
      db.prepare(`INSERT INTO trade_work_order_events
        (id, work_order_id, firebase_uid, event_type, summary, created_at)
        VALUES (?, ?, ?, 'handover_correction_submitted', ?, ?)`)
        .bind(crypto.randomUUID(), workOrderId, identity.uid,
          `Version ${versionNumber} correction submitted for ${correctionFieldLabel(fieldKey)}.`, now),
      adminNotificationStatement(db, {
        eventKey: `handover-correction-submitted:${id}`,
        eventType: "trade.handover_correction_submitted",
        category: "approval",
        priority: "high",
        title: "Handover correction requires review",
        summary: `A published asset record has a version ${versionNumber} correction awaiting approval. The previous approved value remains active.`,
        entityType: "trade_handover_correction",
        entityId: id,
        actorType: "installer",
        actorUid: identity.uid,
        requiresAction: true,
        metadata: { handoverPackId: pack.id, workOrderId, versionNumber, fieldKey },
        occurredAt: now,
      }),
    ]);
    await dispatchAdminNotificationDeliveries();
    return adminJson({ ok: true, corrections: await correctionPayload(identity.uid, workOrderId) }, 201);
  } catch (error) {
    if (error instanceof SyntaxError) return adminJson({ ok: false, error: "Invalid handover correction request." }, 400);
    if (error instanceof Error && error.message === "INVALID_VALUE") return adminJson({ ok: false, error: "Choose a valid proposed value for this field." }, 400);
    return errorResponse(error);
  }
}
