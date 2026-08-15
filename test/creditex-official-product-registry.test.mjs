import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { CreditexOfficialProductError } from "../src/lib/creditex-official-product-registry.ts";
import {
  ensureAutomaticOfficialProductRegistryCurrent,
  loadOfficialProductRegistryStatus,
  searchOfficialProducts,
  syncOfficialProductRegistry,
  validateOfficialProductSelections,
  verifyCreditexControlledProductPermissionArtifact,
} from "../src/lib/creditex-official-product-registry-server.ts";
import {
  CREDITEX_AUTOMATIC_PRODUCT_REGISTRIES,
  CREDITEX_CER_CEC_PRODUCT_REGISTRY,
  CREDITEX_CONTROLLED_MANUAL_PRODUCT_REGISTRIES,
  CREDITEX_VEU_PRODUCT_REGISTRY,
} from "../src/lib/creditex-official-product-registry-definitions.ts";
import {
  CREDITEX_OFFICIAL_PRODUCT_REGISTRY_SCHEMA_GUARDS,
} from "../src/lib/creditex-product-registry-schema-guards.ts";

const sresMigration = fs.readFileSync(
  new URL(
    "../drizzle/0124_creditex_sres_product_registry.sql",
    import.meta.url,
  ),
  "utf8",
);

const officialMigration = fs.readFileSync(
  new URL(
    "../drizzle/0125_creditex_official_product_registry.sql",
    import.meta.url,
  ),
  "utf8",
);
const refreshQueueMigration = fs.readFileSync(
  new URL(
    "../drizzle/0148_creditex_official_product_refresh_requests.sql",
    import.meta.url,
  ),
  "utf8",
);
const streamStagingMigration = fs.readFileSync(
  new URL(
    "../drizzle/0149_creditex_official_product_stream_staging.sql",
    import.meta.url,
  ),
  "utf8",
);

class TestD1Statement {
  constructor(database, sql, values = [], onBind = () => undefined) {
    this.database = database;
    this.sql = sql;
    this.values = values;
    this.onBind = onBind;
  }

  bind(...values) {
    this.onBind(this.sql, values);
    return new TestD1Statement(this.database, this.sql, values, this.onBind);
  }

  async first() {
    return this.database.prepare(this.sql).get(...this.values) || null;
  }

  async all() {
    return { results: this.database.prepare(this.sql).all(...this.values) };
  }

  runSync() {
    const result = this.database.prepare(this.sql).run(...this.values);
    return { success: true, meta: { changes: Number(result.changes) } };
  }

  async run() {
    return this.runSync();
  }
}

function testD1(
  database,
  { onBind = () => undefined, onBatch = () => undefined } = {},
) {
  return {
    prepare(sql) {
      return new TestD1Statement(database, sql, [], onBind);
    },
    async batch(statements) {
      onBatch(statements);
      database.exec("BEGIN");
      try {
        const results = statements.map((statement) => statement.runSync());
        database.exec("COMMIT");
        return results;
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    },
  };
}

function memoryArtifactStore() {
  const objects = new Map();
  return {
    objects,
    async head(key) {
      const value = objects.get(key);
      return value
        ? { size: value.bytes.byteLength, customMetadata: value.customMetadata }
        : null;
    },
    async get(key) {
      const value = objects.get(key);
      return value
        ? {
            async arrayBuffer() {
              return Uint8Array.from(value.bytes).buffer;
            },
          }
        : null;
    },
    async put(key, value, options) {
      objects.set(key, {
        bytes: Uint8Array.from(value),
        customMetadata: { ...options.customMetadata },
      });
    },
  };
}

async function retainControlledPermissionArtifact(
  store,
  {
    organisationId = "creditex-org",
    artifactId = "permission-artifact-42",
    objectKey = `creditex/official-sources/${artifactId}.json`,
  } = {},
) {
  const bytes = new TextEncoder().encode(JSON.stringify({
    organisationId,
    permission: "approved source reuse",
  }));
  const sha256 = await crypto.subtle.digest("SHA-256", bytes).then((digest) => (
    [...new Uint8Array(digest)]
      .map((value) => value.toString(16).padStart(2, "0"))
      .join("")
  ));
  const permission = {
    organisationId,
    artifactId,
    sha256,
    objectKey,
    sizeBytes: bytes.byteLength,
  };
  await store.put(objectKey, bytes, {
    httpMetadata: { contentType: "application/json" },
    customMetadata: {
      organisationId,
      artifactId,
      sha256,
      custodyState: "pending_review",
    },
  });
  return permission;
}

function fileArtifactStore() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "creditex-veu-r2-"));
  const objects = new Map();
  return {
    directory,
    objects,
    async head(key) {
      const value = objects.get(key);
      return value
        ? {
            size: fs.statSync(value.path).size,
            customMetadata: value.customMetadata,
          }
        : null;
    },
    async get(key) {
      const value = objects.get(key);
      return value
        ? {
            async arrayBuffer() {
              const bytes = fs.readFileSync(value.path);
              return bytes.buffer.slice(
                bytes.byteOffset,
                bytes.byteOffset + bytes.byteLength,
              );
            },
          }
        : null;
    },
    async put(key, value, options) {
      const objectPath = path.join(directory, String(objects.size));
      fs.writeFileSync(objectPath, value);
      objects.set(key, {
        path: objectPath,
        customMetadata: { ...options.customMetadata },
      });
    },
  };
}

function fixture(options = {}) {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  database.exec(sresMigration);
  database.exec(officialMigration);
  database.exec(refreshQueueMigration);
  database.exec(streamStagingMigration);
  for (const guard of CREDITEX_OFFICIAL_PRODUCT_REGISTRY_SCHEMA_GUARDS) {
    database.exec(guard.sql);
  }
  return {
    database,
    d1: testD1(database, options),
    artifactStore: memoryArtifactStore(),
  };
}

const rows = {
  "fixture-pv": [
    {
      sourceKey: "fixture-pv",
      sourceRecordKey: "PV-001|Maker|Panel 400",
      productKind: "pv_module",
      manufacturer: "Maker Pty Ltd",
      brand: "Bright Panel",
      model: "Panel 400",
      series: "P Series",
      registrationNumber: "",
      certificateNumber: "PV-001",
      approvalStatus: "approved",
      eligibleFrom: "2025-01-01",
      eligibleTo: "2030-12-31",
      availableInAustralia: true,
      attributes: { watts: 400, bifacial: false },
    },
    {
      sourceKey: "fixture-pv",
      sourceRecordKey: "PV-002|Maker|Panel 500",
      productKind: "pv_module",
      manufacturer: "Maker Pty Ltd",
      brand: "Bright Panel",
      model: "Panel 500",
      series: "P Series",
      registrationNumber: "",
      certificateNumber: "PV-002",
      approvalStatus: "expired",
      eligibleFrom: "2020-01-01",
      eligibleTo: "2025-12-31",
      availableInAustralia: true,
      attributes: { watts: 500, bifacial: true },
    },
  ],
  "fixture-inverter": [
    {
      sourceKey: "fixture-inverter",
      sourceRecordKey: "INV-001|Maker|INV5",
      productKind: "inverter",
      manufacturer: "Maker Pty Ltd",
      brand: "Bright Inverter",
      model: "INV5",
      series: "I Series",
      registrationNumber: "",
      certificateNumber: "INV-001",
      approvalStatus: "approved",
      eligibleFrom: "2025-01-01",
      eligibleTo: "2030-12-31",
      availableInAustralia: true,
      attributes: { ratedAcOutputKw: 5, phases: 1 },
    },
    {
      sourceKey: "fixture-inverter",
      sourceRecordKey: "INV-002|Maker|INV10",
      productKind: "inverter",
      manufacturer: "Maker Pty Ltd",
      brand: "Bright Inverter",
      model: "INV10",
      series: "I Series",
      registrationNumber: "",
      certificateNumber: "INV-002",
      approvalStatus: "approved",
      eligibleFrom: "2025-01-01",
      eligibleTo: "2030-12-31",
      availableInAustralia: true,
      attributes: { ratedAcOutputKw: 10, phases: 3 },
    },
  ],
  "fixture-gems-ac": [
    {
      sourceKey: "fixture-gems-ac",
      sourceRecordKey: "AC-001|Current",
      productKind: "air_conditioner",
      manufacturer: "",
      brand: "Current Air",
      model: "AC-001",
      series: "",
      registrationNumber: "GEMS-AC-001",
      certificateNumber: "",
      approvalStatus: "approved",
      eligibleFrom: "2025-01-01",
      eligibleTo: "2030-12-31",
      availableInAustralia: true,
      attributes: { ratedCoolingCapacityKw: 5 },
    },
    {
      sourceKey: "fixture-gems-ac",
      sourceRecordKey: "AC-002|Superseded",
      productKind: "air_conditioner",
      manufacturer: "",
      brand: "Old Air",
      model: "AC-002",
      series: "",
      registrationNumber: "GEMS-AC-002",
      certificateNumber: "",
      approvalStatus: "superseded",
      eligibleFrom: "2025-01-01",
      eligibleTo: "2030-12-31",
      availableInAustralia: true,
      attributes: { ratedCoolingCapacityKw: 6 },
    },
    {
      sourceKey: "fixture-gems-ac",
      sourceRecordKey: "AC-003|Pending",
      productKind: "air_conditioner",
      manufacturer: "",
      brand: "Pending Air",
      model: "AC-003",
      series: "",
      registrationNumber: "GEMS-AC-003",
      certificateNumber: "",
      approvalStatus: "pending_review",
      eligibleFrom: "2025-01-01",
      eligibleTo: "2030-12-31",
      availableInAustralia: true,
      attributes: { ratedCoolingCapacityKw: 7 },
    },
  ],
};

function source(sourceKey, productKind, registryCode = "cer-cec-products") {
  return {
    registryCode,
    sourceKey,
    productKind,
    url: `https://example.test/${sourceKey}`,
    minimumRecords: 2,
    maximumBytes: 100_000,
    expectedContentTypes: ["application/json"],
    accept: "application/json",
    licence: "fixture official licence",
    productionMode: "automatic",
    parse(bytes) {
      return JSON.parse(new TextDecoder().decode(bytes));
    },
  };
}

const definition = {
  registryCode: "cer-cec-products",
  title: "Fixture official CEC products",
  sources: [
    source("fixture-pv", "pv_module"),
    source("fixture-inverter", "inverter"),
  ],
};

const gemsDefinition = {
  registryCode: "gems-products",
  title: "Fixture official GEMS products",
  sources: [source("fixture-gems-ac", "air_conditioner", "gems-products")],
};

test("generic registry uses Worker-compatible no-store source requests", async () => {
  const { d1, artifactStore } = fixture();
  const requests = [];
  const fixtureFetch = fetchFixture();
  await syncOfficialProductRegistry(d1, definition, {
    fetchImpl: async (input, init) => {
      requests.push({ input: String(input), init });
      return fixtureFetch(input, init);
    },
    artifactStore,
    now: new Date("2026-08-08T00:00:00.000Z"),
  });

  assert.equal(requests.length, definition.sources.length);
  for (const [index, request] of requests.entries()) {
    assert.equal(request.input, definition.sources[index].url);
    assert.equal(request.init.cache, "no-store");
    assert.equal(request.init.method, undefined);
    assert.equal(request.init.redirect, "manual");
    assert.equal(
      new Headers(request.init.headers).get("accept"),
      definition.sources[index].accept,
    );
    assert.equal(
      new Headers(request.init.headers).has("user-agent"),
      false,
    );
  }
});

test("generic registry rejects official source redirects without following them", async () => {
  const { d1, artifactStore } = fixture();

  await assert.rejects(
    syncOfficialProductRegistry(d1, definition, {
      fetchImpl: async () => new Response(null, {
        status: 307,
        headers: { location: "https://untrusted.example/products.json" },
      }),
      artifactStore,
      now: new Date("2026-08-08T00:00:00.000Z"),
    }),
    expectedError("OFFICIAL_PRODUCT_SOURCE_UNAVAILABLE"),
  );
});

test("registry first-seen dating never invents eligibility for an ineligible official row", async () => {
  const { database, d1, artifactStore } = fixture();
  const record = (sourceRecordKey, approvalStatus) => ({
    sourceKey: "fixture-tessa-water-heaters",
    sourceRecordKey,
    productKind: "nsw_heat_pump_water_heater",
    manufacturer: "Exact Supplier",
    brand: "Exact Brand",
    model: sourceRecordKey,
    series: "Water Heater - Heat Pump",
    registrationNumber: sourceRecordKey,
    certificateNumber: "",
    approvalStatus,
    eligibleFrom: "",
    eligibleTo: "",
    availableInAustralia: approvalStatus === "approved",
    attributes: { tessaOfficialStatus: approvalStatus },
  });
  const sourceRows = [
    record("ACC0000001", "approved"),
    record("ACC0000002", "not_approved"),
  ];
  const registry = {
    registryCode: "nsw-tessa-products",
    title: "Fixture TESSA products",
    sources: [{
      ...source(
        "fixture-tessa-water-heaters",
        "nsw_heat_pump_water_heater",
        "nsw-tessa-products",
      ),
      minimumRecords: 2,
    }],
  };
  await syncOfficialProductRegistry(d1, registry, {
    fetchImpl: fetchFixture({
      "fixture-tessa-water-heaters": sourceRows,
    }),
    artifactStore,
    now: new Date("2026-08-08T00:00:00.000Z"),
  });
  const dates = database.prepare(`SELECT source_record_key, eligible_from
    FROM compliance_official_products
    ORDER BY source_record_key`).all().map((row) => ({ ...row }));
  assert.deepEqual(dates, [
    { source_record_key: "ACC0000001", eligible_from: "2026-08-08" },
    { source_record_key: "ACC0000002", eligible_from: "" },
  ]);
  const exact = await searchOfficialProducts(d1, {
    productKind: "nsw_heat_pump_water_heater",
    installationDate: "2026-08-08",
    brand: "Exact Brand",
    model: "ACC0000001",
  }, { now: new Date("2026-08-08T01:00:00.000Z") });
  assert.equal(exact.matchCount, 1);
  assert.equal(exact.products[0].sourceRecordKey, "ACC0000001");
  const nearMatch = await searchOfficialProducts(d1, {
    productKind: "nsw_heat_pump_water_heater",
    installationDate: "2026-08-08",
    brand: "Exact Bran",
  }, { now: new Date("2026-08-08T01:00:00.000Z") });
  assert.equal(nearMatch.matchCount, 0);
  assert.deepEqual(nearMatch.products, []);
});

function fetchFixture(overrides = {}) {
  return async (input) => {
    const sourceKey = String(input).split("/").at(-1);
    const body = JSON.stringify(overrides[sourceKey] ?? rows[sourceKey]);
    return new Response(body, {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-length": String(new TextEncoder().encode(body).byteLength),
      },
    });
  };
}

function expectedError(code) {
  return (error) => {
    assert.ok(error instanceof CreditexOfficialProductError);
    assert.equal(error.code, code);
    return true;
  };
}

function stableProductId(sourceKey, sourceRecordKey) {
  return `official-product-v1:${sourceKey.length}:${sourceKey}${sourceRecordKey}`;
}

test("generic official registry activates atomically and returns effective-dated products", async () => {
  const { database, d1, artifactStore } = fixture();
  const first = await syncOfficialProductRegistry(d1, definition, {
    fetchImpl: fetchFixture(),
    artifactStore,
    now: new Date("2026-08-08T00:00:00.000Z"),
  });
  assert.equal(first.changed, true);
  assert.equal(first.recordCount, 4);
  assert.equal(database.prepare(`SELECT count(*) count
    FROM compliance_official_products`).get().count, 4);
  assert.equal(artifactStore.objects.size, 2);

  const search = await searchOfficialProducts(d1, {
    productKind: "pv_module",
    installationDate: "2026-08-08",
    query: "panel 400",
  }, { now: new Date("2026-08-08T01:00:00.000Z") });
  assert.equal(search.registry.status, "current");
  assert.equal(search.products.length, 1);
  assert.equal(search.products[0].model, "Panel 400");
  assert.deepEqual(search.products[0].attributes, {
    bifacial: false,
    watts: 400,
  });

  const inverter = await searchOfficialProducts(d1, {
    productKind: "inverter",
    installationDate: "2026-08-08",
    query: "inv5",
  }, { now: new Date("2026-08-08T01:00:00.000Z") });
  const validated = await validateOfficialProductSelections(d1, {
    installationDate: "2026-08-08",
    requiredKinds: ["pv_module", "inverter"],
    selectedProductIds: {
      pv_module: search.products[0].id,
      inverter: inverter.products[0].id,
    },
  }, { now: new Date("2026-08-08T01:00:00.000Z") });
  assert.equal(validated.selections.length, 2);
  assert.deepEqual(
    validated.registryReceipt.snapshots.map(({ registryCode }) => registryCode),
    ["cer-cec-products"],
  );
});

test("official product facets expose every eligible brand and narrow exact duplicate models", async () => {
  const facetStatements = [];
  const { database, d1, artifactStore } = fixture({
    onBind(sql, values) {
      if (sql.includes("product.model = ?")) facetStatements.push({ sql, values });
    },
  });
  const approvedRows = Array.from({ length: 105 }, (_, index) => ({
    sourceKey: "fixture-veu-facets",
    sourceRecordKey: `VEU-${String(index).padStart(3, "0")}`,
    productKind: "veu_air_conditioner",
    manufacturer: "",
    brand: `Brand ${String(index).padStart(3, "0")}`,
    model: index === 0 ? "Shared Model" : `Model ${String(index).padStart(3, "0")}`,
    series: "",
    registrationNumber: `VEU-${String(index).padStart(3, "0")}`,
    certificateNumber: "",
    approvalStatus: "approved",
    eligibleFrom: "2026-01-01",
    eligibleTo: "",
    availableInAustralia: true,
    attributes: index === 0
      ? {
          veuProductCategoryNumber: "6D",
          veuProductType: "Ducted",
          veuProductConfiguration: "Single split system",
        }
      : { veuProductCategoryNumber: "6D" },
  }));
  const exactDuplicate = {
    ...approvedRows[0],
    sourceRecordKey: "VEU-000-B",
    registrationNumber: "VEU-000-B",
    attributes: {
      veuProductCategoryNumber: "6D",
      veuProductType: "Non-Ducted",
      veuProductConfiguration: "Packaged",
    },
  };
  const legacy = {
    ...approvedRows[0],
    sourceRecordKey: "VEU-LEGACY",
    brand: "Legacy Brand",
    model: "Historical Model",
    registrationNumber: "VEU-LEGACY",
    approvalStatus: "legacy",
    eligibleFrom: "2026-01-01",
    eligibleTo: "2026-08-08",
    attributes: { veuProductCategoryNumber: "6D" },
  };
  const mixedTypeRows = [
    {
      ...approvedRows[0],
      sourceRecordKey: "VEU-MIXED-CLASSIFIED",
      brand: "Mixed Brand",
      model: "Mixed Model",
      series: "Series A",
      registrationNumber: "VEU-MIXED-CLASSIFIED",
      attributes: { veuProductCategoryNumber: "6D" },
    },
    {
      ...approvedRows[0],
      sourceRecordKey: "VEU-MIXED-UNCLASSIFIED",
      brand: "Mixed Brand",
      model: "Mixed Model",
      series: "",
      registrationNumber: "VEU-MIXED-UNCLASSIFIED",
      attributes: { veuProductCategoryNumber: "6D" },
    },
  ];
  const facetRows = [
    ...approvedRows,
    exactDuplicate,
    legacy,
    ...mixedTypeRows,
  ];
  const facetSource = {
    ...source(
      "fixture-veu-facets",
      "veu_air_conditioner",
      "veu-approved-products",
    ),
    minimumRecords: facetRows.length,
    requiresOfficialEligibleFrom: true,
  };
  const facetDefinition = {
    registryCode: "veu-approved-products",
    title: "Fixture VEU product facets",
    sources: [facetSource],
  };
  await syncOfficialProductRegistry(d1, facetDefinition, {
    fetchImpl: fetchFixture({ "fixture-veu-facets": facetRows }),
    artifactStore,
    now: new Date("2026-08-08T00:00:00.000Z"),
  });

  const broad = await searchOfficialProducts(d1, {
    productKind: "veu_air_conditioner",
    installationDate: "2026-08-08",
    veuActivityCode: "6",
    limit: 100,
  }, { now: new Date("2026-08-08T01:00:00.000Z") });
  assert.equal(broad.products.length, 100);
  assert.equal(broad.matchCount, facetRows.length);
  assert.equal(broad.facets.brands.length, 107);
  assert.deepEqual(broad.facets.models, []);
  assert.deepEqual(broad.facets.productTypes, []);
  assert.deepEqual(broad.facets.brands[0], {
    value: "Brand 000",
    label: "Brand 000",
    count: 2,
  });
  assert.ok(broad.facets.brands.some(({ value }) => value === "Legacy Brand"));
  assert.doesNotMatch(
    JSON.stringify(broad),
    /attributes_json|search_text|source_manifest_json|object_key/i,
  );

  const byBrand = await searchOfficialProducts(d1, {
    productKind: "veu_air_conditioner",
    installationDate: "2026-08-08",
    veuActivityCode: "6",
    brand: "Brand 000",
    query: "shared",
  }, { now: new Date("2026-08-08T01:00:00.000Z") });
  assert.equal(byBrand.facets.brands.length, 107);
  assert.deepEqual(byBrand.facets.models, [{
    value: "Shared Model",
    label: "Shared Model",
    count: 2,
  }]);
  assert.deepEqual(byBrand.facets.productTypes, []);
  assert.equal(byBrand.matchCount, 2);

  const byModel = await searchOfficialProducts(d1, {
    productKind: "veu_air_conditioner",
    installationDate: "2026-08-08",
    veuActivityCode: "6",
    brand: "Brand 000",
    model: "Shared Model",
  }, { now: new Date("2026-08-08T01:00:00.000Z") });
  assert.equal(byModel.matchCount, 2);
  assert.deepEqual(byModel.facets.productTypes, [
    {
      value: "Ducted | Single split system",
      label: "Ducted | Single split system",
      count: 1,
    },
    {
      value: "Non-Ducted | Packaged",
      label: "Non-Ducted | Packaged",
      count: 1,
    },
  ]);
  assert.equal(byModel.products.length, 2);

  const mixedClassification = await searchOfficialProducts(d1, {
    productKind: "veu_air_conditioner",
    installationDate: "2026-08-08",
    veuActivityCode: "6",
    brand: "Mixed Brand",
    model: "Mixed Model",
  }, { now: new Date("2026-08-08T01:00:00.000Z") });
  assert.equal(mixedClassification.matchCount, 2);
  assert.deepEqual(mixedClassification.facets.productTypes, [
    { value: "6D", label: "6D", count: 1 },
    { value: "Series A", label: "Series A", count: 1 },
  ]);
  assert.deepEqual(
    mixedClassification.products.map(({ registrationNumber }) => registrationNumber),
    ["VEU-MIXED-CLASSIFIED", "VEU-MIXED-UNCLASSIFIED"],
  );

  const exactType = await searchOfficialProducts(d1, {
    productKind: "veu_air_conditioner",
    installationDate: "2026-08-08",
    veuActivityCode: "6",
    brand: "Brand 000",
    model: "Shared Model",
    productType: "Non-Ducted | Packaged",
  }, { now: new Date("2026-08-08T01:00:00.000Z") });
  assert.equal(exactType.matchCount, 1);
  assert.equal(exactType.products.length, 1);
  assert.equal(exactType.products[0].registrationNumber, "VEU-000-B");
  const exactProductStatement = facetStatements.find(({ sql }) => (
    sql.includes("product.id, product.snapshot_id")
    && sql.includes("product.model = ?")
    && sql.includes("ORDER BY product.brand")
  ));
  assert.ok(exactProductStatement);
  const queryPlan = database.prepare(
    `EXPLAIN QUERY PLAN ${exactProductStatement.sql}`,
  ).all(...exactProductStatement.values);
  assert.match(
    queryPlan.map(({ detail }) => detail).join("\n"),
    /compliance_official_products_model_idx/,
  );

  const legacyOnFinalDay = await searchOfficialProducts(d1, {
    productKind: "veu_air_conditioner",
    installationDate: "2026-08-08",
    veuActivityCode: "6",
    brand: "Legacy Brand",
    model: "Historical Model",
  }, { now: new Date("2026-08-08T01:00:00.000Z") });
  assert.equal(legacyOnFinalDay.matchCount, 1);
  const validatedLegacy = await validateOfficialProductSelections(d1, {
    installationDate: "2026-08-08",
    requiredKinds: ["veu_air_conditioner"],
    selectedProductIds: {
      veu_air_conditioner: legacyOnFinalDay.products[0].id,
    },
  }, { now: new Date("2026-08-08T01:00:00.000Z") });
  assert.equal(validatedLegacy.selections[0].approvalStatus, "legacy");
  assert.equal(validatedLegacy.selections[0].eligibleTo, "2026-08-08");

  const afterLegacyWindow = await searchOfficialProducts(d1, {
    productKind: "veu_air_conditioner",
    installationDate: "2026-08-09",
    veuActivityCode: "6",
    brand: "Legacy Brand",
    model: "Historical Model",
  }, { now: new Date("2026-08-09T01:00:00.000Z") });
  assert.equal(afterLegacyWindow.matchCount, 0);
  assert.deepEqual(afterLegacyWindow.products, []);
  assert.ok(!afterLegacyWindow.facets.brands.some(
    ({ value }) => value === "Legacy Brand",
  ));
});

test("an explicit unclassified product-type facet keeps every eligible approval selectable", async () => {
  const { d1, artifactStore } = fixture();
  const mixedRows = [
    {
      sourceKey: "fixture-gems-mixed-types",
      sourceRecordKey: "GEMS-MIXED-CLASSIFIED",
      productKind: "air_conditioner",
      manufacturer: "Mixed Maker",
      brand: "Mixed Air",
      model: "MIX-100",
      series: "Series A",
      registrationNumber: "GEMS-MIXED-CLASSIFIED",
      certificateNumber: "",
      approvalStatus: "approved",
      eligibleFrom: "2026-01-01",
      eligibleTo: "",
      availableInAustralia: true,
      attributes: {},
    },
    {
      sourceKey: "fixture-gems-mixed-types",
      sourceRecordKey: "GEMS-OWNER-UNPUBLISHED",
      productKind: "air_conditioner",
      manufacturer: "",
      brand: "",
      model: "OWNER-UNKNOWN",
      series: "",
      registrationNumber: "GEMS-OWNER-UNPUBLISHED",
      certificateNumber: "",
      approvalStatus: "approved",
      eligibleFrom: "2026-01-01",
      eligibleTo: "",
      availableInAustralia: true,
      attributes: {},
    },
    {
      sourceKey: "fixture-gems-mixed-types",
      sourceRecordKey: "GEMS-MIXED-UNCLASSIFIED",
      productKind: "air_conditioner",
      manufacturer: "Mixed Maker",
      brand: "Mixed Air",
      model: "MIX-100",
      series: "",
      registrationNumber: "GEMS-MIXED-UNCLASSIFIED",
      certificateNumber: "",
      approvalStatus: "approved",
      eligibleFrom: "2026-01-01",
      eligibleTo: "",
      availableInAustralia: true,
      attributes: {},
    },
  ];
  const mixedDefinition = {
    registryCode: "gems-products",
    title: "Fixture GEMS mixed product types",
    sources: [{
      ...source(
        "fixture-gems-mixed-types",
        "air_conditioner",
        "gems-products",
      ),
      minimumRecords: mixedRows.length,
    }],
  };
  await syncOfficialProductRegistry(d1, mixedDefinition, {
    fetchImpl: fetchFixture({ "fixture-gems-mixed-types": mixedRows }),
    artifactStore,
    now: new Date("2026-08-08T00:00:00.000Z"),
  });

  const ownerFacets = await searchOfficialProducts(d1, {
    productKind: "air_conditioner",
    installationDate: "2026-08-08",
    limit: 1,
  }, { now: new Date("2026-08-08T01:00:00.000Z") });
  assert.ok(ownerFacets.facets.brands.some((option) => (
    option.value === "__official_owner_not_published__"
    && option.label === "Official owner not published"
    && option.count === 1
  )));

  const search = await searchOfficialProducts(d1, {
    productKind: "air_conditioner",
    installationDate: "2026-08-08",
    brand: "Mixed Air",
    model: "MIX-100",
  }, { now: new Date("2026-08-08T01:00:00.000Z") });
  assert.equal(search.matchCount, 2);
  assert.deepEqual(search.facets.productTypes, [
    {
      value: "__official_product_type_not_published__",
      label: "Not separately classified",
      count: 1,
    },
    { value: "Series A", label: "Series A", count: 1 },
  ]);
  assert.deepEqual(
    search.products.map(({ registrationNumber }) => registrationNumber),
    ["GEMS-MIXED-CLASSIFIED", "GEMS-MIXED-UNCLASSIFIED"],
  );
});

test("exact owner and model search fails closed instead of truncating approval records", async () => {
  const { d1, artifactStore } = fixture();
  const duplicateRows = Array.from({ length: 101 }, (_, index) => ({
    sourceKey: "fixture-gems-exact-overflow",
    sourceRecordKey: `GEMS-OVERFLOW-${String(index).padStart(3, "0")}`,
    productKind: "air_conditioner",
    manufacturer: "Overflow Maker",
    brand: "Overflow Air",
    model: "ONE-MODEL",
    series: "",
    registrationNumber: `GEMS-OVERFLOW-${String(index).padStart(3, "0")}`,
    certificateNumber: "",
    approvalStatus: "approved",
    eligibleFrom: "2026-01-01",
    eligibleTo: "",
    availableInAustralia: true,
    attributes: {},
  }));
  const overflowDefinition = {
    registryCode: "gems-products",
    title: "Fixture GEMS exact-record overflow",
    sources: [{
      ...source(
        "fixture-gems-exact-overflow",
        "air_conditioner",
        "gems-products",
      ),
      minimumRecords: duplicateRows.length,
      maximumBytes: 1_000_000,
    }],
  };
  await syncOfficialProductRegistry(d1, overflowDefinition, {
    fetchImpl: fetchFixture({ "fixture-gems-exact-overflow": duplicateRows }),
    artifactStore,
    now: new Date("2026-08-08T00:00:00.000Z"),
  });

  const broadExactIdentity = await searchOfficialProducts(d1, {
    productKind: "air_conditioner",
    installationDate: "2026-08-08",
    brand: "Overflow Air",
    model: "ONE-MODEL",
    limit: 100,
  }, { now: new Date("2026-08-08T01:00:00.000Z") });
  assert.equal(broadExactIdentity.matchCount, 101);
  assert.deepEqual(broadExactIdentity.products, []);
  assert.deepEqual(broadExactIdentity.facets.productTypes, [{
    value: "__official_product_type_not_published__",
    label: "Not separately classified",
    count: 101,
  }]);

  await assert.rejects(
    searchOfficialProducts(d1, {
      productKind: "air_conditioner",
      installationDate: "2026-08-08",
      brand: "Overflow Air",
      model: "ONE-MODEL",
      productType: "__official_product_type_not_published__",
      limit: 100,
    }, { now: new Date("2026-08-08T01:00:00.000Z") }),
    expectedError("OFFICIAL_PRODUCT_REQUEST_INVALID"),
  );
});

test("VEU facets are restricted to governed activity and scenario categories", async () => {
  const { d1, artifactStore } = fixture();
  const veuCategoryRecord = (
    sourceRecordKey,
    productKind,
    brand,
    model,
    category,
  ) => ({
    sourceKey: "fixture-veu-governed-categories",
    sourceRecordKey,
    productKind,
    manufacturer: "",
    brand,
    model,
    series: "",
    registrationNumber: sourceRecordKey,
    certificateNumber: "",
    approvalStatus: "approved",
    eligibleFrom: "2026-01-01",
    eligibleTo: "",
    availableInAustralia: true,
    attributes: { veuProductCategoryNumber: category },
  });
  const categoryRows = [
    veuCategoryRecord("VEU-1C", "veu_water_heater", "Heater Co", "1C Model", "1C"),
    veuCategoryRecord("VEU-1D", "veu_water_heater", "Heater Co", "1D Model", "1D"),
    veuCategoryRecord("VEU-1D-ONLY", "veu_water_heater", "1D Only", "1D Other", "1D"),
    veuCategoryRecord("VEU-3C", "veu_water_heater", "Other Heater", "3C Model", "3C"),
    veuCategoryRecord("VEU-3D", "veu_water_heater", "Other Heater", "3D Model", "3D"),
    veuCategoryRecord(
      "VEU-15A",
      "veu_weather_sealing",
      "Weather Shared",
      "Door Seal",
      "15A",
    ),
    veuCategoryRecord(
      "VEU-15B",
      "veu_weather_sealing",
      "Weather Shared",
      "Window Seal",
      "15B",
    ),
    veuCategoryRecord(
      "VEU-27A",
      "veu_activity_27_product",
      "Lighting Shared",
      "27A Control",
      "27A",
    ),
    veuCategoryRecord(
      "VEU-27B-SHARED",
      "veu_activity_27_product",
      "Lighting Shared",
      "27B Luminaire",
      "27B",
    ),
    veuCategoryRecord(
      "VEU-27B-ONLY",
      "veu_activity_27_product",
      "27B Only",
      "27B Other",
      "27B",
    ),
    veuCategoryRecord(
      "VEU-48A",
      "veu_ceiling_insulation",
      "Insulation Shared",
      "48A Product",
      "48A",
    ),
    veuCategoryRecord(
      "VEU-48B",
      "veu_ceiling_insulation",
      "Insulation Shared",
      "48B Product",
      "48B",
    ),
  ];
  const categorySource = {
    ...source(
      "fixture-veu-governed-categories",
      "veu_water_heater",
      "veu-approved-products",
    ),
    productKind: undefined,
    productKinds: [
      "veu_water_heater",
      "veu_weather_sealing",
      "veu_activity_27_product",
      "veu_ceiling_insulation",
    ],
    minimumRecords: categoryRows.length,
    requiresOfficialEligibleFrom: true,
  };
  const categoryDefinition = {
    registryCode: "veu-approved-products",
    title: "Fixture governed VEU categories",
    sources: [categorySource],
  };
  await syncOfficialProductRegistry(d1, categoryDefinition, {
    fetchImpl: fetchFixture({
      "fixture-veu-governed-categories": categoryRows,
    }),
    artifactStore,
    now: new Date("2026-08-08T00:00:00.000Z"),
  });

  const activity1C = await searchOfficialProducts(d1, {
    productKind: "veu_water_heater",
    installationDate: "2026-08-08",
    veuActivityCode: "1C",
  }, { now: new Date("2026-08-08T01:00:00.000Z") });
  assert.equal(activity1C.matchCount, 1);
  assert.deepEqual(activity1C.facets.brands, [{
    value: "Heater Co",
    label: "Heater Co",
    count: 1,
  }]);
  assert.deepEqual(
    activity1C.products.map(({ registrationNumber }) => registrationNumber),
    ["VEU-1C"],
  );

  const scenario27A = await searchOfficialProducts(d1, {
    productKind: "veu_activity_27_product",
    installationDate: "2026-08-08",
    veuActivityCode: "27",
    veuScenario: "27A",
  }, { now: new Date("2026-08-08T01:00:00.000Z") });
  assert.equal(scenario27A.matchCount, 1);
  assert.deepEqual(scenario27A.facets.brands, [{
    value: "Lighting Shared",
    label: "Lighting Shared",
    count: 1,
  }]);
  assert.deepEqual(
    scenario27A.products.map(({ registrationNumber }) => registrationNumber),
    ["VEU-27A"],
  );

  const activity15 = await searchOfficialProducts(d1, {
    productKind: "veu_weather_sealing",
    installationDate: "2026-08-08",
    veuActivityCode: "15",
  }, { now: new Date("2026-08-08T01:00:00.000Z") });
  assert.equal(activity15.matchCount, 2);

  const scenario15A = await searchOfficialProducts(d1, {
    productKind: "veu_weather_sealing",
    installationDate: "2026-08-08",
    veuActivityCode: "15",
    veuScenario: "15A",
  }, { now: new Date("2026-08-08T01:00:00.000Z") });
  assert.equal(scenario15A.matchCount, 1);
  assert.deepEqual(
    scenario15A.products.map(({ registrationNumber }) => registrationNumber),
    ["VEU-15A"],
  );

  for (const [scenario, registrationNumber] of [
    ["48A(i)", "VEU-48A"],
    ["48B(i)", "VEU-48B"],
  ]) {
    const result = await searchOfficialProducts(d1, {
      productKind: "veu_ceiling_insulation",
      installationDate: "2026-08-08",
      veuActivityCode: "48",
      veuScenario: scenario,
    }, { now: new Date("2026-08-08T01:00:00.000Z") });
    assert.equal(result.matchCount, 1);
    assert.deepEqual(
      result.products.map((product) => product.registrationNumber),
      [registrationNumber],
    );
  }

  for (const veuScenario of ["48C", "27A"]) {
    await assert.rejects(
      searchOfficialProducts(d1, {
        productKind: "veu_ceiling_insulation",
        installationDate: "2026-08-08",
        veuActivityCode: "48",
        veuScenario,
      }, { now: new Date("2026-08-08T01:00:00.000Z") }),
      expectedError("OFFICIAL_PRODUCT_REQUEST_INVALID"),
    );
  }

  for (const invalidContract of [
    {},
    { veuActivityCode: "not-governed" },
    { veuActivityCode: "27" },
    { veuScenario: "27A" },
    { veuActivityCode: "6" },
  ]) {
    await assert.rejects(
      searchOfficialProducts(d1, {
        productKind: "veu_water_heater",
        installationDate: "2026-08-08",
        ...invalidContract,
      }, { now: new Date("2026-08-08T01:00:00.000Z") }),
      expectedError("OFFICIAL_PRODUCT_REQUEST_INVALID"),
    );
  }
});

test("VEU activity 31 leaves its governed GEMS motor search category-neutral", async () => {
  const { d1, artifactStore } = fixture();
  const motorRecord = {
    sourceKey: "fixture-gems-motor",
    sourceRecordKey: "GEMS-MOTOR-1",
    productKind: "electric_motor",
    manufacturer: "Motor Maker",
    brand: "Motor Brand",
    model: "MOTOR-1",
    series: "",
    registrationNumber: "GEMS-MOTOR-1",
    certificateNumber: "",
    approvalStatus: "approved",
    eligibleFrom: "2026-01-01",
    eligibleTo: "",
    availableInAustralia: true,
    attributes: {},
  };
  const motorSource = {
    ...source("fixture-gems-motor", "electric_motor", "gems-products"),
    minimumRecords: 1,
  };
  await syncOfficialProductRegistry(d1, {
    registryCode: "gems-products",
    title: "Fixture GEMS motor",
    sources: [motorSource],
  }, {
    fetchImpl: fetchFixture({ "fixture-gems-motor": [motorRecord] }),
    artifactStore,
    now: new Date("2026-08-08T00:00:00.000Z"),
  });

  const result = await searchOfficialProducts(d1, {
    productKind: "electric_motor",
    installationDate: "2026-08-08",
    veuActivityCode: "31",
  }, { now: new Date("2026-08-08T01:00:00.000Z") });
  assert.equal(result.matchCount, 1);
  assert.equal(result.products[0].registrationNumber, "GEMS-MOTOR-1");
});

test("official product facet filters require the exact upstream selection", async () => {
  const { d1, artifactStore } = fixture();
  await syncOfficialProductRegistry(d1, definition, {
    fetchImpl: fetchFixture(),
    artifactStore,
    now: new Date("2026-08-08T00:00:00.000Z"),
  });
  await assert.rejects(
    searchOfficialProducts(d1, {
      productKind: "pv_module",
      installationDate: "2026-08-08",
      model: "Panel 400",
    }, { now: new Date("2026-08-08T01:00:00.000Z") }),
    expectedError("OFFICIAL_PRODUCT_REQUEST_INVALID"),
  );
  await assert.rejects(
    searchOfficialProducts(d1, {
      productKind: "pv_module",
      installationDate: "2026-08-08",
      brand: "Bright Panel",
      productType: "P Series",
    }, { now: new Date("2026-08-08T01:00:00.000Z") }),
    expectedError("OFFICIAL_PRODUCT_REQUEST_INVALID"),
  );
});

test("source receipts and staged R2 replays materialize only one source at a time", async () => {
  const { d1 } = fixture();
  const events = [];
  const parseCounts = new Map();
  const sequentialDefinition = {
    ...definition,
    sources: definition.sources.map((item) => ({
      ...item,
      parse(bytes, contentType) {
        events.push(`parse:${item.sourceKey}`);
        parseCounts.set(item.sourceKey, (parseCounts.get(item.sourceKey) || 0) + 1);
        return item.parse(bytes, contentType);
      },
    })),
  };
  const fixtureFetch = fetchFixture();
  let activeFetches = 0;
  let maximumActiveFetches = 0;
  const fetchImpl = async (input, init) => {
    const sourceKey = String(input).split("/").at(-1);
    activeFetches += 1;
    maximumActiveFetches = Math.max(maximumActiveFetches, activeFetches);
    events.push(`fetch-start:${sourceKey}`);
    await new Promise((resolve) => setImmediate(resolve));
    const response = await fixtureFetch(input, init);
    events.push(`fetch-end:${sourceKey}`);
    activeFetches -= 1;
    return response;
  };
  const retained = memoryArtifactStore();
  let activeReads = 0;
  let maximumActiveReads = 0;
  const sourceKeyForObject = (key) => sequentialDefinition.sources.find(
    (item) => key.includes(`/${item.sourceKey}/`),
  ).sourceKey;
  const artifactStore = {
    ...retained,
    async put(key, value, options) {
      events.push(`put:${sourceKeyForObject(key)}`);
      return retained.put(key, value, options);
    },
    async get(key) {
      const body = await retained.get(key);
      if (!body) return null;
      const sourceKey = sourceKeyForObject(key);
      return {
        async arrayBuffer() {
          activeReads += 1;
          maximumActiveReads = Math.max(maximumActiveReads, activeReads);
          events.push(`read-start:${sourceKey}`);
          await new Promise((resolve) => setImmediate(resolve));
          const value = await body.arrayBuffer();
          events.push(`read-end:${sourceKey}`);
          activeReads -= 1;
          return value;
        },
      };
    },
  };

  const result = await syncOfficialProductRegistry(d1, sequentialDefinition, {
    fetchImpl,
    artifactStore,
    now: new Date("2026-08-08T00:00:00.000Z"),
  });

  assert.equal(result.changed, true);
  assert.equal(maximumActiveFetches, 1);
  assert.equal(maximumActiveReads, 1);
  assert.deepEqual(
    events.filter((event) => event.startsWith("fetch-start:")),
    ["fetch-start:fixture-pv", "fetch-start:fixture-inverter"],
  );
  assert.ok(
    events.indexOf("read-end:fixture-pv")
      < events.indexOf("fetch-start:fixture-inverter"),
    "the next source must wait for the previous source's exact custody readback",
  );
  assert.deepEqual(
    events.filter((event) => event.startsWith("parse:")),
    [
      "parse:fixture-pv",
      "parse:fixture-inverter",
      "parse:fixture-pv",
      "parse:fixture-inverter",
    ],
    "each source is inspected once, then replayed from R2 for staging",
  );
  assert.deepEqual(Object.fromEntries(parseCounts), {
    "fixture-pv": 2,
    "fixture-inverter": 2,
  });
  const unchanged = await syncOfficialProductRegistry(d1, sequentialDefinition, {
    fetchImpl,
    artifactStore,
    now: new Date("2026-08-08T01:00:00.000Z"),
  });
  assert.equal(unchanged.changed, false);
  assert.equal(maximumActiveFetches, 1);
  assert.equal(maximumActiveReads, 1);
  assert.deepEqual(Object.fromEntries(parseCounts), {
    "fixture-pv": 3,
    "fixture-inverter": 3,
  }, "an unchanged receipt is not parsed for a second staging pass");
});

test("streaming registry staging never materializes the complete product graph", async (t) => {
  const recordCount = 1_201;
  const sourceKey = "fixture-veu-streaming";
  const { database, d1, artifactStore } = fixture();
  t.after(() => database.close());
  let directParseCalls = 0;
  let maximumSupplementalBatch = 0;
  let maximumLookup = 0;
  let maximumRecordBatch = 0;
  const streamSource = {
    registryCode: "veu-approved-products",
    sourceKey,
    productKinds: ["veu_shower_rose"],
    url: `https://example.test/${sourceKey}`,
    minimumRecords: recordCount,
    maximumBytes: 1_000,
    expectedContentTypes: ["application/json"],
    accept: "application/json",
    licence: "fixture official licence",
    productionMode: "automatic",
    requiresOfficialEligibleFrom: true,
    parse() {
      directParseCalls += 1;
      throw new Error("the aggregate parser must not run");
    },
    streamingParser: {
      inspect() {
        return recordCount;
      },
      *supplementalBatches() {
        for (let offset = 0; offset < recordCount; offset += 500) {
          const length = Math.min(500, recordCount - offset);
          const batch = Array.from({ length }, (_, index) => ({
            sourceRecordKey: `VEU-${String(offset + index).padStart(5, "0")}`,
            value: { watts: 400 + ((offset + index) % 2) },
          }));
          maximumSupplementalBatch = Math.max(
            maximumSupplementalBatch,
            batch.length,
          );
          yield batch;
        }
      },
      async *recordBatches(_bytes, _contentType, loadValues) {
        for (let offset = 0; offset < recordCount; offset += 500) {
          const length = Math.min(500, recordCount - offset);
          const ids = Array.from({ length }, (_, index) => (
            `VEU-${String(offset + index).padStart(5, "0")}`
          ));
          maximumLookup = Math.max(maximumLookup, ids.length);
          const values = await loadValues(ids);
          assert.equal(values.size, ids.length);
          const records = ids.map((id) => ({
            sourceKey,
            sourceRecordKey: id,
            productKind: "veu_shower_rose",
            manufacturer: "",
            brand: "Scale",
            model: `Scale ${id}`,
            series: "",
            registrationNumber: id,
            certificateNumber: "",
            approvalStatus: "approved",
            eligibleFrom: "2026-01-01",
            eligibleTo: "",
            availableInAustralia: true,
            attributes: {
              veuProductCategoryNumber: "17A",
              watts: values.get(id).watts,
            },
          }));
          maximumRecordBatch = Math.max(maximumRecordBatch, records.length);
          yield records;
        }
      },
    },
  };
  const result = await syncOfficialProductRegistry(d1, {
    registryCode: "veu-approved-products",
    title: "Streaming VEU fixture",
    sources: [streamSource],
    async fetchSources() {
      return [{
        sourceKey,
        contentType: "application/json",
        bytes: new TextEncoder().encode('{"stream":"fixture"}'),
      }];
    },
  }, {
    fetchImpl: async () => { throw new Error("direct fetch must not run"); },
    artifactStore,
    now: new Date("2026-08-09T00:00:00.000Z"),
  });
  assert.equal(result.recordCount, recordCount);
  assert.equal(directParseCalls, 0);
  assert.equal(maximumSupplementalBatch, 500);
  assert.equal(maximumLookup, 500);
  assert.equal(maximumRecordBatch, 500);
  assert.equal(database.prepare(`SELECT count(*) count
    FROM compliance_official_product_stream_values`).get().count, 0);
  assert.equal(database.prepare(`SELECT count(*) count
    FROM compliance_official_products WHERE snapshot_id = ?`)
    .get(result.snapshotId).count, recordCount);
});

test("product staging keeps every D1 JSON binding below the governed byte budget", async () => {
  const encoder = new TextEncoder();
  const insertPayloads = [];
  const insertBatches = [];
  let historicalLookupCount = 0;
  const { d1, artifactStore } = fixture({
    onBind(sql, values) {
      if (
        sql.includes("WITH requested AS")
        && sql.includes("JOIN compliance_official_products product")
      ) {
        historicalLookupCount += 1;
      }
      if (
        sql.includes("INSERT INTO compliance_official_products")
        && sql.includes("FROM json_each(?)")
      ) {
        const payload = String(values[0]);
        const byteLength = encoder.encode(payload).byteLength;
        const parsedRows = JSON.parse(payload);
        assert.ok(byteLength <= 2_000_000, "the D1 binding limit was exceeded");
        insertPayloads.push({
          byteLength,
          rowCount: parsedRows.length,
          hasRawAttributes: parsedRows.some((row) => "attributes" in row),
        });
      }
    },
    onBatch(statements) {
      const inserts = statements.filter((statement) => (
        statement.sql.includes("INSERT INTO compliance_official_products")
        && statement.sql.includes("FROM json_each(?)")
      ));
      if (inserts.length > 0) {
        insertBatches.push({
          statementCount: inserts.length,
          bindBytes: inserts.reduce(
            (total, statement) => total
              + encoder.encode(String(statement.values[0])).byteLength,
            0,
          ),
          rowCount: inserts.reduce(
            (total, statement) => total
              + JSON.parse(String(statement.values[0])).length,
            0,
          ),
        });
      }
    },
  });
  const largeRecords = Array.from({ length: 1_001 }, (_, index) => ({
    sourceKey: "fixture-gems-large",
    sourceRecordKey: `GEMS-LARGE-${String(index).padStart(4, "0")}`,
    productKind: "air_conditioner",
    manufacturer: "",
    brand: "Efficient Air",
    model: `AC-${String(index).padStart(4, "0")}`,
    series: "Large governed staging fixture",
    registrationNumber: `GEMS-LARGE-${index}`,
    certificateNumber: "",
    approvalStatus: "approved",
    eligibleFrom: "2026-01-01",
    eligibleTo: "2030-12-31",
    availableInAustralia: true,
    attributes: { governedTechnicalPayload: "x".repeat(8_000) },
  }));
  const largeSource = {
    ...source(
      "fixture-gems-large",
      "air_conditioner",
      "gems-products",
    ),
    minimumRecords: 1,
    maximumBytes: 12_000_000,
  };
  const largeDefinition = {
    registryCode: "gems-products",
    title: "Large fixture official GEMS products",
    sources: [largeSource],
  };

  const result = await syncOfficialProductRegistry(d1, largeDefinition, {
    fetchImpl: fetchFixture({ "fixture-gems-large": largeRecords }),
    artifactStore,
    now: new Date("2026-08-08T00:00:00.000Z"),
  });

  assert.equal(result.changed, true);
  assert.equal(result.recordCount, largeRecords.length);
  assert.equal(historicalLookupCount, 0);
  assert.ok(insertPayloads.length > 4);
  assert.ok(insertBatches.length >= 2);
  assert.ok(Math.max(...insertPayloads.map(({ byteLength }) => byteLength)) <= 1_500_000);
  assert.ok(Math.max(...insertPayloads.map(({ rowCount }) => rowCount)) <= 500);
  assert.ok(Math.max(...insertBatches.map(({ statementCount }) => statementCount)) <= 4);
  assert.ok(Math.max(...insertBatches.map(({ bindBytes }) => bindBytes)) <= 6_000_000);
  assert.ok(insertBatches.some(({ statementCount }) => statementCount > 1));
  assert.equal(
    insertBatches.reduce((total, { statementCount }) => total + statementCount, 0),
    insertPayloads.length,
  );
  assert.equal(
    insertBatches.reduce((total, { rowCount }) => total + rowCount, 0),
    largeRecords.length,
  );
  assert.equal(insertPayloads.some(({ hasRawAttributes }) => hasRawAttributes), false);
  assert.equal(
    insertPayloads.reduce((total, { rowCount }) => total + rowCount, 0),
    largeRecords.length,
  );
});

test("75,492-row VEU refresh carries current versions inside bounded D1 inserts", async (t) => {
  const recordCount = 75_492;
  const sourceKey = "fixture-veu-scale";
  const currentSnapshotId = "seed-veu-current";
  const encoder = new TextEncoder();
  let standaloneCurrentVersionLookups = 0;
  let insertedRows = 0;
  const insertBatches = [];
  const { database, d1, artifactStore } = fixture({
    onBind(sql, values) {
      if (
        sql.includes("WITH requested AS")
        && sql.includes("product.registry_effective_from")
      ) {
        standaloneCurrentVersionLookups += 1;
      }
      if (
        sql.includes("INSERT INTO compliance_official_products")
        && sql.includes("FROM json_each(?)")
      ) {
        const payload = String(values[0]);
        assert.ok(
          encoder.encode(payload).byteLength <= 1_500_000,
          "the D1 insert binding budget was exceeded",
        );
        insertedRows += JSON.parse(payload).length;
      }
    },
    onBatch(statements) {
      const inserts = statements.filter((statement) => (
        statement.sql.includes("INSERT INTO compliance_official_products")
        && statement.sql.includes("FROM json_each(?)")
      ));
      if (inserts.length > 0) {
        insertBatches.push(inserts);
      }
    },
  });
  t.after(() => database.close());

  database.prepare(`INSERT INTO compliance_official_product_snapshots (
    id, registry_code, contract, source_manifest_json, source_sha256,
    source_count, record_count, status, created_at, activated_at, activated_on,
    superseded_at, superseded_on
  ) VALUES (?, 'veu-approved-products', 'creditex-official-products/v1',
    '{}', ?, 1, ?, 'staging', ?, NULL, NULL, NULL, NULL)`)
    .run(
      currentSnapshotId,
      "0".repeat(64),
      recordCount,
      "2026-08-01T00:00:00.000Z",
    );
  database.prepare(`WITH RECURSIVE sequence(value) AS (
      SELECT 0
      UNION ALL
      SELECT value + 1 FROM sequence WHERE value + 1 < ?
    )
    INSERT INTO compliance_official_products (
      id, snapshot_id, source_key, source_record_key, product_kind,
      manufacturer, brand, model, series, registration_number,
      certificate_number, approval_status, eligible_from, eligible_to,
      available_in_australia, registry_effective_from, search_text,
      attributes_json
    ) SELECT
      ? || ':' || ? || ':VEU-' || printf('%05d', value),
      ?, ?, 'VEU-' || printf('%05d', value),
      'veu_shower_rose', '', 'Scale',
      'Scale model ' || printf('%05d', value), '',
      'VEU-' || printf('%05d', value), '', 'approved',
      '2025-01-01', '', 1, '2025-01-01',
      'scale scale model ' || printf('%05d', value)
        || ' veu-' || printf('%05d', value),
      '{"veuProductCategoryNumber":"17A","watts":400}'
    FROM sequence`)
    .run(
      recordCount,
      currentSnapshotId,
      sourceKey,
      currentSnapshotId,
      sourceKey,
    );
  database.prepare(`INSERT INTO compliance_official_product_artifacts (
    id, snapshot_id, source_key, source_url, source_sha256, content_type,
    byte_length, record_count, object_key, created_at
  ) VALUES (?, ?, ?, ?, ?, 'application/json', 1, ?, ?, ?)`)
    .run(
      `${currentSnapshotId}:${sourceKey}`,
      currentSnapshotId,
      sourceKey,
      `https://example.test/${sourceKey}`,
      "1".repeat(64),
      recordCount,
      `creditex/official-products/${"a".repeat(64)}`,
      "2026-08-01T00:00:00.000Z",
    );
  database.prepare(`UPDATE compliance_official_product_snapshots
    SET status = 'current', activated_at = ?, activated_on = ?
    WHERE id = ?`)
    .run("2026-08-01T00:00:00.000Z", "2026-08-01", currentSnapshotId);

  let sourceBytes = encoder.encode(JSON.stringify(Array.from(
    { length: recordCount },
    (_, index) => {
      const suffix = String(index).padStart(5, "0");
      return {
        sourceKey,
        sourceRecordKey: `VEU-${suffix}`,
        productKind: "veu_shower_rose",
        manufacturer: "",
        brand: "Scale",
        model: `Scale model ${suffix}`,
        series: "",
        registrationNumber: `VEU-${suffix}`,
        certificateNumber: "",
        approvalStatus: "approved",
        eligibleFrom: "2025-01-01",
        eligibleTo: "",
        availableInAustralia: true,
        attributes: {
          veuProductCategoryNumber: "17A",
          watts: index === recordCount - 1 ? 401 : 400,
        },
      };
    },
  )));
  const veuScaleSource = {
    registryCode: "veu-approved-products",
    sourceKey,
    productKinds: ["veu_shower_rose"],
    url: `https://example.test/${sourceKey}`,
    minimumRecords: recordCount,
    maximumBytes: 100_000_000,
    expectedContentTypes: ["application/json"],
    accept: "application/json",
    licence: "fixture official licence",
    productionMode: "automatic",
    requiresOfficialEligibleFrom: true,
    parse(bytes) {
      return JSON.parse(new TextDecoder().decode(bytes));
    },
  };
  const result = await syncOfficialProductRegistry(d1, {
    registryCode: "veu-approved-products",
    title: "75,492-row VEU scale fixture",
    sources: [veuScaleSource],
    async fetchSources() {
      return [{
        sourceKey,
        contentType: "application/json",
        bytes: sourceBytes,
      }];
    },
  }, {
    fetchImpl: async () => { throw new Error("direct fetch must not run"); },
    artifactStore,
    now: new Date("2026-08-09T00:00:00.000Z"),
  });
  sourceBytes = new Uint8Array();

  assert.equal(result.changed, true);
  assert.equal(result.recordCount, recordCount);
  assert.equal(standaloneCurrentVersionLookups, 0);
  assert.equal(insertedRows, recordCount);
  assert.equal(insertBatches.length, Math.ceil(recordCount / (500 * 4)));
  assert.ok(insertBatches.every((batch) => batch.length <= 4));
  assert.ok(insertBatches.every((batch) => (
    batch.reduce((total, statement) => total
      + encoder.encode(String(statement.values[0])).byteLength, 0)
      <= 6_000_000
  )));
  const effectiveStarts = database.prepare(`SELECT registry_effective_from, count(*) count
    FROM compliance_official_products
    WHERE snapshot_id = ?
    GROUP BY registry_effective_from
    ORDER BY registry_effective_from`).all(result.snapshotId);
  assert.deepEqual(effectiveStarts.map((row) => ({ ...row })), [
    { registry_effective_from: "2025-01-01", count: recordCount - 1 },
    { registry_effective_from: "2026-08-09", count: 1 },
  ]);
  assert.equal(database.prepare(`SELECT count(*) count
    FROM compliance_official_products
    WHERE snapshot_id = ?`).get(currentSnapshotId).count, 1);
  assert.equal(database.prepare(`SELECT count(*) count
    FROM compliance_official_products`).get().count, recordCount + 1);
});

test("GEMS exposes only approved status while retaining approved historical versions", async () => {
  const { d1, artifactStore } = fixture();
  const initiallyApproved = rows["fixture-gems-ac"].map((row) => (
    row.model === "AC-002" ? { ...row, approvalStatus: "approved" } : row
  ));
  const first = await syncOfficialProductRegistry(d1, gemsDefinition, {
    fetchImpl: fetchFixture({ "fixture-gems-ac": initiallyApproved }),
    artifactStore,
    now: new Date("2026-08-08T00:00:00.000Z"),
  });
  const initial = await searchOfficialProducts(d1, {
    productKind: "air_conditioner",
    installationDate: "2026-08-08",
  }, { now: new Date("2026-08-08T01:00:00.000Z") });
  assert.deepEqual(
    initial.products.map(({ model }) => model),
    ["AC-001", "AC-002"],
  );

  await syncOfficialProductRegistry(d1, gemsDefinition, {
    fetchImpl: fetchFixture(),
    artifactStore,
    now: new Date("2026-08-10T00:00:00.000Z"),
  });
  const historical = await searchOfficialProducts(d1, {
    productKind: "air_conditioner",
    installationDate: "2026-08-09",
    query: "ac-002",
  }, { now: new Date("2026-08-10T01:00:00.000Z") });
  assert.equal(historical.products.length, 1);
  assert.equal(historical.products[0].approvalStatus, "approved");
  assert.equal(historical.products[0].snapshotId, first.snapshotId);
  const historicalSelection = await validateOfficialProductSelections(d1, {
    installationDate: "2026-08-09",
    requiredKinds: ["air_conditioner"],
    selectedProductIds: { air_conditioner: historical.products[0].id },
  }, { now: new Date("2026-08-10T01:00:00.000Z") });
  assert.equal(historicalSelection.selections.length, 1);

  for (const model of ["AC-002", "AC-003"]) {
    const current = await searchOfficialProducts(d1, {
      productKind: "air_conditioner",
      installationDate: "2026-08-10",
      query: model.toLowerCase(),
    }, { now: new Date("2026-08-10T01:00:00.000Z") });
    assert.equal(current.products.length, 0);
    const sourceRecordKey = model === "AC-002"
      ? "AC-002|Superseded"
      : "AC-003|Pending";
    await assert.rejects(
      validateOfficialProductSelections(d1, {
        installationDate: "2026-08-10",
        requiredKinds: ["air_conditioner"],
        selectedProductIds: {
          air_conditioner: stableProductId("fixture-gems-ac", sourceRecordKey),
        },
      }, { now: new Date("2026-08-10T01:00:00.000Z") }),
      expectedError("OFFICIAL_PRODUCT_NOT_ELIGIBLE"),
    );
  }
});

test("changed refreshes retain historical deltas and prune unchanged product copies", async () => {
  const { database, d1, artifactStore } = fixture();
  const first = await syncOfficialProductRegistry(d1, definition, {
    fetchImpl: fetchFixture(), artifactStore,
    now: new Date("2026-08-08T00:00:00.000Z"),
  });
  const unchanged = await syncOfficialProductRegistry(d1, definition, {
    fetchImpl: fetchFixture(), artifactStore,
    now: new Date("2026-08-09T00:00:00.000Z"),
  });
  assert.equal(unchanged.changed, false);
  assert.equal(unchanged.snapshotId, first.snapshotId);

  const changedRows = structuredClone(rows["fixture-pv"]);
  changedRows[0].model = "Panel 401";
  changedRows[0].sourceRecordKey = "PV-001|Maker|Panel 401";
  const changed = await syncOfficialProductRegistry(d1, definition, {
    fetchImpl: fetchFixture({ "fixture-pv": changedRows }), artifactStore,
    now: new Date("2026-08-10T00:00:00.000Z"),
  });
  assert.equal(changed.changed, true);
  assert.notEqual(changed.snapshotId, first.snapshotId);
  assert.equal(database.prepare(`SELECT count(*) count
    FROM compliance_official_product_snapshots`).get().count, 2);
  assert.equal(database.prepare(`SELECT count(*) count
    FROM compliance_official_products`).get().count, 5);
  assert.equal(database.prepare(`SELECT count(*) count
    FROM compliance_official_product_artifacts`).get().count, 4);
  assert.equal(artifactStore.objects.size, 3);
  assert.equal(database.prepare(`SELECT count(*) count
    FROM compliance_official_products WHERE snapshot_id = ?`)
    .get(first.snapshotId).count, 1);

  const historical = await searchOfficialProducts(d1, {
    productKind: "pv_module",
    installationDate: "2026-08-09",
    query: "panel 400",
  }, { now: new Date("2026-08-10T01:00:00.000Z") });
  assert.equal(historical.products.length, 1);
  assert.equal(historical.products[0].snapshotId, first.snapshotId);
  const historicalSelection = await validateOfficialProductSelections(d1, {
    installationDate: "2026-08-09",
    requiredKinds: ["pv_module"],
    selectedProductIds: { pv_module: historical.products[0].id },
  }, { now: new Date("2026-08-10T01:00:00.000Z") });
  assert.deepEqual(historicalSelection.registryReceipt.snapshots, [{
    registryCode: "cer-cec-products",
    snapshotId: first.snapshotId,
    sourceSha256: first.sourceSha256,
  }]);

  const afterSupersession = await searchOfficialProducts(d1, {
    productKind: "pv_module",
    installationDate: "2026-08-10",
    query: "panel 400",
  }, { now: new Date("2026-08-10T01:00:00.000Z") });
  assert.equal(afterSupersession.products.length, 0);
  await assert.rejects(
    validateOfficialProductSelections(d1, {
      installationDate: "2026-08-10",
      requiredKinds: ["pv_module"],
      selectedProductIds: { pv_module: historical.products[0].id },
    }, { now: new Date("2026-08-10T01:00:00.000Z") }),
    expectedError("OFFICIAL_PRODUCT_NOT_ELIGIBLE"),
  );
  assert.throws(
    () => database.prepare(`DELETE FROM compliance_official_products
      WHERE snapshot_id = ?`).run(changed.snapshotId),
    /Current official product rows are immutable/,
  );
});

test("A to B to identical C carries B's interval into the current product version", async () => {
  const { database, d1, artifactStore } = fixture();
  const first = await syncOfficialProductRegistry(d1, definition, {
    fetchImpl: fetchFixture(), artifactStore,
    now: new Date("2026-08-08T00:00:00.000Z"),
  });
  const versionBRows = structuredClone(rows["fixture-pv"]);
  versionBRows[0].attributes.watts = 410;
  const second = await syncOfficialProductRegistry(d1, definition, {
    fetchImpl: fetchFixture({ "fixture-pv": versionBRows }), artifactStore,
    now: new Date("2026-08-09T00:00:00.000Z"),
  });
  const versionCRows = structuredClone(versionBRows);
  versionCRows[0].sourceNoise = "official artifact revision C";
  const third = await syncOfficialProductRegistry(d1, definition, {
    fetchImpl: fetchFixture({ "fixture-pv": versionCRows }), artifactStore,
    now: new Date("2026-08-10T00:00:00.000Z"),
  });
  assert.notEqual(first.snapshotId, second.snapshotId);
  assert.notEqual(second.snapshotId, third.snapshotId);
  assert.equal(database.prepare(`SELECT count(*) count
    FROM compliance_official_product_snapshots`).get().count, 3);

  const retainedVersions = database.prepare(`SELECT
      snapshot_id, registry_effective_from, attributes_json
    FROM compliance_official_products
    WHERE source_key = 'fixture-pv'
      AND source_record_key = 'PV-001|Maker|Panel 400'
    ORDER BY registry_effective_from, snapshot_id`).all();
  assert.deepEqual(retainedVersions.map((version) => ({
    snapshotId: version.snapshot_id,
    effectiveFrom: version.registry_effective_from,
    watts: JSON.parse(version.attributes_json).watts,
  })), [
    { snapshotId: first.snapshotId, effectiveFrom: "2025-01-01", watts: 400 },
    { snapshotId: third.snapshotId, effectiveFrom: "2026-08-09", watts: 410 },
  ]);

  const duringA = await searchOfficialProducts(d1, {
    productKind: "pv_module",
    installationDate: "2026-08-08",
    query: "panel 400",
  }, { now: new Date("2026-08-10T01:00:00.000Z") });
  assert.equal(duringA.products[0].snapshotId, first.snapshotId);
  assert.equal(duringA.products[0].attributes.watts, 400);

  const duringB = await searchOfficialProducts(d1, {
    productKind: "pv_module",
    installationDate: "2026-08-09",
    query: "panel 400",
  }, { now: new Date("2026-08-10T01:00:00.000Z") });
  assert.equal(duringB.products.length, 1);
  assert.equal(duringB.products[0].snapshotId, third.snapshotId);
  assert.equal(duringB.products[0].attributes.watts, 410);
  const validated = await validateOfficialProductSelections(d1, {
    installationDate: "2026-08-09",
    requiredKinds: ["pv_module"],
    selectedProductIds: { pv_module: duringB.products[0].id },
  }, { now: new Date("2026-08-10T01:00:00.000Z") });
  assert.deepEqual(validated.registryReceipt.snapshots, [{
    registryCode: "cer-cec-products",
    snapshotId: third.snapshotId,
    sourceSha256: third.sourceSha256,
  }]);
});

test("an identical reappearing product does not backfill its absent interval", async () => {
  const { database, d1, artifactStore } = fixture();
  const first = await syncOfficialProductRegistry(d1, definition, {
    fetchImpl: fetchFixture(), artifactStore,
    now: new Date("2026-08-08T00:00:00.000Z"),
  });
  const substitute = {
    ...structuredClone(rows["fixture-pv"][0]),
    sourceRecordKey: "PV-003|Maker|Panel 600",
    model: "Panel 600",
    certificateNumber: "PV-003",
    attributes: { watts: 600, bifacial: false },
  };
  await syncOfficialProductRegistry(d1, definition, {
    fetchImpl: fetchFixture({
      "fixture-pv": [structuredClone(rows["fixture-pv"][1]), substitute],
    }),
    artifactStore,
    now: new Date("2026-08-09T00:00:00.000Z"),
  });
  const third = await syncOfficialProductRegistry(d1, definition, {
    fetchImpl: fetchFixture({
      "fixture-pv": [structuredClone(rows["fixture-pv"][0]), substitute],
    }),
    artifactStore,
    now: new Date("2026-08-10T00:00:00.000Z"),
  });
  const currentVersion = database.prepare(`SELECT registry_effective_from
    FROM compliance_official_products
    WHERE snapshot_id = ? AND source_key = 'fixture-pv'
      AND source_record_key = 'PV-001|Maker|Panel 400'`)
    .get(third.snapshotId);
  assert.equal(currentVersion.registry_effective_from, "2026-08-10");

  const beforeGap = await searchOfficialProducts(d1, {
    productKind: "pv_module",
    installationDate: "2026-08-08",
    query: "panel 400",
  }, { now: new Date("2026-08-10T01:00:00.000Z") });
  assert.equal(beforeGap.products[0].snapshotId, first.snapshotId);
  const duringGap = await searchOfficialProducts(d1, {
    productKind: "pv_module",
    installationDate: "2026-08-09",
    query: "panel 400",
  }, { now: new Date("2026-08-10T01:00:00.000Z") });
  assert.equal(duringGap.products.length, 0);
  const afterReappearance = await searchOfficialProducts(d1, {
    productKind: "pv_module",
    installationDate: "2026-08-10",
    query: "panel 400",
  }, { now: new Date("2026-08-10T01:00:00.000Z") });
  assert.equal(afterReappearance.products[0].snapshotId, third.snapshotId);
});

test("UTC activation timestamps keep Australian regulator-date boundaries", async () => {
  const { database, d1, artifactStore } = fixture();
  const first = await syncOfficialProductRegistry(d1, definition, {
    fetchImpl: fetchFixture(), artifactStore,
    now: new Date("2026-08-08T20:45:00.000Z"),
  });
  const changedRows = structuredClone(rows["fixture-pv"]);
  changedRows[0].attributes.watts = 415;
  const second = await syncOfficialProductRegistry(d1, definition, {
    fetchImpl: fetchFixture({ "fixture-pv": changedRows }), artifactStore,
    now: new Date("2026-08-09T21:05:00.000Z"),
  });
  const firstBoundary = database.prepare(`SELECT
      activated_at, activated_on, superseded_at, superseded_on
    FROM compliance_official_product_snapshots WHERE id = ?`)
    .get(first.snapshotId);
  assert.deepEqual({ ...firstBoundary }, {
    activated_at: "2026-08-08T20:45:00.000Z",
    activated_on: "2026-08-09",
    superseded_at: "2026-08-09T21:05:00.000Z",
    superseded_on: "2026-08-10",
  });
  const secondBoundary = database.prepare(`SELECT
      activated_at, activated_on, superseded_at, superseded_on
    FROM compliance_official_product_snapshots WHERE id = ?`)
    .get(second.snapshotId);
  assert.deepEqual({ ...secondBoundary }, {
    activated_at: "2026-08-09T21:05:00.000Z",
    activated_on: "2026-08-10",
    superseded_at: null,
    superseded_on: null,
  });

  const australianNinth = await searchOfficialProducts(d1, {
    productKind: "pv_module",
    installationDate: "2026-08-09",
    query: "panel 400",
  }, { now: new Date("2026-08-09T22:00:00.000Z") });
  assert.equal(australianNinth.products[0].snapshotId, first.snapshotId);
  assert.equal(australianNinth.products[0].attributes.watts, 400);
  const australianTenth = await searchOfficialProducts(d1, {
    productKind: "pv_module",
    installationDate: "2026-08-10",
    query: "panel 400",
  }, { now: new Date("2026-08-09T22:00:00.000Z") });
  assert.equal(australianTenth.products[0].snapshotId, second.snapshotId);
  assert.equal(australianTenth.products[0].attributes.watts, 415);
});

test("failed refreshes stay auditable while the last exact snapshot expires on its original TTL", async () => {
  const { d1, artifactStore } = fixture();
  await syncOfficialProductRegistry(d1, definition, {
    fetchImpl: fetchFixture(), artifactStore,
    now: new Date("2026-08-08T00:00:00.000Z"),
  });
  await assert.rejects(
    syncOfficialProductRegistry(d1, definition, {
      fetchImpl: fetchFixture({
        "fixture-pv": [...rows["fixture-pv"], {
          ...rows["fixture-pv"][0],
          sourceRecordKey: "PV-003|Maker|Panel 600",
          model: "Panel 600",
        }],
        "fixture-inverter": [rows["fixture-inverter"][0]],
      }),
      artifactStore,
      now: new Date("2026-08-09T00:00:00.000Z"),
    }),
    expectedError("OFFICIAL_PRODUCT_SOURCE_INVALID"),
  );
  const status = await loadOfficialProductRegistryStatus(d1, "cer-cec-products", {
    now: new Date("2026-08-09T00:00:01.000Z"),
  });
  assert.equal(status.status, "current");
  assert.equal(status.lastAttempt.status, "failed");
  const withinTtl = await searchOfficialProducts(d1, {
    productKind: "pv_module",
    installationDate: "2026-08-09",
    brand: "Bright Panel",
  }, { now: new Date("2026-08-09T00:00:01.000Z") });
  assert.equal(withinTtl.registry.status, "current");
  assert.equal(withinTtl.matchCount, 1);

  const expiredAt = new Date("2026-08-10T00:00:01.000Z");
  const expired = await loadOfficialProductRegistryStatus(
    d1,
    "cer-cec-products",
    { now: expiredAt },
  );
  assert.equal(expired.status, "stale");
  assert.equal(expired.lastAttempt.status, "failed");
  await assert.rejects(
    searchOfficialProducts(d1, {
      productKind: "pv_module",
      installationDate: "2026-08-10",
      brand: "Bright Panel",
    }, { now: expiredAt }),
    expectedError("OFFICIAL_PRODUCT_REGISTRY_STALE"),
  );
});

test("a future-dated registry check is never treated as current", async () => {
  const { d1, artifactStore } = fixture();
  const checkedAt = new Date("2026-08-08T00:00:00.000Z");
  await syncOfficialProductRegistry(d1, definition, {
    fetchImpl: fetchFixture(),
    artifactStore,
    now: checkedAt,
  });
  const beforeCheck = new Date(checkedAt.getTime() - 1);
  const status = await loadOfficialProductRegistryStatus(
    d1,
    definition.registryCode,
    { now: beforeCheck },
  );
  assert.equal(status.lastCheckedAt, checkedAt.toISOString());
  assert.equal(status.status, "stale");
  await assert.rejects(
    searchOfficialProducts(d1, {
      productKind: "pv_module",
      installationDate: "2026-08-08",
      brand: "Bright Panel",
    }, { now: beforeCheck }),
    expectedError("OFFICIAL_PRODUCT_REGISTRY_STALE"),
  );
});

test("automatic recovery refreshes an expired registry from the exact official source", async () => {
  const { d1, artifactStore } = fixture();
  await syncOfficialProductRegistry(d1, definition, {
    fetchImpl: fetchFixture(),
    artifactStore,
    now: new Date("2026-08-08T00:00:00.000Z"),
  });
  const expiredAt = new Date("2026-08-10T00:00:01.000Z");
  assert.equal(
    (await loadOfficialProductRegistryStatus(d1, definition.registryCode, {
      now: expiredAt,
    })).status,
    "stale",
  );

  const recovered = await ensureAutomaticOfficialProductRegistryCurrent(
    d1,
    definition,
    {
      fetchImpl: fetchFixture(),
      artifactStore,
      now: expiredAt,
    },
  );
  assert.equal(recovered.status, "current");
  assert.equal(recovered.lastCheckedAt, expiredAt.toISOString());
  assert.equal(recovered.lastAttempt.status, "unchanged");
  const search = await searchOfficialProducts(d1, {
    productKind: "pv_module",
    installationDate: "2026-08-10",
    brand: "Bright Panel",
  }, { now: expiredAt });
  assert.equal(search.registry.status, "current");
  assert.equal(search.matchCount, 1);
});

test("automatic recovery remains fail closed when the exact official source fails", async () => {
  const { d1, artifactStore } = fixture();
  await syncOfficialProductRegistry(d1, definition, {
    fetchImpl: fetchFixture(),
    artifactStore,
    now: new Date("2026-08-08T00:00:00.000Z"),
  });
  const expiredAt = new Date("2026-08-10T00:00:01.000Z");
  await assert.rejects(
    ensureAutomaticOfficialProductRegistryCurrent(d1, definition, {
      fetchImpl: async () => {
        throw new Error("fixture official source unavailable");
      },
      artifactStore,
      now: expiredAt,
    }),
    expectedError("OFFICIAL_PRODUCT_SOURCE_UNAVAILABLE"),
  );
  const status = await loadOfficialProductRegistryStatus(
    d1,
    definition.registryCode,
    { now: expiredAt },
  );
  assert.equal(status.status, "stale");
  assert.equal(status.lastAttempt.status, "failed");
  await assert.rejects(
    searchOfficialProducts(d1, {
      productKind: "pv_module",
      installationDate: "2026-08-10",
      brand: "Bright Panel",
    }, { now: expiredAt }),
    expectedError("OFFICIAL_PRODUCT_REGISTRY_STALE"),
  );
});

test("automatic recovery waits for one concurrent exact refresh and never serves stale rows", async () => {
  const { database, d1, artifactStore } = fixture();
  await syncOfficialProductRegistry(d1, definition, {
    fetchImpl: fetchFixture(),
    artifactStore,
    now: new Date("2026-08-08T00:00:00.000Z"),
  });
  const expiredAt = new Date("2026-08-10T00:00:01.000Z");
  database.prepare(`INSERT INTO compliance_official_product_sync_leases (
    registry_code, lease_id, started_at, expires_at
  ) VALUES (?, ?, ?, ?)`).run(
    definition.registryCode,
    "competing-refresh",
    expiredAt.toISOString(),
    new Date(expiredAt.getTime() + 60_000).toISOString(),
  );
  const competingRefresh = new Promise((resolve, reject) => {
    setTimeout(() => {
      database.prepare(`DELETE FROM compliance_official_product_sync_leases
        WHERE registry_code = ?`).run(definition.registryCode);
      syncOfficialProductRegistry(d1, definition, {
        fetchImpl: fetchFixture(),
        artifactStore,
        now: expiredAt,
      }).then(resolve, reject);
    }, 5);
  });
  const [recovered] = await Promise.all([
    ensureAutomaticOfficialProductRegistryCurrent(d1, definition, {
      fetchImpl: fetchFixture(),
      artifactStore,
      now: expiredAt,
      waitForRefreshMs: 500,
      pollIntervalMs: 10,
    }),
    competingRefresh,
  ]);
  assert.equal(recovered.status, "current");
  assert.equal(recovered.lastAttempt.status, "unchanged");

  database.prepare(`INSERT INTO compliance_official_product_sync_leases (
    registry_code, lease_id, started_at, expires_at
  ) VALUES (?, ?, ?, ?)`).run(
    definition.registryCode,
    "another-refresh",
    new Date(expiredAt.getTime() + 48 * 60 * 60 * 1000 + 1).toISOString(),
    new Date(expiredAt.getTime() + 48 * 60 * 60 * 1000 + 60_001).toISOString(),
  );
  const staleAgainAt = new Date(expiredAt.getTime() + 48 * 60 * 60 * 1000 + 1);
  await assert.rejects(
    ensureAutomaticOfficialProductRegistryCurrent(d1, definition, {
      fetchImpl: fetchFixture(),
      artifactStore,
      now: staleAgainAt,
      waitForRefreshMs: 0,
    }),
    expectedError("OFFICIAL_PRODUCT_REGISTRY_STALE"),
  );
});

test("count decreases require an exact verified and auditable review", async () => {
  const { database, d1, artifactStore } = fixture();
  const largerRows = {
    "fixture-pv": [...rows["fixture-pv"], {
      ...rows["fixture-pv"][0],
      sourceRecordKey: "PV-003|Maker|Panel 600",
      model: "Panel 600",
    }],
  };
  await syncOfficialProductRegistry(d1, definition, {
    fetchImpl: fetchFixture(largerRows), artifactStore,
    now: new Date("2026-08-08T00:00:00.000Z"),
  });
  await assert.rejects(
    syncOfficialProductRegistry(d1, definition, {
      fetchImpl: fetchFixture(), artifactStore,
      now: new Date("2026-08-09T00:00:00.000Z"),
    }),
    expectedError("OFFICIAL_PRODUCT_SOURCE_COUNT_REGRESSION"),
  );
  await assert.rejects(
    syncOfficialProductRegistry(d1, definition, {
      fetchImpl: fetchFixture(),
      artifactStore,
      now: new Date("2026-08-09T01:00:00.000Z"),
      reviewedCountDecrease: {
        reviewedByUid: "admin-reviewer-1",
        governanceIdentityVerified: true,
        reviewNote: "Reviewed the retained bytes and accepted the exact decrease.",
        sources: [{
          sourceKey: "fixture-pv",
          previousRecordCount: 3,
          acceptedRecordCount: 1,
        }],
      },
    }),
    expectedError("OFFICIAL_PRODUCT_SOURCE_COUNT_REGRESSION"),
  );
  await assert.rejects(
    syncOfficialProductRegistry(d1, definition, {
      fetchImpl: fetchFixture(),
      artifactStore,
      now: new Date("2026-08-09T02:00:00.000Z"),
      reviewedCountDecrease: {
        reviewedByUid: "admin-reviewer-1",
        governanceIdentityVerified: false,
        reviewNote: "Reviewed the retained bytes and accepted the exact decrease.",
        sources: [{
          sourceKey: "fixture-pv",
          previousRecordCount: 3,
          acceptedRecordCount: 2,
        }],
      },
    }),
    expectedError("OFFICIAL_PRODUCT_REQUEST_INVALID"),
  );
  const accepted = await syncOfficialProductRegistry(d1, definition, {
    fetchImpl: fetchFixture(),
    artifactStore,
    now: new Date("2026-08-09T03:00:00.000Z"),
    reviewedCountDecrease: {
      reviewedByUid: "admin-reviewer-1",
      governanceIdentityVerified: true,
      reviewNote: "Reviewed the retained bytes and accepted the exact decrease.",
      sources: [{
        sourceKey: "fixture-pv",
        previousRecordCount: 3,
        acceptedRecordCount: 2,
      }],
    },
  });
  assert.equal(accepted.changed, true);
  assert.equal(accepted.reviewedCountDecrease, true);
  const successfulRun = database.prepare(`SELECT message
    FROM compliance_official_product_sync_runs
    WHERE status = 'success' ORDER BY checked_at DESC LIMIT 1`).get();
  const reviewAudit = JSON.parse(successfulRun.message);
  assert.equal(
    reviewAudit.contract,
    "creditex-reviewed-product-count-decrease/v1",
  );
  assert.equal(reviewAudit.reviewedByUid, "admin-reviewer-1");
  assert.deepEqual(reviewAudit.sources, [{
    acceptedRecordCount: 2,
    previousRecordCount: 3,
    sourceKey: "fixture-pv",
  }]);
});

test("exact retained bytes are re-read and corrupted custody fails closed", async () => {
  const { d1, artifactStore } = fixture();
  await syncOfficialProductRegistry(d1, definition, {
    fetchImpl: fetchFixture(), artifactStore,
    now: new Date("2026-08-08T00:00:00.000Z"),
  });
  const [key, retained] = artifactStore.objects.entries().next().value;
  retained.bytes[0] ^= 1;
  artifactStore.objects.set(key, retained);
  await assert.rejects(
    syncOfficialProductRegistry(d1, definition, {
      fetchImpl: fetchFixture(), artifactStore,
      now: new Date("2026-08-08T01:00:00.000Z"),
    }),
    expectedError("OFFICIAL_PRODUCT_SOURCE_CUSTODY_FAILED"),
  );
});

test("reused R2 bytes reconcile exact source URL and licence metadata", async () => {
  const { d1, artifactStore } = fixture();
  await syncOfficialProductRegistry(d1, definition, {
    fetchImpl: fetchFixture(),
    artifactStore,
    now: new Date("2026-08-08T00:00:00.000Z"),
  });
  const [key, retained] = artifactStore.objects.entries().next().value;
  const expectedMetadata = { ...retained.customMetadata };
  artifactStore.objects.set(key, {
    ...retained,
    customMetadata: {
      ...retained.customMetadata,
      sourceUrl: "https://untrusted.invalid/reused-object",
      licence: "unreviewed licence",
    },
  });
  const result = await syncOfficialProductRegistry(d1, definition, {
    fetchImpl: fetchFixture(),
    artifactStore,
    now: new Date("2026-08-08T01:00:00.000Z"),
  });
  assert.equal(result.changed, false);
  assert.deepEqual(
    artifactStore.objects.get(key).customMetadata,
    expectedMetadata,
  );
});

test("licensed connectors cannot be silently promoted to automatic scraping", async () => {
  const { d1, artifactStore } = fixture();
  const licensed = {
    ...definition,
    sources: definition.sources.map((item) => ({
      ...item,
      productionMode: "licence_required",
    })),
  };
  await assert.rejects(
    syncOfficialProductRegistry(d1, licensed, {
      fetchImpl: fetchFixture(), artifactStore,
      now: new Date("2026-08-08T00:00:00.000Z"),
    }),
    expectedError("OFFICIAL_PRODUCT_SOURCE_INVALID"),
  );
});

test("CER-hosted CEC artifacts remain controlled manual until reuse permission is recorded", async () => {
  assert.deepEqual(
    CREDITEX_AUTOMATIC_PRODUCT_REGISTRIES.map(({ registryCode }) => registryCode),
    ["gems-products", "nsw-tessa-products", "veu-approved-products"],
  );
  assert.deepEqual(
    CREDITEX_CONTROLLED_MANUAL_PRODUCT_REGISTRIES.map(
      ({ registryCode }) => registryCode,
    ),
    ["cer-cec-products", "wa-synergy-supported-solutions"],
  );
  assert.ok(CREDITEX_CER_CEC_PRODUCT_REGISTRY.sources.every((item) => (
    item.productionMode === "controlled_manual"
    && item.licence.includes("permission_required")
    && item.licence.includes("PERMISSION-REQUIRED")
  )));
  const { d1, artifactStore } = fixture();
  await assert.rejects(
    syncOfficialProductRegistry(
      d1,
      CREDITEX_CER_CEC_PRODUCT_REGISTRY,
      {
        fetchImpl: async () => {
          throw new Error("controlled source must not be fetched");
        },
        artifactStore,
        now: new Date("2026-08-08T00:00:00.000Z"),
      },
    ),
    expectedError("OFFICIAL_PRODUCT_SOURCE_INVALID"),
  );
});

test("controlled imports verify the exact retained permission bytes and identity", async () => {
  const store = memoryArtifactStore();
  const objectKey = "creditex/official-sources/private-permission-evidence.json";
  const bytes = new TextEncoder().encode(JSON.stringify({
    organisationId: "creditex-org",
    permission: "approved source reuse",
  }));
  const sha256 = await crypto.subtle.digest("SHA-256", bytes).then((digest) => (
    [...new Uint8Array(digest)]
      .map((value) => value.toString(16).padStart(2, "0"))
      .join("")
  ));
  const permission = {
    organisationId: "creditex-org",
    artifactId: "permission-artifact-42",
    sha256,
    objectKey,
    sizeBytes: bytes.byteLength,
  };
  await store.put(objectKey, bytes, {
    httpMetadata: { contentType: "application/json" },
    customMetadata: {
      organisationId: permission.organisationId,
      artifactId: permission.artifactId,
      sha256,
      custodyState: "pending_review",
    },
  });
  await verifyCreditexControlledProductPermissionArtifact(store, permission);

  for (const mutation of [
    { sizeBytes: bytes.byteLength + 1 },
    { sha256: "0".repeat(64) },
    { organisationId: "another-org" },
    { artifactId: "another-artifact" },
  ]) {
    await assert.rejects(
      verifyCreditexControlledProductPermissionArtifact(store, {
        ...permission,
        ...mutation,
      }),
      (error) => (
        error.code === "OFFICIAL_PRODUCT_SOURCE_CUSTODY_FAILED"
        && !error.message.includes(objectKey)
      ),
    );
  }

  store.objects.get(objectKey).bytes[0] ^= 1;
  await assert.rejects(
    verifyCreditexControlledProductPermissionArtifact(store, permission),
    (error) => (
      error.code === "OFFICIAL_PRODUCT_SOURCE_CUSTODY_FAILED"
      && !error.message.includes(objectKey)
    ),
  );
});

test("governed controlled import accepts only a complete reviewed artifact set", async () => {
  const { database, d1, artifactStore } = fixture();
  const permission = await retainControlledPermissionArtifact(artifactStore);
  const controlledDefinition = {
    ...definition,
    sources: definition.sources.map((item) => ({
      ...item,
      productionMode: "controlled_manual",
    })),
    fetchSources: async () => definition.sources.map((item) => {
      const bytes = new TextEncoder().encode(JSON.stringify(rows[item.sourceKey]));
      return {
        sourceKey: item.sourceKey,
        contentType: "application/json",
        bytes,
      };
    }),
  };
  await assert.rejects(
    syncOfficialProductRegistry(d1, controlledDefinition, {
      artifactStore,
      controlledImportReview: {
        importedByUid: "same-admin",
        governanceIdentityVerified: true,
        permissionArtifactId: "permission-artifact-42",
        permissionArtifactSha256: "e".repeat(64),
        permissionArtifactObjectKey:
          "creditex/official-sources/permission-artifact-42.json",
        permissionReviewDecisionId: "permission-review-42",
        permissionReviewedByUid: "same-admin",
      },
      now: new Date("2026-08-08T00:00:00.000Z"),
    }),
    expectedError("OFFICIAL_PRODUCT_REQUEST_INVALID"),
  );
  const result = await syncOfficialProductRegistry(d1, controlledDefinition, {
    artifactStore,
    fetchImpl: async () => {
      throw new Error("controlled import must never fetch a network source");
    },
    controlledImportReview: {
      importedByUid: "import-admin",
      governanceIdentityVerified: true,
      permissionArtifactId: permission.artifactId,
      permissionArtifactSha256: permission.sha256,
      permissionArtifactObjectKey: permission.objectKey,
      permissionReviewDecisionId: "permission-review-42",
      permissionReviewedByUid: "governance-admin",
    },
    controlledImportPermissionArtifact: permission,
    now: new Date("2026-08-08T00:00:00.000Z"),
  });
  assert.equal(result.changed, true);
  const snapshot = database.prepare(`SELECT source_manifest_json
    FROM compliance_official_product_snapshots
    WHERE registry_code = ? AND status = 'current'`).get(definition.registryCode);
  const manifest = JSON.parse(snapshot.source_manifest_json);
  assert.deepEqual(manifest.controlledImportReview, {
    contract: "creditex-controlled-product-import-review/v1",
    importedByUid: "import-admin",
    reviewedAt: "2026-08-08T00:00:00.000Z",
    permissionArtifactId: permission.artifactId,
    permissionArtifactSha256: permission.sha256,
    permissionArtifactObjectKey: permission.objectKey,
    permissionReviewDecisionId: "permission-review-42",
    permissionReviewedByUid: "governance-admin",
  });
});

test("controlled imports re-verify permission custody at the activation boundary", async () => {
  for (const mode of ["mutate", "delete"]) {
    const { database, d1, artifactStore } = fixture();
    const permission = await retainControlledPermissionArtifact(artifactStore, {
      artifactId: `permission-${mode}`,
    });
    await verifyCreditexControlledProductPermissionArtifact(
      artifactStore,
      permission,
    );
    const controlledDefinition = {
      ...definition,
      sources: definition.sources.map((item) => ({
        ...item,
        productionMode: "controlled_manual",
      })),
      fetchSources: async () => {
        if (mode === "delete") {
          artifactStore.objects.delete(permission.objectKey);
        } else {
          artifactStore.objects.get(permission.objectKey).bytes[0] ^= 1;
        }
        return definition.sources.map((item) => ({
          sourceKey: item.sourceKey,
          contentType: "application/json",
          bytes: new TextEncoder().encode(JSON.stringify(rows[item.sourceKey])),
        }));
      },
    };
    await assert.rejects(
      syncOfficialProductRegistry(d1, controlledDefinition, {
        artifactStore,
        controlledImportPermissionArtifact: permission,
        controlledImportReview: {
          importedByUid: "import-admin",
          governanceIdentityVerified: true,
          permissionArtifactId: permission.artifactId,
          permissionArtifactSha256: permission.sha256,
          permissionArtifactObjectKey: permission.objectKey,
          permissionReviewDecisionId: "permission-review-42",
          permissionReviewedByUid: "governance-admin",
        },
        now: new Date("2026-08-08T00:00:00.000Z"),
      }),
      expectedError("OFFICIAL_PRODUCT_SOURCE_CUSTODY_FAILED"),
      `${mode}d permission evidence must block activation`,
    );
    assert.equal(
      database.prepare(`SELECT count(*) count
        FROM compliance_official_product_snapshots
        WHERE status IN ('current', 'staging')`).get().count,
      0,
      `${mode}d permission evidence must leave no active or staging snapshot`,
    );
  }
});

test("missing, stale and out-of-window selections fail closed", async () => {
  const { d1, artifactStore } = fixture();
  await syncOfficialProductRegistry(d1, definition, {
    fetchImpl: fetchFixture(), artifactStore,
    now: new Date("2026-08-08T00:00:00.000Z"),
  });
  const historical = await searchOfficialProducts(d1, {
    productKind: "pv_module",
    installationDate: "2025-06-01",
    query: "panel 500",
  }, { now: new Date("2026-08-08T01:00:00.000Z") });
  assert.equal(historical.products.length, 1);
  await assert.rejects(
    validateOfficialProductSelections(d1, {
      installationDate: "2026-08-08",
      requiredKinds: ["pv_module"],
      selectedProductIds: { pv_module: historical.products[0].id },
    }, { now: new Date("2026-08-08T01:00:00.000Z") }),
    expectedError("OFFICIAL_PRODUCT_NOT_ELIGIBLE"),
  );
  await assert.rejects(
    validateOfficialProductSelections(d1, {
      installationDate: "2026-08-08",
      requiredKinds: ["pv_module", "inverter"],
      selectedProductIds: { pv_module: historical.products[0].id },
    }, { now: new Date("2026-08-08T01:00:00.000Z") }),
    expectedError("OFFICIAL_PRODUCT_SELECTION_REQUIRED"),
  );
});

test("unknown approval start dates are not backdated before the accepted snapshot", async () => {
  const { database, d1, artifactStore } = fixture();
  const unknownStartRows = {
    "fixture-pv": rows["fixture-pv"].map((row, index) => index === 0
      ? { ...row, eligibleFrom: "" }
      : row),
  };
  await syncOfficialProductRegistry(d1, definition, {
    fetchImpl: fetchFixture(unknownStartRows), artifactStore,
    now: new Date("2026-08-08T00:00:00.000Z"),
  });

  const historical = await searchOfficialProducts(d1, {
    productKind: "pv_module",
    installationDate: "2026-08-07",
    query: "panel 400",
  }, { now: new Date("2026-08-08T01:00:00.000Z") });
  assert.equal(historical.products.length, 0);

  const current = await searchOfficialProducts(d1, {
    productKind: "pv_module",
    installationDate: "2026-08-08",
    query: "panel 400",
  }, { now: new Date("2026-08-08T01:00:00.000Z") });
  assert.equal(current.products.length, 1);
  assert.equal(current.products[0].eligibleFrom, "2026-08-08");
  assert.equal(
    current.products[0].attributes.creditexEligibleFromBasis,
    "registry_first_seen",
  );
  await assert.rejects(
    validateOfficialProductSelections(d1, {
      installationDate: "2026-08-07",
      requiredKinds: ["pv_module"],
      selectedProductIds: { pv_module: current.products[0].id },
    }, { now: new Date("2026-08-08T01:00:00.000Z") }),
    expectedError("OFFICIAL_PRODUCT_NOT_ELIGIBLE"),
  );

  const changedInverters = structuredClone(rows["fixture-inverter"]);
  changedInverters[0].attributes.ratedAcOutputKw = 5.1;
  await syncOfficialProductRegistry(d1, definition, {
    fetchImpl: fetchFixture({
      ...unknownStartRows,
      "fixture-inverter": changedInverters,
    }),
    artifactStore,
    now: new Date("2026-08-10T00:00:00.000Z"),
  });
  const yesterday = await searchOfficialProducts(d1, {
    productKind: "pv_module",
    installationDate: "2026-08-09",
    query: "panel 400",
  }, { now: new Date("2026-08-10T01:00:00.000Z") });
  assert.equal(yesterday.products.length, 1);
  assert.equal(yesterday.products[0].eligibleFrom, "2026-08-08");
  assert.equal(yesterday.products[0].id, current.products[0].id);
  assert.equal(database.prepare(`SELECT count(*) count
    FROM compliance_official_products
    WHERE source_record_key = 'PV-001|Maker|Panel 400'`).get().count, 1);
});

test("product search rejects fractional and out-of-range limits", async () => {
  const { d1, artifactStore } = fixture();
  await syncOfficialProductRegistry(d1, definition, {
    fetchImpl: fetchFixture(), artifactStore,
    now: new Date("2026-08-08T00:00:00.000Z"),
  });
  for (const limit of [0, 1.5, 101, "not-a-number"]) {
    await assert.rejects(
      searchOfficialProducts(d1, {
        productKind: "pv_module",
        installationDate: "2026-08-08",
        limit,
      }, { now: new Date("2026-08-08T01:00:00.000Z") }),
      expectedError("OFFICIAL_PRODUCT_REQUEST_INVALID"),
    );
  }
});

test("populated staging snapshots cascade cleanly while activated evidence stays immutable", async () => {
  const { database } = fixture();
  const snapshotId = "fixture-staging-snapshot";
  database.prepare(`INSERT INTO compliance_official_product_snapshots (
    id, registry_code, contract, source_manifest_json, source_sha256,
    source_count, record_count, status, created_at, activated_at, superseded_at
  ) VALUES (?, 'cer-cec-products', 'creditex-official-products/v1', '{}', ?,
    1, 1, 'staging', '2026-08-08T00:00:00.000Z', NULL, NULL)`)
    .run(snapshotId, "a".repeat(64));
  database.prepare(`INSERT INTO compliance_official_products (
    id, snapshot_id, source_key, source_record_key, product_kind,
    manufacturer, brand, model, series, registration_number,
    certificate_number, approval_status, eligible_from, eligible_to,
    available_in_australia, registry_effective_from, search_text,
    attributes_json
  ) VALUES (?, ?, 'fixture-pv', 'one', 'pv_module', '', '', 'one', '', '',
    '', 'approved', '', '', 1, '2026-08-08', 'one', '{}')`)
    .run(`${snapshotId}:product`, snapshotId);
  database.prepare(`INSERT INTO compliance_official_product_artifacts (
    id, snapshot_id, source_key, source_url, source_sha256, content_type,
    byte_length, record_count, object_key, created_at
  ) VALUES (?, ?, 'fixture-pv', 'https://example.test/fixture-pv', ?,
    'application/json', 1, 1, ?, '2026-08-08T00:00:00.000Z')`)
    .run(
      `${snapshotId}:artifact`,
      snapshotId,
      "b".repeat(64),
      `creditex/official-products/cer-cec-products/fixture-pv/${"b".repeat(64)}.json`,
    );
  database.prepare(`DELETE FROM compliance_official_product_snapshots
    WHERE id = ?`).run(snapshotId);
  assert.equal(database.prepare(`SELECT count(*) count
    FROM compliance_official_product_snapshots`).get().count, 0);
  assert.equal(database.prepare(`SELECT count(*) count
    FROM compliance_official_products`).get().count, 0);
  assert.equal(database.prepare(`SELECT count(*) count
    FROM compliance_official_product_artifacts`).get().count, 0);
});

test("VEU retains Legacy custody but requires review before any source-count decrease", async () => {
  const { database, d1, artifactStore } = fixture();
  const veuRows = [
    {
      sourceKey: "fixture-veu",
      sourceRecordKey: "VEU-001",
      productKind: "veu_shower_rose",
      manufacturer: "",
      brand: "Current Shower",
      model: "  Current Shower 1  ",
      series: "",
      registrationNumber: "VEU-001",
      certificateNumber: "",
      approvalStatus: "approved",
      eligibleFrom: "2025-01-01",
      eligibleTo: "",
      availableInAustralia: true,
      attributes: { veuProductCategoryNumber: "17A" },
    },
    {
      sourceKey: "fixture-veu",
      sourceRecordKey: "VEU-003",
      productKind: "veu_shower_rose",
      manufacturer: "",
      brand: "Empty Window Shower",
      model: "Empty Window Shower 3",
      series: "",
      registrationNumber: "VEU-003",
      certificateNumber: "",
      approvalStatus: "legacy",
      eligibleFrom: "2025-01-02",
      eligibleTo: "2025-01-01",
      availableInAustralia: true,
      attributes: { veuProductCategoryNumber: "17A" },
    },
    {
      sourceKey: "fixture-veu",
      sourceRecordKey: "VEU-002",
      productKind: "veu_shower_rose",
      manufacturer: "",
      brand: "Legacy Shower",
      model: "Legacy Shower 2",
      series: "",
      registrationNumber: "VEU-002",
      certificateNumber: "",
      approvalStatus: "legacy",
      eligibleFrom: "2020-01-01",
      eligibleTo: "2024-12-31",
      availableInAustralia: true,
      attributes: { veuProductCategoryNumber: "17A" },
    },
  ];
  let currentRows = veuRows;
  const base = source("fixture-veu", "veu_shower_rose", "veu-approved-products");
  delete base.productKind;
  const veuParseGraphs = [];
  const veuDefinition = {
    registryCode: "veu-approved-products",
    title: "Fixture VEU public registry",
    sources: [{
      ...base,
      productKinds: ["veu_shower_rose"],
      minimumRecords: 1,
      requiresOfficialEligibleFrom: true,
      parse(bytes, contentType) {
        const parsed = base.parse(bytes, contentType);
        veuParseGraphs.push(parsed);
        return parsed;
      },
    }],
    async fetchSources() {
      return [{
        sourceKey: "fixture-veu",
        contentType: "application/json",
        bytes: new TextEncoder().encode(JSON.stringify(currentRows)),
      }];
    },
  };
  await syncOfficialProductRegistry(d1, veuDefinition, {
    fetchImpl: async () => { throw new Error("direct fetch must not run"); },
    artifactStore,
    now: new Date("2026-08-08T00:00:00.000Z"),
  });
  assert.equal(veuParseGraphs.length, 2);
  assert.ok(veuParseGraphs.every(
    (records) => records[0].model === "Current Shower 1",
  ));
  const legacySearch = await searchOfficialProducts(d1, {
    productKind: "veu_shower_rose",
    installationDate: "2024-01-01",
    veuActivityCode: "17",
    query: "legacy",
  }, { now: new Date("2026-08-08T01:00:00.000Z") });
  assert.equal(legacySearch.products.length, 1);
  const historicalSelection = await validateOfficialProductSelections(d1, {
    installationDate: "2024-01-01",
    requiredKinds: ["veu_shower_rose"],
    selectedProductIds: {
      veu_shower_rose: legacySearch.products[0].id,
    },
  }, { now: new Date("2026-08-08T01:00:00.000Z") });
  assert.equal(historicalSelection.selections[0].approvalStatus, "legacy");
  const currentLegacySearch = await searchOfficialProducts(d1, {
    productKind: "veu_shower_rose",
    installationDate: "2026-08-08",
    veuActivityCode: "17",
    query: "legacy",
  }, { now: new Date("2026-08-08T01:00:00.000Z") });
  assert.equal(currentLegacySearch.products.length, 0);
  const retainedEmptyWindow = database.prepare(`SELECT attributes_json
    FROM compliance_official_products
    WHERE source_record_key = 'VEU-003'`).get();
  assert.equal(
    JSON.parse(retainedEmptyWindow.attributes_json).veuOfficialEligibilityWindow,
    "empty_inverted",
  );
  assert.equal(
    JSON.parse(retainedEmptyWindow.attributes_json).veuOfficialEffectiveFrom,
    "2025-01-02",
  );
  assert.equal(
    JSON.parse(retainedEmptyWindow.attributes_json).veuOfficialEffectiveTo,
    "2025-01-01",
  );
  for (const installationDate of ["2025-01-01", "2025-01-02"]) {
    const emptyWindowSearch = await searchOfficialProducts(d1, {
      productKind: "veu_shower_rose",
      installationDate,
      veuActivityCode: "17",
      query: "empty window",
    }, { now: new Date("2026-08-08T01:00:00.000Z") });
    assert.equal(emptyWindowSearch.products.length, 0);
  }
  await assert.rejects(
    validateOfficialProductSelections(d1, {
      installationDate: "2026-08-08",
      requiredKinds: ["veu_shower_rose"],
      selectedProductIds: {
        veu_shower_rose: legacySearch.products[0].id,
      },
    }, { now: new Date("2026-08-08T01:00:00.000Z") }),
    expectedError("OFFICIAL_PRODUCT_NOT_ELIGIBLE"),
  );

  const approvedBeforeTransition = await searchOfficialProducts(d1, {
    productKind: "veu_shower_rose",
    installationDate: "2026-08-09",
    veuActivityCode: "17",
    query: "current shower",
  }, { now: new Date("2026-08-08T01:00:00.000Z") });
  assert.equal(approvedBeforeTransition.products.length, 1);
  const transitioned = {
    ...veuRows[0],
    approvalStatus: "legacy",
    eligibleTo: "2026-08-08",
  };
  currentRows = [transitioned, veuRows[1], veuRows[2]];
  const transitionSnapshot = await syncOfficialProductRegistry(d1, veuDefinition, {
    fetchImpl: async () => { throw new Error("direct fetch must not run"); },
    artifactStore,
    now: new Date("2026-08-10T00:00:00.000Z"),
  });
  const finalEligibleDay = await searchOfficialProducts(d1, {
    productKind: "veu_shower_rose",
    installationDate: "2026-08-08",
    veuActivityCode: "17",
    query: "current shower",
  }, { now: new Date("2026-08-10T01:00:00.000Z") });
  assert.equal(finalEligibleDay.products.length, 1);
  assert.equal(finalEligibleDay.products[0].approvalStatus, "legacy");
  assert.equal(finalEligibleDay.products[0].eligibleTo, "2026-08-08");
  assert.equal(finalEligibleDay.products[0].snapshotId, transitionSnapshot.snapshotId);
  const finalDaySelection = await validateOfficialProductSelections(d1, {
    installationDate: "2026-08-08",
    requiredKinds: ["veu_shower_rose"],
    selectedProductIds: {
      veu_shower_rose: approvedBeforeTransition.products[0].id,
    },
  }, { now: new Date("2026-08-10T01:00:00.000Z") });
  assert.equal(finalDaySelection.selections[0].approvalStatus, "legacy");
  assert.equal(finalDaySelection.selections[0].eligibleTo, "2026-08-08");
  assert.equal(
    finalDaySelection.selections[0].snapshotId,
    transitionSnapshot.snapshotId,
  );
  const afterOfficialEnd = await searchOfficialProducts(d1, {
    productKind: "veu_shower_rose",
    installationDate: "2026-08-09",
    veuActivityCode: "17",
    query: "current shower",
  }, { now: new Date("2026-08-10T01:00:00.000Z") });
  assert.equal(afterOfficialEnd.products.length, 0);
  await assert.rejects(
    validateOfficialProductSelections(d1, {
      installationDate: "2026-08-09",
      requiredKinds: ["veu_shower_rose"],
      selectedProductIds: {
        veu_shower_rose: approvedBeforeTransition.products[0].id,
      },
    }, { now: new Date("2026-08-10T01:00:00.000Z") }),
    expectedError("OFFICIAL_PRODUCT_NOT_ELIGIBLE"),
  );

  currentRows = [transitioned];
  await assert.rejects(
    syncOfficialProductRegistry(d1, veuDefinition, {
      fetchImpl: async () => { throw new Error("direct fetch must not run"); },
      artifactStore,
      now: new Date("2026-08-11T00:00:00.000Z"),
    }),
    expectedError("OFFICIAL_PRODUCT_SOURCE_COUNT_REGRESSION"),
  );
  currentRows = [{ ...transitioned, eligibleTo: "" }];
  await assert.rejects(
    syncOfficialProductRegistry(d1, veuDefinition, {
      fetchImpl: async () => { throw new Error("direct fetch must not run"); },
      artifactStore,
      now: new Date("2026-08-12T00:00:00.000Z"),
    }),
    expectedError("OFFICIAL_PRODUCT_SOURCE_INVALID"),
  );
});

test("live automatic feeds activate official products into searchable snapshots", {
  skip: process.env.CREDITEX_LIVE_OFFICIAL_REGISTRY !== "1",
}, async (t) => {
  const { database, d1, artifactStore } = fixture();
  t.after(() => database.close());
  const results = [];
  for (const registry of CREDITEX_AUTOMATIC_PRODUCT_REGISTRIES) {
    results.push(await syncOfficialProductRegistry(d1, registry, {
      fetchImpl: fetch,
      artifactStore,
      now: new Date("2026-08-08T12:00:00.000Z"),
    }));
  }
  assert.ok(results[0].recordCount >= 30_000);
  assert.ok(results[1].recordCount >= 500);
  assert.ok(results[2].recordCount >= 70_000);
  assert.equal(database.prepare(`SELECT count(*) count
    FROM compliance_official_products`).get().count, results.reduce(
      (total, result) => total + result.recordCount,
      0,
    ));
  assert.equal(database.prepare(`SELECT count(*) count
    FROM compliance_official_product_artifacts`).get().count, 13);
  assert.equal(artifactStore.objects.size, 13);

  const refrigerator = await searchOfficialProducts(d1, {
    productKind: "refrigerator_freezer",
    installationDate: "2026-08-08",
    query: "",
    limit: 1,
  }, { now: new Date("2026-08-08T13:00:00.000Z") });
  assert.equal(refrigerator.products.length, 1);
});

test("live VEU feed retains its exact artifact and activates every row", {
  skip: process.env.CREDITEX_LIVE_VEU_REGISTRY_SYNC !== "1",
}, async (t) => {
  const { database, d1 } = fixture();
  const artifactStore = fileArtifactStore();
  t.after(() => database.close());
  t.after(() => fs.rmSync(artifactStore.directory, { recursive: true }));
  const result = await syncOfficialProductRegistry(
    d1,
    CREDITEX_VEU_PRODUCT_REGISTRY,
    {
      fetchImpl: fetch,
      artifactStore,
      now: new Date(),
    },
  );
  assert.ok(result.recordCount >= 70_000);
  assert.equal(database.prepare(`SELECT count(*) count
    FROM compliance_official_products`).get().count, result.recordCount);
  assert.equal(database.prepare(`SELECT count(*) count
    FROM compliance_official_product_artifacts`).get().count, 1);
  assert.equal(artifactStore.objects.size, 1);
  const statuses = database.prepare(`SELECT approval_status status, count(*) count
    FROM compliance_official_products GROUP BY approval_status ORDER BY status`).all();
  assert.deepEqual(statuses.map(({ status }) => status), ["approved", "legacy"]);
  assert.equal(
    statuses.reduce((sum, { count }) => sum + Number(count), 0),
    result.recordCount,
  );
});
