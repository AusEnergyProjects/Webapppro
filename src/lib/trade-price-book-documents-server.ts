import { env } from "cloudflare:workers";
import { getD1 } from "../../db";
import type { TeamAccess } from "./trade-team-server";
import { assertProductDocumentOwner, inspectProductPdf, MAX_PRODUCT_DOCUMENTS, parseProductDocument, parseProductDocuments, productDocumentFileName, productDocumentId, productDocumentText, type TradeProductDocument } from "./trade-price-book-documents";

type Row = Record<string, unknown>;
type DocumentBucket = { put(key: string, bytes: ArrayBuffer, options: { httpMetadata: { contentType: string }; customMetadata: Record<string, string> }): Promise<unknown>; get(key: string): Promise<{ size: number; arrayBuffer(): Promise<ArrayBuffer> } | null>; delete(key: string): Promise<void> };
function bucket() {
  const value = (env as unknown as { EVIDENCE?: DocumentBucket }).EVIDENCE;
  if (!value) throw new Error("PRODUCT_DOCUMENT_UNAVAILABLE");
  return value;
}
async function hash(bytes: Uint8Array) {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes).buffer))].map(value => value.toString(16).padStart(2, "0")).join("");
}
export function assertProductDocumentAccess(access: TeamAccess, manage = false) {
  if (!access.isOwner && (!access.canViewPriceBook || (manage && !access.canManagePriceBook))) throw new Error("PRODUCT_DOCUMENT_ACCESS_REQUIRED");
}
async function ownedItem(ownerUid: string, itemId: unknown, active = false) {
  const id = productDocumentId(itemId);
  const row = await getD1().prepare(`SELECT id FROM trade_price_book_items WHERE id = ? AND firebase_uid = ? ${active ? "AND record_status = 'active'" : ""}`)
    .bind(id, ownerUid).first<Row>();
  if (!row) throw new Error("PRODUCT_DOCUMENT_NOT_FOUND");
  return id;
}
function reference(row: Row): TradeProductDocument {
  return parseProductDocument({ id: row.id, priceBookItemId: row.price_book_item_id, fileName: row.file_name, label: row.label, contentType: "application/pdf", sizeBytes: row.size_bytes, pageCount: row.page_count, sha256: row.sha256, objectKey: row.object_key, createdAt: row.created_at });
}
export async function listPriceBookDocuments(access: TeamAccess, rawItemId: unknown) {
  assertProductDocumentAccess(access);
  const itemId = await ownedItem(access.ownerUid, rawItemId);
  const rows = await getD1().prepare(`SELECT * FROM trade_price_book_documents WHERE owner_uid = ? AND price_book_item_id = ? AND record_status = 'active' ORDER BY created_at, id LIMIT ?`)
    .bind(access.ownerUid, itemId, MAX_PRODUCT_DOCUMENTS).all<Row>();
  return rows.results.map(reference);
}
export async function resolvePriceBookDocuments(ownerUid: string, itemIds: string[]): Promise<TradeProductDocument[]> {
  const ids = [...new Set(itemIds.map(productDocumentId))].sort();
  if (ids.length > 200) throw new Error("PRODUCT_DOCUMENT_LIMIT");
  if (!ids.length) return [];
  const documents: TradeProductDocument[] = [];
  // D1 permits 100 bound parameters per statement; keep room for the owner scope.
  for (let offset = 0; offset < ids.length; offset += 90) {
    const batch = ids.slice(offset, offset + 90);
    const rows = await getD1().prepare(`SELECT document.* FROM trade_price_book_documents document
      JOIN trade_price_book_items item ON item.id = document.price_book_item_id AND item.firebase_uid = document.owner_uid AND item.record_status = 'active'
      WHERE document.owner_uid = ? AND document.record_status = 'active' AND document.price_book_item_id IN (${batch.map(() => "?").join(",")}) ORDER BY document.price_book_item_id, document.created_at, document.id`)
      .bind(ownerUid, ...batch).all<Row>();
    documents.push(...rows.results.map(reference));
  }
  // The same brochure can belong to several selected products but is appended once.
  const uniqueDocuments = new Map<string, TradeProductDocument>();
  for (const document of documents) if (!uniqueDocuments.has(document.sha256)) uniqueDocuments.set(document.sha256, document);
  return parseProductDocuments([...uniqueDocuments.values()]);
}
export async function loadPriceBookDocument(raw: TradeProductDocument): Promise<{ bytes: Uint8Array }> {
  const document = parseProductDocument(raw), object = await bucket().get(document.objectKey);
  if (!object || object.size !== document.sizeBytes) throw new Error("PRODUCT_DOCUMENT_UNAVAILABLE");
  const bytes = new Uint8Array(await object.arrayBuffer());
  if (bytes.length !== document.sizeBytes || await hash(bytes) !== document.sha256) throw new Error("PRODUCT_DOCUMENT_UNAVAILABLE");
  const inspected = await inspectProductPdf(bytes);
  if (inspected.pageCount !== document.pageCount) throw new Error("PRODUCT_DOCUMENT_UNAVAILABLE");
  return { bytes };
}
export async function readPriceBookDocument(access: TeamAccess, rawItemId: unknown, rawDocumentId: unknown) {
  assertProductDocumentAccess(access);
  const itemId = await ownedItem(access.ownerUid, rawItemId), id = productDocumentId(rawDocumentId);
  const row = await getD1().prepare(`SELECT * FROM trade_price_book_documents WHERE id = ? AND owner_uid = ? AND price_book_item_id = ? AND record_status = 'active'`)
    .bind(id, access.ownerUid, itemId).first<Row>();
  if (!row) throw new Error("PRODUCT_DOCUMENT_NOT_FOUND");
  const document = reference(row); assertProductDocumentOwner(document, access.ownerUid);
  return { document, ...await loadPriceBookDocument(document) };
}
export async function uploadPriceBookDocument(access: TeamAccess, rawItemId: unknown, rawFileName: unknown, rawLabel: unknown, bytes: Uint8Array): Promise<TradeProductDocument> {
  assertProductDocumentAccess(access, true);
  const itemId = await ownedItem(access.ownerUid, rawItemId, true);
  const fileName = productDocumentFileName(rawFileName), label = productDocumentText(rawLabel || fileName.replace(/\.pdf$/i, ""));
  const { pageCount } = await inspectProductPdf(bytes), sha256 = await hash(bytes);
  const existing = await getD1().prepare(`SELECT * FROM trade_price_book_documents WHERE owner_uid = ? AND price_book_item_id = ? AND sha256 = ? AND record_status = 'active'`)
    .bind(access.ownerUid, itemId, sha256).first<Row>();
  if (existing) return reference(existing);
  const id = crypto.randomUUID(), now = new Date().toISOString();
  const objectKey = `trade-price-book-documents/${encodeURIComponent(access.ownerUid)}/${encodeURIComponent(itemId)}/${id}.pdf`;
  await bucket().put(objectKey, new Uint8Array(bytes).buffer, { httpMetadata: { contentType: "application/pdf" }, customMetadata: { ownerUid: access.ownerUid, priceBookItemId: itemId, sha256 } });
  // Never delete bytes after an uncertain database error; the insert may have committed.
  const inserted = await getD1().prepare(`INSERT OR IGNORE INTO trade_price_book_documents
    (id, owner_uid, price_book_item_id, file_name, label, size_bytes, page_count, sha256, object_key, record_status, created_by_uid, created_at, removed_at)
    SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ''
    WHERE EXISTS (SELECT 1 FROM trade_price_book_items WHERE id = ? AND firebase_uid = ? AND record_status = 'active')
      AND (SELECT COUNT(*) FROM trade_price_book_documents WHERE owner_uid = ? AND price_book_item_id = ? AND record_status = 'active') < ?`)
    .bind(id, access.ownerUid, itemId, fileName, label, bytes.length, pageCount, sha256, objectKey, access.actorUid, now, itemId, access.ownerUid, access.ownerUid, itemId, MAX_PRODUCT_DOCUMENTS).run();
  if (Number(inserted.meta.changes) !== 1) {
    // A definite no-op cannot be referenced by a quote, so this newly staged object can be removed.
    await bucket().delete(objectKey);
    const raced = await getD1().prepare(`SELECT * FROM trade_price_book_documents WHERE owner_uid = ? AND price_book_item_id = ? AND sha256 = ? AND record_status = 'active'`)
      .bind(access.ownerUid, itemId, sha256).first<Row>();
    if (raced) return reference(raced);
    await ownedItem(access.ownerUid, itemId, true);
    throw new Error("PRODUCT_DOCUMENT_PRODUCT_LIMIT");
  }
  return { id, priceBookItemId: itemId, fileName, label, contentType: "application/pdf", sizeBytes: bytes.length, pageCount, sha256, objectKey, createdAt: now };
}
export async function removePriceBookDocument(access: TeamAccess, rawItemId: unknown, rawDocumentId: unknown) {
  assertProductDocumentAccess(access, true);
  const itemId = await ownedItem(access.ownerUid, rawItemId), id = productDocumentId(rawDocumentId);
  const updated = await getD1().prepare(`UPDATE trade_price_book_documents SET record_status = 'removed', removed_at = ?
    WHERE id = ? AND owner_uid = ? AND price_book_item_id = ? AND record_status = 'active'`)
    .bind(new Date().toISOString(), id, access.ownerUid, itemId).run();
  if (Number(updated.meta.changes) !== 1) throw new Error("PRODUCT_DOCUMENT_NOT_FOUND");
  // Issued quote snapshots retain this immutable reference even after the product association is removed.
}
