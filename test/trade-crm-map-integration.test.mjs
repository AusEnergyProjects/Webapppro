import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { customerMapRecord, jobMapRecord } from "../src/lib/trade-crm-map-records.ts";
import { projectJobRegisterRecord } from "../src/lib/trade-crm-job-register.ts";

const ui = fs.readFileSync(new URL("../src/components/InstallerCrmWorkspace.tsx", import.meta.url), "utf8");

const customer = {
  id: "customer-1", customerNumber: "CUS-101", displayName: "Taylor Example",
  addressLine1: " 1 Billing Street ", addressLine2: " Unit 3 ", suburb: " Melbourne ", addressState: "VIC", postcode: "3000", jobCount: 2,
};
const job = {
  id: "job-1", workNumber: "TLJ-101", title: "Insulation inspection", customerDisplayName: "Taylor Example",
  sourceType: "manual", customerSource: "trade_owned", serviceSiteId: "site-2",
  siteArea: "Melbourne VIC 3000", customer,
  jobRegister: projectJobRegisterRecord({
    jobId: "TLJ-101", addressLine1: "20 Service Street", addressLine2: "Unit 4", suburb: "Ballarat", state: "VIC", postcode: "3350",
    service: "Insulation", canViewCustomer: true,
  }),
};

test("customer map records use the indexed street address and expose only the map card fields", () => {
  assert.deepEqual(customerMapRecord({ ...customer, email: "private@example.test", privateNotes: "Private notes" }), {
    id: "customer-1", kind: "customer", title: "Taylor Example", reference: "CUS-101",
    address: "1 Billing Street, Unit 3, Melbourne, VIC, 3000, Australia", detail: "2 linked jobs",
  });
  assert.equal(customerMapRecord({ ...customer, jobCount: 1 }).detail, "1 linked job");
});

test("a job map pin uses its service-site projection instead of the customer billing address or broad site area", () => {
  const record = jobMapRecord(job);
  assert.equal(record.address, "20 Service Street, Unit 4, Ballarat, VIC, 3350, Australia");
  assert.equal(record.kind, "job");
  assert.equal(record.reference, "TLJ-101");
  assert.equal(record.detail, "Insulation | unscheduled");
  assert.equal(record.jobStatus, job.jobRegister.operationalStatus);
  assert.equal(jobMapRecord({ ...job, jobRegister: { ...job.jobRegister, operationalStatus: "partial" } }).jobStatus, "partial");
  assert.doesNotMatch(record.address, /Billing|Melbourne/);
});

test("missing street or locality stays unpinned instead of geocoding a postcode, area, or unit", () => {
  assert.equal(customerMapRecord({ ...customer, addressLine1: " " }).address, "");
  assert.equal(customerMapRecord({ ...customer, suburb: "", postcode: "" }).address, "");
  assert.equal(jobMapRecord({ ...job, serviceSiteId: "" }).address, "");
  assert.equal(jobMapRecord({ ...job, jobRegister: { ...job.jobRegister, streetAddress: " " } }).address, "");
  assert.equal(jobMapRecord({ ...job, jobRegister: { ...job.jobRegister, suburb: "", postcode: "" } }).address, "");
});

test("protected jobs cannot leak a location or customer name even with a populated register projection", () => {
  for (const protectedJob of [{ ...job, customerSource: "platform_private" }, { ...job, sourceType: "opportunity" }]) {
    assert.deepEqual(jobMapRecord(protectedJob), {
      id: "job-1", kind: "job", jobStatus: "unscheduled", title: "Protected job", reference: "TLJ-101", address: "", detail: "Customer location protected",
    });
  }
  const redacted = projectJobRegisterRecord({ jobId: "TLJ-101", addressLine1: "20 Service Street", suburb: "Ballarat", postcode: "3350", canViewCustomer: false });
  assert.equal(jobMapRecord({ ...job, jobRegister: redacted }).address, "");
  assert.notEqual(jobMapRecord({ ...job, sourceType: "public_lead", customerSource: "public_lead_released" }).address, "");
});

test("both map layouts preserve indexed filters, page controls, and focused-record navigation", () => {
  assert.match(ui, /dynamic\(\(\) => import\("\.\/TradeRecordMap"\)\.then\(\(module\) => module\.TradeRecordMap\)\)/);
  assert.match(ui, /const usesJobIndex = jobLayout !== "board"/);
  assert.match(ui, /!usesJobIndex \|\| focusedJobId/);
  assert.match(ui, /jobLayout !== "board" && <WorkspaceListControls page=\{jobPagination\.page\}/);
  assert.match(ui, /<WorkspaceListControls page=\{customerPagination\.page\}/);
  assert.match(ui, /records=\{jobMapRecords\} loading=\{jobMapLoading\} total=\{jobPagination.total\} onOpenRecord=\{\(record\) => openFocusedJob\(record.id\)\}/);
  assert.match(ui, /records=\{customerMapRecords\} loading=\{customerMapLoading\} total=\{customerPagination.total\} onOpenRecord=\{\(record\) => setSelectedCustomerId\(record.id\)\}/);
  assert.match(ui, /setJobLayout\(\(current\) => current === "map" \? "map" : "list"\)/);
  for (const kind of ["jobs", "customers"]) assert.match(ui, new RegExp(`Map shows this page of filtered ${kind}`));
  for (const layout of ["jobLayout", "customerLayout"]) assert.match(ui, new RegExp(`aria-pressed=\\{${layout} === "map"\\}`));
  assert.equal((ui.match(/<TradeRecordMap key=\{user.uid\}/g) || []).length, 2);
});

test("stale pages are withheld before the debounced index fetch and failed requests clear old records", () => {
  assert.match(ui, /const jobMapLoading = indexLoading \|\| jobIndexLoadedKey !== jobIndexKey/);
  assert.match(ui, /const customerMapLoading = indexLoading \|\| !customerPreferencesReady \|\| customerIndexLoadedKey !== customerIndexKey/);
  assert.match(ui, /jobMapLoading \? \[\] : indexedJobs.map\(jobMapRecord\)/);
  assert.match(ui, /customerMapLoading \? \[\] : indexedCustomers.map\(customerMapRecord\)/);
  assert.match(ui, /setIndexedJobs\(\[\]\); setJobIndexLoadedKey\(jobIndexKey\)/);
  assert.match(ui, /setIndexedCustomers\(\[\]\); setCustomerIndexLoadedKey\(customerIndexKey\)/);
  assert.match(ui, /const run = \(\) => \{\s+if \(active\) setIndexLoading\(true\)/);
});

test("customer map entry clears selection and never offers bulk actions for hidden rows", () => {
  assert.match(ui, /setSelectedCustomerIds\(\[\]\); setCustomerActionId\(""\); setCustomerLayout\("map"\)/);
  assert.match(ui, /customerLayout === "list" && selectedCustomerIds.length > 0 && <div className="crm-bulk-actions"/);
});
