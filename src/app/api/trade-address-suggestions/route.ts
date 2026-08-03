import { adminJson, cleanAdminText, sameOrigin } from "@/lib/admin-server";
import { integrationEnvironment, requireInstallerOperations } from "@/lib/trade-integrations-server";
import {
  canonicalProviderAddressSelection,
  issueTradeAddressSelectionProof,
  TradeAddressVerificationError,
  type ProviderAddressSelection,
} from "@/lib/trade-address-verification";

export const runtime = "edge";

type ProviderSuggestion = {
  id?: unknown; label?: unknown; addressLine1?: unknown; addressLine2?: unknown;
  suburb?: unknown; state?: unknown; postcode?: unknown; country?: unknown;
};

type GoogleAddressComponent = { long_name?: unknown; short_name?: unknown; types?: unknown };
type GoogleResult = {
  place_id?: unknown;
  formatted_address?: unknown;
  address_components?: GoogleAddressComponent[];
};

function googleComponent(components: GoogleAddressComponent[], type: string, short = false) {
  const component = components.find((item) => Array.isArray(item.types) && item.types.includes(type));
  return cleanAdminText(short ? component?.short_name : component?.long_name, 140);
}

function providerEndpoint(value: string) {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) return null;
    const google = hostname === "maps.googleapis.com";
    if ((hostname === "googleapis.com" || hostname.endsWith(".googleapis.com")) && !google) return null;
    if (google && url.pathname !== "/maps/api/geocode/json") return null;
    return { url, google, provider: google ? "google-geocoding" : hostname };
  } catch {
    return null;
  }
}

function googleSelection(item: GoogleResult): ProviderAddressSelection | null {
  const components = item.address_components || [];
  if (googleComponent(components, "country", true).toUpperCase() !== "AU") return null;
  const number = googleComponent(components, "street_number");
  const route = googleComponent(components, "route");
  try {
    return canonicalProviderAddressSelection({
      provider: "google-geocoding",
      providerReference: cleanAdminText(item.place_id, 180),
      formattedAddress: cleanAdminText(item.formatted_address, 300),
      addressLine1: [number, route].filter(Boolean).join(" "),
      addressLine2: googleComponent(components, "subpremise"),
      suburb: googleComponent(components, "locality")
        || googleComponent(components, "postal_town")
        || googleComponent(components, "sublocality"),
      addressState: googleComponent(components, "administrative_area_level_1", true).toUpperCase(),
      postcode: googleComponent(components, "postal_code"),
    });
  } catch {
    return null;
  }
}

function neutralSelection(item: ProviderSuggestion, provider: string): ProviderAddressSelection | null {
  if (cleanAdminText(item.country, 10).toUpperCase() !== "AU") return null;
  try {
    return canonicalProviderAddressSelection({
      provider,
      providerReference: cleanAdminText(item.id, 180),
      formattedAddress: cleanAdminText(item.label, 300),
      addressLine1: cleanAdminText(item.addressLine1, 140),
      addressLine2: cleanAdminText(item.addressLine2, 140),
      suburb: cleanAdminText(item.suburb, 80),
      addressState: cleanAdminText(item.state, 10).toUpperCase(),
      postcode: cleanAdminText(item.postcode, 12),
    });
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  let access: Awaited<ReturnType<typeof requireInstallerOperations>>;
  try { access = await requireInstallerOperations(request); }
  catch (error) {
    const code = error instanceof Error ? error.message : "";
    return adminJson({ ok: false, error: code === "AUTH_REQUIRED" ? "Sign in to search addresses." : "Address search is not available to this account." }, code === "AUTH_REQUIRED" ? 401 : 403);
  }
  const endpoint = String(process.env.TLINK_ADDRESS_AUTOCOMPLETE_ENDPOINT || "").trim();
  const token = String(process.env.TLINK_ADDRESS_AUTOCOMPLETE_TOKEN || "").trim();
  const signingSecret = String(integrationEnvironment().CRM_INTEGRATION_ENCRYPTION_KEY || "").trim();
  const configuredEndpoint = providerEndpoint(endpoint);
  if (!configuredEndpoint || !token || !signingSecret) return adminJson({ ok: true, configured: false, suggestions: [] });
  const query = cleanAdminText(new URL(request.url).searchParams.get("query"), 140);
  if (query.length < 3) return adminJson({ ok: true, configured: true, suggestions: [] });
  try {
    const { google, provider } = configuredEndpoint;
    const url = new URL(configuredEndpoint.url);
    if (google) {
      url.searchParams.set("address", query); url.searchParams.set("components", "country:AU"); url.searchParams.set("key", token);
    } else {
      url.searchParams.set("query", query); url.searchParams.set("country", "AU");
    }
    const response = await fetch(url, {
      headers: google ? { Accept: "application/json" } : { Authorization: `Bearer ${token}`, Accept: "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(4_000),
    });
    if (!response.ok) throw new Error("provider unavailable");
    const result = await response.json() as {
      suggestions?: ProviderSuggestion[];
      status?: unknown;
      results?: GoogleResult[];
    };
    const googleStatus = cleanAdminText(result.status, 40).toUpperCase();
    if (google && googleStatus && googleStatus !== "OK" && googleStatus !== "ZERO_RESULTS") {
      throw new Error("provider unavailable");
    }
    const selections = google
      ? (result.results || []).slice(0, 8).map(googleSelection).filter((item): item is ProviderAddressSelection => Boolean(item))
      : (result.suggestions || []).slice(0, 8).map((item) => neutralSelection(item, provider)).filter((item): item is ProviderAddressSelection => Boolean(item));
    const suggestions = await Promise.all(selections.map(async (selection) => ({
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
      selectionProof: await issueTradeAddressSelectionProof(selection, {
        ownerUid: access.uid,
        secret: signingSecret,
      }),
    })));
    return adminJson({ ok: true, configured: true, suggestions });
  } catch (error) {
    if (error instanceof TradeAddressVerificationError && error.code === "ADDRESS_PROOF_KEY_INVALID") {
      return adminJson({ ok: false, configured: false, suggestions: [], error: "Address verification is not configured. Enter the address manually." }, 503);
    }
    return adminJson({ ok: false, configured: true, suggestions: [], error: "Address suggestions are temporarily unavailable. Enter the address manually." }, 502);
  }
}
