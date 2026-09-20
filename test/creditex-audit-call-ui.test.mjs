import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";
import * as contracts from "../src/lib/creditex-audit-calls.ts";

const source = fs.readFileSync(new URL("../src/components/CreditexAuditCallPanel.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const text = node => node == null || typeof node === "boolean" ? "" : typeof node === "string" || typeof node === "number" ? String(node) : Array.isArray(node) ? node.map(text).join(" ") : text(node.props?.children);
const nodes = (node, predicate) => !node || typeof node !== "object" ? [] : Array.isArray(node) ? node.flatMap(child => nodes(child, predicate)) : [...(predicate(node) ? [node] : []), ...nodes(node.props?.children, predicate)];
const button = (tree, label) => nodes(tree, node => node.type === "button" && text(node) === label)[0];
const flush = () => new Promise(resolve => setImmediate(resolve));
const workspace = overrides => ({ ok: true, configured: true, unavailableReason: "", customerPhone: "+61400000001", canCall: true, calls: [], ...overrides });
const callRecord = overrides => ({ id: "audit-call-1", status: "completed", recordingStatus: "saved", createdAt: "2026-09-21T01:00:00Z", startedByName: "Test reviewer", durationSeconds: 90, consentedAt: "2026-09-21T01:01:00Z", savedAt: "2026-09-21T01:03:00Z", ...overrides });
const reply = (value, status = 200) => ({ ok: status < 400, status, json: async () => value });

function harness(options = {}) {
  const slots = [], effects = [], callbacks = [], queued = [], requests = [], clients = [], revoked = [], intervals = new Map();
  let cursor = 0, intervalId = 0, streamStops = 0, microphoneRequests = 0;
  const changed = (before, after) => !before || after.some((value, index) => value !== before[index]);
  const hooks = {
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial; return [slots[index], value => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }]; },
    useRef(initial) { const index = cursor++; if (!(index in slots)) slots[index] = { current: initial }; return slots[index]; },
    useCallback(callback, deps) { const index = cursor++; if (changed(callbacks[index]?.deps, deps)) callbacks[index] = { callback, deps }; return callbacks[index].callback; },
    useEffect(callback, deps) { const index = cursor++; if (changed(effects[index]?.deps, deps)) { effects[index]?.cleanup?.(); effects[index] = { deps }; queued.push(() => { effects[index].cleanup = callback(); }); } },
  };
  class Emitter {
    handlers = new Map();
    on(name, handler) { const handlers = this.handlers.get(name) || []; handlers.push(handler); this.handlers.set(name, handlers); return this; }
    emit(name, ...args) { for (const handler of [...(this.handlers.get(name) || [])]) handler(...args); }
    off(name, handler) { if (handler) this.handlers.set(name, (this.handlers.get(name) || []).filter(item => item !== handler)); else this.handlers.delete(name); }
  }
  class FakeCall {
    isAudioMuted = false;
    state = "active";
    hungUp = 0;
    constructor(client, params) { this.client = client; this.id = params.id; }
    async hangup() { this.hungUp++; this.state = "hangup"; this.client.emit("telnyx.notification", { type: "callUpdate", call: this }); }
    muteAudio() { this.isAudioMuted = true; }
    unmuteAudio() { this.isAudioMuted = false; }
  }
  class FakeClient extends Emitter {
    disconnected = 0;
    dialled = 0;
    constructor(settings) { super(); this.settings = settings; clients.push(this); }
    async connect() { if (options.connect) return options.connect(this); this.emit("telnyx.ready"); }
    newCall(params) { this.dialled++; this.params = params; this.call = new FakeCall(this, params); this.emit("telnyx.notification", { type: "callUpdate", call: this.call }); return this.call; }
    async disconnect() { this.disconnected++; }
  }
  const user = { uid: "member-1", getIdToken: async () => "test-bearer" };
  const exports = {};
  const require = id => id === "react" ? hooks : id === "react/jsx-runtime" ? jsx : id === "@/lib/creditex-audit-calls" ? contracts : id === "@telnyx/webrtc" ? { TelnyxRTC: FakeClient } : id.endsWith(".module.css") ? { default: new Proxy({}, { get: (_, key) => String(key) }) } : {};
  const fetch = async (path, init) => {
    const body = init.body ? JSON.parse(init.body) : null; requests.push({ path, init, body });
    if (options.respond) { const custom = await options.respond(path, body); if (custom) return custom; }
    if (body?.action === "prepare") return reply({ ok: true, callId: "audit-call-1", token: "voice-token", expiresAt: new Date(Date.now() + 120000).toISOString(), destinationNumber: "+61200000001", customHeaders: [{ name: "X-Creditex-Call-Intent", value: "intent-secret" }] });
    if (body) return reply({ ok: true });
    return reply(workspace(options.workspace));
  };
  const microphone = async () => { microphoneRequests++; if (options.microphone) return options.microphone(); return { getTracks: () => [{ stop() { streamStops++; } }] }; };
  const window = { isSecureContext: true, RTCPeerConnection: class {}, setTimeout, clearTimeout, setInterval(callback) { const id = ++intervalId; intervals.set(id, callback); return id; }, clearInterval(id) { intervals.delete(id); } };
  const document = options.document || {};
  Function("require", "exports", "fetch", "window", "document", "navigator", "URL", compiled)(require, exports, fetch, window, document, { mediaDevices: { getUserMedia: microphone } }, { createObjectURL: () => "blob:private-audit-audio", revokeObjectURL: url => revoked.push(url) });
  const render = () => { cursor = 0; const tree = exports.CreditexAuditCallPanel({ user, ...(options.target || { caseId: "case-1" }) }); for (const effect of queued.splice(0)) effect(); return tree; };
  return { render, requests, clients, revoked, intervals, get microphoneRequests() { return microphoneRequests; }, get streamStops() { return streamStops; }, async mount() { render(); await flush(); return render(); }, async settle() { await flush(); return render(); }, cleanup() { for (const effect of effects) effect?.cleanup?.(); } };
}

test("one Call customer action creates one bound intent and never supplies an arbitrary phone to the SDK", async () => {
  const h = harness(); const tree = await h.mount(); const start = button(tree, "Call customer"); start.props.onClick(); start.props.onClick();
  const live = await h.settle();
  assert.equal(h.requests.filter(item => item.body?.action === "prepare").length, 1);
  assert.equal(h.clients.length, 1); assert.deepEqual(h.clients[0].params, { id: "audit-call-1", destinationNumber: "+61200000001", customHeaders: [{ name: "X-Creditex-Call-Intent", value: "intent-secret" }], audio: true, video: false, remoteElement: undefined });
  assert.equal(h.clients[0].settings.enableCallRecording, false); assert.equal(h.clients[0].settings.debug, false);
  assert.equal(h.streamStops, 1); assert.match(text(live), /Recording has not been confirmed/);
  button(live, "Mute microphone").props.onClick(); assert.equal(h.clients[0].call.isAudioMuted, true);
  button(h.render(), "End call").props.onClick(); await h.settle(); assert.ok(h.clients[0].disconnected); h.cleanup();
});

test("microphone denial explains browser recovery and does not create or dial an intent", async () => {
  const error = new Error("Denied"); error.name = "NotAllowedError";
  const h = harness({ microphone: async () => { throw error; } });
  button(await h.mount(), "Call customer").props.onClick(); const tree = await h.settle();
  assert.match(text(tree), /Allow this website to use your microphone/); assert.equal(h.clients.length, 0);
  assert.equal(h.requests.filter(item => item.body).length, 0); h.cleanup();
});

test("a document permissions policy block requests an explicit reload before microphone or intent work", async () => {
  const h = harness({ document: { permissionsPolicy: { allowsFeature: () => false } } });
  button(await h.mount(), "Call customer").props.onClick(); const tree = await h.settle();
  assert.match(text(tree), /Reload this Creditex page/); assert.equal(h.microphoneRequests, 0); h.cleanup();
});

test("cancelling a pending microphone prompt cannot produce a late call", async () => {
  let resolve; let stopped = false;
  const h = harness({ microphone: () => new Promise(done => { resolve = done; }) });
  button(await h.mount(), "Call customer").props.onClick(); let tree = h.render();
  button(tree, "Cancel").props.onClick();
  resolve({ getTracks: () => [{ stop() { stopped = true; } }] }); tree = await h.settle();
  assert.equal(stopped, true); assert.match(text(tree), /connection cancelled/); assert.equal(h.clients.length, 0);
  assert.equal(h.requests.filter(item => item.body?.action === "prepare").length, 0); h.cleanup();
});

test("leaving the case during intent preparation cancels the late intent and never connects a device", async () => {
  let resolve;
  const h = harness({ respond: async (_path, body) => body?.action === "prepare" ? new Promise(done => { resolve = done; }) : undefined });
  button(await h.mount(), "Call customer").props.onClick(); await flush(); h.cleanup();
  resolve(reply({ ok: true, callId: "late-intent", token: "private-token", expiresAt: new Date(Date.now() + 120000).toISOString() })); await flush();
  assert.equal(h.clients.length, 0);
  assert.ok(h.requests.some(item => item.body?.action === "cancel" && item.body.callId === "late-intent"));
});

test("SDK connection failure disconnects the client and cancels the unused intent without redial", async () => {
  const h = harness({ connect: async () => { throw new Error("Headset connection failed."); } });
  button(await h.mount(), "Call customer").props.onClick(); const tree = await h.settle();
  assert.match(text(tree), /Headset connection failed/); assert.ok(h.clients[0].disconnected); assert.equal(h.clients[0].dialled, 0);
  assert.equal(h.requests.filter(item => item.body?.action === "prepare").length, 1);
  assert.ok(h.requests.some(item => item.body?.action === "cancel")); h.cleanup();
});

test("server consent and recording states remain distinct and pending storage polls safely", async () => {
  let saved = false;
  const h = harness({ respond: async (_path, body) => !body ? reply(workspace({ calls: [callRecord({ status: saved ? "completed" : "awaiting_consent", recordingStatus: saved ? "saved" : "none", consentedAt: saved ? "2026-09-21T01:01:00Z" : "" })] })) : undefined });
  let tree = await h.mount(); assert.match(text(tree), /Waiting for customer consent/); assert.match(text(tree), /No recording/);
  assert.equal(button(tree, "Play recording"), undefined); assert.equal(h.intervals.size, 1);
  saved = true; [...h.intervals.values()][0](); tree = await h.settle();
  assert.ok(button(tree, "Play recording")); assert.equal(h.intervals.size, 0); h.cleanup();
});

test("saved audio uses an authenticated private fetch and revokes its playback URL on leave", async () => {
  const h = harness({ workspace: { calls: [callRecord()] }, respond: async path => path.endsWith("/audio") ? { ok: true, headers: new Headers({ "Content-Type": "audio/mpeg", "Content-Length": "3" }), blob: async () => new Blob(["mp3"], { type: "audio/mpeg" }) } : undefined });
  button(await h.mount(), "Play recording").props.onClick(); const tree = await h.settle();
  const request = h.requests.find(item => item.path.endsWith("/audio")); assert.equal(request.init.headers.Authorization, "Bearer test-bearer"); assert.equal(request.init.cache, "no-store");
  assert.equal(nodes(tree, node => node.type === "audio" && node.props.controls)[0].props.src, "blob:private-audit-audio");
  h.cleanup(); assert.deepEqual(h.revoked, ["blob:private-audit-audio"]);
});

test("Retry saving recording only retries storage, never prepares a call", async () => {
  const h = harness({ workspace: { calls: [callRecord({ recordingStatus: "failed", savedAt: "" })] } });
  button(await h.mount(), "Retry saving recording").props.onClick(); await h.settle();
  assert.equal(h.requests.filter(item => item.body).length, 1);
  assert.equal(h.requests.find(item => item.body).body.action, "retry_recording"); assert.equal(h.clients.length, 0); h.cleanup();
});

test("unconfigured calling stays visibly blocked without claiming a working connection", async () => {
  const h = harness({ workspace: { configured: false, canCall: false, unavailableReason: "Ask your Creditex administrator to connect calling." } });
  const tree = await h.mount(); assert.equal(button(tree, "Call customer").props.disabled, true);
  assert.match(text(tree), /administrator to connect calling/); assert.equal(h.clients.length, 0); h.cleanup();
});

test("Telnyx must be ready before a single parked call; repeated ready events never redial", async () => {
  const h = harness({ connect: async () => {} });
  button(await h.mount(), "Call customer").props.onClick(); await h.settle();
  assert.equal(h.clients[0].dialled, 0);
  h.clients[0].emit("telnyx.ready"); await h.settle();
  h.clients[0].emit("telnyx.ready"); await h.settle();
  assert.equal(h.clients[0].dialled, 1); h.cleanup();
});

test("leaving the audit while Telnyx login is pending prevents a late call", async () => {
  const h = harness({ connect: async () => {} });
  button(await h.mount(), "Call customer").props.onClick(); await h.settle(); h.cleanup();
  h.clients[0].emit("telnyx.ready"); await flush();
  assert.equal(h.clients[0].dialled, 0); assert.ok(h.clients[0].disconnected);
  assert.ok(h.requests.some(item => item.body?.action === "cancel"));
});

test("uncertain hangup can retry ending the same intent without creating another call", async () => {
  let cancelAttempts = 0;
  const h = harness({ respond: async (_path, body) => body?.action === "cancel" && ++cancelAttempts === 1 ? reply({ ok: false, error: "Offline" }, 503) : undefined });
  button(await h.mount(), "Call customer").props.onClick();
  button(await h.settle(), "End call").props.onClick();
  const uncertain = await h.settle(); assert.match(text(uncertain), /ending has not been confirmed/);
  assert.equal(button(uncertain, "Call customer"), undefined);
  button(uncertain, "Retry end call").props.onClick(); const ended = await h.settle();
  assert.equal(cancelAttempts, 2); assert.ok(button(ended, "Call customer"));
  assert.equal(h.clients[0].dialled, 1); h.cleanup();
});

test("job-intent audits use the same call flow without creating or substituting a case", async () => {
  const h = harness({ target: { jobIntentId: "job-intent-1" } });
  button(await h.mount(), "Call customer").props.onClick(); await h.settle();
  assert.equal(h.requests[0].path, "/api/creditex/audit-calls?jobIntentId=job-intent-1");
  const prepare = h.requests.find(item => item.body?.action === "prepare").body;
  assert.equal(prepare.jobIntentId, "job-intent-1"); assert.equal(prepare.caseId, undefined); h.cleanup();
});

test("an existing active audit call blocks a second call even with an outdated canCall flag", async () => {
  const h = harness({ workspace: { calls: [callRecord({ status: "in_progress", recordingStatus: "recording" })] } });
  const start = button(await h.mount(), "Call customer"); assert.equal(start.props.disabled, true);
  start.props.onClick(); await h.settle(); assert.equal(h.clients.length, 0); h.cleanup();
});
