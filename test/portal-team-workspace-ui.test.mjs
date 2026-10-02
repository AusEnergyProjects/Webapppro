import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";

const source = fs.readFileSync(new URL("../src/components/PortalTeamWorkspace.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const text = node => node == null || typeof node === "boolean" ? "" : typeof node !== "object" ? String(node) : Array.isArray(node) ? node.map(text).join(" ") : text(node.props?.children);
const nodes = (node, predicate) => !node || typeof node !== "object" ? [] : Array.isArray(node) ? node.flatMap(child => nodes(child, predicate)) : [...(predicate(node) ? [node] : []), ...nodes(node.props?.children, predicate)];
const button = (tree, label) => nodes(tree, node => node.type === "button" && text(node) === label)[0];
const flush = () => new Promise(resolve => setImmediate(resolve));
const message = { id: "message", senderId: "a", senderName: "A", recipientId: "b", body: "Existing message", createdAt: "2026-10-02T00:00:00.000Z" };
const history = () => ({ memberId: "a", messages: [message], before: "older-cursor", hasMore: false });
function harness(api, workspace = "admin", visibilityState = "visible") {
  let cursor = 0; const slots = [], effects = [], queued = [];
  const hooks = {
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial; return [slots[index], value => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }]; },
    useRef(initial) { const index = cursor++; return slots[index] ||= { current: initial }; },
    useEffect(effect, dependencies) { const index = cursor++; if (!effects[index] || dependencies.some((value, position) => value !== effects[index].dependencies[position])) {
      effects[index]?.cleanup?.(); effects[index] = { dependencies }; queued.push(() => { effects[index].cleanup = effect(); });
    } },
    useCallback: callback => callback,
  };
  const loaded = {};
  const notifications = [];
  Function("require", "exports", "document", "setInterval", "clearInterval", "window", `${compiled}\nexports.Conversation=Conversation;`)(name => {
    if (name === "react") return hooks;
    if (name === "react/jsx-runtime") return jsx;
    if (name === "@/lib/firebase-mfa") return { MFA_SETUP_URL: "/security" };
    if (name === "./PortalProfileAvatar") return { PortalProfileAvatar: () => null };
    if (name.endsWith(".module.css")) return { default: new Proxy({}, { get: (_, key) => key }) };
    throw Error(name);
  }, loaded, { visibilityState }, () => 1, () => {}, { dispatchEvent: event => notifications.push(event.type) });
  const render = () => { cursor = 0; const tree = loaded.Conversation({ api, peer: { id: "b", name: "B" }, workspace, user: { uid: "a" } }); for (const effect of queued.splice(0)) effect(); return tree; };
  const settle = async () => { render(); await flush(); return render(); };
  return { render, settle, notifications, wrapper: loaded.PortalTeamWorkspace, cleanup() { for (const effect of effects) effect?.cleanup?.(); } };
}
test("sending locks the draft and suppresses duplicate clicks, then clears it on success", async () => {
  let release; const sent = [];
  const h = harness(async (_query, body) => body ? new Promise(resolve => { sent.push(body); release = resolve; }) : history());
  let tree = await h.settle(); nodes(tree, node => node.type === "textarea")[0].props.onChange({ target: { value: "Hello team" } });
  tree = h.render(); const submit = nodes(tree, node => node.type === "form")[0].props.onSubmit;
  const pending = submit({ preventDefault() {} }); await submit({ preventDefault() {} });
  tree = h.render(); assert.equal(nodes(tree, node => node.type === "textarea")[0].props.disabled, true);
  assert.equal(sent.length, 1); assert.equal(sent[0].recipientId, "b"); assert.equal(sent[0].body, "Hello team");
  release({ id: sent[0].id }); await pending; tree = h.render();
  assert.equal(nodes(tree, node => node.type === "textarea")[0].props.value, ""); h.cleanup();
});
test("failed send retains the draft and repeats the same idempotency ID on retry", async () => {
  const sent = []; let fail = true;
  const h = harness(async (_query, body) => { if (!body) return history(); sent.push(body); if (fail) throw new Error("Connection interrupted"); return { id: body.id }; });
  let tree = await h.settle(); nodes(tree, node => node.type === "textarea")[0].props.onChange({ target: { value: "Please check" } });
  tree = h.render(); await nodes(tree, node => node.type === "form")[0].props.onSubmit({ preventDefault() {} });
  tree = h.render(); assert.equal(nodes(tree, node => node.type === "textarea")[0].props.value, "Please check");
  fail = false; await nodes(tree, node => node.type === "form")[0].props.onSubmit({ preventDefault() {} });
  assert.equal(sent[0].id, sent[1].id); h.cleanup();
});
test("a membership failure removes previously visible private messages", async () => {
  let denied = false;
  const h = harness(async () => { if (denied) throw new Error("Your workspace access changed."); return history(); });
  let tree = await h.settle(); assert.match(text(tree), /Existing message/);
  denied = true; button(tree, "Refresh").props.onClick(); tree = await h.settle();
  assert.doesNotMatch(text(tree), /Existing message/); assert.equal(button(tree, "Send message").props.disabled, true); h.cleanup();
});
test("an abandoned conversation ignores late history responses", async () => {
  let release; const h = harness(() => new Promise(resolve => { release = resolve; }));
  h.render(); h.cleanup(); release(history()); await flush();
  assert.doesNotMatch(text(h.render()), /Existing message/);
});
test("history uses the returned cursor and provides a direct return to latest messages", async () => {
  const requests = [];
  const h = harness(async query => { requests.push(query); return { ...history(), hasMore: !query.before, messages: [{ ...message, body: query.before ? "Older message" : "Newest message" }] }; });
  let tree = await h.settle(); button(tree, "Earlier messages").props.onClick(); tree = await h.settle();
  assert.equal(requests.at(-1).before, "older-cursor"); assert.match(text(tree), /Older message/);
  button(tree, "Latest messages").props.onClick(); tree = await h.settle();
  assert.equal(requests.at(-1).before, ""); assert.match(text(tree), /Newest message/); h.cleanup();
});
test("changing portal, account or tool discards the previous workspace component state", () => {
  const h = harness(async () => history()); const base = { workspace: "admin", user: { uid: "one" }, view: "connect" };
  const keys = [base, { ...base, workspace: "creditex" }, { ...base, user: { uid: "two" } }, { ...base, view: "tasks" }].map(props => h.wrapper(props).key);
  assert.equal(new Set(keys).size, 4);
});

test("visible incoming Creditex messages mark only rendered IDs as read and refresh the bell", async () => {
  const reads = [];
  const h = harness(async (_query, body) => {
    if (body) { reads.push(body); return { ok: true }; }
    return { ...history(), messages: [message, { ...message, id: "incoming", senderId: "b", recipientId: "a" }] };
  }, "creditex");
  await h.settle(); await flush(); h.render();
  assert.deepEqual(reads, [{ action: "read_messages", messageIds: ["incoming"] }]);
  assert.deepEqual(h.notifications, ["creditex-notifications-changed"]);
  h.render(); await flush(); assert.equal(reads.length, 1); h.cleanup();
});

test("hidden Creditex conversations do not mark notifications as read", async () => {
  const requests = [];
  const h = harness(async (_query, body) => { requests.push(body); return history(); }, "creditex", "hidden");
  await h.settle(); assert.deepEqual(requests, []); h.cleanup();
});
