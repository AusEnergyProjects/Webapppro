import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const dashboard = read("src/components/DirectTradeDashboard.tsx");
const crm = read("src/components/InstallerCrmWorkspace.tsx");
const schedule = read("src/components/TradeScheduleWorkspace.tsx");
const scheduleRoute = read("src/app/api/trade-schedule/route.ts");
const invoiceRoute = read("src/app/api/trade-invoices/route.ts");
const invoiceUi = read("src/components/TradeInvoiceWorkspace.tsx");
const calendarRoute = read("src/app/api/trade-calendar-sync/route.ts");
const integrations = read("src/lib/trade-integrations-server.ts");
const migration = read("drizzle/0072_trade_calendar_sync.sql");

test("invoices are a main installer workspace over existing owner-scoped records", () => {
  assert.match(dashboard, />Invoices</);
  assert.match(dashboard, /workspace === "invoices"/);
  assert.match(dashboard, /<TradeInvoiceWorkspace/);
  assert.match(invoiceRoute, /WHERE w\.firebase_uid = \?/);
  assert.match(invoiceRoute, /trade_crm_commercial_handovers/);
  assert.match(invoiceRoute, /trade_crm_accounting_documents/);
  assert.match(invoiceUi, /Get paid without retyping the job/);
  assert.match(invoiceUi, /onDoubleClick=\{\(\) => onOpenJob\(item\.id\)\}/);
  assert.match(dashboard, /jobTab: "invoice"/);
});

test("jobs expose focused double-click navigation with explicit touch and keyboard actions", () => {
  assert.match(crm, /onDoubleClick=\{\(\) => openFocusedJob\(job\.id\)\}/);
  assert.match(crm, />Open job</);
  assert.match(crm, /crm-job-focus/);
  assert.match(crm, /initialTab=\{focusedJobTab\}/);
  assert.match(schedule, /onDoubleClick=\{\(\) => onOpenJob\(item\.workOrderId\)\}/);
  assert.match(schedule, /onKeyDown=\{\(event\) => \{ if \(event\.key === "Enter"\) onOpenJob/);
});

test("appointment editing uses a bounded 15-minute duration instead of a finish field", () => {
  assert.match(schedule, /type="range"/);
  assert.match(schedule, /max=\{APPOINTMENT_MAX_DURATION_MINUTES\}/);
  assert.match(schedule, /step="15"/);
  assert.match(schedule, /durationMinutes: 60/);
  assert.doesNotMatch(schedule, /aria-label=\{`Finish for/);
  assert.doesNotMatch(crm, /aria-label="Finish time"/);
  assert.ok((scheduleRoute.match(/appointmentEndsAt\(startsAt, body\.durationMinutes\)/g) || []).length >= 3);
  assert.match(scheduleRoute, /INVALID_DURATION/);
});

test("calendar mirroring is provider-neutral, revision mapped and privacy safe", () => {
  for (const provider of ["google_calendar", "microsoft_calendar"]) {
    assert.match(integrations, new RegExp(provider));
    assert.match(calendarRoute, new RegExp(provider));
  }
  assert.match(migration, /UNIQUE INDEX `trade_crm_calendar_events_owner_appointment_provider_idx`/);
  assert.match(calendarRoute, /appointment_revision/);
  assert.match(calendarRoute, /TLink protected job/);
  assert.match(calendarRoute, /Customer identity and exact location are not shared/);
  assert.match(calendarRoute, /protectedJob \? ""/);
  assert.match(schedule, /TLink is saved\. Calendar sync needs another try/);
  assert.match(schedule, /TLink stays authoritative/);
});

test("new invoice and calendar sources avoid prohibited dash characters", () => {
  assert.doesNotMatch(`${invoiceRoute}\n${invoiceUi}\n${calendarRoute}\n${schedule}`, /[\u2013\u2014]/);
});
