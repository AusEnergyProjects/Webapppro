import {
  isThreePhaseSupplyUpgradeQuestion,
  type EnergyAssistantAnswer,
} from "./energy-assistant.ts";
import type { SurgePlanContext } from "./energy-assistant-plan-context.ts";
import { isSurgeContextDependentMessage } from "./energy-assistant-conversation.ts";

type RecentTurn = {
  role: "user" | "assistant";
  content: string;
};

type SimpleAnswer = {
  directAnswer: string;
  practicalSteps: string[];
  suggestedQuestion?: string;
  confidence?: EnergyAssistantAnswer["confidence"];
};

function conversationText(message: string, recentTurns: readonly RecentTurn[]) {
  const priorUserText = recentTurns
    .filter((turn) => turn.role === "user")
    .slice(-5)
    .map((turn) => turn.content)
    .join("\n");
  const needsPriorTopic = isSurgeContextDependentMessage(message);
  return needsPriorTopic && priorUserText ? `${priorUserText}\n${message}` : message;
}

function planFact(context: SurgePlanContext | null, key: string) {
  return context?.facts.find((fact) => fact.key === key)?.value || "";
}

function answer(base: EnergyAssistantAnswer, value: SimpleAnswer): EnergyAssistantAnswer {
  return {
    ...base,
    directAnswer: value.directAnswer,
    practicalSteps: value.practicalSteps.slice(0, 3),
    nextAction: value.practicalSteps[0] || "",
    status: value.suggestedQuestion ? "needs_context" : "answered",
    citations: [],
    assumptions: ["This is general guidance based on the home and conversation details supplied so far."],
    confidence: value.confidence || "medium",
    suggestedQuestions: value.suggestedQuestion ? [value.suggestedQuestion] : [],
    toolActions: [],
    sourceBoundary: "Current prices, rebates, eligibility and exact product claims need current official or customer-supplied evidence.",
  };
}

function quoteAnswer(base: EnergyAssistantAnswer, text: string) {
  const mentionsComparedPrices = /\$\s*\d|cheaper|dearer|expensive|price|cost/i.test(text);
  return answer(base, {
    directAnswer: mentionsComparedPrices
      ? "I cannot call the cheaper quote better from price alone. It is good value only if it covers the same job, suitable equipment and warranty without important exclusions."
      : "Yes, I can check whether the quote looks fair and complete. I need the quote or its main details before I can give you an honest verdict.",
    practicalSteps: [
      "Check the final amount after rebates or certificate discounts.",
      "Compare the exact model, size and everything included in installation.",
      "Check exclusions, electrical work, warranty and who handles problems after installation.",
    ],
    suggestedQuestion: "Can you attach the quote, or type its total price and exact model?",
  });
}

/**
 * Covers common, conversational household questions when the model is unavailable.
 * It deliberately leaves detailed programme, calculation and safety questions to the
 * governed energy-assistant engine.
 */
export function composeSurgeSimpleAnswer(
  message: string,
  base: EnergyAssistantAnswer,
  context: SurgePlanContext | null,
  recentTurns: readonly RecentTurn[] = [],
): EnergyAssistantAnswer | null {
  const text = conversationText(message, recentTurns);
  const solar = planFact(context, "solar");
  const tenure = planFact(context, "tenure");
  const heating = planFact(context, "heating_cooling_systems");

  if (isThreePhaseSupplyUpgradeQuestion(text)) return null;

  if (/\b(?:quotes?|quoted|quotation|proposal|invoice|cheaper one|expensive one|dearer one)\b/i.test(text)) {
    return quoteAnswer(base, text);
  }

  if (/\b(?:power|electricity|energy) bill\b.*\b(?:high|huge|expensive|reduce|lower|save)\b|\b(?:reduce|lower|cut)\b.*\b(?:power|electricity|energy) bills?\b/i.test(text)) {
    return answer(base, {
      directAnswer: "Start by finding what is using the most electricity. Do not buy equipment until you know whether the main cost is heating and cooling, hot water, a pool, an EV, or the electricity plan itself.",
      practicalSteps: [
        "Compare electricity use in kWh with the same period last year, not just the dollar total.",
        "Check the daily supply charge and when higher usage rates apply.",
        "Test the biggest appliance or system first instead of chasing small standby loads.",
      ],
      suggestedQuestion: "Which is your biggest concern: a sudden bill jump, high winter use, high summer use, or high use all year?",
    });
  }

  if (/\b(?:battery|home storage)\b/i.test(text) && /\b(?:worth|should|buy|good value|make sense|pay back|payback)\b/i.test(text)) {
    const noSolar = /no (?:rooftop )?solar/i.test(solar);
    return answer(base, {
      directAnswer: noSolar
        ? "No, a home battery is unlikely to be your best first step while you have no rooftop solar. Reduce the home's main energy costs and assess solar first."
        : "Maybe, but a battery is usually worthwhile only when you regularly export spare solar and then buy a lot of electricity after sunset. A rebate can improve the numbers, but it does not make every battery good value.",
      practicalSteps: noSolar ? [
        "Find the home's biggest electricity costs first.",
        "Check whether suitable rooftop solar is possible.",
        "Revisit a battery after you know likely solar exports and evening use.",
      ] : [
        "Check how many kWh of solar you export on a typical day.",
        "Compare that with evening and overnight electricity use.",
        "Price backup power separately because it may add cost.",
      ],
      suggestedQuestion: noSolar ? "Do you want help checking whether solar suits the property?" : "How much solar do you export on a typical day?",
    });
  }

  if (/\b(?:condensation|water on (?:the )?(?:glass|windows?)|wet windows?|mould|mold)\b/i.test(text)) {
    return answer(base, {
      directAnswer: "Start with moisture, not replacement windows. Condensation forms when damp indoor air hits cold glass, so reduce the moisture first and then make the window surface warmer.",
      practicalSteps: [
        "Run bathroom and kitchen exhaust fans while moisture is being made and briefly air the room.",
        "Wipe up water and investigate leaks or persistent mould.",
        "Use close-fitting honeycomb blinds or thermal curtains, but allow the window area to dry.",
      ],
      suggestedQuestion: "Is it mainly in the bedroom, bathroom, kitchen, or several rooms?",
    });
  }

  if (/\b(?:bedroom|lounge|room|house|home)\b.*\b(?:freez\w*|very cold|too cold|hard to heat|won't warm|wont warm)\b|\b(?:freez\w*|very cold|too cold|hard to heat)\b.*\b(?:bedroom|lounge|room|house|home)\b/i.test(text)) {
    return answer(base, {
      directAnswer: "For better comfort, start with draughts and the coldest windows before buying a bigger heater. If warm air is escaping or the glass is very cold, a larger heater will still waste energy.",
      practicalSteps: [
        "Feel around opening windows and doors for moving air, then seal only confirmed gaps.",
        "Use close-fitting honeycomb blinds or thermal curtains with a pelmet where practical.",
        "Clean the heater filter and heat the occupied room with doors to unused areas closed.",
      ],
      suggestedQuestion: "Does the room feel draughty, have very cold windows, or both?",
    });
  }

  if (/\b(?:bedroom|lounge|room|house|home)\b.*\b(?:too hot|overheat\w*|boiling|hot in summer)\b|\b(?:too hot|overheat\w*|boiling|hot in summer)\b.*\b(?:bedroom|lounge|room|house|home)\b/i.test(text)) {
    return answer(base, {
      directAnswer: "Stop summer sun reaching the glass before buying more cooling. Outside shade usually works better than trying to block the heat after it has entered the room.",
      practicalSteps: [
        "Shade sun-exposed windows outside with an awning, blind or suitable planting where allowed.",
        "Close honeycomb blinds or lined curtains before the room heats up.",
        "Use fans first, then run efficient air conditioning with doors and windows closed.",
      ],
      suggestedQuestion: "Is the room hottest in the morning, afternoon, or all day?",
    });
  }

  if (/\b(?:replace|remove|swap|change|keep)\b.*\b(?:gas heater|ducted gas|gas heating)\b|\b(?:gas heater|ducted gas|gas heating)\b.*\b(?:worth|replace|remove|swap|change|keep)\b/i.test(text)) {
    return answer(base, {
      directAnswer: "Usually, plan to replace an ageing gas heater with efficient reverse-cycle air conditioning, especially if the gas unit is costly, unreliable or nearing replacement. You do not need to remove a safe working heater immediately if the numbers do not yet stack up.",
      practicalSteps: [
        "Compare current gas use with the likely electricity cost of heating the rooms you actually use.",
        "Get the new system sized for those rooms, not just the floor area.",
        "Include electrical work, gas disconnection, noise and the final installed price.",
      ],
      suggestedQuestion: heating ? "Is the gas heater old, unreliable, or simply expensive to run?" : "What type of gas heater do you have now?",
    });
  }

  if (/\b(?:what size|how big|size should)\b.*\bsolar\b|\bsolar\b.*\b(?:what size|how big|size should)\b/i.test(text)) {
    return answer(base, {
      directAnswer: "Size solar from your electricity use, usable roof space and the local export limit. A bigger system can be sensible, but only if the extra generation will be used or exported for enough value."
        + (/no (?:rooftop )?solar/i.test(solar) ? " Your saved details show no rooftop solar now, so this would be a new system." : ""),
      practicalSteps: [
        "Use a full year of electricity bills or half-hourly usage if available.",
        "Check shade, roof direction, roof condition and the network export limit.",
        "Compare annual generation and savings assumptions, not panel count alone.",
      ],
      suggestedQuestion: "Roughly how many kWh of electricity does the home use in a year?",
    });
  }

  if (/\b(?:double glaz\w*|replace (?:my |the )?windows?|new windows?|window upgrade)\b/i.test(text)) {
    return answer(base, {
      directAnswer: "Do not jump straight to replacing every window. First fix confirmed draughts and improve window coverings; replacement glazing makes the most sense when windows are leaky, damaged, very cold or already due for replacement.",
      practicalSteps: [
        "Seal moving gaps around opening sections without blocking drainage or required ventilation.",
        "Try close-fitting honeycomb blinds or thermal curtains with pelmets.",
        "For replacement quotes, compare whole-window U-value, frame type, installation and warranty.",
      ],
      suggestedQuestion: "Is the main problem draughts, cold glass, summer sun, or outside noise?",
    });
  }

  if (/\b(?:insulat\w*|ceiling batts?|roof batts?)\b/i.test(text) && /\b(?:should|where|start|worth|upgrade|replace|add|need)\b/i.test(text)) {
    return answer(base, {
      directAnswer: "Ceiling insulation is often the first insulation upgrade to check because heat rises in winter and the roof gets very hot in summer. Repairing safe, confirmed gaps can matter as much as adding more insulation everywhere.",
      practicalSteps: [
        "Confirm what insulation is already there, its condition and whether there are gaps.",
        "Fix roof leaks and moisture before adding insulation.",
        "Use a qualified person where electrical wiring, downlights or difficult roof access create risk.",
      ],
      suggestedQuestion: "Do you know whether the ceiling already has insulation?",
    });
  }

  if (/\b(?:heat pump hot water|hot water heat pump|replace (?:my |the )?(?:gas|electric) hot water|hot water system)\b/i.test(text)) {
    return answer(base, {
      directAnswer: "A well-sized heat-pump hot-water system is often a strong replacement for gas or standard electric hot water, especially if it can run during sunny or cheaper electricity hours. The wrong size or location can still make it noisy or expensive.",
      practicalSteps: [
        "Size the tank for the household and when people shower.",
        "Check outdoor-unit location, noise, drainage and electrical work.",
        "Compare the final installed price after any rebate or certificate discount.",
      ],
      suggestedQuestion: "How many people use hot water in the home?",
    });
  }

  if (/\b(?:ev charger|charge (?:my |an? )?(?:ev|electric car)|home charging)\b/i.test(text)) {
    return answer(base, {
      directAnswer: "Start with how far you drive and how long the car is parked at home. Many drivers can refill overnight from a modest charger, so the fastest charger is not automatically the best choice.",
      practicalSteps: [
        "Work out the usual daily kilometres and the car's battery use.",
        "Ask an electrician to check the switchboard, supply capacity and cable route.",
        "Use solar or cheaper overnight rates where the car and tariff allow it.",
      ],
      suggestedQuestion: "About how many kilometres do you drive on a normal day?",
    });
  }

  if (/\b(?:rent|renter|tenant)\b/i.test(text) && /\b(?:what can|can i|options|do|upgrade|save|comfort)\b/i.test(text)) {
    return answer(base, {
      directAnswer: "As a renter, start with changes you can take with you and ask the owner in writing before any fixed work. You can still make a noticeable difference to comfort and bills.",
      practicalSteps: [
        "Use a door snake, removable window seals and close-fitting curtains where allowed.",
        "Use efficient portable or existing reverse-cycle heating and cooling only in occupied rooms.",
        "Report leaks, broken exhaust fans, unsafe heaters and serious mould to the owner or agent.",
      ],
      suggestedQuestion: tenure && /rent|tenant/i.test(tenure) ? "What is the main problem: bills, cold, heat, or condensation?" : "Are you renting the whole home or one room?",
    });
  }

  if (/\b(?:where|how) (?:do|should|can) i (?:start|begin)\b|\bwhat (?:should i do|comes) first\b/i.test(message)) {
    return answer(base, {
      directAnswer: "Start with the problem that is costing you the most or making the home hardest to live in. Fix obvious safety, leaks and moisture first, then tackle comfort and large energy users before buying solar or a battery.",
      practicalSteps: [
        "Choose the main problem: high bills, cold rooms, hot rooms or condensation.",
        "Check the simplest likely cause before replacing equipment.",
        "Use the result to choose the first upgrade and avoid wasting money.",
      ],
      suggestedQuestion: "What bothers you most right now: bills, cold rooms, hot rooms, or condensation?",
    });
  }

  return null;
}
