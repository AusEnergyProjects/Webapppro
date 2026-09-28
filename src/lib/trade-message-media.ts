import { privateImageDimensions, sanitiseQuotingPhoto } from "./private-image-evidence";

export const MESSAGE_IMAGE_BYTES = 3 * 1024 * 1024;
export const MESSAGE_AUDIO_BYTES = 5 * 1024 * 1024;
export const MESSAGE_ATTACHMENT_LIMIT = 4;
export type MessageAttachment = { id: string; kind: "image" | "audio"; contentType: string; sizeBytes: number };
export type MessageMediaAuth = () => Promise<Record<string, string>>;

export function messageAttachmentIds(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > MESSAGE_ATTACHMENT_LIMIT || value.some(id => typeof id !== "string" || !/^[a-zA-Z0-9-]{16,80}$/.test(id)) || new Set(value).size !== value.length) {
    throw new Error("MESSAGE_ATTACHMENTS_INVALID");
  }
  return [...value].sort();
}

function ascii(bytes: Uint8Array, start: number, end: number) { return end - start > 64 ? "" : String.fromCharCode(...bytes.slice(start, end)); }

// Validate the container and audio track declarations. The browser decodes the
// recording; a filename or a supplied MIME type alone never establishes its type.
function webmAudio(bytes: Uint8Array) {
  const number = (start: number, end: number) => bytes.slice(start, end).reduce((n, b) => n * 256 + b, 0);
  const element = (offset: number, limit: number) => {
    if (offset >= limit) return null;
    let idSize = 1;
    while (idSize <= 4 && !(bytes[offset] & (0x80 >> (idSize - 1)))) idSize++;
    if (idSize > 4 || offset + idSize >= limit) return null;
    const id = number(offset, offset + idSize); offset += idSize;
    let sizeLength = 1;
    while (sizeLength <= 8 && !(bytes[offset] & (0x80 >> (sizeLength - 1)))) sizeLength++;
    if (sizeLength > 8 || offset + sizeLength > limit) return null;
    let size = bytes[offset] & (0xff >> sizeLength);
    let unknown = size === (0xff >> sizeLength);
    for (let i = 1; i < sizeLength; i++) { size = size * 256 + bytes[offset + i]; unknown = unknown && bytes[offset + i] === 0xff; }
    const start = offset + sizeLength, end = unknown ? limit : start + size;
    if (!Number.isSafeInteger(end) || end > limit) return null;
    return { id, start, end };
  };
  const header = element(0, bytes.length);
  if (!header || header.id !== 0x1a45dfa3) return false;
  let docType = false;
  for (let at = header.start; at < header.end;) {
    const item = element(at, header.end); if (!item) return false;
    if (item.id === 0x4282) docType = ascii(bytes, item.start, item.end) === "webm";
    at = item.end;
  }
  const segment = element(header.end, bytes.length);
  if (!docType || !segment || segment.id !== 0x18538067) return false;
  let audio = 0, data = false;
  for (let at = segment.start; at < segment.end;) {
    const item = element(at, segment.end); if (!item) return false;
    if (item.id === 0x1f43b675) data = item.end > item.start;
    if (item.id === 0x1654ae6b) {
      for (let trackAt = item.start; trackAt < item.end;) {
        const track = element(trackAt, item.end); if (!track || track.id !== 0xae) return false;
        let type = 0, codec = "";
        for (let fieldAt = track.start; fieldAt < track.end;) {
          const field = element(fieldAt, track.end); if (!field) return false;
          if (field.id === 0x83) { if (field.end - field.start !== 1) return false; type = number(field.start, field.end); }
          if (field.id === 0x86) codec = ascii(bytes, field.start, field.end);
          fieldAt = field.end;
        }
        if (type !== 2 || codec !== "A_OPUS") return false;
        audio++; trackAt = track.end;
      }
    }
    at = item.end;
  }
  return audio === 1 && data;
}

function oggAudio(bytes: Uint8Array) {
  let offset = 0, serial: number | null = null, sequence = 0, firstPacket = true, data = false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  while (offset < bytes.length) {
    if (offset + 27 > bytes.length || ascii(bytes, offset, offset + 4) !== "OggS" || bytes[offset + 4] !== 0) return false;
    const currentSerial = view.getUint32(offset + 14, true), currentSequence = view.getUint32(offset + 18, true);
    if (serial === null) serial = currentSerial;
    if (serial !== currentSerial || currentSequence !== sequence++) return false;
    const segments = bytes[offset + 26], start = offset + 27 + segments;
    if (start > bytes.length) return false;
    let size = 0; for (let i = offset + 27; i < start; i++) size += bytes[i];
    if (start + size > bytes.length) return false;
    if (firstPacket) {
      if (!(bytes[offset + 5] & 2) || size < 19 || ascii(bytes, start, start + 8) !== "OpusHead") return false;
      firstPacket = false;
    } else if (size && ascii(bytes, start, start + 8) !== "OpusTags") data = true;
    offset = start + size;
  }
  return !firstPacket && data;
}

function mp4Audio(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let ftyp = false, audio = 0, invalidTrack = false, data = false;
  function boxes(start: number, end: number, depth: number): boolean {
    if (depth > 8) return false;
    for (let offset = start; offset < end;) {
      if (offset + 8 > end) return false;
      let size = view.getUint32(offset), head = 8;
      const type = ascii(bytes, offset + 4, offset + 8);
      if (size === 1) {
        if (offset + 16 > end || view.getUint32(offset + 8) !== 0) return false;
        size = view.getUint32(offset + 12); head = 16;
      }
      if (size === 0) size = end - offset;
      if (size < head || offset + size > end) return false;
      const content = offset + head;
      if (type === "ftyp" && depth === 0 && size >= 16) ftyp = true;
      if (type === "mdat" && size > head) data = true;
      if (type === "hdlr" && size >= head + 12) {
        const handler = ascii(bytes, content + 8, content + 12);
        if (handler === "soun") audio++;
        else invalidTrack = true;
      }
      if (["moov", "trak", "mdia"].includes(type) && !boxes(content, offset + size, depth + 1)) return false;
      offset += size;
    }
    return true;
  }
  return boxes(0, bytes.length, 0) && ftyp && audio === 1 && !invalidTrack && data;
}

export function inspectMessageMedia(bytes: Uint8Array, suppliedType: string, avatar = false) {
  const contentType = suppliedType.toLowerCase().split(";")[0].trim();
  if (!bytes.length || bytes.length > (avatar || contentType.startsWith("image/") ? MESSAGE_IMAGE_BYTES : MESSAGE_AUDIO_BYTES)) throw new Error("MESSAGE_MEDIA_SIZE");
  if (contentType === "image/jpeg" || contentType === "image/png") {
    const dimensions = privateImageDimensions(bytes, contentType);
    if (!dimensions || Math.max(dimensions.width, dimensions.height) > (avatar ? 512 : 2400)) throw new Error("MESSAGE_IMAGE_INVALID");
    const cleaned = sanitiseQuotingPhoto(bytes, contentType);
    if (!cleaned) throw new Error("MESSAGE_IMAGE_INVALID");
    return { kind: "image" as const, contentType, bytes: cleaned };
  }
  if (!avatar && ((contentType === "audio/webm" && webmAudio(bytes)) || (contentType === "audio/ogg" && oggAudio(bytes)) || (contentType === "audio/mp4" && mp4Audio(bytes)))) {
    return { kind: "audio" as const, contentType, bytes };
  }
  throw new Error("MESSAGE_MEDIA_TYPE");
}
