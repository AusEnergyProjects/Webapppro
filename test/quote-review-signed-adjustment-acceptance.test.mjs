import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import ts from "typescript";

import {
  acceptedScopeSnapshot,
  depositAmountCents,
} from "../src/lib/trade-commercial-handoff.ts";
import { buildAcceptedInvoiceSnapshot } from "../src/lib/trade-accepted-invoice.ts";
import { providerNeutralCommercialRecord } from "../src/lib/trade-commercial-reference.ts";
import { calculateQuoteSelection } from "../src/lib/trade-quote-options.ts";

const routeSource = fs.readFileSync(
  new URL("../src/app/api/quote-review/[token]/route.ts", import.meta.url),
  "utf8",
);
const reviewServerSource = fs.readFileSync(
  new URL("../src/lib/trade-quote-review-server.ts", import.meta.url),
  "utf8",
);
const decisionServerSource = fs.readFileSync(
  new URL("../src/lib/trade-quote-decision-server.ts", import.meta.url),
  "utf8",
);
const acceptedInvoicePerJobMigration = fs.readFileSync(
  new URL("../drizzle/0139_trade_accepted_invoice_one_per_job.sql", import.meta.url),
  "utf8",
);

function compile(source, fileName, mocks) {
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
    fileName,
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

function adminJson(body, status = 200) {
  return Response.json(body, { status });
}

function publicErrorMapper() {
  return compile(reviewServerSource, "src/lib/trade-quote-review-server.ts", {
    "../../db": { getD1: () => { throw new Error("Unexpected D1 access"); } },
    "@/lib/admin-server": { adminJson },
    "@/lib/trade-quote-links": {
      hashQuoteLinkSecret: async () => "unused",
      splitQuoteLinkToken: () => ({ linkId: "unused", secret: "unused" }),
    },
    "@/lib/trade-access-server": { verifiedTradeAccountPredicate: () => "1 = 1" },
  }).tradeQuoteTokenErrorResponse;
}

class Statement {
  constructor(database, sql, values = []) {
    this.database = database;
    this.sql = sql;
    this.values = values;
    database.prepare(sql);
  }

  bind(...values) {
    return new Statement(this.database, this.sql, values);
  }

  runSync() {
    return this.database.prepare(this.sql).run(...this.values);
  }

  async run() {
    const result = this.runSync();
    return { meta: { changes: Number(result.changes) } };
  }

  async first() {
    return this.database.prepare(this.sql).get(...this.values) || null;
  }

  async all() {
    return { results: this.database.prepare(this.sql).all(...this.values) };
  }
}

function d1(database, beforeBatch) {
  let batchStarted = false;
  return {
    prepare: (sql) => new Statement(database, sql),
    async batch(statements) {
      if (!batchStarted && beforeBatch) {
        batchStarted = true;
        beforeBatch(database);
      }
      database.exec("BEGIN IMMEDIATE");
      try {
        const results = statements.map((statement) => {
          const result = statement.runSync();
          return { meta: { changes: Number(result.changes) } };
        });
        database.exec("COMMIT");
        return results;
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    },
  };
}

const ids = {
  link: "0e70d498-a994-4422-9eb7-87c4bcf15c9a",
  quote: "public-lead-quote-19cbbbca-b89b-498c-a144-8a1ca098225e",
  version: "public-lead-quote-version-19cbbbca-b89b-498c-a144-8a1ca098225e",
  work: "public-lead-work-19cbbbca-b89b-498c-a144-8a1ca098225e",
  owner: "sn3jiETyyecEkd8ZdnJEZ53AniG3",
  customer: "public-lead-customer-19cbbbca-b89b-498c-a144-8a1ca098225e",
};

const targetSnapshot = {
  quoteId: ids.quote,
  quoteVersionId: ids.version,
  quoteNumber: "Q-TLJ-X4LMAQXU",
  versionNumber: 1,
  subtotalCents: 356_000,
  taxCents: 35_600,
  totalCents: 391_600,
  terms: "This includes the full energy assessment and certification of the home.",
  business: {
    name: "Australian Energy Assessments",
    email: "info@ausenergyassessments.com",
    phone: "0417 337 808",
    abn: "12 345 678 901",
    address: "Melbourne VIC 3000",
  },
  customer: { id: ids.customer, name: "James William", email: "customer@example.com", number: "CUS-1001" },
  site: {
    label: "Home",
    addressLine1: "1 Test Street",
    addressLine2: "",
    suburb: "Melbourne",
    state: "VIC",
    postcode: "3000",
    summary: "1 Test Street, Melbourne VIC 3000",
  },
  work: { id: ids.work, number: "TLJ-X4LMAQXU", title: "Energy upgrade" },
  choices: [],
  items: [
    { id: "callout", lineType: "labour", description: "Call-out", sectionHeading: "Included work", quantityMilli: 6_000, subtotalCents: 120_000, taxCents: 12_000, totalCents: 132_000 },
    { id: "heatpump", lineType: "product", description: "Istore Heatpump", sectionHeading: "Included work", quantityMilli: 1_000, subtotalCents: 350_000, taxCents: 35_000, totalCents: 385_000 },
    { id: "stc", lineType: "adjustment", description: "STC", sectionHeading: "Included work", quantityMilli: 30_000, subtotalCents: -114_000, taxCents: -11_400, totalCents: -125_400 },
  ],
};

function fixture() {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE trade_accounts (
      firebase_uid TEXT PRIMARY KEY, partner_type TEXT NOT NULL, account_status TEXT NOT NULL,
      invoice_payment_account_name TEXT NOT NULL DEFAULT '', invoice_payment_bsb TEXT NOT NULL DEFAULT '',
      invoice_payment_account_number TEXT NOT NULL DEFAULT '', invoice_payment_reference TEXT NOT NULL DEFAULT '',
      invoice_default_terms TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE trade_work_orders (id TEXT PRIMARY KEY, firebase_uid TEXT NOT NULL, record_status TEXT NOT NULL);
    CREATE TABLE trade_crm_job_details (
      work_order_id TEXT PRIMARY KEY, firebase_uid TEXT NOT NULL, crm_customer_id TEXT NOT NULL,
      customer_source TEXT NOT NULL, quoted_value_cents INTEGER NOT NULL, quote_status TEXT NOT NULL,
      invoiced_value_cents INTEGER NOT NULL DEFAULT 0, paid_value_cents INTEGER NOT NULL DEFAULT 0,
      invoice_status TEXT NOT NULL DEFAULT 'not_started',
      payment_due_at TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL
    );
    CREATE TABLE trade_crm_quotes (
      id TEXT PRIMARY KEY, work_order_id TEXT NOT NULL, firebase_uid TEXT NOT NULL,
      crm_customer_id TEXT NOT NULL, current_version_number INTEGER NOT NULL,
      status TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE trade_crm_quote_versions (
      id TEXT PRIMARY KEY, quote_id TEXT NOT NULL, firebase_uid TEXT NOT NULL, version_number INTEGER NOT NULL,
      status TEXT NOT NULL, updated_at TEXT NOT NULL, document_snapshot_json TEXT NOT NULL DEFAULT '',
      valid_until TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE trade_crm_quote_links (
      id TEXT PRIMARY KEY, quote_id TEXT NOT NULL, quote_version_id TEXT NOT NULL, work_order_id TEXT NOT NULL,
      firebase_uid TEXT NOT NULL, crm_customer_id TEXT NOT NULL, token_hash TEXT NOT NULL,
      encrypted_token TEXT NOT NULL, token_issue INTEGER NOT NULL, status TEXT NOT NULL,
      expires_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE trade_crm_quote_acceptances (
      id TEXT PRIMARY KEY, quote_id TEXT NOT NULL, quote_version_id TEXT NOT NULL UNIQUE, work_order_id TEXT NOT NULL,
      firebase_uid TEXT NOT NULL, crm_customer_id TEXT NOT NULL, customer_firebase_uid TEXT NOT NULL,
      actor_email TEXT NOT NULL, actor_email_verified INTEGER NOT NULL, actor_auth_time INTEGER NOT NULL,
      actor_sign_in_provider TEXT NOT NULL, decision TEXT NOT NULL, consent_statement TEXT NOT NULL,
      selected_choice_ids_json TEXT NOT NULL, selected_subtotal_cents INTEGER NOT NULL,
      selected_tax_cents INTEGER NOT NULL, selected_total_cents INTEGER NOT NULL, selection_summary TEXT NOT NULL,
      signer_name TEXT NOT NULL, actor_type TEXT NOT NULL, quote_link_id TEXT NOT NULL, token_issue INTEGER NOT NULL,
      commercial_reference TEXT NOT NULL, currency TEXT NOT NULL, decided_at TEXT NOT NULL, created_at TEXT NOT NULL,
      decision_request_id TEXT NOT NULL DEFAULT '', decision_payload_sha256 TEXT NOT NULL DEFAULT '',
      result_invoice_id TEXT NOT NULL DEFAULT '', invoice_creation_status TEXT NOT NULL DEFAULT 'not_applicable',
      invoice_creation_error_code TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE trade_crm_quote_events (
      id TEXT PRIMARY KEY, quote_link_id TEXT NOT NULL, quote_id TEXT NOT NULL, quote_version_id TEXT NOT NULL,
      work_order_id TEXT NOT NULL, firebase_uid TEXT NOT NULL, event_type TEXT NOT NULL, actor_type TEXT NOT NULL,
      summary TEXT NOT NULL, evidence_key TEXT NOT NULL UNIQUE, occurred_at TEXT NOT NULL
    );
    CREATE TABLE trade_crm_commercial_handovers (
      id TEXT PRIMARY KEY, acceptance_id TEXT NOT NULL UNIQUE, quote_id TEXT NOT NULL, quote_version_id TEXT NOT NULL,
      work_order_id TEXT NOT NULL, firebase_uid TEXT NOT NULL, crm_customer_id TEXT NOT NULL,
      commercial_reference TEXT NOT NULL, currency TEXT NOT NULL, scope_snapshot_json TEXT NOT NULL,
      terms_snapshot TEXT NOT NULL, subtotal_cents INTEGER NOT NULL, tax_cents INTEGER NOT NULL,
      total_cents INTEGER NOT NULL, deposit_kind TEXT NOT NULL, deposit_basis_points INTEGER NOT NULL,
      deposit_fixed_cents INTEGER NOT NULL, deposit_amount_cents INTEGER NOT NULL, status TEXT NOT NULL,
      accepted_at TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE trade_crm_accepted_invoices (
      id TEXT PRIMARY KEY, acceptance_id TEXT NOT NULL UNIQUE, commercial_handoff_id TEXT NOT NULL UNIQUE,
      quote_id TEXT NOT NULL, quote_version_id TEXT NOT NULL UNIQUE, work_order_id TEXT NOT NULL,
      firebase_uid TEXT NOT NULL, crm_customer_id TEXT NOT NULL, invoice_number TEXT NOT NULL,
      currency TEXT NOT NULL, document_label TEXT NOT NULL, source_snapshot_sha256 TEXT NOT NULL,
      document_snapshot_json TEXT NOT NULL, subtotal_cents INTEGER NOT NULL, tax_cents INTEGER NOT NULL,
      total_cents INTEGER NOT NULL, due_at TEXT NOT NULL, status TEXT NOT NULL,
      issue_blocker_code TEXT NOT NULL, payment_snapshot_json TEXT NOT NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX trade_crm_accepted_invoices_owner_job_unique_idx
      ON trade_crm_accepted_invoices (firebase_uid, work_order_id);
    CREATE TABLE trade_crm_quick_invoices (
      id TEXT PRIMARY KEY, work_order_id TEXT NOT NULL, firebase_uid TEXT NOT NULL,
      status TEXT NOT NULL
    );
    CREATE TABLE trade_crm_accounting_documents (
      id TEXT PRIMARY KEY, work_order_id TEXT NOT NULL, firebase_uid TEXT NOT NULL,
      document_type TEXT NOT NULL, status TEXT NOT NULL
    );
  `);
  database.prepare(`INSERT INTO trade_accounts VALUES (?, 'installer', 'active',
    'Australian Energy Assessments', '063-000', '12345678', 'Quote acceptance', 'Payment due in 7 days')`).run(ids.owner);
  database.prepare("INSERT INTO trade_work_orders VALUES (?, ?, 'active')").run(ids.work, ids.owner);
  database.prepare("INSERT INTO trade_crm_job_details VALUES (?, ?, ?, 'public_lead_released', 0, 'sent', 0, 0, 'not_started', '', '')")
    .run(ids.work, ids.owner, ids.customer);
  database.prepare("INSERT INTO trade_crm_quotes VALUES (?, ?, ?, ?, 1, 'issued', '')")
    .run(ids.quote, ids.work, ids.owner, ids.customer);
  database.prepare("INSERT INTO trade_crm_quote_versions VALUES (?, ?, ?, 1, 'issued', '', '', '2099-12-31')")
    .run(ids.version, ids.quote, ids.owner);
  database.prepare("INSERT INTO trade_crm_quote_links VALUES (?, ?, ?, ?, ?, ?, 'active-hash', 'ciphertext', 1, 'active', '2099-12-31T00:00:00.000Z', '')")
    .run(ids.link, ids.quote, ids.version, ids.work, ids.owner, ids.customer);
  return database;
}

function decisionServer(database, beforeBatch) {
  return compile(decisionServerSource, "src/lib/trade-quote-decision-server.ts", {
    "../../db": { getD1: () => d1(database, beforeBatch) },
    "@/lib/trade-access-server": {
      verifiedTradeAccountPredicate: () => "trade.account_status = 'active'",
    },
    "@/lib/trade-quote-links": {
      hashQuoteLinkSecret: async () => "active-hash",
      splitQuoteLinkToken: (token) => ({
        linkId: String(token).split(".", 1)[0],
        secret: "redacted",
      }),
    },
  });
}

function loadRoute(database, snapshot = targetSnapshot, beforeBatch) {
  const errorMapper = publicErrorMapper();
  const decisions = decisionServer(database, beforeBatch);
  const databaseBinding = d1(database, beforeBatch);
  const authorisedSnapshot = async (link) => {
    const cloned = structuredClone(snapshot);
    if (cloned.quoteId !== link.quote_id ||
        cloned.quoteVersionId !== link.quote_version_id ||
        cloned.work.id !== link.work_order_id ||
        cloned.customer.id !== link.crm_customer_id) {
      throw new Error("QUOTE_DOCUMENT_SNAPSHOT_INVALID");
    }
    return cloned;
  };
  return compile(routeSource, "src/app/api/quote-review/[token]/route.ts", {
    "../../../../../db": { getD1: () => databaseBinding },
    "@/lib/admin-server": {
      adminJson,
      cleanAdminText: (value, maximum) => String(value || "").trim().slice(0, maximum),
      sameOrigin: () => true,
    },
    "@/lib/trade-quote-options": { calculateQuoteSelection },
    "@/lib/trade-commercial-reference": { providerNeutralCommercialRecord },
    "@/lib/trade-commercial-handoff": { acceptedScopeSnapshot, depositAmountCents },
    "@/lib/trade-accepted-invoice": { buildAcceptedInvoiceSnapshot },
    "@/lib/trade-quote-decision-server": decisions,
    "@/lib/trade-access-server": { verifiedTradeAccountPredicate: () => "1 = 1" },
    "@/lib/trade-quote-review-server": {
      buildTradeQuoteReviewPayload: async (link) => ({
        quoteVersionId: (await authorisedSnapshot(link)).quoteVersionId,
      }),
      quoteDocumentSnapshotForAuthorisedLink: authorisedSnapshot,
      tradeQuoteTokenErrorResponse: errorMapper,
    },
  });
}

const clientDecisionId = "d882bf58-1cc8-46cc-a0fd-e9e37f1c1fa9";

function decisionRequest(overrides = {}) {
  return new Request(`https://compare.ausenergyassessments.com/api/quote-review/${ids.link}.redacted`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://compare.ausenergyassessments.com" },
    body: JSON.stringify({
      action: "decide",
      decision: "accepted",
      signerName: "James William",
      consentConfirmed: true,
      selectedChoiceIds: [],
      clientDecisionId,
      ...overrides,
    }),
  });
}

const context = { params: Promise.resolve({ token: `${ids.link}.redacted` }) };

function contextFor(linkId) {
  return { params: Promise.resolve({ token: `${linkId}.redacted` }) };
}

function count(database, table) {
  return database.prepare(`SELECT COUNT(*) count FROM ${table}`).get().count;
}

function insertExistingAcceptedInvoice(database, suffix = "prior") {
  database.prepare(`INSERT INTO trade_crm_accepted_invoices
    (id, acceptance_id, commercial_handoff_id, quote_id, quote_version_id,
     work_order_id, firebase_uid, crm_customer_id, invoice_number, currency,
     document_label, source_snapshot_sha256, document_snapshot_json,
     subtotal_cents, tax_cents, total_cents, due_at, status,
     issue_blocker_code, payment_snapshot_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'AUD', 'Invoice', ?, '{}',
      10000, 1000, 11000, '2026-09-01', 'issued', '', '{}', ?, ?)`)
    .run(
      `invoice-${suffix}`,
      `acceptance-${suffix}`,
      `handoff-${suffix}`,
      `quote-${suffix}`,
      `version-${suffix}`,
      ids.work,
      ids.owner,
      ids.customer,
      `INV-${suffix.toUpperCase()}`,
      "a".repeat(64),
      "2026-08-13T00:00:00.000Z",
      "2026-08-13T00:00:00.000Z",
    );
}

test("the actual public POST route accepts the production-shaped signed STC adjustment and records exact totals", async () => {
  const database = fixture();
  const response = await loadRoute(database).POST(decisionRequest(), context);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.duplicate, false);
  assert.equal(body.decision, "accepted");
  assert.deepEqual(body.commercial, {
    reference: "Q-TLJ-X4LMAQXU-V1", currency: "AUD", subtotalCents: 356_000,
    taxCents: 35_600, totalCents: 391_600, selectedChoiceIds: [],
  });
  assert.equal(body.receipt.invoice.documentLabel, "Invoice");
  assert.equal(body.receipt.invoice.totalCents, 391_600);
  assert.equal(body.receipt.payment.availability, "bank_transfer");
  assert.equal(body.receipt.payment.accountNumber, "12345678");

  const acceptance = database.prepare("SELECT * FROM trade_crm_quote_acceptances").get();
  assert.equal(acceptance.signer_name, "James William");
  assert.equal(acceptance.selected_subtotal_cents, 356_000);
  assert.equal(acceptance.selected_tax_cents, 35_600);
  assert.equal(acceptance.selected_total_cents, 391_600);
  assert.equal(acceptance.decision_request_id, clientDecisionId);
  assert.equal(acceptance.decision_payload_sha256.length, 64);
  const handoff = database.prepare("SELECT * FROM trade_crm_commercial_handovers").get();
  assert.equal(handoff.deposit_amount_cents, 39_160);
  assert.deepEqual(JSON.parse(handoff.scope_snapshot_json).at(-1), {
    lineId: "stc",
    lineType: "adjustment",
    section: "Included work",
    description: "STC",
    quantityMilli: 30_000,
    subtotalCents: -114_000,
    taxCents: -11_400,
    totalCents: -125_400,
  });
  assert.equal(database.prepare("SELECT status FROM trade_crm_quote_versions").get().status, "accepted");
  assert.equal(database.prepare("SELECT status FROM trade_crm_quotes").get().status, "accepted");
  assert.deepEqual({ ...database.prepare("SELECT status, token_hash, encrypted_token FROM trade_crm_quote_links").get() }, {
    status: "accepted", token_hash: "active-hash", encrypted_token: "",
  });
  assert.deepEqual({ ...database.prepare("SELECT quoted_value_cents, quote_status FROM trade_crm_job_details").get() }, {
    quoted_value_cents: 391_600, quote_status: "accepted",
  });
  const jobInvoice = database.prepare("SELECT invoiced_value_cents, invoice_status, payment_due_at FROM trade_crm_job_details").get();
  assert.equal(jobInvoice.invoiced_value_cents, 391_600);
  assert.equal(jobInvoice.invoice_status, "issued");
  assert.match(jobInvoice.payment_due_at, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(database.prepare("SELECT event_type FROM trade_crm_quote_events").get().event_type, "accepted");
  const invoice = database.prepare("SELECT * FROM trade_crm_accepted_invoices").get();
  assert.equal(invoice.total_cents, 391_600);
  assert.equal(invoice.status, "issued");
  assert.equal(JSON.parse(invoice.payment_snapshot_json).accountNumber, "12345678");
  database.close();
});

test("an unreconciled snapshot returns a safe public conflict before the actual POST route writes anything", async () => {
  const database = fixture();
  const mismatched = structuredClone(targetSnapshot);
  mismatched.subtotalCents += 1;
  mismatched.totalCents += 1;
  const originalError = console.error;
  console.error = () => {};
  try {
    const response = await loadRoute(database, mismatched).POST(decisionRequest(), context);
    assert.equal(response.status, 409);
    const body = await response.json();
    assert.equal(body.ok, false);
    assert.match(body.error, /recorded totals could not be verified/i);
    assert.equal(typeof body.requestId, "string");
    assert.equal(Object.hasOwn(body, "code"), false);
  } finally {
    console.error = originalError;
  }
  for (const table of ["trade_crm_quote_acceptances", "trade_crm_commercial_handovers", "trade_crm_accepted_invoices", "trade_crm_quote_events"]) {
    assert.equal(database.prepare(`SELECT COUNT(*) count FROM ${table}`).get().count, 0, table);
  }
  assert.equal(database.prepare("SELECT status FROM trade_crm_quote_versions").get().status, "issued");
  assert.deepEqual({ ...database.prepare("SELECT status, token_hash FROM trade_crm_quote_links").get() }, {
    status: "active", token_hash: "active-hash",
  });
  database.close();
});

test("negative product or labour and missing or invalid line types fail before the actual POST route writes anything", async () => {
  const cases = [
    ["negative product", (snapshot) => {
      Object.assign(snapshot.items[0], { lineType: "product", subtotalCents: -1_000, taxCents: -100, totalCents: -1_100 });
      Object.assign(snapshot, { subtotalCents: 235_000, taxCents: 23_500, totalCents: 258_500 });
    }],
    ["negative labour", (snapshot) => {
      Object.assign(snapshot.items[0], { lineType: "labour", subtotalCents: -1_000, taxCents: -100, totalCents: -1_100 });
      Object.assign(snapshot, { subtotalCents: 235_000, taxCents: 23_500, totalCents: 258_500 });
    }],
    ["missing line type", (snapshot) => { delete snapshot.items[0].lineType; }],
    ["invalid line type", (snapshot) => { snapshot.items[0].lineType = "rebate"; }],
  ];
  const originalError = console.error;
  console.error = () => {};
  try {
    for (const [label, mutate] of cases) {
      const database = fixture();
      const snapshot = structuredClone(targetSnapshot);
      mutate(snapshot);
      const response = await loadRoute(database, snapshot).POST(decisionRequest(), context);
      assert.equal(response.status, 409, label);
      assert.match((await response.json()).error, /recorded totals could not be verified/i, label);
      for (const table of ["trade_crm_quote_acceptances", "trade_crm_commercial_handovers", "trade_crm_accepted_invoices", "trade_crm_quote_events"]) {
        assert.equal(database.prepare(`SELECT COUNT(*) count FROM ${table}`).get().count, 0, `${label}: ${table}`);
      }
      assert.equal(database.prepare("SELECT status FROM trade_crm_quote_versions").get().status, "issued", label);
      assert.equal(database.prepare("SELECT status FROM trade_crm_quote_links").get().status, "active", label);
      database.close();
    }
  } finally {
    console.error = originalError;
  }
});

test("a cross-linked customer relation cannot produce a false success or any partial write", async () => {
  const database = fixture();
  database.prepare("UPDATE trade_crm_quote_links SET crm_customer_id = 'different-customer'").run();
  const originalError = console.error;
  console.error = () => {};
  try {
    const response = await loadRoute(database).POST(decisionRequest(), context);
    assert.equal(response.status, 404);
    assert.match((await response.json()).error, /not valid/i);
  } finally {
    console.error = originalError;
  }
  for (const table of ["trade_crm_quote_acceptances", "trade_crm_commercial_handovers", "trade_crm_accepted_invoices", "trade_crm_quote_events"]) {
    assert.equal(database.prepare(`SELECT COUNT(*) count FROM ${table}`).get().count, 0, table);
  }
  assert.equal(database.prepare("SELECT status FROM trade_crm_quote_versions").get().status, "issued");
  assert.equal(database.prepare("SELECT status FROM trade_crm_quote_links").get().status, "active");
  database.close();
});

test("GET and POST reject a quote cross-linked to another work order or customer with zero state changes", async () => {
  for (const [label, update] of [
    ["quote work", "UPDATE trade_crm_quotes SET work_order_id = 'different-work'"],
    ["quote customer", "UPDATE trade_crm_quotes SET crm_customer_id = 'different-customer'"],
  ]) {
    for (const method of ["GET", "POST"]) {
      const database = fixture();
      database.exec(update);
      const beforeJob = { ...database.prepare("SELECT * FROM trade_crm_job_details").get() };
      const beforeLink = { ...database.prepare("SELECT * FROM trade_crm_quote_links").get() };
      const beforeQuote = { ...database.prepare("SELECT * FROM trade_crm_quotes").get() };
      const beforeVersion = { ...database.prepare("SELECT * FROM trade_crm_quote_versions").get() };
      const route = loadRoute(database);
      const originalError = console.error;
      console.error = () => {};
      try {
        const response = method === "GET"
          ? await route.GET(new Request("https://compare.ausenergyassessments.com"), context)
          : await route.POST(decisionRequest(), context);
        assert.equal(response.status, 404, `${label} ${method}`);
        assert.match((await response.json()).error, /not valid/i, `${label} ${method}`);
      } finally {
        console.error = originalError;
      }
      for (const table of ["trade_crm_quote_acceptances", "trade_crm_commercial_handovers", "trade_crm_accepted_invoices", "trade_crm_quote_events"]) {
        assert.equal(count(database, table), 0, `${label} ${method}: ${table}`);
      }
      assert.deepEqual({ ...database.prepare("SELECT * FROM trade_crm_job_details").get() }, beforeJob, `${label} ${method}: job`);
      assert.deepEqual({ ...database.prepare("SELECT * FROM trade_crm_quote_links").get() }, beforeLink, `${label} ${method}: link`);
      assert.deepEqual({ ...database.prepare("SELECT * FROM trade_crm_quotes").get() }, beforeQuote, `${label} ${method}: quote`);
      assert.deepEqual({ ...database.prepare("SELECT * FROM trade_crm_quote_versions").get() }, beforeVersion, `${label} ${method}: version`);
      database.close();
    }
  }
});

test("GET validates snapshot work and customer identity before recording a view", async () => {
  for (const [label, mutate] of [
    ["snapshot work", (snapshot) => { snapshot.work.id = "different-work"; }],
    ["snapshot customer", (snapshot) => { snapshot.customer.id = "different-customer"; }],
  ]) {
    const database = fixture();
    const snapshot = structuredClone(targetSnapshot);
    mutate(snapshot);
    const originalError = console.error;
    console.error = () => {};
    try {
      const response = await loadRoute(database, snapshot).GET(
        new Request("https://compare.ausenergyassessments.com"),
        context,
      );
      assert.equal(response.status, 409, label);
      assert.match((await response.json()).error, /document could not be verified/i, label);
    } finally {
      console.error = originalError;
    }
    assert.equal(count(database, "trade_crm_quote_events"), 0, label);
    assert.equal(count(database, "trade_crm_quote_acceptances"), 0, label);
    assert.equal(database.prepare("SELECT status FROM trade_crm_quote_links").get().status, "active", label);
    database.close();
  }
});

test("decision and public review authorization bind the quote and immutable snapshot to the link", () => {
  assert.match(
    decisionServerSource,
    /authoriseTradeQuoteDecisionLink[\s\S]*?JOIN trade_crm_quotes quote[\s\S]*?quote\.work_order_id = link\.work_order_id[\s\S]*?quote\.crm_customer_id = link\.crm_customer_id/,
  );
  assert.match(
    reviewServerSource,
    /authoriseTradeQuoteLink[\s\S]*?JOIN trade_crm_quotes quote[\s\S]*?quote\.work_order_id = link\.work_order_id[\s\S]*?quote\.crm_customer_id = link\.crm_customer_id/,
  );
  assert.match(
    reviewServerSource,
    /quoteDocumentSnapshotForAuthorisedLink[\s\S]*?snapshot\.work\.id !== row\.work_order_id[\s\S]*?snapshot\.customer\.id !== row\.crm_customer_id/,
  );
});

test("migration enforces one accepted invoice per trade job", () => {
  const database = new DatabaseSync(":memory:");
  database.exec(`CREATE TABLE trade_crm_accepted_invoices (
    id TEXT PRIMARY KEY, firebase_uid TEXT NOT NULL, work_order_id TEXT NOT NULL
  )`);
  database.exec(acceptedInvoicePerJobMigration);
  database.prepare("INSERT INTO trade_crm_accepted_invoices VALUES ('one', 'owner', 'job')").run();
  assert.throws(
    () => database.prepare("INSERT INTO trade_crm_accepted_invoices VALUES ('two', 'owner', 'job')").run(),
    /UNIQUE constraint failed/,
  );
  database.prepare("INSERT INTO trade_crm_accepted_invoices VALUES ('three', 'owner', 'other-job')").run();
  database.prepare("INSERT INTO trade_crm_accepted_invoices VALUES ('four', 'other-owner', 'job')").run();
  assert.equal(count(database, "trade_crm_accepted_invoices"), 3);
  database.close();
});

test("a lost response replays the exact canonical acceptance receipt without duplicate writes", async () => {
  const database = fixture();
  const route = loadRoute(database);
  const first = await route.POST(decisionRequest(), context);
  assert.equal(first.status, 200);
  const firstBody = await first.json();
  const replay = await route.POST(decisionRequest(), context);
  assert.equal(replay.status, 200);
  const replayBody = await replay.json();
  assert.equal(replayBody.duplicate, true);
  assert.deepEqual(replayBody.receipt, firstBody.receipt);
  assert.deepEqual(replayBody.commercial, firstBody.commercial);
  assert.equal(count(database, "trade_crm_quote_acceptances"), 1);
  assert.equal(count(database, "trade_crm_commercial_handovers"), 1);
  assert.equal(count(database, "trade_crm_accepted_invoices"), 1);
  assert.equal(count(database, "trade_crm_quote_events"), 1);
  assert.deepEqual({ ...database.prepare("SELECT invoiced_value_cents, invoice_status, payment_due_at FROM trade_crm_job_details").get() }, {
    invoiced_value_cents: 391_600,
    invoice_status: "issued",
    payment_due_at: firstBody.receipt.invoice.dueAt,
  });
  database.close();
});

test("a later quote version cannot create a second accepted invoice after job finance is cleared", async () => {
  const database = fixture();
  const firstRoute = loadRoute(database);
  const first = await firstRoute.POST(decisionRequest(), context);
  assert.equal(first.status, 200);
  const firstBody = await first.json();

  const secondVersion = `${ids.version}-v2`;
  const secondLink = "ccdc3300-dc2f-49d3-8bbd-dca7c65d14de";
  database.prepare(`UPDATE trade_crm_job_details
    SET invoiced_value_cents = 0, paid_value_cents = 0,
      invoice_status = 'not_started', payment_due_at = ''`).run();
  database.prepare("INSERT INTO trade_crm_quote_versions VALUES (?, ?, ?, 2, 'issued', '', '', '2099-12-31')")
    .run(secondVersion, ids.quote, ids.owner);
  database.prepare("UPDATE trade_crm_quotes SET current_version_number = 2, status = 'issued'").run();
  database.prepare(`INSERT INTO trade_crm_quote_links VALUES
    (?, ?, ?, ?, ?, ?, 'active-hash', 'ciphertext-2', 1, 'active',
     '2099-12-31T00:00:00.000Z', '')`)
    .run(secondLink, ids.quote, secondVersion, ids.work, ids.owner, ids.customer);
  const secondSnapshot = structuredClone(targetSnapshot);
  secondSnapshot.quoteVersionId = secondVersion;
  secondSnapshot.versionNumber = 2;
  const beforeJob = { ...database.prepare("SELECT * FROM trade_crm_job_details").get() };
  const originalError = console.error;
  console.error = () => {};
  let response;
  try {
    response = await loadRoute(database, secondSnapshot).POST(
      decisionRequest({ clientDecisionId: "67d5ba02-a746-47f4-b0a3-8863f19438dd" }),
      contextFor(secondLink),
    );
  } finally {
    console.error = originalError;
  }
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /already has a recorded accepted quote and invoice/i);
  assert.equal(count(database, "trade_crm_quote_acceptances"), 1);
  assert.equal(count(database, "trade_crm_commercial_handovers"), 1);
  assert.equal(count(database, "trade_crm_accepted_invoices"), 1);
  assert.equal(count(database, "trade_crm_quote_events"), 1);
  assert.deepEqual({ ...database.prepare("SELECT * FROM trade_crm_job_details").get() }, beforeJob);
  assert.equal(database.prepare("SELECT status FROM trade_crm_quote_versions WHERE id = ?").get(secondVersion).status, "issued");
  assert.equal(database.prepare("SELECT status FROM trade_crm_quote_links WHERE id = ?").get(secondLink).status, "active");

  const originalReplay = await firstRoute.POST(decisionRequest(), context);
  assert.equal(originalReplay.status, 200);
  const replayBody = await originalReplay.json();
  assert.equal(replayBody.duplicate, true);
  assert.deepEqual(replayBody.receipt, firstBody.receipt);
  assert.equal(count(database, "trade_crm_quote_acceptances"), 1);
  assert.equal(count(database, "trade_crm_accepted_invoices"), 1);
  database.close();
});

test("an accepted invoice racing a later acceptance rolls back every new decision write", async () => {
  const database = fixture();
  const route = loadRoute(database, targetSnapshot, (current) => {
    insertExistingAcceptedInvoice(current, "raced");
  });
  const originalError = console.error;
  console.error = () => {};
  try {
    const response = await route.POST(decisionRequest(), context);
    assert.equal(response.status, 409);
    assert.match((await response.json()).error, /already has a recorded accepted quote and invoice/i);
  } finally {
    console.error = originalError;
  }
  assert.equal(count(database, "trade_crm_quote_acceptances"), 0);
  assert.equal(count(database, "trade_crm_commercial_handovers"), 0);
  assert.equal(count(database, "trade_crm_accepted_invoices"), 1);
  assert.equal(count(database, "trade_crm_quote_events"), 0);
  assert.equal(database.prepare("SELECT id FROM trade_crm_accepted_invoices").get().id, "invoice-raced");
  assert.equal(database.prepare("SELECT status FROM trade_crm_quote_versions").get().status, "issued");
  assert.equal(database.prepare("SELECT status FROM trade_crm_quotes").get().status, "issued");
  assert.deepEqual({ ...database.prepare("SELECT status, encrypted_token FROM trade_crm_quote_links").get() }, {
    status: "active",
    encrypted_token: "ciphertext",
  });
  assert.deepEqual({ ...database.prepare(`SELECT quoted_value_cents, quote_status,
      invoiced_value_cents, paid_value_cents, invoice_status, payment_due_at
    FROM trade_crm_job_details`).get() }, {
    quoted_value_cents: 0,
    quote_status: "sent",
    invoiced_value_cents: 0,
    paid_value_cents: 0,
    invoice_status: "not_started",
    payment_due_at: "",
  });
  database.close();
});

test("decided receipts survive mutable business state while active links remain blocked", async () => {
  const mutations = [
    ["account suspended", (database) => {
      database.prepare("UPDATE trade_accounts SET account_status = 'suspended'").run();
    }],
    ["work archived and job relation changed", (database) => {
      database.prepare("UPDATE trade_work_orders SET record_status = 'archived'").run();
      database.prepare("UPDATE trade_crm_job_details SET crm_customer_id = 'different-customer'").run();
    }],
    ["quote validity and current version changed", (database) => {
      database.prepare("UPDATE trade_crm_quote_versions SET valid_until = '2000-01-01'").run();
      database.prepare("UPDATE trade_crm_quotes SET current_version_number = 2").run();
    }],
  ];
  for (const [label, mutate] of mutations) {
    const acceptedDatabase = fixture();
    const acceptedRoute = loadRoute(acceptedDatabase);
    const accepted = await acceptedRoute.POST(decisionRequest(), context);
    assert.equal(accepted.status, 200, label);
    const acceptedBody = await accepted.json();
    mutate(acceptedDatabase);

    const replay = await acceptedRoute.POST(decisionRequest(), context);
    assert.equal(replay.status, 200, `${label}: replay`);
    const replayBody = await replay.json();
    assert.equal(replayBody.duplicate, true, label);
    assert.deepEqual(replayBody.receipt, acceptedBody.receipt, label);
    const receipt = await acceptedRoute.GET(
      new Request("https://compare.ausenergyassessments.com"),
      context,
    );
    assert.equal(receipt.status, 200, `${label}: receipt`);
    assert.deepEqual((await receipt.json()).receipt, acceptedBody.receipt, label);
    assert.equal(count(acceptedDatabase, "trade_crm_quote_acceptances"), 1, label);
    assert.equal(count(acceptedDatabase, "trade_crm_commercial_handovers"), 1, label);
    assert.equal(count(acceptedDatabase, "trade_crm_accepted_invoices"), 1, label);
    assert.equal(count(acceptedDatabase, "trade_crm_quote_events"), 1, label);
    acceptedDatabase.close();

    const activeDatabase = fixture();
    mutate(activeDatabase);
    const activeRoute = loadRoute(activeDatabase);
    const originalError = console.error;
    console.error = () => {};
    try {
      const activeGet = await activeRoute.GET(
        new Request("https://compare.ausenergyassessments.com"),
        context,
      );
      assert.ok([404, 410].includes(activeGet.status), `${label}: active GET`);
      const activePost = await activeRoute.POST(decisionRequest(), context);
      assert.ok([404, 410].includes(activePost.status), `${label}: active POST`);
    } finally {
      console.error = originalError;
    }
    for (const table of ["trade_crm_quote_acceptances", "trade_crm_commercial_handovers", "trade_crm_accepted_invoices", "trade_crm_quote_events"]) {
      assert.equal(count(activeDatabase, table), 0, `${label}: ${table}`);
    }
    assert.equal(activeDatabase.prepare("SELECT status FROM trade_crm_quote_links").get().status, "active", label);
    assert.equal(activeDatabase.prepare("SELECT status FROM trade_crm_quote_versions").get().status, "issued", label);
    activeDatabase.close();
  }
});

test("exact decided replay and receipt do not rebuild a later-mutated live quote snapshot", async () => {
  const database = fixture();
  const mutableSnapshot = structuredClone(targetSnapshot);
  const route = loadRoute(database, mutableSnapshot);
  const accepted = await route.POST(decisionRequest(), context);
  assert.equal(accepted.status, 200);
  const acceptedBody = await accepted.json();
  mutableSnapshot.work.id = "different-work";
  mutableSnapshot.customer.id = "different-customer";
  mutableSnapshot.subtotalCents = 1;
  mutableSnapshot.taxCents = 1;
  mutableSnapshot.totalCents = 2;

  const replay = await route.POST(decisionRequest(), context);
  assert.equal(replay.status, 200);
  const replayBody = await replay.json();
  assert.equal(replayBody.duplicate, true);
  assert.deepEqual(replayBody.receipt, acceptedBody.receipt);
  const receipt = await route.GET(
    new Request("https://compare.ausenergyassessments.com"),
    context,
  );
  assert.equal(receipt.status, 200);
  assert.deepEqual((await receipt.json()).receipt, acceptedBody.receipt);
  assert.equal(count(database, "trade_crm_quote_acceptances"), 1);
  assert.equal(count(database, "trade_crm_commercial_handovers"), 1);
  assert.equal(count(database, "trade_crm_accepted_invoices"), 1);
  assert.equal(count(database, "trade_crm_quote_events"), 1);
  database.close();
});

test("decided receipts remain gated by link expiry, token hash and token issue", async () => {
  const cases = [
    ["expired", "UPDATE trade_crm_quote_links SET expires_at = '2000-01-01T00:00:00.000Z'", [410, 410]],
    ["token hash", "UPDATE trade_crm_quote_links SET token_hash = 'different-hash'", [404, 404]],
    ["token issue", "UPDATE trade_crm_quote_links SET token_issue = 2", [409, 409]],
  ];
  for (const [label, mutation, expected] of cases) {
    const database = fixture();
    const route = loadRoute(database);
    assert.equal((await route.POST(decisionRequest(), context)).status, 200, label);
    database.exec(mutation);
    const originalError = console.error;
    console.error = () => {};
    try {
      const receipt = await route.GET(
        new Request("https://compare.ausenergyassessments.com"),
        context,
      );
      assert.equal(receipt.status, expected[0], `${label}: GET`);
      const replay = await route.POST(decisionRequest(), context);
      assert.equal(replay.status, expected[1], `${label}: POST`);
    } finally {
      console.error = originalError;
    }
    assert.equal(count(database, "trade_crm_quote_acceptances"), 1, label);
    assert.equal(count(database, "trade_crm_commercial_handovers"), 1, label);
    assert.equal(count(database, "trade_crm_accepted_invoices"), 1, label);
    assert.equal(count(database, "trade_crm_quote_events"), 1, label);
    database.close();
  }
});

test("an altered replay is rejected and cannot mutate the recorded acceptance or invoice", async () => {
  const database = fixture();
  const route = loadRoute(database);
  assert.equal((await route.POST(decisionRequest(), context)).status, 200);
  const originalError = console.error;
  console.error = () => {};
  try {
    const response = await route.POST(decisionRequest({ signerName: "Another Person" }), context);
    assert.equal(response.status, 409);
    assert.match((await response.json()).error, /different recorded decision/i);
  } finally {
    console.error = originalError;
  }
  assert.equal(database.prepare("SELECT signer_name FROM trade_crm_quote_acceptances").get().signer_name, "James William");
  assert.equal(count(database, "trade_crm_quote_acceptances"), 1);
  assert.equal(count(database, "trade_crm_commercial_handovers"), 1);
  assert.equal(count(database, "trade_crm_accepted_invoices"), 1);
  assert.equal(count(database, "trade_crm_quote_events"), 1);
  database.close();
});

test("simultaneous copies of the same decision converge to one acceptance, handoff and invoice", async () => {
  const database = fixture();
  const route = loadRoute(database);
  const [left, right] = await Promise.all([
    route.POST(decisionRequest(), context),
    route.POST(decisionRequest(), context),
  ]);
  assert.deepEqual([left.status, right.status], [200, 200]);
  const bodies = await Promise.all([left.json(), right.json()]);
  assert.equal(bodies.filter((body) => body.duplicate === false).length, 1);
  assert.equal(bodies.filter((body) => body.duplicate === true).length, 1);
  assert.deepEqual(bodies[0].receipt, bodies[1].receipt);
  assert.equal(count(database, "trade_crm_quote_acceptances"), 1);
  assert.equal(count(database, "trade_crm_commercial_handovers"), 1);
  assert.equal(count(database, "trade_crm_accepted_invoices"), 1);
  assert.equal(count(database, "trade_crm_quote_events"), 1);
  database.close();
});

test("revoked and superseded links produce zero decision writes", async () => {
  for (const [label, update] of [
    ["revoked", "UPDATE trade_crm_quote_links SET status = 'revoked'"],
    ["superseded", "UPDATE trade_crm_quote_versions SET status = 'superseded'"],
  ]) {
    const database = fixture();
    database.exec(update);
    const originalError = console.error;
    console.error = () => {};
    try {
      const response = await loadRoute(database).POST(decisionRequest(), context);
      assert.ok([404, 410].includes(response.status), label);
    } finally {
      console.error = originalError;
    }
    for (const table of ["trade_crm_quote_acceptances", "trade_crm_commercial_handovers", "trade_crm_accepted_invoices", "trade_crm_quote_events"]) {
      assert.equal(count(database, table), 0, `${label}: ${table}`);
    }
    database.close();
  }
});

test("invoice payment details are frozen and incomplete live bank details are withheld", async () => {
  const database = fixture();
  database.prepare(`UPDATE trade_accounts SET invoice_payment_account_number = '',
    invoice_payment_bsb = '063-999', invoice_payment_reference = 'Initial'`).run();
  const route = loadRoute(database);
  const accepted = await route.POST(decisionRequest(), context);
  assert.equal(accepted.status, 200);
  const acceptedBody = await accepted.json();
  assert.equal(acceptedBody.receipt.payment.availability, "not_configured");
  assert.equal(acceptedBody.receipt.payment.accountName, "");
  assert.deepEqual(JSON.parse(database.prepare("SELECT payment_snapshot_json FROM trade_crm_accepted_invoices").get().payment_snapshot_json), {
    available: false,
    method: "unavailable",
  });
  database.prepare(`UPDATE trade_accounts SET invoice_payment_account_name = 'Changed Name',
    invoice_payment_bsb = '111-222', invoice_payment_account_number = '99999999'`).run();
  const direct = decisionServer(database);
  const decidedLink = await direct.authoriseTradeQuoteDecisionLink(`${ids.link}.redacted`);
  assert.equal(decidedLink.status, "accepted");
  assert.equal((await direct.storedQuoteDecision(decidedLink)).receipt.payment.availability, "not_configured");
  const receipt = await route.GET(new Request("https://compare.ausenergyassessments.com"), context);
  assert.equal(receipt.status, 200);
  const receiptBody = await receipt.json();
  assert.equal(receiptBody.receipt.payment.availability, "not_configured");
  assert.equal(receiptBody.receipt.payment.accountNumber, "");
  database.close();
});

test("declining records one idempotent decision and never creates a handoff, invoice or payment", async () => {
  const database = fixture();
  const route = loadRoute(database);
  const request = () => decisionRequest({ decision: "declined" });
  const first = await route.POST(request(), context);
  assert.equal(first.status, 200);
  const firstBody = await first.json();
  assert.equal(firstBody.receipt.decision, "declined");
  assert.equal(firstBody.receipt.invoice, null);
  assert.equal(firstBody.receipt.payment.availability, "withheld");
  const replay = await route.POST(request(), context);
  assert.equal(replay.status, 200);
  assert.equal((await replay.json()).duplicate, true);
  assert.equal(count(database, "trade_crm_quote_acceptances"), 1);
  assert.equal(count(database, "trade_crm_commercial_handovers"), 0);
  assert.equal(count(database, "trade_crm_accepted_invoices"), 0);
  assert.equal(count(database, "trade_crm_quote_events"), 1);
  assert.deepEqual({ ...database.prepare("SELECT invoiced_value_cents, invoice_status, payment_due_at FROM trade_crm_job_details").get() }, {
    invoiced_value_cents: 0,
    invoice_status: "not_started",
    payment_due_at: "",
  });
  database.close();
});

test("an existing payable invoice keeps acceptance valid but prevents a second payment request", async () => {
  for (const [label, insert] of [
    ["quick invoice", "INSERT INTO trade_crm_quick_invoices VALUES ('quick-1', ?, ?, 'issued')"],
    ["accounting invoice", "INSERT INTO trade_crm_accounting_documents VALUES ('accounting-1', ?, ?, 'invoice', 'exported')"],
  ]) {
    const database = fixture();
    database.prepare(`UPDATE trade_crm_job_details
      SET invoiced_value_cents = 12345, paid_value_cents = 2345, invoice_status = 'exported',
        payment_due_at = '2026-09-30'`).run();
    database.prepare(insert).run(ids.work, ids.owner);
    const response = await loadRoute(database).POST(decisionRequest(), context);
    assert.equal(response.status, 200, label);
    const body = await response.json();
    assert.equal(body.receipt.decision, "accepted", label);
    assert.equal(body.receipt.invoice.status, "attention_required", label);
    assert.equal(body.receipt.invoice.issueBlockerCode, "ACCEPTED_INVOICE_CONFLICT", label);
    assert.equal(body.receipt.payment.availability, "not_configured", label);
    assert.equal(body.receipt.payment.amountDueCents, 0, label);
    assert.equal(body.receipt.payment.accountNumber, "", label);
    assert.equal(count(database, "trade_crm_quote_acceptances"), 1, label);
    assert.equal(count(database, "trade_crm_commercial_handovers"), 1, label);
    assert.equal(count(database, "trade_crm_accepted_invoices"), 1, label);
    const invoice = database.prepare("SELECT status, issue_blocker_code, payment_snapshot_json FROM trade_crm_accepted_invoices").get();
    assert.equal(invoice.status, "attention_required", label);
    assert.equal(invoice.issue_blocker_code, "ACCEPTED_INVOICE_CONFLICT", label);
    assert.deepEqual(JSON.parse(invoice.payment_snapshot_json), { available: false, method: "unavailable" }, label);
    assert.deepEqual({ ...database.prepare("SELECT invoiced_value_cents, paid_value_cents, invoice_status, payment_due_at FROM trade_crm_job_details").get() }, {
      invoiced_value_cents: 12_345,
      paid_value_cents: 2_345,
      invoice_status: "exported",
      payment_due_at: "2026-09-30",
    }, label);
    database.close();
  }
});

test("manual job finance creates a non-payable attention invoice and preserves the authoritative amounts", async () => {
  const database = fixture();
  database.prepare(`UPDATE trade_crm_job_details
    SET invoiced_value_cents = 22222, paid_value_cents = 3333,
      invoice_status = 'partially_paid', payment_due_at = '2026-10-15'`).run();
  const response = await loadRoute(database).POST(decisionRequest(), context);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.receipt.decision, "accepted");
  assert.equal(body.receipt.invoice.status, "attention_required");
  assert.equal(body.receipt.invoice.totalCents, 391_600);
  assert.equal(body.receipt.invoice.issueBlockerCode, "ACCEPTED_INVOICE_CONFLICT");
  assert.equal(body.receipt.payment.availability, "not_configured");
  assert.equal(body.receipt.payment.amountDueCents, 0);
  assert.deepEqual({ ...database.prepare(`SELECT quoted_value_cents, quote_status,
      invoiced_value_cents, paid_value_cents, invoice_status, payment_due_at
    FROM trade_crm_job_details`).get() }, {
    quoted_value_cents: 391_600,
    quote_status: "accepted",
    invoiced_value_cents: 22_222,
    paid_value_cents: 3_333,
    invoice_status: "partially_paid",
    payment_due_at: "2026-10-15",
  });
  assert.equal(count(database, "trade_crm_quote_acceptances"), 1);
  assert.equal(count(database, "trade_crm_commercial_handovers"), 1);
  assert.equal(count(database, "trade_crm_accepted_invoices"), 1);
  assert.equal(count(database, "trade_crm_quote_events"), 1);
  database.close();
});

test("a payable invoice racing the acceptance transaction cannot create a second payable invoice", async () => {
  const database = fixture();
  const route = loadRoute(database, targetSnapshot, (current) => {
    current.prepare("INSERT INTO trade_crm_quick_invoices VALUES ('raced-quick', ?, ?, 'issued')")
      .run(ids.work, ids.owner);
  });
  const originalError = console.error;
  console.error = () => {};
  try {
    const response = await route.POST(decisionRequest(), context);
    assert.equal(response.status, 409);
    assert.match((await response.json()).error, /changed before your decision/i);
  } finally {
    console.error = originalError;
  }
  for (const table of ["trade_crm_quote_acceptances", "trade_crm_commercial_handovers", "trade_crm_accepted_invoices", "trade_crm_quote_events"]) {
    assert.equal(count(database, table), 0, table);
  }
  assert.equal(count(database, "trade_crm_quick_invoices"), 1);
  assert.equal(database.prepare("SELECT status FROM trade_crm_quote_links").get().status, "active");
  assert.equal(database.prepare("SELECT status FROM trade_crm_quote_versions").get().status, "issued");
  assert.deepEqual({ ...database.prepare("SELECT invoiced_value_cents, invoice_status, payment_due_at FROM trade_crm_job_details").get() }, {
    invoiced_value_cents: 0,
    invoice_status: "not_started",
    payment_due_at: "",
  });
  database.close();
});
