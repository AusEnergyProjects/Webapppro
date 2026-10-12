import assert from "node:assert/strict";
import test from "node:test";
import { energyCdrCacheOptions } from "../src/lib/energy-cdr-cache.mjs";

test("public upstream caching is short-lived and excludes failed responses", () => {
  const options = energyCdrCacheOptions("https://cdr.example/energy/plans", "3");
  assert.equal(options.cacheEverything, true);
  assert.equal(options.cacheTtlByStatus["200-299"], 300);
  assert.equal(options.cacheTtlByStatus["300-599"], -1);
});

test("cache identities retain fuel, paging and negotiated API version", () => {
  const base = "https://cdr.example/energy/plans?fuelType=ELECTRICITY&page=1";
  const v1 = energyCdrCacheOptions(base, "1").cacheKey;
  const v3 = energyCdrCacheOptions(base, "3").cacheKey;
  assert.notEqual(v1, v3);
  assert.notEqual(v1, energyCdrCacheOptions(base.replace("ELECTRICITY", "GAS"), "1").cacheKey);
  assert.notEqual(v1, energyCdrCacheOptions(base.replace("page=1", "page=2"), "1").cacheKey);
  assert.equal(new URL(v1).searchParams.get("__aea_cdr_version"), "1");
  assert.equal(new URL(energyCdrCacheOptions(base).cacheKey).searchParams.get("__aea_cdr_version"), "directory");
});
