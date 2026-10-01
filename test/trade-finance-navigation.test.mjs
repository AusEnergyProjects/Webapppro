import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";
import { createMapNavigationGuard } from "../src/lib/trade-map-navigation.ts";

const read = name => fs.readFileSync(new URL(`../src/components/${name}.tsx`, import.meta.url), "utf8");
const dashboard = ts.createSourceFile("DirectTradeDashboard.tsx", read("DirectTradeDashboard"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const crm = ts.createSourceFile("InstallerCrmWorkspace.tsx", read("InstallerCrmWorkspace"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const compile = source => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
function find(root, predicate) {
  if (predicate(root)) return root;
  let result;
  ts.forEachChild(root, child => { result ||= find(child, predicate); });
  return result;
}
function evaluate(node, source, context = {}) {
  assert.ok(node, "The navigation expression must exist");
  return Function(...Object.keys(context), `${compile(`const expression = (${node.getText(source)});`)}\nreturn expression;`)(...Object.values(context));
}
const helperNames = ["dashboardWorkspaceFromSearch", "dashboardFinanceViewFromSearch", "dashboardWorkViewFromSearch", "jobNavigationFromSearch", "dashboardCommandTargetFromSearch", "opportunityMatchFromSearch", "networkPostFromSearch"];
const variableNames = ["dashboardWorkspaces", "workOrderIdPattern", "opportunityMatchIdPattern"];
const helpersSource = dashboard.statements.filter(node => ts.isFunctionDeclaration(node) && helperNames.includes(node.name?.text)
  || ts.isVariableStatement(node) && node.declarationList.declarations.some(declaration => variableNames.includes(declaration.name.getText(dashboard)))).map(node => node.getText(dashboard)).join("\n");
const helpers = Function(`${compile(helpersSource)}\nreturn {${helperNames.join(",")}};`)();
const financeElement = find(dashboard, node => ts.isJsxSelfClosingElement(node) && node.tagName.getText(dashboard) === "TradeFinanceWorkspace");
const mapHubElement = find(dashboard, node => ts.isJsxSelfClosingElement(node)
  && node.tagName.getText(dashboard) === "TradeBusinessHub"
  && node.attributes.properties.some(attribute => ts.isJsxAttribute(attribute) && attribute.name.getText(dashboard) === "mapWorkspace"));
const setWorkspaceCallback = find(dashboard, node => ts.isVariableDeclaration(node) && node.name.getText(dashboard) === "setWorkspace").initializer.arguments[0];
function guardedWorkspaceSetter(setWorkspaceState, mapNavigation = createMapNavigationGuard()) {
  return evaluate(setWorkspaceCallback, dashboard, { setWorkspaceState, mapNavigation });
}
function dashboardCallback(name, context) {
  const attribute = financeElement.attributes.properties.find(node => ts.isJsxAttribute(node) && node.name.getText(dashboard) === name);
  return evaluate(attribute.initializer.expression, dashboard, context);
}
function dashboardEffect(includes, context) {
  const effect = find(dashboard, node => ts.isCallExpression(node) && node.expression.getText(dashboard) === "useEffect" && node.arguments[0]?.getText(dashboard).includes(includes));
  return evaluate(effect.arguments[0], dashboard, { ...helpers, ...context });
}
const text = node => node == null || typeof node === "boolean" ? "" : typeof node === "string" || typeof node === "number" ? String(node) : Array.isArray(node) ? node.map(text).join(" ") : text(node.props?.children);
const nodes = (node, predicate) => !node || typeof node !== "object" ? [] : Array.isArray(node) ? node.flatMap(item => nodes(item, predicate)) : [...(predicate(node) ? [node] : []), ...nodes(node.props?.children, predicate)];

test("Finance parses all sections and keeps legacy invoice URLs working", () => {
  assert.equal(helpers.dashboardWorkspaceFromSearch("?workspace=invoices"), "finance");
  assert.equal(helpers.dashboardFinanceViewFromSearch("?workspace=invoices&financeView=quotes"), "invoices");
  for (const view of ["quotes", "invoices", "pricebook", "reports"]) {
    const query = `?workspace=finance&financeView=${view}`;
    assert.equal(helpers.dashboardWorkspaceFromSearch(query), "finance");
    assert.equal(helpers.dashboardFinanceViewFromSearch(query), view);
  }
  assert.equal(helpers.dashboardFinanceViewFromSearch("?workspace=finance&financeView=unknown"), "quotes");
  assert.equal(helpers.dashboardWorkspaceFromSearch("?workspace=unknown"), "work");
});

test("retired Follow-ups bookmarks fall back to the Work workspace", () => {
  assert.equal(helpers.dashboardWorkspaceFromSearch("?workspace=follow-ups"), "work");
  assert.equal(helpers.dashboardWorkViewFromSearch("?workspace=follow-ups"), "today");
});

test("Map bookmarks select their own workspace without restoring stale Work job targets", () => {
  assert.equal(helpers.dashboardWorkspaceFromSearch("?workspace=map"), "map");
  assert.equal(helpers.dashboardCommandTargetFromSearch("?workspace=map&jobId=old-job&jobTab=quote"), null);
});

test("Solar tool bookmarks preserve the dedicated workspace and ignore stale job targets", () => {
  assert.equal(helpers.dashboardWorkspaceFromSearch("?workspace=design"), "design");
  assert.equal(helpers.dashboardCommandTargetFromSearch("?workspace=design&jobId=old-job&jobTab=quote"), null);
  assert.equal(helpers.dashboardWorkspaceFromSearch("?workspace=map&crm=customers"), "map");
});

test("Solar and measurements navigation waits for the current design to save", async () => {
  const button = find(dashboard, node => ts.isJsxElement(node)
    && node.openingElement.tagName.getText(dashboard) === "button"
    && node.getText(dashboard).includes('<span>Solar &amp; measurements</span>'));
  const guard = createMapNavigationGuard(), state = { workspace: "map", target: "old-job" };
  const context = { require: () => jsx, exports: {}, TLinkNavigationIcon() {}, workspace: "design",
    setCommandTarget: value => { state.target = value; },
    setWorkspace: guardedWorkspaceSetter(value => { state.workspace = value; }, guard) };
  const entry = evaluate(button, dashboard, context);
  assert.equal(entry.props["aria-current"], "page");
  let finish;
  guard.register(() => new Promise(resolve => { finish = resolve; }));
  entry.props.onClick();
  assert.deepEqual(state, { workspace: "map", target: "old-job" });
  finish(); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(state, { workspace: "design", target: null });
  guard.register(async () => { throw new Error("offline"); });
  state.workspace = "work"; state.target = "keep-job";
  entry.props.onClick(); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(state, { workspace: "work", target: "keep-job" });
});

test("explicit solar navigation opens the existing design tools without mounting customer maps", () => {
  const expression = find(dashboard, node => ts.isJsxExpression(node)
    && node.expression?.getText(dashboard).startsWith('workspace === "design" && (hasBusinessOperations'));
  const context = { require: () => jsx, exports: {}, workspace: "design", hasBusinessOperations: true,
    user: { uid: "owner" }, registerMapSave() {}, TradeDesignWorkspace() {},
    setWorkspace() {}, setCommandTarget() {}, setMapNavigationNonce() {} };
  const view = evaluate(expression.expression, dashboard, context);
  assert.equal(view.type, context.TradeDesignWorkspace);
  assert.equal(view.props.onRegisterMapSave, context.registerMapSave);
  assert.equal(evaluate(expression.expression, dashboard, { ...context, workspace: "map" }), false);
  const blocked = evaluate(expression.expression, dashboard, { ...context, hasBusinessOperations: false });
  assert.match(text(blocked), /Verification required/);
  assert.equal(nodes(blocked, node => node.type === context.TradeDesignWorkspace).length, 0);
});

test("the dedicated design view remounts for each business and retains quote and save handoffs", () => {
  const roof = ts.createSourceFile("TradeRoofDesignMap.tsx", read("TradeRoofDesignMap"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const execute = (name, context) => {
    const declaration = find(roof, node => ts.isFunctionDeclaration(node) && node.name?.text === name);
    return Function("exports", ...Object.keys(context), `${compile(declaration.getText(roof).replace(/^export /, ""))}\nreturn ${name};`)({}, ...Object.values(context));
  };
  const context = { require: () => jsx, TradeDesignWorkspaceView() {}, useTradeBusiness: () => ({ ownerUid: "business-a" }) };
  const props = { user: { uid: "actor" }, onRegisterMapSave() {}, onOpenMap() {} };
  assert.equal(execute("TradeDesignWorkspace", context)(props).key, "actor:business-a");
  assert.equal(execute("TradeDesignWorkspace", { ...context, useTradeBusiness: () => ({ ownerUid: "business-b" }) })(props).key, "actor:business-b");
  const measurement = { kind: "area", quantity: 120 }, setters = [() => {}, () => {}];
  let hook = 0;
  const viewContext = { require: () => jsx, TradeRoofDesignMap() {}, TradeMapQuoteDialog() {}, useState: () => [hook === 0 ? measurement : null, setters[hook++]] };
  const view = execute("TradeDesignWorkspaceView", viewContext)(props);
  const tools = nodes(view, node => node.type === viewContext.TradeRoofDesignMap)[0];
  assert.equal(tools.props.onRegisterMapSave, props.onRegisterMapSave);
  assert.equal(tools.props.onQuote, setters[0]);
  const dialog = nodes(view, node => node.type === viewContext.TradeMapQuoteDialog)[0];
  assert.equal(dialog.props.measurement, measurement);
  assert.equal(dialog.props.onDesignLinked, setters[1]);
  const ownerGate = find(dashboard, node => ts.isJsxOpeningElement(node) && node.tagName.getText(dashboard) === "TradeBusinessGate");
  assert.match(ownerGate.getText(dashboard), /destination="owner"/);
});

test("network bookmarks accept an exact UUID only in the network workspace", () => {
  const id = "ea82d208-35a7-4783-af2c-85c5c8465e1e";
  assert.equal(helpers.networkPostFromSearch(`?workspace=network&networkPostId=${id}`), id);
  for (const search of ["?workspace=network", "?workspace=network&networkPostId=", "?workspace=network&networkPostId=bad-id", `?workspace=network&networkPostId=${id}%20`, `?workspace=work&networkPostId=${id}`]) {
    assert.equal(helpers.networkPostFromSearch(search), "");
  }
  assert.equal(helpers.dashboardCommandTargetFromSearch(`?workspace=network&networkPostId=${id}&jobId=stale-job&jobTab=quote`), null);
});

test("network notification callback waits for the map save before opening the exact post and remounting its view", async () => {
  const notification = find(dashboard, node => ts.isJsxSelfClosingElement(node) && node.tagName.getText(dashboard) === "TradeJobNotifications");
  const callback = notification.attributes.properties.find(node => ts.isJsxAttribute(node) && node.name.getText(dashboard) === "onOpenNetwork");
  const guard = createMapNavigationGuard(), state = { workspace: "map", postId: "previous-post", nonce: 2 };
  const onOpenNetwork = evaluate(callback.initializer.expression, dashboard, {
    setWorkspace: guardedWorkspaceSetter(value => { state.workspace = value; }, guard),
    setNetworkPostId: value => { state.postId = value; }, setNetworkNavigationNonce: update => { state.nonce = update(state.nonce); },
  });
  const id = "ea82d208-35a7-4783-af2c-85c5c8465e1e";
  guard.register(async () => { throw new Error("offline"); }); onOpenNetwork(id); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(state, { workspace: "map", postId: "previous-post", nonce: 2 });
  let finish; guard.register(() => new Promise(resolve => { finish = resolve; }));
  onOpenNetwork(id); assert.deepEqual(state, { workspace: "map", postId: "previous-post", nonce: 2 });
  finish(); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(state, { workspace: "network", postId: id, nonce: 3 });
  const network = find(dashboard, node => ts.isJsxSelfClosingElement(node) && node.tagName.getText(dashboard) === "TradeNetworkWorkspace");
  const context = { require: () => jsx, exports: {}, TradeNetworkWorkspace() {}, user: { uid: "business-owner" }, networkNavigationNonce: state.nonce,
    networkPostId: state.postId, setNetworkPostId: value => { state.postId = value; }, setWorkspace() {}, serviceAreaNavigation: { current: false } };
  const tree = evaluate(network, dashboard, context);
  assert.equal(tree.props.initialPostId, id); assert.equal(tree.key, "business-owner:3");
  assert.notEqual(evaluate(network, dashboard, { ...context, networkNavigationNonce: 4 }).key, tree.key);
  tree.props.onClearPost(); assert.equal(state.postId, "");
});

test("Products and Trade network have direct workspaces and preserve pending map saves", async () => {
  const nav = find(dashboard, node => ts.isJsxElement(node) && node.openingElement.tagName.getText(dashboard) === "nav"
    && node.openingElement.getText(dashboard).includes('aria-label="TLink installer account"'));
  for (const [label, workspace] of [["Products", "products"], ["Trade network", "network"]]) {
    assert.equal(helpers.dashboardWorkspaceFromSearch(`?workspace=${workspace}`), workspace);
    const button = find(nav, node => ts.isJsxElement(node) && node.openingElement.tagName.getText(dashboard) === "button" && node.getText(dashboard).includes(`<span>${label}</span>`));
    const guard = createMapNavigationGuard(), state = { workspace: "map", target: "design", networkPostId: "previous-lead", networkNonce: 0 };
    const tree = evaluate(button, dashboard, { require: () => jsx, exports: {}, TLinkNavigationIcon() {}, workspace: "map", setCommandTarget: value => { state.target = value; },
      setNetworkPostId: value => { state.networkPostId = value; }, setNetworkNavigationNonce: update => { state.networkNonce = update(state.networkNonce); },
      setWorkspace: guardedWorkspaceSetter(value => { state.workspace = value; }, guard) });
    guard.register(async () => { throw new Error("offline"); });
    tree.props.onClick(); await new Promise(resolve => setImmediate(resolve));
    assert.equal(state.workspace, "map");
    assert.equal(state.networkPostId, "previous-lead"); assert.equal(state.networkNonce, 0);
    guard.register(async () => {}); tree.props.onClick(); await new Promise(resolve => setImmediate(resolve));
    assert.equal(state.workspace, workspace);
    if (workspace === "network") { assert.equal(state.networkPostId, ""); assert.equal(state.networkNonce, 1); }
  }
  assert.ok(find(dashboard, node => ts.isJsxSelfClosingElement(node) && node.tagName.getText(dashboard) === "TradePriceBookWorkspace"));
  assert.ok(find(dashboard, node => ts.isJsxSelfClosingElement(node) && node.tagName.getText(dashboard) === "TradeNetworkWorkspace"));
  assert.equal(read("DirectTradeDashboard").includes("InstallerProductMarketplace"), false);
});

test("installer Map navigation is explicit, independently active and clears the previous command", () => {
  const button = find(dashboard, node => ts.isJsxElement(node)
    && node.openingElement.tagName.getText(dashboard) === "button"
    && node.getText(dashboard).includes('<span>Customer &amp; job map</span>'));
  const captured = {};
  const context = {
    require: () => jsx, exports: {}, TLinkNavigationIcon() {}, workspace: "map",
    setCommandTarget: value => { captured.target = value; },
    setMapNavigationNonce: update => { captured.nonce = update(captured.nonce || 0); },
    setWorkspace: guardedWorkspaceSetter(value => { captured.workspace = value; }),
  };
  const active = evaluate(button, dashboard, context);
  assert.equal(active.props["aria-current"], "page");
  assert.equal(active.props.className, "active");
  assert.equal(nodes(active, node => node.type === context.TLinkNavigationIcon)[0].props.name, "map");
  active.props.onClick();
  assert.deepEqual(captured, { target: null, nonce: 1, workspace: "map" });
  active.props.onClick();
  assert.equal(captured.nonce, 2, "clicking Map again must reset a focused record");
  assert.equal(evaluate(button, dashboard, { ...context, workspace: "work" }).props["aria-current"], undefined);
  const installerNav = find(dashboard, node => ts.isJsxElement(node)
    && node.openingElement.tagName.getText(dashboard) === "nav"
    && node.openingElement.getText(dashboard).includes('aria-label="TLink installer account"'));
  const firstButton = installerNav.children.find(node => ts.isJsxElement(node) && node.openingElement.tagName.getText(dashboard) === "button");
  assert.equal(firstButton, button, "Map stays visible first in the compact navigation");
});

test("Map button retains its current record when saving fails and waits for a successful retry", async () => {
  const button = find(dashboard, node => ts.isJsxElement(node)
    && node.openingElement.tagName.getText(dashboard) === "button"
    && node.getText(dashboard).includes('<span>Customer &amp; job map</span>'));
  const guard = createMapNavigationGuard();
  const state = { workspace: "map", target: { kind: "job", id: "current-job" }, nonce: 1 };
  const tree = evaluate(button, dashboard, {
    require: () => jsx, exports: {}, TLinkNavigationIcon() {}, workspace: "map",
    setCommandTarget: value => { state.target = value; },
    setMapNavigationNonce: update => { state.nonce = update(state.nonce); },
    setWorkspace: guardedWorkspaceSetter(value => { state.workspace = value; }, guard),
  });
  guard.register(async () => { throw new Error("offline"); });
  tree.props.onClick(); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(state, { workspace: "map", target: { kind: "job", id: "current-job" }, nonce: 1 });
  let finish;
  guard.register(() => new Promise(resolve => { finish = resolve; }));
  tree.props.onClick(); assert.equal(state.target.id, "current-job"); assert.equal(state.nonce, 1);
  finish(); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(state, { workspace: "map", target: null, nonce: 2 });
});

test("Jobs and Customers tabs keep the current map while its final save is pending or failed", async () => {
  const nav = find(crm, node => ts.isJsxElement(node) && node.openingElement.tagName.getText(crm) === "nav" && node.openingElement.getText(crm).includes('className="crm-nav"'));
  const click = find(nav, node => ts.isJsxAttribute(node) && node.name.getText(crm) === "onClick").initializer.expression;
  const guard = createMapNavigationGuard(), state = { view: "jobs", customer: "current-customer", focusedJob: "current-job" };
  const handler = evaluate(click, crm, {
    mapNavigation: guard, mapWorkspace: true, item: "customers", openVisualSchedule() { assert.fail(); },
    setFocusedJobId: value => { state.focusedJob = value; }, setSelectedCustomerIdState: value => { state.customer = value; },
    setSelectedCustomerDetail() {}, setPriceBookView() {}, setJobReturnTarget() {}, setCreatingState() {}, setViewState: value => { state.view = value; },
  });
  guard.register(async () => { throw new Error("offline"); });
  handler(); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(state, { view: "jobs", customer: "current-customer", focusedJob: "current-job" });
  let finish; guard.register(() => new Promise(resolve => { finish = resolve; }));
  handler(); assert.equal(state.view, "jobs");
  finish(); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(state, { view: "customers", customer: "", focusedJob: "" });
});

test("the Map hub resets between workspaces and keeps Jobs or Customers inside Map", () => {
  const captured = [];
  const context = {
    require: () => jsx, exports: {}, TradeBusinessHub() {}, user: { uid: "business-owner" }, workspace: "map",
    mapNavigationNonce: 1,
    registerMapSave() {},
    hasBusinessOperations: true, hasTeamAccess: true, commandTarget: { kind: "job", id: "old-job" },
    openFinance: view => captured.push(["finance", view]),
    setCommandTarget: value => captured.push(["target", value]),
    setActiveWorkView: value => captured.push(["view", value]),
    setWorkspace: guardedWorkspaceSetter(value => captured.push(["workspace", value])),
  };
  const map = evaluate(mapHubElement, dashboard, context);
  assert.equal(map.key, "business-owner:map:1");
  assert.notEqual(evaluate(mapHubElement, dashboard, { ...context, mapNavigationNonce: 2 }).key, map.key);
  assert.equal(map.props.mapWorkspace, true);
  assert.equal(map.props.navigationTarget, null);
  assert.equal(map.props.fullAccess, true);
  map.props.onWorkViewChange("jobs"); map.props.onWorkViewChange("customers");
  assert.deepEqual(captured, []);
  map.props.onOpenSchedule("2026-09-21");
  assert.ok(captured.some(([kind, value]) => kind === "workspace" && value === "work"));
  assert.ok(captured.some(([kind, value]) => kind === "view" && value === "schedule"));
  const work = evaluate(mapHubElement, dashboard, { ...context, workspace: "work", hasBusinessOperations: false });
  assert.equal(work.key, "business-owner:work:0");
  assert.equal(work.props.mapWorkspace, false);
  assert.equal(work.props.fullAccess, false);
  assert.equal(work.props.navigationTarget.id, "old-job");
});

test("Map detail tools select exact Work destinations and preserve existing Work navigation", () => {
  const attribute = mapHubElement.attributes.properties.find(node => ts.isJsxAttribute(node) && node.name.getText(dashboard) === "onWorkViewChange");
  const run = (workspace, nextView, current) => {
    const captured = {};
    evaluate(attribute.initializer.expression, dashboard, {
      workspace,
      Date: { now: () => 1234 },
      openFinance: value => { captured.finance = value; },
      setCommandTarget: update => { captured.target = update(current); },
      setActiveWorkView: value => { captured.view = value; },
      setWorkspace: guardedWorkspaceSetter(value => { captured.workspace = value; }),
    })(nextView);
    return captured;
  };
  const jobTarget = { workspace: "work", kind: "job", id: "old-job" };
  for (const nextView of ["today", "leads", "schedule", "assets", "templates", "import", "integrations"]) {
    assert.deepEqual(run("map", nextView, jobTarget), {
      target: { workspace: "work", kind: "crm-view", id: nextView, query: "", nonce: 1234 },
      view: nextView,
      workspace: "work",
    });
  }
  for (const workspace of ["map", "work"]) {
    for (const view of ["pricebook", "reports"]) assert.deepEqual(run(workspace, view, jobTarget), { finance: view });
  }
  const viewTarget = { workspace: "work", kind: "crm-view", id: "jobs" };
  assert.deepEqual(run("work", "jobs", viewTarget), { target: viewTarget, view: "jobs", workspace: "work" });
  assert.deepEqual(run("work", "schedule", viewTarget), { target: null, view: "schedule", workspace: "work" });
  assert.deepEqual(run("work", "jobs", jobTarget), { target: jobTarget, view: "jobs", workspace: "work" });
});

test("Map visibility only follows the focused record for its current view", () => {
  const mapBlock = find(crm, node => ts.isJsxExpression(node)
    && node.expression?.getText(crm).startsWith('mapWorkspace && (view === "jobs" || view === "customers")'));
  assert.ok(ts.isBinaryExpression(mapBlock?.expression));
  const visible = overrides => Boolean(evaluate(mapBlock.expression.left, crm, {
    mapWorkspace: true, view: "jobs", creating: "", focusedJobId: "", selectedCustomerId: "", ...overrides,
  }));
  assert.equal(visible({ selectedCustomerId: "stale-customer" }), true);
  assert.equal(visible({ view: "customers", focusedJobId: "stale-job" }), true);
  assert.equal(visible({ focusedJobId: "active-job" }), false);
  assert.equal(visible({ view: "customers", selectedCustomerId: "active-customer" }), false);
  assert.equal(visible({ view: "schedule" }), false);
  assert.equal(visible({ creating: "job" }), false);
  assert.equal(visible({ mapWorkspace: false }), false);
});

test("job links retain quote, invoice and cost tabs on refresh and reject invalid job IDs", () => {
  for (const jobTab of ["quote", "invoice", "field", "summary", "schedule"]) {
    const result = helpers.dashboardCommandTargetFromSearch(`?workspace=work&jobId=job-123&jobTab=${jobTab}`);
    assert.equal(result.kind, "job"); assert.equal(result.id, "job-123"); assert.equal(result.jobTab, jobTab);
  }
  assert.equal(helpers.jobNavigationFromSearch("?workspace=work&jobId=job-123").jobTab, "schedule");
  assert.equal(helpers.jobNavigationFromSearch("?workspace=finance&jobId=job-123&jobTab=invoice"), null);
  assert.equal(helpers.jobNavigationFromSearch("?workspace=work&jobId=bad%20id&jobTab=quote"), null);
});

test("dashboard Finance actions select exact jobs and begin quote creation", () => {
  const captured = {};
  const context = { setCommandTarget: value => captured.target = value, setWorkspace: value => captured.workspace = value, setActiveWorkView: value => captured.workView = value };
  dashboardCallback("onNewQuote", context)();
  assert.equal(captured.workspace, "work"); assert.equal(captured.target.kind, "new-job"); assert.equal(captured.target.jobTab, "quote");
  for (const tab of ["quote", "invoice", "field"]) {
    dashboardCallback("onOpenJob", context)("exact-job", tab);
    assert.equal(captured.target.id, "exact-job"); assert.equal(captured.target.jobTab, tab); assert.equal(captured.target.kind, "job");
  }
  dashboardCallback("onOpenJobs", context)(); assert.equal(captured.target.kind, "crm-view"); assert.equal(captured.target.id, "jobs");
  dashboardCallback("onOpenSchedule", context)(); assert.equal(captured.target.id, "schedule"); assert.equal(captured.workView, "schedule");
});

test("Finance section buttons and existing child tools preserve their handoff callbacks", () => {
  const exports = {};
  const require = name => name === "react/jsx-runtime" ? jsx : name === "next/dynamic" ? { default: () => function Tool() {} } : { default: new Proxy({}, { get: (_, key) => String(key) }) };
  Function("require", "exports", compile(read("TradeFinanceWorkspace")))(require, exports);
  const views = [], jobs = [], opened = [];
  const props = { user: { uid: "owner" }, priceBookView: "packets", onViewChange: view => views.push(view), onOpenJob: (...args) => jobs.push(args), onNewQuote: () => opened.push("new"), onOpenJobs: () => opened.push("jobs"), onOpenSchedule: () => opened.push("schedule") };
  const render = view => exports.TradeFinanceWorkspace({ ...props, view });
  let tree = render("quotes");
  const buttons = nodes(tree, node => node.type === "button");
  assert.deepEqual(buttons.map(text), ["Quotes", "Invoices", "Price book", "Reports & projections"]);
  assert.equal(buttons[0].props["aria-current"], "page");
  buttons.forEach(button => button.props.onClick()); assert.deepEqual(views, ["quotes", "invoices", "pricebook", "reports"]);
  const quote = nodes(tree, node => typeof node.type === "function" && node.props.onNewQuote)[0];
  quote.props.onOpenJob("quote-job"); quote.props.onNewQuote();
  const invoice = nodes(render("invoices"), node => typeof node.type === "function" && node.props.onOpenJob)[0]; invoice.props.onOpenJob("invoice-job");
  const pricebook = nodes(render("pricebook"), node => typeof node.type === "function")[0]; assert.equal(pricebook.props.initialView, "packets");
  const report = nodes(render("reports"), node => typeof node.type === "function")[0];
  report.props.onOpenInvoices(); report.props.onOpenJobCosts("cost-job"); report.props.onOpenJobs(); report.props.onOpenSchedule();
  assert.deepEqual(jobs, [["quote-job", "quote"], ["invoice-job", "invoice"], ["cost-job", "field"]]);
  assert.deepEqual(opened, ["new", "jobs", "schedule"]); assert.equal(views.at(-1), "invoices");
});

test("URL updates canonicalise legacy invoices and preserve section and job-tab history", () => {
  const changes = [];
  const window = { location: { href: "https://tlink.test/direct-trade/dashboard?workspace=invoices&jobId=old&jobTab=quote", search: "?workspace=invoices&jobId=old&jobTab=quote" }, history: { state: {} } };
  for (const method of ["pushState", "replaceState"]) window.history[method] = (_, __, target) => { changes.push({ method, target }); window.location.href = `https://tlink.test${target}`; window.location.search = new URL(window.location.href).search; };
  const context = { window, commandTarget: null, workspace: "finance", financeView: "invoices", activeWorkView: "today", selectedOpportunityMatchId: "", workspaceRouteInitialised: { current: false }, workspacePopstateSync: { current: false }, workspaceLocation: { current: "" }, setCommandTarget() { assert.fail("No job should be restored for a Finance URL"); } };
  dashboardEffect("const routeWorkspace =", context)();
  assert.equal(changes[0].method, "replaceState");
  assert.equal(window.location.search, "?workspace=finance&financeView=invoices");
  dashboardEffect("const routeWorkspace =", { ...context, financeView: "reports" })();
  assert.equal(changes.at(-1).method, "pushState"); assert.equal(helpers.dashboardFinanceViewFromSearch(window.location.search), "reports");
  dashboardEffect("const routeWorkspace =", { ...context, workspace: "work", activeWorkView: "jobs", commandTarget: { kind: "job", id: "job-123", jobTab: "invoice" } })();
  assert.equal(new URL(window.location.href).searchParams.has("financeView"), false);
  assert.equal(helpers.jobNavigationFromSearch(window.location.search).jobTab, "invoice");
  dashboardEffect("const routeWorkspace =", { ...context, workspace: "map", activeWorkView: "schedule" })();
  assert.equal(window.location.search, "?workspace=map");
});

test("network URL updates retain only the exact post and remove stale job and finance targets", () => {
  const id = "ea82d208-35a7-4783-af2c-85c5c8465e1e", changes = [];
  const window = { location: { href: "https://tlink.test/direct-trade/dashboard?workspace=finance&financeView=quotes&jobId=stale&jobTab=quote", search: "?workspace=finance&financeView=quotes&jobId=stale&jobTab=quote" }, history: { state: {} } };
  for (const method of ["pushState", "replaceState"]) window.history[method] = (_, __, target) => { changes.push({ method, target }); window.location.href = `https://tlink.test${target}`; window.location.search = new URL(window.location.href).search; };
  const context = { window, commandTarget: null, workspace: "network", networkPostId: id, financeView: "quotes", activeWorkView: "today", selectedOpportunityMatchId: "", workspaceRouteInitialised: { current: true }, workspacePopstateSync: { current: false }, workspaceLocation: { current: "" }, setCommandTarget() { assert.fail("A network link must not restore a job target"); } };
  dashboardEffect("const routeWorkspace =", context)();
  assert.equal(changes[0].method, "pushState"); assert.equal(window.location.search, `?workspace=network&networkPostId=${id}`);
  dashboardEffect("const routeWorkspace =", { ...context, networkPostId: "" })();
  assert.equal(window.location.search, "?workspace=network");
  window.location.href = "https://tlink.test/direct-trade/dashboard?workspace=network&networkPostId=invalid";
  window.location.search = "?workspace=network&networkPostId=invalid";
  context.workspacePopstateSync.current = true;
  dashboardEffect("const routeWorkspace =", { ...context, networkPostId: helpers.networkPostFromSearch(window.location.search) })();
  assert.equal(changes.at(-1).method, "replaceState"); assert.equal(window.location.search, "?workspace=network");
});

test("browser back restores the Finance section and retains existing job targets", async () => {
  const captured = { setNetworkNavigationNonce: 0 }, listeners = {};
  const context = { window: { location: { search: "?workspace=finance&financeView=pricebook" }, addEventListener: (name, fn) => listeners[name] = fn, removeEventListener() {} }, workspacePopstateSync: { current: false }, workspaceLocation: { current: "" }, pendingOpportunityMatchId: { current: "" }, exactOpportunityMatchId: { current: "" } };
  for (const name of ["setWorkspace", "setFinanceView", "setActiveWorkView", "setSelectedOpportunityMatchId", "setFocusedOpportunityMatchId", "setOpportunityRouteRequestNonce", "setCommandTarget", "setNetworkPostId", "setNetworkNavigationNonce"]) context[name] = value => captured[name] = typeof value === "function" ? value(captured[name]) : value;
  context.setWorkspace = guardedWorkspaceSetter(value => { captured.setWorkspace = value; });
  const cleanup = dashboardEffect('window.addEventListener("popstate"', context)();
  listeners.popstate(); await Promise.resolve(); assert.equal(captured.setWorkspace, "finance"); assert.equal(captured.setFinanceView, "pricebook");
  context.window.location.search = "?workspace=work&jobId=job-123&jobTab=quote";
  listeners.popstate(); await Promise.resolve(); assert.equal(captured.setCommandTarget.id, "job-123"); assert.equal(captured.setCommandTarget.jobTab, "quote");
  context.window.location.search = "?workspace=map";
  listeners.popstate(); await Promise.resolve(); assert.equal(captured.setWorkspace, "map"); assert.equal(captured.setCommandTarget, null);
  const postId = "ea82d208-35a7-4783-af2c-85c5c8465e1e";
  context.window.location.search = `?workspace=network&networkPostId=${postId}`;
  listeners.popstate(); await Promise.resolve(); assert.equal(captured.setWorkspace, "network"); assert.equal(captured.setNetworkPostId, postId);
  assert.equal(captured.setNetworkNavigationNonce, 4); assert.equal(captured.setCommandTarget, null);
  for (const query of ["?workspace=network", "?workspace=network&networkPostId=not-a-uuid"]) {
    context.window.location.search = query; listeners.popstate(); await Promise.resolve();
    assert.equal(captured.setNetworkPostId, ""); assert.equal(captured.setCommandTarget, null);
  }
  cleanup();
});

test("network browser history retains the current map on failed save and applies the exact target after retry", async () => {
  const postId = "ea82d208-35a7-4783-af2c-85c5c8465e1e", listeners = {}, changes = [];
  const guard = createMapNavigationGuard();
  const captured = { setWorkspace: "map", setNetworkPostId: "previous-post", setNetworkNavigationNonce: 1, setCommandTarget: { kind: "job", id: "current-map-job" } };
  const context = { window: { location: { search: `?workspace=network&networkPostId=${postId}` }, history: { state: {}, replaceState(_state, _title, target) { changes.push(target); context.window.location.search = new URL(target, "https://tlink.test").search; } },
    addEventListener: (name, fn) => { listeners[name] = fn; }, removeEventListener() {} }, workspacePopstateSync: { current: false }, workspaceLocation: { current: "/direct-trade/dashboard?workspace=map" }, pendingOpportunityMatchId: { current: "" }, exactOpportunityMatchId: { current: "" } };
  for (const name of ["setFinanceView", "setActiveWorkView", "setSelectedOpportunityMatchId", "setFocusedOpportunityMatchId", "setOpportunityRouteRequestNonce", "setCommandTarget", "setNetworkPostId", "setNetworkNavigationNonce"]) context[name] = value => { captured[name] = typeof value === "function" ? value(captured[name]) : value; };
  context.setWorkspace = guardedWorkspaceSetter(value => { captured.setWorkspace = value; }, guard);
  const cleanup = dashboardEffect('window.addEventListener("popstate"', context)();
  guard.register(async () => { throw new Error("offline"); }); listeners.popstate(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(captured.setWorkspace, "map"); assert.equal(captured.setNetworkPostId, "previous-post");
  assert.equal(captured.setNetworkNavigationNonce, 1); assert.equal(captured.setCommandTarget.id, "current-map-job");
  assert.deepEqual(changes, ["/direct-trade/dashboard?workspace=map"]);
  assert.equal(context.window.location.search, "?workspace=map");
  let finish; guard.register(() => new Promise(resolve => { finish = resolve; }));
  context.window.location.search = `?workspace=network&networkPostId=${postId}`; listeners.popstate();
  assert.equal(captured.setWorkspace, "map"); assert.equal(captured.setNetworkPostId, "previous-post");
  finish(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(captured.setWorkspace, "network"); assert.equal(captured.setNetworkPostId, postId);
  assert.equal(captured.setNetworkNavigationNonce, 2); assert.equal(captured.setCommandTarget, null); assert.equal(context.workspacePopstateSync.current, true);
  cleanup();
});

test("owner Work removes duplicate finance tabs while authorised staff retain them", () => {
  const declaration = find(crm, node => ts.isVariableDeclaration(node) && node.name.getText(crm) === "allowedViews");
  const filter = find(crm, node => ts.isCallExpression(node) && node.expression.getText(crm) === "allowedViews.filter");
  const ownerViews = evaluate(declaration.initializer.arguments[0], crm, { staffPermissions: undefined })();
  const ownerFilter = evaluate(filter.arguments[0], crm, { mapWorkspace: false, onOpenFinance() {} });
  assert.equal(ownerViews.filter(ownerFilter).includes("pricebook"), false); assert.equal(ownerViews.filter(ownerFilter).includes("reports"), false);
  const permissions = { canViewPriceBook: true, canRunReports: true };
  const staffViews = evaluate(declaration.initializer.arguments[0], crm, { staffPermissions: permissions })();
  const staffFilter = evaluate(filter.arguments[0], crm, { mapWorkspace: false, onOpenFinance: undefined });
  assert.deepEqual(staffViews.filter(staffFilter), ["jobs", "pricebook", "reports"]);
  const restrictedViews = evaluate(declaration.initializer.arguments[0], crm, { staffPermissions: {} })(); assert.deepEqual(restrictedViews.filter(staffFilter), ["jobs"]);
});
