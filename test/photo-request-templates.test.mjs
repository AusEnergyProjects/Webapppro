import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  normalisePhotoRequirements,
  normalisePhotoTemplateFeedback,
  photoRequirementsEqual,
} from "../src/lib/trade-photo-requests.ts";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const migration = read("../drizzle/0061_photo_request_templates.sql");
const schema = read("../db/schema.ts");
const templateRoute = read("../src/app/api/trade-photo-templates/route.ts");
const requestRoute = read("../src/app/api/trade-photo-requests/route.ts");
const libraryUi = read("../src/components/TradePhotoTemplateLibrary.tsx");
const requestUi = read("../src/components/TradePhotoRequestPanel.tsx");

const source = normalisePhotoRequirements([
  { id: "switchboard", label: "Switchboard", guidance: "Show the closed board.", usefulExample: "Full front view.", avoidExample: "Open covers.", required: true },
  { id: "location", label: "Install location", guidance: "Show the surrounding wall.", usefulExample: "Wide context view.", avoidExample: "Tight crop.", required: false },
]);

test("template feedback is limited to source requirement ids and controlled values", () => {
  assert.deepEqual(normalisePhotoTemplateFeedback({ switchboard: "useful", location: "unclear", hidden: "useful", extra: "free text" }, source), {
    switchboard: "useful", location: "unclear",
  });
  assert.deepEqual(normalisePhotoTemplateFeedback(null, source), {});
});

test("job snapshots can be compared with their immutable source version", () => {
  assert.equal(photoRequirementsEqual(source, source.map((item) => ({ ...item }))), true);
  assert.equal(photoRequirementsEqual(source, source.map((item, index) => index ? item : { ...item, guidance: "Edited for this job." })), false);
});

test("the additive migration stores owner-scoped templates, immutable versions and job provenance", () => {
  for (const table of ["trade_crm_photo_templates", "trade_crm_photo_template_versions"]) {
    assert.match(migration, new RegExp("CREATE TABLE `" + table + "`"));
  }
  for (const column of ["source_template_id", "source_template_version_id", "source_template_version", "source_template_edited", "template_feedback", "template_missing_feedback"]) {
    assert.match(migration, new RegExp("ADD `" + column + "`"));
  }
  assert.match(schema, /tradeCrmPhotoTemplates/);
  assert.match(schema, /tradeCrmPhotoTemplateVersions/);
  assert.match(schema, /trade_crm_photo_template_versions_template_version_idx/);
  assert.match(schema, /trade_crm_photo_requests_template_version_idx/);
});

test("template management is role protected, owner scoped, versioned and archive safe", () => {
  assert.match(templateRoute, /canDispatch/);
  assert.match(templateRoute, /firebase_uid = \?/);
  assert.match(templateRoute, /PHOTO_TEMPLATE_MANAGEMENT_REQUIRED/);
  assert.match(templateRoute, /INSERT INTO trade_crm_photo_template_versions/);
  assert.doesNotMatch(templateRoute, /UPDATE trade_crm_photo_template_versions/);
  assert.match(templateRoute, /status = 'published'/);
  assert.match(templateRoute, /status = 'archived'/);
  assert.match(templateRoute, /status <> 'archived'/);
  assert.match(templateRoute, /PHOTO_TEMPLATE_UNCHANGED/);
});

test("new requests accept only the current published version and retain an independent snapshot", () => {
  assert.match(requestRoute, /t\.published_version = v\.version/);
  assert.match(requestRoute, /t\.status <> 'archived'/);
  assert.match(requestRoute, /source_template_version_id/);
  assert.match(requestRoute, /source_template_edited/);
  assert.match(requestRoute, /photoRequirementsEqual/);
  assert.match(requestRoute, /UPDATE trade_crm_photo_requests SET requirements/);
  assert.doesNotMatch(requestRoute, /UPDATE trade_crm_photo_template_versions/);
});

test("usage reporting reads metadata only and exposes controlled counts", () => {
  for (const field of ["selections", "editedJobs", "requestedRequirements", "completedRequirements", "missingFeedback", "feedbackCounts", "requirementStats"]) {
    assert.match(templateRoute, new RegExp(field));
  }
  assert.doesNotMatch(templateRoute, /customer_name|customer_email|customer_phone|address_line|object_key|file_name|content_type/);
  assert.match(templateRoute, /m\.source = 'customer_request'/);
});

test("desktop and mobile interfaces expose the complete template-to-job flow", () => {
  for (const copy of ["Photo request templates", "Create draft", "Publish version 1", "Publish new version", "Duplicate", "Archive", "Privacy-safe feedback"]) {
    assert.match(libraryUi, new RegExp(copy));
  }
  for (const copy of ["Start from published business guidance", "Seeded from business template", "Save template feedback", "job will keep its own editable snapshot"]) {
    assert.match(requestUi, new RegExp(copy));
  }
  assert.match(read("../src/components/TradePhotoTemplateLibrary.module.css"), /@media \(max-width: 420px\)/);
  assert.doesNotMatch(`${libraryUi}\n${requestUi}`, /[\u2013\u2014]/);
});
