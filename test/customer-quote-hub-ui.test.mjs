import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";

const source = fs.readFileSync(new URL("../src/components/CustomerQuoteHub.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
} }).outputText;
const text = node => node == null || typeof node === "boolean" ? "" : typeof node !== "object" ? String(node)
  : Array.isArray(node) ? node.map(text).join("") : text(node.props?.children);
const nodes = (node, predicate) => !node || typeof node !== "object" ? [] : Array.isArray(node)
  ? node.flatMap(child => nodes(child, predicate)) : [...(predicate(node) ? [node] : []), ...nodes(node.props?.children, predicate)];
const button = (tree, label) => nodes(tree, node => node.type === "button" && text(node) === label)[0];
const quotePanel = tree => nodes(tree, node => node.type === "QuoteLinkReview")[0];
const toggle = tree => nodes(tree, node => node.props?.role === "switch")[0];
function navigate(tree, label) {
  const nav = nodes(tree, node => node.type === "nav" && node.props["aria-label"] === "Project")[0];
  const target = nodes(nav, node => node.type === "button" && text(node).startsWith(label))[0];
  assert.ok(target, `Missing ${label} tab`); target.props.onClick();
}
const flush = () => new Promise(resolve => setImmediate(resolve));
const response = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const data = {
  title: "Private home upgrade", reference: "PRIVATE-PROJECT-123", expiresAt: "2099-01-01T00:00:00.000Z", accepting: true, revision: 1,
  services: [{ id: "solar", label: "Solar" }, { id: "air-conditioning", label: "Air conditioning" }],
  quotes: [{ id: "quote-one", business: "Private Solar Business", number: "Q-123", services: ["solar"], totalCents: 100000, status: "active", blocked: false }],
  questions: [
    { id: "answer-one", prompt: "Where is the switchboard?", kind: "text", services: ["solar"], business: "Private Solar Business", answer: "", revision: 0, closed: false, authorType: "trade", replies: [], files: [] },
    { id: "file-one", prompt: "Share the floor plan", kind: "document", services: ["air-conditioning"], business: "Private AC Business", answer: "", revision: 0, closed: false, authorType: "trade", replies: [], files: [] },
  ],
};
const ok = hub => response({ ok: true, hub });
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }

// Mirror React's type/key/position identity for a mounted child without rendering
// that child's unrelated network and document behavior.
function locate(node, predicate, path = [], ancestors = []) {
  if (!node || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (const [index, value] of node.entries()) { const found = locate(value, predicate, [...path, index], ancestors); if (found) return found; }
    return null;
  }
  if (predicate(node)) return { node, path, ancestors };
  return locate(node.props?.children, predicate, [...path, "children"], [...ancestors, node]);
}

function harness(t, api, token = "private-hub-token", search = "", beforeEffects = () => {}) {
  let cursor = 0, dirty = false;
  const slots = [], effects = [], callbacks = [], queued = [], requests = [], listeners = new Map();
  const changed = (before, after) => !before || before.length !== after.length || after.some((value, index) => !Object.is(value, before[index]));
  const hooks = {
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
      return [slots[index], value => { const next = typeof value === "function" ? value(slots[index]) : value;
        if (!Object.is(next, slots[index])) { slots[index] = next; dirty = true; } }];
    },
    useRef(initial) { const index = cursor++; if (!(index in slots)) slots[index] = { current: initial }; return slots[index]; },
    useCallback(callback, dependencies) { const index = cursor++;
      if (changed(callbacks[index]?.dependencies, dependencies)) callbacks[index] = { callback, dependencies };
      return callbacks[index].callback; },
    useEffect(effect, dependencies) { const index = cursor++;
      if (changed(effects[index]?.dependencies, dependencies)) { effects[index]?.cleanup?.(); effects[index] = { dependencies };
        queued.push(() => { effects[index].cleanup = effect(); }); } },
  };
  const loaded = {};
  Function("require", "exports", "fetch", "window", `${compiled}\nexports.HubWorkspace=HubWorkspace;`)(name => {
    if (name === "react") return hooks;
    if (name === "react/jsx-runtime") return jsx;
    if (name === "@/lib/customer-photo-upload") return { prepareCustomerPhotoUpload: async file => file };
    if (name === "./QuoteLinkReview") return { QuoteLinkReview: "QuoteLinkReview", QuoteDecisionReceiptView: "QuoteDecisionReceiptView" };
    if (name.endsWith(".module.css")) return { default: new Proxy({}, { get: (_, key) => key }) };
    throw new Error(`Unexpected hub UI dependency: ${name}`);
  }, loaded, async (path, init = {}) => { requests.push({ path, init }); return api(path, init); }, {
    location: { search },
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    requestAnimationFrame: callback => { callback(); return 1; }, cancelAnimationFrame() {},
    addEventListener: (name, callback) => listeners.set(name, callback),
    removeEventListener: (name, callback) => { if (listeners.get(name) === callback) listeners.delete(name); },
  });
  const render = () => { cursor = 0; dirty = false; const tree = loaded.HubWorkspace({ token });
    beforeEffects(tree); for (const effect of queued.splice(0)) effect(); return tree; };
  const settle = async () => { for (let attempt = 0; attempt < 8; attempt++) {
    const tree = render(); await flush(); if (!dirty) return tree;
  } assert.fail("Customer quote hub did not settle after eight renders"); };
  const cleanup = () => { for (const effect of effects) effect?.cleanup?.(); };
  t.after(cleanup);
  return { loaded, render, settle, cleanup, requests, listeners };
}

test("each hub token keys a distinct private workspace and uses an encoded uncached endpoint", async t => {
  const token = "hub/with ?private";
  const h = harness(t, async () => ok(data), token);
  const first = h.loaded.CustomerQuoteHub({ token }), second = h.loaded.CustomerQuoteHub({ token: "other-hub" });
  assert.equal(first.key, token); assert.notEqual(first.key, second.key);
  assert.equal(first.type, second.type); assert.equal(first.props.token, token);
  await h.settle();
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].path, `/api/customer-hub/${encodeURIComponent(token)}`);
  assert.equal(h.requests[0].init.cache, "no-store");
});

test("an older background GET cannot reopen a switch closed by PATCH", async t => {
  const background = deferred(), patch = deferred();
  let reads = 0;
  const closed = { ...data, accepting: false, revision: 2 };
  const h = harness(t, async (_path, init) => {
    if (init.method === "PATCH") return patch.promise;
    reads += 1; return reads === 1 ? ok(data) : reads === 2 ? background.promise : ok(closed);
  });
  let tree = await h.settle();
  h.listeners.get("focus")(); await flush();
  toggle(tree).props.onClick(); tree = h.render();
  assert.equal(toggle(tree).props.disabled, true);
  assert.deepEqual(JSON.parse(h.requests.find(request => request.init.method === "PATCH").init.body), { accepting: false, revision: 1 });
  h.listeners.get("focus")(); assert.equal(reads, 2, "Background refresh waits while the switch mutation is active");
  patch.resolve(ok(closed)); tree = await h.settle();
  assert.equal(toggle(tree).props["aria-checked"], false);
  background.resolve(ok(data)); tree = await h.settle();
  assert.equal(toggle(tree).props["aria-checked"], false);
  assert.match(text(tree), /New quotes and questions are paused/);
});

test("answer drafts and selected files survive tab navigation without premature sharing", async t => {
  let uploaded;
  const h = harness(t, async (path, init) => {
    if (path.endsWith("/files")) uploaded = init.body;
    return ok(data);
  });
  let tree = await h.settle(); navigate(tree, "Q&A"); tree = h.render();
  nodes(tree, node => node.type === "textarea" && node.props.id === "answer-answer-one")[0].props.onChange({ target: { value: "Inside the private garage" } });
  tree = h.render();
  const file = new File(["%PDF-fixture"], "private-plan.pdf", { type: "application/pdf" });
  const selection = { files: [file], value: "C:\\fakepath\\private-plan.pdf" };
  nodes(tree, node => node.type === "input" && node.props.type === "file")[0].props.onChange({ target: selection });
  assert.equal(selection.value, ""); tree = h.render();
  for (const tab of ["Overview", "Quotes", "Q&A"]) { navigate(tree, tab); tree = h.render(); }
  assert.equal(nodes(tree, node => node.type === "textarea" && node.props.id === "answer-answer-one")[0].props.value, "Inside the private garage");
  assert.match(text(tree), /private-plan\.pdf/);
  assert.equal(h.requests.length, 1, "Editing and navigation must not submit or reload the project");
  button(tree, "Share file").props.onClick(); tree = await h.settle();
  assert.ok(uploaded instanceof FormData);
  assert.equal(uploaded.get("questionId"), "file-one");
  assert.equal(uploaded.get("file").name, file.name);
  assert.equal(await uploaded.get("file").text(), await file.text());
  assert.equal(nodes(tree, node => node.type === "textarea" && node.props.id === "answer-answer-one")[0].props.value, "Inside the private garage");
});

test("an opened quote retains its key and React position while hidden on other tabs", async t => {
  const h = harness(t, async path => path.endsWith("/quotes/quote-one") ? response({ ok: true, quoteToken: "quote-one.secret" }) : ok(data));
  let tree = await h.settle(); navigate(tree, "Quotes"); tree = h.render();
  button(tree, "Open quote").props.onClick(); tree = await h.settle();
  const original = locate(tree, node => node.type === "QuoteLinkReview");
  assert.equal(original.node.key, "quote-one"); assert.equal(original.node.props.token, "quote-one.secret");
  assert.equal(original.node.props.embedded, true);
  for (const tab of ["Q&A", "Overview", "Quotes"]) {
    navigate(tree, tab); tree = h.render();
    const retained = locate(tree, node => node.type === "QuoteLinkReview");
    assert.ok(retained); assert.deepEqual(retained.path, original.path);
    assert.equal(retained.node.key, original.node.key);
    assert.equal(retained.ancestors.at(-1).props.hidden, tab !== "Quotes");
  }
  assert.equal(h.requests.length, 2, "Navigation preserves the mounted quote without fetching its capability again");
});

test("a revoked refresh removes project details and opened quote content before showing retry", async t => {
  let revoked = false;
  const h = harness(t, async path => revoked ? response({ ok: false, error: "This private link is no longer available." }, 404)
    : path.endsWith("/quotes/quote-one") ? response({ ok: true, quoteToken: "quote-one.secret" }) : ok(data));
  let tree = await h.settle(); navigate(tree, "Quotes"); tree = h.render();
  button(tree, "Open quote").props.onClick(); tree = await h.settle();
  assert.ok(quotePanel(tree)); revoked = true; h.listeners.get("focus")(); tree = await h.settle();
  assert.equal(quotePanel(tree), undefined); assert.equal(toggle(tree), undefined);
  for (const value of [data.title, data.reference, data.quotes[0].business, ...data.questions.map(question => question.prompt)]) {
    assert.equal(text(tree).includes(value), false, `Revoked view exposed ${value}`);
  }
  assert.match(text(tree), /This private link is no longer available/); assert.ok(button(tree, "Try again"));
  revoked = false; button(tree, "Try again").props.onClick(); tree = await h.settle();
  assert.match(text(tree), /Private home upgrade/); assert.equal(quotePanel(tree), undefined);
});

test("unmount ignores a late private response and removes the focus listener", async t => {
  const pending = deferred();
  const h = harness(t, async () => pending.promise);
  h.render(); assert.equal(h.listeners.has("focus"), true);
  h.cleanup(); assert.equal(h.listeners.has("focus"), false);
  pending.resolve(ok(data)); await flush();
  assert.doesNotMatch(text(h.render()), /Private home upgrade|PRIVATE-PROJECT-123/);
  assert.equal(toggle(h.render()), undefined);
});

test("customer email opens Q&A directly without losing other project navigation",async t=>{
  const h=harness(t,async()=>ok(data),"private-hub-token","?section=qa");
  const tree=await h.settle();
  const qa=nodes(tree,node=>node.type==="button"&&text(node).startsWith("Q&A"))[0];
  assert.equal(qa.props["aria-current"],"page");
  assert.ok(nodes(tree,node=>node.type==="textarea"&&node.props.id==="answer-answer-one").length);
});

test('question links focus the exact authorised question once and keep other requests compact',async t=>{
  const events=[],elements=new Map();
  const h=harness(t,async()=>ok(data),'private-hub-token','?section=qa&question=file-one',tree=>{
    for(const node of nodes(tree,node=>node.type==='details'&&node.key&&node.props.ref)){
      if(!elements.has(node.key))elements.set(node.key,{open:false,scrollIntoView:()=>events.push('scroll:'+node.key),querySelector:()=>({focus:()=>events.push('focus:'+node.key)})});
      node.props.ref(elements.get(node.key));
    }
  });
  let tree=await h.settle();assert.deepEqual(events,['scroll:file-one','focus:file-one']);
  assert.equal(nodes(tree,node=>node.key==='answer-one')[0].props.open,undefined);
  assert.equal(elements.get('file-one').open,true);await h.settle();assert.equal(events.length,2);
  assert.equal(nodes(tree,node=>node.key==='answer-one'&&node.type==='details').length,1);
});

test('unanswered text has one response control and answered text moves to reply history',async t=>{
  let hub=structuredClone(data);
  const h=harness(t,async(_path,init)=>{if(init.method==='POST'){const body=JSON.parse(init.body);assert.equal(body.questionId,'answer-one');assert.equal(body.answer,'Beside the garage');hub.questions[0].answer=body.answer;hub.questions[0].revision++;}return ok(hub);});
  let tree=await h.settle();navigate(tree,'Q&A');tree=h.render();
  let question=nodes(tree,node=>node.key==='answer-one')[0];
  assert.equal(nodes(question,node=>node.type==='textarea').length,1);
  nodes(question,node=>node.type==='textarea')[0].props.onChange({target:{value:'Beside the garage'}});tree=h.render();
  button(tree,'Share answer').props.onClick();tree=await h.settle();question=nodes(tree,node=>node.key==='answer-one')[0];
  assert.equal(nodes(question,node=>node.props?.id==='answer-answer-one').length,0);
  assert.equal(nodes(question,node=>node.type==='textarea').length,1);assert.match(text(question),/Beside the garage/);
  assert.equal(question.props.open,undefined);assert.match(text(tree),/Answer shared with the participating businesses/);
});

test('unknown question links do not focus another conversation or leak inaccessible text',async t=>{
  const h=harness(t,async()=>ok(data),'private-hub-token','?section=qa&question=foreign-question');
  const tree=await h.settle();assert.match(text(tree),/That question is no longer available/);
  assert.equal(nodes(tree,node=>node.type==='details'&&node.key&&node.props.open).length,0);
});

test('comparison is limited to three quotes sharing a service and uses the issued summary',async t=>{
  const hub={...data,quotes:[...data.quotes,...[2,3,4].map(n=>({...data.quotes[0],id:'quote-'+n,business:'Business '+n})),{...data.quotes[0],id:'quote-ac',services:['air-conditioning']}]};
  let revoked=false;
  const h=harness(t,async(path)=>{if(revoked)return response({ok:false,error:'Link withdrawn'},404);if(path.includes('?summary=1'))return response({ok:true,comparison:{id:path.split('/').at(-1).split('?')[0],totalCents:100000,scope:'Install supplied system',terms:'Excludes switchboard upgrade',validUntil:'2099-01-01',items:[],choices:[{name:'Extra circuit',kind:'addon',groupKey:'',summary:'If selected',totalCents:20000}]}});return ok(hub);});
  let tree=await h.settle();navigate(tree,'Quotes');tree=h.render();
  const checks=()=>nodes(tree,node=>node.type==='input'&&node.props.type==='checkbox');
  checks()[0].props.onChange({target:{checked:true}});tree=h.render();assert.equal(checks()[4].props.disabled,true);
  checks()[1].props.onChange({target:{checked:true}});tree=h.render();checks()[2].props.onChange({target:{checked:true}});tree=h.render();assert.equal(checks()[3].props.disabled,true);
  button(tree,'Compare selected quotes').props.onClick();tree=await h.settle();
  assert.equal(h.requests.filter(item=>item.path.includes('?summary=1')).length,3);
  assert.match(text(tree),/Install supplied system/);assert.match(text(tree),/Excludes switchboard upgrade/);assert.match(text(tree),/Base quote/);assert.match(text(tree),/Optional extra/);
  revoked=true;h.listeners.get('focus')();tree=await h.settle();assert.doesNotMatch(text(tree),/Install supplied system|Extra circuit/);
});
