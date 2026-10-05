import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import * as contract from "../src/lib/admin-submitted-enquiry.ts";
import * as catalogue from "../src/lib/energy-service-catalogue.mjs";

const source = readFileSync(new URL("../src/components/AdminSubmittedEnquiryDetails.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const response = (id = "enquiry-1") => ({ ok: true, retainedContact: {
  firstName: "Jamie", lastName: "Example", email: "jamie@example.test", phone: "0400000000",
  unitNumber: "4", streetAddress: "15 Example Street", suburb: "MELBOURNE", state: "VIC", postcode: "3000", grantedAt: "2026-10-04T00:00:00Z",
}, submittedEnquiry: { id, title: "Hot water request", serviceCategories: ["hot-water"], createdAt: "2026-10-04T00:00:00Z", status: "open", sourceReference: "TEST-REF", customerMessage: "Call after 4pm.\n<script>alert(1)</script>", consent: { noticeVersion: "notice-v1", purpose: "Accepted sharing purpose", grantedAt: "2026-10-04T00:00:00Z", disclosedFields: ["postcode", "customer_address", "service_categories"] } } });
const settle = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };

function harness() {
  const values = [], effects = [], requests = [];
  let cursor = 0, effectCursor = 0, writes = 0;
  const exports = {};
  const api = (path, init) => new Promise((resolve, reject) => requests.push({ path, init, resolve, reject }));
  const react = {
    useState: (initial) => { const index = cursor++; if (!(index in values)) values[index] = initial; return [values[index], (value) => { writes++; values[index] = typeof value === "function" ? value(values[index]) : value; }]; },
    useEffect: (fn, deps) => { const index = effectCursor++; const old = effects[index]; if (!old || deps.some((item, key) => !Object.is(item, old.deps[key]))) { old?.cleanup?.(); effects[index] = { deps, pending: fn }; } },
  };
  const require = (id) => id === "react" ? react : id === "react/jsx-runtime" ? jsx : id.includes("admin-submitted-enquiry") ? contract : id.includes("energy-service-catalogue") ? catalogue : id.includes("admin-workspace") ? { dateTime: (value) => value, readable: (value) => value.replaceAll("_", " "), workspaceError: (error) => error instanceof Error ? error.message : "Failed" } : { default: {} };
  Function("require", "exports", compiled)(require, exports);
  return {
    requests,
    get writes() { return writes; },
    render(id = "enquiry-1") { cursor = effectCursor = 0; const tree = exports.AdminSubmittedEnquiryDetails({ api, opportunityId: id }); for (const effect of effects) { if (effect.pending) { effect.cleanup = effect.pending(); effect.pending = null; } } return renderToStaticMarkup(tree); },
    unmount() { for (const effect of effects) effect.cleanup?.(); },
  };
}

test("submitted details load on demand with full contact, message, services and separate trade consent", async () => {
  const h = harness();
  assert.match(h.render(), /Opening customer details/);
  assert.equal(h.requests[0].path, "/api/admin/opportunities?contact=enquiry-1");
  h.requests[0].resolve(response()); await settle();
  const html = h.render();
  for (const value of ["Jamie Example", "jamie@example.test", "0400000000", "Unit 4", "15 Example Street", "Call after 4pm", "Hot water", "TEST-REF", "Accepted sharing purpose", "This access is audited"]) assert.ok(html.includes(value), value);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /Fields permitted for trade sharing<\/dt><dd>Postcode, Property address, Selected services/);
});

test("record switches hide previous private details immediately and ignore stale responses", async () => {
  const h = harness(); h.render();
  h.requests[0].resolve(response()); await settle();
  assert.match(h.render(), /Jamie Example/);
  assert.doesNotMatch(h.render("enquiry-2"), /Jamie Example/);
  assert.equal(h.requests[0].init.signal.aborted, true);
  h.render("enquiry-3");
  const previousWrites = h.writes;
  h.requests[1].resolve(response("enquiry-2")); await settle();
  assert.equal(h.writes, previousWrites);
  h.requests[2].resolve(response("enquiry-3")); await settle();
  assert.match(h.render("enquiry-3"), /enquiry-3/);
  assert.doesNotMatch(h.render("enquiry-3"), /enquiry-2/);
});

test("closing aborts the request and prevents a late response retaining customer details", async () => {
  const h = harness(); h.render(); h.unmount();
  const writes = h.writes;
  assert.equal(h.requests[0].init.signal.aborted, true);
  h.requests[0].resolve(response()); await settle();
  assert.equal(h.writes, writes);
});

test("missing or withdrawn records show the server failure without fabricated contact", async () => {
  const h = harness(); h.render();
  h.requests[0].reject(new Error("No active retained contact record is available for this enquiry.")); await settle();
  const html = h.render();
  assert.match(html, /No active retained contact record/);
  assert.match(html, /sharing consent has been withdrawn/);
  assert.match(html, /Try again/);
  assert.doesNotMatch(html, /Jamie Example|jamie@example/);
});

test("mismatched or malformed private payloads fail closed", async () => {
  for (const value of [response("wrong-id"), { ...response(), retainedContact: {} }, { ...response(), ok: false }]) {
    const h = harness(); h.render(); h.requests[0].resolve(value); await settle();
    assert.match(h.render(), /could not be opened/);
    assert.doesNotMatch(h.render(), /Jamie Example|jamie@example/);
  }
});
