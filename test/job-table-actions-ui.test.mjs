import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";
import * as dateHelpers from "../src/lib/job-register-dates.ts";

const compile = name => ts.transpileModule(fs.readFileSync(new URL(`../src/components/${name}.tsx`, import.meta.url), "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const text = node => node == null || typeof node === "boolean" ? "" : typeof node === "string" || typeof node === "number" ? String(node) : Array.isArray(node) ? node.map(text).join(" ") : text(node.props?.children);
const nodes = (node, predicate) => !node || typeof node !== "object" ? [] : Array.isArray(node) ? node.flatMap(child => nodes(child, predicate)) : [...(predicate(node) ? [node] : []), ...nodes(node.props?.children, predicate)];
const button = (tree, label) => nodes(tree, node => node.type === "button" && text(node).trim() === label)[0];
const flush = () => new Promise(resolve => setImmediate(resolve));
const job = { id: "intent-1", jobId: "job-1", jobNumber: "TLJ-ABCDE234", workNumber: "TLJ-ABCDE234", jobTitle: "Heat pump installation", title: "Heat pump installation", serviceCategory: "hot-water", customerName: "Example Customer", customerNumber: "CUS-21", customerPhone: "+61400000000", customerEmail: "customer@example.invalid", installerBusiness: "Example Installer", siteArea: "Melbourne VIC 3000", serviceAddress: "Example site VIC 3000", jobStage: "scheduled", stage: "scheduled", jobPriority: "high", assigneeLabel: "Assigned technician", plannedStart: "2026-09-22T09:00:00Z", scheduledStart: "2026-09-22T09:00:00Z", createdAt: "2026-09-20T10:00:00Z", updatedAt: "2026-09-21T10:00:00Z", planningCurrent: true, status: "planned", programCode: "VEU", activityKey: "hot-water", activityTitle: "Hot water", quotedValueCents: 123400, invoicedValueCents: 50000, quoteStatus: "accepted", invoiceStatus: "issued" };

function harness(name, options = {}) {
  const slots = [], effects = [], callbacks = [], queued = [], timers = new Map(), requests = [], copied = [], documentEvents = new Map(), windowEvents = new Map();
  let cursor = 0, timerId = 0, dialogOpens = 0, focusCount = 0;
  const different = (old, deps) => !old || deps.some((value, index) => value !== old[index]);
  const hooks = {
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === "function" ? initial() : initial; return [slots[i], value => { slots[i] = typeof value === "function" ? value(slots[i]) : value; }]; },
    useRef(initial) { const i = cursor++; return slots[i] ||= { current: initial }; },
    useCallback(callback, deps) { const i = cursor++; if (different(callbacks[i]?.deps, deps)) callbacks[i] = { callback, deps }; return callbacks[i].callback; },
    useEffect(callback, deps) { const i = cursor++; if (different(effects[i]?.deps, deps)) { effects[i]?.cleanup?.(); effects[i] = { deps }; queued.push(() => { effects[i].cleanup = callback(); }); } },
  };
  hooks.useLayoutEffect = hooks.useEffect;
  const document = { activeElement: null, documentElement: { clientWidth: 369 }, getElementById: () => ({ focus() {} }), addEventListener: (name, handler) => documentEvents.set(name, handler), removeEventListener: name => documentEvents.delete(name) };
  const window = { innerWidth: 390, innerHeight: 500, setTimeout(callback) { const id = ++timerId; timers.set(id, callback); return id; }, clearTimeout: id => timers.delete(id), requestAnimationFrame: callback => callback(), addEventListener: (name, handler) => windowEvents.set(name, handler), removeEventListener: name => windowEvents.delete(name) };
  const navigator = { clipboard: { async writeText(value) { if (options.clipboardFails) throw new Error("Denied"); copied.push(value); } } };
  const item = { ...job, customerFirstName: "Example", customerLastName: "Customer", customerBusinessName: "", ...options.job };
  const api = async (path, init) => {
    requests.push({ path, init });
    if (path.startsWith("/api/admin/jobs?")) return { ok: true, jobs: [item], facets: { stages: [], services: [], installers: [] }, pagination: { total: 1, pageSize: 50, hasNext: false } };
    if (path.includes("?")) return { ok: true, items: [item], total: 1, page: 1, totalPages: 1 };
    return { ok: true, customer: { first_name: "Fresh", last_name: "Customer", phone: item.customerPhone }, groups: [], serviceSiteAddressProvenance: { entryMode: "manual", provider: "", providerReference: "", formattedAddress: "", verifiedAt: "", reviewRequired: true } };
  };
  function WorkspaceTableTools() {}
  function CreditexAuditCallPanel() {}
  const shared = {};
  const require = id => id === "react" ? hooks : id === "react/jsx-runtime" ? jsx : id === "./JobRowActions" ? shared : id === "@/lib/job-register-dates" ? dateHelpers : id.endsWith(".module.css") ? { default: new Proxy({}, { get: (_, key) => String(key) }) } : id === "./WorkspaceTableTools" ? { WorkspaceTableTools, downloadWorkspaceCsv() {} } : id === "./CreditexAuditCallPanel" ? { CreditexAuditCallPanel } : id === "@/lib/firebase-client" ? { firebaseAuth: { currentUser: { uid: "reviewer" } } } : {};
  Function("require", "exports", "window", "document", compile("JobRowActions"))(require, shared, window, document);
  const exported = {};
  if (name !== "JobRowMenu" && name !== "JobActionsButton") Function("require", "exports", "window", "document", "navigator", compile(name))(require, exported, window, document, navigator);
  const launcher = { isConnected: true, focus() { focusCount++; }, getBoundingClientRect: () => ({ left: 345, bottom: 470 }), querySelector: () => null };
  function attach(tree) { for (const node of nodes(tree, node => node.props?.ref)) { if (node.props.ref.current == null) node.props.ref.current = node.type === "dialog" ? { showModal() { dialogOpens++; }, close() {} } : node.props.role === "menu" ? { style: {}, getBoundingClientRect: () => ({ width: 248, height: 190 }), querySelector: () => null, contains: () => false } : { focus() {}, scrollIntoView() {}, scrollTop: 0, scrollLeft: 0 }; } }
  const render = props => { cursor = 0; const tree = (shared[name] || exported[name])(props || { api }); attach(tree); for (const effect of queued.splice(0)) effect(); return tree; };
  const menu = tree => nodes(tree, node => node.type === shared.JobRowMenu)[0].props;
  const trigger = tree => nodes(tree, node => node.type === shared.JobActionsButton)[0];
  const event = (type = "click") => ({ type, clientX: 385, clientY: 495, currentTarget: launcher, preventDefault() {} });
  return { render, shared, requests, copied, menu, trigger, event, launcher, document, window, documentEvents, windowEvents, get dialogOpens() { return dialogOpens; }, get focusCount() { return focusCount; },
    async settle() { render(); for (const callback of timers.values()) callback(); timers.clear(); await flush(); return render(); },
    async mount() { render(); for (const callback of timers.values()) callback(); timers.clear(); await flush(); return render(); },
    cleanup() { for (const effect of effects) effect?.cleanup?.(); } };
}

test("admin table renders every returned detail column and both entry points expose the same real actions", async () => {
  const h = harness("AdminJobDirectory"); let tree = await h.mount();
  assert.match(text(tree), /Created/); assert.match(text(tree), /20 Sept 2026/);
  const labels = ["View job details", "Copy job reference"];
  h.trigger(tree).props.onClick(h.event()); tree = h.render(); assert.deepEqual(h.menu(tree).menu.actions.map(action => action.label), labels);
  h.menu(tree).onClose(); tree = h.render();
  nodes(tree, node => node.type === "tr" && node.props.onContextMenu)[0].props.onContextMenu(h.event("contextmenu")); tree = h.render();
  assert.deepEqual(h.menu(tree).menu.actions.map(action => action.label), labels);
  h.menu(tree).menu.actions[0].run(); tree = h.render();
  const detail = nodes(tree, node => node.type === "dialog")[0]; assert.match(text(detail), /Heat pump installation/); assert.match(text(detail), /Example Installer/); assert.equal(h.dialogOpens, 1);
  button(detail, "Close").props.onClick(); assert.equal(nodes(h.render(), node => node.type === "dialog").length, 0); assert.ok(h.focusCount); h.cleanup();
});

test("copy reference stays local and clipboard denial produces a useful failure message", async () => {
  for (const clipboardFails of [false, true]) {
    const h = harness("AdminJobDirectory", { clipboardFails }); let tree = await h.mount();
    h.trigger(tree).props.onClick(h.event()); tree = h.render(); h.menu(tree).menu.actions[1].run(); await flush(); tree = h.render();
    assert.equal(h.requests.length, 1); assert.equal(h.requests[0].init, undefined);
    assert.deepEqual(h.copied, clipboardFails ? [] : [job.workNumber]); assert.match(text(tree), clipboardFails ? /Copy was unavailable/ : /Job reference copied/); h.cleanup();
  }
});

test("Creditex displays independent contact, priority, assignment, quote, invoice and update columns", async () => {
  const h = harness("CreditexPlannedIntakeQueue"); const tree = await h.mount();
  const headings = nodes(tree, node => node.type === "th").map(text);
  assert.equal(headings.length, 17);
  for (const label of ["Created", "Work", "First name", "Last name", "Contact", "Priority", "Assigned to", "Quote", "Invoice", "Record status", "Updated"]) assert.ok(headings.some(heading => heading.includes(label)), label);
  assert.match(text(tree), /customer@example.invalid/); assert.match(text(tree), /Assigned technician/); assert.match(text(tree), /\$1,234\.00/); assert.match(text(tree), /\$500\.00/); h.cleanup();
});

test("Creditex names remain stored fields and business-only customers never receive guessed personal names", async () => {
  const h = harness("CreditexPlannedIntakeQueue", { job: { customerFirstName: "", customerLastName: "", customerName: "Example Business Pty Ltd", customerBusinessName: "Example Business Pty Ltd", createdAt: "2026-09-20T14:01:00.000Z" } });
  const tree = await h.mount(); const row = nodes(tree, node => node.type === "tr" && node.props.onContextMenu)[0];
  const cells = nodes(row, node => node.type === "td");
  assert.equal(text(cells[1]), "21 Sept 2026");
  assert.match(text(cells[3]), /Not recorded/); assert.match(text(cells[3]), /Business:.*Example Business Pty Ltd/);
  assert.match(text(cells[4]), /Not recorded/); assert.doesNotMatch(text(cells[4]), /Business|Pty|Ltd/); h.cleanup();
});

test("Creditex context actions copy only selected values and Call customer opens authorised controls without dialing", async () => {
  const h = harness("CreditexPlannedIntakeQueue"); let tree = await h.mount();
  nodes(tree, node => node.type === "tr" && node.props.onContextMenu)[0].props.onContextMenu(h.event("contextmenu")); tree = h.render();
  let actions = h.menu(tree).menu.actions; assert.deepEqual(actions.map(action => action.label), ["Open job audit", "Call customer", "Copy job reference", "Copy site address"]);
  actions[2].run(); actions[3].run(); await flush(); assert.deepEqual(h.copied, [job.jobNumber, job.serviceAddress]); assert.equal(h.requests.length, 1);
  h.menu(tree).onClose(); actions[1].run(); await flush(); tree = h.render();
  assert.equal(h.requests.at(-1).path, "/api/creditex/job-intents/intent-1");
  assert.ok(h.requests.every(request => !request.init?.method && !request.init?.body), "context actions only read authorised records");
  assert.ok(h.requests[0].init.signal instanceof AbortSignal, "the list read supports cancellation");
  assert.ok(nodes(tree, node => node.props?.["aria-label"] === "Customer audit call controls").length); assert.match(text(tree), /Fresh Customer/); h.cleanup();
});

test("missing phone and address never create unavailable calling or copy actions; refresh dismisses a stale menu", async () => {
  const h = harness("CreditexPlannedIntakeQueue", { job: { customerPhone: "", serviceAddress: "" } }); let tree = await h.mount();
  h.trigger(tree).props.onClick(h.event()); tree = h.render(); assert.deepEqual(h.menu(tree).menu.actions.map(action => action.label), ["Open job audit", "Copy job reference"]);
  button(tree, "Refresh").props.onClick(); await flush(); assert.equal(h.menu(h.render()).menu, null); h.cleanup();
});

test("shared menu clamps to the narrow viewport and supports arrow keys, Home, End, Escape and outside dismissal", () => {
  const h = harness("JobRowMenu"), closed = [], focused = [], focusScrolls = [];
  const items = [0, 1, 2].map(index => ({ focus(options) {
    focused.push(index); h.document.activeElement = this;
    if (!options?.preventScroll) { focusScrolls.push(index); h.windowEvents.get("scroll")?.({ target: h.document }); }
  } }));
  const element = { style: {}, getBoundingClientRect: () => ({ width: 248, height: 190 }), querySelector: () => items[0], querySelectorAll: () => items, contains: value => value === element || items.includes(value) };
  const menu = { id: "job-menu", label: "TLJ-ABCDE234", x: 385, y: 495, launcher: h.launcher, actions: [{ label: "View details", run() {} }] };
  // Ref is attached before layout effects in React; seed the standalone renderer's same boundary.
  let tree = h.render({ menu: null, onClose: value => closed.push(value) });
  tree = h.render({ menu, onClose: value => closed.push(value) });
  tree.props.ref.current = element;
  tree = h.render({ menu: { ...menu }, onClose: value => closed.push(value) });
  assert.equal(element.style.left, "113px"); assert.equal(element.style.top, "302px"); assert.equal(focused.at(-1), 0);
  assert.equal(Number.parseInt(element.style.left) + 248, h.document.documentElement.clientWidth - 8);
  const key = value => tree.props.onKeyDown({ key: value, currentTarget: element, preventDefault() {} });
  key("ArrowDown"); assert.equal(focused.at(-1), 1); key("End"); assert.equal(focused.at(-1), 2); key("ArrowDown"); assert.equal(focused.at(-1), 0); key("Home"); assert.equal(focused.at(-1), 0); key("ArrowUp"); assert.equal(focused.at(-1), 2);
  assert.deepEqual(focusScrolls, []); assert.deepEqual(closed, []);
  h.windowEvents.get("scroll")({ target: element });
  h.windowEvents.get("scroll")({ target: items[2] });
  assert.deepEqual(closed, [], "scrolling within the menu must keep it open");
  h.windowEvents.get("scroll")({ target: h.document });
  assert.deepEqual(closed, [false], "scrolling the underlying page must dismiss the menu");
  key("Escape"); assert.equal(closed.at(-1), undefined);
  h.documentEvents.get("pointerdown")({ target: {} }); assert.equal(closed.at(-1), false);
  h.cleanup(); assert.equal(h.documentEvents.size, 0); assert.equal(h.windowEvents.size, 0);
});

test("visible menu button is named, announces expansion and opens using keyboard arrows", () => {
  const h = harness("JobActionsButton"); let clicks = 0;
  const tree = h.render({ label: job.jobNumber, menuId: "menu-1", expanded: true, onClick() {} });
  assert.equal(tree.props["aria-label"], `Actions for ${job.jobNumber}`); assert.equal(tree.props["aria-haspopup"], "menu"); assert.equal(tree.props["aria-controls"], "menu-1");
  tree.props.onKeyDown({ key: "ArrowDown", preventDefault() {}, currentTarget: { click() { clicks++; } } }); assert.equal(clicks, 1); h.cleanup();
});
