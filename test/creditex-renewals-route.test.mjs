import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";

const source = fs.readFileSync(new URL("../src/app/api/creditex/operations/route.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function fixture({ role = "admin", authenticated = true, authorised = true } = {}) {
  const calls = [];
  const database = {};
  class AccessError extends Error {
    constructor() { super("Membership required"); this.status = 403; this.code = "MEMBERSHIP_REQUIRED"; }
  }
  const member = { organisationId: "verified-creditex-org", role };
  const dashboard = { queues: { participants: [{ id: "installer-a" }, { id: "installer-b" }], cases: [{ id: "case-a" }] }, count: 2 };
  const dependencies = {
    "../../../../../db": { getD1: () => database },
    "@/lib/firebase-server": { requireFirebaseIdentity: async () => {
      if (!authenticated) throw new Error("AUTH_REQUIRED");
      return { uid: "verified-user" };
    } },
    "@/lib/compliance-access-server": {
      ComplianceAccessError: AccessError,
      requireComplianceIdentity: async () => {
        if (!authorised) throw new AccessError();
        return member;
      },
    },
    "@/lib/creditex-operations-server": {
      CreditexOperationsError: class extends Error {},
      parseCreditexOperationsFilters: () => ({}),
      loadCreditexOperationsDashboard: async (db, verifiedMember) => {
        assert.equal(db, database);
        assert.equal(verifiedMember, member);
        return dashboard;
      },
      loadCreditexCaseWorkspace: async () => ({ id: "case-a" }),
    },
    "@/lib/creditex-installer-renewals-server": { loadCreditexInstallerRenewals: async (db, input) => {
      assert.equal(db, database);
      calls.push(input);
      return input.role === "admin" ? { "installer-a": [{ type: "insurance", title: "Public liability", expiresAt: "2026-10-01", status: "expiring" }] } : {};
    } },
  };
  const exports = {};
  new Function("require", "exports", compiled)((specifier) => {
    assert.ok(dependencies[specifier], `Unexpected dependency ${specifier}`);
    return dependencies[specifier];
  }, exports);
  return { GET: exports.GET, calls, dashboard };
}

test("renewal metadata uses verified organisation and returned participant IDs, ignoring caller scope", async () => {
  const { GET, calls, dashboard } = fixture();
  const response = await GET(new Request("https://example.test/api/creditex/operations?organisationId=other&participantIds=private-member"));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(calls, [{ organisationId: "verified-creditex-org", role: "admin", participantIds: ["installer-a", "installer-b"] }]);
  const { dashboard: presented } = await response.json();
  assert.deepEqual(presented.queues.participants, [
    { id: "installer-a", renewals: [{ type: "insurance", title: "Public liability", expiresAt: "2026-10-01", status: "expiring" }] },
    { id: "installer-b", renewals: [] },
  ]);
  assert.deepEqual(presented.queues.cases, dashboard.queues.cases);
  assert.deepEqual(dashboard.queues.participants, [{ id: "installer-a" }, { id: "installer-b" }]);
});

test("non-admin roles are passed unchanged and receive no Team document metadata", async () => {
  const { GET, calls } = fixture({ role: "reviewer" });
  const response = await GET(new Request("https://example.test/api/creditex/operations?role=admin"));
  assert.equal(response.status, 200);
  assert.equal(calls[0].role, "reviewer");
  assert.deepEqual((await response.json()).dashboard.queues.participants.map((item) => item.renewals), [[], []]);
});

test("origin, authentication and membership failures never query Team metadata", async (t) => {
  for (const [options, origin, expected] of [
    [{}, "https://unrelated.test", 403],
    [{ authenticated: false }, "https://example.test", 401],
    [{ authorised: false }, "https://example.test", 403],
  ]) await t.test(String(expected) + JSON.stringify(options), async () => {
    const { GET, calls } = fixture(options);
    const response = await GET(new Request("https://example.test/api/creditex/operations", { headers: { origin } }));
    assert.equal(response.status, expected);
    assert.deepEqual(calls, []);
  });
});

test("private case details do not expand into Team metadata", async () => {
  const { GET, calls } = fixture();
  const response = await GET(new Request("https://example.test/api/creditex/operations?caseId=case-a"));
  assert.deepEqual(await response.json(), { ok: true, workspace: { id: "case-a" } });
  assert.deepEqual(calls, []);
});

test("participant renewal UI distinguishes recorded expiry from verified cover", () => {
  const ui = fs.readFileSync(new URL("../src/components/CreditexOperationsWorkspace.tsx", import.meta.url), "utf8");
  const styles = fs.readFileSync(new URL("../src/components/CreditexOperationsWorkspace.module.css", import.meta.url), "utf8");
  assert.match(ui, /Team documents/);
  assert.match(ui, /Recorded expiry:/);
  assert.match(ui, /Due within 30 days/);
  assert.match(ui, /renewal\.status === "expired" \? "Expired"/);
  assert.match(ui, /Insurance cover and qualifications still require review/);
  assert.match(styles, /\.documentRenewals small\s*\{[^}]*font-size: \.75rem/s);
});
