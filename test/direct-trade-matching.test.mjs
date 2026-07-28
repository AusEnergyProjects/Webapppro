import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDirectTradeTriage,
  createQuoteEvidenceChecklist,
  evaluateQuoteEvidence,
  matchDirectTradeParticipants,
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

test("triage holds planning-only projects for authority review", () => {
  const triage = buildDirectTradeTriage({
    ...project,
    propertyRelationship: "planning-only",
  });
  assert.equal(triage.status, "hold_for_authority_review");
  assert.ok(triage.reviewFlags.includes("property_authority_unconfirmed"));
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
