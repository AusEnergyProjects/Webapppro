import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { createLeadEnvelope } from "../src/lib/lead-envelope.mjs";
import { validateLeadPayload } from "../src/lib/lead-validation.mjs";
import {
  isPublicPlanEnquiry,
  PUBLIC_PLAN_CONSENT_NOTICE_VERSION,
  PUBLIC_PLAN_CONSENT_PURPOSE,
  PUBLIC_PLAN_ENQUIRY_KIND,
} from "../src/lib/public-plan-enquiry.mjs";
import { createLeadPostHandler } from "../src/lib/lead-route-handler.mjs";

function validPlanEnquiry(overrides = {}) {
  return {
    submissionType: "upgrade",
    enquiry: PUBLIC_PLAN_ENQUIRY_KIND,
    name: "Jamie Customer",
    email: "jamie@example.com",
    phone: "",
    postcode: "3000",
    projectCategories: ["heating-cooling"],
    projectNotes: "The main unit is near the end of its life.",
    clientStartedAt: Date.now() - 5000,
    website: "",
    consent: {
      accepted: true,
      purpose: PUBLIC_PLAN_CONSENT_PURPOSE,
      noticeVersion: PUBLIC_PLAN_CONSENT_NOTICE_VERSION,
      grantedAt: new Date().toISOString(),
    },
    ...overrides,
  };
}

test("public plan enquiries accept email or phone without an account", () => {
  const withEmail = validateLeadPayload(validPlanEnquiry());
  assert.equal(withEmail.ok, true);
  assert.equal(withEmail.value.preferredContact, "email");

  const withPhone = validateLeadPayload(validPlanEnquiry({ email: "", phone: "0400 000 000" }));
  assert.equal(withPhone.ok, true);
  assert.equal(withPhone.value.preferredContact, "phone");
});

test("public plan enquiries require contact, postcode, one interest and the exact consent notice", () => {
  assert.match(validateLeadPayload(validPlanEnquiry({ email: "", phone: "" })).error, /email address or phone/i);
  assert.match(validateLeadPayload(validPlanEnquiry({ postcode: "" })).error, /postcode/i);
  assert.match(validateLeadPayload(validPlanEnquiry({ postcode: "0000" })).error, /valid Australian postcode/i);
  assert.match(validateLeadPayload(validPlanEnquiry({ postcode: "9999" })).error, /valid Australian postcode/i);
  assert.match(validateLeadPayload(validPlanEnquiry({ projectCategories: [] })).error, /choose one upgrade/i);
  assert.match(validateLeadPayload(validPlanEnquiry({ projectCategories: ["solar", "battery"] })).error, /choose one upgrade/i);
  assert.match(validateLeadPayload(validPlanEnquiry({ email: "", phone: "call me" })).error, /valid phone number/i);
  assert.match(validateLeadPayload(validPlanEnquiry({
    consent: { accepted: true, purpose: PUBLIC_PLAN_CONSENT_PURPOSE, noticeVersion: "old", grantedAt: new Date().toISOString() },
  })).error, /current contact notice/i);
});

test("public plan validation drops hidden household, account, usage and meter fields", () => {
  const result = validateLeadPayload(validPlanEnquiry({
    nmi: "6407123456",
    intervals: [{ timestamp: "2026-01-01", kwh: 4 }],
    annualKwh: 7600,
    planAnswers: { occupants: 4 },
    budgetRange: "20000-plus",
    propertyType: "house",
    projectPriorities: ["lower-running-costs"],
    top3: [{ rank: 1, brand: "Private", plan: "Private", annual: 1 }],
  }));
  assert.equal(result.ok, true);
  for (const field of ["nmi", "intervals", "annualKwh", "planAnswers", "budgetRange", "propertyType", "projectPriorities", "top3"]) {
    assert.equal(field in result.value, false, `${field} must not cross the public enquiry boundary`);
  }
  assert.deepEqual(Object.keys(result.value).sort(), [
    "clientStartedAt", "consent", "email", "enquiry", "name", "phone", "postcode",
    "preferredContact", "projectCategories", "projectNotes", "submissionType", "submittedAt",
    "upgrades", "website",
  ].sort());
});

test("public plan envelopes use the existing accepted lead event but remain held from automatic trade sharing", () => {
  const validated = validateLeadPayload(validPlanEnquiry());
  assert.equal(validated.ok, true);
  const envelope = createLeadEnvelope(validated.value, {
    now: () => new Date("2026-08-10T03:00:00.000Z"),
    createId: () => "12345678-abcd-4000-8000-123456789abc",
  });
  assert.equal(envelope.eventType, "direct_trade.project");
  assert.equal(envelope.sourceJourney, "public-home-energy-plan");
  assert.equal(envelope.directTradeTriage.autoSend, false);
  assert.equal(envelope.directTradeTriage.status, "hold_for_authority_review");
  assert.deepEqual(envelope.directTradeTriage.contactConsentReceipt, {
    accepted: true,
    purpose: PUBLIC_PLAN_CONSENT_PURPOSE,
    noticeVersion: PUBLIC_PLAN_CONSENT_NOTICE_VERSION,
    grantedAt: validated.value.consent.grantedAt,
  });
  assert.deepEqual(envelope.projectCategories, ["heating-cooling"]);
  assert.equal("planAnswers" in envelope, false);
});

test("the public component sends only the visible bounded contact contract", () => {
  const component = fs.readFileSync("src/components/PublicPlanEnquiryForm.tsx", "utf8");
  assert.match(component, /fetch\("\/api\/leads"/);
  assert.match(component, /submissionType: "upgrade"/);
  assert.match(component, /projectCategories: \[interest\]/);
  assert.match(component, /projectNotes: message/);
  assert.match(component, /residentialStateFromPostcode\(postcode\)/);
  assert.match(component, /maxLength=\{500\}/);
  assert.match(component, /if \(result\.filtered\)/);
  assert.match(component, /Your plan answers, account data, energy usage, meter identifiers and uploaded files are not included/);
  assert.doesNotMatch(component, /annualKwh|annualMj|nmi|intervals|planAnswers|budgetRange|streetAddress/);
  assert.doesNotMatch(component, /[\u2013\u2014]/);
});

function requestHandler({ fetchImpl, rateLimit = { allowed: true } }) {
  return createLeadPostHandler({
    validateLeadPayload,
    createLeadEnvelope,
    createOperationalRecorder: () => ({
      requestId: "request-test-1",
      record() {},
    }),
    leadRateLimiter: {
      async check() {
        return rateLimit;
      },
    },
    async recordLeadIncident() {},
    async resolveSystemAdminNotifications() {},
    isPublicPlanEnquiry,
    env: { AEA_LEAD_WEBHOOK_URL: "https://processor.example/leads" },
    fetchImpl,
    timeoutMs: 2_000,
  });
}

test("an immediately submitted valid public plan enquiry is delivered and never receives false success", async () => {
  let delivery;
  const handler = requestHandler({
    fetchImpl: async (url, init) => {
      delivery = { url, init };
      return new Response("ok", { status: 200 });
    },
  });
  const payload = validPlanEnquiry({ clientStartedAt: Date.now() });
  const response = await handler(new Request("https://compare.example/api/leads", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://compare.example",
      "CF-Connecting-IP": "203.0.113.42",
    },
    body: JSON.stringify(payload),
  }));
  const result = await response.json();

  assert.equal(response.status, 200);
  assert.equal(result.ok, true);
  assert.equal(result.filtered, undefined);
  assert.match(result.reference, /^AEA-/);
  assert.equal(delivery.url, "https://processor.example/leads");
  const deliveredPayload = JSON.parse(delivery.init.body);
  assert.equal(deliveredPayload.sourceJourney, "public-home-energy-plan");
  assert.equal(deliveredPayload.directTradeTriage.autoSend, false);
});

test("a honeypot submission remains filtered and the client refuses to call it delivered", async () => {
  let deliveries = 0;
  const handler = requestHandler({
    fetchImpl: async () => {
      deliveries += 1;
      return new Response("ok", { status: 200 });
    },
  });
  const response = await handler(new Request("https://compare.example/api/leads", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(validPlanEnquiry({ website: "bot.example" })),
  }));

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, filtered: true });
  assert.equal(deliveries, 0);
});

test("the lead route keeps origin, JSON size, honeypot and durable rate-limit protections", () => {
  const route = fs.readFileSync("src/app/api/leads/route.js", "utf8");
  const handler = fs.readFileSync("src/lib/lead-route-handler.mjs", "utf8");
  const source = `${route}\n${handler}`;
  assert.match(source, /isPublicPlanEnquiry/);
  assert.match(source, /origin && origin !== requestOrigin/);
  assert.match(source, /MAX_BODY_BYTES/);
  assert.match(source, /if \(payload\.website\)/);
  assert.doesNotMatch(source, /startedTooQuickly|< 1200/);
  assert.match(source, /await leadRateLimiter\.check/);
  assert.match(source, /"Retry-After"/);
});
