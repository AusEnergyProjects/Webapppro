import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import {
  CUSTOMER_CONTACT_RELEASE_FIELDS,
  CUSTOMER_CONTACT_RELEASE_NOTICE_VERSION,
  customerContactReadiness,
} from "../src/lib/customer-projects.mjs";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const migration = read("../drizzle/0056_customer_contact_release.sql");
const schema = read("../db/schema.ts");
const accountRoute = read("../src/app/api/customer-account/route.ts");
const projectsRoute = read("../src/app/api/customer-projects/route.ts");
const opportunitiesRoute = read("../src/app/api/trade-opportunities/route.ts");
const customerUi = read("../src/components/CustomerDashboard.tsx");
const installerUi = read("../src/components/DirectTradeDashboard.tsx");

test("contact readiness requires a complete service record matching the project", () => {
  assert.equal(customerContactReadiness({}, { postcode: "3000", addressState: "VIC" }).ok, false);
  const profile = {
    phone: "0400 000 000",
    addressLine1: "12 Example Street",
    suburb: "Melbourne",
    postcode: "3000",
    addressState: "VIC",
  };
  assert.equal(customerContactReadiness(profile, { postcode: "3000", addressState: "VIC" }).ok, true);
  assert.equal(customerContactReadiness(profile, { postcode: "2000", addressState: "NSW" }).ok, false);
  assert.deepEqual(CUSTOMER_CONTACT_RELEASE_FIELDS, ["name", "email", "phone", "service_address"]);
  assert.equal(CUSTOMER_CONTACT_RELEASE_NOTICE_VERSION, "2026-07-18");
});

test("the additive migration stores private snapshots and immutable release events", () => {
  assert.match(schema, /sqliteTable\("customer_project_contact_releases"/);
  assert.match(schema, /sqliteTable\("customer_project_contact_release_events"/);
  assert.match(migration, /ALTER TABLE `customer_accounts` ADD `phone`/);
  assert.match(migration, /customer_project_contact_releases_match_idx/);
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE customer_accounts (
    firebase_uid text PRIMARY KEY NOT NULL,
    email text NOT NULL,
    display_name text NOT NULL,
    postcode text DEFAULT '' NOT NULL,
    address_state text DEFAULT '' NOT NULL
  )`);
  for (const statement of migration.split("--> statement-breakpoint").map((item) => item.trim()).filter(Boolean)) db.exec(statement);
  db.prepare(`INSERT INTO customer_project_contact_releases
    (id, project_id, opportunity_id, opportunity_match_id, quote_id, customer_uid, installer_uid,
     status, notice_version, disclosed_fields, customer_name, customer_email, customer_phone,
     address_line_1, address_line_2, suburb, address_state, postcode, granted_at, withdrawn_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, '[]', ?, ?, ?, ?, '', ?, ?, ?, ?, '', ?, ?)`)
    .run("release-1", "project-1", "opportunity-1", "match-1", "quote-1", "customer-1", "installer-1",
      CUSTOMER_CONTACT_RELEASE_NOTICE_VERSION, "Jamie", "jamie@example.com", "0400000000", "12 Example Street",
      "Melbourne", "VIC", "3000", "2026-07-18T00:00:00.000Z", "2026-07-18T00:00:00.000Z", "2026-07-18T00:00:00.000Z");
  assert.throws(() => db.prepare(`INSERT INTO customer_project_contact_releases
    (id, project_id, opportunity_id, opportunity_match_id, quote_id, customer_uid, installer_uid,
     status, notice_version, disclosed_fields, customer_name, customer_email, customer_phone,
     address_line_1, address_line_2, suburb, address_state, postcode, granted_at, withdrawn_at, created_at, updated_at)
    SELECT 'release-2', project_id, opportunity_id, opportunity_match_id, quote_id, customer_uid, installer_uid,
      status, notice_version, disclosed_fields, customer_name, customer_email, customer_phone,
      address_line_1, address_line_2, suburb, address_state, postcode, granted_at, withdrawn_at, created_at, updated_at
    FROM customer_project_contact_releases WHERE id = 'release-1'`).run(), /UNIQUE constraint failed/);
});

test("customer release is explicit, exact-match scoped, verified and audited", () => {
  for (const boundary of [
    'action === "release_contact"',
    "raw.confirmContactRelease !== true",
    'customer_decision !== "shortlisted"',
    'verification_status !== "approved"',
    "customerContactReadiness(releaseSource, current)",
    "customer_project_contact_release_events",
    "matched_installer_contact_release:",
  ]) assert.ok(projectsRoute.includes(boundary), `missing contact release boundary: ${boundary}`);
  assert.match(projectsRoute, /UPDATE trade_opportunity_matches SET status = 'connected'/);
  assert.match(projectsRoute, /event_type, notice_version, disclosed_fields/);
  assert.match(accountRoute, /phone, address_line_1, address_line_2, suburb/);
});

test("installer payload exposes snapshots only through its own active release", () => {
  assert.match(opportunitiesRoute, /r\.opportunity_match_id = m\.id/);
  assert.match(opportunitiesRoute, /r\.installer_uid = m\.firebase_uid AND r\.status = 'active'/);
  assert.match(opportunitiesRoute, /customerContact: row\.contact_release_id/);
  assert.match(opportunitiesRoute, /postcode: ""/);
  assert.match(opportunitiesRoute, /Customer details appear only after that customer releases them to this exact match/);
});

test("interfaces name the recipient and explain withdrawal limits", () => {
  assert.match(customerUi, /Connect with \{quote\.installerBusinessName\}/);
  assert.match(customerUi, /confirmContactRelease: true/);
  assert.match(customerUi, /Other\s+installers remain anonymised/);
  assert.match(customerUi, /It cannot erase\s+information an installer already viewed or saved/);
  assert.match(installerUi, /Customer-authorised contact/);
  assert.match(installerUi, /opportunity\.customerContact\.phone/);
  assert.doesNotMatch(`${customerUi}\n${installerUi}\n${accountRoute}\n${projectsRoute}\n${opportunitiesRoute}`, /[\u2013\u2014]/);
});
