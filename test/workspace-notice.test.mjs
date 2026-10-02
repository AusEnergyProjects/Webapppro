import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { transformSync } from "esbuild";

const source = readFileSync(new URL("../src/lib/use-workspace-notice.ts", import.meta.url), "utf8");
const compiled = transformSync(source, { loader: "ts", format: "cjs" }).code;

function noticeHarness(t) {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const slots = [];
  let cursor = 0, pending = [], dirty = false, navigationKey = "jobs", result;
  const react = {
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = initial;
      return [slots[index], value => {
        const next = typeof value === "function" ? value(slots[index]) : value;
        if (!Object.is(next, slots[index])) { slots[index] = next; dirty = true; }
      }];
    },
    useCallback(callback) { return callback; },
    useEffect(effect, dependencies) {
      const index = cursor++;
      const previous = slots[index];
      if (previous && dependencies.every((value, at) => Object.is(value, previous.dependencies[at]))) return;
      pending.push(() => {
        previous?.cleanup?.();
        slots[index] = { dependencies, cleanup: effect() };
      });
    },
  };
  const loaded = { exports: {} };
  vm.runInNewContext(compiled, { module: loaded, exports: loaded.exports, require: name => {
    assert.equal(name, "react"); return react;
  }, setTimeout, clearTimeout });
  function render(nextKey = navigationKey) {
    navigationKey = nextKey;
    do {
      dirty = false; cursor = 0;
      result = loaded.exports.useWorkspaceNotice(navigationKey);
      const effects = pending; pending = [];
      for (const effect of effects) effect();
    } while (dirty);
    return result;
  }
  return { render, dispose() { for (const slot of slots) slot?.cleanup?.(); } };
}

test("routine confirmation is visible briefly and disappears after three seconds", t => {
  const h = noticeHarness(t);
  h.render().setStatus("Job moved to the bin.", "success");
  assert.equal(h.render().notice.message, "Job moved to the bin.");
  t.mock.timers.tick(2999);
  assert.ok(h.render().notice);
  t.mock.timers.tick(1);
  assert.equal(h.render().notice, null);
});

test("a repeated confirmation receives a fresh timeout instead of the previous timer", t => {
  const h = noticeHarness(t);
  h.render().setStatus("Job restored.", "success"); h.render();
  t.mock.timers.tick(2500);
  h.render().setStatus("Job restored.", "success"); h.render();
  t.mock.timers.tick(500);
  assert.equal(h.render().notice.message, "Job restored.");
  t.mock.timers.tick(2500);
  assert.equal(h.render().notice, null);
});

test("a previous confirmation timer cannot dismiss a new error or actionable warning", t => {
  const h = noticeHarness(t);
  for (const kind of ["error", "warning"]) {
    h.render().setStatus("Saved.", "success"); h.render();
    t.mock.timers.tick(1000);
    h.render().setStatus("Calendar sync needs another try.", kind, true); h.render();
    t.mock.timers.tick(10000);
    assert.equal(h.render().notice.kind, kind);
    assert.equal(h.render().notice.calendarRetry, true);
  }
  h.render().dismissStatus();
  assert.equal(h.render().notice, null);
});

test("navigation drops routine confirmations and does not resurrect them when returning", t => {
  const h = noticeHarness(t);
  h.render().setStatus("Job moved to the bin.", "success"); h.render();
  assert.equal(h.render("today").notice, null);
  assert.equal(h.render("jobs").notice, null);
});

test("errors and in-progress requests stay visible through navigation until handled", t => {
  const h = noticeHarness(t);
  for (const kind of ["error", "warning", "progress"]) {
    h.render("jobs").setStatus("Request needs attention.", kind); h.render();
    t.mock.timers.tick(10000);
    assert.equal(h.render("today").notice.kind, kind);
  }
});

test("unmount cancels the timer without updating the abandoned workspace", t => {
  const h = noticeHarness(t);
  h.render().setStatus("Saved.", "success"); h.render();
  h.dispose();
  t.mock.timers.tick(10000);
  assert.equal(h.render().notice.message, "Saved.");
});
