import { env } from "cloudflare:workers";

export type CustomerProjectEvidenceUploadedPart = {
  partNumber: number;
  etag: string;
};

export type CustomerProjectEvidenceMultipartUpload = {
  uploadId: string;
  uploadPart(
    partNumber: number,
    value: ArrayBuffer,
  ): Promise<CustomerProjectEvidenceUploadedPart>;
  complete(parts: CustomerProjectEvidenceUploadedPart[]): Promise<unknown>;
  abort(): Promise<void>;
};

export type CustomerProjectEvidenceUploadCleanup = {
  stagingObjectKey: string;
  uploadId: string;
};

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
    arrayBuffer(): Promise<ArrayBuffer>;
    httpMetadata?: { contentType?: string };
  } | null>;
  head(key: string): Promise<unknown | null>;
  delete(key: string): Promise<void>;
  createMultipartUpload(
    key: string,
    options?: {
      httpMetadata?: { contentType?: string };
      customMetadata?: Record<string, string>;
    },
  ): Promise<CustomerProjectEvidenceMultipartUpload>;
  resumeMultipartUpload(
    key: string,
    uploadId: string,
  ): CustomerProjectEvidenceMultipartUpload;
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
  uploads: CustomerProjectEvidenceUploadCleanup[] = [],
) {
  const uniqueKeys = [...new Set(objectKeys.filter(Boolean))];
  const uniqueUploads = [
    ...new Map(
      uploads
        .filter((upload) => upload.stagingObjectKey && upload.uploadId)
        .map((upload) => [
          `${upload.stagingObjectKey}:${upload.uploadId}`,
          upload,
        ]),
    ).values(),
  ];
  if (!uniqueKeys.length && !uniqueUploads.length) return;
  const bucket = getCustomerProjectEvidenceBucket();
  for (const upload of uniqueUploads) {
    try {
      await bucket
        .resumeMultipartUpload(upload.stagingObjectKey, upload.uploadId)
        .abort();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/NoSuchUpload|not found|does not exist|404/i.test(message)) {
        throw error;
      }
    }
    if (await bucket.head(upload.stagingObjectKey)) {
      await bucket.delete(upload.stagingObjectKey);
    }
  }
  for (const objectKey of uniqueKeys) {
    await bucket.delete(objectKey);
  }
}
