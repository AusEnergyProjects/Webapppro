import type { EnergyAssistantAnswer } from "./energy-assistant.ts";
import type { SurgePlanContext } from "./energy-assistant-plan-context.ts";

type RecentTurn = {
  role: "user" | "assistant";
  content: string;
};

const PRIORITY_INTENT = /\b(?:where|how)\s+should\s+I\s+(?:start|begin)|\bwhat\s+should\s+I\s+(?:do|upgrade|fix|tackle)\s+first|\b(?:prioritise|prioritize|rank)\s+(?:my|the)\s+(?:home|energy|upgrade|plan)|\b(?:start|first)\b[^.!?\n]{0,45}\bbased\s+on\s+(?:my|the)\s+(?:answers|survey|plan|details)\b/i;
const EXPLICIT_CORRECTION = /\b(?:correction|actually|instead|no longer|has changed|have changed|I now (?:rent|own|live)|my (?:new )?postcode is|not (?:an? )?(?:owner|renter|apartment|unit|house))\b/i;

function lowerFirst(value: string) {
  return value ? `${value[0].toLowerCase()}${value.slice(1)}` : "";
}

function numbered(items: readonly string[]) {
  return items.map((item, index) => `${index + 1}. ${item}`).join("\n\n");
}

function joinNatural(items: readonly string[]) {
  if (items.length < 2) return items[0] || "";
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

export function composeSurgePlanPriorityAnswer(
  message: string,
  context: SurgePlanContext | null,
  recentTurns: readonly RecentTurn[] = [],
): EnergyAssistantAnswer | null {
  if (!context || !PRIORITY_INTENT.test(message)) return null;
  const newerCorrection = [message, ...recentTurns
    .filter((turn) => turn.role === "user" && !turn.content.startsWith("Customer supplied home context:"))
    .map((turn) => turn.content)]
    .some((content) => EXPLICIT_CORRECTION.test(content));
  if (newerCorrection) return null;

  const facts = new Map(context.facts.map((fact) => [fact.key, fact.value]));
  if (facts.size < 8) return null;
  const fact = (key: string) => facts.get(key) || "";

  const propertyType = fact("property_type");
  const approval = fact("shared_property_approval");
  const budget = fact("first_stage_budget");
  const priorities = fact("priorities");
  const comfort = fact("comfort_concerns");
  const roofCondition = fact("roof_condition");
  const ceiling = fact("ceiling_insulation");
  const floor = fact("floor_insulation");
  const glazing = fact("glazing");
  const coverings = fact("window_coverings");
  const shading = fact("external_shading");
  const exhaust = fact("exhaust_fans");
  const heating = fact("heating_cooling_systems");
  const hotWater = fact("hot_water");
  const cooking = fact("cooking");
  const solar = fact("solar");
  const battery = fact("battery");
  const ev = fact("ev");
  const switchboard = fact("switchboard");

  const isApartment = /apartment|unit/i.test(propertyType);
  const strataApplies = /strata|owners corporation|common property/i.test(approval);
  const moisture = /condensation|damp|mould|mold/i.test(comfort);
  const hotOrCold = /too hot|too cold/i.test(comfort);
  const roofProblem = /leak|damage|major deterioration/i.test(roofCondition)
    && !/no known/i.test(roofCondition);
  const ceilingUnavailable = /another dwelling is directly above|no roof or ceiling space/i.test(ceiling);
  const floorUnavailable = /slab|another dwelling is directly below/i.test(floor);
  const ceilingNeedsWork = /no ceiling insulation|uninsulated|old|patchy|inadequate/i.test(ceiling)
    && !ceilingUnavailable;
  const weakWindows = /single glazed/i.test(glazing)
    || /basic roller|vertical|venetian|no fitted internal/i.test(coverings)
    || /no effective external shade/i.test(shading);
  const hasReverseCycle = /air-con|air conditioning|reverse-cycle/i.test(heating);
  const hasGasHeating = /gas space|ducted heating/i.test(heating);
  const hasGasAppliances = /gas/i.test(`${hotWater} ${cooking}`);
  const evPlanned = /owned|planned/i.test(ev) && !/no electric vehicle/i.test(ev);
  const actions: string[] = [];

  if (roofProblem) {
    actions.push("Fix the reported roof leak or deterioration before energy upgrades. Water entry can damage insulation and finishes, and the source needs to be found before condensation or mould is blamed on normal indoor moisture.");
  }
  if (moisture) {
    const fanDirection = /kitchen|bathroom/i.test(exhaust)
      ? "Use the existing kitchen and bathroom exhaust every time moisture is produced and check that each fan actually clears steam."
      : "Use effective kitchen and bathroom exhaust whenever moisture is produced.";
    actions.push(`Control condensation before sealing the home more tightly. ${fanDirection} Investigate leaks and persistent mould, and never block required ventilation.`);
  }
  if (weakWindows && (hotOrCold || /comfort/i.test(priorities))) {
    const approvalDirection = strataApplies
      ? "Get strata or owners-corporation approval before external awnings, films or changes affecting common property."
      : "Use external shade on strongly sun-exposed glass where the site and glazing allow it.";
    actions.push(`Improve the worst windows within the first-stage budget. Fit close-fitting honeycomb blinds or thermal curtains with pelmets, then seal only confirmed moving gaps around opening windows and doors. ${approvalDirection}`);
  }
  if (ceilingNeedsWork) {
    actions.push("Inspect the accessible ceiling insulation and repair safe, confirmed gaps or thin areas before sizing new heating or cooling. Keep required clearances around heat-producing fittings and have electrical hazards checked first.");
  }
  if (hasReverseCycle) {
    actions.push(`Use the existing reverse-cycle air conditioner as the main heating and cooling for occupied rooms. Clean its filters, close unused areas and avoid running gas heating at the same time${hasGasHeating ? "; this tests a lower-gas operating pattern before buying replacement equipment" : ""}.`);
  } else if (hasGasHeating) {
    actions.push("Before the gas heater fails, get a room-by-room heating and cooling load assessment and price a correctly sized reverse-cycle replacement, including electrical capacity, outdoor-unit location and noise.");
  }
  if (actions.length < 3 && /lower energy bills/i.test(priorities)) {
    actions.push("Compare the electricity plan using actual usage, and compare gas separately while the home remains connected. A tariff check can reduce cost without locking in building work.");
  }
  if (actions.length < 3 && /older fuse/i.test(switchboard)) {
    actions.push("Have a licensed electrician assess the older fuse board before adding large electric appliances or EV charging. Ask for the required capacity and protection work as a separate written scope.");
  }

  const selectedActions = actions.slice(0, 3);
  if (!selectedActions.length) return null;
  const reasons = [
    budget ? `${/^under\b/i.test(budget) ? "an" : "a"} ${lowerFirst(budget)} first-stage budget` : "",
    moisture ? "condensation or damp" : "",
    /single glazed/i.test(glazing) ? "mostly single glazing" : "",
    /basic roller|vertical|venetian/i.test(coverings) ? "basic blinds" : "",
    /no effective external shade/i.test(shading) ? "no effective external shade" : "",
    hasReverseCycle ? "an existing reverse-cycle system" : "",
  ].filter(Boolean);
  const unsuitableInsulation = ceilingUnavailable && floorUnavailable
    ? " Generic ceiling and underfloor insulation advice does not fit because another dwelling is above and a slab or another dwelling is below."
    : ceilingUnavailable
      ? " Generic ceiling-insulation advice does not fit because another dwelling is directly above."
      : "";
  const later: string[] = [];
  if (hasGasAppliances) later.push("plan gas hot-water and cooking replacements around equipment end-of-life rather than replacing working systems blindly");
  if (evPlanned) later.push(`${strataApplies ? "confirm strata approval and " : ""}have a licensed electrician scope EV charging and supply capacity`);
  if (isApartment && /no rooftop solar/i.test(solar) && /no home battery/i.test(battery)) {
    later.push("treat solar and a battery as later common-property and load-profile decisions");
  }

  const startWith = roofProblem
    ? "the reported roof problem"
    : moisture && weakWindows
      ? "moisture control and the worst windows"
      : moisture
        ? "moisture control"
        : weakWindows
          ? "the worst windows"
          : ceilingNeedsWork
            ? "the accessible ceiling insulation"
            : hasReverseCycle
              ? "the existing reverse-cycle system"
              : "the first ranked action below";
  const homeDescription = propertyType ? `Your ${lowerFirst(propertyType)}` : "Your home";
  const intro = `Based on your saved answers, start with ${startWith}. ${homeDescription} has ${joinNatural(reasons) || "several interacting comfort and energy constraints"}.${unsuitableInsulation}`;
  const laterDirection = later.length
    ? `\n\nAfter those first steps, ${later.join("; ")}.`
    : "";
  const followUp = moisture
    ? "Which room has the worst condensation or temperature problem: the living room, bedroom, bathroom or somewhere else?"
    : "Which room is hardest to keep comfortable?";
  return {
    directAnswer: `${intro}\n\n${numbered(selectedActions)}${laterDirection}`,
    practicalSteps: selectedActions,
    nextAction: selectedActions[0],
    status: "answered",
    citations: [],
    assumptions: ["The saved answers are household-reported and have not been confirmed by a site inspection."],
    confidence: "medium",
    suggestedQuestions: [followUp],
    toolActions: [],
    sourceBoundary: "This priority order uses the confirmed home-plan facts supplied on this device. Site condition, safety, approvals and regulated work still require appropriate inspection or licensed advice.",
  };
}
