import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  CREDITEX_PRODUCT_KIND_REGISTRY,
  CREDITEX_SRES_OFFICIAL_PRODUCT_KINDS,
  officialProductKindsForLocalActivity,
} from "../src/lib/creditex-official-product-registry.ts";
import {
  resolveCerSresOfficialProduct,
  searchCerSresOfficialProducts,
} from "../src/lib/creditex-sres-registry-server.ts";

const sresMigration = fs.readFileSync(new URL(
  "../drizzle/0124_creditex_sres_product_registry.sql",
  import.meta.url,
), "utf8");
const genericMigration = fs.readFileSync(new URL(
  "../drizzle/0125_creditex_official_product_registry.sql",
  import.meta.url,
), "utf8");
const refreshQueueMigration = fs.readFileSync(new URL(
  "../drizzle/0148_creditex_official_product_refresh_requests.sql",
  import.meta.url,
), "utf8");
const streamStagingMigration = fs.readFileSync(new URL(
  "../drizzle/0149_creditex_official_product_stream_staging.sql",
  import.meta.url,
), "utf8");

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

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

const PRODUCT_SOURCES = [
  {
    sourceKey: "cer-ashp",
    technology: "air_source_heat_pump",
    category: "capacity_at_most_425l",
    url: "https://cer.gov.au/document/air-source-heat-pump-models",
    metadataUrl: "https://cer.gov.au/document/air-source-heat-pump-models-0",
    recordCount: 1,
  },
  {
    sourceKey: "cer-swh-lt-700l",
    technology: "solar_water_heater",
    category: "capacity_less_than_700l",
    url: "https://cer.gov.au/document/solar-water-heater-models-capacity-less-700l",
    metadataUrl: "https://cer.gov.au/document/solar-water-heater-models-capacity-less-700l-0",
    recordCount: 0,
  },
  {
    sourceKey: "cer-swh-ge-700l",
    technology: "solar_water_heater",
    category: "capacity_at_least_700l",
    url: "https://cer.gov.au/document/solar-water-heater-models-capacity-more-700l",
    metadataUrl: "https://cer.gov.au/document/solar-water-heater-models-capacity-more-700l-0",
    recordCount: 0,
  },
];

const REFERENCE_SOURCES = [
  {
    sourceKey: "cer-swh-ashp-postcode-zones",
    url: "https://cer.gov.au/document/postcode-zones-solar-water-heaters-and-heat-pumps",
  },
  {
    sourceKey: "cer-pv-postcode-zones",
    url: "https://cer.gov.au/document/postcode-zone-ratings-and-zones-solar-panel-systems",
  },
];

function custodyKey(sourceKey, sourceSha256, extension) {
  return `creditex/official-sources/cer_sres_swh/${sourceKey}/${sourceSha256}.${extension}`;
}

function fixtureDatabase({ mismatchAshpArtifact = false } = {}) {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(sresMigration);
  sqlite.exec(genericMigration);
  sqlite.exec(refreshQueueMigration);
  sqlite.exec(streamStagingMigration);
  const snapshotId = "snapshot-adapter-20260815";
  const createdAt = "2026-08-15T00:00:00.000Z";
  const activatedAt = "2026-08-15T00:01:00.000Z";
  const artifacts = [...PRODUCT_SOURCES, ...REFERENCE_SOURCES].map((source) => {
    const sourceSha256 = sha256(`source:${source.sourceKey}`);
    const productSource = "technology" in source;
    return {
      ...source,
      sourceSha256,
      contentType: productSource ? "text/csv" : "application/pdf",
      byteLength: productSource ? 321 : 654,
      recordCount: source.recordCount || 0,
      objectKey: custodyKey(
        source.sourceKey,
        sourceSha256,
        productSource ? "csv" : "pdf",
      ),
    };
  });
  const manifest = {
    contract: "creditex-sres-official-registry/v1",
    registryCode: "cer_sres_swh",
    registerRelease: {
      registerUrl: "https://cer.gov.au/schemes/renewable-energy-target/small-scale-renewable-energy-scheme/small-scale-renewable-energy-systems/solar-water-heaters/register-solar-water-heaters",
      version: 58,
      publishedOn: "2026-08-10",
    },
    sources: artifacts.map((artifact) => "technology" in artifact
      ? {
          sourceKey: artifact.sourceKey,
          technology: artifact.technology,
          category: artifact.category,
          registerMetadata: {
            url: artifact.metadataUrl,
            contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            byteLength: 222,
            sha256: sha256(`metadata:${artifact.sourceKey}`),
            objectKey: custodyKey(
              `${artifact.sourceKey}-register-metadata`,
              sha256(`metadata:${artifact.sourceKey}`),
              "xlsx",
            ),
          },
          url: artifact.url,
          contentType: artifact.contentType,
          byteLength: artifact.byteLength,
          recordCount: artifact.recordCount,
          sha256: artifact.sourceSha256,
          objectKey: artifact.objectKey,
        }
      : {
          sourceKey: artifact.sourceKey,
          referenceType: "postcode_zone_map",
          url: artifact.url,
          contentType: artifact.contentType,
          byteLength: artifact.byteLength,
          recordCount: artifact.recordCount,
          sha256: artifact.sourceSha256,
          objectKey: artifact.objectKey,
        }),
  };
  const manifestJson = JSON.stringify(manifest);
  const snapshotSha256 = sha256(manifestJson);
  sqlite.prepare(`INSERT INTO compliance_product_registry_snapshots (
      id, registry_code, contract, source_manifest_json, source_sha256,
      record_count, status, created_at, activated_at, activated_on,
      superseded_at, superseded_on
    ) VALUES (?, 'cer_sres_swh', 'creditex-sres-official-registry/v1', ?, ?,
      1, 'current', ?, ?, '2026-08-15', NULL, NULL)`)
    .run(snapshotId, manifestJson, snapshotSha256, createdAt, activatedAt);
  for (const artifact of artifacts) {
    const storedSha256 = mismatchAshpArtifact && artifact.sourceKey === "cer-ashp"
      ? sha256("different-retained-source")
      : artifact.sourceSha256;
    sqlite.prepare(`INSERT INTO compliance_product_registry_source_artifacts (
        id, snapshot_id, source_key, source_url, source_sha256, content_type,
        byte_length, record_count, object_key, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(
        `${snapshotId}:${artifact.sourceKey}`,
        snapshotId,
        artifact.sourceKey,
        artifact.url,
        storedSha256,
        artifact.contentType,
        artifact.byteLength,
        artifact.recordCount,
        artifact.objectKey,
        createdAt,
      );
  }
  sqlite.prepare(`INSERT INTO compliance_product_registry_products (
      id, snapshot_id, source_record_key, source_item, technology, category,
      brand, model, search_text, eligible_from, eligible_to,
      zone_1_stcs, zone_2_stcs, zone_3_stcs, zone_4_stcs, zone_5_stcs
    ) VALUES ('adapter-product-863', ?, 'cer-ashp:863', '863',
      'air_source_heat_pump', 'capacity_at_most_425l', 'Rinnai',
      'KSHP250M24L70', 'rinnai kshp250m24l70', '2024-10-31', '2030-12-31',
      26, 25, 31, 33, 33)`)
    .run(snapshotId);
  sqlite.prepare(`INSERT INTO compliance_product_registry_sync_runs (
      id, registry_code, status, snapshot_id, source_manifest_json,
      source_sha256, record_count, checked_at, message
    ) VALUES ('adapter-sync-20260815', 'cer_sres_swh', 'success', ?, ?, ?, 1,
      '2026-08-15T00:05:00.000Z', '')`)
    .run(snapshotId, manifestJson, snapshotSha256);
  return { sqlite, database: testD1(sqlite), snapshotId, snapshotSha256, artifacts };
}

test("SRES official product kinds bind only to the canonical 0124 registry", () => {
  assert.deepEqual(CREDITEX_SRES_OFFICIAL_PRODUCT_KINDS, [
    "sres_air_source_heat_pump",
    "sres_solar_water_heater",
  ]);
  assert.equal(CREDITEX_PRODUCT_KIND_REGISTRY.sres_air_source_heat_pump, "cer_sres_swh");
  assert.equal(CREDITEX_PRODUCT_KIND_REGISTRY.sres_solar_water_heater, "cer_sres_swh");
  assert.deepEqual(officialProductKindsForLocalActivity("SRES", "ASHP"), [
    "sres_air_source_heat_pump",
  ]);
  assert.deepEqual(officialProductKindsForLocalActivity("SRES", "SWH"), [
    "sres_solar_water_heater",
  ]);
});

test("canonical SRES adapter returns exact effective product and source custody", async () => {
  const fixture = fixtureDatabase();
  try {
    const now = new Date("2026-08-15T01:00:00.000Z");
    const product = await resolveCerSresOfficialProduct(fixture.database, {
      productKind: "sres_air_source_heat_pump",
      productKey: "cer-ashp:863",
      installationDate: "2026-08-15",
      now,
    });
    const ashpArtifact = fixture.artifacts.find(({ sourceKey }) =>
      sourceKey === "cer-ashp"
    );
    assert.equal(product.snapshotId, fixture.snapshotId);
    assert.equal(product.snapshotSourceSha256, fixture.snapshotSha256);
    assert.equal(product.sourceArtifact.sourceSha256, ashpArtifact.sourceSha256);
    assert.notEqual(product.snapshotSourceSha256, product.sourceArtifact.sourceSha256);
    assert.equal(product.sourceArtifact.sourceKey, "cer-ashp");
    assert.equal("objectKey" in product.sourceArtifact, false);
    assert.deepEqual(product.registrationIdentity, {
      registryCode: "cer_sres_swh",
      sourceKey: "cer-ashp",
      sourceRecordKey: "cer-ashp:863",
      sourceItem: "863",
    });
    assert.deepEqual(product.registeredTenYearStcs, {
      zone1: 26,
      zone2: 25,
      zone3: 31,
      zone4: 33,
      zone5: 33,
    });
    const search = await searchCerSresOfficialProducts(fixture.database, {
      productKind: "sres_air_source_heat_pump",
      installationDate: "2026-08-15",
      query: "kshp250m24l70",
      limit: 10,
      now,
    });
    assert.equal(search.productKind, "sres_air_source_heat_pump");
    assert.equal(search.products.length, 1);
    assert.equal(search.products[0].sourceRecordKey, "cer-ashp:863");
  } finally {
    fixture.sqlite.close();
  }
});

test("canonical SRES adapter fails closed on custody mismatch and stale registry", async () => {
  const mismatch = fixtureDatabase({ mismatchAshpArtifact: true });
  try {
    await assert.rejects(
      resolveCerSresOfficialProduct(mismatch.database, {
        productKind: "sres_air_source_heat_pump",
        productKey: "cer-ashp:863",
        installationDate: "2026-08-15",
        now: new Date("2026-08-15T01:00:00.000Z"),
      }),
      (error) => error?.code === "SRES_REGISTRY_INTEGRITY_FAILED",
    );
  } finally {
    mismatch.sqlite.close();
  }
  const stale = fixtureDatabase();
  try {
    await assert.rejects(
      resolveCerSresOfficialProduct(stale.database, {
        productKind: "sres_air_source_heat_pump",
        productKey: "cer-ashp:863",
        installationDate: "2026-08-15",
        now: new Date("2026-08-17T00:06:00.000Z"),
      }),
      (error) => error?.code === "SRES_PRODUCT_REGISTRY_STALE",
    );
  } finally {
    stale.sqlite.close();
  }
});
