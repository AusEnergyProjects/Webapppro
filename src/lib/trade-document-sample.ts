import type { TradeQuoteDocumentSnapshot } from "./trade-quote-review-server";
import type { QuickInvoiceDocumentSnapshot } from "./trade-quick-invoice";

export type DocumentSampleSettings = {
  name: string; phone: string; email: string; abn: string; website: string; address: string;
  themeKey: string; borderStyle: string; quoteTerms: string;
  payment: QuickInvoiceDocumentSnapshot["payment"];
};

/** Appearance-only samples. Never persisted, issued or sent to a customer. */
export function tradeDocumentSamples(settings: DocumentSampleSettings, now = new Date()) {
  const at = now.toISOString();
  const dayAfter = (days: number) => new Date(now.getTime() + days * 86400000).toISOString().slice(0, 10);
  const shared = {
    capturedAt: at, issuedAt: at,
    work: { id: "sample-job", number: "SAMPLE-JOB", title: "Equipment supply, installation and commissioning" },
    customer: { id: "sample-customer", number: "SAMPLE-CUSTOMER", name: "Sample customer", email: "customer@example.com", phone: "" },
    site: { id: "sample-site", label: "Sample property", addressLine1: "1 Example Street", addressLine2: "", suburb: "Melbourne", state: "VIC", postcode: "3000", summary: "1 Example Street, Melbourne VIC 3000" },
    business: { name: settings.name, phone: settings.phone, email: settings.email, abn: settings.abn, website: settings.website, address: settings.address, themeKey: settings.themeKey, borderStyle: settings.borderStyle, logo: null, banner: null, bannerCrop: { xBasisPoints: 0, yBasisPoints: 0, widthBasisPoints: 10000, heightBasisPoints: 10000 } },
  };
  const lines: QuickInvoiceDocumentSnapshot["lines"] = [
    { lineId: "equipment", priceBookItemId: "", priceRevision: 0, description: "Equipment supply", quantity: 1, unitPriceCentsExGst: 350000, taxCode: "gst", subtotalCents: 350000, taxCents: 35000, totalCents: 385000 },
    { lineId: "labour", priceBookItemId: "", priceRevision: 0, description: "Installation labour", quantity: 4, unitPriceCentsExGst: 8500, taxCode: "gst", subtotalCents: 34000, taxCents: 3400, totalCents: 37400 },
    { lineId: "handover", priceBookItemId: "", priceRevision: 0, description: "Commissioning and customer handover", quantity: 1, unitPriceCentsExGst: 20000, taxCode: "gst", subtotalCents: 20000, taxCents: 2000, totalCents: 22000 },
  ];
  const quote: TradeQuoteDocumentSnapshot = {
    ...shared, schemaVersion: "trade-quote-document-v2", quoteId: "sample-quote", quoteVersionId: "sample-version", quoteNumber: "SAMPLE-QUOTE", versionNumber: 1,
    business: { ...shared.business, quoteEmailSubjectTemplate: "", quoteEmailIntro: "" },
    acceptanceEmail: "customer@example.com", subtotalCents: 384000, taxCents: 38400, totalCents: 422400,
    customerMessage: "Sample only. This preview shows your document appearance. It has not been issued.", terms: settings.quoteTerms, validUntil: dayAfter(30), consentStatement: "Sample only", choices: [],
    items: [
      ...lines.map<TradeQuoteDocumentSnapshot["items"][number]>(line => ({ id: line.lineId, lineType: line.lineId === "equipment" ? "product" : "labour", description: line.description, quantityMilli: line.quantity * 1000, unitPriceCents: line.unitPriceCentsExGst, subtotalCents: line.subtotalCents, taxCents: line.taxCents, totalCents: line.totalCents, sectionHeading: "Supply and installation" })),
      { id: "discount", lineType: "adjustment", description: "Package discount", quantityMilli: 1000, unitPriceCents: -20000, subtotalCents: -20000, taxCents: -2000, totalCents: -22000, sectionHeading: "Discounts" },
    ],
  };
  const invoice: QuickInvoiceDocumentSnapshot = { ...shared, schemaVersion: "trade-quick-invoice-document-v1", invoiceId: "sample-invoice", invoiceNumber: "SAMPLE-INVOICE", revision: 1, currency: "AUD", dueAt: dayAfter(14), payment: settings.payment, lines, subtotalCents: 404000, discountCents: 20000, taxCents: 38400, totalCents: 422400 };
  return { quote, invoice };
}
