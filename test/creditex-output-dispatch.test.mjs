import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import ts from "typescript";
import { creditexCanonicalSha256 } from "../src/lib/creditex-interchange-preflight.ts";
import { CREDITEX_WORK_PACK_SCHEMA_GUARD_DEFINITIONS } from "../src/lib/creditex-work-pack-schema-guards.ts";

const NOW = "2026-09-24T00:00:00.000Z";
const HASH = `sha256:${"a".repeat(64)}`;
const actor = { actorUid: "submitter", organisationId: "org-one", actorKind: "compliance" };

// Only the existing identity/readiness service boundaries are mocked. The
// dispatch service, migration, atomic reservations and transactions run in SQLite.
function loadService() {
  const source = readFileSync(new URL("../src/lib/creditex-output-action-server.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const dependencies = {
    "./australian-government-program-catalogue": { GOVERNMENT_PROGRAM_TEMPLATES: [] },
    "./creditex-activity-work-pack-server": {
      async loadCreditexWorkPackGovernanceIdentity(_db, identity) {
        if (identity.actorUid !== "submitter") throw new Error("UNAUTHORISED");
        return { role: "admin", access: { canAuthor: true, canReview: true } };
      },
    },
    "./creditex-interchange-preflight": { creditexCanonicalSha256 },
    "./creditex-work-pack-schema-guards": { async ensureCreditexWorkPackSchemaGuards() {} },
  };
  const moduleRecord = { exports: {} };
  new Function("require", "module", "exports", compiled)((name) => {
    assert.ok(Object.hasOwn(dependencies, name), name);
    return dependencies[name];
  }, moduleRecord, moduleRecord.exports);
  return moduleRecord.exports;
}
const service = loadService();

function fixture(t) {
  const sqlite = new DatabaseSync(":memory:");
  t.after(() => sqlite.close());
  sqlite.exec(`
    CREATE TABLE compliance_output_action_packets (
      id TEXT PRIMARY KEY, organisation_id TEXT, packet_sha256 TEXT, packet_snapshot TEXT,
      action_kind TEXT, output_class TEXT, output_code TEXT, program_code TEXT,
      activity_template_id TEXT, activity_version_id TEXT, compliance_case_id TEXT,
      work_pack_instance_id TEXT, work_pack_final_record_id TEXT, quantity_text TEXT,
      unit TEXT, idempotency_key TEXT, prepared_by_uid TEXT, prepared_actor_kind TEXT, prepared_at TEXT);
    CREATE TABLE compliance_output_action_reviews (
      organisation_id TEXT, packet_id TEXT, packet_sha256 TEXT, decision TEXT,
      reviewed_by_uid TEXT, reviewed_actor_kind TEXT, review_note TEXT, reviewed_at TEXT);
    CREATE TABLE compliance_output_action_events (
      id TEXT PRIMARY KEY, organisation_id TEXT, packet_id TEXT, sequence INTEGER,
      from_status TEXT, to_status TEXT, actor_kind TEXT, actor_uid TEXT,
      adapter_receipt_id TEXT, summary TEXT, metadata TEXT, occurred_at TEXT, created_at TEXT,
      UNIQUE(organisation_id, packet_id, sequence));
    CREATE TABLE compliance_output_action_adapter_receipts (
      id TEXT PRIMARY KEY, organisation_id TEXT, packet_id TEXT, adapter_id TEXT,
      provider_name TEXT, request_snapshot TEXT, request_sha256 TEXT,
      response_snapshot TEXT, response_sha256 TEXT, provider_reference TEXT,
      provider_status TEXT, http_status INTEGER, response_received_at TEXT, created_at TEXT);
    CREATE TABLE compliance_activity_work_pack_instances (id TEXT, organisation_id TEXT, work_order_id TEXT);
    CREATE TABLE compliance_cases (id TEXT, organisation_id TEXT, case_number TEXT, installer_uid TEXT);
    CREATE TABLE compliance_activity_versions (id TEXT, title TEXT);
    CREATE TABLE trade_work_orders (id TEXT, firebase_uid TEXT, work_number TEXT, title TEXT);
    CREATE TABLE trade_crm_job_details (work_order_id TEXT, firebase_uid TEXT, customer_source TEXT, crm_customer_id TEXT);
    CREATE TABLE trade_crm_customers (id TEXT, firebase_uid TEXT, record_status TEXT, business_name TEXT, first_name TEXT, last_name TEXT);
  `);
  sqlite.exec(readFileSync(new URL("../drizzle/0188_creditex_output_dispatch_intents.sql", import.meta.url), "utf8"));
  for (const definition of CREDITEX_WORK_PACK_SCHEMA_GUARD_DEFINITIONS.filter(item => item.name.startsWith("compliance_output_dispatch_"))) {
    sqlite.exec(definition.sql);
  }
  const evidence = {
    activityVersion: { id: "version-one" }, workPackVersion: { id: "pack-one", schemaSha256: HASH },
    manualPolicy: {}, evidencePolicy: {}, productRegistrySnapshot: { snapshotId: "products-one" },
    scenarioRules: { ruleId: "rule-one" },
    sourceBindings: [{ id: "source-one", role: "requirement", targetKey: "certificate",
      artifactId: "artifact-one", artifactSha256: "a".repeat(64),
      createdByUid: "author", reviewedByUid: "reviewer", reviewedAt: NOW }],
    fieldCollection: { instanceId: "instance-one", revision: 1 },
    completion: { caseInstanceId: "instance-one", instanceSha256: HASH,
      responseSha256: HASH, finalRecordId: "final-one", pdfSha256: HASH },
    authoritativeCalculator: { runId: "run-one", inputSha256: HASH, outputSha256: HASH,
      receiptSha256: HASH, specificationId: "calculator-one", certificateQuantity: "10", certificateUnit: "VEEC" },
    programActivationEvidence: null,
  };
  const coverage = { activityTemplateId: "veu-test", programCode: "VEU", outputClass: "tradable_certificate",
    certificateActionEnabled: true, certificateBlockers: [], activationEvidence: evidence };
  const packet = {
    activityVersionId: "version-one",
    workPack: { instanceId: "instance-one", revision: 1, versionId: "pack-one", definitionSha256: HASH,
      instanceSha256: HASH, responseSha256: HASH, finalRecordId: "final-one", finalPdfSha256: "a".repeat(64) },
    sourceManifest: { contract: "creditex-output-action-source-manifest/v1", sources: evidence.sourceBindings.map((binding) => ({
      bindingId: binding.id, role: binding.role, targetKey: binding.targetKey, artifactId: binding.artifactId,
      artifactSha256: binding.artifactSha256, createdByUid: binding.createdByUid,
      reviewedByUid: binding.reviewedByUid, reviewedAt: binding.reviewedAt,
    })) },
    productEvidence: { contract: "creditex-output-action-product-evidence/v1", ...evidence.productRegistrySnapshot },
    scenarioEvidence: { contract: "creditex-output-action-scenario-evidence/v1", ...evidence.scenarioRules },
    calculation: { ...evidence.authoritativeCalculator, calculatorVersionId: "calculator-one", quantity: "10", unit: "VEEC" },
    programActivationEvidence: null,
  };
  const packetHash = creditexCanonicalSha256(packet);
  sqlite.prepare(`INSERT INTO compliance_output_action_packets VALUES
    ('packet-one', 'org-one', ?, ?, 'certificate_submission', 'tradable_certificate', 'VEEC', 'VEU',
      'veu-test', 'version-one', 'case-one', 'instance-one', 'final-one', '10', 'VEEC',
      'prepare-one', 'author', 'compliance', ?)`).run(packetHash, JSON.stringify(packet), NOW);
  sqlite.prepare(`INSERT INTO compliance_output_action_reviews VALUES
    ('org-one', 'packet-one', ?, 'approved', 'reviewer', 'compliance', '', ?)`).run(packetHash, NOW);
  sqlite.prepare(`INSERT INTO compliance_output_action_events VALUES
    ('prepared-one', 'org-one', 'packet-one', 1, '', 'prepared', 'compliance', 'author', '', '', '{}', ?, ?)`).run(NOW, NOW);
  class Statement {
    constructor(sql, bindings = []) { this.sql = sql; this.bindings = bindings; }
    bind(...values) { return new Statement(this.sql, values); }
    async first() { return sqlite.prepare(this.sql).get(...this.bindings) || null; }
    async all() { return { results: sqlite.prepare(this.sql).all(...this.bindings) }; }
    runSync() { return { meta: { changes: Number(sqlite.prepare(this.sql).run(...this.bindings).changes) } }; }
    async run() { return this.runSync(); }
  }
  const database = {
    prepare: (sql) => new Statement(sql),
    async batch(statements) {
      sqlite.exec("BEGIN");
      try { const result = statements.map((statement) => statement.runSync()); sqlite.exec("COMMIT"); return result; }
      catch (error) { sqlite.exec("ROLLBACK"); throw error; }
    },
  };
  const input = { packetId: "packet-one", expectedPacketSha256: packetHash };
  const options = { now: () => NOW, resolveCoverage: async () => [coverage] };
  return { sqlite, database, input, options, coverage,
    intent: () => sqlite.prepare("SELECT * FROM compliance_output_dispatch_intents").get(),
    send: (adapter, overrides = {}) => service.submitCreditexOutputAction(database, actor, input, adapter, { ...options, ...overrides }),
  };
}

function accepted() {
  return { providerName: "Synthetic registry", providerReference: "external-one", providerStatus: "provider_accepted",
    httpStatus: 200, responseReceivedAt: NOW, requestSnapshot: { request: "one" }, responseSnapshot: { reference: "external-one" } };
}

test("dispatch migration is Sites-compatible and all five guards are installed at runtime", () => {
  const migration = readFileSync(new URL("../drizzle/0188_creditex_output_dispatch_intents.sql", import.meta.url), "utf8");
  assert.doesNotMatch(migration, /\bCREATE\s+TRIGGER\b/i);
  assert.match(migration, /creditex-work-pack-schema-guards\.ts/);
  assert.equal(CREDITEX_WORK_PACK_SCHEMA_GUARD_DEFINITIONS.filter(item => item.name.startsWith("compliance_output_dispatch_")).length, 5);
});

test("concurrent duplicate clicks reserve one provider call and complete receipts atomically", async (t) => {
  const f = fixture(t);
  let calls = 0;
  let release;
  const barrier = new Promise((resolve) => { release = resolve; });
  const adapter = { id: "synthetic-adapter", async submit(_packet, context) {
    calls++;
    assert.equal(f.intent().status, "dispatching");
    assert.equal(context.idempotencyKey, f.intent().id);
    await barrier;
    return accepted();
  } };
  const first = f.send(adapter);
  const second = f.send(adapter);
  await assert.rejects(second, { code: "OUTPUT_ACTION_DISPATCH_ALREADY_RESERVED" });
  release();
  const result = await first;
  assert.equal(calls, 1);
  assert.equal(result.action.status, "provider_accepted");
  assert.equal(f.intent().status, "completed");
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM compliance_output_action_adapter_receipts WHERE provider_status = 'provider_accepted'").get().n, 1);
  await assert.rejects(f.send(adapter), { code: "OUTPUT_ACTION_APPROVAL_REQUIRED" });
  assert.equal(calls, 1);
});

test("accepted-then-timeout is uncertain and cannot be resent or manually submitted", async (t) => {
  const f = fixture(t);
  let calls = 0;
  let signal;
  await assert.rejects(f.send({ id: "synthetic-adapter", async submit(_packet, context) {
    calls++; signal = context.signal;
    return new Promise(() => {}); // Provider may have accepted; its response never arrives.
  } }, { dispatchTimeoutMs: 5 }), { code: "OUTPUT_ACTION_DISPATCH_UNCERTAIN" });
  assert.equal(signal.aborted, true);
  assert.equal(f.intent().status, "uncertain");
  assert.equal(f.intent().failure_code, "OUTPUT_ACTION_DISPATCH_TIMEOUT");
  await assert.rejects(f.send({ id: "different-adapter", async submit() { calls++; return accepted(); } }), { code: "OUTPUT_ACTION_DISPATCH_ALREADY_RESERVED" });
  await assert.rejects(service.recordManualCreditexOutputSubmission(f.database, actor, {
    ...f.input, providerName: "Synthetic registry", providerReference: "external-one", submittedAt: NOW, submissionMethod: "manual",
  }, f.options), { code: "OUTPUT_ACTION_DISPATCH_ALREADY_RESERVED" });
  assert.equal(calls, 1);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM compliance_output_action_adapter_receipts").get().n, 0);
});

test("invalid response and transport exception retain uncertainty without success events", async (t) => {
  for (const submit of [async () => ({ ...accepted(), providerReference: "" }), async () => { throw new Error("network lost"); }]) {
    const f = fixture(t);
    await assert.rejects(f.send({ id: "synthetic-adapter", submit }), { code: "OUTPUT_ACTION_DISPATCH_UNCERTAIN" });
    assert.equal(f.intent().status, "uncertain");
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM compliance_output_action_events").get().n, 1);
  }
});

test("receipt persistence failure rolls back events and retains a non-retryable attempt", async (t) => {
  const f = fixture(t);
  f.sqlite.exec(`CREATE TRIGGER synthetic_receipt_failure BEFORE INSERT ON compliance_output_action_adapter_receipts
    WHEN NEW.provider_status = 'provider_accepted' BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END;`);
  await assert.rejects(f.send({ id: "synthetic-adapter", submit: async () => accepted() }), { code: "OUTPUT_ACTION_DISPATCH_UNCERTAIN" });
  assert.equal(f.intent().status, "uncertain");
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM compliance_output_action_adapter_receipts").get().n, 0);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM compliance_output_action_events").get().n, 1);
});

test("tenant isolation, incorrect packet hash and withdrawn readiness fail before any reservation", async (t) => {
  const f = fixture(t);
  const adapter = { id: "synthetic-adapter", async submit() { assert.fail("must not send"); } };
  await assert.rejects(service.submitCreditexOutputAction(f.database, { ...actor, organisationId: "org-other" }, f.input, adapter, f.options), { code: "OUTPUT_ACTION_NOT_FOUND" });
  await assert.rejects(service.loadCreditexOutputDispatchIntent(f.database, { ...actor, organisationId: "org-other" }, "packet-one"), { code: "OUTPUT_ACTION_NOT_FOUND" });
  await assert.rejects(service.submitCreditexOutputAction(f.database, actor, { ...f.input, expectedPacketSha256: HASH }, adapter, f.options), { code: "OUTPUT_ACTION_PACKET_CHANGED" });
  f.coverage.certificateActionEnabled = false;
  await assert.rejects(f.send(adapter), { code: "OUTPUT_ACTION_CERTIFICATE_NOT_READY" });
  assert.equal(f.intent(), undefined);
});

test("changed current evidence cannot reuse an older approved packet", async (t) => {
  const f = fixture(t);
  f.coverage.activationEvidence.sourceBindings[0].reviewedByUid = "different-reviewer";
  await assert.rejects(f.send({ id: "synthetic-adapter", async submit() { assert.fail("must not send"); } }), { code: "OUTPUT_ACTION_EVIDENCE_CHANGED" });
  assert.equal(f.intent(), undefined);
});

test("evidence withdrawn during reservation prevents the provider call", async (t) => {
  const f = fixture(t);
  let checks = 0;
  await assert.rejects(f.send({ id: "synthetic-adapter", async submit() { assert.fail("must not send"); } }, {
    resolveCoverage: async () => {
      if (++checks === 2) f.coverage.certificateActionEnabled = false;
      return [f.coverage];
    },
  }), { code: "OUTPUT_ACTION_DISPATCH_UNCERTAIN" });
  assert.equal(f.intent().status, "uncertain");
  assert.equal(f.intent().failure_code, "OUTPUT_ACTION_CERTIFICATE_NOT_READY");
});

test("database guards reject intent mutation and manual bypass even outside the service", async (t) => {
  const f = fixture(t);
  await assert.rejects(f.send({ id: "synthetic-adapter", async submit() { throw new Error("unknown"); } }), { code: "OUTPUT_ACTION_DISPATCH_UNCERTAIN" });
  assert.throws(() => f.sqlite.exec("DELETE FROM compliance_output_dispatch_intents"), /DELETE_BLOCKED/);
  assert.throws(() => f.sqlite.exec("UPDATE compliance_output_dispatch_intents SET status = 'dispatching', finished_at = '', failure_code = ''"), /IMMUTABLE/);
  assert.throws(() => f.sqlite.prepare(`INSERT INTO compliance_output_action_adapter_receipts
    (id, organisation_id, packet_id, adapter_id, provider_status) VALUES ('manual-one', 'org-one', 'packet-one', 'manual-provider-record/v1', 'submitted')`).run(), /ALREADY_RESERVED/);
  assert.throws(() => f.sqlite.prepare(`INSERT INTO compliance_output_action_events
    (id, organisation_id, packet_id, sequence, to_status, actor_kind) VALUES ('manual-event', 'org-one', 'packet-one', 2, 'submitted', 'compliance')`).run(), /ALREADY_RESERVED/);
});

test("an existing manual submission prevents an automatic reservation", async (t) => {
  const f = fixture(t);
  await service.recordManualCreditexOutputSubmission(f.database, actor, { ...f.input,
    providerName: "Synthetic registry", providerReference: "manual-one", submittedAt: NOW, submissionMethod: "manual",
  }, f.options);
  await assert.rejects(f.send({ id: "synthetic-adapter", async submit() { assert.fail("must not send"); } }), { code: "OUTPUT_ACTION_APPROVAL_REQUIRED" });
  assert.throws(() => f.sqlite.prepare(`INSERT INTO compliance_output_dispatch_intents
    (id, organisation_id, packet_id, packet_sha256, adapter_id, requested_by_uid, status, started_at)
    VALUES ('bypass', 'org-one', 'packet-one', ?, 'synthetic-adapter', 'submitter', 'dispatching', ?)`).run(f.input.expectedPacketSha256, NOW), /NOT_READY/);
});
