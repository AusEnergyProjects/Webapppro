import test from "node:test";
import assert from "node:assert/strict";
import { jobInvoicePaymentStatus, jobProgressStatusLabel } from "../src/lib/trade-job-payment-status.ts";

const invoice = (invoiceStatus, invoicedValueCents = 11000, paidValueCents = 0) =>
  jobInvoicePaymentStatus({ invoiceStatus, invoicedValueCents, paidValueCents });

test("a paid customer invoice coexists with a rebate awaiting payment", () => {
  assert.deepEqual(invoice("paid", 11000, 0), { label: "Invoice paid", tone: "paid", status: "paid" });
  assert.equal(jobProgressStatusLabel("submitted"), "Rebate awaiting payment");
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
