import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { GOVERNMENT_PROGRAM_TEMPLATES } from "../src/lib/australian-government-program-catalogue.ts";
import { REGISTRY_SCHEME_KEYS, REGISTRY_SCHEMES, registrySchemeForProgram, registryFormatSupportsActivity } from "../src/lib/creditex-registry.ts";
import { fixture, author } from "./helpers/creditex-registry-fixture.mjs";

const original = readFileSync(new URL("../drizzle/0189_creditex_registry_operations.sql", import.meta.url), "utf8");
const migration = readFileSync(new URL("../drizzle/0191_creditex_project_registry_schemes.sql", import.meta.url), "utf8");
const hash = `sha256:${"a".repeat(64)}`;
const now = "2026-09-25T00:00:00.000Z";

test("every catalogue certificate, project credit and retailer obligation has an explicit registry route", () => {
  const programs = GOVERNMENT_PROGRAM_TEMPLATES.filter(program => ["tradable_certificate", "project_credit", "retailer_obligation_credit"].includes(program.outcomeClass));
  for (const program of programs) {
    const scheme = registrySchemeForProgram(program.programCode);
    assert.ok(scheme, `${program.programCode} must not disappear from the submission workspace`);
    assert.ok(REGISTRY_SCHEMES.some(item => item.key === scheme));
  }
  assert.deepEqual(new Set(REGISTRY_SCHEMES.map(item => item.key)), new Set(REGISTRY_SCHEME_KEYS));
  assert.equal(registrySchemeForProgram("REGO"), "rego");
  assert.equal(registrySchemeForProgram("ACCU"), "accu");
  assert.equal(registrySchemeForProgram("not-a-scheme"), null);
  const rego = REGISTRY_SCHEMES.find(item => item.key === "rego");
  const accu = REGISTRY_SCHEMES.find(item => item.key === "accu");
  assert.equal(rego.submissionMode, "portal");
  assert.equal(accu.submissionMode, "portal");
  assert.match(rego.connectionMessage, /assesses the claim after payment/);
  assert.match(accu.connectionMessage, /abatement statement.*ANREU/);
  assert.match(accu.connectionMessage, /Payment does not create units/);
});

test("registry formats reject incompatible REC activities and unknown formats", () => {
  for (const activity of ["sres-pv", "sres-wind", "sres-hydro"]) assert.equal(registryFormatSupportsActivity("rec_sgu", activity), true);
  for (const activity of ["sres-swh", "sres-ashp"]) assert.equal(registryFormatSupportsActivity("rec_swh", activity), true);
  assert.equal(registryFormatSupportsActivity("rec_battery", "sres-bess"), true);
  for (const format of ["rec_sgu", "rec_swh", "rec_battery"]) {
    assert.equal(registryFormatSupportsActivity(format, "unknown-activity"), false);
    assert.equal(registryFormatSupportsActivity(format, ""), false);
  }
  assert.equal(registryFormatSupportsActivity("rec_sgu", "sres-bess"), false);
  assert.equal(registryFormatSupportsActivity("rec_battery", "sres-pv"), false);
  assert.equal(registryFormatSupportsActivity("nsw_esc", "ess-test"), true);
  assert.equal(registryFormatSupportsActivity("nsw_prc", "pdrs-test"), true);
  assert.equal(registryFormatSupportsActivity("invented-format", "sres-pv"), false);
});

function insert(database, table, fields) {
  const columns = Object.keys(fields);
  database.prepare(`INSERT INTO ${table} (${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")})`).run(...Object.values(fields));
}

function populate(database, organisation = "org-one", scheme = "stc") {
  const account = `${organisation}-account`, evidence = `${organisation}-evidence`, packet = `${organisation}-packet`;
  const invoice = `${organisation}-invoice`, result = `${organisation}-result`, exported = `${organisation}-export`;
  insert(database, "creditex_registry_accounts", {
    id: account, organisation_id: organisation, scheme, account_reference: "AUTHORISED-001", submitter_reference: "SUBMITTER-001",
    legal_name: "Synthetic provider", finance_email: "finance@example.test", results_email: "results@example.test",
    activity_scope: '["sres-pv"]', authority_reference: "AUTHORITY-001", authority_expires_on: "2027-09-25",
    version: 3, enabled: 1, created_by_uid: "author", created_at: now, updated_at: now,
  });
  insert(database, "creditex_registry_claim_accounts", { organisation_id: organisation, packet_id: packet, account_id: account, packet_sha256: hash, bound_by_uid: "author", created_at: now });
  insert(database, "creditex_registry_evidence", { id: evidence, organisation_id: organisation, object_key: `${organisation}/original`, filename: "original.pdf", content_type: "application/pdf", byte_length: 42, sha256: hash, created_by_uid: "author", created_at: now });
  insert(database, "creditex_registry_invoices", { id: invoice, organisation_id: organisation, account_id: account, reference: "INV-001", amount_minor: 10000, due_date: "2026-10-01", evidence_id: evidence, payload_sha256: hash, status: "active", created_by_uid: "author", created_at: now });
  insert(database, "creditex_registry_invoice_claims", { organisation_id: organisation, invoice_id: invoice, packet_id: packet });
  insert(database, "creditex_registry_payments", { id: `${organisation}-payment`, organisation_id: organisation, invoice_id: invoice, reference: "PAY-001", amount_minor: 10000, paid_at: now, evidence_id: evidence, payload_sha256: hash, created_by_uid: "author", created_at: now });
  insert(database, "creditex_registry_results", { id: result, organisation_id: organisation, packet_id: packet, account_id: account, external_reference: "CER-001", registry_status: "registered", quantity: "12", occurred_at: now, evidence_id: evidence, note: "Synthetic original result", source: "reviewed_document", fingerprint: hash, recorded_by_uid: "author", created_at: now });
  insert(database, "creditex_registry_result_reviews", { organisation_id: organisation, result_id: result, decision: "approved", note: "Independent review", reviewed_by_uid: "reviewer", created_at: now });
  insert(database, "creditex_registry_sync_runs", { organisation_id: organisation, account_id: account, source_date: "2026-09-24", attempted_at: now, completed_at: now, source_sha256: hash, matched_count: 1 });
  insert(database, "creditex_registry_exports", { id: exported, organisation_id: organisation, account_id: account, format_key: "rec_sgu", base_vintage: "", packet_ids: JSON.stringify([packet]), packet_hashes: JSON.stringify([hash]), evidence_id: evidence, payload_sha256: hash, account_version: 3, format_sha256: hash, created_by_uid: "author", created_at: now });
  insert(database, "creditex_registry_sync_matches", { organisation_id: organisation, account_id: account, source_date: "2026-09-24", packet_id: packet, evidence_id: evidence, confirmed: 1, checked_at: now });
  insert(database, "creditex_registry_export_reviews", { organisation_id: organisation, export_id: exported, decision: "approved", note: "Original bytes verified", reviewed_by_uid: "reviewer", created_at: now });
}

function snapshot(database) {
  const tables = database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'creditex_registry_%' ORDER BY name").all();
  return Object.fromEntries(tables.map(({ name }) => [name, database.prepare(`SELECT * FROM ${name} ORDER BY organisation_id`).all()]));
}

test("project scheme migration preserves populated account identities and every linked evidence, review and payment row", t => {
  const database = new DatabaseSync(":memory:");
  t.after(() => database.close());
  database.exec("PRAGMA foreign_keys=ON");
  database.exec(original);
  populate(database);
  populate(database, "org-two", "veu");
  const before = snapshot(database);
  const foreignKeysBefore = Object.fromEntries(Object.keys(before).map(table => [table, database.prepare(`PRAGMA foreign_key_list(${table})`).all()]));
  database.exec("BEGIN");
  database.exec(migration);
  assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);
  database.exec("COMMIT");
  assert.deepEqual(snapshot(database), before);
  for (const table of Object.keys(before)) assert.deepEqual(database.prepare(`PRAGMA foreign_key_list(${table})`).all(), foreignKeysBefore[table]);
  assert.equal(database.prepare("PRAGMA foreign_keys").get().foreign_keys, 1);
  assert.equal(database.prepare("PRAGMA defer_foreign_keys").get().defer_foreign_keys, 0);
  assert.throws(() => database.exec("DELETE FROM creditex_registry_accounts WHERE id='org-one-account'"), /FOREIGN KEY/);
  assert.throws(() => database.exec("UPDATE creditex_registry_claim_accounts SET account_id='org-two-account' WHERE organisation_id='org-one'"), /FOREIGN KEY/);
  assert.throws(() => database.exec("UPDATE creditex_registry_accounts SET scheme='unknown'"), /CHECK/);
  assert.throws(() => database.exec("UPDATE creditex_registry_accounts SET version=0"), /CHECK/);
  assert.throws(() => database.exec("UPDATE creditex_registry_accounts SET enabled=2"), /CHECK/);
  populate(database, "org-rego", "rego");
  populate(database, "org-accu", "accu");
  assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);
  assert.equal(database.prepare("SELECT COUNT(*) count FROM sqlite_master WHERE name='creditex_registry_accounts_retained_0191'").get().count, 0);
});

test("migration cannot commit orphaned bindings and rolls back to the previous schema and data", t => {
  const database = new DatabaseSync(":memory:");
  t.after(() => database.close());
  database.exec("PRAGMA foreign_keys=ON");
  database.exec(original);
  populate(database);
  const before = snapshot(database);
  database.exec("BEGIN");
  database.exec(migration);
  database.exec("DELETE FROM creditex_registry_accounts");
  assert.throws(() => database.exec("COMMIT"), /FOREIGN KEY/);
  database.exec("ROLLBACK");
  assert.deepEqual(snapshot(database), before);
  assert.throws(() => database.exec("UPDATE creditex_registry_accounts SET scheme='rego'"), /CHECK/);
});

for (const [programCode, scheme, activityTemplateId] of [["REGO", "rego", "rego-generation"], ["ACCU", "accu", "accu-icer"]]) {
  test(`${programCode} accounts bind and appear in the workspace through the existing authority and review gates`, async t => {
    const f = fixture(t);
    f.sqlite.exec("BEGIN"); f.sqlite.exec(migration); f.sqlite.exec("COMMIT");
    Object.assign(f.packet, { programCode, activityTemplateId });
    const accountId = await f.account(author, { scheme, activityScope: [activityTemplateId] });
    await f.service.attachRegistryAccount(f.db, author, { accountId, packetId: f.packet.id, expectedPacketSha256: f.packet.packetSha256 }, f.options);
    const workspace = await f.service.loadRegistryWorkspace(f.db, author);
    assert.equal(workspace.claims.length, 1);
    assert.equal(workspace.claims[0].scheme, scheme);
    assert.equal(workspace.claims[0].accountId, accountId);
    assert.equal(workspace.claims[0].registryStatus, "unconfirmed");
    f.packet.review.decision = "rejected";
    await assert.rejects(f.service.attachRegistryAccount(f.db, author, { accountId, packetId: f.packet.id, expectedPacketSha256: f.packet.packetSha256 }, f.options), { code: "REGISTRY_APPROVAL_REQUIRED" });
  });
}
