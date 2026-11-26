import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";
import {
  CREDITEX_COMPLETE_REGISTER_TIMEOUT_MS,
  creditexProductRegistryRefreshDue,
  creditexRequiresCompleteRegisterImport,
} from "../src/lib/creditex-product-registry-maintenance.ts";

const source = fs.readFileSync(new URL("../src/app/api/creditex/official-products/route.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const dispatchHeader = "X-AEA-Creditex-Product-Registry-Dispatch";
const registryCode = "veu-approved-products";

function fixture({ status = "stale", failed = true, queued = true, due = true, concurrentFutureRetry = false,
  continuationCode = registryCode, finishDuringWait = false } = {}) {
  const calls = [];
  const now = new Date();
  const registry = {
    registryCode, status, snapshotId: "accepted", recordCount: 76495,
    sourceSha256: "a".repeat(64), freshnessWindowHours: 48,
    lastCheckedAt: new Date(now.getTime() - (status === "current" ? 0 : 72 * 60 * 60 * 1000)).toISOString(),
    lastAttempt: { status: failed ? "failed" : "success", checkedAt: now.toISOString(), message: "" },
  };
  const result = { registry, products: [{ id: "accepted-product" }], brands: [], models: [] };
  const database = {};
  const targets = [{ registryCode: continuationCode }];
  const mocks = {
    "cloudflare:workers": { env: {} },
    "../../../../../db": { getD1: () => database },
    "@/lib/bounded-json-request": { BoundedJsonRequestError: class extends Error {} },
    "@/lib/compliance-access-server": { ComplianceAccessError: class extends Error {} },
    "@/lib/creditex-calculator-access-server": {
      CreditexCalculatorAccessError: class extends Error {},
      requireCreditexCalculatorAccess: async () => ({ accessType: "compliance" }),
    },
    "@/lib/creditex-calculator-route-response": {
      projectCreditexCalculatorReadResponse: (_access, value) => value,
      describeCreditexCalculatorRouteError: () => null,
    },
    "@/lib/creditex-official-product-registry": { CreditexOfficialProductError: class extends Error {} },
    "@/lib/creditex-official-product-registry-server": {
      searchOfficialProducts: async () => result,
    },
    "@/lib/creditex-official-product-registry-definitions": { creditexAutomaticProductRegistries: () => targets },
    "@/lib/creditex-sres-registry-server": {},
    "@/lib/creditex-product-registry-maintenance": {
      CREDITEX_PRODUCT_REGISTRY_DISPATCH_HEADER: dispatchHeader,
      CREDITEX_COMPLETE_REGISTER_TIMEOUT_MS,
      creditexProductRegistryRefreshDue,
      creditexRequiresCompleteRegisterImport,
      creditexAutomaticProductRegistryMaintenanceTargets: () => targets,
      maintainNextCreditexProductRegistry: async (options) => {
        assert.deepEqual(options, { database, preferredRegistryCode: continuationCode, queuedOnly: true,
          returnScheduledFailures: true, scheduledOperationTimeoutMs: 120_000, targets });
        calls.push("maintain");
        if (finishDuringWait) { queued = false; due = false; }
      },
      hasDueCreditexProductRegistryRefreshRequest: async (db, codes) => {
        assert.equal(db, database); assert.deepEqual(codes, [continuationCode]);
        calls.push("due"); return queued && due;
      },
      hasQueuedCreditexProductRegistryRefreshRequest: async (db, codes) => {
        assert.equal(db, database); assert.deepEqual(codes, [continuationCode]);
        calls.push("queued"); return queued;
      },
      enqueueCreditexProductRegistryRefresh: async (db, code) => {
        assert.equal(db, database); assert.equal(code, registryCode);
        calls.push("enqueue"); queued = true; due = !concurrentFutureRetry;
      },
    },
  };
  const loadedModule = { exports: {} };
  new Function("require", "module", "exports", compiled)((name) => {
    if (!Object.hasOwn(mocks, name)) throw new Error(`Unexpected dependency: ${name}`);
    return mocks[name];
  }, loadedModule, loadedModule.exports);
  const get = () => loadedModule.exports.GET(new Request(
    "https://example.test/api/creditex/official-products?productKind=veu_air_conditioner&installationDate=2026-09-24",
  ));
  const continueRefresh = prefer => loadedModule.exports.GET(new Request(
    `https://example.test/api/creditex/official-products?continueRegistry=${continuationCode}`,
    { headers: prefer ? { Prefer: prefer } : {} },
  ));
  return { get, continueRefresh, calls, result, registry };
}

test("ordinary picker continuation polls stay asynchronous and only dispatch due work", async () => {
  for (const [continuationCode, preference, due] of [
    ["gems-products", undefined, true], ["cer_sres_swh", "wait=119", true],
    ["gems-products", "invalid", false], [registryCode, "wait=120", true],
  ]) {
    const h = fixture({ continuationCode, due });
    const response = await h.continueRefresh(preference);
    assert.equal(response.status, due ? 202 : 200);
    assert.equal(response.headers.get(dispatchHeader), due ? continuationCode : null);
    assert.equal(response.headers.get("Preference-Applied"), null);
    assert.deepEqual(h.calls, ["queued", "due"]);
  }
});

test("waiting for an exact whole-register import returns current queue state without a second dispatch", async () => {
  for (const continuationCode of ["gems-products", "cer_sres_swh"]) {
    for (const [queued, due, finishDuringWait] of [[true, true, true], [true, true, false], [true, false, false], [false, false, false]]) {
      const h = fixture({ continuationCode, queued, due, finishDuringWait });
      const response = await h.continueRefresh("wait=120");
      const stillDue = due && !finishDuringWait;
      assert.equal(response.status, stillDue ? 202 : 200);
      assert.equal(response.headers.get("Preference-Applied"), "wait=120");
      assert.equal(response.headers.get("Retry-After"), stillDue ? "3" : null);
      assert.equal(response.headers.get(dispatchHeader), null);
      assert.deepEqual(await response.json(), { ok: true, refreshQueued: queued && !finishDuringWait, continuationDue: stillDue });
      assert.deepEqual(h.calls, due && queued ? ["due", "maintain", "queued", "due"] : ["due", "queued", "due"]);
    }
  }
});

test("stale picker searches dispatch a due durable retry during failed-attempt backoff", async () => {
  const h = fixture();
  assert.equal(creditexProductRegistryRefreshDue(h.registry), false);
  const response = await h.get();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get(dispatchHeader), registryCode);
  assert.deepEqual(await response.json(), { ok: true, ...h.result });
  assert.deepEqual(h.calls, ["due"]);
});

test("future retries remain deferred without repeated enqueue writes", async () => {
  for (const failed of [true, false]) {
    const h = fixture({ failed, due: false });
    for (let poll = 0; poll < 2; poll += 1) {
      const response = await h.get();
      assert.equal(response.status, 200);
      assert.equal(response.headers.get(dispatchHeader), null);
    }
    assert.equal(h.calls.includes("enqueue"), false);
    assert.deepEqual(h.calls, failed ? ["due", "due"] : ["due", "queued", "due", "queued"]);
  }
});

test("healthy current picker searches do not query the refresh queue", async () => {
  const h = fixture({ status: "current", failed: false, queued: false, due: false });
  const response = await h.get();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get(dispatchHeader), null);
  assert.deepEqual(h.calls, []);
});

test("an accepted current snapshot can still resume an already-due failed refresh", async () => {
  const h = fixture({ status: "current" });
  const response = await h.get();
  assert.equal(response.headers.get(dispatchHeader), registryCode);
  assert.deepEqual(h.calls, ["due"]);
});

test("a stale registry without queued work enqueues once and checks actual retry eligibility", async () => {
  for (const concurrentFutureRetry of [false, true]) {
    const h = fixture({ failed: false, queued: false, due: false, concurrentFutureRetry });
    const response = await h.get();
    assert.equal(response.status, 200);
    assert.equal(response.headers.get(dispatchHeader), concurrentFutureRetry ? null : registryCode);
    assert.deepEqual(h.calls, ["due", "queued", "enqueue", "due"]);
  }
});
