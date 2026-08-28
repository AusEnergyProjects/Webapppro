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
  directDelivery?: boolean;
};

const SURGE_QUESTION_INTENT_RULES: ReadonlyArray<{
  question: RegExp;
  answer: RegExp;
}> = [
  {
    question: /\b(?:draughts?|drafts?|air leaks?|weather seals?|door snakes?)\b/i,
    answer: /\b(?:draughts?|drafts?|air leaks?|moving air|gaps?|seals?|weather strips?|door snakes?)\b/i,
  },
  {
    question: /\b(?:honeycomb blinds?|cellular blinds?|thermal curtains?|pelmets?)\b/i,
    answer: /\b(?:honeycomb|cellular|blinds?|curtains?|pelmets?|window coverings?)\b/i,
  },
  {
    question: /\blow[- ]?e\b/i,
    answer: /\b(?:low[- ]?e|coating|glass|glazing|surface)\b/i,
  },
  {
    question: /\b(?:abolish(?:ment)?|disconnect(?:ion)?|remove|lock|plug)\b[^.!?\n]{0,80}\b(?:gas|meter|connection|service)\b|\b(?:gas|meter|connection|service)\b[^.!?\n]{0,80}\b(?:abolish(?:ment)?|disconnect(?:ion)?|remove|lock|plug)\b/i,
    answer: /\b(?:gas|meter|connection|service)\b/i,
  },
  {
    question: /\b(?:heat[- ]?pump hot[- ]?water|hot[- ]?water heat[- ]?pump|hot[- ]?water system|water heater)\b/i,
    answer: /\b(?:heat[- ]?pump|hot[- ]?water|tank|water heater)\b/i,
  },
  {
    question: /\b(?:flat[- ]?rate|single[- ]?rate|retailer|electricity plan|energy plan|tariffs?|feed[- ]?in|free hours?)\b/i,
    answer: /\b(?:flat[- ]?rate|single[- ]?rate|retailer|electricity plan|energy plan|tariffs?|rates?|bill|free hours?|supply charge|export)\b/i,
  },
  {
    question: /\b(?:price|cost|quote|payback)\b[^.!?\n]{0,80}\bbatter(?:y|ies)\b|\bbatter(?:y|ies)\b[^.!?\n]{0,80}\b(?:price|cost|quote|payback)\b/i,
    answer: /\b(?:batter(?:y|ies)|storage)\b/i,
  },
  {
    question: /\b(?:solar panels?|panels?)\b[^.!?\n]{0,100}\b(?:outdated|obsolete|replace|fault|poor output)\b|\b(?:outdated|obsolete|replace)\b[^.!?\n]{0,100}\b(?:solar panels?|panels?)\b/i,
    answer: /\b(?:solar|panels?|inverter|roof|generation|export)\b/i,
  },
  {
    question: /\b(?:condensation|mould|mold|humidity)\b/i,
    answer: /\b(?:condensation|mould|mold|moisture|humidity|damp)\b/i,
  },
  {
    question: /\b(?:insulation|batts?)\b/i,
    answer: /\b(?:insulation|batts?|ceiling|roof)\b/i,
  },
  {
    question: /\b(?:ducted|split systems?|air conditioners?|reverse[- ]?cycle)\b/i,
    answer: /\b(?:ducted|split systems?|air conditioners?|reverse[- ]?cycle|heating|cooling|airflow|installer)\b/i,
  },
  {
    question: /\b(?:induction|cooktops?)\b/i,
    answer: /\b(?:induction|cooktops?|circuit|electrician|cooking)\b/i,
  },
  {
    question: /\b(?:EV chargers?|electric vehicle chargers?|charge (?:my |an? )?(?:EV|electric car))\b/i,
    answer: /\b(?:EV|electric vehicle|charger|charging|vehicle)\b/i,
  },
] as const;

/**
 * Rejects answers that drift into a different home-energy category. The rules
 * intentionally cover broad household decisions rather than individual test
 * phrases, and every recognised material topic in a multi-part question must
 * remain visible in the answer.
 */
export function surgeAnswerMatchesQuestionIntent(message: string, answerText: string) {
  const relevantRules = SURGE_QUESTION_INTENT_RULES.filter(({ question }) => question.test(message));
  return relevantRules.every(({ answer: expected }) => expected.test(answerText));
}

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
  const result: EnergyAssistantAnswer = {
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
  if (value.directDelivery) {
    Object.defineProperty(result, "_surgeDirectDelivery", { value: true });
  }
  return result;
}

export function surgeSimpleAnswerNeedsDirectDelivery(value: EnergyAssistantAnswer | null) {
  return Boolean((value as (EnergyAssistantAnswer & { _surgeDirectDelivery?: boolean }) | null)?._surgeDirectDelivery);
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
  const priorUserText = recentTurns
    .filter((turn) => turn.role === "user")
    .slice(-5)
    .map((turn) => turn.content)
    .join("\n");

  if (/\b(?:only|just|mainly)?\s*(?:happens?|noticeable)?\s*(?:when|while|on)?\s*(?:it(?:'s| is)\s*)?(?:windy|the wind(?: is blowing)?)\b/i.test(message)
    && /\b(?:draughts?|drafts?|air leaks?)\b/i.test(priorUserText)) {
    return answer(base, {
      directAnswer: "That strongly points to an air leak rather than just cold glass. On the next windy day, feel around the opening window, frame and bedroom door to find the moving air. Use a removable weather seal on an opening gap or a door snake under the door; use suitable sealant only on a fixed crack, and keep required vents open.",
      practicalSteps: [],
    });
  }

  if (/\bshould i call (?:the |my )?installer\b/i.test(message)
    && /\b(?:ducted|reverse[- ]?cycle|air conditioner|air con)\b[\s\S]{0,120}\b(?:noisy|blows? hard|airflow)\b|\b(?:noisy|blows? hard|airflow)\b[\s\S]{0,120}\b(?:ducted|reverse[- ]?cycle|air conditioner|air con)\b/i.test(priorUserText)) {
    return answer(base, {
      directAnswer: "Yes. First confirm it is in heating mode, set it around 20 to 21°C, use a low or auto fan setting and open the normal outlets or zones. If it is still excessively noisy or blowing too hard, ask the installer to return and check the airflow, duct sizes, zone balance and temperature-sensor setup.",
      practicalSteps: [],
      directDelivery: true,
    });
  }

  const text = conversationText(message, recentTurns);
  const solar = planFact(context, "solar");
  const tenure = planFact(context, "tenure");
  const heating = planFact(context, "heating_cooling_systems");

  const alreadyHasThreePhaseForEv = /\b(?:have|has|already (?:have|has))\s+three[- ]?phase\b/i.test(text)
    && /\bEV charger\b/i.test(text);
  if (isThreePhaseSupplyUpgradeQuestion(text) && !alreadyHasThreePhaseForEv) return null;

  if (/\b(?:draughts?|drafts?|air leaks?)\b/i.test(text)) {
    return answer(base, {
      directAnswer: "Start by sealing the gaps that are actually letting air into the room. Check around opening windows, the door and obvious fixed cracks on a windy day. Use removable weather seals or a door snake, and suitable sealant only on fixed gaps. Do not block exhausts or required vents. If the glass feels cold but no air is moving, close-fitting honeycomb blinds or thermal curtains will help more than extra sealing.",
      practicalSteps: [],
    });
  }

  if (/\b(?:import|buy)\b[\s\S]{0,100}\b(?:export|send)\b[\s\S]{0,160}\b(?:battery|storage)\b|\b(?:battery|storage)\b[\s\S]{0,160}\b(?:import|buy)\b[\s\S]{0,100}\b(?:export|send)\b/i.test(text)
    && /\b(?:worth|save enough|payback|pay back)\b/i.test(text)) {
    const yearlyBill = text.match(/\$\s*([\d,]+(?:\.\d{1,2})?)\s*(?:a|per|each)?\s*year/i)?.[1];
    const billLabel = yearlyBill ? `$${Number(yearlyBill.replace(/,/g, "")).toLocaleString("en-AU")}` : "the annual grid bill";
    return answer(base, {
      directAnswer: `Probably not on bill savings alone unless the battery is unusually cheap. With only about ${billLabel} a year currently paid for grid electricity, ${billLabel} is close to the absolute yearly saving ceiling before allowing for the supply charge, battery losses and electricity that would still be imported. Compare the installed battery price with a conservative yearly saving and require the payback to fit comfortably inside the warranted life; value backup separately if you want it.`,
      practicalSteps: [],
      directDelivery: true,
    });
  }

  if (/\b(?:battery|storage)\b/i.test(text)
    && /\b(?:finance|financed|repay|repayment|paid? off|interest[- ]?free|over\s+\w+\s+years?)\b/i.test(text)
    && /\bsolar\b/i.test(text)) {
    const total = text.match(/\$\s*([\d,]+(?:\.\d{1,2})?)/)?.[1];
    const solarSize = text.match(/\b(\d+(?:\.\d+)?)\s*kW\b/i)?.[1];
    const batterySize = text.match(/\b(\d+(?:\.\d+)?)\s*kWh\s+battery\b/i)?.[1]
      || text.match(/\bbattery\b[^.!?\n]{0,30}\b(\d+(?:\.\d+)?)\s*kWh\b/i)?.[1];
    return answer(base, {
      directAnswer: `${total ? `$${Number(total.replace(/,/g, "")).toLocaleString("en-AU")}` : "That price"} may be reasonable or poor; the finance and sizing decide it. ${solarSize ? `${solarSize} kW of solar` : "The solar system"} is much larger than ${batterySize ? `an ${batterySize} kWh battery` : "the quoted battery"}, so confirm the roof layout, export limit and expected self-use. Compare the cash price with the total of every repayment including interest and fees, then compare that total with conservative yearly bill savings and the battery warranty. A seven-year payment term is not proof of a seven-year payback.`,
      practicalSteps: [],
      directDelivery: true,
    });
  }

  if (/\b(?:heat[- ]?pump|hot[- ]?water)\b/i.test(text)
    && /\$\s*[\d,]+/i.test(text)
    && /\$\s*\d+(?:\.\d{1,2})?\s*(?:a|per)\s*month\b/i.test(text)
    && /\b\w+\s+years?\b/i.test(text)) {
    const prices = [...text.matchAll(/\$\s*([\d,]+(?:\.\d{1,2})?)/gi)].map((match) => Number(match[1].replace(/,/g, "")));
    const monthly = Number(text.match(/\$\s*(\d+(?:\.\d{1,2})?)\s*(?:a|per)\s*month/i)?.[1] || 0);
    const yearWord = text.match(/\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+years?\b/i)?.[1]?.toLowerCase();
    const wordYears: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
    const years = yearWord ? (Number(yearWord) || wordYears[yearWord] || 0) : 0;
    const repayments = monthly && years ? monthly * 12 * years : 0;
    const quotedTotal = Math.max(...prices, 0);
    return answer(base, {
      directAnswer: `${monthly && years ? `$${monthly.toLocaleString("en-AU")} a month for ${years} years totals $${repayments.toLocaleString("en-AU")}` : "The repayment total must be calculated"}${quotedTotal ? `, which does not equal the quoted $${quotedTotal.toLocaleString("en-AU")}` : ""}, so the finance or rebate explanation is incomplete. Ask for the cash price, total financed amount, every fee and the certificate or rebate deduction in one written breakdown. Check the claimed gas saving against actual gas used for hot water, and include any gas supply charge only if removing hot water lets you disconnect gas completely.`,
      practicalSteps: [],
      directDelivery: true,
    });
  }

  if (/\b(?:heat[- ]?pump|hot[- ]?water)\b/i.test(text)
    && /\b(?:same|looks? like the same)\b[^.!?\n]{0,80}\b(?:unit|model|product)\b/i.test(text)
    && /\$\s*[\d,]+[\s\S]{0,80}\$\s*[\d,]+/i.test(text)) {
    return answer(base, {
      directAnswer: "A large price spread for the same heat-pump hot-water unit usually means the scopes are not actually the same. Compare an itemised final price after rebates or certificates, tank and model, removal of the old system, plumbing, valves, drainage, electrical circuit, switchboard work, access, permits, commissioning and disposal. Also compare workmanship warranty, manufacturer warranty, local parts and after-sales service. The cheapest quote is only cheaper if all of that is genuinely equivalent.",
      practicalSteps: [],
      directDelivery: true,
    });
  }

  if (/\b(?:ducted|reverse[- ]?cycle|air conditioner|air con)\b/i.test(text)
    && /\b(?:blows? (?:very )?hard|airflow noise|noisy|noise)\b/i.test(text)) {
    return answer(base, {
      directAnswer: "It is worth checking, and the 16°C setting is the first clue. Confirm the system is in heating mode, set it around 20 to 21°C, use low or auto fan and open the normal outlets or zones; closing too many outlets can make airflow noisy. If it still blows excessively hard or the outdoor unit runs constantly, call the installer and ask them to check the airflow, duct sizing, zone balance and sensor location.",
      practicalSteps: [],
      directDelivery: true,
    });
  }

  if (/\b(?:ducted|reverse[- ]?cycle|air conditioner|air con)\b/i.test(text)
    && /\b(?:only raises?|barely raises?|won't heat|wont heat|not heating|struggl\w* to (?:reach|heat))\b/i.test(text)) {
    return answer(base, {
      directAnswer: "No, do not accept that as normal for a newly installed system without measured commissioning evidence. Ask the installer for the return-air and supply-air temperatures, airflow at the outlets, active-zone setup, refrigerant and defrost checks, and evidence that the unit and ducts match the design. Send a written performance complaint and request the commissioning report and corrective visit rather than buying another heater.",
      practicalSteps: [],
      directDelivery: true,
    });
  }

  if (/\b(?:ducted|reverse[- ]?cycle)\b/i.test(text)
    && /\b(?:separate|individual|multiple)\s+split systems?\b|\bsplit systems?\b[\s\S]{0,60}\bducted\b/i.test(text)) {
    return answer(base, {
      directAnswer: "For a home that mainly uses three rooms, separate split systems are usually the cheaper and more efficient choice because you heat or cool only those rooms and avoid duct losses. Electric ducted reverse cycle is neater and can condition the whole home, but it costs more, loses energy through ducts and can be inefficient when only a small zone is open. Choose ducted for genuine whole-home use; choose splits for room-by-room use and lower running cost.",
      practicalSteps: [],
      directDelivery: true,
    });
  }

  if (/\b(?:induction|cooktop)\b/i.test(text)
    && /\b20\s*(?:amp|a)\b/i.test(text)
    && /\b(?:share|same|existing)\b[\s\S]{0,80}\b(?:oven|circuit)\b/i.test(text)) {
    return answer(base, {
      directAnswer: "No—not as an ordinary unrestricted 7.4 kW cooktop sharing a 20 A oven circuit. It will usually need a dedicated circuit sized for the appliance, or a manufacturer-approved load-limited setting that a licensed electrician confirms is suitable. The electrician must check the cooktop instructions, oven load, cable, breaker, switchboard capacity and the difficult cable route before choosing the safe option.",
      practicalSteps: [],
      confidence: "high",
      directDelivery: true,
    });
  }

  if (/\binduction\b/i.test(text)
    && /\b(?:gas|too much power|efficient)\b/i.test(text)
    && /\b(?:electrician|sparky|told|said|claim)\b/i.test(text)) {
    return answer(base, {
      directAnswer: "No, that claim is not right. Induction cooking is generally more efficient at transferring energy into the pan than gas and puts less waste heat and combustion pollution into the kitchen. A high-power cooktop may still need a suitable dedicated circuit or a load-limited setting, so the electrical capacity must be checked; that wiring question does not make gas the more efficient cooking technology.",
      practicalSteps: [],
      directDelivery: true,
    });
  }

  if (/\b(?:do not|don't|dont|no)\s+suggest\s+(?:a\s+)?dehumidifier\b/i.test(text)
    && /\b(?:condensation|window|glass|surface)\b/i.test(text)) {
    return answer(base, {
      directAnswer: "To warm the room-side glass, start with a close-fitting honeycomb blind or thermal curtain with a pelmet while leaving enough drying space at the edges. Secondary glazing can lift the inside surface temperature more, and full double glazing with a thermally improved frame goes further. Check cold aluminium frames, spacers and installation edges because those thermal bridges can remain the first place condensation forms even after the glass improves.",
      practicalSteps: [],
      directDelivery: true,
    });
  }

  if (/\bdouble[- ]?glaz\w*\b/i.test(text)
    && /\bcondensation\b/i.test(text)
    && /\b(?:room side|inside|indoors?)\b/i.test(text)) {
    return answer(base, {
      directAnswer: "Not necessarily. Condensation on the room-side surface means indoor humidity has met glass that is still below the dew point; it does not automatically mean the double-glazed unit is faulty. Condensation between the sealed panes is different and can indicate a seal failure. Record indoor temperature and humidity, check exhaust and heating, and photograph the location; if moisture is between the panes, raise it with the installer under warranty.",
      practicalSteps: [],
      directDelivery: true,
    });
  }

  if (/\b(?:4|four)\s*(?:to|-)\s*(?:6|six)\s*kWh\b/i.test(text)
    && /\bsolar\b/i.test(text)
    && /\b(?:6\.3|8\.9|size|install)\b/i.test(text)) {
    return answer(base, {
      directAnswer: "At only 4 to 6 kWh a day, 6.3 kW is already large for today's use. The 8.9 kW option can still be sensible if its extra cost is modest and you expect an EV, heat-pump hot water, electric heating or other electrification, but check roof shade, inverter size and the network export limit first. Compare the extra system cost with realistic extra self-use and export income; bigger is not automatically the better payback.",
      practicalSteps: [],
      directDelivery: true,
    });
  }

  if (/\b(?:50|fifty)\s*(?:cent|c)\b/i.test(text)
    && /\bfeed[- ]?in tariff\b/i.test(text)
    && /\b(?:broken|faulty|replace)\b/i.test(text)) {
    return answer(base, {
      directAnswer: "Do not authorise replacement until the 50 cent legacy feed-in tariff is protected. A whole-system change, inverter change or capacity increase may end the old tariff even when an insurer is paying. Ask the retailer, distributor and insurer for written confirmation of exactly what can be repaired or replaced without losing the remaining eight years, and have an accredited solar electrician document whether the failed panel can be matched or safely isolated.",
      practicalSteps: [],
      directDelivery: true,
    });
  }

  if (/\b(?:best|highest)\b[\s\S]{0,50}\bfeed[- ]?in tariff\b/i.test(text)) {
    return answer(base, {
      directAnswer: "Do not choose a retailer from the highest feed-in tariff alone. Because you still import power at night, the night import rate, daily supply charge, time-of-use periods, export caps and any higher rates attached to the headline feed-in tariff can outweigh the extra solar credit. Compare the total yearly cost using your actual imports and exports; the best plan is the lowest annual bill, not the biggest advertised feed-in number.",
      practicalSteps: [],
      directDelivery: true,
    });
  }

  if (/\bEV charger\b/i.test(text)
    && /\bthree[- ]?phase\b/i.test(text)
    && /\bsolar\b/i.test(text)) {
    return answer(base, {
      directAnswer: "Choose a smart, solar-aware EV charger rather than simply the fastest three-phase unit. It should follow solar surplus, schedule cheaper overnight charging and support site load management so the house does not exceed its supply. Check the vehicle's onboard AC charging limit because a 22 kW charger cannot make an 11 kW car charge faster. Have an electrician confirm the switchboard, protection, cable route and whether single- or three-phase charging best matches the 8 kW solar system.",
      practicalSteps: [],
      directDelivery: true,
    });
  }

  if (/\b270\s*(?:litre|liter|L)\b/i.test(text)
    && /\b(?:four|4)\s+(?:people|person|household)\b/i.test(text)
    && /\b(?:brand|reliable|installer|service)\b/i.test(text)) {
    return answer(base, {
      directAnswer: "A 270 litre heat-pump hot-water unit is often enough for four people, but confirm usable hot-water volume and recovery against consecutive showers, baths and morning or evening peaks. Judge reliability from the full warranty, labour coverage, local parts, qualified service network, noise and cold-weather recovery—not the brand name alone. For Melbourne, use licensed installers who service your postcode and compare itemised quotes for plumbing, electrical work, removal, drainage and commissioning; Surge can help send one enquiry to relevant local trades.",
      practicalSteps: [],
      directDelivery: true,
    });
  }

  if (/\bdehumidifier\b/i.test(text)
    && /\b(?:instead of|replace|without)\b[\s\S]{0,50}\b(?:bathroom )?(?:exhaust|extractor) fan\b|\b(?:bathroom )?(?:exhaust|extractor) fan\b[\s\S]{0,50}\b(?:instead of|replace|without)\b/i.test(text)) {
    return answer(base, {
      directAnswer: "No. Keep using the bathroom exhaust fan while showering and for a short time afterwards because it removes moisture from the home to outside. A dehumidifier can supplement it in winter or help dry the room, but it recirculates indoor air and should not replace a working, correctly ducted exhaust fan or required ventilation.",
      practicalSteps: [],
      directDelivery: true,
    });
  }

  if (/\baluminium frames?\b/i.test(text)
    && /\b(?:not|without)\s+thermally broken\b|\bthermal(?:ly)? break\b/i.test(text)) {
    return answer(base, {
      directAnswer: "You generally cannot retrofit a true thermal break into an existing aluminium frame; it is built into the frame profile. Without replacing the windows, reduce the room-side impact with close-fitting honeycomb blinds or lined curtains and a pelmet, manage condensation at the cold frame edges, and consider properly detailed secondary glazing where the opening and drainage allow it. Do not cover weep holes or interfere with seals and hardware.",
      practicalSteps: [],
      directDelivery: true,
    });
  }

  if (/\bheat[- ]?pump\b[\s\S]{0,80}\b(?:11\s*(?:am|a\.m\.)|1\s*(?:pm|p\.m\.))\b|\b(?:11\s*(?:am|a\.m\.)|1\s*(?:pm|p\.m\.))\b[\s\S]{0,80}\bheat[- ]?pump\b/i.test(text)
    && /\bhot[- ]?water\b/i.test(text)) {
    return answer(base, {
      directAnswer: "The efficiency difference between starting at 11 am and 1 pm is usually small. Use the window that captures reliable solar and still leaves enough recovery time before the household needs hot water; 11 am is safer if the tank may need a longer run, while 1 pm can suit a short top-up on a sunny day. Check the timer, boost behaviour and morning hot-water use before shifting it later.",
      practicalSteps: [],
      directDelivery: true,
    });
  }

  if (/\bdaily (?:electricity )?supply charge\b/i.test(text)
    && /\bsolar\b/i.test(text)
    && /\bbatter(?:y|ies)\b/i.test(text)) {
    return answer(base, {
      directAnswer: "Yes, solar can still be worthwhile because it reduces usage charges, but it does not remove the daily supply charge while the home remains grid-connected. Judge the battery separately: it only saves the difference between exporting spare solar and buying power later, and the higher supply charge is still paid either way. Recalculate solar and battery payback from the full current tariff and your actual daytime, evening and winter use.",
      practicalSteps: [],
      directDelivery: true,
    });
  }

  if (/\b(?:flat[- ]?rate|single[- ]?rate)\b/i.test(text) && /\b(?:plan|tariff|rate|electricity|energy|pros?|cons?|good|worth|better)\b/i.test(text)) {
    return answer(base, {
      directAnswer: "A flat-rate electricity plan is simple and predictable, but it can cost more if you can move a lot of use into cheap or free hours. For a home with solar or a battery, the daily supply charge, evening import rate and solar export rate can matter more than the headline flat rate. Compare the yearly cost using your actual electricity use, not the retailer's example household.",
      practicalSteps: [],
      suggestedQuestion: "Do you have a recent bill or a full year of electricity use to compare?",
    });
  }

  if (/\b(?:abolish(?:ment)?|disconnect(?:ion)?|remove|lock|plug)\b[^.!?\n]{0,80}\b(?:gas|meter|connection|service)\b|\b(?:gas|meter|connection|service)\b[^.!?\n]{0,80}\b(?:abolish(?:ment)?|disconnect(?:ion)?|remove|lock|plug)\b/i.test(text)) {
    const quotedPrice = text.match(/\$\s*[\d,]+(?:\.\d{1,2})?/)?.[0]?.replace(/\s+/g, "") || "";
    return answer(base, {
      directAnswer: quotedPrice
        ? `${quotedPrice} is high enough that I would not accept it without an itemised explanation and another option. A commercial site can cost more than a house because the distributor may require extra work. If the goal is only to stop using gas, ask whether a meter lock or disconnection is allowed and cheaper. If gas will never be used again, compare that with permanent abolishment.`
        : "A meter lock or disconnection can be the cheaper choice when you only need gas use to stop. Full abolishment permanently removes the service and is more appropriate when gas will never be needed again, but it can involve more distributor work and cost. Ask for both options in writing before approving the job.",
      practicalSteps: [],
      suggestedQuestion: "Is the price from the gas distributor or from a contractor?",
    });
  }

  if (/\b(?:five|5)[ -]?year[- ]?old\b[^.!?\n]{0,100}\b(?:solar|panels?)\b|\b(?:solar|panels?)\b[^.!?\n]{0,100}\b(?:outdated|obsolete|too old|replace)\b/i.test(text)) {
    return answer(base, {
      directAnswer: "Five-year-old solar panels are not automatically outdated. Do not replace working panels only because a salesperson says they are old. Ask for measured evidence of a fault or poor output, and get an independent quote for any battery that can work with the existing system. A full replacement makes sense only when the evidence and itemised savings justify it.",
      practicalSteps: [],
    });
  }

  if (/\blow[- ]?e\b/i.test(text) && /\b(?:surface|coating|glass|glazing|window)\b/i.test(text)) {
    return answer(base, {
      directAnswer: "Surface 4 is the room-side face of the inner pane in a double-glazed unit. A suitable exposed low-E coating can be used there, but not every low-E product is designed for that position. Ask the supplier for the full glass build-up and written confirmation of cleaning limits, condensation performance and warranty. Do not approve it from the words 'surface 4' alone.",
      practicalSteps: [],
    });
  }

  if (/\b(?:honeycomb|cellular)\b/i.test(text)
    && /\b(?:tilt(?:ed)?[- ]?and[- ]?turn|tilt[- ]?turn)\b/i.test(text)) {
    return answer(base, {
      directAnswer: "Yes, honeycomb blinds can work on tilt-and-turn windows or doors, but the mounting system matters. Use a no-drill or manufacturer-approved system that moves with the opening section, and check the handle, hinge and seal clearance. Do not drill into the glazing bead or frame unless the window manufacturer confirms in writing that it will not damage the glass, drainage or warranty.",
      practicalSteps: [],
    });
  }

  if (/\b(?:solar|battery)\b/i.test(text) && /\b(?:mortgage|offset|home loan)\b/i.test(text)) {
    return answer(base, {
      directAnswer: "Use the mortgage rate as the guaranteed benchmark. Solar or a battery is the better financial choice only if conservative yearly bill savings, after allowing for maintenance and replacement, beat the interest saved over the time you expect to stay. Solar often stacks up before a battery because it costs less and usually lasts longer. Run the comparison from your bills and written quotes, not the seller's headline saving.",
      practicalSteps: [],
      suggestedQuestion: "What are the installed price, expected yearly saving and your mortgage rate?",
    });
  }

  if (/\b(?:quotes?|quoted|quotation|proposal|invoice|cheaper one|expensive one|dearer one)\b/i.test(text)) {
    return quoteAnswer(base, text);
  }

  if (/\b(?:power|electricity|energy) bill\b.*\b(?:high|higher|huge|expensive|jumped|increased|gone up|reduce|lower|save)\b|\b(?:reduce|lower|cut)\b.*\b(?:power|electricity|energy) bills?\b/i.test(text)) {
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
    const quotedPrice = text.match(/\$\s*([\d,]+(?:\.\d{1,2})?)/)?.[1];
    const quotedCapacity = text.match(/\b(\d+(?:\.\d+)?)\s*kwh\b/i)?.[1];
    const price = quotedPrice ? Number(quotedPrice.replace(/,/g, "")) : 0;
    const capacity = quotedCapacity ? Number(quotedCapacity) : 0;
    const pricePerKwh = price > 0 && capacity > 0 ? Math.round(price / capacity) : 0;
    return answer(base, {
      directAnswer: noSolar
        ? "No, a home battery is unlikely to be your best first step while you have no rooftop solar. Reduce the home's main energy costs and assess solar first."
        : pricePerKwh
          ? `That works out to about $${pricePerKwh.toLocaleString("en-AU")} per quoted kWh. I would treat it as worth comparing, not an automatic yes. The deal is good only if the usable energy, full installation, warranty and realistic yearly bill saving give a payback shorter than the battery's warranted life.`
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
      suggestedQuestion: noSolar
        ? "Do you want help checking whether solar suits the property?"
        : pricePerKwh
          ? "What exact battery model and installed items are included?"
          : "How much solar do you export on a typical day?",
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

  if (/\b(?:heat[- ]pump hot[- ]water|hot[- ]water heat[- ]pump|replace (?:my |the )?(?:gas|electric) hot[- ]water|hot[- ]water system)\b/i.test(text)) {
    const warmClimate = /\b(?:darwin|tropical|hot[- ]?humid|warm climate|humid climate)\b/i.test(text);
    const largeHousehold = /\b(?:family|household)\s+(?:of\s+)?(?:5|five|6|six|large)\b|\b(?:5|five|6|six)\s+(?:people|person household)\b/i.test(text);
    return answer(base, {
      directAnswer: warmClimate
        ? `Yes, a heat-pump hot-water system generally suits a warm, humid climate because it can draw heat from the outdoor air efficiently. ${largeHousehold ? "For a household of five, choose the tank and recovery rate for busy shower times, not the cheapest unit." : "Choose the tank and recovery rate for the household's busiest shower time."} If you have solar, schedule most heating for daylight hours. Check noise, drainage, warranty and local service before choosing the exact model.`
        : "A well-sized heat-pump hot-water system is often a strong replacement for gas or standard electric hot water, especially if it can run during sunny or cheaper electricity hours. The wrong size or location can still make it noisy or expensive.",
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
