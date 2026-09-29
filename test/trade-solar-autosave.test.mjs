import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";

const source = fs.readFileSync(new URL("../src/components/useTradeSolarDesign.ts", import.meta.url), "utf8");
const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText.replaceAll('require("./TradeBusinessProvider")', '({ useTradeBusinessFetch: () => fetch, useTradeBusiness: () => null })');
const flush = () => new Promise(resolve => setImmediate(resolve));
const draft = (title = "Roof A") => ({ title, panels: [{ id: 1 }], equipment: [], installationNotes: "", center: { lat: -37, lng: 145 }, zoom: 20, customerId: "customer-a", workOrderId: "job-a" });
const persisted = (input, id, revision) => ({ ...input, id, revision, createdAt: "2026-09-27", updatedAt: "2026-09-27" });

function harness(t, handler) {
  let cursor = 0, uuid = 0;
  const slots = [], effects = [], requests = [], timers = new Map(), events = new Map();
  const react = {
    useRef(initial) { const index = cursor++; return slots[index] ??= { current: initial }; },
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = initial; return [slots[index], value => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }]; },
    useCallback(callback) { cursor++; return callback; },
    useEffect(callback) { const index = cursor++; if (!effects[index]) effects[index] = { cleanup: callback() }; },
  };
  const exports = {};
  Function("require", "exports", "fetch", "crypto", "setTimeout", "clearTimeout", "window", code)(
    () => react, exports, async (_url, options) => {
      const body = JSON.parse(options.body); requests.push(body);
      return handler(body, requests.length);
    }, { randomUUID: () => `generated-${++uuid}` }, callback => { const id = Symbol(); timers.set(id, callback); return id; }, id => timers.delete(id),
    { addEventListener: (name, callback) => events.set(name, callback), removeEventListener: name => events.delete(name) },
  );
  const user = { getIdToken: async () => "test-token" };
  const render = () => { cursor = 0; return exports.useTradeSolarDesign(user, true); };
  t.after(() => { for (const effect of effects) effect?.cleanup?.(); });
  return { render, requests, events };
}
const success = (body, revision = body.expectedRevision + 1) => ({ ok: true, status: 200, json: async () => ({ ok: true, design: persisted(body.design, body.id, revision) }) });

test("autosave serialises edits arriving during a save before navigation can finish", async t => {
  let resolveFirst;
  const h = harness(t, (body, count) => count === 1 ? new Promise(resolve => { resolveFirst = () => resolve(success(body)); }) : success(body));
  const hook = h.render(); hook.update(draft());
  const saving = hook.ensureSaved(); await flush();
  hook.update(draft("Latest roof"));
  const concurrent = hook.ensureSaved();
  assert.equal(h.requests.length, 1);
  resolveFirst();
  const result = await saving; await concurrent;
  assert.equal(h.requests.length, 2);
  assert.equal(h.requests[0].id, h.requests[1].id);
  assert.equal(h.requests[1].expectedRevision, 1);
  assert.equal(result.title, "Latest roof"); assert.equal(result.revision, 2);
  assert.equal(h.render().status, "Saved");
});

test("uncertain create retries reuse the same identity and retain unsaved-exit protection", async t => {
  const h = harness(t, (body, count) => count === 1 ? Promise.reject(new Error("offline")) : success(body));
  const hook = h.render(); hook.update(draft());
  await assert.rejects(hook.ensureSaved(), /offline/);
  assert.equal(h.render().status, "Not saved");
  let warned = false;
  h.events.get("beforeunload")({ preventDefault() { warned = true; } }); assert.equal(warned, true);
  await hook.ensureSaved();
  assert.equal(h.requests[1].id, h.requests[0].id); assert.equal(h.requests[1].expectedRevision, 0);
  warned = false; h.events.get("beforeunload")({ preventDefault() { warned = true; } }); assert.equal(warned, false);
});

test("a delayed response cannot replace a newly opened saved design", async t => {
  let resolve;
  const h = harness(t, body => new Promise(done => { resolve = () => done(success(body)); }));
  const hook = h.render(); hook.update(draft());
  const pending = hook.ensureSaved(); await flush();
  const next = persisted(draft("Roof B"), "design-b", 8);
  hook.accept(next); resolve(); await pending;
  assert.equal(h.render().design.id, "design-b"); assert.equal(h.render().design.revision, 8);
  await hook.ensureSaved(); assert.equal(h.requests.length, 1);
});

test("saving a conflict copy keeps geometry and creates a separate unlinked design", async t => {
  const h = harness(t, (body, count) => count === 1 ? ({ ok: false, status: 409, json: async () => ({ ok: false }) }) : success(body));
  const hook = h.render(); hook.accept(persisted(draft(), "original", 3)); hook.update(draft("Changed roof"));
  await assert.rejects(hook.ensureSaved(), /changed elsewhere/);
  const copy = await hook.saveCopy();
  assert.notEqual(copy.id, "original"); assert.equal(copy.revision, 1); assert.equal(copy.title, "Changed roof (copy)");
  assert.deepEqual(copy.panels, [{ id: 1 }]); assert.equal(copy.customerId, ""); assert.equal(copy.workOrderId, "");
  assert.equal(h.requests[1].expectedRevision, 0);
});
