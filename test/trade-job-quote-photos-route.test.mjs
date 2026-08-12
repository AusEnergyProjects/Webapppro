import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import ts from "typescript";

const source = fs.readFileSync(new URL("../src/app/api/trade-job-quote-photos/route.ts", import.meta.url), "utf8");

const jobs = [
  { id: "job-own", owner: "owner-1", assignee: "member-1", source_type: "public_lead", customer_source: "public_lead_released" },
  { id: "job-team", owner: "owner-1", assignee: "member-2", source_type: "public_lead", customer_source: "public_lead_released" },
  { id: "job-private", owner: "owner-1", assignee: "member-1", source_type: "internal", customer_source: "platform_private" },
];
const media = [
  { id: "accepted-own", owner: "owner-1", job: "job-own", source: "accepted_public_lead", content_type: "image/jpeg",
    object_key: "accepted/own.jpg", file_name: "customer.jpg", caption: "Front of property", size_bytes: 12, created_at: "2026-08-12T00:00:00.000Z" },
  { id: "ordinary-own", owner: "owner-1", job: "job-own", source: "field", content_type: "image/jpeg",
    object_key: "field/own.jpg", file_name: "field.jpg", caption: "Field photo", size_bytes: 10, created_at: "2026-08-12T00:01:00.000Z" },
  { id: "cross-tenant", owner: "owner-2", job: "job-own", source: "accepted_public_lead", content_type: "image/jpeg",
    object_key: "accepted/cross.jpg", file_name: "cross.jpg", caption: "Cross", size_bytes: 10, created_at: "2026-08-12T00:02:00.000Z" },
  { id: "accepted-team", owner: "owner-1", job: "job-team", source: "accepted_public_lead", content_type: "image/png",
    object_key: "accepted/team.png", file_name: "team.png", caption: "Switchboard", size_bytes: 14, created_at: "2026-08-12T00:03:00.000Z" },
  { id: "accepted-private", owner: "owner-1", job: "job-private", source: "accepted_public_lead", content_type: "image/jpeg",
    object_key: "accepted/private.jpg", file_name: "private.jpg", caption: "Private", size_bytes: 11, created_at: "2026-08-12T00:04:00.000Z" },
];

function access(overrides = {}) {
  return { ownerUid: "owner-1", actorUid: "actor-1", memberId: "member-1", isOwner: false,
    jobScope: "own", canViewQuotes: true, ...overrides };
}

function loadRoute(accessRecord) {
  const audits = [];
  class Statement {
    constructor(sql, values = []) { this.sql = sql; this.values = values; }
    bind(...values) { return new Statement(this.sql, values); }
    async all() {
      if (!this.sql.includes("FROM trade_crm_job_media")) return { results: [] };
      const [owner, job] = this.values;
      return { results: media.filter((row) => row.owner === owner && row.job === job
        && row.source === "accepted_public_lead" && ["image/jpeg", "image/png"].includes(row.content_type))
        .map((row) => ({ id: row.id, caption: row.caption, content_type: row.content_type,
          size_bytes: row.size_bytes, created_at: row.created_at })) };
    }
    async first() {
      if (!this.sql.includes("FROM trade_crm_job_media")) return null;
      const [id, owner, job] = this.values;
      const row = media.find((item) => item.id === id && item.owner === owner && item.job === job
        && item.source === "accepted_public_lead" && ["image/jpeg", "image/png"].includes(item.content_type));
      return row ? { id: row.id, object_key: row.object_key, content_type: row.content_type, file_name: row.file_name } : null;
    }
    async run() { audits.push(this.values); return { success: true, meta: { changes: 1 } }; }
  }
  const db = { prepare: (sql) => new Statement(sql) };
  const bucket = { get: async (key) => key === "accepted/own.jpg"
    ? { body: new Uint8Array([1, 2, 3]), httpMetadata: { contentType: "image/jpeg" } }
    : key === "accepted/team.png" ? { body: new Uint8Array([4]), httpMetadata: { contentType: "image/png" } } : null };
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    fileName: "src/app/api/trade-job-quote-photos/route.ts",
  }).outputText;
  const mocks = {
    "cloudflare:workers": { env: { EVIDENCE: bucket } }, "../../../../db": { getD1: () => db },
    "@/lib/admin-server": { adminJson: (value, status = 200) => Response.json(value, { status }),
      cleanAdminText: (value, maximum) => String(value || "").trim().slice(0, maximum),
      sameOrigin: (request) => !request.headers.get("origin") || request.headers.get("origin") === new URL(request.url).origin },
    "@/lib/trade-team-server": {
      requireInstallerTeamAccess: async () => { if (!accessRecord) throw new Error("AUTH_REQUIRED"); return accessRecord; },
      canViewQuotes: (value) => value.canViewQuotes,
      assignedJob: async (value, workOrderId) => {
        const job = jobs.find((item) => item.id === workOrderId && item.owner === value.ownerUid);
        if (!job) throw new Error("JOB_NOT_FOUND");
        if (!value.isOwner && value.jobScope === "own" && job.assignee !== value.memberId) throw new Error("JOB_NOT_ASSIGNED");
        return job;
      },
    },
  };
  const moduleRecord = { exports: {} };
  const require = (specifier) => {
    if (Object.hasOwn(mocks, specifier)) return mocks[specifier];
    throw new Error(`Unexpected module dependency: ${specifier}`);
  };
  new Function("require", "module", "exports", output)(require, moduleRecord, moduleRecord.exports);
  return { route: moduleRecord.exports, audits };
}

const request = (query, origin = "") => new Request(`https://test/api/trade-job-quote-photos?${query}`,
  origin ? { headers: { origin } } : undefined);

test("accepted job-photo listing is same-origin, authenticated, quote-authorised and exact-scope", async () => {
  assert.equal((await loadRoute(access()).route.GET(request("workOrderId=job-own", "https://evil.test"))).status, 403);
  assert.equal((await loadRoute(null).route.GET(request("workOrderId=job-own"))).status, 401);
  assert.equal((await loadRoute(access({ canViewQuotes: false })).route.GET(request("workOrderId=job-own"))).status, 403);
  const own = await loadRoute(access()).route.GET(request("workOrderId=job-own"));
  assert.equal(own.status, 200);
  assert.deepEqual((await own.json()).acceptedPhotos.map((row) => row.id), ["accepted-own"]);
  assert.equal((await loadRoute(access()).route.GET(request("workOrderId=job-team"))).status, 403);
  const team = await loadRoute(access({ memberId: "dispatcher", jobScope: "team" })).route.GET(request("workOrderId=job-team"));
  assert.deepEqual((await team.json()).acceptedPhotos.map((row) => row.id), ["accepted-team"]);
  assert.equal((await loadRoute(access()).route.GET(request("workOrderId=job-private"))).status, 404);
});

test("accepted job-photo content excludes cross-tenant and unaccepted media and records a hardened inline view", async () => {
  const harness = loadRoute(access());
  assert.equal((await harness.route.GET(request("workOrderId=job-own&mediaId=ordinary-own"))).status, 404);
  assert.equal((await harness.route.GET(request("workOrderId=job-own&mediaId=cross-tenant"))).status, 404);
  assert.equal(harness.audits.length, 0);
  const response = await harness.route.GET(request("workOrderId=job-own&mediaId=accepted-own"));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("content-security-policy"), "sandbox");
  assert.match(response.headers.get("content-disposition"), /^inline;/);
  assert.equal(harness.audits.length, 1);
  assert.equal(harness.audits[0][1], "owner-1");
  assert.equal(harness.audits[0][2], "job-own");
  assert.equal(harness.audits[0][3], "accepted-own");
  assert.ok(Number.isFinite(Date.parse(harness.audits[0][6])));
});
