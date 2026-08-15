import {
  BoundedJsonRequestError,
  readBoundedJsonRequest,
} from "@/lib/bounded-json-request";
import {
  CreditexActivityWorkPackServerError,
  abandonCreditexWorkPackDraft,
  addCreditexWorkPackSourceBinding,
  createCreditexSourcedWorkPackDraft,
  createCreditexWorkPackDraft,
  listCreditexWorkPackGovernance,
  publishCreditexWorkPackVersion,
  reviewCreditexActivityWorkPackCalculation,
  reviewCreditexWorkPackSourceBinding,
  updateCreditexWorkPackDraft,
  withdrawCreditexWorkPackSourceBinding,
  withdrawCreditexWorkPackVersion,
  type CreditexWorkPackGovernanceActor,
} from "@/lib/creditex-activity-work-pack-server";
import { ComplianceAccessError } from "@/lib/compliance-access-server";

const MAXIMUM_GOVERNANCE_REQUEST_BYTES = 1024 * 1024;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function workPackGovernanceJson(body: object, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export function workPackGovernanceError(error: unknown) {
  if (error instanceof CreditexActivityWorkPackServerError
    || error instanceof ComplianceAccessError
    || error instanceof BoundedJsonRequestError) {
    return workPackGovernanceJson({
      ok: false,
      code: error.code,
      error: error.message,
    }, error.status);
  }
  throw error;
}

export async function handleCreditexWorkPackGovernanceRequest(
  request: Request,
  database: D1Database,
  actor: CreditexWorkPackGovernanceActor,
) {
  if (request.method === "GET") {
    return workPackGovernanceJson({
      ok: true,
      ...await listCreditexWorkPackGovernance(database, actor),
    });
  }
  const body = record(await readBoundedJsonRequest(
    request,
    MAXIMUM_GOVERNANCE_REQUEST_BYTES,
  ));
  const action = String(body.action || "");
  let saved: Readonly<Record<string, unknown>>;
  if (request.method === "POST" && action === "create_draft") {
    saved = await createCreditexWorkPackDraft(database, actor, {
      activityVersionId: body.activityVersionId,
      manualPolicyBindingId: body.manualPolicyBindingId,
      evidencePolicyVersionId: body.evidencePolicyVersionId,
      schema: body.schema,
      effectiveFrom: body.effectiveFrom,
      effectiveTo: body.effectiveTo,
    });
  } else if (request.method === "POST" && action === "create_sourced_draft") {
    saved = await createCreditexSourcedWorkPackDraft(database, actor, {
      activityVersionId: body.activityVersionId,
      clientRequestId: body.clientRequestId,
    });
  } else if (request.method === "PUT" && action === "update_draft") {
    saved = await updateCreditexWorkPackDraft(database, actor, {
      id: body.id,
      expectedSchemaSha256: body.expectedSchemaSha256,
      schema: body.schema,
      effectiveFrom: body.effectiveFrom,
      effectiveTo: body.effectiveTo,
    });
  } else if (request.method === "PATCH" && action === "add_source_binding") {
    saved = await addCreditexWorkPackSourceBinding(database, actor, {
      id: body.id,
      expectedSchemaSha256: body.expectedSchemaSha256,
      sourceArtifactId: body.sourceArtifactId,
      sourceRole: body.sourceRole,
      targetKey: body.targetKey,
      citationLocation: body.citationLocation,
    });
  } else if (request.method === "PATCH" && action === "review_source_binding") {
    saved = await reviewCreditexWorkPackSourceBinding(database, actor, {
      id: body.id,
      expectedSchemaSha256: body.expectedSchemaSha256,
      decision: body.decision,
      comment: body.comment,
    });
  } else if (request.method === "PATCH" && action === "review_calculation_run") {
    saved = await reviewCreditexActivityWorkPackCalculation(database, actor, {
      calculationRunId: body.calculationRunId,
      decision: body.decision,
      comment: body.comment,
    });
  } else if (request.method === "PATCH" && action === "withdraw_source_binding") {
    saved = await withdrawCreditexWorkPackSourceBinding(database, actor, {
      id: body.id,
      comment: body.comment,
    });
  } else if (request.method === "PATCH" && action === "publish_version") {
    saved = await publishCreditexWorkPackVersion(database, actor, {
      id: body.id,
      expectedSchemaSha256: body.expectedSchemaSha256,
      comment: body.comment,
    });
  } else if (request.method === "PATCH" && action === "withdraw_version") {
    saved = await withdrawCreditexWorkPackVersion(database, actor, {
      id: body.id,
      comment: body.comment,
    });
  } else if (request.method === "PATCH" && action === "abandon_draft") {
    saved = await abandonCreditexWorkPackDraft(database, actor, {
      id: body.id,
      expectedSchemaSha256: body.expectedSchemaSha256,
      comment: body.comment,
    });
  } else {
    throw new CreditexActivityWorkPackServerError(
      "WORK_PACK_GOVERNANCE_ACTION_INVALID",
      400,
      "Choose a supported governed work-pack action.",
    );
  }
  return workPackGovernanceJson({
    ok: true,
    ...await listCreditexWorkPackGovernance(database, actor),
    ...saved,
  });
}
