import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import {
  FIELD_ACCESS_MAX_ATTEMPTS,
  fieldAccessAttemptState,
  normalizeFieldAccessName,
  validFieldSetupPin,
} from "../src/lib/trade-field-access-policy.mjs";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("field access names and one-time PINs have a deterministic boundary", () => {
  assert.equal(normalizeFieldAccessName("  JoHn   Smith  "), "john smith");
  assert.equal(normalizeFieldAccessName("Ｊｏｈｎ　Ｓｍｉｔｈ"), "john smith");
  assert.equal(validFieldSetupPin("123456"), true);
  assert.equal(validFieldSetupPin("12345"), false);
  assert.equal(validFieldSetupPin("12345a"), false);
});

test("field PIN attempts reset by window and lock at the bounded threshold", () => {
  const now = Date.parse("2026-08-24T10:00:00.000Z");
  assert.deepEqual(fieldAccessAttemptState(null, now), { attempts: 0, locked: false, retryAt: "" });
  assert.deepEqual(fieldAccessAttemptState({ attempts: FIELD_ACCESS_MAX_ATTEMPTS - 1, updated_at: "2026-08-24T09:59:00.000Z", locked_until: "" }, now), {
    attempts: FIELD_ACCESS_MAX_ATTEMPTS - 1,
    locked: false,
    retryAt: "",
  });
  const locked = fieldAccessAttemptState({ attempts: FIELD_ACCESS_MAX_ATTEMPTS, updated_at: "2026-08-24T09:59:00.000Z", locked_until: "2026-08-24T10:10:00.000Z" }, now);
  assert.equal(locked.locked, true);
  assert.equal(locked.retryAt, "2026-08-24T10:10:00.000Z");
  assert.deepEqual(fieldAccessAttemptState({ attempts: 99, updated_at: "2026-08-24T09:30:00.000Z", locked_until: "" }, now), {
    attempts: 0,
    locked: false,
    retryAt: "",
  });
});

test("field sessions are one-time, device-bound, server-secret hashed and routed through team scope", async () => {
  const [server, team, sessionRoute, nativeSession, nativeApi] = await Promise.all([
    read("src/lib/trade-field-session-server.ts"),
    read("src/lib/trade-team-server.ts"),
    read("src/app/api/field/session/route.ts"),
    read("mobile/src/lib/field-session.ts"),
    read("mobile/src/lib/api.ts"),
  ]);
  assert.match(server, /TLINK_FIELD_PIN_PEPPER/);
  assert.match(server, /name: "HMAC", hash: "SHA-256"/);
  assert.match(server, /FIELD_ACCESS_NOT_CONFIGURED/);
  assert.match(server, /status = 'consumed'/);
  assert.match(server, /token_hash/);
  assert.match(server, /s\.device_id = \?/);
  assert.match(server, /sha256\(`\$\{normalizedName\}\\n\$\{clientAddress\}`\)/);
  assert.doesNotMatch(server, /sha256\(`\$\{input\.deviceId\}\\n\$\{normalizedName\}/);
  assert.match(server, /field-member:\$\{memberId\}/);
  assert.match(server, /displayName: String\(matched\.field_username \|\| access\.displayName\)/);
  assert.match(server, /fieldUsername: String\(row\.field_username \|\| ""\)/);
  assert.match(team, /isFieldSessionRequest\(request\)/);
  assert.match(sessionRoute, /readBoundedJsonRequest/);
  assert.match(sessionRoute, /APP_UPDATE_REQUIRED/);
  assert.match(nativeSession, /WHEN_UNLOCKED_THIS_DEVICE_ONLY/);
  assert.match(nativeApi, /TLinkField/);
});

test("the field calendar, self-intake, update control and TLink app entry remain connected", async () => {
  const [calendar, newJob, signIn, config, settings, dashboard, appPage, crmRoute] = await Promise.all([
    read("mobile/src/app/(tabs)/work.tsx"),
    read("mobile/src/app/new-job.tsx"),
    read("mobile/src/app/index.tsx"),
    read("mobile/src/lib/config.ts"),
    read("mobile/src/app/(tabs)/settings.tsx"),
    read("src/components/DirectTradeDashboard.tsx"),
    read("src/app/direct-trade/field-app/page.tsx"),
    read("src/app/api/trade-crm/route.ts"),
  ]);
  assert.match(calendar, /MY SCHEDULE/);
  assert.match(calendar, /router\.push\('\/new-job'\)/);
  assert.match(newJob, /rentalInspectionModulesJson/);
  assert.match(newJob, /assigneeMemberId: user\?\.memberId/);
  assert.match(signIn, /accessibilityLabel="Open TLink settings"/);
  assert.match(signIn, /Check for update/);
  assert.match(signIn, /Open secure install page/);
  assert.match(signIn, /Application\.nativeBuildVersion/);
  assert.match(config, /Application\.nativeApplicationVersion/);
  assert.match(config, /Constants\.expoConfig\?\.version/);
  assert.doesNotMatch(config, /APP_VERSION = '1\.0\.0'/);
  assert.match(settings, /Check for update/);
  assert.match(dashboard, /tlink-get-app[\s\S]*Get the app/);
  assert.match(appPage, /one-time field app PIN/);
  assert.match(crmRoute, /const selfScheduledCreate = action === "create_scheduled_job"/);
  assert.match(crmRoute, /identity\.access\.jobScope === "own"/);
  assert.match(crmRoute, /&& !selfScheduledCreate\) throw new Error\("JOB_RESCHEDULE_REQUIRED"\)/);
});

test("team members have an office-controlled unique TLink username for PIN setup", async () => {
  const [migration, schema, route, server, settings] = await Promise.all([
    read("drizzle/0162_trade_field_username.sql"),
    read("db/schema.ts"),
    read("src/app/api/trade-team/route.ts"),
    read("src/lib/trade-field-session-server.ts"),
    read("src/components/TradeTeamSettings.tsx"),
  ]);
  assert.match(migration, /ADD COLUMN `field_username` text NOT NULL DEFAULT ''/);
  assert.match(migration, /trade_team_members_owner_field_username_idx/);
  assert.match(schema, /fieldUsername: text\("field_username"\)/);
  assert.match(route, /fieldUsername: row\.field_username/);
  assert.match(route, /field_username_normalized = \?/);
  assert.match(server, /SELECT id, email, display_name, field_username, field_username_normalized, status/);
  assert.match(settings, /TLink username/);
  assert.match(settings, /Generate and email PIN/);
  assert.match(settings, /Copy username and PIN/);
  assert.match(settings, /Set up my app/);
});

test("migration 0162 enforces a unique normalized TLink username inside each business", async () => {
  const database = new DatabaseSync(":memory:");
  database.exec("CREATE TABLE trade_team_members (id text PRIMARY KEY, owner_uid text NOT NULL)");
  const migration = await read("drizzle/0162_trade_field_username.sql");
  for (const statement of migration.split("--> statement-breakpoint").map((value) => value.trim()).filter(Boolean)) {
    database.exec(statement);
  }
  database.prepare(`INSERT INTO trade_team_members
    (id, owner_uid, field_username, field_username_normalized) VALUES (?, ?, ?, ?)`)
    .run("member-1", "owner-1", "John Smith", "john smith");
  assert.throws(() => database.prepare(`INSERT INTO trade_team_members
    (id, owner_uid, field_username, field_username_normalized) VALUES (?, ?, ?, ?)`)
    .run("member-2", "owner-1", "JOHN  SMITH", "john smith"), /UNIQUE constraint failed/);
  assert.doesNotThrow(() => database.prepare(`INSERT INTO trade_team_members
    (id, owner_uid, field_username, field_username_normalized) VALUES (?, ?, ?, ?)`)
    .run("member-3", "owner-2", "John Smith", "john smith"));
});

test("migration 0161 adds authoritative scopes without rebuilding referenced rental tables", async () => {
  const migration = await read("drizzle/0161_trade_field_access_and_rental_scope.sql");
  assert.match(migration, /ALTER TABLE `trade_rental_inspections` ADD COLUMN `selected_modules_snapshot`/);
  assert.match(migration, /json_array_length\(`selected_modules_snapshot`\) BETWEEN 1 AND 4/);
  assert.match(migration, /json_array_length\(`selected_modules_snapshot`\) < 2 OR json_extract\(`selected_modules_snapshot`, '\$\[1\]'\) <>/);
  assert.match(migration, /json_array_length\(`selected_modules_snapshot`\) < 3 OR json_extract\(`selected_modules_snapshot`, '\$\[2\]'\) NOT IN/);
  assert.match(migration, /json_array_length\(`selected_modules_snapshot`\) < 4 OR json_extract\(`selected_modules_snapshot`, '\$\[3\]'\) NOT IN/);
  assert.match(migration, /ALTER TABLE `trade_rental_inspection_modules` ADD COLUMN `selected_required` integer CHECK \(`selected_required` IS NULL OR `selected_required` = 1\)/);
  assert.doesNotMatch(migration, /DROP TABLE `trade_rental_inspections`/);
  assert.doesNotMatch(migration, /DROP TABLE `trade_rental_inspection_modules`/);
  assert.match(migration, /DROP TRIGGER IF EXISTS `trade_rental_inspections_terminal_immutable`/);
  assert.match(migration, /DROP TRIGGER IF EXISTS `trade_rental_modules_parent_guard_insert`/);
  assert.match(migration, /CREATE TABLE `trade_field_sessions`/);
  assert.match(migration, /CREATE UNIQUE INDEX `trade_field_sessions_token_idx`/);
});

test("new rental jobs separate the exact selected scope from the legacy minimum-first shadow", async () => {
  const [crmRoute, guards, report, sync] = await Promise.all([
    read("src/app/api/trade-crm/route.ts"),
    read("src/lib/trade-rental-schema-guards.ts"),
    read("src/lib/trade-rental-report-server.ts"),
    read("src/app/api/trade-team/sync/route.ts"),
  ]);
  assert.match(crmRoute, /const rentalCompatibilityModuleKeys/);
  assert.match(crmRoute, /module_selection_snapshot, selected_modules_snapshot/);
  assert.match(crmRoute, /moduleKey === "minimum_standards" \? 1 : 0/);
  assert.match(crmRoute, /required, selected_required, status/);
  assert.match(guards, /COALESCE\(inspection\.selected_modules_snapshot, inspection\.module_selection_snapshot\)/);
  assert.match(report, /inspection\.selected_modules_snapshot \|\| inspection\.module_selection_snapshot/);
  assert.match(sync, /rental\.selected_modules_snapshot \|\| rental\.module_selection_snapshot/);
});
