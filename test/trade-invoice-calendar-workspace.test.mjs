import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  projectTradeInvoiceRegisterFinance,
  TRADE_INVOICE_REGISTER_HANDOFF_JOIN_SQL,
} from "../src/lib/trade-invoice-register.ts";

const root = path.resolve(import.meta.dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const dashboard = read("src/components/DirectTradeDashboard.tsx");
const crm = read("src/components/InstallerCrmWorkspace.tsx");
const schedule = read("src/components/TradeScheduleWorkspace.tsx");
const scheduleRoute = read("src/app/api/trade-schedule/route.ts");
const invoiceRoute = read("src/app/api/trade-invoices/route.ts");
const invoiceRegister = read("src/lib/trade-invoice-register.ts");
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
  assert.match(invoiceRoute, /TRADE_INVOICE_REGISTER_HANDOFF_JOIN_SQL/);
  assert.match(invoiceRegister, /trade_crm_commercial_handovers/);
  assert.match(invoiceRoute, /trade_crm_accepted_invoices ai/);
  assert.match(invoiceRoute, /ai\.acceptance_id = h\.acceptance_id/);
  assert.match(invoiceRoute, /ai\.quote_version_id = h\.quote_version_id/);
  assert.match(invoiceRegister, /row\.accepted_invoice_number/);
  assert.match(invoiceRegister, /row\.accepted_invoice_status === "issued"/);
  assert.match(invoiceRoute, /trade_crm_accounting_documents/);
  assert.match(invoiceRoute, /a\.id accounting_document_id/);
  assert.match(invoiceRoute, /projectTradeInvoiceRegisterFinance\(row\)/);
  assert.match(invoiceUi, /Get paid without retyping the job/);
  assert.match(invoiceUi, /Due \$\{new Date/);
  assert.match(invoiceUi, /Acceptance recorded\. Confirm the existing invoice before payment\./);
  assert.match(invoiceUi, /onDoubleClick=\{\(\) => onOpenJob\(item\.id\)\}/);
  assert.match(dashboard, /jobTab: "invoice"/);
});

test("invoice register keeps an existing accounting invoice authoritative over a reconciliation record", () => {
  const projected = projectTradeInvoiceRegisterFinance({
    accounting_document_id: "accounting-1",
    provider: "xero",
    external_number: "INV-XERO-204",
    external_url: "https://go.xero.example/invoice/204",
    accounting_amount_cents: 87_600,
    accounting_paid_amount_cents: 12_000,
    accounting_due_at: "2026-08-30",
    accounting_status: "part_paid",
    accounting_created_at: "2026-08-13T01:00:00.000Z",
    accepted_invoice_number: "INV-TLINK-999",
    accepted_invoice_total_cents: 391_600,
    accepted_invoice_due_at: "2026-08-20",
    accepted_invoice_status: "attention_required",
    accepted_invoice_blocker_code: "ACCEPTED_INVOICE_CONFLICT",
  });

  assert.deepEqual(projected, {
    totalCents: 87_600,
    paidCents: 12_000,
    outstandingCents: 75_600,
    status: "attention",
    provider: "xero",
    externalNumber: "INV-XERO-204",
    externalUrl: "https://go.xero.example/invoice/204",
    dueAt: "2026-08-30",
    lastError: "ACCEPTED_INVOICE_CONFLICT",
    acceptedAt: "2026-08-13T01:00:00.000Z",
  });
});

test("invoice register falls back to an issued accepted invoice only when no quick or accounting invoice exists", () => {
  const projected = projectTradeInvoiceRegisterFinance({
    accepted_invoice_number: "INV-TLINK-205",
    accepted_invoice_total_cents: 5_940,
    accepted_invoice_due_at: "2026-08-20",
    accepted_invoice_status: "issued",
    accepted_invoice_created_at: "2026-08-13T02:00:00.000Z",
  });

  assert.equal(projected.provider, "tlink");
  assert.equal(projected.externalNumber, "INV-TLINK-205");
  assert.equal(projected.totalCents, 5_940);
  assert.equal(projected.status, "issued");
});

test("invoice register preserves manual finance when acceptance requires reconciliation", () => {
  const projected = projectTradeInvoiceRegisterFinance({
    accepted_invoice_number: "INV-TLINK-BLOCKED",
    accepted_invoice_total_cents: 391_600,
    accepted_invoice_status: "attention_required",
    accepted_invoice_blocker_code: "ACCEPTED_INVOICE_CONFLICT",
    invoiced_value_cents: 22_222,
    paid_value_cents: 3_333,
    payment_due_at: "2026-10-15",
  });

  assert.equal(projected.totalCents, 22_222);
  assert.equal(projected.paidCents, 3_333);
  assert.equal(projected.outstandingCents, 18_889);
  assert.equal(projected.dueAt, "2026-10-15");
  assert.equal(projected.status, "attention");
  assert.equal(projected.externalNumber, "");
  assert.equal(projected.lastError, "ACCEPTED_INVOICE_CONFLICT");
});

test("invoice register selects one exact handoff when historical acceptance timestamps tie", () => {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE trade_work_orders (
      id TEXT PRIMARY KEY,
      firebase_uid TEXT NOT NULL
    );
    CREATE TABLE trade_crm_job_details (
      work_order_id TEXT PRIMARY KEY,
      firebase_uid TEXT NOT NULL,
      crm_customer_id TEXT NOT NULL
    );
    CREATE TABLE trade_crm_commercial_handovers (
      id TEXT PRIMARY KEY,
      acceptance_id TEXT NOT NULL,
      quote_version_id TEXT NOT NULL,
      work_order_id TEXT NOT NULL,
      firebase_uid TEXT NOT NULL,
      crm_customer_id TEXT NOT NULL,
      commercial_reference TEXT NOT NULL,
      total_cents INTEGER NOT NULL,
      accepted_at TEXT NOT NULL
    );
    CREATE TABLE trade_crm_accepted_invoices (
      id TEXT PRIMARY KEY,
      acceptance_id TEXT NOT NULL,
      commercial_handoff_id TEXT NOT NULL,
      quote_version_id TEXT NOT NULL,
      work_order_id TEXT NOT NULL,
      firebase_uid TEXT NOT NULL,
      crm_customer_id TEXT NOT NULL,
      invoice_number TEXT NOT NULL,
      total_cents INTEGER NOT NULL,
      due_at TEXT NOT NULL,
      status TEXT NOT NULL,
      issue_blocker_code TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
  database.prepare("INSERT INTO trade_work_orders VALUES (?, ?)").run("job-1", "owner-1");
  database.prepare("INSERT INTO trade_crm_job_details VALUES (?, ?, ?)")
    .run("job-1", "owner-1", "customer-1");
  const acceptedAt = "2026-08-13T01:02:03.456Z";
  database.prepare("INSERT INTO trade_crm_commercial_handovers VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run("handoff-a", "acceptance-a", "version-a", "job-1", "owner-1", "customer-1", "Q-A", 10_000, acceptedAt);
  database.prepare("INSERT INTO trade_crm_commercial_handovers VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run("handoff-b", "acceptance-b", "version-b", "job-1", "owner-1", "customer-1", "Q-B", 20_000, acceptedAt);
  database.prepare("INSERT INTO trade_crm_accepted_invoices VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run("invoice-a", "acceptance-a", "handoff-a", "version-a", "job-1", "owner-1", "customer-1",
      "INV-A", 10_000, "2026-08-20", "issued", "", "2026-08-13T01:02:04.000Z");

  const rows = database.prepare(`SELECT w.id, h.id handoff_id,
      ai.invoice_number accepted_invoice_number,
      ai.total_cents accepted_invoice_total_cents,
      ai.due_at accepted_invoice_due_at,
      ai.status accepted_invoice_status,
      ai.issue_blocker_code accepted_invoice_blocker_code,
      ai.created_at accepted_invoice_created_at
    FROM trade_work_orders w
    LEFT JOIN trade_crm_job_details d
      ON d.work_order_id = w.id AND d.firebase_uid = w.firebase_uid
    ${TRADE_INVOICE_REGISTER_HANDOFF_JOIN_SQL}
    LEFT JOIN trade_crm_accepted_invoices ai
      ON ai.commercial_handoff_id = h.id
      AND ai.acceptance_id = h.acceptance_id
      AND ai.quote_version_id = h.quote_version_id
      AND ai.work_order_id = w.id
      AND ai.firebase_uid = w.firebase_uid
      AND ai.crm_customer_id = d.crm_customer_id
    WHERE w.firebase_uid = ?`).all("owner-1");

  assert.equal(rows.length, 1);
  assert.equal(rows[0].handoff_id, "handoff-a");
  const invoices = rows.map((row) => projectTradeInvoiceRegisterFinance(row));
  assert.equal(invoices.length, 1);
  assert.equal(invoices[0].outstandingCents, 10_000);
  assert.equal(invoices.reduce((sum, invoice) => sum + invoice.outstandingCents, 0), 10_000);
  database.close();
});

test("jobs expose explicit and guarded double-click navigation while schedule appointments retain explicit open actions", () => {
  assert.match(crm, /className="crm-index-open-button" onClick=\{onOpen\}/);
  assert.match(crm, /className=\{`\$\{registerStyles\.row\} crm-row-open crm-record-data-row crm-index-row`\}/);
  assert.match(crm, /onDoubleClick=\{\(event\) => \{ if \(\(event\.target as HTMLElement\)\.closest\("a, button, input, select, textarea"\)\) return; openFocusedJob\(job\.id\); \}\}/);
  assert.match(crm, /crm-job-workspace/);
  assert.match(crm, /Back to all jobs/);
  assert.match(crm, /initialTab=\{focusedJobTab\}/);
  assert.match(schedule, /onDoubleClick=\{\(event\) => \{ event\.stopPropagation\(\); leaveSchedule\(\(\) => onOpenJob\(item\.workOrderId\)\); \}\}/);
  assert.match(schedule, /event\.key === "Enter" \|\| event\.key === " "/);
  assert.match(schedule, /role="dialog" aria-modal="true" aria-labelledby="schedule-appointment-title"/);
  assert.match(schedule, />Open full job</);
  assert.match(schedule, /onOpenQuote && !selectedAppointment\.protectedJob/);
  assert.match(schedule, />Open quote<\/button>/);
  assert.match(crm, /onOpenQuote=\{\(!staffPermissions \|\| staffPermissions\.canViewQuotes\) \? \(id\) => openFocusedJob\(id, "quote"\) : undefined\}/);
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
