import type {
  CreditexFetchedOfficialProductSource,
  CreditexOfficialProductFetch,
  CreditexOfficialProductSourceAcquisitionContext,
  CreditexOfficialProductSourceAcquisitionResult,
  CreditexOfficialProductSourceDefinition,
} from "./creditex-official-product-registry-server.ts";
import {
  CREDITEX_PRODUCT_REGISTRY_FLEET_LEASE_CODE,
  CreditexOfficialProductError,
} from "./creditex-official-product-registry.ts";
import {
  CREDITEX_VEU_CATEGORY_PRODUCT_KIND,
  CREDITEX_VEU_BOUNDED_STREAM_ARTIFACT_CONTRACT,
  CREDITEX_VEU_DATASET_ID,
  CREDITEX_VEU_DIM_PRODUCT_SCHEMA,
  CREDITEX_VEU_MODEL_ID,
  CREDITEX_VEU_STREAMING_PARSER,
  CREDITEX_VEU_PRODUCT_KINDS,
  CREDITEX_VEU_PUBLIC_REGISTRY_SOURCE_KEY,
  CREDITEX_VEU_QUERY_FIELDS,
  CREDITEX_VEU_QUERY_FIELD_TYPES,
  CREDITEX_VEU_REFRESH_SCHEMA,
  CREDITEX_VEU_REPORT_ID,
  CREDITEX_VEU_SUPPLEMENTAL_QUERIES,
  decodeCreditexVeuPowerBiAggregateCount,
  decodeCreditexVeuPowerBiGroupedCounts,
  decodeCreditexVeuPowerBiProductPage,
  decodeCreditexVeuPowerBiRefreshTimestamp,
  parseCreditexVeuProductArtifact,
  validateCreditexVeuPowerBiModel,
  validateCreditexVeuPowerBiSchema,
} from "./creditex-veu-product-parser.ts";

const VEU_PUBLIC_REGISTRY_URL =
  "https://veu.esc.vic.gov.au/vpr/s/public-registry";
const VEU_AURA_URL = "https://veu.esc.vic.gov.au/vpr/s/sfsites/aura";
const VEU_REPORT_WORKSPACE_ID = "7895247f-ddd9-458d-9e32-55d97b550e34";
const VEU_DATASET_WORKSPACE_ID = "5bd343ff-dbe9-4093-8f4c-23f3756f99a7";
const VEU_AURA_APP = "siteforce:communityApp";
const VEU_AURA_LOADED_KEY =
  "APPLICATION@markup://siteforce:communityApp";
const VEU_PAGE_URI = "/vpr/s/public-registry";
// Keep the official Power BI request count within the calculator's bounded
// on-demand recovery budget. Responses are still capped at 4 MiB, the retained
// artifact writer is fixed at 32 MiB, and parsing/D1 writes remain chunked at
// 500 rows.
export const CREDITEX_VEU_PAGE_SIZE = 5_000;
export const CREDITEX_VEU_MAX_PAGES = 200;
export const CREDITEX_VEU_ARTIFACT_MAXIMUM_BYTES = 32_000_000;
export const CREDITEX_VEU_SUPPLEMENTAL_FETCH_CONCURRENCY = 4;
export const CREDITEX_VEU_SUPPLEMENTAL_BUFFER_MAXIMUM_BYTES = 8_000_000;
export const CREDITEX_VEU_DURABLE_ACQUISITION_MAX_NEW_RESPONSES = 12;
export const CREDITEX_VEU_DURABLE_ACQUISITION_MAX_CURRENT_SCALE_QUANTA = 6;
export const CREDITEX_VEU_DURABLE_ASSEMBLY_MAX_RECORDS_PER_QUANTUM = 18;
const VEU_SOURCE_FRESHNESS_MS = 48 * 60 * 60 * 1_000;
const VEU_FUTURE_TOLERANCE_MS = 10 * 60 * 1_000;
const VEU_SOURCE_ACQUISITION_CONTRACT =
  "creditex-official-product-source-acquisition/v1";

const TEXT_HTML = ["text/html"] as const;
const JSON_CONTENT = ["application/json", "text/json"] as const;

type JsonObject = Record<string, unknown>;

class BoundedVeuArtifactWriter {
  private readonly bytes = new Uint8Array(
    CREDITEX_VEU_ARTIFACT_MAXIMUM_BYTES,
  );
  private readonly encoder = new TextEncoder();
  private offset = 0;

  private write(text: string) {
    let remaining = text;
    while (remaining.length > 0) {
      const result = this.encoder.encodeInto(
        remaining,
        this.bytes.subarray(this.offset),
      );
      if (result.read === 0 || result.written === 0) {
        return sourceError("VEU evidence artifact exceeded its reviewed byte limit");
      }
      this.offset += result.written;
      remaining = remaining.slice(result.read);
    }
  }

  private writeString(value: string) {
    this.write('"');
    let start = 0;
    for (let index = 0; index < value.length; index += 1) {
      const code = value.charCodeAt(index);
      let escaped = "";
      if (code === 0x22) escaped = '\\"';
      else if (code === 0x5c) escaped = "\\\\";
      else if (code === 0x08) escaped = "\\b";
      else if (code === 0x0c) escaped = "\\f";
      else if (code === 0x0a) escaped = "\\n";
      else if (code === 0x0d) escaped = "\\r";
      else if (code === 0x09) escaped = "\\t";
      else if (code < 0x20) escaped = `\\u${code.toString(16).padStart(4, "0")}`;
      if (!escaped) continue;
      if (index > start) this.write(value.slice(start, index));
      this.write(escaped);
      start = index + 1;
    }
    if (start < value.length) this.write(value.slice(start));
    this.write('"');
  }

  private writeJson(value: unknown): void {
    if (value === null) {
      this.write("null");
      return;
    }
    if (typeof value === "string") {
      this.writeString(value);
      return;
    }
    if (typeof value === "number") {
      if (!Number.isFinite(value)) return sourceError("VEU evidence contains a non-finite number");
      this.write(String(value));
      return;
    }
    if (typeof value === "boolean") {
      this.write(value ? "true" : "false");
      return;
    }
    if (Array.isArray(value)) {
      this.write("[");
      value.forEach((item, index) => {
        if (index > 0) this.write(",");
        this.writeJson(item);
      });
      this.write("]");
      return;
    }
    if (typeof value === "object") {
      this.write("{");
      let index = 0;
      for (const [key, item] of Object.entries(value)) {
        if (item === undefined) continue;
        if (index > 0) this.write(",");
        this.writeString(key);
        this.write(":");
        this.writeJson(item);
        index += 1;
      }
      this.write("}");
      return;
    }
    return sourceError("VEU evidence contains an unsupported JSON value");
  }

  append(record: unknown) {
    this.writeJson(record);
    this.write("\n");
  }

  finish() {
    if (this.offset < 1) return sourceError("VEU evidence artifact is empty");
    return this.bytes.subarray(0, this.offset);
  }
}

type AuraContext = Readonly<{
  mode: "PROD";
  fwuid: string;
  app: typeof VEU_AURA_APP;
  loaded: Readonly<Record<typeof VEU_AURA_LOADED_KEY, string>>;
  dn: readonly [];
  globals: Readonly<Record<string, never>>;
  uad: true;
}>;

function sourceError(message: string): never {
  throw new Error(`VEU public registry acquisition failed: ${message}`);
}

function isVeuSourceError(error: unknown): error is Error {
  return error instanceof Error
    && error.message.startsWith("VEU public registry acquisition failed:");
}

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requiredObject(value: unknown, label: string): JsonObject {
  if (!isObject(value)) return sourceError(`${label} is not an object`);
  return value;
}

function requiredArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) return sourceError(`${label} is not an array`);
  return value;
}

function requiredText(value: unknown, label: string, maximum = 10_000) {
  if (
    typeof value !== "string"
    || value.length < 1
    || value.length > maximum
  ) {
    return sourceError(`${label} is not bounded text`);
  }
  return value;
}

function parseJson(text: string, label: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return sourceError(`${label} is not valid JSON`);
  }
}

class BoundedCookieJar {
  private readonly values = new Map<string, string>();

  capture(headers: Headers) {
    const extended = headers as Headers & { getSetCookie?: () => string[] };
    const values = extended.getSetCookie?.()
      || (headers.get("set-cookie")
        ? headers.get("set-cookie")!.split(
            /,(?=\s*[!#$%&'*+.^_`|~0-9A-Za-z-]+=)/,
          )
        : []);
    for (const header of values) {
      const pair = header.split(";", 1)[0].trim();
      const separator = pair.indexOf("=");
      if (separator < 1 || pair.length > 4_096 || /[\r\n]/.test(pair)) {
        return sourceError("Salesforce returned an invalid session cookie");
      }
      const name = pair.slice(0, separator);
      const value = pair.slice(separator + 1);
      if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name)) {
        return sourceError("Salesforce returned an invalid cookie name");
      }
      this.values.set(name, value);
    }
    if (this.values.size > 20) {
      return sourceError("Salesforce returned too many session cookies");
    }
  }

  header() {
    return [...this.values.entries()]
      .map(([name, value]) => `${name}=${value}`)
      .join("; ");
  }
}

async function boundedTextResponse(
  response: Response,
  label: string,
  maximumBytes: number,
  expectedContentTypes: readonly string[],
) {
  if (response.status >= 300 && response.status < 400) {
    return sourceError(`${label} redirected unexpectedly`);
  }
  if (!response.ok) return sourceError(`${label} returned HTTP ${response.status}`);
  const contentType = (response.headers.get("content-type") || "")
    .split(";", 1)[0]
    .trim()
    .toLowerCase();
  if (!expectedContentTypes.includes(contentType)) {
    return sourceError(`${label} returned content type ${contentType || "none"}`);
  }
  const declared = Number(response.headers.get("content-length") || 0);
  if (Number.isFinite(declared) && declared > maximumBytes) {
    return sourceError(`${label} exceeded its byte limit`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength < 1 || bytes.byteLength > maximumBytes) {
    return sourceError(`${label} returned an invalid byte count`);
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return sourceError(`${label} is not UTF-8`);
  }
}

async function fetchSalesforceText(
  fetchImpl: CreditexOfficialProductFetch,
  jar: BoundedCookieJar,
  url: string,
  init: RequestInit,
  label: string,
  maximumBytes: number,
  expectedContentTypes: readonly string[],
) {
  const cookie = jar.header();
  const headers = new Headers(init.headers);
  if (cookie) headers.set("Cookie", cookie);
  const response = await fetchImpl(url, {
    ...init,
    cache: "no-store",
    redirect: "manual",
    headers,
  });
  jar.capture(response.headers);
  return boundedTextResponse(
    response,
    label,
    maximumBytes,
    expectedContentTypes,
  );
}

function auraContext(html: string): AuraContext {
  const candidates = new Map<string, AuraContext>();
  const pattern = /\/vpr\/s\/sfsites\/l\/([^/"?]+)\/inline\.js/g;
  for (const match of html.matchAll(pattern)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(decodeURIComponent(match[1])) as unknown;
    } catch {
      continue;
    }
    if (!isObject(parsed) || parsed.mode !== "PROD" || parsed.app !== VEU_AURA_APP) {
      continue;
    }
    const loaded = requiredObject(parsed.loaded, "Aura loaded modules");
    const application = loaded[VEU_AURA_LOADED_KEY];
    if (typeof parsed.fwuid !== "string" || !parsed.fwuid || typeof application !== "string" || !application) {
      continue;
    }
    const context: AuraContext = {
      mode: "PROD",
      fwuid: parsed.fwuid,
      app: VEU_AURA_APP,
      loaded: { [VEU_AURA_LOADED_KEY]: application },
      dn: [],
      globals: {},
      uad: true,
    };
    candidates.set(JSON.stringify(context), context);
  }
  if (candidates.size !== 1) {
    return sourceError("Salesforce Aura bootstrap context changed");
  }
  return [...candidates.values()][0];
}

async function auraAction(
  fetchImpl: CreditexOfficialProductFetch,
  jar: BoundedCookieJar,
  context: AuraContext,
  requestNumber: number,
  classname: string,
  method: string,
  params: JsonObject,
) {
  const body = new URLSearchParams();
  body.set("message", JSON.stringify({
    actions: [{
      id: "1;a",
      descriptor: "aura://ApexActionController/ACTION$execute",
      callingDescriptor: "UNKNOWN",
      params: {
        namespace: "",
        classname,
        method,
        params,
        cacheable: false,
        isContinuation: false,
      },
    }],
  }));
  body.set("aura.context", JSON.stringify(context));
  body.set("aura.pageURI", VEU_PAGE_URI);
  body.set("aura.token", "null");
  const raw = await fetchSalesforceText(
    fetchImpl,
    jar,
    `${VEU_AURA_URL}?r=${requestNumber}&aura.ApexAction.execute=1`,
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
      },
      body: body.toString(),
    },
    "Salesforce Aura action",
    1_000_000,
    JSON_CONTENT,
  );
  const document = requiredObject(parseJson(raw, "Aura response"), "Aura response");
  const actions = requiredArray(document.actions, "Aura actions");
  if (actions.length !== 1) return sourceError("Aura action count changed");
  const action = requiredObject(actions[0], "Aura action");
  const errors = requiredArray(action.error, "Aura action errors");
  if (action.state !== "SUCCESS" || errors.length !== 0) {
    return sourceError("Aura action did not succeed");
  }
  const outer = requiredObject(action.returnValue, "Aura outer return value");
  return outer.returnValue;
}

function urlSafeBase64Json(value: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(value) || value.length > 20_000) {
    return sourceError("Power BI embed config is invalid");
  }
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/")
    + "=".repeat((4 - (value.length % 4)) % 4);
  let decoded: string;
  try {
    const binary = atob(base64);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return sourceError("Power BI embed config could not be decoded");
  }
  return requiredObject(parseJson(decoded, "Power BI embed config"), "Power BI embed config");
}

function embeddingData(value: unknown) {
  const embed = requiredObject(value, "Power BI embedding data");
  const embedToken = requiredText(embed.embedToken, "Power BI embed token", 20_000);
  const expires = new Date(requiredText(
    embed.embedTokenExpires,
    "Power BI embed token expiry",
    100,
  ));
  if (Number.isNaN(expires.getTime()) || expires.getTime() <= Date.now() + 60_000) {
    return sourceError("Power BI embed token is not current");
  }
  if (
    embed.reportId !== CREDITEX_VEU_REPORT_ID
    || embed.workspaceId !== VEU_REPORT_WORKSPACE_ID
  ) {
    return sourceError("Power BI embedding identity changed");
  }
  const embedUrl = new URL(requiredText(embed.embedUrl, "Power BI embed URL", 10_000));
  if (
    embedUrl.protocol !== "https:"
    || embedUrl.hostname.toLowerCase() !== "app.powerbi.com"
    || embedUrl.pathname !== "/reportEmbed"
    || embedUrl.searchParams.get("reportId") !== CREDITEX_VEU_REPORT_ID
    || embedUrl.searchParams.get("groupId") !== VEU_REPORT_WORKSPACE_ID
  ) {
    return sourceError("Power BI embed URL changed");
  }
  const config = urlSafeBase64Json(requiredText(
    embedUrl.searchParams.get("config"),
    "Power BI embed config",
    20_000,
  ));
  const clusterUrl = new URL(requiredText(
    config.clusterUrl,
    "Power BI cluster URL",
    1_000,
  ));
  if (
    clusterUrl.protocol !== "https:"
    || !clusterUrl.hostname.toLowerCase().endsWith(".analysis.windows.net")
    || (clusterUrl.pathname !== "/" && clusterUrl.pathname !== "")
    || clusterUrl.search
    || clusterUrl.hash
  ) {
    return sourceError("Power BI cluster binding changed");
  }
  return {
    clusterUrl: clusterUrl.origin,
    embedToken,
  } as const;
}

async function powerBiText(
  fetchImpl: CreditexOfficialProductFetch,
  clusterUrl: string,
  embedToken: string,
  path: string,
  init: RequestInit,
  label: string,
  maximumBytes = 30_000_000,
) {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  headers.set("Authorization", `EmbedToken ${embedToken}`);
  headers.set("ActivityId", crypto.randomUUID());
  headers.set("RequestId", crypto.randomUUID());
  headers.set("X-PowerBI-HostEnv", "Embed for Customers");
  const response = await fetchImpl(`${clusterUrl}${path}`, {
    ...init,
    cache: "no-store",
    redirect: "manual",
    headers,
  });
  return boundedTextResponse(
    response,
    label,
    maximumBytes,
    JSON_CONTENT,
  );
}

function column(source: string, property: string) {
  return {
    Column: {
      Expression: { SourceRef: { Source: source } },
      Property: property,
    },
  };
}

function inFilter(property: string, values: readonly string[]) {
  if (
    values.length < 1
    || values.length > 50
    || values.some((value) => !value || value.length > 100 || /['\r\n]/.test(value))
  ) {
    return sourceError(`Power BI ${property} filter is invalid`);
  }
  return {
    Condition: {
      In: {
        Expressions: [column("d", property)],
        Values: values.map((value) => [{ Literal: { Value: `'${value}'` } }]),
      },
    },
  };
}

function publicVisibleWhere(
  afterId: string | null = null,
  filter?: Readonly<{ property: string; values: readonly string[] }>,
) {
  const where: JsonObject[] = [{
    Condition: {
      In: {
        Expressions: [column("d", "Public_Visible__c")],
        Values: [[{ Literal: { Value: "true" } }]],
      },
    },
  }];
  if (filter) where.push(inFilter(filter.property, filter.values));
  if (afterId) {
    if (!/^[A-Za-z0-9]{15,18}$/.test(afterId)) {
      return sourceError("Power BI product cursor is invalid");
    }
    where.push({
      Condition: {
        Comparison: {
          ComparisonKind: 1,
          Left: column("d", "Id"),
          Right: { Literal: { Value: `'${afterId}'` } },
        },
      },
    });
  }
  return where;
}

function queryEnvelope(command: JsonObject) {
  return {
    version: "1.0.0",
    queries: [{
      Query: { Commands: [{ SemanticQueryDataShapeCommand: command }] },
      ApplicationContext: {
        DatasetId: CREDITEX_VEU_DATASET_ID,
        Sources: [{ ReportId: CREDITEX_VEU_REPORT_ID }],
      },
    }],
    cancelQueries: [],
    modelId: CREDITEX_VEU_MODEL_ID,
  };
}

function productQuery(
  afterId: string | null,
  fields: readonly string[] = CREDITEX_VEU_QUERY_FIELDS,
  filter?: Readonly<{ property: string; values: readonly string[] }>,
) {
  const select = fields.map((property) => ({
    ...column("d", property),
    Name: `Dim_Product.${property}`,
  }));
  return queryEnvelope({
    Query: {
      Version: 2,
      From: [{ Name: "d", Entity: "Dim_Product", Type: 0 }],
      Where: publicVisibleWhere(afterId, filter),
      OrderBy: [{
        Direction: 1,
        Expression: column("d", "Id"),
      }],
      Select: select,
    },
    Binding: {
      DataReduction: {
        DataVolume: 6,
        Primary: { Window: { Count: CREDITEX_VEU_PAGE_SIZE } },
      },
      Primary: {
        Groupings: [{
          Projections: select.map((_, index) => index),
          Subtotal: 1,
        }],
      },
      Version: 1,
    },
    ExecutionMetricsKind: 1,
  });
}

function countAggregation() {
  return {
    Aggregation: {
      Expression: column("d", "Product_ID__c"),
      Function: 5,
    },
    Name: "Count_Product_ID",
  };
}

function totalQuery(
  filter?: Readonly<{ property: string; values: readonly string[] }>,
) {
  return queryEnvelope({
    Query: {
      Version: 2,
      From: [{ Name: "d", Entity: "Dim_Product", Type: 0 }],
      Where: publicVisibleWhere(null, filter),
      Select: [countAggregation()],
    },
    Binding: {
      DataReduction: {
        DataVolume: 6,
        Primary: { Window: { Count: CREDITEX_VEU_PAGE_SIZE } },
      },
      Primary: { Groupings: [{ Projections: [0], Subtotal: 1 }] },
      Version: 1,
    },
    ExecutionMetricsKind: 1,
  });
}

function groupedQuery(property: string) {
  return queryEnvelope({
    Query: {
      Version: 2,
      From: [{ Name: "d", Entity: "Dim_Product", Type: 0 }],
      Where: publicVisibleWhere(),
      OrderBy: [{ Direction: 1, Expression: column("d", property) }],
      Select: [
        { ...column("d", property), Name: `Dim_Product.${property}` },
        countAggregation(),
      ],
    },
    Binding: {
      DataReduction: {
        DataVolume: 6,
        Primary: { Window: { Count: CREDITEX_VEU_PAGE_SIZE } },
      },
      Primary: { Groupings: [{ Projections: [0, 1], Subtotal: 1 }] },
      Version: 1,
    },
    ExecutionMetricsKind: 1,
  });
}

function refreshQuery() {
  const projection =
    "Min(LastRefreshedDateTime.Last Refreshed DateTime)";
  return queryEnvelope({
    Query: {
      Version: 2,
      From: [{
        Name: "l",
        Entity: CREDITEX_VEU_REFRESH_SCHEMA.entity,
        Type: 0,
      }],
      Select: [{
        Aggregation: {
          Expression: column("l", CREDITEX_VEU_REFRESH_SCHEMA.property),
          Function: 3,
        },
        Name: projection,
      }],
    },
    Binding: {
      DataReduction: {
        DataVolume: 6,
        Primary: { Window: { Count: CREDITEX_VEU_PAGE_SIZE } },
      },
      Primary: { Groupings: [{ Projections: [0], Subtotal: 1 }] },
      Version: 1,
    },
    ExecutionMetricsKind: 1,
  });
}

async function queryPowerBi(
  fetchImpl: CreditexOfficialProductFetch,
  clusterUrl: string,
  embedToken: string,
  query: JsonObject,
  label: string,
  maximumBytes = 4_000_000,
) {
  return powerBiText(
    fetchImpl,
    clusterUrl,
    embedToken,
    "/explore/querydata?synchronous=true",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(query),
    },
    label,
    maximumBytes,
  );
}

type VeuSupplementalQuery =
  (typeof CREDITEX_VEU_SUPPLEMENTAL_QUERIES)[number];

function supplementalFieldTypes(definition: VeuSupplementalQuery) {
  return definition.fields.map((field) => {
    const schema = CREDITEX_VEU_DIM_PRODUCT_SCHEMA[
      field as keyof typeof CREDITEX_VEU_DIM_PRODUCT_SCHEMA
    ];
    if (!schema) return sourceError(`supplement ${definition.key} field changed`);
    return schema[0];
  });
}

async function acquireSupplementalEvidence(
  fetchImpl: CreditexOfficialProductFetch,
  clusterUrl: string,
  embedToken: string,
  definition: VeuSupplementalQuery,
  categoryCounts: Readonly<Record<string, number>>,
  supplementalControls: VeuControlEvidence["supplementalControls"],
  reserveResponseBytes: (response: string) => void,
): Promise<readonly JsonObject[]> {
  const records: JsonObject[] = [];
  const filteredControl = "productIds" in definition
    ? supplementalControls[definition.key]
      ?? sourceError(`supplement ${definition.key} exact count control is missing`)
    : undefined;
  const expectedCount = filteredControl?.count
    ?? definition.categories.reduce(
      (sum, category) => sum + (categoryCounts[category] || 0),
      0,
    );
  if (expectedCount === 0) {
    records.push({
      recordType: "supplement",
      key: definition.key,
      queryFields: definition.fields,
      expectedCount,
      ...(filteredControl ? { controlResponse: filteredControl.response } : {}),
    });
    return records;
  }
  const filter = "productIds" in definition
    ? { property: "Product_ID__c", values: definition.productIds }
    : { property: "Product_Category_Number__c", values: definition.categories };
  const fieldTypes = supplementalFieldTypes(definition);
  const allowedCategories = new Set<string>(definition.categories);
  let afterId: string | null = null;
  let rowCount = 0;
  let pageCount = 0;
  let terminalSeen = false;
  records.push({
    recordType: "supplement",
    key: definition.key,
    queryFields: definition.fields,
    expectedCount,
    ...(filteredControl ? { controlResponse: filteredControl.response } : {}),
  });
  while (
    rowCount < expectedCount
    && pageCount < CREDITEX_VEU_MAX_PAGES
  ) {
    const response = await queryPowerBi(
      fetchImpl,
      clusterUrl,
      embedToken,
      productQuery(afterId, definition.fields, filter),
      `Power BI ${definition.key} supplement page ${pageCount + 1}`,
    );
    const decoded = decodeCreditexVeuPowerBiProductPage(
      response,
      definition.fields,
      fieldTypes,
      CREDITEX_VEU_PAGE_SIZE,
    );
    reserveResponseBytes(response);
    records.push({
      recordType: "supplement-page",
      key: definition.key,
      afterId,
      response,
    });
    pageCount += 1;
    for (const row of decoded.rows) {
      const id = row[0];
      const productId = row[1];
      const category = row[2] ?? "";
      const status = row[3];
      if (
        typeof id !== "string"
        || !/^[A-Za-z0-9]{15,18}$/.test(id)
        || (afterId !== null && id.toLowerCase() <= afterId.toLowerCase())
        || typeof productId !== "string"
        || !productId
        || typeof category !== "string"
        || !allowedCategories.has(category)
        || (status !== "Approved" && status !== "Legacy")
      ) {
        return sourceError(`supplement ${definition.key} identity drifted`);
      }
      afterId = id;
    }
    rowCount += decoded.rows.length;
    terminalSeen = !decoded.continuation;
    if (rowCount > expectedCount) {
      return sourceError(`supplement ${definition.key} exceeded its control`);
    }
    if (!decoded.continuation && rowCount !== expectedCount) {
      return sourceError(`supplement ${definition.key} ended before its control`);
    }
  }
  if (
    rowCount !== expectedCount
    || !terminalSeen
    || pageCount > CREDITEX_VEU_MAX_PAGES
  ) {
    return sourceError(`supplement ${definition.key} did not reconcile`);
  }
  return records;
}

async function acquireAllSupplementalEvidence(
  fetchImpl: CreditexOfficialProductFetch,
  clusterUrl: string,
  embedToken: string,
  categoryCounts: Readonly<Record<string, number>>,
  supplementalControls: VeuControlEvidence["supplementalControls"],
) {
  // Supplemental families have independent category filters and cursors. Fetch
  // a bounded group in parallel, then append in the canonical definition order
  // so source bytes stay deterministic while avoiding ten serial network waits.
  const orderedRecords: JsonObject[][] = [];
  const encoder = new TextEncoder();
  let retainedResponseBytes = 0;
  const reserveResponseBytes = (response: string) => {
    const byteLength = encoder.encode(response).byteLength;
    if (
      retainedResponseBytes + byteLength
      > CREDITEX_VEU_SUPPLEMENTAL_BUFFER_MAXIMUM_BYTES
    ) {
      return sourceError("supplement evidence exceeded its concurrent byte limit");
    }
    retainedResponseBytes += byteLength;
  };
  for (
    let start = 0;
    start < CREDITEX_VEU_SUPPLEMENTAL_QUERIES.length;
    start += CREDITEX_VEU_SUPPLEMENTAL_FETCH_CONCURRENCY
  ) {
    const definitions = CREDITEX_VEU_SUPPLEMENTAL_QUERIES.slice(
      start,
      start + CREDITEX_VEU_SUPPLEMENTAL_FETCH_CONCURRENCY,
    );
    const batches = await Promise.all(definitions.map((definition) => (
      acquireSupplementalEvidence(
        fetchImpl,
        clusterUrl,
        embedToken,
        definition,
        categoryCounts,
        supplementalControls,
        reserveResponseBytes,
      )
    )));
    orderedRecords.push(...batches.map((records) => [...records]));
  }
  return orderedRecords;
}

type VeuControlEvidence = Readonly<{
  total: number;
  statusControl: Readonly<Record<string, number>>;
  categoryControl: Readonly<Record<string, number>>;
  supplementalControls: Readonly<Record<string, Readonly<{
    count: number;
    response: string;
  }>>>;
  sourceRefreshedAt: string;
  totalResponse: string;
  statusResponse: string;
  categoryResponse: string;
  refreshResponse: string;
}>;

function validatePowerBiControls(
  totalResponse: string,
  statusResponse: string,
  categoryResponse: string,
  refreshResponse: string,
  supplementalControls: VeuControlEvidence["supplementalControls"] = {},
): VeuControlEvidence {
  const total = decodeCreditexVeuPowerBiAggregateCount(totalResponse);
  const statuses = decodeCreditexVeuPowerBiGroupedCounts(
    statusResponse,
    "Product_Status__c",
  );
  const categories = decodeCreditexVeuPowerBiGroupedCounts(
    categoryResponse,
    "Product_Category_Number__c",
  );
  if (
    total < 70_000
    || statuses.total !== total
    || categories.total !== total
    || JSON.stringify(Object.keys(statuses.groups))
      !== JSON.stringify(["Approved", "Legacy"])
  ) {
    return sourceError("Power BI aggregate controls changed");
  }
  const allowedCategories = new Set([
    "",
    ...Object.keys(CREDITEX_VEU_CATEGORY_PRODUCT_KIND),
  ]);
  const unexpectedCategory = Object.keys(categories.groups).find(
    (category) => !allowedCategories.has(category),
  );
  if (unexpectedCategory !== undefined) {
    return sourceError(`Power BI returned unknown category ${unexpectedCategory}`);
  }
  const refreshed = decodeCreditexVeuPowerBiRefreshTimestamp(refreshResponse);
  const refreshedAt = new Date(refreshed.utc).getTime();
  const now = Date.now();
  if (
    refreshedAt > now + VEU_FUTURE_TOLERANCE_MS
    || now - refreshedAt > VEU_SOURCE_FRESHNESS_MS
  ) {
    return sourceError("Power BI registry refresh timestamp is stale or future-dated");
  }
  return {
    total,
    statusControl: {
      Approved: statuses.groups.Approved || 0,
      Legacy: statuses.groups.Legacy || 0,
    },
    categoryControl: Object.fromEntries(
      [...allowedCategories].map((category) => [
        category,
        categories.groups[category] || 0,
      ]),
    ),
    supplementalControls,
    sourceRefreshedAt: refreshed.utc,
    totalResponse,
    statusResponse,
    categoryResponse,
    refreshResponse,
  };
}

async function fetchPowerBiControls(
  fetchImpl: CreditexOfficialProductFetch,
  clusterUrl: string,
  embedToken: string,
) {
  const filteredDefinitions = CREDITEX_VEU_SUPPLEMENTAL_QUERIES.filter(
    (definition): definition is VeuSupplementalQuery & {
      readonly productIds: readonly string[];
    } => "productIds" in definition,
  );
  const responses = await Promise.all([
      queryPowerBi(
        fetchImpl,
        clusterUrl,
        embedToken,
        totalQuery(),
        "Power BI product total",
      ),
      queryPowerBi(
        fetchImpl,
        clusterUrl,
        embedToken,
        groupedQuery("Product_Status__c"),
        "Power BI product status control",
      ),
      queryPowerBi(
        fetchImpl,
        clusterUrl,
        embedToken,
        groupedQuery("Product_Category_Number__c"),
        "Power BI product category control",
      ),
      queryPowerBi(
        fetchImpl,
        clusterUrl,
        embedToken,
        refreshQuery(),
        "Power BI refresh timestamp",
      ),
      ...filteredDefinitions.map((definition) => queryPowerBi(
        fetchImpl,
        clusterUrl,
        embedToken,
        totalQuery({
          property: "Product_ID__c",
          values: definition.productIds,
        }),
        `Power BI ${definition.key} exact count control`,
      )),
    ]);
  const [totalResponse, statusResponse, categoryResponse, refreshResponse] =
    responses;
  const supplementalControls = Object.fromEntries(
    filteredDefinitions.map((definition, index) => {
      const response = responses[index + 4];
      return [definition.key, {
        count: decodeCreditexVeuPowerBiAggregateCount(response),
        response,
      }];
    }),
  );
  return validatePowerBiControls(
    totalResponse,
    statusResponse,
    categoryResponse,
    refreshResponse,
    supplementalControls,
  );
}

async function acquirePowerBiEvidence(
  fetchImpl: CreditexOfficialProductFetch,
  clusterUrl: string,
  embedToken: string,
) {
  const modelPath = `/explore/reports/${CREDITEX_VEU_REPORT_ID}/modelsAndExploration?preferReadOnlySession=true&datasetObjectId=${CREDITEX_VEU_DATASET_ID}&skipQueryData=true`;
  const controls = await fetchPowerBiControls(
    fetchImpl,
    clusterUrl,
    embedToken,
  );
  const {
    total,
    statusControl,
    categoryControl,
    supplementalControls,
    sourceRefreshedAt,
    totalResponse,
    statusResponse,
    categoryResponse,
    refreshResponse,
  } = controls;
  const writer = new BoundedVeuArtifactWriter();
  writer.append({
    recordType: "header",
    contract: CREDITEX_VEU_BOUNDED_STREAM_ARTIFACT_CONTRACT,
    sourceKey: CREDITEX_VEU_PUBLIC_REGISTRY_SOURCE_KEY,
    reportId: CREDITEX_VEU_REPORT_ID,
    datasetId: CREDITEX_VEU_DATASET_ID,
    modelId: CREDITEX_VEU_MODEL_ID,
    sourceRefreshedAt,
    queryFields: CREDITEX_VEU_QUERY_FIELDS,
    controls: {
      total,
      statuses: statusControl,
      categories: categoryControl,
      totalResponse,
      statusResponse,
      categoryResponse,
      refreshResponse,
    },
  });
  // Supplemental evidence is independent of the main Id cursor. Acquire it in
  // the same bounded concurrency groups while the model and product pages are
  // being read, then append only after the main stream in canonical order.
  const supplementalEvidence = acquireAllSupplementalEvidence(
    fetchImpl,
    clusterUrl,
    embedToken,
    categoryControl,
    supplementalControls,
  ).then(
    (records) => ({ records } as const),
    (error: unknown) => ({ error } as const),
  );
  // Model and conceptual-schema responses are the two largest controls. Fetch,
  // validate and append them in separate lexical scopes so the Worker never
  // retains both decoded response graphs at once.
  {
    const modelResponse = await powerBiText(
      fetchImpl,
      clusterUrl,
      embedToken,
      modelPath,
      { method: "GET" },
      "Power BI model response",
      4_000_000,
    );
    validateCreditexVeuPowerBiModel(modelResponse);
    writer.append({
      recordType: "control",
      key: "modelResponse",
      response: modelResponse,
    });
  }
  {
    const conceptualSchemaResponse = await powerBiText(
      fetchImpl,
      clusterUrl,
      embedToken,
      "/explore/conceptualschema",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ModelObjectIds: [CREDITEX_VEU_DATASET_ID],
          userPreferredLocale: "en",
        }),
      },
      "Power BI conceptual schema response",
      12_000_000,
    );
    validateCreditexVeuPowerBiSchema(conceptualSchemaResponse);
    writer.append({
      recordType: "control",
      key: "conceptualSchemaResponse",
      response: conceptualSchemaResponse,
    });
  }
  let afterId: string | null = null;
  let rowCount = 0;
  let pageCount = 0;
  while (rowCount < total && pageCount < CREDITEX_VEU_MAX_PAGES) {
    const response = await queryPowerBi(
      fetchImpl,
      clusterUrl,
      embedToken,
      productQuery(afterId),
      `Power BI product page ${pageCount + 1}`,
    );
    const decoded = decodeCreditexVeuPowerBiProductPage(
      response,
      CREDITEX_VEU_QUERY_FIELDS,
      CREDITEX_VEU_QUERY_FIELD_TYPES,
      CREDITEX_VEU_PAGE_SIZE,
    );
    writer.append({ recordType: "page", afterId, response });
    pageCount += 1;
    rowCount += decoded.rows.length;
    if (rowCount > total) {
      return sourceError("Power BI product pages exceeded the official total");
    }
    const lastId = decoded.rows.at(-1)?.[0];
    if (typeof lastId !== "string" || !lastId) {
      return sourceError("Power BI product page has no final Salesforce Id");
    }
    afterId = lastId;
    if (!decoded.continuation && rowCount !== total) {
      return sourceError("Power BI product pages ended before the official total");
    }
  }
  if (rowCount !== total || pageCount > CREDITEX_VEU_MAX_PAGES) {
    return sourceError("Power BI product pagination did not reconcile");
  }
  const supplementalResult = await supplementalEvidence;
  if ("error" in supplementalResult) throw supplementalResult.error;
  for (const records of supplementalResult.records) {
    for (const record of records) writer.append(record);
  }
  return writer.finish();
}

type VeuAcquisitionRow = Readonly<{
  registry_code: string;
  acquisition_id: string;
  contract: string;
  definition_sha256: string;
  source_key: string;
  source_refreshed_at: string;
  total_record_count: number;
  status_control_json: string;
  category_control_json: string;
  supplemental_control_json: string;
  phase: "pages" | "assemble" | "ready" | "cleanup";
  cleanup_disposition: "restart" | "finish";
  response_count: number;
  response_byte_length: number;
  assembly_record_count: number;
  assembly_chunk_count: number;
  assembly_byte_length: number;
  revision: number;
  created_at: string;
  updated_at: string;
}>;

type VeuAcquisitionStreamRow = Readonly<{
  acquisition_id: string;
  stream_index: number;
  stream_key: string;
  expected_record_count: number;
  page_count: number;
  record_count: number;
  last_record_id: string;
  terminal: number;
  revision: number;
  updated_at: string;
}>;

type VeuAcquisitionFragmentRow = Readonly<{
  acquisition_id: string;
  kind: "control" | "model" | "schema" | "page" | "assembly";
  stream_index: number;
  fragment_index: number;
  request_sha256: string;
  cursor_before: string;
  cursor_after: string;
  row_count: number;
  terminal: number;
  object_key: string;
  response_sha256: string;
  content_type: string;
  byte_length: number;
  created_at: string;
}>;

type VeuFragmentIdentity = Readonly<{
  kind: VeuAcquisitionFragmentRow["kind"];
  streamIndex: number;
  fragmentIndex: number;
  requestSha256: string;
  cursorBefore?: string;
  cursorAfter?: string;
  rowCount?: number;
  terminal?: boolean;
}>;

class VeuAcquisitionYield extends Error {
  constructor() {
    super("VEU source acquisition quantum completed");
    this.name = "VeuAcquisitionYield";
  }
}

const veuEncoder = new TextEncoder();
const veuDecoder = new TextDecoder("utf-8", { fatal: true });

function veuAcquisitionDefinitionSha256() {
  return veuSha256(JSON.stringify({
    artifactContract: CREDITEX_VEU_BOUNDED_STREAM_ARTIFACT_CONTRACT,
    sourceKey: CREDITEX_VEU_PUBLIC_REGISTRY_SOURCE_KEY,
    reportId: CREDITEX_VEU_REPORT_ID,
    datasetId: CREDITEX_VEU_DATASET_ID,
    modelId: CREDITEX_VEU_MODEL_ID,
    queryFields: CREDITEX_VEU_QUERY_FIELDS,
    queryFieldTypes: CREDITEX_VEU_QUERY_FIELD_TYPES,
    dimProductSchema: CREDITEX_VEU_DIM_PRODUCT_SCHEMA,
    refreshSchema: CREDITEX_VEU_REFRESH_SCHEMA,
    supplementalQueries: CREDITEX_VEU_SUPPLEMENTAL_QUERIES,
    pageSize: CREDITEX_VEU_PAGE_SIZE,
    maximumPages: CREDITEX_VEU_MAX_PAGES,
  }));
}

function acquisitionOwnershipLost(
  context: CreditexOfficialProductSourceAcquisitionContext,
): never {
  throw new CreditexOfficialProductError(
    "OFFICIAL_PRODUCT_REFRESH_IN_PROGRESS",
    409,
    `Official registry ${context.registryCode} refresh ownership was lost.`,
  );
}

async function veuSha256(value: string | Uint8Array) {
  const bytes = typeof value === "string" ? veuEncoder.encode(value) : value;
  const exactBytes = new Uint8Array(bytes.byteLength);
  exactBytes.set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", exactBytes.buffer);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function veuRequestSha256(
  method: "GET" | "POST",
  path: string,
  body = "",
) {
  return veuSha256(JSON.stringify({ method, path, body }));
}

function acquisitionOwnershipPredicate() {
  return `EXISTS (
      SELECT 1 FROM compliance_official_product_sync_leases inner_lease
      WHERE inner_lease.registry_code = ?
        AND inner_lease.lease_id = ?
        AND inner_lease.expires_at > ?
    ) AND (? = '' OR EXISTS (
      SELECT 1 FROM compliance_official_product_sync_leases fleet
      WHERE fleet.registry_code = ?
        AND fleet.lease_id = ?
        AND fleet.expires_at > ?
    ))`;
}

function acquisitionOwnershipBindings(
  context: CreditexOfficialProductSourceAcquisitionContext,
) {
  return [
    context.registryCode,
    context.leaseId,
    context.leaseFenceAt,
    context.fleetLeaseId || "",
    CREDITEX_PRODUCT_REGISTRY_FLEET_LEASE_CODE,
    context.fleetLeaseId || "",
    context.leaseFenceAt,
  ] as const;
}

function assertAcquisitionActive(
  context: CreditexOfficialProductSourceAcquisitionContext,
) {
  if (!context.signal?.aborted) return;
  if (context.signal.reason instanceof Error) throw context.signal.reason;
  throw new Error(String(context.signal.reason || "VEU source acquisition aborted"));
}

function assertAcquisitionFetchBudget(
  context: CreditexOfficialProductSourceAcquisitionContext,
  fetchedResponses: number,
) {
  assertAcquisitionActive(context);
  if (
    Date.now() >= context.yieldAt
    || fetchedResponses
      >= CREDITEX_VEU_DURABLE_ACQUISITION_MAX_NEW_RESPONSES
  ) {
    throw new VeuAcquisitionYield();
  }
}

async function loadVeuAcquisition(
  context: CreditexOfficialProductSourceAcquisitionContext,
) {
  return context.database.prepare(`SELECT registry_code, acquisition_id,
      contract, definition_sha256, source_key, source_refreshed_at,
      total_record_count, status_control_json, category_control_json,
      supplemental_control_json, phase, cleanup_disposition, response_count,
      response_byte_length,
      assembly_record_count, assembly_chunk_count, assembly_byte_length,
      revision, created_at, updated_at
    FROM compliance_official_product_source_acquisitions
    WHERE registry_code = ?`)
    .bind(context.registryCode)
    .first<VeuAcquisitionRow>();
}

async function loadVeuAcquisitionStreams(
  context: CreditexOfficialProductSourceAcquisitionContext,
  acquisitionId: string,
) {
  const result = await context.database.prepare(`SELECT acquisition_id,
      stream_index, stream_key, expected_record_count, page_count,
      record_count, last_record_id, terminal, revision, updated_at
    FROM compliance_official_product_source_acquisition_streams
    WHERE acquisition_id = ? ORDER BY stream_index`)
    .bind(acquisitionId)
    .all<VeuAcquisitionStreamRow>();
  return result.results || [];
}

async function loadVeuAcquisitionFragment(
  context: CreditexOfficialProductSourceAcquisitionContext,
  acquisitionId: string,
  kind: VeuAcquisitionFragmentRow["kind"],
  streamIndex: number,
  fragmentIndex: number,
) {
  return context.database.prepare(`SELECT acquisition_id, kind, stream_index,
      fragment_index, request_sha256, cursor_before, cursor_after, row_count,
      terminal, object_key, response_sha256, content_type, byte_length,
      created_at
    FROM compliance_official_product_source_acquisition_fragments
    WHERE acquisition_id = ? AND kind = ? AND stream_index = ?
      AND fragment_index = ?`)
    .bind(acquisitionId, kind, streamIndex, fragmentIndex)
    .first<VeuAcquisitionFragmentRow>();
}

async function retainVeuAcquisitionFragment(
  context: CreditexOfficialProductSourceAcquisitionContext,
  acquisitionId: string,
  identity: VeuFragmentIdentity,
  response: string | Uint8Array,
) {
  const bytes = typeof response === "string" ? veuEncoder.encode(response) : response;
  const maximumBytes = identity.kind === "assembly"
    ? CREDITEX_VEU_ARTIFACT_MAXIMUM_BYTES
    : 12_000_000;
  if (bytes.byteLength < 1 || bytes.byteLength > maximumBytes) {
    return sourceError("durable response fragment exceeded its reviewed byte limit");
  }
  const responseSha256 = await veuSha256(bytes);
  const objectKey = [
    "creditex/official-products/acquisitions",
    context.registryCode,
    acquisitionId,
    `${identity.kind}-${identity.streamIndex}-${identity.fragmentIndex}`,
    `${responseSha256}.json`,
  ].join("/");
  const metadata = {
    contract: VEU_SOURCE_ACQUISITION_CONTRACT,
    registryCode: context.registryCode,
    acquisitionId,
    kind: identity.kind,
    streamIndex: String(identity.streamIndex),
    fragmentIndex: String(identity.fragmentIndex),
    requestSha256: identity.requestSha256,
    responseSha256,
    byteLength: String(bytes.byteLength),
  };
  const matches = (head: Awaited<ReturnType<
    CreditexOfficialProductSourceAcquisitionContext["artifactStore"]["head"]
  >>) => Boolean(
    head
    && Number(head.size) === bytes.byteLength
    && Object.entries(metadata).every(([key, value]) => (
      head.customMetadata?.[key] === value
    )),
  );
  let head = await context.artifactStore.head(objectKey).catch(() => null);
  if (!matches(head)) {
    await context.artifactStore.put(objectKey, bytes, {
      httpMetadata: { contentType: "application/json" },
      customMetadata: metadata,
    });
    head = await context.artifactStore.head(objectKey).catch(() => null);
  }
  const object = matches(head)
    ? await context.artifactStore.get(objectKey).catch(() => null)
    : null;
  const retained = object
    ? new Uint8Array(await object.arrayBuffer())
    : null;
  if (
    !retained
    || retained.byteLength !== bytes.byteLength
    || await veuSha256(retained) !== responseSha256
  ) {
    return sourceError("durable response fragment failed immutable custody verification");
  }
  return {
    ...identity,
    cursorBefore: identity.cursorBefore || "",
    cursorAfter: identity.cursorAfter || "",
    rowCount: identity.rowCount || 0,
    terminal: Boolean(identity.terminal),
    objectKey,
    responseSha256,
    byteLength: bytes.byteLength,
  } as const;
}

async function readVeuAcquisitionFragmentBytes(
  context: CreditexOfficialProductSourceAcquisitionContext,
  row: VeuAcquisitionFragmentRow,
) {
  const metadata = {
    contract: VEU_SOURCE_ACQUISITION_CONTRACT,
    registryCode: context.registryCode,
    acquisitionId: row.acquisition_id,
    kind: row.kind,
    streamIndex: String(row.stream_index),
    fragmentIndex: String(row.fragment_index),
    requestSha256: row.request_sha256,
    responseSha256: row.response_sha256,
    byteLength: String(row.byte_length),
  };
  const head = await context.artifactStore.head(row.object_key).catch(() => null);
  if (
    !head
    || Number(head.size) !== row.byte_length
    || !Object.entries(metadata).every(([key, value]) => (
      head.customMetadata?.[key] === value
    ))
  ) {
    return sourceError("durable response fragment custody metadata changed");
  }
  const object = await context.artifactStore.get(row.object_key).catch(() => null);
  const bytes = object ? new Uint8Array(await object.arrayBuffer()) : null;
  if (
    !bytes
    || bytes.byteLength !== row.byte_length
    || await veuSha256(bytes) !== row.response_sha256
  ) {
    return sourceError("durable response fragment bytes changed");
  }
  return bytes;
}

async function readVeuAcquisitionFragment(
  context: CreditexOfficialProductSourceAcquisitionContext,
  row: VeuAcquisitionFragmentRow,
) {
  const bytes = await readVeuAcquisitionFragmentBytes(context, row);
  try {
    return veuDecoder.decode(bytes);
  } catch {
    return sourceError("durable response fragment is not valid UTF-8");
  }
}

function supplementalExpectedCount(
  definition: VeuSupplementalQuery,
  categoryControl: Readonly<Record<string, number>>,
  supplementalControls: VeuControlEvidence["supplementalControls"],
) {
  if ("productIds" in definition) {
    return supplementalControls[definition.key]?.count
      ?? sourceError(`supplement ${definition.key} exact count control is missing`);
  }
  return definition.categories.reduce(
    (sum, category) => sum + (categoryControl[category] || 0),
    0,
  );
}

function acquisitionMatchesControls(
  acquisition: VeuAcquisitionRow,
  controls: VeuControlEvidence,
  definitionSha256: string,
) {
  return acquisition.contract === VEU_SOURCE_ACQUISITION_CONTRACT
    && acquisition.definition_sha256 === definitionSha256
    && acquisition.source_key === CREDITEX_VEU_PUBLIC_REGISTRY_SOURCE_KEY
    && acquisition.source_refreshed_at === controls.sourceRefreshedAt
    && Number(acquisition.total_record_count) === controls.total
    && acquisition.status_control_json === JSON.stringify(controls.statusControl)
    && acquisition.category_control_json
      === JSON.stringify(controls.categoryControl)
    && acquisition.supplemental_control_json === JSON.stringify(
      Object.fromEntries(Object.entries(controls.supplementalControls).map(
        ([key, value]) => [key, value.count],
      )),
    );
}

function assertVeuAcquisitionSourceCurrent(acquisition: VeuAcquisitionRow) {
  const refreshedAt = Date.parse(acquisition.source_refreshed_at);
  const now = Date.now();
  if (
    !Number.isFinite(refreshedAt)
    || refreshedAt > now + VEU_FUTURE_TOLERANCE_MS
    || now - refreshedAt > VEU_SOURCE_FRESHNESS_MS
  ) {
    return sourceError("retained Power BI registry source became stale or future-dated");
  }
}

async function markVeuAcquisitionForCleanup(
  context: CreditexOfficialProductSourceAcquisitionContext,
  acquisition: VeuAcquisitionRow,
) {
  if (acquisition.phase === "cleanup") return acquisition;
  const result = await context.database.prepare(`UPDATE
      compliance_official_product_source_acquisitions
    SET phase = 'cleanup', revision = revision + 1, updated_at = ?
    WHERE registry_code = ? AND acquisition_id = ? AND revision = ?
      AND phase <> 'cleanup' AND ${acquisitionOwnershipPredicate()}`)
    .bind(
      context.checkedAt,
      context.registryCode,
      acquisition.acquisition_id,
      acquisition.revision,
      ...acquisitionOwnershipBindings(context),
    )
    .run();
  if (Number(result.meta?.changes || 0) !== 1) acquisitionOwnershipLost(context);
  return {
    ...acquisition,
    phase: "cleanup" as const,
    revision: acquisition.revision + 1,
    updated_at: context.checkedAt,
  };
}

async function ensureVeuAcquisition(
  context: CreditexOfficialProductSourceAcquisitionContext,
  controls: VeuControlEvidence,
  definitionSha256: string,
) {
  const existing = await loadVeuAcquisition(context);
  if (
    existing
    && acquisitionMatchesControls(existing, controls, definitionSha256)
  ) return existing;

  if (existing) {
    await markVeuAcquisitionForCleanup(context, existing);
    throw new VeuAcquisitionYield();
  }

  const acquisitionId = crypto.randomUUID();
  const controlInputs = [
    { response: controls.totalResponse, query: totalQuery() },
    {
      response: controls.statusResponse,
      query: groupedQuery("Product_Status__c"),
    },
    {
      response: controls.categoryResponse,
      query: groupedQuery("Product_Category_Number__c"),
    },
    { response: controls.refreshResponse, query: refreshQuery() },
    ...CREDITEX_VEU_SUPPLEMENTAL_QUERIES.flatMap((definition) => {
      if (!("productIds" in definition)) return [];
      const control = controls.supplementalControls[definition.key]
        ?? sourceError(`supplement ${definition.key} exact count control is missing`);
      return [{
        response: control.response,
        query: totalQuery({
          property: "Product_ID__c",
          values: definition.productIds,
        }),
      }];
    }),
  ] as const;
  const retainedControls = await Promise.all(controlInputs.map(
    async (input, fragmentIndex) => retainVeuAcquisitionFragment(
      context,
      acquisitionId,
      {
        kind: "control",
        streamIndex: -1,
        fragmentIndex,
        requestSha256: await veuRequestSha256(
          "POST",
          "/explore/querydata?synchronous=true",
          JSON.stringify(input.query),
        ),
      },
      input.response,
    ),
  ));
  const responseByteLength = retainedControls.reduce(
    (total, fragment) => total + fragment.byteLength,
    0,
  );
  if (responseByteLength > CREDITEX_VEU_ARTIFACT_MAXIMUM_BYTES) {
    return sourceError("durable control evidence exceeded its reviewed byte limit");
  }
  const streams = [{
    streamIndex: 0,
    streamKey: "products",
    expectedRecordCount: controls.total,
  }, ...CREDITEX_VEU_SUPPLEMENTAL_QUERIES.map((definition, index) => ({
    streamIndex: index + 1,
    streamKey: definition.key,
    expectedRecordCount: supplementalExpectedCount(
      definition,
      controls.categoryControl,
      controls.supplementalControls,
    ),
  }))];
  const ownership = acquisitionOwnershipBindings(context);
  const statements = [];
  statements.push(context.database.prepare(`INSERT INTO
      compliance_official_product_source_acquisitions (
        registry_code, acquisition_id, contract, definition_sha256, source_key,
        source_refreshed_at, total_record_count, status_control_json,
        category_control_json, supplemental_control_json, phase, response_count,
        cleanup_disposition, response_byte_length, assembly_record_count, assembly_chunk_count,
        assembly_byte_length, revision, created_at, updated_at
      ) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pages', ?, 'restart', ?, 0, 0, 0, 1, ?, ?
      WHERE ${acquisitionOwnershipPredicate()}`)
    .bind(
      context.registryCode,
      acquisitionId,
      VEU_SOURCE_ACQUISITION_CONTRACT,
      definitionSha256,
      CREDITEX_VEU_PUBLIC_REGISTRY_SOURCE_KEY,
      controls.sourceRefreshedAt,
      controls.total,
      JSON.stringify(controls.statusControl),
      JSON.stringify(controls.categoryControl),
      JSON.stringify(Object.fromEntries(Object.entries(
        controls.supplementalControls,
      ).map(([key, value]) => [key, value.count]))),
      retainedControls.length,
      responseByteLength,
      context.checkedAt,
      context.checkedAt,
      ...ownership,
    ));
  for (const stream of streams) {
    statements.push(context.database.prepare(`INSERT INTO
        compliance_official_product_source_acquisition_streams (
          acquisition_id, stream_index, stream_key, expected_record_count,
          page_count, record_count, last_record_id, terminal, revision,
          updated_at
        ) SELECT ?, ?, ?, ?, 0, 0, '', ?, 1, ?
        WHERE EXISTS (
          SELECT 1 FROM compliance_official_product_source_acquisitions
          WHERE registry_code = ? AND acquisition_id = ?
        )`)
      .bind(
        acquisitionId,
        stream.streamIndex,
        stream.streamKey,
        stream.expectedRecordCount,
        stream.expectedRecordCount === 0 ? 1 : 0,
        context.checkedAt,
        context.registryCode,
        acquisitionId,
      ));
  }
  for (const fragment of retainedControls) {
    statements.push(context.database.prepare(`INSERT INTO
        compliance_official_product_source_acquisition_fragments (
          acquisition_id, kind, stream_index, fragment_index, request_sha256,
          cursor_before, cursor_after, row_count, terminal, object_key,
          response_sha256, content_type, byte_length, created_at
        ) SELECT ?, 'control', -1, ?, ?, '', '', 0, 0, ?, ?,
          'application/json', ?, ?
        WHERE EXISTS (
          SELECT 1 FROM compliance_official_product_source_acquisitions
          WHERE registry_code = ? AND acquisition_id = ?
        )`)
      .bind(
        acquisitionId,
        fragment.fragmentIndex,
        fragment.requestSha256,
        fragment.objectKey,
        fragment.responseSha256,
        fragment.byteLength,
        context.checkedAt,
        context.registryCode,
        acquisitionId,
      ));
  }
  const results = await context.database.batch(statements);
  const acquisitionResult = results[0];
  if (Number(acquisitionResult?.meta?.changes || 0) !== 1) {
    acquisitionOwnershipLost(context);
  }
  const created = await loadVeuAcquisition(context);
  if (!created || created.acquisition_id !== acquisitionId) {
    return sourceError("durable source acquisition could not be created");
  }
  return created;
}

async function persistVeuStaticFragment(
  context: CreditexOfficialProductSourceAcquisitionContext,
  acquisition: VeuAcquisitionRow,
  identity: VeuFragmentIdentity,
  response: string,
) {
  const retained = await retainVeuAcquisitionFragment(
    context,
    acquisition.acquisition_id,
    identity,
    response,
  );
  const ownership = acquisitionOwnershipBindings(context);
  const results = await context.database.batch([
    context.database.prepare(`UPDATE
        compliance_official_product_source_acquisitions
      SET response_count = response_count + 1,
        response_byte_length = response_byte_length + ?,
        revision = revision + 1, updated_at = ?
      WHERE registry_code = ? AND acquisition_id = ? AND revision = ?
        AND response_byte_length <= ?
        AND ${acquisitionOwnershipPredicate()}`)
      .bind(
        retained.byteLength,
        context.checkedAt,
        context.registryCode,
        acquisition.acquisition_id,
        acquisition.revision,
        CREDITEX_VEU_ARTIFACT_MAXIMUM_BYTES - retained.byteLength,
        ...ownership,
      ),
    context.database.prepare(`INSERT INTO
        compliance_official_product_source_acquisition_fragments (
          acquisition_id, kind, stream_index, fragment_index, request_sha256,
          cursor_before, cursor_after, row_count, terminal, object_key,
          response_sha256, content_type, byte_length, created_at
        ) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'application/json', ?, ?
        WHERE EXISTS (
          SELECT 1 FROM compliance_official_product_source_acquisitions
          WHERE registry_code = ? AND acquisition_id = ? AND revision = ?
        ) AND ${acquisitionOwnershipPredicate()}`)
      .bind(
        acquisition.acquisition_id,
        retained.kind,
        retained.streamIndex,
        retained.fragmentIndex,
        retained.requestSha256,
        retained.cursorBefore,
        retained.cursorAfter,
        retained.rowCount,
        retained.terminal ? 1 : 0,
        retained.objectKey,
        retained.responseSha256,
        retained.byteLength,
        context.checkedAt,
        context.registryCode,
        acquisition.acquisition_id,
        acquisition.revision + 1,
        ...ownership,
      ),
  ]);
  if (results.some((result) => Number(result.meta?.changes || 0) !== 1)) {
    acquisitionOwnershipLost(context);
  }
  return retained;
}

function validateDurablePageIdentity(
  decoded: ReturnType<typeof decodeCreditexVeuPowerBiProductPage>,
  cursorBefore: string,
  definition?: VeuSupplementalQuery,
) {
  let cursor = cursorBefore;
  const allowedCategories = definition
    ? new Set<string>(definition.categories)
    : null;
  for (const row of decoded.rows) {
    const id = row[0];
    if (
      typeof id !== "string"
      || !/^[A-Za-z0-9]{15,18}$/.test(id)
      || (cursor && id.toLowerCase() <= cursor.toLowerCase())
    ) {
      return sourceError("durable Power BI page cursor drifted");
    }
    cursor = id;
    if (definition) {
      const productId = row[1];
      const category = row[2] ?? "";
      const status = row[3];
      if (
        typeof productId !== "string"
        || !productId
        || typeof category !== "string"
        || !allowedCategories?.has(category)
        || (status !== "Approved" && status !== "Legacy")
      ) {
        return sourceError(`supplement ${definition.key} identity drifted`);
      }
    }
  }
  if (!cursor || decoded.rows.length < 1) {
    return sourceError("durable Power BI page has no final Salesforce Id");
  }
  return cursor;
}

async function persistVeuPageFragment(
  context: CreditexOfficialProductSourceAcquisitionContext,
  acquisition: VeuAcquisitionRow,
  stream: VeuAcquisitionStreamRow,
  requestSha256: string,
  response: string,
  decoded: ReturnType<typeof decodeCreditexVeuPowerBiProductPage>,
  definition?: VeuSupplementalQuery,
) {
  if (stream.page_count >= CREDITEX_VEU_MAX_PAGES) {
    return sourceError("durable Power BI pagination exceeded its page limit");
  }
  const cursorAfter = validateDurablePageIdentity(
    decoded,
    stream.last_record_id,
    definition,
  );
  const nextRecordCount = stream.record_count + decoded.rows.length;
  if (nextRecordCount > stream.expected_record_count) {
    return sourceError("durable Power BI pages exceeded their official control");
  }
  if (!decoded.continuation && nextRecordCount !== stream.expected_record_count) {
    return sourceError("durable Power BI pages ended before their official control");
  }
  const terminal = definition
    ? !decoded.continuation
      && nextRecordCount === stream.expected_record_count
    : nextRecordCount === stream.expected_record_count;
  if (
    definition
    && nextRecordCount === stream.expected_record_count
    && !terminal
  ) {
    return sourceError(`supplement ${definition.key} did not terminate at its control`);
  }
  const retained = await retainVeuAcquisitionFragment(
    context,
    acquisition.acquisition_id,
    {
      kind: "page",
      streamIndex: stream.stream_index,
      fragmentIndex: stream.page_count,
      requestSha256,
      cursorBefore: stream.last_record_id,
      cursorAfter,
      rowCount: decoded.rows.length,
      terminal,
    },
    response,
  );
  const ownership = acquisitionOwnershipBindings(context);
  const results = await context.database.batch([
    context.database.prepare(`UPDATE
        compliance_official_product_source_acquisitions
      SET response_count = response_count + 1,
        response_byte_length = response_byte_length + ?,
        revision = revision + 1, updated_at = ?
      WHERE registry_code = ? AND acquisition_id = ? AND revision = ?
        AND phase = 'pages' AND response_byte_length <= ?
        AND EXISTS (
          SELECT 1
          FROM compliance_official_product_source_acquisition_streams
          WHERE acquisition_id = ? AND stream_index = ? AND revision = ?
            AND page_count = ? AND record_count = ? AND last_record_id = ?
            AND terminal = 0
        ) AND ${acquisitionOwnershipPredicate()}`)
      .bind(
        retained.byteLength,
        context.checkedAt,
        context.registryCode,
        acquisition.acquisition_id,
        acquisition.revision,
        CREDITEX_VEU_ARTIFACT_MAXIMUM_BYTES - retained.byteLength,
        acquisition.acquisition_id,
        stream.stream_index,
        stream.revision,
        stream.page_count,
        stream.record_count,
        stream.last_record_id,
        ...ownership,
      ),
    context.database.prepare(`UPDATE
        compliance_official_product_source_acquisition_streams
      SET page_count = page_count + 1, record_count = ?, last_record_id = ?,
        terminal = ?, revision = revision + 1, updated_at = ?
      WHERE acquisition_id = ? AND stream_index = ? AND revision = ?
        AND EXISTS (
          SELECT 1 FROM compliance_official_product_source_acquisitions
          WHERE registry_code = ? AND acquisition_id = ? AND revision = ?
        ) AND ${acquisitionOwnershipPredicate()}`)
      .bind(
        nextRecordCount,
        cursorAfter,
        terminal ? 1 : 0,
        context.checkedAt,
        acquisition.acquisition_id,
        stream.stream_index,
        stream.revision,
        context.registryCode,
        acquisition.acquisition_id,
        acquisition.revision + 1,
        ...ownership,
      ),
    context.database.prepare(`INSERT INTO
        compliance_official_product_source_acquisition_fragments (
          acquisition_id, kind, stream_index, fragment_index, request_sha256,
          cursor_before, cursor_after, row_count, terminal, object_key,
          response_sha256, content_type, byte_length, created_at
        ) SELECT ?, 'page', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'application/json', ?, ?
        WHERE EXISTS (
          SELECT 1 FROM compliance_official_product_source_acquisitions
          WHERE registry_code = ? AND acquisition_id = ? AND revision = ?
        ) AND EXISTS (
          SELECT 1
          FROM compliance_official_product_source_acquisition_streams
          WHERE acquisition_id = ? AND stream_index = ? AND revision = ?
        ) AND ${acquisitionOwnershipPredicate()}`)
      .bind(
        acquisition.acquisition_id,
        stream.stream_index,
        stream.page_count,
        requestSha256,
        stream.last_record_id,
        cursorAfter,
        decoded.rows.length,
        terminal ? 1 : 0,
        retained.objectKey,
        retained.responseSha256,
        retained.byteLength,
        context.checkedAt,
        context.registryCode,
        acquisition.acquisition_id,
        acquisition.revision + 1,
        acquisition.acquisition_id,
        stream.stream_index,
        stream.revision + 1,
        ...ownership,
      ),
  ]);
  if (results.some((result) => Number(result.meta?.changes || 0) !== 1)) {
    acquisitionOwnershipLost(context);
  }
  return {
    acquisition: {
      ...acquisition,
      response_count: acquisition.response_count + 1,
      response_byte_length:
        acquisition.response_byte_length + retained.byteLength,
      revision: acquisition.revision + 1,
      updated_at: context.checkedAt,
    },
    stream: {
      ...stream,
      page_count: stream.page_count + 1,
      record_count: nextRecordCount,
      last_record_id: cursorAfter,
      terminal: terminal ? 1 : 0,
      revision: stream.revision + 1,
      updated_at: context.checkedAt,
    },
  } as const;
}

async function markVeuAcquisitionReadyToAssemble(
  context: CreditexOfficialProductSourceAcquisitionContext,
  acquisition: VeuAcquisitionRow,
) {
  if (acquisition.phase === "assemble") return acquisition;
  const ownership = acquisitionOwnershipBindings(context);
  const result = await context.database.prepare(`UPDATE
      compliance_official_product_source_acquisitions
    SET phase = 'assemble', revision = revision + 1, updated_at = ?
    WHERE registry_code = ? AND acquisition_id = ? AND revision = ?
      AND NOT EXISTS (
        SELECT 1 FROM compliance_official_product_source_acquisition_streams
        WHERE acquisition_id = ? AND terminal = 0
      ) AND ${acquisitionOwnershipPredicate()}`)
    .bind(
      context.checkedAt,
      context.registryCode,
      acquisition.acquisition_id,
      acquisition.revision,
      acquisition.acquisition_id,
      ...ownership,
    )
    .run();
  if (Number(result.meta?.changes || 0) !== 1) {
    acquisitionOwnershipLost(context);
  }
  return {
    ...acquisition,
    phase: "assemble" as const,
    revision: acquisition.revision + 1,
    updated_at: context.checkedAt,
  };
}

async function acquireVeuStaticControlsDurably(
  fetchImpl: CreditexOfficialProductFetch,
  context: CreditexOfficialProductSourceAcquisitionContext,
  clusterUrl: string,
  embedToken: string,
  acquisition: VeuAcquisitionRow,
  fetched: { count: number },
) {
  const modelPath = `/explore/reports/${CREDITEX_VEU_REPORT_ID}/modelsAndExploration?preferReadOnlySession=true&datasetObjectId=${CREDITEX_VEU_DATASET_ID}&skipQueryData=true`;
  let current = acquisition;
  const modelFragment = await loadVeuAcquisitionFragment(
    context,
    acquisition.acquisition_id,
    "model",
    -1,
    0,
  );
  if (!modelFragment) {
    assertAcquisitionFetchBudget(context, fetched.count);
    const response = await powerBiText(
      fetchImpl,
      clusterUrl,
      embedToken,
      modelPath,
      { method: "GET" },
      "Power BI model response",
      4_000_000,
    );
    validateCreditexVeuPowerBiModel(response);
    await persistVeuStaticFragment(
      context,
      current,
      {
        kind: "model",
        streamIndex: -1,
        fragmentIndex: 0,
        requestSha256: await veuRequestSha256("GET", modelPath),
      },
      response,
    );
    fetched.count += 1;
    current = (await loadVeuAcquisition(context))!;
  }
  const schemaFragment = await loadVeuAcquisitionFragment(
    context,
    acquisition.acquisition_id,
    "schema",
    -1,
    0,
  );
  if (!schemaFragment) {
    assertAcquisitionFetchBudget(context, fetched.count);
    const body = JSON.stringify({
      ModelObjectIds: [CREDITEX_VEU_DATASET_ID],
      userPreferredLocale: "en",
    });
    const response = await powerBiText(
      fetchImpl,
      clusterUrl,
      embedToken,
      "/explore/conceptualschema",
      { method: "POST", headers: { "Content-Type": "application/json" }, body },
      "Power BI conceptual schema response",
      12_000_000,
    );
    validateCreditexVeuPowerBiSchema(response);
    await persistVeuStaticFragment(
      context,
      current,
      {
        kind: "schema",
        streamIndex: -1,
        fragmentIndex: 0,
        requestSha256: await veuRequestSha256(
          "POST",
          "/explore/conceptualschema",
          body,
        ),
      },
      response,
    );
    fetched.count += 1;
    current = (await loadVeuAcquisition(context))!;
  }
  return current;
}

async function advanceVeuStreamDurably(
  fetchImpl: CreditexOfficialProductFetch,
  context: CreditexOfficialProductSourceAcquisitionContext,
  clusterUrl: string,
  embedToken: string,
  acquisition: VeuAcquisitionRow,
  stream: VeuAcquisitionStreamRow,
  fetched: { count: number },
  definition?: VeuSupplementalQuery,
) {
  let currentAcquisition = acquisition;
  let currentStream = stream;
  while (!currentStream.terminal) {
    assertAcquisitionFetchBudget(context, fetched.count);
    const afterId = currentStream.last_record_id || null;
    const filter = definition
      ? "productIds" in definition
        ? { property: "Product_ID__c", values: definition.productIds }
        : {
            property: "Product_Category_Number__c",
            values: definition.categories,
          }
      : undefined;
    const fields = definition?.fields || CREDITEX_VEU_QUERY_FIELDS;
    const fieldTypes = definition
      ? supplementalFieldTypes(definition)
      : CREDITEX_VEU_QUERY_FIELD_TYPES;
    const query = productQuery(afterId, fields, filter);
    const response = await queryPowerBi(
      fetchImpl,
      clusterUrl,
      embedToken,
      query,
      definition
        ? `Power BI ${definition.key} supplement page ${currentStream.page_count + 1}`
        : `Power BI product page ${currentStream.page_count + 1}`,
    );
    const decoded = decodeCreditexVeuPowerBiProductPage(
      response,
      fields,
      fieldTypes,
      CREDITEX_VEU_PAGE_SIZE,
    );
    const persisted = await persistVeuPageFragment(
      context,
      currentAcquisition,
      currentStream,
      await veuRequestSha256(
        "POST",
        "/explore/querydata?synchronous=true",
        JSON.stringify(query),
      ),
      response,
      decoded,
      definition,
    );
    fetched.count += 1;
    currentAcquisition = persisted.acquisition;
    currentStream = persisted.stream;
  }
  return { acquisition: currentAcquisition, stream: currentStream } as const;
}

async function advanceVeuAcquisitionDurably(
  fetchImpl: CreditexOfficialProductFetch,
  context: CreditexOfficialProductSourceAcquisitionContext,
  clusterUrl: string,
  embedToken: string,
  acquisition: VeuAcquisitionRow,
) {
  if (acquisition.phase === "assemble") return acquisition;
  const fetched = { count: 0 };
  let current = await acquireVeuStaticControlsDurably(
    fetchImpl,
    context,
    clusterUrl,
    embedToken,
    acquisition,
    fetched,
  );
  let streams = await loadVeuAcquisitionStreams(
    context,
    acquisition.acquisition_id,
  );
  if (
    streams.length !== CREDITEX_VEU_SUPPLEMENTAL_QUERIES.length + 1
    || streams.some((stream, index) => stream.stream_index !== index)
  ) {
    return sourceError("durable source acquisition stream contract changed");
  }
  if (!streams[0].terminal) {
    const advanced = await advanceVeuStreamDurably(
      fetchImpl,
      context,
      clusterUrl,
      embedToken,
      current,
      streams[0],
      fetched,
    );
    current = advanced.acquisition;
    streams = [advanced.stream, ...streams.slice(1)];
  }
  for (
    let index = 0;
    index < CREDITEX_VEU_SUPPLEMENTAL_QUERIES.length;
    index += 1
  ) {
    if (streams[index + 1].terminal) continue;
    const advanced = await advanceVeuStreamDurably(
      fetchImpl,
      context,
      clusterUrl,
      embedToken,
      current,
      streams[index + 1],
      fetched,
      CREDITEX_VEU_SUPPLEMENTAL_QUERIES[index],
    );
    current = advanced.acquisition;
    streams = [
      ...streams.slice(0, index + 1),
      advanced.stream,
      ...streams.slice(index + 2),
    ];
  }
  if (streams.some((stream) => !stream.terminal)) {
    throw new VeuAcquisitionYield();
  }
  return markVeuAcquisitionReadyToAssemble(context, current);
}

async function loadAllVeuAcquisitionFragments(
  context: CreditexOfficialProductSourceAcquisitionContext,
  acquisitionId: string,
) {
  const result = await context.database.prepare(`SELECT acquisition_id, kind,
      stream_index, fragment_index, request_sha256, cursor_before,
      cursor_after, row_count, terminal, object_key, response_sha256,
      content_type, byte_length, created_at
    FROM compliance_official_product_source_acquisition_fragments
    WHERE acquisition_id = ?
    ORDER BY CASE kind
      WHEN 'control' THEN 0 WHEN 'model' THEN 1 WHEN 'schema' THEN 2 ELSE 3 END,
      stream_index, fragment_index`)
    .bind(acquisitionId)
    .all<VeuAcquisitionFragmentRow>();
  return result.results || [];
}

function exactFragment(
  fragments: readonly VeuAcquisitionFragmentRow[],
  kind: VeuAcquisitionFragmentRow["kind"],
  streamIndex: number,
  fragmentIndex: number,
) {
  const matches = fragments.filter((fragment) => (
    fragment.kind === kind
    && fragment.stream_index === streamIndex
    && fragment.fragment_index === fragmentIndex
  ));
  if (matches.length !== 1) {
    return sourceError("durable source acquisition fragment set is incomplete");
  }
  return matches[0];
}

async function assertFragmentRequest(
  fragment: VeuAcquisitionFragmentRow,
  expected: Promise<string> | string,
) {
  if (fragment.request_sha256 !== await expected) {
    return sourceError("durable source acquisition request custody changed");
  }
}

type VeuAssemblyRecordPlan =
  | Readonly<{ kind: "header" }>
  | Readonly<{ kind: "model" }>
  | Readonly<{ kind: "schema" }>
  | Readonly<{ kind: "page"; streamIndex: number; pageIndex: number }>
  | Readonly<{ kind: "supplement"; streamIndex: number }>;

function veuAssemblyPlan(
  streams: readonly VeuAcquisitionStreamRow[],
): readonly VeuAssemblyRecordPlan[] {
  const plan: VeuAssemblyRecordPlan[] = [
    { kind: "header" },
    { kind: "model" },
    { kind: "schema" },
  ];
  for (const stream of streams) {
    if (stream.stream_index > 0) {
      plan.push({ kind: "supplement", streamIndex: stream.stream_index });
    }
    for (let pageIndex = 0; pageIndex < stream.page_count; pageIndex += 1) {
      plan.push({ kind: "page", streamIndex: stream.stream_index, pageIndex });
    }
  }
  return plan;
}

function filteredSupplementControlFragmentIndex(streamIndex: number) {
  let fragmentIndex = 4;
  for (let index = 0; index < streamIndex - 1; index += 1) {
    if ("productIds" in CREDITEX_VEU_SUPPLEMENTAL_QUERIES[index]) {
      fragmentIndex += 1;
    }
  }
  return fragmentIndex;
}

async function validateRetainedVeuControls(
  context: CreditexOfficialProductSourceAcquisitionContext,
  acquisition: VeuAcquisitionRow,
  fragments: readonly VeuAcquisitionFragmentRow[],
  definitionSha256: string,
) {
  const controlQueries = [
    totalQuery(),
    groupedQuery("Product_Status__c"),
    groupedQuery("Product_Category_Number__c"),
    refreshQuery(),
  ];
  const controlResponses = await Promise.all(controlQueries.map(async (query, index) => {
    const fragment = exactFragment(fragments, "control", -1, index);
    await assertFragmentRequest(
      fragment,
      veuRequestSha256(
        "POST",
        "/explore/querydata?synchronous=true",
        JSON.stringify(controlQueries[index]),
      ),
    );
    return readVeuAcquisitionFragment(context, fragment);
  }));
  const supplementalControls: Record<string, { count: number; response: string }> = {};
  for (let index = 0; index < CREDITEX_VEU_SUPPLEMENTAL_QUERIES.length; index += 1) {
    const definition = CREDITEX_VEU_SUPPLEMENTAL_QUERIES[index];
    if (!("productIds" in definition)) continue;
    const fragment = exactFragment(
      fragments,
      "control",
      -1,
      filteredSupplementControlFragmentIndex(index + 1),
    );
    const query = totalQuery({
      property: "Product_ID__c",
      values: definition.productIds,
    });
    await assertFragmentRequest(
      fragment,
      veuRequestSha256(
        "POST",
        "/explore/querydata?synchronous=true",
        JSON.stringify(query),
      ),
    );
    const response = await readVeuAcquisitionFragment(context, fragment);
    supplementalControls[definition.key] = {
      count: decodeCreditexVeuPowerBiAggregateCount(response),
      response,
    };
  }
  const controls = validatePowerBiControls(
    controlResponses[0],
    controlResponses[1],
    controlResponses[2],
    controlResponses[3],
    supplementalControls,
  );
  if (!acquisitionMatchesControls(acquisition, controls, definitionSha256)) {
    return sourceError("durable source acquisition controls no longer reconcile");
  }
  return controls;
}

async function veuAssemblyRecord(
  context: CreditexOfficialProductSourceAcquisitionContext,
  acquisition: VeuAcquisitionRow,
  streams: readonly VeuAcquisitionStreamRow[],
  fragments: readonly VeuAcquisitionFragmentRow[],
  definitionSha256: string,
  plan: VeuAssemblyRecordPlan,
): Promise<JsonObject> {
  assertAcquisitionActive(context);
  if (plan.kind === "header") {
    const controls = await validateRetainedVeuControls(
      context,
      acquisition,
      fragments,
      definitionSha256,
    );
    return {
      recordType: "header",
      contract: CREDITEX_VEU_BOUNDED_STREAM_ARTIFACT_CONTRACT,
      sourceKey: CREDITEX_VEU_PUBLIC_REGISTRY_SOURCE_KEY,
      reportId: CREDITEX_VEU_REPORT_ID,
      datasetId: CREDITEX_VEU_DATASET_ID,
      modelId: CREDITEX_VEU_MODEL_ID,
      sourceRefreshedAt: controls.sourceRefreshedAt,
      queryFields: CREDITEX_VEU_QUERY_FIELDS,
      controls: {
        total: controls.total,
        statuses: controls.statusControl,
        categories: controls.categoryControl,
        totalResponse: controls.totalResponse,
        statusResponse: controls.statusResponse,
        categoryResponse: controls.categoryResponse,
        refreshResponse: controls.refreshResponse,
      },
    };
  }
  const modelPath = `/explore/reports/${CREDITEX_VEU_REPORT_ID}/modelsAndExploration?preferReadOnlySession=true&datasetObjectId=${CREDITEX_VEU_DATASET_ID}&skipQueryData=true`;
  if (plan.kind === "model") {
    const modelFragment = exactFragment(fragments, "model", -1, 0);
    await assertFragmentRequest(
      modelFragment,
      veuRequestSha256("GET", modelPath),
    );
    const modelResponse = await readVeuAcquisitionFragment(context, modelFragment);
    validateCreditexVeuPowerBiModel(modelResponse);
    return { recordType: "control", key: "modelResponse", response: modelResponse };
  }
  const schemaBody = JSON.stringify({
    ModelObjectIds: [CREDITEX_VEU_DATASET_ID],
    userPreferredLocale: "en",
  });
  if (plan.kind === "schema") {
    const schemaFragment = exactFragment(fragments, "schema", -1, 0);
    await assertFragmentRequest(
      schemaFragment,
      veuRequestSha256("POST", "/explore/conceptualschema", schemaBody),
    );
    const response = await readVeuAcquisitionFragment(context, schemaFragment);
    validateCreditexVeuPowerBiSchema(response);
    return { recordType: "control", key: "conceptualSchemaResponse", response };
  }
  const stream = streams[plan.streamIndex];
  const definition = plan.streamIndex === 0
    ? undefined
    : CREDITEX_VEU_SUPPLEMENTAL_QUERIES[plan.streamIndex - 1];
  if (!stream || stream.stream_index !== plan.streamIndex) {
    return sourceError("durable source acquisition stream order changed");
  }
  if (plan.kind === "supplement") {
    if (!definition) return sourceError("durable supplement definition is missing");
    let controlResponse: string | undefined;
    if ("productIds" in definition) {
      const fragment = exactFragment(
        fragments,
        "control",
        -1,
        filteredSupplementControlFragmentIndex(plan.streamIndex),
      );
      const query = totalQuery({
        property: "Product_ID__c",
        values: definition.productIds,
      });
      await assertFragmentRequest(
        fragment,
        veuRequestSha256(
          "POST",
          "/explore/querydata?synchronous=true",
          JSON.stringify(query),
        ),
      );
      controlResponse = await readVeuAcquisitionFragment(context, fragment);
      if (
        decodeCreditexVeuPowerBiAggregateCount(controlResponse)
          !== stream.expected_record_count
      ) {
        return sourceError(`supplement ${definition.key} count control changed`);
      }
    }
    return {
      recordType: "supplement",
      key: definition.key,
      queryFields: definition.fields,
      expectedCount: stream.expected_record_count,
      ...(controlResponse ? { controlResponse } : {}),
    };
  }
  const fragment = exactFragment(
    fragments,
    "page",
    plan.streamIndex,
    plan.pageIndex,
  );
  const priorFragments = fragments.filter((candidate) => (
    candidate.kind === "page"
    && candidate.stream_index === plan.streamIndex
    && candidate.fragment_index < plan.pageIndex
  ));
  if (priorFragments.length !== plan.pageIndex) {
    return sourceError("durable source acquisition page chain is incomplete");
  }
  const rowCountBefore = priorFragments.reduce(
    (total, candidate) => total + Number(candidate.row_count),
    0,
  );
  const cursor = plan.pageIndex === 0
    ? ""
    : exactFragment(
        fragments,
        "page",
        plan.streamIndex,
        plan.pageIndex - 1,
      ).cursor_after;
  const filter = definition
    ? "productIds" in definition
      ? { property: "Product_ID__c", values: definition.productIds }
      : {
          property: "Product_Category_Number__c",
          values: definition.categories,
        }
    : undefined;
  const fields = definition?.fields || CREDITEX_VEU_QUERY_FIELDS;
  const fieldTypes = definition
    ? supplementalFieldTypes(definition)
    : CREDITEX_VEU_QUERY_FIELD_TYPES;
  const query = productQuery(cursor || null, fields, filter);
  await assertFragmentRequest(
    fragment,
    veuRequestSha256(
      "POST",
      "/explore/querydata?synchronous=true",
      JSON.stringify(query),
    ),
  );
  if (fragment.cursor_before !== cursor) {
    return sourceError("durable source acquisition cursor chain changed");
  }
  const response = await readVeuAcquisitionFragment(context, fragment);
  const decoded = decodeCreditexVeuPowerBiProductPage(
    response,
    fields,
    fieldTypes,
    CREDITEX_VEU_PAGE_SIZE,
  );
  const cursorAfter = validateDurablePageIdentity(decoded, cursor, definition);
  const rowCountAfter = rowCountBefore + decoded.rows.length;
  const terminal = definition
    ? !decoded.continuation && rowCountAfter === stream.expected_record_count
    : rowCountAfter === stream.expected_record_count;
  if (
    fragment.cursor_after !== cursorAfter
    || Number(fragment.row_count) !== decoded.rows.length
    || Boolean(fragment.terminal) !== terminal
    || (terminal && cursorAfter !== stream.last_record_id)
    || (terminal && rowCountAfter !== stream.record_count)
  ) {
    return sourceError("durable source acquisition page receipt changed");
  }
  return definition
    ? {
        recordType: "supplement-page",
        key: definition.key,
        afterId: cursor || null,
        response,
      }
    : { recordType: "page", afterId: cursor || null, response };
}

function validateVeuAssemblyReceipts(
  acquisition: VeuAcquisitionRow,
  fragments: readonly VeuAcquisitionFragmentRow[],
  planLength: number,
) {
  const assembly = fragments
    .filter((fragment) => fragment.kind === "assembly")
    .sort((left, right) => left.fragment_index - right.fragment_index);
  let recordCount = 0;
  let byteLength = 0;
  assembly.forEach((fragment, index) => {
    const nextRecordCount = recordCount + Number(fragment.row_count);
    if (
      fragment.fragment_index !== index
      || fragment.cursor_before !== String(recordCount)
      || fragment.cursor_after !== String(nextRecordCount)
      || Number(fragment.row_count) < 1
      || Boolean(fragment.terminal) !== (nextRecordCount === planLength)
    ) {
      return sourceError("durable assembly receipt chain changed");
    }
    recordCount = nextRecordCount;
    byteLength += Number(fragment.byte_length);
  });
  if (
    assembly.length !== acquisition.assembly_chunk_count
    || recordCount !== acquisition.assembly_record_count
    || byteLength !== acquisition.assembly_byte_length
    || recordCount > planLength
  ) {
    return sourceError("durable assembly progress did not reconcile");
  }
  return assembly;
}

async function persistVeuAssemblyChunk(
  context: CreditexOfficialProductSourceAcquisitionContext,
  acquisition: VeuAcquisitionRow,
  bytes: Uint8Array,
  recordCount: number,
  planLength: number,
) {
  const nextRecordCount = acquisition.assembly_record_count + recordCount;
  const terminal = nextRecordCount === planLength;
  const retained = await retainVeuAcquisitionFragment(
    context,
    acquisition.acquisition_id,
    {
      kind: "assembly",
      streamIndex: -1,
      fragmentIndex: acquisition.assembly_chunk_count,
      requestSha256: await veuSha256(JSON.stringify({
        contract: VEU_SOURCE_ACQUISITION_CONTRACT,
        definitionSha256: acquisition.definition_sha256,
        start: acquisition.assembly_record_count,
        end: nextRecordCount,
        bytesSha256: await veuSha256(bytes),
      })),
      cursorBefore: String(acquisition.assembly_record_count),
      cursorAfter: String(nextRecordCount),
      rowCount: recordCount,
      terminal,
    },
    bytes,
  );
  const nextPhase = terminal ? "ready" : "assemble";
  const ownership = acquisitionOwnershipBindings(context);
  const results = await context.database.batch([
    context.database.prepare(`UPDATE
        compliance_official_product_source_acquisitions
      SET phase = ?, assembly_record_count = ?,
        assembly_chunk_count = assembly_chunk_count + 1,
        assembly_byte_length = assembly_byte_length + ?, revision = revision + 1,
        updated_at = ?
      WHERE registry_code = ? AND acquisition_id = ? AND revision = ?
        AND phase = 'assemble' AND assembly_record_count = ?
        AND assembly_chunk_count = ? AND assembly_byte_length <= ?
        AND ${acquisitionOwnershipPredicate()}`)
      .bind(
        nextPhase,
        nextRecordCount,
        retained.byteLength,
        context.checkedAt,
        context.registryCode,
        acquisition.acquisition_id,
        acquisition.revision,
        acquisition.assembly_record_count,
        acquisition.assembly_chunk_count,
        CREDITEX_VEU_ARTIFACT_MAXIMUM_BYTES - retained.byteLength,
        ...ownership,
      ),
    context.database.prepare(`INSERT INTO
        compliance_official_product_source_acquisition_fragments (
          acquisition_id, kind, stream_index, fragment_index, request_sha256,
          cursor_before, cursor_after, row_count, terminal, object_key,
          response_sha256, content_type, byte_length, created_at
        ) SELECT ?, 'assembly', -1, ?, ?, ?, ?, ?, ?, ?, ?,
          'application/json', ?, ?
        WHERE EXISTS (
          SELECT 1 FROM compliance_official_product_source_acquisitions
          WHERE registry_code = ? AND acquisition_id = ? AND revision = ?
        ) AND ${acquisitionOwnershipPredicate()}`)
      .bind(
        acquisition.acquisition_id,
        acquisition.assembly_chunk_count,
        retained.requestSha256,
        retained.cursorBefore,
        retained.cursorAfter,
        retained.rowCount,
        retained.terminal ? 1 : 0,
        retained.objectKey,
        retained.responseSha256,
        retained.byteLength,
        context.checkedAt,
        context.registryCode,
        acquisition.acquisition_id,
        acquisition.revision + 1,
        ...ownership,
      ),
  ]);
  if (results.some((result) => Number(result.meta?.changes || 0) !== 1)) {
    acquisitionOwnershipLost(context);
  }
  return {
    ...acquisition,
    phase: nextPhase,
    assembly_record_count: nextRecordCount,
    assembly_chunk_count: acquisition.assembly_chunk_count + 1,
    assembly_byte_length: acquisition.assembly_byte_length + retained.byteLength,
    revision: acquisition.revision + 1,
    updated_at: context.checkedAt,
  } as VeuAcquisitionRow;
}

async function advanceVeuAssemblyDurably(
  context: CreditexOfficialProductSourceAcquisitionContext,
  acquisition: VeuAcquisitionRow,
  definitionSha256: string,
) {
  if (acquisition.phase === "ready") return acquisition;
  if (acquisition.phase !== "assemble") {
    return sourceError("durable source acquisition is not ready to assemble");
  }
  const streams = await loadVeuAcquisitionStreams(context, acquisition.acquisition_id);
  const fragments = await loadAllVeuAcquisitionFragments(
    context,
    acquisition.acquisition_id,
  );
  if (
    streams.length !== CREDITEX_VEU_SUPPLEMENTAL_QUERIES.length + 1
    || streams.some((stream, index) => stream.stream_index !== index || !stream.terminal)
    || acquisition.definition_sha256 !== definitionSha256
  ) {
    return sourceError("durable source acquisition assembly contract changed");
  }
  const rawFragments = fragments.filter((fragment) => fragment.kind !== "assembly");
  if (
    rawFragments.length !== acquisition.response_count
    || rawFragments.reduce((total, fragment) => total + Number(fragment.byte_length), 0)
      !== acquisition.response_byte_length
  ) {
    return sourceError("durable source acquisition raw custody did not reconcile");
  }
  const plan = veuAssemblyPlan(streams);
  validateVeuAssemblyReceipts(acquisition, fragments, plan.length);
  let current = acquisition;
  for (let chunk = 0; chunk < 2 && current.phase === "assemble"; chunk += 1) {
    if (Date.now() >= context.yieldAt - 500) throw new VeuAcquisitionYield();
    const writer = new BoundedVeuArtifactWriter();
    let recordCount = 0;
    while (
      current.assembly_record_count + recordCount < plan.length
      && recordCount < CREDITEX_VEU_DURABLE_ASSEMBLY_MAX_RECORDS_PER_QUANTUM
    ) {
      if (recordCount > 0 && Date.now() >= context.yieldAt - 500) break;
      writer.append(await veuAssemblyRecord(
        context,
        current,
        streams,
        fragments,
        definitionSha256,
        plan[current.assembly_record_count + recordCount],
      ));
      recordCount += 1;
    }
    if (recordCount < 1) throw new VeuAcquisitionYield();
    current = await persistVeuAssemblyChunk(
      context,
      current,
      writer.finish(),
      recordCount,
      plan.length,
    );
  }
  return current;
}

async function readCompletedVeuAssembly(
  context: CreditexOfficialProductSourceAcquisitionContext,
  acquisition: VeuAcquisitionRow,
  definitionSha256: string,
) {
  if (
    acquisition.phase !== "ready"
    || acquisition.definition_sha256 !== definitionSha256
  ) {
    return sourceError("durable source acquisition is not ready for finalization");
  }
  const streams = await loadVeuAcquisitionStreams(context, acquisition.acquisition_id);
  const fragments = await loadAllVeuAcquisitionFragments(
    context,
    acquisition.acquisition_id,
  );
  const plan = veuAssemblyPlan(streams);
  const assembly = validateVeuAssemblyReceipts(acquisition, fragments, plan.length);
  if (acquisition.assembly_record_count !== plan.length || assembly.length < 1) {
    return sourceError("durable source acquisition final assembly is incomplete");
  }
  assertAcquisitionActive(context);
  const chunks = await Promise.all(assembly.map((fragment) => (
    readVeuAcquisitionFragmentBytes(context, fragment)
  )));
  const bytes = new Uint8Array(acquisition.assembly_byte_length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  if (offset !== bytes.byteLength) {
    return sourceError("durable source acquisition final byte count changed");
  }
  return bytes;
}

export async function acquireCreditexVeuPowerBiEvidenceDurably(
  fetchImpl: CreditexOfficialProductFetch,
  acquisitionContext: CreditexOfficialProductSourceAcquisitionContext,
  clusterUrl: string,
  embedToken: string,
): Promise<CreditexOfficialProductSourceAcquisitionResult> {
  try {
    const resumed = await resumeVeuAcquisitionWithoutUpstream(acquisitionContext);
    if (resumed) return resumed;
    const definitionSha256 = await veuAcquisitionDefinitionSha256();
    const freshControls = await fetchPowerBiControls(
      fetchImpl,
      clusterUrl,
      embedToken,
    );
    let acquisition = await ensureVeuAcquisition(
      acquisitionContext,
      freshControls,
      definitionSha256,
    );
    assertVeuAcquisitionSourceCurrent(acquisition);
    acquisition = await advanceVeuAcquisitionDurably(
      fetchImpl,
      acquisitionContext,
      clusterUrl,
      embedToken,
      acquisition,
    );
    if (acquisition.phase === "assemble") {
      acquisition = await advanceVeuAssemblyDurably(
        acquisitionContext,
        acquisition,
        definitionSha256,
      );
    }
    if (acquisition.phase !== "ready") throw new VeuAcquisitionYield();
    if (Date.now() >= acquisitionContext.yieldAt - 500) {
      throw new VeuAcquisitionYield();
    }
    const bytes = await readCompletedVeuAssembly(
      acquisitionContext,
      acquisition,
      definitionSha256,
    );
    return {
      complete: true,
      acquisitionId: acquisition.acquisition_id,
      cleanupRetainedFragments: true,
      sources: [{
        sourceKey: CREDITEX_VEU_PUBLIC_REGISTRY_SOURCE_KEY,
        contentType: "application/json",
        bytes,
      }],
    };
  } catch (error) {
    if (!(error instanceof VeuAcquisitionYield)) {
      if (!isVeuSourceError(error)) throw error;
      const retained = await loadVeuAcquisition(acquisitionContext);
      if (!retained) throw error;
      await markVeuAcquisitionForCleanup(acquisitionContext, retained);
    }
    return incompleteVeuAcquisitionResult(acquisitionContext);
  }
}

async function incompleteVeuAcquisitionResult(
  context: CreditexOfficialProductSourceAcquisitionContext,
): Promise<Extract<CreditexOfficialProductSourceAcquisitionResult, {
  complete: false;
}>> {
  const retained = await loadVeuAcquisition(context);
  if (!retained) {
    return sourceError("durable source acquisition progress was lost");
  }
  const streams = await loadVeuAcquisitionStreams(
    context,
    retained.acquisition_id,
  );
  const products = streams.find((stream) => stream.stream_index === 0);
  return {
    complete: false,
    acquisitionId: retained.acquisition_id,
    recordCount: retained.total_record_count,
    stagedRecordCount: Number(products?.record_count || 0),
  };
}

async function resumeVeuAcquisitionWithoutUpstream(
  context: CreditexOfficialProductSourceAcquisitionContext,
): Promise<CreditexOfficialProductSourceAcquisitionResult | null> {
  let acquisition = await loadVeuAcquisition(context);
  if (!acquisition) return null;
  try {
    const definitionSha256 = await veuAcquisitionDefinitionSha256();
    if (acquisition.definition_sha256 !== definitionSha256) {
      await markVeuAcquisitionForCleanup(context, acquisition);
      throw new VeuAcquisitionYield();
    }
    if (acquisition.phase === "cleanup") throw new VeuAcquisitionYield();
    assertVeuAcquisitionSourceCurrent(acquisition);
    if (acquisition.phase === "pages") return null;
    if (acquisition.phase === "assemble") {
      acquisition = await advanceVeuAssemblyDurably(
        context,
        acquisition,
        definitionSha256,
      );
    }
    if (acquisition.phase !== "ready") throw new VeuAcquisitionYield();
    if (Date.now() >= context.yieldAt - 500) throw new VeuAcquisitionYield();
    const bytes = await readCompletedVeuAssembly(
      context,
      acquisition,
      definitionSha256,
    );
    return {
      complete: true,
      acquisitionId: acquisition.acquisition_id,
      cleanupRetainedFragments: true,
      sources: [{
        sourceKey: CREDITEX_VEU_PUBLIC_REGISTRY_SOURCE_KEY,
        contentType: "application/json",
        bytes,
      }],
    };
  } catch (error) {
    if (!(error instanceof VeuAcquisitionYield)) {
      if (!isVeuSourceError(error)) throw error;
      await markVeuAcquisitionForCleanup(context, acquisition);
    }
    return incompleteVeuAcquisitionResult(context);
  }
}

export async function fetchCreditexVeuProductSources(
  fetchImpl: CreditexOfficialProductFetch,
  acquisitionContext?: CreditexOfficialProductSourceAcquisitionContext,
): Promise<
  | readonly CreditexFetchedOfficialProductSource[]
  | CreditexOfficialProductSourceAcquisitionResult
> {
  if (acquisitionContext) {
    const resumed = await resumeVeuAcquisitionWithoutUpstream(acquisitionContext);
    if (resumed) return resumed;
  }
  const jar = new BoundedCookieJar();
  const html = await fetchSalesforceText(
    fetchImpl,
    jar,
    VEU_PUBLIC_REGISTRY_URL,
    { method: "GET", headers: { Accept: "text/html" } },
    "VEU public registry page",
    200_000,
    TEXT_HTML,
  );
  const context = auraContext(html);
  const nonce = crypto.randomUUID().replace(/-/g, "");
  const replayToken = await auraAction(
    fetchImpl,
    jar,
    context,
    101,
    "PowerBiReplayDetectionGuest",
    "getToken",
    { nonce, timestamp: Date.now() },
  );
  requiredText(replayToken, "Aura replay token", 20_000);
  const embed = await auraAction(
    fetchImpl,
    jar,
    context,
    102,
    "PowerBiEmbedManagerGuest",
    "getEmbeddingDataForReportUsingDataSets",
    {
      ReportWorkspaceId: VEU_REPORT_WORKSPACE_ID,
      ReportId: CREDITEX_VEU_REPORT_ID,
      DataSetWorkspaceId: VEU_DATASET_WORKSPACE_ID,
      DataSetId: CREDITEX_VEU_DATASET_ID,
    },
  );
  const { clusterUrl, embedToken } = embeddingData(embed);
  if (acquisitionContext) {
    return acquireCreditexVeuPowerBiEvidenceDurably(
      fetchImpl,
      acquisitionContext,
      clusterUrl,
      embedToken,
    );
  }
  const bytes = await acquirePowerBiEvidence(
    fetchImpl,
    clusterUrl,
    embedToken,
  );
  return [{
    sourceKey: CREDITEX_VEU_PUBLIC_REGISTRY_SOURCE_KEY,
    contentType: "application/json",
    bytes,
  }];
}

export const CREDITEX_VEU_PRODUCT_SOURCE:
CreditexOfficialProductSourceDefinition = {
  registryCode: "veu-approved-products",
  sourceKey: CREDITEX_VEU_PUBLIC_REGISTRY_SOURCE_KEY,
  productKinds: CREDITEX_VEU_PRODUCT_KINDS,
  url: VEU_PUBLIC_REGISTRY_URL,
  minimumRecords: 70_000,
  maximumBytes: CREDITEX_VEU_ARTIFACT_MAXIMUM_BYTES,
  expectedContentTypes: ["application/json"],
  accept: "application/json",
  licence: [
    "Essential Services Commission Victoria",
    "official VEU public product register",
    VEU_PUBLIC_REGISTRY_URL,
    "captured as immutable regulator evidence with exact response payloads retained",
  ].join(" | "),
  productionMode: "automatic",
  requiresOfficialEligibleFrom: true,
  parse: parseCreditexVeuProductArtifact,
  streamingParser: CREDITEX_VEU_STREAMING_PARSER,
};

export const CREDITEX_VEU_PRODUCT_REGISTRY_FETCH =
  fetchCreditexVeuProductSources;

export const CREDITEX_VEU_SCHEMA_PROPERTY_COUNT =
  Object.keys(CREDITEX_VEU_DIM_PRODUCT_SCHEMA).length;
