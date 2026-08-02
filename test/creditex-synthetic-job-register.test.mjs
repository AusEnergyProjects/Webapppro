import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  CREDITEX_SYNTHETIC_REGISTER_CONTRACT_VERSION,
  CreditexSyntheticRegisterError,
  loadCreditexSyntheticJobRegister,
  parseCreditexSyntheticRegisterFilters,
} from "../src/lib/creditex-synthetic-job-register-server.ts";

const read = (path) =>
  fs.readFileSync(new URL(path, import.meta.url), "utf8");
const serverSource = read(
  "../src/lib/creditex-synthetic-job-register-server.ts",
);
const routeSource = read(
  "../src/app/api/creditex/synthetic-job-register/route.ts",
);
const migration = read(
  "../drizzle/0113_creditex_synthetic_register.sql",
);

const exactDataforceHeaders = [
  "App Id",
  "Job Id",
  "Status",
  "SubStatus",
  "Type",
  "Work Type",
  "Scheduled Datetime",
  "Balance",
  "Certificates (VEECs)",
  "Submission",
  "Invoiced",
  "Field Worker",
  "Agent",
  "Client",
  "Customer",
  "Company Name",
  "Ext Cust Ref",
  "Phone",
  "Mobile",
  "Email",
  "Address",
  "Suburb",
  "Postcode",
];

class ReadOnlyD1Statement {
  constructor(database, metrics, sql, values = []) {
    this.database = database;
    this.metrics = metrics;
    this.sql = sql;
    this.values = values;
  }

  bind(...values) {
    assert.ok(
      values.length <= 100,
      `Register query exceeded the D1 binding limit: ${values.length}`,
    );
    return new ReadOnlyD1Statement(
      this.database,
      this.metrics,
      this.sql,
      values,
    );
  }

  async first() {
    this.metrics.statements.push(this.sql);
    assert.match(
      this.sql.trim(),
      /^(?:WITH|SELECT)\b/i,
      "Synthetic register statements must remain read-only",
    );
    return this.database.prepare(this.sql).get(...this.values) || null;
  }

  async all() {
    this.metrics.statements.push(this.sql);
    assert.match(
      this.sql.trim(),
      /^(?:WITH|SELECT)\b/i,
      "Synthetic register statements must remain read-only",
    );
    return {
      results: this.database.prepare(this.sql).all(...this.values),
    };
  }

  async run() {
    assert.fail("The synthetic register must not execute write statements");
  }
}

function readOnlyD1(database) {
  const metrics = { statements: [] };
  return {
    metrics,
    prepare(sql) {
      return new ReadOnlyD1Statement(database, metrics, sql);
    },
  };
}

function setupDatabase() {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE compliance_pilot_runs (
      id text PRIMARY KEY NOT NULL,
      organisation_id text NOT NULL,
      program_code text NOT NULL,
      record_mode text NOT NULL,
      status text NOT NULL,
      updated_at text NOT NULL
    );
    CREATE TABLE compliance_pilot_installers (
      id text PRIMARY KEY NOT NULL,
      pilot_run_id text NOT NULL,
      trade_account_uid text NOT NULL,
      business_name text NOT NULL
    );
    CREATE TABLE compliance_pilot_technicians (
      id text PRIMARY KEY NOT NULL,
      pilot_run_id text NOT NULL,
      installer_id text NOT NULL,
      display_name text NOT NULL
    );
    CREATE TABLE compliance_pilot_jobs (
      id text PRIMARY KEY NOT NULL,
      pilot_run_id text NOT NULL,
      installer_id text NOT NULL,
      technician_id text NOT NULL,
      work_order_id text NOT NULL,
      job_number text NOT NULL,
      activity_template_id text NOT NULL,
      title text NOT NULL,
      record_mode text NOT NULL,
      connector_status text NOT NULL,
      review_status text NOT NULL,
      evidence_status text NOT NULL,
      created_at text NOT NULL,
      updated_at text NOT NULL
    );
    CREATE TABLE trade_work_orders (
      id text PRIMARY KEY NOT NULL,
      firebase_uid text NOT NULL,
      work_type text NOT NULL,
      source_type text NOT NULL,
      source_reference text NOT NULL,
      revision integer NOT NULL,
      record_status text NOT NULL
    );
    CREATE TABLE trade_crm_job_details (
      id text PRIMARY KEY NOT NULL,
      work_order_id text NOT NULL,
      firebase_uid text NOT NULL,
      crm_customer_id text NOT NULL,
      service_site_id text NOT NULL,
      invoice_status text NOT NULL
    );
    CREATE TABLE trade_crm_customers (
      id text PRIMARY KEY NOT NULL,
      firebase_uid text NOT NULL,
      customer_number text NOT NULL,
      first_name text NOT NULL,
      last_name text NOT NULL,
      business_name text NOT NULL,
      email text NOT NULL,
      phone text NOT NULL,
      record_status text NOT NULL
    );
    CREATE TABLE trade_crm_service_sites (
      id text PRIMARY KEY NOT NULL,
      firebase_uid text NOT NULL,
      address_line_1 text NOT NULL,
      address_line_2 text NOT NULL,
      suburb text NOT NULL,
      postcode text NOT NULL,
      record_status text NOT NULL
    );
    CREATE TABLE trade_crm_appointments (
      id text PRIMARY KEY NOT NULL,
      work_order_id text NOT NULL,
      firebase_uid text NOT NULL,
      starts_at text NOT NULL
    );
    CREATE TABLE compliance_manual_evidence_test_jobs (
      id text PRIMARY KEY NOT NULL,
      organisation_id text NOT NULL,
      program_code text NOT NULL,
      activity_template_id text NOT NULL,
      activity_snapshot text NOT NULL,
      job_number text NOT NULL,
      installer_id text NOT NULL,
      installer_label text NOT NULL,
      technician_id text NOT NULL,
      technician_label text NOT NULL,
      customer_label text NOT NULL,
      site_postcode text NOT NULL,
      status text NOT NULL,
      record_mode text NOT NULL,
      revision integer NOT NULL,
      created_at text NOT NULL,
      updated_at text NOT NULL
    );
    CREATE TABLE compliance_cases (id text PRIMARY KEY NOT NULL);
    CREATE TABLE compliance_evidence_objects (id text PRIMARY KEY NOT NULL);
    CREATE TABLE compliance_submission_batches (id text PRIMARY KEY NOT NULL);
    CREATE TABLE compliance_submission_items (id text PRIMARY KEY NOT NULL);
    CREATE TABLE compliance_certificate_lots (id text PRIMARY KEY NOT NULL);
    CREATE TABLE compliance_trades (id text PRIMARY KEY NOT NULL);
    CREATE TABLE compliance_settlements (id text PRIMARY KEY NOT NULL);
  `);
  database.exec(migration);

  database.exec(`
    INSERT INTO compliance_pilot_runs
      (id, organisation_id, program_code, record_mode, status, updated_at)
    VALUES
      ('run-veu', 'org-1', 'VEU', 'synthetic_test', 'active',
        '2026-08-03T00:00:00.000Z'),
      ('run-other-org', 'org-2', 'VEU', 'synthetic_test', 'active',
        '2026-08-03T00:00:00.000Z'),
      ('run-not-synthetic', 'org-1', 'VEU', 'regulated', 'active',
        '2026-08-03T00:00:00.000Z');

    INSERT INTO compliance_pilot_installers
      (id, pilot_run_id, trade_account_uid, business_name)
    VALUES
      ('pilot-installer', 'run-veu', 'trade-1', '[TEST] VEU Installer'),
      ('other-installer', 'run-other-org', 'trade-2', '[TEST] Other'),
      ('unsafe-installer', 'run-not-synthetic', 'trade-3', 'Unsafe');

    INSERT INTO compliance_pilot_technicians
      (id, pilot_run_id, installer_id, display_name)
    VALUES
      ('pilot-tech', 'run-veu', 'pilot-installer',
        '[TEST] VEU Technician'),
      ('other-tech', 'run-other-org', 'other-installer', '[TEST] Other'),
      ('unsafe-tech', 'run-not-synthetic', 'unsafe-installer', 'Unsafe');

    INSERT INTO compliance_pilot_jobs
      (id, pilot_run_id, installer_id, technician_id, work_order_id,
        job_number, activity_template_id, title, record_mode,
        connector_status, review_status, evidence_status, created_at,
        updated_at)
    VALUES
      ('pilot-job', 'run-veu', 'pilot-installer', 'pilot-tech',
        'work-veu', 'VEU-100', 'veu:1', 'VEU test activity',
        'synthetic_test', 'dry_run_only', 'test_ready', 'not_started',
        '2026-08-01T00:00:00.000Z', '2026-08-03T01:00:00.000Z'),
      ('other-job', 'run-other-org', 'other-installer', 'other-tech',
        'work-other', 'VEU-OTHER', 'veu:1', 'Other organisation',
        'synthetic_test', 'not_staged', 'test_ready', 'not_started',
        '2026-08-01T00:00:00.000Z', '2026-08-03T01:00:00.000Z'),
      ('unsafe-job', 'run-not-synthetic', 'unsafe-installer',
        'unsafe-tech', 'work-unsafe', 'VEU-UNSAFE', 'veu:1',
        'Unsafe record', 'synthetic_test', 'not_staged', 'test_ready',
        'not_started', '2026-08-01T00:00:00.000Z',
        '2026-08-03T01:00:00.000Z');

    INSERT INTO trade_work_orders
      (id, firebase_uid, work_type, source_type, source_reference,
        revision, record_status)
    VALUES
      ('work-veu', 'trade-1', 'Unique service work', 'synthetic_pilot',
        'run-veu', 4,
        'active'),
      ('work-other', 'trade-2', 'job', 'synthetic_pilot',
        'run-other-org', 1, 'active'),
      ('work-unsafe', 'trade-3', 'job', 'synthetic_pilot',
        'run-not-synthetic', 1, 'active');

    INSERT INTO trade_crm_job_details
      (id, work_order_id, firebase_uid, crm_customer_id, service_site_id,
        invoice_status)
    VALUES
      ('detail-1', 'work-veu', 'trade-1', 'customer-1', 'site-1',
        'not_started');

    INSERT INTO trade_crm_customers
      (id, firebase_uid, customer_number, first_name, last_name,
        business_name, email, phone, record_status)
    VALUES
      ('customer-1', 'trade-1', 'C-100', 'Alex', 'Citizen',
        'Unique Pilot Company',
        'alex@example.test', '0400000000', 'active');

    INSERT INTO trade_crm_service_sites
      (id, firebase_uid, address_line_1, address_line_2, suburb, postcode,
        record_status)
    VALUES
      ('site-1', 'trade-1', '1 Test Street', '', 'Melbourne', '3000',
        'active');

    INSERT INTO trade_crm_appointments
      (id, work_order_id, firebase_uid, starts_at)
    VALUES
      ('appointment-old', 'work-veu', 'trade-1',
        '2026-08-02T09:00:00.000Z'),
      ('appointment-latest', 'work-veu', 'trade-1',
        '2026-08-04T09:00:00.000Z');

    INSERT INTO compliance_manual_evidence_test_jobs
      (id, organisation_id, program_code, activity_template_id,
        activity_snapshot, job_number, installer_id, installer_label,
        technician_id, technician_label, customer_label, site_postcode,
        status, record_mode, revision, created_at, updated_at)
    VALUES
      ('manual-sres', 'org-1', 'SRES', 'sres:hot-water',
        '{"activity":{"title":"Heat pump water heater"}}',
        'MANUAL-SRES-1', 'manual-installer', '[TEST] Manual Installer',
        'manual-tech', '[TEST] Manual Technician', '[TEST] Customer One',
        '3121', 'field_testing', 'synthetic_test', 2,
        '2026-08-02T00:00:00.000Z', '2026-08-03T02:00:00.000Z'),
      ('manual-veu', 'org-1', 'VEU', 'veu:water-heating',
        '{"activity":{"title":"VEU water heating"}}',
        'MANUAL-VEU-1', 'manual-installer', '[TEST] Manual Installer',
        'manual-tech', '[TEST] Manual Technician', '[TEST] Customer Two',
        '3000', 'ready_for_audit', 'synthetic_test', 3,
        '2026-08-02T00:00:00.000Z', '2026-08-03T03:00:00.000Z'),
      ('manual-other-org', 'org-2', 'SRES', 'sres:hot-water',
        '{"activity":{"title":"Other organisation"}}',
        'MANUAL-OTHER', 'other', 'Other', 'other-tech', 'Other',
        'Other Customer', '2000', 'draft', 'synthetic_test', 1,
        '2026-08-02T00:00:00.000Z', '2026-08-03T03:00:00.000Z'),
      ('manual-not-synthetic', 'org-1', 'SRES', 'sres:unsafe',
        '{"activity":{"title":"Unsafe activity"}}',
        'MANUAL-UNSAFE', 'unsafe', 'Unsafe', 'unsafe-tech', 'Unsafe',
        'Unsafe Customer', '3000', 'draft', 'regulated', 1,
        '2026-08-02T00:00:00.000Z', '2026-08-03T03:00:00.000Z');

    INSERT INTO compliance_cases (id) VALUES ('regulated-case');
    INSERT INTO compliance_evidence_objects (id) VALUES ('regulated-evidence');
    INSERT INTO compliance_submission_batches (id) VALUES ('regulated-batch');
    INSERT INTO compliance_submission_items (id) VALUES ('regulated-item');
    INSERT INTO compliance_certificate_lots (id) VALUES ('regulated-lot');
    INSERT INTO compliance_trades (id) VALUES ('regulated-trade');
    INSERT INTO compliance_settlements (id) VALUES ('regulated-settlement');
  `);
  return database;
}

const member = {
  organisationId: "org-1",
};

function filters(values = {}) {
  return parseCreditexSyntheticRegisterFilters(
    new URLSearchParams(values),
  );
}

function regulatedCounts(database) {
  return Object.fromEntries([
    "compliance_cases",
    "compliance_evidence_objects",
    "compliance_submission_batches",
    "compliance_submission_items",
    "compliance_certificate_lots",
    "compliance_trades",
    "compliance_settlements",
  ].map((tableName) => [
    tableName,
    database.prepare(`SELECT COUNT(*) AS total FROM ${tableName}`).get()
      .total,
  ]));
}

test("unified register projects exact Dataforce cells without crossing synthetic boundaries", async () => {
  const database = setupDatabase();
  const d1 = readOnlyD1(database);
  const before = regulatedCounts(database);

  const register = await loadCreditexSyntheticJobRegister(
    d1,
    member,
    filters(),
  );

  assert.equal(
    register.contractVersion,
    CREDITEX_SYNTHETIC_REGISTER_CONTRACT_VERSION,
  );
  assert.deepEqual(register.headers, exactDataforceHeaders);
  assert.equal(register.headers.length, 23);
  assert.equal(register.pagination.total, 3);
  assert.equal(register.rows.length, 3);
  assert.deepEqual(
    register.rows.map((row) => row.cells["Job Id"]),
    ["MANUAL-SRES-1", "MANUAL-VEU-1", "VEU-100"],
  );
  assert.ok(
    register.rows.every(
      (row) =>
        Object.keys(row.cells).length === 23
        && Object.keys(row.cells).every(
          (header, index) => header === exactDataforceHeaders[index],
        ),
    ),
  );

  const manual = register.rows.find(
    (row) => row.sourceId === "manual-sres",
  );
  assert.ok(manual);
  assert.equal(manual.rowKey, "manual_evidence:manual-sres");
  assert.equal(manual.source, "manual_evidence");
  assert.equal(manual.recordMode, "synthetic_test");
  assert.equal(manual.programCode, "SRES");
  assert.equal(manual.cells.Status, "Field Testing");
  assert.equal(manual.cells["Work Type"], "Heat pump water heater");
  assert.equal(manual.cells["Field Worker"], "[TEST] Manual Technician");
  assert.equal(manual.cells.Customer, "[TEST] Customer One");
  assert.equal(manual.cells.Postcode, "3121");
  for (const header of [
    "App Id",
    "SubStatus",
    "Type",
    "Scheduled Datetime",
    "Balance",
    "Certificates (VEECs)",
    "Submission",
    "Invoiced",
    "Agent",
    "Client",
    "Company Name",
    "Ext Cust Ref",
    "Phone",
    "Mobile",
    "Email",
    "Address",
    "Suburb",
  ]) {
    assert.equal(manual.cells[header], "", `${header} must remain blank`);
  }

  const pilot = register.rows.find((row) => row.sourceId === "pilot-job");
  assert.ok(pilot);
  assert.equal(pilot.rowKey, "veu_pilot:pilot-job");
  assert.equal(pilot.cells["App Id"], "appointment-latest");
  assert.equal(pilot.cells.Status, "Test Ready");
  assert.equal(pilot.cells["Certificates (VEECs)"],
    "Blocked: no issued VEECs");
  assert.equal(pilot.cells.Customer, "Alex Citizen");
  assert.equal(pilot.cells.Address, "1 Test Street");

  assert.deepEqual(regulatedCounts(database), before);
  assert.equal(register.boundaries.accessMode, "read_only");
  assert.equal(register.boundaries.regulatedWrites, 0);
  assert.ok(d1.metrics.statements.length >= 3);
  assert.ok(d1.metrics.statements.every(
    (sql) => !/\b(?:INSERT|UPDATE|DELETE|REPLACE|CREATE|DROP|ALTER)\b/i
      .test(sql),
  ));
});

test("global query finds every populated value in the exact 23-column register row", async () => {
  const queryStart = serverSource.indexOf("if (filters.query) {");
  const queryEnd = serverSource.indexOf("\n  return {", queryStart);
  assert.ok(queryStart >= 0 && queryEnd > queryStart);
  const querySource = serverSource.slice(queryStart, queryEnd);
  assert.deepEqual(
    Array.from(
      querySource.matchAll(/COALESCE\(([a-z_]+), ''\)/g),
      (match) => match[1],
    ),
    [
      "app_id",
      "job_id",
      "status_cell",
      "sub_status",
      "type_cell",
      "work_type",
      "scheduled_datetime",
      "balance",
      "certificates",
      "submission",
      "invoiced",
      "field_worker",
      "agent",
      "client",
      "customer",
      "company_name",
      "ext_cust_ref",
      "phone",
      "mobile",
      "email",
      "address",
      "suburb",
      "postcode",
    ],
  );

  const database = setupDatabase();
  const d1 = readOnlyD1(database);
  const register = await loadCreditexSyntheticJobRegister(
    d1,
    member,
    filters({ source: "veu_pilot" }),
  );
  const pilot = register.rows.find((row) => row.sourceId === "pilot-job");
  assert.ok(pilot);
  assert.deepEqual(Object.keys(pilot.cells), exactDataforceHeaders);

  const populatedCells = Object.entries(pilot.cells)
    .filter(([, value]) => value !== "");
  assert.deepEqual(
    populatedCells.map(([header]) => header),
    [
      "App Id",
      "Job Id",
      "Status",
      "Work Type",
      "Scheduled Datetime",
      "Certificates (VEECs)",
      "Submission",
      "Invoiced",
      "Field Worker",
      "Customer",
      "Company Name",
      "Ext Cust Ref",
      "Phone",
      "Email",
      "Address",
      "Suburb",
      "Postcode",
    ],
  );

  for (const [header, value] of populatedCells) {
    const result = await loadCreditexSyntheticJobRegister(
      d1,
      member,
      filters({
        source: "veu_pilot",
        query: value,
        pageSize: "25",
      }),
    );
    assert.equal(
      result.pagination.total,
      1,
      `${header} must be included in the global query`,
    );
    assert.equal(
      result.rows[0].sourceId,
      "pilot-job",
      `${header} must resolve the source row`,
    );
  }
});

test("register filters, facets, search, sort and pagination remain source-aware", async () => {
  const database = setupDatabase();
  const d1 = readOnlyD1(database);

  const manualSearch = await loadCreditexSyntheticJobRegister(
    d1,
    member,
    filters({
      source: "manual_evidence",
      programCode: "sres",
      activityTemplateId: "sres:hot-water",
      installerId: "manual-installer",
      technicianId: "manual-tech",
      status: "field_testing",
      postcode: "3121",
      query: "heat pump",
      sortBy: "jobId",
      sortDirection: "desc",
      pageSize: "25",
    }),
  );
  assert.equal(manualSearch.pagination.total, 1);
  assert.equal(manualSearch.rows[0].sourceId, "manual-sres");
  assert.ok(
    manualSearch.facets.sources.some(
      (facet) => facet.value === "manual_evidence",
    ),
  );
  assert.ok(
    manualSearch.facets.sources.some(
      (facet) => facet.value === "veu_pilot",
    ),
  );
  assert.ok(
    manualSearch.facets.programs.some(
      (facet) => facet.value === "SRES",
    ),
  );
  assert.ok(
    manualSearch.facets.activities.some(
      (facet) =>
        facet.value === "sres:hot-water"
        && facet.parentValue === "SRES",
    ),
  );
  assert.ok(
    manualSearch.facets.installers.some(
      (facet) =>
        facet.value === "manual-installer"
        && facet.label === "[TEST] Manual Installer",
    ),
  );
  assert.ok(
    manualSearch.facets.technicians.some(
      (facet) =>
        facet.value === "manual-tech"
        && facet.parentValue === "manual-installer",
    ),
  );
  assert.ok(
    manualSearch.facets.statuses.some(
      (facet) =>
        facet.value === "field_testing"
        && facet.label === "Field Testing",
    ),
  );
  assert.ok(
    manualSearch.facets.postcodes.some(
      (facet) => facet.value === "3121",
    ),
  );

  const insert = database.prepare(`INSERT INTO
      compliance_manual_evidence_test_jobs
      (id, organisation_id, program_code, activity_template_id,
        activity_snapshot, job_number, installer_id, installer_label,
        technician_id, technician_label, customer_label, site_postcode,
        status, record_mode, revision, created_at, updated_at)
    VALUES (?, 'org-1', 'SRES', 'sres:paging',
      '{"activity":{"title":"Paging activity"}}', ?,
      'manual-installer', '[TEST] Manual Installer',
      'manual-tech', '[TEST] Manual Technician', '[TEST] Paging Customer',
      '3121', 'draft', 'synthetic_test', 1,
      '2026-08-03T00:00:00.000Z', '2026-08-03T00:00:00.000Z')`);
  for (let index = 1; index <= 26; index += 1) {
    insert.run(
      `manual-page-${String(index).padStart(2, "0")}`,
      `PAGE-${String(index).padStart(2, "0")}`,
    );
  }
  const secondPage = await loadCreditexSyntheticJobRegister(
    d1,
    member,
    filters({
      source: "manual_evidence",
      activityTemplateId: "sres:paging",
      page: "1",
      pageSize: "25",
      sortBy: "jobId",
      sortDirection: "asc",
    }),
  );
  assert.equal(secondPage.pagination.total, 26);
  assert.equal(secondPage.pagination.pageCount, 2);
  assert.equal(secondPage.pagination.hasPreviousPage, true);
  assert.equal(secondPage.pagination.hasNextPage, false);
  assert.equal(secondPage.rows.length, 1);
  assert.equal(secondPage.rows[0].cells["Job Id"], "PAGE-26");
});

test("filter parser rejects unbounded, unknown and unsafe register controls", () => {
  assert.throws(
    () => filters({ source: "regulated" }),
    (error) =>
      error instanceof CreditexSyntheticRegisterError
      && error.code === "CREDITEX_SYNTHETIC_REGISTER_SOURCE_INVALID",
  );
  assert.throws(
    () => filters({ sortBy: "source" }),
    (error) =>
      error instanceof CreditexSyntheticRegisterError
      && error.code === "CREDITEX_SYNTHETIC_REGISTER_SORT_INVALID",
  );
  assert.throws(
    () => filters({ pageSize: "20000" }),
    (error) =>
      error instanceof CreditexSyntheticRegisterError
      && error.code === "CREDITEX_SYNTHETIC_REGISTER_PAGE_INVALID",
  );
  assert.throws(
    () => filters({ query: `unsafe\u0000query` }),
    (error) =>
      error instanceof CreditexSyntheticRegisterError
      && error.code === "CREDITEX_SYNTHETIC_REGISTER_FILTER_INVALID",
  );
  const all = filters({
    source: "all",
    programCode: "sres",
    sortBy: "postcode",
    sortDirection: "desc",
  });
  assert.equal(all.source, "");
  assert.equal(all.programCode, "SRES");
  assert.equal(all.sortBy, "postcode");
  assert.equal(all.sortDirection, "desc");
});

test("route and migration preserve a read-only, index-only boundary", () => {
  assert.match(routeSource, /export async function GET\(request: Request\)/);
  assert.doesNotMatch(
    routeSource,
    /export async function (?:POST|PUT|PATCH|DELETE)\b/,
  );
  assert.match(routeSource, /allowedRoles:\s*\[[\s\S]*"auditor"/);
  assert.match(routeSource, /Cache-Control": "private, no-store"/);
  assert.match(routeSource, /sameOrigin\(request\)/);

  assert.match(
    serverSource,
    /run\.organisation_id = \?/,
  );
  assert.match(
    serverSource,
    /job\.organisation_id = \?/,
  );
  assert.ok(
    (serverSource.match(/record_mode = 'synthetic_test'/g) || []).length
      >= 3,
  );
  assert.match(serverSource, /work\.source_type = 'synthetic_pilot'/);
  assert.doesNotMatch(
    serverSource,
    /compliance_(?:cases|evidence_objects|submission_batches|submission_items|certificate_lots|trades|settlements)/,
  );

  assert.equal((migration.match(/CREATE INDEX/g) || []).length, 7);
  assert.doesNotMatch(
    migration,
    /\b(?:CREATE TABLE|CREATE TRIGGER|INSERT|UPDATE|DELETE|DROP|ALTER)\b/i,
  );
  for (const indexName of [
    "compliance_manual_evidence_test_job_register_program_idx",
    "compliance_manual_evidence_test_job_register_activity_idx",
    "compliance_manual_evidence_test_job_register_personnel_idx",
    "compliance_manual_evidence_test_job_register_postcode_idx",
    "compliance_manual_evidence_test_job_register_created_idx",
    "compliance_pilot_jobs_register_review_idx",
    "trade_crm_appointments_register_latest_idx",
  ]) {
    assert.match(migration, new RegExp(indexName));
  }

  const database = setupDatabase();
  const programPlan = database.prepare(`EXPLAIN QUERY PLAN
      SELECT id
      FROM compliance_manual_evidence_test_jobs
      WHERE organisation_id = 'org-1'
        AND program_code = 'SRES'
        AND status = 'field_testing'
      ORDER BY updated_at, id`).all()
    .map((row) => String(row.detail))
    .join(" ");
  assert.match(
    programPlan,
    /compliance_manual_evidence_test_job_register_program_idx/,
  );
  const appointmentPlan = database.prepare(`EXPLAIN QUERY PLAN
      SELECT id
      FROM trade_crm_appointments
      WHERE work_order_id = 'work-veu'
        AND firebase_uid = 'trade-1'
      ORDER BY starts_at DESC, id DESC
      LIMIT 1`).all()
    .map((row) => String(row.detail))
    .join(" ");
  assert.match(
    appointmentPlan,
    /trade_crm_appointments_register_latest_idx/,
  );
});
