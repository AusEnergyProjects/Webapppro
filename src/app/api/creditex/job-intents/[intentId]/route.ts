import { getD1 } from "../../../../../../db";
import {
  ComplianceAccessError,
  requireComplianceAccess,
} from "@/lib/compliance-access-server";
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
    error: "The complete job audit workspace could not be loaded.",
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
  statement: D1PreparedStatement;
};

function jobGroup(
  database: D1Database,
  key: string,
  label: string,
  table: string,
  ownerUid: string,
  workOrderId: string,
): AuditGroup {
  return {
    key,
    label,
    statement: database.prepare(
      `SELECT * FROM ${table} WHERE firebase_uid = ? AND work_order_id = ?`,
    ).bind(ownerUid, workOrderId),
  };
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
      database.prepare(`SELECT id, firebase_uid, business_name, contact_name,
          email, phone, abn, address_line_1, address_line_2, suburb,
          address_state, postcode, service_areas, service_categories,
          licence_number, licence_state, licence_expiry, verification_status,
          partner_status, created_at, updated_at
        FROM trade_accounts
        WHERE firebase_uid = ? LIMIT 1`)
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
      {
        key: "customerContacts",
        label: "Customer contacts",
        statement: database.prepare(`SELECT * FROM trade_crm_customer_contacts
          WHERE firebase_uid = ? AND customer_id = ?`)
          .bind(ownerUid, customerId),
      },
      {
        key: "siteContacts",
        label: "Service-site contacts",
        statement: database.prepare(`SELECT * FROM trade_crm_site_contacts
          WHERE firebase_uid = ? AND service_site_id = ?`)
          .bind(ownerUid, serviceSiteId),
      },
      {
        key: "enquiries",
        label: "Enquiry history",
        statement: database.prepare(`SELECT * FROM trade_crm_enquiries
          WHERE firebase_uid = ?
            AND id = ?
            AND customer_id = ?
            AND service_site_id = ?`)
          .bind(
            ownerUid,
            sourceEnquiryId,
            customerId,
            serviceSiteId,
          ),
      },
      {
        key: "enquiryMessages",
        label: "Enquiry conversations",
        statement: database.prepare(`SELECT * FROM trade_crm_enquiry_messages
          WHERE firebase_uid = ? AND enquiry_id IN (${enquiryIdsSql})`)
          .bind(
            ownerUid,
            ownerUid,
            sourceEnquiryId,
            customerId,
            serviceSiteId,
          ),
      },
      {
        key: "enquiryAttachments",
        label: "Enquiry attachments",
        statement: database.prepare(`SELECT * FROM trade_crm_enquiry_attachments
          WHERE firebase_uid = ? AND enquiry_id IN (${enquiryIdsSql})`)
          .bind(
            ownerUid,
            ownerUid,
            sourceEnquiryId,
            customerId,
            serviceSiteId,
          ),
      },
      {
        key: "enquiryEvents",
        label: "Enquiry audit history",
        statement: database.prepare(`SELECT * FROM trade_crm_enquiry_events
          WHERE firebase_uid = ? AND enquiry_id IN (${enquiryIdsSql})`)
          .bind(
            ownerUid,
            ownerUid,
            sourceEnquiryId,
            customerId,
            serviceSiteId,
          ),
      },
      jobGroup(database, "tasks", "Job tasks", "trade_work_order_tasks", ownerUid, workOrderId),
      jobGroup(database, "jobEvents", "Job audit history", "trade_work_order_events", ownerUid, workOrderId),
      jobGroup(database, "appointments", "Appointments", "trade_crm_appointments", ownerUid, workOrderId),
      jobGroup(database, "appointmentRevisions", "Appointment revisions", "trade_crm_appointment_revisions", ownerUid, workOrderId),
      jobGroup(database, "rescheduleRequests", "Reschedule requests", "trade_crm_appointment_reschedule_requests", ownerUid, workOrderId),
      jobGroup(database, "rescheduleEvents", "Reschedule audit history", "trade_crm_appointment_reschedule_events", ownerUid, workOrderId),
      jobGroup(database, "jobNotes", "Job notes and issues", "trade_crm_job_notes", ownerUid, workOrderId),
      jobGroup(database, "timeEntries", "Time entries", "trade_crm_time_entries", ownerUid, workOrderId),
      jobGroup(database, "jobForms", "Job forms and answers", "trade_job_forms", ownerUid, workOrderId),
      jobGroup(database, "jobMedia", "Files, photos and metadata", "trade_crm_job_media", ownerUid, workOrderId),
      jobGroup(database, "photoRequests", "Photo requests", "trade_crm_photo_requests", ownerUid, workOrderId),
      jobGroup(database, "photoRequestEvents", "Photo-request audit history", "trade_crm_photo_request_events", ownerUid, workOrderId),
      jobGroup(database, "photoRequestCompletions", "Photo checklist completions", "trade_crm_photo_request_completions", ownerUid, workOrderId),
      jobGroup(database, "photoRequirementReviews", "Photo compliance reviews", "trade_crm_photo_requirement_reviews", ownerUid, workOrderId),
      jobGroup(database, "photoRequestDeliveries", "Photo-request delivery history", "trade_crm_photo_request_deliveries", ownerUid, workOrderId),
      jobGroup(database, "signoffs", "Customer and installer sign-offs", "trade_crm_signoffs", ownerUid, workOrderId),
      jobGroup(database, "quotes", "Quotes", "trade_crm_quotes", ownerUid, workOrderId),
      {
        key: "quoteVersions",
        label: "Quote revisions",
        statement: database.prepare(`SELECT * FROM trade_crm_quote_versions
          WHERE firebase_uid = ? AND quote_id IN (${quoteIdsSql})`)
          .bind(ownerUid, ownerUid, workOrderId),
      },
      {
        key: "quoteItems",
        label: "Quote line items",
        statement: database.prepare(`SELECT * FROM trade_crm_quote_items
          WHERE firebase_uid = ? AND quote_version_id IN (${quoteVersionIdsSql})`)
          .bind(ownerUid, ownerUid, workOrderId),
      },
      {
        key: "quoteExecutionSnapshots",
        label: "Quote execution snapshots",
        statement: database.prepare(`SELECT * FROM trade_crm_quote_execution_snapshots
          WHERE firebase_uid = ? AND quote_version_id IN (${quoteVersionIdsSql})`)
          .bind(ownerUid, ownerUid, workOrderId),
      },
      {
        key: "quoteChoices",
        label: "Customer quote choices",
        statement: database.prepare(`SELECT * FROM trade_crm_quote_choices
          WHERE firebase_uid = ? AND quote_version_id IN (${quoteVersionIdsSql})`)
          .bind(ownerUid, ownerUid, workOrderId),
      },
      jobGroup(database, "quoteAcceptances", "Quote acceptances", "trade_crm_quote_acceptances", ownerUid, workOrderId),
      jobGroup(database, "commercialHandovers", "Accepted commercial handoffs", "trade_crm_commercial_handovers", ownerUid, workOrderId),
      jobGroup(database, "quoteLinks", "Quote access links", "trade_crm_quote_links", ownerUid, workOrderId),
      jobGroup(database, "quoteEvents", "Quote audit history", "trade_crm_quote_events", ownerUid, workOrderId),
      jobGroup(database, "quoteQuestions", "Customer quote questions", "trade_crm_quote_questions", ownerUid, workOrderId),
      jobGroup(database, "quoteDeliveries", "Quote delivery history", "trade_crm_quote_deliveries", ownerUid, workOrderId),
      jobGroup(database, "jobPlans", "Accepted job plans", "trade_crm_job_plans", ownerUid, workOrderId),
      {
        key: "jobPlanPhases",
        label: "Job-plan phases",
        statement: database.prepare(`SELECT * FROM trade_crm_job_plan_phases
          WHERE firebase_uid = ? AND job_plan_id IN (${jobPlanIdsSql})`)
          .bind(ownerUid, ownerUid, workOrderId),
      },
      {
        key: "jobPlanRequirements",
        label: "Job-plan requirements",
        statement: database.prepare(`SELECT * FROM trade_crm_job_plan_requirements
          WHERE firebase_uid = ? AND job_plan_id IN (${jobPlanIdsSql})`)
          .bind(ownerUid, ownerUid, workOrderId),
      },
      jobGroup(database, "jobActuals", "On-site job actuals", "trade_crm_job_actuals", ownerUid, workOrderId),
      jobGroup(database, "quickInvoices", "Invoices", "trade_crm_quick_invoices", ownerUid, workOrderId),
      {
        key: "quickInvoiceRevisions",
        label: "Invoice revisions",
        statement: database.prepare(`SELECT * FROM trade_crm_quick_invoice_revisions
          WHERE firebase_uid = ? AND invoice_id IN (${invoiceIdsSql})`)
          .bind(ownerUid, ownerUid, workOrderId),
      },
      jobGroup(database, "quickInvoiceCredits", "Invoice credits", "trade_crm_quick_invoice_credits", ownerUid, workOrderId),
      jobGroup(database, "accountingDocuments", "Accounting documents and payments", "trade_crm_accounting_documents", ownerUid, workOrderId),
      jobGroup(database, "accountingEvents", "Accounting audit history", "trade_crm_accounting_events", ownerUid, workOrderId),
      jobGroup(database, "handoverPacks", "Handover packs", "trade_handover_packs", ownerUid, workOrderId),
      jobGroup(database, "handoverDocuments", "Handover documents", "trade_handover_documents", ownerUid, workOrderId),
      jobGroup(database, "installedAssets", "Installed assets and equipment", "trade_installed_assets", ownerUid, workOrderId),
      jobGroup(database, "tradeComplianceItems", "Installer compliance checklist", "trade_compliance_items", ownerUid, workOrderId),
      jobGroup(database, "assetServicePlans", "Asset service plans", "trade_asset_service_plans", ownerUid, workOrderId),
      jobGroup(database, "assetServiceEvents", "Asset service history", "trade_asset_service_events", ownerUid, workOrderId),
      {
        key: "complianceCases",
        label: "Creditex compliance cases",
        statement: database.prepare(`SELECT * FROM compliance_cases
          WHERE organisation_id = ? AND work_order_id = ? AND installer_uid = ?`)
          .bind(access.organisationId, workOrderId, ownerUid),
      },
      {
        key: "complianceCaseEvents",
        label: "Creditex case audit history",
        statement: database.prepare(`SELECT * FROM compliance_case_events
          WHERE organisation_id = ? AND case_id IN (
            SELECT id FROM compliance_cases
            WHERE organisation_id = ? AND work_order_id = ? AND installer_uid = ?
          )`)
          .bind(
            access.organisationId,
            access.organisationId,
            workOrderId,
            ownerUid,
          ),
      },
      {
        key: "complianceEvidence",
        label: "Governed compliance evidence",
        statement: database.prepare(`SELECT * FROM compliance_case_evidence
          WHERE organisation_id = ? AND case_id IN (
            SELECT id FROM compliance_cases
            WHERE organisation_id = ? AND work_order_id = ? AND installer_uid = ?
          )`)
          .bind(
            access.organisationId,
            access.organisationId,
            workOrderId,
            ownerUid,
          ),
      },
      {
        key: "complianceFindings",
        label: "Creditex findings",
        statement: database.prepare(`SELECT * FROM compliance_case_findings
          WHERE organisation_id = ? AND case_id IN (
            SELECT id FROM compliance_cases
            WHERE organisation_id = ? AND work_order_id = ? AND installer_uid = ?
          )`)
          .bind(
            access.organisationId,
            access.organisationId,
            workOrderId,
            ownerUid,
          ),
      },
      {
        key: "complianceDecisions",
        label: "Creditex decisions",
        statement: database.prepare(`SELECT * FROM compliance_case_decisions
          WHERE organisation_id = ? AND case_id IN (
            SELECT id FROM compliance_cases
            WHERE organisation_id = ? AND work_order_id = ? AND installer_uid = ?
          )`)
          .bind(
            access.organisationId,
            access.organisationId,
            workOrderId,
            ownerUid,
          ),
      },
    ];

    const results = await database.batch(
      groups.map((group) => group.statement),
    );
    const viewedAt = new Date().toISOString();
    await database.prepare(`INSERT INTO compliance_audit_events (
        id, organisation_id, actor_type, actor_uid, event_type,
        target_type, target_id, summary, metadata, created_at
      ) VALUES (?, ?, 'compliance', ?, 'job.private_details_viewed',
        'trade_compliance_intent', ?,
        'Authorised Creditex member viewed the complete assigned job record.',
        ?, ?)`)
      .bind(
        crypto.randomUUID(),
        access.organisationId,
        access.uid,
        intentId,
        JSON.stringify({
          purpose: "assigned_job_compliance_review",
          role: access.role,
          workOrderId,
          dataClasses: [
            "installer",
            "customer",
            "service_site",
            "job",
            "commercial",
            "field",
            "evidence",
            "audit_history",
          ],
        }),
        viewedAt,
      )
      .run();
    return json({
      ok: true,
      intent: safeRow(intent),
      workOrder: safeRow(workOrder),
      jobDetails: safeRow(jobDetails),
      installer: safeRow(installer),
      customer: safeRow(customer),
      serviceSite: safeRow(serviceSite),
      serviceSiteAddressProvenance: addressProvenance(serviceSite),
      groups: groups.map((group, index) => ({
        key: group.key,
        label: group.label,
        rows: safeRows((results[index]?.results || []) as Row[], group.key),
      })),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
