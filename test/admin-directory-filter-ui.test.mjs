import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";

const text = node => node == null || typeof node === "boolean" ? "" : typeof node === "string" || typeof node === "number" ? String(node) : Array.isArray(node) ? node.map(text).join(" ") : text(node.props?.children);
const nodes = (node, predicate) => !node || typeof node !== "object" ? [] : Array.isArray(node) ? node.flatMap(child => nodes(child, predicate)) : [...(predicate(node) ? [node] : []), ...nodes(node.props?.children, predicate)];
const flush = () => new Promise(resolve => setImmediate(resolve));
const field = (tree, label) => nodes(tree, node => node.props?.["aria-label"] === label)[0];
const account = name => ({ accountKey: name, firebaseUid: name, accountType: "installer", name, email: "", secondary: "", addressState: "VIC", postcode: "3000", accountStatus: "active", verificationStatus: "under_review", accessApproved: false, isSynthetic: false, updatedAt: "2026-09-21", createdAt: "2026-09-21" });

function harness({ catalogue = false, partners = false, preferences, saved = false, respond } = {}) {
  const slots = [], effects = [], callbacks = [], pending = [], timers = new Map(), requests = [];
  let cursor = 0, timerId = 0;
  const changed = (before, after) => !before || after.some((value, index) => value !== before[index]);
  const hooks = {
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], value => { slots[i] = typeof value === "function" ? value(slots[i]) : value; }]; },
    useRef(initial) { const i = cursor++; return slots[i] ||= { current: initial }; },
    useCallback(callback, deps) { const i = cursor++; if (changed(callbacks[i]?.deps, deps)) callbacks[i] = { callback, deps }; return callbacks[i].callback; },
    useEffect(callback, deps) { const i = cursor++; if (changed(effects[i]?.deps, deps)) { effects[i]?.cleanup?.(); effects[i] = { deps }; pending.push(() => { effects[i].cleanup = callback(); }); } },
  };
  function WorkspaceListControls() {}
  function WorkspaceTableTools() {}
  const source = fs.readFileSync(new URL(`../src/components/${catalogue ? "AdminCatalogueWorkspace" : partners ? "AdminAccountWorkspace" : "AdminAccountDirectory"}.tsx`, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const exported = {};
  const require = name => name === "react" ? hooks : name === "react/jsx-runtime" ? jsx
    : name.endsWith("WorkspaceListControls") ? { WorkspaceListControls }
      : name.endsWith("WorkspaceTableTools") ? { WorkspaceTableTools, downloadWorkspaceCsv() {} }
        : name.endsWith("admin-workspace") ? { readable: value => value, workspaceError: error => error.message, dateTime: value => value }
          : name.endsWith("australian-postcodes.mjs") ? { AUSTRALIAN_STATE_CODES: ["VIC"] }
            : name.endsWith(".css") ? { default: {} } : {};
  const api = async path => {
    requests.push(path);
    if (path.startsWith("/api/admin/list-views")) return { preferences: preferences || { filter: "open", listing: "open", pageSize: 25 }, saved };
    if (respond) { const custom = await respond(path); if (custom) return custom; }
    return { accounts: partners ? [] : [account("Current result")], products: [], counts: {}, pagination: { page: Number(new URL(path, "https://test").searchParams.get("page")), pageSize: 25, total: 100, pageCount: 4, hasNext: true, nextCursor: "next-cursor" } };
  };
  const window = { setTimeout(callback) { const id = ++timerId; timers.set(id, callback); return id; }, clearTimeout(id) { timers.delete(id); } };
  Function("require", "exports", "window", compiled)(require, exported, window);
  const props = { api, role: "owner", onManageTrade() {}, onManageAdmin() {}, onCounts() {}, setStatus() {} };
  const render = () => { cursor = 0; const tree = catalogue ? exported.AdminCatalogueWorkspace(props) : partners ? exported.AdminAccountWorkspace(props) : exported.AdminAccountDirectory(props); for (const effect of pending.splice(0)) effect(); return tree; };
  const runTimers = () => { const callbacks = [...timers.values()]; timers.clear(); for (const callback of callbacks) callback(); };
  return { render, requests, controls: tree => nodes(tree, node => node.type === WorkspaceListControls)[0],
    async settle() { await flush(); let tree = render(); runTimers(); await flush(); tree = render(); return tree; },
    async mount() { render(); await flush(); render(); runTimers(); await flush(); return render(); },
    cleanup() { for (const effect of effects) effect?.cleanup?.(); }, runTimers };
}

test("new account views exclude closed while explicit old saved all/closed views remain accessible", async () => {
  for (const [preferences, expected] of [[undefined, "open"], [{ filter: "all", pageSize: 25 }, ""], [{ filter: "closed", pageSize: 25 }, "closed"]]) {
    const h = harness({ preferences, saved: Boolean(preferences) }); const tree = await h.mount();
    const request = new URL(h.requests.find(path => path.startsWith("/api/admin/directory")), "https://test");
    assert.equal(request.searchParams.get("status") || "", expected); assert.equal(field(tree, "Account status").props.value, expected);
    assert.match(text(tree), /Current accounts/); assert.match(text(tree), /Excludes closed accounts across every role/);
    assert.doesNotMatch(text(tree), /Apply filters/); assert.match(text(tree), /Clear filters/); h.cleanup();
  }
});

test("every account filter change restarts cursor paging at page one", async () => {
  for (const [label, value] of [["Search all accounts", "new"], ["Account type", "customer"], ["Account status", "closed"], ["Test account marker", "only"]]) {
    const h = harness(); let tree = await h.mount();
    h.controls(tree).props.onPage(2); tree = h.render(); h.runTimers(); tree = await h.settle();
    assert.equal(h.controls(tree).props.page, 2);
    field(tree, label).props.onChange({ target: { value } }); h.render(); h.runTimers(); tree = await h.settle();
    const latest = new URL(h.requests.filter(path => path.startsWith("/api/admin/directory")).at(-1), "https://test");
    assert.equal(latest.searchParams.get("page"), "1"); assert.equal(latest.searchParams.has("cursor"), false); assert.equal(latest.searchParams.has("total"), false); h.cleanup();
  }
});

test("an earlier slow account response cannot overwrite the newest filter result", async () => {
  let resolveSlow;
  const h = harness({ respond: path => {
    const search = new URL(path, "https://test").searchParams.get("search");
    if (search === "slow") return new Promise(resolve => { resolveSlow = resolve; });
    if (search === "new") return { accounts: [account("Newest account")], pagination: { total: 1, pageCount: 1 }, counts: {} };
  } });
  let tree = await h.mount(); field(tree, "Search all accounts").props.onChange({ target: { value: "slow" } }); h.render(); h.runTimers(); await flush();
  field(h.render(), "Search all accounts").props.onChange({ target: { value: "new" } }); h.render(); h.runTimers(); tree = await h.settle();
  assert.match(text(tree), /Newest account/);
  resolveSlow({ accounts: [account("Obsolete account")], pagination: { total: 999, pageCount: 40 }, counts: {} }); tree = await h.settle();
  assert.match(text(tree), /Newest account/); assert.doesNotMatch(text(tree), /Obsolete account/); assert.equal(h.controls(tree).props.total, 1); h.cleanup();
});

test("catalogue default excludes archived but saved archived and all listing views are retained", async () => {
  for (const [preferences, expected] of [[undefined, "open"], [{ filter: "all", listing: "archived", pageSize: 25 }, "archived"], [{ filter: "all", listing: "", pageSize: 25 }, ""]]) {
    const h = harness({ catalogue: true, preferences, saved: Boolean(preferences) }); const tree = await h.mount();
    const request = new URL(h.requests.find(path => path.startsWith("/api/admin/products")), "https://test");
    assert.equal(request.searchParams.get("listing") || "", expected); assert.match(text(tree), /Current listings \(exclude archived\)/); h.cleanup();
  }
});

test("partner default excludes closed while legacy and explicitly saved account states are retained", async () => {
  for (const [preferences, expected] of [[undefined, "open"], [{ filter: "approved", pageSize: 25 }, ""], [{ filter: "all", accountStatus: "", pageSize: 25 }, ""], [{ filter: "all", accountStatus: "closed", pageSize: 25 }, "closed"]]) {
    const h = harness({ partners: true, preferences, saved: Boolean(preferences) }); const tree = await h.mount();
    const request = new URL(h.requests.find(path => path.startsWith("/api/admin/accounts?")), "https://test");
    assert.equal(request.searchParams.get("status") || "", expected);
    assert.equal(field(tree, "Partner account status").props.value, expected);
    if (preferences?.filter === "approved") assert.equal(request.searchParams.get("verification"), "approved");
    h.cleanup();
  }
});

test("changing partner account status resets cursor and count pagination", async () => {
  const h = harness({ partners: true }); let tree = await h.mount();
  h.controls(tree).props.onPage(2); h.render(); h.runTimers(); tree = await h.settle();
  assert.equal(h.controls(tree).props.page, 2);
  field(tree, "Partner account status").props.onChange({ target: { value: "closed" } }); h.render(); h.runTimers(); await h.settle();
  const latest = new URL(h.requests.filter(path => path.startsWith("/api/admin/accounts?")).at(-1), "https://test");
  assert.equal(latest.searchParams.get("status"), "closed");
  assert.equal(latest.searchParams.get("page"), "1");
  assert.equal(latest.searchParams.has("cursor"), false);
  assert.equal(latest.searchParams.has("total"), false);
  h.cleanup();
});

test("open status API filters exclude only closed or archived records in both count and page queries", async () => {
  for (const [route, parameter, column, excluded] of [["directory", "status", "account_status", "closed"], ["accounts", "status", "account_status", "closed"], ["products", "listing", "p.listing_status", "archived"]]) {
    const queries = [];
    const statement = (sql, bindings = []) => ({ bind: (...values) => statement(sql, values), first: async () => { queries.push({ sql, bindings }); return { total: 0 }; }, all: async () => { queries.push({ sql, bindings }); return { results: [] }; } });
    const admin = { role: "owner", uid: "owner" };
    const dependencies = {
      "../../../../../db": { getD1: () => ({ prepare: statement }) },
      "@/lib/admin-server": { requireAdminIdentity: async () => admin, cleanAdminText: (value, length) => typeof value === "string" ? value.trim().slice(0, length) : "", sameOrigin: () => true, adminJson: (body, status = 200) => Response.json(body, { status }), adminError: error => { throw error; } },
      "@/lib/australian-postcodes.mjs": { AUSTRALIAN_STATE_CODES: ["VIC"] },
      "@/lib/postcode-distance": {},
      "@/lib/keyset-pagination": { decodeKeysetCursor: () => null },
      "@/lib/route-performance": { routeTimer: () => ({ databases: values => Promise.all(values) }), performanceJson: body => Response.json(body) },
      "@/lib/fts-search": {}, "@/lib/trade-abn": {}, "@/lib/direct-trade-entitlements": {},
      "@/lib/trade-access-server": { approvedTradeReviewPredicate: () => "1 = 1", verifiedTradeAccountPredicate: () => "1 = 1" },
    };
    const source = fs.readFileSync(new URL(`../src/app/api/admin/${route}/route.ts`, import.meta.url), "utf8");
    const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const exported = {};
    Function("require", "exports", compiled)(name => { assert.ok(Object.hasOwn(dependencies, name), name); return dependencies[name]; }, exported);
    assert.equal((await exported.GET(new Request(`https://test/api/admin/${route}?${parameter}=open`))).status, 200);
    assert.equal(queries.filter(query => query.sql.includes(`${column} <> '${excluded}'`)).length, route === "directory" ? 3 : 2);
    queries.length = 0;
    assert.equal((await exported.GET(new Request(`https://test/api/admin/${route}?${parameter}=${excluded}`))).status, 200);
    assert.equal(queries.filter(query => query.sql.includes(`${column} = ?`) && query.bindings.includes(excluded)).length, 2);
    if (route === "directory") {
      const globalCounts = queries.find(query => query.sql.includes("SUM(CASE WHEN account_type"));
      assert.match(globalCounts.sql, /directory WHERE account_status <> 'closed'$/);
      assert.deepEqual(globalCounts.bindings, []);
    }
  }
});

test("saved view normalization preserves explicit historical all and archived choices", () => {
  const dependencies = {
    "../../db": {}, "@/lib/admin-server": { cleanAdminText: (value, length) => typeof value === "string" ? value.trim().slice(0, length) : "" },
    "@/lib/creditex-dataforce-job-csv": { DATAFORCE_JOB_CSV_HEADERS: [] },
    "@/lib/trade-crm-job-register": { JOB_REGISTER_COLUMN_KEYS: [], JOB_REGISTER_OPERATIONAL_STATUSES: [] },
    "@/lib/customer-register-range": { CUSTOMER_REGISTER_FILTER_VERSION: 1, defaultCustomerCreatedRange: () => ({ from: "", to: "" }) },
    "@/lib/trade-crm-register-sorts": { INSTALLER_CUSTOMER_REGISTER_SORT_VALUES: [], INSTALLER_JOB_REGISTER_SORT_VALUES: [] },
  };
  const source = fs.readFileSync(new URL("../src/lib/workspace-list-views.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exported = {};
  Function("require", "exports", compiled)(name => { assert.ok(Object.hasOwn(dependencies, name), name); return dependencies[name]; }, exported);
  assert.equal(exported.defaultListView("admin-accounts").filter, "open");
  assert.equal(exported.defaultListView("admin-customers").filter, "open");
  assert.equal(exported.defaultListView("admin-products").listing, "open");
  assert.equal(exported.defaultListView("admin-partners").accountStatus, "open");
  assert.equal(exported.cleanListView("admin-partners", { filter: "approved" }).accountStatus, "");
  for (const accountStatus of ["", "open", "active", "suspended", "closed"]) assert.equal(exported.cleanListView("admin-partners", { accountStatus }).accountStatus, accountStatus);
  assert.equal(exported.cleanListView("admin-partners", { accountStatus: "unexpected" }).accountStatus, "");
  for (const filter of ["all", "open", "closed"]) assert.equal(exported.cleanListView("admin-accounts", { filter }).filter, filter);
  for (const listing of ["", "open", "archived"]) assert.equal(exported.cleanListView("admin-products", { listing }).listing, listing);
});
