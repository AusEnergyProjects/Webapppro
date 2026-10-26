import { getD1 } from "../../db";
import { adminError, adminJson, requireAdminIdentity, sameOrigin, writeAdminAudit } from "./admin-server";
import type { TeamAccess } from "./trade-team-server";
import { AdminJobReadError } from "./admin-job-read-error";
export { AdminJobReadError, adminJobReadError } from "./admin-job-read-error";

export const ADMIN_JOB_HEADER = "X-TLink-Admin-Job";

const READ_ROUTES = new Set([
  "/api/trade-crm", "/api/trade-field-work", "/api/trade-job-forms",
  "/api/trade-rental-inspections", "/api/trade-veu-electrical-assessments",
  "/api/field/job-activities", "/api/trade-activity-forms", "/api/trade-team/work-packs",
  "/api/trade-team/work-packs/final-record", "/api/trade-team/work-packs/reference-document",
  "/api/trade-team/work-packs/signature", "/api/trade-safety-checks",
  "/api/trade-swms", "/api/trade-message-job-files", "/api/trade-quotes",
  "/api/trade-quick-invoices", "/api/trade-handover", "/api/trade-handover/documents",
  "/api/trade-job-review", "/api/trade-sms",
  "/api/trade-customer-delivery-exceptions",
  "/api/trade-customer-hub", "/api/trade-job-quote-photos",
]);

function deny(message: string, status = 403): never {
  throw new AdminJobReadError(adminJson({ ok: false, code: "ADMIN_JOB_READ_DENIED", error: message }, status));
}

/** Ordinary trade authentication must never treat a support request as a trade login. */
export function rejectAdminJobAccess(request: Request) {
  if (request.headers.has(ADMIN_JOB_HEADER)) deny("This operation is not available in the read-only admin job view.");
}

export function rejectAdminJobMutation(request: Request) {
  if (request.method !== "GET") rejectAdminJobAccess(request);
}

/** This capability is created only by the server for one authenticated admin and one job. */
export async function requireAdminJobReadAccess(request: Request): Promise<TeamAccess | null> {
  if (!request.headers.has(ADMIN_JOB_HEADER)) return null;
  if (request.method !== "GET" || !sameOrigin(request)) deny("This request is not allowed in the read-only admin job view.");
  const url = new URL(request.url);
  if (!READ_ROUTES.has(url.pathname) && !/^\/api\/trade-rental-inspections\/report\/[^/]+\/pdf$/.test(url.pathname)
    && !/^\/api\/trade-quick-invoices\/[^/]+\/pdf$/.test(url.pathname)) {
    deny("This resource is not part of the admin job view.");
  }
  const workOrderId = request.headers.get(ADMIN_JOB_HEADER)?.trim() || "";
  if (!/^[A-Za-z0-9:_-]{1,180}$/.test(workOrderId)) deny("Choose a job from the admin job register.", 400);
  if (url.searchParams.getAll("workOrderId").some(id => id !== workOrderId)) deny("This resource belongs to another job.");
  if (url.pathname === "/api/trade-crm" && (url.searchParams.get("mode") !== "detail"
    || url.searchParams.get("resource") !== "job" || url.searchParams.get("id") !== workOrderId)) {
    deny("Admin support can open only the selected job.");
  }
  let admin;
  try { admin = await requireAdminIdentity(request, ["owner", "admin", "support"]); }
  catch (error) { throw new AdminJobReadError(adminError(error)); }
  const job = await getD1().prepare(`SELECT w.id, w.firebase_uid, a.business_name
    FROM trade_work_orders w JOIN trade_accounts a ON a.firebase_uid = w.firebase_uid
    WHERE w.id = ? AND w.partner_type = 'installer' AND w.record_status = 'active'
      AND a.partner_type = 'installer' LIMIT 1`).bind(workOrderId)
    .first<{ id: string; firebase_uid: string; business_name: string }>();
  if (!job) deny("This job is not available in the admin job register.", 404);
  await writeAdminAudit(admin, "job.support_view", "trade_work_order", job.id,
    "Opened a read-only job support resource.", { ownerUid: job.firebase_uid, route: url.pathname, role: admin.role });
  return {
    identity: admin, ownerUid: job.firebase_uid, actorUid: admin.uid, actorEmail: admin.email,
    memberId: "", displayName: admin.displayName, isOwner: false, businessName: job.business_name,
    supportWorkOrderId: job.id, canCreateJobs: false, canManageJobs: false, canAssignJobs: false,
    jobScope: "team", canViewLeads: false, canManageLeads: false,
    canViewCustomers: true, canManageCustomers: false, canViewQuotes: true, canManageQuotes: false,
    canSendQuotes: false, canSendSms: false, canReceiveCustomerQaNotifications: false,
    canViewInvoices: true, canManageInvoices: false, canViewPriceBook: false, canManagePriceBook: false,
    canApplyDiscounts: false, scheduleScope: "team", canRescheduleJobs: false,
    canManageTeam: false, canEditTeamPermissions: false, canViewFieldEvidence: true,
    canManageFieldEvidence: false, canManageForms: false, canRunReports: false, canSearchCustomers: false,
  };
}
