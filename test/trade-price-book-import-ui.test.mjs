import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";
import * as spreadsheet from "../src/lib/trade-price-book-spreadsheet.ts";
import * as priceBook from "../src/lib/trade-price-book.ts";

const source = fs.readFileSync(new URL("../src/components/TradePriceBookImport.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText.replaceAll('require("./TradeBusinessProvider")', '({ useTradeBusinessFetch: () => fetch, useTradeBusiness: () => null })');
const sheet = { name: "Catalogue", data: [["Item name", "Sell price ex GST", "Cost ex GST"], ["Call-out", 220, 0]] };
const preview = () => ({ token: "a".repeat(64), counts: { added: 0, updated: 1, unchanged: 0, superseded: 0 }, canImport: true, issues: [],
  items: [{ rowNumber: 2, status: "updated", name: "Call-out", itemCode: "PB-callout", itemType: "call_out", category: "Service fees", supplierSku: "CALL-01", unitLabel: "visit", solarPanel: null, before: { sellPriceCentsExGst: 20000, supplierCostCentsExGst: 0 }, after: { sellPriceCentsExGst: 22000, supplierCostCentsExGst: 0 } }] });
const text = (node) => node == null || typeof node === "boolean" ? "" : typeof node === "string" || typeof node === "number" ? String(node) : Array.isArray(node) ? node.map(text).join(" ") : text(node.props?.children);
function nodes(node, predicate) {
  if (!node || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap(child => nodes(child, predicate));
  return [...(predicate(node) ? [node] : []), ...nodes(node.props?.children, predicate)];
}
const button = (tree, name) => nodes(tree, node => node.type === "button" && text(node) === name)[0];
const flush = async () => { await new Promise(resolve => setImmediate(resolve)); };

function harness(responder, options = {}) {
  const state = []; let cursor = 0; const requests = []; const refreshed = [];
  const hooks = {
    useState(initial) { const index = cursor++; if (!(index in state)) state[index] = typeof initial === "function" ? initial() : initial; return [state[index], value => { state[index] = typeof value === "function" ? value(state[index]) : value; }]; },
    useRef(initial) { const index = cursor++; if (!(index in state)) state[index] = { current: initial }; return state[index]; },
    useEffect() {},
  };
  const exports = {};
  const require = id => id === "react" ? hooks : id === "react/jsx-runtime" ? jsx : id === "@/lib/trade-price-book-spreadsheet"
    ? { ...spreadsheet, readPriceBookSpreadsheet: async () => options.sheets || [sheet] }
    : id === "@/lib/trade-price-book" ? priceBook
    : id.endsWith(".module.css") ? { default: new Proxy({}, { get: (_, key) => String(key) }) } : (() => { throw new Error(`Unexpected import ${id}`); })();
  const fetch = async (url, init) => { const body = JSON.parse(init.body); requests.push({ url, init, body }); const result = await responder(body); return { ok: result.ok !== false, json: async () => result }; };
  Function("require", "exports", "fetch", "window", compiled)(require, exports, fetch, options.window || { setTimeout, clearTimeout });
  const render = () => { cursor = 0; return exports.TradePriceBookImport({ user: { getIdToken: options.getIdToken || (async () => "test-token") }, onClose() {}, onImported: async result => { refreshed.push(result); await options.onImported?.(result); } }); };
  return { requests, refreshed, render, async upload() { nodes(render(), node => node.type === "input" && node.props.type === "file")[0].props.onChange({ target: { files: [{ name: "catalogue.xlsx" }] } }); await flush(); return render(); } };
}

test("upload auto-maps and previews the price replacement without saving until Import is clicked", async () => {
  const h = harness(async body => ({ ok: true, preview: preview(), ...(body.action === "import" ? { imported: true } : {}) }));
  let tree = await h.upload();
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].body.action, "preview");
  assert.deepEqual(h.requests[0].body.rows, [{ rowNumber: 2, values: { name: "Call-out", sellPrice: "220", supplierCost: "0" } }]);
  assert.match(text(tree), /\$200\.00/); assert.match(text(tree), /\$220\.00/);
  assert.equal(h.refreshed.length, 0);
  button(tree, "Import 1 item").props.onClick(); await flush(); tree = h.render();
  assert.equal(h.requests[1].body.action, "import");
  assert.equal(h.requests[1].body.previewToken, preview().token);
  assert.equal(h.requests[1].init.headers.Authorization, "Bearer test-token");
  assert.equal(h.refreshed.length, 1);
  assert.match(text(tree), /Import complete/);
  assert.equal(button(tree, "Import 1 item"), undefined);
});

test("solar upload previews its exact type, category, identifiers, watts and millimetres before import", async () => {
  const result = preview();
  Object.assign(result.items[0], { name: "Example panel", itemType: "equipment", category: "Roof products", supplierSku: "SOL-440",
    unitLabel: "each", solarPanel: { watts: 440, lengthM: 1.762, widthM: 1.134 } });
  const h = harness(async () => ({ ok: true, preview: result }), { sheets: [{ name: "Panels", data: [
    ["Item name", "Price ex GST", "Type", "Category", "SKU", "Product kind", "Panel watts", "Panel length (mm)", "Panel width (mm)"],
    ["Example panel", "180", "Equipment", "Roof products", "SOL-440", "Solar panel", "440", "1762", "1134"],
  ] }] });
  const tree = await h.upload(); const content = text(tree);
  const values = h.requests[0].body.rows[0].values;
  assert.equal(values.productKind, "solar_panel"); assert.equal(values.category, "Roof products");
  assert.equal(values.panelLengthMm, "1762"); assert.equal(values.panelWidthMm, "1134");
  assert.match(content, /Type \/ Category/); assert.match(content, /Code \/ SKU/);
  assert.match(content, /Equipment/); assert.match(content, /Roof products/); assert.match(content, /SOL-440/);
  assert.match(content, /440\s+W/); assert.match(content, /1762\s+×\s+1134\s+mm/);
  assert.match(content, /opening counts and team assignments/);
  assert.equal(h.requests.filter((request) => request.body.action === "import").length, 0);
  const selects = nodes(tree, (node) => node.type === "label").map(text);
  assert.ok(selects.some((label) => /^Type\s/.test(label)), "Type remains mappable even when a source header is unrecognised");
  assert.ok(selects.some((label) => /^Charge by\s/.test(label)));
});

test("invalid rows cannot be imported and explain the affected row", async () => {
  const result = { ...preview(), canImport: false, issues: [{ rowNumber: 2, message: "More than one item matches. Add the TLink item code." }] };
  const h = harness(async () => ({ ok: true, preview: result }));
  const tree = await h.upload();
  assert.equal(button(tree, "Import 1 item"), undefined);
  assert.match(text(tree), /Row\s+2.*More than one item matches/);
  assert.equal(h.requests.length, 1);
});

test("a rapid double click submits the confirmed import only once", async () => {
  let finish;
  const h = harness(async body => body.action === "preview" ? { ok: true, preview: preview() }
    : new Promise(resolve => { finish = () => resolve({ ok: true, preview: preview(), imported: true }); }));
  const tree = await h.upload(); const importButton = button(tree, "Import 1 item");
  importButton.props.onClick(); importButton.props.onClick(); await flush();
  assert.equal(h.requests.filter(item => item.body.action === "import").length, 1);
  finish(); await flush();
  assert.match(text(h.render()), /Import complete/);
});

test("a stale preview shows the conflict and never silently retries the save", async () => {
  const fresh = preview(); fresh.token = "b".repeat(64); fresh.items[0].before.sellPriceCentsExGst = 21000;
  const h = harness(async body => body.action === "import" ? { ok: false, error: "The price book changed after your preview. Check the new prices.", preview: fresh } : { ok: true, preview: preview() });
  let tree = await h.upload(); button(tree, "Import 1 item").props.onClick(); await flush(); tree = h.render();
  assert.equal(h.requests.filter(item => item.body.action === "import").length, 1);
  assert.equal(h.refreshed.length, 0);
  assert.match(text(tree), /changed after your preview/);
  assert.match(text(tree), /\$210\.00/);
  assert.ok(button(tree, "Check preview"));
  assert.ok(button(tree, "Import 1 item"));
});

test("GST interpretation changes invalidate the old preview before saving", async () => {
  const h = harness(async () => ({ ok: true, preview: preview() }), { sheets: [{ name: "Rates", data: [["Name", "Price"], ["Call-out", 220]] }] });
  let tree = await h.upload();
  const select = nodes(tree, node => node.type === "select" && node.props.value === "exclusive")[0];
  select.props.onChange({ target: { value: "inclusive" } }); tree = h.render();
  assert.equal(button(tree, "Import 1 item"), undefined);
  button(tree, "Check preview").props.onClick(); await flush();
  assert.equal(h.requests.at(-1).body.action, "preview");
  assert.equal(h.requests.at(-1).body.pricesIncludeGst, true);
});

test("re-uploading identical prices clearly reports no changes", async () => {
  const unchanged = preview(); unchanged.counts = { added: 0, updated: 0, unchanged: 1, superseded: 0 };
  unchanged.items[0].status = "unchanged"; unchanged.items[0].before.sellPriceCentsExGst = 22000;
  const h = harness(async body => ({ ok: true, preview: unchanged, ...(body.action === "import" ? { imported: true } : {}) }));
  let tree = await h.upload();
  assert.ok(button(tree, "Confirm unchanged prices"));
  assert.equal(button(tree, "Import 0 items"), undefined);
  button(tree, "Confirm unchanged prices").props.onClick(); await flush(); tree = h.render();
  assert.match(text(tree), /Import complete\.\s+0\s+added,\s+0\s+updated and\s+1\s+unchanged/);
});

test("failed list refresh does not misreport a successful import as lost", async () => {
  const h = harness(async body => ({ ok: true, preview: preview(), ...(body.action === "import" ? { imported: true } : {}) }), { onImported: async () => { throw new Error("offline"); } });
  let tree = await h.upload(); button(tree, "Import 1 item").props.onClick(); await flush(); tree = h.render();
  assert.match(text(tree), /Import complete/);
  assert.match(text(tree), /prices were imported, but the list could not refresh/);
  assert.equal(button(tree, "Done").props.disabled, false);
  assert.equal(button(tree, "Import 1 item"), undefined);
});

test("authentication timeouts keep the spreadsheet available and release the controls", async () => {
  let expire;
  const h = harness(async () => { throw new Error("Must not fetch without authentication"); }, {
    getIdToken: () => new Promise(() => {}), window: { setTimeout(callback) { expire = callback; return 1; }, clearTimeout() {} },
  });
  let tree = await h.upload(); assert.match(text(tree), /Checking items/);
  expire(); await flush(); tree = h.render();
  assert.match(text(tree), /connection took too long/);
  assert.match(text(tree), /catalogue.xlsx/);
  assert.equal(button(tree, "Check preview").props.disabled, false);
  assert.equal(button(tree, "Close").props.disabled, false);
  assert.equal(h.requests.length, 0);
});
