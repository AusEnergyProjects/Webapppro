import { getD1 } from "../../../../db";
import { requireFirebaseIdentity } from "@/lib/firebase-server";
import { cleanAdminText, sameOrigin } from "@/lib/admin-server";
import { lifecycleStatus, safetyNoticeMatchesAsset } from "@/lib/asset-lifecycle.mjs";

export const runtime = "edge";

const REMINDER_DAYS = new Set([7, 14, 30, 60, 90]);
const json = (body: object, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
type CustomerLifecycleAsset = {
  id: string;
  handoverPackId: string;
  assetCategory: string;
  brand: string;
  modelNumber: string;
  serialNumber: string;
  installedAt: string;
  warrantyEnd: string;
  serviceCategory: string;
  workNumber: string;
};

async function customerIdentity(request: Request) {
  const identity = await requireFirebaseIdentity(request);
  const account = await getD1().prepare("SELECT account_status FROM customer_accounts WHERE firebase_uid = ?")
    .bind(identity.uid).first<Record<string, unknown>>();
  if (!account) throw new Error("PROFILE_REQUIRED");
  if (account.account_status !== "active") throw new Error("ACCOUNT_INACTIVE");
  return identity;
}

function customerError(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  if (code === "AUTH_REQUIRED") return json({ ok: false, error: "Sign in to continue." }, 401);
  if (code === "PROFILE_REQUIRED") return json({ ok: false, error: "Complete your private household profile first." }, 404);
  if (code === "ACCOUNT_INACTIVE") return json({ ok: false, error: "This customer account is not active." }, 403);
  if (code === "PROJECT_NOT_FOUND") return json({ ok: false, error: "Project not found." }, 404);
  if (code === "ASSET_NOT_FOUND") return json({ ok: false, error: "Installed asset not found in this private project." }, 404);
  if (code === "NOTICE_NOT_FOUND") return json({ ok: false, error: "This safety notice is no longer available for the selected asset." }, 404);
  return json({ ok: false, error: "The private asset lifecycle record could not be completed." }, 500);
}

async function ownedPublishedAssets(customerUid: string, projectId: string) {
  const db = getD1();
  const project = await db.prepare("SELECT id FROM customer_projects WHERE id = ? AND firebase_uid = ?")
    .bind(projectId, customerUid).first();
  if (!project) throw new Error("PROJECT_NOT_FOUND");
  return db.prepare(`SELECT a.id, a.handover_pack_id, a.asset_category, a.brand, a.model_number, a.serial_number,
    a.installed_at, a.warranty_end, p.service_category, w.work_number
    FROM trade_installed_assets a JOIN trade_handover_packs p ON p.id = a.handover_pack_id
    JOIN trade_work_orders w ON w.id = p.work_order_id
    WHERE p.customer_project_id = ? AND p.status = 'published' AND a.record_status = 'active'
    ORDER BY a.created_at`).bind(projectId).all<Record<string, unknown>>();
}

async function payload(customerUid: string, projectId: string) {
  const db = getD1();
  const assetRows = await ownedPublishedAssets(customerUid, projectId);
  const assets: CustomerLifecycleAsset[] = assetRows.results.map((row: Record<string, unknown>): CustomerLifecycleAsset => ({
    id: String(row.id), handoverPackId: String(row.handover_pack_id), assetCategory: String(row.asset_category),
    brand: String(row.brand), modelNumber: String(row.model_number), serialNumber: String(row.serial_number || ""),
    installedAt: String(row.installed_at || ""), warrantyEnd: String(row.warranty_end || ""),
    serviceCategory: String(row.service_category), workNumber: String(row.work_number),
  }));
  const assetIds = assets.map((asset) => asset.id);
  if (!assetIds.length) return { assets: [], plans: [], events: [], notices: [], preferences: [] };
  const slots = assetIds.map(() => "?").join(",");
  const [planRows, eventRows, noticeRows, preferenceRows, acknowledgementRows] = await Promise.all([
    db.prepare(`SELECT id, asset_id, service_type, cadence_months, next_due_at, status, updated_at
      FROM trade_asset_service_plans WHERE asset_id IN (${slots}) ORDER BY next_due_at`).bind(...assetIds).all<Record<string, unknown>>(),
    db.prepare(`SELECT id, service_plan_id, asset_id, serviced_at, summary, provider_reference, next_due_at
      FROM trade_asset_service_events WHERE asset_id IN (${slots}) ORDER BY serviced_at DESC LIMIT 200`).bind(...assetIds).all<Record<string, unknown>>(),
    db.prepare(`SELECT id, title, summary, severity, asset_category, brand, model_number, source_url, source_label,
      effective_at, expires_at, published_at FROM asset_safety_notices
      WHERE status = 'published' AND (expires_at = '' OR expires_at >= ?)
      ORDER BY CASE severity WHEN 'urgent' THEN 1 WHEN 'important' THEN 2 ELSE 3 END, published_at DESC`)
      .bind(new Date().toISOString().slice(0, 10)).all<Record<string, unknown>>(),
    db.prepare(`SELECT asset_id, reminders_enabled, reminder_lead_days, updated_at
      FROM customer_asset_lifecycle_preferences WHERE customer_uid = ? AND asset_id IN (${slots})`)
      .bind(customerUid, ...assetIds).all<Record<string, unknown>>(),
    db.prepare(`SELECT notice_id, asset_id, status, acknowledged_at
      FROM asset_safety_acknowledgements WHERE customer_uid = ? AND asset_id IN (${slots})`)
      .bind(customerUid, ...assetIds).all<Record<string, unknown>>(),
  ]);
  const plans = planRows.results.map((row: Record<string, unknown>) => ({
    id: String(row.id), assetId: String(row.asset_id), serviceType: String(row.service_type),
    cadenceMonths: Number(row.cadence_months), nextDueAt: String(row.next_due_at), status: String(row.status),
    lifecycleStatus: row.status === "active" ? lifecycleStatus(row.next_due_at) : "paused", updatedAt: String(row.updated_at),
  }));
  const events = eventRows.results.map((row: Record<string, unknown>) => ({
    id: String(row.id), servicePlanId: String(row.service_plan_id), assetId: String(row.asset_id),
    servicedAt: String(row.serviced_at), summary: String(row.summary || ""), providerReference: String(row.provider_reference || ""),
    nextDueAt: String(row.next_due_at || ""),
  }));
  const notices = noticeRows.results.flatMap((row: Record<string, unknown>) => assets.filter((asset) => safetyNoticeMatchesAsset(row, asset)).map((asset) => {
    const acknowledgement = acknowledgementRows.results.find((item: Record<string, unknown>) => item.notice_id === row.id && item.asset_id === asset.id);
    return {
      id: String(row.id), assetId: asset.id, title: String(row.title), summary: String(row.summary), severity: String(row.severity),
      sourceUrl: String(row.source_url), sourceLabel: String(row.source_label), effectiveAt: String(row.effective_at || ""),
      expiresAt: String(row.expires_at || ""), publishedAt: String(row.published_at), acknowledgedAt: String(acknowledgement?.acknowledged_at || ""),
    };
  }));
  const preferences = assets.map((asset) => {
    const row = preferenceRows.results.find((item: Record<string, unknown>) => item.asset_id === asset.id);
    return { assetId: asset.id, remindersEnabled: row ? Boolean(row.reminders_enabled) : true, reminderLeadDays: Number(row?.reminder_lead_days || 30) };
  });
  return { assets, plans, events, notices, preferences };
}

export async function GET(request: Request) {
  if (!sameOrigin(request)) return json({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const identity = await customerIdentity(request);
    const projectId = cleanAdminText(new URL(request.url).searchParams.get("projectId"), 180);
    return json({ ok: true, ...(await payload(identity.uid, projectId)) });
  } catch (error) { return customerError(error); }
}

export async function PATCH(request: Request) {
  if (!sameOrigin(request)) return json({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const identity = await customerIdentity(request);
    const body = await request.json() as Record<string, unknown>;
    const projectId = cleanAdminText(body.projectId, 180);
    const action = cleanAdminText(body.action, 40);
    const assetId = cleanAdminText(body.assetId, 180);
    const assets = await ownedPublishedAssets(identity.uid, projectId);
    const assetRow = assets.results.find((row: Record<string, unknown>) => row.id === assetId);
    if (!assetRow) throw new Error("ASSET_NOT_FOUND");
    const db = getD1();
    const now = new Date().toISOString();
    if (action === "update_reminders") {
      const enabled = Boolean(body.enabled);
      const leadDays = Number(body.leadDays);
      if (!REMINDER_DAYS.has(leadDays)) return json({ ok: false, error: "Choose a supported reminder window." }, 400);
      await db.prepare(`INSERT INTO customer_asset_lifecycle_preferences
        (id, customer_uid, asset_id, reminders_enabled, reminder_lead_days, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(customer_uid, asset_id) DO UPDATE SET reminders_enabled = excluded.reminders_enabled,
          reminder_lead_days = excluded.reminder_lead_days, updated_at = excluded.updated_at`)
        .bind(crypto.randomUUID(), identity.uid, assetId, enabled ? 1 : 0, leadDays, now, now).run();
      return json({ ok: true, ...(await payload(identity.uid, projectId)) });
    }
    if (action !== "acknowledge_notice") return json({ ok: false, error: "Unsupported lifecycle preference action." }, 400);
    const noticeId = cleanAdminText(body.noticeId, 180);
    const notice = await db.prepare(`SELECT id, asset_category, brand, model_number FROM asset_safety_notices
      WHERE id = ? AND status = 'published' AND (expires_at = '' OR expires_at >= ?)`)
      .bind(noticeId, now.slice(0, 10)).first<Record<string, unknown>>();
    const asset = { assetCategory: assetRow.asset_category, brand: assetRow.brand, modelNumber: assetRow.model_number };
    if (!notice || !safetyNoticeMatchesAsset(notice, asset)) throw new Error("NOTICE_NOT_FOUND");
    await db.prepare(`INSERT INTO asset_safety_acknowledgements
      (id, notice_id, asset_id, customer_uid, status, acknowledged_at, updated_at)
      VALUES (?, ?, ?, ?, 'acknowledged', ?, ?)
      ON CONFLICT(customer_uid, notice_id, asset_id) DO UPDATE SET status = 'acknowledged',
        acknowledged_at = excluded.acknowledged_at, updated_at = excluded.updated_at`)
      .bind(crypto.randomUUID(), noticeId, assetId, identity.uid, now, now).run();
    return json({ ok: true, ...(await payload(identity.uid, projectId)) });
  } catch (error) {
    if (error instanceof SyntaxError) return json({ ok: false, error: "Invalid lifecycle preference request." }, 400);
    return customerError(error);
  }
}
