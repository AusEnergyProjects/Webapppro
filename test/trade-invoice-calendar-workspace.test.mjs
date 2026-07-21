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
const calendarServer = read("src/lib/trade-calendar-sync-server.ts");
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

test("jobs expose focused single-click navigation while schedule appointments retain explicit open actions", () => {
  assert.match(crm, /className="crm-row-open crm-record-data-row"[^>]*onClick=\{\(\) => openFocusedJob\(job\.id\)\}/);
  assert.doesNotMatch(crm, /onDoubleClick=\{\(\) => openFocusedJob\(job\.id\)\}/);
  assert.match(crm, /crm-job-focus/);
  assert.match(crm, /Back to jobs/);
  assert.match(crm, /initialTab=\{focusedJobTab\}/);
  assert.match(schedule, /onDoubleClick=\{\(event\) => \{ event\.stopPropagation\(\); closeAppointment\(\); onOpenJob\(item\.workOrderId\); \}\}/);
  assert.match(schedule, /event\.key === "Enter" \|\| event\.key === " "/);
  assert.match(schedule, /role="dialog" aria-modal="true" aria-labelledby="schedule-appointment-title"/);
  assert.match(schedule, />Open full job</);
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
    assert.match(`${calendarRoute}\n${calendarServer}`, new RegExp(provider));
  }
  assert.match(migration, /UNIQUE INDEX `trade_crm_calendar_events_owner_appointment_provider_idx`/);
  assert.match(calendarServer, /appointment_revision/);
  assert.match(calendarServer, /TLink protected job/);
  assert.match(calendarServer, /Customer identity and exact location are not shared/);
  assert.match(calendarServer, /protectedJob \? ""/);
  assert.match(schedule, /TLink is saved\. A connected calendar item needs another sync/);
  assert.match(schedule, /TLink stays authoritative/);
  assert.match(schedule, /Available to connect/);
  assert.match(schedule, /TLink setup in progress/);
  assert.match(schedule, /firstSyncResponse/);
  assert.doesNotMatch(schedule, /Administrator setup needed/);
  assert.doesNotMatch(`${calendarRoute}\n${calendarServer}`, /callbackUrl/);
});

test("new invoice and calendar sources avoid prohibited dash characters", () => {
  assert.doesNotMatch(`${invoiceRoute}\n${invoiceUi}\n${calendarRoute}\n${calendarServer}\n${schedule}`, /[\u2013\u2014]/);
});
