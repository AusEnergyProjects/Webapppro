import assert from "node:assert/strict";
import test from "node:test";
import {
  clipSurgeTextAtBoundary,
  deriveSurgeAnswerPresentation,
  normalizeSurgeAnswerPresentation,
  surgePlainLanguageMetrics,
  surgePresentationPassesEverydayLanguage,
  surgePresentationText,
  surgeTextHasIncompleteTrailingFragment,
} from "../src/lib/surge-everyday-answer.ts";

function answer(overrides = {}) {
  return {
    directAnswer: "Start with a staged whole-home diagnosis. Use interval data plus a building fabric check. Then review each end use.",
    practicalSteps: ["Check the coldest room first."],
    nextAction: "",
    status: "needs_context",
    citations: [],
    assumptions: [],
    confidence: "medium",
    suggestedQuestions: ["Which room is hardest to keep comfortable?"],
    toolActions: [],
    sourceBoundary: "",
    ...overrides,
  };
}

test("everyday presentation converts deterministic jargon without clickable suggestions", () => {
  const presentation = deriveSurgeAnswerPresentation(answer(), "where should i start");
  const rendered = JSON.stringify(presentation);
  assert.equal(presentation.answerType, "starting_plan");
  assert.match(presentation.verdict, /step-by-step check/i);
  assert.doesNotMatch(rendered, /staged whole-home diagnosis|interval data|building fabric|end use/i);
  assert.equal(presentation.followUpQuestion, "Which room is hardest to keep comfortable?");
  assert.deepEqual(presentation.quickReplies, []);
  assert.equal(surgePresentationPassesEverydayLanguage(presentation), true);
});

test("plain-language metrics detect long technical answers before release", () => {
  const metrics = surgePlainLanguageMetrics("A building fabric load profile can describe conductive heat flow through the thermal envelope.");
  assert.equal(metrics.jargonCount, 4);
  assert.equal(metrics.wordCount > 10, true);
});

test("visible prose never hides raw character clipping as a completed sentence", () => {
  const longSentence = `Check the written scope ${"before signing ".repeat(40)}the contract.`;
  const clipped = clipSurgeTextAtBoundary(longSentence, 120);
  assert.ok(clipped.length <= 120);
  assert.match(clipped, /\.\.\.$/);
  assert.doesNotMatch(clipped, /\b\S{1,3}\.\.\.$/);

  assert.equal(surgeTextHasIncompleteTrailingFragment("Check that the"), true);
  assert.equal(surgeTextHasIncompleteTrailingFragment(
    `${"Compare the written scope and exclusions carefully. ".repeat(3)}The block requi`,
  ), true);
  assert.equal(surgeTextHasIncompleteTrailingFragment("If she rent"), true);
  assert.equal(surgeTextHasIncompleteTrailingFragment(
    "Check the written scope and keep required ventilation open.",
  ), false);
});

test("a compound starting plan can cover several requested decisions without becoming a 503", () => {
  const conciseCompoundPlan = {
    answerType: "starting_plan",
    verdict: "First, control the window moisture and confirm it is condensation rather than a leak.",
    reason: "A suitable split system can heat the rooms and will usually cost less to run than gas. Body corporate approval may cover the outdoor unit, wall holes, visible pipes, drainage and changes to common property. The first action is low cost and directly addresses the dripping windows while those approvals are checked.",
    steps: [
      "Use bathroom and kitchen exhaust fans, avoid drying clothes inside, wipe wet glass, check that the fan exhausts outdoors and keep required vents open.",
      "Ask body corporate for its application form and written rules for outdoor units, visible pipework and drainage before seeking installation quotes.",
      "Have the split sized for the rooms, local weather, window size, insulation and expected cold-weather output, then compare the complete installed scope.",
    ],
    extraDetail: "",
    followUpQuestion: "Does the gas heater have a flue or exhaust pipe to outside?",
    quickReplies: [],
  };
  assert.ok(surgePlainLanguageMetrics([
    conciseCompoundPlan.verdict,
    conciseCompoundPlan.reason,
    ...conciseCompoundPlan.steps,
  ].join(" ")).wordCount > 120);
  assert.equal(surgePresentationPassesEverydayLanguage(conciseCompoundPlan), true);
});

test("a clear 127-word comparison is not rejected only for crossing the old 120-word limit", () => {
  const comparison = {
    answerType: "comparison",
    verdict: "Put the $1,500 into window coverings first.",
    reason: "Your split still heats properly, while mostly single-glazed windows are the clearer comfort problem. A solar deposit provides no immediate benefit and may be premature for an apartment with possible owners corporation approval. Because condensation is already an issue, keep using the bathroom exhaust and regularly check behind new coverings for moisture.",
    steps: [
      "Prioritise close-fitting honeycomb blinds or thick thermal curtains with pelmets in the coldest occupied rooms. They reduce window heat loss within this budget.",
      "Keep the existing split and use a lower comfortable setting. Replacement is not justified unless testing finds a fault or its performance declines.",
      "Hold off on a solar deposit until roof rights, owners corporation approval, full installed cost and the exact system proposal are confirmed.",
    ],
    extraDetail: "",
    followUpQuestion: "",
    quickReplies: [],
  };

  assert.equal(surgePlainLanguageMetrics([
    comparison.verdict,
    comparison.reason,
    ...comparison.steps,
  ].join(" ")).wordCount, 127);
  assert.equal(surgePresentationPassesEverydayLanguage(comparison), true);
});

test("ordinary unstructured prose above the tighter 120-word limit is still rejected", () => {
  const unstructured = {
    answerType: "general",
    verdict: "Start with the practical issue in front of you.",
    reason: Array.from({ length: 113 }, () => "detail").join(" "),
    steps: [],
    extraDetail: "",
    followUpQuestion: "",
    quickReplies: [],
  };

  assert.equal(surgePlainLanguageMetrics([
    unstructured.verdict,
    unstructured.reason,
  ].join(" ")).wordCount, 122);
  assert.equal(surgePresentationPassesEverydayLanguage(unstructured), false);
});

test("a clear thirty-word comparison verdict is accepted while an overlong verdict is rejected", () => {
  const comparison = {
    answerType: "comparison",
    verdict: "Quote B costs $7,400, which is $500 more than Quote A at $6,900; the extra two warranty years are worthwhile only if the coverage and installed scope are otherwise comparable.",
    reason: "Compare the exact models, installation work, exclusions, labour coverage and service support.",
    steps: [],
    extraDetail: "",
    followUpQuestion: "Do both quotes specify the same model and complete installed scope?",
    quickReplies: [],
  };
  assert.equal(surgePresentationPassesEverydayLanguage(comparison), true);
  assert.equal(surgePresentationPassesEverydayLanguage({
    ...comparison,
    verdict: Array.from({ length: 37 }, () => "word").join(" "),
  }), false);
});

test("a starting-plan question about another person receives the compound-answer allowance", () => {
  const presentation = deriveSurgeAnswerPresentation(answer(), "What should she do first?");
  assert.equal(presentation.answerType, "starting_plan");
});

test("heating guidance removes expert-only resistance and delivered-heat wording", () => {
  const presentation = deriveSurgeAnswerPresentation(answer({
    directAnswer: "Compare delivered heat with portable resistance heaters before choosing resistance heating.",
    suggestedQuestions: [],
  }), "Which heater is the efficient choice?");
  const rendered = JSON.stringify(presentation);
  assert.match(rendered, /heat supplied to the room/i);
  assert.match(rendered, /plug-in electric heaters/i);
  assert.doesNotMatch(rendered, /delivered heat|portable resistance|resistance heating/i);
});

test("a grounded answer does not repeat the same advice as a practical step", () => {
  const repeated = "Use reverse-cycle air conditioning as the normal first choice for room heating.";
  const presentation = deriveSurgeAnswerPresentation(answer({
    directAnswer: repeated,
    practicalSteps: [repeated, "Clean the accessible filter."],
    suggestedQuestions: [],
  }), "What heating should I use?");
  assert.deepEqual(presentation.steps, ["Clean the accessible filter."]);
});

test("multi-step answers keep one clean numbered-list item per action", () => {
  const presentation = normalizeSurgeAnswerPresentation({
    answerType: "explanation",
    verdict: "Start with the cheapest direct fixes.",
    reason: "These address separate ways heat leaves the window.",
    steps: [
      "1. Seal only actual moving-air gaps.",
      "2) Add a removable still-air layer.",
      "• Fit a close covering and pelmet.",
    ],
    extraDetail: "",
    followUpQuestion: "",
    quickReplies: [],
  });

  assert.deepEqual(presentation.steps, [
    "Seal only actual moving-air gaps.",
    "Add a removable still-air layer.",
    "Fit a close covering and pelmet.",
  ]);
  assert.equal(
    surgePresentationText(presentation),
    [presentation.verdict, presentation.reason, ...presentation.steps].join("\n\n"),
  );
});

test("three-phase answers keep at most a plain follow-up question", () => {
  const presentation = deriveSurgeAnswerPresentation(answer({
    suggestedQuestions: ["What equipment details are proposed?"],
  }), "Is three-phase worth getting with solar and a battery?");
  assert.equal(presentation.followUpQuestion, "What equipment details are proposed?");
  assert.deepEqual(presentation.quickReplies, []);
});
