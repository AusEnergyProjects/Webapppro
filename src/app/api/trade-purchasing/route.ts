import { getD1 } from "../../../../db";
import { requireFirebaseIdentity } from "@/lib/firebase-server";
import { adminJson, cleanAdminText, sameOrigin } from "@/lib/admin-server";
import { accountHasFeature } from "@/lib/direct-trade-entitlements-server";
import { createAdminNotification } from "@/lib/admin-notifications";
import { nextTradeWorkNumber } from "@/lib/trade-job-number-server";

export const runtime = "edge";

const ORDER_TRANSITIONS: Record<string, Set<string>> = {
  supplier: new Set(["confirmed", "part_fulfilled", "fulfilled", "cancelled"]),
  installer: new Set(["cancelled"]),
};
const CLAIM_TRANSITIONS: Record<string, Set<string>> = {
  supplier: new Set(["acknowledged", "assessment", "replacement", "credit", "resolved", "rejected"]),
  installer: new Set(["withdrawn"]),
};
const PAGE_SIZES = new Set([25, 50, 100]);

async function purchasingIdentity(request: Request) {
  const identity = await requireFirebaseIdentity(request);
  const account = await getD1().prepare(`SELECT partner_type, account_status, billing_status, business_name
    FROM trade_accounts WHERE firebase_uid = ?`).bind(identity.uid).first<Record<string, unknown>>();
  if (!account) throw new Error("PROFILE_REQUIRED");
  const partnerType = String(account.partner_type);
  if (!new Set(["installer", "supplier"]).has(partnerType)) throw new Error("TRADE_REQUIRED");
  if (account.account_status !== "active") throw new Error("ACCOUNT_INACTIVE");
  if (!await accountHasFeature(identity.uid, partnerType as "installer" | "supplier", account.billing_status, "business_operations")) {
    throw new Error("OPERATIONS_REQUIRED");
  }
  return { ...identity, partnerType, businessName: String(account.business_name || "Trade account") };
}

function errorResponse(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  if (code === "AUTH_REQUIRED") return adminJson({ ok: false, error: "Sign in to continue." }, 401);
  if (code === "PROFILE_REQUIRED") return adminJson({ ok: false, error: "Complete the business profile first." }, 404);
  if (code === "TRADE_REQUIRED") return adminJson({ ok: false, error: "Trade purchasing is reserved for installer and wholesaler accounts." }, 403);
  if (code === "ACCOUNT_INACTIVE") return adminJson({ ok: false, error: "This business account is not active." }, 403);
  if (code === "OPERATIONS_REQUIRED") return adminJson({ ok: false, error: "Purchase orders and warranty workflows require Business Hub access." }, 403);
  return adminJson({ ok: false, error: "The purchasing request could not be completed." }, 500);
}

async function purchasingData(uid: string, partnerType: string, url?: URL) {
  const db = getD1();
  const ownerColumn = partnerType === "supplier" ? "supplier_uid" : "installer_uid";
  const search = cleanAdminText(url?.searchParams.get("search"), 100).toLowerCase();
  const filter = cleanAdminText(url?.searchParams.get("filter"), 30) || "active";
  const sort = cleanAdminText(url?.searchParams.get("sort"), 30) || "updated-desc";
  const requestedPage = Number(url?.searchParams.get("page"));
  const requestedPageSize = Number(url?.searchParams.get("pageSize"));
  const page = Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const pageSize = PAGE_SIZES.has(requestedPageSize) ? requestedPageSize : 25;
  const ownerWhere = `WHERE po.${ownerColumn} = ?`;
  const conditions = [ownerWhere.slice(6)];
  const bindings: unknown[] = [uid];
  if (filter === "claims") conditions.push(`EXISTS (SELECT 1 FROM trade_warranty_claims wc WHERE wc.purchase_order_id = po.id AND wc.status NOT IN ('resolved', 'rejected', 'withdrawn'))`);
  else if (filter === "complete") conditions.push("po.status IN ('fulfilled', 'cancelled')");
  else if (filter === "active") conditions.push("po.status NOT IN ('fulfilled', 'cancelled')");
  if (search) {
    conditions.push("LOWER(po.id || ' ' || po.order_number || ' ' || po.installer_reference || ' ' || po.supplier_reference || ' ' || ia.business_name || ' ' || sa.business_name || ' ' || l.name) LIKE ?");
    bindings.push(`%${search}%`);
  }
  const where = conditions.join(" AND ");
  const orderBy: Record<string, string> = {
    "updated-desc": "po.updated_at DESC",
    "number-asc": "po.order_number COLLATE NOCASE ASC",
    "number-desc": "po.order_number COLLATE NOCASE DESC",
    "value-desc": "po.total_cents_inc_gst DESC, po.updated_at DESC",
  };
  const joins = `FROM trade_purchase_orders po
    JOIN trade_accounts ia ON ia.firebase_uid = po.installer_uid
    JOIN trade_accounts sa ON sa.firebase_uid = po.supplier_uid
    JOIN installer_product_lists l ON l.id = po.list_id`;
  const [orders, countRow, metrics] = await Promise.all([
    db.prepare(`SELECT po.*, ia.business_name installer_business, sa.business_name supplier_business,
    l.name list_name, l.project_postcode
    ${joins} WHERE ${where} ORDER BY ${orderBy[sort] || orderBy["updated-desc"]} LIMIT ? OFFSET ?`)
      .bind(...bindings, pageSize, (page - 1) * pageSize).all<Record<string, unknown>>(),
    db.prepare(`SELECT COUNT(*) total ${joins} WHERE ${where}`).bind(...bindings).first<Record<string, unknown>>(),
    db.prepare(`SELECT COUNT(*) total,
      SUM(CASE WHEN status IN ('submitted', 'confirmed', 'part_fulfilled') THEN 1 ELSE 0 END) active,
      SUM(CASE WHEN status = 'fulfilled' THEN 1 ELSE 0 END) fulfilled,
      (SELECT COUNT(*) FROM trade_warranty_claims wc WHERE wc.${ownerColumn} = ? AND wc.status NOT IN ('resolved', 'rejected', 'withdrawn')) open_claims
      FROM trade_purchase_orders WHERE ${ownerColumn} = ?`).bind(uid, uid).first<Record<string, unknown>>(),
  ]);
  const orderIds = orders.results.map((row: Record<string, unknown>) => String(row.id));
  const placeholders = orderIds.map(() => "?").join(",");
  const [items, events, claims] = orderIds.length ? await Promise.all([
    db.prepare(`SELECT * FROM trade_purchase_order_items WHERE purchase_order_id IN (${placeholders}) ORDER BY brand, product_name`).bind(...orderIds).all<Record<string, unknown>>(),
    db.prepare(`SELECT * FROM trade_purchase_order_events WHERE purchase_order_id IN (${placeholders}) ORDER BY created_at DESC`).bind(...orderIds).all<Record<string, unknown>>(),
    db.prepare(`SELECT * FROM trade_warranty_claims WHERE purchase_order_id IN (${placeholders}) ORDER BY updated_at DESC`).bind(...orderIds).all<Record<string, unknown>>(),
  ]) : [{ results: [] }, { results: [] }, { results: [] }];
  const eligible = partnerType === "installer" ? await db.prepare(`SELECT e.id, e.list_id, e.supplier_uid, e.status,
    e.supplier_note, e.updated_at, l.name list_name, l.project_postcode, a.business_name supplier_business
    FROM supplier_product_enquiries e
    JOIN installer_product_lists l ON l.id = e.list_id
    JOIN trade_accounts a ON a.firebase_uid = e.supplier_uid
    LEFT JOIN trade_purchase_orders po ON po.enquiry_id = e.id
    WHERE e.installer_uid = ? AND e.status = 'responded' AND po.id IS NULL
    ORDER BY e.updated_at DESC LIMIT 100`).bind(uid).all<Record<string, unknown>>() : { results: [] };
  const total = Number(countRow?.total || 0);
  return {
    orders: orders.results.map((row: Record<string, unknown>) => ({
      id: row.id, orderNumber: row.order_number, enquiryId: row.enquiry_id, listId: row.list_id,
      status: row.status, installerReference: row.installer_reference, supplierReference: row.supplier_reference,
      deliveryMethod: row.delivery_method, deliveryNotes: row.delivery_notes, supplierNote: row.supplier_note,
      expectedAt: row.expected_at, subtotalCentsExGst: Number(row.subtotal_cents_ex_gst), gstCents: Number(row.gst_cents),
      totalCentsIncGst: Number(row.total_cents_inc_gst), submittedAt: row.submitted_at, confirmedAt: row.confirmed_at,
      fulfilledAt: row.fulfilled_at, updatedAt: row.updated_at, installerBusiness: row.installer_business,
      supplierBusiness: row.supplier_business, listName: row.list_name, projectPostcode: row.project_postcode,
      items: items.results.filter((item: Record<string, unknown>) => item.purchase_order_id === row.id).map((item: Record<string, unknown>) => ({
        id: item.id, productId: item.supplier_product_id, modelNumber: item.model_number, brand: item.brand,
        name: item.product_name, unitLabel: item.unit_label, quantity: Number(item.quantity),
        fulfilledQuantity: Number(item.fulfilled_quantity), unitPriceCentsExGst: Number(item.unit_price_cents_ex_gst),
        warrantyYears: Number(item.warranty_years),
      })),
      events: events.results.filter((event: Record<string, unknown>) => event.purchase_order_id === row.id).map((event: Record<string, unknown>) => ({
        id: event.id, eventType: event.event_type, status: event.status, summary: event.summary,
        actorType: event.actor_type, createdAt: event.created_at,
      })),
      claims: claims.results.filter((claim: Record<string, unknown>) => claim.purchase_order_id === row.id).map((claim: Record<string, unknown>) => ({
        id: claim.id, claimNumber: claim.claim_number, itemId: claim.purchase_order_item_id, status: claim.status,
        issueCategory: claim.issue_category, summary: claim.summary, serialNumber: claim.serial_number,
        supplierResponse: claim.supplier_response, resolution: claim.resolution, submittedAt: claim.submitted_at,
        resolvedAt: claim.resolved_at, updatedAt: claim.updated_at,
      })),
    })),
    eligibleEnquiries: eligible.results.map((row: Record<string, unknown>) => ({
      id: row.id, listId: row.list_id, supplierUid: row.supplier_uid, status: row.status,
      supplierNote: row.supplier_note, updatedAt: row.updated_at, listName: row.list_name,
      projectPostcode: row.project_postcode, supplierBusiness: row.supplier_business,
    })),
    metrics: { total: Number(metrics?.total || 0), active: Number(metrics?.active || 0), fulfilled: Number(metrics?.fulfilled || 0), openClaims: Number(metrics?.open_claims || 0) },
    pagination: { page, pageSize, total, pageCount: Math.max(1, Math.ceil(total / pageSize)) },
  };
}

export async function GET(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const identity = await purchasingIdentity(request);
    return adminJson({ ok: true, ...(await purchasingData(identity.uid, identity.partnerType, new URL(request.url))) });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const identity = await purchasingIdentity(request);
    const body = await request.json() as Record<string, unknown>;
    const action = cleanAdminText(body.action, 40);
    const db = getD1();
    const now = new Date().toISOString();
    if (action === "create_order") {
      if (identity.partnerType !== "installer") return adminJson({ ok: false, error: "Only installers can submit purchase orders." }, 403);
      const enquiryId = cleanAdminText(body.enquiryId, 180);
      const enquiry = await db.prepare(`SELECT e.id, e.list_id, e.supplier_uid, e.status
        FROM supplier_product_enquiries e LEFT JOIN trade_purchase_orders po ON po.enquiry_id = e.id
        WHERE e.id = ? AND e.installer_uid = ? AND e.status = 'responded' AND po.id IS NULL`)
        .bind(enquiryId, identity.uid).first<Record<string, unknown>>();
      if (!enquiry) return adminJson({ ok: false, error: "Choose a responded wholesaler enquiry without an existing purchase order." }, 409);
      const lineItems = await db.prepare(`SELECT i.product_id, i.quantity, i.unit_price_cents_ex_gst,
        p.model_number, p.brand, p.name, p.unit_label, p.warranty_years
        FROM installer_product_list_items i JOIN supplier_products p ON p.id = i.product_id
        WHERE i.list_id = ? AND i.supplier_uid = ? ORDER BY p.brand, p.name`)
        .bind(enquiry.list_id, enquiry.supplier_uid).all<Record<string, unknown>>();
      if (!lineItems.results.length) return adminJson({ ok: false, error: "The selected enquiry has no orderable items." }, 409);
      const subtotal = lineItems.results.reduce((sum, item) => sum + Number(item.quantity) * Number(item.unit_price_cents_ex_gst), 0);
      const gst = Math.round(subtotal * 0.1);
      const orderId = crypto.randomUUID();
      const orderNumber = await nextTradeWorkNumber(db, identity.uid, "PO", now);
      const deliveryMethod = new Set(["confirm_with_supplier", "collection", "installer_business"]).has(String(body.deliveryMethod))
        ? String(body.deliveryMethod) : "confirm_with_supplier";
      const statements = [db.prepare(`INSERT INTO trade_purchase_orders
        (id, order_number, enquiry_id, list_id, installer_uid, supplier_uid, status, installer_reference,
         supplier_reference, delivery_method, delivery_notes, supplier_note, expected_at, subtotal_cents_ex_gst,
         gst_cents, total_cents_inc_gst, submitted_at, confirmed_at, fulfilled_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 'submitted', ?, '', ?, ?, '', '', ?, ?, ?, ?, '', '', ?, ?)`)
        .bind(orderId, orderNumber, enquiry.id, enquiry.list_id, identity.uid, enquiry.supplier_uid,
          cleanAdminText(body.installerReference, 100), deliveryMethod, cleanAdminText(body.deliveryNotes, 800),
          subtotal, gst, subtotal + gst, now, now, now),
      db.prepare(`INSERT INTO trade_purchase_order_events
        (id, purchase_order_id, event_type, status, summary, actor_type, actor_uid, created_at)
        VALUES (?, ?, 'order_submitted', 'submitted', ?, 'installer', ?, ?)`)
        .bind(crypto.randomUUID(), orderId, `${orderNumber} submitted to the wholesaler.`, identity.uid, now),
      ...lineItems.results.map((item) => db.prepare(`INSERT INTO trade_purchase_order_items
        (id, purchase_order_id, supplier_product_id, model_number, brand, product_name, unit_label, quantity,
         fulfilled_quantity, unit_price_cents_ex_gst, warranty_years, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`)
        .bind(crypto.randomUUID(), orderId, item.product_id, item.model_number, item.brand, item.name, item.unit_label,
          item.quantity, item.unit_price_cents_ex_gst, item.warranty_years, now, now))];
      await db.batch(statements);
      await createAdminNotification({
        eventKey: `trade-purchase-order:${orderId}`, eventType: "trade.purchase_order_submitted", category: "trade",
        priority: "normal", title: "Installer submitted a purchase order",
        summary: `${identity.businessName} submitted ${orderNumber} to a wholesaler.`, entityType: "trade_purchase_order",
        entityId: orderId, actorType: "installer", actorUid: identity.uid, requiresAction: false,
        metadata: { orderNumber, supplierUid: enquiry.supplier_uid }, occurredAt: now,
      });
      return adminJson({ ok: true, ...(await purchasingData(identity.uid, identity.partnerType)) }, 201);
    }
    if (action === "create_claim") {
      if (identity.partnerType !== "installer") return adminJson({ ok: false, error: "Only installers can lodge warranty claims." }, 403);
      const orderId = cleanAdminText(body.orderId, 180);
      const itemId = cleanAdminText(body.itemId, 180);
      const order = await db.prepare(`SELECT po.id, po.supplier_uid, po.order_number, i.id item_id
        FROM trade_purchase_orders po JOIN trade_purchase_order_items i ON i.purchase_order_id = po.id
        WHERE po.id = ? AND po.installer_uid = ? AND i.id = ? AND po.status IN ('part_fulfilled', 'fulfilled')`)
        .bind(orderId, identity.uid, itemId).first<Record<string, unknown>>();
      const issueCategory = cleanAdminText(body.issueCategory, 60);
      const summary = cleanAdminText(body.summary, 1200);
      if (!order || !issueCategory || !summary) return adminJson({ ok: false, error: "Choose a fulfilled order item and describe the warranty issue." }, 400);
      const claimId = crypto.randomUUID();
      const claimNumber = await nextTradeWorkNumber(db, identity.uid, "WTY", now);
      await db.batch([
        db.prepare(`INSERT INTO trade_warranty_claims
          (id, claim_number, purchase_order_id, purchase_order_item_id, installer_uid, supplier_uid, status,
           issue_category, summary, serial_number, supplier_response, resolution, submitted_at, resolved_at, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, 'submitted', ?, ?, ?, '', '', ?, '', ?, ?)`)
          .bind(claimId, claimNumber, orderId, itemId, identity.uid, order.supplier_uid, issueCategory, summary,
            cleanAdminText(body.serialNumber, 120), now, now, now),
        db.prepare(`INSERT INTO trade_purchase_order_events
          (id, purchase_order_id, event_type, status, summary, actor_type, actor_uid, created_at)
          VALUES (?, ?, 'warranty_claim_submitted', 'submitted', ?, 'installer', ?, ?)`)
          .bind(crypto.randomUUID(), orderId, `${claimNumber} lodged against ${order.order_number}.`, identity.uid, now),
      ]);
      await createAdminNotification({
        eventKey: `trade-warranty-claim:${claimId}`, eventType: "trade.warranty_claim_submitted", category: "trade",
        priority: "high", title: "Installer lodged a warranty claim", summary: `${identity.businessName} lodged ${claimNumber}.`,
        entityType: "trade_warranty_claim", entityId: claimId, actorType: "installer", actorUid: identity.uid,
        requiresAction: false, metadata: { claimNumber, orderId }, occurredAt: now,
      });
      return adminJson({ ok: true, ...(await purchasingData(identity.uid, identity.partnerType)) }, 201);
    }
    return adminJson({ ok: false, error: "Choose a valid purchasing action." }, 400);
  } catch (error) { return errorResponse(error); }
}

export async function PATCH(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const identity = await purchasingIdentity(request);
    const body = await request.json() as Record<string, unknown>;
    const action = cleanAdminText(body.action, 40);
    const db = getD1();
    const now = new Date().toISOString();
    if (action === "update_order") {
      const orderId = cleanAdminText(body.orderId, 180);
      const status = cleanAdminText(body.status, 40);
      if (!ORDER_TRANSITIONS[identity.partnerType]?.has(status)) return adminJson({ ok: false, error: "Choose a valid order status for this account." }, 400);
      const ownerColumn = identity.partnerType === "supplier" ? "supplier_uid" : "installer_uid";
      const order = await db.prepare(`SELECT id, order_number FROM trade_purchase_orders WHERE id = ? AND ${ownerColumn} = ?`)
        .bind(orderId, identity.uid).first<Record<string, unknown>>();
      if (!order) return adminJson({ ok: false, error: "Purchase order not found." }, 404);
      const itemQuantities = Array.isArray(body.itemQuantities) ? body.itemQuantities as Array<Record<string, unknown>> : [];
      const statements = [db.prepare(`UPDATE trade_purchase_orders SET status = ?, supplier_reference = ?, supplier_note = ?,
        expected_at = ?, confirmed_at = CASE WHEN ? = 'confirmed' AND confirmed_at = '' THEN ? ELSE confirmed_at END,
        fulfilled_at = CASE WHEN ? = 'fulfilled' THEN ? ELSE fulfilled_at END, updated_at = ? WHERE id = ? AND ${ownerColumn} = ?`)
        .bind(status, cleanAdminText(body.supplierReference, 100), cleanAdminText(body.supplierNote, 800),
          cleanAdminText(body.expectedAt, 30), status, now, status, now, now, orderId, identity.uid),
      db.prepare(`INSERT INTO trade_purchase_order_events
        (id, purchase_order_id, event_type, status, summary, actor_type, actor_uid, created_at)
        VALUES (?, ?, 'order_status_updated', ?, ?, ?, ?, ?)`)
        .bind(crypto.randomUUID(), orderId, status, `${order.order_number} marked ${status.replaceAll("_", " ")}.`, identity.partnerType, identity.uid, now)];
      if (identity.partnerType === "supplier") {
        for (const entry of itemQuantities.slice(0, 100)) {
          const quantity = Number(entry.fulfilledQuantity);
          if (Number.isInteger(quantity) && quantity >= 0) statements.push(db.prepare(`UPDATE trade_purchase_order_items
            SET fulfilled_quantity = MIN(quantity, ?), updated_at = ? WHERE id = ? AND purchase_order_id = ?`)
            .bind(quantity, now, cleanAdminText(entry.itemId, 180), orderId));
        }
      }
      await db.batch(statements);
      return adminJson({ ok: true, ...(await purchasingData(identity.uid, identity.partnerType)) });
    }
    if (action === "update_claim") {
      const claimId = cleanAdminText(body.claimId, 180);
      const status = cleanAdminText(body.status, 40);
      if (!CLAIM_TRANSITIONS[identity.partnerType]?.has(status)) return adminJson({ ok: false, error: "Choose a valid warranty status for this account." }, 400);
      const ownerColumn = identity.partnerType === "supplier" ? "supplier_uid" : "installer_uid";
      const result = await db.prepare(`UPDATE trade_warranty_claims SET status = ?, supplier_response = ?, resolution = ?,
        resolved_at = CASE WHEN ? IN ('resolved', 'rejected', 'withdrawn') THEN ? ELSE resolved_at END, updated_at = ?
        WHERE id = ? AND ${ownerColumn} = ?`)
        .bind(status, cleanAdminText(body.supplierResponse, 1200), cleanAdminText(body.resolution, 1200),
          status, now, now, claimId, identity.uid).run();
      if (!result.meta.changes) return adminJson({ ok: false, error: "Warranty claim not found." }, 404);
      return adminJson({ ok: true, ...(await purchasingData(identity.uid, identity.partnerType)) });
    }
    return adminJson({ ok: false, error: "Choose a valid purchasing update." }, 400);
  } catch (error) { return errorResponse(error); }
}
