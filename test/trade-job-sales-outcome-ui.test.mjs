import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";

const source = fs.readFileSync(new URL("../src/components/TradeJobSalesOutcomeDialog.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
} }).outputText;
const nodes = (tree, predicate) => !tree || typeof tree !== "object" ? [] : Array.isArray(tree)
  ? tree.flatMap(child => nodes(child, predicate))
  : [...(predicate(tree) ? [tree] : []), ...nodes(tree.props?.children, predicate)];
const text = tree => tree == null || typeof tree === "boolean" ? "" : typeof tree !== "object" ? String(tree)
  : Array.isArray(tree) ? tree.map(text).join("") : text(tree.props?.children);
const button = (tree, label) => nodes(tree, node => node.type === "button" && text(node) === label)[0];
const form = tree => nodes(tree, node => node.type === "form")[0];
const flush = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
const submit = tree => {
  let prevented = false;
  const saved = form(tree).props.onSubmit({ preventDefault() { prevented = true; } });
  assert.equal(prevented, true, "Submission stays inside the dialog");
  return saved;
};

// Run production handlers with isolated React hooks, dialog APIs and the authenticated transport.
function harness(request = async () => Response.json({ ok: true }), options = {}) {
  const slots = [], effects = [], requests = [], callbacks = [];
  let cursor = 0;
  class Element {
    isConnected = true;
    focusCount = 0;
    focus() { this.focusCount++; }
  }
  const previousFocus = new Element();
  const dialog = { open: false, showCount: 0, closeCount: 0,
    showModal() { this.open = true; this.showCount++; },
    close() { this.open = false; this.closeCount++; } };
  const hooks = {
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = { value: typeof initial === "function" ? initial() : initial };
      return [slots[index].value, next => { slots[index].value = typeof next === "function" ? next(slots[index].value) : next; }];
    },
    useRef(initial) { const index = cursor++; if (!(index in slots)) slots[index] = { current: initial }; return slots[index]; },
    useId() { return `sales-dialog-${cursor++}`; },
    useEffect(effect, dependencies) {
      const index = cursor++;
      if (!slots[index] || dependencies.some((value, i) => !Object.is(value, slots[index].dependencies[i]))) {
        slots[index]?.cleanup?.();
        slots[index] = { dependencies };
        effects.push(() => { slots[index].cleanup = effect(); });
      }
    },
  };
  const fetch = async (url, init) => { requests.push({ url, ...init }); return request(url, init); };
  const mocks = {
    react: hooks, "react/jsx-runtime": jsx,
    "./TradeBusinessProvider": { useTradeBusinessFetch: () => fetch },
    "./InstallerCrmJobRegister.module.css": { default: { paymentDialog: "paymentDialog" } },
  };
  const exports = {};
  Function("require", "exports", "document", "HTMLElement", compiled)(specifier => {
    assert.ok(specifier in mocks, `Unexpected dependency: ${specifier}`); return mocks[specifier];
  }, exports, { activeElement: previousFocus }, Element);
  const props = {
    user: { getIdToken: options.getIdToken || (async () => "staff-token") },
    job: { id: "job-7", workNumber: "TLJ-007", title: "Customer upgrade", revision: 17, pipelineStage: "quoting", ...options.job },
    onClose: () => callbacks.push(["close"]), onSaved: reopened => callbacks.push(["saved", reopened]),
  };
  const render = () => {
    cursor = 0;
    const tree = exports.TradeJobSalesOutcomeDialog(props);
    tree.props.ref.current = dialog;
    effects.splice(0).forEach(run => run());
    return tree;
  };
  return { render, requests, callbacks, dialog, previousFocus,
    cleanup() { slots.forEach(slot => slot?.cleanup?.()); } };
}

test("mark lost submits the exact job revision and trimmed optional reason", async t => {
  const h = harness(); t.after(() => h.cleanup());
  let tree = h.render();
  const input = nodes(tree, node => node.type === "input")[0];
  assert.equal(input.props.required, undefined); assert.equal(input.props.maxLength, 500);
  input.props.onChange({ target: { value: "  Customer chose another business  " } });
  tree = h.render(); await submit(tree);
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].url, "/api/trade-crm"); assert.equal(h.requests[0].method, "PATCH");
  assert.deepEqual(h.requests[0].headers, { Authorization: "Bearer staff-token", "Content-Type": "application/json" });
  assert.deepEqual(JSON.parse(h.requests[0].body), {
    action: "mark_job_lost", workOrderId: "job-7", expectedRevision: 17, reason: "Customer chose another business",
  });
  assert.deepEqual(h.callbacks, [["saved", false]]);
  assert.equal(nodes(h.render(), node => node.props?.role === "alert").length, 0);
});

test("mark lost accepts an omitted reason without inventing one", async t => {
  const h = harness(); t.after(() => h.cleanup());
  const tree = h.render();
  await submit(tree);
  assert.deepEqual(JSON.parse(h.requests[0].body), {
    action: "mark_job_lost", workOrderId: "job-7", expectedRevision: 17, reason: "",
  });
  assert.deepEqual(h.callbacks, [["saved", false]]);
});

test("reopen submits only the reopen action, job and expected revision", async t => {
  const h = harness(undefined, { job: { pipelineStage: "lost", revision: 23 } }); t.after(() => h.cleanup());
  const tree = h.render();
  assert.equal(nodes(tree, node => node.type === "input").length, 0);
  assert.ok(button(tree, "Reopen opportunity"));
  await submit(tree);
  assert.deepEqual(JSON.parse(h.requests[0].body), { action: "reopen_lost_job", workOrderId: "job-7", expectedRevision: 23 });
  assert.deepEqual(h.callbacks, [["saved", true]]);
});

test("server and transport failures leave the dialog open with no saved callback", async t => {
  const failures = [
    { name: "revision conflict", request: async () => Response.json({ ok: false, error: "The job changed. Reload it first." }, { status: 409 }), message: /The job changed\. Reload it first\./ },
    { name: "unsuccessful response body", request: async () => Response.json({ ok: false, error: "This job has accepted work." }), message: /This job has accepted work\./ },
    { name: "malformed response", request: async () => new Response("Unavailable", { status: 503 }), message: /The opportunity could not be updated\./ },
    { name: "network failure", request: async () => { throw new Error("Connection unavailable"); }, message: /Connection unavailable/ },
  ];
  for (const item of failures) await t.test(item.name, async () => {
    const h = harness(item.request);
    try {
      let tree = h.render();
      nodes(tree, node => node.type === "input")[0].props.onChange({ target: { value: "Keep this reason" } });
      await submit(h.render()); tree = h.render();
      assert.equal(h.dialog.open, true); assert.deepEqual(h.callbacks, []);
      assert.match(text(nodes(tree, node => node.props?.role === "alert")[0]), item.message);
      assert.equal(nodes(tree, node => node.type === "input")[0].props.value, "Keep this reason");
      assert.equal(form(tree).props["aria-busy"], false); assert.equal(button(tree, "Mark as lost").props.disabled, false);
    } finally { h.cleanup(); }
  });
});

test("rapid submissions while obtaining a token and saving make one request and one successful callback", async t => {
  const token = deferred(), response = deferred();
  const h = harness(() => response.promise, { getIdToken: () => token.promise }); t.after(() => h.cleanup());
  const original = h.render();
  const saving = submit(original);
  await submit(original);
  assert.equal(h.requests.length, 0);
  token.resolve("staff-token"); await flush();
  assert.equal(h.requests.length, 1);
  const pending = h.render();
  assert.equal(form(pending).props["aria-busy"], true); assert.equal(button(pending, "Saving...").props.disabled, true);
  await submit(pending);
  response.resolve(Response.json({ ok: true })); await saving;
  assert.equal(h.requests.length, 1); assert.deepEqual(h.callbacks, [["saved", false]]);
});

test("pending saves cannot be cancelled by the button or Escape, including stale handlers", async t => {
  const response = deferred();
  const h = harness(() => response.promise); t.after(() => h.cleanup());
  const original = h.render();
  const saving = submit(original); await flush();
  const pending = h.render();
  assert.equal(button(pending, "Cancel").props.disabled, true);
  button(original, "Cancel").props.onClick(); button(pending, "Cancel").props.onClick();
  let prevented = 0;
  original.props.onCancel({ preventDefault() { prevented++; } });
  pending.props.onCancel({ preventDefault() { prevented++; } });
  assert.equal(prevented, 2, "Escape cannot close the native dialog during the request");
  assert.equal(h.dialog.open, true); assert.deepEqual(h.callbacks, []);
  response.resolve(Response.json({ ok: false, error: "Please reload this job." }, { status: 409 })); await saving;
  const failed = h.render();
  assert.equal(button(failed, "Cancel").props.disabled, false);
  failed.props.onCancel({ preventDefault() {} });
  assert.deepEqual(h.callbacks, [["close"]], "Escape is available again after a failed save");
});

test("retrying a failed save calls onSaved only for the acknowledged retry", async t => {
  let attempts = 0;
  const h = harness(async () => ++attempts === 1
    ? Response.json({ ok: false, error: "Try again after refreshing." }, { status: 409 }) : Response.json({ ok: true }));
  t.after(() => h.cleanup());
  await submit(h.render()); assert.deepEqual(h.callbacks, []);
  await submit(h.render());
  assert.equal(h.requests.length, 2); assert.deepEqual(h.callbacks, [["saved", false]]);
  assert.equal(nodes(h.render(), node => node.props?.role === "alert").length, 0);
});

test("native dialog opens once and restores the launching control when removed", () => {
  const h = harness();
  const tree = h.render(); h.render();
  assert.equal(h.dialog.open, true); assert.equal(h.dialog.showCount, 1);
  assert.notEqual(tree.props["aria-labelledby"], tree.props["aria-describedby"]);
  button(tree, "Cancel").props.onClick(); assert.deepEqual(h.callbacks, [["close"]]);
  assert.equal(h.requests.length, 0);
  h.cleanup();
  assert.equal(h.dialog.open, false); assert.equal(h.previousFocus.focusCount, 1);
});
