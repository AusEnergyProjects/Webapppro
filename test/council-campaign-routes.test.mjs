import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { transformSync } from "esbuild";
import * as campaignContract from "../src/lib/council-campaigns.ts";
import * as campaignServer from "../src/lib/council-campaign-server.ts";
import * as boundedJson from "../src/lib/bounded-json-request.ts";
import { residentialStateFromPostcode } from "../src/lib/australian-postcodes.mjs";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
function load(path, dependencies) {
  const compiled = transformSync(read(path), { loader: "ts", format: "cjs", target: "es2022" }).code;
  const record = { exports: {} };
  Function("require", "module", "exports", compiled)((name) => {
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency ${name}`);
    return dependencies[name];
  }, record, record.exports);
  return record.exports;
}

function fixture() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys=ON; CREATE TABLE trade_opportunities(id TEXT PRIMARY KEY);");
  sqlite.exec("CREATE TABLE admin_audit_log(id TEXT PRIMARY KEY,admin_uid TEXT NOT NULL,action TEXT NOT NULL,entity_type TEXT NOT NULL,entity_id TEXT NOT NULL,summary TEXT NOT NULL,metadata TEXT NOT NULL,created_at TEXT NOT NULL)");
  for (const statement of read("../drizzle/0250_council_workspace.sql").split("--> statement-breakpoint")) if (statement.trim()) sqlite.exec(statement);
  sqlite.exec(`INSERT INTO council_organisations VALUES
    ('owned','Owned Council','owned-council','VIC','active','now','now'),
    ('other','Other Council','other-council','VIC','active','now','now');
    INSERT INTO council_postcodes VALUES ('owned','VIC','3175','admin','now'),('other','VIC','3805','admin','now');
    INSERT INTO council_memberships(id,council_id,firebase_uid,email,role,status,invited_by_uid,created_at,updated_at)
      VALUES ('member','owned','member-1','member@example.test','editor','active','admin','now','now');`);
  let afterBody = null;
  let beforeBatch = null;
  const statement = (sql, bindings = []) => ({
    sql,
    bind: (...values) => statement(sql, values),
    first: async () => sqlite.prepare(sql).get(...bindings) || null,
    all: async () => ({ results: sqlite.prepare(sql).all(...bindings) }),
    run: async () => ({ success: true, meta: { changes: Number(sqlite.prepare(sql).run(...bindings).changes) } }),
    execute: () => {
      const query = sqlite.prepare(sql);
      return /^\s*SELECT\b/i.test(sql) ? { success: true, results: query.all(...bindings), meta: { changes: 0 } }
        : { success: true, results: [], meta: { changes: Number(query.run(...bindings).changes) } };
    },
  });
  const db = { prepare: statement, batch: async (statements) => {
    // Revoke immediately before the guarded mutation, after access has resolved.
    if (statements.some(item => /^\s*INSERT INTO admin_audit_log\b/i.test(item.sql))) {
      const hook = beforeBatch; beforeBatch = null; hook?.();
    }
    sqlite.exec("BEGIN");
    try { const result = statements.map(item => item.execute()); sqlite.exec("COMMIT"); return result; }
    catch (error) { sqlite.exec("ROLLBACK"); throw error; }
  } };
  const access = load("../src/lib/council-access-server.ts", {
    "../../db": { getD1: () => db },
    "./firebase-server": { requireFirebaseIdentity: async () => ({ uid: "member-1", email: "member@example.test", emailVerified: true }) },
  });
  const bodyReader = {
    ...boundedJson,
    readBoundedJsonRequest: async request => {
      const raw = await boundedJson.readBoundedJsonRequest(request);
      const hook = afterBody; afterBody = null; hook?.();
      return raw;
    },
  };
  const campaigns = load("../src/app/api/council/campaigns/route.ts", {
    "@/lib/council-access-server": access, "@/lib/council-campaign-server": campaignServer,
    "@/lib/council-campaigns": campaignContract, "@/lib/bounded-json-request": bodyReader,
  });
  const scopes = load("../src/app/api/council/scope-requests/route.ts", {
    "@/lib/council-access-server": access, "@/lib/bounded-json-request": bodyReader,
    "@/lib/australian-postcodes.mjs": { residentialStateFromPostcode },
  });
  const seedCampaign = (id, council = "owned") => {
    sqlite.prepare(`INSERT INTO council_campaigns
      (id,council_id,code,title,kind,audience,status,created_at,updated_at)
      VALUES (?,?,?,'Community upgrades','campaign','everyone','active','now','now')`).run(id, council, `${id}-reference`);
  };
  return { sqlite, campaigns, scopes, seedCampaign,
    setRole: value => sqlite.prepare("UPDATE council_memberships SET role=? WHERE id='member'").run(value),
    setAllowed: value => sqlite.prepare("UPDATE council_memberships SET status=? WHERE id='member'").run(value ? "active" : "suspended"),
    afterBody: hook => { afterBody = hook; }, beforeBatch: hook => { beforeBatch = hook; }, close: () => sqlite.close() };
}

const campaign = { title: "Community upgrades", kind: "campaign", audience: "everyone" };
function request(kind = "campaigns", { method = "GET", body, councilId = "owned", origin = "https://example.test" } = {}) {
  return new Request(`https://example.test/api/council/${kind}?councilId=${councilId}`, {
    method, ...(method === "GET" ? {} : { body: typeof body === "string" ? body : JSON.stringify(body), headers: { "Content-Type": "application/json", ...(origin === null ? {} : { Origin: origin }) } }),
  });
}

test("campaign GET returns only the selected membership's campaign records with private no-store caching", async () => {
  const f = fixture();
  try {
    f.seedCampaign("mine"); f.seedCampaign("theirs", "other");
    const response = await f.campaigns.GET(request());
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
    assert.equal(response.headers.get("Vary"), "Authorization");
    const body = await response.json();
    assert.deepEqual(body.campaigns.map((row) => row.id), ["mine"]);
    assert.equal((await f.campaigns.GET(request("campaigns", { councilId: "other" }))).status, 403);
    f.setAllowed(false);
    assert.equal((await f.campaigns.GET(request())).status, 403);
  } finally { f.close(); }
});

test("campaign mutations require exact origin, active membership and editor rights", async () => {
  const f = fixture();
  try {
    for (const origin of [null, "https://hostile.test"]) assert.equal((await f.campaigns.POST(request("campaigns", { method: "POST", body: campaign, origin }))).status, 403);
    f.setRole("viewer");
    assert.equal((await f.campaigns.POST(request("campaigns", { method: "POST", body: campaign }))).status, 403);
    assert.equal((await f.campaigns.PATCH(request("campaigns", { method: "PATCH", body: { ...campaign, id: "mine", status: "paused" } }))).status, 403);
    f.setRole("editor"); f.setAllowed(false);
    assert.equal((await f.campaigns.POST(request("campaigns", { method: "POST", body: campaign }))).status, 403);
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM council_campaigns").get().n, 0);
  } finally { f.close(); }
});

test("campaign create ignores client ownership and supplies an opaque reference; update is tenant bound", async () => {
  const f = fixture();
  try {
    const created = await f.campaigns.POST(request("campaigns", { method: "POST", body: { ...campaign, councilId: "other", code: "attacker-code", status: "paused" } }));
    assert.equal(created.status, 201);
    const current = (await created.json()).campaigns[0];
    assert.equal(current.councilId, "owned"); assert.equal(current.status, "active");
    assert.match(current.code, /^[a-f0-9]{32}$/);
    assert.equal(current.shareUrl, `/council/program/${current.code}`);
    f.seedCampaign("theirs", "other");
    assert.equal((await f.campaigns.PATCH(request("campaigns", { method: "PATCH", body: { ...campaign, id: "theirs", status: "paused" } }))).status, 404);
    assert.equal(f.sqlite.prepare("SELECT status FROM council_campaigns WHERE id='theirs'").get().status, "active");
    const updated = await f.campaigns.PATCH(request("campaigns", { method: "PATCH", body: { ...campaign, title: "Updated campaign", id: current.id, status: "paused" } }));
    assert.equal(updated.status, 200);
    const stored = f.sqlite.prepare("SELECT title,status,code FROM council_campaigns WHERE id=?").get(current.id);
    assert.equal(stored.status, "paused"); assert.equal(stored.title, "Updated campaign"); assert.equal(stored.code, current.code);
  } finally { f.close(); }
});

test("session campaigns require a time zone and venue or safe HTTPS meeting URL", async () => {
  const f = fixture();
  try {
    const session = { title: "Community information session", kind: "session", audience: "businesses", startsAt: "2026-10-08T17:00:00+11:00", meetingUrl: "https://meeting.example/council" };
    for (const change of [{ startsAt: "2026-10-08T17:00:00" }, { meetingUrl: "javascript:alert(1)" }, { meetingUrl: "https://user:password@meeting.example/council" }, { meetingUrl: "" }]) {
      assert.equal((await f.campaigns.POST(request("campaigns", { method: "POST", body: { ...session, ...change } }))).status, 400);
    }
    const result = await f.campaigns.POST(request("campaigns", { method: "POST", body: session }));
    assert.equal(result.status, 201);
    assert.equal((await result.json()).campaigns[0].startsAt, "2026-10-08T06:00:00.000Z");
  } finally { f.close(); }
});

test("campaign body size, malformed JSON and invalid status fail without mutation", async () => {
  const f = fixture();
  try {
    assert.equal((await f.campaigns.POST(request("campaigns", { method: "POST", body: "{" }))).status, 400);
    assert.equal((await f.campaigns.POST(request("campaigns", { method: "POST", body: { ...campaign, title: "a".repeat(17000) } }))).status, 413);
    f.seedCampaign("mine");
    assert.equal((await f.campaigns.PATCH(request("campaigns", { method: "PATCH", body: { ...campaign, id: "mine", status: "deleted" } }))).status, 400);
    assert.equal(f.sqlite.prepare("SELECT status FROM council_campaigns WHERE id='mine'").get().status, "active");
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM council_campaigns").get().n, 1);
  } finally { f.close(); }
});

test("campaign register reaches its published limit without silently dropping older records", async () => {
  const f = fixture();
  try {
    for (let i = 0; i < 200; i++) f.seedCampaign(`campaign-${i}`);
    assert.equal((await f.campaigns.POST(request("campaigns", { method: "POST", body: campaign }))).status, 409);
    assert.equal((await (await f.campaigns.GET(request())).json()).campaigns.length, 200);
  } finally { f.close(); }
});

test("postcode requests enforce role, origin, geography and cannot alter approved scope", async () => {
  const f = fixture();
  try {
    for (const origin of [null, "https://hostile.test"]) assert.equal((await f.scopes.POST(request("scope-requests", { method: "POST", body: { postcodes: ["3977"] }, origin }))).status, 403);
    f.setRole("viewer");
    assert.equal((await f.scopes.POST(request("scope-requests", { method: "POST", body: { postcodes: ["3977"] } }))).status, 403);
    f.setRole("owner");
    for (const postcodes of [[], ["2000"], ["3175"], [3977], ["abc"], Array(101).fill("3977")]) {
      assert.equal((await f.scopes.POST(request("scope-requests", { method: "POST", body: { postcodes } }))).status, 400);
    }
    const response = await f.scopes.POST(request("scope-requests", { method: "POST", body: { councilId: "other", status: "approved", postcodes: ["3977", "3977", "3175"] } }));
    assert.equal(response.status, 201);
    const stored = f.sqlite.prepare("SELECT council_id,status,postcodes_json,requested_by_uid FROM council_scope_requests").get();
    assert.equal(stored.council_id, "owned"); assert.equal(stored.status, "pending"); assert.equal(stored.postcodes_json, '["3977"]'); assert.equal(stored.requested_by_uid, "member-1");
    assert.deepEqual(f.sqlite.prepare("SELECT postcode FROM council_postcodes WHERE council_id='owned'").all().map((row) => row.postcode), ["3175"]);
    assert.equal((await f.scopes.POST(request("scope-requests", { method: "POST", body: { postcodes: ["3805"] } }))).status, 409);
  } finally { f.close(); }
});

test("postcode request GET excludes other councils and actor identifiers", async () => {
  const f = fixture();
  try {
    f.sqlite.exec(`INSERT INTO council_scope_requests (id,council_id,postcodes_json,requested_by_uid,created_at)
      VALUES ('mine','owned','["3977"]','private-actor','now'),('theirs','other','["3175"]','other-actor','now');`);
    const response = await f.scopes.GET(request("scope-requests"));
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body.requests.map((row) => row.id), ["mine"]);
    assert.equal(JSON.stringify(body).includes("private-actor"), false);
    assert.equal((await f.scopes.GET(request("scope-requests", { councilId: "other" }))).status, 403);
    f.setAllowed(false);
    assert.equal((await f.scopes.GET(request("scope-requests"))).status, 403);
  } finally { f.close(); }
});

test("postcode requests reject oversized and malformed bodies without durable changes", async () => {
  const f = fixture();
  try {
    assert.equal((await f.scopes.POST(request("scope-requests", { method: "POST", body: "{" }))).status, 400);
    assert.equal((await f.scopes.POST(request("scope-requests", { method: "POST", body: { note: "a".repeat(17000), postcodes: ["3977"] } }))).status, 413);
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM council_scope_requests").get().n, 0);
  } finally { f.close(); }
});

test("storage failures return generic unavailability without exposing SQL details", async () => {
  const f = fixture();
  try {
    f.sqlite.exec("DROP TABLE council_attributions; DROP TABLE council_campaigns; DROP TABLE council_scope_requests;");
    for (const response of [await f.campaigns.GET(request()), await f.scopes.GET(request("scope-requests"))]) {
      assert.equal(response.status, 503);
      assert.doesNotMatch(JSON.stringify(await response.json()), /SELECT|council_campaigns|no such table/);
    }
  } finally { f.close(); }
});

test("campaign and scope writes cannot outlive a membership or council access change during body parsing or before the transaction", async () => {
  const changes = [
    "UPDATE council_memberships SET status='suspended' WHERE id='member'",
    "UPDATE council_memberships SET role='viewer' WHERE id='member'",
    "UPDATE council_organisations SET status='suspended' WHERE id='owned'",
    "UPDATE council_memberships SET council_id='other' WHERE id='member'",
  ];
  for (const moment of ["afterBody", "beforeBatch"]) for (const change of changes) for (const operation of ["create", "update", "scope"]) {
    const f = fixture();
    try {
      f.seedCampaign("mine");
      f[moment](() => f.sqlite.exec(change));
      const response = operation === "scope"
        ? await f.scopes.POST(request("scope-requests", { method: "POST", body: { postcodes: ["3977"] } }))
        : operation === "update"
          ? await f.campaigns.PATCH(request("campaigns", { method: "PATCH", body: { ...campaign, title: "Changed", id: "mine", status: "paused" } }))
          : await f.campaigns.POST(request("campaigns", { method: "POST", body: campaign }));
      assert.equal(response.status, 403, `${moment}: ${operation}: ${change}`);
      assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM council_campaigns").get().n, 1);
      assert.equal(f.sqlite.prepare("SELECT status FROM council_campaigns WHERE id='mine'").get().status, "active");
      assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM council_scope_requests").get().n, 0);
      assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM admin_audit_log").get().n, 0);
    } finally { f.close(); }
  }
});

test("a concurrent create at the campaign limit or a pending scope request is checked inside the transaction", async () => {
  const f = fixture();
  try {
    for (let i = 0; i < 199; i++) f.seedCampaign(`campaign-${i}`);
    f.beforeBatch(() => f.seedCampaign("concurrent"));
    assert.equal((await f.campaigns.POST(request("campaigns", { method: "POST", body: campaign }))).status, 409);
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM council_campaigns").get().n, 200);
    f.beforeBatch(() => f.sqlite.exec(`INSERT INTO council_scope_requests(id,council_id,postcodes_json,requested_by_uid,created_at)
      VALUES ('concurrent','owned','["3805"]','member-1','now')`));
    assert.equal((await f.scopes.POST(request("scope-requests", { method: "POST", body: { postcodes: ["3977"] } }))).status, 409);
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM council_scope_requests").get().n, 1);
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM admin_audit_log").get().n, 0);
  } finally { f.close(); }
});

test("successful mutations record their actor and tenant and a failed mutation rolls its audit back", async () => {
  const f = fixture();
  try {
    assert.equal((await f.campaigns.POST(request("campaigns", { method: "POST", body: campaign }))).status, 201);
    assert.equal((await f.scopes.POST(request("scope-requests", { method: "POST", body: { postcodes: ["3977"] } }))).status, 201);
    const audits = f.sqlite.prepare("SELECT admin_uid,entity_id,action,metadata FROM admin_audit_log ORDER BY action").all();
    assert.equal(audits.length, 2);
    assert.ok(audits.every(row => row.admin_uid === "member-1" && row.entity_id === "owned"));
    assert.equal(JSON.parse(audits.find(row => row.action === "council.scope_requested").metadata).postcodes[0], "3977");
    f.sqlite.exec("CREATE TRIGGER reject_campaign_update BEFORE UPDATE ON council_campaigns BEGIN SELECT RAISE(ABORT,'test storage failure'); END");
    const id = f.sqlite.prepare("SELECT id FROM council_campaigns").get().id;
    const failed = await f.campaigns.PATCH(request("campaigns", { method: "PATCH", body: { ...campaign, id, status: "paused" } }));
    assert.equal(failed.status, 503);
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM admin_audit_log").get().n, 2);
    assert.equal(f.sqlite.prepare("SELECT status FROM council_campaigns WHERE id=?").get(id).status, "active");
  } finally { f.close(); }
});
