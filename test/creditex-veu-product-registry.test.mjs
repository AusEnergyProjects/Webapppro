import assert from "node:assert/strict";
import test from "node:test";
import {
  CREDITEX_VEU_CATEGORY_PRODUCT_KIND,
  CREDITEX_VEU_BOUNDED_STREAM_ARTIFACT_CONTRACT,
  CREDITEX_VEU_DATASET_ID,
  CREDITEX_VEU_DIM_PRODUCT_SCHEMA,
  CREDITEX_VEU_MODEL_ID,
  CREDITEX_VEU_NUMERIC_FORMATS,
  CREDITEX_VEU_PRODUCT_ARTIFACT_CONTRACT,
  CREDITEX_VEU_PUBLIC_REGISTRY_SOURCE_KEY,
  CREDITEX_VEU_QUERY_FIELDS,
  CREDITEX_VEU_QUERY_FIELD_TYPES,
  CREDITEX_VEU_REFRESH_SCHEMA,
  CREDITEX_VEU_REPORT_ID,
  CREDITEX_VEU_STREAM_ARTIFACT_CONTRACT,
  CREDITEX_VEU_STREAMING_PARSER,
  CREDITEX_VEU_SUPPLEMENTAL_QUERIES,
  parseCreditexVeuProductArtifact,
} from "../src/lib/creditex-veu-product-parser.ts";
import {
  CREDITEX_VEU_ARTIFACT_MAXIMUM_BYTES,
  CREDITEX_VEU_MAX_PAGES,
  CREDITEX_VEU_PAGE_SIZE,
} from "../src/lib/creditex-veu-product-sources.ts";

const textEncoder = new TextEncoder();

function response(names, dataset) {
  return JSON.stringify({
    results: [{
      result: {
        data: {
          descriptor: { Select: names.map((Name) => ({ Name })) },
          dsr: { DS: [dataset] },
        },
      },
    }],
  });
}

function aggregateResponse(total) {
  return response(["Count_Product_ID"], {
    PH: [{ DM0: [{ S: [{ N: "M0", T: 4 }], M0: total }] }],
    IC: true,
    HAD: true,
  });
}

function groupedResponse(property, entries) {
  const total = entries.reduce((sum, [, value]) => sum + value, 0);
  const rows = entries.map(([key, value], index) => {
    const row = {};
    if (index === 0) {
      row.S = [{ N: "G0", T: 1 }, { N: "M0", T: 4 }];
    }
    if (key === "") {
      row.C = [value];
      row["Ø"] = 1;
    } else {
      row.C = [key, value];
    }
    return row;
  });
  return response([`Dim_Product.${property}`, "Count_Product_ID"], {
    PH: [
      { DM0: [{ S: [{ N: "A0", T: 4 }], A0: total }] },
      { DM1: rows },
    ],
    IC: true,
    HAD: true,
  });
}

function refreshResponse() {
  return response(
    ["Min(LastRefreshedDateTime.Last Refreshed DateTime)"],
    {
      PH: [{
        DM0: [{
          S: [{ N: "M0", T: 1 }],
          M0: "9/08/2026 6:17:49 AM",
        }],
      }],
      IC: true,
      HAD: true,
    },
  );
}

function modelResponse() {
  return JSON.stringify({
    models: [{ id: CREDITEX_VEU_MODEL_ID, dbName: CREDITEX_VEU_DATASET_ID }],
    exploration: {
      report: {
        objectId: CREDITEX_VEU_REPORT_ID,
        modelId: CREDITEX_VEU_MODEL_ID,
        model: { id: CREDITEX_VEU_MODEL_ID, dbName: CREDITEX_VEU_DATASET_ID },
      },
    },
  });
}

function conceptualSchemaResponse(overrides = {}) {
  const productProperties = Object.entries(CREDITEX_VEU_DIM_PRODUCT_SCHEMA)
    .map(([Name, [DataType, StableName]]) => ({
      Name,
      DataType,
      StableName,
      ...(DataType === 3 && CREDITEX_VEU_NUMERIC_FORMATS[Name] !== null
        ? { FormatString: CREDITEX_VEU_NUMERIC_FORMATS[Name] }
        : {}),
    }));
  if (overrides.productStableName) {
    productProperties[0].StableName = overrides.productStableName;
  }
  if (overrides.propertyName) {
    const property = productProperties.find(
      ({ Name }) => Name === overrides.propertyName,
    );
    property.StableName = overrides.propertyStableName || "changed";
  }
  if (overrides.numericFormatProperty) {
    const property = productProperties.find(
      ({ Name }) => Name === overrides.numericFormatProperty,
    );
    property.FormatString = overrides.numericFormat || "0.00";
  }
  return JSON.stringify({
    schemas: [{
      modelId: CREDITEX_VEU_MODEL_ID,
      error: null,
      schema: {
        Entities: [
          { Name: "Dim_Product", Properties: productProperties },
          {
            Name: CREDITEX_VEU_REFRESH_SCHEMA.entity,
            Properties: [{
              Name: CREDITEX_VEU_REFRESH_SCHEMA.property,
              DataType: CREDITEX_VEU_REFRESH_SCHEMA.dataType,
              StableName: CREDITEX_VEU_REFRESH_SCHEMA.stableName,
            }],
          },
        ],
      },
    }],
  });
}

function epoch(date) {
  return Date.parse(`${date}T00:00:00.000Z`);
}

function productRows() {
  return [
    [
      "a0O000000000000001", "000000001", null, "22A", "activity-22",
      "Cold Brand", "Fridge 1", "Approved", epoch("2025-01-01"), null,
      400, 6, 300, null, null, "GEMS 2019", null,
    ],
    [
      "a0O000000000000002", "000000002", null, "24A", "activity-24",
      "View Brand", "TV 1", "Approved", epoch("2025-02-01"), null,
      null, 7, 100, 4_500, null, null, null,
    ],
    [
      "a0O000000000000003", "000000003", null, "25A", "activity-25",
      "Dry Brand", "Dryer 1", "Approved", epoch("2025-03-01"), null,
      null, 8, 120, null, 7, null, null,
    ],
    [
      "a0O000000000000004", "000029304", "PBA lighting products", null,
      "a0MW2000000vbXXMAY", "Philips", "PBA lamp", "Legacy",
      epoch("2012-01-01"), epoch("2020-01-01"),
      null, null, null, null, null, null, null,
    ],
    [
      "a0O000000000000005", "000000005", "historic-12", "12A", null,
      "Old Brand", "Old activity 12", "Legacy",
      epoch("2010-01-01"), epoch("2019-01-01"),
      null, null, null, null, null, null, null,
    ],
  ];
}

function approvedRow(id, productId, category, overrides = {}) {
  return [
    id,
    productId,
    null,
    category,
    `activity-${category}`,
    overrides.brand || "Formula Brand",
    overrides.model || `Formula ${category}`,
    "Approved",
    epoch("2026-01-01"),
    null,
    overrides.totalVolumeLitres ?? null,
    overrides.starRating ?? null,
    overrides.cecKwhPerYear ?? null,
    overrides.screenAreaCm2 ?? null,
    overrides.capacityKg ?? null,
    overrides.gemsDeterminationVersion ?? null,
    overrides.wersHeatingStars ?? null,
  ];
}

function formulaProductRows() {
  return [
    ...productRows(),
    approvedRow("a0O000000000000006", "000100006", "1D"),
    approvedRow("a0O000000000000007", "000100007", "6D"),
    approvedRow("a0O000000000000008", "000100008", "13A", {
      wersHeatingStars: 6,
    }),
    approvedRow("a0O000000000000009", "000100009", "15A"),
    approvedRow("a0O000000000000010", "000100010", "26A"),
    approvedRow("a0O000000000000011", "000100011", "27A"),
    approvedRow("a0O000000000000012", "000100012", "32A"),
    approvedRow("a0O000000000000013", "000100013", "33A"),
    approvedRow("a0O000000000000014", "000100014", "35B"),
    approvedRow("a0O000000000000015", "000100015", "44A"),
    approvedRow("a0O000000000000016", "000100016", "48A"),
  ];
}

function formulaSupplementalValues() {
  return {
    "000100006": {
      System_Size__c: "Medium",
      Zone_4_Bs_GJyear_system_load_size__c: 5,
      Zone_4_Be_GJyear_system_load_size__c: 1,
      Zone_5_Bs_GJyear_system_load_size__c: 5.5,
      Zone_5_Be_GJyear_system_load_size__c: 1.1,
      Zone_4_Bs_GJyear_step_down_load_size__c: 3,
      Zone_4_Be_GJyear_step_down_load_size__c: 0.8,
      Zone_5_Bs_GJyear_step_down_load_size__c: 3.3,
      Zone_5_Be_GJyear_step_down_load_size__c: 0.9,
      Zone_4_Annual_Energy_Savings_system_l__c: 70,
      Zone_5_Annual_Energy_Savings_system_l__c: 65,
    },
    "000100007": {
      Product_Configuration__c: "Single split system",
      Product_Type__c: "Non-Ducted",
      Heating_Capacity_kW__c: 3.5,
      Cooling_Capacity_kW__c: 3.2,
      ACOP__c: 4.4,
      AEER__c: 4.2,
      GEMS_HSPF_Cold_res__c: 4.5,
      GEMS_TCSPF_Cold_res__c: 6.5,
      GEMS_HSPF_Mixed_res__c: 4.8,
      GEMS_TCSPF_Mixed_res__c: 6.2,
      GEMS_HSPF_Cold_com__c: 4.7,
      GEMS_TCSPF_Cold_com__c: 7.1,
      GEMS_HSPF_Mixed_com__c: 5,
      GEMS_TCSPF_Mixed_com__c: 6.8,
      GEMS_Class__c: "Class 8",
      GEMS_Registered_Before_2_August_2024__c: false,
      Calculated_HSPF_Cold_res__c: 0,
      Calculated_TCSPF_Cold_res__c: null,
      Refrigerant_Type_GWP__c: "R-32",
      Refrigerant_Charge_kg__c: null,
    },
    "000100009": { Warranty_Period_Years__c: 5 },
    "000100010": { PAEC_kWhy__c: 450 },
    "000100011": {
      Product_Type__c: "LED lamp with integrated driver",
      LCPVictorian_Load_W__c: 12,
      Nominal_Device_Rating_W__c: 12,
      Occupancy_Sensor__c: false,
      Programmable_Dimmer__c: true,
      Manual_Dimmer__c: false,
      DayLight_Linked_Control__c: false,
      Voltage_Reduction_Unit__c: false,
    },
    "000100012": {
      Product_Class__c: "Class 7",
      Characteristic_Code__c: "IRV",
      Energy_Efficiency_Index__c: 45,
      Total_Display_Area_m2__c: 2.2,
      Total_Energy_Consumption_kWh24h__c: 12,
      Net_Volume_L__c: 0,
      Duty_Type__c: "HD",
    },
    "000100013": {
      Input_Power_W__c: 20,
      Output_Power_W__c: 15,
      Rotor_Motor_Type__c: "Internal",
    },
    "000100014": {
      Product_Type__c: "LED lamp with integrated driver",
      LCP_W__c: 15,
      NLP_W__c: 20,
      Reported_Lifetime_L70__c: 60_000,
      Occupancy_Sensor__c: false,
      Programmable_Dimmer__c: false,
      Manual_Dimmer__c: false,
      DayLight_Linked_Control__c: false,
      Voltage_Reduction_Unit__c: false,
    },
    "000100015": {
      Number_of_Heat_Pumps__c: 2,
      Number_of_Tanks__c: 2,
      Total_Heat_Pump_Thermal_Capacity_kW__c: 50,
      Total_Thermal_Capacity_kW__c: 55,
      Total_System_Tank_Volume_L__c: 2_000,
      Zone_4_Annual_Energy_Savings__c: 70,
      Zone_4_HPelec_GLyear__c: 100,
      Zone_4_HPgas_GJyear__c: 0,
      Zone_4_Peak_Load_MJday__c: 900,
      Zone_5_Annual_Energy_Savings__c: 65,
      Zone_5_HPelec_GLyear__c: 120,
      Zone_5_HPgas_GJyear__c: 0,
      Zone_5_Peak_Load_MJday__c: 950,
      Refrigerant_Type_GWP__c: "R-744",
      Refrigerant_Charge_kg__c: 4,
    },
    "000100016": {
      R_Value__c: 4,
      Product_Type__c: "Bulk insulation batt or blanket",
    },
  };
}

function compressedResponse(fields, fieldTypes, rows) {
  const schema = fieldTypes.map((T, index) => ({
    N: `G${index}`,
    T,
  }));
  const compressed = rows.map((values, rowIndex) => {
    let nullMask = 0;
    const cells = [];
    values.forEach((value, index) => {
      if (value === null) nullMask += 2 ** index;
      else cells.push(value);
    });
    return {
      ...(rowIndex === 0 ? { S: schema } : {}),
      C: cells,
      ...(nullMask ? { "Ø": nullMask } : {}),
    };
  });
  return response(
    fields.map((field) => `Dim_Product.${field}`),
    { PH: [{ DM0: compressed }], IC: true, HAD: true },
  );
}

function compressedProductResponse(rows) {
  return compressedResponse(
    CREDITEX_VEU_QUERY_FIELDS,
    CREDITEX_VEU_QUERY_FIELD_TYPES,
    rows,
  );
}

function defaultSupplementalValues(productId) {
  if (productId === "000029304") {
    return {
      Product_Type__c: "Lamp",
      Occupancy_Sensor__c: false,
      Programmable_Dimmer__c: false,
      Manual_Dimmer__c: false,
      DayLight_Linked_Control__c: false,
      Voltage_Reduction_Unit__c: false,
    };
  }
  if (productId === "000000005") {
    return { Winter_R_Value__c: "2.5" };
  }
  return {};
}

function supplementsForRows(rows, overrides = {}) {
  return CREDITEX_VEU_SUPPLEMENTAL_QUERIES.map((definition) => {
    const matching = rows.filter((row) => {
      const category = row[3] ?? "";
      return definition.categories.includes(category)
        && (!("productIds" in definition)
          || definition.productIds.includes(row[1]));
    });
    const supplementalRows = matching.map((row) => {
      const values = {
        ...defaultSupplementalValues(row[1]),
        ...(overrides[row[1]] || {}),
      };
      return definition.fields.map((field, index) => {
        if (index === 0) return row[0];
        if (index === 1) return row[1];
        if (index === 2) return row[3];
        if (index === 3) return row[7];
        return values[field] ?? null;
      });
    });
    const fieldTypes = definition.fields.map(
      (field) => CREDITEX_VEU_DIM_PRODUCT_SCHEMA[field][0],
    );
    return {
      key: definition.key,
      queryFields: definition.fields,
      expectedCount: supplementalRows.length,
      pages: supplementalRows.length
        ? [{
            afterId: null,
            response: compressedResponse(
              definition.fields,
              fieldTypes,
              supplementalRows,
            ),
          }]
        : [],
    };
  });
}

function artifact(overrides = {}) {
  const rows = overrides.rows || productRows();
  const statuses = { Approved: 0, Legacy: 0 };
  const categoryTallies = {};
  rows.forEach((row) => {
    statuses[row[7]] += 1;
    const category = row[3] ?? "";
    categoryTallies[category] = (categoryTallies[category] || 0) + 1;
  });
  const statusEntries = Object.entries(statuses).filter(([, value]) => value > 0);
  const categories = Object.fromEntries([
    "",
    ...Object.keys(CREDITEX_VEU_CATEGORY_PRODUCT_KIND),
  ].map((category) => [
    category,
    categoryTallies[category] || 0,
  ]));
  const categoryEntries = Object.entries(categories).filter(([, value]) => value > 0);
  const value = {
    contract: CREDITEX_VEU_PRODUCT_ARTIFACT_CONTRACT,
    sourceKey: CREDITEX_VEU_PUBLIC_REGISTRY_SOURCE_KEY,
    reportId: CREDITEX_VEU_REPORT_ID,
    datasetId: CREDITEX_VEU_DATASET_ID,
    modelId: CREDITEX_VEU_MODEL_ID,
    sourceRefreshedAt: "2026-08-08T20:17:49.000Z",
    queryFields: CREDITEX_VEU_QUERY_FIELDS,
    controls: {
      total: rows.length,
      statuses,
      categories,
      modelResponse: modelResponse(),
      conceptualSchemaResponse: conceptualSchemaResponse(
        overrides.schemaOverrides,
      ),
      totalResponse: aggregateResponse(rows.length),
      statusResponse: groupedResponse("Product_Status__c", statusEntries),
      categoryResponse: groupedResponse(
        "Product_Category_Number__c",
        categoryEntries,
      ),
      refreshResponse: refreshResponse(),
    },
    pages: [{ afterId: null, response: compressedProductResponse(rows) }],
    supplements: supplementsForRows(rows, overrides.supplementalValues),
  };
  return textEncoder.encode(JSON.stringify(value));
}

function mutateArtifact(bytes, mutation) {
  const value = JSON.parse(new TextDecoder().decode(bytes));
  mutation(value);
  return textEncoder.encode(JSON.stringify(value));
}

function streamArtifact(overrides = {}) {
  const legacy = JSON.parse(new TextDecoder().decode(artifact(overrides)));
  const { pages, supplements, ...header } = legacy;
  return textEncoder.encode([
    JSON.stringify({
      recordType: "header",
      ...header,
      contract: CREDITEX_VEU_STREAM_ARTIFACT_CONTRACT,
    }),
    ...pages.map((page) => JSON.stringify({ recordType: "page", ...page })),
    ...supplements.map((supplement) => JSON.stringify({
      recordType: "supplement",
      ...supplement,
    })),
    "",
  ].join("\n"));
}

function powerBiRestartLiteral(value, type) {
  if (value === null) return "null";
  if (type === 1) return `'${String(value).replaceAll("'", "''")}'`;
  if (type === 3) return `${value}D`;
  if (type === 5) return value ? "true" : "false";
  if (type === 7) {
    return `datetime'${new Date(value).toISOString().slice(0, -1)}'`;
  }
  throw new Error(`Unsupported restart type ${type}`);
}

function boundedProductionStreamArtifact(recordCount) {
  const categories = Object.fromEntries([
    "",
    ...Object.keys(CREDITEX_VEU_CATEGORY_PRODUCT_KIND),
  ].map((category) => [category, category === "22A" ? recordCount : 0]));
  const lines = [JSON.stringify({
    recordType: "header",
    contract: CREDITEX_VEU_BOUNDED_STREAM_ARTIFACT_CONTRACT,
    sourceKey: CREDITEX_VEU_PUBLIC_REGISTRY_SOURCE_KEY,
    reportId: CREDITEX_VEU_REPORT_ID,
    datasetId: CREDITEX_VEU_DATASET_ID,
    modelId: CREDITEX_VEU_MODEL_ID,
    sourceRefreshedAt: "2026-08-08T20:17:49.000Z",
    queryFields: CREDITEX_VEU_QUERY_FIELDS,
    controls: {
      total: recordCount,
      statuses: { Approved: recordCount, Legacy: 0 },
      categories,
      totalResponse: aggregateResponse(recordCount),
      statusResponse: groupedResponse("Product_Status__c", [
        ["Approved", recordCount],
        ["Legacy", 0],
      ]),
      categoryResponse: groupedResponse("Product_Category_Number__c", [["22A", recordCount]]),
      refreshResponse: refreshResponse(),
    },
  })];
  lines.push(JSON.stringify({
    recordType: "control",
    key: "modelResponse",
    response: modelResponse(),
  }));
  lines.push(JSON.stringify({
    recordType: "control",
    key: "conceptualSchemaResponse",
    response: conceptualSchemaResponse(),
  }));
  let afterId = null;
  for (let offset = 0; offset < recordCount; offset += CREDITEX_VEU_PAGE_SIZE) {
    const length = Math.min(CREDITEX_VEU_PAGE_SIZE, recordCount - offset);
    const rows = Array.from({ length }, (_, pageIndex) => {
      const index = offset + pageIndex;
      return [
        `a0O${String(index).padStart(12, "0")}`,
        String(index).padStart(9, "0"),
        null,
        "22A",
        "activity-22",
        "Scale Brand",
        `Scale model ${index}`,
        "Approved",
        epoch("2026-01-01"),
        null,
        400,
        6,
        300,
        null,
        null,
        "GEMS 2019",
        null,
      ];
    });
    const raw = JSON.parse(compressedProductResponse(rows));
    const dataset = raw.results[0].result.data.dsr.DS[0];
    const continuation = offset + length < recordCount;
    if (continuation) {
      dataset.IC = false;
      dataset.RT = [rows.at(-1).map((value, index) => (
        powerBiRestartLiteral(value, CREDITEX_VEU_QUERY_FIELD_TYPES[index])
      ))];
    }
    lines.push(JSON.stringify({
      recordType: "page",
      afterId,
      response: JSON.stringify(raw),
    }));
    afterId = rows.at(-1)[0];
  }
  for (const definition of CREDITEX_VEU_SUPPLEMENTAL_QUERIES) {
    lines.push(JSON.stringify({
      recordType: "supplement",
      key: definition.key,
      queryFields: definition.fields,
      expectedCount: 0,
    }));
  }
  lines.push("");
  return textEncoder.encode(lines.join("\n"));
}

test("VEU acquisition has a fixed Worker heap envelope and exact page capacity", () => {
  assert.equal(CREDITEX_VEU_ARTIFACT_MAXIMUM_BYTES, 32_000_000);
  assert.equal(CREDITEX_VEU_PAGE_SIZE, 5_000);
  assert.equal(CREDITEX_VEU_MAX_PAGES, 200);
  assert.ok(CREDITEX_VEU_PAGE_SIZE * CREDITEX_VEU_MAX_PAGES >= 70_000);
  assert.deepEqual(
    parseCreditexVeuProductArtifact(streamArtifact(), "application/json"),
    parseCreditexVeuProductArtifact(artifact(), "application/json"),
  );
});

test("VEU production-scale stream keeps every parse and D1 lookup batch bounded", async () => {
  const recordCount = 75_123;
  const bytes = boundedProductionStreamArtifact(recordCount);
  assert.ok(bytes.byteLength < CREDITEX_VEU_ARTIFACT_MAXIMUM_BYTES);
  assert.equal(
    CREDITEX_VEU_STREAMING_PARSER.inspect(bytes, "application/json"),
    recordCount,
  );
  assert.deepEqual(
    [...CREDITEX_VEU_STREAMING_PARSER.supplementalBatches(
      bytes,
      "application/json",
    )],
    [],
  );
  let loaded = 0;
  let batches = 0;
  let maximumLookup = 0;
  let maximumRecords = 0;
  for await (const records of CREDITEX_VEU_STREAMING_PARSER.recordBatches(
    bytes,
    "application/json",
    async (sourceRecordKeys) => {
      batches += 1;
      maximumLookup = Math.max(maximumLookup, sourceRecordKeys.length);
      return new Map();
    },
  )) {
    maximumRecords = Math.max(maximumRecords, records.length);
    loaded += records.length;
  }
  assert.equal(loaded, recordCount);
  assert.equal(batches, Math.ceil(recordCount / 500));
  assert.ok(maximumLookup <= 500);
  assert.ok(maximumRecords <= 500);
});

test("the public VEU parser recognizes the bounded v4 custody contract", () => {
  const records = parseCreditexVeuProductArtifact(
    boundedProductionStreamArtifact(5_123),
    "application/json",
  );
  assert.equal(records.length, 5_123);
  assert.equal(records[0].sourceRecordKey, "000000000");
  assert.equal(records.at(-1).sourceRecordKey, "000005122");
  assert.equal(
    records.at(-1).attributes.veuSalesforceRecordId,
    "a0O000000005122",
  );
});

test("VEU v3 acquisition rejects incomplete streamed custody", () => {
  const complete = streamArtifact();
  assert.throws(
    () => parseCreditexVeuProductArtifact(
      complete.subarray(0, complete.byteLength - 1),
      "application/json",
    ),
    /stream artifact is incomplete/,
  );
});

test("VEU artifact maps exact identities, categories, dates, statuses and formula fields", () => {
  const records = parseCreditexVeuProductArtifact(
    artifact(),
    "application/json",
  );
  assert.equal(records.length, 5);
  assert.deepEqual(records.map(({ productKind }) => productKind), [
    "veu_refrigerator_freezer_listing",
    "veu_television_listing",
    "veu_clothes_dryer_listing",
    "veu_project_based_lighting_product",
    "veu_unclassified_product",
  ]);
  assert.deepEqual(records[0].attributes, {
    veuProductId: "000000001",
    veuSalesforceRecordId: "a0O000000000000001",
    veuProductCategoryNumber: "22A",
    veuActivityTypeId: "activity-22",
    sourceStatus: "Approved",
    totalVolumeLitres: 400,
    starRating: 6,
    comparativeEnergyConsumptionKwhPerYear: 300,
    gemsDeterminationVersion: "GEMS 2019",
  });
  assert.equal(records[1].attributes.screenAreaCm2, 4_500);
  assert.equal(records[2].attributes.capacityKg, 7);
  assert.equal(records[3].approvalStatus, "legacy");
  assert.equal(records[3].eligibleTo, "2020-01-01");
  assert.equal(records[4].attributes.veuProductCategoryNumber, "12A");
  assert.equal(records.filter(
    ({ productKind }) => productKind === "veu_project_based_lighting_product",
  ).length, 1);
  assert.equal(records.filter(
    ({ productKind }) => productKind === "veu_unclassified_product",
  ).length, 1);
});

test("VEU artifact normalizes formula-critical product fields without guessed values", () => {
  const records = parseCreditexVeuProductArtifact(
    artifact({
      rows: formulaProductRows(),
      supplementalValues: formulaSupplementalValues(),
    }),
    "application/json",
  );
  const byCategory = (category) => records.find(
    ({ attributes }) => attributes.veuProductCategoryNumber === category,
  );
  assert.deepEqual(
    {
      systemSize: byCategory("1D").attributes.veuSystemSize,
      bsZone4: byCategory("1D").attributes.bs2021Zone4StepDownLoadGjPerYear,
      beZone5: byCategory("1D").attributes.be2021Zone5StepDownLoadGjPerYear,
      zone4Available: byCategory("1D").attributes.veuZone4ModelDataAvailable,
      zone5Available: byCategory("1D").attributes.veuZone5ModelDataAvailable,
    },
    {
      systemSize: "Medium",
      bsZone4: 3,
      beZone5: 0.9,
      zone4Available: true,
      zone5Available: true,
    },
  );
  assert.deepEqual(
    {
      configuration: byCategory("6D").attributes.veuProductConfiguration,
      configurationClass:
        byCategory("6D").attributes.veuProductConfigurationClass,
      productType: byCategory("6D").attributes.veuProductType,
      productTypeClass: byCategory("6D").attributes.veuProductTypeClass,
      heating: byCategory("6D").attributes.ratedHeatingCapacityKw,
      hspf: byCategory("6D").attributes.gemsHspfColdResidential,
      calculatedHspf: byCategory("6D").attributes.calculatedHspfColdResidential,
      refrigerantType: byCategory("6D").attributes.refrigerantType,
      refrigerantCharge: byCategory("6D").attributes.refrigerantChargeKg,
      gemsClass: byCategory("6D").attributes.gemsClass,
      gemsRegisteredBefore2August2024:
        byCategory("6D").attributes.gemsRegisteredBefore2August2024,
    },
    {
      configuration: "Single split system",
      configurationClass: "single",
      productType: "Non-Ducted",
      productTypeClass: "non_ducted",
      heating: 3.5,
      hspf: 4.5,
      calculatedHspf: 0,
      refrigerantType: "R-32",
      refrigerantCharge: undefined,
      gemsClass: "Class 8",
      gemsRegisteredBefore2August2024: false,
    },
  );
  assert.equal(byCategory("13A").attributes.wersHeatingStars, 6);
  assert.equal(byCategory("15A").attributes.warrantyYears, 5);
  assert.equal(byCategory("26A").attributes.paecKwhPerYear, 450);
  assert.equal(byCategory("27A").attributes.victorianLampCircuitPowerW, 12);
  assert.equal(byCategory("32A").attributes.energyEfficiencyIndex, 45);
  assert.equal(byCategory("33A").attributes.inputPowerW, 20);
  assert.equal(byCategory("35B").attributes.reportedLifetimeL70Hours, 60_000);
  assert.equal(byCategory("44A").attributes.zone4CommercialPeakLoadMjPerDay, 900);
  assert.equal(byCategory("44A").attributes.refrigerantType, "R-744");
  assert.equal(byCategory("48A").attributes.rValue, 4);
  assert.equal("refrigerantTypeGwp" in byCategory("6D").attributes, false);
});

test("VEU artifact canonicalizes Power BI float tails at governed precision", () => {
  const rows = formulaProductRows();
  rows.find((row) => row[3] === "13A")[16] = 5.90000009536743;
  rows.find((row) => row[3] === "24A")[13] = 11_466.84;
  const values = structuredClone(formulaSupplementalValues());
  values["000100006"].Zone_4_Bs_GJyear_step_down_load_size__c =
    3.20000004768372;
  values["000100007"].Heating_Capacity_kW__c = 5.90000009536743;
  values["000100010"].PAEC_kWhy__c = 449.9999999997;
  values["000100011"].LCPVictorian_Load_W__c = 11.8999996185303;
  values["000100012"].Energy_Efficiency_Index__c = 44.3099994659424;
  values["000100013"].Input_Power_W__c = 20.0000009536743;
  values["000100015"].Total_Heat_Pump_Thermal_Capacity_kW__c =
    11.8999996185303;
  values["000100015"].Zone_4_Annual_Energy_Savings__c = 75.6999969482422;
  values["000100015"].Zone_4_HPelec_GLyear__c = 44.3099994659424;
  values["000100015"].Zone_4_Peak_Load_MJday__c = 12_345.599609375;
  values["000100015"].Refrigerant_Charge_kg__c = 3.20000004768372;
  values["000100016"].R_Value__c = 4.00000004768372;
  const records = parseCreditexVeuProductArtifact(
    artifact({ rows, supplementalValues: values }),
    "application/json",
  );
  const byCategory = (category) => records.find(
    ({ attributes }) => attributes.veuProductCategoryNumber === category,
  ).attributes;
  assert.equal(byCategory("1D").bs2021Zone4StepDownLoadGjPerYear, 3.2);
  assert.equal(byCategory("6D").ratedHeatingCapacityKw, 5.9);
  assert.equal(byCategory("13A").wersHeatingStars, 5.9);
  assert.equal(byCategory("24A").screenAreaCm2, 11_466.84);
  assert.equal(byCategory("26A").paecKwhPerYear, 450);
  assert.equal(byCategory("27A").victorianLampCircuitPowerW, 11.9);
  assert.equal(byCategory("32A").energyEfficiencyIndex, 44.31);
  assert.equal(byCategory("33A").inputPowerW, 20);
  assert.equal(byCategory("44A").totalHeatPumpThermalCapacityKw, 11.9);
  assert.equal(byCategory("44A").zone4AnnualEnergySavings, 76);
  assert.equal(byCategory("44A").zone4HpElectricityGjPerYear, 44.31);
  assert.equal(byCategory("44A").zone4CommercialPeakLoadMjPerDay, 12_350);
  assert.equal(byCategory("44A").refrigerantChargeKg, 3.2);
  assert.equal(byCategory("48A").rValue, 4);
});

test("VEU artifact rejects unformatted fractional measures instead of guessing precision", () => {
  const values = structuredClone(formulaSupplementalValues());
  values["000100009"].Warranty_Period_Years__c = 5.00000011920929;
  assert.throws(
    () => parseCreditexVeuProductArtifact(
      artifact({ rows: formulaProductRows(), supplementalValues: values }),
      "application/json",
    ),
    /exceeds its reviewed unformatted decimal precision/,
  );
});

test("VEU artifact retains water rows but marks an incomplete product-zone unavailable", () => {
  const waterValues = structuredClone(formulaSupplementalValues());
  waterValues["000100006"].Zone_4_Bs_GJyear_step_down_load_size__c = null;
  const records = parseCreditexVeuProductArtifact(
    artifact({ rows: formulaProductRows(), supplementalValues: waterValues }),
    "application/json",
  );
  const water = records.find(
    ({ registrationNumber }) => registrationNumber === "000100006",
  );
  assert.equal(water.attributes.veuZone4ModelDataAvailable, false);
  assert.equal(water.attributes.veuZone5ModelDataAvailable, true);
});

test("VEU artifact fails closed when an Approved supplemental formula field disappears", () => {

  const airValues = structuredClone(formulaSupplementalValues());
  airValues["000100007"].GEMS_HSPF_Cold_res__c = null;
  assert.throws(
    () => parseCreditexVeuProductArtifact(
      artifact({ rows: formulaProductRows(), supplementalValues: airValues }),
      "application/json",
    ),
    /GEMS_HSPF_Cold_res__c is missing/,
  );

  const weatherValues = structuredClone(formulaSupplementalValues());
  weatherValues["000100009"].Warranty_Period_Years__c = null;
  assert.throws(
    () => parseCreditexVeuProductArtifact(
      artifact({ rows: formulaProductRows(), supplementalValues: weatherValues }),
      "application/json",
    ),
    /warranty years is missing/,
  );

  const rows = formulaProductRows();
  rows.find((row) => row[3] === "13A")[16] = null;
  assert.throws(
    () => parseCreditexVeuProductArtifact(
      artifact({ rows, supplementalValues: formulaSupplementalValues() }),
      "application/json",
    ),
    /WERS heating stars is missing/,
  );
});

test("VEU artifact marks exact official and future incomplete zone-5 rows unavailable", () => {
  const exceptionRow = approvedRow(
    "a0O000000000000006",
    "000035970",
    "1D",
  );
  const values = {
    "000035970": {
      System_Size__c: "Medium",
      Zone_4_Bs_GJyear_system_load_size__c: 5,
      Zone_4_Be_GJyear_system_load_size__c: 1,
      Zone_4_Bs_GJyear_step_down_load_size__c: 3,
      Zone_4_Be_GJyear_step_down_load_size__c: 0.8,
      Zone_4_Annual_Energy_Savings_system_l__c: 70,
      Zone_5_Annual_Energy_Savings_system_l__c: 0,
    },
  };
  const records = parseCreditexVeuProductArtifact(
    artifact({ rows: [...productRows(), exceptionRow], supplementalValues: values }),
    "application/json",
  );
  assert.equal(
    records.find(({ registrationNumber }) => registrationNumber === "000035970")
      .attributes.veuZone5ModelDataAvailable,
    false,
  );

  const unknownRow = [...exceptionRow];
  unknownRow[1] = "000100099";
  const unknownRecords = parseCreditexVeuProductArtifact(
    artifact({
      rows: [...productRows(), unknownRow],
      supplementalValues: { "000100099": values["000035970"] },
    }),
    "application/json",
  );
  assert.equal(
    unknownRecords.find(
      ({ registrationNumber }) => registrationNumber === "000100099",
    ).attributes.veuZone5ModelDataAvailable,
    false,
  );
});

test("VEU artifact fails closed on semantic model property drift", () => {
  assert.throws(
    () => parseCreditexVeuProductArtifact(
      artifact({ schemaOverrides: { productStableName: "changed" } }),
      "application/json",
    ),
    /Dim_Product property Id schema changed/,
  );
  assert.throws(
    () => parseCreditexVeuProductArtifact(
      artifact({
        schemaOverrides: { propertyName: "GEMS_HSPF_Cold_res__c" },
      }),
      "application/json",
    ),
    /Dim_Product property GEMS_HSPF_Cold_res__c schema changed/,
  );
  assert.throws(
    () => parseCreditexVeuProductArtifact(
      artifact({
        schemaOverrides: {
          numericFormatProperty: "Heating_Capacity_kW__c",
          numericFormat: "0.00",
        },
      }),
      "application/json",
    ),
    /Heating_Capacity_kW__c numeric format changed/,
  );
});

test("VEU artifact fails closed when an Approved formula field is missing", () => {
  const rows = productRows();
  rows[0][10] = null;
  assert.throws(
    () => parseCreditexVeuProductArtifact(
      artifact({ rows }),
      "application/json",
    ),
    /total volume is missing/,
  );
});

test("VEU artifact fails closed on an unknown blank-category product", () => {
  const rows = productRows();
  rows[3][1] = "000099999";
  assert.throws(
    () => parseCreditexVeuProductArtifact(
      artifact({ rows }),
      "application/json",
    ),
    /project-based-lighting control changed/,
  );
});

test("VEU artifact fails closed on aggregate-count and pagination drift", () => {
  const badTotal = mutateArtifact(artifact(), (value) => {
    value.controls.totalResponse = aggregateResponse(6);
  });
  assert.throws(
    () => parseCreditexVeuProductArtifact(badTotal, "application/json"),
    /official aggregate controls do not reconcile/,
  );
  const rows = productRows();
  [rows[0][0], rows[1][0]] = [rows[1][0], rows[0][0]];
  assert.throws(
    () => parseCreditexVeuProductArtifact(
      artifact({ rows }),
      "application/json",
    ),
    /product pagination is not strictly monotonic/,
  );
});

test("VEU public source live acquisition is opt-in", {
  skip: process.env.CREDITEX_LIVE_VEU_REGISTRY !== "1",
}, async () => {
  const { fetchCreditexVeuProductSources } = await import(
    "../src/lib/creditex-veu-product-sources.ts"
  );
  const [source] = await fetchCreditexVeuProductSources(fetch);
  const records = parseCreditexVeuProductArtifact(
    source.bytes,
    source.contentType,
  );
  assert.ok(records.length >= 70_000);
  const approved = records.filter(
    ({ approvalStatus }) => approvalStatus === "approved",
  ).length;
  const legacy = records.filter(
    ({ approvalStatus }) => approvalStatus === "legacy",
  ).length;
  assert.ok(approved > 0);
  assert.ok(legacy > 0);
  assert.equal(approved + legacy, records.length);
  for (const [productId, category] of [
    ["000035970", "1D"],
    ["000035971", "3C"],
  ]) {
    const water = records.find(
      ({ registrationNumber }) => registrationNumber === productId,
    );
    assert.equal(water.approvalStatus, "approved");
    assert.equal(water.attributes.veuProductCategoryNumber, category);
    assert.equal(water.attributes.veuZone4ModelDataAvailable, true);
    assert.equal(water.attributes.veuZone5ModelDataAvailable, false);
    assert.equal(water.attributes.zone5AnnualEnergySavings, undefined);
  }
});
