import test from "node:test";
import assert from "node:assert/strict";
import {
  accountingExportScope,
  accountingProviderIdentity,
  assertProviderContactMatches,
  assertProviderInvoiceMatches,
  assertProviderTotalsMatch,
  myobInvoicePayload,
  quickBooksAuSalesTaxCodes,
  quickInvoiceAccountingScope,
  quickBooksInvoicePayload,
  reconcileProviderExport,
  xeroInvoicePayload,
} from "../src/lib/trade-accounting-export.ts";

const scope = accountingExportScope([
  {
    lineId: "heat-pump",
    lineType: "product",
    section: "Included work",
    description: "Heat pump installation",
    quantityMilli: 1000,
    subtotalCents: 500_00,
    taxCents: 50_00,
    totalCents: 550_00,
  },
  {
    lineId: "stc",
    lineType: "adjustment",
    section: "Certificates and rebates",
    description: "STC certificate value",
    quantityMilli: 30000,
    subtotalCents: -100_00,
    taxCents: -10_00,
    totalCents: -110_00,
  },
  {
    lineId: "grant",
    lineType: "adjustment",
    section: "Certificates and rebates",
    description: "GST-free grant",
    quantityMilli: 1000,
    subtotalCents: -40_00,
    taxCents: 0,
    totalCents: -40_00,
  },
], { subtotalCents: 360_00, taxCents: 40_00, totalCents: 400_00 });

const identityInput = "accepted_quote:invoice-a:handoff-a:INV-TLJ-123";
const qboTaxCodes = { gst: "qbo-taxcode-gst-sales-opaque", free: "qbo-taxcode-gst-free-sales-opaque" };
const contactExpectations = {
  xero: {
    reference: "AEACUS000123", displayName: "Example Electrical", businessName: "Example Electrical",
    email: "office@example.test", phone: "0412 345 678", addressLine1: "1 Test Street", suburb: "Melbourne", state: "VIC", postcode: "3000",
  },
  myob: {
    reference: "AEACUS000123", displayName: "Example Electrical", businessName: "Example Electrical",
    email: "office@example.test", phone: "0412 345 678", addressLine1: "1 Test Street", suburb: "Melbourne", state: "VIC", postcode: "3000",
  },
  quickbooks: {
    reference: "TLink CUS-000123 | Example Electrical", displayName: "TLink CUS-000123 | Example Electrical", businessName: "Example Electrical",
    email: "office@example.test", phone: "0412 345 678", addressLine1: "1 Test Street", suburb: "Melbourne", state: "VIC", postcode: "3000",
  },
};
const contactFixtures = {
  xero: {
    ContactID: "xero-contact", ContactNumber: contactExpectations.xero.reference, Name: "Example Electrical",
    EmailAddress: "office@example.test", Phones: [{ PhoneType: "DEFAULT", PhoneNumber: "0412 345 678" }],
    Addresses: [{ AddressType: "STREET", AddressLine1: "1 Test Street", City: "Melbourne", Region: "VIC", PostalCode: "3000" }],
  },
  myob: {
    UID: "myob-contact", DisplayID: contactExpectations.myob.reference, CompanyName: "Example Electrical",
    Addresses: [{ Location: 1, Street: "1 Test Street", City: "Melbourne", State: "VIC", PostCode: "3000", Phone1: "0412 345 678", Email: "office@example.test" }],
  },
  quickbooks: {
    Id: "qbo-contact", DisplayName: contactExpectations.quickbooks.reference, CompanyName: "Example Electrical",
    PrimaryEmailAddr: { Address: "office@example.test" }, PrimaryPhone: { FreeFormNumber: "0412 345 678" },
    BillAddr: { Line1: "1 Test Street", City: "Melbourne", CountrySubDivisionCode: "VIC", PostalCode: "3000" },
  },
};

function exactProviderInvoice(provider) {
  if (provider === "xero") {
    const invoice = xeroInvoicePayload({ number: "RETRY-XERO", contactId: "xero-contact", reference: "INV-TLJ-123", date: "2026-08-13", dueDate: "2026-08-27", scope }).Invoices[0];
    return { ...invoice, InvoiceID: "xero-invoice", LineItems: invoice.LineItems.map((line) => ({ ...line, LineAmount: line.UnitAmount })), SubTotal: 360, TotalTax: 40, Total: 400 };
  }
  if (provider === "myob") {
    const invoice = myobInvoicePayload({ number: "TL-1234567890", contactId: "myob-contact", reference: "INV-TLJ-123", date: "2026-08-13", accountId: "income", taxCodes: { gst: "myob-gst", free: "myob-free" }, scope });
    return { ...invoice, UID: "myob-invoice", Subtotal: 360, TotalTax: 40, TotalAmount: 400 };
  }
  const invoice = quickBooksInvoicePayload({ number: "RETRY-QBO", contactId: "qbo-contact", reference: "INV-TLJ-123", date: "2026-08-13", dueDate: "2026-08-27", item: { id: "item", name: "Work" }, taxCodes: qboTaxCodes, scope });
  return { ...invoice, Id: "qbo-invoice", TxnTaxDetail: { TotalTax: 40 }, TotalAmt: 400 };
}

function invoiceExpectation(provider) {
  const number = provider === "xero" ? "RETRY-XERO" : provider === "myob" ? "TL-1234567890" : "RETRY-QBO";
  const contactId = provider === "xero" ? "xero-contact" : provider === "myob" ? "myob-contact" : "qbo-contact";
  return {
    number,
    contactId,
    scope,
    ...(provider === "myob" ? { myobTaxCodes: { gst: "myob-gst", free: "myob-free" } } : {}),
    ...(provider === "quickbooks" ? { quickBooksTaxCodes: qboTaxCodes } : {}),
  };
}

test("provider identities are stable, bounded and collision resistant", async () => {
  const first = await accountingProviderIdentity(identityInput, "INV-TLJ-123");
  const retry = await accountingProviderIdentity(identityInput, "INV-TLJ-123");
  const collision = await accountingProviderIdentity(`${identityInput}-different`, "INV-TLJ-123");
  assert.deepEqual(retry, first);
  assert.equal(first.myobNumber.length, 13);
  assert.ok(first.quickBooksRequestId.length <= 50);
  assert.ok(first.xeroIdempotencyKey.length <= 128);
  assert.notEqual(collision.myobNumber, first.myobNumber);
  assert.notEqual(collision.quickBooksRequestId, first.quickBooksRequestId);
  assert.notEqual(collision.xeroIdempotencyKey, first.xeroIdempotencyKey);
});

test("Xero fixture exports every signed line with exact mixed GST", () => {
  const payload = xeroInvoicePayload({
    number: "AEA-INV-123-A1B2",
    contactId: "xero-contact",
    reference: "INV-TLJ-123",
    date: "2026-08-13",
    dueDate: "2026-08-27",
    scope,
  });
  const invoice = payload.Invoices[0];
  assert.equal(invoice.LineItems.length, 3);
  assert.deepEqual(invoice.LineItems.map((line) => [line.UnitAmount, line.TaxAmount]), [
    [500, 50], [-100, -10], [-40, 0],
  ]);
  const providerRecord = {
    ...invoice,
    InvoiceID: "xero-invoice",
    Contact: { ContactID: "xero-contact" },
    LineItems: invoice.LineItems.map((line) => ({ ...line, LineAmount: line.UnitAmount })),
    SubTotal: 360,
    TotalTax: 40,
    Total: 400,
  };
  assert.deepEqual(assertProviderInvoiceMatches("xero", providerRecord, {
    number: invoice.InvoiceNumber,
    contactId: "xero-contact",
    scope,
  }), scope.totals);
});

test("MYOB fixture exports signed exclusive lines using GST and FRE codes", () => {
  const payload = myobInvoicePayload({
    number: "TL-1234567890",
    contactId: "myob-contact",
    reference: "INV-TLJ-123",
    date: "2026-08-13",
    accountId: "income-account",
    taxCodes: { gst: "myob-gst", free: "myob-fre" },
    scope,
  });
  assert.equal(payload.IsTaxInclusive, false);
  assert.deepEqual(payload.Lines.map((line) => [line.Total, line.TaxCode.UID]), [
    [500, "myob-gst"], [-100, "myob-gst"], [-40, "myob-fre"],
  ]);
  const providerRecord = {
    ...payload,
    UID: "myob-invoice",
    Customer: { UID: "myob-contact" },
    Subtotal: 360,
    TotalTax: 40,
    TotalAmount: 400,
  };
  assert.deepEqual(assertProviderInvoiceMatches("myob", providerRecord, {
    number: payload.Number,
    contactId: "myob-contact",
    scope,
    myobTaxCodes: { gst: "myob-gst", free: "myob-fre" },
  }), scope.totals);
});

test("QuickBooks AU fixture uses discovered opaque sales tax codes and represents signed certificates as discounts", () => {
  const discovered = quickBooksAuSalesTaxCodes({
    usingSalesTax: true,
    taxRates: [
      { Id: "qbo-rate-gst-sales", Active: true, RateValue: 10 },
      { Id: "qbo-rate-gst-free-sales", Active: true, RateValue: 0 },
    ],
    taxCodes: [
      { Id: "TAX", Active: true, Name: "Pseudo taxable", SalesTaxRateList: { TaxRateDetail: [{ TaxRateRef: { value: "qbo-rate-gst-sales" } }] } },
      { Id: "NON", Active: true, Name: "Pseudo non-taxable", Taxable: false },
      { Id: qboTaxCodes.gst, Active: true, Name: "GST on Sales", SalesTaxRateList: { TaxRateDetail: [{ TaxRateRef: { value: "qbo-rate-gst-sales" } }] } },
      { Id: qboTaxCodes.free, Active: true, Name: "GST Free Sales", SalesTaxRateList: { TaxRateDetail: [{ TaxRateRef: { value: "qbo-rate-gst-free-sales" } }] } },
    ],
  });
  assert.deepEqual(discovered, qboTaxCodes);
  const payload = quickBooksInvoicePayload({
    number: "TL-123456789012345678",
    contactId: "qbo-contact",
    reference: "INV-TLJ-123",
    date: "2026-08-13",
    dueDate: "2026-08-27",
    item: { id: "qbo-item", name: "Accepted work" },
    taxCodes: discovered,
    scope,
  });
  assert.deepEqual(payload.Line.map((line) => [line.DetailType, line.Amount]), [
    ["SalesItemLineDetail", 500],
    ["DiscountLineDetail", 100],
    ["DiscountLineDetail", 40],
  ]);
  assert.ok(payload.Line.every((line) => line.Amount >= 0));
  assert.deepEqual(payload.Line.map((line) => (line.DiscountLineDetail || line.SalesItemLineDetail).TaxCodeRef.value), [
    qboTaxCodes.gst, qboTaxCodes.gst, qboTaxCodes.free,
  ]);
  assert.doesNotMatch(JSON.stringify(payload), /\"(?:TAX|NON)\"/);
  const providerRecord = {
    ...payload,
    Id: "qbo-invoice",
    CustomerRef: { value: "qbo-contact" },
    TxnTaxDetail: { TotalTax: 40 },
    TotalAmt: 400,
  };
  assert.deepEqual(assertProviderInvoiceMatches("quickbooks", providerRecord, {
    number: payload.DocNumber,
    contactId: "qbo-contact",
    scope,
    quickBooksTaxCodes: discovered,
  }), scope.totals);
});

test("QuickBooks AU tax setup fails closed before provider writes", async () => {
  let writes = 0;
  const exportWithTaxSetup = async (taxSetup) => {
    quickBooksAuSalesTaxCodes(taxSetup);
    return reconcileProviderExport({
      findContacts: async () => [],
      findInvoices: async () => [],
      validateContact: () => "",
      validateInvoice: () => {},
      createContact: async () => { writes += 1; return "contact"; },
      createInvoice: async () => { writes += 1; return {}; },
    });
  };
  await assert.rejects(() => exportWithTaxSetup({ usingSalesTax: false, taxCodes: [], taxRates: [] }), /QUICKBOOKS_TAX_CODES_REQUIRED/);
  await assert.rejects(() => exportWithTaxSetup({
    usingSalesTax: true,
    taxRates: [{ Id: "rate", Active: true, RateValue: 10 }],
    taxCodes: [{ Id: "TAX", Active: true, Name: "Tax", SalesTaxRateList: { TaxRateDetail: [{ TaxRateRef: { value: "rate" } }] } }],
  }), /QUICKBOOKS_TAX_CODES_REQUIRED/);
  assert.equal(writes, 0);
});

test("discounted mixed-GST quick invoice exports exact immutable adjustment lines", () => {
  const exported = quickInvoiceAccountingScope([
    { lineId: "taxable", priceBookItemId: "taxable", priceRevision: 1, description: "Taxable work", quantity: 1, unitPriceCentsExGst: 10_000, taxCode: "gst", subtotalCents: 10_000, taxCents: 1_000, totalCents: 11_000 },
    { lineId: "free", priceBookItemId: "free", priceRevision: 1, description: "GST-free work", quantity: 1, unitPriceCentsExGst: 10_000, taxCode: "none", subtotalCents: 10_000, taxCents: 0, totalCents: 10_000 },
  ], { subtotalCents: 20_000, discountCents: 3_001, taxCents: 850, totalCents: 17_849 });
  assert.deepEqual(exported.totals, { subtotalCents: 16_999, taxCents: 850, totalCents: 17_849 });
  assert.deepEqual(exported.lines.slice(-2).map((line) => [line.lineType, line.subtotalCents, line.taxCents, line.totalCents]), [
    ["adjustment", -1_501, -150, -1_651],
    ["adjustment", -1_500, 0, -1_500],
  ]);
  const qbo = quickBooksInvoicePayload({
    number: "TL-DISCOUNTED", contactId: "qbo-contact", reference: "INV-DISCOUNTED",
    date: "2026-08-13", dueDate: "2026-08-27", item: { id: "item", name: "Work" },
    taxCodes: qboTaxCodes, scope: exported,
  });
  assert.deepEqual(qbo.Line.slice(-2).map((line) => [line.DetailType, line.Amount]), [
    ["DiscountLineDetail", 15.01], ["DiscountLineDetail", 15],
  ]);
  assert.ok(qbo.Line.every((line) => line.Amount >= 0));
});

test("retry adoption fails closed on reference, contact, line or total collisions", () => {
  const xero = {
    InvoiceID: "xero-invoice",
    InvoiceNumber: "EXPECTED",
    Contact: { ContactID: "contact" },
    LineItems: scope.lines.map((line) => ({
      Description: line.description + (line.quantityMilli === 1000 ? "" : ` | accepted quantity ${line.quantityMilli / 1000}`),
      LineAmount: line.subtotalCents / 100,
      TaxAmount: line.taxCents / 100,
      TaxType: line.taxCents === 0 ? "EXEMPTOUTPUT" : "OUTPUT",
    })),
    SubTotal: 360,
    TotalTax: 40,
    Total: 400,
  };
  const expected = { number: "EXPECTED", contactId: "contact", scope };
  assert.doesNotThrow(() => assertProviderInvoiceMatches("xero", xero, expected));
  assert.throws(() => assertProviderInvoiceMatches("xero", { ...xero, InvoiceNumber: "COLLISION" }, expected), /PROVIDER_RECORD_MISMATCH/);
  assert.throws(() => assertProviderInvoiceMatches("xero", { ...xero, Contact: { ContactID: "other" } }, expected), /PROVIDER_RECORD_MISMATCH/);
  assert.throws(() => assertProviderInvoiceMatches("xero", { ...xero, TotalTax: 39.99, Total: 399.99 }, expected), /PROVIDER_RECORD_MISMATCH/);
  assert.throws(() => assertProviderTotalsMatch("xero", { ...xero, SubTotal: 359.99 }, scope.totals), /PROVIDER_RECORD_MISMATCH/);
});

test("all providers adopt one exact retry without a duplicate write and reject mismatched collisions", async () => {
  for (const provider of ["xero", "myob", "quickbooks"]) {
    let writes = 0;
    const expectation = invoiceExpectation(provider);
    const exact = exactProviderInvoice(provider);
    const retry = await reconcileProviderExport({
      findContacts: async () => [contactFixtures[provider]],
      findInvoices: async () => [exact],
      validateContact: (contact) => assertProviderContactMatches(provider, contact, contactExpectations[provider]),
      validateInvoice: (invoice, contactId) => assertProviderInvoiceMatches(provider, invoice, { ...expectation, contactId }),
      createContact: async () => { writes += 1; return contactFixtures[provider]; },
      createInvoice: async () => { writes += 1; return exact; },
    });
    assert.equal(retry.adopted, true);
    assert.equal(writes, 0);
    const collision = structuredClone(exact);
    if (provider === "xero") collision.Total = 399.99;
    if (provider === "myob") collision.TotalAmount = 399.99;
    if (provider === "quickbooks") collision.TotalAmt = 399.99;
    await assert.rejects(() => reconcileProviderExport({
      findContacts: async () => [contactFixtures[provider]],
      findInvoices: async () => [collision],
      validateContact: (contact) => assertProviderContactMatches(provider, contact, contactExpectations[provider]),
      validateInvoice: (invoice, contactId) => assertProviderInvoiceMatches(provider, invoice, { ...expectation, contactId }),
      createContact: async () => { writes += 1; return contactFixtures[provider]; },
      createInvoice: async () => { writes += 1; return exact; },
    }), /PROVIDER_RECORD_COLLISION/);
    assert.equal(writes, 0);
  }
});

test("existing customer identity mismatches stop all provider writes", async () => {
  for (const provider of ["xero", "myob", "quickbooks"]) {
    let contactPosts = 0;
    let invoicePosts = 0;
    const bad = structuredClone(contactFixtures[provider]);
    if (provider === "xero") bad.Name = "Other Customer";
    if (provider === "myob") bad.CompanyName = "Other Customer";
    if (provider === "quickbooks") bad.CompanyName = "Other Customer";
    await assert.rejects(() => reconcileProviderExport({
      findContacts: async () => [bad],
      findInvoices: async () => [],
      validateContact: (contact) => assertProviderContactMatches(provider, contact, contactExpectations[provider]),
      validateInvoice: () => {},
      createContact: async () => { contactPosts += 1; return contactFixtures[provider]; },
      createInvoice: async () => { invoicePosts += 1; return {}; },
    }), /PROVIDER_RECORD_COLLISION/);
    assert.deepEqual({ contactPosts, invoicePosts }, { contactPosts: 0, invoicePosts: 0 });
  }
});

test("stored contact mismatch and ambiguous invoice numbers fail before provider POST", async () => {
  let writes = 0;
  await assert.rejects(() => reconcileProviderExport({
    storedContactId: "stored-other-contact",
    findContacts: async () => [contactFixtures.xero],
    findInvoices: async () => [],
    validateContact: (contact) => assertProviderContactMatches("xero", contact, { ...contactExpectations.xero, storedId: "stored-other-contact" }),
    validateInvoice: () => {},
    createContact: async () => { writes += 1; return contactFixtures.xero; },
    createInvoice: async () => { writes += 1; return {}; },
  }), /PROVIDER_RECORD_COLLISION/);
  await assert.rejects(() => reconcileProviderExport({
    findContacts: async () => [contactFixtures.myob],
    findInvoices: async () => [{ UID: "mismatch" }, { UID: "exact" }],
    validateContact: (contact) => assertProviderContactMatches("myob", contact, contactExpectations.myob),
    validateInvoice: () => {},
    createContact: async () => { writes += 1; return contactFixtures.myob; },
    createInvoice: async () => { writes += 1; return {}; },
  }), /PROVIDER_RECORD_COLLISION/);
  assert.equal(writes, 0);
});

test("newly created customer identity is validated before invoice POST", async () => {
  for (const provider of ["xero", "myob", "quickbooks"]) {
    let contactPosts = 0;
    let invoicePosts = 0;
    const bad = structuredClone(contactFixtures[provider]);
    if (provider === "xero") bad.EmailAddress = "other@example.test";
    if (provider === "myob") bad.Addresses[0].Email = "other@example.test";
    if (provider === "quickbooks") bad.PrimaryEmailAddr.Address = "other@example.test";
    await assert.rejects(() => reconcileProviderExport({
      findContacts: async () => [],
      findInvoices: async () => [],
      validateContact: (contact) => assertProviderContactMatches(provider, contact, contactExpectations[provider]),
      validateInvoice: () => {},
      createContact: async () => { contactPosts += 1; return bad; },
      createInvoice: async () => { invoicePosts += 1; return {}; },
    }), /PROVIDER_RECORD_MISMATCH/);
    assert.deepEqual({ contactPosts, invoicePosts }, { contactPosts: 1, invoicePosts: 0 });
  }
});

test("invalid signed or mixed-GST source totals are rejected before provider export", () => {
  assert.throws(() => accountingExportScope(scope.lines, { ...scope.totals, taxCents: 39_99 }), /INVALID_ACCOUNTING_SCOPE/);
  assert.throws(() => accountingExportScope([{ ...scope.lines[0], lineType: "product", totalCents: -1 }], { subtotalCents: 0, taxCents: 0, totalCents: 1 }), /INVALID_ACCOUNTING_SCOPE/);
});
