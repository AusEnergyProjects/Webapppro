import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";
import { createTradeBusinessFetch } from "../src/lib/trade-business-client.ts";

const read = name => fs.readFileSync(new URL(`../src/components/${name}`, import.meta.url), "utf8");
const compile = source => ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
} }).outputText;
const code = compile(read("TradeTrainingSummary.tsx"));
const text = node => node == null || typeof node === "boolean" ? "" : typeof node === "string" || typeof node === "number"
  ? String(node) : Array.isArray(node) ? node.map(text).join(" ").replace(/\s+/g, " ") : text(node.props?.children);
function nodes(node, predicate) { if (!node || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap(child => nodes(child, predicate));
  return [...(predicate(node) ? [node] : []), ...nodes(node.props?.children, predicate)]; }
const button = (tree, label) => nodes(tree, node => node.type === "button" && text(node) === label)[0];
const tick = () => new Promise(resolve => setImmediate(resolve));
const makeModule = (id = "insulation", extra = {}) => ({ id, title: `Course ${id}`, programCode: "VEU", status: "required",
  assessmentAvailable: true, assessmentUnavailableReason: "", completion: null, ...extra });
const result = (extra = {}) => ({ ok: true, memberId: "member-one", canTakeTraining: true, officeOnly: false,
  selectedMember: { memberId: "member-one", isSelf: true, isOwner: true },
  business: { status: "not_started", approved: false, blockedReasons: ["Complete the signed Creditex agreement"] },
  modules: [makeModule()], unavailableActivities: [], ...extra });
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }

function harness(responder = async () => result(), { business = { ownerUid: "owner-one", role: "member" },
  user = { uid: "actor-one", getIdToken: async () => "synthetic-token" } } = {}) {
  let cursor = 0, scopedFetch;
  const state = [], effects = [], pending = [], requests = [], opened = [];
  const timers = new Map(); let timerId = 0;
  const setTimeout = (callback, delay) => { const id = ++timerId; timers.set(id, { callback, delay }); return id; };
  const clearTimeout = id => timers.delete(id);
  const props = { user, onOpenTraining: () => opened.push(true) };
  const hooks = {
    useState(value) { const i = cursor++; if (!(i in state)) state[i] = typeof value === "function" ? value() : value;
      return [state[i], next => { state[i] = typeof next === "function" ? next(state[i]) : next; }]; },
    useEffect(callback, deps) { const i = cursor++; const old = effects[i];
      if (!old || deps.some((value, index) => !Object.is(value, old.deps[index]))) {
        effects[i] = { deps }; pending.push(() => { old?.cleanup?.(); effects[i].cleanup = callback(); });
      } },
  };
  const request = async (input, init) => { requests.push({ input, init }); const next = await responder(input, init);
    return next instanceof Response ? next : Response.json(next); };
  function setBusiness(next) { business = next; scopedFetch = business ? createTradeBusinessFetch(business.ownerUid, "https://tlink.test", request) : request; }
  setBusiness(business);
  const imports = { react: hooks, "react/jsx-runtime": jsx,
    "./TradeBusinessProvider": { useTradeBusiness: () => business, useTradeBusinessFetch: () => scopedFetch },
    "./TradeTrainingSummary.module.css": { default: new Proxy({}, { get: (_target, key) => String(key) }) },
  };
  const output = {};
  Function("require", "exports", "setTimeout", "clearTimeout", code)(id => { assert.ok(id in imports, id); return imports[id]; }, output, setTimeout, clearTimeout);
  const render = () => { cursor = 0; return output.TradeTrainingSummary(props); };
  const runEffects = () => { for (const effect of pending.splice(0)) effect(); };
  async function settle() { let tree; for (let i = 0; i < 5; i++) { tree = render(); runEffects(); await tick(); } return tree; }
  return { render, runEffects, settle, requests, opened, props, setBusiness, timers,
    expireRead: () => { for (const [id, timer] of [...timers]) { timers.delete(id); timer.callback(); } },
    unmount: () => { for (const effect of effects) effect?.cleanup?.(); } };
}

test("Tasks shows canonical self training and Creditex setup without creating manual tasks", async () => {
  const modules = Array.from({ length: 142 }, (_, index) => makeModule(String(index)));
  modules[0] = makeModule("saved-draughtsealing", { status: "passed", completion: { reference: "RETAINED-PASS", expiresAt: "2027-01-01" } });
  const h = harness(async () => result({ modules })); const tree = await h.settle();
  assert.match(text(tree), /141 modules to do/);
  assert.match(text(tree), /1 of 142 modules passed/);
  assert.match(text(tree), /138 more assigned modules/);
  assert.match(text(tree), /Creditex business setup Finish setup/);
  assert.match(text(tree), /Complete the signed Creditex agreement/);
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].input, "/api/trade-training");
  assert.equal(new Headers(h.requests[0].init.headers).get("Authorization"), "Bearer synthetic-token");
  assert.equal(new Headers(h.requests[0].init.headers).get("X-TLink-Business"), "owner-one");
  assert.equal(h.requests[0].init.cache, "no-store");
  assert.equal(h.requests[0].init.method, undefined);
  assert.equal(nodes(tree, node => node.type === "form").length, 0);
  button(tree, "Open my training").props.onClick(); assert.equal(h.opened.length, 1);
});

test("saved passes remain passed while expired, revoked and unavailable activities need attention", async () => {
  const h = harness(async () => result({
    modules: [makeModule("passed", { status: "passed", assessmentAvailable: false,
      completion: { reference: "KEPT-PASS", expiresAt: "2027-01-01" } }),
      makeModule("expired", { status: "expired" }), makeModule("revoked", { status: "revoked" }),
      makeModule("pending", { status: "awaiting_review", assessmentAvailable: false })],
    unavailableActivities: [{ id: "no-course", title: "Unsupported activity", programCode: "VEU", message: "No curriculum" }],
    business: { status: "approved", approved: true, blockedReasons: [] },
  }));
  const tree = await h.settle();
  assert.match(text(tree), /3 modules to do/); assert.match(text(tree), /1 of 4 modules passed/);
  assert.match(text(tree), /Pass expired/); assert.match(text(tree), /Pass revoked/);
  assert.match(text(tree), /3 activity assessments are unavailable/);
  assert.match(text(tree), /Setup complete/);
  assert.doesNotMatch(text(tree), /Finish setup/);
});

test("empty assigned course list is explicit and does not imply completed programme requirements", async () => {
  const h = harness(async () => result({ modules: [] })); const tree = await h.settle();
  assert.match(text(tree), /No activity modules match your saved services and service regions/);
  assert.match(text(tree), /empty list does not approve government program work/);
  assert.match(text(tree), /Finish setup/);
  assert.doesNotMatch(text(tree), /assigned learning passes are current/);
});

test("all current passes link to retained learning records while business setup stays separate", async () => {
  const h = harness(async () => result({ modules: [makeModule("passed", { status: "passed",
    completion: { reference: "RETAINED-PASS", expiresAt: "2027-01-01" } })] }));
  const tree = await h.settle(); assert.match(text(tree), /0 modules to do/);
  assert.match(text(tree), /1 of 1 modules passed/);
  assert.match(text(tree), /review your saved learning and completion records/);
  assert.match(text(tree), /Finish setup/);
  assert.match(text(tree), /does not replace business setup, insurance, licences or job evidence/);
});

test("a saved pass remains passed when its current course is unavailable and programme work remains blocked", async () => {
  const h = harness(async () => result({ modules: [makeModule("withdrawn", { status: "passed", assessmentAvailable: false,
    completion: { reference: "RETAINED-PASS", expiresAt: "2027-01-01" } })] }));
  const tree = await h.settle();
  assert.match(text(tree), /0 modules to do/); assert.match(text(tree), /1 of 1 modules passed/);
  assert.match(text(tree), /1 activity assessment is unavailable/);
  assert.match(text(tree), /These activities remain blocked until their requirements are met/);
});

test("activities without any curriculum stay visible as unavailable instead of being reported complete", async () => {
  const h = harness(async () => result({ modules: [], unavailableActivities: [
    { id: "no-course", title: "Unsupported activity", programCode: "VEU", message: "No curriculum" },
  ] }));
  const tree = await h.settle();
  assert.match(text(tree), /1 activity assessment is unavailable/);
  assert.doesNotMatch(text(tree), /assigned learning passes are current|No activity modules match/);
});

test("office-only staff see truthful setup status without installation course counts or private document editing", async () => {
  const h = harness(async () => result({ officeOnly: true, modules: [],
    selectedMember: { memberId: "member-one", isSelf: true, isOwner: false } }));
  const tree = await h.settle(); assert.match(text(tree), /No installation training needed/);
  assert.match(text(tree), /business and the technician doing the work still need to meet the activity requirements/);
  assert.match(text(tree), /business owner manages Creditex onboarding and private documents/);
  assert.doesNotMatch(text(tree), /modules to do|0 of 0|Open My training, then Creditex onboarding to finish/);
  assert.equal(nodes(tree, node => node.type === "input" || node.type === "form").length, 0);
});

test("loading and request failures never show fabricated zero completion and refresh uses canonical data", async () => {
  let fail = true;
  const waiting = deferred();
  const h = harness(async () => { await waiting.promise; return fail ? Response.json({ ok: false, error: "Training service unavailable" }, { status: 503 }) : result(); });
  let tree = h.render(); h.runEffects(); await tick();
  assert.match(text(tree), /Loading your saved training/);
  assert.doesNotMatch(text(tree), /modules to do|modules passed|Finish setup/);
  waiting.resolve(); tree = await h.settle();
  assert.match(text(tree), /Training service unavailable/);
  assert.doesNotMatch(text(tree), /modules to do|modules passed/);
  fail = false; button(tree, "Try again").props.onClick(); tree = await h.settle();
  assert.match(text(tree), /1 module to do/); assert.equal(h.requests.length, 2);
  button(tree, "Refresh training").props.onClick(); tree = await h.settle();
  assert.equal(h.requests.length, 3); assert.match(text(tree), /1 module to do/);
});

test("non-self or mismatched member responses fail closed without displaying another learner", async () => {
  for (const extra of [
    { selectedMember: { memberId: "other", isSelf: true, isOwner: false } },
    { selectedMember: { memberId: "member-one", isSelf: false, isOwner: false } },
    { canTakeTraining: false },
  ]) {
    const h = harness(async () => result({ modules: [makeModule("PRIVATE-OTHER")], ...extra }));
    const tree = await h.settle(); assert.match(text(tree), /own training status could not be confirmed/);
    assert.doesNotMatch(text(tree), /PRIVATE-OTHER|modules passed/);
  }
  const mismatch = harness(async () => result({ modules: [makeModule("PRIVATE-OTHER")] }), {
    business: { ownerUid: "owner-one", memberId: "expected-member", role: "member" },
  });
  assert.match(text(await mismatch.settle()), /own training status could not be confirmed/);
  assert.doesNotMatch(text(mismatch.render()), /PRIVATE-OTHER/);
});

test("business switch hides saved prior-scope data immediately and ignores delayed old responses", async () => {
  const old = deferred(); let requests = 0;
  const h = harness(async () => ++requests === 1 ? old.promise : result({ modules: [makeModule("NEW-BUSINESS")] }));
  h.render(); h.runEffects(); await tick();
  h.setBusiness({ ownerUid: "owner-two", role: "member" });
  let tree = await h.settle(); assert.match(text(tree), /NEW-BUSINESS/);
  assert.equal(h.requests[0].init.signal.aborted, true);
  assert.equal(new Headers(h.requests[1].init.headers).get("X-TLink-Business"), "owner-two");
  old.resolve(result({ modules: [makeModule("PRIVATE-OLD-BUSINESS")] })); await tick();
  tree = h.render(); assert.match(text(tree), /NEW-BUSINESS/); assert.doesNotMatch(text(tree), /PRIVATE-OLD-BUSINESS/);
  h.setBusiness({ ownerUid: "owner-three", role: "member" });
  tree = h.render(); assert.doesNotMatch(text(tree), /NEW-BUSINESS/); assert.match(text(tree), /Loading your saved training/);
});

test("actor changes hide previous completion immediately and cancelled token acquisition cannot fetch", async () => {
  const token = deferred();
  const h = harness(async () => result({ modules: [makeModule("NEW-ACTOR")] }), { user: { uid: "actor-old", getIdToken: () => token.promise } });
  h.render(); h.runEffects(); await tick();
  h.props.user = { uid: "actor-new", getIdToken: async () => "new-token" };
  let tree = await h.settle(); assert.match(text(tree), /NEW-ACTOR/);
  token.resolve("old-token"); await tick(); tree = h.render();
  assert.equal(h.requests.length, 1);
  assert.equal(new Headers(h.requests[0].init.headers).get("Authorization"), "Bearer new-token");
  h.props.user = { uid: "another-actor", getIdToken: async () => "another-token" };
  assert.doesNotMatch(text(h.render()), /NEW-ACTOR/);
});

test("a changed member context within the same business hides the previous member projection immediately", async () => {
  const h = harness(async () => result(), { business: { ownerUid: "owner-one", memberId: "member-one", role: "member" } });
  assert.match(text(await h.settle()), /1 module to do/);
  h.setBusiness({ ownerUid: "owner-one", memberId: "member-two", role: "member" });
  const tree = h.render();
  assert.match(text(tree), /Loading your saved training/); assert.doesNotMatch(text(tree), /1 module to do/);
});

test("unmount aborts the current self projection without accepting its delayed result", async () => {
  const waiting = deferred(); const h = harness(() => waiting.promise);
  h.render(); h.runEffects(); await tick(); h.unmount();
  assert.equal(h.requests[0].init.signal.aborted, true);
  assert.equal(h.timers.size, 0);
  waiting.resolve(result({ modules: [makeModule("UNMOUNTED")] })); await tick();
  assert.doesNotMatch(text(h.render()), /UNMOUNTED/);
});

test("a stalled read stops loading after 25 seconds, ignores its late result and retries only on request", async () => {
  const stalled = deferred(); let count = 0;
  const h = harness(() => ++count === 1 ? stalled.promise : result({ modules: [makeModule("RETRY-COURSE")] }));
  h.render(); h.runEffects(); await tick();
  assert.deepEqual([...h.timers.values()].map(timer => timer.delay), [25000]);
  h.expireRead(); let tree = await h.settle();
  assert.match(text(tree), /Loading your training and setup status took too long/);
  assert.equal(h.requests[0].init.signal.aborted, true);
  assert.equal(h.requests.length, 1);
  assert.equal(h.timers.size, 0);
  assert.ok(button(tree, "Try again"));
  stalled.resolve(result({ modules: [makeModule("PRIVATE-LATE-RESULT")] })); await tick();
  assert.doesNotMatch(text(h.render()), /PRIVATE-LATE-RESULT/);
  button(tree, "Try again").props.onClick(); tree = await h.settle();
  assert.match(text(tree), /RETRY-COURSE/); assert.equal(h.requests.length, 2);
  assert.equal(h.timers.size, 0);
});

test("a token that arrives after the read deadline cannot start a background training request", async () => {
  const token = deferred();
  const h = harness(async () => result(), { user: { uid: "actor", getIdToken: () => token.promise } });
  h.render(); h.runEffects(); await tick(); h.expireRead();
  assert.match(text(await h.settle()), /took too long/);
  token.resolve("late-token"); await tick();
  assert.equal(h.requests.length, 0); assert.equal(h.timers.size, 0);
});

test("Tasks and training composes the canonical summary above manual tasks and opens the existing training page", () => {
  const tabs = [], output = {};
  const imports = { "react/jsx-runtime": jsx,
    "next/dynamic": { default: () => "TrainingWorkspace" },
    "./TradeTasksWorkspace": { TradeTasksWorkspace: "ManualTasks" },
    "./TradeTrainingSummary": { TradeTrainingSummary: "TrainingSummary" },
    "./TradeTasksWorkspace.module.css": { default: {} },
  };
  Function("require", "exports", compile(read("TradeTasksAndTraining.tsx")))(id => { assert.ok(id in imports, id); return imports[id]; }, output);
  const user = { uid: "actor" };
  let tree = output.TradeTasksAndTraining({ user, tab: "tasks", onTab: tab => tabs.push(tab) });
  assert.deepEqual(nodes(tree, node => node.type === "TrainingSummary" || node.type === "ManualTasks").map(node => node.type), ["TrainingSummary", "ManualTasks"]);
  nodes(tree, node => node.type === "TrainingSummary")[0].props.onOpenTraining(); assert.deepEqual(tabs, ["training"]);
  tree = output.TradeTasksAndTraining({ user, tab: "training", onTab: tab => tabs.push(tab) });
  assert.equal(nodes(tree, node => node.type === "TrainingWorkspace")[0].props.user, user);
  assert.equal(nodes(tree, node => node.type === "TrainingSummary" || node.type === "ManualTasks").length, 0);
});
