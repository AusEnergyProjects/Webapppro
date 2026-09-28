import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";
import * as stock from "../src/lib/trade-stock.ts";
import * as priceBook from "../src/lib/trade-price-book.ts";
import * as quote from "../src/lib/trade-quote.ts";
import * as equipment from "../src/lib/trade-solar-equipment.ts";

const source = fs.readFileSync(new URL("../src/components/TradeStockWorkspace.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source + "\nexports.TestLocationEditor = StockLocationEditor; exports.TestStockNumbers = StockNumbers;", { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const productSource = fs.readFileSync(new URL("../src/components/TradePriceBookWorkspace.tsx", import.meta.url), "utf8");
const productCompiled = ts.transpileModule(productSource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const text = node => node == null || typeof node === "boolean" ? "" : typeof node === "string" || typeof node === "number" ? String(node) : Array.isArray(node) ? node.map(text).join(" ") : text(node.props?.children);
const nodes = (node, predicate) => !node || typeof node !== "object" ? [] : Array.isArray(node) ? node.flatMap(child => nodes(child, predicate)) : [...(predicate(node) ? [node] : []), ...nodes(node.props?.children, predicate)];
const button = (tree, label) => nodes(tree, node => node.type === "button" && text(node) === label)[0];
const input = (tree, label) => nodes(tree, node => node.type === "label" && text(node).includes(label)).flatMap(node => nodes(node, child => child.type === "input"))[0];
const select = (tree, label) => nodes(tree, node => node.type === "label" && text(node).startsWith(label)).flatMap(node => nodes(node, child => child.type === "select"))[0];
const tick = () => new Promise(resolve => setImmediate(resolve));
const response = (body, status = 200) => Response.json(body, { status });
const main = { id: "main", name: "Main storage", isDefault: true, revision: 1, responsibleMemberId: "", responsibleName: "" };
const john = { id: "john-stock", name: "John", isDefault: false, revision: 1, responsibleMemberId: "john", responsibleName: "John" };
const members = [{ id: "john", name: "John" }];
const item = (patch = {}) => ({ locations: [{ locationId: "main", name: "Main storage", responsibleName: "", onHandMilli: patch.onHandMilli || 0 }], itemId: "product-1", itemCode: "PB-1", name: "Solar panel", itemType: "material", unitLabel: "each", recordStatus: "active", tracked: false, onHandMilli: 0, reservedMilli: 0, availableMilli: 0, lowStockMilli: 0, revision: 0, ...patch });
const detail = (patch = {}) => ({ ok: true, item: item(patch), history: [], canManage: true, locations: [main], members });
const submit = tree => nodes(tree, node => node.type === "form")[0].props.onSubmit({ preventDefault() {} });
class SubmitButton { constructor(value) { this.value = value; } }
const product = { id: "product-1", itemCode: "PB-1", name: "Solar panel", description: "", itemType: "material", unitLabel: "each", supplierCostCentsExGst: 1000, sellPriceCentsExGst: 2000, taxCode: "gst", markupBasisPoints: 10000, marginBasisPoints: 5000, expectedDurationMinutes: 0, requiredSkill: "", supplierName: "", supplierSku: "", supplierProductId: "", recordStatus: "active", priceRevision: 1, createdAt: "now", updatedAt: "now" };
const library = { ok: true, items: [product], counts: { total: 1, active: 1, archived: 0 }, capabilityOptions: [], catalogueOptions: [], access: { canManage: true } };

function harness(t, { component = "TradeStockProductSettings", props: overrides, respond } = {}) {
  let cursor = 0;
  const states = [], effects = [], pending = [], requests = [], changes = [];
  const hooks = {
    useState(initial) { const i = cursor++; if (!(i in states)) states[i] = typeof initial === "function" ? initial() : initial; return [states[i], value => { states[i] = typeof value === "function" ? value(states[i]) : value; }]; },
    useRef(initial) { const i = cursor++; return states[i] ||= { current: initial }; },
    useMemo(factory, deps) { const i = cursor++; if (!states[i] || deps.some((value, j) => value !== states[i].deps[j])) states[i] = { deps, value: factory() }; return states[i].value; },
    useCallback(callback, deps) { const i = cursor++; if (!states[i] || deps.some((value, j) => value !== states[i].deps[j])) states[i] = { deps, value: callback }; return states[i].value; },
    useEffect(callback, deps) { const i = cursor++, old = effects[i]; if (!old || deps.some((value, j) => value !== old.deps[j])) { old?.cleanup?.(); effects[i] = { deps }; pending.push(() => { effects[i].cleanup = callback(); }); } },
  };
  const ProductStock = () => null;
  const dependencies = { react: hooks, "react/jsx-runtime": jsx, "@/lib/trade-stock": stock, "@/lib/trade-price-book": priceBook, "@/lib/trade-quote": quote, "@/lib/trade-solar-equipment": equipment,
    "./TradeProductTableControls": { TradeProductTableScroll: () => null, TradeProductStockSwitch: () => null }, "./TradeStockWorkspace": { TradeStockProductSettings: ProductStock, TradeStockWorkspace: () => null }, "./TradeProductDocuments": { TradeProductDocuments: () => null }, "./TradeJobPacketWorkspace": { TradeJobPacketWorkspace: () => null }, "./TradePriceBookImport": { TradePriceBookImport: () => null } };
  const exports = {};
  const fetch = async (url, init = {}) => { requests.push({ url, init }); return respond ? respond(url, init) : response(detail()); };
  const window = { setTimeout: callback => setImmediate(callback), clearTimeout: value => clearImmediate(value), confirm: () => true };
  Function("require", "exports", "fetch", "window", "HTMLButtonElement", component === "TradePriceBookWorkspace" ? productCompiled : compiled)(id => dependencies[id] || { default: {} }, exports, fetch, window, SubmitButton);
  const props = { user: { uid: "owner", getIdToken: async () => "token" }, itemId: "product-1", canManage: true, onChanged: value => changes.push(value), onOpenItems() {}, ...overrides };
  const render = () => { cursor = 0; const tree = exports[component](props); for (const effect of pending.splice(0)) effect(); return tree; };
  const cleanup = () => { for (const effect of effects) effect?.cleanup?.(); };
  t.after(cleanup);
  return { props, requests, changes, render, ProductStock, cleanup, async settle() { let tree; for (let i = 0; i < 5; i++) { tree = render(); await tick(); } return tree; } };
}

test("stock remains opt-in and enabling saves the displayed unit quantities with revision protection", async t => {
  const h = harness(t, { respond: (_url, init) => response(init.method ? detail({ tracked: true, onHandMilli: 20500, availableMilli: 20500, lowStockMilli: 3000, revision: 1 }) : detail()) });
  let tree = await h.settle(); assert.ok(button(tree, "Track stock")); assert.equal(nodes(tree, node => node.type === "form").length, 0); assert.match(text(tree), /Buy when needed/);
  button(tree, "Track stock").props.onClick(); tree = h.render();
  input(tree, "Opening quantity").props.onChange({ target: { value: "20.5" } }); input(tree, "Warn when").props.onChange({ target: { value: "3" } });
  submit(h.render()); tree = await h.settle();
  const writes = h.requests.filter(row => row.init.method === "POST"); assert.equal(writes.length, 1);
  const body = JSON.parse(writes[0].init.body); assert.equal(body.action, "enable"); assert.equal(body.quantityMilli, 20500); assert.equal(body.lowStockMilli, 3000); assert.equal(body.expectedRevision, 0); assert.ok(body.operationId.length > 16);
  assert.equal(writes[0].init.headers.get("Authorization"), "Bearer token"); assert.match(text(tree), /Stock tracking is on/); assert.equal(h.changes[0].tracked, true);
});

test("a failed receive locks the input and retries the exact operation without double submission", async t => {
  let calls = 0, complete;
  const h = harness(t, { props: { initialAction: "receive" }, respond: (_url, init) => {
    if (!init.method) return response(detail({ tracked: true, onHandMilli: 10000, availableMilli: 10000, revision: 4 }));
    calls++; if (calls === 1) throw new Error("Connection lost");
    return new Promise(resolve => { complete = () => resolve(response(detail({ tracked: true, onHandMilli: 12500, availableMilli: 12500, revision: 5 }))); });
  } });
  let tree = await h.settle(); input(tree, "Quantity received").props.onChange({ target: { value: "2.5" } }); submit(h.render()); tree = await h.settle();
  assert.equal(input(tree, "Quantity received").props.value, "2.5"); assert.equal(nodes(tree, node => node.type === "fieldset")[0].props.disabled, true); assert.equal(button(tree, "Cancel").props.disabled, true); assert.ok(button(tree, "Retry this update"));
  submit(tree); submit(tree); await tick(); assert.equal(calls, 2); complete(); tree = await h.settle();
  const writes = h.requests.filter(row => row.init.method); assert.equal(writes[0].init.body, writes[1].init.body); assert.match(text(tree), /Delivery added to stock/);
});

test("conflicting stock count keeps the entered quantity and requires the refreshed revision", async t => {
  let revision = 1, calls = 0;
  const h = harness(t, { props: { initialAction: "count" }, respond: (_url, init) => {
    if (!init.method) return response(detail({ tracked: true, onHandMilli: 8000, availableMilli: 6000, reservedMilli: 2000, revision }));
    if (!calls++) { revision = 2; return response({ error: "Stock changed. Refresh it first." }, 409); }
    return response(detail({ tracked: true, onHandMilli: 7000, availableMilli: 5000, reservedMilli: 2000, revision: 3 }));
  } });
  let tree = await h.settle(); assert.equal(input(tree, "Actual quantity").props.value, "8"); input(tree, "Actual quantity").props.onChange({ target: { value: "7" } }); submit(h.render()); tree = await h.settle();
  assert.ok(button(tree, "Refresh stock")); assert.equal(button(tree, "Save stocktake").props.disabled, true);
  button(tree, "Refresh stock").props.onClick(); tree = await h.settle(); assert.equal(input(tree, "Actual quantity").props.value, "7"); submit(tree); await h.settle();
  const bodies = h.requests.filter(row => row.init.method).map(row => JSON.parse(row.init.body)); assert.equal(bodies[0].expectedRevision, 1); assert.equal(bodies[1].expectedRevision, 2); assert.notEqual(bodies[0].operationId, bodies[1].operationId); assert.equal(bodies[1].quantityMilli, 7000);
});

test("read-only and failed detail lookups never expose writable stock actions", async t => {
  const read = harness(t, { props: { canManage: false }, respond: () => response(detail({ tracked: true })) });
  let tree = await read.settle(); assert.equal(button(tree, "Receive stock"), undefined); assert.equal(button(tree, "Stocktake"), undefined); assert.equal(button(tree, "Stop tracking"), undefined);
  const failed = harness(t, { props: { initialAction: "enable" }, respond: () => response({ error: "No access" }, 403) }); tree = await failed.settle();
  assert.match(text(tree), /No access/); assert.equal(nodes(tree, node => node.type === "form").length, 0); assert.equal(failed.requests.filter(row => row.init.method).length, 0);
});

test("an uncertain retry followed by a definite conflict unlocks the preserved count after refresh", async t => {
  let calls = 0;
  const h = harness(t, { props: { initialAction: "count" }, respond: (_url, init) => {
    if (!init.method) return response(detail({ tracked: true, onHandMilli: 9000, availableMilli: 9000, revision: calls > 1 ? 2 : 1 }));
    if (!calls++) throw new Error("Connection lost");
    return response({ error: "Stock changed. Refresh first." }, 409);
  } });
  let tree = await h.settle(); input(tree, "Actual quantity").props.onChange({ target: { value: "6" } }); submit(h.render()); tree = await h.settle();
  assert.ok(button(tree, "Retry this update")); submit(tree); tree = await h.settle(); assert.ok(button(tree, "Refresh stock"));
  button(tree, "Refresh stock").props.onClick(); tree = await h.settle(); assert.equal(input(tree, "Actual quantity").props.value, "6"); assert.equal(nodes(tree, node => node.type === "fieldset")[0].props.disabled, false); assert.equal(button(tree, "Cancel").props.disabled, false);
});

test("active commitments prevent disabling, while archived tracked products retain stock controls", async t => {
  const h = harness(t, { respond: () => response(detail({ tracked: true, recordStatus: "archived", onHandMilli: 4000, reservedMilli: 1000, availableMilli: 3000 })) });
  const tree = await h.settle(); assert.equal(button(tree, "Stop tracking").props.disabled, true); assert.equal(button(tree, "Stocktake").props.disabled, false); assert.equal(button(tree, "Receive stock").props.disabled, false); assert.match(text(tree), /Archived product/);
});

test("invalid decimal quantities are rejected before any stock mutation", async t => {
  const h = harness(t, { props: { initialAction: "receive" }, respond: () => response(detail({ tracked: true })) }); let tree = await h.settle();
  for (const value of ["-1", "0", "2.0001", "NaN", "1000001"]) { input(tree, "Quantity received").props.onChange({ target: { value } }); submit(h.render()); tree = h.render(); assert.ok(nodes(tree, node => node.props?.role === "alert").length); }
  assert.equal(h.requests.filter(row => row.init.method).length, 0);
});

test("leaving stock while authentication is pending does not submit a late mutation", async t => {
  const h = harness(t, { props: { initialAction: "receive" }, respond: () => response(detail({ tracked: true })) });
  let tree = await h.settle(); let authenticate;
  h.props.user.getIdToken = () => new Promise(resolve => { authenticate = resolve; });
  input(tree, "Quantity received").props.onChange({ target: { value: "3" } }); tree = h.render(); submit(tree); await tick();
  h.cleanup(); authenticate("token"); await tick(); assert.equal(h.requests.filter(row => row.init.method).length, 0);
});

test("Stock view filters only tracked low-stock items and can find a product by code", async t => {
  const h = harness(t, { component: "TradeStockWorkspace", respond: () => response({ ok: true, canManage: true, items: [item({ tracked: true, availableMilli: 1000, lowStockMilli: 2000 }), item({ itemId: "other", itemCode: "PB-2", name: "Heat pump", tracked: true, availableMilli: 5000 }), item({ itemId: "untracked", name: "Buy when needed" })] }) });
  let tree = await h.settle(); assert.match(text(tree), /Solar panel/); assert.match(text(tree), /Heat pump/); assert.doesNotMatch(text(tree), /Buy when needed/);
  nodes(tree, node => node.type === "button" && text(node).startsWith("Low stock"))[0].props.onClick(); tree = h.render(); assert.match(text(tree), /Solar panel/); assert.doesNotMatch(text(tree), /Heat pump/);
  nodes(tree, node => node.type === "button" && text(node).startsWith("All stock"))[0].props.onClick(); input(tree, "Find stock").props.onChange({ target: { value: "PB-2" } }); tree = h.render(); assert.doesNotMatch(text(tree), /Solar panel/); assert.match(text(tree), /Heat pump/);
});

test("businesses without tracked products keep their usual price book and stock setup is outside its form", async t => {
  const h = harness(t, { component: "TradePriceBookWorkspace", respond: url => response(url.startsWith("/api/trade-stock") ? { ok: true, items: [], canManage: true } : library) });
  let tree = await h.settle(); assert.equal(button(tree, "Stock"), undefined); assert.ok(button(tree, "New item"));
  button(tree, "Solar panel").props.onClick(); tree = await h.settle();
  const stockSettings = nodes(tree, node => node.type === h.ProductStock)[0]; assert.ok(stockSettings); assert.equal(stockSettings.props.initialAction, null);
  const form = nodes(tree, node => node.type === "form")[0]; assert.equal(nodes(form, node => node.type === h.ProductStock).length, 0);
  stockSettings.props.onLoaded(item()); tree = h.render();
  const chargeBy = nodes(tree, node => node.type === "label" && text(node).startsWith("Charge by"))[0]; assert.equal(nodes(chargeBy, node => node.type === "select")[0].props.disabled, false);
  assert.equal(h.requests.filter(row => row.init.method).length, 0);
});

test("tracked products expose Stock and lock type and units until tracking stops", async t => {
  const h = harness(t, { component: "TradePriceBookWorkspace", respond: url => response(url.startsWith("/api/trade-stock") ? { ok: true, items: [item({ tracked: true })], canManage: true } : library) });
  let tree = await h.settle(); assert.ok(button(tree, "Stock"));
  button(tree, "Solar panel").props.onClick(); tree = await h.settle();
  nodes(tree, node => node.type === h.ProductStock)[0].props.onLoaded(item({ tracked: true })); tree = h.render();
  for (const label of ["Type", "Charge by"]) { const field = nodes(tree, node => node.type === "label" && text(node).startsWith(label))[0]; assert.equal(nodes(field, node => node.type === "select")[0].props.disabled, true); }
  assert.equal(input(tree, "Solar panel for Map").props.disabled, false, "Each items can add map specifications without relabelling physical stock units");
  assert.match(text(tree), /Stop tracking before changing them/);
});

const splitDetail = (patch = {}) => ({ ...detail({ tracked: true, revision: 4, onHandMilli: 6000, reservedMilli: 7000, availableMilli: -1000,
  locations: [{ locationId: main.id, name: main.name, responsibleName: "", onHandMilli: 6000 }, { locationId: john.id, name: john.name, responsibleName: "John", onHandMilli: 0 }], ...patch }), locations: [main, john] });

test("stocktake edits the selected member location and preserves the other counts", async t => {
  const h = harness(t, { props: { initialAction: "count" }, respond: (_url, init) => response(init.method ? splitDetail({ onHandMilli: 8000 }) : splitDetail()) });
  let tree = await h.settle(); assert.equal(input(tree, "Actual quantity").props.value, "6");
  select(tree, "Storage location").props.onChange({ target: { value: john.id } }); tree = h.render();
  assert.equal(input(tree, "Actual quantity").props.value, "0"); assert.match(text(tree), /This replaces the count at\s+John/);
  input(tree, "Actual quantity").props.onChange({ target: { value: "2" } }); submit(h.render()); await h.settle();
  const body = JSON.parse(h.requests.find(row => row.init.method).init.body);
  assert.equal(body.locationId, john.id); assert.equal(body.action, "count"); assert.equal(body.quantityMilli, 2000); assert.equal(body.expectedRevision, 4);
});

test("moving three of six items to John submits one transfer and keeps the business total", async t => {
  let finish;
  const h = harness(t, { respond: (_url, init) => !init.method ? response(splitDetail({ reservedMilli: 0, availableMilli: 6000 })) : new Promise(resolve => { finish = () => resolve(response(splitDetail({ revision: 5, reservedMilli: 0, availableMilli: 6000,
    locations: [{ locationId: main.id, name: main.name, responsibleName: "", onHandMilli: 3000 }, { locationId: john.id, name: john.name, responsibleName: "John", onHandMilli: 3000 }] }))); }) });
  let tree = await h.settle(); button(tree, "Move stock").props.onClick(); tree = h.render();
  assert.equal(select(tree, "Move from").props.value, main.id); assert.equal(select(tree, "Move to").props.value, john.id);
  assert.equal(nodes(select(tree, "Move to"), node => node.type === "option" && node.props.value === main.id).length, 0);
  input(tree, "Quantity to move").props.onChange({ target: { value: "3" } }); tree = h.render(); submit(tree); submit(tree); await tick();
  const writes = h.requests.filter(row => row.init.method); assert.equal(writes.length, 1);
  const body = JSON.parse(writes[0].init.body); assert.equal(body.action, "transfer"); assert.equal(body.fromLocationId, main.id); assert.equal(body.toLocationId, john.id); assert.equal(body.quantityMilli, 3000);
  finish(); tree = await h.settle(); assert.match(text(tree), /Stock moved. The business total has not changed/); assert.equal(h.changes[0].onHandMilli, 6000);
  assert.deepEqual(h.changes[0].locations.map(location => location.onHandMilli), [3000, 3000]);
});

test("available stock keeps its negative sign and pausing retains positive counts", async t => {
  const negative = harness(t, { component: "TestStockNumbers", props: { item: item({ onHandMilli: 3000, reservedMilli: 4000, availableMilli: -1000 }) } });
  assert.match(text(negative.render()), /On hand 3 Committed 4 Available -1/);
  const h = harness(t, { respond: (_url, init) => response(detail({ tracked: !init.method, revision: 2, onHandMilli: 6000, availableMilli: 6000 })) });
  let tree = await h.settle(); assert.equal(button(tree, "Stop tracking").props.disabled, false);
  button(tree, "Stop tracking").props.onClick(); tree = await h.settle(); assert.match(text(tree), /Saved counts and history are kept/); assert.ok(button(tree, "Stocktake"));
  assert.equal(h.changes[0].onHandMilli, 6000); assert.equal(h.changes[0].tracked, false);
});

test("choose a team member as a location without entering vehicle details, with exact safe retry", async t => {
  const saves = []; let attempts = 0;
  const h = harness(t, { component: "TestLocationEditor", props: { location: null, members, onSaved: (...values) => saves.push(values), onCancel() {} }, respond: () => {
    if (!attempts++) throw new Error("Connection lost");
    return response({ ok: true, location: john, locations: [main, john], members });
  } });
  let tree = h.render(); select(tree, "Keep stock with").props.onChange({ target: { value: "member" } }); tree = h.render();
  assert.equal(input(tree, "New location name"), undefined); select(tree, "Team member").props.onChange({ target: { value: "john" } });
  submit(h.render()); tree = await h.settle(); assert.ok(button(tree, "Retry location update")); assert.equal(select(tree, "Team member").props.disabled, true);
  submit(tree); await h.settle(); const writes = h.requests.filter(row => row.init.method);
  assert.equal(writes.length, 2); assert.equal(writes[0].init.body, writes[1].init.body);
  const body = JSON.parse(writes[0].init.body); assert.equal(body.name, "John"); assert.equal(body.responsibleMemberId, "john"); assert.equal(body.action, "create_location"); assert.equal(saves.length, 1);
});

test("location editing locks conflicting product actions and direct stock navigation selects the requested item", async t => {
  const h = harness(t, { respond: () => response(splitDetail()) }); let tree = await h.settle();
  button(tree, "Add location").props.onClick(); tree = h.render(); assert.equal(button(tree, "Move stock").props.disabled, true); assert.equal(button(tree, "Receive stock").props.disabled, true);
  const direct = harness(t, { component: "TradeStockWorkspace", props: { initialItemId: "product-1" }, respond: () => response({ ok: true, canManage: true, items: [item()] }) }); tree = await direct.settle();
  const settings = nodes(tree, node => typeof node.type === "function" && node.type.name === "TradeStockProductSettings")[0];
  assert.equal(settings.props.itemId, "product-1"); assert.equal(settings.props.canManage, true);
});

test("Save and set up stock saves one product first without silently enabling stock or adding a second product", async t => {
  const h = harness(t, { component: "TradePriceBookWorkspace", respond: (url, init) => response(url.startsWith("/api/trade-stock") ? { ok: true, items: [], canManage: true } : init.method ? { ok: true, item: { ...product, id: "new-product" } } : library) });
  let tree = await h.settle(); button(tree, "New item").props.onClick(); tree = h.render(); assert.ok(button(tree, "Save & set up stock"));
  const event = { preventDefault() {}, nativeEvent: { submitter: new SubmitButton("stock") } };
  const form = nodes(tree, node => node.type === "form")[0]; const pending = form.props.onSubmit(event); form.props.onSubmit(event); event.nativeEvent.submitter = null; await pending; tree = await h.settle();
  const writes = h.requests.filter(row => row.init.method); assert.equal(writes.length, 1); assert.equal(writes[0].url, "/api/trade-price-book");
  const stockSettings = nodes(tree, node => node.type === h.ProductStock)[0]; assert.equal(stockSettings.props.itemId, "new-product"); assert.equal(stockSettings.props.initialAction, "enable"); assert.match(text(tree), /Enter your opening stock below/);
});
