import { getD1 } from "../../../../db";
import { requireFirebaseIdentity } from "@/lib/firebase-server";
import { adminJson, cleanAdminText, sameOrigin } from "@/lib/admin-server";
import { accountEntitlements } from "@/lib/direct-trade-entitlements-server";
import { nextTradeWorkNumber } from "@/lib/trade-job-number-server";
import { jobSyncChangeStatements, nextJobRevision } from "@/lib/trade-team-sync-server";

export const runtime = "edge";

const MEMBER_ACTIVE_JOB_LIMIT = 500;
const CRM_CUSTOMER_LIMIT = 5000;
const CUSTOMER_TYPES = new Set(["residential", "business"]);
const PIPELINE_STAGES = new Set(["enquiry", "qualifying", "quoting", "approved", "scheduled", "in_progress", "complete", "invoiced", "paid", "lost"]);
const WORK_STAGES = new Set(["backlog", "ready", "scheduled", "in_progress", "blocked", "completed", "cancelled"]);
const PRIORITIES = new Set(["low", "standard", "high", "urgent"]);
const SERVICE_CATEGORIES = new Set(["assessment", "solar", "battery", "heating-cooling", "hot-water", "insulation-draughts", "ev-charging", "other"]);
const APPOINTMENT_TYPES = new Set(["phone_call", "site_visit", "quote_review", "installation", "service", "admin"]);
const APPOINTMENT_STATUSES = new Set(["scheduled", "completed", "cancelled", "no_show"]);
const NOTE_TYPES = new Set(["internal", "issue"]);
const ISSUE_STATUSES = new Set(["not_applicable", "open", "resolved"]);
const QUOTE_STATUSES = new Set(["not_started", "draft", "sent", "accepted", "declined"]);
const INVOICE_STATUSES = new Set(["not_started", "draft", "issued", "part_paid", "paid", "overdue", "void"]);
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type CrmIdentity = { uid: string; businessName: string; teamAccess: boolean };

async function crmIdentity(request: Request): Promise<CrmIdentity> {
  const identity = await requireFirebaseIdentity(request);
  const account = await getD1().prepare(`SELECT partner_type, account_status, billing_status, business_name
    FROM trade_accounts WHERE firebase_uid = ?`).bind(identity.uid).first<Record<string, unknown>>();
  if (!account) throw new Error("PROFILE_REQUIRED");
  if (account.account_status !== "active") throw new Error("ACCOUNT_INACTIVE");
  if (account.partner_type !== "installer") throw new Error("INSTALLER_ONLY");
  const entitlements = await accountEntitlements(identity.uid, "installer", account.billing_status);
  if (!entitlements.features.business_operations) throw new Error("FULL_ACCESS_REQUIRED");
  return {
    uid: identity.uid,
    businessName: String(account.business_name || "Trade business"),
    teamAccess: entitlements.features.team_access,
  };
}

function errorResponse(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  if (code === "AUTH_REQUIRED") return adminJson({ ok: false, error: "Sign in to continue." }, 401);
  if (code === "PROFILE_REQUIRED") return adminJson({ ok: false, error: "Complete the installer profile first." }, 404);
  if (code === "ACCOUNT_INACTIVE") return adminJson({ ok: false, error: "This installer account is not active." }, 403);
  if (code === "INSTALLER_ONLY") return adminJson({ ok: false, error: "Customer CRM is available to installer accounts only." }, 403);
  if (code === "FULL_ACCESS_REQUIRED") return adminJson({ ok: false, error: "Customer CRM, scheduling and financial tracking require paid Business Hub access or an administrator grant." }, 403);
  if (code === "TEAM_ACCESS_REQUIRED") return adminJson({ ok: false, error: "Staff assignment requires the Team access premium feature." }, 403);
  if (code === "CUSTOMER_NOT_FOUND") return adminJson({ ok: false, error: "Customer record not found." }, 404);
  if (code === "JOB_NOT_FOUND") return adminJson({ ok: false, error: "Job record not found." }, 404);
  if (code === "APPOINTMENT_NOT_FOUND") return adminJson({ ok: false, error: "Appointment not found." }, 404);
  if (code === "NOTE_NOT_FOUND") return adminJson({ ok: false, error: "Note or issue not found." }, 404);
  if (code === "INVALID_DATE") return adminJson({ ok: false, error: "Choose a valid date and time." }, 400);
  if (code === "JOB_LIMIT_REACHED") return adminJson({ ok: false, error: "This workspace has reached its 500 active job fair-use limit." }, 409);
  if (code === "CUSTOMER_LIMIT_REACHED") return adminJson({ ok: false, error: "This workspace has reached its customer-record fair-use limit." }, 409);
  if (code === "JOB_NUMBER_UNAVAILABLE") return adminJson({ ok: false, error: "The next job number could not be reserved. Please try again." }, 503);
  return adminJson({ ok: false, error: "The private installer CRM request could not be completed." }, 500);
}

function cleanList(value: unknown, limit = 12) {
  const input = Array.isArray(value) ? value : String(value || "").split(",");
  return [...new Set(input.map((item) => cleanAdminText(item, 40).toLowerCase()).filter(Boolean))].slice(0, limit);
}

function storedList(value: unknown) {
  try {
    const parsed = JSON.parse(String(value || "[]"));
    return Array.isArray(parsed) ? parsed.map((item) => String(item)).slice(0, 12) : [];
  } catch { return []; }
}

function dateValue(value: unknown, dateOnly = false) {
  const clean = cleanAdminText(value, 40);
  if (!clean) return "";
  const pattern = dateOnly ? /^\d{4}-\d{2}-\d{2}$/ : /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{3})?Z?)?$/;
  if (!pattern.test(clean) || Number.isNaN(Date.parse(dateOnly ? `${clean}T00:00:00Z` : clean))) throw new Error("INVALID_DATE");
  return clean;
}

function moneyValue(value: unknown) {
  const amount = Number(value);
  if (!Number.isInteger(amount) || amount < 0 || amount > 100_000_000_00) return 0;
  return amount;
}

function customerDisplayName(row: Record<string, unknown>) {
  return String(row.business_name || `${String(row.first_name || "")} ${String(row.last_name || "")}`.trim() || row.customer_number);
}

async function crmPayload(identity: CrmIdentity) {
  const db = getD1();
  const [customerRows, jobRows, taskRows, appointmentRows, noteRows, handoverRows] = await Promise.all([
    db.prepare(`SELECT * FROM trade_crm_customers WHERE firebase_uid = ? AND record_status = 'active'
      ORDER BY updated_at DESC LIMIT 1000`).bind(identity.uid).all<Record<string, unknown>>(),
    db.prepare(`SELECT w.*, d.id detail_id, d.crm_customer_id, d.customer_source, d.pipeline_stage,
      d.description, d.customer_reference, d.next_action, d.tags job_tags, d.estimated_value_cents,
      d.quoted_value_cents, d.invoiced_value_cents, d.paid_value_cents, d.quote_status,
      d.invoice_status, d.payment_due_at
      FROM trade_work_orders w LEFT JOIN trade_crm_job_details d
        ON d.work_order_id = w.id AND d.firebase_uid = w.firebase_uid
      WHERE w.firebase_uid = ? AND w.partner_type = 'installer' AND w.record_status = 'active'
      ORDER BY CASE w.stage WHEN 'in_progress' THEN 0 WHEN 'scheduled' THEN 1 WHEN 'ready' THEN 2
        WHEN 'blocked' THEN 3 WHEN 'backlog' THEN 4 WHEN 'completed' THEN 5 ELSE 6 END,
        w.scheduled_start = '', w.scheduled_start, w.updated_at DESC LIMIT 500`).bind(identity.uid).all<Record<string, unknown>>(),
    db.prepare(`SELECT t.* FROM trade_work_order_tasks t JOIN trade_work_orders w ON w.id = t.work_order_id
      WHERE t.firebase_uid = ? AND w.firebase_uid = ? AND w.record_status = 'active'
      ORDER BY t.status = 'done', t.due_at = '', t.due_at, t.created_at`).bind(identity.uid, identity.uid).all<Record<string, unknown>>(),
    db.prepare(`SELECT a.* FROM trade_crm_appointments a JOIN trade_work_orders w ON w.id = a.work_order_id
      WHERE a.firebase_uid = ? AND w.firebase_uid = ? AND w.record_status = 'active'
      ORDER BY a.starts_at, a.created_at`).bind(identity.uid, identity.uid).all<Record<string, unknown>>(),
    db.prepare(`SELECT n.* FROM trade_crm_job_notes n JOIN trade_work_orders w ON w.id = n.work_order_id
      WHERE n.firebase_uid = ? AND w.firebase_uid = ? AND w.record_status = 'active'
      ORDER BY n.created_at DESC LIMIT 1000`).bind(identity.uid, identity.uid).all<Record<string, unknown>>(),
    db.prepare(`SELECT p.work_order_id, p.status FROM trade_handover_packs p JOIN trade_work_orders w ON w.id = p.work_order_id
      WHERE p.firebase_uid = ? AND w.firebase_uid = ? AND w.record_status = 'active'`).bind(identity.uid, identity.uid).all<Record<string, unknown>>(),
  ]);
  const customers = customerRows.results.map((row) => ({
    id: row.id,
    customerNumber: row.customer_number,
    customerType: row.customer_type,
    displayName: customerDisplayName(row),
    firstName: row.first_name,
    lastName: row.last_name,
    businessName: row.business_name,
    email: row.email,
    phone: row.phone,
    addressLine1: row.address_line_1,
    addressLine2: row.address_line_2,
    suburb: row.suburb,
    addressState: row.address_state,
    postcode: row.postcode,
    tags: storedList(row.tags),
    privateNotes: row.private_notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
  const jobs = jobRows.results.map((row) => {
    const sourceType = String(row.source_type);
    const customerSource = sourceType === "opportunity" ? "platform_private" : String(row.customer_source || "internal");
    return {
      id: row.id,
      workNumber: row.work_number,
      title: row.title,
      serviceCategory: row.service_category,
      siteArea: row.site_area,
      stage: row.stage,
      priority: row.priority,
      scheduledStart: row.scheduled_start,
      scheduledEnd: row.scheduled_end,
      assigneeLabel: row.assignee_label,
      revision: Number(row.revision || 1),
      sourceType,
      customerSource,
      crmCustomerId: customerSource === "platform_private" ? "" : String(row.crm_customer_id || ""),
      pipelineStage: row.pipeline_stage || (sourceType === "opportunity" ? "qualifying" : "enquiry"),
      description: row.description || "",
      customerReference: customerSource === "platform_private" ? String(row.source_reference || row.work_number) : String(row.customer_reference || ""),
      nextAction: row.next_action || "",
      tags: storedList(row.job_tags),
      estimatedValueCents: Number(row.estimated_value_cents || 0),
      quotedValueCents: Number(row.quoted_value_cents || 0),
      invoicedValueCents: Number(row.invoiced_value_cents || 0),
      paidValueCents: Number(row.paid_value_cents || 0),
      quoteStatus: row.quote_status || "not_started",
      invoiceStatus: row.invoice_status || "not_started",
      paymentDueAt: row.payment_due_at || "",
      handoverStatus: handoverRows.results.find((item) => item.work_order_id === row.id)?.status || "",
      tasks: taskRows.results.filter((item) => item.work_order_id === row.id).map((item) => ({
        id: item.id, title: item.title, dueAt: item.due_at, status: item.status, completedAt: item.completed_at,
        revision: Number(item.revision || 1),
      })),
      appointments: appointmentRows.results.filter((item) => item.work_order_id === row.id).map((item) => ({
        id: item.id, appointmentType: item.appointment_type, title: item.title, startsAt: item.starts_at,
        endsAt: item.ends_at, assigneeLabel: item.assignee_label, status: item.status, notes: item.notes,
      })),
      notes: noteRows.results.filter((item) => item.work_order_id === row.id).map((item) => ({
        id: item.id, noteType: item.note_type, body: item.body, issueStatus: item.issue_status,
        createdAt: item.created_at, updatedAt: item.updated_at,
      })),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  });
  return { customers, jobs, teamAccess: identity.teamAccess };
}

async function ownedJob(db: D1Database, identity: CrmIdentity, workOrderId: string) {
  const job = await db.prepare(`SELECT id, source_type, assignee_member_id, revision FROM trade_work_orders
    WHERE id = ? AND firebase_uid = ? AND partner_type = 'installer' AND record_status = 'active'`)
    .bind(workOrderId, identity.uid).first<Record<string, unknown>>();
  if (!job) throw new Error("JOB_NOT_FOUND");
  return job;
}

export async function GET(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const identity = await crmIdentity(request);
    return adminJson({ ok: true, ...(await crmPayload(identity)) });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const identity = await crmIdentity(request);
    let body: Record<string, unknown>;
    try { body = await request.json() as Record<string, unknown>; }
    catch { return adminJson({ ok: false, error: "Invalid CRM request." }, 400); }
    const db = getD1();
    const action = cleanAdminText(body.action, 40);
    const now = new Date().toISOString();

    if (action === "create_customer") {
      const customerCount = await db.prepare("SELECT COUNT(*) count FROM trade_crm_customers WHERE firebase_uid = ? AND record_status = 'active'")
        .bind(identity.uid).first<Record<string, unknown>>();
      if (Number(customerCount?.count || 0) >= CRM_CUSTOMER_LIMIT) throw new Error("CUSTOMER_LIMIT_REACHED");
      const customerType = CUSTOMER_TYPES.has(cleanAdminText(body.customerType, 20)) ? cleanAdminText(body.customerType, 20) : "residential";
      const firstName = cleanAdminText(body.firstName, 80);
      const lastName = cleanAdminText(body.lastName, 80);
      const businessName = cleanAdminText(body.businessName, 140);
      const email = cleanAdminText(body.email, 180).toLowerCase();
      const phone = cleanAdminText(body.phone, 40);
      if (customerType === "business" ? !businessName : !firstName && !lastName) {
        return adminJson({ ok: false, error: customerType === "business" ? "Add the business name." : "Add the customer name." }, 400);
      }
      if (email && !EMAIL_PATTERN.test(email)) return adminJson({ ok: false, error: "Check the customer email address." }, 400);
      const id = crypto.randomUUID();
      const customerNumber = `CUS-${now.slice(2, 7).replace("-", "")}-${id.replaceAll("-", "").slice(0, 5).toUpperCase()}`;
      await db.prepare(`INSERT INTO trade_crm_customers
        (id, firebase_uid, customer_number, customer_type, first_name, last_name, business_name, email,
         phone, address_line_1, address_line_2, suburb, address_state, postcode, tags, private_notes,
         record_status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`)
        .bind(id, identity.uid, customerNumber, customerType, firstName, lastName, businessName, email,
          phone, cleanAdminText(body.addressLine1, 140), cleanAdminText(body.addressLine2, 140),
          cleanAdminText(body.suburb, 80), cleanAdminText(body.addressState, 20).toUpperCase(),
          cleanAdminText(body.postcode, 12), JSON.stringify(cleanList(body.tags)), cleanAdminText(body.privateNotes, 2000), now, now).run();
      return adminJson({ ok: true, ...(await crmPayload(identity)) }, 201);
    }

    if (action === "create_job") {
      const activeJobs = await db.prepare(`SELECT COUNT(*) count FROM trade_work_orders
        WHERE firebase_uid = ? AND partner_type = 'installer' AND record_status = 'active' AND stage NOT IN ('completed', 'cancelled')`)
        .bind(identity.uid).first<Record<string, unknown>>();
      if (Number(activeJobs?.count || 0) >= MEMBER_ACTIVE_JOB_LIMIT) throw new Error("JOB_LIMIT_REACHED");
      const customerId = cleanAdminText(body.crmCustomerId, 180);
      if (customerId) {
        const customer = await db.prepare("SELECT id FROM trade_crm_customers WHERE id = ? AND firebase_uid = ? AND record_status = 'active'")
          .bind(customerId, identity.uid).first<Record<string, unknown>>();
        if (!customer) throw new Error("CUSTOMER_NOT_FOUND");
      }
      const title = cleanAdminText(body.title, 160);
      if (!title) return adminJson({ ok: false, error: "Add a short job title." }, 400);
      const serviceCategory = SERVICE_CATEGORIES.has(cleanAdminText(body.serviceCategory, 60)) ? cleanAdminText(body.serviceCategory, 60) : "other";
      const priority = PRIORITIES.has(cleanAdminText(body.priority, 20)) ? cleanAdminText(body.priority, 20) : "standard";
      const scheduledStart = dateValue(body.scheduledStart, true);
      const scheduledEnd = dateValue(body.scheduledEnd, true);
      if (scheduledStart && scheduledEnd && scheduledEnd < scheduledStart) return adminJson({ ok: false, error: "The planned finish cannot be before the planned start." }, 400);
      const workOrderId = crypto.randomUUID();
      const workNumber = await nextTradeWorkNumber(db, identity.uid, "JOB", now);
      const assignee = cleanAdminText(body.assigneeLabel, 80);
      if (assignee && !identity.teamAccess) throw new Error("TEAM_ACCESS_REQUIRED");
      await db.batch([
        db.prepare(`INSERT INTO trade_work_orders
          (id, firebase_uid, partner_type, work_type, source_type, source_reference, work_number, title,
           service_category, site_area, stage, priority, scheduled_start, scheduled_end, assignee_label,
           record_status, created_at, updated_at)
          VALUES (?, ?, 'installer', 'job', 'internal', '', ?, ?, ?, ?, 'backlog', ?, ?, ?, ?, 'active', ?, ?)`)
          .bind(workOrderId, identity.uid, workNumber, title, serviceCategory, cleanAdminText(body.siteArea, 80),
            priority, scheduledStart, scheduledEnd, assignee, now, now),
        db.prepare(`INSERT INTO trade_crm_job_details
          (id, work_order_id, firebase_uid, crm_customer_id, customer_source, pipeline_stage, description,
           customer_reference, next_action, tags, estimated_value_cents, quoted_value_cents,
           invoiced_value_cents, paid_value_cents, quote_status, invoice_status, payment_due_at, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, 'enquiry', ?, ?, ?, ?, ?, 0, 0, 0, 'not_started', 'not_started', '', ?, ?)`)
          .bind(crypto.randomUUID(), workOrderId, identity.uid, customerId, customerId ? "trade_owned" : "internal",
            cleanAdminText(body.description, 3000), "", cleanAdminText(body.nextAction, 200),
            JSON.stringify(cleanList(body.tags)), moneyValue(body.estimatedValueCents), now, now),
        db.prepare(`INSERT INTO trade_work_order_events (id, work_order_id, firebase_uid, event_type, summary, created_at)
          VALUES (?, ?, ?, 'work_created', ?, ?)`).bind(crypto.randomUUID(), workOrderId, identity.uid, `${workNumber} created in installer CRM.`, now),
        ...jobSyncChangeStatements(db, { ownerUid: identity.uid, workOrderId, revision: 1, changedAt: now }),
      ]);
      return adminJson({ ok: true, ...(await crmPayload(identity)) }, 201);
    }

    const workOrderId = cleanAdminText(body.workOrderId, 180);
    await ownedJob(db, identity, workOrderId);
    if (action === "create_appointment") {
      const startsAt = dateValue(body.startsAt);
      const endsAt = dateValue(body.endsAt);
      if (!startsAt) return adminJson({ ok: false, error: "Choose an appointment start." }, 400);
      if (endsAt && endsAt < startsAt) return adminJson({ ok: false, error: "The appointment finish cannot be before its start." }, 400);
      const appointmentType = APPOINTMENT_TYPES.has(cleanAdminText(body.appointmentType, 30)) ? cleanAdminText(body.appointmentType, 30) : "site_visit";
      const assignee = cleanAdminText(body.assigneeLabel, 80);
      if (assignee && !identity.teamAccess) throw new Error("TEAM_ACCESS_REQUIRED");
      await db.prepare(`INSERT INTO trade_crm_appointments
        (id, work_order_id, firebase_uid, appointment_type, title, starts_at, ends_at, assignee_label,
         status, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'scheduled', ?, ?, ?)`)
        .bind(crypto.randomUUID(), workOrderId, identity.uid, appointmentType,
          cleanAdminText(body.title, 160) || "Job appointment", startsAt, endsAt, assignee,
          cleanAdminText(body.notes, 1000), now, now).run();
      return adminJson({ ok: true, ...(await crmPayload(identity)) }, 201);
    }
    if (action === "create_note") {
      const noteType = NOTE_TYPES.has(cleanAdminText(body.noteType, 20)) ? cleanAdminText(body.noteType, 20) : "internal";
      const noteBody = cleanAdminText(body.body, 4000);
      if (!noteBody) return adminJson({ ok: false, error: "Add a note or issue description." }, 400);
      await db.prepare(`INSERT INTO trade_crm_job_notes
        (id, work_order_id, firebase_uid, note_type, body, issue_status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(crypto.randomUUID(), workOrderId, identity.uid, noteType, noteBody, noteType === "issue" ? "open" : "not_applicable", now, now).run();
      return adminJson({ ok: true, ...(await crmPayload(identity)) }, 201);
    }
    return adminJson({ ok: false, error: "Unsupported CRM action." }, 400);
  } catch (error) { return errorResponse(error); }
}

export async function PATCH(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const identity = await crmIdentity(request);
    let body: Record<string, unknown>;
    try { body = await request.json() as Record<string, unknown>; }
    catch { return adminJson({ ok: false, error: "Invalid CRM update." }, 400); }
    const db = getD1();
    const action = cleanAdminText(body.action, 40);
    const now = new Date().toISOString();

    if (action === "update_customer") {
      const customerId = cleanAdminText(body.customerId, 180);
      const current = await db.prepare("SELECT * FROM trade_crm_customers WHERE id = ? AND firebase_uid = ? AND record_status = 'active'")
        .bind(customerId, identity.uid).first<Record<string, unknown>>();
      if (!current) throw new Error("CUSTOMER_NOT_FOUND");
      const email = body.email === undefined ? String(current.email) : cleanAdminText(body.email, 180).toLowerCase();
      if (email && !EMAIL_PATTERN.test(email)) return adminJson({ ok: false, error: "Check the customer email address." }, 400);
      const relatedJobs = await db.prepare(`SELECT w.id, w.revision, w.assignee_member_id FROM trade_work_orders w
        JOIN trade_crm_job_details d ON d.work_order_id = w.id AND d.firebase_uid = w.firebase_uid
        WHERE d.crm_customer_id = ? AND w.firebase_uid = ? AND w.partner_type = 'installer' AND w.record_status = 'active'`)
        .bind(customerId, identity.uid).all<Record<string, unknown>>();
      const statements = [db.prepare(`UPDATE trade_crm_customers SET first_name = ?, last_name = ?, business_name = ?, email = ?,
        phone = ?, address_line_1 = ?, address_line_2 = ?, suburb = ?, address_state = ?, postcode = ?,
        tags = ?, private_notes = ?, updated_at = ? WHERE id = ? AND firebase_uid = ?`)
        .bind(
          body.firstName === undefined ? current.first_name : cleanAdminText(body.firstName, 80),
          body.lastName === undefined ? current.last_name : cleanAdminText(body.lastName, 80),
          body.businessName === undefined ? current.business_name : cleanAdminText(body.businessName, 140), email,
          body.phone === undefined ? current.phone : cleanAdminText(body.phone, 40),
          body.addressLine1 === undefined ? current.address_line_1 : cleanAdminText(body.addressLine1, 140),
          body.addressLine2 === undefined ? current.address_line_2 : cleanAdminText(body.addressLine2, 140),
          body.suburb === undefined ? current.suburb : cleanAdminText(body.suburb, 80),
          body.addressState === undefined ? current.address_state : cleanAdminText(body.addressState, 20).toUpperCase(),
          body.postcode === undefined ? current.postcode : cleanAdminText(body.postcode, 12),
          body.tags === undefined ? current.tags : JSON.stringify(cleanList(body.tags)),
          body.privateNotes === undefined ? current.private_notes : cleanAdminText(body.privateNotes, 2000),
          now, customerId, identity.uid,
        )];
      for (const job of relatedJobs.results) {
        const revision = nextJobRevision(job.revision); const workOrderId = String(job.id);
        statements.push(db.prepare("UPDATE trade_work_orders SET revision = ?, updated_at = ? WHERE id = ? AND firebase_uid = ?")
          .bind(revision, now, workOrderId, identity.uid));
        statements.push(...jobSyncChangeStatements(db, { ownerUid: identity.uid, workOrderId, revision, changedAt: now,
          audienceMemberId: String(job.assignee_member_id || "") }));
      }
      await db.batch(statements);
      return adminJson({ ok: true, ...(await crmPayload(identity)) });
    }

    if (action === "update_appointment") {
      const appointmentId = cleanAdminText(body.appointmentId, 180);
      const current = await db.prepare(`SELECT a.* FROM trade_crm_appointments a JOIN trade_work_orders w ON w.id = a.work_order_id
        WHERE a.id = ? AND a.firebase_uid = ? AND w.firebase_uid = ? AND w.record_status = 'active'`)
        .bind(appointmentId, identity.uid, identity.uid).first<Record<string, unknown>>();
      if (!current) throw new Error("APPOINTMENT_NOT_FOUND");
      const status = body.status === undefined ? String(current.status) : cleanAdminText(body.status, 20);
      if (!APPOINTMENT_STATUSES.has(status)) return adminJson({ ok: false, error: "Choose a valid appointment status." }, 400);
      await db.prepare("UPDATE trade_crm_appointments SET status = ?, updated_at = ? WHERE id = ? AND firebase_uid = ?")
        .bind(status, now, appointmentId, identity.uid).run();
      return adminJson({ ok: true, ...(await crmPayload(identity)) });
    }

    if (action === "resolve_issue") {
      const noteId = cleanAdminText(body.noteId, 180);
      const issueStatus = cleanAdminText(body.issueStatus, 20);
      if (!ISSUE_STATUSES.has(issueStatus) || issueStatus === "not_applicable") return adminJson({ ok: false, error: "Choose open or resolved." }, 400);
      const result = await db.prepare(`UPDATE trade_crm_job_notes SET issue_status = ?, updated_at = ?
        WHERE id = ? AND firebase_uid = ? AND note_type = 'issue'`).bind(issueStatus, now, noteId, identity.uid).run();
      if (!result.meta.changes) throw new Error("NOTE_NOT_FOUND");
      return adminJson({ ok: true, ...(await crmPayload(identity)) });
    }

    const workOrderId = cleanAdminText(body.workOrderId, 180);
    const job = await ownedJob(db, identity, workOrderId);
    if (action !== "update_job") return adminJson({ ok: false, error: "Unsupported CRM update." }, 400);
    const current = await db.prepare("SELECT * FROM trade_crm_job_details WHERE work_order_id = ? AND firebase_uid = ?")
      .bind(workOrderId, identity.uid).first<Record<string, unknown>>();
    const platformPrivate = job.source_type === "opportunity";
    const pipelineStage = body.pipelineStage === undefined ? String(current?.pipeline_stage || (platformPrivate ? "qualifying" : "enquiry")) : cleanAdminText(body.pipelineStage, 30);
    const workStage = body.stage === undefined ? "" : cleanAdminText(body.stage, 30);
    const priority = body.priority === undefined ? "" : cleanAdminText(body.priority, 20);
    const quoteStatus = body.quoteStatus === undefined ? String(current?.quote_status || "not_started") : cleanAdminText(body.quoteStatus, 20);
    const invoiceStatus = body.invoiceStatus === undefined ? String(current?.invoice_status || "not_started") : cleanAdminText(body.invoiceStatus, 20);
    if (!PIPELINE_STAGES.has(pipelineStage) || !QUOTE_STATUSES.has(quoteStatus) || !INVOICE_STATUSES.has(invoiceStatus)) return adminJson({ ok: false, error: "Choose a valid job, quote and invoice status." }, 400);
    if (workStage && !WORK_STAGES.has(workStage)) return adminJson({ ok: false, error: "Choose a valid work stage." }, 400);
    if (priority && !PRIORITIES.has(priority)) return adminJson({ ok: false, error: "Choose a valid priority." }, 400);
    const customerId = platformPrivate ? "" : body.crmCustomerId === undefined ? String(current?.crm_customer_id || "") : cleanAdminText(body.crmCustomerId, 180);
    if (customerId) {
      const customer = await db.prepare("SELECT id FROM trade_crm_customers WHERE id = ? AND firebase_uid = ? AND record_status = 'active'")
        .bind(customerId, identity.uid).first<Record<string, unknown>>();
      if (!customer) throw new Error("CUSTOMER_NOT_FOUND");
    }
    const values = {
      customerId,
      customerSource: platformPrivate ? "platform_private" : customerId ? "trade_owned" : "internal",
      pipelineStage,
      description: body.description === undefined ? String(current?.description || "") : cleanAdminText(body.description, 3000),
      customerReference: platformPrivate ? "" : String(current?.customer_reference || ""),
      nextAction: body.nextAction === undefined ? String(current?.next_action || "") : cleanAdminText(body.nextAction, 200),
      tags: body.tags === undefined ? String(current?.tags || "[]") : JSON.stringify(cleanList(body.tags)),
      estimated: body.estimatedValueCents === undefined ? Number(current?.estimated_value_cents || 0) : moneyValue(body.estimatedValueCents),
      quoted: body.quotedValueCents === undefined ? Number(current?.quoted_value_cents || 0) : moneyValue(body.quotedValueCents),
      invoiced: body.invoicedValueCents === undefined ? Number(current?.invoiced_value_cents || 0) : moneyValue(body.invoicedValueCents),
      paid: body.paidValueCents === undefined ? Number(current?.paid_value_cents || 0) : moneyValue(body.paidValueCents),
      paymentDue: body.paymentDueAt === undefined ? String(current?.payment_due_at || "") : dateValue(body.paymentDueAt, true),
    };
    const detailStatement = current
      ? db.prepare(`UPDATE trade_crm_job_details SET crm_customer_id = ?, customer_source = ?, pipeline_stage = ?,
          description = ?, customer_reference = ?, next_action = ?, tags = ?, estimated_value_cents = ?,
          quoted_value_cents = ?, invoiced_value_cents = ?, paid_value_cents = ?, quote_status = ?,
          invoice_status = ?, payment_due_at = ?, updated_at = ? WHERE work_order_id = ? AND firebase_uid = ?`)
        .bind(values.customerId, values.customerSource, values.pipelineStage, values.description, values.customerReference,
          values.nextAction, values.tags, values.estimated, values.quoted, values.invoiced, values.paid,
          quoteStatus, invoiceStatus, values.paymentDue, now, workOrderId, identity.uid)
      : db.prepare(`INSERT INTO trade_crm_job_details
          (id, work_order_id, firebase_uid, crm_customer_id, customer_source, pipeline_stage, description,
           customer_reference, next_action, tags, estimated_value_cents, quoted_value_cents,
           invoiced_value_cents, paid_value_cents, quote_status, invoice_status, payment_due_at, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(crypto.randomUUID(), workOrderId, identity.uid, values.customerId, values.customerSource, values.pipelineStage,
          values.description, values.customerReference, values.nextAction, values.tags, values.estimated, values.quoted,
          values.invoiced, values.paid, quoteStatus, invoiceStatus, values.paymentDue, now, now);
    const revision = nextJobRevision(job.revision);
    const statements = [detailStatement, db.prepare(`UPDATE trade_work_orders SET stage = COALESCE(NULLIF(?, ''), stage),
      priority = COALESCE(NULLIF(?, ''), priority), revision = ?, updated_at = ? WHERE id = ? AND firebase_uid = ?`)
      .bind(workStage, priority, revision, now, workOrderId, identity.uid)];
    statements.push(db.prepare(`INSERT INTO trade_work_order_events (id, work_order_id, firebase_uid, event_type, summary, created_at)
      VALUES (?, ?, ?, 'crm_updated', 'CRM job details updated.', ?)`).bind(crypto.randomUUID(), workOrderId, identity.uid, now));
    statements.push(...jobSyncChangeStatements(db, { ownerUid: identity.uid, workOrderId, revision, changedAt: now,
      audienceMemberId: String(job.assignee_member_id || "") }));
    await db.batch(statements);
    return adminJson({ ok: true, ...(await crmPayload(identity)) });
  } catch (error) { return errorResponse(error); }
}
