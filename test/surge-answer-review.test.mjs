import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

const publicRoute = read("../src/app/api/energy-assistant/review/route.ts");
const adminRoute = read("../src/app/api/admin/energy-assistant-reviews/route.ts");
const migration = read("../drizzle/0165_surge_answer_review_queue.sql");
const widget = read("../src/components/EnergyAssistantWidget.tsx");
const portal = read("../src/components/AdminOperationsPortal.tsx");

test("review button submits only the paired question and answer", () => {
  assert.match(widget, /: "Review answer"/);
  assert.match(widget, /"Sent for review"/);
  assert.match(widget, /messages\.slice\(0, messageIndex\)[\s\S]*role === "user"/);
  const functionStart = widget.indexOf("const submitAnswerReview");
  const functionEnd = widget.indexOf("const addDocumentMessages", functionStart);
  const reviewFunction = widget.slice(functionStart, functionEnd);
  assert.match(reviewFunction, /JSON\.stringify\(\{[\s\S]*answerId:[\s\S]*question,[\s\S]*answer:/);
  assert.doesNotMatch(reviewFunction, /planContext|profile|recentTurns|continuation|plannerProfile/);
});

test("public review endpoint is bounded, same-origin and idempotent", () => {
  assert.match(publicRoute, /sameBrowserOrigin/);
  assert.match(publicRoute, /8_192/);
  assert.match(publicRoute, /INSERT OR IGNORE INTO surge_answer_reviews/);
  assert.match(publicRoute, /answer_id TEXT|answerId/);
  assert.match(publicRoute, /COUNT\(\*\) total[\s\S]*'-1 day'/);
  assert.doesNotMatch(publicRoute, /plan_context|recent_turns|conversation|home_details/);
});

test("admin review queue is role-restricted and auditable", () => {
  assert.match(adminRoute, /\["owner", "admin", "reviewer"\]/);
  assert.match(adminRoute, /surge_answer_reviewed/);
  assert.match(portal, /Wattzun AI answer reviews/);
  assert.match(portal, /AdminSurgeAnswerReviews/);
});

test("migration stores the submitted pair and aggregate quality counters", () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS surge_answer_reviews/);
  assert.match(migration, /answer_id TEXT NOT NULL UNIQUE/);
  assert.match(migration, /question TEXT NOT NULL/);
  assert.match(migration, /answer TEXT NOT NULL/);
  assert.match(migration, /directness_pass_count/);
  assert.match(migration, /plain_language_pass_count/);
  assert.match(migration, /actionability_pass_count/);
});
