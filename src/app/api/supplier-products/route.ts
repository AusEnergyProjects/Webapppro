import { getD1 } from "../../../../db";
import { requireFirebaseIdentity } from "@/lib/firebase-server";
import { accountHasFeature } from "@/lib/direct-trade-entitlements-server";
import { createAdminNotification } from "@/lib/admin-notifications";

export const runtime = "edge";

const CATEGORIES = new Set([
  "assessment",
  "solar",
  "battery",
  "heating-cooling",
  "hot-water",
  "insulation-draughts",
  "ev-charging",
  "electrical",
  "plumbing",
  "mounting-hardware",
  "controls",
  "other",
]);
const STOCK_STATUSES = new Set([
  "in_stock",
  "limited",
  "order_in",
  "unavailable",
]);
const LISTING_STATUSES = new Set(["draft", "published", "paused", "archived"]);
const RELATIONSHIPS = new Set(["required", "recommended", "compatible"]);
const PAGE_SIZES = new Set([25, 50, 100]);

function json(body: object, status = 200) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}
function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}
function text(value: unknown, maximum: number) {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}
function integer(value: unknown, minimum: number, maximum: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum
    ? parsed
    : null;
}

async function supplierIdentity(request: Request) {
  const identity = await requireFirebaseIdentity(request);
  const account = await getD1()
    .prepare(
      "SELECT partner_type, account_status, billing_status, business_name, COALESCE(is_synthetic, 0) is_synthetic FROM trade_accounts WHERE firebase_uid = ?",
    )
    .bind(identity.uid)
    .first<Record<string, unknown>>();
  if (!account) throw new Error("PROFILE_REQUIRED");
  if (account.partner_type !== "supplier") throw new Error("SUPPLIER_REQUIRED");
  if (account.account_status !== "active") throw new Error("ACCOUNT_INACTIVE");
  return { ...identity, billingStatus: account.billing_status, businessName: String(account.business_name || "Wholesaler"), isSynthetic: Number(account.is_synthetic || 0) };
}

function errorResponse(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  if (code === "AUTH_REQUIRED")
    return json({ ok: false, error: "Sign in to continue." }, 401);
  if (code === "PROFILE_REQUIRED")
    return json(
      { ok: false, error: "Complete the wholesaler profile first." },
      404,
    );
  if (code === "SUPPLIER_REQUIRED")
    return json(
      {
        ok: false,
        error: "Product catalogue access is reserved for wholesaler accounts.",
      },
      403,
    );
  if (code === "ACCOUNT_INACTIVE")
    return json(
      { ok: false, error: "This business account is not active." },
      403,
    );
  return json(
    { ok: false, error: "The catalogue request could not be completed." },
    500,
  );
}

function product(row: Record<string, unknown>) {
  return {
    id: row.id,
    modelNumber: row.model_number,
    brand: row.brand,
    name: row.name,
    category: row.category,
    description: row.description,
    unitPriceCentsExGst: Number(row.unit_price_cents_ex_gst),
    minOrderQty: Number(row.min_order_qty),
    orderIncrement: Number(row.order_increment),
    unitLabel: row.unit_label,
    stockStatus: row.stock_status,
    leadTimeDays: Number(row.lead_time_days),
    warrantyYears: Number(row.warranty_years),
    datasheetUrl: row.datasheet_url,
    listingStatus: row.listing_status,
    reviewStatus: row.review_status,
    reviewNote: row.review_note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function catalogue(firebaseUid: string) {
  const db = getD1();
  const [products, links] = await Promise.all([
    db
      .prepare(
        "SELECT * FROM supplier_products WHERE firebase_uid = ? ORDER BY updated_at DESC LIMIT 500",
      )
      .bind(firebaseUid)
      .all<Record<string, unknown>>(),
    db
      .prepare(
        `SELECT l.id, l.product_id, l.linked_product_id, l.relationship, l.default_qty, l.note,
      p.model_number linked_model_number, p.name linked_name
      FROM supplier_product_links l JOIN supplier_products p ON p.id = l.linked_product_id
      WHERE l.firebase_uid = ? ORDER BY p.brand, p.name`,
      )
      .bind(firebaseUid)
      .all<Record<string, unknown>>(),
  ]);
  return products.results.map((row: Record<string, unknown>) => ({
    ...product(row),
    dependencies: links.results
      .filter((link: Record<string, unknown>) => link.product_id === row.id)
      .map((link: Record<string, unknown>) => ({
        id: link.id,
        linkedProductId: link.linked_product_id,
        relationship: link.relationship,
        defaultQty: Number(link.default_qty),
        note: link.note,
        linkedModelNumber: link.linked_model_number,
        linkedName: link.linked_name,
      })),
  }));
}

async function cataloguePage(firebaseUid: string, url: URL) {
  const search = text(url.searchParams.get("search"), 100).toLowerCase();
  const model = text(url.searchParams.get("model"), 100).toLowerCase();
  const brand = text(url.searchParams.get("brand"), 100).toLowerCase();
  const category = text(url.searchParams.get("category"), 40);
  const stock = text(url.searchParams.get("stock"), 30);
  const minimumPrice = integer(url.searchParams.get("minPrice"), 0, 100_000_000) || 0;
  const maximumPrice = integer(url.searchParams.get("maxPrice"), 0, 100_000_000) || 0;
  const filter = text(url.searchParams.get("filter"), 30) || "all";
  const sort = text(url.searchParams.get("sort"), 30) || "updated-desc";
  const requestedPage = Number(url.searchParams.get("page"));
  const requestedPageSize = Number(url.searchParams.get("pageSize"));
  const page = Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const pageSize = PAGE_SIZES.has(requestedPageSize) ? requestedPageSize : 25;
  const conditions = ["firebase_uid = ?"];
  const bindings: unknown[] = [firebaseUid];
  if (search) {
    conditions.push("LOWER(name) LIKE ?");
    bindings.push(`%${search}%`);
  }
  if (model) { conditions.push("LOWER(model_number) LIKE ?"); bindings.push(`%${model}%`); }
  if (brand) { conditions.push("LOWER(brand) LIKE ?"); bindings.push(`%${brand}%`); }
  if (CATEGORIES.has(category)) { conditions.push("category = ?"); bindings.push(category); }
  if (STOCK_STATUSES.has(stock)) { conditions.push("stock_status = ?"); bindings.push(stock); }
  if (minimumPrice) { conditions.push("unit_price_cents_ex_gst >= ?"); bindings.push(minimumPrice); }
  if (maximumPrice) { conditions.push("unit_price_cents_ex_gst <= ?"); bindings.push(maximumPrice); }
  if (filter === "pending") conditions.push("review_status = 'pending'");
  else if (filter === "approved") conditions.push("review_status = 'approved'");
  else if (filter === "rejected") conditions.push("review_status = 'rejected'");
  else if (["draft", "archived"].includes(filter)) { conditions.push("listing_status = ?"); bindings.push(filter); }
  const orderBy: Record<string, string> = {
    "updated-desc": "updated_at DESC",
    "name-asc": "name COLLATE NOCASE ASC, model_number COLLATE NOCASE ASC",
    "name-desc": "name COLLATE NOCASE DESC, model_number COLLATE NOCASE ASC",
    "price-asc": "unit_price_cents_ex_gst ASC, name COLLATE NOCASE ASC",
    "price-desc": "unit_price_cents_ex_gst DESC, name COLLATE NOCASE ASC",
  };
  const where = conditions.join(" AND ");
  const db = getD1();
  const [countRow, metrics, rows, options] = await Promise.all([
    db.prepare(`SELECT COUNT(*) total FROM supplier_products WHERE ${where}`).bind(...bindings).first<Record<string, unknown>>(),
    db.prepare(`SELECT COUNT(*) total,
      SUM(CASE WHEN listing_status = 'published' AND review_status = 'approved' THEN 1 ELSE 0 END) live,
      SUM(CASE WHEN review_status = 'pending' THEN 1 ELSE 0 END) pending,
      SUM(CASE WHEN stock_status IN ('in_stock', 'limited') THEN 1 ELSE 0 END) available
      FROM supplier_products WHERE firebase_uid = ?`).bind(firebaseUid).first<Record<string, unknown>>(),
    db.prepare(`SELECT * FROM supplier_products WHERE ${where} ORDER BY ${orderBy[sort] || orderBy["updated-desc"]} LIMIT ? OFFSET ?`)
      .bind(...bindings, pageSize, (page - 1) * pageSize).all<Record<string, unknown>>(),
    db.prepare(`SELECT id, model_number, brand, name, listing_status FROM supplier_products
      WHERE firebase_uid = ? AND listing_status <> 'archived' ORDER BY brand COLLATE NOCASE, model_number COLLATE NOCASE LIMIT 2000`)
      .bind(firebaseUid).all<Record<string, unknown>>(),
  ]);
  const ids = rows.results.map((row: Record<string, unknown>) => String(row.id));
  const links = ids.length ? await db.prepare(`SELECT l.id, l.product_id, l.linked_product_id, l.relationship, l.default_qty, l.note,
      p.model_number linked_model_number, p.name linked_name
      FROM supplier_product_links l JOIN supplier_products p ON p.id = l.linked_product_id
      WHERE l.firebase_uid = ? AND l.product_id IN (${ids.map(() => "?").join(",")}) ORDER BY p.brand, p.name`)
    .bind(firebaseUid, ...ids).all<Record<string, unknown>>() : { results: [] as Record<string, unknown>[] };
  const total = Number(countRow?.total || 0);
  return {
    products: rows.results.map((row: Record<string, unknown>) => ({
      ...product(row),
      dependencies: links.results.filter((link: Record<string, unknown>) => link.product_id === row.id).map((link: Record<string, unknown>) => ({
        id: link.id, linkedProductId: link.linked_product_id, relationship: link.relationship,
        defaultQty: Number(link.default_qty), note: link.note,
        linkedModelNumber: link.linked_model_number, linkedName: link.linked_name,
      })),
    })),
    counts: { total: Number(metrics?.total || 0), live: Number(metrics?.live || 0), pending: Number(metrics?.pending || 0), available: Number(metrics?.available || 0) },
    productOptions: options.results.map((row: Record<string, unknown>) => ({ id: row.id, modelNumber: row.model_number, brand: row.brand, name: row.name, listingStatus: row.listing_status })),
    pagination: { page, pageSize, total, pageCount: Math.max(1, Math.ceil(total / pageSize)) },
  };
}

type DependencyInput = {
  linkedProductId: string;
  relationship: string;
  defaultQty: number;
  note: string;
};

type ModelDependencyInput = {
  linkedModelNumber: string;
  relationship: string;
  defaultQty: number;
  note: string;
};

function cleanModelDependencies(
  value: unknown,
  modelNumber: string,
): ModelDependencyInput[] | null {
  if (!Array.isArray(value) || value.length > 30)
    return value === undefined ? [] : null;
  const results: ModelDependencyInput[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== "object") return null;
    const record = item as Record<string, unknown>;
    const linkedModelNumber = text(record.linkedModelNumber, 100).toUpperCase();
    const relationship = text(record.relationship, 30);
    const defaultQty = integer(record.defaultQty, 1, 100000);
    const note = text(record.note, 300);
    const key = `${linkedModelNumber}:${relationship}`;
    if (
      !linkedModelNumber ||
      linkedModelNumber === modelNumber ||
      !RELATIONSHIPS.has(relationship) ||
      defaultQty === null ||
      seen.has(key)
    )
      return null;
    seen.add(key);
    results.push({ linkedModelNumber, relationship, defaultQty, note });
  }
  return results;
}

function cleanDependencies(
  value: unknown,
  productId: string,
): DependencyInput[] | null {
  if (!Array.isArray(value) || value.length > 30)
    return value === undefined ? [] : null;
  const results: DependencyInput[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== "object") return null;
    const record = item as Record<string, unknown>;
    const linkedProductId = text(record.linkedProductId, 180);
    const relationship = text(record.relationship, 30);
    const defaultQty = integer(record.defaultQty, 1, 100000);
    const note = text(record.note, 300);
    const key = `${linkedProductId}:${relationship}`;
    if (
      !linkedProductId ||
      linkedProductId === productId ||
      !RELATIONSHIPS.has(relationship) ||
      defaultQty === null ||
      seen.has(key)
    )
      return null;
    seen.add(key);
    results.push({ linkedProductId, relationship, defaultQty, note });
  }
  return results;
}

async function replaceDependencies(
  firebaseUid: string,
  productId: string,
  dependencies: DependencyInput[],
) {
  const db = getD1();
  if (dependencies.length) {
    const placeholders = dependencies.map(() => "?").join(",");
    const owned = await db
      .prepare(
        `SELECT id FROM supplier_products WHERE firebase_uid = ? AND id IN (${placeholders})`,
      )
      .bind(firebaseUid, ...dependencies.map((item) => item.linkedProductId))
      .all<{ id: string }>();
    if (
      owned.results.length !==
      new Set(dependencies.map((item) => item.linkedProductId)).size
    )
      throw new Error("DEPENDENCY_OWNERSHIP");
  }
  const now = new Date().toISOString();
  await db.batch([
    db
      .prepare(
        "DELETE FROM supplier_product_links WHERE firebase_uid = ? AND product_id = ?",
      )
      .bind(firebaseUid, productId),
    ...dependencies.map((item) =>
      db
        .prepare(
          `INSERT INTO supplier_product_links
      (id, firebase_uid, product_id, linked_product_id, relationship, default_qty, note, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          crypto.randomUUID(),
          firebaseUid,
          productId,
          item.linkedProductId,
          item.relationship,
          item.defaultQty,
          item.note,
          now,
          now,
        ),
    ),
  ]);
}

function cleanProduct(body: Record<string, unknown>) {
  const modelNumber = text(body.modelNumber, 100).toUpperCase();
  const brand = text(body.brand, 100);
  const name = text(body.name, 160);
  const category = text(body.category, 40);
  const description = text(body.description, 2000);
  const unitPriceCentsExGst = integer(body.unitPriceCentsExGst, 1, 100000000);
  const minOrderQty = integer(body.minOrderQty, 1, 100000);
  const orderIncrement = integer(body.orderIncrement, 1, 100000);
  const unitLabel = text(body.unitLabel, 30) || "each";
  const stockStatus = text(body.stockStatus, 30);
  const leadTimeDays = integer(body.leadTimeDays, 0, 3650);
  const warrantyYears = integer(body.warrantyYears, 0, 100);
  const datasheetUrl = text(body.datasheetUrl, 500);
  const listingStatus = text(body.listingStatus, 30) || "draft";
  if (
    !modelNumber ||
    !brand ||
    !name ||
    !CATEGORIES.has(category) ||
    description.length < 20 ||
    unitPriceCentsExGst === null ||
    minOrderQty === null ||
    orderIncrement === null ||
    !STOCK_STATUSES.has(stockStatus) ||
    leadTimeDays === null ||
    warrantyYears === null ||
    !LISTING_STATUSES.has(listingStatus)
  )
    return null;
  if (datasheetUrl) {
    try {
      if (new URL(datasheetUrl).protocol !== "https:") return null;
    } catch {
      return null;
    }
  }
  return {
    modelNumber,
    brand,
    name,
    category,
    description,
    unitPriceCentsExGst,
    minOrderQty,
    orderIncrement,
    unitLabel,
    stockStatus,
    leadTimeDays,
    warrantyYears,
    datasheetUrl,
    listingStatus,
  };
}

export async function GET(request: Request) {
  if (!sameOrigin(request))
    return json({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const identity = await supplierIdentity(request);
    return json({ ok: true, ...await cataloguePage(identity.uid, new URL(request.url)) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  if (!sameOrigin(request))
    return json({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const identity = await supplierIdentity(request);
    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return json({ ok: false, error: "Invalid product details." }, 400);
    }
    if (Array.isArray(body.products)) {
      if (!await accountHasFeature(identity.uid, "supplier", identity.billingStatus, "supplier_bulk_import")) {
        return json(
          { ok: false, error: "Bulk catalogue import is available with paid membership or an administrator feature grant." },
          403,
        );
      }
      if (!body.products.length || body.products.length > 100) {
        return json(
          {
            ok: false,
            error: "Import between 1 and 100 catalogue rows at a time.",
          },
          400,
        );
      }
      const sourceRows = body.products as unknown[];
      const rows = sourceRows.map((item) =>
        item && typeof item === "object"
          ? cleanProduct(item as Record<string, unknown>)
          : null,
      );
      const modelDependencies = sourceRows.map((item, index) =>
        item && typeof item === "object" && rows[index]
          ? cleanModelDependencies(
              (item as Record<string, unknown>).dependencies,
              rows[index]!.modelNumber,
            )
          : null,
      );
      const invalidRows = rows
        .map((item, index) =>
          item && modelDependencies[index] ? 0 : index + 2,
        )
        .filter(Boolean);
      if (invalidRows.length) {
        return json(
          {
            ok: false,
            error: `Check CSV row${invalidRows.length === 1 ? "" : "s"} ${invalidRows.slice(0, 10).join(", ")}. Required values, categories, pricing or order rules are invalid.`,
          },
          400,
        );
      }
      const db = getD1();
      const importedModels = new Set(rows.map((row) => row!.modelNumber));
      if (importedModels.size !== rows.length) {
        return json(
          {
            ok: false,
            error:
              "Each CSV row must use a unique model number. Combine linked items in the dependency columns.",
          },
          400,
        );
      }
      const existingModels = await db
        .prepare(
          "SELECT model_number FROM supplier_products WHERE firebase_uid = ?",
        )
        .bind(identity.uid)
        .all<{ model_number: string }>();
      const availableModels = new Set([
        ...existingModels.results.map((item: { model_number: string }) => item.model_number),
        ...importedModels,
      ]);
      const missingDependency = modelDependencies
        .flatMap((items, rowIndex) =>
          (items || []).map((item) => ({ item, rowIndex })),
        )
        .find(({ item }) => !availableModels.has(item.linkedModelNumber));
      if (missingDependency) {
        return json(
          {
            ok: false,
            error: `CSV row ${missingDependency.rowIndex + 2} links to model ${missingDependency.item.linkedModelNumber}, but that model is not in this file or catalogue.`,
          },
          400,
        );
      }
      const now = new Date().toISOString();
      const reviewStatus = identity.isSynthetic ? "approved" : "pending";
      const reviewNote = identity.isSynthetic ? "Synthetic walkthrough auto-approval" : "";
      await db.batch(
        rows.map((row) => {
          const values = row!;
          return db
            .prepare(
              `INSERT INTO supplier_products
              (id, firebase_uid, model_number, brand, name, category, description, unit_price_cents_ex_gst,
               min_order_qty, order_increment, unit_label, stock_status, lead_time_days, warranty_years, datasheet_url,
               listing_status, review_status, review_note, is_synthetic, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(firebase_uid, model_number) DO UPDATE SET
                brand = excluded.brand, name = excluded.name, category = excluded.category, description = excluded.description,
                unit_price_cents_ex_gst = excluded.unit_price_cents_ex_gst, min_order_qty = excluded.min_order_qty,
                order_increment = excluded.order_increment, unit_label = excluded.unit_label, stock_status = excluded.stock_status,
                lead_time_days = excluded.lead_time_days, warranty_years = excluded.warranty_years,
                datasheet_url = excluded.datasheet_url, listing_status = excluded.listing_status,
                review_status = excluded.review_status, review_note = excluded.review_note, updated_at = excluded.updated_at`,
            )
            .bind(
              crypto.randomUUID(),
              identity.uid,
              values.modelNumber,
              values.brand,
              values.name,
              values.category,
              values.description,
              values.unitPriceCentsExGst,
              values.minOrderQty,
              values.orderIncrement,
              values.unitLabel,
              values.stockStatus,
              values.leadTimeDays,
              values.warrantyYears,
              values.datasheetUrl,
              values.listingStatus,
              reviewStatus,
              reviewNote,
              identity.isSynthetic,
              now,
              now,
            );
        }),
      );
      const storedProducts = await db
        .prepare(
          "SELECT id, model_number FROM supplier_products WHERE firebase_uid = ?",
        )
        .bind(identity.uid)
        .all<{ id: string; model_number: string }>();
      const idByModel = new Map<string, string>(
        storedProducts.results.map((item: { id: string; model_number: string }) => [item.model_number, item.id]),
      );
      for (let index = 0; index < rows.length; index += 1) {
        const productId = idByModel.get(rows[index]!.modelNumber);
        if (!productId) throw new Error("IMPORTED_PRODUCT_MISSING");
        await replaceDependencies(
          identity.uid,
          productId,
          (modelDependencies[index] || []).map((item) => ({
            linkedProductId: idByModel.get(item.linkedModelNumber) || "",
            relationship: item.relationship,
            defaultQty: item.defaultQty,
            note: item.note,
          })),
        );
      }
      await createAdminNotification({
        eventKey: `supplier-catalogue-import:${identity.uid}:${now}`,
        eventType: "supplier.catalogue_imported",
        category: "catalogue",
        priority: "high",
        title: identity.isSynthetic ? "Synthetic catalogue import completed" : "Wholesaler catalogue import awaiting review",
        summary: identity.isSynthetic ? `${identity.businessName} imported ${rows.length} synthetic products for the protected walkthrough.` : `${identity.businessName} imported ${rows.length} products. Published items require catalogue approval before installers can select them.`,
        entityType: "trade_account",
        entityId: identity.uid,
        actorType: "supplier",
        actorUid: identity.uid,
        requiresAction: !identity.isSynthetic && rows.some((item) => item?.listingStatus === "published"),
        metadata: { productCount: rows.length },
        occurredAt: now,
      });
      return json(
        {
          ok: true,
          imported: rows.length,
          dependenciesImported: modelDependencies.reduce(
            (total, items) => total + (items?.length || 0),
            0,
          ),
          products: await catalogue(identity.uid),
        },
        201,
      );
    }
    const values = cleanProduct(body);
    if (!values)
      return json(
        {
          ok: false,
          error:
            "Complete the model, product, ex-GST price, order, stock, lead-time and description fields.",
        },
        400,
      );
    const id = crypto.randomUUID();
    const dependencies = cleanDependencies(body.dependencies, id);
    if (!dependencies)
      return json(
        {
          ok: false,
          error: "One or more linked product settings are invalid.",
        },
        400,
      );
    const now = new Date().toISOString();
    const reviewStatus = identity.isSynthetic ? "approved" : "pending";
    const reviewNote = identity.isSynthetic ? "Synthetic walkthrough auto-approval" : "";
    try {
      await getD1()
        .prepare(
          `INSERT INTO supplier_products
        (id, firebase_uid, model_number, brand, name, category, description, unit_price_cents_ex_gst,
         min_order_qty, order_increment, unit_label, stock_status, lead_time_days, warranty_years, datasheet_url,
         listing_status, review_status, review_note, is_synthetic, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          id,
          identity.uid,
          values.modelNumber,
          values.brand,
          values.name,
          values.category,
          values.description,
          values.unitPriceCentsExGst,
          values.minOrderQty,
          values.orderIncrement,
          values.unitLabel,
          values.stockStatus,
          values.leadTimeDays,
          values.warrantyYears,
          values.datasheetUrl,
          values.listingStatus,
          reviewStatus,
          reviewNote,
          identity.isSynthetic,
          now,
          now,
        )
        .run();
      await replaceDependencies(identity.uid, id, dependencies);
    } catch (error) {
      if (error instanceof Error && error.message === "DEPENDENCY_OWNERSHIP")
        return json(
          {
            ok: false,
            error: "Linked products must belong to this wholesaler catalogue.",
          },
          403,
        );
      return json(
        {
          ok: false,
          error: "That model number already exists in this catalogue.",
        },
        409,
      );
    }
    await createAdminNotification({
      eventKey: `supplier-product:${id}:${now}`,
      eventType: "supplier.product_created",
      category: "catalogue",
      priority: values.listingStatus === "published" ? "high" : "normal",
      title: identity.isSynthetic ? "Synthetic catalogue product added" : "Wholesaler product awaiting review",
      summary: identity.isSynthetic ? `${identity.businessName} added a synthetic product for the protected walkthrough.` : `${identity.businessName} added ${values.brand} ${values.name} to its catalogue.`,
      entityType: "supplier_product",
      entityId: id,
      actorType: "supplier",
      actorUid: identity.uid,
      requiresAction: !identity.isSynthetic && values.listingStatus === "published",
      metadata: { modelNumber: values.modelNumber, listingStatus: values.listingStatus },
      occurredAt: now,
    });
    return json({ ok: true, products: await catalogue(identity.uid) }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request) {
  if (!sameOrigin(request))
    return json({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const identity = await supplierIdentity(request);
    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return json({ ok: false, error: "Invalid product update." }, 400);
    }
    const id = text(body.id, 180);
    const values = cleanProduct(body);
    const dependencies = cleanDependencies(body.dependencies, id);
    if (!id || !values || !dependencies)
      return json(
        {
          ok: false,
          error: "Complete every required product and linked item field.",
        },
        400,
      );
    const now = new Date().toISOString();
    const reviewStatus = identity.isSynthetic ? "approved" : "pending";
    const reviewNote = identity.isSynthetic ? "Synthetic walkthrough auto-approval" : "";
    try {
      const result = await getD1()
        .prepare(
          `UPDATE supplier_products SET model_number = ?, brand = ?, name = ?, category = ?,
        description = ?, unit_price_cents_ex_gst = ?, min_order_qty = ?, order_increment = ?, unit_label = ?, stock_status = ?,
        lead_time_days = ?, warranty_years = ?, datasheet_url = ?, listing_status = ?, review_status = ?, review_note = ?, updated_at = ?
        WHERE id = ? AND firebase_uid = ?`,
        )
        .bind(
          values.modelNumber,
          values.brand,
          values.name,
          values.category,
          values.description,
          values.unitPriceCentsExGst,
          values.minOrderQty,
          values.orderIncrement,
          values.unitLabel,
          values.stockStatus,
          values.leadTimeDays,
          values.warrantyYears,
          values.datasheetUrl,
          values.listingStatus,
          reviewStatus,
          reviewNote,
          now,
          id,
          identity.uid,
        )
        .run();
      if (!result.meta.changes)
        return json({ ok: false, error: "Product not found." }, 404);
      await replaceDependencies(identity.uid, id, dependencies);
    } catch (error) {
      if (error instanceof Error && error.message === "DEPENDENCY_OWNERSHIP")
        return json(
          {
            ok: false,
            error: "Linked products must belong to this wholesaler catalogue.",
          },
          403,
        );
      return json(
        {
          ok: false,
          error:
            "The model number conflicts with another item in this catalogue.",
        },
        409,
      );
    }
    await createAdminNotification({
      eventKey: `supplier-product-update:${id}:${now}`,
      eventType: "supplier.product_updated",
      category: "catalogue",
      priority: values.listingStatus === "published" ? "high" : "normal",
      title: "Wholesaler product changed",
      summary: identity.isSynthetic ? `${identity.businessName} updated a synthetic walkthrough product.` : `${identity.businessName} updated ${values.brand} ${values.name}. The catalogue review was reset to pending.`,
      entityType: "supplier_product",
      entityId: id,
      actorType: "supplier",
      actorUid: identity.uid,
      requiresAction: !identity.isSynthetic && values.listingStatus === "published",
      metadata: { modelNumber: values.modelNumber, listingStatus: values.listingStatus },
      occurredAt: now,
    });
    return json({ ok: true, products: await catalogue(identity.uid) });
  } catch (error) {
    return errorResponse(error);
  }
}
