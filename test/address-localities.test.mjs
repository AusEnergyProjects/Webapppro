import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import test from "node:test";
import {
  ADDRESS_LOCALITY_SOURCE,
  addressLocalitiesForPostcode,
  resolveAddressLocalityTuple,
} from "../src/lib/address-localities.mjs";
import { addressLocalitiesGet } from "../src/lib/address-localities-route.mjs";

const artifactUrl = new URL("../src/data/postcode-localities.json", import.meta.url);
const artifactBytes = fs.readFileSync(artifactUrl);
const artifact = JSON.parse(artifactBytes.toString("utf8"));

test("the pinned address-locality artifact cannot drift silently", () => {
  const sha256 = createHash("sha256").update(artifactBytes).digest("hex");
  const tupleCount = Object.values(artifact)
    .reduce((count, localities) => count + localities.length, 0);
  assert.equal(sha256, ADDRESS_LOCALITY_SOURCE.artifactSha256);
  assert.equal(sha256, "1d75e7645d79c50ec117fe7776ed88d761b5e64f474a6448af74ef60697f074c");
  assert.equal(Object.keys(artifact).length, 2_644);
  assert.equal(tupleCount, 16_236);
  assert.equal(ADDRESS_LOCALITY_SOURCE.sourceCommit, "7874021a281bad87d8cd234a7d8f82d18f279fcc");
  assert.equal(ADDRESS_LOCALITY_SOURCE.sourceSha256, "9120ed3f90b5dbfa12186ea11f19852f98b556e07c2cb3df5f93d1b97830bff8");
});

test("Melbourne and cross-state postcodes expose and resolve exact locality-state tuples", () => {
  assert.deepEqual(resolveAddressLocalityTuple({
    postcode: "3000",
    suburb: "melbourne",
    state: "vic",
  }), { postcode: "3000", suburb: "MELBOURNE", state: "VIC" });

  const crossBorder = addressLocalitiesForPostcode("0872");
  assert.ok(crossBorder);
  assert.deepEqual(
    [...new Set(crossBorder.localities.map(({ state }) => state))].sort(),
    ["NT", "SA", "WA"],
  );

  assert.deepEqual(resolveAddressLocalityTuple({
    postcode: "2406",
    suburb: "MUNGINDI",
    state: "NSW",
  }), { postcode: "2406", suburb: "MUNGINDI", state: "NSW" });
  assert.deepEqual(resolveAddressLocalityTuple({
    postcode: "2406",
    suburb: "MUNGINDI",
    state: "QLD",
  }), { postcode: "2406", suburb: "MUNGINDI", state: "QLD" });
  assert.equal(resolveAddressLocalityTuple({
    postcode: "2406",
    suburb: "MUNGINDI",
    state: "VIC",
  }), null);
});

test("unknown and fictitious source tuples fail closed", () => {
  assert.equal(addressLocalitiesForPostcode("9999"), null);
  assert.equal(addressLocalitiesForPostcode("0000"), null);
  assert.equal(resolveAddressLocalityTuple({
    postcode: "3000",
    suburb: "MELBOURNE",
    state: "NSW",
  }), null);
});

test("the public locality route is dependency-light and returns no-store JSON", async () => {
  const route = fs.readFileSync(
    new URL("../src/lib/address-localities-route.mjs", import.meta.url),
    "utf8",
  );
  assert.match(route, /Response\.json/);
  assert.match(route, /"Cache-Control": "no-store"/);
  assert.match(route, /sameOrigin\(request\)/);
  assert.doesNotMatch(route, /admin-server|getD1|firebase/i);

  const noOrigin = await addressLocalitiesGet(new Request(
    "https://compare.example/api/address-localities?postcode=3000",
  ));
  assert.equal(noOrigin.status, 200);
  assert.equal(noOrigin.headers.get("cache-control"), "no-store");
  assert.deepEqual(await noOrigin.json(), {
    ok: true,
    postcode: "3000",
    localities: addressLocalitiesForPostcode("3000").localities,
  });

  const sameOrigin = await addressLocalitiesGet(new Request(
    "https://compare.example/api/address-localities?postcode=0872",
    { headers: { Origin: "https://compare.example" } },
  ));
  assert.equal(sameOrigin.status, 200);
  const crossBorder = await sameOrigin.json();
  assert.deepEqual(
    [...new Set(crossBorder.localities.map(({ state }) => state))].sort(),
    ["NT", "SA", "WA"],
  );

  const crossOrigin = await addressLocalitiesGet(new Request(
    "https://compare.example/api/address-localities?postcode=3000",
    { headers: { Origin: "https://attacker.example" } },
  ));
  assert.equal(crossOrigin.status, 403);

  const fictitious = await addressLocalitiesGet(new Request(
    "https://compare.example/api/address-localities?postcode=9999",
  ));
  assert.equal(fictitious.status, 400);
  assert.deepEqual(await fictitious.json(), {
    ok: false,
    error: "Enter a recognised four digit Australian delivery-area postcode.",
    postcode: "",
    localities: [],
  });
});
