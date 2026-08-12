import assert from "node:assert/strict";
import test from "node:test";

import {
  cleanupTradeTeamMemberFileRows,
  tradeTeamMemberCleanupDelay,
} from "../src/lib/trade-team-member-file-cleanup-core.mjs";

test("member vault cleanup retries a failed R2 delete without another vault request", async () => {
  const row = { id: "file-1", owner_uid: "owner-1", team_member_id: "member-1",
    object_key: "trade-team-members/owner-1/member-1/file-1", cleanup_attempts: 0, status: "cleanup_pending" };
  const state = { rows: [row], deleted: [], failed: [] };
  let failDelete = true;
  const bucket = { delete: async () => { if (failDelete) throw new Error("R2 unavailable"); } };
  const store = {
    markDeleted: async (value) => { state.deleted.push(value.id); },
    markFailed: async (value, attempts, nextCleanupAt) => {
      value.cleanup_attempts = attempts;
      state.failed.push({ id: value.id, attempts, nextCleanupAt });
    },
  };
  const firstNow = new Date("2026-08-12T00:00:00.000Z");
  const first = await cleanupTradeTeamMemberFileRows({ rows: state.rows, bucket, store, now: firstNow });
  assert.deepEqual(first, { attempted: 1, completed: 0, failed: 1 });
  assert.equal(state.failed[0].attempts, 1);
  assert.equal(state.failed[0].nextCleanupAt,
    new Date(firstNow.getTime() + tradeTeamMemberCleanupDelay(1)).toISOString());

  failDelete = false;
  const scheduledRetry = await cleanupTradeTeamMemberFileRows({
    rows: state.rows,
    bucket,
    store,
    now: new Date(state.failed[0].nextCleanupAt),
  });
  assert.deepEqual(scheduledRetry, { attempted: 1, completed: 1, failed: 0 });
  assert.deepEqual(state.deleted, ["file-1"]);
});

test("member vault cleanup backoff remains bounded and does not abandon retries", () => {
  assert.equal(tradeTeamMemberCleanupDelay(1), 120_000);
  assert.equal(tradeTeamMemberCleanupDelay(100), 3_600_000);
});
