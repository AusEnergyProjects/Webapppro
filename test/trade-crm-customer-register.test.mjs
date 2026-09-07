import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { keysetAfter } from "../src/lib/keyset-pagination.ts";
import {
  CUSTOMER_DISPLAY_NAME_SQL,
  CUSTOMER_PIPELINE_STATUS_LABEL_SQL,
  CUSTOMER_REGISTER_SORTS,
} from "../src/lib/trade-crm-register-sort-sql.ts";
import { INSTALLER_CUSTOMER_REGISTER_SORT_VALUES } from "../src/lib/trade-crm-register-sorts.ts";

function registerDatabase() {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE customers (
      id TEXT PRIMARY KEY,
      customer_number TEXT NOT NULL,
      business_name TEXT NOT NULL,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      email TEXT NOT NULL,
      phone TEXT NOT NULL,
      suburb TEXT NOT NULL,
      postcode TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE summary (
      customer_id TEXT PRIMARY KEY,
      job_count INTEGER NOT NULL,
      latest_job_at TEXT NOT NULL,
      latest_pipeline_stage TEXT NOT NULL
    );
    INSERT INTO customers VALUES
      ('c1', 'CUS-001', 'Zed Solar', '', '', 'zed@example.test', '0400000001', 'Melbourne', '3000', '2025-10-01', '2026-08-01'),
      ('c2', 'CUS-002', '', 'Amy', 'Able', 'shared@example.test', '0400000002', 'Ballarat', '3350', '2025-11-01', '2026-08-02'),
      ('c3', 'CUS-003', '', 'Ben', 'Baker', 'shared@example.test', '', 'Geelong', '3220', '2025-12-01', '2026-08-03'),
      ('c4', 'CUS-004', '', '', '', '', '', '', '', '2026-01-01', '2026-08-04'),
      ('c5', 'CUS-005', 'Alpha Air', '', '', 'alpha@example.test', '0400000005', 'Adelaide', '5000', '2026-02-01', '2026-08-05'),
      ('c6', 'CUS-006', '', 'Cara', 'Able', '', '0400000006', 'Melbourne', '3000', '2026-03-01', '2026-08-06'),
      ('c7', 'CUS-007', '', 'Amy', 'Able', 'amy@example.test', '0400000007', 'Hobart', '7000', '2026-04-01', '2026-08-07');
    INSERT INTO summary VALUES
      ('c1', 4, '2026-08-20', 'in_progress'),
      ('c2', 1, '2026-08-18', 'approved'),
      ('c3', 1, '2026-08-18', 'paid'),
      ('c5', 2, '2026-08-19', 'enquiry'),
      ('c7', 1, '2026-08-18', 'complete');
  `);
  return database;
}

function pageThrough(database, sortKey, pageSize = 2) {
  const sort = CUSTOMER_REGISTER_SORTS[sortKey];
  const ids = [];
  let cursorValues = null;
  while (true) {
    const cursor = cursorValues ? keysetAfter(sort.terms, cursorValues) : { sql: "1 = 1", bindings: [] };
    const rows = database.prepare(`
      SELECT c.*,
        ${CUSTOMER_DISPLAY_NAME_SQL} customer_display_name_sort,
        trim(c.first_name) = '' first_name_empty,
        trim(c.last_name) = '' last_name_empty,
        trim(c.email) = '' email_empty,
        trim(c.phone) = '' phone_empty,
        trim(c.suburb) = '' suburb_empty,
        trim(c.postcode) = '' postcode_empty,
        COALESCE(js.job_count, 0) job_count,
        COALESCE(js.latest_job_at, '') latest_job_at,
        COALESCE(js.latest_job_at, '') = '' latest_job_empty,
        COALESCE(js.latest_pipeline_stage, '') latest_pipeline_stage,
        COALESCE(js.latest_pipeline_stage, '') = '' customer_status_empty,
        ${CUSTOMER_PIPELINE_STATUS_LABEL_SQL} customer_status_sort
      FROM customers c LEFT JOIN summary js ON js.customer_id = c.id
      WHERE ${cursor.sql}
      ORDER BY ${sort.orderBy}
      LIMIT ?
    `).all(...cursor.bindings, pageSize + 1);
    const page = rows.slice(0, pageSize);
    ids.push(...page.map((row) => row.id));
    if (rows.length <= pageSize) break;
    const last = page.at(-1);
    cursorValues = sort.terms.map((term) => term.numeric ? Number(last[term.rowKey]) : String(last[term.rowKey] || ""));
  }
  return ids;
}

test("every customer register sort pages through ties without duplicates or omissions", () => {
  const database = registerDatabase();
  for (const sortKey of INSTALLER_CUSTOMER_REGISTER_SORT_VALUES) {
    const ids = pageThrough(database, sortKey);
    assert.equal(ids.length, 7, `${sortKey} should return every customer`);
    assert.equal(new Set(ids).size, 7, `${sortKey} should not repeat a customer across pages`);
  }
  database.close();
});

test("customer register text sorts keep blanks last and status follows the displayed label", () => {
  const database = registerDatabase();
  assert.deepEqual(pageThrough(database, "email-asc").slice(-2).sort(), ["c4", "c6"]);
  assert.deepEqual(pageThrough(database, "first-name-asc").slice(-3).sort(), ["c1", "c4", "c5"]);
  assert.deepEqual(pageThrough(database, "latest-job-desc").slice(-2).sort(), ["c4", "c6"]);

  const statusIds = pageThrough(database, "status-asc");
  const statusById = new Map(database.prepare(`SELECT c.id, ${CUSTOMER_PIPELINE_STATUS_LABEL_SQL} label
    FROM customers c LEFT JOIN summary js ON js.customer_id = c.id`).all().map((row) => [row.id, row.label]));
  const populatedLabels = statusIds.map((id) => statusById.get(id)).filter(Boolean);
  assert.deepEqual(populatedLabels, [...populatedLabels].sort((left, right) => left.localeCompare(right, "en-AU")));
  assert.deepEqual(statusIds.slice(-2).sort(), ["c4", "c6"]);
  database.close();
});
