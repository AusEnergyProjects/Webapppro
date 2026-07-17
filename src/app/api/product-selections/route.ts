import { getD1 } from "../../../../db";
import { requireFirebaseIdentity } from "@/lib/firebase-server";
import { adminJson, cleanAdminText, sameOrigin } from "@/lib/admin-server";
import { accountHasFeature } from "@/lib/direct-trade-entitlements-server";
import { adminNotificationStatement } from "@/lib/admin-notifications";

export const runtime = "edge";

const LIST_STATUSES = new Set(["draft", "submitted", "archived"]);

function integer(value: unknown, minimum: number, maximum: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum
    ? parsed
    : null;
}

async function installerIdentity(request: Request) {
  const identity = await requireFirebaseIdentity(request);
  const account = await getD1().prepare(`SELECT partner_type, account_status, billing_status, business_name
    FROM trade_accounts WHERE firebase_uid = ?`).bind(identity.uid)
    .first<Record<string, unknown>>();
  if (!account) throw new Error("PROFILE_REQUIRED");
  if (account.partner_type !== "installer") throw new Error("INSTALLER_REQUIRED");
  if (account.account_status !== "active") throw new Error("ACCOUNT_INACTIVE");
  if (!await accountHasFeature(identity.uid, "installer", account.billing_status, "installer_marketplace")) {
    throw new Error("MARKETPLACE_REQUIRED");
  }
  return { ...identity, businessName: String(account.business_name || "Installer") };
}

function errorResponse(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  if (code === "AUTH_REQUIRED") return adminJson({ ok: false, error: "Sign in to continue." }, 401);
  if (code === "PROFILE_REQUIRED") return adminJson({ ok: false, error: "Complete the installer profile first." }, 404);
  if (code === "INSTALLER_REQUIRED") return adminJson({ ok: false, error: "Product selections are reserved for installer accounts." }, 403);
  if (code === "ACCOUNT_INACTIVE") return adminJson({ ok: false, error: "This installer account is not active." }, 403);
  if (code === "MARKETPLACE_REQUIRED") return adminJson({ ok: false, error: "Product selection requires paid marketplace access." }, 403);
  return adminJson({ ok: false, error: "The product selection request could not be completed." }, 500);
}

async function selections(firebaseUid: string) {
  const db = getD1();
  const lists = await db.prepare(`SELECT id, name, project_postcode, notes, status, submitted_at, created_at, updated_at
    FROM installer_product_lists WHERE firebase_uid = ? ORDER BY status = 'draft' DESC, updated_at DESC LIMIT 50`)
    .bind(firebaseUid).all<Record<string, unknown>>();
  const ids = lists.results.map((row: Record<string, unknown>) => String(row.id));
  if (!ids.length) return [];
  const placeholders = ids.map(() => "?").join(",");
  const [items, enquiries] = await Promise.all([
    db.prepare(`SELECT i.id, i.list_id, i.product_id, i.supplier_uid, i.quantity, i.unit_price_cents_ex_gst,
      p.model_number, p.brand, p.name product_name, p.unit_label, p.min_order_qty, p.order_increment,
      a.business_name supplier_name, a.business_website supplier_website
      FROM installer_product_list_items i
      JOIN supplier_products p ON p.id = i.product_id
      JOIN trade_accounts a ON a.firebase_uid = i.supplier_uid
      WHERE i.list_id IN (${placeholders}) ORDER BY a.business_name, p.brand, p.name`)
      .bind(...ids).all<Record<string, unknown>>(),
    db.prepare(`SELECT id, list_id, supplier_uid, status, created_at, updated_at
      FROM supplier_product_enquiries WHERE list_id IN (${placeholders}) ORDER BY updated_at DESC`)
      .bind(...ids).all<Record<string, unknown>>(),
  ]);
  return lists.results.map((list: Record<string, unknown>) => ({
    id: list.id,
    name: list.name,
    projectPostcode: list.project_postcode,
    notes: list.notes,
    status: list.status,
    submittedAt: list.submitted_at,
    createdAt: list.created_at,
    updatedAt: list.updated_at,
    items: items.results.filter((item: Record<string, unknown>) => item.list_id === list.id).map((item: Record<string, unknown>) => ({
      id: item.id,
      productId: item.product_id,
      supplierUid: item.supplier_uid,
      quantity: Number(item.quantity),
      unitPriceCentsExGst: Number(item.unit_price_cents_ex_gst),
      modelNumber: item.model_number,
      brand: item.brand,
      name: item.product_name,
      unitLabel: item.unit_label,
      minOrderQty: Number(item.min_order_qty),
      orderIncrement: Number(item.order_increment),
      supplierName: item.supplier_name,
      supplierWebsite: item.supplier_website,
    })),
    enquiries: enquiries.results.filter((item: Record<string, unknown>) => item.list_id === list.id).map((item: Record<string, unknown>) => ({
      id: item.id,
      supplierUid: item.supplier_uid,
      status: item.status,
      createdAt: item.created_at,
      updatedAt: item.updated_at,
    })),
  }));
}

export async function GET(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const identity = await installerIdentity(request);
    return adminJson({ ok: true, lists: await selections(identity.uid) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const identity = await installerIdentity(request);
    let body: Record<string, unknown>;
    try { body = await request.json() as Record<string, unknown>; }
    catch { return adminJson({ ok: false, error: "Invalid product selection." }, 400); }
    const action = cleanAdminText(body.action, 30);
    const db = getD1();
    const now = new Date().toISOString();

    if (action === "create") {
      const name = cleanAdminText(body.name, 120);
      const projectPostcode = cleanAdminText(body.projectPostcode, 4);
      const notes = cleanAdminText(body.notes, 800);
      if (!name || (projectPostcode && !/^\d{4}$/.test(projectPostcode))) {
        return adminJson({ ok: false, error: "Add a list name and an optional four-digit project postcode." }, 400);
      }
      await db.prepare(`INSERT INTO installer_product_lists
        (id, firebase_uid, name, project_postcode, notes, status, submitted_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 'draft', '', ?, ?)`)
        .bind(crypto.randomUUID(), identity.uid, name, projectPostcode, notes, now, now).run();
      return adminJson({ ok: true, lists: await selections(identity.uid) }, 201);
    }

    if (action === "add_item") {
      const listId = cleanAdminText(body.listId, 180);
      const productId = cleanAdminText(body.productId, 180);
      const quantity = integer(body.quantity, 1, 100000);
      if (!listId || !productId || quantity === null) return adminJson({ ok: false, error: "Choose a draft list, product and valid quantity." }, 400);
      const [list, product] = await Promise.all([
        db.prepare("SELECT id FROM installer_product_lists WHERE id = ? AND firebase_uid = ? AND status = 'draft'")
          .bind(listId, identity.uid).first(),
        db.prepare(`SELECT p.id, p.firebase_uid, p.unit_price_cents_ex_gst, p.min_order_qty, p.order_increment
          FROM supplier_products p JOIN trade_accounts a ON a.firebase_uid = p.firebase_uid
          WHERE p.id = ? AND p.listing_status = 'published' AND p.review_status = 'approved'
            AND a.partner_type = 'supplier' AND a.account_status = 'active' AND a.verification_status = 'approved'`).bind(productId).first<Record<string, unknown>>(),
      ]);
      if (!list) return adminJson({ ok: false, error: "Choose an editable draft product list." }, 404);
      if (!product) return adminJson({ ok: false, error: "This product is no longer available for selection." }, 409);
      const minimum = Number(product.min_order_qty || 1);
      const increment = Number(product.order_increment || 1);
      if (quantity < minimum || (quantity - minimum) % increment !== 0) {
        return adminJson({ ok: false, error: `Quantity must start at ${minimum} and increase in steps of ${increment}.` }, 400);
      }
      await db.prepare(`INSERT INTO installer_product_list_items
        (id, list_id, product_id, supplier_uid, quantity, unit_price_cents_ex_gst, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(list_id, product_id) DO UPDATE SET quantity = excluded.quantity,
          unit_price_cents_ex_gst = excluded.unit_price_cents_ex_gst, updated_at = excluded.updated_at`)
        .bind(crypto.randomUUID(), listId, productId, product.firebase_uid, quantity, product.unit_price_cents_ex_gst, now, now).run();
      await db.prepare("UPDATE installer_product_lists SET updated_at = ? WHERE id = ?").bind(now, listId).run();
      return adminJson({ ok: true, lists: await selections(identity.uid) });
    }

    if (action === "submit") {
      const listId = cleanAdminText(body.listId, 180);
      const message = cleanAdminText(body.message, 600);
      const list = await db.prepare("SELECT id FROM installer_product_lists WHERE id = ? AND firebase_uid = ? AND status = 'draft'")
        .bind(listId, identity.uid).first();
      if (!list) return adminJson({ ok: false, error: "Choose an editable draft product list." }, 404);
      const suppliers = await db.prepare("SELECT DISTINCT supplier_uid FROM installer_product_list_items WHERE list_id = ?")
        .bind(listId).all<Record<string, unknown>>();
      if (!suppliers.results.length) return adminJson({ ok: false, error: "Add at least one product before sending an enquiry." }, 400);
      await db.batch([
        ...suppliers.results.map((supplier: Record<string, unknown>) => db.prepare(`INSERT INTO supplier_product_enquiries
          (id, list_id, installer_uid, supplier_uid, status, message, supplier_note, created_at, updated_at)
          VALUES (?, ?, ?, ?, 'new', ?, '', ?, ?)
          ON CONFLICT(list_id, supplier_uid) DO NOTHING`)
          .bind(crypto.randomUUID(), listId, identity.uid, supplier.supplier_uid, message, now, now)),
        db.prepare("UPDATE installer_product_lists SET status = 'submitted', submitted_at = ?, updated_at = ? WHERE id = ? AND firebase_uid = ?")
          .bind(now, now, listId, identity.uid),
        adminNotificationStatement(db, {
          eventKey: `installer-product-enquiry:${listId}`,
          eventType: "installer.product_enquiry_submitted",
          category: "trade",
          priority: "normal",
          title: "Installer sent a product enquiry",
          summary: `${identity.businessName} sent a saved product list to ${suppliers.results.length} wholesaler${suppliers.results.length === 1 ? "" : "s"}.`,
          entityType: "installer_product_list",
          entityId: listId,
          actorType: "installer",
          actorUid: identity.uid,
          requiresAction: false,
          metadata: { supplierCount: suppliers.results.length },
          occurredAt: now,
        }),
      ]);
      return adminJson({ ok: true, lists: await selections(identity.uid) });
    }

    return adminJson({ ok: false, error: "Choose a valid product selection action." }, 400);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const identity = await installerIdentity(request);
    let body: Record<string, unknown>;
    try { body = await request.json() as Record<string, unknown>; }
    catch { return adminJson({ ok: false, error: "Invalid product list update." }, 400); }
    const action = cleanAdminText(body.action, 30);
    const listId = cleanAdminText(body.listId, 180);
    const db = getD1();
    const list = await db.prepare("SELECT id, status FROM installer_product_lists WHERE id = ? AND firebase_uid = ?")
      .bind(listId, identity.uid).first<Record<string, unknown>>();
    if (!list) return adminJson({ ok: false, error: "Product list not found." }, 404);
    const now = new Date().toISOString();

    if (action === "remove_item" && list.status === "draft") {
      const itemId = cleanAdminText(body.itemId, 180);
      await db.prepare("DELETE FROM installer_product_list_items WHERE id = ? AND list_id = ?")
        .bind(itemId, listId).run();
    } else if (action === "quantity" && list.status === "draft") {
      const itemId = cleanAdminText(body.itemId, 180);
      const quantity = integer(body.quantity, 1, 100000);
      if (!itemId || quantity === null) return adminJson({ ok: false, error: "Choose a valid quantity." }, 400);
      const item = await db.prepare(`SELECT i.id, p.min_order_qty, p.order_increment
        FROM installer_product_list_items i JOIN supplier_products p ON p.id = i.product_id
        WHERE i.id = ? AND i.list_id = ?`).bind(itemId, listId).first<Record<string, unknown>>();
      if (!item) return adminJson({ ok: false, error: "Product list item not found." }, 404);
      const minimum = Number(item.min_order_qty || 1);
      const increment = Number(item.order_increment || 1);
      if (quantity < minimum || (quantity - minimum) % increment !== 0) return adminJson({ ok: false, error: `Quantity must start at ${minimum} and increase in steps of ${increment}.` }, 400);
      await db.prepare("UPDATE installer_product_list_items SET quantity = ?, updated_at = ? WHERE id = ? AND list_id = ?")
        .bind(quantity, now, itemId, listId).run();
    } else if (action === "archive") {
      await db.prepare("UPDATE installer_product_lists SET status = 'archived', updated_at = ? WHERE id = ? AND firebase_uid = ?")
        .bind(now, listId, identity.uid).run();
    } else if (action === "restore" && LIST_STATUSES.has(String(list.status))) {
      await db.prepare("UPDATE installer_product_lists SET status = 'draft', submitted_at = '', updated_at = ? WHERE id = ? AND firebase_uid = ?")
        .bind(now, listId, identity.uid).run();
    } else {
      return adminJson({ ok: false, error: "This product list cannot be changed in its current state." }, 409);
    }
    await db.prepare("UPDATE installer_product_lists SET updated_at = ? WHERE id = ?").bind(now, listId).run();
    return adminJson({ ok: true, lists: await selections(identity.uid) });
  } catch (error) {
    return errorResponse(error);
  }
}
