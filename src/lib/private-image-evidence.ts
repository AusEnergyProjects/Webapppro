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

export type PrivateImageDimensions = { width: number; height: number };

function jpegDimensions(bytes: Uint8Array): PrivateImageDimensions | null {
  if (!hasAllowedSignature(bytes, "image/jpeg", false)) return null;
  const startOfFrameMarkers = new Set([
    0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7,
    0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
  ]);
  let offset = 2;
  while (offset + 1 < bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    let markerOffset = offset + 1;
    while (markerOffset < bytes.length && bytes[markerOffset] === 0xff) markerOffset += 1;
    if (markerOffset >= bytes.length) return null;
    const marker = bytes[markerOffset];
    if (marker === 0xd9 || marker === 0xda) return null;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset = markerOffset + 1;
      continue;
    }
    if (markerOffset + 2 >= bytes.length) return null;
    const length = (bytes[markerOffset + 1] << 8) | bytes[markerOffset + 2];
    const end = markerOffset + 1 + length;
    if (length < 2 || end > bytes.length) return null;
    if (startOfFrameMarkers.has(marker)) {
      if (length < 8 || markerOffset + 7 >= end) return null;
      const height = (bytes[markerOffset + 4] << 8) | bytes[markerOffset + 5];
      const width = (bytes[markerOffset + 6] << 8) | bytes[markerOffset + 7];
      return width > 0 && height > 0 ? { width, height } : null;
    }
    offset = end;
  }
  return null;
}

function pngDimensions(bytes: Uint8Array): PrivateImageDimensions | null {
  if (!hasAllowedSignature(bytes, "image/png", false) || bytes.length < 33) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (
    view.getUint32(8) !== 13
    || String.fromCharCode(...bytes.slice(12, 16)) !== "IHDR"
  ) return null;
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  const bitDepth = bytes[24];
  const colourType = bytes[25];
  const validDepths = new Map<number, Set<number>>([
    [0, new Set([1, 2, 4, 8, 16])],
    [2, new Set([8, 16])],
    [3, new Set([1, 2, 4, 8])],
    [4, new Set([8, 16])],
    [6, new Set([8, 16])],
  ]);
  if (
    width <= 0
    || height <= 0
    || !validDepths.get(colourType)?.has(bitDepth)
    || bytes[26] !== 0
    || bytes[27] !== 0
    || (bytes[28] !== 0 && bytes[28] !== 1)
  ) return null;
  return { width, height };
}

function webpDimensions(bytes: Uint8Array): PrivateImageDimensions | null {
  if (!hasAllowedSignature(bytes, "image/webp", false) || bytes.length < 30) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(4, true) + 8 !== bytes.length) return null;
  const type = String.fromCharCode(...bytes.slice(12, 16));
  const size = view.getUint32(16, true);
  const dataOffset = 20;
  if (dataOffset + size > bytes.length) return null;
  if (type === "VP8X") {
    if (size < 10) return null;
    const width = 1 + bytes[dataOffset + 4]
      + (bytes[dataOffset + 5] << 8)
      + (bytes[dataOffset + 6] << 16);
    const height = 1 + bytes[dataOffset + 7]
      + (bytes[dataOffset + 8] << 8)
      + (bytes[dataOffset + 9] << 16);
    return { width, height };
  }
  if (type === "VP8L") {
    if (size < 5 || bytes[dataOffset] !== 0x2f) return null;
    const width = 1 + bytes[dataOffset + 1] + ((bytes[dataOffset + 2] & 0x3f) << 8);
    const height = 1
      + (bytes[dataOffset + 2] >> 6)
      + (bytes[dataOffset + 3] << 2)
      + ((bytes[dataOffset + 4] & 0x0f) << 10);
    return { width, height };
  }
  if (type === "VP8 ") {
    if (
      size < 10
      || bytes[dataOffset + 3] !== 0x9d
      || bytes[dataOffset + 4] !== 0x01
      || bytes[dataOffset + 5] !== 0x2a
    ) return null;
    const width = view.getUint16(dataOffset + 6, true) & 0x3fff;
    const height = view.getUint16(dataOffset + 8, true) & 0x3fff;
    return width > 0 && height > 0 ? { width, height } : null;
  }
  return null;
}

export function privateImageDimensions(
  bytes: Uint8Array,
  contentType: string,
): PrivateImageDimensions | null {
  if (contentType === "image/jpeg") return jpegDimensions(bytes);
  if (contentType === "image/png") return pngDimensions(bytes);
  if (contentType === "image/webp") return webpDimensions(bytes);
  return null;
}

function stripJpegMetadata(bytes: Uint8Array) {
  const parts = [bytes.slice(0, 2)];
  let offset = 2;
  while (offset < bytes.length) {
    if (bytes[offset] !== 0xff || offset + 1 >= bytes.length) return null;
    let markerOffset = offset + 1;
    while (bytes[markerOffset] === 0xff) markerOffset += 1;
    const marker = bytes[markerOffset];
    if (marker === 0xd9) {
      parts.push(bytes.slice(offset, markerOffset + 1));
      return joinBytes(parts);
    }
    if (marker === 0xda) {
      if (markerOffset + 2 >= bytes.length) return null;
      const length = (bytes[markerOffset + 1] << 8) | bytes[markerOffset + 2];
      const scanDataStart = markerOffset + 1 + length;
      if (length < 2 || scanDataStart > bytes.length) return null;
      parts.push(bytes.slice(offset, scanDataStart));
      let scanOffset = scanDataStart;
      while (scanOffset < bytes.length) {
        if (bytes[scanOffset] !== 0xff) {
          scanOffset += 1;
          continue;
        }
        let scanMarkerOffset = scanOffset + 1;
        while (scanMarkerOffset < bytes.length && bytes[scanMarkerOffset] === 0xff) {
          scanMarkerOffset += 1;
        }
        if (scanMarkerOffset >= bytes.length) return null;
        const scanMarker = bytes[scanMarkerOffset];
        if (scanMarker === 0x00 || (scanMarker >= 0xd0 && scanMarker <= 0xd7)) {
          scanOffset = scanMarkerOffset + 1;
          continue;
        }
        parts.push(bytes.slice(scanDataStart, scanOffset));
        if (scanMarker === 0xd9) {
          parts.push(bytes.slice(scanOffset, scanMarkerOffset + 1));
          return joinBytes(parts);
        }
        // A progressive JPEG can place more marker segments between scans.
        // Return to the segment parser so APP/COM metadata is removed there.
        offset = scanOffset;
        break;
      }
      if (scanOffset >= bytes.length) return null;
      continue;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      parts.push(bytes.slice(offset, markerOffset + 1)); offset = markerOffset + 1; continue;
    }
    if (markerOffset + 2 >= bytes.length) return null;
    const length = (bytes[markerOffset + 1] << 8) | bytes[markerOffset + 2];
    const end = markerOffset + 1 + length;
    if (length < 2 || end > bytes.length) return null;
    if (!((marker >= 0xe0 && marker <= 0xef) || marker === 0xfe)) parts.push(bytes.slice(offset, end));
    offset = end;
  }
  return null;
}

function stripPngMetadata(bytes: Uint8Array) {
  const parts = [bytes.slice(0, 8)];
  // Keep only chunks required to render the pixels. PNG permits arbitrary
  // ancillary/private chunks, so a denylist cannot support a
  // "metadata-stripped" privacy claim.
  const allowed = new Set(["IHDR", "PLTE", "IDAT", "IEND", "tRNS"]);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8;
  while (offset + 12 <= bytes.length) {
    const length = view.getUint32(offset);
    const end = offset + 12 + length;
    if (end > bytes.length) return null;
    const type = String.fromCharCode(...bytes.slice(offset + 4, offset + 8));
    if (allowed.has(type)) parts.push(bytes.slice(offset, end));
    offset = end;
    if (type === "IEND") return joinBytes(parts);
  }
  return null;
}

function stripWebpMetadata(bytes: Uint8Array) {
  if (bytes.length < 20) return null;
  const parts = [bytes.slice(0, 12)];
  // RIFF also permits arbitrary private chunks. Retain only chunks required
  // for still or animated WebP rendering.
  const allowed = new Set(["VP8 ", "VP8L", "VP8X", "ALPH"]);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(4, true) + 8 !== bytes.length) return null;
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const size = view.getUint32(offset + 4, true);
    const end = offset + 8 + size + (size % 2);
    if (end > bytes.length) return null;
    const type = String.fromCharCode(...bytes.slice(offset, offset + 4));
    // ANMF can contain nested arbitrary RIFF subchunks. Reject animated WebP
    // rather than claiming those nested bytes were metadata-stripped.
    if (type === "ANIM" || type === "ANMF") return null;
    if (allowed.has(type)) {
      const chunk = bytes.slice(offset, end);
      if (type === "VP8X" && chunk.length > 8) {
        if (chunk[8] & 0x02) return null;
        chunk[8] &= ~0x2c;
      }
      parts.push(chunk);
    }
    offset = end;
  }
  if (offset !== bytes.length) return null;
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
