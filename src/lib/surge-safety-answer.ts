import type { EnergyAssistantAnswer } from "./energy-assistant.ts";

const NEGATION = /\b(?:no|not|without|never|isn['’]?t|aren['’]?t|wasn['’]?t|weren['’]?t|doesn['’]?t|didn['’]?t|hasn['’]?t|hadn['’]?t)\b/i;
const NON_HAZARD_NEGATION = /\b(?:no idea|no clue|no one|no-one|nobody|no immediate danger|not sure|not certain|not stopping|not clearing|not going away|do not know|don['’]?t know|does not know|doesn['’]?t know|(?:not|isn['’]?t|aren['’]?t|wasn['’]?t|weren['’]?t)\s+(?:just|only|merely))\b/gi;
const POST_HAZARD_NEGATION = /^\s*(?:(?:is|are|was|were|has|have|had|can|could|seems?|appears?)\s+)?(?:(?:actually|currently|definitely|now|still)\s+)*(?:no\s+longer|not|never|isn['’]?t|aren['’]?t|wasn['’]?t|weren['’]?t|hasn['’]?t|hadn['’]?t|can['’]?t|couldn['’]?t)\s+(?:(?:been|being|be)\s+)?(?:present|visible|coming|rising|pouring|billowing|detected|seen|observed|occurring|happening|there)\b/i;
const AMBIENT_SMOKE_REFERENCE = /\b(?:(?:bushfire|wildfire|cooking|barbecue|cigarette|tobacco|wood[- ]?fire|fireplace|neighbou?r['’]?s?\s+chimney)\s+smoke|smoke\s+(?:is\s+)?(?:coming\s+)?from\s+(?:a\s+|my\s+neighbou?r['’]?s?\s+)?(?:bushfire|wildfire|cooking|barbecue|cigarette|outside|fireplace|chimney))\b/gi;
const HAZARD_WORDING = /\b(?:alarm(?: is)? sounding|dizz(?:y|iness)|drowsy|light[ -]?headed|headaches?|nausea|nauseous|vomit(?:ed|ing|s)?|passed out|unconscious|collaps(?:ed|es|ing)|faint(?:ed|ing)?|confus(?:ed|ion)|breathing trouble|short(?:ness)? of breath|can(?:not|['’]t) breathe(?: properly)?|buzz(?:ed|ing)?|humm(?:ed|ing)?|hiss(?:ed|es|ing)?|fizz(?:ed|ing)?|crackl(?:ed|ing)?|popp(?:ed|ing)?|swollen|swelling|bulging|leak(?:ed|ing)?|vent(?:ed|ing)?|spark(?:ed|ing)?|arc(?:ed|ing)?|scorched|burn(?:ed|t|ing)?|burning smell|smell(?:s|ed|ing)? burnt|chemical (?:smell|odou?r)|fumes?|mist|smok(?:e|ed|ing)?|smouldering|smoldering|flames?|on fire|ablaze|alight|caught alight|(?:has|have) caught fire|overheating|unusually hot)\b/i;
const EQUIPMENT_SOURCE = "(?:gas|LPG|carbon[- ]?monoxide alarm|CO alarm|CO detector|portable electric heater|electric heater|heater|cooktop|stove|oven|boiler|home battery|battery|home storage|BESS|switchboard|meter box|electrical panel|main switch|inverter|solar DC isolator|solar isolator|DC isolator|isolator|EV charging plug|EV charger|EV plug|charging plug|charging cable|powerboard|power board|power point|socket|outlet|toaster|microwave|washing machine|washer|dishwasher|fridge|refrigerator|television|TV|tumble dryer|clothes dryer|dryer|air conditioner|aircon|reverse[- ]?cycle|split[- ]?system refrigerant line|split system|heat pump|refrigerant line|line set)";

function reportsControlledEverydaySmoke(message: string) {
  const ordinarySource = /\btoast\b[^.!?]{0,35}\bsmok(?:e|es|ed|ing)\b|\bsmoke\b[^.!?]{0,35}\bfrom\s+(?:the\s+|a\s+)?(?:burnt\s+toast|burnt\s+food|food|barbecue|candle|fireplace)\b|\boven\b[^.!?]{0,35}\bsmok(?:e|es|ed|ing)\b[^.!?]{0,45}\b(?:food|spill(?:ed|age)?)\b|\bbarbecue\b[^.!?]{0,35}\bsmok(?:e|es|ed|ing)\b/i.test(message);
  const uncontrolled = /\b(?:appliance|toaster|oven|barbecue|candle|fireplace|wall|cabinet|house|home|room)\b[^.!?]{0,35}\b(?:on fire|flames? (?:spreading|outside|around)|smoke (?:is )?not stopping)\b|\b(?:flames? (?:spreading|outside|around)|smoke (?:is )?not stopping)\b[^.!?]{0,35}\b(?:appliance|toaster|oven|barbecue|candle|fireplace|wall|cabinet|house|home|room)\b/i.test(message);
  return ordinarySource && !uncontrolled;
}

function reportsResolvedHazard(message: string) {
  const hasEquipment = new RegExp(`\\b${EQUIPMENT_SOURCE}\\b`, "i").test(message)
    || (/\b(?:garage|shed|hallway|hall|corridor|laundry|roof space|roof cavity|attic|cupboard|cabinet|house|home|room|kitchen|bedroom)\b/i.test(message)
      && /\b(?:smoke|fire|flames?)\b/i.test(message));
  const hasPastSignal = HAZARD_WORDING.test(message)
    && /\b(?:was|were|had been|there was|there were|started|began|gave off|smelled|smelt|sparked|smoked|hissed|for a second|used to be)\b/i.test(message);
  const clearlyResolved = /\b(?:but|and|then)\b[^.!?]{0,70}\b(?:clear|safe|quiet|gone|stopped|cleared|resolved|back to normal|the smell is gone|no longer (?:buzzing|humming|hissing|sparking|smoking|hot|present)|not (?:buzzing|humming|hissing|sparking|smoking|hot|happening|present|doing it))\b(?:\s+now)?/i.test(message)
    || /\b(?:is|are|has|have)\s+(?:now\s+)?(?:gone|stopped|cleared|resolved|quiet|back to normal)\b/i.test(message);
  const newCurrentDanger = /\b(?:but|however|now|currently|right now|at the moment)\b[^.!?]{0,45}\b(?:smoking|on fire|flames?|sparking|arcing|gas smell|CO alarm(?: is)? sounding)\b/i.test(message);
  return hasEquipment && hasPastSignal && clearlyResolved && !newCurrentDanger;
}

function activeHazardMessage(message: string) {
  if (reportsResolvedHazard(message)) return "";
  const cleaned = message
    .replace(/\bsick\s+of\b/gi, "fed up with")
    .replace(/\bburn(?:s|ed|ing)?\s+(?:a\s+)?hole\s+in\s+(?:my|our|the)\s+pocket\b/gi, "costing a lot")
    .replace(/\b(?:(?:gas|electricity|energy|power|battery|solar|heat[- ]?pump)\s+)?(?:bills?|prices?|costs?|sales|market)\s+(?:is|are|was|were)\s+(?:really\s+)?on fire\b/gi, "costs are rising quickly")
    .replace(/\bburn(?:s|ed|ing)?\s+(?:straight\s+)?(?:through\s+)?(?:(?:a\s+)?(?:lot|lots)\s+of\s+|(?:too|so)\s+much\s+|more\s+)?(?:electricity|power|energy|money|cash|dollars?)\b/gi, "using a lot of energy")
    .replace(AMBIENT_SMOKE_REFERENCE, "ambient air")
    .replace(/\bsmoke alarms?\b/gi, "alarm device")
    .replace(/\b(?:(?:steady|normal)\s+blue\s+flames?|small\s+pilot\s+flames?|pilot\s+flames?)\b/gi, "normal burner")
    .replace(/\b(?:mist|steam)\b[^.!?;]{0,30}\b(?:during|while)\s+defrost(?:ing)?\b/gi, "normal defrost vapour");
  const explicitConditionalAction = /\bwhat\s+(?:should|do|can)\s+(?:i|we)\s+do\b[^.!?]{0,45}\bif\b|\bif\b[^.!?]{0,70}\bwhat\s+(?:should|do|can)\s+(?:i|we)\s+do\b/i.test(cleaned);

  return cleaned
    .split(/[.!?;]|\b(?:but|however|although|though)\b/i)
    .map((clause) => clause.trim())
    .filter(Boolean)
    .filter((clause) => {
      const hasExplicitCurrentMarker = /\b(?:now|right now|currently|at the moment|today|i can (?:see|smell|hear)|we can (?:see|smell|hear)|there(?:'s| is| are))\b/i.test(clause);
      if (!hasExplicitCurrentMarker
        && /\b(?:old|last year|yesterday|previously|before it was|has been (?:removed|replaced|repaired|dried|checked)|was (?:removed|replaced|repaired|dried|checked))\b/i.test(clause)) return false;
      if (!hasExplicitCurrentMarker
        && /\b(?:manual|installer|electrician|technician|salesperson|manufacturer)\b[^.!?]{0,55}\b(?:says?|said|notes?|warns?|reports?|may|might|can|could|during)\b/i.test(clause)) return false;
      if (/\b(?:self[- ]?test|commissioning test|during testing|test cycle|monthly test|scheduled test)\b/i.test(clause)) return false;
      if (!HAZARD_WORDING.test(clause)) return true;
      if (!explicitConditionalAction
        && /^\s*if\b/i.test(clause)
        && /\b(?:what (?:would|does|could) (?:that|it) mean|is that normal|why)\b/i.test(cleaned)) return false;
      if (/\b(?:no fire here|currently dry|completely dry|has been made safe|no longer present)\b/i.test(clause)) return false;
      return true;
    })
    .join(". ");
}

function affirmed(message: string, pattern: RegExp) {
  const matcher = new RegExp(pattern.source, `${pattern.flags.replace(/g/g, "")}g`);
  for (const match of message.matchAll(matcher)) {
    const before = message.slice(Math.max(0, (match.index || 0) - 120), match.index || 0);
    const clause = before.split(/[.!?;]|\b(?:but|however|although|though)\b/i).at(-1) || "";
    const after = message
      .slice((match.index || 0) + match[0].length, (match.index || 0) + match[0].length + 80)
      .split(/[.!?;]|\b(?:but|however|although|though)\b/i)[0] || "";
    if (!NEGATION.test(clause.replace(NON_HAZARD_NEGATION, ""))
      && !NEGATION.test(match[0].replace(NON_HAZARD_NEGATION, ""))
      && !POST_HAZARD_NEGATION.test(after)) return true;
  }
  return false;
}

function affirmedEquipmentSignal(
  message: string,
  equipmentPattern: RegExp,
  signalPattern: RegExp,
  hasPriorEquipmentAnchor: boolean,
) {
  const withoutAmbientSmoke = message.replace(AMBIENT_SMOKE_REFERENCE, "ambient air");
  if (!equipmentPattern.test(withoutAmbientSmoke)) {
    if (!hasPriorEquipmentAnchor) return false;
    const signal = `(?:${signalPattern.source})`;
    const activeAnaphora = new RegExp([
      `\\b(?:it|that|the unit|the system|the appliance|the one)\\b[^.!?;\\n]{0,18}\\b(?:is|are|has|have|started|starts|keeps|became|feels?)\\b[^.!?;\\n]{0,24}${signal}`,
      `\\bnow\\b[^.!?;\\n]{0,24}${signal}`,
    ].join("|"), "i");
    return affirmed(withoutAmbientSmoke, activeAnaphora);
  }

  const equipment = `(?:${equipmentPattern.source})`;
  const signal = `(?:${signalPattern.source})`;
  const tiedSignal = new RegExp([
    `${equipment}[^.!?;\\n]{0,18}\\b(?:is|are|was|were|has|have|had|feels?|felt|became|becomes?|gets?|got|started|starts?|keeps?|with|showing|making|producing|emitting|giving\\s+off|smells?)\\b[^.!?;\\n]{0,24}${signal}`,
    `${equipment}[^.!?;\\n]{0,12}${signal}`,
    `${signal}\\s+(?:(?:the|my|our|this|that|a|an)\\s+)?${equipment}`,
    `${signal}[^.!?;\\n]{0,24}\\b(?:from|beside|near|around|coming\\s+(?:from|out\\s+of)|rising\\s+from|pouring\\s+from|billowing\\s+from)\\b[^.!?;\\n]{0,20}${equipment}`,
  ].join("|"), "i");
  return affirmed(withoutAmbientSmoke, tiedSignal);
}

function isEducationalHazardQuestion(message: string) {
  if (reportsResolvedHazard(message)) return true;
  const explicitlyCurrent = /\b(?:now|right now|currently|at the moment|today|i can (?:see|smell|hear)|we can (?:see|smell|hear)|there(?:'s| is| are))\b/i.test(message);
  const describesMediaExample = /\b(?:in|from|shown\s+in)\s+(?:(?:this|that|a|the)\s+)?(?:(?:training|demonstration|example|online|youtube)\s+)?(?:video|clip|photo|image|article|manual)\b/i.test(message);
  if (describesMediaExample && !explicitlyCurrent) return true;
  const asksConditionalScenario = /^\s*(?:can|could|would|might|will|does|is)\b[^?]{0,100}\b(?:during|if|in\s+the\s+event\s+of)\b/i.test(message);
  if (asksConditionalScenario && !explicitlyCurrent) return true;
  const asksHypotheticalAction = /\bwhat\s+(?:should|do|can)\s+(?:i|we)\s+do\b[^.!?]{0,45}\bif\b|\bif\b[^.!?]{0,70}\b(?:what\s+(?:should|do|can)\s+(?:i|we)\s+do|(?:should|can|could|would|do)\s+(?:i|we)\b)|\b(?:should|can|could|would|do)\s+(?:i|we)\b[^.!?]{0,55}\bif\b|\b(?:what|why|how|when|is|are|can|could|would|should|do|does)\b[^.!?]{0,70}\bif\b|\bwhat\s+if\b/i.test(message);
  if (asksHypotheticalAction && !explicitlyCurrent) return true;

  const reportsOnlyPastCondition = new RegExp(
    `(?:\\b(?:my|our|the|this|that)\\s+${EQUIPMENT_SOURCE}\\b[^.!?]{0,45}\\b(?:was|were|had\\s+been|did|sparked|smoked|hissed)\\b[^.!?]{0,45}(?:${HAZARD_WORDING.source})?|(?:${HAZARD_WORDING.source})[^.!?]{0,55}\\b(?:yesterday|last\\s+(?:night|week|month|year)|previously|earlier|once|before\\s+(?:being|it was)|was\\s+(?:removed|replaced|repaired|checked)))`,
    "i",
  ).test(message);
  const reportsPresentCondition = new RegExp(
    `\\b(?:my|our|the|this|that)\\s+${EQUIPMENT_SOURCE}\\b[^.!?]{0,35}\\b(?:is|are|has\\s+started|have\\s+started|keeps?)\\b[^.!?]{0,35}(?:${HAZARD_WORDING.source})`,
    "i",
  ).test(message);
  if (reportsOnlyPastCondition && !reportsPresentCondition && !explicitlyCurrent) return true;

  const asksGenericMechanism = /^\s*(?:what|why|how|when|is|are|can|could|does|do|would|will|may|might|should)\b/i.test(message)
    || /[.!?]\s*(?:what|why|how|when|is|are|can|could|does|do|would|will|may|might|should)\b/i.test(message)
    || /\b(?:a|an|any)\s+(?:homeowner|person|battery|inverter|switchboard|heater|air ?con(?:ditioner)?|heat pump)\b/i.test(message);
  if (!asksGenericMechanism || !HAZARD_WORDING.test(message)) return false;

  const hazard = `(?:${HAZARD_WORDING.source})`;
  const explicitCurrentHazard = message
    .split(/[.!?;]|\b(?:but|however|although|though)\b/i)
    .some((clause) => /\b(?:right now|currently|at the moment)\b/i.test(clause)
      && HAZARD_WORDING.test(clause)
      && !NEGATION.test(clause.replace(NON_HAZARD_NEGATION, "")));
  const reportsCurrentCondition = new RegExp([
    `\\b(?:i|we)\\s+(?:am|are|feel|can\\s+(?:see|smell|hear)|see|smell|hear)\\b[^.!?]{0,35}${hazard}`,
    `\\b(?:my|our|this|that|the)\\s+${EQUIPMENT_SOURCE}\\b[^.!?]{0,35}\\b(?:is|are|has\\s+started|have\\s+started|keeps|feels?|smells?)\\b[^.!?]{0,30}${hazard}`,
    `\\b(?:is|are)\\s+(?:my|our|this|that|the)\\s+${EQUIPMENT_SOURCE}\\b[^.!?]{0,30}${hazard}`,
    `\\b(?:it|they)\\s+(?:is|are|has\\s+started|have\\s+started|keeps|feels?|smells?)\\b[^.!?]{0,30}${hazard}`,
    `\\bthere(?:'s| is| are)\\b[^.!?]{0,35}${hazard}`,
    `${hazard}[^.!?]{0,35}\\bfrom\\s+(?:my|our|this|that|the)\\s+${EQUIPMENT_SOURCE}\\b`,
  ].join("|"), "i").test(message) || explicitCurrentHazard;
  return !reportsCurrentCondition;
}

function safetyAnswer(directAnswer: string): EnergyAssistantAnswer {
  return {
    directAnswer,
    practicalSteps: [],
    nextAction: "",
    status: "answered",
    citations: [],
    assumptions: [],
    confidence: "high",
    suggestedQuestions: [],
    toolActions: [],
    sourceBoundary: "",
  };
}

function educationalAnswer(directAnswer: string): EnergyAssistantAnswer {
  return {
    directAnswer,
    practicalSteps: [],
    nextAction: "",
    status: "answered",
    citations: [],
    assumptions: ["This describes a possible or past condition, not a confirmed current emergency."],
    confidence: "medium",
    suggestedQuestions: [],
    toolActions: [],
    sourceBoundary: "The cause cannot be confirmed without inspecting the equipment and its fault history.",
  };
}

/**
 * Supplies a useful normal-chat fallback for hypothetical or past hazard wording.
 * The model may improve this answer; unlike an active hazard it does not bypass
 * the normal response path.
 */
export function composeSurgeNonCurrentHazardAnswer(
  message: string,
  priorUserMessages: readonly string[] = [],
): EnergyAssistantAnswer | null {
  if (!isEducationalHazardQuestion(message)) return null;
  const context = `${priorUserMessages.slice(-2).join("\n")}\n${message}`;
  const equipmentContext = new RegExp(`\\b${EQUIPMENT_SOURCE}\\b`, "i").test(message)
    ? message
    : context;

  if (/\b(?:training|demonstration|example|online|youtube)\s+(?:video|clip|photo|image)\b/i.test(message)
    && /\b(?:battery|home storage|BESS)\b/i.test(context)
    && /\b(?:smoke|smoking|venting|flames?|on fire)\b/i.test(message)) {
    return educationalAnswer("Smoke or venting shown coming from a battery in a training example depicts a serious battery failure, not normal operation. The useful lesson is to keep clear of a real smoking battery and let trained responders handle it rather than approaching or trying to reset it.");
  }
  if (/\b(?:water|rainwater|floodwater|flood)\b/i.test(message)
    && /\b(?:switchboard|meter box|electrical panel|main switch|power point|socket|outlet|wiring|cables?)\b/i.test(context)) {
    return educationalAnswer("Yes, floodwater can reach electrical equipment. Do not approach, open or reset a wet switchboard or touch wet outlets or wiring; after a flood, have the electricity network or a licensed electrician make the supply safe and inspect it before power is restored.");
  }

  if (/\b(?:battery|home storage|BESS)\b/i.test(equipmentContext)) {
    return educationalAnswer("A hissing sound from the battery enclosure can indicate a fault or cell venting, although a nearby cooling fan can sound similar. If it happened previously, leave the battery unused and ask the installer or manufacturer to check the fault log and equipment before it is used again. If it happens again, keep clear and contact the installer or manufacturer urgently.");
  }
  if (/\b(?:gas|LPG|carbon[- ]?monoxide|CO alarm|CO detector|gas heater|gas cooktop|gas stove|gas oven|boiler)\b/i.test(equipmentContext)) {
    if (/\bhiss(?:ed|ing)?\b/i.test(message)) {
      return educationalAnswer("A hissing sound from a gas heater can indicate escaping gas or a valve or burner fault. If it has stopped, keep the heater off and have a licensed gasfitter inspect it before it is used again. If the sound, a gas smell or illness returns, move outside and contact the gas network fault line from there.");
    }
    return educationalAnswer("A gas smell, carbon-monoxide alarm or illness while a gas appliance is running is not normal. Stop using the appliance and arrange a licensed gasfitter to check it before it is used again. If a gas smell happens again, move outside and contact the gas network fault line from there.");
  }
  if (/\b(?:switchboard|meter box|electrical panel|main switch|inverter|solar isolator|DC isolator|EV charger|power point|socket|outlet|wiring|air conditioner|aircon|reverse[- ]?cycle|split system|heat pump)\b/i.test(equipmentContext)) {
    return educationalAnswer("Buzzing, smoke, sparking, a burning smell or unusual heat from electrical equipment can point to a fault, not normal operation. If it happened previously, keep the equipment unused and have a licensed electrician or the appropriate service technician inspect it before it is restarted. If it happens again, keep away and arrange urgent electrical help.");
  }
  if (/\b(?:asbestos|vermiculite|loose[- ]?fill insulation|old fibro|fibre[- ]?cement|fiber[- ]?cement)\b/i.test(context)) {
    return educationalAnswer("Suspected asbestos cannot be identified safely from appearance alone. Do not drill, cut, sand, sample or move it yourself; have an appropriately licensed asbestos assessor identify the material before work starts.");
  }
  return null;
}

/**
 * Handles immediate household hazards before category routing or model use.
 * These answers intentionally fail closed and never ask the customer to inspect,
 * reset, unplug or approach equipment that may be live, hot, leaking or burning.
 */
export function composeSurgeSafetyAnswer(
  message: string,
  priorUserMessages: readonly string[] = [],
): EnergyAssistantAnswer | null {
  if (reportsControlledEverydaySmoke(message)) {
    if (/\b(?:no fire here|no active fire|no flames?)\b/i.test(message)) return null;
    return safetyAnswer("If the smoke is clearly from burnt food, a candle, barbecue or an operating fireplace and remains controlled, remove or switch off the heat source only if that is safe, ventilate the area and make sure the smoke clears. If flame spreads beyond the intended source or smoke continues after the source is off, leave the area and seek urgent help.");
  }
  const equipmentPattern = /\b(?:gas|LPG|heater|cooktop|stove|oven|boiler|carbon[- ]?monoxide|CO alarm|CO detector|battery|home storage|BESS|switchboard|meter box|electrical panel|main switch|inverter|solar isolator|DC isolator|isolator|EV charger|EV plug|charging plug|charging cable|powerboard|power board|power point|socket|outlet|electrical cables?|wiring|wires?|live wires?|toaster|microwave|washing machine|washer|dishwasher|fridge|refrigerator|television|TV|tumble dryer|clothes dryer|dryer|air conditioner|aircon|reverse[- ]?cycle|split system|heat pump|refrigerant|refrigerant line|line set|asbestos|vermiculite|loose[- ]?fill insulation|unknown loose insulation|old fibro|old fibre[- ]?cement|old fiber[- ]?cement)\b/i;
  const equipmentAnchor = equipmentPattern.test(message)
    ? message
    : [...priorUserMessages].reverse().find((turn) => equipmentPattern.test(turn)) || message;
  const hasPriorEquipmentAnchor = equipmentAnchor !== message;
  const activeMessage = activeHazardMessage(message);
  const scopedEquipmentSmokeOrFire = affirmedEquipmentSignal(
    activeMessage,
    equipmentPattern,
    /\b(?:smoke|smoking(?![ -]?hot\b)|smouldering|smoldering|burning(?![ -]?(?:smell|hot)\b)|on fire|ablaze|alight|caught alight|caught fire|(?:has|have) caught fire|flames?)\b/i,
    hasPriorEquipmentAnchor,
  );
  const explicitUncontrolledFire = affirmed(activeMessage, /\b(?:frying pan|pan|stove|oven|rangehood|electric blanket|blanket|clothes dryer|dryer|curtains?|blinds?|carpet|couch|sofa|bed|bedroom|room|kitchen|garage|house|home|building|wall|ceiling|roof|floor|switchboard|meter box|powerboard|power board|power point|socket|outlet|appliance|equipment)\b[^.!?\n]{0,40}\b(?:is|are|has|have|with|has caught|have caught|was set)?\s*(?:on fire|caught fire|caught alight|burning(?![ -]?hot\b)|smoking(?![ -]?hot\b)|smouldering|smoldering|ablaze|alight|flames?)\b|\b(?:smoke|fire|flames?)\b[^.!?\n]{0,40}\b(?:coming|rising|pouring|billowing|spreading|from|on|in|inside|into|through|across|behind|at|to)\b[^.!?\n]{0,30}\b(?:frying pan|pan|stove|oven|rangehood|electric blanket|blanket|clothes dryer|dryer|curtains?|blinds?|carpet|couch|sofa|bed|bedroom|room|kitchen|garage|house|home|building|wall|ceiling|roof|floor|switchboard|meter box|powerboard|power board|power point|socket|outlet|appliance|equipment)\b|\b(?:uncontrolled fire|fire (?:is )?spreading|flames? (?:are )?spreading)\b|\b(?:house|home|building|room|kitchen|garage)\b[^.!?\n]{0,25}\b(?:filling|filled)\s+with\s+smoke\b/i);
  const explicitLiteralHomeFire = affirmed(activeMessage, /\b(?:garage|shed|hallway|hall|corridor|laundry|roof space|roof cavity|attic|cupboard|cabinet|house|home|room|kitchen|bedroom)\b[^.!?\n]{0,30}\b(?:is|are|has|have)?\s*(?:(?:full\s+(?:up\s+)?of)|(?:(?:filling|filled)\s+(?:up\s+)?with))\s+smoke\b|\bsmoke\b[^.!?\n]{0,20}\b(?:is\s+)?(?:filling|pouring|billowing|spreading)\b[^.!?\n]{0,20}\b(?:the|my|our|this|that)?\s*(?:garage|shed|hallway|hall|corridor|laundry|roof space|roof cavity|attic|cupboard|cabinet|house|home|room|kitchen|bedroom)\b|\b(?:there\s+(?:is|are)\s+)?(?:a\s+)?(?:fire|flames?)\b[^.!?\n]{0,20}\b(?:in|inside|coming from|rising from|spreading through)\b[^.!?\n]{0,15}\b(?:the|my|our|this|that)?\s*(?:garage|shed|hallway|hall|corridor|laundry|roof space|roof cavity|attic|cupboard|cabinet|house|home|room|kitchen|bedroom)\b/i);

  if (isEducationalHazardQuestion(message)) return null;

  const gasOrCombustion = /\b(?:gas|LPG|carbon[- ]?monoxide|CO alarm|CO detector)\b/i.test(equipmentAnchor);
  const gasOdourOrAlarm = affirmed(activeMessage, /(?:^|[.!?]\s*)(?:i|we)\s+(?:can\s+|am\s+|are\s+)?smell(?:ing)?(?:\s+something)?(?:\s+(?:of|like))?\s+(?:a\s+)?(?:strong\s+)?gas(?:\s+(?:smell|odou?r))?\b|(?:^|[.!?]\s*)\s*(?:strong\s+)?gas\s+(?:smell|odou?r)\b|\bthere(?:'s| is)\s+(?:a\s+)?(?:strong\s+)?gas\s+(?:smell|odou?r)\b|\b(?:i|we)\s+(?:have|noticed)\s+(?:a\s+)?(?:strong\s+)?gas\s+(?:smell|odou?r)\b|\b(?:the|my|our|this|that)\s+(?:house|home|room|property|area|gas meter|meter)\b[^.!?\n]{0,25}\bsmell(?:s|ing)?\s+(?:of|like)\s+gas\b|\b(?:rotten[- ]?egg|sulphur|sulfur)\s+(?:smell|odou?r)\b[^.!?\n]{0,35}\b(?:by|near|beside|around|from)\b[^.!?\n]{0,20}\b(?:gas|meter|heater|cooktop|stove|oven|boiler)\b|\b(?:my|our|this|that|the)\s+(?:gas\s+)?(?:heater|cooktop|stove|oven|boiler)\b[^.!?\n]{0,30}\bsmell(?:s|ing)?\s+(?:of|like)\s+gas\b|\b(?:carbon[- ]?monoxide|CO) (?:alarm|detector)(?: is|'s)? (?:sounding|beeping|alarming|going off|went off|triggered)\b/i);
  const gasRelatedSymptom = affirmed(activeMessage, /\b(?:dizz(?:y|iness)|drowsy|light[ -]?headed|headaches?|nausea|nauseous|vomit(?:ed|ing|s)?|passed out|unconscious|collaps(?:ed|es|ing)|faint(?:ed|ing)?|confus(?:ed|ion)|breathing trouble|short(?:ness)? of breath|can(?:not|['’]t) breathe(?: properly)?|sick|unwell)\b/i);
  const gasApplianceRunning = affirmed(activeMessage, /\b(?:gas|LPG|gas heater|gas cooktop|gas stove|gas oven|boiler)\b[^.!?\n]{0,45}\b(?:running|operating|on)\b/i);
  const occupantsIll = affirmed(activeMessage, /\b(?:i|we|someone|anyone|people|person|persons|child|children|adult|adults|occupants?)\b[^.!?\n]{0,35}\b(?:dizz(?:y|iness)|drowsy|light[ -]?headed|headaches?|nausea|nauseous|vomit(?:ed|ing|s)?|passed out|unconscious|collaps(?:ed|es|ing)|faint(?:ed|ing)?|confus(?:ed|ion)|breathing trouble|short(?:ness)? of breath|can(?:not|['’]t) breathe(?: properly)?|sick|unwell)\b/i);
  const immediatelyPriorActiveMessage = activeHazardMessage(priorUserMessages.at(-1) || "");
  const immediatelyPriorGasApplianceActive = affirmed(immediatelyPriorActiveMessage, /\b(?:(?:my|our|the|this|that)\s+)?(?:(?:gas|LPG)\s+(?:heater|cooktop|stove|oven)|boiler)\b(?:(?:['’]s|\s+(?:is|has been|keeps?))\s+(?:(?:currently|still|now|right now|at the moment)\s+)?(?:running|operating)\b|(?:['’]s|\s+is)\s+(?:(?:currently|still)\s+)?on\b(?=\s*(?:[.!?;,]|$)|\s+(?:right now|now|at the moment)\b|\s+and\s+(?:running|operating)\b))|\b(?:i|we)\s+(?:have|left|turned)\b[^.!?\n]{0,25}\b(?:(?:gas|LPG)\s+(?:heater|cooktop|stove|oven)|boiler)\b[^.!?\n]{0,12}\bon\b(?=\s*(?:[.!?;,]|$)|\s+(?:right now|now|at the moment)\b|\s+and\s+(?:running|operating)\b)/i);
  const immediatelyPriorCoAlarmActive = affirmed(immediatelyPriorActiveMessage, /\b(?:(?:my|our|the|this|that)\s+)?(?:carbon[- ]?monoxide|CO)\s+(?:alarm|detector)(?:['’]s|\s+(?:is|has started|keeps?))\s+(?:(?:currently|still|now|right now|at the moment)\s+)?(?:sounding|beeping|alarming|going off)\b/i);
  const immediatelyPriorGasOrCoSignal = immediatelyPriorGasApplianceActive || immediatelyPriorCoAlarmActive;
  const currentSymptomsHaveSeparateCause = /\b(?:exercise|workout|running race|migraine|hangover|motion sickness|food poisoning|stomach bug|medication|staring at (?:the )?(?:bill|screen))\b/i.test(activeMessage);
  const immediateGasOrCoSymptomFollowUp = immediatelyPriorGasOrCoSignal
    && occupantsIll
    && !currentSymptomsHaveSeparateCause;
  const gasHealthSignal = affirmed(activeMessage, /\b(?:gas|LPG|gas heater|gas cooktop|gas stove|gas oven|boiler|carbon[- ]?monoxide|CO alarm|CO detector)\b[^.!?\n]{0,80}\b(?:running|operating|on|alarm(?: is)? (?:sounding|beeping)|went off|going off)\b[^.!?\n]{0,55}\b(?:i|we|someone|anyone|people|person|persons|child|children|adult|adults|occupants?)\b[^.!?\n]{0,35}\b(?:dizz(?:y|iness)|drowsy|light[ -]?headed|headaches?|nausea|nauseous|vomit(?:ed|ing|s)?|passed out|unconscious|collaps(?:ed|es|ing)|faint(?:ed|ing)?|confus(?:ed|ion)|breathing trouble|short(?:ness)? of breath|can(?:not|['’]t) breathe(?: properly)?|sick|unwell)\b|\b(?:i|we|someone|anyone|people|person|persons|child|children|adult|adults|occupants?)\b[^.!?\n]{0,35}\b(?:dizz(?:y|iness)|drowsy|light[ -]?headed|headaches?|nausea|nauseous|vomit(?:ed|ing|s)?|passed out|unconscious|collaps(?:ed|es|ing)|faint(?:ed|ing)?|confus(?:ed|ion)|breathing trouble|short(?:ness)? of breath|can(?:not|['’]t) breathe(?: properly)?|sick|unwell)\b[^.!?\n]{0,55}\b(?:while|when|after)\b[^.!?\n]{0,35}\b(?:gas|LPG|gas heater|gas cooktop|gas stove|gas oven|boiler)\b/i)
    || (gasApplianceRunning && occupantsIll)
    || (gasOdourOrAlarm && gasRelatedSymptom)
    || immediateGasOrCoSymptomFollowUp;
  const gasEquipmentSignal = affirmedEquipmentSignal(
    activeMessage,
    /\b(?:gas|LPG|heater|cooktop|stove|oven|boiler)\b/i,
    /\b(?:hissing|smoke|smoking|burning smell|smell(?:s|ing)? burnt|unexpected flames?|flames?)\b/i,
    hasPriorEquipmentAnchor,
  );
  const gasSignal = gasOdourOrAlarm || gasHealthSignal || gasEquipmentSignal;
  if (gasOrCombustion && gasSignal) {
    if (scopedEquipmentSmokeOrFire || gasHealthSignal) {
      return safetyAnswer("Move everyone to fresh outdoor air and call 000 because there is a clear immediate risk from fire or possible carbon-monoxide exposure. Do not operate electrical switches, use a flame, relight the appliance or go back inside to investigate.");
    }
    return safetyAnswer("Move everyone to fresh outdoor air and contact the gas network fault line from outside. Do not operate electrical switches, use a flame, relight the appliance or go back inside to investigate. Keep the appliance off until a licensed gasfitter says it is safe.");
  }

  const battery = /\b(?:battery|home storage|BESS)\b/i.test(equipmentAnchor);
  const batterySignal = affirmedEquipmentSignal(
    activeMessage,
    /\b(?:battery|home storage|BESS)\b/i,
    /\b(?:(?:alarm|warning)(?: is|'s)? (?:sounding|alarming|going off|active)|continuous alarm|swollen|swelling|bulging|leaking|venting|hiss(?:ed|es|ing)?|fizzing|crackling|popping|chemical (?:smell|odou?r)|smell(?:s|ing)? burnt|(?:unusually|very|extremely|too) hot|overheating|smoke|smoking|smouldering|smoldering|burning|on fire|ablaze|alight|caught alight|caught fire|(?:has|have) caught fire|flame)\b/i,
    hasPriorEquipmentAnchor,
  );
  if (battery && batterySignal) {
    if (scopedEquipmentSmokeOrFire) {
      return safetyAnswer("Move everyone away from the battery and call 000 because visible smoke or fire is present. Do not touch, move, charge, unplug, reset or spray the battery, and wait outside for firefighters.");
    }
    return safetyAnswer("Stop using the battery, keep people clear and contact the installer or manufacturer urgently because the warning signs may indicate a fault. Do not touch, move, charge, unplug, reset or open it.");
  }

  const electricalEquipment = /\b(?:switchboard|meter box|electrical panel|main switch|inverter|solar isolator|DC isolator|isolator|EV charger|EV plug|charging plug|charging cable|powerboard|power board|power point|socket|outlet|electrical cables?|wiring|wires?|live wires?|toaster|microwave|washing machine|washer|dishwasher|fridge|refrigerator|television|TV|tumble dryer|clothes dryer|dryer|portable (?:electric )?heater|electric heater|fan heater|air conditioner|aircon|reverse[- ]?cycle|split system|heat pump)\b/i.test(equipmentAnchor);
  const electricalSignal = affirmedEquipmentSignal(
    activeMessage,
    /\b(?:switchboard|meter box|electrical panel|main switch|inverter|solar isolator|DC isolator|isolator|EV charger|EV plug|charging plug|charging cable|powerboard|power board|power point|socket|outlet|electrical cables?|wiring|wires?|live wires?|toaster|microwave|washing machine|washer|dishwasher|fridge|refrigerator|television|TV|tumble dryer|clothes dryer|dryer|portable (?:electric )?heater|electric heater|fan heater|air conditioner|aircon|reverse[- ]?cycle|split system|heat pump)\b/i,
    /\b(?:overheating|sparking|arcing|crackling|scorched|burnt|burning smell|smell(?:s|ing)? burnt|melting|smoke|smoking|smouldering|smoldering|on fire|ablaze|alight|caught alight|caught fire|(?:has|have) caught fire)\b/i,
    hasPriorEquipmentAnchor,
  );
  const abnormalEquipmentHeat = /\b(?:switchboard|meter box|electrical panel|main switch|inverter|solar isolator|DC isolator|EV charger|EV plug|charging plug|charging cable|powerboard|power board|power point|socket|outlet|electrical cables?|wiring|wires?|toaster|microwave|washing machine|washer|dishwasher|fridge|refrigerator|television|TV|tumble dryer|clothes dryer|dryer|portable (?:electric )?heater|electric heater|fan heater|air conditioner|aircon|reverse[- ]?cycle|split system|heat pump|appliance|unit|equipment|it)\b(?:['’]s|\s+(?:is|feels?|became|becomes|is becoming|is getting|gets?|runs?))\s+(?:(?:unusually|very|extremely|dangerously|too)\s+hot|(?:burning|smoking|red)[ -]?hot|hot\s+to\s+(?:the\s+)?touch)\b/i.test(activeMessage)
    && affirmed(activeMessage, /\b(?:(?:unusually|very|extremely|dangerously|too)\s+hot|(?:burning|smoking|red)[ -]?hot|hot\s+to\s+(?:the\s+)?touch)\b/i);
  const highRiskElectricalEquipment = /\b(?:switchboard|meter box|electrical panel|main switch|power point|socket|outlet|electrical cables?|wiring|wires?)\b/i.test(equipmentAnchor);
  const highRiskElectricalNoise = highRiskElectricalEquipment
    && affirmedEquipmentSignal(
      activeMessage,
      /\b(?:switchboard|meter box|electrical panel|main switch|power point|socket|outlet|electrical cables?|wiring|wires?)\b/i,
      /\b(?:buzzing|humming|vibrating)\b/i,
      hasPriorEquipmentAnchor,
    );
  const exposedElectricalMoisture = affirmed(activeMessage, /\b(?:water|rainwater|floodwater)\b[^.!?\n]{0,30}\b(?:is\s+)?(?:dripping|leaking|flowing|running|pouring)\b[^.!?\n]{0,25}\b(?:into|onto|through|inside|over)\b[^.!?\n]{0,25}\b(?:switchboard|meter box|electrical panel|main switch|inverter|solar isolator|DC isolator|EV charger|EV plug|charging plug|charging cable|power point|socket|outlet|electrical cables?|wiring|wires?|live wires?)\b|\b(?:rainwater|floodwater|water)\b[^.!?\n]{0,25}\b(?:dripping|leaking|flowing|running|pouring)\b[^.!?\n]{0,20}\b(?:beside|near)\b[^.!?\n]{0,20}\b(?:exposed electrical cables?|live electrical cables?|live wires?)\b|\b(?:switchboard|meter box|electrical panel|main switch|inverter|solar isolator|DC isolator|EV charger|EV plug|charging plug|charging cable|power point|socket|outlet|electrical cables?|wiring|wires?|live wires?)\b[^.!?\n]{0,20}\b(?:is|are|became|got|has become|have become)\b[^.!?\n]{0,12}\b(?:wet|flooded)\b|\b(?:switchboard|meter box|electrical panel|main switch|inverter|solar isolator|DC isolator|EV charger|power point|socket|outlet)\b[^.!?\n]{0,20}\b(?:has|have|contains?)\b[^.!?\n]{0,15}\b(?:water|rainwater|floodwater)\b[^.!?\n]{0,10}\b(?:in|inside)\b|\b(?:water|rainwater|floodwater)\b[^.!?\n]{0,18}\b(?:in|inside|into|got into)\b[^.!?\n]{0,18}\b(?:switchboard|meter box|electrical panel|main switch|inverter|solar isolator|DC isolator|EV charger|power point|socket|outlet)\b/i);
  if (electricalEquipment && (electricalSignal || abnormalEquipmentHeat || highRiskElectricalNoise
    || exposedElectricalMoisture || scopedEquipmentSmokeOrFire)) {
    if (scopedEquipmentSmokeOrFire) {
      return safetyAnswer("Move everyone away and call 000 because visible smoke or fire is present. Do not touch, reset, unplug, open, dry or pour water on the equipment, and wait outside for firefighters.");
    }
    return safetyAnswer("Keep people away and leave the equipment unused because the heat, noise, sparking or water may indicate a serious electrical fault. Do not touch, reset, unplug, open, dry or pour water on it. Call the electricity network or an urgent licensed electrician from a safe place.");
  }

  const refrigerantEquipment = /\b(?:air conditioner|aircon|reverse[- ]?cycle|split system|heat pump|refrigerant|refrigerant line|line set)\b/i.test(equipmentAnchor);
  const withoutWaterLeak = activeMessage.replace(/\b(?:(?:leak(?:ing|s|ed)?|drip(?:ping|s|ped)?)\s+(?:clear\s+)?water|water\b[^.!?\n]{0,30}\b(?:leak(?:ing|s|ed)?|drip(?:ping|s|ped)?))\b/gi, "condensate");
  const refrigerantMaterialSignal = affirmedEquipmentSignal(
    withoutWaterLeak,
    /\b(?:air conditioner|aircon|reverse[- ]?cycle|split system|heat pump|refrigerant|refrigerant line|line set)\b/i,
    /\b(?:oily (?:residue|fluid)|chemical (?:smell|odou?r)|fumes?|mist|damaged pipe|split pipe)\b/i,
    hasPriorEquipmentAnchor,
  );
  const explicitRefrigerantLeak = affirmed(withoutWaterLeak, /\b(?:refrigerant(?: line)?|line set)\b[^.!?\n]{0,35}\b(?:is\s+)?leak(?:ing|s|ed)?\b|\bleak(?:ing|s|ed)?\b[^.!?\n]{0,35}\brefrigerant\b/i);
  const refrigerantSignal = refrigerantMaterialSignal || explicitRefrigerantLeak;
  if (refrigerantEquipment && refrigerantSignal) {
    return safetyAnswer("Stop using the system and keep people away from the suspected leak. Ventilate from a safe position if that does not require approaching the equipment, and move outside if anyone feels dizzy, short of breath or unwell. Do not touch the pipework, search with a flame or release refrigerant. Arrange an appropriately licensed refrigeration technician.");
  }

  const explicitAsbestosConcern = /\b(?:asbestos|vermiculite|unknown loose insulation|old loose[- ]?fill insulation|old fibro|old fibre[- ]?cement|old fiber[- ]?cement)\b/i.test(equipmentAnchor);
  const insulationAtDownlight = /\b(?:insulation|loose[- ]?fill)\b[^.!?\n]{0,80}\b(?:touching|against|over|around|near)\b[^.!?\n]{0,50}\b(?:downlight|driver|transformer)\b|\b(?:downlight|driver|transformer)\b[^.!?\n]{0,50}\b(?:touching|against|covered by|near)\b[^.!?\n]{0,80}\binsulation\b/i.test(message);
  if (!explicitAsbestosConcern
    && insulationAtDownlight
    && affirmed(message, /\b(?:move|touch|inspect|shift|remove|clear)\b/i)) {
    return safetyAnswer("Do not touch or move the insulation yourself, and stop using the affected light until it has been checked. Heat, damaged wiring and incorrect downlight clearances can create a fire or shock risk. Have a licensed electrician confirm the light fitting, driver and required clearance before an insulation installer changes anything around it.");
  }

  const asbestos = explicitAsbestosConcern;
  const disturbance = affirmed(message, /\b(?:approach|inspect|touch|move|drill|cut|sand|break|remove|disturb|sample|test|collect|bag|scoop|saw|install through|make a hole)\b/i);
  if (asbestos && disturbance) {
    return safetyAnswer("Stop and do not disturb or sample the material yourself. Keep people out of the area and avoid drilling, cutting, sweeping, vacuuming or moving it, because appearance cannot confirm whether asbestos is present. Use an appropriately licensed asbestos assessor to identify it and set the safe work plan before any energy-upgrade work continues.");
  }

  if (explicitLiteralHomeFire) {
    return safetyAnswer("Move everyone away from the smoke or fire and call 000 from a safe place. Do not go inside or back into the affected area to investigate or collect belongings; wait for firefighters.");
  }

  if (explicitUncontrolledFire || scopedEquipmentSmokeOrFire) {
    return safetyAnswer("Move everyone away and call 000. Do not touch, unplug, reset, move or pour water on the smoking or burning equipment. If you can leave safely, wait outside and tell firefighters what appliance or energy equipment is involved.");
  }

  return null;
}
