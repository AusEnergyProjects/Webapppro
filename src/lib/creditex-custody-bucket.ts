import { env } from "cloudflare:workers";

export type CreditexCustodyObject = {
  size?: number;
  httpMetadata?: { contentType?: string };
  arrayBuffer(): Promise<ArrayBuffer>;
};

export type CreditexCustodyBucket = {
  put(
    key: string,
    value: ArrayBuffer,
    options?: {
      httpMetadata?: { contentType?: string };
      customMetadata?: Record<string, string>;
    },
  ): Promise<unknown>;
  get(key: string): Promise<CreditexCustodyObject | null>;
  head(key: string): Promise<unknown | null>;
  delete(key: string): Promise<void>;
};

export function getCreditexCustodyBucket() {
  const bucket = (
    env as unknown as { EVIDENCE?: CreditexCustodyBucket }
  ).EVIDENCE;
  if (!bucket) throw new Error("CREDITEX_CUSTODY_STORAGE_UNAVAILABLE");
  return bucket;
}
