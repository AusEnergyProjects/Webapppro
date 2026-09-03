import { getD1 } from "../../db";
import {
  deleteImmutableIssuedPdf,
  immutableIssuedPdfSha256,
  prepareImmutableIssuedPdfReference,
  readImmutableIssuedPdf,
  storeImmutableIssuedPdf,
  type ImmutableIssuedPdfIdentity,
  type ImmutableIssuedPdfReference,
} from "@/lib/trade-issued-document-store";
import type {
  TradeQuoteDocumentSnapshot,
} from "@/lib/trade-quote-review-server";

type Row = Record<string, unknown>;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

function issuedPdfReference(row: Row): ImmutableIssuedPdfReference | null {
  const objectKey = String(row.issued_pdf_object_key || "").trim();
  const sha256 = String(row.issued_pdf_sha256 || "").trim().toLowerCase();
  const sizeBytes = Number(row.issued_pdf_size_bytes || 0);
  if (!objectKey && !sha256 && !sizeBytes) return null;
  if (
    !objectKey ||
    !sha256 ||
    !Number.isInteger(sizeBytes) ||
    sizeBytes <= 0
  ) {
    throw new Error("QUOTE_ISSUED_PDF_UNAVAILABLE");
  }
  return { objectKey, sha256, sizeBytes };
}

async function quoteVersionPdfRow(ownerUid: string, quoteVersionId: string) {
  return getD1()
    .prepare(
      `SELECT id, quote_id, firebase_uid, version_number, status,
        issued_pdf_object_key, issued_pdf_sha256, issued_pdf_size_bytes
      FROM trade_crm_quote_versions
      WHERE id = ? AND firebase_uid = ?
      LIMIT 1`,
    )
    .bind(quoteVersionId, ownerUid)
    .first<Row>();
}

function quotePdfIdentity(row: Row): ImmutableIssuedPdfIdentity {
  const documentId = String(row.quote_id || "").trim();
  const revision = Number(row.version_number);
  if (!documentId || !Number.isInteger(revision) || revision < 1) {
    throw new Error("QUOTE_ISSUED_PDF_UNAVAILABLE");
  }
  return { kind: "quote", documentId, revision };
}

async function readVerifiedIssuedPdf(
  reference: ImmutableIssuedPdfReference,
  identity: ImmutableIssuedPdfIdentity,
) {
  try {
    return await readImmutableIssuedPdf(reference, identity);
  } catch {
    throw new Error("QUOTE_ISSUED_PDF_UNAVAILABLE");
  }
}

export async function storeTradeQuoteIssuedPdf(input: {
  quoteVersionId: string;
  versionNumber: number;
  bytes: Uint8Array;
}) {
  const row = await getD1()
    .prepare(
      `SELECT quote_id, version_number
      FROM trade_crm_quote_versions
      WHERE id = ? AND version_number = ?
      LIMIT 1`,
    )
    .bind(input.quoteVersionId, input.versionNumber)
    .first<Row>();
  if (!row) throw new Error("QUOTE_ISSUED_PDF_UNAVAILABLE");
  const identity = quotePdfIdentity(row);
  return storeImmutableIssuedPdf({
    ...identity,
    bytes: input.bytes,
  });
}

export async function prepareTradeQuoteIssuedPdfReference(input: {
  quoteVersionId: string;
  versionNumber: number;
  bytes: Uint8Array;
}) {
  const row = await getD1()
    .prepare(
      `SELECT quote_id, version_number FROM trade_crm_quote_versions
      WHERE id = ? AND version_number = ? LIMIT 1`,
    )
    .bind(input.quoteVersionId, input.versionNumber)
    .first<Row>();
  if (!row) throw new Error("QUOTE_ISSUED_PDF_UNAVAILABLE");
  return prepareImmutableIssuedPdfReference({
    ...quotePdfIdentity(row),
    bytes: input.bytes,
  });
}

export async function deleteTradeQuoteIssuedPdf(input: {
  quoteVersionId: string;
  versionNumber: number;
  reference: ImmutableIssuedPdfReference;
}) {
  const row = await getD1()
    .prepare(
      `SELECT quote_id, version_number
      FROM trade_crm_quote_versions
      WHERE id = ? AND version_number = ?
      LIMIT 1`,
    )
    .bind(input.quoteVersionId, input.versionNumber)
    .first<Row>();
  if (!row) throw new Error("QUOTE_ISSUED_PDF_UNAVAILABLE");
  await deleteImmutableIssuedPdf(input.reference, quotePdfIdentity(row));
}

export async function verifyTradeQuoteIssuedPdf(input: {
  quoteVersionId: string;
  versionNumber: number;
  reference: ImmutableIssuedPdfReference;
}) {
  const row = await getD1()
    .prepare(
      `SELECT quote_id, version_number FROM trade_crm_quote_versions
      WHERE id = ? AND version_number = ? LIMIT 1`,
    )
    .bind(input.quoteVersionId, input.versionNumber)
    .first<Row>();
  if (!row) throw new Error("QUOTE_ISSUED_PDF_UNAVAILABLE");
  return readVerifiedIssuedPdf(input.reference, quotePdfIdentity(row));
}

export async function issuedTradeQuotePdf(input: {
  ownerUid: string;
  quoteVersionId: string;
  snapshot: TradeQuoteDocumentSnapshot;
  origin: string;
}) {
  if (input.snapshot.quoteVersionId !== input.quoteVersionId) {
    throw new Error("QUOTE_DOCUMENT_INVALID");
  }
  const row = await quoteVersionPdfRow(
    input.ownerUid,
    input.quoteVersionId,
  );
  if (!row || row.status !== "issued") {
    throw new Error("QUOTE_ISSUED_PDF_UNAVAILABLE");
  }
  const existingReference = issuedPdfReference(row);
  const identity = quotePdfIdentity(row);
  if (existingReference) {
    return {
      bytes: await readVerifiedIssuedPdf(existingReference, identity),
      reference: existingReference,
    };
  }

  // Legacy issued versions predate exact-byte storage. Re-rendering is only
  // safe when it reproduces an attachment hash already recorded at delivery.
  const { renderTradeQuotePdf } = await import("@/lib/trade-quote-pdf-server");
  const legacyBytes = await renderTradeQuotePdf(input.snapshot, {
    origin: input.origin,
  });
  const legacySha256 = await immutableIssuedPdfSha256(legacyBytes);
  const deliveryRows = await getD1()
    .prepare(
      `SELECT attachment_sha256
      FROM trade_crm_quote_deliveries
      WHERE quote_version_id = ? AND firebase_uid = ?`,
    )
    .bind(input.quoteVersionId, input.ownerUid)
    .all<Row>();
  const recordedHashes = deliveryRows.results
    .map((delivery) =>
      String(delivery.attachment_sha256 || "").trim().toLowerCase(),
    );
  if (
    deliveryRows.results.length &&
    !recordedHashes.every(
      (hash) => SHA256_PATTERN.test(hash) && hash === legacySha256,
    )
  ) {
    throw new Error("QUOTE_ISSUED_PDF_MISMATCH");
  }

  const storedReference = await storeImmutableIssuedPdf({
    ...identity,
    bytes: legacyBytes,
    expectedSha256: deliveryRows.results.length ? legacySha256 : undefined,
  });
  const backfill = await getD1()
    .prepare(
      `UPDATE trade_crm_quote_versions
      SET issued_pdf_object_key = ?, issued_pdf_sha256 = ?,
        issued_pdf_size_bytes = ?
      WHERE id = ? AND firebase_uid = ? AND status = 'issued'
        AND issued_pdf_object_key = ''
        AND issued_pdf_sha256 = ''
        AND issued_pdf_size_bytes = 0`,
    )
    .bind(
      storedReference.objectKey,
      storedReference.sha256,
      storedReference.sizeBytes,
      input.quoteVersionId,
      input.ownerUid,
    )
    .run();
  if (Number(backfill.meta.changes || 0) === 1) {
    return { bytes: legacyBytes, reference: storedReference };
  }

  // A concurrent request may have won the conditional backfill. Read and
  // verify that authoritative object instead of serving the local render.
  const racedRow = await quoteVersionPdfRow(
    input.ownerUid,
    input.quoteVersionId,
  );
  if (!racedRow || racedRow.status !== "issued") {
    throw new Error("QUOTE_ISSUED_PDF_UNAVAILABLE");
  }
  const racedReference = issuedPdfReference(racedRow);
  if (!racedReference) {
    throw new Error("QUOTE_ISSUED_PDF_UNAVAILABLE");
  }
  const racedIdentity = quotePdfIdentity(racedRow);
  return {
    bytes: await readVerifiedIssuedPdf(racedReference, racedIdentity),
    reference: racedReference,
  };
}
