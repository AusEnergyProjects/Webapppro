import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  defaultPhotoRequirements,
  hashPhotoRequestSecret,
  newPhotoRequestSecret,
  normalisePhotoRequirements,
  parsePhotoRequestToken,
  photoRequestExpiry,
  PHOTO_REQUEST_CHECKLIST_VERSION,
} from "../src/lib/trade-photo-requests.ts";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const migration = read("../drizzle/0060_customer_photo_requests.sql");
const schema = read("../db/schema.ts");
const installerRoute = read("../src/app/api/trade-photo-requests/route.ts");
const publicRoute = read("../src/app/api/job-information/[token]/route.ts");
const installerUi = read("../src/components/InstallerCrmWorkspace.tsx");
const requestUi = read("../src/components/TradePhotoRequestPanel.tsx");
const customerUi = read("../src/components/JobInformationUpload.tsx");
const customerPage = read("../src/app/job-information/[token]/page.tsx");
const fieldRoute = read("../src/app/api/trade-field-work/route.ts");
const fieldUi = read("../src/components/TradeFieldWorkPanel.tsx");

test("service defaults cover each requested upgrade and carry useful and avoid guidance", () => {
  for (const category of ["solar", "battery", "heating-cooling", "hot-water", "insulation-draughts", "ev-charging", "assessment"]) {
    const requirements = defaultPhotoRequirements(category);
    assert.ok(requirements.length >= 3, category);
    assert.ok(requirements.every((item) => item.label && item.guidance && item.usefulExample && item.avoidExample));
  }
  assert.match(defaultPhotoRequirements("solar")[0].guidance, /people, documents, street numbers/);
});

test("editable requirements are bounded, complete and uniquely identified", () => {
  const normalised = normalisePhotoRequirements([{ id: "Roof View", label: " Roof view ", guidance: " Show the roof. ", usefulExample: " Whole roof. ", avoidExample: " Street number. ", required: true }]);
  assert.deepEqual(normalised, [{ id: "roof-view", label: "Roof view", guidance: "Show the roof.", usefulExample: "Whole roof.", avoidExample: "Street number.", required: true }]);
  assert.throws(() => normalisePhotoRequirements([]), /INVALID_PHOTO_REQUIREMENTS/);
  assert.throws(() => normalisePhotoRequirements([
    { id: "same", label: "One", guidance: "Guide", usefulExample: "Useful", avoidExample: "Avoid" },
    { id: "same", label: "Two", guidance: "Guide", usefulExample: "Useful", avoidExample: "Avoid" },
  ]), /INVALID_PHOTO_REQUIREMENTS/);
});

test("capability links keep a random secret outside the stored request record", async () => {
  const secret = newPhotoRequestSecret();
  const requestId = "123e4567-e89b-12d3-a456-426614174000";
  assert.equal(secret.length, 43);
  assert.deepEqual(parsePhotoRequestToken(`${requestId}.${secret}`), { requestId, secret });
  assert.equal(parsePhotoRequestToken("invalid"), null);
  const digest = await hashPhotoRequestSecret(secret);
  assert.equal(digest.length, 64);
  assert.ok(!digest.includes(secret));
  assert.equal(photoRequestExpiry(new Date("2026-07-18T00:00:00.000Z")), "2026-08-17T00:00:00.000Z");
});

test("the additive migration stores revisioned requests and customer evidence context", () => {
  for (const table of ["trade_crm_photo_requests", "trade_crm_photo_request_events"]) assert.match(migration, new RegExp("CREATE TABLE `" + table + "`"));
  for (const column of ["source", "photo_request_id", "photo_requirement_id", "request_revision", "checklist_version", "customer_acknowledged_at"]) {
    assert.match(migration, new RegExp("ADD `" + column + "`"));
  }
  assert.match(schema, /tradeCrmPhotoRequests/);
  assert.match(schema, /tradeCrmPhotoRequestEvents/);
  assert.match(schema, /tradeCrmJobMediaPhotoRequest|trade_crm_job_media_photo_request_idx/);
});

test("installer request management is direct-job scoped, editable and revocable", () => {
  assert.match(installerRoute, /managedDirectJob/);
  assert.match(installerRoute, /canDispatch/);
  assert.match(installerRoute, /source_type === "opportunity"|source_type/);
  assert.match(installerRoute, /customer_source === "platform_private"|customer_source/);
  assert.match(installerRoute, /DIRECT_CUSTOMER_REQUIRED/);
  assert.match(installerRoute, /normalisePhotoRequirements/);
  assert.match(installerRoute, /expectedRevision/);
  assert.match(installerRoute, /hashPhotoRequestSecret/);
  assert.match(installerRoute, /photoRequestExpiry/);
  assert.match(installerRoute, /status = 'revoked'/);
  assert.doesNotMatch(installerRoute, /customer_email|customer_phone|address_line/);
});

test("the public request validates the capability and places safe photos into the exact job proof", () => {
  assert.match(publicRoute, /parsePhotoRequestToken/);
  assert.match(publicRoute, /token_hash !== await hashPhotoRequestSecret/);
  assert.match(publicRoute, /expires_at <= new Date/);
  assert.match(publicRoute, /sameOrigin/);
  assert.match(publicRoute, /hasAllowedSignature/);
  assert.match(publicRoute, /sanitiseQuotingPhoto/);
  assert.equal(PHOTO_REQUEST_CHECKLIST_VERSION, "2026-07-18-customer-photo-self-review");
  assert.match(publicRoute, /PHOTO_REQUEST_CHECKLIST_VERSION/);
  assert.match(publicRoute, /confirmClarity/);
  assert.match(publicRoute, /confirmRelevance/);
  assert.match(publicRoute, /confirmPrivacy/);
  assert.match(publicRoute, /INSERT INTO trade_crm_job_media/);
  assert.match(publicRoute, /'customer_request'/);
  assert.match(publicRoute, /jobSyncChangeStatements/);
  assert.match(publicRoute, /DELETE FROM trade_crm_job_media/);
  assert.doesNotMatch(publicRoute, /customer_name|customer_email|customer_phone|address_line/);
});

test("installer and customer interfaces expose the complete request and proof flow", () => {
  assert.match(installerUi, />Request info</);
  assert.match(installerUi, /TradePhotoRequestPanel/);
  assert.match(requestUi, /Save requirement changes/);
  assert.doesNotMatch(requestUi, /onChanged/);
  assert.match(requestUi, /Create request and link/);
  assert.match(requestUi, /Replace secure link/);
  assert.match(requestUi, /Revoke link/);
  assert.match(requestUi, /navigator\.share/);
  assert.match(customerPage, /robots: \{ index: false/);
  for (const copy of ["Private photo self-review", "Clear", "Relevant", "Privacy checked", "Add to installer job"]) assert.match(customerUi, new RegExp(copy));
  assert.match(customerUi, /capture="environment"/);
  assert.match(fieldRoute, /photo_requirement_id/);
  assert.match(fieldUi, /Customer requested photo/);
  assert.match(fieldUi, /Customer self-review confirmed/);
});

test("new customer photo request copy avoids prohibited dash characters", () => {
  assert.doesNotMatch(`${installerUi}\n${requestUi}\n${customerUi}\n${customerPage}`, /[\u2013\u2014]/);
});
