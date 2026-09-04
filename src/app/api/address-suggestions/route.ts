import { getD1 } from "../../../../db";
import { adminJson, cleanAdminText } from "@/lib/admin-server";
import {
  acceptedAddressSuggestionOrigin,
  fetchAustralianAddressSuggestions,
  isAddressSuggestionProviderError,
  isAddressSuggestionSelectionError,
  readAddressSuggestionAction,
  resolveAustralianAddressSuggestion,
} from "@/lib/address-suggestions-server";
import { createSharedLeadRateLimiter } from "@/lib/lead-rate-limit.mjs";

export const runtime = "edge";

const WINDOW_MS = 60_000;
const WINDOW_LIMIT = 40;
const addressRateLimiterOptions = {
  env: process.env,
  getDatabase: getD1,
  limit: WINDOW_LIMIT,
  windowMs: WINDOW_MS,
};
const addressRateLimiter = createSharedLeadRateLimiter(addressRateLimiterOptions);

function requestKey(request: Request) {
  return cleanAdminText(
    request.headers.get("cf-connecting-ip")
      || request.headers.get("x-forwarded-for")?.split(",")[0]
      || "unknown",
    80,
  );
}

function publicSelection(selection: NonNullable<Awaited<ReturnType<
  typeof resolveAustralianAddressSuggestion
>>["selection"]>) {
  return {
    id: selection.providerReference,
    label: selection.formattedAddress,
    addressLine1: selection.addressLine1,
    addressLine2: selection.addressLine2,
    suburb: selection.suburb,
    addressState: selection.addressState,
    postcode: selection.postcode,
    provider: selection.provider,
    providerReference: selection.providerReference,
    formattedAddress: selection.formattedAddress,
  };
}

export async function POST(request: Request) {
  if (!acceptedAddressSuggestionOrigin(request)) {
    return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  }
  const rateLimit = await addressRateLimiter.check(
    `address-suggestion:${requestKey(request)}`,
  );
  if (rateLimit.unavailable) {
    return Response.json(
      { ok: false, error: "Address search is temporarily unavailable. Enter the address manually." },
      {
        status: 503,
        headers: { "Cache-Control": "no-store", "Retry-After": "60" },
      },
    );
  }
  if (!rateLimit.allowed) {
    return Response.json(
      { ok: false, error: "Too many address searches. Wait a moment and try again." },
      {
        status: 429,
        headers: {
          "Cache-Control": "no-store",
          "Retry-After": String(rateLimit.retryAfterSeconds || 60),
        },
      },
    );
  }
  try {
    const action = await readAddressSuggestionAction(request);
    if (action.action === "predict") {
      const result = await fetchAustralianAddressSuggestions(action.query, {
        sessionToken: action.sessionToken,
      });
      const predictions = result.predictions.map((prediction) => ({
        id: prediction.id,
        label: prediction.label,
        provider: prediction.provider,
      }));
      return adminJson({
        ok: true,
        configured: result.configured,
        predictions,
      });
    }

    const result = await resolveAustralianAddressSuggestion(action);
    return adminJson({
      ok: true,
      configured: result.configured,
      selection: result.selection ? publicSelection(result.selection) : null,
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "ADDRESS_BODY_INVALID" || code === "ADDRESS_ACTION_INVALID") {
      return adminJson(
        { ok: false, error: "Address search request was not valid." },
        400,
      );
    }
    if (error instanceof SyntaxError) {
      return adminJson({ ok: false, error: "Address search was not valid JSON." }, 400);
    }
    if (isAddressSuggestionSelectionError(error)) {
      return adminJson(
        { ok: false, configured: true, selection: null, error: error.message },
        422,
      );
    }
    const providerError = isAddressSuggestionProviderError(error)
      ? error
      : null;
    const message = providerError
      ? providerError.message
      : "Address suggestions are temporarily unavailable.";
    return Response.json(
      {
        ok: false,
        configured: true,
        predictions: [],
        suggestions: [],
        error: `${message} Enter the address manually.`,
      },
      {
        status: 502,
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  }
}
