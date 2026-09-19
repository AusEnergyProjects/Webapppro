import { normalisePriceBookInput, PRICE_BOOK_ITEM_TYPES, PRICE_BOOK_UNITS } from "./trade-price-book.ts";
import { dollarsToCents } from "./trade-quote.ts";

export const PRICE_BOOK_IMPORT_MAX_ROWS = 2_000;
export const PRICE_BOOK_IMPORT_MAX_BODY_BYTES = 2 * 1024 * 1024;
export const PRICE_BOOK_IMPORT_FIELDS = ["name", "itemCode", "supplierSku", "supplierName", "sellPrice", "supplierCost",
  "itemType", "unitLabel", "taxCode", "description", "expectedDurationMinutes", "requiredSkill"] as const;
export type PriceBookImportField = typeof PRICE_BOOK_IMPORT_FIELDS[number];
export type PriceBookImportRow = { rowNumber: number; values: Partial<Record<PriceBookImportField, string | number>> };
export type PriceBookImportPrices = { sellPriceCentsExGst: number; supplierCostCentsExGst: number };
export type PriceBookImportPreview = {
  token: string;
  counts: { added: number; updated: number; unchanged: number; superseded: number };
  items: { rowNumber: number; status: "added" | "updated" | "unchanged"; name: string; itemCode: string;
    before: PriceBookImportPrices | null; after: PriceBookImportPrices }[];
  issues: { rowNumber: number; message: string }[];
  canImport: boolean;
};
export type PriceBookImportInput = ReturnType<typeof normalisePriceBookInput>;
export type PriceBookImportExisting = Record<string, unknown> & { id: string; item_code: string; name: string;
  supplier_name: string; supplier_sku: string; supplier_product_id: string; record_status: string };
export type PriceBookImportChange = { rowNumber: number; existing: PriceBookImportExisting | null; input: PriceBookImportInput;
  status: "added" | "updated" | "unchanged"; priceChanged: boolean };

export function priceBookImportIdentity(value: unknown) {
  return String(value ?? "").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-AU");
}

const limits: Record<PriceBookImportField, number> = { name: 140, itemCode: 100, supplierSku: 100, supplierName: 140,
  sellPrice: 40, supplierCost: 40, itemType: 30, unitLabel: 30, taxCode: 20, description: 500,
  expectedDurationMinutes: 10, requiredSkill: 80 };
const clean = (value: unknown, maximum: number) => String(value ?? "").replace(/[\u0000-\u001F\u007F]/g, " ").trim().slice(0, maximum);
const supplied = (value: unknown) => value !== undefined && value !== null && String(value).trim() !== "";
const inputColumns = {
  name: "name", description: "description", itemType: "item_type", unitLabel: "unit_label",
  supplierCostCentsExGst: "supplier_cost_cents_ex_gst", sellPriceCentsExGst: "sell_price_cents_ex_gst",
  taxCode: "tax_code", markupBasisPoints: "markup_basis_points", marginBasisPoints: "margin_basis_points",
  expectedDurationMinutes: "expected_duration_minutes", requiredSkill: "required_skill", supplierName: "supplier_name",
  supplierSku: "supplier_sku", supplierProductId: "supplier_product_id",
} as const;

function validationMessage(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  if (["INVALID_DECIMAL", "INVALID_MONEY"].includes(code)) return "Enter a valid cost and sell price with no more than two decimal places.";
  if (code === "INVALID_PRICE_BOOK_ADJUSTMENT") return "Discounts, rebates and certificate credits need a negative sell price and zero supplier cost.";
  if (code === "INVALID_PRICE_BOOK_NON_BILLABLE") return "Non-billable items need a sell price of zero.";
  if (code === "INVALID_PRICE_BOOK_SELL_PRICE") return "Enter a sell price greater than zero for this item type.";
  if (code === "INVALID_PRICE_BOOK_DURATION") return "Duration must be a whole number from 0 to 10,080 minutes.";
  return "Check the item name, type, unit, cost, sell price and GST setting.";
}

function matchingIndexes(existing: PriceBookImportExisting[]) {
  const code = new Map<string, PriceBookImportExisting[]>();
  const sku = new Map<string, PriceBookImportExisting[]>();
  const supplierSku = new Map<string, PriceBookImportExisting[]>();
  const name = new Map<string, PriceBookImportExisting[]>();
  const add = (map: Map<string, PriceBookImportExisting[]>, key: string, item: PriceBookImportExisting) => {
    if (key) map.set(key, [...(map.get(key) || []), item]);
  };
  for (const item of existing) {
    add(code, priceBookImportIdentity(item.item_code), item);
    add(name, priceBookImportIdentity(item.name), item);
    if (item.supplier_sku) {
      add(sku, priceBookImportIdentity(item.supplier_sku), item);
      add(supplierSku, JSON.stringify([priceBookImportIdentity(item.supplier_name), priceBookImportIdentity(item.supplier_sku)]), item);
    }
  }
  return { code, sku, supplierSku, name };
}

function matchingItem(values: PriceBookImportRow["values"], indexes: ReturnType<typeof matchingIndexes>) {
  const code = priceBookImportIdentity(values.itemCode);
  const sku = priceBookImportIdentity(values.supplierSku);
  const supplier = priceBookImportIdentity(values.supplierName);
  const name = priceBookImportIdentity(values.name);
  const skuMatches = sku ? (supplier ? indexes.supplierSku.get(JSON.stringify([supplier, sku])) : indexes.sku.get(sku)) || [] : [];
  let matches: PriceBookImportExisting[];
  if (code) {
    matches = indexes.code.get(code) || [];
    if (!matches.length) throw new Error("That TLink item code was not found in this business. Check the code, or leave it blank to add a new item.");
    const effectiveSupplier = supplier || priceBookImportIdentity(matches[0].supplier_name);
    const identifiedSkuMatches = sku ? indexes.supplierSku.get(JSON.stringify([effectiveSupplier, sku])) || [] : [];
    if (identifiedSkuMatches.some((item) => !matches.some((match) => match.id === item.id))) {
      throw new Error("The TLink item code and supplier SKU point to different items. Correct the identifiers before importing.");
    }
  } else if (skuMatches.length) {
    matches = skuMatches;
  } else {
    if (sku && supplier && (indexes.sku.get(sku) || []).some((item) => !item.supplier_name.trim())) {
      throw new Error("An item with this SKU has no saved supplier name. Add its TLink item code to update it, so the upload does not create a duplicate.");
    }
    matches = name ? (indexes.name.get(name) || []).filter((item) => !item.supplier_sku.trim()
      && (!supplier || !item.supplier_name.trim() || priceBookImportIdentity(item.supplier_name) === supplier)) : [];
    if (!sku && !matches.length && name && indexes.name.has(name)) {
      throw new Error("An item with this name already has a supplier SKU. Add its SKU or TLink item code to update it safely.");
    }
  }
  if (matches.length > 1) throw new Error("More than one item matches. Add the TLink item code, or the supplier name and SKU, to identify the item.");
  const match = matches[0] ?? null;
  if (match && match.record_status !== "active") throw new Error("This item is archived. Use a different item or manage the archived item before importing.");
  if (!match && !name) throw new Error("Enter a name for a new item, or a matching TLink item code or supplier SKU to update one.");
  return match;
}

function inputForRow(values: PriceBookImportRow["values"], existing: PriceBookImportExisting | null,
  capabilities: string[], pricesIncludeGst: boolean): PriceBookImportInput {
  const raw: Record<string, unknown> = existing ? {
    name: existing.name, description: existing.description, itemType: existing.item_type, unitLabel: existing.unit_label,
    supplierCost: (Number(existing.supplier_cost_cents_ex_gst) / 100).toFixed(2),
    sellPrice: (Number(existing.sell_price_cents_ex_gst) / 100).toFixed(2), taxCode: existing.tax_code,
    expectedDurationMinutes: existing.expected_duration_minutes, requiredSkill: existing.required_skill,
    supplierName: existing.supplier_name, supplierSku: existing.supplier_sku, supplierProductId: existing.supplier_product_id,
  } : { itemType: "material", unitLabel: "each", taxCode: "gst", supplierCost: "0", expectedDurationMinutes: "0" };
  for (const field of PRICE_BOOK_IMPORT_FIELDS) if (supplied(values[field])) raw[field] = values[field];
  if (!existing && !supplied(values.sellPrice)) throw new Error("A sell price is required for a new item. Existing items can be updated with just a cost and matching identifier.");
  if (raw.itemType && !PRICE_BOOK_ITEM_TYPES.includes(raw.itemType as typeof PRICE_BOOK_ITEM_TYPES[number])) throw new Error("Choose a recognised item type, such as Material, Labour or Call-out.");
  if (!PRICE_BOOK_UNITS.some(([unit]) => unit === raw.unitLabel)) throw new Error("Choose a recognised unit, such as Each, Hour or Visit.");
  if (!["gst", "none"].includes(String(raw.taxCode))) throw new Error("GST must be GST or None.");
  if (pricesIncludeGst && raw.taxCode === "gst") {
    for (const field of ["sellPrice", "supplierCost"] as const) if (supplied(values[field])) {
      const cents = dollarsToCents(raw[field], field === "sellPrice");
      const absolute = BigInt(Math.abs(cents));
      const exGst = Number((absolute * BigInt(10) + BigInt(5)) / BigInt(11)) * (cents < 0 ? -1 : 1);
      raw[field] = (exGst / 100).toFixed(2);
    }
  }
  const input = normalisePriceBookInput(raw, clean);
  if (input.requiredSkill && !capabilities.includes(input.requiredSkill)) throw new Error("Choose a required skill already listed on the business profile, or leave it blank for a new item.");
  if (existing?.supplier_product_id && (input.supplierCostCentsExGst !== Number(existing.supplier_cost_cents_ex_gst)
    || input.supplierName !== existing.supplier_name || input.supplierSku !== existing.supplier_sku)) {
    throw new Error("This item is linked to the approved supplier catalogue. Update its supplier details and cost through the catalogue, or leave these spreadsheet columns blank.");
  }
  return input;
}

/** Pure matching and validation used identically by preview and transactional import. */
export function planPriceBookImport(rows: PriceBookImportRow[], existing: PriceBookImportExisting[], capabilities: string[], pricesIncludeGst = false) {
  const issues: PriceBookImportPreview["issues"] = [];
  const changes = new Map<string, PriceBookImportChange>();
  const indexes = matchingIndexes(existing);
  let superseded = 0;
  for (const row of rows) {
    try {
      for (const field of PRICE_BOOK_IMPORT_FIELDS) {
        const value = row.values[field];
        if (value !== undefined && typeof value !== "string" && typeof value !== "number") throw new Error(`Check the ${field} value.`);
        if (supplied(value) && String(value).trim().length > limits[field]) throw new Error(`${field} is too long. Use no more than ${limits[field]} characters.`);
      }
      const match = matchingItem(row.values, indexes);
      const input = inputForRow(row.values, match, capabilities, pricesIncludeGst);
      const key = match ? `id:${match.id}` : input.supplierSku ? `sku:${JSON.stringify([priceBookImportIdentity(input.supplierName), priceBookImportIdentity(input.supplierSku)])}` : `name:${JSON.stringify([priceBookImportIdentity(input.name), priceBookImportIdentity(input.supplierName)])}`;
      const priceChanged = !match || Number(match.supplier_cost_cents_ex_gst) !== input.supplierCostCentsExGst
        || Number(match.sell_price_cents_ex_gst) !== input.sellPriceCentsExGst || match.tax_code !== input.taxCode;
      const status = !match ? "added" : Object.entries(inputColumns).some(([field, column]) => input[field as keyof typeof inputColumns] !== match[column]) ? "updated" : "unchanged";
      if (changes.has(key)) superseded++;
      changes.set(key, { rowNumber: row.rowNumber, existing: match, input, status, priceChanged });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Check this row.";
      issues.push({ rowNumber: row.rowNumber, message: message.startsWith("INVALID_") ? validationMessage(error) : message });
    }
  }
  const items = [...changes.values()].sort((a, b) => a.rowNumber - b.rowNumber);
  const newByName = new Map<string, PriceBookImportChange[]>();
  const newBySku = new Map<string, PriceBookImportChange[]>();
  for (const item of items) if (!item.existing) {
    const key = priceBookImportIdentity(item.input.name);
    newByName.set(key, [...(newByName.get(key) || []), item]);
    if (item.input.supplierSku) {
      const sku = priceBookImportIdentity(item.input.supplierSku);
      newBySku.set(sku, [...(newBySku.get(sku) || []), item]);
    }
  }
  for (const group of newByName.values()) {
    if (group.length > 1 && group.some((item) => !item.input.supplierSku)) {
      for (const item of group) issues.push({ rowNumber: item.rowNumber, message: "This upload repeats the same name with different identifiers. Use the same supplier and SKU on both rows, or give separate items different names." });
    }
  }
  for (const group of newBySku.values()) {
    if (group.length > 1 && group.some((item) => !item.input.supplierName)) {
      for (const item of group) issues.push({ rowNumber: item.rowNumber, message: "This SKU appears with and without a supplier name. Use consistent supplier names so the upload can identify duplicates safely." });
    }
  }
  // Two previously different identifiers must not become the same supplier/SKU after this upload.
  const finalSkuOwners = new Map<string, string>();
  const matchedIds = new Set(items.map((item) => item.existing?.id).filter(Boolean));
  for (const item of existing) {
    if (matchedIds.has(item.id)) continue;
    if (item.supplier_sku) finalSkuOwners.set(JSON.stringify([priceBookImportIdentity(item.supplier_name), priceBookImportIdentity(item.supplier_sku)]), item.id);
  }
  for (const item of items) {
    if (!item.input.supplierSku) continue;
    const key = JSON.stringify([priceBookImportIdentity(item.input.supplierName), priceBookImportIdentity(item.input.supplierSku)]);
    if (finalSkuOwners.has(key)) issues.push({ rowNumber: item.rowNumber, message: "This supplier and SKU would identify more than one item. Correct the duplicate identifiers before importing." });
    finalSkuOwners.set(key, item.existing?.id || `row:${item.rowNumber}`);
  }
  const counts = { added: items.filter((item) => item.status === "added").length, updated: items.filter((item) => item.status === "updated").length,
    unchanged: items.filter((item) => item.status === "unchanged").length, superseded };
  if (existing.length + counts.added > 5_000) issues.push({ rowNumber: 0, message: "This upload would exceed the business price-book limit of 5,000 items. Split or reduce the new items." });
  return { changes: items, counts, issues };
}

export function validatePriceBookImportRows(value: unknown): PriceBookImportRow[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > PRICE_BOOK_IMPORT_MAX_ROWS) throw new Error("Use a spreadsheet with 1 to 2,000 item rows.");
  const rowNumbers = new Set<number>();
  for (const row of value) {
    if (!row || typeof row !== "object" || !Number.isSafeInteger(row.rowNumber) || row.rowNumber < 1 || row.rowNumber > 1_048_576
      || rowNumbers.has(row.rowNumber) || !row.values || typeof row.values !== "object" || Array.isArray(row.values)) throw new Error("The spreadsheet rows could not be read. Upload the file again.");
    rowNumbers.add(row.rowNumber);
    if (Object.keys(row.values).some((key) => !PRICE_BOOK_IMPORT_FIELDS.includes(key as PriceBookImportField))) throw new Error("The spreadsheet contains an unsupported mapped field.");
  }
  return value;
}
