import { GNAF_PREFIX, GNAF_MAX_MANIFEST_BYTES, GNAF_MAX_COMPRESSED_BYTES, parseGnafManifest, parseGnafShard, gnafSha256 } from "./gnaf-directory.ts";

export class GnafProvisionError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}
export const GNAF_VERIFY_BATCH = 250;
type StoredObject = { size: number; customMetadata?: Record<string, string>; arrayBuffer(): Promise<ArrayBuffer> };
export type GnafProvisionBucket = {
  get(key: string): Promise<StoredObject | null>;
  head(key: string): Promise<{ size: number; customMetadata?: Record<string, string> } | null>;
  put(key: string, bytes: Uint8Array, options: { onlyIf?: { etagDoesNotMatch: string }; customMetadata: Record<string, string> }): Promise<unknown>;
};

/** Maintenance access is version-scoped, time-limited and removed after activation. */
export async function gnafProvisionAuthorized(request: Request, env: Readonly<Record<string, unknown>>, now = Date.now()) {
  const secret = env.TLINK_GNAF_IMPORT_TOKEN, until = env.TLINK_GNAF_IMPORT_UNTIL, version = env.TLINK_GNAF_IMPORT_VERSION;
  const supplied = request.headers.get("authorization")?.replace(/^Bearer /, "") || "";
  const expiry = typeof until === "string" ? Date.parse(until) : NaN;
  if (typeof secret !== "string" || secret.length < 32 || supplied.length < 32 || supplied.length > 256
    || typeof version !== "string" || !/^[a-z0-9-]{1,60}$/.test(version)
    || !Number.isFinite(expiry) || expiry <= now || expiry > now + 24 * 60 * 60 * 1000) return false;
  const hashes = await Promise.all([secret, supplied].map(value => crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))));
  const a = new Uint8Array(hashes[0]), b = new Uint8Array(hashes[1]); let different = 0;
  for (let i = 0; i < a.length; i++) different |= a[i] ^ b[i];
  return different === 0;
}

export async function readGnafUpload(request: Request, maximum: number): Promise<Uint8Array> {
  if (Number(request.headers.get("content-length")) > maximum) throw new GnafProvisionError("Upload exceeds the size limit.", 413);
  const reader = request.body?.getReader(); if (!reader) throw new GnafProvisionError("Upload is empty.");
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) { const next = await reader.read(); if (next.done) break; size += next.value.length;
      if (size > maximum) { await reader.cancel(); throw new GnafProvisionError("Upload exceeds the size limit.", 413); }
      chunks.push(next.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}
function versionPrefix(version: string) {
  if (!/^[a-z0-9-]{1,60}$/.test(version)) throw new GnafProvisionError("Invalid directory version.");
  return `${GNAF_PREFIX}${version}/`;
}
async function immutablePut(bucket: GnafProvisionBucket, key: string, bytes: Uint8Array, metadata: Record<string, string>) {
  const previous = await bucket.head(key);
  if (previous) {
    if (previous.size === bytes.length && previous.customMetadata?.sha256 === metadata.sha256) return;
    throw new GnafProvisionError("This directory version already contains different data.", 409);
  }
  const saved = await bucket.put(key, bytes, { onlyIf: { etagDoesNotMatch: "*" }, customMetadata: metadata });
  if (!saved) {
    const raced = await bucket.head(key);
    if (raced?.size !== bytes.length || raced?.customMetadata?.sha256 !== metadata.sha256) throw new GnafProvisionError("Concurrent upload differs.", 409);
  }
}
export async function uploadGnafPart(bucket: GnafProvisionBucket, version: string, part: string, bytes: Uint8Array) {
  const prefix = versionPrefix(version), sha256 = await gnafSha256(bytes);
  let metadata: Record<string, string> = { sha256, version };
  if (part === "manifest.json") {
    let manifest;
    try { manifest = parseGnafManifest(bytes); }
    catch { throw new GnafProvisionError("Invalid directory manifest."); }
    if (manifest.version !== version) throw new GnafProvisionError("Manifest version differs.");
    metadata = { ...metadata, attribution: manifest.attribution };
  } else {
    if (!/^\d{4}\/[0-3]\.json\.gz$/.test(part) || bytes.length > GNAF_MAX_COMPRESSED_BYTES) throw new GnafProvisionError("Invalid directory partition.");
    let parsed;
    try { parsed = parseGnafShard(bytes, version, part); }
    catch { throw new GnafProvisionError("Invalid directory partition data."); }
    const { shard, decodedBytes } = parsed;
    metadata = { ...metadata, decodedBytes: String(decodedBytes), entries: String(Object.keys(shard.entries).length) };
  }
  await immutablePut(bucket, `${prefix}${part}`, bytes, metadata);
  return { sha256, bytes: bytes.length };
}
async function versionManifest(bucket: GnafProvisionBucket, version: string) {
  const source = await bucket.get(`${versionPrefix(version)}manifest.json`);
  if (!source || source.size > GNAF_MAX_MANIFEST_BYTES) throw new GnafProvisionError("Upload the directory manifest first.", 409);
  const bytes = new Uint8Array(await source.arrayBuffer()), manifest = parseGnafManifest(bytes);
  if (manifest.version !== version) throw new GnafProvisionError("Manifest version differs.");
  return { bytes, manifest, hash: await gnafSha256(bytes) };
}
export async function verifyGnafBatch(bucket: GnafProvisionBucket, version: string, offset: number) {
  const { manifest, hash } = await versionManifest(bucket, version), paths = Object.keys(manifest.shards).sort();
  if (!Number.isSafeInteger(offset) || offset < 0 || offset % GNAF_VERIFY_BATCH || offset >= paths.length) throw new GnafProvisionError("Invalid verification offset.");
  const batch = paths.slice(offset, offset + GNAF_VERIFY_BATCH);
  for (let start = 0; start < batch.length; start += 10) {
    await Promise.all(batch.slice(start, start + 10).map(async path => {
      const expected = manifest.shards[path], actual = await bucket.head(`${versionPrefix(version)}${path}`);
      if (!actual || actual.size !== expected.bytes || actual.customMetadata?.sha256 !== expected.sha256
        || actual.customMetadata?.decodedBytes !== String(expected.decodedBytes) || actual.customMetadata?.entries !== String(expected.entries)) {
        throw new GnafProvisionError(`Directory partition failed verification: ${path}`, 409);
      }
    }));
  }
  const receipt = new TextEncoder().encode(JSON.stringify({ hash, offset, count: batch.length }));
  await immutablePut(bucket, `${versionPrefix(version)}verified/${offset}.json`, receipt, { sha256: await gnafSha256(receipt), manifest: hash });
  return { verified: offset + batch.length, total: paths.length, nextOffset: offset + batch.length < paths.length ? offset + batch.length : null };
}
export async function activateGnafDirectory(bucket: GnafProvisionBucket, version: string) {
  const { bytes, manifest, hash } = await versionManifest(bucket, version), count = Object.keys(manifest.shards).length;
  for (let offset = 0; offset < count; offset += GNAF_VERIFY_BATCH) {
    const receipt = await bucket.get(`${versionPrefix(version)}verified/${offset}.json`);
    if (!receipt || receipt.size > 1024) throw new GnafProvisionError("Verify every directory partition before activation.", 409);
    const proof: unknown = JSON.parse(new TextDecoder().decode(await receipt.arrayBuffer()));
    if (!proof || typeof proof !== "object" || !("hash" in proof) || proof.hash !== hash
      || !("offset" in proof) || proof.offset !== offset || !("count" in proof) || proof.count !== Math.min(GNAF_VERIFY_BATCH, count - offset)) {
      throw new GnafProvisionError("Directory verification is incomplete.", 409);
    }
  }
  await bucket.put(`${GNAF_PREFIX}current.json`, bytes, { customMetadata: { sha256: hash, version, attribution: manifest.attribution } });
  return { version, records: manifest.recordCount, partitions: count };
}
