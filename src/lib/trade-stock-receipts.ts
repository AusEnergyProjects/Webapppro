export const MAX_RECEIPT_BYTES = 8 * 1024 * 1024;
export const MAX_RECEIPT_LINES = 50;
export type ReceiptLine = { description: string; sku: string; quantity: number; unit: string };
export type ReceiptExtraction = { supplier: string; reference: string; kind: "invoice" | "delivery_docket" | "purchase_order" | "other"; lines: ReceiptLine[]; warnings: string[] };
export type ReceiptProduct = { id: string; name: string; code: string; sku: string; supplier: string; unit: string; revision: number };
export type ReceiptReviewLine = ReceiptLine & { itemId: string; quantityMilli: number };
export type ReceiptConfirmedLine = { itemId: string; name: string; unit: string; quantityMilli: number };
export type StockReceipt = { id: string; fileName: string; status: "review" | "received"; extraction: ReceiptExtraction; lines: ReceiptReviewLine[]; createdAt: string; receivedAt: string; analysisError: string;
  confirmed?: { supplier: string; reference: string; locationId: string; lines: ReceiptConfirmedLine[] } };
export type ReceiptConfirmation = { receiptId: string; locationId: string; supplier: string; reference: string; lines: { itemId: string; quantityMilli: number; expectedRevision: number }[] };

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("RECEIPT_INVALID");
  return value as Record<string, unknown>;
}
function text(value: unknown, max: number) {
  if (typeof value !== "string" || value.length > max) throw new Error("RECEIPT_INVALID");
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").trim();
}
function id(value: unknown) { const result = text(value, 180); if (!/^[\w:-]+$/.test(result)) throw new Error("RECEIPT_INVALID"); return result; }
export function parseReceiptExtraction(raw: unknown): ReceiptExtraction {
  const value = object(raw);
  if (!["invoice", "delivery_docket", "purchase_order", "other"].includes(String(value.kind)) || !Array.isArray(value.lines) || value.lines.length > MAX_RECEIPT_LINES || !Array.isArray(value.warnings) || value.warnings.length > 10) throw new Error("RECEIPT_INVALID");
  const lines = value.lines.map(rawLine => {
    const line = object(rawLine), quantity = line.quantity;
    if (typeof quantity !== "number" || !Number.isFinite(quantity) || quantity <= 0 || quantity > 1_000_000 || !Number.isSafeInteger(Math.round(quantity * 1000)) || Math.abs(quantity * 1000 - Math.round(quantity * 1000)) > 0.00001) throw new Error("RECEIPT_INVALID");
    return { description: text(line.description, 240), sku: text(line.sku, 100), quantity, unit: text(line.unit, 40) };
  });
  return { supplier: text(value.supplier, 180), reference: text(value.reference, 120), kind: value.kind as ReceiptExtraction["kind"], lines, warnings: value.warnings.map(warning => text(warning, 300)) };
}
const matchText = (value: string) => value.trim().toLowerCase().replace(/\s+/g, " ");
function unitKey(value: string) {
  const aliases: Record<string, string> = { ea: "each", unit: "each", units: "each", item: "each", items: "each", pcs: "each", piece: "each", pieces: "each", rolls: "roll", packs: "pack", bags: "bag", m: "metre", metres: "metre", m2: "square_metre", "m²": "square_metre", sqm: "square_metre" };
  const key = matchText(value); return aliases[key] || key;
}
export function receiptQuantityMilli(value: string): number {
  if (!/^\d{1,7}(?:\.\d{1,3})?$/.test(value.trim())) throw new Error("RECEIPT_INVALID");
  const milli = Math.round(Number(value) * 1000);
  if (milli <= 0 || milli > 1_000_000_000) throw new Error("RECEIPT_INVALID");
  return milli;
}
export function matchReceiptLines(extraction: ReceiptExtraction, products: ReceiptProduct[]): ReceiptReviewLine[] {
  return extraction.lines.map(line => {
    // Only exact, unique matches are preselected. Similar names and ambiguous supplier SKUs need a person.
    const candidates = products.filter(product => line.sku ? [product.sku, product.code].some(code => code && matchText(code) === matchText(line.sku)) : matchText(product.name) === matchText(line.description));
    const supplierMatches = candidates.filter(product => product.supplier && matchText(product.supplier) === matchText(extraction.supplier));
    const matches = supplierMatches.length ? supplierMatches : candidates;
    const selected = matches.length === 1 && line.unit && unitKey(matches[0].unit) === unitKey(line.unit) ? matches[0] : null;
    return { ...line, itemId: selected?.id || "", quantityMilli: Math.round(line.quantity * 1000) };
  });
}
export function parseReceiptConfirmation(raw: unknown): ReceiptConfirmation {
  const value = object(raw);
  if (value.confirmReceived !== true || !Array.isArray(value.lines) || !value.lines.length || value.lines.length > MAX_RECEIPT_LINES) throw new Error("RECEIPT_INVALID");
  const lines = value.lines.map(rawLine => {
    const line = object(rawLine);
    if (typeof line.quantityMilli !== "number" || !Number.isSafeInteger(line.quantityMilli) || line.quantityMilli <= 0 || line.quantityMilli > 1_000_000_000 || typeof line.expectedRevision !== "number" || !Number.isSafeInteger(line.expectedRevision) || line.expectedRevision < 1) throw new Error("RECEIPT_INVALID");
    return { itemId: id(line.itemId), quantityMilli: line.quantityMilli, expectedRevision: line.expectedRevision };
  }).sort((a, b) => a.itemId.localeCompare(b.itemId));
  if (new Set(lines.map(line => line.itemId)).size !== lines.length) throw new Error("RECEIPT_DUPLICATE_PRODUCT");
  return { receiptId: id(value.receiptId), locationId: id(value.locationId), supplier: text(value.supplier, 180), reference: text(value.reference, 120), lines };
}

export const RECEIPT_JSON_SCHEMA = { type: "object", additionalProperties: false, required: ["supplier", "reference", "kind", "lines", "warnings"], properties: {
  supplier: { type: "string" }, reference: { type: "string" }, kind: { type: "string", enum: ["invoice", "delivery_docket", "purchase_order", "other"] },
  lines: { type: "array", items: { type: "object", additionalProperties: false, required: ["description", "sku", "quantity", "unit"], properties: { description: { type: "string" }, sku: { type: "string" }, quantity: { type: "number" }, unit: { type: "string" } } } },
  warnings: { type: "array", items: { type: "string" } },
} };
