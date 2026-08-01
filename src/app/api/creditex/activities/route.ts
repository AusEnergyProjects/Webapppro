import { getD1 } from "../../../../../db";
import {
  ComplianceAccessError,
  requireComplianceAccess,
} from "@/lib/compliance-access-server";
import {
  ComplianceDomainError,
  listComplianceActivityVersions,
  listCompliancePrograms,
  prepareComplianceActivityCreateStatement,
  prepareComplianceActivityDraftDeleteStatement,
  prepareComplianceActivityPublishStatement,
  prepareComplianceActivityWithdrawStatement,
  prepareComplianceProgramCreateStatement,
  prepareComplianceProgramDraftDeleteStatement,
  prepareComplianceProgramPublishStatement,
  prepareComplianceProgramWithdrawStatement,
} from "@/lib/creditex-compliance-server";

export const runtime = "edge";
export const dynamic = "force-dynamic";

type Body = Record<string, unknown>;

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
  if (error instanceof ComplianceAccessError || error instanceof ComplianceDomainError) {
    return json({ ok: false, code: error.code, error: error.message }, error.status);
  }
  if (error instanceof Error && error.message === "AUTH_REQUIRED") {
    return json({ ok: false, code: "AUTH_REQUIRED", error: "Sign in to continue." }, 401);
  }
  if (
    error instanceof Error
    && (error.message.includes("UNIQUE constraint failed")
      || error.message.includes("SQLITE_CONSTRAINT_UNIQUE"))
  ) {
    return json({
      ok: false,
      code: "COMPLIANCE_RECORD_EXISTS",
      error: "A governed record already uses that code or version.",
    }, 409);
  }
  if (
    error instanceof Error
    && (
      error.message.includes("compliance_write_guards")
      || error.message.includes("COMPLIANCE_")
    )
  ) {
    return json({
      ok: false,
      code: "COMPLIANCE_STATE_CONFLICT",
      error: "The governed record changed or its publication requirements are incomplete. Refresh and review it before trying again.",
    }, 409);
  }
  console.error("Creditex compliance governance failed", error);
  return json({
    ok: false,
    code: "COMPLIANCE_GOVERNANCE_UNAVAILABLE",
    error: "The governed compliance records could not be changed. Try again.",
  }, 500);
}

function requiredBody(requestBody: unknown): Body {
  if (!requestBody || typeof requestBody !== "object" || Array.isArray(requestBody)) {
    throw new ComplianceDomainError(
      "INVALID_REQUEST",
      400,
      "Enter a valid compliance governance request.",
    );
  }
  return requestBody as Body;
}

function requirementsSnapshot(value: unknown): Record<string, unknown> {
  let parsed: unknown = value;
  try {
    if (typeof value === "string") parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("OBJECT_REQUIRED");
    }
    return parsed as Record<string, unknown>;
  } catch {
    throw new ComplianceDomainError(
      "INVALID_REQUIREMENTS_SNAPSHOT",
      400,
      "Requirements snapshot must be a valid JSON object.",
    );
  }
}

async function runStateChange(
  database: D1Database,
  member: { uid: string; organisationId: string },
  statement: D1PreparedStatement,
  audit: {
    eventType: string;
    targetType: "compliance_program" | "compliance_activity_version";
    targetId: string;
    summary: string;
    metadata?: Record<string, unknown>;
  },
) {
  const now = new Date().toISOString();
  const operationId = crypto.randomUUID();
  await database.batch([
    statement,
    database.prepare(`INSERT INTO compliance_write_guards (
        id, organisation_id, operation_id, step_number, verified, created_at
      ) VALUES (?, ?, ?, 1, CASE WHEN changes() = 1 THEN 1 ELSE 0 END, ?)`)
      .bind(
        crypto.randomUUID(),
        member.organisationId,
        operationId,
        now,
      ),
    database.prepare(`INSERT INTO compliance_audit_events (
        id, organisation_id, actor_type, actor_uid, event_type,
        target_type, target_id, summary, metadata, created_at
      ) VALUES (?, ?, 'compliance', ?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        crypto.randomUUID(),
        member.organisationId,
        member.uid,
        audit.eventType,
        audit.targetType,
        audit.targetId,
        audit.summary,
        JSON.stringify(audit.metadata || {}),
        now,
      ),
  ]);
}

async function draftProgramSnapshot(
  database: D1Database,
  organisationId: string,
  programId: string,
) {
  return database.prepare(`SELECT program_code, name, scheme_kind,
      jurisdiction, administering_body, official_source_url,
      official_source_title, official_source_version, official_source_sha256,
      official_source_checked_at
    FROM compliance_programs
    WHERE id = ? AND organisation_id = ? AND publish_state = 'draft'`)
    .bind(programId, organisationId)
    .first<Record<string, unknown>>();
}

async function draftActivitySnapshot(
  database: D1Database,
  organisationId: string,
  activityId: string,
) {
  return database.prepare(`SELECT activity.activity_key, activity.version,
      activity.title, activity.service_category,
      activity.registry_activity_code, activity.specification_part,
      activity.product_category, activity.scenario_code, activity.scenario,
      activity.jurisdiction, activity.effective_from, activity.effective_to,
      activity.official_source_url, activity.official_source_title,
      activity.official_source_version, activity.official_source_sha256,
      activity.official_source_checked_at
    FROM compliance_activity_versions activity
    JOIN compliance_programs program
      ON program.id = activity.program_id
      AND program.organisation_id = ?
    WHERE activity.id = ? AND activity.publish_state = 'draft'`)
    .bind(organisationId, activityId)
    .first<Record<string, unknown>>();
}

export async function GET(request: Request) {
  if (!sameOrigin(request)) {
    return json({
      ok: false,
      code: "ORIGIN_REJECTED",
      error: "Request origin was not accepted.",
    }, 403);
  }
  try {
    const database = getD1();
    const member = await requireComplianceAccess(request, {
      allowedRoles: ["admin"],
    }, database);
    const [programs, activities] = await Promise.all([
      listCompliancePrograms(database, member.organisationId),
      listComplianceActivityVersions(database, member.organisationId),
    ]);
    return json({ ok: true, programs, activities });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) {
    return json({
      ok: false,
      code: "ORIGIN_REJECTED",
      error: "Request origin was not accepted.",
    }, 403);
  }
  try {
    const database = getD1();
    const member = await requireComplianceAccess(request, {
      allowedRoles: ["admin"],
    }, database);
    const body = requiredBody(await request.json().catch(() => null));
    const action = String(body.action || "");

    if (action === "create_program") {
      const prepared = prepareComplianceProgramCreateStatement(database, {
        organisationId: member.organisationId,
        programCode: String(body.programCode || ""),
        name: String(body.name || ""),
        schemeKind: String(body.schemeKind || ""),
        jurisdiction: String(body.jurisdiction || ""),
        administeringBody: String(body.administeringBody || ""),
        officialSourceUrl: String(body.officialSourceUrl || ""),
        officialSourceTitle: String(body.officialSourceTitle || ""),
        officialSourceVersion: String(body.officialSourceVersion || ""),
        officialSourceSha256: String(body.officialSourceSha256 || ""),
        officialSourceCheckedAt: String(body.officialSourceCheckedAt || ""),
        actorUid: member.uid,
      });
      await runStateChange(database, member, prepared.statement, {
        eventType: "program.created",
        targetType: "compliance_program",
        targetId: prepared.id,
        summary: "A source-backed compliance program draft was created.",
        metadata: {
          programCode: String(body.programCode || ""),
          officialSourceSha256: String(body.officialSourceSha256 || ""),
        },
      });
      return json({ ok: true, id: prepared.id }, 201);
    }

    if (action === "create_activity") {
      const prepared = prepareComplianceActivityCreateStatement(database, {
        organisationId: member.organisationId,
        programId: String(body.programId || ""),
        activityKey: String(body.activityKey || ""),
        version: Number(body.version),
        title: String(body.title || ""),
        serviceCategory: String(body.serviceCategory || ""),
        registryActivityCode: String(body.registryActivityCode || ""),
        specificationPart: String(body.specificationPart || ""),
        productCategory: String(body.productCategory || ""),
        scenarioCode: String(body.scenarioCode || ""),
        scenario: String(body.scenario || ""),
        jurisdiction: String(body.jurisdiction || ""),
        effectiveFrom: String(body.effectiveFrom || ""),
        effectiveTo: String(body.effectiveTo || ""),
        officialSourceUrl: String(body.officialSourceUrl || ""),
        officialSourceTitle: String(body.officialSourceTitle || ""),
        officialSourceVersion: String(body.officialSourceVersion || ""),
        officialSourceSha256: String(body.officialSourceSha256 || ""),
        officialSourceCheckedAt: String(body.officialSourceCheckedAt || ""),
        requirementsSnapshot: requirementsSnapshot(body.requirementsSnapshot),
        calculationApprovalState: "not_assessed",
        actorUid: member.uid,
      });
      await runStateChange(database, member, prepared.statement, {
        eventType: "activity.created",
        targetType: "compliance_activity_version",
        targetId: prepared.id,
        summary: "A source-backed compliance activity version draft was created.",
        metadata: {
          programId: String(body.programId || ""),
          activityKey: String(body.activityKey || ""),
          version: Number(body.version),
          officialSourceSha256: String(body.officialSourceSha256 || ""),
        },
      });
      return json({ ok: true, id: prepared.id }, 201);
    }

    if (action === "publish_program") {
      const programId = String(body.programId || "");
      await runStateChange(
        database,
        member,
        prepareComplianceProgramPublishStatement(
          database,
          member.organisationId,
          programId,
          member.uid,
        ),
        {
          eventType: "program.published",
          targetType: "compliance_program",
          targetId: programId,
          summary: "A reviewed compliance program was published.",
        },
      );
      return json({ ok: true });
    }
    if (action === "withdraw_program") {
      const programId = String(body.programId || "");
      await runStateChange(
        database,
        member,
        prepareComplianceProgramWithdrawStatement(
          database,
          member.organisationId,
          programId,
          member.uid,
        ),
        {
          eventType: "program.withdrawn",
          targetType: "compliance_program",
          targetId: programId,
          summary: "A published compliance program was withdrawn.",
        },
      );
      return json({ ok: true });
    }
    if (action === "publish_activity") {
      const activityId = String(body.activityId || "");
      await runStateChange(
        database,
        member,
        prepareComplianceActivityPublishStatement(
          database,
          member.organisationId,
          activityId,
          member.uid,
        ),
        {
          eventType: "activity.published",
          targetType: "compliance_activity_version",
          targetId: activityId,
          summary: "A reviewed compliance activity version was published.",
        },
      );
      return json({ ok: true });
    }
    if (action === "withdraw_activity") {
      const activityId = String(body.activityId || "");
      await runStateChange(
        database,
        member,
        prepareComplianceActivityWithdrawStatement(
          database,
          member.organisationId,
          activityId,
          member.uid,
        ),
        {
          eventType: "activity.withdrawn",
          targetType: "compliance_activity_version",
          targetId: activityId,
          summary: "A published compliance activity version was withdrawn.",
        },
      );
      return json({ ok: true });
    }
    if (action === "delete_draft_program") {
      const programId = String(body.programId || "");
      const deletedSnapshot = await draftProgramSnapshot(
        database,
        member.organisationId,
        programId,
      );
      if (!deletedSnapshot) {
        throw new ComplianceDomainError(
          "COMPLIANCE_STATE_CONFLICT",
          409,
          "This program is no longer an undeleted draft. Refresh the governance records.",
        );
      }
      await runStateChange(
        database,
        member,
        prepareComplianceProgramDraftDeleteStatement(
          database,
          member.organisationId,
          programId,
        ),
        {
          eventType: "program.draft_deleted",
          targetType: "compliance_program",
          targetId: programId,
          summary: "A compliance program draft was deleted with its source identity retained in audit.",
          metadata: { deletedSnapshot },
        },
      );
      return json({ ok: true });
    }
    if (action === "delete_draft_activity") {
      const activityId = String(body.activityId || "");
      const deletedSnapshot = await draftActivitySnapshot(
        database,
        member.organisationId,
        activityId,
      );
      if (!deletedSnapshot) {
        throw new ComplianceDomainError(
          "COMPLIANCE_STATE_CONFLICT",
          409,
          "This activity version is no longer an undeleted draft. Refresh the governance records.",
        );
      }
      await runStateChange(
        database,
        member,
        prepareComplianceActivityDraftDeleteStatement(
          database,
          member.organisationId,
          activityId,
        ),
        {
          eventType: "activity.draft_deleted",
          targetType: "compliance_activity_version",
          targetId: activityId,
          summary: "A compliance activity draft was deleted with its source identity retained in audit.",
          metadata: { deletedSnapshot },
        },
      );
      return json({ ok: true });
    }

    throw new ComplianceDomainError(
      "INVALID_GOVERNANCE_ACTION",
      400,
      "Choose a supported compliance governance action.",
    );
  } catch (error) {
    return errorResponse(error);
  }
}
