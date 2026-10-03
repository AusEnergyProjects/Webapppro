import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import ts from "typescript";
import * as photoContract from "../src/lib/trade-photo-requests.ts";
import { photoRequestEvidenceKey } from "../src/lib/photo-request-review.ts";

const routeSource = readFileSync(new URL("../src/app/api/job-information/[token]/route.ts", import.meta.url), "utf8");
const routeCode = ts.transpileModule(routeSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const requirement = { id: "front", label: "Front of unit", guidance: "Show the unit.", usefulExample: "Clear view", avoidExample: "Private details", required: true };
const secret = "a".repeat(48);
const token = `11111111-1111-4111-8111-111111111111.${secret}`;

async function fixture(t) {
  const sqlite = new DatabaseSync(":memory:");
  t.after(() => sqlite.close());
  sqlite.exec(`
    CREATE TABLE trade_work_orders(id TEXT PRIMARY KEY, firebase_uid TEXT, partner_type TEXT, record_status TEXT, source_type TEXT,
      stage TEXT, revision INTEGER, work_number TEXT, title TEXT, service_category TEXT, assignee_member_id TEXT, updated_at TEXT);
    CREATE TABLE trade_accounts(firebase_uid TEXT PRIMARY KEY, partner_type TEXT, verified INTEGER, business_name TEXT, address_state TEXT);
    CREATE TABLE trade_crm_job_details(work_order_id TEXT, firebase_uid TEXT, crm_customer_id TEXT, customer_source TEXT, service_site_id TEXT);
    CREATE TABLE trade_crm_service_sites(id TEXT, firebase_uid TEXT, address_state TEXT);
    CREATE TABLE trade_crm_appointments(work_order_id TEXT, firebase_uid TEXT, status TEXT, starts_at TEXT, ends_at TEXT);
    CREATE TABLE trade_crm_job_media(id TEXT PRIMARY KEY,work_order_id TEXT,firebase_uid TEXT,category TEXT,file_name TEXT,content_type TEXT,
      size_bytes INTEGER,object_key TEXT,caption TEXT,created_at TEXT,updated_at TEXT);
    CREATE TABLE trade_crm_photo_request_deliveries(id TEXT);
    CREATE TABLE trade_work_order_events(id TEXT PRIMARY KEY,work_order_id TEXT,firebase_uid TEXT,event_type TEXT NOT NULL,summary TEXT NOT NULL,created_at TEXT);
    CREATE TABLE compliance_case_evidence(job_media_id TEXT);
    CREATE TABLE fixture_sync(work_order_id TEXT,revision INTEGER);
    CREATE TABLE fixture_quote_scope(id TEXT PRIMARY KEY, owner_uid TEXT, work_order_id TEXT, customer_id TEXT, active INTEGER);
    INSERT INTO trade_work_orders VALUES('job','owner','installer','active','manual','scheduled',3,'TL-123','Private job','electrical','member','');
    INSERT INTO trade_accounts VALUES('owner','installer',1,'Private Business','NSW');
    INSERT INTO trade_crm_job_details VALUES('job','owner','customer','trade_owned','site');
    INSERT INTO trade_crm_service_sites VALUES('site','owner','NSW');
    INSERT INTO fixture_quote_scope VALUES('quote','owner','job','customer',1);
  `);
  // Use the actual NOT NULL assertion and completion uniqueness constraints.
  for (const migration of ["0060_customer_photo_requests.sql", "0063_photo_request_review.sql"]) {
    sqlite.exec(readFileSync(new URL(`../drizzle/${migration}`, import.meta.url), "utf8"));
  }
  sqlite.prepare(`INSERT INTO trade_crm_photo_requests
    (id,work_order_id,firebase_uid,crm_customer_id,token_hash,requirements,expires_at,created_by_uid,created_at,updated_at)
    VALUES('11111111-1111-4111-8111-111111111111','job','owner','customer',?,?,'2999-01-01T00:00:00.000Z','owner','','')`)
    .run(await photoContract.hashPhotoRequestSecret(secret), JSON.stringify([requirement]));

  const hooks = { beforeBatch: null, afterCommit: null, put: null, proof: null };
  class Statement {
    constructor(sql, values = []) { this.sql = sql; this.values = values; }
    bind(...values) { return new Statement(this.sql, values); }
    async first() { return sqlite.prepare(this.sql).get(...this.values) || null; }
    async all() { return { results: sqlite.prepare(this.sql).all(...this.values) }; }
    runSync() { return { meta: { changes: Number(sqlite.prepare(this.sql).run(...this.values).changes) } }; }
    async run() { return this.runSync(); }
  }
  const db = {
    prepare: sql => new Statement(sql),
    async batch(statements) {
      const hook = hooks.beforeBatch; hooks.beforeBatch = null; hook?.();
      sqlite.exec("BEGIN");
      let results;
      try { results = statements.map(statement => statement.runSync()); sqlite.exec("COMMIT"); }
      catch (error) { sqlite.exec("ROLLBACK"); throw error; }
      // Simulate a lost D1 response after durable commit, not a rolled-back batch.
      const afterCommit = hooks.afterCommit; hooks.afterCommit = null; afterCommit?.();
      return results;
    },
  };
  const objects = new Map(), deleted = [], puts = [];
  const bucket = {
    async put(key, bytes) { objects.set(key, bytes); puts.push(key); const hook = hooks.put; hooks.put = null; hook?.(); },
    async delete(key) { deleted.push(key); objects.delete(key); },
  };
  const imports = {
    "cloudflare:workers": { env: { EVIDENCE: bucket } },
    "../../../../../db": { getD1: () => db },
    "@/lib/admin-server": { cleanAdminText: (value, max) => String(value || "").trim().slice(0, max), sameOrigin: request => request.headers.get("origin") === "https://example.test" },
    "@/lib/private-image-evidence": { hasAllowedSignature: () => true, sanitiseQuotingPhoto: bytes => bytes },
    "@/lib/trade-team-sync-server": {
      nextJobRevision: value => Number(value) + 1,
      jobSyncChangeStatements: (database, change, guard) => [database.prepare(`INSERT INTO fixture_sync SELECT ?,? WHERE ${guard?.sql || "1=1"}`)
        .bind(change.workOrderId, change.revision, ...(guard?.values || []))],
    },
    "@/lib/photo-request-review": { photoRequestEvidenceKey },
    "@/lib/photo-request-review-server": { photoRequestProofOverview: async () => {
      const hook = hooks.proof; hooks.proof = null; hook?.();
      const count = sqlite.prepare("SELECT COUNT(*) n FROM trade_crm_job_media").get().n;
      const completion = sqlite.prepare("SELECT completion_revision revision,completed_at completedAt FROM trade_crm_photo_request_completions ORDER BY completion_revision DESC LIMIT 1").get();
      return { completion: completion ? { ...completion, current: true } : null, reviews: [], outstandingRequirementIds: count ? [] : [requirement.id],
        proofReady: false, counts: { supplied: count } };
    } },
    "@/lib/customer-appointment-calendar": { australianAppointmentTimeZone: () => "Australia/Sydney", customerAppointmentCalendar: () => null },
    "@/lib/trade-access-server": { verifiedTradeAccountPredicate: alias => `${alias}.verified=1` },
    "@/lib/creditex-schema-guards": { ensureCreditexSchemaGuards: async () => {} },
    // Actual journey scope is exercised by customer-job-journey.test.mjs. This
    // scoped table isolates whether the route rechecks it at every boundary.
    "@/lib/customer-job-journey-server": { customerJobScope: link => ({
      sql: `FROM fixture_quote_scope scope JOIN trade_work_orders work ON work.id=scope.work_order_id AND work.firebase_uid=scope.owner_uid
        JOIN trade_crm_job_details detail ON detail.work_order_id=work.id AND detail.firebase_uid=work.firebase_uid AND detail.crm_customer_id=scope.customer_id
        WHERE scope.id=? AND scope.owner_uid=? AND scope.work_order_id=? AND scope.customer_id=? AND scope.active=1`,
      bindings: [link.id, link.firebase_uid, link.work_order_id, link.crm_customer_id],
    }) },
    "@/lib/trade-photo-requests": photoContract,
  };
  const exported = { exports: {} };
  new Function("require", "module", "exports", routeCode)(key => { assert.ok(key in imports, key); return imports[key]; }, exported, exported.exports);
  const context = { params: Promise.resolve({ token }), quoteLink: { id: "quote", firebase_uid: "owner", work_order_id: "job", crm_customer_id: "customer" } };
  function seedPhoto() {
    sqlite.prepare(`INSERT INTO trade_crm_job_media
      (id,work_order_id,firebase_uid,category,file_name,content_type,size_bytes,object_key,caption,created_at,updated_at,source,photo_request_id,photo_requirement_id,request_revision)
      VALUES('existing','job','owner','before','photo.jpg','image/jpeg',3,'existing-object','Private caption','','','customer_request','11111111-1111-4111-8111-111111111111','front',1)`).run();
    objects.set("existing-object", new Uint8Array([1, 2, 3]));
  }
  const count = table => Number(sqlite.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n);
  return { sqlite, route: exported.exports, context, hooks, objects, deleted, puts, seedPhoto, count };
}

function uploadRequest(onBody) {
  const form = new FormData();
  form.set("requirementId", requirement.id); form.set("file", new File([new Uint8Array([1, 2, 3])], "test.jpg", { type: "image/jpeg" }));
  form.set("checklistVersion", photoContract.PHOTO_REQUEST_CHECKLIST_VERSION);
  for (const key of ["confirmClarity", "confirmRelevance", "confirmPrivacy"]) form.set(key, "true");
  const request = new Request("https://example.test/api/photo", { method: "POST", headers: { origin: "https://example.test" }, body: form });
  if (onBody) { const read = request.formData.bind(request); request.formData = async () => { const body = await read(); onBody(); return body; }; }
  return request;
}
const completeRequest = () => new Request("https://example.test/api/photo", { method: "POST", headers: { origin: "https://example.test", "content-type": "application/json" },
  body: JSON.stringify({ action: "complete_request", checklistVersion: photoContract.PHOTO_REQUEST_CHECKLIST_VERSION, confirmed: true }) });
const deleteRequest = () => new Request("https://example.test/api/photo?id=existing", { method: "DELETE", headers: { origin: "https://example.test" } });
const changes = [
  ["quote revoked", "UPDATE fixture_quote_scope SET active=0"],
  ["photo link revoked", "UPDATE trade_crm_photo_requests SET status='revoked',token_hash=''"],
  ["photo requirements revised", "UPDATE trade_crm_photo_requests SET revision=revision+1"],
  ["customer reassigned", "UPDATE trade_crm_job_details SET crm_customer_id='another-customer'"],
];

test("photo GET rechecks quote and request authority after reading private payload", async t => {
  for (const [name, sql] of changes) await t.test(name, async t => {
    const f = await fixture(t); f.seedPhoto(); f.hooks.proof = () => f.sqlite.exec(sql);
    const response = await f.route.GET(new Request("https://example.test/api/photo"), f.context);
    assert.equal(response.status, 410); const body = await response.json();
    assert.equal(body.ok, false); assert.equal(body.uploads, undefined); assert.equal(body.job, undefined);
  });
});

test("upload rejects authority changes during body read, object storage and transaction entry and cleans staged storage", async t => {
  for (const boundary of ["body", "put", "beforeBatch"]) for (const [name, sql] of changes) await t.test(`${boundary}: ${name}`, async t => {
    const f = await fixture(t); const change = () => f.sqlite.exec(sql);
    if (boundary !== "body") f.hooks[boundary] = change;
    const response = await f.route.POST(uploadRequest(boundary === "body" ? change : undefined), f.context);
    assert.equal(response.status, 410); assert.equal(f.count("trade_crm_job_media"), 0);
    assert.equal(f.count("trade_crm_photo_request_events"), 0); assert.equal(f.count("trade_work_order_events"), 0);
    assert.equal(f.count("fixture_sync"), 0); assert.equal(f.objects.size, 0);
    assert.equal(f.sqlite.prepare("SELECT revision FROM trade_work_orders").get().revision, 3);
    assert.equal(f.puts.length, 1); assert.deepEqual(f.deleted, f.puts);
  });
});

test("delete rejected at transaction entry preserves both database evidence and existing object", async t => {
  for (const [name, sql] of changes) await t.test(name, async t => {
    const f = await fixture(t); f.seedPhoto(); f.hooks.beforeBatch = () => f.sqlite.exec(sql);
    const response = await f.route.DELETE(deleteRequest(), f.context);
    assert.equal(response.status, 410); assert.equal(f.count("trade_crm_job_media"), 1);
    assert.equal(f.objects.has("existing-object"), true); assert.deepEqual(f.deleted, []);
    assert.equal(f.count("trade_crm_photo_request_events"), 0); assert.equal(f.count("fixture_sync"), 0);
  });
});

test("upload retains committed evidence when D1 commits but its response fails", async t => {
  const f = await fixture(t);
  f.hooks.afterCommit = () => { throw new Error("D1 response lost after commit"); };
  const response = await f.route.POST(uploadRequest(), f.context);
  assert.equal(response.status, 201, "A verified durable commit can recover the lost D1 acknowledgement");
  const media = f.sqlite.prepare("SELECT id,object_key,firebase_uid,work_order_id,photo_request_id FROM trade_crm_job_media").get();
  assert.ok(media, "The database commit must have survived the simulated transport error");
  assert.equal(media.firebase_uid, "owner"); assert.equal(media.work_order_id, "job");
  assert.equal(media.photo_request_id, "11111111-1111-4111-8111-111111111111");
  assert.equal(f.objects.has(media.object_key), true, "Compensation must not delete storage referenced by committed evidence");
  assert.deepEqual(f.deleted, []); assert.equal(f.puts.length, 1);
  assert.equal(f.count("trade_crm_photo_request_events"), 1); assert.equal(f.count("trade_work_order_events"), 1);
  assert.equal(f.count("fixture_sync"), 1); assert.equal(f.sqlite.prepare("SELECT revision FROM trade_work_orders").get().revision, 4);
  const reopened = await f.route.GET(new Request("https://example.test/api/photo"), f.context);
  assert.equal(reopened.status, 200); assert.deepEqual((await reopened.json()).uploads.map(upload => upload.id), [media.id]);
});

test("completion guard rejects revoked authority without partial completion, events or sync", async t => {
  for (const [name, sql] of changes) await t.test(name, async t => {
    const f = await fixture(t); f.seedPhoto(); f.hooks.beforeBatch = () => f.sqlite.exec(sql);
    const response = await f.route.POST(completeRequest(), f.context);
    assert.equal(response.status, 410); assert.equal(f.count("trade_crm_photo_request_completions"), 0);
    assert.equal(f.count("trade_crm_photo_request_events"), 0); assert.equal(f.count("trade_work_order_events"), 0);
    assert.equal(f.count("fixture_sync"), 0); assert.equal(f.objects.has("existing-object"), true);
  });
});

test("completion replay retains one completion, event set, job revision and sync change", async t => {
  const f = await fixture(t); f.seedPhoto();
  for (let i = 0; i < 2; i++) assert.equal((await f.route.POST(completeRequest(), f.context)).status, 200);
  assert.equal(f.count("trade_crm_photo_request_completions"), 1); assert.equal(f.count("trade_crm_photo_request_events"), 1);
  assert.equal(f.count("trade_work_order_events"), 1); assert.equal(f.count("fixture_sync"), 1);
  assert.equal(f.sqlite.prepare("SELECT revision FROM trade_work_orders").get().revision, 4);
});

test("a later event failure rolls the completion insert back with the whole transaction", async t => {
  const f = await fixture(t); f.seedPhoto();
  f.sqlite.exec(`CREATE TRIGGER fixture_completion_event_failure BEFORE INSERT ON trade_work_order_events
    WHEN NEW.event_type='customer_photo_request_completed' BEGIN SELECT RAISE(ABORT,'fixture downstream failure'); END;`);
  const response = await f.route.POST(completeRequest(), f.context);
  assert.equal(response.status, 500); assert.equal(f.count("trade_crm_photo_request_completions"), 0);
  assert.equal(f.count("trade_crm_photo_request_events"), 0); assert.equal(f.count("trade_work_order_events"), 0);
  assert.equal(f.count("fixture_sync"), 0); assert.equal(f.sqlite.prepare("SELECT revision FROM trade_work_orders").get().revision, 3);
});

test("valid upload and deletion still work through the quote scope without exposing capability secrets", async t => {
  const f = await fixture(t);
  const response = await f.route.POST(uploadRequest(), f.context); assert.equal(response.status, 201);
  const body = await response.json(); assert.equal(body.uploads.length, 1);
  assert.doesNotMatch(JSON.stringify(body), new RegExp(secret)); assert.equal(body.token, undefined);
  const id = body.uploads[0].id;
  const removed = await f.route.DELETE(new Request(`https://example.test/api/photo?id=${id}`, { method: "DELETE", headers: { origin: "https://example.test" } }), f.context);
  assert.equal(removed.status, 200); assert.equal(f.count("trade_crm_job_media"), 0); assert.equal(f.objects.size, 0);
});

test("standalone photo links keep their existing upload flow without quote context", async t => {
  const f = await fixture(t); f.sqlite.exec("UPDATE fixture_quote_scope SET active=0");
  const context = { params: Promise.resolve({ token }) };
  const response = await f.route.POST(uploadRequest(), context);
  assert.equal(response.status, 201); assert.equal(f.count("trade_crm_job_media"), 1);
  assert.equal((await f.route.GET(new Request("https://example.test/api/photo"), context)).status, 200);
});
