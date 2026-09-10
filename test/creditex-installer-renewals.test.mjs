import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import ts from "typescript";
import { tradeTeamDocumentExpiryStatus } from "../src/lib/trade-team-document-expiry-server.ts";

const source = fs.readFileSync(new URL("../src/lib/creditex-installer-renewals-server.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const exports = {};
new Function("require", "exports", compiled)((name) => {
  assert.equal(name, "./trade-team-document-expiry-server");
  return { tradeTeamDocumentExpiryStatus };
}, exports);
const { loadCreditexInstallerRenewals } = exports;
const now = new Date("2026-09-10T10:00:00.000Z");
const scope = { organisationId: "creditex", role: "admin", participantIds: ["participant-a"], now };

function fixture() {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE compliance_organisations (id TEXT PRIMARY KEY, organisation_code TEXT, status TEXT);
    CREATE TABLE trade_accounts (firebase_uid TEXT PRIMARY KEY, verified_abn TEXT, partner_type TEXT, account_status TEXT);
    CREATE TABLE compliance_participants (id TEXT PRIMARY KEY, organisation_id TEXT, participant_type TEXT,
      status TEXT, external_reference TEXT, abn TEXT);
    CREATE TABLE trade_work_orders (id TEXT PRIMARY KEY, firebase_uid TEXT, partner_type TEXT,
      record_status TEXT, stage TEXT, assignee_member_id TEXT);
    CREATE TABLE trade_work_order_compliance_intents (id TEXT PRIMARY KEY, compliance_organisation_id TEXT,
      installer_uid TEXT, work_order_id TEXT, status TEXT);
    CREATE TABLE trade_team_members (id TEXT PRIMARY KEY, owner_uid TEXT, member_uid TEXT, status TEXT);
    CREATE TABLE trade_team_member_files (id TEXT PRIMARY KEY, owner_uid TEXT, team_member_id TEXT,
      category TEXT, title TEXT, expires_at TEXT, status TEXT, file_name TEXT, object_key TEXT);
    CREATE TABLE trade_team_member_credentials (id TEXT PRIMARY KEY, owner_uid TEXT, team_member_id TEXT,
      file_id TEXT, expires_at TEXT, status TEXT, credential_number TEXT, issuer TEXT, credential_type TEXT);
    INSERT INTO compliance_organisations VALUES ('creditex', 'CREDITEX-AU', 'active'), ('other', 'OTHER', 'active');
    INSERT INTO trade_accounts VALUES ('owner-a', '12345678901', 'installer', 'active');
    INSERT INTO compliance_participants VALUES ('participant-a', 'creditex', 'installer', 'active', 'owner-a', '12345678901');
    INSERT INTO trade_work_orders VALUES ('job-a', 'owner-a', 'installer', 'active', 'scheduled', 'worker-a');
    INSERT INTO trade_work_order_compliance_intents VALUES ('intent-a', 'creditex', 'owner-a', 'job-a', 'planned');
    INSERT INTO trade_team_members VALUES ('worker-a', 'owner-a', 'worker-user', 'active'),
      ('owner-member', 'owner-a', 'owner-a', 'active'), ('unassigned', 'owner-a', 'other-worker', 'active');
  `);
  const db = {
    prepare(sql) {
      const statement = database.prepare(sql);
      return { bind(...values) { return { async all() { return { results: statement.all(...values) }; } }; } };
    },
  };
  const file = (id, options = {}) => {
    database.prepare("INSERT INTO trade_team_member_files VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
      id, options.owner ?? "owner-a", options.member ?? "worker-a", options.category ?? "licence",
      options.title ?? id, options.expiry ?? "2026-10-01", options.status ?? "active",
      `private-${id}-number.pdf`, `private/team/${id}`,
    );
  };
  const credential = (id, fileId, expiry, options = {}) => {
    database.prepare("INSERT INTO trade_team_member_credentials VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
      id, options.owner ?? "owner-a", options.member ?? "worker-a", fileId,
      expiry, options.status ?? "active", "SECRET-LICENCE-123", "Private issuer", options.type ?? "licence",
    );
  };
  return { database, db, file, credential };
}

test("only admins with a bounded participant request can query renewal metadata", async () => {
  const db = { prepare() { assert.fail("Unauthorised request queried the database"); } };
  for (const role of ["case_manager", "reviewer", "auditor", "", "owner"]) {
    assert.deepEqual(await loadCreditexInstallerRenewals(db, { ...scope, role }), {});
  }
  assert.deepEqual(await loadCreditexInstallerRenewals(db, { ...scope, participantIds: [] }), {});
  assert.deepEqual(await loadCreditexInstallerRenewals(db, { ...scope, organisationId: "" }), {});
  await assert.rejects(loadCreditexInstallerRenewals(db, { ...scope, participantIds: Array.from({ length: 51 }, (_, i) => `p${i}`) }), /PARTICIPANTS_INVALID/);
});

test("linked installer exposes only owner and currently assigned worker licence/insurance metadata", async () => {
  const { database, db, file } = fixture();
  try {
    file("Worker licence");
    file("Business insurance", { member: "owner-member", category: "insurance" });
    file("Unrelated worker", { member: "unassigned" });
    for (const category of ["id", "training", "compliance", "other"]) file(category, { category });
    file("Deleted licence", { status: "deleted" });
    file("Pending upload", { status: "uploading" });
    file("Wrong owner", { owner: "owner-b" });
    const result = await loadCreditexInstallerRenewals(db, scope);
    assert.deepEqual(result, { "participant-a": [
      { type: "insurance", title: "Business insurance", expiresAt: "2026-10-01", status: "expiring" },
      { type: "licence", title: "Worker licence", expiresAt: "2026-10-01", status: "expiring" },
    ] });
    for (const item of result["participant-a"]) {
      assert.deepEqual(Object.keys(item).sort(), ["expiresAt", "status", "title", "type"]);
    }
    assert.doesNotMatch(JSON.stringify(result), /private-|private\/team|worker-user|owner-a|SECRET-LICENCE|issuer|fileId|url|download|object_key|file_name/);
  } finally { database.close(); }
});

test("inactive or mismatched organisation, installer, job, participant and assignment links fail closed", async (t) => {
  const mutations = [
    ["wrong organisation", "UPDATE compliance_organisations SET organisation_code = 'OTHER' WHERE id = 'creditex'"],
    ["inactive organisation", "UPDATE compliance_organisations SET status = 'suspended' WHERE id = 'creditex'"],
    ["inactive installer", "UPDATE trade_accounts SET account_status = 'closed'"],
    ["non-installer", "UPDATE trade_accounts SET partner_type = 'retailer'"],
    ["missing intent", "DELETE FROM trade_work_order_compliance_intents"],
    ["other organisation intent", "UPDATE trade_work_order_compliance_intents SET compliance_organisation_id = 'other'"],
    ["superseded intent", "UPDATE trade_work_order_compliance_intents SET status = 'superseded'"],
    ["wrong intent owner", "UPDATE trade_work_order_compliance_intents SET installer_uid = 'owner-b'"],
    ["inactive job", "UPDATE trade_work_orders SET record_status = 'binned'"],
    ["completed job", "UPDATE trade_work_orders SET stage = 'completed'"],
    ["cancelled job", "UPDATE trade_work_orders SET stage = 'cancelled'"],
    ["other job owner", "UPDATE trade_work_orders SET firebase_uid = 'owner-b'"],
    ["inactive participant", "UPDATE compliance_participants SET status = 'suspended'"],
    ["other organisation participant", "UPDATE compliance_participants SET organisation_id = 'other'"],
    ["non-installer participant", "UPDATE compliance_participants SET participant_type = 'agent'"],
    ["inactive worker", "UPDATE trade_team_members SET status = 'removed' WHERE id = 'worker-a'"],
    ["changed assignment", "UPDATE trade_work_orders SET assignee_member_id = 'unassigned'"],
  ];
  for (const [name, mutation] of mutations) await t.test(name, async () => {
    const { database, db, file } = fixture();
    try {
      file("worker");
      database.exec(mutation);
      assert.deepEqual(await loadCreditexInstallerRenewals(db, scope), {});
    } finally { database.close(); }
  });
});

test("case-linked jobs qualify and repeated intents do not duplicate documents", async () => {
  const { database, db, file } = fixture();
  try {
    file("worker");
    database.exec("UPDATE trade_work_order_compliance_intents SET status = 'case_linked'; INSERT INTO trade_work_order_compliance_intents VALUES ('intent-b', 'creditex', 'owner-a', 'job-a', 'planned')");
    assert.equal((await loadCreditexInstallerRenewals(db, scope))["participant-a"].length, 1);
    assert.deepEqual(await loadCreditexInstallerRenewals(db, { ...scope, participantIds: ["not-requested"] }), {});
  } finally { database.close(); }
});

test("exact owner participant takes precedence over a verified-ABN fallback", async () => {
  const { database, db, file } = fixture();
  try {
    file("worker");
    database.exec("INSERT INTO compliance_participants VALUES ('abn-match', 'creditex', 'installer', 'active', 'legacy-reference', '12345678901')");
    const result = await loadCreditexInstallerRenewals(db, { ...scope, participantIds: ["participant-a", "abn-match"] });
    assert.deepEqual(Object.keys(result), ["participant-a"]);
    database.exec("DELETE FROM compliance_participants WHERE id = 'participant-a'");
    assert.deepEqual(Object.keys(await loadCreditexInstallerRenewals(db, { ...scope, participantIds: ["abn-match"] })), ["abn-match"]);
    database.exec("UPDATE trade_accounts SET verified_abn = ''");
    assert.deepEqual(await loadCreditexInstallerRenewals(db, { ...scope, participantIds: ["abn-match"] }), {});
  } finally { database.close(); }
});

test("ambiguous participants fail closed even when only one candidate was requested", async (t) => {
  for (const exact of [true, false]) await t.test(exact ? "duplicate exact owner" : "duplicate verified ABN", async () => {
    const { database, db, file } = fixture();
    try {
      file("worker");
      if (!exact) database.exec("UPDATE compliance_participants SET external_reference = 'legacy-a'");
      database.prepare("INSERT INTO compliance_participants VALUES ('ambiguous', 'creditex', 'installer', 'active', ?, '12345678901')").run(exact ? "owner-a" : "legacy-b");
      assert.deepEqual(await loadCreditexInstallerRenewals(db, scope), {});
    } finally { database.close(); }
  });
});

test("multiple linked owner accounts cannot share one participant through ABN matching", async () => {
  const { database, db, file } = fixture();
  try {
    file("worker");
    database.exec(`UPDATE compliance_participants SET external_reference = 'legacy-reference';
      INSERT INTO trade_accounts VALUES ('owner-b', '12345678901', 'installer', 'active');
      INSERT INTO trade_work_orders VALUES ('job-b', 'owner-b', 'installer', 'active', 'scheduled', '');
      INSERT INTO trade_work_order_compliance_intents VALUES ('intent-b', 'creditex', 'owner-b', 'job-b', 'planned');`);
    assert.deepEqual(await loadCreditexInstallerRenewals(db, scope), {});
  } finally { database.close(); }
});

test("expiry status uses recorded dates and never exposes filenames as missing titles", async () => {
  const { database, db, file } = fixture();
  try {
    file("no-expiry", { expiry: "", title: "" });
    file("expired", { expiry: "2026-09-09" });
    file("today", { expiry: "2026-09-10" });
    file("thirty-days", { expiry: "2026-10-10" });
    file("current", { expiry: "2026-10-11" });
    const result = (await loadCreditexInstallerRenewals(db, scope))["participant-a"];
    const states = Object.fromEntries(result.map((item) => [item.title, item.status]));
    assert.deepEqual(states, { Licence: "no_expiry", expired: "expired", today: "expiring", "thirty-days": "expiring", current: "current" });
    assert.equal(result.find((item) => item.title === "Licence").expiresAt, "");
  } finally { database.close(); }
});

test("earlier active linked credential expiry wins without accepting unrelated or archived credentials", async () => {
  const { database, db, file, credential } = fixture();
  try {
    file("earlier-credential", { expiry: "2027-01-01" });
    credential("earlier", "earlier-credential", "2026-09-09");
    file("file-expiry", { expiry: "2026-10-01" });
    credential("later", "file-expiry", "2027-01-01");
    credential("archived", "file-expiry", "2020-01-01", { status: "archived" });
    credential("foreign-owner", "file-expiry", "2020-01-01", { owner: "owner-b" });
    credential("foreign-worker", "file-expiry", "2020-01-01", { member: "unassigned" });
    file("credential-only", { expiry: "" });
    credential("only", "credential-only", "2026-10-11");
    const result = (await loadCreditexInstallerRenewals(db, scope))["participant-a"];
    assert.deepEqual(Object.fromEntries(result.map((item) => [item.title, [item.expiresAt, item.status]])), {
      "earlier-credential": ["2026-09-09", "expired"],
      "file-expiry": ["2026-10-01", "expiring"],
      "credential-only": ["2026-10-11", "current"],
    });
  } finally { database.close(); }
});

test("qualifications expose expiry only with an active matching supporting credential", async () => {
  const { database, db, file, credential } = fixture();
  try {
    file("Smoke alarm training", { category: "training", expiry: "2027-01-01" });
    credential("smoke-training", "Smoke alarm training", "2026-10-01", { type: "training" });
    file("Accreditation", { category: "compliance", expiry: "" });
    credential("accreditation", "Accreditation", "2026-09-09", { type: "accreditation" });
    file("General supporting file", { category: "other", title: "", expiry: "2026-10-11" });
    credential("general-training", "General supporting file", "", { type: "training" });
    file("Unlinked training", { category: "training" });
    file("General private file", { category: "other" });
    file("Private ID", { category: "id" });
    credential("id-link", "Private ID", "2026-10-01", { type: "training" });
    for (const status of ["archived", "expired", "suspended"]) {
      file(status, { category: "training" });
      credential(`${status}-link`, status, "2026-10-01", { status, type: "training" });
    }
    for (const [id, options] of [
      ["wrong-owner", { owner: "owner-b", type: "training" }],
      ["wrong-worker", { member: "unassigned", type: "training" }],
      ["wrong-type", { type: "other" }],
    ]) {
      file(id, { category: "training" });
      credential(`${id}-link`, id, "2026-10-01", options);
    }
    file("Removed credential", { category: "training" });
    credential("removed-link", "Removed credential", "2026-10-01", { type: "training" });
    database.exec("UPDATE trade_team_member_credentials SET file_id = '' WHERE id = 'removed-link'");
    const result = (await loadCreditexInstallerRenewals(db, scope))["participant-a"];
    assert.deepEqual(result, [
      { type: "qualification", title: "Accreditation", expiresAt: "2026-09-09", status: "expired" },
      { type: "qualification", title: "Qualification", expiresAt: "2026-10-11", status: "current" },
      { type: "qualification", title: "Smoke alarm training", expiresAt: "2026-10-01", status: "expiring" },
    ]);
    for (const item of result) assert.deepEqual(Object.keys(item).sort(), ["expiresAt", "status", "title", "type"]);
  } finally { database.close(); }
});
