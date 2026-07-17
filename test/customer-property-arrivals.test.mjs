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
const schema = read("../db/schema.ts");
const customerRoute = read("../src/app/api/customer-projects/route.ts");
const evidenceRoute = read("../src/app/api/customer-project-evidence/route.ts");
const opportunityRoute = read("../src/app/api/trade-opportunities/route.ts");
const workOrderRoute = read("../src/app/api/trade-work-orders/route.ts");
const customerUi = read("../src/components/CustomerDashboard.tsx");
const installerUi = read("../src/components/DirectTradeDashboard.tsx");
const arrivalUi = read("../src/components/InstallerArrivalWindows.tsx");

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
  priorities: ["comfort"],
  projectStage: "ready-for-pricing",
  timing: "within_3_months",
  budgetRange: "5_15k",
};

test("trade requests require structured property context and keep it anonymised", () => {
  const incomplete = normalizeCustomerProject(baseProject);
  assert.equal(incomplete.ok, true);
  assert.equal(submissionReadiness(incomplete.project).ok, false);
  const complete = normalizeCustomerProject({ ...baseProject, propertyContext: {
    storeys: "two", ageBand: "1960_1999", floorArea: "100_199", roofType: "tile",
    switchboard: "older_fuses", occupancy: "away_weekdays", accessConstraints: ["limited_parking"],
  } });
  assert.equal(submissionReadiness(complete.project).ok, true);
  const opportunity = buildAnonymizedOpportunity(complete.project, "project-1");
  assert.match(opportunity.summary, /two storeys/);
  assert.match(opportunity.summary, /limited parking/);
  assert.match(opportunity.summary, /Quoting photos are available separately/);
  assert.match(opportunity.summary, /Supporting documents stay withheld/);
  assert.equal("privateNotes" in opportunity, false);
});

test("installer arrival windows are bounded, non-overlapping and revision identified", () => {
  assert.equal(australiaLocalDateTime("WA", new Date("2026-07-18T00:00:00Z")), "2026-07-18T08:00");
  const windows = normaliseArrivalWindows([
    { startsAt: "2026-08-10T09:00", endsAt: "2026-08-10T11:00" },
    { startsAt: "2026-08-11T13:00", endsAt: "2026-08-11T15:00" },
  ], 3, "2026-07-18T09:00");
  assert.deepEqual(windows.map((item) => item.id), ["window-3-1", "window-3-2"]);
  assert.deepEqual(parseArrivalWindows(JSON.stringify(windows)), windows);
  assert.equal(selectedArrivalWindow(windows, "window-3-2")?.startsAt, "2026-08-11T13:00");
  assert.throws(() => normaliseArrivalWindows([{ startsAt: "2026-08-10T09:00", endsAt: "2026-08-10T09:15" }], 1, "2026-07-18T09:00"), /INVALID_ARRIVAL_WINDOWS/);
  assert.throws(() => normaliseArrivalWindows([{ startsAt: "2026-08-10T09:00", endsAt: "2026-08-11T10:00" }], 1, "2026-07-18T09:00"), /INVALID_ARRIVAL_WINDOWS/);
});

test("the additive migration stores property context, protected evidence and arrival revisions", () => {
  for (const name of ["customer_project_evidence", "customer_project_evidence_events", "customer_project_arrival_proposals", "customer_project_arrival_events"]) {
    assert.match(schema, new RegExp(`sqliteTable\\("${name}"`));
    assert.match(migration, new RegExp("CREATE TABLE `" + name + "`"));
  }
  assert.match(migration, /ALTER TABLE `customer_projects` ADD `property_context`/);
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE customer_projects (id text PRIMARY KEY NOT NULL)");
  for (const statement of migration.split("--> statement-breakpoint").map((item) => item.trim()).filter(Boolean)) db.exec(statement);
  const columns = db.prepare("PRAGMA table_info(customer_projects)").all().map((item) => item.name);
  assert.ok(columns.includes("property_context"));
  assert.ok(db.prepare("PRAGMA index_list(customer_project_evidence)").all().some((item) => item.name === "customer_project_evidence_client_idx"));
  db.close();
});

test("project evidence is R2 backed with quoting photos shared to allocated installers and documents acceptance gated", () => {
  assert.match(evidenceRoute, /EVIDENCE/);
  assert.match(evidenceRoute, /QUOTING_PHOTO_CATEGORIES/);
  assert.match(evidenceRoute, /m\.status IN \('offered', 'viewed', 'interested', 'connected'\)/);
  assert.match(evidenceRoute, /q\.customer_decision = 'accepted'/);
  assert.match(evidenceRoute, /r\.status = 'active'/);
  assert.match(evidenceRoute, /m\.status = 'connected'/);
  assert.match(evidenceRoute, /verification_status = 'approved'/);
  assert.match(evidenceRoute, /client_upload_id/);
  assert.match(evidenceRoute, /hasAllowedSignature/);
  assert.match(evidenceRoute, /customer-quoting-photo/);
  assert.match(evidenceRoute, /'installer', \?, 'viewed'/);
  assert.match(opportunityRoute, /e\.category IN \('property-photo', 'existing-equipment', 'switchboard'\)/);
  assert.match(opportunityRoute, /sharingScope/);
  assert.doesNotMatch(evidenceRoute, /public-read|Cache-Control": "public/);
});

test("only an accepted installer can propose windows or convert the platform lead", () => {
  assert.match(customerRoute, /confirmInstallerAcceptance !== true/);
  assert.match(customerRoute, /decision = 'accepted'|customer_decision = \?/);
  assert.match(customerRoute, /action === "select_arrival_window"/);
  assert.match(opportunityRoute, /action === "propose_arrival_windows"/);
  assert.match(opportunityRoute, /customer_decision !== "accepted"/);
  assert.match(workOrderRoute, /q\.customer_decision = 'accepted'/);
  assert.match(workOrderRoute, /r\.status = 'active'/);
  assert.match(installerUi, /Waiting for customer acceptance/);
  assert.doesNotMatch(installerUi, /Book site visit/);
});

test("customer devices can choose files or capture a new property photo", () => {
  assert.match(customerUi, /multiple accept="image\/jpeg,image\/png,image\/webp,image\/heic,image\/heif,application\/pdf"/);
  assert.match(customerUi, /capture="environment"/);
  assert.match(customerUi, /shared with every verified installer allocated to this enquiry/);
  assert.match(customerUi, /Supporting documents remain restricted until I accept one connected installer/);
  assert.match(customerRoute, /confirmInstallerPhotoSharing !== true/);
  assert.match(customerUi, /Accept installer for next step/);
  assert.match(arrivalUi, /Provide arrival windows for the customer/);
  assert.match(arrivalUi, /data-date-range-group=/);
  assert.match(arrivalUi, /data-date-range-role="start"/);
  assert.match(arrivalUi, /data-date-range-role="end"/);
});

test("new property evidence and arrival copy avoids prohibited dash characters", () => {
  assert.doesNotMatch(customerUi + installerUi + arrivalUi + evidenceRoute, /\u2013|\u2014/);
});
