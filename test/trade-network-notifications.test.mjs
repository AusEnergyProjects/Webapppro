import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";

const compile = file => ts.transpileModule(fs.readFileSync(new URL(file, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const routeCode = compile("../src/app/api/trade-job-notifications/route.ts");
const uiCode = compile("../src/components/TradeJobNotifications.tsx");
const postId = "32e50c00-f279-4879-936f-15f287ff38a5";
const lead = { id: postId, title: "Plumber needed", summary: "Plumbing in Richmond VIC, Example Electrical", createdAt: "2026-09-27T10:00:00.000Z" };

function routeHarness() {
  const access = { ownerUid: "owner-a", actorUid: "manager-a", isOwner: false, jobScope: "team", canManageJobs: true, canViewFieldEvidence: true };
  const reads = [], networkCalls = [];
  let leads = [lead];
  const db = { prepare(sql) { return { bind(...values) { return {
    async all() {
      if (sql.includes("FROM trade_job_notification_reads")) return { results: reads.filter(row => row.ownerUid === values[0] && row.actorUid === values[1]).map(row => ({ notification_key: row.key })) };
      if (sql.includes("FROM trade_crm_photo_request_completions")) return { results: [{ id: "photos-1", work_order_id: "job-1", work_number: "JB-1", title: "Existing job", supplied_count: 2, completed_at: "2026-09-27T09:00:00.000Z" }] };
      return { results: [] };
    },
    async run() { assert.match(sql, /INSERT OR IGNORE INTO trade_job_notification_reads/); const [, ownerUid, key, actorUid] = values;
      if (!reads.some(row => row.ownerUid === ownerUid && row.actorUid === actorUid && row.key === key)) reads.push({ ownerUid, actorUid, key });
      return { meta: { changes: 1 } }; },
  }; } }; }, async batch(statements) { return Promise.all(statements.map(statement => statement.run())); } };
  const dependencies = {
    "../../../../db": { getD1: () => db },
    "@/lib/trade-certificate-leads": { certificateLeadEligibilitySql: () => "1=1" },
    "@/lib/admin-server": { sameOrigin: () => true, mfaErrorResponse: () => null, cleanAdminText: (value, maximum) => String(value || "").slice(0, maximum), adminJson: (body, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } }) },
    "@/lib/trade-team-server": { requireInstallerTeamAccess: async () => access },
    "@/lib/trade-team-document-expiry-server": { listTradeTeamDocumentExpiryWarnings: async () => [] },
    "@/lib/trade-quote-delivery-policy.mjs": { tradeQuoteDeliveryPresentation: () => ({}) },
    "@/lib/trade-network-server": { listNetworkLeadNotifications: async scope => { networkCalls.push({ ...scope }); return leads; } },
  };
  const route = {}; Function("require", "exports", routeCode)(id => { assert.ok(dependencies[id], id); return dependencies[id]; }, route);
  const request = body => new Request("https://tlink.test/api/trade-job-notifications", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { access, reads, networkCalls, setLeads(value) { leads = value; },
    async get() { return (await route.GET(new Request("https://tlink.test/api/trade-job-notifications?ownerUid=foreign"))).json(); },
    patch: body => route.PATCH(request(body)),
  };
}

test("network lead notifications use authenticated eligibility, stable IDs and no job/customer target", async () => {
  const h = routeHarness(); const result = await h.get();
  assert.equal(result.unreadCount, 2);
  assert.deepEqual(result.items[0], { id: `network:${postId}`, targetKind: "network", targetId: postId, workOrderId: "", workNumber: "Trade lead", title: lead.title, summary: lead.summary, createdAt: lead.createdAt, targetTab: "quote", source: "network", read: false });
  assert.deepEqual(h.networkCalls, [h.access]);
  assert.equal(result.items[1].id, "customer-photos-ready:photos-1"); assert.equal(result.items[1].targetKind, "job");
  h.setLeads([]); const withoutNetwork = await h.get();
  assert.deepEqual(withoutNetwork.items, [result.items[1]]); assert.equal(withoutNetwork.unreadCount, 1);
});

test("network read receipts remain tenant and actor scoped and cannot mark an ineligible post", async () => {
  const h = routeHarness();
  let result = await h.patch({ notificationKey: `network:${postId}`, ownerUid: "foreign", actorUid: "foreign" });
  assert.equal(result.status, 200); assert.equal((await result.json()).items[0].read, true);
  assert.deepEqual(h.reads, [{ ownerUid: "owner-a", actorUid: "manager-a", key: `network:${postId}` }]);
  h.access.actorUid = "manager-b"; assert.equal((await h.get()).items[0].read, false);
  h.setLeads([]); result = await h.patch({ notificationKey: `network:${postId}` });
  assert.equal(result.status, 404); assert.equal(h.reads.length, 1);
});

test("clear marks current eligible network and existing notifications read without deleting records", async () => {
  const h = routeHarness(); const response = await h.patch({ action: "mark_all_read" });
  const result = await response.json(); assert.equal(response.status, 200); assert.equal(result.unreadCount, 0);
  assert.equal(result.items.length, 2); assert.ok(result.items.every(item => item.read));
  assert.deepEqual(h.reads.map(row => row.key).sort(), ["customer-photos-ready:photos-1", `network:${postId}`].sort());
});

const text = node => node == null || typeof node === "boolean" ? "" : typeof node === "string" || typeof node === "number" ? String(node) : Array.isArray(node) ? node.map(text).join(" ") : text(node.props?.children);
const nodes = (node, predicate) => !node || typeof node !== "object" ? [] : Array.isArray(node) ? node.flatMap(child => nodes(child, predicate)) : [...(predicate(node) ? [node] : []), ...nodes(node.props?.children, predicate)];
function uiHarness(t, { read = false, failRead = false, targetKind = "network" } = {}) {
  let cursor = 0;
  const state = [], effects = [], pending = [], requests = [], opened = [], navigated = [], opportunities = [];
  const hooks = {
    useState(initial) { const i = cursor++; if (!(i in state)) state[i] = typeof initial === "function" ? initial() : initial; return [state[i], value => { state[i] = typeof value === "function" ? value(state[i]) : value; }]; },
    useRef(initial) { const i = cursor++; return state[i] ||= { current: initial }; },
    useCallback(callback, deps) { const i = cursor++; if (!state[i] || deps.some((value, j) => value !== state[i].deps[j])) state[i] = { deps, value: callback }; return state[i].value; },
    useEffect(callback, deps) { const i = cursor++, old = effects[i]; if (!old || deps.some((value, j) => value !== old.deps[j])) { old?.cleanup?.(); effects[i] = { deps }; pending.push(() => { effects[i].cleanup = callback(); }); } },
  };
  let item = { id: `network:${postId}`, targetId: postId, targetKind, workOrderId: "job-1", workNumber: "Trade lead", title: lead.title, summary: lead.summary, createdAt: lead.createdAt, targetTab: "quote", source: targetKind === "network" ? "network" : "customer", read };
  const fetch = async (_url, init = {}) => {
    requests.push(init);
    if (init.method === "PATCH") {
      if (failRead) return Response.json({ error: "Could not save read receipt." }, { status: 503 });
      item = { ...item, read: true };
    }
    return Response.json({ items: [item], unreadCount: item.read ? 0 : 1 });
  };
  const window = { setTimeout: (callback, delay) => delay === 0 ? setImmediate(callback) : undefined, clearTimeout: id => clearImmediate(id), setInterval: () => 0, clearInterval() {}, addEventListener() {}, removeEventListener() {}, requestAnimationFrame: callback => { callback(); return 0; }, cancelAnimationFrame() {} };
  const document = { visibilityState: "visible", addEventListener() {}, removeEventListener() {} };
  const exports = {}; Function("require", "exports", "fetch", "window", "document", uiCode)(id => id === "react" ? hooks : id === "react/jsx-runtime" ? jsx : {}, exports, fetch, window, document);
  const props = { user: { getIdToken: async () => "private-token" }, onOpenNetwork: id => opened.push(id), onNavigate: target => navigated.push(target), onOpenOpportunity: id => opportunities.push(id) };
  const render = () => { cursor = 0; const tree = exports.TradeJobNotifications(props); for (const callback of pending.splice(0)) callback(); return tree; };
  t.after(() => { for (const effect of effects) effect?.cleanup?.(); });
  return { requests, opened, navigated, opportunities, render, async settle() { let tree; for (let i = 0; i < 6; i++) { tree = render(); await new Promise(resolve => setImmediate(resolve)); } return tree; },
    async open() { let tree = await this.settle(); nodes(tree, node => node.type === "button" && node.props["aria-haspopup"] === "dialog")[0].props.onClick(); tree = await this.settle(); return tree; } };
}

for (const options of [{}, { read: true }, { failRead: true }]) test(`network notification opens the exact post with no job fallback (${JSON.stringify(options)})`, async t => {
  const h = uiHarness(t, options); const tree = await h.open(); assert.match(text(tree), /Trade network/);
  nodes(tree, node => node.type === "button" && text(node).includes(lead.title))[0].props.onClick(); await h.settle();
  assert.deepEqual(h.opened, [postId]); assert.deepEqual(h.navigated, []); assert.deepEqual(h.opportunities, []);
  const writes = h.requests.filter(request => request.method === "PATCH"); assert.equal(writes.length, options.read ? 0 : 1);
  if (writes.length) assert.deepEqual(JSON.parse(writes[0].body), { notificationKey: `network:${postId}` });
});

test("existing job and customer opportunity notification destinations are unchanged", async t => {
  for (const targetKind of ["job", "opportunity"]) {
    const h = uiHarness(t, { targetKind, read: true }); const tree = await h.open();
    nodes(tree, node => node.type === "button" && text(node).includes(lead.title))[0].props.onClick(); await h.settle();
    assert.deepEqual(h.opened, []);
    if (targetKind === "opportunity") assert.deepEqual(h.opportunities, [postId]);
    else assert.deepEqual(h.navigated, [{ workspace: "work", kind: "job", id: "job-1", query: "Trade lead", nonce: 1, jobTab: "quote" }]);
  }
});
