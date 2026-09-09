import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import {
  buildAnonymizedOpportunity,
  normalizeCustomerProject,
  submissionReadiness,
} from "../src/lib/customer-projects.mjs";
import {
  australiaLocalDateTime,
  normaliseArrivalWindows,
  parseArrivalWindows,
  selectedArrivalWindow,
} from "../src/lib/customer-project-arrivals.mjs";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const migration = read("../drizzle/0057_customer_property_arrivals.sql");
const handoffMigration = read(
  "../drizzle/0058_trade_contact_arrival_handoff.sql",
);
const schema = read("../db/schema.ts");
const privateImageEvidence = read("../src/lib/private-image-evidence.ts");
const opportunityRoute = read("../src/app/api/trade-opportunities/route.ts");
const workOrderRoute = read("../src/app/api/trade-work-orders/route.ts");
const scheduleRoute = read("../src/app/api/trade-schedule/route.ts");
const tradeProfileRoute = read("../src/app/api/trade-profile/route.ts");
const customerPhotoUpload = read("../src/lib/customer-photo-upload.ts");
const installerUi = read("../src/components/DirectTradeDashboard.tsx");
const arrivalUi = read("../src/components/InstallerArrivalWindows.tsx");
const tradeSignupUi = read("../src/components/DirectTradePartnerForm.tsx");

const baseProject = {
  title: "Heating upgrade",
  postcode: "3000",
  addressState: "VIC",
  propertyType: "house",
  householdSituation: "owner",
  goal: "lower-bills",
  pace: "staged",
  existingFeatures: [],
  serviceCategories: ["heating-cooling"],
  priorities: [],
  projectStage: "ready-for-pricing",
  timing: "within_3_months",
  budgetRange: "5_15k",
};

test("trade requests require structured property context and keep it anonymised", () => {
  const incomplete = normalizeCustomerProject(baseProject);
  assert.equal(incomplete.ok, true);
  assert.equal(submissionReadiness(incomplete.project).ok, false);
  const complete = normalizeCustomerProject({
    ...baseProject,
    propertyContext: {
      storeys: "two",
      ageBand: "1960_1999",
      floorArea: "100_199",
      roofType: "tile",
      switchboard: "older_fuses",
      occupancy: "away_weekdays",
      accessConstraints: ["limited_parking"],
    },
  });
  assert.deepEqual(complete.project.priorities, ["lower-bills"]);
  assert.equal(submissionReadiness(complete.project).ok, true);
  const opportunity = buildAnonymizedOpportunity(complete.project, "project-1");
  assert.match(opportunity.summary, /two storeys/);
  assert.match(opportunity.summary, /limited parking/);
  assert.doesNotMatch(opportunity.summary, /away on weekdays|access timing/i);
  assert.match(
    opportunity.summary,
    /customer-approved photos and documents are provided separately/,
  );
  assert.equal("privateNotes" in opportunity, false);
});

test("installer arrival windows are bounded, non-overlapping and revision identified", () => {
  assert.equal(
    australiaLocalDateTime("WA", new Date("2026-07-18T00:00:00Z")),
    "2026-07-18T08:00",
  );
  const windows = normaliseArrivalWindows(
    [
      { startsAt: "2026-08-10T09:00", endsAt: "2026-08-10T11:00" },
      { startsAt: "2026-08-11T13:00", endsAt: "2026-08-11T15:00" },
    ],
    3,
    "2026-07-18T09:00",
  );
  assert.deepEqual(
    windows.map((item) => item.id),
    ["window-3-1", "window-3-2"],
  );
  assert.deepEqual(parseArrivalWindows(JSON.stringify(windows)), windows);
  assert.equal(
    selectedArrivalWindow(windows, "window-3-2")?.startsAt,
    "2026-08-11T13:00",
  );
  assert.throws(
    () =>
      normaliseArrivalWindows(
        [{ startsAt: "2026-08-10T09:00", endsAt: "2026-08-10T09:15" }],
        1,
        "2026-07-18T09:00",
      ),
    /INVALID_ARRIVAL_WINDOWS/,
  );
  assert.throws(
    () =>
      normaliseArrivalWindows(
        [{ startsAt: "2026-08-10T09:00", endsAt: "2026-08-11T10:00" }],
        1,
        "2026-07-18T09:00",
      ),
    /INVALID_ARRIVAL_WINDOWS/,
  );
});

test("the additive migration stores property context, protected evidence and arrival revisions", () => {
  for (const name of [
    "customer_project_evidence",
    "customer_project_evidence_events",
    "customer_project_arrival_proposals",
    "customer_project_arrival_events",
  ]) {
    assert.match(schema, new RegExp(`sqliteTable\\("${name}"`));
    assert.match(migration, new RegExp("CREATE TABLE `" + name + "`"));
  }
  assert.match(
    migration,
    /ALTER TABLE `customer_projects` ADD `property_context`/,
  );
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE customer_projects (id text PRIMARY KEY NOT NULL)");
  for (const statement of migration
    .split("--> statement-breakpoint")
    .map((item) => item.trim())
    .filter(Boolean))
    db.exec(statement);
  const columns = db
    .prepare("PRAGMA table_info(customer_projects)")
    .all()
    .map((item) => item.name);
  assert.ok(columns.includes("property_context"));
  assert.ok(
    db
      .prepare("PRAGMA index_list(customer_project_evidence)")
      .all()
      .some((item) => item.name === "customer_project_evidence_client_idx"),
  );
  db.close();
});

test("project evidence is R2 backed with explicit private or installer sharing scope", () => {
  assert.match(privateImageEvidence, /stripJpegMetadata/);
  assert.match(privateImageEvidence, /stripPngMetadata/);
  assert.match(privateImageEvidence, /stripWebpMetadata/);
  assert.match(opportunityRoute, /sharingScope: "allocated-installers"/);
  assert.match(opportunityRoute, /purpose = 'installer_evidence_sharing'/);
  assert.match(opportunityRoute, /fileName: installerEvidenceName\(item\)/);
  assert.doesNotMatch(opportunityRoute, /fileName: item\.file_name/);
  assert.doesNotMatch(
    opportunityRoute,
    /e\.category IN \('property-photo', 'existing-equipment', 'switchboard'\)/,
  );
});

test("only an accepted installer can propose windows or convert the platform lead", () => {
  assert.match(opportunityRoute, /action === "propose_arrival_windows"/);
  assert.match(opportunityRoute, /customer_decision !== "accepted"/);
  assert.match(workOrderRoute, /q\.customer_decision = 'accepted'/);
  assert.match(workOrderRoute, /r\.status = 'active'/);
  assert.match(workOrderRoute, /change_source, source_reference/);
  assert.match(workOrderRoute, /'customer_arrival'/);
  assert.match(workOrderRoute, /crm_appointment_id/);
  assert.match(installerUi, /Waiting for the customer to choose a business/);
  assert.doesNotMatch(installerUi, /Book site visit/);
});

test("customer devices use guided safe capture plus separate supporting evidence", () => {
  assert.match(customerPhotoUpload, /MAX_PREPARED_CUSTOMER_PHOTO_BYTES = 640 \* 1024/);
  assert.match(customerPhotoUpload, /maximumDimension = 1920/);
  assert.match(arrivalUi, /Provide arrival windows for the customer/);
  assert.match(arrivalUi, /data-date-range-group=/);
  assert.match(arrivalUi, /data-date-range-role="start"/);
  assert.match(arrivalUi, /data-date-range-role="end"/);
});

test("direct installer contact is limited, audited and backed by mandatory trade details", () => {
  assert.match(handoffMigration, /ALTER TABLE `trade_accounts` ADD `abn`/);
  assert.match(handoffMigration, /direct_contact_snapshot/);
  assert.match(tradeProfileRoute, /isValidAbn/);
  assert.match(tradeProfileRoute, /Enter the business contact number/);
  assert.match(tradeProfileRoute, /valid business account email is required/);
  assert.match(tradeSignupUi, /label="ABN"/);
  assert.match(tradeSignupUi, /label="Business contact number"/);
});

test("materialised CRM appointments support customer preparation acknowledgement", () => {
  assert.match(handoffMigration, /crm_work_order_id/);
  assert.match(handoffMigration, /crm_appointment_id/);
  assert.match(handoffMigration, /preparation_acknowledged_at/);
  assert.match(scheduleRoute, /preparation_acknowledged_at = ''/);
  assert.match(
    arrivalUi,
    /CRM appointment is ready for staff assignment and conflict review/,
  );
});
