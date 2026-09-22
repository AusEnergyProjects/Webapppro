import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";

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
const helperNames = ["dashboardWorkspaceFromSearch", "dashboardFinanceViewFromSearch", "dashboardWorkViewFromSearch", "jobNavigationFromSearch", "dashboardCommandTargetFromSearch", "opportunityMatchFromSearch"];
const variableNames = ["dashboardWorkspaces", "workOrderIdPattern", "opportunityMatchIdPattern"];
const helpersSource = dashboard.statements.filter(node => ts.isFunctionDeclaration(node) && helperNames.includes(node.name?.text)
  || ts.isVariableStatement(node) && node.declarationList.declarations.some(declaration => variableNames.includes(declaration.name.getText(dashboard)))).map(node => node.getText(dashboard)).join("\n");
const helpers = Function(`${compile(helpersSource)}\nreturn {${helperNames.join(",")}};`)();
const financeElement = find(dashboard, node => ts.isJsxSelfClosingElement(node) && node.tagName.getText(dashboard) === "TradeFinanceWorkspace");
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
  const context = { window, commandTarget: null, workspace: "finance", financeView: "invoices", activeWorkView: "today", selectedOpportunityMatchId: "", workspaceRouteInitialised: { current: false }, workspacePopstateSync: { current: false }, setCommandTarget() { assert.fail("No job should be restored for a Finance URL"); } };
  dashboardEffect("window.history.replaceState", context)();
  assert.equal(changes[0].method, "replaceState");
  assert.equal(window.location.search, "?workspace=finance&financeView=invoices");
  dashboardEffect("window.history.replaceState", { ...context, financeView: "reports" })();
  assert.equal(changes.at(-1).method, "pushState"); assert.equal(helpers.dashboardFinanceViewFromSearch(window.location.search), "reports");
  dashboardEffect("window.history.replaceState", { ...context, workspace: "work", activeWorkView: "jobs", commandTarget: { kind: "job", id: "job-123", jobTab: "invoice" } })();
  assert.equal(new URL(window.location.href).searchParams.has("financeView"), false);
  assert.equal(helpers.jobNavigationFromSearch(window.location.search).jobTab, "invoice");
});

test("browser back restores the Finance section and retains existing job targets", () => {
  const captured = {}, listeners = {};
  const context = { window: { location: { search: "?workspace=finance&financeView=pricebook" }, addEventListener: (name, fn) => listeners[name] = fn, removeEventListener() {} }, workspacePopstateSync: { current: false }, pendingOpportunityMatchId: { current: "" }, exactOpportunityMatchId: { current: "" } };
  for (const name of ["setWorkspace", "setFinanceView", "setActiveWorkView", "setSelectedOpportunityMatchId", "setFocusedOpportunityMatchId", "setOpportunityRouteRequestNonce", "setCommandTarget"]) context[name] = value => captured[name] = typeof value === "function" ? value(captured[name]) : value;
  const cleanup = dashboardEffect('window.addEventListener("popstate"', context)();
  listeners.popstate(); assert.equal(captured.setWorkspace, "finance"); assert.equal(captured.setFinanceView, "pricebook");
  context.window.location.search = "?workspace=work&jobId=job-123&jobTab=quote";
  listeners.popstate(); assert.equal(captured.setCommandTarget.id, "job-123"); assert.equal(captured.setCommandTarget.jobTab, "quote");
  cleanup();
});

test("owner Work removes duplicate finance tabs while authorised staff retain them", () => {
  const declaration = find(crm, node => ts.isVariableDeclaration(node) && node.name.getText(crm) === "allowedViews");
  const filter = find(crm, node => ts.isCallExpression(node) && node.expression.getText(crm) === "allowedViews.filter");
  const ownerViews = evaluate(declaration.initializer.arguments[0], crm, { staffPermissions: undefined })();
  const ownerFilter = evaluate(filter.arguments[0], crm, { onOpenFinance() {} });
  assert.equal(ownerViews.filter(ownerFilter).includes("pricebook"), false); assert.equal(ownerViews.filter(ownerFilter).includes("reports"), false);
  const permissions = { canViewPriceBook: true, canRunReports: true };
  const staffViews = evaluate(declaration.initializer.arguments[0], crm, { staffPermissions: permissions })();
  const staffFilter = evaluate(filter.arguments[0], crm, { onOpenFinance: undefined });
  assert.deepEqual(staffViews.filter(staffFilter), ["jobs", "pricebook", "reports"]);
  const restrictedViews = evaluate(declaration.initializer.arguments[0], crm, { staffPermissions: {} })(); assert.deepEqual(restrictedViews.filter(staffFilter), ["jobs"]);
});
