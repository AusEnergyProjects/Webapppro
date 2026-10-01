import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";

const nodes = (tree, predicate) => !tree || typeof tree !== "object" ? [] : Array.isArray(tree)
  ? tree.flatMap(child => nodes(child, predicate))
  : [...(predicate(tree) ? [tree] : []), ...nodes(tree.props?.children, predicate)];
const text = tree => tree == null || typeof tree === "boolean" ? "" : typeof tree !== "object" ? String(tree)
  : Array.isArray(tree) ? tree.map(text).join("") : text(tree.props?.children);
const byId = (tree, id) => nodes(tree, node => node.props?.id === id)[0];
const button = (tree, label) => nodes(tree, node => node.type === "button" && text(node) === label)[0];
const child = (tree, name) => nodes(tree, node => node.type === name || node.type?.name === name)[0];
const idle = () => new Promise(resolve => setImmediate(resolve));

// Execute production components/handlers. Only hooks, browser surfaces and external services are isolated.
function panelHarness(name, initialProps, request) {
  const slots = [], pendingEffects = [], frames = [], calls = [], scrolls = [];
  const elements = new Map();
  let cursor = 0, props = initialProps;
  const same = (a, b) => a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
  const hooks = {
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = { value: typeof initial === "function" ? initial() : initial };
      return [slots[index].value, value => { slots[index].value = typeof value === "function" ? value(slots[index].value) : value; }];
    },
    useRef(initial) { const index = cursor++; slots[index] ||= { current: initial }; return slots[index]; },
    useMemo(factory, deps) {
      const index = cursor++;
      if (!same(slots[index]?.deps, deps)) slots[index] = { deps, value: factory() };
      return slots[index].value;
    },
    useCallback(callback, deps) { return hooks.useMemo(() => callback, deps); },
    useEffect(effect, deps) {
      const index = cursor++;
      if (!same(slots[index]?.deps, deps)) {
        slots[index]?.cleanup?.();
        slots[index] = { deps };
        pendingEffects.push(() => { slots[index].cleanup = effect(); });
      }
    },
  };
  const fetch = async (url, options = {}) => { calls.push({ url, ...options }); return request(url, options); };
  class Details {
    open = false;
    constructor(id) { this.id = id; }
    scrollIntoView(options) { scrolls.push({ id: this.id, open: this.open, options }); }
  }
  const browserWindow = { requestAnimationFrame: callback => { frames.push(callback); return frames.length; },
    cancelAnimationFrame() {}, setInterval() { return 1; }, clearInterval() {}, addEventListener() {}, removeEventListener() {} };
  const browserDocument = { visibilityState: "visible", body: { style: {} }, addEventListener() {}, removeEventListener() {},
    getElementById: id => elements.get(id) || null };
  const mocks = {
    react: hooks, "react/jsx-runtime": jsx,
    "./TradeBusinessProvider": { useTradeBusinessFetch: () => fetch },
    "@/lib/photo-request-review": { PHOTO_RETAKE_REASONS: {} },
    "./TradeActivityWorkPackPanel": { TradeActivityWorkPackPanel: "TradeActivityWorkPackPanel" },
    "./TradeSwmsPanel": { TradeSwmsPanel: "TradeSwmsPanel" },
    "./TradeBusinessFormEditor": { TradeBusinessFormEditor: "TradeBusinessFormEditor" },
    "./TradeWorkTimeTracking": { WorkTimeStatus: "WorkTimeStatus", useFormTimeTracking: () => ({ bind: {}, markCompleted() {} }) },
  };
  const source = fs.readFileSync(new URL(`../src/components/${name}.tsx`, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  const loaded = { exports: {} };
  new Function("require", "module", "exports", "window", "document", "navigator", "HTMLDetailsElement", compiled)(
    specifier => { assert.ok(specifier in mocks, specifier); return mocks[specifier]; }, loaded, loaded.exports,
    browserWindow, browserDocument, { onLine: true }, Details);
  const render = () => {
    cursor = 0;
    const tree = loaded.exports[name](props);
    for (const node of nodes(tree, node => node.props?.id)) {
      if (!elements.has(node.props.id)) elements.set(node.props.id, node.type === "details" ? new Details(node.props.id)
        : { scrollIntoView: options => scrolls.push({ id: node.props.id, options }) });
    }
    return tree;
  };
  return { render, calls, scrolls, elements,
    async ready() { render(); pendingEffects.splice(0).forEach(run => run()); frames.splice(0).forEach(run => run()); await idle(); return render(); },
    async refresh(patch) { props = { ...props, ...patch }; return this.ready(); },
    addDetails(id) { elements.set(id, new Details(id)); },
  };
}

const user = { uid: "worker", getIdToken: async () => "token" };
const fieldData = (patch = {}) => ({ ok: true, timeEntries: [], media: [], signoffs: [], fieldJob: {
  id: "job", workNumber: "JOB-1", title: "Existing job title", customerName: "Customer name", serviceSite: "Private site",
  status: "in_progress", scheduledStart: "", collaborativeJob: false, visits: [], actionUnavailableReason: "Complete the required job items.",
  checklist: [], blockers: [], completion: { ready: false, invoiceReady: false, handoverReady: false }, ...patch,
} });
const blockers = [
  ["forms", "Supporting forms", "forms"], ["tasks", "Tasks", "tasks"], ["issues", "Issues", "notes"],
  ["rental-report", "Issue rental report", "rental-assessment"], ["activities", "Activity records", "forms"],
  ["work-packs", "Signed activity pack", "forms"], ["scope", "Work plan", "work-plan"],
  ["compliance", "Evidence", "evidence"], ["proof", "Photo review", "evidence"],
  ["sync", "Pending sync", "sync"], ["future", "Future requirement", "future-target"],
].map(([key, label, target]) => ({ key, label, target }));

test("lost archive can retain recorded evidence without requirements or completion prompts", async () => {
  const h = panelHarness("TradeFieldWorkPanel", { user, workOrderId: "job", embedded: true, readOnly: true, showProgress: false }, async () => Response.json(fieldData({ blockers })));
  const tree = await h.ready();
  assert.equal(byId(tree, "today-checklist-title"), undefined);
  assert.ok(byId(tree, "field-evidence"));
  assert.equal(child(tree, "TradeActivityWorkPackPanel").props.readOnly, true);
  assert.equal(child(tree, "TradeSwmsPanel").props.readOnly, true);
  assert.equal(nodes(tree, node => node.type === "form").length, 0);
});

test("embedded readiness routes every actionable blocker and explains sync or unknown requirements", async () => {
  const navigated = [];
  const data = fieldData({ blockers });
  data.proofReview = { proofReady: false, counts: {}, reviews: [], uploadCounts: {}, completion: null };
  const h = panelHarness("TradeFieldWorkPanel", { user, workOrderId: "job", embedded: true, onNavigate: target => navigated.push(target) }, async () => Response.json(data));
  const tree = await h.ready(); h.addDetails("field-work-plan");
  for (const label of ["Supporting forms", "Tasks", "Issues", "Issue rental report", "Activity records"]) button(tree, label).props.onClick();
  assert.deepEqual(navigated, ["forms", "tasks", "notes", "rental-assessment", "activity-forms"]);
  for (const label of ["Signed activity pack", "Work plan", "Evidence", "Photo review"]) button(tree, label).props.onClick();
  assert.deepEqual(h.scrolls.map(item => item.id), ["job-files-work-packs", "field-work-plan", "field-evidence", "field-photo-review"]);
  assert.equal(h.elements.get("field-work-plan").open, true); assert.equal(h.elements.get("field-evidence").open, true);
  assert.equal(button(tree, "Pending sync"), undefined); assert.equal(button(tree, "Future requirement"), undefined);
  assert.match(text(tree), /device with pending field changes/); assert.match(text(tree), /Ask your job coordinator/);
});

test("embedded mode keeps readiness and the pack editor outside collapsed optional records", async () => {
  const h = panelHarness("TradeFieldWorkPanel", { user, workOrderId: "job", embedded: true }, async () => Response.json(fieldData()));
  const tree = await h.ready();
  assert.ok(byId(tree, "today-checklist-title")); assert.ok(byId(tree, "job-files-work-packs"));
  assert.equal(byId(tree, "field-evidence").type, "details"); assert.equal(byId(tree, "field-evidence").props.open, undefined);
  assert.ok(nodes(byId(tree, "field-evidence"), node => node.type === "form").length > 0);
  assert.equal(child(byId(tree, "field-evidence"), "TradeActivityWorkPackPanel"), undefined);
  assert.ok(child(tree, "TradeSwmsPanel"));
  assert.equal(child(byId(tree, "field-evidence"), "TradeSwmsPanel"), undefined);
  assert.doesNotMatch(text(tree), /Existing job title|Customer name|Private site/);
  const standalone = await h.refresh({ embedded: false });
  assert.equal(byId(standalone, "field-evidence").type, "div"); assert.match(text(standalone), /Existing job title/);
  assert.equal(child(standalone, "TradeSwmsPanel"), undefined);
});

test("commercial and read-only restrictions hold in embedded readiness", async () => {
  const data = fieldData({ completion: { ready: true, invoiceReady: true, handoverReady: true } });
  const h = panelHarness("TradeFieldWorkPanel", { user, workOrderId: "job", embedded: true, canOpenInvoice: false, onNavigate() {} }, async () => Response.json(data));
  let tree = await h.ready();
  assert.equal(button(tree, "Prepare invoice"), undefined); assert.equal(button(tree, "Open handover"), undefined);
  tree = await h.refresh({ canOpenInvoice: true }); assert.ok(button(tree, "Prepare invoice")); assert.equal(button(tree, "Open handover"), undefined);
  tree = await h.refresh({ readOnly: true, canOpenInvoice: true });
  assert.equal(button(tree, "Prepare invoice"), undefined); assert.equal(button(tree, "Open handover"), undefined);
  assert.equal(nodes(tree, node => node.type === "form").length, 0); assert.equal(child(tree, "TradeActivityWorkPackPanel").props.readOnly, true);
});

test("refreshKey reloads readiness while preserving the existing editor identity", async () => {
  let data = fieldData({ blockers: [blockers[0]] });
  const h = panelHarness("TradeFieldWorkPanel", { user, workOrderId: "job", embedded: true }, async () => Response.json(data));
  const before = await h.ready(); const pack = child(before, "TradeActivityWorkPackPanel");
  data = fieldData({ completion: { ready: true, invoiceReady: true, handoverReady: true } });
  const after = await h.refresh({ refreshKey: 1 });
  assert.equal(h.calls.length, 2); assert.equal(button(after, "Supporting forms"), undefined);
  assert.equal(child(after, "TradeActivityWorkPackPanel").type, pack.type); assert.equal(child(after, "TradeActivityWorkPackPanel").key, pack.key);
  assert.equal(byId(after, "field-evidence").type, byId(before, "field-evidence").type);
});

const form = { id: "form-1", templateKey: "inspection", templateVersion: 1, templateName: "Inspection", status: "draft", revision: 2, answers: {}, missing: [] };
const formData = { ok: true, serviceCategory: "electrical", forms: [form], templates: [{ key: "extra", version: 1, name: "Extra form", fieldCount: 2 }] };
function formsHarness({ pending = false, refreshFails = false, writeFails = false, readOnly = false, empty = false } = {}) {
  const changes = [];
  const data = { ...formData, forms: empty ? [] : formData.forms };
  const h = panelHarness("TradeJobFormsPanel", { user, workOrderId: "job", readOnly,
    onChanged: async () => { changes.push("refresh"); if (refreshFails) throw new Error("Refresh unavailable"); } }, async (_url, options) => {
    if (options.method === "GET") return Response.json(data);
    if (writeFails) return Response.json({ error: "Required answer missing" }, { status: 400 });
    const body = JSON.parse(options.body);
    return Response.json({ ...data, forms: [{ ...form, status: body.complete ? "complete" : "draft", revision: 3 }], jobProgress: { pending } });
  });
  return { ...h, changes };
}

test("successful completion refreshes the job and preserves its acknowledgement when refresh fails", async () => {
  for (const pending of [false, true]) {
    const h = formsHarness({ pending, refreshFails: true });
    const tree = await h.ready(); const editor = child(tree, "JobForm");
    assert.equal(await editor.props.onSave("form-1", 2, { result: "Done" }, true), true);
    const after = h.render();
    assert.deepEqual(h.changes, ["refresh"]); assert.equal(child(after, "JobForm").props.form.status, "complete");
    assert.equal(child(after, "JobForm").key, editor.key);
    assert.match(text(after), /Field form completed\./); assert.match(text(after), /latest job details could not be refreshed/);
    assert.equal(text(after).includes("Job status is waiting to sync."), pending);
  }
});

test("draft save and add-form success notify the parent, while failed writes and read-only access do not", async () => {
  const h = formsHarness(); let tree = await h.ready();
  assert.equal(await child(tree, "JobForm").props.onSave("form-1", 2, {}, false), true);
  assert.match(text(h.render()), /Field form saved\./);
  tree = h.render(); button(tree, "Add to job").props.onClick(); await idle();
  assert.deepEqual(h.changes, ["refresh", "refresh"]);
  assert.match(text(h.render()), /Field form added to this job/);
  for (const options of [{ writeFails: true }, { readOnly: true }]) {
    const blocked = formsHarness(options); const blockedTree = await blocked.ready();
    assert.equal(await child(blockedTree, "JobForm").props.onSave("form-1", 2, {}, true), false);
    assert.deepEqual(blocked.changes, []);
    if (options.readOnly) { assert.equal(button(blockedTree, "Add to job"), undefined); assert.equal(blocked.calls.length, 1); }
    else assert.match(text(blocked.render()), /Required answer missing/);
  }
});

test("supporting-form catalogue follows attached forms, opens for empty jobs and retains its editor when collapsed", async () => {
  const h = formsHarness({ empty: true }); let tree = await h.ready();
  const catalogue = nodes(tree, node => node.type === "details")[0];
  assert.equal(catalogue.props.open, true); const builder = child(catalogue, "TradeBusinessFormEditor"); assert.ok(builder);
  const sections = nodes(tree, node => node.props?.className === "crm-active-forms" || node.type === "details");
  assert.equal(sections[0].props.className, "crm-active-forms");
  catalogue.props.onToggle({ currentTarget: { open: false } }); tree = h.render();
  const collapsed = nodes(tree, node => node.type === "details")[0]; assert.equal(collapsed.props.open, false);
  assert.equal(child(collapsed, "TradeBusinessFormEditor").type, builder.type);
  assert.ok(button(collapsed, "Add to job"));
});
