import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const schema = read("../db/schema.ts");
const migration = read("../drizzle/0026_lovely_zodiak.sql");
const mobileMigration = read("../drizzle/0027_handy_the_anarchist.sql");
const syncRoute = read("../src/app/api/trade-team/sync/route.ts");
const deviceRoute = read("../src/app/api/trade-team/devices/route.ts");
const mediaRoute = read("../src/app/api/trade-team/media/route.ts");
const mobileServer = read("../src/lib/trade-mobile-server.ts");
const syncServer = read("../src/lib/trade-team-sync-server.ts");
const teamCentre = read("../src/components/TradeTeamCentre.tsx");
const teamRoute = read("../src/app/api/trade-team/route.ts");
const workRoute = read("../src/app/api/trade-work-orders/route.ts");
const crmRoute = read("../src/app/api/trade-crm/route.ts");
const fieldRoute = read("../src/app/api/trade-field-work/route.ts");
const roadmap = read("../ROADMAP.md");
const contract = read("../docs/MOBILE_FIELD_SYNC.md");

test("offline revisions, action receipts and sync changes are durable and indexed", () => {
  assert.match(schema, /revision: integer\("revision"\)\.notNull\(\)\.default\(1\)/);
  assert.match(schema, /sqliteTable\("trade_team_sync_changes"/);
  assert.match(schema, /sqliteTable\("trade_offline_actions"/);
  assert.match(schema, /primaryKey\(\{ autoIncrement: true \}\)/);
  assert.match(schema, /trade_team_sync_changes_owner_sequence_idx/);
  assert.match(schema, /trade_offline_actions_owner_client_idx/);
  assert.match(schema, /sqliteTable\("trade_mobile_devices"/);
  assert.match(schema, /sqliteTable\("trade_mobile_upload_sessions"/);
  assert.match(schema, /sqliteTable\("trade_mobile_upload_parts"/);
  assert.match(schema, /sqliteTable\("trade_mobile_push_outbox"/);
  assert.match(migration, /ALTER TABLE `trade_work_orders` ADD `revision`/);
  assert.match(migration, /ALTER TABLE `trade_work_order_tasks` ADD `revision`/);
});

test("the offline sync migration applies cleanly and enforces idempotency", () => {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE trade_work_orders (id text PRIMARY KEY NOT NULL)");
  db.exec("CREATE TABLE trade_work_order_tasks (id text PRIMARY KEY NOT NULL)");
  for (const statement of migration.split("--> statement-breakpoint").map((item) => item.trim()).filter(Boolean)) db.exec(statement);
  for (const statement of mobileMigration.split("--> statement-breakpoint").map((item) => item.trim()).filter(Boolean)) db.exec(statement);
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name);
  assert.ok(tables.includes("trade_team_sync_changes"));
  assert.ok(tables.includes("trade_offline_actions"));
  assert.ok(tables.includes("trade_mobile_devices"));
  assert.ok(tables.includes("trade_mobile_upload_sessions"));
  db.prepare(`INSERT INTO trade_offline_actions
    (id, owner_uid, actor_uid, member_id, device_id, client_action_id, payload_hash, action_type,
     entity_type, entity_id, base_revision, result_revision, status, created_at)
    VALUES ('1', 'owner', 'actor', '', 'device-123', 'action-123', 'hash', 'set_job_stage', 'job', 'job-1', 1, 2, 'applied', 'now')`).run();
  assert.throws(() => db.prepare(`INSERT INTO trade_offline_actions
    (id, owner_uid, actor_uid, member_id, device_id, client_action_id, payload_hash, action_type,
     entity_type, entity_id, base_revision, result_revision, status, created_at)
    VALUES ('2', 'owner', 'actor', '', 'device-123', 'action-123', 'hash', 'set_job_stage', 'job', 'job-1', 1, 2, 'applied', 'now')`).run());
  db.prepare(`INSERT INTO trade_mobile_devices
    (id, owner_uid, actor_uid, member_id, device_id, platform, app_version, registered_at, last_seen_at, updated_at)
    VALUES ('d1', 'owner', 'actor', '', 'device-123', 'ios', '1.0.0', 'now', 'now', 'now')`).run();
  assert.throws(() => db.prepare(`INSERT INTO trade_mobile_devices
    (id, owner_uid, actor_uid, member_id, device_id, platform, app_version, registered_at, last_seen_at, updated_at)
    VALUES ('d2', 'owner', 'actor', '', 'device-123', 'ios', '1.0.0', 'now', 'now', 'now')`).run());
});

test("the mobile sync contract is authenticated, assignment scoped and cursor bounded", () => {
  assert.match(syncRoute, /requireInstallerTeamAccess\(request\)/);
  assert.match(syncRoute, /sameOrigin\(request\)/);
  assert.match(syncRoute, /\? <> 'technician' OR w\.assignee_member_id = \?/);
  assert.match(syncRoute, /MAX_CHANGES = 200/);
  assert.match(syncRoute, /MAX_ACTIONS = 50/);
  assert.match(syncRoute, /\^v1:\(\\d\+\)\$/);
  assert.match(syncRoute, /nextCursor: `v1:\$\{next\}`/);
  assert.match(syncRoute, /hasMore/);
  assert.match(syncRoute, /requireRegisteredMobileDevice/);
  assert.match(syncRoute, /MOBILE_CONTRACT_VERSION/);
  const getHandler = syncRoute.slice(syncRoute.indexOf("export async function GET"), syncRoute.indexOf("function actionReceiptStatement"));
  assert.ok(getHandler.indexOf("const next = await highWater(access)") < getHandler.indexOf("const jobs = await accessibleJobs(access)"));
  assert.ok(getHandler.indexOf("FROM trade_team_sync_changes WHERE") < getHandler.lastIndexOf("const jobs = await accessibleJobs(access)"));
});

test("mobile payloads preserve AEA customer privacy and short-lived direct addresses", () => {
  assert.match(syncRoute, /row\.source_type === "opportunity" \|\| row\.customer_source === "platform_private"/);
  assert.match(syncRoute, /const directCustomer = !protectedJob && row\.customer_source === "trade_owned"/);
  assert.match(syncRoute, /const serviceAddress = directCustomer \?/);
  assert.doesNotMatch(syncRoute, /c\.email/);
  assert.match(syncRoute, /customerName: protectedJob \? "AEA protected customer"/);
  assert.match(syncRoute, /customerPhone: directCustomer \?/);
  assert.match(syncRoute, /containsPersonalData: Boolean\(serviceAddress \|\| \(directCustomer && row\.customer_phone\)\)/);
  assert.match(syncRoute, /maxAgeSeconds: serviceAddress \|\| \(directCustomer && row\.customer_phone\) \? 86_400 : 604_800/);
  assert.match(mobileServer, /protectedCustomerContactDataAllowed: false/);
  assert.match(syncRoute, /purgeWhenUnassigned: true/);
  assert.match(syncRoute, /PROTECTED_CUSTOMER_DATA/);
});

test("queued actions are hashed, idempotent and revision conflict aware", () => {
  assert.match(syncRoute, /SHA-256/);
  assert.match(syncRoute, /payload_hash/);
  assert.match(syncRoute, /IDEMPOTENCY_MISMATCH/);
  assert.match(syncRoute, /status: "duplicate"/);
  assert.match(syncRoute, /status: "retry"/);
  assert.match(syncRoute, /ACTION_IN_PROGRESS/);
  assert.match(syncRoute, /lease_until/);
  assert.match(syncRoute, /REVISION_CONFLICT/);
  assert.match(syncRoute, /WHERE id = \? AND firebase_uid = \? AND revision = \?/);
  assert.match(syncRoute, /set_job_stage/);
  assert.match(syncRoute, /set_task_status/);
  assert.match(syncRoute, /add_time_entry/);
  assert.match(syncRoute, /save_job_form/);
  assert.match(syncRoute, /FORM_INCOMPLETE/);
  assert.match(syncRoute, /deviceId/);
});

test("web, dispatch and field writes all advance the mobile sync ledger", () => {
  for (const source of [teamRoute, workRoute, crmRoute, fieldRoute]) assert.match(source, /jobSyncChangeStatements/);
  assert.match(teamRoute, /previousAudienceMemberId: job\.assignee_member_id/);
  assert.match(workRoute, /operation: SyncOperation/);
  assert.match(workRoute, /"delete"/);
  assert.match(crmRoute, /relatedJobs/);
  assert.match(fieldRoute, /nextJobRevision/);
  assert.match(syncServer, /previousAudience !== currentAudience/);
  assert.match(syncServer, /statement\(db, change, previousAudience, "delete"\)/);
  assert.match(syncServer, /trade_mobile_push_outbox/);
  assert.match(syncServer, /sync_required/);
});

test("field devices enforce versions, ownership and immediate revocation", () => {
  assert.match(deviceRoute, /requireInstallerTeamAccess\(request\)/);
  assert.match(deviceRoute, /MOBILE_CLIENT_ID_PATTERN/);
  assert.match(deviceRoute, /APP_UPDATE_REQUIRED/);
  assert.match(deviceRoute, /status = 'revoked'/);
  assert.match(deviceRoute, /push_token = ''/);
  assert.match(deviceRoute, /authorise_device/);
  assert.match(deviceRoute, /canManageTeam\(access\)/);
  assert.match(mobileServer, /AEA_MOBILE_MIN_IOS_VERSION/);
  assert.match(mobileServer, /AEA_MOBILE_MIN_ANDROID_VERSION/);
  assert.match(mobileServer, /encryptedStorageRequired: true/);
  assert.match(mobileServer, /APP_VERSION_REQUIRED/);
  assert.match(teamCentre, /Field devices/);
  assert.match(teamCentre, /Revoke access/);
});

test("field media uploads are resumable, idempotent and assignment scoped", () => {
  assert.match(mediaRoute, /createMultipartUpload/);
  assert.match(mediaRoute, /resumeMultipartUpload/);
  assert.match(mediaRoute, /uploadPart/);
  assert.match(mediaRoute, /\.complete\(/);
  assert.match(mediaRoute, /PART_SIZE_BYTES = 5 \* 1024 \* 1024/);
  assert.match(mediaRoute, /MAX_FILE_BYTES = 50 \* 1024 \* 1024/);
  assert.match(mediaRoute, /metadata_hash/);
  assert.match(mediaRoute, /IDEMPOTENCY_MISMATCH/);
  assert.match(mediaRoute, /UPLOAD_RECOVERY_REQUIRED/);
  assert.match(mediaRoute, /status === "completing"/);
  assert.match(mediaRoute, /assignedJob\(access/);
  assert.match(mediaRoute, /PROTECTED_CUSTOMER_DATA/);
  assert.match(mediaRoute, /jobSyncChangeStatements/);
});

test("the native field roadmap is explicit and keeps the web CRM authoritative", () => {
  assert.match(roadmap, /Phase 5: native field platform and offline operation/);
  assert.match(contract, /The installer web CRM is the system of record/);
  assert.match(contract, /iOS and Android/);
  assert.match(contract, /encrypted local database/);
  assert.match(contract, /Resumable field media/);
  assert.match(contract, /Push tokens are private server records/);
  assert.match(contract, /Version 3 transport/);
});

test("offline sync copy avoids prohibited dash characters", () => {
  assert.doesNotMatch(`${syncRoute}\n${deviceRoute}\n${mediaRoute}\n${teamCentre}\n${contract}`, /[\u2013\u2014]/);
});
