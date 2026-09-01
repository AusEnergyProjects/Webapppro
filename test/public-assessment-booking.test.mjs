import assert from "node:assert/strict";
import test from "node:test";
import { createLeadEnvelope, publicPlanSubmissionFingerprint } from "../src/lib/lead-envelope.mjs";
import { createLeadPostHandler } from "../src/lib/lead-route-handler.mjs";
import { validateLeadPayload } from "../src/lib/lead-validation.mjs";
import {
  isPublicAssessmentBookingRequest,
  PUBLIC_ASSESSMENT_BOOKING_CONSENT_NOTICE_VERSION,
  PUBLIC_ASSESSMENT_BOOKING_CONSENT_PURPOSE,
  PUBLIC_ASSESSMENT_BOOKING_REQUEST_KIND,
  PUBLIC_ASSESSMENT_BOOKING_SOURCE_JOURNEY,
} from "../src/lib/public-assessment-booking.mjs";

const LEAD_SIGNING_SECRET = "test-assessment-booking-secret-32-bytes-minimum";

function validBookingRequest(overrides = {}) {
  return {
    submissionType: "upgrade",
    enquiry: PUBLIC_ASSESSMENT_BOOKING_REQUEST_KIND,
    submissionId: "20260901.12345678-abcd-4abc-8def-123456789abc",
    name: "Jamie Customer",
    email: "jamie@example.com",
    phone: "0400 000 000",
    postcode: "3000",
    state: "VIC",
    assessmentPathway: "existing-home-rating",
    assessmentStage: "home-already-built",
    preferredContact: "either",
    preferredTiming: "Weekday mornings",
    projectNotes: "Seeking an assessment before planning insulation upgrades.",
    clientStartedAt: Date.now() - 5_000,
    website: "",
    consent: {
      accepted: true,
      purpose: PUBLIC_ASSESSMENT_BOOKING_CONSENT_PURPOSE,
      noticeVersion: PUBLIC_ASSESSMENT_BOOKING_CONSENT_NOTICE_VERSION,
      grantedAt: new Date().toISOString(),
    },
    ...overrides,
  };
}

test("assessment booking requests retain only bounded booking and contact fields", () => {
  const result = validateLeadPayload(validBookingRequest({
    customerStreetAddress: "Must not cross the public intake boundary",
    uploadedPlan: "private.pdf",
    projectCategories: ["solar"],
  }));
  assert.equal(result.ok, true);
  assert.deepEqual(result.value.projectCategories, ["assessment"]);
  assert.deepEqual(result.value.projectPriorities, ["assessment-compliance"]);
  assert.equal(result.value.projectStage, "assessment-ready");
  assert.equal(result.value.state, "VIC");
  assert.equal(result.value.assessmentPathway, "existing-home-rating");
  assert.equal(result.value.preferredTiming, "Weekday mornings");
  for (const field of ["customerStreetAddress", "uploadedPlan"]) {
    assert.equal(field in result.value, false);
  }
});

test("assessment booking validation enforces pathway, location, contact and current consent", () => {
  assert.equal(validateLeadPayload(validBookingRequest()).ok, true);
  assert.match(validateLeadPayload(validBookingRequest({ assessmentPathway: "scorecard" })).error, /pathway/i);
  assert.match(validateLeadPayload(validBookingRequest({ assessmentStage: "finished" })).error, /stage/i);
  assert.match(validateLeadPayload(validBookingRequest({ preferredContact: "phone", phone: "" })).error, /phone number/i);
  assert.match(validateLeadPayload(validBookingRequest({ state: "NSW", postcode: "3000" })).error, /postcode/i);
  assert.match(validateLeadPayload(validBookingRequest({ assessmentPathway: "basix-nsw" })).error, /New South Wales/i);
  assert.equal(validateLeadPayload(validBookingRequest({ assessmentPathway: "basix-nsw", state: "NSW", postcode: "2000" })).ok, true);
  assert.match(validateLeadPayload(validBookingRequest({
    consent: {
      accepted: true,
      purpose: PUBLIC_ASSESSMENT_BOOKING_CONSENT_PURPOSE,
      noticeVersion: "superseded-notice",
      grantedAt: new Date().toISOString(),
    },
  })).error, /current contact notice/i);
});

test("assessment booking envelopes are stable and require manual appointment confirmation", () => {
  const validated = validateLeadPayload(validBookingRequest());
  assert.equal(validated.ok, true);
  const envelope = createLeadEnvelope(validated.value, {
    now: () => new Date("2026-09-01T01:00:00.000Z"),
    createId: () => "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  });
  const retry = createLeadEnvelope(validated.value, {
    now: () => new Date("2026-09-02T01:00:00.000Z"),
    createId: () => "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  });
  assert.equal(envelope.eventType, "direct_trade.project");
  assert.equal(envelope.sourceJourney, PUBLIC_ASSESSMENT_BOOKING_SOURCE_JOURNEY);
  assert.equal(envelope.state, "VIC");
  assert.equal(envelope.directTradeTriage.status, "manual_review_required");
  assert.equal(envelope.directTradeTriage.autoSend, false);
  assert.deepEqual(envelope.directTradeTriage.reviewFlags, ["appointment_confirmation_required"]);
  assert.equal(envelope.reference, "AEA-20260901-12345678ABCD4ABC");
  assert.equal(retry.reference, envelope.reference);
  assert.equal(retry.submissionFingerprint, envelope.submissionFingerprint);

  const changed = validateLeadPayload(validBookingRequest({ preferredTiming: "Friday afternoon" }));
  assert.equal(changed.ok, true);
  assert.notEqual(publicPlanSubmissionFingerprint(changed.value), envelope.submissionFingerprint);
});

function bookingHandler({ fetchImpl, env, counters = {} } = {}) {
  counters.enqueue ||= 0;
  counters.opportunity ||= 0;
  counters.confirm ||= 0;
  return createLeadPostHandler({
    validateLeadPayload,
    createLeadEnvelope,
    createOperationalRecorder: () => ({ requestId: "request-booking-1", record() {} }),
    leadRateLimiter: { async check() { return { allowed: true }; } },
    async recordLeadIncident() {},
    async resolveSystemAdminNotifications() {},
    isPublicPlanEnquiry: () => false,
    isPublicRentalAssessmentRequest: () => false,
    isPublicAssessmentBookingRequest,
    async enqueuePublicPlanDelivery() { counters.enqueue += 1; },
    async createOpportunityFromLead() { counters.opportunity += 1; },
    async confirmPublicPlanIntakeOpportunity() { counters.confirm += 1; },
    env: env || {
      AEA_LEAD_WEBHOOK_URL: "https://processor.example/leads",
      AEA_LEAD_WEBHOOK_SIGNING_SECRET: LEAD_SIGNING_SECRET,
    },
    fetchImpl: fetchImpl || (async () => new Response("ok", { status: 200 })),
    timeoutMs: 2_000,
  });
}

function bookingRequest(payload = validBookingRequest()) {
  return new Request("https://compare.example/api/leads", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://compare.example" },
    body: JSON.stringify(payload),
  });
}

test("the public booking request uses the signed webhook without creating an appointment", async () => {
  let relayCalls = 0;
  let deliveredPayload;
  const counters = {};
  const handler = bookingHandler({
    counters,
    fetchImpl: async (_url, options) => {
      relayCalls += 1;
      const signed = JSON.parse(options.body);
      deliveredPayload = JSON.parse(Buffer.from(signed.payload, "base64url").toString("utf8"));
      return new Response("ok", { status: 200 });
    },
  });
  const response = await handler(bookingRequest());
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.equal(result.ok, true);
  assert.match(result.reference, /^AEA-20260901-/);
  assert.equal(relayCalls, 1);
  assert.equal(deliveredPayload.sourceJourney, PUBLIC_ASSESSMENT_BOOKING_SOURCE_JOURNEY);
  assert.equal(deliveredPayload.directTradeTriage.autoSend, false);
  assert.deepEqual(counters, { enqueue: 0, opportunity: 0, confirm: 0 });
});

test("the public booking request fails closed when delivery is unconfigured", async () => {
  const response = await bookingHandler({
    env: { AEA_LEAD_WEBHOOK_SIGNING_SECRET: LEAD_SIGNING_SECRET },
  })(bookingRequest());
  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /temporarily unavailable/i);
});
