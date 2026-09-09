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
const opportunitiesRoute = read("../src/app/api/trade-opportunities/route.ts");

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
  assert.match(
    opportunitiesRoute,
    /e\.sharing_scope = 'allocated-installers'/,
  );
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
