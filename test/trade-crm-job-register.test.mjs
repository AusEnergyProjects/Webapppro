import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import {
  deriveJobRegisterOperationalStatus,
  JOB_REGISTER_CUSTOMER_CONTEXT_SQL,
  protectedJobCustomerText,
  projectJobRegisterRecord,
} from "../src/lib/trade-crm-job-register.ts";
import { decodeKeysetCursor, encodeKeysetCursor } from "../src/lib/keyset-pagination.ts";
import { tradeQuoteDocumentDisplayTotals } from "../src/lib/trade-quote-document-totals.mjs";
import { calculateQuoteSelection } from "../src/lib/trade-quote-options.ts";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");

test("controlled job lifecycle is derived from authoritative job facts", () => {
  assert.equal(deriveJobRegisterOperationalStatus({}), "quoting");
  assert.equal(deriveJobRegisterOperationalStatus({ assigneeMemberId: "member-1" }), "assigned");
  assert.equal(deriveJobRegisterOperationalStatus({ scheduleDate: "2026-08-14T01:00:00Z" }), "assigned");
  assert.equal(deriveJobRegisterOperationalStatus({ workStage: "completed" }), "complete");
  assert.equal(deriveJobRegisterOperationalStatus({ workStage: "cancelled" }), "cancelled");
  assert.equal(deriveJobRegisterOperationalStatus({ pipelineStage: "lost", audited: true }), "cancelled");
  assert.equal(deriveJobRegisterOperationalStatus({ pipelineStage: "paid" }), "complete");
  assert.equal(deriveJobRegisterOperationalStatus({ audited: true, workStage: "completed" }), "audited");
  assert.equal(deriveJobRegisterOperationalStatus({ certifiedQuantity: 4, audited: true }), "certified");
});

test("register projection keeps customer fields separate and leaves absent assignment and certificates explicit", () => {
  const record = projectJobRegisterRecord({
    jobId: "TLJ-101",
    firstName: "Taylor",
    lastName: "Example",
    contactNumber: "0400 000 000",
    email: "taylor@example.invalid",
    addressLine1: "1 Example Street",
    addressLine2: "Unit 2",
    postcode: "3000",
    suburb: "Melbourne",
    state: "vic",
    service: "Energy assessment",
    quoteStatus: "draft",
    canViewCustomer: true,
  });
  assert.deepEqual(record, {
    jobId: "TLJ-101",
    firstName: "Taylor",
    lastName: "Example",
    contactNumber: "0400 000 000",
    email: "taylor@example.invalid",
    streetAddress: "1 Example Street, Unit 2",
    postcode: "3000",
    suburb: "Melbourne",
    state: "VIC",
    assignedWorker: "Unassigned",
    scheduleDate: "",
    operationalStatus: "quoting",
    quoteTotalExGstCents: null,
    certificates: { state: "pending", stc: 0, veec: 0, esc: 0, other: 0 },
    service: "Energy assessment",
    quoteStatus: "draft",
    updatedAt: "",
  });
});

test("quote total matches document defaults and immutable accepted selections", () => {
  const route = read("../src/app/api/trade-crm/route.ts");
  const expression = route.match(/const JOB_REGISTER_QUOTE_TOTAL_SQL = `([\s\S]*?)`;/)?.[1];
  assert.ok(expression);
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE trade_work_orders (id text PRIMARY KEY, firebase_uid text NOT NULL);
    CREATE TABLE trade_crm_quotes (id text PRIMARY KEY, work_order_id text NOT NULL, firebase_uid text NOT NULL, current_version_number integer NOT NULL);
    CREATE TABLE trade_crm_quote_versions (id text PRIMARY KEY, quote_id text NOT NULL, firebase_uid text NOT NULL, version_number integer NOT NULL, subtotal_cents integer NOT NULL);
    CREATE TABLE trade_crm_quote_choices (
      id text PRIMARY KEY,
      quote_version_id text NOT NULL,
      firebase_uid text NOT NULL,
      position integer NOT NULL,
      choice_kind text NOT NULL,
      group_key text NOT NULL,
      recommended integer NOT NULL,
      subtotal_cents integer NOT NULL
    );
    CREATE TABLE trade_crm_quote_acceptances (
      id text PRIMARY KEY,
      quote_id text NOT NULL,
      quote_version_id text NOT NULL,
      work_order_id text NOT NULL,
      firebase_uid text NOT NULL,
      decision text NOT NULL,
      selected_subtotal_cents integer NOT NULL
    );
    INSERT INTO trade_work_orders VALUES
      ('job-draft', 'owner-1'),
      ('job-accepted', 'owner-1'),
      ('job-without-quote', 'owner-1');
    INSERT INTO trade_crm_quotes VALUES
      ('quote-draft', 'job-draft', 'owner-1', 2),
      ('quote-accepted', 'job-accepted', 'owner-1', 1);
    INSERT INTO trade_crm_quote_versions VALUES
      ('draft-version-1', 'quote-draft', 'owner-1', 1, 999999),
      ('draft-version-2', 'quote-draft', 'owner-1', 2, 0),
      ('wrong-tenant-version', 'quote-draft', 'other-owner', 2, 888888),
      ('accepted-version', 'quote-accepted', 'owner-1', 1, 10000);
    INSERT INTO trade_crm_quote_choices VALUES
      ('standard-package', 'draft-version-2', 'owner-1', 0, 'package', 'system', 0, 20000),
      ('recommended-package', 'draft-version-2', 'owner-1', 1, 'package', 'system', 1, 30000),
      ('other-package', 'draft-version-2', 'owner-1', 2, 'package', 'system', 0, 40000),
      ('standard-control', 'draft-version-2', 'owner-1', 3, 'choose_one', 'control', 0, 5000),
      ('recommended-control', 'draft-version-2', 'owner-1', 4, 'choose_one', 'control', 1, 8000),
      ('optional-addon', 'draft-version-2', 'owner-1', 5, 'addon', 'monitor', 1, 4000),
      ('standard-rebate', 'draft-version-2', 'owner-1', 6, 'choose_one', 'rebate', 0, -3000),
      ('recommended-rebate', 'draft-version-2', 'owner-1', 7, 'choose_one', 'rebate', 1, -5000),
      ('wrong-tenant-choice', 'draft-version-2', 'other-owner', 8, 'choose_one', 'other', 1, 777777),
      ('accepted-standard', 'accepted-version', 'owner-1', 0, 'package', 'system', 1, 20000),
      ('accepted-premium', 'accepted-version', 'owner-1', 1, 'package', 'system', 0, 40000),
      ('accepted-addon', 'accepted-version', 'owner-1', 2, 'addon', 'monitor', 0, 5000);
    INSERT INTO trade_crm_quote_acceptances VALUES
      ('accepted-selection', 'quote-accepted', 'accepted-version', 'job-accepted', 'owner-1', 'accepted', 55000),
      ('wrong-tenant-acceptance', 'quote-draft', 'draft-version-2', 'job-draft', 'other-owner', 'accepted', 666666);
  `);
  const expectedDraft = tradeQuoteDocumentDisplayTotals({
    subtotalCents: 0,
    choices: [
      { id: "standard-package", kind: "package", groupKey: "system", subtotalCents: 20000 },
      { id: "recommended-package", kind: "package", groupKey: "system", recommended: true, subtotalCents: 30000 },
      { id: "other-package", kind: "package", groupKey: "system", subtotalCents: 40000 },
      { id: "standard-control", kind: "choose_one", groupKey: "control", subtotalCents: 5000 },
      { id: "recommended-control", kind: "choose_one", groupKey: "control", recommended: true, subtotalCents: 8000 },
      { id: "optional-addon", kind: "addon", groupKey: "monitor", recommended: true, subtotalCents: 4000 },
      { id: "standard-rebate", kind: "choose_one", groupKey: "rebate", subtotalCents: -3000 },
      { id: "recommended-rebate", kind: "choose_one", groupKey: "rebate", recommended: true, subtotalCents: -5000 },
    ],
  });
  const acceptedSelection = calculateQuoteSelection({
    subtotalCents: 10000,
    taxCents: 1000,
    totalCents: 11000,
  }, [
    { id: "accepted-standard", kind: "package", groupKey: "system", name: "Standard", subtotalCents: 20000, taxCents: 2000, totalCents: 22000 },
    { id: "accepted-premium", kind: "package", groupKey: "system", name: "Premium", subtotalCents: 40000, taxCents: 4000, totalCents: 44000 },
    { id: "accepted-addon", kind: "addon", groupKey: "monitor", name: "Monitor", subtotalCents: 5000, taxCents: 500, totalCents: 5500 },
  ], ["accepted-premium", "accepted-addon"]);
  const totals = db.prepare(`SELECT w.id, ${expression} quote_total
    FROM trade_work_orders w
    WHERE w.firebase_uid = ?
    ORDER BY COALESCE(${expression}, 999999999), w.id`).all("owner-1");
  assert.deepEqual(totals.map((row) => ({ ...row })), [
    { id: "job-draft", quote_total: expectedDraft.subtotalCents },
    { id: "job-accepted", quote_total: acceptedSelection.subtotalCents },
    { id: "job-without-quote", quote_total: null },
  ]);
  const filtered = db.prepare(`SELECT w.id, ${expression} quote_total
    FROM trade_work_orders w
    WHERE w.firebase_uid = ? AND ${expression} >= ?
    ORDER BY ${expression} DESC`).all("owner-1", 40000);
  assert.deepEqual(filtered.map((row) => ({ ...row })), [
    { id: "job-accepted", quote_total: 55000 },
  ]);
  assert.equal(expectedDraft.subtotalCents, 38000);
  assert.match(route, /quoteTotalMin/);
  assert.match(route, /quoteTotalMax/);
  assert.match(route, /"quote-total-asc"/);
  assert.match(route, /"quote-total-desc"/);
});

test("register projection suppresses customer context without scoped customer access", () => {
  const record = projectJobRegisterRecord({
    jobId: "TLJ-PRIVATE",
    firstName: "Private",
    lastName: "Person",
    contactNumber: "0400 000 000",
    email: "private@example.invalid",
    addressLine1: "Secret Street",
    postcode: "3000",
    suburb: "Melbourne",
    state: "VIC",
    canViewCustomer: false,
  });
  for (const key of ["firstName", "lastName", "contactNumber", "email", "streetAddress", "postcode", "suburb", "state"]) {
    assert.equal(record[key], "");
  }
});

test("protected opportunities cannot be found or ordered through raw customer context", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE trade_work_orders (id text PRIMARY KEY, source_type text NOT NULL);
    CREATE TABLE trade_crm_job_details (work_order_id text PRIMARY KEY, customer_source text NOT NULL);
    CREATE TABLE trade_crm_customers (work_order_id text PRIMARY KEY, first_name text NOT NULL, last_name text NOT NULL, phone text NOT NULL, email text NOT NULL);
    CREATE TABLE trade_crm_service_sites (work_order_id text PRIMARY KEY, address_line_1 text NOT NULL);
    INSERT INTO trade_work_orders VALUES
      ('private-job', 'opportunity'),
      ('released-job', 'public_lead');
    INSERT INTO trade_crm_job_details VALUES
      ('private-job', 'platform_private'),
      ('released-job', 'public_lead_released');
    INSERT INTO trade_crm_customers VALUES
      ('private-job', 'PrivateName', 'PrivateLast', '0400000000', 'private@example.invalid'),
      ('released-job', 'ReleasedName', 'ReleasedLast', '0411000000', 'released@example.invalid');
    INSERT INTO trade_crm_service_sites VALUES
      ('private-job', '99 Secret Street'),
      ('released-job', '1 Released Street');
  `);
  const projection = protectedJobCustomerText("c.first_name");
  const rows = db.prepare(`SELECT w.id, ${projection} first_name,
      ${protectedJobCustomerText("c.last_name")} last_name,
      ${protectedJobCustomerText("c.phone")} phone,
      ${protectedJobCustomerText("c.email")} email,
      ${protectedJobCustomerText("ss.address_line_1")} street
    FROM trade_work_orders w
    JOIN trade_crm_job_details d ON d.work_order_id = w.id
    JOIN trade_crm_customers c ON c.work_order_id = w.id
    JOIN trade_crm_service_sites ss ON ss.work_order_id = w.id
    ORDER BY ${projection} COLLATE NOCASE`).all();
  assert.deepEqual(rows.map((row) => ({ ...row })), [
    { id: "private-job", first_name: "", last_name: "", phone: "", email: "", street: "" },
    { id: "released-job", first_name: "ReleasedName", last_name: "ReleasedLast", phone: "0411000000", email: "released@example.invalid", street: "1 Released Street" },
  ]);
  assert.equal(db.prepare(`SELECT COUNT(*) total FROM trade_work_orders w
    JOIN trade_crm_job_details d ON d.work_order_id = w.id
    JOIN trade_crm_customers c ON c.work_order_id = w.id
    WHERE ${JOB_REGISTER_CUSTOMER_CONTEXT_SQL} AND LOWER(c.first_name) LIKE ?`).get("%privatename%").total, 0);
  assert.equal(db.prepare(`SELECT COUNT(*) total FROM trade_work_orders w
    JOIN trade_crm_job_details d ON d.work_order_id = w.id
    JOIN trade_crm_customers c ON c.work_order_id = w.id
    WHERE ${JOB_REGISTER_CUSTOMER_CONTEXT_SQL} AND LOWER(c.first_name) LIKE ?`).get("%releasedname%").total, 1);
  const cursorValues = rows.map((row) => [row.first_name, row.last_name, row.phone, row.email, row.street, row.id]);
  const encodedCursor = encodeKeysetCursor("jobs:first-name-asc", cursorValues[0]);
  const decodedCursor = decodeKeysetCursor(encodedCursor, "jobs:first-name-asc", 6);
  assert.deepEqual(decodedCursor, ["", "", "", "", "", "private-job"]);
  for (const privateValue of ["PrivateName", "PrivateLast", "0400000000", "private@example.invalid", "99 Secret Street"]) {
    assert.equal(JSON.stringify(decodedCursor).includes(privateValue), false);
  }
  const firstCursor = [decodedCursor[0], decodedCursor[5]];
  const secondPage = db.prepare(`SELECT w.id, ${projection} first_name
    FROM trade_work_orders w
    JOIN trade_crm_job_details d ON d.work_order_id = w.id
    JOIN trade_crm_customers c ON c.work_order_id = w.id
    WHERE ((${projection} COLLATE NOCASE) > (? COLLATE NOCASE)
      OR ((${projection} COLLATE NOCASE) = (? COLLATE NOCASE) AND w.id > ?))
    ORDER BY ${projection} COLLATE NOCASE, w.id LIMIT 1`).get(firstCursor[0], firstCursor[0], firstCursor[1]);
  assert.deepEqual({ ...secondPage }, { id: "released-job", first_name: "ReleasedName" });
  const route = read("../src/app/api/trade-crm/route.ts");
  assert.match(route, /protectedJobCustomerText\("c\.first_name"\)\} first_name/);
  assert.match(route, /protectedJobCustomerText\("c\.phone"\)\} customer_phone/);
  assert.match(route, /protectedJobCustomerText\("ss\.address_line_1"\)\} site_address_line_1/);
  assert.match(route, /CASE WHEN w\.source_type = 'opportunity' THEN '' ELSE COALESCE\(w\.site_area, ''\) END/);
});

test("job register route and UI keep tenant scope, filters, sorting and accessible row actions authoritative", () => {
  const route = read("../src/app/api/trade-crm/route.ts");
  const ui = read("../src/components/InstallerCrmWorkspace.tsx");
  assert.match(route, /w\.firebase_uid = \?/);
  assert.match(route, /identity\.access\.jobScope === "own"/);
  assert.match(route, /AND \(\? = 'team' OR w\.assignee_member_id = \?\)/);
  assert.match(route, /projectJobRegisterRecord/);
  for (const filter of ["firstName", "lastName", "state", "operationalStatus"]) {
    assert.match(route, new RegExp(`searchParams\\.get\\(\"${filter}\"\\)`));
  }
  for (const sort of ["first-name-asc", "last-name-asc", "assignee-asc", "status-asc", "suburb-asc", "postcode-asc"]) {
    assert.match(route, new RegExp(`\"${sort}\"`));
  }
  assert.match(ui, /onContextMenu=/);
  assert.match(ui, /event\.key === "F10" && event\.shiftKey/);
  assert.match(ui, /aria-label=\{`Actions for/);
  assert.match(ui, /View details/);
  assert.match(ui, /Edit details/);
  assert.match(ui, /Edit customer/);
  assert.match(ui, /staffPermissions\.canViewCustomers && staffPermissions\.canManageCustomers/);
  assert.match(ui, /job\.customerSource !== "platform_private" && job\.crmCustomerId/);
  assert.match(ui, /openJobCustomerEditor\(job\)/);
  assert.match(ui, /Schedule job/);
  assert.match(ui, /openFocusedJob\(job\.id, "schedule"\)/);
  assert.doesNotMatch(ui, />Assign job<\/button>/);
  assert.doesNotMatch(ui, /openFocusedJob\(job\.id, "assignment"\)/);
  assert.match(ui, /fetch\("\/api\/trade-team",/);
  assert.match(ui, /action: "assign_job", workOrderId: job\.id, memberId: jobAssigneeId/);
  assert.doesNotMatch(ui, /activeTab === "assignment"/);
});

test("job workspace exposes authorised customer context, preserves the private boundary and uses the real customer editor", () => {
  const route = read("../src/app/api/trade-crm/route.ts");
  const ui = read("../src/components/InstallerCrmWorkspace.tsx");
  assert.match(route, /const protectedCustomer = String\(row\.customer_source \|\| ""\) === "platform_private"/);
  assert.match(route, /const customerId = protectedCustomer \? "" : String\(row\.crm_customer_id \|\| ""\)/);
  assert.match(route, /if \(resource === "customer"\) await assertCustomerDetailAccess\(identity, id\)/);
  assert.match(route, /customerMutationActions\.has\(action\) && !identity\.access\.canManageCustomers/);
  assert.match(route, /if \(action === "update_customer"\)/);
  assert.match(route, /WHERE id = \? AND firebase_uid = \? AND record_status = 'active'/);
  assert.match(ui, /setSelectedCustomerId\(job\.crmCustomerId\)/);
  assert.match(ui, /<CustomerDetail[\s\S]*onSave=\{crmRequest\}/);
  assert.match(ui, /action: "update_customer", customerId: customer\.id/);
  for (const label of ["Job information", "Customer information", "First name", "Last name", "Contact number", "Street address", "Postcode"]) {
    assert.match(ui, new RegExp(label));
  }
  assert.match(ui, /isProtected \? <div className="crm-customer-boundary protected"/);
  assert.match(ui, /This customer-authorised lead contains only the contact and property details disclosed to your business/);
});

test("the combined Schedule tab loads every capability-filtered assignee and keeps assignment beside the focused calendar", () => {
  const [teamRoute, route, ui, styles] = [
    read("../src/app/api/trade-team/route.ts"),
    read("../src/app/api/trade-crm/route.ts"),
    read("../src/components/InstallerCrmWorkspace.tsx"),
    read("../src/components/InstallerCrmJobRegister.module.css"),
  ];
  assert.match(teamRoute, /assigneeConditions = \["owner_uid = \?", "status = 'active'"\]/);
  assert.match(teamRoute, /json_each\(trade_team_members\.capabilities\)/);
  assert.match(teamRoute, /assigneePageSize = Math\.min\(50/);
  assert.match(ui, /assigneePageSize: "50", assigneeCapability: job\.serviceCategory/);
  assert.match(ui, /for \(let page = 2; page <= \(roster\?\.totalPages \|\| 1\); page \+= 1\)/);
  assert.doesNotMatch(ui, /type JobTab = [^;]*"assignment"/);
  assert.match(ui, /const canOpenJobSchedule = !isProtected && \(canAssignJobs \|\| canViewJobSchedule\)/);
  assert.match(ui, /const canStartJobScheduling = jobReadyForScheduling && \(canAssignJobs \|\| canAddJobAppointment\)/);
  assert.match(route, /CASE WHEN \$\{tradeJobScheduleEligibilitySql\("w", "d"\)\} THEN 1 ELSE 0 END schedule_ready/);
  assert.match(ui, /scheduleReady: boolean/);
  assert.match(ui, /if \(canOpenJobSchedule\) mainTabs\.push\(\["schedule",/);
  const scheduleSection = ui.match(/\{activeTab === "schedule"[\s\S]*?(?=\n\s*\{activeTab === ")/)?.[0] || "";
  const assignmentForm = scheduleSection.match(/<form className=\{registerStyles\.assignmentForm\}[\s\S]*?<\/form>/)?.[0] || "";
  assert.match(assignmentForm, /<select value=\{jobAssigneeId\}/);
  assert.match(assignmentForm, /Save assignment/);
  assert.doesNotMatch(assignmentForm, /Search team|Find an active teammate|type="search"|Load more/);
  assert.match(scheduleSection, /<TradeScheduleWorkspace/);
  assert.match(scheduleSection, /variant="job"/);
  assert.ok(scheduleSection.indexOf("<TradeScheduleWorkspace") < scheduleSection.indexOf("registerStyles.assignmentForm"));
  assert.match(styles, /\.assignmentForm[\s\S]*grid-template-columns: minmax\(240px, 420px\) auto/);
});
