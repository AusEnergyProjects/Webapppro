import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";

import {
  publicPlanContactReleaseConsentSql,
} from "../src/lib/public-plan-enquiry.mjs";
import { publicTradeContactForMatchedLead } from "../src/lib/public-trade-lead-access.mjs";

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
    public_contact_notice_version: V7_NOTICE,
    public_contact_consent_purpose: V7_PURPOSE,
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

test("trade lead reads keep the D1 consent prefilter shallow and validate releases before serialization", () => {
  const consentGuard = publicPlanContactReleaseConsentSql("public_contact");
  assert.ok(consentGuard.length < 1_200, "lead read consent guard must stay shallow for D1");
  assert.equal((consentGuard.match(/\bAND\b/g) || []).length, 3);
  assert.equal((consentGuard.match(/\bOR\b/g) || []).length, 2);

  const database = new DatabaseSync(":memory:");
  database.exec("CREATE TABLE public_contact (id TEXT, notice_version TEXT, consent_purpose TEXT)");
  const insert = database.prepare("INSERT INTO public_contact VALUES (?, ?, ?)");
  insert.run("v4", V4_NOTICE, V4_PURPOSE);
  insert.run("v6", V6_NOTICE, V6_PURPOSE);
  insert.run("v7", V7_NOTICE, V7_PURPOSE);
  insert.run("swapped", V7_NOTICE, V6_PURPOSE);
  insert.run("unknown", "unknown", "unknown");
  assert.deepEqual(
    database.prepare(`SELECT id FROM public_contact WHERE ${consentGuard} ORDER BY id`)
      .all()
      .map((row) => row.id),
    ["v4", "v6", "v7"],
  );
  database.close();

  assert.match(route, /publicPlanContactReleaseConsentSql\("public_contact"\)/);
  assert.match(route, /publicPlanContactReleaseConsentSql\("active_public_contact"\)/);
  assert.doesNotMatch(
    route,
    /publicPlanContactReleaseAccessSql\("(?:public_contact|active_public_contact)"\)/,
  );
  assert.match(
    route,
    /rows\.results\.flatMap[\s\S]*row\.public_contact_release_id && !publicContact[\s\S]*return \[\]/,
  );
  assert.match(
    route,
    /current\.public_contact_release_id && !publicTradeContactForMatchedLead\(current\)/,
  );
});

test("v4, v6 and v7 contact releases are projected only from their exact policy and selected fields", () => {
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

test("malformed, incompatible, withdrawn and mismatched releases fail closed after the shallow D1 prefilter", () => {
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
