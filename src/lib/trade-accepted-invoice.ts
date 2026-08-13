import type {
  AcceptedScopeLine,
  AcceptedScopeTotals,
} from "./trade-commercial-handoff";

export type AcceptedInvoicePaymentSnapshot =
  | {
      method: "bank_transfer";
      available: true;
      accountName: string;
      bsb: string;
      accountNumber: string;
      reference: string;
      terms: string;
    }
  | {
      method: "unavailable";
      available: false;
    };

export type AcceptedInvoiceBuildInput = {
  invoiceId: string;
  invoiceNumber: string;
  acceptanceId: string;
  commercialHandoffId: string;
  quoteId: string;
  quoteVersionId: string;
  workOrderId: string;
  firebaseUid: string;
  crmCustomerId: string;
  issuedAt: string;
  dueAt: string;
  scope: AcceptedScopeLine[];
  totals: AcceptedScopeTotals;
  business: {
    name: string;
    email: string;
    phone: string;
    abn: string;
    address: string;
  };
  customer: {
    name: string;
    email: string;
    phone: string;
    number: string;
  };
  site: {
    label: string;
    addressLine1: string;
    addressLine2: string;
    suburb: string;
    state: string;
    postcode: string;
    summary: string;
  };
  work: {
    number: string;
    title: string;
  };
  payment: {
    accountName: string;
    bsb: string;
    accountNumber: string;
    reference: string;
    terms: string;
  };
  issueBlockerCode?:
    | "ACCEPTED_INVOICE_CONFLICT"
    | "ACCEPTED_INVOICE_SNAPSHOT_INCOMPLETE";
};

export type AcceptedInvoiceDocumentSnapshot = {
  schemaVersion: "trade-accepted-invoice-v1";
  capturedAt: string;
  invoice: {
    id: string;
    number: string;
    documentLabel: "Invoice";
    currency: "AUD";
    issuedAt: string;
    dueAt: string;
  };
  source: {
    acceptanceId: string;
    commercialHandoffId: string;
    quoteId: string;
    quoteVersionId: string;
    workOrderId: string;
    firebaseUid: string;
    crmCustomerId: string;
    snapshotSha256: string;
  };
  business: AcceptedInvoiceBuildInput["business"];
  customer: AcceptedInvoiceBuildInput["customer"];
  site: AcceptedInvoiceBuildInput["site"];
  work: AcceptedInvoiceBuildInput["work"];
  lines: AcceptedScopeLine[];
  totals: AcceptedScopeTotals;
  payment: AcceptedInvoicePaymentSnapshot;
};

export type AcceptedInvoiceBuildResult = {
  documentLabel: "Invoice";
  currency: "AUD";
  sourceSnapshotSha256: string;
  documentSnapshotSha256: string;
  documentSnapshot: AcceptedInvoiceDocumentSnapshot;
  documentSnapshotJson: string;
  paymentSnapshot: AcceptedInvoicePaymentSnapshot;
  paymentSnapshotJson: string;
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  dueAt: string;
  status: "issued" | "attention_required";
  issueBlockerCode: string;
};

const MAX_MONEY_CENTS = 100_000_000;
const ACCEPTED_LINE_TYPES = new Set<AcceptedScopeLine["lineType"]>([
  "product",
  "labour",
  "adjustment",
]);

function text(value: unknown, limit: number, required = false) {
  const normalised = String(value ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]+/g, " ")
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/[^\S\n]+/g, " ")
    .trim()
    .slice(0, limit);
  if (required && !normalised) throw new Error("INVALID_ACCEPTED_INVOICE");
  return normalised;
}

function integer(value: unknown, minimum: number, maximum: number) {
  const result = Number(value);
  if (
    !Number.isSafeInteger(result) ||
    result < minimum ||
    result > maximum
  ) {
    throw new Error("INVALID_ACCEPTED_INVOICE");
  }
  return result;
}

function signedMoney(value: unknown) {
  return integer(value, -MAX_MONEY_CENTS, MAX_MONEY_CENTS);
}

function positiveMoney(value: unknown) {
  return integer(value, 0, MAX_MONEY_CENTS);
}

function validIssuedAt(value: unknown) {
  const result = text(value, 40, true);
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?(?:Z|[+-]\d{2}:\d{2})$/.test(result) ||
    !Number.isFinite(Date.parse(result))
  ) {
    throw new Error("INVALID_ACCEPTED_INVOICE");
  }
  return result;
}

function validDueAt(value: unknown, issuedAt: string) {
  const result = text(value, 10, true);
  const parsed = new Date(`${result}T00:00:00.000Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(result) ||
    !Number.isFinite(parsed.valueOf()) ||
    parsed.toISOString().slice(0, 10) !== result ||
    result < issuedAt.slice(0, 10)
  ) {
    throw new Error("INVALID_ACCEPTED_INVOICE");
  }
  return result;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new Error("INVALID_ACCEPTED_INVOICE");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  if (typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  throw new Error("INVALID_ACCEPTED_INVOICE");
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function immutableScope(
  scope: AcceptedScopeLine[],
  expectedTotals: AcceptedScopeTotals,
) {
  if (!Array.isArray(scope) || scope.length < 1 || scope.length > 300) {
    throw new Error("INVALID_ACCEPTED_INVOICE");
  }
  const lines = scope.map((line): AcceptedScopeLine => {
    const lineType = line.lineType;
    if (!ACCEPTED_LINE_TYPES.has(lineType)) {
      throw new Error("INVALID_ACCEPTED_INVOICE");
    }
    const money = lineType === "adjustment" ? signedMoney : positiveMoney;
    const subtotalCents = money(line.subtotalCents);
    const taxCents = money(line.taxCents);
    const totalCents = money(line.totalCents);
    if (subtotalCents + taxCents !== totalCents) {
      throw new Error("INVALID_ACCEPTED_INVOICE");
    }
    return {
      lineId: text(line.lineId, 180, true),
      lineType,
      section: text(line.section, 120) || "Included work",
      description: text(line.description, 500, true),
      quantityMilli: integer(line.quantityMilli, 1, 100_000_000),
      subtotalCents,
      taxCents,
      totalCents,
    };
  });
  const totals: AcceptedScopeTotals = {
    subtotalCents: signedMoney(expectedTotals.subtotalCents),
    taxCents: signedMoney(expectedTotals.taxCents),
    totalCents: integer(expectedTotals.totalCents, 1, MAX_MONEY_CENTS),
  };
  const actual = lines.reduce<AcceptedScopeTotals>(
    (sum, line) => ({
      subtotalCents: signedMoney(sum.subtotalCents + line.subtotalCents),
      taxCents: signedMoney(sum.taxCents + line.taxCents),
      totalCents: signedMoney(sum.totalCents + line.totalCents),
    }),
    { subtotalCents: 0, taxCents: 0, totalCents: 0 },
  );
  if (
    totals.subtotalCents + totals.taxCents !== totals.totalCents ||
    actual.subtotalCents !== totals.subtotalCents ||
    actual.taxCents !== totals.taxCents ||
    actual.totalCents !== totals.totalCents
  ) {
    throw new Error("INVALID_ACCEPTED_INVOICE");
  }
  return { lines, totals };
}

function paymentSnapshot(
  payment: AcceptedInvoiceBuildInput["payment"],
  invoiceNumber: string,
  status: AcceptedInvoiceBuildResult["status"],
): AcceptedInvoicePaymentSnapshot {
  const accountName = text(payment.accountName, 180);
  const bsb = text(payment.bsb, 20);
  const accountNumber = text(payment.accountNumber, 40);
  if (status !== "issued" || !accountName || !bsb || !accountNumber) {
    return { method: "unavailable", available: false };
  }
  return {
    method: "bank_transfer",
    available: true,
    accountName,
    bsb,
    accountNumber,
    reference: text(payment.reference, 120) || invoiceNumber,
    terms: text(payment.terms, 20_000),
  };
}

export async function buildAcceptedInvoiceSnapshot(
  input: AcceptedInvoiceBuildInput,
): Promise<AcceptedInvoiceBuildResult> {
  const invoiceId = text(input.invoiceId, 180, true);
  const invoiceNumber = text(input.invoiceNumber, 120, true);
  const acceptanceId = text(input.acceptanceId, 180, true);
  const commercialHandoffId = text(input.commercialHandoffId, 180, true);
  const quoteId = text(input.quoteId, 180, true);
  const quoteVersionId = text(input.quoteVersionId, 180, true);
  const workOrderId = text(input.workOrderId, 180, true);
  const firebaseUid = text(input.firebaseUid, 180, true);
  const crmCustomerId = text(input.crmCustomerId, 180, true);
  const issuedAt = validIssuedAt(input.issuedAt);
  const dueAt = validDueAt(input.dueAt, issuedAt);
  const { lines, totals } = immutableScope(input.scope, input.totals);
  const issueBlockerCode = input.issueBlockerCode || "";
  const status = issueBlockerCode ? "attention_required" : "issued";
  const payment = paymentSnapshot(input.payment, invoiceNumber, status);

  const source = {
    schemaVersion: "trade-accepted-invoice-source-v1",
    acceptanceId,
    commercialHandoffId,
    quoteId,
    quoteVersionId,
    workOrderId,
    firebaseUid,
    crmCustomerId,
    currency: "AUD" as const,
    lines,
    totals,
  };
  const sourceSnapshotSha256 = await sha256Hex(canonicalJson(source));
  const documentSnapshot: AcceptedInvoiceDocumentSnapshot = {
    schemaVersion: "trade-accepted-invoice-v1",
    capturedAt: issuedAt,
    invoice: {
      id: invoiceId,
      number: invoiceNumber,
      documentLabel: "Invoice",
      currency: "AUD",
      issuedAt,
      dueAt,
    },
    source: {
      acceptanceId,
      commercialHandoffId,
      quoteId,
      quoteVersionId,
      workOrderId,
      firebaseUid,
      crmCustomerId,
      snapshotSha256: sourceSnapshotSha256,
    },
    business: {
      name: text(input.business.name, 240, true),
      email: text(input.business.email, 254),
      phone: text(input.business.phone, 60),
      abn: text(input.business.abn, 20),
      address: text(input.business.address, 500),
    },
    customer: {
      name: text(input.customer.name, 240, true),
      email: text(input.customer.email, 254),
      phone: text(input.customer.phone, 60),
      number: text(input.customer.number, 120),
    },
    site: {
      label: text(input.site.label, 160) || "Service address",
      addressLine1: text(input.site.addressLine1, 300),
      addressLine2: text(input.site.addressLine2, 300),
      suburb: text(input.site.suburb, 160),
      state: text(input.site.state, 16),
      postcode: text(input.site.postcode, 12),
      summary: text(input.site.summary, 600),
    },
    work: {
      number: text(input.work.number, 120, true),
      title: text(input.work.title, 300, true),
    },
    lines,
    totals,
    payment,
  };
  const documentSnapshotJson = canonicalJson(documentSnapshot);
  const paymentSnapshotJson = canonicalJson(payment);
  return {
    documentLabel: "Invoice",
    currency: "AUD",
    sourceSnapshotSha256,
    documentSnapshotSha256: await sha256Hex(documentSnapshotJson),
    documentSnapshot,
    documentSnapshotJson,
    paymentSnapshot: payment,
    paymentSnapshotJson,
    subtotalCents: totals.subtotalCents,
    taxCents: totals.taxCents,
    totalCents: totals.totalCents,
    dueAt,
    status,
    issueBlockerCode,
  };
}
