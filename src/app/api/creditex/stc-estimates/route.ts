import { getD1 } from "../../../../../db";
import {
  CreditexCalculatorAccessError,
  requireCreditexCalculatorAccess,
} from "@/lib/creditex-calculator-access-server";
import {
  describeCreditexCalculatorRouteError,
} from "@/lib/creditex-calculator-route-response";
import {
  CreditexStcEstimateError,
} from "@/lib/creditex-stc-estimator";
import { CreditexSresRegistryError } from "@/lib/creditex-sres-registry";
import { estimateCreditexStcsFromRegistry } from "@/lib/creditex-sres-registry-server";
import { estimateCreditexSresQuote } from "@/lib/creditex-sres-calculator-estimator";
import {
  creditexSresCalculationBlocker,
  CreditexOfficialProductError,
} from "@/lib/creditex-official-product-registry";
import {
  BoundedJsonRequestError,
  MAXIMUM_CREDITEX_JSON_BYTES,
  readBoundedJsonRequest,
} from "@/lib/bounded-json-request";

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
    error instanceof CreditexCalculatorAccessError
    || error instanceof CreditexStcEstimateError
    || error instanceof CreditexSresRegistryError
    || error instanceof CreditexOfficialProductError
    || error instanceof BoundedJsonRequestError
  ) {
    const code = error instanceof BoundedJsonRequestError
      ? error.code === "REQUEST_TOO_LARGE"
        ? "STC_REQUEST_TOO_LARGE"
        : "STC_REQUEST_INVALID"
      : error.code;
    return json({
      ok: false,
      code,
      error: error.message,
    }, error.status);
  }
  console.error("Creditex STC estimate failed", error);
  return json({
    ok: false,
    code: "STC_ESTIMATE_UNAVAILABLE",
    error: "The STC estimate could not be completed safely.",
  }, 500);
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
      code: "STC_CONTENT_TYPE_INVALID",
      error: "Send STC estimate requests as JSON.",
    }, 415);
  }
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (
    Number.isFinite(contentLength)
    && contentLength > MAXIMUM_CREDITEX_JSON_BYTES
  ) {
    return json({
      ok: false,
      code: "STC_REQUEST_TOO_LARGE",
      error: "The STC estimate request exceeds 16 KiB.",
    }, 413);
  }

  try {
    const database = getD1();
    await requireCreditexCalculatorAccess(request, database);
    const body = await readBoundedJsonRequest(
      request,
      MAXIMUM_CREDITEX_JSON_BYTES,
    );
    const technology = body && typeof body === "object" && !Array.isArray(body)
      ? String((body as Record<string, unknown>).technology || "")
      : "";
    const estimatePurpose = body && typeof body === "object" && !Array.isArray(body)
      ? String((body as Record<string, unknown>).estimatePurpose || "")
      : "";
    if (estimatePurpose && estimatePurpose !== "quote") {
      throw new CreditexStcEstimateError(
        "STC_REQUEST_INVALID",
        400,
        "Choose a supported STC estimate purpose.",
      );
    }
    if (estimatePurpose !== "quote") {
      const productBlocker = creditexSresCalculationBlocker(technology);
      if (productBlocker) {
        throw new CreditexOfficialProductError(
          "OFFICIAL_PRODUCT_REGISTRY_UNAVAILABLE",
          409,
          `${productBlocker} This activity remains disabled instead of accepting caller-controlled product values.`,
        );
      }
    }
    const estimate = estimatePurpose === "quote"
      ? await estimateCreditexSresQuote(database, body)
      : await estimateCreditexStcsFromRegistry(database, body);
    return json({ ok: true, estimate });
  } catch (error) {
    return errorResponse(error);
  }
}
