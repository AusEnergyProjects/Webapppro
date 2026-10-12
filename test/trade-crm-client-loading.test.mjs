import test from "node:test";
import assert from "node:assert/strict";
import { createCrmListViewLoader, crmIndexRequestDelay } from "../src/lib/trade-crm-client-loading.ts";

test("prefetch and register navigation share one request while job and customer views run independently", async () => {
  const requests = [];
  const completions = new Map();
  const loader = createCrmListViewLoader((view, signal) => new Promise(resolve => {
    requests.push({ view, signal });
    completions.set(view, resolve);
  }));
  const jobs = loader.load("installer-jobs");
  const customers = loader.load("installer-customers");
  assert.equal(loader.load("installer-jobs"), jobs);
  assert.equal(loader.load("installer-customers"), customers);
  assert.deepEqual(requests.map(request => request.view), ["installer-jobs", "installer-customers"]);
  completions.get("installer-customers")({ preferences: { search: "Saved customer filter" } });
  assert.deepEqual(await customers, { preferences: { search: "Saved customer filter" } });
  completions.get("installer-jobs")({ preferences: { sort: "updated-desc" } });
  assert.deepEqual(await jobs, { preferences: { sort: "updated-desc" } });
  assert.equal(loader.load("installer-customers"), customers, "opening the other register does not wait for a second saved-view fetch");
});

test("failed preference reads remain failures and can be retried without caching an empty success", async () => {
  let attempts = 0;
  const loader = createCrmListViewLoader(async () => {
    if (++attempts === 1) throw new Error("Saved view unavailable");
    return { preferences: { search: "Existing saved filter" } };
  });
  await assert.rejects(loader.load("installer-jobs"), /Saved view unavailable/);
  assert.deepEqual(await loader.load("installer-jobs"), { preferences: { search: "Existing saved filter" } });
  assert.equal(attempts, 2);
});

test("leaving a user or business aborts pending reads and clears results without crossing scopes", async () => {
  const signals = [];
  const loader = createCrmListViewLoader(async (_view, signal) => {
    signals.push(signal);
    return { search: "First business" };
  });
  const previous = loader.load("installer-jobs");
  await previous;
  loader.cancel();
  assert.equal(signals[0].aborted, true);
  assert.notEqual(loader.load("installer-jobs"), previous);
  const otherBusiness = createCrmListViewLoader(async () => ({ search: "Second business" }));
  assert.deepEqual(await otherBusiness.load("installer-jobs"), { search: "Second business" });
});

test("a cancelled request settling later cannot remove its replacement", async () => {
  const failures = [];
  const loader = createCrmListViewLoader(() => new Promise((_resolve, reject) => failures.push(reject)));
  const cancelled = loader.load("installer-jobs");
  const cancellation = assert.rejects(cancelled, /cancelled/i);
  loader.cancel();
  const replacement = loader.load("installer-jobs");
  failures[0](new Error("Cancelled"));
  await cancellation;
  assert.equal(loader.load("installer-jobs"), replacement);
  const failure = assert.rejects(replacement, /Replacement failed/);
  failures[1](new Error("Replacement failed"));
  await failure;
});

test("sorting, paging and returning to a register do not inherit the typing debounce", () => {
  assert.equal(crmIndexRequestDelay(null, "customer"), 0);
  assert.equal(crmIndexRequestDelay("customer", "customer"), 0);
  assert.equal(crmIndexRequestDelay("customer", "customer name"), 180);
});

test("a stalled saved-view request aborts and reports its timeout, then a retry can succeed", async () => {
  const pending = new Map();
  let nextId = 0;
  const timers = {
    setTimeout(callback, delay) { assert.equal(delay, 5000); pending.set(++nextId, callback); return nextId; },
    clearTimeout(id) { pending.delete(id); },
  };
  let signal;
  let calls = 0;
  const loader = createCrmListViewLoader(async (_view, requestSignal) => {
    signal = requestSignal;
    return ++calls === 1 ? new Promise(() => {}) : { preferences: { search: "Saved filter" } };
  }, 5000, timers);
  const stalled = loader.load("installer-jobs");
  const timedOut = assert.rejects(stalled, /saved list view took too long.*saved filters could not be applied/);
  pending.values().next().value();
  await timedOut;
  assert.equal(signal.aborted, true);
  assert.equal(pending.size, 0, "settlement clears the deadline");
  assert.deepEqual(await loader.load("installer-jobs"), { preferences: { search: "Saved filter" } });
  assert.equal(pending.size, 0);
});

test("unmount cancellation clears the deadline and settles even when a reader ignores abort", async () => {
  const pending = new Map();
  const timers = { setTimeout(callback) { pending.set(1, callback); return 1; }, clearTimeout(id) { pending.delete(id); } };
  const loader = createCrmListViewLoader(() => new Promise(() => {}), 5000, timers);
  const request = loader.load("installer-customers");
  const cancelled = assert.rejects(request, { name: "AbortError" });
  loader.cancel();
  await cancelled;
  assert.equal(pending.size, 0);
});
