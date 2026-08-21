import assert from "node:assert/strict";
import test from "node:test";
import {
  buildEnergyAssistantEnquirySubmission,
  ENERGY_ASSISTANT_MATCHING_EXPLANATION,
  ENERGY_ASSISTANT_MATCHING_PRIVACY_EXPLANATION,
} from "../src/lib/energy-assistant-enquiry-adapter.mjs";
import { createLeadEnvelope } from "../src/lib/lead-envelope.mjs";
import { validateLeadPayload } from "../src/lib/lead-validation.mjs";
import {
  PUBLIC_PLAN_CONSENT_NOTICE_VERSION,
  PUBLIC_PLAN_CONSENT_PURPOSE,
} from "../src/lib/public-plan-enquiry.mjs";
import { PUBLIC_PLAN_QUOTE_PREPARATION_VERSION } from "../src/lib/public-plan-quote-preparation.mjs";

const consentGrantedAt = "2026-08-21T04:00:00.000Z";

function tradeEnquiry(overrides = {}) {
  return {
    submissionId: "20260821.12345678-abcd-4abc-8def-123456789abc",
    clientStartedAt: 1_776_744_000_000,
    consentAccepted: true,
    consentGrantedAt,
    customerFirstName: "Jamie",
    customerLastName: "Customer",
    email: "jamie@example.com",
    phone: "0400 000 000",
    customerUnitNumber: "Unit 4",
    customerStreetAddress: "15 Example Street",
    customerSuburb: "melbourne",
    customerState: "vic",
    postcode: "3000",
    services: ["heating-cooling"],
    customerMessage: "Please arrange an independent heating and cooling quote.",
    shareContact: { name: false, phone: false, address: false },
    quoteAnswers: [{ questionId: "timing", answer: "Within 3 months" }],
    shareKnownPlanFacts: true,
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
    ...overrides,
  };
}

test("matched-trade selection builds the canonical no-photo public-plan request and no assistant request", () => {
  const submission = buildEnergyAssistantEnquirySubmission({
    destination: "matched-trades",
    tradeEnquiry: tradeEnquiry(),
  });
  assert.equal(submission.endpoint, "/api/leads");
  assert.equal("assistantPayload" in submission, false);
  assert.deepEqual(submission.payload.consent, {
    accepted: true,
    purpose: PUBLIC_PLAN_CONSENT_PURPOSE,
    noticeVersion: PUBLIC_PLAN_CONSENT_NOTICE_VERSION,
    grantedAt: consentGrantedAt,
  });
  assert.deepEqual(submission.payload.quotePreparation.photoPromptIds, []);
  assert.equal(submission.payload.quotePreparation.expectedPhotoCount, 0);
  assert.equal(submission.payload.quotePreparation.uploadKeyHash, "");
  assert.equal(
    submission.payload.quotePreparation.version,
    PUBLIC_PLAN_QUOTE_PREPARATION_VERSION,
  );
  assert.ok(submission.payload.quotePreparation.answers.some(
    (answer) => answer.questionId === "known-plan-heating-cooling",
  ));
  assert.equal(submission.payload.customerSuburb, "MELBOURNE");
  assert.equal(submission.payload.customerState, "VIC");
  assert.equal(submission.payload.planSnapshot.version.includes("complete-home-context"), true);
  assert.doesNotMatch(
    JSON.stringify(submission.payload),
    /"(?:chatHistory|transcript|documents|bills|photos|nmi|meterIdentifier|accountIdentifier)"\s*:/i,
  );

  const validated = validateLeadPayload(submission.payload);
  assert.equal(validated.ok, true, validated.error);
  const envelope = createLeadEnvelope(validated.value, {
    now: () => new Date(consentGrantedAt),
    createId: () => "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  });
  assert.equal("planSnapshot" in envelope, false);
  assert.deepEqual(envelope.directTradeTriage.contactConsentReceipt.disclosedFields, [
    "customer_email",
    "postcode",
    "service_categories",
    "customer_message",
  ]);
});

test("saved plan facts remain private unless separately selected as quote answers", () => {
  const submission = buildEnergyAssistantEnquirySubmission({
    destination: "matched-trades",
    tradeEnquiry: tradeEnquiry({
      customerMessage: "",
      shareKnownPlanFacts: false,
      quoteAnswers: [],
    }),
  });
  assert.deepEqual(submission.payload.quotePreparation.answers, []);
  assert.equal(submission.payload.projectNotes, "");
  const validated = validateLeadPayload(submission.payload);
  assert.equal(validated.ok, true, validated.error);
  const envelope = createLeadEnvelope(validated.value);
  assert.deepEqual(envelope.directTradeTriage.contactConsentReceipt.disclosedFields, [
    "customer_email",
    "postcode",
    "service_categories",
  ]);
});

test("only the optional contact fields selected by the customer enter the trade envelope", () => {
  const submission = buildEnergyAssistantEnquirySubmission({
    destination: "matched-trades",
    tradeEnquiry: tradeEnquiry({
      customerMessage: "",
      shareContact: { name: true, phone: false, address: true },
      shareKnownPlanFacts: false,
      quoteAnswers: [],
    }),
  });
  const validated = validateLeadPayload(submission.payload);
  assert.equal(validated.ok, true, validated.error);
  const envelope = createLeadEnvelope(validated.value);
  assert.deepEqual(envelope.directTradeTriage.contactConsentReceipt.disclosedFields, [
    "customer_email",
    "postcode",
    "service_categories",
    "customer_name",
    "customer_address",
  ]);
});

test("AEA-only follow-up selects only the existing assistant-lead endpoint", () => {
  const assistantPayload = {
    requestId: "lead-request-00000001",
    tradeSharingConsent: { accepted: false },
  };
  const submission = buildEnergyAssistantEnquirySubmission({
    destination: "aea-follow-up",
    assistantPayload,
  });
  assert.deepEqual(submission, {
    endpoint: "/api/energy-assistant/leads",
    payload: assistantPayload,
  });
  assert.throws(
    () => buildEnergyAssistantEnquirySubmission({
      destination: "aea-follow-up",
      assistantPayload,
      tradeEnquiry: tradeEnquiry(),
    }),
    /not both/i,
  );
  assert.throws(
    () => buildEnergyAssistantEnquirySubmission({
      destination: "aea-follow-up",
      assistantPayload: { ...assistantPayload, tradeSharingConsent: { accepted: true } },
    }),
    /must use the private-plan trade enquiry path/i,
  );
  assert.throws(
    () => buildEnergyAssistantEnquirySubmission({
      destination: "matched-trades",
      assistantPayload,
      tradeEnquiry: tradeEnquiry(),
    }),
    /not both/i,
  );
});

test("trade matching fails closed without explicit consent, selected services, required private records or a safe bounded contract", () => {
  for (const [change, expected] of [
    [{ consentAccepted: false }, /confirm the current/i],
    [{ services: [] }, /choose at least one service/i],
    [{ email: "" }, /email address/i],
    [{ phone: "" }, /phone number/i],
    [{ customerStreetAddress: "" }, /street address/i],
    [{ customerState: "NSW" }, /listed for this postcode/i],
    [{ shareKnownPlanFacts: undefined }, /choose whether saved home-plan facts/i],
    [{ customerMessage: "NMI number 6407123456" }, /remove NMI/i],
    [{ chatHistory: [{ role: "user", content: "private" }] }, /unsupported field/i],
  ]) {
    assert.throws(
      () => buildEnergyAssistantEnquirySubmission({
        destination: "matched-trades",
        tradeEnquiry: tradeEnquiry(change),
      }),
      expected,
    );
  }
});

test("public matching copy is direct, independent, provider-neutral and truthful about the privacy boundary", () => {
  assert.match(ENERGY_ASSISTANT_MATCHING_EXPLANATION, /provider-neutral, independent guidance/i);
  assert.match(ENERGY_ASSISTANT_MATCHING_EXPLANATION, /one structured enquiry/i);
  assert.match(ENERGY_ASSISTANT_MATCHING_EXPLANATION, /selected upgrade and area/i);
  assert.match(ENERGY_ASSISTANT_MATCHING_EXPLANATION, /deal directly/i);
  assert.match(ENERGY_ASSISTANT_MATCHING_EXPLANATION, /does not rank or recommend brands, products, suppliers or installers/i);
  assert.doesNotMatch(ENERGY_ASSISTANT_MATCHING_EXPLANATION, /no middleman|without a .*middleman/i);
  assert.match(ENERGY_ASSISTANT_MATCHING_PRIVACY_EXPLANATION, /email, postcode and selected services are shared/i);
  assert.match(ENERGY_ASSISTANT_MATCHING_PRIVACY_EXPLANATION, /name, phone and address are shared only when you select each field/i);
  assert.match(ENERGY_ASSISTANT_MATCHING_PRIVACY_EXPLANATION, /private plan PDF, full saved plan and chat stay private/i);
  assert.match(ENERGY_ASSISTANT_MATCHING_PRIVACY_EXPLANATION, /separately select/i);
  assert.match(ENERGY_ASSISTANT_MATCHING_PRIVACY_EXPLANATION, /no-photo handoff/i);
  assert.match(ENERGY_ASSISTANT_MATCHING_PRIVACY_EXPLANATION, /excludes bills, documents, photos, NMI/i);
  assert.doesNotMatch(
    `${ENERGY_ASSISTANT_MATCHING_EXPLANATION} ${ENERGY_ASSISTANT_MATCHING_PRIVACY_EXPLANATION}`,
    /TLink|Creditex|CHOICE|Saul|Forcey|Keech|Ecomaster|Dr Karl/i,
  );
});
