import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";
import * as contract from "../src/lib/trade-network.ts";

const source = fs.readFileSync(new URL("../src/components/TradeNetworkWorkspace.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const text = node => node == null || typeof node === "boolean" || node.props?.["aria-hidden"] === "true" ? "" : typeof node === "string" || typeof node === "number" ? String(node) : Array.isArray(node) ? node.map(text).join(" ") : typeof node.type === "function" ? text(node.type(node.props)) : text(node.props?.children);
function nodes(node, predicate) {
  if (!node || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap(child => nodes(child, predicate));
  if (typeof node.type === "function") return nodes(node.type(node.props), predicate);
  return [...(predicate(node) ? [node] : []), ...nodes(node.props?.children, predicate)];
}
const button = (tree, label) => nodes(tree, node => node.type === "button" && text(node).trim() === label)[0];
const viewButton = (tree, label) => nodes(tree, node => node.type === "button" && "aria-pressed" in node.props && text(node).trim().startsWith(label))[0];
const workSwitch = tree => nodes(tree, node => node.props?.role === "switch" && node.props["aria-label"] === "Open to work")[0];
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
const availability = changes => ({ openToWork: true, workTrades: ["Plumbing"], minimumRates: { hour: null, day: null, job: null }, serviceAreas: [{ postcode: "3121", radiusKm: 20 }], serviceStates: ["VIC"], paused: false, ...changes });
const lead = changes => ({ ...post(), leadStatus: "new", receivedAt: "2026-09-27T00:00:00Z", ...changes });
const workspace = changes => ({ enabled: true, canManageMembership: true, posts: [post()], myPosts: [], enquiries: [], hasMore: false, myHasMore: false, enquiriesHasMore: false,
  availability: availability(), leads: changes?.enabled === false ? [] : [lead()], leadCount: changes?.enabled === false ? 0 : 1, leadsHasMore: false,
  workPostAllowance: { limit: 5, remaining: 5, day: "2026-09-27", timeZone: "Australia/Sydney" }, ...changes });
function harness(t, options = {}) {
  let cursor = 0, uuid = 0, stopped = false;
  const state = [], effects = [], pending = [], requests = [], serviceAreaOpens = [], clearedPosts = [];
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
  const props = { user: { uid: "owner-a", displayName: "Alex", email: "alex@example.test", getIdToken: async () => "private-token" },
    onOpenServiceAreas: () => serviceAreaOpens.push(true), onClearPost: () => { clearedPosts.push(props.initialPostId); props.initialPostId = ""; }, ...options.props };
  const render = () => { cursor = 0; const tree = exports.TradeNetworkWorkspace(props); for (const callback of pending.splice(0)) callback(); return tree; };
  const cleanup = () => { if (stopped) return; stopped = true; for (const effect of effects) effect?.cleanup?.(); };
  t.after(cleanup);
  return { props, requests, serviceAreaOpens, clearedPosts, render, cleanup, async settle() { let tree; for (let i = 0; i < 5; i++) { tree = render(); await tick(); } return tree; } };
}
function change(h, label, value) { field(h.render(), label).props.onChange({ target: { value } }); }
function submit(tree, label) { const selected = form(tree, label); assert.ok(selected, `Missing form ${label}`); selected.props.onSubmit({ preventDefault() {} }); }
function fillPost(h, kind = "work") {
  for (const [label, value] of [["Title", "Plumber for installs"], ["Trade", "Plumbing"], ["Suburb", "Richmond"], ["Postcode", "3121"], ["State", "VIC"], [kind === "work" ? "What do you need?" : "What work can you help with?", "Plumbing work next week."]]) change(h, label, value);
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
  button(tree, "Work available").props.onClick(); tree = await h.settle();
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
  pending[1](response(workspace({ leads: [lead({ title: "Latest business feed" })] }))); await tick();
  pending[0](response(workspace({ leads: [lead({ title: "Stale private feed" })] }))); await tick();
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

test("first Open to work toggle chooses trades before one save enables matching", async t => {
  let current = availability({ openToWork: false, workTrades: [] }), finish;
  const h = harness(t, { respond: request => {
    if (!request.body) return response(workspace({ availability: current, leads: [], leadCount: 0 }));
    return new Promise(resolve => { finish = () => { current = { ...current, openToWork: request.body.openToWork, workTrades: request.body.workTrades }; resolve(response({ availability: current })); }; });
  } });
  let tree = await h.settle(); assert.equal(workSwitch(tree).props["aria-checked"], false);
  workSwitch(tree).props.onClick(); tree = h.render();
  assert.ok(button(tree, "Save and switch on")); assert.equal(h.requests.filter(request => request.body).length, 0);
  submit(tree, "Save and switch on"); tree = h.render();
  assert.match(text(tree), /Choose at least one trade/); assert.equal(h.requests.filter(request => request.body).length, 0);
  button(tree, "Plumbing").props.onClick(); button(h.render(), "Electrical").props.onClick(); tree = h.render();
  const chooseForm = form(tree, "Save and switch on"); chooseForm.props.onSubmit({ preventDefault() {} }); chooseForm.props.onSubmit({ preventDefault() {} });
  await tick(); tree = h.render();
  assert.equal(workSwitch(tree).props.disabled, true); assert.equal(workSwitch(tree).props["aria-checked"], false);
  const writes = h.requests.filter(request => request.body); assert.equal(writes.length, 1);
  assert.deepEqual(writes[0].body, { action: "availability", openToWork: true, workTrades: ["Plumbing", "Electrical"], minimumRates: { hour: null, day: null, job: null } });
  finish(); tree = await h.settle();
  assert.equal(workSwitch(tree).props["aria-checked"], true); assert.match(text(tree), /You're open to work/);
  assert.equal(button(tree, "Save and switch on"), undefined);
});

test("availability server rejection retains the prior switch and chosen trades without false success", async t => {
  const h = harness(t, { respond: request => request.body ? Response.json({ ok: false, error: "Business availability is paused." }, { status: 409 })
    : response(workspace({ availability: availability({ openToWork: false, workTrades: [] }), leads: [], leadCount: 0 })) });
  let tree = await h.settle(); workSwitch(tree).props.onClick(); button(h.render(), "Plumbing").props.onClick(); submit(h.render(), "Save and switch on");
  tree = await h.settle(); assert.equal(workSwitch(tree).props["aria-checked"], false);
  assert.match(text(tree), /Business availability is paused/); assert.doesNotMatch(text(tree), /Your work preferences are saved|You're open to work/);
  assert.equal(button(tree, "Plumbing").props["aria-pressed"], true); assert.ok(button(tree, "Save and switch on"));
  assert.equal(h.requests.filter(request => request.body).length, 1);
});

test("Open to work switches off directly with saved trades and service-area edits use the callback", async t => {
  const h = harness(t, { data: { availability: availability({ minimumRates: { hour: 9000, day: 65000, job: 120000 } }) } }); let tree = await h.settle();
  button(tree, "Edit service area").props.onClick(); assert.deepEqual(h.serviceAreaOpens, [true]);
  assert.equal(h.requests.filter(request => request.body).length, 0);
  workSwitch(tree).props.onClick(); await tick();
  assert.deepEqual(h.requests.find(request => request.body).body, { action: "availability", openToWork: false, workTrades: ["Plumbing"] });
});

test("Your leads is the default view and has its own count and pagination", async t => {
  const h = harness(t, { data: { leadCount: 72, leadsHasMore: true, hasMore: false } }); let tree = await h.settle();
  assert.equal(viewButton(tree, "Your leads").props["aria-pressed"], true); assert.match(text(viewButton(tree, "Your leads")), /72/);
  assert.equal(nodes(tree, node => node.type === "input" && node.props.type === "search").length, 0);
  button(tree, "Next").props.onClick(); tree = await h.settle();
  let query = new URL(h.requests.at(-1).url, "https://tlink.test").searchParams;
  assert.equal(query.get("leadsOffset"), "50"); assert.equal(query.get("offset"), "0"); assert.match(text(tree), /Page\s+2/);
  button(tree, "Previous").props.onClick(); tree = await h.settle();
  query = new URL(h.requests.at(-1).url, "https://tlink.test").searchParams;
  assert.equal(query.get("leadsOffset"), "0"); assert.equal(button(tree, "Previous").props.disabled, true);
});

test("dismissing a matched lead sends its exact post id and refreshes the inbox and count", async t => {
  let dismissed = false;
  const h = harness(t, { respond: request => {
    if (request.body) { dismissed = true; return response({}); }
    return response(workspace({ leads: dismissed ? [] : [lead()], leadCount: dismissed ? 0 : 1 }));
  } });
  let tree = await h.settle(); button(tree, "Dismiss").props.onClick(); tree = await h.settle();
  assert.deepEqual(h.requests.find(request => request.body).body, { action: "lead_status", id: post().id, status: "dismissed" });
  assert.match(text(tree), /Lead dismissed/); assert.doesNotMatch(text(tree), /Plumber needed/);
  assert.equal(text(viewButton(tree, "Your leads")).trim(), "Your leads");
});

test("notification entry requests its exact lead and clearing it returns to all matched leads", async t => {
  const exactId = "a71eec55-d146-41aa-bd9c-e96e3f7f0272";
  const h = harness(t, { props: { initialPostId: exactId }, respond: request => {
    const exact = new URL(request.url, "https://tlink.test").searchParams.get("leadPostId");
    return response(workspace({ leads: exact ? [lead({ id: exactId, title: "Exact notified lead" })] : [lead()] }));
  } });
  let tree = await h.settle();
  assert.equal(new URL(h.requests[0].url, "https://tlink.test").searchParams.get("leadPostId"), exactId);
  assert.match(text(tree), /Exact notified lead/); assert.doesNotMatch(text(tree), /Plumber needed/);
  button(tree, "All your leads").props.onClick(); tree = await h.settle();
  assert.deepEqual(h.clearedPosts, [exactId]); assert.equal(new URL(h.requests.at(-1).url, "https://tlink.test").searchParams.has("leadPostId"), false);
  assert.match(text(tree), /Plumber needed/); assert.equal(button(tree, "All your leads"), undefined);
});

test("an unavailable exact lead stays empty instead of opening a directory record", async t => {
  const h = harness(t, { props: { initialPostId: post().id }, data: { leads: [], leadCount: 0, posts: [post({ title: "Unrelated directory work" })] } });
  const tree = await h.settle(); assert.match(text(tree), /This lead is no longer available/);
  assert.doesNotMatch(text(tree), /Unrelated directory work/); assert.equal(button(tree, "Enquire"), undefined); assert.equal(button(tree, "Dismiss"), undefined);
  assert.equal(h.clearedPosts.length, 0); assert.equal(h.requests.length, 1);
});

test("minimum rates prefill in dollars, save exact cents for every unit and clear back to any price", async t => {
  let current = availability({ minimumRates: { hour: 9550, day: 65000, job: null } });
  const h = harness(t, { respond: request => {
    if (!request.body) return response(workspace({ availability: current }));
    current = { ...current, minimumRates: request.body.minimumRates };
    return response({ availability: current });
  } });
  let tree = await h.settle(); assert.match(text(tree), /Minimums:.*95\.5.*hour.*650.*day.*ex GST/);
  button(tree, "Trades & rates").props.onClick(); tree = h.render();
  assert.equal(field(tree, "Per hour").props.value, "95.50"); assert.equal(field(tree, "Per day").props.value, "650.00"); assert.equal(field(tree, "Per job").props.value, "");
  assert.match(text(tree), /Only jobs meeting the matching minimum arrive as leads. You can still browse all posts/);
  change(h, "Per hour", "100.25"); change(h, "Per day", "750.50"); change(h, "Per job", "1000");
  submit(h.render(), "Save preferences"); tree = await h.settle();
  assert.deepEqual(h.requests.find(request => request.body).body, { action: "availability", openToWork: true, workTrades: ["Plumbing"], minimumRates: { hour: 10025, day: 75050, job: 100000 } });
  assert.match(text(tree), /Your work preferences are saved/); assert.equal(button(tree, "Save preferences"), undefined);
  button(tree, "Trades & rates").props.onClick(); tree = h.render();
  assert.equal(field(tree, "Per hour").props.value, "100.25"); assert.equal(field(tree, "Per day").props.value, "750.50"); assert.equal(field(tree, "Per job").props.value, "1000.00");
  for (const label of ["Per hour", "Per day", "Per job"]) change(h, label, "");
  submit(h.render(), "Save preferences"); tree = await h.settle();
  assert.deepEqual(h.requests.filter(request => request.body).at(-1).body.minimumRates, { hour: null, day: null, job: null });
  assert.doesNotMatch(text(tree), /Minimums:/);
});

test("invalid optional minimum rates are rejected before any save for each rate type", async t => {
  const h = harness(t); const tree = await h.settle(); button(tree, "Trades & rates").props.onClick();
  for (const label of ["Per hour", "Per day", "Per job"]) {
    for (const value of ["0", "0.00", "-1", "1.234", "1e3", "not money", "1000000.01"]) {
      change(h, label, value); submit(h.render(), "Save preferences"); await tick();
      assert.ok(nodes(h.render(), node => node.props?.role === "alert").length, `${label}: ${value} must show an error`);
      assert.equal(h.requests.filter(request => request.body).length, 0);
    }
    change(h, label, "");
  }
});

test("cancelling trades and minimum rates sends no mutation and restores saved preferences", async t => {
  const h = harness(t, { data: { availability: availability({ minimumRates: { hour: 9000, day: null, job: null } }) } });
  let tree = await h.settle(); button(tree, "Trades & rates").props.onClick();
  change(h, "Per hour", "125.50"); button(h.render(), "Electrical").props.onClick(); button(h.render(), "Cancel").props.onClick();
  tree = h.render(); assert.equal(h.requests.filter(request => request.body).length, 0); assert.equal(button(tree, "Save preferences"), undefined);
  button(tree, "Trades & rates").props.onClick(); tree = h.render();
  assert.equal(field(tree, "Per hour").props.value, "90.00"); assert.equal(button(tree, "Electrical").props["aria-pressed"], false);
  assert.equal(button(tree, "Plumbing").props["aria-pressed"], true);
});

for (const kind of ["work", "available"]) test(`${kind} posts require a positive price before submission`, async t => {
  const h = harness(t); let tree = await h.settle();
  if (kind === "work") button(tree, "Need a subcontractor").props.onClick();
  else { button(tree, "Available trades").props.onClick(); tree = await h.settle(); button(tree, "List my business").props.onClick(); }
  fillPost(h, kind);
  const priceLabel = kind === "work" ? "Offered rate (ex GST)" : "Minimum rate (ex GST)", submitLabel = kind === "work" ? "Post work" : "Post availability";
  assert.equal(field(h.render(), priceLabel).props.required, true);
  for (const value of ["", "   ", "0", "0.00"]) {
    change(h, priceLabel, value); submit(h.render(), submitLabel); tree = h.render();
    assert.match(text(tree), /Enter a price before posting|Enter a price greater than zero/);
    assert.equal(h.requests.filter(request => request.body).length, 0);
  }
  change(h, priceLabel, "125.50"); change(h, "Rate per", "job"); submit(h.render(), submitLabel); await tick();
  assert.equal(h.requests.find(request => request.body).body.post.rateCents, 12550);
  assert.equal(h.requests.find(request => request.body).body.post.rateUnit, "job");
});

for (const [status, rateCents] of [["closed", null], ["expired", 0]]) test(`legacy ${status} unpriced posts open the price editor before renewal`, async t => {
  const legacy = post({ isOwn: true, status, rateCents, revision: 3 });
  const h = harness(t, { data: { myPosts: [legacy], workPostAllowance: { limit: 5, remaining: 0, day: "2026-09-27", timeZone: "Australia/Sydney" } } }); let tree = await h.settle();
  button(tree, "My posts").props.onClick(); tree = await h.settle();
  assert.equal(button(tree, "Renew post"), undefined); button(tree, "Add price to renew").props.onClick(); tree = h.render();
  assert.ok(button(tree, "Save changes")); assert.equal(field(tree, "Offered rate (ex GST)").props.required, true);
  assert.equal(h.requests.filter(request => request.body).length, 0);
  submit(tree, "Save changes"); await tick(); assert.equal(h.requests.filter(request => request.body).length, 0);
  change(h, "Offered rate (ex GST)", "90"); submit(h.render(), "Save changes"); await tick();
  const saved = h.requests.find(request => request.body).body;
  assert.equal(saved.action, "save_post"); assert.equal(saved.id, legacy.id); assert.equal(saved.expectedRevision, 3); assert.equal(saved.post.rateCents, 9000);
});

test("daily work quota shows the remaining count and blocks new work and renewals while allowing existing edits", async t => {
  const h = harness(t, { data: { workPostAllowance: { limit: 5, remaining: 0, day: "2026-09-27", timeZone: "Australia/Sydney" }, myPosts: [post({ isOwn: true, status: "closed" })] } });
  let tree = await h.settle(); assert.equal(button(tree, "Need a subcontractor").props.disabled, true);
  assert.match(text(tree), /0\s+of\s+5\s+job posts left today/); assert.match(text(tree), /Resets at midnight Sydney time/); assert.match(text(tree), /New posts and renewals count/);
  button(tree, "My posts").props.onClick(); tree = await h.settle(); assert.equal(button(tree, "Renew post").props.disabled, true);
  assert.equal(button(tree, "Edit").props.disabled, false); button(tree, "Edit").props.onClick(); tree = h.render();
  assert.ok(button(tree, "Save changes")); assert.equal(button(tree, "Save changes").props.disabled, false);
  button(tree, "Cancel").props.onClick(); button(h.render(), "Available trades").props.onClick(); tree = await h.settle();
  assert.equal(button(tree, "List my business").props.disabled, false);
  const available = harness(t, { data: { workPostAllowance: { limit: 5, remaining: 2, day: "2026-09-27", timeZone: "Australia/Sydney" } } });
  tree = await available.settle(); assert.match(text(tree), /2\s+of\s+5\s+job posts left today/); assert.equal(button(tree, "Need a subcontractor").props.disabled, false);
});
