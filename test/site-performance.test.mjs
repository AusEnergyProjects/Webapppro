import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const worker = read("../worker/index.ts");
const gasRoute = read("../src/app/api/gas-plans/route.ts");
const gasComparator = read("../src/components/GasComparator.tsx");
const electricityComparator = read("../src/components/electricity/NativeElectricityComparator.tsx");

test("HTML shell caching is short lived and never includes API routes", () => {
  assert.match(worker, /request\.method !== "GET"/);
  assert.match(worker, /url\.pathname\.startsWith\("\/api\/"\)/);
  assert.match(worker, /includes\("text\/html"\)/);
  assert.match(worker, /caches\.default/);
  assert.match(worker, /s-maxage=120/);
  assert.match(worker, /stale-while-revalidate=600/);
  assert.match(worker, /ctx\.waitUntil\(cache\.put/);
});

test("gas comparison bounds slow upstream calls and reuses successful results", () => {
  assert.match(gasRoute, /UPSTREAM_TIMEOUT_MS = 10_000/);
  assert.match(gasRoute, /AbortSignal\.timeout\(UPSTREAM_TIMEOUT_MS\)/);
  assert.match(gasRoute, /MEMORY_TTL_MS = 60 \* 60 \* 1000/);
  assert.match(gasRoute, /planCache\.get\(cacheKey\)/);
  assert.match(gasRoute, /cache: "memory_hit"/);
  assert.match(gasRoute, /planCache\.set\(cacheKey/);
});

test("comparison interfaces recover from slow requests and defer result imagery", () => {
  assert.match(gasComparator, /controller\.abort\(\), 25_000/);
  assert.match(electricityComparator, /controller\.abort\(\), 25_000/);
  assert.match(gasComparator, /signal: controller\.signal/);
  assert.match(electricityComparator, /signal: controller\.signal/);
  assert.match(gasComparator, /loading="lazy" decoding="async"/);
  assert.match(electricityComparator, /loading="lazy" decoding="async"/);
});
