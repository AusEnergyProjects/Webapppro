import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import {
  hasAllowedSignature,
  sanitiseQuotingPhoto,
} from "../src/lib/private-image-evidence.ts";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");

const migration = read("../drizzle/0083_customer_plan_evidence_history.sql");
const schema = read("../db/schema.ts");
const evidenceRoute = read("../src/app/api/customer-project-evidence/route.ts");
const projectsRoute = read("../src/app/api/customer-projects/route.ts");
const opportunitiesRoute = read("../src/app/api/trade-opportunities/route.ts");
const emailRoute = read("../src/app/api/customer-project-plan-email/route.ts");
const dashboard = read("../src/components/CustomerDashboard.tsx");

test("the additive migration preserves legacy evidence scope and creates private history tables", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE customer_project_evidence (
    id text PRIMARY KEY NOT NULL
  )`);
  db.exec(`CREATE TABLE customer_projects (
    id text PRIMARY KEY NOT NULL,
    firebase_uid text NOT NULL,
    goals text NOT NULL DEFAULT '[]',
    existing_features text NOT NULL DEFAULT '[]',
    pace text NOT NULL DEFAULT '',
    budget_range text NOT NULL DEFAULT '',
    plan_snapshot text NOT NULL DEFAULT '{}',
    updated_at text NOT NULL
  )`);
  db.exec(`INSERT INTO customer_project_evidence (id) VALUES ('evidence-1')`);
  db.exec(`INSERT INTO customer_projects
    (id, firebase_uid, goals, existing_features, pace, budget_range, plan_snapshot, updated_at)
    VALUES ('project-1', 'owner-1', '["lower-bills"]', '["single-glazing"]',
      'staged', 'under_2k', '{"version":"v1","items":[]}', '2026-07-29T00:00:00.000Z')`);
  for (const statement of migration
    .split("--> statement-breakpoint")
    .map((item) => item.trim())
    .filter(Boolean)) {
    db.exec(statement);
  }
  const evidence = db.prepare(`SELECT fact_keys, sharing_scope
    FROM customer_project_evidence WHERE id = 'evidence-1'`).get();
  assert.equal(evidence.fact_keys, "[]");
  assert.equal(evidence.sharing_scope, "allocated-installers");
  const revision = db.prepare(`SELECT revision_number, event_type, plan_version, goals,
    home_features, plan_snapshot FROM customer_project_plan_revisions
    WHERE project_id = 'project-1'`).get();
  assert.equal(revision.revision_number, 1);
  assert.equal(revision.event_type, "baseline");
  assert.equal(revision.plan_version, "v1");
  assert.deepEqual(JSON.parse(revision.goals), ["lower-bills"]);
  assert.deepEqual(JSON.parse(revision.home_features), ["single-glazing"]);
  assert.equal(JSON.parse(revision.plan_snapshot).version, "v1");
  assert.ok(
    db.prepare("PRAGMA index_list(customer_project_plan_revisions)").all()
      .some((item) => item.name === "customer_project_plan_revisions_number_idx"),
  );
  db.close();

  assert.match(schema, /factKeys: text\("fact_keys"\)/);
  assert.match(schema, /sharingScope: text\("sharing_scope"\)/);
  assert.match(schema, /sqliteTable\("customer_project_plan_revisions"/);
  assert.match(schema, /sqliteTable\("customer_project_outcome_checkins"/);
});

test("evidence links are owner controlled and private files cannot enter installer responses", () => {
  assert.match(evidenceRoute, /normaliseFactKeys/);
  assert.match(evidenceRoute, /SHARING_SCOPES/);
  assert.match(evidenceRoute, /"private-plan"/);
  assert.match(evidenceRoute, /"allocated-installers"/);
  assert.match(evidenceRoute, /record\.sharing_scope !== "allocated-installers"/);
  assert.match(evidenceRoute, /export async function PATCH/);
  assert.match(evidenceRoute, /confirmInstallerPhotoSharing/);
  assert.match(
    opportunitiesRoute,
    /e\.sharing_scope = 'allocated-installers'/,
  );
  assert.match(
    projectsRoute,
    /sharing_scope = 'allocated-installers'/,
  );
  assert.match(emailRoute, /SELECT fact_keys, sharing_scope/);
  assert.match(evidenceRoute, /const grantingInstallerAccess =/);
  assert.match(evidenceRoute, /if \(grantingInstallerAccess\)/);
  assert.match(
    evidenceRoute,
    /const storedBytes = file\.type\.startsWith\("image\/"\)\s*\?\s*sanitiseQuotingPhoto/,
  );
});

test("roadmap revisions and outcome check-ins stay in the owner project contract", () => {
  assert.match(projectsRoute, /customer_project_plan_revisions/);
  assert.match(projectsRoute, /event_type, plan_version/);
  assert.match(projectsRoute, /roadmapChanged/);
  assert.match(projectsRoute, /action === "record_outcome"/);
  assert.match(projectsRoute, /COMFORT_OUTCOMES/);
  assert.match(projectsRoute, /ENERGY_OUTCOMES/);
  assert.match(projectsRoute, /customer_project_outcome_checkins/);
  assert.match(projectsRoute, /ROW_NUMBER\(\) OVER \(\s*PARTITION BY project_id/);
  assert.match(projectsRoute, /cleanPlanRevision\(raw\.expectedPlanRevision\)/);
  assert.match(projectsRoute, /const nextPlanRevision = currentPlanRevision \+ 1/);
  assert.match(
    projectsRoute,
    /status = 'draft'\s+AND plan_revision = \?/,
  );
  assert.match(projectsRoute, /restored_from_revision/);
  assert.match(projectsRoute, /results\[0\]\?\.meta\.changes/);
  assert.match(projectsRoute, /results\[1\]\?\.meta\.changes/);
  assert.doesNotMatch(projectsRoute, /SELECT MAX\(revision_number\) revision_number/);
  assert.match(projectsRoute, /PLAN_REVISION_RETENTION_LIMIT/);
  assert.match(projectsRoute, /OUTCOME_CHECKIN_RETENTION_LIMIT/);
  assert.match(
    projectsRoute,
    /COALESCE\(CAST\(json_extract\(plan_snapshot, '\$\.version'\) AS text\), ''\)/,
  );
  assert.match(dashboard, /Private plan history/);
  assert.match(dashboard, /Private progress check-in/);
  assert.match(dashboard, /not a verified savings or causation claim/);
  assert.match(dashboard, /Home fact supported by|Home fact supported/i);
  assert.match(dashboard, /Private to my plan/);
});

test("JPEG, PNG and WebP metadata is stripped before any image category is stored", () => {
  const jpeg = Uint8Array.from([
    0xff, 0xd8,
    0xff, 0xe1, 0x00, 0x06, 0x45, 0x58, 0x49, 0x46,
    0xff, 0xda, 0x00, 0x02, 0xff, 0xd9,
  ]);
  assert.equal(hasAllowedSignature(jpeg, "image/jpeg"), true);
  const cleanJpeg = sanitiseQuotingPhoto(jpeg, "image/jpeg");
  assert.ok(cleanJpeg);
  assert.equal(Buffer.from(cleanJpeg).includes(Buffer.from("EXIF")), false);

  const pngChunk = (type, data = Buffer.alloc(0)) => {
    const chunk = Buffer.alloc(12 + data.length);
    chunk.writeUInt32BE(data.length, 0);
    chunk.write(type, 4, 4, "ascii");
    data.copy(chunk, 8);
    return chunk;
  };
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("eXIf", Buffer.from("gps")),
    pngChunk("IDAT"),
    pngChunk("IEND"),
  ]);
  assert.equal(hasAllowedSignature(png, "image/png"), true);
  const cleanPng = sanitiseQuotingPhoto(png, "image/png");
  assert.ok(cleanPng);
  assert.equal(Buffer.from(cleanPng).includes(Buffer.from("eXIf")), false);

  const webpChunk = (type, data = Buffer.alloc(0)) => {
    const padding = data.length % 2;
    const chunk = Buffer.alloc(8 + data.length + padding);
    chunk.write(type, 0, 4, "ascii");
    chunk.writeUInt32LE(data.length, 4);
    data.copy(chunk, 8);
    return chunk;
  };
  const webpPayload = Buffer.concat([
    webpChunk("EXIF", Buffer.from("gps!")),
    webpChunk("VP8 "),
  ]);
  const webp = Buffer.alloc(12 + webpPayload.length);
  webp.write("RIFF", 0, 4, "ascii");
  webp.writeUInt32LE(webp.length - 8, 4);
  webp.write("WEBP", 8, 4, "ascii");
  webpPayload.copy(webp, 12);
  assert.equal(hasAllowedSignature(webp, "image/webp"), true);
  const cleanWebp = sanitiseQuotingPhoto(webp, "image/webp");
  assert.ok(cleanWebp);
  assert.equal(Buffer.from(cleanWebp).includes(Buffer.from("EXIF")), false);
});
