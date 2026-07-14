import assert from "node:assert/strict";
import test from "node:test";
import {
  assessParticipantRecord,
  buildParticipantApplicationReview,
  publicParticipantProfile,
} from "../src/lib/direct-trade-participants.mjs";

const now = () => new Date("2026-07-14T01:00:00.000Z");

const installer = {
  id: "participant-1",
  businessName: "Example Electrical",
  partnerType: "installer",
  status: "approved",
  businessVerified: true,
  reviewedAt: "2026-07-01T00:00:00.000Z",
  reviewDueAt: "2027-07-01T00:00:00.000Z",
  serviceStates: ["VIC"],
  capabilities: ["solar", "battery"],
  credentials: [{ kind: "electrical", verified: true, expiresAt: "2027-05-01T00:00:00.000Z", identifier: "PRIVATE-123" }],
  insurance: { verified: true, expiresAt: "2027-04-01T00:00:00.000Z", document: "private.pdf" },
  requiredSchemeCapabilities: ["solar", "battery"],
  schemeApprovals: [
    { capability: "solar", verified: true, expiresAt: "2027-03-01T00:00:00.000Z" },
    { capability: "battery", verified: true, expiresAt: "2027-03-01T00:00:00.000Z" },
  ],
  publicListingConsent: true,
  publicProfileReviewed: true,
  profileSummary: "Verified coverage and capability.",
};

test("partner applications begin in manual review and cannot approve or list themselves", () => {
  const review = buildParticipantApplicationReview({ partnerType: "installer" });
  assert.equal(review.status, "application_received");
  assert.equal(review.autoApprove, false);
  assert.equal(review.publicListing, false);
  assert.ok(review.checks.some((item) => item.id === "credentials"));
});

test("current approved installer evidence passes matching assessment", () => {
  const assessment = assessParticipantRecord(installer, { now: now() });
  assert.equal(assessment.matchingEligible, true);
  assert.equal(assessment.publicListingEligible, true);
  assert.deepEqual(assessment.matchingFlags, []);
});

test("expired evidence and overdue reviews remove matching eligibility", () => {
  const assessment = assessParticipantRecord({ ...installer, reviewDueAt: "2026-07-01T00:00:00.000Z", insurance: { verified: true, expiresAt: "2026-07-10T00:00:00.000Z" } }, { now: now() });
  assert.equal(assessment.matchingEligible, false);
  assert.ok(assessment.matchingFlags.includes("participant_review_due"));
  assert.ok(assessment.matchingFlags.includes("insurance_missing_or_expired"));
});

test("suppliers require product evidence and warranty support for every capability", () => {
  const assessment = assessParticipantRecord({
    partnerType: "supplier", status: "approved", businessVerified: true,
    reviewDueAt: "2027-01-01T00:00:00.000Z", serviceStates: ["NSW"], capabilities: ["battery", "hot-water"],
    productEvidence: [{ capability: "battery", verified: true }], warrantySupportVerified: false,
  }, { now: now() });
  assert.equal(assessment.matchingEligible, false);
  assert.ok(assessment.matchingFlags.includes("product_evidence_incomplete"));
  assert.ok(assessment.matchingFlags.includes("warranty_support_not_verified"));
});

test("public profiles omit private credential, insurance and contact evidence", () => {
  const profile = publicParticipantProfile({ ...installer, email: "private@example.com", phone: "0400000000" }, { now: now() });
  assert.ok(profile);
  assert.equal(profile.businessName, "Example Electrical");
  assert.equal("credentials" in profile, false);
  assert.equal("insurance" in profile, false);
  assert.equal("email" in profile, false);
  assert.equal("phone" in profile, false);
});
