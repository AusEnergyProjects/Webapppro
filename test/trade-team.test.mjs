import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const schema = read("../db/schema.ts");
const migration = read("../drizzle/0025_dizzy_spot.sql");
const route = read("../src/app/api/trade-team/route.ts");
const access = read("../src/lib/trade-team-server.ts");
const centre = read("../src/components/TradeTeamCentre.tsx");
const portal = read("../src/components/TradeTeamPortal.tsx");
const workspace = read("../src/components/InstallerCrmWorkspace.tsx");
const fieldRoute = read("../src/app/api/trade-field-work/route.ts");

test("team membership, secure invitations and job assignments are durable", () => {
  for (const table of ["trade_team_members", "trade_team_invites"]) {
    assert.match(schema, new RegExp(`sqliteTable\\("${table}"`));
    assert.match(migration, new RegExp("CREATE TABLE `" + table + "`"));
  }
  assert.match(schema, /assigneeMemberId: text\("assignee_member_id"\)/);
  assert.match(migration, /ALTER TABLE `trade_work_orders` ADD `assignee_member_id`/);
  assert.match(schema, /trade_team_members_owner_email_idx/);
  assert.match(schema, /trade_team_invites_token_idx/);
});

test("the team migration applies cleanly to SQLite", () => {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE trade_work_orders (id text PRIMARY KEY NOT NULL)");
  const statements = migration.split("--> statement-breakpoint").map((statement) => statement.trim()).filter(Boolean);
  for (const statement of statements) db.exec(statement);
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all().map((row) => row.name);
  assert.deepEqual(tables, ["trade_team_invites", "trade_team_members", "trade_work_orders"]);
  const columns = db.prepare("PRAGMA table_info(trade_work_orders)").all().map((row) => row.name);
  assert.ok(columns.includes("assignee_member_id"));
});

test("invitations are random, hashed, expiring, single-use and email bound", () => {
  assert.match(route, /crypto\.getRandomValues/);
  assert.match(route, /SHA-256/);
  assert.match(route, /token_hash = \?/);
  assert.match(route, /7 \* 24 \* 60 \* 60 \* 1000/);
  assert.match(route, /consumed_at = ''/);
  assert.match(route, /String\(invite\.email\)\.toLowerCase\(\) !== identity\.email/);
  assert.match(route, /must accept their secure invitation before the account can be activated/);
  assert.doesNotMatch(migration, /`token` text/);
});

test("owners manage people while dispatch and technician scopes are server enforced", () => {
  assert.match(access, /export function canManageTeam/);
  assert.match(access, /return access\.isOwner/);
  assert.match(access, /access\.role === "manager" \|\| access\.role === "coordinator"/);
  assert.match(access, /access\.role === "technician" && row\.assignee_member_id !== access\.memberId/);
  assert.match(route, /\? <> 'technician' OR w\.assignee_member_id = \?/);
  assert.match(route, /if \(!canManageTeam\(access\)\) throw new Error\("OWNER_REQUIRED"\)/);
  assert.match(route, /if \(!canDispatch\(access\)\) throw new Error\("DISPATCH_REQUIRED"\)/);
  assert.match(fieldRoute, /await assignedJob\(access,/);
  assert.match(access, /entitlements\.features\.team_access/);
});

test("team job payloads preserve protected-customer boundaries", () => {
  assert.match(route, /row\.source_type === "opportunity" \|\| row\.customer_source === "platform_private"/);
  assert.match(route, /const address = protectedJob \? ""/);
  assert.doesNotMatch(route, /c\.email|c\.phone|c\.first_name|c\.last_name/);
  assert.match(portal, /AEA protected job, no customer identity or street address/);
  assert.match(portal, /Direct customer address has not been added/);
  assert.match(portal, /Only work assigned to you is visible/);
});

test("the owner CRM and mobile staff portal expose progressive team workflows", () => {
  assert.match(workspace, /TradeTeamCentre/);
  assert.match(workspace, /hasTeamAccess/);
  assert.match(centre, /Dispatch board/);
  assert.match(centre, /Create a secure invitation/);
  assert.match(centre, /Assigned technician/);
  assert.match(centre, /invite pending/);
  assert.match(centre, /Preassigned\. Access begins after the invitation is accepted/);
  assert.match(route, /status IN \('active', 'invited'\)/);
  assert.match(portal, /Continue with Google/);
  assert.match(portal, /Create team login/);
  assert.match(portal, /Work queue/);
  assert.match(portal, /Job checklist/);
  assert.match(portal, /TradeFieldWorkPanel/);
});

test("team operations copy avoids prohibited dash characters", () => {
  assert.doesNotMatch(`${route}\n${access}\n${centre}\n${portal}`, /[\u2013\u2014]/);
});
