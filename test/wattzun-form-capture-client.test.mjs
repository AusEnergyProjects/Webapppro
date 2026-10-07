import assert from "node:assert/strict";
import test from "node:test";
import {
  readWattzunFormCaptureTarget, readWattzunFormCaptureRequest, readWattzunFormCaptureSaved,
  prepareWattzunFormCapture, respondWattzunFormCapture, captureWattzunFormPhoto,
  WATTZUN_FORM_CAPTURE_PREPARE_EVENT, WATTZUN_FORM_CAPTURE_READY_EVENT, WATTZUN_FORM_CAPTURE_EVENT,
  readWattzunFormRefreshed,
} from "../src/lib/wattzun-form-client.ts";

const target = { portal: "trade", scopeId: "business", formKind: "work_pack", formId: "pack-one", jobId: "job-one", fieldKey: "units[unit-two].photo" };
test("editor refresh receipt carries only a valid canonical revision and selected form", () => {
  const detail = { portal: "trade", scopeId: "business", formKind: "work_pack", formId: "pack-two", oldFormId: "pack-one", jobId: "job-one" };
  assert.deepEqual(readWattzunFormRefreshed(detail), detail);
  for (const change of [{ oldFormId: "" }, { oldFormId: "[selector]" }, { portal: "council" }, { formId: "" }, { extra: true }]) assert.equal(readWattzunFormRefreshed({ ...detail, ...change }), null);
});
test("capture contracts reject malformed, foreign-engine and selector-like targets", () => {
  assert.deepEqual(readWattzunFormCaptureTarget(target), target);
  const longRepeatedKey = `${"section".padEnd(180,"x")}[${"item".padEnd(180,"y")}].${"photo".padEnd(180,"z")}`;
  assert.equal(readWattzunFormCaptureTarget({ ...target, fieldKey: longRepeatedKey })?.fieldKey, longRepeatedKey);
  assert.equal(readWattzunFormCaptureTarget({ ...target, fieldKey: "x".repeat(601) }), null);
  for (const change of [{ formKind: "activity_form" }, { fieldKey: "__proto__.photo" }, { fieldKey: "input[type=file]" }, { extra: true }, { jobId: "" }]) {
    assert.equal(readWattzunFormCaptureTarget({ ...target, ...change }), null);
  }
  assert.equal(readWattzunFormCaptureRequest({ requestId: "request", target, extra: true }), null);
  assert.deepEqual(readWattzunFormCaptureSaved({ ...target, oldFormId: "old-pack" }), { ...target, oldFormId: "old-pack" });
  assert.equal(readWattzunFormCaptureSaved({ ...target, oldFormId: "" }), null);
});

test("prepare accepts only matching request and question, normalizes revision, and removes listeners", async () => {
  const original = globalThis.window;
  const surface = new EventTarget(); const listeners = new Set();
  surface.setTimeout = setTimeout; surface.clearTimeout = clearTimeout;
  const add = surface.addEventListener.bind(surface), remove = surface.removeEventListener.bind(surface);
  surface.addEventListener = (name, handler) => { if (name === WATTZUN_FORM_CAPTURE_READY_EVENT) listeners.add(handler); add(name, handler); };
  surface.removeEventListener = (name, handler) => { if (name === WATTZUN_FORM_CAPTURE_READY_EVENT) listeners.delete(handler); remove(name, handler); };
  globalThis.window = surface;
  try {
    let request;
    surface.addEventListener(WATTZUN_FORM_CAPTURE_PREPARE_EVENT, event => { request = event.detail; });
    let finished = false;
    const prepared = prepareWattzunFormCapture(target).then(result => { finished = true; return result; });
    respondWattzunFormCapture({ ...request, requestId: "another" }, { status: "ready", target });
    respondWattzunFormCapture(request, { status: "ready", target: { ...target, jobId: "another" } });
    await Promise.resolve(); assert.equal(finished, false);
    respondWattzunFormCapture(request, { status: "ready", target: { ...target, formId: "pack-two" } });
    assert.deepEqual(await prepared, { status: "ready", target: { ...target, formId: "pack-two" } });
    assert.equal(listeners.size, 0);
    assert.equal(captureWattzunFormPhoto(target), false);
    surface.addEventListener(WATTZUN_FORM_CAPTURE_EVENT, event => event.preventDefault());
    assert.equal(captureWattzunFormPhoto(target), true);
  } finally { globalThis.window = original; }
});

test("an unmounted editor times out without claiming readiness or retaining listeners", async () => {
  const original = globalThis.window;
  const surface = new EventTarget(); const listeners = new Set(); let timeout;
  surface.setTimeout = callback => { timeout = callback; return 1; }; surface.clearTimeout = () => {};
  surface.addEventListener = (_name, handler) => listeners.add(handler);
  surface.removeEventListener = (_name, handler) => listeners.delete(handler);
  globalThis.window = surface;
  try {
    const prepared = prepareWattzunFormCapture(target); timeout();
    assert.equal((await prepared).status, "unavailable"); assert.equal(listeners.size, 0);
  } finally { globalThis.window = original; }
});
