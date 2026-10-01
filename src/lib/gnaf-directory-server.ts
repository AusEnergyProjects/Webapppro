import { env } from "cloudflare:workers";
import type { R2Bucket } from "@cloudflare/workers-types";
import { createGnafDirectory, parseGnafManifest, GNAF_PREFIX, GNAF_MAX_MANIFEST_BYTES, GnafDirectoryUnavailableError } from "./gnaf-directory.ts";
export { GnafDirectoryUnavailableError } from "./gnaf-directory.ts";
export type { GnafDirectory, GnafMatch } from "./gnaf-directory.ts";

export function gnafBucket(): R2Bucket {
  const bucket = env.EVIDENCE as R2Bucket | undefined;
  if (!bucket) throw new GnafDirectoryUnavailableError();
  return bucket;
}
export async function getGnafDirectory() {
  try {
    const bucket = gnafBucket();
    const source = await bucket.get(`${GNAF_PREFIX}current.json`);
    if (!source || source.size > GNAF_MAX_MANIFEST_BYTES) throw new GnafDirectoryUnavailableError();
    return createGnafDirectory(bucket, parseGnafManifest(new Uint8Array(await source.arrayBuffer())));
  } catch { throw new GnafDirectoryUnavailableError(); }
}

export async function gnafDirectoryStatus() {
  try {
    const current = await gnafBucket().head(`${GNAF_PREFIX}current.json`);
    const version = current?.customMetadata?.version || "";
    const attribution = current?.customMetadata?.attribution || "";
    return { ready: Boolean(version && attribution), version, attribution };
  } catch { return { ready: false, version: "", attribution: "" }; }
}
