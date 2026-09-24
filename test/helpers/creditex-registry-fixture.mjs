import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import ts from "typescript";
import { creditexCanonicalSha256, creditexRawSha256 } from "../../src/lib/creditex-interchange-preflight.ts";
import * as registry from "../../src/lib/creditex-registry.ts";

const NOW = "2026-09-24T00:00:00.000Z";
const HASH = `sha256:${"a".repeat(64)}`;
const author = { actorKind: "compliance", actorUid: "author", organisationId: "org-one" };
const reviewer = { ...author, actorUid: "reviewer" };
const auditor = { ...author, actorUid: "auditor" };
const administrator = { ...author, actorKind: "admin", actorUid: "owner" };
const accountInput = { scheme: "veu", accountReference: "AP-001", submitterReference: "AP-001", legalName: "Synthetic Accredited Provider", financeEmail: "finance@example.test", resultsEmail: "results@example.test", activityScope: ["veu-test"], authorityReference: "AUTH-001", authorityExpiresOn: "2027-09-24" };

function loadService(packets) {
  const source = readFileSync(new URL("../../src/lib/creditex-registry-server.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const dependencies = {
    "./creditex-activity-work-pack-server": {
      async loadCreditexWorkPackGovernanceIdentity(_db, actor) {
        return { role: actor.actorUid === "owner" ? "owner" : actor.actorUid === "author" ? "admin" : actor.actorUid,
          access: { canRead: actor.actorUid !== "denied", canAuthor: ["owner", "author", "operator"].includes(actor.actorUid), canReview: ["owner", "author", "reviewer"].includes(actor.actorUid) } };
      },
    },
    "./creditex-output-action-server": {
      async loadCreditexOutputAction(_db, organisationId, id) {
        const packet = packets.get(`${organisationId}:${id}`);
        if (!packet) throw Object.assign(new Error("Output action not found"), { code: "OUTPUT_ACTION_NOT_FOUND" });
        return packet;
      },
      async listCreditexOutputActions(_db, actor) { return [...packets].filter(([key]) => key.startsWith(`${actor.organisationId}:`)).map(([, value]) => value); },
    },
    "./creditex-interchange-preflight": { creditexCanonicalSha256, creditexRawSha256 },
    "./creditex-custody-bucket": { getCreditexCustodyBucket() { throw new Error("Tests must inject their evidence bucket"); } },
    "./creditex-registry": registry,
  };
  const moduleRecord = { exports: {} };
  new Function("require", "module", "exports", compiled)((name) => {
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected unmocked dependency: ${name}`);
    return dependencies[name];
  }, moduleRecord, moduleRecord.exports);
  return moduleRecord.exports;
}

function fixture(t) {
  const sqlite = new DatabaseSync(":memory:");
  t.after(() => sqlite.close());
  sqlite.exec("PRAGMA foreign_keys=ON");
  // Use the real production audit CHECK, not a permissive synthetic table.
  const auditSchema = readFileSync(new URL("../../drizzle/0094_creditex_operations_control.sql", import.meta.url), "utf8")
    .match(/CREATE TABLE `compliance_audit_events`[^;]+;/)[0];
  sqlite.exec(auditSchema);
  sqlite.exec(readFileSync(new URL("../../drizzle/0189_creditex_registry_operations.sql", import.meta.url), "utf8"));
  class Statement {
    constructor(sql, values = []) { this.sql = sql; this.values = values; }
    bind(...values) { return new Statement(this.sql, values); }
    async first() { return sqlite.prepare(this.sql).get(...this.values) || null; }
    async all() { return { results: sqlite.prepare(this.sql).all(...this.values) }; }
    runSync() { return { meta: { changes: Number(sqlite.prepare(this.sql).run(...this.values).changes) } }; }
    async run() { return this.runSync(); }
  }
  let beforeBatch;
  const db = { prepare: (sql) => new Statement(sql), async batch(statements) {
    if (beforeBatch) { const callback = beforeBatch; beforeBatch = undefined; callback(statements); }
    sqlite.exec("BEGIN");
    try { const result = statements.map(statement => statement.runSync()); sqlite.exec("COMMIT"); return result; }
    catch (error) { sqlite.exec("ROLLBACK"); throw error; }
  } };
  const records = new Map();
  const bucket = {
    async put(key, bytes, metadata) { records.set(key, { bytes: bytes.slice(0), ...metadata }); },
    async get(key) { const record = records.get(key); return record ? { size: record.bytes.byteLength, arrayBuffer: async () => record.bytes.slice(0) } : null; },
    async delete(key) { records.delete(key); },
  };
  const packet = { id: "packet-one", packetSha256: HASH, programCode: "VEU", activityTemplateId: "veu-test", quantity: "10", unit: "VEEC", preparedAt: "2026-09-20T00:00:00.000Z", status: "submitted", providerReference: "REG-001", jobReference: "JOB-001", jobLabel: "Synthetic job", customerLabel: "Synthetic customer", activityTitle: "Synthetic activity", review: { decision: "approved" }, capabilities: { canSubmit: false } };
  const packets = new Map([["org-one:packet-one", packet]]);
  const service = loadService(packets);
  const options = { bucket, now: () => NOW };
  return { sqlite, db, service, packet, packets, records, options,
    intercept(callback) { beforeBatch = callback; },
    async account(actor = author, input = {}) { return service.saveRegistryAccount(db, actor, { ...accountInput, ...input }, options); },
    async evidence(actor = author, content = "Synthetic registry receipt") { return service.storeRegistryEvidence(db, actor, new File([content], "receipt.txt"), options); },
    auditCount(event) { return sqlite.prepare("SELECT count(*) n FROM compliance_audit_events WHERE event_type=?").get(event).n; },
    async ready() {
      const accountId = await this.account();
      await service.attachRegistryAccount(db, author, { accountId, packetId: packet.id, expectedPacketSha256: HASH }, options);
      const evidenceId = await this.evidence();
      return { accountId, evidenceId };
    },
    async invoice(amount = "100.00") {
      const setup = await this.ready();
      const input = { ...setup, reference: "INV-001", amount, dueDate: "2026-10-01", packetIds: [packet.id] };
      return { ...setup, input, invoiceId: await service.recordRegistryInvoice(db, author, input, options) };
    },
  };
}


export { fixture, NOW, HASH, author, reviewer, auditor, administrator, accountInput };
