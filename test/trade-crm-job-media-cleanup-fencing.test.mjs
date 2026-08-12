import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import ts from "typescript";
import * as cleanupCore from "../src/lib/trade-crm-job-media-cleanup-core.mjs";

const cleanupSource = fs.readFileSync(new URL("../src/lib/trade-crm-job-media-cleanup.ts", import.meta.url), "utf8");
const workflowSource = fs.readFileSync(new URL("../src/lib/public-lead-quote-workflow-server.ts", import.meta.url), "utf8");

class Statement {
  constructor(database, sql, values = []) { this.database = database; this.sql = sql; this.values = values; }
  bind(...values) { return new Statement(this.database, this.sql, values); }
  async first() { return this.database.prepare(this.sql).get(...this.values) || null; }
  async all() { return { results: this.database.prepare(this.sql).all(...this.values) }; }
  async run() {
    const result = this.database.prepare(this.sql).run(...this.values);
    return { success: true, meta: { changes: Number(result.changes) } };
  }
}

function loadCleanup(database) {
  const output = ts.transpileModule(cleanupSource, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    fileName: "src/lib/trade-crm-job-media-cleanup.ts",
  }).outputText;
  const moduleRecord = { exports: {} };
  const require = (specifier) => {
    if (specifier === "./trade-crm-job-media-cleanup-core.mjs") return cleanupCore;
    throw new Error(`Unexpected module dependency: ${specifier}`);
  };
  new Function("require", "module", "exports", output)(require, moduleRecord, moduleRecord.exports);
  return {
    drain: moduleRecord.exports.drainTradeCrmJobMediaCleanup,
    d1: { prepare: (sql) => new Statement(database, sql) },
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((complete) => { resolve = complete; });
  return { promise, resolve };
}

test("a stale cleanup worker is fenced from the newer acceptance object in actual D1/R2 interleaving", async () => {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE trade_crm_job_media_cleanup (
      object_key text PRIMARY KEY, firebase_uid text NOT NULL, work_order_id text NOT NULL,
      attempt_id text NOT NULL, claim_token text DEFAULT '' NOT NULL, status text NOT NULL,
      attempts integer NOT NULL, next_attempt_at text NOT NULL, last_error text NOT NULL,
      created_at text NOT NULL, updated_at text NOT NULL
    );
    CREATE TABLE trade_crm_job_media (
      id text PRIMARY KEY, object_key text NOT NULL, firebase_uid text NOT NULL, work_order_id text NOT NULL
    );
    INSERT INTO trade_crm_job_media_cleanup VALUES (
      'crm-job-media/accepted-public-lead/tenant/job/photo/attempt-old/hash.jpg',
      'owner-1', 'job-1', 'attempt-old', '', 'retry', 0,
      '2026-08-12T00:00:00.000Z', '', '2026-08-12T00:00:00.000Z', '2026-08-12T00:00:00.000Z'
    );
  `);
  const { drain, d1 } = loadCleanup(database);
  const objects = new Map([["crm-job-media/accepted-public-lead/tenant/job/photo/attempt-old/hash.jpg", "old-bytes"]]);
  const firstDeleteStarted = deferred();
  const resumeFirstDelete = deferred();
  const firstBucket = {
    delete: async (key) => {
      firstDeleteStarted.resolve();
      await resumeFirstDelete.promise;
      objects.delete(key);
    },
  };
  const workerOne = drain({ db: d1, bucket: firstBucket, now: new Date("2026-08-12T00:00:01.000Z") });
  await firstDeleteStarted.promise;
  const firstToken = database.prepare("SELECT claim_token FROM trade_crm_job_media_cleanup").get().claim_token;
  assert.ok(firstToken);

  const workerTwo = await drain({
    db: d1,
    bucket: { delete: async (key) => { objects.delete(key); } },
    now: new Date("2026-08-12T00:06:02.000Z"),
  });
  assert.equal(workerTwo.completed, 1);
  assert.equal(database.prepare("SELECT COUNT(*) count FROM trade_crm_job_media_cleanup").get().count, 0);

  const newAttempt = "attempt-new";
  const newObjectKey = `crm-job-media/accepted-public-lead/tenant/job/photo/${newAttempt}/hash.jpg`;
  database.prepare(`INSERT INTO trade_crm_job_media_cleanup VALUES (?, 'owner-1', 'job-1', ?, '', 'staged', 0,
    '2026-08-12T00:21:00.000Z', '', '2026-08-12T00:06:03.000Z', '2026-08-12T00:06:03.000Z')`)
    .run(newObjectKey, newAttempt);
  objects.set(newObjectKey, "new-accepted-bytes");

  resumeFirstDelete.resolve();
  await workerOne;
  assert.equal(objects.get(newObjectKey), "new-accepted-bytes");
  database.prepare("INSERT INTO trade_crm_job_media VALUES ('media-new', ?, 'owner-1', 'job-1')").run(newObjectKey);
  assert.equal(database.prepare("SELECT COUNT(*) count FROM trade_crm_job_media WHERE object_key = ?").get(newObjectKey).count, 1);
  assert.match(workflowSource, /const attemptId = crypto\.randomUUID\(\)/);
  assert.match(workflowSource, /\$\{sourcePhotoId\}\/\$\{attemptId\}\/\$\{sha256\}/);
});
