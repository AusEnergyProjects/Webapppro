import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";
import * as contract from "../src/lib/creditex-registry.ts";

const compiled = ts.transpileModule(readFileSync(new URL("../src/components/CreditexRegistryBatches.tsx", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const text = node => node == null || typeof node === "boolean" ? "" : typeof node !== "object" ? String(node) : Array.isArray(node) ? node.map(text).join(" ") : text(node.props?.children);
const nodes = (node, predicate) => !node || typeof node !== "object" ? [] : Array.isArray(node) ? node.flatMap(child => nodes(child, predicate)) : [...(predicate(node) ? [node] : []), ...nodes(node.props?.children, predicate)];
const button = (tree, label) => nodes(tree, node => node.type === "button" && text(node).replace(/\s+/g, " ").replace(/\(\s+/g, "(").replace(/\s+\)/g, ")").trim() === label)[0];
const tick = () => new Promise(resolve => setImmediate(resolve));
const group = { key: "provider:a", scheme: "veu", accountId: "a", accountName: "Accredited provider", kind: "provider_handover", formatKey: "", formatLabel: "Provider handover", baseVintage: "", exportId: "", packetIds: ["p1", "p2"], jobReferences: ["JOB-1", "JOB-2"], quantity: "20", unit: "VEEC" };
const batch = { id: "batch-1", createdAt: "2026-09-25T01:00:00Z", createdByUid: "operator", packetCount: 2, submittedCount: 0, groups: [group], items: group.packetIds.map((packetId, index) => ({ packetId, accountId: "a", scheme: "veu", jobReference: `JOB-${index + 1}`, status: "prepared", providerReference: "" })) };
const snapshot = overrides => ({ readyGroups: [group], blockedClaims: [], batches: [], capabilities: { canOperate: true }, ...overrides });
const receipt = (remainingCount = 0) => ({ batchId: batch.id, submittedCount: 2 - remainingCount, failedCount: 0, remainingCount, results: [{ packetId: "p1", status: "submitted", providerReference: "REG-1" }] });
function harness(data = snapshot(), options = {}) {
  const slots = [], callbacks = [], effects = [], queued = [], requests = [], downloads = [];
  let cursor = 0, changes = 0;
  const changed = (old, next) => !old || next.some((value, i) => value !== old[i]);
  const hooks = {
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === "function" ? initial() : initial; return [slots[i], value => { slots[i] = typeof value === "function" ? value(slots[i]) : value; }]; },
    useRef(initial) { const i = cursor++; return slots[i] ||= { current: initial }; },
    useCallback(callback, deps) { const i = cursor++; if (changed(callbacks[i]?.deps, deps)) callbacks[i] = { callback, deps }; return callbacks[i].callback; },
    useEffect(callback, deps) { const i = cursor++; if (changed(effects[i]?.deps, deps)) { effects[i]?.cleanup?.(); effects[i] = { deps }; queued.push(() => { effects[i].cleanup = callback(); }); } },
  };
  const api = async (path, init, requestOptions) => { const body = init?.body ? JSON.parse(init.body) : undefined; requests.push({ path, body, requestOptions }); return await options.respond?.(body, path) || data; };
  class TestFormData { constructor(form) { this.values = form.values; } get(key) { return this.values[key] ?? null; } }
  const exported = {};
  const require = id => id === "react" ? hooks : id === "react/jsx-runtime" ? jsx : id === "@/lib/creditex-registry" ? contract : id === "@/lib/firebase-client" ? { firebaseAuth: { currentUser: { getIdToken: async () => "fixture-token" } } } : { default: new Proxy({}, { get: (_, key) => String(key) }) };
  const fetch = async (url, init) => { downloads.push({ url, init }); return new Response("zip", { status: options.downloadFails ? 503 : 200 }); };
  const document = { body: { appendChild() {} }, createElement: () => ({ click() {}, remove() {} }) };
  Function("require", "exports", "fetch", "document", "FormData", compiled)(require, exported, fetch, document, TestFormData);
  const render = () => { cursor = 0; const tree = exported.CreditexRegistryBatches({ api, endpoint: "/api/creditex/registry", onChanged: () => { changes++; } }); for (const effect of queued.splice(0)) effect(); return tree; };
  return { render, requests, downloads, get changes() { return changes; }, async mount() { render(); await tick(); return render(); }, async settle() { await tick(); return render(); }, submit(tree, values) { nodes(tree, node => node.type === "form")[0].props.onSubmit({ preventDefault() {}, currentTarget: { values } }); } };
}

test("ready export sends exact selection once, downloads privately and never marks jobs Submitted", async () => {
  const h = harness(snapshot(), { respond: body => body ? { ...snapshot({ readyGroups: [], batches: [batch] }), batch } : null });
  let tree = await h.mount();
  assert.match(text(tree), /not an official import file/);
  const exportButton = button(tree, "Export all ready jobs (2)");
  exportButton.props.onClick(); exportButton.props.onClick(); tree = await h.settle();
  const writes = h.requests.filter(r => r.body);
  assert.equal(writes.length, 1); assert.deepEqual(writes[0].body.expectedPacketIds, ["p1", "p2"]);
  assert.equal(writes[0].body.action, "export_ready_batch"); assert.ok(writes[0].body.requestId);
  assert.equal(h.downloads.length, 1); assert.equal(h.downloads[0].init.headers.Authorization, "Bearer fixture-token");
  assert.match(text(tree), /Jobs stay Audited/); assert.match(text(tree), /Exported · awaiting lodgement/);
});

test("uncertain export retries the same request and a failed download retains its saved batch", async () => {
  let attempts = 0;
  const h = harness(snapshot(), { downloadFails: true, respond: body => { if (!body) return; attempts++; if (attempts === 1) throw new Error("Response interrupted"); return { ...snapshot({ readyGroups: [], batches: [batch] }), batch }; } });
  button(await h.mount(), "Export all ready jobs (2)").props.onClick();
  button(await h.settle(), "Export all ready jobs (2)").props.onClick();
  const tree = await h.settle(), writes = h.requests.filter(r => r.body);
  assert.deepEqual(writes[0].body, writes[1].body); assert.ok(button(tree, "Download again"));
  assert.match(text(tree), /batch is saved/); assert.doesNotMatch(text(tree), /marked Submitted/);
});

test("lodgement requires actual confirmation and reference, then automatically continues bounded chunks", async () => {
  let posts = 0;
  const h = harness(snapshot({ readyGroups: [], batches: [batch] }), { respond: body => body ? { ...snapshot({ readyGroups: [], batches: [batch] }), outcome: receipt(++posts === 1 ? 1 : 0) } : null });
  button(await h.mount(), "Confirm batch lodged").props.onClick();
  h.submit(h.render(), { submittedAt: "2026-09-24T10:00", providerReference: "REG-1" });
  assert.match(text(await h.settle()), /Confirm the batch was actually lodged/); assert.equal(posts, 0);
  h.submit(h.render(), { lodged: "yes", submittedAt: "2026-09-24T10:00", providerReference: "REG-1" });
  const tree = await h.settle(), writes = h.requests.filter(r => r.body);
  assert.equal(posts, 2); assert.deepEqual(writes[0].body, writes[1].body);
  assert.equal(writes[0].body.action, "record_batch_lodgement"); assert.equal(writes[0].body.accountId, "a");
  assert.match(text(tree), /2 job\(s\) marked Submitted/); assert.equal(h.changes, 1);
});

test("per-job references are preserved and partial failure does not announce all submitted", async () => {
  const outcome = { ...receipt(), submittedCount: 1, failedCount: 1, results: [{ packetId: "p1", status: "submitted", providerReference: "ONE" }, { packetId: "p2", status: "failed", providerReference: "TWO", error: "Evidence changed" }] };
  const h = harness(snapshot({ readyGroups: [], batches: [batch] }), { respond: body => body ? { ...snapshot({ readyGroups: [], batches: [batch] }), outcome } : null });
  button(await h.mount(), "Confirm batch lodged").props.onClick();
  nodes(h.render(), node => node.type === "input" && node.props.type === "checkbox" && !node.props.name)[0].props.onChange({ target: { checked: true } });
  h.submit(h.render(), { lodged: "yes", submittedAt: "2026-09-24T10:00", "reference:p1": "ONE", "reference:p2": "TWO" });
  const tree = await h.settle();
  assert.deepEqual(h.requests.find(r => r.body).body.packetReferences, [{ packetId: "p1", providerReference: "ONE" }, { packetId: "p2", providerReference: "TWO" }]);
  assert.match(text(tree), /JOB-2: Evidence changed/); assert.doesNotMatch(text(tree), /2 job\(s\) marked Submitted/);
  assert.equal(nodes(tree, node => node.type === "form").length, 1);
});

test("read-only access exposes blocked reasons and history without lodgement controls", async () => {
  const h = harness(snapshot({ batches: [batch], capabilities: { canOperate: false }, blockedClaims: [{ packetId: "blocked", jobReference: "JOB-3", scheme: "veu", reason: "Account authority expired", code: "EXPIRED" }] }));
  const tree = await h.mount(); assert.equal(button(tree, "Export all ready jobs (2)").props.disabled, true);
  assert.equal(button(tree, "Confirm batch lodged"), undefined); assert.match(text(tree), /Account authority expired/);
  assert.equal(h.requests.filter(r => r.body).length, 0);
});

test("reopened partial batch asks only for pending jobs and keeps seconds in the default lodgement time", async () => {
  const partial = { ...batch, submittedCount: 1, items: batch.items.map((item, i) => i ? item : { ...item, status: "submitted", providerReference: "ORIGINAL" }) };
  const h = harness(snapshot({ readyGroups: [], batches: [partial] }), { respond: body => body ? { ...snapshot({ batches: [partial] }), outcome: { ...receipt(), submittedCount: 1 } } : null });
  button(await h.mount(), "Confirm batch lodged").props.onClick();
  const tree = h.render(), date = nodes(tree, n => n.props?.name === "submittedAt")[0];
  assert.equal(date.props.step, "1"); assert.match(date.props.defaultValue, /T\d{2}:\d{2}:\d{2}$/);
  assert.ok(Date.parse(date.props.defaultValue) >= Date.now() - 1000);
  assert.ok(button(tree, "Mark 1 job Submitted"));
  h.submit(tree, { lodged: "yes", submittedAt: date.props.defaultValue, providerReference: "SECOND" });
  await h.settle();
  assert.deepEqual(h.requests.find(r => r.body).body.packetIds, ["p2"]);
});

test("explicit refresh replaces a stale frozen export selection while ordinary retry retains it", async () => {
  const fresh = { ...group, packetIds: ["p2"], jobReferences: ["JOB-2"] }; let changed = false;
  const h = harness(snapshot(), { respond: body => {
    if (!body) return changed ? snapshot({ readyGroups: [fresh] }) : snapshot();
    if (!changed) { changed = true; throw new Error("Ready jobs changed. Refresh the batch list."); }
    return { ...snapshot({ readyGroups: [], batches: [batch] }), batch };
  } });
  button(await h.mount(), "Export all ready jobs (2)").props.onClick();
  button(await h.settle(), "Refresh batches").props.onClick();
  button(await h.settle(), "Export all ready jobs (1)").props.onClick();
  await h.settle();
  const writes = h.requests.filter(r => r.body);
  assert.deepEqual(writes[0].body.expectedPacketIds, ["p1", "p2"]);
  assert.deepEqual(writes[1].body.expectedPacketIds, ["p2"]);
  assert.notEqual(writes[0].body.requestId, writes[1].body.requestId);
});
