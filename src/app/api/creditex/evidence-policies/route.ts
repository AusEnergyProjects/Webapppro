import { getD1 } from "../../../../../db";
import {
  ComplianceAccessError,
  requireComplianceAccess,
} from "@/lib/compliance-access-server";
import {
  ComplianceDomainError,
  listComplianceEvidencePolicies,
  listComplianceGovernanceRequests,
  prepareComplianceEvidencePolicyCreateStatement,
  prepareComplianceEvidencePolicyDraftDeleteStatements,
  prepareComplianceEvidencePolicyUpdateStatements,
  prepareComplianceEvidencePolicyWithdrawStatement,
  prepareComplianceEvidenceRequirementDeleteStatements,
  prepareComplianceEvidenceRequirementReorderStatements,
  prepareComplianceEvidenceRequirementSaveStatements,
  prepareCompliancePublicationDecisionStatements,
  prepareCompliancePublicationRequestStatements,
  runComplianceGovernanceMutation,
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
  if (
    error instanceof ComplianceAccessError
    || error instanceof ComplianceDomainError
  ) {
    return json({ ok: false, code: error.code, error: error.message }, error.status);
  }
  if (error instanceof Error && error.message === "AUTH_REQUIRED") {
    return json({
      ok: false,
      code: "AUTH_REQUIRED",
      error: "Sign in to continue.",
    }, 401);
  }
  if (
    error instanceof Error
    && (
      error.message.includes("UNIQUE constraint failed")
      || error.message.includes("SQLITE_CONSTRAINT_UNIQUE")
    )
  ) {
    return json({
      ok: false,
      code: "COMPLIANCE_RECORD_EXISTS",
      error: "A governed evidence-policy record already uses that code or version.",
    }, 409);
  }
  const guardCode = error instanceof Error
    ? error.message.match(/COMPLIANCE_[A-Z0-9_]+/)?.[0]
    : "";
  if (guardCode) {
    return json({
      ok: false,
      code: guardCode,
      error: "The governed record changed or failed a compliance write guard. Refresh and review it before trying again.",
    }, 409);
  }
  console.error("Creditex evidence-policy governance failed", error);
  return json({
    ok: false,
    code: "COMPLIANCE_GOVERNANCE_UNAVAILABLE",
    error: "The governed evidence-policy records could not be changed. Try again.",
  }, 500);
}

function requiredBody(requestBody: unknown): Body {
  if (
    !requestBody
    || typeof requestBody !== "object"
    || Array.isArray(requestBody)
  ) {
    throw new ComplianceDomainError(
      "INVALID_REQUEST",
      400,
      "Enter a valid evidence-policy governance request.",
    );
  }
  return requestBody as Body;
}

function requiredReason(value: unknown, code: string, label: string) {
  const reason = String(value || "").trim();
  if (!reason || reason.length > 4_000) {
    throw new ComplianceDomainError(
      code,
      400,
      `Enter ${label.toLowerCase()} (up to 4,000 characters).`,
    );
  }
  return reason;
}

function governanceListQuery(request: Request) {
  const searchParams = new URL(request.url).searchParams;
  const programId = String(searchParams.get("programId") || "").trim();
  const activityVersionId = String(
    searchParams.get("activityVersionId") || "",
  ).trim();
  if (programId.length > 180 || activityVersionId.length > 180) {
    throw new ComplianceDomainError(
      "INVALID_GOVERNANCE_SCOPE",
      400,
      "Choose a valid program and activity scope.",
    );
  }
  const checkedPage = (name: "policyPage" | "requestPage") => {
    const value = String(searchParams.get(name) || "1");
    const page = Number(value);
    if (
      !/^[1-9]\d{0,4}$/.test(value)
      || !Number.isSafeInteger(page)
      || page > 10_000
    ) {
      throw new ComplianceDomainError(
        "INVALID_GOVERNANCE_PAGE",
        400,
        "Choose a governance page from 1 to 10,000.",
      );
    }
    return page;
  };
  const pageSizeValue = String(searchParams.get("pageSize") || "25");
  if (!/^[1-9]\d{0,2}$/.test(pageSizeValue)) {
    throw new ComplianceDomainError(
      "INVALID_GOVERNANCE_PAGE",
      400,
      "Choose a governance page size from 1 to 100.",
    );
  }
  const pageSize = Number(pageSizeValue);
  if (pageSize > 100) {
    throw new ComplianceDomainError(
      "INVALID_GOVERNANCE_PAGE",
      400,
      "Choose a governance page size from 1 to 100.",
    );
  }
  return {
    programId,
    activityVersionId,
    policyPage: checkedPage("policyPage"),
    requestPage: checkedPage("requestPage"),
    pageSize,
  };
}

async function policyIdForRequirement(
  database: D1Database,
  organisationId: string,
  requirementId: string,
) {
  const row = await database.prepare(`SELECT policy_version_id
      FROM compliance_evidence_requirements
      WHERE id = ? AND organisation_id = ?
      LIMIT 1`)
    .bind(requirementId, organisationId)
    .first<Record<string, unknown>>();
  const policyId = String(row?.policy_version_id || "");
  if (!policyId) {
    throw new ComplianceDomainError(
      "EVIDENCE_REQUIREMENT_NOT_FOUND",
      404,
      "The draft evidence requirement was not found.",
    );
  }
  return policyId;
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
    const query = governanceListQuery(request);
    const [policies, publicationRequests] = await Promise.all([
      listComplianceEvidencePolicies(database, member.organisationId, {
        programId: query.programId,
        activityVersionId: query.activityVersionId,
        page: query.policyPage,
        pageSize: query.pageSize,
      }),
      listComplianceGovernanceRequests(
        database,
        member.organisationId,
        member.uid,
        {
          programId: query.programId,
          activityVersionId: query.activityVersionId,
          page: query.requestPage,
          pageSize: query.pageSize,
        },
      ),
    ]);
    const pendingByPolicyId = new Map(
      publicationRequests.items
        .filter((item) =>
          item.targetType === "evidence_policy" && item.status === "pending"
        )
        .map((item) => [item.targetId, item]),
    );
    return json({
      ok: true,
      policies: policies.items.map((policy) => ({
        ...policy,
        pendingPublicationRequest: pendingByPolicyId.get(policy.id) || null,
      })),
      publicationRequests: publicationRequests.items,
      pagination: {
        policies: policies.pagination,
        publicationRequests: publicationRequests.pagination,
      },
    });
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

    if (action === "create_policy") {
      const prepared = prepareComplianceEvidencePolicyCreateStatement(
        database,
        {
          organisationId: member.organisationId,
          activityVersionId: String(body.activityVersionId || ""),
          version: Number(body.version),
          title: String(body.title || ""),
          officialSourceUrl: String(body.officialSourceUrl || ""),
          officialSourceTitle: String(body.officialSourceTitle || ""),
          officialSourceVersion: String(body.officialSourceVersion || ""),
          officialSourceSha256: String(body.officialSourceSha256 || ""),
          officialSourceCheckedAt: String(body.officialSourceCheckedAt || ""),
          actorUid: member.uid,
        },
      );
      await runComplianceGovernanceMutation(
        database,
        member,
        [prepared.statement],
        {
          eventType: "evidence_policy.created",
          targetType: "compliance_evidence_policy",
          targetId: prepared.id,
          summary: "A source-backed evidence-policy draft was created.",
          metadata: {
            activityVersionId: String(body.activityVersionId || ""),
            officialSourceSha256: String(body.officialSourceSha256 || ""),
          },
        },
      );
      return json({ ok: true, id: prepared.id }, 201);
    }

    if (action === "update_policy") {
      const prepared = await prepareComplianceEvidencePolicyUpdateStatements(
        database,
        {
          organisationId: member.organisationId,
          policyId: String(body.policyId || ""),
          title: String(body.title || ""),
          officialSourceUrl: String(body.officialSourceUrl || ""),
          officialSourceTitle: String(body.officialSourceTitle || ""),
          officialSourceVersion: String(body.officialSourceVersion || ""),
          officialSourceSha256: String(body.officialSourceSha256 || ""),
          officialSourceCheckedAt: String(body.officialSourceCheckedAt || ""),
        },
      );
      await runComplianceGovernanceMutation(
        database,
        member,
        prepared.statements,
        {
          eventType: "evidence_policy.updated",
          targetType: "compliance_evidence_policy",
          targetId: prepared.id,
          summary: "An evidence-policy draft was updated and any pending review was superseded.",
          metadata: {
            officialSourceSha256: String(body.officialSourceSha256 || ""),
          },
        },
        { optionalStatementIndexes: [0] },
      );
      return json({ ok: true, id: prepared.id });
    }

    if (action === "save_requirement") {
      const prepared = await prepareComplianceEvidenceRequirementSaveStatements(
        database,
        {
          organisationId: member.organisationId,
          policyId: String(body.policyId || ""),
          requirementId: String(body.requirementId || ""),
          requirementCode: String(body.requirementCode || ""),
          title: String(body.title || ""),
          description: String(body.description || ""),
          evidenceType: String(body.evidenceType || ""),
          captureTiming: String(body.captureTiming || ""),
          minimumCount: Number(body.minimumCount),
          maximumCount: Number(body.maximumCount),
          originalRequired: body.originalRequired === true,
          metadataRequired: body.metadataRequired === true,
          gpsRequired: body.gpsRequired === true,
          dateStampRequired: body.dateStampRequired === true,
          installerSignatureRequired:
            body.installerSignatureRequired === true,
          customerSignatureRequired: body.customerSignatureRequired === true,
          allowedContentTypes: body.allowedContentTypes,
          conditionSnapshot: body.conditionSnapshot,
          fieldSchema: body.fieldSchema,
          sourceCitation: String(body.sourceCitation || ""),
          sortOrder: Number(body.sortOrder),
          actorUid: member.uid,
        },
      );
      await runComplianceGovernanceMutation(
        database,
        member,
        prepared.statements,
        {
          eventType: prepared.created
            ? "evidence_requirement.created"
            : "evidence_requirement.updated",
          targetType: "compliance_evidence_requirement",
          targetId: prepared.id,
          summary: prepared.created
            ? "A governed evidence requirement was added to the draft policy."
            : "A governed evidence requirement was updated and any pending review was superseded.",
          metadata: { policyId: prepared.policyId },
        },
        { optionalStatementIndexes: [0] },
      );
      return json(
        {
          ok: true,
          id: prepared.id,
          policyId: prepared.policyId,
          created: prepared.created,
        },
        prepared.created ? 201 : 200,
      );
    }

    if (action === "delete_requirement") {
      const requirementId = String(body.requirementId || "");
      const policyId = String(body.policyId || "")
        || await policyIdForRequirement(
          database,
          member.organisationId,
          requirementId,
        );
      const prepared = await prepareComplianceEvidenceRequirementDeleteStatements(
        database,
        member.organisationId,
        policyId,
        requirementId,
      );
      await runComplianceGovernanceMutation(
        database,
        member,
        prepared.statements,
        {
          eventType: "evidence_requirement.deleted",
          targetType: "compliance_evidence_requirement",
          targetId: prepared.id,
          summary: "A draft evidence requirement was deleted and any pending review was superseded.",
          metadata: { policyId: prepared.policyId },
        },
        { optionalStatementIndexes: [0] },
      );
      return json({ ok: true, id: prepared.id, policyId: prepared.policyId });
    }

    if (action === "reorder_requirements") {
      const prepared = await prepareComplianceEvidenceRequirementReorderStatements(
        database,
        member.organisationId,
        String(body.policyId || ""),
        body.requirementIds,
      );
      await runComplianceGovernanceMutation(
        database,
        member,
        prepared.statements,
        {
          eventType: "evidence_requirements.reordered",
          targetType: "compliance_evidence_policy",
          targetId: prepared.policyId,
          summary: "The draft evidence requirements were reordered and any pending review was superseded.",
          metadata: {
            requirementIds: Array.isArray(body.requirementIds)
              ? body.requirementIds
              : [],
          },
        },
        { optionalStatementIndexes: [0] },
      );
      return json({ ok: true, policyId: prepared.policyId });
    }

    if (action === "delete_draft_policy") {
      const prepared = await prepareComplianceEvidencePolicyDraftDeleteStatements(
        database,
        member.organisationId,
        String(body.policyId || ""),
      );
      await runComplianceGovernanceMutation(
        database,
        member,
        prepared.statements,
        {
          eventType: "evidence_policy.draft_deleted",
          targetType: "compliance_evidence_policy",
          targetId: prepared.id,
          summary: "An evidence-policy draft was deleted with its governed snapshot retained in audit.",
          metadata: { deletedSnapshot: prepared.deletedSnapshot },
        },
        { optionalStatementIndexes: [0, 1] },
      );
      return json({ ok: true, id: prepared.id });
    }

    if (action === "request_policy_publication") {
      const requestReason = requiredReason(
        body.requestReason,
        "PUBLICATION_REASON_REQUIRED",
        "a publication-review reason",
      );
      const prepared = await prepareCompliancePublicationRequestStatements(
        database,
        {
          organisationId: member.organisationId,
          targetType: "evidence_policy",
          targetId: String(body.policyId || ""),
          requestReason,
          actorUid: member.uid,
        },
      );
      await runComplianceGovernanceMutation(
        database,
        member,
        prepared.statements,
        {
          eventType: "evidence_policy.publication_requested",
          targetType: "compliance_evidence_policy",
          targetId: prepared.targetId,
          summary: "A sealed evidence-policy publication review was requested.",
          metadata: {
            requestId: prepared.id,
            sealedSnapshotSha256: prepared.sealedSnapshotSha256,
            requestReason,
          },
        },
      );
      return json({
        ok: true,
        requestId: prepared.id,
        sealedSnapshotSha256: prepared.sealedSnapshotSha256,
      }, 201);
    }

    if (
      action === "approve_policy_publication"
      || action === "reject_policy_publication"
    ) {
      const outcome = action === "approve_policy_publication"
        ? "approved"
        : "rejected";
      const reviewNote = requiredReason(
        body.reviewNote,
        "PUBLICATION_REVIEW_NOTE_REQUIRED",
        "a publication-review note",
      );
      const prepared = await prepareCompliancePublicationDecisionStatements(
        database,
        {
          organisationId: member.organisationId,
          requestId: String(body.requestId || ""),
          outcome,
          reviewNote,
          actorUid: member.uid,
        },
      );
      if (prepared.targetType !== "evidence_policy") {
        throw new ComplianceDomainError(
          "PUBLICATION_REQUEST_TARGET_MISMATCH",
          409,
          "This publication request belongs to a different governed record.",
        );
      }
      await runComplianceGovernanceMutation(
        database,
        member,
        prepared.statements,
        {
          eventType: outcome === "approved"
            ? "evidence_policy.published"
            : "evidence_policy.publication_rejected",
          targetType: "compliance_evidence_policy",
          targetId: prepared.targetId,
          summary: outcome === "approved"
            ? "A different named administrator approved and published the sealed evidence policy."
            : "A named administrator rejected the sealed evidence-policy publication request.",
          metadata: {
            requestId: prepared.requestId,
            outcome,
            reviewNote,
          },
        },
      );
      return json({
        ok: true,
        requestId: prepared.requestId,
        outcome,
        targetId: prepared.targetId,
      });
    }

    if (action === "publish_policy") {
      throw new ComplianceDomainError(
        "COMPLIANCE_DUAL_CONTROL_REQUIRED",
        409,
        "Submit this evidence policy for review by a different named administrator.",
      );
    }

    if (action === "withdraw_policy") {
      const policyId = String(body.policyId || "");
      const reason = requiredReason(
        body.reason,
        "WITHDRAWAL_REASON_REQUIRED",
        "a withdrawal reason",
      );
      await runComplianceGovernanceMutation(
        database,
        member,
        [
          await prepareComplianceEvidencePolicyWithdrawStatement(
            database,
            member.organisationId,
            policyId,
            member.uid,
          ),
        ],
        {
          eventType: "evidence_policy.withdrawn",
          targetType: "compliance_evidence_policy",
          targetId: policyId,
          summary: "A published evidence policy was withdrawn from new work.",
          metadata: { reason },
        },
      );
      return json({ ok: true });
    }

    throw new ComplianceDomainError(
      "INVALID_GOVERNANCE_ACTION",
      400,
      "Choose a supported evidence-policy governance action.",
    );
  } catch (error) {
    return errorResponse(error);
  }
}
