import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";
import * as priceBook from "../src/lib/trade-price-book.ts";
import * as quote from "../src/lib/trade-quote.ts";
import * as equipment from "../src/lib/trade-solar-equipment.ts";

const compile = name => ts.transpileModule(fs.readFileSync(new URL(`../src/components/${name}.tsx`, import.meta.url), "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const controls = compile("TradeProductTableControls"), products = compile("TradePriceBookWorkspace");
const text = node => node == null || typeof node === "boolean" ? "" : typeof node === "string" || typeof node === "number" ? String(node) : Array.isArray(node) ? node.map(text).join(" ") : text(node.props?.children);
const nodes = (node, predicate) => !node || typeof node !== "object" ? [] : Array.isArray(node) ? node.flatMap(child => nodes(child, predicate)) : [...(predicate(node) ? [node] : []), ...nodes(node.props?.children, predicate)];
const button = (tree, label) => nodes(tree, node => node.type === "button" && text(node) === label)[0];
const tick = () => new Promise(resolve => setImmediate(resolve));
const response = (body, status = 200) => Response.json(body, { status });
const stockItem = (patch = {}) => ({ itemId: "product-1", itemCode: "PB-1", name: "Solar panel", itemType: "material", unitLabel: "each", recordStatus: "active", tracked: false, onHandMilli: 0, reservedMilli: 0, availableMilli: 0, lowStockMilli: 0, revision: 0, locations: [{ locationId: "main", name: "Main storage", onHandMilli: 0 }], ...patch });
const product = (patch = {}) => ({ id: "product-1", itemCode: "PB-1", name: "Solar panel", description: "", itemType: "material", unitLabel: "each", supplierCostCentsExGst: 10000, sellPriceCentsExGst: 20000, taxCode: "gst", markupBasisPoints: 10000, marginBasisPoints: 5000, expectedDurationMinutes: 0, requiredSkill: "", supplierName: "Panel supplier", supplierSku: "P-440", supplierProductId: "", recordStatus: "active", priceRevision: 1, createdAt: "now", updatedAt: "now", ...patch });
const library = (items = [product()]) => ({ ok: true, items, counts: { total: items.length, active: items.length, archived: 0 }, capabilityOptions: [], catalogueOptions: [], access: { canManage: true } });

function harness(t, { component = "TradeProductStockSwitch", props: overrides, respond, attachRefs } = {}) {
  let cursor = 0;
  const state = [], effects = [], pending = [], requests = [], changes = [], observers = []; let refreshes = 0;
  const hooks = {
    useState(initial) { const i = cursor++; if (!(i in state)) state[i] = typeof initial === "function" ? initial() : initial; return [state[i], value => state[i] = typeof value === "function" ? value(state[i]) : value]; },
    useRef(initial) { const i = cursor++; return state[i] ||= { current: initial }; },
    useMemo(factory, deps) { const i = cursor++; if (!state[i] || deps.some((value, j) => value !== state[i].deps[j])) state[i] = { deps, value: factory() }; return state[i].value; },
    useCallback(callback, deps) { return hooks.useMemo(() => callback, deps); },
    useEffect(callback, deps) { const i = cursor++, old = effects[i]; if (!old || deps.some((value, j) => value !== old.deps[j])) { old?.cleanup?.(); effects[i] = { deps }; pending.push(() => { effects[i].cleanup = callback(); }); } },
  };
  const StockWorkspace = () => null, StockSettings = () => null, StockSwitch = () => null, CategoryField = () => null;
  const dependencies = { react: hooks, "react/jsx-runtime": jsx, "@/lib/trade-price-book": priceBook, "@/lib/trade-quote": quote, "@/lib/trade-solar-equipment": equipment,
    "./TradeStockWorkspace": { TradeStockProductSettings: StockSettings, TradeStockWorkspace: StockWorkspace }, "./TradeProductTableControls": { TradeProductStockSwitch: StockSwitch, TradeProductTableScroll: () => null },
    "./TradeProductDocuments": { TradeProductDocuments: () => null }, "./TradeJobPacketWorkspace": { TradeJobPacketWorkspace: () => null }, "./TradePriceBookImport": { TradePriceBookImport: () => null }, "./TradePriceBookCategoryField": { TradePriceBookCategoryField: CategoryField } };
  const exports = {}; const styles = new Proxy({}, { get: (_object, key) => key });
  const fetch = async (url, init = {}) => { requests.push({ url, init }); return respond ? respond(url, init) : response({ ok: true, item: stockItem({ tracked: true, revision: 1 }), history: [], canManage: true }); };
  const window = { setTimeout: callback => setImmediate(callback), clearTimeout: value => clearImmediate(value), confirm: () => true };
  class ResizeObserver { constructor(callback) { this.callback = callback; this.observed = []; observers.push(this); } observe(value) { this.observed.push(value); } disconnect() { this.disconnected = true; } }
  Function("require", "exports", "fetch", "window", "ResizeObserver", "HTMLButtonElement", component === "TradePriceBookWorkspace" ? products : controls)(id => dependencies[id] || { default: styles }, exports, fetch, window, ResizeObserver, class HTMLButtonElement {});
  const props = { user: { uid: "owner", getIdToken: async () => "token" }, itemId: "product-1", name: "Solar panel", stock: stockItem(), loading: false, failed: false, canManage: true, onChanged: value => changes.push(value), onRefresh: () => refreshes++, ...overrides };
  const render = () => { cursor = 0; const tree = exports[component](props); attachRefs?.(tree); for (const effect of pending.splice(0)) effect(); return tree; };
  const cleanup = () => { for (const effect of effects) effect?.cleanup?.(); }; t.after(cleanup);
  return { props, requests, changes, observers, render, cleanup, StockWorkspace, StockSettings, StockSwitch, CategoryField, get refreshes() { return refreshes; }, async settle() { let tree; for (let i = 0; i < 5; i++) { tree = render(); await tick(); } return tree; } };
}

test("inline tracking switch enables with one exact-revision mutation and no optimistic state", async t => {
  let release;
  const h = harness(t, { respond: () => new Promise(resolve => { release = () => resolve(response({ ok: true, item: stockItem({ tracked: true, revision: 1 }), history: [], canManage: true })); }) });
  let tree = h.render(); const control = nodes(tree, node => node.props?.role === "switch")[0]; assert.equal(control.props["aria-checked"], false); assert.equal(control.props["aria-label"], "Track stock for Solar panel");
  control.props.onClick(); control.props.onClick(); await tick(); assert.equal(h.requests.length, 1); tree = h.render(); assert.equal(nodes(tree, node => node.props?.role === "switch")[0].props["aria-checked"], false);
  const payload = JSON.parse(h.requests[0].init.body); assert.equal(payload.action, "enable"); assert.equal(payload.quantityMilli, 0); assert.equal(payload.expectedRevision, 0); assert.equal(h.requests[0].init.headers.Authorization, "Bearer token");
  release(); await h.settle(); h.props.stock = h.changes[0]; tree = h.render(); assert.equal(nodes(tree, node => node.props?.role === "switch")[0].props["aria-checked"], true);
});

test("reenabling a paused product preserves its existing balance and warning", async t => {
  const h = harness(t, { props: { stock: stockItem({ onHandMilli: 7500, availableMilli: 7500, revision: 5, lowStockMilli: 2000 }) } });
  let tree = h.render(); assert.match(text(tree), /Counts paused/); nodes(tree, node => node.props?.role === "switch")[0].props.onClick(); await h.settle();
  const payload = JSON.parse(h.requests[0].init.body); assert.equal(payload.quantityMilli, 7500); assert.equal(payload.lowStockMilli, 2000); assert.equal(payload.expectedRevision, 5);
});

test("unknown outcome locks the switch and retries the identical operation", async t => {
  let calls = 0;
  const h = harness(t, { respond: () => { if (!calls++) throw new Error("Connection lost"); return response({ ok: true, item: stockItem({ tracked: true, revision: 1 }), history: [], canManage: true }); } });
  let tree = h.render(); nodes(tree, node => node.props?.role === "switch")[0].props.onClick(); tree = await h.settle();
  assert.equal(nodes(tree, node => node.props?.role === "switch")[0].props.disabled, true); assert.ok(button(tree, "Retry update")); button(tree, "Retry update").props.onClick(); await h.settle();
  assert.equal(h.requests[0].init.body, h.requests[1].init.body); assert.equal(h.changes.length, 1);
});

test("committed-stock rejection leaves tracking on and shows the server reason", async t => {
  const h = harness(t, { props: { stock: stockItem({ tracked: true, reservedMilli: 12000 }) }, respond: () => response({ ok: false, error: "Finish or release the job commitments before pausing tracking." }, 409) });
  let tree = h.render(); nodes(tree, node => node.props?.role === "switch")[0].props.onClick(); tree = await h.settle();
  assert.equal(nodes(tree, node => node.props?.role === "switch")[0].props["aria-checked"], true); assert.match(text(tree), /release the job commitments/); assert.equal(h.changes.length, 0); assert.equal(h.refreshes, 1);
});

test("unknown stock, loading and read-only access cannot toggle", async t => {
  for (const props of [{ stock: null, failed: true }, { loading: true }, { canManage: false }]) {
    const h = harness(t, { props }); const tree = h.render(), control = nodes(tree, node => node.props?.role === "switch")[0];
    if (control) { assert.equal(control.props.disabled, true); control.props.onClick(); }
    else assert.equal(props.canManage, false);
    await tick(); assert.equal(h.requests.length, 0);
  }
});

test("the product table exposes consistent financial, stock and location columns", async t => {
  const inventory = stockItem({ tracked: true, onHandMilli: 12000, reservedMilli: 20000, availableMilli: -8000, locations: [{ locationId: "main", name: "Main storage", onHandMilli: 9000, responsibleName: "" }, { locationId: "john", name: "John", onHandMilli: 3000, responsibleName: "John" }] });
  const h = harness(t, { component: "TradePriceBookWorkspace", respond: url => response(url.startsWith("/api/trade-stock") ? { ok: true, items: [inventory], canManage: true } : library()) });
  let tree = await h.settle(); const table = nodes(tree, node => node.type === "table")[0];
  assert.deepEqual(nodes(table, node => node.type === "th" && node.props.scope === "col").map(text), ["Product", "Type", "Category", "Code / SKU", "Track stock", "Cost ex GST", "Margin", "Sale price ex GST", "On hand", "Committed", "Available", "Stock alert", "Locations", "Unit", "Supplier", "Panel size / power"]);
  const cells = nodes(table, node => node.type === "td"); assert.equal(text(cells[0]), "Material"); assert.match(text(cells[2]), /P-440.*TLink:.*PB-1/); assert.equal(text(cells[4]), "$100.00"); assert.equal(text(cells[5]), "50.0%"); assert.equal(text(cells[6]), "$200.00"); assert.equal(text(cells[7]), "12"); assert.equal(text(cells[8]), "20"); assert.equal(text(cells[9]), "-8"); assert.match(cells[9].props.className, /negativeValue/); assert.equal(text(cells[10]), "Order 8"); assert.match(text(cells[11]), /Main storage/); assert.equal(text(cells[11]).match(/John/g)?.length, 1);
  nodes(tree, node => node.props?.["aria-label"] === "Manage stock and locations for Solar panel")[0].props.onClick(); tree = h.render(); assert.equal(nodes(tree, node => node.type === h.StockWorkspace)[0].props.initialItemId, "product-1");
});

test("nonphysical rows have no stock switch and a failed lookup never invents zero stock", async t => {
  const h = harness(t, { component: "TradePriceBookWorkspace", respond: url => url.startsWith("/api/trade-stock") ? response({ ok: false }, 503) : response(library([product(), product({ id: "labour", name: "Labour", itemType: "labour" })])) });
  const tree = await h.settle(), table = nodes(tree, node => node.type === "table")[0], rows = nodes(table, node => node.type === "tr").slice(1);
  const productCells = nodes(rows[0], node => node.type === "td"); for (const index of [7, 8, 9, 10]) assert.equal(text(productCells[index]), "Unavailable");
  assert.equal(nodes(rows[1], node => node.type === h.StockSwitch).length, 0); assert.match(text(rows[1]), /Not applicable/);
});

test("paused saved stock stays visible and prevents relabelling its unit", async t => {
  const paused = stockItem({ tracked: false, onHandMilli: 4000, availableMilli: 4000 });
  const h = harness(t, { component: "TradePriceBookWorkspace", respond: url => response(url.startsWith("/api/trade-stock") ? { ok: true, items: [paused], canManage: true } : library()) });
  let tree = await h.settle(); const cells = nodes(tree, node => node.type === "td"); assert.equal(text(cells[7]), "4"); assert.match(cells[7].props.className, /stockPaused/);
  button(tree, "Solar panel").props.onClick(); tree = await h.settle();
  nodes(tree, node => node.type === h.StockSettings)[0].props.onLoaded(paused); tree = h.render(); assert.match(text(tree), /Clear saved stock counts before changing/);
  const label = nodes(tree, node => node.type === "label" && text(node).startsWith("Charge by"))[0]; assert.equal(nodes(label, node => node.type === "select")[0].props.disabled, true);
});

test("top and bottom scrollbars stay synchronized as the table width changes", t => {
  const surface = () => ({ scrollLeft: 0, events: new Map(), addEventListener(name, callback) { this.events.set(name, callback); }, removeEventListener(name) { this.events.delete(name); } });
  const upper = surface(), lower = { ...surface(), scrollWidth: 1800, clientWidth: 800, firstElementChild: {} }, spacer = { style: {} };
  const h = harness(t, { component: "TradeProductTableScroll", props: { children: jsx.jsx("table", {}) }, attachRefs: tree => {
    const refs = nodes(tree, node => node.props?.ref); refs[0].props.ref.current = upper; refs[1].props.ref.current = spacer; refs[2].props.ref.current = lower;
  } });
  h.render(); assert.equal(spacer.style.width, "1800px"); assert.equal(upper.hidden, false);
  upper.scrollLeft = 430; upper.events.get("scroll")(); assert.equal(lower.scrollLeft, 430); lower.scrollLeft = 850; lower.events.get("scroll")(); assert.equal(upper.scrollLeft, 850);
  lower.clientWidth = 1900; h.observers[0].callback(); assert.equal(upper.hidden, true); h.cleanup(); assert.equal(h.observers[0].disconnected, true); assert.equal(upper.events.size, 0); assert.equal(lower.events.size, 0);
});

test("newly saved products refresh stock snapshots so their inline switch is immediately usable", async t => {
  let created = false;
  const saved = product({ id: "new-product", name: "New heat pump" });
  const h = harness(t, { component: "TradePriceBookWorkspace", respond: (url, init) => {
    if (url.startsWith("/api/trade-stock")) return response({ ok: true, items: created ? [stockItem(), stockItem({ itemId: "new-product", name: saved.name })] : [stockItem()], canManage: true });
    if (init.method) { created = true; return response({ ok: true, item: saved }); }
    return response(library(created ? [product(), saved] : [product()]));
  } });
  let tree = await h.settle(); button(tree, "New item").props.onClick(); tree = h.render(); await nodes(tree, node => node.type === "form")[0].props.onSubmit({ preventDefault() {}, nativeEvent: { submitter: null } }); tree = await h.settle();
  const control = nodes(tree, node => node.type === h.StockSwitch && node.props.itemId === "new-product")[0]; assert.equal(control.props.stock.itemId, "new-product"); assert.equal(control.props.loading, false); assert.equal(control.props.failed, false);
  assert.equal(h.requests.filter(row => row.url === "/api/trade-stock").length, 2);
});

test("type and custom category filters reach the server and clear together", async t => {
  const h = harness(t, { component: "TradePriceBookWorkspace", respond: url => response(url.startsWith("/api/trade-stock") ? { ok: true, items: [], canManage: true } : { ...library(), categoryOptions: ["Insulation", "Solar panels"] }) });
  let tree = await h.settle();
  nodes(tree, node => node.props?.["aria-label"] === "Filter by type")[0].props.onChange({ target: { value: "material" } });
  tree = await h.settle();
  nodes(tree, node => node.props?.["aria-label"] === "Filter by category")[0].props.onChange({ target: { value: "Solar panels" } });
  tree = await h.settle();
  const filtered = new URL(h.requests.filter(row => row.url.startsWith("/api/trade-price-book?")).at(-1).url, "https://example.test");
  assert.equal(filtered.searchParams.get("itemType"), "material"); assert.equal(filtered.searchParams.get("category"), "Solar panels");
  button(tree, "Clear filters").props.onClick(); tree = await h.settle();
  assert.equal(nodes(tree, node => node.props?.["aria-label"] === "Filter by type")[0].props.value, "");
  assert.equal(nodes(tree, node => node.props?.["aria-label"] === "Filter by category")[0].props.value, "");
});

test("tracked each items can gain editable roof dimensions without changing stock units", async t => {
  const tracked = stockItem({ tracked: true, onHandMilli: 6000 });
  const h = harness(t, { component: "TradePriceBookWorkspace", respond: (url, init) => response(url.startsWith("/api/trade-stock") ? { ok: true, items: [tracked], canManage: true } : init.method ? { ok: true, item: product({ category: "Roof panels" }) } : library()) });
  let tree = await h.settle(); button(tree, "Solar panel").props.onClick(); tree = await h.settle();
  nodes(tree, node => node.type === h.StockSettings)[0].props.onLoaded(tracked); tree = h.render();
  const field = label => nodes(nodes(tree, node => node.type === "label" && nodes(node, child => child.type === "span" && text(child) === label).length)[0], node => node.type === "input")[0];
  nodes(tree, node => node.type === h.CategoryField)[0].props.onChange("Roof panels"); tree = h.render();
  const toggle = nodes(tree, node => node.type === "input" && node.props.type === "checkbox")[0]; assert.equal(toggle.props.disabled, false);
  toggle.props.onChange({ target: { checked: true } }); tree = h.render(); button(tree, "Use default size").props.onClick(); tree = h.render();
  assert.equal(field("Length (mm)").props.value, "1762"); assert.equal(field("Width (mm)").props.value, "1134"); assert.equal(field("Power (W)").props.value, "440");
  field("Length (mm)").props.onChange({ target: { value: "1800" } }); tree = h.render();
  await nodes(tree, node => node.type === "form")[0].props.onSubmit({ preventDefault() {}, nativeEvent: { submitter: null } });
  const body = JSON.parse(h.requests.find(row => row.init.method === "PATCH").init.body);
  assert.equal(body.category, "Roof panels"); assert.equal(body.itemType, "material"); assert.equal(body.unitLabel, "each");
  assert.deepEqual(body.solarPanel, { watts: 440, widthM: 1.134, lengthM: 1.8 });
});

test("category, exact panel size and low-stock signals are visible in their own cells", async t => {
  const item = product({ category: "Solar panels", solarPanel: { watts: 450, widthM: 1.134, lengthM: 1.8 } });
  const inventory = stockItem({ tracked: true, onHandMilli: 4000, reservedMilli: 3000, availableMilli: 1000, lowStockMilli: 2000 });
  const h = harness(t, { component: "TradePriceBookWorkspace", respond: url => response(url.startsWith("/api/trade-stock") ? { ok: true, items: [inventory], canManage: true } : library([item])) });
  const tree = await h.settle(), cells = nodes(tree, node => node.type === "td");
  assert.equal(text(cells[1]), "Solar panels"); assert.equal(text(cells[10]), "Low stock");
  assert.match(text(cells[14]), /1800.*1134.*mm.*450.*W/);
  nodes(tree, node => node.props?.["aria-label"] === "Edit panel dimensions for Solar panel")[0].props.onClick();
  assert.match(text(h.render()), /Panel size for the roof designer/);
});
