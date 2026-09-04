import { getD1 } from "../../../../db";
import { adminJson, sameOrigin } from "@/lib/admin-server";
import {
  fetchAustralianAddressSuggestions,
  isAddressSuggestionProviderError,
  isAddressSuggestionSelectionError,
  readAddressSuggestionAction,
  resolveAustralianAddressSuggestion,
} from "@/lib/address-suggestions-server";
import { integrationEnvironment } from "@/lib/trade-integrations-server";
import { createSharedLeadRateLimiter } from "@/lib/lead-rate-limit.mjs";
import { requireInstallerTeamAccess } from "@/lib/trade-team-server";
import {
  issueTradeAddressSelectionProof,
  TradeAddressVerificationError,
} from "@/lib/trade-address-verification";

export const runtime = "edge";

const WINDOW_MS = 60_000;
const WINDOW_LIMIT = 80;
const tradeAddressRateLimiterOptions = {
  env: process.env,
  getDatabase: getD1,
  limit: WINDOW_LIMIT,
  windowMs: WINDOW_MS,
};
const tradeAddressRateLimiter = createSharedLeadRateLimiter(
  tradeAddressRateLimiterOptions,
);

function resolvedSelection(selection: NonNullable<Awaited<ReturnType<
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
  if (!sameOrigin(request)) {
    return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  }
  let access: Awaited<ReturnType<typeof requireInstallerTeamAccess>>;
  try {
    access = await requireInstallerTeamAccess(request);
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    return adminJson(
      {
        ok: false,
        error: code === "AUTH_REQUIRED"
          ? "Sign in to search addresses."
          : "Address search is not available to this account.",
      },
      code === "AUTH_REQUIRED" ? 401 : 403,
    );
  }

  const rateLimit = await tradeAddressRateLimiter.check(
    `trade-address-suggestion:${access.ownerUid}:${access.actorUid}`,
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

  const signingSecret = String(
    integrationEnvironment().CRM_INTEGRATION_ENCRYPTION_KEY || "",
  ).trim();
  try {
    const action = await readAddressSuggestionAction(request);
    if (!signingSecret) {
      return adminJson({
        ok: true,
        configured: false, suggestions: [],
        predictions: [],
        selection: null,
      });
    }

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
    if (!result.configured || !result.selection) {
      return adminJson({
        ok: true,
        configured: false,
        suggestions: [],
        selection: null,
      });
    }
    const selection = resolvedSelection(result.selection);
    return adminJson({
      ok: true,
      configured: true,
      selection: {
        ...selection,
        selectionProof: await issueTradeAddressSelectionProof(result.selection, {
          ownerUid: access.ownerUid,
          secret: signingSecret,
        }),
      },
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
    if (
      error instanceof TradeAddressVerificationError
      && error.code === "ADDRESS_PROOF_KEY_INVALID"
    ) {
      return adminJson(
        {
          ok: false,
          configured: false,
          suggestions: [],
          selection: null,
          error: "Address verification is not configured. Enter the address manually.",
        },
        503,
      );
    }
    const message = isAddressSuggestionProviderError(error)
      ? error.message
      : "Address suggestions are temporarily unavailable.";
    return adminJson(
      {
        ok: false,
        configured: true,
        predictions: [],
        suggestions: [],
        selection: null,
        error: `${message} Enter the address manually.`,
      },
      502,
    );
  }
}
