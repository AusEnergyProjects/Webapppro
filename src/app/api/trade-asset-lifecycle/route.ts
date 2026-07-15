import { getD1 } from "../../../../db";
import { requireFirebaseIdentity } from "@/lib/firebase-server";
import { accountEntitlements } from "@/lib/direct-trade-entitlements-server";
import { adminJson, cleanAdminText, sameOrigin } from "@/lib/admin-server";
import { ASSET_SERVICE_TYPES, addMonthsToIsoDate, lifecycleStatus, safetyNoticeMatchesAsset } from "@/lib/asset-lifecycle.mjs";
import { isIsoDate } from "@/lib/trade-handover.mjs";

export const runtime = "edge";

const SERVICE_TYPES = new Set(ASSET_SERVICE_TYPES.map((item: string[]) => item[0]));
const SERVICE_STATUSES = new Set(["active", "paused"]);
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;

type TradeIdentity = { uid: string; fullAccess: boolean };
type OwnedWork = { id: string; firebase_uid: string };
type OwnedAsset = {
  id: string;
  handover_pack_id: string;
  work_order_id: string;
  asset_category: string;
  brand: string;
  model_number: string;
  warranty_end: string;
};
type LifecycleAsset = {
  id: string;
  handoverPackId: string;
  assetCategory: string;
  brand: string;
  modelNumber: string;
  serialNumber: string;
  installedAt: string;
  warrantyEnd: string;
};

function lifecycleError(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  if (code === "AUTH_REQUIRED") return adminJson({ ok: false, error: "Sign in to continue." }, 401);
  if (code === "PROFILE_REQUIRED") return adminJson({ ok: false, error: "Complete the installer profile first." }, 404);
  if (code === "ACCOUNT_INACTIVE") return adminJson({ ok: false, error: "This installer account is not active." }, 403);
  if (code === "INSTALLER_REQUIRED") return adminJson({ ok: false, error: "Asset lifecycle tools are available to installer accounts." }, 403);
  if (code === "FULL_ACCESS_REQUIRED") return adminJson({ ok: false, error: "Asset service schedules require paid Business Hub access or an administrator grant." }, 403);
  if (code === "WORK_NOT_FOUND") return adminJson({ ok: false, error: "Work record not found." }, 404);
  if (code === "ASSET_NOT_FOUND") return adminJson({ ok: false, error: "Installed asset not found." }, 404);
  if (code === "PLAN_NOT_FOUND") return adminJson({ ok: false, error: "Service schedule not found." }, 404);
  if (code === "PRIVATE_DATA") return adminJson({ ok: false, error: "Keep customer names, contact details and addresses out of service records." }, 400);
  return adminJson({ ok: false, error: "The asset lifecycle request could not be completed." }, 500);
}

async function tradeIdentity(request: Request): Promise<TradeIdentity> {
  const identity = await requireFirebaseIdentity(request);
  const account = await getD1().prepare(`SELECT partner_type, account_status, billing_status
    FROM trade_accounts WHERE firebase_uid = ?`).bind(identity.uid).first<Record<string, unknown>>();
  if (!account) throw new Error("PROFILE_REQUIRED");
  if (account.account_status !== "active") throw new Error("ACCOUNT_INACTIVE");
  if (account.partner_type !== "installer") throw new Error("INSTALLER_REQUIRED");
  const entitlements = await accountEntitlements(identity.uid, "installer", account.billing_status);
  return { uid: identity.uid, fullAccess: entitlements.features.business_operations };
}

async function ownedWork(firebaseUid: string, workOrderId: string) {
  return getD1().prepare(`SELECT id, firebase_uid FROM trade_work_orders
    WHERE id = ? AND firebase_uid = ? AND record_status = 'active'`)
    .bind(workOrderId, firebaseUid).first<OwnedWork>();
}

async function ownedAsset(firebaseUid: string, workOrderId: string, assetId: string) {
  return getD1().prepare(`SELECT id, handover_pack_id, work_order_id, asset_category, brand, model_number, warranty_end
    FROM trade_installed_assets WHERE id = ? AND work_order_id = ? AND firebase_uid = ? AND record_status = 'active'`)
    .bind(assetId, workOrderId, firebaseUid).first<OwnedAsset>();
}

function dateValue(value: unknown, required = false) {
  const clean = cleanAdminText(value, 10);
  if ((required && !clean) || !isIsoDate(clean)) throw new Error("INVALID_DATE");
  return clean;
}

function containsPrivateData(value: string) {
  return EMAIL_PATTERN.test(value) || /(?:\+?61|0)[2-478](?:[\s-]?\d){8}\b/.test(value);
}

function workEvent(db: ReturnType<typeof getD1>, uid: string, workOrderId: string, type: string, summary: string, now: string) {
  return db.prepare(`INSERT INTO trade_work_order_events
    (id, work_order_id, firebase_uid, event_type, summary, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .bind(crypto.randomUUID(), workOrderId, uid, type, summary, now);
}

async function lifecyclePayload(identity: TradeIdentity, workOrderId: string) {
  const db = getD1();
  const [assetsResult, plansResult, eventsResult, noticesResult] = await Promise.all([
    db.prepare(`SELECT id, handover_pack_id, asset_category, brand, model_number, serial_number, installed_at, warranty_end
      FROM trade_installed_assets WHERE work_order_id = ? AND firebase_uid = ? AND record_status = 'active'
      ORDER BY created_at`).bind(workOrderId, identity.uid).all<Record<string, unknown>>(),
    db.prepare(`SELECT id, asset_id, service_type, cadence_months, next_due_at, status, created_at, updated_at
      FROM trade_asset_service_plans WHERE work_order_id = ? AND firebase_uid = ?
      ORDER BY status = 'active' DESC, next_due_at`).bind(workOrderId, identity.uid).all<Record<string, unknown>>(),
    db.prepare(`SELECT id, service_plan_id, asset_id, event_type, serviced_at, summary, provider_reference, next_due_at, created_at
      FROM trade_asset_service_events WHERE work_order_id = ? AND firebase_uid = ?
      ORDER BY serviced_at DESC, created_at DESC LIMIT 200`).bind(workOrderId, identity.uid).all<Record<string, unknown>>(),
    db.prepare(`SELECT id, title, summary, severity, asset_category, brand, model_number, source_url,
      source_label, effective_at, expires_at, published_at FROM asset_safety_notices
      WHERE status = 'published' AND (expires_at = '' OR expires_at >= ?)
      ORDER BY CASE severity WHEN 'urgent' THEN 1 WHEN 'important' THEN 2 ELSE 3 END, published_at DESC`)
      .bind(new Date().toISOString().slice(0, 10)).all<Record<string, unknown>>(),
  ]);
  const assets: LifecycleAsset[] = assetsResult.results.map((row: Record<string, unknown>): LifecycleAsset => ({
    id: String(row.id),
    handoverPackId: String(row.handover_pack_id),
    assetCategory: String(row.asset_category),
    brand: String(row.brand),
    modelNumber: String(row.model_number),
    serialNumber: String(row.serial_number || ""),
    installedAt: String(row.installed_at || ""),
    warrantyEnd: String(row.warranty_end || ""),
  }));
  const plans = plansResult.results.map((row: Record<string, unknown>) => ({
    id: String(row.id), assetId: String(row.asset_id), serviceType: String(row.service_type),
    cadenceMonths: Number(row.cadence_months), nextDueAt: String(row.next_due_at), status: String(row.status),
    lifecycleStatus: row.status === "active" ? lifecycleStatus(row.next_due_at) : "paused",
    createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  }));
  const events = eventsResult.results.map((row: Record<string, unknown>) => ({
    id: String(row.id), servicePlanId: String(row.service_plan_id), assetId: String(row.asset_id),
    eventType: String(row.event_type), servicedAt: String(row.serviced_at), summary: String(row.summary || ""),
    providerReference: String(row.provider_reference || ""), nextDueAt: String(row.next_due_at || ""), createdAt: String(row.created_at),
  }));
  const notices = noticesResult.results.map((row: Record<string, unknown>) => ({
    id: String(row.id), title: String(row.title), summary: String(row.summary), severity: String(row.severity),
    assetCategory: String(row.asset_category || ""), brand: String(row.brand || ""), modelNumber: String(row.model_number || ""),
    sourceUrl: String(row.source_url), sourceLabel: String(row.source_label), effectiveAt: String(row.effective_at || ""),
    expiresAt: String(row.expires_at || ""), publishedAt: String(row.published_at),
    affectedAssetIds: assets.filter((asset) => safetyNoticeMatchesAsset(row, asset)).map((asset) => asset.id),
  })).filter((notice: { affectedAssetIds: string[] }) => notice.affectedAssetIds.length > 0);
  return { assets, plans, events, notices, access: { fullAccess: identity.fullAccess } };
}

export async function GET(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const identity = await tradeIdentity(request);
    if (!identity.fullAccess) throw new Error("FULL_ACCESS_REQUIRED");
    const workOrderId = cleanAdminText(new URL(request.url).searchParams.get("workOrderId"), 180);
    if (!await ownedWork(identity.uid, workOrderId)) throw new Error("WORK_NOT_FOUND");
    return adminJson({ ok: true, ...(await lifecyclePayload(identity, workOrderId)) });
  } catch (error) { return lifecycleError(error); }
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const identity = await tradeIdentity(request);
    if (!identity.fullAccess) throw new Error("FULL_ACCESS_REQUIRED");
    const body = await request.json() as Record<string, unknown>;
    const action = cleanAdminText(body.action, 40);
    const workOrderId = cleanAdminText(body.workOrderId, 180);
    if (!await ownedWork(identity.uid, workOrderId)) throw new Error("WORK_NOT_FOUND");
    const db = getD1();
    const now = new Date().toISOString();

    if (action === "create_plan") {
      const assetId = cleanAdminText(body.assetId, 180);
      const asset = await ownedAsset(identity.uid, workOrderId, assetId);
      if (!asset) throw new Error("ASSET_NOT_FOUND");
      const serviceType = cleanAdminText(body.serviceType, 50);
      const cadenceMonths = Math.round(Number(body.cadenceMonths));
      const nextDueAt = dateValue(body.nextDueAt, true);
      if (!SERVICE_TYPES.has(serviceType) || cadenceMonths < 1 || cadenceMonths > 120) {
        return adminJson({ ok: false, error: "Choose a supported service type and a cadence from 1 to 120 months." }, 400);
      }
      await db.batch([
        db.prepare(`INSERT INTO trade_asset_service_plans
          (id, asset_id, handover_pack_id, work_order_id, firebase_uid, service_type, cadence_months, next_due_at, status, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
          ON CONFLICT(asset_id, service_type) DO UPDATE SET cadence_months = excluded.cadence_months,
            next_due_at = excluded.next_due_at, status = 'active', updated_at = excluded.updated_at`)
          .bind(crypto.randomUUID(), asset.id, asset.handover_pack_id, workOrderId, identity.uid, serviceType, cadenceMonths, nextDueAt, now, now),
        workEvent(db, identity.uid, workOrderId, "asset_service_scheduled", `Service schedule created for ${asset.brand} ${asset.model_number}.`, now),
      ]);
      return adminJson({ ok: true, ...(await lifecyclePayload(identity, workOrderId)) }, 201);
    }

    if (action !== "record_service") return adminJson({ ok: false, error: "Unsupported asset lifecycle action." }, 400);
    const planId = cleanAdminText(body.planId, 180);
    const plan = await db.prepare(`SELECT p.id, p.asset_id, p.handover_pack_id, p.cadence_months, a.brand, a.model_number
      FROM trade_asset_service_plans p JOIN trade_installed_assets a ON a.id = p.asset_id
      WHERE p.id = ? AND p.work_order_id = ? AND p.firebase_uid = ? AND a.record_status = 'active'`)
      .bind(planId, workOrderId, identity.uid).first<Record<string, unknown>>();
    if (!plan) throw new Error("PLAN_NOT_FOUND");
    const servicedAt = dateValue(body.servicedAt, true);
    const summary = cleanAdminText(body.summary, 500);
    const providerReference = cleanAdminText(body.providerReference, 120);
    if (containsPrivateData(`${summary} ${providerReference}`)) throw new Error("PRIVATE_DATA");
    const requestedNextDue = dateValue(body.nextDueAt);
    const nextDueAt = requestedNextDue || addMonthsToIsoDate(servicedAt, Number(plan.cadence_months));
    await db.batch([
      db.prepare(`INSERT INTO trade_asset_service_events
        (id, service_plan_id, asset_id, handover_pack_id, work_order_id, firebase_uid, event_type,
         serviced_at, summary, provider_reference, next_due_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 'service_completed', ?, ?, ?, ?, ?, ?)`)
        .bind(crypto.randomUUID(), plan.id, plan.asset_id, plan.handover_pack_id, workOrderId, identity.uid,
          servicedAt, summary, providerReference, nextDueAt, now, now),
      db.prepare(`UPDATE trade_asset_service_plans SET next_due_at = ?, status = 'active', updated_at = ?
        WHERE id = ? AND work_order_id = ? AND firebase_uid = ?`).bind(nextDueAt, now, plan.id, workOrderId, identity.uid),
      workEvent(db, identity.uid, workOrderId, "asset_service_recorded", `Service completed for ${plan.brand} ${plan.model_number}.`, now),
    ]);
    return adminJson({ ok: true, ...(await lifecyclePayload(identity, workOrderId)) }, 201);
  } catch (error) {
    if (error instanceof SyntaxError) return adminJson({ ok: false, error: "Invalid asset lifecycle request." }, 400);
    if (error instanceof Error && error.message === "INVALID_DATE") return adminJson({ ok: false, error: "Choose valid service and due dates." }, 400);
    return lifecycleError(error);
  }
}

export async function PATCH(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const identity = await tradeIdentity(request);
    if (!identity.fullAccess) throw new Error("FULL_ACCESS_REQUIRED");
    const body = await request.json() as Record<string, unknown>;
    const workOrderId = cleanAdminText(body.workOrderId, 180);
    if (!await ownedWork(identity.uid, workOrderId)) throw new Error("WORK_NOT_FOUND");
    const planId = cleanAdminText(body.planId, 180);
    const status = cleanAdminText(body.status, 20);
    const nextDueAt = dateValue(body.nextDueAt);
    if (!SERVICE_STATUSES.has(status)) return adminJson({ ok: false, error: "Choose an active or paused schedule state." }, 400);
    const existing = await getD1().prepare(`SELECT id FROM trade_asset_service_plans
      WHERE id = ? AND work_order_id = ? AND firebase_uid = ?`).bind(planId, workOrderId, identity.uid).first();
    if (!existing) throw new Error("PLAN_NOT_FOUND");
    await getD1().prepare(`UPDATE trade_asset_service_plans SET status = ?, next_due_at = CASE WHEN ? = '' THEN next_due_at ELSE ? END,
      updated_at = ? WHERE id = ? AND work_order_id = ? AND firebase_uid = ?`)
      .bind(status, nextDueAt, nextDueAt, new Date().toISOString(), planId, workOrderId, identity.uid).run();
    return adminJson({ ok: true, ...(await lifecyclePayload(identity, workOrderId)) });
  } catch (error) {
    if (error instanceof SyntaxError) return adminJson({ ok: false, error: "Invalid asset lifecycle update." }, 400);
    if (error instanceof Error && error.message === "INVALID_DATE") return adminJson({ ok: false, error: "Choose a valid next due date." }, 400);
    return lifecycleError(error);
  }
}
