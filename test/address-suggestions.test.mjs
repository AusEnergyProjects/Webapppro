import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";

import {
  acceptedAddressSuggestionOrigin,
  AddressSuggestionProviderError,
  AddressSuggestionSelectionError,
  fetchAustralianAddressSuggestions,
  isAddressSuggestionProviderError,
  isAddressSuggestionSelectionError,
  readAddressSuggestionAction,
  resolveAustralianAddressSuggestion,
} from "../src/lib/address-suggestions-server.ts";

const publicRoute = fs.readFileSync(
  new URL("../src/app/api/address-suggestions/route.ts", import.meta.url),
  "utf8",
);
const tradeRoute = fs.readFileSync(
  new URL("../src/app/api/trade-address-suggestions/route.ts", import.meta.url),
  "utf8",
);
const provider = fs.readFileSync(
  new URL("../src/lib/address-suggestions-server.ts", import.meta.url),
  "utf8",
);
const lookup = fs.readFileSync(
  new URL("../src/components/AustralianAddressLookup.tsx", import.meta.url),
  "utf8",
);
const addressStyles = fs.readFileSync(
  new URL("../src/components/AustralianAddressLookup.module.css", import.meta.url),
  "utf8",
);

const originalEndpoint = process.env.TLINK_ADDRESS_AUTOCOMPLETE_ENDPOINT;
const originalToken = process.env.TLINK_ADDRESS_AUTOCOMPLETE_TOKEN;
const originalFetch = globalThis.fetch;
const sessionToken = "123e4567-e89b-12d3-a456-426614174000";

function compileTradeRoute({ access, accessError = "", rateLimit = { allowed: true }, sameOrigin = true } = {}) {
  class ProviderError extends Error {}
  class SelectionError extends Error {}
  const output = ts.transpileModule(tradeRoute, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: "src/app/api/trade-address-suggestions/route.ts",
  }).outputText;
  const moduleRecord = { exports: {} };
  const mocks = {
    "../../../../db": {
      getD1: () => ({}),
    },
    "@/lib/admin-server": {
      adminJson: (value, status = 200) => Response.json(value, { status }),
      sameOrigin: () => sameOrigin,
    },
    "@/lib/address-suggestions-server": {
      AddressSuggestionProviderError: ProviderError,
      AddressSuggestionSelectionError: SelectionError,
      isAddressSuggestionProviderError: (error) => error instanceof ProviderError,
      isAddressSuggestionSelectionError: (error) => error instanceof SelectionError,
      readAddressSuggestionAction: async (request) => request.json(),
      fetchAustralianAddressSuggestions: async () => ({
        configured: true,
        predictions: [{
          id: "place-runtime",
          label: "1 Runtime Way, Brisbane QLD 4000",
          provider: "google-places",
        }],
      }),
      resolveAustralianAddressSuggestion: async () => ({
        configured: true,
        selection: {
          addressLine1: "1 Runtime Way",
          addressLine2: "",
          suburb: "Brisbane",
          addressState: "QLD",
          postcode: "4000",
          provider: "google-places",
          providerReference: "place-runtime",
          formattedAddress: "1 Runtime Way, Brisbane QLD 4000, Australia",
        },
      }),
    },
    "@/lib/trade-integrations-server": {
      integrationEnvironment: () => ({
        CRM_INTEGRATION_ENCRYPTION_KEY: "runtime-address-proof-secret",
      }),
    },
    "@/lib/lead-rate-limit.mjs": {
      createSharedLeadRateLimiter: () => ({
        check: async () => rateLimit,
      }),
    },
    "@/lib/trade-team-server": {
      requireInstallerTeamAccess: async () => {
        if (accessError) throw new Error(accessError);
        return access;
      },
    },
    "@/lib/trade-address-verification": {
      TradeAddressVerificationError: class extends Error {},
      issueTradeAddressSelectionProof: async (_selection, input) =>
        `proof-for:${input.ownerUid}`,
    },
  };
  const require = (specifier) => {
    if (Object.hasOwn(mocks, specifier)) return mocks[specifier];
    throw new Error(`Unexpected module dependency: ${specifier}`);
  };
  new Function("require", "module", "exports", output)(
    require,
    moduleRecord,
    moduleRecord.exports,
  );
  return moduleRecord.exports;
}

function tradeAddressRequest(action = "predict") {
  return new Request("https://example.test/api/trade-address-suggestions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://example.test",
    },
    body: JSON.stringify(action === "predict"
      ? { action, query: "1 Runtime Way" }
      : {
        action,
        provider: "google-places",
        providerReference: "place-runtime",
        query: "1 Runtime Way",
      }),
  });
}

function restoreEnvironment() {
  if (originalEndpoint === undefined) delete process.env.TLINK_ADDRESS_AUTOCOMPLETE_ENDPOINT;
  else process.env.TLINK_ADDRESS_AUTOCOMPLETE_ENDPOINT = originalEndpoint;
  if (originalToken === undefined) delete process.env.TLINK_ADDRESS_AUTOCOMPLETE_TOKEN;
  else process.env.TLINK_ADDRESS_AUTOCOMPLETE_TOKEN = originalToken;
  globalThis.fetch = originalFetch;
}

function googleComponents(country = "AU") {
  return [
    { longText: "127", shortText: "127", types: ["street_number"] },
    { longText: "Collins Street", shortText: "Collins St", types: ["route"] },
    { longText: "Melbourne", shortText: "Melbourne", types: ["locality"] },
    { longText: "Victoria", shortText: "VIC", types: ["administrative_area_level_1"] },
    { longText: "3000", shortText: "3000", types: ["postal_code"] },
    {
      longText: country === "AU" ? "Australia" : "New Zealand",
      shortText: country,
      types: ["country"],
    },
  ];
}

test.afterEach(restoreEnvironment);

test("an unconfigured provider fails open to manual entry without a network request", async () => {
  delete process.env.TLINK_ADDRESS_AUTOCOMPLETE_ENDPOINT;
  delete process.env.TLINK_ADDRESS_AUTOCOMPLETE_TOKEN;
  globalThis.fetch = async () => {
    throw new Error("network request should not run");
  };

  assert.deepEqual(await fetchAustralianAddressSuggestions("127 Collins"), {
    configured: false,
    predictions: [],
  });
  assert.deepEqual(await resolveAustralianAddressSuggestion({
    provider: "google-places",
    providerReference: "place-id",
    query: "127 Collins",
  }), {
    configured: false,
    selection: null,
  });
});

test("Google Places autocomplete sends the key only in a header and returns bounded predictions", async () => {
  process.env.TLINK_ADDRESS_AUTOCOMPLETE_ENDPOINT = "https://places.googleapis.com/v1/places:autocomplete";
  process.env.TLINK_ADDRESS_AUTOCOMPLETE_TOKEN = "test-key";
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    const headers = new Headers(init?.headers);
    assert.equal(url.href, "https://places.googleapis.com/v1/places:autocomplete");
    assert.equal(url.searchParams.has("key"), false);
    assert.equal(init?.method, "POST");
    assert.equal(init?.redirect, "error");
    assert.equal(headers.get("X-Goog-Api-Key"), "test-key");
    assert.equal(
      headers.get("X-Goog-FieldMask"),
      "suggestions.placePrediction.placeId,suggestions.placePrediction.text.text",
    );
    assert.equal(headers.get("Content-Type"), "application/json");
    assert.deepEqual(JSON.parse(String(init?.body)), {
      input: "127 Collins Street",
      includedRegionCodes: ["au"],
      includedPrimaryTypes: ["street_address", "premise", "subpremise"],
      languageCode: "en-AU",
      regionCode: "au",
      sessionToken,
    });
    assert.doesNotMatch(String(init?.body), /test-key/);
    return Response.json({
      suggestions: [
        {
          placePrediction: {
            placeId: "melbourne-place",
            text: { text: "127 Collins Street, Melbourne VIC 3000, Australia" },
          },
        },
        { queryPrediction: { text: { text: "127 Collins" } } },
        { placePrediction: { placeId: "", text: { text: "Incomplete" } } },
      ],
    });
  };

  assert.deepEqual(await fetchAustralianAddressSuggestions("127 Collins Street", {
    sessionToken,
  }), {
    configured: true,
    predictions: [{
      id: "melbourne-place",
      label: "127 Collins Street, Melbourne VIC 3000, Australia",
      provider: "google-places",
    }],
  });
});

test("a Google prediction is resolved through Place Details before structured fields are returned", async () => {
  process.env.TLINK_ADDRESS_AUTOCOMPLETE_ENDPOINT = "https://places.googleapis.com/v1/places:autocomplete";
  process.env.TLINK_ADDRESS_AUTOCOMPLETE_TOKEN = "test-key";
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    const headers = new Headers(init?.headers);
    assert.equal(url.origin, "https://places.googleapis.com");
    assert.equal(url.pathname, "/v1/places/melbourne-place");
    assert.equal(url.searchParams.get("languageCode"), "en-AU");
    assert.equal(url.searchParams.get("regionCode"), "au");
    assert.equal(url.searchParams.get("sessionToken"), sessionToken);
    assert.equal(url.searchParams.has("key"), false);
    assert.equal(init?.method, undefined);
    assert.equal(headers.get("X-Goog-Api-Key"), "test-key");
    assert.equal(headers.get("X-Goog-FieldMask"), "id,formattedAddress,addressComponents");
    return Response.json({
      id: "melbourne-place",
      formattedAddress: "127 Collins Street, Melbourne VIC 3000, Australia",
      addressComponents: googleComponents(),
    });
  };

  assert.deepEqual(await resolveAustralianAddressSuggestion({
    provider: "google-places",
    providerReference: "melbourne-place",
    query: "127 Collins Street",
    sessionToken,
  }), {
    configured: true,
    selection: {
      provider: "google-places",
      providerReference: "melbourne-place",
      formattedAddress: "127 Collins Street, Melbourne VIC 3000, Australia",
      addressLine1: "127 Collins Street",
      addressLine2: "",
      suburb: "Melbourne",
      addressState: "VIC",
      postcode: "3000",
    },
  });
});

test("Place Details rejects a non-Australian selection and a provider mismatch before proofing", async () => {
  process.env.TLINK_ADDRESS_AUTOCOMPLETE_ENDPOINT = "https://places.googleapis.com/v1/places:autocomplete";
  process.env.TLINK_ADDRESS_AUTOCOMPLETE_TOKEN = "test-key";
  let requests = 0;
  globalThis.fetch = async () => {
    requests += 1;
    return Response.json({
      id: "overseas-place",
      formattedAddress: "127 Queen Street, Auckland 1010, New Zealand",
      addressComponents: googleComponents("NZ"),
    });
  };

  await assert.rejects(
    resolveAustralianAddressSuggestion({
      provider: "google-places",
      providerReference: "overseas-place",
      query: "127 Queen Street",
    }),
    (error) => error instanceof AddressSuggestionSelectionError
      && /Australian street address/.test(error.message),
  );
  await assert.rejects(
    resolveAustralianAddressSuggestion({
      provider: "addresses.example.test",
      providerReference: "overseas-place",
      query: "127 Queen Street",
    }),
    AddressSuggestionSelectionError,
  );
  assert.equal(requests, 1);
});

test("Google session tokens are optional but reject non-URL-safe or overlong values", async () => {
  process.env.TLINK_ADDRESS_AUTOCOMPLETE_ENDPOINT = "https://places.googleapis.com/v1/places:autocomplete";
  process.env.TLINK_ADDRESS_AUTOCOMPLETE_TOKEN = "test-key";
  globalThis.fetch = async () => {
    throw new Error("invalid sessions should be rejected before a request");
  };

  for (const invalid of ["contains spaces", "a".repeat(37), "slashes/are/not/safe"]) {
    await assert.rejects(
      fetchAustralianAddressSuggestions("127 Collins", { sessionToken: invalid }),
      AddressSuggestionSelectionError,
    );
  }
});

test("the shared POST parser enforces both actions, session syntax and the one kilobyte body limit", async () => {
  assert.deepEqual(await readAddressSuggestionAction(new Request(
    "https://example.test/api/address-suggestions",
    {
      method: "POST",
      body: JSON.stringify({ action: "predict", query: "127 Collins", sessionToken }),
    },
  )), {
    action: "predict",
    query: "127 Collins",
    sessionToken,
  });
  assert.deepEqual(await readAddressSuggestionAction(new Request(
    "https://example.test/api/address-suggestions",
    {
      method: "POST",
      body: JSON.stringify({
        action: "resolve",
        provider: "google-places",
        providerReference: "melbourne-place",
        query: "127 Collins",
        sessionToken,
      }),
    },
  )), {
    action: "resolve",
    provider: "google-places",
    providerReference: "melbourne-place",
    query: "127 Collins",
    sessionToken,
  });

  await assert.rejects(
    readAddressSuggestionAction(new Request("https://example.test/api/address-suggestions", {
      method: "POST",
      body: JSON.stringify({ action: "predict", query: "127 Collins", sessionToken: "not safe" }),
    })),
    /ADDRESS_ACTION_INVALID/,
  );
  await assert.rejects(
    readAddressSuggestionAction(new Request("https://example.test/api/address-suggestions", {
      method: "POST",
      body: JSON.stringify({ action: "predict", query: "x".repeat(1_024) }),
    })),
    /ADDRESS_BODY_INVALID/,
  );
  await assert.rejects(
    readAddressSuggestionAction(new Request("https://example.test/api/address-suggestions", {
      method: "POST",
      body: "null",
    })),
    /ADDRESS_ACTION_INVALID/,
  );
});

test("a provider-neutral endpoint remains header-authenticated and resolves the selected ID", async () => {
  process.env.TLINK_ADDRESS_AUTOCOMPLETE_ENDPOINT = "https://addresses.example.test/predict";
  process.env.TLINK_ADDRESS_AUTOCOMPLETE_TOKEN = "provider-token";
  let requests = 0;
  globalThis.fetch = async (input, init) => {
    requests += 1;
    const url = new URL(String(input));
    const headers = new Headers(init?.headers);
    assert.equal(url.searchParams.get("query"), "10 Main");
    assert.equal(url.searchParams.get("country"), "AU");
    assert.equal(url.searchParams.has("key"), false);
    assert.equal(headers.get("Authorization"), "Bearer provider-token");
    return Response.json({
      suggestions: [
        {
          id: "address-1",
          label: "10 Main Street, Hobart TAS 7000, Australia",
          addressLine1: "10 Main Street",
          suburb: "Hobart",
          state: "TAS",
          postcode: "7000",
          country: "AU",
        },
        {
          id: "address-2",
          label: "10 Main Street, Wellington, New Zealand",
          addressLine1: "10 Main Street",
          suburb: "Wellington",
          state: "",
          postcode: "6011",
          country: "NZ",
        },
      ],
    });
  };

  assert.deepEqual((await fetchAustralianAddressSuggestions("10 Main")).predictions, [{
    id: "address-1",
    label: "10 Main Street, Hobart TAS 7000, Australia",
    provider: "addresses.example.test",
  }]);
  const resolved = await resolveAustralianAddressSuggestion({
    provider: "addresses.example.test",
    providerReference: "address-1",
    query: "10 Main",
  });
  assert.equal(resolved.selection?.postcode, "7000");
  assert.equal(resolved.selection?.provider, "addresses.example.test");
  assert.equal(requests, 2);
});

test("the legacy Google geocoding endpoint keeps compatibility without a credential query parameter", async () => {
  process.env.TLINK_ADDRESS_AUTOCOMPLETE_ENDPOINT = "https://maps.googleapis.com/maps/api/geocode/json";
  process.env.TLINK_ADDRESS_AUTOCOMPLETE_TOKEN = "legacy-key";
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    const headers = new Headers(init?.headers);
    assert.equal(url.searchParams.has("key"), false);
    assert.equal(headers.get("X-Goog-Api-Key"), "legacy-key");
    if (url.searchParams.has("place_id")) {
      assert.equal(url.searchParams.get("place_id"), "legacy-place");
    } else {
      assert.equal(url.searchParams.get("address"), "127 Collins");
      assert.equal(url.searchParams.get("components"), "country:AU");
    }
    return Response.json({
      status: "OK",
      results: [{
        place_id: "legacy-place",
        formatted_address: "127 Collins Street, Melbourne VIC 3000, Australia",
        address_components: googleComponents().map((component) => ({
          long_name: component.longText,
          short_name: component.shortText,
          types: component.types,
        })),
      }],
    });
  };

  assert.equal(
    (await fetchAustralianAddressSuggestions("127 Collins")).predictions[0]?.provider,
    "google-geocoding",
  );
  assert.equal((await resolveAustralianAddressSuggestion({
    provider: "google-geocoding",
    providerReference: "legacy-place",
    query: "127 Collins",
  })).selection?.addressState, "VIC");
});

test("provider failures expose one bounded manual-entry error", async () => {
  process.env.TLINK_ADDRESS_AUTOCOMPLETE_ENDPOINT = "https://places.googleapis.com/v1/places:autocomplete";
  process.env.TLINK_ADDRESS_AUTOCOMPLETE_TOKEN = "provider-token";
  globalThis.fetch = async () => Response.json({
    error: {
      code: 403,
      status: "permission denied\n<script>",
      message: "Secret provider detail must not cross the public boundary.",
      details: [{
        reason: "api key service blocked\r\nsecret",
        metadata: { credential: "must-not-be-logged" },
      }],
    },
  }, { status: 403 });

  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warnings.push(args);

  try {
    await assert.rejects(
      fetchAustralianAddressSuggestions("10 Main"),
      (error) => error instanceof AddressSuggestionProviderError
        && error.message === "Address suggestions are temporarily unavailable."
        && error.providerStatus === 403
        && error.providerCode === ""
        && error.providerReason === "",
    );
  } finally {
    console.warn = originalWarn;
  }
  assert.deepEqual(warnings, [[
    "Address suggestion provider rejected a request",
    {
      providerStatus: 403,
      providerCode: "UNKNOWN",
      providerReason: "UNKNOWN",
    },
  ]]);
  assert.doesNotMatch(
    JSON.stringify(warnings),
    /Secret provider detail|must-not-be-logged|script|secret/i,
  );

  const knownProviderError = new AddressSuggestionProviderError(undefined, {
    providerStatus: 403,
    providerCode: "PERMISSION_DENIED",
    providerReason: "API_KEY_SERVICE_BLOCKED",
  });
  assert.equal(knownProviderError.providerCode, "PERMISSION_DENIED");
  assert.equal(knownProviderError.providerReason, "API_KEY_SERVICE_BLOCKED");
});

test("provider transport failures expose only a bounded runtime class", async () => {
  process.env.TLINK_ADDRESS_AUTOCOMPLETE_ENDPOINT = "https://places.googleapis.com/v1/places:autocomplete";
  process.env.TLINK_ADDRESS_AUTOCOMPLETE_TOKEN = "provider-token";
  globalThis.fetch = async () => {
    throw new TypeError("Network detail and query must not cross the boundary.");
  };

  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warnings.push(args);
  try {
    await assert.rejects(
      fetchAustralianAddressSuggestions("10 Main"),
      (error) => error instanceof AddressSuggestionProviderError
        && error.providerStatus === 0
        && error.providerCode === "FETCH_FAILED"
        && error.providerReason === "TYPEERROR",
    );
  } finally {
    console.warn = originalWarn;
  }
  assert.deepEqual(warnings, [[
    "Address suggestion provider request failed",
    { providerCode: "FETCH_FAILED", providerReason: "TYPEERROR" },
  ]]);
  assert.doesNotMatch(JSON.stringify(warnings), /Network detail|10 Main/);
});

test("provider and selection guards survive duplicated bundle class identities", () => {
  assert.equal(isAddressSuggestionProviderError({
    name: "AddressSuggestionProviderError",
    message: "Address suggestions are temporarily unavailable.",
    providerStatus: 0,
    providerCode: "FETCH_FAILED",
    providerReason: "TYPEERROR",
  }), true);
  assert.equal(isAddressSuggestionProviderError({
    name: "AddressSuggestionProviderError",
    message: "Address suggestions are temporarily unavailable.",
    providerStatus: 0,
    providerCode: "FETCH_FAILED\nINJECTED",
    providerReason: "TYPEERROR",
  }), false);
  assert.equal(isAddressSuggestionSelectionError({
    name: "AddressSuggestionSelectionError",
    message: "This address could not be resolved.",
  }), true);
});

test("the public provider boundary requires an explicit matching browser origin", () => {
  const url = "https://example.test/api/address-suggestions";
  assert.equal(acceptedAddressSuggestionOrigin(new Request(url)), false);
  assert.equal(acceptedAddressSuggestionOrigin(new Request(url, {
    headers: { Origin: "https://attacker.example" },
  })), false);
  assert.equal(acceptedAddressSuggestionOrigin(new Request(url, {
    headers: { Origin: "https://example.test" },
  })), true);
});

test("reviewed field technicians without job-creation permission can predict and resolve addresses", async () => {
  const route = compileTradeRoute({
    access: {
      ownerUid: "installer-owner",
      actorUid: "field-member:technician-1",
      memberId: "technician-1",
      fieldSessionId: "field-session-1",
      isOwner: false,
      jobScope: "own",
      canCreateJobs: false,
    },
  });

  const predictionResponse = await route.POST(tradeAddressRequest("predict"));
  assert.equal(predictionResponse.status, 200);
  assert.deepEqual((await predictionResponse.json()).predictions, [{
    id: "place-runtime",
    label: "1 Runtime Way, Brisbane QLD 4000",
    provider: "google-places",
  }]);

  const resolveResponse = await route.POST(tradeAddressRequest("resolve"));
  assert.equal(resolveResponse.status, 200);
  assert.equal(
    (await resolveResponse.json()).selection.selectionProof,
    "proof-for:installer-owner",
  );
});

test("the authenticated address route denies unauthenticated, unreviewed and cross-tenant callers", async () => {
  for (const [code, expectedStatus] of [
    ["AUTH_REQUIRED", 401],
    ["ABN_REVIEW_REQUIRED", 403],
    ["TEAM_ACCESS_RECORD_REQUIRED", 403],
  ]) {
    const response = await compileTradeRoute({ accessError: code }).POST(
      tradeAddressRequest("predict"),
    );
    assert.equal(response.status, expectedStatus, code);
    assert.equal((await response.json()).ok, false, code);
  }
});

test("the authenticated address route fails closed before a paid provider call when throttling is unavailable or exceeded", async () => {
  const access = {
    ownerUid: "installer-owner",
    actorUid: "field-member:technician-1",
  };
  const unavailable = await compileTradeRoute({
    access,
    rateLimit: { allowed: false, unavailable: true },
  }).POST(tradeAddressRequest("predict"));
  assert.equal(unavailable.status, 503);
  assert.equal(unavailable.headers.get("Retry-After"), "60");

  const exceeded = await compileTradeRoute({
    access,
    rateLimit: { allowed: false, retryAfterSeconds: 17 },
  }).POST(tradeAddressRequest("predict"));
  assert.equal(exceeded.status, 429);
  assert.equal(exceeded.headers.get("Retry-After"), "17");
});

test("the same-origin POST routes and lookup preserve privacy, proof, throttling and accessibility boundaries", () => {
  for (const route of [publicRoute, tradeRoute]) {
    assert.match(route, /readAddressSuggestionAction\(request\)/);
    assert.match(route, /fetchAustralianAddressSuggestions/);
    assert.match(route, /resolveAustralianAddressSuggestion/);
  }
  assert.match(publicRoute, /acceptedAddressSuggestionOrigin\(request\)/);
  assert.match(tradeRoute, /sameOrigin\(request\)/);
  assert.match(tradeRoute, /access = await requireInstallerTeamAccess\(request\)/);
  assert.doesNotMatch(tradeRoute, /canCreateJobs|ADDRESS_ACCESS_REQUIRED/);
  assert.match(tradeRoute, /WINDOW_LIMIT = 80/);
  assert.match(tradeRoute, /createSharedLeadRateLimiter/);
  assert.match(tradeRoute, /getDatabase: getD1/);
  assert.match(tradeRoute, /trade-address-suggestion:\$\{access\.ownerUid\}:\$\{access\.actorUid\}/);
  assert.match(tradeRoute, /rateLimit\.unavailable/);
  assert.match(provider, /ADDRESS_SUGGESTION_MAX_BODY_BYTES = 1_024/);
  assert.match(provider, /new TextEncoder\(\)\.encode\(text\)\.byteLength/);
  assert.match(provider, /action: "predict"/);
  assert.match(provider, /action: "resolve"/);
  assert.match(provider, /\^\[A-Za-z0-9_-\]\{1,36\}\$/);
  assert.match(publicRoute, /WINDOW_LIMIT = 40/);
  assert.match(publicRoute, /createSharedLeadRateLimiter/);
  assert.match(publicRoute, /getDatabase: getD1/);
  assert.match(publicRoute, /rateLimit\.unavailable/);
  assert.doesNotMatch(publicRoute, /new Map/);
  assert.match(publicRoute, /Cache-Control": "no-store"/);
  assert.doesNotMatch(publicRoute, /selectionProof|CRM_INTEGRATION_ENCRYPTION_KEY|TLINK_ADDRESS_AUTOCOMPLETE_TOKEN/);
  assert.match(publicRoute, /X-Address-Provider-Status/);
  assert.match(publicRoute, /X-Address-Provider-Code/);
  assert.match(publicRoute, /X-Address-Provider-Reason/);
  assert.ok(
    tradeRoute.indexOf("resolveAustralianAddressSuggestion(action)")
      < tradeRoute.indexOf("issueTradeAddressSelectionProof(result.selection"),
  );
  assert.match(tradeRoute, /selectionProof:/);
  assert.doesNotMatch(provider, /searchParams\.set\("key"/);
  assert.doesNotMatch(lookup, /TLINK_ADDRESS_AUTOCOMPLETE_TOKEN|X-Goog-Api-Key/);
  assert.match(lookup, /action: "predict"/);
  assert.match(lookup, /action: "resolve"/);
  assert.match(lookup, /globalThis\.crypto\.randomUUID\(\)/);
  assert.match(lookup, /sessionToken: requestSessionToken/);
  assert.match(lookup, /sessionToken\.current = ""/);
  assert.match(lookup, /controller\.abort\(\)/);
  assert.match(lookup, /role="combobox"/);
  assert.match(lookup, /maxLength = 140/);
  assert.match(lookup, /maxLength\?: number/);
  assert.match(lookup, /maxLength=\{maxLength\}/);
  assert.match(lookup, /role="listbox"/);
  assert.match(lookup, /event\.key === "ArrowDown"/);
  assert.match(lookup, /event\.key === "Enter"/);
  assert.match(lookup, /aria-live="polite"/);
  assert.match(lookup, /Resolving selected address\./);
  assert.match(lookup, /className=\{styles\.attribution\}/);
  assert.match(lookup, /translate="no">Google Maps/);
  assert.match(addressStyles, /\.attribution \{[\s\S]*color: #5e5e5e;[\s\S]*font-family: Roboto, Arial, sans-serif;[\s\S]*font-weight: 400;[\s\S]*opacity: 1;[\s\S]*white-space: nowrap;/);
  assert.match(lookup, /Enter the address manually/);
});
