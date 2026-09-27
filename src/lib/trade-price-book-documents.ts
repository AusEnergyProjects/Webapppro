export const MAX_PRODUCT_DOCUMENT_BYTES = 8 * 1024 * 1024;
export const MAX_PRODUCT_DOCUMENT_PAGES = 40;
export const MAX_PRODUCT_DOCUMENTS = 5;
export const MAX_QUOTE_PRODUCT_DOCUMENT_BYTES = 12 * 1024 * 1024;
export const MAX_QUOTE_PRODUCT_DOCUMENT_PAGES = 100;
export const MAX_QUOTE_PRODUCT_DOCUMENTS = 20;

/** Server-created immutable references. Object keys must never be accepted from a browser. */
export type TradeProductDocument = {
  id: string; priceBookItemId: string; fileName: string; label: string;
  contentType: "application/pdf"; sizeBytes: number; pageCount: number;
  sha256: string; objectKey: string; createdAt: string;
};
export type ProductDocumentMetadata = Omit<TradeProductDocument, "sha256" | "objectKey">;

export function productDocumentId(raw: unknown) {
  if (typeof raw !== "string" || !/^[a-zA-Z0-9_-]{1,180}$/.test(raw)) throw new Error("PRODUCT_DOCUMENT_INVALID");
  return raw;
}
export function productDocumentText(raw: unknown, maximum = 180) {
  if (typeof raw !== "string" || raw.length > maximum || !raw.trim() || /[\u0000-\u001f\u007f]/.test(raw)) throw new Error("PRODUCT_DOCUMENT_INVALID");
  return raw.trim();
}
export function productDocumentFileName(raw: unknown) {
  const name = productDocumentText(raw).replace(/[\\/]/g, " ");
  if (!/\.pdf$/i.test(name)) throw new Error("PRODUCT_DOCUMENT_INVALID");
  return name;
}
export function parseProductDocument(raw: unknown): TradeProductDocument {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("PRODUCT_DOCUMENT_INVALID");
  const value = raw as Record<string, unknown>;
  const id = productDocumentId(value.id), priceBookItemId = productDocumentId(value.priceBookItemId);
  if (value.contentType !== "application/pdf" || !Number.isInteger(value.sizeBytes) || Number(value.sizeBytes) < 8 || Number(value.sizeBytes) > MAX_PRODUCT_DOCUMENT_BYTES
    || !Number.isInteger(value.pageCount) || Number(value.pageCount) < 1 || Number(value.pageCount) > MAX_PRODUCT_DOCUMENT_PAGES
    || typeof value.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(value.sha256)
    || typeof value.objectKey !== "string" || value.objectKey.length > 800
    || !/^trade-price-book-documents\/[^/]+\/[^/]+\/[a-zA-Z0-9_-]+\.pdf$/.test(value.objectKey)
    || !value.objectKey.endsWith(`/${encodeURIComponent(priceBookItemId)}/${id}.pdf`)
    || typeof value.createdAt !== "string" || value.createdAt.length > 40 || !Number.isFinite(Date.parse(value.createdAt))) throw new Error("PRODUCT_DOCUMENT_INVALID");
  return { id, priceBookItemId, fileName: productDocumentFileName(value.fileName), label: productDocumentText(value.label), contentType: "application/pdf", sizeBytes: Number(value.sizeBytes), pageCount: Number(value.pageCount), sha256: value.sha256, objectKey: value.objectKey, createdAt: value.createdAt };
}
export function parseProductDocuments(raw: unknown): TradeProductDocument[] {
  if (typeof raw === "string") { try { raw = JSON.parse(raw); } catch { throw new Error("PRODUCT_DOCUMENT_INVALID"); } }
  if (!Array.isArray(raw) || raw.length > MAX_QUOTE_PRODUCT_DOCUMENTS) throw new Error("PRODUCT_DOCUMENT_LIMIT");
  const result = raw.map(parseProductDocument);
  if (new Set(result.map(item => item.id)).size !== result.length) throw new Error("PRODUCT_DOCUMENT_INVALID");
  if (result.reduce((sum, item) => sum + item.sizeBytes, 0) > MAX_QUOTE_PRODUCT_DOCUMENT_BYTES
    || result.reduce((sum, item) => sum + item.pageCount, 0) > MAX_QUOTE_PRODUCT_DOCUMENT_PAGES) throw new Error("PRODUCT_DOCUMENT_LIMIT");
  return result;
}
export function productDocumentMetadata(raw: TradeProductDocument): ProductDocumentMetadata {
  const value = parseProductDocument(raw);
  return { id: value.id, priceBookItemId: value.priceBookItemId, fileName: value.fileName, label: value.label, contentType: value.contentType, sizeBytes: value.sizeBytes, pageCount: value.pageCount, createdAt: value.createdAt };
}
export function assertProductDocumentOwner(reference: TradeProductDocument, ownerUid: string) {
  const parsed = parseProductDocument(reference);
  if (!ownerUid || !parsed.objectKey.startsWith(`trade-price-book-documents/${encodeURIComponent(ownerUid)}/`)) throw new Error("PRODUCT_DOCUMENT_NOT_FOUND");
}

/** Counts real PDF pages; forms must be flattened by their author before attaching. */
export async function inspectProductPdf(bytes: Uint8Array): Promise<{ pageCount: number }> {
  if (bytes.length < 8 || bytes.length > MAX_PRODUCT_DOCUMENT_BYTES || new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-") throw new Error("PRODUCT_DOCUMENT_INVALID");
  try {
    const { PDFDocument } = await import("pdf-lib");
    const pdf = await PDFDocument.load(bytes, { ignoreEncryption: false, throwOnInvalidObject: true, updateMetadata: false });
    if (pdf.isEncrypted) throw new Error("PRODUCT_DOCUMENT_INVALID");
    const pages = pdf.getPages();
    if (!pages.length || pages.length > MAX_PRODUCT_DOCUMENT_PAGES) throw new Error("PRODUCT_DOCUMENT_LIMIT");
    if (pdf.getForm().getFields().length) throw new Error("PRODUCT_DOCUMENT_FORM_UNSUPPORTED");
    for (const page of pages) {
      const { width, height } = page.getSize();
      if (![width, height].every(value => Number.isFinite(value) && value > 0 && value <= 14_400)) throw new Error("PRODUCT_DOCUMENT_INVALID");
    }
    return { pageCount: pages.length };
  } catch (error) {
    if (error instanceof Error && ["PRODUCT_DOCUMENT_LIMIT", "PRODUCT_DOCUMENT_FORM_UNSUPPORTED"].includes(error.message)) throw error;
    throw new Error("PRODUCT_DOCUMENT_INVALID");
  }
}
