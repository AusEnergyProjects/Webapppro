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
  CREDITEX_CALCULATOR_REQUIRED_PRODUCT_REGISTRY_CODES,
  CREDITEX_PRODUCT_REGISTRY_FLEET_LEASE_CODE,
  CREDITEX_PRODUCT_REGISTRY_REFRESH_DESIGNS,
  CREDITEX_PRODUCT_KIND_REGISTRY,
  CreditexOfficialProductError,
  type CreditexOfficialProductRegistryStatus,
} from "@/lib/creditex-official-product-registry";
import {
  creditexOfficialProductRegistryCanServeCalculator,
  loadOfficialProductRegistryStatus,
  searchOfficialProducts,
  syncOfficialProductRegistry,
  type CreditexOfficialProductArtifactStore,
  type CreditexReviewedProductCountDecrease,
} from "@/lib/creditex-official-product-registry-server";
import {
  CREDITEX_AUTOMATIC_PRODUCT_REGISTRIES,
  creditexAutomaticProductRegistry,
  creditexAutomaticProductRegistries,
  creditexCecBatteryConnectorConfigurationIssue,
} from "@/lib/creditex-official-product-registry-definitions";
import {
  creditexSresRegistryCanServeCalculator,
  loadCerSresRegistryStatus,
  syncCerSresProductRegistry,
  type CreditexSresArtifactStore,
} from "@/lib/creditex-sres-registry-server";
import {
  CREDITEX_PRODUCT_REGISTRY_DISPATCH_HEADER,
  creditexProductRegistryRefreshDue,
  enqueueCreditexProductRegistryRefresh,
  hasDueCreditexProductRegistryRefreshRequest,
  hasQueuedCreditexProductRegistryRefreshRequest,
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

function isOfficialProductRegistryStatus(
  value: object,
): value is CreditexOfficialProductRegistryStatus {
  return "snapshotId" in value;
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
    const access = await requireCreditexCalculatorAccess(request, database, {
      allowPublicQuote: true,
    });
    const parameters = new URL(request.url).searchParams;
    const continuationRegistryCode = parameters.get("continueRegistry");
    if (continuationRegistryCode) {
      if ([...parameters.keys()].some((key) => key !== "continueRegistry")) {
        throw new CreditexOfficialProductError(
          "OFFICIAL_PRODUCT_REQUEST_INVALID",
          400,
          "The official registry continuation request is invalid.",
        );
      }
      const runtimeEnvironment = env as unknown as Record<string, unknown>;
      const automaticRegistryCodes = [
        ...creditexAutomaticProductRegistries(runtimeEnvironment).map(
          (definition) => definition.registryCode,
        ),
        "cer_sres_swh",
      ];
      const requestedRegistryCodes = continuationRegistryCode
        === CREDITEX_PRODUCT_REGISTRY_FLEET_LEASE_CODE
        ? automaticRegistryCodes
        : automaticRegistryCodes.includes(continuationRegistryCode)
          ? [continuationRegistryCode]
          : [];
      if (requestedRegistryCodes.length === 0) {
        throw new CreditexOfficialProductError(
          "OFFICIAL_PRODUCT_REQUEST_INVALID",
          400,
          "The selected official registry does not support automatic continuation.",
        );
      }
      const [refreshQueued, continuationDue] = await Promise.all([
        hasQueuedCreditexProductRegistryRefreshRequest(
          database,
          requestedRegistryCodes,
        ),
        hasDueCreditexProductRegistryRefreshRequest(
          database,
          requestedRegistryCodes,
        ),
      ]);
      return json({
        ok: true,
        refreshQueued,
        continuationDue,
      }, continuationDue ? 202 : 200,
        continuationDue
          ? {
              "Retry-After": "3",
              [CREDITEX_PRODUCT_REGISTRY_DISPATCH_HEADER]:
                continuationRegistryCode,
            }
          : {});
    }
    const productKind = parameters.get("productKind");
    const installationDate = parameters.get("installationDate");
    if (!productKind && !installationDate) {
      const runtimeEnvironment = env as unknown as Record<string, unknown>;
      const registries = await Promise.all(
        CREDITEX_CALCULATOR_REQUIRED_PRODUCT_REGISTRY_CODES.map(
          async (registryCode) => {
            const status = registryCode === "cer_sres_swh"
              ? await loadCerSresRegistryStatus(database)
              : await loadOfficialProductRegistryStatus(database, registryCode);
            return {
              ...status,
              refreshDesign:
                CREDITEX_PRODUCT_REGISTRY_REFRESH_DESIGNS[registryCode],
              readiness: {
                calculatorReady: isOfficialProductRegistryStatus(status)
                  ? creditexOfficialProductRegistryCanServeCalculator(status)
                  : creditexSresRegistryCanServeCalculator(status),
                refreshReady: registryCode === "cec-products"
                  ? creditexCecBatteryConnectorConfigurationIssue(
                      runtimeEnvironment,
                    ) === null
                  : CREDITEX_PRODUCT_REGISTRY_REFRESH_DESIGNS[registryCode]
                        .refreshMode === "blocked"
                    ? false
                  : CREDITEX_PRODUCT_REGISTRY_REFRESH_DESIGNS[registryCode]
                        .refreshMode !== "governed_manual"
                    || status.status === "current",
                blocker: registryCode === "cec-products"
                  ? creditexCecBatteryConnectorConfigurationIssue(
                      runtimeEnvironment,
                    )
                  : CREDITEX_PRODUCT_REGISTRY_REFRESH_DESIGNS[registryCode]
                        .refreshMode === "blocked"
                    ? `External acquisition is blocked: ${CREDITEX_PRODUCT_REGISTRY_REFRESH_DESIGNS[registryCode].requiredConfiguration.join(", ")}.`
                  : CREDITEX_PRODUCT_REGISTRY_REFRESH_DESIGNS[registryCode]
                        .refreshMode === "governed_manual"
                    && status.status !== "current"
                    ? `Complete the governed acquisition requirements: ${CREDITEX_PRODUCT_REGISTRY_REFRESH_DESIGNS[registryCode].requiredConfiguration.join(", ")}.`
                    : null,
              },
            };
          },
        ),
      );
      return json(projectCreditexCalculatorReadResponse(access.accessType, {
        ok: true,
        registries,
      }));
    }
    const searchInput = {
      productKind,
      installationDate,
      query: parameters.get("q") || "",
      brand: parameters.get("brand") || "",
      model: parameters.get("model") || "",
      productType: parameters.get("productType") || "",
      veuActivityCode: parameters.get("veuActivityCode") || "",
      veuScenario: parameters.get("veuScenario") || "",
      limit: parameters.get("limit") || "50",
    };
    let result;
    try {
      result = await searchOfficialProducts(database, searchInput, {
        allowStaleAcceptedSnapshot: true,
      });
    } catch (error) {
      const automaticRecoveryRequired = error instanceof CreditexOfficialProductError
        && (
          error.code === "OFFICIAL_PRODUCT_REGISTRY_STALE"
          || error.code === "OFFICIAL_PRODUCT_REGISTRY_UNAVAILABLE"
        );
      if (!automaticRecoveryRequired) throw error;
      const registryCode = CREDITEX_PRODUCT_KIND_REGISTRY[
        String(productKind || "") as keyof typeof CREDITEX_PRODUCT_KIND_REGISTRY
      ];
      const runtimeEnvironment = env as unknown as Record<string, unknown>;
      const definition = registryCode
        ? creditexAutomaticProductRegistry(registryCode, runtimeEnvironment)
        : undefined;
      if (!definition) throw error;
      await enqueueCreditexProductRegistryRefresh(
        database,
        definition.registryCode,
      );
      return json({
        ok: false,
        code: "OFFICIAL_PRODUCT_FLEET_BUSY",
        error: "The exact official product registry is updating. The calculator will retry automatically.",
      }, 503, {
        "Retry-After": "3",
        [CREDITEX_PRODUCT_REGISTRY_DISPATCH_HEADER]: definition.registryCode,
      });
    }
    const responseBody = projectCreditexCalculatorReadResponse(access.accessType, {
      ok: true,
      ...result,
    });
    if (creditexProductRegistryRefreshDue(result.registry)) {
      await enqueueCreditexProductRegistryRefresh(
        database,
        result.registry.registryCode,
      );
      return json(responseBody, 200, {
        [CREDITEX_PRODUCT_REGISTRY_DISPATCH_HEADER]:
          result.registry.registryCode,
      });
    }
    return json(responseBody);
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
    if (standardRefresh) {
      const automaticDefinitions = creditexAutomaticProductRegistries(
        runtimeEnvironment,
      );
      let registryCodes: string[];
      if (body.registryCode === "all") {
        const cecConfigurationIssue =
          creditexCecBatteryConnectorConfigurationIssue(runtimeEnvironment);
        if (cecConfigurationIssue) {
          throw new CreditexOfficialProductError(
            "OFFICIAL_PRODUCT_REGISTRY_UNAVAILABLE",
            503,
            cecConfigurationIssue,
          );
        }
        registryCodes = [
          ...automaticDefinitions.map((definition) => definition.registryCode),
          "cer_sres_swh",
        ];
      } else if (
        body.registryCode === "cer_sres_swh"
        || automaticDefinitions.some(
          (definition) => definition.registryCode === body.registryCode,
        )
      ) {
        registryCodes = [body.registryCode];
      } else {
        throw new CreditexOfficialProductError(
          "OFFICIAL_PRODUCT_REQUEST_INVALID",
          400,
          "The selected official registry does not support automatic refresh.",
        );
      }
      await Promise.all(registryCodes.map((registryCode) => (
        enqueueCreditexProductRegistryRefresh(database, registryCode)
      )));
      const registries = await Promise.all(registryCodes.map(
        (registryCode) => registryCode === "cer_sres_swh"
          ? loadCerSresRegistryStatus(database)
          : loadOfficialProductRegistryStatus(database, registryCode),
      ));
      const dispatchRegistryCode = registryCodes.length === 1
        ? registryCodes[0]
        : CREDITEX_PRODUCT_REGISTRY_FLEET_LEASE_CODE;
      return json({
        ok: true,
        queued: true,
        registryCodes,
        registries,
      }, 202, {
        "Retry-After": "3",
        [CREDITEX_PRODUCT_REGISTRY_DISPATCH_HEADER]: dispatchRegistryCode,
      });
    }
    const definitions = body.registryCode === "all"
      ? [...CREDITEX_AUTOMATIC_PRODUCT_REGISTRIES]
      : [creditexAutomaticProductRegistry(
          body.registryCode,
          runtimeEnvironment,
        )].filter(
        (value) => value !== undefined,
      );
    if (definitions.length === 0) {
      if (body.registryCode === "cer_sres_swh") {
        const artifactStore = (env as unknown as {
          EVIDENCE?: CreditexSresArtifactStore;
        }).EVIDENCE;
        const result = await withCreditexProductRegistryFleetLease(
          database,
          (fleetLease) => syncCerSresProductRegistry(database, {
            artifactStore,
            fleetLeaseId: fleetLease.leaseId,
          }),
        );
        const registry = await loadCerSresRegistryStatus(database);
        return json({ ok: true, results: [result], registries: [registry] });
      }
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
      results.push(await withCreditexProductRegistryFleetLease(
        database,
        (fleetLease) => syncOfficialProductRegistry(database, definition, {
          artifactStore,
          reviewedCountDecrease,
          fleetLeaseId: fleetLease.leaseId,
        }),
      ));
    }
    if (body.registryCode === "all") {
      const licensedCecBattery = creditexAutomaticProductRegistry(
        "cec-products",
        runtimeEnvironment,
      );
      if (licensedCecBattery) {
        definitions.push(licensedCecBattery);
        results.push(await withCreditexProductRegistryFleetLease(
          database,
          (fleetLease) => syncOfficialProductRegistry(
            database,
            licensedCecBattery,
            {
              artifactStore,
              reviewedCountDecrease,
              fleetLeaseId: fleetLease.leaseId,
            },
          ),
        ));
      }
      const sresArtifactStore = (env as unknown as {
        EVIDENCE?: CreditexSresArtifactStore;
      }).EVIDENCE;
      results.push(await withCreditexProductRegistryFleetLease(
        database,
        (fleetLease) => syncCerSresProductRegistry(database, {
          artifactStore: sresArtifactStore,
          fleetLeaseId: fleetLease.leaseId,
        }),
      ));
      if (!licensedCecBattery) {
        throw new CreditexOfficialProductError(
          "OFFICIAL_PRODUCT_REGISTRY_UNAVAILABLE",
          503,
          creditexCecBatteryConnectorConfigurationIssue(runtimeEnvironment)
            || "The licensed CEC battery connector is unavailable.",
        );
      }
    }
    const registries = await Promise.all([
      ...definitions.map((definition) => (
        loadOfficialProductRegistryStatus(database, definition.registryCode)
      )),
      ...(body.registryCode === "all"
        ? [loadCerSresRegistryStatus(database)]
        : []),
    ]);
    return json({ ok: true, results, registries });
  } catch (error) {
    return errorResponse(error);
  }
}
