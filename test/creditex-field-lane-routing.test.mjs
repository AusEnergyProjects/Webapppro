import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

const accessRoute = read("../src/app/api/field/access/route.ts");
const database = read("../mobile/src/lib/database.ts");
const manualFieldServer = read("../src/lib/creditex-manual-field-server.ts");
const sync = read("../mobile/src/lib/sync.ts");
const types = read("../mobile/src/lib/types.ts");

test("field access reports every authorised lane without a manual toggle", () => {
  assert.match(types, /FieldAccessMode = 'trade_team' \| 'creditex_manual'/);
  assert.match(accessRoute, /modes\.push\("trade_team"\)/);
  assert.match(accessRoute, /modes\.push\("creditex_manual"\)/);
  assert.match(
    accessRoute,
    /if \(await hasManualFieldAssignment\(database, member\)\)/,
  );
  assert.match(
    manualFieldServer,
    /export async function hasManualFieldAssignment[\s\S]*job\.field_tester_uid = \?[\s\S]*LIMIT 1/,
  );
  assert.match(accessRoute, /mode:\s*modes\[0\]/);
  assert.match(accessRoute, /\bmodes,\s*\n/);
  assert.match(sync, /resolveFieldAccessModes/);
  assert.match(sync, /for \(const mode of modes\)/);
});

test("offline jobs actions uploads and cursors are isolated by field lane", () => {
  for (const table of ["jobs", "action_queue", "upload_queue"]) {
    const start = database.indexOf(`CREATE TABLE IF NOT EXISTS ${table} (`);
    const end = database.indexOf("    );", start);
    assert.ok(start >= 0 && end > start, `missing ${table} definition`);
    const definition = database.slice(start, end);
    assert.match(definition, /field_lane TEXT NOT NULL DEFAULT 'trade_team'/);
  }
  assert.match(database, /DELETE FROM jobs WHERE field_lane = \?/);
  assert.match(
    database,
    /DELETE FROM action_queue WHERE field_lane = \? AND work_order_id NOT IN/,
  );
  assert.match(
    database,
    /DELETE FROM upload_queue WHERE field_lane = \? AND work_order_id NOT IN/,
  );
  assert.match(
    database,
    /SELECT \* FROM action_queue WHERE field_lane = \? AND status IN/,
  );
  assert.match(
    database,
    /SELECT \* FROM upload_queue WHERE field_lane = \? AND status IN/,
  );
  assert.match(sync, /`sync_cursor_\$\{mode\}`/);
  assert.match(sync, /queuedActions\(mode\)/);
  assert.match(sync, /processUploadQueue\(mode\)/);
  assert.match(sync, /applyChanges\(response\.changes, response\.bootstrap, response\.serverTime, mode\)/);
});

test("local routing metadata is never sent in a government workflow action", () => {
  const projector = sync.match(
    /function actionForServer[\s\S]*?(?=\n}\n\nfunction devicePath)/,
  )?.[0];
  assert.ok(projector);
  assert.match(projector, /delete serverAction\.fieldLane/);
  assert.match(sync, /const actions = rows\.map\(actionForServer\)/);
});

test("expired multipart uploads can receive a fresh stable client upload id", () => {
  assert.match(types, /client_upload_id:\s*string/);
  assert.match(database, /client_upload_id TEXT NOT NULL DEFAULT ''/);
  assert.match(database, /UPDATE upload_queue SET client_upload_id = \?/);
  assert.match(
    database,
    /input\.id,\s*\n\s*input\.work_order_id,\s*\n\s*lane,\s*\n\s*input\.id,/,
  );
});
