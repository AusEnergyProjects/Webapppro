import {
  canonicalProviderAddressSelection,
  type ProviderAddressSelection,
} from "./trade-address-verification.ts";

const GOOGLE_PLACES_AUTOCOMPLETE_PATH = "/v1/places:autocomplete";
const GOOGLE_PREDICTION_FIELD_MASK = [
  "suggestions.placePrediction.placeId",
  "suggestions.placePrediction.text.text",
].join(",");
const GOOGLE_DETAILS_FIELD_MASK = "id,formattedAddress,addressComponents";
const SESSION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{1,36}$/;
export const ADDRESS_SUGGESTION_MAX_BODY_BYTES = 1_024;

export function acceptedAddressSuggestionOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

function cleanProviderText(value: unknown, maximum: number) {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

function providerDiagnosticToken(value: unknown) {
  const token = cleanProviderText(value, 80).toUpperCase();
  return /^[A-Z][A-Z0-9_.-]{0,79}$/.test(token) ? token : "";
}

type ProviderSuggestion = {
  id?: unknown;
  label?: unknown;
  addressLine1?: unknown;
  addressLine2?: unknown;
  suburb?: unknown;
  state?: unknown;
  postcode?: unknown;
  country?: unknown;
};

type GoogleAddressComponent = {
  long_name?: unknown;
  short_name?: unknown;
  longText?: unknown;
  shortText?: unknown;
  types?: unknown;
};

type GoogleAddressResult = {
  place_id?: unknown;
  formatted_address?: unknown;
  address_components?: GoogleAddressComponent[];
  id?: unknown;
  formattedAddress?: unknown;
  addressComponents?: GoogleAddressComponent[];
};

type GooglePlacePrediction = {
  placeId?: unknown;
  text?: { text?: unknown };
};

export type AddressSuggestionPrediction = {
  id: string;
  label: string;
  provider: string;
};

export type AddressSuggestionProviderResult = {
  configured: boolean;
  predictions: AddressSuggestionPrediction[];
};

export type AddressSuggestionResolutionResult = {
  configured: boolean;
  selection: ProviderAddressSelection | null;
};

export type AddressSuggestionAction =
  | { action: "predict"; query: unknown; sessionToken?: unknown }
  | {
    action: "resolve";
    provider: unknown;
    providerReference: unknown;
    query: unknown;
    sessionToken?: unknown;
  };

export class AddressSuggestionProviderError extends Error {
  readonly providerStatus: number;
  readonly providerCode: string;
  readonly providerReason: string;

  constructor(
    message = "Address suggestions are temporarily unavailable.",
    options: {
      providerStatus?: number;
      providerCode?: string;
      providerReason?: string;
    } = {},
  ) {
    super(message);
    this.name = "AddressSuggestionProviderError";
    this.providerStatus = Number.isInteger(options.providerStatus)
      ? Number(options.providerStatus)
      : 0;
    this.providerCode = providerDiagnosticToken(options.providerCode);
    this.providerReason = providerDiagnosticToken(options.providerReason);
  }
}

export class AddressSuggestionSelectionError extends Error {
  constructor(message = "This address could not be resolved. Enter the address manually.") {
    super(message);
    this.name = "AddressSuggestionSelectionError";
  }
}

function googleSessionToken(value: unknown) {
  if (value === undefined || value === null || value === "") return "";
  const sessionToken = typeof value === "string" ? value.trim() : "";
  if (!SESSION_TOKEN_PATTERN.test(sessionToken)) {
    throw new AddressSuggestionSelectionError("Address search session was not valid.");
  }
  return sessionToken;
}

function boundedRequestText(value: unknown, maximum: number) {
  return typeof value === "string" && value.trim().length <= maximum;
}

function boundedSessionToken(value: unknown) {
  return value === undefined
    || value === ""
    || (typeof value === "string" && SESSION_TOKEN_PATTERN.test(value));
}

export async function readAddressSuggestionAction(
  request: Request,
): Promise<AddressSuggestionAction> {
  const length = Number(request.headers.get("content-length") || 0);
  if (
    !Number.isFinite(length)
    || length < 0
    || length > ADDRESS_SUGGESTION_MAX_BODY_BYTES
  ) throw new Error("ADDRESS_BODY_INVALID");

  const text = await request.text();
  if (
    new TextEncoder().encode(text).byteLength
    > ADDRESS_SUGGESTION_MAX_BODY_BYTES
  ) throw new Error("ADDRESS_BODY_INVALID");

  const parsed = JSON.parse(text || "{}");
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("ADDRESS_ACTION_INVALID");
  }
  const body = parsed as Record<string, unknown>;
  if (
    body.action === "predict"
    && boundedRequestText(body.query, 140)
    && boundedSessionToken(body.sessionToken)
  ) {
    return {
      action: "predict",
      query: body.query,
      sessionToken: body.sessionToken,
    };
  }
  if (
    body.action === "resolve"
    && boundedRequestText(body.provider, 120)
    && boundedRequestText(body.providerReference, 180)
    && boundedRequestText(body.query, 140)
    && boundedSessionToken(body.sessionToken)
  ) {
    return {
      action: "resolve",
      provider: body.provider,
      providerReference: body.providerReference,
      query: body.query,
      sessionToken: body.sessionToken,
    };
  }
  throw new Error("ADDRESS_ACTION_INVALID");
}

function googleComponent(
  components: GoogleAddressComponent[],
  type: string,
  short = false,
) {
  const component = components.find(
    (item) => Array.isArray(item.types) && item.types.includes(type),
  );
  return cleanProviderText(
    short
      ? component?.shortText ?? component?.short_name
      : component?.longText ?? component?.long_name,
    140,
  );
}

type ProviderConfiguration = {
  url: URL;
  google: boolean;
  kind: "google-places" | "google-geocoding" | "neutral";
  provider: string;
};

function providerEndpoint(value: string): ProviderConfiguration | null {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    if (
      url.protocol !== "https:"
      || url.username
      || url.password
      || url.hash
      || (url.port && url.port !== "443")
    ) return null;

    if (hostname === "places.googleapis.com") {
      if (url.pathname !== GOOGLE_PLACES_AUTOCOMPLETE_PATH || url.search) return null;
      return {
        url,
        google: true,
        kind: "google-places",
        provider: "google-places",
      };
    }

    const google = hostname === "maps.googleapis.com";
    if (google) {
      if (url.pathname !== "/maps/api/geocode/json" || url.search) return null;
      return {
        url,
        google,
        kind: "google-geocoding",
        provider: google ? "google-geocoding" : hostname,
      };
    }

    if (hostname === "googleapis.com" || hostname.endsWith(".googleapis.com")) {
      return null;
    }
    return { url, google: false, kind: "neutral", provider: hostname };
  } catch {
    return null;
  }
}

function googleSelection(
  item: GoogleAddressResult,
  provider: "google-geocoding" | "google-places",
): ProviderAddressSelection | null {
  const components = "addressComponents" in item
    ? item.addressComponents || []
    : item.address_components || [];
  if (googleComponent(components, "country", true).toUpperCase() !== "AU") {
    return null;
  }
  const number = googleComponent(components, "street_number");
  const route = googleComponent(components, "route");
  try {
    return canonicalProviderAddressSelection({
      provider,
      providerReference: cleanProviderText(
        "id" in item ? item.id : item.place_id,
        180,
      ),
      formattedAddress: cleanProviderText(
        "formattedAddress" in item ? item.formattedAddress : item.formatted_address,
        300,
      ),
      addressLine1: [number, route].filter(Boolean).join(" "),
      addressLine2: googleComponent(components, "subpremise"),
      suburb: googleComponent(components, "locality")
        || googleComponent(components, "postal_town")
        || googleComponent(components, "sublocality_level_1")
        || googleComponent(components, "sublocality"),
      addressState: googleComponent(
        components,
        "administrative_area_level_1",
        true,
      ).toUpperCase(),
      postcode: googleComponent(components, "postal_code"),
    });
  } catch {
    return null;
  }
}

function neutralSelection(
  item: ProviderSuggestion,
  provider: string,
): ProviderAddressSelection | null {
  if (cleanProviderText(item.country, 10).toUpperCase() !== "AU") return null;
  try {
    return canonicalProviderAddressSelection({
      provider,
      providerReference: cleanProviderText(item.id, 180),
      formattedAddress: cleanProviderText(item.label, 300),
      addressLine1: cleanProviderText(item.addressLine1, 140),
      addressLine2: cleanProviderText(item.addressLine2, 140),
      suburb: cleanProviderText(item.suburb, 80),
      addressState: cleanProviderText(item.state, 10).toUpperCase(),
      postcode: cleanProviderText(item.postcode, 12),
    });
  } catch {
    return null;
  }
}

function predictionFromSelection(
  selection: ProviderAddressSelection,
): AddressSuggestionPrediction {
  return {
    id: selection.providerReference,
    label: selection.formattedAddress,
    provider: selection.provider,
  };
}

async function responseJson(response: Response) {
  if (!response.ok) {
    let providerCode = "";
    let providerReason = "";
    try {
      const body = await response.clone().json() as {
        error?: {
          status?: unknown;
          details?: Array<{ reason?: unknown }>;
        };
        status?: unknown;
      };
      providerCode = cleanProviderText(
        body?.error?.status || body?.status,
        80,
      );
      providerReason = cleanProviderText(
        body?.error?.details?.find((detail) => detail?.reason)?.reason,
        80,
      );
    } catch {
      // Provider bodies can be HTML or empty. The HTTP status remains useful.
    }
    const providerError = new AddressSuggestionProviderError(undefined, {
      providerStatus: response.status,
      providerCode,
      providerReason,
    });
    console.warn("Address suggestion provider rejected a request", {
      providerStatus: providerError.providerStatus,
      providerCode: providerError.providerCode || "UNKNOWN",
      providerReason: providerError.providerReason || "UNKNOWN",
    });
    throw providerError;
  }
  return response.json() as Promise<unknown>;
}

async function googlePlacesPredictions(
  query: string,
  configured: ProviderConfiguration,
  token: string,
  sessionToken: string,
) {
  const response = await fetch(new URL(configured.url), {
    method: "POST",
    body: JSON.stringify({
      input: query,
      includedRegionCodes: ["au"],
      includedPrimaryTypes: ["street_address", "premise", "subpremise"],
      languageCode: "en-AU",
      regionCode: "au",
      ...(sessionToken ? { sessionToken } : {}),
    }),
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Goog-Api-Key": token,
      "X-Goog-FieldMask": GOOGLE_PREDICTION_FIELD_MASK,
    },
    redirect: "error",
    signal: AbortSignal.timeout(4_000),
  });
  const result = await responseJson(response) as {
    suggestions?: Array<{ placePrediction?: GooglePlacePrediction }>;
  };
  return (Array.isArray(result?.suggestions) ? result.suggestions : [])
    .slice(0, 8)
    .map((item): AddressSuggestionPrediction | null => {
      const id = cleanProviderText(item?.placePrediction?.placeId, 180);
      const label = cleanProviderText(item?.placePrediction?.text?.text, 300);
      return id && label ? { id, label, provider: configured.provider } : null;
    })
    .filter((item): item is AddressSuggestionPrediction => Boolean(item));
}

async function googleLegacySelections(
  query: string,
  configured: ProviderConfiguration,
  token: string,
  providerReference = "",
) {
  const url = new URL(configured.url);
  if (providerReference) {
    url.searchParams.set("place_id", providerReference);
  } else {
    url.searchParams.set("address", query);
    url.searchParams.set("components", "country:AU");
  }
  url.searchParams.set("language", "en-AU");
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "X-Goog-Api-Key": token,
    },
    redirect: "error",
    signal: AbortSignal.timeout(4_000),
  });
  const result = await responseJson(response) as {
    status?: unknown;
    results?: GoogleAddressResult[];
  };
  const status = cleanProviderText(result?.status, 40).toUpperCase();
  if (status && status !== "OK" && status !== "ZERO_RESULTS") {
    throw new AddressSuggestionProviderError();
  }
  return (Array.isArray(result?.results) ? result.results : [])
    .slice(0, 8)
    .map((item) => googleSelection(item, "google-geocoding"))
    .filter((item): item is ProviderAddressSelection => Boolean(item));
}

async function neutralSelections(
  query: string,
  configured: ProviderConfiguration,
  token: string,
) {
  const url = new URL(configured.url);
  url.searchParams.set("query", query);
  url.searchParams.set("country", "AU");
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
    redirect: "error",
    signal: AbortSignal.timeout(4_000),
  });
  const result = await responseJson(response) as {
    suggestions?: ProviderSuggestion[];
  };
  return (Array.isArray(result?.suggestions) ? result.suggestions : [])
    .slice(0, 8)
    .map((item) => neutralSelection(item, configured.provider))
    .filter((item): item is ProviderAddressSelection => Boolean(item));
}

function configuredProvider() {
  const endpoint = String(
    process.env.TLINK_ADDRESS_AUTOCOMPLETE_ENDPOINT || "",
  ).trim();
  const token = String(
    process.env.TLINK_ADDRESS_AUTOCOMPLETE_TOKEN || "",
  ).trim();
  return { configured: providerEndpoint(endpoint), token };
}

export async function fetchAustralianAddressSuggestions(
  rawQuery: unknown,
  options: { sessionToken?: unknown } = {},
): Promise<AddressSuggestionProviderResult> {
  const { configured, token } = configuredProvider();
  if (!configured || !token) {
    return { configured: false, predictions: [] };
  }
  const query = cleanProviderText(rawQuery, 140);
  if (query.length < 3) return { configured: true, predictions: [] };
  const sessionToken = googleSessionToken(options.sessionToken);

  try {
    if (configured.kind === "google-places") {
      return {
        configured: true,
        predictions: await googlePlacesPredictions(
          query,
          configured,
          token,
          sessionToken,
        ),
      };
    }
    const selections = configured.kind === "google-geocoding"
      ? await googleLegacySelections(query, configured, token)
      : await neutralSelections(query, configured, token);
    return {
      configured: true,
      predictions: selections.map(predictionFromSelection),
    };
  } catch (error) {
    if (error instanceof AddressSuggestionProviderError) throw error;
    throw new AddressSuggestionProviderError();
  }
}

export async function resolveAustralianAddressSuggestion(
  input: {
    provider?: unknown;
    providerReference?: unknown;
    query?: unknown;
    sessionToken?: unknown;
  },
): Promise<AddressSuggestionResolutionResult> {
  const { configured, token } = configuredProvider();
  if (!configured || !token) return { configured: false, selection: null };

  const provider = cleanProviderText(input.provider, 120);
  const providerReference = cleanProviderText(input.providerReference, 180);
  const query = cleanProviderText(input.query, 140);
  const sessionToken = googleSessionToken(input.sessionToken);
  if (!providerReference || provider !== configured.provider) {
    throw new AddressSuggestionSelectionError();
  }

  try {
    let selection: ProviderAddressSelection | null = null;
    if (configured.kind === "google-places") {
      const url = new URL(
        `https://places.googleapis.com/v1/places/${encodeURIComponent(providerReference)}`,
      );
      url.searchParams.set("languageCode", "en-AU");
      url.searchParams.set("regionCode", "au");
      if (sessionToken) url.searchParams.set("sessionToken", sessionToken);
      const response = await fetch(url, {
        headers: {
          Accept: "application/json",
          "X-Goog-Api-Key": token,
          "X-Goog-FieldMask": GOOGLE_DETAILS_FIELD_MASK,
        },
        redirect: "error",
        signal: AbortSignal.timeout(4_000),
      });
      const place = await responseJson(response) as GoogleAddressResult;
      if (cleanProviderText(place?.id, 180) !== providerReference) {
        throw new AddressSuggestionSelectionError();
      }
      selection = googleSelection(place, "google-places");
    } else {
      if (query.length < 3) throw new AddressSuggestionSelectionError();
      const selections = configured.kind === "google-geocoding"
        ? await googleLegacySelections(query, configured, token, providerReference)
        : await neutralSelections(query, configured, token);
      selection = selections.find(
        (item) => item.providerReference === providerReference,
      ) || null;
    }
    if (!selection) {
      throw new AddressSuggestionSelectionError(
        "Choose an Australian street address or enter the address manually.",
      );
    }
    return { configured: true, selection };
  } catch (error) {
    if (
      error instanceof AddressSuggestionProviderError
      || error instanceof AddressSuggestionSelectionError
    ) throw error;
    throw new AddressSuggestionProviderError();
  }
}
