import { getD1 } from "../../../../../db";
import {
  ComplianceAccessError,
  requireComplianceAccess,
} from "@/lib/compliance-access-server";
import { CREDITEX_PARTNER_ORGANISATION_CODE } from "@/lib/trade-compliance-intent";

export const runtime = "edge";
export const dynamic = "force-dynamic";
const PAGE_SIZE = 75;

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}

function json(body: object, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function errorResponse(error: unknown) {
  if (error instanceof ComplianceAccessError) {
    return json({ ok: false, code: error.code, error: error.message }, error.status);
  }
  if (error instanceof Error && error.message === "AUTH_REQUIRED") {
    return json({ ok: false, code: "AUTH_REQUIRED", error: "Sign in to continue." }, 401);
  }
  console.error("Creditex planned job queue failed", error);
  return json({
    ok: false,
    code: "CREDITEX_JOB_INTENT_QUEUE_UNAVAILABLE",
    error: "The planned certificate-work queue could not be loaded.",
  }, 500);
}

function storedObject(value: unknown) {
  try {
    const parsed = JSON.parse(String(value || "{}"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function queueStatus(value: string | null) {
  return value === "planned"
    || value === "case_linked"
    || value === "superseded"
    ? value
    : "all";
}

function queueBindings(
  organisationId: string,
  status: string,
  search: string,
  searchLike: string,
) {
  return [
    organisationId,
    status,
    status,
    search,
    ...Array.from({ length: 15 }, () => searchLike),
  ];
}

const QUEUE_JOINS = `FROM trade_work_order_compliance_intents intent
  LEFT JOIN trade_work_orders work
    ON work.id = intent.work_order_id
    AND work.firebase_uid = intent.installer_uid
  LEFT JOIN trade_crm_job_details details
    ON details.work_order_id = work.id
    AND details.firebase_uid = work.firebase_uid
    AND details.customer_source = 'trade_owned'
  LEFT JOIN trade_crm_customers customer
    ON customer.id = details.crm_customer_id
    AND customer.firebase_uid = work.firebase_uid
  LEFT JOIN trade_crm_service_sites site
    ON site.id = details.service_site_id
    AND site.firebase_uid = work.firebase_uid
    AND site.customer_id = customer.id
  LEFT JOIN trade_accounts account
    ON account.firebase_uid = intent.installer_uid`;

const QUEUE_WHERE = `WHERE intent.compliance_organisation_id = ?
  AND (? = 'all' OR intent.status = ?)
  AND (
    ? = ''
    OR work.work_number LIKE ? ESCAPE '\\'
    OR work.title LIKE ? ESCAPE '\\'
    OR account.business_name LIKE ? ESCAPE '\\'
    OR intent.program_code LIKE ? ESCAPE '\\'
    OR intent.registry_activity_code LIKE ? ESCAPE '\\'
    OR json_extract(intent.intent_snapshot, '$.activity.title') LIKE ? ESCAPE '\\'
    OR customer.customer_number LIKE ? ESCAPE '\\'
    OR customer.first_name LIKE ? ESCAPE '\\'
    OR customer.last_name LIKE ? ESCAPE '\\'
    OR customer.business_name LIKE ? ESCAPE '\\'
    OR customer.email LIKE ? ESCAPE '\\'
    OR customer.phone LIKE ? ESCAPE '\\'
    OR site.address_line_1 LIKE ? ESCAPE '\\'
    OR site.suburb LIKE ? ESCAPE '\\'
    OR site.postcode LIKE ? ESCAPE '\\'
  )`;

export async function GET(request: Request) {
  if (!sameOrigin(request)) {
    return json({ ok: false, error: "Request origin was not accepted." }, 403);
  }
  try {
    const database = getD1();
    const access = await requireComplianceAccess(request, {}, database);
    if (access.organisationCode !== CREDITEX_PARTNER_ORGANISATION_CODE) {
      throw new ComplianceAccessError(
        "CREDITEX_PARTNER_REQUIRED",
        403,
        "This queue is limited to the Creditex compliance partner organisation.",
      );
    }
    const url = new URL(request.url);
    const status = queueStatus(url.searchParams.get("status"));
    const search = String(url.searchParams.get("search") || "").trim().slice(0, 120);
    const searchLike = `%${search.replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
    const requestedPage = Math.max(
      1,
      Math.min(10_000, Number.parseInt(url.searchParams.get("page") || "1", 10) || 1),
    );
    const bindings = queueBindings(
      access.organisationId,
      status,
      search,
      searchLike,
    );
    const count = await database.prepare(`SELECT count(*) total
      ${QUEUE_JOINS}
      ${QUEUE_WHERE}`)
      .bind(...bindings)
      .first<Record<string, unknown>>();
    const total = Number(count?.total || 0);
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const page = Math.min(requestedPage, totalPages);
    const rows = await database.prepare(`SELECT
        intent.*,
        work.work_number,
        work.title job_title,
        work.stage job_stage,
        work.priority job_priority,
        work.record_status work_record_status,
        work.scheduled_start,
        work.scheduled_end,
        work.assignee_label,
        details.pipeline_stage,
        CASE
          WHEN details.id IS NULL THEN 'missing'
          ELSE 'active'
        END job_detail_record_status,
        details.building_type,
        details.description job_description,
        details.next_action,
        details.tags job_tags,
        details.estimated_value_cents,
        details.quoted_value_cents,
        details.invoiced_value_cents,
        details.paid_value_cents,
        details.quote_status,
        details.invoice_status,
        customer.customer_number,
        customer.customer_type,
        customer.first_name,
        customer.last_name,
        customer.business_name customer_business_name,
        customer.business_number,
        customer.email customer_email,
        customer.phone customer_phone,
        customer.tags customer_tags,
        customer.private_notes customer_private_notes,
        customer.record_status customer_record_status,
        site.site_label,
        site.address_line_1,
        site.address_line_2,
        site.suburb,
        site.address_state,
        site.postcode,
        site.access_instructions,
        site.parking_instructions,
        site.hazard_notes,
        site.record_status site_record_status,
        CASE
          WHEN work.id IS NOT NULL
            AND site.id IS NOT NULL
            AND intent.site_jurisdiction = site.address_state
            AND substr(intent.planned_start, 1, 10) = substr(work.scheduled_start, 1, 10)
          THEN 1
          ELSE 0
        END planning_current,
        account.business_name installer_business
      ${QUEUE_JOINS}
      ${QUEUE_WHERE}
      ORDER BY
        CASE WHEN intent.planned_start = '' THEN 1 ELSE 0 END,
        intent.planned_start,
        intent.updated_at DESC,
        intent.id
      LIMIT ? OFFSET ?`)
      .bind(
        ...bindings,
        PAGE_SIZE,
        (page - 1) * PAGE_SIZE,
      )
      .all<Record<string, unknown>>();
    return json({
      ok: true,
      status,
      page,
      pageSize: PAGE_SIZE,
      total,
      totalPages,
      items: rows.results.map((row) => {
        const snapshot = storedObject(row.intent_snapshot);
        const activity = storedObject(snapshot.activity);
        const program = storedObject(snapshot.program);
        const customerName = String(row.customer_business_name || "").trim()
          || `${String(row.first_name || "").trim()} ${String(row.last_name || "").trim()}`.trim();
        return {
          id: String(row.id),
          jobId: String(row.work_order_id),
          jobNumber: String(row.work_number),
          jobTitle: String(row.job_title),
          jobStage: String(row.job_stage),
          jobPriority: String(row.job_priority),
          workRecordStatus: String(row.work_record_status || "missing"),
          jobDetailRecordStatus: String(row.job_detail_record_status || "missing"),
          scheduledStart: String(row.scheduled_start || ""),
          scheduledEnd: String(row.scheduled_end || ""),
          assigneeLabel: String(row.assignee_label || ""),
          pipelineStage: String(row.pipeline_stage),
          buildingType: String(row.building_type),
          jobDescription: String(row.job_description || ""),
          nextAction: String(row.next_action || ""),
          jobTags: String(row.job_tags || "[]"),
          estimatedValueCents: Number(row.estimated_value_cents || 0),
          quotedValueCents: Number(row.quoted_value_cents || 0),
          invoicedValueCents: Number(row.invoiced_value_cents || 0),
          paidValueCents: Number(row.paid_value_cents || 0),
          quoteStatus: String(row.quote_status),
          invoiceStatus: String(row.invoice_status),
          installerBusiness: String(row.installer_business || "Installer business"),
          customerNumber: String(row.customer_number),
          customerType: String(row.customer_type),
          customerName,
          businessNumber: String(row.business_number || ""),
          customerEmail: String(row.customer_email || ""),
          customerPhone: String(row.customer_phone || ""),
          customerTags: String(row.customer_tags || "[]"),
          customerPrivateNotes: String(row.customer_private_notes || ""),
          customerRecordStatus: String(row.customer_record_status || "missing"),
          siteLabel: String(row.site_label),
          serviceAddress: [
            row.address_line_1,
            row.address_line_2,
            row.suburb,
            row.address_state,
            row.postcode,
          ].map((part) => String(part || "").trim()).filter(Boolean).join(", "),
          accessInstructions: String(row.access_instructions || ""),
          parkingInstructions: String(row.parking_instructions || ""),
          hazardNotes: String(row.hazard_notes || ""),
          siteRecordStatus: String(row.site_record_status || "missing"),
          planningCurrent: Number(row.planning_current) === 1,
          siteJurisdiction: String(row.site_jurisdiction),
          plannedStart: String(row.planned_start || ""),
          programCode: String(row.program_code),
          claimOutputCode: String(program.claimOutputCode || ""),
          claimOutputLabel: String(program.claimOutputLabel || ""),
          registryActivityCode: String(row.registry_activity_code || ""),
          activityKey: String(activity.activityKey || ""),
          activityTitle: String(activity.title || ""),
          serviceCategory: String(row.service_category),
          catalogueReviewedOn: String(row.catalogue_reviewed_on),
          status: String(row.status),
          complianceCaseId: String(row.compliance_case_id || ""),
          updatedAt: String(row.updated_at),
        };
      }),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
