import assert from "node:assert/strict";
import test from "node:test";
import {
  CREDITEX_VEU_CATEGORY_PRODUCT_KIND,
  CREDITEX_VEU_DATASET_ID,
  CREDITEX_VEU_DIM_PRODUCT_SCHEMA,
  CREDITEX_VEU_MODEL_ID,
  CREDITEX_VEU_PRODUCT_ARTIFACT_CONTRACT,
  CREDITEX_VEU_PUBLIC_REGISTRY_SOURCE_KEY,
  CREDITEX_VEU_QUERY_FIELDS,
  CREDITEX_VEU_QUERY_FIELD_TYPES,
  CREDITEX_VEU_REFRESH_SCHEMA,
  CREDITEX_VEU_REPORT_ID,
  parseCreditexVeuProductArtifact,
} from "../src/lib/creditex-veu-product-parser.ts";

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
    .map(([Name, [DataType, StableName]]) => ({ Name, DataType, StableName }));
  if (overrides.productStableName) {
    productProperties[0].StableName = overrides.productStableName;
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
      400, 6, 300, null, null, "GEMS 2019",
    ],
    [
      "a0O000000000000002", "000000002", null, "24A", "activity-24",
      "View Brand", "TV 1", "Approved", epoch("2025-02-01"), null,
      null, 7, 100, 4_500, null, null,
    ],
    [
      "a0O000000000000003", "000000003", null, "25A", "activity-25",
      "Dry Brand", "Dryer 1", "Approved", epoch("2025-03-01"), null,
      null, 8, 120, null, 7, null,
    ],
    [
      "a0O000000000000004", "000029304", "PBA lighting products", null,
      "a0MW2000000vbXXMAY", "Philips", "PBA lamp", "Legacy",
      epoch("2012-01-01"), epoch("2020-01-01"),
      null, null, null, null, null, null,
    ],
    [
      "a0O000000000000005", "000000005", "historic-12", "12A", null,
      "Old Brand", "Old activity 12", "Legacy",
      epoch("2010-01-01"), epoch("2019-01-01"),
      null, null, null, null, null, null,
    ],
  ];
}

function compressedProductResponse(rows) {
  const schema = CREDITEX_VEU_QUERY_FIELD_TYPES.map((T, index) => ({
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
    CREDITEX_VEU_QUERY_FIELDS.map((field) => `Dim_Product.${field}`),
    { PH: [{ DM0: compressed }], IC: true, HAD: true },
  );
}

function artifact(overrides = {}) {
  const rows = overrides.rows || productRows();
  const statusEntries = [["Approved", 3], ["Legacy", 2]];
  const categoryEntries = [["", 1], ["12A", 1], ["22A", 1], ["24A", 1], ["25A", 1]];
  const categories = Object.fromEntries([
    "",
    ...Object.keys(CREDITEX_VEU_CATEGORY_PRODUCT_KIND),
  ].map((category) => [
    category,
    Object.fromEntries(categoryEntries)[category] || 0,
  ]));
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
      statuses: { Approved: 3, Legacy: 2 },
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
  };
  return textEncoder.encode(JSON.stringify(value));
}

function mutateArtifact(bytes, mutation) {
  const value = JSON.parse(new TextDecoder().decode(bytes));
  mutation(value);
  return textEncoder.encode(JSON.stringify(value));
}

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

test("VEU artifact fails closed on semantic model property drift", () => {
  assert.throws(
    () => parseCreditexVeuProductArtifact(
      artifact({ schemaOverrides: { productStableName: "changed" } }),
      "application/json",
    ),
    /Dim_Product property Id schema changed/,
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
    /unrecognised blank-category product identity/,
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
});
