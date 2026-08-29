import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { composeEnergyAssistantAnswer } from "../src/lib/energy-assistant.ts";
import { handleEnergyAssistantRequest } from "../src/lib/energy-assistant-server.ts";
import {
  deriveSurgeAnswerPresentation,
  surgePresentationPassesEverydayLanguage,
  surgePresentationText,
} from "../src/lib/surge-everyday-answer.ts";
import { composeSurgeSimpleAnswer } from "../src/lib/surge-simple-answer.ts";

const NOW = new Date("2026-08-28T00:00:00.000Z");
const ORIGIN = "https://compare.example.test";
const simpleAnswerSource = readFileSync(
  new URL("../src/lib/surge-simple-answer.ts", import.meta.url),
  "utf8",
);

function base(message) {
  return composeEnergyAssistantAnswer(message, { asOf: NOW });
}

function simple(message, recentTurns = [], planContext = null) {
  return composeSurgeSimpleAnswer(message, base(message), planContext, recentTurns);
}

function request(message, recentTurns = []) {
  return new Request(`${ORIGIN}/api/energy-assistant`, {
    method: "POST",
    headers: { origin: ORIGIN, "content-type": "application/json" },
    body: JSON.stringify({ action: "ask", message, recentTurns, audience: "public", pageContext: "/surge" }),
  });
}

test("common household fallback questions receive relevant plain answers", () => {
  const cases = [
    ["where should i start", /problem.*costing|hardest to live/i, /internal platform|calendar date/i],
    ["my power bill is way too high", /finding what is using the most electricity/i, /battery fire/i],
    ["is a battery worth it for me", /export spare solar.*after sunset/i, /STC eligibility/i],
    ["why is my bedroom freezing", /draughts.*coldest windows/i, /room-by-room heat load/i],
    ["my windows are covered in condensation", /start with moisture/i, /replacement windows first/i],
    ["should i replace my gas heater", /plan to replace.*reverse-cycle/i, /carbon monoxide is a colourless/i],
    ["can you tell me if this quote is good", /need the quote or its main details/i, /battery.*fire/i],
    ["what size solar system should i get", /electricity use.*roof space.*export limit/i, /self-clean/i],
    ["i rent, what can i actually do", /changes you can take with you/i, /South Australian rental premises/i],
    ["should I replace my windows with double glazing", /do not jump straight/i, /conductive heat flow/i],
    ["do i need more ceiling insulation", /ceiling insulation is often the first/i, /thermal envelope/i],
    ["is heat pump hot water worth considering", /strong replacement for gas or standard electric/i, /STC eligibility/i],
    ["how do I charge my EV at home", /how far you drive.*parked at home/i, /vehicle driven/i],
    ["my lounge is boiling in summer", /stop summer sun reaching the glass/i, /local design temperatures/i],
  ];

  for (const [message, expected, rejected] of cases) {
    const answer = simple(message);
    assert.ok(answer, message);
    const presentation = deriveSurgeAnswerPresentation(answer, message);
    const rendered = surgePresentationText(presentation, true);
    assert.match(rendered, expected, message);
    assert.doesNotMatch(rendered, rejected, message);
    assert.equal(surgePresentationPassesEverydayLanguage(presentation), true, message);
  }
});

test("deterministic fallbacks stay on cold-room, renter and strata questions", () => {
  const cases = [
    {
      message: "The reverse-cycle unit warms the lounge but bedroom 2 stays cold. Why, and what should I check?",
      expected: [/bedroom is probably receiving less warm air/i, /filter/i, /window draughts and insulation/i, /installer.*balance the outlets/i],
      rejected: [/most efficient electric choice|exact model and variant/i],
    },
    {
      message: "I rent apartment 6 and cannot drill or make permanent changes. What can I do about cold windows and draughts?",
      expected: [/^As a renter/i, /removable fixes/i, /door snake/i, /owner or agent in writing/i, /permanently changes the property/i],
      rejected: [/suitable sealant only on fixed gaps|as the owner/i],
    },
    {
      message: "I own apartment 7 in strata. Do I need approval before installing an outdoor heat-pump or air-conditioner unit?",
      expected: [/^Usually, yes/i, /written strata or owners corporation approval/i, /common property or by-laws/i, /proposed location/i, /noise details/i, /installer's.*route/i],
      rejected: [/most efficient electric choice|which room/i],
    },
  ];

  for (const { message, expected, rejected } of cases) {
    const result = simple(message);
    assert.ok(result, message);
    assert.deepEqual(result.practicalSteps, [], message);
    for (const pattern of expected) assert.match(result.directAnswer, pattern, message);
    for (const pattern of rejected) assert.doesNotMatch(result.directAnswer, pattern, message);
  }
});

test("specific heating-use jumps receive a direct check that preserves both readings", () => {
  const cases = [
    {
      message: "My reverse-cycle heating use jumped from 320 kWh to 640 kWh this month. What should I check first?",
      expected: [/320 kWh to 640 kWh/i, /up about 100%/i],
      rejected: [/start by finding what is using the most electricity/i],
    },
    {
      message: "My reverse-cycle heating use jumped from 380 kWh to 730 kWh this month. What should I check first?",
      expected: [/380 kWh to 730 kWh/i, /up about 92%/i],
      rejected: [/320 kWh|640 kWh/i],
    },
  ];

  for (const { message, expected, rejected } of cases) {
    const result = simple(message);
    assert.ok(result, message);
    assert.deepEqual(result.practicalSteps, [], message);
    for (const pattern of expected) assert.match(result.directAnswer, pattern, message);
    assert.match(result.directAnswer, /same number of days/i, message);
    assert.match(result.directAnswer, /actual meter readings/i, message);
    assert.match(result.directAnswer, /temperature was set higher|heater ran longer/i, message);
    for (const pattern of rejected) assert.doesNotMatch(result.directAnswer, pattern, message);
  }
});

test("portable-heater comparisons choose the cheaper regular-heating option plainly", () => {
  const result = simple("For bedroom 6, is a plug-in electric heater or a reverse-cycle split cheaper to run?");
  assert.ok(result);
  assert.deepEqual(result.practicalSteps, []);
  assert.match(result.directAnswer, /^For bedroom 6, a reverse-cycle split is usually much cheaper to run/i);
  assert.match(result.directAnswer, /moves heat/i);
  assert.match(result.directAnswer, /far less power/i);
  assert.match(result.directAnswer, /plug-in electric heater/i);
  assert.match(result.directAnswer, /very short, occasional use/i);
  assert.doesNotMatch(result.directAnswer, /gas may be best|compare delivered heat/i);
});

test("solar shade questions preserve the supplied shade and time before quote handling", () => {
  const cases = [
    "About 35% of the north roof is shaded after 2 pm. How should that affect the solar quote?",
    "Roughly 20% of the roof has shade after 4:30 pm. Does the solar proposal still make sense?",
  ];

  for (const message of cases) {
    const result = simple(message);
    assert.ok(result, message);
    assert.deepEqual(result.practicalSteps, [], message);
    assert.match(result.directAnswer, /will reduce solar generation/i, message);
    assert.match(result.directAnswer, /panel layout/i, message);
    assert.match(result.directAnswer, /which panels are affected/i, message);
    assert.match(result.directAnswer, /panel-level controls/i, message);
    assert.match(result.directAnswer, /written, site-specific shade analysis/i, message);
    assert.match(result.directAnswer, /shade-adjusted monthly generation estimate/i, message);
    assert.doesNotMatch(result.directAnswer, /price alone|attach the quote/i, message);
  }

  const exact = simple(cases[0]);
  assert.match(exact.directAnswer, /35% of the north roof shaded after 2 pm/i);

  const variant = simple(cases[1]);
  assert.match(variant.directAnswer, /20% of the roof shaded after 4:30 pm/i);
});

test("casual quote follow-ups reuse the previous user topic", () => {
  const recentTurns = [
    { role: "user", content: "I have two heat-pump quotes, one is $6,000 and one is $8,000." },
    { role: "assistant", content: "I can compare the full installation scope." },
  ];
  for (const message of ["what about the cheaper one", "yeah but is it worth it", "and that one?"]) {
    const answer = simple(message, recentTurns);
    assert.ok(answer, message);
    assert.match(answer.directAnswer, /price alone|quote/i, message);
    assert.doesNotMatch(answer.directAnswer, /brand|calendar date|battery STC/i, message);
  }
});

test("three-phase supply questions bypass the battery-worth shortcut", () => {
  const question = "Is it worth getting 3 phase power to accompany a battery and solar installation, or is it more of a switchboard and mains upgrade?";
  assert.equal(simple(question), null);
  assert.equal(simple("Show me the practical next step", [
    { role: "user", content: question },
    { role: "assistant", content: "A three-phase upgrade does not normally mean rewiring every circuit." },
  ]), null);
});

test("a disputed three-phase EV claim gets a direct fallback that preserves the charger size", () => {
  const answer = simple("The installer says I must upgrade to three-phase for a 7 kW EV charger and solar. Is that automatically true?");
  assert.ok(answer);
  assert.match(answer.directAnswer, /^No, not automatically\./i);
  assert.match(answer.directAnswer, /7 kW EV charger/i);
  assert.match(answer.directAnswer, /combined household load|load calculation/i);
  assert.match(answer.directAnswer, /switchboard/i);
  assert.match(answer.directAnswer, /network requirement/i);
  assert.doesNotMatch(answer.directAnswer, /rewir(?:e|ing) every|battery product/i);
});

test("hot-water sizing fallbacks preserve every supplied tank and household quantity", () => {
  for (const { message, expected } of [
    {
      message: "Is a 180 litre heat-pump hot-water tank enough for two people who mostly shower at night?",
      expected: [/180 litre/i, /two people/i, /likely enough/i],
    },
    {
      message: "Is a 280 litre heat-pump hot-water tank enough for seven people who mostly shower at night?",
      expected: [/280 litre/i, /seven people/i, /borderline/i],
    },
  ]) {
    const result = simple(message);
    assert.ok(result, message);
    for (const pattern of expected) assert.match(result.directAnswer, pattern, message);
    assert.match(result.directAnswer, /back-to-back long showers/i, message);
    assert.match(result.directAnswer, /cold-weather recovery/i, message);
  }
});

test("hot-water sizing never invents shower timing that the customer did not supply", () => {
  const result = simple("Is a 250 litre heat-pump hot-water tank enough for three people?");
  assert.ok(result);
  assert.match(result.directAnswer, /250 litre/i);
  assert.match(result.directAnswer, /three people/i);
  assert.doesNotMatch(result.directAnswer, /shower at night|shower in the evening/i);
  assert.match(result.directAnswer, /busiest shower period/i);
});

test("an annual bill is never misread as the installed battery price", () => {
  const result = simple("We pay $600 a year after solar. Is a 5 kWh battery worth it?");
  assert.ok(result);
  assert.match(result.directAnswer, /5 kWh battery/i);
  assert.match(result.directAnswer, /\$600 a year/i);
  assert.match(result.directAnswer, /yearly saving ceiling/i);
  assert.doesNotMatch(result.directAnswer, /A \$600 5 kWh battery|\$120 per quoted kWh/i);
});

test("annual bills are not reused as battery, finance or gas-service prices", () => {
  const battery = simple("We pay $600 a year after solar. Should I buy a 5 kWh battery?");
  assert.ok(battery);
  assert.match(battery.directAnswer, /5 kWh battery/i);
  assert.match(battery.directAnswer, /\$600 a year/i);
  assert.match(battery.directAnswer, /yearly saving ceiling/i);
  assert.doesNotMatch(battery.directAnswer, /\$120 per quoted kWh/i);

  const finance = simple("I pay $600 a year. Should I finance solar and a battery over 5 years?");
  assert.ok(finance);
  assert.match(finance.directAnswer, /system price is not supplied/i);
  assert.match(finance.directAnswer, /5-year payment term/i);
  assert.doesNotMatch(finance.directAnswer, /\$600 may be reasonable or poor/i);

  const gas = simple("I want to abolish the gas connection because my gas bill is $500 a year. Is it worth it?");
  assert.ok(gas);
  assert.match(gas.directAnswer, /meter lock or disconnection can be the cheaper choice/i);
  assert.doesNotMatch(gas.directAnswer, /\$500 is high enough/i);

  const quotedGasWork = simple("The distributor quoted $14,000 to abolish the gas connection. Is that reasonable?");
  assert.ok(quotedGasWork);
  assert.match(quotedGasWork.directAnswer, /^\$14,000 is high enough/i);

  const annualBillBeforeAmount = simple("Our annual electricity bill costs $600 after solar. Should I buy a 5 kWh battery?");
  assert.ok(annualBillBeforeAmount);
  assert.doesNotMatch(annualBillBeforeAmount.directAnswer, /\$120 per quoted kWh/i);

  const annualGasBillBeforeAmount = simple("Our annual gas bill costs $500. Should I abolish the gas connection?");
  assert.ok(annualGasBillBeforeAmount);
  assert.match(annualGasBillBeforeAmount.directAnswer, /meter lock or disconnection can be the cheaper choice/i);
  assert.doesNotMatch(annualGasBillBeforeAmount.directAnswer, /\$500 is high enough/i);
});

test("saved no-solar context changes the battery verdict", () => {
  const answer = simple("is a home battery worth it", [], {
    version: 1,
    source: "home_energy_plan",
    facts: [{ key: "solar", value: "No rooftop solar" }],
  });
  assert.ok(answer);
  assert.match(answer.directAnswer, /^No,.*no rooftop solar/i);
});

test("simple fallbacks do not carry a hidden direct-delivery marker", () => {
  assert.doesNotMatch(simpleAnswerSource, /directDelivery|_surgeDirectDelivery|surgeSimpleAnswerNeedsDirectDelivery/);
});

test("fallback answers preserve supplied quantities without leaking sibling scenario values", () => {
  const cases = [
    {
      message: "Our ducted reverse-cycle system is noisy and set to 17°C.",
      expected: [/17°C setting/i],
      rejected: [/16°C setting/i],
    },
    {
      message: "Our ducted reverse-cycle system is noisy and set at 18 degrees Celsius.",
      expected: [/18°C setting/i],
      rejected: [/17°C setting/i],
    },
    {
      message: "Should I use ducted reverse cycle or separate split systems? We mostly use two rooms.",
      expected: [/uses two rooms/i],
      rejected: [/three rooms|five rooms/i],
    },
    {
      message: "Should I use ducted reverse cycle or separate split systems? We mostly use five rooms.",
      expected: [/uses five rooms/i],
      rejected: [/two rooms|three rooms/i],
    },
    {
      message: "Can a 6.8 kW induction cooktop share the existing 25A circuit with my oven?",
      expected: [/6\.8 kW cooktop.*25 A oven circuit/i],
      rejected: [/7\.4 kW|20 A|9\.2 kW|32 A/i],
    },
    {
      message: "Can a 9.2 kW induction cooktop share the existing 32 amp circuit with my oven?",
      expected: [/9\.2 kW cooktop.*32 A oven circuit/i],
      rejected: [/7\.4 kW|20 A|6\.8 kW|25 A/i],
    },
    {
      message: "We have three-phase power and 6.6 kW of solar. What home EV charger should we install?",
      expected: [/6\.6 kW solar system/i],
      rejected: [/8 kW solar system|12 kW solar system/i],
    },
    {
      message: "We have three-phase power and 12 kW solar. What home EV charger should we install?",
      expected: [/12 kW solar system/i],
      rejected: [/8 kW solar system|6\.6 kW solar system/i],
    },
    {
      message: "A panel is broken and we still have five years on a 44 cent legacy feed-in tariff. What should we do?",
      expected: [/44 cent legacy feed-in tariff.*remaining five years/i],
      rejected: [/50 cent|eight years|60 cent|ten years/i],
    },
    {
      message: "A panel is faulty and we still have ten years on a 60c legacy feed-in tariff. Should we replace it?",
      expected: [/60 cent legacy feed-in tariff.*remaining ten years/i],
      rejected: [/50 cent|eight years|44 cent|five years/i],
    },
    {
      message: "Is a 315 litre heat-pump hot-water unit big enough for six people, is the brand reliable, and how do I find an installer in Geelong?",
      expected: [/315 litre.*six people/i],
      rejected: [/270 litre|four people|Melbourne|200 litre|two people/i],
    },
    {
      message: "Is a 200 L heat-pump hot-water unit big enough for two people, is the brand reliable, and how do I find an installer in Adelaide?",
      expected: [/200 litre.*two people/i],
      rejected: [/270 litre|four people|Melbourne|315 litre|six people/i],
    },
    {
      message: "Should my heat-pump hot-water system start at 8:30 am or 12:30 pm?",
      expected: [/8:30 am.*12:30 pm/i],
      rejected: [/11 am|1 pm|10 am|2 pm/i],
    },
    {
      message: "Should my heat-pump hot-water system start at 10 am or 2 pm?",
      expected: [/10 am.*2 pm/i],
      rejected: [/11 am|1 pm|8:30 am|12:30 pm/i],
    },
    {
      message: "I was offered 12 kW solar and a 10 kWh battery for $24,500, paid over five years. Is that decent?",
      expected: [/\$24,500.*12 kW of solar.*10 kWh battery.*five-year payment term/i],
      rejected: [/seven-year|20 kW|8\.3 kWh/i],
    },
    {
      message: "A salesperson says my three-year-old solar panels are outdated. Should I replace them?",
      expected: [/three-year-old solar panels/i],
      rejected: [/five-year-old|twelve-year-old/i],
    },
    {
      message: "Is heat-pump hot water suitable in Darwin for a family of six?",
      expected: [/household of six/i],
      rejected: [/household of five|household of three/i],
    },
    {
      message: "We use 7 to 9 kWh a day. Should we install 5.5 kW or 7.7 kW of solar?",
      expected: [/7 to 9 kWh a day.*5\.5 kW.*7\.7 kW/i],
      rejected: [/4 to 6 kWh|6\.3 kW|8\.9 kW/i],
    },
  ];

  for (const { message, expected, rejected } of cases) {
    const result = simple(message);
    assert.ok(result, message);
    for (const pattern of expected) assert.match(result.directAnswer, pattern, message);
    for (const pattern of rejected) assert.doesNotMatch(result.directAnswer, pattern, message);
  }
});

test("a current correction wins over older conversation quantities", () => {
  const answer = simple("Actually, should it start at 8:30 am or 12:30 pm instead?", [
    { role: "user", content: "Should my heat-pump hot-water system start at 11 am or 1 pm?" },
    { role: "assistant", content: "Use the time that best overlaps reliable solar." },
  ]);
  assert.ok(answer);
  assert.match(answer.directAnswer, /8:30 am.*12:30 pm/i);
  assert.doesNotMatch(answer.directAnswer, /11 am.*1 pm/i);
});

test("ordinary gas-heater and quote questions no longer trigger emergency answers", async () => {
  for (const [message, expected] of [
    ["should i replace my gas heater", /reverse-cycle air conditioning/i],
    ["is this quote any good", /need the quote or its main details/i],
  ]) {
    const response = await handleEnergyAssistantRequest(request(message), {
      now: () => NOW,
      reserveModelCall: async () => ({ allowed: false }),
    });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.match(payload.reply.directAnswer, expected, message);
    assert.doesNotMatch(payload.reply.content, /Triple Zero|battery fire|colourless, odourless/i, message);
  }
});

test("model-denied air-conditioner questions receive direct plain answers", async () => {
  const cases = [
    {
      message: "Why is my air conditioner dripping water?",
      expected: [
        /indoor air-conditioner unit is not normal/i,
        /condensate drain/i,
        /dirty filter causing ice/i,
        /installation fault/i,
        /outdoor unit can be normal condensate/i,
        /switch the system off if water is reaching electrics or the ceiling/i,
        /arrange a service if indoor dripping persists/i,
      ],
      rejected: [/Triple Zero|gas leak|plug-in heater/i],
    },
    {
      message: "Is reverse-cycle air conditioning efficient in hot weather?",
      expected: [
        /^Yes\./i,
        /efficient way to cool/i,
        /filters clean/i,
        /close doors and windows/i,
        /external shade/i,
        /less efficient in extreme heat/i,
      ],
      rejected: [/plug-in|portable heater|gas heater/i],
    },
  ];

  for (const { message, expected, rejected } of cases) {
    const fallback = simple(message);
    assert.ok(fallback, message);
    for (const pattern of expected) assert.match(fallback.directAnswer, pattern, message);
    for (const pattern of rejected) assert.doesNotMatch(fallback.directAnswer, pattern, message);
    assert.deepEqual(fallback.practicalSteps, [], message);

    const response = await handleEnergyAssistantRequest(request(message), {
      now: () => NOW,
      reserveModelCall: async () => ({ allowed: false }),
    });
    assert.equal(response.status, 200, message);
    const payload = await response.json();
    for (const pattern of expected) assert.match(payload.reply.directAnswer, pattern, message);
    for (const pattern of rejected) assert.doesNotMatch(payload.reply.directAnswer, pattern, message);
  }
});

test("a follow-up already asked and answered is not repeated", async () => {
  const repeated = "Do the windows feel cold even when there is no wind?";
  const response = await handleEnergyAssistantRequest(request("yeah freezing", [
    { role: "assistant", content: `Try the curtains first. ${repeated}` },
    { role: "user", content: "yeah freezing" },
  ]), {
    now: () => NOW,
    composeAnswer: () => ({
      ...base("cold windows"),
      directAnswer: "That confirms the glass itself is a major source of discomfort.",
      suggestedQuestions: [repeated],
    }),
  });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.reply.followUpQuestion, "");
  assert.equal(payload.reply.quickReplies.length, 0);
  assert.doesNotMatch(payload.reply.content, /no wind/i);
});

test("fallbacks stay on the exact battery, underfloor, certificate and rebate questions", () => {
  const cases = [
    {
      message: "Last year we imported 2200 kWh and exported 4200 kWh. Does that make a battery worthwhile?",
      expected: [/imported 2200 kWh/i, /exported 4200 kWh/i, /timing matters/i, /evening or after sunset/i, /spare daytime solar/i, /payback/i],
      rejected: [/battery STC eligibility/i],
    },
    {
      message: "The suspended floor in room 1 is cold and accessible underneath. Is underfloor insulation worthwhile?",
      expected: [/^Yes, underfloor insulation can help/i, /without gaps/i, /moisture/i, /wiring/i, /termite/i],
      rejected: [/connected boundary/i],
    },
    {
      message: "The room has a concrete slab on ground. Is underfloor insulation worth adding?",
      expected: [/^No, ordinary underfloor batts are not a practical retrofit/i, /no accessible floor cavity/i, /slab edges/i],
      rejected: [/underfloor insulation can help/i],
    },
    {
      message: "A Victorian quote values STCs at $36 and VEECs at $70. Do those certificate rates and the listed fees make sense today?",
      expected: [/\$36 per STC/i, /\$70 per VEEC/i, /markets change/i, /registration, compliance or brokerage fees/i],
      rejected: [/cheaper quote better/i],
    },
    {
      message: "Postcode 3000: what heat-pump hot-water rebates might apply if I have not chosen an exact model yet?",
      expected: [/postcode 3000 in Victoria/i, /eligibility cannot be confirmed/i, /exact approved model/i, /current official sources/i],
      rejected: [/How many people use hot water/i],
    },
    {
      message: "An installer recommends 10 kW of solar although we use about 3500 kWh a year. Is that oversized?",
      expected: [/10 kW of solar is large/i, /3500 kWh a year/i, /exported/i, /future loads such as an EV/i, /export limit/i],
      rejected: [/share annual use/i],
    },
    {
      message: "We pay only $600 a year after solar. Is a $9,000 5 kWh battery likely to save enough?",
      expected: [/^No, not on bill savings alone/i, /\$9,000 5 kWh battery/i, /\$600 a year/i, /warranty/i, /payback/i],
      rejected: [/attach the quote/i],
    },
    {
      message: "Is $8,500 installed for a 5 kWh home battery a fair quote?",
      expected: [/\$8,500 installed for a 5 kWh battery/i, /per quoted kWh/i, /usable/i, /installation and backup scope/i, /warranty/i, /payback/i],
      rejected: [/attach the quote/i],
    },
    {
      message: "Our plan offers 2 free hours but charges 42 cents per kWh in the evening. We have solar and a battery. Is it a good plan?",
      expected: [/2 free hours/i, /42 cents per kWh/i, /whole tariff/i, /daily supply charge/i, /solar export credit/i, /full-year bill/i],
      rejected: [/which state or territory/i],
    },
    {
      message: "A retailer offers an 8 cent feed-in tariff, but we import power at night. Is the highest feed-in rate automatically best?",
      expected: [/^No\./i, /8 cent feed-in tariff/i, /night import rate/i, /daily supply charge/i, /lowest annual bill/i],
      rejected: [/highest feed-in tariff alone without a verdict/i],
    },
    {
      message: "Quote A is $4,200 and quote B is $6,100 for similar heat-pump work. How do I tell which is better?",
      expected: [/Quote A is \$4,200/i, /Quote B is \$6,100/i, /\$1,900 difference/i, /like for like/i, /electrical/i, /warranty/i],
      rejected: [/attach the quote/i],
    },
    {
      message: "Is a 180 litre heat-pump hot-water unit enough for two people, how do I judge whether the brand is reliable, and how do I find an installer that services postcode 3000?",
      expected: [/180 litre.*two people/i, /warranty.*local parts/i, /postcode 3000/i, /one enquiry/i],
      rejected: [/your postcode/i],
    },
  ];

  for (const { message, expected, rejected } of cases) {
    const result = simple(message);
    assert.ok(result, message);
    for (const pattern of expected) assert.match(result.directAnswer, pattern, message);
    for (const pattern of rejected) assert.doesNotMatch(result.directAnswer, pattern, message);
  }
});

test("fallbacks answer gas-versus-reverse-cycle cost, hot-water noise and failed glazing seals directly", () => {
  const gas = simple("Gas heating costs about $1,450 each winter. Is reverse-cycle likely to be cheaper for the rooms we use?");
  assert.ok(gas);
  assert.match(gas.directAnswer, /^Yes, reverse-cycle is likely to be cheaper/i);
  assert.match(gas.directAnswer, /\$1,450 each winter/i);
  assert.match(gas.directAnswer, /gas supply charge/i);
  assert.deepEqual(gas.practicalSteps, []);
  assert.deepEqual(gas.suggestedQuestions, []);

  const noise = simple("The proposed heat-pump hot-water unit would sit 3 metres from a bedroom window. How should I judge the noise?");
  assert.ok(noise);
  assert.match(noise.directAnswer, /^3 metres from a bedroom window is not enough information/i);
  assert.match(noise.directAnswer, /exact model's published sound data/i);
  assert.match(noise.directAnswer, /installer assess the proposed location/i);
  assert.match(noise.directAnswer, /vibration-isolating mounts/i);
  assert.deepEqual(noise.suggestedQuestions, []);

  const glazing = simple("There is moisture trapped between the panes of a double-glazed window. Can ventilation fix it?");
  assert.ok(glazing);
  assert.match(glazing.directAnswer, /^No\. Room ventilation cannot clear moisture trapped between the panes/i);
  assert.match(glazing.directAnswer, /edge seal has failed/i);
  assert.match(glazing.directAnswer, /supplier or installer.*warranty/i);
  assert.match(glazing.directAnswer, /glazier/i);
  assert.match(glazing.directAnswer, /replacement of the sealed glass unit/i);
  assert.doesNotMatch(glazing.directAnswer, /bathroom exhaust/i);
  assert.deepEqual(glazing.suggestedQuestions, []);

  const roomSide = simple("The window is double glazed and gets condensation on the room side, never between the panes. Is it faulty?");
  assert.ok(roomSide);
  assert.match(roomSide.directAnswer, /^Not necessarily/i);
  assert.match(roomSide.directAnswer, /room-side surface/i);
  assert.match(roomSide.directAnswer, /does not automatically mean.*faulty/i);
  assert.doesNotMatch(roomSide.directAnswer, /edge seal has failed/i);
});

test("short contextual fallbacks answer the referenced decision without restarting the topic", () => {
  const cases = [
    {
      message: "What if it is calm tonight?",
      recentTurns: [
        { role: "user", content: "The window only feels draughty when the wind blows." },
        { role: "assistant", content: "That points to an opening gap." },
      ],
      expected: [/^If it is calm/i, /wind pressure/i, /air leak/i, /tissue or paper/i, /weather seals/i],
      rejected: [/battery|fire|what topic/i],
    },
    {
      message: "Yeah, really cold.",
      recentTurns: [
        { role: "assistant", content: "Do the windows feel cold even when there is no wind?" },
        { role: "user", content: "Yes, they feel freezing on still nights." },
      ],
      expected: [/cold window glass or frame/i, /honeycomb blind or thermal curtain/i, /secondary glazing/i, /still nights/i],
      rejected: [/which rooms|passive heating/i],
    },
    {
      message: "Is that too long then?",
      recentTurns: [
        { role: "user", content: "My battery quote is $12,000 and expected savings are $700 a year." },
        { role: "assistant", content: "That gives a long simple payback." },
      ],
      expected: [/^Yes\./i, /17\.1 years/i, /long simple payback for a battery/i, /warranty period/i],
      rejected: [/cheaper quote|attach the quote/i],
    },
    {
      message: "What should they prove?",
      recentTurns: [
        { role: "user", content: "The electrician says three-phase is mandatory for my 7 kW charger." },
        { role: "assistant", content: "It is not automatically mandatory." },
      ],
      expected: [/maximum-demand or load calculation/i, /switchboard capacity/i, /7 kW charger/i, /exact network or equipment rule/i, /three-phase supply/i],
      rejected: [/how far.*drive/i],
    },
    {
      message: "How do I check that?",
      recentTurns: [
        { role: "user", content: "The proposed hot-water unit is beside our bedroom." },
        { role: "assistant", content: "Noise and vibration need checking before installation." },
      ],
      expected: [/exact model number/i, /published sound data/i, /bedroom window and property boundary/i, /vibration-isolating mounts/i],
      rejected: [/how many people use hot water/i],
    },
    {
      message: "Can I do that without drilling?",
      recentTurns: [
        { role: "user", content: "I rent and can only use removable window treatments." },
        { role: "assistant", content: "Honeycomb blinds may help if mounted without damage." },
      ],
      expected: [/^Yes\./i, /no-drill honeycomb blind/i, /manufacturer's.*instructions/i, /lift paint/i, /ask the owner/i],
      rejected: [/door snake.*weather seals.*curtains/i],
    },
    {
      message: "Why does timing matter?",
      recentTurns: [
        { role: "user", content: "Our solar exports 4,800 kWh and imports 2,600 kWh each year." },
        { role: "assistant", content: "Timing matters more than the annual totals alone." },
      ],
      expected: [/daytime solar/i, /evening or overnight/i, /exported cheaply/i, /half-hourly data/i],
      rejected: [/panels self-clean|rooftop cleaning/i],
    },
  ];

  for (const { message, recentTurns, expected, rejected } of cases) {
    const result = simple(message, recentTurns);
    assert.ok(result, message);
    for (const pattern of expected) assert.match(result.directAnswer, pattern, message);
    for (const pattern of rejected) assert.doesNotMatch(result.directAnswer, pattern, message);
    assert.deepEqual(result.practicalSteps, [], message);
    assert.deepEqual(result.suggestedQuestions, [], message);
  }

  const reversedAmounts = simple("Is that too long then?", [
    { role: "user", content: "The expected saving is $700 a year and the battery quote is $12,000." },
    { role: "assistant", content: "That gives a long simple payback." },
  ]);
  assert.ok(reversedAmounts);
  assert.match(reversedAmounts.directAnswer, /17\.1 years/i);
  assert.doesNotMatch(reversedAmounts.directAnswer, /0\.1 years/i);
});

test("model-denied API answers ordinary first questions directly across core home-energy families", async () => {
  const cases = [
    ["Is solar worth it?", /Usually, yes.*Rooftop solar/i],
    ["What size battery do I need?", /after sunset.*spare solar/i],
    ["Do honeycomb blinds actually work?", /^Yes\..*window coverings/i],
    ["Should I replace my single-glazed windows?", /^Not automatically\..*full replacement/i],
    ["Do I need three phase for an induction cooktop?", /^No, not automatically\..*single-phase/i],
    ["Can I put a heat-pump hot-water unit near a bedroom?", /^Possibly,.*noise.*bedroom window/i],
    ["Why is my bedroom colder than the lounge?", /less warm air than the lounge.*losing heat faster/i],
    ["Do curtains help?", /lined curtains and pelmets reduce winter heat loss/i],
    ["Do blinds help keep heat in?", /close-fitting honeycomb or cellular blinds/i],
    ["Do shutters keep heat out?", /external blinds or shutters.*summer sun/i],
    ["Are cellular shades effective?", /^Yes\..*improve comfort/i],
    ["Are blinds worth it?", /^Yes\..*close fit/i],
    ["Do pelmets work?", /pelmets reduce winter heat loss/i],
    ["Can window coverings reduce heat loss?", /^Yes\..*winter heat loss/i],
    ["Should I use a door snake?", /^Yes, if air is actually moving.*unwanted gap/i],
    ["Can I seal gaps around my doors?", /check.*tissue.*Do not block a required vent/i],
    ["Can a home battery power my whole house?", /^Sometimes, but not automatically\..*whole-home backup/i],
    ["How long does a home battery last?", /10-year warranty.*useful life/i],
    ["Can I charge a home battery from the grid?", /^Yes, if the battery.*allow grid charging/i],
    ["Are heat-pump hot-water systems noisy?", /steady fan and compressor sound/i],
    ["Can heat-pump hot water run at night?", /^Yes,.*run at night/i],
    ["What size heat-pump hot-water tank do two people need?", /For two people, about 180 to 250 litres/i],
    ["Are external blinds better than internal blinds?", /external blinds or shutters are usually better/i],
    ["How can I make aluminium windows feel warmer?", /moving-air gaps.*honeycomb blinds.*secondary glazing/i],
    ["How do I check how much electricity I use overnight?", /half-hourly smart-meter data.*normal quarterly bill cannot show/i],
    ["Should I change electricity retailer?", /^Yes, if another plan gives a lower full-year bill/i],
    ["What is a controlled load?", /separately metered electricity circuit.*network switches on/i],
    ["Can I charge an EV from a normal power point?", /^Yes, many EVs can charge.*but it is slow/i],
    ["Can I charge my EV from solar?", /^Yes\..*solar-aware home charger/i],
    ["Do I need a home EV charger?", /^Not always\..*normal power point/i],
    ["How fast will a 7 kW charger charge my car?", /7 kW charger.*about 7 kWh.*charging time in hours.*energy needed.*actual charging power/i],
    ["Will I need new wiring for an induction cooktop?", /^Maybe\..*dedicated circuit/i],
    ["Do my pans work on induction?", /fridge magnet sticks firmly/i],
    ["Are induction cooktops safe?", /^Yes, induction cooktops are generally safe/i],
    ["Do induction cooktops use a lot of power?", /^Not for the cooking delivered\./i],
    ["Will solar reduce my electricity bill?", /^Yes\. Solar reduces the electricity you need to buy/i],
    ["Is my roof suitable for solar?", /enough usable area.*limited shade.*sound roofing/i],
    ["Do solar panels work in winter?", /^Yes\. Solar panels still generate electricity in winter/i],
    ["Can I add more solar panels later?", /^Often, yes, but plan for it now/i],
    ["Is reverse-cycle air conditioning cheap to run?", /^Usually, yes\..*cheapest common way to heat/i],
    ["What temperature should I set my air conditioner to?", /20 to 21°C for heating and 24 to 26°C for cooling/i],
    ["Should I turn my air conditioner off when I leave?", /^Yes, turn it off.*empty for hours/i],
    ["What R value ceiling insulation do I need?", /R4 to R6.*common target/i],
    ["Can I install insulation myself?", /^Sometimes, but only if.*safe.*DIY/i],
    ["Should I replace aluminium windows?", /^Not automatically\..*Older aluminium frames/i],
    ["How many solar panels do I need?", /panel count.*target system size.*1,000.*panel wattage/i],
    ["Can I add a battery to existing solar?", /^Usually, yes\..*added to existing solar/i],
    ["How long will a 10 kWh battery run my home?", /10 kWh battery does not have one fixed runtime.*runtime in hours.*usable battery energy.*average load/i],
    ["Do I need new pots for induction?", /^Not necessarily\..*magnetic cookware/i],
    ["Is induction safe?", /^Yes, induction cooktops are generally safe/i],
    ["Should I switch electricity retailers?", /^Yes, if another plan gives a lower full-year bill/i],
    ["Why is my overnight electricity use high?", /^High overnight use is usually a large appliance/i],
    ["What is a feed-in tariff?", /amount your electricity retailer credits.*solar power.*export/i],
  ];
  const genericMisroutes = /self-clean(?:ing)?|battery STC eligibility|Solar Sharer|Surge AI is here for Australian home energy|staged whole-home|assessor baseline|I found a related current official source|Which affected room or major end use/i;

  for (const [message, expected] of cases) {
    const response = await handleEnergyAssistantRequest(request(message), {
      now: () => NOW,
      reserveModelCall: async () => ({ allowed: false }),
    });
    assert.equal(response.status, 200, message);
    const payload = await response.json();
    assert.match(payload.reply.directAnswer, expected, message);
    assert.doesNotMatch(payload.reply.directAnswer, genericMisroutes, message);
    assert.equal(payload.reply.followUpQuestion, "", message);
    assert.deepEqual(payload.reply.quickReplies, [], message);
  }
});

test("new baseline fallbacks preserve quote review and solar-cleaning behaviour", async () => {
  const quote = await handleEnergyAssistantRequest(request("Can you review this solar quote?"), {
    now: () => NOW,
    reserveModelCall: async () => ({ allowed: false }),
  });
  assert.equal(quote.status, 200);
  const quotePayload = await quote.json();
  assert.match(quotePayload.reply.directAnswer, /need the quote or its main details/i);
  assert.doesNotMatch(quotePayload.reply.directAnswer, /Rooftop solar often pays for itself/i);

  const cleaning = await handleEnergyAssistantRequest(request("Do I need to clean my solar panels?"), {
    now: () => NOW,
    reserveModelCall: async () => ({ allowed: false }),
  });
  assert.equal(cleaning.status, 200);
  const cleaningPayload = await cleaning.json();
  assert.match(cleaningPayload.reply.directAnswer, /rain|clean/i);
  assert.doesNotMatch(cleaningPayload.reply.directAnswer, /Rooftop solar often pays for itself|Panel count depends/i);
});

test("a current named topic overrides a stale battery topic when the model is denied", async () => {
  const recentTurns = [
    { role: "user", content: "Is a home battery worth it for me?" },
    { role: "assistant", content: "A battery is usually worthwhile only when you export spare solar and buy electricity after sunset." },
  ];
  const cases = [
    ["what about solar?", /^Solar is usually worth considering/i],
    ["what about induction?", /^Induction is an efficient electric cooking option/i],
    ["what about heat-pump hot water?", /^Heat-pump hot water is usually an efficient replacement/i],
    ["what about windows?", /^Windows can cause winter heat loss/i],
  ];
  const staleBatteryAnswer = /Maybe, but a battery is usually worthwhile|A home battery is unlikely to be your best first step/i;

  for (const [message, expected] of cases) {
    const fallback = simple(message, recentTurns);
    assert.ok(fallback, message);
    assert.match(fallback.directAnswer, expected, message);
    assert.doesNotMatch(fallback.directAnswer, staleBatteryAnswer, message);

    const response = await handleEnergyAssistantRequest(request(message, recentTurns), {
      now: () => NOW,
      reserveModelCall: async () => ({ allowed: false }),
    });
    assert.equal(response.status, 200, message);
    const payload = await response.json();
    assert.match(payload.reply.directAnswer, expected, message);
    assert.doesNotMatch(payload.reply.directAnswer, staleBatteryAnswer, message);
    assert.equal(payload.reply.followUpQuestion, "", message);
    assert.deepEqual(payload.reply.quickReplies, [], message);
  }

  const specificSolarQuestion = simple("Does solar make sense?", recentTurns);
  assert.ok(specificSolarQuestion);
  assert.match(specificSolarQuestion.directAnswer, /^Usually, yes\. Rooftop solar/i);
  assert.doesNotMatch(specificSolarQuestion.directAnswer, staleBatteryAnswer);
});

test("named-topic degree words and bare comparatives do not revive a stale topic", async () => {
  const recentTurns = [
    { role: "user", content: "Is a home battery worth it for me?" },
    { role: "assistant", content: "A battery can suit homes with spare daytime solar and high use after sunset." },
  ];
  const cases = [
    ["Why is solar too expensive?", /^Solar can look expensive because the installed price covers/i],
    ["Is solar cheaper?", /^Solar may be the cheaper or better-value option/i],
    ["Is solar better?", /^Solar may be the cheaper or better-value option/i],
  ];

  for (const [message, expected] of cases) {
    const response = await handleEnergyAssistantRequest(request(message, recentTurns), {
      now: () => NOW,
      reserveModelCall: async () => ({ allowed: false }),
    });
    assert.equal(response.status, 200, message);
    const payload = await response.json();
    assert.match(payload.reply.directAnswer, expected, message);
    assert.doesNotMatch(payload.reply.directAnswer, /battery is usually worthwhile|home battery is unlikely/i, message);
    assert.equal(payload.reply.followUpQuestion, "", message);
    assert.deepEqual(payload.reply.quickReplies, [], message);
  }
});

test("genuine anaphora and trailing additive wording still reuse needed context", async () => {
  const batteryWorthTurns = [
    { role: "user", content: "Is a home battery worth it for me?" },
    { role: "assistant", content: "That depends on spare daytime solar and use after sunset." },
  ];
  const cheaperResponse = await handleEnergyAssistantRequest(request("Is it cheaper?", batteryWorthTurns), {
    now: () => NOW,
    reserveModelCall: async () => ({ allowed: false }),
  });
  assert.equal(cheaperResponse.status, 200);
  const cheaperPayload = await cheaperResponse.json();
  assert.match(cheaperPayload.reply.directAnswer, /battery is usually worthwhile/i);

  const pricedBatteryTurns = [
    { role: "user", content: "The proposed 10 kWh battery costs $12,000 and should save $700 a year." },
    { role: "assistant", content: "That has a long payback." },
  ];
  const thatTooResponse = await handleEnergyAssistantRequest(request("Is that too expensive?", pricedBatteryTurns), {
    now: () => NOW,
    reserveModelCall: async () => ({ allowed: false }),
  });
  assert.equal(thatTooResponse.status, 200);
  const thatTooPayload = await thatTooResponse.json();
  assert.match(thatTooPayload.reply.directAnswer, /\$1,200 per quoted kWh/i);

  const expensiveBatteryTurns = [
    { role: "user", content: "Why is a home battery so expensive?" },
    { role: "assistant", content: "The installed price includes more than the battery cells." },
  ];
  for (const message of ["solar too?", "solar as well?"]) {
    const response = await handleEnergyAssistantRequest(request(message, expensiveBatteryTurns), {
      now: () => NOW,
      reserveModelCall: async () => ({ allowed: false }),
    });
    assert.equal(response.status, 200, message);
    const payload = await response.json();
    assert.match(payload.reply.directAnswer, /^Solar can look expensive because the installed price covers/i, message);
    assert.doesNotMatch(payload.reply.directAnswer, /battery is usually worthwhile/i, message);
  }
});

test("an explicit reference still reuses the prior topic when the model is denied", async () => {
  const recentTurns = [
    { role: "user", content: "The proposed 10 kWh battery costs $12,000 and the expected saving is $700 a year." },
    { role: "assistant", content: "That implies a long simple payback." },
  ];
  const response = await handleEnergyAssistantRequest(request("Is that battery worth it?", recentTurns), {
    now: () => NOW,
    reserveModelCall: async () => ({ allowed: false }),
  });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.match(payload.reply.directAnswer, /\$12,000 10 kWh battery/i);
  assert.match(payload.reply.directAnswer, /\$700 a year/i);
  assert.doesNotMatch(payload.reply.directAnswer, /need the quote or its main details/i);
});

test("no-model sizing answers use supplied inputs and formulas without invented quantities", async () => {
  const cases = [
    {
      message: "How many solar panels do I need?",
      expected: [
        /panel count = target system size in kW × 1,000 ÷ panel wattage in W/i,
        /What target system size and exact panel wattage/i,
      ],
      absent: [/\b6\.6 kW\b/i, /\b440 W\b/i, /\b15 panels\b/i],
    },
    {
      message: "How long will a 10 kWh battery run my home?",
      expected: [
        /^A 10 kWh battery does not have one fixed runtime/i,
        /runtime in hours = usable battery energy.*÷ the average load/i,
        /exact battery model, starting charge or backup reserve/i,
      ],
      absent: [/\b90%\b/i, /\b9 kWh\b/i, /\b9 hours\b/i, /\b1 kW\b/i, /\b2 kW\b/i],
    },
    {
      message: "How fast will a 7 kW charger charge my car?",
      expected: [
        /^A 7 kW charger can add up to about 7 kWh/i,
        /charging time in hours = energy needed in kWh ÷ the actual charging power in kW/i,
        /usable battery capacity, starting and target battery percentages, and onboard AC charging limit/i,
      ],
      absent: [/\b60 kWh\b/i, /\b8\.6 hours\b/i],
    },
  ];

  for (const { message, expected, absent } of cases) {
    const response = await handleEnergyAssistantRequest(request(message), {
      now: () => NOW,
      reserveModelCall: async () => ({ allowed: false }),
    });
    assert.equal(response.status, 200, message);
    const payload = await response.json();
    for (const pattern of expected) assert.match(payload.reply.directAnswer, pattern, message);
    for (const pattern of absent) assert.doesNotMatch(payload.reply.directAnswer, pattern, message);
    assert.equal(payload.reply.followUpQuestion, "", message);
    assert.deepEqual(payload.reply.quickReplies, [], message);
  }
});
