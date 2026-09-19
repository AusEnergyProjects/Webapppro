import { planPriceBookImport, validatePriceBookImportRows, type PriceBookImportExisting, type PriceBookImportPreview,
  type PriceBookImportRow } from "./trade-price-book-import.ts";

export class PriceBookImportError extends Error {
  status: number;
  preview?: PriceBookImportPreview;
  constructor(message: string, status = 400, preview?: PriceBookImportPreview) {
    super(message);
    this.status = status;
    this.preview = preview;
  }
}

type ImportDatabase = Pick<D1Database, "prepare" | "batch">;
type ImportRequest = { action: "preview" | "import"; rows: PriceBookImportRow[]; previewToken?: string; pricesIncludeGst?: boolean };
const snapshotColumns = ["id", "item_code", "name", "description", "item_type", "unit_label", "supplier_cost_cents_ex_gst",
  "sell_price_cents_ex_gst", "tax_code", "markup_basis_points", "margin_basis_points", "expected_duration_minutes",
  "required_skill", "supplier_name", "supplier_sku", "supplier_product_id", "record_status", "price_revision", "updated_at", "updated_by_uid"];

function chunks<T>(items: T[], size: number) {
  const output: T[][] = [];
  for (let index = 0; index < items.length; index += size) output.push(items.slice(index, index + size));
  return output;
}

async function snapshot(db: ImportDatabase, ownerUid: string) {
  const [items, account] = await Promise.all([
    db.prepare(`SELECT ${snapshotColumns.join(", ")} FROM trade_price_book_items WHERE firebase_uid = ? ORDER BY id`).bind(ownerUid).all<PriceBookImportExisting>(),
    db.prepare("SELECT capabilities FROM trade_accounts WHERE firebase_uid = ?").bind(ownerUid).first<{ capabilities: string }>(),
  ]);
  if (!account) throw new PriceBookImportError("The business price book is unavailable.", 403);
  const capabilitiesJson = String(account.capabilities || "[]");
  let capabilities: string[] = [];
  try {
    const value: unknown = JSON.parse(capabilitiesJson);
    if (Array.isArray(value)) capabilities = value.filter((item): item is string => typeof item === "string");
  } catch { /* No invalid saved skill may become an import permission. */ }
  return { existing: items.results, capabilities, capabilitiesJson };
}

function publicPreview(plan: ReturnType<typeof planPriceBookImport>, token: string): PriceBookImportPreview {
  return { token, counts: plan.counts, issues: plan.issues, canImport: plan.issues.length === 0,
    items: plan.changes.map(({ rowNumber, existing, input, status }) => ({ rowNumber, status, name: input.name,
      itemCode: existing?.item_code || "New item", before: existing ? { sellPriceCentsExGst: Number(existing.sell_price_cents_ex_gst),
        supplierCostCentsExGst: Number(existing.supplier_cost_cents_ex_gst) } : null,
      after: { sellPriceCentsExGst: input.sellPriceCentsExGst, supplierCostCentsExGst: input.supplierCostCentsExGst } })) };
}

/** Token binds the exact rows, tax interpretation and owner state shown in the preview. */
async function previewToken(ownerUid: string, request: ImportRequest, state: Awaited<ReturnType<typeof snapshot>>) {
  const bytes = new TextEncoder().encode(JSON.stringify({ version: 1, ownerUid, rows: request.rows,
    pricesIncludeGst: request.pricesIncludeGst === true, existing: state.existing, capabilities: state.capabilitiesJson }));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function importPriceBook(db: ImportDatabase, ownerUid: string, actorUid: string, raw: Record<string, unknown>) {
  if (raw.action !== "preview" && raw.action !== "import") throw new PriceBookImportError("Choose preview or import.");
  if (raw.pricesIncludeGst !== undefined && typeof raw.pricesIncludeGst !== "boolean") throw new PriceBookImportError("Check whether the spreadsheet prices include GST.");
  let rows: PriceBookImportRow[];
  try { rows = validatePriceBookImportRows(raw.rows); }
  catch (error) { throw new PriceBookImportError(error instanceof Error ? error.message : "Check the spreadsheet rows."); }
  const request: ImportRequest = { action: raw.action, rows, previewToken: typeof raw.previewToken === "string" ? raw.previewToken : undefined,
    pricesIncludeGst: raw.pricesIncludeGst === true };
  const state = await snapshot(db, ownerUid);
  const plan = planPriceBookImport(rows, state.existing, state.capabilities, request.pricesIncludeGst);
  const token = await previewToken(ownerUid, request, state);
  const preview = publicPreview(plan, token);
  if (request.action === "preview") return { ok: true as const, preview };
  if (!request.previewToken || !/^[a-f0-9]{64}$/.test(request.previewToken)) throw new PriceBookImportError("Preview this spreadsheet before importing it.");
  if (!preview.canImport) throw new PriceBookImportError("Fix the listed spreadsheet rows, then preview the file again. No items have been changed.", 400, preview);
  // A repeat after a completed upload is a no-op, even when the successful response was lost.
  if (!plan.counts.added && !plan.counts.updated) return { ok: true as const, preview, imported: true };
  if (request.previewToken !== token) throw new PriceBookImportError("The price book changed after your preview. Preview the file again to see the latest prices. No items have been changed.", 409, preview);

  const now = new Date().toISOString();
  const changes = plan.changes.filter((item) => item.status !== "unchanged").map((change) => {
    const id = change.existing?.id || crypto.randomUUID();
    return { ...change.input, id, itemCode: change.existing?.item_code || `PB-${id.slice(0, 8).toUpperCase()}`,
      status: change.status, priceChanged: change.priceChanged,
      priceRevision: change.existing ? Number(change.existing.price_revision) + (change.priceChanged ? 1 : 0) : 1,
      historyId: crypto.randomUUID() };
  });
  const statements: D1PreparedStatement[] = [];
  // D1 batch is transactional. A failed assertion aborts every item and history write.
  // Chunk JSON parameters so the maximum input and saved optional fields remain below D1's value limit.
  statements.push(db.prepare(`SELECT CASE WHEN
    (SELECT COUNT(*) FROM trade_price_book_items WHERE firebase_uid = ?) = ?
    AND EXISTS (SELECT 1 FROM trade_accounts WHERE firebase_uid = ? AND COALESCE(capabilities, '[]') = ?)
    THEN 1 ELSE json('PRICE_BOOK_IMPORT_STALE') END AS valid`)
    .bind(ownerUid, state.existing.length, ownerUid, state.capabilitiesJson));
  for (const group of chunks(state.existing, 200)) {
    statements.push(db.prepare(`SELECT CASE WHEN NOT EXISTS (
      SELECT 1 FROM json_each(?) expected LEFT JOIN trade_price_book_items current
        ON current.id = json_extract(expected.value, '$.id') AND current.firebase_uid = ?
      WHERE current.id IS NULL OR ${snapshotColumns.map((column) => `current.${column} IS NOT json_extract(expected.value, '$.${column}')`).join(" OR ")}
    ) THEN 1 ELSE json('PRICE_BOOK_IMPORT_STALE') END AS valid`).bind(JSON.stringify(group), ownerUid));
  }
  for (const group of chunks(changes, 200)) {
    const json = JSON.stringify(group);
    statements.push(db.prepare(`UPDATE trade_price_book_items SET
      name = json_extract(imported.value, '$.name'), description = json_extract(imported.value, '$.description'),
      item_type = json_extract(imported.value, '$.itemType'), unit_label = json_extract(imported.value, '$.unitLabel'),
      supplier_cost_cents_ex_gst = json_extract(imported.value, '$.supplierCostCentsExGst'),
      sell_price_cents_ex_gst = json_extract(imported.value, '$.sellPriceCentsExGst'), tax_code = json_extract(imported.value, '$.taxCode'),
      markup_basis_points = json_extract(imported.value, '$.markupBasisPoints'), margin_basis_points = json_extract(imported.value, '$.marginBasisPoints'),
      expected_duration_minutes = json_extract(imported.value, '$.expectedDurationMinutes'), required_skill = json_extract(imported.value, '$.requiredSkill'),
      supplier_name = json_extract(imported.value, '$.supplierName'), supplier_sku = json_extract(imported.value, '$.supplierSku'),
      price_revision = json_extract(imported.value, '$.priceRevision'), updated_at = ?, updated_by_uid = ?
      FROM json_each(?) imported WHERE trade_price_book_items.id = json_extract(imported.value, '$.id')
        AND firebase_uid = ? AND record_status = 'active' AND json_extract(imported.value, '$.status') = 'updated'`)
      .bind(now, actorUid, json, ownerUid));
    statements.push(db.prepare(`INSERT INTO trade_price_book_items
      (id, firebase_uid, item_code, name, description, item_type, unit_label, supplier_cost_cents_ex_gst,
       sell_price_cents_ex_gst, tax_code, markup_basis_points, margin_basis_points, expected_duration_minutes,
       required_skill, supplier_name, supplier_sku, supplier_product_id, record_status, price_revision,
       created_by_uid, updated_by_uid, created_at, updated_at)
      SELECT json_extract(value, '$.id'), ?, json_extract(value, '$.itemCode'), json_extract(value, '$.name'),
       json_extract(value, '$.description'), json_extract(value, '$.itemType'), json_extract(value, '$.unitLabel'),
       json_extract(value, '$.supplierCostCentsExGst'), json_extract(value, '$.sellPriceCentsExGst'), json_extract(value, '$.taxCode'),
       json_extract(value, '$.markupBasisPoints'), json_extract(value, '$.marginBasisPoints'), json_extract(value, '$.expectedDurationMinutes'),
       json_extract(value, '$.requiredSkill'), json_extract(value, '$.supplierName'), json_extract(value, '$.supplierSku'), '', 'active', 1,
       ?, ?, ?, ? FROM json_each(?) WHERE json_extract(value, '$.status') = 'added'`)
      .bind(ownerUid, actorUid, actorUid, now, now, json));
    statements.push(db.prepare(`INSERT INTO trade_price_book_price_history
      (id, price_book_item_id, firebase_uid, price_revision, supplier_cost_cents_ex_gst, sell_price_cents_ex_gst,
       tax_code, markup_basis_points, margin_basis_points, change_type, changed_by_uid, changed_at)
      SELECT json_extract(value, '$.historyId'), json_extract(value, '$.id'), ?, json_extract(value, '$.priceRevision'),
       json_extract(value, '$.supplierCostCentsExGst'), json_extract(value, '$.sellPriceCentsExGst'), json_extract(value, '$.taxCode'),
       json_extract(value, '$.markupBasisPoints'), json_extract(value, '$.marginBasisPoints'),
       CASE WHEN json_extract(value, '$.status') = 'added' THEN 'created' ELSE 'price_updated' END, ?, ?
       FROM json_each(?) WHERE json_extract(value, '$.priceChanged') = 1`)
      .bind(ownerUid, actorUid, now, json));
  }
  try { await db.batch(statements); }
  catch (error) {
    // Re-read only to distinguish a concurrent change from an unrelated storage failure.
    const current = await snapshot(db, ownerUid);
    const currentPlan = planPriceBookImport(rows, current.existing, current.capabilities, request.pricesIncludeGst);
    if (!currentPlan.issues.length && !currentPlan.counts.added && !currentPlan.counts.updated) {
      return { ok: true as const, preview: publicPreview(currentPlan, await previewToken(ownerUid, request, current)), imported: true };
    }
    if (await previewToken(ownerUid, request, current) !== token) {
      throw new PriceBookImportError("The price book changed while this upload was saving. Preview the file again to check the latest items and prices.", 409);
    }
    throw error;
  }
  return { ok: true as const, preview, imported: true };
}
