import test from "node:test";
import assert from "node:assert/strict";
import { adjacentSolarPanel, DEFAULT_SOLAR_PANEL_SIZE, DEFAULT_SOLAR_PANEL_TILT, solarHeading, solarPanelAxes, validSolarPanelSize, validSolarPanelTilt } from "../src/lib/trade-map-solar.ts";
import { captureTradeMapPng, captureTradeMapQuoteImage, isCurrentMapTab } from "../src/lib/trade-map-capture.ts";

test("copies follow the selected panel's roof angle and physical dimensions", () => {
  const source = { id: 1, center: { lat: -37.8, lng: 145 }, widthM: 1.13, lengthM: 1.72, heading: 330, lengthTilt: 0, widthTilt: 0 };
  const calls = [];
  const offset = (from, metres, heading) => { calls.push({ from, metres, heading }); return { lat: from.lat + 1, lng: from.lng + 1 }; };
  for (const direction of ["above", "right", "below", "left"]) {
    const copy = adjacentSolarPanel(source, direction, offset);
    assert.equal(copy.heading, 330);
    assert.equal(copy.widthM, 1.13);
    assert.equal(copy.lengthM, 1.72);
    assert.equal(copy.lengthTilt, 0);
    assert.equal(copy.widthTilt, 0);
    assert.deepEqual(copy.center, { lat: -36.8, lng: 146 });
    assert.equal("id" in copy, false, "a copy receives a new identity when inserted");
  }
  assert.deepEqual(calls.map(({ metres, heading }) => ({ metres, heading })), [
    { metres: 1.74, heading: 330 }, { metres: 1.15, heading: 60 },
    { metres: 1.74, heading: 150 }, { metres: 1.15, heading: 240 },
  ]);
  assert.deepEqual(source.center, { lat: -37.8, lng: 145 }, "copy does not move the original");
});

const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} should equal ${expected}`);

test("roof pitch shortens the correct overhead axis without changing physical dimensions", () => {
  assert.deepEqual(solarPanelAxes({ lengthTilt: 0, widthTilt: 0 }), { width: { x: 1, y: 0 }, length: { x: 0, y: 1 } });
  const defaultAxes = solarPanelAxes(DEFAULT_SOLAR_PANEL_TILT);
  close(defaultAxes.length.y * DEFAULT_SOLAR_PANEL_SIZE.lengthM, 1.5890727959194132);
  close(defaultAxes.width.x * DEFAULT_SOLAR_PANEL_SIZE.widthM, 1.13);
  for (const degrees of [30, 45, 85]) {
    const portrait = solarPanelAxes({ lengthTilt: degrees, widthTilt: 0 });
    close(portrait.length.y, Math.cos(degrees * Math.PI / 180));
    close(portrait.width.x, 1);
    close(portrait.length.x, 0);
    const landscape = solarPanelAxes({ lengthTilt: 0, widthTilt: degrees });
    close(landscape.width.x, Math.cos(degrees * Math.PI / 180));
    close(landscape.length.y, 1);
    close(landscape.length.x, 0);
  }
});

test("combined tilt projects a rigid rectangle, and copies share its edge vectors and surface gap", () => {
  const source = { id: 7, center: { lat: -37.8, lng: 145 }, ...DEFAULT_SOLAR_PANEL_SIZE, heading: 330, lengthTilt: 30, widthTilt: 45 };
  const axes = solarPanelAxes(source);
  // Independent 3D rotations of the two unit edges remain orthogonal and unit length.
  const widthZ = -Math.sin(Math.PI / 4), lengthZ = Math.sin(Math.PI / 6) * Math.cos(Math.PI / 4);
  close(axes.width.x ** 2 + widthZ ** 2, 1);
  close(axes.length.x ** 2 + axes.length.y ** 2 + lengthZ ** 2, 1);
  close(axes.width.x * axes.length.x + widthZ * lengthZ, 0);
  const original = structuredClone(source);
  for (const [direction, axis, dimension, sign] of [
    ["above", axes.length, source.lengthM, 1], ["below", axes.length, source.lengthM, -1],
    ["right", axes.width, source.widthM, 1], ["left", axes.width, source.widthM, -1],
  ]) {
    let result;
    const copy = adjacentSolarPanel(source, direction, (_from, distance, heading) => { result = { distance, heading }; return { lat: -37.81, lng: 145.01 }; });
    const localHeading = (result.heading - source.heading) * Math.PI / 180;
    close(result.distance * Math.sin(localHeading), sign * (dimension + 0.02) * axis.x);
    close(result.distance * Math.cos(localHeading), sign * (dimension + 0.02) * axis.y);
    assert.equal(copy.lengthTilt, 30);
    assert.equal(copy.widthTilt, 45);
    assert.equal(copy.heading, source.heading);
    assert.equal(copy.widthM, source.widthM);
    assert.equal(copy.lengthM, source.lengthM);
  }
  assert.deepEqual(source, original);
});

test("sideways 30 degree pitch keeps copies aligned with the narrower visible footprint", () => {
  const source = { id: 1, center: { lat: -37.8, lng: 145 }, ...DEFAULT_SOLAR_PANEL_SIZE, heading: 90, lengthTilt: 0, widthTilt: 30 };
  adjacentSolarPanel(source, "right", (from, distance, heading) => {
    close(distance, 1.15 * Math.sqrt(3) / 2);
    close(heading, 180);
    return from;
  });
  adjacentSolarPanel(source, "above", (from, distance, heading) => {
    close(distance, 1.74);
    close(heading, 90);
    return from;
  });
});

test("tilt rejects non-finite, negative and near-vertical values", () => {
  assert.equal(validSolarPanelTilt(DEFAULT_SOLAR_PANEL_TILT), true);
  assert.equal(validSolarPanelTilt({ lengthTilt: 0, widthTilt: 85 }), true);
  for (const invalid of [NaN, Infinity, -0.1, 85.1, 90, undefined]) {
    assert.equal(validSolarPanelTilt({ lengthTilt: invalid, widthTilt: 0 }), false);
    assert.equal(validSolarPanelTilt({ lengthTilt: 0, widthTilt: invalid }), false);
  }
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

function captureHarness(t, { wrongTab = false, rejectCrop = false, noCrop = false, denied = false, covered = false, pending = false, videoWidth = 600, videoHeight = 400, oversized = false, cancelEncoding = false, cancelFirstFrame = false } = {}) {
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
  global("requestAnimationFrame", (callback) => setTimeout(() => { calls.push("paint"); callback(); }, 0));
  global("cancelAnimationFrame", clearTimeout);
  global("innerWidth", 1000); global("innerHeight", 800);
  let frameCallback, playing = false, frameId = 0;
  const cancelledFrames = new Set();
  const video = { videoWidth, videoHeight, requestVideoFrameCallback(callback) {
    const id = ++frameId;
    const delivered = () => { if (cancelledFrames.has(id)) return; calls.push("video frame"); if (cancelFirstFrame && id === 1) attempt.abort(); callback(); };
    if (playing) setTimeout(delivered, 0); else frameCallback = delivered;
    return id;
  }, cancelVideoFrameCallback(id) { cancelledFrames.add(id); }, async play() { calls.push("play"); playing = true; setTimeout(() => frameCallback(), 0); }, pause() {}, remove() {} };
  const draws = [], captions = [];
  const context = { drawImage(...args) { calls.push("read pixels"); draws.push(args); }, fillRect() {}, fillText(value) { captions.push(value); } };
  let encodes = 0;
  const canvas = { getContext: () => context, toBlob(callback, mime) { calls.push(mime); encodes++; if (cancelEncoding) attempt.abort(); callback(new Blob([oversized && encodes === 1 ? new Uint8Array(4_000_001) : "PNG"], { type: mime })); } };
  const link = { click() { calls.push("download"); }, remove() {} };
  const element = { scrollIntoView() {}, contains: () => !covered, getBoundingClientRect: () => ({ top: 0, left: 0, bottom: 400, right: 600 }) };
  global("document", { createElement(tag) { calls.push(`create ${tag}`); return { video, canvas, a: link }[tag]; }, body: { append() {} }, elementFromPoint: () => element });
  const run = () => captureTradeMapPng(element, 4, () => calls.push("hide controls"), () => calls.push("restore controls"), attempt.signal);
  const quote = (measurement = { kind: "solar", quantity: 4 }) => captureTradeMapQuoteImage(element, measurement, () => calls.push("hide controls"), () => calls.push("restore controls"), attempt.signal);
  return { calls, run, quote, canvas, draws, captions, link, cancel: () => attempt.abort(), grant: () => grant() };
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
  const frames = h.calls.flatMap((value, index) => value === "video frame" ? [index] : []);
  assert.equal(frames.length, 2, "a potentially buffered first frame is discarded");
  assert.ok(h.calls.indexOf("hide controls") < frames[0]);
  assert.equal(h.calls.slice(frames[0] + 1, frames[1]).filter((value) => value === "paint").length, 2);
  assert.ok(frames[1] < h.calls.indexOf("read pixels"));
  assert.ok(h.calls.indexOf("restore controls") > h.calls.indexOf("image/png"));
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

test("quote capture returns PNG data without downloading and preserves the entire map frame", async (t) => {
  const h = captureHarness(t, { videoWidth: 3200, videoHeight: 1800 });
  const image = await h.quote();
  assert.deepEqual(image, { dataUrl: "data:image/png;base64,UE5H" });
  assert.equal(h.calls.includes("download"), false);
  assert.equal(h.canvas.width, 1600);
  assert.equal(h.canvas.height, 962);
  assert.equal(h.draws[0].length, 5, "the full source frame is resized, with no source crop that could remove attribution");
  assert.deepEqual(h.draws[0].slice(1), [0, 0, 1600, 900]);
  assert.ok(h.captions.includes("Solar layout concept · 4 panels"));
  assert.ok(h.calls.includes("stop"));
  assert.ok(h.calls.includes("restore controls"));
});

test("quote capture downscales an oversized PNG below the upload limit", async (t) => {
  const h = captureHarness(t, { videoWidth: 1600, videoHeight: 900, oversized: true });
  await h.quote();
  assert.equal(h.calls.filter((call) => call === "image/png").length, 2);
  assert.equal(h.canvas.width, 1280);
  assert.equal(h.canvas.height, 782);
});

for (const measurement of [{ kind: "area", quantity: 162.5 }, { kind: "distance", quantity: 1.72 }]) test(`quote ${measurement.kind} capture labels the measured unit`, async (t) => {
  const h = captureHarness(t);
  await h.quote(measurement);
  assert.ok(h.captions.includes(`Map ${measurement.kind} estimate · ${measurement.quantity} ${measurement.kind === "area" ? "m²" : "m"}`));
  assert.equal(h.calls.includes("download"), false);
});

for (const reason of ["wrongTab", "denied", "cancelEncoding", "cancelFirstFrame"]) test(`quote capture ${reason} rejects rather than handing off an empty image`, async (t) => {
  const h = captureHarness(t, { [reason]: true });
  await assert.rejects(h.quote());
  assert.equal(h.calls.includes("download"), false);
  assert.ok(h.calls.includes("restore controls"));
  if (reason === "cancelFirstFrame") assert.equal(h.calls.includes("read pixels"), false);
});
