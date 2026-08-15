import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  describeCreditexCalculatorRouteError,
  projectCreditexCalculatorReadResponse,
} from "../src/lib/creditex-calculator-route-response.ts";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");

const programEstimateRoute = read(
  "../src/app/api/creditex/program-estimates/route.ts",
);
const stcEstimateRoute = read(
  "../src/app/api/creditex/stc-estimates/route.ts",
);
const officialProductsRoute = read(
  "../src/app/api/creditex/official-products/route.ts",
);
const stcProductsRoute = read(
  "../src/app/api/creditex/stc-products/route.ts",
);

test("calculator route descriptors preserve authentication and bounded schema readiness", () => {
  for (const error of [
    new Error("AUTH_REQUIRED"),
    { code: "AUTH_REQUIRED" },
    "AUTH_REQUIRED",
  ]) {
    assert.deepEqual(describeCreditexCalculatorRouteError(error), {
      status: 401,
      code: "AUTH_REQUIRED",
      error: "Sign in to continue.",
    });
  }

  for (const message of [
    "CREDITEX_SCHEMA_GUARDS_INSTALLING:12",
    "CREDITEX_PRODUCT_REGISTRY_SCHEMA_GUARDS_INSTALLING:2",
  ]) {
    assert.deepEqual(describeCreditexCalculatorRouteError(new Error(message)), {
      status: 503,
      code: "CREDITEX_SCHEMA_GUARDS_INSTALLING",
      error: "Preparing the governed Creditex calculator.",
      headers: { "Retry-After": "1" },
    });
  }

  for (const message of [
    "CREDITEX_SCHEMA_GUARD_MISMATCH:guard_name",
    "CREDITEX_SCHEMA_GUARDS_UNAVAILABLE:guard_name",
    "CREDITEX_SCHEMA_MIGRATIONS_REQUIRED:table_name",
    "CREDITEX_PRODUCT_REGISTRY_SCHEMA_GUARD_MISMATCH:guard_name",
    "CREDITEX_PRODUCT_REGISTRY_SCHEMA_GUARDS_UNAVAILABLE:guard_name",
    "CREDITEX_PRODUCT_REGISTRY_MIGRATIONS_REQUIRED:table_name",
  ]) {
    const descriptor = describeCreditexCalculatorRouteError(new Error(message));
    assert.deepEqual(descriptor, {
      status: 503,
      code: "CREDITEX_SCHEMA_GUARD_REVIEW_REQUIRED",
      error:
        "Creditex calculator integrity controls need a governed upgrade before this request can continue.",
    });
    assert.doesNotMatch(JSON.stringify(descriptor), /guard_name|table_name/);
  }

  assert.equal(
    describeCreditexCalculatorRouteError(new Error("unrelated failure")),
    null,
  );
});

test("installer SRES responses redact custody and refresh internals without losing search data", () => {
  const response = {
    ok: true,
    registry: {
      registryCode: "cer_sres_swh",
      status: "current",
      freshnessWindowHours: 48,
      lastCheckedAt: "2026-08-08T10:00:00.000Z",
      lastAttempt: {
        status: "failed",
        checkedAt: "2026-08-08T10:00:00.000Z",
        message: "D1 internal failure for secret table",
        internalRunId: "sync-run-secret",
      },
      snapshot: {
        id: "snapshot-1",
        sourceSha256: "a".repeat(64),
        recordCount: 16_684,
        activatedAt: "2026-08-08T09:00:00.000Z",
        sourceManifest: {
          sources: [{ objectKey: "creditex/private-r2-object" }],
        },
        internalLeaseId: "lease-secret",
      },
      internalRegistryState: "registry-secret",
    },
    installationDate: "2026-08-08",
    products: [{ sourceRecordKey: "cer-ashp:1", model: "Model 1" }],
  };

  assert.equal(
    projectCreditexCalculatorReadResponse("compliance", response),
    response,
  );
  const installer = projectCreditexCalculatorReadResponse(
    "installer",
    response,
  );
  assert.deepEqual(installer.products, response.products);
  assert.equal(installer.installationDate, response.installationDate);
  assert.deepEqual(installer.registry.snapshot, {
    id: "snapshot-1",
    sourceSha256: "a".repeat(64),
    recordCount: 16_684,
    activatedAt: "2026-08-08T09:00:00.000Z",
  });
  assert.deepEqual(installer.registry.lastAttempt, {
    status: "failed",
    checkedAt: "2026-08-08T10:00:00.000Z",
    message: "The last controlled registry refresh did not complete.",
  });
  assert.doesNotMatch(
    JSON.stringify(installer),
    /private-r2-object|secret table|sync-run-secret|lease-secret|registry-secret/,
  );
  assert.match(JSON.stringify(response), /private-r2-object|secret table/);
});

test("installer official-product responses redact every registry status and retain products", () => {
  const registry = {
    registryCode: "gems-products",
    status: "current",
    freshnessWindowHours: 48,
    snapshotId: "official-snapshot-1",
    sourceSha256: "b".repeat(64),
    recordCount: 31_418,
    lastCheckedAt: "2026-08-08T11:00:00.000Z",
    lastAttempt: {
      status: "failed",
      checkedAt: "2026-08-08T11:00:00.000Z",
      message: "internal official registry diagnostic",
    },
    internalSourceCount: 11,
  };
  const statusResponse = projectCreditexCalculatorReadResponse("installer", {
    ok: true,
    registries: [registry],
  });
  const searchResponse = projectCreditexCalculatorReadResponse("installer", {
    ok: true,
    registry,
    facets: {
      brands: [{ value: "Exact Brand", label: "Exact Brand", count: 2 }],
      models: [{ value: "Model 1", label: "Model 1", count: 2 }],
      productTypes: [{ value: "Ducted", label: "Ducted", count: 1 }],
    },
    matchCount: 2,
    products: [{ id: "product-1", model: "Model 1" }],
  });

  for (const projected of [statusResponse.registries[0], searchResponse.registry]) {
    assert.deepEqual(projected, {
      registryCode: "gems-products",
      status: "current",
      freshnessWindowHours: 48,
      snapshotId: "official-snapshot-1",
      sourceSha256: "b".repeat(64),
      recordCount: 31_418,
      lastCheckedAt: "2026-08-08T11:00:00.000Z",
      lastAttempt: {
        status: "failed",
        checkedAt: "2026-08-08T11:00:00.000Z",
        message: "The last controlled registry refresh did not complete.",
      },
    });
  }
  assert.deepEqual(searchResponse.facets, {
    brands: [{ value: "Exact Brand", label: "Exact Brand", count: 2 }],
    models: [{ value: "Model 1", label: "Model 1", count: 2 }],
    productTypes: [{ value: "Ducted", label: "Ducted", count: 1 }],
  });
  assert.equal(searchResponse.matchCount, 2);
  assert.deepEqual(searchResponse.products, [{ id: "product-1", model: "Model 1" }]);
  assert.doesNotMatch(
    JSON.stringify([statusResponse, searchResponse]),
    /internal official registry diagnostic|internalSourceCount/,
  );
});

test("public quote registry responses use the same redacted projection as installers", () => {
  const response = {
    ok: true,
    registry: {
      registryCode: "veu-approved-products",
      status: "current",
      snapshotId: "snapshot-public",
      sourceSha256: "c".repeat(64),
      recordCount: 75_492,
      lastAttempt: {
        status: "failed",
        message: "private operational diagnostic",
      },
      sourceManifest: [{ objectKey: "private/r2/key" }],
    },
    products: [{ id: "approved-product" }],
  };
  const projected = projectCreditexCalculatorReadResponse(
    "public_quote",
    response,
  );
  assert.deepEqual(projected.products, response.products);
  assert.doesNotMatch(
    JSON.stringify(projected),
    /private operational diagnostic|private\/r2\/key/,
  );
});

test("all calculator routes share safe descriptors and registry refresh remains admin-only", () => {
  for (const route of [
    programEstimateRoute,
    stcEstimateRoute,
    officialProductsRoute,
    stcProductsRoute,
  ]) {
    assert.match(route, /describeCreditexCalculatorRouteError\(error\)/);
    assert.match(route, /descriptor\.headers/);
  }
  for (const route of [officialProductsRoute, stcProductsRoute]) {
    const getSource = route.slice(
      route.indexOf("export async function GET"),
      route.indexOf("export async function POST"),
    );
    const postSource = route.slice(route.indexOf("export async function POST"));
    assert.match(
      getSource,
      /requireCreditexCalculatorAccess\(request, database, \{\s*allowPublicQuote: true/,
    );
    assert.match(getSource, /projectCreditexCalculatorReadResponse\(access\.accessType/);
    assert.match(postSource, /requireComplianceAccess\(request/);
    assert.match(postSource, /allowedRoles: \["admin"\]/);
    assert.doesNotMatch(postSource, /requireCreditexCalculatorAccess\(request/);
  }
  assert.match(officialProductsRoute, /brand: parameters\.get\("brand"\)/);
  assert.match(officialProductsRoute, /model: parameters\.get\("model"\)/);
  assert.match(
    officialProductsRoute,
    /productType: parameters\.get\("productType"\)/,
  );
  assert.match(
    officialProductsRoute,
    /veuActivityCode: parameters\.get\("veuActivityCode"\)/,
  );
  assert.match(
    officialProductsRoute,
    /veuScenario: parameters\.get\("veuScenario"\)/,
  );
  assert.match(
    officialProductsRoute,
    /enqueueCreditexProductRegistryRefresh\(/,
  );
  assert.match(stcProductsRoute, /enqueueCreditexProductRegistryRefresh\(/);
  assert.doesNotMatch(
    officialProductsRoute,
    /ensureAutomaticOfficialProductRegistryCurrent\(/,
  );
  assert.doesNotMatch(
    stcProductsRoute,
    /ensureCerSresProductRegistryCurrent\(/,
  );
  assert.match(
    officialProductsRoute,
    /error\.code === "OFFICIAL_PRODUCT_REGISTRY_STALE"/,
  );
  assert.match(
    officialProductsRoute,
    /error\.code === "OFFICIAL_PRODUCT_REGISTRY_UNAVAILABLE"/,
  );
});
