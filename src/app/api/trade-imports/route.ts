import { getD1 } from "../../../../db";
import { requireFirebaseIdentity } from "@/lib/firebase-server";
import { adminJson, cleanAdminText, sameOrigin } from "@/lib/admin-server";
import { accountEntitlements } from "@/lib/direct-trade-entitlements-server";
import { createAdminNotification } from "@/lib/admin-notifications";
import { reserveTradeWorkNumbers } from "@/lib/trade-job-number-server";
import { IMPORT_DEFINITIONS, IMPORT_MAX_ROWS, validateImportCsv } from "@/lib/trade-data-imports.mjs";

export const runtime = "edge";

type ImportType = "customers" | "jobs" | "products";
type ImportIdentity = {
  uid: string;
  businessName: string;
  partnerType: "installer" | "supplier";
  canOperate: boolean;
  canBulkProducts: boolean;
};

const IMPORT_TYPES = new Set<ImportType>(["customers", "jobs", "products"]);
const ROLLBACK_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

async function importIdentity(request: Request): Promise<ImportIdentity> {
  const identity = await requireFirebaseIdentity(request);
  const account = await getD1().prepare(`SELECT partner_type, account_status, billing_status, business_name
    FROM trade_accounts WHERE firebase_uid = ?`).bind(identity.uid).first<Record<string, unknown>>();
  if (!account) throw new Error("PROFILE_REQUIRED");
  if (account.account_status !== "active") throw new Error("ACCOUNT_INACTIVE");
  const partnerType = String(account.partner_type) as "installer" | "supplier";
  if (!new Set(["installer", "supplier"]).has(partnerType)) throw new Error("ROLE_REQUIRED");
  const entitlements = await accountEntitlements(identity.uid, partnerType, account.billing_status);
  return {
    uid: identity.uid,
    partnerType,
    businessName: String(account.business_name || "Trade business"),
    canOperate: Boolean(entitlements.features.business_operations),
    canBulkProducts: Boolean(entitlements.features.supplier_bulk_import),
  };
}

function errorResponse(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  if (code === "AUTH_REQUIRED") return adminJson({ ok: false, error: "Sign in to continue." }, 401);
  if (code === "PROFILE_REQUIRED") return adminJson({ ok: false, error: "Complete the business profile first." }, 404);
  if (code === "ACCOUNT_INACTIVE") return adminJson({ ok: false, error: "This business account is not active." }, 403);
  if (code === "FULL_ACCESS_REQUIRED") return adminJson({ ok: false, error: "Complete trade verification before using guided data migration." }, 403);
  if (code === "IMPORT_TYPE_ROLE") return adminJson({ ok: false, error: "Choose a data type available to this business account." }, 403);
  if (code === "IMPORT_TYPE_INVALID") return adminJson({ ok: false, error: "Choose customers, historical jobs or wholesaler products." }, 400);
  if (code === "IMPORT_EMPTY") return adminJson({ ok: false, error: "The CSV needs a header row and at least one data row." }, 400);
  if (code === "IMPORT_TOO_LARGE") return adminJson({ ok: false, error: `Import up to ${IMPORT_MAX_ROWS} rows in one batch.` }, 400);
  if (code === "CSV_QUOTE_UNCLOSED") return adminJson({ ok: false, error: "A quoted CSV field is not closed. Check the file and try again." }, 400);
  if (code === "BATCH_NOT_FOUND") return adminJson({ ok: false, error: "Import batch not found." }, 404);
  if (code === "BATCH_NOT_PREVIEW") return adminJson({ ok: false, error: "This import has already moved beyond review." }, 409);
  if (code === "ROLLBACK_EXPIRED") return adminJson({ ok: false, error: "The seven-day rollback window has ended." }, 409);
  return adminJson({ ok: false, error: "The data migration request could not be completed." }, 500);
}

function parseList(value: unknown) {
  try {
    const parsed = JSON.parse(String(value || "[]"));
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

function batchPayload(row: Record<string, unknown>) {
  return {
    id: String(row.id), importType: String(row.import_type), fileName: String(row.file_name), rowCount: Number(row.row_count),
    readyCount: Number(row.ready_count), warningCount: Number(row.warning_count), duplicateCount: Number(row.duplicate_count),
    errorCount: Number(row.error_count), importedCount: Number(row.imported_count), skippedCount: Number(row.skipped_count),
    failedCount: Number(row.failed_count), status: String(row.status), committedAt: String(row.committed_at || ""),
    rollbackUntil: String(row.rollback_until || ""), rolledBackAt: String(row.rolled_back_at || ""),
    createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  };
}

function rowPayload(row: Record<string, unknown>) {
  return {
    id: String(row.id), rowNumber: Number(row.row_number), key: String(row.row_key), values: JSON.parse(String(row.normalized_data || "{}")),
    status: String(row.validation_status), issues: parseList(row.issues), resolution: String(row.resolution),
    resultStatus: String(row.result_status), targetEntityType: String(row.target_entity_type || ""),
    targetEntityId: String(row.target_entity_id || ""), error: String(row.error || ""),
  };
}

async function ownedBatch(uid: string, id: string) {
  const row = await getD1().prepare("SELECT * FROM trade_data_import_batches WHERE id = ? AND firebase_uid = ?")
    .bind(id, uid).first<Record<string, unknown>>();
  if (!row) throw new Error("BATCH_NOT_FOUND");
  return row;
}

async function runChunks(db: D1Database, statements: D1PreparedStatement[], size = 60) {
  for (let index = 0; index < statements.length; index += size) await db.batch(statements.slice(index, index + size));
}

async function duplicateContext(identity: ImportIdentity, importType: ImportType) {
  const db = getD1();
  const existingKeys = new Set<string>();
  const customerEmails = new Set<string>();
  if (importType === "customers" || importType === "jobs") {
    const customers = await db.prepare(`SELECT first_name, last_name, business_name, email, phone, postcode
      FROM trade_crm_customers WHERE firebase_uid = ? AND record_status = 'active'`).bind(identity.uid).all<Record<string, unknown>>();
    for (const customer of customers.results) {
      const email = String(customer.email || "").trim().toLowerCase();
      const phone = String(customer.phone || "").replace(/\D/g, "");
      if (email) customerEmails.add(email);
      if (importType === "customers") {
        const key = email ? `email:${email}` : phone ? `phone:${phone}` : `name:${[customer.first_name, customer.last_name, customer.business_name, customer.postcode].join(":").toLowerCase()}`;
        existingKeys.add(key);
      }
    }
  }
  if (importType === "jobs") {
    const jobs = await db.prepare(`SELECT w.title, w.scheduled_start, COALESCE(c.email, '') customer_email
      FROM trade_work_orders w LEFT JOIN trade_crm_job_details d ON d.work_order_id = w.id AND d.firebase_uid = w.firebase_uid
      LEFT JOIN trade_crm_customers c ON c.id = d.crm_customer_id AND c.firebase_uid = w.firebase_uid
      WHERE w.firebase_uid = ? AND w.partner_type = 'installer' AND w.record_status = 'active'`)
      .bind(identity.uid).all<Record<string, unknown>>();
    for (const job of jobs.results) existingKeys.add(`job:${String(job.title || "").toLowerCase()}:${String(job.customer_email || "").toLowerCase()}:${String(job.scheduled_start || "")}`);
  }
  if (importType === "products") {
    const products = await db.prepare("SELECT model_number FROM supplier_products WHERE firebase_uid = ?")
      .bind(identity.uid).all<{ model_number: string }>();
    for (const product of products.results) existingKeys.add(`model:${String(product.model_number).toLowerCase()}`);
  }
  return { existingKeys, customerEmails };
}

function assertImportAccess(identity: ImportIdentity, importType: ImportType) {
  if (!identity.canOperate) throw new Error("FULL_ACCESS_REQUIRED");
  const definition = IMPORT_DEFINITIONS[importType];
  if (!definition || !definition.roles.includes(identity.partnerType)) throw new Error("IMPORT_TYPE_ROLE");
  if (importType === "products" && !identity.canBulkProducts) throw new Error("FULL_ACCESS_REQUIRED");
}

export async function GET(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const identity = await importIdentity(request);
    if (!identity.canOperate) throw new Error("FULL_ACCESS_REQUIRED");
    const url = new URL(request.url);
    const batchId = cleanAdminText(url.searchParams.get("batchId"), 180);
    const db = getD1();
    const batches = await db.prepare(`SELECT * FROM trade_data_import_batches WHERE firebase_uid = ?
      ORDER BY created_at DESC LIMIT 20`).bind(identity.uid).all<Record<string, unknown>>();
    let rows: Record<string, unknown>[] = [];
    if (batchId) {
      await ownedBatch(identity.uid, batchId);
      rows = (await db.prepare("SELECT * FROM trade_data_import_rows WHERE batch_id = ? AND firebase_uid = ? ORDER BY row_number")
        .bind(batchId, identity.uid).all<Record<string, unknown>>()).results;
    }
    return adminJson({ ok: true, partnerType: identity.partnerType, batches: batches.results.map(batchPayload), rows: rows.map(rowPayload) });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const identity = await importIdentity(request);
    let body: Record<string, unknown>;
    try { body = await request.json() as Record<string, unknown>; }
    catch { return adminJson({ ok: false, error: "Invalid import request." }, 400); }
    const action = cleanAdminText(body.action, 40);
    if (action !== "preview" && action !== "commit") return adminJson({ ok: false, error: "Unsupported import action." }, 400);
    const db = getD1();

    if (action === "preview") {
      const importType = cleanAdminText(body.importType, 30) as ImportType;
      if (!IMPORT_TYPES.has(importType)) throw new Error("IMPORT_TYPE_INVALID");
      assertImportAccess(identity, importType);
      const source = typeof body.csvText === "string" ? body.csvText : "";
      if (new TextEncoder().encode(source).length > 2_000_000) return adminJson({ ok: false, error: "Choose a CSV smaller than 2 MB." }, 413);
      const context = await duplicateContext(identity, importType);
      const preview = validateImportCsv({ importType, source, ...context });
      if (preview.missingHeaders.length) return adminJson({ ok: false, error: `The CSV is missing: ${preview.missingHeaders.join(", ")}. Download the matching template and keep its header row.` }, 400);
      const now = new Date().toISOString();
      const batchId = crypto.randomUUID();
      const fileName = cleanAdminText(body.fileName, 160) || `${importType}.csv`;
      const fileSizeBytes = Math.max(0, Math.min(2_000_000, Number(body.fileSizeBytes || new TextEncoder().encode(source).length)));
      await db.prepare(`INSERT INTO trade_data_import_batches
        (id, firebase_uid, partner_type, import_type, file_name, file_size_bytes, row_count, ready_count, warning_count,
         duplicate_count, error_count, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'preview', ?, ?)`)
        .bind(batchId, identity.uid, identity.partnerType, importType, fileName, fileSizeBytes, preview.summary.total,
          preview.summary.ready, preview.summary.warning, preview.summary.duplicate, preview.summary.error, now, now).run();
      const statements = preview.rows.map((row) => db.prepare(`INSERT INTO trade_data_import_rows
        (id, batch_id, firebase_uid, row_number, row_key, normalized_data, validation_status, issues, resolution,
         result_status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`)
        .bind(crypto.randomUUID(), batchId, identity.uid, row.rowNumber, row.key, JSON.stringify(row.values), row.status,
          JSON.stringify(row.issues), row.resolution, now, now));
      await runChunks(db, statements);
      return adminJson({ ok: true, batch: batchPayload((await ownedBatch(identity.uid, batchId))), rows: (await db.prepare("SELECT * FROM trade_data_import_rows WHERE batch_id = ? ORDER BY row_number").bind(batchId).all<Record<string, unknown>>()).results.map(rowPayload) }, 201);
    }

    const batchId = cleanAdminText(body.batchId, 180);
    const batch = await ownedBatch(identity.uid, batchId);
    if (batch.status !== "preview") throw new Error("BATCH_NOT_PREVIEW");
    const importType = String(batch.import_type) as ImportType;
    assertImportAccess(identity, importType);
    const rows = (await db.prepare(`SELECT * FROM trade_data_import_rows WHERE batch_id = ? AND firebase_uid = ?
      ORDER BY row_number`).bind(batchId, identity.uid).all<Record<string, unknown>>()).results;
    const selected = rows.filter((row) => row.resolution === "import" && row.validation_status !== "error");
    if (!selected.length) return adminJson({ ok: false, error: "Choose at least one valid row to import." }, 400);
    const now = new Date().toISOString();
    const rollbackUntil = new Date(Date.now() + ROLLBACK_WINDOW_MS).toISOString();
    await db.prepare("UPDATE trade_data_import_batches SET status = 'committing', updated_at = ? WHERE id = ? AND firebase_uid = ?")
      .bind(now, batchId, identity.uid).run();
    try {
      const statements: D1PreparedStatement[] = [];
      if (importType === "customers") {
        for (const row of selected) {
          const values = JSON.parse(String(row.normalized_data)) as Record<string, unknown>;
          const id = crypto.randomUUID();
          const customerNumber = `CUS-${now.slice(2, 7).replace("-", "")}-${id.replaceAll("-", "").slice(0, 5).toUpperCase()}`;
          statements.push(db.prepare(`INSERT INTO trade_crm_customers
            (id, firebase_uid, customer_number, customer_type, first_name, last_name, business_name, email, phone,
             address_line_1, address_line_2, suburb, address_state, postcode, tags, private_notes, record_status, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`)
            .bind(id, identity.uid, customerNumber, values.customerType, values.firstName, values.lastName, values.businessName,
              values.email, values.phone, values.addressLine1, values.addressLine2, values.suburb, values.addressState, values.postcode,
              JSON.stringify(values.tags || []), values.privateNotes, now, now));
          statements.push(db.prepare(`UPDATE trade_data_import_rows SET result_status = 'imported', target_entity_type = 'crm_customer',
            target_entity_id = ?, updated_at = ? WHERE id = ? AND batch_id = ?`).bind(id, now, row.id, batchId));
        }
      } else if (importType === "jobs") {
        const numbers = await reserveTradeWorkNumbers(db, identity.uid, "JOB", selected.length, now);
        const customers = await db.prepare(`SELECT id, LOWER(email) email FROM trade_crm_customers
          WHERE firebase_uid = ? AND record_status = 'active' AND email != ''`).bind(identity.uid).all<{ id: string; email: string }>();
        const customerByEmail = new Map(customers.results.map((customer) => [customer.email, customer.id]));
        for (let index = 0; index < selected.length; index += 1) {
          const row = selected[index];
          const values = JSON.parse(String(row.normalized_data)) as Record<string, unknown>;
          const id = crypto.randomUUID();
          const detailId = crypto.randomUUID();
          const customerId = customerByEmail.get(String(values.customerEmail || "")) || "";
          statements.push(db.prepare(`INSERT INTO trade_work_orders
            (id, firebase_uid, partner_type, work_type, source_type, source_reference, work_number, title, service_category,
             site_area, stage, priority, scheduled_start, scheduled_end, assignee_label, revision, record_status, created_at, updated_at)
            VALUES (?, ?, 'installer', 'job', 'import', ?, ?, ?, ?, '', ?, ?, ?, ?, '', 1, 'active', ?, ?)`)
            .bind(id, identity.uid, batchId, numbers[index], values.title, values.serviceCategory, values.workStage, values.priority,
              values.scheduledStart, values.scheduledEnd, now, now));
          statements.push(db.prepare(`INSERT INTO trade_crm_job_details
            (id, work_order_id, firebase_uid, crm_customer_id, customer_source, pipeline_stage, description, customer_reference,
             next_action, tags, estimated_value_cents, quoted_value_cents, invoiced_value_cents, paid_value_cents, quote_status,
             invoice_status, payment_due_at, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, '', ?, ?, ?, 0, 0, 0, 'not_started', 'not_started', '', ?, ?)`)
            .bind(detailId, id, identity.uid, customerId, customerId ? "trade_owned" : "internal", values.pipelineStage,
              values.description, values.nextAction, JSON.stringify(values.tags || []), values.estimatedValueCents, now, now));
          statements.push(db.prepare(`INSERT INTO trade_work_order_events
            (id, work_order_id, firebase_uid, event_type, summary, created_at) VALUES (?, ?, ?, 'data_imported', ?, ?)`)
            .bind(crypto.randomUUID(), id, identity.uid, `${numbers[index]} imported from ${String(batch.file_name)}.`, now));
          statements.push(db.prepare(`UPDATE trade_data_import_rows SET result_status = 'imported', target_entity_type = 'work_order',
            target_entity_id = ?, updated_at = ? WHERE id = ? AND batch_id = ?`).bind(id, now, row.id, batchId));
        }
      } else {
        for (const row of selected) {
          const values = JSON.parse(String(row.normalized_data)) as Record<string, unknown>;
          const id = crypto.randomUUID();
          statements.push(db.prepare(`INSERT INTO supplier_products
            (id, firebase_uid, model_number, brand, name, category, description, unit_price_cents_ex_gst, min_order_qty,
             order_increment, unit_label, stock_status, lead_time_days, warranty_years, datasheet_url, listing_status,
             review_status, review_note, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', 'pending', 'Imported through guided migration and awaiting review.', ?, ?)`)
            .bind(id, identity.uid, values.modelNumber, values.brand, values.name, values.category, values.description,
              values.unitPriceCentsExGst, values.minOrderQty, values.orderIncrement, values.unitLabel, values.stockStatus,
              values.leadTimeDays, values.warrantyYears, values.datasheetUrl, now, now));
          statements.push(db.prepare(`UPDATE trade_data_import_rows SET result_status = 'imported', target_entity_type = 'supplier_product',
            target_entity_id = ?, updated_at = ? WHERE id = ? AND batch_id = ?`).bind(id, now, row.id, batchId));
        }
      }
      const skipped = rows.filter((row) => !selected.some((selectedRow) => selectedRow.id === row.id));
      for (const row of skipped) statements.push(db.prepare("UPDATE trade_data_import_rows SET result_status = 'skipped', updated_at = ? WHERE id = ? AND batch_id = ?").bind(now, row.id, batchId));
      await runChunks(db, statements);
      await db.prepare(`UPDATE trade_data_import_batches SET status = 'committed', imported_count = ?, skipped_count = ?,
        failed_count = 0, committed_at = ?, rollback_until = ?, updated_at = ? WHERE id = ? AND firebase_uid = ?`)
        .bind(selected.length, skipped.length, now, rollbackUntil, now, batchId, identity.uid).run();
      await createAdminNotification({
        eventKey: `trade-data-import:${batchId}`,
        eventType: `trade.${importType}_imported`, category: importType === "products" ? "catalogue" : "account",
        priority: importType === "products" ? "high" : "normal",
        title: importType === "products" ? "Imported wholesaler products awaiting review" : "Trade business completed a data import",
        summary: `${identity.businessName} imported ${selected.length} ${String(IMPORT_DEFINITIONS[importType].label).toLowerCase()} record${selected.length === 1 ? "" : "s"}.`,
        entityType: "trade_data_import", entityId: batchId, actorType: identity.partnerType, actorUid: identity.uid,
        requiresAction: importType === "products", metadata: { importType, importedCount: selected.length }, occurredAt: now,
      });
      return adminJson({ ok: true, batch: batchPayload(await ownedBatch(identity.uid, batchId)), rows: (await db.prepare("SELECT * FROM trade_data_import_rows WHERE batch_id = ? ORDER BY row_number").bind(batchId).all<Record<string, unknown>>()).results.map(rowPayload) });
    } catch (commitError) {
      await db.prepare("UPDATE trade_data_import_batches SET status = 'failed', failed_count = ?, updated_at = ? WHERE id = ? AND firebase_uid = ?")
        .bind(selected.length, new Date().toISOString(), batchId, identity.uid).run();
      throw commitError;
    }
  } catch (error) { return errorResponse(error); }
}

export async function PATCH(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const identity = await importIdentity(request);
    let body: Record<string, unknown>;
    try { body = await request.json() as Record<string, unknown>; }
    catch { return adminJson({ ok: false, error: "Invalid import update." }, 400); }
    const action = cleanAdminText(body.action, 40);
    const batchId = cleanAdminText(body.batchId, 180);
    const batch = await ownedBatch(identity.uid, batchId);
    assertImportAccess(identity, String(batch.import_type) as ImportType);
    const db = getD1();
    const now = new Date().toISOString();
    if (action === "resolve_row") {
      if (batch.status !== "preview") throw new Error("BATCH_NOT_PREVIEW");
      const rowId = cleanAdminText(body.rowId, 180);
      const resolution = cleanAdminText(body.resolution, 20);
      if (!new Set(["import", "skip"]).has(resolution)) return adminJson({ ok: false, error: "Choose import or skip." }, 400);
      const row = await db.prepare("SELECT validation_status FROM trade_data_import_rows WHERE id = ? AND batch_id = ? AND firebase_uid = ?")
        .bind(rowId, batchId, identity.uid).first<Record<string, unknown>>();
      if (!row) return adminJson({ ok: false, error: "Import row not found." }, 404);
      if (row.validation_status === "error" && resolution === "import") return adminJson({ ok: false, error: "Fix invalid rows in the source file and create a new preview." }, 409);
      if (batch.import_type === "products" && row.validation_status === "duplicate" && resolution === "import") return adminJson({ ok: false, error: "Keep the existing product, then update it from the catalogue screen if needed." }, 409);
      await db.prepare("UPDATE trade_data_import_rows SET resolution = ?, updated_at = ? WHERE id = ? AND batch_id = ? AND firebase_uid = ?")
        .bind(resolution, now, rowId, batchId, identity.uid).run();
      return adminJson({ ok: true, batch: batchPayload(batch), rows: (await db.prepare("SELECT * FROM trade_data_import_rows WHERE batch_id = ? ORDER BY row_number").bind(batchId).all<Record<string, unknown>>()).results.map(rowPayload) });
    }
    if (action !== "rollback") return adminJson({ ok: false, error: "Unsupported import update." }, 400);
    if (!new Set(["committed", "failed", "rollback_partial"]).has(String(batch.status))) return adminJson({ ok: false, error: "This batch cannot be rolled back." }, 409);
    if (batch.rollback_until && new Date(String(batch.rollback_until)).getTime() < Date.now()) throw new Error("ROLLBACK_EXPIRED");
    const importedRows = (await db.prepare(`SELECT * FROM trade_data_import_rows WHERE batch_id = ? AND firebase_uid = ?
      AND result_status IN ('imported', 'rollback_blocked') ORDER BY row_number DESC`).bind(batchId, identity.uid).all<Record<string, unknown>>()).results;
    let rolledBack = 0;
    let blocked = 0;
    for (const row of importedRows) {
      const type = String(row.target_entity_type || "");
      const id = String(row.target_entity_id || "");
      const table = type === "crm_customer" ? "trade_crm_customers" : type === "work_order" ? "trade_work_orders" : type === "supplier_product" ? "supplier_products" : "";
      if (!table || !id) continue;
      const target = await db.prepare(`SELECT updated_at FROM ${table} WHERE id = ? AND firebase_uid = ?`).bind(id, identity.uid).first<{ updated_at: string }>();
      if (!target) {
        await db.prepare("UPDATE trade_data_import_rows SET result_status = 'rolled_back', updated_at = ? WHERE id = ?").bind(now, row.id).run();
        rolledBack += 1;
        continue;
      }
      const unchangedThrough = String(batch.committed_at || batch.updated_at || "");
      if (String(target.updated_at || "") > unchangedThrough) {
        await db.prepare("UPDATE trade_data_import_rows SET result_status = 'rollback_blocked', error = 'Record changed after import.', updated_at = ? WHERE id = ?").bind(now, row.id).run();
        blocked += 1;
        continue;
      }
      if (type === "crm_customer") await db.prepare("UPDATE trade_crm_customers SET record_status = 'archived', updated_at = ? WHERE id = ? AND firebase_uid = ?").bind(now, id, identity.uid).run();
      if (type === "work_order") await db.prepare("UPDATE trade_work_orders SET record_status = 'archived', updated_at = ? WHERE id = ? AND firebase_uid = ?").bind(now, id, identity.uid).run();
      if (type === "supplier_product") await db.prepare("UPDATE supplier_products SET listing_status = 'archived', review_status = 'pending', review_note = 'Rolled back by the wholesaler.', updated_at = ? WHERE id = ? AND firebase_uid = ?").bind(now, id, identity.uid).run();
      await db.prepare("UPDATE trade_data_import_rows SET result_status = 'rolled_back', error = '', updated_at = ? WHERE id = ?").bind(now, row.id).run();
      rolledBack += 1;
    }
    const nextStatus = blocked ? "rollback_partial" : "rolled_back";
    await db.prepare("UPDATE trade_data_import_batches SET status = ?, rolled_back_at = ?, updated_at = ? WHERE id = ? AND firebase_uid = ?")
      .bind(nextStatus, now, now, batchId, identity.uid).run();
    return adminJson({ ok: true, rolledBack, blocked, batch: batchPayload(await ownedBatch(identity.uid, batchId)), rows: (await db.prepare("SELECT * FROM trade_data_import_rows WHERE batch_id = ? ORDER BY row_number").bind(batchId).all<Record<string, unknown>>()).results.map(rowPayload) });
  } catch (error) { return errorResponse(error); }
}
