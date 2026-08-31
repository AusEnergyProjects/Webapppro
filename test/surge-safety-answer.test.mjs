import assert from "node:assert/strict";
import test from "node:test";
import { handleEnergyAssistantRequest } from "../src/lib/energy-assistant-server.ts";
import {
  composeSurgeNonCurrentHazardAnswer,
  composeSurgeSafetyAnswer,
} from "../src/lib/surge-safety-answer.ts";

const NOW = new Date("2026-08-29T00:00:00.000Z");
const ORIGIN = "https://compare.example.test";
let requestCounter = 0;

function request(message, recentTurns = []) {
  return new Request(`${ORIGIN}/api/energy-assistant`, {
    method: "POST",
    headers: { origin: ORIGIN, "content-type": "application/json" },
    body: JSON.stringify({
      action: "ask",
      requestId: `safety-check-${String(++requestCounter).padStart(4, "0")}`,
      message,
      recentTurns,
      audience: "public",
      pageContext: "/surge",
    }),
  });
}

test("immediate household hazards receive action-first deterministic answers", async () => {
  const cases = [
    ["The switchboard is hot and buzzing. Should I reset it?", /leave the equipment unused/i, /do not touch, reset/i],
    ["Rainwater is dripping beside exposed electrical cables. Can I move them?", /leave the equipment unused/i, /do not touch/i],
    ["Water is dripping near live electrical cables. Can I move the cables?", /leave the equipment unused/i, /do not touch/i],
    ["The solar DC isolator is sparking. Should I switch it off?", /leave the equipment unused/i, /do not touch/i],
    ["The EV charging plug is scorched and warm. Can I unplug it?", /leave the equipment unused/i, /do not touch, reset, unplug/i],
    ["The split system is hissing and I suspect refrigerant is leaking. Can I keep running it?", /stop using the system/i, /licensed refrigeration technician/i],
    ["The home battery is swollen, hot and hissing. Should I reset it?", /contact the installer or manufacturer urgently/i, /do not touch, move, charge, unplug, reset/i],
    ["My gas heater is smoking. Can I keep using it?", /fresh outdoor air/i, /do not operate electrical switches/i],
    ["The portable electric heater is smoking. Should I unplug it?", /visible smoke or fire is present/i, /do not touch, reset, unplug/i],
    ["The heat pump is smoking and smells burnt.", /visible smoke or fire is present/i, /do not touch, reset, unplug/i],
    ["My gas heater is hissing. What should I do?", /fresh outdoor air/i, /gas network fault line/i],
    ["The battery alarm is sounding continuously.", /contact the installer or manufacturer urgently/i, /do not touch/i],
    ["My home battery is very hot right now.", /contact the installer or manufacturer urgently/i, /do not touch/i],
    ["My battery smells burnt right now.", /contact the installer or manufacturer urgently/i, /do not touch/i],
    ["My battery has started to hiss right now.", /contact the installer or manufacturer urgently/i, /do not touch/i],
    ["There is water in my switchboard right now.", /leave the equipment unused/i, /urgent licensed electrician/i],
    ["Water got into my switchboard just now.", /leave the equipment unused/i, /urgent licensed electrician/i],
    ["The power point has water in it right now.", /leave the equipment unused/i, /urgent licensed electrician/i],
    ["Old roof insulation may contain asbestos. Can I inspect it closely?", /do not disturb/i, /licensed asbestos assessor/i],
    ["A carbon-monoxide alarm is sounding and someone has a headache.", /fresh outdoor air/i, /call 000/i],
  ];

  for (const [message, expected, protectedAction] of cases) {
    let reservations = 0;
    const response = await handleEnergyAssistantRequest(request(message), {
      now: () => NOW,
      reserveModelCall: async () => {
        reservations += 1;
        return { allowed: true, release: async () => undefined };
      },
    });
    assert.equal(response.status, 200, message);
    const payload = await response.json();
    assert.equal(reservations, 0, message);
    assert.match(payload.reply.directAnswer, expected, message);
    assert.match(payload.reply.directAnswer, protectedAction, message);
    assert.equal(payload.reply.followUpQuestion, "", message);
    assert.ok(payload.reply.directAnswer.split(/\s+/u).length <= 90, message);
  }
});

test("explicit current gas odour wording receives gas safety guidance", () => {
  for (const message of [
    "I smell gas from my heater right now.",
    "I can smell gas in the kitchen right now.",
    "There is a gas odour near my cooktop.",
    "I smell something like gas beside the stove.",
    "Gas smell right now.",
    "Strong gas odour in the kitchen right now.",
    "There is a strong gas smell right now.",
    "I can smell a strong gas odour now.",
    "I am smelling gas right now.",
    "The house smells of gas right now.",
    "There is a rotten egg smell by the gas meter right now.",
  ]) {
    const answer = composeSurgeSafetyAnswer(message);
    assert.ok(answer, message);
    assert.match(answer.directAnswer, /fresh outdoor air/i, message);
  }
});

test("an explicit current CO alarm with symptoms receives the narrow emergency response", () => {
  for (const message of [
    "CO alarm is beeping right now and I feel dizzy.",
    "My CO alarm went off and I feel dizzy right now.",
    "The gas heater is running and two people are vomiting.",
    "The CO alarm is sounding and my child feels sick.",
  ]) {
    const answer = composeSurgeSafetyAnswer(message);
    assert.ok(answer, message);
    assert.match(answer.directAnswer, /fresh outdoor air/i, message);
    assert.match(answer.directAnswer, /call 000/i, message);
  }
});

test("a current hazard can inherit only the newest equipment anchor", () => {
  const isolator = composeSurgeSafetyAnswer("Now it is sparking.", [
    "My solar isolator is acting up.",
  ]);
  assert.ok(isolator);
  assert.match(isolator.directAnswer, /leave the equipment unused/i);

  const refrigerant = composeSurgeSafetyAnswer("Now it is hissing and I can see oily residue.", [
    "My battery was checked last week.",
    "The split system started behaving strangely today.",
  ]);
  assert.ok(refrigerant);
  assert.match(refrigerant.directAnswer, /stop using the system/i);
  assert.doesNotMatch(refrigerant.directAnswer, /battery failure/i);
});

test("old hazards and negated hazard wording do not hijack a new question", () => {
  assert.equal(composeSurgeSafetyAnswer("What size solar system suits me?", [
    "The old battery was hissing before it was removed.",
  ]), null);
  assert.equal(composeSurgeSafetyAnswer("The switchboard is not hot, sparking or buzzing."), null);
  assert.equal(composeSurgeSafetyAnswer("The home battery is warm but smoke is not present."), null);
  assert.equal(composeSurgeSafetyAnswer("Smoke is not coming from the inverter."), null);
  assert.equal(composeSurgeSafetyAnswer("The battery smoke is no longer present."), null);
});

test("ordinary equipment questions do not trigger an emergency answer from harmless hot or water wording", () => {
  const ordinaryQuestions = [
    "Should I get a heat pump hot water system?",
    "Is a heat pump good for hot water?",
    "My air conditioner is dripping water.",
    "Is reverse-cycle air conditioning efficient in hot weather?",
    "Is reverse-cycle air conditioning efficient on a very hot day?",
    "Can a heat pump make very hot water?",
    "Is a blue flame normal on a gas heater?",
    "Why does my smoke alarm chirp every minute?",
    "Should I replace an old smoke alarm?",
    "Can bushfire smoke damage my air conditioner?",
    "Smoke is coming from a bushfire outside. Should I turn off the air conditioner?",
    "Can cooking smoke affect a reverse-cycle air conditioner?",
    "Can bushfire smoke damage my home battery?",
    "Can cooking smoke affect my gas heater?",
    "My air conditioner is leaking water inside.",
    "Can a heat pump leak refrigerant?",
    "Can carbon monoxide make you dizzy?",
    "Why can a home battery make a hissing noise?",
    "Can an inverter have a burning smell when it fails?",
    "My air conditioner makes a hissing sound sometimes. Is that normal?",
    "My aircon seems to be leaking. What should I check?",
    "I have a headache and I am comparing gas with reverse-cycle heating.",
    "My gas bill gives me a headache.",
    "I felt dizzy after exercise yesterday. Is gas or reverse-cycle heating cheaper?",
    "If my home battery starts hissing, what would that mean?",
    "The manual says the inverter may smell burnt during commissioning.",
    "My installer said the battery can make a popping noise during testing.",
    "Can rainwater damage a switchboard?",
    "Should water be stored near a switchboard?",
    "Where should I install the switchboard so rainwater cannot reach it?",
    "There is a water bottle beside the switchboard.",
    "There is a leaking tap near the power point, but the power point is dry.",
    "The switchboard is in a damp room but it is currently dry.",
    "My gas cooktop has steady blue flames.",
    "My gas heater has a small pilot flame.",
    "The battery alarm sounds once a month during its self-test.",
    "The heat pump makes mist during defrost on cold mornings.",
    "The old inverter was smoking before it was replaced.",
    "My old battery was swollen but has been removed.",
    "The meter box got wet last year but was dried and checked by an electrician.",
    "My battery is mounted below the smoke alarm.",
    "My gas heater is next to a smoke alarm.",
    "I can see smoke from my neighbour's chimney.",
    "I smell smoke from a fireplace outside, but there is no fire here.",
    "My battery is burning through electricity.",
    "Why is my inverter burning so much power?",
    "The heat pump is burning through electricity this winter.",
    "My heater is burning money.",
    "The EV charger is burning lots of power.",
    "My gas bill is burning a hole in my pocket.",
    "Gas prices are on fire this year.",
    "Battery sales are on fire.",
    "The solar battery market is on fire.",
    "The gas heater is running and I feel sick of the high bill.",
    "I feel sick of paying for gas while the heater is running.",
  ];

  for (const message of ordinaryQuestions) {
    assert.equal(composeSurgeSafetyAnswer(message), null, message);
  }
});

test("old gas context does not turn an unrelated current symptom into an emergency", () => {
  assert.equal(composeSurgeSafetyAnswer(
    "I have a headache from staring at the bill.",
    ["Should I replace gas heating with reverse-cycle?"],
  ), null);
  assert.equal(composeSurgeSafetyAnswer(
    "It makes one popping noise during the monthly self-test.",
    ["I have a home battery."],
  ), null);
  assert.equal(composeSurgeSafetyAnswer(
    "The old one was smoking but it has been replaced.",
    ["My inverter failed last year."],
  ), null);
});

test("hypothetical safety questions are not misclassified as current emergencies", () => {
  for (const message of [
    "What should I do if my home battery starts hissing?",
    "What should I do if the inverter is smoking?",
    "Should I call 000 if my battery is hissing?",
    "If a home battery is hissing, should I call 000?",
    "My battery was hissing. What caused it?",
    "What would cause my battery to start hissing?",
    "Is battery hissing always an emergency?",
    "When should battery hissing be treated as an emergency?",
    "How should a homeowner respond to a hissing battery?",
    "What does a hissing home battery mean?",
    "Would a hissing battery mean it is failing?",
    "What does it mean if an inverter smells burnt?",
    "When would smoke from an inverter require 000?",
    "Why did my inverter spark yesterday?",
    "The switchboard sparked once before being repaired. Why might that happen?",
    "The switchboard was buzzing but it is quiet now. What could cause it?",
    "There was a burning smell from the socket but it is gone now. What should I check?",
    "My battery started hissing but then stopped.",
    "My battery started hissing but it has stopped now.",
    "The socket started sparking but stopped.",
    "There was smoke from the inverter, but it has cleared.",
    "The inverter gave off smoke for a second, but it stopped.",
    "The switchboard began buzzing but is quiet now.",
    "The power point started smelling burnt but the smell is gone.",
    "My gas heater started hissing but stopped.",
    "The battery started hissing then stopped.",
    "The battery has started hissing before, but it is not doing it now.",
    "The inverter gave off smoke then stopped.",
    "The power point smelled burnt but the smell is gone.",
    "Why is the battery in this training video smoking?",
    "Could water get into a switchboard during a flood?",
  ]) {
    assert.equal(composeSurgeSafetyAnswer(message), null, message);
  }
});

test("the public API does not restore a legacy emergency answer for hypothetical or past hazards", async () => {
  for (const message of [
    "What should I do if my home battery starts hissing?",
    "Should I call 000 if my battery is hissing?",
    "If a home battery is hissing, should I call 000?",
    "My battery was hissing. What caused it?",
    "What does a hissing home battery mean?",
    "What does it mean if an inverter smells burnt?",
    "Why did my inverter spark yesterday?",
    "The switchboard sparked once before being repaired. Why might that happen?",
    "The switchboard was buzzing but it is quiet now. What could cause it?",
    "There was a burning smell from the socket but it is gone now. What should I check?",
    "My battery started hissing but then stopped.",
    "The socket started sparking but stopped.",
    "There was smoke from the inverter, but it has cleared.",
    "The inverter gave off smoke for a second, but it stopped.",
    "The switchboard began buzzing but is quiet now.",
    "The power point started smelling burnt but the smell is gone.",
    "My gas heater started hissing but stopped.",
  ]) {
    let reservations = 0;
    const response = await handleEnergyAssistantRequest(request(message), {
      now: () => NOW,
      reserveModelCall: async () => {
        reservations += 1;
        return { allowed: false };
      },
    });
    assert.equal(response.status, 200, message);
    const payload = await response.json();
    assert.equal(reservations, 1, message);
    assert.doesNotMatch(payload.reply.directAnswer, /^(?:move everyone|treat this as a possible battery failure|call 000)/i, message);
    assert.match(payload.reply.directAnswer, /can indicate|if it happened|points to a fault/i, message);
    assert.doesNotMatch(payload.reply.directAnswer, /call 000/i, message);
  }
});

test("000 is reserved for an unmistakable current emergency", () => {
  for (const message of [
    "The switchboard is hot and buzzing. Should I reset it?",
    "The solar DC isolator is sparking. Should I switch it off?",
    "The home battery is swollen, hot and hissing. Should I reset it?",
    "The battery alarm is sounding continuously.",
    "My gas heater is hissing. What should I do?",
    "I am smelling gas right now.",
    "My battery has started to hiss right now.",
    "The power point has water in it right now.",
    "The CO alarm is sounding and I am sick of the beeping.",
  ]) {
    const answer = composeSurgeSafetyAnswer(message);
    assert.ok(answer, message);
    assert.doesNotMatch(answer.directAnswer, /call 000/i, message);
  }

  for (const message of [
    "The home battery is smoking.",
    "The inverter is on fire.",
    "A carbon-monoxide alarm is sounding and someone has a headache.",
    "The CO alarm is going off and my child is drowsy.",
    "The gas heater is on and we are short of breath.",
    "The gas heater is running and two people are vomiting.",
  ]) {
    const answer = composeSurgeSafetyAnswer(message);
    assert.ok(answer, message);
    assert.match(answer.directAnswer, /call 000/i, message);
  }
});

test("burning-hot equipment is a serious fault, not visible fire", () => {
  for (const message of [
    "My inverter is burning hot.",
    "My inverter's burning hot.",
    "The battery is burning hot.",
    "The switchboard feels burning hot.",
    "The switchboard's burning hot.",
    "The dryer is burning hot.",
    "The dryer feels smoking hot.",
    "My air conditioner is smoking hot to touch.",
  ]) {
    const answer = composeSurgeSafetyAnswer(message);
    assert.ok(answer, message);
    assert.match(answer.directAnswer, /leave the equipment unused|contact the installer or manufacturer urgently/i, message);
    assert.doesNotMatch(answer.directAnswer, /call 000|visible smoke or fire|wait outside for firefighters/i, message);
  }

  for (const message of [
    "My inverter's burning.",
    "The switchboard's burning.",
    "The dryer is burning.",
  ]) {
    const answer = composeSurgeSafetyAnswer(message);
    assert.ok(answer, message);
    assert.match(answer.directAnswer, /call 000/i, message);
  }
});

test("natural unmistakable current fire wording keeps the narrow 000 response", () => {
  for (const message of [
    "My garage is full of smoke.",
    "Smoke is filling the hallway.",
    "There are flames in the shed.",
    "The battery is not just smoking, it's on fire.",
    "There isn't just smoke, flames are coming from the battery.",
  ]) {
    const answer = composeSurgeSafetyAnswer(message);
    assert.ok(answer, message);
    assert.match(answer.directAnswer, /call 000/i, message);
  }

  assert.equal(composeSurgeSafetyAnswer("The garage is not full of smoke."), null);
  assert.equal(composeSurgeSafetyAnswer("There are no flames in the shed."), null);
  assert.equal(composeSurgeSafetyAnswer("My garage was full of smoke yesterday."), null);
  assert.equal(composeSurgeSafetyAnswer("My garage was full of smoke, but it has cleared."), null);
});

test("current symptoms can continue only the immediately preceding active gas or CO condition", () => {
  for (const [message, priorUserMessages] of [
    ["We're dizzy and nauseous.", ["The gas heater is running."]],
    ["We're dizzy and nauseous.", ["My gas heater's running."]],
    ["We're dizzy and nauseous.", ["The gas heater is currently running."]],
    ["We're dizzy and nauseous.", ["I have the gas heater on."]],
    ["We both have headaches.", ["The CO alarm is sounding."]],
    ["We both have headaches.", ["Our CO alarm's sounding."]],
    ["We both have headaches.", ["The CO alarm is currently going off."]],
  ]) {
    const answer = composeSurgeSafetyAnswer(message, priorUserMessages);
    assert.ok(answer, message);
    assert.match(answer.directAnswer, /fresh outdoor air/i, message);
    assert.match(answer.directAnswer, /call 000/i, message);
  }

  assert.equal(composeSurgeSafetyAnswer(
    "I have a headache from staring at the bill.",
    ["The gas heater is running."],
  ), null);
  assert.equal(composeSurgeSafetyAnswer(
    "We feel dizzy.",
    ["The CO alarm is sounding.", "The battery was checked yesterday."],
  ), null);
  assert.equal(composeSurgeSafetyAnswer(
    "I feel dizzy.",
    ["Should the gas heater be on?"],
  ), null);
  assert.equal(composeSurgeSafetyAnswer(
    "I feel dizzy.",
    ["Is the CO alarm sounding?"],
  ), null);
  for (const priorMessage of [
    "The gas heater is on sale.",
    "The gas heater is on the quote.",
    "The gas cooktop is on my upgrade list.",
    "The gas heater is on the wall.",
    "The gas heater is on order.",
  ]) {
    assert.equal(composeSurgeSafetyAnswer("I feel dizzy.", [priorMessage]), null, priorMessage);
  }
});

test("the equipment named in the current hypothetical beats stale equipment history", async () => {
  const electrical = composeSurgeNonCurrentHazardAnswer(
    "What should I do if the switchboard starts sparking?",
    ["I have a home battery."],
  );
  assert.ok(electrical);
  assert.match(electrical.directAnswer, /electrical equipment|licensed electrician/i);
  assert.doesNotMatch(electrical.directAnswer, /battery enclosure|cell venting/i);

  const inverter = composeSurgeNonCurrentHazardAnswer(
    "What does it mean if my inverter smells burnt?",
    ["I use a gas heater."],
  );
  assert.ok(inverter);
  assert.match(inverter.directAnswer, /electrical equipment|licensed electrician/i);
  assert.doesNotMatch(inverter.directAnswer, /gas smell|gasfitter/i);

  const response = await handleEnergyAssistantRequest(request(
    "What should I do if the switchboard starts sparking?",
    [{ role: "user", content: "I have a home battery." }],
  ), {
    now: () => NOW,
    reserveModelCall: async () => ({ allowed: false }),
  });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.match(payload.reply.directAnswer, /electrical equipment|licensed electrician/i);
  assert.doesNotMatch(payload.reply.directAnswer, /battery enclosure|cell venting/i);
});

test("normal and hypothetical API answers do not recommend emergency services", async () => {
  for (const message of [
    "My home battery feels mildly warm but has no alarms or other warning signs. Is that normal?",
    "Why does my carbon-monoxide alarm chirp once every minute?",
    "What should I do if a battery ever starts hissing?",
    "The switchboard was buzzing but it is quiet now. What could cause it?",
    "The battery has started hissing before, but it is not doing it now.",
    "Why is the battery in this training video smoking?",
    "Could water get into a switchboard during a flood?",
  ]) {
    const response = await handleEnergyAssistantRequest(request(message), {
      now: () => NOW,
      reserveModelCall: async () => ({ allowed: false }),
    });
    assert.equal(response.status, 200, message);
    const payload = await response.json();
    assert.doesNotMatch(payload.reply.directAnswer, /\b(?:call\s+000|triple zero|emergency services)\b/i, message);
  }
});

test("ordinary model answers cannot introduce emergency-services advice", async () => {
  for (const unsafeAdvice of [
    "Call 000",
    "dial triple-zero (000)",
    "Phone triple-zero",
    "The emergency number is 000",
    "Call 0-0-0",
    "Contact firefighters on 000",
    "If there is an emergency, dial triple-zero (000)",
  ]) {
    const response = await handleEnergyAssistantRequest(request("Would solar suit a small home?"), {
      now: () => NOW,
      reserveModelCall: async () => ({ allowed: true, release: async () => undefined }),
      generateAnswer: async () => ({
        answer: {
          directAnswer: `Solar may suit a small home when daytime use and an unshaded roof support it. ${unsafeAdvice} before asking installers for quotes.`,
          practicalSteps: [],
          nextAction: "",
          status: "answered",
          citations: [],
          assumptions: [],
          confidence: "medium",
          suggestedQuestions: [],
          toolActions: [],
          sourceBoundary: "",
        },
        continuation: {
          version: 1,
          activeTopic: "solar",
          goal: "Check whether solar suits the home",
          facts: [],
          pendingQuestion: "",
          lastAnswerSummary: "Solar suitability depends on daytime use and the roof.",
        },
      }),
    });

    assert.equal(response.status, 200, unsafeAdvice);
    const payload = await response.json();
    assert.match(payload.reply.directAnswer, /solar may suit a small home/i, unsafeAdvice);
    assert.doesNotMatch(
      payload.reply.directAnswer,
      /triple[ -]?zero|0\s*[- ]?\s*0\s*[- ]?\s*0|emergency services|emergency responders|firefighters/i,
      unsafeAdvice,
    );
    assert.match(payload.reply.directAnswer, /urgent professional help|appropriate urgent professional service/i, unsafeAdvice);
    assert.doesNotMatch(payload.reply.directAnswer, /urgent professional help\)|[.!?]\s+get urgent professional help/, unsafeAdvice);
  }
});

test("emergency-advice filtering preserves ordinary prices containing three zeroes", async () => {
  const response = await handleEnergyAssistantRequest(
    request("Compare my $5,000 and $10,000 solar quotes."),
    {
      now: () => NOW,
      reserveModelCall: async () => ({ allowed: true, release: async () => undefined }),
      generateAnswer: async () => ({
        answer: {
          directAnswer: "The $5,000 solar quote is cheaper than the $10,000 quote, but price alone does not show better value. Compare the same system size, exact equipment, installation scope, warranties, exclusions and after-sales support before choosing.",
          practicalSteps: [],
          nextAction: "",
          status: "answered",
          citations: [],
          assumptions: [],
          confidence: "medium",
          suggestedQuestions: [],
          toolActions: [],
          sourceBoundary: "",
        },
        continuation: {
          version: 1,
          activeTopic: "solar",
          goal: "Compare two supplied solar quotes",
          facts: [],
          pendingQuestion: "",
          lastAnswerSummary: "Compare the full quote scope, not price alone.",
        },
      }),
    },
  );

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.match(payload.reply.directAnswer, /\$5,000/);
  assert.match(payload.reply.directAnswer, /\$10,000/);
  assert.doesNotMatch(payload.reply.directAnswer, /urgent professional service/i);
});

test("ordinary controlled cooking and fireplace smoke never triggers a 000 response", async () => {
  for (const message of [
    "My toast is smoking in the toaster now.",
    "There is smoke from burnt toast now.",
    "The oven is smoking because food spilled on the bottom.",
    "The barbecue is smoking outside.",
    "I can see smoke from a candle now.",
    "I smell smoke from the fireplace.",
  ]) {
    const direct = composeSurgeSafetyAnswer(message);
    assert.ok(direct, message);
    assert.match(direct.directAnswer, /heat source.*ventilate.*smoke clears/i, message);
    assert.doesNotMatch(direct.directAnswer, /call 000|emergency services/i, message);

    const response = await handleEnergyAssistantRequest(request(message), {
      now: () => NOW,
      reserveModelCall: async () => ({ allowed: false }),
    });
    assert.equal(response.status, 200, message);
    const payload = await response.json();
    assert.doesNotMatch(payload.reply.directAnswer, /call 000|emergency services/i, message);
  }
});

test("an active refrigerant symptom combination keeps the protective response", () => {
  const answer = composeSurgeSafetyAnswer("My aircon has oily fluid at the line and is hissing.");
  assert.ok(answer);
  assert.match(answer.directAnswer, /stop using the system/i);
  assert.match(answer.directAnswer, /licensed refrigeration technician/i);
});

test("a possessive active hazard phrased as a question is not treated as generic education", () => {
  const answer = composeSurgeSafetyAnswer("Could the burning smell from my inverter be dangerous?");
  assert.ok(answer);
  assert.match(answer.directAnswer, /leave the equipment unused/i);
});

test("plain active-smoke wording still receives an emergency answer", () => {
  for (const message of [
    "There is smoke coming from the wall.",
    "I can see smoke rising beside the inverter.",
    "Smoke is not stopping near the switchboard.",
    "The battery is burning.",
    "My home battery is giving off smoke.",
    "The battery is venting smoke.",
    "The inverter is burning.",
    "The inverter is emitting smoke.",
    "The EV charger is burning.",
    "My powerboard is smoking.",
    "My toaster is smoking.",
    "The dishwasher is smoking.",
    "The air conditioner is burning.",
    "The heat pump is burning.",
    "My solar isolator is burning.",
  ]) {
    const answer = composeSurgeSafetyAnswer(message);
    assert.ok(answer, message);
    assert.match(answer.directAnswer, /call 000/i, message);
  }
});

test("explicit uncontrolled fires receive the narrow deterministic 000 response", () => {
  for (const message of [
    "The barbecue fire is spreading to the house.",
    "The candle has set the curtain on fire.",
    "There is uncontrolled fire in the kitchen.",
    "The frying pan is on fire now.",
    "There is a grease fire on the stove.",
    "Flames are spreading into the rangehood.",
    "The electric blanket has caught fire.",
    "The clothes dryer is on fire.",
    "The curtains are burning now.",
    "Flames are spreading across the carpet.",
    "The couch is on fire.",
    "There are flames in the bedroom.",
    "Fire is spreading through the kitchen.",
    "There is a fire in the switchboard.",
    "The wall behind the power point is burning.",
  ]) {
    const answer = composeSurgeSafetyAnswer(message);
    assert.ok(answer, message);
    assert.match(answer.directAnswer, /call 000/i, message);
  }
});

test("uncertainty wording does not negate a real smoke hazard", () => {
  const answer = composeSurgeSafetyAnswer("I have no idea why my gas heater is smoking.");
  assert.ok(answer);
  assert.match(answer.directAnswer, /fresh outdoor air/i);
});

test("an unrelated if-question cannot inherit an old equipment hazard", () => {
  const message = "Unrelated: can you tell me if my scone recipe needs more flour?";
  assert.equal(composeSurgeSafetyAnswer(message, ["My old gas heater was hissing."]), null);
  assert.equal(composeSurgeNonCurrentHazardAnswer(message, ["My old gas heater was hissing."]), null);
});

test("unresolved gas and electrical incidents keep immediate follow-ups deterministic", () => {
  const gas = composeSurgeSafetyAnswer(
    "Can I relight the heater once the smell fades?",
    ["I smell gas near the heater and I have a headache. What should I do right now?"],
  );
  assert.ok(gas);
  assert.match(gas.directAnswer, /^No\./i);
  assert.match(gas.directAnswer, /do not relight[\s\S]*licensed gasfitter[\s\S]*safe/i);

  const electricalHistory = [
    "The switchboard is crackling and I can smell burning. What should I do?",
  ];
  const reset = composeSurgeSafetyAnswer(
    "Should I reset the main breaker to see if it stops?",
    electricalHistory,
  );
  assert.ok(reset);
  assert.match(reset.directAnswer, /^No\./i);
  assert.match(reset.directAnswer, /do not reset[\s\S]*(?:electricity network|licensed electrician)/i);

  const solar = composeSurgeSafetyAnswer(
    "Does this mean the solar quote I was considering is a bad idea?",
    [...electricalHistory, "Should I reset the main breaker to see if it stops?"],
  );
  assert.ok(solar);
  assert.match(solar.directAnswer, /^First,[\s\S]*make the fault safe/i);
  assert.match(solar.directAnswer, /does not by itself mean the solar quote is a bad idea/i);
});

test("a crackling switchboard with a burning smell gets the specific electrical-emergency boundary", async () => {
  const message = "The switchboard is crackling and I can smell burning. What should I do?";
  const answer = composeSurgeSafetyAnswer(message);

  assert.ok(answer);
  assert.match(answer.directAnswer, /crackling or a burning smell[^.]*urgent electrical fault/i);
  assert.match(answer.directAnswer, /keep away[^.]*leave the area if it is safe/i);
  assert.match(answer.directAnswer, /do not touch, open or reset the switchboard/i);
  assert.match(answer.directAnswer, /smoke, flame, fire or immediate danger[^.]*call 000/i);
  assert.match(answer.directAnswer, /otherwise[^.]*electricity distributor[^.]*urgent licensed electrician/i);
  assert.doesNotMatch(answer.directAnswer, /\b(?:water|dry|drying)\b/i);

  const response = await handleEnergyAssistantRequest(request(message), {
    now: () => NOW,
    reserveModelCall: async () => ({ allowed: false }),
  });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.reply.directAnswer, answer.directAnswer);
});

test("qualified safe clearance stops an old incident from controlling later decisions", () => {
  assert.equal(composeSurgeSafetyAnswer(
    "Does this mean the solar quote I was considering is a bad idea?",
    [
      "The switchboard was crackling and I could smell burning.",
      "A licensed electrician inspected it and confirmed it is safe.",
    ],
  ), null);
  assert.equal(composeSurgeSafetyAnswer(
    "Can I relight the heater?",
    [
      "There was a gas smell near the heater.",
      "A licensed gasfitter checked it and confirmed it is safe.",
    ],
  ), null);
});
