import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import * as contract from "../src/lib/trade-network.ts";

const compiled = ts.transpileModule(fs.readFileSync(new URL("../src/app/api/trade-network/route.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function fixture({ authError = "", serviceError, allowed = true } = {}) {
  const route = {}, calls = [], access = { ownerUid: "business-owner", actorUid: "staff-member" };
  class TradeAccessError extends Error {}
  const service = name => async (...args) => { calls.push({ name, args }); if (serviceError) throw serviceError; return name === "listNetwork" ? { posts: [], myPosts: [], enquiries: [], enabled: false } : { id: "record", revision: 1 }; };
  const dependencies = {
    "@/lib/admin-server": { sameOrigin: request => !request.headers.get("origin") || request.headers.get("origin") === new URL(request.url).origin, mfaErrorResponse: () => null, adminJson: (body, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } }) },
    "@/lib/trade-access-server": { TradeAccessError },
    "@/lib/trade-team-server": { requireInstallerTeamAccess: async () => { if (authError) throw new Error(authError); return access; } },
    "@/lib/trade-network": contract,
    "@/lib/trade-network-server": { assertNetworkAccess: () => { if (!allowed) throw new contract.NetworkError("NETWORK_ACCESS_REQUIRED", "Blocked", 403); }, ...Object.fromEntries(["listNetwork", "setNetworkMembership", "setNetworkAvailability", "setNetworkLeadStatus", "saveNetworkPost", "changeNetworkPost", "createNetworkEnquiry", "changeNetworkEnquiry"].map(name => [name, service(name)])) },
  };
  Function("require", "exports", compiled)(id => { assert.ok(dependencies[id], id); return dependencies[id]; }, route);
  const request = (body, headers = {}) => new Request("https://tlink.test/api/trade-network", { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });
  return { route, calls, access, request };
}
test("network route rejects cross-origin, unauthenticated and denied reads and writes", async () => {
  for (const options of [{ authError: "AUTH_REQUIRED" }, { authError: "ABN_REVIEW_REQUIRED" }, { authError: "TEAM_ACCESS_RECORD_REQUIRED" }, { allowed: false }]) {
    const h = fixture(options);
    assert.ok([401, 403].includes((await h.route.GET(new Request("https://tlink.test/api/trade-network"))).status));
    assert.ok([401, 403].includes((await h.route.POST(h.request({ action: "membership", enabled: true }))).status));
    assert.equal(h.calls.length, 0);
  }
  const h = fixture();
  assert.equal((await h.route.GET(new Request("https://tlink.test/api/trade-network", { headers: { Origin: "https://foreign.test" } }))).status, 403);
  assert.equal((await h.route.POST(h.request({ action: "membership", enabled: true }, { Origin: "https://foreign.test" }))).status, 403);
  assert.equal(h.calls.length, 0);
});
test("network route bounds JSON and streamed payloads before domain storage", async () => {
  const h = fixture();
  for (const body of ["{", "null", "[]", { action: "delete_everything" }, "x".repeat(contract.NETWORK_MAX_BODY_BYTES + 1)]) assert.equal((await h.route.POST(h.request(body))).status, 400);
  const large = new TextEncoder().encode("é".repeat(contract.NETWORK_MAX_BODY_BYTES));
  const request = new Request("https://tlink.test/api/trade-network", { method: "POST", duplex: "half", body: new ReadableStream({ start(controller) { controller.enqueue(large.slice(0, 10_000)); controller.enqueue(large.slice(10_000)); controller.close(); } }) });
  assert.equal((await h.route.POST(request)).status, 400); assert.equal(h.calls.length, 0);
});
test("network commands always pass authenticated scope rather than payload ownership", async () => {
  const h = fixture();
  const post = { title: "Plumber" };
  assert.equal((await h.route.POST(h.request({ action: "save_post", id: "record", expectedRevision: 3, post, ownerUid: "foreign" }))).status, 200);
  assert.deepEqual(h.calls[0], { name: "saveNetworkPost", args: [h.access, "record", 3, post] });
  for (const action of ["membership", "close_post", "renew_post", "enquire", "connect", "close_enquiry"]) assert.equal((await h.route.POST(h.request({ action, id: "record", enabled: false }))).status, 200);
  assert.equal(h.calls.length, 7); assert.ok(h.calls.every(call => call.args[0] === h.access));
});
test("network lists are private and errors omit internal values", async () => {
  const h = fixture();
  const response = await h.route.GET(new Request("https://tlink.test/api/trade-network?kind=work&search=3121&offset=50"));
  assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(h.calls[0].args, [h.access, { kind: "work", search: "3121", offset: "50" }]);
  for (const [serviceError, status] of [[new contract.NetworkError("NETWORK_CONFLICT", "Refresh", 409), 409], [new Error("SQL private payload"), 503]]) {
    const result = await fixture({ serviceError }).route.GET(new Request("https://tlink.test/api/trade-network"));
    assert.equal(result.status, status); assert.equal(result.headers.get("cache-control"), "no-store");
    assert.doesNotMatch(await result.text(), /SQL private payload/);
  }
});
test("availability and lead status mutations receive the authenticated business scope", async () => {
  const h = fixture();
  assert.equal((await h.route.POST(h.request({ action: "availability", openToWork: true, workTrades: ["Plumbing"], ownerUid: "foreign" }))).status, 200);
  assert.deepEqual(h.calls[0], { name: "setNetworkAvailability", args: [h.access, true, ["Plumbing"], undefined] });
  assert.equal((await h.route.POST(h.request({ action: "lead_status", id: "post-1", status: "dismissed", ownerUid: "foreign" }))).status, 200);
  assert.deepEqual(h.calls[1], { name: "setNetworkLeadStatus", args: [h.access, "post-1", "dismissed"] });
  await h.route.GET(new Request("https://tlink.test/api/trade-network?leadPostId=post-1&leadsOffset=50"));
  assert.deepEqual(h.calls[2].args, [h.access, { leadPostId: "post-1", leadsOffset: "50" }]);
  const minimumRates = { hour: 9500, day: null, job: 100_000 };
  assert.equal((await h.route.POST(h.request({ action: "availability", openToWork: true, workTrades: ["Plumbing"], minimumRates, ownerUid: "foreign" }))).status, 200);
  assert.deepEqual(h.calls[3], { name: "setNetworkAvailability", args: [h.access, true, ["Plumbing"], minimumRates] });
});
