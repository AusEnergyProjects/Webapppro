import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { CreditexOfficialProductError } from "../src/lib/creditex-official-product-registry.ts";
import {
  loadOfficialProductRegistryStatus,
  searchOfficialProducts,
  syncOfficialProductRegistry,
  validateOfficialProductSelections,
} from "../src/lib/creditex-official-product-registry-server.ts";
import {
  CREDITEX_AUTOMATIC_PRODUCT_REGISTRIES,
  CREDITEX_CER_CEC_PRODUCT_REGISTRY,
  CREDITEX_CONTROLLED_MANUAL_PRODUCT_REGISTRIES,
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

class TestD1Statement {
  constructor(database, sql, values = []) {
    this.database = database;
    this.sql = sql;
    this.values = values;
  }

  bind(...values) {
    return new TestD1Statement(this.database, this.sql, values);
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

function testD1(database) {
  return {
    prepare(sql) {
      return new TestD1Statement(database, sql);
    },
    async batch(statements) {
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

function fixture() {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  database.exec(sresMigration);
  database.exec(officialMigration);
  for (const guard of CREDITEX_OFFICIAL_PRODUCT_REGISTRY_SCHEMA_GUARDS) {
    database.exec(guard.sql);
  }
  return {
    database,
    d1: testD1(database),
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
    assert.equal(request.init.redirect, undefined);
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

test("record-count regressions and failed attempts quarantine the last snapshot", async () => {
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
  assert.equal(status.status, "stale");
  assert.equal(status.lastAttempt.status, "failed");
  await assert.rejects(
    searchOfficialProducts(d1, {
      productKind: "pv_module",
      installationDate: "2026-08-09",
    }, { now: new Date("2026-08-09T00:00:01.000Z") }),
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
    ["gems-products"],
  );
  assert.deepEqual(
    CREDITEX_CONTROLLED_MANUAL_PRODUCT_REGISTRIES.map(
      ({ registryCode }) => registryCode,
    ),
    ["cer-cec-products"],
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

test("live automatic feeds activate licensed GEMS products into searchable snapshots", {
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
  assert.deepEqual(
    results.map((result) => result.recordCount),
    [31_418],
  );
  assert.equal(database.prepare(`SELECT count(*) count
    FROM compliance_official_products`).get().count, 31_418);
  assert.equal(database.prepare(`SELECT count(*) count
    FROM compliance_official_product_artifacts`).get().count, 11);
  assert.equal(artifactStore.objects.size, 11);

  const refrigerator = await searchOfficialProducts(d1, {
    productKind: "refrigerator_freezer",
    installationDate: "2026-08-08",
    query: "",
    limit: 1,
  }, { now: new Date("2026-08-08T13:00:00.000Z") });
  assert.equal(refrigerator.products.length, 1);
});
