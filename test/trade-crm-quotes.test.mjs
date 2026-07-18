import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { calculateTradeQuoteLine, dollarsToCents, normaliseTradeQuoteLines, quantityToMilli } from "../src/lib/trade-quote.ts";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const schema = read("../db/schema.ts");
const migration = read("../drizzle/0050_versioned_trade_quotes.sql");
const installerRoute = read("../src/app/api/trade-quotes/route.ts");
const customerRoute = read("../src/app/api/customer-trade-quotes/route.ts");
const installerUi = read("../src/components/TradeQuotePanel.tsx");
const customerUi = read("../src/components/CustomerTradeQuotes.tsx");
const crm = read("../src/components/InstallerCrmWorkspace.tsx");
const dashboard = read("../src/components/CustomerDashboard.tsx");

const apply = (db, sql) => {
  for (const statement of sql.split("--> statement-breakpoint").map((item) => item.trim()).filter(Boolean)) db.exec(statement);
};

test("quote decimals convert to bounded integers without floating point money", () => {
  assert.equal(quantityToMilli("1.125"), 1125);
  assert.equal(dollarsToCents("1234.56"), 123456);
  assert.equal(dollarsToCents("-12.34", true), -1234);
  assert.throws(() => quantityToMilli("1.0001"), /INVALID_DECIMAL/);
  assert.throws(() => dollarsToCents("1.001"), /INVALID_DECIMAL/);
});

test("line and quote totals use deterministic half-away rounding in integer cents", () => {
  assert.deepEqual(calculateTradeQuoteLine(333, 100, "gst"), { subtotalCents: 33, taxCents: 3, totalCents: 36 });
  assert.deepEqual(calculateTradeQuoteLine(1000, -1005, "gst"), { subtotalCents: -1005, taxCents: -101, totalCents: -1106 });
  const quote = normaliseTradeQuoteLines([
    { lineType: "product", description: "Battery", quantity: "2", unitPrice: "1000.00", taxCode: "gst" },
    { lineType: "labour", description: "Installation", quantity: "4.5", unitPrice: "120.00", taxCode: "gst" },
    { lineType: "adjustment", description: "Package discount", quantity: "1", unitPrice: "-100.00", taxCode: "gst" },
  ], (value) => String(value));
  assert.deepEqual({ subtotalCents: quote.subtotalCents, taxCents: quote.taxCents, totalCents: quote.totalCents }, { subtotalCents: 244000, taxCents: 24400, totalCents: 268400 });
});

test("the additive migration creates one versioned direct quote model", () => {
  for (const table of ["trade_crm_quotes", "trade_crm_quote_versions", "trade_crm_quote_items", "trade_crm_quote_acceptances"]) {
    assert.equal((schema.match(new RegExp(`sqliteTable\\("${table}"`, "g")) || []).length, 1);
    assert.match(migration, new RegExp("CREATE TABLE `" + table + "`"));
  }
  for (const index of ["trade_crm_quotes_owner_work_idx", "trade_crm_quote_versions_quote_version_idx", "trade_crm_quote_versions_acceptance_email_idx", "trade_crm_quote_items_version_position_idx", "trade_crm_quote_acceptances_version_idx"]) assert.match(migration, new RegExp(index));
});

test("installer quote actions preserve direct-customer ownership and immutable issued versions", () => {
  for (const boundary of ["requireFirebaseIdentity", "sameOrigin", "partner_type !== \"installer\"", "business_operations", "d.customer_source = 'trade_owned'", "w.firebase_uid = ?"]) assert.match(installerRoute, new RegExp(boundary));
  assert.match(installerRoute, /action === "save_draft"/);
  assert.match(installerRoute, /current\.status === "issued"/);
  assert.match(installerRoute, /status = 'superseded'/);
  assert.match(installerRoute, /versionNumber \+= 1/);
  assert.match(installerRoute, /action === "issue_quote"/);
  assert.match(installerRoute, /status = 'issued'/);
  assert.match(installerRoute, /quoted_value_cents = \?, quote_status = 'sent'/);
  assert.match(installerRoute, /authorisedEmails/);
  assert.doesNotMatch(installerRoute, /trade_opportunities|opportunity_matches/);
});

test("customer decisions require verified matching identity and retain exact acceptance evidence", () => {
  for (const boundary of ["identity.emailVerified", "customer_accounts", "v.acceptance_email = ?", "d.customer_source = 'trade_owned'", "v.status = 'issued'", "v.version_number = q.current_version_number"]) assert.match(customerRoute, new RegExp(boundary));
  for (const evidence of ["customer_firebase_uid", "actor_email", "actor_email_verified", "actor_auth_time", "actor_sign_in_provider", "consent_statement", "decided_at"]) assert.match(customerRoute, new RegExp(evidence));
  assert.match(customerRoute, /body.consentConfirmed !== true/);
  assert.match(customerRoute, /QUOTE_EXPIRED/);
  assert.match(customerRoute, /quote_status = \?/);
  assert.doesNotMatch(customerRoute, /trade_opportunities|customer_project_quotes/);
});

test("quote SQL compiles against its production migration dependencies", () => {
  const db = new DatabaseSync(":memory:"); const directory = new URL("../drizzle/", import.meta.url);
  for (const file of ["0000_complex_absorbing_man.sql", "0001_futuristic_frog_thor.sql", "0011_even_reavers.sql", "0015_aromatic_black_knight.sql", "0019_melodic_unus.sql", "0047_customer_service_site_foundation.sql", "0050_versioned_trade_quotes.sql", "0064_trade_price_book.sql", "0065_trade_job_packets.sql"]) apply(db, fs.readFileSync(new URL(file, directory), "utf8"));
  for (const [label, source] of [["installer", installerRoute], ["customer", customerRoute]]) {
    const queries = [...source.matchAll(/prepare\(`([\s\S]*?)`\)/g)].map((match) => match[1]).filter((sql) => !sql.includes("${"));
    assert.ok(queries.length > 5, `${label} route should expose compiled prepared statements`);
    for (const sql of queries) assert.doesNotThrow(() => db.prepare(sql), `${label} SQL should compile: ${sql.slice(0, 70)}`);
  }
});

test("installer and customer interfaces expose the version and consent contract", () => {
  for (const copy of ["Issued versions are immutable", "Customer acceptance email", "Create next draft", "Issue for customer review", "Quote history"]) assert.match(installerUi, new RegExp(copy));
  for (const copy of ["Direct customer agreements", "Accept this exact version", "verified account evidence", "This version has been superseded", "quote.consentStatement"]) assert.match(customerUi, new RegExp(copy));
  assert.match(crm, /<TradeQuotePanel/);
  assert.doesNotMatch(crm, /name="quotedValue"|name="quoteStatus"/);
  assert.match(dashboard, /href="\/account\/quotes"/);
});

test("direct quote copy avoids prohibited dash characters", () => {
  assert.doesNotMatch(`${installerRoute}\n${customerRoute}\n${installerUi}\n${customerUi}`, /[\u2013\u2014]/);
});
