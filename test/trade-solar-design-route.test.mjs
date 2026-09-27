import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import { SOLAR_DESIGN_MAX_BYTES } from "../src/lib/trade-solar-design.ts";

const source = fs.readFileSync(new URL("../src/app/api/trade-solar-designs/route.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function fixture({ authError = "", serviceError = "", allowed = true } = {}) {
  const route = {}, calls = [], access = { ownerUid: "business-owner", actorUid: "staff-member" };
  class TradeAccessError extends Error {}
  const service = name => async (...args) => { calls.push({ name, args }); if (serviceError) throw new Error(serviceError); return name === "listSolarDesigns" ? { designs: [], hasMore: false } : { id: "design-1", revision: 1 }; };
  const dependencies = {
    "@/lib/admin-server": { sameOrigin: request => !request.headers.get("origin") || request.headers.get("origin") === new URL(request.url).origin, mfaErrorResponse: () => null, adminJson: (body, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } }) },
    "@/lib/trade-access-server": { TradeAccessError },
    "@/lib/trade-team-server": { requireInstallerTeamAccess: async () => { if (authError) throw new Error(authError); return access; } },
    "@/lib/trade-solar-design": { SOLAR_DESIGN_MAX_BYTES },
    "@/lib/trade-solar-design-server": { assertSolarDesignAccess: () => { if (!allowed) throw new Error("SOLAR_DESIGN_ACCESS_REQUIRED"); }, ...Object.fromEntries(["attachSolarDesign", "listSolarDesigns", "loadSolarDesign", "saveSolarDesign"].map(name => [name, service(name)])) },
  };
  Function("require", "exports", compiled)(id => { assert.ok(dependencies[id], id); return dependencies[id]; }, route);
  const request = (body, headers = {}) => new Request("https://tlink.test/api/trade-solar-designs", { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });
  return { route, calls, access, request };
}

test("solar design route rejects cross-origin and unauthorised writes before calling storage", async () => {
  for (const options of [{ authError: "AUTH_REQUIRED" }, { authError: "ABN_REVIEW_REQUIRED" }, { allowed: false }]) {
    const h = fixture(options), response = await h.route.POST(h.request({ design: {} }));
    assert.ok([401, 403].includes(response.status)); assert.equal(h.calls.length, 0);
  }
  const h = fixture();
  assert.equal((await h.route.POST(h.request({ design: {} }, { Origin: "https://foreign.test" }))).status, 403);
  assert.equal(h.calls.length, 0);
});

test("solar design route bounds streamed bodies and rejects invalid JSON/actions without storage calls", async () => {
  const h = fixture();
  for (const body of ["{", "null", "[]", { action: "save_preset", item: {} }, { action: "delete" }, "x".repeat(SOLAR_DESIGN_MAX_BYTES + 2_001)]) {
    assert.equal((await h.route.POST(h.request(body))).status, 400);
  }
  const large = new TextEncoder().encode("é".repeat(SOLAR_DESIGN_MAX_BYTES));
  const request = new Request("https://tlink.test/api/trade-solar-designs", { method: "POST", duplex: "half", body: new ReadableStream({ start(controller) { controller.enqueue(large.slice(0, 100_000)); controller.enqueue(large.slice(100_000)); controller.close(); } }) });
  assert.equal((await h.route.POST(request)).status, 400);
  assert.equal(h.calls.length, 0);
});

test("save and attach pass expected revisions and use authenticated business access", async () => {
  const h = fixture(), design = { title: "Roof" };
  const saved = await h.route.POST(h.request({ id: "design-1", expectedRevision: 3, design, ownerUid: "foreign" }));
  assert.equal(saved.status, 200); assert.equal(saved.headers.get("cache-control"), "no-store");
  assert.deepEqual(h.calls[0], { name: "saveSolarDesign", args: [h.access, design, "design-1", 3] });
  const attached = await h.route.POST(h.request({ action: "attach", id: "design-1", expectedRevision: 4, workOrderId: "job-1" }));
  assert.equal(attached.status, 200);
  assert.deepEqual(h.calls[1], { name: "attachSolarDesign", args: [h.access, "design-1", 4, "job-1", undefined] });
});

test("list filters stay bounded in storage and errors expose actionable statuses without payloads", async () => {
  const h = fixture();
  const response = await h.route.GET(new Request("https://tlink.test/api/trade-solar-designs?customerId=customer-1&offset=50"));
  assert.equal(response.status, 200);
  assert.deepEqual(h.calls[0].args, [h.access, { customerId: "customer-1", workOrderId: null, offset: 50, search: null }]);
  assert.equal((await h.route.GET(new Request("https://tlink.test/api/trade-solar-designs?resource=presets"))).status, 400);
  for (const [serviceError, status] of [["SOLAR_DESIGN_REVISION_CONFLICT", 409], ["SOLAR_DESIGN_NOT_FOUND", 404], ["SOLAR_DESIGN_CONTEXT_UNAVAILABLE", 404], ["SOLAR_DESIGN_INVALID", 400], ["SQL secret payload", 503]]) {
    const error = fixture({ serviceError }), result = await error.route.GET(new Request("https://tlink.test/api/trade-solar-designs?id=design-1"));
    assert.equal(result.status, status); assert.equal(result.headers.get("cache-control"), "no-store");
    assert.doesNotMatch(await result.text(), /SQL secret payload/);
  }
});
