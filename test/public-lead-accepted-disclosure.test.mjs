import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import ts from "typescript";
import {
  PUBLIC_PLAN_CONSENT_NOTICE_VERSION,
  PUBLIC_PLAN_CONSENT_PURPOSE,
  publicPlanContactReleaseAccessSql,
} from "../src/lib/public-plan-enquiry.mjs";
import {
  PUBLIC_PLAN_QUOTE_PHOTO_NOTICE_VERSION,
  PUBLIC_PLAN_QUOTE_PHOTO_PURPOSE,
  strictPublicPlanQuoteServiceCategories,
} from "../src/lib/public-plan-quote-preparation.mjs";
import {
  publicLeadAcceptedDisclosure,
  publicLeadIssueAccessGuard,
  publicLeadQuoteWorkflowIds,
  publicLeadQuoteWorkflowSnapshot,
} from "../src/lib/public-lead-quote-workflow.mjs";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const acceptedDisclosureMigration = read("../drizzle/0132_public_lead_accepted_disclosure.sql");
const acceptedJobFilesMigration = read("../drizzle/0133_public_lead_job_files.sql");
const quoteRoute = read("../src/app/api/trade-quotes/route.ts");
const quickInvoiceRoute = read("../src/app/api/trade-quick-invoices/route.ts");
const scheduleRoute = read("../src/app/api/trade-schedule/route.ts");
const crmRoute = read("../src/app/api/trade-crm/route.ts");
const quoteDocumentServer = read("../src/lib/trade-quote-review-server.ts");

class TestD1Statement {
  constructor(database, sql, values = []) {
    this.database = database;
    this.sql = sql;
    this.values = values;
  }

  bind(...values) {
    return new TestD1Statement(this.database, this.sql, values);
  }

  async first() {
    return this.database.prepare(this.sql).get(...this.values) || null;
  }

  async all() {
    return { results: this.database.prepare(this.sql).all(...this.values) };
  }

  runSync() {
    const result = this.database.prepare(this.sql).run(...this.values);
    return { success: true, meta: { changes: Number(result.changes) } };
  }

  async run() {
    return this.runSync();
  }
}

function testD1(database) {
  return {
    prepare(sql) {
      return new TestD1Statement(database, sql);
    },
    async batch(statements) {
      database.exec("BEGIN IMMEDIATE");
      try {
        const results = statements.map((statement) => statement.runSync());
        database.exec("COMMIT");
        return results;
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    },
  };
}

function loadTypescriptModule(path, mocks) {
  const output = ts.transpileModule(read(path), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
    fileName: path,
  }).outputText;
  const moduleRecord = { exports: {} };
  const require = (specifier) => {
    if (Object.hasOwn(mocks, specifier)) return mocks[specifier];
    throw new Error(`Unexpected module dependency: ${specifier}`);
  };
  new Function("require", "module", "exports", output)(
    require,
    moduleRecord,
    moduleRecord.exports,
  );
  return moduleRecord.exports;
}

function applyMigration(database, source) {
  for (const statement of source.split("--> statement-breakpoint")) {
    if (statement.trim()) database.exec(statement);
  }
}

function workflowFixture() {
  evidenceObjects.clear();
  const database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE trade_opportunity_matches (
      id text PRIMARY KEY, opportunity_id text NOT NULL, firebase_uid text NOT NULL,
      status text NOT NULL, matched_categories text NOT NULL,
      partner_note text NOT NULL DEFAULT '', updated_at text NOT NULL DEFAULT ''
    );
    CREATE TABLE trade_opportunities (
      id text PRIMARY KEY, title text NOT NULL, summary text NOT NULL,
      priority text NOT NULL, source_reference text NOT NULL, postcode text NOT NULL,
      state text NOT NULL, status text NOT NULL, expires_at text NOT NULL
    );
    CREATE TABLE public_trade_lead_contact_releases (
      id text PRIMARY KEY, opportunity_id text NOT NULL, source_reference text NOT NULL,
      status text NOT NULL, withdrawn_at text NOT NULL, disclosed_fields text NOT NULL,
      customer_first_name text NOT NULL, customer_last_name text NOT NULL,
      customer_email text NOT NULL, customer_phone text NOT NULL,
      customer_unit_number text NOT NULL, customer_street_address text NOT NULL,
      customer_suburb text NOT NULL, customer_address_state text NOT NULL,
      postcode text NOT NULL, customer_message text NOT NULL, notice_version text NOT NULL,
      consent_purpose text NOT NULL, granted_at text NOT NULL, updated_at text NOT NULL,
      private_plan_json text NOT NULL DEFAULT ''
    );
    CREATE TABLE public_trade_lead_quote_preparations (
      id text PRIMARY KEY, opportunity_id text NOT NULL, source_reference text NOT NULL,
      status text NOT NULL, version text NOT NULL, notice_version text NOT NULL,
      consent_purpose text NOT NULL, granted_at text NOT NULL, withdrawn_at text NOT NULL,
      updated_at text NOT NULL, question_answers text NOT NULL,
      photo_prompt_ids text NOT NULL DEFAULT '[]'
    );
    CREATE TABLE public_trade_lead_quote_photos (
      id text PRIMARY KEY, opportunity_id text NOT NULL, prompt_id text NOT NULL,
      prompt_label text NOT NULL, service_categories text NOT NULL,
      content_type text NOT NULL, size_bytes integer NOT NULL, object_key text NOT NULL,
      sha256 text NOT NULL, privacy_status text NOT NULL, status text NOT NULL,
      created_at text NOT NULL
    );
    CREATE TABLE trade_accounts (
      firebase_uid text PRIMARY KEY, partner_type text NOT NULL,
      quote_email_intro text NOT NULL, quote_default_terms text NOT NULL
    );
    CREATE TABLE trade_crm_enquiries (
      id text PRIMARY KEY, firebase_uid text NOT NULL, source_type text NOT NULL,
      source_reference text NOT NULL, opportunity_match_id text NOT NULL,
      customer_id text NOT NULL DEFAULT '', customer_contact_id text NOT NULL DEFAULT '',
      service_site_id text NOT NULL DEFAULT '', status text NOT NULL,
      duplicate_decision text NOT NULL DEFAULT '', record_status text NOT NULL,
      updated_at text NOT NULL
    );
    CREATE TABLE trade_crm_customers (
      id text PRIMARY KEY, firebase_uid text NOT NULL, customer_number text NOT NULL,
      customer_type text NOT NULL, first_name text NOT NULL, last_name text NOT NULL,
      business_name text NOT NULL, business_number text NOT NULL, email text NOT NULL,
      phone text NOT NULL, address_line_1 text NOT NULL, address_line_2 text NOT NULL,
      suburb text NOT NULL, address_state text NOT NULL, postcode text NOT NULL,
      tags text NOT NULL, private_notes text NOT NULL, record_status text NOT NULL,
      created_at text NOT NULL, updated_at text NOT NULL
    );
    CREATE TABLE trade_crm_customer_contacts (
      id text PRIMARY KEY, firebase_uid text NOT NULL, customer_id text NOT NULL,
      first_name text NOT NULL, last_name text NOT NULL, role_label text NOT NULL,
      email text NOT NULL, phone text NOT NULL, is_primary integer NOT NULL,
      record_status text NOT NULL, created_at text NOT NULL, updated_at text NOT NULL
    );
    CREATE TABLE trade_crm_service_sites (
      id text PRIMARY KEY, firebase_uid text NOT NULL, customer_id text NOT NULL,
      site_label text NOT NULL, address_line_1 text NOT NULL, address_line_2 text NOT NULL,
      suburb text NOT NULL, address_state text NOT NULL, postcode text NOT NULL,
      address_entry_mode text NOT NULL, address_provider text NOT NULL,
      address_provider_reference text NOT NULL, address_formatted text NOT NULL,
      address_verified_at text NOT NULL, access_instructions text NOT NULL,
      parking_instructions text NOT NULL, hazard_notes text NOT NULL,
      is_primary integer NOT NULL, record_status text NOT NULL,
      created_at text NOT NULL, updated_at text NOT NULL
    );
    CREATE TABLE trade_crm_site_contacts (
      id text PRIMARY KEY, firebase_uid text NOT NULL, service_site_id text NOT NULL,
      customer_contact_id text NOT NULL, role_label text NOT NULL,
      is_primary integer NOT NULL, record_status text NOT NULL,
      created_at text NOT NULL, updated_at text NOT NULL
    );
    CREATE TABLE trade_work_orders (
      id text PRIMARY KEY, firebase_uid text NOT NULL, partner_type text NOT NULL,
      work_type text NOT NULL, source_type text NOT NULL, source_reference text NOT NULL,
      work_number text NOT NULL, title text NOT NULL, service_category text NOT NULL,
      service_categories text NOT NULL, site_area text NOT NULL, stage text NOT NULL,
      priority text NOT NULL, scheduled_start text NOT NULL, scheduled_end text NOT NULL,
      assignee_member_id text NOT NULL, assignee_label text NOT NULL,
      record_status text NOT NULL, revision integer NOT NULL DEFAULT 1,
      created_at text NOT NULL, updated_at text NOT NULL
    );
    CREATE TABLE trade_crm_job_details (
      id text PRIMARY KEY, work_order_id text NOT NULL, firebase_uid text NOT NULL,
      crm_customer_id text NOT NULL, service_site_id text NOT NULL,
      customer_source text NOT NULL, pipeline_stage text NOT NULL,
      building_type text NOT NULL, description text NOT NULL,
      customer_reference text NOT NULL, next_action text NOT NULL, tags text NOT NULL,
      estimated_value_cents integer NOT NULL, quoted_value_cents integer NOT NULL,
      invoiced_value_cents integer NOT NULL, paid_value_cents integer NOT NULL,
      quote_status text NOT NULL, invoice_status text NOT NULL, payment_due_at text NOT NULL,
      created_at text NOT NULL, updated_at text NOT NULL
    );
    CREATE TABLE trade_work_order_events (
      id text PRIMARY KEY, work_order_id text NOT NULL, firebase_uid text NOT NULL,
      event_type text NOT NULL, summary text NOT NULL, created_at text NOT NULL
    );
    CREATE TABLE trade_crm_quotes (
      id text PRIMARY KEY, work_order_id text NOT NULL, firebase_uid text NOT NULL,
      crm_customer_id text NOT NULL, service_site_id text NOT NULL,
      quote_number text NOT NULL, current_version_number integer NOT NULL,
      status text NOT NULL, created_at text NOT NULL, updated_at text NOT NULL
    );
    CREATE TABLE trade_crm_quote_versions (
      id text PRIMARY KEY, quote_id text NOT NULL, firebase_uid text NOT NULL,
      version_number integer NOT NULL, status text NOT NULL, acceptance_email text NOT NULL,
      subtotal_cents integer NOT NULL, tax_cents integer NOT NULL, total_cents integer NOT NULL,
      terms text NOT NULL, customer_message text NOT NULL, valid_until text NOT NULL,
      consent_statement text NOT NULL, issued_at text NOT NULL,
      created_at text NOT NULL, updated_at text NOT NULL
    );
    CREATE TABLE trade_crm_appointments (
      id text PRIMARY KEY, work_order_id text NOT NULL, firebase_uid text NOT NULL,
      appointment_type text NOT NULL, title text NOT NULL, starts_at text NOT NULL,
      ends_at text NOT NULL, assignee_member_id text NOT NULL, assignee_label text NOT NULL,
      status text NOT NULL, revision integer NOT NULL, created_at text NOT NULL
    );
    CREATE TABLE trade_crm_job_media (
      id text PRIMARY KEY, work_order_id text NOT NULL, firebase_uid text NOT NULL,
      category text NOT NULL, file_name text NOT NULL, content_type text NOT NULL,
      size_bytes integer NOT NULL, object_key text NOT NULL UNIQUE, caption text NOT NULL,
      source text NOT NULL DEFAULT 'installer', photo_request_id text NOT NULL DEFAULT '',
      photo_requirement_id text NOT NULL DEFAULT '', request_revision integer NOT NULL DEFAULT 0,
      checklist_version text NOT NULL DEFAULT '', customer_acknowledged_at text NOT NULL DEFAULT '',
      evidence_envelope text NOT NULL DEFAULT '{}', original_sha256 text NOT NULL DEFAULT '',
      created_at text NOT NULL, updated_at text NOT NULL
    );
    CREATE TABLE trade_team_members (
      id text PRIMARY KEY, owner_uid text NOT NULL, member_uid text NOT NULL,
      status text NOT NULL
    );
  `);
  applyMigration(database, acceptedDisclosureMigration);
  applyMigration(database, acceptedJobFilesMigration);
  const now = "2026-08-12T01:00:00.000Z";
  const matchId = "39c16039-4acd-4664-a2e5-3d8ad0dd7dd6";
  const reference = "AEA-20260812-0011223344556677";
  const disclosedFields = JSON.stringify([
    "customer_address",
    "customer_email",
    "customer_message",
    "customer_name",
    "postcode",
    "service_categories",
  ]);
  database.prepare(`INSERT INTO trade_opportunities VALUES
    ('opportunity-1', 'Heat-pump hot-water quote', 'Replace the existing hot-water unit.',
     'standard', ?, '3000', 'VIC', 'open', '2099-08-12T00:00:00.000Z')`).run(reference);
  database.prepare(`INSERT INTO trade_opportunity_matches
    (id, opportunity_id, firebase_uid, status, matched_categories, updated_at) VALUES
    (?, 'opportunity-1', 'trade-a', 'interested', '["hot-water"]', ?)`).run(matchId, now);
  database.prepare(`INSERT INTO public_trade_lead_contact_releases VALUES
    ('release-1', 'opportunity-1', ?, 'active', '', ?, 'Private', 'Name',
     'customer@example.com', '0400000000', 'Unit 9', '1 Disclosed Street',
     'Melbourne', 'VIC', '3000', 'Please quote the selected work.', ?, ?, ?, ?,
     '{"fullPlan":"must never be copied"}')`).run(
    reference,
    disclosedFields,
    PUBLIC_PLAN_CONSENT_NOTICE_VERSION,
    PUBLIC_PLAN_CONSENT_PURPOSE,
    now,
    now,
  );
  database.prepare(`INSERT INTO public_trade_lead_quote_preparations VALUES
    ('preparation-1', 'opportunity-1', ?, 'active', 'quote-preparation-v1', ?, ?, ?, '', ?,
     '[{"questionId":"timing","label":"When would you like the work done?","answer":"Within 3 months","services":["hot-water"]}]', '[]')`).run(
    reference,
    PUBLIC_PLAN_QUOTE_PHOTO_NOTICE_VERSION,
    PUBLIC_PLAN_QUOTE_PHOTO_PURPOSE,
    now,
    now,
  );
  database.prepare("INSERT INTO trade_accounts VALUES ('trade-a', 'installer', 'Thanks for your enquiry.', 'Standard terms.')").run();
  database.prepare(`INSERT INTO trade_crm_enquiries
    (id, firebase_uid, source_type, source_reference, opportunity_match_id, status, record_status, updated_at)
    VALUES (?, 'trade-a', 'tlink_marketplace', ?, ?, 'new', 'active', ?)`).run(
    `marketplace-${matchId}`,
    matchId,
    matchId,
    now,
  );
  return { database, db: testD1(database), matchId, now };
}

const evidenceObjects = new Map();
const workflowServer = loadTypescriptModule(
  "../src/lib/public-lead-quote-workflow-server.ts",
  {
    "@/lib/public-plan-enquiry.mjs": { publicPlanContactReleaseAccessSql },
    "@/lib/public-plan-quote-preparation.mjs": {
      PUBLIC_PLAN_QUOTE_PHOTO_NOTICE_VERSION,
      PUBLIC_PLAN_QUOTE_PHOTO_PURPOSE,
      strictPublicPlanQuoteServiceCategories,
    },
    "@/lib/customer-project-evidence-bucket": {
      getCustomerProjectEvidenceBucket: () => ({
        get: async (key) => evidenceObjects.has(key) ? {
          arrayBuffer: async () => evidenceObjects.get(key).slice(0),
        } : null,
        put: async (key, bytes) => { evidenceObjects.set(key, bytes.slice(0)); },
        delete: async (key) => { evidenceObjects.delete(key); },
      }),
    },
    "@/lib/public-lead-quote-workflow.mjs": {
      publicLeadAcceptedDisclosure,
      publicLeadQuoteWorkflowIds,
      publicLeadQuoteWorkflowSnapshot,
    },
    "@/lib/trade-job-number-server": {
      nextTlinkJobNumber: async () => "JOB-0001",
    },
  },
);

function exactTemplate(source, pattern, label) {
  const match = source.match(pattern);
  assert.ok(match?.[1], `${label} SQL must be extractable`);
  return match[1];
}

test("Interested persists only disclosed customer context and survives later marketplace withdrawal", async () => {
  const { database, db, matchId, now } = workflowFixture();
  const ids = publicLeadQuoteWorkflowIds(matchId);
  assert.equal(database.prepare("SELECT COUNT(*) count FROM trade_crm_customers").get().count, 0,
    "no durable CRM customer exists before acceptance");

  const created = await workflowServer.startPublicLeadQuoteWorkflow(db, "trade-a", matchId, now);
  assert.deepEqual(created, {
    workOrderId: ids.workOrderId,
    workNumber: "JOB-0001",
    customerId: ids.customerId,
    quoteId: ids.quoteId,
    quoteVersionId: ids.quoteVersionId,
    replayed: false,
  });
  const customer = database.prepare(`SELECT first_name, last_name, email, phone,
    address_line_1, address_line_2, suburb, address_state, postcode
    FROM trade_crm_customers WHERE id = ?`).get(ids.customerId);
  assert.deepEqual({ ...customer }, {
    first_name: "Private",
    last_name: "Name",
    email: "customer@example.com",
    phone: "",
    address_line_1: "1 Disclosed Street",
    address_line_2: "Unit 9",
    suburb: "Melbourne",
    address_state: "VIC",
    postcode: "3000",
  }, "raw phone remains absent because the customer did not disclose that field");
  const site = database.prepare(`SELECT site_label, address_line_1, address_line_2,
    suburb, address_state, postcode FROM trade_crm_service_sites WHERE id = ?`).get(ids.serviceSiteId);
  assert.deepEqual({ ...site }, {
    site_label: "Customer property",
    address_line_1: "1 Disclosed Street",
    address_line_2: "Unit 9",
    suburb: "Melbourne",
    address_state: "VIC",
    postcode: "3000",
  });
  const detail = database.prepare(`SELECT * FROM trade_crm_job_details
    WHERE work_order_id = ?`).get(ids.workOrderId);
  const accepted = JSON.parse(detail.accepted_disclosure_snapshot);
  assert.equal(accepted.contract, "tlink-public-lead-accepted-disclosure-v1");
  assert.equal(accepted.customer.phone, "");
  assert.equal(accepted.customer.message, "Please quote the selected work.");
  assert.equal(JSON.stringify(accepted).includes("must never be copied"), false);
  assert.match(detail.accepted_disclosure_sha256, /^[0-9a-f]{64}$/);
  assert.equal(database.prepare("SELECT COUNT(*) count FROM trade_crm_quotes").get().count, 1);
  assert.equal(database.prepare("SELECT COUNT(*) count FROM trade_crm_quote_versions WHERE status = 'draft'").get().count, 1);

  database.prepare(`UPDATE public_trade_lead_contact_releases
    SET status = 'withdrawn', withdrawn_at = '2026-08-12T02:00:00.000Z',
      updated_at = '2026-08-12T02:00:00.000Z' WHERE id = 'release-1'`).run();
  database.prepare("UPDATE trade_opportunity_matches SET status = 'closed' WHERE id = ?").run(matchId);
  database.prepare("UPDATE trade_opportunities SET status = 'expired', expires_at = '2026-08-12T02:00:00.000Z'").run();

  const replay = await workflowServer.startPublicLeadQuoteWorkflow(
    db,
    "trade-a",
    matchId,
    "2026-08-12T03:00:00.000Z",
  );
  assert.equal(replay.replayed, true);
  assert.equal(database.prepare("SELECT COUNT(*) count FROM trade_crm_customers").get().count, 1);

  const quoteSql = exactTemplate(
    quoteRoute,
    /async function directJob[\s\S]*?prepare\(`([\s\S]*?)`\)/,
    "direct accepted quote job",
  );
  assert.equal(database.prepare(quoteSql).get(ids.workOrderId, "trade-a").customer_email,
    "customer@example.com", "quote context is independent of the withdrawn release");
  const invoiceSlice = quickInvoiceRoute.slice(quickInvoiceRoute.indexOf('action === "create_draft"'));
  const invoiceJobSql = exactTemplate(
    invoiceSlice,
    /const job = await db\.prepare\(`([\s\S]*?)`\)/,
    "accepted quick invoice job",
  );
  assert.equal(database.prepare(invoiceJobSql).get(ids.workOrderId, "trade-a").crm_customer_id,
    ids.customerId, "invoice context accepts the persisted public lead customer");

  database.prepare(`INSERT INTO trade_crm_appointments VALUES
    ('appointment-1', ?, 'trade-a', 'site_visit', 'Customer site visit',
     '2026-08-13T09:00', '2026-08-13T10:00', 'member-1', 'Installer One',
     'scheduled', 1, '2026-08-12T01:00:00.000Z')`).run(ids.workOrderId);
  const appointmentSql = exactTemplate(
    scheduleRoute,
    /db\.prepare\(`(SELECT a\.id, a\.work_order_id[\s\S]*?ORDER BY a\.starts_at, a\.created_at)`\)/,
    "accepted lead schedule",
  );
  const scheduled = database.prepare(appointmentSql).get(
    "trade-a",
    "2026-08-20T00:00",
    "2026-08-12T00:00",
    0,
    "member-1",
  );
  assert.equal(scheduled.customer_first_name, "Private");
  assert.equal(scheduled.suburb, "Melbourne");

  const accessGuard = publicLeadIssueAccessGuard("trade-a", {
    id: ids.workOrderId,
    public_lead_enquiry: 1,
    accepted_disclosure_sha256: detail.accepted_disclosure_sha256,
  });
  assert.ok(database.prepare(`SELECT 1 held WHERE ${accessGuard.sql}`)
    .get(...accessGuard.bindings), "quote issue remains tied to the immutable accepted snapshot");
  assert.throws(() => database.prepare(`UPDATE trade_crm_job_details
    SET accepted_disclosure_snapshot = '{}' WHERE work_order_id = ?`).run(ids.workOrderId),
  /accepted public lead disclosure is immutable/);
  assert.throws(() => database.prepare(`UPDATE trade_crm_job_details
    SET customer_source = 'trade_owned' WHERE work_order_id = ?`).run(ids.workOrderId),
  /accepted public lead disclosure is immutable/);

  assert.match(crmRoute, /const protectedCustomer = String\(row\.customer_source \|\| ""\) === "platform_private"/);
  assert.doesNotMatch(quoteSql, /trade_opportunit|public_trade_lead_contact_releases/);
  assert.doesNotMatch(quoteDocumentServer, /public_trade_lead_contact_releases|trade_opportunity_matches/);
  database.close();
});

test("Interested copies every active customer photo into immutable canonical job Files", async () => {
  const { database, db, matchId, now } = workflowFixture();
  const bytes = new TextEncoder().encode("accepted customer photo").buffer;
  const sha256 = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map((value) => value.toString(16).padStart(2, "0")).join("");
  database.prepare(`UPDATE public_trade_lead_quote_preparations
    SET photo_prompt_ids = '["hot-water-unit"]' WHERE id = 'preparation-1'`).run();
  database.prepare(`INSERT INTO public_trade_lead_quote_photos
    (id, opportunity_id, prompt_id, prompt_label, service_categories, content_type,
     size_bytes, object_key, sha256, privacy_status, status, created_at)
    VALUES ('photo-1', 'opportunity-1', 'hot-water-unit', 'Existing hot-water unit',
      '["hot-water"]', 'image/jpeg', ?, 'public/source/photo-1', ?,
      'metadata-stripped', 'active', ?)`).run(bytes.byteLength, sha256, now);
  evidenceObjects.set("public/source/photo-1", bytes);

  const created = await workflowServer.startPublicLeadQuoteWorkflow(db, "trade-a", matchId, now);
  const media = database.prepare(`SELECT id, work_order_id, source, original_sha256,
    accepted_lead_source_photo_id, object_key FROM trade_crm_job_media`).get();
  assert.equal(media.work_order_id, created.workOrderId);
  assert.equal(media.source, "accepted_public_lead");
  assert.equal(media.accepted_lead_source_photo_id, "photo-1");
  assert.equal(media.original_sha256, sha256);
  assert.equal(evidenceObjects.has(media.object_key), true);
  const manifest = JSON.parse(database.prepare(`SELECT accepted_disclosure_snapshot snapshot
    FROM trade_crm_job_details WHERE work_order_id = ?`).get(created.workOrderId).snapshot);
  assert.deepEqual(manifest.photos.map((photo) => photo.sourcePhotoId), ["photo-1"]);

  database.prepare("DELETE FROM public_trade_lead_quote_photos WHERE id = 'photo-1'").run();
  evidenceObjects.delete("public/source/photo-1");
  database.prepare("UPDATE public_trade_lead_quote_preparations SET status = 'withdrawn', withdrawn_at = ?")
    .run("2026-08-12T02:00:00.000Z");
  const replay = await workflowServer.startPublicLeadQuoteWorkflow(db, "trade-a", matchId,
    "2026-08-12T03:00:00.000Z");
  assert.equal(replay.replayed, true);
  assert.equal(database.prepare("SELECT COUNT(*) count FROM trade_crm_job_media").get().count, 1);
  assert.equal(evidenceObjects.has(media.object_key), true,
    "canonical job bytes remain after source withdrawal and deletion");
  assert.throws(() => database.prepare("DELETE FROM trade_crm_job_media WHERE id = ?").run(media.id),
    /retained with job history/);
  database.close();
});

test("the same lead creates independent tenant-owned jobs and files for each interested company", async () => {
  const { database, db, matchId, now } = workflowFixture();
  const secondMatchId = "49c16039-4acd-4664-a2e5-3d8ad0dd7dd6";
  database.prepare(`INSERT INTO trade_opportunity_matches
    (id, opportunity_id, firebase_uid, status, matched_categories, updated_at)
    VALUES (?, 'opportunity-1', 'trade-b', 'interested', '["hot-water"]', ?)`)
    .run(secondMatchId, now);
  database.prepare("INSERT INTO trade_accounts VALUES ('trade-b', 'installer', 'Hello.', 'Terms.')").run();
  database.prepare(`INSERT INTO trade_crm_enquiries
    (id, firebase_uid, source_type, source_reference, opportunity_match_id, status, record_status, updated_at)
    VALUES (?, 'trade-b', 'tlink_marketplace', ?, ?, 'new', 'active', ?)`)
    .run(`marketplace-${secondMatchId}`, secondMatchId, secondMatchId, now);
  const bytes = new TextEncoder().encode("shared source, tenant copies").buffer;
  const sha256 = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map((value) => value.toString(16).padStart(2, "0")).join("");
  database.prepare(`UPDATE public_trade_lead_quote_preparations
    SET photo_prompt_ids = '["hot-water-unit"]' WHERE id = 'preparation-1'`).run();
  database.prepare(`INSERT INTO public_trade_lead_quote_photos
    (id, opportunity_id, prompt_id, prompt_label, service_categories, content_type,
     size_bytes, object_key, sha256, privacy_status, status, created_at)
    VALUES ('photo-shared', 'opportunity-1', 'hot-water-unit', 'Existing unit',
      '["hot-water"]', 'image/jpeg', ?, 'public/source/shared', ?,
      'metadata-stripped', 'active', ?)`).run(bytes.byteLength, sha256, now);
  evidenceObjects.set("public/source/shared", bytes);

  const first = await workflowServer.startPublicLeadQuoteWorkflow(db, "trade-a", matchId, now);
  const second = await workflowServer.startPublicLeadQuoteWorkflow(db, "trade-b", secondMatchId, now);
  for (const key of ["workOrderId", "customerId", "quoteId", "quoteVersionId"]) {
    assert.notEqual(first[key], second[key], `${key} is scoped to the exact tenant match`);
  }
  const media = database.prepare(`SELECT id, firebase_uid, work_order_id, object_key
    FROM trade_crm_job_media ORDER BY firebase_uid`).all();
  assert.equal(media.length, 2);
  assert.deepEqual(media.map((row) => row.firebase_uid), ["trade-a", "trade-b"]);
  assert.notEqual(media[0].id, media[1].id);
  assert.notEqual(media[0].object_key, media[1].object_key);
  assert.equal(media[0].work_order_id, first.workOrderId);
  assert.equal(media[1].work_order_id, second.workOrderId);
  assert.equal(evidenceObjects.has(media[0].object_key), true);
  assert.equal(evidenceObjects.has(media[1].object_key), true);
  assert.equal((await workflowServer.startPublicLeadQuoteWorkflow(db, "trade-a", matchId, now)).replayed, true);
  assert.equal((await workflowServer.startPublicLeadQuoteWorkflow(db, "trade-b", secondMatchId, now)).replayed, true);
  assert.equal(database.prepare("SELECT COUNT(*) count FROM trade_work_orders").get().count, 2);
  database.close();
});

test("accepted disclosure migration rejects missing, mutable and malformed snapshots", () => {
  const database = new DatabaseSync(":memory:");
  database.exec(`CREATE TABLE trade_crm_job_details (
    id text PRIMARY KEY, work_order_id text NOT NULL, firebase_uid text NOT NULL,
    customer_source text NOT NULL
  )`);
  applyMigration(database, acceptedDisclosureMigration);
  assert.throws(() => database.prepare(`INSERT INTO trade_crm_job_details
    (id, work_order_id, firebase_uid, customer_source)
    VALUES ('detail-1', 'job-1', 'owner-1', 'public_lead_released')`).run(),
  /accepted public lead disclosure required/);
  assert.throws(() => database.prepare(`INSERT INTO trade_crm_job_details
    (id, work_order_id, firebase_uid, customer_source,
     accepted_disclosure_snapshot, accepted_disclosure_sha256, accepted_disclosure_at)
    VALUES ('detail-2', 'job-2', 'owner-1', 'public_lead_released',
      '{"contract":"wrong"}', ?, '2026-08-12T01:00:00.000Z')`).run("a".repeat(64)),
  /accepted public lead disclosure required/);
  database.close();
});
