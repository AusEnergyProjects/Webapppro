import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import {
  customerContactReadiness,
  validateCustomerProfile,
} from "../src/lib/customer-projects.mjs";

const route = fs.readFileSync(
  new URL("../src/app/api/customer-account/route.ts", import.meta.url),
  "utf8",
);
const patchRoute = route.slice(route.indexOf("export async function PATCH"));

test("installer request contact save is authenticated, owner scoped and status gated", () => {
  assert.match(patchRoute, /if \(!sameOrigin\(request\)\)/);
  assert.match(patchRoute, /const user = await identity\(request\)/);
  assert.match(patchRoute, /content-length/);
  assert.match(patchRoute, /raw\.confirmPrivateProfileSave !== true/);
  assert.match(
    patchRoute,
    /raw\.confirmSubmittedProjectContactUpdate === true/,
  );
  assert.match(patchRoute, /FROM customer_accounts WHERE firebase_uid = \?/);
  assert.match(
    patchRoute,
    /FROM customer_projects WHERE id = \? AND firebase_uid = \?/,
  );
  assert.match(patchRoute, /projectStatus === "draft"/);
  assert.match(
    patchRoute,
    /confirmSubmittedProjectContactUpdate[\s\S]{0,100}\["matching", "quote_review"\]\.includes\(projectStatus\)/,
  );
  assert.match(
    patchRoute,
    /status = 'draft'[\s\S]{0,100}\? = 1 AND status IN \('matching', 'quote_review'\)/,
  );
});

test("installer request contact save derives location and validates the merged profile", () => {
  assert.match(patchRoute, /postcode: project\.postcode/);
  assert.match(patchRoute, /addressState: project\.address_state/);
  assert.match(patchRoute, /displayName: account\.display_name/);
  assert.match(patchRoute, /propertyType: account\.property_type/);
  assert.match(patchRoute, /householdSituation: account\.household_situation/);
  assert.match(patchRoute, /accountUpdates: Boolean\(account\.account_updates\)/);
  assert.match(patchRoute, /validateCustomerProfile\(/);
  assert.match(patchRoute, /customerContactReadiness\(profile, project\)/);

  const merged = validateCustomerProfile({
    displayName: "Jamie Household",
    phone: "0400 000 000",
    addressLine1: "12 Example Street",
    addressLine2: "Unit 2",
    suburb: "Melbourne",
    postcode: "3000",
    addressState: "VIC",
    propertyType: "house",
    householdSituation: "owner",
    accountUpdates: true,
    consent: true,
  });
  assert.equal(merged.ok, true);
  assert.equal(
    customerContactReadiness(merged.profile, {
      postcode: "3000",
      address_state: "VIC",
    }).ok,
    true,
  );
});

test("profile contact update uses revision CAS and changes only contact and derived location fields", () => {
  const updateMatch = patchRoute.match(
    /db\.prepare\(`(UPDATE customer_accounts[\s\S]*?status IN \('matching', 'quote_review'\)[\s\S]*?)`\)\s*\.bind/,
  );
  assert.ok(updateMatch, "customer profile CAS update SQL was not found");
  const updateSql = updateMatch[1];
  const setClause = updateSql.match(/SET([\s\S]*?)WHERE firebase_uid/);
  assert.ok(setClause, "customer profile SET clause was not found");
  assert.deepEqual(
    [...setClause[1].matchAll(/([a-z0-9_]+)\s*=\s*\?/g)].map((match) => match[1]),
    [
      "phone",
      "address_line_1",
      "address_line_2",
      "suburb",
      "postcode",
      "address_state",
      "updated_at",
    ],
  );
  assert.doesNotMatch(
    setClause[1],
    /display_name|email|property_type|household_situation|account_updates|account_status|consent_version|consent_at|created_at/,
  );

  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE customer_accounts (
    firebase_uid text PRIMARY KEY NOT NULL,
    email text NOT NULL,
    display_name text NOT NULL,
    phone text NOT NULL,
    address_line_1 text NOT NULL,
    address_line_2 text NOT NULL,
    suburb text NOT NULL,
    postcode text NOT NULL,
    address_state text NOT NULL,
    property_type text NOT NULL,
    household_situation text NOT NULL,
    account_updates integer NOT NULL,
    account_status text NOT NULL,
    consent_version text NOT NULL,
    consent_at text NOT NULL,
    created_at text NOT NULL,
    updated_at text NOT NULL
  );
  CREATE TABLE customer_projects (
    id text PRIMARY KEY NOT NULL,
    firebase_uid text NOT NULL,
    postcode text NOT NULL,
    address_state text NOT NULL,
    status text NOT NULL
  );
  CREATE TABLE customer_search (
    entity_id text PRIMARY KEY NOT NULL,
    postcode text NOT NULL,
    state text NOT NULL
  );
  CREATE TRIGGER customer_search_update
  AFTER UPDATE OF postcode, address_state ON customer_accounts
  BEGIN
    DELETE FROM customer_search WHERE entity_id = old.firebase_uid;
    INSERT INTO customer_search(entity_id, postcode, state)
    VALUES (new.firebase_uid, new.postcode, new.address_state);
  END;`);
  const originalUpdatedAt = "2026-07-30T00:00:00.000Z";
  db.prepare(`INSERT INTO customer_accounts VALUES
    (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(
      "owner-1",
      "jamie@example.com",
      "Jamie Household",
      "",
      "",
      "",
      "",
      "2000",
      "NSW",
      "house",
      "owner",
      1,
      "active",
      "notice-v1",
      "2026-07-01T00:00:00.000Z",
      "2026-07-01T00:00:00.000Z",
      originalUpdatedAt,
    );
  db.prepare("INSERT INTO customer_projects VALUES (?, ?, ?, ?, ?)")
    .run("project-1", "owner-1", "3000", "VIC", "draft");
  db.prepare("INSERT INTO customer_search VALUES (?, ?, ?)")
    .run("owner-1", "2000", "NSW");

  const nextUpdatedAt = "2026-07-30T00:00:01.000Z";
  const totalChangesBefore = db.prepare("SELECT total_changes() total").get().total;
  const changed = db.prepare(updateSql).run(
    "0400 000 000",
    "12 Example Street",
    "Unit 2",
    "Melbourne",
    "3000",
    "VIC",
    nextUpdatedAt,
    "owner-1",
    originalUpdatedAt,
    "project-1",
    "owner-1",
    0,
  );
  const totalChangesAfter = db.prepare("SELECT total_changes() total").get().total;
  assert.equal(changed.changes, 1);
  assert.equal(
    totalChangesAfter - totalChangesBefore,
    3,
    "D1 includes the search trigger delete and insert in meta.changes",
  );
  assert.deepEqual(
    {
      ...db.prepare(`SELECT phone, address_line_1, address_line_2, suburb,
        postcode, address_state, updated_at FROM customer_accounts`).get(),
    },
    {
      phone: "0400 000 000",
      address_line_1: "12 Example Street",
      address_line_2: "Unit 2",
      suburb: "Melbourne",
      postcode: "3000",
      address_state: "VIC",
      updated_at: nextUpdatedAt,
    },
  );
  assert.deepEqual(
    {
      ...db.prepare(`SELECT email, display_name, property_type, household_situation,
        account_updates, account_status, consent_version, consent_at, created_at
        FROM customer_accounts`).get(),
    },
    {
      email: "jamie@example.com",
      display_name: "Jamie Household",
      property_type: "house",
      household_situation: "owner",
      account_updates: 1,
      account_status: "active",
      consent_version: "notice-v1",
      consent_at: "2026-07-01T00:00:00.000Z",
      created_at: "2026-07-01T00:00:00.000Z",
    },
  );

  const stale = db.prepare(updateSql).run(
    "0499 999 999",
    "99 Wrong Street",
    "",
    "Sydney",
    "3000",
    "VIC",
    "2026-07-30T00:00:02.000Z",
    "owner-1",
    originalUpdatedAt,
    "project-1",
    "owner-1",
    0,
  );
  assert.equal(stale.changes, 0);

  db.prepare("UPDATE customer_projects SET status = 'matching' WHERE id = ?")
    .run("project-1");
  const noLongerDraft = db.prepare(updateSql).run(
    "0499 999 999",
    "99 Wrong Street",
    "",
    "Melbourne",
    "3000",
    "VIC",
    "2026-07-30T00:00:02.000Z",
    "owner-1",
    nextUpdatedAt,
    "project-1",
    "owner-1",
    0,
  );
  assert.equal(noLongerDraft.changes, 0);

  const submittedContactUpdate = db.prepare(updateSql).run(
    "0499 999 999",
    "99 Updated Street",
    "",
    "Melbourne",
    "3000",
    "VIC",
    "2026-07-30T00:00:03.000Z",
    "owner-1",
    nextUpdatedAt,
    "project-1",
    "owner-1",
    1,
  );
  assert.equal(submittedContactUpdate.changes, 1);
  assert.deepEqual(
    {
      ...db.prepare(`SELECT phone, address_line_1, suburb, postcode,
        address_state FROM customer_accounts`).get(),
    },
    {
      phone: "0499 999 999",
      address_line_1: "99 Updated Street",
      suburb: "Melbourne",
      postcode: "3000",
      address_state: "VIC",
    },
  );

  db.prepare("UPDATE customer_projects SET status = 'completed' WHERE id = ?")
    .run("project-1");
  const completedContactUpdate = db.prepare(updateSql).run(
    "0488 888 888",
    "88 Closed Street",
    "",
    "Melbourne",
    "3000",
    "VIC",
    "2026-07-30T00:00:04.000Z",
    "owner-1",
    "2026-07-30T00:00:03.000Z",
    "project-1",
    "owner-1",
    1,
  );
  assert.equal(completedContactUpdate.changes, 0);
});

test("revision conflicts are structured and successful responses return the full profile", () => {
  assert.match(
    patchRoute,
    /expectedUpdatedAt !== String\(account\.updated_at \|\| ""\)/,
  );
  assert.match(route, /code: "PROFILE_REVISION_CONFLICT"/);
  assert.match(patchRoute, /Number\(updated\.meta\.changes \|\| 0\) < 1/);
  assert.doesNotMatch(
    patchRoute,
    /Number\(updated\.meta\.changes \|\| 0\) !== 1/,
  );
  for (const key of [
    "displayName",
    "phone",
    "addressLine1",
    "addressLine2",
    "suburb",
    "postcode",
    "addressState",
    "propertyType",
    "householdSituation",
    "accountUpdates",
    "accountStatus",
    "accountTier",
    "consentVersion",
    "consentAt",
    "createdAt",
    "updatedAt",
  ]) {
    assert.match(route, new RegExp(`${key}:`), `missing profile response field ${key}`);
  }
  assert.doesNotMatch(patchRoute, /INSERT INTO customer_accounts/);
});
