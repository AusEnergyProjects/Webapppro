import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDirectTradeTriage,
  createQuoteEvidenceChecklist,
  evaluateQuoteEvidence,
  matchDirectTradeParticipants,
  selectEveryQualifiedTradeRecipient,
} from "../src/lib/direct-trade-matching.mjs";

const project = {
  postcode: "3000",
  state: "Vic",
  propertyType: "house",
  propertyRelationship: "owner-occupier",
  projectCategories: ["solar", "battery"],
  projectPriorities: ["lower-running-costs"],
  projectStage: "seeking-quotes",
  timeframe: "one-three-months",
};

const participantEvidence = {
  status: "approved",
  partnerType: "installer",
  businessName: "Example Trade",
  businessVerified: true,
  reviewedAt: "2026-07-01T00:00:00.000Z",
  reviewDueAt: "2027-07-01T00:00:00.000Z",
  credentials: [{ verified: true, expiresAt: "2027-06-01T00:00:00.000Z" }],
  insurance: { verified: true, expiresAt: "2027-06-01T00:00:00.000Z" },
  requiredSchemeCapabilities: [],
};

test("project triage produces automatic privacy-safe allocation criteria", () => {
  const triage = buildDirectTradeTriage(project);
  assert.equal(triage.status, "automatic_privacy_safe_allocation");
  assert.equal(triage.priority, "quote_ready_allocation");
  assert.equal(triage.autoSend, true);
  assert.equal(triage.matchCriteria.state, "VIC");
  assert.deepEqual(triage.matchCriteria.capabilities, ["solar", "battery"]);
  assert.ok(triage.quoteEvidence.some((item) => item.id === "battery-design"));
});

test("consented planning-only enquiries retain the authority flag without blocking distribution", () => {
  const triage = buildDirectTradeTriage({
    ...project,
    propertyRelationship: "planning-only",
  });
  assert.equal(triage.status, "automatic_privacy_safe_allocation");
  assert.equal(triage.autoSend, true);
  assert.ok(triage.reviewFlags.includes("property_authority_unconfirmed"));
});

test("open distribution selects every qualified trade once and excludes every rejected trade", () => {
  const matching = Array.from({ length: 50 }, (_, index) => ({
    ...participantEvidence,
    id: `qualified-${index}`,
    businessName: `Qualified Trade ${index}`,
    serviceStates: ["VIC"],
    capabilities: ["solar", "battery"],
    postcodePrefixes: ["30"],
  }));
  const reviewed = matchDirectTradeParticipants(
    project,
    [
      ...matching,
      { ...matching[0] },
      {
        ...participantEvidence,
        id: "outside-area",
        serviceStates: ["NSW"],
        capabilities: ["solar", "battery"],
      },
      {
        ...participantEvidence,
        id: "capability-mismatch",
        serviceStates: ["VIC"],
        capabilities: ["solar"],
      },
      {
        ...participantEvidence,
        id: "not-verified",
        businessVerified: false,
        serviceStates: ["VIC"],
        capabilities: ["solar", "battery"],
      },
      {
        ...participantEvidence,
        id: "not-platform-approved",
        status: "submitted",
        serviceStates: ["VIC"],
        capabilities: ["solar", "battery"],
      },
      {
        ...participantEvidence,
        id: "disabled",
        status: "suspended",
        serviceStates: ["VIC"],
        capabilities: ["solar", "battery"],
      },
    ],
    { now: new Date("2026-07-14T01:00:00.000Z") },
  );
  const recipients = selectEveryQualifiedTradeRecipient(reviewed);
  const recipientIds = recipients.map((candidate) => candidate.participantId);
  assert.equal(recipients.length, matching.length);
  assert.equal(new Set(recipientIds).size, matching.length);
  assert.deepEqual(recipientIds.sort(), matching.map(({ id }) => id).sort());
  assert.equal(recipientIds.includes("outside-area"), false);
  assert.equal(recipientIds.includes("capability-mismatch"), false);
  assert.equal(recipientIds.includes("not-verified"), false);
  assert.equal(recipientIds.includes("not-platform-approved"), false);
  assert.equal(recipientIds.includes("disabled"), false);
});

test("participant matching excludes unverified, uncovered and partial capability records", () => {
  const candidates = matchDirectTradeParticipants(
    project,
    [
      {
        ...participantEvidence,
        id: "local-fit",
        serviceStates: ["VIC"],
        capabilities: ["solar", "battery"],
        postcodePrefixes: ["30"],
      },
      {
        ...participantEvidence,
        id: "state-fit",
        serviceStates: ["Vic"],
        capabilities: ["solar", "battery"],
      },
      {
        ...participantEvidence,
        id: "not-verified",
        businessVerified: false,
        serviceStates: ["VIC"],
        capabilities: ["solar", "battery"],
      },
      {
        ...participantEvidence,
        id: "partial",
        serviceStates: ["VIC"],
        capabilities: ["solar"],
      },
    ],
    { now: new Date("2026-07-14T01:00:00.000Z") },
  );
  assert.equal(candidates[0].participantId, "local-fit");
  assert.equal(candidates[0].score, 110);
  assert.equal(candidates[0].autoSend, true);
  assert.equal(
    candidates.find((item) => item.participantId === "state-fit")
      .eligibleForReview,
    true,
  );
  assert.deepEqual(
    candidates.find((item) => item.participantId === "not-verified").reasons,
    ["business_not_verified"],
  );
  assert.deepEqual(
    candidates.find((item) => item.participantId === "partial").reasons,
    ["capability_mismatch"],
  );
});

test("quote evidence remains incomplete until every check is accepted", () => {
  const checklist = createQuoteEvidenceChecklist(project);
  assert.equal(evaluateQuoteEvidence(checklist).complete, false);
  const accepted = checklist.map((item) => ({ ...item, status: "accepted" }));
  assert.deepEqual(evaluateQuoteEvidence(accepted), {
    total: accepted.length,
    accepted: accepted.length,
    needsReview: 0,
    complete: true,
  });
});

test("building-fabric categories have separate capabilities and quote evidence", () => {
  const buildingFabricProject = {
    ...project,
    projectCategories: [
      "draught-proofing",
      "insulation",
      "glazing",
      "window-coverings",
    ],
  };
  const triage = buildDirectTradeTriage(buildingFabricProject);
  assert.deepEqual(triage.matchCriteria.capabilities, [
    "draught-proofing",
    "insulation",
    "glazing",
    "window-coverings",
  ]);
  const evidenceIds = triage.quoteEvidence.map((item) => item.id);
  for (const id of [
    "draught-scope",
    "insulation-scope",
    "glazing-schedule",
    "window-covering-scope",
  ]) {
    assert.ok(evidenceIds.includes(id), `missing ${id}`);
  }

  const candidates = matchDirectTradeParticipants(
    buildingFabricProject,
    [
      {
        ...participantEvidence,
        id: "all-four",
        serviceStates: ["VIC"],
        capabilities: [
          "draught-proofing",
          "insulation",
          "glazing",
          "window-coverings",
        ],
      },
      {
        ...participantEvidence,
        id: "partial-fabric",
        serviceStates: ["VIC"],
        capabilities: ["draught-proofing", "insulation"],
      },
    ],
    { now: new Date("2026-07-14T01:00:00.000Z") },
  );
  assert.equal(
    candidates.find((candidate) => candidate.participantId === "all-four")
      .eligibleForReview,
    true,
  );
  assert.deepEqual(
    candidates.find((candidate) => candidate.participantId === "partial-fabric")
      .reasons,
    ["capability_mismatch"],
  );
});

test("building diagnostics require exact capabilities and their own report evidence", () => {
  const diagnosticProject = {
    ...project,
    projectCategories: ["blower-door-testing", "thermal-imaging"],
  };
  const triage = buildDirectTradeTriage(diagnosticProject);
  assert.deepEqual(triage.matchCriteria.capabilities, ["blower-door-testing", "thermal-imaging"]);
  const evidenceIds = triage.quoteEvidence.map((item) => item.id);
  assert.ok(evidenceIds.includes("blower-door-test-record"));
  assert.ok(evidenceIds.includes("thermal-imaging-record"));

  const candidates = matchDirectTradeParticipants(
    diagnosticProject,
    [
      { ...participantEvidence, id: "diagnostic-fit", serviceStates: ["VIC"], capabilities: ["blower-door-testing", "thermal-imaging"] },
      { ...participantEvidence, id: "generic-assessor", serviceStates: ["VIC"], capabilities: ["assessment", "draught-proofing"] },
      { ...participantEvidence, id: "thermal-only", serviceStates: ["VIC"], capabilities: ["thermal-imaging"] },
    ],
    { now: new Date("2026-07-14T01:00:00.000Z") },
  );
  assert.equal(candidates.find((candidate) => candidate.participantId === "diagnostic-fit").eligibleForReview, true);
  assert.deepEqual(candidates.find((candidate) => candidate.participantId === "generic-assessor").reasons, ["capability_mismatch"]);
  assert.deepEqual(candidates.find((candidate) => candidate.participantId === "thermal-only").reasons, ["capability_mismatch"]);
});

test("legacy combined project and participant categories normalize to current capabilities", () => {
  const legacyProject = {
    ...project,
    projectCategories: ["insulation-draughts"],
  };
  const triage = buildDirectTradeTriage(legacyProject);
  assert.deepEqual(triage.matchCriteria.capabilities, [
    "insulation",
    "draught-proofing",
  ]);
  assert.equal(
    triage.matchCriteria.capabilities.includes("insulation-draughts"),
    false,
  );
  assert.ok(triage.quoteEvidence.some((item) => item.id === "insulation-scope"));
  assert.ok(triage.quoteEvidence.some((item) => item.id === "draught-scope"));

  const [candidate] = matchDirectTradeParticipants(
    legacyProject,
    [
      {
        ...participantEvidence,
        id: "legacy-fabric",
        serviceStates: ["VIC"],
        capabilities: ["insulation-draughts"],
      },
    ],
    { now: new Date("2026-07-14T01:00:00.000Z") },
  );
  assert.equal(candidate.eligibleForReview, true);
});
