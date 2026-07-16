import { DatabaseSync } from "node:sqlite";
import { performance } from "node:perf_hooks";

const RECORDS_PER_DATASET = 100_000;
const PAGE_SIZE = 25;
const ROUNDS = 30;

function percentile(values, ratio) {
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.min(ordered.length - 1, Math.floor(ordered.length * ratio))];
}

function measure(statement, bindings = [], rounds = ROUNDS) {
  for (let index = 0; index < 5; index += 1) statement.all(...bindings);
  const samples = [];
  for (let index = 0; index < rounds; index += 1) {
    const started = performance.now();
    statement.all(...bindings);
    samples.push(performance.now() - started);
  }
  return {
    p50Ms: Number(percentile(samples, 0.5).toFixed(3)),
    p95Ms: Number(percentile(samples, 0.95).toFixed(3)),
    maximumMs: Number(Math.max(...samples).toFixed(3)),
  };
}

function plan(database, sql, bindings = []) {
  return database.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...bindings).map((row) => String(row.detail));
}

const database = new DatabaseSync(":memory:");
database.exec(`
  PRAGMA journal_mode = MEMORY;
  PRAGMA synchronous = OFF;
  PRAGMA temp_store = MEMORY;
  PRAGMA cache_size = -200000;

  CREATE TABLE digits (value INTEGER PRIMARY KEY);
  INSERT INTO digits VALUES (0), (1), (2), (3), (4), (5), (6), (7), (8), (9);

  CREATE TABLE trade_accounts (
    firebase_uid TEXT PRIMARY KEY,
    business_name TEXT NOT NULL,
    partner_type TEXT NOT NULL,
    account_status TEXT NOT NULL,
    verification_status TEXT NOT NULL,
    billing_status TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX trade_accounts_eligibility_idx ON trade_accounts
    (partner_type, account_status, verification_status, billing_status, firebase_uid);
  CREATE INDEX trade_accounts_admin_type_updated_idx ON trade_accounts
    (partner_type, updated_at, firebase_uid);
  CREATE INDEX trade_accounts_admin_status_updated_idx ON trade_accounts
    (account_status, updated_at, firebase_uid);
  CREATE INDEX trade_accounts_admin_verification_updated_idx ON trade_accounts
    (verification_status, updated_at, firebase_uid);
  CREATE INDEX trade_accounts_business_nocase_idx ON trade_accounts
    (business_name COLLATE NOCASE, firebase_uid);

  CREATE TABLE supplier_products (
    id TEXT PRIMARY KEY,
    firebase_uid TEXT NOT NULL,
    model_number TEXT NOT NULL,
    brand TEXT NOT NULL,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    stock_status TEXT NOT NULL,
    listing_status TEXT NOT NULL,
    review_status TEXT NOT NULL,
    unit_price_cents_ex_gst INTEGER NOT NULL,
    lead_time_days INTEGER NOT NULL
  );
  CREATE INDEX supplier_products_marketplace_name_idx ON supplier_products
    (listing_status, review_status, name COLLATE NOCASE, brand COLLATE NOCASE, model_number COLLATE NOCASE, id);
  CREATE INDEX supplier_products_marketplace_brand_idx ON supplier_products
    (listing_status, review_status, brand COLLATE NOCASE, name COLLATE NOCASE, model_number COLLATE NOCASE, id);
  CREATE INDEX supplier_products_marketplace_model_idx ON supplier_products
    (listing_status, review_status, model_number COLLATE NOCASE, name COLLATE NOCASE, id);
  CREATE INDEX supplier_products_marketplace_price_idx ON supplier_products
    (listing_status, review_status, unit_price_cents_ex_gst, name COLLATE NOCASE, id);
  CREATE INDEX supplier_products_marketplace_lead_idx ON supplier_products
    (listing_status, review_status, lead_time_days, name COLLATE NOCASE, id);
  CREATE INDEX supplier_products_marketplace_filter_idx ON supplier_products
    (listing_status, review_status, category, stock_status, unit_price_cents_ex_gst, id);

  CREATE TABLE trade_opportunities (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    state TEXT NOT NULL,
    status TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX trade_opportunities_status_idx ON trade_opportunities (status, updated_at, id);
  CREATE INDEX trade_opportunities_state_idx ON trade_opportunities (state, status, updated_at, id);
  CREATE INDEX trade_opportunities_title_nocase_idx ON trade_opportunities (title COLLATE NOCASE, updated_at, id);
  CREATE INDEX trade_opportunities_expiry_idx ON trade_opportunities (status, expires_at, id);

  CREATE TABLE trade_crm_customers (
    id TEXT PRIMARY KEY,
    firebase_uid TEXT NOT NULL,
    last_name TEXT NOT NULL,
    business_name TEXT NOT NULL,
    postcode TEXT NOT NULL,
    record_status TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX trade_crm_customers_owner_status_idx ON trade_crm_customers
    (firebase_uid, record_status, updated_at);
  CREATE INDEX trade_crm_customers_owner_name_idx ON trade_crm_customers
    (firebase_uid, last_name, business_name);
`);

const numberSql = "(a.value + b.value * 10 + c.value * 100 + d.value * 1000 + e.value * 10000)";
const sourceSql = "digits a CROSS JOIN digits b CROSS JOIN digits c CROSS JOIN digits d CROSS JOIN digits e";
const seededAt = performance.now();
database.exec(`
  INSERT INTO trade_accounts
  SELECT
    'account-' || printf('%06d', ${numberSql}),
    'Business ' || printf('%06d', ${numberSql}),
    CASE WHEN ${numberSql} % 5 = 0 THEN 'supplier' ELSE 'installer' END,
    CASE WHEN ${numberSql} % 97 = 0 THEN 'suspended' ELSE 'active' END,
    CASE WHEN ${numberSql} % 29 = 0 THEN 'under_review' ELSE 'approved' END,
    CASE WHEN ${numberSql} % 11 = 0 THEN 'trial' ELSE 'active' END,
    '2026-07-' || printf('%02d', (${numberSql} % 28) + 1) || 'T12:00:00.000Z'
  FROM ${sourceSql};

  INSERT INTO supplier_products
  SELECT
    'product-' || printf('%06d', ${numberSql}),
    'account-' || printf('%06d', (${numberSql} % 20000) * 5),
    'MODEL-' || printf('%06d', ${numberSql}),
    'Brand ' || printf('%03d', ${numberSql} % 400),
    'Product ' || printf('%06d', ${numberSql}),
    CASE ${numberSql} % 5 WHEN 0 THEN 'solar' WHEN 1 THEN 'battery' WHEN 2 THEN 'heating-cooling' WHEN 3 THEN 'hot-water' ELSE 'controls' END,
    CASE WHEN ${numberSql} % 7 = 0 THEN 'limited' ELSE 'in_stock' END,
    'published',
    'approved',
    50000 + (${numberSql} % 1000000),
    ${numberSql} % 31
  FROM ${sourceSql};

  INSERT INTO trade_opportunities
  SELECT
    'opportunity-' || printf('%06d', ${numberSql}),
    'Home upgrade ' || printf('%06d', ${numberSql}),
    CASE ${numberSql} % 8 WHEN 0 THEN 'ACT' WHEN 1 THEN 'NSW' WHEN 2 THEN 'NT' WHEN 3 THEN 'QLD' WHEN 4 THEN 'SA' WHEN 5 THEN 'TAS' WHEN 6 THEN 'VIC' ELSE 'WA' END,
    CASE ${numberSql} % 5 WHEN 0 THEN 'draft' WHEN 1 THEN 'open' WHEN 2 THEN 'paused' WHEN 3 THEN 'closed' ELSE 'expired' END,
    '2026-08-' || printf('%02d', (${numberSql} % 28) + 1) || 'T12:00:00.000Z',
    '2026-07-' || printf('%02d', (${numberSql} % 28) + 1) || 'T12:00:00.000Z'
  FROM ${sourceSql};

  INSERT INTO trade_crm_customers
  SELECT
    'customer-' || printf('%06d', ${numberSql}),
    'installer-benchmark',
    'Surname ' || printf('%06d', ${numberSql}),
    '',
    printf('%04d', 2000 + (${numberSql} % 7000)),
    CASE WHEN ${numberSql} % 101 = 0 THEN 'archived' ELSE 'active' END,
    '2026-07-' || printf('%02d', (${numberSql} % 28) + 1) || 'T12:00:00.000Z'
  FROM ${sourceSql};

  ANALYZE;
`);
const seedMs = performance.now() - seededAt;
const searchIndexStartedAt = performance.now();
let ftsAvailable = true;
try { database.exec(`
  CREATE VIRTUAL TABLE tlink_product_search USING fts5(entity_id UNINDEXED, name, brand, model_number, supplier_name, category);
  INSERT INTO tlink_product_search SELECT p.id, p.name, p.brand, p.model_number, a.business_name, p.category
    FROM supplier_products p JOIN trade_accounts a ON a.firebase_uid = p.firebase_uid;
  CREATE VIRTUAL TABLE tlink_account_search USING fts5(entity_id UNINDEXED, business_name);
  INSERT INTO tlink_account_search SELECT firebase_uid, business_name FROM trade_accounts;
  CREATE VIRTUAL TABLE tlink_opportunity_search USING fts5(entity_id UNINDEXED, title, postcode, state);
  INSERT INTO tlink_opportunity_search SELECT id, title, '', state FROM trade_opportunities;
  CREATE VIRTUAL TABLE tlink_crm_customer_search USING fts5(entity_id UNINDEXED, owner_uid UNINDEXED, last_name, postcode);
  INSERT INTO tlink_crm_customer_search SELECT id, firebase_uid, last_name, postcode FROM trade_crm_customers;
  ANALYZE;
`); } catch (error) {
  ftsAvailable = false;
  if (!String(error?.message || error).includes("no such module: fts5")) throw error;
}
const searchIndexMs = performance.now() - searchIndexStartedAt;

const eligible = "p.listing_status = 'published' AND p.review_status = 'approved' AND a.partner_type = 'supplier' AND a.account_status = 'active' AND a.verification_status = 'approved' AND a.billing_status IN ('trial', 'active')";
const catalogueSelect = `SELECT p.id, p.name, p.brand, p.model_number
  FROM supplier_products p JOIN trade_accounts a ON a.firebase_uid = p.firebase_uid
  WHERE ${eligible}`;
const queries = {
  catalogueFirstPage: {
    sql: `${catalogueSelect} ORDER BY p.name COLLATE NOCASE, p.brand COLLATE NOCASE, p.model_number COLLATE NOCASE, p.id LIMIT ?`,
    bindings: [PAGE_SIZE + 1],
  },
  catalogueDeepOffsetBaseline: {
    sql: `${catalogueSelect} ORDER BY p.name COLLATE NOCASE, p.brand COLLATE NOCASE, p.model_number COLLATE NOCASE, p.id LIMIT ? OFFSET ?`,
    bindings: [PAGE_SIZE + 1, RECORDS_PER_DATASET - PAGE_SIZE - 1],
  },
  catalogueDeepCursor: {
    sql: `${catalogueSelect} AND p.name COLLATE NOCASE >= ? AND (p.name COLLATE NOCASE, p.brand COLLATE NOCASE, p.model_number COLLATE NOCASE, p.id) > (?, ?, ?, ?) ORDER BY p.name COLLATE NOCASE, p.brand COLLATE NOCASE, p.model_number COLLATE NOCASE, p.id LIMIT ?`,
    bindings: ["Product 099974", "Product 099974", "", "", "", PAGE_SIZE + 1],
  },
  catalogueFilteredPrice: {
    sql: `${catalogueSelect} AND p.category = ? AND p.stock_status = ? AND p.unit_price_cents_ex_gst >= ? ORDER BY p.unit_price_cents_ex_gst, p.name COLLATE NOCASE, p.id LIMIT ?`,
    bindings: ["battery", "in_stock", 250000, PAGE_SIZE + 1],
  },
  adminAccounts: {
    sql: "SELECT firebase_uid, business_name FROM trade_accounts WHERE partner_type = ? AND account_status = ? ORDER BY updated_at DESC, firebase_uid DESC LIMIT ?",
    bindings: ["installer", "active", PAGE_SIZE],
  },
  adminAccountsDeepCursor: {
    sql: "SELECT firebase_uid, business_name FROM trade_accounts WHERE (updated_at, firebase_uid) < (?, ?) ORDER BY updated_at DESC, firebase_uid DESC LIMIT ?",
    bindings: ["2026-07-14T12:00:00.000Z", "account-099999", PAGE_SIZE],
  },
  adminOpportunities: {
    sql: "SELECT id, title FROM trade_opportunities WHERE state = ? AND status = ? ORDER BY updated_at DESC, id DESC LIMIT ?",
    bindings: ["VIC", "open", PAGE_SIZE],
  },
  adminOpportunitiesDeepCursor: {
    sql: "SELECT id, title FROM trade_opportunities WHERE (updated_at, id) < (?, ?) ORDER BY updated_at DESC, id DESC LIMIT ?",
    bindings: ["2026-07-14T12:00:00.000Z", "opportunity-099999", PAGE_SIZE],
  },
  installerCustomers: {
    sql: "SELECT id, last_name FROM trade_crm_customers WHERE firebase_uid = ? AND record_status = ? ORDER BY last_name, business_name, id LIMIT ?",
    bindings: ["installer-benchmark", "active", PAGE_SIZE],
  },
  installerCustomersDeepCursor: {
    sql: "SELECT id, last_name FROM trade_crm_customers WHERE firebase_uid = ? AND (last_name, business_name, id) > (?, ?, ?) ORDER BY last_name, business_name, id LIMIT ?",
    bindings: ["installer-benchmark", "Surname 099974", "", "", PAGE_SIZE],
  },
  ...(ftsAvailable ? { catalogueFullTextSearch: {
    sql: `${catalogueSelect} AND p.id IN (SELECT entity_id FROM tlink_product_search WHERE tlink_product_search MATCH ?) ORDER BY p.name COLLATE NOCASE, p.id LIMIT ?`,
    bindings: ['"999"*', PAGE_SIZE],
  },
  accountFullTextSearch: {
    sql: "SELECT firebase_uid FROM trade_accounts WHERE firebase_uid IN (SELECT entity_id FROM tlink_account_search WHERE tlink_account_search MATCH ?) LIMIT ?",
    bindings: ['"999"*', PAGE_SIZE],
  },
  opportunityFullTextSearch: {
    sql: "SELECT id FROM trade_opportunities WHERE id IN (SELECT entity_id FROM tlink_opportunity_search WHERE tlink_opportunity_search MATCH ?) LIMIT ?",
    bindings: ['"999"*', PAGE_SIZE],
  },
  customerFullTextSearch: {
    sql: "SELECT id FROM trade_crm_customers WHERE firebase_uid = ? AND id IN (SELECT entity_id FROM tlink_crm_customer_search WHERE owner_uid = ? AND tlink_crm_customer_search MATCH ?) LIMIT ?",
    bindings: ["installer-benchmark", "installer-benchmark", '"999"*', PAGE_SIZE],
  } } : {}),
};

const results = {};
for (const [name, query] of Object.entries(queries)) {
  const statement = database.prepare(query.sql);
  results[name] = {
    ...measure(statement, query.bindings),
    plan: plan(database, query.sql, query.bindings),
  };
}

const counts = Object.fromEntries([
  ["accounts", "trade_accounts"],
  ["products", "supplier_products"],
  ["opportunities", "trade_opportunities"],
  ["customers", "trade_crm_customers"],
].map(([name, table]) => [name, Number(database.prepare(`SELECT COUNT(*) total FROM ${table}`).get().total)]));

for (const [name, count] of Object.entries(counts)) {
  if (count !== RECORDS_PER_DATASET) throw new Error(`${name} benchmark seed expected ${RECORDS_PER_DATASET} records and received ${count}.`);
}
for (const name of ["catalogueFirstPage", "catalogueDeepCursor", "catalogueFilteredPrice", "adminAccounts", "adminAccountsDeepCursor", "adminOpportunities", "adminOpportunitiesDeepCursor", "installerCustomers", "installerCustomersDeepCursor", ...(ftsAvailable ? ["catalogueFullTextSearch", "accountFullTextSearch", "opportunityFullTextSearch", "customerFullTextSearch"] : [])]) {
  if (results[name].p95Ms > 75) throw new Error(`${name} exceeded the 75ms local p95 guardrail at ${results[name].p95Ms}ms.`);
}

const offsetP95 = results.catalogueDeepOffsetBaseline.p95Ms || 0.001;
const cursorP95 = results.catalogueDeepCursor.p95Ms || 0.001;
const summary = {
  recordsPerDataset: RECORDS_PER_DATASET,
  totalSyntheticRows: Object.values(counts).reduce((total, count) => total + count, 0),
  seedMs: Number(seedMs.toFixed(1)),
  searchIndexMs: Number(searchIndexMs.toFixed(1)),
  ftsAvailable,
  counts,
  cursorSpeedupAtDeepPage: Number((offsetP95 / cursorP95).toFixed(1)),
  guardrailP95Ms: 75,
  results,
};

console.log(JSON.stringify(summary, null, 2));
database.close();
