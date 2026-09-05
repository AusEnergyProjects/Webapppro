import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";

import {
  ENERGY_ASSISTANT_TRADE_SHARING_NOTICE_VERSION,
  ENERGY_ASSISTANT_TRADE_SHARING_PURPOSE,
  PUBLIC_PLAN_CONSENT_NOTICE_VERSION,
  PUBLIC_PLAN_CONSENT_PURPOSE,
  publicPlanContactReleaseConsentSql,
} from "../src/lib/public-plan-enquiry.mjs";
import {
  LEGACY_QUICK_UPGRADE_CONSENT_NOTICE_VERSION,
  LEGACY_QUICK_UPGRADE_CONSENT_PURPOSE,
  QUICK_UPGRADE_CONSENT_NOTICE_VERSION,
  QUICK_UPGRADE_CONSENT_PURPOSE,
} from "../src/lib/quick-upgrade-enquiry.mjs";
import { publicTradeContactForMatchedLead } from "../src/lib/public-trade-lead-access.mjs";
import {
  arrivalProposalForMatchedLead,
  customerProjectContactForMatchedLead,
  customerProjectContextMatchesBase,
  platformQuoteForMatchedLead,
} from "../src/lib/trade-opportunity-read-projection.mjs";

const V4_NOTICE = "2026-08-10-customer-selected-trade-sharing-v4";
const V4_PURPOSE =
  "Share my email, postcode, service and any message I write with all approved TLink trades in my area, plus chosen name or phone, and email my private plan";
const V6_NOTICE = "2026-08-10-structured-service-address-sharing-v6";
const V6_PURPOSE =
  "Share my email, postcode, services and message with all approved TLink trades in my area, plus name, phone or full service address, and email my private plan";
const V7_NOTICE = "2026-08-11-quote-preparation-sharing-notice-v7";
const V7_PURPOSE =
  "Email my private plan and share my email, postcode, services, message, quote answers and selected photos with approved matched TLink trades";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const route = read("../src/app/api/trade-opportunities/route.ts");
const dashboard = read("../src/components/DirectTradeDashboard.tsx");

const requiredFields = ["customer_email", "postcode", "service_categories"];

function sqlTemplateContaining(source, marker) {
  const markerIndex = source.indexOf(marker);
  assert.ok(markerIndex >= 0, `SQL marker was not found: ${marker}`);
  const start = source.lastIndexOf("`", markerIndex);
  const end = source.indexOf("`", markerIndex);
  assert.ok(start >= 0 && end > markerIndex, `SQL template was not found: ${marker}`);
  return source.slice(start + 1, end);
}

function projectionCountAt(sql, selectStart) {
  let depth = 0;
  let quote = "";
  let columns = 1;
  for (let index = selectStart + 6; index < sql.length; index += 1) {
    const character = sql[index];
    if (quote) {
      if (character === quote && sql[index - 1] !== "\\") quote = "";
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }
    if (character === "(") depth += 1;
    if (character === ")") depth -= 1;
    if (depth === 0 && character === ",") columns += 1;
    if (depth === 0 && /^\sFROM\b/i.test(sql.slice(index))) return columns;
  }
  throw new Error("Top-level SELECT projection did not terminate at FROM");
}

function topLevelProjectionCount(sql) {
  const selectStarts = [...sql.matchAll(/\bSELECT\b/gi)].map((match) => match.index);
  assert.ok(selectStarts.length > 0, "SQL statement must contain SELECT");
  return Math.max(...selectStarts.map((selectStart) => projectionCountAt(sql, selectStart)));
}

function d1StatementBudget(sql) {
  const projection = topLevelProjectionCount(sql);
  const booleans = (sql.match(/\b(?:AND|OR)\b/gi) || []).length;
  const joins = (sql.match(/\bJOIN\b/gi) || []).length;
  const nestedSelects = Math.max(0, (sql.match(/\bSELECT\b/gi) || []).length - 1);
  const branches = (sql.match(/\b(?:CASE|WHEN)\b/gi) || []).length;
  return {
    projection,
    booleans,
    joins,
    nestedSelects,
    branches,
    total: projection + booleans + joins + nestedSelects + branches,
  };
}

function assertD1StatementIsBounded(sql) {
  const budget = d1StatementBudget(sql);
  assert.ok(budget.projection <= 40, `D1 projection is too wide: ${JSON.stringify(budget)}`);
  assert.ok(budget.booleans <= 30, `D1 boolean tree is too deep: ${JSON.stringify(budget)}`);
  assert.ok(budget.joins <= 6, `D1 join graph is too wide: ${JSON.stringify(budget)}`);
  assert.ok(budget.total <= 60, `D1 conservative expression budget is too high: ${JSON.stringify(budget)}`);
  return budget;
}

function releaseRow(overrides = {}) {
  return {
    public_contact_release_id: "release-1",
    public_contact_status: "active",
    public_contact_source_reference: "public-plan:reference-1",
    source_reference: "public-plan:reference-1",
    public_contact_withdrawn_at: "",
    public_contact_postcode: "3000",
    opportunity_postcode: "3000",
    public_contact_granted_at: "2026-08-11T01:02:03.000Z",
    public_contact_notice_version: PUBLIC_PLAN_CONSENT_NOTICE_VERSION,
    public_contact_consent_purpose: PUBLIC_PLAN_CONSENT_PURPOSE,
    public_contact_disclosed_fields: JSON.stringify(requiredFields),
    public_customer_email: "CUSTOMER@example.com",
    public_customer_first_name: "Private",
    public_customer_last_name: "Person",
    public_customer_phone: "0400000000",
    public_customer_street_address: "1 Private Street",
    public_customer_unit_number: "Unit 2",
    public_customer_suburb: "Melbourne",
    public_customer_address_state: "VIC",
    public_customer_message: "Private message",
    state: "VIC",
    ...overrides,
  };
}

test("trade lead reads split base rows from any-release context and validate before serialization", () => {
  const consentGuard = publicPlanContactReleaseConsentSql("public_contact");
  assert.ok(consentGuard.length < 1_600, "lead read consent guard must stay shallow for D1");
  assert.equal((consentGuard.match(/\bWHEN\b/g) || []).length, 7);
  assert.equal((consentGuard.match(/\bELSE\b/g) || []).length, 1);

  const database = new DatabaseSync(":memory:");
  database.exec("CREATE TABLE public_contact (id TEXT, notice_version TEXT, consent_purpose TEXT)");
  const insert = database.prepare("INSERT INTO public_contact VALUES (?, ?, ?)");
  insert.run("v4", V4_NOTICE, V4_PURPOSE);
  insert.run("v6", V6_NOTICE, V6_PURPOSE);
  insert.run("v7", V7_NOTICE, V7_PURPOSE);
  insert.run(
    "current",
    PUBLIC_PLAN_CONSENT_NOTICE_VERSION,
    PUBLIC_PLAN_CONSENT_PURPOSE,
  );
  insert.run(
    "assistant",
    ENERGY_ASSISTANT_TRADE_SHARING_NOTICE_VERSION,
    ENERGY_ASSISTANT_TRADE_SHARING_PURPOSE,
  );
  insert.run(
    "quick",
    QUICK_UPGRADE_CONSENT_NOTICE_VERSION,
    QUICK_UPGRADE_CONSENT_PURPOSE,
  );
  insert.run(
    "quick-legacy",
    LEGACY_QUICK_UPGRADE_CONSENT_NOTICE_VERSION,
    LEGACY_QUICK_UPGRADE_CONSENT_PURPOSE,
  );
  insert.run("swapped", V7_NOTICE, V6_PURPOSE);
  insert.run("unknown", "unknown", "unknown");
  assert.deepEqual(
    database.prepare(`SELECT id FROM public_contact WHERE ${consentGuard} ORDER BY id`)
      .all()
      .map((row) => row.id),
    ["assistant", "current", "quick", "quick-legacy", "v4", "v6", "v7"],
  );
  database.close();

  const baseRead = sqlTemplateContaining(route, "m.id match_id, m.firebase_uid installer_uid");
  const boundedMatchRead = sqlTemplateContaining(route, "SELECT bounded_match.id match_id");
  const projectRead = sqlTemplateContaining(route, "m.id project_match_id, p.id customer_project_id");
  const boundedAuxiliaryReads = [
    sqlTemplateContaining(route, "authorized_match.match_id locality_match_id"),
    sqlTemplateContaining(route, "authorized_match.match_id quote_match_id"),
    sqlTemplateContaining(route, "authorized_match.match_id contact_match_id"),
    sqlTemplateContaining(route, "authorized_match.match_id arrival_match_id"),
    sqlTemplateContaining(route, "authorized_match.match_id opportunity_match_id, o.source_reference"),
    sqlTemplateContaining(route, "SELECT e.id, e.project_id, e.category"),
    sqlTemplateContaining(route, "SELECT photo.id, photo.prompt_id"),
  ];
  const boundedAuxiliaryBodies = boundedAuxiliaryReads.map((read) =>
    read.replace("${boundedLeadMatchesSql}", ""));
  for (const [index, read] of boundedAuxiliaryReads.entries()) {
    assert.ok(read.includes("${boundedLeadMatchesSql}"));
    assert.match(boundedAuxiliaryBodies[index], /FROM authoritative_matches authorized_match/);
  }
  const [
    localityRead,
    quoteRead,
    exactContactRead,
    arrivalRead,
    publicContextRead,
    evidenceRead,
    publicPhotoRead,
  ] = boundedAuxiliaryReads.map((read) => read.replace("${boundedLeadMatchesSql}", boundedMatchRead));
  assert.doesNotMatch(baseRead, /public_trade_lead_contact_releases|public_trade_lead_quote_preparations/);
  assert.doesNotMatch(baseRead, /customer_project_quotes|customer_project_contact_releases|customer_project_arrival_proposals/);
  assert.doesNotMatch(baseRead, /property_context|customer_goal|contact_release_id|arrival_proposal_id/);
  assert.doesNotMatch(baseRead, /any_public_contact|public_contact\.id IS NOT NULL/);
  assert.equal(d1StatementBudget(baseRead).projection, 27);
  assert.match(baseRead, /LIMIT 100/);
  assert.match(baseRead, /m\.updated_at DESC, m\.id ASC/);
  assert.match(projectRead, /m\.updated_at DESC, m\.id ASC/);
  assert.match(boundedMatchRead, /bounded_match\.updated_at DESC, bounded_match\.id ASC/);
  assert.match(projectRead, /EXISTS \([\s\S]*matching_consent\.withdrawn_at = ''/);
  assert.match(route, /platformOnly && !customerProjectContextMatchesBase\(baseRow, projectContext\)[\s\S]*return \[\]/);
  assert.match(route, /platformQuoteForMatchedLead\(/);
  assert.match(route, /customerProjectContactForMatchedLead\(/);
  assert.match(route, /arrivalProposalForMatchedLead\(/);
  assert.match(publicContextRead, /JOIN public_trade_lead_contact_releases public_contact/);
  assert.match(
    publicContextRead,
    /ON public_contact\.id = \([\s\S]*WHERE current_release\.opportunity_id = o\.id[\s\S]*current_release\.source_reference = o\.source_reference[\s\S]*ORDER BY datetime\(current_release\.updated_at\) DESC[\s\S]*LIMIT 1/,
  );
  assert.doesNotMatch(publicContextRead, /public_contact\.status = 'active'/);
  assert.match(publicContextRead, /public_quote_preparation\.withdrawn_at = ''/);
  assert.match(publicPhotoRead, /preparation\.withdrawn_at = ''/);
  assert.match(route, /publicReleaseMatches\.add\(matchId\)/);
  assert.match(
    route,
    /if \(!matchId \|\| publicReleaseMatches\.has\(matchId\)\) continue;[\s\S]*publicReleaseMatches\.add\(matchId\);[\s\S]*const contact = publicTradeContactForMatchedLead\(item\)/,
  );
  assert.match(route, /const contact = publicTradeContactForMatchedLead\(item\)/);
  assert.match(route, /publicReleaseMatches\.has\(matchId\) && !publicLeadContext[\s\S]*return \[\]/);
  const contextReadBlock = route.slice(
    route.indexOf("const publicLeadContextStatement"),
    route.indexOf("const publicReleaseMatches"),
  );
  assert.doesNotMatch(contextReadBlock, /\.catch\(/);
  const getBlock = route.slice(route.indexOf("export async function GET"), route.indexOf("export async function PATCH"));
  assert.equal((getBlock.match(/await db\.batch<Record<string, unknown>>\(/g) || []).length, 1);
  assert.match(getBlock, /baseLeadStatement,[\s\S]*projectContextStatement,[\s\S]*matchingLocalityStatement,[\s\S]*quoteStatement,[\s\S]*customerContactStatement,[\s\S]*arrivalStatement,[\s\S]*publicLeadContextStatement,[\s\S]*evidenceStatement,[\s\S]*publicPhotoStatement/);

  assertD1StatementIsBounded(boundedMatchRead);
  for (const statement of [
    localityRead,
    quoteRead,
    exactContactRead,
    arrivalRead,
    publicContextRead,
    evidenceRead,
    publicPhotoRead,
  ]) {
    assertD1StatementIsBounded(statement);
  }

  const patchBaseRead = sqlTemplateContaining(route, "SELECT m.status, m.opportunity_id, o.title");
  const patchContextRead = sqlTemplateContaining(route, "o.source_reference, o.postcode opportunity_postcode, o.state");
  const patchProjectConsentRead = sqlTemplateContaining(route, "SELECT p.id customer_project_id, p.firebase_uid customer_uid");
  const patchProjectUpdate = sqlTemplateContaining(route, "JOIN customer_projects current_project");
  assert.doesNotMatch(patchBaseRead, /public_trade_lead_contact_releases|public_contact/);
  assert.match(patchContextRead, /JOIN public_trade_lead_contact_releases public_contact/);
  assert.doesNotMatch(patchContextRead, /public_contact\.status = 'active'/);
  assert.match(route, /currentPublicContact && !publicTradeContactForMatchedLead\(currentPublicContact\)/);
  assert.match(route, /active_public_contact\.id = \?/);
  assert.match(route, /active_public_contact\.source_reference = available_opportunity\.source_reference/);
  assert.match(route, /active_public_contact\.postcode = available_opportunity\.postcode/);
  assert.match(route, /active_public_contact\.disclosed_fields = \?/);
  assert.match(route, /active_public_contact\.updated_at = \?/);
  assert.match(patchProjectConsentRead, /current_matching_consent\.purpose = 'anonymized_installer_matching'/);
  assert.match(patchProjectConsentRead, /current_matching_consent\.withdrawn_at = ''/);
  assert.match(route, /isCustomerProject && \(!currentProjectConsent \|\| currentPublicContact\)/);
  assert.match(patchProjectUpdate, /available_opportunity\.source_reference = \?/);
  assert.match(patchProjectUpdate, /current_project\.id = \?/);
  assert.match(patchProjectUpdate, /current_matching_consent\.withdrawn_at = ''/);
  assert.match(route, /NOT EXISTS \([\s\S]*any_public_contact\.opportunity_id = \?/);

  const leadStatements = [
    baseRead,
    boundedMatchRead,
    projectRead,
    localityRead,
    quoteRead,
    exactContactRead,
    arrivalRead,
    publicContextRead,
    evidenceRead,
    publicPhotoRead,
    patchBaseRead,
    patchContextRead,
    patchProjectConsentRead,
    patchProjectUpdate,
    sqlTemplateContaining(route, "JOIN public_trade_lead_contact_releases active_public_contact"),
    sqlTemplateContaining(route, "WHERE any_public_contact.opportunity_id = ?"),
  ];
  for (const statement of leadStatements) {
    assertD1StatementIsBounded(statement);
  }
  const legacyOversizedRead = `SELECT ${Array.from({ length: 84 }, (_, index) => `t.c${index}`).join(", ")}
    FROM t ${Array.from({ length: 6 }, (_, index) => `JOIN j${index} ON j${index}.id = t.id`).join(" ")}
    WHERE ${Array.from({ length: 18 }, (_, index) => `t.c${index} = ?`).join(" AND ")}`;
  assert.throws(
    () => assertD1StatementIsBounded(legacyOversizedRead),
    /D1 projection is too wide|D1 conservative expression budget is too high/,
  );
  assert.equal(
    (route.match(/requireVerifiedTradeAccess\(request, \{ partnerTypes: \["installer"\] \}\)/g) || []).length,
    2,
  );
  assert.doesNotMatch(
    route,
    /verifiedTradeAccountPredicate\("current_public_trade_account"\)/,
  );
});

test("the authoritative base read supports broad and exact loads, caps at 100, and revokes project rows fail closed", () => {
  const baseRead = sqlTemplateContaining(route, "m.id match_id, m.firebase_uid installer_uid");
  const boundedMatchRead = sqlTemplateContaining(route, "SELECT bounded_match.id match_id");
  const quoteRead = sqlTemplateContaining(route, "authorized_match.match_id quote_match_id")
    .replace("${boundedLeadMatchesSql}", boundedMatchRead);
  const database = new DatabaseSync(":memory:");
  database.exec(`CREATE TABLE trade_opportunity_matches (
      id TEXT PRIMARY KEY, firebase_uid TEXT, opportunity_id TEXT, status TEXT,
      matched_categories TEXT DEFAULT '[]', distance_metres INTEGER DEFAULT 0,
      allocation_rank INTEGER DEFAULT 0, contact_attempt_count INTEGER DEFAULT 0,
      last_contact_at TEXT DEFAULT '', connected_at TEXT DEFAULT '', matched_at TEXT DEFAULT '',
      updated_at TEXT DEFAULT ''
    );
    CREATE TABLE trade_opportunities (
      id TEXT PRIMARY KEY, title TEXT DEFAULT '', project_type TEXT DEFAULT '', suburb TEXT DEFAULT '',
      postcode TEXT DEFAULT '', state TEXT DEFAULT '', service_categories TEXT DEFAULT '[]',
      priority TEXT DEFAULT '', timing TEXT DEFAULT '', summary TEXT DEFAULT '', status TEXT DEFAULT 'open',
      contact_limit INTEGER DEFAULT 2, expires_at TEXT DEFAULT '', source_reference TEXT DEFAULT ''
    );
    CREATE TABLE customer_projects (id TEXT PRIMARY KEY, firebase_uid TEXT, opportunity_id TEXT);
    CREATE TABLE customer_consent_receipts (
      id TEXT PRIMARY KEY, project_id TEXT, firebase_uid TEXT, purpose TEXT, withdrawn_at TEXT
    );
    CREATE TABLE customer_project_quotes (
      id TEXT PRIMARY KEY, project_id TEXT DEFAULT '', opportunity_id TEXT,
      opportunity_match_id TEXT, installer_uid TEXT, product_list_id TEXT DEFAULT '',
      inclusions TEXT DEFAULT '[]', product_snapshot TEXT DEFAULT '[]',
      product_subtotal_cents_ex_gst INTEGER DEFAULT 0,
      labour_cents_ex_gst INTEGER DEFAULT 0, other_cents_ex_gst INTEGER DEFAULT 0,
      total_cents_ex_gst INTEGER DEFAULT 0, quote_type TEXT DEFAULT 'indicative',
      start_window TEXT DEFAULT 'to_confirm', duration_weeks INTEGER DEFAULT 0,
      workmanship_warranty_years INTEGER DEFAULT 0, status TEXT DEFAULT 'submitted',
      customer_decision TEXT DEFAULT 'reviewing', submitted_at TEXT DEFAULT '',
      submission_revision INTEGER DEFAULT 0
    );`);
  const insertOpportunity = database.prepare(`INSERT INTO trade_opportunities
    (id, title, postcode, state, status, source_reference) VALUES (?, ?, '3000', 'VIC', 'open', ?)`);
  const insertMatch = database.prepare(`INSERT INTO trade_opportunity_matches
    (id, firebase_uid, opportunity_id, status, matched_at, updated_at) VALUES (?, 'installer-1', ?, 'offered', ?, ?)`);
  const insertQuote = database.prepare(`INSERT INTO customer_project_quotes
    (id, opportunity_id, opportunity_match_id, installer_uid) VALUES (?, ?, ?, 'installer-1')`);
  for (let index = 0; index < 101; index += 1) {
    const id = `opportunity-${String(index).padStart(3, "0")}`;
    const matchId = `match-${String(index).padStart(3, "0")}`;
    const updatedAt = "2026-08-12T00:00:00.000Z";
    insertOpportunity.run(id, id, `marketplace:${id}`);
    insertMatch.run(matchId, id, updatedAt, updatedAt);
    insertQuote.run(`quote-${String(index).padStart(3, "0")}`, id, matchId);
  }
  const broadBaseRows = database.prepare(baseRead).all("installer-1", "", "");
  assert.equal(broadBaseRows.length, 100);
  assert.equal(broadBaseRows[0].match_id, "match-000");
  assert.equal(broadBaseRows.at(-1).match_id, "match-099");
  assert.equal(database.prepare(baseRead).all("installer-1", "match-000", "match-000").length, 1);
  const broadQuoteRows = database.prepare(quoteRead).all("installer-1", "", "");
  assert.equal(broadQuoteRows.length, 100);
  assert.deepEqual(
    broadQuoteRows.map((row) => row.quote_match_id).sort(),
    broadBaseRows.map((row) => row.match_id).sort(),
  );
  assert.equal(
    database.prepare(quoteRead).all("installer-1", "match-000", "match-000").length,
    1,
  );

  insertOpportunity.run("project-opportunity", "Project", "customer-project:project-1");
  database.prepare("INSERT INTO customer_projects VALUES ('project-1', 'customer-1', 'project-opportunity')").run();
  insertMatch.run(
    "project-match",
    "project-opportunity",
    "2026-08-12T01:00:00.000Z",
    "2026-08-12T01:00:00.000Z",
  );
  assert.equal(database.prepare(baseRead).all("installer-1", "project-match", "project-match").length, 0);
  database.prepare(`INSERT INTO customer_consent_receipts VALUES
    ('withdrawn', 'project-1', 'customer-1', 'anonymized_installer_matching', '2026-08-12T01:01:00.000Z')`).run();
  assert.equal(database.prepare(baseRead).all("installer-1", "project-match", "project-match").length, 0);
  database.prepare(`INSERT INTO customer_consent_receipts VALUES
    ('active', 'project-1', 'customer-1', 'anonymized_installer_matching', '')`).run();
  assert.equal(database.prepare(baseRead).all("installer-1", "project-match", "project-match").length, 1);
  database.close();
});

test("project quote, exact contact and arrival extensions validate every relation before disclosure", () => {
  const base = {
    match_id: "match-1",
    installer_uid: "installer-1",
    id: "opportunity-1",
    customer_project_id: "project-1",
    customer_uid: "customer-1",
    opportunity_postcode: "3000",
    state: "VIC",
  };
  const project = {
    project_match_id: "match-1",
    customer_project_id: "project-1",
    customer_uid: "customer-1",
    customer_postcode: "3000",
    customer_address_state: "VIC",
  };
  const quote = {
    quote_match_id: "match-1",
    quote_id: "quote-1",
    quote_project_id: "project-1",
    quote_opportunity_id: "opportunity-1",
    quote_opportunity_match_id: "match-1",
    quote_installer_uid: "installer-1",
  };
  const release = {
    contact_match_id: "match-1",
    contact_release_id: "release-1",
    contact_project_id: "project-1",
    contact_opportunity_id: "opportunity-1",
    contact_opportunity_match_id: "match-1",
    contact_quote_id: "quote-1",
    contact_customer_uid: "customer-1",
    contact_installer_uid: "installer-1",
    contact_release_status: "active",
    contact_notice_version: "2026-07-18",
    contact_disclosed_fields: JSON.stringify(["name", "email", "phone", "service_address"]),
    customer_name: "Customer Person",
    customer_email: "customer@example.com",
    customer_phone: "0400000000",
    contact_address_line_1: "1 Example Street",
    contact_address_line_2: "",
    contact_suburb: "Melbourne",
    contact_address_state: "VIC",
    contact_postcode: "3000",
    contact_granted_at: "2026-08-12T01:00:00.000Z",
    contact_withdrawn_at: "",
  };
  const arrival = {
    arrival_match_id: "match-1",
    arrival_proposal_id: "arrival-1",
    arrival_project_id: "project-1",
    arrival_quote_id: "quote-1",
    arrival_opportunity_match_id: "match-1",
    arrival_customer_uid: "customer-1",
    arrival_installer_uid: "installer-1",
    arrival_status: "proposed",
    arrival_withdrawn_at: "",
  };

  assert.equal(customerProjectContextMatchesBase(base, project), true);
  assert.equal(customerProjectContextMatchesBase(base, { ...project, customer_uid: "wrong" }), false);
  const validQuote = platformQuoteForMatchedLead(base, project, quote);
  assert.equal(validQuote?.quote_id, "quote-1");
  assert.equal(platformQuoteForMatchedLead(base, project, { ...quote, quote_installer_uid: "wrong" }), null);
  assert.equal(customerProjectContactForMatchedLead(base, project, validQuote, release)?.email, "customer@example.com");
  for (const invalid of [
    { contact_release_status: "withdrawn" },
    { contact_withdrawn_at: "2026-08-12T02:00:00.000Z" },
    { contact_disclosed_fields: '["name","email","phone","phone","service_address"]' },
    { contact_installer_uid: "wrong" },
    { contact_quote_id: "wrong" },
    { contact_postcode: "3001" },
  ]) {
    assert.equal(customerProjectContactForMatchedLead(base, project, validQuote, { ...release, ...invalid }), null);
  }
  assert.equal(arrivalProposalForMatchedLead(base, project, validQuote, arrival)?.arrival_proposal_id, "arrival-1");
  assert.equal(arrivalProposalForMatchedLead(base, project, validQuote, { ...arrival, arrival_quote_id: "wrong" }), null);
  assert.equal(arrivalProposalForMatchedLead(base, project, validQuote, { ...arrival, arrival_status: "withdrawn" }), null);
  assert.equal(arrivalProposalForMatchedLead(base, project, validQuote, {
    ...arrival,
    arrival_withdrawn_at: "2026-08-12T02:00:00.000Z",
  }), null);
});

test("customer-project status mutation rechecks matching consent at mutation time", () => {
  const projectUpdate = sqlTemplateContaining(route, "JOIN customer_projects current_project");
  const database = new DatabaseSync(":memory:");
  database.exec(`CREATE TABLE trade_opportunity_matches (
      id TEXT PRIMARY KEY, firebase_uid TEXT, opportunity_id TEXT, status TEXT,
      partner_note TEXT DEFAULT '', updated_at TEXT DEFAULT ''
    );
    CREATE TABLE trade_opportunities (
      id TEXT PRIMARY KEY, status TEXT, expires_at TEXT, source_reference TEXT
    );
    CREATE TABLE customer_projects (
      id TEXT PRIMARY KEY, firebase_uid TEXT, opportunity_id TEXT
    );
    CREATE TABLE customer_consent_receipts (
      id TEXT PRIMARY KEY, project_id TEXT, firebase_uid TEXT, purpose TEXT, withdrawn_at TEXT
    );
    CREATE TABLE public_trade_lead_contact_releases (opportunity_id TEXT);
    CREATE TABLE customer_project_quotes (
      opportunity_match_id TEXT, installer_uid TEXT, customer_decision TEXT
    );
    INSERT INTO trade_opportunities VALUES
      ('opportunity-1', 'open', '2026-08-13T00:00:00.000Z', 'customer-project:project-1');
    INSERT INTO trade_opportunity_matches VALUES
      ('match-1', 'installer-1', 'opportunity-1', 'offered', '', '2026-08-12T00:00:00.000Z');
    INSERT INTO customer_projects VALUES ('project-1', 'customer-1', 'opportunity-1');
    INSERT INTO customer_consent_receipts VALUES
      ('consent-1', 'project-1', 'customer-1', 'anonymized_installer_matching', '2026-08-12T01:00:00.000Z');`);
  const values = [
    "viewed",
    "2026-08-12T02:00:00.000Z",
    "match-1",
    "installer-1",
    "offered",
    "opportunity-1",
    "opportunity-1",
    "2026-08-12T02:00:00.000Z",
    "customer-project:project-1",
    "project-1",
    "customer-1",
    "opportunity-1",
    "match-1",
    "installer-1",
  ];
  assert.equal(database.prepare(projectUpdate).run(...values).changes, 0);
  database.prepare("UPDATE customer_consent_receipts SET withdrawn_at = '' WHERE id = 'consent-1'").run();
  assert.equal(database.prepare(projectUpdate).run(...values).changes, 1);
  database.prepare("UPDATE trade_opportunity_matches SET status = 'offered' WHERE id = 'match-1'").run();
  database.prepare("INSERT INTO customer_project_quotes VALUES ('match-1', 'installer-1', 'accepted')").run();
  assert.equal(database.prepare(projectUpdate).run(...values).changes, 0);
  database.close();
});

test("current and legacy contact releases are projected only from their exact policy and selected fields", () => {
  const v4 = publicTradeContactForMatchedLead(releaseRow({
    public_contact_notice_version: V4_NOTICE,
    public_contact_consent_purpose: V4_PURPOSE,
    public_contact_disclosed_fields: JSON.stringify([
      ...requiredFields,
      "customer_name",
      "customer_phone",
      "customer_message",
    ]),
  }));
  assert.deepEqual(
    { name: v4?.name, phone: v4?.phone, addressLine1: v4?.addressLine1, message: v4?.message },
    { name: "Private Person", phone: "0400000000", addressLine1: "", message: "Private message" },
  );

  for (const [noticeVersion, purpose] of [
    [PUBLIC_PLAN_CONSENT_NOTICE_VERSION, PUBLIC_PLAN_CONSENT_PURPOSE],
    [V6_NOTICE, V6_PURPOSE],
    [V7_NOTICE, V7_PURPOSE],
  ]) {
    const contact = publicTradeContactForMatchedLead(releaseRow({
      public_contact_notice_version: noticeVersion,
      public_contact_consent_purpose: purpose,
      public_contact_disclosed_fields: JSON.stringify([
        ...requiredFields,
        "customer_name",
        "customer_phone",
        "customer_address",
        "customer_message",
      ]),
    }));
    assert.equal(contact?.name, "Private Person");
    assert.equal(contact?.addressLine1, "1 Private Street");
    assert.equal(contact?.addressState, "VIC");
  }

  const minimum = publicTradeContactForMatchedLead(releaseRow());
  assert.equal(minimum?.email, "customer@example.com");
  assert.equal(minimum?.postcode, "3000");
  assert.deepEqual(
    { name: minimum?.name, phone: minimum?.phone, address: minimum?.addressLine1, message: minimum?.message },
    { name: "", phone: "", address: "", message: "" },
  );
});

test("malformed, incompatible, withdrawn and mismatched releases fail closed after the bounded any-release read", () => {
  const invalidRows = [
    releaseRow({ public_contact_consent_purpose: V6_PURPOSE }),
    releaseRow({ public_contact_notice_version: "unknown" }),
    releaseRow({ public_contact_disclosed_fields: JSON.stringify([...requiredFields, "customer_email"]) }),
    releaseRow({ public_contact_disclosed_fields: JSON.stringify([...requiredFields, 7]) }),
    releaseRow({ public_contact_disclosed_fields: "not-json" }),
    releaseRow({ public_contact_status: "withdrawn" }),
    releaseRow({ public_contact_withdrawn_at: "2026-08-11T02:00:00.000Z" }),
    releaseRow({ public_contact_postcode: "3001" }),
    releaseRow({ public_contact_source_reference: "public-plan:another" }),
  ];
  for (const row of invalidRows) {
    assert.equal(publicTradeContactForMatchedLead(row), null);
  }
});

test("retrieved leads remain visible when the broad inbox load fails", () => {
  assert.match(dashboard, /const \[opportunityLoadError, setOpportunityLoadError\] = useState\(""\)/);
  assert.match(
    dashboard,
    /setOpportunityLoadError\(loadError instanceof Error \? loadError\.message : "Leads could not be loaded\."\)/,
  );
  const populatedBranch = dashboard.indexOf(") : opportunities.length ? (");
  const warningBranch = dashboard.indexOf("{opportunityLoadError && (", populatedBranch);
  const failureBranch = dashboard.indexOf(") : opportunityLoadError ? (", warningBranch);
  const emptyCopy = dashboard.indexOf("No opportunities assigned", failureBranch);
  assert.ok(
    populatedBranch > 0
      && warningBranch > populatedBranch
      && failureBranch > warningBranch
      && emptyCopy > failureBranch,
  );
  assert.match(
    dashboard.slice(warningBranch, failureBranch),
    /role="status"[\s\S]*Some leads may be missing[\s\S]*\{opportunityLoadError\}/,
  );
  assert.match(
    dashboard.slice(failureBranch, emptyCopy),
    /role="alert"[\s\S]*Leads could not be loaded[\s\S]*\{opportunityLoadError\}/,
  );
});
