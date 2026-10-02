import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";

const source = fs.readFileSync(new URL("../src/components/PortalProfileAvatar.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const nodes = (node, predicate) => !node || typeof node !== "object" ? [] : Array.isArray(node) ? node.flatMap(child => nodes(child, predicate)) : [...(predicate(node) ? [node] : []), ...nodes(node.props?.children, predicate)];
const text = node => node == null || typeof node === "boolean" ? "" : typeof node !== "object" ? String(node) : Array.isArray(node) ? node.map(text).join(" ") : text(node.props?.children);
const flush = () => new Promise(resolve => setImmediate(resolve));
function harness(props = {}) {
  let cursor = 0; const slots = [], effects = [], queued = [], requests = [], released = [], events = [];
  const hooks = {
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = initial; return [slots[index], value => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }]; },
    useRef(initial) { const index = cursor++; return slots[index] ||= { current: initial }; },
    useEffect(effect, dependencies) { const index = cursor++; if (!effects[index] || dependencies.some((value, position) => value !== effects[index].dependencies[position])) {
      effects[index]?.cleanup?.(); effects[index] = { dependencies }; queued.push(() => { effects[index].cleanup = effect(); });
    } },
  };
  const loaded = {}, input = { workspace: "creditex", user: { uid: "user-a", getIdToken: async () => "token-a" }, name: "Alice Smith", editable: true, ...props };
  Function("require", "exports", "window", "fetch", "URL", `${compiled}\nexports.ProfileAvatar=ProfileAvatar;`)(name => {
    if (name === "react") return hooks;
    if (name === "react/jsx-runtime") return jsx;
    if (name === "next/image") return { default: "image" };
    if (name === "@/lib/trade-message-media-client") return { prepareMessagePhoto: async file => new File([await file.arrayBuffer()], "profile.jpg", { type: "image/jpeg" }) };
    if (name.endsWith(".module.css")) return { default: new Proxy({}, { get: (_, key) => key }) };
    throw Error(name);
  }, loaded, { addEventListener() {}, removeEventListener() {}, dispatchEvent: event => events.push(event) },
  (url, init) => new Promise(resolve => requests.push({ url, init, reply(result, status = 200) { resolve({ ok: status < 400, status, json: async () => result, blob: async () => new Blob(["private photo"]) }); } })),
  { createObjectURL: () => "blob:private", revokeObjectURL: value => released.push(value) });
  return { input, requests, released, events, wrapper: loaded.PortalProfileAvatar,
    render() { cursor = 0; const tree = loaded.ProfileAvatar(input); for (const effect of queued.splice(0)) effect(); return tree; },
    cleanup() { for (const effect of effects) effect?.cleanup?.(); } };
}

test("profile photo uses authenticated metadata and private bytes and revokes its browser URL on unmount", async () => {
  const h = harness(); h.render(); await flush();
  assert.match(h.requests[0].url, /workspace=creditex&metadata=1/);
  assert.equal(h.requests[0].init.headers.Authorization, "Bearer token-a");
  h.requests[0].reply({ ok: true, memberId: "a", revision: "revision-a" }); await flush(); h.render(); await flush();
  assert.match(h.requests[1].url, /memberId=a&revision=revision-a/);
  h.requests[1].reply({}); await flush(); const tree = h.render();
  assert.equal(nodes(tree, node => node.type === "image")[0].props.src, "blob:private");
  h.cleanup(); assert.deepEqual(h.released, ["blob:private"]);
});

test("teammates without a photo keep their initials and never load the signed-in member's photo", () => {
  const h = harness(); const element = h.wrapper({ ...h.input, memberId: "someone-else", revision: undefined, editable: false });
  assert.equal(element.props.revision, "");
  assert.notEqual(element.key, h.wrapper({ ...h.input, user: { uid: "another-user" } }).key);
});

test("upload suppresses duplicate changes and a failed save leaves the current photo available", async () => {
  const h = harness(); h.render(); await flush(); h.requests[0].reply({ ok: true, memberId: "a", revision: "current" }); await flush();
  let tree = h.render(); await flush(); h.requests[1].reply({}); await flush(); tree = h.render();
  const file = new File(["photo bytes"], "upload.png", { type: "image/png" });
  const upload = nodes(tree, node => node.type === "input")[0].props.onChange;
  upload({ target: { files: [file], value: "name" } }); upload({ target: { files: [file], value: "name" } }); await flush();
  assert.equal(h.requests.filter(request => request.init.method === "POST").length, 1);
  assert.equal(h.requests[2].init.headers["Content-Type"], "image/jpeg");
  h.requests[2].reply({ error: "Access changed" }, 403); await flush(); tree = h.render();
  assert.match(text(tree), /Access changed/); assert.equal(nodes(tree, node => node.type === "image")[0].props.src, "blob:private");
  h.cleanup();
});

test("late private photo responses never create an image URL after unmount", async () => {
  const h = harness({ memberId: "b", revision: "revision-b", editable: false }); h.render(); await flush(); h.cleanup();
  h.requests[0].reply({}); await flush(); assert.equal(nodes(h.render(), node => node.type === "image").length, 0);
});
