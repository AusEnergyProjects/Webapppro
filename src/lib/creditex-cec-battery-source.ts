import {
  CREDITEX_CEC_BATTERY_ALL_MINIMUM_RECORDS,
  CREDITEX_CEC_BATTERY_ARTIFACT_CONTRACT,
  CREDITEX_CEC_BATTERY_ARTIFACT_MAXIMUM_BYTES,
  CREDITEX_CEC_BATTERY_REGISTRY_CODE,
  CREDITEX_CEC_BATTERY_RESPONSE_MAXIMUM_BYTES,
  CREDITEX_CEC_BATTERY_SOURCE_KEY,
  parseCreditexCecBatteryArtifact,
  type CreditexCecBatteryArtifact,
} from "./creditex-cec-battery-parser.ts";
import type {
  CreditexFetchedOfficialProductSource,
  CreditexOfficialProductFetch,
  CreditexOfficialProductRegistryDefinition,
  CreditexOfficialProductSourceDefinition,
} from "./creditex-official-product-registry-server.ts";

export const CREDITEX_CEC_BATTERY_ALL_RECORDS_URL =
  "https://CleanEnergyCouncil1325.jitterbit.cc/production/1.0/batteryListing" as const;
export const CREDITEX_CEC_BATTERY_CURRENT_RECORDS_URL =
  `${CREDITEX_CEC_BATTERY_ALL_RECORDS_URL}?Year=Current` as const;
export const CREDITEX_CEC_DATA_LICENCE_URL =
  "https://cleanenergycouncil.org.au/industry-programs/data" as const;

const JSON_CONTENT_TYPES = ["application/json", "text/json"] as const;

export type CreditexLicensedCecBatteryCredentials = Readonly<{
  username: string;
  password: string;
  licenceReference: string;
}>;

function sourceError(message: string): never {
  throw new Error(`CEC licensed battery acquisition failed: ${message}`);
}

function boundedCredential(
  value: unknown,
  label: string,
  maximum: number,
  allowColon: boolean,
) {
  if (typeof value !== "string" || value.length < 1 || value.length > maximum) {
    return sourceError(`${label} is not configured`);
  }
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code < 0x20 || code > 0x7e || (!allowColon && character === ":")) {
      return sourceError(`${label} contains unsupported characters`);
    }
  }
  return value;
}

function licenceReference(value: unknown) {
  if (
    typeof value !== "string"
    || value.trim().length < 3
    || value.trim().length > 200
    || /[\u0000-\u001f\u007f]/.test(value)
  ) {
    return sourceError("licence reference is not configured");
  }
  return value.trim();
}

function basicAuthorization(username: string, password: string) {
  return `Basic ${btoa(`${username}:${password}`)}`;
}

async function boundedJsonText(
  fetchImpl: CreditexOfficialProductFetch,
  url: string,
  authorization: string,
  label: string,
) {
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "GET",
      cache: "no-store",
      redirect: "manual",
      headers: {
        Accept: "application/json",
        Authorization: authorization,
      },
    });
  } catch {
    return sourceError(`${label} could not be fetched`);
  }
  if (response.status >= 300 && response.status < 400) {
    return sourceError(`${label} redirected unexpectedly`);
  }
  if (!response.ok) {
    return sourceError(`${label} returned HTTP ${response.status}`);
  }
  const contentType = (response.headers.get("content-type") || "")
    .split(";", 1)[0]
    .trim()
    .toLowerCase();
  if (!JSON_CONTENT_TYPES.includes(
    contentType as (typeof JSON_CONTENT_TYPES)[number],
  )) {
    return sourceError(`${label} returned an unexpected content type`);
  }
  const declared = Number(response.headers.get("content-length") || 0);
  if (
    Number.isFinite(declared)
    && declared > CREDITEX_CEC_BATTERY_RESPONSE_MAXIMUM_BYTES
  ) {
    return sourceError(`${label} exceeded its byte limit`);
  }
  if (!response.body) return sourceError(`${label} returned no body`);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let exceededByteLimit = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > CREDITEX_CEC_BATTERY_RESPONSE_MAXIMUM_BYTES) {
        await reader.cancel().catch(() => undefined);
        exceededByteLimit = true;
        break;
      }
      chunks.push(value);
    }
  } catch {
    return sourceError(`${label} body could not be read`);
  }
  if (exceededByteLimit) {
    return sourceError(`${label} exceeded its byte limit`);
  }
  if (total < 1) return sourceError(`${label} returned an empty body`);
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return sourceError(`${label} is not UTF-8`);
  }
  const roundTrip = new TextEncoder().encode(text);
  if (
    roundTrip.byteLength !== bytes.byteLength
    || roundTrip.some((byte, index) => byte !== bytes[index])
  ) {
    return sourceError(`${label} has an unsupported byte representation`);
  }
  return text;
}

async function fetchCreditexLicensedCecBatterySources(
  fetchImpl: CreditexOfficialProductFetch,
  authorization: string,
): Promise<readonly CreditexFetchedOfficialProductSource[]> {
  const [allRecordsResponse, currentRecordsResponse] = await Promise.all([
    boundedJsonText(
      fetchImpl,
      CREDITEX_CEC_BATTERY_ALL_RECORDS_URL,
      authorization,
      "all-record endpoint",
    ),
    boundedJsonText(
      fetchImpl,
      CREDITEX_CEC_BATTERY_CURRENT_RECORDS_URL,
      authorization,
      "current-record endpoint",
    ),
  ]);
  const artifact: CreditexCecBatteryArtifact = {
    contract: CREDITEX_CEC_BATTERY_ARTIFACT_CONTRACT,
    sourceKey: CREDITEX_CEC_BATTERY_SOURCE_KEY,
    capturedAt: new Date().toISOString(),
    allRecordsResponse,
    currentRecordsResponse,
  };
  const bytes = new TextEncoder().encode(JSON.stringify(artifact));
  if (bytes.byteLength > CREDITEX_CEC_BATTERY_ARTIFACT_MAXIMUM_BYTES) {
    return sourceError("combined evidence artifact exceeded its byte limit");
  }
  return [{
    sourceKey: CREDITEX_CEC_BATTERY_SOURCE_KEY,
    contentType: "application/json",
    bytes,
  }];
}

export function createCreditexLicensedCecBatteryProductRegistry(
  credentials: CreditexLicensedCecBatteryCredentials,
): CreditexOfficialProductRegistryDefinition {
  const username = boundedCredential(
    credentials?.username,
    "username",
    200,
    false,
  );
  const password = boundedCredential(
    credentials?.password,
    "password",
    500,
    true,
  );
  const licence = licenceReference(credentials?.licenceReference);
  const authorization = basicAuthorization(username, password);
  const source: CreditexOfficialProductSourceDefinition = {
    registryCode: CREDITEX_CEC_BATTERY_REGISTRY_CODE,
    sourceKey: CREDITEX_CEC_BATTERY_SOURCE_KEY,
    productKind: "cec_battery",
    url: CREDITEX_CEC_BATTERY_ALL_RECORDS_URL,
    minimumRecords: CREDITEX_CEC_BATTERY_ALL_MINIMUM_RECORDS,
    maximumBytes: CREDITEX_CEC_BATTERY_ARTIFACT_MAXIMUM_BYTES,
    expectedContentTypes: ["application/json"],
    accept: "application/json",
    licence: [
      "Clean Energy Council licensed Battery Listing API",
      licence,
      CREDITEX_CEC_DATA_LICENCE_URL,
    ].join(" | "),
    productionMode: "automatic",
    requiresOfficialEligibleFrom: true,
    parse: parseCreditexCecBatteryArtifact,
  };
  return {
    registryCode: CREDITEX_CEC_BATTERY_REGISTRY_CODE,
    title: "Clean Energy Council licensed approved batteries",
    sources: [source],
    fetchSources: (fetchImpl) => fetchCreditexLicensedCecBatterySources(
      fetchImpl,
      authorization,
    ),
  };
}
