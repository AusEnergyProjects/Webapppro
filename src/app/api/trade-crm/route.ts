import { getD1 } from "../../../../db";
import { adminJson, cleanAdminText, sameOrigin } from "@/lib/admin-server";
import { TradeAccessError } from "@/lib/trade-access-server";
import { nextTlinkJobNumber } from "@/lib/trade-job-number-server";
import {
  guardedOnlineChildMutationBatch,
  guardedOnlineJobMutationBatch,
  jobSyncChangeStatements,
  nextJobRevision,
} from "@/lib/trade-team-sync-server";
import { decodeKeysetCursor, encodeKeysetCursor, keysetAfter, type KeysetDirection } from "@/lib/keyset-pagination";
import { performanceJson, routeTimer } from "@/lib/route-performance";
import { ftsPrefixQuery } from "@/lib/fts-search";
import { appointmentEndsAt, assertAppointmentSlot, assertFutureAppointment, australiaLocalDateTime } from "@/lib/trade-schedule";
import { directCustomerHasEmail, findDirectCustomerDuplicates } from "@/lib/trade-customer-dedup-server";
import {
  assignedJob,
  canAssignJob,
  canCreateJobs,
  canManageJobs,
  requireInstallerTeamAccess,
  type TeamAccess,
} from "@/lib/trade-team-server";
import { syncCreatedAppointmentToConnectedCalendars } from "@/lib/trade-calendar-sync-server";
import { sendDirectAppointmentCalendarInvite } from "@/lib/direct-appointment-invite-server";
import {
  autoOpenReadyPlannedComplianceWorkPacks,
  ComplianceDomainError,
  type PlannedComplianceWorkPackBlocker,
  type PlannedComplianceWorkPackReadiness,
} from "@/lib/creditex-compliance-server";
import {
  CREDITEX_PARTNER_ORGANISATION_CODE,
  resolveTradeComplianceIntents,
  stableTradeComplianceIntentJson,
  TradeComplianceIntentError,
} from "@/lib/trade-compliance-intent";
import {
  isTradeComplianceIntentScheduleConflict,
  plannedComplianceIntentReplanStatements,
  previousTradeScheduleMutationGuardStatement,
} from "@/lib/trade-compliance-intent-replan-server";
import { projectInstallerWorkOrderToDataforceRecord } from "@/lib/creditex-dataforce-job-csv";
import { integrationEnvironment } from "@/lib/trade-integrations-server";
import { TRADE_CRM_CURRENT_APPOINTMENT_JOIN_SQL } from "@/lib/trade-crm-job-index-sql";
import {
  JOB_REGISTER_CUSTOMER_CONTEXT_SQL,
  JOB_REGISTER_OPERATIONAL_STATUSES,
  protectedJobCustomerText,
  projectJobRegisterRecord,
} from "@/lib/trade-crm-job-register";
import {
  canonicalAustralianAddress,
  resolveTradeAddressProvenance,
  TradeAddressVerificationError,
  type AustralianAddressComponents,
  type TradeAddressProvenance,
} from "@/lib/trade-address-verification";
import {
  ENERGY_SERVICE_IDS,
  ENERGY_SERVICE_LABELS,
} from "@/lib/energy-service-catalogue.mjs";
import { canRescheduleWithinScope } from "@/lib/trade-team-permission-policy.mjs";
import {
  assertTradeJobReadyForScheduling,
  assertTradeScheduleAvailable,
  isTradeJobScheduleEligibilityConflict,
  tradeJobScheduleEligibilityGuardStatement,
  tradeJobScheduleEligibilitySql,
  tradeScheduleAvailabilityGuardStatement,
} from "@/lib/trade-schedule-server";
import {
  RENTAL_ASSESSMENT_TEMPLATE_EFFECTIVE_FROM,
  RENTAL_ASSESSMENT_TEMPLATE_KEY,
  RENTAL_ASSESSMENT_TEMPLATE_VERSION,
  RENTAL_INSPECTION_SERVICE_CATEGORY,
  normalizeRentalAssessmentModules,
  rentalInspectionServiceAddressAccepted,
  rentalAssessmentTemplateSnapshot,
} from "@/lib/trade-rental-assessment.mjs";
import { ensureTradeRentalSchemaGuards } from "@/lib/trade-rental-schema-guards";
import {
  isRentalInspectionAssignmentConflict,
  rentalInspectionAssignmentStatements,
} from "@/lib/trade-rental-assignment-server";

export const runtime = "edge";

const MEMBER_ACTIVE_JOB_LIMIT = 500;
const CRM_CUSTOMER_LIMIT = 5000;
const CRM_TEMPLATE_LIMIT = 60;
const CUSTOMER_TYPES = new Set(["residential", "business"]);
const PIPELINE_STAGES = new Set(["enquiry", "qualifying", "quoting", "approved", "scheduled", "in_progress", "complete", "invoiced", "paid", "lost"]);
const WORK_STAGES = new Set(["backlog", "ready", "scheduled", "in_progress", "blocked", "completed", "cancelled"]);
const PRIORITIES = new Set(["low", "standard", "high", "urgent"]);
const SERVICE_CATEGORIES = new Set([
  ...ENERGY_SERVICE_IDS,
  RENTAL_INSPECTION_SERVICE_CATEGORY,
  "electrical", "plumbing", "mounting-hardware", "controls",
]);
const APPOINTMENT_TYPES = new Set(["phone_call", "site_visit", "quote_review", "installation", "service", "admin"]);
const APPOINTMENT_STATUSES = new Set(["scheduled", "completed", "cancelled", "no_show"]);
const BUILDING_TYPES = new Set(["house_townhouse", "apartment_unit", "commercial_office", "retail_hospitality", "industrial_warehouse", "institutional_community_health", "other", "not_sure"]);
const ADDRESS_STATES = new Set(["ACT", "NSW", "NT", "QLD", "SA", "TAS", "VIC", "WA"]);
const NOTE_TYPES = new Set(["internal", "issue"]);
const ISSUE_STATUSES = new Set(["not_applicable", "open", "resolved"]);
const QUOTE_STATUSES = new Set(["not_started", "draft", "issued", "sent", "accepted", "declined"]);
const INVOICE_STATUSES = new Set(["not_started", "draft", "issued", "part_paid", "paid", "overdue", "void"]);
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PAGE_SIZES = new Set([25, 50, 100]);
const JOB_REGISTER_STATUS_SET = new Set<string>(JOB_REGISTER_OPERATIONAL_STATUSES);
const CRM_REQUEST_MAX_BYTES = 96 * 1024;
const SERVICE_LABELS: Record<string, string> = {
  ...ENERGY_SERVICE_LABELS,
  [RENTAL_INSPECTION_SERVICE_CATEGORY]: "Rental inspection",
  "insulation-draughts": "Insulation and draught control",
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
const JOB_REGISTER_AUDITED_SQL = `EXISTS (
  SELECT 1 FROM compliance_cases register_case
  WHERE register_case.work_order_id = w.id
    AND register_case.installer_uid = w.firebase_uid
    AND register_case.status = 'accepted'
    AND register_case.evidence_status = 'verified'
)`;
const JOB_REGISTER_QUOTE_TOTAL_SQL = `(
  SELECT CASE
    WHEN current_acceptance.id IS NOT NULL THEN current_acceptance.selected_subtotal_cents
    ELSE MAX(0, current_quote_version.subtotal_cents) + COALESCE((
      SELECT SUM(MAX(0, default_choice.subtotal_cents))
      FROM trade_crm_quote_choices default_choice
      WHERE default_choice.quote_version_id = current_quote_version.id
        AND default_choice.firebase_uid = current_quote_version.firebase_uid
        AND default_choice.choice_kind <> 'addon'
        AND default_choice.id = (
          SELECT preferred_choice.id
          FROM trade_crm_quote_choices preferred_choice
          WHERE preferred_choice.quote_version_id = default_choice.quote_version_id
            AND preferred_choice.firebase_uid = default_choice.firebase_uid
            AND preferred_choice.choice_kind = default_choice.choice_kind
            AND preferred_choice.group_key = default_choice.group_key
          ORDER BY preferred_choice.recommended DESC,
            CASE WHEN preferred_choice.recommended <> 0 THEN preferred_choice.position END DESC,
            preferred_choice.position ASC
          LIMIT 1
        )
    ), 0)
  END
  FROM trade_crm_quotes current_quote
  JOIN trade_crm_quote_versions current_quote_version
    ON current_quote_version.quote_id = current_quote.id
    AND current_quote_version.firebase_uid = current_quote.firebase_uid
    AND current_quote_version.version_number = current_quote.current_version_number
  LEFT JOIN trade_crm_quote_acceptances current_acceptance
    ON current_acceptance.quote_id = current_quote.id
    AND current_acceptance.quote_version_id = current_quote_version.id
    AND current_acceptance.work_order_id = current_quote.work_order_id
    AND current_acceptance.firebase_uid = current_quote.firebase_uid
    AND current_acceptance.decision = 'accepted'
  WHERE current_quote.work_order_id = w.id
    AND current_quote.firebase_uid = w.firebase_uid
  LIMIT 1
)`;
const JOB_REGISTER_QUOTE_SORT_SQL = `COALESCE(${JOB_REGISTER_QUOTE_TOTAL_SQL}, 0)`;
const JOB_REGISTER_STATUS_RANK_SQL = `CASE
  WHEN w.stage = 'cancelled' OR d.pipeline_stage = 'lost' THEN 6
  WHEN ${JOB_REGISTER_AUDITED_SQL} THEN 4
  WHEN w.stage = 'completed' OR d.pipeline_stage IN ('complete', 'invoiced', 'paid') THEN 3
  WHEN trim(w.assignee_member_id) <> '' OR trim(w.scheduled_start) <> '' THEN 2
  ELSE 1 END`;
const JOB_SORTS: Record<string, CrmSort> = {
  "number-asc": crmSort([crmTerm("w.work_number COLLATE NOCASE", "asc", "work_number")], "w.id"),
  "number-desc": crmSort([crmTerm("w.work_number COLLATE NOCASE", "desc", "work_number")], "w.id"),
  "first-name-asc": crmSort([crmTerm(`${protectedJobCustomerText("c.first_name")} COLLATE NOCASE`, "asc", "first_name"), crmTerm(`${protectedJobCustomerText("c.last_name")} COLLATE NOCASE`, "asc", "last_name")], "w.id"),
  "last-name-asc": crmSort([crmTerm(`${protectedJobCustomerText("c.last_name")} COLLATE NOCASE`, "asc", "last_name"), crmTerm(`${protectedJobCustomerText("c.first_name")} COLLATE NOCASE`, "asc", "first_name")], "w.id"),
  "phone-asc": crmSort([crmTerm(`${protectedJobCustomerText("c.phone")} COLLATE NOCASE`, "asc", "customer_phone")], "w.id"),
  "email-asc": crmSort([crmTerm(`${protectedJobCustomerText("c.email")} COLLATE NOCASE`, "asc", "customer_email")], "w.id"),
  "street-asc": crmSort([crmTerm(`${protectedJobCustomerText("ss.address_line_1")} COLLATE NOCASE`, "asc", "site_address_line_1")], "w.id"),
  "postcode-asc": crmSort([crmTerm(`${protectedJobCustomerText("ss.postcode")} COLLATE NOCASE`, "asc", "site_postcode")], "w.id"),
  "suburb-asc": crmSort([crmTerm(`${protectedJobCustomerText("ss.suburb")} COLLATE NOCASE`, "asc", "site_suburb")], "w.id"),
  "state-asc": crmSort([crmTerm(`${protectedJobCustomerText("ss.address_state")} COLLATE NOCASE`, "asc", "site_address_state")], "w.id"),
  "assignee-asc": crmSort([crmTerm("trim(w.assignee_member_id) = ''", "asc", "assignment_empty", true), crmTerm("w.assignee_label COLLATE NOCASE", "asc", "assignee_label")], "w.id"),
  "status-asc": crmSort([crmTerm(JOB_REGISTER_STATUS_RANK_SQL, "asc", "register_status_rank", true)], "w.id"),
  "quote-total-asc": crmSort([crmTerm(`${JOB_REGISTER_QUOTE_TOTAL_SQL} IS NULL`, "asc", "quote_total_empty", true), crmTerm(JOB_REGISTER_QUOTE_SORT_SQL, "asc", "quote_total_sort_cents", true)], "w.id"),
  "quote-total-desc": crmSort([crmTerm(`${JOB_REGISTER_QUOTE_TOTAL_SQL} IS NULL`, "asc", "quote_total_empty", true), crmTerm(JOB_REGISTER_QUOTE_SORT_SQL, "desc", "quote_total_sort_cents", true)], "w.id"),
  "date-asc": crmSort([crmTerm("w.scheduled_start = ''", "asc", "schedule_empty", true), crmTerm("w.scheduled_start", "asc", "scheduled_start"), crmTerm("w.updated_at", "desc", "updated_at")], "w.id"),
  "updated-desc": crmSort([crmTerm("w.updated_at", "desc", "updated_at")], "w.id"),
};
const CUSTOMER_SORTS: Record<string, CrmSort> = {
  "name-asc": crmSort([
    crmTerm("CASE WHEN trim(c.first_name) = '' AND trim(c.last_name) = '' THEN 1 ELSE 0 END", "asc", "person_name_missing", true),
    crmTerm("c.first_name COLLATE NOCASE", "asc", "first_name"),
    crmTerm("c.last_name COLLATE NOCASE", "asc", "last_name"),
    crmTerm("c.business_name COLLATE NOCASE", "asc", "business_name"),
  ], "c.id"),
  "name-desc": crmSort([
    crmTerm("CASE WHEN trim(c.first_name) = '' AND trim(c.last_name) = '' THEN 1 ELSE 0 END", "asc", "person_name_missing", true),
    crmTerm("c.first_name COLLATE NOCASE", "desc", "first_name"),
    crmTerm("c.last_name COLLATE NOCASE", "desc", "last_name"),
    crmTerm("c.business_name COLLATE NOCASE", "desc", "business_name"),
  ], "c.id"),
  "updated-desc": crmSort([crmTerm("c.updated_at", "desc", "updated_at")], "c.id"),
};
const SCHEDULE_SORT = crmSort([crmTerm("a.starts_at", "asc", "starts_at"), crmTerm("a.created_at", "asc", "created_at")], "a.id");

type CrmIdentity = {
  uid: string;
  email: string;
  memberId: string;
  businessName: string;
  addressState: string;
  teamAccess: boolean;
  access: TeamAccess;
};
type AddressCandidate = AustralianAddressComponents & {
  addressEntryMode?: unknown;
  addressProvider?: unknown;
  addressProviderReference?: unknown;
  addressFormatted?: unknown;
  addressSelectionProof?: unknown;
};

async function boundedCrmRequestBody(request: Request) {
  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (
    Number.isFinite(declaredLength)
    && declaredLength > CRM_REQUEST_MAX_BYTES
  ) {
    throw new Error("CRM_REQUEST_TOO_LARGE");
  }
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > CRM_REQUEST_MAX_BYTES) {
    throw new Error("CRM_REQUEST_TOO_LARGE");
  }
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("INVALID_CRM_REQUEST");
  }
  return parsed as Record<string, unknown>;
}

const ADDRESS_COMPONENT_KEYS = ["addressLine1", "addressLine2", "suburb", "addressState", "postcode"] as const;
const ADDRESS_PROVENANCE_KEYS = ["addressEntryMode", "addressProvider", "addressProviderReference", "addressFormatted", "addressSelectionProof"] as const;

function addressCandidate(body: Record<string, unknown>, current?: Record<string, unknown>): AddressCandidate {
  return {
    addressLine1: body.addressLine1 === undefined ? String(current?.address_line_1 || "") : cleanAdminText(body.addressLine1, 140),
    addressLine2: body.addressLine2 === undefined ? String(current?.address_line_2 || "") : cleanAdminText(body.addressLine2, 140),
    suburb: body.suburb === undefined ? String(current?.suburb || "") : cleanAdminText(body.suburb, 80),
    addressState: body.addressState === undefined ? String(current?.address_state || "") : cleanAdminText(body.addressState, 20).toUpperCase(),
    postcode: body.postcode === undefined ? String(current?.postcode || "") : cleanAdminText(body.postcode, 12),
    addressEntryMode: body.addressEntryMode,
    addressProvider: body.addressProvider,
    addressProviderReference: body.addressProviderReference,
    addressFormatted: body.addressFormatted,
    addressSelectionProof: body.addressSelectionProof,
  };
}

function addressHasContent(candidate: AustralianAddressComponents) {
  return ADDRESS_COMPONENT_KEYS.some((key) => String(candidate[key] || "").trim());
}

function addressComponentsChanged(current: Record<string, unknown>, candidate: AustralianAddressComponents) {
  const currentValues = [
    String(current.address_line_1 || "").trim(),
    String(current.address_line_2 || "").trim(),
    String(current.suburb || "").trim(),
    String(current.address_state || "").trim().toUpperCase(),
    String(current.postcode || "").trim(),
  ];
  return ADDRESS_COMPONENT_KEYS.some((key, index) => String(candidate[key] || "").trim() !== currentValues[index]);
}

function provenanceWasSubmitted(body: Record<string, unknown>) {
  return ADDRESS_PROVENANCE_KEYS.some((key) => body[key] !== undefined);
}

function addressComponentsWereSubmitted(body: Record<string, unknown>) {
  return ADDRESS_COMPONENT_KEYS.some((key) => body[key] !== undefined);
}

async function resolvedAddressWrite(
  body: Record<string, unknown>,
  identity: CrmIdentity,
  candidate = addressCandidate(body),
): Promise<TradeAddressProvenance> {
  if (!addressHasContent(candidate)) {
    return {
      ...candidate,
      addressEntryMode: "manual_pending_review",
      addressProvider: "",
      addressProviderReference: "",
      addressFormatted: "",
      addressVerifiedAt: "",
    };
  }
  return resolveTradeAddressProvenance({
    ...candidate,
    addressEntryMode: candidate.addressEntryMode || "manual_pending_review",
  }, {
    ownerUid: identity.uid,
    secret: String(integrationEnvironment().CRM_INTEGRATION_ENCRYPTION_KEY || ""),
  });
}

async function crmIdentity(request: Request): Promise<CrmIdentity> {
  const access = await requireInstallerTeamAccess(request);
  const account = await getD1().prepare("SELECT address_state FROM trade_accounts WHERE firebase_uid = ?")
    .bind(access.ownerUid).first<Record<string, unknown>>();
  return {
    uid: access.ownerUid,
    email: access.actorEmail,
    memberId: access.memberId,
    businessName: access.businessName || "Trade business",
    addressState: String(account?.address_state || "NSW"),
    teamAccess: access.isOwner || access.scheduleScope === "team",
    access,
  };
}

function errorResponse(error: unknown) {
  if (error instanceof TradeAddressVerificationError) {
    return adminJson({ ok: false, code: error.code, error: error.message }, 400);
  }
  if (error instanceof TradeComplianceIntentError) {
    return adminJson({ ok: false, code: error.code, error: error.message }, 409);
  }
  if (error instanceof ComplianceDomainError) {
    return adminJson({ ok: false, code: error.code, error: error.message }, error.status);
  }
  const code = error instanceof TradeAccessError ? error.code : error instanceof Error ? error.message : "";
  if (code === "JOB_SCHEDULE_ACCEPTANCE_REQUIRED" || isTradeJobScheduleEligibilityConflict(error)) {
    return adminJson({ ok: false, error: "Wait for the customer to accept the current Australian Energy Assessments quote before scheduling this job." }, 409);
  }
  if (isTradeComplianceIntentScheduleConflict(error)) {
    return adminJson({ ok: false, code: "REVISION_CONFLICT", error: "This job, its schedule or its compliance plan changed elsewhere. Refresh it before saving." }, 409);
  }
  if (isRentalInspectionAssignmentConflict(error)) {
    return adminJson({ ok: false, code: "REVISION_CONFLICT", error: "This rental assessment assignment changed elsewhere. Refresh the job before scheduling it." }, 409);
  }
  if (code.includes("Compliance-linked job activity date cannot change without case supersession")) {
    return adminJson({ ok: false, error: "This job is linked to a compliance case, so its planned installation date is locked. Governed case supersession is not available yet." }, 409);
  }
  if (code.includes("Compliance-linked job service site cannot change without case supersession")) {
    return adminJson({ ok: false, error: "This job is linked to a compliance case, so its service site is locked. Governed case supersession is not available yet." }, 409);
  }
  if (code.includes("Compliance-linked service site jurisdiction cannot change without case supersession")) {
    return adminJson({ ok: false, error: "This service site is linked to a compliance case, so its state or territory is locked. Governed case supersession is not available yet." }, 409);
  }
  if (code === "AUTH_REQUIRED") return adminJson({ ok: false, error: "Sign in to continue." }, 401);
  if (code === "PROFILE_REQUIRED") return adminJson({ ok: false, error: "Complete the installer profile first." }, 404);
  if (code === "ACCOUNT_INACTIVE") return adminJson({ ok: false, error: "This installer account is not active." }, 403);
  if (code === "INSTALLER_ONLY" || code === "TRADE_ROLE_REQUIRED") return adminJson({ ok: false, error: "Customer CRM is available to installer accounts only." }, 403);
  if (code === "FULL_ACCESS_REQUIRED" || code === "ABN_REVIEW_REQUIRED" || code === "EMAIL_VERIFICATION_REQUIRED") return adminJson({ ok: false, error: "Complete trade verification before using customer CRM, scheduling and financial tracking." }, 403);
  if (code === "TEAM_ACCESS_REQUIRED") return adminJson({ ok: false, error: "Complete trade verification before assigning staff." }, 403);
  if (code === "TEAM_ACCESS_RECORD_REQUIRED") return adminJson({ ok: false, error: "No active team access was found for this account." }, 403);
  if (code === "JOB_CREATE_REQUIRED") return adminJson({ ok: false, error: "Your team access does not allow new jobs." }, 403);
  if (code === "JOB_MANAGEMENT_REQUIRED") return adminJson({ ok: false, error: "Your team access does not allow job changes." }, 403);
  if (code === "QUOTE_MANAGEMENT_REQUIRED") return adminJson({ ok: false, error: "Your team access does not allow quote changes." }, 403);
  if (code === "INVOICE_MANAGEMENT_REQUIRED") return adminJson({ ok: false, error: "Your team access does not allow invoice changes." }, 403);
  if (code === "JOB_ASSIGN_REQUIRED") return adminJson({ ok: false, error: "Your team access does not allow assigning jobs to other team members." }, 403);
  if (code === "JOB_ASSIGNMENT_REQUIRED") return adminJson({ ok: false, error: "Assign this job before adding an appointment." }, 409);
  if (code === "JOB_ASSIGNMENT_CHANGED") return adminJson({ ok: false, code: "REVISION_CONFLICT", error: "This job's assignment changed. Refresh it before booking." }, 409);
  if (code === "ACTIVE_APPOINTMENT_REASSIGN") return adminJson({ ok: false, error: "This job already has an active appointment. Move or cancel that appointment before assigning the job to someone else." }, 409);
  if (code === "RENTAL_ACTIVE_APPOINTMENT") return adminJson({ ok: false, error: "This rental assessment already has an active appointment. Move or cancel that appointment instead of creating another one." }, 409);
  if (code === "TERMINAL_JOB_LOCKED") return adminJson({ ok: false, error: "Completed or cancelled jobs cannot be scheduled." }, 409);
  if (code === "JOB_RESCHEDULE_REQUIRED") return adminJson({ ok: false, error: "Your team access does not allow appointment scheduling or rescheduling." }, 403);
  if (code === "DISCOUNT_REQUIRED") return adminJson({ ok: false, error: "Your team access does not allow discounts, credits or price reductions." }, 403);
  if (code === "CUSTOMER_VIEW_REQUIRED") return adminJson({ ok: false, error: "Your team access does not allow customer records." }, 403);
  if (code === "CUSTOMER_MANAGEMENT_REQUIRED") return adminJson({ ok: false, error: "Your team access does not allow customer changes." }, 403);
  if (code === "CUSTOMER_SEARCH_REQUIRED") return adminJson({ ok: false, error: "Your team access does not allow customer directory search." }, 403);
  if (code === "QUOTE_VIEW_REQUIRED") return adminJson({ ok: false, error: "Your team access does not allow quote totals." }, 403);
  if (code === "INVOICE_VIEW_REQUIRED") return adminJson({ ok: false, error: "Your team access does not allow invoice filters or values." }, 403);
  if (code === "REPORTS_REQUIRED") return adminJson({ ok: false, error: "Your team access does not allow business reports." }, 403);
  if (code === "MEMBER_CAPABILITY_REQUIRED") return adminJson({ ok: false, error: "The selected team member is not enabled for this service category." }, 409);
  if (code === "ONLINE_MUTATION_CONFLICT" || code === "REVISION_CONFLICT") {
    return adminJson({ ok: false, code: "REVISION_CONFLICT", error: "This job changed elsewhere. Refresh it before saving." }, 409);
  }
  if (code === "JOB_NOT_ASSIGNED") return adminJson({ ok: false, error: "This job is outside your assigned work." }, 403);
  if (code === "CUSTOMER_NOT_FOUND") return adminJson({ ok: false, error: "Customer record not found." }, 404);
  if (code === "CONTACT_NOT_FOUND") return adminJson({ ok: false, error: "Customer contact not found." }, 404);
  if (code === "SERVICE_SITE_NOT_FOUND") return adminJson({ ok: false, error: "Service site not found." }, 404);
  if (code === "JOB_NOT_FOUND") return adminJson({ ok: false, error: "Job record not found." }, 404);
  if (code === "APPOINTMENT_NOT_FOUND") return adminJson({ ok: false, error: "Appointment not found." }, 404);
  if (code === "NOTE_NOT_FOUND") return adminJson({ ok: false, error: "Note or issue not found." }, 404);
  if (code === "INVALID_DATE") return adminJson({ ok: false, error: "Choose a valid date and time." }, 400);
  if (["INVALID_STATE", "INVALID_JOB_STATUS", "INVALID_QUOTE_TOTAL"].includes(code)) return adminJson({ ok: false, error: "Check the job register filters and try again." }, 400);
  if (code === "PAST_APPOINTMENT") return adminJson({ ok: false, error: "Choose a future appointment time." }, 400);
  if (code === "APPOINTMENT_CONFLICT") return adminJson({ ok: false, error: "That team member already has an overlapping appointment." }, 409);
  if (code === "UNAVAILABLE_CONFLICT") return adminJson({ ok: false, error: "That team member is unavailable during the selected time." }, 409);
  if (code === "INVALID_APPOINTMENT_SLOT") return adminJson({ ok: false, error: "Choose an appointment time on a 15-minute interval." }, 400);
  if (code === "INVALID_QUICK_INVOICE") return adminJson({ ok: false, error: "Add at least one valid invoice line and check the GST choice." }, 400);
  if (code === "PRICE_BOOK_ITEM_UNAVAILABLE") return adminJson({ ok: false, error: "A saved invoice fee changed or was archived. Choose it again." }, 409);
  if (code === "JOB_LIMIT_REACHED") return adminJson({ ok: false, error: "This workspace has reached its 500 active job fair-use limit." }, 409);
  if (code === "CUSTOMER_LIMIT_REACHED") return adminJson({ ok: false, error: "This workspace has reached its customer-record fair-use limit." }, 409);
  if (code === "JOB_NUMBER_UNAVAILABLE") return adminJson({ ok: false, error: "The next job number could not be reserved. Please try again." }, 503);
  if (code === "INVALID_CURSOR") return adminJson({ ok: false, error: "This CRM page link has expired. Start again from the first page." }, 400);
  console.error(
    "Installer CRM request failed",
    error instanceof Error ? error.message : "Unknown error",
  );
  return adminJson({ ok: false, error: "The private installer CRM request could not be completed." }, 500);
}

async function sha256Text(value: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((item) => item.toString(16).padStart(2, "0"))
    .join("");
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

function storedObject(value: unknown) {
  try {
    const parsed = JSON.parse(String(value || "{}"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch { return {}; }
}

function pagination(url: URL) {
  const requestedPage = Number(url.searchParams.get("page"));
  const requestedPageSize = Number(url.searchParams.get("pageSize"));
  return {
    page: Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1,
    pageSize: PAGE_SIZES.has(requestedPageSize) ? requestedPageSize : 25,
  };
}

function indexedJob(row: Record<string, unknown>, access: Pick<TeamAccess, "canViewQuotes" | "canViewInvoices">) {
  const sourceType = String(row.source_type);
  const customerSource = sourceType === "opportunity" ? "platform_private" : String(row.customer_source || "internal");
  const protectedCustomer = customerSource === "platform_private";
  const canViewCustomer = !protectedCustomer;
  const dataforceRecord = projectInstallerWorkOrderToDataforceRecord({
    identifiers: {
      appointmentId: String(row.appointment_id || ""),
      jobId: String(row.work_number || ""),
    },
    work: {
      workType: String(row.governed_work_type || SERVICE_LABELS[String(row.service_category)] || row.service_category || ""),
      scheduledStart: String(row.scheduled_start || ""),
    },
    appointment: { startsAt: String(row.appointment_starts_at || "") },
    financials: {
      invoicedValueCents: access.canViewInvoices ? Number(row.invoiced_value_cents || 0) : 0,
      paidValueCents: access.canViewInvoices ? Number(row.paid_value_cents || 0) : 0,
      invoiceStatus: access.canViewInvoices ? String(row.invoice_status || "not_started") : "restricted",
    },
    customer: canViewCustomer ? {
      firstName: String(row.first_name || ""),
      lastName: String(row.last_name || ""),
      businessName: String(row.business_name || ""),
      email: String(row.customer_email || ""),
      phone: "",
      mobile: String(row.customer_phone || ""),
    } : undefined,
    serviceSite: canViewCustomer ? {
      addressLine1: String(row.site_address_line_1 || ""),
      addressLine2: String(row.site_address_line_2 || ""),
      suburb: String(row.site_suburb || ""),
      postcode: String(row.site_postcode || ""),
    } : undefined,
    technician: { displayName: String(row.assignee_label || "") },
    customerReference: canViewCustomer ? String(row.customer_reference || "") : "",
    verifiedCertificateIssuance: null,
  });
  const jobRegister = projectJobRegisterRecord({
    jobId: row.work_number,
    firstName: row.first_name,
    lastName: row.last_name,
    contactNumber: row.customer_phone,
    email: row.customer_email,
    addressLine1: row.site_address_line_1,
    addressLine2: row.site_address_line_2,
    postcode: row.site_postcode,
    suburb: row.site_suburb,
    state: row.site_address_state,
    assigneeMemberId: row.assignee_member_id,
    assignedWorker: row.assignee_label,
    scheduleDate: row.appointment_starts_at || row.scheduled_start,
    workStage: row.stage,
    pipelineStage: row.pipeline_stage,
    audited: row.register_audited,
    certificates: { stc: 0, veec: 0, esc: 0, other: 0 },
    service: String(row.governed_work_type || SERVICE_LABELS[String(row.service_category)] || row.service_category || ""),
    quoteStatus: access.canViewQuotes ? row.quote_status : "restricted",
    quoteTotalExGstCents: access.canViewQuotes ? row.quote_total_ex_gst_cents : null,
    updatedAt: row.updated_at,
    canViewCustomer,
  });
  return {
    id: row.id, workNumber: row.work_number,
    revision: Number(row.revision || 1),
    title: protectedCustomer ? `${String(row.service_category || "Service")} job` : row.title, serviceCategory: row.service_category,
    siteArea: row.site_area, stage: row.stage, priority: row.priority, scheduledStart: row.scheduled_start,
    scheduledEnd: row.scheduled_end, assigneeMemberId: String(row.assignee_member_id || ""),
    assigneeLabel: row.assignee_label, sourceType, customerSource,
    crmCustomerId: protectedCustomer ? "" : String(row.crm_customer_id || ""),
    serviceSiteId: protectedCustomer ? "" : String(row.service_site_id || ""),
    customerDisplayName: protectedCustomer ? "Australian Energy Assessments protected customer" : String(row.customer_name || ""),
    pipelineStage: row.pipeline_stage || (sourceType === "opportunity" ? "qualifying" : "enquiry"), buildingType: row.building_type || "not_sure",
    description: protectedCustomer ? "" : row.description || "", customerReference: protectedCustomer ? String(row.source_reference || row.work_number) : String(row.customer_reference || ""),
    nextAction: row.next_action || "", tags: storedList(row.job_tags), estimatedValueCents: Number(row.estimated_value_cents || 0),
    quotedValueCents: access.canViewQuotes ? Number(row.quoted_value_cents || 0) : 0,
    scheduleReady: Boolean(row.schedule_ready),
    invoicedValueCents: access.canViewInvoices ? Number(row.invoiced_value_cents || 0) : 0,
    paidValueCents: access.canViewInvoices ? Number(row.paid_value_cents || 0) : 0,
    quoteStatus: access.canViewQuotes ? row.quote_status || "not_started" : "restricted",
    invoiceStatus: access.canViewInvoices ? row.invoice_status || "not_started" : "restricted",
    paymentDueAt: access.canViewInvoices ? row.payment_due_at || "" : "",
    handoverStatus: row.handover_status || "", tasks: [], appointments: [], notes: [], complianceCases: [], complianceIntents: [], complianceIntent: null,
    dataforceRecord, jobRegister,
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function indexedComplianceCase(row: Record<string, unknown>) {
  const snapshot = storedObject(row.activity_snapshot);
  return {
    id: String(row.id),
    caseNumber: String(row.case_number),
    activityDate: String(row.activity_date),
    programCode: String(snapshot.programCode || ""),
    programName: String(snapshot.programName || ""),
    activityKey: String(snapshot.activityKey || ""),
    version: Number(snapshot.version || 0),
    title: String(snapshot.title || ""),
    registryActivityCode: String(snapshot.registryActivityCode || ""),
    productCategory: String(snapshot.productCategory || ""),
    scenarioCode: String(snapshot.scenarioCode || ""),
    scenario: String(snapshot.scenario || ""),
    officialSourceUrl: String(snapshot.officialSourceUrl || ""),
    officialSourceTitle: String(snapshot.officialSourceTitle || ""),
    officialSourceVersion: String(snapshot.officialSourceVersion || ""),
    status: String(row.status),
    evidenceStatus: String(row.evidence_status),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function indexedComplianceIntent(row: Record<string, unknown> | null) {
  if (!row) return null;
  const snapshot = storedObject(row.intent_snapshot);
  const program = storedObject(snapshot.program);
  const activity = storedObject(snapshot.activity);
  const governance = storedObject(snapshot.governance);
  return {
    id: String(row.id),
    status: String(row.status),
    programTemplateId: String(row.program_template_id),
    activityTemplateId: String(row.activity_template_id),
    programCode: String(row.program_code),
    programName: String(program.name || ""),
    activityKey: String(activity.activityKey || ""),
    registryActivityCode: String(row.registry_activity_code || ""),
    activityTitle: String(activity.title || ""),
    serviceCategory: String(row.service_category),
    siteJurisdiction: String(row.site_jurisdiction),
    plannedStart: String(row.planned_start || ""),
    catalogueReviewedOn: String(row.catalogue_reviewed_on),
    governanceState: String(governance.state || "setup_required"),
    governanceMessage: String(governance.message || ""),
    officialSourceUrl: String(program.officialSourceUrl || ""),
    complianceCaseId: String(row.compliance_case_id || ""),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
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
    addressEntryMode: String(row.address_entry_mode || "manual_pending_review"),
    addressProvider: String(row.address_provider || ""),
    addressProviderReference: String(row.address_provider_reference || ""),
    addressFormatted: String(row.address_formatted || ""),
    addressVerifiedAt: String(row.address_verified_at || ""),
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
    latestJobAt: String(row.latest_job_at || ""),
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
    if (!identity.access.isOwner && identity.access.jobScope === "own") {
      conditions.push("w.assignee_member_id = ?");
      bindings.push(identity.memberId);
    }
    if (search) {
      const searchableJobTitleSql = `${protectedJobCustomerText("w.title")} || ' ' || CASE WHEN w.source_type = 'opportunity' THEN '' ELSE COALESCE(w.site_area, '') END || ' ' ||`;
      const searchableCustomerSql = `${protectedJobCustomerText("d.customer_reference")} || ' ' ||
          ${protectedJobCustomerText("c.first_name")} || ' ' || ${protectedJobCustomerText("c.last_name")} || ' ' || ${protectedJobCustomerText("c.business_name")} || ' ' ||
          ${protectedJobCustomerText("c.email")} || ' ' || ${protectedJobCustomerText("c.phone")} || ' ' ||
          ${protectedJobCustomerText("ss.address_line_1")} || ' ' || ${protectedJobCustomerText("ss.address_line_2")} || ' ' ||
          ${protectedJobCustomerText("ss.suburb")} || ' ' || ${protectedJobCustomerText("ss.address_state")} || ' ' || ${protectedJobCustomerText("ss.postcode")} || ' '`;
      conditions.push(`LOWER(
        COALESCE(w.work_number, '') || ' ' || ${searchableJobTitleSql}
        COALESCE(w.assignee_label, '') || ' ' || COALESCE(w.stage, '') || ' ' || COALESCE(w.scheduled_start, '') || ' ' ||
        ${searchableCustomerSql}
        COALESCE((SELECT GROUP_CONCAT(
            json_extract(ci.intent_snapshot, '$.activity.title'),
            ' '
          )
          FROM trade_work_order_compliance_intents ci
          WHERE ci.work_order_id = w.id AND ci.installer_uid = w.firebase_uid
            AND ci.status IN ('planned', 'case_linked')), '')
      ) LIKE ?`);
      bindings.push(`%${search}%`);
    }
    const appointmentId = cleanAdminText(url.searchParams.get("appointmentId"), 180).toLowerCase();
    if (appointmentId) {
      conditions.push(`EXISTS (
        SELECT 1 FROM trade_crm_appointments filter_appointment
        WHERE filter_appointment.work_order_id = w.id
          AND filter_appointment.firebase_uid = w.firebase_uid
          AND LOWER(filter_appointment.id) LIKE ?
      )`);
      bindings.push(`%${appointmentId}%`);
    }
    const jobId = cleanAdminText(url.searchParams.get("jobId"), 180).toLowerCase();
    if (jobId) {
      conditions.push("(LOWER(w.id) LIKE ? OR LOWER(w.work_number) LIKE ?)");
      bindings.push(`%${jobId}%`, `%${jobId}%`);
    }
    const customer = cleanAdminText(url.searchParams.get("customer"), 100).toLowerCase();
    if (customer) {
      conditions.push(`${JOB_REGISTER_CUSTOMER_CONTEXT_SQL} AND LOWER(CASE WHEN c.business_name <> '' THEN c.business_name ELSE TRIM(c.first_name || ' ' || c.last_name) END) LIKE ?`);
      bindings.push(`%${customer}%`);
    }
    const firstName = cleanAdminText(url.searchParams.get("firstName"), 100).toLowerCase();
    if (firstName) {
      conditions.push(`${JOB_REGISTER_CUSTOMER_CONTEXT_SQL} AND LOWER(c.first_name) LIKE ?`);
      bindings.push(`%${firstName}%`);
    }
    const lastName = cleanAdminText(url.searchParams.get("lastName"), 100).toLowerCase();
    if (lastName) {
      conditions.push(`${JOB_REGISTER_CUSTOMER_CONTEXT_SQL} AND LOWER(c.last_name) LIKE ?`);
      bindings.push(`%${lastName}%`);
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
      conditions.push(`LOWER(CASE WHEN w.source_type = 'opportunity' THEN '' ELSE COALESCE(w.site_area, '') END || ' ' || ${protectedJobCustomerText("ss.address_line_1")} || ' ' || ${protectedJobCustomerText("ss.address_line_2")} || ' ' || ${protectedJobCustomerText("ss.suburb")} || ' ' || ${protectedJobCustomerText("ss.address_state")} || ' ' || ${protectedJobCustomerText("ss.postcode")}) LIKE ?`);
      bindings.push(`%${location}%`);
    }
    const street = cleanAdminText(url.searchParams.get("street"), 140).toLowerCase();
    if (street) {
      conditions.push(`${JOB_REGISTER_CUSTOMER_CONTEXT_SQL} AND LOWER(COALESCE(ss.address_line_1, '') || ' ' || COALESCE(ss.address_line_2, '')) LIKE ?`);
      bindings.push(`%${street}%`);
    }
    const scheduledFrom = cleanAdminText(url.searchParams.get("scheduledFrom"), 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(scheduledFrom)) {
      conditions.push("substr(w.scheduled_start, 1, 10) >= ?");
      bindings.push(scheduledFrom);
    }
    const scheduledTo = cleanAdminText(url.searchParams.get("scheduledTo"), 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(scheduledTo)) {
      conditions.push("substr(w.scheduled_start, 1, 10) <= ?");
      bindings.push(scheduledTo);
    }
    const invoiceStatus = cleanAdminText(url.searchParams.get("invoiceStatus"), 30);
    if (INVOICE_STATUSES.has(invoiceStatus)) {
      if (!identity.access.canViewInvoices) throw new Error("INVOICE_VIEW_REQUIRED");
      conditions.push("d.invoice_status = ?");
      bindings.push(invoiceStatus);
    }
    const customerReference = cleanAdminText(url.searchParams.get("customerReference"), 120).toLowerCase();
    if (customerReference) {
      conditions.push(`${JOB_REGISTER_CUSTOMER_CONTEXT_SQL} AND LOWER(d.customer_reference) LIKE ?`);
      bindings.push(`%${customerReference}%`);
    }
    const email = cleanAdminText(url.searchParams.get("email"), 180).toLowerCase();
    if (email) {
      conditions.push(`${JOB_REGISTER_CUSTOMER_CONTEXT_SQL} AND LOWER(c.email) LIKE ?`);
      bindings.push(`%${email}%`);
    }
    const phone = cleanAdminText(url.searchParams.get("phone"), 50).toLowerCase();
    if (phone) {
      conditions.push(`${JOB_REGISTER_CUSTOMER_CONTEXT_SQL} AND LOWER(c.phone) LIKE ?`);
      bindings.push(`%${phone}%`);
    }
    const suburb = cleanAdminText(url.searchParams.get("suburb"), 100).toLowerCase();
    if (suburb) {
      conditions.push(`${JOB_REGISTER_CUSTOMER_CONTEXT_SQL} AND LOWER(ss.suburb) LIKE ?`);
      bindings.push(`%${suburb}%`);
    }
    const postcode = cleanAdminText(url.searchParams.get("postcode"), 12).toLowerCase();
    if (postcode) {
      conditions.push(`${JOB_REGISTER_CUSTOMER_CONTEXT_SQL} AND LOWER(ss.postcode) LIKE ?`);
      bindings.push(`%${postcode}%`);
    }
    const state = cleanAdminText(url.searchParams.get("state"), 12).toUpperCase();
    if (state) {
      if (!ADDRESS_STATES.has(state)) throw new Error("INVALID_STATE");
      conditions.push(`${JOB_REGISTER_CUSTOMER_CONTEXT_SQL} AND UPPER(ss.address_state) = ?`);
      bindings.push(state);
    }
    const operationalStatus = cleanAdminText(url.searchParams.get("operationalStatus"), 30).toLowerCase();
    if (operationalStatus) {
      if (!JOB_REGISTER_STATUS_SET.has(operationalStatus)) throw new Error("INVALID_JOB_STATUS");
      const cancelled = "(w.stage = 'cancelled' OR d.pipeline_stage = 'lost')";
      const completed = "(w.stage = 'completed' OR d.pipeline_stage IN ('complete', 'invoiced', 'paid'))";
      const terminal = `(${cancelled} OR ${completed})`;
      const assigned = "(trim(w.assignee_member_id) <> '' OR trim(w.scheduled_start) <> '')";
      if (operationalStatus === "certified") conditions.push("0 = 1");
      else if (operationalStatus === "cancelled") conditions.push(cancelled);
      else if (operationalStatus === "audited") conditions.push(`NOT ${cancelled} AND ${JOB_REGISTER_AUDITED_SQL}`);
      else if (operationalStatus === "complete") conditions.push(`NOT ${cancelled} AND NOT ${JOB_REGISTER_AUDITED_SQL} AND ${completed}`);
      else if (operationalStatus === "assigned") conditions.push(`NOT ${JOB_REGISTER_AUDITED_SQL} AND NOT ${terminal} AND ${assigned}`);
      else conditions.push(`NOT ${JOB_REGISTER_AUDITED_SQL} AND NOT ${terminal} AND NOT ${assigned}`);
    }
    const quoteTotalMin = url.searchParams.get("quoteTotalMin");
    if (quoteTotalMin !== null && quoteTotalMin !== "") {
      if (!identity.access.canViewQuotes) throw new Error("QUOTE_VIEW_REQUIRED");
      const cents = Math.round(Number(quoteTotalMin) * 100);
      if (!Number.isSafeInteger(cents) || cents < 0) throw new Error("INVALID_QUOTE_TOTAL");
      conditions.push(`${JOB_REGISTER_QUOTE_TOTAL_SQL} >= ?`);
      bindings.push(cents);
    }
    const quoteTotalMax = url.searchParams.get("quoteTotalMax");
    if (quoteTotalMax !== null && quoteTotalMax !== "") {
      if (!identity.access.canViewQuotes) throw new Error("QUOTE_VIEW_REQUIRED");
      const cents = Math.round(Number(quoteTotalMax) * 100);
      if (!Number.isSafeInteger(cents) || cents < 0) throw new Error("INVALID_QUOTE_TOTAL");
      conditions.push(`${JOB_REGISTER_QUOTE_TOTAL_SQL} <= ?`);
      bindings.push(cents);
    }
    if (filter === "platform") conditions.push("w.source_type = 'opportunity'");
    else if (filter === "completed") conditions.push("w.stage IN ('completed', 'cancelled')");
    else if (filter === "attention") conditions.push(`(w.stage = 'blocked' OR EXISTS (SELECT 1 FROM trade_crm_job_notes n
      WHERE n.work_order_id = w.id AND n.firebase_uid = w.firebase_uid AND n.note_type = 'issue' AND n.issue_status = 'open'))`);
    else if (filter !== "all") conditions.push("w.stage NOT IN ('completed', 'cancelled')");
    const where = conditions.join(" AND ");
    const joins = `FROM trade_work_orders w LEFT JOIN trade_crm_job_details d ON d.work_order_id = w.id AND d.firebase_uid = w.firebase_uid
      LEFT JOIN trade_crm_customers c ON c.id = d.crm_customer_id AND c.firebase_uid = w.firebase_uid
      LEFT JOIN trade_crm_service_sites ss ON ss.id = d.service_site_id AND ss.firebase_uid = w.firebase_uid AND ss.record_status = 'active'`;
    const rowJoins = `${joins} ${TRADE_CRM_CURRENT_APPOINTMENT_JOIN_SQL}`;
    const sort = JOB_SORTS[sortValue] ? sortValue : "updated-desc";
    if (sort.startsWith("quote-total-") && !identity.access.canViewQuotes) throw new Error("QUOTE_VIEW_REQUIRED");
    const selectedSort = JOB_SORTS[sort];
    let cursor;
    try { cursor = decodeKeysetCursor(cursorInput, `jobs:${sort}`, selectedSort.terms.length); } catch { throw new Error("INVALID_CURSOR"); }
    if (page > 1 && !cursor) throw new Error("INVALID_CURSOR");
    const rowConditions = [...conditions]; const rowBindings = [...bindings];
    if (cursor) { const after = keysetAfter(selectedSort.terms, cursor); rowConditions.push(`(${after.sql})`); rowBindings.push(...after.bindings); }
    const rowWhere = rowConditions.join(" AND ");
    const [countRow, rows] = await Promise.all([
      includeTotal ? db.prepare(`SELECT COUNT(*) total ${joins} WHERE ${where}`).bind(...bindings).first<Record<string, unknown>>() : Promise.resolve(null),
      db.prepare(`SELECT w.*, d.crm_customer_id, d.service_site_id, d.customer_source, d.pipeline_stage, d.building_type,
        d.description, d.customer_reference,
        d.next_action, d.tags job_tags, d.estimated_value_cents, d.quoted_value_cents, d.invoiced_value_cents,
        d.paid_value_cents, d.quote_status, d.invoice_status, d.payment_due_at,
        ${protectedJobCustomerText("c.first_name")} first_name,
        ${protectedJobCustomerText("c.last_name")} last_name,
        ${protectedJobCustomerText("c.business_name")} business_name,
        ${protectedJobCustomerText("c.email")} customer_email,
        ${protectedJobCustomerText("c.phone")} customer_phone,
        ${protectedJobCustomerText("ss.address_line_1")} site_address_line_1,
        ${protectedJobCustomerText("ss.address_line_2")} site_address_line_2,
        ${protectedJobCustomerText("ss.suburb")} site_suburb,
        ${protectedJobCustomerText("ss.address_state")} site_address_state,
        ${protectedJobCustomerText("ss.postcode")} site_postcode,
        CASE WHEN ${JOB_REGISTER_CUSTOMER_CONTEXT_SQL}
          THEN CASE WHEN c.business_name <> '' THEN c.business_name ELSE TRIM(c.first_name || ' ' || c.last_name) END
          ELSE '' END customer_name,
        selected_appointment.id appointment_id,
        selected_appointment.starts_at appointment_starts_at,
        (SELECT json_extract(ci.intent_snapshot, '$.activity.title')
          FROM trade_work_order_compliance_intents ci
          WHERE ci.work_order_id = w.id AND ci.installer_uid = w.firebase_uid
            AND ci.status IN ('planned', 'case_linked')
          ORDER BY ci.revision DESC, ci.created_at DESC LIMIT 1) governed_work_type,
        (SELECT status FROM trade_handover_packs hp WHERE hp.work_order_id = w.id AND hp.firebase_uid = w.firebase_uid ORDER BY hp.updated_at DESC LIMIT 1) handover_status,
        ${JOB_REGISTER_AUDITED_SQL} register_audited,
        ${JOB_REGISTER_STATUS_RANK_SQL} register_status_rank,
        ${JOB_REGISTER_QUOTE_TOTAL_SQL} quote_total_ex_gst_cents,
        ${JOB_REGISTER_QUOTE_TOTAL_SQL} IS NULL quote_total_empty,
        ${JOB_REGISTER_QUOTE_SORT_SQL} quote_total_sort_cents,
        trim(w.assignee_member_id) = '' assignment_empty,
        w.scheduled_start = '' schedule_empty
        ${rowJoins} WHERE ${rowWhere} ORDER BY ${selectedSort.orderBy} LIMIT ?`)
        .bind(...rowBindings, pageSize + 1).all<Record<string, unknown>>(),
    ]);
    const total = countRow ? Number(countRow.total || 0) : undefined;
    const hasNext = rows.results.length > pageSize; const pageRows = rows.results.slice(0, pageSize);
    const nextCursor = hasNext && pageRows.length ? encodeKeysetCursor(`jobs:${sort}`, selectedSort.terms.map((item) => item.numeric ? Number(pageRows.at(-1)![item.rowKey]) : String(pageRows.at(-1)![item.rowKey] || ""))) : "";
    return { items: pageRows.map((row: Record<string, unknown>) => indexedJob(row, identity.access)), pagination: { page, pageSize, total, pageCount: total === undefined ? undefined : Math.max(1, Math.ceil(total / pageSize)), hasNext, nextCursor } };
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
      SELECT d.crm_customer_id, w.service_category, w.work_number, d.pipeline_stage, w.stage, w.created_at, w.updated_at,
        ROW_NUMBER() OVER (PARTITION BY d.crm_customer_id ORDER BY w.updated_at DESC, w.id DESC) latest_rank
      FROM trade_crm_job_details d JOIN trade_work_orders w ON w.id = d.work_order_id AND w.firebase_uid = d.firebase_uid
      WHERE d.firebase_uid = ? AND w.record_status = 'active'
    ), customer_job_summary AS (
      SELECT crm_customer_id, COUNT(*) job_count,
        SUM(CASE WHEN stage NOT IN ('completed', 'cancelled') THEN 1 ELSE 0 END) active_job_count,
        GROUP_CONCAT(DISTINCT service_category) activities,
        MAX(CASE WHEN latest_rank = 1 THEN work_number ELSE '' END) latest_job_number,
        MAX(CASE WHEN latest_rank = 1 THEN pipeline_stage ELSE '' END) latest_pipeline_stage,
        MAX(CASE WHEN latest_rank = 1 THEN updated_at ELSE '' END) latest_job_at
      FROM owned_jobs GROUP BY crm_customer_id
    )
      SELECT c.*, CASE WHEN c.business_name <> '' THEN c.business_name ELSE c.last_name || ' ' || c.first_name END sort_name,
        COALESCE(js.job_count, 0) job_count, COALESCE(js.active_job_count, 0) active_job_count,
        COALESCE(js.activities, '') activities, COALESCE(js.latest_job_number, '') latest_job_number,
        COALESCE(js.latest_pipeline_stage, '') latest_pipeline_stage,
        COALESCE(js.latest_job_at, '') latest_job_at,
        CASE WHEN trim(c.first_name) = '' AND trim(c.last_name) = '' THEN 1 ELSE 0 END person_name_missing
      FROM trade_crm_customers c LEFT JOIN customer_job_summary js ON js.crm_customer_id = c.id
      WHERE ${rowWhere} ORDER BY ${selectedSort.orderBy} LIMIT ?`)
      .bind(identity.uid, ...rowBindings, pageSize + 1).all<Record<string, unknown>>(),
  ]);
  const total = countRow ? Number(countRow.total || 0) : undefined;
  const hasNext = rows.results.length > pageSize; const pageRows = rows.results.slice(0, pageSize);
  const nextCursor = hasNext && pageRows.length
    ? encodeKeysetCursor(
      `customers:${sort}`,
      selectedSort.terms.map((item) =>
        item.numeric
          ? Number(pageRows.at(-1)![item.rowKey])
          : String(pageRows.at(-1)![item.rowKey] || "")
      ),
    )
    : "";
  return { items: pageRows.map((row: Record<string, unknown>) => indexedCustomer(row)), pagination: { page, pageSize, total, pageCount: total === undefined ? undefined : Math.max(1, Math.ceil(total / pageSize)), hasNext, nextCursor } };
}

async function crmDetail(identity: CrmIdentity, resource: string, id: string) {
  const db = getD1();
  if (resource === "customer") {
    const row = await db.prepare(`SELECT c.*,
      (SELECT COUNT(*) FROM trade_crm_job_details d JOIN trade_work_orders w ON w.id = d.work_order_id
        WHERE d.crm_customer_id = c.id AND d.firebase_uid = c.firebase_uid AND w.record_status = 'active'
          AND (? = 'team' OR w.assignee_member_id = ?)) job_count
      FROM trade_crm_customers c WHERE c.id = ? AND c.firebase_uid = ? AND c.record_status = 'active'`)
      .bind(identity.access.isOwner ? "team" : identity.access.jobScope, identity.memberId,
        id, identity.uid).first<Record<string, unknown>>();
    if (!row) throw new Error("CUSTOMER_NOT_FOUND");
    const [jobs, contacts, sites, siteContacts] = await Promise.all([
      db.prepare(`SELECT w.*, d.crm_customer_id, d.service_site_id, d.customer_source, d.pipeline_stage,
      d.next_action, d.quoted_value_cents, d.invoiced_value_cents, d.paid_value_cents,
      CASE WHEN c.business_name <> '' THEN c.business_name ELSE TRIM(c.first_name || ' ' || c.last_name) END customer_name
      FROM trade_work_orders w JOIN trade_crm_job_details d ON d.work_order_id = w.id AND d.firebase_uid = w.firebase_uid
      LEFT JOIN trade_crm_customers c ON c.id = d.crm_customer_id AND c.firebase_uid = w.firebase_uid
       WHERE d.crm_customer_id = ? AND w.firebase_uid = ? AND w.record_status = 'active'
         AND (? = 'team' OR w.assignee_member_id = ?)
       ORDER BY w.updated_at DESC LIMIT 200`)
        .bind(id, identity.uid, identity.access.isOwner ? "team" : identity.access.jobScope,
          identity.memberId).all<Record<string, unknown>>(),
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
      jobs: jobs.results.map((job: Record<string, unknown>) => indexedJob(job, identity.access)),
    };
  }
  const row = await db.prepare(`SELECT w.*, d.crm_customer_id, d.service_site_id, d.customer_source, d.pipeline_stage, d.building_type, d.description,
    d.customer_reference, d.next_action, d.tags job_tags, d.estimated_value_cents, d.quoted_value_cents,
    d.invoiced_value_cents, d.paid_value_cents, d.quote_status, d.invoice_status, d.payment_due_at,
    CASE WHEN ${tradeJobScheduleEligibilitySql("w", "d")} THEN 1 ELSE 0 END schedule_ready,
    CASE WHEN c.business_name <> '' THEN c.business_name ELSE TRIM(c.first_name || ' ' || c.last_name) END customer_name,
    (SELECT status FROM trade_handover_packs hp WHERE hp.work_order_id = w.id AND hp.firebase_uid = w.firebase_uid ORDER BY hp.updated_at DESC LIMIT 1) handover_status
    FROM trade_work_orders w LEFT JOIN trade_crm_job_details d ON d.work_order_id = w.id AND d.firebase_uid = w.firebase_uid
    LEFT JOIN trade_crm_customers c ON c.id = d.crm_customer_id AND c.firebase_uid = w.firebase_uid
    WHERE w.id = ? AND w.firebase_uid = ? AND w.partner_type = 'installer' AND w.record_status = 'active'
      AND (? = 'team' OR w.assignee_member_id = ?)`)
    .bind(id, identity.uid, identity.access.isOwner ? "team" : identity.access.jobScope,
      identity.memberId).first<Record<string, unknown>>();
  if (!row) throw new Error("JOB_NOT_FOUND");
  const protectedCustomer = String(row.customer_source || "") === "platform_private";
  const customerId = protectedCustomer ? "" : String(row.crm_customer_id || "");
  const [tasks, appointments, notes, customer, sites, siteContacts, complianceCases, complianceIntents] = await Promise.all([
    db.prepare("SELECT * FROM trade_work_order_tasks WHERE work_order_id = ? AND firebase_uid = ? ORDER BY status = 'done', due_at = '', due_at, created_at").bind(id, identity.uid).all<Record<string, unknown>>(),
    db.prepare(`SELECT * FROM trade_crm_appointments
      WHERE work_order_id = ? AND firebase_uid = ?
        AND (? = 'team' OR assignee_member_id = ?)
      ORDER BY starts_at, created_at`)
      .bind(id, identity.uid,
        identity.access.isOwner || identity.access.scheduleScope === "team" ? "team" : "own",
        identity.memberId).all<Record<string, unknown>>(),
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
    db.prepare(`SELECT id, case_number, activity_date, activity_snapshot, status, evidence_status, created_at, updated_at
      FROM compliance_cases WHERE work_order_id = ? AND installer_uid = ?
      ORDER BY created_at, id LIMIT 50`).bind(id, identity.uid).all<Record<string, unknown>>(),
    db.prepare(`SELECT * FROM trade_work_order_compliance_intents
      WHERE work_order_id = ? AND installer_uid = ?
      ORDER BY
        CASE status WHEN 'planned' THEN 0 WHEN 'case_linked' THEN 1 ELSE 2 END,
        intent_key,
        revision DESC,
        created_at DESC
      LIMIT 50`)
      .bind(id, identity.uid)
      .all<Record<string, unknown>>(),
  ]);
  const job = indexedJob(row, identity.access);
  const projectedComplianceIntents =
    complianceIntents.results.map(indexedComplianceIntent).filter(Boolean);
  return { customer: customer ? indexedCustomer(customer) : null,
    sites: sites.results.map((site: Record<string, unknown>) => indexedServiceSite(site, siteContacts.results)), job: { ...job,
    tasks: tasks.results.map((item: Record<string, unknown>) => ({ id: item.id, title: item.title, dueAt: item.due_at, status: item.status, completedAt: item.completed_at })),
    appointments: appointments.results.map((item: Record<string, unknown>) => ({ id: item.id, appointmentType: item.appointment_type,
      title: protectedCustomer ? "Job appointment" : item.title, startsAt: item.starts_at, endsAt: item.ends_at,
      assigneeMemberId: String(item.assignee_member_id || ""), assigneeLabel: item.assignee_label,
      status: item.status, notes: protectedCustomer ? "" : item.notes })),
    notes: notes.results.map((item: Record<string, unknown>) => ({ id: item.id, noteType: item.note_type,
      body: item.body, issueStatus: item.issue_status,
      createdAt: item.created_at, updatedAt: item.updated_at })),
    complianceCases: complianceCases.results.map(indexedComplianceCase),
    complianceIntents: projectedComplianceIntents,
    complianceIntent: projectedComplianceIntents[0] || null,
  } };
}

function protectedJobContext(row: Record<string, unknown>) {
  const customerSource = String(row.customer_source || "");
  return row.source_type === "opportunity" || customerSource === "platform_private";
}

function activityJob(row: Record<string, unknown>, protectedContext = false) {
  return {
    id: String(row.work_order_id || ""),
    workNumber: String(row.work_number || ""),
    title: protectedContext ? "Protected job" : String(row.job_title || ""),
  };
}

async function crmBootstrap(identity: CrmIdentity) {
  const db = getD1();
  const [templateRows, memberRows] = await Promise.all([
    db.prepare(`SELECT id, name, title, service_category, priority, description, task_titles, created_at, updated_at
      FROM trade_crm_job_templates WHERE firebase_uid = ? AND record_status = 'active'
      ORDER BY name COLLATE NOCASE LIMIT 60`).bind(identity.uid).all<Record<string, unknown>>(),
    db.prepare(`SELECT id, display_name, status, member_uid FROM trade_team_members
      WHERE owner_uid = ? AND status = 'active' AND id = ?`)
      .bind(identity.uid, identity.memberId).all<Record<string, unknown>>(),
  ]);
  return {
    teamAccess: identity.teamAccess,
    teamMembers: memberRows.results
      .map((row) => ({ id: row.id, displayName: row.display_name, status: row.status,
        isSelf: row.id === identity.memberId, isOwner: row.member_uid === identity.uid })),
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
    db.prepare(`SELECT a.*, w.id work_order_id, w.work_number, w.title job_title, w.source_type, d.customer_source
      FROM trade_crm_appointments a JOIN trade_work_orders w ON w.id = a.work_order_id AND w.firebase_uid = a.firebase_uid
      LEFT JOIN trade_crm_job_details d ON d.work_order_id = w.id AND d.firebase_uid = w.firebase_uid
      WHERE a.firebase_uid = ? AND w.record_status = 'active' AND a.status IN ('scheduled', 'en_route', 'arrived', 'in_progress') AND SUBSTR(a.starts_at, 1, 10) >= ?
        AND (? = 1 OR ? = 'team' OR a.assignee_member_id = ?)
      ORDER BY a.starts_at, a.created_at LIMIT 6`).bind(identity.uid, today,
        identity.access.isOwner ? 1 : 0, identity.access.scheduleScope, identity.memberId).all<Record<string, unknown>>(),
    db.prepare(`SELECT t.*, w.id work_order_id, w.work_number, w.title job_title, w.assignee_member_id, w.source_type, d.customer_source
      FROM trade_work_order_tasks t JOIN trade_work_orders w ON w.id = t.work_order_id AND w.firebase_uid = t.firebase_uid
      LEFT JOIN trade_crm_job_details d ON d.work_order_id = w.id AND d.firebase_uid = w.firebase_uid
      WHERE t.firebase_uid = ? AND w.record_status = 'active' AND t.status = 'pending' AND t.due_at <> '' AND t.due_at < ?
        AND (? = 1 OR ? = 'team' OR w.assignee_member_id = ?)
      ORDER BY t.due_at, t.created_at LIMIT 4`).bind(identity.uid, today,
        identity.access.isOwner ? 1 : 0, identity.access.jobScope, identity.memberId).all<Record<string, unknown>>(),
    db.prepare(`SELECT n.*, w.id work_order_id, w.work_number, w.title job_title, w.assignee_member_id, w.source_type, d.customer_source
      FROM trade_crm_job_notes n JOIN trade_work_orders w ON w.id = n.work_order_id AND w.firebase_uid = n.firebase_uid
      LEFT JOIN trade_crm_job_details d ON d.work_order_id = w.id AND d.firebase_uid = w.firebase_uid
      WHERE n.firebase_uid = ? AND w.record_status = 'active' AND n.note_type = 'issue' AND n.issue_status = 'open'
        AND (? = 1 OR ? = 'team' OR w.assignee_member_id = ?)
      ORDER BY n.updated_at DESC LIMIT 4`).bind(identity.uid,
        identity.access.isOwner ? 1 : 0, identity.access.jobScope, identity.memberId).all<Record<string, unknown>>(),
    db.prepare(`SELECT a.starts_at, a.ends_at, a.assignee_member_id
      FROM trade_crm_appointments a JOIN trade_work_orders w ON w.id = a.work_order_id AND w.firebase_uid = a.firebase_uid
      WHERE a.firebase_uid = ? AND w.partner_type = 'installer' AND w.record_status = 'active'
      AND a.status IN ('scheduled', 'en_route', 'arrived', 'in_progress')
      AND SUBSTR(a.starts_at, 1, 10) >= ? AND SUBSTR(a.starts_at, 1, 10) < ?
      AND (? = 1 OR ? = 'team' OR a.assignee_member_id = ?)
      ORDER BY a.starts_at`).bind(identity.uid, chartStart, chartEnd,
        identity.access.isOwner ? 1 : 0, identity.access.scheduleScope, identity.memberId).all<Record<string, unknown>>(),
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
  const scopedWorkloadAppointments = workloadAppointments.results.filter((appointment) => identity.access.isOwner
    || identity.access.scheduleScope === "team" || appointment.assignee_member_id === identity.memberId);
  for (const appointment of scopedWorkloadAppointments) {
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
      quotedCents: identity.access.canViewQuotes ? Number(financialMetrics?.quoted_cents || 0) : 0,
      invoicedCents: identity.access.canViewInvoices ? Number(financialMetrics?.invoiced_cents || 0) : 0,
      paidCents: identity.access.canViewInvoices ? Number(financialMetrics?.paid_cents || 0) : 0,
      outstandingCents: identity.access.canViewInvoices ? Number(financialMetrics?.outstanding_cents || 0) : 0,
    },
    workload,
    workStages: Object.fromEntries(workStageRows.results.map((row: Record<string, unknown>) => [String(row.stage), Number(row.total || 0)])),
    upcomingAppointments: appointments.results.filter((row) => identity.access.isOwner
      || identity.access.scheduleScope === "team" || row.assignee_member_id === identity.memberId)
      .map((row: Record<string, unknown>) => ({
      id: row.id, appointmentType: row.appointment_type,
      title: protectedJobContext(row) ? "Scheduled work" : row.title, startsAt: row.starts_at,
       endsAt: row.ends_at, assigneeLabel: row.assignee_label, status: row.status,
       notes: protectedJobContext(row) ? "" : row.notes, job: activityJob(row, protectedJobContext(row)),
    })),
    overdueTasks: overdueTasks.results.filter((row) => identity.access.isOwner
      || identity.access.jobScope === "team" || row.assignee_member_id === identity.memberId)
      .map((row: Record<string, unknown>) => ({
       id: row.id, title: protectedJobContext(row) ? "Assigned task" : row.title, dueAt: row.due_at,
       status: row.status, completedAt: row.completed_at, job: activityJob(row, protectedJobContext(row)),
    })),
    openIssues: openIssues.results.filter((row) => identity.access.isOwner
      || identity.access.jobScope === "team" || row.assignee_member_id === identity.memberId)
      .map((row: Record<string, unknown>) => ({
       id: row.id, noteType: row.note_type, body: protectedJobContext(row) ? "Protected job issue" : row.body,
       issueStatus: row.issue_status, createdAt: row.created_at, updatedAt: row.updated_at,
       job: activityJob(row, protectedJobContext(row)),
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
  const ownOnly = !identity.access.isOwner && identity.access.scheduleScope === "own";
  const [countRow, rows] = await Promise.all([
    includeTotal ? db.prepare(`SELECT COUNT(*) total FROM trade_crm_appointments a JOIN trade_work_orders w ON w.id = a.work_order_id AND w.firebase_uid = a.firebase_uid
      WHERE a.firebase_uid = ? AND (? = 0 OR a.assignee_member_id = ?) AND w.record_status = 'active'
        AND a.status IN ('scheduled', 'en_route', 'arrived', 'in_progress') AND SUBSTR(a.starts_at, 1, 10) >= ?`)
      .bind(identity.uid, ownOnly ? 1 : 0, identity.memberId, today).first<Record<string, unknown>>() : Promise.resolve(null),
    db.prepare(`SELECT a.*, w.id work_order_id, w.work_number, w.title job_title, w.source_type, d.customer_source
      FROM trade_crm_appointments a JOIN trade_work_orders w ON w.id = a.work_order_id AND w.firebase_uid = a.firebase_uid
      LEFT JOIN trade_crm_job_details d ON d.work_order_id = w.id AND d.firebase_uid = w.firebase_uid
      WHERE a.firebase_uid = ? AND (? = 0 OR a.assignee_member_id = ?) AND w.record_status = 'active'
        AND a.status IN ('scheduled', 'en_route', 'arrived', 'in_progress') AND SUBSTR(a.starts_at, 1, 10) >= ?
      ${cursorWhere ? `AND (${cursorWhere.sql})` : ""}
      ORDER BY ${SCHEDULE_SORT.orderBy} LIMIT ?`).bind(identity.uid, ownOnly ? 1 : 0, identity.memberId,
        today, ...(cursorWhere?.bindings || []), pageSize + 1).all<Record<string, unknown>>(),
  ]);
  const total = countRow ? Number(countRow.total || 0) : undefined;
  const hasNext = rows.results.length > pageSize; const pageRows = rows.results.slice(0, pageSize);
  const nextCursor = hasNext && pageRows.length ? encodeKeysetCursor("schedule:starts-asc", SCHEDULE_SORT.terms.map((item) => String(pageRows.at(-1)![item.rowKey] || ""))) : "";
  return {
    items: pageRows.map((row: Record<string, unknown>) => ({
       id: row.id, appointmentType: row.appointment_type,
       title: protectedJobContext(row) ? "Job appointment" : row.title, startsAt: row.starts_at,
       endsAt: row.ends_at, assigneeLabel: row.assignee_label, status: row.status,
       notes: protectedJobContext(row) ? "" : row.notes, job: activityJob(row, protectedJobContext(row)),
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
  const job = await db.prepare(`SELECT w.id, w.source_type, w.service_category, w.assignee_member_id, w.revision, w.stage,
      d.customer_source, c.customer_number, c.business_name, c.first_name, c.last_name
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

function parsedCapabilities(value: unknown) {
  try {
    const parsed = JSON.parse(String(value || "[]"));
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch { return []; }
}

async function assertMemberCapability(
  db: D1Database,
  identity: CrmIdentity,
  memberId: string,
  serviceCategory: string,
) {
  const member = await db.prepare(`SELECT display_name, member_uid, capabilities FROM trade_team_members
    WHERE id = ? AND owner_uid = ? AND status = 'active'`)
    .bind(memberId, identity.uid).first<Record<string, unknown>>();
  if (!member) return null;
  if (String(member.member_uid || "") !== identity.uid && serviceCategory
    && !parsedCapabilities(member.capabilities).includes(serviceCategory)) {
    throw new Error("MEMBER_CAPABILITY_REQUIRED");
  }
  return member;
}

function tradeCrmScheduleMemberGuardStatement(
  db: D1Database,
  {
    ownerUid,
    memberId,
    serviceCategory,
    changedAt,
  }: {
    ownerUid: string;
    memberId: string;
    serviceCategory: string;
    changedAt: string;
  },
) {
  return db.prepare(`INSERT INTO trade_crm_write_guards
    (id, firebase_uid, operation_id, step_number, verified, created_at)
    VALUES (?, ?, ?, 1, CASE WHEN EXISTS (
      SELECT 1 FROM trade_team_members selected_member
      WHERE selected_member.id = ? AND selected_member.owner_uid = ? AND selected_member.status = 'active'
        AND (selected_member.member_uid = ? OR ? = '' OR EXISTS (
          SELECT 1 FROM json_each(selected_member.capabilities) WHERE value = ?
        ))
    ) THEN 1 ELSE 0 END, ?)`)
    .bind(
      crypto.randomUUID(),
      ownerUid,
      `schedule-member:${crypto.randomUUID()}`,
      memberId,
      ownerUid,
      ownerUid,
      serviceCategory,
      serviceCategory,
      changedAt,
    );
}

async function assertCustomerDetailAccess(identity: CrmIdentity, customerId: string) {
  if (!identity.access.canViewCustomers) throw new Error("CUSTOMER_VIEW_REQUIRED");
  if (identity.access.isOwner || identity.access.canSearchCustomers) return;
  const linked = await getD1().prepare(`SELECT 1 allowed FROM trade_crm_job_details d
    JOIN trade_work_orders w ON w.id = d.work_order_id AND w.firebase_uid = d.firebase_uid
    WHERE d.crm_customer_id = ? AND w.firebase_uid = ? AND w.partner_type = 'installer'
      AND w.record_status = 'active' AND w.assignee_member_id = ? LIMIT 1`)
    .bind(customerId, identity.uid, identity.memberId).first();
  if (!linked) throw new Error("CUSTOMER_VIEW_REQUIRED");
}

export async function GET(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const identity = await crmIdentity(request);
    const url = new URL(request.url);
    const mode = cleanAdminText(url.searchParams.get("mode"), 20);
    const resource = cleanAdminText(url.searchParams.get("resource"), 20);
    const requestedJobId = cleanAdminText(url.searchParams.get("id"), 180);
    if (!identity.access.isOwner && resource === "job" && requestedJobId) {
      await assignedJob(identity.access, requestedJobId);
    }
    const accessPayload = { permissions: {
      canCreateJobs: identity.access.canCreateJobs, canManageJobs: identity.access.canManageJobs,
      canAssignJobs: identity.access.canAssignJobs, jobScope: identity.access.jobScope,
      canViewCustomers: identity.access.canViewCustomers, canManageCustomers: identity.access.canManageCustomers,
      canSearchCustomers: identity.access.canSearchCustomers,
      canViewQuotes: identity.access.canViewQuotes, canManageQuotes: identity.access.canManageQuotes,
      canSendQuotes: identity.access.canSendQuotes, canApplyDiscounts: identity.access.canApplyDiscounts,
      canViewInvoices: identity.access.canViewInvoices, canManageInvoices: identity.access.canManageInvoices,
      canRunReports: identity.access.canRunReports,
    } };
    if (mode === "bootstrap") return adminJson({ ok: true, access: accessPayload, ...(await crmBootstrap(identity)) });
    if (mode === "summary") {
      if (!identity.access.canRunReports) throw new Error("REPORTS_REQUIRED");
      return adminJson({ ok: true, access: accessPayload, ...(await crmSummary(identity)) });
    }
    if (mode === "schedule") {
      const db = getD1(); const timer = routeTimer(); const result = await timer.database(crmSchedule(identity, url));
      return performanceJson({ ok: true, access: accessPayload, ...result }, { db, routeKey: "trade.crm.schedule", startedAt: timer.startedAt, dbDurationMs: timer.dbDurationMs,
        resultCount: result.items.length, cursorUsed: Boolean(url.searchParams.get("cursor")) });
    }
    if (mode === "reports") {
      if (!identity.access.canRunReports) throw new Error("REPORTS_REQUIRED");
      return adminJson({ ok: true, access: accessPayload, ...(await crmReports(identity)) });
    }
    if (mode === "index" && ["jobs", "customers"].includes(resource)) {
      if (resource === "customers" && (!identity.access.canViewCustomers
        || !identity.access.canSearchCustomers)) throw new Error("CUSTOMER_SEARCH_REQUIRED");
      const db = getD1(); const timer = routeTimer(); const result = await timer.database(crmIndex(identity, url, resource));
      return performanceJson({ ok: true, access: accessPayload, ...result }, { db, routeKey: `trade.crm.${resource}`, startedAt: timer.startedAt, dbDurationMs: timer.dbDurationMs,
        resultCount: result.items.length, cursorUsed: Boolean(url.searchParams.get("cursor")) });
    }
    if (mode === "detail" && ["job", "customer"].includes(resource)) {
      const id = cleanAdminText(url.searchParams.get("id"), 180);
      if (!id) return adminJson({ ok: false, error: "Choose a CRM record." }, 400);
      if (resource === "customer") await assertCustomerDetailAccess(identity, id);
      return adminJson({ ok: true, access: accessPayload, ...(await crmDetail(identity, resource, id)) });
    }
    return adminJson({ ok: true, access: accessPayload, ...(await crmBootstrap(identity)) });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const identity = await crmIdentity(request);
    let body: Record<string, unknown>;
    try { body = await boundedCrmRequestBody(request); }
    catch { return adminJson({ ok: false, error: "Invalid CRM request." }, 400); }
    const db = getD1();
    const action = cleanAdminText(body.action, 40);
    const now = new Date().toISOString();

    const createActions = new Set(["create_template", "create_job", "create_scheduled_job"]);
    if (createActions.has(action) && !canCreateJobs(identity.access)) throw new Error("JOB_CREATE_REQUIRED");
    const manageActions = new Set(["create_note", "add_task"]);
    if (manageActions.has(action) && !canManageJobs(identity.access)) throw new Error("JOB_MANAGEMENT_REQUIRED");
    const selfScheduledCreate = action === "create_scheduled_job"
      && identity.access.jobScope === "own"
      && ["", identity.memberId].includes(cleanAdminText(body.assigneeMemberId, 180));
    if (["create_scheduled_job", "create_appointment"].includes(action)
      && !identity.access.isOwner && !identity.access.canRescheduleJobs
      && !selfScheduledCreate) throw new Error("JOB_RESCHEDULE_REQUIRED");
    const actionJobId = cleanAdminText(body.workOrderId, 180);
    if (!identity.access.isOwner && actionJobId && manageActions.has(action)) {
      await assignedJob(identity.access, actionJobId);
    }
    const customerActions = new Set(["create_customer", "create_customer_contact", "create_service_site", "link_site_contact"]);
    if (customerActions.has(action) && !identity.access.canManageCustomers) throw new Error("CUSTOMER_MANAGEMENT_REQUIRED");
    if (action === "find_customer_duplicates" && (!identity.access.canViewCustomers
      || !identity.access.canSearchCustomers)) throw new Error("CUSTOMER_SEARCH_REQUIRED");
    if (action === "find_field_customer_by_email" && !canCreateJobs(identity.access)) {
      throw new Error("JOB_CREATE_REQUIRED");
    }

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

    if (action === "find_field_customer_by_email") {
      const email = cleanAdminText(body.email, 180).toLowerCase();
      if (!EMAIL_PATTERN.test(email)) return adminJson({ ok: true, duplicateCandidates: [] });
      const duplicateCandidates = (await findDirectCustomerDuplicates(db, identity.uid, { email }))
        .filter((candidate) => candidate.reasons.includes("email"));
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
      if (!email) return adminJson({ ok: false, error: "Add the customer email address." }, 400);
      if (!EMAIL_PATTERN.test(email)) return adminJson({ ok: false, error: "Check the customer email address." }, 400);
      if (phone.replace(/\D/g, "").length < 8) return adminJson({ ok: false, error: "Add a valid customer mobile number." }, 400);
      const id = crypto.randomUUID();
      const contactId = crypto.randomUUID();
      const siteId = crypto.randomUUID();
      const customerNumber = `CUS-${now.slice(2, 7).replace("-", "")}-${id.replaceAll("-", "").slice(0, 5).toUpperCase()}`;
      const address = await resolvedAddressWrite(body, identity);
      await db.batch([db.prepare(`INSERT INTO trade_crm_customers
        (id, firebase_uid, customer_number, customer_type, first_name, last_name, business_name, business_number, email,
         phone, address_line_1, address_line_2, suburb, address_state, postcode, tags, private_notes,
         record_status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`)
        .bind(id, identity.uid, customerNumber, customerType, firstName, lastName, businessName, businessNumber, email,
          phone, address.addressLine1, address.addressLine2, address.suburb, address.addressState, address.postcode,
          JSON.stringify(cleanList(body.tags)), cleanAdminText(body.privateNotes, 2000), now, now),
        db.prepare(`INSERT INTO trade_crm_customer_contacts
          (id, firebase_uid, customer_id, first_name, last_name, role_label, email, phone, is_primary, record_status, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, 'Primary contact', ?, ?, 1, 'active', ?, ?)`)
          .bind(contactId, identity.uid, id, firstName, lastName, email, phone, now, now),
        db.prepare(`INSERT INTO trade_crm_service_sites
          (id, firebase_uid, customer_id, site_label, address_line_1, address_line_2, suburb, address_state, postcode,
           address_entry_mode, address_provider, address_provider_reference, address_formatted, address_verified_at,
           access_instructions, parking_instructions, hazard_notes, is_primary, record_status, created_at, updated_at)
          VALUES (?, ?, ?, 'Primary site', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', '', '', 1, 'active', ?, ?)`)
          .bind(siteId, identity.uid, id, address.addressLine1, address.addressLine2, address.suburb, address.addressState, address.postcode,
            address.addressEntryMode, address.addressProvider, address.addressProviderReference, address.addressFormatted,
            address.addressVerifiedAt, now, now),
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
      const siteLabel = cleanAdminText(body.siteLabel, 100) || "Service address";
      const address = await resolvedAddressWrite(body, identity);
      if (!addressHasContent(address)) {
        return adminJson({ ok: false, error: "Add the service street, suburb, state and four-digit postcode." }, 400);
      }
      const siteId = crypto.randomUUID();
      const contactId = cleanAdminText(body.customerContactId, 180);
      if (contactId) await ownedContact(db, identity, contactId, customerId);
      const statements = [db.prepare(`INSERT INTO trade_crm_service_sites
        (id, firebase_uid, customer_id, site_label, address_line_1, address_line_2, suburb, address_state, postcode,
         address_entry_mode, address_provider, address_provider_reference, address_formatted, address_verified_at,
         access_instructions, parking_instructions, hazard_notes, is_primary, record_status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'active', ?, ?)`)
        .bind(siteId, identity.uid, customerId, siteLabel, address.addressLine1, address.addressLine2,
          address.suburb, address.addressState, address.postcode, address.addressEntryMode, address.addressProvider,
          address.addressProviderReference, address.addressFormatted, address.addressVerifiedAt,
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
      const complianceActivityVersionId = cleanAdminText(body.complianceActivityVersionId, 180);
      if (complianceActivityVersionId) {
        return adminJson({
          ok: false,
          error: "The governed activity version is resolved during compliance review. Choose the program and activity instead.",
        }, 409);
      }
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
      const boundedFieldCustomerAttach = guided
        && !createCustomer
        && Boolean(customerId)
        && serviceSiteMode !== "new"
        && identity.access.jobScope === "own";
      if ((customerId || (!createCustomer && serviceSiteMode === "new"))
        && !identity.access.canManageCustomers
        && !boundedFieldCustomerAttach) throw new Error("CUSTOMER_MANAGEMENT_REQUIRED");
      const firstName = cleanAdminText(body.firstName, 80);
      const lastName = cleanAdminText(body.lastName, 80);
      const businessName = cleanAdminText(body.businessName, 140);
      const businessNumber = cleanAdminText(body.businessNumber, 30);
      const customerType = CUSTOMER_TYPES.has(cleanAdminText(body.customerType, 20)) ? cleanAdminText(body.customerType, 20) : "residential";
      const email = cleanAdminText(body.email, 180).toLowerCase();
      const phone = cleanAdminText(body.phone, 40);
      const siteLabel = cleanAdminText(body.siteLabel, 100) || "Primary site";
      const addressProvenance = createCustomer || serviceSiteMode === "new"
        ? await resolveTradeAddressProvenance({
          addressLine1: body.addressLine1,
          addressLine2: body.addressLine2,
          suburb: body.suburb,
          addressState: body.addressState,
          postcode: body.postcode,
          addressEntryMode: body.addressEntryMode,
          addressProvider: body.addressProvider,
          addressProviderReference: body.addressProviderReference,
          addressFormatted: body.addressFormatted,
          addressSelectionProof: body.addressSelectionProof,
        }, {
          ownerUid: identity.uid,
          secret: String(integrationEnvironment().CRM_INTEGRATION_ENCRYPTION_KEY || ""),
        })
        : null;
      const addressLine1 = addressProvenance?.addressLine1 || "";
      const addressLine2 = addressProvenance?.addressLine2 || "";
      const suburb = addressProvenance?.suburb || "";
      const addressState = addressProvenance?.addressState || "";
      const postcode = addressProvenance?.postcode || "";
      const intakeStatements: D1PreparedStatement[] = [];
      let sourceEnquirySiteAdopted = false;
      if (createCustomer) {
        const customerCount = await db.prepare("SELECT COUNT(*) count FROM trade_crm_customers WHERE firebase_uid = ? AND record_status = 'active'")
          .bind(identity.uid).first<Record<string, unknown>>();
        if (Number(customerCount?.count || 0) >= CRM_CUSTOMER_LIMIT) throw new Error("CUSTOMER_LIMIT_REACHED");
        if (customerType === "business" ? !businessName : !firstName && !lastName) return adminJson({ ok: false, error: customerType === "business" ? "Add the business name." : "Add the customer name." }, 400);
        if (!email) return adminJson({ ok: false, error: "Add the customer email address." }, 400);
        if (!EMAIL_PATTERN.test(email)) return adminJson({ ok: false, error: "Check the customer email address." }, 400);
        if (phone.replace(/\D/g, "").length < 8) return adminJson({ ok: false, error: "Add a valid customer mobile number." }, 400);
        if (!addressLine1 || !suburb || !ADDRESS_STATES.has(addressState) || !/^\d{4}$/.test(postcode)) return adminJson({ ok: false, error: "Add the service street, suburb, state and four-digit postcode." }, 400);
        const duplicateCandidates = await findDirectCustomerDuplicates(db, identity.uid, { email, phone, businessNumber, addressLine1, suburb, addressState, postcode });
        const duplicateOverride = body.duplicateOverride === true || body.duplicateOverride === "true" || body.duplicateOverride === "on";
        if (duplicateCandidates.length && !duplicateOverride) return adminJson({ ok: false,
          error: identity.access.canViewCustomers && identity.access.canSearchCustomers
            ? "A matching customer already exists. Select that customer or review the match before continuing."
            : "A matching customer already exists. Ask an authorised office user to review it before continuing.",
          ...(identity.access.canViewCustomers && identity.access.canSearchCustomers ? { duplicateCandidates } : {}) }, 409);
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
             address_entry_mode, address_provider, address_provider_reference, address_formatted, address_verified_at,
             access_instructions, parking_instructions, hazard_notes, is_primary, record_status, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', '', '', 1, 'active', ?, ?)`)
            .bind(serviceSiteId, identity.uid, customerId, siteLabel, addressLine1, addressLine2, suburb, addressState, postcode,
              addressProvenance?.addressEntryMode || "manual_pending_review",
              addressProvenance?.addressProvider || "",
              addressProvenance?.addressProviderReference || "",
              addressProvenance?.addressFormatted || "",
              addressProvenance?.addressVerifiedAt || "",
              now, now),
          db.prepare(`INSERT INTO trade_crm_site_contacts
            (id, firebase_uid, service_site_id, customer_contact_id, role_label, is_primary, record_status, created_at, updated_at)
            VALUES (?, ?, ?, ?, 'Primary service contact', 1, 'active', ?, ?)`)
            .bind(crypto.randomUUID(), identity.uid, serviceSiteId, contactId, now, now),
        );
      }
      if (customerId) {
        if (!createCustomer) existingCustomer = await ownedCustomer(db, identity, customerId);
        if (boundedFieldCustomerAttach
          && !(await directCustomerHasEmail(db, identity.uid, customerId, email))) {
          throw new Error("CUSTOMER_MANAGEMENT_REQUIRED");
        }
        if (!createCustomer && serviceSiteMode === "new") {
          if (!addressLine1 || !suburb || !ADDRESS_STATES.has(addressState) || !/^\d{4}$/.test(postcode)) return adminJson({ ok: false, error: "Add the service street, suburb, state and four-digit postcode." }, 400);
          serviceSiteId = crypto.randomUUID();
          intakeStatements.push(db.prepare(`INSERT INTO trade_crm_service_sites
            (id, firebase_uid, customer_id, site_label, address_line_1, address_line_2, suburb, address_state, postcode,
             address_entry_mode, address_provider, address_provider_reference, address_formatted, address_verified_at,
             access_instructions, parking_instructions, hazard_notes, is_primary, record_status, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', '', '', 0, 'active', ?, ?)`)
            .bind(serviceSiteId, identity.uid, customerId, siteLabel, addressLine1, addressLine2, suburb, addressState, postcode,
              addressProvenance?.addressEntryMode || "manual_pending_review",
              addressProvenance?.addressProvider || "",
              addressProvenance?.addressProviderReference || "",
              addressProvenance?.addressFormatted || "",
              addressProvenance?.addressVerifiedAt || "",
              now, now));
        } else if (!serviceSiteId) {
          const primarySite = await db.prepare(`SELECT id FROM trade_crm_service_sites
            WHERE customer_id = ? AND firebase_uid = ? AND record_status = 'active' ORDER BY is_primary DESC, created_at LIMIT 1`)
            .bind(customerId, identity.uid).first<Record<string, unknown>>();
          serviceSiteId = String(primarySite?.id || "");
        }
        if (serviceSiteId && !createCustomer && serviceSiteMode !== "new") await ownedServiceSite(db, identity, serviceSiteId, customerId);
      }
      if (!customerId && serviceSiteId) throw new Error("SERVICE_SITE_NOT_FOUND");
      const sourceEnquiryId = cleanAdminText(body.sourceEnquiryId, 180);
      if (sourceEnquiryId) {
        const enquiry = await db.prepare(`SELECT id, customer_id, service_site_id,
            record_status
          FROM trade_crm_enquiries
          WHERE id = ? AND firebase_uid = ? AND protected_source = 0
            AND record_status = 'active'`)
          .bind(sourceEnquiryId, identity.uid)
          .first<Record<string, unknown>>();
        const enquiryCustomerId = String(enquiry?.customer_id || "");
        const enquiryServiceSiteId = String(enquiry?.service_site_id || "");
        sourceEnquirySiteAdopted = Boolean(
          enquiry
          && enquiryCustomerId === customerId
          && !enquiryServiceSiteId
          && !createCustomer
          && serviceSiteMode === "new"
          && serviceSiteId,
        );
        if (
          !enquiry
          || enquiryCustomerId !== customerId
          || (
            enquiryServiceSiteId !== serviceSiteId
            && !sourceEnquirySiteAdopted
          )
        ) {
          return adminJson({
            ok: false,
            error: "The converted enquiry no longer matches this customer and service site.",
          }, 409);
        }
        if (sourceEnquirySiteAdopted) {
          const adoptionOperationId = crypto.randomUUID();
          intakeStatements.push(
            db.prepare(`UPDATE trade_crm_enquiries
              SET service_site_id = ?, updated_at = ?
              WHERE id = ? AND firebase_uid = ? AND customer_id = ?
                AND service_site_id = '' AND protected_source = 0
                AND record_status = 'active'`)
              .bind(
                serviceSiteId,
                now,
                sourceEnquiryId,
                identity.uid,
                customerId,
              ),
            db.prepare(`INSERT INTO trade_crm_write_guards (
                id, firebase_uid, operation_id, step_number, verified, created_at
              ) VALUES (?, ?, ?, 1,
                CASE WHEN changes() = 1 THEN 1 ELSE 0 END, ?)`)
              .bind(
                crypto.randomUUID(),
                identity.uid,
                adoptionOperationId,
                now,
              ),
            db.prepare(`INSERT INTO trade_crm_enquiry_events (
                id, enquiry_id, firebase_uid, event_type, summary, created_at
              ) VALUES (?, ?, ?, 'service_site_attached',
                'New service site attached during converted-enquiry job creation.',
                ?)`)
              .bind(
                crypto.randomUUID(),
                sourceEnquiryId,
                identity.uid,
                now,
              ),
          );
        }
      }
      let serviceSite = serviceSiteId
        ? createCustomer || serviceSiteMode === "new"
          ? {
            address_line_1: addressLine1,
            address_line_2: addressLine2,
            suburb,
            address_state: addressState,
            postcode,
          }
          : await ownedServiceSite(db, identity, serviceSiteId, customerId)
        : null;
      if (guided && serviceSite) {
        const canonicalSite = canonicalAustralianAddress({
          addressLine1: serviceSite.address_line_1,
          addressLine2: serviceSite.address_line_2,
          suburb: serviceSite.suburb,
          addressState: serviceSite.address_state,
          postcode: serviceSite.postcode,
        });
        serviceSite = {
          ...serviceSite,
          address_line_1: canonicalSite.addressLine1,
          address_line_2: canonicalSite.addressLine2,
          suburb: canonicalSite.suburb,
          address_state: canonicalSite.addressState,
          postcode: canonicalSite.postcode,
        };
      }
      const complianceIntents = resolveTradeComplianceIntents({
        mode: body.complianceIntentMode,
        activities: body.complianceActivitiesJson,
        programTemplateId: body.programTemplateId,
        activityTemplateId: body.activityTemplateId,
        siteJurisdiction: serviceSite?.address_state,
        plannedStart: cleanAdminText(body.startsAt || body.scheduledStart, 40),
      });
      const templateId = cleanAdminText(body.templateId, 180);
      const template = templateId ? await db.prepare(`SELECT * FROM trade_crm_job_templates
        WHERE id = ? AND firebase_uid = ? AND record_status = 'active'`).bind(templateId, identity.uid).first<Record<string, unknown>>() : null;
      if (templateId && !template) return adminJson({ ok: false, error: "Job template not found." }, 404);
      const requestedCategory = cleanAdminText(body.serviceCategory, 60)
        || cleanAdminText(template?.service_category, 60);
      const serviceCategory = SERVICE_CATEGORIES.has(requestedCategory) ? requestedCategory : "other";
      if (!rentalInspectionServiceAddressAccepted(serviceCategory, serviceSite?.address_state)) {
        return adminJson({ ok: false, error: "Rental inspections require a Victorian service address." }, 400);
      }
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
      const requestedAssigneeMemberId = cleanAdminText(body.assigneeMemberId, 180);
      const assigneeMemberId = requestedAssigneeMemberId || (guided ? identity.memberId : "");
      let assignee = "";
      let assigneeUid = "";
      if (assigneeMemberId) {
        if (!identity.access.isOwner && identity.access.jobScope === "own" && assigneeMemberId !== identity.memberId) {
          throw new Error("JOB_ASSIGN_REQUIRED");
        }
        if (requestedAssigneeMemberId && assigneeMemberId !== identity.memberId
          && !canAssignJob(identity.access, "", assigneeMemberId)) {
          throw new Error("JOB_ASSIGN_REQUIRED");
        }
        const member = await assertMemberCapability(db, identity, assigneeMemberId, serviceCategory);
        if (!member) return adminJson({ ok: false, error: "Choose an available team member." }, 400);
        assignee = String(member.display_name || "");
        assigneeUid = String(member.member_uid || "");
      }
      const appointmentType = APPOINTMENT_TYPES.has(cleanAdminText(body.appointmentType, 30)) ? cleanAdminText(body.appointmentType, 30) : "site_visit";
      let appointmentId = "";
      let appointmentTitle = "";
      if (guided) {
        if (!customerId || !serviceSiteId) return adminJson({ ok: false, error: "Attach a customer and service address before scheduling." }, 400);
        if (!assigneeMemberId) return adminJson({ ok: false, error: "Choose an available team member." }, 400);
        scheduledStart = dateValue(body.startsAt);
        if (!scheduledStart) return adminJson({ ok: false, error: "Choose an appointment start." }, 400);
        assertAppointmentSlot(scheduledStart.slice(0, 16));
        assertFutureAppointment(scheduledStart.slice(0, 16), australiaLocalDateTime(identity.addressState));
        try { scheduledEnd = appointmentEndsAt(scheduledStart.slice(0, 16), body.durationMinutes); }
        catch { return adminJson({ ok: false, error: "Choose a duration from 15 minutes to 8 hours in 15-minute steps." }, 400); }
        appointmentId = crypto.randomUUID();
        appointmentTitle = `${displayName} ${SERVICE_LABELS[serviceCategory]}`.trim();
        await assertTradeScheduleAvailable({
          ownerUid: identity.uid,
          memberId: assigneeMemberId,
          startsAt: scheduledStart,
          endsAt: scheduledEnd,
        });
      }
      const templateTasks = template ? cleanTemplateTasks(storedList(template.task_titles, 24)) : [];
      let serviceArea = cleanAdminText(body.siteArea, 80);
      if (serviceSite) serviceArea = [serviceSite.suburb, serviceSite.address_state, serviceSite.postcode].filter(Boolean).join(" ").trim();
      const creditexOrganisation = complianceIntents.length
        ? await db.prepare(`SELECT id FROM compliance_organisations
            WHERE organisation_code = ? AND status = 'active' LIMIT 1`)
          .bind(CREDITEX_PARTNER_ORGANISATION_CODE)
          .first<Record<string, unknown>>()
        : null;
      if (complianceIntents.length && !creditexOrganisation?.id) {
        throw new TradeComplianceIntentError(
          "CREDITEX_PARTNER_UNAVAILABLE",
          "Compliance planning is not configured. Create an ordinary job or ask TLink support to restore the compliance connection.",
        );
      }
      const preparedComplianceIntents = await Promise.all(
        complianceIntents.map(async (intent) => {
          const snapshot = stableTradeComplianceIntentJson({
            ...intent.snapshot,
            plannedStart: scheduledStart,
          });
          return {
            intent,
            intentKey:
              `program:${intent.program.templateId}:activity:${intent.activity.templateId}`,
            snapshot,
            snapshotSha256: await sha256Text(snapshot),
          };
        }),
      );
      const recordStage = guided ? "scheduled" : "backlog";
      const pipelineStage = guided ? "scheduled" : "enquiry";
      const rentalModuleKeys = serviceCategory === RENTAL_INSPECTION_SERVICE_CATEGORY
        ? normalizeRentalAssessmentModules(body.rentalInspectionModulesJson)
        : [];
      if (serviceCategory === RENTAL_INSPECTION_SERVICE_CATEGORY && !rentalModuleKeys.length) {
        return adminJson({ ok: false, error: "Choose at least one rental assessment or safety-check module." }, 400);
      }
      const rentalTemplate = rentalModuleKeys.length
        ? rentalAssessmentTemplateSnapshot(rentalModuleKeys)
        : null;
      const rentalCompatibilityModuleKeys = rentalTemplate
        ? ["minimum_standards", ...rentalModuleKeys.filter((moduleKey) => moduleKey !== "minimum_standards")]
        : [];
      const rentalInspectionId = rentalTemplate ? crypto.randomUUID() : "";
      const rentalInspectionNumber = rentalTemplate ? `RMS-${workNumber.replace(/^TLJ-/, "")}` : "";
      if (rentalTemplate) await ensureTradeRentalSchemaGuards(db);
      const rentalPropertySnapshot = rentalTemplate ? JSON.stringify({
        schemaVersion: "tlink-rental-property-v1",
        customer: {
          id: customerId,
          displayName,
          email: createCustomer ? email : String(existingCustomer?.email || ""),
          phone: createCustomer ? phone : String(existingCustomer?.phone || ""),
        },
        property: {
          serviceSiteId,
          buildingType,
          addressLine1: String(serviceSite?.address_line_1 || ""),
          addressLine2: String(serviceSite?.address_line_2 || ""),
          suburb: String(serviceSite?.suburb || ""),
          state: String(serviceSite?.address_state || ""),
          postcode: String(serviceSite?.postcode || ""),
        },
        appointment: {
          id: appointmentId,
          startsAt: scheduledStart,
          endsAt: scheduledEnd,
          assessorMemberId: assigneeMemberId,
          assessorLabel: assignee,
        },
      }) : "{}";
      const batchStatements: D1PreparedStatement[] = [
        ...intakeStatements,
        db.prepare(`INSERT INTO trade_work_orders
          (id, firebase_uid, partner_type, work_type, source_type, source_reference, work_number, title,
           service_category, site_area, stage, priority, scheduled_start, scheduled_end, assignee_member_id, assignee_label,
             record_status, created_at, updated_at)
          VALUES (?, ?, 'installer', 'job', 'internal', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`)
          .bind(workOrderId, identity.uid, sourceEnquiryId, workNumber, title, serviceCategory, serviceArea,
            recordStage, priority, scheduledStart, scheduledEnd, assigneeMemberId, assignee, now, now),
        db.prepare(`INSERT INTO trade_crm_job_details
          (id, work_order_id, firebase_uid, crm_customer_id, service_site_id, customer_source, pipeline_stage, building_type, description,
           customer_reference, next_action, tags, estimated_value_cents, quoted_value_cents,
            invoiced_value_cents, paid_value_cents, quote_status, invoice_status, payment_due_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 'not_started', 'not_started', '', ?, ?)`)
          .bind(crypto.randomUUID(), workOrderId, identity.uid, customerId, serviceSiteId, customerId ? "trade_owned" : "internal",
            pipelineStage, buildingType, cleanAdminText(body.description, 3000) || cleanAdminText(template?.description, 3000), "", cleanAdminText(body.nextAction, 200),
            JSON.stringify(cleanList(body.tags)), moneyValue(body.estimatedValueCents), now, now),
        db.prepare(`INSERT INTO trade_work_order_events (id, work_order_id, firebase_uid, event_type, summary, created_at)
          VALUES (?, ?, ?, 'work_created', ?, ?)`).bind(crypto.randomUUID(), workOrderId, identity.uid,
            sourceEnquiryId ? `${workNumber} created from converted enquiry ${sourceEnquiryId}.` : `${workNumber} created in installer CRM.`, now),
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
          tradeCrmScheduleMemberGuardStatement(db, {
            ownerUid: identity.uid,
            memberId: assigneeMemberId,
            serviceCategory,
            changedAt: now,
          }),
          tradeJobScheduleEligibilityGuardStatement(db, {
            ownerUid: identity.uid,
            workOrderId,
            changedAt: now,
          }),
          tradeScheduleAvailabilityGuardStatement(db, {
            ownerUid: identity.uid,
            memberId: assigneeMemberId,
            startsAt: scheduledStart,
            endsAt: scheduledEnd,
            changedAt: now,
            excludeAppointmentId: appointmentId,
          }),
        ] : []),
        ...(rentalTemplate ? [
          db.prepare(`INSERT INTO trade_rental_inspections
            (id, work_order_id, firebase_uid, service_site_id, inspection_number, jurisdiction, status,
             template_key, template_version, rules_effective_from, module_selection_snapshot, selected_modules_snapshot, property_snapshot,
             assessor_uid, assessor_member_id, assessor_snapshot, revision, creation_request_id, issued_report_id,
             submitted_at, issued_at, superseded_at, created_by_uid, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, 'VIC', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, '', '', '', '', ?, ?, ?)`)
            .bind(
              rentalInspectionId,
              workOrderId,
              identity.uid,
              serviceSiteId,
              rentalInspectionNumber,
              guided ? "scheduled" : "draft",
              RENTAL_ASSESSMENT_TEMPLATE_KEY,
              RENTAL_ASSESSMENT_TEMPLATE_VERSION,
              RENTAL_ASSESSMENT_TEMPLATE_EFFECTIVE_FROM,
              JSON.stringify(rentalCompatibilityModuleKeys),
              JSON.stringify(rentalModuleKeys),
              rentalPropertySnapshot,
              assigneeUid,
              assigneeMemberId,
              JSON.stringify({ memberId: assigneeMemberId, uid: assigneeUid, displayName: assignee }),
              workOrderId,
              identity.access.actorUid,
              now,
              now,
            ),
          ...rentalModuleKeys.map((moduleKey) => {
            const moduleTemplate = rentalTemplate.modules[moduleKey];
            return db.prepare(`INSERT INTO trade_rental_inspection_modules
              (id, inspection_id, firebase_uid, module_key, required, selected_required, status, template_version, template_name,
               required_capability, template_snapshot, answers, revision, completed_by_uid, completed_at, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, 'not_started', ?, ?, ?, ?, '{}', 1, '', '', ?, ?)`)
              .bind(
                crypto.randomUUID(),
                rentalInspectionId,
                identity.uid,
                moduleKey,
                moduleKey === "minimum_standards" ? 1 : 0,
                1,
                RENTAL_ASSESSMENT_TEMPLATE_VERSION,
                String(moduleTemplate.title || moduleKey),
                String(moduleTemplate.credentialGate || "qualified_assessor"),
                JSON.stringify(moduleTemplate),
                now,
                now,
              );
          }),
          db.prepare(`INSERT INTO trade_rental_inspection_events
            (id, inspection_id, report_id, report_link_id, firebase_uid, actor_type, actor_uid,
             event_type, request_id, summary, metadata, source_ip_sha256, user_agent_sha256, created_at)
            VALUES (?, ?, '', '', ?, 'owner', ?, 'inspection_attached', ?, ?, ?, '', '', ?)`)
            .bind(
              crypto.randomUUID(),
              rentalInspectionId,
              identity.uid,
              identity.access.actorUid,
              workOrderId,
              `Rental inspection attached with ${rentalModuleKeys.length} module${rentalModuleKeys.length === 1 ? "" : "s"}.`,
              JSON.stringify({ moduleKeys: rentalModuleKeys }),
              now,
            ),
        ] : []),
        ...preparedComplianceIntents.flatMap((preparedIntent) => [
          db.prepare(`INSERT INTO trade_work_order_compliance_intents
            (id, work_order_id, intent_key, installer_uid, compliance_organisation_id, program_template_id,
             activity_template_id, program_code, registry_activity_code, service_category,
             site_jurisdiction, planned_start, catalogue_reviewed_on, intent_snapshot,
             intent_snapshot_sha256, status, compliance_case_id, revision, created_by_uid,
             created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'planned', '', 1, ?, ?, ?)`)
            .bind(
              crypto.randomUUID(),
              workOrderId,
              preparedIntent.intentKey,
              identity.uid,
              String(creditexOrganisation?.id),
              preparedIntent.intent.program.templateId,
              preparedIntent.intent.activity.templateId,
              preparedIntent.intent.program.programCode,
              preparedIntent.intent.activity.registryActivityCode,
              preparedIntent.intent.activity.serviceCategory,
              preparedIntent.intent.snapshot.siteJurisdiction,
              scheduledStart,
              preparedIntent.intent.snapshot.catalogueReviewedOn,
              preparedIntent.snapshot,
              preparedIntent.snapshotSha256,
              identity.uid,
              now,
              now,
            ),
          db.prepare(`INSERT INTO trade_work_order_events
            (id, work_order_id, firebase_uid, event_type, summary, created_at)
            VALUES (?, ?, ?, 'compliance_intent_planned', ?, ?)`)
            .bind(
              crypto.randomUUID(),
              workOrderId,
              identity.uid,
              `${preparedIntent.intent.program.programCode} ${preparedIntent.intent.activity.registryActivityCode || preparedIntent.intent.activity.activityKey} planned for compliance setup review. No regulated case was created.`,
              now,
            ),
        ]),
        ...jobSyncChangeStatements(db, { ownerUid: identity.uid, workOrderId, revision: 1, changedAt: now }),
      ];
      await db.batch(batchStatements);
      let complianceWorkPacks: readonly PlannedComplianceWorkPackReadiness[] = [];
      let workPackBlockers: readonly PlannedComplianceWorkPackBlocker[] = [];
      if (guided && preparedComplianceIntents.length) {
        try {
          complianceWorkPacks = await autoOpenReadyPlannedComplianceWorkPacks(db, {
            workOrderId,
            installerUid: identity.uid,
            actorUid: identity.uid,
            createdAt: now,
          });
          workPackBlockers = complianceWorkPacks.flatMap((item) => item.blockers);
        } catch {
          workPackBlockers = [{
            code: "work_pack_auto_open_failed",
            message: "The job and appointment were saved, but the activity form could not be attached. Refresh the job before field work or ask Creditex to restore the governed form.",
          }];
        }
      }
      const workPackReady = preparedComplianceIntents.length > 0
        && complianceWorkPacks.length === preparedComplianceIntents.length
        && complianceWorkPacks.every((item) => item.workPackReady);
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
      const calendarInviteRequested = guided
        && (body.emailCalendarInvite === true || body.emailCalendarInvite === "true" || body.emailCalendarInvite === "on");
      let calendarInvite: { requested: boolean; status: string; message: string } = {
        requested: false,
        status: "not_requested",
        message: "",
      };
      if (calendarInviteRequested) {
        calendarInvite = await sendDirectAppointmentCalendarInvite({
          appointmentId,
          ownerUid: identity.uid,
          origin: new URL(request.url).origin,
        });
        try {
          await db.prepare(`INSERT INTO trade_work_order_events
            (id, work_order_id, firebase_uid, event_type, summary, created_at)
            VALUES (?, ?, ?, ?, ?, ?)`)
            .bind(
              crypto.randomUUID(),
              workOrderId,
              identity.uid,
              calendarInvite.status === "accepted" ? "customer_calendar_invite_accepted" : "customer_calendar_invite_failed",
              calendarInvite.message,
              new Date().toISOString(),
            ).run();
        } catch {
          calendarInvite = calendarInvite.status === "accepted"
            ? calendarInvite
            : { ...calendarInvite, message: "The job was saved, but the calendar invite needs to be sent again." };
        }
      }
      return adminJson({ ok: true, id: workOrderId, workNumber, customerId, serviceSiteId,
        appointmentId, complianceIntentPlanned: complianceIntents.length > 0,
        complianceIntentCount: complianceIntents.length,
        complianceWorkPacks,
        workPackReady,
        workPackBlockers,
        rentalInspectionAttached: Boolean(rentalTemplate),
        rentalInspectionModuleCount: rentalModuleKeys.length,
        calendarSynced, calendarFailed, calendarInvite }, 201);
    }

    const workOrderId = cleanAdminText(body.workOrderId, 180);
    const job = await ownedJob(db, identity, workOrderId);
    if (action === "add_task") {
      const title = cleanAdminText(body.title, 180);
      const dueAt = dateValue(body.dueAt, true);
      if (!title) return adminJson({ ok: false, error: "Add a checklist item." }, 400);
      if (["completed", "cancelled"].includes(String(job.stage))) throw new Error("TERMINAL_JOB_LOCKED");
      const count = await db.prepare(`SELECT COUNT(*) count FROM trade_work_order_tasks
        WHERE work_order_id = ? AND firebase_uid = ?`).bind(workOrderId, identity.uid).first<Record<string, unknown>>();
      if (Number(count?.count || 0) >= 50) return adminJson({ ok: false, error: "This job has reached its checklist limit." }, 409);
      const taskId = crypto.randomUUID();
      const revision = nextJobRevision(job.revision);
      await guardedOnlineChildMutationBatch(db, [
        db.prepare(`INSERT INTO trade_work_order_tasks
          (id, work_order_id, firebase_uid, title, due_at, status, completed_at, sort_order, created_at, updated_at)
          SELECT ?, ?, ?, ?, ?, 'pending', '', ?, ?, ? WHERE EXISTS (
            SELECT 1 FROM trade_work_orders work_order WHERE work_order.id = ? AND work_order.firebase_uid = ?
              AND work_order.record_status = 'active' AND work_order.stage = ?
              AND work_order.stage NOT IN ('completed', 'cancelled') AND work_order.revision = ?)`)
          .bind(taskId, workOrderId, identity.uid, title, dueAt, Number(count?.count || 0), now, now,
            workOrderId, identity.uid, job.stage, Number(job.revision)),
        db.prepare(`UPDATE trade_work_orders SET revision = ?, updated_at = ?
          WHERE id = ? AND firebase_uid = ? AND record_status = 'active' AND stage = ?
            AND stage NOT IN ('completed', 'cancelled') AND revision = ? AND EXISTS (
              SELECT 1 FROM trade_work_order_tasks child WHERE child.id = ?
                AND child.work_order_id = trade_work_orders.id AND child.firebase_uid = trade_work_orders.firebase_uid
                AND child.revision = 1 AND child.updated_at = ?)`)
          .bind(revision, now, workOrderId, identity.uid, job.stage, Number(job.revision), taskId, now),
        db.prepare(`INSERT INTO trade_work_order_events
          (id, work_order_id, firebase_uid, event_type, summary, created_at)
          VALUES (?, ?, ?, 'task_added', ?, ?)`).bind(crypto.randomUUID(), workOrderId, identity.uid, `Checklist item added: ${title}`, now),
        ...jobSyncChangeStatements(db, { ownerUid: identity.uid, workOrderId, revision, changedAt: now,
          audienceMemberId: String(job.assignee_member_id || "") }),
      ], { childKind: "task", childId: taskId, childRevision: 1, jobRevision: revision,
        jobStage: String(job.stage), ownerUid: identity.uid, updatedAt: now, workOrderId });
      return adminJson({ ok: true, id: taskId });
    }
    if (action === "create_appointment") {
      if (["completed", "cancelled"].includes(String(job.stage))) throw new Error("TERMINAL_JOB_LOCKED");
      const expectedRevision = Number(body.expectedRevision);
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision !== Number(job.revision)) {
        throw new Error("REVISION_CONFLICT");
      }
      await assertTradeJobReadyForScheduling(identity.uid, workOrderId);
      const startsAt = dateValue(body.startsAt);
      let endsAt = "";
      if (!startsAt) return adminJson({ ok: false, error: "Choose an appointment start." }, 400);
      assertAppointmentSlot(startsAt.slice(0, 16));
      assertFutureAppointment(startsAt.slice(0, 16), australiaLocalDateTime(identity.addressState));
      try { endsAt = appointmentEndsAt(startsAt.slice(0, 16), body.durationMinutes); }
      catch { return adminJson({ ok: false, error: "Choose a duration from 15 minutes to 8 hours in 15-minute steps." }, 400); }
      const appointmentType = APPOINTMENT_TYPES.has(cleanAdminText(body.appointmentType, 30)) ? cleanAdminText(body.appointmentType, 30) : "site_visit";
      const currentAssigneeMemberId = String(job.assignee_member_id || "");
      const requestedAssigneeMemberId = cleanAdminText(body.assigneeMemberId, 180);
      if (!requestedAssigneeMemberId) {
        return adminJson({ ok: false, error: "Choose the team member who will attend." }, 400);
      }
      const assigneeMemberId = requestedAssigneeMemberId;
      if (!identity.access.isOwner && identity.access.scheduleScope === "own"
        && assigneeMemberId !== identity.memberId) throw new Error("JOB_RESCHEDULE_REQUIRED");
      const assignmentChanged = currentAssigneeMemberId !== assigneeMemberId;
      if (assignmentChanged && !canAssignJob(identity.access, currentAssigneeMemberId, assigneeMemberId)) {
        throw new Error("JOB_ASSIGN_REQUIRED");
      }
      const member = await assertMemberCapability(db, identity, assigneeMemberId, String(job.service_category || ""));
      if (!member) return adminJson({ ok: false, error: "Choose an available team member." }, 400);
      const rentalInspectionAppointment = String(job.service_category || "") === RENTAL_INSPECTION_SERVICE_CATEGORY;
      if (assignmentChanged || rentalInspectionAppointment) {
        const activeAppointment = await db.prepare(`SELECT id FROM trade_crm_appointments
          WHERE work_order_id = ? AND firebase_uid = ?
            AND status IN ('scheduled', 'en_route', 'arrived', 'in_progress') LIMIT 1`)
          .bind(workOrderId, identity.uid).first();
        if (activeAppointment) {
          throw new Error(rentalInspectionAppointment
            ? "RENTAL_ACTIVE_APPOINTMENT"
            : "ACTIVE_APPOINTMENT_REASSIGN");
        }
      }
      const assignee = String(member.display_name || "");
      const displayName = customerDisplayName(job);
      const appointmentTitle = `${displayName} ${SERVICE_LABELS[String(job.service_category)] || APPOINTMENT_LABELS[appointmentType]}`.trim();
      const appointmentId = crypto.randomUUID();
      await assertTradeScheduleAvailable({ ownerUid: identity.uid, memberId: assigneeMemberId, startsAt, endsAt });
      const jobRevision = nextJobRevision(job.revision);
      const installation = appointmentType === "installation";
      const complianceIntentStatements = installation
        ? await plannedComplianceIntentReplanStatements(db, {
          actorUid: identity.access.actorUid,
          changedAt: now,
          ownerUid: identity.uid,
          plannedStart: startsAt,
          workOrderId,
        })
        : [];
      const statements = [
        ...complianceIntentStatements,
        installation
          ? db.prepare(`UPDATE trade_work_orders
            SET assignee_member_id = ?, assignee_label = ?, scheduled_start = ?, scheduled_end = ?, stage = 'scheduled',
              revision = ?, updated_at = ?
            WHERE id = ? AND firebase_uid = ? AND partner_type = 'installer' AND record_status = 'active'
              AND revision = ? AND stage = ? AND stage NOT IN ('completed', 'cancelled') AND assignee_member_id = ?
              AND (? = 0 OR NOT EXISTS (
                SELECT 1 FROM trade_crm_appointments active_appointment
                WHERE active_appointment.work_order_id = trade_work_orders.id
                  AND active_appointment.firebase_uid = trade_work_orders.firebase_uid
                  AND active_appointment.status IN ('scheduled', 'en_route', 'arrived', 'in_progress')
              ))`)
            .bind(assigneeMemberId, assignee, startsAt, endsAt, jobRevision, now,
              workOrderId, identity.uid, expectedRevision, job.stage, currentAssigneeMemberId,
              assignmentChanged ? 1 : 0)
          : db.prepare(`UPDATE trade_work_orders
            SET assignee_member_id = ?, assignee_label = ?, revision = ?, updated_at = ?
            WHERE id = ? AND firebase_uid = ? AND partner_type = 'installer' AND record_status = 'active'
              AND revision = ? AND stage = ? AND stage NOT IN ('completed', 'cancelled') AND assignee_member_id = ?
              AND (? = 0 OR NOT EXISTS (
                SELECT 1 FROM trade_crm_appointments active_appointment
                WHERE active_appointment.work_order_id = trade_work_orders.id
                  AND active_appointment.firebase_uid = trade_work_orders.firebase_uid
                  AND active_appointment.status IN ('scheduled', 'en_route', 'arrived', 'in_progress')
              ))`)
            .bind(assigneeMemberId, assignee, jobRevision, now, workOrderId, identity.uid,
              expectedRevision, job.stage, currentAssigneeMemberId, assignmentChanged ? 1 : 0),
        previousTradeScheduleMutationGuardStatement(db, {
          changedAt: now,
          ownerUid: identity.uid,
        }),
        db.prepare(`INSERT INTO trade_crm_appointments
        (id, work_order_id, firebase_uid, appointment_type, title, starts_at, ends_at, assignee_member_id, assignee_label,
         status, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'scheduled', ?, ?, ?)`)
        .bind(appointmentId, workOrderId, identity.uid, appointmentType,
          appointmentTitle, startsAt, endsAt, assigneeMemberId, assignee,
          cleanAdminText(body.notes, 1000), now, now),
        ...rentalInspectionAssignmentStatements(db, {
          actorType: identity.access.isOwner ? "owner" : "assessor",
          actorUid: identity.access.actorUid,
          appointment: {
            id: appointmentId,
            startsAt,
            endsAt,
          },
          assigneeLabel: assignee,
          assigneeMemberId,
          changedAt: now,
          jobRevision,
          ownerUid: identity.uid,
          previousAssigneeMemberId: currentAssigneeMemberId,
          workOrderId,
        }),
        tradeCrmScheduleMemberGuardStatement(db, {
          ownerUid: identity.uid,
          memberId: assigneeMemberId,
          serviceCategory: String(job.service_category || ""),
          changedAt: now,
        }),
      ];
      if (installation) {
        statements.push(
          db.prepare(`INSERT INTO trade_work_order_events
            (id, work_order_id, firebase_uid, event_type, summary, created_at)
            VALUES (?, ?, ?, 'installation_scheduled',
              'Planned installation appointment set as the job schedule.', ?)`)
            .bind(
              crypto.randomUUID(),
              workOrderId,
              identity.uid,
              now,
            ),
        );
      }
      statements.push(
        tradeJobScheduleEligibilityGuardStatement(db, {
          ownerUid: identity.uid,
          workOrderId,
          changedAt: now,
        }),
        tradeScheduleAvailabilityGuardStatement(db, {
          ownerUid: identity.uid,
          memberId: assigneeMemberId,
          startsAt,
          endsAt,
          changedAt: now,
          excludeAppointmentId: appointmentId,
        }),
        db.prepare(`INSERT INTO trade_work_order_events
          (id, work_order_id, firebase_uid, event_type, summary, created_at)
          VALUES (?, ?, ?, 'appointment_created', ?, ?)`)
          .bind(crypto.randomUUID(), workOrderId, identity.uid,
            `${APPOINTMENT_LABELS[appointmentType] || "Appointment"} scheduled with ${assignee} for ${startsAt}.`, now),
        ...jobSyncChangeStatements(db, {
          ownerUid: identity.uid,
          workOrderId,
          revision: jobRevision,
          changedAt: now,
          audienceMemberId: assigneeMemberId,
          previousAudienceMemberId: currentAssigneeMemberId,
        }),
      );
      await guardedOnlineJobMutationBatch(db, statements, {
        kind: "assignment",
        assigneeLabel: assignee,
        assigneeMemberId,
        jobRevision,
        jobStage: installation ? "scheduled" : String(job.stage),
        ownerUid: identity.uid,
        updatedAt: now,
        workOrderId,
      });
      let calendarSync = { connected: 0, synced: 0, failed: 0 };
      try { calendarSync = await syncCreatedAppointmentToConnectedCalendars(identity.uid, appointmentId); }
      catch { calendarSync = { connected: 0, synced: 0, failed: 1 }; }
      return adminJson({ ok: true, id: appointmentId, revision: jobRevision, calendarSync }, 201);
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
    try { body = await boundedCrmRequestBody(request); }
    catch { return adminJson({ ok: false, error: "Invalid CRM update." }, 400); }
    const db = getD1();
    const action = cleanAdminText(body.action, 40);
    const customerMutationActions = new Set([
      "bulk_archive_customers", "update_customer_contact", "update_service_site", "update_customer",
    ]);
    const jobMutationActions = new Set([
      "bulk_set_job_priority", "resolve_issue", "archive_template", "update_task",
    ]);
    if (customerMutationActions.has(action) && !identity.access.canManageCustomers) {
      throw new Error("CUSTOMER_MANAGEMENT_REQUIRED");
    }
    if (jobMutationActions.has(action) && !canManageJobs(identity.access)) {
      throw new Error("JOB_MANAGEMENT_REQUIRED");
    }
    if (action === "update_appointment" && !identity.access.isOwner && !identity.access.canRescheduleJobs) {
      throw new Error("JOB_RESCHEDULE_REQUIRED");
    }
    const scopedJobId = cleanAdminText(body.workOrderId, 180);
    if (!identity.access.isOwner && scopedJobId && (jobMutationActions.has(action) || action === "update_job")) {
      await assignedJob(identity.access, scopedJobId);
    }
    if (action === "update_job") {
      const hasAny = (keys: string[]) => keys.some((key) => body[key] !== undefined);
      const operationalFields = ["pipelineStage", "stage", "priority", "buildingType", "description", "nextAction", "tags"];
      const quoteFields = ["quoteStatus", "quotedValueCents", "estimatedValueCents"];
      const invoiceFields = ["invoiceStatus", "invoicedValueCents", "paidValueCents", "paymentDueAt"];
      if (hasAny(operationalFields) && !canManageJobs(identity.access)) throw new Error("JOB_MANAGEMENT_REQUIRED");
      if (hasAny(quoteFields) && !identity.access.isOwner && !identity.access.canManageQuotes) throw new Error("QUOTE_MANAGEMENT_REQUIRED");
      if (hasAny(invoiceFields) && !identity.access.isOwner && !identity.access.canManageInvoices) throw new Error("INVOICE_MANAGEMENT_REQUIRED");
    }
    const now = new Date().toISOString();

    if (action === "update_task") {
      const taskId = cleanAdminText(body.taskId, 180);
      const status = cleanAdminText(body.status, 20);
      if (!taskId || !["pending", "done"].includes(status)) return adminJson({ ok: false, error: "Choose a valid checklist status." }, 400);
      const task = await db.prepare(`SELECT t.work_order_id, t.title, t.revision, w.stage job_stage,
          w.revision job_revision, w.assignee_member_id
        FROM trade_work_order_tasks t JOIN trade_work_orders w ON w.id = t.work_order_id
        WHERE t.id = ? AND t.firebase_uid = ? AND w.firebase_uid = ? AND w.record_status = 'active'`)
        .bind(taskId, identity.uid, identity.uid).first<Record<string, unknown>>();
      if (!task) throw new Error("JOB_NOT_FOUND");
      if (!identity.access.isOwner) await assignedJob(identity.access, String(task.work_order_id));
      if (["completed", "cancelled"].includes(String(task.job_stage))) throw new Error("TERMINAL_JOB_LOCKED");
      const taskRevision = nextJobRevision(task.revision); const jobRevision = nextJobRevision(task.job_revision);
      await guardedOnlineChildMutationBatch(db, [
        db.prepare(`UPDATE trade_work_order_tasks SET status = ?, completed_at = ?, revision = ?, updated_at = ?
          WHERE id = ? AND firebase_uid = ? AND revision = ? AND EXISTS (
            SELECT 1 FROM trade_work_orders work_order WHERE work_order.id = trade_work_order_tasks.work_order_id
              AND work_order.firebase_uid = trade_work_order_tasks.firebase_uid AND work_order.record_status = 'active'
              AND work_order.stage = ? AND work_order.stage NOT IN ('completed', 'cancelled') AND work_order.revision = ?)`)
          .bind(status, status === "done" ? now : "", taskRevision, now, taskId, identity.uid,
            Number(task.revision), task.job_stage, Number(task.job_revision)),
        db.prepare(`UPDATE trade_work_orders SET revision = ?, updated_at = ? WHERE id = ? AND firebase_uid = ?
          AND record_status = 'active' AND stage = ? AND stage NOT IN ('completed', 'cancelled') AND revision = ?
          AND EXISTS (SELECT 1 FROM trade_work_order_tasks child WHERE child.id = ?
            AND child.work_order_id = trade_work_orders.id AND child.firebase_uid = trade_work_orders.firebase_uid
            AND child.revision = ? AND child.updated_at = ?)`)
          .bind(jobRevision, now, task.work_order_id, identity.uid, task.job_stage, Number(task.job_revision),
            taskId, taskRevision, now),
        db.prepare(`INSERT INTO trade_work_order_events
          (id, work_order_id, firebase_uid, event_type, summary, created_at)
          VALUES (?, ?, ?, ?, ?, ?)`).bind(crypto.randomUUID(), task.work_order_id, identity.uid,
            status === "done" ? "task_completed" : "task_reopened",
            `${status === "done" ? "Completed" : "Reopened"}: ${String(task.title)}`, now),
        ...jobSyncChangeStatements(db, { ownerUid: identity.uid, workOrderId: String(task.work_order_id),
          revision: jobRevision, changedAt: now, audienceMemberId: String(task.assignee_member_id || "") }),
      ], { childKind: "task", childId: taskId, childRevision: taskRevision, jobRevision,
        jobStage: String(task.job_stage), ownerUid: identity.uid, updatedAt: now,
        workOrderId: String(task.work_order_id) });
      return adminJson({ ok: true });
    }

    if (action === "bulk_set_job_priority") {
      const ids = cleanIds(body.ids);
      const priority = cleanAdminText(body.priority, 20);
      if (!ids.length || !PRIORITIES.has(priority)) return adminJson({ ok: false, error: "Select jobs and choose a valid priority." }, 400);
      const placeholders = ids.map(() => "?").join(",");
      const rows = await db.prepare(`SELECT id, revision, assignee_member_id FROM trade_work_orders
        WHERE firebase_uid = ? AND partner_type = 'installer' AND record_status = 'active' AND id IN (${placeholders})`)
        .bind(identity.uid, ...ids).all<Record<string, unknown>>();
      if (rows.results.length !== ids.length) return adminJson({ ok: false, error: "One or more selected jobs are no longer available." }, 409);
      if (!identity.access.isOwner && identity.access.jobScope === "own"
        && rows.results.some((row) => row.assignee_member_id !== identity.memberId)) {
        throw new Error("JOB_NOT_ASSIGNED");
      }
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
      const candidate = addressCandidate(body, site);
      if (addressComponentsWereSubmitted(body) && !addressHasContent(candidate)) {
        return adminJson({ ok: false, error: "A service address cannot be empty." }, 400);
      }
      const addressChanged = addressComponentsChanged(site, candidate);
      const address = addressChanged || provenanceWasSubmitted(body)
        ? await resolvedAddressWrite(body, identity, candidate)
        : {
          ...candidate,
          addressEntryMode: String(site.address_entry_mode || "manual_pending_review") as TradeAddressProvenance["addressEntryMode"],
          addressProvider: String(site.address_provider || ""),
          addressProviderReference: String(site.address_provider_reference || ""),
          addressFormatted: String(site.address_formatted || ""),
          addressVerifiedAt: String(site.address_verified_at || ""),
        };
      const statements = [db.prepare(`UPDATE trade_crm_service_sites SET site_label = ?, address_line_1 = ?, address_line_2 = ?,
        suburb = ?, address_state = ?, postcode = ?, address_entry_mode = ?, address_provider = ?,
        address_provider_reference = ?, address_formatted = ?, address_verified_at = ?,
        access_instructions = ?, parking_instructions = ?, hazard_notes = ?, updated_at = ?
        WHERE id = ? AND customer_id = ? AND firebase_uid = ? AND record_status = 'active'`)
        .bind(siteLabel, address.addressLine1, address.addressLine2, address.suburb, address.addressState, address.postcode,
          address.addressEntryMode, address.addressProvider, address.addressProviderReference, address.addressFormatted,
          address.addressVerifiedAt,
          body.accessInstructions === undefined ? site.access_instructions : cleanAdminText(body.accessInstructions, 2000),
          body.parkingInstructions === undefined ? site.parking_instructions : cleanAdminText(body.parkingInstructions, 1000),
          body.hazardNotes === undefined ? site.hazard_notes : cleanAdminText(body.hazardNotes, 2000),
          now, siteId, customerId, identity.uid)];
      if (Boolean(site.is_primary)) statements.push(db.prepare(`UPDATE trade_crm_customers
        SET address_line_1 = ?, address_line_2 = ?, suburb = ?, address_state = ?, postcode = ?, updated_at = ?
        WHERE id = ? AND firebase_uid = ?`)
        .bind(address.addressLine1, address.addressLine2, address.suburb, address.addressState, address.postcode, now, customerId, identity.uid));
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
      const primarySite = await db.prepare(`SELECT * FROM trade_crm_service_sites
        WHERE customer_id = ? AND firebase_uid = ? AND is_primary = 1 AND record_status = 'active' LIMIT 1`)
        .bind(customerId, identity.uid).first<Record<string, unknown>>();
      const candidate = addressCandidate(body, current);
      const addressSubmitted = addressComponentsWereSubmitted(body);
      const addressChanged = addressComponentsChanged(current, candidate)
        || Boolean(addressSubmitted && primarySite && addressComponentsChanged(primarySite, candidate));
      const resolvedAddress = addressChanged || provenanceWasSubmitted(body)
        ? await resolvedAddressWrite(body, identity, candidate)
        : null;
      const address = resolvedAddress || candidate;
      const statements = [db.prepare(`UPDATE trade_crm_customers SET first_name = ?, last_name = ?, business_name = ?, business_number = ?, email = ?,
        phone = ?, address_line_1 = ?, address_line_2 = ?, suburb = ?, address_state = ?, postcode = ?,
        tags = ?, private_notes = ?, updated_at = ? WHERE id = ? AND firebase_uid = ?`)
        .bind(
          firstName, lastName,
          body.businessName === undefined ? current.business_name : cleanAdminText(body.businessName, 140),
          body.businessNumber === undefined ? current.business_number : cleanAdminText(body.businessNumber, 30), email,
          phone, address.addressLine1, address.addressLine2, address.suburb, address.addressState, address.postcode,
          body.tags === undefined ? current.tags : JSON.stringify(cleanList(body.tags)),
          body.privateNotes === undefined ? current.private_notes : cleanAdminText(body.privateNotes, 2000),
          now, customerId, identity.uid,
        ),
        db.prepare(`UPDATE trade_crm_customer_contacts SET first_name = ?, last_name = ?, email = ?, phone = ?, updated_at = ?
          WHERE customer_id = ? AND firebase_uid = ? AND is_primary = 1 AND record_status = 'active'`)
          .bind(firstName, lastName, email, phone, now, customerId, identity.uid),
      ];
      if (primarySite && (addressSubmitted || provenanceWasSubmitted(body))) {
        statements.push(resolvedAddress
          ? db.prepare(`UPDATE trade_crm_service_sites SET address_line_1 = ?, address_line_2 = ?, suburb = ?, address_state = ?, postcode = ?,
              address_entry_mode = ?, address_provider = ?, address_provider_reference = ?, address_formatted = ?, address_verified_at = ?, updated_at = ?
            WHERE id = ? AND customer_id = ? AND firebase_uid = ? AND record_status = 'active'`)
            .bind(resolvedAddress.addressLine1, resolvedAddress.addressLine2, resolvedAddress.suburb, resolvedAddress.addressState,
              resolvedAddress.postcode, resolvedAddress.addressEntryMode, resolvedAddress.addressProvider,
              resolvedAddress.addressProviderReference, resolvedAddress.addressFormatted, resolvedAddress.addressVerifiedAt,
              now, String(primarySite.id), customerId, identity.uid)
          : db.prepare(`UPDATE trade_crm_service_sites SET address_line_1 = ?, address_line_2 = ?, suburb = ?, address_state = ?, postcode = ?, updated_at = ?
            WHERE id = ? AND customer_id = ? AND firebase_uid = ? AND record_status = 'active'`)
            .bind(address.addressLine1, address.addressLine2, address.suburb, address.addressState, address.postcode,
              now, String(primarySite.id), customerId, identity.uid));
      }
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
      if (!canRescheduleWithinScope(identity.access, String(current.assignee_member_id || ""))) {
        throw new Error("JOB_NOT_ASSIGNED");
      }
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
      const note = await db.prepare(`SELECT work_order_id FROM trade_crm_job_notes
        WHERE id = ? AND firebase_uid = ? AND note_type = 'issue'`).bind(noteId, identity.uid).first<Record<string, unknown>>();
      if (!note) throw new Error("NOTE_NOT_FOUND");
      if (!identity.access.isOwner) await assignedJob(identity.access, String(note.work_order_id));
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
    const expectedRevision = Number(body.expectedRevision);
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) {
      return adminJson({ ok: false, error: "Refresh this job before saving changes." }, 400);
    }
    if (expectedRevision !== Number(job.revision)) throw new Error("REVISION_CONFLICT");
    if (["completed", "cancelled"].includes(String(job.stage || ""))) throw new Error("REVISION_CONFLICT");
    const platformPrivate = job.source_type === "opportunity";
    const releasedPublicLead = job.source_type === "public_lead"
      && current?.customer_source === "public_lead_released";
    const pipelineStage = body.pipelineStage === undefined ? String(current?.pipeline_stage || (platformPrivate ? "qualifying" : "enquiry")) : cleanAdminText(body.pipelineStage, 30);
    const workStage = body.stage === undefined ? "" : cleanAdminText(body.stage, 30);
    const priority = body.priority === undefined ? "" : cleanAdminText(body.priority, 20);
    const quoteStatus = body.quoteStatus === undefined ? String(current?.quote_status || "not_started") : cleanAdminText(body.quoteStatus, 20);
    const invoiceStatus = body.invoiceStatus === undefined ? String(current?.invoice_status || "not_started") : cleanAdminText(body.invoiceStatus, 20);
    if (!PIPELINE_STAGES.has(pipelineStage) || !QUOTE_STATUSES.has(quoteStatus) || !INVOICE_STATUSES.has(invoiceStatus)) return adminJson({ ok: false, error: "Choose a valid job, quote and invoice status." }, 400);
    if (workStage && !WORK_STAGES.has(workStage)) return adminJson({ ok: false, error: "Choose a valid work stage." }, 400);
    if (priority && !PRIORITIES.has(priority)) return adminJson({ ok: false, error: "Choose a valid priority." }, 400);
    const customerId = platformPrivate ? "" : releasedPublicLead ? String(current?.crm_customer_id || "") : body.crmCustomerId === undefined ? String(current?.crm_customer_id || "") : cleanAdminText(body.crmCustomerId, 180);
    let serviceSiteId = platformPrivate ? "" : releasedPublicLead ? String(current?.service_site_id || "") : body.serviceSiteId === undefined ? String(current?.service_site_id || "") : cleanAdminText(body.serviceSiteId, 180);
    if ((body.crmCustomerId !== undefined || body.serviceSiteId !== undefined)
      && !identity.access.canManageCustomers) throw new Error("CUSTOMER_MANAGEMENT_REQUIRED");
    if (customerId && !releasedPublicLead) {
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
      customerSource: platformPrivate ? "platform_private" : releasedPublicLead ? "public_lead_released" : customerId ? "trade_owned" : "internal",
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
    if (!identity.access.canApplyDiscounts
      && ((body.estimatedValueCents !== undefined && values.estimated < Number(current?.estimated_value_cents || 0))
        || (body.quotedValueCents !== undefined && values.quoted < Number(current?.quoted_value_cents || 0))
        || (body.invoicedValueCents !== undefined && values.invoiced < Number(current?.invoiced_value_cents || 0)))) {
      throw new Error("DISCOUNT_REQUIRED");
    }
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
    const revision = nextJobRevision(expectedRevision);
    const nextStage = workStage || String(job.stage || "");
    const statements = [detailStatement, db.prepare(`UPDATE trade_work_orders SET stage = ?,
      priority = COALESCE(NULLIF(?, ''), priority), revision = ?, updated_at = ?
      WHERE id = ? AND firebase_uid = ? AND record_status = 'active'
        AND stage = ? AND stage NOT IN ('completed', 'cancelled') AND revision = ?`)
      .bind(nextStage, priority, revision, now, workOrderId, identity.uid, String(job.stage || ""), expectedRevision)];
    statements.push(db.prepare(`INSERT INTO trade_work_order_events (id, work_order_id, firebase_uid, event_type, summary, created_at)
      VALUES (?, ?, ?, 'crm_updated', 'CRM job details updated.', ?)`).bind(crypto.randomUUID(), workOrderId, identity.uid, now));
    statements.push(...jobSyncChangeStatements(db, { ownerUid: identity.uid, workOrderId, revision, changedAt: now,
      audienceMemberId: String(job.assignee_member_id || "") }));
    await guardedOnlineJobMutationBatch(db, statements, {
      kind: "stage",
      ownerUid: identity.uid,
      workOrderId,
      jobStage: nextStage,
      jobRevision: revision,
      updatedAt: now,
    });
    return adminJson({ ok: true, revision });
  } catch (error) { return errorResponse(error); }
}
