import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  createLeadEnvelope,
  publicPlanSubmissionFingerprint,
} from "../src/lib/lead-envelope.mjs";
import { validateLeadPayload } from "../src/lib/lead-validation.mjs";
import {
  isPublicPlanEnquiry,
  PUBLIC_PLAN_CONSENT_NOTICE_VERSION,
  PUBLIC_PLAN_CONSENT_PURPOSE,
  PUBLIC_PLAN_ENQUIRY_KIND,
} from "../src/lib/public-plan-enquiry.mjs";
import {
  createLeadPostHandler,
  createSignedLeadWebhookEnvelope,
} from "../src/lib/lead-route-handler.mjs";

const LEAD_SIGNING_SECRET = "test-lead-signing-secret-with-32-bytes-minimum";

function signedWebhookPayload(init) {
  const signed = JSON.parse(init.body);
  assert.equal(signed.schemaVersion, "1");
  assert.equal(signed.eventType, "lead.webhook");
  assert.match(signed.signature, /^[A-Za-z0-9_-]{43}$/);
  return JSON.parse(Buffer.from(signed.payload, "base64url").toString("utf8"));
}

function validPlanEnquiry(overrides = {}) {
  return {
    submissionType: "upgrade",
    enquiry: PUBLIC_PLAN_ENQUIRY_KIND,
    submissionId: "20260810.12345678-abcd-4abc-8def-123456789abc",
    name: "Jamie Customer",
    email: "jamie@example.com",
    phone: "0400 000 000",
    postcode: "3000",
    projectCategories: ["heating-cooling"],
    projectNotes: "The main unit is near the end of its life.",
    tradeSharing: {
      email: true,
      postcode: true,
      name: false,
      phone: false,
    },
    planSnapshot: {
      goals: ["lower-bills", "improve-comfort"],
      pace: "staged",
      situation: "owner",
      approvalContext: "none",
      budgetRange: "2_10k",
      addressState: "VIC",
      features: ["reverse-cycle", "ceiling-insulation-unknown"],
      propertyContext: {
        propertyType: "townhouse",
        storeys: "two",
        floorArea: "100_199",
        occupants: "three_four",
        sharedWalls: "one_side",
      },
    },
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

test("public plan enquiries privately collect name, email, phone and postcode without an account", () => {
  const result = validateLeadPayload(validPlanEnquiry());
  assert.equal(result.ok, true);
  assert.equal(result.value.name, "Jamie Customer");
  assert.equal(result.value.email, "jamie@example.com");
  assert.equal(result.value.phone, "0400 000 000");
  assert.equal(result.value.postcode, "3000");
  assert.equal(result.value.preferredContact, "either");
  assert.deepEqual(result.value.tradeSharing, {
    email: true,
    postcode: true,
    name: false,
    phone: false,
  });
});

test("public plan enquiries require private contact records, mandatory trade routing fields and the exact consent notice", () => {
  assert.match(PUBLIC_PLAN_CONSENT_NOTICE_VERSION, /^\d{4}-\d{2}-\d{2}-[a-z0-9-]+-v\d+$/);
  assert.ok(PUBLIC_PLAN_CONSENT_NOTICE_VERSION.length <= 64);
  assert.equal(validateLeadPayload(validPlanEnquiry()).ok, true);
  assert.match(validateLeadPayload(validPlanEnquiry({ email: "" })).error, /email address/i);
  assert.match(validateLeadPayload(validPlanEnquiry({ phone: "" })).error, /phone number.*records/i);
  assert.match(validateLeadPayload(validPlanEnquiry({ postcode: "" })).error, /postcode/i);
  assert.match(validateLeadPayload(validPlanEnquiry({ postcode: "0000" })).error, /valid Australian postcode/i);
  assert.match(validateLeadPayload(validPlanEnquiry({ postcode: "9999" })).error, /valid Australian postcode/i);
  assert.match(validateLeadPayload(validPlanEnquiry({ projectCategories: [] })).error, /choose one upgrade/i);
  assert.match(validateLeadPayload(validPlanEnquiry({ projectCategories: ["solar", "battery"] })).error, /choose one upgrade/i);
  assert.match(validateLeadPayload(validPlanEnquiry({ submissionId: "" })).error, /new home plan enquiry/i);
  assert.match(validateLeadPayload(validPlanEnquiry({ submissionId: "20260810.not-random" })).error, /new home plan enquiry/i);
  assert.match(validateLeadPayload(validPlanEnquiry({ phone: "call me" })).error, /valid phone number/i);
  assert.match(validateLeadPayload(validPlanEnquiry({ tradeSharing: undefined })).error, /which contact details/i);
  assert.match(validateLeadPayload(validPlanEnquiry({
    tradeSharing: { email: false, postcode: true, name: false, phone: false },
  })).error, /email and postcode must be shared/i);
  assert.match(validateLeadPayload(validPlanEnquiry({
    tradeSharing: { email: true, postcode: true, name: false },
  })).error, /each optional trade sharing preference/i);
  assert.match(validateLeadPayload(validPlanEnquiry({
    tradeSharing: { email: true, postcode: true, name: false, phone: false, message: false },
  })).error, /unsupported field/i);
  assert.match(validateLeadPayload(validPlanEnquiry({
    consent: { accepted: true, purpose: PUBLIC_PLAN_CONSENT_PURPOSE, noticeVersion: "old", grantedAt: new Date().toISOString() },
  })).error, /current contact notice/i);
  assert.match(validateLeadPayload(validPlanEnquiry({
    consent: { accepted: true, purpose: PUBLIC_PLAN_CONSENT_PURPOSE, noticeVersion: "x".repeat(65), grantedAt: new Date().toISOString() },
  })).error, /current contact notice/i);
});

test("public plan validation keeps only the bounded canonicalizable snapshot and drops private usage fields", () => {
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
    "planSnapshot", "preferredContact", "projectCategories", "projectNotes", "submissionType", "submittedAt", "tradeSharing",
    "submissionId", "upgrades", "website",
  ].sort());
  assert.equal(result.value.planSnapshot.propertyContext.propertyType, "townhouse");
  assert.equal("items" in result.value.planSnapshot, false);
});

test("public plan envelopes open matching under the exact consent receipt and strip the private plan snapshot", () => {
  const validated = validateLeadPayload(validPlanEnquiry());
  assert.equal(validated.ok, true);
  const envelope = createLeadEnvelope(validated.value, {
    now: () => new Date("2026-08-10T03:00:00.000Z"),
    createId: () => "12345678-abcd-4000-8000-123456789abc",
  });
  assert.equal(envelope.eventType, "direct_trade.project");
  assert.equal(envelope.sourceJourney, "public-home-energy-plan");
  assert.equal(envelope.directTradeTriage.autoSend, true);
  assert.equal(envelope.directTradeTriage.status, "automatic_verified_area_allocation");
  assert.deepEqual(envelope.directTradeTriage.contactConsentReceipt, {
    accepted: true,
    purpose: PUBLIC_PLAN_CONSENT_PURPOSE,
    noticeVersion: PUBLIC_PLAN_CONSENT_NOTICE_VERSION,
    grantedAt: validated.value.consent.grantedAt,
    disclosedFields: ["customer_email", "postcode", "service_categories", "customer_message"],
  });
  const withoutMessage = validateLeadPayload(validPlanEnquiry({ projectNotes: "" }));
  assert.equal(withoutMessage.ok, true);
  const envelopeWithoutMessage = createLeadEnvelope(withoutMessage.value, {
    now: () => new Date("2026-08-10T03:00:00.000Z"),
    createId: () => "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
  });
  assert.deepEqual(
    envelopeWithoutMessage.directTradeTriage.contactConsentReceipt.disclosedFields,
    ["customer_email", "postcode", "service_categories"],
  );
  assert.deepEqual(envelope.projectCategories, ["heating-cooling"]);
  assert.equal("planSnapshot" in envelope, false);
  assert.equal("customerPlanDelivery" in envelope, false);
  assert.match(envelope.submissionFingerprint, /^[a-f0-9]{64}$/);
  assert.equal(envelope.submissionFingerprint, publicPlanSubmissionFingerprint(validated.value));
  const retryEnvelope = createLeadEnvelope(validated.value, {
    now: () => new Date("2026-08-12T03:00:00.000Z"),
    createId: () => "ffffffff-ffff-4fff-8fff-ffffffffffff",
  });
  assert.equal(retryEnvelope.reference, envelope.reference);
  assert.equal(retryEnvelope.submissionFingerprint, envelope.submissionFingerprint);
  assert.equal(envelope.reference, "AEA-20260810-12345678ABCD4ABC");
});

test("the public submission fingerprint binds the stable reference to material canonical fields", () => {
  const original = validateLeadPayload(validPlanEnquiry());
  const changed = validateLeadPayload(validPlanEnquiry({
    projectNotes: "Please quote a different scope.",
  }));
  assert.equal(original.ok, true);
  assert.equal(changed.ok, true);
  assert.notEqual(
    publicPlanSubmissionFingerprint(original.value),
    publicPlanSubmissionFingerprint(changed.value),
  );
  assert.equal(
    publicPlanSubmissionFingerprint({
      ...original.value,
      submittedAt: "2099-01-01T00:00:00.000Z",
      consent: { ...original.value.consent, grantedAt: "2099-01-01T00:00:00.000Z" },
    }),
    publicPlanSubmissionFingerprint(original.value),
  );
  const changedSharing = validateLeadPayload(validPlanEnquiry({
    tradeSharing: {
      email: true,
      postcode: true,
      name: false,
      phone: true,
    },
  }));
  assert.equal(changedSharing.ok, true);
  assert.notEqual(
    publicPlanSubmissionFingerprint(original.value),
    publicPlanSubmissionFingerprint(changedSharing.value),
  );
});

test("the public component sends the visible contact fields and bounded plan selection with explicit open-matching consent", () => {
  const component = fs.readFileSync("src/components/PublicPlanEnquiryForm.tsx", "utf8");
  const submittedSharing = component.match(
    /body: JSON\.stringify\(\{[\s\S]*?tradeSharing:\s*\{([\s\S]*?)\},\s*planSnapshot,/,
  )?.[1] || "";
  assert.match(component, /fetch\("\/api\/leads"/);
  assert.match(component, /submissionType: "upgrade"/);
  assert.match(component, /projectCategories: \[interest\]/);
  assert.match(component, /projectNotes: message/);
  assert.match(component, /tradeSharing:/);
  assert.match(component, /email: true/);
  assert.match(component, /postcode: true/);
  assert.match(component, /name: shareName/);
  assert.match(component, /phone: sharePhone/);
  assert.match(submittedSharing, /email: true/);
  assert.match(submittedSharing, /postcode: true/);
  assert.match(submittedSharing, /name: shareName/);
  assert.match(submittedSharing, /phone: sharePhone/);
  assert.doesNotMatch(submittedSharing, /message:/);
  assert.match(component, /useState\(false\)/);
  assert.match(component, /planSnapshot/);
  assert.match(component, /residentialStateFromPostcode\(postcode\)/);
  assert.match(component, /maxLength=\{500\}/);
  assert.match(component, /if \(result\.filtered\)/);
  assert.match(component, /all approved TLink trades that service my area/);
  assert.match(component, /full plan and PDF stay private/);
  assert.match(component, /Also share my name/);
  assert.match(component, /Also share my phone number/);
  assert.doesNotMatch(component, /shareMessage|Also share my optional message/);
  assert.match(component, /email, postcode, selected service and any message you write are included/i);
  assert.match(component, /any message I wrote/i);
  assert.match(component, /Australian Energy Assessments keeps these details for your enquiry/i);
  assert.match(component, /full plan and PDF stay private and are emailed only to me/i);
  assert.match(component, /lastAttemptCore\.current !== currentCore/);
  assert.match(component, /submissionId\.current = createSubmissionId\(\)/);
  assert.match(component, /function changeConsent\(accepted: boolean\)/);
  assert.match(component, /consentGrantedAt\.current = new Date\(\)\.toISOString\(\)/);
  assert.match(component, /onChange=\{\(event\) => changeConsent\(event\.target\.checked\)\}/);
  assert.match(component, /Retry trade matching/);
  assert.doesNotMatch(component, /useEffect\([\s\S]{0,220}consentGrantedAt\.current = new Date/);
  assert.doesNotMatch(component, /annualKwh|annualMj|nmi|intervals|planAnswers|streetAddress/);
  assert.doesNotMatch(component, /[\u2013\u2014]/);
});

function requestHandler({
  fetchImpl,
  rateLimit = { allowed: true },
  prepareLeadEnvelope,
  createOpportunityFromLead,
}) {
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
    prepareLeadEnvelope,
    createOpportunityFromLead,
    env: {
      AEA_LEAD_WEBHOOK_URL: "https://processor.example/leads",
      AEA_LEAD_WEBHOOK_SIGNING_SECRET: LEAD_SIGNING_SECRET,
    },
    fetchImpl,
    timeoutMs: 2_000,
  });
}

test("an immediately submitted valid public plan enquiry prepares customer delivery then creates a stripped opportunity after acknowledgement", async () => {
  let delivery;
  let acknowledged = false;
  let opportunity;
  const handler = requestHandler({
    fetchImpl: async (url, init) => {
      delivery = { url, init };
      acknowledged = true;
      return new Response("ok", { status: 200 });
    },
    prepareLeadEnvelope: async ({ envelope }) => ({
      ...envelope,
      customerPlanDelivery: { version: "test-customer-only" },
    }),
    createOpportunityFromLead: async (payload) => {
      assert.equal(acknowledged, true);
      opportunity = payload;
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
  assert.equal(result.planEmailSent, true);
  assert.equal(result.filtered, undefined);
  assert.match(result.reference, /^AEA-/);
  assert.equal(delivery.url, "https://processor.example/leads");
  const deliveredPayload = signedWebhookPayload(delivery.init);
  assert.equal(deliveredPayload.sourceJourney, "public-home-energy-plan");
  assert.equal(deliveredPayload.directTradeTriage.autoSend, true);
  assert.equal(deliveredPayload.customerPlanDelivery.version, "test-customer-only");
  assert.equal("customerPlanDelivery" in opportunity, false);
  assert.equal("planSnapshot" in opportunity, false);
});

test("a post-ack opportunity failure reports the safe receipt and offers an idempotent matching retry", async () => {
  const handler = requestHandler({
    fetchImpl: async () => new Response("ok", { status: 200 }),
    createOpportunityFromLead: async () => {
      throw new Error("D1 unavailable");
    },
  });
  const response = await handler(new Request("https://compare.example/api/leads", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(validPlanEnquiry()),
  }));
  const result = await response.json();
  assert.equal(response.status, 502);
  assert.equal(result.ok, false);
  assert.equal(result.received, true);
  assert.match(result.reference, /^AEA-/);
  assert.equal(result.planEmailSent, false);
  assert.match(result.error, /retry trade matching with the same request/i);
});

test("the same received enquiry can retry marketplace preparation without changing its relay identity", async () => {
  const delivered = [];
  let opportunityAttempts = 0;
  const handler = requestHandler({
    fetchImpl: async (_url, init) => {
      delivered.push(signedWebhookPayload(init));
      return new Response("ok", { status: 200 });
    },
    createOpportunityFromLead: async () => {
      opportunityAttempts += 1;
      if (opportunityAttempts === 1) throw new Error("D1 temporarily unavailable");
    },
  });
  const body = JSON.stringify(validPlanEnquiry());
  const makeRequest = () => new Request("https://compare.example/api/leads", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
  const first = await handler(makeRequest());
  assert.equal(first.status, 502);
  assert.equal((await first.json()).received, true);
  const second = await handler(makeRequest());
  assert.equal(second.status, 200);
  assert.equal((await second.json()).ok, true);
  assert.equal(opportunityAttempts, 2);
  assert.equal(delivered.length, 2);
  assert.equal(delivered[0].reference, delivered[1].reference);
  assert.equal(delivered[0].submissionFingerprint, delivered[1].submissionFingerprint);
  assert.equal(
    delivered[0].directTradeTriage.contactConsentReceipt.grantedAt,
    delivered[1].directTradeTriage.contactConsentReceipt.grantedAt,
  );
});

test("a lost relay response can be retried with the same stable reference without duplicate email or opportunity", async () => {
  const relayedReferences = new Set();
  let emails = 0;
  let fetchAttempts = 0;
  const opportunities = [];
  const handler = requestHandler({
    fetchImpl: async (_url, init) => {
      fetchAttempts += 1;
      const envelope = signedWebhookPayload(init);
      if (!relayedReferences.has(envelope.reference)) {
        relayedReferences.add(envelope.reference);
        emails += 1;
      }
      if (fetchAttempts === 1) throw new TypeError("response lost after relay success");
      return new Response("ok", { status: 200 });
    },
    createOpportunityFromLead: async (payload) => {
      if (!opportunities.includes(payload.reference)) opportunities.push(payload.reference);
    },
  });
  const body = JSON.stringify(validPlanEnquiry());
  const makeRequest = () => new Request("https://compare.example/api/leads", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
  const first = await handler(makeRequest());
  assert.equal(first.status, 502);
  const second = await handler(makeRequest());
  assert.equal(second.status, 200);
  const result = await second.json();
  assert.equal(result.ok, true);
  assert.equal(emails, 1);
  assert.equal(relayedReferences.size, 1);
  assert.deepEqual(opportunities, [...relayedReferences]);
});

test("lead webhook signing is deterministic for a fixed timestamp and fails closed without a distinct secret", () => {
  const now = () => new Date("2026-08-10T04:05:06.000Z");
  const first = createSignedLeadWebhookEnvelope({ reference: "AEA-TEST" }, LEAD_SIGNING_SECRET, { now });
  const second = createSignedLeadWebhookEnvelope({ reference: "AEA-TEST" }, LEAD_SIGNING_SECRET, { now });
  assert.deepEqual(first, second);
  assert.match(first.signature, /^[A-Za-z0-9_-]{43}$/);
  assert.throws(
    () => createSignedLeadWebhookEnvelope({ reference: "AEA-TEST" }, "too-short", { now }),
    /LEAD_WEBHOOK_SIGNING_UNCONFIGURED/,
  );
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
  assert.match(source, /AEA_LEAD_WEBHOOK_SIGNING_SECRET/);
  assert.match(source, /createSignedLeadWebhookEnvelope/);
});
