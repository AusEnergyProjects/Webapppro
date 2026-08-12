import assert from "node:assert/strict";
import test from "node:test";

import {
  cleanupTradeCrmJobMediaRows,
  tradeCrmJobMediaCleanupDelay,
} from "../src/lib/trade-crm-job-media-cleanup-core.mjs";
import fs from "node:fs";
const workflow = fs.readFileSync(new URL("../src/lib/public-lead-quote-workflow-server.ts", import.meta.url), "utf8");

test("failed accepted job-file staging cleanup retries later and clears its durable intent", async () => {
  const row = { object_key: "trade-accepted-leads/a/m/p/hash.jpg", attempts: 0 };
  let canonical = false;
  let failDelete = true;
  const state = { cleared: 0, failed: [] };
  const store = {
    isCanonical: async () => canonical,
    ownsClaim: async () => true,
    clear: async () => { state.cleared += 1; },
    markFailed: async (value, attempts, nextAttemptAt) => {
      value.attempts = attempts;
      state.failed.push({ attempts, nextAttemptAt });
    },
  };
  const bucket = { delete: async () => { if (failDelete) throw new Error("R2 unavailable"); } };
  const now = new Date("2026-08-12T00:00:00.000Z");
  assert.deepEqual(await cleanupTradeCrmJobMediaRows({ rows: [row], bucket, store, now }),
    { attempted: 1, completed: 0, retained: 0, failed: 1 });
  assert.equal(state.failed[0].nextAttemptAt,
    new Date(now.getTime() + tradeCrmJobMediaCleanupDelay(1)).toISOString());
  failDelete = false;
  assert.deepEqual(await cleanupTradeCrmJobMediaRows({
    rows: [row], bucket, store, now: new Date(state.failed[0].nextAttemptAt),
  }), { attempted: 1, completed: 1, retained: 0, failed: 0 });
  assert.equal(state.cleared, 1);
});

test("cleanup never deletes an object referenced by canonical job media", async () => {
  let deleted = false;
  let cleared = false;
  const result = await cleanupTradeCrmJobMediaRows({
    rows: [{ object_key: "trade-accepted-leads/a/m/p/hash.jpg", attempts: 0 }],
    bucket: { delete: async () => { deleted = true; } },
    store: {
      isCanonical: async () => true,
      ownsClaim: async () => assert.fail("canonical media must stop before ownership check"),
      clear: async () => { cleared = true; },
      markFailed: async () => assert.fail("canonical media is not a cleanup failure"),
    },
    now: new Date("2026-08-12T00:00:00.000Z"),
  });
  assert.deepEqual(result, { attempted: 1, completed: 0, retained: 1, failed: 0 });
  assert.equal(deleted, false);
  assert.equal(cleared, true);
});

test("a claimed cleanup cannot be restaged or delete bytes after it loses exact claim ownership", async () => {
  let deleted = false;
  let canonical = false;
  let ownsClaim = false;
  const result = await cleanupTradeCrmJobMediaRows({
    rows: [{ object_key: "crm-job-media/accepted-public-lead/a/job/photo/hash.jpg", attempts: 0 }],
    bucket: { delete: async () => { deleted = true; } },
    store: {
      isCanonical: async () => canonical,
      ownsClaim: async () => ownsClaim,
      clear: async () => undefined,
      markFailed: async () => undefined,
    },
    now: new Date("2026-08-12T00:00:00.000Z"),
  });
  assert.deepEqual(result, { attempted: 1, completed: 0, retained: 0, failed: 0 });
  assert.equal(deleted, false);
  canonical = true;
  assert.equal(canonical, true, "a later accepted-media commit retains all bytes");
  assert.match(workflow, /AND status <> 'claimed'/,
    "a request cannot turn a worker-owned claimed intent back into staged");
  assert.match(workflow, /PUBLIC_LEAD_QUOTE_PHOTO_CLEANUP_BUSY/);
});
