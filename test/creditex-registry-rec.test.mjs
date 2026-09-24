import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import ts from "typescript";
import { creditexRawSha256 } from "../src/lib/creditex-interchange-preflight.ts";
import { registrySchemeForProgram } from "../src/lib/creditex-registry.ts";

const NOW = "2026-09-24T00:00:00.000Z";
const SOURCE_DATE = "2026-09-22";
const COMPLETED = "2026-09-22T03:00:00.000Z";
const actor = { organisationId: "org-one", actorUid: "operator", actorKind: "compliance" };
class CreditexRegistryError extends Error {
  constructor(code, status, message) { super(message); this.code = code; this.status = status; }
}

function fixture(t) {
  const sqlite = new DatabaseSync(":memory:");
  t.after(() => sqlite.close());
  sqlite.exec(readFileSync(new URL("../drizzle/0189_creditex_registry_operations.sql", import.meta.url), "utf8"));
  sqlite.prepare(`INSERT INTO creditex_registry_accounts (id,organisation_id,scheme,account_reference,legal_name,finance_email,results_email,activity_scope,authority_reference,created_by_uid,created_at,updated_at)
    VALUES ('account-one','org-one','stc','123','Test Provider','finance@example.test','results@example.test','["sres-test"]','authority','operator',?,?)`).run(NOW, NOW);
  const hash = `sha256:${"a".repeat(64)}`;
  sqlite.prepare(`INSERT INTO creditex_registry_claim_accounts VALUES ('org-one','packet-one','account-one',?,'operator',?)`).run(hash, NOW);
  const state = {
    account: { id: "account-one", version: 1, scheme: "stc", accountReference: "123", enabled: true },
    claims: new Map([["packet-one", { id: "packet-one", programCode: "SRES", status: "submitted", providerReference: "SGU-EXACT", quantity: "10", preparedAt: "2026-09-01T00:00:00Z", packetSha256: hash }]]),
    evidence: [], results: [], canOperate: true, fetchCalls: [],
  };
  class Statement {
    constructor(sql, values = []) { this.sql = sql; this.values = values; }
    bind(...values) { return new Statement(this.sql, values); }
    async all() { return { results: sqlite.prepare(this.sql).all(...this.values) }; }
    async first() { return sqlite.prepare(this.sql).get(...this.values) || null; }
    async run() { return { meta: { changes: Number(sqlite.prepare(this.sql).run(...this.values).changes) } }; }
  }
  const db = { prepare: sql => new Statement(sql) };
  const compiled = ts.transpileModule(readFileSync(new URL("../src/lib/creditex-registry-rec.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const dependencies = {
    "./creditex-interchange-preflight": { creditexRawSha256 },
    "./creditex-registry": { registrySchemeForProgram },
    "./creditex-registry-server": {
      CreditexRegistryError,
      async registryCapabilities() { return { canOperate: state.canOperate }; },
      async requireRegistryAccount(_db, identity, id) {
        if (identity.organisationId !== actor.organisationId || id !== state.account.id) throw new CreditexRegistryError("REGISTRY_ACCOUNT_NOT_FOUND", 404, "Missing account");
        return { ...state.account };
      },
      async requireRegistryClaimBinding(_db, identity, id, accountId) {
        const binding = sqlite.prepare("SELECT * FROM creditex_registry_claim_accounts WHERE organisation_id=? AND packet_id=? AND account_id=?").get(identity.organisationId, id, accountId);
        const claim = state.claims.get(id);
        if (!binding || !claim || binding.packet_sha256 !== claim.packetSha256) throw new CreditexRegistryError("REGISTRY_PACKET_CHANGED", 409, "Changed binding");
        return { ...claim };
      },
      async persistRegistryEvidence(_db, identity, input) {
        state.evidence.push(JSON.parse(new TextDecoder().decode(input.bytes)));
        const id = `evidence-${state.evidence.length}`;
        sqlite.prepare("INSERT INTO creditex_registry_evidence VALUES (?,?,?,?,?,?,?,?,?)")
          .run(id, identity.organisationId, `object-${id}`, input.filename, input.mime, input.bytes.byteLength, creditexRawSha256(new Uint8Array(input.bytes)), identity.actorUid, NOW);
        return id;
      },
      async insertRegistryResult(_db, _actor, input) {
        if (state.failResult) throw new Error("Result persistence failed");
        state.results.push(input); return `result-${state.results.length}`;
      },
    },
  };
  const moduleRecord = { exports: {} };
  new Function("require", "module", "exports", compiled)(name => { assert.ok(Object.hasOwn(dependencies, name), name); return dependencies[name]; }, moduleRecord, moduleRecord.exports);
  const source = entries => ({ status: "Success", result: entries });
  const sync = async (entries = [action()], override = {}) => moduleRecord.exports.syncRecRegistry(db, actor, { accountId: state.account.id, date: SOURCE_DATE }, {
    now: () => NOW,
    fetchImpl: async (...args) => { state.fetchCalls.push(args); return Response.json(source(entries)); },
    ...override,
  });
  return { ...moduleRecord.exports, db, sqlite, state, sync };
}

function range(overrides = {}) {
  return { certificateType: "STC", registeredPersonNumber: 44, accreditationCode: "SGU-EXACT", generationYear: 2026,
    generationState: "NSW", startSerialNumber: 1, endSerialNumber: 10, fuelSource: "S.G.U. - solar (deemed)",
    ownerAccount: "Synthetic provider", ownerAccountId: 123, status: "Registered", generationMonth: null, creationDate: "2026-09-21", ...overrides };
}
function action(overrides = {}) { return { actionType: "STC registered", completedTime: COMPLETED, certificateRanges: [range()], ...overrides }; }

test("complete exact STC issuance matches account, installation, quantity and retains only matched source ranges", async t => {
  const f = fixture(t);
  const summary = await f.sync([action({ certificateRanges: [range({ startSerialNumber: 1, endSerialNumber: 4 }), range({ startSerialNumber: 5, endSerialNumber: 10 }), range({ ownerAccountId: 999, ownerAccount: "Other owner" })] })]);
  assert.deepEqual(summary, { sourceDate: SOURCE_DATE, checkedAt: NOW, matchedClaims: 1, updatedClaims: 1, unresolvedClaims: 0, matches: [{ packetId: "packet-one", evidenceId: "evidence-1", confirmed: true }] });
  assert.equal(f.state.results[0].registryStatus, "registered");
  assert.equal(f.state.results[0].source, "rec_public_register");
  assert.equal(f.state.results[0].quantity, "10");
  assert.match(f.state.evidence[0].fullResponseSha256, /^sha256:[a-f0-9]{64}$/);
  assert.equal(f.state.evidence[0].actions[0].certificateRanges.length, 2);
  assert.equal(JSON.stringify(f.state.evidence).includes("Other owner"), false);
  assert.equal(f.state.fetchCalls[0][0], `https://rec-registry.gov.au/rec-registry/app/api/public-register/certificate-actions?date=${SOURCE_DATE}`);
  assert.equal(f.state.fetchCalls[0][1].redirect, "error");
  assert.equal(f.state.fetchCalls[0][1].method, "GET");
  assert.equal(f.sqlite.prepare("SELECT completed_at FROM creditex_registry_sync_runs").get().completed_at, NOW);
});

test("fee-pending and audit failure are distinct from registered certificates", async t => {
  for (const [actionType, status, expected] of [["STC created", "Pending audit", "assessment"], ["STC audit passed", "Pending creation fee payment", "assessment"], ["STC audit failed", "Invalid due to audit", "rejected"], ["STC audit passed", "Registered", "registered"]]) {
    const f = fixture(t);
    await f.sync([action({ actionType, certificateRanges: [range({ status })] })]);
    assert.equal(f.state.results[0].registryStatus, expected);
  }
});

test("partial, overlapping, mixed generation, mixed status and unknown events remain unresolved", async t => {
  const samples = [
    [action({ certificateRanges: [range({ endSerialNumber: 9 })] })],
    [action({ certificateRanges: [range({ endSerialNumber: 5 }), range({ startSerialNumber: 5, endSerialNumber: 9 })] })],
    [action({ certificateRanges: [range({ endSerialNumber: 5 }), range({ startSerialNumber: 6, generationYear: 2025 })] })],
    [action({ certificateRanges: [range({ endSerialNumber: 5 }), range({ startSerialNumber: 6, status: "Pending creation fee payment" })] })],
    [action({ actionType: "Transfer accept" })],
  ];
  for (const entries of samples) {
    const f = fixture(t);
    assert.equal((await f.sync(entries)).unresolvedClaims, 1);
    assert.equal(f.state.results.length, 0);
    assert.equal(f.state.evidence[0].outcome, "unresolved_requires_review");
  }
});

test("newest complete issuance event takes precedence over earlier assessment", async t => {
  const f = fixture(t);
  await f.sync([action({ actionType: "STC created", completedTime: "2026-09-22T01:00:00Z", certificateRanges: [range({ status: "Pending audit" })] }), action()]);
  assert.equal(f.state.results[0].registryStatus, "registered");
  assert.equal(f.state.results[0].occurredAt, COMPLETED);
});

test("account, accreditation and certificate type mismatches never match a claim", async t => {
  const f = fixture(t);
  const summary = await f.sync([action({ certificateRanges: [range({ ownerAccountId: 456 }), range({ accreditationCode: "SGU-DIFFERENT" }), range({ certificateType: "LGC" })] })]);
  assert.equal(summary.matchedClaims, 0);
  assert.equal(f.state.results.length, 0);
  assert.equal(f.state.evidence.length, 0);
});

test("duplicate submitted references and events older than preparation never auto confirm", async t => {
  const first = fixture(t);
  const claim = first.state.claims.get("packet-one");
  first.state.claims.set("packet-two", { ...claim, id: "packet-two" });
  first.sqlite.prepare("INSERT INTO creditex_registry_claim_accounts VALUES ('org-one','packet-two','account-one',?,'operator',?)").run(claim.packetSha256, NOW);
  assert.equal((await first.sync()).unresolvedClaims, 2);
  assert.equal(first.state.results.length, 0);
  const second = fixture(t);
  second.state.claims.get("packet-one").preparedAt = "2026-09-23T00:00:00Z";
  assert.equal((await second.sync()).unresolvedClaims, 1);
  assert.equal(second.state.results.length, 0);
});

test("REC documented ownerAccountID string is accepted, unsafe or conflicting numeric identity is rejected", async t => {
  const f = fixture(t), documented = range({ ownerAccountID: "123" });
  delete documented.ownerAccountId;
  assert.equal((await f.sync([action({ certificateRanges: [documented] })])).updatedClaims, 1);
  for (const overrides of [{ ownerAccountId: 9007199254740992 }, { ownerAccountID: "456" }]) {
    const invalid = fixture(t);
    await assert.rejects(invalid.sync([action({ certificateRanges: [range(overrides)] })]), { code: "REC_SOURCE_INVALID" });
    assert.equal(invalid.state.results.length, 0);
  }
});

test("source dates use Australia/Sydney completed days and reject invalid calendar dates", async t => {
  const f = fixture(t);
  assert.equal(f.validateRecSourceDate("2026-09-23", "2026-09-23T15:00:00Z"), "2026-09-23");
  for (const date of ["2026-09-24", "2026-02-30", "2026-9-22", "2026-09-25"]) {
    assert.throws(() => f.validateRecSourceDate(date, NOW), { code: "REC_SOURCE_DATE_INVALID" });
  }
});

test("permission, tenant and unsupported scheme gates run before fetching", async t => {
  const f = fixture(t);
  f.state.canOperate = false;
  await assert.rejects(f.sync(), { code: "REGISTRY_PERMISSION_DENIED" });
  f.state.canOperate = true;
  f.state.account.scheme = "lgc";
  await assert.rejects(f.sync(), { code: "REC_SCHEME_UNSUPPORTED" });
  await assert.rejects(f.syncRecRegistry(f.db, { ...actor, organisationId: "org-two" }, { accountId: "account-one", date: SOURCE_DATE }), { code: "REGISTRY_ACCOUNT_NOT_FOUND" });
  assert.equal(f.state.fetchCalls.length, 0);
});

test("durable reservation blocks duplicate simultaneous checks", async t => {
  const f = fixture(t);
  let release, count = 0;
  const pending = new Promise(resolve => { release = resolve; });
  const first = f.sync(undefined, { fetchImpl: async () => { count++; await pending; return Response.json({ status: "Success", result: [action()] }); } });
  await assert.rejects(f.sync(), { code: "REC_SYNC_RECENT" });
  release();
  await first;
  assert.equal(count, 1);
  assert.equal(f.state.results.length, 1);
});

test("failed network, oversized and malformed responses preserve results and leave check incomplete", async t => {
  for (const fetchImpl of [
    async () => { throw new Error("Network unavailable"); },
    async () => new Response("{}", { status: 503 }),
    async () => new Response("{}", { headers: { "content-length": String(33 * 1024 * 1024) } }),
    async () => new Response("{invalid"),
    async () => Response.json({ status: "Success", result: [action({ completedTime: "2026-09-21T01:00:00Z" })] }),
  ]) {
    const f = fixture(t);
    await assert.rejects(f.sync(undefined, { fetchImpl }), error => error.code.startsWith("REC_SOURCE_"));
    assert.equal(f.state.results.length, 0);
    assert.equal(f.sqlite.prepare("SELECT completed_at FROM creditex_registry_sync_runs").get().completed_at, "");
  }
});

test("account or permission changes during fetch cannot persist results", async t => {
  for (const change of [state => state.account.version++, state => { state.canOperate = false; }]) {
    const f = fixture(t);
    await assert.rejects(f.sync(undefined, { fetchImpl: async () => { change(f.state); return Response.json({ status: "Success", result: [action()] }); } }), error => ["REGISTRY_ACCOUNT_CHANGED", "REGISTRY_PERMISSION_DENIED"].includes(error.code));
    assert.equal(f.state.results.length, 0);
    assert.equal(f.state.evidence.length, 0);
  }
});

test("unresolved evidence remains available after a later empty source day, followed by a confirmed match", async t => {
  const f = fixture(t);
  await f.sync([action({ certificateRanges: [range({ endSerialNumber: 9 })] })]);
  const original = f.sqlite.prepare("SELECT * FROM creditex_registry_sync_matches").get();
  assert.equal(original.confirmed, 0);
  assert.equal(original.evidence_id, "evidence-1");
  const nextDate = "2026-09-23";
  await f.syncRecRegistry(f.db, actor, { accountId: "account-one", date: nextDate }, {
    now: () => NOW, fetchImpl: async () => Response.json({ status: "Success", result: [] }),
  });
  assert.deepEqual(f.sqlite.prepare("SELECT * FROM creditex_registry_sync_matches").get(), original);
  await f.syncRecRegistry(f.db, actor, { accountId: "account-one", date: nextDate }, {
    now: () => "2026-09-24T00:02:00.000Z",
    fetchImpl: async () => Response.json({ status: "Success", result: [action({ completedTime: "2026-09-23T03:00:00.000Z" })] }),
  });
  const matches = f.sqlite.prepare("SELECT * FROM creditex_registry_sync_matches ORDER BY source_date").all();
  assert.equal(matches.length, 2);
  assert.equal(matches[0].confirmed, 0);
  assert.equal(matches[1].confirmed, 1);
  assert.equal(matches[1].evidence_id, "evidence-2");
  assert.equal(matches[1].checked_at, "2026-09-24T00:02:00.000Z");
  assert.equal(f.state.results.length, 1);
});

test("same-day recheck replaces its evidence link and cannot confirm before result persistence", async t => {
  const f = fixture(t);
  await f.sync([action({ certificateRanges: [range({ endSerialNumber: 9 })] })]);
  await f.sync(undefined, { now: () => "2026-09-24T00:02:00.000Z" });
  const row = f.sqlite.prepare("SELECT * FROM creditex_registry_sync_matches").get();
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM creditex_registry_sync_matches").get().n, 1);
  assert.equal(row.confirmed, 1);
  assert.equal(row.evidence_id, "evidence-2");
  const failed = fixture(t);
  failed.state.failResult = true;
  await assert.rejects(failed.sync(), /Result persistence failed/);
  assert.equal(failed.sqlite.prepare("SELECT COUNT(*) n FROM creditex_registry_sync_matches").get().n, 0);
  assert.equal(failed.sqlite.prepare("SELECT completed_at FROM creditex_registry_sync_runs").get().completed_at, "");
});
