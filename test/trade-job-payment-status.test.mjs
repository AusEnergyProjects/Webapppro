import test from "node:test";
import assert from "node:assert/strict";
import { jobCustomerBillingStatus, jobInvoicePaymentStatus, jobInvoiceSettlementStatus, jobProgressStatusLabel } from "../src/lib/trade-job-payment-status.ts";

const invoice = (invoiceStatus, invoicedValueCents = 11000, paidValueCents = 0) =>
  jobInvoicePaymentStatus({ invoiceStatus, invoicedValueCents, paidValueCents });

test("a paid customer invoice coexists with a rebate awaiting payment", () => {
  assert.deepEqual(invoice("paid", 11000, 0), { label: "Invoice paid", tone: "paid", status: "paid" });
  assert.equal(jobProgressStatusLabel("submitted"), "Submitted / rebate pending");
});

test("a paid rebate does not imply the customer invoice was paid", () => {
  assert.equal(jobProgressStatusLabel("paid"), "Rebate paid");
  assert.deepEqual(invoice("issued"), { label: "Invoice unpaid", tone: "pending", status: "issued" });
});

test("restricted invoice information has no payment badge even with positive amounts", () => {
  assert.equal(invoice("restricted", 11000, 11000), null);
});

test("safe recorded balances recognise paid and part-paid invoices", () => {
  for (const status of ["issued", "part_paid", "overdue"]) {
    assert.equal(invoice(status, 11000, 11000).status, "paid");
    assert.equal(invoice(status, 11000, 12000).status, "paid");
  }
  assert.deepEqual(invoice("issued", 11000, 3000), { label: "Invoice part paid", tone: "pending", status: "part_paid" });
  assert.equal(invoice("part_paid", 11000, 0).label, "Invoice part paid");
  assert.equal(invoice("overdue", 11000, 3000).label, "Invoice overdue");
});

test("draft, void, credited and not-started statuses cannot become paid from old balances", () => {
  for (const [status, label] of [["draft", "Invoice draft"], ["void", "Invoice void"], ["credited", "Invoice credited"], ["not_started", "Not invoiced"]]) {
    assert.deepEqual(invoice(status, 11000, 11000), { label, tone: "muted", status });
  }
});

test("unknown statuses and unsafe balances never invent payment", () => {
  for (const status of ["", "unknown", "toString", "constructor"]) {
    assert.equal(invoice(status, 11000, 11000).label, "Invoice status unavailable");
  }
  for (const invalid of [-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(invoice("issued", invalid, 11000).status, "unavailable");
    assert.equal(invoice("issued", 11000, invalid).status, "unavailable");
  }
  assert.equal(invoice("issued", 0, 0).label, "Invoice unpaid");
  assert.equal(invoice("issued", 0, 11000).label, "Invoice unpaid");
});

test("explicit paid status remains authoritative despite stale or missing amount summaries", () => {
  assert.equal(invoice("paid", 0, 0).label, "Invoice paid");
  assert.equal(invoice("paid", NaN, NaN).label, "Invoice paid");
});

test("non-payment progress labels retain their existing meaning and canonical values", () => {
  assert.equal(jobProgressStatusLabel("scheduled"), "Assigned");
  assert.equal(jobProgressStatusLabel("completed"), "Complete");
  assert.equal(jobProgressStatusLabel("correction_required"), "Correction required");
  assert.equal(jobProgressStatusLabel("custom_state"), "Custom state");
  assert.equal(jobProgressStatusLabel(""), "");
});

const billingInput = (overrides = {}) => ({
  invoiceStatus: "not_started", invoicedValueCents: 0, paidValueCents: 0,
  quoteStatus: "not_started", quotedValueCents: 0, ...overrides,
});

test("customer billing progresses from an issued quote to an issued invoice and payment", () => {
  assert.equal(jobCustomerBillingStatus(billingInput()), "Unquoted");
  for (const quoteStatus of ["issued", "sent", "accepted", "declined"]) {
    assert.equal(jobCustomerBillingStatus(billingInput({ quoteStatus })), "Quoted");
  }
  for (const invoiceStatus of ["issued", "part_paid", "overdue"]) {
    const input = billingInput({ invoiceStatus, invoicedValueCents: 11000, paidValueCents: 3000 });
    assert.equal(jobCustomerBillingStatus(input), "Invoiced");
    assert.equal(jobInvoiceSettlementStatus(input), "Unpaid");
    assert.equal(jobCustomerBillingStatus({ ...input, paidValueCents: 11000 }), "Paid");
    assert.equal(jobInvoiceSettlementStatus({ ...input, paidValueCents: 11000 }), "Paid");
  }
  assert.equal(jobCustomerBillingStatus(billingInput({ invoiceStatus: "paid" })), "Paid");
  assert.equal(jobInvoiceSettlementStatus(billingInput({ invoiceStatus: "paid" })), "Paid");
});

test("draft amounts and void or credited invoices do not claim a current issued invoice", () => {
  for (const invoiceStatus of ["not_started", "draft", "void", "credited"]) {
    const input = billingInput({ invoiceStatus, invoicedValueCents: 11000, paidValueCents: 11000, quotedValueCents: 11000 });
    assert.equal(jobCustomerBillingStatus(input), "Unquoted");
    assert.equal(jobCustomerBillingStatus({ ...input, quoteStatus: "draft" }), "Unquoted");
    assert.equal(jobCustomerBillingStatus({ ...input, quoteStatus: "issued" }), "Quoted");
    assert.equal(jobInvoiceSettlementStatus(input), "-");
  }
});

test("billing and settlement columns preserve independent quote and invoice access", () => {
  const restrictedInvoice = billingInput({ invoiceStatus: "restricted", quoteStatus: "issued", invoicedValueCents: 11000, paidValueCents: 11000 });
  assert.equal(jobCustomerBillingStatus(restrictedInvoice), null);
  assert.equal(jobInvoiceSettlementStatus(restrictedInvoice), null);
  assert.equal(jobCustomerBillingStatus(billingInput({ quoteStatus: "restricted", quotedValueCents: 11000 })), null);
  assert.equal(jobCustomerBillingStatus(billingInput({ quoteStatus: "restricted", invoiceStatus: "issued" })), "Invoiced");
  assert.equal(jobCustomerBillingStatus(billingInput({ quoteStatus: "restricted", invoiceStatus: "paid" })), "Paid");
});

test("missing or invalid payment facts never fabricate paid status or quoted history", () => {
  for (const invoiceStatus of ["", "unknown", "constructor"]) {
    const input = billingInput({ invoiceStatus, invoicedValueCents: 11000, paidValueCents: 11000, quoteStatus: "issued" });
    assert.equal(jobCustomerBillingStatus(input), "-");
    assert.equal(jobInvoiceSettlementStatus(input), "-");
  }
  assert.equal(jobCustomerBillingStatus(billingInput({ quoteStatus: "", quotedValueCents: 11000 })), "-");
  const invalidBalance = billingInput({ invoiceStatus: "issued", invoicedValueCents: NaN, paidValueCents: Infinity });
  assert.equal(jobCustomerBillingStatus(invalidBalance), "Invoiced");
  assert.equal(jobInvoiceSettlementStatus(invalidBalance), "-");
  assert.equal(jobInvoiceSettlementStatus(billingInput({ invoiceStatus: "issued" })), "Unpaid");
});
