import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";

const read = name => fs.readFileSync(new URL(`../src/components/${name}.tsx`, import.meta.url), "utf8");
const text = node => node == null || typeof node === "boolean" ? "" : typeof node === "string" || typeof node === "number" ? String(node) : Array.isArray(node) ? node.map(text).join(" ") : text(node.props?.children);
const nodes = (node, predicate) => !node || typeof node !== "object" ? [] : Array.isArray(node) ? node.flatMap(item => nodes(item, predicate)) : [...(predicate(node) ? [node] : []), ...nodes(node.props?.children, predicate)];
const button = (tree, label) => nodes(tree, node => node.type === "button" && text(node).trim() === label)[0];
const component = (tree, name) => nodes(tree, node => node.type?.name === name);
const flush = () => new Promise(resolve => setImmediate(resolve));
const response = (pack, ok = true, error = "") => ({ ok, json: async () => ({ ok, pack, error }) });
const asset = { id: "asset-1", brand: "Example", modelNumber: "M1", serialNumber: "SER1", quantity: 2, installedAt: "2026-09-01", warrantyProvider: "Maker", warrantyReference: "W1", warrantyStart: "2026-09-01", warrantyEnd: "2028-09-01" };
const pack = { status: "published", reviewNote: "Checked", assets: [asset], complianceItems: [{ id: "check-1", label: "Installation checked", status: "complete" }], documents: [{ id: "doc /1", fileName: "Certificate.pdf", sizeBytes: 2048, createdAt: "2026-09-02T01:00:00Z" }] };

function harness(name, responder, options = {}) {
  let cursor = 0; let business = options.business || { ownerUid: "business-a", role: "owner" }; let timerId = 0;
  const state = []; const effects = []; const pending = []; const timers = new Map(); const requests = []; const downloads = []; const urls = []; const revoked = [];
  const user = { uid: "owner", getIdToken: async () => "token" };
  const props = { user, workOrderId: "job /1", label: "TLJ-1", ...options.props };
  const request = async (url, init) => { requests.push({ url, init }); return responder(url, init, requests.length); };
  const hooks = {
    useState(initial) { const index = cursor++; if (!(index in state)) state[index] = typeof initial === "function" ? initial() : initial; return [state[index], next => state[index] = typeof next === "function" ? next(state[index]) : next]; },
    useRef(initial) { const index = cursor++; if (!(index in state)) state[index] = { current: initial }; return state[index]; },
    useCallback(callback, deps) { const index = cursor++; if (!state[index] || deps.some((value, i) => value !== state[index].deps[i])) state[index] = { deps, callback }; return state[index].callback; },
    useEffect(callback, deps) { const index = cursor++; const old = effects[index]; if (!old || deps.some((value, i) => value !== old.deps[i])) { old?.cleanup?.(); effects[index] = { deps }; pending.push(() => effects[index].cleanup = callback()); } },
  };
  const setTimer = (callback, delay) => { const id = ++timerId; timers.set(id, { callback, delay }); return id; };
  const clearTimer = id => timers.delete(id);
  const window = { setTimeout: setTimer, clearTimeout: clearTimer, document: { createElement() { return { href: "", download: "", click() { downloads.push({ url: this.href, name: this.download }); } }; } } };
  const fakeUrl = { createObjectURL(blob) { urls.push(blob); return `blob:download-${urls.length}`; }, revokeObjectURL(url) { revoked.push(url); } };
  const exports = {};
  const require = id => id === "react" ? hooks : id === "react/jsx-runtime" ? jsx
    : id === "./TradeBusinessProvider" ? { useTradeBusiness: () => business, useTradeBusinessFetch: () => request }
    : id === "./TradeAssetLifecycle" ? { TradeAssetLifecycle: function TradeAssetLifecycle() {} }
    : id === "./TradeHandoverCorrections" ? { TradeHandoverCorrections: function TradeHandoverCorrections() {} }
    : id === "./TradeAssetJobTools" ? { TradeAssetJobTools: function TradeAssetJobTools() {} }
    : id.endsWith(".module.css") ? { default: new Proxy({}, { get: (_, key) => String(key) }) } : {};
  const compiled = ts.transpileModule(read(name), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  Function("require", "exports", "window", "setTimeout", "clearTimeout", "URL", compiled)(require, exports, window, setTimer, clearTimer, fakeUrl);
  const render = () => { cursor = 0; const tree = exports[name](props); for (const effect of pending.splice(0)) effect(); return tree; };
  const toggle = open => { nodes(render(), node => node.type === "details")[0].props.onToggle({ currentTarget: { open } }); return render(); };
  return { render, toggle, props, requests, downloads, urls, revoked, setBusiness(next) { business = next; },
    runTimers(delay) { for (const [id, timer] of [...timers]) if (timer.delay === delay) { timers.delete(id); timer.callback(); } },
    async open() { toggle(true); await flush(); return render(); },
    cleanup() { for (const effect of effects) effect?.cleanup?.(); },
  };
}

test("completion history fetches only when opened and renders saved read-only records", async () => {
  const h = harness("TradeHandoverHistory", async () => response(pack));
  assert.match(text(h.render()), /Earlier completion records/); await flush(); assert.equal(h.requests.length, 0);
  const tree = await h.open();
  assert.equal(h.requests[0].url, "/api/trade-handover?workOrderId=job%20%2F1");
  assert.equal(h.requests[0].init.headers.Authorization, "Bearer token"); assert.equal(h.requests[0].init.cache, "no-store");
  assert.equal(h.requests[0].init.method, undefined); assert.ok(h.requests[0].init.signal);
  assert.match(text(tree), /Published record/); assert.match(text(tree), /Example\s+M1/); assert.match(text(tree), /SER1/);
  assert.match(text(tree), /Installation checked\s+Complete/); assert.match(text(tree), /Certificate.pdf/);
  assert.equal(nodes(tree, node => ["form", "input", "select", "textarea"].includes(node.type)).length, 0);
  assert.doesNotMatch(text(tree), /customer portal|Create pack|Initialize|Submit for review/i); h.cleanup();
});

test("history refresh failure clears saved data and exposes a working retry", async () => {
  const h = harness("TradeHandoverHistory", async (_url, _init, count) => count === 2 ? response(null, false, "Access denied") : response(pack));
  let tree = await h.open(); button(tree, "Refresh records").props.onClick(); tree = h.render();
  assert.doesNotMatch(text(tree), /SER1/); await flush(); tree = h.render(); assert.match(text(tree), /Access denied/);
  assert.equal(button(tree, "Download"), undefined); button(tree, "Try again").props.onClick(); h.render(); await flush();
  assert.match(text(h.render()), /SER1/); h.cleanup();
});

test("closing history cancels pending reads and late records remain hidden", async () => {
  let release; const h = harness("TradeHandoverHistory", async () => new Promise(resolve => { release = resolve; }));
  await h.open(); h.toggle(false); assert.equal(h.requests[0].init.signal.aborted, true);
  release(response(pack)); await flush(); assert.doesNotMatch(text(h.render()), /SER1/); h.cleanup();
});

test("history hides the previous job, business and account before new data returns", async () => {
  const h = harness("TradeHandoverHistory", async (_url, _init, count) => count === 1 ? response(pack) : response(null));
  await h.open();
  for (const change of [() => h.props.workOrderId = "job-2", () => h.setBusiness({ ownerUid: "business-b", role: "owner" }), () => h.props.user = { uid: "second", getIdToken: async () => "second-token" }]) {
    change(); const loading = h.render(); assert.doesNotMatch(text(loading), /SER1|Certificate.pdf/); assert.match(text(loading), /Loading saved records/);
    await flush(); assert.match(text(h.render()), /No earlier completion record/);
  }
  h.cleanup();
});

test("saved document download stays authenticated and revokes its temporary browser URL", async () => {
  const blob = new Blob(["pdf"]);
  const h = harness("TradeHandoverHistory", async url => url.includes("/documents?") ? { ok: true, blob: async () => blob } : response(pack));
  const tree = await h.open(); button(tree, "Download").props.onClick(); await flush(); h.render();
  assert.equal(h.requests[1].url, "/api/trade-handover/documents?download=doc%20%2F1");
  assert.equal(h.requests[1].init.headers.Authorization, "Bearer token"); assert.equal(h.requests[1].init.cache, "no-store");
  assert.deepEqual(h.downloads, [{ url: "blob:download-1", name: "Certificate.pdf" }]);
  h.runTimers(1000); assert.deepEqual(h.revoked, ["blob:download-1"]); h.cleanup();
});

test("closing the record prevents a late document response from opening", async () => {
  let release;
  const h = harness("TradeHandoverHistory", async url => url.includes("/documents?") ? new Promise(resolve => { release = resolve; }) : response(pack));
  const tree = await h.open(); button(tree, "Download").props.onClick(); await flush(); h.toggle(false);
  assert.equal(h.requests[1].init.signal.aborted, true); release({ ok: true, blob: async () => new Blob(["pdf"]) });
  await flush(); assert.deepEqual(h.urls, []); assert.deepEqual(h.downloads, []); h.cleanup();
});

test("download failures and timeouts are visible and retryable", async () => {
  let downloading = false;
  const h = harness("TradeHandoverHistory", async url => !url.includes("/documents?") ? response(pack) : downloading ? new Promise(() => {}) : { ok: false });
  let tree = await h.open(); button(tree, "Download").props.onClick(); await flush(); tree = h.render();
  assert.match(text(tree), /could not be downloaded/); assert.equal(button(tree, "Download").props.disabled, false);
  downloading = true; button(tree, "Download").props.onClick(); await flush(); h.runTimers(25000); tree = h.render();
  assert.match(text(tree), /taking too long to download/); assert.equal(button(tree, "Download").props.disabled, false);
  assert.equal(h.requests.at(-1).init.signal.aborted, true); h.cleanup();
});

test("history read timeouts expose retry without creating any new record", async () => {
  const h = harness("TradeHandoverHistory", async () => new Promise(() => {})); await h.open(); h.runTimers(25000);
  assert.match(text(h.render()), /taking too long to load/); assert.ok(button(h.render(), "Try again"));
  assert.equal(h.requests[0].init.signal.aborted, true); assert.equal(h.requests[0].init.method, undefined); h.cleanup();
});

test("asset tools load once opened and reuse the exact saved assets for existing tools", async () => {
  const h = harness("TradeAssetJobTools", async () => response(pack)); h.render(); await flush(); assert.equal(h.requests.length, 0);
  const tree = await h.open(); assert.equal(h.requests.length, 1); assert.equal(h.requests[0].init.headers.Authorization, "Bearer token");
  assert.equal(h.requests[0].url, "/api/trade-handover?workOrderId=job%20%2F1");
  for (const name of ["TradeAssetLifecycle", "TradeHandoverCorrections"]) {
    const [child] = component(tree, name); assert.deepEqual(child.props.assets, [asset]); assert.equal(child.props.workOrderId, "job /1");
  }
  h.toggle(false); assert.equal(component(h.render(), "TradeAssetLifecycle").length, 0); h.cleanup();
});

test("asset tools do not mount published corrections for a draft or manufacture missing assets", async () => {
  for (const saved of [{ ...pack, status: "draft" }, null, { ...pack, assets: [] }]) {
    const h = harness("TradeAssetJobTools", async () => response(saved)); const tree = await h.open();
    assert.equal(component(tree, "TradeHandoverCorrections").length, 0);
    assert.equal(component(tree, "TradeAssetLifecycle").length, saved?.assets.length ? 1 : 0);
    if (!saved?.assets.length) assert.match(text(tree), /No saved assets/);
    assert.equal(h.requests[0].init.method, undefined); h.cleanup();
  }
});

test("asset tools deny members and hide previous records on access, job or business changes", async () => {
  const h = harness("TradeAssetJobTools", async () => response(pack)); await h.open();
  h.setBusiness({ ownerUid: "business-a", role: "member" }); assert.equal(h.render(), null);
  assert.equal(h.requests[0].init.signal.aborted, true); await flush(); assert.equal(h.requests.length, 1);
  h.setBusiness({ ownerUid: "business-b", role: "owner" }); let tree = h.render(); assert.equal(component(tree, "TradeAssetLifecycle").length, 0);
  await flush(); tree = h.render(); assert.equal(component(tree, "TradeAssetLifecycle").length, 1);
  h.props.workOrderId = "another-job"; tree = h.render(); assert.equal(component(tree, "TradeAssetLifecycle").length, 0); h.cleanup();
});

test("asset permission failures show retry and never mount mutation tools", async () => {
  const h = harness("TradeAssetJobTools", async (_url, _init, count) => count === 1 ? response(null, false, "Not your job") : response(pack));
  let tree = await h.open(); assert.match(text(tree), /Not your job/); assert.equal(component(tree, "TradeAssetLifecycle").length, 0);
  button(tree, "Try again").props.onClick(); h.render(); await flush(); tree = h.render();
  assert.equal(component(tree, "TradeAssetLifecycle").length, 1); h.cleanup();
});

test("asset read close and timeout prevent late data from mounting tools", async () => {
  let release; const h = harness("TradeAssetJobTools", async () => new Promise(resolve => { release = resolve; }));
  await h.open(); h.runTimers(25000); assert.match(text(h.render()), /taking too long to load/);
  h.toggle(false); release(response(pack)); await flush(); assert.equal(component(h.render(), "TradeAssetLifecycle").length, 0); h.cleanup();
});

test("canonical Assets exposes one service disclosure per handover job, including pending records", async () => {
  const records = [1, 2].map(id => ({ ...asset, id: `asset-${id}`, sourceType: "handover", workOrderId: "job-1", workNumber: "TLJ-1", assetCategory: "battery", assetStatus: "active" }));
  const pending = { ...records[0], id: "pending-1", workOrderId: "job-2", workNumber: "TLJ-2" };
  const manual = { ...records[0], id: "manual", sourceType: "manual", workOrderId: "job-3" };
  const h = harness("TradeAssetWorkspace", async () => ({ ok: true, json: async () => ({ ok: true, assets: [...records, manual], pendingReviews: [pending, records[0]], timeline: [] }) }));
  h.render(); h.runTimers(150); await flush(); const tree = h.render();
  assert.deepEqual(component(tree, "TradeAssetJobTools").map(child => child.props.workOrderId), ["job-1", "job-2"]);
  h.setBusiness({ ownerUid: "business-a", role: "member" }); assert.equal(component(h.render(), "TradeAssetJobTools").length, 0); h.cleanup();
});

test("existing lifecycle copy does not promise retired customer dashboards or customer reminder delivery", () => {
  const source = read("TradeAssetLifecycle"); assert.doesNotMatch(source, /private dashboard reminders|only remind the customer/);
  assert.match(source, /Create recurring jobs automatically/); assert.match(source, /protected against duplicates/);
});
