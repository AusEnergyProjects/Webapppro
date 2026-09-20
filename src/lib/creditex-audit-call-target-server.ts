import { ComplianceAccessError, isComplianceRole, type ComplianceIdentity } from "./compliance-access-server";
import { CREDITEX_PARTNER_ORGANISATION_CODE } from "./trade-compliance-intent";
import { normalizeAuditCallPhone } from "./creditex-audit-calls";

export type AuditCallActor = Pick<ComplianceIdentity, "organisationId" | "membershipId" | "uid" | "role">;
export type AuditCallTargetInput = { caseId?: string; jobIntentId?: string };
export type AuditCallTarget = {
  caseId: string;
  jobIntentId: string;
  workOrderId: string;
  customerPhone: string;
  canCall: boolean;
  unavailableReason: string;
};
export type StoredAuditCallTarget = {
  organisationId: string;
  memberId: string;
  uid: string;
  caseId: string;
  jobIntentId: string;
  customerPhone: string;
};
type TargetRow = {
  case_id: string | null;
  job_intent_id: string | null;
  work_order_id: string;
  phone: string | null;
  work_status: string | null;
  customer_status: string | null;
  site_status: string | null;
  intent_status: string | null;
};

function unavailable() {
  return new ComplianceAccessError("CREDITEX_CALL_TARGET_UNAVAILABLE", 404, "The authorised audit job or case was not found.");
}

async function currentActor(database: D1Database, actor: Pick<AuditCallActor, "organisationId" | "membershipId" | "uid">) {
  const row = await database.prepare(`SELECT member.role, organisation.organisation_code
    FROM compliance_users member
    JOIN compliance_organisations organisation ON organisation.id = member.organisation_id
    WHERE member.id = ? AND member.firebase_uid = ? AND member.organisation_id = ?
      AND member.status = 'active' AND organisation.status = 'active'`)
    .bind(actor.membershipId, actor.uid, actor.organisationId)
    .first<{ role: string; organisation_code: string }>();
  if (!row || !isComplianceRole(row.role) || row.organisation_code !== CREDITEX_PARTNER_ORGANISATION_CODE) throw unavailable();
  return { ...actor, role: row.role };
}

function targetId(value: unknown) {
  if (value === undefined || value === "") return "";
  if (typeof value !== "string" || !value.trim() || value.length > 180) {
    throw new ComplianceAccessError("CREDITEX_CALL_TARGET_INVALID", 400, "Choose one audit job or case.");
  }
  return value.trim();
}

// Both entry points use the existing Creditex ownership graph. A linked job also
// enforces the formal case assignment, so the job route cannot bypass it.
export async function loadAuditCallTarget(database: D1Database, actorInput: AuditCallActor, input: AuditCallTargetInput): Promise<AuditCallTarget> {
  const caseId = targetId(input.caseId);
  const jobIntentId = targetId(input.jobIntentId);
  if (Boolean(caseId) === Boolean(jobIntentId)) {
    throw new ComplianceAccessError("CREDITEX_CALL_TARGET_INVALID", 400, "Choose one audit job or case.");
  }
  const actor = await currentActor(database, actorInput);
  const assignment = `(? = 'admin' OR EXISTS (
    SELECT 1 FROM compliance_case_assignments assignment
    JOIN compliance_users assigned_member ON assigned_member.id = assignment.compliance_user_id
      AND assigned_member.organisation_id = assignment.organisation_id
    WHERE assignment.case_id = audit_case.id
      AND assignment.organisation_id = audit_case.organisation_id
      AND assignment.status = 'assigned' AND assigned_member.status = 'active'
      AND assigned_member.firebase_uid = ?))`;
  const customerJoins = `LEFT JOIN trade_work_orders work ON work.id = anchor.work_order_id
      AND work.firebase_uid = anchor.installer_uid AND work.partner_type = 'installer'
      AND work.source_type = 'internal'
    LEFT JOIN trade_crm_job_details details ON details.work_order_id = work.id
      AND details.firebase_uid = work.firebase_uid AND details.customer_source = 'trade_owned'
    LEFT JOIN trade_crm_customers customer ON customer.id = details.crm_customer_id
      AND customer.firebase_uid = work.firebase_uid
    LEFT JOIN trade_crm_service_sites site ON site.id = details.service_site_id
      AND site.firebase_uid = work.firebase_uid AND site.customer_id = customer.id`;
  const projection = `anchor.work_order_id, customer.phone,
    work.record_status work_status, customer.record_status customer_status,
    site.record_status site_status`;
  const row = caseId
    ? await database.prepare(`SELECT audit_case.id case_id, '' job_intent_id,
        '' intent_status, ${projection}
      FROM compliance_cases anchor
      JOIN compliance_cases audit_case ON audit_case.id = anchor.id
        AND audit_case.organisation_id = anchor.organisation_id
      ${customerJoins}
      WHERE anchor.id = ? AND anchor.organisation_id = ? AND ${assignment}`)
      .bind(caseId, actor.organisationId, actor.role, actor.uid).first<TargetRow>()
    : await database.prepare(`SELECT audit_case.id case_id, anchor.id job_intent_id,
        anchor.status intent_status, ${projection}
      FROM trade_work_order_compliance_intents anchor
      LEFT JOIN compliance_cases audit_case ON audit_case.id = anchor.compliance_case_id
        AND audit_case.organisation_id = anchor.compliance_organisation_id
        AND audit_case.installer_uid = anchor.installer_uid
        AND audit_case.work_order_id = anchor.work_order_id
      ${customerJoins}
      WHERE anchor.id = ? AND anchor.compliance_organisation_id = ?
        AND (COALESCE(anchor.compliance_case_id, '') = '' OR (audit_case.id IS NOT NULL AND ${assignment}))`)
      .bind(jobIntentId, actor.organisationId, actor.role, actor.uid).first<TargetRow>();
  if (!row) throw unavailable();
  const active = row.work_status === "active" && row.customer_status === "active"
    && row.site_status === "active" && row.intent_status !== "superseded";
  const phone = active ? normalizeAuditCallPhone(row.phone) : "";
  return {
    caseId: row.case_id || "", jobIntentId: row.job_intent_id || "", workOrderId: row.work_order_id,
    customerPhone: phone, canCall: Boolean(phone),
    unavailableReason: !active ? "Calling is unavailable for an inactive or superseded job, customer or service site."
      : !phone ? "Save a valid Australian customer phone number on this job before calling." : "",
  };
}

export async function assertStoredAuditCallTarget(database: D1Database, binding: StoredAuditCallTarget) {
  const actor = await currentActor(database, { organisationId: binding.organisationId, membershipId: binding.memberId, uid: binding.uid });
  const target = await loadAuditCallTarget(database, actor, binding.jobIntentId
    ? { jobIntentId: binding.jobIntentId } : { caseId: binding.caseId });
  if (!target.canCall || target.customerPhone !== binding.customerPhone
    || (binding.caseId && target.caseId !== binding.caseId)) {
    throw new ComplianceAccessError("CREDITEX_CALL_TARGET_CHANGED", 409, "The audit assignment or customer number changed. Start again from the current job.");
  }
  return target;
}
