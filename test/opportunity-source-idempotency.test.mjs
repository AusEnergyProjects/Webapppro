import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import {
  PUBLIC_PLAN_CONSENT_NOTICE_VERSION,
  PUBLIC_PLAN_CONSENT_PURPOSE,
} from "../src/lib/public-plan-enquiry.mjs";
import { persistLeadOpportunity } from "../src/lib/opportunity-source-write.mjs";

function databaseAdapter(database, { failContactWrite = false } = {}) {
  return {
    prepare(sql) {
      return {
        bind(...bindings) {
          return {
            async run() {
              if (failContactWrite && /INSERT INTO public_trade_lead_contact_releases/.test(sql)) {
                throw new Error("SIMULATED_CONTACT_RELEASE_WRITE_FAILURE");
              }
              return database.prepare(sql).run(...bindings);
            },
            async first() {
              return database.prepare(sql).get(...bindings) || null;
            },
          };
        },
      };
    },
  };
}

function sourceDatabase() {
  const database = new DatabaseSync(":memory:");
  database.exec(`CREATE TABLE trade_opportunities (
    id text PRIMARY KEY NOT NULL,
    title text NOT NULL,
    project_type text NOT NULL,
    postcode text NOT NULL,
    state text NOT NULL,
    service_categories text NOT NULL,
    priority text NOT NULL,
    timing text NOT NULL,
    summary text NOT NULL,
    status text NOT NULL,
    source_reference text NOT NULL,
    contact_limit integer NOT NULL,
    maximum_connected_installers integer NOT NULL,
    expires_at text NOT NULL,
    expired_at text NOT NULL,
    created_by_uid text NOT NULL,
    created_at text NOT NULL,
    updated_at text NOT NULL
  );
  CREATE UNIQUE INDEX trade_opportunities_source_reference_idx
    ON trade_opportunities (source_reference) WHERE source_reference <> '';
  CREATE TABLE public_trade_lead_contact_releases (
    id text PRIMARY KEY NOT NULL,
    opportunity_id text NOT NULL UNIQUE,
    source_reference text NOT NULL UNIQUE,
    status text NOT NULL,
    notice_version text NOT NULL,
    consent_purpose text NOT NULL,
    disclosed_fields text NOT NULL,
    customer_name text NOT NULL,
    customer_first_name text NOT NULL,
    customer_last_name text NOT NULL,
    customer_email text NOT NULL,
    customer_phone text NOT NULL,
    customer_unit_number text NOT NULL,
    customer_street_address text NOT NULL,
    customer_suburb text NOT NULL,
    customer_address_state text NOT NULL,
    postcode text NOT NULL,
    customer_message text NOT NULL,
    granted_at text NOT NULL,
    withdrawn_at text NOT NULL,
    created_at text NOT NULL,
    updated_at text NOT NULL
  );
  CREATE TABLE trade_opportunity_matches (
    id text PRIMARY KEY NOT NULL,
    opportunity_id text NOT NULL
  );`);
  return database;
}

function opportunity(id, overrides = {}) {
  return {
    id,
    title: "Heating and cooling project",
    projectType: "House | Planning",
    postcode: "3000",
    state: "VIC",
    serviceCategories: JSON.stringify(["heating-cooling"]),
    priority: "standard",
    timing: "planning",
    summary: "Public customer enquiry.",
    requestedStatus: "open",
    sourceReference: "AEA-20260810-IDEMPOTENT",
    contactLimit: 2,
    maximumConnectedInstallers: 3,
    expiresAt: "2026-09-09T00:00:00.000Z",
    createdAt: "2026-08-10T00:00:00.000Z",
    publicPlanEnquiry: true,
    ...overrides,
  };
}

function contact(id, overrides = {}) {
  return {
    id,
    noticeVersion: PUBLIC_PLAN_CONSENT_NOTICE_VERSION,
    consentPurpose: PUBLIC_PLAN_CONSENT_PURPOSE,
    disclosedFields: [
      "customer_name",
      "customer_email",
      "postcode",
      "service_categories",
      "customer_message",
    ],
    customerFirstName: "Jamie",
    customerLastName: "Example",
    customerEmail: "jamie@example.test",
    customerPhone: "",
    customerUnitNumber: "Unit 4",
    customerStreetAddress: "15 Example Street",
    customerSuburb: "MELBOURNE",
    customerAddressState: "VIC",
    customerMessage: "Please call after 4 pm.",
    grantedAt: "2026-08-10T00:00:00.000Z",
    ...overrides,
  };
}

const currentConsent = {
  noticeVersion: PUBLIC_PLAN_CONSENT_NOTICE_VERSION,
  purpose: PUBLIC_PLAN_CONSENT_PURPOSE,
};

test("the exact current notice creates one open opportunity and current contact release", async () => {
  assert.ok(PUBLIC_PLAN_CONSENT_NOTICE_VERSION.length > 40);
  assert.ok(PUBLIC_PLAN_CONSENT_NOTICE_VERSION.length <= 64);
  const database = sourceDatabase();
  const stored = await persistLeadOpportunity(
    databaseAdapter(database),
    opportunity("opportunity-1"),
    contact("contact-1"),
    currentConsent,
  );
  assert.deepEqual(stored, {
    id: "opportunity-1",
    status: "open",
    contactIsCurrent: true,
  });
  assert.equal(database.prepare("SELECT COUNT(*) count FROM trade_opportunities").get().count, 1);
  assert.equal(database.prepare("SELECT COUNT(*) count FROM public_trade_lead_contact_releases").get().count, 1);
  assert.deepEqual({ ...database.prepare(`SELECT customer_name, customer_first_name, customer_last_name
    FROM public_trade_lead_contact_releases`).get() }, {
    customer_name: "Jamie Example",
    customer_first_name: "Jamie",
    customer_last_name: "Example",
  });
  database.close();
});

test("a contact release write failure leaves the public opportunity draft with no match", async () => {
  const database = sourceDatabase();
  await assert.rejects(() => persistLeadOpportunity(
    databaseAdapter(database, { failContactWrite: true }),
    opportunity("opportunity-failed-contact"),
    contact("contact-failed"),
    currentConsent,
  ), /SIMULATED_CONTACT_RELEASE_WRITE_FAILURE/);
  assert.equal(database.prepare("SELECT status FROM trade_opportunities").get().status, "draft");
  assert.equal(database.prepare("SELECT COUNT(*) count FROM public_trade_lead_contact_releases").get().count, 0);
  assert.equal(database.prepare("SELECT COUNT(*) count FROM trade_opportunity_matches").get().count, 0);
  database.close();
});

test("two concurrent retries converge on one canonical opportunity and one contact release", async () => {
  const database = sourceDatabase();
  const adapter = databaseAdapter(database);
  const results = await Promise.all([
    persistLeadOpportunity(adapter, opportunity("opportunity-a"), contact("contact-a"), currentConsent),
    persistLeadOpportunity(adapter, opportunity("opportunity-b"), contact("contact-b"), currentConsent),
  ]);
  assert.equal(new Set(results.map((result) => result.id)).size, 1);
  assert.equal(results[0].status, "open");
  assert.equal(results[1].status, "open");
  assert.equal(database.prepare("SELECT COUNT(*) count FROM trade_opportunities").get().count, 1);
  assert.equal(database.prepare("SELECT COUNT(*) count FROM public_trade_lead_contact_releases").get().count, 1);
  database.close();
});

test("a reused source reference with different lead or contact fields is rejected", async () => {
  const database = sourceDatabase();
  const adapter = databaseAdapter(database);
  await persistLeadOpportunity(
    adapter,
    opportunity("opportunity-original"),
    contact("contact-original"),
    currentConsent,
  );
  await assert.rejects(() => persistLeadOpportunity(
    adapter,
    opportunity("opportunity-altered", { postcode: "3001" }),
    contact("contact-altered", { customerMessage: "Different message" }),
    currentConsent,
  ), /OPPORTUNITY_SOURCE_REFERENCE_MISMATCH/);
  await assert.rejects(() => persistLeadOpportunity(
    adapter,
    opportunity("opportunity-altered-address"),
    contact("contact-altered-address", { customerStreetAddress: "99 Different Street" }),
    currentConsent,
  ), /OPPORTUNITY_SOURCE_REFERENCE_MISMATCH/);
  await assert.rejects(() => persistLeadOpportunity(
    adapter,
    opportunity("opportunity-altered-locality"),
    contact("contact-altered-locality", { customerSuburb: "CARLTON" }),
    currentConsent,
  ), /OPPORTUNITY_SOURCE_REFERENCE_MISMATCH/);
  await assert.rejects(() => persistLeadOpportunity(
    adapter,
    opportunity("opportunity-altered-name"),
    contact("contact-altered-name", { customerLastName: "Changed" }),
    currentConsent,
  ), /OPPORTUNITY_SOURCE_REFERENCE_MISMATCH/);
  assert.equal(database.prepare("SELECT postcode FROM trade_opportunities").get().postcode, "3000");
  assert.equal(
    database.prepare("SELECT customer_message FROM public_trade_lead_contact_releases").get().customer_message,
    "Please call after 4 pm.",
  );
  database.close();
});
