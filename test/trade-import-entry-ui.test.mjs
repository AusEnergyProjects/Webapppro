import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";
import * as imports from "../src/lib/trade-data-imports.mjs";
import * as metadata from "../src/lib/trade-dataforce-import-metadata.ts";

const source = fs.readFileSync(new URL("../src/components/TradeDataImportWorkspace.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const nodes = (node, predicate) => !node || typeof node !== "object" ? [] : Array.isArray(node) ? node.flatMap(item => nodes(item, predicate)) : [...(predicate(node) ? [node] : []), ...nodes(node.props?.children, predicate)];
const text = node => node == null || typeof node === "boolean" ? "" : typeof node === "string" || typeof node === "number" ? String(node) : Array.isArray(node) ? node.map(text).join(" ") : text(node.props?.children);
const visibleText = node => node == null || typeof node !== "object" ? text(node) : Array.isArray(node) ? node.map(visibleText).join(" ") : node.type === "details" && !node.props.open ? nodes(node, item => item.type === "summary").map(text).join(" ") : visibleText(node.props?.children);
function harness(partnerType = "installer") {
  let cursor = 0;
  const state = [], requests = [];
  const hooks = {
    useState(initial) { const i = cursor++; if (!(i in state)) state[i] = typeof initial === "function" ? initial() : initial; return [state[i], value => state[i] = typeof value === "function" ? value(state[i]) : value]; },
    useMemo(fn) { return fn(); }, useCallback(fn) { return fn; }, useEffect() {},
  };
  function ImportWorkspace() {}
  const require = id => id === "react" ? hooks : id === "react/jsx-runtime" ? jsx
    : id === "./TradeBusinessProvider" ? { useTradeBusinessFetch: () => async (url, init) => { requests.push({ url, init }); return Response.json({ ok: true, batches: [] }); } }
    : id === "@/lib/trade-data-imports.mjs" ? imports
    : id === "@/lib/trade-dataforce-import-metadata" ? metadata
    : id === "./TradeDataforceImportWorkspace" ? { TradeDataforceImportWorkspace: ImportWorkspace }
    : id === "@/lib/xlsx-import" ? { workbookToCsv() { throw new Error("Workbook should not be parsed while choosing an import path"); } }
    : (() => { throw new Error(`Unexpected import ${id}`); })();
  const exports = {};
  Function("require", "exports", compiled)(require, exports);
  const user = { getIdToken: async () => "test-token" };
  const onImported = () => {};
  const render = () => { cursor = 0; return exports.TradeDataImportWorkspace({ user, partnerType, onImported }); };
  function click(label) { const target = nodes(render(), n => n.type === "button" && text(n).includes(label))[0]; assert.ok(target, label); target.props.onClick(); return render(); }
  return { render, click, requests, user, onImported, ImportWorkspace };
}

test("installer has one visible customer-and-job import path while older formats stay collapsed", () => {
  const h = harness(), tree = h.render();
  assert.match(visibleText(tree), /Import customers and jobs/);
  assert.match(visibleText(tree), /Other formats and earlier job imports/);
  assert.doesNotMatch(visibleText(tree), /23-column job import|Download CSV template|Private installer contacts/);
  const options = nodes(tree, n => n.type === "details");
  assert.equal(options.length, 1); assert.ok(!options[0].props.open);
  assert.match(text(options[0]), /23-column job import/);
  assert.match(text(options[0]), /Customers/); assert.match(text(options[0]), /Jobs/);
  const workspace = h.click("Import customers and jobs");
  assert.equal(workspace.type, h.ImportWorkspace); assert.equal(workspace.props.importFormat, "csv");
  assert.equal(workspace.props.user, h.user); assert.equal(workspace.props.onImported, h.onImported);
  assert.equal(workspace.props.initialSource, null); assert.equal(h.requests.length, 0, "Choosing a path never imports records");
  workspace.props.onBack(); assert.match(visibleText(h.render()), /Import customers and jobs/);
});

test("older job batches retain a distinct entry into the existing original-format importer", () => {
  const h = harness();
  const workspace = h.click("23-column job import");
  assert.equal(workspace.type, h.ImportWorkspace); assert.equal(workspace.props.importFormat, "legacy");
  assert.equal(workspace.props.initialSource, null); assert.equal(h.requests.length, 0);
});

test("suppliers keep the product template path without installer customer and job choices", () => {
  const h = harness("supplier"), tree = h.render();
  assert.equal(nodes(tree, n => n.type === "details").length, 0);
  assert.match(visibleText(tree), /Products|Download CSV template|Maximum 500 rows/);
  assert.doesNotMatch(text(tree), /Import customers and jobs|23-column job import|Other formats/);
  h.click("Products");
  assert.equal(nodes(h.render(), n => n.type === "input" && n.props.type === "file").length, 1);
  assert.equal(h.requests.length, 0);
});
