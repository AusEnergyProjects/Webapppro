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
import {
  CREDITEX_PRODUCT_KIND_REGISTRY,
  CreditexOfficialProductError,
} from "@/lib/creditex-official-product-registry";
import {
  loadOfficialProductRegistryStatus,
  searchOfficialProducts,
  syncOfficialProductRegistry,
  type CreditexOfficialProductArtifactStore,
  type CreditexReviewedProductCountDecrease,
} from "@/lib/creditex-official-product-registry-server";
import {
  CREDITEX_AUTOMATIC_PRODUCT_REGISTRIES,
  creditexAutomaticProductRegistry,
} from "@/lib/creditex-official-product-registry-definitions";

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
    || error instanceof CreditexOfficialProductError
    || error instanceof BoundedJsonRequestError
  ) {
    return json({
      ok: false,
      code: error.code,
      error: error.message,
    }, error.status);
  }
  console.error("Creditex official product request failed", error);
  return json({
    ok: false,
    code: "OFFICIAL_PRODUCT_REGISTRY_UNAVAILABLE",
    error: "The official product request could not be completed safely.",
  }, 500);
}

function requestRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new CreditexOfficialProductError(
      "OFFICIAL_PRODUCT_REQUEST_INVALID",
      400,
      "The registry refresh request must be an object.",
    );
  }
  return value as Record<string, unknown>;
}

function reviewedDecreaseSources(value: unknown) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 100) {
    throw new CreditexOfficialProductError(
      "OFFICIAL_PRODUCT_REQUEST_INVALID",
      400,
      "List each exact official source count decrease being reviewed.",
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
      throw new CreditexOfficialProductError(
        "OFFICIAL_PRODUCT_REQUEST_INVALID",
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
    const access = await requireCreditexCalculatorAccess(request, database);
    const parameters = new URL(request.url).searchParams;
    const productKind = parameters.get("productKind");
    const installationDate = parameters.get("installationDate");
    if (!productKind && !installationDate) {
      const registryCodes = [...new Set(
        Object.values(CREDITEX_PRODUCT_KIND_REGISTRY),
      )].sort();
      const registries = await Promise.all(
        registryCodes.map((registryCode) => (
          loadOfficialProductRegistryStatus(database, registryCode)
        )),
      );
      return json(projectCreditexCalculatorReadResponse(access.accessType, {
        ok: true,
        registries,
      }));
    }
    const result = await searchOfficialProducts(database, {
      productKind,
      installationDate,
      query: parameters.get("q") || "",
      brand: parameters.get("brand") || "",
      model: parameters.get("model") || "",
      productType: parameters.get("productType") || "",
      veuActivityCode: parameters.get("veuActivityCode") || "",
      veuScenario: parameters.get("veuScenario") || "",
      limit: parameters.get("limit") || "50",
    });
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
      code: "OFFICIAL_PRODUCT_CONTENT_TYPE_INVALID",
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
      && Object.keys(body).length === 2;
    const reviewedDecreaseRefresh = body.action === "refresh-reviewed-decrease"
      && Object.keys(body).length === 4
      && typeof body.reviewNote === "string"
      && Object.hasOwn(body, "sources");
    if (
      (!standardRefresh && !reviewedDecreaseRefresh)
      || typeof body.registryCode !== "string"
    ) {
      throw new CreditexOfficialProductError(
        "OFFICIAL_PRODUCT_REQUEST_INVALID",
        400,
        "Choose a controlled official registry refresh.",
      );
    }
    if (
      reviewedDecreaseRefresh
      && (
        body.registryCode === "all"
        || access.governanceIdentityVerified !== true
      )
    ) {
      throw new CreditexOfficialProductError(
        "OFFICIAL_PRODUCT_REQUEST_INVALID",
        403,
        "A reviewed source decrease requires one registry and a governance-verified administrator.",
      );
    }
    const reviewedCountDecrease: CreditexReviewedProductCountDecrease
      | undefined = reviewedDecreaseRefresh
        ? {
            reviewedByUid: access.uid,
            governanceIdentityVerified: true,
            reviewNote: String(body.reviewNote),
            sources: reviewedDecreaseSources(body.sources),
          }
        : undefined;
    const runtimeEnvironment = env as unknown as Record<string, unknown>;
    const definitions = body.registryCode === "all"
      ? [...CREDITEX_AUTOMATIC_PRODUCT_REGISTRIES]
      : [creditexAutomaticProductRegistry(
          body.registryCode,
          runtimeEnvironment,
        )].filter(
        (value) => value !== undefined,
      );
    if (definitions.length === 0) {
      throw new CreditexOfficialProductError(
        "OFFICIAL_PRODUCT_REQUEST_INVALID",
        400,
        "The selected official registry does not support automatic refresh.",
      );
    }
    const artifactStore = (env as unknown as {
      EVIDENCE?: CreditexOfficialProductArtifactStore;
    }).EVIDENCE;
    const results = [];
    for (const definition of definitions) {
      results.push(await syncOfficialProductRegistry(database, definition, {
        artifactStore,
        reviewedCountDecrease,
      }));
    }
    if (body.registryCode === "all") {
      const licensedCecBattery = creditexAutomaticProductRegistry(
        "cec-products",
        runtimeEnvironment,
      );
      if (licensedCecBattery) {
        definitions.push(licensedCecBattery);
        results.push(await syncOfficialProductRegistry(
          database,
          licensedCecBattery,
          { artifactStore, reviewedCountDecrease },
        ));
      }
    }
    const registries = await Promise.all(
      definitions.map((definition) => (
        loadOfficialProductRegistryStatus(database, definition.registryCode)
      )),
    );
    return json({ ok: true, results, registries });
  } catch (error) {
    return errorResponse(error);
  }
}
