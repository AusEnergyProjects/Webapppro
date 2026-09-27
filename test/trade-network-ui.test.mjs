import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";
import * as contract from "../src/lib/trade-network.ts";

const source = fs.readFileSync(new URL("../src/components/TradeNetworkWorkspace.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const text = node => node == null || typeof node === "boolean" ? "" : typeof node === "string" || typeof node === "number" ? String(node) : Array.isArray(node) ? node.map(text).join(" ") : typeof node.type === "function" ? text(node.type(node.props)) : text(node.props?.children);
function nodes(node, predicate) {
  if (!node || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap(child => nodes(child, predicate));
  if (typeof node.type === "function") return nodes(node.type(node.props), predicate);
  return [...(predicate(node) ? [node] : []), ...nodes(node.props?.children, predicate)];
}
const button = (tree, label) => nodes(tree, node => node.type === "button" && text(node) === label)[0];
const field = (tree, label) => {
  const parent = nodes(tree, node => node.type === "label" && text(node.props.children[0]) === label)[0];
  assert.ok(parent, `Missing field ${label}`);
  return nodes(parent, node => ["input", "select", "textarea"].includes(node.type))[0];
};
const form = (tree, label) => nodes(tree, node => node.type === "form" && button(node, label))[0];
const tick = () => new Promise(resolve => setImmediate(resolve));
const response = body => Response.json({ ok: true, ...body });
const post = (changes = {}) => ({ id: "b2510244-bf9b-45b5-994c-75cd84c301d0", kind: "work", title: "Plumber needed", trade: "Plumbing", suburb: "Richmond", postcode: "3121", state: "VIC", details: "Help with hot water installs.", rateCents: 9000, rateUnit: "hour", startsOn: "", endsOn: "", businessName: "Example Plumbing", isOwn: false, status: "active", revision: 1, expiresAt: "2026-10-27T00:00:00Z", createdAt: "2026-09-27T00:00:00Z", updatedAt: "2026-09-27T00:00:00Z", enquiryId: "", ...changes });
const enquiry = { id: "20c4c35e-476c-4f77-9fba-e15371952f45", postId: post().id, postTitle: "Roofing work", postKind: "work", businessName: "Private Respondent", direction: "incoming", message: "Available tomorrow", senderContact: { name: "Pat Private", email: "private@example.test", phone: "0400000000" }, recipientContact: null, status: "pending", revision: 1, createdAt: "2026-09-27T00:00:00Z", updatedAt: "2026-09-27T00:00:00Z" };
const workspace = changes => ({ enabled: true, canManageMembership: true, posts: [post()], myPosts: [], enquiries: [], hasMore: false, myHasMore: false, enquiriesHasMore: false, ...changes });
function harness(t, options = {}) {
  let cursor = 0, uuid = 0, stopped = false;
  const state = [], effects = [], pending = [], requests = [];
  const hooks = {
    useState(initial) { const i = cursor++; if (!(i in state)) state[i] = typeof initial === "function" ? initial() : initial; return [state[i], value => { state[i] = typeof value === "function" ? value(state[i]) : value; }]; },
    useRef(initial) { const i = cursor++; return state[i] ||= { current: initial }; },
    useMemo(factory, deps) { const i = cursor++; if (!state[i] || deps.some((value, j) => value !== state[i].deps[j])) state[i] = { deps, value: factory() }; return state[i].value; },
    useCallback(callback, deps) { return hooks.useMemo(() => callback, deps); },
    useEffect(callback, deps) { const i = cursor++, previous = effects[i]; if (!previous || deps.some((value, j) => value !== previous.deps[j])) { previous?.cleanup?.(); effects[i] = { deps }; pending.push(() => { effects[i].cleanup = callback(); }); } },
  };
  const exports = {}, dependencies = { react: hooks, "react/jsx-runtime": jsx, "@/lib/trade-network": contract, "./TradeNetworkWorkspace.module.css": { default: {} } };
  const fetch = async (url, init = {}) => {
    const request = { url, init, body: init.body ? JSON.parse(init.body) : undefined }; requests.push(request);
    if (options.respond) return options.respond(request, requests);
    return response(init.method === "POST" ? {} : workspace(options.data));
  };
  Function("require", "exports", "fetch", "crypto", compiled)(id => { assert.ok(dependencies[id], id); return dependencies[id]; }, exports, fetch, { randomUUID: () => `c83ddf25-1c1c-4adb-9c74-${String(++uuid).padStart(12, "0")}` });
  const props = { user: { uid: "owner-a", displayName: "Alex", email: "alex@example.test", getIdToken: async () => "private-token" } };
  const render = () => { cursor = 0; const tree = exports.TradeNetworkWorkspace(props); for (const callback of pending.splice(0)) callback(); return tree; };
  const cleanup = () => { if (stopped) return; stopped = true; for (const effect of effects) effect?.cleanup?.(); };
  t.after(cleanup);
  return { props, requests, render, cleanup, async settle() { let tree; for (let i = 0; i < 5; i++) { tree = render(); await tick(); } return tree; } };
}
function change(h, label, value) { field(h.render(), label).props.onChange({ target: { value } }); }
function submit(tree, label) { const selected = form(tree, label); assert.ok(selected, `Missing form ${label}`); selected.props.onSubmit({ preventDefault() {} }); }
function fillPost(h) {
  for (const [label, value] of [["Title", "Plumber for installs"], ["Trade", "Plumbing"], ["Suburb", "Richmond"], ["Postcode", "3121"], ["State", "VIC"], ["What do you need?", "Plumbing work next week."]]) change(h, label, value);
}
test("default-off UI hides feed and contacts, offers owner join and gives members a clear message", async t => {
  const h = harness(t, { data: { enabled: false, posts: [], enquiries: [enquiry] } });
  let tree = await h.settle();
  assert.ok(button(tree, "Join trade network")); assert.equal(button(tree, "Need a subcontractor"), undefined);
  assert.doesNotMatch(text(tree), /private@example|Pat Private|Plumber needed/);
  assert.equal(h.requests.filter(request => request.body).length, 0);
  button(tree, "Join trade network").props.onClick(); await tick();
  assert.deepEqual(h.requests.find(request => request.body).body, { action: "membership", enabled: true });
  const member = harness(t, { data: { enabled: false, canManageMembership: false, posts: [] } });
  tree = await member.settle(); assert.equal(button(tree, "Join trade network"), undefined);
  assert.match(text(tree), /Ask your business owner/);
});
test("enquiry contact review requires submission, blocks double click and retains its id on failed retry", async t => {
  let writes = 0;
  const h = harness(t, { respond: request => {
    if (!request.body) return response(workspace());
    if (++writes === 1) return Promise.reject(new Error("Connection lost"));
    return response({});
  } });
  let tree = await h.settle(); button(tree, "Enquire").props.onClick(); tree = h.render();
  assert.match(text(tree), /By selecting.*Send enquiry.*share these contact details with.*Example Plumbing/);
  assert.equal(h.requests.filter(request => request.body).length, 0);
  change(h, "Your message", "We can help next week."); change(h, "Business email", "reviewed@example.test");
  tree = h.render(); submit(tree, "Send enquiry"); submit(tree, "Send enquiry"); await tick();
  assert.equal(h.requests.filter(request => request.body).length, 1);
  tree = h.render(); assert.match(text(tree), /Connection lost/);
  submit(tree, "Send enquiry"); await tick();
  const sent = h.requests.filter(request => request.body);
  assert.equal(sent.length, 2); assert.equal(sent[0].body.id, sent[1].body.id);
  assert.equal(sent[1].body.confirmSharing, true); assert.equal(sent[1].body.contact.email, "reviewed@example.test");
  assert.equal(sent[1].init.headers.get("Authorization"), "Bearer private-token");
  assert.equal(sent[1].init.cache, "no-store");
});
test("post rates reject invalid decimal inputs and preserve exact cents in the whole post", async t => {
  const h = harness(t); let tree = await h.settle(); button(tree, "Need a subcontractor").props.onClick(); fillPost(h);
  for (const invalid of ["-1", "2.345", "abc", "1e3"]) {
    change(h, "Offered rate (ex GST)", invalid); submit(h.render(), "Post work"); tree = h.render();
    assert.match(text(tree), /Enter a rate with up to two decimal places/);
    assert.equal(h.requests.filter(request => request.body).length, 0);
  }
  change(h, "Offered rate (ex GST)", "22.50"); submit(h.render(), "Post work"); await tick();
  const saved = h.requests.find(request => request.body).body;
  assert.equal(saved.post.rateCents, 2250); assert.equal(saved.post.rateUnit, "hour"); assert.equal(saved.expectedRevision, 0);
});
test("enquiry message validation matches the server limits and never sends an empty introduction", async t => {
  const h = harness(t); let tree = await h.settle(); button(tree, "Enquire").props.onClick();
  assert.equal(field(h.render(), "Your message").props.maxLength, 1200);
  for (const message of ["", "   ", "x".repeat(1201)]) {
    change(h, "Your message", message); submit(h.render(), "Send enquiry"); await tick();
    tree = h.render(); assert.ok(nodes(tree, node => node.props?.role === "alert").length);
    assert.equal(h.requests.filter(request => request.body).length, 0);
  }
});
test("incoming enquiry does not share the poster contact until the reviewed Connect form is submitted", async t => {
  const h = harness(t, { data: { enquiries: [enquiry] } }); let tree = await h.settle();
  button(tree, "Enquiries").props.onClick(); tree = await h.settle();
  assert.match(text(tree), /private@example.test/); button(tree, "Connect").props.onClick(); tree = h.render();
  assert.match(text(tree), /By selecting.*Connect.*share these contact details with.*Private Respondent/);
  assert.equal(h.requests.filter(request => request.body).length, 0);
  change(h, "Business email", "chosen-contact@example.test"); submit(h.render(), "Connect"); await tick();
  const sent = h.requests.find(request => request.body).body;
  assert.equal(sent.action, "connect"); assert.equal(sent.id, enquiry.id); assert.equal(sent.expectedRevision, enquiry.revision);
  assert.equal(sent.confirmSharing, true); assert.equal(sent.contact.email, "chosen-contact@example.test");
});
test("filter apply and pagination send the selected query and reset the feed page", async t => {
  const h = harness(t, { data: { hasMore: true } }); let tree = await h.settle();
  button(tree, "Next").props.onClick(); tree = await h.settle();
  assert.equal(new URL(h.requests.at(-1).url, "https://tlink.test").searchParams.get("offset"), "50");
  change(h, "Trade", "Electrical"); change(h, "State", "VIC"); change(h, "Search", "3121");
  submit(h.render(), "Search"); tree = await h.settle();
  const query = new URL(h.requests.at(-1).url, "https://tlink.test").searchParams;
  assert.equal(query.get("trade"), "Electrical"); assert.equal(query.get("state"), "VIC"); assert.equal(query.get("search"), "3121"); assert.equal(query.get("offset"), "0");
  assert.equal(field(tree, "Search").props.maxLength, 100);
  button(tree, "Available trades").props.onClick(); await h.settle();
  assert.equal(new URL(h.requests.at(-1).url, "https://tlink.test").searchParams.get("kind"), "available");
});
test("a stale load is aborted and cannot replace a newer business workspace", async t => {
  const pending = [];
  const h = harness(t, { respond: () => new Promise(resolve => pending.push(resolve)) });
  h.render(); await tick();
  h.props.user = { ...h.props.user, uid: "owner-b" }; h.render(); await tick();
  assert.equal(h.requests[0].init.signal.aborted, true);
  pending[1](response(workspace({ posts: [post({ title: "Latest business feed" })] }))); await tick();
  pending[0](response(workspace({ posts: [post({ title: "Stale private feed" })] }))); await tick();
  const tree = h.render(); assert.match(text(tree), /Latest business feed/); assert.doesNotMatch(text(tree), /Stale private feed/);
  h.cleanup(); assert.equal(h.requests[1].init.signal.aborted, true);
});
test("leaving clears an unfinished editor and keeps prior private enquiries accessible", async t => {
  let enabled = true;
  const h = harness(t, { respond: request => {
    if (request.body) { enabled = request.body.enabled; return response({ enabled }); }
    return response(workspace({ enabled, posts: enabled ? [post()] : [], enquiries: [enquiry] }));
  } });
  let tree = await h.settle(); button(tree, "Need a subcontractor").props.onClick(); change(h, "Title", "Unpublished private draft");
  button(h.render(), "Leave trade network").props.onClick(); tree = await h.settle();
  assert.ok(button(tree, "Join trade network")); assert.equal(button(tree, "Post work"), undefined);
  assert.doesNotMatch(text(tree), /Unpublished private draft|Pat Private/);
  button(tree, "Enquiries").props.onClick(); tree = await h.settle();
  assert.match(text(tree), /Private Respondent/); assert.match(text(tree), /private@example.test/);
  assert.equal(button(tree, "Connect"), undefined);
});
