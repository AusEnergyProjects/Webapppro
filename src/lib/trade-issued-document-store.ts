import { env } from "cloudflare:workers";

const MAX_ISSUED_PDF_BYTES = 12 * 1024 * 1024;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

type IssuedDocumentObject = {
  arrayBuffer(): Promise<ArrayBuffer>;
};

type IssuedDocumentBucket = {
  put(
    key: string,
    value: ArrayBuffer,
    options?: {
      httpMetadata?: { contentType?: string };
      customMetadata?: Record<string, string>;
    },
  ): Promise<unknown>;
  get(key: string): Promise<IssuedDocumentObject | null>;
  delete(key: string): Promise<void>;
};

export type ImmutableIssuedPdfReference = {
  objectKey: string;
  sha256: string;
  sizeBytes: number;
};

export type ImmutableIssuedPdfIdentity = {
  kind: "quote" | "invoice";
  documentId: string;
  revision: number;
};

function issuedDocumentBucket() {
  const bucket = (env as unknown as { EVIDENCE?: IssuedDocumentBucket })
    .EVIDENCE;
  if (!bucket) throw new Error("ISSUED_PDF_STORAGE_UNAVAILABLE");
  return bucket;
}

function safePathSegment(value: string, fallback: string) {
  const segment = value
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 180);
  return segment || fallback;
}

function exactArrayBuffer(bytes: Uint8Array) {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function assertPdfBytes(bytes: Uint8Array) {
  if (
    bytes.byteLength < 5 ||
    bytes.byteLength > MAX_ISSUED_PDF_BYTES ||
    String.fromCharCode(...bytes.slice(0, 5)) !== "%PDF-"
  ) {
    throw new Error("ISSUED_PDF_INVALID");
  }
}

function immutableIssuedPdfObjectKey(
  identity: ImmutableIssuedPdfIdentity,
  sha256: string,
) {
  if (
    !SHA256_PATTERN.test(sha256) ||
    !Number.isInteger(identity.revision) ||
    identity.revision < 1
  ) {
    throw new Error("ISSUED_PDF_REFERENCE_INVALID");
  }
  const kind = safePathSegment(identity.kind, "document");
  const documentId = safePathSegment(identity.documentId, "unknown");
  return `trade-issued-documents/${kind}/${documentId}/revision-${identity.revision}/${sha256}.pdf`;
}

export async function immutableIssuedPdfSha256(bytes: Uint8Array) {
  const digest = await crypto.subtle.digest("SHA-256", exactArrayBuffer(bytes));
  return Array.from(new Uint8Array(digest))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

export async function prepareImmutableIssuedPdfReference(input: {
  kind: "quote" | "invoice";
  documentId: string;
  revision: number;
  bytes: Uint8Array;
  expectedSha256?: string;
}): Promise<ImmutableIssuedPdfReference> {
  assertPdfBytes(input.bytes);
  const sha256 = await immutableIssuedPdfSha256(input.bytes);
  if (input.expectedSha256 && input.expectedSha256.toLowerCase() !== sha256) {
    throw new Error("ISSUED_PDF_INTEGRITY");
  }
  const revision = Math.max(1, Math.trunc(input.revision || 1));
  return {
    objectKey: immutableIssuedPdfObjectKey(
      { kind: input.kind, documentId: input.documentId, revision },
      sha256,
    ),
    sha256,
    sizeBytes: input.bytes.byteLength,
  };
}

export async function storeImmutableIssuedPdf(input: {
  kind: "quote" | "invoice";
  documentId: string;
  revision: number;
  bytes: Uint8Array;
  expectedSha256?: string;
}): Promise<ImmutableIssuedPdfReference> {
  const reference = await prepareImmutableIssuedPdfReference(input);
  const revision = Math.max(1, Math.trunc(input.revision || 1));
  const kind = safePathSegment(input.kind, "document");
  const documentId = safePathSegment(input.documentId, "unknown");
  await issuedDocumentBucket().put(
    reference.objectKey,
    exactArrayBuffer(input.bytes),
    {
      httpMetadata: { contentType: "application/pdf" },
      customMetadata: {
        documentKind: kind,
        documentId,
        revision: String(revision),
        sha256: reference.sha256,
        sizeBytes: String(input.bytes.byteLength),
        retention: "immutable-issued-document",
      },
    },
  );
  return reference;
}

export async function readImmutableIssuedPdf(
  reference: ImmutableIssuedPdfReference,
  identity: ImmutableIssuedPdfIdentity,
) {
  const objectKey = reference.objectKey.trim();
  const expectedSha256 = reference.sha256.trim().toLowerCase();
  const expectedSize = Math.trunc(reference.sizeBytes);
  if (
    !SHA256_PATTERN.test(expectedSha256) ||
    expectedSize < 5 ||
    expectedSize > MAX_ISSUED_PDF_BYTES
  ) {
    throw new Error("ISSUED_PDF_REFERENCE_INVALID");
  }
  if (objectKey !== immutableIssuedPdfObjectKey(identity, expectedSha256)) {
    throw new Error("ISSUED_PDF_REFERENCE_INVALID");
  }
  const object = await issuedDocumentBucket().get(objectKey);
  if (!object) throw new Error("ISSUED_PDF_UNAVAILABLE");
  const bytes = new Uint8Array(await object.arrayBuffer());
  assertPdfBytes(bytes);
  if (
    bytes.byteLength !== expectedSize ||
    (await immutableIssuedPdfSha256(bytes)) !== expectedSha256
  ) {
    throw new Error("ISSUED_PDF_INTEGRITY");
  }
  return bytes;
}

export async function deleteImmutableIssuedPdf(
  reference: ImmutableIssuedPdfReference,
  identity: ImmutableIssuedPdfIdentity,
) {
  const objectKey = reference.objectKey.trim();
  const expectedSha256 = reference.sha256.trim().toLowerCase();
  if (objectKey !== immutableIssuedPdfObjectKey(identity, expectedSha256)) {
    throw new Error("ISSUED_PDF_REFERENCE_INVALID");
  }
  await issuedDocumentBucket().delete(objectKey);
}
