import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as fflate from "fflate";
import * as preflight from "../src/lib/creditex-interchange-preflight.ts";
import * as registry from "../src/lib/creditex-registry.ts";
import * as formats from "../src/lib/creditex-registry-formats.ts";
import * as lifecycleSql from "../src/lib/creditex-job-lifecycle-sql.ts";
import { fixture, HASH, NOW, author, reviewer, auditor } from "./helpers/creditex-registry-fixture.mjs";
import { REGISTRY_BATCH_GUARD_NAMES, lifecycleGuardFixture } from "./helpers/creditex-lifecycle-guards-fixture.mjs";

function load(name, dependencies) {
  const compiled = ts.transpileModule(readFileSync(new URL(`../src/lib/${name}.ts`, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const loaded = { exports: {} };
  new Function("require", "module", "exports", compiled)((key) => { assert.ok(Object.hasOwn(dependencies, key), key); return dependencies[key]; }, loaded, loaded.exports);
  return loaded.exports;
}

function batchFixture(t) {
  const f = fixture(t);
  f.sqlite.exec(`
    CREATE TABLE compliance_output_action_packets(id TEXT PRIMARY KEY, organisation_id TEXT, packet_sha256 TEXT, packet_snapshot TEXT,
      action_kind TEXT, output_class TEXT, output_code TEXT, program_code TEXT, activity_template_id TEXT, activity_version_id TEXT,
      compliance_case_id TEXT, work_pack_instance_id TEXT, work_pack_final_record_id TEXT, quantity_text TEXT, unit TEXT,
      idempotency_key TEXT, prepared_by_uid TEXT, prepared_actor_kind TEXT, prepared_at TEXT, case_revision INTEGER DEFAULT 1);
    CREATE TABLE compliance_output_action_reviews(organisation_id TEXT, packet_id TEXT, packet_sha256 TEXT, decision TEXT,
      reviewed_by_uid TEXT, reviewed_actor_kind TEXT, review_note TEXT, reviewed_at TEXT);
    CREATE TABLE compliance_output_action_events(id TEXT PRIMARY KEY, organisation_id TEXT, packet_id TEXT, sequence INTEGER,
      from_status TEXT, to_status TEXT, actor_kind TEXT, actor_uid TEXT, adapter_receipt_id TEXT, summary TEXT, metadata TEXT,
      occurred_at TEXT, created_at TEXT, UNIQUE(organisation_id,packet_id,sequence));
    CREATE TABLE compliance_output_action_adapter_receipts(id TEXT PRIMARY KEY, organisation_id TEXT, packet_id TEXT, adapter_id TEXT,
      provider_name TEXT, request_snapshot TEXT, request_sha256 TEXT, response_snapshot TEXT, response_sha256 TEXT,
      provider_reference TEXT, provider_status TEXT, http_status INTEGER, response_received_at TEXT, created_at TEXT);
    CREATE TABLE compliance_activity_work_pack_instances(id TEXT, organisation_id TEXT, work_order_id TEXT, compliance_intent_id TEXT, instance_key TEXT, revision INTEGER, status TEXT, compliance_case_id TEXT);
    CREATE TABLE compliance_activity_work_pack_final_records(id TEXT, case_instance_id TEXT, organisation_id TEXT, pdf_sha256 TEXT, object_key TEXT);
    CREATE TABLE trade_activity_field_records(id TEXT, intent_id TEXT, work_order_id TEXT, owner_uid TEXT, organisation_id TEXT, revision INTEGER, status TEXT, pdf_sha256 TEXT, pdf_object_key TEXT, supersedes_record_id TEXT DEFAULT '');
    CREATE TABLE compliance_cases(id TEXT, organisation_id TEXT, case_number TEXT, installer_uid TEXT, work_order_id TEXT, compliance_intent_id TEXT, status TEXT, evidence_status TEXT, revision INTEGER DEFAULT 1);
    CREATE TABLE trade_work_order_compliance_intents(id TEXT, work_order_id TEXT, installer_uid TEXT, compliance_organisation_id TEXT, revision INTEGER, intent_snapshot_sha256 TEXT, status TEXT, compliance_case_id TEXT);
    CREATE TABLE creditex_job_lifecycle_events(organisation_id TEXT, work_order_id TEXT, owner_uid TEXT, intent_id TEXT, action TEXT, actor_kind TEXT, source_snapshot TEXT, id TEXT, created_at TEXT);
    CREATE TABLE compliance_activity_versions(id TEXT, title TEXT);
    CREATE TABLE trade_work_orders(id TEXT, firebase_uid TEXT, work_number TEXT, title TEXT, record_status TEXT, stage TEXT);
    CREATE TABLE trade_crm_job_details(work_order_id TEXT, firebase_uid TEXT, customer_source TEXT, crm_customer_id TEXT);
    CREATE TABLE trade_crm_customers(id TEXT, firebase_uid TEXT, record_status TEXT, business_name TEXT, first_name TEXT, last_name TEXT);
  `);
  f.sqlite.exec(readFileSync(new URL("../drizzle/0188_creditex_output_dispatch_intents.sql", import.meta.url), "utf8"));
  f.sqlite.exec(readFileSync(new URL("../drizzle/0192_creditex_registry_batches.sql", import.meta.url), "utf8"));
  const output = load("creditex-output-action-server", {
    "./creditex-job-lifecycle-sql": lifecycleSql,
    "./australian-government-program-catalogue": { GOVERNMENT_PROGRAM_TEMPLATES: [] },
    "./creditex-activity-work-pack-server": { async loadCreditexWorkPackGovernanceIdentity(_db, actor) {
      return { role: "admin", access: { canAuthor: actor.actorUid !== "auditor", canReview: true } };
    } },
    "./creditex-interchange-preflight": preflight,
    "./creditex-work-pack-schema-guards": { async ensureCreditexWorkPackSchemaGuards() {} },
  });
  const revoked = new Set();
  const outputDependencies = { ...output, async recheckOutputDispatchEvidence(_db, _actor, packet) {
    if (revoked.has(packet.id)) throw new registryError("OUTPUT_ACTION_EVIDENCE_CHANGED", 409, "Evidence withdrawn");
  } };
  const registryError = f.service.CreditexRegistryError;
  const exports = load("creditex-registry-exports", {
    "./creditex-interchange-preflight": preflight, "./creditex-registry-formats": formats,
    "./creditex-registry": registry, "./creditex-registry-server": f.service, "./creditex-output-action-server": outputDependencies,
  });
  const service = load("creditex-registry-batches", {
    "./creditex-job-lifecycle-schema-guards": lifecycleGuardFixture(f.sqlite, REGISTRY_BATCH_GUARD_NAMES),
    fflate, "./creditex-interchange-preflight": preflight, "./creditex-registry-formats": formats,
    "./creditex-registry": registry, "./creditex-registry-server": f.service,
    "./creditex-job-lifecycle-sql": lifecycleSql,
    "./creditex-output-action-server": outputDependencies, "./creditex-registry-exports": exports,
  });
  function packet(id = "packet-one", changes = {}) {
    const value = { ...f.packet, id, programCode: "VEU", activityTemplateId: "veu-test", status: "prepared", providerReference: "",
      complianceCaseId: `case-${id}`, packet: { contract: "retained-packet", id }, review: { decision: "approved", reviewedAt: "2026-09-22T00:00:00.000Z" }, ...changes };
    f.packets.set(`org-one:${id}`, value);
    f.sqlite.prepare(`INSERT INTO compliance_output_action_packets(id,organisation_id,packet_sha256,packet_snapshot,action_kind,output_class,output_code,program_code,
      activity_template_id,activity_version_id,compliance_case_id,work_pack_instance_id,work_pack_final_record_id,quantity_text,unit,idempotency_key,prepared_by_uid,prepared_actor_kind,prepared_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, author.organisationId, HASH, JSON.stringify(value.packet), "certificate_submission", "tradable_certificate", value.unit,
      value.programCode, value.activityTemplateId, `version-${id}`, value.complianceCaseId, `instance-${id}`, `final-${id}`, value.quantity, value.unit, id, "preparer", "compliance", value.preparedAt);
    f.sqlite.prepare("INSERT INTO compliance_output_action_reviews VALUES(?,?,?,?,?,?,?,?)").run(author.organisationId, id, HASH, "approved", "reviewer", "compliance", "Verified", value.review.reviewedAt);
    f.sqlite.prepare("INSERT INTO compliance_cases(id,organisation_id,case_number,installer_uid,work_order_id,compliance_intent_id,status,evidence_status) VALUES(?,?,?,?,?,?,?,?)").run(value.complianceCaseId, author.organisationId, id, "installer", `work-${id}`, `intent-${id}`, "ready_for_submission", "verified");
    f.sqlite.prepare("INSERT INTO compliance_activity_work_pack_instances VALUES(?,?,?,?,?,?,?,?)").run(`instance-${id}`, author.organisationId, `work-${id}`, `intent-${id}`, `key-${id}`, 1, "completed", value.complianceCaseId);
    f.sqlite.prepare("INSERT INTO compliance_activity_work_pack_final_records VALUES(?,?,?,?,?)").run(`final-${id}`, `instance-${id}`, author.organisationId, HASH.slice(7), `pdf-${id}`);
    f.sqlite.prepare("INSERT INTO trade_work_orders VALUES(?,?,?,?,?,?)").run(`work-${id}`, "installer", `JOB-${id}`, "Test job", "active", "complete");
    f.sqlite.prepare("INSERT INTO trade_work_order_compliance_intents VALUES(?,?,?,?,?,?,?,?)").run(`intent-${id}`, `work-${id}`, "installer", author.organisationId, 1, HASH.slice(7), "case_linked", value.complianceCaseId);
    const snapshot = f.sqlite.prepare(`SELECT ${lifecycleSql.creditexIntentCompletionSnapshotSql()} snapshot FROM trade_work_order_compliance_intents intent WHERE id=?`).get(`intent-${id}`).snapshot;
    f.sqlite.prepare("INSERT INTO creditex_job_lifecycle_events VALUES(?,?,?,?,?,?,?,?,?)").run(author.organisationId, `work-${id}`, "installer", `intent-${id}`, "reviewed", "trade", snapshot, `review-${id}`, "2026-09-22T00:00:00Z");
    return value;
  }
  async function bind(value, accountId) {
    await f.service.attachRegistryAccount(f.db, author, { accountId, packetId: value.id, expectedPacketSha256: HASH }, f.options);
  }
  async function setup(ids = ["packet-one"], scheme = "veu") {
    const changed = scheme === "nsw_esc" ? { programCode: "NSW-ESS", activityTemplateId: "nsw-d16", unit: "ESC" } : {};
    const packets = ids.map(id => packet(id, changed));
    const accountId = await f.account(author, { scheme, activityScope: [packets[0].activityTemplateId] });
    for (const value of packets) await bind(value, accountId);
    return { accountId, packets };
  }
  async function official(accountId, packets) {
    const format = formats.listRegistryFormats().find(item => item.key === "nsw_esc");
    const rows = packets.map(value => ({
      "ACP Implementation Identifier": value.id, "Implementation Date": "01/08/2026", "Address Line 2 ( Street No , Street Name )": "10 TEST ST",
      Suburb: "SYDNEY", State: "NSW", Postcode: "2000", "End-User Business Classification": "Residential", "End-Use Service": "Air heating and cooling",
      "Purchase Cost (Excluding GST)": "500.00", "ESS Activity Definition": "D16", "Calculation Method": "Deemed Energy Savings Method - Home Energy Efficiency Retrofits",
      "Number of units installed": "1", "Product Brand": "Example", "Product Model Number": "Model", Refrigerant: "R32", "New or Replacement": "New",
      "Electricity Savings (MWh)": "10.00", "Regional Network Factor": "1", "Version of the Rule": "01/07/2026",
      "Company or individual responsible for work at site": "Example Pty Ltd", "Electrician licence": "123456", "Multi split system": "No",
    }));
    const csv = formats.serializeRegistryRows(format.key, rows).csv;
    assert.ok(csv);
    const id = await exports.prepareRegistryExport(f.db, author, { accountId, formatKey: format.key, packetIds: packets.map(value => value.id), baseVintage: "2026", csv }, f.options);
    await exports.reviewRegistryExport(f.db, reviewer, { exportId: id, decision: "approved", note: "Independently verified exact rows" }, f.options);
    return { id, csv };
  }
  return { ...f, service, output, exports, packet, setup, bind, official, revoke(id) { revoked.add(id); }, restore(id) { revoked.delete(id); },
    async export(requestId = "request-one", changes = {}) { return service.exportReadyRegistryBatch(f.db, author, { requestId, ...changes }, f.options); },
    async lodge(batchId, accountId, changes = {}) { return service.recordRegistryBatchLodgement(f.db, author, { batchId, accountId, providerReference: "ACTUAL-BATCH-42", submittedAt: NOW, ...changes }, f.options); },
  };
}

test("provider export retains private immutable handover and never marks a job Submitted", async t => {
  const f = batchFixture(t); await f.setup(["one", "two"]);
  const initial = await f.service.loadRegistryBatchWorkspace(f.db, author, f.options);
  assert.equal(initial.readyGroups.length, 1); assert.equal(initial.readyGroups[0].kind, "provider_handover");
  const batch = await f.export();
  assert.equal(batch.packetCount, 2); assert.equal(batch.submittedCount, 0);
  assert.deepEqual(batch.items.map(item => item.status), ["prepared", "prepared"]);
  assert.equal(f.sqlite.prepare("SELECT count(*) n FROM compliance_output_action_events").get().n, 0);
  const response = await f.service.downloadRegistryBatch(f.db, author, batch.id, f.options);
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  const files = fflate.unzipSync(new Uint8Array(await response.arrayBuffer()));
  assert.match(fflate.strFromU8(files["README.txt"]), /not government upload formats/);
  assert.equal(Object.keys(files).filter(key => key.endsWith(".csv")).length, 0);
  assert.equal((await f.service.loadRegistryBatchWorkspace(f.db, author, f.options)).readyGroups.length, 0);
  assert.equal((await f.export()).id, batch.id);
  assert.equal(f.auditCount("registry_batch_exported"), 1);
  await assert.rejects(f.export("request-one", { scheme: "veu" }), { code: "REGISTRY_BATCH_REQUEST_CONFLICT" });
});

test("NSW export includes only exact independently approved complete files", async t => {
  const f = batchFixture(t), setup = await f.setup(["one", "two"], "nsw_esc");
  const blocked = await f.service.loadRegistryBatchWorkspace(f.db, author, f.options);
  assert.equal(blocked.readyGroups.length, 0); assert.equal(blocked.blockedClaims.length, 2);
  const file = await f.official(setup.accountId, setup.packets);
  await assert.rejects(f.export("split", { expectedPacketIds: ["one"] }), { code: "REGISTRY_BATCH_CHANGED" });
  const batch = await f.export(); assert.equal(batch.groups[0].exportId, file.id); assert.equal(batch.groups[0].baseVintage, "2026");
  const files = fflate.unzipSync(new Uint8Array(await (await f.service.downloadRegistryBatch(f.db, author, batch.id, f.options)).arrayBuffer()));
  assert.equal(fflate.strFromU8(files["001-nsw_esc/nsw_esc-2026.csv"]), file.csv);
});

test("tenant, operator permission and retained archive integrity are enforced", async t => {
  const f = batchFixture(t); await f.setup();
  await assert.rejects(f.service.exportReadyRegistryBatch(f.db, auditor, { requestId: "denied" }, f.options), { code: "REGISTRY_PERMISSION_DENIED" });
  const batch = await f.export();
  await assert.rejects(f.service.downloadRegistryBatch(f.db, { ...author, organisationId: "org-two" }, batch.id, f.options), { code: "REGISTRY_BATCH_NOT_FOUND" });
  const evidence = f.sqlite.prepare("SELECT e.object_key FROM creditex_registry_batches b JOIN creditex_registry_evidence e ON e.id=b.evidence_id WHERE b.id=?").get(batch.id);
  f.records.get(evidence.object_key).bytes = new Uint8Array([1, 2, 3]).buffer;
  await assert.rejects(f.service.downloadRegistryBatch(f.db, author, batch.id, f.options), { code: "REGISTRY_EVIDENCE_INTEGRITY" });
});

test("inactive, cancelled, revoked and already dispatched claims are excluded", async t => {
  for (const reason of ["cancelled", "archived", "revoked", "dispatch", "account"]) {
    const f = batchFixture(t); const { accountId } = await f.setup();
    if (reason === "cancelled") f.sqlite.exec("UPDATE trade_work_orders SET stage='cancelled'");
    if (reason === "archived") f.sqlite.exec("UPDATE trade_work_orders SET record_status='archived'");
    if (reason === "revoked") f.revoke("packet-one");
    if (reason === "account") f.sqlite.prepare("UPDATE creditex_registry_accounts SET enabled=0 WHERE id=?").run(accountId);
    if (reason === "dispatch") f.sqlite.prepare(`INSERT INTO compliance_output_dispatch_intents(id,organisation_id,packet_id,packet_sha256,adapter_id,requested_by_uid,status,started_at)
      VALUES('intent','org-one','packet-one',?,'adapter','author','dispatching',?)`).run(HASH, NOW);
    const state = await f.service.loadRegistryBatchWorkspace(f.db, author, f.options);
    assert.equal(state.readyGroups.length, 0, reason); assert.equal(state.blockedClaims.length, 1, reason);
  }
});

test("a cancellation after ZIP persistence cannot pass the atomic export guard", async t => {
  const f = batchFixture(t); await f.setup();
  const put = f.options.bucket.put;
  f.options.bucket.put = async (...args) => { await put(...args); f.sqlite.exec("UPDATE trade_work_orders SET stage='cancelled'"); };
  await assert.rejects(f.export(), { code: "REGISTRY_BATCH_CHANGED" });
  assert.equal(f.sqlite.prepare("SELECT count(*) n FROM creditex_registry_batches").get().n, 0);
  assert.equal(f.sqlite.prepare("SELECT count(*) n FROM creditex_registry_batch_items").get().n, 0);
  assert.equal(f.auditCount("registry_batch_exported"), 0);
});

test("concurrent overlapping exports retain exactly one batch and duplicate request replays", async t => {
  const f = batchFixture(t); await f.setup();
  const outcome = await Promise.allSettled([f.export("one"), f.export("two")]);
  assert.equal(outcome.filter(item => item.status === "fulfilled").length, 1);
  assert.equal(outcome.filter(item => item.status === "rejected" && item.reason.code === "REGISTRY_BATCH_CHANGED").length, 1);
  assert.equal(f.sqlite.prepare("SELECT count(*) n FROM creditex_registry_batches").get().n, 1);
  assert.equal(f.auditCount("registry_batch_exported"), 1);
});

test("all references validate before writes; actual batch lodgement updates each claim once", async t => {
  const f = batchFixture(t), { accountId } = await f.setup(["one", "two"]), batch = await f.export();
  await assert.rejects(f.lodge(batch.id, accountId, { packetReferences: [{ packetId: "another-tenant-claim", providerReference: "REF" }] }), { code: "REGISTRY_BATCH_REFERENCE_SCOPE" });
  await assert.rejects(f.lodge(batch.id, accountId, { providerReference: "", packetReferences: [{ packetId: "one", providerReference: "REF" }] }), { code: "REGISTRY_BATCH_REFERENCE_REQUIRED" });
  assert.equal(f.sqlite.prepare("SELECT count(*) n FROM compliance_output_action_events").get().n, 0);
  const result = await f.lodge(batch.id, accountId, { packetReferences: [{ packetId: "one", providerReference: "INDIVIDUAL-ONE" }] });
  assert.equal(result.submittedCount, 2); assert.equal(result.failedCount, 0);
  assert.equal(f.sqlite.prepare("SELECT count(*) n FROM compliance_output_action_events WHERE to_status='submitted'").get().n, 2);
  const replay = await f.lodge(batch.id, accountId, { packetReferences: [{ packetId: "one", providerReference: "INDIVIDUAL-ONE" }] });
  assert.ok(replay.results.every(item => item.status === "already_submitted"));
  assert.equal(f.sqlite.prepare("SELECT count(*) n FROM compliance_output_action_events").get().n, 2);
  const current = await f.service.loadRegistryBatchWorkspace(f.db, author, f.options);
  assert.equal(current.batches[0].submittedCount, 2);
  const changed = await f.lodge(batch.id, accountId, { providerReference: "DIFFERENT" });
  assert.equal(changed.failedCount, 2); assert.equal(changed.submittedCount, 0);
});

test("partial lodgement reports failed claims truthfully and safely resumes only remaining claims", async t => {
  const f = batchFixture(t), { accountId } = await f.setup(["one", "two"]), batch = await f.export();
  f.revoke("two");
  const result = await f.lodge(batch.id, accountId);
  assert.equal(result.submittedCount, 1); assert.equal(result.failedCount, 1);
  assert.equal(result.results.find(item => item.packetId === "two").code, "OUTPUT_ACTION_EVIDENCE_CHANGED");
  assert.equal((await f.output.loadCreditexOutputAction(f.db, author.organisationId, "two")).status, "prepared");
  const again = await f.lodge(batch.id, accountId);
  assert.equal(again.results.find(item => item.packetId === "one").status, "already_submitted");
  assert.equal(f.sqlite.prepare("SELECT count(*) n FROM compliance_output_action_events").get().n, 1);
});

test("historical private download remains available after authority expiry and lodgement", async t => {
  const f = batchFixture(t), { accountId } = await f.setup(), batch = await f.export();
  await f.lodge(batch.id, accountId);
  f.sqlite.prepare("UPDATE creditex_registry_accounts SET enabled=0 WHERE id=?").run(accountId);
  assert.equal((await f.service.downloadRegistryBatch(f.db, author, batch.id, f.options)).status, 200);
});

test("concurrent exact export and lodgement retries retain one batch and one receipt per job", async t => {
  const f = batchFixture(t), { accountId } = await f.setup(["one", "two"]);
  const [left, right] = await Promise.all([f.export(), f.export()]);
  assert.equal(left.id, right.id);
  const outcomes = await Promise.all([f.lodge(left.id, accountId), f.lodge(left.id, accountId)]);
  assert.ok(outcomes.every(item => item.failedCount === 0 && item.submittedCount === 2));
  assert.equal(f.sqlite.prepare("SELECT count(*) n FROM compliance_output_action_adapter_receipts").get().n, 2);
  assert.equal(f.auditCount("registry_batch_exported"), 1);
});

test("lodgement resumes a failed claim after corrected readiness without repeating prior events", async t => {
  const f = batchFixture(t), { accountId } = await f.setup(["one", "two"]), batch = await f.export();
  f.revoke("two"); await f.lodge(batch.id, accountId); f.restore("two");
  const result = await f.lodge(batch.id, accountId);
  assert.equal(result.failedCount, 0); assert.equal(result.submittedCount, 2);
  assert.equal(result.results.find(item => item.packetId === "one").status, "already_submitted");
  assert.equal(result.results.find(item => item.packetId === "two").status, "submitted");
  assert.equal(f.sqlite.prepare("SELECT count(*) n FROM compliance_output_action_events").get().n, 2);
});

test("lodgement time and missing references reject the whole request before writes", async t => {
  const f = batchFixture(t), { accountId } = await f.setup(), batch = await f.export();
  await assert.rejects(f.lodge(batch.id, accountId, { submittedAt: "2026-09-23T23:59:59Z" }), { code: "REGISTRY_BATCH_DATE" });
  await assert.rejects(f.lodge(batch.id, accountId, { submittedAt: "2027-09-24T00:00:00Z" }), { code: "REGISTRY_BATCH_DATE" });
  await assert.rejects(f.lodge(batch.id, accountId, { providerReference: "" }), { code: "REGISTRY_BATCH_REFERENCE_REQUIRED" });
  assert.equal(f.sqlite.prepare("SELECT count(*) n FROM compliance_output_action_events").get().n, 0);
});

test("large lodgement batches expose remaining work and resume without duplicate receipts", async t => {
  const f = batchFixture(t), { accountId } = await f.setup(Array.from({ length: 101 }, (_, index) => `packet-${String(index).padStart(3, "0")}`)), batch = await f.export();
  const first = await f.lodge(batch.id, accountId);
  assert.equal(first.submittedCount, 20); assert.equal(first.remainingCount, 81); assert.equal(first.failedCount, 0);
  let next = first;
  while (next.remainingCount) next = await f.lodge(batch.id, accountId);
  assert.equal(next.submittedCount, 101); assert.equal(next.remainingCount, 0);
  assert.equal(f.sqlite.prepare("SELECT count(*) n FROM compliance_output_action_adapter_receipts").get().n, 101);
});

test("reopened partial batch lodges only pending jobs with its own receipt time and preserves earlier receipts", async t => {
  const ids = Array.from({ length: 21 }, (_, index) => `packet-${String(index).padStart(3, "0")}`);
  const f = batchFixture(t), { accountId } = await f.setup(ids), batch = await f.export();
  const first = await f.lodge(batch.id, accountId);
  assert.equal(first.submittedCount, 20);
  const retained = f.sqlite.prepare("SELECT * FROM compliance_output_action_adapter_receipts ORDER BY packet_id").all();
  const resumed = await f.lodge(batch.id, accountId, { packetIds: [ids[20]], providerReference: "LATER-RECEIPT", submittedAt: new Date(Date.parse(NOW) + 1000).toISOString() });
  assert.equal(resumed.submittedCount, 1); assert.equal(resumed.failedCount, 0); assert.equal(resumed.remainingCount, 0);
  assert.deepEqual(f.sqlite.prepare("SELECT * FROM compliance_output_action_adapter_receipts WHERE packet_id <> ? ORDER BY packet_id").all(ids[20]), retained);
  await assert.rejects(f.lodge(batch.id, accountId, { packetIds: ["another-account-packet"] }), { code: "REGISTRY_BATCH_REFERENCE_SCOPE" });
  assert.equal(f.sqlite.prepare("SELECT count(*) n FROM compliance_output_action_adapter_receipts").get().n, 21);
});

test("corrections and stale or absent business reviews exclude otherwise approved packets", async t => {
  for (const change of ["case", "evidence", "changed-completion", "missing-review", "later-correction"]) {
    const f = batchFixture(t); await f.setup();
    if (change === "case") f.sqlite.exec("UPDATE compliance_cases SET status='changes_requested'");
    if (change === "evidence") f.sqlite.exec("UPDATE compliance_cases SET evidence_status='changes_required'");
    if (change === "changed-completion") f.sqlite.exec("UPDATE compliance_activity_work_pack_instances SET revision=2");
    if (change === "missing-review") f.sqlite.exec("DELETE FROM creditex_job_lifecycle_events");
    if (change === "later-correction") f.sqlite.exec("INSERT INTO creditex_job_lifecycle_events SELECT organisation_id,work_order_id,owner_uid,intent_id,'correction_required','compliance',source_snapshot,'later','2026-09-23T00:00:00Z' FROM creditex_job_lifecycle_events");
    const workspace = await f.service.loadRegistryBatchWorkspace(f.db, author, f.options);
    assert.equal(workspace.readyGroups.length, 0, change);
    assert.equal(workspace.blockedClaims[0].code, "REGISTRY_BATCH_REVIEW_REQUIRED", change);
  }
});
