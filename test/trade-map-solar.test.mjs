import test from "node:test";
import assert from "node:assert/strict";
import { adjacentSolarPanel, DEFAULT_SOLAR_PANEL_SIZE, DEFAULT_SOLAR_PANEL_TILT, solarHeading, solarPanelAxes, validSolarPanelSize, validSolarPanelTilt } from "../src/lib/trade-map-solar.ts";
import { captureTradeMapPng, captureTradeMapQuoteImage, isCurrentMapTab, mapCaptureRegion } from "../src/lib/trade-map-capture.ts";

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

function captureHarness(t, options = {}) {
  const originals = new Map();
  const global = (name, value) => { originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name)); Object.defineProperty(globalThis, name, { configurable: true, writable: true, value }); };
  t.after(() => { for (const [name, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; } });
  const calls = [], markers = [], canvases = [], reads = [], draws = [], captions = [];
  const attempt = new AbortController();
  let grant, identity, deliveredFrames = 0, frameId = 0, frameCallback, playing = false, encodes = 0;
  const bounds = { left: 100, top: 120, right: 700, bottom: 520, ...options.bounds };
  const viewport = { width: 1000, height: 800, ...options.viewport };
  const track = new EventTarget();
  track.getSettings = () => ({ displaySurface: options.wrongSurface ? "window" : "browser" });
  track.getCaptureHandle = () => ({ handle: options.wrongTab ? "other-tab" : identity.handle, origin: "https://example.test" });
  track.stop = () => calls.push("stop");
  const stream = { getVideoTracks: () => [track], getTracks: () => [track] };
  global("navigator", { mediaDevices: {
    setCaptureHandleConfig(config) { identity = config; calls.push(config.handle ? "identity" : "clear identity"); },
    async getDisplayMedia() { calls.push("share"); if (options.denied) throw new DOMException("cancelled", "NotAllowedError"); if (options.pending) return new Promise((resolve) => { grant = () => resolve(stream); }); return stream; },
  } });
  global("window", { setTimeout: (callback, delay) => setTimeout(callback, delay === 8000 ? 250 : delay === 1000 ? 1 : delay), clearTimeout });
  global("location", { origin: "https://example.test" });
  global("requestAnimationFrame", (callback) => setTimeout(() => { calls.push("paint"); callback(); }, 0));
  global("cancelAnimationFrame", clearTimeout);
  global("innerWidth", viewport.width); global("innerHeight", viewport.height);
  const cancelledFrames = new Set();
  const video = { videoWidth: options.videoWidth ?? viewport.width, videoHeight: options.videoHeight ?? viewport.height,
    requestVideoFrameCallback(callback) {
      const id = ++frameId;
      const delivered = () => {
        if (cancelledFrames.has(id)) return;
        deliveredFrames++; calls.push("video frame");
        if (options.cancelFirstFrame && deliveredFrames === 1) attempt.abort();
        if (options.endFirstFrame && deliveredFrames === 1) track.dispatchEvent(new Event("ended"));
        if (options.switchFirstFrame && deliveredFrames === 1) track.dispatchEvent(new Event("capturehandlechange"));
        if (options.moveFirstFrame && deliveredFrames === 1) bounds.left += 10;
        if (options.resizeFirstFrame && deliveredFrames === 1) globalThis.innerWidth += 10;
        callback();
      };
      if (playing) setTimeout(delivered, 0); else frameCallback = delivered;
      return id;
    },
    cancelVideoFrameCallback(id) { cancelledFrames.add(id); },
    async play() { calls.push("play"); playing = true; setTimeout(() => frameCallback(), 0); },
    pause() { calls.push("pause"); }, remove() {},
  };
  const makeCanvas = () => {
    const canvas = { width: 0, height: 0, frozenFrame: null };
    const context = {
      drawImage(...args) {
        if (args[0] === video) { calls.push("read pixels"); canvas.frozenFrame = deliveredFrames; reads.push({ frame: deliveredFrames, width: canvas.width, height: canvas.height }); }
        else { calls.push("crop frozen pixels"); draws.push({ args, frozenFrame: args[0].frozenFrame }); }
      },
      getImageData(x, y) {
        const index = markers.findIndex((marker) => Math.floor((parseFloat(marker.style.left) + 4) * video.videoWidth / viewport.width) === x
          && Math.floor((parseFloat(marker.style.top) + 4) * video.videoHeight / viewport.height) === y);
        if (deliveredFrames <= (options.staleFrames ?? 0) || index < 0 || index === options.missingProbe) return { data: [0, 0, 0, 255] };
        return { data: [...markers[index].style.background.match(/\d+/g).map(Number), 255] };
      },
      fillRect() {}, fillText(value) { captions.push(value); },
    };
    canvas.getContext = () => context;
    canvas.toBlob = (callback, mime) => {
      calls.push(mime); encodes++;
      if (options.cancelEncoding) attempt.abort();
      if (options.switchEncoding) track.dispatchEvent(new Event("capturehandlechange"));
      // Later live video frames must never replace the already verified source pixels.
      deliveredFrames += options.framesDuringEncoding ?? 0;
      callback(new Blob([options.oversized && encodes === 1 ? new Uint8Array(4_000_001) : "PNG"], { type: mime }));
    };
    canvases.push(canvas); return canvas;
  };
  const link = { click() { calls.push("download"); }, remove() {} };
  const element = { scrollIntoView() {}, contains: () => !options.covered, getBoundingClientRect: () => ({ ...bounds }) };
  global("document", {
    createElement(tag) {
      calls.push(`create ${tag}`);
      if (tag === "div") { const marker = { style: {}, setAttribute() {}, remove() { marker.removed = true; } }; markers.push(marker); return marker; }
      if (tag === "canvas") return makeCanvas();
      return { video, a: link }[tag];
    },
    body: { append() {} }, elementFromPoint: () => element,
  });
  const prepare = options.prepare ?? (() => { calls.push("hide controls"); });
  const restore = () => calls.push("restore controls");
  const run = () => captureTradeMapPng(element, 4, prepare, restore, attempt.signal);
  const quote = (measurement = { kind: "solar", quantity: 4 }) => captureTradeMapQuoteImage(element, measurement, prepare, restore, attempt.signal);
  return { calls, run, quote, canvases, markers, reads, draws, captions, link, cancel: () => attempt.abort(), grant: () => grant() };
}

function assertClean(h) {
  assert.ok(h.calls.includes("clear identity"));
  assert.ok(h.calls.includes("restore controls"));
  assert.ok(h.markers.every((marker) => marker.removed));
  if (h.canvases[0]) assert.deepEqual([h.canvases[0].width, h.canvases[0].height], [0, 0], "full-tab pixels are erased after capture");
}

test("PNG capture verifies fresh bounds, crops the whole map and always stops sharing", async (t) => {
  const h = captureHarness(t);
  await h.run();
  assert.deepEqual([h.canvases[1].width, h.canvases[1].height], [600, 462]);
  assert.deepEqual(h.draws[0].args.slice(1), [100, 120, 600, 400, 0, 0, 600, 400]);
  assert.equal(h.draws[0].args[0], h.canvases[0], "only the verified frozen canvas is encoded");
  assert.ok(h.calls.indexOf("crop frozen pixels") < h.calls.indexOf("download"));
  assert.ok(h.calls.indexOf("restore controls") > h.calls.indexOf("image/png"));
  assert.match(h.link.download, /^tlink-solar-layout-.*\.png$/);
  assert.ok(h.calls.includes("stop")); assertClean(h);
});

test("several stale frames are ignored until all four new probes appear", async (t) => {
  const h = captureHarness(t, { staleFrames: 3, framesDuringEncoding: 4, oversized: true });
  await h.quote();
  assert.deepEqual(h.reads.map((read) => read.frame), [1, 2, 3, 4]);
  assert.deepEqual(h.draws.map((draw) => draw.frozenFrame), [4, 4], "encoding retries use the same verified frame despite later live frames");
  assert.equal(h.markers.length, 4); assertClean(h);
});

for (const missingProbe of [0, 1, 2, 3]) test(`missing boundary probe ${missingProbe} never encodes or downloads a map`, async (t) => {
  const h = captureHarness(t, { missingProbe });
  await assert.rejects(h.run(), /could not verify/);
  assert.equal(h.draws.length, 0); assert.equal(h.calls.includes("image/png"), false); assert.equal(h.calls.includes("download"), false);
  assert.ok(h.calls.includes("stop")); assertClean(h);
});

for (const reason of ["wrongTab", "wrongSurface", "denied", "covered"]) test(`capture ${reason} never reads or downloads another surface`, async (t) => {
  const h = captureHarness(t, { [reason]: true });
  await assert.rejects(h.run());
  assert.equal(h.calls.includes("read pixels"), false); assert.equal(h.calls.includes("create video"), false); assert.equal(h.calls.includes("download"), false);
  if (reason !== "denied") assert.ok(h.calls.includes("stop"));
  assertClean(h);
});

test("cancelling a pending sharing prompt stops even a stream granted later", async (t) => {
  const h = captureHarness(t, { pending: true });
  const result = h.run(); h.cancel();
  await assert.rejects(result, /cancelled/);
  h.grant(); await new Promise((resolve) => setTimeout(resolve, 0));
  assert.ok(h.calls.includes("stop")); assert.equal(h.calls.includes("create video"), false); assert.equal(h.calls.includes("download"), false); assertClean(h);
});

test("sharing is requested synchronously before async map preparation and no pixels are read before it completes", async (t) => {
  let finishPrepare;
  const h = captureHarness(t, { prepare: () => new Promise((resolve) => { h.calls.push("prepare"); finishPrepare = resolve; }) });
  const result = h.quote();
  assert.ok(h.calls.includes("share"), "getDisplayMedia must run in the click's transient activation");
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(h.calls.indexOf("share") < h.calls.indexOf("prepare"));
  assert.equal(h.calls.includes("create video"), false);
  finishPrepare(); await result; assertClean(h);
});

test("async preparation failure stops sharing without exporting pixels", async (t) => {
  const h = captureHarness(t, { prepare: async () => { throw new Error("layout changed"); } });
  await assert.rejects(h.quote(), /layout changed/);
  assert.equal(h.calls.includes("read pixels"), false); assert.ok(h.calls.includes("stop")); assertClean(h);
});

for (const lateResult of ["resolve", "reject"]) test(`cancelling pending preparation releases capture before its late ${lateResult}`, async (t) => {
  let resolvePrepare, rejectPrepare, outcome;
  const h = captureHarness(t, { prepare: () => new Promise((resolve, reject) => { resolvePrepare = resolve; rejectPrepare = reject; }) });
  const result = h.quote().then((value) => { outcome = { value }; }, (error) => { outcome = { error }; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(typeof resolvePrepare, "function");
  h.cancel(); await new Promise((resolve) => setImmediate(resolve));
  assert.match(outcome?.error?.message ?? "capture is still pending", /capture stopped/i,
    "cancel must settle promptly without waiting for the design save");
  assert.ok(h.calls.includes("stop")); assertClean(h);
  assert.equal(h.calls.filter((call) => call === "restore controls").length, 1);
  if (lateResult === "resolve") resolvePrepare(); else rejectPrepare(new Error("late save failure"));
  await result; await new Promise((resolve) => setImmediate(resolve));
  assert.equal(h.markers.length, 0); assert.equal(h.calls.includes("create video"), false);
  assert.equal(h.calls.includes("read pixels"), false); assert.equal(h.calls.includes("download"), false);
  assert.equal(h.calls.filter((call) => call === "restore controls").length, 1, "late completion cannot restart or restore another capture");
});

for (const scale of [0.75, 1, 1.25, 2]) test(`quote capture at ${scale} display scale preserves every map edge and excludes outside probes`, async (t) => {
  const h = captureHarness(t, { videoWidth: 1000 * scale, videoHeight: 800 * scale });
  assert.deepEqual(await h.quote(), { dataUrl: "data:image/png;base64,UE5H" });
  assert.deepEqual(h.draws[0].args.slice(1), [100 * scale, 120 * scale, 600 * scale, 400 * scale, 0, 0, 600 * scale, 400 * scale]);
  assert.deepEqual([h.canvases[1].width, h.canvases[1].height], [600 * scale, 400 * scale + 62]);
  assert.ok(h.captions.includes("Solar layout concept · 4 panels")); assert.equal(h.calls.includes("download"), false); assertClean(h);
});

test("large quote image fits the image limits without discarding map attribution at its edges", async (t) => {
  const h = captureHarness(t, { videoWidth: 4000, videoHeight: 2400, viewport: { width: 2000, height: 1200 }, bounds: { left: 100, top: 100, right: 1900, bottom: 1100 } });
  await h.quote();
  assert.deepEqual(h.draws[0].args.slice(1), [200, 200, 3600, 2000, 0, 0, 1600, 889]);
  assert.deepEqual([h.canvases[1].width, h.canvases[1].height], [1600, 951]); assertClean(h);
});

test("quote capture downscales an oversized PNG below the upload limit", async (t) => {
  const h = captureHarness(t, { videoWidth: 2000, videoHeight: 1600, oversized: true });
  await h.quote();
  assert.equal(h.calls.filter((call) => call === "image/png").length, 2);
  assert.deepEqual([h.canvases[1].width, h.canvases[1].height], [960, 702]); assertClean(h);
});

for (const measurement of [{ kind: "area", quantity: 162.5 }, { kind: "distance", quantity: 1.72 }]) test(`quote ${measurement.kind} capture labels the measured unit`, async (t) => {
  const h = captureHarness(t); await h.quote(measurement);
  assert.ok(h.captions.includes(`Map ${measurement.kind} estimate · ${measurement.quantity} ${measurement.kind === "area" ? "m²" : "m"}`));
  assert.equal(h.calls.includes("download"), false); assertClean(h);
});

for (const reason of ["cancelEncoding", "cancelFirstFrame", "endFirstFrame", "switchFirstFrame", "switchEncoding", "moveFirstFrame", "resizeFirstFrame"]) test(`quote capture ${reason} rejects without handing off an image`, async (t) => {
  const h = captureHarness(t, { [reason]: true });
  await assert.rejects(h.quote());
  assert.equal(h.calls.includes("download"), false); assert.ok(h.calls.includes("stop"));
  if (reason.endsWith("FirstFrame")) assert.equal(h.calls.includes("read pixels"), false);
  assertClean(h);
});

test("non-uniform or excessive full-tab frames are rejected before pixels are read", async (t) => {
  const h = captureHarness(t, { videoWidth: 1000, videoHeight: 600 });
  await assert.rejects(h.quote(), /could not verify/);
  assert.equal(h.reads.length, 0); assert.equal(h.draws.length, 0); assertClean(h);
  const bounds = { left: 100, top: 120, right: 700, bottom: 520 }, viewport = { width: 1000, height: 800 };
  assert.equal(mapCaptureRegion(bounds, viewport, 10000, 8000), null);
  assert.equal(mapCaptureRegion({ ...bounds, right: 1001 }, viewport, 1000, 800), null);
  assert.equal(mapCaptureRegion({ ...bounds, left: NaN }, viewport, 1000, 800), null);
});
