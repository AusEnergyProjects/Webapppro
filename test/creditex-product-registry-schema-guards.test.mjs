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
const worker = fs.readFileSync(
  new URL("../worker/index.ts", import.meta.url),
  "utf8",
);

test("Sites-safe product registry migrations contain no trigger bodies", () => {
  assert.doesNotMatch(sresMigration, /CREATE\s+TRIGGER/i);
  assert.doesNotMatch(officialMigration, /CREATE\s+TRIGGER/i);
  assert.match(
    `${sresMigration}\n${officialMigration}`,
    /triggers are installed through the D1 prepared-statement schema guard/g,
  );
});

test("all product registry trigger guards have one unique prepared statement", () => {
  assert.equal(CREDITEX_SRES_PRODUCT_REGISTRY_SCHEMA_GUARDS.length, 14);
  assert.equal(CREDITEX_OFFICIAL_PRODUCT_REGISTRY_SCHEMA_GUARDS.length, 14);
  const guards = [
    ...CREDITEX_SRES_PRODUCT_REGISTRY_SCHEMA_GUARDS,
    ...CREDITEX_OFFICIAL_PRODUCT_REGISTRY_SCHEMA_GUARDS,
  ];
  assert.equal(new Set(guards.map((guard) => guard.name)).size, guards.length);
  assert.ok(guards.every((guard) => guard.sql.startsWith("CREATE TRIGGER ")));
  assert.ok(guards.every((guard) => guard.sql.endsWith("END;")));
});

test("scheduled registry refresh installs guards before either sync", () => {
  assert.match(
    worker,
    /ensureCreditexProductRegistrySchemaGuards\(db\)[\s\S]*syncCerSresProductRegistry/,
  );
  assert.match(
    worker,
    /ensureCreditexProductRegistrySchemaGuards\(db\)[\s\S]*CREDITEX_AUTOMATIC_PRODUCT_REGISTRIES/,
  );
});
