import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  CreditexSresRegistryError,
  parseCerSresProductCsv,
  registeredStcsForZone,
  resolveCerSresPostcode,
  validateCerSresPostcodeRanges,
} from "../src/lib/creditex-sres-registry.ts";
import {
  estimateCreditexStcsFromRegistry,
  loadCerSresRegistryStatus,
  searchCerSresProducts,
  syncCerSresProductRegistry,
} from "../src/lib/creditex-sres-registry-server.ts";
import {
  estimateCreditexSresQuote,
} from "../src/lib/creditex-sres-calculator-estimator.ts";
import {
  CREDITEX_SRES_PRODUCT_REGISTRY_SCHEMA_GUARDS,
} from "../src/lib/creditex-product-registry-schema-guards.ts";
import {
  australianRegulatorDate,
} from "../src/lib/creditex-australian-regulator-date.ts";

const migration = fs.readFileSync(
  new URL(
    "../drizzle/0124_creditex_sres_product_registry.sql",
    import.meta.url,
  ),
  "utf8",
);
const officialProductMigration = fs.readFileSync(
  new URL(
    "../drizzle/0125_creditex_official_product_registry.sql",
    import.meta.url,
  ),
  "utf8",
);

const productRouteSource = fs.readFileSync(
  new URL(
    "../src/app/api/creditex/stc-products/route.ts",
    import.meta.url,
  ),
  "utf8",
);
const estimateRouteSource = fs.readFileSync(
  new URL(
    "../src/app/api/creditex/stc-estimates/route.ts",
    import.meta.url,
  ),
  "utf8",
);
const workerSource = fs.readFileSync(
  new URL("../worker/index.ts", import.meta.url),
  "utf8",
);
const calculatorSource = fs.readFileSync(
  new URL(
    "../src/components/CreditexSresCalculator.tsx",
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

const COMMON_HEADERS = [
  "Item",
  "Brand",
  "Model",
  "Eligible from",
  "Eligible to",
  "Number of certificates for an installation in Zone1",
  "Number of certificates for an installation in Zone2",
  "Number of certificates for an installation in Zone3",
  "Number of certificates for an installation in Zone4",
];

const SOURCES = [
  {
    sourceKey: "cer-ashp",
    technology: "air_source_heat_pump",
    category: "capacity_at_most_425l",
    url: "https://cer.gov.au/document/air-source-heat-pump-models",
    expectedColumns: 10,
    minimumRecords: 1,
  },
  {
    sourceKey: "cer-swh-lt-700l",
    technology: "solar_water_heater",
    category: "capacity_less_than_700l",
    url: "https://cer.gov.au/document/solar-water-heater-models-capacity-less-700l",
    expectedColumns: 9,
    minimumRecords: 1,
  },
  {
    sourceKey: "cer-swh-ge-700l",
    technology: "solar_water_heater",
    category: "capacity_at_least_700l",
    url: "https://cer.gov.au/document/solar-water-heater-models-capacity-more-700l",
    expectedColumns: 9,
    minimumRecords: 1,
  },
];

const REFERENCE_BODIES = new Map([
  ["cer-swh-ashp-postcode-zones", "%PDF-1.4 fixture water heater zones"],
  ["cer-pv-postcode-zones", "%PDF-1.4 fixture solar PV zones"],
]);

const REFERENCES = [
  {
    sourceKey: "cer-swh-ashp-postcode-zones",
    url: "https://cer.gov.au/document/postcode-zones-solar-water-heaters-and-heat-pumps",
    expectedContentType: "application/pdf",
    expectedSha256: createHash("sha256")
      .update(REFERENCE_BODIES.get("cer-swh-ashp-postcode-zones"))
      .digest("hex"),
  },
  {
    sourceKey: "cer-pv-postcode-zones",
    url: "https://cer.gov.au/document/postcode-zone-ratings-and-zones-solar-panel-systems",
    expectedContentType: "application/pdf",
    expectedSha256: createHash("sha256")
      .update(REFERENCE_BODIES.get("cer-pv-postcode-zones"))
      .digest("hex"),
  },
];

function csvFixture(source, overrides = {}) {
  const headers = source.expectedColumns === 10
    ? [...COMMON_HEADERS, "Number of certificates for an installation in Zone5"]
    : COMMON_HEADERS;
  const values = source.expectedColumns === 10
    ? ["1", "Aestiva", "AS51-210HPA", "31 Oct 2024", "31 Dec 2030", "25", "24", "30", "32", "31"]
    : source.sourceKey === "cer-swh-lt-700l"
      ? ["1105", "AAE Solar", "ES-250E-20-OP2S", "30 May 2011", "31 Dec 2030", "16", "17", "16", "15"]
      : ["7696", "Apricus Australia", "ABC04-800T1-322-30", "10 Dec 2013", "31 Dec 2030", "129", "136", "117", "100"];
  const row = values.map((value, index) => overrides[index] ?? value);
  return `${headers.join(",")}\r\n${row.join(",")}\r\n`;
}

function twoRowCsvFixture(source) {
  const [headers, firstRow] = csvFixture(source).trimEnd().split("\r\n");
  const second = firstRow.split(",");
  second[0] = String(Number(second[0]) + 1);
  second[2] = `${second[2]}-SECOND`;
  return `${headers}\r\n${firstRow}\r\n${second.join(",")}\r\n`;
}

function multiRowCsvFixture(source, rowOverrides) {
  const [headers, templateRow] = csvFixture(source).trimEnd().split("\r\n");
  const template = templateRow.split(",");
  const rows = rowOverrides.map((overrides) => template
    .map((value, index) => overrides[index] ?? value)
    .join(","));
  return `${headers}\r\n${rows.join("\r\n")}\r\n`;
}

function fetchFixture(overrides = new Map()) {
  return async (input) => {
    const source = SOURCES.find(({ url }) => url === input);
    if (!source) {
      const reference = REFERENCES.find(({ url }) => url === input);
      if (!reference) return new Response("not found", { status: 404 });
      const body = overrides.get(reference.sourceKey)
        ?? REFERENCE_BODIES.get(reference.sourceKey);
      return new Response(body, {
        status: 200,
        headers: {
          "content-type": "application/pdf",
          "content-length": String(new TextEncoder().encode(body).byteLength),
        },
      });
    }
    const body = overrides.get(source.sourceKey) ?? csvFixture(source);
    return new Response(body, {
      status: 200,
      headers: {
        "content-type": "text/csv; charset=UTF-8",
        "content-length": String(new TextEncoder().encode(body).byteLength),
      },
    });
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
  database.exec(migration);
  database.exec(officialProductMigration);
  for (const guard of CREDITEX_SRES_PRODUCT_REGISTRY_SCHEMA_GUARDS) {
    database.exec(guard.sql);
  }
  return {
    database,
    d1: testD1(database),
    artifactStore: memoryArtifactStore(),
  };
}

function expectedRegistryError(code) {
  return (error) => {
    assert.ok(error instanceof CreditexSresRegistryError);
    assert.equal(error.code, code);
    return true;
  };
}

test("official CER postcode transcriptions resolve technology-specific zones", () => {
  assert.equal(validateCerSresPostcodeRanges(), true);
  assert.deepEqual(resolveCerSresPostcode("solar_pv", "3000"), {
    postcode: "3000",
    technology: "solar_pv",
    zone: 4,
    rating: "1.185",
    sourceUrl:
      "https://cer.gov.au/document/postcode-zone-ratings-and-zones-solar-panel-systems",
    sourceVersion: "effective-2020-01-01",
    sourceSha256:
      "58cd05502692011b22b314f48be673e80a74e7775d569aa2989a956968dc72e3",
  });
  assert.equal(resolveCerSresPostcode("air_source_heat_pump", "3000").zone, 4);
  assert.equal(resolveCerSresPostcode("solar_water_heater", "3000").zone, 4);
  assert.equal(resolveCerSresPostcode("solar_pv", "0870").zone, 1);
  assert.equal(resolveCerSresPostcode("air_source_heat_pump", "0870").zone, 2);
  assert.throws(
    () => resolveCerSresPostcode("air_source_heat_pump", "0855"),
    expectedRegistryError("SRES_POSTCODE_ZONE_UNAVAILABLE"),
  );
  assert.throws(
    () => resolveCerSresPostcode("solar_pv", "300"),
    expectedRegistryError("SRES_POSTCODE_INVALID"),
  );
});

test("CER CSV parsing is exact, effective-dated and fails closed on schema drift", () => {
  const ashp = parseCerSresProductCsv(csvFixture(SOURCES[0]), SOURCES[0]);
  assert.deepEqual(ashp[0], {
    sourceRecordKey: "cer-ashp:1",
    sourceItem: "1",
    technology: "air_source_heat_pump",
    category: "capacity_at_most_425l",
    brand: "Aestiva",
    model: "AS51-210HPA",
    eligibleFrom: "2024-10-31",
    eligibleTo: "2030-12-31",
    zone1Stcs: 25,
    zone2Stcs: 24,
    zone3Stcs: 30,
    zone4Stcs: 32,
    zone5Stcs: 31,
  });
  assert.equal(registeredStcsForZone(ashp[0], 4), "32");
  const limitedZones = parseCerSresProductCsv(
    csvFixture(SOURCES[0], { 8: "NA", 9: "NA" }),
    SOURCES[0],
  );
  assert.equal(limitedZones[0].zone4Stcs, null);
  assert.throws(
    () => registeredStcsForZone(limitedZones[0], 4),
    expectedRegistryError("SRES_PRODUCT_ZONE_UNAVAILABLE"),
  );
  assert.throws(
    () => parseCerSresProductCsv(
      csvFixture(SOURCES[0]).replace("Item,Brand", "Item,Manufacturer"),
      SOURCES[0],
    ),
    expectedRegistryError("SRES_PRODUCT_SOURCE_SCHEMA_CHANGED"),
  );
  assert.throws(
    () => parseCerSresProductCsv(
      `${csvFixture(SOURCES[0])}${csvFixture(SOURCES[0]).split("\r\n")[1]}\r\n`,
      SOURCES[0],
    ),
    expectedRegistryError("SRES_PRODUCT_SOURCE_DUPLICATE"),
  );
});

test("scheduled UTC refresh instants resolve to the next Sydney regulator day", () => {
  assert.equal(
    australianRegulatorDate("2026-08-08T20:45:00.000Z"),
    "2026-08-09",
  );
  assert.equal(
    australianRegulatorDate("2026-08-08T21:05:00.000Z"),
    "2026-08-09",
  );
});

test("registry sync uses bounded Worker-compatible official source requests", async () => {
  const { d1, artifactStore } = fixture();
  const requests = [];
  const fixtureFetch = fetchFixture();
  await syncCerSresProductRegistry(d1, {
    fetchImpl: async (input, init) => {
      requests.push({ input: String(input), init });
      return fixtureFetch(input, init);
    },
    artifactStore,
    now: new Date("2026-08-08T00:00:00.000Z"),
    references: REFERENCES,
    sources: SOURCES,
  });

  assert.deepEqual(
    requests.map(({ input }) => input),
    [...SOURCES, ...REFERENCES].map(({ url }) => url),
  );
  for (const [index, request] of requests.entries()) {
    assert.equal(request.init.cache, "no-store");
    assert.equal(request.init.method, undefined);
    assert.equal(request.init.redirect, "manual");
    assert.equal(
      new Headers(request.init.headers).has("user-agent"),
      false,
    );
    assert.equal(
      new Headers(request.init.headers).get("accept"),
      index < SOURCES.length
        ? "text/csv"
        : REFERENCES[index - SOURCES.length].expectedContentType,
    );
  }
});

test("registry sync rejects official source redirects without following them", async () => {
  const { d1, artifactStore } = fixture();

  await assert.rejects(
    syncCerSresProductRegistry(d1, {
      fetchImpl: async () => new Response(null, {
        status: 302,
        headers: { location: "https://untrusted.example/products.csv" },
      }),
      artifactStore,
      now: new Date("2026-08-08T00:00:00.000Z"),
      references: REFERENCES,
      sources: SOURCES,
    }),
    expectedRegistryError("SRES_PRODUCT_SOURCE_UNAVAILABLE"),
  );
});

test("registry sync rejects official reference redirects without following them", async () => {
  const { d1, artifactStore } = fixture();
  const fixtureFetch = fetchFixture();

  await assert.rejects(
    syncCerSresProductRegistry(d1, {
      fetchImpl: async (input, init) => REFERENCES.some(({ url }) => url === input)
        ? new Response(null, {
            status: 301,
            headers: { location: "https://untrusted.example/zones.pdf" },
          })
        : fixtureFetch(input, init),
      artifactStore,
      now: new Date("2026-08-08T00:00:00.000Z"),
      references: REFERENCES,
      sources: SOURCES,
    }),
    expectedRegistryError("SRES_POSTCODE_SOURCE_UNAVAILABLE"),
  );
});

test("daily sync keeps exact source custody and atomically activates one snapshot", async () => {
  const { database, d1, artifactStore } = fixture();
  const now = new Date("2026-08-08T00:00:00.000Z");
  const first = await syncCerSresProductRegistry(d1, {
    fetchImpl: fetchFixture(),
    artifactStore,
    now,
    references: REFERENCES,
    sources: SOURCES,
  });
  assert.equal(first.changed, true);
  assert.equal(first.recordCount, 3);
  assert.equal(
    database.prepare(`SELECT COUNT(*) count
      FROM compliance_product_registry_snapshots
      WHERE status = 'current'`).get().count,
    1,
  );
  assert.equal(
    database.prepare(`SELECT COUNT(*) count
      FROM compliance_product_registry_source_artifacts`).get().count,
    5,
  );
  assert.equal(artifactStore.objects.size, 5);
  assert.equal(
    database.prepare(`SELECT COUNT(*) count
      FROM compliance_product_registry_products`).get().count,
    3,
  );

  const second = await syncCerSresProductRegistry(d1, {
    fetchImpl: fetchFixture(),
    artifactStore,
    now: new Date("2026-08-09T00:00:00.000Z"),
    references: REFERENCES,
    sources: SOURCES,
  });
  assert.equal(second.changed, false);
  assert.equal(second.snapshotId, first.snapshotId);
  assert.equal(
    database.prepare(`SELECT COUNT(*) count
      FROM compliance_product_registry_snapshots`).get().count,
    1,
  );
  assert.deepEqual(
    database.prepare(`SELECT status FROM compliance_product_registry_sync_runs
      ORDER BY checked_at`).all().map(({ status }) => status),
    ["success", "unchanged"],
  );

  const status = await loadCerSresRegistryStatus(d1, {
    now: new Date("2026-08-09T01:00:00.000Z"),
  });
  assert.equal(status.status, "current");
  assert.equal(status.snapshot.recordCount, 3);
  assert.equal(status.snapshot.activatedOn, "2026-08-08");
  assert.equal(status.lastAttempt.status, "unchanged");

  const changed = new Map([
    ["cer-ashp", csvFixture(SOURCES[0], { 2: "AS51-210HPA-R2" })],
  ]);
  const third = await syncCerSresProductRegistry(d1, {
    fetchImpl: fetchFixture(changed),
    artifactStore,
    now: new Date("2026-08-10T00:00:00.000Z"),
    references: REFERENCES,
    sources: SOURCES,
  });
  assert.equal(third.changed, true);
  assert.notEqual(third.snapshotId, first.snapshotId);
  assert.equal(
    database.prepare(`SELECT COUNT(*) count
      FROM compliance_product_registry_snapshots`).get().count,
    2,
  );
  assert.equal(
    database.prepare(`SELECT COUNT(*) count
      FROM compliance_product_registry_products`).get().count,
    4,
  );
  assert.equal(
    database.prepare(`SELECT COUNT(*) count
      FROM compliance_product_registry_products
      WHERE snapshot_id = ?`).get(first.snapshotId).count,
    1,
  );
  assert.equal(
    database.prepare(`SELECT COUNT(*) count
      FROM compliance_product_registry_source_artifacts`).get().count,
    10,
  );
  assert.equal(artifactStore.objects.size, 6);
  assert.throws(
    () => database.prepare(`DELETE FROM compliance_product_registry_products
      WHERE snapshot_id = ?`).run(third.snapshotId),
    /Current product registry rows are immutable/,
  );
});

test("a later refresh removes a populated abandoned staging snapshot", async () => {
  const { database, d1, artifactStore } = fixture();
  const first = await syncCerSresProductRegistry(d1, {
    fetchImpl: fetchFixture(),
    artifactStore,
    now: new Date("2026-08-08T00:00:00.000Z"),
    references: REFERENCES,
    sources: SOURCES,
  });
  const abandonedId = "abandoned-staging-snapshot";
  database.prepare(`INSERT INTO compliance_product_registry_snapshots (
      id, registry_code, contract, source_manifest_json, source_sha256,
      record_count, status, created_at, activated_at, superseded_at
    ) SELECT ?, registry_code, contract, source_manifest_json, source_sha256,
      record_count, 'staging', ?, NULL, NULL
    FROM compliance_product_registry_snapshots WHERE id = ?`)
    .run(abandonedId, "2026-08-08T00:30:00.000Z", first.snapshotId);
  database.prepare(`INSERT INTO compliance_product_registry_products (
      id, snapshot_id, source_record_key, source_item, technology, category,
      brand, model, search_text, eligible_from, eligible_to, zone_1_stcs,
      zone_2_stcs, zone_3_stcs, zone_4_stcs, zone_5_stcs
    ) SELECT ? || ':' || source_record_key, ?, source_record_key, source_item,
      technology, category, brand, model, search_text, eligible_from,
      eligible_to, zone_1_stcs, zone_2_stcs, zone_3_stcs, zone_4_stcs,
      zone_5_stcs
    FROM compliance_product_registry_products WHERE snapshot_id = ?`)
    .run(abandonedId, abandonedId, first.snapshotId);
  database.prepare(`INSERT INTO compliance_product_registry_source_artifacts (
      id, snapshot_id, source_key, source_url, source_sha256, content_type,
      byte_length, record_count, object_key, created_at
    ) SELECT ? || ':' || source_key, ?, source_key, source_url, source_sha256,
      content_type, byte_length, record_count, object_key, ?
    FROM compliance_product_registry_source_artifacts WHERE snapshot_id = ?`)
    .run(
      abandonedId,
      abandonedId,
      "2026-08-08T00:30:00.000Z",
      first.snapshotId,
    );

  const next = await syncCerSresProductRegistry(d1, {
    fetchImpl: fetchFixture(),
    artifactStore,
    now: new Date("2026-08-08T01:00:00.000Z"),
    references: REFERENCES,
    sources: SOURCES,
  });
  assert.equal(next.changed, false);
  assert.equal(next.snapshotId, first.snapshotId);
  assert.equal(
    database.prepare(`SELECT COUNT(*) count
      FROM compliance_product_registry_snapshots WHERE status = 'staging'`)
      .get().count,
    0,
  );
  assert.equal(
    database.prepare(`SELECT COUNT(*) count
      FROM compliance_product_registry_products`).get().count,
    3,
  );
  assert.equal(
    database.prepare(`SELECT COUNT(*) count
      FROM compliance_product_registry_source_artifacts`).get().count,
    5,
  );
});

test("retained source custody is verified from exact R2 bytes", async () => {
  const { d1, artifactStore } = fixture();
  await syncCerSresProductRegistry(d1, {
    fetchImpl: fetchFixture(),
    artifactStore,
    now: new Date("2026-08-08T00:00:00.000Z"),
    references: REFERENCES,
    sources: SOURCES,
  });
  const [firstKey, retained] = artifactStore.objects.entries().next().value;
  retained.bytes[0] ^= 1;
  artifactStore.objects.set(firstKey, retained);

  await assert.rejects(
    syncCerSresProductRegistry(d1, {
      fetchImpl: fetchFixture(),
      artifactStore,
      now: new Date("2026-08-08T01:00:00.000Z"),
      references: REFERENCES,
      sources: SOURCES,
    }),
    expectedRegistryError("SRES_SOURCE_CUSTODY_FAILED"),
  );
});

test("a per-source record-count decrease requires exact audited approval", async () => {
  const { database, d1, artifactStore } = fixture();
  const first = await syncCerSresProductRegistry(d1, {
    fetchImpl: fetchFixture(new Map([
      ["cer-ashp", twoRowCsvFixture(SOURCES[0])],
    ])),
    artifactStore,
    now: new Date("2026-08-08T00:00:00.000Z"),
    references: REFERENCES,
    sources: SOURCES,
  });

  await assert.rejects(
    syncCerSresProductRegistry(d1, {
      fetchImpl: fetchFixture(),
      artifactStore,
      now: new Date("2026-08-09T00:00:00.000Z"),
      references: REFERENCES,
      sources: SOURCES,
    }),
    expectedRegistryError("SRES_PRODUCT_SOURCE_COUNT_REGRESSION"),
  );
  assert.equal(
    (await loadCerSresRegistryStatus(d1, {
      now: new Date("2026-08-09T00:00:01.000Z"),
    })).status,
    "stale",
  );

  await assert.rejects(
    syncCerSresProductRegistry(d1, {
      fetchImpl: fetchFixture(),
      artifactStore,
      now: new Date("2026-08-09T00:01:00.000Z"),
      references: REFERENCES,
      sources: SOURCES,
      reviewedCountDecrease: {
        reviewedByUid: "verified-admin-1",
        governanceIdentityVerified: true,
        reviewNote: "Reviewed the exact official CER delisting evidence.",
        sources: [{
          sourceKey: "cer-ashp",
          previousRecordCount: 2,
          acceptedRecordCount: 2,
        }],
      },
    }),
    expectedRegistryError("SRES_PRODUCT_SOURCE_COUNT_REGRESSION"),
  );
  assert.equal(
    database.prepare(`SELECT id FROM compliance_product_registry_snapshots
      WHERE status = 'current'`).get().id,
    first.snapshotId,
  );

  const accepted = await syncCerSresProductRegistry(d1, {
    fetchImpl: fetchFixture(),
    artifactStore,
    now: new Date("2026-08-09T00:02:00.000Z"),
    references: REFERENCES,
    sources: SOURCES,
    reviewedCountDecrease: {
      reviewedByUid: "verified-admin-1",
      governanceIdentityVerified: true,
      reviewNote: "Reviewed the exact official CER delisting evidence.",
      sources: [{
        sourceKey: "cer-ashp",
        previousRecordCount: 2,
        acceptedRecordCount: 1,
      }],
    },
  });
  assert.equal(accepted.changed, true);
  assert.equal(accepted.reviewedCountDecrease, true);
  assert.notEqual(accepted.snapshotId, first.snapshotId);
  assert.equal(
    (await loadCerSresRegistryStatus(d1, {
      now: new Date("2026-08-09T00:03:00.000Z"),
    })).status,
    "current",
  );
  const audit = JSON.parse(database.prepare(`SELECT message
    FROM compliance_product_registry_sync_runs
    WHERE status = 'success'
    ORDER BY checked_at DESC LIMIT 1`).get().message);
  assert.deepEqual(audit, {
    contract: "creditex-sres-reviewed-product-count-decrease/v1",
    governanceIdentityVerified: true,
    reviewNote: "Reviewed the exact official CER delisting evidence.",
    reviewedAt: "2026-08-09T00:02:00.000Z",
    reviewedByUid: "verified-admin-1",
    sources: [{
      acceptedRecordCount: 1,
      previousRecordCount: 2,
      sourceKey: "cer-ashp",
    }],
  });

  await assert.rejects(
    syncCerSresProductRegistry(d1, {
      fetchImpl: fetchFixture(),
      artifactStore,
      now: new Date("2026-08-09T00:04:00.000Z"),
      references: REFERENCES,
      sources: SOURCES,
      reviewedCountDecrease: {
        reviewedByUid: "verified-admin-1",
        governanceIdentityVerified: true,
        reviewNote: "Attempted reuse of an already consumed review approval.",
        sources: [{
          sourceKey: "cer-ashp",
          previousRecordCount: 2,
          acceptedRecordCount: 1,
        }],
      },
    }),
    expectedRegistryError("SRES_REFRESH_REQUEST_INVALID"),
  );
  assert.equal(
    database.prepare(`SELECT id FROM compliance_product_registry_snapshots
      WHERE status = 'current'`).get().id,
    accepted.snapshotId,
  );
});

test("a reviewed removal uses Sydney regulator dates without rejecting the prior local day", async () => {
  const { database, d1, artifactStore } = fixture();
  const first = await syncCerSresProductRegistry(d1, {
    fetchImpl: fetchFixture(new Map([
      ["cer-ashp", twoRowCsvFixture(SOURCES[0])],
    ])),
    artifactStore,
    now: new Date("2026-08-08T20:45:00.000Z"),
    references: REFERENCES,
    sources: SOURCES,
  });
  const current = await syncCerSresProductRegistry(d1, {
    fetchImpl: fetchFixture(),
    artifactStore,
    now: new Date("2026-08-09T21:05:00.000Z"),
    references: REFERENCES,
    sources: SOURCES,
    reviewedCountDecrease: {
      reviewedByUid: "verified-admin-1",
      governanceIdentityVerified: true,
      reviewNote: "Confirmed this exact CER product removal against the official source.",
      sources: [{
        sourceKey: "cer-ashp",
        previousRecordCount: 2,
        acceptedRecordCount: 1,
      }],
    },
  });
  assert.deepEqual(
    database.prepare(`SELECT id, activated_at, activated_on,
        superseded_at, superseded_on
      FROM compliance_product_registry_snapshots
      ORDER BY activated_at`).all().map((row) => ({ ...row })),
    [
      {
        id: first.snapshotId,
        activated_at: "2026-08-08T20:45:00.000Z",
        activated_on: "2026-08-09",
        superseded_at: "2026-08-09T21:05:00.000Z",
        superseded_on: "2026-08-10",
      },
      {
        id: current.snapshotId,
        activated_at: "2026-08-09T21:05:00.000Z",
        activated_on: "2026-08-10",
        superseded_at: null,
        superseded_on: null,
      },
    ],
  );
  assert.deepEqual(
    database.prepare(`SELECT source_record_key
      FROM compliance_product_registry_products
      WHERE snapshot_id = ? ORDER BY source_record_key`)
      .all(first.snapshotId)
      .map((row) => ({ ...row })),
    [{ source_record_key: "cer-ashp:2" }],
  );
  assert.equal(
    database.prepare(`SELECT count(*) count
      FROM compliance_product_registry_products
      WHERE snapshot_id = ?`).get(current.snapshotId).count,
    3,
  );

  const historicalSearch = await searchCerSresProducts(d1, {
    technology: "air_source_heat_pump",
    installationDate: "2026-08-09",
    query: "second",
    now: new Date("2026-08-09T22:00:00.000Z"),
  });
  assert.equal(historicalSearch.products.length, 1);
  assert.equal(historicalSearch.products[0].sourceRecordKey, "cer-ashp:2");
  const currentSearch = await searchCerSresProducts(d1, {
    technology: "air_source_heat_pump",
    installationDate: "2026-08-10",
    query: "second",
    now: new Date("2026-08-09T22:00:00.000Z"),
  });
  assert.equal(currentSearch.products.length, 0);

  const historicalEstimate = await estimateCreditexStcsFromRegistry(d1, {
    technology: "air_source_heat_pump",
    installationDate: "2026-08-09",
    postcode: "3000",
    productKey: "cer-ashp:2",
  }, { now: new Date("2026-08-09T22:00:00.000Z") });
  assert.equal(historicalEstimate.resolution.snapshotId, first.snapshotId);
  assert.equal(
    historicalEstimate.resolution.snapshotActivatedAt,
    "2026-08-08T20:45:00.000Z",
  );
  assert.equal(historicalEstimate.resolution.snapshotActivatedOn, "2026-08-09");
  assert.equal(
    historicalEstimate.resolution.registrySourceSha256,
    first.sourceSha256,
  );
  assert.notEqual(historicalEstimate.resolution.snapshotId, current.snapshotId);
  await assert.rejects(
    estimateCreditexStcsFromRegistry(d1, {
      technology: "air_source_heat_pump",
      installationDate: "2026-08-10",
      postcode: "3000",
      productKey: "cer-ashp:2",
    }, { now: new Date("2026-08-09T22:00:00.000Z") }),
    expectedRegistryError("SRES_PRODUCT_INELIGIBLE"),
  );
});

test("a changed product resolves the version effective on the installation date", async () => {
  const { database, d1, artifactStore } = fixture();
  const first = await syncCerSresProductRegistry(d1, {
    fetchImpl: fetchFixture(),
    artifactStore,
    now: new Date("2026-08-08T00:00:00.000Z"),
    references: REFERENCES,
    sources: SOURCES,
  });
  const changed = new Map([
    ["cer-ashp", csvFixture(SOURCES[0], {
      2: "AS51-210HPA-R2",
      8: "40",
    })],
  ]);
  const current = await syncCerSresProductRegistry(d1, {
    fetchImpl: fetchFixture(changed),
    artifactStore,
    now: new Date("2026-08-09T00:00:00.000Z"),
    references: REFERENCES,
    sources: SOURCES,
  });
  assert.deepEqual(
    database.prepare(`SELECT source_record_key, model
      FROM compliance_product_registry_products
      WHERE snapshot_id = ? ORDER BY source_record_key`)
      .all(first.snapshotId)
      .map((row) => ({ ...row })),
    [{
      source_record_key: "cer-ashp:1",
      model: "AS51-210HPA",
    }],
  );
  assert.equal(
    database.prepare(`SELECT count(*) count
      FROM compliance_product_registry_products
      WHERE snapshot_id = ?`).get(current.snapshotId).count,
    3,
  );

  const historicalSearch = await searchCerSresProducts(d1, {
    technology: "air_source_heat_pump",
    installationDate: "2026-08-08",
    query: "210hpa",
    now: new Date("2026-08-09T01:00:00.000Z"),
  });
  const currentSearch = await searchCerSresProducts(d1, {
    technology: "air_source_heat_pump",
    installationDate: "2026-08-09",
    query: "210hpa",
    now: new Date("2026-08-09T01:00:00.000Z"),
  });
  assert.equal(historicalSearch.products.length, 1);
  assert.equal(historicalSearch.products[0].model, "AS51-210HPA");
  assert.equal(currentSearch.products.length, 1);
  assert.equal(currentSearch.products[0].model, "AS51-210HPA-R2");
  const historicalFacets = await searchCerSresProducts(d1, {
    technology: "air_source_heat_pump",
    installationDate: "2026-08-08",
    category: "capacity_at_most_425l",
    brand: "Aestiva",
    cascade: true,
    now: new Date("2026-08-09T01:00:00.000Z"),
  });
  const currentFacets = await searchCerSresProducts(d1, {
    technology: "air_source_heat_pump",
    installationDate: "2026-08-09",
    category: "capacity_at_most_425l",
    brand: "Aestiva",
    cascade: true,
    now: new Date("2026-08-09T01:00:00.000Z"),
  });
  assert.deepEqual(historicalFacets.facets.models, [{
    value: "AS51-210HPA",
    recordCount: 1,
  }]);
  assert.deepEqual(currentFacets.facets.models, [{
    value: "AS51-210HPA-R2",
    recordCount: 1,
  }]);
  assert.deepEqual(historicalFacets.products, []);
  assert.deepEqual(currentFacets.products, []);

  const historicalEstimate = await estimateCreditexStcsFromRegistry(d1, {
    technology: "air_source_heat_pump",
    installationDate: "2026-08-08",
    postcode: "3000",
    productKey: "cer-ashp:1",
  }, { now: new Date("2026-08-09T01:00:00.000Z") });
  const currentEstimate = await estimateCreditexStcsFromRegistry(d1, {
    technology: "air_source_heat_pump",
    installationDate: "2026-08-09",
    postcode: "3000",
    productKey: "cer-ashp:1",
  }, { now: new Date("2026-08-09T01:00:00.000Z") });
  assert.equal(historicalEstimate.resolution.snapshotId, first.snapshotId);
  assert.equal(historicalEstimate.resolution.registeredTenYearStcs, "32");
  assert.deepEqual(historicalEstimate.output, { quantity: "16", unit: "STC" });
  assert.equal(currentEstimate.resolution.snapshotId, current.snapshotId);
  assert.equal(currentEstimate.resolution.registeredTenYearStcs, "40");
  assert.deepEqual(currentEstimate.output, { quantity: "20", unit: "STC" });
});

test("guided product facets are complete beyond 50 and exact filters resolve duplicate records", async () => {
  const { d1, artifactStore } = fixture();
  const individualBrands = Array.from({ length: 61 }, (_, index) => ({
    0: String(1_000 + index),
    1: `Brand ${String(index + 1).padStart(3, "0")}`,
    2: `Solo Model ${String(index + 1).padStart(3, "0")}`,
  }));
  const sharedModels = Array.from({ length: 61 }, (_, index) => ({
    0: String(2_000 + index),
    1: "Shared Brand",
    2: `Shared Model ${String(index + 1).padStart(3, "0")}`,
  }));
  const duplicateExactModel = {
    0: "3001",
    1: "Shared Brand",
    2: "Shared Model 001",
  };
  await syncCerSresProductRegistry(d1, {
    fetchImpl: fetchFixture(new Map([
      ["cer-ashp", multiRowCsvFixture(SOURCES[0], [
        ...individualBrands,
        ...sharedModels,
        duplicateExactModel,
      ])],
    ])),
    artifactStore,
    now: new Date("2026-08-09T00:00:00.000Z"),
    references: REFERENCES,
    sources: SOURCES,
  });

  const initial = await searchCerSresProducts(d1, {
    technology: "air_source_heat_pump",
    installationDate: "2026-08-09",
    cascade: true,
    limit: 1,
    now: new Date("2026-08-09T01:00:00.000Z"),
  });
  assert.deepEqual(initial.facets.categories, [{
    value: "capacity_at_most_425l",
    recordCount: 123,
  }]);
  assert.deepEqual(initial.facets.brands, []);
  assert.deepEqual(initial.facets.models, []);
  assert.deepEqual(initial.products, []);

  const solarWaterHeaterCategories = await searchCerSresProducts(d1, {
    technology: "solar_water_heater",
    installationDate: "2026-08-09",
    cascade: true,
    now: new Date("2026-08-09T01:00:00.000Z"),
  });
  assert.deepEqual(solarWaterHeaterCategories.facets.categories, [
    { value: "capacity_at_least_700l", recordCount: 1 },
    { value: "capacity_less_than_700l", recordCount: 1 },
  ]);
  const smallerSolarWaterHeaters = await searchCerSresProducts(d1, {
    technology: "solar_water_heater",
    installationDate: "2026-08-09",
    category: "capacity_less_than_700l",
    cascade: true,
    now: new Date("2026-08-09T01:00:00.000Z"),
  });
  assert.deepEqual(smallerSolarWaterHeaters.facets.brands, [{
    value: "AAE Solar",
    recordCount: 1,
  }]);

  const brands = await searchCerSresProducts(d1, {
    technology: "air_source_heat_pump",
    installationDate: "2026-08-09",
    category: "capacity_at_most_425l",
    cascade: true,
    limit: 1,
    now: new Date("2026-08-09T01:00:00.000Z"),
  });
  assert.equal(brands.facets.brands.length, 62);
  assert.equal(brands.facets.brands.at(-1).value, "Shared Brand");
  assert.deepEqual(brands.products, []);

  const models = await searchCerSresProducts(d1, {
    technology: "air_source_heat_pump",
    installationDate: "2026-08-09",
    category: "capacity_at_most_425l",
    brand: "Shared Brand",
    cascade: true,
    limit: 1,
    now: new Date("2026-08-09T01:00:00.000Z"),
  });
  assert.equal(models.facets.models.length, 61);
  assert.deepEqual(models.facets.models[0], {
    value: "Shared Model 001",
    recordCount: 2,
  });
  assert.deepEqual(models.products, []);

  const registrations = await searchCerSresProducts(d1, {
    technology: "air_source_heat_pump",
    installationDate: "2026-08-09",
    category: "capacity_at_most_425l",
    brand: "Shared Brand",
    model: "Shared Model 001",
    cascade: true,
    now: new Date("2026-08-09T01:00:00.000Z"),
  });
  assert.deepEqual(
    registrations.products.map(({ sourceItem, sourceRecordKey }) => ({
      sourceItem,
      sourceRecordKey,
    })),
    [
      { sourceItem: "2000", sourceRecordKey: "cer-ashp:2000" },
      { sourceItem: "3001", sourceRecordKey: "cer-ashp:3001" },
    ],
  );
  assert.equal(registrations.matchCount, 2);
});

test("guided exact-product results fail closed instead of silently truncating registrations", async () => {
  const { d1, artifactStore } = fixture();
  const duplicateRecords = Array.from({ length: 501 }, (_, index) => ({
    0: String(4_000 + index),
    1: "Exact Brand",
    2: "Exact Model",
  }));
  await syncCerSresProductRegistry(d1, {
    fetchImpl: fetchFixture(new Map([
      ["cer-ashp", multiRowCsvFixture(SOURCES[0], duplicateRecords)],
    ])),
    artifactStore,
    now: new Date("2026-08-09T00:00:00.000Z"),
    references: REFERENCES,
    sources: SOURCES,
  });

  await assert.rejects(
    searchCerSresProducts(d1, {
      technology: "air_source_heat_pump",
      installationDate: "2026-08-09",
      category: "capacity_at_most_425l",
      brand: "Exact Brand",
      model: "Exact Model",
      cascade: true,
      limit: 500,
      now: new Date("2026-08-09T01:00:00.000Z"),
    }),
    expectedRegistryError("SRES_PRODUCT_MATCH_OVERFLOW"),
  );
});

test("guided product filters reject unknown categories and skipped cascade steps", async () => {
  const { d1, artifactStore } = fixture();
  await syncCerSresProductRegistry(d1, {
    fetchImpl: fetchFixture(),
    artifactStore,
    now: new Date("2026-08-09T00:00:00.000Z"),
    references: REFERENCES,
    sources: SOURCES,
  });
  const common = {
    technology: "air_source_heat_pump",
    installationDate: "2026-08-09",
    cascade: true,
    now: new Date("2026-08-09T01:00:00.000Z"),
  };
  await assert.rejects(
    searchCerSresProducts(d1, {
      ...common,
      category: "capacity_at_least_700l",
    }),
    expectedRegistryError("SRES_PRODUCT_CATEGORY_INVALID"),
  );
  await assert.rejects(
    searchCerSresProducts(d1, { ...common, brand: "Aestiva" }),
    expectedRegistryError("SRES_PRODUCT_FILTER_INVALID"),
  );
  await assert.rejects(
    searchCerSresProducts(d1, {
      ...common,
      category: "capacity_at_most_425l",
      model: "AS51-210HPA",
    }),
    expectedRegistryError("SRES_PRODUCT_FILTER_INVALID"),
  );
});

test("an unchanged current row spans a pruned intermediate snapshot", async () => {
  const { database, d1, artifactStore } = fixture();
  const first = await syncCerSresProductRegistry(d1, {
    fetchImpl: fetchFixture(),
    artifactStore,
    now: new Date("2026-08-08T00:00:00.000Z"),
    references: REFERENCES,
    sources: SOURCES,
  });
  const revisedAshp = csvFixture(SOURCES[0], {
    2: "AS51-210HPA-R2",
    8: "40",
  });
  const intermediate = await syncCerSresProductRegistry(d1, {
    fetchImpl: fetchFixture(new Map([["cer-ashp", revisedAshp]])),
    artifactStore,
    now: new Date("2026-08-09T00:00:00.000Z"),
    references: REFERENCES,
    sources: SOURCES,
  });
  const current = await syncCerSresProductRegistry(d1, {
    fetchImpl: fetchFixture(new Map([
      ["cer-ashp", revisedAshp],
      ["cer-swh-lt-700l", csvFixture(SOURCES[1], {
        2: "ES-250E-20-OP2S-R2",
      })],
    ])),
    artifactStore,
    now: new Date("2026-08-10T00:00:00.000Z"),
    references: REFERENCES,
    sources: SOURCES,
  });

  assert.equal(
    database.prepare(`SELECT count(*) count
      FROM compliance_product_registry_products
      WHERE snapshot_id = ? AND source_record_key = 'cer-ashp:1'`)
      .get(intermediate.snapshotId).count,
    0,
  );
  assert.equal(
    database.prepare(`SELECT count(*) count
      FROM compliance_product_registry_products
      WHERE snapshot_id = ? AND source_record_key = 'cer-ashp:1'`)
      .get(first.snapshotId).count,
    1,
  );

  const beforeChange = await estimateCreditexStcsFromRegistry(d1, {
    technology: "air_source_heat_pump",
    installationDate: "2026-08-08",
    postcode: "3000",
    productKey: "cer-ashp:1",
  }, { now: new Date("2026-08-10T01:00:00.000Z") });
  const duringPrunedSnapshot = await estimateCreditexStcsFromRegistry(d1, {
    technology: "air_source_heat_pump",
    installationDate: "2026-08-09",
    postcode: "3000",
    productKey: "cer-ashp:1",
  }, { now: new Date("2026-08-10T01:00:00.000Z") });
  assert.equal(beforeChange.resolution.snapshotId, first.snapshotId);
  assert.equal(beforeChange.resolution.registeredTenYearStcs, "32");
  assert.equal(duringPrunedSnapshot.resolution.snapshotId, current.snapshotId);
  assert.equal(duringPrunedSnapshot.resolution.registeredTenYearStcs, "40");
});

test("product search and calculation pin product, date, postcode and source snapshot", async () => {
  const { d1, artifactStore } = fixture();
  await syncCerSresProductRegistry(d1, {
    fetchImpl: fetchFixture(),
    artifactStore,
    now: new Date("2026-08-08T00:00:00.000Z"),
    references: REFERENCES,
    sources: SOURCES,
  });
  const search = await searchCerSresProducts(d1, {
    technology: "air_source_heat_pump",
    installationDate: "2026-08-08",
    query: "210hpa",
    now: new Date("2026-08-08T01:00:00.000Z"),
  });
  assert.equal(search.products.length, 1);
  assert.equal(search.products[0].sourceRecordKey, "cer-ashp:1");

  const estimate = await estimateCreditexStcsFromRegistry(d1, {
    technology: "air_source_heat_pump",
    installationDate: "2026-08-08",
    postcode: "3000",
    productKey: "cer-ashp:1",
  }, { now: new Date("2026-08-08T01:00:00.000Z") });
  assert.deepEqual(estimate.output, { quantity: "16", unit: "STC" });
  assert.equal(estimate.resolution.zone, 4);
  assert.equal(estimate.resolution.registeredTenYearStcs, "32");
  assert.equal(estimate.resolution.brand, "Aestiva");
  assert.match(estimate.resolvedReceiptHash, /^sha256:[a-f0-9]{64}$/);
  assert.equal(estimate.certificateActionEnabled, false);

  const waterHeaterQuote = await estimateCreditexSresQuote(d1, {
    estimatePurpose: "quote",
    technology: "air_source_heat_pump",
    installationDate: "2026-08-08",
    postcode: "3000",
    productKey: "cer-ashp:1",
    unitQuantity: "2",
  }, { now: new Date("2026-08-08T01:00:00.000Z") });
  assert.deepEqual(waterHeaterQuote.perUnitOutput, { quantity: "16", unit: "STC" });
  assert.deepEqual(waterHeaterQuote.output, { quantity: "32", unit: "STC" });
  assert.equal(waterHeaterQuote.unitQuantity, "2");
  assert.equal(waterHeaterQuote.resolution.perUnitStcs, "16");
  assert.equal(waterHeaterQuote.resolution.totalStcs, "32");
  assert.equal(waterHeaterQuote.resolution.sourceRecordKey, "cer-ashp:1");
  assert.equal(waterHeaterQuote.eligibilityConfirmed, false);
  assert.equal(waterHeaterQuote.certificateActionEnabled, false);

  const pv = await estimateCreditexStcsFromRegistry(d1, {
    technology: "solar_pv",
    installationDate: "2026-08-08",
    postcode: "3000",
    ratedCapacityKw: "6.6",
  }, { now: new Date("2026-08-08T01:00:00.000Z") });
  assert.deepEqual(pv.output, { quantity: "39", unit: "STC" });
  assert.equal(pv.resolution.zoneRating, "1.185");
  assert.match(pv.resolvedReceiptHash, /^sha256:[a-f0-9]{64}$/);
});

test("schema drift is quarantined without replacing a valid current snapshot", async () => {
  const { database, d1, artifactStore } = fixture();
  const first = await syncCerSresProductRegistry(d1, {
    fetchImpl: fetchFixture(),
    artifactStore,
    now: new Date("2026-08-08T00:00:00.000Z"),
    references: REFERENCES,
    sources: SOURCES,
  });
  const drifted = new Map([
    ["cer-ashp", csvFixture(SOURCES[0]).replace("Item,Brand", "Item,Manufacturer")],
  ]);
  await assert.rejects(
    syncCerSresProductRegistry(d1, {
      fetchImpl: fetchFixture(drifted),
      artifactStore,
      now: new Date("2026-08-08T02:00:00.000Z"),
      references: REFERENCES,
      sources: SOURCES,
    }),
    expectedRegistryError("SRES_PRODUCT_SOURCE_SCHEMA_CHANGED"),
  );
  assert.equal(
    database.prepare(`SELECT id FROM compliance_product_registry_snapshots
      WHERE status = 'current'`).get().id,
    first.snapshotId,
  );
  assert.deepEqual(
    database.prepare(`SELECT status FROM compliance_product_registry_sync_runs
      ORDER BY checked_at`).all().map(({ status }) => status),
    ["success", "failed"],
  );
  const status = await loadCerSresRegistryStatus(d1, {
    now: new Date("2026-08-08T03:00:00.000Z"),
  });
  assert.equal(status.status, "stale");
  assert.equal(status.lastAttempt.status, "failed");
  await assert.rejects(
    estimateCreditexStcsFromRegistry(d1, {
      technology: "solar_pv",
      installationDate: "2026-08-08",
      postcode: "3000",
      ratedCapacityKw: "6.6",
    }, { now: new Date("2026-08-08T03:00:00.000Z") }),
    expectedRegistryError("SRES_PRODUCT_REGISTRY_STALE"),
  );
});

test("changed postcode source bytes immediately quarantine zone calculations", async () => {
  const { database, d1, artifactStore } = fixture();
  const first = await syncCerSresProductRegistry(d1, {
    fetchImpl: fetchFixture(),
    artifactStore,
    now: new Date("2026-08-08T00:00:00.000Z"),
    references: REFERENCES,
    sources: SOURCES,
  });
  const changedReference = new Map([
    ["cer-pv-postcode-zones", "%PDF-1.4 changed official zone table"],
  ]);
  await assert.rejects(
    syncCerSresProductRegistry(d1, {
      fetchImpl: fetchFixture(changedReference),
      artifactStore,
      now: new Date("2026-08-08T04:00:00.000Z"),
      references: REFERENCES,
      sources: SOURCES,
    }),
    expectedRegistryError("SRES_POSTCODE_SOURCE_CHANGED"),
  );
  assert.equal(
    database.prepare(`SELECT id FROM compliance_product_registry_snapshots
      WHERE status = 'current'`).get().id,
    first.snapshotId,
  );
  assert.equal(
    (await loadCerSresRegistryStatus(d1, {
      now: new Date("2026-08-08T04:00:01.000Z"),
    })).status,
    "stale",
  );
});

test("a database lease rejects overlapping registry refreshes", async () => {
  const { d1, artifactStore } = fixture();
  let announceStarted;
  let releaseFetches;
  const started = new Promise((resolve) => {
    announceStarted = resolve;
  });
  const released = new Promise((resolve) => {
    releaseFetches = resolve;
  });
  const fixtureFetch = fetchFixture();
  const blockedFetch = async (input, init) => {
    announceStarted();
    await released;
    return fixtureFetch(input, init);
  };
  const first = syncCerSresProductRegistry(d1, {
    fetchImpl: blockedFetch,
    artifactStore,
    now: new Date("2026-08-08T00:00:00.000Z"),
    references: REFERENCES,
    sources: SOURCES,
  });
  await started;
  await assert.rejects(
    syncCerSresProductRegistry(d1, {
      fetchImpl: fixtureFetch,
      artifactStore,
      now: new Date("2026-08-08T00:00:01.000Z"),
      references: REFERENCES,
      sources: SOURCES,
    }),
    expectedRegistryError("SRES_REFRESH_IN_PROGRESS"),
  );
  releaseFetches();
  await first;
});

test("an expired older refresh cannot replace a newer activated snapshot", async () => {
  const { database, d1, artifactStore } = fixture();
  let announceStarted;
  let releaseOlderFetches;
  const started = new Promise((resolve) => {
    announceStarted = resolve;
  });
  const released = new Promise((resolve) => {
    releaseOlderFetches = resolve;
  });
  const olderFixture = fetchFixture(new Map([
    ["cer-ashp", csvFixture(SOURCES[0], { 2: "AS51-210HPA-OLDER" })],
  ]));
  const blockedOlderFetch = async (input, init) => {
    announceStarted();
    await released;
    return olderFixture(input, init);
  };
  const olderRefresh = syncCerSresProductRegistry(d1, {
    fetchImpl: blockedOlderFetch,
    artifactStore,
    now: new Date("2026-08-08T00:00:00.000Z"),
    references: REFERENCES,
    sources: SOURCES,
  });
  await started;

  const newer = await syncCerSresProductRegistry(d1, {
    fetchImpl: fetchFixture(new Map([
      ["cer-ashp", csvFixture(SOURCES[0], { 2: "AS51-210HPA-NEWER" })],
    ])),
    artifactStore,
    now: new Date("2026-08-08T00:16:00.000Z"),
    references: REFERENCES,
    sources: SOURCES,
  });
  releaseOlderFetches();
  await assert.rejects(olderRefresh, /CHECK constraint failed/);

  const status = await loadCerSresRegistryStatus(d1, {
    now: new Date("2026-08-08T00:17:00.000Z"),
  });
  assert.equal(status.status, "current");
  assert.equal(status.snapshot.id, newer.snapshotId);
  assert.equal(
    database.prepare(`SELECT model
      FROM compliance_product_registry_products
      WHERE snapshot_id = ? AND source_record_key = 'cer-ashp:1'`)
      .get(newer.snapshotId).model,
    "AS51-210HPA-NEWER",
  );
  assert.equal(
    database.prepare(`SELECT COUNT(*) count
      FROM compliance_product_registry_snapshots WHERE status = 'staging'`)
      .get().count,
    0,
  );
});

test("stale or date-ineligible registry data blocks product-backed estimates", async () => {
  const { d1, artifactStore } = fixture();
  await syncCerSresProductRegistry(d1, {
    fetchImpl: fetchFixture(),
    artifactStore,
    now: new Date("2026-08-08T00:00:00.000Z"),
    references: REFERENCES,
    sources: SOURCES,
  });
  await assert.rejects(
    searchCerSresProducts(d1, {
      technology: "air_source_heat_pump",
      installationDate: "2026-08-08",
      cascade: true,
      now: new Date("2026-08-11T00:00:01.000Z"),
    }),
    expectedRegistryError("SRES_PRODUCT_REGISTRY_STALE"),
  );
  await assert.rejects(
    estimateCreditexStcsFromRegistry(d1, {
      technology: "air_source_heat_pump",
      installationDate: "2026-08-08",
      postcode: "3000",
      productKey: "cer-ashp:1",
    }, { now: new Date("2026-08-11T00:00:01.000Z") }),
    expectedRegistryError("SRES_PRODUCT_REGISTRY_STALE"),
  );
  await assert.rejects(
    estimateCreditexStcsFromRegistry(d1, {
      technology: "air_source_heat_pump",
      installationDate: "2031-01-01",
      postcode: "3000",
      productKey: "cer-ashp:1",
    }, { now: new Date("2026-08-08T01:00:00.000Z") }),
    expectedRegistryError("SRES_PRODUCT_INELIGIBLE"),
  );
});

test("protected APIs, daily Worker and UI enforce server-derived registry values", () => {
  assert.match(
    productRouteSource,
    /requireCreditexCalculatorAccess\(request, database, \{\s*allowPublicQuote: true,\s*\}\)/,
  );
  assert.match(productRouteSource, /requireComplianceAccess\(request/);
  assert.match(productRouteSource, /allowedRoles: \["admin"\]/);
  assert.match(productRouteSource, /syncCerSresProductRegistry\(database, \{/);
  assert.match(productRouteSource, /refresh-reviewed-decrease/);
  assert.match(productRouteSource, /access\.governanceIdentityVerified !== true/);
  assert.match(productRouteSource, /reviewedCountDecrease,/);
  assert.match(productRouteSource, /"Cache-Control": "private, no-store"/);
  assert.match(productRouteSource, /category: parameters\.get\("category"\)/);
  assert.match(productRouteSource, /brand: parameters\.get\("brand"\)/);
  assert.match(productRouteSource, /model: parameters\.get\("model"\)/);
  assert.match(productRouteSource, /parameters\.get\("mode"\) === "cascade"/);
  assert.match(estimateRouteSource, /estimateCreditexStcsFromRegistry\(database, body\)/);
  assert.match(
    estimateRouteSource,
    /allowPublicQuote: estimatePurpose === "quote"/,
  );
  assert.match(workerSource, /SRES_REGISTRY_CRON/);
  assert.match(workerSource, /syncCerSresProductRegistry\(db, \{ artifactStore \}\)/);
  assert.match(calculatorSource, /Product type/);
  assert.match(calculatorSource, /Brand/);
  assert.match(calculatorSource, /Model/);
  assert.match(calculatorSource, /Approval/);
  assert.match(calculatorSource, /productCascade\.productKey/);
  assert.doesNotMatch(calculatorSource, /Find approved product/);
  assert.doesNotMatch(calculatorSource, /productQuery/);
  assert.match(calculatorSource, /function renderPostcode/);
  assert.match(calculatorSource, />\s*Postcode\s*</);
  assert.match(calculatorSource, /estimateRequestRef\.current === requestVersion/);
  assert.match(calculatorSource, /function updateForm/);
  assert.match(calculatorSource, /const markRegistryUnverified = useCallback/);
  assert.match(calculatorSource, /registeredTechnology\(form\.technology\)/);
  assert.match(calculatorSource, /aria-live="polite"/);
  assert.match(calculatorSource, /role="alert"/);
  assert.doesNotMatch(calculatorSource, /registeredTenYearStcs:/);
  assert.doesNotMatch(calculatorSource, /zoneRating:/);
});

test("live CER product exports satisfy the controlled ingestion contract", {
  skip: process.env.CREDITEX_LIVE_CER !== "1",
}, async () => {
  const { database, d1, artifactStore } = fixture();
  const result = await syncCerSresProductRegistry(d1, {
    artifactStore,
    now: new Date(),
  });
  assert.equal(result.changed, true);
  assert.ok(result.recordCount > 10_000);
  assert.equal(
    database.prepare(`SELECT COUNT(*) count
      FROM compliance_product_registry_source_artifacts`).get().count,
    5,
  );
  assert.equal(
    database.prepare(`SELECT COUNT(*) count
      FROM compliance_product_registry_products`).get().count,
    result.recordCount,
  );
});
