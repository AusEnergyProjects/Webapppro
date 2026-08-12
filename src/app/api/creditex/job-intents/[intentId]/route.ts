import { getD1 } from "../../../../../../db";
import {
  ComplianceAccessError,
  requireComplianceAccess,
} from "@/lib/compliance-access-server";
import {
  CREDITEX_INSTALLER_ACCOUNT_SELECT_SQL,
} from "@/lib/creditex-job-audit-sql";
import { CREDITEX_PARTNER_ORGANISATION_CODE } from "@/lib/trade-compliance-intent";

export const runtime = "edge";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ intentId: string }> };
type Row = Record<string, unknown>;

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

function cleanId(value: unknown) {
  return String(value || "").trim().slice(0, 180);
}

function errorResponse(error: unknown) {
  if (error instanceof ComplianceAccessError) {
    return json(
      { ok: false, code: error.code, error: error.message },
      error.status,
    );
  }
  if (error instanceof Error && error.message === "AUTH_REQUIRED") {
    return json(
      { ok: false, code: "AUTH_REQUIRED", error: "Sign in to continue." },
      401,
    );
  }
  console.error("Creditex job audit workspace failed", error);
  return json({
    ok: false,
    code: "CREDITEX_JOB_AUDIT_UNAVAILABLE",
    error: "The assigned-job audit request could not be loaded.",
  }, 500);
}

const PRIVATE_SERVER_FIELDS = new Set([
  "encrypted_token",
  "token_hash",
  "state_hash",
  "encrypted_credentials",
  "push_token",
  "claim_code_hash",
  "object_key",
  "idempotency_key",
  "firebase_uid",
  "installer_uid",
  "created_by_uid",
  "actor_uid",
  "customer_firebase_uid",
  "customer_uid",
  "reviewed_by_uid",
  "recorded_by_uid",
  "assigned_by_uid",
  "requested_by_uid",
  "changed_by_uid",
]);

const PRIVATE_GROUP_FIELDS: Record<string, ReadonlySet<string>> = {
  enquiries: new Set(["external_record_id", "opportunity_match_id"]),
  photoRequestDeliveries: new Set(["provider_message_id", "last_error"]),
  quoteDeliveries: new Set(["provider_message_id", "last_error"]),
  quickInvoices: new Set(["provider_message_id", "last_error"]),
  accountingDocuments: new Set([
    "external_contact_id",
    "external_document_id",
    "external_url",
    "account_reference",
    "last_error",
  ]),
  accountingEvents: new Set(["detail"]),
  assetServiceEvents: new Set(["provider_reference"]),
  quoteEvents: new Set(["evidence_key"]),
};

function privateServerField(field: string, groupKey = "") {
  return PRIVATE_SERVER_FIELDS.has(field)
    || field.endsWith("_uid")
    || field.endsWith("_object_key")
    || field.endsWith("_token")
    || field.endsWith("_token_hash")
    || field.endsWith("_credentials")
    || field.endsWith("_secret")
    || PRIVATE_GROUP_FIELDS[groupKey]?.has(field) === true;
}

function safeRow(row: Row | null, groupKey = "") {
  if (!row) return null;
  return Object.fromEntries(
    Object.entries(row).filter(([field]) => !privateServerField(field, groupKey)),
  );
}

function safeRows(rows: Row[], groupKey: string) {
  return rows.map((row) => safeRow(row, groupKey) as Row);
}

function addressProvenance(serviceSite: Row) {
  const entryMode = String(
    serviceSite.address_entry_mode || "manual_pending_review",
  );
  const provider = String(serviceSite.address_provider || "");
  const providerReference = String(
    serviceSite.address_provider_reference || "",
  );
  const formattedAddress = String(serviceSite.address_formatted || "");
  const verifiedAt = String(serviceSite.address_verified_at || "");
  const providerVerified = entryMode === "provider_selected"
    && provider !== ""
    && providerReference !== ""
    && formattedAddress !== ""
    && verifiedAt !== "";
  return {
    entryMode,
    provider,
    providerReference,
    formattedAddress,
    verifiedAt,
    status: providerVerified
      ? "provider_verified"
      : "manual_review_required",
    reviewRequired: !providerVerified,
  };
}

type AuditGroup = {
  key: string;
  label: string;
  sortField: string;
  statement: D1PreparedStatement;
};
type AuditGroupCursor = {
  value: string;
  id: string;
};

const AUDIT_GROUP_PAGE_SIZE = 50;
const AUDIT_GROUP_SORT_FIELDS: Readonly<Record<string, string>> = {
  quoteEvents: "occurred_at",
  quoteQuestions: "asked_at",
  accountingEvents: "occurred_at",
};

function auditGroup(
  database: D1Database,
  key: string,
  label: string,
  sql: string,
  bindings: unknown[],
  cursor: AuditGroupCursor | null,
): AuditGroup {
  const sortField = AUDIT_GROUP_SORT_FIELDS[key] || "created_at";
  const cursorSql = cursor
    ? ` AND (${sortField} < ? OR (${sortField} = ? AND id < ?))`
    : "";
  const cursorBindings = cursor
    ? [cursor.value, cursor.value, cursor.id]
    : [];
  return {
    key,
    label,
    sortField,
    statement: database.prepare(
      `${sql}${cursorSql} ORDER BY ${sortField} DESC, id DESC LIMIT ?`,
    ).bind(
      ...bindings,
      ...cursorBindings,
      AUDIT_GROUP_PAGE_SIZE + 1,
    ),
  };
}

function jobGroup(
  database: D1Database,
  key: string,
  label: string,
  table: string,
  ownerUid: string,
  workOrderId: string,
  cursor: AuditGroupCursor | null,
): AuditGroup {
  return auditGroup(
    database,
    key,
    label,
    `SELECT * FROM ${table} WHERE firebase_uid = ? AND work_order_id = ?`,
    [ownerUid, workOrderId],
    cursor,
  );
}

export async function GET(request: Request, context: RouteContext) {
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
        "This workspace is limited to the Creditex compliance partner organisation.",
      );
    }
    const { intentId: routeIntentId } = await context.params;
    const intentId = cleanId(routeIntentId);
    if (!intentId) {
      return json({ ok: false, error: "Job intent is required." }, 400);
    }
    const requestUrl = new URL(request.url);
    const requestedGroupKey = cleanId(
      requestUrl.searchParams.get("group"),
    );
    const cursorValue = cleanId(requestUrl.searchParams.get("cursorValue"));
    const cursorId = cleanId(requestUrl.searchParams.get("cursorId"));
    if (Boolean(cursorValue) !== Boolean(cursorId)) {
      return json({
        ok: false,
        code: "CREDITEX_AUDIT_CURSOR_INVALID",
        error: "The audit record cursor is incomplete.",
      }, 400);
    }
    const groupCursor = cursorValue && cursorId
      ? { value: cursorValue, id: cursorId }
      : null;
    if (groupCursor && !requestedGroupKey) {
      return json({
        ok: false,
        code: "CREDITEX_AUDIT_CURSOR_INVALID",
        error: "An audit record cursor must name its record group.",
      }, 400);
    }
    const intent = await database.prepare(`SELECT *
      FROM trade_work_order_compliance_intents
      WHERE id = ? AND compliance_organisation_id = ?
      LIMIT 1`)
      .bind(intentId, access.organisationId)
      .first<Row>();
    if (!intent) {
      return json({
        ok: false,
        code: "CREDITEX_JOB_INTENT_NOT_FOUND",
        error: "The assigned Creditex job was not found.",
      }, 404);
    }

    const ownerUid = String(intent.installer_uid);
    const workOrderId = String(intent.work_order_id);
    const [workResult, detailResult, installerResult] = await database.batch([
      database.prepare(`SELECT * FROM trade_work_orders
        WHERE id = ? AND firebase_uid = ?
          AND partner_type = 'installer'
          AND source_type = 'internal'
        LIMIT 1`)
        .bind(workOrderId, ownerUid),
      database.prepare(`SELECT * FROM trade_crm_job_details
        WHERE work_order_id = ? AND firebase_uid = ?
          AND customer_source = 'trade_owned'
        LIMIT 1`)
        .bind(workOrderId, ownerUid),
      database.prepare(CREDITEX_INSTALLER_ACCOUNT_SELECT_SQL)
        .bind(ownerUid),
    ]);
    const workOrder = (workResult.results[0] || null) as Row | null;
    const jobDetails = (detailResult.results[0] || null) as Row | null;
    const installer = (installerResult.results[0] || null) as Row | null;
    const customerId = String(jobDetails?.crm_customer_id || "");
    const serviceSiteId = String(jobDetails?.service_site_id || "");
    const sourceEnquiryId = String(workOrder?.source_reference || "");
    if (!workOrder || !jobDetails || !customerId || !serviceSiteId) {
      return json({
        ok: false,
        code: "CREDITEX_JOB_GRAPH_INCOMPLETE",
        error: "The assigned job no longer has a complete direct-customer and service-site record.",
      }, 409);
    }

    const [customerResult, serviceSiteResult] = await database.batch([
      database.prepare(`SELECT * FROM trade_crm_customers
        WHERE id = ? AND firebase_uid = ? LIMIT 1`)
        .bind(customerId, ownerUid),
      database.prepare(`SELECT * FROM trade_crm_service_sites
        WHERE id = ? AND firebase_uid = ? AND customer_id = ? LIMIT 1`)
        .bind(serviceSiteId, ownerUid, customerId),
    ]);
    const customer = (customerResult.results[0] || null) as Row | null;
    const serviceSite = (serviceSiteResult.results[0] || null) as Row | null;
    if (!customer || !serviceSite) {
      return json({
        ok: false,
        code: "CREDITEX_JOB_GRAPH_MISMATCH",
        error: "The assigned job customer and service site could not be verified together.",
      }, 409);
    }

    const enquiryIdsSql = `SELECT id FROM trade_crm_enquiries
      WHERE firebase_uid = ?
        AND id = ?
        AND customer_id = ?
        AND service_site_id = ?`;
    const quoteIdsSql = `SELECT id FROM trade_crm_quotes
      WHERE firebase_uid = ? AND work_order_id = ?`;
    const quoteVersionIdsSql = `SELECT version.id
      FROM trade_crm_quote_versions version
      JOIN trade_crm_quotes quote
        ON quote.id = version.quote_id
        AND quote.firebase_uid = version.firebase_uid
      WHERE version.firebase_uid = ? AND quote.work_order_id = ?`;
    const jobPlanIdsSql = `SELECT id FROM trade_crm_job_plans
      WHERE firebase_uid = ? AND work_order_id = ?`;
    const invoiceIdsSql = `SELECT id FROM trade_crm_quick_invoices
      WHERE firebase_uid = ? AND work_order_id = ?`;

    const groups: AuditGroup[] = [
      auditGroup(
        database,
        "customerContacts",
        "Customer contacts",
        `SELECT * FROM trade_crm_customer_contacts
          WHERE firebase_uid = ? AND customer_id = ?`,
        [ownerUid, customerId],
        groupCursor,
      ),
      auditGroup(
        database,
        "siteContacts",
        "Service-site contacts",
        `SELECT * FROM trade_crm_site_contacts
          WHERE firebase_uid = ? AND service_site_id = ?`,
        [ownerUid, serviceSiteId],
        groupCursor,
      ),
      auditGroup(
        database,
        "enquiries",
        "Enquiry history",
        `SELECT * FROM trade_crm_enquiries
          WHERE firebase_uid = ?
            AND id = ?
            AND customer_id = ?
            AND service_site_id = ?`,
        [ownerUid, sourceEnquiryId, customerId, serviceSiteId],
        groupCursor,
      ),
      auditGroup(
        database,
        "enquiryMessages",
        "Enquiry conversations",
        `SELECT * FROM trade_crm_enquiry_messages
          WHERE firebase_uid = ? AND enquiry_id IN (${enquiryIdsSql})`,
        [ownerUid, ownerUid, sourceEnquiryId, customerId, serviceSiteId],
        groupCursor,
      ),
      auditGroup(
        database,
        "enquiryAttachments",
        "Enquiry attachments",
        `SELECT * FROM trade_crm_enquiry_attachments
          WHERE firebase_uid = ? AND enquiry_id IN (${enquiryIdsSql})`,
        [ownerUid, ownerUid, sourceEnquiryId, customerId, serviceSiteId],
        groupCursor,
      ),
      auditGroup(
        database,
        "enquiryEvents",
        "Enquiry audit history",
        `SELECT * FROM trade_crm_enquiry_events
          WHERE firebase_uid = ? AND enquiry_id IN (${enquiryIdsSql})`,
        [ownerUid, ownerUid, sourceEnquiryId, customerId, serviceSiteId],
        groupCursor,
      ),
      jobGroup(database, "tasks", "Job tasks", "trade_work_order_tasks", ownerUid, workOrderId, groupCursor),
      jobGroup(database, "jobEvents", "Job audit history", "trade_work_order_events", ownerUid, workOrderId, groupCursor),
      jobGroup(database, "appointments", "Appointments", "trade_crm_appointments", ownerUid, workOrderId, groupCursor),
      jobGroup(database, "appointmentRevisions", "Appointment revisions", "trade_crm_appointment_revisions", ownerUid, workOrderId, groupCursor),
      jobGroup(database, "rescheduleRequests", "Reschedule requests", "trade_crm_appointment_reschedule_requests", ownerUid, workOrderId, groupCursor),
      jobGroup(database, "rescheduleEvents", "Reschedule audit history", "trade_crm_appointment_reschedule_events", ownerUid, workOrderId, groupCursor),
      jobGroup(database, "jobNotes", "Job notes and issues", "trade_crm_job_notes", ownerUid, workOrderId, groupCursor),
      jobGroup(database, "timeEntries", "Time entries", "trade_crm_time_entries", ownerUid, workOrderId, groupCursor),
      jobGroup(database, "jobForms", "Job forms and answers", "trade_job_forms", ownerUid, workOrderId, groupCursor),
      jobGroup(database, "jobMedia", "Files, photos and metadata", "trade_crm_job_media", ownerUid, workOrderId, groupCursor),
      jobGroup(database, "photoRequests", "Photo requests", "trade_crm_photo_requests", ownerUid, workOrderId, groupCursor),
      jobGroup(database, "photoRequestEvents", "Photo-request audit history", "trade_crm_photo_request_events", ownerUid, workOrderId, groupCursor),
      jobGroup(database, "photoRequestCompletions", "Photo checklist completions", "trade_crm_photo_request_completions", ownerUid, workOrderId, groupCursor),
      jobGroup(database, "photoRequirementReviews", "Photo compliance reviews", "trade_crm_photo_requirement_reviews", ownerUid, workOrderId, groupCursor),
      jobGroup(database, "photoRequestDeliveries", "Photo-request delivery history", "trade_crm_photo_request_deliveries", ownerUid, workOrderId, groupCursor),
      jobGroup(database, "signoffs", "Customer and installer sign-offs", "trade_crm_signoffs", ownerUid, workOrderId, groupCursor),
      jobGroup(database, "quotes", "Quotes", "trade_crm_quotes", ownerUid, workOrderId, groupCursor),
      auditGroup(
        database,
        "quoteVersions",
        "Quote revisions",
        `SELECT * FROM trade_crm_quote_versions
          WHERE firebase_uid = ? AND quote_id IN (${quoteIdsSql})`,
        [ownerUid, ownerUid, workOrderId],
        groupCursor,
      ),
      auditGroup(
        database,
        "quoteItems",
        "Quote line items",
        `SELECT * FROM trade_crm_quote_items
          WHERE firebase_uid = ? AND quote_version_id IN (${quoteVersionIdsSql})`,
        [ownerUid, ownerUid, workOrderId],
        groupCursor,
      ),
      auditGroup(
        database,
        "quoteExecutionSnapshots",
        "Quote execution snapshots",
        `SELECT * FROM trade_crm_quote_execution_snapshots
          WHERE firebase_uid = ? AND quote_version_id IN (${quoteVersionIdsSql})`,
        [ownerUid, ownerUid, workOrderId],
        groupCursor,
      ),
      auditGroup(
        database,
        "quoteChoices",
        "Customer quote choices",
        `SELECT * FROM trade_crm_quote_choices
          WHERE firebase_uid = ? AND quote_version_id IN (${quoteVersionIdsSql})`,
        [ownerUid, ownerUid, workOrderId],
        groupCursor,
      ),
      jobGroup(database, "quoteAcceptances", "Quote acceptances", "trade_crm_quote_acceptances", ownerUid, workOrderId, groupCursor),
      jobGroup(database, "commercialHandovers", "Accepted commercial handoffs", "trade_crm_commercial_handovers", ownerUid, workOrderId, groupCursor),
      jobGroup(database, "quoteLinks", "Quote access links", "trade_crm_quote_links", ownerUid, workOrderId, groupCursor),
      jobGroup(database, "quoteEvents", "Quote audit history", "trade_crm_quote_events", ownerUid, workOrderId, groupCursor),
      jobGroup(database, "quoteQuestions", "Customer quote questions", "trade_crm_quote_questions", ownerUid, workOrderId, groupCursor),
      jobGroup(database, "quoteDeliveries", "Quote delivery history", "trade_crm_quote_deliveries", ownerUid, workOrderId, groupCursor),
      jobGroup(database, "jobPlans", "Accepted job plans", "trade_crm_job_plans", ownerUid, workOrderId, groupCursor),
      auditGroup(
        database,
        "jobPlanPhases",
        "Job-plan phases",
        `SELECT * FROM trade_crm_job_plan_phases
          WHERE firebase_uid = ? AND job_plan_id IN (${jobPlanIdsSql})`,
        [ownerUid, ownerUid, workOrderId],
        groupCursor,
      ),
      auditGroup(
        database,
        "jobPlanRequirements",
        "Job-plan requirements",
        `SELECT * FROM trade_crm_job_plan_requirements
          WHERE firebase_uid = ? AND job_plan_id IN (${jobPlanIdsSql})`,
        [ownerUid, ownerUid, workOrderId],
        groupCursor,
      ),
      jobGroup(database, "jobActuals", "On-site job actuals", "trade_crm_job_actuals", ownerUid, workOrderId, groupCursor),
      jobGroup(database, "quickInvoices", "Invoices", "trade_crm_quick_invoices", ownerUid, workOrderId, groupCursor),
      auditGroup(
        database,
        "quickInvoiceRevisions",
        "Invoice revisions",
        `SELECT * FROM trade_crm_quick_invoice_revisions
          WHERE firebase_uid = ? AND invoice_id IN (${invoiceIdsSql})`,
        [ownerUid, ownerUid, workOrderId],
        groupCursor,
      ),
      jobGroup(database, "quickInvoiceCredits", "Invoice credits", "trade_crm_quick_invoice_credits", ownerUid, workOrderId, groupCursor),
      jobGroup(database, "accountingDocuments", "Accounting documents and payments", "trade_crm_accounting_documents", ownerUid, workOrderId, groupCursor),
      jobGroup(database, "accountingEvents", "Accounting audit history", "trade_crm_accounting_events", ownerUid, workOrderId, groupCursor),
      jobGroup(database, "handoverPacks", "Handover packs", "trade_handover_packs", ownerUid, workOrderId, groupCursor),
      jobGroup(database, "handoverDocuments", "Handover documents", "trade_handover_documents", ownerUid, workOrderId, groupCursor),
      jobGroup(database, "installedAssets", "Installed assets and equipment", "trade_installed_assets", ownerUid, workOrderId, groupCursor),
      jobGroup(database, "tradeComplianceItems", "Installer compliance checklist", "trade_compliance_items", ownerUid, workOrderId, groupCursor),
      jobGroup(database, "assetServicePlans", "Asset service plans", "trade_asset_service_plans", ownerUid, workOrderId, groupCursor),
      jobGroup(database, "assetServiceEvents", "Asset service history", "trade_asset_service_events", ownerUid, workOrderId, groupCursor),
      auditGroup(
        database,
        "complianceCases",
        "Creditex compliance cases",
        `SELECT * FROM compliance_cases
          WHERE organisation_id = ? AND work_order_id = ? AND installer_uid = ?`,
        [access.organisationId, workOrderId, ownerUid],
        groupCursor,
      ),
      auditGroup(
        database,
        "complianceCaseEvents",
        "Creditex case audit history",
        `SELECT * FROM compliance_case_events
          WHERE organisation_id = ? AND case_id IN (
            SELECT id FROM compliance_cases
            WHERE organisation_id = ? AND work_order_id = ? AND installer_uid = ?
          )`,
        [
          access.organisationId,
          access.organisationId,
          workOrderId,
          ownerUid,
        ],
        groupCursor,
      ),
      auditGroup(
        database,
        "complianceEvidence",
        "Governed compliance evidence",
        `SELECT * FROM compliance_case_evidence
          WHERE organisation_id = ? AND case_id IN (
            SELECT id FROM compliance_cases
            WHERE organisation_id = ? AND work_order_id = ? AND installer_uid = ?
          )`,
        [
          access.organisationId,
          access.organisationId,
          workOrderId,
          ownerUid,
        ],
        groupCursor,
      ),
      auditGroup(
        database,
        "complianceFindings",
        "Creditex findings",
        `SELECT * FROM compliance_case_findings
          WHERE organisation_id = ? AND case_id IN (
            SELECT id FROM compliance_cases
            WHERE organisation_id = ? AND work_order_id = ? AND installer_uid = ?
          )`,
        [
          access.organisationId,
          access.organisationId,
          workOrderId,
          ownerUid,
        ],
        groupCursor,
      ),
      auditGroup(
        database,
        "complianceDecisions",
        "Creditex decisions",
        `SELECT * FROM compliance_case_decisions
          WHERE organisation_id = ? AND case_id IN (
            SELECT id FROM compliance_cases
            WHERE organisation_id = ? AND work_order_id = ? AND installer_uid = ?
          )`,
        [
          access.organisationId,
          access.organisationId,
          workOrderId,
          ownerUid,
        ],
        groupCursor,
      ),
    ];

    const requestedGroup = requestedGroupKey
      ? groups.find((group) => group.key === requestedGroupKey)
      : null;
    if (requestedGroupKey && !requestedGroup) {
      return json({
        ok: false,
        code: "CREDITEX_AUDIT_GROUP_NOT_FOUND",
        error: "The requested audit record group is not available.",
      }, 404);
    }
    const requestedGroupResult = requestedGroup
      ? await requestedGroup.statement.all<Row>()
      : null;
    const requestedRows = requestedGroupResult?.results || [];
    const requestedHasMore = requestedRows.length > AUDIT_GROUP_PAGE_SIZE;
    const returnedRows = requestedRows.slice(0, AUDIT_GROUP_PAGE_SIZE);
    const finalReturnedRow = returnedRows.at(-1);
    const requestedNextCursor = requestedGroup
      && requestedHasMore
      && finalReturnedRow
      ? {
        value: String(finalReturnedRow[requestedGroup.sortField]),
        id: String(finalReturnedRow.id),
      }
      : null;
    const auditEventType = requestedGroup
      ? "job.audit_group_page_viewed"
      : "job.audit_workspace_opened";
    const auditSummary = requestedGroup
      ? "Authorised Creditex member viewed one bounded assigned-job record group page."
      : "Authorised Creditex member opened the assigned-job core audit workspace.";
    const viewedAt = new Date().toISOString();
    await database.prepare(`INSERT INTO compliance_audit_events (
        id, organisation_id, actor_type, actor_uid, event_type,
        target_type, target_id, summary, metadata, created_at
      ) VALUES (?, ?, 'compliance', ?, ?,
        'trade_compliance_intent', ?, ?, ?, ?)`)
      .bind(
        crypto.randomUUID(),
        access.organisationId,
        access.uid,
        auditEventType,
        intentId,
        auditSummary,
        JSON.stringify({
          purpose: "assigned_job_compliance_review",
          workOrderId,
          group: requestedGroupKey || "core",
          cursor: groupCursor,
          returnedRows: returnedRows.length,
          hasMore: requestedHasMore,
          pageSize: AUDIT_GROUP_PAGE_SIZE,
          dataClasses: requestedGroup
            ? [requestedGroupKey]
            : ["installer", "customer", "service_site", "job"],
        }),
        viewedAt,
      )
      .run();
    return json({
      ok: true,
      intent: requestedGroup ? null : safeRow(intent),
      workOrder: requestedGroup ? null : safeRow(workOrder),
      jobDetails: requestedGroup ? null : safeRow(jobDetails),
      installer: requestedGroup ? null : safeRow(installer),
      customer: requestedGroup ? null : safeRow(customer),
      serviceSite: requestedGroup ? null : safeRow(serviceSite),
      serviceSiteAddressProvenance: requestedGroup
        ? null
        : addressProvenance(serviceSite),
      groups: groups.map((group) => ({
        key: group.key,
        label: group.label,
        loaded: group.key === requestedGroupKey,
        rows: group.key === requestedGroupKey
          ? safeRows(
            returnedRows as Row[],
            group.key,
          )
          : [],
        pageSize: AUDIT_GROUP_PAGE_SIZE,
        hasMore: group.key === requestedGroupKey && requestedHasMore,
        nextCursor: group.key === requestedGroupKey
          ? requestedNextCursor
          : null,
      })),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
