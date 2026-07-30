import { env } from "cloudflare:workers";

export type CustomerProjectEvidenceBucket = {
  put(
    key: string,
    value: ArrayBuffer,
    options?: {
      httpMetadata?: { contentType?: string };
      customMetadata?: Record<string, string>;
    },
  ): Promise<unknown>;
  get(
    key: string,
  ): Promise<{
    body: BodyInit;
    httpMetadata?: { contentType?: string };
  } | null>;
  delete(key: string): Promise<void>;
};

export function getCustomerProjectEvidenceBucket() {
  const bucket = (
    env as unknown as { EVIDENCE?: CustomerProjectEvidenceBucket }
  ).EVIDENCE;
  if (!bucket) throw new Error("Project evidence storage is unavailable.");
  return bucket;
}

export async function deleteCustomerProjectEvidenceObjects(
  objectKeys: string[],
) {
  const uniqueKeys = [...new Set(objectKeys.filter(Boolean))];
  if (!uniqueKeys.length) return;
  const bucket = getCustomerProjectEvidenceBucket();
  for (const objectKey of uniqueKeys) {
    await bucket.delete(objectKey);
  }
}
