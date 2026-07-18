import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const crmRoute = read("../src/app/api/trade-crm/route.ts");
const fieldRoute = read("../src/app/api/trade-field-work/route.ts");
const syncRoute = read("../src/app/api/trade-team/sync/route.ts");
const addressRoute = read("../src/app/api/trade-address-suggestions/route.ts");
const dedup = read("../src/lib/trade-customer-dedup-server.ts");
const newJob = read("../src/components/TradeNewJobForm.tsx");
const workspace = read("../src/components/InstallerCrmWorkspace.tsx");
const fieldPanel = read("../src/components/TradeFieldWorkPanel.tsx");
const menu = read("../src/components/AccessibleMenu.tsx");
const mobile = read("../mobile/src/app/job/[id].tsx");
const mobileTypes = read("../mobile/src/lib/types.ts");
const migration = read("../drizzle/0073_phone_first_field_job.sql");

test("field-job migration adds durable building and appointment audit fields", () => {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE trade_crm_job_details (id text PRIMARY KEY NOT NULL)");
  db.exec("CREATE TABLE trade_crm_appointments (id text PRIMARY KEY NOT NULL)");
  for (const statement of migration.split("--> statement-breakpoint").map((item) => item.trim()).filter(Boolean)) db.exec(statement);
  const jobColumns = db.prepare("PRAGMA table_info(trade_crm_job_details)").all().map((row) => row.name);
  const appointmentColumns = db.prepare("PRAGMA table_info(trade_crm_appointments)").all().map((row) => row.name);
  assert.ok(jobColumns.includes("building_type"));
  for (const column of ["travel_started_at", "arrived_at", "work_started_at", "completed_at", "last_transition_by_uid"]) assert.ok(appointmentColumns.includes(column));
});

test("new job uses one accessible customer search with inline atomic creation", () => {
  assert.match(newJob, /SearchableLookup label="Find and select a customer"/);
  assert.match(newJob, /Name, number, phone, suburb or postcode/);
  assert.match(newJob, /Create new customer/);
  assert.match(newJob, /customerMode/);
  assert.match(crmRoute, /const intakeStatements: D1PreparedStatement\[\]/);
  assert.match(crmRoute, /\.\.\.intakeStatements/);
  assert.match(crmRoute, /INSERT INTO trade_crm_customers/);
  assert.match(crmRoute, /INSERT INTO trade_crm_service_sites/);
  assert.match(crmRoute, /INSERT INTO trade_work_orders/);
  assert.match(crmRoute, /duplicateCandidates.*409/s);
  assert.match(dedup, /email|phone|business number|service address/);
});

test("new job uses structured sites, provider-neutral suggestions and manual fallback", () => {
  assert.match(newJob, /Existing service site/);
  assert.match(newJob, /Add a new service site/);
  for (const field of ["addressLine1", "addressLine2", "suburb", "addressState", "postcode"]) assert.match(newJob, new RegExp(`name="${field}"`));
  assert.match(addressRoute, /TLINK_ADDRESS_AUTOCOMPLETE_ENDPOINT/);
  assert.match(addressRoute, /TLINK_ADDRESS_AUTOCOMPLETE_TOKEN/);
  assert.match(addressRoute, /configured: false, suggestions: \[\]/);
  assert.match(newJob, /Enter the address manually/);
  assert.match(newJob, /role="combobox"/);
  assert.match(newJob, /role="listbox"/);
});

test("guided intake removes manual titles and carries scheduling into the same flow", () => {
  assert.doesNotMatch(newJob, /name="title"|datalist|type your own|Appointment title/);
  for (const step of ["Create the job", "Add or attach the customer", "Choose who and what", "Schedule the time", "Request information"]) assert.match(newJob, new RegExp(step));
  assert.match(newJob, /name="buildingType"/);
  assert.match(newJob, /name="startsAt"/);
  assert.match(newJob, /Schedule and request info/);
  assert.match(crmRoute, /action === "create_scheduled_job"/);
  assert.match(crmRoute, /moneyValue\(body\.estimatedValueCents\)/);
});

test("optional summary notes have one editable owner in the Notes tab", () => {
  const overview = workspace.slice(workspace.indexOf('{tab === "summary"'), workspace.indexOf('{tab === "field"'));
  const notes = workspace.slice(workspace.indexOf('{tab === "notes"'), workspace.indexOf('{tab === "handover"'));
  assert.doesNotMatch(overview, /name="nextAction"|name="description"|name="tags"/);
  for (const field of ["nextAction", "description", "tags"]) assert.match(notes, new RegExp(`name="${field}"`));
  assert.match(workspace, /saveNotes/);
});

test("field workflow enforces ordered, audited and idempotent transitions", () => {
  for (const action of ["start_travel", "arrive", "start_work", "finish"]) assert.match(fieldRoute, new RegExp(`${action}: \\{ from:`));
  assert.match(fieldRoute, /trade_offline_actions/);
  assert.match(fieldRoute, /clientActionId/);
  assert.match(fieldRoute, /duplicate: true/);
  assert.match(fieldRoute, /appointment\.status !== transition\.from/);
  assert.match(fieldRoute, /const fieldCompleted = appointmentStatus === "completed" && job\?\.stage === "completed"/);
  assert.match(fieldRoute, /last_transition_by_uid/);
  assert.match(fieldRoute, /field_state_changed/);
  assert.match(syncRoute, /actionType === "advance_field_job"/);
  assert.match(mobileTypes, /'advance_field_job'/);
});

test("finish uses genuine blockers and exposes invoice and handover paths", () => {
  for (const source of [fieldRoute, syncRoute]) {
    assert.match(source, /trade_work_order_tasks/);
    assert.match(source, /trade_job_forms/);
    assert.match(source, /trade_crm_job_notes/);
    assert.match(source, /trade_crm_job_plan_requirements/);
    assert.match(source, /photoRequestProofOverview/);
  }
  assert.match(fieldRoute, /Unsynchronised field changes need attention/);
  assert.match(fieldPanel, /Prepare invoice/);
  assert.match(fieldPanel, /Open handover/);
});

test("contact actions stay behind the direct-customer permission boundary", () => {
  assert.match(fieldRoute, /const direct = job\?\.source_type !== "opportunity" && job\?\.customer_source === "trade_owned"/);
  assert.match(fieldRoute, /phone: direct \?/);
  assert.match(fieldRoute, /const address = direct \?/);
  assert.match(fieldPanel, /href=\{`tel:/);
  assert.match(fieldPanel, /Get directions/);
  assert.match(syncRoute, /customerPhone: directCustomer \?/);
  assert.match(mobile, /!job\.protectedJob/);
});

test("web and native surfaces show one primary action, Today checklist and truthful sync", () => {
  for (const label of ["Scope and instructions", "Assigned tasks", "Required forms", "Required photo proof", "Open issues or blockers"]) {
    assert.match(`${fieldRoute}\n${fieldPanel}\n${mobile}`, new RegExp(label));
  }
  assert.match(fieldPanel, /primaryAction/);
  assert.match(fieldPanel, /Saved/);
  assert.match(fieldPanel, /Syncing/);
  assert.match(fieldPanel, /Offline/);
  assert.match(fieldPanel, /Action required/);
  assert.match(fieldPanel, /does not queue field actions offline/);
  assert.match(mobile, /Reconnect before finishing/);
});

test("shared menus dismiss outside, on selection and Escape without leaking listeners", () => {
  assert.match(menu, /document\.addEventListener\("pointerdown"/);
  assert.match(menu, /event\.key === "Escape"/);
  assert.match(menu, /MENU_OPEN_EVENT/);
  assert.match(menu, /triggerRef\.current\?\.focus/);
  assert.match(menu, /removeEventListener/);
  assert.match(workspace, /<AccessibleMenu className="crm-quick-create"/);
  assert.match(workspace, /<AccessibleMenu className="crm-more-nav"/);
  assert.match(workspace, /<AccessibleMenu className="crm-job-more"/);
  assert.match(workspace, /close\(\)/);
});

test("new field workflow copy avoids prohibited dash characters", () => {
  assert.doesNotMatch(`${crmRoute}\n${fieldRoute}\n${syncRoute}\n${addressRoute}\n${newJob}\n${fieldPanel}\n${menu}\n${mobile}`, /[\u2013\u2014]/);
});
