import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";
import * as documents from "../src/lib/trade-price-book-documents.ts";
import * as priceBook from "../src/lib/trade-price-book.ts";
import * as quote from "../src/lib/trade-quote.ts";
import * as equipment from "../src/lib/trade-solar-equipment.ts";

const text = node => node == null || typeof node === "boolean" ? "" : typeof node === "string" || typeof node === "number" ? String(node) : Array.isArray(node) ? node.map(text).join(" ") : text(node.props?.children);
const nodes = (node, predicate) => !node || typeof node !== "object" ? [] : Array.isArray(node) ? node.flatMap(child => nodes(child, predicate)) : [...(predicate(node) ? [node] : []), ...nodes(node.props?.children, predicate)];
const button = (tree, label) => nodes(tree, node => node.type === "button" && text(node) === label)[0];
const input = tree => nodes(tree, node => node.type === "input" && node.props.type === "file")[0];
const dropZone = tree => nodes(tree, node => typeof node.props?.onDrop === "function")[0];
const tick = () => new Promise(resolve => setImmediate(resolve));
const response = (body, status = 200) => Response.json(body, { status });
const metadata = (id = "pdf-1", priceBookItemId = "product-1") => ({ id, priceBookItemId, fileName: `${id}.pdf`, label: `${id}.pdf`, contentType: "application/pdf", sizeBytes: 1200, pageCount: 2, createdAt: "2026-09-27T00:00:00Z" });
const file = (name = "warranty & terms.pdf") => new File(["%PDF-1.7\nexample"], name, { type: "application/pdf" });
const item = { id: "product-1", itemCode: "PB-1", name: "Existing product", description: "", itemType: "material", unitLabel: "each", supplierCostCentsExGst: 1000, sellPriceCentsExGst: 2000, taxCode: "gst", markupBasisPoints: 10000, marginBasisPoints: 5000, expectedDurationMinutes: 0, requiredSkill: "", supplierName: "", supplierSku: "", supplierProductId: "", recordStatus: "active", priceRevision: 1, createdAt: "now", updatedAt: "now" };
const library = { ok: true, items: [item], counts: { total: 2, active: 2, archived: 0 }, capabilityOptions: [], catalogueOptions: [], access: { canManage: true } };
class SubmitButton { constructor(value) { this.value = value; } }

function harness(t, component = "TradeProductDocuments", options = {}) {
  let cursor = 0, stopped = false;
  const state = [], effects = [], pending = [], requests = [], revoked = [], created = [], clicked = [];
  const hooks = {
    useState(initial) { const i = cursor++; if (!(i in state)) state[i] = typeof initial === "function" ? initial() : initial; return [state[i], value => { state[i] = typeof value === "function" ? value(state[i]) : value; }]; },
    useRef(initial) { const i = cursor++; return state[i] ||= { current: initial }; },
    useMemo(factory, deps) { const i = cursor++; if (!state[i] || deps.some((value, j) => value !== state[i].deps[j])) state[i] = { deps, value: factory() }; return state[i].value; },
    useCallback(callback, deps) { return hooks.useMemo(() => callback, deps); },
    useEffect(callback, deps) { const i = cursor++, old = effects[i]; if (!old || deps.some((value, j) => value !== old.deps[j])) { old?.cleanup?.(); effects[i] = { deps }; pending.push(() => { effects[i].cleanup = callback(); }); } },
  };
  const ProductDocuments = () => null;
  const dependencies = { react: hooks, "react/jsx-runtime": jsx, "@/lib/trade-price-book-documents": documents,
    "@/lib/trade-price-book": priceBook, "@/lib/trade-quote": quote, "@/lib/trade-solar-equipment": equipment,
    "./TradeProductDocuments": { TradeProductDocuments: ProductDocuments }, "./TradeJobPacketWorkspace": { TradeJobPacketWorkspace: () => null }, "./TradePriceBookImport": { TradePriceBookImport: () => null } };
  const source = fs.readFileSync(new URL(`../src/components/${component}.tsx`, import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const fetch = async (url, init = {}) => {
    requests.push({ url, init });
    if (options.respond) return options.respond(url, init);
    if (component === "TradePriceBookWorkspace") return response(library);
    return response(init.method === "POST" ? { ok: true, document: metadata() } : { ok: true, documents: options.documents || [] });
  };
  const exports = {};
  const objectUrl = { createObjectURL(blob) { const url = `blob:pdf-${created.length + 1}`; created.push({ url, blob }); return url; }, revokeObjectURL(url) { revoked.push(url); } };
  const window = { setTimeout: callback => setImmediate(callback), clearTimeout: id => clearImmediate(id), confirm: () => true };
  Function("require", "exports", "fetch", "URL", "window", "HTMLButtonElement", "Node", code)(id => dependencies[id] || { default: {} }, exports, fetch, objectUrl, window, SubmitButton, class Node {});
  const props = { user: { uid: "owner-1", getIdToken: options.getIdToken || (async () => "private-token") }, itemId: "product-1", canManage: true, ...options.props };
  const render = () => {
    cursor = 0;
    const tree = exports[component](props);
    for (const node of nodes(tree, node => node.props?.ref)) if (!node.props.ref.current) node.props.ref.current = { click: () => clicked.push("file") };
    for (const callback of pending.splice(0)) callback();
    return tree;
  };
  const cleanup = () => { if (stopped) return; stopped = true; for (const effect of effects) effect?.cleanup?.(); };
  t.after(cleanup);
  return { props, render, cleanup, requests, created, revoked, clicked, ProductDocuments,
    async settle() { let tree; for (let i = 0; i < 6; i++) { tree = render(); await tick(); } return tree; } };
}

for (const mode of ["picker", "drop"]) test(`${mode} uploads one authenticated PDF to the selected product without duplicate mutations`, async t => {
  const h = harness(t); let tree = await h.settle(); const pdf = file();
  if (mode === "picker") {
    button(tree, "Upload PDF").props.onClick(); assert.deepEqual(h.clicked, ["file"]);
    const event = { target: { files: [pdf], value: "selected" } };
    input(tree).props.onChange(event); input(tree).props.onChange(event);
    assert.equal(event.target.value, "");
  } else {
    let prevented = 0;
    const event = { preventDefault: () => prevented++, dataTransfer: { files: [pdf], types: ["Files"] } };
    dropZone(tree).props.onDragOver(event); dropZone(tree).props.onDrop(event); dropZone(tree).props.onDrop(event);
    assert.equal(prevented, 3);
  }
  tree = await h.settle();
  const writes = h.requests.filter(request => request.init.method === "POST"); assert.equal(writes.length, 1);
  assert.equal(new URL(writes[0].url, "https://tlink.test").searchParams.get("itemId"), "product-1");
  assert.equal(new URL(writes[0].url, "https://tlink.test").searchParams.get("filename"), pdf.name);
  assert.equal(writes[0].init.body, pdf); assert.equal(writes[0].init.headers.get("Authorization"), "Bearer private-token");
  assert.equal(writes[0].init.headers.get("Content-Type"), "application/pdf");
  assert.match(text(tree), /PDF added/); assert.match(text(tree), /pdf-1.pdf/);
});

test("wrong types, empty or oversized PDFs and multiple files fail before upload", async t => {
  const h = harness(t); let tree = await h.settle();
  for (const files of [[new File(["data"], "image.png", { type: "image/png" })], [new File([], "empty.pdf", { type: "application/pdf" })], [{ name: "huge.pdf", type: "application/pdf", size: documents.MAX_PRODUCT_DOCUMENT_BYTES + 1 }], [file(), file("second.pdf")]]) {
    dropZone(tree).props.onDrop({ preventDefault() {}, dataTransfer: { files } }); tree = h.render();
    assert.ok(nodes(tree, node => node.props?.role === "alert").length);
  }
  assert.equal(h.requests.filter(request => request.init.method === "POST").length, 0);
});

test("document count limit and failed initial listing do not allow an uninformed upload", async t => {
  const full = harness(t, "TradeProductDocuments", { documents: Array.from({ length: 5 }, (_, i) => metadata(`pdf-${i}`)) });
  let tree = await full.settle(); assert.equal(button(tree, "Upload PDF").props.disabled, true);
  dropZone(tree).props.onDrop({ preventDefault() {}, dataTransfer: { files: [file()] } }); tree = full.render();
  assert.match(text(tree), /already has 5 PDFs/); assert.equal(full.requests.filter(request => request.init.method).length, 0);
  const broken = harness(t, "TradeProductDocuments", { respond: () => response({ error: "Not available" }, 503) });
  tree = await broken.settle(); assert.equal(button(tree, "Upload PDF").props.disabled, true);
  input(tree).props.onChange({ target: { files: [file()], value: "" } });
  assert.equal(broken.requests.filter(request => request.init.method).length, 0);
});

test("server rejection remains visible after list reconciliation without automatically retrying upload", async t => {
  const h = harness(t, "TradeProductDocuments", { respond: (_url, init) => init.method === "POST" ? response({ error: "This PDF exceeds 40 pages." }, 400) : response({ ok: true, documents: [] }) });
  let tree = await h.settle(); input(tree).props.onChange({ target: { files: [file()], value: "" } }); tree = await h.settle();
  assert.match(text(tree), /This PDF exceeds 40 pages/);
  assert.equal(h.requests.filter(request => request.init.method === "POST").length, 1);
  assert.equal(h.requests.filter(request => !request.init.method).length, 2);
});

test("a returned PDF for another product cannot appear in the selected product", async t => {
  const h = harness(t, "TradeProductDocuments", { respond: (_url, init) => response(init.method === "POST" ? { ok: true, document: metadata("foreign-pdf", "other-product") } : { ok: true, documents: [] }) });
  let tree = await h.settle(); input(tree).props.onChange({ target: { files: [file()], value: "" } }); tree = await h.settle();
  assert.match(text(tree), /upload was not confirmed/); assert.doesNotMatch(text(tree), /foreign-pdf/);
});

test("an uncertain upload stays blocked until the current product document list is confirmed", async t => {
  let reads = 0;
  const h = harness(t, "TradeProductDocuments", { respond: (_url, init) => {
    if (init.method === "POST") return response({ error: "Upload result unavailable." }, 503);
    return ++reads === 2 ? response({ error: "Document list unavailable." }, 503) : response({ ok: true, documents: [] });
  } });
  let tree = await h.settle(); input(tree).props.onChange({ target: { files: [file()], value: "" } }); tree = await h.settle();
  assert.equal(button(tree, "Upload PDF").props.disabled, true);
  input(tree).props.onChange({ target: { files: [file()], value: "" } });
  assert.equal(h.requests.filter(request => request.init.method === "POST").length, 1);
  button(tree, "Load documents again").props.onClick(); tree = await h.settle();
  assert.equal(button(tree, "Upload PDF").props.disabled, false);
  assert.match(text(tree), /Upload result unavailable/);
});

test("previews fetch authenticated bytes and revoke replaced, closed and unmounted object URLs", async t => {
  const h = harness(t, "TradeProductDocuments", { respond: url => url.includes("documentId=") ? new Response("%PDF-1.7", { headers: { "Content-Type": "application/pdf" } }) : response({ ok: true, documents: [metadata("one"), metadata("two")] }) });
  let tree = await h.settle();
  button(tree, "View").props.onClick(); tree = await h.settle(); assert.equal(h.created.length, 1);
  const download = nodes(tree, node => node.type === "a" && text(node) === "Download PDF")[0];
  assert.equal(download.props.href, "blob:pdf-1"); assert.equal(download.props.download, "one.pdf");
  nodes(tree, node => node.type === "button" && text(node) === "View")[1].props.onClick(); tree = await h.settle();
  assert.deepEqual(h.revoked, ["blob:pdf-1"]);
  button(tree, "Close PDF").props.onClick(); tree = h.render(); assert.deepEqual(h.revoked, ["blob:pdf-1", "blob:pdf-2"]);
  button(tree, "View").props.onClick(); await h.settle(); h.cleanup();
  assert.deepEqual(h.revoked, ["blob:pdf-1", "blob:pdf-2", "blob:pdf-3"]);
  assert.ok(h.requests.filter(request => request.url.includes("documentId=")).every(request => request.init.headers.get("Authorization") === "Bearer private-token"));
});

test("unmount while authentication is pending cancels the upload before a mutation is sent", async t => {
  let tokenCalls = 0, releaseToken;
  const h = harness(t, "TradeProductDocuments", { getIdToken: () => ++tokenCalls === 1 ? Promise.resolve("first") : new Promise(resolve => { releaseToken = resolve; }) });
  const tree = await h.settle(); input(tree).props.onChange({ target: { files: [file()], value: "" } }); h.cleanup(); releaseToken("second");
  await tick(); await tick(); assert.equal(h.requests.filter(request => request.init.method).length, 0);
});

test("PDF product dropdown loads the complete active catalog independently of the filtered price-book list", async t => {
  const all = Array.from({ length: 25 }, (_, i) => ({ id: `product-${i + 1}`, itemCode: `PB-${i + 1}`, name: `Product ${i + 1}` }));
  const h = harness(t, "TradePriceBookWorkspace", { respond: url => response(url.includes("mode=document_products") ? { ok: true, products: all } : library) });
  let tree = await h.settle(); button(tree, "Upload product PDF").props.onClick(); tree = await h.settle();
  let select = nodes(tree, node => node.props?.["aria-label"] === "Product for PDF")[0];
  assert.equal(nodes(select, node => node.type === "option").length, 26);
  nodes(tree, node => node.props?.["aria-label"] === "Find product for PDF")[0].props.onChange({ target: { value: "PB-25" } }); tree = h.render();
  select = nodes(tree, node => node.props?.["aria-label"] === "Product for PDF")[0];
  assert.deepEqual(nodes(select, node => node.type === "option").map(node => node.props.value), ["", "product-25"]);
  select.props.onChange({ target: { value: "product-25" } }); tree = h.render();
  const panel = nodes(tree, node => node.type === h.ProductDocuments)[0];
  assert.equal(panel.props.itemId, "product-25"); assert.equal(panel.key, "owner-1:product-25");
});

test("Save and add PDFs captures the chosen submit action before awaiting and creates only one item", async t => {
  let release;
  const saved = { ...item, id: "new-item", name: "New product" };
  const h = harness(t, "TradePriceBookWorkspace", { respond: (_url, init) => init.method === "POST" ? new Promise(resolve => { release = () => resolve(response({ ok: true, item: saved })); }) : response(library) });
  let tree = await h.settle(); button(tree, "New item").props.onClick(); tree = h.render();
  const submitEvent = { preventDefault() {}, nativeEvent: { submitter: new SubmitButton("documents") } };
  const form = nodes(tree, node => node.type === "form")[0];
  const first = form.props.onSubmit(submitEvent); form.props.onSubmit(submitEvent); submitEvent.nativeEvent.submitter = null;
  await tick(); release(); await first; tree = await h.settle();
  assert.equal(h.requests.filter(request => request.init.method === "POST").length, 1);
  assert.equal(nodes(tree, node => node.type === h.ProductDocuments)[0].props.itemId, "new-item");
  assert.match(text(tree), /Item saved. Add its warranty or product PDFs below/);
});

test("a save response without the item does not claim success or open an unrelated PDF uploader", async t => {
  const h = harness(t, "TradePriceBookWorkspace", { respond: (_url, init) => response(init.method ? { ok: true } : library) });
  let tree = await h.settle(); button(tree, "New item").props.onClick(); tree = h.render();
  await nodes(tree, node => node.type === "form")[0].props.onSubmit({ preventDefault() {}, nativeEvent: { submitter: new SubmitButton("documents") } }); tree = await h.settle();
  assert.match(text(tree), /save was not confirmed/); assert.equal(nodes(tree, node => node.type === h.ProductDocuments).length, 0);
});

test("product search navigation opens the exact owned price-book result and returns to all items for the quick action", async t => {
  const selected = { ...item, id: "selected-product", itemCode: "PB-002", name: "Selected heat pump" };
  const h = harness(t, "TradePriceBookWorkspace", { props: { initialView: "packets", navigationTarget: { workspace: "products", kind: "product", id: selected.id, query: selected.itemCode, nonce: 1 } },
    respond: url => response(url.includes("itemId=") ? { ok: true, history: [] } : { ...library, items: [item, selected] }) });
  let tree = await h.settle();
  assert.match(text(tree), /Edit Selected heat pump/);
  assert.ok(h.requests.some(request => request.url.includes("search=PB-002&status=active")));
  assert.equal(nodes(tree, node => node.type === h.ProductDocuments)[0].props.itemId, selected.id);
  assert.ok(h.requests.some(request => request.url.endsWith("?itemId=selected-product")));
  h.props.navigationTarget = { workspace: "products", kind: "product", id: "", query: "", nonce: 2 };
  tree = await h.settle(); assert.equal(nodes(tree, node => node.type === "form").length, 0);
  assert.equal(nodes(tree, node => node.type === "input" && node.props.type === "search")[0].props.value, "");
  assert.match(text(tree), /Existing product/); assert.match(text(tree), /Selected heat pump/);
});

test("a missing or archived product search result cannot open a different item", async t => {
  const archived = { ...item, recordStatus: "archived" };
  const h = harness(t, "TradePriceBookWorkspace", { props: { navigationTarget: { workspace: "products", kind: "product", id: item.id, query: item.itemCode, nonce: 1 } },
    respond: () => response({ ...library, items: [archived, { ...item, id: "different-product" }] }) });
  const tree = await h.settle(); assert.equal(nodes(tree, node => node.type === "form").length, 0);
  assert.match(text(tree), /no longer in the active price book/);
  assert.equal(h.requests.filter(request => request.url.includes("itemId=")).length, 0);
});

test("product navigation preserves view-only access and does not fetch with an explicit denied permission", async t => {
  const navigationTarget = { workspace: "products", kind: "product", id: item.id, query: item.itemCode, nonce: 1 };
  const viewer = harness(t, "TradePriceBookWorkspace", { props: { navigationTarget, permissions: { canViewPriceBook: true, canManagePriceBook: false } },
    respond: url => response(url.includes("itemId=") ? { ok: true, history: [] } : { ...library, access: { canManage: false } }) });
  let tree = await viewer.settle(); assert.match(text(tree), /View Existing product/);
  assert.equal(nodes(tree, node => node.type === "fieldset")[0].props.disabled, true);
  assert.equal(button(tree, "Save changes"), undefined);
  const denied = harness(t, "TradePriceBookWorkspace", { props: { navigationTarget, permissions: { canViewPriceBook: false, canManagePriceBook: false } } });
  tree = await denied.settle(); assert.match(text(tree), /Ask the business owner for price-book access/);
  assert.equal(denied.requests.length, 0); assert.equal(nodes(tree, node => node.type === "form").length, 0);
});

test("a slow previous search cannot replace the newly selected product", async t => {
  let releaseFirst;
  const second = { ...item, id: "second-product", itemCode: "PB-002", name: "Second product" };
  const h = harness(t, "TradePriceBookWorkspace", { props: { navigationTarget: { workspace: "products", kind: "product", id: item.id, query: item.itemCode, nonce: 1 } },
    respond: url => url.includes(`search=${item.itemCode}&`) ? new Promise(resolve => { releaseFirst = () => resolve(response(library)); })
      : response(url.includes("itemId=") ? { ok: true, history: [] } : { ...library, items: [second] }) });
  await h.settle(); assert.equal(typeof releaseFirst, "function");
  h.props.navigationTarget = { workspace: "products", kind: "product", id: second.id, query: second.itemCode, nonce: 2 };
  let tree = await h.settle(); assert.match(text(tree), /Edit Second product/);
  releaseFirst(); tree = await h.settle(); assert.match(text(tree), /Edit Second product/);
  assert.equal(nodes(tree, node => node.type === h.ProductDocuments)[0].props.itemId, second.id);
  h.props.permissions = { canViewPriceBook: false, canManagePriceBook: false };
  tree = h.render(); assert.doesNotMatch(text(tree), /Second product/); assert.equal(nodes(tree, node => node.type === "form").length, 0);
});
