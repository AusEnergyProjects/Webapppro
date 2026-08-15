import { env } from "cloudflare:workers";
import { getD1 } from "../../../../../../db";
import {
  ComplianceAccessError,
  requireComplianceAccess,
} from "@/lib/compliance-access-server";
import {
  CreditexOfficialProductError,
} from "@/lib/creditex-official-product-registry";
import {
  creditexControlledManualProductRegistry,
} from "@/lib/creditex-official-product-registry-definitions";
import {
  loadOfficialProductRegistryStatus,
  syncOfficialProductRegistry,
  verifyCreditexControlledProductPermissionArtifact,
  type CreditexFetchedOfficialProductSource,
  type CreditexControlledProductImportReview,
  type CreditexOfficialProductArtifactStore,
} from "@/lib/creditex-official-product-registry-server";
import { withCreditexProductRegistryFleetLease } from
  "@/lib/creditex-product-registry-maintenance";

export const runtime = "edge";
export const dynamic = "force-dynamic";

const MAXIMUM_CONTROLLED_IMPORT_BYTES = 8 * 1024 * 1024;
const HORIZON_REGISTRY_CODE = "wa-horizon-supported-solutions";

type ControlledPermissionRecord = {
  artifact_id: string;
  sha256: string;
  object_key: string;
  size_bytes: number;
  source_host: string;
  source_title: string;
  captured_by_uid: string;
  review_decision_id: string;
  reviewed_by_uid: string;
};

function json(body: object, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "private, no-store",
      "Cross-Origin-Resource-Policy": "same-origin",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}

function errorResponse(error: unknown) {
  if (
    error instanceof ComplianceAccessError
    || error instanceof CreditexOfficialProductError
  ) {
    return json({ ok: false, code: error.code, error: error.message }, error.status);
  }
  console.error("Controlled official product import failed", error);
  return json({
    ok: false,
    code: "OFFICIAL_PRODUCT_SOURCE_UNAVAILABLE",
    error: "The controlled official product source could not be imported safely.",
  }, 500);
}

function requiredText(form: FormData, key: string, maximum: number) {
  const value = form.get(key);
  const text = typeof value === "string" ? value.trim() : "";
  if (!text || text.length > maximum || /[\u0000-\u001f\u007f]/.test(text)) {
    throw new CreditexOfficialProductError(
      "OFFICIAL_PRODUCT_REQUEST_INVALID",
      400,
      `Add a valid ${key}.`,
    );
  }
  return text;
}

function requestSize(request: Request) {
  const value = request.headers.get("content-length");
  if (!value) return;
  const bytes = Number(value);
  if (!Number.isSafeInteger(bytes) || bytes < 1 || bytes > MAXIMUM_CONTROLLED_IMPORT_BYTES) {
    throw new CreditexOfficialProductError(
      "OFFICIAL_PRODUCT_SOURCE_TOO_LARGE",
      413,
      "The controlled official product import exceeds its request limit.",
    );
  }
}

async function exactArtifacts(
  form: FormData,
  registryCode: string,
) {
  const definition = creditexControlledManualProductRegistry(registryCode);
  if (!definition) {
    const message = registryCode === HORIZON_REGISTRY_CODE
      ? "Horizon Power does not publish a supported machine export and blocks unattended acquisition. Import remains disabled until Horizon provides an authorised source artifact and its exact schema is reviewed."
      : "Choose a governed manual product registry.";
    throw new CreditexOfficialProductError(
      "OFFICIAL_PRODUCT_REQUEST_INVALID",
      409,
      message,
    );
  }
  const artifacts: CreditexFetchedOfficialProductSource[] = [];
  let total = 0;
  for (const source of definition.sources) {
    const value = form.get(`source:${source.sourceKey}`);
    if (!(value instanceof File) || value.size < 1) {
      throw new CreditexOfficialProductError(
        "OFFICIAL_PRODUCT_REQUEST_INVALID",
        400,
        `Attach the exact ${source.sourceKey} official source artifact.`,
      );
    }
    total += value.size;
    if (value.size > source.maximumBytes || total > MAXIMUM_CONTROLLED_IMPORT_BYTES) {
      throw new CreditexOfficialProductError(
        "OFFICIAL_PRODUCT_SOURCE_TOO_LARGE",
        413,
        `Official source ${source.sourceKey} exceeds its controlled byte limit.`,
      );
    }
    const contentType = value.type.split(";", 1)[0].trim().toLowerCase();
    if (!source.expectedContentTypes.includes(contentType)) {
      throw new CreditexOfficialProductError(
        "OFFICIAL_PRODUCT_SOURCE_INVALID",
        422,
        `Official source ${source.sourceKey} has an unexpected content type.`,
      );
    }
    artifacts.push({
      sourceKey: source.sourceKey,
      contentType,
      bytes: new Uint8Array(await value.arrayBuffer()),
    });
  }
  return { definition, artifacts };
}

async function requireControlledPermission(
  database: D1Database,
  organisationId: string,
  registryCode: string,
  artifactId: string,
  importerUid: string,
) {
  const expectedTitle = `Controlled product registry permission: ${registryCode}`;
  const permittedHosts = registryCode === "wa-synergy-supported-solutions"
    ? ["synergy.net.au", "www.synergy.net.au"]
    : [
        "cleanenergycouncil.org.au",
        "www.cleanenergycouncil.org.au",
        "cleanenergyregulator.gov.au",
        "www.cleanenergyregulator.gov.au",
      ];
  const placeholders = permittedHosts.map(() => "?").join(", ");
  const permission = await database.prepare(`SELECT
      artifact.id artifact_id,
      artifact.sha256,
      artifact.object_key,
      artifact.size_bytes,
      artifact.source_host,
      artifact.source_title,
      artifact.captured_by_uid,
      review.id review_decision_id,
      review.reviewed_by_uid
    FROM compliance_official_source_artifacts artifact
    JOIN compliance_official_source_review_decisions review
      ON review.organisation_id = artifact.organisation_id
      AND review.subject_type = 'artifact'
      AND review.subject_id = artifact.id
      AND review.artifact_id = artifact.id
      AND review.artifact_sha256 = artifact.sha256
      AND review.artifact_object_key = artifact.object_key
      AND review.decision = 'approved'
      AND NOT EXISTS (
        SELECT 1 FROM compliance_official_source_review_decisions newer
        WHERE newer.organisation_id = review.organisation_id
          AND newer.subject_type = review.subject_type
          AND newer.subject_id = review.subject_id
          AND (
            newer.reviewed_at > review.reviewed_at
            OR (newer.reviewed_at = review.reviewed_at AND newer.id > review.id)
          )
      )
    WHERE artifact.organisation_id = ?
      AND artifact.id = ?
      AND artifact.source_title = ?
      AND artifact.source_host IN (${placeholders})
      AND artifact.custody_state IN ('draft', 'pending_review')
      AND artifact.rule_activation_enabled = 0
      AND review.reviewed_by_uid <> artifact.captured_by_uid
      AND review.reviewed_by_uid <> ?
    LIMIT 1`)
    .bind(
      organisationId,
      artifactId,
      expectedTitle,
      ...permittedHosts,
      importerUid,
    )
    .first<ControlledPermissionRecord>();
  if (!permission) {
    throw new CreditexOfficialProductError(
      "OFFICIAL_PRODUCT_REQUEST_INVALID",
      409,
      `Retain ${expectedTitle} from the official rights holder and obtain approval from a different governance reviewer before importing.`,
    );
  }
  return permission;
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) {
    return json({ ok: false, code: "ORIGIN_REJECTED", error: "Request origin was not accepted." }, 403);
  }
  try {
    requestSize(request);
    if (!request.headers.get("content-type")?.toLowerCase().startsWith("multipart/form-data")) {
      throw new CreditexOfficialProductError(
        "OFFICIAL_PRODUCT_REQUEST_INVALID",
        415,
        "Send controlled registry artifacts as multipart form data.",
      );
    }
    const database = getD1();
    const access = await requireComplianceAccess(request, {
      allowedRoles: ["admin"],
    }, database);
    if (access.governanceIdentityVerified !== true) {
      throw new CreditexOfficialProductError(
        "OFFICIAL_PRODUCT_REQUEST_INVALID",
        403,
        "Controlled product imports require a governance-verified administrator.",
      );
    }
    const form = await request.formData();
    const registryCode = requiredText(form, "registryCode", 80);
    const permissionArtifactId = requiredText(
      form,
      "permissionArtifactId",
      180,
    );
    if (form.get("confirmControlledOfficialImport") !== "true") {
      throw new CreditexOfficialProductError(
        "OFFICIAL_PRODUCT_REQUEST_INVALID",
        400,
        "Confirm the governed controlled official product import.",
      );
    }
    const { definition, artifacts } = await exactArtifacts(form, registryCode);
    const permission = await requireControlledPermission(
      database,
      access.organisationId,
      registryCode,
      permissionArtifactId,
      access.uid,
    );
    const artifactStore = (env as unknown as {
      EVIDENCE?: CreditexOfficialProductArtifactStore;
    }).EVIDENCE;
    await verifyCreditexControlledProductPermissionArtifact(
      artifactStore,
      {
        organisationId: access.organisationId,
        artifactId: permission.artifact_id,
        sha256: permission.sha256,
        objectKey: permission.object_key,
        sizeBytes: Number(permission.size_bytes),
      },
    );
    const controlledDefinition = { ...definition, fetchSources: async () => artifacts };
    const result = await withCreditexProductRegistryFleetLease(
      database,
      (fleetLease) => syncOfficialProductRegistry(
        database,
        controlledDefinition,
        {
          artifactStore,
          controlledImportPermissionArtifact: {
            organisationId: access.organisationId,
            artifactId: permission.artifact_id,
            sha256: permission.sha256,
            objectKey: permission.object_key,
            sizeBytes: Number(permission.size_bytes),
          },
          controlledImportReview: {
            importedByUid: access.uid,
            governanceIdentityVerified: true,
            permissionArtifactId: permission.artifact_id,
            permissionArtifactSha256: permission.sha256,
            permissionArtifactObjectKey: permission.object_key,
            permissionReviewDecisionId: permission.review_decision_id,
            permissionReviewedByUid: permission.reviewed_by_uid,
          } satisfies CreditexControlledProductImportReview,
          fleetLeaseId: fleetLease.leaseId,
        },
      ),
    );
    const registry = await loadOfficialProductRegistryStatus(
      database,
      registryCode,
    );
    return json({ ok: true, result, registry }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}
