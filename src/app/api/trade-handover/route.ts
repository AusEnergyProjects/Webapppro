import { getD1 } from "../../../../db";
import { requireFirebaseIdentity } from "@/lib/firebase-server";
import { adminJson, cleanAdminText, sameOrigin } from "@/lib/admin-server";
import { accountEntitlements } from "@/lib/direct-trade-entitlements-server";
import { adminNotificationStatement } from "@/lib/admin-notifications";
import { dispatchAdminNotificationDeliveries } from "@/lib/admin-notification-delivery";
import {
  HANDOVER_ASSET_CATEGORIES,
  complianceTemplateFor,
  handoverReadiness,
  isIsoDate,
} from "@/lib/trade-handover.mjs";

export const runtime = "edge";

const ASSET_CATEGORIES = new Set(HANDOVER_ASSET_CATEGORIES.map((item: string[]) => item[0]));
const COMPLIANCE_STATUSES = new Set(["pending", "complete", "not_applicable"]);
const EDITABLE_PACK_STATUSES = new Set(["draft", "changes_requested"]);
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const MAX_ASSETS = 100;

type TradeIdentity = {
  uid: string;
  businessName: string;
  fullAccess: boolean;
};

type WorkRecord = {
  id: string;
  firebase_uid: string;
  partner_type: string;
  stage: string;
  service_category: string;
  source_type: string;
  source_reference: string;
  work_number: string;
};

type PackRecord = {
  id: string;
  work_order_id: string;
  firebase_uid: string;
  customer_project_id: string;
  service_category: string;
  status: string;
  submitted_at: string;
  published_at: string;
  review_note: string;
  created_at: string;
  updated_at: string;
};

function privateDataDetected(value: string) {
  return EMAIL_PATTERN.test(value);
}

function dateValue(value: unknown) {
  const clean = cleanAdminText(value, 10);
  if (!isIsoDate(clean)) throw new Error("INVALID_DATE");
  return clean;
}

async function tradeIdentity(request: Request): Promise<TradeIdentity> {
  const identity = await requireFirebaseIdentity(request);
  const account = await getD1().prepare(`SELECT partner_type, account_status, billing_status, business_name
    FROM trade_accounts WHERE firebase_uid = ?`).bind(identity.uid).first<Record<string, unknown>>();
  if (!account) throw new Error("PROFILE_REQUIRED");
  if (account.account_status !== "active") throw new Error("ACCOUNT_INACTIVE");
  if (account.partner_type !== "installer") throw new Error("INSTALLER_REQUIRED");
  const entitlements = await accountEntitlements(identity.uid, "installer", account.billing_status);
  return {
    uid: identity.uid,
    businessName: String(account.business_name || "Installer"),
    fullAccess: entitlements.features.business_operations,
  };
}

function errorResponse(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  if (code === "AUTH_REQUIRED") return adminJson({ ok: false, error: "Sign in to continue." }, 401);
  if (code === "PROFILE_REQUIRED") return adminJson({ ok: false, error: "Complete the installer profile first." }, 404);
  if (code === "ACCOUNT_INACTIVE") return adminJson({ ok: false, error: "This installer account is not active." }, 403);
  if (code === "INSTALLER_REQUIRED") return adminJson({ ok: false, error: "Installed asset and customer handover tools are available to installer accounts." }, 403);
  if (code === "FULL_ACCESS_REQUIRED") return adminJson({ ok: false, error: "Complete trade verification before using assets, warranties and handover packs." }, 403);
  if (code === "WORK_NOT_FOUND") return adminJson({ ok: false, error: "Work record not found." }, 404);
  if (code === "PACK_NOT_FOUND") return adminJson({ ok: false, error: "Start the asset and handover record first." }, 404);
  if (code === "PACK_LOCKED") return adminJson({ ok: false, error: "This handover is locked while it is under review or already published." }, 409);
  if (code === "ASSET_LIMIT_REACHED") return adminJson({ ok: false, error: "This handover pack has reached its installed asset limit." }, 409);
  if (code === "PRIVATE_DATA") return adminJson({ ok: false, error: "Keep customer contact details out of installed asset and warranty fields." }, 400);
  if (code === "INVALID_DATE") return adminJson({ ok: false, error: "Choose valid installation and warranty dates." }, 400);
  return adminJson({ ok: false, error: "The asset and handover request could not be completed." }, 500);
}

async function ownedWorkRecord(firebaseUid: string, workOrderId: string) {
  return getD1().prepare(`SELECT id, firebase_uid, partner_type, stage, service_category, source_type,
    source_reference, work_number FROM trade_work_orders
    WHERE id = ? AND firebase_uid = ? AND record_status = 'active'`)
    .bind(workOrderId, firebaseUid).first<WorkRecord>();
}

async function linkedCustomerProject(work: WorkRecord) {
  if (work.source_type !== "opportunity" || !work.source_reference) return "";
  const row = await getD1().prepare(`SELECT p.id
    FROM trade_opportunity_matches m
    JOIN customer_projects p ON p.opportunity_id = m.opportunity_id
    WHERE m.id = ? AND m.firebase_uid = ? AND p.status NOT IN ('withdrawn', 'archived') LIMIT 1`)
    .bind(work.source_reference, work.firebase_uid).first<{ id: string }>();
  return row?.id || "";
}

async function packForWork(firebaseUid: string, workOrderId: string) {
  return getD1().prepare(`SELECT id, work_order_id, firebase_uid, customer_project_id, service_category,
    status, submitted_at, published_at, review_note, created_at, updated_at
    FROM trade_handover_packs WHERE work_order_id = ? AND firebase_uid = ?`)
    .bind(workOrderId, firebaseUid).first<PackRecord>();
}

function workEventStatement(db: D1Database, firebaseUid: string, workOrderId: string, eventType: string, summary: string, now: string) {
  return db.prepare(`INSERT INTO trade_work_order_events
    (id, work_order_id, firebase_uid, event_type, summary, created_at)
    VALUES (?, ?, ?, ?, ?, ?)`)
    .bind(crypto.randomUUID(), workOrderId, firebaseUid, eventType, summary, now);
}

async function handoverPayload(identity: TradeIdentity, work: WorkRecord) {
  const pack = await packForWork(identity.uid, work.id);
  if (!pack) {
    return {
      pack: null,
      customerLinked: Boolean(await linkedCustomerProject(work)),
      access: { fullAccess: identity.fullAccess },
    };
  }
  const db = getD1();
  const [assetRows, complianceRows, documentRows] = await Promise.all([
    db.prepare(`SELECT id, crm_customer_id, service_site_id, source_type, source_reference, review_status, asset_status,
      asset_label, commissioning_reference, asset_category, brand, model_number, serial_number, quantity, installed_at,
      warranty_provider, warranty_reference, warranty_start, warranty_end, supplier_product_id, created_at, updated_at
      FROM trade_installed_assets WHERE handover_pack_id = ? AND firebase_uid = ? AND record_status = 'active'
      ORDER BY created_at`).bind(pack.id, identity.uid).all<Record<string, unknown>>(),
    db.prepare(`SELECT id, template_key, label, guidance, status, completed_at, created_at, updated_at
      FROM trade_compliance_items WHERE handover_pack_id = ? AND firebase_uid = ?
      ORDER BY created_at`).bind(pack.id, identity.uid).all<Record<string, unknown>>(),
    db.prepare(`SELECT id, category, file_name, content_type, size_bytes, customer_visible, created_at
      FROM trade_handover_documents WHERE handover_pack_id = ? AND firebase_uid = ?
      ORDER BY created_at DESC`).bind(pack.id, identity.uid).all<Record<string, unknown>>(),
  ]);
  const assets = assetRows.results.map((row: Record<string, unknown>) => ({
    id: row.id,
    crmCustomerId: row.crm_customer_id,
    serviceSiteId: row.service_site_id,
    sourceType: row.source_type,
    sourceReference: row.source_reference,
    reviewStatus: row.review_status,
    assetStatus: row.asset_status,
    assetLabel: row.asset_label,
    commissioningReference: row.commissioning_reference,
    assetCategory: row.asset_category,
    brand: row.brand,
    modelNumber: row.model_number,
    serialNumber: row.serial_number,
    quantity: Number(row.quantity || 1),
    installedAt: row.installed_at,
    warrantyProvider: row.warranty_provider,
    warrantyReference: row.warranty_reference,
    warrantyStart: row.warranty_start,
    warrantyEnd: row.warranty_end,
    supplierProductId: row.supplier_product_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
  const complianceItems = complianceRows.results.map((row: Record<string, unknown>) => ({
    id: row.id,
    templateKey: row.template_key,
    label: row.label,
    guidance: row.guidance,
    status: row.status,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
  const documents = documentRows.results.map((row: Record<string, unknown>) => ({
    id: row.id,
    category: row.category,
    fileName: row.file_name,
    contentType: row.content_type,
    sizeBytes: Number(row.size_bytes || 0),
    customerVisible: Boolean(row.customer_visible),
    createdAt: row.created_at,
  }));
  return {
    pack: {
      id: pack.id,
      workOrderId: pack.work_order_id,
      serviceCategory: pack.service_category,
      status: pack.status,
      submittedAt: pack.submitted_at,
      publishedAt: pack.published_at,
      reviewNote: pack.review_note,
      createdAt: pack.created_at,
      updatedAt: pack.updated_at,
      canEdit: EDITABLE_PACK_STATUSES.has(pack.status),
      assets,
      complianceItems,
      documents,
      readiness: handoverReadiness({
        assets,
        complianceItems,
        documents,
        workStage: work.stage,
        customerProjectId: pack.customer_project_id,
      }),
    },
    customerLinked: Boolean(pack.customer_project_id),
    access: { fullAccess: identity.fullAccess },
  };
}

export async function GET(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const identity = await tradeIdentity(request);
    const workOrderId = cleanAdminText(new URL(request.url).searchParams.get("workOrderId"), 180);
    const work = await ownedWorkRecord(identity.uid, workOrderId);
    if (!work) throw new Error("WORK_NOT_FOUND");
    return adminJson({ ok: true, ...(await handoverPayload(identity, work)) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const identity = await tradeIdentity(request);
    if (!identity.fullAccess) throw new Error("FULL_ACCESS_REQUIRED");
    let body: Record<string, unknown>;
    try { body = await request.json() as Record<string, unknown>; }
    catch { return adminJson({ ok: false, error: "Invalid asset and handover request." }, 400); }
    const action = cleanAdminText(body.action, 40);
    const workOrderId = cleanAdminText(body.workOrderId, 180);
    const work = await ownedWorkRecord(identity.uid, workOrderId);
    if (!work) throw new Error("WORK_NOT_FOUND");
    const db = getD1();
    const now = new Date().toISOString();

    if (action === "initialize_pack") {
      const existing = await packForWork(identity.uid, work.id);
      if (!existing) {
        const packId = crypto.randomUUID();
        const customerProjectId = await linkedCustomerProject(work);
        const template = complianceTemplateFor(work.service_category);
        const statements = [
          db.prepare(`INSERT INTO trade_handover_packs
            (id, work_order_id, firebase_uid, customer_project_id, service_category, status,
             submitted_at, published_at, review_note, reviewed_by_uid, reviewed_at, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, 'draft', '', '', '', '', '', ?, ?)`)
            .bind(packId, work.id, identity.uid, customerProjectId, work.service_category, now, now),
          ...template.map((item: { key: string; label: string; guidance: string }) => db.prepare(`INSERT INTO trade_compliance_items
            (id, handover_pack_id, work_order_id, firebase_uid, template_key, label, guidance,
             status, completed_at, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', '', ?, ?)`)
            .bind(crypto.randomUUID(), packId, work.id, identity.uid, item.key, item.label, item.guidance, now, now)),
          workEventStatement(db, identity.uid, work.id, "handover_started", "Installed asset and handover record started.", now),
        ];
        await db.batch(statements);
      }
      return adminJson({ ok: true, ...(await handoverPayload(identity, work)) }, existing ? 200 : 201);
    }

    if (action !== "add_asset") return adminJson({ ok: false, error: "Unsupported asset and handover action." }, 400);
    const pack = await packForWork(identity.uid, work.id);
    if (!pack) throw new Error("PACK_NOT_FOUND");
    if (!EDITABLE_PACK_STATUSES.has(pack.status)) throw new Error("PACK_LOCKED");
    const count = await db.prepare(`SELECT COUNT(*) count FROM trade_installed_assets
      WHERE handover_pack_id = ? AND firebase_uid = ? AND record_status = 'active'`)
      .bind(pack.id, identity.uid).first<{ count: number }>();
    if (Number(count?.count || 0) >= MAX_ASSETS) throw new Error("ASSET_LIMIT_REACHED");
    const assetCategory = cleanAdminText(body.assetCategory, 60);
    const brand = cleanAdminText(body.brand, 100);
    const modelNumber = cleanAdminText(body.modelNumber, 120);
    const serialNumber = cleanAdminText(body.serialNumber, 140);
    const warrantyProvider = cleanAdminText(body.warrantyProvider, 120);
    const warrantyReference = cleanAdminText(body.warrantyReference, 140);
    const supplierProductId = cleanAdminText(body.supplierProductId, 180);
    const quantity = Math.max(1, Math.min(9999, Math.round(Number(body.quantity) || 1)));
    const installedAt = dateValue(body.installedAt);
    const warrantyStart = dateValue(body.warrantyStart);
    const warrantyEnd = dateValue(body.warrantyEnd);
    if (!ASSET_CATEGORIES.has(assetCategory) || !brand || !modelNumber) {
      return adminJson({ ok: false, error: "Choose an asset category and add the installed brand and model." }, 400);
    }
    if (privateDataDetected(`${brand} ${modelNumber} ${serialNumber} ${warrantyProvider} ${warrantyReference}`)) throw new Error("PRIVATE_DATA");
    if (warrantyStart && warrantyEnd && warrantyEnd < warrantyStart) {
      return adminJson({ ok: false, error: "The warranty end date cannot be before the warranty start date." }, 400);
    }
    const assetId = crypto.randomUUID();
    const crmLink = await db.prepare(`SELECT crm_customer_id, service_site_id, customer_source FROM trade_crm_job_details
      WHERE work_order_id = ? AND firebase_uid = ?`).bind(work.id, identity.uid).first<Record<string, unknown>>();
    const directCustomerId = crmLink?.customer_source === "trade_owned" ? String(crmLink.crm_customer_id || "") : "";
    const directSiteId = directCustomerId ? String(crmLink?.service_site_id || "") : "";
    await db.batch([
      db.prepare(`INSERT INTO trade_installed_assets
        (id, handover_pack_id, work_order_id, firebase_uid, crm_customer_id, service_site_id, source_type,
         source_reference, review_status, asset_status, asset_label, commissioning_reference, asset_category, brand, model_number,
         serial_number, quantity, installed_at, warranty_provider, warranty_reference, warranty_start,
         warranty_end, supplier_product_id, record_status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 'handover', ?, ?, 'active', '', '', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`)
        .bind(assetId, pack.id, work.id, identity.uid, directCustomerId, directSiteId, pack.id,
          directCustomerId && directSiteId ? "confirmed" : "pending_review", assetCategory, brand, modelNumber, serialNumber,
          quantity, installedAt, warrantyProvider, warrantyReference, warrantyStart, warrantyEnd,
          supplierProductId, now, now),
      db.prepare("UPDATE trade_handover_packs SET updated_at = ? WHERE id = ? AND firebase_uid = ?")
        .bind(now, pack.id, identity.uid),
      workEventStatement(db, identity.uid, work.id, "asset_added", `${brand} ${modelNumber} added to the installed asset register.`, now),
    ]);
    return adminJson({ ok: true, ...(await handoverPayload(identity, work)) }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const identity = await tradeIdentity(request);
    if (!identity.fullAccess) throw new Error("FULL_ACCESS_REQUIRED");
    let body: Record<string, unknown>;
    try { body = await request.json() as Record<string, unknown>; }
    catch { return adminJson({ ok: false, error: "Invalid asset and handover update." }, 400); }
    const action = cleanAdminText(body.action, 40);
    const workOrderId = cleanAdminText(body.workOrderId, 180);
    const work = await ownedWorkRecord(identity.uid, workOrderId);
    if (!work) throw new Error("WORK_NOT_FOUND");
    const pack = await packForWork(identity.uid, work.id);
    if (!pack) throw new Error("PACK_NOT_FOUND");
    if (!EDITABLE_PACK_STATUSES.has(pack.status)) throw new Error("PACK_LOCKED");
    const db = getD1();
    const now = new Date().toISOString();

    if (action === "update_compliance") {
      const itemId = cleanAdminText(body.itemId, 180);
      const status = cleanAdminText(body.status, 30);
      if (!itemId || !COMPLIANCE_STATUSES.has(status)) {
        return adminJson({ ok: false, error: "Choose a valid checklist item and status." }, 400);
      }
      const item = await db.prepare(`SELECT id FROM trade_compliance_items
        WHERE id = ? AND handover_pack_id = ? AND firebase_uid = ?`)
        .bind(itemId, pack.id, identity.uid).first();
      if (!item) return adminJson({ ok: false, error: "Checklist item not found." }, 404);
      await db.batch([
        db.prepare(`UPDATE trade_compliance_items SET status = ?, completed_at = ?, updated_at = ?
          WHERE id = ? AND handover_pack_id = ? AND firebase_uid = ?`)
          .bind(status, status === "complete" ? now : "", now, itemId, pack.id, identity.uid),
        db.prepare("UPDATE trade_handover_packs SET updated_at = ? WHERE id = ? AND firebase_uid = ?")
          .bind(now, pack.id, identity.uid),
      ]);
      return adminJson({ ok: true, ...(await handoverPayload(identity, work)) });
    }

    if (action === "archive_asset") {
      const assetId = cleanAdminText(body.assetId, 180);
      const asset = await db.prepare(`SELECT id FROM trade_installed_assets
        WHERE id = ? AND handover_pack_id = ? AND firebase_uid = ? AND record_status = 'active'`)
        .bind(assetId, pack.id, identity.uid).first();
      if (!asset) return adminJson({ ok: false, error: "Installed asset not found." }, 404);
      await db.batch([
        db.prepare(`UPDATE trade_installed_assets SET record_status = 'archived', updated_at = ?
          WHERE id = ? AND handover_pack_id = ? AND firebase_uid = ?`).bind(now, assetId, pack.id, identity.uid),
        db.prepare("UPDATE trade_handover_packs SET updated_at = ? WHERE id = ? AND firebase_uid = ?")
          .bind(now, pack.id, identity.uid),
        workEventStatement(db, identity.uid, work.id, "asset_archived", "An installed asset record was removed before handover review.", now),
      ]);
      return adminJson({ ok: true, ...(await handoverPayload(identity, work)) });
    }

    if (action !== "submit_handover") return adminJson({ ok: false, error: "Unsupported asset and handover update." }, 400);
    const payload = await handoverPayload(identity, work);
    if (!payload.pack?.readiness.ready) {
      return adminJson({ ok: false, error: payload.pack?.readiness.blockers[0] || "Complete the handover pack before review." }, 409);
    }
    await db.batch([
      db.prepare(`UPDATE trade_handover_packs SET status = 'submitted', submitted_at = ?, review_note = '',
        reviewed_by_uid = '', reviewed_at = '', updated_at = ?
        WHERE id = ? AND firebase_uid = ? AND status IN ('draft', 'changes_requested')`)
        .bind(now, now, pack.id, identity.uid),
      workEventStatement(db, identity.uid, work.id, "handover_submitted", "Customer handover pack submitted for platform review.", now),
      adminNotificationStatement(db, {
        eventKey: `trade-handover-submitted:${pack.id}:${now}`,
        eventType: "trade.handover_submitted",
        category: "approval",
        priority: "high",
        title: "Customer handover ready for review",
        summary: `${identity.businessName.slice(0, 140)} submitted an installed asset, warranty and compliance pack for platform review.`,
        entityType: "trade_handover_pack",
        entityId: pack.id,
        actorType: "installer",
        actorUid: identity.uid,
        requiresAction: true,
        metadata: { workOrderId: work.id, workNumber: work.work_number },
        occurredAt: now,
      }),
    ]);
    await dispatchAdminNotificationDeliveries();
    return adminJson({ ok: true, ...(await handoverPayload(identity, work)) });
  } catch (error) {
    return errorResponse(error);
  }
}
