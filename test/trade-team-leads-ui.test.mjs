import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";
import { enquiryCompletionLabel } from "../src/lib/enquiry-timing.mjs";
import { ENERGY_SERVICE_LABELS } from "../src/lib/energy-service-catalogue.mjs";

const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
const workspace = read("../src/components/TradeTeamLeadsWorkspace.tsx");
const inbox = read("../src/components/TradeLeadInbox.tsx");
const settings = read("../src/components/TradeTeamSettings.tsx");
function declarations(source, names, file) {
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  return ast.statements.filter(node => ts.isFunctionDeclaration(node) && names.includes(node.name?.text)).map(node => node.getText(ast)).join("\n").replaceAll("export function", "function");
}
const jsx = (type, props, ...children) => ({ type, props: { ...props, children } });
const context = { React: { createElement: jsx }, enquiryCompletionLabel, serviceLabels: ENERGY_SERVICE_LABELS };
const executable = ts.transpileModule(declarations(inbox, ["tradeLeadContactIsRedacted", "tradeLeadLocation", "TradeLeadList", "TradeLeadFilters", "TradeLeadReadOnlyDetails"], "TradeLeadInbox.tsx") + "\n" + declarations(workspace, ["teamLeadActions"], "TradeTeamLeadsWorkspace.tsx"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None, jsx: ts.JsxEmit.React },
}).outputText;
runInNewContext(`${executable}\nglobalThis.list=TradeLeadList;globalThis.filters=TradeLeadFilters;globalThis.details=TradeLeadReadOnlyDetails;globalThis.actions=teamLeadActions;`, context);
const flatten = value => Array.isArray(value) ? value.flatMap(flatten) : value && typeof value === "object" ? [value, ...flatten(value.props?.children)] : [];
const label = value => Array.isArray(value) ? value.map(label).join("") : value && typeof value === "object" ? label(value.props?.children) : typeof value === "string" ? value : "";
const fixture = overrides => ({ matchId: "lead-a", title: "Solar enquiry", matchStatus: "offered", createdAt: "2026-10-12T00:00:00Z", matchedAt: "2026-10-12T00:00:00Z", summary: "Solar and storage", suburb: "Melbourne", postcode: "3000", state: "VIC", platformOnly: true, customerContact: null, matchedCategories: ["solar"], serviceCategories: ["solar"], requestedWorkBy: "", requestedCompletion: "flexible", approvedSharedFileCount: 0, quotePreparation: null, enquiryPack: null, evidence: [], ...overrides });
const manager = { jobScope: "team", canViewLeads: true, canManageLeads: true, canCreateJobs: true, canViewQuotes: true, canManageQuotes: true, canSendQuotes: true };

test("read-only Leads permission never renders lead or quote mutations", () => {
  const lead = fixture();
  for (const permissions of [{}, { ...manager, canViewLeads: false }, { ...manager, canManageLeads: false }]) {
    const actions = context.actions(permissions, lead);
    assert.equal(actions.interested, false); assert.equal(actions.remove, false); assert.equal(actions.publicQuote, false); assert.equal(actions.platformQuote, false);
  }
});

test("lead manager actions match server quote and lead-state boundaries", () => {
  assert.equal(context.actions(manager, fixture()).interested, true);
  assert.equal(context.actions(manager, fixture({ platformOnly: false })).interested, true);
  assert.equal(context.actions({ ...manager, jobScope: "own" }, fixture({ platformOnly: false })).interested, false);
  assert.equal(context.actions({ ...manager, jobScope: "own" }, fixture({ platformOnly: false, matchStatus: "interested" })).publicQuote, false);
  for (const permission of ["canCreateJobs", "canViewQuotes", "canManageQuotes"]) {
    assert.equal(context.actions({ ...manager, [permission]: false }, fixture({ platformOnly: false })).interested, false, permission);
    assert.equal(context.actions({ ...manager, [permission]: false }, fixture({ platformOnly: false, matchStatus: "connected" })).publicQuote, false, permission);
  }
  assert.equal(context.actions(manager, fixture({ matchStatus: "connected" })).remove, false, "accepted protected project cannot be removed");
  assert.equal(context.actions(manager, fixture({ matchStatus: "connected", platformOnly: false })).remove, true);
  assert.equal(context.actions(manager, fixture({ matchStatus: "interested" })).platformQuote, true);
  assert.equal(context.actions({ ...manager, canSendQuotes: false }, fixture({ matchStatus: "interested" })).platformQuote, false);
  for (const matchStatus of ["closed", "declined"]) assert.equal(context.actions(manager, fixture({ matchStatus })).interested, false);
});

test("shared Leads list uses consent-safe title, selection and region", () => {
  const selected = [];
  const lead = fixture({ customerContact: { name: "Hidden person", phone: "Hidden phone", email: "visible@example.test", suburb: "Melbourne", postcode: "3000", addressState: "VIC", redactedFields: ["name", "phone"] } });
  const tree = context.list({ opportunities: [lead], selectedMatchId: lead.matchId, onSelect: id => selected.push(id) });
  const button = flatten(tree).find(node => node.type === "button");
  assert.equal(button.props["aria-current"], "true");
  assert.equal(button.props["aria-controls"], "opportunity-lead-a");
  assert.match(label(tree), /Solar enquiry/); assert.doesNotMatch(label(tree), /Hidden person/);
  assert.match(label(tree), /Melbourne 3000, VIC/);
  button.props.onClick(); assert.deepEqual(selected, ["lead-a"]);
});

test("shared filters clear all criteria and expose state and service choices", () => {
  const changes = [], tree = context.filters({ opportunities: [fixture()], visibleCount: 1, search: "Solar", status: "offered", service: "solar", state: "VIC", onSearch: value => changes.push(["search", value]), onStatus: value => changes.push(["status", value]), onService: value => changes.push(["service", value]), onState: value => changes.push(["state", value]) });
  const clear = flatten(tree).find(node => node.type === "button");
  clear.props.onClick(); assert.deepEqual(changes, [["search", ""], ["status", ""], ["service", ""], ["state", ""]]);
  assert.equal(flatten(tree).filter(node => node.type === "select").length, 3);
});

test("staff selected detail honours each contact redaction and exposes shared answers and files", () => {
  const file = { id: "photo", fileName: "roof.jpg", promptLabel: "Roof", downloadHref: "/api/public-plan-quote-preparation?download=photo" };
  const opened = [], lead = fixture({ customerContact: { name: "Hidden person", phone: "Hidden phone", email: "visible@example.test", addressLine1: "", addressLine2: "", suburb: "Melbourne", addressState: "VIC", postcode: "3000", redactedFields: ["name", "phone"] }, evidence: [file], quotePreparation: { answers: [{ questionId: "solar", label: "Existing solar", answer: "Yes" }] } });
  const tree = context.details({ opportunity: lead, busy: false, onOpenEvidence: value => opened.push(value) });
  assert.doesNotMatch(label(tree), /Hidden person|Hidden phone/);
  assert.match(label(tree), /Redacted by the customer/); assert.match(label(tree), /Existing solarYes/);
  const links = flatten(tree).filter(node => node.type === "a");
  assert.deepEqual(links.map(node => node.props.href), ["mailto:visible@example.test"]);
  flatten(tree).find(node => node.type === "button").props.onClick(); assert.deepEqual(opened, [file]);
  const privateTree = context.details({ opportunity: fixture(), busy: false, onOpenEvidence() {} });
  assert.match(label(privateTree), /stay protected until the customer chooses this business/);
});

test("manager preset includes Leads while office and field require explicit owner grant", () => {
  const ast = ts.createSourceFile("TradeTeamSettings.tsx", settings, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const names = ["fullPermissions", "officePermissions", "fieldPermissions"];
  const vars = ast.statements.filter(node => ts.isVariableStatement(node) && node.declarationList.declarations.some(declaration => names.includes(declaration.name.getText(ast)))).map(node => node.getText(ast)).join("\n");
  const code = ts.transpileModule(vars + declarations(settings, ["enforcePermissionDependencies"], "TradeTeamSettings.tsx"), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const policy = {}; runInNewContext(`${code}\nglobalThis.manager=fullPermissions;globalThis.office=officePermissions;globalThis.field=fieldPermissions;globalThis.enforce=enforcePermissionDependencies;`, policy);
  assert.equal(policy.manager.canViewLeads, true); assert.equal(policy.manager.canManageLeads, true);
  for (const preset of [policy.office, policy.field]) { assert.equal(preset.canViewLeads, false); assert.equal(preset.canManageLeads, false); }
  assert.equal(policy.enforce({ ...policy.field, canManageLeads: true }).canViewLeads, true);
  assert.match(settings, /key === "canViewLeads" && !value \? \{ canManageLeads: false \}/);
});

test("staff Leads mounts independently, uses the selected business and cancels private requests on leaving", () => {
  const portal = read("../src/components/TradeTeamPortal.tsx");
  assert.match(portal, /dynamic\(\(\) => import\("\.\/TradeTeamLeadsWorkspace"\)/);
  assert.match(portal, /PortalWorkspaceLoading message="Opening leads\.\.\." error=\{error\} retry=\{retry\}/);
  assert.match(portal, /portalView === "leads" && leadsAllowed && permissions && <TradeTeamLeadsWorkspace key=\{salesScopeKey\}/);
  assert.match(portal, /permissions\?\.canViewLeads && !data\.access\?\.crewId/);
  assert.match(workspace, /const fetch = useTradeBusinessFetch\(\)/);
  assert.match(workspace, /controller\.abort\(\)/);
  assert.match(workspace, /setLeads\(\[\]\); setServerManage\(false\)/);
  assert.match(workspace, /permissions\.canManageLeads && serverManage/);
  assert.match(workspace, /publicLeadQuoteNavigationTarget\(result\.quoteWorkflow\)/);
});

function loader(response, overrides = {}) {
  const ast = ts.createSourceFile("TradeTeamLeadsWorkspace.tsx", workspace, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const component = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "TradeTeamLeadsWorkspace");
  const declaration = component.body.statements.flatMap(node => ts.isVariableStatement(node) ? [...node.declarationList.declarations] : []).find(node => node.name.getText(ast) === "refresh");
  const callback = declaration.initializer.arguments[0].getText(ast);
  const mutations = [], requests = [];
  const values = { permissions: { canViewLeads: true }, listRequest: { current: null }, requests: { current: new Set() }, mounted: { current: true }, AbortController,
    user: { getIdToken: async () => "fixture-token" }, isMfaRequiredResponse: () => false,
    fetch: async (url, options) => { requests.push({ url, options }); return response; },
    ...Object.fromEntries(["setLoading", "setError", "setLeads", "setServerManage", "setLoaded", "setMfaRequired"].map(name => [name, value => mutations.push([name, value])])), ...overrides };
  runInNewContext(ts.transpileModule(`globalThis.refresh = ${callback}`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, values);
  return { context: values, mutations, requests, run: values.refresh };
}

test("staff empty business lead list is successful only with authoritative view permission", async () => {
  const ui = loader({ ok: true, status: 200, json: async () => ({ ok: true, opportunities: [], permissions: { canViewLeads: true, canManageLeads: false } }) });
  await ui.run();
  assert.equal(ui.requests[0].url, "/api/trade-opportunities");
  assert.equal(ui.requests[0].options.headers.Authorization, "Bearer fixture-token");
  assert.equal(ui.requests[0].options.cache, "no-store");
  assert.equal(ui.mutations.find(([name]) => name === "setLoaded")[1], true);
  assert.equal(ui.mutations.find(([name]) => name === "setServerManage")[1], false);
  assert.equal(ui.context.requests.current.size, 0);
  assert.equal(ui.context.listRequest.current, null);
});

test("permission denial clears loaded private lead state and displays the server reason", async () => {
  const ui = loader({ ok: false, status: 403, json: async () => ({ ok: false, error: "Lead access was removed." }) });
  await ui.run();
  assert.equal(ui.mutations.find(([name]) => name === "setLeads")[1].length, 0);
  assert.equal(ui.mutations.find(([name]) => name === "setServerManage")[1], false);
  assert.equal(ui.mutations.findLast(([name]) => name === "setError")[1], "Lead access was removed.");
  const denied = loader(null, { permissions: { canViewLeads: false } }); await denied.run(); assert.equal(denied.requests.length, 0);
});

test("a lead response arriving after leaving the selected workspace cannot populate private state", async () => {
  const mounted = { current: true };
  const ui = loader({ ok: true, status: 200, json: async () => { mounted.current = false; return { ok: true, opportunities: [fixture()], permissions: { canViewLeads: true, canManageLeads: true } }; } }, { mounted });
  await ui.run();
  assert.equal(ui.mutations.some(([name]) => name === "setLeads" || name === "setServerManage" || name === "setLoaded"), false);
  assert.equal(ui.context.requests.current.size, 0);
});
