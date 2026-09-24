import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";
import * as contract from "../src/lib/creditex-registry.ts";

const source = readFileSync(new URL("../src/components/CreditexRegistryWorkspace.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
} }).outputText;
const text = (node) => node == null || typeof node === "boolean" ? "" : typeof node === "string" || typeof node === "number" ? String(node) : Array.isArray(node) ? node.map(text).join(" ") : text(node.props?.children);
const nodes = (node, predicate) => !node || typeof node !== "object" ? [] : Array.isArray(node) ? node.flatMap((child) => nodes(child, predicate)) : [...(predicate(node) ? [node] : []), ...nodes(node.props?.children, predicate)];
const button = (tree, label) => nodes(tree, (node) => node.type === "button" && text(node) === label)[0];
const form = (tree, label) => nodes(tree, (node) => node.type === "form" && text(node).includes(label))[0];
const flush = () => new Promise((resolve) => setImmediate(resolve));
const account = { id: "account-1", scheme: "veu", accountReference: "A001", submitterReference: "A002", legalName: "Test Accredited Organisation", financeEmail: "finance@example.test", resultsEmail: "results@example.test", activityScope: ["6"], authorityReference: "authority-1", authorityExpiresOn: "", version: 3, enabled: true, updatedAt: "2026-09-24T00:00:00Z" };
const claim = { packetId: "packet-1", packetSha256: "sha256:expected-packet", scheme: "veu", jobReference: "job-1", jobLabel: "Heat pump", customerLabel: "Test customer", activityTitle: "Air conditioning", quantity: "14", unit: "VEECs", status: "approved", approved: true, canSubmit: false, providerReference: "VEU-123", accountId: account.id, registryStatus: "unconfirmed", registeredQuantity: "", lastCheckedAt: "" };
const snapshot = (overrides = {}) => ({ ok: true, schemes: contract.REGISTRY_SCHEMES, accounts: [], claims: [], invoices: [], payments: [], results: [], formats: [], exports: [], unresolvedMatches: [], activityOptions: [{ activityTemplateId: "6", scheme: "veu", title: "High efficiency air conditioning" }], capabilities: { canManageAccounts: true, canOperate: true, canReview: true }, ...overrides });

function harness(data, options = {}) {
  const slots = [], callbacks = [], effects = [], queued = [], requests = [];
  let cursor = 0;
  const changed = (old, next) => !old || next.some((value, index) => value !== old[index]);
  const hooks = {
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial; return [slots[index], (value) => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }]; },
    useRef(initial) { const index = cursor++; if (!(index in slots)) slots[index] = { current: initial }; return slots[index]; },
    useCallback(callback, deps) { const index = cursor++; if (changed(callbacks[index]?.deps, deps)) callbacks[index] = { callback, deps }; return callbacks[index].callback; },
    useEffect(callback, deps) { const index = cursor++; if (changed(effects[index]?.deps, deps)) { effects[index]?.cleanup?.(); effects[index] = { deps }; queued.push(() => { effects[index].cleanup = callback(); }); } },
  };
  class TestFormData {
    constructor(element) { this.values = element?.values || []; }
    get(name) { return this.values.find(([key]) => key === name)?.[1] ?? null; }
    getAll(name) { return this.values.filter(([key]) => key === name).map(([, value]) => value); }
    set(name, value) { this.values = this.values.filter(([key]) => key !== name); this.values.push([name, value]); }
  }
  const api = async (path, init = {}, requestOptions) => {
    const body = typeof init.body === "string" ? JSON.parse(init.body) : init.body;
    requests.push({ path, init, body, requestOptions });
    if (options.respond) { const response = await options.respond(path, body); if (response) return response; }
    if (path.includes("upload=evidence")) return { ok: true, evidenceId: "evidence-1" };
    return data;
  };
  const exports = {};
  const require = (id) => id === "react" ? hooks : id === "react/jsx-runtime" ? jsx : id === "@/lib/creditex-registry" ? contract : id.endsWith(".module.css") ? { default: new Proxy({}, { get: (_, key) => String(key) }) } : id === "@/lib/firebase-client" ? { firebaseAuth: { currentUser: options.user || null } } : {};
  const document = { createElement() { return { click() {}, remove() {} }; }, body: { appendChild() {} } };
  Function("require", "exports", "FormData", "fetch", "document", compiled)(require, exports, TestFormData, options.fetch || (() => { throw new Error("Unexpected test fetch"); }), document);
  const expand = (node) => node == null || typeof node !== "object" ? node : Array.isArray(node) ? node.map(expand) : typeof node.type === "function" ? expand(node.type(node.props)) : { ...node, props: { ...node.props, children: expand(node.props?.children) } };
  const render = () => { cursor = 0; const tree = expand(exports.CreditexRegistryWorkspace({ api, endpoint: "/api/creditex/registry", outputEndpoint: "/api/creditex/output-actions", children: jsx.jsx("div", { children: "Existing governed preparation controls" }) })); for (const effect of queued.splice(0)) effect(); return tree; };
  return { render, requests, async mount() { render(); await flush(); return render(); }, async settle() { await flush(); return render(); }, submit(target, values) { target.props.onSubmit({ preventDefault() {}, currentTarget: { values: Object.entries(values).flatMap(([key, value]) => Array.isArray(value) ? value.map((item) => [key, item]) : [[key, value]]), reset() {} } }); } };
}

test("empty workspace gives account setup and keeps governed preparation available without claiming a connection", async () => {
  const h = harness(snapshot());
  let tree = await h.mount();
  assert.match(text(tree), /Start with your scheme account/);
  assert.match(text(tree), /Your prepared claims will appear here/);
  assert.match(text(tree), /Existing governed preparation controls/);
  button(tree, "Set up scheme accounts").props.onClick(); tree = h.render();
  for (const scheme of contract.REGISTRY_SCHEMES) assert.ok(text(tree).includes(scheme.title));
  assert.match(text(tree), /Connection approval required/);
  assert.match(text(tree), /REC owner account ID/);
  assert.equal(nodes(tree, (node) => node.type === "input" && node.props.type === "password").length, 0);
  assert.equal(h.requests.filter((request) => request.init.method === "POST").length, 0);
});

test("a registry result requires an existing lodgement reference and cannot invent one", async () => {
  const h = harness(snapshot({ accounts: [account], claims: [{ ...claim, providerReference: "" }] }));
  const tree = await h.mount();
  assert.match(text(tree), /record its actual submission reference/);
  assert.equal(form(tree, "Save result for review"), undefined);
});

test("result evidence is uploaded once and the exact packet and lodged reference are retained", async () => {
  const h = harness(snapshot({ accounts: [account], claims: [claim] }));
  const tree = await h.mount();
  const resultForm = form(tree, "Save result for review");
  const values = { externalReference: "must-not-replace-reference", registryStatus: "registered", quantity: "14", occurredAt: "2026-09-23T10:00", note: "Registry checked", evidence: new File(["registry result"], "result.pdf", { type: "application/pdf" }) };
  h.submit(resultForm, values); h.submit(resultForm, values);
  const after = await h.settle();
  assert.equal(h.requests.filter((request) => request.path.includes("upload=evidence")).length, 1);
  const writes = h.requests.filter((request) => request.body?.action === "record_result");
  assert.equal(writes.length, 1);
  assert.equal(writes[0].body.externalReference, claim.providerReference);
  assert.equal(writes[0].body.expectedPacketSha256, claim.packetSha256);
  assert.equal(writes[0].body.evidenceId, "evidence-1");
  assert.match(text(after), /confirmed registry status changes after approval/);
  assert.match(text(after), /Not confirmed/);
});

test("the recorder cannot approve their own pending result in the workspace", async () => {
  const h = harness(snapshot({ accounts: [account], claims: [claim], results: [{ id: "result-1", packetId: claim.packetId, accountId: account.id, externalReference: claim.providerReference, registryStatus: "registered", quantity: "14", occurredAt: "2026-09-23T00:00:00Z", evidenceId: "evidence-1", note: "", recordedByUid: "self", source: "reviewed_document", reviewStatus: "pending", canReview: false, createdAt: "2026-09-23T00:00:00Z" }] }));
  const tree = await h.mount();
  assert.match(text(tree), /Awaiting a different authorised reviewer/);
  assert.equal(button(tree, "Save independent review"), undefined);
  assert.ok(button(tree, "Open evidence"));
});

test("fully evidenced payment does not present certificate registration or regulator confirmation", async () => {
  const h = harness(snapshot({ accounts: [account], claims: [claim], invoices: [{ id: "invoice-1", accountId: account.id, reference: "INV-1", amountMinor: 4350, paidMinor: 4350, dueDate: "2026-09-25", evidenceId: "evidence-1", packetIds: [claim.packetId], createdAt: "2026-09-23T00:00:00Z", status: "active" }] }));
  button(await h.mount(), "Fees and payments").props.onClick();
  const tree = h.render();
  assert.match(text(tree), /Payment recorded/);
  assert.match(text(tree), /not confirmation from the regulator/);
  assert.match(text(tree), /does not register certificates/);
  assert.equal(button(tree, "Save payment evidence"), undefined);
});

test("an invoice without associated selected claims is blocked before uploading evidence", async () => {
  const h = harness(snapshot({ accounts: [account], claims: [claim] }));
  button(await h.mount(), "Fees and payments").props.onClick();
  h.submit(form(h.render(), "Save regulator invoice"), { accountId: account.id, reference: "INV-1", amount: "43.50", dueDate: "2026-09-25", evidence: new File(["invoice"], "invoice.pdf") });
  assert.match(text(await h.settle()), /Select at least one claim/);
  assert.equal(h.requests.filter((request) => request.init.method === "POST").length, 0);
});

test("REC sync is offered only for STC accounts and exposes the delayed date boundary", async () => {
  const h = harness(snapshot({ accounts: [account, { ...account, id: "stc-account", scheme: "stc" }, { ...account, id: "lgc-account", scheme: "lgc" }] }));
  button(await h.mount(), "Scheme accounts").props.onClick();
  const tree = h.render();
  const syncForms = nodes(tree, (node) => node.type === "form" && text(node).includes("Check REC status"));
  assert.equal(syncForms.length, 1);
  assert.match(text(tree), /delayed by one day/);
  const date = nodes(syncForms[0], (node) => node.type === "input" && node.props.name === "date")[0];
  assert.equal(date.props.max, date.props.defaultValue);
  assert.ok(date.props.max < new Date().toLocaleDateString("en-CA"));
  h.submit(syncForms[0], { date: "2026-09-22" }); await h.settle();
  assert.deepEqual(h.requests.find((request) => request.body?.action === "sync_rec").body, { action: "sync_rec", accountId: "stc-account", date: "2026-09-22" });
});

test("REC checks allow time for the registry response and reconciliation without changing ordinary request timeouts", async () => {
  const h = harness(snapshot({ accounts: [{ ...account, scheme: "stc" }] }));
  button(await h.mount(), "Scheme accounts").props.onClick();
  h.submit(form(h.render(), "Check REC status"), { date: "2026-09-22" });
  await h.settle();
  assert.deepEqual(h.requests.find((request) => request.body?.action === "sync_rec").requestOptions, { requestTimeoutMs: 60_000 });
  assert.equal(h.requests.find((request) => !request.init.method).requestOptions, undefined);
});

const fileAccount = { ...account, id: "nsw-account", scheme: "nsw_esc" };
const fileClaim = { ...claim, scheme: "nsw_esc", accountId: fileAccount.id, providerReference: "" };
const fileFormat = { key: "nsw_esc", label: "TESSA energy savings certificates", scheme: "ESS", headers: ["ACP Implementation Identifier", "Installation detail"], maximumRecords: 3000, referenceField: "ACP Implementation Identifier", version: "v1.7" };
const preparedFile = { id: "export-1", accountId: fileAccount.id, formatKey: "nsw_esc", packetIds: [fileClaim.packetId], baseVintage: "2026", createdAt: "2026-09-24T01:00:00Z", createdByUid: "operator", reviewStatus: "pending", canReview: true };

test("registry file preparation selects approved attached unlodged claims and sends exact CSV", async () => {
  const h = harness(snapshot({ accounts: [fileAccount], claims: [fileClaim, { ...fileClaim, packetId: "unreviewed", approved: false }, { ...fileClaim, packetId: "other-account", accountId: account.id }, { ...fileClaim, packetId: "already-lodged", providerReference: "NSW-1" }], formats: [fileFormat] }));
  button(await h.mount(), "Registry files").props.onClick();
  let tree = h.render();
  const choices = nodes(tree, (node) => node.type === "input" && node.props.type === "checkbox");
  assert.equal(choices.length, 1);
  assert.equal(button(tree, "Check file and request review").props.disabled, true);
  choices[0].props.onChange({ target: { checked: true } }); tree = h.render();
  assert.equal(button(tree, "Check file and request review").props.disabled, false);
  const csv = "ACP Implementation Identifier,Installation detail\r\npacket-1,Real retained evidence\r\n";
  h.submit(form(tree, "Check file and request review"), { csv: new File([csv], "completed.csv", { type: "text/csv" }), baseVintage: "2026" });
  const after = await h.settle();
  assert.deepEqual(h.requests.find((request) => request.body?.action === "prepare_export").body, { action: "prepare_export", accountId: fileAccount.id, formatKey: "nsw_esc", packetIds: [fileClaim.packetId], baseVintage: "2026", csv });
  assert.match(text(after), /has not been lodged/);
  assert.equal(h.requests.filter((request) => request.path.includes("upload=evidence")).length, 0);
});

test("pending files expose exact row inspection before independent review and no approved download", async () => {
  const h = harness(snapshot({ accounts: [fileAccount], claims: [fileClaim], formats: [fileFormat], exports: [preparedFile] }), { respond: async (path) => path.includes("preview=export") ? { headers: fileFormat.headers, rows: [[fileClaim.packetId, "Evidence-matched address"]] } : null });
  button(await h.mount(), "Registry files").props.onClick();
  let tree = h.render();
  assert.equal(button(tree, "Download approved registry file"), undefined);
  assert.equal(button(tree, "Save independent file review").props.disabled, true);
  button(tree, "Inspect file contents").props.onClick(); tree = await h.settle();
  assert.match(text(tree), /Evidence-matched address/);
  assert.equal(button(tree, "Save independent file review").props.disabled, false);
  h.submit(form(tree, "Save independent file review"), { decision: "approved", note: "Every field matches the governed evidence and current requirements." }); await h.settle();
  assert.deepEqual(h.requests.find((request) => request.body?.action === "review_export").body, { action: "review_export", exportId: preparedFile.id, decision: "approved", note: "Every field matches the governed evidence and current requirements." });
});

test("own files cannot be self-approved and only approved files offer registry download", async () => {
  const h = harness(snapshot({ accounts: [fileAccount], formats: [fileFormat], exports: [{ ...preparedFile, canReview: false }, { ...preparedFile, id: "export-approved", reviewStatus: "approved", canReview: false }] }));
  button(await h.mount(), "Registry files").props.onClick();
  const tree = h.render();
  assert.match(text(tree), /Awaiting a different authorised reviewer/);
  assert.equal(button(tree, "Save independent file review"), undefined);
  assert.equal(nodes(tree, (node) => node.type === "button" && text(node) === "Download approved registry file").length, 1);
});

test("reader access retains file evidence but cannot prepare or review files", async () => {
  const h = harness(snapshot({ accounts: [fileAccount], formats: [fileFormat], exports: [preparedFile], capabilities: { canManageAccounts: false, canOperate: false, canReview: false } }));
  button(await h.mount(), "Registry files").props.onClick();
  const tree = h.render();
  assert.equal(button(tree, "Check file and request review"), undefined);
  assert.equal(button(tree, "Save independent file review"), undefined);
  assert.ok(button(tree, "Inspect file contents"));
});

test("scheme account scope uses named activities and rejects an empty choice", async () => {
  const h = harness(snapshot());
  button(await h.mount(), "Set up scheme accounts").props.onClick();
  const tree = h.render();
  assert.match(text(tree), /High efficiency air conditioning/);
  const scope = nodes(tree, (node) => node.type === "input" && node.props.name === "activityScope");
  assert.equal(scope.length, 1);
  assert.equal(scope[0].props.type, "checkbox");
  h.submit(form(tree, "Save account"), { scheme: "veu" });
  assert.match(text(await h.settle()), /Choose at least one activity/);
  assert.equal(h.requests.filter((request) => request.init.method === "POST").length, 0);
});

test("REC zero matches reports unchanged status instead of suggesting a result was found", async () => {
  const data = snapshot({ accounts: [{ ...account, scheme: "stc" }] });
  const h = harness(data, { respond: async (_path, body) => body?.action === "sync_rec" ? { ...data, sync: { sourceDate: "2026-09-22", matchedClaims: 0, updatedClaims: 0, unresolvedClaims: 0, matches: [] } } : null });
  button(await h.mount(), "Scheme accounts").props.onClick();
  h.submit(form(h.render(), "Check REC status"), { date: "2026-09-22" });
  const tree = await h.settle();
  assert.match(text(tree), /No matching certificate actions were found/);
  assert.match(text(tree), /Claim statuses are unchanged/);
});

test("persisted REC unresolved matches retain evidence and claim navigation after refresh", async () => {
  const data = snapshot({ accounts: [{ ...account, scheme: "stc" }], claims: [{ ...claim, scheme: "stc" }], unresolvedMatches: [{ packetId: claim.packetId, evidenceId: "retained-match", sourceDate: "2026-09-22", checkedAt: "2026-09-24T00:00:00Z" }] });
  const h = harness(data, { respond: async (_path, body) => body?.action === "sync_rec" ? { ...data, sync: { sourceDate: "2026-09-22", matchedClaims: 1, updatedClaims: 0, unresolvedClaims: 1, matches: [{ packetId: claim.packetId, evidenceId: "retained-match", confirmed: false }] } } : null });
  button(await h.mount(), "Scheme accounts").props.onClick();
  h.submit(form(h.render(), "Check REC status"), { date: "2026-09-22" });
  const tree = await h.settle();
  assert.match(text(tree), /1 need reconciliation/);
  assert.ok(button(tree, "Open evidence"));
  button(tree, "Refresh").props.onClick();
  assert.ok(button(await h.settle(), "Open evidence"));
  button(tree, "Open claim").props.onClick();
  assert.match(text(h.render()), /Registered quantity/);
});

test("bulk templates use an authenticated JSON POST instead of putting claim IDs in the URL", async () => {
  const downloads = [];
  const h = harness(snapshot({ accounts: [fileAccount], claims: [fileClaim], formats: [fileFormat] }), { user: { getIdToken: async () => "synthetic-token" }, fetch: async (path, init) => { downloads.push({ path, init }); return new Response("reference\r\npacket-1\r\n", { headers: { "Content-Type": "text/csv", "Content-Disposition": 'attachment; filename="template.csv"' } }); } });
  button(await h.mount(), "Registry files").props.onClick();
  nodes(h.render(), (node) => node.type === "input" && node.props.type === "checkbox")[0].props.onChange({ target: { checked: true } });
  button(h.render(), "Download template for selected claims").props.onClick();
  await h.settle();
  assert.equal(downloads.length, 1);
  assert.equal(downloads[0].path, "/api/creditex/registry");
  assert.equal(downloads[0].init.method, "POST");
  assert.equal(downloads[0].init.headers.get("Authorization"), "Bearer synthetic-token");
  assert.deepEqual(JSON.parse(downloads[0].init.body), { action: "download_template", accountId: fileAccount.id, formatKey: fileFormat.key, packetIds: [fileClaim.packetId] });
});
