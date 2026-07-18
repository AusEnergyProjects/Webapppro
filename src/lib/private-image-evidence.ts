function joinBytes(parts: Uint8Array[]) {
  const output = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) { output.set(part, offset); offset += part.byteLength; }
  return output;
}

export function hasAllowedSignature(bytes: Uint8Array, contentType: string, allowPdf = true) {
  if (allowPdf && contentType === "application/pdf") return bytes.length >= 5
    && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d;
  if (contentType === "image/jpeg") return bytes.length >= 3
    && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (contentType === "image/png") return bytes.length >= 8
    && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((value, index) => bytes[index] === value);
  if (contentType === "image/webp") return bytes.length >= 12
    && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF"
    && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";
  return false;
}

function stripJpegMetadata(bytes: Uint8Array) {
  const parts = [bytes.slice(0, 2)];
  let offset = 2;
  while (offset < bytes.length) {
    if (bytes[offset] !== 0xff || offset + 1 >= bytes.length) return null;
    let markerOffset = offset + 1;
    while (bytes[markerOffset] === 0xff) markerOffset += 1;
    const marker = bytes[markerOffset];
    if (marker === 0xda || marker === 0xd9) { parts.push(bytes.slice(offset)); return joinBytes(parts); }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      parts.push(bytes.slice(offset, markerOffset + 1)); offset = markerOffset + 1; continue;
    }
    if (markerOffset + 2 >= bytes.length) return null;
    const length = (bytes[markerOffset + 1] << 8) | bytes[markerOffset + 2];
    const end = markerOffset + 1 + length;
    if (length < 2 || end > bytes.length) return null;
    if (!((marker >= 0xe1 && marker <= 0xef) || marker === 0xfe)) parts.push(bytes.slice(offset, end));
    offset = end;
  }
  return null;
}

function stripPngMetadata(bytes: Uint8Array) {
  const parts = [bytes.slice(0, 8)];
  const blocked = new Set(["eXIf", "iTXt", "tEXt", "zTXt", "tIME"]);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8;
  while (offset + 12 <= bytes.length) {
    const length = view.getUint32(offset);
    const end = offset + 12 + length;
    if (end > bytes.length) return null;
    const type = String.fromCharCode(...bytes.slice(offset + 4, offset + 8));
    if (!blocked.has(type)) parts.push(bytes.slice(offset, end));
    offset = end;
    if (type === "IEND") return joinBytes(parts);
  }
  return null;
}

function stripWebpMetadata(bytes: Uint8Array) {
  const parts = [bytes.slice(0, 12)];
  const blocked = new Set(["EXIF", "XMP ", "ICCP"]);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const size = view.getUint32(offset + 4, true);
    const end = offset + 8 + size + (size % 2);
    if (end > bytes.length) return null;
    const type = String.fromCharCode(...bytes.slice(offset, offset + 4));
    if (!blocked.has(type)) {
      const chunk = bytes.slice(offset, end);
      if (type === "VP8X" && chunk.length > 8) chunk[8] &= ~0x2c;
      parts.push(chunk);
    }
    offset = end;
  }
  const output = joinBytes(parts);
  new DataView(output.buffer).setUint32(4, output.byteLength - 8, true);
  return output;
}

export function sanitiseQuotingPhoto(bytes: Uint8Array, contentType: string) {
  if (contentType === "image/jpeg") return stripJpegMetadata(bytes);
  if (contentType === "image/png") return stripPngMetadata(bytes);
  if (contentType === "image/webp") return stripWebpMetadata(bytes);
  return null;
}
