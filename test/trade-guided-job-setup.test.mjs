import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (file) => fs.readFileSync(path.join(here, file), "utf8");
const form = read("../src/components/TradeNewJobForm.tsx");
const invoiceStep = read("../src/components/TradeQuickInvoiceStep.tsx");
const workspace = read("../src/components/InstallerCrmWorkspace.tsx");
const crm = read("../src/app/api/trade-crm/route.ts");
const numbers = read("../src/lib/trade-job-number-server.ts");
const workOrders = read("../src/app/api/trade-work-orders/route.ts");
const recurring = read("../src/lib/trade-recurring-jobs-server.ts");
const schema = read("../db/schema.ts");
const migration = read("../drizzle/0074_global_tlink_job_numbers.sql");
const adminJobs = read("../src/app/api/admin/jobs/route.ts");
const address = read("../src/app/api/trade-address-suggestions/route.ts");

test("new jobs use one globally sequenced TLink ID across every creation path", () => {
  assert.match(numbers, /__tlink_global__/);
  assert.match(numbers, /return `TLJ-\$\{String\(value\)\.padStart\(8, "0"\)\}`/);
  assert.match(crm, /nextTlinkJobNumber\(db, now\)/);
  assert.match(workOrders, /prefix === "JOB"[\s\S]*nextTlinkJobNumber\(db, now\)/);
  assert.match(recurring, /nextTlinkJobNumber\(db, now\)/);
  assert.match(schema, /trade_work_orders_tlink_job_number_idx/);
  assert.match(migration, /ROW_NUMBER\(\) OVER \(ORDER BY created_at, id\)/);
  assert.match(migration, /SET work_number =/);
  assert.match(migration, /INSERT INTO trade_crm_counters/);
  assert.match(migration, /CREATE UNIQUE INDEX `trade_work_orders_tlink_job_number_idx`/);
});

test("admin and installer expose and search the same job ID", () => {
  assert.match(form, /TLink job ID/);
  assert.match(workspace, /This same ID is used by your team and TLink support/);
  assert.match(adminJobs, /LOWER\(w\.work_number\) LIKE/);
  assert.match(adminJobs, /LOWER\(w\.id\) LIKE/);
  assert.match(adminJobs, /installer_business/);
});

test("guided setup attaches duplicates and creates appointment plus evidence request together", () => {
  assert.match(form, /find_customer_duplicates/);
  assert.match(form, /Use this customer/);
  assert.match(`${form}\n${invoiceStep}`, /Schedule and request info/);
  assert.doesNotMatch(form, /name="title"|datalist/);
  assert.doesNotMatch(workspace, /placeholder="Appointment title"/);
  assert.match(crm, /INSERT INTO trade_crm_appointments/);
  assert.match(crm, /INSERT INTO trade_crm_photo_requests/);
  assert.match(crm, /sendPhotoRequestDelivery/);
  assert.match(crm, /appointmentTitle = `\$\{displayName\} \$\{SERVICE_LABELS\[serviceCategory\]\}`/);
  assert.match(form, /"Evidence", "Invoice"/);
});

test("address search supports structured Google Australian results and manual fallback", () => {
  assert.match(address, /googleapis\.com/);
  assert.match(address, /components", "country:AU/);
  assert.match(address, /administrative_area_level_1/);
  assert.match(address, /configured: false, suggestions: \[\]/);
  assert.match(form, /enter the address manually/i);
});
