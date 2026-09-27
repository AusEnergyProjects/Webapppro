import { env } from "cloudflare:workers";
import { PDFDocument } from "pdf-lib";
import { decodeQuoteRoofImage, parseQuoteRoofImage, quoteRoofImageDimensions, type TradeQuoteRoofImage } from "./trade-quote-roof-image";

type RoofImageBucket = {
  put(key: string, value: ArrayBuffer, options: { httpMetadata: { contentType: string }; customMetadata: Record<string, string> }): Promise<unknown>;
  get(key: string): Promise<{ size?: number; arrayBuffer(): Promise<ArrayBuffer> } | null>;
  delete(key: string): Promise<void>;
};

function bucket() {
  const result = (env as unknown as { EVIDENCE?: RoofImageBucket }).EVIDENCE;
  if (!result) throw new Error("QUOTE_ROOF_IMAGE_UNAVAILABLE");
  return result;
}

async function sha256(bytes: Uint8Array) {
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes).buffer);
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
}

export async function storeQuoteRoofImage(input: { ownerUid: string; workOrderId: string; versionId: string; upload: unknown }): Promise<TradeQuoteRoofImage> {
  const { bytes, width, height } = decodeQuoteRoofImage(input.upload);
  // Parse the full PNG before storing it, so broken image data never becomes a saved quote attachment.
  try { await (await PDFDocument.create()).embedPng(bytes); } catch { throw new Error("QUOTE_ROOF_IMAGE_INVALID"); }
  const hash = await sha256(bytes);
  const objectKey = `trade-quote-roofs/${encodeURIComponent(input.ownerUid)}/${encodeURIComponent(input.workOrderId)}/${encodeURIComponent(input.versionId)}/${crypto.randomUUID()}.png`;
  try {
    await bucket().put(objectKey, new Uint8Array(bytes).buffer, {
      httpMetadata: { contentType: "image/png" }, customMetadata: { ownerUid: input.ownerUid, workOrderId: input.workOrderId, versionId: input.versionId, sha256: hash },
    });
  } catch { throw new Error("QUOTE_ROOF_IMAGE_UNAVAILABLE"); }
  return { objectKey, contentType: "image/png", width, height, sizeBytes: bytes.byteLength, sha256: hash };
}

export async function loadQuoteRoofImage(reference: TradeQuoteRoofImage) {
  const image = parseQuoteRoofImage(reference);
  if (!image) throw new Error("QUOTE_ROOF_IMAGE_UNAVAILABLE");
  const object = await bucket().get(image.objectKey);
  if (!object || (object.size !== undefined && object.size !== image.sizeBytes)) throw new Error("QUOTE_ROOF_IMAGE_UNAVAILABLE");
  const bytes = new Uint8Array(await object.arrayBuffer());
  let dimensions: { width: number; height: number };
  try { dimensions = quoteRoofImageDimensions(bytes); } catch { throw new Error("QUOTE_ROOF_IMAGE_UNAVAILABLE"); }
  const { width, height } = dimensions;
  if (bytes.length !== image.sizeBytes || width !== image.width || height !== image.height || await sha256(bytes) !== image.sha256) {
    throw new Error("QUOTE_ROOF_IMAGE_UNAVAILABLE");
  }
  return { bytes, contentType: image.contentType };
}

export async function deleteUnclaimedQuoteRoofImage(image: TradeQuoteRoofImage) {
  await bucket().delete(image.objectKey);
}
