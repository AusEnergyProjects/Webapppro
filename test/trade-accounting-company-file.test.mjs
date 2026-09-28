import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import ts from "typescript";
import * as accounting from "../src/lib/trade-accounting.ts";
import * as providerExport from "../src/lib/trade-accounting-export.ts";
import * as mfa from "../src/lib/firebase-mfa.ts";
import * as automation from "../src/lib/trade-accounting-automation.ts";
import { buildAcceptedInvoiceSnapshot } from "../src/lib/trade-accepted-invoice.ts";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const statements = (sql) => sql.split("--> statement-breakpoint").map((part) => part.trim()).filter(Boolean);
const apply = (db, path) => statements(read(path)).forEach((sql) => db.exec(sql));
const source = read("../src/lib/trade-accounting-server.ts");
// Execute the actual route functions with only external IO replaced by the fixture.
const compiled = ts.transpileModule(`${source}\nexport { activeCredentials, exportInvoice, refreshInvoice, myobFetch, xeroFetch, quickBooksFetch, accountingErrorDetail };`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const accessPolicy = {};
// Run the real ABN/review SQL predicate without importing worker-only access IO.
Function("require", "exports", ts.transpileModule(read("../src/lib/trade-access-server.ts"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText)(() => ({}), accessPolicy);

const job = {
  id: "job-one", invoice_source: "quick_invoice", quick_invoice_id: "invoice-one",
  commercial_handoff_id: "", commercial_reference: "INV-ONE",
  accepted_subtotal_cents: 10000, accepted_tax_cents: 1000, accepted_total_cents: 11000,
  scope_snapshot_json: JSON.stringify([{
    lineId: "line-one", lineType: "product", section: "Work", description: "Synthetic test product",
    quantityMilli: 1000, subtotalCents: 10000, taxCents: 1000, totalCents: 11000,
  }]),
};

function fixture(t, options = {}) {
  const sqlite = new DatabaseSync(":memory:");
  t.after(() => sqlite.close());
  apply(sqlite, "../drizzle/0020_lying_stick.sql");
  apply(sqlite, "../drizzle/0022_worried_sleepwalker.sql");
  statements(read("../drizzle/0068_accepted_quote_handoff.sql"))
    .filter((sql) => sql.startsWith("ALTER TABLE `trade_crm_accounting_documents`"))
    .forEach((sql) => sqlite.exec(sql));
  apply(sqlite, "../drizzle/0181_accounting_export_defaults.sql");
  const insertLegacy = () => sqlite.prepare(`INSERT INTO trade_crm_accounting_documents
    (id, work_order_id, firebase_uid, provider, commercial_reference, external_document_id, status, created_at, updated_at)
    VALUES ('document-one', 'job-one', 'owner-one', 'myob', 'INV-ONE', 'provider-invoice', 'error', 'now', 'now')`).run();
  if (options.legacy) insertLegacy();
  apply(sqlite, "../drizzle/0185_accounting_company_file_binding.sql");
  sqlite.exec(`CREATE TABLE trade_accounts (
    firebase_uid TEXT PRIMARY KEY, partner_type TEXT, account_status TEXT, verification_status TEXT,
    abn TEXT, verified_abn TEXT, business_name TEXT, verification_review_id TEXT,
    verification_reviewed_at TEXT, verification_reviewed_by_uid TEXT);
    CREATE TABLE trade_account_verification_reviews (
      id TEXT, firebase_uid TEXT, abn TEXT, business_name TEXT, partner_type TEXT, decision TEXT,
      review_method TEXT, reviewed_by_uid TEXT, reviewed_at TEXT);
    CREATE TABLE trade_work_orders (id TEXT, firebase_uid TEXT, work_number TEXT, title TEXT, source_type TEXT, partner_type TEXT, record_status TEXT);
    CREATE TABLE trade_crm_job_details (work_order_id TEXT, firebase_uid TEXT, customer_source TEXT, crm_customer_id TEXT,
      invoiced_value_cents INTEGER, paid_value_cents INTEGER, payment_due_at TEXT,
      accepted_disclosure_snapshot TEXT, accepted_disclosure_sha256 TEXT, accepted_disclosure_at TEXT);
    CREATE TABLE trade_crm_customers (id TEXT, firebase_uid TEXT, record_status TEXT, customer_number TEXT, customer_type TEXT,
      first_name TEXT, last_name TEXT, business_name TEXT, email TEXT, phone TEXT,
      address_line_1 TEXT, address_line_2 TEXT, suburb TEXT, address_state TEXT, postcode TEXT);
    CREATE TABLE trade_crm_accepted_invoices (id TEXT PRIMARY KEY, firebase_uid TEXT, work_order_id TEXT, crm_customer_id TEXT,
      acceptance_id TEXT, quote_id TEXT, quote_version_id TEXT, invoice_number TEXT, source_snapshot_sha256 TEXT,
      document_snapshot_json TEXT, subtotal_cents INTEGER, tax_cents INTEGER, total_cents INTEGER, due_at TEXT,
      status TEXT, issue_blocker_code TEXT, commercial_handoff_id TEXT, created_at TEXT);
    CREATE TABLE trade_crm_commercial_handovers (id TEXT, acceptance_id TEXT, quote_id TEXT, quote_version_id TEXT,
      work_order_id TEXT, firebase_uid TEXT, crm_customer_id TEXT, status TEXT, commercial_reference TEXT,
      scope_snapshot_json TEXT, subtotal_cents INTEGER, tax_cents INTEGER, total_cents INTEGER, accepted_at TEXT);
    CREATE TABLE trade_crm_quote_acceptances (id TEXT, quote_id TEXT, quote_version_id TEXT, work_order_id TEXT,
      firebase_uid TEXT, crm_customer_id TEXT, decision TEXT, result_invoice_id TEXT, invoice_creation_status TEXT);
    CREATE TABLE trade_crm_quick_invoices (id TEXT, work_order_id TEXT, firebase_uid TEXT, invoice_number TEXT,
      line_items_json TEXT, subtotal_cents INTEGER, discount_cents INTEGER, tax_cents INTEGER, total_cents INTEGER,
      due_at TEXT, status TEXT, delivery_status TEXT);
    CREATE TABLE trade_crm_quick_invoice_credits (invoice_id TEXT, total_cents INTEGER, status TEXT);`);
  apply(sqlite, "../drizzle/0204_accepted_invoice_accounting_automation.sql");
  const calls = { fetch: 0, decrypt: 0, audit: [] };
  const api = {
    prepare(sql) {
      const statement = sqlite.prepare(sql);
      return { bind(...values) {
        return {
          async first() { return statement.get(...values) || null; },
          async all() { return { results: statement.all(...values) }; },
          async run() { return { meta: { changes: Number(statement.run(...values).changes) } }; },
        };
      } };
    },
    async batch(items) {
      sqlite.exec("BEGIN");
      try { const result = await Promise.all(items.map((item) => item.run())); sqlite.exec("COMMIT"); return result; }
      catch (error) { sqlite.exec("ROLLBACK"); throw error; }
    },
  };
  const exports = {};
  const fakeFetch = async (...args) => {
    calls.fetch++;
    if (options.fetch) return options.fetch(sqlite, ...args);
    throw new Error("Unexpected provider request");
  };
  const access = { ownerUid: "owner-one", actorUid: "staff-one", isOwner: true, canViewInvoices: true, canManageInvoices: true,
    ...(options.mfa === false ? {} : { identity: { secondFactor: "totp" } }) };
  const require = (id) => {
    if (id.endsWith("/db")) return { getD1: () => api };
    if (id === "@/lib/admin-server") return {
      adminJson: (body, status = 200) => Response.json(body, { status }),
      cleanAdminText: (value, limit) => String(value || "").trim().slice(0, limit),
      sameOrigin: () => true,
    };
    if (id === "@/lib/trade-accounting") return accounting;
    if (id === "@/lib/trade-accounting-export") return providerExport;
    if (id === "@/lib/firebase-mfa") return mfa;
    if (id === "@/lib/trade-access-server") return accessPolicy;
    if (id === "./trade-accounting-automation") return automation;
    if (id === "@/lib/trade-integration-crypto") return {
      decryptIntegrationCredentials: async (value) => { calls.decrypt++; return JSON.parse(value); },
      encryptIntegrationCredentials: async (value) => JSON.stringify(value),
    };
    if (id === "@/lib/trade-integrations-server") return { providerSetting: () => ({ tokenUrl: "https://provider.example/token", clientId: "synthetic-id", clientSecret: "synthetic-secret" }) };
    if (id === "@/lib/trade-team-server") return { requireInstallerTeamAccess: async () => access, assignedJob: async () => {} };
    if (id === "@/lib/myob-security-audit") return { writeMyobSecurityEvent: async (_db, event) => {
      if (options.auditFailure) throw new Error("MYOB_SECURITY_AUDIT_UNAVAILABLE");
      calls.audit.push(event);
    } };
    throw new Error(`Unexpected dependency ${id}`);
  };
  Function("require", "exports", "fetch", compiled)(require, exports, fakeFetch);
  const connect = (provider = "myob", owner = "owner-one", file = "file-one", credentials = { access_token: "synthetic-access", refresh_token: "synthetic-refresh" }) => {
    sqlite.prepare(`INSERT INTO trade_crm_integrations
      (id, firebase_uid, provider, external_account_id, encrypted_credentials, scopes, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'now', 'now')`)
      .run(`${owner}-${provider}`, owner, provider, file, JSON.stringify(credentials), JSON.stringify(["sme-sales", "sme-contacts-customer", "sme-general-ledger", "accounting.settings.read"]));
    return connection(owner, provider);
  };
  const connection = (owner = "owner-one", provider = "myob") => sqlite.prepare("SELECT * FROM trade_crm_integrations WHERE firebase_uid = ? AND provider = ?").get(owner, provider);
  const seedDocument = (provider = "myob", file = "file-one", owner = "owner-one", external = "provider-invoice") => {
    sqlite.prepare(`INSERT INTO trade_crm_accounting_documents
      (id, work_order_id, firebase_uid, provider, external_account_id, commercial_reference, external_document_id, status, created_at, updated_at)
      VALUES ('document-one', 'job-one', ?, ?, ?, 'INV-ONE', ?, 'error', 'now', 'now')`).run(owner, provider, file, external);
  };
  const request = (body) => new Request("https://tlink.example/api/trade-accounting", { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });
  const insert = (table, row) => sqlite.prepare(`INSERT INTO ${table} (${Object.keys(row).join(",")}) VALUES (${Object.keys(row).map(() => "?").join(",")})`).run(...Object.values(row));
  const approvedOwner = (owner = "owner-one") => {
    insert("trade_accounts", { firebase_uid: owner, partner_type: "installer", account_status: "active", verification_status: "approved",
      abn: "51824753556", verified_abn: "51824753556", business_name: "Synthetic business", verification_review_id: `${owner}-review`,
      verification_reviewed_at: "2026-09-28T03:00:00.000Z", verification_reviewed_by_uid: "admin" });
    insert("trade_account_verification_reviews", { id: `${owner}-review`, firebase_uid: owner, abn: "51824753556", business_name: "Synthetic business",
      partner_type: "installer", decision: "approved", review_method: "official_abr_lookup", reviewed_by_uid: "admin", reviewed_at: "2026-09-28T03:00:00.000Z" });
  };
  const acceptedInvoice = async (provider = "xero") => {
    const invoice = await buildAcceptedInvoiceSnapshot({
      invoiceId: "accepted-one", invoiceNumber: "INV-ONE", acceptanceId: "acceptance-one", commercialHandoffId: "handoff-one",
      quoteId: "quote-one", quoteVersionId: "version-one", workOrderId: "job-one", firebaseUid: "owner-one", crmCustomerId: "customer-one",
      issuedAt: "2026-09-28T03:00:00.000Z", dueAt: "2026-10-12", scope: JSON.parse(job.scope_snapshot_json),
      totals: { subtotalCents: 10000, taxCents: 1000, totalCents: 11000 },
      business: { name: "Synthetic business", email: "office@example.test", phone: "", abn: "51824753556", address: "" },
      customer: { name: "Synthetic Customer", email: "customer@example.test", phone: "", number: "CUS-ONE" },
      site: { label: "Site", addressLine1: "1 Example Road", addressLine2: "", suburb: "Melbourne", state: "VIC", postcode: "3000", summary: "1 Example Road" },
      work: { number: "JOB-ONE", title: "Synthetic work" }, payment: { accountName: "", bsb: "", accountNumber: "", reference: "", terms: "" },
    });
    insert("trade_work_orders", { id: "job-one", firebase_uid: "owner-one", work_number: "JOB-ONE", title: "Synthetic work", source_type: "internal", partner_type: "installer", record_status: "active" });
    insert("trade_crm_job_details", { work_order_id: "job-one", firebase_uid: "owner-one", crm_customer_id: "customer-one", customer_source: "trade_owned", invoiced_value_cents: 11000, paid_value_cents: 0, payment_due_at: invoice.dueAt });
    insert("trade_crm_customers", { id: "customer-one", firebase_uid: "owner-one", record_status: "active", customer_number: "CUS-ONE" });
    insert("trade_crm_quote_acceptances", { id: "acceptance-one", quote_id: "quote-one", quote_version_id: "version-one", work_order_id: "job-one", firebase_uid: "owner-one", crm_customer_id: "customer-one", decision: "accepted", result_invoice_id: "accepted-one", invoice_creation_status: "issued" });
    insert("trade_crm_commercial_handovers", { id: "handoff-one", acceptance_id: "acceptance-one", quote_id: "quote-one", quote_version_id: "version-one", work_order_id: "job-one", firebase_uid: "owner-one", crm_customer_id: "customer-one", status: "accepted", commercial_reference: "INV-ONE", scope_snapshot_json: job.scope_snapshot_json, subtotal_cents: 10000, tax_cents: 1000, total_cents: 11000, accepted_at: "2026-09-28T03:00:00.000Z" });
    insert("trade_crm_accepted_invoices", { id: "accepted-one", firebase_uid: "owner-one", work_order_id: "job-one", crm_customer_id: "customer-one", acceptance_id: "acceptance-one", quote_id: "quote-one", quote_version_id: "version-one", invoice_number: "INV-ONE", source_snapshot_sha256: invoice.sourceSnapshotSha256, document_snapshot_json: invoice.documentSnapshotJson, subtotal_cents: 10000, tax_cents: 1000, total_cents: 11000, due_at: invoice.dueAt, status: "issued", issue_blocker_code: "", commercial_handoff_id: "handoff-one", created_at: "2026-09-28T03:00:00.000Z" });
    return { invoice_id: "accepted-one", firebase_uid: "owner-one", work_order_id: "job-one", connection_id: `owner-one-${provider}`, provider, external_account_id: "file-one", account_reference: "income", attempts: 0 };
  };
  return { sqlite, calls, ...exports, connect, connection, seedDocument, access,
    approvedOwner, acceptedInvoice,
    post: (body) => exports.POST(request({ workOrderId: "job-one", invoiceSource: "quick_invoice", ...body })) };
}

test("accounting bindings require the exact owner, provider and company file", () => {
  for (const provider of ["myob", "xero", "quickbooks"]) {
    const document = { firebase_uid: "owner", provider, external_account_id: "file" };
    assert.doesNotThrow(() => accounting.assertAccountingDocumentConnection(document, { ...document }));
    for (const mismatch of [{ firebase_uid: "other" }, { provider: "other" }, { external_account_id: "other" }]) {
      assert.throws(() => accounting.assertAccountingDocumentConnection(document, { ...document, ...mismatch }), /ACCOUNTING_COMPANY_FILE_MISMATCH/);
    }
    assert.throws(() => accounting.assertAccountingDocumentConnection({ ...document, external_account_id: "" }, document), /ACCOUNTING_COMPANY_FILE_UNBOUND/);
  }
});

test("the public accounting route exposes the real shared GET and POST handlers", (t) => {
  const route = read("../src/app/api/trade-accounting/route.ts");
  assert.match(route, /export const runtime = "edge"/);
  assert.match(route, /export\s*\{\s*GET,\s*POST\s*\}\s*from\s*"@\/lib\/trade-accounting-server"/);
  const h = fixture(t);
  assert.equal(typeof h.GET, "function");
  assert.equal(typeof h.POST, "function");
});

test("migration preserves legacy exports without guessing their company file", async (t) => {
  const h = fixture(t, { legacy: true });
  h.connect();
  assert.equal(h.sqlite.prepare("SELECT external_account_id FROM trade_crm_accounting_documents").get().external_account_id, "");
  assert.throws(() => h.sqlite.exec("UPDATE trade_crm_accounting_documents SET external_account_id = 'file-one'"), /ACCOUNTING_COMPANY_FILE_IMMUTABLE/);
  await assert.rejects(h.exportInvoice("owner-one", "myob", job, "income"), /ACCOUNTING_COMPANY_FILE_UNBOUND/);
  await assert.rejects(h.refreshInvoice("owner-one", job), /ACCOUNTING_COMPANY_FILE_UNBOUND/);
  assert.equal(h.calls.fetch, 0);
  assert.equal(h.calls.decrypt, 0);
});

test("database rejects unmatched and disconnected bindings and makes original bindings immutable", (t) => {
  const h = fixture(t);
  h.connect();
  assert.throws(() => h.seedDocument("myob", "wrong-file"), /ACCOUNTING_COMPANY_FILE_MISMATCH/);
  assert.throws(() => h.seedDocument("myob", "file-one", "other-owner"), /ACCOUNTING_COMPANY_FILE_MISMATCH/);
  assert.throws(() => h.seedDocument("xero"), /ACCOUNTING_COMPANY_FILE_MISMATCH/);
  h.sqlite.exec("UPDATE trade_crm_integrations SET status = 'disconnected'");
  assert.throws(() => h.seedDocument(), /ACCOUNTING_COMPANY_FILE_MISMATCH/);
  h.sqlite.exec("UPDATE trade_crm_integrations SET status = 'connected'");
  h.seedDocument();
  for (const assignment of ["firebase_uid = 'other'", "provider = 'xero'", "external_account_id = 'other'"]) {
    assert.throws(() => h.sqlite.exec(`UPDATE trade_crm_accounting_documents SET ${assignment}`), /ACCOUNTING_COMPANY_FILE_IMMUTABLE/);
  }
});

test("reused, retried and refreshed invoices cannot cross a changed company file", async (t) => {
  for (const external of ["provider-invoice", ""]) {
    await t.test(external ? "existing invoice" : "failed export retry", async (t) => {
      const h = fixture(t);
      h.connect(); h.seedDocument("myob", "file-one", "owner-one", external);
      h.sqlite.exec("UPDATE trade_crm_integrations SET external_account_id = 'file-two'");
      await assert.rejects(h.exportInvoice("owner-one", "myob", job, "income"), /ACCOUNTING_COMPANY_FILE_MISMATCH/);
      if (external) await assert.rejects(h.refreshInvoice("owner-one", job), /ACCOUNTING_COMPANY_FILE_MISMATCH/);
      assert.equal(h.calls.fetch, 0); assert.equal(h.calls.decrypt, 0);
      assert.equal(h.sqlite.prepare("SELECT external_account_id FROM trade_crm_accounting_documents").get().external_account_id, "file-one");
    });
  }
});

test("matching existing exports remain idempotent for every accounting provider", async (t) => {
  for (const provider of ["myob", "xero", "quickbooks"]) {
    await t.test(provider, async (t) => {
      const h = fixture(t); h.approvedOwner(); h.connect(provider); h.seedDocument(provider);
      const existing = await h.exportInvoice("owner-one", provider, job, "income");
      assert.equal(existing.external_document_id, "provider-invoice");
      assert.equal(h.calls.fetch, 0); assert.equal(h.calls.decrypt, 0);
      await assert.rejects(h.exportInvoice("owner-one", provider, { ...job, commercial_reference: "INV-TWO" }, "income"), /DOCUMENT_ALREADY_EXPORTED/);
    });
  }
});

test("new export reservations persist the exact authenticated owner and company file", async (t) => {
  const h = fixture(t); h.approvedOwner(); h.connect("myob", "owner-one", "file-one", {});
  await assert.rejects(h.exportInvoice("owner-one", "myob", job, "income"), /INTEGRATION_REQUIRED/);
  const document = h.sqlite.prepare("SELECT * FROM trade_crm_accounting_documents").get();
  assert.equal(document.firebase_uid, "owner-one"); assert.equal(document.provider, "myob");
  assert.equal(document.external_account_id, "file-one"); assert.equal(document.status, "error");
  await assert.rejects(h.exportInvoice("owner-one", "myob", job, "income"), /INTEGRATION_REQUIRED/);
  assert.equal(h.sqlite.prepare("SELECT COUNT(*) AS total FROM trade_crm_accounting_documents").get().total, 1);
  assert.equal(h.calls.fetch, 0);
});

test("provider requests stop when their original connection changes", async (t) => {
  for (const provider of ["myob", "xero", "quickbooks"]) {
    await t.test(provider, async (t) => {
      const h = fixture(t); h.approvedOwner(); const original = h.connect(provider);
      h.sqlite.exec("UPDATE trade_crm_integrations SET external_account_id = 'file-two'");
      await assert.rejects(h[`${provider === "quickbooks" ? "quickBooks" : provider}Fetch`](original, { access_token: "synthetic-access" }, "invoices"), /INTEGRATION_CONNECTION_CHANGED/);
      assert.equal(h.calls.fetch, 0);
    });
  }
});

test("an in-flight token refresh cannot overwrite a new file, reauthorisation or disconnect", async (t) => {
  for (const mutation of ["external_account_id = 'file-two'", "encrypted_credentials = '{\"access_token\":\"new-authorisation\"}'", "status = 'disconnected'"]) {
    await t.test(mutation, async (t) => {
      const h = fixture(t, { fetch: async (db) => {
        db.exec(`UPDATE trade_crm_integrations SET ${mutation}`);
        return Response.json({ access_token: "stale-refreshed-access", refresh_token: "stale-refreshed-refresh", expires_in: 3600 });
      } });
      h.approvedOwner(); const original = h.connect();
      await assert.rejects(h.activeCredentials("myob", original), /INTEGRATION_CONNECTION_CHANGED/);
      assert.doesNotMatch(h.connection().encrypted_credentials, /stale-refreshed/);
      assert.equal(h.calls.fetch, 1);
    });
  }
});

test("a current connection can rotate its own tokens without changing another tenant", async (t) => {
  const h = fixture(t, { fetch: async () => Response.json({ access_token: "new-access", refresh_token: "new-refresh", expires_in: 3600 }) });
  h.approvedOwner(); const connection = h.connect(); const other = h.connect("myob", "owner-two", "file-two");
  const updated = await h.activeCredentials("myob", connection);
  assert.equal(updated.access_token, "new-access");
  assert.equal(JSON.parse(h.connection().encrypted_credentials).refresh_token, "new-refresh");
  assert.equal(h.connection("owner-two").encrypted_credentials, other.encrypted_credentials);
});

test("MYOB error storage excludes arbitrary customer data and secrets", (t) => {
  const h = fixture(t);
  assert.equal(h.accountingErrorDetail(new Error("Customer Name: sensitive-token-value"), "myob"), "PROVIDER_REQUEST_FAILED");
  assert.equal(h.accountingErrorDetail(new Error("ACCOUNTING_COMPANY_FILE_MISMATCH"), "myob"), "ACCOUNTING_COMPANY_FILE_MISMATCH");
});

test("MYOB export and history require verified MFA before finance reads or provider calls", async (t) => {
  const h = fixture(t, { mfa: false }); h.connect(); h.seedDocument();
  for (const body of [{ action: "export", provider: "myob" }, { action: "refresh" }]) {
    const response = await h.post(body);
    assert.equal(response.status, 403); assert.equal((await response.json()).setupUrl, "/direct-trade/security");
  }
  const history = await h.GET(new Request("https://tlink.example/api/trade-accounting?workOrderId=job-one"));
  assert.equal(history.status, 403); assert.equal(h.calls.fetch, 0); assert.equal(h.calls.decrypt, 0);
  assert.deepEqual(h.calls.audit.map((event) => event.outcome), ["denied", "denied", "denied"]);
  assert.ok(h.calls.audit.every((event) => event.actorUid === "staff-one" && event.ownerUid === "owner-one"));
});

test("MYOB provider actions fail closed when security logging cannot be written", async (t) => {
  const h = fixture(t, { auditFailure: true }); h.connect();
  await assert.rejects(h.post({ action: "export", provider: "myob" }), /MYOB_SECURITY_AUDIT_UNAVAILABLE/);
  assert.equal(h.calls.fetch, 0); assert.equal(h.calls.decrypt, 0);
});

test("automatic export requires a current approved installer and authoritative matching ABN review", async (t) => {
  const mutations = [
    "DELETE FROM trade_accounts", "UPDATE trade_accounts SET account_status = 'suspended'",
    "UPDATE trade_accounts SET partner_type = 'supplier'", "UPDATE trade_accounts SET verification_status = 'pending'",
    "UPDATE trade_accounts SET abn = '12345678901', verified_abn = '12345678901'",
    "DELETE FROM trade_account_verification_reviews", "UPDATE trade_account_verification_reviews SET decision = 'rejected'",
  ];
  for (const mutation of mutations) await t.test(mutation, async (t) => {
    const h = fixture(t); h.approvedOwner(); h.connect("xero"); const dispatch = await h.acceptedInvoice();
    h.sqlite.exec(mutation);
    await assert.rejects(h.exportAcceptedInvoiceAutomatically(dispatch), /ACCOUNT_INACTIVE/);
    assert.equal(h.calls.fetch, 0); assert.equal(h.calls.decrypt, 0);
    assert.equal(h.sqlite.prepare("SELECT COUNT(*) AS total FROM trade_crm_accounting_documents").get().total, 0);
  });
});

test("automatic export rejects stale connection identities and company bindings before provider access", async (t) => {
  for (const mutation of ["id = 'replacement-connection'", "external_account_id = 'replacement-file'", "status = 'disconnected'"]) {
    await t.test(mutation, async (t) => {
      const h = fixture(t); h.approvedOwner(); h.connect("xero"); const dispatch = await h.acceptedInvoice();
      h.sqlite.exec(`UPDATE trade_crm_integrations SET ${mutation}`);
      await assert.rejects(h.exportAcceptedInvoiceAutomatically(dispatch), /ACCOUNTING_COMPANY_FILE_MISMATCH|INTEGRATION_REQUIRED/);
      assert.equal(h.calls.fetch, 0); assert.equal(h.calls.decrypt, 0);
    });
  }
});

test("automatic MYOB export needs its durable MFA grant and fails closed if audit logging is unavailable", async (t) => {
  const h = fixture(t); h.approvedOwner(); h.connect(); const dispatch = await h.acceptedInvoice("myob");
  await assert.rejects(h.exportAcceptedInvoiceAutomatically(dispatch), /MFA_REQUIRED/);
  assert.equal(h.calls.fetch, 0); assert.equal(h.calls.decrypt, 0);
  const auditFailure = fixture(t, { auditFailure: true }); auditFailure.approvedOwner(); auditFailure.connect();
  const authorised = await auditFailure.acceptedInvoice("myob");
  auditFailure.sqlite.exec("UPDATE trade_crm_integrations SET invoice_sync_mfa_verified_at = '2026-09-28T03:00:00.000Z'");
  await assert.rejects(auditFailure.exportAcceptedInvoiceAutomatically(authorised), /MYOB_SECURITY_AUDIT_UNAVAILABLE/);
  assert.equal(auditFailure.calls.fetch, 0); assert.equal(auditFailure.calls.decrypt, 0);
});

test("automatic exports require the exact immutable accepted invoice and never use a different job or quote version", async (t) => {
  const cases = [
    { name: "different invoice", patch: { invoice_id: "another-invoice" }, error: /ACCEPTED_INVOICE_ACCESS_REQUIRED/ },
    { name: "different job", patch: { work_order_id: "another-job" }, error: /DIRECT_CUSTOMER_REQUIRED/ },
    { name: "different owner", patch: { firebase_uid: "another-owner" }, error: /ACCOUNT_INACTIVE/ },
    { name: "changed source hash", sql: "UPDATE trade_crm_accepted_invoices SET source_snapshot_sha256 = 'changed'", error: /ACCEPTED_INVOICE_ACCESS_REQUIRED/ },
    { name: "changed quote version", sql: "UPDATE trade_crm_accepted_invoices SET quote_version_id = 'another-version'", error: /ACCEPTED_HANDOFF_REQUIRED/ },
    { name: "changed signed lines", sql: "UPDATE trade_crm_accepted_invoices SET document_snapshot_json = json_set(document_snapshot_json, '$.lines[0].description', 'Changed work')", error: /ACCEPTED_INVOICE_ACCESS_REQUIRED/ },
    { name: "blocked invoice", sql: "UPDATE trade_crm_accepted_invoices SET issue_blocker_code = 'ACCEPTED_INVOICE_CONFLICT'", error: /ACCEPTED_HANDOFF_REQUIRED/ },
    { name: "protected customer", sql: "UPDATE trade_crm_job_details SET customer_source = 'platform_private'", error: /DIRECT_CUSTOMER_REQUIRED/ },
  ];
  for (const item of cases) await t.test(item.name, async (t) => {
    const h = fixture(t); h.approvedOwner(); h.connect("xero"); const dispatch = await h.acceptedInvoice();
    if (item.sql) h.sqlite.exec(item.sql);
    await assert.rejects(h.exportAcceptedInvoiceAutomatically({ ...dispatch, ...item.patch }), item.error);
    assert.equal(h.calls.fetch, 0); assert.equal(h.calls.decrypt, 0);
    assert.equal(h.sqlite.prepare("SELECT COUNT(*) AS total FROM trade_crm_accounting_documents").get().total, 0);
  });
});

test("automatic exports reuse matching provider invoices without duplicating them", async (t) => {
  for (const provider of ["myob", "xero", "quickbooks"]) await t.test(provider, async (t) => {
    const h = fixture(t); h.approvedOwner(); h.connect(provider); const dispatch = await h.acceptedInvoice(provider);
    h.sqlite.exec("UPDATE trade_crm_integrations SET invoice_sync_mfa_verified_at = '2026-09-28T03:00:00.000Z'");
    h.seedDocument(provider);
    h.sqlite.exec("UPDATE trade_crm_accounting_documents SET commercial_handoff_id = 'handoff-one'");
    const first = await h.exportAcceptedInvoiceAutomatically(dispatch);
    const second = await h.exportAcceptedInvoiceAutomatically(dispatch);
    assert.equal(first.external_document_id, "provider-invoice"); assert.equal(second.id, first.id);
    assert.equal(h.calls.fetch, 0); assert.equal(h.calls.decrypt, 0);
    if (provider === "myob") assert.deepEqual(h.calls.audit.map((event) => event.outcome), ["attempt", "success", "attempt", "success"]);
  });
});

test("every provider blocks later contact and invoice writes when approval is revoked after a read", async (t) => {
  for (const provider of ["myob", "xero", "quickbooks"]) await t.test(provider, async (t) => {
    const requests = [];
    const h = fixture(t, { fetch: async (db, _url, init) => {
      requests.push(init.method || "GET");
      db.exec("UPDATE trade_account_verification_reviews SET decision = 'rejected'");
      return Response.json({});
    } });
    h.approvedOwner(); const connection = h.connect(provider, "owner-one", provider === "quickbooks" ? "12345" : "file-one");
    const request = h[`${provider === "quickbooks" ? "quickBooks" : provider}Fetch`];
    await request(connection, { access_token: "synthetic-access" }, "accounts");
    for (const path of ["contacts", "invoices"]) {
      await assert.rejects(request(connection, { access_token: "synthetic-access" }, path,
        { method: "POST", body: "{}" }), /INTEGRATION_CONNECTION_CHANGED/);
    }
    assert.deepEqual(requests, ["GET"]); assert.equal(h.calls.fetch, 1);
  });
});

test("automatic invoice export stops if its owner is revoked during provider discovery", async (t) => {
  for (const revokeAfter of ["Accounts", "Invoices"]) await t.test(revokeAfter, async (t) => {
    const requests = [];
    const h = fixture(t, { fetch: async (db, url, init) => {
      const resource = new URL(url).pathname.split("/").at(-1);
      requests.push({ resource, method: init.method || "GET" });
      if (resource === revokeAfter) db.exec("UPDATE trade_accounts SET account_status = 'suspended'");
      if (resource === "Accounts") return Response.json({ Accounts: [{ Status: "ACTIVE", Type: "REVENUE", Code: "income", Name: "Sales" }] });
      if (resource === "Contacts") return Response.json({ Contacts: [] });
      if (resource === "Invoices") return Response.json({ Invoices: [] });
      throw new Error(`Unexpected provider resource ${resource}`);
    } });
    h.approvedOwner(); h.connect("xero"); const dispatch = await h.acceptedInvoice();
    h.sqlite.prepare("UPDATE trade_crm_integrations SET token_expires_at = ?").run(new Date(Date.now() + 3600_000).toISOString());
    await assert.rejects(h.exportAcceptedInvoiceAutomatically(dispatch), /INTEGRATION_CONNECTION_CHANGED/);
    assert.equal(requests.at(-1).resource, revokeAfter);
    assert.ok(requests.every((request) => request.method === "GET"));
    const stored = h.sqlite.prepare("SELECT external_document_id, external_contact_id, status FROM trade_crm_accounting_documents").get();
    assert.equal(stored.external_document_id, ""); assert.equal(stored.external_contact_id, "");
    assert.equal(stored.status, "error");
  });
});
