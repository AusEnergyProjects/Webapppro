import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { closestQualifyingTradeServiceArea } from "../src/lib/trade-service-area-matching.mjs";

const opportunityServer = fs.readFileSync(
  new URL("../src/lib/opportunity-server.ts", import.meta.url),
  "utf8",
);
const schema = fs.readFileSync(new URL("../db/schema.ts", import.meta.url), "utf8");
const migration = fs.readFileSync(
  new URL("../drizzle/0126_public_trade_lead_contact_release.sql", import.meta.url),
  "utf8",
);

const distances = new Map([
  ["3000:3350", 105],
  ["3220:3350", 42],
  ["3121:3350", 118],
]);

function distanceBetween(origin, destination) {
  return distances.get(`${origin}:${destination}`) ?? null;
}

test("a lead outside area one but inside area two is included using the nearest qualifying area", () => {
  const match = closestQualifyingTradeServiceArea({
    activeServiceAreas: JSON.stringify([
      { postcode: "3000", radiusKm: 50 },
      { postcode: "3220", radiusKm: 50 },
    ]),
    legacyPostcode: "3121",
    legacyRadiusKm: 200,
    destinationPostcode: "3350",
  }, distanceBetween);
  assert.deepEqual(match, {
    postcode: "3220",
    radiusKm: 50,
    distanceKm: 42,
  });
});

test("a lead outside every active area is excluded even when the legacy primary area would match", () => {
  const match = closestQualifyingTradeServiceArea({
    activeServiceAreas: JSON.stringify([
      { postcode: "3000", radiusKm: 50 },
      { postcode: "3220", radiusKm: 40 },
    ]),
    legacyPostcode: "3121",
    legacyRadiusKm: 200,
    destinationPostcode: "3350",
  }, distanceBetween);
  assert.equal(match, null);
});

test("legacy service radius is used only when no active service areas exist", () => {
  const match = closestQualifyingTradeServiceArea({
    activeServiceAreas: "[]",
    legacyPostcode: "3121",
    legacyRadiusKm: 120,
    destinationPostcode: "3350",
  }, distanceBetween);
  assert.deepEqual(match, {
    postcode: "3121",
    radiusKm: 120,
    distanceKm: 118,
  });
});

test("an invalid active area does not silently fall back to legacy coverage", () => {
  const match = closestQualifyingTradeServiceArea({
    activeServiceAreas: JSON.stringify([{ postcode: "bad", radiusKm: 500 }]),
    legacyPostcode: "3121",
    legacyRadiusKm: 120,
    destinationPostcode: "3350",
  }, distanceBetween);
  assert.equal(match, null);
});

test("opportunity allocation loads every active saved service area", () => {
  assert.match(opportunityServer, /FROM trade_account_service_areas service_area/);
  assert.match(opportunityServer, /service_area\.record_status = 'active'/);
  assert.match(opportunityServer, /closestQualifyingTradeServiceArea/);
});

test("fairness and active-assignment lookups have exact supporting indexes", () => {
  for (const indexName of [
    "trade_opportunity_matches_firebase_matched_idx",
    "trade_opportunity_matches_firebase_status_opportunity_idx",
  ]) {
    assert.match(schema, new RegExp(indexName));
    assert.match(migration, new RegExp("CREATE INDEX `" + indexName + "`"));
  }
  assert.match(migration, /\(`firebase_uid`, `matched_at`\)/);
  assert.match(migration, /\(`firebase_uid`, `status`, `opportunity_id`\)/);
});
