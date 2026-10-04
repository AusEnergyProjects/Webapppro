import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";
import { createTradeBusinessFetch } from "../src/lib/trade-business-client.ts";

const source = fs.readFileSync(new URL("../src/components/TradeCustomerHubPanel.tsx", import.meta.url), "utf8");
const crmSource = fs.readFileSync(new URL("../src/components/InstallerCrmWorkspace.tsx", import.meta.url), "utf8");
const compile = source => ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
} }).outputText;
const compiled = compile(source);
const previewCompiled = compile(fs.readFileSync(new URL("../src/components/CustomerHubFilePreview.tsx", import.meta.url), "utf8"));
const qaCompiled = compile(`import {useRef,useEffect,useState} from 'react';
const registerStyles = {}; const TradeCustomerHubPanel = 'TradeCustomerHubPanel';
${crmSource.slice(crmSource.indexOf("function CustomerQa("))}
export {CustomerQa,CustomerQaJob};`);
const text = node => node == null || typeof node === "boolean" ? "" : typeof node !== "object" ? String(node)
  : Array.isArray(node) ? node.map(text).join("") : text(node.props?.children);
const nodes = (node, predicate) => !node || typeof node !== "object" ? [] : Array.isArray(node)
  ? node.flatMap(child => nodes(child, predicate)) : [...(predicate(node) ? [node] : []), ...nodes(node.props?.children, predicate)];
const button = (tree, label) => nodes(tree, node => node.type === "button" && text(node) === label)[0];
const fileButton = (tree, name = "private-plan.pdf") => nodes(tree, node => node.type === "button" && node.props["aria-label"]?.endsWith(`: ${name}`))[0];
const dialog = tree => nodes(tree, node => node.type === "dialog")[0];
const download = tree => nodes(tree, node => node.type === "a" && text(node) === "Download")[0];
const toggle = tree => nodes(tree, node => node.props?.role === "switch")[0];
const textareas = tree => nodes(tree, node => node.type === "textarea");
const flush = () => new Promise(resolve => setImmediate(resolve));
const response = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const fileResponse = (type = "application/pdf") => ({ ok: true, status: 200, blob: async () => new Blob(["private customer upload"], { type }) });
const question = { id: "question-one", prompt: "Where is the switchboard?", kind: "text", services: ["solar"], authorType: "customer",
  answer: "In the garage", replies: [{ id: "reply-one", body: "Thanks, that helps", authorType: "trade", createdAt: "2026-10-03" }],
  revision: 1, closed: false, files: [{ id: "file/one", name: "private-plan.pdf", type: "application/pdf" }] };
const view = { ok: true, available: true, accepting: true, interested: true, interestRevision: 4, canManageInterest: true,
  canAsk: true, workOrderId: "job-one", customerId: "customer-one", questions: [question] };
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }

function harness(t, api, options = {}) {
  const initialUser = Object.hasOwn(options, "user") ? options.user : { uid: "signed-in-person", emailVerified: true, getIdToken: async () => "current-user-token" };
  const firebaseAuth = { currentUser: initialUser }, authListeners = new Set();
  let dirty = false, props = { user: initialUser, ...(options.props || { workOrderId: "job-one" }) }, ownerUid = options.ownerUid ?? "owner-one";
  const frame = () => ({ cursor: 0, slots: [], effects: [], callbacks: [], queued: [], cleaned: false });
  const rootFrame = frame(); let currentFrame = rootFrame, previewFrame = null, previewKey = null;
  const requests = [], listeners = new Map(), downloads = [], objectUrls = [], revokedUrls = [], dialogs = [];
  let restoredFocus = 0;
  class Element { isConnected = true; focus() { restoredFocus++; } }
  const document = { activeElement: new Element(), body: { style: { overflow: "auto" } },
    createElement: () => ({ click() { downloads.push(this.download); } }) };
  const changed = (before, after) => !before || before.length !== after.length || after.some((value, index) => !Object.is(value, before[index]));
  const hooks = {
    useState(initial) { const { slots } = currentFrame, index = currentFrame.cursor++; if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
      return [slots[index], value => { const next = typeof value === "function" ? value(slots[index]) : value;
        if (!Object.is(next, slots[index])) { slots[index] = next; dirty = true; } }]; },
    useRef(initial) { const { slots } = currentFrame, index = currentFrame.cursor++; if (!(index in slots)) slots[index] = { current: initial }; return slots[index]; },
    useCallback(callback, dependencies) { const { callbacks } = currentFrame, index = currentFrame.cursor++;
      if (changed(callbacks[index]?.dependencies, dependencies)) callbacks[index] = { callback, dependencies };
      return callbacks[index].callback; },
    useEffect(effect, dependencies) { const { effects, queued } = currentFrame, index = currentFrame.cursor++;
      if (changed(effects[index]?.dependencies, dependencies)) { effects[index]?.cleanup?.(); effects[index] = { dependencies };
        queued.push(() => { effects[index].cleanup = effect(); }); } },
  };
  const transport = async (path, init = {}) => { requests.push({ path, init }); return api(path, init); };
  let scopedOwner = ownerUid, request = createTradeBusinessFetch(ownerUid, "https://ausenergyassessments.com", transport);
  const loaded = {}, sharedPreview = {};
  const execute = (code, target) => Function("require", "exports", "window", "URL", "document", "HTMLElement", code)(name => {
    if (name === "react") return hooks;
    if (name === "./CustomerHubFilePreview") return sharedPreview;
    if (name === "./TradeCustomerHubAssist") return { TradeCustomerHubAssist: "TradeCustomerHubAssist" };
    if (name === "react/jsx-runtime") return jsx;
    if (name === "./TradeBusinessProvider") return { useTradeBusinessFetch: () => {
      if (scopedOwner !== ownerUid) { scopedOwner = ownerUid; request = createTradeBusinessFetch(ownerUid, "https://ausenergyassessments.com", transport); }
      return request;
    }, useTradeBusiness: () => ({ ownerUid }) };
    if (name === "@/lib/firebase-client") return { firebaseAuth };
    if (name === "firebase/auth") return { onIdTokenChanged: (_auth, listener) => { authListeners.add(listener); listener(firebaseAuth.currentUser); return () => authListeners.delete(listener); } };
    if (name.endsWith(".module.css")) return { default: new Proxy({}, { get: (_, key) => key }) };
    throw new Error(`Unexpected trade hub UI dependency: ${name}`);
  }, target, {
    addEventListener: (name, callback) => listeners.set(name, callback),
    removeEventListener: (name, callback) => { if (listeners.get(name) === callback) listeners.delete(name); },
    setTimeout: callback => { callback(); return 1; },
  }, { createObjectURL: blob => { const url = `blob:customer-upload-${objectUrls.length + 1}`; objectUrls.push({ url, blob }); return url; },
    revokeObjectURL: url => revokedUrls.push(url) }, document, Element);
  execute(previewCompiled, sharedPreview);
  execute(options.qa ? qaCompiled : compiled + "\nexports.Panel=Panel;exports.AuthenticatedPanel=AuthenticatedPanel;", loaded);
  const cleanupFrame = state => { if (!state || state.cleaned) return; state.cleaned = true; for (const effect of state.effects) effect?.cleanup?.(); };
  const render = () => {
    currentFrame = rootFrame; rootFrame.cursor = 0; dirty = false;
    let tree = loaded[options.component || "AuthenticatedPanel"](props);
    const selected = nodes(tree, node => node.type === sharedPreview.CustomerHubFilePreview)[0];
    if (!selected || selected.key !== previewKey) { cleanupFrame(previewFrame); previewFrame = null; previewKey = null; }
    if (selected) {
      if (!previewFrame) {
        previewFrame = frame(); previewKey = selected.key;
        previewFrame.element = { open: false, shown: 0, closed: 0,
          showModal() { this.open = true; this.shown++; }, close() { this.open = false; this.closed++; } };
        dialogs.push(previewFrame.element);
      }
      currentFrame = previewFrame; previewFrame.cursor = 0;
      const previewTree = selected.type({ ...selected.props, ...options.previewProps }); previewTree.props.ref.current = previewFrame.element;
      const expand = node => Array.isArray(node) ? node.map(expand) : node === selected ? previewTree
        : !node || typeof node !== "object" ? node : { ...node, props: { ...node.props, children: expand(node.props?.children) } };
      tree = expand(tree);
    }
    currentFrame = rootFrame;
    options.beforeEffects?.(tree);
    for (const effect of rootFrame.queued.splice(0)) effect();
    for (const effect of previewFrame?.queued.splice(0) || []) effect();
    return tree;
  };
  const settle = async () => { for (let attempt = 0; attempt < 8; attempt++) {
    const tree = render(); await flush(); if (!dirty) return tree;
  } assert.fail("Trade customer hub did not settle after eight renders"); };
  const cleanup = () => { cleanupFrame(previewFrame); cleanupFrame(rootFrame); };
  t.after(cleanup);
  return { loaded, render, settle, cleanup, requests, listeners, downloads, authListeners, objectUrls, revokedUrls, dialogs, document,
    get restoredFocus() { return restoredFocus; },
    setUser: user => { firebaseAuth.currentUser = user; for (const listener of authListeners) listener(user); },
    setOwner: owner => { ownerUid = owner; }, setProps: next => { props = { user: initialUser, ...next }; } };
}

test("tenant and job identities key separate workspaces with an encoded uncached read", async t => {
  const h = harness(t, async () => response(view), { props: { workOrderId: "job/one ?" } });
  const first = h.loaded.TradeCustomerHubPanel({ workOrderId: "job-one" });
  assert.equal(first.key, "owner-one:job-one");
  assert.notEqual(first.key, h.loaded.TradeCustomerHubPanel({ workOrderId: "job-two" }).key);
  h.setOwner("owner-two"); assert.notEqual(first.key, h.loaded.TradeCustomerHubPanel({ workOrderId: "job-one" }).key);
  assert.equal(h.loaded.TradeCustomerHubInterest({ matchId: "match-one" }).key, "owner-two:match:match-one");
  await h.settle(); assert.equal(h.requests[0].path, "/api/trade-customer-hub?workOrderId=job%2Fone%20%3F");
  assert.equal(h.requests[0].init.cache, "no-store");
});

test("visible segmented composer and starters prefill only, then one explicit Ask sends the scoped request", async t => {
  const pending = deferred();
  const h = harness(t, async (_path, init) => init.method === "POST" ? pending.promise : response(view));
  let tree = await h.settle();
  assert.equal(nodes(tree, node => node.type === "select").length, 0);
  assert.equal(nodes(tree, node => node.type === "details")[0].props.open, true, "An answer with customer uploads is initially visible");
  assert.equal(button(tree, "Ask customer").props.disabled, true);
  button(tree, "Switchboard photo").props.onClick(); tree = h.render();
  assert.equal(textareas(tree)[0].props.value, "Please share a clear photo of the switchboard.");
  assert.equal(button(tree, "Photo").props["aria-pressed"], true);
  assert.equal(h.requests.length, 1, "A starter must never auto-send");
  button(tree, "Ask customer").props.onClick(); button(tree, "Ask customer").props.onClick(); tree = h.render();
  assert.equal(button(tree, "Adding…").props.disabled, true);
  await flush();
  const posts = h.requests.filter(item => item.init.method === "POST"); assert.equal(posts.length, 1);
  assert.deepEqual(JSON.parse(posts[0].init.body), { workOrderId: "job-one", prompt: "Please share a clear photo of the switchboard.", kind: "photo" });
  pending.resolve(response(view)); tree = await h.settle(); assert.equal(textareas(tree)[0].props.value, "");
});

test("an existing duplicate opens its response and prevents a second request", async t => {
  const h = harness(t, async () => response(view)); let tree = await h.settle();
  textareas(tree)[0].props.onChange({ target: { value: "  WHERE IS THE SWITCHBOARD?  " } }); tree = h.render();
  assert.equal(button(tree, "Ask customer").props.disabled, true);
  assert.equal(nodes(tree, node => node.type === "details")[0].props.open, true);
  assert.match(text(tree), /This request is already shared/); assert.match(text(tree), /In the garage/);
  button(tree, "Ask customer").props.onClick(); await flush(); assert.equal(h.requests.length, 1);
});

test("question and reply drafts survive refresh and a server duplicate conflict reuses the shared record", async t => {
  let current = view;
  const h = harness(t, async (_path, init) => {
    if (init.method === "POST") { current = { ...view, questions: [...view.questions, { ...question, id: "duplicate", prompt: "Share roof access details" }] };
      return response({ ok: false, error: "This question has already been shared." }, 409); }
    return response(current);
  });
  let tree = await h.settle();
  textareas(tree)[0].props.onChange({ target: { value: "Share roof access details" } });
  textareas(tree)[1].props.onChange({ target: { value: "Private draft reply" } }); tree = h.render();
  h.listeners.get("focus")(); tree = await h.settle();
  assert.equal(textareas(tree)[0].props.value, "Share roof access details"); assert.equal(textareas(tree)[1].props.value, "Private draft reply");
  button(tree, "Ask customer").props.onClick(); tree = await h.settle();
  assert.match(text(tree), /This question has already been shared/); assert.equal(textareas(tree)[0].props.value, "Share roof access details");
  assert.equal(textareas(tree)[1].props.value, "Private draft reply"); assert.equal(button(tree, "Ask customer").props.disabled, true);
  assert.equal(nodes(tree, node => node.type === "details" && node.key === "duplicate")[0].props.open, true);
});

test("explicit interest PATCH uses its revision and a stale GET cannot turn updates back on", async t => {
  const background = deferred(), patch = deferred(); let reads = 0;
  const off = { ...view, interested: false, interestRevision: 5 };
  const h = harness(t, async (_path, init) => init.method === "PATCH" ? patch.promise
    : ++reads === 1 ? response(view) : reads === 2 ? background.promise : response(off));
  let tree = await h.settle(); h.listeners.get("focus")(); await flush();
  toggle(tree).props.onClick(); tree = h.render(); assert.equal(toggle(tree).props.disabled, true);
  await flush();
  assert.deepEqual(JSON.parse(h.requests.find(item => item.init.method === "PATCH").init.body), { workOrderId: "job-one", interested: false, revision: 4 });
  h.listeners.get("focus")(); assert.equal(reads, 2);
  patch.resolve(response(off)); tree = await h.settle(); assert.equal(toggle(tree).props["aria-checked"], false);
  background.resolve(response(view)); tree = await h.settle(); assert.equal(toggle(tree).props["aria-checked"], false);
  assert.match(text(tree), /Existing quotes and records are unchanged/);
  assert.equal(textareas(tree)[0].props.disabled, true); assert.equal(button(tree, "Share reply"), undefined);
});

test("Interested adds the customer and opens exact Q&A in one click; off and re-on preserve the same record", async t => {
  const opened = [];
  let current = { ...view, interested: false, interestRevision: 0, workOrderId: "", questions: [] };
  const h = harness(t, async (_path, init) => { if (init.method === "PATCH") current = { ...view, interested: JSON.parse(init.body).interested, interestRevision: current.interestRevision + 1 }; return response(current); },
    { props: { matchId: "match/one", interestOnly: true, onOpenQa: target => opened.push(target) } });
  let tree = await h.settle(); assert.equal(h.requests[0].path, "/api/trade-customer-hub?matchId=match%2Fone");
  assert.equal(textareas(tree).length, 0); assert.equal(button(tree, "Ask customer"), undefined);
  button(tree, "Interested").props.onClick(); button(tree, "Interested").props.onClick(); tree = await h.settle();
  assert.equal(button(tree, "Interested").props["aria-pressed"], true);
  assert.deepEqual(opened, [{ customerId: "customer-one", workOrderId: "job-one" }]);
  assert.deepEqual(JSON.parse(h.requests.find(item => item.init.method === "PATCH").init.body), { matchId: "match/one", interested: true, revision: 0 });
  assert.equal(h.requests.some(item => item.init.method === "POST"), false);
  assert.equal(h.requests.filter(item => item.init.method === "PATCH").length, 1);
  button(tree, "Not interested").props.onClick(); tree = await h.settle();
  assert.equal(button(tree, "Not interested").props["aria-pressed"], true); assert.equal(opened.length, 1);
  button(tree, "Interested").props.onClick(); tree = await h.settle();
  assert.equal(opened.length, 2); assert.deepEqual(opened[1], opened[0]);
  button(tree, "Interested").props.onClick(); assert.equal(opened.length, 3);
  assert.equal(h.requests.filter(item => item.init.method === "PATCH").length, 3, "Opening an already interested customer does not create another write");
});

test("lead interest failure and missing customer identity never navigate or report success", async t => {
  for (const result of [response({ ok: false, error: "Interest could not be saved." }, 409), response({ ...view, customerId: "" })]) {
    const opened = [];
    const h = harness(t, async (_path, init) => init.method === "PATCH" ? result : response({ ...view, interested: false }),
      { props: { matchId: "match-one", interestOnly: true, onOpenQa: target => opened.push(target) } });
    let tree = await h.settle(); button(tree, "Interested").props.onClick(); tree = await h.settle();
    assert.equal(opened.length, 0); assert.match(text(tree), /could not be/); assert.doesNotMatch(text(tree), /You're interested/);
  }
});

test("closed or permission-limited views retain existing answers and prevent asking and replying", async t => {
  for (const current of [{ ...view, accepting: false }, { ...view, canAsk: false, canManageInterest: false }]) {
    const h = harness(t, async () => response(current)); const tree = await h.settle();
    assert.match(text(tree), /In the garage/); assert.equal(button(tree, "Ask customer"), undefined);
    assert.equal(button(tree, "Share reply"), undefined); assert.equal(textareas(tree).length, 0);
    assert.equal(toggle(tree).props.disabled, !current.canManageInterest);
    if (!current.canManageInterest) { toggle(tree).props.onClick(); await flush(); assert.equal(h.requests.length, 1); }
  }
});

test("business replies are scoped and show roles without exposing competing business identities", async t => {
  const current = { ...view, questions: [{ ...question, business: "Competitor Secret", replies: [{ ...question.replies[0], business: "Other Competitor Secret" }] }] };
  const h = harness(t, async () => response(current)); let tree = await h.settle();
  assert.match(text(tree), /Asked by customer/); assert.match(text(tree), /Thanks, that helps/); assert.doesNotMatch(text(tree), /Competitor Secret/);
  textareas(tree)[0].props.onChange({ target: { value: "Keep this unrelated request draft" } });
  textareas(tree)[1].props.onChange({ target: { value: "  We can arrange access.  " } }); tree = h.render();
  button(tree, "Share reply").props.onClick(); tree = await h.settle();
  assert.deepEqual(JSON.parse(h.requests.find(item => item.init.method === "POST").init.body), { workOrderId: "job-one", action: "reply", questionId: "question-one", body: "We can arrange access." });
  assert.equal(textareas(tree)[0].props.value, "Keep this unrelated request draft"); assert.equal(textareas(tree)[1].props.value, "");
});

test("revoked refresh clears private content and an unmounted preview never exposes a file", async t => {
  let revoked = false;
  const h = harness(t, async () => revoked ? response({ ok: false, error: "This conversation is unavailable." }, 404) : response(view));
  let tree = await h.settle(); revoked = true; h.listeners.get("focus")(); tree = await h.settle();
  assert.doesNotMatch(text(tree), /In the garage|switchboard|private-plan/); assert.equal(toggle(tree), undefined);
  assert.match(text(tree), /unavailable/);
  const pending = deferred(); const d = harness(t, async path => path.includes("fileId=") ? pending.promise : response(view));
  tree = await d.settle(); fileButton(tree).props.onClick(); await d.settle(); d.cleanup();
  assert.equal(d.listeners.has("focus"), false);
  pending.resolve({ ok: true, status: 200, blob: async () => new Blob(["private"], { type: "application/pdf" }) }); await flush();
  assert.deepEqual(d.downloads, []); assert.match(d.requests.at(-1).path, /fileId=file%2Fone/);
  assert.deepEqual(d.objectUrls, []);
  assert.equal(d.requests.at(-1).init.signal.aborted, true);
});

test("real business fetch receives fresh bearer and selected business for reads, interest, questions, replies and previews", async t => {
  let tokens = 0;
  const user = { uid: "person", emailVerified: true, getIdToken: async () => `fresh-token-${++tokens}` };
  const h = harness(t, async (path, init) => path.includes("fileId=")
    ? { ok: true, status: 200, blob: async () => new Blob(["shared file"], { type: "application/pdf" }) }
    : response(init.method === "PATCH" ? { ...view, interested: false, interestRevision: 5 } : view), { user });
  let tree = await h.settle();
  textareas(tree)[0].props.onChange({ target: { value: "Please share the site access details" } }); tree = h.render();
  button(tree, "Ask customer").props.onClick(); tree = await h.settle();
  textareas(tree)[1].props.onChange({ target: { value: "We can arrange that access" } }); tree = h.render();
  button(tree, "Share reply").props.onClick(); tree = await h.settle();
  fileButton(tree).props.onClick(); tree = await h.settle();
  assert.equal(download(tree).props.download, "private-plan.pdf");
  toggle(tree).props.onClick(); await h.settle();
  assert.ok(h.requests.some(item => item.init.method === "PATCH"));
  assert.equal(h.requests.filter(item => item.init.method === "POST").length, 2);
  assert.ok(h.requests.some(item => item.path.includes("fileId=")));
  assert.deepEqual(h.downloads, [], "Opening a preview must not save a file automatically");
  for (const [index, { init }] of h.requests.entries()) {
    assert.equal(init.headers.get("Authorization"), `Bearer fresh-token-${index + 1}`);
    assert.equal(init.headers.get("X-TLink-Business"), "owner-one");
    assert.equal(init.signal.aborted, false);
    if (init.method === "POST" || init.method === "PATCH") assert.equal(init.headers.get("Content-Type"), "application/json");
  }
  assert.equal(tokens, h.requests.length);
});

test("customer uploads have visible counts and format actions while answers without files remain collapsed", async t => {
  const photo = { id: "photo-one", name: "switchboard.jpg", type: "image/jpeg" };
  const current = { ...view, questions: [{ ...question, files: [...question.files, photo] },
    { ...question, id: "answer-only", prompt: "When can we access the property?", files: [] }] };
  const h = harness(t, async path => path.includes("fileId=") ? fileResponse(photo.type) : response(current));
  let tree = await h.settle();
  const questions = nodes(tree, node => node.type === "details");
  assert.equal(questions[0].props.open, true); assert.match(text(questions[0]), /2 customer files/);
  assert.equal(questions[1].props.open, undefined);
  assert.equal(nodes(tree, node => node.type === "section" && node.props["aria-label"] === "Customer uploads").length, 1);
  assert.match(text(fileButton(tree)), /View PDF/); assert.match(text(fileButton(tree, photo.name)), /View photo/);
  assert.equal(h.requests.length, 1, "The list does not prefetch private bytes");
  fileButton(tree, photo.name).props.onClick(); tree = await h.settle();
  assert.equal(dialog(tree).props["aria-label"], "Customer photo preview");
  assert.match(text(dialog(tree)), /Where is the switchboard\?/);
  assert.match(h.requests.at(-1).path, /fileId=photo-one$/);
  assert.deepEqual(h.downloads, []);
});

test("supported previews retain a local URL until explicit close and expose a separate named download", async t => {
  for (const type of ["application/pdf", "image/jpeg", "image/png", "image/webp"]) {
    const file = { ...question.files[0], type };
    const h = harness(t, async path => path.includes("fileId=") ? fileResponse(type)
      : response({ ...view, questions: [{ ...question, files: [file] }] }));
    let tree = await h.settle(); fileButton(tree).props.onClick(); tree = await h.settle();
    assert.equal(h.dialogs[0].shown, 1); assert.equal(h.dialogs[0].open, true);
    assert.equal(h.document.body.style.overflow, "hidden");
    assert.equal(h.objectUrls.length, 1); assert.deepEqual(h.revokedUrls, []);
    const media = nodes(tree, node => node.type === (type === "application/pdf" ? "iframe" : "img"))[0];
    assert.equal(media.props.src, h.objectUrls[0].url);
    if (type === "application/pdf") {
      assert.equal(media.props.referrerPolicy, "no-referrer");
      assert.equal(media.props.title, "Customer document: private-plan.pdf");
    } else assert.match(media.props.alt, /Where is the switchboard\?/);
    assert.equal(download(tree).props.href, media.props.src); assert.equal(download(tree).props.download, file.name);
    assert.equal(h.requests.at(-1).init.cache, "no-store");
    assert.equal(h.requests.at(-1).init.signal.aborted, false);
    assert.deepEqual(h.downloads, []);
    button(tree, "Close").props.onClick(); tree = await h.settle();
    assert.equal(dialog(tree), undefined); assert.equal(h.dialogs[0].closed, 1);
    assert.equal(h.document.body.style.overflow, "auto"); assert.equal(h.restoredFocus, 1);
    assert.deepEqual(h.revokedUrls, [media.props.src]); assert.equal(h.requests.at(-1).init.signal.aborted, true);
    fileButton(tree).props.onClick(); tree = await h.settle();
    assert.equal(h.objectUrls.length, 2); assert.notEqual(download(tree).props.href, media.props.src);
    h.cleanup(); assert.deepEqual(h.revokedUrls, h.objectUrls.map(item => item.url));
    assert.equal(h.document.body.style.overflow, "auto");
  }
});

test("the shared preview accepts a complete customer file URL and customer presentation without trade URL rewriting", async t => {
  const fileUrl = "/api/customer-hub/customer-token/files/file%2Fone";
  const h = harness(t, async path => path === fileUrl ? fileResponse() : response(view),
    { previewProps: { fileUrl, ownerLabel: "Your upload", customer: true } });
  let tree = await h.settle(); fileButton(tree).props.onClick(); tree = await h.settle();
  assert.equal(h.requests.at(-1).path, fileUrl);
  assert.equal(h.requests.at(-1).init.cache, "no-store");
  assert.equal(dialog(tree).props["aria-label"], "Your PDF preview");
  assert.match(dialog(tree).props.className, /customer/); assert.match(text(dialog(tree)), /Your upload/);
  assert.equal(nodes(tree, node => node.type === "iframe")[0].props.title, "Your document: private-plan.pdf");
  assert.equal(download(tree).props.download, "private-plan.pdf");
  h.cleanup(); assert.deepEqual(h.revokedUrls, h.objectUrls.map(item => item.url));
});

test("the shared preview does not request bytes when authority has already ended", async t => {
  const h = harness(t, async path => { assert.ok(!path.includes("fileId=")); return response(view); },
    { previewProps: { isCurrent: () => false } });
  let tree = await h.settle(); fileButton(tree).props.onClick(); tree = await h.settle();
  assert.equal(h.requests.length, 1); assert.deepEqual(h.objectUrls, []); assert.equal(download(tree), undefined);
});

test("changing the shared preview resource clears the old file immediately and aborts its request", async t => {
  const pending = deferred(), options = { previewProps: {} };
  const h = harness(t, async path => path === "/replacement-file" ? pending.promise : path.includes("fileId=") ? fileResponse() : response(view), options);
  let tree = await h.settle(); fileButton(tree).props.onClick(); tree = await h.settle();
  const oldUrl = download(tree).props.href, oldRequest = h.requests.at(-1);
  options.previewProps.fileUrl = "/replacement-file"; tree = h.render();
  assert.equal(download(tree), undefined); assert.equal(nodes(tree, node => node.type === "iframe").length, 0);
  assert.equal(oldRequest.init.signal.aborted, true); assert.deepEqual(h.revokedUrls, [oldUrl]);
  pending.resolve({ ok: false, status: 404 }); tree = await h.settle();
  assert.match(text(dialog(tree)), /no longer available/); assert.equal(download(tree), undefined); assert.equal(h.objectUrls.length, 1);
});

test("Close, Escape and backdrop dismissals abort pending response or body reads without creating private URLs", async t => {
  for (const stage of ["response", "body"]) for (const action of ["Close", "Escape", "backdrop"]) {
    const pending = deferred();
    const h = harness(t, async path => !path.includes("fileId=") ? response(view) : stage === "response" ? pending.promise
      : { ok: true, status: 200, blob: () => pending.promise });
    let tree = await h.settle(); fileButton(tree).props.onClick(); tree = await h.settle();
    const modal = dialog(tree), request = h.requests.at(-1);
    assert.match(text(modal), /Opening customer document/); assert.equal(download(tree), undefined);
    modal.props.onClick({ target: {}, currentTarget: h.dialogs[0] });
    assert.ok(dialog(h.render()), "Clicks inside the preview do not dismiss it");
    if (action === "Close") button(tree, "Close").props.onClick();
    if (action === "Escape") { let prevented = false; modal.props.onCancel({ preventDefault() { prevented = true; } }); assert.equal(prevented, true); }
    if (action === "backdrop") modal.props.onClick({ target: h.dialogs[0], currentTarget: h.dialogs[0] });
    tree = await h.settle(); assert.equal(dialog(tree), undefined); assert.equal(request.init.signal.aborted, true);
    pending.resolve(stage === "response" ? fileResponse() : new Blob(["late private bytes"], { type: "application/pdf" }));
    await flush(); tree = await h.settle();
    assert.deepEqual(h.objectUrls, []); assert.deepEqual(h.downloads, []); assert.equal(dialog(tree), undefined);
  }
});

test("unsupported content, mismatched MIME and denied requests never create a preview or download URL", async t => {
  const cases = [
    { stored: "application/pdf", actual: "text/html" }, { stored: "application/pdf", actual: "image/svg+xml" },
    { stored: "image/svg+xml", actual: "image/svg+xml" }, { stored: "image/jpeg", actual: "image/png" },
    { stored: "application/pdf", actual: "" }, ...[401, 403, 404, 500].map(status => ({ stored: "application/pdf", status })),
  ];
  for (const item of cases) {
    const h = harness(t, async path => !path.includes("fileId=")
      ? response({ ...view, questions: [{ ...question, files: [{ ...question.files[0], type: item.stored }] }] })
      : item.status ? { ok: false, status: item.status, blob: async () => assert.fail("Denied bytes must not be consumed") }
        : fileResponse(item.actual));
    let tree = await h.settle(); fileButton(tree).props.onClick(); tree = await h.settle();
    assert.equal(nodes(tree, node => node.props?.role === "alert").length, 1);
    assert.match(text(dialog(tree)), item.status ? /no longer available/ : /safely previewed/);
    assert.equal(download(tree), undefined); assert.equal(nodes(tree, node => ["img", "iframe"].includes(node.type)).length, 0);
    assert.deepEqual(h.objectUrls, []); assert.deepEqual(h.downloads, []);
    h.cleanup();
  }
});

test("identity replacement during private body consumption cannot expose the previous account's bytes", async t => {
  const pending = deferred();
  const h = harness(t, async path => path.includes("fileId=") ? { ok: true, status: 200, blob: () => pending.promise } : response(view));
  let tree = await h.settle(); fileButton(tree).props.onClick(); tree = await h.settle();
  h.setUser({ uid: "another-person", emailVerified: true, getIdToken: async () => "another-token" });
  pending.resolve(new Blob(["previous person's private file"], { type: "application/pdf" }));
  await flush(); tree = await h.settle();
  assert.deepEqual(h.objectUrls, []); assert.equal(download(tree), undefined);
  assert.equal(nodes(tree, node => ["iframe", "img"].includes(node.type)).length, 0);
});

test("an explicit Download stays available to the current identity and closes without saving after identity loss", async t => {
  for (const user of [null, { uid: "another-person", emailVerified: true }, { uid: "signed-in-person", emailVerified: false }]) {
    const h = harness(t, async path => path.includes("fileId=") ? fileResponse() : response(view));
    let tree = await h.settle(); fileButton(tree).props.onClick(); tree = await h.settle();
    const link = download(tree), url = link.props.href;
    let prevented = false;
    link.props.onClick({ preventDefault() { prevented = true; } });
    assert.equal(prevented, false, "The current account may explicitly download the loaded upload");
    assert.ok(dialog(h.render())); assert.deepEqual(h.revokedUrls, []);
    h.setUser(user);
    link.props.onClick({ preventDefault() { prevented = true; } }); tree = await h.settle();
    assert.equal(prevented, true); assert.equal(dialog(tree), undefined); assert.equal(download(tree), undefined);
    assert.deepEqual(h.revokedUrls, [url]); assert.deepEqual(h.downloads, []);
  }
});

test("revoked conversation refresh removes an already loaded preview and revokes its private URL", async t => {
  let revoked = false;
  const h = harness(t, async path => path.includes("fileId=") ? fileResponse() : revoked
    ? response({ ok: false, error: "This conversation is unavailable." }, 404) : response(view));
  let tree = await h.settle(); fileButton(tree).props.onClick(); tree = await h.settle();
  const url = download(tree).props.href;
  revoked = true; h.listeners.get("focus")(); tree = await h.settle();
  assert.equal(dialog(tree), undefined); assert.equal(download(tree), undefined);
  assert.doesNotMatch(text(tree), /Where is the switchboard|private-plan|In the garage/);
  assert.deepEqual(h.revokedUrls, [url]); assert.equal(h.document.body.style.overflow, "auto");
});

test("refresh removing the selected upload closes its preview even while the conversation remains available", async t => {
  let current = view;
  const h = harness(t, async path => path.includes("fileId=") ? fileResponse() : response(current));
  let tree = await h.settle(); fileButton(tree).props.onClick(); tree = await h.settle();
  const url = download(tree).props.href;
  current = { ...view, questions: [{ ...question, files: [] }] };
  h.listeners.get("focus")(); tree = await h.settle();
  assert.equal(dialog(tree), undefined); assert.equal(download(tree), undefined);
  assert.match(text(tree), /In the garage/); assert.deepEqual(h.revokedUrls, [url]);
});

test("identity boundary sends nothing without a verified user and selected business, and remounts on identity changes", async t => {
  const user = { uid: "person", emailVerified: true, getIdToken: async () => "token" };
  for (const options of [{ user: null }, { user: { ...user, emailVerified: false } }, { user, ownerUid: "" }]) {
    const h = harness(t, async () => assert.fail("Unauthorised transport"), { ...options, component: "Panel" });
    const tree = await h.settle();
    assert.equal(tree.type, "p"); assert.match(text(tree), /Sign in|Choose your business/); assert.equal(h.requests.length, 0);
    h.cleanup(); assert.equal(h.authListeners.size, 0);
  }
  const h = harness(t, async () => response(view), { user, component: "Panel" });
  const first = await h.settle(); assert.equal(first.key, "person:owner-one");
  h.setUser({ ...user, uid: "other-person" });
  const changed = await h.settle(); assert.equal(changed.key, "other-person:owner-one");
  h.setOwner("owner-two"); assert.equal(h.render().key, "other-person:owner-two");
  h.setUser(null); assert.match(text(await h.settle()), /Sign in/);
});

test("identity change or unmount while obtaining a token prevents every protected action reaching transport", async t => {
  for (const action of ["read", "interest", "ask", "reply", "preview"]) {
    const pending = deferred(); let calls = 0;
    const user = { uid: "person", emailVerified: true, getIdToken: () => ++calls === (action === "read" ? 1 : 2) ? pending.promise : Promise.resolve("first-token") };
    const h = harness(t, async () => response(view), { user });
    if (action === "read") h.render();
    else {
      let tree = await h.settle();
      if (action === "interest") toggle(tree).props.onClick();
      if (action === "ask") { textareas(tree)[0].props.onChange({ target: { value: "Please share the access details" } }); tree = h.render(); button(tree, "Ask customer").props.onClick(); }
      if (action === "reply") { textareas(tree)[1].props.onChange({ target: { value: "We can help with access" } }); tree = h.render(); button(tree, "Share reply").props.onClick(); }
      if (action === "preview") { fileButton(tree).props.onClick(); h.render(); }
    }
    h.setUser({ ...user, uid: "different-person" }); pending.resolve("old-account-token"); await flush();
    assert.equal(h.requests.length, action === "read" ? 0 : 1, action);
    assert.deepEqual(h.downloads, []);
  }
  const pending = deferred();
  const h = harness(t, async () => assert.fail("Unmounted request reached transport"), {
    user: { uid: "person", emailVerified: true, getIdToken: () => pending.promise },
  });
  h.render(); h.cleanup(); pending.resolve("old-business-token"); await flush(); assert.equal(h.requests.length, 0);
});

test("token failures and empty tokens never fall back to an unauthenticated request", async t => {
  for (const getIdToken of [async () => { throw new Error("Session expired"); }, async () => ""]) {
    const h = harness(t, async () => assert.fail("Unauthenticated transport"), {
      user: { uid: "person", emailVerified: true, getIdToken }, props: { matchId: "match", interestOnly: true },
    });
    const tree = await h.settle(); assert.equal(h.requests.length, 0); assert.ok(button(tree, "Retry"));
  }
});

const job = { id: "job-one", crmCustomerId: "customer-one", sourceType: "public_lead", customerSource: "public_lead_released", recordStatus: "active", workNumber: "JOB-1", title: "Home upgrade" };
const target = { kind: "customer", id: "customer-one", customerSection: "qa", workOrderId: "job-one", questionId: "question-one", nonce: 12 };

test("customer Q&A includes only this customer's released, active TLink jobs and focuses the exact notification once", async t => {
  const focused = [], entries = new Map(); const section = { open: false };
  const entry = id => { if (!entries.has(id)) entries.set(id, { open: false, scrollIntoView: () => focused.push(`scroll:${id}`), querySelector: () => ({ focus: () => focused.push(`focus:${id}`) }) }); return entries.get(id); };
  const jobs = [job, { ...job, id: "other-customer", crmCustomerId: "customer-two" }, { ...job, id: "trade-owned", customerSource: "trade_owned" },
    { ...job, id: "protected", customerSource: "platform_private" }, { ...job, id: "other-source", sourceType: "manual" }, { ...job, id: "archived", recordStatus: "archived" }];
  const h = harness(t, async () => response(view), { qa: true, component: "CustomerQa", props: { customerId: "customer-one", jobs, target },
    beforeEffects(tree) { if (!tree) return; tree.props.ref.current = section;
      for (const node of nodes(tree, node => typeof node.type === "function" && node.type.name === "CustomerQaJob")) node.props.register(entry(node.props.job.id)); } });
  let tree = await h.settle(); const children = nodes(tree, node => typeof node.type === "function" && node.type.name === "CustomerQaJob");
  assert.deepEqual(children.map(node => node.props.job.id), ["job-one"]);
  assert.equal(children[0].props.questionId, "question-one"); assert.equal(children[0].props.navigationNonce, 12);
  assert.equal(section.open, true); assert.equal(entries.get("job-one").open, true);
  assert.deepEqual(focused, ["scroll:job-one", "focus:job-one"]);
  tree = await h.settle(); assert.equal(focused.length, 2);
  h.setProps({ customerId: "customer-one", jobs, target: { ...target, workOrderId: "other-customer", nonce: 13 } });
  tree = await h.settle(); assert.match(text(tree), /no longer available in this customer record/); assert.equal(focused.length, 2);
});

test("a customer record mounts its job conversation on first expansion and preserves it when collapsed", async t => {
  const h = harness(t, async () => response(view), { qa: true, component: "CustomerQaJob", props: { job, register() {} } });
  let tree = await h.settle(); assert.equal(nodes(tree, node => node.type === "TradeCustomerHubPanel").length, 0);
  tree.props.onToggle({ currentTarget: { open: true } }); tree = h.render();
  assert.equal(nodes(tree, node => node.type === "TradeCustomerHubPanel")[0].props.workOrderId, "job-one");
  tree.props.onToggle({ currentTarget: { open: false } }); tree = h.render();
  assert.equal(nodes(tree, node => node.type === "TradeCustomerHubPanel")[0].props.workOrderId, "job-one");
});
