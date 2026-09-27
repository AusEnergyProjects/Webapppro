import test from "node:test";
import assert from "node:assert/strict";
import { adjacentSolarPanel, DEFAULT_SOLAR_PANEL_SIZE, solarHeading, validSolarPanelSize } from "../src/lib/trade-map-solar.ts";
import { captureTradeMapPng, isCurrentMapTab } from "../src/lib/trade-map-capture.ts";

test("copies follow the selected panel's roof angle and physical dimensions", () => {
  const source = { id: 1, center: { lat: -37.8, lng: 145 }, widthM: 1.13, lengthM: 1.72, heading: 330 };
  const calls = [];
  const offset = (from, metres, heading) => { calls.push({ from, metres, heading }); return { lat: from.lat + 1, lng: from.lng + 1 }; };
  for (const direction of ["above", "right", "below", "left"]) {
    const copy = adjacentSolarPanel(source, direction, offset);
    assert.equal(copy.heading, 330);
    assert.equal(copy.widthM, 1.13);
    assert.equal(copy.lengthM, 1.72);
    assert.deepEqual(copy.center, { lat: -36.8, lng: 146 });
    assert.equal("id" in copy, false, "a copy receives a new identity when inserted");
  }
  assert.deepEqual(calls.map(({ metres, heading }) => ({ metres, heading })), [
    { metres: 1.74, heading: 330 }, { metres: 1.15, heading: 60 },
    { metres: 1.74, heading: 150 }, { metres: 1.15, heading: 240 },
  ]);
  assert.deepEqual(source.center, { lat: -37.8, lng: 145 }, "copy does not move the original");
});

test("panel dimensions reject empty, non-finite and out-of-range values", () => {
  assert.equal(validSolarPanelSize(DEFAULT_SOLAR_PANEL_SIZE), true);
  for (const widthM of [0, -1, 0.19, 4.01, NaN, Infinity]) assert.equal(validSolarPanelSize({ widthM, lengthM: 1.72 }), false);
  assert.equal(validSolarPanelSize({ widthM: 1.13, lengthM: NaN }), false);
  assert.equal(solarHeading(-15), 345);
  assert.equal(solarHeading(720), 0);
});

test("capture identity accepts only the exact current tab, not another TLink tab or a window", () => {
  const track = (displaySurface, handle, origin) => ({ getSettings: () => ({ displaySurface }), getCaptureHandle: () => ({ handle, origin }) });
  const origin = "https://example.test";
  assert.equal(isCurrentMapTab(track("browser", "current", origin), "current", origin), true);
  assert.equal(isCurrentMapTab(track("browser", "other", origin), "current", origin), false);
  assert.equal(isCurrentMapTab(track("window", "current", origin), "current", origin), false);
  assert.equal(isCurrentMapTab(track("browser", "current", "https://other.test"), "current", origin), false);
  assert.equal(isCurrentMapTab({ getSettings: () => ({ displaySurface: "browser" }) }, "current", origin), false);
});

function captureHarness(t, { wrongTab = false, rejectCrop = false, noCrop = false, denied = false, covered = false, pending = false } = {}) {
  const originals = new Map();
  const global = (name, value) => { originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name)); Object.defineProperty(globalThis, name, { configurable: true, value }); };
  t.after(() => { for (const [name, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; } });
  const calls = [];
  const attempt = new AbortController();
  let grant;
  let identity = null;
  const track = new EventTarget();
  track.getSettings = () => ({ displaySurface: "browser" });
  track.getCaptureHandle = () => ({ handle: wrongTab ? "other-tab" : identity.handle, origin: "https://example.test" });
  track.stop = () => calls.push("stop");
  if (!noCrop) track.cropTo = async () => { calls.push("crop"); if (rejectCrop) throw new Error("crop rejected"); };
  const stream = { getVideoTracks: () => [track], getTracks: () => [track] };
  global("navigator", { mediaDevices: {
    setCaptureHandleConfig(config) { identity = config; calls.push(config.handle ? "identity" : "clear identity"); },
    async getDisplayMedia() { calls.push("share"); if (denied) throw new DOMException("cancelled", "NotAllowedError"); if (pending) return new Promise((resolve) => { grant = () => resolve(stream); }); return stream; },
  } });
  global("window", { CropTarget: { fromElement: async () => ({}) }, setTimeout, clearTimeout });
  global("location", { origin: "https://example.test" });
  global("requestAnimationFrame", (callback) => setTimeout(callback, 0));
  global("innerWidth", 1000); global("innerHeight", 800);
  let frameCallback;
  const video = { videoWidth: 600, videoHeight: 400, requestVideoFrameCallback(callback) { frameCallback = callback; return 1; },
    cancelVideoFrameCallback() {}, async play() { calls.push("play"); setTimeout(() => frameCallback(), 0); }, pause() {}, remove() {} };
  const context = { drawImage() { calls.push("read pixels"); }, fillRect() {}, fillText() {} };
  const canvas = { getContext: () => context, toBlob(callback, mime) { calls.push(mime); callback(new Blob(["PNG"], { type: mime })); } };
  const link = { click() { calls.push("download"); }, remove() {} };
  const element = { scrollIntoView() {}, contains: () => !covered, getBoundingClientRect: () => ({ top: 0, left: 0, bottom: 400, right: 600 }) };
  global("document", { createElement(tag) { calls.push(`create ${tag}`); return { video, canvas, a: link }[tag]; }, body: { append() {} }, elementFromPoint: () => element });
  const run = () => captureTradeMapPng(element, 4, () => calls.push("hide controls"), () => calls.push("restore controls"), attempt.signal);
  return { calls, run, canvas, link, cancel: () => attempt.abort(), grant: () => grant() };
}

test("PNG capture crops before reading pixels and always stops sharing", async (t) => {
  const h = captureHarness(t);
  await h.run();
  assert.ok(h.calls.indexOf("crop") < h.calls.indexOf("create video"));
  assert.ok(h.calls.indexOf("read pixels") < h.calls.indexOf("download"));
  assert.ok(h.calls.includes("image/png"));
  assert.equal(h.canvas.width, 600);
  assert.equal(h.canvas.height, 462, "the entire map is preserved above a concept-layout caption");
  assert.match(h.link.download, /^tlink-solar-layout-.*\.png$/);
  assert.ok(h.calls.includes("stop"));
  assert.ok(h.calls.includes("clear identity"));
  assert.ok(h.calls.includes("restore controls"));
});

for (const reason of ["wrongTab", "rejectCrop", "noCrop", "denied", "covered"]) test(`capture ${reason} never reads or downloads another surface`, async (t) => {
  const h = captureHarness(t, { [reason]: true });
  await assert.rejects(h.run());
  assert.equal(h.calls.includes("read pixels"), false);
  assert.equal(h.calls.includes("create video"), false);
  assert.equal(h.calls.includes("download"), false);
  if (reason !== "denied") assert.ok(h.calls.includes("stop"));
  assert.ok(h.calls.includes("clear identity"));
});

test("cancelling a pending sharing prompt stops even a stream granted later", async (t) => {
  const h = captureHarness(t, { pending: true });
  const result = h.run();
  h.cancel();
  await assert.rejects(result, /cancelled/);
  assert.ok(h.calls.includes("restore controls"));
  h.grant();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.ok(h.calls.includes("stop"));
  assert.equal(h.calls.includes("create video"), false);
  assert.equal(h.calls.includes("download"), false);
});
