import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  canonicalTlinkSchemaGuardSql,
  ensureTlinkSchemaGuards,
  TLINK_SCHEMA_GUARD_DEFINITIONS,
} from "../src/lib/tlink-schema-guards.ts";

function testD1(database) {
  class Statement {
    constructor(sql, values = []) { this.sql = sql; this.values = values; }
    bind(...values) { return new Statement(this.sql, values); }
    async all() { return { results: database.prepare(this.sql).all(...this.values) }; }
    async run() { const result = database.prepare(this.sql).run(...this.values); return { success: true, meta: { changes: Number(result.changes) } }; }
  }
  return {
    prepare(sql) { return new Statement(sql); },
    async batch(statements) {
      database.exec("BEGIN IMMEDIATE");
      try { const results = []; for (const statement of statements) results.push(await statement.run()); database.exec("COMMIT"); return results; }
      catch (error) { database.exec("ROLLBACK"); throw error; }
    },
  };
}

function schemaDatabase() {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE trade_team_members (
      id text, owner_uid text, member_uid text, status text,
      can_create_jobs integer, can_manage_jobs integer, can_assign_jobs integer,
      can_view_customers integer, can_manage_customers integer,
      can_view_quotes integer, can_manage_quotes integer, can_send_quotes integer,
      can_view_invoices integer, can_manage_invoices integer,
      can_view_price_book integer, can_manage_price_book integer, can_apply_discounts integer,
      can_reschedule_jobs integer, can_manage_team integer, can_edit_team_permissions integer,
      can_view_field_evidence integer, can_manage_field_evidence integer,
      can_run_reports integer, can_search_customers integer
    );
    CREATE TABLE trade_crm_job_details (
      work_order_id text, firebase_uid text, customer_source text,
      accepted_disclosure_snapshot text, accepted_disclosure_sha256 text,
      accepted_disclosure_at text, created_at text
    );
    CREATE TABLE trade_crm_job_media (
      id text, work_order_id text, firebase_uid text, category text, content_type text,
      size_bytes integer, caption text, source text, photo_request_id text,
      photo_requirement_id text, request_revision integer, checklist_version text,
      customer_acknowledged_at text, evidence_envelope text, original_sha256 text,
      accepted_lead_source_photo_id text, accepted_lead_source_opportunity_id text,
      accepted_lead_source_preparation_id text, accepted_lead_source_release_id text,
      accepted_lead_prompt_id text, accepted_lead_service_categories text,
      accepted_disclosure_sha256 text, created_at text
    );
    CREATE TABLE trade_crm_job_media_events (
      job_media_id text, firebase_uid text, work_order_id text,
      actor_uid text, actor_member_id text
    );
    CREATE TABLE trade_work_orders (
      id text, firebase_uid text, source_reference text, source_type text, record_status text
    );
    CREATE TABLE trade_opportunity_matches (
      id text, opportunity_id text, firebase_uid text, status text,
      matched_categories text, updated_at text
    );
    CREATE TABLE trade_opportunities (
      id text, source_reference text, status text, expires_at text
    );
    CREATE TABLE public_trade_lead_quote_photos (
      id text, opportunity_id text, prompt_id text, prompt_label text,
      service_categories text, content_type text, size_bytes integer,
      sha256 text, privacy_status text, status text
    );
    CREATE TABLE public_trade_lead_quote_preparations (
      id text, opportunity_id text, source_reference text, status text,
      withdrawn_at text, granted_at text, photo_prompt_ids text
    );
    CREATE TABLE public_trade_lead_contact_releases (
      id text, opportunity_id text, source_reference text, status text,
      withdrawn_at text, granted_at text
    );
  `);
  return database;
}

const acceptedLeadFixture = {
  firebaseUid: "owner-1",
  workOrderId: "public-lead-work-match-1",
  opportunityId: "opportunity-1",
  sourceReference: "source-reference-1",
  preparationId: "preparation-1",
  releaseId: "release-1",
  disclosureSha256: "disclosure-sha-256",
  createdAt: "2026-08-13T01:02:03.000Z",
};

const acceptedLeadPhotos = [
  {
    id: "m1",
    sourcePhotoId: "source-photo-1",
    promptId: "prompt-1",
    label: "Front wall",
    contentType: "image/jpeg",
    sizeBytes: 101,
    sha256: "photo-sha-1",
    privacyStatus: "metadata-stripped",
  },
  {
    id: "m2",
    sourcePhotoId: "source-photo-2",
    promptId: "prompt-2",
    label: "Ceiling access",
    contentType: "image/png",
    sizeBytes: 202,
    sha256: "photo-sha-2",
    privacyStatus: "metadata-stripped",
  },
];

function seedAcceptedLeadSource(database) {
  const fixture = acceptedLeadFixture;
  database.prepare("INSERT INTO trade_work_orders (id, firebase_uid, source_reference, source_type, record_status) VALUES (?, ?, ?, 'public_lead', 'active')")
    .run(fixture.workOrderId, fixture.firebaseUid, "match-1");
  database.prepare("INSERT INTO trade_opportunity_matches (id, opportunity_id, firebase_uid, status, matched_categories, updated_at) VALUES ('match-1', ?, ?, 'interested', ?, ?)")
    .run(fixture.opportunityId, fixture.firebaseUid, JSON.stringify(["insulation"]), fixture.createdAt);
  database.prepare("INSERT INTO trade_opportunities (id, source_reference, status, expires_at) VALUES (?, ?, 'open', ?)")
    .run(fixture.opportunityId, fixture.sourceReference, "2026-08-14T01:02:03.000Z");
  database.prepare("INSERT INTO public_trade_lead_quote_preparations (id, opportunity_id, source_reference, status, withdrawn_at, granted_at, photo_prompt_ids) VALUES (?, ?, ?, 'active', '', ?, ?)")
    .run(
      fixture.preparationId,
      fixture.opportunityId,
      fixture.sourceReference,
      "2026-08-13T00:00:00.000Z",
      JSON.stringify(acceptedLeadPhotos.map((photo) => photo.promptId)),
    );
  database.prepare("INSERT INTO public_trade_lead_contact_releases (id, opportunity_id, source_reference, status, withdrawn_at, granted_at) VALUES (?, ?, ?, 'active', '', ?)")
    .run(fixture.releaseId, fixture.opportunityId, fixture.sourceReference, "2026-08-13T00:00:00.000Z");
  const sourcePhoto = database.prepare("INSERT INTO public_trade_lead_quote_photos (id, opportunity_id, prompt_id, prompt_label, service_categories, content_type, size_bytes, sha256, privacy_status, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')");
  for (const photo of acceptedLeadPhotos) {
    sourcePhoto.run(
      photo.sourcePhotoId,
      fixture.opportunityId,
      photo.promptId,
      photo.label,
      JSON.stringify(["insulation"]),
      photo.contentType,
      photo.sizeBytes,
      photo.sha256,
      photo.privacyStatus,
    );
  }
}

function insertAcceptedLeadMedia(database, photo, overrides = {}) {
  const fixture = acceptedLeadFixture;
  const values = {
    id: photo.id,
    evidenceEnvelope: JSON.stringify({
      contract: "tlink-accepted-public-lead-job-file-v1",
      privacyStatus: photo.privacyStatus,
    }),
    serviceCategories: JSON.stringify(["insulation"]),
    ...overrides,
  };
  database.prepare(`
    INSERT INTO trade_crm_job_media (
      id, work_order_id, firebase_uid, category, content_type, size_bytes, caption, source,
      photo_request_id, photo_requirement_id, request_revision, checklist_version,
      customer_acknowledged_at, evidence_envelope, original_sha256,
      accepted_lead_source_photo_id, accepted_lead_source_opportunity_id,
      accepted_lead_source_preparation_id, accepted_lead_source_release_id,
      accepted_lead_prompt_id, accepted_lead_service_categories,
      accepted_disclosure_sha256, created_at
    ) VALUES (?, ?, ?, 'before', ?, ?, ?, 'accepted_public_lead', '', '', 0, '', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    values.id,
    fixture.workOrderId,
    fixture.firebaseUid,
    photo.contentType,
    photo.sizeBytes,
    photo.label,
    fixture.createdAt,
    values.evidenceEnvelope,
    photo.sha256,
    photo.sourcePhotoId,
    fixture.opportunityId,
    fixture.preparationId,
    fixture.releaseId,
    photo.promptId,
    values.serviceCategories,
    fixture.disclosureSha256,
    fixture.createdAt,
  );
}

function insertAcceptedLeadJobDetails(database, snapshot, acceptedDisclosureAt = acceptedLeadFixture.createdAt) {
  database.prepare(`
    INSERT INTO trade_crm_job_details (
      work_order_id, firebase_uid, customer_source, accepted_disclosure_snapshot,
      accepted_disclosure_sha256, accepted_disclosure_at, created_at
    ) VALUES (?, ?, 'public_lead_released', ?, ?, ?, ?)
  `).run(
    acceptedLeadFixture.workOrderId,
    acceptedLeadFixture.firebaseUid,
    JSON.stringify(snapshot),
    acceptedLeadFixture.disclosureSha256,
    acceptedDisclosureAt,
    acceptedLeadFixture.createdAt,
  );
}

test("Sites-safe TLink migrations contain no trigger bodies", () => {
  for (const name of ["0131_trade_team_permissions_and_member_files.sql", "0132_public_lead_accepted_disclosure.sql", "0133_public_lead_job_files.sql"]) {
    const source = fs.readFileSync(new URL(`../drizzle/${name}`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /CREATE\s+TRIGGER/i, name);
    for (const statement of source.split(";").map((item) => item.trim()).filter(Boolean)) {
      assert.doesNotMatch(statement, /\bBEGIN\b/i, `${name} is individually parseable by Sites`);
    }
  }
});

test("runtime installer creates and verifies every TLink integrity guard", async () => {
  const database = schemaDatabase();
  const d1 = testD1(database);
  await ensureTlinkSchemaGuards(d1);
  await ensureTlinkSchemaGuards(d1);
  const installed = database.prepare("SELECT name FROM sqlite_schema WHERE type = 'trigger' ORDER BY name").all();
  assert.deepEqual(installed.map((row) => row.name), TLINK_SCHEMA_GUARD_DEFINITIONS.map((item) => item.name).sort());
  database.close();
  assert.equal(TLINK_SCHEMA_GUARD_DEFINITIONS.length, 9);
});

test("runtime installer accepts equivalent persisted SQLite trigger formatting", () => {
  const compact = "CREATE TRIGGER example BEFORE UPDATE ON records BEGIN SELECT CASE WHEN (NEW.value = 'keep  two  spaces') THEN RAISE(ABORT, 'no change') END; END;";
  const formatted = `CREATE TRIGGER IF NOT EXISTS example BEFORE UPDATE ON records
    BEGIN
      SELECT CASE WHEN( NEW.value = 'keep  two  spaces' )
        THEN RAISE(ABORT, 'no change') END;
    END;`;
  assert.equal(canonicalTlinkSchemaGuardSql(compact), canonicalTlinkSchemaGuardSql(formatted));
});

test("runtime installer accepts multiline formatting for unchanged failed Sites triggers", () => {
  const prior = [
    `CREATE TRIGGER \`trade_crm_job_media_accepted_lead_update_guard\`
BEFORE UPDATE ON \`trade_crm_job_media\`
FOR EACH ROW
WHEN OLD.source = 'accepted_public_lead'
BEGIN
  SELECT RAISE(ABORT, 'accepted public lead job file is immutable');
END;`,
    `CREATE TRIGGER \`trade_crm_job_media_events_insert_guard\`
BEFORE INSERT ON \`trade_crm_job_media_events\`
FOR EACH ROW
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM trade_crm_job_media media
    WHERE media.id = NEW.job_media_id
      AND media.firebase_uid = NEW.firebase_uid
      AND media.work_order_id = NEW.work_order_id
  ) OR NOT EXISTS (
    SELECT 1 FROM trade_team_members member
    WHERE member.id = NEW.actor_member_id
      AND member.owner_uid = NEW.firebase_uid
      AND member.member_uid = NEW.actor_uid
      AND member.status = 'active'
  ) THEN RAISE(ABORT, 'job file event scope is invalid') END;
END;`,
  ];
  for (const sql of prior) {
    const name = sql.match(/CREATE\s+TRIGGER\s+`([^`]+)`/i)?.[1] || "";
    const current = TLINK_SCHEMA_GUARD_DEFINITIONS.find((definition) => definition.name === name);
    assert.ok(current, name);
    assert.equal(canonicalTlinkSchemaGuardSql(sql), canonicalTlinkSchemaGuardSql(current.sql), name);
  }
});

test("runtime installer rejects weaker predecessor definitions after semantic hardening", async () => {
  const hardened = new Map(TLINK_SCHEMA_GUARD_DEFINITIONS.map((definition) => [definition.name, definition.sql]));
  const predecessors = [
    {
      name: "trade_crm_job_details_accepted_disclosure_insert_guard",
      sql: hardened.get("trade_crm_job_details_accepted_disclosure_insert_guard")
        .replace(" IS NOT 'tlink-public-lead-accepted-disclosure-v1'", " <> 'tlink-public-lead-accepted-disclosure-v1'")
        .replace(" OR datetime(NEW.accepted_disclosure_at) IS NULL", ""),
    },
    {
      name: "trade_crm_job_details_accepted_disclosure_update_guard",
      sql: hardened.get("trade_crm_job_details_accepted_disclosure_update_guard").replaceAll(" IS NOT ", " <> "),
    },
    {
      name: "trade_crm_job_media_accepted_lead_insert_guard",
      sql: hardened.get("trade_crm_job_media_accepted_lead_insert_guard")
        .replace(" IS NOT 'tlink-accepted-public-lead-job-file-v1'", " <> 'tlink-accepted-public-lead-job-file-v1'")
        .replace(" OR json_type(NEW.accepted_lead_service_categories) IS NOT 'array'", ""),
    },
    {
      name: "trade_crm_job_details_accepted_job_file_manifest_guard",
      sql: hardened.get("trade_crm_job_details_accepted_job_file_manifest_guard")
        .replace(" OR (SELECT COUNT(DISTINCT json_extract(manifest.value, '$.id')) FROM json_each(NEW.accepted_disclosure_snapshot, '$.photos') manifest) <> json_array_length(NEW.accepted_disclosure_snapshot, '$.photos')", ""),
    },
  ];

  for (const predecessor of predecessors) {
    const current = hardened.get(predecessor.name);
    assert.ok(current, predecessor.name);
    assert.notEqual(canonicalTlinkSchemaGuardSql(predecessor.sql), canonicalTlinkSchemaGuardSql(current), predecessor.name);
    const database = schemaDatabase();
    database.exec(predecessor.sql);
    await assert.rejects(
      ensureTlinkSchemaGuards(testD1(database)),
      new RegExp(`TLINK_SCHEMA_GUARD_MISMATCH:${predecessor.name}`),
    );
    database.close();
  }
});

test("accepted disclosure, job media and manifest guards reject malformed or incomplete records", async () => {
  const database = schemaDatabase();
  await ensureTlinkSchemaGuards(testD1(database));
  seedAcceptedLeadSource(database);

  assert.throws(
    () => insertAcceptedLeadMedia(database, acceptedLeadPhotos[0], {
      id: "bad-envelope",
      evidenceEnvelope: JSON.stringify({ privacyStatus: "metadata-stripped" }),
    }),
    /accepted public lead job file source is invalid/,
  );
  assert.throws(
    () => insertAcceptedLeadMedia(database, acceptedLeadPhotos[0], {
      id: "bad-categories",
      serviceCategories: JSON.stringify({ insulation: true }),
    }),
    /accepted public lead job file source is invalid/,
  );

  for (const photo of acceptedLeadPhotos) insertAcceptedLeadMedia(database, photo);

  assert.throws(
    () => insertAcceptedLeadJobDetails(database, { photos: acceptedLeadPhotos }),
    /accepted public lead disclosure required/,
  );
  assert.throws(
    () => insertAcceptedLeadJobDetails(database, {
      contract: "tlink-public-lead-accepted-disclosure-v1",
      photos: acceptedLeadPhotos,
    }, "not-a-date"),
    /accepted public lead disclosure required/,
  );
  assert.throws(
    () => insertAcceptedLeadJobDetails(database, {
      contract: "tlink-public-lead-accepted-disclosure-v1",
    }),
    /accepted public lead job file manifest is incomplete/,
  );
  assert.throws(
    () => insertAcceptedLeadJobDetails(database, {
      contract: "tlink-public-lead-accepted-disclosure-v1",
      photos: [acceptedLeadPhotos[0], acceptedLeadPhotos[0]],
    }),
    /accepted public lead job file manifest is incomplete/,
  );

  insertAcceptedLeadJobDetails(database, {
    contract: "tlink-public-lead-accepted-disclosure-v1",
    photos: acceptedLeadPhotos,
  });
  assert.throws(
    () => database.prepare("UPDATE trade_crm_job_details SET accepted_disclosure_snapshot = NULL WHERE work_order_id = ?").run(acceptedLeadFixture.workOrderId),
    /accepted public lead disclosure is immutable/,
  );
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM trade_crm_job_details").get().count, 1);
  database.close();
});

test("runtime installer fails closed for missing migrations and mismatched guards", async () => {
  const missing = new DatabaseSync(":memory:");
  await assert.rejects(ensureTlinkSchemaGuards(testD1(missing)), /TLINK_SCHEMA_MIGRATIONS_REQUIRED/);
  missing.close();

  const mismatched = schemaDatabase();
  mismatched.exec("CREATE TRIGGER trade_team_members_permissions_insert_guard BEFORE INSERT ON trade_team_members BEGIN SELECT RAISE(ABORT, 'wrong guard'); END;");
  await assert.rejects(
    ensureTlinkSchemaGuards(testD1(mismatched)),
    /TLINK_SCHEMA_GUARD_MISMATCH:trade_team_members_permissions_insert_guard/,
  );
  mismatched.close();
});

test("team access, Interested handoff, health and minute cron install guards before guarded work", () => {
  const access = fs.readFileSync(new URL("../src/lib/trade-team-server.ts", import.meta.url), "utf8");
  const workflow = fs.readFileSync(new URL("../src/lib/public-lead-quote-workflow-server.ts", import.meta.url), "utf8");
  const worker = fs.readFileSync(new URL("../worker/index.ts", import.meta.url), "utf8");
  assert.match(access, /await ensureTlinkSchemaGuards\(db\)/);
  assert.match(workflow, /await ensureTlinkSchemaGuards\(db\)/);
  assert.match(worker, /pathname === "\/api\/health"[\s\S]*await ensureTlinkSchemaGuards\(getD1\(\)\)/);
  assert.match(worker, /controller\.cron === NOTIFICATION_DELIVERY_CRON[\s\S]*ensureTlinkSchemaGuards\(getD1\(\)\)/);
});
