import { getD1 } from "../../../../db";
import { adminJson, cleanAdminText, sameOrigin } from "@/lib/admin-server";
import { normalisePriceBookInput } from "@/lib/trade-price-book";
import { canDispatch, requireInstallerTeamAccess, type TeamAccess } from "@/lib/trade-team-server";

export const runtime = "edge";

type Row = Record<string, unknown>;

function errorResponse(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  if (code === "AUTH_REQUIRED") return adminJson({ ok: false, error: "Sign in to continue." }, 401);
  if (["ACCOUNT_INACTIVE", "INSTALLER_ONLY", "FULL_ACCESS_REQUIRED", "TEAM_ACCESS_REQUIRED", "TEAM_MEMBERSHIP_REQUIRED"].includes(code)) {
    return adminJson({ ok: false, error: "An active verified installer account is required." }, 403);
  }
  if (code === "PRICE_BOOK_MANAGEMENT_REQUIRED") return adminJson({ ok: false, error: "Only the owner, manager or coordinator can manage the price book." }, 403);
  if (code === "PRICE_BOOK_ITEM_NOT_FOUND") return adminJson({ ok: false, error: "Price-book item not found." }, 404);
  if (code === "PRICE_BOOK_LIMIT") return adminJson({ ok: false, error: "This workspace has reached its 5,000 item price-book limit." }, 409);
  if (code === "CATALOGUE_ITEM_UNAVAILABLE") return adminJson({ ok: false, error: "That catalogue item is no longer available. Choose another item or enter the supplier details manually." }, 409);
  if (code === "INVALID_PRICE_BOOK_SKILL") return adminJson({ ok: false, error: "Choose a required skill already listed on the business profile." }, 400);
  if (code.startsWith("INVALID_PRICE_BOOK") || ["INVALID_DECIMAL", "INVALID_MONEY"].includes(code)) {
    return adminJson({ ok: false, error: "Check the item name, type, cost, sell price, GST and duration." }, 400);
  }
  return adminJson({ ok: false, error: "The price-book request could not be completed." }, 500);
}

function requireManager(access: TeamAccess) {
  if (!canDispatch(access)) throw new Error("PRICE_BOOK_MANAGEMENT_REQUIRED");
}

function parseList(value: unknown) {
  try {
    const parsed = JSON.parse(String(value || "[]"));
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch { return []; }
}

async function capabilityOptions(ownerUid: string) {
  const account = await getD1().prepare("SELECT capabilities FROM trade_accounts WHERE firebase_uid = ?")
    .bind(ownerUid).first<Row>();
  return parseList(account?.capabilities);
}

async function catalogueReference(id: string) {
  if (!id) return null;
  const row = await getD1().prepare(`SELECT p.id, p.model_number, p.name, p.unit_price_cents_ex_gst, a.business_name
    FROM supplier_products p JOIN trade_accounts a ON a.firebase_uid = p.firebase_uid
    WHERE p.id = ? AND p.listing_status = 'published' AND p.review_status = 'approved' AND a.account_status = 'active'`)
    .bind(id).first<Row>();
  if (!row) throw new Error("CATALOGUE_ITEM_UNAVAILABLE");
  return row;
}

async function preparedInput(ownerUid: string, body: Row) {
  const raw = { ...body };
  const reference = await catalogueReference(cleanAdminText(body.supplierProductId, 180));
  if (reference) {
    raw.supplierName = reference.business_name;
    raw.supplierSku = reference.model_number;
    raw.supplierCost = (Number(reference.unit_price_cents_ex_gst) / 100).toFixed(2);
  }
  const input = normalisePriceBookInput(raw, cleanAdminText);
  const capabilities = await capabilityOptions(ownerUid);
  if (input.requiredSkill && !capabilities.includes(input.requiredSkill)) throw new Error("INVALID_PRICE_BOOK_SKILL");
  return input;
}

function itemPayload(row: Row) {
  return {
    id: String(row.id), itemCode: String(row.item_code), name: String(row.name), description: String(row.description),
    itemType: String(row.item_type), unitLabel: String(row.unit_label), supplierCostCentsExGst: Number(row.supplier_cost_cents_ex_gst),
    sellPriceCentsExGst: Number(row.sell_price_cents_ex_gst), taxCode: String(row.tax_code), markupBasisPoints: Number(row.markup_basis_points),
    marginBasisPoints: Number(row.margin_basis_points), expectedDurationMinutes: Number(row.expected_duration_minutes),
    requiredSkill: String(row.required_skill), supplierName: String(row.supplier_name), supplierSku: String(row.supplier_sku),
    supplierProductId: String(row.supplier_product_id), recordStatus: String(row.record_status), priceRevision: Number(row.price_revision),
    createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  };
}

async function ownedItem(ownerUid: string, itemId: string) {
  const row = await getD1().prepare("SELECT * FROM trade_price_book_items WHERE id = ? AND firebase_uid = ?")
    .bind(itemId, ownerUid).first<Row>();
  if (!row) throw new Error("PRICE_BOOK_ITEM_NOT_FOUND");
  return row;
}

async function libraryPayload(ownerUid: string, url: URL) {
  const search = cleanAdminText(url.searchParams.get("search"), 100);
  const status = ["active", "archived", "all"].includes(url.searchParams.get("status") || "") ? url.searchParams.get("status")! : "active";
  const conditions = ["firebase_uid = ?"]; const bindings: unknown[] = [ownerUid];
  if (status !== "all") { conditions.push("record_status = ?"); bindings.push(status); }
  if (search) {
    conditions.push("(name LIKE ? ESCAPE '\\' OR item_code LIKE ? ESCAPE '\\' OR supplier_name LIKE ? ESCAPE '\\' OR supplier_sku LIKE ? ESCAPE '\\')");
    const pattern = `%${search.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
    bindings.push(pattern, pattern, pattern, pattern);
  }
  const db = getD1();
  const [items, counts, capabilities, catalogue] = await Promise.all([
    db.prepare(`SELECT * FROM trade_price_book_items WHERE ${conditions.join(" AND ")}
      ORDER BY record_status = 'archived', name COLLATE NOCASE, item_code LIMIT 500`).bind(...bindings).all<Row>(),
    db.prepare(`SELECT COUNT(*) total, SUM(CASE WHEN record_status = 'active' THEN 1 ELSE 0 END) active_count,
      SUM(CASE WHEN record_status = 'archived' THEN 1 ELSE 0 END) archived_count
      FROM trade_price_book_items WHERE firebase_uid = ?`).bind(ownerUid).first<Row>(),
    capabilityOptions(ownerUid),
    db.prepare(`SELECT p.id, p.model_number, p.name, p.unit_price_cents_ex_gst, a.business_name
      FROM supplier_products p JOIN trade_accounts a ON a.firebase_uid = p.firebase_uid
      WHERE p.listing_status = 'published' AND p.review_status = 'approved' AND a.account_status = 'active'
      ORDER BY p.updated_at DESC, p.name COLLATE NOCASE LIMIT 100`).all<Row>(),
  ]);
  return {
    items: items.results.map(itemPayload),
    counts: { total: Number(counts?.total || 0), active: Number(counts?.active_count || 0), archived: Number(counts?.archived_count || 0) },
    capabilityOptions: capabilities,
    catalogueOptions: catalogue.results.map((row) => ({ id: String(row.id), supplierSku: String(row.model_number), name: String(row.name),
      supplierCostCentsExGst: Number(row.unit_price_cents_ex_gst), supplierName: String(row.business_name) })),
  };
}

export async function GET(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const access = await requireInstallerTeamAccess(request, false); requireManager(access); const url = new URL(request.url);
    const itemId = cleanAdminText(url.searchParams.get("itemId"), 180);
    if (itemId) {
      await ownedItem(access.ownerUid, itemId);
      const history = await getD1().prepare(`SELECT price_revision, supplier_cost_cents_ex_gst, sell_price_cents_ex_gst,
        tax_code, markup_basis_points, margin_basis_points, change_type, changed_at
        FROM trade_price_book_price_history WHERE price_book_item_id = ? AND firebase_uid = ?
        ORDER BY price_revision DESC LIMIT 20`).bind(itemId, access.ownerUid).all<Row>();
      return adminJson({ ok: true, history: history.results.map((row) => ({ priceRevision: Number(row.price_revision),
        supplierCostCentsExGst: Number(row.supplier_cost_cents_ex_gst), sellPriceCentsExGst: Number(row.sell_price_cents_ex_gst),
        taxCode: String(row.tax_code), markupBasisPoints: Number(row.markup_basis_points), marginBasisPoints: Number(row.margin_basis_points),
        changeType: String(row.change_type), changedAt: String(row.changed_at) })) });
    }
    return adminJson({ ok: true, access: { role: access.role, canManage: true }, ...(await libraryPayload(access.ownerUid, url)) });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const access = await requireInstallerTeamAccess(request, false); requireManager(access); const body = await request.json() as Row;
    if (cleanAdminText(body.action, 30) !== "create") return adminJson({ ok: false, error: "Unsupported price-book action." }, 400);
    const db = getD1(); const count = await db.prepare("SELECT COUNT(*) count FROM trade_price_book_items WHERE firebase_uid = ?")
      .bind(access.ownerUid).first<Row>();
    if (Number(count?.count || 0) >= 5_000) throw new Error("PRICE_BOOK_LIMIT");
    const input = await preparedInput(access.ownerUid, body); const id = crypto.randomUUID(); const now = new Date().toISOString();
    const itemCode = `PB-${id.slice(0, 8).toUpperCase()}`;
    await db.batch([
      db.prepare(`INSERT INTO trade_price_book_items
        (id, firebase_uid, item_code, name, description, item_type, unit_label, supplier_cost_cents_ex_gst,
        sell_price_cents_ex_gst, tax_code, markup_basis_points, margin_basis_points, expected_duration_minutes,
        required_skill, supplier_name, supplier_sku, supplier_product_id, record_status, price_revision,
        created_by_uid, updated_by_uid, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', 1, ?, ?, ?, ?)`)
        .bind(id, access.ownerUid, itemCode, input.name, input.description, input.itemType, input.unitLabel,
          input.supplierCostCentsExGst, input.sellPriceCentsExGst, input.taxCode, input.markupBasisPoints,
          input.marginBasisPoints, input.expectedDurationMinutes, input.requiredSkill, input.supplierName,
          input.supplierSku, input.supplierProductId, access.actorUid, access.actorUid, now, now),
      db.prepare(`INSERT INTO trade_price_book_price_history
        (id, price_book_item_id, firebase_uid, price_revision, supplier_cost_cents_ex_gst, sell_price_cents_ex_gst,
        tax_code, markup_basis_points, margin_basis_points, change_type, changed_by_uid, changed_at)
        VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, 'created', ?, ?)`)
        .bind(crypto.randomUUID(), id, access.ownerUid, input.supplierCostCentsExGst, input.sellPriceCentsExGst,
          input.taxCode, input.markupBasisPoints, input.marginBasisPoints, access.actorUid, now),
    ]);
    return adminJson({ ok: true, item: itemPayload((await ownedItem(access.ownerUid, id))) }, 201);
  } catch (error) { return errorResponse(error); }
}

export async function PATCH(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const access = await requireInstallerTeamAccess(request, false); requireManager(access); const body = await request.json() as Row;
    const action = cleanAdminText(body.action, 30); const itemId = cleanAdminText(body.itemId, 180);
    const existing = await ownedItem(access.ownerUid, itemId); const db = getD1(); const now = new Date().toISOString();
    if (action === "archive") {
      await db.prepare(`UPDATE trade_price_book_items SET record_status = 'archived', updated_by_uid = ?, updated_at = ?
        WHERE id = ? AND firebase_uid = ? AND record_status = 'active'`).bind(access.actorUid, now, itemId, access.ownerUid).run();
      return adminJson({ ok: true, item: itemPayload((await ownedItem(access.ownerUid, itemId))) });
    }
    if (action !== "update") return adminJson({ ok: false, error: "Unsupported price-book action." }, 400);
    if (existing.record_status !== "active") return adminJson({ ok: false, error: "Archived price-book items cannot be changed." }, 409);
    const input = await preparedInput(access.ownerUid, body);
    const priceChanged = Number(existing.supplier_cost_cents_ex_gst) !== input.supplierCostCentsExGst
      || Number(existing.sell_price_cents_ex_gst) !== input.sellPriceCentsExGst || String(existing.tax_code) !== input.taxCode;
    const priceRevision = Number(existing.price_revision) + (priceChanged ? 1 : 0);
    const statements = [db.prepare(`UPDATE trade_price_book_items SET name = ?, description = ?, item_type = ?, unit_label = ?,
      supplier_cost_cents_ex_gst = ?, sell_price_cents_ex_gst = ?, tax_code = ?, markup_basis_points = ?, margin_basis_points = ?,
      expected_duration_minutes = ?, required_skill = ?, supplier_name = ?, supplier_sku = ?, supplier_product_id = ?,
      price_revision = ?, updated_by_uid = ?, updated_at = ? WHERE id = ? AND firebase_uid = ? AND record_status = 'active'`)
      .bind(input.name, input.description, input.itemType, input.unitLabel, input.supplierCostCentsExGst, input.sellPriceCentsExGst,
        input.taxCode, input.markupBasisPoints, input.marginBasisPoints, input.expectedDurationMinutes, input.requiredSkill,
        input.supplierName, input.supplierSku, input.supplierProductId, priceRevision, access.actorUid, now, itemId, access.ownerUid)];
    if (priceChanged) statements.push(db.prepare(`INSERT INTO trade_price_book_price_history
      (id, price_book_item_id, firebase_uid, price_revision, supplier_cost_cents_ex_gst, sell_price_cents_ex_gst,
      tax_code, markup_basis_points, margin_basis_points, change_type, changed_by_uid, changed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'price_updated', ?, ?)`)
      .bind(crypto.randomUUID(), itemId, access.ownerUid, priceRevision, input.supplierCostCentsExGst,
        input.sellPriceCentsExGst, input.taxCode, input.markupBasisPoints, input.marginBasisPoints, access.actorUid, now));
    await db.batch(statements);
    return adminJson({ ok: true, item: itemPayload((await ownedItem(access.ownerUid, itemId))) });
  } catch (error) { return errorResponse(error); }
}
