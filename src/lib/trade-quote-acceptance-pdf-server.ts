import type {
  StoredQuoteDecision,
} from "./trade-quote-decision-server.ts";
import type { TradeQuoteDocumentSnapshot } from "./trade-quote-review-server.ts";
import {
  createTradeQuoteAcceptancePdfBytes,
  TRADE_QUOTE_ACCEPTANCE_PDF_VERSION,
} from "./trade-quote-acceptance-pdf.mjs";

const FONT_PATHS = {
  regular: "/fonts/LiberationSans-Regular.ttf",
  bold: "/fonts/LiberationSans-Bold.ttf",
} as const;
const MAX_FONT_BYTES = 500_000;
const fontCache = new Map<
  string,
  Promise<{ regular: Uint8Array; bold: Uint8Array }>
>();

type ReceiptInvoice = StoredQuoteDecision["receipt"]["invoice"];
type ReceiptPayment = StoredQuoteDecision["receipt"]["payment"];

export type TradeQuoteAcceptancePdfSnapshot = {
  schemaVersion: typeof TRADE_QUOTE_ACCEPTANCE_PDF_VERSION;
  quote: {
    number: string;
    versionNumber: number;
    workNumber: string;
    workTitle: string;
    selectedChoiceNames: string[];
  };
  business: {
    name: string;
    email: string;
    phone: string;
    abn: string;
  };
  customer: {
    name: string;
    siteSummary: string;
  };
  acceptance: {
    id: string;
    reference: string;
    signerName: string;
    decidedAt: string;
    statement: string;
  };
  invoice: ReceiptInvoice;
  payment: ReceiptPayment;
  environmentNotice: string;
};

function receiptInvalid(): never {
  throw new Error("QUOTE_ACCEPTANCE_PDF_INVALID");
}

function secureOrigin(value: string) {
  const url = new URL(value);
  if (
    url.protocol !== "https:" &&
    !(
      url.protocol === "http:" &&
      (url.hostname === "localhost" || url.hostname === "127.0.0.1")
    )
  ) {
    throw new TypeError("A secure site origin is required for acceptance PDFs.");
  }
  return url.origin;
}

function fontsForOrigin(input: string) {
  const origin = secureOrigin(input);
  const cached = fontCache.get(origin);
  if (cached) return cached;
  const loading = Promise.all(
    Object.entries(FONT_PATHS).map(async ([weight, path]) => {
      const response = await fetch(new URL(path, origin), {
        cache: "force-cache",
      });
      if (!response.ok) {
        throw new Error(`PDF_${weight.toUpperCase()}_FONT_UNAVAILABLE`);
      }
      const suppliedLength = Number(
        response.headers.get("content-length") || 0,
      );
      if (
        Number.isFinite(suppliedLength) &&
        suppliedLength > MAX_FONT_BYTES
      ) {
        throw new Error(`PDF_${weight.toUpperCase()}_FONT_INVALID`);
      }
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength < 10_000 || bytes.byteLength > MAX_FONT_BYTES) {
        throw new Error(`PDF_${weight.toUpperCase()}_FONT_INVALID`);
      }
      return [weight, bytes] as const;
    }),
  )
    .then(
      (entries) =>
        Object.fromEntries(entries) as {
          regular: Uint8Array;
          bold: Uint8Array;
        },
    )
    .catch((error) => {
      fontCache.delete(origin);
      throw error;
    });
  fontCache.set(origin, loading);
  return loading;
}

function testEnvironmentNotice(payment: ReceiptPayment) {
  const evidence = [
    payment.accountName,
    payment.reference,
    payment.terms,
  ].join(" ");
  return /\bTEST ENVIRONMENT ONLY\b|\bDO NOT PAY\b/i.test(evidence)
    ? "TEST ENVIRONMENT ONLY. DO NOT MAKE A PAYMENT USING THESE DETAILS."
    : "";
}

export function buildTradeQuoteAcceptancePdfSnapshot(
  quote: TradeQuoteDocumentSnapshot,
  stored: StoredQuoteDecision,
): TradeQuoteAcceptancePdfSnapshot {
  const { receipt, commercial } = stored;
  if (
    receipt.decision !== "accepted" ||
    !receipt.acceptanceId ||
    !receipt.signerName ||
    !receipt.decidedAt ||
    !receipt.consentStatement ||
    !receipt.commercialReference ||
    receipt.commercialReference !== commercial.reference ||
    !quote.quoteNumber ||
    !Number.isInteger(quote.versionNumber) ||
    quote.versionNumber < 1 ||
    !quote.customer.name ||
    !quote.business.name
  ) {
    receiptInvalid();
  }

  const availableChoiceIds = new Set(quote.choices.map((choice) => choice.id));
  const selectedChoiceIds = [...commercial.selectedChoiceIds];
  if (
    new Set(selectedChoiceIds).size !== selectedChoiceIds.length ||
    selectedChoiceIds.some((id) => !availableChoiceIds.has(id))
  ) {
    receiptInvalid();
  }

  const invoice = receipt.invoice;
  if (
    invoice &&
    (invoice.subtotalCents !== commercial.subtotalCents ||
      invoice.taxCents !== commercial.taxCents ||
      invoice.totalCents !== commercial.totalCents ||
      invoice.totalCents !== invoice.subtotalCents + invoice.taxCents)
  ) {
    receiptInvalid();
  }
  if (
    invoice?.status === "issued" &&
    (receipt.payment.amountDueCents !== invoice.totalCents ||
      receipt.payment.currency !== "AUD" ||
      receipt.payment.dueAt !== invoice.dueAt)
  ) {
    receiptInvalid();
  }
  if (
    receipt.payment.availability === "bank_transfer" &&
    (receipt.payment.method !== "bank_transfer" ||
      !receipt.payment.accountName ||
      !receipt.payment.bsb ||
      !receipt.payment.accountNumber ||
      !receipt.payment.reference ||
      invoice?.status !== "issued")
  ) {
    receiptInvalid();
  }

  const selectedChoiceNames = quote.choices
    .filter((choice) => selectedChoiceIds.includes(choice.id))
    .map((choice) => choice.name);
  const payment = receipt.payment.availability === "bank_transfer"
    ? receipt.payment
    : {
        ...receipt.payment,
        method: "none" as const,
        accountName: "",
        bsb: "",
        accountNumber: "",
        reference: "",
        terms: "",
        amountDueCents: 0,
      };
  return {
    schemaVersion: TRADE_QUOTE_ACCEPTANCE_PDF_VERSION,
    quote: {
      number: quote.quoteNumber,
      versionNumber: quote.versionNumber,
      workNumber: quote.work.number,
      workTitle: quote.work.title,
      selectedChoiceNames,
    },
    business: {
      name: quote.business.name,
      email: quote.business.email,
      phone: quote.business.phone,
      abn: quote.business.abn,
    },
    customer: {
      name: quote.customer.name,
      siteSummary: quote.site.summary,
    },
    acceptance: {
      id: receipt.acceptanceId,
      reference: receipt.commercialReference,
      signerName: receipt.signerName,
      decidedAt: receipt.decidedAt,
      statement: receipt.consentStatement,
    },
    invoice,
    payment,
    environmentNotice: testEnvironmentNotice(receipt.payment),
  };
}

export function tradeQuoteAcceptancePdfFilename(
  snapshot: Pick<TradeQuoteAcceptancePdfSnapshot, "quote" | "invoice">,
) {
  const source =
    snapshot.invoice?.number ||
    `${snapshot.quote.number}-v${Math.max(1, snapshot.quote.versionNumber)}`;
  const documentNumber =
    String(source || "quote-acceptance")
      .replace(/[^A-Za-z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 100) || "quote-acceptance";
  return `${documentNumber}-acceptance-record.pdf`;
}

export async function renderTradeQuoteAcceptancePdf(
  snapshot: TradeQuoteAcceptancePdfSnapshot,
  options?: { origin: string },
) {
  const fonts = options
    ? await fontsForOrigin(options.origin).catch(() => undefined)
    : undefined;
  return new Uint8Array(
    await createTradeQuoteAcceptancePdfBytes(snapshot, fonts),
  );
}
