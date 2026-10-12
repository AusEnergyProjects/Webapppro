import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";
import { summariseProductEnquiries } from "../src/components/admin-product-enquiry-summary.ts";
import * as branding from "../src/lib/trade-business-branding.ts";

const read = name => fs.readFileSync(new URL(`../src/components/${name}`, import.meta.url), "utf8");
const source = name => ts.createSourceFile(name, read(name), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const compile = value => ts.transpileModule(value, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;

const deferred = {
  "DirectTradeDashboard.tsx": ["WattzunToolsWorkspace", "TradeCustomerEmailComposer", "CustomerPlanReportPreviewDialog", "TradeBusinessSettingsWorkspace"],
  "CreditexCompliancePortal.tsx": ["CreditexOfficialSourceWorkbench", "CreditexRegistryWorkspace", "CreditexPlannedIntakeQueue", "PortalConnectWorkspace", "PortalTeamWorkspace", "CreditexCustomerDirectory"],
  "AdminOperationsPortal.tsx": ["AdminAccountDirectory", "AdminJobDirectory", "AdminDatabaseWorkspace", "AdminCatalogueWorkspace", "AdminProductEnquiryWorkspace", "PortalConnectWorkspace", "PortalTeamWorkspace"],
  "CouncilPortal.tsx": ["CouncilMap", "CouncilRebateCalculator", "CouncilAdministration", "CouncilConnect", "CouncilTeam", "CouncilMonthlyReports"],
};

for (const [file, panels] of Object.entries(deferred)) {
  test(`${file} loads secondary workspaces on demand while keeping its access gate eager`, async () => {
    const ast = source(file);
    const registrations = ast.statements.filter(ts.isVariableStatement)
      .flatMap(statement => statement.declarationList.declarations)
      .filter(declaration => panels.includes(declaration.name.getText(ast)));
    assert.equal(registrations.length, panels.length);
    const calls = [];
    const dynamic = loader => ({ loader });
    const require = id => { if (id === "react/jsx-runtime") return { jsx: () => null }; calls.push(id); return new Proxy({}, { get: (_, name) => ({ module: id, export: name }) }); };
    for (const declaration of registrations) {
      assert.ok(ts.isCallExpression(declaration.initializer));
      assert.equal(declaration.initializer.expression.getText(ast), "dynamic");
      const panel = Function("dynamic", "require", "exports", compile(`const panel = ${declaration.initializer.getText(ast)};`) + "\nreturn panel;")(dynamic, require, {});
      assert.equal(calls.length, 0, "Registering an unopened panel must not import its code");
      const loaded = await panel.loader();
      assert.equal(calls.length, 1);
      assert.ok(fs.existsSync(new URL(`../src/components/${calls[0].slice(2)}.tsx`, import.meta.url)));
      assert.ok(loaded);
      calls.length = 0;
    }
    for (const statement of ast.statements.filter(ts.isImportDeclaration)) {
      const clause = statement.importClause;
      if (!clause || clause.isTypeOnly || !clause.namedBindings || !ts.isNamedImports(clause.namedBindings)) continue;
      const runtimeNames = clause.namedBindings.elements.filter(element => !element.isTypeOnly).map(element => element.name.text);
      assert.ok(!runtimeNames.some(name => panels.includes(name)), "A second eager import must not undo a deferred workspace");
    }
    assert.doesNotMatch(read(file), /const Firebase(?:AccountSecurity|MfaChallenge)\s*=\s*dynamic/);
  });
}

test("business theme lookup remains unchanged without importing the settings editor", () => {
  const exported = {};
  Function("require", "exports", compile(read("trade-business-theme.ts")))(id => {
    assert.equal(id, "@/lib/trade-business-branding");
    return branding;
  }, exported);
  for (const key of branding.TRADE_BRAND_THEME_KEYS) {
    assert.equal(exported.tradeBusinessThemeGradient(key), branding.TRADE_BRAND_THEME_OPTIONS[key].gradient);
  }
  assert.equal(exported.tradeBusinessThemeGradient(), branding.TRADE_BRAND_THEME_OPTIONS[branding.DEFAULT_TRADE_BRAND_THEME].gradient);
});

test("enquiry summaries keep statuses and currency totals without importing the enquiry workspace", () => {
  assert.deepEqual(summariseProductEnquiries([]), { total: 0, open: 0, responded: 0, valueCents: 0 });
  assert.deepEqual(summariseProductEnquiries([
    { status: "new", subtotalCentsExGst: 1100 },
    { status: "viewed", subtotalCentsExGst: 2900 },
    { status: "responded", subtotalCentsExGst: 500 },
    { status: "closed", subtotalCentsExGst: 600 },
  ]), { total: 4, open: 2, responded: 1, valueCents: 5100 });
});

function workspaceLoader(api) {
  const ast = source("AdminOperationsPortal.tsx");
  let declaration;
  const visit = node => { if (ts.isVariableDeclaration(node) && node.name.getText(ast) === "loadWorkspace") declaration = node; ts.forEachChild(node, visit); };
  visit(ast);
  assert.ok(declaration);
  const summaries = [], admins = [];
  const load = Function("useCallback", "api", "setProductEnquirySummary", "summariseProductEnquiries", "setAdmins", compile(`const load = ${declaration.initializer.getText(ast)};`) + "\nreturn load;")(
    callback => callback, api, summary => summaries.push(summary), summariseProductEnquiries, rows => admins.push(rows),
  );
  return { load, summaries, admins };
}

test("owner startup requests independent enquiry and user data concurrently", async () => {
  const pending = [];
  const h = workspaceLoader(path => new Promise(resolve => pending.push({ path, resolve })));
  const loading = h.load({ role: "owner" });
  assert.deepEqual(pending.map(request => request.path), ["/api/admin/product-enquiries", "/api/admin/admins"]);
  pending[1].resolve({ admins: [{ id: "owner-1" }] });
  pending[0].resolve({ enquiries: [{ status: "new", subtotalCentsExGst: 300 }] });
  await loading;
  assert.deepEqual(h.summaries, [{ total: 1, open: 1, responded: 0, valueCents: 300 }]);
  assert.deepEqual(h.admins, [[{ id: "owner-1" }]]);
});

test("non-owner startup does not request owner-only data, and partial failures remain visible", async () => {
  const requests = [];
  const h = workspaceLoader(async path => { requests.push(path); return { enquiries: [] }; });
  await h.load({ role: "reviewer" });
  assert.deepEqual(requests, ["/api/admin/product-enquiries"]);
  assert.deepEqual(h.admins, []);
  const failing = workspaceLoader(async path => {
    if (path === "/api/admin/admins") throw new Error("Unavailable");
    return { enquiries: [] };
  });
  await assert.rejects(failing.load({ role: "owner" }), /operations users could not be loaded/);
  assert.equal(failing.summaries.length, 1);
  assert.deepEqual(failing.admins, []);
});
