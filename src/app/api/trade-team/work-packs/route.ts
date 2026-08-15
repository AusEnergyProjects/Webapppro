import { getD1 } from "../../../../../db";
import { adminJson } from "@/lib/admin-server";
import {
  readBoundedJsonRequest,
} from "@/lib/bounded-json-request";
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
  assignedWorkPackError,
  assignedWorkPackOrigin,
  assignedWorkPackRequestScope,
} from "./_shared";

export const runtime = "edge";
export const dynamic = "force-dynamic";

const MAXIMUM_WORK_PACK_REQUEST_BYTES = 512 * 1024;

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

export async function GET(request: Request) {
  const rejected = assignedWorkPackOrigin(request);
  if (rejected) return rejected;
  try {
    const scope = await assignedWorkPackRequestScope(request);
    const search = new URL(request.url).searchParams;
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
