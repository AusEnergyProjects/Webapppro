import { env } from "cloudflare:workers";
import { getD1 } from "../../db";
import { inspectProductPdf, productDocumentFileName } from "./trade-price-book-documents";
import { analyseStockReceipt } from "./trade-stock-receipt-ai";
import { matchReceiptLines, parseReceiptConfirmation, parseReceiptExtraction, type ReceiptExtraction, type ReceiptProduct, type StockReceipt } from "./trade-stock-receipts";
import { confirmStockReceipt } from "./trade-stock-receipt-confirm";
import { ensureTradeStockSchemaGuards } from "./trade-stock-schema-guards";
import { stockLocations } from "./trade-stock-server";

type Row = Record<string, unknown>;
const emptyExtraction: ReceiptExtraction = { supplier: "", reference: "", kind: "other", lines: [], warnings: [] };
type ReceiptBucket = { put(key: string, bytes: ArrayBuffer, options: { httpMetadata: { contentType: string }; customMetadata: Record<string, string> }): Promise<unknown>; get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null> };
function bucket() { const value = (env as unknown as { EVIDENCE?: ReceiptBucket }).EVIDENCE; if (!value) throw new Error("RECEIPT_STORAGE_UNAVAILABLE"); return value; }
async function products(ownerUid: string): Promise<ReceiptProduct[]> {
  const rows = await getD1().prepare(`SELECT p.id,p.name,p.item_code,p.supplier_sku,p.supplier_name,p.unit_label,s.revision FROM trade_price_book_items p JOIN trade_stock_items s ON s.item_id=p.id AND s.firebase_uid=p.firebase_uid WHERE p.firebase_uid=? AND p.record_status='active' AND s.tracked=1 AND p.item_type IN ('material','equipment') ORDER BY p.name LIMIT 5000`).bind(ownerUid).all<Row>();
  return rows.results.map(row => ({ id: String(row.id), name: String(row.name), code: String(row.item_code), sku: String(row.supplier_sku), supplier: String(row.supplier_name), unit: String(row.unit_label), revision: Number(row.revision) }));
}
export function publicStockReceipt(row: Row, catalogue: ReceiptProduct[]): StockReceipt {
  const extraction = row.extraction_json === "{}" ? emptyExtraction : parseReceiptExtraction(JSON.parse(String(row.extraction_json)));
  const result: StockReceipt = { id: String(row.id), fileName: String(row.file_name), status: row.status === "received" ? "received" : "review", extraction, lines: matchReceiptLines(extraction, catalogue), createdAt: String(row.created_at), receivedAt: String(row.received_at), analysisError: String(row.analysis_error) };
  if (row.status === "received") {
    const saved = JSON.parse(String(row.confirmation_json));
    const confirmation = parseReceiptConfirmation({ ...saved, confirmReceived: true });
    const itemDetails: { itemId: string; name: string; unit: string }[] = Array.isArray(saved.itemDetails) ? saved.itemDetails : [];
    result.confirmed = { supplier: confirmation.supplier, reference: confirmation.reference, locationId: confirmation.locationId,
      lines: confirmation.lines.map(line => { const details = itemDetails.find(item => item.itemId === line.itemId); return { itemId: line.itemId, name: details?.name || line.itemId, unit: details?.unit || "units", quantityMilli: line.quantityMilli }; }) };
    result.lines = result.confirmed.lines.map(line => ({ ...line, description: line.name, sku: "", quantity: line.quantityMilli / 1000 }));
  }
  return result;
}
export async function stockReceiptWorkspace(ownerUid: string, receiptId = "") {
  const db = getD1(), catalogue = await products(ownerUid);
  const rows = await db.prepare("SELECT * FROM trade_stock_receipts WHERE firebase_uid=? ORDER BY created_at DESC LIMIT 30").bind(ownerUid).all<Row>();
  const selected = receiptId ? await db.prepare("SELECT * FROM trade_stock_receipts WHERE id=? AND firebase_uid=?").bind(receiptId, ownerUid).first<Row>() : null;
  if (receiptId && !selected) throw new Error("RECEIPT_NOT_FOUND");
  return { products: catalogue, locations: await stockLocations(ownerUid), receipts: rows.results.map(row => publicStockReceipt(row, catalogue)), receipt: selected ? publicStockReceipt(selected, catalogue) : null };
}
export async function uploadStockReceipt(ownerUid: string, actorUid: string, rawName: unknown, bytes: Uint8Array) {
  const fileName = productDocumentFileName(rawName), inspected = await inspectProductPdf(bytes);
  if (inspected.pageCount > 20) throw new Error("RECEIPT_PAGE_LIMIT");
  const sha256 = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes).buffer))].map(value => value.toString(16).padStart(2, "0")).join("");
  const db = getD1(), existing = await db.prepare("SELECT id FROM trade_stock_receipts WHERE firebase_uid=? AND sha256=?").bind(ownerUid, sha256).first<{ id: string }>();
  if (existing) return stockReceiptWorkspace(ownerUid, existing.id);
  const id = crypto.randomUUID(), now = new Date().toISOString(), objectKey = `trade-stock-receipts/${encodeURIComponent(ownerUid)}/${id}.pdf`;
  // Claim the daily allowance before an AI request; concurrent uploads cannot evade it.
  const inserted = await db.prepare(`INSERT INTO trade_stock_receipts(id,firebase_uid,sha256,file_name,object_key,created_at,created_by_uid,analysis_error) SELECT ?,?,?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM trade_stock_receipts WHERE firebase_uid=? AND created_at>=?)<20 ON CONFLICT(firebase_uid,sha256) DO NOTHING RETURNING id`)
    .bind(id, ownerUid, sha256, fileName, objectKey, now, actorUid, "Reading document. You can enter the received items manually if reading is interrupted.", ownerUid, now.slice(0, 10)).first<{ id: string }>();
  if (!inserted) {
    const duplicate = await db.prepare("SELECT id FROM trade_stock_receipts WHERE firebase_uid=? AND sha256=?").bind(ownerUid, sha256).first<{ id: string }>();
    if (duplicate) return stockReceiptWorkspace(ownerUid, duplicate.id);
    throw new Error("RECEIPT_DAILY_LIMIT");
  }
  try { await bucket().put(objectKey, new Uint8Array(bytes).buffer, { httpMetadata: { contentType: "application/pdf" }, customMetadata: { ownerUid, sha256 } }); }
  catch (error) {
    await db.prepare("DELETE FROM trade_stock_receipts WHERE id=? AND firebase_uid=? AND status='review' AND extraction_json='{}'").bind(id, ownerUid).run();
    throw error;
  }
  try {
    const hostedKey: unknown = Reflect.get(env, "OPENAI_API_KEY");
    const extraction = await analyseStockReceipt(bytes, fileName, { apiKey: typeof hostedKey === "string" && hostedKey.trim() ? hostedKey.trim() : process.env.OPENAI_API_KEY || "" });
    await db.prepare("UPDATE trade_stock_receipts SET extraction_json=?,analysis_error='' WHERE id=? AND firebase_uid=? AND status='review'").bind(JSON.stringify(extraction), id, ownerUid).run();
  } catch {
    await db.prepare("UPDATE trade_stock_receipts SET analysis_error=? WHERE id=? AND firebase_uid=? AND status='review'").bind("AI could not read this document reliably. Select the products and enter quantities below, or receive stock manually.", id, ownerUid).run();
  }
  return stockReceiptWorkspace(ownerUid, id);
}
export async function receiveStockReceipt(ownerUid: string, actorUid: string, raw: unknown) {
  const input = parseReceiptConfirmation(raw);
  const document = await getD1().prepare("SELECT object_key FROM trade_stock_receipts WHERE id=? AND firebase_uid=?").bind(input.receiptId, ownerUid).first<{ object_key: string }>();
  if (!document) throw new Error("RECEIPT_NOT_FOUND");
  if (!await bucket().get(document.object_key)) throw new Error("RECEIPT_STORAGE_UNAVAILABLE");
  await ensureTradeStockSchemaGuards(getD1());
  return confirmStockReceipt(getD1(), ownerUid, actorUid, raw);
}
export async function readStockReceipt(ownerUid: string, id: string) {
  const row = await getD1().prepare("SELECT object_key,file_name FROM trade_stock_receipts WHERE id=? AND firebase_uid=?").bind(id, ownerUid).first<{ object_key: string; file_name: string }>();
  if (!row) throw new Error("RECEIPT_NOT_FOUND");
  const file = await bucket().get(row.object_key);
  if (!file) throw new Error("RECEIPT_NOT_FOUND");
  return { fileName: row.file_name, bytes: await file.arrayBuffer() };
}
