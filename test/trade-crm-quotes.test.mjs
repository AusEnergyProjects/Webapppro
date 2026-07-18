import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { calculateTradeQuoteLine, dollarsToCents, normaliseTradeQuoteLines, quantityToMilli } from "../src/lib/trade-quote.ts";
import { calculateQuoteSelection, normaliseQuoteChoices } from "../src/lib/trade-quote-options.ts";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const schema = read("../db/schema.ts");
const migration = read("../drizzle/0050_versioned_trade_quotes.sql");
const optionsMigration = read("../drizzle/0066_optioned_trade_quotes.sql");
const sharingMigration = read("../drizzle/0067_secure_quote_sharing.sql");
const installerRoute = read("../src/app/api/trade-quotes/route.ts");
const customerRoute = read("../src/app/api/customer-trade-quotes/route.ts");
const linkRoute = read("../src/app/api/quote-review/[token]/route.ts");
const installerUi = read("../src/components/TradeQuotePanel.tsx");
const customerUi = read("../src/components/CustomerTradeQuotes.tsx");
const crm = read("../src/components/InstallerCrmWorkspace.tsx");
const dashboard = read("../src/components/CustomerDashboard.tsx");
const styles = read("../src/app/globals.css");
const linkUi = read("../src/components/QuoteLinkReview.tsx");
const commercial = read("../src/lib/trade-commercial-reference.ts");

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

test("optioned quotes add immutable choices and exact selection evidence", () => {
  assert.match(schema, /sqliteTable\("trade_crm_quote_choices"/);
  assert.match(optionsMigration, /CREATE TABLE `trade_crm_quote_choices`/);
  for (const column of ["section_heading", "quote_choice_id", "selected_choice_ids_json", "selected_subtotal_cents", "selected_tax_cents", "selected_total_cents", "selection_summary"]) assert.match(optionsMigration, new RegExp(column));
  assert.equal(normaliseQuoteChoices([
    { clientKey: "good", kind: "package", groupKey: "packages", name: "Good", lines: [{}] },
    { clientKey: "better", kind: "package", groupKey: "packages", name: "Better", recommended: true, lines: [{}] },
    { clientKey: "best", kind: "package", groupKey: "packages", name: "Best", lines: [{}] },
  ], (value) => String(value || "")).length, 3);
  const selected = calculateQuoteSelection({ subtotalCents: 10_000, taxCents: 1_000, totalCents: 11_000 }, [
    { id: "good", kind: "package", groupKey: "packages", name: "Good", subtotalCents: 20_000, taxCents: 2_000, totalCents: 22_000 },
    { id: "better", kind: "package", groupKey: "packages", name: "Better", subtotalCents: 30_000, taxCents: 3_000, totalCents: 33_000 },
    { id: "best", kind: "package", groupKey: "packages", name: "Best", subtotalCents: 40_000, taxCents: 4_000, totalCents: 44_000 },
    { id: "surge", kind: "addon", groupKey: "surge", name: "Surge protection", subtotalCents: 5_000, taxCents: 500, totalCents: 5_500 },
  ], ["better", "surge"]);
  assert.deepEqual({ subtotal: selected.subtotalCents, tax: selected.taxCents, total: selected.totalCents }, { subtotal: 45_000, tax: 4_500, total: 49_500 });
});

test("secure quote sharing is revocable, expiring and commercially provider neutral", () => {
  for (const table of ["trade_crm_quote_links", "trade_crm_quote_events", "trade_crm_quote_questions", "trade_crm_quote_deliveries"]) {
    assert.match(schema, new RegExp(`sqliteTable\\("${table}"`));
    assert.match(sharingMigration, new RegExp("CREATE TABLE `" + table + "`"));
  }
  for (const evidence of ["token_hash", "encrypted_token", "token_issue", "signer_name", "commercial_reference", "currency"]) assert.match(sharingMigration, new RegExp(evidence));
  for (const provider of ["xero", "myob", "quickbooks", "stripe", "square"]) assert.match(commercial, new RegExp(provider));
  assert.match(commercial, /currency: "AUD"/);
  assert.match(commercial, /subtotalCents: Math\.trunc/);
  assert.match(linkRoute, /calculateQuoteSelection/);
  assert.match(linkRoute, /providerNeutralCommercialRecord/);
  assert.match(linkRoute, /token_hash = '', encrypted_token = ''/);
  assert.match(installerRoute, /TLINK_SMS_SENDER_APPROVED !== "true"/);
  assert.match(installerRoute, /status = 'expired', token_hash = '', encrypted_token = ''/);
  assert.match(customerRoute, /account-decision:/);
});

test("installer quote actions preserve direct-customer ownership and immutable issued versions", () => {
  for (const boundary of ["requireInstallerTeamAccess", "canDispatch", "sameOrigin", "d.customer_source = 'trade_owned'", "w.firebase_uid = ?"]) assert.match(installerRoute, new RegExp(boundary));
  assert.match(installerRoute, /action === "save_draft"/);
  assert.match(installerRoute, /current\.status === "issued"/);
  assert.match(installerRoute, /status = 'superseded'/);
  assert.match(installerRoute, /versionNumber \+= 1/);
  assert.match(installerRoute, /action === "issue_quote"/);
  assert.match(installerRoute, /status = 'issued'/);
  assert.match(installerRoute, /quote_status = 'sent'/);
  assert.match(installerRoute, /authorisedEmails/);
  assert.doesNotMatch(installerRoute, /trade_opportunities|opportunity_matches/);
});

test("customer decisions require verified matching identity and retain exact acceptance evidence", () => {
  for (const boundary of ["identity.emailVerified", "customer_accounts", "v.acceptance_email = ?", "d.customer_source = 'trade_owned'", "v.status = 'issued'", "v.version_number = q.current_version_number"]) assert.match(customerRoute, new RegExp(boundary));
  for (const evidence of ["customer_firebase_uid", "actor_email", "actor_email_verified", "actor_auth_time", "actor_sign_in_provider", "consent_statement", "selected_choice_ids_json", "selected_total_cents", "selection_summary", "decided_at"]) assert.match(customerRoute, new RegExp(evidence));
  assert.match(customerRoute, /body.consentConfirmed !== true/);
  assert.match(customerRoute, /calculateQuoteSelection/);
  assert.match(customerRoute, /QUOTE_EXPIRED/);
  assert.match(customerRoute, /quote_status = \?/);
  assert.doesNotMatch(customerRoute, /trade_opportunities|customer_project_quotes/);
});

test("quote SQL compiles against its production migration dependencies", () => {
  const db = new DatabaseSync(":memory:"); const directory = new URL("../drizzle/", import.meta.url);
  for (const file of ["0000_complex_absorbing_man.sql", "0001_futuristic_frog_thor.sql", "0011_even_reavers.sql", "0015_aromatic_black_knight.sql", "0019_melodic_unus.sql", "0020_lying_stick.sql", "0021_mushy_gamora.sql", "0022_worried_sleepwalker.sql", "0047_customer_service_site_foundation.sql", "0050_versioned_trade_quotes.sql", "0057_customer_property_arrivals.sql", "0058_trade_contact_arrival_handoff.sql", "0064_trade_price_book.sql", "0065_trade_job_packets.sql", "0066_optioned_trade_quotes.sql", "0067_secure_quote_sharing.sql", "0068_accepted_quote_handoff.sql"]) apply(db, fs.readFileSync(new URL(file, directory), "utf8"));
  for (const [label, source] of [["installer", installerRoute], ["customer", customerRoute], ["secure link", linkRoute]]) {
    const queries = [...source.matchAll(/prepare\(`([\s\S]*?)`\)/g)].map((match) => match[1]).filter((sql) => !sql.includes("${"));
    assert.ok(queries.length > 5, `${label} route should expose compiled prepared statements`);
    for (const sql of queries) assert.doesNotThrow(() => db.prepare(sql), `${label} SQL should compile: ${sql.slice(0, 70)}`);
  }
});

test("installer and customer interfaces expose the version and consent contract", () => {
  for (const copy of ["Issued versions are immutable", "Build Good, Better, Best", "Add optional extra", "Add choose-one pair", "Customer quote email", "Create next draft", "Issue for customer review", "Internal only", "Quote history"]) assert.match(installerUi, new RegExp(copy));
  for (const copy of ["Direct customer agreements", "Clear choices, one confirmed total", "Accept selected quote", "verified account evidence", "This version has been superseded", "selectedChoiceIds"]) assert.match(customerUi, new RegExp(copy));
  for (const hidden of ["unitCostCentsExGst", "marginBasisPoints", "markupBasisPoints"]) assert.doesNotMatch(customerUi, new RegExp(hidden));
  assert.match(crm, /<TradeQuotePanel/);
  assert.doesNotMatch(crm, /name="quotedValue"|name="quoteStatus"/);
  assert.match(dashboard, /href="\/account\/quotes"/);
  assert.match(styles, /@media \(max-width: 720px\)[\s\S]*?\.trade-quote-line \{[^}]*grid-template-columns: minmax\(0, 1fr\);[^}]*min-width: 0;/);
  assert.match(styles, /\.trade-quote-field > span, \.trade-quote-description > span \{[^}]*display: block;/);
  for (const copy of ["Print or save PDF", "Ask the trade business", "Type your name to sign", "Calculated and checked again by the server", "Accept for"]) assert.match(linkUi, new RegExp(copy));
  for (const copy of ["One secure quote link", "Copy link", "Email quote", "Replace link", "Revoke link", "Quote activity"]) assert.match(installerUi, new RegExp(copy));
  assert.match(styles, /@media print/);
});

test("direct quote copy avoids prohibited dash characters", () => {
  assert.doesNotMatch(`${installerRoute}\n${customerRoute}\n${linkRoute}\n${installerUi}\n${customerUi}\n${linkUi}`, /[\u2013\u2014]/);
});
