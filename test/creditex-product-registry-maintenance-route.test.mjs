import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import ts from "typescript";

const routeSource = fs.readFileSync(new URL(
  "../src/app/api/creditex/official-products/maintenance/route.ts",
  import.meta.url,
), "utf8");

function compile(source, fileName, mocks) {
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
    fileName,
  }).outputText;
  const moduleRecord = { exports: {} };
  const require = (specifier) => {
    if (Object.hasOwn(mocks, specifier)) return mocks[specifier];
    throw new Error(`Unexpected module dependency: ${specifier}`);
  };
  new Function("require", "module", "exports", output)(
    require,
    moduleRecord,
    moduleRecord.exports,
  );
  return moduleRecord.exports;
}

class ProductError extends Error {
  constructor(code, status, message) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function routeFixture({ configuredToken = "x".repeat(64) } = {}) {
  const calls = [];
  const database = {};
  const definition = {
    registryCode: "veu-approved-products",
    sources: [{ streamingParser: {} }],
  };
  const route = compile(routeSource, "maintenance/route.ts", {
    "cloudflare:workers": {
      env: {
        CREDITEX_PRODUCT_REGISTRY_MAINTENANCE_TOKEN: configuredToken,
        EVIDENCE: { name: "evidence" },
      },
    },
    "../../../../../../db": { getD1: () => database },
    "@/lib/bounded-json-request": {
      BoundedJsonRequestError: class extends Error {},
      MAXIMUM_CREDITEX_JSON_BYTES: 16_384,
      readBoundedJsonRequest: async (request) => request.json(),
    },
    "@/lib/creditex-official-product-registry": {
      CreditexOfficialProductError: ProductError,
    },
    "@/lib/creditex-official-product-registry-definitions": {
      creditexAutomaticProductRegistry: (registryCode) => (
        registryCode === definition.registryCode ? definition : undefined
      ),
    },
    "@/lib/creditex-official-product-registry-server": {
      loadOfficialProductRegistryStatus: async () => ({ status: "current" }),
      syncOfficialProductRegistry: async (_db, selected, options) => {
        calls.push(["sync", selected.registryCode, options]);
        return { complete: false, recordCount: 15_000 };
      },
    },
    "@/lib/creditex-product-registry-maintenance": {
      CREDITEX_PRODUCT_REGISTRY_DISPATCH_HEADER:
        "X-Creditex-Product-Registry-Dispatch",
      creditexAutomaticProductRegistryStreamingBudget: () => 15_000,
      enqueueCreditexProductRegistryRefresh: async (_db, registryCode) => {
        calls.push(["enqueue", registryCode]);
      },
      withCreditexProductRegistryFleetLease: async (_db, operation) => (
        operation({ leaseId: "fleet-lease" })
      ),
    },
    "@/lib/creditex-sres-registry-server": {
      loadCerSresRegistryStatus: async () => ({ status: "current" }),
      syncCerSresProductRegistry: async () => ({ complete: true }),
    },
  });
  return { route, calls };
}

function maintenanceRequest(token, body = { registryCode: "veu-approved-products" }) {
  return new Request(
    "https://compare.ausenergyassessments.com/api/creditex/official-products/maintenance",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Origin: "https://compare.ausenergyassessments.com",
      },
      body: JSON.stringify(body),
    },
  );
}

test("maintenance refresh rejects absent or incorrect machine authentication", async () => {
  const { route, calls } = routeFixture();
  const response = await route.POST(maintenanceRequest("wrong-token"));
  assert.equal(response.status, 401);
  assert.equal((await response.json()).code, "AUTH_REQUIRED");
  assert.deepEqual(calls, []);
});

test("maintenance refresh acquires once in foreground and dispatches retained replay", async () => {
  const token = "m".repeat(64);
  const { route, calls } = routeFixture({ configuredToken: token });
  const response = await route.POST(maintenanceRequest(token));
  assert.equal(response.status, 200);
  assert.equal(
    response.headers.get("X-Creditex-Product-Registry-Dispatch"),
    "veu-approved-products",
  );
  assert.deepEqual(calls[0], ["enqueue", "veu-approved-products"]);
  assert.equal(calls[1][0], "sync");
  assert.equal(calls[1][1], "veu-approved-products");
  assert.equal(calls[1][2].fleetLeaseId, "fleet-lease");
  assert.equal(calls[1][2].maximumStreamingRecordsPerRun, 15_000);
  assert.equal((await response.json()).result.complete, false);
});

test("maintenance refresh rejects registries without an automatic producer", async () => {
  const token = "m".repeat(64);
  const { route, calls } = routeFixture({ configuredToken: token });
  const response = await route.POST(maintenanceRequest(token, {
    registryCode: "wa-horizon-supported-solutions",
  }));
  assert.equal(response.status, 400);
  assert.equal((await response.json()).code, "OFFICIAL_PRODUCT_REQUEST_INVALID");
  assert.deepEqual(calls, []);
});
