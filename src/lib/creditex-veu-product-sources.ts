import type {
  CreditexFetchedOfficialProductSource,
  CreditexOfficialProductFetch,
  CreditexOfficialProductSourceDefinition,
} from "./creditex-official-product-registry-server.ts";
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
const VEU_SOURCE_FRESHNESS_MS = 48 * 60 * 60 * 1_000;
const VEU_FUTURE_TOLERANCE_MS = 10 * 60 * 1_000;

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

function totalQuery() {
  return queryEnvelope({
    Query: {
      Version: 2,
      From: [{ Name: "d", Entity: "Dim_Product", Type: 0 }],
      Where: publicVisibleWhere(),
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
  writer: BoundedVeuArtifactWriter,
) {
  const expectedCount = definition.categories.reduce(
    (sum, category) => sum + (categoryCounts[category] || 0),
    0,
  );
  if (expectedCount === 0) {
    writer.append({
      recordType: "supplement",
      key: definition.key,
      queryFields: definition.fields,
      expectedCount,
    });
    return;
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
  writer.append({
    recordType: "supplement",
    key: definition.key,
    queryFields: definition.fields,
    expectedCount,
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
    writer.append({
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
}

async function acquirePowerBiEvidence(
  fetchImpl: CreditexOfficialProductFetch,
  clusterUrl: string,
  embedToken: string,
) {
  const modelPath = `/explore/reports/${CREDITEX_VEU_REPORT_ID}/modelsAndExploration?preferReadOnlySession=true&datasetObjectId=${CREDITEX_VEU_DATASET_ID}&skipQueryData=true`;
  const [totalResponse, statusResponse, categoryResponse, refreshResponse] =
    await Promise.all([
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
    ]);
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
  const statusControl = {
    Approved: statuses.groups.Approved || 0,
    Legacy: statuses.groups.Legacy || 0,
  };
  const categoryControl = Object.fromEntries(
    [...allowedCategories].map((category) => [
      category,
      categories.groups[category] || 0,
    ]),
  );
  const writer = new BoundedVeuArtifactWriter();
  writer.append({
    recordType: "header",
    contract: CREDITEX_VEU_BOUNDED_STREAM_ARTIFACT_CONTRACT,
    sourceKey: CREDITEX_VEU_PUBLIC_REGISTRY_SOURCE_KEY,
    reportId: CREDITEX_VEU_REPORT_ID,
    datasetId: CREDITEX_VEU_DATASET_ID,
    modelId: CREDITEX_VEU_MODEL_ID,
    sourceRefreshedAt: refreshed.utc,
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
  for (const definition of CREDITEX_VEU_SUPPLEMENTAL_QUERIES) {
    await acquireSupplementalEvidence(
      fetchImpl,
      clusterUrl,
      embedToken,
      definition,
      categoryControl,
      writer,
    );
  }
  return writer.finish();
}

export async function fetchCreditexVeuProductSources(
  fetchImpl: CreditexOfficialProductFetch,
): Promise<readonly CreditexFetchedOfficialProductSource[]> {
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
