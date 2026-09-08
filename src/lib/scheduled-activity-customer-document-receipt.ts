const RECEIPT_MARKER = " | receipt=";

export type ScheduledActivityCustomerDocumentReceiptDetails = {
  deliveryId: string;
  providerMessageId: string;
  acceptedAt: string;
  method: "email";
  recipient: string;
  appointmentId: string;
  documentIds: string[];
  documentSha256Set: string[];
};

export function scheduledActivityCustomerDocumentReceiptSummary(input: {
  deliveryId: string;
  providerMessageId: string;
  acceptedAt: string;
  recipient: string;
  appointmentId: string;
  documentIds: readonly string[];
  documentSha256Set: readonly string[];
}) {
  const receipt = {
    deliveryId: input.deliveryId,
    providerMessageId: input.providerMessageId,
    acceptedAt: input.acceptedAt,
    method: "email" as const,
    recipient: input.recipient.trim().toLowerCase(),
    appointmentId: input.appointmentId,
    documents: input.documentIds.map((id, index) => ({ id, sha256: input.documentSha256Set[index] })),
  };
  if (!validReceipt(receipt)) throw new Error("INVALID_ACTIVITY_CUSTOMER_DOCUMENT_RECEIPT");
  return `Required customer documents accepted for email delivery${RECEIPT_MARKER}${JSON.stringify({
    ...receipt,
  })}`;
}

function canonicalTimestamp(value: unknown) {
  if (typeof value !== "string" || value.length > 40 || !Number.isFinite(Date.parse(value))) return false;
  return new Date(value).toISOString() === value;
}

function validReceipt(value: unknown): value is {
  deliveryId: string;
  providerMessageId: string;
  acceptedAt: string;
  method: "email";
  recipient: string;
  appointmentId: string;
  documents: { id: string; sha256: string }[];
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const parsed = value as Record<string, unknown>;
  const recipient = typeof parsed.recipient === "string" ? parsed.recipient : "";
  const appointmentId = typeof parsed.appointmentId === "string" ? parsed.appointmentId : "";
  const deliveryId = typeof parsed.deliveryId === "string" ? parsed.deliveryId : "";
  const providerMessageId = typeof parsed.providerMessageId === "string" ? parsed.providerMessageId : "";
  if (!canonicalTimestamp(parsed.acceptedAt) || parsed.method !== "email"
    || recipient !== recipient.trim().toLowerCase() || recipient.length > 254
    || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)
    || !/^[a-z0-9][a-z0-9._:-]{0,159}$/i.test(appointmentId)
    || !/^[a-z0-9][a-z0-9._:-]{0,159}$/i.test(deliveryId)
    || !/^[a-z0-9][a-z0-9._:-]{0,199}$/i.test(providerMessageId)
    || !Array.isArray(parsed.documents) || parsed.documents.length < 1 || parsed.documents.length > 32) return false;
  const seen = new Set<string>();
  for (const item of parsed.documents) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return false;
    const document = item as Record<string, unknown>;
    if (typeof document.id !== "string" || !/^[a-z0-9][a-z0-9._:-]{0,119}$/i.test(document.id)
      || seen.has(document.id) || typeof document.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(document.sha256)) return false;
    seen.add(document.id);
  }
  return true;
}

export function parseScheduledActivityCustomerDocumentReceipt(summary: unknown): ScheduledActivityCustomerDocumentReceiptDetails | null {
  const value = String(summary || "");
  if (value.length > 20_000 || !value.startsWith("Required customer documents accepted for email delivery")) return null;
  const marker = value.indexOf(RECEIPT_MARKER);
  if (marker < 0) return null;
  try {
    const parsed = JSON.parse(value.slice(marker + RECEIPT_MARKER.length));
    if (!validReceipt(parsed)) return null;
    return {
      deliveryId: parsed.deliveryId,
      providerMessageId: parsed.providerMessageId,
      acceptedAt: parsed.acceptedAt,
      method: "email",
      recipient: parsed.recipient,
      appointmentId: parsed.appointmentId,
      documentIds: parsed.documents.map((item) => item.id),
      documentSha256Set: parsed.documents.map((item) => item.sha256),
    };
  } catch {
    return null;
  }
}
