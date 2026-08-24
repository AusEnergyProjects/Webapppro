import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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

test("field sessions are one-time, device-bound, hashed and routed through team scope", async () => {
  const [server, team, sessionRoute, nativeSession, nativeApi] = await Promise.all([
    read("src/lib/trade-field-session-server.ts"),
    read("src/lib/trade-team-server.ts"),
    read("src/app/api/field/session/route.ts"),
    read("mobile/src/lib/field-session.ts"),
    read("mobile/src/lib/api.ts"),
  ]);
  assert.match(server, /PBKDF2/);
  assert.match(server, /210_000/);
  assert.match(server, /status = 'consumed'/);
  assert.match(server, /token_hash/);
  assert.match(server, /s\.device_id = \?/);
  assert.match(server, /sha256\(`\$\{normalizedName\}\\n\$\{clientAddress\}`\)/);
  assert.doesNotMatch(server, /sha256\(`\$\{input\.deviceId\}\\n\$\{normalizedName\}/);
  assert.match(server, /field-member:\$\{memberId\}/);
  assert.match(team, /isFieldSessionRequest\(request\)/);
  assert.match(sessionRoute, /readBoundedJsonRequest/);
  assert.match(sessionRoute, /APP_UPDATE_REQUIRED/);
  assert.match(nativeSession, /WHEN_UNLOCKED_THIS_DEVICE_ONLY/);
  assert.match(nativeApi, /TLinkField/);
});

test("the field calendar, self-intake, update control and TLink app entry remain connected", async () => {
  const [calendar, newJob, settings, dashboard, appPage, crmRoute] = await Promise.all([
    read("mobile/src/app/(tabs)/work.tsx"),
    read("mobile/src/app/new-job.tsx"),
    read("mobile/src/app/(tabs)/settings.tsx"),
    read("src/components/DirectTradeDashboard.tsx"),
    read("src/app/direct-trade/field-app/page.tsx"),
    read("src/app/api/trade-crm/route.ts"),
  ]);
  assert.match(calendar, /MY SCHEDULE/);
  assert.match(calendar, /router\.push\('\/new-job'\)/);
  assert.match(newJob, /rentalInspectionModulesJson/);
  assert.match(newJob, /assigneeMemberId: user\?\.memberId/);
  assert.match(settings, /Check for update/);
  assert.match(dashboard, />Get the app</);
  assert.match(appPage, /one-time field app PIN/);
  assert.match(crmRoute, /const selfScheduledCreate = action === "create_scheduled_job"/);
  assert.match(crmRoute, /identity\.access\.jobScope === "own"/);
  assert.match(crmRoute, /&& !selfScheduledCreate\) throw new Error\("JOB_RESCHEDULE_REQUIRED"\)/);
});

test("migration 0161 removes the minimum-only database assumption and retains non-empty unique scopes", async () => {
  const migration = await read("drizzle/0161_trade_field_access_and_rental_scope.sql");
  assert.match(migration, /json_extract\(`module_selection_snapshot`, '\$\[0\]'\) IN \('minimum_standards', 'electrical_safety_check', 'gas_safety_check', 'smoke_alarm_check'\)/);
  assert.doesNotMatch(migration, /json_extract\(`module_selection_snapshot`, '\$\[0\]'\) = 'minimum_standards'/);
  assert.match(migration, /json_array_length\(`module_selection_snapshot`\) BETWEEN 1 AND 4/);
  assert.match(migration, /CONSTRAINT `trade_rental_modules_required_check` CHECK \(`required` = 1\)/);
  assert.match(migration, /CREATE TABLE `trade_field_sessions`/);
  assert.match(migration, /CREATE UNIQUE INDEX `trade_field_sessions_token_idx`/);
});
