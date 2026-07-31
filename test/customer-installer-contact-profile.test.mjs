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
const projectsRoute = fs.readFileSync(
  new URL("../src/app/api/customer-projects/route.ts", import.meta.url),
  "utf8",
);
const submitRoute = projectsRoute.slice(
  projectsRoute.indexOf('action === "submit"'),
  projectsRoute.indexOf('action === "release_contact"'),
);

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

test("profile contact update treats the confirmed modal fields as authoritative and changes only contact and derived location fields", () => {
  const updateMatch = patchRoute.match(
    /db\.prepare\(`(UPDATE customer_accounts[\s\S]*?status IN \('matching', 'quote_review'\)[\s\S]*?)`\)\s*\.bind/,
  );
  assert.ok(updateMatch, "authoritative customer profile update SQL was not found");
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

  const authoritativeOverwrite = db.prepare(updateSql).run(
    "0499 999 999",
    "99 Wrong Street",
    "",
    "Sydney",
    "3000",
    "VIC",
    "2026-07-30T00:00:02.000Z",
    "owner-1",
    "project-1",
    "owner-1",
    0,
  );
  assert.equal(authoritativeOverwrite.changes, 1);

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
    "project-1",
    "owner-1",
    1,
  );
  assert.equal(completedContactUpdate.changes, 0);
});

test("the confirmed contact endpoint has no profile revision conflict and successful responses return the full profile", () => {
  assert.doesNotMatch(patchRoute, /expectedUpdatedAt/);
  assert.doesNotMatch(route, /PROFILE_REVISION_CONFLICT/);
  assert.match(
    patchRoute,
    /WHERE firebase_uid = \?\s+AND EXISTS/,
  );
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

test("installer submit validates one authoritative contact payload and persists it with the opportunity", () => {
  assert.match(
    submitRoute,
    /raw\.contact && typeof raw\.contact === "object"/,
  );
  assert.match(submitRoute, /validateCustomerProfile\(\{/);
  assert.match(submitRoute, /postcode: current\.postcode/);
  assert.match(submitRoute, /addressState: current\.address_state/);
  assert.match(
    submitRoute,
    /customerContactReadiness\(\s*authoritativeContact,\s*current,\s*\)/,
  );
  assert.match(
    submitRoute,
    /UPDATE customer_accounts[\s\S]*UPDATE customer_projects[\s\S]*INSERT INTO trade_opportunities/,
  );
  assert.match(
    submitRoute,
    /status IN \('matching', 'quote_review'\)/,
  );
  assert.match(
    submitRoute,
    /This project is no longer open for installer matching\./,
  );
  assert.doesNotMatch(
    submitRoute,
    /current\.status !== "draft" && !activeSubmitRetry\) \{\s*return json\(\{ ok: true/,
  );
  assert.match(submitRoute, /profile: responseProfile/);
  assert.doesNotMatch(submitRoute, /PROFILE_REVISION_CONFLICT/);
});

test("contact readiness accepts raw D1 address columns without redirecting the customer", () => {
  assert.deepEqual(
    customerContactReadiness(
      {
        phone: "0421 731 505",
        address_line_1: "70 Southbank Boulevard",
        suburb: "Southbank",
        postcode: "3006",
        address_state: "VIC",
      },
      {
        postcode: "3006",
        address_state: "VIC",
      },
    ),
    { ok: true },
  );
});

test("the authoritative submit SQL accepts the modal contact and rejects a stale project without a partial profile write", () => {
  const accountUpdate = submitRoute.match(
    /const submitStatements = \[\s*db\.prepare\(`(UPDATE customer_accounts[\s\S]*?)`\)/,
  )?.[1];
  const projectUpdate = submitRoute.match(
    /,\s*db\.prepare\(`(UPDATE customer_projects[\s\S]*?)`\)/,
  )?.[1];
  const ownerContactSelect = projectsRoute.match(
    /const account = await db\.prepare\(`(SELECT display_name[\s\S]*?FROM customer_accounts WHERE firebase_uid = \?)`\)/,
  )?.[1];
  assert.ok(accountUpdate, "authoritative account update SQL was not found");
  assert.ok(projectUpdate, "guarded project submit SQL was not found");
  assert.ok(ownerContactSelect, "owner contact projection SQL was not found");

  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE customer_accounts (
    firebase_uid text PRIMARY KEY NOT NULL,
    display_name text NOT NULL,
    email text NOT NULL,
    phone text NOT NULL,
    address_line_1 text NOT NULL,
    address_line_2 text NOT NULL,
    suburb text NOT NULL,
    postcode text NOT NULL,
    address_state text NOT NULL,
    account_status text NOT NULL,
    updated_at text NOT NULL
  );
  CREATE TABLE customer_projects (
    id text PRIMARY KEY NOT NULL,
    firebase_uid text NOT NULL,
    status text NOT NULL,
    opportunity_id text NOT NULL,
    submitted_at text NOT NULL,
    plan_revision integer NOT NULL,
    updated_at text NOT NULL
  );
  CREATE TABLE trade_opportunities (
    id text PRIMARY KEY NOT NULL
  );`);
  db.prepare(`INSERT INTO customer_accounts VALUES
    (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(
      "owner-1",
      "Jamie Household",
      "jamie@example.com",
      "",
      "",
      "",
      "",
      "2000",
      "NSW",
      "active",
      "2026-07-31T00:00:00.000Z",
    );
  db.prepare("INSERT INTO customer_projects VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(
      "project-1",
      "owner-1",
      "draft",
      "",
      "",
      4,
      "2026-07-31T00:00:00.000Z",
    );

  const contact = {
    phone: "0421 731 505",
    addressLine1: "70 Southbank Boulevard",
    addressLine2: "Unit 6612",
    suburb: "Southbank",
    postcode: "3006",
    addressState: "VIC",
  };
  const opportunityId = "customer-project:project-1";
  const contactUpdatedAt = "2026-07-31T00:00:01.000Z";
  const submittedAt = "2026-07-31T00:00:02.000Z";
  const accountChanged = db.prepare(accountUpdate).run(
    contact.phone,
    contact.addressLine1,
    contact.addressLine2,
    contact.suburb,
    contact.postcode,
    contact.addressState,
    contactUpdatedAt,
    "owner-1",
    "project-1",
    "owner-1",
    4,
    "2026-07-31T00:00:00.000Z",
    opportunityId,
  );
  const projectChanged = db.prepare(projectUpdate).run(
    opportunityId,
    submittedAt,
    submittedAt,
    "project-1",
    "owner-1",
    4,
    "2026-07-31T00:00:00.000Z",
    opportunityId,
    "owner-1",
    contact.phone,
    contact.addressLine1,
    contact.addressLine2,
    contact.suburb,
    contact.postcode,
    contact.addressState,
    contactUpdatedAt,
  );
  assert.equal(accountChanged.changes, 1);
  assert.equal(projectChanged.changes, 1);
  assert.deepEqual(
    {
      ...db.prepare(`SELECT phone, address_line_1, address_line_2, suburb,
        postcode, address_state FROM customer_accounts`).get(),
    },
    {
      phone: contact.phone,
      address_line_1: contact.addressLine1,
      address_line_2: contact.addressLine2,
      suburb: contact.suburb,
      postcode: contact.postcode,
      address_state: contact.addressState,
    },
  );
  assert.deepEqual(
    {
      ...db.prepare(`SELECT status, opportunity_id, submitted_at
        FROM customer_projects`).get(),
    },
    {
      status: "matching",
      opportunity_id: opportunityId,
      submitted_at: submittedAt,
    },
  );
  const projectedContact = db.prepare(ownerContactSelect).get("owner-1");
  assert.equal(
    customerContactReadiness(projectedContact, {
      postcode: "3006",
      address_state: "VIC",
    }).ok,
    true,
    "the D1 projection must satisfy readiness without a false missing-address error",
  );

  db.prepare(`UPDATE customer_accounts SET phone = '', address_line_1 = '',
    address_line_2 = '', suburb = '', postcode = '2000', address_state = 'NSW',
    updated_at = '2026-07-31T00:00:03.000Z'`).run();
  db.prepare(`UPDATE customer_projects SET status = 'draft', opportunity_id = '',
    submitted_at = '', plan_revision = 5,
    updated_at = '2026-07-31T00:00:03.000Z'`).run();
  const staleAccountWrite = db.prepare(accountUpdate).run(
    contact.phone,
    contact.addressLine1,
    contact.addressLine2,
    contact.suburb,
    contact.postcode,
    contact.addressState,
    "2026-07-31T00:00:04.000Z",
    "owner-1",
    "project-1",
    "owner-1",
    4,
    "2026-07-31T00:00:03.000Z",
    opportunityId,
  );
  assert.equal(staleAccountWrite.changes, 0);
  assert.deepEqual(
    {
      ...db.prepare(`SELECT phone, address_line_1, postcode, address_state
        FROM customer_accounts`).get(),
    },
    {
      phone: "",
      address_line_1: "",
      postcode: "2000",
      address_state: "NSW",
    },
  );
});
