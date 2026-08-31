import type { EnergyAssistantAnswer } from "./energy-assistant.ts";
import {
  SURGE_PLAN_CONTEXT_CORRECTION_VALUES,
  type SurgePlanContextCorrection,
  type SurgeConversationState,
} from "./energy-assistant-conversation.ts";
import type { SurgePlanContext } from "./energy-assistant-plan-context.ts";

type RecentTurn = {
  role: "user" | "assistant";
  content: string;
};

const PRIORITY_INTENT = /\b(?:where|how)\s+(?:(?:should|do|can|could)\s+)(?:I|we)\s+(?:start|begin)|\bwhere(?:'s| is)\s+(?:the\s+)?best\s+place\s+to\s+(?:start|begin|star)\b|\bwhat\s+(?:do|should|can|could)\s+(?:I|we)\s+(?:do|upgrade|fix|tackle|spend)(?:\s+on)?\s+first|\bwhat\s+should\s+be\s+(?:my|our|the)\s+first\s+priority|\bwhat\s+(?:is|comes)\s+(?:the\s+)?first(?:\s+(?:thing|priority|step))?(?:\s+to\s+(?:do|fix|upgrade|tackle))?|\bwhat\s+to\s+(?:do|fix|upgrade|tackle)\s+first|\b(?:prioritise|prioritize|rank)\s+(?:my|our|the)\s+(?:home|energy|upgrade|plan)|\b(?:start|begin|first|spend|priority)\b[^.!?\n]{0,90}\b(?:based\s+on|using|use|given|from)\s+(?:my|our|the)\s+(?:saved\s+)?(?:answers|survey|plan|details|home details|home context)\b|\b(?:based\s+on|using|use|given|from)\s+(?:my|our|the)\s+(?:saved\s+)?(?:answers|survey|plan|details|home details|home context)\b[^.!?\n]{0,110}\b(?:start|begin|first|spend|budget|priority|comfort|bills?)\b/i;
const TOPIC_SPECIFIC_PRIORITY_INTENT = /\b(?:solar|panels?|batter(?:y|ies)|quotes?|proposals?|tariffs?|heat pump|hot water|water heater|heating|heater|cooling|air ?con(?:ditioner|ditioning)?|insulation|windows?|glazing|draughts?|drafts?|doors?|roof|leaks?|condensation|damp|mould|mold|ventilation|switchboard|fuse box|EV|charger|rebates?|certificates?|STCs?|VEECs?|ESCs?|PRCs?|products?|models?|install(?:ation|ing)?)\b/i;
const EXPLICIT_CORRECTION = /\b(?:correction|actually|instead|no longer|has changed|have changed|I now (?:rent|own|live)|my (?:new )?postcode is|not (?:an? )?(?:owner|renter|apartment|unit|house))\b/i;
const CHANGE_NEGATED = /\b(?:not|never|wasn['’]?t|weren['’]?t|isn['’]?t|aren['’]?t|hasn['’]?t|haven['’]?t|hadn['’]?t|didn['’]?t)\b[^.!?\n]{0,28}\b(?:fix(?:ed)?|go(?:ne)?|clear(?:ed)?|resolv(?:e|ed)|repair(?:ed)?|seal(?:ed)?|stop(?:ped)?|remov(?:e|ed)|replac(?:e|ed)|upgrad(?:e|ed)|install(?:ed)?|add(?:ed)?|chang(?:e|ed)|new|double[- ]?glaz(?:e|ed))\b|^\s*(?:no\s+\w+|nobody\b|neither\b[^.!?\n]{0,80}\bnor\b)[^.!?\n]{0,100}\b(?:fixed|gone|cleared|resolved|repaired|sealed|stopped|removed|replaced|upgraded|installed|added|changed|new|double[- ]?glazed)\b/i;
const INFORMAL_CHANGE_NEGATED = /\b(?:not|never|wasn['’]?t|weren['’]?t|isn['’]?t|aren['’]?t|hasn['’]?t|haven['’]?t|hadn['’]?t|didn['’]?t)\b[^!?\n]{0,60}\b(?:put\s+in|went\s+in|got)\b|^\s*no\b[^!?\n]{0,80}\b(?:put\s+in|went\s+in|got)\b/i;
const CHANGE_REPORTED_OR_ASSUMED = /\b(?:thought|assumed|believed|hoped|suspected|was told|apparently|supposedly)\b[^.!?\n]{0,90}\b(?:fix(?:ed)?|gone|clear(?:ed)?|resolv(?:e|ed)|repair(?:ed)?|seal(?:ed)?|stop(?:ped)?|remov(?:e|ed)|replac(?:e|ed)|upgrad(?:e|ed)|install(?:ed)?|add(?:ed)?|chang(?:e|ed)|new|double[- ]?glaz(?:e|ed))\b/i;
const INFORMAL_CHANGE_NOT_ASSERTED = /\b(?:thought|assumed|believed|hoped|suspected|was told|apparently|supposedly)\b[^!?\n]{0,100}\b(?:put\s+in|went\s+in|got)\b|\b(?:want|need|plan|planned|planning|hope|intend|expect|would\s+like|had\s+a\s+plan)\b[^!?\n]{0,100}\b(?:put\s+in|went\s+in|got)\b/i;
const CHANGE_UNCERTAIN = /\b(?:maybe|perhaps|possibly|probably)\b[^.!?\n]{0,80}\b(?:fix(?:ed)?|gone|clear(?:ed)?|resolv(?:e|ed)|repair(?:ed)?|seal(?:ed)?|stop(?:ped)?|remov(?:e|ed)|replac(?:e|ed)|upgrad(?:e|ed)|install(?:ed)?|add(?:ed)?|chang(?:e|ed)|double[- ]?glaz(?:e|ed))\b|\b(?:may|might|could)\s+(?:have\s+|be\s+)?(?:fix(?:ed)?|gone|clear(?:ed)?|resolv(?:e|ed)|repair(?:ed)?|seal(?:ed)?|stop(?:ped)?|remov(?:e|ed)|replac(?:e|ed)|upgrad(?:e|ed)|install(?:ed)?|add(?:ed)?|chang(?:e|ed)|double[- ]?glaz(?:e|ed))\b|\bI\s+(?:think|guess|suppose|am\s+not\s+sure|['’]?m\s+not\s+sure)\b[^.!?\n]{0,80}\b(?:fix(?:ed)?|gone|clear(?:ed)?|resolv(?:e|ed)|repair(?:ed)?|seal(?:ed)?|stop(?:ped)?|remov(?:e|ed)|replac(?:e|ed)|upgrad(?:e|ed)|install(?:ed)?|add(?:ed)?|chang(?:e|ed)|double[- ]?glaz(?:e|ed))\b/i;
const CLAIM_UNCERTAIN = /\b(?:maybe|perhaps|possibly|probably|may|might)\b|\bI\s+(?:think|guess|suppose|am\s+not\s+sure|['’]?m\s+not\s+sure)\b/i;
const CHANGE_NOT_ASSERTED_COMPLETE = /^(?:is|are|was|were|has|have|had|do|does|did|can|could|would|should|will|what|which|why|who|how|where|when)\b|\b(?:want|need|plan|planning|hope|intend|expect|would like)\b[^.!?\n]{0,80}\b(?:fixed|resolved|repaired|sealed|removed|replaced|upgraded|installed|added|changed|double[- ]?glazed)\b|\b(?:if|once|when|after|whether)\b[^.!?\n]{0,100}\b(?:fixed|resolved|repaired|sealed|removed|replaced|upgraded|installed|added|changed|double[- ]?glazed)\b|\b(?:will|going to|scheduled to|due to)\b[^.!?\n]{0,60}\b(?:fix|resolve|repair|seal|remove|replace|upgrade|install|add|change|be fixed|be replaced|be upgraded|be installed)\b|\b(?:quote|proposal|installer|builder|tradie|contractor)\b[^.!?\n]{0,60}\b(?:says|said|states|stated|shows|showed|lists?|includes?|covers?|prices?|quotes?|proposes?|will|would)\b/i;
const FACET_QUOTE_CONTEXT = /\b(?:quotes?|quoted|quotation|proposal|proposed|option|price|booking|invoice|ad|advert(?:isement)?|listing|reports?|documents?|inspection|questions?|information|info|advice|details?|query|enquir(?:y|ies))\b/i;
const REPORTED_CHANGE_CONTEXT = /\b(?:apparently|supposedly|according\s+to|read|heard|told|says?|said|claims?|claimed|reports?|reported|states?|stated|shows?|showed|alleges?|alleged)\b/i;
const FACET_ACCESSORY_CONTEXT = /\b(?:windows?\s+(?:coverings?|blinds?|curtains?|films?|screens?)|battery\s+(?:monitor(?:ing)?|meter|controller|app)|solar\s+(?:monitor(?:ing)?|meter|controller|app)|(?:heater|heating|air ?con(?:ditioner|ditioning)?)\s+(?:thermostat|controller|timer|remote)|hot[- ]?water\s+(?:timer|controller|monitor(?:ing)?|meter)|switchboard\s+(?:label|cover|door|monitor(?:ing)?|meter)|insulation\s+(?:monitor(?:ing)?|sensors?|report|inspection))\b/i;
const MOISTURE_ACTIVE_AGAIN = /\b(?:condensation|damp|moisture|mould|mold)\b[^.!?\n]{0,55}\b(?:(?:is|are|was|were|came|come)\s+back|(?:has|have)\s+(?:come\s+back|returned|recurred)|returned|recurred|persists?|remains?|is\s+still\s+(?:there|present|happening|a problem)|is\s+(?:happening|a problem)\s+again)\b|\b(?:back|returned|recurred|persists?|remains?)\b[^.!?\n]{0,55}\b(?:condensation|damp|moisture|mould|mold)\b/i;
const CONTEXTUAL_MOISTURE_ACTIVE_AGAIN = /\b(?:actually[, ]*)?(?:it|that)\s+(?:is|was|has come)\s+back\b|\b(?:it|that)\s+(?:is|was)\s+(?:still there|still a problem|happening again)\b/i;
const SHARED_CHANGE_ACTION = /\b(?:(?:(?:did|was|were|is|are|has|have|had)\s+)?(?:not|never)\s+)?(?:fix(?:ed)?|gone|clear(?:ed)?|resolv(?:e|ed)|repair(?:ed)?|seal(?:ed)?|stop(?:ped)?|remov(?:e|ed)|replac(?:e|ed)|upgrad(?:e|ed)|install(?:ed)?|add(?:ed)?|chang(?:e|ed)|double[- ]?glaz(?:e|ed))\b/i;
const SHARED_NONASSERTION_LEAD = /^\s*((?:if|once|when|after|whether|maybe|perhaps|possibly|probably)\b|(?:I|we)\s+(?:think|guess|suppose|want|need|plan|hope|intend|expect)\b|(?:is|are|was|were|has|have|had|do|does|did|can|could|would|should|will|what|which|why|who|how|where)\b)/i;
const COORDINATED_HOME_OBJECT_FRAGMENT = /^(?:(?:the|our|my|a|an)\s+)?(?:(?:old|existing|current|original|bedroom|bathroom|kitchen|roof|ceiling|wall|floor)\s+){0,2}(?:condensation|damp|moisture|mould|mold|draughts?|drafts?|air leaks?|roof leaks?|roof damage|windows?|glazing|glass|insulation|switchboard|heater|heating|air ?con(?:ditioner|ditioning)?|exhaust fans?|rangehood|solar(?: panels?| system)?|battery(?: system)?|hot[- ]?water(?: system)?)$/i;
const OTHER_HOME_REFERENCE = /\b(?:mum(?:'s)?|mom(?:'s)?|dad(?:'s)?|mother(?:'s)?|father(?:'s)?|sister(?:'s)?|brother(?:'s)?|friend(?:'s)?|neighbou?r(?:'s)?|client(?:'s)?|customer(?:'s)?|tenant(?:'s)?|landlord(?:'s)?|builder['’]s|installer['’]s|tradie['’]s|contractor['’]s|(?:his|her|their)\s+(?:home|house|place|property|apartment|unit|residence)|(?:(?:my|our|the)\s+)?(?:investment|rental|holiday|vacation|weekend|secondary|second|other|another|different|new|old|previous|former|prior)\s+(?:home(?!\s+(?:battery|storage)\b)|house|place|property|apartment|unit|residence)|(?:my|our|the)\s+(?:beach\s+house|weekender|airbnb)|(?:my|our|the)\s+(?:office|shop|warehouse|workplace|business|commercial\s+(?:site|property))|(?:at|in|for|on)\s+(?:my|our|the|a|an)\s+(?:rental|investment)(?:\s+property)?|(?:at|in|for)\s+(?:(?:my|our|the|a|an)\s+)?(?:office|shop|warehouse|workplace|business|work|site))\b/i;
const EXPLICIT_SAVED_HOME_DESTINATION = /\b(?:in|at|for|on)\s+(?:my|our)\s+(?:(?:saved|main|current|own)\s+)?(?:home|house|place|property|apartment|unit)\b/i;
const SAVED_HOME_PROPERTY_REFERENCE = /\b(?:my|our)\s+(?:home|house|place|property|apartment|unit|roof|windows?|glazing|insulation|switchboard|heater|heating|air ?con(?:ditioner|ditioning)?|exhaust fans?|rangehood|solar(?: panels?| system)?|battery(?: system)?|hot[- ]?water(?: system)?)\b/i;

const COMPLETED_FACET_ACTION = String.raw`(?:replaced|upgraded|installed|added|removed|fixed|repaired|changed|double[- ]?glazed)`;
const FACET_OBJECT_SPECIFIER = String.raw`(?:(?:(?:\d+(?:\.\d+)?|R\d+(?:\.\d+)?|one|two|three|four|five|six|seven|eight|nine|ten)\s*(?:kW|kWh|litres?|L)?\s+(?:of\s+)?)?)`;
const FACET_OBJECT_MODIFIER = String.raw`(?:(?:old|new|brand[- ]?new|existing|current|original|bedroom|bathroom|kitchen|roof|ceiling|wall|floor|home|gas|ducted|electric|reverse[- ]?cycle|heat[- ]?pump)\s+){0,3}`;

function completedFacetChangePattern(topic: string) {
  const namedTopic = String.raw`(?:${topic})`;
  return new RegExp([
    String.raw`\b${namedTopic}\b\s+(?:(?:is|are|was|were|has|have|had)(?:\s+been)?\s+)?${COMPLETED_FACET_ACTION}\b`,
    String.raw`\b${COMPLETED_FACET_ACTION}\s+(?:(?:the|our|my|a|an)\s+)?${FACET_OBJECT_SPECIFIER}${FACET_OBJECT_MODIFIER}${namedTopic}\b`,
    String.raw`\b(?:replaced|upgraded|changed|swapped)\b[^!?\n]{0,90}\b(?:with|to)\s+[^!?\n]{0,55}\b${namedTopic}\b`,
    String.raw`\b(?:I|we)\s+had\b[^!?\n]{0,55}\b${namedTopic}\b[^!?\n]{0,30}\b(?:put|fitted|installed)\s+in\b`,
    String.raw`\b${namedTopic}\b[^!?\n]{0,25}\bwent\s+in\b`,
    String.raw`\b(?:I|we)\s+got\s+(?:(?:the|our|my|a|an)\s+)?${FACET_OBJECT_SPECIFIER}${FACET_OBJECT_MODIFIER}${namedTopic}\b`,
    String.raw`\b(?:got|have|has|installed|fitted)\s+(?:(?:the|our|my|a|an)\s+)?(?:brand[- ]?)?new\s+${namedTopic}\b`,
    String.raw`\b${namedTopic}\b\s+(?:is|are|was|were)\s+(?:brand[- ]?)?new\b`,
  ].join("|"), "i");
}

function completedIssueResolutionPattern(topic: string) {
  const namedTopic = String.raw`(?:${topic})`;
  const resolvedState = String.raw`(?:fixed|gone|cleared|resolved|repaired|sealed|stopped|removed|dry|no\s+longer)`;
  const resolvedAction = String.raw`(?:fixed|cleared|resolved|repaired|sealed|stopped|removed)`;
  return new RegExp([
    String.raw`\b${namedTopic}\b\s+(?:(?:is|are|was|were|has|have|had)(?:\s+been)?\s+)?${resolvedState}\b`,
    String.raw`\b${resolvedAction}\s+(?:(?:the|our|my|a|an)\s+)?${FACET_OBJECT_SPECIFIER}${FACET_OBJECT_MODIFIER}${namedTopic}\b`,
  ].join("|"), "i");
}

const RESOLVED_MOISTURE = completedIssueResolutionPattern("condensation|damp|moisture|mould|mold");

const CORRECTED_PLAN_FACT_GROUPS = [
  {
    correction: "comfort_moisture_resolved",
    pattern: RESOLVED_MOISTURE,
    currentState: /\b(?:there\s+(?:is|are)|we\s+(?:now\s+)?have|our\s+home\s+has)\s+no\s+(?:condensation|damp|moisture|mould|mold)\b|\b(?:condensation|damp|moisture|mould|mold)\s+(?:is|are)\s+(?:now\s+)?(?:absent|gone|clear)\b/i,
    topic: /\b(?:condensation|damp|moisture|mould|mold)\b/i,
    activeAgain: MOISTURE_ACTIVE_AGAIN,
    keys: ["comfort_concerns"],
  },
  {
    correction: "comfort_draught_resolved",
    pattern: completedIssueResolutionPattern("draughts?|drafts?|air leaks?"),
    currentState: /\b(?:there\s+(?:is|are)|we\s+(?:now\s+)?have|our\s+home\s+has)\s+no\s+(?:draughts?|drafts?|air leaks?)\b|\b(?:draughts?|drafts?|air leaks?)\s+(?:is|are)\s+(?:now\s+)?(?:absent|gone|sealed)\b/i,
    topic: /\b(?:draughts?|drafts?|air leaks?)\b/i,
    activeAgain: /\b(?:draughts?|drafts?|air leaks?)\b[^.!?\n]{0,45}\b(?:(?:is|are|was|were|came|come)\s+back|returned|still (?:there|present|happening|a problem)|happening again|persists?|remains?)\b/i,
    keys: ["comfort_concerns"],
  },
  {
    correction: "roof_condition_changed",
    pattern: completedIssueResolutionPattern("roof leaks?|roof damage"),
    currentState: /\broof\s+(?:is\s+)?(?:now\s+)?(?:sound|watertight|leak[- ]?free)\b|\broof\b[^.!?\n]{0,24}\bhas\s+no\s+leaks?\b|\bno\s+roof\s+leaks?\b/i,
    topic: /\broof\b/i,
    activeAgain: /\b(?:roof leaks?|roof damage)\b[^.!?\n]{0,45}\b(?:(?:is|are|was|were|came|come)\s+back|returned|still (?:there|present|happening|a problem)|happening again|persists?|remains?)\b/i,
    keys: ["roof_condition"],
  },
  {
    correction: "glazing_changed",
    pattern: completedFacetChangePattern("windows?|glazing|glass"),
    currentState: /\b(?:we|I)\s+(?:now\s+)?have\s+(?:(?:full|mostly|all)\s+)?double[- ]?glaz(?:ing|ed\s+windows?)\b|\bwindows?\s+(?:is|are)\s+(?:now\s+)?double[- ]?glazed\b|\bdouble[- ]?glazing\s+now\b/i,
    topic: /\b(?:windows?|glazing|glass)\b/i,
    activeAgain: /\b(?:windows?|glazing|glass)\b[^.!?\n]{0,55}\b(?:are|is|remain(?:s)?)\s+(?:still\s+)?(?:single[- ]?glazed|the\s+(?:same|original)|unchanged)\b|\b(?:still\s+)?single[- ]?glazed\b[^.!?\n]{0,45}\b(?:windows?|glazing|glass)\b/i,
    keys: ["glazing"],
  },
  {
    correction: "ceiling_insulation_changed",
    pattern: completedFacetChangePattern("ceiling\\s+insulation"),
    currentState: /\b(?:there\s+is|we\s+(?:now\s+)?have|our\s+home\s+has)\s+(?:good|adequate|full)\s+ceiling\s+insulation\b|\bceiling\s+insulation\s+(?:is\s+)?(?:now\s+)?(?:good|adequate)\b/i,
    topic: /\bceiling\s+insulation\b/i,
    activeAgain: /\bceiling\s+insulation\b[^.!?\n]{0,55}\b(?:is|remains?|still)?\s*(?:old|patchy|inadequate|missing|unchanged|not upgraded|not installed)\b|\b(?:still\s+)?(?:no ceiling insulation|ceiling\s+uninsulated)\b/i,
    keys: ["ceiling_insulation"],
  },
  {
    correction: "wall_insulation_changed",
    pattern: completedFacetChangePattern("wall\\s+insulation"),
    currentState: /\b(?:there\s+is|we\s+(?:now\s+)?have|our\s+home\s+has)\s+(?:good|adequate|full)\s+wall\s+insulation\b|\bwall\s+insulation\s+(?:is\s+)?(?:now\s+)?(?:good|adequate)\b/i,
    topic: /\bwall\s+insulation\b/i,
    activeAgain: /\bwall\s+insulation\b[^.!?\n]{0,55}\b(?:is|remains?|still)?\s*(?:old|patchy|inadequate|missing|unchanged|not upgraded|not installed)\b|\b(?:still\s+)?(?:no wall insulation|walls?\s+uninsulated)\b/i,
    keys: ["wall_insulation"],
  },
  {
    correction: "floor_insulation_changed",
    pattern: completedFacetChangePattern("floor\\s+insulation"),
    currentState: /\b(?:there\s+is|we\s+(?:now\s+)?have|our\s+home\s+has)\s+(?:good|adequate|full)\s+floor\s+insulation\b|\bfloor\s+insulation\s+(?:is\s+)?(?:now\s+)?(?:good|adequate)\b/i,
    topic: /\bfloor\s+insulation\b/i,
    activeAgain: /\bfloor\s+insulation\b[^.!?\n]{0,55}\b(?:is|remains?|still)?\s*(?:old|patchy|inadequate|missing|unchanged|not upgraded|not installed)\b|\b(?:still\s+)?(?:no floor insulation|floor\s+uninsulated)\b/i,
    keys: ["floor_insulation"],
  },
  {
    correction: "insulation_changed",
    pattern: completedFacetChangePattern("insulation"),
    currentState: /\b(?:there\s+is|we\s+(?:now\s+)?have|our\s+home\s+has)\s+(?:good|adequate|full)\s+insulation\b|\binsulation\s+(?:is\s+)?(?:now\s+)?(?:good|adequate)\b/i,
    topic: /\binsulation\b/i,
    excludeTopic: /\b(?:ceiling|wall|floor)\s+insulation\b/i,
    activeAgain: /\b(?:insulation|uninsulated)\b[^.!?\n]{0,55}\b(?:is|are|remains?|still)?\s*(?:old|patchy|inadequate|missing|unchanged|not upgraded|not installed)\b|\b(?:still\s+)?(?:no insulation|uninsulated)\b/i,
    keys: ["ceiling_insulation", "wall_insulation", "floor_insulation"],
  },
  {
    correction: "switchboard_changed",
    pattern: completedFacetChangePattern("switchboard"),
    currentState: /\bswitchboard\s+(?:now\s+)?(?:has|uses)\s+(?:modern\s+)?circuit breakers?\b|\b(?:we|I)\s+(?:now\s+)?have\s+(?:a\s+)?(?:modern\s+)?switchboard\b/i,
    topic: /\bswitchboard\b/i,
    activeAgain: /\bswitchboard\b[^.!?\n]{0,55}\b(?:is|has|remains?|still)?\s*(?:old|unchanged|ceramic fuses?|older fuses?|not upgraded|not replaced)\b|\b(?:still\s+)?(?:ceramic|older)\s+fuses?\b[^.!?\n]{0,35}\bswitchboard\b/i,
    keys: ["switchboard"],
  },
  {
    correction: "heating_cooling_changed",
    pattern: completedFacetChangePattern("heater|heating(?:\\s+system)?|air ?con(?:ditioner|ditioning)?"),
    currentState: /\b(?:we|I)\s+(?:now\s+)?(?:use|have)\s+(?:a\s+)?(?:reverse[- ]?cycle|heat[- ]?pump)\s+(?:heater|heating|air ?con(?:ditioner|ditioning)?)\b|\bheating\s+(?:is|uses)\s+(?:now\s+)?(?:reverse[- ]?cycle|heat[- ]?pump)\b/i,
    topic: /\b(?:heater|heating|air ?con(?:ditioner|ditioning)?)\b/i,
    activeAgain: /\b(?:still\s+)?(?:use|uses|using|have|has)\b[^.!?\n]{0,35}\b(?:old|existing|same|gas)\s+(?:heater|heating|air ?con(?:ditioner|ditioning)?)\b|\b(?:heater|heating|air ?con(?:ditioner|ditioning)?)\b[^.!?\n]{0,45}\b(?:is|remains?)\s+(?:old|unchanged|the same|not replaced)\b/i,
    keys: ["heating_cooling_systems"],
  },
  {
    correction: "exhaust_changed",
    pattern: completedFacetChangePattern("exhaust fans?|rangehood"),
    currentState: /\b(?:we|I)\s+(?:now\s+)?have\s+(?:a\s+)?(?:(?:bathroom|kitchen)\s+)?(?:exhaust fan|rangehood)\b|\bthere\s+is\s+(?:now\s+)?(?:a\s+)?(?:(?:bathroom|kitchen)\s+)?(?:exhaust fan|rangehood)\b/i,
    topic: /\b(?:exhaust fans?|rangehood)\b/i,
    activeAgain: /\b(?:still\s+)?(?:no|without)\b[^.!?\n]{0,25}\b(?:exhaust fans?|rangehood)\b|\b(?:exhaust fans?|rangehood)\b[^.!?\n]{0,45}\b(?:is|are|remains?)\s+(?:missing|absent|unchanged|not installed|not working)\b/i,
    keys: ["exhaust_fans"],
  },
  {
    correction: "solar_changed",
    pattern: completedFacetChangePattern("solar(?:\\s+(?:panels?|system))?"),
    currentState: /\b(?:we|I)\s+(?:now\s+)?have\s+solar(?:\s+(?:panels?|system))?\b|\bsolar(?:\s+(?:panels?|system))?\s+(?:is|are)\s+(?:now\s+)?(?:present|operating|on\s+the\s+home)\b/i,
    topic: /\bsolar\b/i,
    activeAgain: /\b(?:still\s+)?(?:do not|don['’]?t|does not|doesn['’]?t|no|without)\b[^.!?\n]{0,30}\b(?:have\s+)?solar\b|\bsolar\b[^.!?\n]{0,40}\b(?:is|remains?)\s+(?:absent|not installed|unchanged)\b/i,
    keys: ["solar"],
  },
  {
    correction: "battery_changed",
    pattern: completedFacetChangePattern("battery(?:\\s+system)?"),
    currentState: /\b(?:we|I)\s+(?:now\s+)?have\s+(?:a\s+)?(?:home\s+)?battery(?:\s+system)?\b|\b(?:home\s+)?battery(?:\s+system)?\s+(?:is|are)\s+(?:now\s+)?(?:present|operating)\b/i,
    topic: /\bbattery\b/i,
    activeAgain: /\b(?:still\s+)?(?:do not|don['’]?t|does not|doesn['’]?t|no|without)\b[^.!?\n]{0,30}\b(?:have\s+)?(?:a\s+)?battery\b|\bbattery\b[^.!?\n]{0,40}\b(?:is|remains?)\s+(?:absent|not installed|unchanged)\b/i,
    keys: ["battery"],
  },
  {
    correction: "hot_water_changed",
    pattern: completedFacetChangePattern("hot[- ]?water(?:\\s+system)?"),
    currentState: /\b(?:our|the|my)\s+hot[- ]?water(?:\s+system)?\s+(?:is|uses)\s+(?:now\s+)?(?:a\s+)?heat[- ]?pump\b|\b(?:we|I)\s+(?:now\s+)?have\s+(?:a\s+)?heat[- ]?pump\s+hot[- ]?water(?:\s+system)?\b/i,
    topic: /\bhot[- ]?water\b/i,
    activeAgain: /\bhot[- ]?water\b[^.!?\n]{0,55}\b(?:is|remains?|still)?\s*(?:old|unchanged|the same|electric resistive|resistive|not replaced|not upgraded)\b/i,
    keys: ["hot_water"],
  },
] as const;

function recentUserFactMessages(
  message: string,
  recentTurns: readonly RecentTurn[] = [],
) {
  return [message, ...recentTurns
    .filter((turn) => turn.role === "user" && !turn.content.startsWith("Customer supplied home context:"))
    .map((turn) => turn.content)
    .reverse()];
}

function canCorrectSelectedSavedHome(content: string) {
  return !OTHER_HOME_REFERENCE.test(content) || EXPLICIT_SAVED_HOME_DESTINATION.test(content);
}

function materialClauses(content: string) {
  const sharedMessageNonAssertionLead = content.match(SHARED_NONASSERTION_LEAD)?.[1] || "";
  return content
    .split(/(?:(?<!\d)\.|\.(?!\d)|[!?;\n]+|\b(?:but|however|although|whereas)\b)/i)
    .flatMap((contrastClause, contrastIndex) => {
      const clauses = contrastClause
        .split(/\band\b/i)
        .map((clause) => clause.trim().replace(/^,\s*/, ""))
        .filter(Boolean);
      const actions = clauses.map((clause) => clause.match(SHARED_CHANGE_ACTION)?.[0] || "");
      const sharedNonAssertionLead = clauses[0]?.match(SHARED_NONASSERTION_LEAD)?.[1] || "";
      const sharedFirstPersonSubject = !sharedNonAssertionLead
        && clauses[0]
        && !REPORTED_CHANGE_CONTEXT.test(clauses[0])
        ? clauses[0].match(/^\s*(I|we)\b/i)?.[1] || ""
        : "";
      return clauses.map((clause, index) => {
        let framedClause = index > 0 && sharedNonAssertionLead
          ? `${sharedNonAssertionLead} ${clause}`
          : clause;
        if (index > 0
          && sharedFirstPersonSubject
          && !/^\s*(?:I|we)\b/i.test(framedClause)) {
          framedClause = `${sharedFirstPersonSubject} ${framedClause}`;
        }
        if (contrastIndex > 0
          && sharedMessageNonAssertionLead
          && !/^\s*(?:I|we)\b/i.test(clause)) {
          framedClause = `${sharedMessageNonAssertionLead} ${framedClause}`;
        }
        if (actions[index]) return framedClause;
        if (!COORDINATED_HOME_OBJECT_FRAGMENT.test(clause)) return framedClause;
        const inheritedAction = actions.slice(0, index).reverse().find(Boolean)
          || actions.slice(index + 1).find(Boolean);
        return inheritedAction ? `${framedClause} ${inheritedAction}` : framedClause;
      });
    });
}

function hasTrustedActiveChangeSubject(
  clause: string,
  group: typeof CORRECTED_PLAN_FACT_GROUPS[number],
) {
  const action = clause.match(SHARED_CHANGE_ACTION);
  const topic = clause.match(group.topic);
  if (!action || action.index === undefined || !topic || topic.index === undefined) return true;
  if (action.index >= topic.index) return true;
  const subject = clause.slice(0, action.index);
  if (/\b(?:I|we)\b/i.test(subject)) return true;
  return EXPLICIT_SAVED_HOME_DESTINATION.test(clause)
    || SAVED_HOME_PROPERTY_REFERENCE.test(clause.slice(action.index));
}

function groupChangeState(
  group: typeof CORRECTED_PLAN_FACT_GROUPS[number],
  messages: readonly string[],
  existing: ReadonlySet<SurgePlanContextCorrection>,
): "affirmed" | "withdrawn" | null {
  for (const [messageIndex, content] of messages.entries()) {
    if (messageIndex === 0
      && group.correction === "comfort_moisture_resolved"
      && CONTEXTUAL_MOISTURE_ACTIVE_AGAIN.test(content)) {
      const nearestPriorTopic = messages.slice(1).find((prior) => (
        CORRECTED_PLAN_FACT_GROUPS.some((candidate) => candidate.topic.test(prior))
      ));
      const contextIdentifiesSavedHomeMoisture = nearestPriorTopic
        ? canCorrectSelectedSavedHome(nearestPriorTopic) && group.topic.test(nearestPriorTopic)
        : existing.size === 1 && existing.has(group.correction);
      if (contextIdentifiesSavedHomeMoisture) return "withdrawn";
    }
    if (!canCorrectSelectedSavedHome(content) || !group.topic.test(content)) continue;
    const clauses = materialClauses(content);
    const soleQuestion = clauses.length === 1 && /\?\s*$/.test(content);
    for (const clause of clauses.reverse()) {
      if (!canCorrectSelectedSavedHome(clause) || !group.topic.test(clause)) continue;
      if ("excludeTopic" in group && group.excludeTopic.test(clause)) continue;
      if (soleQuestion
        || CHANGE_NOT_ASSERTED_COMPLETE.test(clause)
        || INFORMAL_CHANGE_NOT_ASSERTED.test(clause)) continue;
      if (FACET_QUOTE_CONTEXT.test(clause) || REPORTED_CHANGE_CONTEXT.test(clause)) continue;
      if (FACET_ACCESSORY_CONTEXT.test(clause)) continue;
      if (CLAIM_UNCERTAIN.test(clause)
        || CHANGE_UNCERTAIN.test(clause)
        || CHANGE_REPORTED_OR_ASSUMED.test(clause)) {
        if (existing.has(group.correction)) return "withdrawn";
        continue;
      }
      if ("activeAgain" in group && group.activeAgain.test(clause)) return "withdrawn";
      if (CHANGE_NEGATED.test(clause) || INFORMAL_CHANGE_NEGATED.test(clause)) return "withdrawn";
      if (!hasTrustedActiveChangeSubject(clause, group)) continue;
      if (group.pattern.test(clause)
        || ("currentState" in group && group.currentState.test(clause))) return "affirmed";
    }
  }
  return null;
}

export function surgePlanContextCorrectionsAfterRecentHomeFactChanges(
  existing: readonly SurgePlanContextCorrection[] = [],
  message: string,
  recentTurns: readonly RecentTurn[] = [],
) {
  const messages = recentUserFactMessages(message, recentTurns);
  const corrections = new Set<SurgePlanContextCorrection>(existing);
  for (const group of CORRECTED_PLAN_FACT_GROUPS) {
    const state = groupChangeState(group, messages, corrections);
    if (state === "affirmed") corrections.add(group.correction);
    if (state === "withdrawn") corrections.delete(group.correction);
  }
  return SURGE_PLAN_CONTEXT_CORRECTION_VALUES.filter((value) => corrections.has(value));
}

const SAVED_PLAN_UPDATE_FACT_PREFIX = "saved_plan_update_";

function correctionForSavedPlanUpdateFact(key: string): SurgePlanContextCorrection | null {
  if (!key.startsWith(SAVED_PLAN_UPDATE_FACT_PREFIX)) return null;
  const correction = key.slice(SAVED_PLAN_UPDATE_FACT_PREFIX.length);
  return SURGE_PLAN_CONTEXT_CORRECTION_VALUES.includes(correction as SurgePlanContextCorrection)
    ? correction as SurgePlanContextCorrection
    : null;
}

export function surgeSavedPlanCorrectionFactsForMessage(
  message: string,
  corrections: readonly SurgePlanContextCorrection[],
) {
  const cleanMessage = message.replace(/\s+/g, " ").trim();
  return corrections.flatMap((correction) => {
    const group = CORRECTED_PLAN_FACT_GROUPS.find((candidate) => candidate.correction === correction);
    if (!group) return [];
    const scopedValue = [...materialClauses(cleanMessage)].reverse().find((clause) => (
      canCorrectSelectedSavedHome(clause)
      && group.topic.test(clause)
      && groupChangeState(
        group,
        [clause],
        new Set<SurgePlanContextCorrection>(),
      ) === "affirmed"
    )) || "";
    const replacementResult = scopedValue.match(
      /\b(?:replaced|upgraded|changed|swapped)\b[^!?\n]{0,100}\b(?:with|to)\s+(.+)$/i,
    )?.[1]?.trim() || "";
    const currentValue = replacementResult && group.topic.test(replacementResult)
      ? replacementResult
      : scopedValue;
    const value = currentValue.replace(/\s+/g, " ").trim().slice(0, 220);
    return value
      ? [{ key: `${SAVED_PLAN_UPDATE_FACT_PREFIX}${correction}`, value }]
      : [];
  });
}

export function surgeHasRecentMaterialHomeFactChange(
  message: string,
  recentTurns: readonly RecentTurn[] = [],
) {
  return surgePlanContextCorrectionsAfterRecentHomeFactChanges([], message, recentTurns).length > 0;
}

export function surgeHasRecentResolvedMoistureConcern(
  message: string,
  recentTurns: readonly RecentTurn[] = [],
) {
  return surgePlanContextCorrectionsAfterRecentHomeFactChanges([], message, recentTurns)
    .includes("comfort_moisture_resolved");
}

function withoutListValue(value: string, removedValue: string) {
  const index = value.indexOf(removedValue);
  if (index < 0) return value;
  const before = value.slice(0, index).replace(/,\s*$/, "").trim();
  const after = value.slice(index + removedValue.length).replace(/^,\s*/, "").trim();
  return [before, after].filter(Boolean).join(", ");
}

function applyCorrectionsToFacts<T extends { key: string; value: string }>(
  facts: readonly T[],
  corrections: readonly SurgePlanContextCorrection[],
  dropNoncanonicalRetiredText = false,
) {
  const retired = new Set(corrections);
  const fullyRetiredKeys = new Set<string>();
  for (const group of CORRECTED_PLAN_FACT_GROUPS) {
    if (!retired.has(group.correction)
      || group.correction === "comfort_moisture_resolved"
      || group.correction === "comfort_draught_resolved") continue;
    for (const key of group.keys) fullyRetiredKeys.add(key);
  }
  return facts.flatMap((fact) => {
    const savedPlanUpdate = correctionForSavedPlanUpdateFact(fact.key);
    if (savedPlanUpdate) return retired.has(savedPlanUpdate) ? [fact] : [];
    if (fullyRetiredKeys.has(fact.key)) return [];
    if (fact.key !== "comfort_concerns") {
      return dropNoncanonicalRetiredText
        && mentionsRetiredPlanFact(fact.value, corrections)
        ? []
        : [fact];
    }
    let value = fact.value;
    if (retired.has("comfort_moisture_resolved")) {
      value = withoutListValue(value, "Condensation, damp or mould");
    }
    if (retired.has("comfort_draught_resolved")) {
      value = withoutListValue(value, "Noticeable unwanted draughts");
    }
    if (dropNoncanonicalRetiredText && mentionsRetiredPlanFact(value, corrections)) return [];
    return value ? [{ ...fact, value }] : [];
  });
}

export function applySurgePlanContextCorrections(
  context: SurgePlanContext | null,
  corrections: readonly SurgePlanContextCorrection[] = [],
): SurgePlanContext | null {
  if (!context || !corrections.length) return context;
  const facts = applyCorrectionsToFacts(context.facts, corrections);
  return facts.length ? { ...context, facts } : null;
}

const RETIRED_TEXT_PATTERNS: Record<SurgePlanContextCorrection, RegExp> = {
  comfort_moisture_resolved: /\b(?:condensation|damp|moisture|mould|mold)\b/i,
  comfort_draught_resolved: /\b(?:draughts?|drafts?|air leaks?)\b/i,
  roof_condition_changed: /\b(?:roof leaks?|roof damage|roof condition)\b/i,
  glazing_changed: /\b(?:windows?|glazing|glass|single[- ]?glazed|double[- ]?glazed)\b/i,
  ceiling_insulation_changed: /\bceiling\s+insulation\b/i,
  wall_insulation_changed: /\bwall\s+insulation\b/i,
  floor_insulation_changed: /\bfloor\s+insulation\b/i,
  insulation_changed: /\b(?:insulation|uninsulated)\b/i,
  switchboard_changed: /\b(?:switchboard|fuses?)\b/i,
  heating_cooling_changed: /\b(?:heater|heating|air ?con(?:ditioner|ditioning)?|cooling)\b/i,
  exhaust_changed: /\b(?:exhaust fans?|rangehood)\b/i,
  solar_changed: /\b(?:solar|panels?|inverter)\b/i,
  battery_changed: /\b(?:battery|batteries)\b/i,
  hot_water_changed: /\b(?:hot[- ]?water|water heater)\b/i,
};

function mentionsRetiredPlanFact(
  value: string,
  corrections: readonly SurgePlanContextCorrection[],
) {
  return corrections.some((correction) => RETIRED_TEXT_PATTERNS[correction].test(value));
}

/** Removes superseded saved-home plan claims from every model-visible state capsule. */
export function applySurgePlanContextCorrectionsToConversationState(
  state: SurgeConversationState,
  corrections: readonly SurgePlanContextCorrection[] = [],
): SurgeConversationState {
  const savedHomeDecisionIds = new Set((state.ledger?.decisions || [])
    .filter((decision) => decision.subjectIds.includes("saved_home"))
    .map((decision) => decision.id));
  const activeUsesSavedHome = !state.ledger
    || savedHomeDecisionIds.has(state.ledger.activeDecisionId);
  const scrubText = (value: string, fallback = "") => (
    mentionsRetiredPlanFact(value, corrections) ? fallback : value
  );
  const facts = activeUsesSavedHome
    ? applyCorrectionsToFacts(state.facts, corrections, true)
    : state.facts;
  return {
    ...state,
    facts,
    goal: activeUsesSavedHome
      ? scrubText(state.goal, "Continue the saved-home energy decision")
      : state.goal,
    pendingQuestion: activeUsesSavedHome ? scrubText(state.pendingQuestion) : state.pendingQuestion,
    lastAnswerSummary: activeUsesSavedHome
      ? scrubText(state.lastAnswerSummary)
      : state.lastAnswerSummary,
    ...(state.ledger ? {
      ledger: {
        ...state.ledger,
        subjects: state.ledger.subjects.map((subject) => subject.id === "saved_home"
          ? { ...subject, facts: applyCorrectionsToFacts(subject.facts, corrections, true) }
          : subject),
        decisions: state.ledger.decisions.map((decision) => {
          if (!savedHomeDecisionIds.has(decision.id)) return decision;
          const openItems = decision.openItems.filter((item) => (
            !mentionsRetiredPlanFact(item, corrections)
          ));
          const candidatePendingQuestion = scrubText(decision.pendingQuestion);
          const pendingQuestion = candidatePendingQuestion
            && openItems.some((item) => item.toLowerCase() === candidatePendingQuestion.toLowerCase())
            ? candidatePendingQuestion
            : "";
          return {
            ...decision,
            facts: applyCorrectionsToFacts(decision.facts, corrections, true),
            goal: scrubText(decision.goal, "Continue the saved-home energy decision"),
            outcomeSummary: scrubText(decision.outcomeSummary),
            openItems,
            pendingQuestion,
            status: openItems.length ? "open" : "resolved",
          };
        }),
      },
    } : {}),
  };
}

export function surgePlanContextAfterRecentHomeFactChanges(
  context: SurgePlanContext | null,
  message: string,
  recentTurns: readonly RecentTurn[] = [],
  existingCorrections: readonly SurgePlanContextCorrection[] = [],
): SurgePlanContext | null {
  return applySurgePlanContextCorrections(
    context,
    surgePlanContextCorrectionsAfterRecentHomeFactChanges(
      existingCorrections,
      message,
      recentTurns,
    ),
  );
}

export function surgeHasRecentHomeFactCorrection(
  message: string,
  recentTurns: readonly RecentTurn[] = [],
) {
  return recentUserFactMessages(message, recentTurns)
    .some((content) => canCorrectSelectedSavedHome(content) && EXPLICIT_CORRECTION.test(content))
    || surgeHasRecentMaterialHomeFactChange(message, recentTurns);
}

export function isSurgePlanPriorityIntent(message: string) {
  if (PRIORITY_INTENT.test(message) && !TOPIC_SPECIFIC_PRIORITY_INTENT.test(message)) return true;
  return message
    .split(/\s*(?:,|;|\band\b|\balso\b)\s*/i)
    .some((clause) => (
      PRIORITY_INTENT.test(clause) && !TOPIC_SPECIFIC_PRIORITY_INTENT.test(clause)
    ));
}

function firstVisibleSentence(value: string) {
  return value.trim().split(/\n+|[.!?](?:\s+|$)/u)[0]?.trim() || "";
}

function withoutResolvedLeadingContext(value: string) {
  return value.replace(
    /^(?:(?:since|because|now that)\b\s*)?[^,;]{0,120}\b(?:fixed|resolved|repaired|ruled out|cleared|gone|no longer present)\b[^,;]*[,;]\s*(?:so\s+)?/i,
    "",
  );
}

function sentenceContradictsPriority(
  sentence: string,
  priorityIndex: number,
  priorityLength: number,
) {
  const before = sentence.slice(0, priorityIndex);
  const after = sentence.slice(priorityIndex + priorityLength);
  if (/\b(?:do not|don['’]?t|never|avoid|skip)\b[^,;]{0,55}$/i.test(before)) return true;
  if (/^[^,;]{0,45}\b(?:is|are|should be)?\s*(?:not|never)\b[^,;]{0,35}\b(?:first|priority|needed|required)\b/i.test(after)) return true;
  if (/^[^,;]{0,55}\b(?:(?:only\s+)?after|afterwards?|once|until|later|second|instead)\b/i.test(after)) return true;
  return /\b(?:but|however|instead)\b[^.!?]{0,85}\b(?:(?:the\s+)?(?:real|actual|true)\s+)?(?:first|starting)\b/i.test(after)
    || /\b(?:but|however|instead)\b[^.!?]{0,85}\bbefore\s+(?:doing|starting|addressing|fixing|checking)\b/i.test(after);
}

function firstSentenceRanks(
  candidateText: string,
  prioritySignal: RegExp,
) {
  const sentence = withoutResolvedLeadingContext(firstVisibleSentence(candidateText));
  const priorityMatch = sentence.match(prioritySignal);
  if (!priorityMatch || priorityMatch.index === undefined) return false;
  const priorityIndex = priorityMatch.index;
  if (sentenceContradictsPriority(sentence, priorityIndex, priorityMatch[0].length)) return false;
  const competingPriorityIndex = sentence.search(
    /\b(?:electricity|gas)\s+bills?\b|\b(?:electricity|gas|bills?|tariffs?)\b|\bsolar\b|\bbatter(?:y|ies)\b|\b(?:roof|leaks?|water (?:entry|ingress))\b|\b(?:moisture|humidity|condensation|damp|mould|mold)\b|\b(?:windows?|glaz(?:e|ed|ing)|draughts?|drafts?|blinds?|curtains?)\b|\b(?:ceiling|insulation|roof[- ]?space|batts?)\b|\b(?:reverse[- ]?cycle|air[- ]?con|air conditioning|split system|heating|hot water|heat pump)\b|\b(?:switchboard|fuse board|electrician)\b/i,
  );
  return competingPriorityIndex < 0 || priorityIndex <= competingPriorityIndex;
}

export function surgeAnswerPreservesPlanPriority(
  priority: EnergyAssistantAnswer,
  candidateText: string,
) {
  const priorityText = `${priority.directAnswer}\n${priority.nextAction}`;
  if (/start with the source of the moisture|reported roof issue as a possible moisture source/i.test(priorityText)) {
    const first = firstVisibleSentence(candidateText);
    return firstSentenceRanks(candidateText, /\b(?:roof|leaks?|watertight|water (?:entry|ingress))\b/i)
      && /\b(?:leak|damage|water|watertight|moisture)\b/i.test(first);
  }
  if (/start with moisture control/i.test(priorityText)) {
    return firstSentenceRanks(candidateText, /\b(?:moisture|humidity|condensation|damp|mould|mold)\b/i);
  }
  if (/start with the reported roof problem/i.test(priorityText)) {
    return firstSentenceRanks(candidateText, /\b(?:roof|leak|damage|watertight)\b/i);
  }
  if (/start with the worst windows/i.test(priorityText)) {
    return firstSentenceRanks(candidateText, /\b(?:windows?|glaz(?:e|ed|ing)|draughts?|drafts?|blinds?|curtains?)\b/i);
  }
  if (/start with the accessible ceiling insulation/i.test(priorityText)) {
    return firstSentenceRanks(candidateText, /\b(?:ceiling|insulation|roof[- ]?space|batts?)\b/i);
  }
  if (/start with the existing reverse-cycle system/i.test(priorityText)) {
    return firstSentenceRanks(candidateText, /\b(?:reverse[- ]?cycle|air[- ]?con|air conditioning|split system)\b/i);
  }
  if (/start with the first ranked action below/i.test(priorityText)) {
    if (/reverse[- ]?cycle|air[- ]?con|air conditioning/i.test(priority.nextAction)) {
      return firstSentenceRanks(candidateText, /\b(?:reverse[- ]?cycle|air[- ]?con|air conditioning)\b/i);
    }
    if (/compare electricity|compare gas|energy bills?|tariffs?/i.test(priority.nextAction)) {
      return firstSentenceRanks(candidateText, /\b(?:electricity|gas|bills?|tariffs?)\b/i);
    }
    if (/fuse board|switchboard|licensed electrician/i.test(priority.nextAction)) {
      return firstSentenceRanks(candidateText, /\b(?:switchboard|fuse board|electrician)\b/i);
    }
    return false;
  }
  return !/\bBased on your saved answers\b[^.!?]*\bstart with\b/i.test(priority.directAnswer);
}

export function composeSurgePlanPriorityAnswer(
  message: string,
  context: SurgePlanContext | null,
  recentTurns: readonly RecentTurn[] = [],
): EnergyAssistantAnswer | null {
  if (!context || !isSurgePlanPriorityIntent(message)) return null;
  const materialCorrection = surgeHasRecentMaterialHomeFactChange(message, recentTurns);
  if (surgeHasRecentHomeFactCorrection(message, recentTurns) && !materialCorrection) return null;
  const effectiveContext = surgePlanContextAfterRecentHomeFactChanges(context, message, recentTurns);
  if (!effectiveContext) return null;

  const facts = new Map(effectiveContext.facts.map((fact) => [fact.key, fact.value]));
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
  const solar = fact("solar");
  const battery = fact("battery");
  const switchboard = fact("switchboard");

  const messageBudget = message.match(/\b(?:budget|spend(?:ing)?|afford|put)\b[^.!?\n$]{0,55}\$\s*([\d,]+(?:\.\d{1,2})?)/i)?.[1]
    || message.match(/\$\s*([\d,]+(?:\.\d{1,2})?)[^.!?\n]{0,45}\b(?:budget|to spend|available|first)\b/i)?.[1];
  const formattedMessageBudget = messageBudget
    ? `$${Number(messageBudget.replace(/,/g, "")).toLocaleString("en-AU")}`
    : "";
  const approvalExplicitlyDoesNotApply = /\bno\s+(?:strata|owners corporation|common[- ]property)|\bdoes not apply\b|\bnot part of (?:a )?(?:strata|body corporate)/i.test(approval);
  const approvalExplicitlyApplies = !approvalExplicitlyDoesNotApply
    && /\b(?:strata|owners corporation|common property)\b/i.test(approval);
  const approvalUnknown = /not sure|unknown|not confirmed|don['’]?t know/i.test(approval)
    || (!approval && /apartment|unit/i.test(propertyType));
  const moisture = /condensation|damp|mould|mold/i.test(comfort);
  const hotOrCold = /too hot|too cold/i.test(comfort);
  const roofProblem = /leak|damage|major deterioration/i.test(roofCondition)
    && !/no known/i.test(roofCondition);
  const ceilingUnavailable = /another dwelling is directly above|no roof or ceiling space/i.test(ceiling);
  const floorUnavailable = /slab|another dwelling is directly below/i.test(floor);
  const ceilingNeedsWork = /no (?:ceiling )?insulation(?: that I know of)?|uninsulated|old|patchy|inadequate/i.test(ceiling)
    && !ceilingUnavailable;
  const weakWindows = /single glazed/i.test(glazing)
    || /basic roller|vertical|venetian|no fitted internal/i.test(coverings)
    || /no effective external shade/i.test(shading);
  const hasReverseCycle = /air-con|air conditioning|reverse-cycle/i.test(heating);
  const hasGasHeating = /gas space|ducted heating/i.test(heating);
  const actions: string[] = [];

  if (moisture && roofProblem) {
    actions.push("Treat the reported roof issue as a possible moisture source: have the leak or damage inspected and made watertight first, then dry affected materials and deal with mould before adding insulation or sealing gaps.");
  }
  if (moisture) {
    const existingExhaust = /kitchen/i.test(exhaust) && /bathroom/i.test(exhaust)
      ? "kitchen and bathroom exhaust"
      : /kitchen/i.test(exhaust)
        ? "kitchen exhaust"
        : /bathroom/i.test(exhaust)
          ? "bathroom exhaust"
          : "";
    const fanDirection = existingExhaust
      ? `Run the ${existingExhaust} whenever moisture is produced, and check ${existingExhaust.includes(" and ") ? "each fan" : "it"} clears steam`
      : "Use effective kitchen and bathroom exhaust whenever moisture is produced";
    actions.push(`${roofProblem ? "After the roof leak is ruled out or repaired, control indoor condensation" : "Control condensation first"}: ${fanDirection}. Investigate any other leaks or persistent mould before sealing more gaps.`);
  }
  if (roofProblem && !moisture) {
    actions.push("Fix the reported roof leak or damage before other energy upgrades, because water can damage insulation and finishes.");
  }
  if (weakWindows && (hotOrCold || /comfort/i.test(priorities))) {
    const approvalDirection = approvalExplicitlyApplies
      ? "Get strata approval before external changes"
      : approvalUnknown
        ? "Check whether strata, body-corporate or other approval applies before external changes"
      : "Add external shade where strong summer sun hits the glass";
    actions.push(`Improve the coldest windows: fit close-fitting honeycomb blinds or thermal curtains with pelmets, then seal confirmed moving gaps. ${approvalDirection}.`);
  }
  if (ceilingNeedsWork) {
    actions.push("Check accessible ceiling insulation for safe, confirmed gaps before sizing new heating or cooling, while preserving required electrical clearances.");
  }
  if (hasReverseCycle) {
    actions.push(`Use the existing reverse-cycle air conditioner in occupied rooms: clean its filters and close unused areas${hasGasHeating ? " rather than running the gas heater at the same time" : ""}.`);
  } else if (hasGasHeating) {
    actions.push("Before the gas heater fails, price a correctly sized reverse-cycle replacement, including electrical capacity, outdoor-unit location and noise.");
  }
  if (actions.length < 3 && /lower energy bills/i.test(priorities)) {
    actions.push("Compare electricity using actual usage, and compare gas separately while the home remains connected.");
  }
  if (actions.length < 3 && /older fuse/i.test(switchboard)) {
    actions.push("Have a licensed electrician assess the older fuse board before adding large electric appliances or EV charging.");
  }

  const selectedActions = actions.slice(0, 3);
  if (!selectedActions.length) return null;
  const startWith = moisture
    ? roofProblem
      ? "the source of the moisture"
      : "moisture control"
    : roofProblem
      ? "the reported roof problem"
        : weakWindows
          ? "the worst windows"
          : ceilingNeedsWork
            ? "the accessible ceiling insulation"
            : hasReverseCycle
              ? "the existing reverse-cycle system"
              : "the first ranked action below";
  const homeDescription = propertyType ? ` for your ${propertyType.toLowerCase()}` : "";
  const budgetDescription = formattedMessageBudget
    ? ` with ${formattedMessageBudget} to spend first`
    : budget
      ? ` with ${budget.toLowerCase()} to spend first`
      : "";
  const intro = `Based on your saved answers${homeDescription}${budgetDescription}, start with ${startWith}.`;
  const unsuitableInsulation = ceilingUnavailable && floorUnavailable
    ? " Generic ceiling and underfloor insulation advice does not fit this apartment layout."
    : ceilingUnavailable
      ? " Generic ceiling insulation advice does not fit because another dwelling is directly above."
      : "";
  const laterSolar = /apartment|unit/i.test(propertyType)
    && /no rooftop solar/i.test(solar)
    && /no home battery/i.test(battery)
    ? " Treat solar and a battery as later common-property decisions."
    : "";
  return {
    directAnswer: `${intro} ${selectedActions.join(" ")}${unsuitableInsulation}${laterSolar}`,
    practicalSteps: [],
    nextAction: selectedActions[0],
    status: "answered",
    citations: [],
    assumptions: ["The saved answers are household-reported and have not been confirmed by a site inspection."],
    confidence: "medium",
    suggestedQuestions: [],
    toolActions: [],
    sourceBoundary: "This priority order uses the confirmed home-plan facts supplied on this device. Site condition, safety, approvals and regulated work still require appropriate inspection or licensed advice.",
  };
}
