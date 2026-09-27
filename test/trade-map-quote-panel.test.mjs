import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";
import { createElement } from "react";
import * as quoteMath from "../src/lib/trade-quote.ts";
import * as mapQuote from "../src/lib/trade-map-quote.ts";
import * as documentTotals from "../src/lib/trade-quote-document-totals.mjs";

const read = (name) => fs.readFileSync(new URL(`../src/components/${name}.tsx`, import.meta.url), "utf8");
const compile = (source) => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const panelCode = compile(read("TradeQuotePanel"));
const text = (node) => node == null || typeof node === "boolean" ? "" : typeof node === "string" || typeof node === "number" ? String(node) : Array.isArray(node) ? node.map(text).join(" ") : text(node.props?.children);
const nodes = (node, predicate) => !node || typeof node !== "object" ? [] : Array.isArray(node) ? node.flatMap((child) => nodes(child, predicate)) : [...(predicate(node) ? [node] : []), ...nodes(node.props?.children, predicate)];
const button = (tree, label) => nodes(tree, (node) => node.type === "button" && text(node) === label)[0];
const field = (tree, label) => nodes(tree, (node) => node.props?.["aria-label"] === label)[0];
const flush = () => new Promise((resolve) => setImmediate(resolve));
const item = (id, unitLabel) => ({ id, unitLabel, itemCode: id, name: `Rate ${id}`, description: `Rate ${id}`, itemType: "product", lineType: "product", unitCostCentsExGst: 100, sellPriceCentsExGst: 1250, taxCode: "gst" });
const intent = (overrides = {}) => ({ id: "map-once", ownerUid: "owner", workOrderId: "job-one", measurement: { kind: "area", quantity: 123.4 }, ...overrides });
const product = (description = "Existing scope", unitPrice = "100.00") => ({ lineType: "product", description, quantity: "1", unitPrice, taxCode: "gst", sectionHeading: "Included work" });
const finalDiscount = { lineType: "adjustment", description: "Final discount", quantity: "percent:10", unitPrice: "0.00", taxCode: "gst", sectionHeading: quoteMath.OVERALL_PERCENT_DISCOUNT_SECTION };
const choice = (key, kind, groupKey, amount, recommended = false) => ({ clientKey: key, kind, groupKey, name: key, summary: "", recommended, lines: [product(key, amount)] });
const savedLines = (lines) => quoteMath.normaliseTradeQuoteLineGroup(lines, (value) => String(value).trim(), true).lines.map((line, index) => ({
  ...line, id: `line-${index}`, priceBookItemId: lines[index].priceBookItemId || "", jobPacketId: "", jobPacketLineId: "", sectionHeading: lines[index].sectionHeading,
}));
const savedQuote = ({ lines, choices = [], customerEmail = "", terms = "", customerMessage = "", validUntil = "" }) => ({
  id: "quote-one", quoteNumber: "Q-001", currentVersionNumber: 1, status: "draft", editableDraft: { id: "version-one", versionNumber: 1, updatedAt: "now" },
  versions: [{ id: "version-one", versionNumber: 1, status: "draft", customerEmail, terms, customerMessage, validUntil, items: savedLines(lines), choices: choices.map((option) => ({ ...option, id: option.clientKey, items: savedLines(option.lines) })) }],
  link: null, timeline: [], questions: [], deliveries: [],
});
const result = (overrides = {}) => ({
  ok: true, quote: null, authorisedEmails: [], priceBookItems: [item("area", "m²"), item("pack", "pack"), item("length", "m"), item("panel", "each")], jobPackets: [],
  access: { canManageQuotes: true, canSendQuotes: true, canManageCustomers: true, canApplyDiscounts: true },
  business: { businessName: "Example Trade", quoteDefaultTerms: "", quoteEmailIntro: "", brandThemeKey: "cobalt_aqua", brandBorderStyle: "soft", hasLogo: false },
  job: { customerId: "customer-one", customerName: "Example Customer", workNumber: "JOB-001", title: "Roof upgrade", siteSummary: "1 Example Street", publicLead: false },
  ...overrides,
});

function harness(t, initial = result(), options = {}) {
  let cursor = 0;
  const state = [], effects = [], pending = [], requests = [], dirty = [], busy = [], frames = new Set();
  const hooks = {
    createElement,
    useState(initialValue) { const i = cursor++; if (!(i in state)) state[i] = typeof initialValue === "function" ? initialValue() : initialValue; return [state[i], (next) => { state[i] = typeof next === "function" ? next(state[i]) : next; }]; },
    useRef(value) { const i = cursor++; return state[i] ||= { current: value }; },
    useMemo(factory, deps) { const i = cursor++; if (!state[i] || deps.some((value, j) => value !== state[i].deps[j])) state[i] = { deps, value: factory() }; return state[i].value; },
    useCallback(callback, deps) { return hooks.useMemo(() => callback, deps); },
    useEffect(callback, deps) { const i = cursor++, old = effects[i]; if (!old || deps.some((value, j) => value !== old.deps[j])) { old?.cleanup?.(); effects[i] = { deps }; pending.push(() => { effects[i].cleanup = callback(); }); } },
  };
  const LivePreview = () => null;
  const require = (id) => id === "react" ? hooks : id === "react/jsx-runtime" ? jsx : id === "@/lib/trade-quote" ? quoteMath
    : id === "@/lib/trade-map-quote" ? mapQuote : id === "@/lib/trade-quote-document-totals.mjs" ? documentTotals
      : id === "./TradeQuoteLivePreview" ? { TradeQuoteLivePreview: LivePreview }
        : id === "@/lib/trade-rebate-draft" ? { loadTradeRebateEstimateDraft: () => null, clearTradeRebateEstimateDraft() {} } : { default: {} };
  const window = { requestAnimationFrame(callback) { const id = setImmediate(() => { frames.delete(id); callback(); }); frames.add(id); return id; }, cancelAnimationFrame(id) { clearImmediate(id); frames.delete(id); }, sessionStorage: {}, location: { origin: "https://tlink.test" }, addEventListener() {}, removeEventListener() {} };
  const document = { body: { style: { overflow: "" } }, querySelectorAll: () => [] };
  const fetch = async (url, init) => {
    if (url.startsWith("/api/trade-job-quote-photos")) return { ok: false, status: 404 };
    requests.push({ url, init });
    const data = options.respond ? await options.respond(url, init, initial) : init.method ? result({ quote: savedQuote(JSON.parse(init.body)), draftVersionId: "version-one" }) : initial;
    return { ok: true, json: async () => data };
  };
  const exports = {};
  Function("require", "exports", "fetch", "window", "document", panelCode)(require, exports, fetch, window, document);
  const props = { user: { uid: "owner", getIdToken: async () => "test-token" }, workOrderId: "job-one", available: true, mapQuoteIntent: intent(), showLivePreview: true,
    onDraftDirtyChange: (value) => dirty.push(value), onBusyChange: (value) => busy.push(value), ...options.props };
  const render = () => { cursor = 0; const tree = exports.TradeQuotePanel(props); for (const callback of pending.splice(0)) callback(); return tree; };
  const cleanup = () => { for (const effect of effects) effect?.cleanup?.(); for (const frame of frames) clearImmediate(frame); };
  t.after(cleanup);
  return { render, requests, dirty, busy, props, cleanup, async settle() { let tree; for (let i = 0; i < 5; i++) { tree = render(); await flush(); } return tree; }, preview: (tree) => nodes(tree, (node) => node.type === LivePreview)[0] };
}

test("authorized initial load replaces only the empty starter with one unpriced map line", async (t) => {
  const h = harness(t), tree = await h.settle();
  const preview = h.preview(tree).props;
  assert.equal(preview.lines.length, 1); assert.equal(preview.lines[0].quantity, "123.4"); assert.equal(preview.lines[0].unitPrice, "");
  assert.equal(h.dirty.at(-1), true); assert.equal(h.busy.at(-1), false);
  assert.equal(button(tree, "Manage price book"), undefined);
  assert.equal(field(tree, "Line 1 section heading").props.readOnly, true);
  assert.equal(preview.terms, ""); assert.equal(preview.customerMessage, "");
  assert.ok(field(tree, "Line 1 quantity (m²)")); assert.ok(field(tree, "Line 1 unit price per m²"));
  button(tree, "Save draft").props.onClick(); await h.settle();
  assert.equal(h.requests.filter((request) => request.init.method).length, 0, "missing map rate cannot be silently saved as zero");
});

test("map handoff preserves existing choices and inserts before the final discount once", async (t) => {
  const existing = savedQuote({ lines: [product(), finalDiscount], choices: [choice("extra", "addon", "extra", "10.00")] });
  const h = harness(t, result({ quote: existing }));
  let tree = await h.settle();
  assert.deepEqual(h.preview(tree).props.lines.map((line) => line.sectionHeading), ["Included work", "Map estimate: roof area (m²)", quoteMath.OVERALL_PERCENT_DISCOUNT_SECTION]);
  assert.equal(h.preview(tree).props.choices[0].name, "extra");
  h.props.mapQuoteIntent = { ...intent() }; tree = await h.settle();
  assert.equal(h.preview(tree).props.lines.filter((line) => mapQuote.mapQuoteKind(line.sectionHeading)).length, 1);
  assert.equal(h.requests.filter((request) => !request.init.method).length, 1);
});

for (const blocked of ["user", "job", "permission", "readonly"]) test(`map handoff rejects mismatched ${blocked}`, async (t) => {
  const initial = result(blocked === "permission" ? { access: { canManageQuotes: false } } : {});
  const props = blocked === "user" ? { mapQuoteIntent: intent({ ownerUid: "other-business" }) } : blocked === "job" ? { mapQuoteIntent: intent({ workOrderId: "other-job" }) } : blocked === "readonly" ? { readOnly: true } : {};
  const h = harness(t, initial, { props }), tree = await h.settle();
  assert.equal(h.preview(tree).props.lines.some((line) => mapQuote.mapQuoteKind(line.sectionHeading)), false);
  assert.equal(h.dirty.at(-1), false);
});

test("map rate choices filter by unit, retain measured quantity, and reject injected pack selections", async (t) => {
  const h = harness(t); let tree = await h.settle();
  let select = field(tree, "Line 1 price book item");
  assert.deepEqual(nodes(select, (node) => node.type === "option").map((node) => node.props.value), ["", "area"]);
  select.props.onChange({ target: { value: "pack" } }); tree = h.render();
  assert.equal(h.preview(tree).props.lines[0].priceBookItemId, undefined);
  select.props.onChange({ target: { value: "area" } }); tree = h.render();
  assert.equal(h.preview(tree).props.lines[0].quantity, "123.4"); assert.equal(h.preview(tree).props.lines[0].unitPrice, "12.50");
  button(tree, "Add included line").props.onClick(); tree = h.render();
  select = field(tree, "Line 2 price book item");
  assert.deepEqual(nodes(select, (node) => node.type === "option").map((node) => node.props.value), ["", "area", "pack", "length", "panel"]);
  select.props.onChange({ target: { value: "pack" } }); tree = h.render();
  assert.equal(h.preview(tree).props.lines[1].priceBookItemId, "pack"); assert.equal(h.preview(tree).props.lines[1].quantity, "1");
});

test("successful save resets dirty baseline without reapplying map intent and locks edits while pending", async (t) => {
  let release;
  const h = harness(t, result(), { respond: (_url, init, initial) => init.method ? new Promise((resolve) => { release = () => resolve(result({ quote: savedQuote(JSON.parse(init.body)) })); }) : initial });
  let tree = await h.settle();
  field(tree, "Line 1 unit price per m²").props.onChange({ target: { value: "2.00" } }); tree = h.render();
  button(tree, "Save draft").props.onClick(); tree = await h.settle();
  assert.equal(nodes(tree, (node) => node.type === "fieldset")[0].props.disabled, true); assert.equal(h.busy.at(-1), true);
  release(); tree = await h.settle();
  assert.equal(h.dirty.at(-1), false); assert.equal(h.busy.at(-1), false);
  assert.equal(h.preview(tree).props.lines.length, 1); assert.equal(h.preview(tree).props.lines[0].quantity, "123.4");
  field(tree, "Line 1 quantity (m²)").props.onChange({ target: { value: "124" } }); await h.settle();
  assert.equal(h.dirty.at(-1), true);
});

test("link metadata refresh cannot overwrite unsaved map line changes", async (t) => {
  const existing = savedQuote({ lines: [product()] });
  existing.link = { id: "link", status: "issued", shareUrl: "https://tlink.test/q/one", pdfUrl: "", expiresAt: "2026-10-27", tokenIssue: 1 };
  const initial = result({ quote: existing });
  const h = harness(t, initial, { respond: () => initial }); let tree = await h.settle();
  field(tree, "Line 2 unit price per m²").props.onChange({ target: { value: "3.25" } }); tree = h.render();
  button(tree, "Replace link").props.onClick(); tree = await h.settle();
  assert.equal(h.preview(tree).props.lines.length, 2); assert.equal(h.preview(tree).props.lines[1].unitPrice, "3.25"); assert.equal(h.dirty.at(-1), true);
});

test("unmounted initial load ignores a late authorised response", async (t) => {
  let release;
  const h = harness(t, result(), { respond: () => new Promise((resolve) => { release = resolve; }) });
  await h.settle(); assert.equal(h.busy.at(-1), true); h.cleanup(); release(result()); await flush();
  assert.equal(h.requests[0].init.signal.aborted, true); assert.equal(h.dirty.includes(true), false);
});

const previewExports = {};
Function("require", "exports", compile(read("TradeQuoteLivePreview")))((id) => id === "react/jsx-runtime" ? jsx : id === "react" ? { useState: () => [null, () => {}], useEffect() {} }
  : id === "@/lib/trade-quote" ? quoteMath : id === "@/lib/trade-map-quote" ? mapQuote : id === "@/lib/trade-quote-document-totals.mjs" ? documentTotals : { default: {} }, previewExports);

test("live document uses canonical discounts and required choices before email or terms exist", () => {
  const lines = [product(), finalDiscount], choices = [choice("basic", "package", "package", "20.00"), choice("recommended", "package", "package", "30.00", true), choice("extra", "addon", "extra", "80.00")];
  const document = previewExports.liveQuoteDocument(lines, choices);
  assert.equal(document.complete, true); assert.equal(document.totals.totalCents, 13200); assert.equal(document.discounts, -1000);
  assert.deepEqual(document.totals.selectedChoiceIds, ["recommended"]);
});

test("fixed discounts display the entered amount as an inclusive GST deduction", () => {
  const lines = [product("Installation", "1000.00"), { ...product("Customer discount"), lineType: "adjustment", sectionHeading: quoteMath.OVERALL_FIXED_DISCOUNT_SECTION }];
  const tree = previewExports.TradeQuoteLivePreview({ user: { uid: "owner" }, workOrderId: "job-one", lines, choices: [], business: result().business, job: result().job, identity: null, customerMessage: "", terms: "", validUntil: "", validationMessage: "" });
  assert.match(text(tree), /\$100\.00 off incl GST/); assert.match(text(tree), /-\$100\.00/);
  assert.doesNotMatch(text(tree), /\$100\.00 each ex GST/);
  assert.equal(previewExports.liveQuoteDocument(lines, []).totals.totalCents, 100000);
});

test("a saved map line whose price-book unit changed to packs cannot be saved or shown as a complete quote", async (t) => {
  const lines = [{ ...mapQuote.mapQuoteLine(intent().measurement), unitPrice: "12.50", priceBookItemId: "pack" }];
  const h = harness(t, result({ quote: savedQuote({ lines }) }), { props: { mapQuoteIntent: undefined } });
  const tree = await h.settle();
  assert.match(h.preview(tree).props.validationMessage, /same unit as the map quantity/);
  button(tree, "Save draft").props.onClick(); await h.settle();
  assert.equal(h.requests.some((request) => request.init.method), false);
});

test("failed saves retain the unsaved map line and dirty baseline", async (t) => {
  const h = harness(t, result(), { respond: (_url, init, initial) => init.method ? { ok: false, error: "Save failed" } : initial });
  let tree = await h.settle();
  field(tree, "Line 1 unit price per m²").props.onChange({ target: { value: "4.50" } }); tree = h.render();
  button(tree, "Save draft").props.onClick(); tree = await h.settle();
  assert.equal(h.dirty.at(-1), true); assert.equal(h.preview(tree).props.lines[0].unitPrice, "4.50");
  assert.match(text(tree), /Save failed/);
});

for (const unitPrice of ["", "nonsense", "-10", "1.234"]) test(`live document labels invalid rate ${JSON.stringify(unitPrice)} incomplete without a fake total`, () => {
  const lines = [{ ...mapQuote.mapQuoteLine(intent().measurement), unitPrice }];
  const tree = previewExports.TradeQuoteLivePreview({ user: { uid: "owner" }, lines, choices: [], business: result().business, job: result().job, identity: null, customerMessage: "", terms: "", validUntil: "", validationMessage: "" });
  assert.match(text(tree), /Total incomplete/); assert.match(text(tree), /Price needed/);
  assert.doesNotMatch(text(tree), /\$0\.00|NaN|\$10\.00/);
});
