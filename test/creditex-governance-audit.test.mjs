import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const route = fs.readFileSync(
  new URL("../src/app/api/creditex/activities/route.ts", import.meta.url),
  "utf8",
);

test("program and activity governance mutations are atomically audited", () => {
  assert.match(route, /INSERT INTO compliance_write_guards/);
  assert.match(route, /CASE WHEN changes\(\) = 1 THEN 1 ELSE 0 END/);
  assert.match(route, /INSERT INTO compliance_audit_events/);
  for (const eventType of [
    "program.created",
    "program.published",
    "program.withdrawn",
    "program.draft_deleted",
    "activity.created",
    "activity.published",
    "activity.withdrawn",
    "activity.draft_deleted",
  ]) {
    assert.match(route, new RegExp(`eventType: "${eventType.replaceAll(".", "\\.")}"`));
  }
  assert.doesNotMatch(route, /prepared\.statement\.run\(\)/);
});

test("draft deletion retains its source identity in immutable audit metadata", () => {
  assert.match(route, /draftProgramSnapshot/);
  assert.match(route, /draftActivitySnapshot/);
  assert.match(route, /official_source_sha256/);
  assert.match(route, /metadata: \{ deletedSnapshot \}/);
  assert.match(route, /source identity retained in audit/);
});
