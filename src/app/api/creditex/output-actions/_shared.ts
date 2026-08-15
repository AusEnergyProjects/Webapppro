import {
  BoundedJsonRequestError,
  readBoundedJsonRequest,
} from "@/lib/bounded-json-request";
import {
  CreditexOutputActionError,
  listCreditexOutputActions,
  listCreditexOutputActionCandidates,
  listCreditexOutputActionReceipts,
  loadCreditexOutputAction,
  loadCreditexOutputActionReceipt,
  prepareCreditexCertificateAction,
  prepareCreditexOperationalOutputAction,
  recordManualCreditexOutputProviderOutcome,
  recordManualCreditexOutputSubmission,
  reviewCreditexOutputAction,
} from "@/lib/creditex-output-action-server";
import type {
  CreditexWorkPackGovernanceActor,
} from "@/lib/creditex-activity-work-pack-server";
import { ComplianceAccessError } from "@/lib/compliance-access-server";
import {
  CreditexSresActivationError,
  freezeCreditexSresActivationSnapshot,
  listCreditexSresActivationEvidenceOptions,
  loadCreditexSresActivationState,
  recordCreditexSresActivationEvidence,
  reviewCreditexSresActivationEvidence,
} from "@/lib/creditex-sres-certificate-activation-server";

const MAXIMUM_OUTPUT_ACTION_REQUEST_BYTES = 256 * 1024;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function outputActionJson(body: object, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export function outputActionError(error: unknown) {
  if (
    error instanceof CreditexOutputActionError
    || error instanceof CreditexSresActivationError
    || error instanceof ComplianceAccessError
    || error instanceof BoundedJsonRequestError
  ) {
    return outputActionJson({
      ok: false,
      code: error instanceof CreditexOutputActionError
        || error instanceof CreditexSresActivationError
        ? error.code
        : undefined,
      error: error.message,
    }, error.status);
  }
  throw error;
}

export async function handleCreditexOutputActionRequest(
  request: Request,
  database: D1Database,
  actor: CreditexWorkPackGovernanceActor,
) {
  const loadProjection = async () => {
    const candidates = await listCreditexOutputActionCandidates(database, actor);
    const sresActivationCandidates = await Promise.all(candidates
      .filter((candidate) =>
        candidate.programCode === "SRES"
          && candidate.outputClass === "tradable_certificate"
      )
      .map(async (candidate) => Object.freeze({
        candidate: Object.freeze({
          jobReference: candidate.jobReference,
          jobLabel: candidate.jobLabel,
          customerLabel: candidate.customerLabel,
          activityTitle: candidate.activityTitle,
          outputCode: candidate.outputCode,
          activityTemplateId: candidate.activityTemplateId,
          caseInstanceId: candidate.caseInstanceId,
          complianceCaseId: candidate.complianceCaseId,
        }),
        activation: await loadCreditexSresActivationState(database, actor, {
          activityTemplateId: candidate.activityTemplateId,
          caseId: candidate.complianceCaseId,
        }),
        options: await listCreditexSresActivationEvidenceOptions(
          database,
          actor,
          {
            activityTemplateId: candidate.activityTemplateId,
            caseId: candidate.complianceCaseId,
          },
        ),
      })));
    return Object.freeze({
      actions: await listCreditexOutputActions(database, actor),
      candidates,
      sresActivationCandidates: Object.freeze(sresActivationCandidates),
      receipts: await listCreditexOutputActionReceipts(
        database,
        actor.organisationId,
      ),
    });
  };
  const url = new URL(request.url);
  if (request.method === "GET" && url.searchParams.get("download") === "packet") {
    const action = await loadCreditexOutputAction(
      database,
      actor.organisationId,
      url.searchParams.get("packetId") || "",
    );
    const body = JSON.stringify({
      contract: "creditex-output-action-packet-download/v1",
      packetSha256: action.packetSha256,
      packet: action.packet,
    }, null, 2);
    return new Response(body, {
      status: 200,
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="creditex-output-${action.id.replace(/[^a-z0-9_-]+/gi, "-")}.json"`,
        "X-Content-Type-Options": "nosniff",
      },
    });
  }
  if (request.method === "GET" && url.searchParams.get("download") === "receipt") {
    const receipt = await loadCreditexOutputActionReceipt(
      database,
      actor.organisationId,
      url.searchParams.get("receiptId") || "",
    );
    return new Response(JSON.stringify(receipt, null, 2), {
      status: 200,
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="creditex-provider-receipt-${receipt.id.replace(/[^a-z0-9_-]+/gi, "-")}.json"`,
        "X-Content-Type-Options": "nosniff",
      },
    });
  }
  if (request.method === "GET") {
    return outputActionJson({
      ok: true,
      ...await loadProjection(),
    });
  }
  const body = record(await readBoundedJsonRequest(
    request,
    MAXIMUM_OUTPUT_ACTION_REQUEST_BYTES,
  ));
  const action = String(body.action || "");
  let saved: Readonly<Record<string, unknown>>;
  if (request.method === "POST" && action === "prepare_certificate") {
    saved = await prepareCreditexCertificateAction(database, actor, {
      idempotencyKey: body.idempotencyKey,
      activityTemplateId: body.activityTemplateId,
      caseInstanceId: body.caseInstanceId,
    });
  } else if (request.method === "POST" && action === "prepare_operational") {
    saved = await prepareCreditexOperationalOutputAction(database, actor, {
      idempotencyKey: body.idempotencyKey,
      activityTemplateId: body.activityTemplateId,
      caseInstanceId: body.caseInstanceId,
    });
  } else if (request.method === "PATCH" && action === "review") {
    saved = await reviewCreditexOutputAction(database, actor, {
      packetId: body.packetId,
      expectedPacketSha256: body.expectedPacketSha256,
      decision: body.decision,
      comment: body.comment,
    });
  } else if (request.method === "POST" && action === "record_manual_submission") {
    saved = await recordManualCreditexOutputSubmission(database, actor, {
      packetId: body.packetId,
      expectedPacketSha256: body.expectedPacketSha256,
      providerName: body.providerName,
      providerReference: body.providerReference,
      submittedAt: body.submittedAt,
      submissionMethod: body.submissionMethod,
    });
  } else if (request.method === "PATCH" && action === "record_provider_outcome") {
    saved = await recordManualCreditexOutputProviderOutcome(database, actor, {
      packetId: body.packetId,
      expectedPacketSha256: body.expectedPacketSha256,
      providerStatus: body.providerStatus,
      providerName: body.providerName,
      providerReference: body.providerReference,
      responseCode: body.responseCode,
      responseText: body.responseText,
      occurredAt: body.occurredAt,
    });
  } else if (request.method === "POST" && action === "record_sres_activation") {
    saved = await recordCreditexSresActivationEvidence(database, actor, {
      clientRequestId: body.clientRequestId,
      activityTemplateId: body.activityTemplateId,
      caseId: body.caseId,
      evidenceKind: body.evidenceKind,
      subjectKey: body.subjectKey,
      sourceArtifactId: body.sourceArtifactId,
      sourceRecordKey: body.sourceRecordKey,
      details: body.details,
      observedAt: body.observedAt,
      validUntil: body.validUntil,
      supersedesRecordId: body.supersedesRecordId,
    });
  } else if (request.method === "PATCH" && action === "review_sres_activation") {
    saved = await reviewCreditexSresActivationEvidence(database, actor, {
      recordId: body.recordId,
      decision: body.decision,
      reviewNote: body.reviewNote,
    });
  } else if (request.method === "POST" && action === "freeze_sres_activation") {
    saved = await freezeCreditexSresActivationSnapshot(database, actor, {
      clientRequestId: body.clientRequestId,
      activityTemplateId: body.activityTemplateId,
      caseId: body.caseId,
    });
  } else {
    throw new CreditexOutputActionError(
      "OUTPUT_ACTION_REQUEST_INVALID",
      400,
      "Choose a supported governed output action.",
    );
  }
  return outputActionJson({
    ok: true,
    ...saved,
    ...await loadProjection(),
  });
}
