import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";
import * as contract from "../src/lib/portal-customer-connect.ts";

const source = fs.readFileSync(new URL("../src/components/PortalConnectWorkspace.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const text = node => node == null || typeof node === "boolean" ? "" : typeof node !== "object" ? String(node) : Array.isArray(node) ? node.map(text).join(" ") : text(node.props?.children);
const nodes = (node, predicate) => !node || typeof node !== "object" ? [] : Array.isArray(node) ? node.flatMap(child => nodes(child, predicate)) : [...(predicate(node) ? [node] : []), ...nodes(node.props?.children, predicate)];
const button = (tree, label) => nodes(tree, node => node.type === "button" && text(node) === label)[0];
const flush = () => new Promise(resolve => setImmediate(resolve));
const customer = { id: "intent-one", name: "Alex Example", phone: "0400000000", email: "alex@example.test", address: "12 Sample Street", jobNumber: "JOB-1", jobTitle: "Work", activity: "Assessment", installer: "Business", headsetAllowed: true };
const user = { uid: "user", getIdToken: async () => "test-token" };
function harness(api, component = "CustomerDirectory", initial = {}) {
  let cursor = 0; let props = { workspace: "creditex", source: "certificate", user, callActive: false, onCallActiveChange() {}, ...initial };
  const slots = [], effects = [], queued = [], requests = []; const listeners = new Map();
  const hooks = {
    useState(initialValue) { const index = cursor++; if (!(index in slots)) slots[index] = typeof initialValue === "function" ? initialValue() : initialValue; return [slots[index], value => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }]; },
    useEffect(effect, dependencies) { const index = cursor++; if (!effects[index] || dependencies.some((value, position) => value !== effects[index].dependencies[position])) {
      effects[index]?.cleanup?.(); effects[index] = { dependencies }; queued.push(() => { effects[index].cleanup = effect(); });
    } },
  };
  const loaded = {};
  Function("require", "exports", "fetch", "window", `${compiled}\nexports.CustomerDirectory=CustomerDirectory; exports.CustomerContact=CustomerContact; exports.ConnectWorkspace=ConnectWorkspace; exports.Customers=Customers;`)(name => {
    if (name === "react") return hooks;
    if (name === "react/jsx-runtime") return jsx;
    if (name === "@/lib/portal-customer-connect") return contract;
    if (name === "./PortalTeamWorkspace") return { PortalTeamWorkspace: "TeamWorkspace" };
    if (name === "./CreditexAuditCallPanel") return { CreditexAuditCallPanel: "CallPanel" };
    if (name.endsWith(".module.css")) return { default: new Proxy({}, { get: (_, key) => key }) };
    throw Error(name);
  }, loaded, async (path, init) => { requests.push({ path, init }); return api(path, init); }, { addEventListener: (name, callback) => listeners.set(name, callback), removeEventListener: name => listeners.delete(name) });
  const render = next => { if (next) props = { ...props, ...next }; cursor = 0; const tree = loaded[component](props); for (const effect of queued.splice(0)) effect(); return tree; };
  const settle = async () => { render(); await flush(); return render(); };
  return { render, settle, requests, loaded, listeners, cleanup() { for (const effect of effects) effect?.cleanup?.(); } };
}
const ok = data => ({ ok: true, json: async () => ({ ok: true, ...data }) });

test("customers load authenticated with no automatic selection or call preparation", async () => {
  const h = harness(async () => ok({ customers: [customer], page: 1, hasNext: false }));
  const tree = await h.settle(); assert.match(text(tree), /Alex Example/); assert.match(text(tree), /Choose a customer/);
  assert.equal(h.requests.length, 1); assert.match(h.requests[0].path, /actorMode=compliance/);
  assert.equal(h.requests[0].init.headers.Authorization, "Bearer test-token");
  assert.equal(h.requests[0].init.method, undefined); assert.equal(nodes(tree, node => node.type === "CallPanel").length, 0); h.cleanup();
});
test("a selected customer's panel receives the exact authorised job and manual links", () => {
  const h = harness(async () => ok({}));
  const tree = h.loaded.CustomerContact({ customer, user, onCallActiveChange() {} });
  assert.equal(nodes(tree, node => node.type === "CallPanel")[0].props.jobIntentId, "intent-one");
  assert.deepEqual(nodes(tree, node => node.type === "a").map(node => node.props.href), ["mailto:alex%40example.test", "tel:0400000000"]);
  const denied = h.loaded.CustomerContact({ customer: { ...customer, headsetAllowed: false }, user, onCallActiveChange() {} });
  assert.equal(nodes(denied, node => node.type === "CallPanel").length, 0); assert.match(text(denied), /own Creditex team access/);
});
test("failed search removes the old contacts and offers an explicit retry", async () => {
  let fail = false; const h = harness(async () => fail ? { ok: false, json: async () => ({ ok: false, error: "Access changed" }) } : ok({ customers: [customer], page: 1, hasNext: false }));
  let tree = await h.settle(); assert.match(text(tree), /Alex Example/); fail = true;
  nodes(tree, node => node.type === "form")[0].props.onSubmit({ preventDefault() {} }); tree = await h.settle();
  assert.doesNotMatch(text(tree), /Alex Example/); assert.match(text(tree), /Access changed/); assert.ok(button(tree, "Try again")); h.cleanup();
});
test("an aborted search ignores its late private result", async () => {
  let release; const h = harness(async () => new Promise(resolve => { release = resolve; }));
  h.render(); await flush(); h.cleanup(); release(ok({ customers: [customer], page: 1, hasNext: false })); await flush();
  assert.doesNotMatch(text(h.render()), /Alex Example/);
});
test("active calls lock customer search and list changes", async () => {
  const h = harness(async () => ok({ customers: [customer], page: 1, hasNext: false }));
  await h.settle(); const tree = h.render({ callActive: true });
  assert.equal(button(tree, "Search").props.disabled, true);
  assert.equal(nodes(tree, node => node.type === "button" && text(node).includes("Alex Example"))[0].props.disabled, true);
  nodes(tree, node => node.type === "form")[0].props.onSubmit({ preventDefault() {} }); await h.settle(); assert.equal(h.requests.length, 1); h.cleanup();
});
test("Admin enquiries reuse current Admin endpoint and omit withdrawn contacts", async () => {
  const h = harness(async () => ok({ leads: [{ id: "a", name: "Current", status: "new", phone: "0400000000" }, { id: "b", name: "Withdrawn", status: "withdrawn" }] }), "CustomerDirectory", { workspace: "admin", source: "enquiry" });
  const tree = await h.settle(); assert.match(h.requests[0].path, /^\/api\/admin\/energy-assistant-leads\?/);
  assert.match(text(tree), /Current/); assert.doesNotMatch(text(tree), /Withdrawn/); h.cleanup();
});
test("Admin account redaction is preserved and pagination uses the server cursor", async () => {
  const h = harness(async () => ok({ accounts: [{ accountKey: "customer:one", name: "Private customer account", email: "", addressState: "", postcode: "" }], pagination: { hasNext: true, nextCursor: "private-page-cursor" } }), "CustomerDirectory", { workspace: "admin", source: "account" });
  let tree = await h.settle(); assert.match(h.requests[0].path, /^\/api\/admin\/directory\?/); assert.match(text(tree), /Private customer account/);
  button(tree, "Next").props.onClick(); tree = await h.settle();
  assert.match(h.requests.at(-1).path, /page=2/); assert.match(h.requests.at(-1).path, /cursor=private-page-cursor/); h.cleanup();
});
test("Connect defaults to Customers and still mounts the actual Team workspace", () => {
  const h = harness(async () => ok({}), "ConnectWorkspace");
  let tree = h.render(); assert.equal(button(tree, "Customers").props["aria-pressed"], true);
  button(tree, "Team").props.onClick(); tree = h.render();
  const team = nodes(tree, node => node.type === "TeamWorkspace")[0]; assert.equal(team.props.workspace, "creditex"); assert.equal(team.props.user.uid, "user");
});
test("workspace or signed-in identity changes remount the complete Connect state", () => {
  const h = harness(async () => ok({}));
  const keys = [{ workspace: "admin", user }, { workspace: "creditex", user }, { workspace: "admin", user: { ...user, uid: "another" } }].map(props => h.loaded.PortalConnectWorkspace(props).key);
  assert.equal(new Set(keys).size, 3);
});
test("active call state reaches the outer portal and clears on unmount", () => {
  const changes = []; const h = harness(async () => ok({}), "ConnectWorkspace", { onActiveChange: active => changes.push(active) });
  let tree = h.render();
  const customers = nodes(tree, node => typeof node.type === "function" && node.type.name === "Customers")[0];
  customers.props.onCallActiveChange(true); tree = h.render();
  assert.equal(changes.at(-1), true); assert.equal(button(tree, "Team").props.disabled, true);
  assert.match(text(tree), /Finish the active call/);
  let prevented = false; const event = { preventDefault() { prevented = true; } }; h.listeners.get("beforeunload")(event);
  assert.equal(prevented, true); assert.equal(event.returnValue, "");
  customers.props.onCallActiveChange(false); h.render(); assert.equal(h.listeners.has("beforeunload"), false);
  h.cleanup(); assert.equal(changes.at(-1), false);
});
test("Connect inherits portal colours and pairs its selected accent with portal button ink", () => {
  const css = fs.readFileSync(new URL("../src/components/PortalConnectWorkspace.module.css", import.meta.url), "utf8");
  const preferences = fs.readFileSync(new URL("../src/components/PortalWorkspacePreferences.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(css, /--trade-/);
  assert.match(css, /\.customers\s*\{[^}]*background:var\(--portal-surface/);
  assert.match(css, /\.directory\s*\{[^}]*background:var\(--portal-soft/);
  assert.match(css, /\.workspace\s*\{[^}]*color:var\(--portal-ink/);
  assert.match(css, /\.tabs button\[aria-pressed=true\]\s*\{[^}]*background:var\(--portal-green-dark[^}]*color:var\(--portal-button-ink/);
  const sharedTokens = [...new Set([...css.matchAll(/var\((--portal-[a-z-]+)/g)].map(match => match[1]))];
  for (const token of sharedTokens) assert.ok(preferences.includes(`"${token}": night ?`), `${token} must be defined for both day and night`);
});
test("Team conversations and tasks inherit the portal palette without resetting it to trade defaults", () => {
  const css = fs.readFileSync(new URL("../src/components/PortalTeamWorkspace.module.css", import.meta.url), "utf8");
  assert.doesNotMatch(css, /--trade-/);
  assert.doesNotMatch(css, /--portal-(?:ink|line|surface|soft)\s*:/);
  assert.match(css, /--portal-accent:\s*var\(--portal-green-dark/);
  assert.match(css, /\.compose>button\s*\{[^}]*color:var\(--portal-button-ink\)/);
  assert.match(css, /\.toolbar>button:last-child\s*\{[^}]*color:var\(--portal-button-ink\)/);
  assert.match(css, /\.error\s*\{[^}]*background:var\(--portal-error-bg\)[^}]*color:var\(--portal-error-ink\)/);
});
