import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";
import { TradeMapInputError } from "../src/lib/trade-map-dataset-server.ts";
import { TradeMapLocationInputError } from "../src/lib/trade-map-location-cache.ts";
import { GnafDirectoryUnavailableError } from "../src/lib/gnaf-directory.ts";

const source = ts.createSourceFile("route.ts", fs.readFileSync(new URL("../src/app/api/trade-crm/route.ts", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true);
const selected = source.statements.filter(node => ts.isFunctionDeclaration(node) && ["POST", "errorResponse"].includes(node.name?.text));
assert.equal(selected.length, 2);
const output = ts.transpileModule(selected.map(node => node.getText()).join("\n"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function fixture(options = {}) {
  const calls = { identity: 0, projection: [], directory: 0, locations: [] };
  const identity = { uid: "verified-business-owner", memberId: "current-staff", access: {
    canViewCustomers: true, canSearchCustomers: true, ...options.access,
  } };
  const dataset = { sql: "authorised server projection", bindings: [identity.uid, identity.memberId] };
  const directory = { version: "gnaf-aug2026", attribution: "G-NAF", resolve: () => { throw new Error("Not invoked by this route boundary test"); } };
  const db = {};
  class OtherDomainError extends Error {}
  const dependencies = {
    adminJson: (body, status = 200) => Response.json(body, { status }),
    sameOrigin: () => options.origin !== false,
    crmIdentity: async () => { calls.identity++; if (options.authError) throw options.authError; return identity; },
    boundedCrmRequestBody: request => request.json(), getD1: () => db,
    cleanAdminText: (value, max) => typeof value === "string" ? value.trim().slice(0, max) : "",
    crmIndex: async (...args) => { calls.projection.push(args); return dataset; },
    getGnafDirectory: async () => { calls.directory++; if (options.directoryError) throw options.directoryError; return directory; },
    locateTradeMapRecords: async (...args) => { calls.locations.push(args); return { processed: 1, located: 1, unlocated: 0, complete: true, retryAfterMs: 0 }; },
    TradeMapInputError, TradeMapLocationInputError, GnafDirectoryUnavailableError,
    mfaErrorResponse: () => null, creditexMutationConflict: () => null,
    isTradeJobScheduleEligibilityConflict: () => false, isTradeComplianceIntentScheduleConflict: () => false,
    isRentalInspectionAssignmentConflict: () => false,
    CreditexComplianceError: OtherDomainError, TradeAddressVerificationError: OtherDomainError,
    TradeComplianceIntentError: OtherDomainError, ComplianceDomainError: OtherDomainError, TradeAccessError: OtherDomainError,
  };
  const route = new Function("exports", ...Object.keys(dependencies), `${output}\nreturn { POST };`)({}, ...Object.values(dependencies));
  const post = (body, query = "resource=customers") => route.POST(new Request(`https://example.test/api/trade-crm?${query}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  }));
  return { post, calls, identity, dataset, directory, db };
}

test("obsolete browser claim/save actions reject forged coordinates before any lookup or cache mutation", async () => {
  const f = fixture();
  for (const action of ["claim_map_locations", "save_map_locations"]) {
    const response = await f.post({ action, ownerUid: "other-owner", results: [{ provider: "gnaf", lat: -37, lng: 145 }] });
    assert.equal(response.status, 410);
    assert.match((await response.json()).error, /Refresh the map/);
  }
  assert.equal(f.calls.projection.length, 0); assert.equal(f.calls.directory, 0); assert.equal(f.calls.locations.length, 0);
});

test("location action uses verified business scope, current filters and the server directory; client locations are ignored", async () => {
  const f = fixture();
  const response = await f.post({ action: "locate_map_records", limit: 200, ownerUid: "forged-owner", provider: "google",
    dataset: { sql: "forged" }, results: [{ lat: 0, lng: 0 }], directory: { version: "forged" } }, "resource=jobs&operationalStatus=imported&search=Jones");
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, processed: 1, located: 1, unlocated: 0, complete: true, retryAfterMs: 0 });
  const [actor, url, resource, mapMode] = f.calls.projection[0];
  assert.equal(actor, f.identity); assert.equal(url.searchParams.get("operationalStatus"), "imported");
  assert.equal(url.searchParams.get("search"), "Jones"); assert.equal(resource, "jobs"); assert.equal(mapMode, true);
  assert.deepEqual(f.calls.locations, [[f.db, "verified-business-owner", f.dataset, { limit: 200, directory: f.directory }]]);
});

test("map location action requires both customer view and customer search permission", async () => {
  for (const access of [{ canViewCustomers: false }, { canSearchCustomers: false }]) {
    const f = fixture({ access });
    assert.equal((await f.post({ action: "locate_map_records" })).status, 403);
    assert.equal(f.calls.projection.length, 0); assert.equal(f.calls.directory, 0); assert.equal(f.calls.locations.length, 0);
  }
});

test("map mutation rejects invalid resource and limit type before resolving any address", async () => {
  const f = fixture();
  assert.equal((await f.post({ action: "locate_map_records" }, "resource=invoices")).status, 400);
  assert.equal((await f.post({ action: "locate_map_records", limit: "200" })).status, 400);
  assert.equal(f.calls.directory, 0); assert.equal(f.calls.locations.length, 0);
});

test("unavailable directory returns an honest retryable response without classifying all records as missing", async () => {
  const f = fixture({ directoryError: new GnafDirectoryUnavailableError() });
  const response = await f.post({ action: "locate_map_records" });
  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /address directory is not ready/);
  assert.equal(f.calls.locations.length, 0);
});

test("origin and authentication rejection happen before directory access", async () => {
  const origin = fixture({ origin: false });
  assert.equal((await origin.post({ action: "locate_map_records" })).status, 403);
  assert.equal(origin.calls.identity, 0); assert.equal(origin.calls.directory, 0);
  const auth = fixture({ authError: new Error("AUTH_REQUIRED") });
  assert.equal((await auth.post({ action: "locate_map_records" })).status, 401);
  assert.equal(auth.calls.projection.length, 0); assert.equal(auth.calls.directory, 0);
});
