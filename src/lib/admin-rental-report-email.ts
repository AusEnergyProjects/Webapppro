import { getD1 } from "../../db";
import { type AdminIdentity, writeAdminAudit } from "./admin-server";
import type { TeamAccess } from "./trade-team-server";
import { ownerRentalReportPresentation } from "./trade-rental-report-server";
import {
  emailRentalAssessmentReport, rentalReportDeliveryRecipient,
  rentalReportDeliveryReview, rentalReportDeliveryState,
} from "./trade-rental-report-email-server";

export class AdminRentalEmailError extends Error {
  constructor(readonly code: string, message: string, readonly status: number) { super(message); }
}

type CurrentReport = {
  work_order_id: string; owner_uid: string; business_name: string;
  inspection_id: string; report_id: string; report_number: string; formatting_pending: number;
};

function identifier(value: unknown) {
  if (typeof value !== "string" || !/^[A-Za-z0-9:_-]{1,180}$/.test(value)) {
    throw new AdminRentalEmailError("REPORT_EMAIL_INPUT_INVALID", "Choose a job and its current issued rental report.", 400);
  }
  return value;
}

function requireSender(admin: AdminIdentity) {
  if (!["owner", "admin"].includes(admin.role)) throw new Error("ROLE_REQUIRED");
}

async function context(workOrderId: string, origin: string) {
  const report = await getD1().prepare(`SELECT work.id work_order_id, work.firebase_uid owner_uid, account.business_name,
      inspection.id inspection_id, report.id report_id, report.report_number,
      EXISTS (SELECT 1 FROM trade_rental_reports pending WHERE pending.inspection_id = inspection.id
        AND pending.firebase_uid = inspection.firebase_uid AND pending.status = 'staged') formatting_pending
    FROM trade_work_orders work JOIN trade_accounts account ON account.firebase_uid = work.firebase_uid
      AND account.partner_type = 'installer'
    JOIN trade_rental_inspections inspection ON inspection.work_order_id = work.id
      AND inspection.firebase_uid = work.firebase_uid AND inspection.status = 'issued'
    JOIN trade_rental_reports report ON report.id = inspection.issued_report_id
      AND report.inspection_id = inspection.id AND report.firebase_uid = work.firebase_uid AND report.status = 'issued'
    WHERE work.id = ? AND work.partner_type = 'installer' AND work.record_status = 'active' LIMIT 1`)
    .bind(identifier(workOrderId)).first<CurrentReport>();
  if (!report) throw new AdminRentalEmailError("RENTAL_REPORT_NOT_FOUND", "This job has no current issued rental report.", 404);
  const [recipient, review, delivery, reports] = await Promise.all([
    rentalReportDeliveryRecipient(report.owner_uid, workOrderId),
    rentalReportDeliveryReview(report.owner_uid, report.inspection_id),
    rentalReportDeliveryState(report.owner_uid, report.inspection_id),
    ownerRentalReportPresentation({ ownerUid: report.owner_uid, inspectionId: report.inspection_id, origin, includeSecret: false }),
  ]);
  const activeLink = reports.find(row => row.id === report.report_id)?.link?.status === "active";
  const message = review?.status === "held" ? review.message
    : report.formatting_pending ? "The corrected report is still being prepared. Email remains paused."
      : !recipient ? "Add the customer email to the job before sending this report."
        : !activeLink ? "Renew the report sharing link before emailing this report."
          : delivery?.message || "The saved report is ready to email.";
  const canSend = Boolean(recipient && activeLink && review?.status !== "held" && !report.formatting_pending
    && !["accepted", "sending", "reconciliation_required"].includes(delivery?.status || ""));
  return { report, recipient, review, delivery, activeLink, message, canSend };
}

export async function adminRentalReportEmailStatus(admin: AdminIdentity, workOrderId: string, origin: string) {
  requireSender(admin);
  const current = await context(workOrderId, origin);
  await writeAdminAudit(admin, "job.report_email_view", "trade_work_order", workOrderId,
    "Checked the issued rental report email status.", { ownerUid: current.report.owner_uid, reportId: current.report.report_id });
  return { reportId: current.report.report_id, reportNumber: current.report.report_number,
    recipientEmail: current.recipient?.email || "", reportDelivery: current.delivery,
    canSend: current.canSend, message: current.message };
}

export async function sendAdminRentalReportEmail(admin: AdminIdentity, body: unknown, origin: string) {
  requireSender(admin);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new AdminRentalEmailError("REPORT_EMAIL_INPUT_INVALID", "Send the job, report and expected recipient.", 400);
  }
  const input = body as Record<string, unknown>;
  const workOrderId = identifier(input.workOrderId), reportId = identifier(input.reportId);
  if (typeof input.expectedRecipientEmail !== "string" || input.expectedRecipientEmail.length > 180
    || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.expectedRecipientEmail.trim())) {
    throw new AdminRentalEmailError("REPORT_RECIPIENT_CHANGED", "Review the current customer email before sending this report.", 409);
  }
  const current = await context(workOrderId, origin);
  if (current.report.report_id !== reportId) {
    throw new AdminRentalEmailError("RENTAL_REPORT_CHANGED", "The issued report changed. Refresh before sending it.", 409);
  }
  if (!current.recipient || current.recipient.email !== input.expectedRecipientEmail.trim().toLowerCase()) {
    throw new AdminRentalEmailError("REPORT_RECIPIENT_CHANGED", "The customer email changed. Refresh before sending this report.", 409);
  }
  if (current.review?.status === "held") return { status: "held", reportId, message: current.message };
  if (current.report.formatting_pending || !current.activeLink) return { status: "failed", reportId, message: current.message };
  if (current.delivery && ["accepted", "sending", "reconciliation_required"].includes(current.delivery.status)) return current.delivery;
  const access: TeamAccess = {
    identity: admin, ownerUid: current.report.owner_uid, actorUid: admin.uid, actorEmail: admin.email,
    memberId: "", displayName: admin.displayName, isOwner: false, businessName: current.report.business_name,
    supportWorkOrderId: workOrderId, canRunReports: true, canViewFieldEvidence: true,
    jobScope: "team", scheduleScope: "team", canCreateJobs: false, canManageJobs: false, canAssignJobs: false,
    canViewLeads: false, canManageLeads: false, canViewCustomers: false, canManageCustomers: false,
    canViewQuotes: false, canManageQuotes: false, canSendQuotes: false, canSendSms: false,
    canReceiveCustomerQaNotifications: false, canViewInvoices: false, canManageInvoices: false,
    canViewPriceBook: false, canManagePriceBook: false, canApplyDiscounts: false, canRescheduleJobs: false,
    canManageTeam: false, canEditTeamPermissions: false, canManageFieldEvidence: false,
    canManageForms: false, canSearchCustomers: false,
  };
  await writeAdminAudit(admin, "job.report_email_requested", "trade_work_order", workOrderId,
    "Requested email delivery of the current issued rental report.",
    { ownerUid: access.ownerUid, reportId, recipientEmail: current.recipient.email });
  const delivery = await emailRentalAssessmentReport({ access, admin: { uid: admin.uid, role: admin.role },
    workOrderId, inspectionId: current.report.inspection_id, reportId,
    expectedRecipientEmail: current.recipient.email, origin });
  await writeAdminAudit(admin, "job.report_email_result", "trade_work_order", workOrderId,
    "Recorded the rental report email result.", { ownerUid: access.ownerUid, reportId, status: delivery.status });
  return delivery;
}
