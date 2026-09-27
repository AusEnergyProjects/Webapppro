export const MAX_QUOTE_ROOF_IMAGE_BYTES = 4_000_000;
export const MAX_QUOTE_ROOF_IMAGE_DIMENSION = 4096;
export const MAX_QUOTE_ROOF_IMAGE_PIXELS = 12_000_000;

export type TradeQuoteRoofImage = {
  objectKey: string;
  contentType: "image/png";
  width: number;
  height: number;
  sizeBytes: number;
  sha256: string;
};

export function quoteRoofImageDimensions(bytes: Uint8Array) {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (bytes.length < 45 || bytes.length > MAX_QUOTE_ROOF_IMAGE_BYTES
    || signature.some((value, index) => bytes[index] !== value)
    || String.fromCharCode(...bytes.slice(12, 16)) !== "IHDR") {
    throw new Error("QUOTE_ROOF_IMAGE_INVALID");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16); const height = view.getUint32(20);
  if (view.getUint32(8) !== 13 || !width || !height
    || width > MAX_QUOTE_ROOF_IMAGE_DIMENSION || height > MAX_QUOTE_ROOF_IMAGE_DIMENSION
    || width * height > MAX_QUOTE_ROOF_IMAGE_PIXELS) throw new Error("QUOTE_ROOF_IMAGE_INVALID");
  let position = 8; let hasImageData = false; let ended = false;
  while (position + 12 <= bytes.length) {
    const length = view.getUint32(position);
    if (length > bytes.length - position - 12) throw new Error("QUOTE_ROOF_IMAGE_INVALID");
    const kind = String.fromCharCode(...bytes.slice(position + 4, position + 8));
    if (kind === "IDAT" && length > 0) hasImageData = true;
    position += length + 12;
    if (kind === "IEND") { ended = length === 0 && position === bytes.length; break; }
  }
  if (!hasImageData || !ended) throw new Error("QUOTE_ROOF_IMAGE_INVALID");
  return { width, height };
}

export function decodeQuoteRoofImage(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || !("dataUrl" in value) || typeof value.dataUrl !== "string"
    || Object.keys(value).some((key) => key !== "dataUrl")) throw new Error("QUOTE_ROOF_IMAGE_INVALID");
  const prefix = "data:image/png;base64,";
  const data = value.dataUrl;
  if (!data.startsWith(prefix) || data.length > prefix.length + Math.ceil(MAX_QUOTE_ROOF_IMAGE_BYTES / 3) * 4) {
    throw new Error("QUOTE_ROOF_IMAGE_INVALID");
  }
  const encoded = data.slice(prefix.length);
  if (encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) {
    throw new Error("QUOTE_ROOF_IMAGE_INVALID");
  }
  const bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
  return { bytes, ...quoteRoofImageDimensions(bytes) };
}

export function parseQuoteRoofImage(value: unknown): TradeQuoteRoofImage | null {
  if (value === undefined || value === null || value === "") return null;
  let candidate: unknown = value;
  if (typeof candidate === "string") {
    try { candidate = JSON.parse(candidate) as unknown; } catch { throw new Error("QUOTE_ROOF_IMAGE_INVALID"); }
  }
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) throw new Error("QUOTE_ROOF_IMAGE_INVALID");
  const row = candidate as Record<string, unknown>;
  if (typeof row.objectKey !== "string" || !/^trade-quote-roofs\/[^/]+\/[^/]+\/[^/]+\/[a-f0-9-]+\.png$/.test(row.objectKey)
    || row.objectKey.length > 800 || row.contentType !== "image/png"
    || typeof row.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(row.sha256)
    || !Number.isInteger(row.width) || !Number.isInteger(row.height)
    || Number(row.width) < 1 || Number(row.height) < 1
    || Number(row.width) > MAX_QUOTE_ROOF_IMAGE_DIMENSION || Number(row.height) > MAX_QUOTE_ROOF_IMAGE_DIMENSION
    || Number(row.width) * Number(row.height) > MAX_QUOTE_ROOF_IMAGE_PIXELS
    || !Number.isInteger(row.sizeBytes) || Number(row.sizeBytes) < 45 || Number(row.sizeBytes) > MAX_QUOTE_ROOF_IMAGE_BYTES) {
    throw new Error("QUOTE_ROOF_IMAGE_INVALID");
  }
  return { objectKey: row.objectKey, contentType: "image/png", width: Number(row.width), height: Number(row.height), sizeBytes: Number(row.sizeBytes), sha256: row.sha256 };
}

export function quoteRoofImageMetadata(value: unknown) {
  const image = parseQuoteRoofImage(value);
  return image ? { contentType: image.contentType, width: image.width, height: image.height, sha256: image.sha256 } : null;
}

export function assertQuoteRoofImageScope(image: TradeQuoteRoofImage | null | undefined, ownerUid: string, workOrderId: string) {
  if (image && !image.objectKey.startsWith(`trade-quote-roofs/${encodeURIComponent(ownerUid)}/${encodeURIComponent(workOrderId)}/`)) {
    throw new Error("QUOTE_ROOF_IMAGE_INVALID");
  }
}
