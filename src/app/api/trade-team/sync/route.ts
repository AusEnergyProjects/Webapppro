import { getD1 } from "../../../../../db";
import { adminJson, cleanAdminText, sameOrigin } from "@/lib/admin-server";
import { assignedJob, requireInstallerTeamAccess, type TeamAccess } from "@/lib/trade-team-server";
import { nextJobRevision } from "@/lib/trade-team-sync-server";
import { mobileAppPolicy, mobileErrorResponse, MOBILE_CLIENT_ID_PATTERN, MOBILE_CONTRACT_VERSION,
  requireRegisteredMobileDevice } from "@/lib/trade-mobile-server";
import { normalizeTradeFormAnswers, tradeFormCompletion } from "@/lib/trade-form-library.mjs";
import { addMonthsToIsoDate } from "@/lib/asset-lifecycle.mjs";
import { photoRequestEvidenceKey } from "@/lib/photo-request-review";
import { normalisePhotoRequirements } from "@/lib/trade-photo-requests";
import {
  BoundedJsonRequestError,
  readBoundedJsonRequest,
} from "@/lib/bounded-json-request";
import {
  captureAssignedCreditexActivityWorkPackSignatures,
  commitAssignedCreditexActivityWorkPack,
  CreditexActivityWorkPackServerError,
  finaliseAssignedCreditexActivityWorkPack,
  listAssignedCreditexActivityWorkPacks,
  loadAssignedCreditexActivityWorkPack,
  prepareAssignedCreditexActivityWorkPackSigning,
  runAssignedCreditexActivityWorkPackCalculator,
  selectAssignedCreditexActivityWorkPackOfficialProducts,
  selectAssignedCreditexActivityWorkPackScenario,
  updateAssignedCreditexActivityWorkPackCustomerContext,
  type CreditexWorkPackArtifactLinkInput,
  type CreditexWorkPackDependencyInput,
  type CreditexWorkPackOfficialProductSelectionInput,
  type CreditexWorkPackReferenceAcknowledgementInput,
  type CreditexWorkPackSectionPatch,
  type CreditexWorkPackSignaturePacketInput,
  type CreditexWorkPackTradeScope,
} from "@/lib/creditex-activity-work-pack-server";
import type {
  CreditexActivityWorkPackCustomerContext,
} from "@/lib/creditex-activity-work-pack";
import {
  reconcileReadyPlannedComplianceWorkPacks,
} from "@/lib/creditex-compliance-server";
import { ensureCreditexWorkPackSchemaGuards } from "@/lib/creditex-work-pack-schema-guards";

export const runtime = "edge";

const CONTRACT_VERSION = MOBILE_CONTRACT_VERSION;
const MAX_ACTIONS = 50;
const MAX_CHANGES = 200;
const MAX_SYNC_JSON_BYTES = 512 * 1024;
const MAX_SYNC_JOBS = 500;
const MAX_SYNC_COMPANION_ROWS = 10_000;
const MAX_ACTIVE_COMPLIANCE_INTENTS_PER_JOB = 12;
const MAX_ACTIVE_COMPLIANCE_CASES_PER_JOB = 12;
const MAX_COMPLIANCE_REQUIREMENTS_PER_CASE = 200;
const TASK_STATUSES = new Set(["pending", "done"]);
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const PHONE_PATTERN = /(?:\+?\d[\s().-]*){8,}/;
const FIELD_IMAGE_CONTENT_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
const FIELD_DOCUMENT_CONTENT_TYPES = [...FIELD_IMAGE_CONTENT_TYPES, "application/pdf"] as const;
const CAMERA_EVIDENCE_TYPES = new Set(["photo", "product", "serial", "decommission", "location"]);
const DOCUMENT_EVIDENCE_TYPES = new Set(["document", "licence", "invoice", "payment"]);
const FIELD_TRANSITIONS = {
  start_travel: { from: "scheduled", to: "en_route", timestamp: "travel_started_at", label: "Start travel" },
  arrive: { from: "en_route", to: "arrived", timestamp: "arrived_at", label: "Arrive" },
  start_work: { from: "arrived", to: "in_progress", timestamp: "work_started_at", label: "Start work" },
  finish: { from: "in_progress", to: "completed", timestamp: "completed_at", label: "Finish" },
} as const;
const WORK_STAGE_TRANSITIONS: Readonly<Record<string, ReadonlySet<string>>> = {
  backlog: new Set(["ready", "scheduled", "blocked"]),
  ready: new Set(["backlog", "scheduled", "blocked"]),
  scheduled: new Set(["ready", "blocked"]),
  in_progress: new Set(["blocked"]),
  blocked: new Set(["ready", "scheduled", "in_progress"]),
  completed: new Set(),
  cancelled: new Set(),
};
const TERMINAL_WORK_STAGES = new Set(["completed", "cancelled"]);
const ACCESSIBLE_JOB_COHORT_SQL = `SELECT cohort.id
  FROM trade_work_orders cohort
  WHERE cohort.firebase_uid = ?
    AND cohort.partner_type = 'installer'
    AND cohort.record_status = 'active'
    AND (? <> 'own' OR cohort.assignee_member_id = ?)
  ORDER BY cohort.scheduled_start = '', cohort.scheduled_start,
    cohort.updated_at DESC
  LIMIT ${MAX_SYNC_JOBS}`;

type OfflineAction = Record<string, unknown>;

async function reconcilePlannedWorkPacksAfterSync(
  access: TeamAccess,
  actions: readonly OfflineAction[],
  results: readonly Record<string, unknown>[],
) {
  const workOrderIds = new Set<string>();
  for (let index = 0; index < actions.length; index += 1) {
    const result = results[index];
    if (result?.status !== "applied" && result?.status !== "duplicate") continue;
    const workOrderId = cleanAdminText(actions[index]?.workOrderId, 180);
    if (workOrderId) workOrderIds.add(workOrderId);
  }
  const pending = await getD1().prepare(`SELECT DISTINCT work_order.id
    FROM trade_work_order_compliance_intents intent
    JOIN trade_work_orders work_order
      ON work_order.id = intent.work_order_id
      AND work_order.firebase_uid = intent.installer_uid
      AND work_order.firebase_uid = ?
      AND work_order.partner_type = 'installer'
      AND work_order.record_status = 'active'
      AND (? <> 'own' OR work_order.assignee_member_id = ?)
    WHERE intent.status = 'planned'
      AND intent.compliance_case_id = ''
    ORDER BY work_order.updated_at, work_order.id
    LIMIT ${MAX_SYNC_JOBS}`)
    .bind(access.ownerUid, access.jobScope, access.memberId)
    .all<{ id: string }>();
  for (const row of pending.results) workOrderIds.add(String(row.id));
  const reconciled = [];
  for (const workOrderId of workOrderIds) {
    try {
      await assignedJob(access, workOrderId);
      const workPacks = await reconcileReadyPlannedComplianceWorkPacks(getD1(), {
        workOrderId,
        installerUid: access.ownerUid,
        // This is the idempotent continuation of the owner-authored guided job
        // transaction. The signed-in member is still independently checked by
        // assignedJob above before it may trigger the repair.
        actorUid: access.ownerUid,
      });
      reconciled.push(Object.freeze({
        workOrderId,
        workPackReady: workPacks.length > 0
          && workPacks.every((item) => item.workPackReady),
        blockers: workPacks.flatMap((item) => item.blockers),
      }));
    } catch {
      reconciled.push(Object.freeze({
        workOrderId,
        workPackReady: false,
        blockers: [Object.freeze({
          code: "work_pack_reconciliation_retry_required",
          message:
            "The governed activity form could not be attached during this sync. A later assigned-job sync will retry safely.",
        })],
      }));
    }
  }
  return Object.freeze(reconciled);
}

const WORK_PACK_ACTIONS = new Set([
  "work_pack_commit",
  "work_pack_prepare_signing",
  "work_pack_capture_signatures",
  "work_pack_update_customer_context",
  "work_pack_select_scenario",
  "work_pack_select_official_products",
  "work_pack_run_calculator",
  "work_pack_finalize",
]);

function workPackTradeScope(access: TeamAccess): CreditexWorkPackTradeScope {
  return {
    ownerUid: access.ownerUid,
    actorUid: access.actorUid,
    actorMemberId: access.memberId,
    scope: access.jobScope,
  };
}

function actionObject(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function workPackSectionPatches(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    const patch = actionObject(item);
    return {
      sectionKey: cleanAdminText(patch.sectionKey, 180),
      ...(cleanAdminText(patch.repeatInstanceKey, 180)
        ? { repeatInstanceKey: cleanAdminText(patch.repeatInstanceKey, 180) }
        : {}),
      ...(patch.remove === true ? { remove: true } : {}),
      answers: actionObject(patch.answers),
    } satisfies CreditexWorkPackSectionPatch;
  });
}

function workPackDependencyResolutions(value: unknown) {
  const supplied = actionObject(value);
  return Object.fromEntries(Object.entries(supplied).map(([dependencyKey, item]) => {
    const dependency = actionObject(item);
    const referenceIds = Array.isArray(dependency.referenceIds)
      ? dependency.referenceIds.map((referenceId) =>
        cleanAdminText(referenceId, 180)
      ).filter(Boolean)
      : [];
    return [cleanAdminText(dependencyKey, 180), {
      referenceIds,
    } satisfies CreditexWorkPackDependencyInput];
  }).filter(([dependencyKey]) => Boolean(dependencyKey)));
}

function workPackOfficialProductSelections(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    const selection = actionObject(item);
    return {
      selectionId: cleanAdminText(selection.selectionId, 700),
      snapshotId: cleanAdminText(selection.snapshotId, 180),
      quantity: Number(selection.quantity),
    } satisfies CreditexWorkPackOfficialProductSelectionInput;
  });
}

function workPackReferenceAcknowledgements(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    const acknowledgement = actionObject(item);
    return {
      sectionKey: cleanAdminText(acknowledgement.sectionKey, 180),
      ...(cleanAdminText(acknowledgement.repeatInstanceKey, 180)
        ? {
            repeatInstanceKey: cleanAdminText(
              acknowledgement.repeatInstanceKey,
              180,
            ),
          }
        : {}),
      promptKey: cleanAdminText(acknowledgement.promptKey, 180),
      sourceArtifactId: cleanAdminText(
        acknowledgement.sourceArtifactId,
        180,
      ),
      acknowledgedAt: cleanAdminText(acknowledgement.acknowledgedAt, 40),
    } satisfies CreditexWorkPackReferenceAcknowledgementInput;
  });
}

function workPackArtifactLinks(value: unknown, deviceId: string) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    const link = actionObject(item);
    return {
      sectionKey: cleanAdminText(link.sectionKey, 180),
      ...(cleanAdminText(link.repeatInstanceKey, 180)
        ? { repeatInstanceKey: cleanAdminText(link.repeatInstanceKey, 180) }
        : {}),
      promptKey: cleanAdminText(link.promptKey, 180),
      clientUploadId: cleanAdminText(link.clientUploadId, 180),
      // Never trust a packet-level device override. The registered request
      // device is the custody boundary for the completed upload.
      deviceId,
    } satisfies CreditexWorkPackArtifactLinkInput;
  });
}

function workPackStringRecord(value: unknown, maximumValues = 500) {
  return Object.freeze(Object.fromEntries(
    Object.entries(actionObject(value)).slice(0, 40).map(([key, item]) => [
      cleanAdminText(key, 120),
      cleanAdminText(item, maximumValues),
    ]).filter(([key]) => Boolean(key)),
  ));
}

function workPackIdentitySource(value: unknown) {
  const source = cleanAdminText(value, 40);
  if (
    source === "customer_context"
    || source === "assigned_worker"
    || source === "authenticated_actor"
    || source === "manual_verified"
  ) return source;
  throw new CreditexActivityWorkPackServerError(
    "WORK_PACK_SIGNER_IDENTITY_INVALID",
    400,
    "The signer identity source is invalid.",
  );
}

function workPackSignerIdentity(value: unknown) {
  const identity = actionObject(value);
  return Object.freeze({
    contract: "creditex-activity-work-pack-signer-identity/v1" as const,
    roleKey: cleanAdminText(identity.roleKey, 180),
    capacity: cleanAdminText(identity.capacity, 180),
    identitySource: workPackIdentitySource(identity.identitySource),
    signerName: cleanAdminText(identity.signerName, 240),
    signerUid: cleanAdminText(identity.signerUid, 240),
    fields: workPackStringRecord(identity.fields),
  }) satisfies CreditexWorkPackSignaturePacketInput["signerIdentity"];
}

function workPackSignatureStrokes(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 100).map((strokeValue) => {
    const stroke = actionObject(strokeValue);
    const points = Array.isArray(stroke.points) ? stroke.points : [];
    return Object.freeze({
      points: Object.freeze(points.slice(0, 10_000).map((pointValue) => {
        const point = actionObject(pointValue);
        return Object.freeze({
          x: Number(point.x),
          y: Number(point.y),
          pressure: point.pressure === null ? null : Number(point.pressure),
          capturedAtOffsetMs: Number(point.capturedAtOffsetMs),
        });
      })),
    });
  });
}

function workPackDeviceContext(value: unknown) {
  const entries: Array<[string, string | number | boolean]> = [];
  for (const [key, item] of Object.entries(actionObject(value)).slice(0, 40)) {
    const fieldKey = cleanAdminText(key, 120);
    if (!fieldKey) continue;
    if (typeof item === "string") {
      entries.push([fieldKey, cleanAdminText(item, 500)]);
    } else if (typeof item === "number" || typeof item === "boolean") {
      entries.push([fieldKey, item]);
    }
  }
  return Object.freeze(Object.fromEntries(entries)) as Readonly<
    Record<string, string | number | boolean>
  >;
}

function workPackSignaturePackets(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 20).map((packetValue) => {
    const packet = actionObject(packetValue);
    const signerIdentity = workPackSignerIdentity(packet.signerIdentity);
    const attestationValue = actionObject(packet.attestation);
    const attestation = Object.freeze({
      contract: "creditex-activity-work-pack-signature-attestation/v1" as const,
      promptKey: cleanAdminText(attestationValue.promptKey, 240),
      signerRoleKey: cleanAdminText(attestationValue.signerRoleKey, 180),
      text: cleanAdminText(attestationValue.text, 20_000),
      version: cleanAdminText(attestationValue.version, 180),
      sourceBindingTargetKey: cleanAdminText(
        attestationValue.sourceBindingTargetKey,
        180,
      ),
      signerIdentity: workPackSignerIdentity(attestationValue.signerIdentity),
      signerIdentitySha256: cleanAdminText(
        attestationValue.signerIdentitySha256,
        80,
      ),
      definitionSha256: cleanAdminText(attestationValue.definitionSha256, 80),
      prefillSha256: cleanAdminText(attestationValue.prefillSha256, 80),
      responseSha256: cleanAdminText(attestationValue.responseSha256, 80),
      declarationsSha256: cleanAdminText(
        attestationValue.declarationsSha256,
        80,
      ),
    });
    const payloadValue = actionObject(packet.signaturePayload);
    const signaturePayload = Object.freeze({
      contract: "creditex-activity-work-pack-signature-payload/v1" as const,
      instanceKey: cleanAdminText(payloadValue.instanceKey, 240),
      caseInstanceId: cleanAdminText(payloadValue.caseInstanceId, 240),
      promptKey: cleanAdminText(payloadValue.promptKey, 240),
      signerRoleKey: cleanAdminText(payloadValue.signerRoleKey, 180),
      signerName: cleanAdminText(payloadValue.signerName, 240),
      signerCapacity: cleanAdminText(payloadValue.signerCapacity, 180),
      signerIdentitySha256: cleanAdminText(payloadValue.signerIdentitySha256, 80),
      attestationSha256: cleanAdminText(payloadValue.attestationSha256, 80),
      definitionSha256: cleanAdminText(payloadValue.definitionSha256, 80),
      prefillSha256: cleanAdminText(payloadValue.prefillSha256, 80),
      responseSha256: cleanAdminText(payloadValue.responseSha256, 80),
      declarationsSha256: cleanAdminText(payloadValue.declarationsSha256, 80),
      strokes: Object.freeze(workPackSignatureStrokes(payloadValue.strokes)),
      signedAt: cleanAdminText(payloadValue.signedAt, 40),
    });
    const deviceValue = actionObject(packet.deviceAttestation);
    const deviceAttestation = Object.freeze({
      contract: "creditex-activity-work-pack-device-attestation/v1" as const,
      deviceId: cleanAdminText(deviceValue.deviceId, 180),
      appId: cleanAdminText(deviceValue.appId, 180),
      appVersion: cleanAdminText(deviceValue.appVersion, 80),
      appBuild: cleanAdminText(deviceValue.appBuild, 80),
      sessionId: cleanAdminText(deviceValue.sessionId, 180),
      capturedByUid: cleanAdminText(deviceValue.capturedByUid, 240),
      signedAt: cleanAdminText(deviceValue.signedAt, 40),
      deviceContext: workPackDeviceContext(deviceValue.deviceContext),
    });
    return Object.freeze({
      sectionKey: cleanAdminText(packet.sectionKey, 180),
      ...(cleanAdminText(packet.repeatInstanceKey, 180)
        ? { repeatInstanceKey: cleanAdminText(packet.repeatInstanceKey, 180) }
        : {}),
      promptKey: cleanAdminText(packet.promptKey, 180),
      clientUploadId: cleanAdminText(packet.clientUploadId, 180),
      signerIdentity,
      signerIdentitySha256: cleanAdminText(packet.signerIdentitySha256, 80),
      signaturePayload,
      signaturePayloadSha256: cleanAdminText(packet.signaturePayloadSha256, 80),
      attestation,
      attestationSha256: cleanAdminText(packet.attestationSha256, 80),
      deviceAttestation,
      deviceAttestationSha256: cleanAdminText(packet.deviceAttestationSha256, 80),
      signatureSha256: cleanAdminText(packet.signatureSha256, 80),
    }) satisfies CreditexWorkPackSignaturePacketInput;
  });
}

function workPackCustomerContextBinding(value: unknown) {
  const binding = actionObject(value);
  return Object.freeze({
    contract: "creditex-activity-work-pack-customer-context/v1" as const,
    editable: binding.editable === true,
    customerId: cleanAdminText(binding.customerId, 180),
    siteId: cleanAdminText(binding.siteId, 180),
    contactId: cleanAdminText(binding.contactId, 180),
    customerRevision: cleanAdminText(binding.customerRevision, 40),
    siteRevision: cleanAdminText(binding.siteRevision, 40),
    contactRevision: cleanAdminText(binding.contactRevision, 40),
    contextSha256: cleanAdminText(binding.contextSha256, 80),
  }) satisfies CreditexActivityWorkPackCustomerContext;
}

function workPackCustomerPatch(value: unknown) {
  const patch = actionObject(value);
  return {
    ...(patch.firstName !== undefined
      ? { firstName: cleanAdminText(patch.firstName, 80) }
      : {}),
    ...(patch.lastName !== undefined
      ? { lastName: cleanAdminText(patch.lastName, 80) }
      : {}),
  };
}

function workPackSitePatch(value: unknown) {
  const patch = actionObject(value);
  return {
    ...(patch.addressLine1 !== undefined
      ? { addressLine1: cleanAdminText(patch.addressLine1, 180) }
      : {}),
    ...(patch.addressLine2 !== undefined
      ? { addressLine2: cleanAdminText(patch.addressLine2, 180) }
      : {}),
    ...(patch.suburb !== undefined
      ? { suburb: cleanAdminText(patch.suburb, 100) }
      : {}),
    ...(patch.state !== undefined
      ? { state: cleanAdminText(patch.state, 3) }
      : {}),
    ...(patch.postcode !== undefined
      ? { postcode: cleanAdminText(patch.postcode, 4) }
      : {}),
  };
}

function workPackContactPatch(value: unknown) {
  const patch = actionObject(value);
  return {
    ...(patch.phone !== undefined
      ? { phone: cleanAdminText(patch.phone, 40) }
      : {}),
    ...(patch.email !== undefined
      ? { email: cleanAdminText(patch.email, 254) }
      : {}),
  };
}

function workPackActionError(clientActionId: string, error: unknown) {
  if (!(error instanceof CreditexActivityWorkPackServerError)) throw error;
  const conflict = error.status === 409 && [
    "WORK_PACK_REVISION_CONFLICT",
    "WORK_PACK_CUSTOMER_CONTEXT_STALE",
  ].includes(error.code);
  return {
    clientActionId,
    status: conflict ? "conflict" : "rejected",
    code: error.code,
    error: error.message,
  };
}

function terminalJobResult(clientActionId: string) {
  return {
    clientActionId,
    status: "rejected",
    code: "JOB_TERMINAL",
    error: "Completed and cancelled jobs are immutable. Create corrective follow-up work instead.",
  };
}

async function workOrderMutationState(
  access: TeamAccess,
  workOrderId: string,
) {
  return getD1().prepare(`SELECT stage, revision
    FROM trade_work_orders
    WHERE id = ? AND firebase_uid = ? AND partner_type = 'installer'
      AND record_status = 'active'`)
    .bind(workOrderId, access.ownerUid)
    .first<Record<string, unknown>>();
}

function syncError(error: unknown) {
  const mobile = mobileErrorResponse(error);
  if (mobile) return adminJson({ ok: false, code: mobile.code, error: mobile.error,
    ...(mobile.minimumVersion ? { minimumVersion: mobile.minimumVersion } : {}) }, mobile.status);
  const code = error instanceof Error ? error.message : "";
  if (code === "SYNC_RESPONSE_CARDINALITY_EXCEEDED") {
    return adminJson({
      ok: false,
      code,
      error: "This account has too much active field data for one safe sync. Complete or archive older work before retrying.",
    }, 409);
  }
  if (code === "AUTH_REQUIRED") return adminJson({ ok: false, error: "Sign in to continue." }, 401);
  if (code === "TEAM_ACCESS_RECORD_REQUIRED") return adminJson({ ok: false, error: "No active installer team access was found." }, 404);
  if (code === "TEAM_ACCESS_REQUIRED") return adminJson({ ok: false, error: "Offline team sync requires team access on the installer account." }, 403);
  if (code === "ACCOUNT_INACTIVE") return adminJson({ ok: false, error: "This installer account is not active." }, 403);
  if (code === "INSTALLER_ONLY") return adminJson({ ok: false, error: "Offline sync is available to installer teams only." }, 403);
  if (code === "FIELD_EVIDENCE_VIEW_REQUIRED") return adminJson({ ok: false, error: "Your team access does not allow offline field records." }, 403);
  if (code === "FIELD_EVIDENCE_MANAGEMENT_REQUIRED") return adminJson({ ok: false, error: "Your team access does not allow offline field changes." }, 403);
  return adminJson({ ok: false, error: "The offline sync request could not be completed." }, 500);
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonical(item)]));
  }
  return value;
}

function base64Url(bytes: Uint8Array) {
  let binary = "";
  bytes.forEach((value) => { binary += String.fromCharCode(value); });
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

async function payloadHash(action: OfflineAction) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(canonical(action))));
  return base64Url(new Uint8Array(digest));
}

function privateDataDetected(value: string) {
  return EMAIL_PATTERN.test(value) || PHONE_PATTERN.test(value);
}

function jsonStringArray(value: unknown) {
  try {
    const parsed = JSON.parse(String(value || "[]"));
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

function hasConfiguredJson(value: unknown) {
  try {
    const parsed = JSON.parse(String(value || "{}"));
    return !parsed
      || typeof parsed !== "object"
      || Array.isArray(parsed)
      || Object.keys(parsed as Record<string, unknown>).length > 0;
  } catch {
    return true;
  }
}

function jsonObject(value: unknown) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  try {
    const parsed = JSON.parse(String(value || "{}"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function evidenceCaptureCompatibility(item: Record<string, unknown>) {
  const evidenceType = String(item.evidence_type || "");
  const allowedContentTypes = jsonStringArray(item.allowed_content_types);
  const requiresConditionEvaluation = hasConfiguredJson(item.condition_snapshot);
  const requiresDynamicFieldSchema = hasConfiguredJson(item.field_schema);
  const requiresSignatureCapture = Number(item.installer_signature_required) === 1
    || Number(item.customer_signature_required) === 1;
  const blockers: string[] = [];
  if (Number(item.original_required) === 1) {
    blockers.push(
      "Trusted original-camera attestation is not supported by this field app version.",
    );
  }
  if (requiresConditionEvaluation) {
    blockers.push("Conditional evidence rules are not supported by this field app version.");
  }
  if (requiresSignatureCapture) {
    blockers.push("Installer or customer signature capture is not supported by this field app version.");
  }
  if (requiresDynamicFieldSchema) {
    blockers.push("Dynamic evidence forms are not supported by this field app version.");
  }

  const allowed = new Set(allowedContentTypes);
  const accepts = (candidates: readonly string[]) =>
    allowed.size === 0 || candidates.some((contentType) => allowed.has(contentType));
  const acceptsCameraOutput = allowed.size === 0 || allowed.has("image/jpeg");
  const captureModes: Array<"camera" | "document"> = [];
  if (!blockers.length && CAMERA_EVIDENCE_TYPES.has(evidenceType)) {
    if (acceptsCameraOutput) captureModes.push("camera");
  } else if (!blockers.length && DOCUMENT_EVIDENCE_TYPES.has(evidenceType)) {
    if (Number(item.gps_required) === 1 || Number(item.metadata_required) === 1) {
      if (acceptsCameraOutput) {
        captureModes.push("camera");
      } else {
        blockers.push(
          "This requirement needs in-app camera evidence, but JPEG camera output is not allowed.",
        );
      }
    } else if (accepts(FIELD_DOCUMENT_CONTENT_TYPES)) {
      captureModes.push("document");
    }
  } else if (!blockers.length) {
    blockers.push(`Evidence type ${evidenceType || "unknown"} is not supported by this field app version.`);
  }
  if (!blockers.length && !captureModes.length) {
    blockers.push("The allowed file types cannot be captured by this field app version.");
  }
  return {
    allowedContentTypes,
    captureModes,
    compatibility: {
      captureSupported: blockers.length === 0 && captureModes.length > 0,
      requiresConditionEvaluation,
      requiresSignatureCapture,
      requiresDynamicFieldSchema,
      blockers,
    },
  };
}

function cursorValue(value: string | null) {
  if (value === null) return null;
  const match = /^v1:(\d+)$/.exec(value);
  if (!match) return Number.NaN;
  const parsed = Number(match[1]);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : Number.NaN;
}

async function accessibleJobs(access: TeamAccess) {
  const db = getD1();
  const [jobRows, taskRows, mediaRows, formRows, intentRows, complianceRows, rentalRows] = await Promise.all([
    db.prepare(`SELECT w.id, w.work_number, w.title, w.service_category, w.site_area, w.stage, w.priority,
        w.scheduled_start, w.scheduled_end, w.assignee_member_id, w.assignee_label, w.source_type,
        w.revision, w.updated_at, d.customer_source, d.description,
        CASE WHEN c.business_name <> '' THEN c.business_name ELSE TRIM(c.first_name || ' ' || c.last_name) END customer_name,
        COALESCE((SELECT cc.phone FROM trade_crm_site_contacts sc JOIN trade_crm_customer_contacts cc
          ON cc.id = sc.customer_contact_id AND cc.firebase_uid = sc.firebase_uid
          WHERE sc.service_site_id = ss.id AND sc.firebase_uid = w.firebase_uid AND sc.record_status = 'active' AND cc.record_status = 'active'
          AND cc.phone <> '' ORDER BY sc.is_primary DESC, sc.created_at LIMIT 1), c.phone, '') customer_phone,
        ss.site_label, ss.address_line_1, ss.address_line_2, ss.suburb, ss.address_state, ss.postcode,
        a.id appointment_id, a.status appointment_status, a.starts_at appointment_starts_at, a.ends_at appointment_ends_at,
        a.travel_started_at, a.arrived_at, a.work_started_at, a.completed_at,
        (SELECT COUNT(*) FROM trade_crm_job_notes n WHERE n.work_order_id = w.id AND n.firebase_uid = w.firebase_uid AND n.note_type = 'issue' AND n.issue_status = 'open') open_issues
      FROM trade_work_orders w
      LEFT JOIN trade_crm_job_details d ON d.work_order_id = w.id AND d.firebase_uid = w.firebase_uid
      LEFT JOIN trade_crm_customers c ON c.id = d.crm_customer_id AND c.firebase_uid = w.firebase_uid
      LEFT JOIN trade_crm_service_sites ss ON ss.id = d.service_site_id AND ss.firebase_uid = w.firebase_uid
      LEFT JOIN trade_crm_appointments a ON a.id = (SELECT fa.id FROM trade_crm_appointments fa WHERE fa.work_order_id = w.id AND fa.firebase_uid = w.firebase_uid
        AND fa.status IN ('scheduled', 'en_route', 'arrived', 'in_progress', 'completed')
        ORDER BY CASE fa.status WHEN 'in_progress' THEN 0 WHEN 'arrived' THEN 1 WHEN 'en_route' THEN 2 WHEN 'scheduled' THEN 3 ELSE 4 END, fa.starts_at DESC LIMIT 1)
      WHERE w.firebase_uid = ? AND w.partner_type = 'installer' AND w.record_status = 'active'
        AND (? <> 'own' OR w.assignee_member_id = ?)
      ORDER BY w.scheduled_start = '', w.scheduled_start, w.updated_at DESC
      LIMIT ?`)
      .bind(
        access.ownerUid,
        access.jobScope,
        access.memberId,
        MAX_SYNC_JOBS,
      ).all<Record<string, unknown>>(),
    db.prepare(`SELECT t.id, t.work_order_id, t.title, t.due_at, t.status, t.completed_at, t.revision, t.updated_at
      FROM trade_work_order_tasks t JOIN trade_work_orders w ON w.id = t.work_order_id
      WHERE t.firebase_uid = ? AND w.firebase_uid = ? AND w.record_status = 'active'
        AND (? <> 'own' OR w.assignee_member_id = ?)
        AND t.work_order_id IN (${ACCESSIBLE_JOB_COHORT_SQL})
      ORDER BY t.status = 'done', t.due_at = '', t.due_at, t.created_at
      LIMIT ?`)
      .bind(
        access.ownerUid,
        access.ownerUid,
        access.jobScope,
        access.memberId,
        access.ownerUid,
        access.jobScope,
        access.memberId,
        MAX_SYNC_COMPANION_ROWS + 1,
      ).all<Record<string, unknown>>(),
    db.prepare(`SELECT m.id, m.work_order_id, m.category, m.file_name, m.content_type, m.size_bytes, m.caption, m.created_at
      FROM trade_crm_job_media m JOIN trade_work_orders w ON w.id = m.work_order_id
      WHERE m.firebase_uid = ? AND w.firebase_uid = ? AND w.record_status = 'active'
        AND (? <> 'own' OR w.assignee_member_id = ?)
        AND m.work_order_id IN (${ACCESSIBLE_JOB_COHORT_SQL})
      ORDER BY m.created_at DESC
      LIMIT ?`)
      .bind(
        access.ownerUid,
        access.ownerUid,
        access.jobScope,
        access.memberId,
        access.ownerUid,
        access.jobScope,
        access.memberId,
        MAX_SYNC_COMPANION_ROWS + 1,
      ).all<Record<string, unknown>>(),
    db.prepare(`SELECT f.id, f.work_order_id, f.template_key, f.template_version, f.template_name, f.jurisdiction,
        f.template_snapshot, f.answers, f.status, f.revision, f.completed_at, f.updated_at
      FROM trade_job_forms f JOIN trade_work_orders w ON w.id = f.work_order_id
      WHERE f.firebase_uid = ? AND w.firebase_uid = ? AND w.record_status = 'active'
        AND (? <> 'own' OR w.assignee_member_id = ?)
        AND f.work_order_id IN (${ACCESSIBLE_JOB_COHORT_SQL})
      ORDER BY f.status = 'complete', f.created_at
      LIMIT ?`)
      .bind(
        access.ownerUid,
        access.ownerUid,
        access.jobScope,
        access.memberId,
        access.ownerUid,
        access.jobScope,
        access.memberId,
        MAX_SYNC_COMPANION_ROWS + 1,
      ).all<Record<string, unknown>>(),
    db.prepare(`SELECT
        intent.id, intent.work_order_id, intent.intent_key,
        intent.program_template_id, intent.activity_template_id,
        intent.program_code, intent.registry_activity_code,
        intent.planned_start, intent.status, intent.intent_snapshot,
        intent.compliance_case_id,
        linked_case.id linked_case_id,
        linked_case.case_number linked_case_number,
        linked_case.status linked_case_status,
        linked_case.evidence_status linked_case_evidence_status
      FROM trade_work_order_compliance_intents intent
      JOIN trade_work_orders work_order
        ON work_order.id = intent.work_order_id
        AND work_order.firebase_uid = intent.installer_uid
      LEFT JOIN compliance_cases linked_case
        ON linked_case.id = intent.compliance_case_id
        AND linked_case.work_order_id = intent.work_order_id
        AND linked_case.compliance_intent_id = intent.id
        AND linked_case.installer_uid = intent.installer_uid
        AND linked_case.organisation_id = intent.compliance_organisation_id
        AND linked_case.status NOT IN ('rejected', 'closed')
      WHERE intent.installer_uid = ?
        AND work_order.record_status = 'active'
        AND (? <> 'own' OR work_order.assignee_member_id = ?)
        AND intent.status IN ('planned', 'case_linked')
        AND intent.work_order_id IN (${ACCESSIBLE_JOB_COHORT_SQL})
      ORDER BY intent.work_order_id, intent.created_at, intent.intent_key
      LIMIT ?`)
      .bind(
        access.ownerUid,
        access.jobScope,
        access.memberId,
        access.ownerUid,
        access.jobScope,
        access.memberId,
        MAX_SYNC_COMPANION_ROWS + 1,
      ).all<Record<string, unknown>>(),
    db.prepare(`SELECT
        c.work_order_id, c.id case_id, c.case_number, c.activity_version_id,
        c.status case_status, c.evidence_status case_evidence_status,
        c.revision case_revision,
        a.activity_key, a.registry_activity_code, a.title activity_title,
        p.id evidence_policy_version_id,
        r.id requirement_id, r.requirement_code, r.title requirement_title,
        r.description requirement_description,
        r.evidence_type, r.capture_timing, r.minimum_count, r.maximum_count,
        r.original_required, r.metadata_required, r.gps_required,
        r.date_stamp_required, r.installer_signature_required,
        r.customer_signature_required, r.allowed_content_types,
        r.condition_snapshot, r.field_schema,
        SUM(CASE WHEN e.status = 'accepted' THEN 1 ELSE 0 END) accepted_count,
        SUM(CASE WHEN e.status IN ('received', 'under_review', 'accepted') THEN 1 ELSE 0 END) submitted_count
      FROM compliance_cases c
      JOIN trade_work_orders w
        ON w.id = c.work_order_id AND w.firebase_uid = c.installer_uid
      JOIN compliance_activity_versions a
        ON a.id = c.activity_version_id
      JOIN compliance_evidence_policy_versions p
        ON p.id = c.evidence_policy_version_id
        AND p.activity_version_id = c.activity_version_id
        AND p.organisation_id = c.organisation_id
      LEFT JOIN compliance_evidence_requirements r
        ON r.policy_version_id = p.id AND r.organisation_id = c.organisation_id
      LEFT JOIN compliance_case_evidence e
        ON e.case_id = c.id AND e.requirement_id = r.id
        AND e.organisation_id = c.organisation_id
      WHERE c.installer_uid = ? AND c.status NOT IN ('rejected', 'closed')
        AND w.record_status = 'active'
        AND (? <> 'own' OR w.assignee_member_id = ?)
        AND c.work_order_id IN (${ACCESSIBLE_JOB_COHORT_SQL})
      GROUP BY
        c.work_order_id, c.id, c.case_number, c.activity_version_id,
        c.status, c.evidence_status, c.revision,
        a.activity_key, a.registry_activity_code, a.title, p.id,
        r.id, r.requirement_code, r.title, r.description,
        r.evidence_type, r.capture_timing,
        r.minimum_count, r.maximum_count, r.original_required,
        r.metadata_required, r.gps_required, r.date_stamp_required,
        r.installer_signature_required, r.customer_signature_required,
        r.allowed_content_types, r.condition_snapshot, r.field_schema
      ORDER BY c.work_order_id, c.updated_at DESC, c.id, r.sort_order,
        r.requirement_code
      LIMIT ?`)
      .bind(
        access.ownerUid,
        access.jobScope,
        access.memberId,
        access.ownerUid,
        access.jobScope,
        access.memberId,
        MAX_SYNC_COMPANION_ROWS + 1,
      ).all<Record<string, unknown>>(),
    db.prepare(`SELECT inspection.id, inspection.work_order_id, inspection.inspection_number,
        inspection.status, inspection.template_key, inspection.template_version,
        inspection.rules_effective_from, inspection.module_selection_snapshot,
        inspection.selected_modules_snapshot,
        inspection.assessor_member_id, inspection.revision, inspection.issued_report_id,
        inspection.issued_at,
        COUNT(module.id) module_count,
        SUM(CASE WHEN module.status = 'complete' THEN 1 ELSE 0 END) complete_module_count,
        (SELECT COUNT(*) FROM trade_rental_inspection_items item
          WHERE item.inspection_id = inspection.id AND item.firebase_uid = inspection.firebase_uid) item_count,
        (SELECT COUNT(*) FROM trade_rental_evidence_links evidence
          WHERE evidence.inspection_id = inspection.id AND evidence.firebase_uid = inspection.firebase_uid
            AND evidence.status = 'active') evidence_count
      FROM trade_rental_inspections inspection
      JOIN trade_work_orders work_order ON work_order.id = inspection.work_order_id
        AND work_order.firebase_uid = inspection.firebase_uid
      LEFT JOIN trade_rental_inspection_modules module ON module.inspection_id = inspection.id
        AND module.firebase_uid = inspection.firebase_uid
      WHERE inspection.firebase_uid = ? AND work_order.record_status = 'active'
        AND (? <> 'own' OR work_order.assignee_member_id = ?)
        AND inspection.work_order_id IN (${ACCESSIBLE_JOB_COHORT_SQL})
      GROUP BY inspection.id, inspection.work_order_id, inspection.inspection_number,
        inspection.status, inspection.template_key, inspection.template_version,
        inspection.rules_effective_from, inspection.module_selection_snapshot,
        inspection.selected_modules_snapshot,
        inspection.assessor_member_id, inspection.revision, inspection.issued_report_id,
        inspection.issued_at
      ORDER BY inspection.updated_at DESC
      LIMIT ?`)
      .bind(
        access.ownerUid,
        access.jobScope,
        access.memberId,
        access.ownerUid,
        access.jobScope,
        access.memberId,
        MAX_SYNC_COMPANION_ROWS + 1,
      ).all<Record<string, unknown>>(),
  ]);
  const companionRowCount = taskRows.results.length
    + mediaRows.results.length
    + formRows.results.length
    + intentRows.results.length
    + complianceRows.results.length
    + rentalRows.results.length;
  const workPacks = await listAssignedCreditexActivityWorkPacks(db, {
    ownerUid: access.ownerUid,
    actorUid: access.actorUid,
    actorMemberId: access.memberId,
    scope: access.jobScope === "own" ? "own" : "team",
    workOrderIds: jobRows.results.map((row) => String(row.id)),
  });
  if (
    taskRows.results.length > MAX_SYNC_COMPANION_ROWS
    || mediaRows.results.length > MAX_SYNC_COMPANION_ROWS
    || formRows.results.length > MAX_SYNC_COMPANION_ROWS
    || intentRows.results.length > MAX_SYNC_COMPANION_ROWS
    || complianceRows.results.length > MAX_SYNC_COMPANION_ROWS
    || rentalRows.results.length > MAX_SYNC_COMPANION_ROWS
    || workPacks.length > MAX_SYNC_COMPANION_ROWS
    || companionRowCount + workPacks.length > MAX_SYNC_COMPANION_ROWS
  ) {
    throw new Error("SYNC_RESPONSE_CARDINALITY_EXCEEDED");
  }
  return new Map(jobRows.results.map((row) => {
    const protectedJob = row.source_type === "opportunity" || row.customer_source === "platform_private";
    const customerContext = !protectedJob
      && (row.customer_source === "trade_owned" || row.customer_source === "public_lead_released");
    const serviceAddress = customerContext ? [row.address_line_1, row.address_line_2, row.suburb, row.address_state, row.postcode]
      .map((part) => String(part || "").trim()).filter(Boolean).join(", ") : "";
    return [String(row.id), {
      id: row.id,
      workNumber: row.work_number,
      title: protectedJob ? `${String(row.service_category || "Service")} job` : row.title,
      serviceCategory: row.service_category,
      siteArea: row.site_area,
      stage: row.stage,
      priority: row.priority,
      scheduledStart: row.scheduled_start,
      scheduledEnd: row.scheduled_end,
      assigneeMemberId: row.assignee_member_id,
      assigneeLabel: row.assignee_label,
      protectedJob,
      customerName: protectedJob ? "Australian Energy Assessments protected customer" : customerContext ? String(row.customer_name || "Customer") : "Internal job",
      customerPhone: customerContext ? String(row.customer_phone || "") : "",
      serviceAddress,
      appointmentId: row.appointment_id || "",
      appointmentStatus: row.appointment_status || "",
      appointmentStartsAt: row.appointment_starts_at || "",
      appointmentEndsAt: row.appointment_ends_at || "",
      travelStartedAt: row.travel_started_at || "",
      arrivedAt: row.arrived_at || "",
      workStartedAt: row.work_started_at || "",
      completedAt: row.completed_at || "",
      description: protectedJob ? "" : row.description || "",
      openIssues: Number(row.open_issues || 0),
      revision: Number(row.revision || 1),
      updatedAt: row.updated_at,
      offlinePolicy: {
        containsPersonalData: Boolean(serviceAddress || (customerContext && row.customer_phone)),
        maxAgeSeconds: serviceAddress || (customerContext && row.customer_phone) ? 86_400 : 604_800,
        purgeWhenUnassigned: true,
      },
      tasks: taskRows.results.filter((task) => task.work_order_id === row.id).map((task) => ({
        id: task.id,
        title: task.title,
        dueAt: task.due_at,
        status: task.status,
        completedAt: task.completed_at,
        revision: Number(task.revision || 1),
        updatedAt: task.updated_at,
      })),
      media: mediaRows.results.filter((media) => media.work_order_id === row.id).map((media) => ({
        id: media.id, category: media.category, fileName: protectedJob ? "Protected field file" : media.file_name,
        contentType: media.content_type, sizeBytes: Number(media.size_bytes),
        caption: protectedJob ? "" : media.caption, createdAt: media.created_at,
      })),
      forms: formRows.results.filter((form) => form.work_order_id === row.id).map((form) => {
        const template = (() => { try { return JSON.parse(String(form.template_snapshot || "{}")); } catch { return { fields: [] }; } })();
        const answers = (() => { try { return JSON.parse(String(form.answers || "{}")); } catch { return {}; } })();
        const completion = tradeFormCompletion(template, answers);
        return { id: form.id, templateKey: form.template_key, templateVersion: Number(form.template_version),
          name: form.template_name, jurisdiction: form.jurisdiction, template, answers, status: form.status,
          revision: Number(form.revision || 1), ready: completion.ready, missing: completion.missing,
          completedAt: form.completed_at, updatedAt: form.updated_at };
      }),
      activityWorkPacks: workPacks.filter(
        (pack) => pack.instance.workOrderId === row.id,
      ),
      complianceIntents: (() => {
        const workOrderIntents = intentRows.results.filter(
          (intent) => intent.work_order_id === row.id,
        );
        if (workOrderIntents.length > MAX_ACTIVE_COMPLIANCE_INTENTS_PER_JOB) {
          throw new Error("SYNC_RESPONSE_CARDINALITY_EXCEEDED");
        }
        return workOrderIntents.map((intent) => {
          const snapshot = jsonObject(intent.intent_snapshot);
          const program = jsonObject(snapshot.program);
          const activity = jsonObject(snapshot.activity);
          const governance = jsonObject(snapshot.governance);
          const requestedCaseId = String(intent.compliance_case_id || "");
          const linkedCaseId = String(intent.linked_case_id || "");
          const linkedCaseReady = Boolean(requestedCaseId)
            && requestedCaseId === linkedCaseId;
          const plannedStart = String(intent.planned_start || "");
          return {
            id: String(intent.id),
            intentKey: String(intent.intent_key || ""),
            programTemplateId: String(intent.program_template_id || ""),
            programCode: String(intent.program_code || ""),
            programName: String(program.name || ""),
            activityTemplateId: String(intent.activity_template_id || ""),
            activityCode: String(
              intent.registry_activity_code
              || activity.activityKey
              || "",
            ),
            activityTitle: String(activity.title || ""),
            plannedStart,
            plannedDate: plannedStart.slice(0, 10),
            status: String(intent.status || "planned"),
            governanceState: String(governance.state || "setup_required"),
            governanceMessage: String(
              governance.message
              || "Creditex must publish and link the exact governed case before regulated field work can be finished.",
            ),
            linkedCaseReady,
            complianceCaseId: linkedCaseReady ? linkedCaseId : "",
            caseNumber: linkedCaseReady
              ? String(intent.linked_case_number || "")
              : "",
            caseStatus: linkedCaseReady
              ? String(intent.linked_case_status || "")
              : "",
            evidenceStatus: linkedCaseReady
              ? String(intent.linked_case_evidence_status || "")
              : "",
          };
        });
      })(),
      ...(() => {
        const rental = rentalRows.results.find((inspection) => inspection.work_order_id === row.id);
        if (!rental) return {};
        const selectedModules = (() => {
          try {
            const parsed = JSON.parse(String(rental.selected_modules_snapshot || rental.module_selection_snapshot || "[]"));
            return Array.isArray(parsed) ? parsed.map(String) : [];
          } catch {
            return [];
          }
        })();
        const terminal = ["issued", "superseded", "withdrawn"].includes(String(rental.status));
        return { rentalInspection: {
          id: String(rental.id),
          inspectionNumber: String(rental.inspection_number),
          status: String(rental.status),
          templateKey: String(rental.template_key),
          templateVersion: Number(rental.template_version || 1),
          rulesEffectiveFrom: String(rental.rules_effective_from),
          selectedModules,
          assessorMemberId: String(rental.assessor_member_id || ""),
          revision: Number(rental.revision || 1),
          issuedReportId: String(rental.issued_report_id || ""),
          issuedAt: String(rental.issued_at || ""),
          progress: {
            completeModules: Number(rental.complete_module_count || 0),
            moduleTotal: Number(rental.module_count || 0),
            savedItems: Number(rental.item_count || 0),
            evidenceFiles: Number(rental.evidence_count || 0),
          },
          permissions: {
            canEdit: access.canManageFieldEvidence && !terminal,
            canIssue: access.canRunReports
              && access.memberId === String(rental.assessor_member_id || "")
              && access.memberId === String(row.assignee_member_id || "")
              && !terminal,
          },
        } };
      })(),
      ...(() => {
        const cases = new Map<string, {
          caseId: unknown;
          caseNumber: unknown;
          activityVersionId: unknown;
          activityCode: unknown;
          activityTitle: unknown;
          evidencePolicyVersionId: unknown;
          status: unknown;
          evidenceStatus: unknown;
          revision: number;
          requirements: Array<Record<string, unknown>>;
        }>();
        for (const item of complianceRows.results) {
          if (item.work_order_id !== row.id) continue;
          const caseId = String(item.case_id || "");
          if (!caseId) continue;
          let complianceCase = cases.get(caseId);
          if (!complianceCase) {
            if (cases.size >= MAX_ACTIVE_COMPLIANCE_CASES_PER_JOB) {
              throw new Error("COMPLIANCE_SYNC_CASE_LIMIT_EXCEEDED");
            }
            complianceCase = {
              caseId: item.case_id,
              caseNumber: item.case_number,
              activityVersionId: item.activity_version_id,
              activityCode: item.registry_activity_code || item.activity_key,
              activityTitle: item.activity_title,
              evidencePolicyVersionId: item.evidence_policy_version_id,
              status: item.case_status,
              evidenceStatus: item.case_evidence_status,
              revision: Number(item.case_revision || 1),
              requirements: [],
            };
            cases.set(caseId, complianceCase);
          }
          if (!item.requirement_id) continue;
          if (complianceCase.requirements.length >= MAX_COMPLIANCE_REQUIREMENTS_PER_CASE) {
            throw new Error("COMPLIANCE_SYNC_REQUIREMENT_LIMIT_EXCEEDED");
          }
          const minimumCount = Number(item.minimum_count || 0);
          const acceptedCount = Number(item.accepted_count || 0);
          const submittedCount = Number(item.submitted_count || 0);
          const captureCompatibility = evidenceCaptureCompatibility(item);
          complianceCase.requirements.push({
            id: item.requirement_id,
            code: item.requirement_code,
            title: item.requirement_title,
            description: item.requirement_description || "",
            evidenceType: item.evidence_type,
            captureTiming: item.capture_timing,
            minimumCount,
            maximumCount: Number(item.maximum_count || 0),
            acceptedCount,
            submittedCount,
            originalRequired: Number(item.original_required) === 1,
            metadataRequired: Number(item.metadata_required) === 1,
            gpsRequired: Number(item.gps_required) === 1,
            dateStampRequired: Number(item.date_stamp_required) === 1,
            installerSignatureRequired: Number(item.installer_signature_required) === 1,
            customerSignatureRequired: Number(item.customer_signature_required) === 1,
            ...captureCompatibility,
            status: acceptedCount >= minimumCount
              ? "complete"
              : submittedCount >= minimumCount
                ? "in_review"
                : "pending",
          });
        }
        const complianceCases = [...cases.values()];
        return {
          complianceCases,
          compliance: complianceCases.length === 1 ? complianceCases[0] : undefined,
        };
      })(),
    }];
  }));
}

async function highWater(access: TeamAccess) {
  const audience = !access.isOwner && access.jobScope === "own" ? access.memberId : "";
  const row = await getD1().prepare(`SELECT COALESCE(MAX(sequence), 0) sequence FROM trade_team_sync_changes
    WHERE owner_uid = ? AND audience_member_id = ?`).bind(access.ownerUid, audience).first<Record<string, unknown>>();
  return Number(row?.sequence || 0);
}

export async function GET(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const access = await requireInstallerTeamAccess(request);
    if (!access.canViewFieldEvidence) throw new Error("FIELD_EVIDENCE_VIEW_REQUIRED");
    const url = new URL(request.url);
    const deviceId = cleanAdminText(url.searchParams.get("deviceId") || request.headers.get("x-aea-device-id"), 120);
    const device = await requireRegisteredMobileDevice(request, access, deviceId,
      cleanAdminText(url.searchParams.get("platform"), 20), cleanAdminText(url.searchParams.get("appVersion"), 40));
    const cursor = cursorValue(url.searchParams.get("cursor"));
    if (Number.isNaN(cursor)) return adminJson({ ok: false, error: "The sync cursor is invalid. Start a fresh sync." }, 400);
    const requestedLimit = Number(url.searchParams.get("limit") || 100);
    const limit = Number.isInteger(requestedLimit) ? Math.max(1, Math.min(MAX_CHANGES, requestedLimit)) : 100;
    const serverTime = new Date().toISOString();

    if (cursor === null) {
      const next = await highWater(access);
      const jobs = await accessibleJobs(access);
      return adminJson({ ok: true, contractVersion: CONTRACT_VERSION, bootstrap: true, serverTime,
        nextCursor: `v1:${next}`, hasMore: false,
        device: { id: device.deviceId, name: device.deviceName, platform: device.platform },
        devicePolicy: mobileAppPolicy(device.platform),
        changes: [...jobs.values()].map((entity) => ({ sequence: next, entityType: "job", entityId: entity.id,
          operation: "upsert", revision: entity.revision, entity })) });
    }

    const audience = !access.isOwner && access.jobScope === "own" ? access.memberId : "";
    const rows = await getD1().prepare(`SELECT sequence, entity_type, entity_id, operation, revision, changed_at
      FROM trade_team_sync_changes WHERE owner_uid = ? AND audience_member_id = ? AND sequence > ?
      ORDER BY sequence LIMIT ?`).bind(access.ownerUid, audience, cursor, limit + 1).all<Record<string, unknown>>();
    const jobs = await accessibleJobs(access);
    const hasMore = rows.results.length > limit;
    const page = rows.results.slice(0, limit);
    const latest = new Map<string, Record<string, unknown>>();
    page.forEach((row) => latest.set(`${row.entity_type}:${row.entity_id}`, row));
    const changes = [...latest.values()].map((row) => {
      const entity = jobs.get(String(row.entity_id));
      if (row.operation === "delete" || !entity) return { sequence: Number(row.sequence), entityType: row.entity_type,
        entityId: row.entity_id, operation: "delete", revision: Number(row.revision), changedAt: row.changed_at };
      return { sequence: Number(row.sequence), entityType: row.entity_type, entityId: row.entity_id,
        operation: "upsert", revision: entity.revision, changedAt: row.changed_at, entity };
    });
    const next = page.length ? Number(page.at(-1)?.sequence || cursor) : cursor;
    return adminJson({ ok: true, contractVersion: CONTRACT_VERSION, bootstrap: false, serverTime,
      nextCursor: `v1:${next}`, hasMore, devicePolicy: mobileAppPolicy(device.platform), changes });
  } catch (error) { return syncError(error); }
}

function actionReceiptStatement(
  db: D1Database,
  access: TeamAccess,
  deviceId: string,
  action: OfflineAction,
  hash: string,
  entityId: string,
  baseRevision: number,
  resultRevision: number,
  now: string,
  successCondition: string,
  successValues: unknown[],
) {
  return db.prepare(`UPDATE trade_offline_actions SET result_revision = ?, status = 'applied', lease_until = '',
    error_code = '', updated_at = ? WHERE owner_uid = ? AND client_action_id = ? AND payload_hash = ?
      AND device_id = ? AND entity_id = ? AND base_revision = ? AND status = 'processing'
      AND (${successCondition})`)
    .bind(resultRevision, now, access.ownerUid, cleanAdminText(action.clientActionId, 120), hash,
      deviceId, entityId, baseRevision, ...successValues);
}

function appliedActionGuardValues(
  access: TeamAccess,
  deviceId: string,
  action: OfflineAction,
  hash: string,
  entityId: string,
  baseRevision: number,
  resultRevision: number,
) {
  return [
    access.ownerUid,
    cleanAdminText(action.clientActionId, 120),
    hash,
    deviceId,
    entityId,
    baseRevision,
    resultRevision,
  ];
}

const APPLIED_ACTION_GUARD = `EXISTS (
  SELECT 1 FROM trade_offline_actions receipt
  WHERE receipt.owner_uid = ? AND receipt.client_action_id = ?
    AND receipt.payload_hash = ? AND receipt.device_id = ?
    AND receipt.entity_id = ? AND receipt.base_revision = ?
    AND receipt.result_revision = ? AND receipt.status = 'applied'
)`;

function guardedJobSyncChangeStatements(
  db: D1Database,
  change: {
    ownerUid: string;
    workOrderId: string;
    revision: number;
    changedAt: string;
    audienceMemberId?: string;
  },
  guardValues: unknown[],
) {
  const statements = [
    db.prepare(`INSERT INTO trade_team_sync_changes
      (owner_uid, audience_member_id, entity_type, entity_id, operation, revision, changed_at)
      SELECT ?, '', 'job', ?, 'upsert', ?, ? WHERE ${APPLIED_ACTION_GUARD}`)
      .bind(
        change.ownerUid,
        change.workOrderId,
        change.revision,
        change.changedAt,
        ...guardValues,
      ),
  ];
  const audienceMemberId = change.audienceMemberId || "";
  if (audienceMemberId) {
    statements.push(
      db.prepare(`INSERT INTO trade_team_sync_changes
        (owner_uid, audience_member_id, entity_type, entity_id, operation, revision, changed_at)
        SELECT ?, ?, 'job', ?, 'upsert', ?, ? WHERE ${APPLIED_ACTION_GUARD}`)
        .bind(
          change.ownerUid,
          audienceMemberId,
          change.workOrderId,
          change.revision,
          change.changedAt,
          ...guardValues,
        ),
      db.prepare(`INSERT OR IGNORE INTO trade_mobile_push_outbox
        (id, owner_uid, audience_member_id, event_key, event_type,
         entity_type, entity_id, payload, status, attempts,
         next_attempt_at, created_at, updated_at)
        SELECT ?, ?, ?, ?, 'job_changed', 'job', ?, ?, 'pending', 0, '', ?, ?
        WHERE ${APPLIED_ACTION_GUARD}`)
        .bind(
          crypto.randomUUID(),
          change.ownerUid,
          audienceMemberId,
          `${change.ownerUid}:${audienceMemberId}:${change.workOrderId}:${change.revision}:upsert`,
          change.workOrderId,
          JSON.stringify({ contractVersion: 2, reason: "sync_required" }),
          change.changedAt,
          change.changedAt,
          ...guardValues,
        ),
    );
  }
  return statements;
}

function failClosedActionGuardStatement(
  db: D1Database,
  access: TeamAccess,
  workOrderId: string,
  guardValues: unknown[],
) {
  return db.prepare(`UPDATE trade_work_orders SET revision = NULL
    WHERE id = ? AND firebase_uid = ?
      AND NOT ${APPLIED_ACTION_GUARD}`)
    .bind(workOrderId, access.ownerUid, ...guardValues);
}

async function atomicActionBatch(
  db: D1Database,
  statements: D1PreparedStatement[],
  finalGuard: D1PreparedStatement,
) {
  try {
    return await db.batch([...statements, finalGuard]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (
      message.includes("NOT NULL")
      && message.includes("trade_work_orders.revision")
    ) {
      return null;
    }
    throw error;
  }
}

async function replayResult(access: TeamAccess, action: OfflineAction, hash: string) {
  const clientActionId = cleanAdminText(action.clientActionId, 120);
  const existing = await getD1().prepare(`SELECT id, payload_hash, action_type, entity_id, base_revision, result_revision,
      status, lease_until, error_code, created_at, updated_at
    FROM trade_offline_actions WHERE owner_uid = ? AND client_action_id = ?`)
    .bind(access.ownerUid, clientActionId).first<Record<string, unknown>>();
  if (!existing) return null;
  if (existing.payload_hash !== hash) return { clientActionId, status: "rejected", code: "IDEMPOTENCY_MISMATCH",
    error: "This action ID was already used for different content." };
  if (existing.status === "processing") {
    const now = new Date().toISOString();
    if (String(existing.lease_until || "") <= now) {
      await getD1().prepare(`DELETE FROM trade_offline_actions WHERE id = ? AND owner_uid = ?
        AND status = 'processing' AND lease_until <= ?`).bind(existing.id, access.ownerUid, now).run();
      return null;
    }
    return { clientActionId, status: "retry", code: "ACTION_IN_PROGRESS",
      retryAfterSeconds: Math.max(1, Math.ceil((Date.parse(String(existing.lease_until)) - Date.now()) / 1000)) };
  }
  if (existing.status === "conflict") {
    const actionType = String(existing.action_type || "");
    const workOrderId = cleanAdminText(action.workOrderId, 180)
      || cleanAdminText(existing.entity_id, 180);
    if (workOrderId) await assignedJob(access, workOrderId);
    const childId = actionType === "set_task_status"
      ? cleanAdminText(action.taskId, 180)
      : actionType === "save_job_form"
        ? cleanAdminText(action.formId, 180)
        : "";
    if (workOrderId && childId) {
      const child = actionType === "set_task_status"
        ? await getD1().prepare(`SELECT task.revision child_revision,
              work_order.revision job_revision
            FROM trade_work_order_tasks task
            JOIN trade_work_orders work_order
              ON work_order.id = task.work_order_id
              AND work_order.firebase_uid = task.firebase_uid
            WHERE task.id = ? AND task.work_order_id = ?
              AND task.firebase_uid = ?`)
          .bind(childId, workOrderId, access.ownerUid)
          .first<Record<string, unknown>>()
        : await getD1().prepare(`SELECT form.revision child_revision,
              work_order.revision job_revision
            FROM trade_job_forms form
            JOIN trade_work_orders work_order
              ON work_order.id = form.work_order_id
              AND work_order.firebase_uid = form.firebase_uid
            WHERE form.id = ? AND form.work_order_id = ?
              AND form.firebase_uid = ?`)
          .bind(childId, workOrderId, access.ownerUid)
          .first<Record<string, unknown>>();
      if (child) {
        return {
          clientActionId,
          status: "conflict",
          code: existing.error_code || "REVISION_CONFLICT",
          entityId: childId,
          baseRevision: Number(existing.base_revision),
          currentRevision: Number(child.child_revision),
          currentJobRevision: Number(child.job_revision),
        };
      }
    }
    return {
      clientActionId,
      status: "conflict",
      code: existing.error_code || "REVISION_CONFLICT",
      entityId: existing.entity_id,
      baseRevision: Number(existing.base_revision),
      currentRevision: Number(existing.result_revision),
    };
  }
  return { clientActionId, status: "duplicate", actionType: existing.action_type, entityId: existing.entity_id,
    resultRevision: Number(existing.result_revision), appliedAt: existing.updated_at || existing.created_at };
}

async function reserveAction(access: TeamAccess, deviceId: string, action: OfflineAction, hash: string,
  entityId: string, baseRevision: number, now: string) {
  const leaseUntil = new Date(Date.now() + 5 * 60 * 1000).toISOString();
  const result = await getD1().prepare(`INSERT OR IGNORE INTO trade_offline_actions
    (id, owner_uid, actor_uid, member_id, device_id, client_action_id, payload_hash, action_type,
     entity_type, entity_id, base_revision, result_revision, status, lease_until, error_code, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'job', ?, ?, 0, 'processing', ?, '', ?, ?)`)
    .bind(crypto.randomUUID(), access.ownerUid, access.actorUid, access.memberId, deviceId,
      cleanAdminText(action.clientActionId, 120), hash, cleanAdminText(action.type, 40), entityId,
      baseRevision, leaseUntil, now, now).run();
  if (result.meta.changes) return null;
  return replayResult(access, action, hash);
}

async function releaseConflict(access: TeamAccess, action: OfflineAction, currentRevision: number, now: string) {
  await getD1().prepare(`UPDATE trade_offline_actions SET status = 'conflict', result_revision = ?, lease_until = '',
    error_code = 'REVISION_CONFLICT', updated_at = ? WHERE owner_uid = ? AND client_action_id = ? AND status = 'processing'`)
    .bind(currentRevision, now, access.ownerUid, cleanAdminText(action.clientActionId, 120)).run();
}

const PHOTO_MEDIA_SNAPSHOT_SQL = `COALESCE((
  SELECT json_group_array(json(photo_media.item))
  FROM (
    SELECT json_object(
      'id', media.id,
      'photoRequirementId', media.photo_requirement_id,
      'createdAt', media.created_at
    ) item
    FROM trade_crm_job_media media
    WHERE media.firebase_uid = finish_request.firebase_uid
      AND media.work_order_id = finish_request.work_order_id
      AND media.photo_request_id = finish_request.id
      AND media.source = 'customer_request'
    ORDER BY media.created_at, media.id
  ) photo_media
), '[]')`;

const PHOTO_REVIEW_SNAPSHOT_SQL = `COALESCE((
  SELECT json_group_array(json(photo_review.item))
  FROM (
    SELECT json_object(
      'id', review.id,
      'photoRequirementId', review.photo_requirement_id,
      'status', review.status,
      'reasonCode', review.reason_code,
      'guidance', review.guidance,
      'reviewRevision', review.review_revision,
      'reviewedUploadCount', review.reviewed_upload_count,
      'createdAt', review.created_at
    ) item
    FROM trade_crm_photo_requirement_reviews review
    WHERE review.firebase_uid = finish_request.firebase_uid
      AND review.work_order_id = finish_request.work_order_id
      AND review.photo_request_id = finish_request.id
      AND review.request_revision = finish_request.revision
    ORDER BY review.review_revision, review.id
  ) photo_review
), '[]')`;

const PHOTO_COMPLETION_SNAPSHOT_SQL = `COALESCE((
  SELECT json_object(
    'id', completion.id,
    'completionRevision', completion.completion_revision,
    'checklistVersion', completion.checklist_version,
    'evidenceKey', completion.evidence_key,
    'requiredCount', completion.required_count,
    'suppliedCount', completion.supplied_count,
    'completedAt', completion.completed_at
  )
  FROM trade_crm_photo_request_completions completion
  WHERE completion.firebase_uid = finish_request.firebase_uid
    AND completion.work_order_id = finish_request.work_order_id
    AND completion.photo_request_id = finish_request.id
    AND completion.request_revision = finish_request.revision
  ORDER BY completion.completion_revision DESC
  LIMIT 1
), '')`;

type PhotoFinishGuard = {
  kind: "none";
} | {
  kind: "active";
  requestId: string;
  revision: number;
  status: string;
  requirements: string;
  mediaSnapshot: string;
  reviewSnapshot: string;
  completionSnapshot: string;
};

async function photoFinishState(
  db: D1Database,
  ownerUid: string,
  workOrderId: string,
) {
  const request = await db.prepare(`SELECT
      finish_request.id,
      finish_request.revision,
      finish_request.requirements,
      finish_request.status,
      ${PHOTO_MEDIA_SNAPSHOT_SQL} media_snapshot,
      ${PHOTO_REVIEW_SNAPSHOT_SQL} review_snapshot,
      ${PHOTO_COMPLETION_SNAPSHOT_SQL} completion_snapshot
    FROM trade_crm_photo_requests finish_request
    WHERE finish_request.work_order_id = ?
      AND finish_request.firebase_uid = ?
    LIMIT 1`)
    .bind(workOrderId, ownerUid)
    .first<Record<string, unknown>>();
  if (!request || String(request.status) === "revoked") {
    return {
      ready: true,
      guard: { kind: "none" } as PhotoFinishGuard,
    };
  }
  const guard: PhotoFinishGuard = {
    kind: "active",
    requestId: String(request.id),
    revision: Number(request.revision),
    status: String(request.status),
    requirements: String(request.requirements || "[]"),
    mediaSnapshot: String(request.media_snapshot || "[]"),
    reviewSnapshot: String(request.review_snapshot || "[]"),
    completionSnapshot: String(request.completion_snapshot || ""),
  };
  try {
    const requirements = normalisePhotoRequirements(
      JSON.parse(guard.requirements),
    );
    const mediaRows = JSON.parse(guard.mediaSnapshot) as Array<
      Record<string, unknown>
    >;
    const reviewRows = JSON.parse(guard.reviewSnapshot) as Array<
      Record<string, unknown>
    >;
    const completion = guard.completionSnapshot
      ? JSON.parse(guard.completionSnapshot) as Record<string, unknown>
      : null;
    if (
      !Array.isArray(mediaRows)
      || !Array.isArray(reviewRows)
      || !completion
    ) {
      return { ready: false, guard };
    }
    const uploadCounts = new Map<string, number>();
    for (const media of mediaRows) {
      const requirementId = String(media.photoRequirementId || "");
      uploadCounts.set(
        requirementId,
        Number(uploadCounts.get(requirementId) || 0) + 1,
      );
    }
    const latestReviews = new Map<string, Record<string, unknown>>();
    for (const review of reviewRows) {
      latestReviews.set(String(review.photoRequirementId || ""), review);
    }
    const unresolvedRetake = [...latestReviews.values()].some((review) => (
      String(review.status) === "retake_requested"
      && Number(uploadCounts.get(String(review.photoRequirementId || "")) || 0)
        <= Number(review.reviewedUploadCount || 0)
    ));
    const requiredReviewed = requirements
      .filter((requirement) => requirement.required)
      .every((requirement) => {
        const status = String(latestReviews.get(requirement.id)?.status || "");
        return status === "accepted" || status === "not_needed";
      });
    const evidenceKey = await photoRequestEvidenceKey({
      requestId: guard.requestId,
      requestRevision: guard.revision,
      checklistVersion: String(completion.checklistVersion || ""),
      mediaIds: mediaRows.map((media) => String(media.id || "")),
    });
    return {
      ready:
        String(completion.evidenceKey || "") === evidenceKey
        && !unresolvedRetake
        && requiredReviewed,
      guard,
    };
  } catch {
    return { ready: false, guard };
  }
}

const UNSATISFIED_GOVERNED_EVIDENCE_SQL = `SELECT 1
  FROM compliance_cases governed_case
  JOIN trade_work_orders governed_work
    ON governed_work.id = governed_case.work_order_id
    AND governed_work.firebase_uid = governed_case.installer_uid
    AND governed_work.partner_type = 'installer'
    AND governed_work.record_status = 'active'
  JOIN compliance_evidence_policy_versions governed_policy
    ON governed_policy.id = governed_case.evidence_policy_version_id
    AND governed_policy.activity_version_id = governed_case.activity_version_id
    AND governed_policy.organisation_id = governed_case.organisation_id
  JOIN compliance_evidence_requirements governed_requirement
    ON governed_requirement.policy_version_id = governed_policy.id
    AND governed_requirement.organisation_id = governed_case.organisation_id
  WHERE governed_case.work_order_id = ?
    AND governed_case.installer_uid = ?
    AND governed_case.status NOT IN ('rejected', 'closed')
    AND (
      SELECT COUNT(DISTINCT governed_evidence.original_sha256)
      FROM compliance_case_evidence governed_evidence
      WHERE governed_evidence.organisation_id = governed_case.organisation_id
        AND governed_evidence.case_id = governed_case.id
        AND governed_evidence.requirement_id = governed_requirement.id
        AND governed_evidence.status IN ('received', 'under_review', 'accepted')
        AND NOT EXISTS (
          SELECT 1
          FROM compliance_case_evidence replacement
          WHERE replacement.organisation_id = governed_evidence.organisation_id
            AND replacement.case_id = governed_evidence.case_id
            AND replacement.supersedes_evidence_id = governed_evidence.id
        )
    ) < governed_requirement.minimum_count`;

const UNLINKED_ACTIVE_COMPLIANCE_INTENT_SQL = `SELECT 1
  FROM trade_work_order_compliance_intents planned_intent
  JOIN trade_work_orders planned_work
    ON planned_work.id = planned_intent.work_order_id
    AND planned_work.firebase_uid = planned_intent.installer_uid
    AND planned_work.partner_type = 'installer'
    AND planned_work.record_status = 'active'
  WHERE planned_intent.work_order_id = ?
    AND planned_intent.installer_uid = ?
    AND planned_intent.status IN ('planned', 'case_linked')
    AND NOT EXISTS (
      SELECT 1
      FROM compliance_cases linked_case
      WHERE linked_case.id = planned_intent.compliance_case_id
        AND linked_case.work_order_id = planned_intent.work_order_id
        AND linked_case.compliance_intent_id = planned_intent.id
        AND linked_case.installer_uid = planned_intent.installer_uid
        AND linked_case.organisation_id = planned_intent.compliance_organisation_id
        AND linked_case.status NOT IN ('rejected', 'closed')
    )`;

const INCOMPLETE_ACTIVE_COMPLIANCE_WORK_PACK_SQL = `SELECT 1
  FROM trade_work_order_compliance_intents active_intent
  JOIN trade_work_orders active_work
    ON active_work.id = active_intent.work_order_id
    AND active_work.firebase_uid = active_intent.installer_uid
    AND active_work.partner_type = 'installer'
    AND active_work.record_status = 'active'
  JOIN compliance_cases linked_case
    ON linked_case.id = active_intent.compliance_case_id
    AND linked_case.work_order_id = active_intent.work_order_id
    AND linked_case.compliance_intent_id = active_intent.id
    AND linked_case.installer_uid = active_intent.installer_uid
    AND linked_case.organisation_id = active_intent.compliance_organisation_id
    AND linked_case.status NOT IN ('rejected', 'closed')
  WHERE active_intent.work_order_id = ?
    AND active_intent.installer_uid = ?
    AND active_intent.status IN ('planned', 'case_linked')
    AND NOT EXISTS (
      SELECT 1
      FROM compliance_activity_work_pack_instances current_pack
      WHERE current_pack.organisation_id = linked_case.organisation_id
        AND current_pack.compliance_case_id = linked_case.id
        AND current_pack.work_order_id = linked_case.work_order_id
        AND current_pack.compliance_intent_id = active_intent.id
        AND current_pack.status = 'completed'
        AND EXISTS (
          SELECT 1
          FROM compliance_activity_work_pack_final_records final_record
          WHERE final_record.organisation_id = current_pack.organisation_id
            AND final_record.instance_key = current_pack.instance_key
            AND final_record.case_instance_id = current_pack.id
            AND final_record.work_pack_version_id = current_pack.work_pack_version_id
        )
        AND NOT EXISTS (
          SELECT 1
          FROM compliance_activity_work_pack_instances newer_pack
          WHERE newer_pack.organisation_id = current_pack.organisation_id
            AND newer_pack.compliance_case_id = current_pack.compliance_case_id
            AND newer_pack.revision > current_pack.revision
        )
    )`;

async function fieldFinishState(ownerUid: string, workOrderId: string) {
  const db = getD1();
  await ensureCreditexWorkPackSchemaGuards(db);
  const [tasks, forms, issues, plan, unlinkedWorkPack, incompleteWorkPack, compliance, rentalReport, photo] = await Promise.all([
    db.prepare("SELECT COUNT(*) count FROM trade_work_order_tasks WHERE work_order_id = ? AND firebase_uid = ? AND status <> 'done'").bind(workOrderId, ownerUid).first<Record<string, unknown>>(),
    db.prepare("SELECT COUNT(*) count FROM trade_job_forms WHERE work_order_id = ? AND firebase_uid = ? AND status <> 'complete'").bind(workOrderId, ownerUid).first<Record<string, unknown>>(),
    db.prepare("SELECT COUNT(*) count FROM trade_crm_job_notes WHERE work_order_id = ? AND firebase_uid = ? AND note_type = 'issue' AND issue_status = 'open'").bind(workOrderId, ownerUid).first<Record<string, unknown>>(),
    db.prepare(`SELECT COUNT(*) count FROM trade_crm_job_plan_requirements r JOIN trade_crm_job_plans p ON p.id = r.job_plan_id AND p.firebase_uid = r.firebase_uid
      WHERE p.work_order_id = ? AND p.firebase_uid = ? AND r.status NOT IN ('installed', 'complete', 'completed', 'done', 'not_required')`).bind(workOrderId, ownerUid).first<Record<string, unknown>>(),
    db.prepare(`SELECT EXISTS (${UNLINKED_ACTIVE_COMPLIANCE_INTENT_SQL}) blocked`)
      .bind(workOrderId, ownerUid)
      .first<Record<string, unknown>>(),
    db.prepare(`SELECT EXISTS (${INCOMPLETE_ACTIVE_COMPLIANCE_WORK_PACK_SQL}) blocked`)
      .bind(workOrderId, ownerUid)
      .first<Record<string, unknown>>(),
    db.prepare(`SELECT EXISTS (${UNSATISFIED_GOVERNED_EVIDENCE_SQL}) blocked`)
      .bind(workOrderId, ownerUid)
      .first<Record<string, unknown>>(),
    db.prepare(`SELECT COUNT(*) count FROM trade_rental_inspections
      WHERE work_order_id = ? AND firebase_uid = ? AND status <> 'issued'`)
      .bind(workOrderId, ownerUid)
      .first<Record<string, unknown>>(),
    photoFinishState(db, ownerUid, workOrderId),
  ]);
  const blockers = [Number(tasks?.count || 0) ? "assigned tasks" : "", Number(forms?.count || 0) ? "required forms" : "", Number(issues?.count || 0) ? "open issues" : "", Number(plan?.count || 0) ? "work-plan items" : ""].filter(Boolean);
  if (Number(unlinkedWorkPack?.blocked || 0) || Number(incompleteWorkPack?.blocked || 0)) {
    blockers.push("Creditex compliance work packs");
  }
  if (Number(compliance?.blocked || 0)) blockers.push("governed evidence");
  if (Number(rentalReport?.count || 0)) blockers.push("the issued rental assessment report");
  if (!photo.ready) blockers.push("required photo proof");
  return { blockers, photoGuard: photo.guard };
}

async function applyAction(access: TeamAccess, deviceId: string, action: OfflineAction) {
  const clientActionId = cleanAdminText(action.clientActionId, 120);
  const actionType = cleanAdminText(action.type, 40);
  if (!MOBILE_CLIENT_ID_PATTERN.test(clientActionId)) return { clientActionId, status: "rejected", code: "INVALID_ACTION_ID",
    error: "Use a stable action ID with at least eight letters or numbers." };
  const hash = await payloadHash(action);
  // Work-pack mutations own their receipt and business change in one D1 batch.
  // Running the legacy replay/reservation path first would split that atomic
  // boundary and could report an action applied without its governed revision.
  if (!WORK_PACK_ACTIONS.has(actionType)) {
    const replay = await replayResult(access, action, hash);
    if (replay) return replay;
  }
  const db = getD1();
  const now = new Date().toISOString();

  if (actionType === "work_pack_commit" || actionType === "work_pack_prepare_signing") {
    const workOrderId = cleanAdminText(action.workOrderId, 180);
    const caseInstanceId = cleanAdminText(action.caseInstanceId, 180);
    const expectedResponseSha256 = cleanAdminText(
      action.expectedResponseSha256,
      180,
    );
    try {
      const scope = workPackTradeScope(access);
      const [, current, jobState] = await Promise.all([
        assignedJob(access, workOrderId),
        loadAssignedCreditexActivityWorkPack(db, {
          ...scope,
          caseInstanceId,
        }),
        workOrderMutationState(access, workOrderId),
      ]);
      if (String(current.instance.workOrderId) !== workOrderId) {
        return {
          clientActionId,
          status: "rejected",
          code: "WORK_PACK_JOB_MISMATCH",
          error: "This work pack does not belong to the selected job.",
        };
      }
      if (!jobState || TERMINAL_WORK_STAGES.has(String(jobState.stage || ""))) {
        return terminalJobResult(clientActionId);
      }
      if (actionType === "work_pack_commit") {
        if (Array.isArray(action.signaturePackets) && action.signaturePackets.length) {
          return {
            clientActionId,
            status: "rejected",
            code: "WORK_PACK_SIGNATURE_PHASE_REQUIRED",
            error: "Save the work pack, prepare signing, then capture signatures against the prepared version.",
          };
        }
        const result = await commitAssignedCreditexActivityWorkPack(db, {
          ...scope,
          caseInstanceId,
          expectedResponseSha256,
          sectionPatches: workPackSectionPatches(action.sectionPatches),
          dependencyResolutions: workPackDependencyResolutions(
            action.dependencyResolutions,
          ),
          referenceAcknowledgements: workPackReferenceAcknowledgements(
            action.referenceAcknowledgements,
          ),
          artifactLinks: workPackArtifactLinks(action.artifactLinks, deviceId),
          idempotency: {
            clientActionId,
            deviceId,
            payloadHash: hash,
          },
          now,
        });
        return {
          clientActionId,
          status: result.status,
          actionType: result.action,
          entityId: workOrderId,
          caseInstanceId: result.projection.instance.id,
          resultRevision: result.projection.instance.revision,
          responseSha256: result.projection.instance.responseSha256,
          appliedAt: now,
        };
      }
      const result = await prepareAssignedCreditexActivityWorkPackSigning(db, {
        ...scope,
        caseInstanceId,
        expectedResponseSha256,
        idempotency: {
          clientActionId,
          deviceId,
          payloadHash: hash,
        },
        now,
      });
      return {
        clientActionId,
        status: result.status,
        actionType: result.action,
        entityId: workOrderId,
        caseInstanceId: result.projection.instance.id,
        resultRevision: result.projection.instance.revision,
        responseSha256: result.projection.instance.responseSha256,
        appliedAt: now,
      };
    } catch (error) {
      return workPackActionError(clientActionId, error);
    }
  }

  if (actionType === "work_pack_capture_signatures") {
    const workOrderId = cleanAdminText(action.workOrderId, 180);
    const caseInstanceId = cleanAdminText(action.caseInstanceId, 180);
    const expectedResponseSha256 = cleanAdminText(
      action.expectedResponseSha256,
      180,
    );
    try {
      const scope = workPackTradeScope(access);
      const [, current, jobState] = await Promise.all([
        assignedJob(access, workOrderId),
        loadAssignedCreditexActivityWorkPack(db, {
          ...scope,
          caseInstanceId,
        }),
        workOrderMutationState(access, workOrderId),
      ]);
      if (String(current.instance.workOrderId) !== workOrderId) {
        return {
          clientActionId,
          status: "rejected",
          code: "WORK_PACK_JOB_MISMATCH",
          error: "This work pack does not belong to the selected job.",
        };
      }
      if (!jobState || TERMINAL_WORK_STAGES.has(String(jobState.stage || ""))) {
        return terminalJobResult(clientActionId);
      }
      const result = await captureAssignedCreditexActivityWorkPackSignatures(
        db,
        {
          ...scope,
          caseInstanceId,
          expectedResponseSha256,
          packets: workPackSignaturePackets(action.signaturePackets),
          idempotency: {
            clientActionId,
            deviceId,
            payloadHash: hash,
          },
          now,
        },
      );
      return {
        clientActionId,
        status: result.status,
        actionType: result.action,
        entityId: workOrderId,
        caseInstanceId: result.projection.instance.id,
        resultRevision: result.projection.instance.revision,
        responseSha256: result.projection.instance.responseSha256,
        appliedAt: now,
      };
    } catch (error) {
      return workPackActionError(clientActionId, error);
    }
  }

  if (
    actionType === "work_pack_select_scenario"
    || actionType === "work_pack_select_official_products"
    || actionType === "work_pack_run_calculator"
  ) {
    const workOrderId = cleanAdminText(action.workOrderId, 180);
    const caseInstanceId = cleanAdminText(action.caseInstanceId, 180);
    const expectedResponseSha256 = cleanAdminText(
      action.expectedResponseSha256,
      180,
    );
    try {
      const scope = workPackTradeScope(access);
      const [, current, jobState] = await Promise.all([
        assignedJob(access, workOrderId),
        loadAssignedCreditexActivityWorkPack(db, {
          ...scope,
          caseInstanceId,
        }),
        workOrderMutationState(access, workOrderId),
      ]);
      if (String(current.instance.workOrderId) !== workOrderId) {
        return {
          clientActionId,
          status: "rejected",
          code: "WORK_PACK_JOB_MISMATCH",
          error: "This work pack does not belong to the selected job.",
        };
      }
      if (!jobState || TERMINAL_WORK_STAGES.has(String(jobState.stage || ""))) {
        return terminalJobResult(clientActionId);
      }
      const common = {
        ...scope,
        caseInstanceId,
        expectedResponseSha256,
        dependencyKey: cleanAdminText(action.dependencyKey, 180),
        idempotency: {
          clientActionId,
          deviceId,
          payloadHash: hash,
        },
        now,
      };
      const result = actionType === "work_pack_select_scenario"
        ? await selectAssignedCreditexActivityWorkPackScenario(db, {
          ...common,
          scenarioCode: cleanAdminText(action.scenarioCode, 180),
        })
        : actionType === "work_pack_select_official_products"
          ? await selectAssignedCreditexActivityWorkPackOfficialProducts(db, {
            ...common,
            selections: workPackOfficialProductSelections(action.selections),
          })
          : await runAssignedCreditexActivityWorkPackCalculator(db, common);
      return {
        clientActionId,
        status: result.status,
        actionType: result.action,
        entityId: workOrderId,
        caseInstanceId: result.projection.instance.id,
        resultRevision: result.projection.instance.revision,
        responseSha256: result.projection.instance.responseSha256,
        appliedAt: now,
      };
    } catch (error) {
      return workPackActionError(clientActionId, error);
    }
  }

  if (actionType === "work_pack_update_customer_context") {
    const workOrderId = cleanAdminText(action.workOrderId, 180);
    const caseInstanceId = cleanAdminText(action.caseInstanceId, 180);
    const expectedResponseSha256 = cleanAdminText(
      action.expectedResponseSha256,
      180,
    );
    try {
      const scope = workPackTradeScope(access);
      const [, current, jobState] = await Promise.all([
        assignedJob(access, workOrderId),
        loadAssignedCreditexActivityWorkPack(db, {
          ...scope,
          caseInstanceId,
        }),
        workOrderMutationState(access, workOrderId),
      ]);
      if (String(current.instance.workOrderId) !== workOrderId) {
        return {
          clientActionId,
          status: "rejected",
          code: "WORK_PACK_JOB_MISMATCH",
          error: "This work pack does not belong to the selected job.",
        };
      }
      if (!jobState || TERMINAL_WORK_STAGES.has(String(jobState.stage || ""))) {
        return terminalJobResult(clientActionId);
      }
      const result = await updateAssignedCreditexActivityWorkPackCustomerContext(
        db,
        {
          ...scope,
          caseInstanceId,
          expectedResponseSha256,
          customerContextBinding: workPackCustomerContextBinding(
            action.customerContextBinding,
          ),
          customerPatch: workPackCustomerPatch(action.customerPatch),
          sitePatch: workPackSitePatch(action.sitePatch),
          contactPatch: workPackContactPatch(action.contactPatch),
          idempotency: {
            clientActionId,
            deviceId,
            payloadHash: hash,
          },
          now,
        },
      );
      return {
        clientActionId,
        status: result.status,
        actionType: result.action,
        entityId: workOrderId,
        caseInstanceId: result.projection.instance.id,
        resultRevision: result.projection.instance.revision,
        responseSha256: result.projection.instance.responseSha256,
        appliedAt: now,
      };
    } catch (error) {
      return workPackActionError(clientActionId, error);
    }
  }

  if (actionType === "work_pack_finalize") {
    const workOrderId = cleanAdminText(action.workOrderId, 180);
    const caseInstanceId = cleanAdminText(action.caseInstanceId, 180);
    const expectedResponseSha256 = cleanAdminText(
      action.expectedResponseSha256,
      180,
    );
    try {
      const scope = workPackTradeScope(access);
      const [, current, jobState] = await Promise.all([
        assignedJob(access, workOrderId),
        loadAssignedCreditexActivityWorkPack(db, {
          ...scope,
          caseInstanceId,
        }),
        workOrderMutationState(access, workOrderId),
      ]);
      if (String(current.instance.workOrderId) !== workOrderId) {
        return {
          clientActionId,
          status: "rejected",
          code: "WORK_PACK_JOB_MISMATCH",
          error: "This work pack does not belong to the selected job.",
        };
      }
      if (!jobState || TERMINAL_WORK_STAGES.has(String(jobState.stage || ""))) {
        return terminalJobResult(clientActionId);
      }
      const result = await finaliseAssignedCreditexActivityWorkPack(db, {
        ...scope,
        caseInstanceId,
        expectedResponseSha256,
        idempotency: {
          clientActionId,
          deviceId,
          payloadHash: hash,
        },
        now,
      });
      return {
        clientActionId,
        status: result.status,
        actionType: result.action,
        entityId: workOrderId,
        caseInstanceId: result.projection.instance.id,
        resultRevision: result.projection.instance.revision,
        responseSha256: result.projection.instance.responseSha256,
        appliedAt: now,
      };
    } catch (error) {
      return workPackActionError(clientActionId, error);
    }
  }

  if (actionType === "advance_field_job") {
    const workOrderId = cleanAdminText(action.workOrderId, 180); const transitionName = cleanAdminText(action.transition, 30);
    const transition = FIELD_TRANSITIONS[transitionName as keyof typeof FIELD_TRANSITIONS];
    const baseRevision = Number(action.baseRevision);
    if (!transition || !Number.isInteger(baseRevision) || baseRevision < 1) return { clientActionId, status: "rejected", code: "INVALID_FIELD_TRANSITION", error: "Use the next available field-job action." };
    const job = await assignedJob(access, workOrderId);
    if (Number(job.revision) !== baseRevision) return { clientActionId, status: "conflict", code: "REVISION_CONFLICT", entityId: workOrderId, baseRevision, currentRevision: Number(job.revision) };
    const jobState = await workOrderMutationState(access, workOrderId);
    if (!jobState || Number(jobState.revision) !== baseRevision) {
      return {
        clientActionId,
        status: "conflict",
        code: "REVISION_CONFLICT",
        entityId: workOrderId,
        baseRevision,
        currentRevision: Number(jobState?.revision || job.revision),
      };
    }
    const capturedJobStage = String(jobState.stage || "");
    if (TERMINAL_WORK_STAGES.has(capturedJobStage)) {
      return terminalJobResult(clientActionId);
    }
    const appointment = await db.prepare(`SELECT * FROM trade_crm_appointments WHERE work_order_id = ? AND firebase_uid = ?
      AND status IN ('scheduled', 'en_route', 'arrived', 'in_progress', 'completed') ORDER BY CASE status WHEN 'in_progress' THEN 0 WHEN 'arrived' THEN 1 WHEN 'en_route' THEN 2 WHEN 'scheduled' THEN 3 ELSE 4 END, starts_at DESC LIMIT 1`)
      .bind(workOrderId, access.ownerUid).first<Record<string, unknown>>();
    if (!appointment) return { clientActionId, status: "rejected", code: "APPOINTMENT_REQUIRED", error: "Schedule this job before starting field work." };
    if (appointment.status !== transition.from) return { clientActionId, status: "rejected", code: "OUT_OF_ORDER", error: `This action is out of order. The appointment is ${String(appointment.status).replaceAll("_", " ")}.` };
    const finishState = transitionName === "finish"
      ? await fieldFinishState(access.ownerUid, workOrderId)
      : {
          blockers: [],
          photoGuard: { kind: "none" } as PhotoFinishGuard,
        };
    if (finishState.blockers.length) {
      return {
        clientActionId,
        status: "rejected",
        code: "FINISH_BLOCKED",
        error: `Complete ${finishState.blockers.join(", ")} before finishing.`,
      };
    }
    const reserved = await reserveAction(access, deviceId, action, hash, workOrderId, baseRevision, now); if (reserved) return reserved;
    const resultRevision = nextJobRevision(job.revision);
    const expectedJobStage = transitionName === "start_work"
      ? "in_progress"
      : transitionName === "finish"
        ? "completed"
        : capturedJobStage;
    const appointmentAppliedGuard = `EXISTS (
      SELECT 1 FROM trade_crm_appointments field_appointment
      WHERE field_appointment.id = ? AND field_appointment.firebase_uid = ?
        AND field_appointment.status = ? AND field_appointment.${transition.timestamp} = ?
        AND field_appointment.last_transition_by_uid = ?
    )`;
    const finishBlockerGuard = `(
      ? <> 'finish'
      OR (
        NOT EXISTS (
          SELECT 1 FROM trade_work_order_tasks blocker
          WHERE blocker.work_order_id = ? AND blocker.firebase_uid = ?
            AND blocker.status <> 'done'
        )
        AND NOT EXISTS (
          SELECT 1 FROM trade_job_forms blocker
          WHERE blocker.work_order_id = ? AND blocker.firebase_uid = ?
            AND blocker.status <> 'complete'
        )
        AND NOT EXISTS (
          SELECT 1 FROM trade_crm_job_notes blocker
          WHERE blocker.work_order_id = ? AND blocker.firebase_uid = ?
            AND blocker.note_type = 'issue' AND blocker.issue_status = 'open'
        )
        AND NOT EXISTS (
          SELECT 1
          FROM trade_crm_job_plan_requirements blocker
          JOIN trade_crm_job_plans blocker_plan
            ON blocker_plan.id = blocker.job_plan_id
            AND blocker_plan.firebase_uid = blocker.firebase_uid
          WHERE blocker_plan.work_order_id = ? AND blocker_plan.firebase_uid = ?
            AND blocker.status NOT IN (
              'installed', 'complete', 'completed', 'done', 'not_required'
            )
        )
        AND NOT EXISTS (${UNLINKED_ACTIVE_COMPLIANCE_INTENT_SQL})
        AND NOT EXISTS (${INCOMPLETE_ACTIVE_COMPLIANCE_WORK_PACK_SQL})
        AND NOT EXISTS (
          SELECT 1 FROM trade_rental_inspections blocker
          WHERE blocker.work_order_id = ? AND blocker.firebase_uid = ?
            AND blocker.status <> 'issued'
        )
        AND NOT EXISTS (${UNSATISFIED_GOVERNED_EVIDENCE_SQL})
        AND (
          (
            ? = 'none'
            AND NOT EXISTS (
              SELECT 1
              FROM trade_crm_photo_requests finish_request
              WHERE finish_request.work_order_id = ?
                AND finish_request.firebase_uid = ?
                AND finish_request.status <> 'revoked'
            )
          )
          OR (
            ? = 'active'
            AND EXISTS (
              SELECT 1
              FROM trade_crm_photo_requests finish_request
              WHERE finish_request.work_order_id = ?
                AND finish_request.firebase_uid = ?
                AND finish_request.id = ?
                AND finish_request.revision = ?
                AND finish_request.status = ?
                AND finish_request.status <> 'revoked'
                AND finish_request.requirements = ?
                AND ${PHOTO_MEDIA_SNAPSHOT_SQL} = ?
                AND ${PHOTO_REVIEW_SNAPSHOT_SQL} = ?
                AND ${PHOTO_COMPLETION_SNAPSHOT_SQL} = ?
            )
          )
        )
      )
    )`;
    const photoGuard = finishState.photoGuard;
    const finishBlockerValues = [
      transitionName,
      workOrderId,
      access.ownerUid,
      workOrderId,
      access.ownerUid,
      workOrderId,
      access.ownerUid,
      workOrderId,
      access.ownerUid,
      workOrderId,
      access.ownerUid,
      workOrderId,
      access.ownerUid,
      workOrderId,
      access.ownerUid,
      workOrderId,
      access.ownerUid,
      photoGuard.kind,
      workOrderId,
      access.ownerUid,
      photoGuard.kind,
      workOrderId,
      access.ownerUid,
      photoGuard.kind === "active" ? photoGuard.requestId : "",
      photoGuard.kind === "active" ? photoGuard.revision : 0,
      photoGuard.kind === "active" ? photoGuard.status : "",
      photoGuard.kind === "active" ? photoGuard.requirements : "",
      photoGuard.kind === "active" ? photoGuard.mediaSnapshot : "",
      photoGuard.kind === "active" ? photoGuard.reviewSnapshot : "",
      photoGuard.kind === "active" ? photoGuard.completionSnapshot : "",
    ];
    const receiptGuardValues = appliedActionGuardValues(
      access,
      deviceId,
      action,
      hash,
      workOrderId,
      baseRevision,
      resultRevision,
    );
    const statements = [
      db.prepare(`UPDATE trade_crm_appointments SET status = ?, ${transition.timestamp} = ?, last_transition_by_uid = ?, revision = revision + 1, updated_at = ?
        WHERE id = ? AND firebase_uid = ? AND status = ?
          AND EXISTS (
            SELECT 1 FROM trade_work_orders work_order
            WHERE work_order.id = ? AND work_order.firebase_uid = ?
              AND work_order.record_status = 'active'
              AND work_order.revision = ?
              AND work_order.stage = ?
              AND work_order.stage NOT IN ('completed', 'cancelled')
          )
          AND ${finishBlockerGuard}`)
        .bind(
          transition.to,
          now,
          access.actorUid,
          now,
          appointment.id,
          access.ownerUid,
          transition.from,
          workOrderId,
          access.ownerUid,
          baseRevision,
          capturedJobStage,
          ...finishBlockerValues,
        ),
      db.prepare(`UPDATE trade_work_orders SET stage = CASE WHEN ? = 'start_work' THEN 'in_progress' WHEN ? = 'finish' THEN 'completed' ELSE stage END,
        revision = ?, updated_at = ? WHERE id = ? AND firebase_uid = ?
          AND revision = ? AND stage = ?
          AND stage NOT IN ('completed', 'cancelled')
          AND ${appointmentAppliedGuard}`)
        .bind(transitionName, transitionName, resultRevision, now, workOrderId, access.ownerUid,
          baseRevision, capturedJobStage, appointment.id, access.ownerUid,
          transition.to, now, access.actorUid),
      actionReceiptStatement(
        db,
        access,
        deviceId,
        action,
        hash,
        workOrderId,
        baseRevision,
        resultRevision,
        now,
        `EXISTS (
          SELECT 1 FROM trade_work_orders work_order
          WHERE work_order.id = ? AND work_order.firebase_uid = ?
            AND work_order.revision = ? AND work_order.updated_at = ?
            AND work_order.stage = ?
        ) AND ${appointmentAppliedGuard}`,
        [
          workOrderId,
          access.ownerUid,
          resultRevision,
          now,
          expectedJobStage,
          appointment.id,
          access.ownerUid,
          transition.to,
          now,
          access.actorUid,
        ],
      ),
      db.prepare(`UPDATE trade_crm_job_details SET pipeline_stage = CASE WHEN ? = 'start_work' THEN 'in_progress' WHEN ? = 'finish' THEN 'complete' ELSE pipeline_stage END,
        updated_at = ? WHERE work_order_id = ? AND firebase_uid = ? AND ${APPLIED_ACTION_GUARD}`)
        .bind(transitionName, transitionName, now, workOrderId, access.ownerUid, ...receiptGuardValues),
      db.prepare(`UPDATE trade_crm_job_plans SET status = 'completed', completed_at = ?, updated_at = ?
        WHERE work_order_id = ? AND firebase_uid = ? AND ? = 'finish'
          AND ${APPLIED_ACTION_GUARD}`)
        .bind(now, now, workOrderId, access.ownerUid, transitionName, ...receiptGuardValues),
      db.prepare(`UPDATE trade_crm_job_plan_phases SET status = 'completed', completed_at = ?, updated_at = ?
        WHERE firebase_uid = ? AND job_plan_id IN (SELECT id FROM trade_crm_job_plans WHERE work_order_id = ? AND firebase_uid = ?)
        AND ? = 'finish' AND ${APPLIED_ACTION_GUARD}`)
        .bind(now, now, access.ownerUid, workOrderId, access.ownerUid, transitionName, ...receiptGuardValues),
      db.prepare(`INSERT INTO trade_work_order_events (id, work_order_id, firebase_uid, event_type, summary, created_at)
        SELECT ?, ?, ?, 'field_state_changed', ?, ? WHERE ${APPLIED_ACTION_GUARD}`)
        .bind(crypto.randomUUID(), workOrderId, access.ownerUid, `${transition.label} recorded in the field app.`, now,
          ...receiptGuardValues),
      db.prepare(`INSERT INTO trade_work_order_events (id, work_order_id, firebase_uid, event_type, summary, created_at)
        SELECT ?, ?, ?, 'job_completed', 'Required work, forms, proof and blockers cleared. Invoice and handover preparation are ready.', ?
        WHERE ? = 'finish' AND ${APPLIED_ACTION_GUARD}`)
        .bind(crypto.randomUUID(), workOrderId, access.ownerUid, now, transitionName,
          ...receiptGuardValues),
      ...guardedJobSyncChangeStatements(
        db,
        {
          ownerUid: access.ownerUid,
          workOrderId,
          revision: resultRevision,
          changedAt: now,
          audienceMemberId: job.assignee_member_id,
        },
        receiptGuardValues,
      ),
    ];
    const results = await atomicActionBatch(
      db,
      statements,
      failClosedActionGuardStatement(db, access, workOrderId, receiptGuardValues),
    );
    if (
      !results
      || !results[0]?.meta.changes
      || !results[1]?.meta.changes
      || !results[2]?.meta.changes
    ) {
      const current = await assignedJob(access, workOrderId);
      await releaseConflict(access, action, Number(current.revision), now);
      return {
        clientActionId,
        status: "conflict",
        code: "REVISION_CONFLICT",
        entityId: workOrderId,
        baseRevision,
        currentRevision: Number(current.revision),
      };
    }
    return { clientActionId, status: "applied", actionType, entityId: workOrderId, resultRevision, appliedAt: now };
  }

  if (actionType === "set_job_stage") {
    const workOrderId = cleanAdminText(action.workOrderId, 180);
    const stage = cleanAdminText(action.stage, 30);
    const baseRevision = Number(action.baseRevision);
    if (!Object.hasOwn(WORK_STAGE_TRANSITIONS, stage)
      || !Number.isInteger(baseRevision)
      || baseRevision < 1) {
      return { clientActionId, status: "rejected", code: "INVALID_JOB_UPDATE", error: "Add a valid job stage and base revision." };
    }
    const job = await assignedJob(access, workOrderId);
    if (Number(job.revision) !== baseRevision) return { clientActionId, status: "conflict", code: "REVISION_CONFLICT",
      entityId: workOrderId, baseRevision, currentRevision: Number(job.revision) };
    const current = await db.prepare(`SELECT stage, revision
      FROM trade_work_orders
      WHERE id = ? AND firebase_uid = ? AND partner_type = 'installer'
        AND record_status = 'active'`)
      .bind(workOrderId, access.ownerUid)
      .first<Record<string, unknown>>();
    if (!current || Number(current.revision) !== baseRevision) {
      const currentRevision = Number(current?.revision || job.revision);
      return {
        clientActionId,
        status: "conflict",
        code: "REVISION_CONFLICT",
        entityId: workOrderId,
        baseRevision,
        currentRevision,
      };
    }
    const currentStage = String(current.stage || "");
    if (TERMINAL_WORK_STAGES.has(currentStage)) {
      return {
        clientActionId,
        status: "rejected",
        code: "JOB_TERMINAL",
        error: "Completed and cancelled jobs are immutable. Create corrective follow-up work instead.",
      };
    }
    if (stage === "completed") {
      const finishState = await fieldFinishState(access.ownerUid, workOrderId);
      if (finishState.blockers.length) {
        return {
          clientActionId,
          status: "rejected",
          code: "FINISH_BLOCKED",
          error: `Complete ${finishState.blockers.join(", ")} before finishing.`,
        };
      }
      return {
        clientActionId,
        status: "rejected",
        code: "CONTROLLED_FIELD_TRANSITION_REQUIRED",
        error: "Finish the active appointment through the next field-job action.",
      };
    }
    if (stage === "cancelled") {
      return {
        clientActionId,
        status: "rejected",
        code: "DISPATCH_CANCELLATION_REQUIRED",
        error: "Job cancellation requires dispatch review and cannot be recorded as an offline stage change.",
      };
    }
    if (!WORK_STAGE_TRANSITIONS[currentStage]?.has(stage)) {
      return {
        clientActionId,
        status: "rejected",
        code: "INVALID_JOB_TRANSITION",
        error: `A job cannot move from ${currentStage.replaceAll("_", " ")} to ${stage.replaceAll("_", " ")}.`,
      };
    }
    const reserved = await reserveAction(access, deviceId, action, hash, workOrderId, baseRevision, now);
    if (reserved) return reserved;
    const resultRevision = nextJobRevision(job.revision);
    const receiptGuardValues = appliedActionGuardValues(
      access,
      deviceId,
      action,
      hash,
      workOrderId,
      baseRevision,
      resultRevision,
    );
    const statements = [
      db.prepare(`UPDATE trade_work_orders SET stage = ?, revision = ?, updated_at = ?
        WHERE id = ? AND firebase_uid = ? AND revision = ? AND stage = ?`)
        .bind(stage, resultRevision, now, workOrderId, access.ownerUid, baseRevision, currentStage),
      actionReceiptStatement(
        db,
        access,
        deviceId,
        action,
        hash,
        workOrderId,
        baseRevision,
        resultRevision,
        now,
        `EXISTS (
          SELECT 1 FROM trade_work_orders work_order
          WHERE work_order.id = ? AND work_order.firebase_uid = ?
            AND work_order.stage = ? AND work_order.revision = ?
            AND work_order.updated_at = ?
        )`,
        [workOrderId, access.ownerUid, stage, resultRevision, now],
      ),
      db.prepare(`INSERT INTO trade_work_order_events (id, work_order_id, firebase_uid, event_type, summary, created_at)
        SELECT ?, ?, ?, 'offline_stage_update', ?, ? WHERE ${APPLIED_ACTION_GUARD}`)
        .bind(crypto.randomUUID(), workOrderId, access.ownerUid,
          `Field app changed the job stage to ${stage.replaceAll("_", " ")}.`, now,
          ...receiptGuardValues),
      ...guardedJobSyncChangeStatements(
        db,
        {
          ownerUid: access.ownerUid,
          workOrderId,
          revision: resultRevision,
          changedAt: now,
          audienceMemberId: job.assignee_member_id,
        },
        receiptGuardValues,
      ),
    ];
    const results = await atomicActionBatch(
      db,
      statements,
      failClosedActionGuardStatement(db, access, workOrderId, receiptGuardValues),
    );
    if (!results || !results[0]?.meta.changes || !results[1]?.meta.changes) {
      const latest = await assignedJob(access, workOrderId);
      await releaseConflict(access, action, Number(latest.revision), now);
      return {
        clientActionId,
        status: "conflict",
        code: "REVISION_CONFLICT",
        entityId: workOrderId,
        baseRevision,
        currentRevision: Number(latest.revision),
      };
    }
    return { clientActionId, status: "applied", actionType, entityId: workOrderId, resultRevision, appliedAt: now };
  }

  if (actionType === "set_task_status") {
    const taskId = cleanAdminText(action.taskId, 180);
    const status = cleanAdminText(action.status, 20);
    const baseRevision = Number(action.baseRevision);
    if (!TASK_STATUSES.has(status) || !Number.isInteger(baseRevision) || baseRevision < 1) {
      return { clientActionId, status: "rejected", code: "INVALID_TASK_UPDATE", error: "Add a valid task status and base revision." };
    }
    const task = await db.prepare(`SELECT t.work_order_id, t.revision
      FROM trade_work_order_tasks t JOIN trade_work_orders w ON w.id = t.work_order_id
      WHERE t.id = ? AND t.firebase_uid = ? AND w.firebase_uid = ? AND w.record_status = 'active'`)
      .bind(taskId, access.ownerUid, access.ownerUid).first<Record<string, unknown>>();
    if (!task) return { clientActionId, status: "rejected", code: "TASK_NOT_FOUND", error: "The checklist item is no longer available." };
    const workOrderId = String(task.work_order_id); const job = await assignedJob(access, workOrderId);
    const jobState = await workOrderMutationState(access, workOrderId);
    if (!jobState || Number(jobState.revision) !== Number(job.revision)) {
      return {
        clientActionId,
        status: "conflict",
        code: "REVISION_CONFLICT",
        entityId: taskId,
        baseRevision,
        currentRevision: Number(task.revision),
        currentJobRevision: Number(jobState?.revision || job.revision),
      };
    }
    const capturedJobStage = String(jobState.stage || "");
    if (TERMINAL_WORK_STAGES.has(capturedJobStage)) {
      return terminalJobResult(clientActionId);
    }
    if (Number(task.revision) !== baseRevision) return { clientActionId, status: "conflict", code: "REVISION_CONFLICT",
      entityId: taskId, baseRevision, currentRevision: Number(task.revision),
      currentJobRevision: Number(job.revision) };
    const reserved = await reserveAction(access, deviceId, action, hash, workOrderId, baseRevision, now);
    if (reserved) return reserved;
    const taskRevision = nextJobRevision(task.revision);
    const jobRevision = nextJobRevision(job.revision);
    const receiptGuardValues = appliedActionGuardValues(
      access,
      deviceId,
      action,
      hash,
      workOrderId,
      baseRevision,
      jobRevision,
    );
    const statements = [
      db.prepare(`UPDATE trade_work_order_tasks SET status = ?, completed_at = ?, revision = ?, updated_at = ?
        WHERE id = ? AND firebase_uid = ? AND revision = ?
          AND EXISTS (
            SELECT 1 FROM trade_work_orders work_order
            WHERE work_order.id = trade_work_order_tasks.work_order_id
              AND work_order.firebase_uid = trade_work_order_tasks.firebase_uid
              AND work_order.record_status = 'active'
              AND work_order.revision = ?
              AND work_order.stage = ?
              AND work_order.stage NOT IN ('completed', 'cancelled')
          )`)
        .bind(status, status === "done" ? now : "", taskRevision, now, taskId,
          access.ownerUid, baseRevision, Number(job.revision), capturedJobStage),
      db.prepare(`UPDATE trade_work_orders SET revision = ?, updated_at = ?
        WHERE id = ? AND firebase_uid = ? AND revision = ?
          AND stage = ? AND stage NOT IN ('completed', 'cancelled')
          AND EXISTS (
            SELECT 1 FROM trade_work_order_tasks task
            WHERE task.id = ? AND task.work_order_id = trade_work_orders.id
              AND task.firebase_uid = trade_work_orders.firebase_uid
              AND task.revision = ? AND task.updated_at = ?
          )`)
        .bind(jobRevision, now, workOrderId, access.ownerUid, Number(job.revision),
          capturedJobStage, taskId, taskRevision, now),
      actionReceiptStatement(
        db,
        access,
        deviceId,
        action,
        hash,
        workOrderId,
        baseRevision,
        jobRevision,
        now,
        `EXISTS (
          SELECT 1 FROM trade_work_orders work_order
          JOIN trade_work_order_tasks task
            ON task.work_order_id = work_order.id
            AND task.firebase_uid = work_order.firebase_uid
          WHERE work_order.id = ? AND work_order.firebase_uid = ?
            AND work_order.revision = ? AND work_order.updated_at = ?
            AND work_order.stage = ?
            AND task.id = ? AND task.revision = ? AND task.updated_at = ?
        )`,
        [
          workOrderId,
          access.ownerUid,
          jobRevision,
          now,
          capturedJobStage,
          taskId,
          taskRevision,
          now,
        ],
      ),
      db.prepare(`INSERT INTO trade_work_order_events (id, work_order_id, firebase_uid, event_type, summary, created_at)
        SELECT ?, ?, ?, 'offline_task_update', 'Field app updated a checklist item.', ?
        WHERE ${APPLIED_ACTION_GUARD}`)
        .bind(crypto.randomUUID(), workOrderId, access.ownerUid, now, ...receiptGuardValues),
      ...guardedJobSyncChangeStatements(
        db,
        {
          ownerUid: access.ownerUid,
          workOrderId,
          revision: jobRevision,
          changedAt: now,
          audienceMemberId: job.assignee_member_id,
        },
        receiptGuardValues,
      ),
    ];
    const results = await atomicActionBatch(
      db,
      statements,
      failClosedActionGuardStatement(db, access, workOrderId, receiptGuardValues),
    );
    if (
      !results
      || !results[0]?.meta.changes
      || !results[1]?.meta.changes
      || !results[2]?.meta.changes
    ) {
      const latestTask = await db.prepare(`SELECT revision FROM trade_work_order_tasks
        WHERE id = ? AND work_order_id = ? AND firebase_uid = ?`)
        .bind(taskId, workOrderId, access.ownerUid)
        .first<Record<string, unknown>>();
      const latestJob = await assignedJob(access, workOrderId);
      await releaseConflict(access, action, Number(latestJob.revision), now);
      return {
        clientActionId,
        status: "conflict",
        code: "REVISION_CONFLICT",
        entityId: taskId,
        baseRevision,
        currentRevision: Number(latestTask?.revision || task.revision),
        currentJobRevision: Number(latestJob.revision),
      };
    }
    return { clientActionId, status: "applied", actionType, entityId: workOrderId, taskId, resultRevision: jobRevision,
      taskRevision, appliedAt: now };
  }

  if (actionType === "save_job_form") {
    const workOrderId = cleanAdminText(action.workOrderId, 180);
    const formId = cleanAdminText(action.formId, 180);
    const baseRevision = Number(action.baseRevision);
    const complete = action.complete === true;
    if (!workOrderId || !formId || !Number.isInteger(baseRevision) || baseRevision < 1) {
      return { clientActionId, status: "rejected", code: "INVALID_FORM_UPDATE", error: "Add a valid form and base revision." };
    }
    const job = await assignedJob(access, workOrderId);
    const form = await db.prepare(`SELECT id, template_key, template_snapshot, status, revision FROM trade_job_forms
      WHERE id = ? AND work_order_id = ? AND firebase_uid = ?`).bind(formId, workOrderId, access.ownerUid).first<Record<string, unknown>>();
    if (!form) return { clientActionId, status: "rejected", code: "FORM_NOT_FOUND", error: "The field form is no longer available." };
    const jobState = await workOrderMutationState(access, workOrderId);
    if (!jobState || Number(jobState.revision) !== Number(job.revision)) {
      return {
        clientActionId,
        status: "conflict",
        code: "REVISION_CONFLICT",
        entityId: formId,
        baseRevision,
        currentRevision: Number(form.revision),
        currentJobRevision: Number(jobState?.revision || job.revision),
      };
    }
    const capturedJobStage = String(jobState.stage || "");
    if (TERMINAL_WORK_STAGES.has(capturedJobStage)) {
      return terminalJobResult(clientActionId);
    }
    if (form.status === "complete") return { clientActionId, status: "rejected", code: "FORM_LOCKED", error: "This completed form is locked." };
    if (Number(form.revision) !== baseRevision) return { clientActionId, status: "conflict", code: "REVISION_CONFLICT",
      entityId: formId, baseRevision, currentRevision: Number(form.revision),
      currentJobRevision: Number(job.revision) };
    let template: Record<string, unknown>;
    try { template = JSON.parse(String(form.template_snapshot || "{}")) as Record<string, unknown>; }
    catch { return { clientActionId, status: "rejected", code: "INVALID_FORM", error: "The saved form template is invalid." }; }
    const answers = normalizeTradeFormAnswers(template, action.answers);
    if (privateDataDetected(JSON.stringify(answers))) return { clientActionId, status: "rejected", code: "PROTECTED_CUSTOMER_DATA",
      error: "Remove customer email or phone details from the technical form." };
    const completion = tradeFormCompletion(template, answers);
    if (complete && !completion.ready) return { clientActionId, status: "rejected", code: "FORM_INCOMPLETE",
      error: `Complete the required fields: ${completion.missing.join(", ")}.` };
    const reserved = await reserveAction(access, deviceId, action, hash, workOrderId, baseRevision, now);
    if (reserved) return reserved;
    const formRevision = nextJobRevision(form.revision);
    const jobRevision = nextJobRevision(job.revision);
    const answerJson = JSON.stringify(answers);
    const formStatus = complete ? "complete" : "draft";
    const receiptGuardValues = appliedActionGuardValues(
      access,
      deviceId,
      action,
      hash,
      workOrderId,
      baseRevision,
      jobRevision,
    );
    const lifecycle: D1PreparedStatement[] = [];
    if (complete && form.template_key === "service-visit-support" && job.source_type === "recurring_service" && job.source_reference) {
      const plan = await db.prepare(`SELECT id, asset_id, handover_pack_id, work_order_id, cadence_months
        FROM trade_asset_service_plans WHERE id = ? AND firebase_uid = ?`).bind(job.source_reference, access.ownerUid).first<Record<string, unknown>>();
      if (plan) {
        const servicedAt = String(answers.work_date || now.slice(0, 10)); const nextDueAt = addMonthsToIsoDate(servicedAt, Number(plan.cadence_months));
        lifecycle.push(
          db.prepare(`INSERT INTO trade_asset_service_events
            (id, service_plan_id, asset_id, handover_pack_id, work_order_id, firebase_uid, event_type,
             serviced_at, summary, provider_reference, next_due_at, created_at, updated_at)
            SELECT ?, ?, ?, ?, ?, ?, 'service_completed', ?, 'Scheduled service form completed.', ?, ?, ?, ?
            WHERE ${APPLIED_ACTION_GUARD}
              AND NOT EXISTS (SELECT 1 FROM trade_asset_service_events WHERE service_plan_id = ? AND event_type = 'service_completed' AND provider_reference = ?)`)
            .bind(crypto.randomUUID(), plan.id, plan.asset_id, plan.handover_pack_id, plan.work_order_id, access.ownerUid,
              servicedAt, workOrderId, nextDueAt, now, now, ...receiptGuardValues, plan.id, workOrderId),
          db.prepare(`UPDATE trade_asset_service_plans
            SET next_due_at = ?, status = 'active', updated_at = ?
            WHERE id = ? AND firebase_uid = ? AND ${APPLIED_ACTION_GUARD}`)
            .bind(nextDueAt, now, plan.id, access.ownerUid, ...receiptGuardValues),
        );
      }
    }
    const statements = [
      db.prepare(`UPDATE trade_job_forms SET answers = ?, status = ?, revision = ?, completed_by_uid = ?,
        completed_at = ?, updated_at = ?
        WHERE id = ? AND work_order_id = ? AND firebase_uid = ? AND revision = ?
          AND status <> 'complete'
          AND EXISTS (
            SELECT 1 FROM trade_work_orders work_order
            WHERE work_order.id = trade_job_forms.work_order_id
              AND work_order.firebase_uid = trade_job_forms.firebase_uid
              AND work_order.record_status = 'active'
              AND work_order.revision = ?
              AND work_order.stage = ?
              AND work_order.stage NOT IN ('completed', 'cancelled')
          )`)
        .bind(answerJson, formStatus, formRevision, complete ? access.actorUid : "",
          complete ? now : "", now, formId, workOrderId, access.ownerUid, baseRevision,
          Number(job.revision), capturedJobStage),
      db.prepare(`UPDATE trade_work_orders SET revision = ?, updated_at = ?
        WHERE id = ? AND firebase_uid = ? AND revision = ?
          AND stage = ? AND stage NOT IN ('completed', 'cancelled')
          AND EXISTS (
            SELECT 1 FROM trade_job_forms form
            WHERE form.id = ? AND form.work_order_id = trade_work_orders.id
              AND form.firebase_uid = trade_work_orders.firebase_uid
              AND form.answers = ? AND form.status = ?
              AND form.revision = ? AND form.updated_at = ?
          )`)
        .bind(jobRevision, now, workOrderId, access.ownerUid, Number(job.revision),
          capturedJobStage, formId, answerJson, formStatus, formRevision, now),
      actionReceiptStatement(
        db,
        access,
        deviceId,
        action,
        hash,
        workOrderId,
        baseRevision,
        jobRevision,
        now,
        `EXISTS (
          SELECT 1 FROM trade_work_orders work_order
          JOIN trade_job_forms form
            ON form.work_order_id = work_order.id
            AND form.firebase_uid = work_order.firebase_uid
          WHERE work_order.id = ? AND work_order.firebase_uid = ?
            AND work_order.revision = ? AND work_order.updated_at = ?
            AND work_order.stage = ?
            AND form.id = ? AND form.answers = ? AND form.status = ?
            AND form.revision = ? AND form.updated_at = ?
        )`,
        [
          workOrderId,
          access.ownerUid,
          jobRevision,
          now,
          capturedJobStage,
          formId,
          answerJson,
          formStatus,
          formRevision,
          now,
        ],
      ),
      db.prepare(`INSERT INTO trade_work_order_events (id, work_order_id, firebase_uid, event_type, summary, created_at)
        SELECT ?, ?, ?, ?, ?, ? WHERE ${APPLIED_ACTION_GUARD}`).bind(crypto.randomUUID(), workOrderId, access.ownerUid,
          complete ? "offline_field_form_completed" : "offline_field_form_saved",
          complete ? `${String(template.name || "Field form")} completed in the field app.` : `${String(template.name || "Field form")} saved in the field app.`,
          now,
          ...receiptGuardValues),
      ...guardedJobSyncChangeStatements(
        db,
        {
          ownerUid: access.ownerUid,
          workOrderId,
          revision: jobRevision,
          changedAt: now,
          audienceMemberId: job.assignee_member_id,
        },
        receiptGuardValues,
      ),
      ...lifecycle,
    ];
    const results = await atomicActionBatch(
      db,
      statements,
      failClosedActionGuardStatement(db, access, workOrderId, receiptGuardValues),
    );
    if (
      !results
      || !results[0]?.meta.changes
      || !results[1]?.meta.changes
      || !results[2]?.meta.changes
    ) {
      const latestForm = await db.prepare(`SELECT revision FROM trade_job_forms
        WHERE id = ? AND work_order_id = ? AND firebase_uid = ?`)
        .bind(formId, workOrderId, access.ownerUid)
        .first<Record<string, unknown>>();
      const latestJob = await assignedJob(access, workOrderId);
      await releaseConflict(access, action, Number(latestJob.revision), now);
      return {
        clientActionId,
        status: "conflict",
        code: "REVISION_CONFLICT",
        entityId: formId,
        baseRevision,
        currentRevision: Number(latestForm?.revision || form.revision),
        currentJobRevision: Number(latestJob.revision),
      };
    }
    return { clientActionId, status: "applied", actionType, entityId: workOrderId, formId,
      resultRevision: jobRevision, formRevision, appliedAt: now };
  }

  if (actionType === "add_time_entry") {
    const workOrderId = cleanAdminText(action.workOrderId, 180);
    const baseRevision = Number(action.baseRevision);
    const workDate = cleanAdminText(action.workDate, 10);
    const durationMinutes = Number(action.durationMinutes);
    const notes = cleanAdminText(action.notes, 500);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(workDate) || Number.isNaN(Date.parse(`${workDate}T00:00:00Z`)) ||
      !Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 1440
      || !Number.isInteger(baseRevision) || baseRevision < 1) {
      return { clientActionId, status: "rejected", code: "INVALID_TIME_ENTRY", error: "Add a valid work date and duration." };
    }
    const job = await assignedJob(access, workOrderId);
    const jobState = await workOrderMutationState(access, workOrderId);
    if (!jobState || Number(jobState.revision) !== Number(job.revision)) {
      return {
        clientActionId,
        status: "conflict",
        code: "REVISION_CONFLICT",
        entityId: workOrderId,
        baseRevision,
        currentRevision: Number(jobState?.revision || job.revision),
      };
    }
    const capturedJobStage = String(jobState.stage || "");
    if (TERMINAL_WORK_STAGES.has(capturedJobStage)) {
      return terminalJobResult(clientActionId);
    }
    if (Number(job.revision) !== baseRevision) {
      return {
        clientActionId,
        status: "conflict",
        code: "REVISION_CONFLICT",
        entityId: workOrderId,
        baseRevision,
        currentRevision: Number(job.revision),
      };
    }
    if (job.source_type === "opportunity" && privateDataDetected(notes)) {
      return { clientActionId, status: "rejected", code: "PROTECTED_CUSTOMER_DATA", error: "Remove contact details from protected job notes." };
    }
    const reserved = await reserveAction(access, deviceId, action, hash, workOrderId, baseRevision, now);
    if (reserved) return reserved;
    const resultRevision = nextJobRevision(job.revision);
    const timeEntryId = crypto.randomUUID();
    const receiptGuardValues = appliedActionGuardValues(
      access,
      deviceId,
      action,
      hash,
      workOrderId,
      baseRevision,
      resultRevision,
    );
    const statements = [
      db.prepare(`INSERT INTO trade_crm_time_entries
        (id, work_order_id, firebase_uid, staff_label, work_date, duration_minutes, notes, created_at, updated_at)
        SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?
        WHERE EXISTS (
          SELECT 1 FROM trade_work_orders work_order
          WHERE work_order.id = ? AND work_order.firebase_uid = ?
            AND work_order.record_status = 'active'
            AND work_order.revision = ?
            AND work_order.stage = ?
            AND work_order.stage NOT IN ('completed', 'cancelled')
        )`)
        .bind(timeEntryId, workOrderId, access.ownerUid, access.displayName, workDate,
          durationMinutes, notes, now, now, workOrderId, access.ownerUid,
          baseRevision, capturedJobStage),
      db.prepare(`UPDATE trade_work_orders SET revision = ?, updated_at = ?
        WHERE id = ? AND firebase_uid = ? AND revision = ?
          AND stage = ? AND stage NOT IN ('completed', 'cancelled')
          AND EXISTS (
            SELECT 1 FROM trade_crm_time_entries entry
            WHERE entry.id = ? AND entry.work_order_id = trade_work_orders.id
              AND entry.firebase_uid = trade_work_orders.firebase_uid
              AND entry.created_at = ? AND entry.updated_at = ?
          )`)
        .bind(resultRevision, now, workOrderId, access.ownerUid, baseRevision,
          capturedJobStage, timeEntryId, now, now),
      actionReceiptStatement(
        db,
        access,
        deviceId,
        action,
        hash,
        workOrderId,
        baseRevision,
        resultRevision,
        now,
        `EXISTS (
          SELECT 1 FROM trade_work_orders work_order
          JOIN trade_crm_time_entries entry
            ON entry.work_order_id = work_order.id
            AND entry.firebase_uid = work_order.firebase_uid
          WHERE work_order.id = ? AND work_order.firebase_uid = ?
            AND work_order.revision = ? AND work_order.updated_at = ?
            AND work_order.stage = ?
            AND entry.id = ? AND entry.created_at = ? AND entry.updated_at = ?
        )`,
        [
          workOrderId,
          access.ownerUid,
          resultRevision,
          now,
          capturedJobStage,
          timeEntryId,
          now,
          now,
        ],
      ),
      db.prepare(`INSERT INTO trade_work_order_events (id, work_order_id, firebase_uid, event_type, summary, created_at)
        SELECT ?, ?, ?, 'offline_time_added', 'Field app added a technician time entry.', ?
        WHERE ${APPLIED_ACTION_GUARD}`)
        .bind(crypto.randomUUID(), workOrderId, access.ownerUid, now, ...receiptGuardValues),
      ...guardedJobSyncChangeStatements(
        db,
        {
          ownerUid: access.ownerUid,
          workOrderId,
          revision: resultRevision,
          changedAt: now,
          audienceMemberId: job.assignee_member_id,
        },
        receiptGuardValues,
      ),
    ];
    const results = await atomicActionBatch(
      db,
      statements,
      failClosedActionGuardStatement(db, access, workOrderId, receiptGuardValues),
    );
    if (
      !results
      || !results[0]?.meta.changes
      || !results[1]?.meta.changes
      || !results[2]?.meta.changes
    ) {
      const latest = await assignedJob(access, workOrderId);
      await releaseConflict(access, action, Number(latest.revision), now);
      return {
        clientActionId,
        status: "conflict",
        code: "REVISION_CONFLICT",
        entityId: workOrderId,
        baseRevision,
        currentRevision: Number(latest.revision),
      };
    }
    return { clientActionId, status: "applied", actionType, entityId: workOrderId, resultRevision, appliedAt: now };
  }

  return { clientActionId, status: "rejected", code: "UNSUPPORTED_ACTION", error: "This offline action is not supported." };
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const access = await requireInstallerTeamAccess(request);
    let parsedBody: unknown;
    try {
      parsedBody = await readBoundedJsonRequest(request, MAX_SYNC_JSON_BYTES);
    } catch (error) {
      return adminJson({
        ok: false,
        error: error instanceof BoundedJsonRequestError
          && error.code === "REQUEST_TOO_LARGE"
          ? "The offline action batch is too large."
          : "The offline action batch is invalid.",
      }, error instanceof BoundedJsonRequestError ? error.status : 400);
    }
    if (
      !parsedBody
      || typeof parsedBody !== "object"
      || Array.isArray(parsedBody)
    ) {
      return adminJson({
        ok: false,
        error: "The offline action batch is invalid.",
      }, 400);
    }
    const body = parsedBody as Record<string, unknown>;
    const deviceId = cleanAdminText(body.deviceId, 100);
    const actions = Array.isArray(body.actions) ? body.actions.filter((item): item is OfflineAction => Boolean(item && typeof item === "object")) : [];
    if (!MOBILE_CLIENT_ID_PATTERN.test(deviceId)) return adminJson({ ok: false, error: "Register a stable device ID before syncing field actions." }, 400);
    const device = await requireRegisteredMobileDevice(request, access, deviceId,
      cleanAdminText(body.platform, 20), cleanAdminText(body.appVersion, 40));
    if (actions.length > MAX_ACTIONS) return adminJson({ ok: false, error: `Send at most ${MAX_ACTIONS} offline actions at a time.` }, 400);
    const results = [];
    for (const action of actions) {
      try {
        const actionType = cleanAdminText(action.type, 80);
        if (["advance_field_job", "set_job_stage", "set_task_status"].includes(actionType)
          && !access.canManageJobs) throw new Error("JOB_MANAGEMENT_REQUIRED");
        if (["save_job_form", "add_time_entry", ...WORK_PACK_ACTIONS].includes(actionType)
          && !access.canManageFieldEvidence) throw new Error("FIELD_EVIDENCE_MANAGEMENT_REQUIRED");
        results.push(await applyAction(access, deviceId, action));
      }
      catch (error) {
        const code = error instanceof Error ? error.message : "ACTION_FAILED";
        results.push({ clientActionId: cleanAdminText(action.clientActionId, 120), status: "rejected", code,
          error: code === "JOB_NOT_ASSIGNED" ? "This job is no longer assigned to this team account." : "The action could not be applied." });
      }
    }
    const workPackReconciliation = await reconcilePlannedWorkPacksAfterSync(
      access,
      actions,
      results,
    );
    return adminJson({ ok: true, contractVersion: CONTRACT_VERSION, serverTime: new Date().toISOString(),
      accepted: results.filter((item) => item.status === "applied" || item.status === "duplicate").length,
      conflicts: results.filter((item) => item.status === "conflict").length,
      retrying: results.filter((item) => item.status === "retry").length,
      devicePolicy: mobileAppPolicy(device.platform), results,
      workPackReconciliation });
  } catch (error) { return syncError(error); }
}
