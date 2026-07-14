import assert from "node:assert/strict";
import test from "node:test";
import { createLeadEnvelope, leadEventType } from "../src/lib/lead-envelope.mjs";

const base = {
  submissionType: "upgrade",
  submittedAt: "2026-07-14T01:02:03.000Z",
  postcode: "3000",
  state: "",
};

test("lead events map every live email journey to a stable contract", () => {
  assert.equal(leadEventType({ submissionType: "comparison" }), "comparison.results");
  assert.equal(leadEventType({ ...base, enquiry: "electricity-solar-battery" }), "electricity.upgrade");
  assert.equal(leadEventType({ ...base, enquiry: "gas-heating" }), "gas.upgrade");
  assert.equal(leadEventType({ ...base, enquiry: "direct-trade-project" }), "direct_trade.project");
  assert.equal(leadEventType({ ...base, enquiry: "direct-trade-partner" }), "direct_trade.partner");
});

test("lead envelopes add one reference and infer state without adding contact data to URLs", () => {
  const envelope = createLeadEnvelope({ ...base, enquiry: "gas-hot-water", email: "person@example.com", phone: "0400000000" }, {
    createId: () => "12345678-abcd-4000-8000-123456789abc",
  });
  assert.equal(envelope.schemaVersion, "4");
  assert.equal(envelope.eventType, "gas.upgrade");
  assert.equal(envelope.reference, "AEA-20260714-12345678AB");
  assert.equal(envelope.state, "VIC");
  assert.equal(envelope.source, "aea-energy-web");
  assert.doesNotMatch(envelope.reference, /person|example|0400/i);
});

test("Direct Trade partner envelopes begin a non-automatic participant review", () => {
  const envelope = createLeadEnvelope({ ...base, enquiry: "direct-trade-partner", partnerType: "supplier" }, {
    createId: () => "12345678-abcd-4000-8000-123456789abc",
  });
  assert.equal(envelope.participantReview.status, "application_received");
  assert.equal(envelope.participantReview.autoApprove, false);
  assert.equal(envelope.participantReview.publicListing, false);
});

test("Direct Trade project envelopes carry a manual triage contract", () => {
  const envelope = createLeadEnvelope({
    ...base,
    enquiry: "direct-trade-project",
    projectCategories: ["solar"],
    propertyRelationship: "planning-only",
    projectStage: "researching",
    projectPriorities: ["need-advice"],
    timeframe: "later",
  }, { createId: () => "12345678-abcd-4000-8000-123456789abc" });
  assert.equal(envelope.directTradeTriage.status, "hold_for_authority_review");
  assert.equal(envelope.directTradeTriage.autoSend, false);
  assert.equal(envelope.directTradeTriage.matchCriteria.state, "VIC");
});

test("lead envelopes reject unsupported upgrade events", () => {
  assert.throws(() => createLeadEnvelope({ ...base, enquiry: "unknown" }), /unsupported/i);
});
