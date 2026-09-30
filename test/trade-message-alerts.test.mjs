import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";

const read = path => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const source = read("../src/components/TradeMessageAlerts.tsx");
const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const saveOutput = ts.transpileModule(read("../src/components/TradeMessageSaveToJob.tsx"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const tick = () => new Promise(resolve => setImmediate(resolve));
const nodes = (node, predicate) => !node || typeof node !== "object" ? [] : Array.isArray(node)
  ? node.flatMap(item => nodes(item, predicate)) : [...(predicate(node) ? [node] : []), ...nodes(node.props?.children, predicate)];
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const thread = (id, sequence = 1, unread = 1) => ({ id, sequence, unread, name: `Chat ${id}`, latestAt: "2026-09-29T00:00:00Z" });
const result = threads => Response.json({ ok: true, unreadCount: threads.reduce((n, row) => n + row.unread, 0), threads });
const text = node => node == null || typeof node === "boolean" ? "" : typeof node !== "object" ? String(node) : Array.isArray(node) ? node.map(text).join(" ") : text(node.props?.children);
const button = (tree, label) => nodes(tree, node => node.type === "button" && text(node) === label)[0];

function harness(options = {}) {
  let cursor = 0, state = [], effects = [], key, generation = 0, mounted = true, lateWrites = 0;
  let ownerUid = "owner-a", user = { uid: "user-a", getIdToken: async () => "token-a" }, enabled = true, children = "Jobs";
  let getAuthHeaders = options.auth;
  const pending = [], timers = new Map(), requests = [], reads = [], receipts = [], events = [], opened = [];
  const listeners = { window: new Map(), document: new Map() };
  const changed = (a, b) => !a || a.length !== b.length || a.some((value, index) => value !== b[index]);
  const react = {
    useId() { return `id-${cursor++}`; },
    createContext: value => ({ Provider: Symbol("Provider"), value }), useContext: context => context.value,
    useState(initial) { const index = cursor++, owner = generation; if (!(index in state)) state[index] = initial;
      return [state[index], value => { if (!mounted || owner !== generation) { lateWrites++; return; } state[index] = typeof value === "function" ? value(state[index]) : value; }]; },
    useRef(initial) { const index = cursor++; return state[index] ||= { current: initial }; },
    useCallback(callback, dependencies) { const index = cursor++; if (!state[index] || changed(state[index].dependencies, dependencies)) state[index] = { dependencies, callback }; return state[index].callback; },
    useEffect(callback, dependencies) { const index = cursor++; if (!effects[index] || changed(effects[index].dependencies, dependencies)) {
      const prior = effects[index]; effects[index] = { dependencies }; pending.push(() => { prior?.cleanup?.(); effects[index].cleanup = callback(); });
    } },
  };
  const listen = target => ({ addEventListener(type, callback) { const callbacks = listeners[target].get(type) || new Set(); callbacks.add(callback); listeners[target].set(type, callbacks); },
    removeEventListener(type, callback) { listeners[target].get(type)?.delete(callback); } });
  const window = { ...listen("window"),
    setTimeout(callback, milliseconds) { const id = Symbol(); timers.set(id, { callback, milliseconds, interval: false }); return id; },
    clearTimeout(id) { timers.delete(id); },
    setInterval(callback, milliseconds) { const id = Symbol(); timers.set(id, { callback, milliseconds, interval: true }); return id; },
    clearInterval(id) { timers.delete(id); }, dispatchEvent(event) { events.push(event.type); return true; },
  };
  const document = { ...listen("document"), visibilityState: options.hidden ? "hidden" : "visible" };
  const scopedRequests = new Map();
  const businessFetch = owner => {
    if (!scopedRequests.has(owner)) scopedRequests.set(owner,async (url,init) => {
      const request = {url,init,owner}; requests.push(request);
      if (!options.save && init?.method === "POST" && JSON.parse(init.body).action === "delivered") {
        receipts.push(request); return options.deliver ? options.deliver(receipts.length,url,init) : Response.json({ok:true});
      }
      reads.push(request);return options.fetch ? options.fetch(reads.length,url,init) : result([]);
    });
    return scopedRequests.get(owner);
  };
  const dependencies = { react, "react/jsx-runtime": jsx, "./TradeBusinessProvider": { useTradeBusiness: () => ({ ownerUid }), useTradeBusinessFetch: () => businessFetch(ownerUid) },
    "./TradeMessageAlerts.module.css": { default: {} }, "./TradeMessageSaveToJob.module.css": { default: {} },
    "@/lib/trade-message-job-files": { messageLinks: () => ["https://example.com/"] } };
  const record = { exports: {} };
  new Function("require", "module", "exports", "window", "document", options.save ? saveOutput : output)(specifier => {
    assert.ok(Object.hasOwn(dependencies, specifier), specifier); return dependencies[specifier];
  }, record, record.exports, window, document);
  const onOpen = id => opened.push(id);
  const saveAuth = async () => ({ Authorization: "Bearer fixture" });
  function cleanup() { for (const effect of effects) effect?.cleanup?.(); }
  function render() {
    const wrapper = options.save ? { key: "save", type: record.exports.default, props: {
      threadId: "thread-a", message: { id: "message-a", body: "https://example.com/", attachments: [] }, getAuthHeaders: getAuthHeaders || saveAuth,
    } } : record.exports.TradeMessageAlerts({ user, getAuthHeaders, enabled, onOpen, children });
    if (key !== wrapper.key) {
      mounted = false; cleanup(); generation++; state = []; effects = []; pending.length = 0; key = wrapper.key; mounted = true;
    }
    cursor = 0;
    const tree = wrapper.type(wrapper.props);
    for (const effect of pending.splice(0)) effect();
    return tree;
  }
  return { render, requests, reads, receipts, events, opened, lateWrites: () => lateWrites,
    context: () => render().props.value,
    setChildren(value) { children = value; },
    identity({ owner = ownerUid, uid = user.uid } = {}) { ownerUid = owner; user = { uid, getIdToken: async () => `token-${uid}` }; },
    enable(value) { enabled = value; },
    auth(value) { getAuthHeaders = value; },
    visible(value) { document.visibilityState = value ? "visible" : "hidden"; for (const callback of listeners.document.get("visibilitychange") || []) callback(); },
    event(type) { for (const callback of listeners.window.get(type) || []) callback(); },
    run(milliseconds) { for (const [id, timer] of [...timers]) if (timer.milliseconds === milliseconds) { if (!timer.interval) timers.delete(id); timer.callback(); } },
    async settle() { let tree; for (let index = 0; index < 4; index++) { tree = render(); await tick(); } return tree; },
    unmount() { mounted = false; cleanup(); },
  };
}

test("global unread refresh remains active across workspace tabs and never writes read receipts", async () => {
  const h = harness({ fetch: async count => result([thread("a", count, count)]) });
  await h.settle(); h.run(0); await h.settle();
  assert.equal(h.context().unreadCount, 1);
  for (const [index, workspace] of ["Customers", "Map", "Finance", "Schedule"].entries()) {
    h.setChildren(workspace); await h.settle(); h.run(5000); await h.settle();
    assert.equal(h.context().unreadCount, index + 2);
  }
  assert.equal(h.reads.length, 5);
  assert.ok(h.reads.every(request => request.url === "/api/trade-messages?view=unread" && !request.init.method && !request.init.body));
  assert.deepEqual(h.receipts.map(request=>JSON.parse(request.init.body).action),Array(5).fill("delivered"));
  assert.equal(h.events.filter(event => event === "tlink:message-received").length, 4);
  h.unmount();
});

test("active conversation suppresses its alert while other chats still alert", async () => {
  let snapshot = [thread("active", 1, 2)];
  const h = harness({ fetch: async () => result(snapshot) });
  await h.settle(); h.context().setActiveThread("active"); h.run(0);
  let tree = await h.settle();
  assert.equal(nodes(tree, node => node.type === "aside").length, 0);
  assert.equal(h.context().unreadCount, 2);
  snapshot = [thread("active", 2, 3), thread("other", 1, 1)];
  h.run(5000); tree = await h.settle();
  assert.equal(nodes(tree, node => node.type === "aside").length, 1);
  assert.equal(h.events.length, 1);
  h.context().open("other"); await h.settle();
  h.context().open("other"); await h.settle();
  assert.deepEqual(h.opened, ["other", "other"]);
  assert.equal(h.context().unreadCount, 4, "opening is navigation, not a read receipt");
  h.unmount();
});

test("reading a thread clears its alert without replaying the same message chime later", async () => {
  let snapshot = [thread("a", 5, 1)];
  const h = harness({ fetch: async () => result(snapshot) });
  await h.settle(); h.run(0); await h.settle();
  snapshot = []; h.context().refresh(); let tree = await h.settle();
  assert.equal(h.context().unreadCount, 0); assert.equal(nodes(tree, node => node.type === "aside").length, 0);
  snapshot = [thread("a", 5, 1)]; h.context().refresh(); tree = await h.settle();
  assert.equal(h.events.length, 0); assert.equal(nodes(tree, node => node.type === "aside").length, 0);
  snapshot = [thread("a", 6, 1)]; h.context().refresh(); await h.settle();
  assert.deepEqual(h.events, ["tlink:message-received"]); h.unmount();
});

test("hidden tabs skip polls and visibility restoration refreshes without changing read state", async () => {
  const h = harness({ hidden: true, fetch: async () => result([thread("a", 1, 3)]) });
  await h.settle(); h.run(0); h.run(5000); h.context().refresh(); await h.settle();
  assert.equal(h.requests.length, 0);
  h.visible(true); await h.settle(); assert.equal(h.context().unreadCount, 3);
  h.visible(false); h.run(5000); await h.settle(); assert.equal(h.reads.length, 1);
  assert.ok(h.reads.every(request => !request.init.method && !request.init.body));
  assert.ok(h.receipts.every(request=>JSON.parse(request.init.body).action==="delivered")); h.unmount();
});

test("unmount aborts pending polls and late responses cannot update state or alert", async () => {
  const pending = deferred(); const h = harness({ fetch: () => pending.promise });
  await h.settle(); h.run(0); await h.settle();
  assert.equal(h.requests.length, 1); const signal = h.requests[0].init.signal;
  h.unmount(); assert.equal(signal.aborted, true);
  pending.resolve(result([thread("private-old-chat", 10, 10)])); await tick(); await tick();
  assert.equal(h.lateWrites(), 0); assert.deepEqual(h.events, []);
});

test("business and Firebase identity changes reset counts immediately and reject old responses", async () => {
  for (const change of [{ owner: "owner-b" }, { uid: "user-b" }]) {
    const pending = deferred(); const h = harness({ fetch: count => count === 1 ? Promise.resolve(result([thread("old", 3, 9)])) : count === 2 ? pending.promise : Promise.resolve(result([thread("new", 1, 2)])) });
    await h.settle(); h.run(0); await h.settle(); assert.equal(h.context().unreadCount, 9);
    h.context().refresh(); await h.settle();
    h.identity(change); await h.settle(); assert.equal(h.context().unreadCount, 0); assert.deepEqual(h.context().threads, []);
    pending.resolve(result([thread("old", 99, 99)])); await tick(); await tick();
    assert.equal(h.context().unreadCount, 0); assert.equal(h.lateWrites(), 0);
    h.run(0); await h.settle(); assert.equal(h.context().unreadCount, 2); assert.equal(h.context().threads[0].id, "new");
    h.unmount();
  }
});

test("poll deadlines cover stalled auth and network and allow a later refresh", async () => {
  for (const mode of ["auth", "network"]) {
    const pending = deferred(); let stalled = true;
    const h = harness({ auth: mode === "auth" ? () => stalled ? pending.promise : Promise.resolve({ Authorization: "Bearer fresh" }) : undefined,
      fetch: () => mode === "network" && stalled ? pending.promise : Promise.resolve(result([thread("a", 1, 1)])) });
    await h.settle(); h.run(0); await h.settle(); h.run(12000); await h.settle();
    assert.equal(h.context().unavailable, true);
    stalled = false; h.context().refresh(); await h.settle(); assert.equal(h.context().unavailable, false); assert.equal(h.context().unreadCount, 1);
    pending.resolve(mode === "auth" ? { Authorization: "Bearer old" } : result([thread("old", 9, 90)])); await h.settle();
    assert.equal(h.context().unreadCount, 1); h.unmount();
  }
});

test("disabled providers clear prior data and do not continue polling", async () => {
  const h = harness({ fetch: async () => result([thread("a", 1, 4)]) });
  await h.settle(); h.run(0); await h.settle(); assert.equal(h.context().unreadCount, 4);
  h.enable(false); await h.settle(); h.run(0); h.run(5000); await h.settle();
  assert.equal(h.context().unreadCount, 0); assert.equal(h.reads.length, 1); assert.equal(h.receipts.length,1); h.unmount();
});

test("delivery acknowledges only the fetched thread sequences and retains monotonic confirmation without reading",async()=>{
  let snapshot=[thread("thread-a",5,3),thread("thread-b",2,1)];
  const h=harness({fetch:async()=>result(snapshot)});await h.settle();h.run(0);await h.settle();
  assert.deepEqual(h.receipts.map(request=>JSON.parse(request.init.body)),[
    {action:"delivered",threadId:"thread-a",throughSequence:5},{action:"delivered",threadId:"thread-b",throughSequence:2},
  ]);
  assert.ok(h.receipts.every(request=>request.owner==="owner-a"&&request.init.headers.Authorization==="Bearer token-a"&&request.init.signal===h.reads[0].init.signal));
  h.context().refresh();await h.settle();assert.equal(h.receipts.length,2);
  snapshot=[thread("thread-a",4,2)];h.context().refresh();await h.settle();assert.equal(h.receipts.length,2);
  snapshot=[thread("thread-a",6,4)];h.context().refresh();await h.settle();assert.equal(h.receipts.length,3);
  assert.equal(JSON.parse(h.receipts[2].init.body).throughSequence,6);assert.equal(h.context().unreadCount,4);assert.equal(h.context().unavailable,false);h.unmount();
});

test("failed delivery acknowledgements retry on the next poll without hiding unread messages or reporting alert failure",async()=>{
  for(const failure of [()=>Response.json({ok:false},{status:503}),()=>Response.json({ok:false}),()=>{throw new Error("offline");}]){
    const h=harness({fetch:async()=>result([thread("thread-a",5,3)]),deliver:async count=>count===1?failure():Response.json({ok:true})});
    await h.settle();h.run(0);await h.settle();assert.equal(h.receipts.length,1);assert.equal(h.context().unreadCount,3);assert.equal(h.context().unavailable,false);
    h.context().refresh();await h.settle();assert.equal(h.receipts.length,2);assert.equal(h.context().unavailable,false);
    h.context().refresh();await h.settle();assert.equal(h.receipts.length,2);h.unmount();
  }
});

test("delivery batches cap work at twenty threads with at most two requests in flight",async()=>{
  const waiting=[];let active=0,maximum=0;
  const h=harness({fetch:async()=>result(Array.from({length:25},(_,i)=>thread(`thread-${i}`,i+1))),deliver:()=>new Promise(resolve=>{
    active++;maximum=Math.max(maximum,active);waiting.push(()=>{active--;resolve(Response.json({ok:true}));});
  })});
  await h.settle();h.run(0);await h.settle();assert.equal(h.receipts.length,2);
  while(waiting.length){waiting.splice(0).forEach(resolve=>resolve());await h.settle();}
  assert.equal(h.receipts.length,20);assert.equal(maximum,2);assert.equal(h.context().unreadCount,25);
  h.context().refresh();await h.settle();while(waiting.length){waiting.splice(0).forEach(resolve=>resolve());await h.settle();}
  assert.equal(h.receipts.length,25);assert.equal(new Set(h.receipts.map(request=>JSON.parse(request.init.body).threadId)).size,25);h.unmount();
});

test("delivery timeout shares the poll deadline, retains unread state and ignores its late response",async()=>{
  const delayed=deferred();let stalled=true;
  const h=harness({fetch:async()=>result([thread("thread-a",5,3)]),deliver:()=>stalled?delayed.promise:Response.json({ok:true})});
  await h.settle();h.run(0);await h.settle();const signal=h.receipts[0].init.signal;
  h.run(12000);await h.settle();assert.equal(signal.aborted,true);assert.equal(h.context().unavailable,false);assert.equal(h.context().unreadCount,3);
  stalled=false;h.context().refresh();await h.settle();assert.equal(h.receipts.length,2);
  delayed.resolve(Response.json({ok:true}));await h.settle();h.context().refresh();await h.settle();assert.equal(h.receipts.length,2);h.unmount();
});

test("unmount cancels delivery and cannot start the remainder of a received batch",async()=>{
  const delayed=deferred();const h=harness({fetch:async()=>result([thread("thread-a"),thread("thread-b"),thread("thread-c")]),deliver:()=>delayed.promise});
  await h.settle();h.run(0);await h.settle();assert.equal(h.receipts.length,2);
  h.unmount();assert.ok(h.receipts.every(request=>request.init.signal.aborted));
  delayed.resolve(Response.json({ok:true}));await tick();await tick();assert.equal(h.receipts.length,2);assert.equal(h.lateWrites(),0);
});

test("business or sign-in changes abort old delivery and reset confirmation for the new authenticated scope",async()=>{
  for(const change of [{owner:"owner-b"},{uid:"user-b"}]){
    const delayed=deferred();const h=harness({fetch:async()=>result([thread("thread-a",5)]),deliver:count=>count===1?delayed.promise:Response.json({ok:true})});
    await h.settle();h.run(0);await h.settle();const old=h.receipts[0];
    h.identity(change);await h.settle();assert.equal(old.init.signal.aborted,true);h.run(0);await h.settle();
    assert.equal(h.receipts.length,2);assert.equal(h.receipts[1].owner,change.owner||"owner-a");
    assert.equal(h.receipts[1].init.headers.Authorization,`Bearer token-${change.uid||"user-a"}`);
    delayed.resolve(Response.json({ok:true}));await h.settle();h.context().refresh();await h.settle();assert.equal(h.receipts.length,2);assert.equal(h.lateWrites(),0);h.unmount();
  }
});

test("a failed authenticated unread response cannot create a delivery acknowledgement",async()=>{
  const h=harness({fetch:async()=>Response.json({ok:false},{status:403})});await h.settle();h.run(0);await h.settle();
  assert.equal(h.receipts.length,0);assert.equal(h.context().unavailable,true);h.unmount();
});

test("all entry points preserve repeat-open navigation and native identity remounts", () => {
  for (const path of ["DirectTradeDashboard.tsx", "TradeTeamPortal.tsx", "TradeCommunicationPage.tsx"]) {
    const source = read(`../src/components/${path}`);
    assert.match(source, /<TradeMessageAlerts/); assert.match(source, /revision: current.revision \+ 1/);
    assert.match(source, /initialThreadRevision={messageTarget.revision}/);
  }
  assert.match(read("../src/components/TradeCommunicationPage.tsx"), /<TradeMessageAlerts key={session.access.memberId}/);
  const workspace = read("../src/components/TradeMessagesWorkspace.tsx");
  assert.match(workspace, /\[call, initialThreadId, initialThreadRevision, initialCallId\]/);
  assert.match(workspace, /document.visibilityState !== "visible"/);
  assert.match(workspace, /document.hasFocus\(\)/);
  assert.match(workspace, /getBoundingClientRect\(\)/);
  assert.match(workspace, /setActiveThread\(thread.id\); return \(\) => setActiveThread\(""\)/);
});

async function startSaveSearch(h) {
  let tree = await h.settle(); button(tree, "Save to job").props.onClick(); tree = await h.settle();
  nodes(tree, node => node.type === "input")[0].props.onChange({ target: { value: "TLJ-1" } }); tree = await h.settle();
  const operation = nodes(tree, node => node.type === "form")[0].props.onSubmit({ preventDefault() {} });
  return { operation };
}

test("Save to job deadlines include stalled auth and network and restore usable controls", async () => {
  for (const mode of ["auth", "network"]) {
    const pending = deferred();
    const h = harness({ save: true, auth: mode === "auth" ? () => pending.promise : undefined, fetch: () => pending.promise });
    const { operation } = await startSaveSearch(h); await h.settle(); h.run(15000); await operation;
    const tree = await h.settle();
    assert.match(text(tree), /request timed out/); assert.equal(button(tree, "Search").props.disabled, false); assert.equal(button(tree, "Cancel").props.disabled, false);
    assert.equal(h.requests.length, mode === "auth" ? 0 : 1);
    pending.resolve(mode === "auth" ? { Authorization: "Bearer late" } : Response.json({ ok: true, jobs: [{ id: "old", jobNumber: "OLD-JOB" }] }));
    assert.doesNotMatch(text(await h.settle()), /OLD-JOB/); h.unmount();
  }
});

test("Save to job unmount aborts its request and ignores late search or save responses", async () => {
  for (const phase of ["search", "save"]) {
    const pending = deferred();
    const h = harness({ save: true, fetch: count => phase === "save" && count === 1
      ? Promise.resolve(Response.json({ ok: true, jobs: [{ id: "job-a", jobNumber: "TLJ-1" }] })) : pending.promise });
    let { operation } = await startSaveSearch(h); await h.settle();
    if (phase === "save") {
      await operation; let tree = await h.settle(); button(tree, "TLJ-1").props.onClick(); tree = await h.settle();
      button(tree, "Save to selected job").props.onClick(); await h.settle();
    }
    const signal = h.requests.at(-1).init.signal;
    h.unmount(); assert.equal(signal.aborted, true);
    pending.resolve(Response.json({ ok: true, jobs: [{ id: "old", jobNumber: "OLD-JOB" }], saved: 1, jobNumber: "OLD-JOB" }));
    await tick(); await tick(); assert.equal(h.lateWrites(), 0);
  }
});
