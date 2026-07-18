import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import {
  PHOTO_RETAKE_REASONS,
  photoProofCounts,
  photoRequestEvidenceKey,
  photoRetakeGuidance,
} from "../src/lib/photo-request-review.ts";
import { photoRequestDeliveryDraft, photoRequestDeliveryIdempotencyKey } from "../src/lib/trade-photo-request-delivery.ts";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const migration = read("../drizzle/0063_photo_request_review.sql");
const schema = read("../db/schema.ts");
const customerRoute = read("../src/app/api/job-information/[token]/route.ts");
const installerRoute = read("../src/app/api/trade-photo-requests/route.ts");
const deliveryServer = read("../src/lib/photo-request-delivery-server.ts");
const customerUi = read("../src/components/JobInformationUpload.tsx");
const installerUi = read("../src/components/TradePhotoRequestPanel.tsx");
const fieldRoute = read("../src/app/api/trade-field-work/route.ts");
const templateRoute = read("../src/app/api/trade-photo-templates/route.ts");

test("retake reasons are bounded and evidence completion keys are deterministic", async () => {
  assert.deepEqual(Object.keys(PHOTO_RETAKE_REASONS), ["wider_context", "clearer_photo", "requested_item_missing", "private_information_visible"]);
  assert.equal(photoRetakeGuidance("unknown"), "");
  const input = { requestId: "request-1", requestRevision: 2, checklistVersion: "check-1", mediaIds: ["b", "a"] };
  assert.equal(await photoRequestEvidenceKey(input), await photoRequestEvidenceKey({ ...input, mediaIds: ["a", "b"] }));
});

test("proof counts keep supplied evidence separate from immutable review outcomes", () => {
  const requirements = [{ id: "roof", label: "Roof", guidance: "Safe", usefulExample: "Wide", avoidExample: "Private", required: true },
    { id: "meter", label: "Meter", guidance: "Safe", usefulExample: "Whole", avoidExample: "Bills", required: false }];
  const reviews = [{ requirementId: "roof", label: "Roof", status: "accepted", reasonCode: "", guidance: "", reviewRevision: 1, reviewedAt: "2026-07-18", retakeAnswered: false },
    { requirementId: "meter", label: "Meter", status: "retake_requested", reasonCode: "clearer_photo", guidance: PHOTO_RETAKE_REASONS.clearer_photo, reviewRevision: 2, reviewedAt: "2026-07-18", retakeAnswered: false }];
  assert.deepEqual(photoProofCounts(requirements, reviews, { roof: 1, meter: 1 }),
    { total: 2, required: 1, supplied: 2, accepted: 1, retakeRequested: 1, notNeeded: 0, pending: 0 });
});

test("review migration is additive, indexed and binds retake delivery to the review", () => {
  for (const table of ["trade_crm_photo_request_completions", "trade_crm_photo_requirement_reviews"]) {
    assert.match(schema, new RegExp(`sqliteTable\\("${table}"`));
    assert.match(migration, new RegExp("CREATE TABLE `" + table + "`"));
  }
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE trade_crm_photo_request_deliveries (id text PRIMARY KEY NOT NULL)");
  for (const statement of migration.split("--> statement-breakpoint").map((item) => item.trim()).filter(Boolean)) db.exec(statement);
  const deliveryColumns = db.prepare("PRAGMA table_info(trade_crm_photo_request_deliveries)").all().map((row) => row.name);
  assert.ok(deliveryColumns.includes("review_revision") && deliveryColumns.includes("photo_requirement_id"));
  const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all().map((row) => row.name);
  assert.ok(indexes.includes("trade_crm_photo_request_completions_evidence_idx"));
  assert.ok(indexes.includes("trade_crm_photo_requirement_reviews_revision_idx"));
  assert.ok(db.prepare("PRAGMA table_info(trade_crm_photo_requirement_reviews)").all().some((row) => row.name === "reviewed_upload_count"));
  db.close();
});

test("customer completion checks current required uploads and preserves reviewed originals", () => {
  assert.match(customerRoute, /action !== "complete_request"/);
  assert.match(customerRoute, /outstandingRequirementIds/);
  assert.match(customerRoute, /trade_crm_photo_request_completions/);
  assert.match(customerRoute, /evidence_key/);
  assert.match(customerRoute, /part of the review history and cannot be removed/);
  assert.match(customerUi, /Finish and notify installer/);
  assert.match(customerUi, /Retake requested/);
  assert.match(customerUi, /Your original photo remains in the installer job/);
});

test("installer review is manager scoped, append only and uses fixed retake guidance", () => {
  assert.match(installerRoute, /managedDirectJob/);
  assert.match(installerRoute, /canDispatch/);
  assert.match(installerRoute, /INSERT INTO trade_crm_photo_requirement_reviews/);
  assert.doesNotMatch(installerRoute, /UPDATE trade_crm_photo_requirement_reviews/);
  assert.match(installerRoute, /photoRetakeGuidance/);
  assert.match(installerUi, /Job proof readiness/);
  assert.match(installerUi, /Request retake/);
  assert.doesNotMatch(`${installerRoute}\n${installerUi}`, /reviewNote|customerMessage|freeText/);
});

test("targeted follow-up reuses the current link and is idempotent by review and requirement", async () => {
  const base = { requestId: "request-1", requestRevision: 2, tokenIssue: 3, intent: "retake_followup", channel: "email", reviewRevision: 4, photoRequirementId: "roof" };
  const key = await photoRequestDeliveryIdempotencyKey(base);
  assert.notEqual(key, await photoRequestDeliveryIdempotencyKey({ ...base, reviewRevision: 5 }));
  assert.notEqual(key, await photoRequestDeliveryIdempotencyKey({ ...base, photoRequirementId: "meter" }));
  const draft = photoRequestDeliveryDraft({ ...base, businessName: "Example Trade", workNumber: "JOB-1",
    shareUrl: "https://example.test/current", expiresAt: "2026-08-01", requirementLabel: "Roof overview",
    retakeGuidance: PHOTO_RETAKE_REASONS.wider_context });
  assert.match(draft.body, /Roof overview/);
  assert.match(draft.body, /https:\/\/example\.test\/current/);
  assert.match(deliveryServer, /currentShareUrl/);
  assert.match(deliveryServer, /PHOTO_RETAKE_REVIEW_STALE/);
});

test("field and template reporting expose privacy-safe review aggregates", () => {
  assert.match(fieldRoute, /proofReview/);
  assert.match(templateRoute, /reviewCounts/);
  assert.match(templateRoute, /acceptedCount/);
  const reviewHelper = read("../src/lib/photo-request-review-server.ts");
  assert.doesNotMatch(reviewHelper, /customer_email|customer_phone|token_hash|encrypted_token|object_key|image_url/);
});

test("photo review sources avoid prohibited dash characters", () => {
  assert.doesNotMatch(`${customerRoute}\n${installerRoute}\n${customerUi}\n${installerUi}\n${fieldRoute}\n${templateRoute}`, /[\u2013\u2014]/);
});
