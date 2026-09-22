import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import ts from "typescript";
import * as accounting from "../src/lib/trade-accounting.ts";
import * as providerExport from "../src/lib/trade-accounting-export.ts";
import * as mfa from "../src/lib/firebase-mfa.ts";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const statements = (sql) => sql.split("--> statement-breakpoint").map((part) => part.trim()).filter(Boolean);
const apply = (db, path) => statements(read(path)).forEach((sql) => db.exec(sql));
const source = read("../src/app/api/trade-accounting/route.ts");
// Execute the actual route functions with only external IO replaced by the fixture.
const compiled = ts.transpileModule(`${source}\nexport { activeCredentials, exportInvoice, refreshInvoice, myobFetch, xeroFetch, quickBooksFetch, accountingErrorDetail };`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

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
  return { sqlite, calls, ...exports, connect, connection, seedDocument, access,
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
      const h = fixture(t); h.connect(provider); h.seedDocument(provider);
      const existing = await h.exportInvoice("owner-one", provider, job, "income");
      assert.equal(existing.external_document_id, "provider-invoice");
      assert.equal(h.calls.fetch, 0); assert.equal(h.calls.decrypt, 0);
      await assert.rejects(h.exportInvoice("owner-one", provider, { ...job, commercial_reference: "INV-TWO" }, "income"), /DOCUMENT_ALREADY_EXPORTED/);
    });
  }
});

test("new export reservations persist the exact authenticated owner and company file", async (t) => {
  const h = fixture(t); h.connect("myob", "owner-one", "file-one", {});
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
      const h = fixture(t); const original = h.connect(provider);
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
      const original = h.connect();
      await assert.rejects(h.activeCredentials("myob", original), /INTEGRATION_CONNECTION_CHANGED/);
      assert.doesNotMatch(h.connection().encrypted_credentials, /stale-refreshed/);
      assert.equal(h.calls.fetch, 1);
    });
  }
});

test("a current connection can rotate its own tokens without changing another tenant", async (t) => {
  const h = fixture(t, { fetch: async () => Response.json({ access_token: "new-access", refresh_token: "new-refresh", expires_in: 3600 }) });
  const connection = h.connect(); const other = h.connect("myob", "owner-two", "file-two");
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
