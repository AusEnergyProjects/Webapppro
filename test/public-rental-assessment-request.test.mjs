import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  createLeadEnvelope,
  publicPlanSubmissionFingerprint,
} from "../src/lib/lead-envelope.mjs";
import {
  createLeadPostHandler,
} from "../src/lib/lead-route-handler.mjs";
import { validateLeadPayload } from "../src/lib/lead-validation.mjs";
import {
  isPublicRentalAssessmentRequest,
  normalizePublicRentalAssessmentOptionalModules,
  PUBLIC_RENTAL_ASSESSMENT_CONSENT_NOTICE_VERSION,
  PUBLIC_RENTAL_ASSESSMENT_CONSENT_PURPOSE,
  PUBLIC_RENTAL_ASSESSMENT_OPTIONAL_MODULES,
  PUBLIC_RENTAL_ASSESSMENT_REQUEST_KIND,
  PUBLIC_RENTAL_ASSESSMENT_SOURCE_JOURNEY,
} from "../src/lib/public-rental-assessment-request.mjs";

const LEAD_SIGNING_SECRET = "test-lead-signing-secret-with-32-bytes-minimum";

function validRentalRequest(overrides = {}) {
  return {
    submissionType: "upgrade",
    enquiry: PUBLIC_RENTAL_ASSESSMENT_REQUEST_KIND,
    submissionId: "20260824.12345678-abcd-4abc-8def-123456789abc",
    name: "Jamie Customer",
    email: "jamie@example.com",
    phone: "0400 000 000",
    requesterRole: "rental-provider",
    agencyName: "",
    customerUnitNumber: "Unit 4",
    customerStreetAddress: "15 Example Street",
    customerSuburb: "MELBOURNE",
    customerState: "VIC",
    postcode: "3000",
    requestedOptionalModules: [],
    projectNotes: "The property is currently vacant.",
    authorityConfirmed: true,
    clientStartedAt: Date.now() - 5_000,
    website: "",
    consent: {
      accepted: true,
      purpose: PUBLIC_RENTAL_ASSESSMENT_CONSENT_PURPOSE,
      noticeVersion: PUBLIC_RENTAL_ASSESSMENT_CONSENT_NOTICE_VERSION,
      grantedAt: new Date().toISOString(),
    },
    ...overrides,
  };
}

test("rental assessment requests default to minimum standards and retain only allowlisted intake fields", () => {
  const result = validateLeadPayload(validRentalRequest({
    tenantName: "Must not cross the boundary",
    accessCode: "1234",
    uploadedIdentityDocument: "private.pdf",
    projectCategories: ["solar"],
    state: "NSW",
  }));
  assert.equal(result.ok, true);
  assert.deepEqual(result.value.requestedOptionalModules, []);
  assert.deepEqual(result.value.projectCategories, ["rental-inspection"]);
  assert.deepEqual(result.value.projectPriorities, ["assessment-compliance"]);
  assert.equal(result.value.projectStage, "assessment-ready");
  assert.equal(result.value.propertyRelationship, "landlord-manager");
  assert.equal(result.value.state, "VIC");
  for (const field of ["tenantName", "accessCode", "uploadedIdentityDocument"]) {
    assert.equal(field in result.value, false);
  }
  assert.deepEqual(Object.keys(result.value).sort(), [
    "agencyName", "authorityConfirmed", "clientStartedAt", "consent",
    "customerState", "customerStreetAddress", "customerSuburb", "customerUnitNumber",
    "email", "enquiry", "name", "phone", "postcode", "preferredContact",
    "projectCategories", "projectNotes", "projectPriorities", "projectStage",
    "propertyRelationship", "requestedOptionalModules", "requesterRole", "state",
    "submissionId", "submissionType", "submittedAt", "upgrades", "website",
  ].sort());
});

test("rental assessment validation requires exact Victorian authority, role, scope and consent", () => {
  assert.equal(validateLeadPayload(validRentalRequest()).ok, true);
  assert.match(validateLeadPayload(validRentalRequest({ email: "" })).error, /email address/i);
  assert.match(validateLeadPayload(validRentalRequest({ requesterRole: "tenant" })).error, /rental provider|agent/i);
  assert.match(validateLeadPayload(validRentalRequest({
    requesterRole: "agent-property-manager",
    agencyName: "",
  })).error, /agency|business name/i);
  assert.equal(validateLeadPayload(validRentalRequest({
    requesterRole: "agent-property-manager",
    agencyName: "Example Property Management",
  })).ok, true);
  assert.match(validateLeadPayload(validRentalRequest({ authorityConfirmed: false })).error, /authorised/i);
  assert.match(validateLeadPayload(validRentalRequest({
    customerStreetAddress: "1 George Street",
    customerSuburb: "SYDNEY",
    customerState: "NSW",
    postcode: "2000",
  })).error, /Victorian suburb/i);
  assert.match(validateLeadPayload(validRentalRequest({
    requestedOptionalModules: ["two_year_electrical_check"],
  })).error, /optional assessment selection/i);
  assert.match(validateLeadPayload(validRentalRequest({
    consent: {
      accepted: true,
      purpose: PUBLIC_RENTAL_ASSESSMENT_CONSENT_PURPOSE,
      noticeVersion: "old-notice",
      grantedAt: new Date().toISOString(),
    },
  })).error, /current contact notice/i);
  assert.deepEqual(normalizePublicRentalAssessmentOptionalModules([
    "smoke_alarm_check",
    "electrical_safety_check",
    "smoke_alarm_check",
  ]), ["electrical_safety_check", "smoke_alarm_check"]);
  assert.deepEqual(normalizePublicRentalAssessmentOptionalModules([
    "smoke_alarm_check",
    "electrical_safety_check",
  ]), ["electrical_safety_check", "smoke_alarm_check"]);
});

test("rental assessment envelopes are stable, manual-review only and bind material changes", () => {
  const validated = validateLeadPayload(validRentalRequest({
    requestedOptionalModules: ["electrical_safety_check"],
  }));
  assert.equal(validated.ok, true);
  const envelope = createLeadEnvelope(validated.value, {
    now: () => new Date("2026-08-24T01:00:00.000Z"),
    createId: () => "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  });
  const retry = createLeadEnvelope(validated.value, {
    now: () => new Date("2026-08-25T01:00:00.000Z"),
    createId: () => "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  });
  assert.equal(envelope.eventType, "direct_trade.project");
  assert.equal(envelope.sourceJourney, PUBLIC_RENTAL_ASSESSMENT_SOURCE_JOURNEY);
  assert.equal(envelope.directTradeTriage.status, "manual_review_required");
  assert.equal(envelope.directTradeTriage.autoSend, false);
  assert.deepEqual(envelope.directTradeTriage.reviewFlags, ["booking_not_created"]);
  assert.equal(envelope.reference, "AEA-20260824-12345678ABCD4ABC");
  assert.equal(retry.reference, envelope.reference);
  assert.equal(retry.submissionFingerprint, envelope.submissionFingerprint);
  assert.match(envelope.submissionFingerprint, /^[a-f0-9]{64}$/);

  const changed = validateLeadPayload(validRentalRequest({
    requestedOptionalModules: ["gas_safety_check"],
  }));
  assert.equal(changed.ok, true);
  assert.notEqual(
    publicPlanSubmissionFingerprint(changed.value),
    envelope.submissionFingerprint,
  );
  const changedRequester = validateLeadPayload(validRentalRequest({
    name: "A different requester",
    requestedOptionalModules: ["electrical_safety_check"],
  }));
  assert.equal(changedRequester.ok, true);
  assert.notEqual(
    publicPlanSubmissionFingerprint(changedRequester.value),
    envelope.submissionFingerprint,
  );
});

test("the public rental form keeps every separate safety check controlled and off by default", () => {
  const component = fs.readFileSync("src/components/PublicRentalAssessmentRequestForm.tsx", "utf8");
  const fieldWorkflow = fs.readFileSync("src/components/TradeRentalInspectionPanel.tsx", "utf8");
  const page = fs.readFileSync("src/app/rental-assessment/request/page.tsx", "utf8");
  const assessments = fs.readFileSync("src/app/assessments/page.tsx", "utf8");
  assert.match(component, /useState<string\[\]>\(\[\]\)/);
  assert.match(component, /checked=\{requestedOptionalModules\.includes\(moduleKey\)\}/);
  assert.doesNotMatch(component, /defaultChecked/);
  for (const moduleKey of PUBLIC_RENTAL_ASSESSMENT_OPTIONAL_MODULES) {
    assert.match(component, new RegExp(moduleKey));
  }
  assert.match(component, /separate and off by default/i);
  assert.match(component, /function changeConsent\(accepted: boolean\)/);
  assert.match(component, /consentGrantedAt\.current = new Date\(\)\.toISOString\(\)/);
  assert.match(component, /onChange=\{\(event\) => changeConsent\(event\.target\.checked\)\}/);
  assert.match(fieldWorkflow, /fresh device-reported GPS position within 100 metres is required for every assessment photo/i);
  assert.match(fieldWorkflow, /records the time, coordinates and accuracy in the issued report/i);
  assert.match(component, /not booked or scheduled/i);
  assert.doesNotMatch(component, /tenantName|accessCode|identityDocument/);
  assert.match(page, /No account is required|without creating an account/);
  assert.match(assessments, /href="\/rental-assessment\/request"/);
  assert.doesNotMatch(component + page, /[\u2013\u2014]/);
});

function rentalHandler({
  fetchImpl,
  rateLimit = { allowed: true },
  env = {
    AEA_LEAD_WEBHOOK_URL: "https://processor.example/leads",
    AEA_LEAD_WEBHOOK_SIGNING_SECRET: LEAD_SIGNING_SECRET,
  },
  counters = {},
} = {}) {
  counters.enqueue ||= 0;
  counters.opportunity ||= 0;
  counters.confirm ||= 0;
  return createLeadPostHandler({
    validateLeadPayload,
    createLeadEnvelope,
    createOperationalRecorder: () => ({ requestId: "request-rental-1", record() {} }),
    leadRateLimiter: { async check() { return rateLimit; } },
    async recordLeadIncident() {},
    async resolveSystemAdminNotifications() {},
    isPublicPlanEnquiry: () => false,
    isPublicRentalAssessmentRequest,
    async enqueuePublicPlanDelivery() { counters.enqueue += 1; },
    async createOpportunityFromLead() { counters.opportunity += 1; },
    async confirmPublicPlanIntakeOpportunity() { counters.confirm += 1; },
    env,
    fetchImpl: fetchImpl || (async () => new Response("ok", { status: 200 })),
    timeoutMs: 2_000,
  });
}

function rentalRequest(payload = validRentalRequest(), headers = {}) {
  return new Request("https://compare.example/api/leads", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://compare.example",
      ...headers,
    },
    body: JSON.stringify(payload),
  });
}

test("the no-account request uses the signed webhook exactly once and creates no plan or job records", async () => {
  let relayCalls = 0;
  let deliveredPayload;
  const counters = {};
  const handler = rentalHandler({
    counters,
    fetchImpl: async (_url, options) => {
      relayCalls += 1;
      const signed = JSON.parse(options.body);
      assert.equal(signed.eventType, "lead.webhook");
      assert.match(signed.signature, /^[A-Za-z0-9_-]{43}$/);
      deliveredPayload = JSON.parse(Buffer.from(signed.payload, "base64url").toString("utf8"));
      return new Response("ok", { status: 200 });
    },
  });
  const response = await handler(rentalRequest());
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.equal(result.ok, true);
  assert.equal(relayCalls, 1);
  assert.equal(deliveredPayload.sourceJourney, PUBLIC_RENTAL_ASSESSMENT_SOURCE_JOURNEY);
  assert.equal(deliveredPayload.directTradeTriage.autoSend, false);
  assert.deepEqual(counters, { enqueue: 0, opportunity: 0, confirm: 0 });
});

test("the no-account request fails safely at its origin, bot, rate-limit and webhook boundaries", async () => {
  let relayCalls = 0;
  const fetchImpl = async () => {
    relayCalls += 1;
    return new Response("not-ok", { status: 200 });
  };
  const wrongOrigin = await rentalHandler({ fetchImpl })(rentalRequest(validRentalRequest(), {
    Origin: "https://attacker.example",
  }));
  assert.equal(wrongOrigin.status, 403);

  const honeypot = await rentalHandler({ fetchImpl })(rentalRequest(validRentalRequest({ website: "bot.example" })));
  assert.equal(honeypot.status, 200);
  assert.deepEqual(await honeypot.json(), { ok: true, filtered: true });

  const limited = await rentalHandler({ fetchImpl, rateLimit: { allowed: false, retryAfterSeconds: 30 } })(rentalRequest());
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get("Retry-After"), "30");

  const missingWebhook = await rentalHandler({ fetchImpl, env: {
    AEA_LEAD_WEBHOOK_SIGNING_SECRET: LEAD_SIGNING_SECRET,
  } })(rentalRequest());
  assert.equal(missingWebhook.status, 503);

  const missingSecret = await rentalHandler({ fetchImpl, env: {
    AEA_LEAD_WEBHOOK_URL: "https://processor.example/leads",
  } })(rentalRequest());
  assert.equal(missingSecret.status, 502);

  const unacknowledged = await rentalHandler({ fetchImpl })(rentalRequest());
  assert.equal(unacknowledged.status, 502);
  assert.equal(relayCalls, 1);
});
