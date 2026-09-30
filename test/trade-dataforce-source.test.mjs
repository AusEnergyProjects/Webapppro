import assert from "node:assert/strict";
import test from "node:test";
import { DATAFORCE_JOB_CSV_HEADERS } from "../src/lib/creditex-dataforce-job-csv.ts";
import { visibleDataforceSource } from "../src/lib/trade-dataforce-source.ts";

const source = Object.fromEntries(DATAFORCE_JOB_CSV_HEADERS.map((header) => [header, `${header} source value`]));
test("Dataforce history preserves every original field without changing current CRM values", () => {
  assert.deepEqual(visibleDataforceSource(JSON.stringify(source), { protectedCustomer: false, canViewInvoices: true }), source);
});
test("Dataforce history respects protected customers and financial permissions", () => {
  assert.equal(visibleDataforceSource(JSON.stringify(source), { protectedCustomer: true, canViewInvoices: true }), null);
  const visible = visibleDataforceSource(JSON.stringify(source), { protectedCustomer: false, canViewInvoices: false });
  assert.equal(visible.Balance, "Restricted");
  assert.equal(visible.Invoiced, "Restricted");
  assert.equal(visible.Customer, source.Customer);
});
test("malformed source history is never presented as a complete imported record", () => {
  for (const raw of [undefined, "", "bad", "[]", "null", JSON.stringify({ ...source, Mobile: 0 })]) {
    assert.equal(visibleDataforceSource(raw, { protectedCustomer: false, canViewInvoices: true }), null);
  }
  assert.deepEqual(visibleDataforceSource(JSON.stringify({ ...source, injected: "extra" }), { protectedCustomer: false, canViewInvoices: true }), source);
});
