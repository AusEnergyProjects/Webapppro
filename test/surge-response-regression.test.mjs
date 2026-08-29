import assert from "node:assert/strict";
import test from "node:test";
import { SURGE_RESPONSE_REGRESSION_CORPUS } from "../src/data/surge-response-regression-corpus.ts";
import { handleEnergyAssistantRequest } from "../src/lib/energy-assistant-server.ts";
import {
  evaluateSurgeResponseRegression,
  evaluateSurgeResponseRegressionCase,
  formatSurgeResponseRegressionFailures,
  surgeVisibleAnswerFromReply,
} from "../src/lib/surge-response-regression-gate.ts";

const NOW = new Date("2026-08-29T00:00:00.000Z");
const ORIGIN = "https://compare.example.test";

function requestFor(entry) {
  return new Request(`${ORIGIN}/api/energy-assistant`, {
    method: "POST",
    headers: {
      origin: ORIGIN,
      "content-type": "application/json",
      "x-surge-quality-rehearsal": "aggregate-v1",
    },
    body: JSON.stringify({
      action: "ask",
      requestId: `regression-${entry.id}`,
      message: entry.question,
      recentTurns: entry.recentTurns,
      ...(entry.planContext ? { planContext: entry.planContext } : {}),
      audience: "public",
      pageContext: "/surge",
    }),
  });
}

async function mapConcurrent(items, concurrency, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;
  async function run() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run));
  return results;
}

function observation(entry, response, payload, modelReservations, latencyMs) {
  const reply = payload?.reply || {};
  return {
    caseId: entry.id,
    httpStatus: response.status,
    visibleAnswer: surgeVisibleAnswerFromReply(reply),
    content: typeof reply.content === "string" ? reply.content : "",
    directAnswer: typeof reply.directAnswer === "string" ? reply.directAnswer : "",
    followUpQuestion: typeof reply.followUpQuestion === "string" ? reply.followUpQuestion : "",
    quickReplies: Array.isArray(reply.quickReplies) ? reply.quickReplies : [],
    modelReservations,
    answerSource: typeof payload?.quality?.answerSource === "string"
      ? payload.quality.answerSource
      : "",
    error: payload?.ok === true
      ? ""
      : String(payload?.error?.code || payload?.error?.message || "Invalid response payload"),
    latencyMs,
  };
}

function syntheticCase(overrides = {}) {
  return {
    id: "synthetic-01",
    family: "synthetic",
    variant: 1,
    question: "Synthetic gate probe",
    tags: [],
    clauses: [{ id: "topic", anyOf: ["heat pump"] }],
    requiredNumbers: [],
    forbiddenPatterns: [],
    recentTurns: [],
    planContext: null,
    maxQuestions: 0,
    maxWords: 40,
    maxParagraphs: 2,
    modelPolicy: "allowed",
    safetyLeadAnyOf: [],
    similarityGroup: "",
    ...overrides,
  };
}

function syntheticObservation(overrides = {}) {
  const content = overrides.content ?? "A heat pump is relevant here.";
  const directAnswer = overrides.directAnswer ?? content;
  const visibleAnswer = overrides.visibleAnswer ?? directAnswer;
  return {
    caseId: "synthetic-01",
    httpStatus: 200,
    visibleAnswer,
    content,
    directAnswer,
    followUpQuestion: "",
    quickReplies: [],
    modelReservations: 0,
    answerSource: "deterministic",
    error: "",
    ...overrides,
  };
}

function corpusCase(id) {
  const entry = SURGE_RESPONSE_REGRESSION_CORPUS.find((candidate) => candidate.id === id);
  assert.ok(entry, id);
  return entry;
}

test("the gate hard-fails every release-critical error class", () => {
  const checks = [
    ["required_concept", syntheticCase(), syntheticObservation({ content: "Use less power.", directAnswer: "Use less power." })],
    ["numeric_integrity", syntheticCase({ requiredNumbers: [{ id: "size", anyOf: ["\\b250\\s*L\\b"] }] }), syntheticObservation()],
    ["context", syntheticCase({ tags: ["context"] }), syntheticObservation({ content: "Use less power.", directAnswer: "Use less power." })],
    ["multipart", syntheticCase({ tags: ["multi_part"] }), syntheticObservation({ content: "Use less power.", directAnswer: "Use less power." })],
    ["generic_fallback", syntheticCase(), syntheticObservation({ content: "I found a related current official source.", directAnswer: "I found a related current official source." })],
    ["length", syntheticCase({ maxWords: 5 }), syntheticObservation({ content: "A heat pump answer that is deliberately longer than five words.", directAnswer: "A heat pump answer that is deliberately longer than five words." })],
    ["quick_reply", syntheticCase(), syntheticObservation({ quickReplies: [{ label: "More" }] })],
    ["safety_lead", syntheticCase({ tags: ["urgent_safety"], safetyLeadAnyOf: ["move away"] }), syntheticObservation()],
  ];
  for (const [expected, entry, result] of checks) {
    const report = evaluateSurgeResponseRegressionCase(entry, result);
    assert.equal(report.passed, false, expected);
    assert.ok(report.failures.some((item) => item.code === expected), expected);
  }
});

test("semantic checks score only the customer-visible answer", () => {
  const hiddenMatch = syntheticObservation({
    visibleAnswer: "Use less power.",
    content: "Use less power.",
    directAnswer: "A heat pump is relevant here.",
  });
  const report = evaluateSurgeResponseRegressionCase(syntheticCase(), hiddenMatch);
  assert.equal(report.passed, false);
  assert.ok(report.failures.some((item) => item.code === "required_concept"));

  const hiddenForbidden = evaluateSurgeResponseRegressionCase(
    syntheticCase({ forbiddenPatterns: ["internal-only"] }),
    syntheticObservation({
      visibleAnswer: "A heat pump is relevant here.",
      directAnswer: "A heat pump is relevant here. internal-only",
    }),
  );
  assert.equal(hiddenForbidden.passed, true);
});

test("the corpus recognises equivalent plain-English answers from the paid checkpoint", () => {
  const checks = [
    {
      id: "rcac_noise-01",
      answer: "Brief strong airflow can be normal, but persistent excessive noise is not something you should simply accept. At 17°C, check the fan setting and zones. Ongoing noise can mean restricted airflow or poor duct balance.",
      followUpQuestion: "Does it become quieter after running for a while?",
    },
    {
      id: "hpwh_size-01",
      answer: "Yes, normally enough. A 180 litre heat-pump tank can suit two people. Long showers or high-flow showerheads can make it marginal, and the timer must allow recovery before the evening demand.",
      followUpQuestion: "How long are the showers?",
    },
    {
      id: "fit_plan-01",
      answer: "No. The highest feed-in tariff is not automatically best. An 8 cent rate can lose if the night import rate or daily supply charge makes the annual bill higher.",
      followUpQuestion: "Can you share a recent bill?",
    },
    {
      id: "window_inside_condensation-01",
      answer: "Probably not faulty. Room-side condensation usually means indoor humidity met a cold inside surface. Moisture between the panes would instead suggest a seal failure.",
      followUpQuestion: "",
    },
    {
      id: "three_phase_claim-01",
      answer: "No. A 7 kW charger does not automatically need three-phase. Check the combined household loads, get a load calculation and obtain the written network requirement before agreeing.",
      followUpQuestion: "What written reason did the installer give?",
    },
    {
      id: "upgrade_priority-01",
      answer: "For this Victoria owner home, you mentioned condensation and winter comfort. Use the first $1,000 on the worst window or exhaust problem, then clean the reverse-cycle filter before buying equipment.",
      followUpQuestion: "",
    },
  ];

  for (const { id, answer, followUpQuestion } of checks) {
    const result = evaluateSurgeResponseRegressionCase(
      corpusCase(id),
      syntheticObservation({ visibleAnswer: answer, followUpQuestion }),
    );
    assert.equal(result.passed, true, `${id}: ${formatSurgeResponseRegressionFailures({
      ready: false,
      caseCount: 1,
      passedCases: 0,
      failedCases: 1,
      failureCount: result.failures.length,
      results: [result],
      globalFailures: [],
    })}`);
  }
});

test("reviewed everyday wording passes without masking a missing decision concept", () => {
  const checks = [
    {
      id: "solar_shade-01",
      good: "Shade after 2 pm will reduce generation. Ask for panel placement and a written site-specific shade analysis showing the expected output.",
      missing: "Shade after 2 pm will reduce generation. Ask for a written site-specific shade analysis showing the expected output.",
    },
    {
      id: "battery_low_bill-01",
      good: "Even completely eliminating your $600 bill would not make a $9,000 5 kWh battery pay back quickly. Real yearly saving is lower after the supply charge and losses, so compare payback with the warranty.",
      missing: "A $9,000 5 kWh battery has losses and a warranty. Compare its yearly saving and payback after the supply charge.",
    },
    {
      id: "free_hours-01",
      good: "Potentially. Two free hours can help shift battery charging, but 42 cents per kWh in the evening is expensive. Compare the whole tariff, including the supply charge and solar export rate.",
      missing: "Two free hours let you shift battery charging. Compare 42 cents per kWh in the evening with the whole tariff, supply charge and solar export rate.",
    },
    {
      id: "window_between_panes-01",
      good: "Ventilation cannot fix moisture between the panes because the sealed unit has failed. Ask a qualified glazier to inspect window 1 and arrange warranty replacement.",
      missing: "Ventilation cannot fix moisture between the panes because the sealed unit has failed.",
    },
    {
      id: "renter_actions-01",
      good: "Use reversible options without drilling or permanently altering apartment 1: removable seals, a door snake and curtains. Ask the owner or agent in writing before fixed work.",
      missing: "Use removable seals, a door snake and curtains. Ask the owner or agent in writing before fixed work.",
    },
    {
      id: "hpwh_noise-01",
      good: "At 2 metres from a bedroom window, noise matters. Check the exact model's sound data and relocate the unit if the written site check shows a night-time problem.",
      missing: "At 2 metres from a bedroom window, noise matters. Check the exact model's sound data against the written site check.",
    },
    {
      id: "aluminium_frame-01",
      good: "The existing frame cannot be turned into a thermally broken frame. Use honeycomb blinds or curtains, and consider secondary glazing while managing condensation at frame 1.",
      missing: "Use honeycomb blinds or curtains, and consider secondary glazing while managing condensation at aluminium frame 1.",
    },
    {
      id: "draught_vs_glass-01",
      good: "It is two mechanisms: seal the air leak that appears when windy, while the poorly insulating glass explains the icy still-night feeling in Bedroom 1.",
      missing: "Seal the air leak that appears when windy in Bedroom 1.",
    },
    {
      id: "quote_scope-01",
      good: "Do not choose on price alone. Quote A is $4,200 and Quote B is $6,100. Compare the complete written scope, exact model, electrical and plumbing work, and warranty.",
      missing: "Do not choose on price alone. Quote A is $4,200 and Quote B is $6,100. Compare the exact model, electrical and plumbing work, and warranty.",
    },
    {
      id: "upgrade_priority-01",
      good: "For your apartment with single glazed windows, spend the first $1,000 on the condensation or exhaust problem, then honeycomb coverings and the reverse-cycle filter.",
      missing: "Spend the first $1,000 on a window, then clean the reverse-cycle filter.",
    },
  ];

  for (const { id, good, missing } of checks) {
    const accepted = evaluateSurgeResponseRegressionCase(
      corpusCase(id),
      syntheticObservation({ visibleAnswer: good }),
    );
    assert.equal(accepted.passed, true, id);
    const rejected = evaluateSurgeResponseRegressionCase(
      corpusCase(id),
      syntheticObservation({ visibleAnswer: missing }),
    );
    assert.ok(rejected.failures.some((failure) => failure.code === "required_concept"), id);
  }
});

test("the v5 plain-English equivalents pass while real omissions still fail", () => {
  const checks = [
    {
      id: "hpwh_timing-01",
      good: "Choose 8:00 am as the safer starting time for solar and recovery. Choose 12:00 pm only if the tank still covers evening hot water.",
      missing: "Both 8:00 am and 12:00 pm use solar and allow hot-water recovery.",
    },
    {
      id: "battery_low_bill-01",
      good: "Even if the $9,000 5 kWh battery eliminated the whole $600 bill, payback would be 15 years. Real yearly saving is lower because fixed charges remain and energy is lost while charging.",
      missing: "Even if the $9,000 5 kWh battery eliminated the whole $600 bill, payback would be 15 years from yearly saving.",
    },
    {
      id: "battery_import_export-01",
      good: "Possibly. Importing 2200 kWh and exporting 4200 kWh helps only when exports occur before those imports. Compare yearly saving and payback using your tariff.",
      missing: "Possibly. Importing 2200 kWh and exporting 4200 kWh may help. Compare yearly saving and payback using your tariff.",
    },
    {
      id: "fit_plan-01",
      good: "No. An 8 cent feed-in tariff is not automatically the cheapest plan. Compare the annual total including night import rates and the daily supply charge.",
      missing: "An 8 cent feed-in tariff has a night import rate and daily supply charge. Compare the annual total.",
    },
    {
      id: "ev_charger-01",
      good: "Choose a charger with solar-surplus control for the 5 kW system, plus load management for the switchboard. Confirm the vehicle's onboard charging limit.",
      missing: "Choose a charger for the 5 kW system with load management for the switchboard. Confirm the vehicle's onboard charging limit.",
    },
    {
      id: "three_phase_claim-01",
      good: "No. A 7 kW charger does not automatically need three-phase. Ask an electrician for the maximum-demand calculation and written network requirement for the switchboard.",
      missing: "No. A 7 kW charger does not automatically need three-phase. Ask an electrician for the written network requirement for the switchboard.",
    },
    {
      id: "window_inside_condensation-01",
      good: "No. Room-side condensation does not mean window 1 is faulty. It forms when humid air meets a cold inside surface; moisture between the panes would suggest seal failure.",
      missing: "Window 1 has room-side condensation when humidity meets a cold inside surface, while moisture between the panes would suggest seal failure.",
    },
    {
      id: "upgrade_priority-01",
      good: "Your mostly single-glazed apartment already has reverse-cycle heating. Spend the first $1,000 on the condensation or exhaust problem, then a honeycomb window covering and the filter.",
      missing: "Spend the first $1,000 on the condensation or exhaust problem, then a honeycomb window covering and the reverse-cycle filter.",
    },
  ];

  for (const { id, good, missing } of checks) {
    const accepted = evaluateSurgeResponseRegressionCase(
      corpusCase(id),
      syntheticObservation({ visibleAnswer: good }),
    );
    assert.equal(accepted.passed, true, id);
    const rejected = evaluateSurgeResponseRegressionCase(
      corpusCase(id),
      syntheticObservation({ visibleAnswer: missing }),
    );
    assert.ok(rejected.failures.some((failure) => failure.code === "required_concept"), id);
  }
});

test("the v6 concise answers pass without weakening their decision requirements", () => {
  const checks = [
    {
      id: "rcac_bill_jump-01",
      good: "Use rose from 240 kWh to 520 kWh. First compare the same period, then check colder weather, thermostat settings and filters.",
      missing: "Use rose from 240 kWh to 520 kWh. First compare the same period and clean the filters.",
    },
    {
      id: "hpwh_size-01",
      good: "Usually yes, 180 litres is enough for two people. Long night showers can exhaust it, so confirm recovery, climate performance and the timer.",
      missing: "A 180 litre tank for two people needs enough recovery for long night showers, the climate and the timer.",
    },
    {
      id: "hpwh_finance-01",
      good: "$30 a month for 4 years totals $1,440. That does not equal the quoted $3,600, leaving $2,160 unpaid for an upfront or final payment to explain.",
      missing: "$30 a month for 4 years totals $1,440, which does not equal the quoted $3,600 finance amount.",
    },
    {
      id: "ev_charger-01",
      good: "Install a smart solar-surplus charger for the 5 kW system. Confirm the EV's charging limit and use load management after checking the switchboard supply.",
      missing: "Install a smart solar-surplus charger for the 5 kW system with load management after checking the switchboard supply.",
    },
  ];

  for (const { id, good, missing } of checks) {
    const accepted = evaluateSurgeResponseRegressionCase(
      corpusCase(id),
      syntheticObservation({ visibleAnswer: good }),
    );
    assert.equal(accepted.passed, true, id);
    const rejected = evaluateSurgeResponseRegressionCase(
      corpusCase(id),
      syntheticObservation({ visibleAnswer: missing }),
    );
    assert.ok(rejected.failures.some((failure) => failure.code === "required_concept"), id);
  }
});

test("the v7 plain-English equivalents pass while unsafe or generic shortcuts still fail", () => {
  const checks = [
    {
      id: "hpwh_finance-01",
      good: "$30 a month for 4 years is $1,440, not the quoted $3,600. There must be another payment or balance, so ask for the deposit, financed amount and total payable.",
      missing: "$30 a month for 4 years is $1,440, not the quoted $3,600. The finance paperwork should explain it.",
      missingDetail: "finance-gap",
    },
    {
      id: "solar_shade-01",
      good: "Model the 10% shade and show which panels are affected, any panel-level controls, expected monthly generation and the shade assumptions in writing.",
      missing: "Model the 10% shade and expected monthly generation with the shade assumptions in writing before accepting the quote.",
      missingDetail: "design-check",
    },
    {
      id: "solar_shade-01",
      good: "Model the 10% shade and show which panels are affected, any panel-level controls, expected monthly generation and the shade assumptions in writing.",
      missing: "Shade will reduce generation, so check which panels are affected and consider panel-level controls.",
      missingDetail: "evidence",
    },
    {
      id: "ev_charger-01",
      good: "For the 5 kW solar system, use a charger with solar tracking and load management after checking the switchboard. Confirm the vehicle's charging limit rather than simply choosing the fastest charger.",
      missing: "For the 5 kW solar system, use solar-surplus control and load management after checking the switchboard. Confirm the vehicle's charging limit, then choose the fastest charger.",
      missingDetail: "Matched forbidden pattern",
    },
    {
      id: "window_inside_condensation-01",
      good: "No. Room-side condensation does not usually mean window 1 is faulty. Humidity is meeting a cold inside surface; moisture between the panes would suggest seal failure.",
      missing: "Window 1 has room-side condensation because humidity meets a cold inside surface; moisture between the panes would suggest seal failure.",
      missingDetail: "not-necessarily-fault",
    },
    {
      id: "upgrade_priority-01",
      good: "Your mostly single glazing and basic blinds make the windows the first $1,000 priority. Address condensation, add honeycomb blinds, use exhaust and clean the reverse-cycle filter.",
      missing: "Spend the first $1,000 on condensation, honeycomb blinds, exhaust and the reverse-cycle filter.",
      missingDetail: "use-saved-context",
    },
    {
      id: "upgrade_priority-01",
      good: "Your mostly single glazing and basic blinds make the windows the first $1,000 priority. Address condensation, add honeycomb blinds, use exhaust and clean the reverse-cycle filter.",
      missing: "Your mostly single glazing makes the windows the first $1,000 priority. Address condensation, add honeycomb blinds, use exhaust and clean the heating filter.",
      missingDetail: "use-saved-context",
    },
  ];

  for (const { id, good, missing, missingDetail } of checks) {
    const accepted = evaluateSurgeResponseRegressionCase(
      corpusCase(id),
      syntheticObservation({ visibleAnswer: good }),
    );
    assert.equal(accepted.passed, true, `${id}: ${JSON.stringify(accepted.failures)}`);
    const rejected = evaluateSurgeResponseRegressionCase(
      corpusCase(id),
      syntheticObservation({ visibleAnswer: missing }),
    );
    assert.ok(rejected.failures.some((failure) => failure.detail.includes(missingDetail)), `${id}: ${JSON.stringify(rejected.failures)}`);
  }
});

test("the v8 precise equivalents pass without allowing single-keyword shortcuts", () => {
  const checks = [
    {
      id: "solar_shade-01",
      good: "The 10% shade affects generation. Show panel placement, panel-level electronics and shade-adjusted monthly generation.",
      missing: "The 10% shade affects generation. Show panel placement and panel-level electronics.",
      missingDetail: "evidence",
    },
    {
      id: "battery_quote-01",
      good: "$8,500 for 5 kWh may be fair. Check usable capacity, complete installed scope, backup circuits, written warranties, conservative yearly saving and payback.",
      missing: "$8,500 for 5 kWh may be fair. Check usable capacity, complete installed scope, backup circuits, conservative yearly saving and payback.",
      missingDetail: "warranty",
    },
    {
      id: "quote_scope-01",
      good: "Price alone cannot decide between Quote A at $4,200 and Quote B at $6,100. Compare matching exact models, capacity and installation scope, plus electrical work and warranty.",
      missing: "Price alone cannot decide between Quote A at $4,200 and Quote B at $6,100. Compare the models, electrical work and warranty.",
      missingDetail: "same-scope",
    },
    {
      id: "upgrade_priority-01",
      good: "Your single glazing and basic blinds make windows the first $1,000 priority. Address condensation, add honeycomb blinds, use exhaust and keep reverse-cycle heating.",
      missing: "Your single glazing makes windows the first $1,000 priority. Address condensation, add honeycomb blinds, use exhaust and keep heating the occupied room.",
      missingDetail: "use-saved-context",
    },
  ];

  for (const { id, good, missing, missingDetail } of checks) {
    const accepted = evaluateSurgeResponseRegressionCase(
      corpusCase(id),
      syntheticObservation({ visibleAnswer: good }),
    );
    assert.equal(accepted.passed, true, `${id}: ${JSON.stringify(accepted.failures)}`);
    const rejected = evaluateSurgeResponseRegressionCase(
      corpusCase(id),
      syntheticObservation({ visibleAnswer: missing }),
    );
    assert.ok(rejected.failures.some((failure) => failure.detail.includes(missingDetail)), `${id}: ${JSON.stringify(rejected.failures)}`);
  }
});

test("quantity assertions require the supplied number and its grouped unit", () => {
  const missingTankSize = evaluateSurgeResponseRegressionCase(
    corpusCase("hpwh_size-06"),
    syntheticObservation({
      visibleAnswer: "A thermal heat-pump unit can suit this household if recovery and cold-weather performance are adequate.",
    }),
  );
  assert.ok(
    missingTankSize.failures.some((failure) => failure.code === "numeric_integrity" && failure.detail.includes("tank")),
    JSON.stringify(missingTankSize.failures),
  );

  const wrongCircuitSize = evaluateSurgeResponseRegressionCase(
    corpusCase("induction_circuit-01"),
    syntheticObservation({
      visibleAnswer: "Use a dedicated 40 amp circuit and let an electrician confirm the cable and switchboard capacity.",
    }),
  );
  assert.ok(
    wrongCircuitSize.failures.some((failure) => failure.code === "numeric_integrity" && failure.detail.includes("circuit")),
    JSON.stringify(wrongCircuitSize.failures),
  );
});

test("audited everyday equivalents pass without accepting the omitted decision", () => {
  const checks = [
    {
      id: "hpwh_size-01",
      good: "Yes, a 180 litre tank should comfortably serve two people. Long showers can exhaust it, so confirm winter recovery.",
      missing: "A 180 litre tank for two people needs winter recovery after long showers.",
      detail: "capacity-verdict",
    },
    {
      id: "hpwh_noise-01",
      good: "At 2 metres, check the exact model's published sound level and have the installer assess it at the bedroom window.",
      missing: "At 2 metres, check the exact model's published sound level at the bedroom window.",
      detail: "installation",
    },
    {
      id: "hpwh_finance-10",
      good: "$66 a month for 8 years totals $6,336, not the quoted $6,120. The $216 difference may be interest or finance fees.",
      missing: "$66 a month for 8 years totals $6,336, not the quoted $6,120.",
      detail: "finance-gap",
    },
    {
      id: "solar_size_usage-01",
      good: "At 3 to 5 kWh a day, choose 5 kW over 7.2 kW unless new daytime demand is planned and the network allows it.",
      missing: "At 3 to 5 kWh a day, choose the 5 kW system rather than the 7.2 kW option.",
      detail: "decision-factors",
    },
    {
      id: "battery_low_bill-01",
      good: "Your entire post-solar bill is only $600. Even a $9,000 5 kWh battery needs a 15-year payback before supply charges and losses.",
      missing: "A $9,000 5 kWh battery has a 15-year payback from a $600 yearly saving after supply charges and losses.",
      detail: "saving-ceiling",
    },
    {
      id: "battery_import_export-01",
      good: "Importing 2200 kWh and exporting 4200 kWh may help when imports occur after solar production ends. Financial value depends on electricity rates and installed cost.",
      missing: "Importing 2200 kWh and exporting 4200 kWh may help. Check the battery warranty.",
      detail: "timing",
    },
    {
      id: "three_phase_claim-01",
      good: "No. A 7 kW charger does not automatically require three-phase. An electrician should calculate combined household demand and check the switchboard.",
      missing: "No. A 7 kW charger does not automatically require three-phase. An electrician should check the switchboard.",
      detail: "load-assessment",
    },
    {
      id: "induction_circuit-01",
      good: "No. A 6 kW cooktop should not share the 20 amp circuit. Use its own suitably sized circuit or manufacturer-approved power limit after an electrician checks the cable and breaker.",
      missing: "No. A 6 kW cooktop should not share the 20 amp circuit. Ask an electrician to check the cable, breaker and switchboard.",
      detail: "safe-option",
    },
    {
      id: "aluminium_frame-01",
      good: "A genuine thermal break cannot be added to frame 1. Use honeycomb curtains and consider secondary glazing while watching condensation.",
      missing: "Use honeycomb curtains on frame 1 and consider secondary glazing while watching condensation.",
      detail: "thermal-break-limit",
    },
    {
      id: "upgrade_priority-01",
      good: "Your single-glazed windows need attention. Spend the first $1,000 on condensation, honeycomb blinds and exhaust, then keep using the reverse-cycle system.",
      missing: "Spend the first $1,000 on condensation, honeycomb blinds and exhaust, then service the heater.",
      detail: "use-saved-context",
    },
  ];

  for (const { id, good, missing, detail } of checks) {
    const accepted = evaluateSurgeResponseRegressionCase(
      corpusCase(id),
      syntheticObservation({ visibleAnswer: good }),
    );
    assert.equal(accepted.passed, true, `${id}: ${JSON.stringify(accepted.failures)}`);
    const rejected = evaluateSurgeResponseRegressionCase(
      corpusCase(id),
      syntheticObservation({ visibleAnswer: missing }),
    );
    assert.ok(
      rejected.failures.some((failure) => failure.detail.includes(detail)),
      `${id}: ${JSON.stringify(rejected.failures)}`,
    );
  }
});

test("EV sibling quantities are rejected without matching the correct decimal size", () => {
  const entry = corpusCase("ev_charger-05");
  const correct = "For the 8.8 kW solar system, use a solar-aware charger with load management and check the vehicle's charging limit and switchboard supply.";
  assert.equal(
    evaluateSurgeResponseRegressionCase(entry, syntheticObservation({ visibleAnswer: correct })).passed,
    true,
  );
  const contaminated = `${correct} This guidance came from the 8 kW solar system case.`;
  const result = evaluateSurgeResponseRegressionCase(
    entry,
    syntheticObservation({ visibleAnswer: contaminated }),
  );
  assert.ok(result.failures.some((failure) => failure.code === "forbidden_content"));
});

test("aluminium thermal-break limits accept replacement-frame wording without accepting generic frame advice", () => {
  const entry = corpusCase("aluminium_frame-08");
  const accepted = evaluateSurgeResponseRegressionCase(
    entry,
    syntheticObservation({
      caseId: entry.id,
      visibleAnswer: "A true thermal break normally requires new frames or compatible replacement sashes. Use honeycomb blinds now and consider secondary glazing around aluminium frame 8.",
    }),
  );
  assert.equal(accepted.passed, true, JSON.stringify(accepted.failures));

  const naturalLimit = evaluateSurgeResponseRegressionCase(
    entry,
    syntheticObservation({
      caseId: entry.id,
      visibleAnswer: "The existing aluminium frame cannot usually gain a genuine thermal break. Use honeycomb blinds now and consider secondary glazing around frame 8 while managing condensation.",
    }),
  );
  assert.equal(naturalLimit.passed, true, JSON.stringify(naturalLimit.failures));

  const vague = evaluateSurgeResponseRegressionCase(
    entry,
    syntheticObservation({
      caseId: entry.id,
      visibleAnswer: "A thermal break can improve the aluminium frame. Use honeycomb blinds now and consider secondary glazing around frame 8.",
    }),
  );
  assert.ok(
    vague.failures.some((failure) => failure.detail.includes("thermal-break-limit")),
    JSON.stringify(vague.failures),
  );
});

test("free-hour quantities accept their exact word form across all variants", () => {
  const words = ["two", "three", "four"];
  const cases = SURGE_RESPONSE_REGRESSION_CORPUS.filter((entry) => entry.family === "free_hours");
  for (const [index, entry] of cases.entries()) {
    const visibleAnswer = `Potentially. ${words[index % 3]} free hours can help shift battery charging, but ${42 + index} cents per kWh in the evening is expensive. Compare the whole tariff, daily supply charge and solar export rate.`;
    const result = evaluateSurgeResponseRegressionCase(
      entry,
      syntheticObservation({ visibleAnswer }),
    );
    assert.equal(result.passed, true, entry.id);
  }
});

test("finance terms accept their exact word form across all variants", () => {
  const yearWords = ["four", "five", "six", "seven", "eight"];
  const cases = SURGE_RESPONSE_REGRESSION_CORPUS.filter((entry) => entry.family === "hpwh_finance");
  for (const [index, entry] of cases.entries()) {
    const monthly = 30 + index * 4;
    const quoted = (3600 + index * 280).toLocaleString("en-AU");
    const repaymentTotal = monthly * 12 * (4 + (index % 5));
    const visibleAnswer = `$${monthly} a month for ${yearWords[index % 5]} years totals $${repaymentTotal.toLocaleString("en-AU")}, which does not equal the quoted $${quoted}. Ask for a written breakdown of the additional payment.`;
    const result = evaluateSurgeResponseRegressionCase(
      entry,
      syntheticObservation({ visibleAnswer }),
    );
    assert.equal(result.passed, true, `${entry.id}: ${JSON.stringify(result.failures)}`);
  }
});

test("numeric checks accept compact ranges and an explicit comparison difference", () => {
  const good = [
    {
      id: "rcac_bill_jump-01",
      answer: "Reverse-cycle heating use rose from 240 to 520 kWh. First compare the same period and temperature setting, then clean the filter.",
    },
    {
      id: "solar_size_usage-01",
      answer: "At 3 to 5 kWh a day, the 5 kW option is already large. Compare it with 7.2 kW using future loads, extra cost and the export limit.",
    },
    {
      id: "quote_scope-01",
      answer: "The $6,100 quote is only better if the extra $1,900 buys the same work. Price alone is not enough; compare the exact model, electrical work and warranty.",
    },
  ];
  for (const { id, answer } of good) {
    const result = evaluateSurgeResponseRegressionCase(
      corpusCase(id),
      syntheticObservation({ visibleAnswer: answer }),
    );
    assert.equal(
      result.failures.some((failure) => failure.code === "numeric_integrity"),
      false,
      id,
    );
  }

  const wrongDifference = evaluateSurgeResponseRegressionCase(
    corpusCase("quote_scope-01"),
    syntheticObservation({
      visibleAnswer: "The $6,100 quote costs an extra $2,000 for the same work. Price alone is not enough; compare the exact model, electrical work and warranty.",
    }),
  );
  assert.ok(wrongDifference.failures.some(
    (failure) => failure.code === "numeric_integrity" && failure.detail.includes("quote-a"),
  ));
});

test("quote scope accepts the plain phrase like for like", () => {
  const result = evaluateSurgeResponseRegressionCase(
    corpusCase("quote_scope-01"),
    syntheticObservation({
      visibleAnswer: "Neither quote is better on price alone. Quote A is $4,200 and Quote B is $6,100. Compare like for like: the exact model, electrical and plumbing work, removal, warranty and full installed scope.",
    }),
  );
  assert.equal(
    result.failures.some((failure) => failure.code === "required_concept"),
    false,
    JSON.stringify(result.failures),
  );
});

test("battery timing and solar-aware charging accept natural paid-model wording", () => {
  for (const { id, answer } of [
    {
      id: "battery_import_export-01",
      answer: "Exporting 4200 kWh while importing 2200 kWh may support a battery, but annual totals alone do not prove it. A battery must store exports for later imports; tariffs, losses, installed cost and yearly payback decide the value.",
    },
    {
      id: "ev_charger-01",
      answer: "With 5 kW solar, use a smart charger with solar diversion and dynamic load management. Match it to the vehicle's onboard charging limit and have the switchboard and supply checked.",
    },
  ]) {
    const result = evaluateSurgeResponseRegressionCase(
      corpusCase(id),
      syntheticObservation({ visibleAnswer: answer }),
    );
    assert.equal(result.passed, true, `${id}: ${JSON.stringify(result.failures)}`);
  }
});

test("money checks treat valid thousands separators as the same supplied amount", () => {
  for (const { id, answer } of [
    {
      id: "gas_vs_rcac-08",
      answer: "Yes, reverse-cycle is likely cheaper for occupied rooms than the current $1,670 winter gas heating cost.",
    },
    {
      id: "battery_quote-01",
      answer: "$8,500 for 5 kWh may be fair. Check price per quoted kWh, usable capacity, complete installed scope, backup, warranty, yearly saving and payback.",
    },
  ]) {
    const result = evaluateSurgeResponseRegressionCase(
      corpusCase(id),
      syntheticObservation({ visibleAnswer: answer }),
    );
    assert.equal(
      result.failures.some((failure) => failure.code === "numeric_integrity"),
      false,
      `${id}: ${JSON.stringify(result.failures)}`,
    );
  }
});

test("family-specific layout allowances do not weaken strict cases", () => {
  const fiveParagraphAnswer = [
    "Reverse-cycle heating use rose from 240 to 520 kWh.",
    "First compare the same period.",
    "Check the temperature setting.",
    "Clean the filter.",
    "Check heating run time.",
  ].join("\n\n");
  const allowed = evaluateSurgeResponseRegressionCase(
    corpusCase("rcac_bill_jump-01"),
    syntheticObservation({
      visibleAnswer: fiveParagraphAnswer,
      followUpQuestion: "Was each period the same length?",
    }),
  );
  assert.equal(allowed.passed, true);

  const tooMany = evaluateSurgeResponseRegressionCase(
    corpusCase("rcac_bill_jump-01"),
    syntheticObservation({ visibleAnswer: `${fiveParagraphAnswer}\n\nCheck the timer.` }),
  );
  assert.ok(tooMany.failures.some((failure) => failure.code === "paragraph_limit"));

  const strict = evaluateSurgeResponseRegressionCase(
    corpusCase("upgrade_priority-01"),
    syntheticObservation({
      visibleAnswer: "For this Victoria owner home, you mentioned condensation. Check the worst window and reverse-cycle filter.",
      followUpQuestion: "Which room is worst?",
    }),
  );
  assert.ok(strict.failures.some((failure) => failure.code === "numeric_integrity"));
  assert.ok(strict.failures.some((failure) => failure.code === "follow_up_limit"));

  const sixParagraphPlan = [
    "Spend the first $1,000 on draught sealing and better window coverings.",
    "Your mostly single-glazed apartment already has reverse-cycle heating.",
    "Check that condensation is not caused by a leak.",
    "Seal confirmed window gaps without blocking ventilation.",
    "Add close-fitting honeycomb blinds in the coldest room.",
    "Use exhaust fans and clean the reverse-cycle filter.",
  ].join("\n\n");
  const sixAllowed = evaluateSurgeResponseRegressionCase(
    corpusCase("upgrade_priority-01"),
    syntheticObservation({ visibleAnswer: sixParagraphPlan }),
  );
  assert.equal(sixAllowed.passed, true);
  const sevenRejected = evaluateSurgeResponseRegressionCase(
    corpusCase("upgrade_priority-01"),
    syntheticObservation({ visibleAnswer: `${sixParagraphPlan}\n\nCheck the timer.` }),
  );
  assert.ok(sevenRejected.failures.some((failure) => failure.code === "paragraph_limit"));
});

test("duplicate detection exempts declared related scripts but catches unrelated reuse", () => {
  const repeated = "A heat pump answer should explain the decision, the important evidence, the main trade-off and the practical next action in direct plain language for the customer.";
  const cases = [
    syntheticCase({ id: "duplicate-a", family: "family-a", similarityGroup: "shared-script", maxWords: 80 }),
    syntheticCase({ id: "duplicate-b", family: "family-b", similarityGroup: "shared-script", maxWords: 80 }),
  ];
  const observations = cases.map((entry) => syntheticObservation({
    caseId: entry.id,
    visibleAnswer: repeated,
  }));
  const related = evaluateSurgeResponseRegression(cases, observations);
  assert.equal(related.globalFailures.some((failure) => failure.code === "duplicate_answer"), false);

  const unrelatedCases = cases.map((entry) => ({ ...entry, similarityGroup: "" }));
  const unrelated = evaluateSurgeResponseRegression(unrelatedCases, observations);
  assert.ok(unrelated.globalFailures.some((failure) => failure.code === "duplicate_answer"));
});

test("paid model-allowed cases require an accepted model answer", () => {
  const entry = syntheticCase({ modelPolicy: "allowed" });
  const fallback = evaluateSurgeResponseRegressionCase(
    entry,
    syntheticObservation({
      visibleAnswer: "A heat pump is relevant here.",
      modelReservations: 1,
      modelAttempted: true,
      answerSource: "deterministic",
    }),
    { requireAllowedModel: true },
  );
  assert.ok(fallback.failures.some((item) => item.code === "model_policy"));

  const failed = evaluateSurgeResponseRegressionCase(
    entry,
    syntheticObservation({
      visibleAnswer: "A heat pump is relevant here.",
      modelReservations: 1,
      modelAttempted: true,
      modelFailureCode: "provider_output_rejected",
      answerSource: "deterministic",
    }),
    { requireAllowedModel: true },
  );
  assert.ok(failed.failures.some((item) => item.code === "model_policy"));

  const notAttempted = evaluateSurgeResponseRegressionCase(
    entry,
    syntheticObservation({
      visibleAnswer: "A heat pump is relevant here.",
      modelReservations: 0,
      modelAttempted: false,
      answerSource: "deterministic",
    }),
    { requireAllowedModel: true },
  );
  assert.ok(notAttempted.failures.some((item) => item.code === "model_policy"));

  const accepted = evaluateSurgeResponseRegressionCase(
    entry,
    syntheticObservation({
      visibleAnswer: "A heat pump is relevant here.",
      modelReservations: 1,
      modelAttempted: true,
      modelFailureCode: "",
      answerSource: "model",
    }),
    { requireAllowedModel: true },
  );
  assert.equal(accepted.passed, true);
});

test("an official lookup may pass with supported evidence or an honest fail-closed answer after a real attempt", () => {
  const entry = syntheticCase({ modelPolicy: "official_lookup" });
  const failClosed = evaluateSurgeResponseRegressionCase(
    entry,
    syntheticObservation({
      visibleAnswer: "I could not verify today's official heat pump rate, so I cannot confirm it.",
      modelReservations: 1,
      modelAttempted: true,
      modelFailureCode: "provider_output_rejected",
      modelFailureStage: "official_web_evidence",
      answerSource: "deterministic",
    }),
    { requireAllowedModel: true },
  );
  assert.equal(failClosed.passed, true);

  for (const observation of [
    syntheticObservation({
      visibleAnswer: "I could not verify today's official heat pump rate.",
      modelReservations: 0,
      modelAttempted: false,
      answerSource: "deterministic",
    }),
    syntheticObservation({
      visibleAnswer: "I could not verify today's official heat pump rate.",
      modelReservations: 1,
      modelAttempted: true,
      modelFailureCode: "provider_timeout",
      modelFailureStage: "",
      answerSource: "deterministic",
    }),
  ]) {
    const result = evaluateSurgeResponseRegressionCase(
      entry,
      observation,
      { requireAllowedModel: true },
    );
    const attempted = observation.modelAttempted === true;
    assert.equal(
      result.failures.some((item) => item.code === "model_policy"),
      !attempted,
    );
  }
});

test("all 400 questions keep a usable offline response and protected cases bypass the model", async () => {
  let replySequence = 0;
  const observations = await mapConcurrent(
    SURGE_RESPONSE_REGRESSION_CORPUS,
    8,
    async (entry) => {
      let modelReservations = 0;
      const startedAt = performance.now();
      const response = await handleEnergyAssistantRequest(requestFor(entry), {
        now: () => NOW,
        randomUUID: () => {
          replySequence += 1;
          return `00000000-0000-4000-8000-${String(replySequence).padStart(12, "0")}`;
        },
        reserveModelCall: async () => {
          modelReservations += 1;
          return { allowed: false };
        },
        generateAnswer: async () => {
          throw new Error("The unavailable model path must not execute.");
        },
      });
      let payload;
      try {
        payload = await response.json();
      } catch {
        payload = null;
      }
      return observation(
        entry,
        response,
        payload,
        modelReservations,
        performance.now() - startedAt,
      );
    },
  );

  for (const item of observations) {
    assert.equal(item.httpStatus, 200, item.caseId);
    assert.equal(item.error, "", item.caseId);
    assert.ok(item.visibleAnswer.trim(), item.caseId);
    assert.deepEqual(item.quickReplies, [], item.caseId);
  }

  const protectedCases = SURGE_RESPONSE_REGRESSION_CORPUS.filter(
    (entry) => entry.modelPolicy === "forbidden",
  );
  const protectedIds = new Set(protectedCases.map((entry) => entry.id));
  const report = evaluateSurgeResponseRegression(
    protectedCases,
    observations.filter((item) => protectedIds.has(item.caseId)),
  );
  const failures = [
    ...report.results.flatMap((result) => result.failures),
    ...report.globalFailures,
  ];
  const failureCounts = Object.fromEntries(
    [...new Set(failures.map((item) => item.code))]
      .sort()
      .map((code) => [code, failures.filter((item) => item.code === code).length]),
  );
  assert.equal(
    report.ready,
    true,
    `Surge protected-response gate failed: ${report.failureCount} errors across ${report.failedCases} cases.\nFailure counts: ${JSON.stringify(failureCounts)}\n${formatSurgeResponseRegressionFailures(report)}`,
  );
});
