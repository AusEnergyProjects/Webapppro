import { getD1 } from "../../../../../db";
import { adminJson } from "@/lib/admin-server";
import {
  readBoundedJsonRequest,
} from "@/lib/bounded-json-request";
import { getCreditexCustodyBucket } from "@/lib/creditex-custody-bucket";
import {
  captureAssignedCreditexActivityWorkPackSignatures,
  commitAssignedCreditexActivityWorkPack,
  finaliseAssignedCreditexActivityWorkPack,
  listAssignedCreditexActivityWorkPacks,
  listAssignedCreditexActivityWorkPackOfficialProducts,
  loadAssignedCreditexActivityWorkPack,
  prepareAssignedCreditexActivityWorkPackSigning,
  refreshAssignedCreditexActivityWorkPackExecutionContext,
  runAssignedCreditexActivityWorkPackCalculator,
  selectAssignedCreditexActivityWorkPackOfficialProducts,
  selectAssignedCreditexActivityWorkPackScenario,
  updateAssignedCreditexActivityWorkPackCustomerContext,
  type CreditexWorkPackArtifactLinkInput,
  type CreditexWorkPackDependencyInput,
  type CreditexWorkPackMutationIdempotency,
  type CreditexWorkPackOfficialProductSelectionInput,
  type CreditexWorkPackReferenceAcknowledgementInput,
  type CreditexWorkPackSectionPatch,
  type CreditexWorkPackSignaturePacketInput,
} from "@/lib/creditex-activity-work-pack-server";
import type {
  CreditexActivityWorkPackCustomerContext,
} from "@/lib/creditex-activity-work-pack";
import {
  reconcileReadyPlannedComplianceWorkPacks,
} from "@/lib/creditex-compliance-server";
import {
  assignedWorkPackBytesResponse,
  assignedWorkPackError,
  assignedWorkPackOrigin,
  assignedWorkPackRequestScope,
} from "./_shared";

export const runtime = "edge";
export const dynamic = "force-dynamic";

const MAXIMUM_WORK_PACK_REQUEST_BYTES = 512 * 1024;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

type AssignedArtifactRecord = {
  custody_locator: string;
  original_file_name: string;
  content_type: string;
  size_bytes: number;
  original_sha256: string;
  integrity_receipt_id: string;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function list<T>(value: unknown) {
  return Array.isArray(value) ? value as readonly T[] : [];
}

function idempotency(value: unknown): CreditexWorkPackMutationIdempotency {
  const source = record(value);
  return {
    clientActionId: String(source.clientActionId || ""),
    deviceId: String(source.deviceId || ""),
    payloadHash: String(source.payloadHash || ""),
  };
}

function exactArtifactParameter(search: URLSearchParams, key: string) {
  const value = String(search.get(key) || "").trim();
  return value.length <= 240 ? value : "";
}

async function sha256(value: Uint8Array) {
  const exact = new Uint8Array(value.byteLength);
  exact.set(value);
  const digest = await crypto.subtle.digest("SHA-256", exact.buffer);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function assignedArtifactResponse(
  scope: Awaited<ReturnType<typeof assignedWorkPackRequestScope>>,
  search: URLSearchParams,
) {
  if (!scope.canViewFieldEvidence) {
    return adminJson({
      ok: false,
      code: "FIELD_EVIDENCE_ACCESS_REQUIRED",
      error: "Your team permissions do not allow access to field evidence.",
    }, 403);
  }
  const workOrderId = exactArtifactParameter(search, "workOrderId");
  const caseInstanceId = exactArtifactParameter(search, "caseInstanceId");
  const artifactId = exactArtifactParameter(search, "artifactId");
  if (!workOrderId || !caseInstanceId || !artifactId) {
    return adminJson({
      ok: false,
      code: "WORK_PACK_ARTIFACT_REQUIRED",
      error: "Choose a governed file from this job.",
    }, 400);
  }

  const retained = await getD1().prepare(`SELECT
      artifact.object_key custody_locator,
      artifact.original_file_name,
      artifact.content_type,
      artifact.size_bytes,
      artifact.original_sha256,
      artifact.integrity_receipt_id
    FROM compliance_activity_work_pack_artifacts artifact
    JOIN compliance_activity_work_pack_instances instance
      ON instance.id = ?
      AND instance.work_order_id = ?
      AND instance.organisation_id = artifact.organisation_id
      AND instance.instance_key = artifact.instance_key
    JOIN compliance_cases compliance_case
      ON compliance_case.id = instance.compliance_case_id
      AND compliance_case.organisation_id = instance.organisation_id
      AND compliance_case.work_order_id = instance.work_order_id
    JOIN trade_work_orders work_order
      ON work_order.id = instance.work_order_id
      AND work_order.firebase_uid = compliance_case.installer_uid
      AND work_order.firebase_uid = ?
      AND work_order.partner_type = 'installer'
      AND work_order.record_status = 'active'
    WHERE artifact.id = ?
      AND artifact.verification_state = 'matched'
      AND (? = 'team' OR work_order.assignee_member_id = ?)
      AND EXISTS (
        SELECT 1 FROM compliance_activity_work_pack_instances captured
        WHERE captured.id = artifact.case_instance_id
          AND captured.organisation_id = artifact.organisation_id
          AND captured.instance_key = artifact.instance_key
          AND captured.compliance_case_id = instance.compliance_case_id
          AND captured.work_order_id = instance.work_order_id
      )
      AND NOT EXISTS (
        SELECT 1 FROM compliance_activity_work_pack_instances newer
        WHERE newer.organisation_id = instance.organisation_id
          AND newer.compliance_case_id = instance.compliance_case_id
          AND newer.revision > instance.revision
      )
      AND NOT EXISTS (
        SELECT 1 FROM compliance_activity_work_pack_artifacts successor
        WHERE successor.organisation_id = artifact.organisation_id
          AND successor.instance_key = artifact.instance_key
          AND successor.supersedes_artifact_id = artifact.id
      )
    LIMIT 1`)
    .bind(
      caseInstanceId,
      workOrderId,
      scope.ownerUid,
      artifactId,
      scope.scope,
      scope.actorMemberId,
    )
    .first<AssignedArtifactRecord>();
  if (!retained) {
    return adminJson({
      ok: false,
      code: "WORK_PACK_ARTIFACT_NOT_FOUND",
      error: "The current governed file was not found for this assigned job.",
    }, 404);
  }

  const expectedSha256 = String(retained.original_sha256 || "")
    .trim().toLowerCase().replace(/^sha256:/, "");
  const expectedSizeBytes = Number(retained.size_bytes);
  const expectedContentType = String(retained.content_type || "").trim();
  if (
    !SHA256_PATTERN.test(expectedSha256)
    || !Number.isSafeInteger(expectedSizeBytes)
    || expectedSizeBytes < 1
    || !expectedContentType
  ) {
    return adminJson({
      ok: false,
      code: "WORK_PACK_ARTIFACT_INTEGRITY_INVALID",
      error: "The governed file custody record is invalid.",
    }, 409);
  }

  const object = await getCreditexCustodyBucket().get(retained.custody_locator);
  if (!object) {
    return adminJson({
      ok: false,
      code: "WORK_PACK_ARTIFACT_UNAVAILABLE",
      error: "The exact retained governed file is unavailable.",
    }, 409);
  }
  const bytes = new Uint8Array(await object.arrayBuffer());
  const actualSha256 = await sha256(bytes);
  if (
    bytes.byteLength !== expectedSizeBytes
    || actualSha256 !== expectedSha256
    || (
      object.httpMetadata?.contentType
      && object.httpMetadata.contentType.toLowerCase()
        !== expectedContentType.toLowerCase()
    )
  ) {
    return adminJson({
      ok: false,
      code: "WORK_PACK_ARTIFACT_INTEGRITY_MISMATCH",
      error: "The retained governed file no longer matches its exact custody record.",
    }, 409);
  }

  return assignedWorkPackBytesResponse(Object.freeze({
    bytes,
    contentType: expectedContentType,
    fileName: String(retained.original_file_name || "governed-file"),
    sizeBytes: bytes.byteLength,
    sha256: actualSha256,
    custodyReceiptId: String(retained.integrity_receipt_id || ""),
  }));
}

export async function GET(request: Request) {
  const rejected = assignedWorkPackOrigin(request);
  if (rejected) return rejected;
  try {
    const scope = await assignedWorkPackRequestScope(request);
    const search = new URL(request.url).searchParams;
    if (search.get("view") === "artifact") {
      return assignedArtifactResponse(scope, search);
    }
    const caseInstanceId = String(search.get("caseInstanceId") || "").trim();
    const productDependencyKey = String(
      search.get("officialProductDependencyKey") || "",
    ).trim();
    if (caseInstanceId && productDependencyKey) {
      const rawLimit = String(search.get("limit") || "").trim();
      return adminJson({
        ok: true,
        officialProducts:
          await listAssignedCreditexActivityWorkPackOfficialProducts(getD1(), {
            ...scope,
            caseInstanceId,
            dependencyKey: productDependencyKey,
            search: String(search.get("search") || ""),
            ...(rawLimit ? { limit: Number(rawLimit) } : {}),
          }),
      });
    }
    if (caseInstanceId) {
      return adminJson({
        ok: true,
        workPack: await loadAssignedCreditexActivityWorkPack(getD1(), {
          ...scope,
          caseInstanceId,
        }),
      });
    }
    const workOrderIds = search.getAll("workOrderId")
      .map((value) => value.trim())
      .filter(Boolean);
    if (!workOrderIds.length) {
      return adminJson({
        ok: false,
        code: "WORK_PACK_JOB_REQUIRED",
        error: "Choose an assigned job to load its activity work packs.",
      }, 400);
    }
    return adminJson({
      ok: true,
      instances: await listAssignedCreditexActivityWorkPacks(getD1(), {
        ...scope,
        workOrderIds,
      }),
    });
  } catch (error) {
    return assignedWorkPackError(error);
  }
}

export async function POST(request: Request) {
  const rejected = assignedWorkPackOrigin(request);
  if (rejected) return rejected;
  try {
    const scope = await assignedWorkPackRequestScope(request);
    const body = record(await readBoundedJsonRequest(
      request,
      MAXIMUM_WORK_PACK_REQUEST_BYTES,
    ));
    const action = String(body.action || "");
    const database = getD1();
    if (action === "work_pack_reconcile_planned") {
      const workOrderId = String(body.workOrderId || "").trim();
      const workPacks = await reconcileReadyPlannedComplianceWorkPacks(
        database,
        {
          workOrderId,
          installerUid: scope.ownerUid,
          actorUid: scope.actorUid,
        },
      );
      return adminJson({
        ok: true,
        result: {
          workPacks,
          workPackReady: workPacks.length > 0
            && workPacks.every((item) => item.workPackReady),
          workPackBlockers: workPacks.flatMap((item) => item.blockers),
        },
      });
    }
    const common = {
      ...scope,
      caseInstanceId: String(body.caseInstanceId || ""),
      expectedResponseSha256: String(body.expectedResponseSha256 || ""),
      idempotency: idempotency(body.idempotency),
    };
    if (action === "work_pack_commit") {
      const dependencyResolutions = Object.fromEntries(Object.entries(
        record(body.dependencyResolutions),
      ).map(([key, value]) => [
        key,
        record(value) as CreditexWorkPackDependencyInput,
      ]));
      const result = await commitAssignedCreditexActivityWorkPack(database, {
        ...common,
        sectionPatches: list<CreditexWorkPackSectionPatch>(body.sectionPatches),
        dependencyResolutions,
        referenceAcknowledgements:
          list<CreditexWorkPackReferenceAcknowledgementInput>(
            body.referenceAcknowledgements,
          ),
        artifactLinks: list<CreditexWorkPackArtifactLinkInput>(
          body.artifactLinks,
        ),
      });
      return adminJson({ ok: true, result });
    }
    if (action === "work_pack_prepare_signing") {
      const result = await prepareAssignedCreditexActivityWorkPackSigning(
        database,
        common,
      );
      return adminJson({ ok: true, result });
    }
    if (action === "work_pack_capture_signatures") {
      const result = await captureAssignedCreditexActivityWorkPackSignatures(
        database,
        {
          ...common,
          packets: list<CreditexWorkPackSignaturePacketInput>(body.packets),
        },
      );
      return adminJson({ ok: true, result });
    }
    if (action === "work_pack_update_customer_context") {
      const result = await updateAssignedCreditexActivityWorkPackCustomerContext(
        database,
        {
          ...common,
          customerContextBinding:
            record(body.customerContextBinding) as CreditexActivityWorkPackCustomerContext,
          customerPatch: record(body.customerPatch),
          sitePatch: record(body.sitePatch),
          contactPatch: record(body.contactPatch),
        },
      );
      return adminJson({ ok: true, result });
    }
    if (action === "work_pack_refresh_execution_context") {
      const result = await refreshAssignedCreditexActivityWorkPackExecutionContext(
        database,
        common,
      );
      return adminJson({ ok: true, result });
    }
    if (action === "work_pack_select_scenario") {
      const result = await selectAssignedCreditexActivityWorkPackScenario(
        database,
        {
          ...common,
          dependencyKey: String(body.dependencyKey || ""),
          scenarioCode: String(body.scenarioCode || ""),
        },
      );
      return adminJson({ ok: true, result });
    }
    if (action === "work_pack_select_official_products") {
      const result = await selectAssignedCreditexActivityWorkPackOfficialProducts(
        database,
        {
          ...common,
          dependencyKey: String(body.dependencyKey || ""),
          selections: list<CreditexWorkPackOfficialProductSelectionInput>(
            body.selections,
          ),
        },
      );
      return adminJson({ ok: true, result });
    }
    if (action === "work_pack_run_calculator") {
      const result = await runAssignedCreditexActivityWorkPackCalculator(
        database,
        {
          ...common,
          dependencyKey: String(body.dependencyKey || ""),
        },
      );
      return adminJson({ ok: true, result });
    }
    if (action === "work_pack_finalize") {
      const result = await finaliseAssignedCreditexActivityWorkPack(
        database,
        common,
      );
      return adminJson({ ok: true, result });
    }
    return adminJson({
      ok: false,
      code: "WORK_PACK_ACTION_INVALID",
      error: "Choose a supported assigned work-pack action.",
    }, 400);
  } catch (error) {
    return assignedWorkPackError(error);
  }
}
