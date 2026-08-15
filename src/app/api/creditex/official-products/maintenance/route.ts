import { env } from "cloudflare:workers";
import { getD1 } from "../../../../../../db";
import {
  BoundedJsonRequestError,
  MAXIMUM_CREDITEX_JSON_BYTES,
  readBoundedJsonRequest,
} from "@/lib/bounded-json-request";
import {
  CreditexOfficialProductError,
} from "@/lib/creditex-official-product-registry";
import {
  creditexAutomaticProductRegistry,
} from "@/lib/creditex-official-product-registry-definitions";
import {
  loadOfficialProductRegistryStatus,
  syncOfficialProductRegistry,
  type CreditexOfficialProductArtifactStore,
} from "@/lib/creditex-official-product-registry-server";
import {
  CREDITEX_PRODUCT_REGISTRY_DISPATCH_HEADER,
  creditexAutomaticProductRegistryStreamingBudget,
  enqueueCreditexProductRegistryRefresh,
  withCreditexProductRegistryFleetLease,
} from "@/lib/creditex-product-registry-maintenance";
import {
  loadCerSresRegistryStatus,
  syncCerSresProductRegistry,
  type CreditexSresArtifactStore,
} from "@/lib/creditex-sres-registry-server";

export const runtime = "edge";
export const dynamic = "force-dynamic";

const MAINTENANCE_TOKEN_KEY =
  "CREDITEX_PRODUCT_REGISTRY_MAINTENANCE_TOKEN";

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

function timingSafeMatch(left: string, right: string) {
  const first = new TextEncoder().encode(left);
  const second = new TextEncoder().encode(right);
  if (first.length !== second.length) return false;
  let mismatch = 0;
  for (let index = 0; index < first.length; index += 1) {
    mismatch |= first[index] ^ second[index];
  }
  return mismatch === 0;
}

function maintenanceToken(request: Request) {
  const authorization = request.headers.get("authorization") || "";
  return authorization.startsWith("Bearer ")
    ? authorization.slice(7).trim()
    : "";
}

function errorResponse(error: unknown) {
  if (
    error instanceof CreditexOfficialProductError
    || error instanceof BoundedJsonRequestError
  ) {
    return json({ ok: false, code: error.code, error: error.message }, error.status);
  }
  console.error("Official product maintenance refresh failed.", {
    errorName: error instanceof Error ? error.name : "UnknownError",
    errorMessage: error instanceof Error ? error.message : "Unknown failure",
  });
  return json({
    ok: false,
    code: "OFFICIAL_PRODUCT_MAINTENANCE_FAILED",
    error: "The controlled registry maintenance refresh did not complete.",
  }, 503);
}

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) {
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
      error: "Send registry maintenance requests as JSON.",
    }, 415);
  }
  const runtimeEnvironment = env as unknown as Record<string, unknown>;
  const configuredToken = String(runtimeEnvironment[MAINTENANCE_TOKEN_KEY] || "");
  if (configuredToken.length < 32) {
    return json({
      ok: false,
      code: "OFFICIAL_PRODUCT_MAINTENANCE_UNAVAILABLE",
      error: "Registry maintenance authentication is not configured.",
    }, 503);
  }
  if (!timingSafeMatch(maintenanceToken(request), configuredToken)) {
    return json({
      ok: false,
      code: "AUTH_REQUIRED",
      error: "Registry maintenance authentication is required.",
    }, 401);
  }

  try {
    const body = await readBoundedJsonRequest(
      request,
      MAXIMUM_CREDITEX_JSON_BYTES,
    ) as unknown;
    if (
      !body
      || typeof body !== "object"
      || Array.isArray(body)
      || Object.keys(body).length !== 1
      || typeof (body as Record<string, unknown>).registryCode !== "string"
    ) {
      throw new CreditexOfficialProductError(
        "OFFICIAL_PRODUCT_REQUEST_INVALID",
        400,
        "Choose one controlled automatic registry refresh.",
      );
    }
    const registryCode = String(
      (body as Record<string, unknown>).registryCode,
    );
    const database = getD1();
    if (registryCode === "cer_sres_swh") {
      await enqueueCreditexProductRegistryRefresh(database, registryCode);
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
      return json({
        ok: true,
        result,
        registry: await loadCerSresRegistryStatus(database),
      }, 200, {
        [CREDITEX_PRODUCT_REGISTRY_DISPATCH_HEADER]: registryCode,
      });
    }
    const definition = creditexAutomaticProductRegistry(
      registryCode,
      runtimeEnvironment,
    );
    if (!definition) {
      throw new CreditexOfficialProductError(
        "OFFICIAL_PRODUCT_REQUEST_INVALID",
        400,
        "The selected registry does not support automatic maintenance.",
      );
    }
    await enqueueCreditexProductRegistryRefresh(database, registryCode);
    const artifactStore = (env as unknown as {
      EVIDENCE?: CreditexOfficialProductArtifactStore;
    }).EVIDENCE;
    const result = await withCreditexProductRegistryFleetLease(
      database,
      (fleetLease) => syncOfficialProductRegistry(database, definition, {
        artifactStore,
        fleetLeaseId: fleetLease.leaseId,
        maximumStreamingRecordsPerRun:
          creditexAutomaticProductRegistryStreamingBudget(definition),
      }),
    );
    return json({
      ok: true,
      result,
      registry: await loadOfficialProductRegistryStatus(
        database,
        definition.registryCode,
      ),
    }, 200, {
      [CREDITEX_PRODUCT_REGISTRY_DISPATCH_HEADER]: definition.registryCode,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
