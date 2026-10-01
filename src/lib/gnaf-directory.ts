import { gunzipSync } from "node:zlib";
import { gnafAddressKey, gnafShardForKey, type GnafEntry, type GnafManifest, type GnafShard } from "./gnaf-address.ts";

export const GNAF_MAX_COMPRESSED_BYTES = 2 * 1024 * 1024;
export const GNAF_MAX_DECODED_BYTES = 8 * 1024 * 1024;
export const GNAF_MAX_MANIFEST_BYTES = 8 * 1024 * 1024;
export const GNAF_PREFIX = "address-directory/";
export type GnafObject = { size: number; arrayBuffer(): Promise<ArrayBuffer> };
export type GnafBucketReader = { get(key: string): Promise<GnafObject | null> };
export type GnafMatch = { status: "located"; position: { lat: number; lng: number }; approximate: boolean; sourceId: string }
  | { status: "unlocated"; reason: "zero_results" | "invalid_address" | "ambiguous" };
export type GnafDirectory = { version: string; attribution: string; resolve(addresses: string[]): Promise<GnafMatch[]> };
export class GnafDirectoryUnavailableError extends Error {
  constructor() { super("The shared Australian address directory is not ready. Your records are safe; try again shortly."); this.name = "GnafDirectoryUnavailableError"; }
}
function object(value: unknown): value is Record<string, unknown> { return !!value && typeof value === "object" && !Array.isArray(value); }
export async function gnafSha256(bytes: Uint8Array): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes)))].map(b => b.toString(16).padStart(2, "0")).join("");
}
export function parseGnafManifest(bytes: Uint8Array): GnafManifest {
  if (bytes.length > GNAF_MAX_MANIFEST_BYTES) throw new GnafDirectoryUnavailableError();
  const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
  if (!object(value) || value.schema !== 1 || typeof value.version !== "string" || !/^[a-z0-9-]{1,60}$/.test(value.version)
    || typeof value.sourceUrl !== "string" || !/^https:\/\/data\.gov\.au\//.test(value.sourceUrl)
    || typeof value.sourceSha256 !== "string" || !/^[a-f0-9]{64}$/.test(value.sourceSha256)
    || typeof value.attribution !== "string" || !value.attribution.includes("G-NAF")
    || typeof value.datum !== "string" || typeof value.createdAt !== "string" || !Number.isFinite(Date.parse(value.createdAt))
    || typeof value.recordCount !== "number" || !Number.isSafeInteger(value.recordCount) || value.recordCount < 1
    || !object(value.shards) || Object.keys(value.shards).length === 0 || Object.keys(value.shards).length > 40_000) throw new GnafDirectoryUnavailableError();
  for (const [key, shard] of Object.entries(value.shards)) {
    if (!/^\d{4}\/[0-3]\.json\.gz$/.test(key) || !object(shard) || typeof shard.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(shard.sha256)
      || typeof shard.bytes !== "number" || !Number.isSafeInteger(shard.bytes) || shard.bytes < 1 || shard.bytes > GNAF_MAX_COMPRESSED_BYTES
      || typeof shard.decodedBytes !== "number" || !Number.isSafeInteger(shard.decodedBytes) || shard.decodedBytes < 1 || shard.decodedBytes > GNAF_MAX_DECODED_BYTES
      || typeof shard.entries !== "number" || !Number.isSafeInteger(shard.entries) || shard.entries < 1) throw new GnafDirectoryUnavailableError();
  }
  return value as GnafManifest;
}
function isEntry(value: unknown): value is GnafEntry {
  return value === null || (Array.isArray(value) && value.length === 4
    && typeof value[0] === "number" && Number.isFinite(value[0]) && value[0] >= -55 && value[0] <= -9
    && typeof value[1] === "number" && Number.isFinite(value[1]) && value[1] >= 96 && value[1] <= 169
    && typeof value[2] === "string" && /^[A-Za-z0-9_-]{1,80}$/.test(value[2]) && typeof value[3] === "string" && value[3].length <= 80);
}
function decodeGnafShard(bytes: Uint8Array, version: string, path: string) {
  if (bytes.length < 18 || bytes.length > GNAF_MAX_COMPRESSED_BYTES) throw new GnafDirectoryUnavailableError();
  // The trailer is untrusted. Native inflation enforces the hard output cap;
  // exact length is checked separately because Workerd's buffer growth can
  // reject valid gzip when maxOutputLength is set to an arbitrary exact size.
  const size = new DataView(bytes.buffer, bytes.byteOffset + bytes.length - 4, 4).getUint32(0, true);
  if (size < 1 || size > GNAF_MAX_DECODED_BYTES) throw new GnafDirectoryUnavailableError();
  const decoded = gunzipSync(bytes, { maxOutputLength: GNAF_MAX_DECODED_BYTES });
  if (decoded.length !== size) throw new GnafDirectoryUnavailableError();
  const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(decoded));
  if (!object(value) || value.schema !== 1 || value.version !== version || !object(value.entries)
    || typeof value.postcode !== "string" || typeof value.bucket !== "string"
    || `${value.postcode}/${value.bucket}.json.gz` !== path) throw new GnafDirectoryUnavailableError();
  return { shard: { schema: 1 as const, version, postcode: value.postcode, bucket: value.bucket, entries: value.entries }, decodedBytes: size };
}

/** Provisioning validates every entry before a partition can be activated. */
export function parseGnafShard(bytes: Uint8Array, version: string, path: string): { shard: GnafShard; decodedBytes: number } {
  const decoded = decodeGnafShard(bytes, version, path);
  for (const [key, entry] of Object.entries(decoded.shard.entries)) {
    if (key.length > 1000 || gnafAddressKey(key) !== key || gnafShardForKey(key) !== path || !isEntry(entry)) throw new GnafDirectoryUnavailableError();
  }
  return { shard: decoded.shard as GnafShard, decodedBytes: decoded.decodedBytes };
}

function lookupAddressKey(address: string): string | null {
  // Normalise explicit unit slashes after aliases such as FLAT become UNIT,
  // including units preceded by a building name. Keep the immutable directory
  // key format unchanged and preserve every unit, level and street component.
  return gnafAddressKey(address)?.replace(/\bUNIT ([A-Z]?\d+[A-Z]?)\s*\/\s*(\d)/g, "UNIT $1 $2") ?? null;
}

/** Each request reads only the postcode partitions needed for its bounded batch. */
export function createGnafDirectory(bucket: GnafBucketReader, manifest: GnafManifest): GnafDirectory {
  return { version: manifest.version, attribution: manifest.attribution, async resolve(addresses) {
    if (addresses.length > 200) throw new GnafDirectoryUnavailableError();
    const results: GnafMatch[] = addresses.map(() => ({ status: "unlocated", reason: "invalid_address" }));
    const groups = new Map<string, { key: string; index: number }[]>();
    addresses.forEach((address, index) => { const key = lookupAddressKey(address); if (!key) return;
      const shard = gnafShardForKey(key); const list = groups.get(shard) || []; list.push({ key, index }); groups.set(shard, list); });
    const partitions = [...groups];
    // Overlap storage latency, retaining at most four compressed bodies (8 MiB).
    // Decode and extract one partition at a time; never retain a batch of decoded maps.
    for (let offset = 0; offset < partitions.length; offset += 4) {
      const fetched = await Promise.allSettled(partitions.slice(offset, offset + 4).map(async ([path, items]) => {
        const expected = manifest.shards[path];
        if (!expected) return { path, items, expected, bytes: null };
        const source = await bucket.get(`${GNAF_PREFIX}${manifest.version}/${path}`);
        if (!source || source.size !== expected.bytes || source.size > GNAF_MAX_COMPRESSED_BYTES) throw new GnafDirectoryUnavailableError();
        const bytes = new Uint8Array(await source.arrayBuffer());
        if (bytes.length !== expected.bytes) throw new GnafDirectoryUnavailableError();
        return { path, items, expected, bytes };
      }));
      // Wait for this bounded group before failing, so a retry cannot overlap abandoned reads.
      const failed = fetched.find(result => result.status === "rejected");
      if (failed?.status === "rejected") throw failed.reason;
      for (const result of fetched) {
        if (result.status !== "fulfilled") throw new GnafDirectoryUnavailableError();
        const { path, items, expected, bytes } = result.value;
        if (!expected || !bytes) { for (const item of items) results[item.index] = { status: "unlocated", reason: "zero_results" }; continue; }
        if (await gnafSha256(bytes) !== expected.sha256) throw new GnafDirectoryUnavailableError();
        // Activation already validated every entry. The hash above verifies those exact
        // immutable bytes; re-normalising thousands of unrelated addresses per lookup
        // exceeded the Worker CPU limit. Decode once and validate only requested values.
        const { shard, decodedBytes } = decodeGnafShard(bytes, manifest.version, path);
        if (decodedBytes !== expected.decodedBytes || Object.keys(shard.entries).length !== expected.entries) throw new GnafDirectoryUnavailableError();
        for (const { key, index } of items) {
          const entry = Object.hasOwn(shard.entries, key) ? shard.entries[key] : undefined;
          if (entry !== undefined && !isEntry(entry)) throw new GnafDirectoryUnavailableError();
          results[index] = entry === null ? { status: "unlocated", reason: "ambiguous" }
            : entry ? { status: "located", position: { lat: entry[0], lng: entry[1] }, approximate: true, sourceId: entry[2] }
              : { status: "unlocated", reason: "zero_results" };
        }
      }
    }
    return results;
  } };
}
