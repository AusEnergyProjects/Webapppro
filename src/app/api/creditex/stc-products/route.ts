import { env } from "cloudflare:workers";
import { getD1 } from "../../../../../db";
import {
  BoundedJsonRequestError,
  MAXIMUM_CREDITEX_JSON_BYTES,
  readBoundedJsonRequest,
} from "@/lib/bounded-json-request";
import {
  ComplianceAccessError,
  requireComplianceAccess,
} from "@/lib/compliance-access-server";
import {
  CreditexCalculatorAccessError,
  requireCreditexCalculatorAccess,
} from "@/lib/creditex-calculator-access-server";
import {
  describeCreditexCalculatorRouteError,
  projectCreditexCalculatorReadResponse,
} from "@/lib/creditex-calculator-route-response";
import { CreditexSresRegistryError } from "@/lib/creditex-sres-registry";
import {
  ensureCerSresProductRegistryCurrent,
  loadCerSresRegistryStatus,
  searchCerSresProducts,
  syncCerSresProductRegistry,
  type CreditexSresArtifactStore,
  type CreditexSresReviewedProductCountDecrease,
} from "@/lib/creditex-sres-registry-server";
import {
  withCreditexProductRegistryFleetLease,
} from
  "@/lib/creditex-product-registry-maintenance";

export const runtime = "edge";
export const dynamic = "force-dynamic";

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}

function json(body: object, status = 200, headers: HeadersInit = {}) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      ...headers,
    },
  });
}

function errorResponse(error: unknown) {
  const descriptor = describeCreditexCalculatorRouteError(error);
  if (descriptor) {
    return json({
      ok: false,
      code: descriptor.code,
      error: descriptor.error,
    }, descriptor.status, descriptor.headers);
  }
  if (
    error instanceof ComplianceAccessError
    || error instanceof CreditexCalculatorAccessError
    || error instanceof CreditexSresRegistryError
    || error instanceof BoundedJsonRequestError
  ) {
    return json({
      ok: false,
      code: error.code,
      error: error.message,
    }, error.status);
  }
  console.error("Creditex SRES product registry request failed", error);
  return json({
    ok: false,
    code: "SRES_PRODUCT_REGISTRY_UNAVAILABLE",
    error: "The official product registry request could not be completed safely.",
  }, 500);
}

function requestRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new CreditexSresRegistryError(
      "SRES_REFRESH_REQUEST_INVALID",
      400,
      "The registry refresh request must be an object.",
    );
  }
  return value as Record<string, unknown>;
}

function reviewedDecreaseSources(value: unknown) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 3) {
    throw new CreditexSresRegistryError(
      "SRES_REFRESH_REQUEST_INVALID",
      400,
      "List each exact CER product source count decrease being reviewed.",
    );
  }
  return value.map((item) => {
    const source = requestRecord(item);
    if (
      Object.keys(source).length !== 3
      || typeof source.sourceKey !== "string"
      || !Number.isSafeInteger(source.previousRecordCount)
      || !Number.isSafeInteger(source.acceptedRecordCount)
    ) {
      throw new CreditexSresRegistryError(
        "SRES_REFRESH_REQUEST_INVALID",
        400,
        "Each reviewed decrease requires an exact source key, previous count and accepted count.",
      );
    }
    return {
      sourceKey: source.sourceKey,
      previousRecordCount: Number(source.previousRecordCount),
      acceptedRecordCount: Number(source.acceptedRecordCount),
    };
  });
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
    const access = await requireCreditexCalculatorAccess(request, database, {
      allowPublicQuote: true,
    });
    const parameters = new URL(request.url).searchParams;
    const technology = parameters.get("technology");
    const installationDate = parameters.get("installationDate");
    if (!technology && !installationDate) {
      const registry = await loadCerSresRegistryStatus(database);
      return json(projectCreditexCalculatorReadResponse(access.accessType, {
        ok: true,
        registry,
      }));
    }
    const searchInput = {
      technology: String(technology || "") as
        | "solar_water_heater"
        | "air_source_heat_pump",
      installationDate: String(installationDate || ""),
      category: parameters.get("category") || "",
      brand: parameters.get("brand") || "",
      model: parameters.get("model") || "",
      query: parameters.get("q") || "",
      limit: Number(parameters.get("limit") || 30),
      cascade: parameters.get("mode") === "cascade",
    };
    let result;
    try {
      result = await searchCerSresProducts(database, searchInput);
    } catch (error) {
      const recoveryRequired = error instanceof CreditexSresRegistryError
        && (
          error.code === "SRES_PRODUCT_REGISTRY_STALE"
          || error.code === "SRES_PRODUCT_REGISTRY_UNAVAILABLE"
        );
      if (!recoveryRequired) throw error;
      const artifactStore = (env as unknown as {
        EVIDENCE?: CreditexSresArtifactStore;
      }).EVIDENCE;
      await withCreditexProductRegistryFleetLease(
        database,
        () => ensureCerSresProductRegistryCurrent(
          database,
          { artifactStore },
        ),
      );
      result = await searchCerSresProducts(database, searchInput);
    }
    return json(projectCreditexCalculatorReadResponse(access.accessType, {
      ok: true,
      ...result,
    }));
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
  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    return json({
      ok: false,
      code: "SRES_CONTENT_TYPE_INVALID",
      error: "Send registry refresh requests as JSON.",
    }, 415);
  }
  try {
    const database = getD1();
    const access = await requireComplianceAccess(request, {
      allowedRoles: ["admin"],
    }, database);
    const body = requestRecord(await readBoundedJsonRequest(
      request,
      MAXIMUM_CREDITEX_JSON_BYTES,
    ));
    const standardRefresh = body.action === "refresh"
      && Object.keys(body).length === 1;
    const reviewedDecreaseRefresh = body.action === "refresh-reviewed-decrease"
      && Object.keys(body).length === 3
      && typeof body.reviewNote === "string"
      && Object.hasOwn(body, "sources");
    if (!standardRefresh && !reviewedDecreaseRefresh) {
      throw new CreditexSresRegistryError(
        "SRES_REFRESH_REQUEST_INVALID",
        400,
        "Choose the controlled official registry refresh action.",
      );
    }
    if (
      reviewedDecreaseRefresh
      && access.governanceIdentityVerified !== true
    ) {
      throw new CreditexSresRegistryError(
        "SRES_REFRESH_REQUEST_INVALID",
        403,
        "A reviewed source decrease requires a governance-verified administrator.",
      );
    }
    const reviewedCountDecrease: CreditexSresReviewedProductCountDecrease
      | undefined = reviewedDecreaseRefresh
        ? {
            reviewedByUid: access.uid,
            governanceIdentityVerified: true,
            reviewNote: String(body.reviewNote),
            sources: reviewedDecreaseSources(body.sources),
          }
        : undefined;
    const artifactStore = (env as unknown as {
      EVIDENCE?: CreditexSresArtifactStore;
    }).EVIDENCE;
    const result = await withCreditexProductRegistryFleetLease(
      database,
      () => syncCerSresProductRegistry(database, {
        artifactStore,
        reviewedCountDecrease,
      }),
    );
    const registry = await loadCerSresRegistryStatus(database);
    return json({ ok: true, result, registry });
  } catch (error) {
    return errorResponse(error);
  }
}
