import { getD1 } from "../../../../db";
import { requireFirebaseIdentity } from "@/lib/firebase-server";
import { adminJson, cleanAdminText, sameOrigin } from "@/lib/admin-server";
import { accountEntitlements } from "@/lib/direct-trade-entitlements-server";
import { nextTlinkJobNumber } from "@/lib/trade-job-number-server";
import { jobSyncChangeStatements, nextJobRevision } from "@/lib/trade-team-sync-server";
import { decodeKeysetCursor, encodeKeysetCursor, keysetAfter, type KeysetDirection } from "@/lib/keyset-pagination";
import { performanceJson, routeTimer } from "@/lib/route-performance";
import { ftsPrefixQuery } from "@/lib/fts-search";
import { appointmentEndsAt, assertAppointmentSlot, assertFutureAppointment, australiaLocalDateTime } from "@/lib/trade-schedule";
import { findDirectCustomerDuplicates } from "@/lib/trade-customer-dedup-server";
import { ensureOwnerTeamMember } from "@/lib/trade-team-server";
import { encryptProtectedPayload } from "@/lib/trade-integration-crypto";
import { sendPhotoRequestDelivery } from "@/lib/photo-request-delivery-server";
import { quickInvoiceNumber, resolveQuickInvoiceDraft, sendQuickInvoiceDelivery, type QuickInvoiceDraft } from "@/lib/trade-quick-invoice-server";
import { defaultPhotoRequirements, hashPhotoRequestSecret, newPhotoRequestSecret, normalisePhotoRequirements, photoRequestExpiry } from "@/lib/trade-photo-requests";
import { syncCreatedAppointmentToConnectedCalendars } from "@/lib/trade-calendar-sync-server";

export const runtime = "edge";

const MEMBER_ACTIVE_JOB_LIMIT = 500;
const CRM_CUSTOMER_LIMIT = 5000;
const CRM_TEMPLATE_LIMIT = 60;
const CUSTOMER_TYPES = new Set(["residential", "business"]);
const PIPELINE_STAGES = new Set(["enquiry", "qualifying", "quoting", "approved", "scheduled", "in_progress", "complete", "invoiced", "paid", "lost"]);
const WORK_STAGES = new Set(["backlog", "ready", "scheduled", "in_progress", "blocked", "completed", "cancelled"]);
const PRIORITIES = new Set(["low", "standard", "high", "urgent"]);
const SERVICE_CATEGORIES = new Set(["assessment", "solar", "battery", "heating-cooling", "hot-water", "insulation-draughts", "ev-charging", "electrical", "plumbing", "mounting-hardware", "controls", "other"]);
const APPOINTMENT_TYPES = new Set(["phone_call", "site_visit", "quote_review", "installation", "service", "admin"]);
const APPOINTMENT_STATUSES = new Set(["scheduled", "completed", "cancelled", "no_show"]);
const BUILDING_TYPES = new Set(["house_townhouse", "apartment_unit", "commercial_office", "retail_hospitality", "industrial_warehouse", "institutional_community_health", "other", "not_sure"]);
const ADDRESS_STATES = new Set(["ACT", "NSW", "NT", "QLD", "SA", "TAS", "VIC", "WA"]);
const NOTE_TYPES = new Set(["internal", "issue"]);
const ISSUE_STATUSES = new Set(["not_applicable", "open", "resolved"]);
const QUOTE_STATUSES = new Set(["not_started", "draft", "sent", "accepted", "declined"]);
const INVOICE_STATUSES = new Set(["not_started", "draft", "issued", "part_paid", "paid", "overdue", "void"]);
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PAGE_SIZES = new Set([25, 50, 100]);
const SERVICE_LABELS: Record<string, string> = {
  assessment: "Energy assessment", solar: "Rooftop solar", battery: "Home batteries",
  "heating-cooling": "Heating and cooling", "hot-water": "Hot water",
  "insulation-draughts": "Insulation and draught control", "ev-charging": "EV charging",
  electrical: "Electrical services", plumbing: "Plumbing services",
  "mounting-hardware": "Mounting and hardware", controls: "Energy controls", other: "Other work",
};
const APPOINTMENT_LABELS: Record<string, string> = {
  phone_call: "Phone call", site_visit: "Site visit", quote_review: "Quote review",
  installation: "Installation", service: "Service visit", admin: "Office task",
};
type CrmSortTerm = { expression: string; direction: KeysetDirection; rowKey: string; numeric?: boolean };
type CrmSort = { orderBy: string; terms: CrmSortTerm[] };
const crmTerm = (expression: string, direction: KeysetDirection, rowKey: string, numeric = false): CrmSortTerm => ({ expression, direction, rowKey, numeric });
const crmSort = (terms: CrmSortTerm[], idExpression: string): CrmSort => {
  const stable = [...terms, crmTerm(idExpression, terms.at(-1)?.direction || "asc", "id")];
  return { orderBy: stable.map((item) => `${item.expression} ${item.direction.toUpperCase()}`).join(", "), terms: stable };
};
const JOB_SORTS: Record<string, CrmSort> = {
  "number-asc": crmSort([crmTerm("w.work_number COLLATE NOCASE", "asc", "work_number")], "w.id"),
  "number-desc": crmSort([crmTerm("w.work_number COLLATE NOCASE", "desc", "work_number")], "w.id"),
  "date-asc": crmSort([crmTerm("w.scheduled_start = ''", "asc", "schedule_empty", true), crmTerm("w.scheduled_start", "asc", "scheduled_start"), crmTerm("w.updated_at", "desc", "updated_at")], "w.id"),
  "updated-desc": crmSort([crmTerm("w.updated_at", "desc", "updated_at")], "w.id"),
};
const CUSTOMER_SORTS: Record<string, CrmSort> = {
  "name-asc": crmSort([crmTerm("CASE WHEN c.business_name <> '' THEN c.business_name ELSE c.last_name || ' ' || c.first_name END COLLATE NOCASE", "asc", "sort_name")], "c.id"),
  "name-desc": crmSort([crmTerm("CASE WHEN c.business_name <> '' THEN c.business_name ELSE c.last_name || ' ' || c.first_name END COLLATE NOCASE", "desc", "sort_name")], "c.id"),
  "updated-desc": crmSort([crmTerm("c.updated_at", "desc", "updated_at")], "c.id"),
};
const SCHEDULE_SORT = crmSort([crmTerm("a.starts_at", "asc", "starts_at"), crmTerm("a.created_at", "asc", "created_at")], "a.id");

type CrmIdentity = { uid: string; email: string; memberId: string; businessName: string; addressState: string; teamAccess: boolean };

async function crmIdentity(request: Request): Promise<CrmIdentity> {
  const identity = await requireFirebaseIdentity(request);
  const account = await getD1().prepare(`SELECT partner_type, account_status, billing_status, business_name, address_state
    FROM trade_accounts WHERE firebase_uid = ?`).bind(identity.uid).first<Record<string, unknown>>();
  if (!account) throw new Error("PROFILE_REQUIRED");
  if (account.account_status !== "active") throw new Error("ACCOUNT_INACTIVE");
  if (account.partner_type !== "installer") throw new Error("INSTALLER_ONLY");
  const entitlements = await accountEntitlements(identity.uid, "installer", account.billing_status);
  if (!entitlements.features.business_operations) throw new Error("FULL_ACCESS_REQUIRED");
  const businessName = String(account.business_name || "Trade business");
  const memberId = await ensureOwnerTeamMember(identity.uid, identity.email, businessName);
  return {
    uid: identity.uid,
    email: identity.email,
    memberId,
    businessName,
    addressState: String(account.address_state || "NSW"),
    teamAccess: entitlements.features.team_access,
  };
}

function errorResponse(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  if (code === "AUTH_REQUIRED") return adminJson({ ok: false, error: "Sign in to continue." }, 401);
  if (code === "PROFILE_REQUIRED") return adminJson({ ok: false, error: "Complete the installer profile first." }, 404);
  if (code === "ACCOUNT_INACTIVE") return adminJson({ ok: false, error: "This installer account is not active." }, 403);
  if (code === "INSTALLER_ONLY") return adminJson({ ok: false, error: "Customer CRM is available to installer accounts only." }, 403);
  if (code === "FULL_ACCESS_REQUIRED") return adminJson({ ok: false, error: "Complete trade verification before using customer CRM, scheduling and financial tracking." }, 403);
  if (code === "TEAM_ACCESS_REQUIRED") return adminJson({ ok: false, error: "Complete trade verification before assigning staff." }, 403);
  if (code === "CUSTOMER_NOT_FOUND") return adminJson({ ok: false, error: "Customer record not found." }, 404);
  if (code === "CONTACT_NOT_FOUND") return adminJson({ ok: false, error: "Customer contact not found." }, 404);
  if (code === "SERVICE_SITE_NOT_FOUND") return adminJson({ ok: false, error: "Service site not found." }, 404);
  if (code === "JOB_NOT_FOUND") return adminJson({ ok: false, error: "Job record not found." }, 404);
  if (code === "APPOINTMENT_NOT_FOUND") return adminJson({ ok: false, error: "Appointment not found." }, 404);
  if (code === "NOTE_NOT_FOUND") return adminJson({ ok: false, error: "Note or issue not found." }, 404);
  if (code === "INVALID_DATE") return adminJson({ ok: false, error: "Choose a valid date and time." }, 400);
  if (code === "PAST_APPOINTMENT") return adminJson({ ok: false, error: "Choose a future appointment time." }, 400);
  if (code === "INVALID_APPOINTMENT_SLOT") return adminJson({ ok: false, error: "Choose an appointment time on a 15-minute interval." }, 400);
  if (code === "INVALID_QUICK_INVOICE") return adminJson({ ok: false, error: "Add at least one valid invoice line and check the GST choice." }, 400);
  if (code === "PRICE_BOOK_ITEM_UNAVAILABLE") return adminJson({ ok: false, error: "A saved invoice fee changed or was archived. Choose it again." }, 409);
  if (code === "JOB_LIMIT_REACHED") return adminJson({ ok: false, error: "This workspace has reached its 500 active job fair-use limit." }, 409);
  if (code === "CUSTOMER_LIMIT_REACHED") return adminJson({ ok: false, error: "This workspace has reached its customer-record fair-use limit." }, 409);
  if (code === "JOB_NUMBER_UNAVAILABLE") return adminJson({ ok: false, error: "The next job number could not be reserved. Please try again." }, 503);
  if (code === "INVALID_CURSOR") return adminJson({ ok: false, error: "This CRM page link has expired. Start again from the first page." }, 400);
  return adminJson({ ok: false, error: "The private installer CRM request could not be completed." }, 500);
}

function addSummaryDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function summaryWeekStart(date: string) {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return addSummaryDays(date, -((day + 6) % 7));
}

function summaryBookedMinutes(startsAt: unknown, endsAt: unknown) {
  const start = typeof startsAt === "string" ? Date.parse(`${startsAt}:00Z`) : Number.NaN;
  const end = typeof endsAt === "string" && endsAt ? Date.parse(`${endsAt}:00Z`) : Number.NaN;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 60;
  return Math.max(15, Math.min(480, Math.round((end - start) / 900_000) * 15));
}

function cleanList(value: unknown, limit = 12) {
  const input = Array.isArray(value) ? value : String(value || "").split(",");
  return [...new Set(input.map((item) => cleanAdminText(item, 40).toLowerCase()).filter(Boolean))].slice(0, limit);
}

function cleanIds(value: unknown) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => cleanAdminText(item, 180)).filter(Boolean))].slice(0, 100);
}

function storedList(value: unknown, limit = 12) {
  try {
    const parsed = JSON.parse(String(value || "[]"));
    return Array.isArray(parsed) ? parsed.map((item) => String(item)).slice(0, limit) : [];
  } catch { return []; }
}

function cleanTemplateTasks(value: unknown) {
  const input = Array.isArray(value) ? value : String(value || "").split(/\r?\n/);
  return [...new Set(input.map((item) => cleanAdminText(item, 180)).filter(Boolean))].slice(0, 24);
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
  return String(row.business_name || `${String(row.first_name || "")} ${String(row.last_name || "")}`.trim() || row.customer_number || "");
}

function pagination(url: URL) {
  const requestedPage = Number(url.searchParams.get("page"));
  const requestedPageSize = Number(url.searchParams.get("pageSize"));
  return {
    page: Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1,
    pageSize: PAGE_SIZES.has(requestedPageSize) ? requestedPageSize : 25,
  };
}

function indexedJob(row: Record<string, unknown>) {
  const sourceType = String(row.source_type);
  const customerSource = sourceType === "opportunity" ? "platform_private" : String(row.customer_source || "internal");
  return {
    id: row.id, workNumber: row.work_number, title: row.title, serviceCategory: row.service_category,
    siteArea: row.site_area, stage: row.stage, priority: row.priority, scheduledStart: row.scheduled_start,
    scheduledEnd: row.scheduled_end, assigneeLabel: row.assignee_label, sourceType, customerSource,
    crmCustomerId: customerSource === "platform_private" ? "" : String(row.crm_customer_id || ""),
    serviceSiteId: customerSource === "platform_private" ? "" : String(row.service_site_id || ""),
    customerDisplayName: customerSource === "platform_private" ? "AEA protected customer" : String(row.customer_name || ""),
    pipelineStage: row.pipeline_stage || (sourceType === "opportunity" ? "qualifying" : "enquiry"), buildingType: row.building_type || "not_sure",
    description: row.description || "", customerReference: customerSource === "platform_private" ? String(row.source_reference || row.work_number) : String(row.customer_reference || ""),
    nextAction: row.next_action || "", tags: storedList(row.job_tags), estimatedValueCents: Number(row.estimated_value_cents || 0),
    quotedValueCents: Number(row.quoted_value_cents || 0), invoicedValueCents: Number(row.invoiced_value_cents || 0),
    paidValueCents: Number(row.paid_value_cents || 0), quoteStatus: row.quote_status || "not_started",
    invoiceStatus: row.invoice_status || "not_started", paymentDueAt: row.payment_due_at || "",
    handoverStatus: row.handover_status || "", tasks: [], appointments: [], notes: [],
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function indexedContact(row: Record<string, unknown>) {
  return {
    id: String(row.id), customerId: String(row.customer_id), firstName: String(row.first_name || ""),
    lastName: String(row.last_name || ""), roleLabel: String(row.role_label || ""),
    email: String(row.email || ""), phone: String(row.phone || ""), isPrimary: Boolean(row.is_primary),
    createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  };
}

function indexedServiceSite(row: Record<string, unknown>, siteContacts: Record<string, unknown>[] = []) {
  return {
    id: String(row.id), customerId: String(row.customer_id), siteLabel: String(row.site_label || "Primary site"),
    addressLine1: String(row.address_line_1 || ""), addressLine2: String(row.address_line_2 || ""),
    suburb: String(row.suburb || ""), addressState: String(row.address_state || ""), postcode: String(row.postcode || ""),
    accessInstructions: String(row.access_instructions || ""), parkingInstructions: String(row.parking_instructions || ""),
    hazardNotes: String(row.hazard_notes || ""), isPrimary: Boolean(row.is_primary),
    contacts: siteContacts.filter((contact) => contact.service_site_id === row.id).map((contact) => ({
      id: String(contact.id), customerContactId: String(contact.customer_contact_id), roleLabel: String(contact.role_label || "Service contact"),
      isPrimary: Boolean(contact.is_primary), displayName: String(contact.contact_name || "Contact"),
      email: String(contact.email || ""), phone: String(contact.phone || ""),
    })),
    createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  };
}

function indexedCustomer(row: Record<string, unknown>) {
  return {
    id: row.id, customerNumber: row.customer_number, customerType: row.customer_type,
    displayName: customerDisplayName(row), firstName: row.first_name, lastName: row.last_name,
    businessName: row.business_name, businessNumber: row.business_number, email: row.email, phone: row.phone, addressLine1: row.address_line_1,
    addressLine2: row.address_line_2, suburb: row.suburb, addressState: row.address_state,
    postcode: row.postcode, tags: storedList(row.tags), privateNotes: row.private_notes,
    jobCount: Number(row.job_count || 0), activeJobCount: Number(row.active_job_count || 0),
    activities: String(row.activities || "").split(",").filter(Boolean),
    latestJobNumber: String(row.latest_job_number || ""), latestPipelineStage: String(row.latest_pipeline_stage || ""),
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

async function crmIndex(identity: CrmIdentity, url: URL, resource: string) {
  const db = getD1();
  const { page, pageSize } = pagination(url);
  const search = cleanAdminText(url.searchParams.get("search"), 100).toLowerCase();
  const filter = cleanAdminText(url.searchParams.get("filter"), 30);
  const sortValue = cleanAdminText(url.searchParams.get("sort"), 30);
  const includeTotal = url.searchParams.get("total") !== "0";
  const cursorInput = cleanAdminText(url.searchParams.get("cursor"), 2000);
  const bindings: unknown[] = [identity.uid];
  if (resource === "jobs") {
    const conditions = ["w.firebase_uid = ?", "w.partner_type = 'installer'", "w.record_status = 'active'"];
    if (search) {
      conditions.push(`LOWER(w.work_number || ' ' || w.title || ' ' || w.site_area || ' ' ||
        CASE WHEN c.business_name <> '' THEN c.business_name ELSE TRIM(c.first_name || ' ' || c.last_name) END) LIKE ?`);
      bindings.push(`%${search}%`);
    }
    const customer = cleanAdminText(url.searchParams.get("customer"), 100).toLowerCase();
    if (customer) {
      conditions.push(`LOWER(CASE WHEN c.business_name <> '' THEN c.business_name ELSE TRIM(c.first_name || ' ' || c.last_name) END) LIKE ?`);
      bindings.push(`%${customer}%`);
    }
    const service = cleanAdminText(url.searchParams.get("service"), 40);
    if (SERVICE_CATEGORIES.has(service)) { conditions.push("w.service_category = ?"); bindings.push(service); }
    const pipeline = cleanAdminText(url.searchParams.get("pipeline"), 30);
    if (pipeline && PIPELINE_STAGES.has(pipeline)) { conditions.push("d.pipeline_stage = ?"); bindings.push(pipeline); }
    const stage = cleanAdminText(url.searchParams.get("stage"), 30);
    if (WORK_STAGES.has(stage)) { conditions.push("w.stage = ?"); bindings.push(stage); }
    const assignee = cleanAdminText(url.searchParams.get("assignee"), 100).toLowerCase();
    if (assignee) { conditions.push("LOWER(w.assignee_label) LIKE ?"); bindings.push(`%${assignee}%`); }
    const location = cleanAdminText(url.searchParams.get("location"), 100).toLowerCase();
    if (location) {
      conditions.push(`LOWER(COALESCE(w.site_area, '') || ' ' || COALESCE(c.address_line_1, '') || ' ' || COALESCE(c.address_line_2, '') || ' ' || COALESCE(c.suburb, '') || ' ' || COALESCE(c.address_state, '') || ' ' || COALESCE(c.postcode, '')) LIKE ?`);
      bindings.push(`%${location}%`);
    }
    if (filter === "platform") conditions.push("w.source_type = 'opportunity'");
    else if (filter === "completed") conditions.push("w.stage IN ('completed', 'cancelled')");
    else if (filter === "attention") conditions.push(`(w.stage = 'blocked' OR EXISTS (SELECT 1 FROM trade_crm_job_notes n
      WHERE n.work_order_id = w.id AND n.firebase_uid = w.firebase_uid AND n.note_type = 'issue' AND n.issue_status = 'open'))`);
    else if (filter !== "all") conditions.push("w.stage NOT IN ('completed', 'cancelled')");
    const where = conditions.join(" AND ");
    const joins = `FROM trade_work_orders w LEFT JOIN trade_crm_job_details d ON d.work_order_id = w.id AND d.firebase_uid = w.firebase_uid
      LEFT JOIN trade_crm_customers c ON c.id = d.crm_customer_id AND c.firebase_uid = w.firebase_uid`;
    const sort = JOB_SORTS[sortValue] ? sortValue : "updated-desc";
    const selectedSort = JOB_SORTS[sort];
    let cursor;
    try { cursor = decodeKeysetCursor(cursorInput, `jobs:${sort}`, selectedSort.terms.length); } catch { throw new Error("INVALID_CURSOR"); }
    if (page > 1 && !cursor) throw new Error("INVALID_CURSOR");
    const rowConditions = [...conditions]; const rowBindings = [...bindings];
    if (cursor) { const after = keysetAfter(selectedSort.terms, cursor); rowConditions.push(`(${after.sql})`); rowBindings.push(...after.bindings); }
    const rowWhere = rowConditions.join(" AND ");
    const [countRow, rows] = await Promise.all([
      includeTotal ? db.prepare(`SELECT COUNT(*) total ${joins} WHERE ${where}`).bind(...bindings).first<Record<string, unknown>>() : Promise.resolve(null),
      db.prepare(`SELECT w.*, d.crm_customer_id, d.customer_source, d.pipeline_stage, d.description, d.customer_reference,
        d.next_action, d.tags job_tags, d.estimated_value_cents, d.quoted_value_cents, d.invoiced_value_cents,
        d.paid_value_cents, d.quote_status, d.invoice_status, d.payment_due_at,
        CASE WHEN c.business_name <> '' THEN c.business_name ELSE TRIM(c.first_name || ' ' || c.last_name) END customer_name,
        (SELECT status FROM trade_handover_packs hp WHERE hp.work_order_id = w.id AND hp.firebase_uid = w.firebase_uid ORDER BY hp.updated_at DESC LIMIT 1) handover_status,
        w.scheduled_start = '' schedule_empty
        ${joins} WHERE ${rowWhere} ORDER BY ${selectedSort.orderBy} LIMIT ?`)
        .bind(...rowBindings, pageSize + 1).all<Record<string, unknown>>(),
    ]);
    const total = countRow ? Number(countRow.total || 0) : undefined;
    const hasNext = rows.results.length > pageSize; const pageRows = rows.results.slice(0, pageSize);
    const nextCursor = hasNext && pageRows.length ? encodeKeysetCursor(`jobs:${sort}`, selectedSort.terms.map((item) => item.numeric ? Number(pageRows.at(-1)![item.rowKey]) : String(pageRows.at(-1)![item.rowKey] || ""))) : "";
    return { items: pageRows.map((row: Record<string, unknown>) => indexedJob(row)), pagination: { page, pageSize, total, pageCount: total === undefined ? undefined : Math.max(1, Math.ceil(total / pageSize)), hasNext, nextCursor } };
  }
  const conditions = ["c.firebase_uid = ?", "c.record_status = 'active'"];
  if (search) {
    conditions.push(`(c.id IN (SELECT entity_id FROM tlink_crm_customer_search WHERE owner_uid = ? AND tlink_crm_customer_search MATCH ?)
      OR EXISTS (SELECT 1 FROM trade_crm_customer_contacts sc WHERE sc.customer_id = c.id AND sc.firebase_uid = c.firebase_uid
        AND sc.record_status = 'active' AND LOWER(sc.phone || ' ' || sc.email) LIKE ?)
      OR EXISTS (SELECT 1 FROM trade_crm_service_sites ss WHERE ss.customer_id = c.id AND ss.firebase_uid = c.firebase_uid
        AND ss.record_status = 'active' AND LOWER(ss.suburb || ' ' || ss.postcode) LIKE ?))`);
    bindings.push(identity.uid, ftsPrefixQuery(search), `%${search}%`, `%${search}%`);
  }
  const firstName = cleanAdminText(url.searchParams.get("firstName"), 100).toLowerCase();
  if (firstName) { conditions.push("LOWER(c.first_name) LIKE ?"); bindings.push(`%${firstName}%`); }
  const lastName = cleanAdminText(url.searchParams.get("lastName"), 100).toLowerCase();
  if (lastName) { conditions.push("LOWER(c.last_name) LIKE ?"); bindings.push(`%${lastName}%`); }
  const businessName = cleanAdminText(url.searchParams.get("businessName"), 140).toLowerCase();
  if (businessName) { conditions.push("LOWER(c.business_name) LIKE ?"); bindings.push(`%${businessName}%`); }
  const email = cleanAdminText(url.searchParams.get("email"), 180).toLowerCase();
  if (email) {
    conditions.push(`(LOWER(c.email) LIKE ? OR EXISTS (SELECT 1 FROM trade_crm_customer_contacts ec
      WHERE ec.customer_id = c.id AND ec.firebase_uid = c.firebase_uid AND ec.record_status = 'active' AND LOWER(ec.email) LIKE ?))`);
    bindings.push(`%${email}%`, `%${email}%`);
  }
  const street = cleanAdminText(url.searchParams.get("street"), 120).toLowerCase();
  if (street) { conditions.push("LOWER(c.address_line_1 || ' ' || c.address_line_2) LIKE ?"); bindings.push(`%${street}%`); }
  const phone = cleanAdminText(url.searchParams.get("phone"), 50).toLowerCase();
  if (phone) { conditions.push("LOWER(c.phone) LIKE ?"); bindings.push(`%${phone}%`); }
  const postcode = cleanAdminText(url.searchParams.get("postcode"), 12).toLowerCase();
  if (postcode) { conditions.push("LOWER(c.postcode) LIKE ?"); bindings.push(`%${postcode}%`); }
  const suburb = cleanAdminText(url.searchParams.get("suburb"), 100).toLowerCase();
  if (suburb) { conditions.push("LOWER(c.suburb) LIKE ?"); bindings.push(`%${suburb}%`); }
  const state = cleanAdminText(url.searchParams.get("state"), 12).toUpperCase();
  if (state) { conditions.push("UPPER(c.address_state) = ?"); bindings.push(state); }
  const service = cleanAdminText(url.searchParams.get("service"), 40);
  if (SERVICE_CATEGORIES.has(service)) {
    conditions.push(`EXISTS (SELECT 1 FROM trade_crm_job_details fd JOIN trade_work_orders fw ON fw.id = fd.work_order_id AND fw.firebase_uid = fd.firebase_uid
      WHERE fd.crm_customer_id = c.id AND fd.firebase_uid = c.firebase_uid AND fw.record_status = 'active' AND fw.service_category = ?)`);
    bindings.push(service);
  }
  const jobId = cleanAdminText(url.searchParams.get("jobId"), 80).toLowerCase();
  if (jobId) {
    conditions.push(`EXISTS (SELECT 1 FROM trade_crm_job_details fd JOIN trade_work_orders fw ON fw.id = fd.work_order_id AND fw.firebase_uid = fd.firebase_uid
      WHERE fd.crm_customer_id = c.id AND fd.firebase_uid = c.firebase_uid AND fw.record_status = 'active' AND LOWER(fw.work_number) LIKE ?)`);
    bindings.push(`%${jobId}%`);
  }
  const pipeline = cleanAdminText(url.searchParams.get("pipeline"), 30);
  if (PIPELINE_STAGES.has(pipeline)) {
    conditions.push(`EXISTS (SELECT 1 FROM trade_crm_job_details fd JOIN trade_work_orders fw ON fw.id = fd.work_order_id AND fw.firebase_uid = fd.firebase_uid
      WHERE fd.crm_customer_id = c.id AND fd.firebase_uid = c.firebase_uid AND fw.record_status = 'active' AND fd.pipeline_stage = ?)`);
    bindings.push(pipeline);
  }
  const where = conditions.join(" AND ");
  const sort = CUSTOMER_SORTS[sortValue] ? sortValue : "name-asc";
  const selectedSort = CUSTOMER_SORTS[sort];
  let cursor;
  try { cursor = decodeKeysetCursor(cursorInput, `customers:${sort}`, selectedSort.terms.length); } catch { throw new Error("INVALID_CURSOR"); }
  if (page > 1 && !cursor) throw new Error("INVALID_CURSOR");
  const rowConditions = [...conditions]; const rowBindings = [...bindings];
  if (cursor) { const after = keysetAfter(selectedSort.terms, cursor); rowConditions.push(`(${after.sql})`); rowBindings.push(...after.bindings); }
  const rowWhere = rowConditions.join(" AND ");
  const [countRow, rows] = await Promise.all([
    includeTotal ? db.prepare(`SELECT COUNT(*) total FROM trade_crm_customers c WHERE ${where}`).bind(...bindings).first<Record<string, unknown>>() : Promise.resolve(null),
    db.prepare(`WITH owned_jobs AS (
      SELECT d.crm_customer_id, w.service_category, w.work_number, d.pipeline_stage, w.stage, w.updated_at,
        ROW_NUMBER() OVER (PARTITION BY d.crm_customer_id ORDER BY w.updated_at DESC, w.id DESC) latest_rank
      FROM trade_crm_job_details d JOIN trade_work_orders w ON w.id = d.work_order_id AND w.firebase_uid = d.firebase_uid
      WHERE d.firebase_uid = ? AND w.record_status = 'active'
    ), customer_job_summary AS (
      SELECT crm_customer_id, COUNT(*) job_count,
        SUM(CASE WHEN stage NOT IN ('completed', 'cancelled') THEN 1 ELSE 0 END) active_job_count,
        GROUP_CONCAT(DISTINCT service_category) activities,
        MAX(CASE WHEN latest_rank = 1 THEN work_number ELSE '' END) latest_job_number,
        MAX(CASE WHEN latest_rank = 1 THEN pipeline_stage ELSE '' END) latest_pipeline_stage
      FROM owned_jobs GROUP BY crm_customer_id
    )
      SELECT c.*, CASE WHEN c.business_name <> '' THEN c.business_name ELSE c.last_name || ' ' || c.first_name END sort_name,
        COALESCE(js.job_count, 0) job_count, COALESCE(js.active_job_count, 0) active_job_count,
        COALESCE(js.activities, '') activities, COALESCE(js.latest_job_number, '') latest_job_number,
        COALESCE(js.latest_pipeline_stage, '') latest_pipeline_stage
      FROM trade_crm_customers c LEFT JOIN customer_job_summary js ON js.crm_customer_id = c.id
      WHERE ${rowWhere} ORDER BY ${selectedSort.orderBy} LIMIT ?`)
      .bind(identity.uid, ...rowBindings, pageSize + 1).all<Record<string, unknown>>(),
  ]);
  const total = countRow ? Number(countRow.total || 0) : undefined;
  const hasNext = rows.results.length > pageSize; const pageRows = rows.results.slice(0, pageSize);
  const nextCursor = hasNext && pageRows.length ? encodeKeysetCursor(`customers:${sort}`, selectedSort.terms.map((item) => String(pageRows.at(-1)![item.rowKey] || ""))) : "";
  return { items: pageRows.map((row: Record<string, unknown>) => indexedCustomer(row)), pagination: { page, pageSize, total, pageCount: total === undefined ? undefined : Math.max(1, Math.ceil(total / pageSize)), hasNext, nextCursor } };
}

async function crmDetail(identity: CrmIdentity, resource: string, id: string) {
  const db = getD1();
  if (resource === "customer") {
    const row = await db.prepare(`SELECT c.*,
      (SELECT COUNT(*) FROM trade_crm_job_details d JOIN trade_work_orders w ON w.id = d.work_order_id
        WHERE d.crm_customer_id = c.id AND d.firebase_uid = c.firebase_uid AND w.record_status = 'active') job_count
      FROM trade_crm_customers c WHERE c.id = ? AND c.firebase_uid = ? AND c.record_status = 'active'`)
      .bind(id, identity.uid).first<Record<string, unknown>>();
    if (!row) throw new Error("CUSTOMER_NOT_FOUND");
    const [jobs, contacts, sites, siteContacts] = await Promise.all([
      db.prepare(`SELECT w.*, d.crm_customer_id, d.service_site_id, d.customer_source, d.pipeline_stage,
      d.next_action, d.quoted_value_cents, d.invoiced_value_cents, d.paid_value_cents,
      CASE WHEN c.business_name <> '' THEN c.business_name ELSE TRIM(c.first_name || ' ' || c.last_name) END customer_name
      FROM trade_work_orders w JOIN trade_crm_job_details d ON d.work_order_id = w.id AND d.firebase_uid = w.firebase_uid
      LEFT JOIN trade_crm_customers c ON c.id = d.crm_customer_id AND c.firebase_uid = w.firebase_uid
      WHERE d.crm_customer_id = ? AND w.firebase_uid = ? AND w.record_status = 'active' ORDER BY w.updated_at DESC LIMIT 200`)
        .bind(id, identity.uid).all<Record<string, unknown>>(),
      db.prepare(`SELECT * FROM trade_crm_customer_contacts
        WHERE customer_id = ? AND firebase_uid = ? AND record_status = 'active' ORDER BY is_primary DESC, last_name, first_name`)
        .bind(id, identity.uid).all<Record<string, unknown>>(),
      db.prepare(`SELECT * FROM trade_crm_service_sites
        WHERE customer_id = ? AND firebase_uid = ? AND record_status = 'active' ORDER BY is_primary DESC, site_label`)
        .bind(id, identity.uid).all<Record<string, unknown>>(),
      db.prepare(`SELECT sc.*, TRIM(cc.first_name || ' ' || cc.last_name) contact_name, cc.email, cc.phone
        FROM trade_crm_site_contacts sc JOIN trade_crm_customer_contacts cc
          ON cc.id = sc.customer_contact_id AND cc.firebase_uid = sc.firebase_uid
        JOIN trade_crm_service_sites ss ON ss.id = sc.service_site_id AND ss.firebase_uid = sc.firebase_uid
        WHERE ss.customer_id = ? AND sc.firebase_uid = ? AND sc.record_status = 'active' AND cc.record_status = 'active'`)
        .bind(id, identity.uid).all<Record<string, unknown>>(),
    ]);
    return {
      customer: indexedCustomer(row), contacts: contacts.results.map(indexedContact),
      sites: sites.results.map((site) => indexedServiceSite(site, siteContacts.results)),
      jobs: jobs.results.map((job: Record<string, unknown>) => indexedJob(job)),
    };
  }
  const row = await db.prepare(`SELECT w.*, d.crm_customer_id, d.service_site_id, d.customer_source, d.pipeline_stage, d.building_type, d.description,
    d.customer_reference, d.next_action, d.tags job_tags, d.estimated_value_cents, d.quoted_value_cents,
    d.invoiced_value_cents, d.paid_value_cents, d.quote_status, d.invoice_status, d.payment_due_at,
    CASE WHEN c.business_name <> '' THEN c.business_name ELSE TRIM(c.first_name || ' ' || c.last_name) END customer_name,
    (SELECT status FROM trade_handover_packs hp WHERE hp.work_order_id = w.id AND hp.firebase_uid = w.firebase_uid ORDER BY hp.updated_at DESC LIMIT 1) handover_status
    FROM trade_work_orders w LEFT JOIN trade_crm_job_details d ON d.work_order_id = w.id AND d.firebase_uid = w.firebase_uid
    LEFT JOIN trade_crm_customers c ON c.id = d.crm_customer_id AND c.firebase_uid = w.firebase_uid
    WHERE w.id = ? AND w.firebase_uid = ? AND w.partner_type = 'installer' AND w.record_status = 'active'`)
    .bind(id, identity.uid).first<Record<string, unknown>>();
  if (!row) throw new Error("JOB_NOT_FOUND");
  const customerId = String(row.crm_customer_id || "");
  const [tasks, appointments, notes, customer, sites, siteContacts] = await Promise.all([
    db.prepare("SELECT * FROM trade_work_order_tasks WHERE work_order_id = ? AND firebase_uid = ? ORDER BY status = 'done', due_at = '', due_at, created_at").bind(id, identity.uid).all<Record<string, unknown>>(),
    db.prepare("SELECT * FROM trade_crm_appointments WHERE work_order_id = ? AND firebase_uid = ? ORDER BY starts_at, created_at").bind(id, identity.uid).all<Record<string, unknown>>(),
    db.prepare("SELECT * FROM trade_crm_job_notes WHERE work_order_id = ? AND firebase_uid = ? ORDER BY created_at DESC LIMIT 200").bind(id, identity.uid).all<Record<string, unknown>>(),
    customerId
      ? db.prepare("SELECT * FROM trade_crm_customers WHERE id = ? AND firebase_uid = ? AND record_status = 'active'")
        .bind(customerId, identity.uid).first<Record<string, unknown>>()
      : Promise.resolve(null),
    customerId
      ? db.prepare("SELECT * FROM trade_crm_service_sites WHERE customer_id = ? AND firebase_uid = ? AND record_status = 'active' ORDER BY is_primary DESC, site_label")
        .bind(customerId, identity.uid).all<Record<string, unknown>>()
      : Promise.resolve({ results: [] as Record<string, unknown>[] }),
    customerId
      ? db.prepare(`SELECT sc.*, TRIM(cc.first_name || ' ' || cc.last_name) contact_name, cc.email, cc.phone
          FROM trade_crm_site_contacts sc JOIN trade_crm_customer_contacts cc
            ON cc.id = sc.customer_contact_id AND cc.firebase_uid = sc.firebase_uid
          JOIN trade_crm_service_sites ss ON ss.id = sc.service_site_id AND ss.firebase_uid = sc.firebase_uid
          WHERE ss.customer_id = ? AND sc.firebase_uid = ? AND sc.record_status = 'active' AND cc.record_status = 'active'`)
        .bind(customerId, identity.uid).all<Record<string, unknown>>()
      : Promise.resolve({ results: [] as Record<string, unknown>[] }),
  ]);
  const job = indexedJob(row);
  return { customer: customer ? indexedCustomer(customer) : null,
    sites: sites.results.map((site: Record<string, unknown>) => indexedServiceSite(site, siteContacts.results)), job: { ...job,
    tasks: tasks.results.map((item: Record<string, unknown>) => ({ id: item.id, title: item.title, dueAt: item.due_at, status: item.status, completedAt: item.completed_at })),
    appointments: appointments.results.map((item: Record<string, unknown>) => ({ id: item.id, appointmentType: item.appointment_type, title: item.title, startsAt: item.starts_at, endsAt: item.ends_at, assigneeLabel: item.assignee_label, status: item.status, notes: item.notes })),
    notes: notes.results.map((item: Record<string, unknown>) => ({ id: item.id, noteType: item.note_type, body: item.body, issueStatus: item.issue_status, createdAt: item.created_at, updatedAt: item.updated_at })),
  } };
}

function activityJob(row: Record<string, unknown>) {
  return {
    id: String(row.work_order_id || ""),
    workNumber: String(row.work_number || ""),
    title: String(row.job_title || ""),
  };
}

async function crmBootstrap(identity: CrmIdentity) {
  const db = getD1();
  const [templateRows, memberRows] = await Promise.all([
    db.prepare(`SELECT id, name, title, service_category, priority, description, task_titles, created_at, updated_at
      FROM trade_crm_job_templates WHERE firebase_uid = ? AND record_status = 'active'
      ORDER BY name COLLATE NOCASE LIMIT 60`).bind(identity.uid).all<Record<string, unknown>>(),
    db.prepare(`SELECT id, display_name, role, status, member_uid FROM trade_team_members
      WHERE owner_uid = ? AND status IN ('active', 'invited')
      ORDER BY member_uid = ? DESC, status = 'active' DESC, display_name COLLATE NOCASE`)
      .bind(identity.uid, identity.uid).all<Record<string, unknown>>(),
  ]);
  return {
    teamAccess: identity.teamAccess,
    teamMembers: memberRows.results
      .filter((row) => identity.teamAccess || row.id === identity.memberId)
      .map((row) => ({ id: row.id, displayName: row.display_name, role: row.role, status: row.status, isOwner: row.id === identity.memberId })),
    templates: templateRows.results.map((row: Record<string, unknown>) => ({
      id: row.id, name: row.name, title: row.title, serviceCategory: row.service_category,
      priority: row.priority, description: row.description, taskTitles: storedList(row.task_titles, 24),
      createdAt: row.created_at, updatedAt: row.updated_at,
    })),
  };
}

async function crmSummary(identity: CrmIdentity) {
  const db = getD1();
  const today = australiaLocalDateTime(identity.addressState).slice(0, 10);
  const chartStart = summaryWeekStart(today);
  const weekStarts = Array.from({ length: 4 }, (_, index) => addSummaryDays(chartStart, index * 7));
  const chartEnd = addSummaryDays(chartStart, 28);
  const [jobMetrics, financialMetrics, visitCount, todayVisitCount, awaitingScheduleCount, overdueCount, issueCount, appointments, overdueTasks, openIssues, workloadAppointments, workStageRows] = await Promise.all([
    db.prepare(`SELECT
      SUM(CASE WHEN stage NOT IN ('completed', 'cancelled') THEN 1 ELSE 0 END) open_jobs,
      SUM(CASE WHEN stage = 'blocked' THEN 1 ELSE 0 END) waiting_jobs,
      SUM(CASE WHEN stage = 'completed' THEN 1 ELSE 0 END) completed_jobs
      FROM trade_work_orders WHERE firebase_uid = ? AND partner_type = 'installer' AND record_status = 'active'`)
      .bind(identity.uid).first<Record<string, unknown>>(),
    db.prepare(`SELECT
      COALESCE(SUM(d.quoted_value_cents), 0) quoted_cents,
      COALESCE(SUM(d.invoiced_value_cents), 0) invoiced_cents,
      COALESCE(SUM(d.paid_value_cents), 0) paid_cents,
      COALESCE(SUM(CASE WHEN d.invoiced_value_cents > d.paid_value_cents THEN d.invoiced_value_cents - d.paid_value_cents ELSE 0 END), 0) outstanding_cents
      FROM trade_crm_job_details d JOIN trade_work_orders w ON w.id = d.work_order_id AND w.firebase_uid = d.firebase_uid
      WHERE d.firebase_uid = ? AND w.partner_type = 'installer' AND w.record_status = 'active'`).bind(identity.uid).first<Record<string, unknown>>(),
    db.prepare(`SELECT COUNT(*) total FROM trade_crm_appointments a JOIN trade_work_orders w ON w.id = a.work_order_id AND w.firebase_uid = a.firebase_uid
      WHERE a.firebase_uid = ? AND w.record_status = 'active' AND a.status IN ('scheduled', 'en_route', 'arrived', 'in_progress') AND SUBSTR(a.starts_at, 1, 10) >= ?`)
      .bind(identity.uid, today).first<Record<string, unknown>>(),
    db.prepare(`SELECT COUNT(*) total FROM trade_crm_appointments a JOIN trade_work_orders w ON w.id = a.work_order_id AND w.firebase_uid = a.firebase_uid
      WHERE a.firebase_uid = ? AND w.partner_type = 'installer' AND w.record_status = 'active'
      AND a.status IN ('scheduled', 'en_route', 'arrived', 'in_progress') AND SUBSTR(a.starts_at, 1, 10) = ?`)
      .bind(identity.uid, today).first<Record<string, unknown>>(),
    db.prepare(`SELECT COUNT(*) total FROM trade_work_orders w
      WHERE w.firebase_uid = ? AND w.partner_type = 'installer' AND w.record_status = 'active'
      AND w.stage NOT IN ('completed', 'cancelled')
      AND NOT EXISTS (SELECT 1 FROM trade_crm_appointments a
        WHERE a.firebase_uid = w.firebase_uid AND a.work_order_id = w.id
        AND a.status IN ('scheduled', 'en_route', 'arrived', 'in_progress') AND SUBSTR(a.starts_at, 1, 10) >= ?)`)
      .bind(identity.uid, today).first<Record<string, unknown>>(),
    db.prepare(`SELECT COUNT(*) total FROM trade_work_order_tasks t JOIN trade_work_orders w ON w.id = t.work_order_id AND w.firebase_uid = t.firebase_uid
      WHERE t.firebase_uid = ? AND w.record_status = 'active' AND t.status = 'pending' AND t.due_at <> '' AND t.due_at < ?`)
      .bind(identity.uid, today).first<Record<string, unknown>>(),
    db.prepare(`SELECT COUNT(*) total FROM trade_crm_job_notes n JOIN trade_work_orders w ON w.id = n.work_order_id AND w.firebase_uid = n.firebase_uid
      WHERE n.firebase_uid = ? AND w.record_status = 'active' AND n.note_type = 'issue' AND n.issue_status = 'open'`)
      .bind(identity.uid).first<Record<string, unknown>>(),
    db.prepare(`SELECT a.*, w.id work_order_id, w.work_number, w.title job_title
      FROM trade_crm_appointments a JOIN trade_work_orders w ON w.id = a.work_order_id AND w.firebase_uid = a.firebase_uid
      WHERE a.firebase_uid = ? AND w.record_status = 'active' AND a.status IN ('scheduled', 'en_route', 'arrived', 'in_progress') AND SUBSTR(a.starts_at, 1, 10) >= ?
      ORDER BY a.starts_at, a.created_at LIMIT 6`).bind(identity.uid, today).all<Record<string, unknown>>(),
    db.prepare(`SELECT t.*, w.id work_order_id, w.work_number, w.title job_title
      FROM trade_work_order_tasks t JOIN trade_work_orders w ON w.id = t.work_order_id AND w.firebase_uid = t.firebase_uid
      WHERE t.firebase_uid = ? AND w.record_status = 'active' AND t.status = 'pending' AND t.due_at <> '' AND t.due_at < ?
      ORDER BY t.due_at, t.created_at LIMIT 4`).bind(identity.uid, today).all<Record<string, unknown>>(),
    db.prepare(`SELECT n.*, w.id work_order_id, w.work_number, w.title job_title
      FROM trade_crm_job_notes n JOIN trade_work_orders w ON w.id = n.work_order_id AND w.firebase_uid = n.firebase_uid
      WHERE n.firebase_uid = ? AND w.record_status = 'active' AND n.note_type = 'issue' AND n.issue_status = 'open'
      ORDER BY n.updated_at DESC LIMIT 4`).bind(identity.uid).all<Record<string, unknown>>(),
    db.prepare(`SELECT a.starts_at, a.ends_at
      FROM trade_crm_appointments a JOIN trade_work_orders w ON w.id = a.work_order_id AND w.firebase_uid = a.firebase_uid
      WHERE a.firebase_uid = ? AND w.partner_type = 'installer' AND w.record_status = 'active'
      AND a.status IN ('scheduled', 'en_route', 'arrived', 'in_progress')
      AND SUBSTR(a.starts_at, 1, 10) >= ? AND SUBSTR(a.starts_at, 1, 10) < ?
      ORDER BY a.starts_at`).bind(identity.uid, chartStart, chartEnd).all<Record<string, unknown>>(),
    db.prepare(`SELECT w.stage, COUNT(*) total FROM trade_work_orders w
      WHERE w.firebase_uid = ? AND w.partner_type = 'installer' AND w.record_status = 'active'
      AND w.stage NOT IN ('completed', 'cancelled') GROUP BY w.stage`)
      .bind(identity.uid).all<Record<string, unknown>>(),
  ]);
  const workload = weekStarts.map((weekStart) => ({
    weekStart,
    weekEnd: addSummaryDays(weekStart, 6),
    visits: 0,
    bookedMinutes: 0,
  }));
  for (const appointment of workloadAppointments.results) {
    const appointmentDate = String(appointment.starts_at || "").slice(0, 10);
    const bucket = workload.find((item) => appointmentDate >= item.weekStart && appointmentDate <= item.weekEnd);
    if (!bucket) continue;
    bucket.visits += 1;
    bucket.bookedMinutes += summaryBookedMinutes(appointment.starts_at, appointment.ends_at);
  }
  return {
    metrics: {
      openJobs: Number(jobMetrics?.open_jobs || 0), nextVisits: Number(visitCount?.total || 0),
      todayVisits: Number(todayVisitCount?.total || 0), awaitingSchedule: Number(awaitingScheduleCount?.total || 0),
      overdueTasks: Number(overdueCount?.total || 0), openIssues: Number(issueCount?.total || 0),
      waitingJobs: Number(jobMetrics?.waiting_jobs || 0), completedJobs: Number(jobMetrics?.completed_jobs || 0),
      quotedCents: Number(financialMetrics?.quoted_cents || 0), invoicedCents: Number(financialMetrics?.invoiced_cents || 0),
      paidCents: Number(financialMetrics?.paid_cents || 0), outstandingCents: Number(financialMetrics?.outstanding_cents || 0),
    },
    workload,
    workStages: Object.fromEntries(workStageRows.results.map((row: Record<string, unknown>) => [String(row.stage), Number(row.total || 0)])),
    upcomingAppointments: appointments.results.map((row: Record<string, unknown>) => ({
      id: row.id, appointmentType: row.appointment_type, title: row.title, startsAt: row.starts_at,
      endsAt: row.ends_at, assigneeLabel: row.assignee_label, status: row.status, notes: row.notes, job: activityJob(row),
    })),
    overdueTasks: overdueTasks.results.map((row: Record<string, unknown>) => ({
      id: row.id, title: row.title, dueAt: row.due_at, status: row.status, completedAt: row.completed_at, job: activityJob(row),
    })),
    openIssues: openIssues.results.map((row: Record<string, unknown>) => ({
      id: row.id, noteType: row.note_type, body: row.body, issueStatus: row.issue_status,
      createdAt: row.created_at, updatedAt: row.updated_at, job: activityJob(row),
    })),
  };
}

async function crmSchedule(identity: CrmIdentity, url: URL) {
  const db = getD1();
  const today = new Date().toISOString().slice(0, 10);
  const { page, pageSize } = pagination(url);
  const includeTotal = url.searchParams.get("total") !== "0";
  const cursorInput = cleanAdminText(url.searchParams.get("cursor"), 2000);
  let cursor;
  try { cursor = decodeKeysetCursor(cursorInput, "schedule:starts-asc", SCHEDULE_SORT.terms.length); } catch { throw new Error("INVALID_CURSOR"); }
  if (page > 1 && !cursor) throw new Error("INVALID_CURSOR");
  const cursorWhere = cursor ? keysetAfter(SCHEDULE_SORT.terms, cursor) : null;
  const [countRow, rows] = await Promise.all([
    includeTotal ? db.prepare(`SELECT COUNT(*) total FROM trade_crm_appointments a JOIN trade_work_orders w ON w.id = a.work_order_id AND w.firebase_uid = a.firebase_uid
      WHERE a.firebase_uid = ? AND w.record_status = 'active' AND a.status IN ('scheduled', 'en_route', 'arrived', 'in_progress') AND SUBSTR(a.starts_at, 1, 10) >= ?`)
      .bind(identity.uid, today).first<Record<string, unknown>>() : Promise.resolve(null),
    db.prepare(`SELECT a.*, w.id work_order_id, w.work_number, w.title job_title
      FROM trade_crm_appointments a JOIN trade_work_orders w ON w.id = a.work_order_id AND w.firebase_uid = a.firebase_uid
      WHERE a.firebase_uid = ? AND w.record_status = 'active' AND a.status IN ('scheduled', 'en_route', 'arrived', 'in_progress') AND SUBSTR(a.starts_at, 1, 10) >= ?
      ${cursorWhere ? `AND (${cursorWhere.sql})` : ""}
      ORDER BY ${SCHEDULE_SORT.orderBy} LIMIT ?`).bind(identity.uid, today, ...(cursorWhere?.bindings || []), pageSize + 1).all<Record<string, unknown>>(),
  ]);
  const total = countRow ? Number(countRow.total || 0) : undefined;
  const hasNext = rows.results.length > pageSize; const pageRows = rows.results.slice(0, pageSize);
  const nextCursor = hasNext && pageRows.length ? encodeKeysetCursor("schedule:starts-asc", SCHEDULE_SORT.terms.map((item) => String(pageRows.at(-1)![item.rowKey] || ""))) : "";
  return {
    items: pageRows.map((row: Record<string, unknown>) => ({
      id: row.id, appointmentType: row.appointment_type, title: row.title, startsAt: row.starts_at,
      endsAt: row.ends_at, assigneeLabel: row.assignee_label, status: row.status, notes: row.notes, job: activityJob(row),
    })),
    pagination: { page, pageSize, total, pageCount: total === undefined ? undefined : Math.max(1, Math.ceil(total / pageSize)), hasNext, nextCursor },
  };
}

async function crmReports(identity: CrmIdentity) {
  const db = getD1();
  const [summary, pipelineRows] = await Promise.all([
    crmSummary(identity),
    db.prepare(`SELECT COALESCE(d.pipeline_stage, CASE WHEN w.source_type = 'opportunity' THEN 'qualifying' ELSE 'enquiry' END) stage, COUNT(*) total
      FROM trade_work_orders w LEFT JOIN trade_crm_job_details d ON d.work_order_id = w.id AND d.firebase_uid = w.firebase_uid
      WHERE w.firebase_uid = ? AND w.partner_type = 'installer' AND w.record_status = 'active'
      GROUP BY COALESCE(d.pipeline_stage, CASE WHEN w.source_type = 'opportunity' THEN 'qualifying' ELSE 'enquiry' END)`)
      .bind(identity.uid).all<Record<string, unknown>>(),
  ]);
  return { metrics: summary.metrics, pipeline: Object.fromEntries(pipelineRows.results.map((row: Record<string, unknown>) => [String(row.stage), Number(row.total || 0)])) };
}

async function ownedJob(db: D1Database, identity: CrmIdentity, workOrderId: string) {
  const job = await db.prepare(`SELECT w.id, w.source_type, w.service_category, w.assignee_member_id, w.revision,
      c.customer_number, c.business_name, c.first_name, c.last_name
    FROM trade_work_orders w
    LEFT JOIN trade_crm_job_details d ON d.work_order_id = w.id AND d.firebase_uid = w.firebase_uid
    LEFT JOIN trade_crm_customers c ON c.id = d.crm_customer_id AND c.firebase_uid = w.firebase_uid
    WHERE w.id = ? AND w.firebase_uid = ? AND w.partner_type = 'installer' AND w.record_status = 'active'`)
    .bind(workOrderId, identity.uid).first<Record<string, unknown>>();
  if (!job) throw new Error("JOB_NOT_FOUND");
  return job;
}

async function ownedCustomer(db: D1Database, identity: CrmIdentity, customerId: string) {
  const customer = await db.prepare("SELECT * FROM trade_crm_customers WHERE id = ? AND firebase_uid = ? AND record_status = 'active'")
    .bind(customerId, identity.uid).first<Record<string, unknown>>();
  if (!customer) throw new Error("CUSTOMER_NOT_FOUND");
  return customer;
}

async function ownedContact(db: D1Database, identity: CrmIdentity, contactId: string, customerId = "") {
  const contact = await db.prepare(`SELECT * FROM trade_crm_customer_contacts
    WHERE id = ? AND firebase_uid = ? AND record_status = 'active' AND (? = '' OR customer_id = ?)`)
    .bind(contactId, identity.uid, customerId, customerId).first<Record<string, unknown>>();
  if (!contact) throw new Error("CONTACT_NOT_FOUND");
  return contact;
}

async function ownedServiceSite(db: D1Database, identity: CrmIdentity, siteId: string, customerId = "") {
  const site = await db.prepare(`SELECT * FROM trade_crm_service_sites
    WHERE id = ? AND firebase_uid = ? AND record_status = 'active' AND (? = '' OR customer_id = ?)`)
    .bind(siteId, identity.uid, customerId, customerId).first<Record<string, unknown>>();
  if (!site) throw new Error("SERVICE_SITE_NOT_FOUND");
  return site;
}

export async function GET(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const identity = await crmIdentity(request);
    const url = new URL(request.url);
    const mode = cleanAdminText(url.searchParams.get("mode"), 20);
    const resource = cleanAdminText(url.searchParams.get("resource"), 20);
    if (mode === "bootstrap") return adminJson({ ok: true, ...(await crmBootstrap(identity)) });
    if (mode === "summary") return adminJson({ ok: true, ...(await crmSummary(identity)) });
    if (mode === "schedule") {
      const db = getD1(); const timer = routeTimer(); const result = await timer.database(crmSchedule(identity, url));
      return performanceJson({ ok: true, ...result }, { db, routeKey: "trade.crm.schedule", startedAt: timer.startedAt, dbDurationMs: timer.dbDurationMs,
        resultCount: result.items.length, cursorUsed: Boolean(url.searchParams.get("cursor")) });
    }
    if (mode === "reports") return adminJson({ ok: true, ...(await crmReports(identity)) });
    if (mode === "index" && ["jobs", "customers"].includes(resource)) {
      const db = getD1(); const timer = routeTimer(); const result = await timer.database(crmIndex(identity, url, resource));
      return performanceJson({ ok: true, ...result }, { db, routeKey: `trade.crm.${resource}`, startedAt: timer.startedAt, dbDurationMs: timer.dbDurationMs,
        resultCount: result.items.length, cursorUsed: Boolean(url.searchParams.get("cursor")) });
    }
    if (mode === "detail" && ["job", "customer"].includes(resource)) {
      const id = cleanAdminText(url.searchParams.get("id"), 180);
      if (!id) return adminJson({ ok: false, error: "Choose a CRM record." }, 400);
      return adminJson({ ok: true, ...(await crmDetail(identity, resource, id)) });
    }
    return adminJson({ ok: true, ...(await crmBootstrap(identity)) });
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

    if (action === "create_template") {
      const templateCount = await db.prepare("SELECT COUNT(*) count FROM trade_crm_job_templates WHERE firebase_uid = ? AND record_status = 'active'")
        .bind(identity.uid).first<Record<string, unknown>>();
      if (Number(templateCount?.count || 0) >= CRM_TEMPLATE_LIMIT) return adminJson({ ok: false, error: "This workspace has reached its 60-template fair-use limit." }, 409);
      const name = cleanAdminText(body.name, 100);
      if (!name) return adminJson({ ok: false, error: "Add a clear template name." }, 400);
      const serviceCategory = SERVICE_CATEGORIES.has(cleanAdminText(body.serviceCategory, 60)) ? cleanAdminText(body.serviceCategory, 60) : "other";
      const priority = PRIORITIES.has(cleanAdminText(body.priority, 20)) ? cleanAdminText(body.priority, 20) : "standard";
      try {
        await db.prepare(`INSERT INTO trade_crm_job_templates
          (id, firebase_uid, name, title, service_category, priority, description, task_titles, record_status, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`)
          .bind(crypto.randomUUID(), identity.uid, name, cleanAdminText(body.title, 160), serviceCategory, priority,
            cleanAdminText(body.description, 3000), JSON.stringify(cleanTemplateTasks(body.taskTitles)), now, now).run();
      } catch { return adminJson({ ok: false, error: "A template with this name already exists." }, 409); }
      return adminJson({ ok: true }, 201);
    }

    if (action === "find_customer_duplicates") {
      const duplicateCandidates = await findDirectCustomerDuplicates(db, identity.uid, {
        email: cleanAdminText(body.email, 180).toLowerCase(),
        phone: cleanAdminText(body.phone, 40),
        businessNumber: cleanAdminText(body.businessNumber, 30),
        addressLine1: cleanAdminText(body.addressLine1, 140),
        suburb: cleanAdminText(body.suburb, 80),
        addressState: cleanAdminText(body.addressState, 10).toUpperCase(),
        postcode: cleanAdminText(body.postcode, 12),
      });
      return adminJson({ ok: true, duplicateCandidates });
    }

    if (action === "create_customer") {
      const customerCount = await db.prepare("SELECT COUNT(*) count FROM trade_crm_customers WHERE firebase_uid = ? AND record_status = 'active'")
        .bind(identity.uid).first<Record<string, unknown>>();
      if (Number(customerCount?.count || 0) >= CRM_CUSTOMER_LIMIT) throw new Error("CUSTOMER_LIMIT_REACHED");
      const customerType = CUSTOMER_TYPES.has(cleanAdminText(body.customerType, 20)) ? cleanAdminText(body.customerType, 20) : "residential";
      const firstName = cleanAdminText(body.firstName, 80);
      const lastName = cleanAdminText(body.lastName, 80);
      const businessName = cleanAdminText(body.businessName, 140);
      const businessNumber = cleanAdminText(body.businessNumber, 30);
      const email = cleanAdminText(body.email, 180).toLowerCase();
      const phone = cleanAdminText(body.phone, 40);
      if (customerType === "business" ? !businessName : !firstName && !lastName) {
        return adminJson({ ok: false, error: customerType === "business" ? "Add the business name." : "Add the customer name." }, 400);
      }
      if (email && !EMAIL_PATTERN.test(email)) return adminJson({ ok: false, error: "Check the customer email address." }, 400);
      const id = crypto.randomUUID();
      const contactId = crypto.randomUUID();
      const siteId = crypto.randomUUID();
      const customerNumber = `CUS-${now.slice(2, 7).replace("-", "")}-${id.replaceAll("-", "").slice(0, 5).toUpperCase()}`;
      const addressLine1 = cleanAdminText(body.addressLine1, 140);
      const addressLine2 = cleanAdminText(body.addressLine2, 140);
      const suburb = cleanAdminText(body.suburb, 80);
      const addressState = cleanAdminText(body.addressState, 20).toUpperCase();
      const postcode = cleanAdminText(body.postcode, 12);
      await db.batch([db.prepare(`INSERT INTO trade_crm_customers
        (id, firebase_uid, customer_number, customer_type, first_name, last_name, business_name, business_number, email,
         phone, address_line_1, address_line_2, suburb, address_state, postcode, tags, private_notes,
         record_status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`)
        .bind(id, identity.uid, customerNumber, customerType, firstName, lastName, businessName, businessNumber, email,
          phone, addressLine1, addressLine2, suburb, addressState, postcode,
          JSON.stringify(cleanList(body.tags)), cleanAdminText(body.privateNotes, 2000), now, now),
        db.prepare(`INSERT INTO trade_crm_customer_contacts
          (id, firebase_uid, customer_id, first_name, last_name, role_label, email, phone, is_primary, record_status, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, 'Primary contact', ?, ?, 1, 'active', ?, ?)`)
          .bind(contactId, identity.uid, id, firstName, lastName, email, phone, now, now),
        db.prepare(`INSERT INTO trade_crm_service_sites
          (id, firebase_uid, customer_id, site_label, address_line_1, address_line_2, suburb, address_state, postcode,
           access_instructions, parking_instructions, hazard_notes, is_primary, record_status, created_at, updated_at)
          VALUES (?, ?, ?, 'Primary site', ?, ?, ?, ?, ?, '', '', '', 1, 'active', ?, ?)`)
          .bind(siteId, identity.uid, id, addressLine1, addressLine2, suburb, addressState, postcode, now, now),
        db.prepare(`INSERT INTO trade_crm_site_contacts
          (id, firebase_uid, service_site_id, customer_contact_id, role_label, is_primary, record_status, created_at, updated_at)
          VALUES (?, ?, ?, ?, 'Primary service contact', 1, 'active', ?, ?)`)
          .bind(crypto.randomUUID(), identity.uid, siteId, contactId, now, now),
      ]);
      return adminJson({ ok: true, id, customerNumber }, 201);
    }

    if (action === "create_customer_contact") {
      const customerId = cleanAdminText(body.customerId, 180);
      await ownedCustomer(db, identity, customerId);
      const firstName = cleanAdminText(body.firstName, 80);
      const lastName = cleanAdminText(body.lastName, 80);
      const email = cleanAdminText(body.email, 180).toLowerCase();
      const phone = cleanAdminText(body.phone, 40);
      if (!firstName && !lastName) return adminJson({ ok: false, error: "Add the contact name." }, 400);
      if (email && !EMAIL_PATTERN.test(email)) return adminJson({ ok: false, error: "Check the contact email address." }, 400);
      const contactId = crypto.randomUUID();
      const siteId = cleanAdminText(body.serviceSiteId, 180);
      if (siteId) await ownedServiceSite(db, identity, siteId, customerId);
      const statements = [db.prepare(`INSERT INTO trade_crm_customer_contacts
        (id, firebase_uid, customer_id, first_name, last_name, role_label, email, phone, is_primary, record_status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 'active', ?, ?)`)
        .bind(contactId, identity.uid, customerId, firstName, lastName, cleanAdminText(body.roleLabel, 80), email, phone, now, now)];
      if (siteId) statements.push(db.prepare(`INSERT INTO trade_crm_site_contacts
        (id, firebase_uid, service_site_id, customer_contact_id, role_label, is_primary, record_status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 0, 'active', ?, ?)`)
        .bind(crypto.randomUUID(), identity.uid, siteId, contactId, cleanAdminText(body.siteRoleLabel, 80) || "Service contact", now, now));
      await db.batch(statements);
      return adminJson({ ok: true, id: contactId }, 201);
    }

    if (action === "create_service_site") {
      const customerId = cleanAdminText(body.customerId, 180);
      await ownedCustomer(db, identity, customerId);
      const siteLabel = cleanAdminText(body.siteLabel, 100);
      if (!siteLabel) return adminJson({ ok: false, error: "Add a clear site name." }, 400);
      const siteId = crypto.randomUUID();
      const contactId = cleanAdminText(body.customerContactId, 180);
      if (contactId) await ownedContact(db, identity, contactId, customerId);
      const statements = [db.prepare(`INSERT INTO trade_crm_service_sites
        (id, firebase_uid, customer_id, site_label, address_line_1, address_line_2, suburb, address_state, postcode,
         access_instructions, parking_instructions, hazard_notes, is_primary, record_status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'active', ?, ?)`)
        .bind(siteId, identity.uid, customerId, siteLabel, cleanAdminText(body.addressLine1, 140), cleanAdminText(body.addressLine2, 140),
          cleanAdminText(body.suburb, 80), cleanAdminText(body.addressState, 20).toUpperCase(), cleanAdminText(body.postcode, 12),
          cleanAdminText(body.accessInstructions, 2000), cleanAdminText(body.parkingInstructions, 1000), cleanAdminText(body.hazardNotes, 2000), now, now)];
      if (contactId) statements.push(db.prepare(`INSERT INTO trade_crm_site_contacts
        (id, firebase_uid, service_site_id, customer_contact_id, role_label, is_primary, record_status, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'Service contact', 0, 'active', ?, ?)`)
        .bind(crypto.randomUUID(), identity.uid, siteId, contactId, now, now));
      await db.batch(statements);
      return adminJson({ ok: true, id: siteId }, 201);
    }

    if (action === "link_site_contact") {
      const customerId = cleanAdminText(body.customerId, 180);
      const siteId = cleanAdminText(body.serviceSiteId, 180);
      const contactId = cleanAdminText(body.customerContactId, 180);
      await ownedCustomer(db, identity, customerId);
      await ownedServiceSite(db, identity, siteId, customerId);
      await ownedContact(db, identity, contactId, customerId);
      try {
        await db.prepare(`INSERT INTO trade_crm_site_contacts
          (id, firebase_uid, service_site_id, customer_contact_id, role_label, is_primary, record_status, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, 0, 'active', ?, ?)`)
          .bind(crypto.randomUUID(), identity.uid, siteId, contactId, cleanAdminText(body.roleLabel, 80) || "Service contact", now, now).run();
      } catch { return adminJson({ ok: false, error: "This contact is already assigned to the site." }, 409); }
      return adminJson({ ok: true }, 201);
    }

    if (action === "create_job" || action === "create_scheduled_job") {
      const guided = action === "create_scheduled_job";
      const activeJobs = await db.prepare(`SELECT COUNT(*) count FROM trade_work_orders
        WHERE firebase_uid = ? AND partner_type = 'installer' AND record_status = 'active' AND stage NOT IN ('completed', 'cancelled')`)
        .bind(identity.uid).first<Record<string, unknown>>();
      if (Number(activeJobs?.count || 0) >= MEMBER_ACTIVE_JOB_LIMIT) throw new Error("JOB_LIMIT_REACHED");
      let customerId = cleanAdminText(body.crmCustomerId, 180);
      let serviceSiteId = cleanAdminText(body.serviceSiteId, 180);
      let existingCustomer: Record<string, unknown> | null = null;
      const customerMode = cleanAdminText(body.customerMode, 20);
      const serviceSiteMode = cleanAdminText(body.serviceSiteMode, 20);
      const createCustomer = customerMode === "new";
      const firstName = cleanAdminText(body.firstName, 80);
      const lastName = cleanAdminText(body.lastName, 80);
      const businessName = cleanAdminText(body.businessName, 140);
      const businessNumber = cleanAdminText(body.businessNumber, 30);
      const customerType = CUSTOMER_TYPES.has(cleanAdminText(body.customerType, 20)) ? cleanAdminText(body.customerType, 20) : "residential";
      const email = cleanAdminText(body.email, 180).toLowerCase();
      const phone = cleanAdminText(body.phone, 40);
      const siteLabel = cleanAdminText(body.siteLabel, 100) || "Primary site";
      const addressLine1 = cleanAdminText(body.addressLine1, 140);
      const addressLine2 = cleanAdminText(body.addressLine2, 140);
      const suburb = cleanAdminText(body.suburb, 80);
      const addressState = cleanAdminText(body.addressState, 10).toUpperCase();
      const postcode = cleanAdminText(body.postcode, 12);
      const intakeStatements: D1PreparedStatement[] = [];
      if (createCustomer) {
        const customerCount = await db.prepare("SELECT COUNT(*) count FROM trade_crm_customers WHERE firebase_uid = ? AND record_status = 'active'")
          .bind(identity.uid).first<Record<string, unknown>>();
        if (Number(customerCount?.count || 0) >= CRM_CUSTOMER_LIMIT) throw new Error("CUSTOMER_LIMIT_REACHED");
        if (customerType === "business" ? !businessName : !firstName && !lastName) return adminJson({ ok: false, error: customerType === "business" ? "Add the business name." : "Add the customer name." }, 400);
        if (email && !EMAIL_PATTERN.test(email)) return adminJson({ ok: false, error: "Check the customer email address." }, 400);
        if (!addressLine1 || !suburb || !ADDRESS_STATES.has(addressState) || !/^\d{4}$/.test(postcode)) return adminJson({ ok: false, error: "Add the service street, suburb, state and four-digit postcode." }, 400);
        const duplicateCandidates = await findDirectCustomerDuplicates(db, identity.uid, { email, phone, businessNumber, addressLine1, suburb, addressState, postcode });
        const duplicateOverride = body.duplicateOverride === true || body.duplicateOverride === "true" || body.duplicateOverride === "on";
        if (duplicateCandidates.length && !duplicateOverride) return adminJson({ ok: false, error: "A matching customer already exists. Select that customer or review the match before continuing.", duplicateCandidates }, 409);
        customerId = crypto.randomUUID(); serviceSiteId = crypto.randomUUID();
        const contactId = crypto.randomUUID();
        const customerNumber = `CUS-${now.slice(2, 7).replace("-", "")}-${customerId.replaceAll("-", "").slice(0, 5).toUpperCase()}`;
        intakeStatements.push(
          db.prepare(`INSERT INTO trade_crm_customers
            (id, firebase_uid, customer_number, customer_type, first_name, last_name, business_name, business_number, email, phone,
             address_line_1, address_line_2, suburb, address_state, postcode, tags, private_notes, record_status, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', '', 'active', ?, ?)`)
            .bind(customerId, identity.uid, customerNumber, customerType, firstName, lastName, businessName, businessNumber, email, phone, addressLine1, addressLine2, suburb, addressState, postcode, now, now),
          db.prepare(`INSERT INTO trade_crm_customer_contacts
            (id, firebase_uid, customer_id, first_name, last_name, role_label, email, phone, is_primary, record_status, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, 'Primary contact', ?, ?, 1, 'active', ?, ?)`)
            .bind(contactId, identity.uid, customerId, firstName, lastName, email, phone, now, now),
          db.prepare(`INSERT INTO trade_crm_service_sites
            (id, firebase_uid, customer_id, site_label, address_line_1, address_line_2, suburb, address_state, postcode,
             access_instructions, parking_instructions, hazard_notes, is_primary, record_status, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '', '', '', 1, 'active', ?, ?)`)
            .bind(serviceSiteId, identity.uid, customerId, siteLabel, addressLine1, addressLine2, suburb, addressState, postcode, now, now),
          db.prepare(`INSERT INTO trade_crm_site_contacts
            (id, firebase_uid, service_site_id, customer_contact_id, role_label, is_primary, record_status, created_at, updated_at)
            VALUES (?, ?, ?, ?, 'Primary service contact', 1, 'active', ?, ?)`)
            .bind(crypto.randomUUID(), identity.uid, serviceSiteId, contactId, now, now),
        );
      }
      if (customerId) {
        if (!createCustomer) existingCustomer = await ownedCustomer(db, identity, customerId);
        if (!createCustomer && serviceSiteMode === "new") {
          if (!addressLine1 || !suburb || !ADDRESS_STATES.has(addressState) || !/^\d{4}$/.test(postcode)) return adminJson({ ok: false, error: "Add the service street, suburb, state and four-digit postcode." }, 400);
          serviceSiteId = crypto.randomUUID();
          intakeStatements.push(db.prepare(`INSERT INTO trade_crm_service_sites
            (id, firebase_uid, customer_id, site_label, address_line_1, address_line_2, suburb, address_state, postcode,
             access_instructions, parking_instructions, hazard_notes, is_primary, record_status, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '', '', '', 0, 'active', ?, ?)`)
            .bind(serviceSiteId, identity.uid, customerId, siteLabel, addressLine1, addressLine2, suburb, addressState, postcode, now, now));
        } else if (!serviceSiteId) {
          const primarySite = await db.prepare(`SELECT id FROM trade_crm_service_sites
            WHERE customer_id = ? AND firebase_uid = ? AND record_status = 'active' ORDER BY is_primary DESC, created_at LIMIT 1`)
            .bind(customerId, identity.uid).first<Record<string, unknown>>();
          serviceSiteId = String(primarySite?.id || "");
        }
        if (serviceSiteId && !createCustomer && serviceSiteMode !== "new") await ownedServiceSite(db, identity, serviceSiteId, customerId);
      }
      if (!customerId && serviceSiteId) throw new Error("SERVICE_SITE_NOT_FOUND");
      const templateId = cleanAdminText(body.templateId, 180);
      const template = templateId ? await db.prepare(`SELECT * FROM trade_crm_job_templates
        WHERE id = ? AND firebase_uid = ? AND record_status = 'active'`).bind(templateId, identity.uid).first<Record<string, unknown>>() : null;
      if (templateId && !template) return adminJson({ ok: false, error: "Job template not found." }, 404);
      const requestedCategory = cleanAdminText(body.serviceCategory, 60) || cleanAdminText(template?.service_category, 60);
      const serviceCategory = SERVICE_CATEGORIES.has(requestedCategory) ? requestedCategory : "other";
      const displayName = createCustomer
        ? (businessName || `${firstName} ${lastName}`.trim())
        : existingCustomer ? customerDisplayName(existingCustomer) : "";
      const title = [displayName, SERVICE_LABELS[serviceCategory]].filter(Boolean).join(" ");
      if (!title) return adminJson({ ok: false, error: "Attach a customer before creating the job." }, 400);
      const requestedPriority = cleanAdminText(body.priority, 20) || cleanAdminText(template?.priority, 20);
      const priority = PRIORITIES.has(requestedPriority) ? requestedPriority : "standard";
      const requestedBuildingType = cleanAdminText(body.buildingType, 40);
      const buildingType = BUILDING_TYPES.has(requestedBuildingType) ? requestedBuildingType : "not_sure";
      let scheduledStart = dateValue(body.scheduledStart, true);
      let scheduledEnd = dateValue(body.scheduledEnd, true);
      if (scheduledStart && scheduledEnd && scheduledEnd < scheduledStart) return adminJson({ ok: false, error: "The planned finish cannot be before the planned start." }, 400);
      const workOrderId = crypto.randomUUID();
      const workNumber = await nextTlinkJobNumber(db, now);
      const assigneeMemberId = cleanAdminText(body.assigneeMemberId, 180) || (guided ? identity.memberId : "");
      let assignee = "";
      if (assigneeMemberId) {
        const member = await db.prepare(`SELECT display_name FROM trade_team_members
          WHERE id = ? AND owner_uid = ? AND status IN ('active', 'invited')`)
          .bind(assigneeMemberId, identity.uid).first<Record<string, unknown>>();
        if (!member) return adminJson({ ok: false, error: "Choose an available team member." }, 400);
        assignee = String(member.display_name || "");
      }
      const appointmentType = APPOINTMENT_TYPES.has(cleanAdminText(body.appointmentType, 30)) ? cleanAdminText(body.appointmentType, 30) : "site_visit";
      let appointmentId = "";
      let appointmentTitle = "";
      let photoRequestId = "";
      let photoSecret = "";
      let photoTokenHash = "";
      let encryptedPhotoToken = "";
      let photoRequirements = defaultPhotoRequirements(serviceCategory);
      let quickInvoice: QuickInvoiceDraft | null = null;
      let quickInvoiceId = "";
      let quickInvoiceDueAt = "";
      let quickInvoiceReference = "";
      if (guided) {
        if (!customerId || !serviceSiteId) return adminJson({ ok: false, error: "Attach a customer and service address before scheduling." }, 400);
        scheduledStart = dateValue(body.startsAt);
        if (!scheduledStart) return adminJson({ ok: false, error: "Choose an appointment start." }, 400);
        assertAppointmentSlot(scheduledStart.slice(0, 16));
        assertFutureAppointment(scheduledStart.slice(0, 16), australiaLocalDateTime(identity.addressState));
        try { scheduledEnd = appointmentEndsAt(scheduledStart.slice(0, 16), body.durationMinutes); }
        catch { return adminJson({ ok: false, error: "Choose a duration from 15 minutes to 8 hours in 15-minute steps." }, 400); }
        appointmentId = crypto.randomUUID();
        appointmentTitle = `${displayName} ${SERVICE_LABELS[serviceCategory]}`.trim();
        try {
          const rawRequirements = typeof body.evidenceRequirements === "string"
            ? JSON.parse(body.evidenceRequirements) : body.evidenceRequirements;
          photoRequirements = normalisePhotoRequirements(rawRequirements);
        } catch { return adminJson({ ok: false, error: "Choose at least one evidence request." }, 400); }
        if (body.deliveryConsent !== true && body.deliveryConsent !== "true" && body.deliveryConsent !== "on") {
          return adminJson({ ok: false, error: "Confirm that the customer asked to receive this information request by email." }, 400);
        }
        const deliveryEmail = createCustomer ? email : String(existingCustomer?.email || "").toLowerCase();
        if (!EMAIL_PATTERN.test(deliveryEmail)) return adminJson({ ok: false, error: "Add a valid customer email before requesting information." }, 400);
        photoRequestId = crypto.randomUUID();
        photoSecret = newPhotoRequestSecret();
        photoTokenHash = await hashPhotoRequestSecret(photoSecret);
        encryptedPhotoToken = await encryptProtectedPayload({ requestId: photoRequestId, secret: photoSecret, tokenIssue: 1 });
        if (cleanAdminText(body.invoiceMode, 20) === "send") {
          if (body.quickInvoiceConsent !== true && body.quickInvoiceConsent !== "true" && body.quickInvoiceConsent !== "on") {
            return adminJson({ ok: false, error: "Confirm that the customer asked to receive this invoice by email." }, 400);
          }
          quickInvoice = await resolveQuickInvoiceDraft(identity.uid, body.quickInvoiceLines);
          const dueDays = Number(body.quickInvoiceDueDays);
          if (![0, 7, 14, 30].includes(dueDays)) return adminJson({ ok: false, error: "Choose a valid invoice due date." }, 400);
          quickInvoiceId = crypto.randomUUID();
          quickInvoiceReference = quickInvoiceNumber(workNumber);
          quickInvoiceDueAt = new Date(Date.parse(now) + dueDays * 86_400_000).toISOString().slice(0, 10);
        }
      }
      const templateTasks = template ? cleanTemplateTasks(storedList(template.task_titles, 24)) : [];
      let serviceArea = cleanAdminText(body.siteArea, 80);
      if (serviceSiteId) {
        const site = createCustomer || serviceSiteMode === "new" ? { suburb, address_state: addressState, postcode } : await ownedServiceSite(db, identity, serviceSiteId, customerId);
        serviceArea = [site.suburb, site.address_state, site.postcode].filter(Boolean).join(" ").trim();
      }
      const recordStage = guided ? "scheduled" : "backlog";
      const pipelineStage = guided ? "scheduled" : "enquiry";
      await db.batch([
        ...intakeStatements,
        db.prepare(`INSERT INTO trade_work_orders
          (id, firebase_uid, partner_type, work_type, source_type, source_reference, work_number, title,
           service_category, site_area, stage, priority, scheduled_start, scheduled_end, assignee_member_id, assignee_label,
            record_status, created_at, updated_at)
          VALUES (?, ?, 'installer', 'job', 'internal', '', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`)
          .bind(workOrderId, identity.uid, workNumber, title, serviceCategory, serviceArea,
            recordStage, priority, scheduledStart, scheduledEnd, assigneeMemberId, assignee, now, now),
        db.prepare(`INSERT INTO trade_crm_job_details
          (id, work_order_id, firebase_uid, crm_customer_id, service_site_id, customer_source, pipeline_stage, building_type, description,
           customer_reference, next_action, tags, estimated_value_cents, quoted_value_cents,
           invoiced_value_cents, paid_value_cents, quote_status, invoice_status, payment_due_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 0, 'not_started', ?, ?, ?, ?)`)
          .bind(crypto.randomUUID(), workOrderId, identity.uid, customerId, serviceSiteId, customerId ? "trade_owned" : "internal",
            pipelineStage, buildingType, cleanAdminText(body.description, 3000) || cleanAdminText(template?.description, 3000), "", cleanAdminText(body.nextAction, 200),
            JSON.stringify(cleanList(body.tags)), moneyValue(body.estimatedValueCents), quickInvoice?.totalCents || 0,
            quickInvoice ? "draft" : "not_started", quickInvoiceDueAt, now, now),
        db.prepare(`INSERT INTO trade_work_order_events (id, work_order_id, firebase_uid, event_type, summary, created_at)
          VALUES (?, ?, ?, 'work_created', ?, ?)`).bind(crypto.randomUUID(), workOrderId, identity.uid, `${workNumber} created in installer CRM.`, now),
        ...templateTasks.map((taskTitle, index) => db.prepare(`INSERT INTO trade_work_order_tasks
          (id, work_order_id, firebase_uid, title, due_at, status, completed_at, revision, sort_order, created_at, updated_at)
          VALUES (?, ?, ?, ?, '', 'pending', '', 1, ?, ?, ?)`)
          .bind(crypto.randomUUID(), workOrderId, identity.uid, taskTitle, index, now, now)),
        ...(guided ? [
          db.prepare(`INSERT INTO trade_crm_appointments
            (id, work_order_id, firebase_uid, appointment_type, title, starts_at, ends_at, assignee_member_id, assignee_label,
             status, notes, revision, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'scheduled', ?, 1, ?, ?)`)
            .bind(appointmentId, workOrderId, identity.uid, appointmentType, appointmentTitle, scheduledStart, scheduledEnd,
              assigneeMemberId, assignee, cleanAdminText(body.appointmentNotes, 1000), now, now),
          db.prepare(`INSERT INTO trade_crm_photo_requests
            (id, work_order_id, firebase_uid, crm_customer_id, token_hash, encrypted_token, token_issue, status, requirements, revision,
             expires_at, last_shared_at, source_template_id, source_template_version_id, source_template_version,
             source_template_edited, template_feedback, template_missing_feedback, created_by_uid, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, 1, 'active', ?, 1, ?, ?, '', '', 0, 0, '{}', 0, ?, ?, ?)`)
            .bind(photoRequestId, workOrderId, identity.uid, customerId, photoTokenHash, encryptedPhotoToken,
              JSON.stringify(photoRequirements), photoRequestExpiry(new Date(now)), now, identity.uid, now, now),
          db.prepare(`INSERT INTO trade_crm_photo_request_events
            (id, photo_request_id, work_order_id, firebase_uid, actor_type, actor_uid, event_type, request_revision, created_at)
            VALUES (?, ?, ?, ?, 'installer', ?, 'request_created', 1, ?)`)
            .bind(crypto.randomUUID(), photoRequestId, workOrderId, identity.uid, identity.uid, now),
          db.prepare(`INSERT INTO trade_work_order_events (id, work_order_id, firebase_uid, event_type, summary, created_at)
            VALUES (?, ?, ?, 'customer_photo_request_created', 'Secure customer photo request created.', ?)`)
            .bind(crypto.randomUUID(), workOrderId, identity.uid, now),
          ...(quickInvoice ? [
            db.prepare(`INSERT INTO trade_crm_quick_invoices
              (id, work_order_id, firebase_uid, crm_customer_id, invoice_number, currency, line_items_json,
               subtotal_cents, tax_cents, total_cents, due_at, status, delivery_status, delivery_provider,
               provider_message_id, consent_confirmed_at, attempts, last_error, sent_at, created_by_uid, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, 'AUD', ?, ?, ?, ?, ?, 'draft', 'queued', 'resend', '', ?, 0, '', '', ?, ?, ?)`)
              .bind(quickInvoiceId, workOrderId, identity.uid, customerId, quickInvoiceReference,
                JSON.stringify(quickInvoice.lines), quickInvoice.subtotalCents, quickInvoice.taxCents, quickInvoice.totalCents,
                quickInvoiceDueAt, now, identity.uid, now, now),
            db.prepare(`INSERT INTO trade_crm_quick_invoice_revisions
              (id, invoice_id, firebase_uid, revision, line_items_json, subtotal_cents, tax_cents, total_cents,
               due_at, change_reason, created_by_uid, created_at)
              VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, 'Initial invoice snapshot', ?, ?)`)
              .bind(crypto.randomUUID(), quickInvoiceId, identity.uid, JSON.stringify(quickInvoice.lines), quickInvoice.subtotalCents,
                quickInvoice.taxCents, quickInvoice.totalCents, quickInvoiceDueAt, identity.uid, now),
            db.prepare(`INSERT INTO trade_work_order_events (id, work_order_id, firebase_uid, event_type, summary, created_at)
              VALUES (?, ?, ?, 'quick_invoice_created', ?, ?)`)
              .bind(crypto.randomUUID(), workOrderId, identity.uid, `${quickInvoiceReference} created with the guided job.`, now),
          ] : []),
        ] : []),
        ...jobSyncChangeStatements(db, { ownerUid: identity.uid, workOrderId, revision: 1, changedAt: now }),
      ]);
      let requestSent = false;
      let deliveryError = "";
      let invoiceSent = false;
      let invoiceDeliveryError = "";
      if (guided) {
        try {
          const delivery = await sendPhotoRequestDelivery({ requestId: photoRequestId, ownerUid: identity.uid, actorUid: identity.uid,
            channel: "email", requestedIntent: "initial", consentConfirmed: true, origin: new URL(request.url).origin });
          if (!delivery.ok) throw new Error(String("error" in delivery ? delivery.error : "PHOTO_REQUEST_DELIVERY_FAILED"));
          requestSent = true;
        } catch (error) {
          const code = error instanceof Error ? error.message : "";
          deliveryError = code === "waiting_for_channel"
            ? "The job and appointment were saved, but the email provider is not active. Send the request from the job once email is available."
            : code === "waiting_for_limit" ? "The job and appointment were saved, but the daily email limit was reached. Retry the information request from the job."
              : "The job and appointment were saved, but the information request email could not be sent. Retry it from the job.";
        }
        if (quickInvoice) {
          try {
            await sendQuickInvoiceDelivery({ invoiceId: quickInvoiceId, ownerUid: identity.uid, actorUid: identity.uid, origin: new URL(request.url).origin });
            invoiceSent = true;
          } catch (error) {
            const code = error instanceof Error ? error.message : "";
            invoiceDeliveryError = code === "waiting_for_channel"
              ? "The quick invoice was saved, but the email provider is not active. Retry it from the job invoice tab once email is available."
              : "The quick invoice was saved, but its email could not be sent. Retry it from the job invoice tab.";
          }
        }
      }
      let calendarSynced = 0;
      let calendarFailed = 0;
      if (guided) {
        try {
          const calendarResult = await syncCreatedAppointmentToConnectedCalendars(identity.uid, appointmentId);
          calendarSynced = calendarResult.synced;
          calendarFailed = calendarResult.failed;
        } catch {
          calendarFailed = 1;
        }
      }
      return adminJson({ ok: true, id: workOrderId, workNumber, customerId, serviceSiteId,
        appointmentId, photoRequestId, requestSent, deliveryError, quickInvoiceId, invoiceNumber: quickInvoiceReference,
        invoiceSent, invoiceDeliveryError, calendarSynced, calendarFailed }, 201);
    }

    const workOrderId = cleanAdminText(body.workOrderId, 180);
    const job = await ownedJob(db, identity, workOrderId);
    if (action === "create_appointment") {
      const startsAt = dateValue(body.startsAt);
      let endsAt = "";
      if (!startsAt) return adminJson({ ok: false, error: "Choose an appointment start." }, 400);
      assertAppointmentSlot(startsAt.slice(0, 16));
      assertFutureAppointment(startsAt.slice(0, 16), australiaLocalDateTime(identity.addressState));
      try { endsAt = appointmentEndsAt(startsAt.slice(0, 16), body.durationMinutes); }
      catch { return adminJson({ ok: false, error: "Choose a duration from 15 minutes to 8 hours in 15-minute steps." }, 400); }
      const appointmentType = APPOINTMENT_TYPES.has(cleanAdminText(body.appointmentType, 30)) ? cleanAdminText(body.appointmentType, 30) : "site_visit";
      const assigneeMemberId = cleanAdminText(body.assigneeMemberId, 180) || identity.memberId;
      const member = await db.prepare(`SELECT display_name FROM trade_team_members
        WHERE id = ? AND owner_uid = ? AND status IN ('active', 'invited')`)
        .bind(assigneeMemberId, identity.uid).first<Record<string, unknown>>();
      if (!member) return adminJson({ ok: false, error: "Choose an available team member." }, 400);
      const assignee = String(member.display_name || "");
      const displayName = customerDisplayName(job);
      const appointmentTitle = `${displayName} ${SERVICE_LABELS[String(job.service_category)] || APPOINTMENT_LABELS[appointmentType]}`.trim();
      await db.prepare(`INSERT INTO trade_crm_appointments
        (id, work_order_id, firebase_uid, appointment_type, title, starts_at, ends_at, assignee_member_id, assignee_label,
         status, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'scheduled', ?, ?, ?)`)
        .bind(crypto.randomUUID(), workOrderId, identity.uid, appointmentType,
          appointmentTitle, startsAt, endsAt, assigneeMemberId, assignee,
          cleanAdminText(body.notes, 1000), now, now).run();
      return adminJson({ ok: true }, 201);
    }
    if (action === "create_note") {
      const noteType = NOTE_TYPES.has(cleanAdminText(body.noteType, 20)) ? cleanAdminText(body.noteType, 20) : "internal";
      const noteBody = cleanAdminText(body.body, 4000);
      if (!noteBody) return adminJson({ ok: false, error: "Add a note or issue description." }, 400);
      await db.prepare(`INSERT INTO trade_crm_job_notes
        (id, work_order_id, firebase_uid, note_type, body, issue_status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(crypto.randomUUID(), workOrderId, identity.uid, noteType, noteBody, noteType === "issue" ? "open" : "not_applicable", now, now).run();
      return adminJson({ ok: true }, 201);
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

    if (action === "bulk_set_job_priority") {
      const ids = cleanIds(body.ids);
      const priority = cleanAdminText(body.priority, 20);
      if (!ids.length || !PRIORITIES.has(priority)) return adminJson({ ok: false, error: "Select jobs and choose a valid priority." }, 400);
      const placeholders = ids.map(() => "?").join(",");
      const rows = await db.prepare(`SELECT id, revision, assignee_member_id FROM trade_work_orders
        WHERE firebase_uid = ? AND partner_type = 'installer' AND record_status = 'active' AND id IN (${placeholders})`)
        .bind(identity.uid, ...ids).all<Record<string, unknown>>();
      if (rows.results.length !== ids.length) return adminJson({ ok: false, error: "One or more selected jobs are no longer available." }, 409);
      const statements = [];
      for (const row of rows.results) {
        const workOrderId = String(row.id); const revision = nextJobRevision(row.revision);
        statements.push(db.prepare("UPDATE trade_work_orders SET priority = ?, revision = ?, updated_at = ? WHERE id = ? AND firebase_uid = ?")
          .bind(priority, revision, now, workOrderId, identity.uid));
        statements.push(db.prepare(`INSERT INTO trade_work_order_events (id, work_order_id, firebase_uid, event_type, summary, created_at)
          VALUES (?, ?, ?, 'bulk_priority_updated', ?, ?)`).bind(crypto.randomUUID(), workOrderId, identity.uid, `Priority changed to ${priority}.`, now));
        statements.push(...jobSyncChangeStatements(db, { ownerUid: identity.uid, workOrderId, revision, changedAt: now, audienceMemberId: String(row.assignee_member_id || "") }));
      }
      await db.batch(statements);
      return adminJson({ ok: true, updated: rows.results.length });
    }

    if (action === "bulk_archive_customers") {
      const ids = cleanIds(body.ids);
      if (!ids.length) return adminJson({ ok: false, error: "Select customers to archive." }, 400);
      const placeholders = ids.map(() => "?").join(",");
      const rows = await db.prepare(`SELECT c.id,
        (SELECT COUNT(*) FROM trade_crm_job_details d JOIN trade_work_orders w ON w.id = d.work_order_id
          WHERE d.crm_customer_id = c.id AND d.firebase_uid = c.firebase_uid AND w.record_status = 'active'
            AND w.stage NOT IN ('completed', 'cancelled')) active_jobs
        FROM trade_crm_customers c WHERE c.firebase_uid = ? AND c.record_status = 'active' AND c.id IN (${placeholders})`)
        .bind(identity.uid, ...ids).all<Record<string, unknown>>();
      if (rows.results.length !== ids.length) return adminJson({ ok: false, error: "One or more selected customers are no longer available." }, 409);
      if (rows.results.some((row: Record<string, unknown>) => Number(row.active_jobs || 0) > 0)) {
        return adminJson({ ok: false, error: "Customers with active jobs cannot be archived. Complete or unlink those jobs first." }, 409);
      }
      await db.batch([
        db.prepare(`UPDATE trade_crm_site_contacts SET record_status = 'archived', updated_at = ?
          WHERE firebase_uid = ? AND service_site_id IN (SELECT id FROM trade_crm_service_sites WHERE firebase_uid = ? AND customer_id IN (${placeholders}))`)
          .bind(now, identity.uid, identity.uid, ...ids),
        db.prepare(`UPDATE trade_crm_customer_contacts SET record_status = 'archived', updated_at = ?
          WHERE firebase_uid = ? AND customer_id IN (${placeholders})`).bind(now, identity.uid, ...ids),
        db.prepare(`UPDATE trade_crm_service_sites SET record_status = 'archived', updated_at = ?
          WHERE firebase_uid = ? AND customer_id IN (${placeholders})`).bind(now, identity.uid, ...ids),
        db.prepare(`UPDATE trade_crm_customers SET record_status = 'archived', updated_at = ?
          WHERE firebase_uid = ? AND record_status = 'active' AND id IN (${placeholders})`).bind(now, identity.uid, ...ids),
      ]);
      return adminJson({ ok: true, archived: ids.length });
    }

    if (action === "update_customer_contact") {
      const customerId = cleanAdminText(body.customerId, 180);
      const contactId = cleanAdminText(body.contactId, 180);
      const contact = await ownedContact(db, identity, contactId, customerId);
      const firstName = body.firstName === undefined ? String(contact.first_name) : cleanAdminText(body.firstName, 80);
      const lastName = body.lastName === undefined ? String(contact.last_name) : cleanAdminText(body.lastName, 80);
      const email = body.email === undefined ? String(contact.email) : cleanAdminText(body.email, 180).toLowerCase();
      const phone = body.phone === undefined ? String(contact.phone) : cleanAdminText(body.phone, 40);
      if (!firstName && !lastName) return adminJson({ ok: false, error: "Add the contact name." }, 400);
      if (email && !EMAIL_PATTERN.test(email)) return adminJson({ ok: false, error: "Check the contact email address." }, 400);
      const statements = [db.prepare(`UPDATE trade_crm_customer_contacts
        SET first_name = ?, last_name = ?, role_label = ?, email = ?, phone = ?, updated_at = ?
        WHERE id = ? AND customer_id = ? AND firebase_uid = ? AND record_status = 'active'`)
        .bind(firstName, lastName, body.roleLabel === undefined ? contact.role_label : cleanAdminText(body.roleLabel, 80), email, phone,
          now, contactId, customerId, identity.uid)];
      if (Boolean(contact.is_primary)) statements.push(db.prepare(`UPDATE trade_crm_customers
        SET first_name = ?, last_name = ?, email = ?, phone = ?, updated_at = ? WHERE id = ? AND firebase_uid = ?`)
        .bind(firstName, lastName, email, phone, now, customerId, identity.uid));
      await db.batch(statements);
      return adminJson({ ok: true });
    }

    if (action === "update_service_site") {
      const customerId = cleanAdminText(body.customerId, 180);
      const siteId = cleanAdminText(body.serviceSiteId, 180);
      const site = await ownedServiceSite(db, identity, siteId, customerId);
      const siteLabel = body.siteLabel === undefined ? String(site.site_label) : cleanAdminText(body.siteLabel, 100);
      if (!siteLabel) return adminJson({ ok: false, error: "Add a clear site name." }, 400);
      const values = {
        addressLine1: body.addressLine1 === undefined ? String(site.address_line_1) : cleanAdminText(body.addressLine1, 140),
        addressLine2: body.addressLine2 === undefined ? String(site.address_line_2) : cleanAdminText(body.addressLine2, 140),
        suburb: body.suburb === undefined ? String(site.suburb) : cleanAdminText(body.suburb, 80),
        addressState: body.addressState === undefined ? String(site.address_state) : cleanAdminText(body.addressState, 20).toUpperCase(),
        postcode: body.postcode === undefined ? String(site.postcode) : cleanAdminText(body.postcode, 12),
      };
      const statements = [db.prepare(`UPDATE trade_crm_service_sites SET site_label = ?, address_line_1 = ?, address_line_2 = ?,
        suburb = ?, address_state = ?, postcode = ?, access_instructions = ?, parking_instructions = ?, hazard_notes = ?, updated_at = ?
        WHERE id = ? AND customer_id = ? AND firebase_uid = ? AND record_status = 'active'`)
        .bind(siteLabel, values.addressLine1, values.addressLine2, values.suburb, values.addressState, values.postcode,
          body.accessInstructions === undefined ? site.access_instructions : cleanAdminText(body.accessInstructions, 2000),
          body.parkingInstructions === undefined ? site.parking_instructions : cleanAdminText(body.parkingInstructions, 1000),
          body.hazardNotes === undefined ? site.hazard_notes : cleanAdminText(body.hazardNotes, 2000),
          now, siteId, customerId, identity.uid)];
      if (Boolean(site.is_primary)) statements.push(db.prepare(`UPDATE trade_crm_customers
        SET address_line_1 = ?, address_line_2 = ?, suburb = ?, address_state = ?, postcode = ?, updated_at = ?
        WHERE id = ? AND firebase_uid = ?`)
        .bind(values.addressLine1, values.addressLine2, values.suburb, values.addressState, values.postcode, now, customerId, identity.uid));
      await db.batch(statements);
      return adminJson({ ok: true });
    }

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
      const firstName = body.firstName === undefined ? String(current.first_name) : cleanAdminText(body.firstName, 80);
      const lastName = body.lastName === undefined ? String(current.last_name) : cleanAdminText(body.lastName, 80);
      const phone = body.phone === undefined ? String(current.phone) : cleanAdminText(body.phone, 40);
      const addressLine1 = body.addressLine1 === undefined ? String(current.address_line_1) : cleanAdminText(body.addressLine1, 140);
      const addressLine2 = body.addressLine2 === undefined ? String(current.address_line_2) : cleanAdminText(body.addressLine2, 140);
      const suburb = body.suburb === undefined ? String(current.suburb) : cleanAdminText(body.suburb, 80);
      const addressState = body.addressState === undefined ? String(current.address_state) : cleanAdminText(body.addressState, 20).toUpperCase();
      const postcode = body.postcode === undefined ? String(current.postcode) : cleanAdminText(body.postcode, 12);
      const statements = [db.prepare(`UPDATE trade_crm_customers SET first_name = ?, last_name = ?, business_name = ?, business_number = ?, email = ?,
        phone = ?, address_line_1 = ?, address_line_2 = ?, suburb = ?, address_state = ?, postcode = ?,
        tags = ?, private_notes = ?, updated_at = ? WHERE id = ? AND firebase_uid = ?`)
        .bind(
          firstName, lastName,
          body.businessName === undefined ? current.business_name : cleanAdminText(body.businessName, 140),
          body.businessNumber === undefined ? current.business_number : cleanAdminText(body.businessNumber, 30), email,
          phone, addressLine1, addressLine2, suburb, addressState, postcode,
          body.tags === undefined ? current.tags : JSON.stringify(cleanList(body.tags)),
          body.privateNotes === undefined ? current.private_notes : cleanAdminText(body.privateNotes, 2000),
          now, customerId, identity.uid,
        ),
        db.prepare(`UPDATE trade_crm_customer_contacts SET first_name = ?, last_name = ?, email = ?, phone = ?, updated_at = ?
          WHERE customer_id = ? AND firebase_uid = ? AND is_primary = 1 AND record_status = 'active'`)
          .bind(firstName, lastName, email, phone, now, customerId, identity.uid),
        db.prepare(`UPDATE trade_crm_service_sites SET address_line_1 = ?, address_line_2 = ?, suburb = ?, address_state = ?, postcode = ?, updated_at = ?
          WHERE customer_id = ? AND firebase_uid = ? AND is_primary = 1 AND record_status = 'active'`)
          .bind(addressLine1, addressLine2, suburb, addressState, postcode, now, customerId, identity.uid),
      ];
      for (const job of relatedJobs.results) {
        const revision = nextJobRevision(job.revision); const workOrderId = String(job.id);
        statements.push(db.prepare("UPDATE trade_work_orders SET revision = ?, updated_at = ? WHERE id = ? AND firebase_uid = ?")
          .bind(revision, now, workOrderId, identity.uid));
        statements.push(...jobSyncChangeStatements(db, { ownerUid: identity.uid, workOrderId, revision, changedAt: now,
          audienceMemberId: String(job.assignee_member_id || "") }));
      }
      await db.batch(statements);
      return adminJson({ ok: true });
    }

    if (action === "archive_template") {
      const templateId = cleanAdminText(body.templateId, 180);
      const result = await db.prepare(`UPDATE trade_crm_job_templates SET record_status = 'archived', updated_at = ?
        WHERE id = ? AND firebase_uid = ? AND record_status = 'active'`).bind(now, templateId, identity.uid).run();
      if (!result.meta.changes) return adminJson({ ok: false, error: "Job template not found." }, 404);
      return adminJson({ ok: true });
    }

    if (action === "update_appointment") {
      const appointmentId = cleanAdminText(body.appointmentId, 180);
      const current = await db.prepare(`SELECT a.* FROM trade_crm_appointments a JOIN trade_work_orders w ON w.id = a.work_order_id
        WHERE a.id = ? AND a.firebase_uid = ? AND w.firebase_uid = ? AND w.record_status = 'active'`)
        .bind(appointmentId, identity.uid, identity.uid).first<Record<string, unknown>>();
      if (!current) throw new Error("APPOINTMENT_NOT_FOUND");
      if (["en_route", "arrived", "in_progress"].includes(String(current.status))) {
        return adminJson({ ok: false, error: "Use the field-job action to advance an active appointment." }, 409);
      }
      const status = body.status === undefined ? String(current.status) : cleanAdminText(body.status, 20);
      if (!APPOINTMENT_STATUSES.has(status)) return adminJson({ ok: false, error: "Choose a valid appointment status." }, 400);
      await db.prepare("UPDATE trade_crm_appointments SET status = ?, updated_at = ? WHERE id = ? AND firebase_uid = ?")
        .bind(status, now, appointmentId, identity.uid).run();
      return adminJson({ ok: true });
    }

    if (action === "resolve_issue") {
      const noteId = cleanAdminText(body.noteId, 180);
      const issueStatus = cleanAdminText(body.issueStatus, 20);
      if (!ISSUE_STATUSES.has(issueStatus) || issueStatus === "not_applicable") return adminJson({ ok: false, error: "Choose open or resolved." }, 400);
      const result = await db.prepare(`UPDATE trade_crm_job_notes SET issue_status = ?, updated_at = ?
        WHERE id = ? AND firebase_uid = ? AND note_type = 'issue'`).bind(issueStatus, now, noteId, identity.uid).run();
      if (!result.meta.changes) throw new Error("NOTE_NOT_FOUND");
      return adminJson({ ok: true });
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
    let serviceSiteId = platformPrivate ? "" : body.serviceSiteId === undefined ? String(current?.service_site_id || "") : cleanAdminText(body.serviceSiteId, 180);
    if (customerId) {
      await ownedCustomer(db, identity, customerId);
      if (!serviceSiteId) {
        const primarySite = await db.prepare(`SELECT id FROM trade_crm_service_sites
          WHERE customer_id = ? AND firebase_uid = ? AND record_status = 'active' ORDER BY is_primary DESC, created_at LIMIT 1`)
          .bind(customerId, identity.uid).first<Record<string, unknown>>();
        serviceSiteId = String(primarySite?.id || "");
      }
      if (serviceSiteId) await ownedServiceSite(db, identity, serviceSiteId, customerId);
    }
    if (!customerId && serviceSiteId) throw new Error("SERVICE_SITE_NOT_FOUND");
    const values = {
      customerId,
      serviceSiteId,
      customerSource: platformPrivate ? "platform_private" : customerId ? "trade_owned" : "internal",
      pipelineStage,
      buildingType: body.buildingType === undefined ? String(current?.building_type || "not_sure") : cleanAdminText(body.buildingType, 40),
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
    if (!BUILDING_TYPES.has(values.buildingType)) return adminJson({ ok: false, error: "Choose a valid building type." }, 400);
    const detailStatement = current
      ? db.prepare(`UPDATE trade_crm_job_details SET crm_customer_id = ?, service_site_id = ?, customer_source = ?, pipeline_stage = ?, building_type = ?,
          description = ?, customer_reference = ?, next_action = ?, tags = ?, estimated_value_cents = ?,
          quoted_value_cents = ?, invoiced_value_cents = ?, paid_value_cents = ?, quote_status = ?,
          invoice_status = ?, payment_due_at = ?, updated_at = ? WHERE work_order_id = ? AND firebase_uid = ?`)
        .bind(values.customerId, values.serviceSiteId, values.customerSource, values.pipelineStage, values.buildingType, values.description, values.customerReference,
          values.nextAction, values.tags, values.estimated, values.quoted, values.invoiced, values.paid,
          quoteStatus, invoiceStatus, values.paymentDue, now, workOrderId, identity.uid)
      : db.prepare(`INSERT INTO trade_crm_job_details
          (id, work_order_id, firebase_uid, crm_customer_id, service_site_id, customer_source, pipeline_stage, building_type, description,
           customer_reference, next_action, tags, estimated_value_cents, quoted_value_cents,
           invoiced_value_cents, paid_value_cents, quote_status, invoice_status, payment_due_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(crypto.randomUUID(), workOrderId, identity.uid, values.customerId, values.serviceSiteId, values.customerSource, values.pipelineStage,
          values.buildingType, values.description, values.customerReference, values.nextAction, values.tags, values.estimated, values.quoted,
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
    return adminJson({ ok: true });
  } catch (error) { return errorResponse(error); }
}
