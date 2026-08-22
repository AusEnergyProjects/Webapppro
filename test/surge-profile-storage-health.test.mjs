import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  parseSurgeProfileStorageHealthStatus,
  recordSurgeProfileStorageHealthAggregate,
} from "../src/lib/surge-profile-storage-health-server.ts";

test("storage health accepts only aggregate status values", () => {
  assert.equal(parseSurgeProfileStorageHealthStatus("save_failed"), "save_failed");
  assert.equal(parseSurgeProfileStorageHealthStatus("merge_recovered"), "merge_recovered");
  assert.equal(parseSurgeProfileStorageHealthStatus("contains profile text"), null);
  assert.equal(parseSurgeProfileStorageHealthStatus({ status: "load_failed" }), null);
});

test("storage health records only day, status, count and timestamp", async () => {
  const calls = [];
  const database = {
    prepare(sql) {
      return { bind(...values) { calls.push({ sql, values }); return { run: async () => ({ success: true }) }; } };
    },
  };
  await recordSurgeProfileStorageHealthAggregate(
    "load_failed",
    database,
    new Date("2026-08-22T03:04:05.000Z"),
  );
  assert.deepEqual(calls[0].values, ["2026-08-22", "load_failed", 1787367845000]);
  assert.doesNotMatch(
    calls[0].sql.replace("surge_profile_storage_health_daily", "storage_health_daily"),
    /profile_json|message|answer|firebase|email|uid/i,
  );
});

test("storage health migration remains aggregate only", () => {
  const migration = fs.readFileSync(new URL("../drizzle/0156_surge_profile_storage_health_daily.sql", import.meta.url), "utf8");
  assert.match(migration, /PRIMARY KEY \(`day`, `status`\)/);
  assert.match(migration, /event_count/);
  assert.doesNotMatch(migration, /uid|email|profile_json|message|answer/i);
});
