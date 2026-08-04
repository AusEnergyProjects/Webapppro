import { getD1 } from "../../../../db";
import { adminJson, cleanAdminText, sameOrigin } from "@/lib/admin-server";
import {
  appendLiveComplianceCaseStatements,
  AUSTRALIAN_SITE_JURISDICTIONS,
  ComplianceDomainError,
  listInstallerSelectableActivities,
} from "@/lib/creditex-compliance-server";
import { ensureCreditexSchemaGuards } from "@/lib/creditex-schema-guards";
import {
  CREDITEX_PARTNER_ORGANISATION_CODE,
} from "@/lib/trade-compliance-intent";
import {
  BoundedJsonRequestError,
  readBoundedJsonRequest,
} from "@/lib/bounded-json-request";
import {
  requireVerifiedTradeAccess,
  TradeAccessError,
} from "@/lib/trade-access-server";

export const runtime = "edge";

const ACTIVITY_PAGE_SIZE = 200;
const MAX_COMPLIANCE_INTAKE_JSON_BYTES = 4_096;
const POST_FIELDS = new Set([
  "workOrderId",
  "complianceIntentId",
  "activityVersionId",
  "idempotencyKey",
  "commercialHandoffId",
  "acceptedQuoteVersionId",
  "acceptedScopeSha256",
]);
type Row = Record<string, unknown>;

type OptionalCommercialHandoff = {
  commercialHandoffId: string;
  acceptedQuoteVersionId: string;
  acceptedScopeSha256: string;
};

type JobComplianceContext = {
  workOrderId: string;
  complianceIntentId: string;
  serviceCategory: string;
  jurisdiction: string;
  activityDate: string;
  programCode: string;
  registryActivityCode: string;
  activityKey: string;
};

type ComplianceOrganisationRef = {
  id: string;
  code: string;
};

function errorResponse(error: unknown) {
  if (error instanceof TradeAccessError) {
    return adminJson(
      { ok: false, code: error.code, error: error.message },
      error.status,
    );
  }
  if (error instanceof ComplianceDomainError) {
    return adminJson(
      { ok: false, code: error.code, error: error.message },
      error.status,
    );
  }
  const code = error instanceof Error ? error.message : "";
  if (code === "DIRECT_CUSTOMER_REQUIRED") {
    return adminJson({
      ok: false,
      code,
      error: "Compliance intake is available for your own direct customer jobs.",
    }, 403);
  }
  console.error("Installer compliance intake failure", error);
  return adminJson({
    ok: false,
    error: "The approved compliance activity workflow could not be loaded.",
  }, 500);
}

function requiredInput(
  value: unknown,
  field: string,
  maximum = 180,
) {
  const result = cleanAdminText(value, maximum);
  if (!result) {
    throw new ComplianceDomainError(
      "COMPLIANCE_INPUT_REQUIRED",
      400,
      `${field} is required.`,
    );
  }
  return result;
}

function optionalInput(
  value: unknown,
  field: string,
  maximum: number,
) {
  const result = typeof value === "string" ? value.trim() : "";
  if (result.length > maximum) {
    throw new ComplianceDomainError(
      "COMPLIANCE_VALUE_TOO_LONG",
      400,
      `${field} must be ${maximum} characters or fewer.`,
    );
  }
  return result;
}

function optionalCommercialHandoff(body: Row): OptionalCommercialHandoff {
  const commercialHandoffId = optionalInput(
    body.commercialHandoffId,
    "Commercial handoff",
    180,
  );
  const acceptedQuoteVersionId = optionalInput(
    body.acceptedQuoteVersionId,
    "Accepted quote version",
    180,
  );
  const acceptedScopeSha256 = optionalInput(
    body.acceptedScopeSha256,
    "Accepted scope digest",
    64,
  ).toLowerCase();
  const suppliedCount = [
    commercialHandoffId,
    acceptedQuoteVersionId,
    acceptedScopeSha256,
  ].filter(Boolean).length;
  if (suppliedCount !== 0 && suppliedCount !== 3) {
    throw new ComplianceDomainError(
      "COMPLIANCE_HANDOFF_INCOMPLETE",
      400,
      "Optional accepted quote linkage must include the handoff, quote version and scope digest together.",
    );
  }
  if (
    suppliedCount === 3
    && !/^[0-9a-f]{64}$/.test(acceptedScopeSha256)
  ) {
    throw new ComplianceDomainError(
      "COMPLIANCE_HANDOFF_LINKAGE_INVALID",
      400,
      "The optional accepted quote scope digest is invalid.",
    );
  }
  return {
    commercialHandoffId,
    acceptedQuoteVersionId,
    acceptedScopeSha256,
  };
}

async function activeCreditexOrganisation(
  database: D1Database,
): Promise<ComplianceOrganisationRef> {
  const row = await database.prepare(`SELECT id, organisation_code
    FROM compliance_organisations
    WHERE organisation_code = ? AND status = 'active'
    LIMIT 1`)
    .bind(CREDITEX_PARTNER_ORGANISATION_CODE)
    .first<Row>();
  if (!row?.id || row.organisation_code !== CREDITEX_PARTNER_ORGANISATION_CODE) {
    throw new ComplianceDomainError(
      "COMPLIANCE_PARTNER_UNAVAILABLE",
      503,
      "Compliance intake is temporarily unavailable.",
    );
  }
  return {
    id: String(row.id),
    code: CREDITEX_PARTNER_ORGANISATION_CODE,
  };
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((item) => item.toString(16).padStart(2, "0"))
    .join("");
}

async function ownedJobContext(
  database: D1Database,
  installerUid: string,
  workOrderId: string,
  complianceOrganisationId: string,
  complianceIntentId = "",
): Promise<JobComplianceContext> {
  let resolvedComplianceIntentId = complianceIntentId;
  if (!resolvedComplianceIntentId) {
    const governedIntents = await database.prepare(`SELECT id
      FROM trade_work_order_compliance_intents
      WHERE compliance_organisation_id = ?
        AND work_order_id = ?
        AND installer_uid = ?
        AND status IN ('planned', 'case_linked')
      ORDER BY created_at ASC, id ASC
      LIMIT 2`)
      .bind(complianceOrganisationId, workOrderId, installerUid)
      .all<{ id: string }>();
    if (governedIntents.results.length > 1) {
      throw new ComplianceDomainError(
        "COMPLIANCE_INTENT_REQUIRED",
        409,
        "Choose the exact planned activity before opening compliance intake.",
      );
    }
    resolvedComplianceIntentId = String(
      governedIntents.results[0]?.id || "",
    );
  }
  const row = await database.prepare(`SELECT
      work.id,
      work.source_type,
      work.service_category,
      work.scheduled_start,
      (
        SELECT appointment.starts_at
        FROM trade_crm_appointments appointment
        WHERE appointment.work_order_id = work.id
          AND appointment.firebase_uid = work.firebase_uid
          AND appointment.appointment_type = 'installation'
          AND appointment.status IN ('scheduled', 'completed')
        ORDER BY appointment.starts_at DESC, appointment.id DESC
        LIMIT 1
      ) installation_start,
      detail.customer_source,
      detail.service_site_id,
      service_site.address_state,
      intent.id compliance_intent_id,
      intent.status compliance_intent_status,
      intent.service_category intent_service_category,
      intent.site_jurisdiction intent_site_jurisdiction,
      intent.planned_start intent_planned_start,
      intent.program_code intent_program_code,
      intent.registry_activity_code intent_registry_activity_code,
      json_extract(
        intent.intent_snapshot,
        '$.activity.activityKey'
      ) intent_activity_key
    FROM trade_work_orders work
    JOIN trade_crm_job_details detail
      ON detail.work_order_id = work.id
      AND detail.firebase_uid = work.firebase_uid
    LEFT JOIN trade_crm_service_sites service_site
      ON service_site.id = detail.service_site_id
      AND service_site.firebase_uid = detail.firebase_uid
      AND service_site.record_status = 'active'
    LEFT JOIN trade_work_order_compliance_intents intent
      ON intent.id = ?
      AND intent.work_order_id = work.id
      AND intent.installer_uid = work.firebase_uid
      AND intent.compliance_organisation_id = ?
      AND intent.status IN ('planned', 'case_linked')
    WHERE work.id = ? AND work.firebase_uid = ?
      AND work.partner_type = 'installer'
      AND work.record_status = 'active'
    LIMIT 1`)
    .bind(
      resolvedComplianceIntentId,
      complianceOrganisationId,
      workOrderId,
      installerUid,
    )
    .first<Row>();
  if (!row) {
    throw new ComplianceDomainError(
      "WORK_ORDER_NOT_FOUND",
      404,
      "The installer job was not found.",
    );
  }
  if (
    row.source_type !== "internal"
    || row.customer_source !== "trade_owned"
  ) {
    throw new Error("DIRECT_CUSTOMER_REQUIRED");
  }
  if (
    resolvedComplianceIntentId
    && row.compliance_intent_id !== resolvedComplianceIntentId
  ) {
    throw new ComplianceDomainError(
      "COMPLIANCE_INTENT_NOT_FOUND",
      404,
      "The selected planned activity was not found for this job.",
    );
  }
  const siteJurisdiction = String(row.address_state || "").trim().toUpperCase();
  const jurisdiction = String(
    row.intent_site_jurisdiction || siteJurisdiction,
  ).trim().toUpperCase();
  if (!AUSTRALIAN_SITE_JURISDICTIONS.includes(
    jurisdiction as typeof AUSTRALIAN_SITE_JURISDICTIONS[number],
  )) {
    throw new ComplianceDomainError(
      "INVALID_SITE_JURISDICTION",
      409,
      "Add a valid Australian service-site state before opening compliance intake.",
    );
  }
  const installationStart = String(row.installation_start || "");
  const activityDate = String(
    row.intent_planned_start || installationStart,
  ).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(activityDate)) {
    throw new ComplianceDomainError(
      "ACTIVITY_DATE_REQUIRED",
      409,
      "Add the planned installation appointment before opening compliance intake.",
    );
  }
  if (String(row.scheduled_start || "").slice(0, 10) !== activityDate) {
    throw new ComplianceDomainError(
      "INSTALLATION_DATE_MISMATCH",
      409,
      "Set the installation appointment as the current job schedule before opening compliance intake.",
    );
  }
  if (jurisdiction !== siteJurisdiction) {
    throw new ComplianceDomainError(
      "PLANNED_JURISDICTION_MISMATCH",
      409,
      "The planned activity no longer matches the service-site state.",
    );
  }
  const serviceCategory = String(
    row.intent_service_category || row.service_category || "",
  ).trim();
  if (!serviceCategory) {
    throw new ComplianceDomainError(
      "SERVICE_CATEGORY_REQUIRED",
      409,
      "Choose the job work type before opening compliance intake.",
    );
  }
  return {
    workOrderId: String(row.id),
    complianceIntentId: String(row.compliance_intent_id || ""),
    serviceCategory,
    jurisdiction,
    activityDate,
    programCode: String(row.intent_program_code || ""),
    registryActivityCode: String(row.intent_registry_activity_code || ""),
    activityKey: String(row.intent_activity_key || ""),
  };
}

function activityJson(
  activity: Awaited<
    ReturnType<typeof listInstallerSelectableActivities>
  >[number],
) {
  return {
    id: activity.id,
    programId: activity.programId,
    programName: activity.programName,
    programCode: activity.programCode,
    schemeKind: activity.schemeKind,
    jurisdiction: activity.jurisdiction,
    activityKey: activity.activityKey,
    version: activity.version,
    title: activity.title,
    serviceCategory: activity.serviceCategory,
    registryActivityCode: activity.registryActivityCode,
    specificationPart: activity.specificationPart,
    productCategory: activity.productCategory,
    scenarioCode: activity.scenarioCode,
    scenario: activity.scenario,
    effectiveFrom: activity.effectiveFrom,
    effectiveTo: activity.effectiveTo,
    officialSourceUrl: activity.officialSourceUrl,
    officialSourceTitle: activity.officialSourceTitle,
    officialSourceVersion: activity.officialSourceVersion,
    calculationApprovalState: activity.calculationApprovalState,
  };
}

export async function GET(request: Request) {
  if (!sameOrigin(request)) {
    return adminJson({
      ok: false,
      error: "Request origin was not accepted.",
    }, 403);
  }
  try {
    const access = await requireVerifiedTradeAccess(request, {
      partnerTypes: ["installer"],
    });
    const database = getD1();
    await ensureCreditexSchemaGuards(database);
    const creditexOrganisation = await activeCreditexOrganisation(database);
    const url = new URL(request.url);
    const workOrderId = requiredInput(
      url.searchParams.get("workOrderId"),
      "Work order",
    );
    const complianceIntentId = optionalInput(
      url.searchParams.get("complianceIntentId"),
      "Planned activity",
      180,
    );
    const context = await ownedJobContext(
      database,
      access.identity.uid,
      workOrderId,
      creditexOrganisation.id,
      complianceIntentId,
    );
    const currentCase = await activeCase(
      database,
      creditexOrganisation.id,
      access.identity.uid,
      workOrderId,
      context.complianceIntentId,
    );
    if (currentCase) {
      return adminJson({
        ok: true,
        context,
        existingCase: {
          id: String(currentCase.id),
          caseNumber: String(currentCase.case_number),
          activityVersionId: String(currentCase.activity_version_id),
        },
        activities: [],
        pagination: {
          pageSize: ACTIVITY_PAGE_SIZE,
          hasNext: false,
          nextCursor: "",
        },
      });
    }
    const afterActivityId = cleanAdminText(
      url.searchParams.get("afterActivityId"),
      180,
    );
    const page = await listInstallerSelectableActivities(database, {
      serviceCategory: context.serviceCategory,
      jurisdiction: context.jurisdiction,
      organisationCode: creditexOrganisation.code,
      programCode: context.programCode,
      registryActivityCode: context.registryActivityCode,
      activityKey: context.activityKey,
      onDate: context.activityDate,
      limit: ACTIVITY_PAGE_SIZE + 1,
      afterActivityId,
    });
    const hasNext = page.length > ACTIVITY_PAGE_SIZE;
    const activities = page.slice(0, ACTIVITY_PAGE_SIZE);
    return adminJson({
      ok: true,
      context,
      activities: activities.map(activityJson),
      pagination: {
        pageSize: ACTIVITY_PAGE_SIZE,
        hasNext,
        nextCursor: hasNext ? activities.at(-1)?.id || "" : "",
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

async function activeCase(
  database: D1Database,
  complianceOrganisationId: string,
  installerUid: string,
  workOrderId: string,
  complianceIntentId: string,
) {
  return database.prepare(`SELECT id, case_number, activity_version_id,
      commercial_handoff_id, accepted_quote_version_id,
      accepted_scope_sha256
    FROM compliance_cases
    WHERE organisation_id = ?
      AND installer_uid = ?
      AND work_order_id = ?
      AND compliance_intent_id = ?
      AND status <> 'closed'
    ORDER BY created_at DESC
    LIMIT 1`)
    .bind(
      complianceOrganisationId,
      installerUid,
      workOrderId,
      complianceIntentId,
    )
    .first<Row>();
}

function activeCaseResponse(
  row: Row,
  requestedActivityVersionId: string,
  requestedHandoff: OptionalCommercialHandoff,
) {
  if (String(row.activity_version_id) !== requestedActivityVersionId) {
    throw new ComplianceDomainError(
      "ACTIVE_COMPLIANCE_CASE_EXISTS",
      409,
      "This job already has an active compliance case. Close or supersede it before choosing another activity.",
    );
  }
  if (
    requestedHandoff.commercialHandoffId
    && (
      String(row.commercial_handoff_id || "")
        !== requestedHandoff.commercialHandoffId
      || String(row.accepted_quote_version_id || "")
        !== requestedHandoff.acceptedQuoteVersionId
      || String(row.accepted_scope_sha256 || "")
        !== requestedHandoff.acceptedScopeSha256
    )
  ) {
    throw new ComplianceDomainError(
      "ACTIVE_COMPLIANCE_CASE_HANDOFF_MISMATCH",
      409,
      "This job already has an active compliance case with different accepted quote linkage.",
    );
  }
  return adminJson({
    ok: true,
    idempotent: true,
    complianceCaseId: String(row.id),
    complianceCaseNumber: String(row.case_number),
  });
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) {
    return adminJson({
      ok: false,
      error: "Request origin was not accepted.",
    }, 403);
  }
  try {
    const access = await requireVerifiedTradeAccess(request, {
      partnerTypes: ["installer"],
    });
    let parsedBody: unknown;
    try {
      parsedBody = await readBoundedJsonRequest(
        request,
        MAX_COMPLIANCE_INTAKE_JSON_BYTES,
      );
    } catch (error) {
      return adminJson({
        ok: false,
        error: error instanceof BoundedJsonRequestError
          && error.code === "REQUEST_TOO_LARGE"
          ? "The compliance intake request is too large."
          : "The compliance intake request is invalid.",
      }, error instanceof BoundedJsonRequestError ? error.status : 400);
    }
    if (
      !parsedBody
      || typeof parsedBody !== "object"
      || Array.isArray(parsedBody)
    ) {
      return adminJson({
        ok: false,
        error: "The compliance intake request is invalid.",
      }, 400);
    }
    const body = parsedBody as Row;
    const unexpected = Object.keys(body)
      .filter((field) => !POST_FIELDS.has(field));
    if (unexpected.length) {
      return adminJson({
        ok: false,
        error: "Compliance intake only accepts the job, planned activity, published activity version, idempotency key and optional accepted quote linkage.",
      }, 400);
    }
    const workOrderId = requiredInput(body.workOrderId, "Work order");
    const complianceIntentId = optionalInput(
      body.complianceIntentId,
      "Planned activity",
      180,
    );
    const activityVersionId = requiredInput(
      body.activityVersionId,
      "Published activity version",
    );
    const idempotencyKey = requiredInput(
      body.idempotencyKey,
      "Idempotency key",
    );
    const optionalHandoff = optionalCommercialHandoff(body);
    const database = getD1();
    await ensureCreditexSchemaGuards(database);
    const creditexOrganisation = await activeCreditexOrganisation(database);
    const context = await ownedJobContext(
      database,
      access.identity.uid,
      workOrderId,
      creditexOrganisation.id,
      complianceIntentId,
    );
    const currentCase = await activeCase(
      database,
      creditexOrganisation.id,
      access.identity.uid,
      workOrderId,
      context.complianceIntentId,
    );
    if (currentCase) {
      return activeCaseResponse(
        currentCase,
        activityVersionId,
        optionalHandoff,
      );
    }
    const idempotencyDigest = await sha256Hex(
      [
        "tlink-compliance-intake-v1",
        access.identity.uid,
        workOrderId,
        context.complianceIntentId,
        activityVersionId,
        idempotencyKey,
        optionalHandoff.commercialHandoffId,
        optionalHandoff.acceptedQuoteVersionId,
        optionalHandoff.acceptedScopeSha256,
      ].join("\n"),
    );
    const now = new Date().toISOString();
    const statements: D1PreparedStatement[] = [];
    const prepared = await appendLiveComplianceCaseStatements(
      database,
      statements,
      {
        activityVersionId,
        activityDate: context.activityDate,
        serviceCategory: context.serviceCategory,
        jurisdiction: context.jurisdiction,
        workOrderId,
        complianceIntentId: context.complianceIntentId,
        ...optionalHandoff,
        installerUid: access.identity.uid,
        actorType: "installer",
        actorUid: access.identity.uid,
        expectedOrganisation: creditexOrganisation,
        caseId: `compliance-case-${idempotencyDigest}`,
        eventId: `compliance-case-event-${idempotencyDigest}`,
        createdAt: now,
      },
    );
    statements.push(database.prepare(`INSERT INTO trade_work_order_events
      (id, work_order_id, firebase_uid, event_type, summary, created_at)
      VALUES (?, ?, ?, 'compliance_intake_created', ?, ?)`)
      .bind(
        `compliance-work-event-${idempotencyDigest}`,
        workOrderId,
        access.identity.uid,
        `${prepared.caseNumber} opened from the governed installer job.`,
        now,
      ));
    statements.push(
      database.prepare(`UPDATE trade_work_order_compliance_intents
        SET status = 'case_linked', compliance_case_id = ?, updated_at = ?
        WHERE id = ?
          AND compliance_organisation_id = ?
          AND work_order_id = ?
          AND installer_uid = ?
          AND status = 'planned'`)
        .bind(
          prepared.caseId,
          now,
          context.complianceIntentId,
          prepared.organisationId,
          workOrderId,
          access.identity.uid,
        ),
    );
    try {
      await database.batch(statements);
    } catch (error) {
      const concurrentCase = await activeCase(
        database,
        creditexOrganisation.id,
        access.identity.uid,
        workOrderId,
        context.complianceIntentId,
      );
      if (concurrentCase) {
        return activeCaseResponse(
          concurrentCase,
          activityVersionId,
          optionalHandoff,
        );
      }
      throw error;
    }
    return adminJson({
      ok: true,
      idempotent: false,
      complianceCaseId: prepared.caseId,
      complianceCaseNumber: prepared.caseNumber,
    }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}
