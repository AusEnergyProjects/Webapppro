import type {
  CreditexOfficialProductKind,
  CreditexOfficialProductRecord,
} from "./creditex-official-product-registry.ts";

export const CREDITEX_VEU_PRODUCT_ARTIFACT_CONTRACT =
  "creditex-veu-public-registry-powerbi/v1" as const;
export const CREDITEX_VEU_PUBLIC_REGISTRY_SOURCE_KEY =
  "veu-public-product-register" as const;
export const CREDITEX_VEU_REPORT_ID =
  "8fd064b2-c06c-44f0-8d9d-d7c5804fcd1f" as const;
export const CREDITEX_VEU_DATASET_ID =
  "93dfde74-9213-4c52-ac47-5b3aec919ce2" as const;
export const CREDITEX_VEU_MODEL_ID = 664626 as const;

export const CREDITEX_VEU_QUERY_FIELDS = [
  "Id",
  "Product_ID__c",
  "Legacy_Product_Id__c",
  "Product_Category_Number__c",
  "Activity_Type__c",
  "Brand__c",
  "Model__c",
  "Product_Status__c",
  "Effective_From__c",
  "Effective_To__c",
  "Total_Volume_L__c",
  "Star_Rating__c",
  "CEC_kWhy__c",
  "Screen_Area_cm2__c",
  "Rated_Capacity_kg__c",
  "GEMS_Determination_Version__c",
] as const;

export const CREDITEX_VEU_QUERY_FIELD_TYPES = [
  1, 1, 1, 1, 1, 1, 1, 1, 7, 7, 3, 3, 3, 3, 3, 1,
] as const;

export const CREDITEX_VEU_DIM_PRODUCT_SCHEMA = {
  Id: [1, "e37e1b71-ed9f-4bb6-be83-e01a242eb1ec"],
  Product_ID__c: [1, "abdbbbb7-1f25-4934-8f45-c4b05ef4ae8f"],
  Legacy_Product_Id__c: [1, "86dc38f2-f7d2-4e97-9dc8-9fd5492e77a5"],
  Product_Category_Number__c: [1, "bda8dd10-fef9-47b9-b025-2309f91d9a26"],
  Activity_Type__c: [1, "448d260b-ba3a-455d-bdcc-4438eb8b67fa"],
  Brand__c: [1, "4c017803-7827-4364-ac57-2d7d3b9d83c2"],
  Model__c: [1, "d7a98a5b-086c-457e-920a-deb0742dcdd5"],
  Product_Status__c: [1, "35c26c7a-d828-4874-b2ee-ad459f7e26e2"],
  Effective_From__c: [7, "be68ccda-83b9-4c0d-857d-3f6e4a526973"],
  Effective_To__c: [7, "85690fb6-9651-4ea2-b514-735fd88307ba"],
  Total_Volume_L__c: [3, "6a05df4d-7b68-4868-9639-d677a5afeacb"],
  Star_Rating__c: [3, "c477438d-2ba3-466a-a200-864f0a503516"],
  CEC_kWhy__c: [3, "5b226f5e-c4c1-4c60-90ff-b2fc0b400267"],
  Screen_Area_cm2__c: [3, "cce5fc68-3017-4c5f-be63-61f9107eadde"],
  Rated_Capacity_kg__c: [3, "53190516-dbbb-4214-8032-fcdfde4b3ad6"],
  GEMS_Determination_Version__c: [1, "2b026ecc-7b76-4cc1-9041-c993ca0208ea"],
} as const;

export const CREDITEX_VEU_REFRESH_SCHEMA = {
  entity: "LastRefreshedDateTime",
  property: "Last Refreshed DateTime",
  dataType: 1,
  stableName: "ad391055-c6df-4830-a2b0-6262f65e668e",
} as const;

export const CREDITEX_VEU_CATEGORY_PRODUCT_KIND = {
  "1C": "veu_water_heater",
  "1D": "veu_water_heater",
  "3C": "veu_water_heater",
  "3D": "veu_water_heater",
  "6A": "veu_air_conditioner",
  "6B(i)": "veu_air_conditioner",
  "6B(ii)": "veu_air_conditioner",
  "6C": "veu_air_conditioner",
  "6D": "veu_air_conditioner",
  "6E(i)": "veu_air_conditioner",
  "6E(ii)": "veu_air_conditioner",
  "6F": "veu_air_conditioner",
  "6G": "veu_air_conditioner",
  "12A": "veu_unclassified_product",
  "13A": "veu_double_glazing",
  "14A": "veu_secondary_glazing",
  "14B": "veu_secondary_glazing",
  "15A": "veu_weather_sealing",
  "15B": "veu_weather_sealing",
  "15C": "veu_weather_sealing",
  "15D": "veu_weather_sealing",
  "15E": "veu_weather_sealing",
  "15F": "veu_weather_sealing",
  "15G": "veu_weather_sealing",
  "15H": "veu_weather_sealing",
  "17A": "veu_shower_rose",
  "22A": "veu_refrigerator_freezer_listing",
  "22B": "veu_refrigerator_freezer_listing",
  "22C": "veu_refrigerator_freezer_listing",
  "22D": "veu_refrigerator_freezer_listing",
  "24A": "veu_television_listing",
  "25A": "veu_clothes_dryer_listing",
  "26A": "veu_pool_pump",
  "27A": "veu_activity_27_product",
  "27B": "veu_activity_27_product",
  "30A": "veu_in_home_display",
  "30B": "veu_in_home_display",
  "32A": "veu_refrigerated_display_cabinet",
  "33A": "veu_activity_33_product",
  "34A": "veu_commercial_lighting",
  "34B": "veu_commercial_lighting",
  "34C": "veu_commercial_lighting",
  "35B": "veu_activity_35_product",
  "36A": "veu_activity_36_product",
  "44A": "veu_commercial_water_heater",
  "46A": "veu_induction_cooktop",
  "46B": "veu_induction_cooktop",
  "48A": "veu_ceiling_insulation",
} as const satisfies Record<string, CreditexOfficialProductKind>;

export const CREDITEX_VEU_PRODUCT_KINDS = [
  ...new Set<CreditexOfficialProductKind>([
    ...Object.values(CREDITEX_VEU_CATEGORY_PRODUCT_KIND),
    "veu_project_based_lighting_product",
    "veu_unclassified_product",
  ]),
] as const;

const CREDITEX_VEU_PROJECT_BASED_LIGHTING_PRODUCT_IDS = new Set([
  "000029304",
  "000029305",
  "000029306",
  "000029307",
  "000029308",
  "000029309",
  "000029310",
  "000029311",
  "000029312",
  "000029313",
  "000029314",
  "000029315",
  "000029316",
]);
const CREDITEX_VEU_PROJECT_BASED_LIGHTING_ACTIVITY_TYPE_ID =
  "a0MW2000000vbXXMAY";
const CREDITEX_VEU_PROJECT_BASED_LIGHTING_LEGACY_SUFFIX =
  "PBA lighting products";

type JsonObject = Record<string, unknown>;
type VeuQueryValue = string | number | null;
type VeuDecodedPage = Readonly<{
  rows: readonly (readonly VeuQueryValue[])[];
  continuation: boolean;
  restartRow: readonly VeuQueryValue[] | null;
}>;

export type CreditexVeuProductArtifact = Readonly<{
  contract: typeof CREDITEX_VEU_PRODUCT_ARTIFACT_CONTRACT;
  sourceKey: typeof CREDITEX_VEU_PUBLIC_REGISTRY_SOURCE_KEY;
  reportId: typeof CREDITEX_VEU_REPORT_ID;
  datasetId: typeof CREDITEX_VEU_DATASET_ID;
  modelId: typeof CREDITEX_VEU_MODEL_ID;
  sourceRefreshedAt: string;
  queryFields: readonly string[];
  controls: Readonly<{
    total: number;
    statuses: Readonly<Record<string, number>>;
    categories: Readonly<Record<string, number>>;
    modelResponse: string;
    conceptualSchemaResponse: string;
    totalResponse: string;
    statusResponse: string;
    categoryResponse: string;
    refreshResponse: string;
  }>;
  pages: readonly Readonly<{
    afterId: string | null;
    response: string;
  }>[];
}>;

function sourceError(message: string): never {
  throw new Error(`VEU public registry source invalid: ${message}`);
}

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseJson(text: string, label: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return sourceError(`${label} is not valid JSON`);
  }
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

function count(value: unknown, label: string) {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    return sourceError(`${label} is not a non-negative safe integer`);
  }
  return Number(value);
}

function exactKeys(value: JsonObject, expected: readonly string[], label: string) {
  const actual = Object.keys(value).sort();
  const controlled = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(controlled)) {
    return sourceError(`${label} fields changed`);
  }
}

export function validateCreditexVeuPowerBiModelAndSchema(
  rawModelResponse: string,
  rawSchemaResponse: string,
) {
  const modelDocument = requiredObject(
    parseJson(rawModelResponse, "Power BI model response"),
    "Power BI model response",
  );
  const models = requiredArray(modelDocument.models, "Power BI models");
  if (models.length !== 1) return sourceError("Power BI model count changed");
  const model = requiredObject(models[0], "Power BI model");
  if (
    model.id !== CREDITEX_VEU_MODEL_ID
    || model.dbName !== CREDITEX_VEU_DATASET_ID
  ) {
    return sourceError("Power BI model identity changed");
  }
  const exploration = requiredObject(
    modelDocument.exploration,
    "Power BI exploration",
  );
  const report = requiredObject(exploration.report, "Power BI report");
  const reportModel = requiredObject(report.model, "Power BI report model");
  if (
    report.objectId !== CREDITEX_VEU_REPORT_ID
    || report.modelId !== CREDITEX_VEU_MODEL_ID
    || reportModel.id !== CREDITEX_VEU_MODEL_ID
    || reportModel.dbName !== CREDITEX_VEU_DATASET_ID
  ) {
    return sourceError("Power BI report binding changed");
  }
  const schemaDocument = requiredObject(
    parseJson(rawSchemaResponse, "Power BI schema response"),
    "Power BI schema response",
  );
  const schemas = requiredArray(schemaDocument.schemas, "Power BI schemas");
  if (schemas.length !== 1) return sourceError("Power BI schema count changed");
  const schemaResult = requiredObject(schemas[0], "Power BI schema result");
  if (
    schemaResult.modelId !== CREDITEX_VEU_MODEL_ID
    || schemaResult.error !== null
  ) {
    return sourceError("Power BI schema identity changed");
  }
  const schema = requiredObject(schemaResult.schema, "Power BI schema");
  const entities = requiredArray(schema.Entities, "Power BI entities");
  const productEntities = entities.filter((entity) => (
    isObject(entity) && entity.Name === "Dim_Product"
  ));
  if (productEntities.length !== 1) {
    return sourceError("Dim_Product entity identity changed");
  }
  const productEntity = requiredObject(productEntities[0], "Dim_Product entity");
  const properties = requiredArray(
    productEntity.Properties,
    "Dim_Product properties",
  );
  for (const [name, [dataType, stableName]] of Object.entries(
    CREDITEX_VEU_DIM_PRODUCT_SCHEMA,
  )) {
    const matches = properties.filter((property) => (
      isObject(property) && property.Name === name
    ));
    if (matches.length !== 1) {
      return sourceError(`Dim_Product property ${name} identity changed`);
    }
    const property = requiredObject(matches[0], `Dim_Product property ${name}`);
    if (property.DataType !== dataType || property.StableName !== stableName) {
      return sourceError(`Dim_Product property ${name} schema changed`);
    }
  }
  const refreshEntities = entities.filter((entity) => (
    isObject(entity) && entity.Name === CREDITEX_VEU_REFRESH_SCHEMA.entity
  ));
  if (refreshEntities.length !== 1) {
    return sourceError("refresh entity identity changed");
  }
  const refreshEntity = requiredObject(refreshEntities[0], "refresh entity");
  const refreshProperties = requiredArray(
    refreshEntity.Properties,
    "refresh properties",
  );
  const refreshMatches = refreshProperties.filter((property) => (
    isObject(property) && property.Name === CREDITEX_VEU_REFRESH_SCHEMA.property
  ));
  if (refreshMatches.length !== 1) {
    return sourceError("refresh property identity changed");
  }
  const refreshProperty = requiredObject(refreshMatches[0], "refresh property");
  if (
    refreshProperty.DataType !== CREDITEX_VEU_REFRESH_SCHEMA.dataType
    || refreshProperty.StableName !== CREDITEX_VEU_REFRESH_SCHEMA.stableName
  ) {
    return sourceError("refresh property schema changed");
  }
  return true;
}

function responseDataset(
  rawResponse: string,
  expectedNames: readonly string[],
) {
  const response = requiredObject(parseJson(rawResponse, "query response"), "query response");
  const results = requiredArray(response.results, "query response results");
  if (results.length !== 1) return sourceError("query response result count changed");
  const result = requiredObject(results[0], "query result");
  const jobResult = requiredObject(result.result, "query job result");
  const data = requiredObject(jobResult.data, "query result data");
  const descriptor = requiredObject(data.descriptor, "query descriptor");
  const select = requiredArray(descriptor.Select, "query descriptor Select");
  const names = select.map((item, index) => {
    const property = requiredObject(item, `query projection ${index + 1}`);
    return requiredText(property.Name, `query projection ${index + 1} Name`, 200);
  });
  if (JSON.stringify(names) !== JSON.stringify(expectedNames)) {
    return sourceError("query projection schema changed");
  }
  const dsr = requiredObject(data.dsr, "query DSR");
  const datasets = requiredArray(dsr.DS, "query datasets");
  if (datasets.length !== 1) return sourceError("query dataset count changed");
  return requiredObject(datasets[0], "query dataset");
}

function responseDsr(rawResponse: string) {
  return responseDataset(
    rawResponse,
    CREDITEX_VEU_QUERY_FIELDS.map((field) => `Dim_Product.${field}`),
  );
}

function mask(value: unknown, label: string) {
  if (value === undefined) return 0;
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    return sourceError(`${label} is not a safe bit mask`);
  }
  return Number(value);
}

function maskIncludes(value: number, index: number) {
  return Math.floor(value / (2 ** index)) % 2 === 1;
}

function normalizedDate(value: unknown, label: string): string {
  const date = typeof value === "number"
    ? new Date(value)
    : typeof value === "string"
      ? new Date(value)
      : null;
  if (!date || Number.isNaN(date.getTime())) {
    return sourceError(`${label} is not a date`);
  }
  const iso = date.toISOString();
  if (!iso.endsWith("T00:00:00.000Z")) {
    return sourceError(`${label} is not an exact regulator date`);
  }
  return iso.slice(0, 10);
}

function normalizedCell(
  value: unknown,
  type: number,
  label: string,
): VeuQueryValue {
  if (value === null) return null;
  if (type === 1) {
    if (typeof value !== "string") return sourceError(`${label} is not text`);
    return value;
  }
  if (type === 3) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return sourceError(`${label} is not a finite number`);
    }
    return value;
  }
  if (type === 7) return normalizedDate(value, label);
  return sourceError(`${label} has an unsupported Power BI type`);
}

function dictionaryValue(
  dataset: JsonObject,
  dictionaryName: string,
  value: unknown,
  label: string,
) {
  if (!Number.isSafeInteger(value) || Number(value) < 0) return value;
  const dictionaries = requiredObject(dataset.ValueDicts, "query dictionaries");
  const dictionary = requiredArray(
    dictionaries[dictionaryName],
    `query dictionary ${dictionaryName}`,
  );
  const resolved = dictionary[Number(value)];
  if (resolved === undefined) {
    return sourceError(`${label} has an out-of-range dictionary index`);
  }
  return resolved;
}

function parsePowerBiLiteral(value: unknown, type: number, label: string) {
  if (value === null) return null;
  if (typeof value !== "string") {
    return sourceError(`${label} is not a Power BI literal`);
  }
  if (value === "null") return null;
  if (type === 1) {
    const match = /^'([\s\S]*)'$/.exec(value);
    if (!match) return sourceError(`${label} is not a text literal`);
    return match[1].replace(/''/g, "'");
  }
  if (type === 3) {
    const numeric = /^(?:-?\d+(?:\.\d+)?|-?\.\d+)(?:[Dd])?$/.test(value)
      ? Number(value.replace(/[Dd]$/, ""))
      : Number.NaN;
    if (!Number.isFinite(numeric)) {
      return sourceError(`${label} is not a numeric literal`);
    }
    return numeric;
  }
  if (type === 7) {
    const match = /^datetime'(.*)'$/.exec(value);
    if (!match) return sourceError(`${label} is not a datetime literal`);
    return normalizedDate(`${match[1]}Z`, label);
  }
  return sourceError(`${label} has an unsupported literal type`);
}

export function decodeCreditexVeuPowerBiProductPage(
  rawResponse: string,
): VeuDecodedPage {
  const dataset = responseDsr(rawResponse);
  const phases = requiredArray(dataset.PH, "query phases");
  if (phases.length !== 1) return sourceError("product query phase count changed");
  const phase = requiredObject(phases[0], "product query phase");
  const compressedRows = requiredArray(phase.DM0, "product query rows");
  if (compressedRows.length < 1 || compressedRows.length > 30_000) {
    return sourceError("product query row count is outside the controlled window");
  }
  let metadata: readonly JsonObject[] | null = null;
  let previous: readonly VeuQueryValue[] | null = null;
  const decodedRows: VeuQueryValue[][] = [];
  compressedRows.forEach((rawRow, rowIndex) => {
    const row = requiredObject(rawRow, `product row ${rowIndex + 1}`);
    if (rowIndex === 0) {
      const schema = requiredArray(row.S, "product row schema");
      if (schema.length !== CREDITEX_VEU_QUERY_FIELDS.length) {
        return sourceError("product row schema width changed");
      }
      metadata = schema.map((item, columnIndex) => {
        const field = requiredObject(item, `product field ${columnIndex + 1}`);
        if (
          field.N !== `G${columnIndex}`
          || field.T !== CREDITEX_VEU_QUERY_FIELD_TYPES[columnIndex]
          || (
            field.DN !== undefined
            && (typeof field.DN !== "string" || !/^D\d+$/.test(field.DN))
          )
        ) {
          return sourceError(`product field ${columnIndex + 1} schema changed`);
        }
        return field;
      });
    } else if (row.S !== undefined) {
      return sourceError("product row schema repeated unexpectedly");
    }
    if (!metadata) return sourceError("product row schema is unavailable");
    const cells = row.C === undefined
      ? []
      : requiredArray(row.C, `product row ${rowIndex + 1} cells`);
    const repeatMask = mask(row.R, `product row ${rowIndex + 1} repeat mask`);
    const nullMask = mask(row["Ø"], `product row ${rowIndex + 1} null mask`);
    let consumed = 0;
    const decoded: VeuQueryValue[] = [];
    metadata.forEach((field, columnIndex) => {
      const repeated = maskIncludes(repeatMask, columnIndex);
      const absent = maskIncludes(nullMask, columnIndex);
      if (repeated && absent) {
        return sourceError(`product row ${rowIndex + 1} has conflicting masks`);
      }
      if (repeated) {
        if (!previous) {
          return sourceError("first product row repeats an unavailable value");
        }
        decoded.push(previous[columnIndex]);
        return;
      }
      if (absent) {
        decoded.push(null);
        return;
      }
      if (consumed >= cells.length) {
        return sourceError(`product row ${rowIndex + 1} is missing a cell`);
      }
      const dictionaryName = typeof field.DN === "string" ? field.DN : "";
      const rawValue = dictionaryName
        ? dictionaryValue(
            dataset,
            dictionaryName,
            cells[consumed],
            `product row ${rowIndex + 1} column ${columnIndex + 1}`,
          )
        : cells[consumed];
      consumed += 1;
      decoded.push(normalizedCell(
        rawValue,
        Number(field.T),
        `product row ${rowIndex + 1} column ${columnIndex + 1}`,
      ));
    });
    if (consumed !== cells.length) {
      return sourceError(`product row ${rowIndex + 1} has unused cells`);
    }
    decodedRows.push(decoded);
    previous = decoded;
  });
  const continuation = dataset.IC;
  if (typeof continuation !== "boolean") {
    return sourceError("product query continuation flag changed");
  }
  const rawRestart = dataset.RT;
  if (!continuation) {
    const restartRows = requiredArray(rawRestart, "product query restart token");
    if (restartRows.length !== 1) {
      return sourceError("product query restart token count changed");
    }
    const restart = requiredArray(restartRows[0], "product query restart row");
    if (restart.length !== CREDITEX_VEU_QUERY_FIELDS.length) {
      return sourceError("product query restart width changed");
    }
    const normalizedRestart = restart.map((literal, index) => (
      parsePowerBiLiteral(
        literal,
        CREDITEX_VEU_QUERY_FIELD_TYPES[index],
        `product restart column ${index + 1}`,
      )
    ));
    if (
      JSON.stringify(normalizedRestart)
      !== JSON.stringify(decodedRows.at(-1))
    ) {
      return sourceError("product query restart row does not match the last row");
    }
    if (decodedRows.length !== 30_000) {
      return sourceError("continuing product query did not fill its window");
    }
    return {
      rows: decodedRows,
      continuation: true,
      restartRow: normalizedRestart,
    };
  }
  if (rawRestart !== undefined && rawRestart !== null) {
    return sourceError("terminal product query returned a restart token");
  }
  if (decodedRows.length === 30_000) {
    return sourceError("terminal product query unexpectedly filled its window");
  }
  return { rows: decodedRows, continuation: false, restartRow: null };
}

export function decodeCreditexVeuPowerBiAggregateCount(
  rawResponse: string,
) {
  const dataset = responseDataset(rawResponse, ["Count_Product_ID"]);
  const phases = requiredArray(dataset.PH, "aggregate query phases");
  if (phases.length !== 1 || dataset.IC !== true || dataset.HAD !== true) {
    return sourceError("aggregate query shape changed");
  }
  const phase = requiredObject(phases[0], "aggregate query phase");
  const rows = requiredArray(phase.DM0, "aggregate query rows");
  if (rows.length !== 1) return sourceError("aggregate query row count changed");
  const row = requiredObject(rows[0], "aggregate query row");
  const schema = requiredArray(row.S, "aggregate query schema");
  if (
    schema.length !== 1
    || !isObject(schema[0])
    || schema[0].N !== "M0"
    || schema[0].T !== 4
  ) {
    return sourceError("aggregate query schema changed");
  }
  return count(row.M0, "aggregate query count");
}

export function decodeCreditexVeuPowerBiGroupedCounts(
  rawResponse: string,
  property: "Product_Status__c" | "Product_Category_Number__c",
) {
  const dataset = responseDataset(rawResponse, [
    `Dim_Product.${property}`,
    "Count_Product_ID",
  ]);
  const phases = requiredArray(dataset.PH, "grouped query phases");
  if (phases.length !== 2 || dataset.IC !== true || dataset.HAD !== true) {
    return sourceError("grouped query shape changed");
  }
  const grandPhase = requiredObject(phases[0], "grouped grand-total phase");
  const grandRows = requiredArray(grandPhase.DM0, "grouped grand-total rows");
  if (grandRows.length !== 1) {
    return sourceError("grouped grand-total row count changed");
  }
  const grandRow = requiredObject(grandRows[0], "grouped grand-total row");
  const grandSchema = requiredArray(grandRow.S, "grouped grand-total schema");
  if (
    grandSchema.length !== 1
    || !isObject(grandSchema[0])
    || grandSchema[0].N !== "A0"
    || grandSchema[0].T !== 4
  ) {
    return sourceError("grouped grand-total schema changed");
  }
  const grandTotal = count(grandRow.A0, "grouped grand total");
  const groupPhase = requiredObject(phases[1], "grouped value phase");
  const rows = requiredArray(groupPhase.DM1, "grouped value rows");
  if (rows.length < 1 || rows.length > 200) {
    return sourceError("grouped value row count is outside the controlled bound");
  }
  let metadata: readonly JsonObject[] | null = null;
  let previous: readonly [string, number] | null = null;
  const groups: Record<string, number> = {};
  rows.forEach((rawRow, rowIndex) => {
    const row = requiredObject(rawRow, `grouped row ${rowIndex + 1}`);
    if (rowIndex === 0) {
      const schema = requiredArray(row.S, "grouped row schema");
      if (
        schema.length !== 2
        || !isObject(schema[0])
        || !isObject(schema[1])
        || schema[0].N !== "G0"
        || schema[0].T !== 1
        || schema[1].N !== "M0"
        || schema[1].T !== 4
      ) {
        return sourceError("grouped row schema changed");
      }
      metadata = schema.map((item, columnIndex) => (
        requiredObject(item, `grouped field ${columnIndex + 1}`)
      ));
    } else if (row.S !== undefined) {
      return sourceError("grouped row schema repeated unexpectedly");
    }
    if (!metadata) return sourceError("grouped row schema is unavailable");
    const cells = row.C === undefined
      ? []
      : requiredArray(row.C, `grouped row ${rowIndex + 1} cells`);
    const repeatMask = mask(row.R, `grouped row ${rowIndex + 1} repeat mask`);
    const nullMask = mask(row["Ø"], `grouped row ${rowIndex + 1} null mask`);
    const decoded: [string, number] = ["", 0];
    let consumed = 0;
    for (let columnIndex = 0; columnIndex < 2; columnIndex += 1) {
      const repeated = maskIncludes(repeatMask, columnIndex);
      const absent = maskIncludes(nullMask, columnIndex);
      if (repeated && absent) {
        return sourceError(`grouped row ${rowIndex + 1} has conflicting masks`);
      }
      let value: unknown;
      if (repeated) {
        if (!previous) return sourceError("first grouped row repeats a value");
        value = previous[columnIndex];
      } else if (absent) {
        value = null;
      } else {
        if (consumed >= cells.length) {
          return sourceError(`grouped row ${rowIndex + 1} is missing a cell`);
        }
        const field = metadata[columnIndex];
        value = typeof field.DN === "string"
          ? dictionaryValue(
              dataset,
              field.DN,
              cells[consumed],
              `grouped row ${rowIndex + 1} column ${columnIndex + 1}`,
            )
          : cells[consumed];
        consumed += 1;
      }
      if (columnIndex === 0) {
        if (value !== null && typeof value !== "string") {
          return sourceError(`grouped row ${rowIndex + 1} key is not text`);
        }
        decoded[0] = value === null ? "" : value;
      } else {
        decoded[1] = count(value, `grouped row ${rowIndex + 1} count`);
      }
    }
    if (consumed !== cells.length) {
      return sourceError(`grouped row ${rowIndex + 1} has unused cells`);
    }
    if (Object.hasOwn(groups, decoded[0])) {
      return sourceError(`grouped query repeats ${decoded[0] || "blank"}`);
    }
    groups[decoded[0]] = decoded[1];
    previous = decoded;
  });
  if (Object.values(groups).reduce((sum, value) => sum + value, 0) !== grandTotal) {
    return sourceError("grouped query counts do not reconcile");
  }
  return { total: grandTotal, groups: Object.freeze(groups) } as const;
}

function melbourneTimestamp(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
) {
  const localAsUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  const formatter = new Intl.DateTimeFormat("en-AU", {
    timeZone: "Australia/Melbourne",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  let instant = localAsUtc;
  for (let iteration = 0; iteration < 2; iteration += 1) {
    const parts = Object.fromEntries(
      formatter.formatToParts(new Date(instant)).map((part) => [
        part.type,
        part.value,
      ]),
    );
    const representedAsUtc = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
      Number(parts.second),
    );
    instant -= representedAsUtc - localAsUtc;
  }
  const finalParts = Object.fromEntries(
    formatter.formatToParts(new Date(instant)).map((part) => [
      part.type,
      part.value,
    ]),
  );
  if (
    Number(finalParts.year) !== year
    || Number(finalParts.month) !== month
    || Number(finalParts.day) !== day
    || Number(finalParts.hour) !== hour
    || Number(finalParts.minute) !== minute
    || Number(finalParts.second) !== second
  ) {
    return sourceError("refresh timestamp is not a Melbourne civil time");
  }
  return new Date(instant).toISOString();
}

export function decodeCreditexVeuPowerBiRefreshTimestamp(
  rawResponse: string,
) {
  const projection =
    "Min(LastRefreshedDateTime.Last Refreshed DateTime)";
  const dataset = responseDataset(rawResponse, [projection]);
  const phases = requiredArray(dataset.PH, "refresh query phases");
  if (phases.length !== 1 || dataset.IC !== true || dataset.HAD !== true) {
    return sourceError("refresh query shape changed");
  }
  const phase = requiredObject(phases[0], "refresh query phase");
  const rows = requiredArray(phase.DM0, "refresh query rows");
  if (rows.length !== 1) return sourceError("refresh query row count changed");
  const row = requiredObject(rows[0], "refresh query row");
  const schema = requiredArray(row.S, "refresh query schema");
  if (
    schema.length !== 1
    || !isObject(schema[0])
    || schema[0].N !== "M0"
    || schema[0].T !== 1
    || typeof row.M0 !== "string"
  ) {
    return sourceError("refresh query schema changed");
  }
  const local = row.M0;
  const match = /^(\d{1,2})\/(\d{2})\/(\d{4}) (\d{1,2}):(\d{2}):(\d{2}) (AM|PM)$/.exec(local);
  if (!match) return sourceError("refresh timestamp format changed");
  const hour12 = Number(match[4]);
  if (hour12 < 1 || hour12 > 12) {
    return sourceError("refresh timestamp hour is invalid");
  }
  const hour = (hour12 % 12) + (match[7] === "PM" ? 12 : 0);
  const utc = melbourneTimestamp(
    Number(match[3]),
    Number(match[2]),
    Number(match[1]),
    hour,
    Number(match[5]),
    Number(match[6]),
  );
  return { local, utc } as const;
}

function isoTimestamp(value: unknown, label: string) {
  const text = requiredText(value, label, 40);
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== text) {
    return sourceError(`${label} is not an exact ISO timestamp`);
  }
  return text;
}

function controlledCountMap(
  value: unknown,
  label: string,
  allowedKeys: ReadonlySet<string>,
) {
  const object = requiredObject(value, label);
  const result: Record<string, number> = {};
  for (const [key, rawCount] of Object.entries(object)) {
    if (!allowedKeys.has(key)) return sourceError(`${label} contains ${key}`);
    result[key] = count(rawCount, `${label} ${key || "blank"}`);
  }
  if (Object.keys(result).length !== allowedKeys.size) {
    return sourceError(`${label} is incomplete`);
  }
  return result;
}

function requiredRowText(value: VeuQueryValue, label: string) {
  if (typeof value !== "string" || !value.trim()) {
    return sourceError(`${label} is missing`);
  }
  return value.trim();
}

function optionalRowText(value: VeuQueryValue, label: string) {
  if (value === null) return "";
  if (typeof value !== "string") return sourceError(`${label} is not text`);
  return value.trim();
}

function optionalRowNumber(value: VeuQueryValue, label: string) {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return sourceError(`${label} is not a number`);
  }
  return value;
}

function positiveFormulaNumber(value: number | null, label: string) {
  if (value === null || value <= 0) return sourceError(`${label} is missing`);
  return value;
}

function productRecord(
  row: readonly VeuQueryValue[],
  index: number,
): CreditexOfficialProductRecord {
  const salesforceId = requiredRowText(row[0], `record ${index} Salesforce Id`);
  const productId = requiredRowText(row[1], `record ${index} Product ID`);
  const legacyProductId = optionalRowText(row[2], `record ${index} legacy Product ID`);
  const category = optionalRowText(row[3], `record ${index} category`);
  const activityTypeId = optionalRowText(row[4], `record ${index} activity type`);
  const brand = requiredRowText(row[5], `record ${index} brand`);
  const model = requiredRowText(row[6], `record ${index} model`);
  const sourceStatus = requiredRowText(row[7], `record ${index} status`);
  if (sourceStatus !== "Approved" && sourceStatus !== "Legacy") {
    return sourceError(`record ${index} has unsupported status ${sourceStatus}`);
  }
  const eligibleFrom = requiredRowText(row[8], `record ${index} effective from`);
  const eligibleTo = optionalRowText(row[9], `record ${index} effective to`);
  if (
    !category
    && (
      !CREDITEX_VEU_PROJECT_BASED_LIGHTING_PRODUCT_IDS.has(productId)
      || activityTypeId !== CREDITEX_VEU_PROJECT_BASED_LIGHTING_ACTIVITY_TYPE_ID
      || !legacyProductId.endsWith(
        CREDITEX_VEU_PROJECT_BASED_LIGHTING_LEGACY_SUFFIX,
      )
    )
  ) {
    return sourceError(
      `record ${index} has an unrecognised blank-category product identity`,
    );
  }
  const mappedKind = category
    ? CREDITEX_VEU_CATEGORY_PRODUCT_KIND[
        category as keyof typeof CREDITEX_VEU_CATEGORY_PRODUCT_KIND
      ]
    : "veu_project_based_lighting_product";
  if (!mappedKind) {
    return sourceError(`record ${index} has unknown category ${category}`);
  }
  const totalVolumeLitres = optionalRowNumber(row[10], `record ${index} total volume`);
  const starRating = optionalRowNumber(row[11], `record ${index} star rating`);
  const cecKwhPerYear = optionalRowNumber(row[12], `record ${index} CEC`);
  const screenAreaCm2 = optionalRowNumber(row[13], `record ${index} screen area`);
  const capacityKg = optionalRowNumber(row[14], `record ${index} capacity`);
  const gemsDeterminationVersion = optionalRowText(
    row[15],
    `record ${index} GEMS determination version`,
  );
  const attributes: Record<string, string | number | boolean | null> = {
    veuProductId: productId,
    veuSalesforceRecordId: salesforceId,
    veuProductCategoryNumber: category,
    sourceStatus,
  };
  if (activityTypeId) attributes.veuActivityTypeId = activityTypeId;
  if (legacyProductId) attributes.veuLegacyProductId = legacyProductId;
  if (totalVolumeLitres !== null) attributes.totalVolumeLitres = totalVolumeLitres;
  if (starRating !== null) attributes.starRating = starRating;
  if (cecKwhPerYear !== null) {
    attributes.comparativeEnergyConsumptionKwhPerYear = cecKwhPerYear;
  }
  if (screenAreaCm2 !== null) attributes.screenAreaCm2 = screenAreaCm2;
  if (capacityKg !== null) attributes.capacityKg = capacityKg;
  if (gemsDeterminationVersion) {
    attributes.gemsDeterminationVersion = gemsDeterminationVersion;
  }
  if (sourceStatus === "Approved" && category.startsWith("22")) {
    positiveFormulaNumber(totalVolumeLitres, `record ${index} total volume`);
    positiveFormulaNumber(starRating, `record ${index} star rating`);
    positiveFormulaNumber(cecKwhPerYear, `record ${index} CEC`);
    if (!gemsDeterminationVersion) {
      return sourceError(`record ${index} GEMS determination version is missing`);
    }
  }
  if (sourceStatus === "Approved" && category === "24A") {
    positiveFormulaNumber(starRating, `record ${index} star rating`);
    positiveFormulaNumber(screenAreaCm2, `record ${index} screen area`);
    positiveFormulaNumber(cecKwhPerYear, `record ${index} CEC`);
  }
  if (sourceStatus === "Approved" && category === "25A") {
    positiveFormulaNumber(starRating, `record ${index} star rating`);
    positiveFormulaNumber(capacityKg, `record ${index} capacity`);
    positiveFormulaNumber(cecKwhPerYear, `record ${index} CEC`);
  }
  return {
    sourceKey: CREDITEX_VEU_PUBLIC_REGISTRY_SOURCE_KEY,
    sourceRecordKey: productId,
    productKind: mappedKind,
    manufacturer: "",
    brand,
    model,
    series: "",
    registrationNumber: productId,
    certificateNumber: "",
    approvalStatus: sourceStatus.toLowerCase(),
    eligibleFrom,
    eligibleTo,
    availableInAustralia: true,
    attributes,
  };
}

export function parseCreditexVeuProductArtifact(
  bytes: Uint8Array,
  contentType: string,
): readonly CreditexOfficialProductRecord[] {
  if (contentType !== "application/json") {
    return sourceError("artifact content type changed");
  }
  let text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  if (/\"embedToken\"|\"Authorization\"\s*:\s*\"EmbedToken/i.test(text)) {
    return sourceError("artifact contains an authentication secret");
  }
  const artifact = requiredObject(parseJson(text, "artifact"), "artifact");
  text = "";
  exactKeys(artifact, [
    "contract",
    "sourceKey",
    "reportId",
    "datasetId",
    "modelId",
    "sourceRefreshedAt",
    "queryFields",
    "controls",
    "pages",
  ], "artifact");
  if (
    artifact.contract !== CREDITEX_VEU_PRODUCT_ARTIFACT_CONTRACT
    || artifact.sourceKey !== CREDITEX_VEU_PUBLIC_REGISTRY_SOURCE_KEY
    || artifact.reportId !== CREDITEX_VEU_REPORT_ID
    || artifact.datasetId !== CREDITEX_VEU_DATASET_ID
    || artifact.modelId !== CREDITEX_VEU_MODEL_ID
    || JSON.stringify(artifact.queryFields) !== JSON.stringify(CREDITEX_VEU_QUERY_FIELDS)
  ) {
    return sourceError("artifact identity or schema changed");
  }
  const sourceRefreshedAt = isoTimestamp(
    artifact.sourceRefreshedAt,
    "source refresh timestamp",
  );
  const controls = requiredObject(artifact.controls, "artifact controls");
  exactKeys(controls, [
    "total",
    "statuses",
    "categories",
    "modelResponse",
    "conceptualSchemaResponse",
    "totalResponse",
    "statusResponse",
    "categoryResponse",
    "refreshResponse",
  ], "artifact controls");
  const total = count(controls.total, "artifact total");
  const statuses = controlledCountMap(
    controls.statuses,
    "artifact statuses",
    new Set(["Approved", "Legacy"]),
  );
  const categories = controlledCountMap(
    controls.categories,
    "artifact categories",
    new Set(["", ...Object.keys(CREDITEX_VEU_CATEGORY_PRODUCT_KIND)]),
  );
  validateCreditexVeuPowerBiModelAndSchema(
    requiredText(
      controls.modelResponse,
      "artifact modelResponse",
      20_000_000,
    ),
    requiredText(
      controls.conceptualSchemaResponse,
      "artifact conceptualSchemaResponse",
      20_000_000,
    ),
  );
  for (const evidenceField of [
    "modelResponse",
    "conceptualSchemaResponse",
    "totalResponse",
    "statusResponse",
    "categoryResponse",
    "refreshResponse",
  ] as const) {
    const raw = requiredText(
      controls[evidenceField],
      `artifact ${evidenceField}`,
      20_000_000,
    );
    parseJson(raw, `artifact ${evidenceField}`);
  }
  const decodedTotal = decodeCreditexVeuPowerBiAggregateCount(
    String(controls.totalResponse),
  );
  const decodedStatuses = decodeCreditexVeuPowerBiGroupedCounts(
    String(controls.statusResponse),
    "Product_Status__c",
  );
  const decodedCategories = decodeCreditexVeuPowerBiGroupedCounts(
    String(controls.categoryResponse),
    "Product_Category_Number__c",
  );
  const decodedRefresh = decodeCreditexVeuPowerBiRefreshTimestamp(
    String(controls.refreshResponse),
  );
  const categoryControlFromSource = Object.fromEntries(
    Object.keys(categories).map((key) => [
      key,
      decodedCategories.groups[key] || 0,
    ]),
  );
  if (
    decodedTotal !== total
    || decodedRefresh.utc !== sourceRefreshedAt
    || decodedStatuses.total !== total
    || decodedCategories.total !== total
    || JSON.stringify(decodedStatuses.groups) !== JSON.stringify(statuses)
    || JSON.stringify(categoryControlFromSource) !== JSON.stringify(categories)
    || Object.values(statuses).reduce((sum, value) => sum + value, 0) !== total
    || Object.values(categories).reduce((sum, value) => sum + value, 0) !== total
  ) {
    return sourceError("official aggregate controls do not reconcile");
  }
  const pages = requiredArray(artifact.pages, "artifact pages");
  if (pages.length < 1 || pages.length > 10) {
    return sourceError("artifact page count is outside the controlled bound");
  }
  const records: CreditexOfficialProductRecord[] = [];
  const derivedStatuses: Record<string, number> = { Approved: 0, Legacy: 0 };
  const derivedCategories: Record<string, number> = Object.fromEntries(
    Object.keys(categories).map((key) => [key, 0]),
  );
  let expectedAfterId: string | null = null;
  let terminalSeen = false;
  pages.forEach((rawPage, pageIndex) => {
    const page = requiredObject(rawPage, `artifact page ${pageIndex + 1}`);
    exactKeys(page, ["afterId", "response"], `artifact page ${pageIndex + 1}`);
    if (page.afterId !== expectedAfterId) {
      return sourceError(`artifact page ${pageIndex + 1} has the wrong cursor`);
    }
    if (terminalSeen) return sourceError("artifact has a page after completion");
    const decoded = decodeCreditexVeuPowerBiProductPage(
      requiredText(page.response, `artifact page ${pageIndex + 1} response`, 30_000_000),
    );
    for (const row of decoded.rows) {
      const id = requiredRowText(row[0], "page Salesforce Id");
      if (
        expectedAfterId
        && id.toLowerCase() <= expectedAfterId.toLowerCase()
      ) {
        return sourceError("product pagination is not strictly monotonic");
      }
      expectedAfterId = id;
      const record = productRecord(row, records.length + 1);
      const category = String(
        record.attributes.veuProductCategoryNumber || "",
      );
      const sourceStatus = String(record.attributes.sourceStatus);
      derivedStatuses[sourceStatus] += 1;
      derivedCategories[category] += 1;
      records.push(record);
    }
    terminalSeen = !decoded.continuation;
    if (pageIndex < pages.length - 1 && terminalSeen) {
      return sourceError("artifact completed before its last page");
    }
  });
  if (records.length !== total) {
    return sourceError(`product rows ${records.length} do not match total ${total}`);
  }
  if (
    JSON.stringify(derivedStatuses) !== JSON.stringify(statuses)
    || JSON.stringify(derivedCategories) !== JSON.stringify(categories)
  ) {
    return sourceError("decoded rows do not match official aggregate controls");
  }
  return Object.freeze(records);
}
