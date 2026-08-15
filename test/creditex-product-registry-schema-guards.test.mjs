import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  CREDITEX_OFFICIAL_PRODUCT_REGISTRY_SCHEMA_GUARDS,
  CREDITEX_SRES_PRODUCT_REGISTRY_SCHEMA_GUARDS,
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
const refreshProgressMigration = fs.readFileSync(
  new URL(
    "../drizzle/0150_creditex_official_product_refresh_progress.sql",
    import.meta.url,
  ),
  "utf8",
);
const sourceAcquisitionMigration = fs.readFileSync(
  new URL(
    "../drizzle/0151_creditex_official_product_source_acquisition.sql",
    import.meta.url,
  ),
  "utf8",
);
const worker = fs.readFileSync(
  new URL("../worker/index.ts", import.meta.url),
  "utf8",
);
const maintenance = fs.readFileSync(
  new URL(
    "../src/lib/creditex-product-registry-maintenance.ts",
    import.meta.url,
  ),
  "utf8",
);

test("Sites-safe product registry migrations contain no trigger bodies", () => {
  assert.doesNotMatch(sresMigration, /CREATE\s+TRIGGER/i);
  assert.doesNotMatch(officialMigration, /CREATE\s+TRIGGER/i);
  assert.doesNotMatch(refreshQueueMigration, /CREATE\s+TRIGGER/i);
  assert.doesNotMatch(streamStagingMigration, /CREATE\s+TRIGGER/i);
  assert.doesNotMatch(refreshProgressMigration, /CREATE\s+TRIGGER/i);
  assert.doesNotMatch(sourceAcquisitionMigration, /CREATE\s+TRIGGER/i);
  assert.match(
    streamStagingMigration,
    /CREATE TABLE `compliance_official_product_stream_values`/,
  );
  assert.match(
    refreshProgressMigration,
    /CREATE TABLE `compliance_official_product_refresh_progress`/,
  );
  assert.match(
    sourceAcquisitionMigration,
    /CREATE TABLE `compliance_official_product_source_acquisitions`/,
  );
  assert.match(
    sourceAcquisitionMigration,
    /CREATE TABLE `compliance_official_product_source_acquisition_streams`/,
  );
  assert.match(
    sourceAcquisitionMigration,
    /CREATE TABLE `compliance_official_product_source_acquisition_fragments`/,
  );
  assert.match(
    refreshProgressMigration,
    /CREATE UNIQUE INDEX `compliance_official_product_snapshots_staging_idx`/,
  );
  assert.match(
    `${sresMigration}\n${officialMigration}`,
    /triggers are installed through the D1 prepared-statement schema guard/g,
  );
});

test("all product registry trigger guards have one unique prepared statement", () => {
  assert.equal(CREDITEX_SRES_PRODUCT_REGISTRY_SCHEMA_GUARDS.length, 14);
  assert.equal(CREDITEX_OFFICIAL_PRODUCT_REGISTRY_SCHEMA_GUARDS.length, 20);
  const guards = [
    ...CREDITEX_SRES_PRODUCT_REGISTRY_SCHEMA_GUARDS,
    ...CREDITEX_OFFICIAL_PRODUCT_REGISTRY_SCHEMA_GUARDS,
  ];
  assert.equal(new Set(guards.map((guard) => guard.name)).size, guards.length);
  assert.ok(guards.every((guard) => guard.sql.startsWith("CREATE TRIGGER ")));
  assert.ok(guards.every((guard) => guard.sql.endsWith("END;")));
});

test("scheduled registry refresh installs guards before either sync", () => {
  assert.match(worker, /drainCreditexProductRegistryMaintenance\(/);
  assert.match(worker, /creditexAutomaticProductRegistryMaintenanceTargets\(/);
  assert.match(maintenance, /ensureCreditexProductRegistrySchemaGuards/);
  assert.match(maintenance, /syncCerSresProductRegistry/);
  assert.match(maintenance, /syncOfficialProductRegistry/);
});
