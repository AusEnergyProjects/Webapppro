import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";

// Execute the production TSX and handlers with the same isolated hook pattern as
// the other UI tests. Child services, effects, DOM and requests stay local.
function sourceTree(name) {
  return ts.createSourceFile(name, readFileSync(new URL(`../src/components/${name}`, import.meta.url), "utf8"),
    ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}
const workspace = sourceTree("InstallerCrmWorkspace.tsx");
const fieldPanel = sourceTree("TradeFieldWorkPanel.tsx");
const rentalPicker = sourceTree("TradeRentalActivityPicker.tsx");

function declaration(tree, name) {
  let found;
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) found = node;
    if (!found) ts.forEachChild(node, visit);
  }
  visit(tree);
  assert.ok(found, `Production function ${name} exists`);
  return found;
}

function loadFunction(tree, name, dependencies) {
  const node = declaration(tree, name);
  const compiled = ts.transpileModule(node.getText(tree), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const exports = {};
  const require = name => { assert.equal(name, "react/jsx-runtime"); return jsx; };
  return Function("require", "exports", ...Object.keys(dependencies), `${compiled}\nreturn ${name};`)(
    require, exports, ...Object.values(dependencies));
}

function componentStubs(tree, functionName) {
  const result = {};
  function visit(node) {
    if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node))
      && ts.isIdentifier(node.tagName) && /^[A-Z]/.test(node.tagName.text)) result[node.tagName.text] = node.tagName.text;
    ts.forEachChild(node, visit);
  }
  visit(declaration(tree, functionName));
  return result;
}

function hookState() {
  const slots = [];
  let cursor = 0;
  return {
    reset() { cursor = 0; },
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
      return [slots[index], value => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }];
    },
    useEffect() {},
    useCallback: callback => callback,
  };
}

const nodes = (tree, predicate) => !tree || typeof tree !== "object" ? [] : Array.isArray(tree)
  ? tree.flatMap(child => nodes(child, predicate))
  : [...(predicate(tree) ? [tree] : []), ...nodes(tree.props?.children, predicate)];
const text = tree => tree == null || typeof tree === "boolean" ? "" : typeof tree !== "object" ? String(tree)
  : Array.isArray(tree) ? tree.map(text).join("") : text(tree.props?.children);
const component = (tree, name) => nodes(tree, node => node.type === name)[0];
const byId = (tree, id) => nodes(tree, node => node.props?.id === id)[0];
const jobTabs = tree => nodes(tree, node => node.type === "nav" && node.props["aria-label"] === "Job card sections")[0];
const tabButton = (tree, label) => nodes(jobTabs(tree), node => node.type === "button" && text(node) === label)[0];

function workspaceHarness({ initialTab = "field", permissions, job: jobOverrides = {} } = {}) {
  const hooks = hookState();
  const frames = [], scrolled = [], reloads = [];
  const job = {
    id: "job-1", workNumber: "TLJ-1", revision: 4, title: "Test job", serviceCategory: "rental-inspection",
    customerSource: "trade_owned", sourceType: "internal", stage: "backlog", pipelineStage: "enquiry",
    appointments: [], notes: [], tasks: [], tags: [], assigneeMemberId: "", jobRegister: { operationalStatus: "scheduled" },
    ...jobOverrides,
  };
  const dependencies = {
    ...componentStubs(workspace, "JobDetail"), ...hooks,
    useTradeBusinessFetch: () => async () => { throw new Error("Unexpected request"); },
    useJobTimeTracking: () => {},
    nextAppointmentSlot: () => "2026-10-01T09:00", lifecycleLabel: value => value,
    scheduleProposalKey: (...parts) => parts.join(":"), registerStyles: {},
    serviceLabels: {}, pipelineLabels: {}, workStageLabels: {}, appointmentLabels: {},
    jobCustomerBillingStatus: () => "", phoneHref: value => `tel:${value}`,
    window: { requestAnimationFrame(callback) { frames.push(callback); return frames.length; } },
    document: { getElementById: id => ({ scrollIntoView: options => scrolled.push({ id, options }) }) },
  };
  const renderJob = loadFunction(workspace, "JobDetail", dependencies);
  const props = {
    job, initialTab, permissions, sites: [], teamMembers: [], busy: "", user: { uid: "owner", getIdToken: async () => "test-token" },
    onReload: async () => { reloads.push(job.id); },
  };
  return {
    render() { hooks.reset(); return renderJob(props); },
    runFrames() { frames.splice(0).forEach(callback => callback()); },
    scrolled, reloads,
  };
}

test("legacy Field entry opens Files and neither navigation menu retains Field or Forms tabs", () => {
  const h = workspaceHarness();
  const tree = h.render();
  assert.equal(tabButton(tree, "Files").props.className, "active");
  assert.equal(nodes(tree, node => node.props?.["aria-label"] === "Job files and forms")[0].props.hidden, false);
  assert.ok(component(tree, "TradeJobFilesPanel"));
  assert.equal(byId(tree, "job-files-forms").props.open, true);
  const labels = nodes(jobTabs(tree), node => node.type === "button").map(text);
  const more = component(jobTabs(tree), "AccessibleMenu");
  labels.push(...more.props.children(() => {}).map(text));
  assert.ok(labels.includes("Files"));
  for (const obsolete of ["Field work", "Field", "Assessment", "Forms", "Other forms"]) assert.ok(!labels.includes(obsolete), obsolete);
});

test("collapsing Forms keeps the same rental editor and supporting forms mounted", () => {
  const h = workspaceHarness();
  const pickerHooks = hookState();
  const renderPicker = loadFunction(rentalPicker, "TradeRentalActivityPicker", {
    ...pickerHooks, ...componentStubs(rentalPicker, "TradeRentalActivityPicker"),
    useTradeBusinessFetch: () => async () => { throw new Error("Unexpected request"); },
  });
  let tree = h.render();
  const beforePicker = component(tree, "TradeRentalActivityPicker");
  pickerHooks.reset();
  const beforeEditor = component(renderPicker(beforePicker.props), "TradeRentalInspectionPanel");
  assert.ok(beforeEditor);
  byId(tree, "job-files-forms").props.onToggle({ currentTarget: { open: false } });
  tree = h.render();
  assert.equal(byId(tree, "job-files-forms").props.open, false);
  const afterPicker = component(tree, "TradeRentalActivityPicker");
  assert.equal(afterPicker.type, beforePicker.type);
  assert.equal(afterPicker.key, beforePicker.key);
  pickerHooks.reset();
  const afterEditor = component(renderPicker(afterPicker.props), "TradeRentalInspectionPanel");
  assert.ok(afterEditor, "Collapsing a details disclosure must not unmount unsaved assessment state");
  assert.equal(afterEditor.type, beforeEditor.type);
  assert.equal(afterEditor.key, beforeEditor.key);
  assert.ok(component(tree, "TradeJobFormsPanel"));
});

test("Files preserves staff visibility, commercial restrictions and imported read-only access", () => {
  const noEvidence = workspaceHarness({ permissions: { canViewFieldEvidence: false } }).render();
  assert.equal(tabButton(noEvidence, "Files"), undefined);
  assert.equal(component(noEvidence, "TradeRentalActivityPicker"), undefined);
  assert.equal(component(noEvidence, "TradeJobFormsPanel"), undefined);
  assert.equal(component(noEvidence, "TradeFieldWorkPanel"), undefined);

  for (const options of [
    { permissions: { canViewFieldEvidence: true, canManageFieldEvidence: false, canViewQuotes: false, canViewInvoices: false } },
    { job: { stage: "imported", pipelineStage: "imported" } },
  ]) {
    const tree = workspaceHarness(options).render();
    for (const name of ["TradeRentalActivityPicker", "TradeJobFormsPanel", "TradeFieldWorkPanel"]) {
      assert.equal(component(tree, name).props.readOnly, true, `${name} is view only`);
    }
    assert.equal(byId(tree, "field-work-plan"), undefined);
    assert.equal(component(tree, "TradePhotoRequestPanel"), undefined);
    if (options.permissions) {
      const files = component(tree, "TradeJobFilesPanel");
      assert.equal(files.props.includeHandover, false);
      assert.equal(files.props.includeQuotes, false);
      assert.equal(files.props.includeInvoices, false);
      assert.equal(component(tree, "TradeFieldWorkPanel").props.canOpenHandover, false);
    }
  }
  const owner = workspaceHarness().render();
  assert.equal(component(owner, "TradeFieldWorkPanel").props.readOnly, false);
  assert.ok(byId(owner, "field-work-plan"));
});

test("field checklist supporting-forms navigation opens and reveals the Files forms disclosure", () => {
  const h = workspaceHarness();
  byId(h.render(), "job-files-forms").props.onToggle({ currentTarget: { open: false } });
  const field = component(h.render(), "TradeFieldWorkPanel");
  const openChecklist = loadFunction(fieldPanel, "openChecklist", { onNavigate: field.props.onNavigate });
  openChecklist("forms");
  const tree = h.render();
  assert.equal(tabButton(tree, "Files").props.className, "active");
  assert.equal(byId(tree, "job-files-forms").props.open, true);
  h.runFrames();
  assert.deepEqual(h.scrolled.map(item => item.id), ["job-files-forms"]);
});

test("a work-plan blocker opens its disclosure before scrolling to the retained target", () => {
  assert.ok(byId(workspaceHarness().render(), "field-work-plan"));
  const events = [];
  class Details {
    open = false;
    scrollIntoView(options) { events.push({ open: this.open, options }); }
  }
  const details = new Details();
  const openChecklist = loadFunction(fieldPanel, "openChecklist", {
    HTMLDetailsElement: Details,
    document: { getElementById(id) { assert.equal(id, "field-work-plan"); return details; } },
  });
  openChecklist("work-plan");
  assert.equal(details.open, true);
  assert.deepEqual(events, [{ open: true, options: { behavior: "smooth", block: "start" } }]);
});

function mutationHarness(kind, { readOnly = false, failed = false, changed = async () => {} } = {}) {
  const events = [], requests = [];
  const payload = { ok: !failed, media: [], signoffs: [], timeEntries: [], error: failed ? "Server rejected this change" : undefined };
  const form = {
    entries: kind === "upload" ? [["category", "document"], ["file", new Blob(["test evidence"], { type: "application/pdf" })]]
      : [["signerName", "Test technician"], ["signerRole", "technician"], ["confirmed", "yes"]],
    reset() { events.push("reset"); },
  };
  class FormFixture extends FormData {
    constructor(form) { super(); for (const [name, value] of form.entries) this.append(name, value); }
  }
  const handler = loadFunction(fieldPanel, kind === "upload" ? "upload" : "jsonAction", {
    readOnly, selectedVisitId: "", workOrderId: "job-1", FormData: FormFixture,
    user: { getIdToken: async () => "test-token" },
    fetch: async (url, init) => { requests.push({ url, init }); events.push("response"); return { ok: !failed, json: async () => payload }; },
    setBusy: value => events.push(`busy:${value}`), setStatus: value => events.push(`status:${value}`),
    setData: value => { assert.equal(value, payload); events.push("data"); },
    load: async () => { throw new Error("No alternate visit was selected"); },
    onChanged: async () => { events.push("changed"); await changed(); },
  });
  return {
    events, requests,
    async submit() {
      const event = { preventDefault() {}, currentTarget: form };
      if (kind === "upload") await handler(event);
      else await handler(event, "add_signoff", "Digital sign-off recorded.");
    },
  };
}

for (const kind of ["upload", "sign-off"]) {
  test(`successful ${kind} notifies the parent and invalidates the Files list`, async () => {
    const h = workspaceHarness();
    const before = h.render();
    const beforeFiles = component(before, "TradeJobFilesPanel");
    const mutation = mutationHarness(kind, { changed: component(before, "TradeFieldWorkPanel").props.onChanged });
    await mutation.submit();
    assert.equal(mutation.requests.length, 1);
    assert.equal(mutation.requests[0].url, "/api/trade-field-work");
    assert.equal(mutation.requests[0].init.method, "POST");
    assert.ok(mutation.events.indexOf("changed") > mutation.events.indexOf("data"));
    assert.deepEqual(h.reloads, ["job-1"]);
    assert.notEqual(component(h.render(), "TradeJobFilesPanel").key, beforeFiles.key,
      "The mounted Files list must reload even before the refreshed job revision arrives");
    if (kind === "upload") assert.equal(mutation.requests[0].init.body.get("workOrderId"), "job-1");
    else assert.deepEqual(JSON.parse(mutation.requests[0].init.body), {
      action: "add_signoff", workOrderId: "job-1", signerName: "Test technician", signerRole: "technician", confirmed: true,
    });
  });

  test(`rejected or read-only ${kind} never signals a successful file refresh`, async () => {
    const rejected = mutationHarness(kind, { failed: true });
    await rejected.submit();
    assert.equal(rejected.requests.length, 1);
    assert.ok(rejected.events.includes("status:Server rejected this change"));
    assert.ok(!rejected.events.includes("changed"));
    assert.ok(!rejected.events.includes("reset"));
    const readOnly = mutationHarness(kind, { readOnly: true });
    await readOnly.submit();
    assert.equal(readOnly.requests.length, 0);
    assert.ok(!readOnly.events.includes("changed"));
  });
}
