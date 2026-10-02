import { CREDITEX_PARTNER_ORGANISATION_CODE } from "./trade-compliance-intent";
import { CreditexJobAuditError, type CreditexJobAuditActor } from "./creditex-job-audit-server";
import type { PortalConnectCustomers } from "./portal-customer-connect";

function actorSql(actor: CreditexJobAuditActor) {
  return actor.kind === "admin"
    ? `SELECT a.id,a.role FROM admin_users a JOIN compliance_organisations o ON o.id=? AND o.organisation_code=? AND o.status='active'
       WHERE a.id=? AND a.firebase_uid=? AND a.status='active' AND a.role IN ('owner','admin','reviewer')`
    : `SELECT a.id,a.role FROM compliance_users a JOIN compliance_organisations o ON o.id=a.organisation_id
       WHERE a.organisation_id=? AND o.organisation_code=? AND o.status='active' AND a.id=? AND a.firebase_uid=?
         AND a.status='active' AND a.role IN ('admin','case_manager','reviewer','auditor')`;
}

// Contact details follow the same current job ownership and assignment as Audit.
// Headset authority is checked separately: a platform role is never a compliance membership.
export async function loadPortalConnectCustomers(db: D1Database, actor: CreditexJobAuditActor, params: URLSearchParams): Promise<PortalConnectCustomers> {
  const bindings = [actor.organisationId, CREDITEX_PARTNER_ORGANISATION_CODE, actor.memberId, actor.uid];
  if (!await db.prepare(actorSql(actor)).bind(...bindings).first()) {
    throw new CreditexJobAuditError("CONNECT_ACCESS_CHANGED", "Your workspace access changed. Sign in again to continue.", 403);
  }
  const search = (params.get("search") || "").trim().slice(0, 120).toLowerCase();
  const requested = Number(params.get("page") || 1);
  const page = Number.isSafeInteger(requested) ? Math.max(1, Math.min(10000, requested)) : 1;
  const assignment = `EXISTS (SELECT 1 FROM compliance_case_assignments assignment WHERE assignment.organisation_id=intent.compliance_organisation_id
    AND assignment.case_id=linked_case.id AND assignment.compliance_user_id=actor.id AND assignment.status='assigned')`;
  const rows = await db.prepare(`WITH actor AS (${actorSql(actor)})
    SELECT intent.id, COALESCE(NULLIF(trim(customer.first_name || ' ' || customer.last_name),''),customer.business_name,'Customer') name,
      customer.email,customer.phone,work.work_number,work.title,
      COALESCE(json_extract(intent.intent_snapshot,'$.activity.title'),intent.registry_activity_code) activity,
      trim(site.address_line_1 || ' ' || site.suburb || ' ' || site.address_state || ' ' || site.postcode) address,
      account.business_name installer,
      EXISTS(SELECT 1 FROM compliance_users caller WHERE caller.firebase_uid=? AND caller.organisation_id=intent.compliance_organisation_id
        AND caller.status='active' AND caller.role IN ('admin','case_manager','reviewer','auditor')
        AND (COALESCE(intent.compliance_case_id,'')='' OR caller.role='admin' OR EXISTS(
          SELECT 1 FROM compliance_case_assignments ca WHERE ca.organisation_id=intent.compliance_organisation_id
            AND ca.case_id=linked_case.id AND ca.compliance_user_id=caller.id AND ca.status='assigned'))) headset_allowed
    FROM actor CROSS JOIN trade_work_order_compliance_intents intent
    JOIN trade_work_orders work ON work.id=intent.work_order_id AND work.firebase_uid=intent.installer_uid
      AND work.partner_type='installer' AND work.source_type='internal' AND work.record_status='active'
    JOIN trade_crm_job_details details ON details.work_order_id=work.id AND details.firebase_uid=work.firebase_uid AND details.customer_source='trade_owned'
    JOIN trade_crm_customers customer ON customer.id=details.crm_customer_id AND customer.firebase_uid=work.firebase_uid AND customer.record_status='active'
    JOIN trade_crm_service_sites site ON site.id=details.service_site_id AND site.firebase_uid=work.firebase_uid AND site.customer_id=customer.id AND site.record_status='active'
    LEFT JOIN trade_accounts account ON account.firebase_uid=work.firebase_uid
    LEFT JOIN compliance_cases linked_case ON linked_case.id=intent.compliance_case_id AND linked_case.organisation_id=intent.compliance_organisation_id
      AND linked_case.installer_uid=work.firebase_uid AND linked_case.work_order_id=work.id AND linked_case.compliance_intent_id=intent.id
    WHERE intent.compliance_organisation_id=? AND intent.status IN ('planned','case_linked')
      AND (COALESCE(intent.compliance_case_id,'')='' OR (linked_case.id IS NOT NULL AND ${actor.kind === "admin" ? "1=1" : `(actor.role='admin' OR ${assignment})`}))
      AND (?='' OR instr(lower(COALESCE(customer.first_name,'') || ' ' || COALESCE(customer.last_name,'') || ' ' || COALESCE(customer.business_name,'') || ' ' ||
        COALESCE(customer.email,'') || ' ' || COALESCE(customer.phone,'') || ' ' || work.work_number || ' ' || work.title || ' ' || site.address_line_1 || ' ' || site.suburb),?)>0)
    ORDER BY name COLLATE NOCASE,work.work_number,intent.id LIMIT 31 OFFSET ?`)
    .bind(...bindings, actor.uid, actor.organisationId, search, search, (page - 1) * 30)
    .all<{ id: string; name: string; email: string; phone: string; work_number: string; title: string; activity: string; address: string; installer: string; headset_allowed: number }>();
  return { page, hasNext: rows.results.length > 30, customers: rows.results.slice(0, 30).map(row => ({
    id: row.id, name: row.name, email: row.email || "", phone: row.phone || "", jobNumber: row.work_number,
    jobTitle: row.title, activity: row.activity || "", address: row.address, installer: row.installer || "", headsetAllowed: Boolean(row.headset_allowed),
  })) };
}
