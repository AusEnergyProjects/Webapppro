import type {
  AcceptedScopeLine,
  AcceptedScopeTotals,
} from "./trade-commercial-handoff";
import { quickInvoiceTotals, type QuickInvoiceLine } from "./trade-quick-invoice.ts";
import type { AccountingProvider } from "./trade-accounting";

type Row = Record<string, unknown>;

export type AccountingExportScope = {
  lines: AcceptedScopeLine[];
  totals: AcceptedScopeTotals;
};

export type AccountingProviderIdentity = {
  xeroIdempotencyKey: string;
  quickBooksRequestId: string;
  xeroNumber: string;
  myobNumber: string;
  quickBooksNumber: string;
};

export type ProviderInvoiceExpectation = {
  number: string;
  contactId: string;
  scope: AccountingExportScope;
  myobTaxCodes?: { gst: string; free: string };
  quickBooksTaxCodes?: { gst: string; free: string };
};

export type ProviderContactExpectation = {
  storedId?: string;
  reference: string;
  displayName: string;
  businessName?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  addressLine1?: string;
  suburb?: string;
  state?: string;
  postcode?: string;
};

export type QuickBooksTaxCodes = { gst: string; free: string };

const MAX_CENTS = 100_000_000;
const LINE_TYPES = new Set<AcceptedScopeLine["lineType"]>([
  "product",
  "labour",
  "adjustment",
]);

function text(value: unknown, limit: number, required = false) {
  const result = String(value ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]+/g, " ")
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/[^\S\n]+/g, " ")
    .trim()
    .slice(0, limit);
  if (required && !result) throw new Error("INVALID_ACCOUNTING_SCOPE");
  return result;
}

function integer(value: unknown, minimum: number, maximum: number) {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < minimum || result > maximum) {
    throw new Error("INVALID_ACCOUNTING_SCOPE");
  }
  return result;
}

function signedCents(value: unknown) {
  const amount = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(amount)) throw new Error("PROVIDER_RECORD_MISMATCH");
  return Math.round(amount * 100);
}

function optionalSignedCents(value: unknown) {
  if (value === undefined || value === null || value === "") return null;
  return signedCents(value);
}

function firstObject(value: unknown) {
  return value && typeof value === "object" ? value as Row : {};
}

function list(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is Row => Boolean(item) && typeof item === "object") : [];
}

function comparable(value: unknown) {
  return text(value, 500).toLocaleLowerCase("en-AU");
}

function comparablePhone(value: unknown) {
  return text(value, 80).replace(/[^0-9+]/g, "");
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new Error("INVALID_ACCOUNTING_SCOPE");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  if (typeof value === "object") {
    return `{${Object.entries(value as Row)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  throw new Error("INVALID_ACCOUNTING_SCOPE");
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function immutableJsonSha256(value: string) {
  return sha256Hex(value);
}

function sourceQuantity(line: AcceptedScopeLine) {
  return (line.quantityMilli / 1000).toLocaleString("en-AU", { maximumFractionDigits: 3 });
}

function providerDescription(line: AcceptedScopeLine) {
  const quantity = line.quantityMilli === 1000 ? "" : ` | accepted quantity ${sourceQuantity(line)}`;
  return text(`${line.description}${quantity}`, 500, true);
}

function taxCodeForLine(line: AcceptedScopeLine, codes: { gst: string; free: string }) {
  if (line.taxCents === 0) return codes.free;
  if (!codes.gst) throw new Error("PROVIDER_TAX_CODE_REQUIRED");
  return codes.gst;
}

export function accountingExportScope(
  scopeSnapshot: unknown,
  expectedTotals: AcceptedScopeTotals,
): AccountingExportScope {
  let parsed = scopeSnapshot;
  if (typeof scopeSnapshot === "string") {
    try { parsed = JSON.parse(scopeSnapshot); }
    catch { throw new Error("INVALID_ACCOUNTING_SCOPE"); }
  }
  if (!Array.isArray(parsed) || parsed.length < 1 || parsed.length > 300) {
    throw new Error("INVALID_ACCOUNTING_SCOPE");
  }
  const lines = parsed.map((candidate): AcceptedScopeLine => {
    const row = firstObject(candidate);
    const lineType = String(row.lineType || "") as AcceptedScopeLine["lineType"];
    if (!LINE_TYPES.has(lineType)) throw new Error("INVALID_ACCOUNTING_SCOPE");
    const minimum = lineType === "adjustment" ? -MAX_CENTS : 0;
    const subtotalCents = integer(row.subtotalCents, minimum, MAX_CENTS);
    const taxCents = integer(row.taxCents, minimum, MAX_CENTS);
    const totalCents = integer(row.totalCents, minimum, MAX_CENTS);
    if (subtotalCents + taxCents !== totalCents) throw new Error("INVALID_ACCOUNTING_SCOPE");
    return {
      lineId: text(row.lineId, 180, true),
      lineType,
      section: text(row.section, 120) || "Included work",
      description: text(row.description, 500, true),
      quantityMilli: integer(row.quantityMilli, 1, MAX_CENTS),
      subtotalCents,
      taxCents,
      totalCents,
    };
  });
  const totals = {
    subtotalCents: integer(expectedTotals.subtotalCents, -MAX_CENTS, MAX_CENTS),
    taxCents: integer(expectedTotals.taxCents, -MAX_CENTS, MAX_CENTS),
    totalCents: integer(expectedTotals.totalCents, 1, MAX_CENTS),
  };
  const actual = lines.reduce((sum, line) => ({
    subtotalCents: sum.subtotalCents + line.subtotalCents,
    taxCents: sum.taxCents + line.taxCents,
    totalCents: sum.totalCents + line.totalCents,
  }), { subtotalCents: 0, taxCents: 0, totalCents: 0 });
  if (
    totals.subtotalCents + totals.taxCents !== totals.totalCents
    || actual.subtotalCents !== totals.subtotalCents
    || actual.taxCents !== totals.taxCents
    || actual.totalCents !== totals.totalCents
  ) throw new Error("INVALID_ACCOUNTING_SCOPE");
  return { lines, totals };
}

export function quickInvoiceAccountingScope(
  sourceLines: unknown,
  stored: AcceptedScopeTotals & { discountCents: number },
) {
  if (!Array.isArray(sourceLines) || sourceLines.length < 1 || sourceLines.length > 300) {
    throw new Error("INVALID_ACCOUNTING_SCOPE");
  }
  const quickLines = sourceLines.map((candidate): QuickInvoiceLine => {
    const row = firstObject(candidate);
    const taxCode = String(row.taxCode || "");
    if (taxCode !== "gst" && taxCode !== "none") throw new Error("INVALID_ACCOUNTING_SCOPE");
    return {
      lineId: text(row.lineId, 180, true),
      priceBookItemId: text(row.priceBookItemId, 180),
      priceRevision: integer(row.priceRevision ?? 0, 0, MAX_CENTS),
      description: text(row.description, 500, true),
      quantity: integer(row.quantity, 1, MAX_CENTS),
      unitPriceCentsExGst: integer(row.unitPriceCentsExGst ?? 0, 0, MAX_CENTS),
      taxCode,
      subtotalCents: integer(row.subtotalCents, 0, MAX_CENTS),
      taxCents: integer(row.taxCents, 0, MAX_CENTS),
      totalCents: integer(row.totalCents, 0, MAX_CENTS),
    };
  });
  let totals: ReturnType<typeof quickInvoiceTotals>;
  try { totals = quickInvoiceTotals(quickLines, integer(stored.discountCents, 0, MAX_CENTS)); }
  catch { throw new Error("INVALID_ACCOUNTING_SCOPE"); }
  if (
    totals.subtotalCents !== integer(stored.subtotalCents, 0, MAX_CENTS)
    || totals.taxCents !== integer(stored.taxCents, 0, MAX_CENTS)
    || totals.totalCents !== integer(stored.totalCents, 1, MAX_CENTS)
  ) throw new Error("INVALID_ACCOUNTING_SCOPE");
  const lines: AcceptedScopeLine[] = quickLines.map((line) => ({
    lineId: line.lineId,
    lineType: "product",
    section: line.taxCode === "gst" ? "GST taxable" : "GST-free",
    description: line.description,
    quantityMilli: line.quantity * 1000,
    subtotalCents: line.subtotalCents,
    taxCents: line.taxCents,
    totalCents: line.totalCents,
  }));
  const grossTaxCents = quickLines.reduce((sum, line) => sum + line.taxCents, 0);
  const taxDiscountCents = grossTaxCents - totals.taxCents;
  if (totals.taxableDiscountCents > 0) lines.push({
    lineId: "overall-discount-gst",
    lineType: "adjustment",
    section: "Discount",
    description: "Overall invoice discount (GST taxable share)",
    quantityMilli: 1000,
    subtotalCents: -totals.taxableDiscountCents,
    taxCents: -taxDiscountCents,
    totalCents: -(totals.taxableDiscountCents + taxDiscountCents),
  });
  if (totals.gstFreeDiscountCents > 0) lines.push({
    lineId: "overall-discount-gst-free",
    lineType: "adjustment",
    section: "Discount",
    description: "Overall invoice discount (GST-free share)",
    quantityMilli: 1000,
    subtotalCents: -totals.gstFreeDiscountCents,
    taxCents: 0,
    totalCents: -totals.gstFreeDiscountCents,
  });
  return accountingExportScope(lines, {
    subtotalCents: totals.subtotalCents - totals.discountCents,
    taxCents: totals.taxCents,
    totalCents: totals.totalCents,
  });
}

export async function acceptedInvoiceSourceSha256(input: {
  acceptanceId: string;
  commercialHandoffId: string;
  quoteId: string;
  quoteVersionId: string;
  workOrderId: string;
  firebaseUid: string;
  crmCustomerId: string;
  scope: AccountingExportScope;
}) {
  return sha256Hex(canonicalJson({
    schemaVersion: "trade-accepted-invoice-source-v1",
    acceptanceId: text(input.acceptanceId, 180, true),
    commercialHandoffId: text(input.commercialHandoffId, 180, true),
    quoteId: text(input.quoteId, 180, true),
    quoteVersionId: text(input.quoteVersionId, 180, true),
    workOrderId: text(input.workOrderId, 180, true),
    firebaseUid: text(input.firebaseUid, 180, true),
    crmCustomerId: text(input.crmCustomerId, 180, true),
    currency: "AUD",
    lines: input.scope.lines,
    totals: input.scope.totals,
  }));
}

export async function accountingProviderIdentity(
  sourceIdentity: string,
  humanReference: string,
): Promise<AccountingProviderIdentity> {
  const digest = await sha256Hex(text(sourceIdentity, 20_000, true));
  const human = text(humanReference, 120).toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "");
  const xeroBase = `AEA-${human || "INVOICE"}`;
  return {
    xeroIdempotencyKey: `tlink-invoice-${digest}`,
    quickBooksRequestId: `tlk-${digest.slice(0, 46)}`,
    xeroNumber: `${xeroBase.slice(0, 36).replace(/-$/g, "")}-${digest.slice(0, 12)}`,
    myobNumber: `TL-${digest.slice(0, 10).toUpperCase()}`,
    quickBooksNumber: `TL-${digest.slice(0, 18).toUpperCase()}`,
  };
}

function expectedContactValue(actual: unknown, expected: unknown, phone = false) {
  const expectedValue = phone ? comparablePhone(expected) : comparable(expected);
  if (!expectedValue) return;
  const actualValue = phone ? comparablePhone(actual) : comparable(actual);
  if (actualValue !== expectedValue) throw new Error("PROVIDER_RECORD_MISMATCH");
}

export function assertProviderContactMatches(
  provider: AccountingProvider,
  contact: Row,
  expected: ProviderContactExpectation,
) {
  const id = String(provider === "xero" ? contact.ContactID : provider === "myob" ? contact.UID : contact.Id || "");
  if (!id || (expected.storedId && id !== expected.storedId)) throw new Error("PROVIDER_RECORD_MISMATCH");
  if (provider === "xero") {
    if (String(contact.ContactNumber || "") !== expected.reference) throw new Error("PROVIDER_RECORD_MISMATCH");
    expectedContactValue(contact.Name, expected.displayName);
    expectedContactValue(contact.FirstName, expected.firstName);
    expectedContactValue(contact.LastName, expected.lastName);
    expectedContactValue(contact.EmailAddress, expected.email);
    const phones = list(contact.Phones);
    const primary = phones.find((phone) => String(phone.PhoneType || "").toUpperCase() === "DEFAULT") || phones[0] || {};
    expectedContactValue(primary.PhoneNumber, expected.phone, true);
    const address = list(contact.Addresses).find((candidate) => String(candidate.AddressType || "").toUpperCase() === "STREET") || list(contact.Addresses)[0] || {};
    expectedContactValue(address.AddressLine1, expected.addressLine1);
    expectedContactValue(address.City, expected.suburb);
    expectedContactValue(address.Region, expected.state);
    expectedContactValue(address.PostalCode, expected.postcode);
  } else if (provider === "myob") {
    if (String(contact.DisplayID || "") !== expected.reference) throw new Error("PROVIDER_RECORD_MISMATCH");
    expectedContactValue(contact.CompanyName, expected.businessName);
    expectedContactValue(contact.FirstName, expected.firstName);
    expectedContactValue(contact.LastName, expected.lastName);
    const address = list(contact.Addresses)[0] || {};
    expectedContactValue(address.Email, expected.email);
    expectedContactValue(address.Phone1, expected.phone, true);
    expectedContactValue(String(address.Street || "").split("\n")[0], expected.addressLine1);
    expectedContactValue(address.City, expected.suburb);
    expectedContactValue(address.State, expected.state);
    expectedContactValue(address.PostCode, expected.postcode);
  } else {
    if (String(contact.DisplayName || "") !== expected.reference) throw new Error("PROVIDER_RECORD_MISMATCH");
    expectedContactValue(contact.DisplayName, expected.displayName);
    expectedContactValue(contact.CompanyName, expected.businessName);
    expectedContactValue(contact.GivenName, expected.firstName);
    expectedContactValue(contact.FamilyName, expected.lastName);
    expectedContactValue(firstObject(contact.PrimaryEmailAddr).Address, expected.email);
    expectedContactValue(firstObject(contact.PrimaryPhone).FreeFormNumber, expected.phone, true);
    const address = firstObject(contact.BillAddr);
    expectedContactValue(address.Line1, expected.addressLine1);
    expectedContactValue(address.City, expected.suburb);
    expectedContactValue(address.CountrySubDivisionCode, expected.state);
    expectedContactValue(address.PostalCode, expected.postcode);
  }
  return id;
}

type ProviderExportReconciliation<TContact extends Row, TInvoice extends Row> = {
  storedContactId?: string;
  findContacts: () => Promise<TContact[]>;
  findInvoices: () => Promise<TInvoice[]>;
  validateContact: (contact: TContact) => string;
  validateInvoice: (invoice: TInvoice, contactId: string) => void;
  createContact: () => Promise<TContact>;
  createInvoice: (contactId: string) => Promise<TInvoice>;
};

export async function reconcileProviderExport<TContact extends Row, TInvoice extends Row>(
  input: ProviderExportReconciliation<TContact, TInvoice>,
) {
  const contacts = await input.findContacts();
  if (contacts.length > 1) throw new Error("PROVIDER_RECORD_COLLISION");
  let contactId = "";
  if (contacts[0]) {
    try { contactId = input.validateContact(contacts[0]); }
    catch { throw new Error("PROVIDER_RECORD_COLLISION"); }
  } else if (input.storedContactId) {
    throw new Error("PROVIDER_RECORD_COLLISION");
  }

  const invoices = await input.findInvoices();
  if (invoices.length > 1) throw new Error("PROVIDER_RECORD_COLLISION");
  if (invoices[0]) {
    if (!contactId) throw new Error("PROVIDER_RECORD_COLLISION");
    try { input.validateInvoice(invoices[0], contactId); }
    catch { throw new Error("PROVIDER_RECORD_COLLISION"); }
    return { contactId, invoice: invoices[0], adopted: true };
  }

  if (!contactId) {
    const createdContact = await input.createContact();
    contactId = input.validateContact(createdContact);
  }
  if (!contactId) throw new Error("PROVIDER_RECORD_MISMATCH");
  const invoice = await input.createInvoice(contactId);
  return { contactId, invoice, adopted: false };
}

function quickBooksTaxCodeRate(code: Row, rates: Map<string, number>) {
  const details = list(firstObject(code.SalesTaxRateList).TaxRateDetail);
  if (!details.length) {
    const name = comparable(code.Name);
    return code.Taxable === false || /(?:gst[ -]?free|exempt|\bfre\b)/.test(name) ? 0 : null;
  }
  let total = 0;
  for (const detail of details) {
    const rateId = String(firstObject(detail.TaxRateRef).value || "");
    const rate = rates.get(rateId);
    if (!rateId || rate === undefined) return null;
    total += rate;
  }
  return total;
}

function selectQuickBooksTaxCode(candidates: Array<{ id: string; name: string }>, preferred: RegExp) {
  const preferredCandidates = candidates.filter((candidate) => preferred.test(candidate.name));
  const available = preferredCandidates.length ? preferredCandidates : candidates;
  if (available.length !== 1) throw new Error("QUICKBOOKS_TAX_CODES_REQUIRED");
  return available[0].id;
}

export function quickBooksAuSalesTaxCodes(input: {
  usingSalesTax: unknown;
  taxCodes: unknown;
  taxRates: unknown;
}): QuickBooksTaxCodes {
  if (input.usingSalesTax !== true) throw new Error("QUICKBOOKS_TAX_CODES_REQUIRED");
  const rateById = new Map(list(input.taxRates)
    .filter((rate) => rate.Active !== false && String(rate.Id || ""))
    .map((rate) => [String(rate.Id), Number(rate.RateValue)]));
  const candidates = list(input.taxCodes).flatMap((code) => {
    const id = String(code.Id || "");
    const upperId = id.toUpperCase();
    if (!id || code.Active === false || upperId === "TAX" || upperId === "NON") return [];
    const rate = quickBooksTaxCodeRate(code, rateById);
    if (rate === null || !Number.isFinite(rate)) return [];
    return [{ id, name: comparable(code.Name), rate }];
  });
  const gst = candidates.filter((candidate) => Math.abs(candidate.rate - 10) < 0.000001);
  const free = candidates.filter((candidate) => Math.abs(candidate.rate) < 0.000001);
  return {
    gst: selectQuickBooksTaxCode(gst, /^(?:gst|gst 10%|gst on (?:income|sales))$/),
    free: selectQuickBooksTaxCode(free, /^(?:fre|exempt|gst[ -]?free(?: (?:income|sales))?)$/),
  };
}

export function xeroInvoicePayload(input: {
  number: string;
  contactId: string;
  reference: string;
  date: string;
  dueDate: string;
  scope: AccountingExportScope;
}) {
  return { Invoices: [{
    Type: "ACCREC",
    Contact: { ContactID: input.contactId },
    InvoiceNumber: input.number,
    Date: input.date,
    DueDate: input.dueDate,
    Reference: text(input.reference, 100),
    CurrencyCode: "AUD",
    Status: "DRAFT",
    LineAmountTypes: "Exclusive",
    LineItems: input.scope.lines.map((line) => ({
      Description: providerDescription(line),
      Quantity: 1,
      UnitAmount: line.subtotalCents / 100,
      TaxAmount: line.taxCents / 100,
      TaxType: line.taxCents === 0 ? "EXEMPTOUTPUT" : "OUTPUT",
    })),
  }] };
}

export function myobInvoicePayload(input: {
  number: string;
  contactId: string;
  reference: string;
  date: string;
  accountId: string;
  taxCodes: { gst: string; free: string };
  scope: AccountingExportScope;
}) {
  return {
    Number: input.number,
    Date: `${input.date} 00:00:00`,
    Customer: { UID: input.contactId },
    CustomerPurchaseOrderNumber: text(input.reference, 100),
    Lines: input.scope.lines.map((line) => ({
      Type: "Transaction",
      Description: providerDescription(line),
      Total: line.subtotalCents / 100,
      Account: { UID: input.accountId },
      TaxCode: { UID: taxCodeForLine(line, input.taxCodes) },
    })),
    InvoiceDeliveryStatus: "Nothing",
    IsTaxInclusive: false,
  };
}

export function quickBooksInvoicePayload(input: {
  number: string;
  contactId: string;
  reference: string;
  date: string;
  dueDate: string;
  item: { id: string; name: string };
  taxCodes: { gst: string; free: string };
  scope: AccountingExportScope;
}) {
  return {
    CustomerRef: { value: input.contactId },
    DocNumber: input.number,
    TxnDate: input.date,
    DueDate: input.dueDate,
    PrivateNote: text(`TLink invoice ${input.reference}`, 4000),
    GlobalTaxCalculation: "TaxExcluded",
    Line: input.scope.lines.map((line) => {
      const taxCode = taxCodeForLine(line, input.taxCodes);
      if (line.subtotalCents < 0) {
        return {
          Amount: Math.abs(line.subtotalCents) / 100,
          Description: providerDescription(line),
          DetailType: "DiscountLineDetail",
          DiscountLineDetail: { PercentBased: false, TaxCodeRef: { value: taxCode } },
        };
      }
      return {
        Amount: line.subtotalCents / 100,
        Description: providerDescription(line),
        DetailType: "SalesItemLineDetail",
        SalesItemLineDetail: {
          ItemRef: { value: input.item.id, name: input.item.name },
          Qty: 1,
          UnitPrice: line.subtotalCents / 100,
          TaxCodeRef: { value: taxCode },
        },
      };
    }),
  };
}

function providerLines(provider: AccountingProvider, invoice: Row) {
  if (provider === "xero") {
    return list(invoice.LineItems).map((line) => ({
      description: text(line.Description, 500),
      subtotalCents: signedCents(line.LineAmount ?? Number(line.UnitAmount || 0) * Number(line.Quantity || 1)),
      taxCents: optionalSignedCents(line.TaxAmount),
      taxCode: String(line.TaxType || ""),
    }));
  }
  if (provider === "myob") {
    return list(invoice.Lines).filter((line) => String(line.Type || "") === "Transaction").map((line) => ({
      description: text(line.Description, 500),
      subtotalCents: signedCents(line.Total),
      taxCents: null,
      taxCode: String(firstObject(line.TaxCode).UID || ""),
    }));
  }
  return list(invoice.Line).flatMap((line) => {
    const detailType = String(line.DetailType || "");
    if (detailType !== "SalesItemLineDetail" && detailType !== "DiscountLineDetail") return [];
    const detail = firstObject(detailType === "DiscountLineDetail" ? line.DiscountLineDetail : line.SalesItemLineDetail);
    return [{
      description: text(line.Description, 500),
      subtotalCents: signedCents(line.Amount) * (detailType === "DiscountLineDetail" ? -1 : 1),
      taxCents: null,
      taxCode: String(firstObject(detail.TaxCodeRef).value || ""),
    }];
  });
}

export function providerInvoiceTotals(provider: AccountingProvider, invoice: Row) {
  const lines = providerLines(provider, invoice);
  const lineSubtotalCents = lines.reduce((sum, line) => sum + line.subtotalCents, 0);
  const subtotalValue = provider === "xero" ? invoice.SubTotal : provider === "myob" ? invoice.Subtotal : lineSubtotalCents / 100;
  const taxValue = provider === "xero" ? invoice.TotalTax
    : provider === "myob" ? (invoice.TotalTax ?? invoice.GSTAmount)
      : firstObject(invoice.TxnTaxDetail).TotalTax;
  const totalValue = provider === "xero" ? invoice.Total : provider === "myob" ? invoice.TotalAmount : invoice.TotalAmt;
  return {
    subtotalCents: signedCents(subtotalValue),
    taxCents: signedCents(taxValue),
    totalCents: signedCents(totalValue),
  };
}

export function assertProviderInvoiceMatches(
  provider: AccountingProvider,
  invoice: Row,
  expectation: ProviderInvoiceExpectation,
) {
  const number = String(provider === "xero" ? invoice.InvoiceNumber : provider === "myob" ? invoice.Number : invoice.DocNumber);
  const contact = firstObject(provider === "xero" ? invoice.Contact : provider === "myob" ? invoice.Customer : invoice.CustomerRef);
  const contactId = String(provider === "xero" ? contact.ContactID : provider === "myob" ? contact.UID : contact.value);
  if (number !== expectation.number || contactId !== expectation.contactId) throw new Error("PROVIDER_RECORD_MISMATCH");
  const totals = providerInvoiceTotals(provider, invoice);
  if (
    totals.subtotalCents !== expectation.scope.totals.subtotalCents
    || totals.taxCents !== expectation.scope.totals.taxCents
    || totals.totalCents !== expectation.scope.totals.totalCents
  ) throw new Error("PROVIDER_RECORD_MISMATCH");
  if (provider === "myob" && invoice.IsTaxInclusive !== false) throw new Error("PROVIDER_RECORD_MISMATCH");
  const actual = providerLines(provider, invoice);
  if (actual.length !== expectation.scope.lines.length) throw new Error("PROVIDER_RECORD_MISMATCH");
  expectation.scope.lines.forEach((line, index) => {
    const candidate = actual[index];
    if (!candidate || candidate.description !== providerDescription(line) || candidate.subtotalCents !== line.subtotalCents) {
      throw new Error("PROVIDER_RECORD_MISMATCH");
    }
    if (provider === "xero" && candidate.taxCents !== line.taxCents) throw new Error("PROVIDER_RECORD_MISMATCH");
    if (provider === "myob") {
      const codes = expectation.myobTaxCodes;
      if (!codes || candidate.taxCode !== taxCodeForLine(line, codes)) throw new Error("PROVIDER_RECORD_MISMATCH");
    }
    if (provider === "quickbooks") {
      const codes = expectation.quickBooksTaxCodes;
      if (!codes || candidate.taxCode !== taxCodeForLine(line, codes)) throw new Error("PROVIDER_RECORD_MISMATCH");
    }
  });
  return totals;
}

export function assertProviderTotalsMatch(
  provider: AccountingProvider,
  invoice: Row,
  expected: AcceptedScopeTotals,
) {
  const totals = providerInvoiceTotals(provider, invoice);
  if (
    totals.subtotalCents !== expected.subtotalCents
    || totals.taxCents !== expected.taxCents
    || totals.totalCents !== expected.totalCents
  ) throw new Error("PROVIDER_RECORD_MISMATCH");
  return totals;
}
