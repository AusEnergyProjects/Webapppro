import {
  ENERGY_ASSISTANT_KNOWLEDGE,
  ENERGY_ASSISTANT_TOPICS,
  type EnergyAssistantAudience,
  type EnergyAssistantKnowledgeSource,
  type EnergyAssistantStoragePolicy,
  type EnergyAssistantTopic,
} from "../data/energy-assistant-knowledge.ts";
import {
  DRAUGHT_SLOT_ORDER,
  DRAUGHT_SLOT_QUESTIONS,
  EV_CHARGING_SLOT_ORDER,
  EV_CHARGING_SLOT_QUESTIONS,
  HEAT_PUMP_SELECTION_SLOT_ORDER,
  HEAT_PUMP_SELECTION_SLOT_QUESTIONS,
  SOLAR_STC_SLOT_ORDER,
  SOLAR_STC_SLOT_QUESTIONS,
  TRADE_PLATFORM_TASKS,
  type DraughtSlot,
  type EvChargingSlot,
  type HeatPumpSelectionSlot,
  type SolarStcSlot,
} from "../data/energy-assistant-playbooks.ts";
import {
  GOVERNMENT_CATALOGUE_REVIEWED_ON,
  GOVERNMENT_PROGRAM_TEMPLATES,
  type GovernmentProgramTemplate,
} from "./australian-government-program-catalogue.ts";

export type EnergyAssistantCitation = {
  id: string;
  title: string;
  publisher: string;
  url: string;
  sourceTier: "primary_official" | "independent_link_only";
  jurisdiction: string;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  lastChecked: string;
  reviewDue: string;
  storagePolicy: EnergyAssistantStoragePolicy;
  stale: boolean;
};

export type EnergyAssistantKnowledgeHealth = {
  ready: boolean;
  checkedAt: string;
  sourceCount: number;
  currentOfficialSourceCount: number;
  topicsReady: number;
  topicCount: number;
  overdueOfficialSourceIds: string[];
  uncoveredTopics: EnergyAssistantTopic[];
  nextReviewDue: string | null;
};

export type EnergyAssistantAction = {
  id: string;
  label: string;
  href: string;
};

export type EnergyAssistantAnswer = {
  directAnswer: string;
  practicalSteps: string[];
  nextAction: string;
  status: "answered" | "needs_context" | "source_review_required";
  citations: EnergyAssistantCitation[];
  assumptions: string[];
  confidence: "high" | "medium" | "low";
  suggestedQuestions: string[];
  toolActions: EnergyAssistantAction[];
  sourceBoundary: string;
};

export type EnergyAssistantSearchResult = {
  source: EnergyAssistantKnowledgeSource;
  score: number;
  relevanceScore: number;
  stale: boolean;
  active: boolean;
};

const QUERY_STOP_TERMS = new Set([
  "a",
  "about",
  "am",
  "an",
  "and",
  "are",
  "at",
  "be",
  "can",
  "could",
  "do",
  "does",
  "for",
  "from",
  "help",
  "home",
  "house",
  "how",
  "i",
  "in",
  "is",
  "it",
  "make",
  "me",
  "more",
  "my",
  "of",
  "on",
  "or",
  "please",
  "should",
  "some",
  "tell",
  "that",
  "the",
  "this",
  "to",
  "want",
  "what",
  "which",
  "with",
  "would",
  "you",
  "your",
]);

const PHRASE_SYNONYMS: ReadonlyArray<readonly [string, readonly string[]]> = [
  ["air con", ["rcac", "reverse_cycle_air_conditioner"]],
  ["air conditioner", ["rcac", "reverse_cycle_air_conditioner"]],
  ["reverse cycle", ["rcac", "reverse_cycle_air_conditioner"]],
  ["split system", ["rcac", "reverse_cycle_air_conditioner"]],
  ["heat pump water", ["heat_pump_hot_water", "hot_water"]],
  ["heat pump hot water", ["heat_pump_hot_water", "hot_water"]],
  ["hot water", ["heat_pump_hot_water", "hot_water"]],
  ["double glazing", ["glazing_shading", "windows"]],
  ["window film", ["glazing_shading", "windows"]],
  ["draught proof", ["draughts_ventilation", "airtightness"]],
  ["draft proof", ["draughts_ventilation", "airtightness"]],
  ["virtual power plant", ["battery_vpp", "vpp"]],
  ["home battery", ["battery_vpp", "battery"]],
  ["solar panels", ["solar", "rooftop_pv"]],
  ["electric car", ["ev_charging", "ev"]],
  ["electric vehicle", ["ev_charging", "ev"]],
  ["charging station", ["ev_charging", "charger"]],
  ["energy bill", ["bills_tariffs", "bill"]],
  ["electricity plan", ["bills_tariffs", "tariff"]],
  ["feed in tariff", ["bills_tariffs", "solar"]],
  ["time of use", ["bills_tariffs", "tariff"]],
  ["small scale technology certificate", ["rebates_certificates", "stc"]],
  ["energy rating", ["products_ratings", "efficiency"]],
  ["consumer guarantee", ["safety_consumer_rights", "warranty"]],
  ["body corporate", ["renters_strata", "strata"]],
  ["owners corporation", ["renters_strata", "strata"]],
  ["star rating", ["nathers", "rating"]],
  ["home energy assessment", ["nathers", "assessor"]],
  ["building fabric", ["comfort_fabric", "thermal"]],
  ["gas stove", ["induction", "cooking"]],
];

const TOKEN_SYNONYMS: Readonly<Record<string, readonly string[]>> = {
  ac: ["rcac", "heating", "cooling"],
  aircon: ["rcac", "heating", "cooling"],
  bill: ["bills_tariffs", "tariff"],
  bills: ["bills_tariffs", "tariff"],
  boiler: ["heat_pump_hot_water", "hot_water"],
  bedroom: ["comfort", "fabric", "heating", "cooling", "rcac"],
  bedrooms: ["comfort", "fabric", "heating", "cooling", "rcac"],
  cold: ["comfort", "fabric", "heating", "insulation", "rcac"],
  comfortable: ["comfort", "fabric", "heating", "cooling", "rcac"],
  freezing: ["comfort", "fabric", "heating", "insulation", "rcac"],
  draught: ["draughts_ventilation", "airtightness"],
  draft: ["draughts_ventilation", "airtightness"],
  ev: ["ev_charging", "charger"],
  heating: ["rcac", "comfort", "fabric"],
  hws: ["heat_pump_hot_water", "hot_water"],
  hpwh: ["heat_pump_hot_water", "hot_water"],
  lounge: ["comfort", "fabric", "heating", "cooling", "rcac"],
  panels: ["solar", "rooftop_pv"],
  pv: ["solar", "rooftop_pv"],
  rebate: ["rebates_certificates", "assistance"],
  rebates: ["rebates_certificates", "assistance"],
  rent: ["renter", "tenant"],
  stcs: ["rebates_certificates", "stc", "certificate"],
  room: ["comfort", "fabric", "heating", "cooling", "rcac"],
  rooms: ["comfort", "fabric", "heating", "cooling", "rcac"],
  renter: ["renters_strata", "tenant"],
  tenant: ["renters_strata", "renter"],
  windows: ["glazing_shading", "glazing"],
};

const TOPIC_SUGGESTIONS: Readonly<
  Partial<Record<EnergyAssistantTopic, readonly string[]>>
> = {
  nathers: [
    "Is this an existing home, new build or major renovation?",
    "Do you need an official certificate or practical upgrade priorities?",
  ],
  comfort_fabric: [
    "Which rooms are hardest to keep comfortable?",
    "Do you know the home's age and construction type?",
  ],
  insulation: [
    "Which ceiling, roof, wall or floor areas are accessible?",
    "Is there any moisture, mould or unsafe electrical work to resolve first?",
  ],
  glazing_shading: [
    "Which windows receive strong morning or afternoon sun?",
    "Are the frames and seals in good condition?",
  ],
  draughts_ventilation: [
    "Where do you notice air leakage or condensation?",
    "What kitchen, bathroom and laundry exhaust ventilation is installed?",
  ],
  rcac: [
    "What rooms and floor area need heating or cooling?",
    "What postcode and existing system should the new unit suit?",
  ],
  heat_pump_hot_water: [
    "How many people use hot water in the home?",
    "Where could a tank and outdoor heat-pump unit be located?",
  ],
  induction: [
    "Is the current cooktop gas, ceramic or induction?",
    "Has an electrician checked the circuit and switchboard capacity?",
  ],
  solar: [
    "Can you share annual use or interval data and your daytime load?",
    "What roof orientation, shading and export limit apply?",
  ],
  battery_vpp: [
    "How much solar is exported on a typical day?",
    "Do you need backup power, bill shifting, VPP income or a mix?",
  ],
  ev_charging: [
    "How far is the vehicle driven on a typical day?",
    "Is there dedicated parking and a known switchboard capacity?",
  ],
  bills_tariffs: [
    "Which state or territory and postcode is the property in?",
    "Do you have a recent bill or half-hour interval data?",
  ],
  rebates_certificates: [
    "What postcode, upgrade and proposed installation date apply?",
    "Is this for a household, rental, strata property or business?",
  ],
  products_ratings: [
    "What exact model number and required capacity are you comparing?",
    "Which climate zone and installation conditions apply?",
  ],
  safety_consumer_rights: [
    "Is there an immediate fire, shock, gas or battery hazard?",
    "Who supplied the product and who performed the installation?",
  ],
  renters_strata: [
    "Are you a tenant, lot owner, landlord or owners corporation representative?",
    "Which state or territory rules apply to the property?",
  ],
  trades: [
    "Is this product advice, assessment evidence or quote preparation?",
    "Which jurisdiction and installation date apply?",
  ],
};

const TOPIC_ACTIONS: Readonly<
  Partial<Record<EnergyAssistantTopic, readonly EnergyAssistantAction[]>>
> = {
  nathers: [
    { id: "open-assessments", label: "Explore assessment services", href: "/assessments" },
  ],
  comfort_fabric: [
    { id: "open-home-plan", label: "Build a home energy roadmap", href: "/plan" },
  ],
  insulation: [
    {
      id: "open-insulation-guide",
      label: "Open the insulation and draught guide",
      href: "/guides/insulation-draught-proofing",
    },
  ],
  glazing_shading: [
    {
      id: "open-insulation-guide",
      label: "Open the building fabric guide",
      href: "/guides/insulation-draught-proofing",
    },
  ],
  draughts_ventilation: [
    {
      id: "open-insulation-guide",
      label: "Open the insulation and draught guide",
      href: "/guides/insulation-draught-proofing",
    },
  ],
  rcac: [
    { id: "open-heating-guide", label: "Open the heating guide", href: "/guides/heating" },
  ],
  heat_pump_hot_water: [
    { id: "open-hot-water-guide", label: "Open the hot water guide", href: "/guides/hot-water" },
  ],
  induction: [
    { id: "open-cooking-guide", label: "Open the cooking guide", href: "/guides/cooking" },
  ],
  solar: [
    { id: "open-solar-guide", label: "Open the solar guide", href: "/guides/solar" },
    { id: "model-solar", label: "Model a solar scenario", href: "/compare" },
  ],
  battery_vpp: [
    { id: "open-battery-guide", label: "Open the battery guide", href: "/guides/batteries" },
    { id: "model-battery", label: "Model a battery scenario", href: "/compare" },
  ],
  ev_charging: [
    { id: "open-ev-guide", label: "Open the EV charging guide", href: "/guides/ev-charging" },
  ],
  bills_tariffs: [
    { id: "compare-electricity", label: "Compare electricity plans", href: "/compare" },
  ],
  rebates_certificates: [
    { id: "open-rebates", label: "Check rebates and assistance", href: "/rebates" },
    { id: "open-calculator", label: "Open the certificate calculator", href: "/calculator" },
  ],
  products_ratings: [
    { id: "open-guides", label: "Browse equipment guides", href: "/guides" },
    { id: "open-product-calculator", label: "Check approved products and programs", href: "/calculator" },
  ],
  safety_consumer_rights: [
    { id: "prepare-project", label: "Prepare a private project brief", href: "/account/projects/new" },
  ],
  renters_strata: [
    { id: "open-project-guide", label: "Open the project preparation guide", href: "/guides/project-preparation" },
  ],
  trades: [
    { id: "open-trade-workspace", label: "Open the trade workspace", href: "/direct-trade/dashboard" },
    { id: "open-trade-standards", label: "Open trade standards and rules", href: "/direct-trade/standards" },
    { id: "open-product-calculator", label: "Check products and calculations", href: "/calculator" },
  ],
};

const TOPIC_DIRECT_ANSWERS: Readonly<Record<EnergyAssistantTopic, string>> = {
  nathers:
    "A quick online check cannot issue or replace an official NatHERS rating. Use the accredited existing-home pathway when you need a certificate, and use this assistant only to prepare evidence and upgrade questions.",
  comfort_fabric:
    "Start with the home's comfort problems and building fabric before choosing large equipment. Orientation, insulation, windows, shading, draughts and ventilation change both comfort and the size of heating or cooling needed.",
  insulation:
    "Treat insulation as a whole-envelope and installation-quality decision, not a product-only purchase. Confirm existing coverage, construction, moisture and electrical hazards before setting the scope.",
  glazing_shading:
    "Do not choose windows by glass panes alone. Climate, orientation, frame, seals, installation and external shading determine whether a glazing upgrade solves the actual summer or winter problem.",
  draughts_ventilation:
    "Seal unintended leaks while preserving deliberate ventilation and moisture control. Draught sealing without checking exhaust and fresh-air pathways can create a different comfort or condensation problem.",
  rcac:
    "Choose reverse-cycle air conditioning by room load, climate-zone performance, capacity, annual energy use, noise and installation design. A brand name alone is not enough to select a system.",
  heat_pump_hot_water:
    "A heat-pump water heater can be a strong electrification step when its tank, climate performance, noise, location, tariff and recovery rate suit the household. Check the full installed design before comparing rebates or headline prices.",
  induction:
    "Induction is an efficient electric replacement for gas cooking, but the project includes cookware, circuit capacity, switchboard work, ventilation, bench fit and licensed gas disconnection where relevant.",
  solar:
    "Size solar from the home's load timing, usable roof, shading and export limit. A generic system size or savings claim is not a reliable substitute for interval data and a written site design.",
  battery_vpp:
    "A battery should solve a defined job such as shifting solar, backup or VPP participation. Test usable capacity, power, load timing, tariff, backup design, warranty and total installed cost before deciding.",
  ev_charging:
    "Match EV charging to daily driving, parking time, electrical capacity, solar timing and tariff. Faster charging is not automatically better if an overnight lower-power option covers the real daily distance.",
  bills_tariffs:
    "Compare the full tariff against the household's actual timing, not one headline rate. Supply, usage windows, demand charges, controlled load and solar export terms can change the result.",
  rebates_certificates:
    "Do not treat a rebate or certificate discount as available until the current official rules match the postcode, applicant, property, exact product, installer and installation date.",
  products_ratings:
    "Check the exact model in the official product database and compare like-for-like capacity and features. Independent reviews can add context, but they do not replace registration, site suitability or a complete written quote.",
  safety_consumer_rights:
    "Put immediate safety first, then separate the product supplier, installer and manufacturer records. Australian Consumer Law guarantees are separate from a written warranty.",
  renters_strata:
    "Separate portable actions from fixed work. Fixed upgrades usually need written owner or owners corporation approval, and the applicable tenancy or strata rule depends on the state or territory.",
  trades:
    "Use the current official assessment, product and program instruments for trade work. Keep exact model, site, installation, consent and evidence records rather than relying on a general assistant answer.",
};

const TOPIC_STEPS: Readonly<Record<EnergyAssistantTopic, readonly string[]>> = {
  nathers: [
    "Confirm whether the job is an existing home, new build or major renovation.",
    "Decide whether you need an official certificate or only upgrade planning.",
    "For a certificate, select the current accredited assessor pathway and prepare site evidence.",
  ],
  comfort_fabric: [
    "Record the rooms, seasons and times when comfort is poor.",
    "Inspect insulation, windows, shading, draughts, ventilation and moisture as one system.",
    "Reduce avoidable loads before sizing replacement heating or cooling.",
  ],
  insulation: [
    "Identify construction and safely inspect accessible existing insulation and gaps.",
    "Resolve moisture, unsafe wiring and clearance issues before installation.",
    "Specify material, R-value, coverage, clearances and installation evidence in the quote.",
  ],
  glazing_shading: [
    "Map window orientation, size and the season of unwanted heat gain or loss.",
    "Compare external shading, seals, coverings and glazing as separate options.",
    "For replacement, specify glass, frame, seals, installation and performance values.",
  ],
  draughts_ventilation: [
    "Locate leaks around doors, windows, penetrations and access hatches.",
    "Check kitchen, bathroom and laundry exhaust paths and signs of condensation.",
    "Seal safe gaps and verify that deliberate ventilation still works.",
  ],
  rcac: [
    "Estimate each room load after considering insulation, glazing and shading.",
    "Compare exact models in the relevant climate zone at the required capacity.",
    "Get a written design covering placement, drainage, noise, circuits and commissioning.",
  ],
  heat_pump_hot_water: [
    "Estimate peak hot-water demand and suitable tank capacity.",
    "Check climate performance, recovery, noise, location, tariff and electrical work.",
    "Confirm the exact approved model and incentive rules before accepting a quote.",
  ],
  induction: [
    "Check cookware and the existing bench cut-out.",
    "Have a licensed electrician confirm circuit and switchboard capacity.",
    "Include safe gas disconnection and ventilation changes in the written scope.",
  ],
  solar: [
    "Use interval data or at least recent bills to understand daytime load.",
    "Check roof layout, orientation, shading, inverter location and export limits.",
    "Compare written quotes using exact panel, inverter, warranty and generation assumptions.",
  ],
  battery_vpp: [
    "Define whether the priority is bill shifting, backup or VPP participation.",
    "Model solar surplus and evening load against usable capacity and power.",
    "Compare warranty, backup circuits, VPP control terms, exit terms and total installed cost.",
  ],
  ev_charging: [
    "Convert typical daily distance into an overnight energy requirement.",
    "Check parking, cable path, switchboard capacity, solar and tariff windows.",
    "For strata, obtain the required building approval before installation design is final.",
  ],
  bills_tariffs: [
    "Collect a current bill and interval data where available.",
    "Compare supply, usage periods, demand, controlled-load and export terms.",
    "Test the plan against expected solar, battery, hot-water and EV timing.",
  ],
  rebates_certificates: [
    "Identify postcode, applicant type, property type, exact upgrade and installation date.",
    "Open the current official program rules and approved product or provider lists.",
    "Keep written eligibility and assignment details with the quote and installation records.",
  ],
  products_ratings: [
    "Record the exact brand, model, capacity and proposed installation conditions.",
    "Verify registration and declared performance in the official database.",
    "Compare the complete written quote, warranty, service support and commissioning scope.",
  ],
  safety_consumer_rights: [
    "If danger is immediate, keep people away and contact emergency help.",
    "Stop using suspect equipment and preserve photos, model details and documents when safe.",
    "Contact the responsible supplier or installer in writing and use the relevant regulator if needed.",
  ],
  renters_strata: [
    "Confirm the property role and the state or territory rules.",
    "Separate no-change and portable measures from fixed building work.",
    "Get the required written owner or owners corporation approval before fixed work.",
  ],
  trades: [
    "Confirm the current official instrument, jurisdiction and effective date.",
    "Bind the exact product, site and installation evidence to the job record.",
    "Keep eligibility, calculation and customer consent boundaries explicit in the quote.",
  ],
};

function searchable(value: string) {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function queryTerms(query: string) {
  const normal = searchable(query);
  const terms = new Set(
    normal
      .split(/\s+/)
      .filter((term) => term.length > 1 && !QUERY_STOP_TERMS.has(term)),
  );
  const addTerms = (values: readonly string[]) => {
    for (const value of values) {
      for (const term of searchable(value).split(/\s+/)) {
        if (term.length > 1 && !QUERY_STOP_TERMS.has(term)) terms.add(term);
      }
    }
  };
  for (const [phrase, additions] of PHRASE_SYNONYMS) {
    if (normal.includes(searchable(phrase))) addTerms(additions);
  }
  for (const term of [...terms]) {
    addTerms(TOKEN_SYNONYMS[term] || []);
  }
  return { normal, terms };
}

function isoDay(date: Date | string) {
  const parsed = typeof date === "string" ? new Date(date) : date;
  if (!Number.isFinite(parsed.getTime())) throw new Error("A valid answer date is required.");
  return parsed.toISOString().slice(0, 10);
}

function sourceState(source: EnergyAssistantKnowledgeSource, day: string) {
  const active = (!source.effectiveFrom || source.effectiveFrom <= day)
    && (!source.effectiveTo || source.effectiveTo >= day);
  return { active, stale: source.reviewDue < day || !active };
}

export function energyAssistantKnowledgeHealth(
  asOf: Date | string = new Date(),
  sources: readonly EnergyAssistantKnowledgeSource[] = ENERGY_ASSISTANT_KNOWLEDGE,
): EnergyAssistantKnowledgeHealth {
  const parsed = typeof asOf === "string" ? new Date(asOf) : asOf;
  if (!Number.isFinite(parsed.getTime())) throw new Error("A valid knowledge health date is required.");
  const checkedAt = parsed.toISOString();
  const day = isoDay(parsed);
  const official = sources.filter((source) => source.official);
  const currentOfficial = official.filter((source) => {
    const state = sourceState(source, day);
    return state.active && !state.stale;
  });
  const currentTopics = new Set(currentOfficial.map((source) => source.topic));
  const uncoveredTopics = ENERGY_ASSISTANT_TOPICS.filter((topic) => !currentTopics.has(topic));
  const overdueOfficialSourceIds = official
    .filter((source) => source.reviewDue < day)
    .map((source) => source.id)
    .sort();
  const futureReviewDates = official
    .map((source) => source.reviewDue)
    .filter((reviewDue) => reviewDue >= day)
    .sort();
  return {
    ready: uncoveredTopics.length === 0 && overdueOfficialSourceIds.length === 0,
    checkedAt,
    sourceCount: sources.length,
    currentOfficialSourceCount: currentOfficial.length,
    topicsReady: ENERGY_ASSISTANT_TOPICS.length - uncoveredTopics.length,
    topicCount: ENERGY_ASSISTANT_TOPICS.length,
    overdueOfficialSourceIds,
    uncoveredTopics: [...uncoveredTopics],
    nextReviewDue: futureReviewDates[0] || null,
  };
}

function tokenScore(terms: Set<string>, value: string, weight: number) {
  const tokens = new Set(searchable(value).split(/\s+/).filter(Boolean));
  let score = 0;
  for (const term of terms) if (tokens.has(term)) score += weight;
  return score;
}

function queryHasRequiredTopicSignal(topic: EnergyAssistantTopic, normal: string) {
  if (topic !== "heat_pump_hot_water") return true;

  return /\b(?:hot water|water heater|hws|hpwh|boiler)\b/.test(normal)
    || /\b(?:electrification|electrify|all electric|replace (?:all )?gas)\b/.test(normal);
}

export function searchEnergyAssistantKnowledge(
  query: string,
  options: {
    audience?: EnergyAssistantAudience;
    asOf?: Date | string;
    sources?: readonly EnergyAssistantKnowledgeSource[];
    limit?: number;
  } = {},
): EnergyAssistantSearchResult[] {
  const { normal, terms } = queryTerms(query);
  const day = isoDay(options.asOf || new Date());
  const limit = Math.max(1, Math.min(12, options.limit || 6));
  const sources = options.sources || ENERGY_ASSISTANT_KNOWLEDGE;

  return sources
    .filter((source) => source.official && source.storagePolicy === "local_factual_summary")
    .map((source) => {
      const topic = source.topic.replaceAll("_", " ");
      const exactPhrase = [source.title, source.publisher, ...source.keywords]
        .some((value) => normal.length >= 4 && searchable(value).includes(normal));
      let relevanceScore = tokenScore(terms, topic, 9)
        + tokenScore(terms, source.title, 7)
        + tokenScore(terms, source.publisher, 5)
        + tokenScore(terms, source.keywords.join(" "), 6)
        + tokenScore(terms, source.summary, 1);
      if (exactPhrase) relevanceScore += 14;
      if (!queryHasRequiredTopicSignal(source.topic, normal)) relevanceScore = 0;
      let score = relevanceScore;
      if (
        relevanceScore > 0
        && options.audience
        && (source.audience as readonly EnergyAssistantAudience[]).includes(options.audience)
      ) score += 2;
      if (relevanceScore > 0 && source.official) score += 1;
      return { source, score, relevanceScore, ...sourceState(source, day) };
    })
    .filter((result) => result.relevanceScore >= 4)
    .sort((left, right) =>
      right.score - left.score
      || Number(right.source.official) - Number(left.source.official)
      || left.source.id.localeCompare(right.source.id))
    .slice(0, limit);
}

function uniqueById<T extends { id: string }>(items: readonly T[], limit: number) {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.id) || seen.size >= limit) return false;
    seen.add(item.id);
    return true;
  });
}

function citationsFor(results: readonly EnergyAssistantSearchResult[]) {
  return results.map(({ source, stale }) => ({
    id: source.id,
    title: source.title,
    publisher: source.publisher,
    url: source.url,
    sourceTier: source.official ? "primary_official" as const : "independent_link_only" as const,
    jurisdiction: source.jurisdiction,
    effectiveFrom: source.effectiveFrom,
    effectiveTo: source.effectiveTo,
    lastChecked: source.reviewedAt,
    reviewDue: source.reviewDue,
    storagePolicy: source.storagePolicy,
    stale,
  }));
}

function boundedEvidenceSentences(
  query: string,
  results: readonly EnergyAssistantSearchResult[],
) {
  const { terms } = queryTerms(query);
  const candidates = results.slice(0, 2).flatMap((result, sourceIndex) =>
    result.source.summary
      .split(/(?<=[.!?])\s+/)
      .map((sentence, sentenceIndex) => ({
        sentence: sentence.trim(),
        sourceIndex,
        sentenceIndex,
        score: tokenScore(terms, sentence, 1),
      }))
      .filter((candidate) => candidate.sentence && candidate.score > 0));
  const selected = candidates
    .sort((left, right) => right.score - left.score
      || left.sourceIndex - right.sourceIndex
      || left.sentenceIndex - right.sentenceIndex)
    .slice(0, 2)
    .sort((left, right) => left.sourceIndex - right.sourceIndex
      || left.sentenceIndex - right.sentenceIndex)
    .map((candidate) => candidate.sentence);
  const answer = selected.join(" ");
  return answer.length <= 800 ? answer : `${answer.slice(0, 797).trimEnd()}...`;
}

function actionsFor(topics: readonly EnergyAssistantTopic[], pageContext?: string) {
  const actions = topics.flatMap((topic) => TOPIC_ACTIONS[topic] || []);
  if (pageContext === "/compare") {
    actions.unshift({ id: "continue-comparison", label: "Continue the open comparison", href: "/compare" });
  } else if (pageContext === "/calculator") {
    actions.unshift({ id: "continue-calculator", label: "Continue the open calculation", href: "/calculator" });
  }
  return uniqueById(actions, 3);
}

function suggestionsFor(topics: readonly EnergyAssistantTopic[]) {
  return uniqueById(
    topics.flatMap((topic) =>
      (TOPIC_SUGGESTIONS[topic] || []).map((label, index) => ({ id: `${topic}:${index}`, label }))),
    3,
  ).map((item) => item.label);
}

function safetyQuery(query: string) {
  return hasAffirmedDangerSignal(query, /\b(?:on fire|caught fire|fire (?:started|burning|at|from)|flames?|sparking|electric shock|electrocut(?:ed|ion)?|gas smell|burning smell)\b/i)
    || batteryFailureEmergencyQuery(query)
    || coAlarmMaintenanceQuery(query)
    || coAlarmEmergencyQuery(query)
    || possibleGasExposureQuery(query)
    || unsafeElectricalEquipmentIncidentQuery(query)
    || unsafeWetRoofSolarAccessQuery(query)
    || unsafeElectricalWorkQuery(query)
    || unsafeUnknownWiringPenetrationQuery(query)
    || unsafeEvChargingSupplyQuery(query)
    || unsafeEvCableRoutingQuery(query)
    || unsafeEnergyInstallationQuery(query)
    || asbestosDisturbanceQuery(query)
    || unsafeInsulationLightCoverQuery(query)
    || unsafeVentBlockingQuery(query)
    || unsafeRoofFoilQuery(query)
    || unsafeCredentialCertificationQuery(query);
}

function unsafeEvChargingSupplyQuery(query: string) {
  return /\b(?:EV|electric vehicle|car)\b/i.test(query)
    && /\b(?:charg(?:e|er|ing)|portable charging lead)\b/i.test(query)
    && /\b(?:power ?board|double adaptor|multi[- ]?plug|extension (?:lead|cord)|piggyback adaptor)\b/i.test(query);
}

function unsafeEvCableRoutingQuery(query: string) {
  return /\b(?:EV|electric vehicle|electric[- ]?car|car)\b/i.test(query)
    && /\b(?:charg(?:e|er|ing)|charging lead|charging cable|EVSE cable|lead|cable)\b/i.test(query)
    && (/\b(?:under|beneath)\s+(?:a\s+)?(?:rug|carpet|mat)\b/i.test(query)
      || /\b(?:through|across|under)\s+(?:a\s+)?(?:door|doorway|garage door|gate)\b/i.test(query)
      || /\b(?:pinch(?:ed|ing)?|crush(?:ed|ing)?|trap(?:ped|ping)?|abrad(?:ed|ing)|fray(?:ed|ing)?|damag(?:ed|ing)|run over|drive over|cover(?:ed|ing)|tightly coiled)\b/i.test(query));
}

function hasAffirmedDangerSignal(query: string, pattern: RegExp) {
  const flags = `${pattern.flags.replace(/g/g, "")}g`;
  const matcher = new RegExp(pattern.source, flags);
  for (const match of query.matchAll(matcher)) {
    const start = match.index ?? 0;
    const before = query.slice(Math.max(0, start - 140), start);
    const clause = before
      .split(/(?:[.!?;]\s*|\b(?:but|however|yet|although|though)\b|\band\s+(?=(?:the|it|this|that|battery|system|charger|outlet|inverter|isolator|there|I|we)\b))/i)
      .at(-1) || "";
    const negated = /\b(?:no|not|without|never|neither|nor|isn['’]?t|aren['’]?t|wasn['’]?t|weren['’]?t|doesn['’]?t|didn['’]?t|hasn['’]?t|hadn['’]?t)\b/i.test(clause);
    if (!negated) return true;
  }
  return false;
}

function batteryFailureEmergencyQuery(query: string) {
  if (!/\b(?:battery|battery system|battery energy storage system|BESS|home storage)\b/i.test(query)) return false;
  return hasAffirmedDangerSignal(query, /\b(?:swollen|swelling|bulging|ruptured|leaking|venting|hissing|popping|crackle|crackling|fizzing|fizzes?|sizzling|bubbling|smoking|smoke|burning|burnt|fumes?|strong odou?r|unusually hot|overheating|on fire)\b/i)
    || hasAffirmedDangerSignal(query, /\b(?:chemical|solvent|acetone|paint[- ]?thinner|sweet|sharp|electrolyte)\s+(?:smell|odou?r|fumes?)\b/i)
    || hasAffirmedDangerSignal(query, /\b(?:smell|odou?r)s?\s+(?:like|of)\s+(?:chemicals?|solvent|acetone|paint[- ]?thinner)\b/i);
}

function benignBatteryDiagnosticQuery(query: string) {
  return /\b(?:battery|battery system|battery energy storage system|BESS|home storage)\b/i.test(query)
    && !batteryFailureEmergencyQuery(query)
    && /\b(?:normal|normally|mildly warm|ordinary fan|normal fan|no|without|not showing|not making)\b/i.test(query)
    && /\b(?:fire|emergency|evacuat(?:e|ion)|safe|normal|fault|warning|worry|concern)\b/i.test(query);
}

function possibleGasExposureQuery(query: string) {
  return /\b(?:gas|LPG|combustion|unflued|unvented|fuel[- ]?burning|cabinet heater|portable gas heater)\b/i.test(query)
    && /\b(?:heater|cooktop|stove|cooker|oven|appliance|flue|room)\b/i.test(query)
    && /\b(?:smell(?:s|ed|ing)?(?:\s+odd)?|odou?r|dizz(?:y|iness)|wooz(?:y|iness)|light[ -]?headed|headache|nausea|faint(?:ed|ing)?|drowsy|confus(?:ed|ion)|weak|unwell|eyes?\s+(?:sting|burn)|irritat(?:e|es|ed|ing|ion)|breath(?:ing|less)|chest)\b/i.test(query);
}

function coAlarmDeviceQuery(query: string) {
  return /\b(?:CO|carbon monoxide)\s+(?:alarm|detector|monitor)\b/i.test(query)
    || /\b(?:alarm|detector|monitor)\b/i.test(query) && /\bcarbon monoxide\b/i.test(query);
}

function coAlarmMaintenanceQuery(query: string) {
  if (!coAlarmDeviceQuery(query)) return false;
  const periodicSingleSignal = (/\b(?:one|single|1)\s+(?:(?:short|tiny|brief|quick|soft|quiet)\s+)?(?:chirp|beep)\b/i.test(query)
      && /\b(?:per|every|once (?:a|each))\s+(?:\d+\s*)?(?:seconds?|minutes?|hours?|minute|hour)\b/i.test(query))
    || /\b(?:chirps?|beeps?)\s+(?:once|one time)\s+(?:per|every)\s+(?:\d+\s*)?(?:seconds?|minutes?|hours?|minute|hour)\b/i.test(query);
  return periodicSingleSignal
    || /\b(?:periodic|occasional|intermittent)\s+(?:single\s+)?(?:chirp|beep)\b/i.test(query)
    || /\b(?:low battery|end of life|replace battery|battery warning)\b/i.test(query)
      && /\b(?:chirp|beep|signal|alarm)\b/i.test(query);
}

function coAlarmEmergencyQuery(query: string) {
  if (!coAlarmDeviceQuery(query) || coAlarmMaintenanceQuery(query)) return false;
  return /\b(?:continuous|continuously|constant|constantly|sustained|full|loud|rapid|repeating|keeps? (?:sounding|beeping|going)|will not stop|won't stop|going off|siren|alarm(?:ing|ed)?)\b/i.test(query)
    || /\b(?:sounds?|sounding|beeps?|beeping)\b/i.test(query)
      && /\b(?:now|again|repeatedly|nonstop|non-stop)\b/i.test(query);
}

function unsafeElectricalEquipmentIncidentQuery(query: string) {
  const equipment = /\b(?:switchboard|meter box|electrical panel|main switch|isolator|DC isolator|DC isolation switch|PV disconnect|inverter|solar system|EVSE|EV charger|electric[- ]?vehicle charger|wall charger|wallbox|charge point|charging unit|charging lead|charging cable|power point|socket|outlet)\b/i.test(query);
  const incident = hasAffirmedDangerSignal(query, /\b(?:smoke|smoking|smouldering|smoldering|burning|burnt|scorched|sparks?|sparked|sparking|arcs?|arced|arcing|flash(?:es|ed|ing)?|flames?|crackle|crackling|popping|melting|melted|charred|very hot|too hot(?: to touch)?|hot to touch|overheating|browned|brown marks?|discolou?red|warped|heat[- ]damaged|ozone|acrid|electrical (?:smell|odou?r)|burning[- ]?plastic|hot plastic|plastic burning)\b/i)
    || hasAffirmedDangerSignal(query, /\b(?:smell|odou?r)s?\s+(?:like|of)\s+(?:ozone|burning plastic|hot plastic|electrical burning)\b/i);
  return equipment && incident;
}

function unsafeWetRoofSolarAccessQuery(query: string) {
  return /\b(?:solar|PV|panels?|array|rooftop system)\b/i.test(query)
    && /\b(?:roof|rooftop|tiles?|sheeting)\b/i.test(query)
    && /\b(?:wet|raining|rain[- ]?soaked|after rain|dew|dewy|frost|icy|slippery|storm)\b/i.test(query)
    && /\b(?:clean|wash|hose|wipe|inspect|check|repair|fix|access|climb|walk|step|go up|get on|work)\b/i.test(query);
}

function unsafeElectricalWorkQuery(query: string) {
  return /\b(?:bypass|bridge|override|defeat|work\s+live|work\s+energised|work\s+energized|remove\s+(?:the\s+)?cover)\b/i.test(query)
    && /\b(?:main switch|switchboard|meter|inverter|isolator|circuit|electrical|solar)\b/i.test(query);
}

function unsafeUnknownWiringPenetrationQuery(query: string) {
  const penetration = /\b(?:drill|drilling|cut|cutting|saw|sawing|screw|screwing|nail|nailing|penetrate|penetrating|make (?:a )?hole|put (?:a )?hole|fix|fixing|fixings|attach|mount|fasten|fastening)\b/i.test(query);
  const buildingSurface = /\b(?:wall|ceiling|floor|roof|stud|cavity|plaster|plasterboard|lining|frame|door frame|window frame|skirting|architrave)\b/i.test(query);
  const concealedElectrical = /\b(?:wire|wires|wiring|cable|cables|electrical service|electrical services)\b/i.test(query);
  const uncertainty = /\b(?:unknown|not sure|unsure|do not know|don't know|cannot tell|can't tell|cannot locate|can't locate|cannot see|can't see|may be|might be|could be|possibly|where .*\b(?:run|runs|are|is)|hidden|concealed)\b/i.test(query);
  const fixingContext = /\b(?:short|shallow|\d+(?:\.\d+)?\s*(?:mm|cm)|depth|behind|within|route|path|fixing|bracket|seal|strip|draught|draft)\b/i.test(query);
  return penetration && (buildingSurface || fixingContext) && concealedElectrical && uncertainty;
}

function unsafeRefrigerantReleaseQuery(query: string) {
  const refrigerantSystem = /\b(?:split system|reverse[ -]cycle|air conditioner|aircon|refrigerant|refrigerant lines?|line set|gas charge)\b/i.test(query);
  const releaseWork = /\b(?:vent|venting|release|releasing|degas|degass|degassing|bleed|bleeding|purge|purging|dump|dumping|discharge|discharging|recover|recovering|remove (?:the )?(?:gas|refrigerant|charge)|empty (?:the )?(?:gas|refrigerant|charge))\b/i.test(query);
  const diySignal = /\b(?:DIY|myself|ourselves|my own|our own|without (?:an? )?(?:technician|installer|refrigerant licence)|how (?:do|can|would) I|can I|could I|may I|should I)\b/i.test(query);
  return refrigerantSystem && releaseWork && diySignal;
}

function unsafeEnergyInstallationQuery(query: string) {
  const diySignal = /\b(?:DIY|myself|ourselves|my own|our own|without (?:an? )?(?:electrician|plumber|technician|installer|refrigerant licence)|how (?:do|can) I|can I|could I|may I)\b/i.test(query);
  if (!diySignal) return false;
  const electricalInstall = /\b(?:hardwir(?:e|ed|ing)|wire|connect|install|replace|fit)\b/i.test(query)
    && /\b(?:induction|cooktop|heat[- ]?pump hot[- ]?water|hot[- ]?water heat[- ]?pump|HPWH|water heater)\b/i.test(query);
  const refrigerantInstall = /\b(?:install|fit|mount|wire|connect|commission|vacuum|flare|charge|top up|open)\b/i.test(query)
    && /\b(?:split system|reverse[ -]cycle|air conditioner|aircon|refrigerant|refrigerant lines?|line set|gas charge)\b/i.test(query);
  return electricalInstall || refrigerantInstall || unsafeRefrigerantReleaseQuery(query);
}

function asbestosDisturbanceQuery(query: string) {
  const suspectLooseFillSample = /\b(?:vermiculite|loose[ -]?fill(?:\s+insulation)?|loose insulation|granular insulation|unknown insulation)\b/i.test(query)
    && /\b(?:sample|test|collect|collection|scoop|bag|mail|send|pick up|handle|take|pinch|spoonful|teaspoon|jar|envelope|lab|laboratory|test kit)\b/i.test(query)
    && /\b(?:DIY|myself|ourselves|home test|self[- ]?sample|send it|mail it|can I|could I|should I|how do I|take (?:a )?(?:sample|pinch|spoonful)|collect (?:a )?sample)\b/i.test(query);
  if (suspectLooseFillSample) return true;
  const disturbance = /\b(?:remove|cut|drill|saw|sand|break|disturb|demolish|penetrate|sample|test|install|mount|fix|score|slice|pierce|make\s+(?:a\s+)?hole|put\s+(?:a\s+)?hole|run\s+(?:a\s+)?cable|route\s+(?:a\s+)?cable|fit\s+(?:an?\s+)?aircon)\b/i.test(query)
    || /\b(?:hole|knife|cable|aircon|air conditioner)\b/i.test(query)
      && /\b(?:make|put|use|run|route|push|fit|mount|install|through|into|across)\b/i.test(query);
  if (!disturbance) return false;
  if (/\basbestos\b/i.test(query)) return true;
  if (/\b(?:new|modern|recently installed|newly installed)\b/i.test(query)) return false;
  const legacySignal = /\b(?:old|older|original|legacy|vintage|aged|existing|unknown age|not sure how old|pre[ -]?1990|19[4-8]\d(?:s)?)\b/i.test(query)
    || /\bfibro\b/i.test(query);
  const suspectSheeting = /\b(?:fibro|fibre[ -]?cement|fiber[ -]?cement|cement sheeting|cement sheet|eaves?|soffits?)\b/i.test(query);
  return legacySignal && suspectSheeting;
}

function unsafeInsulationLightCoverQuery(query: string) {
  return /\b(?:insulation|insulation batts?|batts?|loose[ -]?fill|vermiculite)\b/i.test(query)
    && /\b(?:downlights?|recessed lights?|light fittings?|halogen lights?|halogen downlights?|lighting transformers?|hot transformers?|transformers?|drivers?|electrical fittings?)\b/i.test(query)
    && /\b(?:cover|covered|covering|over|on top of|across|around|against|touch|touching|surround|surrounding|bury|buried|fill|filled|filling|place|placed|placing|put|putting|lay|laid|install|installed|clearance|gaps?|exposed|visible|among|safe|leave)\b/i.test(query);
}

function unsafeVentBlockingQuery(query: string) {
  const blocking = /\b(?:tape|taped|taping|seal|sealed|sealing|block|blocked|blocking|cover|covered|covering|close|closed|closing|plug|plugged|cap|capped|remove)\b/i.test(query);
  const clearVent = /\b(?:vents?|flues?|ventilation\s+(?:grilles?|registers?|openings?)|air\s+(?:grilles?|registers?|openings?)|(?:wall|floor|ceiling|supply|return)\s+(?:grilles?|registers?|openings?))\b/i.test(query);
  const contextualVent = /\b(?:grilles?|registers?|openings?)\b/i.test(query)
    && /\b(?:air|airflow|ventilation|draught|draft|heating|cooling|heater|furnace|gas)\b/i.test(query);
  return blocking && (clearVent || contextualVent);
}

function unsafeRoofFoilQuery(query: string) {
  return /\b(?:foil|reflective foil|foil insulation|metallic insulation|metal foil|reflective sarking)\b/i.test(query)
    && /\b(?:roof|roof tiles?|roof space|rafters?|sarking)\b/i.test(query)
    && /\b(?:DIY|install|put|place|staple|fit|add|lay|run|wrap|across|over|near|touch|touching|move|shift|lift|push|pull|nudge|sweep|broom|pole|enter|crawl|climb|inspect|look|safe)\b/i.test(query)
    && /\b(?:wiring|wires?|cables?|electrical|downlights?|conductors?|DIY|install|staple|fit|add|lay|place|put)\b/i.test(query);
}

function unsafeCredentialCertificationQuery(query: string) {
  const credentialSharing = /\b(?:share|lend|loan|borrow|give|use|copy|send|log in with|sign in with)\b/i.test(query)
    && /\b(?:password|login|account|licen[cs]e|accreditation|credential|certificate agent|installer number|registration)\b/i.test(query)
    && /\b(?:trade|installer|electrician|plumber|apprentice|worker|employee|supervisor|VEU|VEEC|ESS|ESC|PDRS|PRC|STC|Creditex|TLink|certif)\b/i.test(query);
  const unauthorisedCertification = /\b(?:certify|sign[ -]?off|approve|declare compliant|create certificates?|submit certificates?)\b/i.test(query)
    && /\b(?:someone else|another person|not (?:my|our) work|did not|didn't|was not|wasn't|never|without (?:checking|review|authority|licen[cs]e|accreditation)|unverified)\b/i.test(query);
  const workerUnderSharedLogin = /\b(?:apprentice|worker|employee|technician|team member)\b/i.test(query)
    && /\b(?:under|using|with|through)\s+(?:my|our|another|someone else's)\s+(?:login|account|credentials?)\b/i.test(query)
    && /\b(?:upload|submit|enter|edit|sign|certify|evidence|forms?|job)\b/i.test(query);
  return credentialSharing || unauthorisedCertification || workerUnderSharedLogin;
}

type EnergyAssistantPlaybookId = "solar_stc" | "draught" | "ev1_ev2" | "heat_pump_selection" | "trade_platform";

function directPlaybookId(
  message: string,
  audience?: EnergyAssistantAudience,
): EnergyAssistantPlaybookId | null {
  const tradeNavigation = audience === "trade"
    && /\b(?:TLink|Creditex|dashboard|workspace|platform|job|schedule|calendar|calculator|form|evidence|quote|invoice|standards|where (?:do|can|is)|how (?:do|can)|open the)\b/i.test(message);
  if (tradeNavigation) return "trade_platform";
  if (
    !(/\b(?:NatHERS|NCC)\b/i.test(message) && /\b(?:climate|zone|location|map|postcode)\b/i.test(message))
    && (
    /\b(?:STC|STCs|small-scale technology certificate)\b/i.test(message)
    || /(?:\$\s*[\d,]+(?:\.\d+)?\s*(?:per|\/)\s*certificate|certificate\s+(?:price|value|rate))\b/i.test(message)
    || /\b(?:solar|PV|panel|battery)\b/i.test(message)
      && /\b(?:rebate|discount|certificate|incentive)\b/i.test(message)
    )
  ) return "solar_stc";
  if (/\b(?:draught|draft|air leak|air leakage|blower door|draught proof|draft proof)\b/i.test(message)) {
    return "draught";
  }
  if (/\b(?:EV\s*1\s*(?:vs\.?|versus|or|\/|and)\s*EV\s*2|level\s*1\s*(?:vs\.?|versus|or|\/|and)\s*level\s*2)\b/i.test(message)) {
    return "ev1_ev2";
  }
  if (
    /\b(?:heat[- ]?pump|reverse[ -]cycle|RCAC|solar water heater|SWH|HPHW|HPWH|HWS|heater|heating system|air conditioner|air conditioning)\b/i.test(message)
    && (
      /\b(?:what|which)(?:\s+[a-z-]+){0,3}\s+(?:heat[- ]?pump|reverse[ -]cycle|RCAC|solar water heater|SWH|HPHW|HPWH|HWS|heater|heating system|air conditioner|air conditioning)\b/i.test(message)
      || /\b(?:heat[- ]?pump|reverse[ -]cycle|RCAC|solar water heater|SWH|HPHW|HPWH|HWS|heater|heating system|air conditioner|air conditioning)\b.{0,60}\b(?:should I (?:get|buy|choose)|recommend|best|compare|versus|vs\.?|model|brand)\b/i.test(message)
      || /\b(?:best|recommend|choose|buy|compare)\b.{0,40}\b(?:heat[- ]?pump|reverse[ -]cycle|RCAC|solar water heater|SWH|HPHW|HPWH|HWS|heater|heating system|air conditioner|air conditioning)\b/i.test(message)
    )
  ) return "heat_pump_selection";
  return null;
}

function decisionPlaybookId(
  query: string,
  priorUserMessages: readonly string[],
  audience: EnergyAssistantAudience | undefined,
  usePriorContext: boolean,
) {
  const current = directPlaybookId(query, audience);
  if (current) return current;
  for (const prior of [...priorUserMessages].slice(-8).reverse()) {
    const priorId = directPlaybookId(prior, audience);
    if (priorId && (usePriorContext || isLikelyPlaybookFollowUp(priorId, query))) return priorId;
  }
  return null;
}

function playbookConversationFrame(
  playbookId: EnergyAssistantPlaybookId | null,
  query: string,
  priorUserMessages: readonly string[],
) {
  if (!playbookId) return query;
  const bounded = [...priorUserMessages].slice(-8);
  let lastDifferentAnchor = -1;
  for (let index = 0; index < bounded.length; index += 1) {
    const candidate = directPlaybookId(bounded[index], undefined);
    if (candidate && candidate !== playbookId) lastDifferentAnchor = index;
  }
  let anchor = -1;
  for (let index = lastDifferentAnchor + 1; index < bounded.length; index += 1) {
    if (directPlaybookId(bounded[index], undefined) === playbookId) {
      anchor = index;
      break;
    }
  }
  if (anchor < 0) {
    let start = bounded.length;
    for (let index = bounded.length - 1; index >= 0; index -= 1) {
      if (isLikelyPlaybookFollowUp(playbookId, bounded[index])) {
        start = index;
      } else if (start < bounded.length) {
        break;
      }
    }
    return start < bounded.length ? [...bounded.slice(start), query].join("\n") : query;
  }
  return [...bounded.slice(anchor), query].join("\n");
}

function evSavingsConversationFrame(query: string, priorUserMessages: readonly string[]) {
  const bounded = [...priorUserMessages].slice(-8);
  const anchorPattern = /\b(?:EV|electric (?:car|vehicle)|petrol|diesel|fuel)\b/i;
  const savingPattern = /\b(?:save|saving|savings|annual cost|yearly cost|running cost|switch(?:ing)?|compare|cost difference)\b/i;
  let anchor = -1;
  for (let index = bounded.length - 1; index >= 0; index -= 1) {
    if (anchorPattern.test(bounded[index]) && savingPattern.test(bounded[index])) {
      anchor = index;
      break;
    }
  }
  if (anchor < 0) return query;
  const explicitDifferentTopic = /\b(?:STCs?|rebate|NatHERS|NCC|insulation|draught|draft|hot[- ]?water|HPHW|solar|battery|glazing|window|heat pump)\b/i.test(query)
    && !/\b(?:EV|electric (?:car|vehicle)|petrol|diesel|fuel|charging)\b/i.test(query);
  return explicitDifferentTopic ? query : [...bounded.slice(anchor), query].join("\n");
}

function wholeHomeConversationFrame(query: string, priorUserMessages: readonly string[]) {
  const bounded = [...priorUserMessages].slice(-8);
  let anchor = -1;
  for (let index = bounded.length - 1; index >= 0; index -= 1) {
    if (/\b(?:whole[- ]home|whole of home|healthier.*cheaper|cheaper.*comfortable|where (?:do I |to )?start|staged plan|(?:house|home|place).*(?:uncomfortable|gross|hot|cold|boiling|cooks?|hard to heat).*(?:bills?|expensive|costs?|money|savage)|(?:bills?|expensive|costs?|money|savage).*(?:house|home|place).*(?:uncomfortable|gross|hot|cold|cooks?))\b/i.test(bounded[index])) {
      anchor = index;
      break;
    }
  }
  if (anchor < 0) return query;
  const explicitNewTopic = directPlaybookId(query, undefined) !== null
    || /\b(?:compare .*vehicles?|STCs?|NatHERS certificate|NEM12|draft professional|recipe|rebate amount)\b/i.test(query);
  return explicitNewTopic ? query : [...bounded.slice(anchor), query].join("\n");
}

function isLikelyPlaybookFollowUp(playbook: EnergyAssistantPlaybookId, message: string) {
  if (playbook === "solar_stc") {
    return /\b(?:\d{4}|STC zone|20\d{2}|solar|PV|panel|battery|new system|replacement|added capacity|kW|kWh|existing|model|approved|accredited|installer|agent|certificate quantity|discount|rebate|ACT|NSW|NT|QLD|SA|TAS|VIC|WA|Victoria|Queensland|Tasmania)\b/i.test(message);
  }
  if (playbook === "draught") {
    return /\b(?:house|apartment|unit|townhouse|brick|weatherboard|timber|room|door|window|floor|ceiling|winter|summer|cold|hot|condensation|mould|mold|damp|moisture|heater|fireplace|combustion|reverse cycle|none noticed)\b/i.test(message);
  }
  if (playbook === "ev1_ev2") {
    return /\b(?:charging|charger|tariff|plan|product|model|vehicle|onboard|km|park|overnight|switchboard|phase|circuit|solar|off-peak)\b/i.test(message);
  }
  if (playbook === "heat_pump_selection") {
    return /\b(?:space heating|cooling|hot water|postcode|climate|design temperature|heat load|demand|litres|occupants?|people|persons?|showers?|baths?|peak draw|supply|switchboard|single phase|three phase|outdoor unit|outdoor location|bedroom window|installation space|placement|access|clearance|noise|condensate|drain|existing system|replace|replacement|electric resistance|gas storage|capacity|COP|GEMS|CER|eligible|refrigerant|controls?|controlled load|timer|tariff|time of use|overnight|solar|warranty|service|quote|model)\b/i.test(message)
      || /^[A-Z][A-Za-z' .-]{2,45}(?:,\s*(?:ACT|NSW|NT|QLD|SA|TAS|VIC|WA))?$/.test(message.trim())
        && message.trim().split(/\s+/).length <= 5;
  }
  return /\b(?:TLink|Creditex|dashboard|workspace|job|schedule|calendar|calculator|form|evidence|quote|invoice|standard)\b/i.test(message);
}

function missingSolarStcSlots(conversation: string): SolarStcSlot[] {
  const present = new Set<SolarStcSlot>();
  if (/\b\d{4}\b/.test(conversation) || /\bSTC\s*zone\s*[1-4]\b/i.test(conversation)) {
    present.add("location");
  }
  if (
    /\b(?:[0-3]?\d[\/-][01]?\d[\/-]20\d{2}|20\d{2}-[01]\d-[0-3]\d)\b/.test(conversation)
    || /\b(?:[0-3]?\d\s+)?(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+20\d{2}\b/i.test(conversation)
  ) present.add("installationDate");
  if (/\b(?:solar|PV|panel|battery|storage)\b/i.test(conversation)) present.add("technology");
  if (/\b(?:completely new|brand[- ]new|new(?:\s+\d+(?:\.\d+)?\s*kW(?:h|p)?)?\s+(?:system|array)|replacement|replace|added capacity|add capacity|expand|extension|no existing solar capacity(?:\s+and\s+no prior STC claim)?)\b/i.test(conversation)) {
    present.add("projectType");
  }
  if (/\b\d+(?:\.\d+)?\s*kW(?:h|p)?\b/i.test(conversation)) present.add("capacity");
  if (/\b(?:existing|remain connected|no (?:existing )?(?:solar capacity|solar|panel|inverter|battery|component)|none installed|completely new|brand[- ]new|new install(?:ation)?|new system)\b/i.test(conversation)) {
    present.add("existingComponents");
  }
  if (/\b(?:exact (?:brand|model)|brand and model|model number|exact (?:products?|panels?(?: and (?:the )?inverter)?|panel and inverter) (?:is |are )?approved|approved (?:products?|lists?)|products? (?:is |are )?(?:on )?(?:the )?approved lists?|listed product|CEC approved)\b/i.test(conversation)) {
    present.add("approvedProducts");
  }
  if (/\b(?:(?:accredited|licensed) installer|registered (?:certificate )?agent|installer and agent|installer confirmed|accredited delivery (?:is )?confirmed)\b/i.test(conversation)) {
    present.add("accreditedDelivery");
  }
  if (/\b(?:certificate quantity|STC (?:count|quantity|number|price|value)|how many STCs|dollar (?:discount|amount)|quote discount|rebate amount|how much rebate)\b/i.test(conversation)
    || /\$\s*[\d,]+(?:\.\d+)?\s*(?:per|\/)?\s*(?:STC|certificate)\b/i.test(conversation)) {
    present.add("requestedOutcome");
  }
  const jurisdiction = explicitProgramJurisdiction(conversation);
  if (jurisdiction && jurisdiction[0] !== "AU") present.add("stateContext");
  return SOLAR_STC_SLOT_ORDER.filter((slot) => slot !== "requestedOutcome" && !present.has(slot));
}

function missingDraughtSlots(conversation: string): DraughtSlot[] {
  const present = new Set<DraughtSlot>();
  if (/\b(?:house|apartment|unit|townhouse|brick|weatherboard|timber|concrete|masonry|built in|year old|19\d{2}|20\d{2})\b/i.test(conversation)) {
    present.add("building");
  }
  if (/\b(?:bedroom|lounge|living room|hall|door|window|floor|ceiling|winter|summer|overnight|windy|cold room|hot room)\b/i.test(conversation)) {
    present.add("comfort");
  }
  if (/\b(?:condensation|mould|mold|damp|moisture|no moisture|no mould|no mold|none noticed)\b/i.test(conversation)) {
    present.add("moisture");
  }
  if (/\b(?:gas heater|unflued heater|wood (?:fire|heater)|fireplace|combustion|reverse cycle|heat pump|electric heater|no heating)\b/i.test(conversation)) {
    present.add("heating");
  }
  return DRAUGHT_SLOT_ORDER.filter((slot) => !present.has(slot));
}

function evComparisonMeaning(conversation: string): "charging" | "tariff" | "product" | null {
  if (/\b(?:charging|charger|charge point|level 1|level 2)\b/i.test(conversation.replace(/EV\s*[12]/gi, ""))) {
    return "charging";
  }
  if (/\b(?:tariff|electricity plan|energy plan|rate plan)\b/i.test(conversation)) return "tariff";
  if (/\b(?:product|model|vehicle model|charger model)\b/i.test(conversation)) return "product";
  return null;
}

function missingEvChargingSlots(conversation: string): EvChargingSlot[] {
  const present = new Set<EvChargingSlot>();
  if (/\b(?:vehicle model|onboard (?:AC )?charg(?:er|ing)|[A-Z][A-Za-z0-9-]+\s+[A-Z0-9][A-Za-z0-9-]+)\b/.test(conversation)) {
    present.add("vehicle");
  }
  if (/\b\d+(?:\.\d+)?\s*km\b/i.test(conversation) && /\b(?:park|home|overnight|hours?)\b/i.test(conversation)) {
    present.add("dailyUse");
  }
  if (/\b(?:single phase|three phase|3 phase|switchboard|site supply|circuit capacity|amps?)\b/i.test(conversation)) {
    present.add("siteSupply");
  }
  if (/\b(?:tariff|time of use|off-peak|solar|daytime charging)\b/i.test(conversation)) {
    present.add("tariffSolar");
  }
  return EV_CHARGING_SLOT_ORDER.filter((slot) => !present.has(slot));
}

function missingHeatPumpSelectionSlots(conversation: string): HeatPumpSelectionSlot[] {
  const present = new Set<HeatPumpSelectionSlot>();
  if (/\b(?:space heating|heating and cooling|room heating|hot water|water heating|solar water heating|SWH|HWS|HPWH|HPHW|heat[- ]?pump water heater|reverse[ -]cycle|RCAC|heater|heating system|air conditioner|air conditioning)\b/i.test(conversation)) {
    present.add("purpose");
  }
  const hasNamedLocationReply = conversation.split(/\r?\n/).some((line) => {
    const clean = line.trim();
    return clean.split(/\s+/).length <= 5
      && /^[A-Z][A-Za-z' .-]{2,45}(?:,\s*(?:ACT|NSW|NT|QLD|SA|TAS|VIC|WA))?$/.test(clean)
      && !/^(?:yes|no|maybe|unsure|not sure|heat pump|hot water|space heating)$/i.test(clean);
  });
  if (/\b(?:postcode\s*)?\d{4}\b/i.test(conversation)
    || explicitProgramJurisdiction(conversation)
    || hasNamedLocationReply) {
    present.add("climate");
  }
  if (/\b(?:heat load|heating load|cooling load|hot-water demand|hot water demand|litres|(?:\d+|one|two|three|four|five|six|seven|eight)\s*(?:people|persons?|occupants?)|showers?|baths?|peak draw)\b/i.test(conversation)) {
    present.add("demand");
  }
  if (/\b(?:single phase|three phase|switchboard|site supply|installation space|outdoor unit|placement|accessible|access|clearance|noise|condensate|drainage)\b/i.test(conversation)) {
    present.add("site");
  }
  if (/\b(?:capacity retention|delivered capacity|COP|coefficient of performance|outdoor temperature|at -?\d+\s*°?C)\b/i.test(conversation)) {
    present.add("temperaturePerformance");
  }
  if (/\b(?:GEMS|Energy Rating|CER|approved list|eligibility list|state eligibility)\b/i.test(conversation)) {
    present.add("officialEligibility");
  }
  if (/\b(?:refrigerant|R\d{2,3}[A-Za-z]?|controls|timer|demand management)\b/i.test(conversation)) {
    present.add("refrigerantControls");
  }
  if (/\b(?:warranty|local service|Australian service|parts|response time)\b/i.test(conversation)) {
    present.add("support");
  }
  if (/\b(?:written quote|quote includes|commissioning|exclusions|scope of work|model number)\b/i.test(conversation)) {
    present.add("quoteEvidence");
  }
  return HEAT_PUMP_SELECTION_SLOT_ORDER.filter((slot) => !present.has(slot));
}

function numericCapture(conversation: string, pattern: RegExp) {
  const match = conversation.match(pattern);
  if (!match?.[1]) return null;
  const value = Number(match[1].replaceAll(",", ""));
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function evAnnualSavingsInputs(conversation: string) {
  const annualKm = numericCapture(
    conversation,
    /\b([\d,]+(?:\.\d+)?)\s*km\s*(?:\/\s*(?:year|yr)|a year|per year|each year|yearly|annually|annual)\b/i,
  ) ?? (() => {
    if (!/\b(?:annual|annually|per year|each year|a year|yearly)\b/i.test(conversation)) return null;
    const distances = [...conversation.matchAll(/\b([\d,]+(?:\.\d+)?)\s*km\b/gi)]
      .filter((match) => {
        const prefix = conversation.slice(Math.max(0, (match.index || 0) - 30), match.index);
        return !/\b(?:L|litres?|kWh)\s*(?:\/\s*|every\s+|per\s+)$/i.test(prefix);
      })
      .map((match) => Number(match[1].replaceAll(",", "")))
      .filter((value) => Number.isFinite(value));
    return distances.length ? Math.max(...distances) : null;
  })();
  const fuelLitresPer100Km = numericCapture(conversation, /\b(\d+(?:\.\d+)?)\s*(?:L|litres?)\s*(?:\/\s*|every\s+|per\s+)100(?:\s*km)?\b/i);
  const fuelDollarsPerLitre = numericCapture(conversation, /\$\s*(\d+(?:\.\d+)?)\s*(?:\/|per|a)\s*(?:L|litre)\b/i)
    ?? (() => {
      const cents = numericCapture(conversation, /\b(\d+(?:\.\d+)?)\s*c(?:ents?)?\s*(?:\/|per|a)\s*(?:L|litre)\b/i);
      return cents === null ? null : cents / 100;
    })();
  const evKwhPer100Km = numericCapture(conversation, /\b(\d+(?:\.\d+)?)\s*kWh\s*(?:\/\s*|every\s+|per\s+)100(?:\s*km)?\b/i);
  const homeCentsPerKwh = numericCapture(conversation, /\bhome(?: charging)?(?: price| rate)?[^\d]{0,30}(\d+(?:\.\d+)?)\s*(?:c|cents?)(?:\s*(?:\/|per|a)\s*kWh)?\b/i)
    ?? numericCapture(conversation, /\b(\d+(?:\.\d+)?)\s*(?:c|cents?)\s*(?:\/|per|a)\s*kWh[^\n.]{0,30}\bhome\b/i);
  const publicCentsPerKwh = numericCapture(conversation, /\bpublic(?: charging)?(?: price| rate)?[^\d]{0,30}(\d+(?:\.\d+)?)\s*(?:c|cents?)(?:\s*(?:\/|per|a)\s*kWh)?\b/i)
    ?? numericCapture(conversation, /\b(\d+(?:\.\d+)?)\s*(?:c|cents?)\s*(?:\/|per|a)\s*kWh[^\n.]{0,30}\bpublic\b/i);
  const blendedCentsPerKwh = numericCapture(conversation, /\$\s*(\d+(?:\.\d+)?)\s*(?:\/|per|a)\s*kWh\b/i)
    ?.valueOf();
  const blendedCents = blendedCentsPerKwh === null || blendedCentsPerKwh === undefined
    ? homeCentsPerKwh === null && publicCentsPerKwh === null
      ? numericCapture(conversation, /\b(\d+(?:\.\d+)?)\s*(?:c|cents?)\s*(?:\/|per|a)\s*kWh\b/i)
      : null
    : blendedCentsPerKwh * 100;
  const homePercent = numericCapture(conversation, /\b(\d+(?:\.\d+)?)\s*(?:%|per ?cent|percent)\s*(?:at |from |is |would be )?home\b/i)
    ?? numericCapture(conversation, /\bhome(?: charging)?[^\d]{0,20}(\d+(?:\.\d+)?)\s*(?:%|per ?cent|percent)/i);
  const chargingLossPercent = numericCapture(
    conversation,
    /\b(\d+(?:\.\d+)?)\s*(?:%|per ?cent\b|percent\b)\s+(?:charging\s+)?loss(?:es)?\b/i,
  ) ?? numericCapture(
    conversation,
    /\b(?:charging\s+)?loss(?:es)?(?:\s+(?:of|at|are|is))?\s*(\d+(?:\.\d+)?)\s*(?:%|per ?cent\b|percent\b)/i,
  );
  const consumptionIncludesChargingLoss = /\b(?:at[- ]?wall|wall[- ]to[- ]battery|from the (?:wall|socket|charger))\b/i.test(conversation)
    || /\b(?:consumption|figure|rating|energy use|\d+(?:\.\d+)?\s*kWh\s*(?:\/|per)\s*100\s*km)\b[^.\n]{0,45}\b(?:is |measured |stated )?(?:grid[- ]side|at[- ]wall|includes? charging losses?)\b/i.test(conversation);
  return {
    annualKm,
    fuelLitresPer100Km,
    fuelDollarsPerLitre,
    evKwhPer100Km,
    homeCentsPerKwh,
    publicCentsPerKwh,
    blendedCentsPerKwh: blendedCents,
    homePercent: homePercent !== null && homePercent <= 100 ? homePercent : null,
    chargingLossPercent: !consumptionIncludesChargingLoss && chargingLossPercent !== null && chargingLossPercent < 100
      ? chargingLossPercent
      : null,
    consumptionIncludesChargingLoss,
  };
}

type SuppliedVehicleComparisonRow = {
  label: string;
  whPerKm: number;
  rangeKm: number | null;
  testCycle: string | null;
};

function suppliedVehicleComparisonRows(conversation: string): SuppliedVehicleComparisonRow[] {
  const sharedCycle = conversation.match(/\b(?:both(?:\s+use)?|same|shared)\s+(?:the\s+)?(WLTP|NEDC|ADR\s*81\/02|ADR|EPA)(?:\s+(?:test\s+)?cycle)?\b/i)?.[1]
    || conversation.match(/\b(?:same|shared)\s+(?:test\s+)?cycle\s*(?:of|is|:|=)?\s*(WLTP|NEDC|ADR\s*81\/02|ADR|EPA)\b/i)?.[1]
    || (/\b(?:same|shared)\s+(?:test\s+)?cycle\b/i.test(conversation) ? "shared stated cycle" : null);
  const inlineRows = [...conversation.matchAll(
    /\b((?:Car|Vehicle|EV|Model)\s+[A-Z0-9][A-Za-z0-9.'-]{0,30})\s+(?:is\s+|uses?\s+|consumes?\s+|at\s+|rated\s+at\s+)?([\d,]+(?:\.\d+)?)\s*(Wh\s*(?:\/|per)\s*km|kWh\s*(?:\/|per)\s*100\s*km)?/gi,
  )];
  if (inlineRows.length >= 2 && sharedCycle && inlineRows.some((match) => match[3])) {
    const explicitUnit = inlineRows.find((match) => match[3])?.[3] || "";
    const rows = inlineRows.slice(0, 2).flatMap((match) => {
      const value = Number(match[2].replaceAll(",", ""));
      const unit = match[3] || explicitUnit;
      const whPerKm = /kWh/i.test(unit) ? value * 10 : value;
      return Number.isFinite(whPerKm) && whPerKm > 0 && whPerKm <= 2000
        ? [{
          label: match[1].replace(/\s+/g, " ").trim(),
          whPerKm,
          rangeKm: null,
          testCycle: sharedCycle.toUpperCase() === "SHARED STATED CYCLE"
            ? "shared stated cycle"
            : sharedCycle.toUpperCase().replace(/\s+/g, " "),
        }]
        : [];
    });
    if (rows.length === 2) return rows;
  }
  const cleaned = conversation
    .replace(/\bLocal\s+(?:Green Vehicle Guide|GVG)(?:\s+CSV)?\s+comparison\s*:\s*/gi, "")
    .replace(
      /(Wh\s*(?:\/|per)\s*km|kWh\s*(?:\/|per)\s*100\s*km)\s+(?=[A-Z][A-Za-z0-9 .'-]{0,60}?\s+(?:is\s+|uses\s+|at\s+|rated\s+at\s+)?[\d,]+(?:\.\d+)?\s*(?:Wh\s*(?:\/|per)\s*km|kWh\s*(?:\/|per)\s*100\s*km))/gi,
      "$1; ",
    );
  const segments = cleaned.split(/\s*;\s*|\r?\n+|(?=\b(?:Car|Vehicle)\s*[AB12]\b)/i);
  const rows: SuppliedVehicleComparisonRow[] = [];
  const commonCycle = sharedCycle;
  for (const segment of segments) {
    const wh = segment.match(/\b([\d,]+(?:\.\d+)?)\s*Wh\s*(?:\/|per)\s*km\b/i);
    const kwh = segment.match(/\b([\d,]+(?:\.\d+)?)\s*kWh\s*(?:\/|per)\s*100\s*km\b/i);
    const energyMatch = wh || kwh;
    if (!energyMatch?.[1] || energyMatch.index === undefined) continue;
    const energyValue = Number(energyMatch[1].replaceAll(",", ""));
    const whPerKm = wh ? energyValue : energyValue * 10;
    if (!Number.isFinite(whPerKm) || whPerKm <= 0 || whPerKm > 2000) continue;
    const afterEnergy = segment.slice(energyMatch.index + energyMatch[0].length);
    const range = afterEnergy.match(/\b([\d,]+(?:\.\d+)?)\s*km\s*(?:certified\s+|electric\s+)?range\b/i)
      || afterEnergy.match(/\brange\s*(?:of|is|:|=)?\s*([\d,]+(?:\.\d+)?)\s*km\b/i);
    const rangeKm = range?.[1] ? Number(range[1].replaceAll(",", "")) : null;
    const cycle = (segment.match(/\b(WLTP|NEDC|ADR\s*81\/02|ADR|EPA)\b/i)?.[1] || commonCycle)
      ?.toUpperCase()
      .replace(/\s+/g, " ") || null;
    const rowToken = segment.match(/^\s*((?:Car|Vehicle)\s*[AB12])\b/i)?.[1] || "";
    const parsedLabel = segment
      .slice(0, energyMatch.index)
      .replace(/^.*?\b(?:Car|Vehicle)\s*[AB12]\s*(?:[:=-]\s*)?/i, "")
      .replace(/^\s*(?:comparison|compare)\s*:\s*/i, "")
      .replace(/[,:;\s-]*(?:is|has|uses|with|at|rated at|energy use|consumption|certified consumption)\s*$/i, "")
      .replace(/^[\s,;:.-]+|[\s,;:.-]+$/g, "")
      .replace(/\s+/g, " ")
      .trim();
    const label = parsedLabel || rowToken;
    if (!label || label.length > 100 || (rangeKm !== null && (!Number.isFinite(rangeKm) || rangeKm <= 0 || rangeKm > 3000))) continue;
    rows.push({ label, whPerKm, rangeKm, testCycle: cycle });
  }
  return rows.slice(0, 2);
}

function exactVehiclePair(conversation: string) {
  const explicitVehicleComparison = conversation.match(
    /\b(?:compare|choose between|decide between)\s+([^\n?]{2,60}?)\s+(?:vs\.?|versus|or|and|with)\s+([^\n?]{2,60}?)(?:\?|$)/i,
  );
  const choiceComparison = conversation.match(
    /\b(?:a|an)\s+([A-Z0-9][A-Za-z0-9 -]{1,45}?)\s+(?:vs\.?|versus|or)\s+(?:a|an)\s+([A-Z0-9][A-Za-z0-9 -]{1,45}?)(?:\?|$)/,
  );
  const performanceComparison = conversation.match(
    /\b(?:which|what)\b[^\n?]{0,100}?\b(?:a|an)\s+([A-Z0-9][A-Za-z0-9 -]{1,45}?)\s+(?:vs\.?|versus|or|and)\s+(?:a|an\s+)?([A-Z0-9][A-Za-z0-9 -]{1,45}?)(?:\?|$)/i,
  );
  const performanceWithoutArticles = conversation.match(
    /\b(?:[Ww]hich|[Ww]hat)\b[^\n?]{0,80}?\b(?:the\s+)?([A-Z0-9][A-Za-z0-9 -]{1,45}?)\s+\b(?:vs\.?|versus|or|and)\b\s+(?:the\s+)?([A-Z0-9][A-Za-z0-9 -]{1,45}?)(?:\?|$)/,
  );
  const leadingNamedPair = conversation.match(
    /^\s*([A-Z0-9][A-Za-z0-9 -]{1,45}?)\s+(?:vs\.?|versus|or)\s+([A-Z0-9][A-Za-z0-9 -]{1,45}?)\s+(?:which|what)\b/i,
  );
  const match = explicitVehicleComparison || choiceComparison || performanceComparison || performanceWithoutArticles || leadingNamedPair;
  if (!match) return null;
  const clean = (value: string) => value
    .replace(/^(?:a|an)\s+/i, "")
    .replace(/\s+for\s+(?:me|my family|our family|my household)\.?$/i, "")
    .replace(/[.!,;:]+$/, "")
    .replace(/\s+/g, " ")
    .trim();
  const left = clean(match[1]);
  const right = clean(match[2]);
  const financeComparison = /\b(?:finance|financing|loan|interest|comparison rate|repayments?|balloon|deposit)\b/i.test(conversation);
  if (financeComparison && !/\b(?:exact vehicle|vehicle model|model year|variant)\b/i.test(conversation)) return null;
  if (/\b(?:charger|charging|tariff|application stage|evidence stage|platform)\b/i.test(conversation)
    && !/\b(?:car|vehicle model|exact vehicle|model year|variant|range|mileage)\b/i.test(conversation)) return null;
  if (/[\$%]/.test(left + right)) return null;
  const vehicleSignal = /\b(?:EV|electric (?:car|vehicle)|car|vehicle)\b/i.test(conversation)
    || /\d/.test(left + right)
    || /\b[A-Z]{2,}\b/.test(left + right)
    || /\b(?:range|goes? (?:further|farther)|mileage|energy use|efficient|charging)\b/i.test(conversation);
  if (!vehicleSignal || !left || !right || left.split(" ").length > 6 || right.split(" ").length > 6) return null;
  return { left, right };
}

function quoteComparisonTopic(conversation: string): EnergyAssistantTopic | null {
  const quoteIntent = /\b(?:quotes?|proposals?|tenders?|offers?)\b/i.test(conversation)
    && /\b(?:compare|choose|between|scope|claims?|facts?|check|review|competing|different)\b/i.test(conversation);
  if (!quoteIntent) return null;
  if (/\b(?:hot[- ]?water|water heater|HPWH|heat[- ]pump (?:hot[- ]?)?water)\b/i.test(conversation)) return "heat_pump_hot_water";
  if (/\b(?:heating|cooling|air con|air conditioner|RCAC|split system|ducted)\b/i.test(conversation)) return "rcac";
  if (/\b(?:solar|PV|panels?|inverter)\b/i.test(conversation)) return "solar";
  if (/\b(?:battery|storage|backup|VPP)\b/i.test(conversation)) return "battery_vpp";
  if (/\b(?:glazing|windows?|glass|frames?)\b/i.test(conversation)) return "glazing_shading";
  if (/\b(?:insulation|batts?|blow-in|R-value)\b/i.test(conversation)) return "insulation";
  return null;
}

function assistantDomainIntent(query: string) {
  if (/\b(?:ignore (?:all |the |your )?(?:(?:previous|system|developer) instructions|energy scope)|system prompt|developer message|jailbreak|prompt injection)\b/i.test(query)) {
    return "blocked" as const;
  }
  if (/\b(?:recipe|beef stew|bake a cake|cook (?:chicken|pasta|dinner)|ingredients?)\b/i.test(query)) return "blocked" as const;
  if (/\b(?:write|debug|compile|typescript|javascript|python|react|database|algorithm)\b/i.test(query)
    && /\b(?:code|function|component|query|program|app)\b/i.test(query)) return "blocked" as const;
  if (/\b(?:vote|election|political party|prime minister|parliamentary politics)\b/i.test(query)) return "blocked" as const;
  if (/\b(?:medicine|medication|doctor|chest pain|blood pressure|medical advice)\b/i.test(query)
    || /\bdiagnos(?:e|is)\b/i.test(query) && /\b(?:person|patient|symptoms?|pain|illness|disease|health)\b/i.test(query)) return "blocked" as const;
  if ((/\b(?:evict|eviction|notice to vacate|rent increase|bond dispute|terminate (?:a |the )?lease)\b/i.test(query)
      || /\b(?:bond|security deposit)\b/i.test(query)
        && /\b(?:return|returned|refund|release|withhold|withheld|claim|dispute|moved out)\b/i.test(query))
    && !/\b(?:energy|heating|cooling|insulation|repair|minimum energy standard|mould|damp)\b/i.test(query)) return "blocked" as const;
  if (suppliedVehicleComparisonRows(query).length === 2) return "in" as const;
  if (exactVehiclePair(query)) return "in" as const;
  if (/\bPDF\b/i.test(query)
    && /\b(?:checker|quote|scanned|scan|image[ -]only|OCR|local)\b/i.test(query)) return "in" as const;
  if (/\b(?:raw (?:file )?bytes?|extracted (?:text|lines?)|bounded (?:derived )?summary)\b/i.test(query)
    && /\b(?:local|device|browser|chat|lead|privacy|stays?|leaves?|difference|plain English)\b/i.test(query)) return "in" as const;
  const specific = /\b(?:NatHERS|NCC|STCs?|VEU|VEECs?|ESS|ESCs?|PDRS|PRCs?|Creditex|TLink|SEC|State Electricity Commission|electricity|electrical safety|tariff|bill|meter|NEM12|NMI|solar|PV|inverter|battery|storage|blackout|V2H|V2G|EV|electric vehicle|charger|charging|charging cable|power ?board|WLTP|certified range|range|mileage|petrol|diesel|fuel|heater|heating|cooling|cold|freezing|icy|warm|roasting|baking|boiling|heatwave|overheat(?:ing|s)?|air con|RCAC|COP|coefficient of performance|hot[- ]?water|HWS|HPWH|HPHW|heat[- ]?pump|induction|cooktop|cooking|laundry|washing|dryer|fridge|freezer|refrigerator|usage|habits?|baseload|insulation|uninsulated|downlights?|roof space|roof foil|foil|sarking|cool roof|ceiling fan|portable fan|fibre[ -]?cement|fiber[ -]?cement|slab|glazing|secondary glazing|window|bubble wrap|shading|draught|draft|weatherstripp?ing|weatherseal(?:ed|ing)?|airtight|airtightness|tighter|fresh air|stuffy|stale air|CO2|carbon dioxide|ppm|fumes?|humidity|ventilation|vents?|flues?|HRV|MVHR|heat recovery ventilation|mechanical heat recovery|condensation|mould|mold|moisture|damp|thermal|radiant|surface|comfort|comfortable|healthier|cheaper|Passive House|Passivhaus|passive design|appliance|electrification|electrify|electrifying|whole[- ]home|payback|annual saving|upfront cost|how many years|gas|carbon|emissions?|rebates?|grants?|funding|loans?|mortgage|finance|assistance|incentives?|discounts?|programmes?|programs?|schemes?|certificates?|energy rating|home energy|building fabric|rent|rental|renter|tenant|bond|portable|temporary|no drilling|strata|body corporate|owners corporation|installer|quotes?|proposals?|PDF|photo|image|installation date|signed installation|customer signature|lead|referral|Word|Excel|DOCX|XLSX|asbestos|bushfire smoke|air purifier|registry|submission)\b/i.test(query);
  if (/\b(?:bedroom|room|upstairs|upper floor|top floor|home|house|unit|apartment)\b/i.test(query)
    && /\b(?:hot|warm)\b/i.test(query)
    && /\b(?:outdoor|outside|night|evening|sunset)\b/i.test(query)) return "in" as const;
  if (specific) return "in" as const;
  if (/\benergy\b/i.test(query) && /\b(?:suppliers?|vendors?|compan(?:y|ies)|exhibitors?|trade shows?|events?)\b/i.test(query)) return "in" as const;
  if (/\benergy\b/i.test(query)) return "ambiguous" as const;
  return "out" as const;
}

const PROGRAM_JURISDICTION_SIGNALS: ReadonlyArray<readonly [
  GovernmentProgramTemplate["jurisdiction"],
  string,
  RegExp,
]> = [
  ["ACT", "Australian Capital Territory", /\b(?:Australian Capital Territory|ACT)\b/],
  ["NSW", "New South Wales", /\b(?:New South Wales|NSW)\b/],
  ["NT", "Northern Territory", /\b(?:Northern Territory|NT)\b/],
  ["QLD", "Queensland", /\b(?:Queensland|Queenslander|QLD)\b/],
  ["SA", "South Australia", /\b(?:South Australia|South Australian|SA)\b/],
  ["TAS", "Tasmania", /\b(?:Tasmania|Tasmanian|TAS)\b/],
  ["VIC", "Victoria", /\b(?:Victoria|Victorian|VIC)\b/],
  ["WA", "Western Australia", /\b(?:Western Australia|Western Australian|WA)\b/],
  ["AU", "Australia", /\b(?:Australia|Australian|national|federal)\b/i],
];

const PROGRAM_CITY_JURISDICTION_SIGNALS: ReadonlyArray<readonly [
  GovernmentProgramTemplate["jurisdiction"],
  string,
  RegExp,
]> = [
  ["ACT", "Australian Capital Territory", /\b(?:Canberra|Queanbeyan)\b/i],
  ["NSW", "New South Wales", /\b(?:Sydney|Newcastle|Wollongong|Dubbo|Wagga Wagga|Albury)\b/i],
  ["NT", "Northern Territory", /\b(?:Darwin|Palmerston|Alice Springs)\b/i],
  ["QLD", "Queensland", /\b(?:Brisbane|Gold Coast|Sunshine Coast|Cairns|Townsville|Toowoomba|Rockhampton)\b/i],
  ["SA", "South Australia", /\b(?:Adelaide|Mount Gambier|Whyalla)\b/i],
  ["TAS", "Tasmania", /\b(?:Hobart|Launceston|Devonport|Burnie)\b/i],
  ["VIC", "Victoria", /\b(?:Melbourne|Geelong|Ballarat|Bendigo|Shepparton)\b/i],
  ["WA", "Western Australia", /\b(?:Perth|Fremantle|Bunbury|Geraldton|Albany|Broome)\b/i],
];

function queryAustralianPostcode(query: string) {
  const explicitMatch = query.match(/\b(?:postcode|post code)\s*(?:is|:|=)?\s*(\d{4})\b/i);
  const bareMatch = query.match(/(?<![$\d])\b(?!20\d{2}\b)(\d{4})\b(?!\d)/);
  return explicitMatch?.[1] || bareMatch?.[1] || null;
}

function postcodeProgramJurisdiction(query: string): readonly [
  GovernmentProgramTemplate["jurisdiction"],
  string,
] | null {
  const postcodeText = queryAustralianPostcode(query);
  if (!postcodeText) return null;
  const postcode = Number(postcodeText);
  if (!Number.isInteger(postcode)) return null;
  if ((postcode >= 200 && postcode <= 299) || (postcode >= 2600 && postcode <= 2618) || (postcode >= 2900 && postcode <= 2920)) {
    return ["ACT", "Australian Capital Territory"];
  }
  if (postcode >= 800 && postcode <= 999) return ["NT", "Northern Territory"];
  if (postcode >= 2000 && postcode <= 2899) return ["NSW", "New South Wales"];
  if (postcode >= 3000 && postcode <= 3999) return ["VIC", "Victoria"];
  if (postcode >= 4000 && postcode <= 4999) return ["QLD", "Queensland"];
  if (postcode >= 5000 && postcode <= 5999) return ["SA", "South Australia"];
  if (postcode >= 6000 && postcode <= 6999) return ["WA", "Western Australia"];
  if (postcode >= 7000 && postcode <= 7999) return ["TAS", "Tasmania"];
  return null;
}

function explicitProgramJurisdiction(query: string) {
  const postcode = postcodeProgramJurisdiction(query);
  if (postcode) return [postcode[0], postcode[1], /(?:)/] as const;
  const city = PROGRAM_CITY_JURISDICTION_SIGNALS.find(([, , signal]) => signal.test(query));
  if (city) return city;
  const residencePattern = /\b(?:I|we|my|our|the|this)?\s*(?:live|located|based|property|home|house|unit|site|premises|installation|project)\s*(?:is|are|am|sits?|located)?\s*(?:in|at)?\s*(?:the\s+)?(Australian Capital Territory|ACT|New South Wales|NSW|Northern Territory|NT|Queensland|QLD|South Australia|SA|Tasmania|TAS|Victoria|VIC|Western Australia|WA)\b/i;
  const residence = query.match(residencePattern)?.[1];
  if (residence) {
    const explicitResidence = PROGRAM_JURISDICTION_SIGNALS.find(([, , signal]) => signal.test(residence));
    if (explicitResidence) return explicitResidence;
  }
  const explicit = PROGRAM_JURISDICTION_SIGNALS.find(([, , signal]) => signal.test(query));
  return explicit || null;
}

function programMatchesApplicant(program: GovernmentProgramTemplate, query: string) {
  const text = searchable(`${program.name} ${program.programCode} ${program.operatingNote}`);
  const genericScheme = /^(?:SRES|VEU|NSW-ESS|NSW-PDRS|ACT-EEIS|SA-REPS)$/.test(program.programCode);
  if (/\b(?:small business|business|commercial)\b/i.test(query)) {
    return genericScheme || /\b(?:business|commercial)\b/.test(text);
  }
  if (/\b(?:community housing|housing provider|social housing)\b/i.test(query)) {
    return /\b(?:community housing|housing provider|social housing)\b/.test(text);
  }
  if (/\b(?:strata|owners corporation|body corporate|apartment building|multi[ -]?dwelling)\b/i.test(query)) {
    return genericScheme || /\b(?:apartment|multi dwelling|strata|owners corporation|shared)\b/.test(text);
  }
  if (/\b(?:rent|renter|tenant|rental)\b/i.test(query)) {
    return genericScheme || /\b(?:renters?|rental|apartment residents?|multi dwelling)\b/.test(text);
  }
  if (/\b(?:landlord|rental owner)\b/i.test(query)) {
    return genericScheme || /\b(?:renter|rental|landlord|household energy upgrades fund)\b/.test(text);
  }
  if (/\b(?:owner[ -]?occupier|homeowner|household)\b/i.test(query)) {
    return !/\b(?:business|community housing|social housing|housing provider|procurement)\b/.test(text);
  }
  return true;
}

function programMatchesUpgrade(program: GovernmentProgramTemplate, query: string) {
  const text = searchable(`${program.name} ${program.programCode} ${program.officialSourceTitle} ${program.operatingNote}`);
  const excludesSolar = /\b(?:do not show|don't show|exclude|excluding|irrelevant|not interested in|without)\b[^\n]{0,50}\b(?:solar|PV)\b/i.test(query);
  const excludesEv = /\b(?:do not show|don't show|exclude|excluding|irrelevant|not interested in|without)\b[^\n]{0,50}\b(?:EV|electric vehicle|charger)\b/i.test(query);
  const technology = /\binsulation\b/i.test(query) ? "insulation"
    : /\b(?:glazing|windows?|secondary glazing|double glazing)\b/i.test(query) ? "glazing"
      : /\b(?:solar|PV)\b/i.test(query) && !excludesSolar ? "solar"
        : /\b(?:battery|storage|VPP)\b/i.test(query) ? "battery"
          : /\b(?:hot[- ]?water|water heater|HPWH)\b/i.test(query) ? "hot-water"
            : /\b(?:air conditioner|aircon|reverse[ -]cycle|heating|cooling|RCAC)\b/i.test(query) ? "heating-cooling"
              : /\b(?:EV charger|EVSE|vehicle charging)\b/i.test(query) && !excludesEv ? "ev-charging"
                : /\b(?:induction|cooktop)\b/i.test(query) ? "electrical"
                  : null;
  if (!technology) return true;
  const genericByTechnology: Readonly<Record<string, readonly string[]>> = {
    solar: ["SRES"],
    battery: ["SRES", "NSW-PDRS"],
    "hot-water": ["SRES", "VEU", "NSW-ESS", "ACT-EEIS", "SA-REPS"],
    "heating-cooling": ["VEU", "NSW-ESS", "NSW-PDRS", "ACT-EEIS", "SA-REPS"],
    insulation: ["VEU", "NSW-ESS", "ACT-EEIS"],
    glazing: ["NSW-ESS", "ACT-EEIS"],
    "ev-charging": ["NSW-PDRS"],
    electrical: ["NSW-ESS", "ACT-EEIS"],
  };
  if ((genericByTechnology[technology] || []).includes(program.programCode)) return true;
  const words = technology === "hot-water" ? /\b(?:hot water|water heater)\b/
    : technology === "heating-cooling" ? /\b(?:heating|cooling|air conditioner|energy upgrade)\b/
      : technology === "ev-charging" ? /\b(?:ev|vehicle charging|charger)\b/
        : technology === "electrical" ? /\b(?:induction|cooking|electrical|energy upgrade)\b/
          : new RegExp(`\\b${technology}\\b`);
  return words.test(text);
}

function catalogueProgramAnswer(query: string): {
  programs: GovernmentProgramTemplate[];
  jurisdictionCode: GovernmentProgramTemplate["jurisdiction"];
  jurisdictionLabel: string;
  certificateIntent: boolean;
} | null {
  const scopedRenterHelp = /\b(?:rent|renter|tenant|rental)\b/i.test(query)
    && /\bhelp\b/i.test(query)
    && /\b(?:insulation|glazing|windows?|heating|cooling|hot[- ]?water|draught|draft|energy bills?)\b/i.test(query)
    && /\b(?:only|relevant|available|current|do not show|don't show|exclude|without)\b/i.test(query);
  if (!scopedRenterHelp
    && !/\b(?:rebates?|grants?|loans?|finance|assistance|incentives?|discounts?|programs?|programmes?|schemes?|certificates?|STCs?|VEECs?|ESCs?|PRCs?|Home Energy Saver|Household Energy Upgrades Fund|HEUF|Solar Sharer Offer)\b/i.test(query)) {
    return null;
  }
  const jurisdiction = explicitProgramJurisdiction(query);
  if (!jurisdiction) return null;
  const [jurisdictionCode, jurisdictionLabel] = jurisdiction;
  const certificateIntent = /\b(?:certificates?|STCs?|VEECs?|ESCs?|PRCs?|credit schemes?)\b/i.test(query);
  const financialIntent = /\b(?:rebates?|grants?|loans?|finance|assistance|incentives?|discounts?)\b/i.test(query);
  const financialOutcomes = new Set(["rebate", "grant", "loan"]);
  const certificateOutcomes = new Set(["tradable_certificate", "retailer_obligation_credit"]);
  const queryTokens = queryTerms(query).terms;
  const programs = GOVERNMENT_PROGRAM_TEMPLATES
    .filter((program) => program.catalogueState === "current" || program.catalogueState === "limited")
    .filter((program) => program.jurisdiction === jurisdictionCode
      || (jurisdictionCode !== "AU" && program.jurisdiction === "AU"))
    .filter((program) => !certificateIntent || certificateOutcomes.has(program.outcomeClass))
    .filter((program) => !financialIntent || financialOutcomes.has(program.outcomeClass))
    .filter((program) => programMatchesApplicant(program, query))
    .filter((program) => programMatchesUpgrade(program, query))
    .map((program) => ({
      program,
      relevance: (program.jurisdiction === jurisdictionCode ? 4 : 1) + tokenScore(
        queryTokens,
        `${program.name} ${program.officialSourceTitle} ${program.operatingNote}`,
        1,
      ),
    }))
    .filter(({ relevance }) => relevance > 0)
    .sort((left, right) =>
      right.relevance - left.relevance
      || Number(right.program.jurisdiction === jurisdictionCode)
        - Number(left.program.jurisdiction === jurisdictionCode)
      || left.program.name.localeCompare(right.program.name))
    .slice(0, 3)
    .map(({ program }) => program);
  return { programs, jurisdictionCode, jurisdictionLabel, certificateIntent };
}

function catalogueProgramCitations(
  programs: readonly GovernmentProgramTemplate[],
): EnergyAssistantCitation[] {
  return programs.map((program) => ({
    id: `government-program:${program.templateId}`,
    title: program.officialSourceTitle,
    publisher: program.administeringBody,
    url: program.officialSourceUrl,
    sourceTier: "primary_official",
    jurisdiction: program.jurisdiction,
    effectiveFrom: null,
    effectiveTo: null,
    lastChecked: GOVERNMENT_CATALOGUE_REVIEWED_ON,
    reviewDue: "",
    storagePolicy: "local_factual_summary",
    stale: false,
  }));
}

function rentalSafetySourceId(query: string) {
  const jurisdiction = explicitProgramJurisdiction(query)?.[0];
  const sources: Partial<Record<GovernmentProgramTemplate["jurisdiction"], string>> = {
    ACT: "act-rental-ceiling-insulation-standard",
    NSW: "nsw-rental-minimum-standards",
    NT: "nt-rental-repairs-maintenance",
    QLD: "qld-rental-minimum-housing-standards",
    SA: "sa-rental-minimum-standards",
    TAS: "tas-rental-minimum-standards",
    VIC: "vic-rental-minimum-energy-standards",
    WA: "wa-rental-maintenance-modifications",
  };
  return jurisdiction ? sources[jurisdiction] || null : null;
}

export function composeEnergyAssistantAnswer(
  query: string,
  options: {
    audience?: EnergyAssistantAudience;
    pageContext?: string;
    asOf?: Date | string;
    sources?: readonly EnergyAssistantKnowledgeSource[];
    priorUserMessages?: readonly string[];
  } = {},
): EnergyAssistantAnswer {
  const searchOptions = {
    audience: options.audience,
    asOf: options.asOf,
    sources: options.sources,
    limit: 8,
  };
  const currentResults = searchEnergyAssistantKnowledge(query, searchOptions);
  const queryWordCount = searchable(query).split(/\s+/).filter(Boolean).length;
  const looksLikeTerseFollowUp = queryWordCount <= 12 && (
    /^(?:yes|no|maybe|unsure|not sure)\b/i.test(query.trim())
    || /\b(?:it|that|those|them|same|also|more)\b/i.test(query)
    || /\d/.test(query)
    || queryWordCount <= 4
  );
  let retrievalQuery = query;
  if (
    (!currentResults.length || currentResults[0].relevanceScore < 9)
    && looksLikeTerseFollowUp
  ) {
    const prior = [...(options.priorUserMessages || [])]
      .slice(-8)
      .reverse()
      .find((message) => searchEnergyAssistantKnowledge(message, searchOptions).length > 0);
    if (prior) retrievalQuery = `${prior}\n${query}`;
  }
  const results = retrievalQuery === query
    ? currentResults
    : searchEnergyAssistantKnowledge(retrievalQuery, searchOptions);
  const priorUserMessages = [...(options.priorUserMessages || [])].slice(-8);
  const userConversation = [...priorUserMessages, query].join("\n");
  const playbookId = decisionPlaybookId(
    query,
    priorUserMessages,
    options.audience,
    looksLikeTerseFollowUp || !currentResults.length || currentResults[0].relevanceScore < 9,
  );
  const playbookConversation = playbookConversationFrame(playbookId, query, priorUserMessages);
  const evSavingsConversation = evSavingsConversationFrame(query, priorUserMessages);
  const wholeHomeConversation = wholeHomeConversationFrame(query, priorUserMessages);
  const playbookResults = searchEnergyAssistantKnowledge(playbookConversation, searchOptions);
  const activeOfficial = results.filter(
    (result) => result.active && !result.stale && result.source.official
      && result.source.storagePolicy === "local_factual_summary",
  );
  const staleMatches = results.filter((result) => result.stale);
  const topics = uniqueById(
    results.map((result) => ({ id: result.source.topic, topic: result.source.topic })),
    4,
  ).map((item) => item.topic);
  const fallbackTopic: EnergyAssistantTopic = options.audience === "trade" ? "trades" : "comfort_fabric";
  const selectedTopics = topics.length ? topics : [fallbackTopic];
  const sourceBoundary =
    "Answers use locally maintained factual summaries and source links. Exact prices, savings, eligibility, product approval and regulatory outcomes must be confirmed from the cited current official source.";

  function structured(
    topic: EnergyAssistantTopic,
    values: {
      directAnswer?: string;
      status: EnergyAssistantAnswer["status"];
      citations: EnergyAssistantCitation[];
      confidence: EnergyAssistantAnswer["confidence"];
      assumptions?: string[];
      practicalSteps?: string[];
      toolActions?: EnergyAssistantAction[];
      suggestedQuestions?: string[];
    },
  ): EnergyAssistantAnswer {
    const toolActions = values.toolActions
      || actionsFor(selectedTopics.length ? selectedTopics : [topic], options.pageContext);
    return {
      directAnswer: values.directAnswer || TOPIC_DIRECT_ANSWERS[topic],
      practicalSteps: (values.practicalSteps || [...TOPIC_STEPS[topic]]).slice(0, 3),
      nextAction: toolActions[0]?.label || "Add the property and equipment details needed to narrow the answer.",
      status: values.status,
      citations: values.citations,
      assumptions: values.assumptions || [
        "No site inspection, interval data, complete quote or exact product evidence was assessed.",
        "The question is being treated as general guidance for the selected audience.",
      ],
      confidence: values.confidence,
      suggestedQuestions: (values.suggestedQuestions
        || suggestionsFor(selectedTopics.length ? selectedTopics : [topic])).slice(0, 1),
      toolActions,
      sourceBoundary,
    };
  }

  const playbookOfficial = playbookResults.filter(
    (result) => result.active && !result.stale && result.source.official
      && result.source.storagePolicy === "local_factual_summary",
  );
  const officialPlaybookCitations = (
    topicsToCite: readonly EnergyAssistantTopic[],
    limit = 3,
  ) => citationsFor(playbookOfficial.filter((result) => topicsToCite.includes(result.source.topic)).slice(0, limit));
  const officialCitationsById = (ids: readonly string[]) => {
    const day = isoDay(options.asOf || new Date());
    const byId = new Map((options.sources || ENERGY_ASSISTANT_KNOWLEDGE).map((source) => [source.id, source]));
    const resultsToCite = ids.flatMap((id) => {
      const source = byId.get(id);
      if (!source || !source.official || source.storagePolicy !== "local_factual_summary") return [];
      const state = sourceState(source, day);
      return state.active && !state.stale ? [{ source, score: 0, relevanceScore: 0, ...state }] : [];
    });
    return citationsFor(resultsToCite);
  };
  const governedSummaryById = (id: string) => {
    const day = isoDay(options.asOf || new Date());
    const source = (options.sources || ENERGY_ASSISTANT_KNOWLEDGE).find((candidate) => candidate.id === id);
    if (!source || !source.official || source.storagePolicy !== "local_factual_summary") return null;
    const state = sourceState(source, day);
    return state.active && !state.stale ? source.summary : null;
  };

  const asksToSilentlyPopulateTradeLead = /\b(?:trade|customer|quote|service|sales)\s+lead\b|\blead\s+(?:summary|record|request|form)\b/i.test(query)
    && /\b(?:silently|automatically|without (?:the )?(?:customer(?:'s)? )?(?:knowledge|consent|review)|add|include|copy|attach|send|share)\b/i.test(query)
    && /\b(?:full quote|raw (?:file|document|text|extracted (?:text|lines?))|customer address|street address|personal (?:details|information)|extracted lines?)\b/i.test(query);
  if (asksToSilentlyPopulateTradeLead) {
    return structured("trades", {
      directAnswer:
        "No. The assistant must never silently add a full quote, customer address, raw file or raw extracted lines to a trade lead. A lead can be submitted only after the customer explicitly consents and reviews the displayed fields. The assistant may include only a bounded structured technical summary the customer has chosen to share; raw file bytes and extracted lines stay local, and an address is shared only through a separately displayed site-address field the customer deliberately selects, never copied silently from the quote or summary.",
      status: "answered",
      citations: [],
      confidence: "high",
      assumptions: ["No lead has been submitted and no private quote or customer record was inspected."],
      practicalSteps: [
        "Show the customer every contact, site and structured project field before consent.",
        "Keep the full quote, raw file bytes and raw extracted lines out of the lead.",
        "Submit only the minimum reviewed fields the customer explicitly chooses to share.",
      ],
      toolActions: [],
      suggestedQuestions: [],
    });
  }

  const composeWholeHomeTriage = (): EnergyAssistantAnswer | null => {
    if (/\b(?:NatHERS|whole[- ]of[- ]home|whole[- ]home|home energy)\s+(?:rating|score|assessment)|\bofficial rating\b/i.test(wholeHomeConversation)
      && /\b(?:actual|real|bill|tariff|occupant|plug load|portable|rating|score)\b/i.test(wholeHomeConversation)) {
      return null;
    }
    const outcomeCount = [
      /\b(?:healthier|healthy home)\b/i.test(wholeHomeConversation),
      /\b(?:cheaper|lower bills?|bleeds money|bills? (?:are )?savage|costs? a fortune)\b/i.test(wholeHomeConversation),
      /\b(?:comfortable|comfort|uncomfortable)\b/i.test(wholeHomeConversation),
      /\b(?:efficient|efficiency)\b/i.test(wholeHomeConversation),
      /\b(?:gross in summer|cooks? upstairs)\b/i.test(wholeHomeConversation),
    ].filter(Boolean).length;
    const triageIntent = /\bwhole[- ]home\b/i.test(wholeHomeConversation)
      || /\b(?:where|how|what)\b[^.\n]{0,35}\b(?:start|begin|first check)\b/i.test(wholeHomeConversation)
      || /\b(?:dunno|do not know|don't know)\b[^.\n]{0,35}\b(?:start|begin)\b/i.test(wholeHomeConversation)
      || /\b(?:staged|step[- ]by[- ]step|priority|priorities|first)\s+(?:energy|electrification|upgrade|retrofit|plan)\b/i.test(wholeHomeConversation)
      || /\b(?:house|home)\b/i.test(wholeHomeConversation) && outcomeCount >= 2
      || /\b(?:house|home|place)\b[^.\n]{0,100}\b(?:uncomfortable|gross|hot|cold|cooks?|boiling)\b[^.\n]{0,100}\b(?:bills?|money|costs?|savage|fortune)\b/i.test(wholeHomeConversation);
    if (!triageIntent || !/\b(?:energy|comfort|comfortable|uncomfortable|gross|healthier|cheaper|bill|money|cost|savage|electrif|upgrade|retrofit|solar|battery|insulation|glazing|heating|cooling|hot|cold|summer|winter|hot[- ]?water|gas|house|home|place|owner|renter|tenant|SA|South Australia)\b/i.test(wholeHomeConversation)) {
      return null;
    }
    const jurisdiction = explicitProgramJurisdiction(wholeHomeConversation)?.[1];
    const tenure = /\b(?:renter|tenant|rental)\b/i.test(wholeHomeConversation)
      ? "renter"
      : /\b(?:owner|homeowner|owner[- ]occupier|I own|we own)\b/i.test(wholeHomeConversation)
        ? "owner"
        : null;
    const knownContext = [jurisdiction, tenure].filter(Boolean).join(" ");
    const focus = [
      /\b(?:roasting|overheat|too hot|hot upstairs|cooks? upstairs|gross in summer|summer heat)\b/i.test(wholeHomeConversation) ? "overheating" : null,
      /\b(?:condensation|windows? drip|mould|mold|damp|moisture)\b/i.test(wholeHomeConversation) ? "moisture or condensation" : null,
      /\b(?:high|large|expensive|rising)?\s*(?:power|electricity|energy)?\s*bills?\b/i.test(wholeHomeConversation) ? "energy bills" : null,
      /\b(?:cold|freezing|hard to heat|winter comfort|cold living room)\b/i.test(wholeHomeConversation) ? "winter comfort" : null,
    ].filter(Boolean);
    const hasPostcode = /\b(?:postcode\s*)?\d{4}\b/i.test(wholeHomeConversation);
    const hasPropertyType = /\b(?:detached(?:\s+house)?|house|townhouse|terrace|apartment|unit|duplex)\b/i.test(wholeHomeConversation);
    const nextQuestion = !hasPostcode
      ? "What is the property postcode?"
      : !hasPropertyType
        ? "Is the property a detached house, townhouse, apartment or unit?"
        : focus.length === 0
          ? "What is the single biggest problem: safety, moisture, discomfort, high bills or ageing gas equipment?"
          : "Which affected room or major end use should be measured first?";
    return structured("comfort_fabric", {
      directAnswer:
        `${knownContext ? `For the supplied ${knownContext} context, start` : "Start"} with a staged whole-home diagnosis, not a shopping list.${focus.length ? ` The supplied symptoms keep ${focus.join(" and ")} in the first diagnostic stage.` : ""} First address immediate safety, moisture and the rooms that fail comfort. Second use bills or interval data plus a fabric check to find the largest loads, solar gains, air leaks, insulation gaps and glazing problems. Third reduce demand and electrify end-of-life heating, hot water and cooking with site-sized equipment; then size solar to the resulting load and consider a battery only for measured surplus, tariff shifting or defined backup.`,
      status: "needs_context",
      citations: officialCitationsById(["energy-gov-electrification-sequence", "yourhome-passive-design-system", "energy-gov-reduce-energy-bills"]),
      confidence: "medium",
      assumptions: [`${knownContext ? `The supplied ${knownContext} context is retained, but no` : "No"} property safety, comfort, bill, equipment-age, fabric or budget evidence has been reviewed.`],
      practicalSteps: [
        "Record safety or moisture faults, the worst rooms and when discomfort occurs.",
        "Collect a bill or local interval summary and inspect accessible fabric, shade, seals and major equipment schedules.",
        "Sequence fabric and appliance work before final solar, battery, finance and programme decisions.",
      ],
      toolActions: [{ id: "open-home-plan", label: "Build a staged whole-home plan", href: "/plan" }],
      suggestedQuestions: [nextQuestion],
    });
  };

  if (benignBatteryDiagnosticQuery(query)) {
    return structured("battery_vpp", {
      directAnswer:
        "No. The supplied description does not report an affirmed fire or battery-failure warning sign, so it does not by itself justify an emergency claim. Mild warmth and fan operation can only be treated as normal if they match the exact system manual, status lights and operating range. Keep the unit unobstructed, do not open it, and check its display or app for a fault. If swelling, leakage, hissing, crackling, chemical odour, unusual heat, smoke or venting appears, move away and call 000.",
      status: "needs_context",
      citations: officialCitationsById(["frnsw-lithium-battery-fire-response", "energy-gov-batteries"]),
      confidence: "medium",
      assumptions: ["The stated warning signs are explicitly absent; the exact battery model, temperature range and diagnostic status have not been verified."],
      practicalSteps: ["Check the exact model manual, normal temperature range and status or fault log without opening the equipment.", "Keep access and ventilation clear and monitor for any actual warning sign."],
      toolActions: [],
      suggestedQuestions: ["What exact model and status or fault code does its display or app show?"],
    });
  }

  if (safetyQuery(query)) {
    if (batteryFailureEmergencyQuery(query)) {
      return structured("safety_consumer_rights", {
        directAnswer:
          "Treat a swollen, leaking, fizzing, hissing, venting, smoking, unusually hot or strong chemical-smelling battery as a possible lithium-ion failure. Move everyone away, avoid the fumes and call 000. Do not approach the system to operate switches, touch it, move it, charge it or spray water. Close doors only if that is safe while leaving, then wait outside for firefighters and tell them a battery energy-storage system is involved.",
        status: "answered",
        citations: officialCitationsById(["frnsw-lithium-battery-fire-response"]),
        confidence: "high",
        assumptions: ["The battery type, fault and fire state have not been inspected; emergency responders must assess the site."],
        practicalSteps: [
          "Evacuate people away from the battery and its fumes without approaching it.",
          "Call 000, identify the battery system and follow the fire service's directions.",
          "Do not return, operate switches or apply water until firefighters declare the area safe.",
        ],
        toolActions: [],
        suggestedQuestions: [],
      });
    }
    if (coAlarmMaintenanceQuery(query)) {
      return structured("safety_consumer_rights", {
        directAnswer:
        "A single periodic chirp is not automatically the same as a full or continuous carbon-monoxide alarm. It may indicate a battery, detector fault or sensor end-of-life, and the exact pattern must be matched promptly to the exact detector's label and manual. With no symptoms and no full or continuous alarm, follow the documented battery, replacement or service action and do not use an open flame to test it. If a full or continuous alarm starts, or anyone develops headache, dizziness, nausea, drowsiness or confusion, move everyone to fresh outdoor air and call 000.",
        status: "answered",
        citations: officialCitationsById(["esv-carbon-monoxide-alarm-signals", "healthdirect-toxic-fume-first-aid"]),
        confidence: "medium",
        assumptions: ["The exact detector model, documented signal pattern, age, battery state and any combustion appliance condition have not been checked."],
        practicalSteps: [
          "Check for symptoms first and leave immediately if anyone feels unwell.",
          "Match the exact chirp pattern to the detector label and current manual from fresh air.",
          "Replace the battery or detector as directed; treat a full or continuing alarm or any symptoms as an emergency and call 000.",
        ],
        toolActions: [],
        suggestedQuestions: [],
      });
    }
    if (coAlarmEmergencyQuery(query)) {
      return structured("safety_consumer_rights", {
        directAnswer:
          "Treat a full, continuous or repeating carbon-monoxide alarm as a possible exposure emergency. Move everyone to fresh outdoor air now and call 000 from outside. Do not silence the alarm and remain inside, re-enter to investigate, or restart a fuel-burning appliance. Seek medical advice for symptoms even if they ease, and keep every combustion appliance off until the emergency service and a licensed gasfitter say the property is safe.",
        status: "answered",
        citations: officialCitationsById(["esv-carbon-monoxide-alarm-signals", "healthdirect-toxic-fume-first-aid"]),
        confidence: "high",
        assumptions: ["The alarm, source and occupants have not been inspected or medically assessed."],
        practicalSteps: [
          "Move everyone to fresh outdoor air without delaying to find the source.",
          "Call 000 from outside and report the carbon-monoxide alarm and any symptoms.",
          "Do not re-enter or use combustion equipment until emergency and licensed checks are complete.",
        ],
        toolActions: [],
        suggestedQuestions: [],
      });
    }
    if (possibleGasExposureQuery(query)) {
      return structured("safety_consumer_rights", {
        directAnswer:
          "Treat this as possible exposure to combustion products or leaking gas. Move everyone to fresh outdoor air now. Stop the appliance only if that can be done without re-entering danger, and do not troubleshoot it, relight it or seal any permanent vent or flue. Call 000 for severe or persistent symptoms or immediate danger, seek medical advice about symptoms even if they ease, and contact the gas emergency service and a licensed gasfitter before the appliance is used again.",
        status: "answered",
        citations: officialCitationsById([
          ...(/\bheater\b/i.test(query) ? ["energy-gov-carbon-monoxide-heater-safety"] : []),
          "healthdirect-toxic-fume-first-aid",
        ]),
        confidence: "high",
        assumptions: [
          "The pollutant, appliance condition and exposure have not been inspected or medically assessed.",
          "The applicable jurisdiction-specific gas emergency contact must still be checked.",
        ],
        practicalSteps: [
          "Move people to fresh outdoor air and keep them away from the appliance.",
          "Call 000 for severe or persistent symptoms or immediate danger; otherwise contact the gas emergency service and seek medical advice about symptoms.",
          "Keep the appliance off until a licensed gasfitter has checked it, its flue, combustion air and permanent ventilation.",
        ],
        toolActions: [],
        suggestedQuestions: [],
      });
    }
    if (unsafeElectricalEquipmentIncidentQuery(query)) {
      const evChargingIncident = /\b(?:EVSE|EV charger|electric[- ]?vehicle charger|wall charger|wallbox|charge point|charging unit|charging lead|charging cable|EV (?:charging )?(?:power point|socket|outlet))\b/i.test(query);
      return structured("safety_consumer_rights", {
        directAnswer: evChargingIncident
          ? "Treat smoke, burning, arcing, melting or unusual heat at EV charging equipment as an electrical fire risk. Move people away and call 000 if there is smoke, flame or immediate danger. Do not touch, unplug, reset, move or spray the charger, cable or vehicle while approaching it could expose you to electricity or fumes. Keep it unused after the emergency is controlled and have the manufacturer and a licensed electrician inspect the complete charger, supply circuit and vehicle connection before reuse."
          : "Treat smoke, burning, arcing, melting or unusual heat at a switchboard, meter box, inverter, isolator, socket or outlet as an electrical fire risk. Move people away and call 000 if there is smoke, flame or immediate danger. Do not approach it to open a cover, reset a breaker, operate a switch or apply water. Contact the electricity network or an emergency licensed electrician from a safe location, and keep the installation off until the authorised responder says it is safe.",
        status: "answered",
        citations: officialCitationsById(evChargingIncident
          ? ["esv-home-electrical-fault-signs", "vic-extension-lead-overheating"]
          : ["esv-home-electrical-fault-signs"]),
        confidence: "high",
        assumptions: ["The equipment, fire state, supply and safe isolation point have not been inspected."],
        practicalSteps: [
          "Move people away and call 000 for smoke, flame or immediate danger.",
          "Do not touch, reset, unplug, open, move or spray the affected equipment.",
          "Use the network, manufacturer and a licensed electrician for controlled inspection before reuse.",
        ],
        toolActions: [],
        suggestedQuestions: [],
      });
    }
    if (unsafeWetRoofSolarAccessQuery(query)) {
      return structured("safety_consumer_rights", {
        directAnswer:
          "Do not climb onto, walk on, wash or inspect a wet, dewy, icy or rain-affected roof or rooftop solar array. The fall risk is immediate, and wet conditions add electrical uncertainty around damaged modules, wiring and roof equipment. Stay off the roof, do not hose or touch the array from a ladder or with a pole, and arrange inspection or cleaning only under a dry, controlled access plan by a competent provider, with licensed solar and electrical trades for any system work.",
        status: "answered",
        citations: officialCitationsById(["energy-gov-solar-system-maintenance"]),
        confidence: "high",
        assumptions: ["The roof condition, access system and solar equipment have not been inspected."],
        practicalSteps: [
          "Stay off the roof and keep ladders, hoses, poles and people away while it is wet or slippery.",
          "Report any damaged module, cable, isolator, leak, smoke or sparking from a safe location.",
          "Use a dry controlled-access plan and appropriately competent or licensed trades for inspection and electrical work.",
        ],
        toolActions: [],
        suggestedQuestions: [],
      });
    }
    if (unsafeElectricalWorkQuery(query)) {
      return structured("safety_consumer_rights", {
        directAnswer:
          "Do not bypass, bridge or defeat a main switch, isolator, meter, inverter protection or switchboard control. That can expose live parts, defeat required protection and endanger occupants, workers and the network. Current CER solar requirements also require the applicable electrical rules and appropriately accredited and licensed work. Keep clear, use only documented user controls if they are safe to reach, and have a licensed electrician or the responsible installer isolate and test the system under the governing state or territory rules.",
        status: "answered",
        citations: officialCitationsById(["nsw-home-electrical-safety", "esv-home-electrical-fault-signs"]),
        confidence: "high",
        assumptions: [
          "The equipment and fault state have not been inspected.",
          "The property jurisdiction is unknown, so the licensed responder must also apply its current electrical safety and emergency requirements.",
        ],
        practicalSteps: [
          "Do not remove covers, touch conductors or operate a damaged or unsafe control.",
          "Keep others clear and use the network or emergency service if there is sparking, smoke, heat or immediate danger.",
          "Give the fault details and equipment records to a licensed electrician or responsible installer for safe testing.",
        ],
        toolActions: [],
        suggestedQuestions: [],
      });
    }
    if (unsafeUnknownWiringPenetrationQuery(query)) {
      return structured("safety_consumer_rights", {
        directAnswer:
          "Do not drill, cut, screw, nail or otherwise penetrate a wall, ceiling, floor or frame while concealed wiring or other services may be in the path. Switching off one circuit or using a basic detector does not prove the route is clear. Stop the draught-sealing or mounting work, use a non-penetrating alternative only where its product and tenancy instructions allow, and have the service route verified from plans, suitable locating work and a licensed electrician before any penetration.",
        status: "answered",
        citations: officialCitationsById(["nsw-home-electrical-safety"]),
        confidence: "high",
        assumptions: ["The construction, concealed service route, circuit state and proposed fixing depth have not been verified."],
        practicalSteps: [
          "Stop the penetration and keep the area undisturbed.",
          "Check reliable plans and have concealed electrical services located by a licensed electrician.",
          "Use a verified safe fixing location or a suitable non-penetrating product after the service check.",
        ],
        toolActions: [],
        suggestedQuestions: [],
      });
    }
    if (unsafeEvChargingSupplyQuery(query)) {
      return structured("ev_charging", {
        directAnswer:
          "Do not run an EV charging lead through a powerboard, double adaptor or ordinary extension lead. Sustained charging can overheat unsuitable plugs, sockets and connections. Use only the vehicle or charger manufacturer's approved supply arrangement from a compliant outlet or dedicated circuit, and stop using any hot, loose, damaged or discoloured connection. Have a licensed electrician check the outlet, circuit, protection, switchboard capacity and charging location before regular use.",
        status: "answered",
        citations: officialCitationsById(["vic-extension-lead-overheating", "nsw-home-electrical-safety"]),
        confidence: "high",
        assumptions: ["The charging lead, outlet, circuit, switchboard and manufacturer's instructions have not been inspected."],
        practicalSteps: [
          "Stop using the powerboard, adaptor or extension lead for EV charging.",
          "Use only the manufacturer-approved charging lead and supply arrangement without daisy chains or improvised connections.",
          "Have a licensed electrician assess the outlet or dedicated charger circuit before regular charging.",
        ],
        toolActions: [],
        suggestedQuestions: [],
      });
    }
    if (unsafeEvCableRoutingQuery(query)) {
      return structured("ev_charging", {
        directAnswer:
          "Do not run an EV charging lead under a rug or mat, through a door or gate that can pinch it, or anywhere it can be crushed, driven over, tightly covered or abraded. Hidden heat and mechanical damage can create an electrical and fire risk. Stop charging, disconnect only if the plug and lead are cool, dry, undamaged and safe to reach, then use a manufacturer-approved route that protects the cable without an adaptor or improvised cover. Replace any damaged lead and have the outlet or fixed route checked by a licensed electrician.",
        status: "answered",
        citations: officialCitationsById(["vic-extension-lead-overheating", "nsw-home-electrical-safety"]),
        confidence: "high",
        assumptions: ["The lead, plugs, outlet, route and protection have not been inspected."],
        practicalSteps: [
          "Stop charging and keep the lead out of covered, pinched, crushed, vehicle and doorway paths.",
          "Do not handle a hot, wet, burnt, frayed or otherwise damaged lead; keep people clear and use emergency help for smoke or fire.",
          "Use only the manufacturer-approved lead and a protected route or fixed charging design checked by a licensed electrician.",
        ],
        toolActions: [],
        suggestedQuestions: [],
      });
    }
    if (unsafeEnergyInstallationQuery(query)) {
      const refrigerantWork = /\b(?:split system|reverse[ -]cycle|air conditioner|aircon|refrigerant|line set|gas charge)\b/i.test(query);
      const refrigerantRelease = unsafeRefrigerantReleaseQuery(query);
      return structured(refrigerantWork ? "rcac" : /\b(?:hot[- ]?water|HPWH|water heater)\b/i.test(query) ? "heat_pump_hot_water" : "induction", {
        directAnswer: refrigerantWork
          ? refrigerantRelease
            ? "Do not vent, release, bleed, dump or degas split-system refrigerant yourself or open the circuit to air. Refrigerant must be contained and recovered with appropriate equipment by a technician holding the licence required for that work, with any leak, repair, recharge and commissioning recorded. Leave the system off and unopened, keep people away from a suspected leak, and arrange licensed recovery and repair rather than releasing the charge."
            : "Do not install, open, charge, vacuum or connect a split-system refrigerant circuit yourself. The final equipment selection, pipework, electrical supply, condensate, pressure testing, refrigerant handling and commissioning require the appropriately licensed trades for the jurisdiction. Keep the system unopened and obtain a written installed and commissioned scope."
          : "Do not hardwire or connect an induction cooktop or heat-pump water heater yourself. A plug, lead or existing circuit does not prove the circuit, isolation, protection, maximum demand or switchboard is suitable. Use the appropriately licensed electrical trade, plus licensed plumbing or refrigerant work where the hot-water system requires it, and require testing and commissioning in writing.",
        status: "answered",
        citations: officialCitationsById(refrigerantWork
          ? ["dcceew-refrigerant-recovery-licensing", "nsw-home-electrical-safety"]
          : /\b(?:hot[- ]?water|HPWH|water heater)\b/i.test(query)
            ? ["energy-gov-electrification", "cer-small-scale-system-requirements"]
            : ["energy-gov-appliances-cooking", "energy-gov-electrification-sequence"]),
        confidence: "high",
        assumptions: ["The equipment, supply, plumbing, refrigerant circuit and jurisdictional licence requirements have not been inspected."],
        practicalSteps: [
          "Do not open, wire, energise or commission the equipment yourself.",
          "Give the exact model and site details to the appropriately licensed trades for a complete design and quote.",
          "Keep the electrical, plumbing, refrigerant and commissioning evidence with the job.",
        ],
        toolActions: [],
        suggestedQuestions: [],
      });
    }
    if (asbestosDisturbanceQuery(query)) {
      const looseFillSample = /\b(?:vermiculite|loose[ -]?fill|loose insulation|granular insulation|unknown insulation)\b/i.test(query)
        && /\b(?:sample|test|collect|collection|scoop|bag|mail|send|pick up|handle|take|pinch|spoonful|teaspoon|jar|envelope|lab|laboratory|test kit)\b/i.test(query);
      return structured("safety_consumer_rights", {
        directAnswer: looseFillSample
          ? "Do not collect, scoop, bag, mail or otherwise self-sample old or unknown loose-fill or vermiculite insulation. Appearance cannot confirm whether it contains asbestos or another hazardous contaminant, and sampling itself can release dust. Keep out of the area, avoid moving the material, and use an appropriately licensed asbestos assessor or other jurisdiction-approved professional to choose the controlled sampling and laboratory pathway."
          : "Do not cut, drill, break, sand, remove or otherwise disturb material that is known or suspected to contain asbestos. Do not sample or disturb it yourself. An energy upgrade does not make DIY disturbance safe. Keep the area intact and restricted, have the material identified and managed by an appropriately licensed asbestos professional under the applicable state rules, and require the equipment installer to redesign or coordinate the job around the verified asbestos plan.",
        status: "answered",
        citations: officialCitationsById(["asbestos-safety-identification-removal"]),
        confidence: "high",
        assumptions: [
          "The material, condition, location and jurisdictional asbestos requirements have not been verified.",
          "The applicable jurisdiction-specific asbestos licensing and notification requirements must still be checked before work.",
        ],
        practicalSteps: [
          "Stop work and do not sample or disturb the material yourself.",
          "Use an appropriately licensed asbestos assessor or removal professional for identification and the required control plan.",
          "Coordinate any revised penetration, mounting or removal scope with the licensed equipment installer before work resumes.",
        ],
        toolActions: [],
        suggestedQuestions: [],
      });
    }
    if (unsafeInsulationLightCoverQuery(query)) {
      return structured("insulation", {
        directAnswer:
          "Do not fill gaps around, leave loose-fill touching or place insulation over, on top of or across old halogen downlights, exposed transformers, drivers or unknown recessed electrical fittings. Older halogen fittings cannot be covered because of fire risk. For other equipment, do not guess from appearance: a licensed electrician must identify the exact fitting classification, wiring, driver or transformer and required clearances before the insulation installer restores coverage. Keep every required separation and ventilation path clear and record the completed insulation and protected services.",
        status: "needs_context",
        citations: officialCitationsById(["yourhome-insulation", "energy-gov-insulation-draught-proofing"]),
        confidence: "high",
        assumptions: ["The fitting type, classification, age, wiring condition, drivers, transformers and required clearances have not been verified."],
        practicalSteps: [
          "Stop placing or moving insulation over the fittings and do not energise a fitting that may already be unsafely covered.",
          "Have a licensed electrician identify each fitting and issue the permitted cover and clearance requirements.",
          "Give that schedule to the insulation installer and keep completion evidence showing coverage and every protected service.",
        ],
        toolActions: [{ id: "open-insulation-guide", label: "Open the insulation safety guide", href: "/guides/insulation-draught-proofing" }],
        suggestedQuestions: [],
      });
    }
    if (unsafeVentBlockingQuery(query)) {
      return structured("draughts_ventilation", {
        directAnswer:
          "Do not tape, seal, block or cover a ventilation grille, register, opening, permanent vent or flue until its purpose has been identified. It may provide combustion air, remove pollutants or moisture, distribute designed supply or return air, or satisfy a required ventilation path. Blocking it can create gas, carbon-monoxide, condensation, indoor-air or equipment problems. Leave it open, identify the appliance or space it serves, and use a licensed gasfitter or appropriate building or mechanical practitioner before any permanent alteration; seal only confirmed unintended leakage paths.",
        status: "answered",
        citations: officialCitationsById(["yourhome-ventilation-airtightness", "energy-gov-carbon-monoxide-heater-safety", "ncc-condensation-handbook"]),
        confidence: "high",
        assumptions: ["The grille, register or opening purpose, connected equipment, air-balance role and local requirements have not been inspected."],
        practicalSteps: [
          "Remove any temporary obstruction and leave the opening and every flue clear while identifying what it serves.",
          "Check for gas, wood or other combustion equipment and for designed supply, return, kitchen, bathroom or whole-home ventilation paths.",
          "Have the appropriate licensed practitioner approve any permanent alteration or alternative ventilation design.",
        ],
        toolActions: [],
        suggestedQuestions: ["Where is the grille, register or opening, what does it connect to, and is any combustion or ducted equipment installed?"],
      });
    }
    if (unsafeRoofFoilQuery(query)) {
      const existingRoofEntry = /\b(?:enter|crawl|climb|inspect|look|safe|move|shift|lift|push|pull|nudge|sweep|broom|pole|touch|touching)\b/i.test(query)
        && /\b(?:existing|old|already|see|visible|there is|there's|touch|touching|against|near)\b/i.test(query);
      return structured("safety_consumer_rights", {
        directAnswer: existingRoofEntry
          ? "Do not enter, crawl through or touch a roof space where conductive foil is near old, damaged or unknown wiring. Treat the foil as potentially energised and keep everyone out. Do not operate roof-space switches or move the foil. Have a licensed electrician isolate and inspect the wiring and foil before any building or insulation work resumes."
          : "Do not place or staple reflective foil under roof tiles as an improvised DIY insulation layer. Foil can create electrical contact hazards, and the roof assembly must also preserve required clearances, drainage, ventilation and a climate-appropriate condensation path. Use a building-specific insulation and sarking design, with wiring checked by a licensed electrician before work.",
        status: "answered",
        citations: officialCitationsById(["wa-roof-space-foil-electrical-safety", "ncc-condensation-handbook"]),
        confidence: "high",
        assumptions: ["The roof construction, existing sarking, wiring, moisture path and local requirements have not been inspected."],
        practicalSteps: [
          "Do not enter or alter an unsafe roof space or attach conductive foil near wiring.",
          "Have the roof assembly, moisture path and existing services inspected before selecting insulation or sarking.",
          "Use appropriately licensed electrical and installation trades for the final scope.",
        ],
        toolActions: [],
        suggestedQuestions: [],
      });
    }
    if (unsafeCredentialCertificationQuery(query)) {
      return structured("trades", {
        directAnswer:
          "Do not share, borrow or use another person's trade login, licence, accreditation or certificate-agent identity, and do not certify work you did not perform or authoritatively verify. Keep every action attributed to the real authorised person and preserve the audit trail. An apprentice or worker must use their own permitted access and escalate certification to the licence or accreditation holder who completes the required review. If credentials were shared, stop submissions, secure the account and report the incident through the platform and governing programme process.",
        status: "answered",
        citations: officialCitationsById([
          ...( /\b(?:VEU|VEEC)\b/i.test(query) ? ["veu-water-space-activity-guide-v3-19"] : []),
          ...( /\b(?:ESS|ESC)\b/i.test(query) ? ["nsw-ess-rule-current-2026"] : []),
          ...( /\b(?:PDRS|PRC)\b/i.test(query) ? ["nsw-pdrs-rule-current-2026"] : []),
          ...( /\b(?:solar|PV|STC|SRES)\b/i.test(query) ? ["cer-rooftop-solar-trade-requirements", "cer-small-scale-system-requirements"] : []),
        ]),
        confidence: "high",
        assumptions: ["The exact programme, role and account incident have not been inspected; its current notification process must be checked."],
        practicalSteps: [
          "Stop using the shared or unauthorised identity and prevent any further submission.",
          "Preserve the audit trail, secure the account and notify the platform owner and relevant programme authority.",
          "Have the properly authorised person review the actual work and follow the governed correction process.",
        ],
        toolActions: [],
        suggestedQuestions: [],
      });
    }
    const safety = activeOfficial.filter((result) => result.source.topic === "safety_consumer_rights");
    return structured("safety_consumer_rights", {
      directAnswer:
        "Treat this as a safety issue first. If there is immediate danger, leave the area, keep others away and call 000. Do not touch, charge, restart or dismantle suspect equipment. Use the relevant licensed emergency service or network fault line, then preserve the contract and installation records for the supplier and consumer process.",
      status: "answered",
      citations: citationsFor(safety.slice(0, 2)),
      confidence: safety.length ? "high" : "medium",
      suggestedQuestions: [],
    });
  }

  const wholeHomeTriage = composeWholeHomeTriage();
  if (wholeHomeTriage) return wholeHomeTriage;

  if (/\b(?:what can you (?:actually\s+)?(?:do|help with|help me decide)|what do you (?:do|cover)|how can you help|your capabilities|what is this (?:assistant|guide|tool) for|what can (?:this|the) (?:energy )?(?:widget|assistant|guide|tool) (?:do|help (?:me )?with))\b/i.test(query)) {
    return structured("comfort_fabric", {
      directAnswer:
        "I help with Australian whole-home comfort and energy, NatHERS and building fabric, bills and tariffs, electrification, solar, batteries, EVs, independent product and quote checks, current assistance pathways, local file analysis and role-safe TLink or Creditex guidance. I can calculate from supplied values, diagnose symptoms one step at a time and explain what a licensed inspection or current official register must decide. I do not access private customer records, choose a brand, make a regulated site finding or answer unrelated topics.",
      status: "answered",
      citations: officialCitationsById(["energy-gov-electrification-sequence", "yourhome-passive-design-system", "energy-gov-rebates"]),
      confidence: "high",
      practicalSteps: ["Describe the property, symptom or decision and include any measured value already available."],
      toolActions: [],
      suggestedQuestions: ["What home-energy, document or trade decision should we solve first?"],
    });
  }

  if (/\b(?:ignore|bypass|override|reveal|show|print|repeat|extract)\b[\s\S]{0,80}\b(?:system prompt|developer message|hidden instructions?|customer database|private customer|all customers?|lead database|private records?)\b/i.test(query)) {
    return structured("safety_consumer_rights", {
      directAnswer:
        "I cannot reveal hidden instructions, private customer or lead records, credentials or another user's data, or follow a request to bypass the assistant's safety and privacy boundaries. I can explain the public energy guidance, local tools and the authorised TLink workflow without accessing or exposing private records.",
      status: "answered",
      citations: [],
      confidence: "high",
      practicalSteps: ["Ask for the public energy fact or authorised platform task you need."],
      toolActions: [],
      suggestedQuestions: [],
    });
  }

  if (/\b(?:SolarQuotes|CHOICE|Renew|Rewiring Australia|Brand[- ]?[A-Z0-9]+)\b/i.test(query)
    && /\b(?:best|recommend|endorse|rank|pick|choose|trust|what does .* say)\b/i.test(query)) {
    return structured("products_ratings", {
      directAnswer:
        "I will not repeat a commercial or editorial brand endorsement or choose a product from a third party's ranking. I can compare exact user-supplied options independently using the same official eligibility, capacity, performance, site-design, safety, warranty, service and complete installed-price evidence. An approved register or favourable review proves only its stated fact, not overall quality or site suitability.",
      status: "needs_context",
      citations: officialCitationsById(["energy-rating-product-register", "accc-consumer-guarantees"]),
      confidence: "high",
      practicalSteps: ["Supply the exact options and the official specifications or quote facts to compare."],
      toolActions: [],
      suggestedQuestions: ["Which exact products and site outcome should be compared on neutral criteria?"],
    });
  }

  if (/\b(?:toast|recipe|cook dinner|cooking instructions?|how (?:do|can) I cook)\b/i.test(query)
    && /\b(?:induction|cooktop|stove|oven|appliance)\b/i.test(query)) {
    return structured("induction", {
      directAnswer:
        "This guide does not provide recipes or cooking instructions. It can help with induction compatibility, electrical supply, energy use, ventilation and the safe licensed installation boundary.",
      status: "needs_context",
      citations: [],
      confidence: "high",
      practicalSteps: [],
      toolActions: [],
      suggestedQuestions: ["Do you want help checking induction compatibility, energy use or installation requirements?"],
    });
  }

  if (/\b(?:demand charge|demand tariff|demand interval|peak demand|maximum demand)\b/i.test(query)) {
    return structured("bills_tariffs", {
      directAnswer:
        "A demand charge prices the highest measured average power in the plan's stated demand interval and time window, often a half-hour peak, in addition to ordinary kWh use and the daily supply charge. Running an oven and EV charger together can create a larger coincident kW peak even if total daily energy is unchanged. Confirm the exact interval, season, window, units, ratchet or minimum and rate from the current tariff before shifting loads; staggering controllable EV, hot-water or appliance use can reduce the measured peak without assuming it always lowers the whole bill.",
      status: "needs_context",
      citations: officialCitationsById(["aer-understanding-energy-bill", "energy-made-easy-current-plan-comparison"]),
      confidence: "high",
      practicalSteps: ["Find the tariff's demand interval, window and $/kW term.", "Use interval data to locate coincident oven, EV and other large loads.", "Model staggered operation against the complete plan."],
      toolActions: [{ id: "compare-electricity", label: "Check the tariff and interval load", href: "/compare" }],
      suggestedQuestions: ["What demand interval, time window and $/kW rate does the plan state?"],
    });
  }

  if (/\b(?:free|zero[- ]?(?:cent|cost)|no[- ]?cost)\b[\s\S]{0,40}\b(?:midday|middle of the day|daytime|solar hours?|electricity|power)\b/i.test(query)
    && /\b(?:offer|plan|tariff|hours?|rebate|assistance|government|deal|rate)\b/i.test(query)) {
    return structured("bills_tariffs", {
      directAnswer:
        "A free-midday or free-hours offer is a retail tariff feature, not a government rebate. Its value depends on how much flexible load can actually move into the free window and on the plan's supply charge, rates outside the window, demand terms, export credit, eligibility, expiry and any controlled-load treatment. Price the same interval load against the complete current offer and a suitable alternative rather than valuing only the free period.",
      status: "needs_context",
      citations: officialCitationsById(["energy-gov-solar-sharer-offer", "energy-made-easy-current-plan-comparison"]),
      confidence: "high",
      practicalSteps: ["Record every tariff term and effective date.", "Measure load that can safely move into the free window.", "Compare the full annual bill on identical intervals."],
      toolActions: [{ id: "compare-electricity", label: "Compare the complete plan", href: "/compare" }],
      suggestedQuestions: ["What exact plan, free window and outside-window rates apply?"],
    });
  }

  const importCents = numericCapture(query, /\b(?:imports?|buy|usage)(?:\s+(?:rate|price|cost|costs))?\s*(?:is|are|costs?|at|:|=)?\s*(\d+(?:\.\d+)?)\s*(?:c|cents?)(?:\s*(?:\/|per)\s*kWh)?/i);
  const feedInCents = numericCapture(query, /\b(?:exports?|feed[- ]?in|FIT)(?:\s+(?:rate|price|tariff|credit))?\s*(?:is|are|earns?|pays?|credits?|at|:|=)?\s*(\d+(?:\.\d+)?)\s*(?:c|cents?)(?:\s*(?:\/|per)\s*kWh)?/i)
    ?? numericCapture(query, /\b(?:feed[- ]?in|FIT)(?:\s+(?:rate|price|tariff|credit))?\b[^.\n]{0,45}\bto\s*(\d+(?:\.\d+)?)\s*(?:c|cents?)(?:\s*(?:\/|per)\s*kWh)?/i);
  if (importCents !== null && feedInCents !== null
    && /\b(?:self[- ]?consum(?:e|ed|ing|ption)?|use my own solar|extra kWh|marginal|worth|value|opportunity)\b/i.test(query)) {
    const difference = importCents - feedInCents;
    return structured("solar", {
      directAnswer:
        `Using the supplied rates, one additional kWh of solar self-consumed instead of exported has a simple marginal bill value of ${difference.toLocaleString("en-AU", { maximumFractionDigits: 2 })} c/kWh: ${importCents} c avoided import minus ${feedInCents} c foregone feed-in credit. That is before battery or conversion losses, demand effects, tariff windows, export bonuses and taxes or fees. Apply the rates at the same timestamp and do not treat this marginal value as an annual saving without a measured shiftable-kWh profile.`,
      status: "answered",
      citations: officialCitationsById(["aer-understanding-energy-bill", "energy-made-easy-current-plan-comparison"]),
      confidence: "high",
      practicalSteps: ["Match import and export rates to the same time window.", "Measure realistically shiftable solar kWh.", "Deduct storage losses and other tariff effects where applicable."],
      toolActions: [{ id: "compare-electricity", label: "Check interval self-consumption", href: "/compare" }],
      suggestedQuestions: [],
    });
  }

  const statedAnnualEnergySaving = numericCapture(query, /\$\s*([\d,]+(?:\.\d+)?)\s*(?:annual|yearly|per[- ]?year|a[- ]?year)\s+(?:(?:energy|usage)\s+)?savings?/i)
    ?? numericCapture(query, /\b(?:annual|yearly)\s+(?:(?:energy|usage)\s+)?savings?\s*(?:is|of|:|=)?\s*\$\s*([\d,]+(?:\.\d+)?)/i)
    ?? numericCapture(query, /\b(?:save|saves|saving|savings)\s*\$\s*([\d,]+(?:\.\d+)?)\s*(?:a|per|each)?\s*(?:year|annum|yearly|annual)?\b/i);
  const statedDailyGasSupply = numericCapture(query, /\$\s*([\d,]+(?:\.\d+)?)\s*(?:\/|per|a)\s*day\b[\s\S]{0,35}\b(?:gas|supply)/i)
    ?? numericCapture(query, /\b(?:gas|supply)(?:\s+charge)?[\s\S]{0,35}\$\s*([\d,]+(?:\.\d+)?)\s*(?:\/|per|a)\s*day\b/i)
    ?? numericCapture(query, /\$\s*([\d,]+(?:\.\d+)?)\s*(?:daily|each day)\s+(?:gas\s+)?supply\s+charge\b/i);
  if (statedAnnualEnergySaving !== null && statedDailyGasSupply !== null
    && /\b(?:net|after|minus|subtract|allow for|account for|change|effect|how does)\b/i.test(query)) {
    const annualSupply = statedDailyGasSupply * 365;
    const net = statedAnnualEnergySaving - annualSupply;
    return structured("bills_tariffs", {
      directAnswer:
        `On the supplied subtraction basis, the net is $${net.toLocaleString("en-AU", { maximumFractionDigits: 2 })} a year: $${statedAnnualEnergySaving.toLocaleString("en-AU")} annual saving minus $${annualSupply.toLocaleString("en-AU", { maximumFractionDigits: 2 })} for a $${statedDailyGasSupply.toLocaleString("en-AU")}/day charge. Check the sign before using it: a gas supply charge is an avoided saving only if the account actually closes, but a charge that remains is a cost to subtract. Include retailer closure and any licensed physical disconnection or abolishment cost separately.`,
      status: "answered",
      citations: officialCitationsById(["aer-understanding-energy-bill", "energy-made-easy-current-plan-comparison"]),
      confidence: "high",
      practicalSteps: ["Confirm whether the daily charge stops or remains.", "Add one-off closure or physical disconnection costs separately."],
      toolActions: [],
      suggestedQuestions: [],
    });
  }

  if (/\bgas\b/i.test(query)
    && /\b(?:disconnect(?:ing|ed)?|disconnection|abolish|abolishment|close the account|remove the meter|electrify|electrifying)\b/i.test(query)
    && /\b(?:costs?|charges?|fees?|save|saving|include|compare|fixed|removal)\b/i.test(query)) {
    return structured("bills_tariffs", {
      directAnswer:
        "Compare the avoided gas daily supply charge multiplied by 365 and remaining gas usage with every one-off exit cost. The fixed charge becomes a saving only when the account or service is actually disconnected or closed and the charge stops. Include retailer account closure or final-bill charges, distributor disconnection, abolishment or meter-removal fees, licensed gasfitter capping or removal, appliance removal, electrical replacement work and any building make-good. Obtain current retailer, network and licensed-trade prices for the property rather than assuming one national fee.",
      status: "needs_context",
      citations: officialCitationsById(["aer-understanding-energy-bill", "energy-made-easy-current-plan-comparison"]),
      confidence: "high",
      assumptions: ["The property, retailer, network, remaining appliances and quoted closure or physical-disconnection path have not been verified."],
      practicalSteps: ["Annualise the avoidable daily supply charge.", "List retailer, network, gasfitter, replacement and make-good costs separately.", "Use current property-specific quotes and show the break-even period."],
      toolActions: [{ id: "compare-electricity", label: "Compare the complete bills", href: "/compare" }],
      suggestedQuestions: ["What postcode, daily gas charge, remaining appliances and quoted account-closure or physical-disconnection path apply?"],
    });
  }

  if (/\b(?:daylight saving|daylight savings|DST|23[- ]hour|25[- ]hour|clock change|time change)\b/i.test(query)
    && /\b(?:NEM12|interval|meter|data|compare|timestamp|tariff)\b/i.test(query)) {
    return structured("bills_tariffs", {
      directAnswer:
        "Do not compare daylight-saving interval rows by displayed clock time alone. First verify the file's stated time basis, interval length and whether timestamps are local standard time, market time or include a UTC offset; transition days can contain 23 or 25 local clock hours. Preserve the raw timestamps, map them using the distributor or file specification, and apply tariff windows on the retailer's documented basis. Keep the calculation blocked if the repeated or missing interval cannot be resolved without guessing.",
      status: "needs_context",
      citations: officialCitationsById(["aemo-mdff-nem12-nem13-v2-7", "energy-made-easy-current-plan-comparison"]),
      confidence: "high",
      practicalSteps: ["Confirm file time basis and interval length.", "Identify repeated or missing transition intervals.", "Apply the retailer's documented tariff-time rule."],
      toolActions: [{ id: "compare-electricity", label: "Open the local interval checker", href: "/compare" }],
      suggestedQuestions: ["What time basis and interval length does the file or distributor specification state?"],
    });
  }

  if (/\b(?:heat pump|reverse[- ]?cycle|RCAC)\b/i.test(query)
    && /\b(?:COP\s*(?:above|over|greater than)\s*1|conservation of energy|create energy|more heat than (?:electricity|(?:its |the )?electrical input|power input)|deliver(?:ed|s|ing)? more heat than (?:electricity|(?:its |the )?electrical input|power input)|how can .*COP)\b/i.test(query)) {
    return structured("rcac", {
      directAnswer:
        "A heat pump does not create extra energy. It uses electrical work to move heat from outdoor air or another source into the home or water. The delivered heat equals the electrical input plus the ambient heat moved, so a COP above 1 is consistent with conservation of energy. COP still falls or changes with source and delivery temperatures, defrost, cycling, fans, pumps and resistive backup, so compare seasonal performance and retained capacity at the local design condition rather than one mild-test COP.",
      status: "answered",
      citations: officialCitationsById(["energy-gov-electrification", "energy-rating-heating-cooling"]),
      confidence: "high",
      practicalSteps: ["Compare delivered heat and electricity at the same stated test condition.", "Check retained capacity and seasonal energy for the local climate."],
      toolActions: [],
      suggestedQuestions: [],
    });
  }

  if (/\b(?:solar|PV)\b/i.test(query)
    && /\b(?:self[- ]?consum(?:e|ed|ing|ption)?|self use|use.*(?:solar|PV)|using (?:it|solar|PV)|export(?:ed|ing|s)?|export.*(?:solar|PV)|(?:solar|PV).*export)\b/i.test(query)
    && /\b(?:carbon|emissions?|greenhouse|lower carbon|cleaner)\b/i.test(query)) {
    return structured("solar", {
      directAnswer:
        "Self-consuming a solar kWh is not automatically lower-carbon than exporting it. The physical panel output is the same; the system outcome depends on which grid generation is displaced at that time, what household load is avoided, network and storage losses, charging or curtailment and the comparison boundary. For a defensible claim, compare matched timestamps and the applicable average or marginal emissions method, state whether a battery is involved and keep bill value separate from carbon value.",
      status: "needs_context",
      citations: officialCitationsById(["energy-gov-solar-consumer-guide", "yourhome-embodied-energy"]),
      confidence: "medium",
      practicalSteps: ["Define the carbon comparison and time period.", "Match solar, load, export and storage flows by timestamp.", "Use one stated grid-emissions method and sensitivity."],
      toolActions: [],
      suggestedQuestions: ["Is the comparison operational grid emissions at specific times, annual average emissions, or full life-cycle carbon?"],
    });
  }

  if (/\b(?:cardboard|paper|fabric|timber|combustible)\b/i.test(query)
    && /\b(?:pelmet|cover|screen|shield)\b/i.test(query)
    && /\b(?:gas heater|flued heater|unflued heater|space heater)\b/i.test(query)) {
    return structured("safety_consumer_rights", {
      directAnswer:
        "No. Do not install a cardboard or other combustible pelmet, cover or screen near a gas heater. It can breach the appliance's required clearances, obstruct airflow or overheat and ignite. Keep the manufacturer's clearances and every grille, flue and combustion-air path unobstructed, remove the improvised material and have a licensed gasfitter assess any fixed heat or draught treatment around the appliance.",
      status: "answered",
      citations: officialCitationsById(["energy-gov-carbon-monoxide-heater-safety", "energy-gov-insulation-draught-proofing"]),
      confidence: "high",
      practicalSteps: ["Remove the combustible material without altering the heater or vent.", "Keep all documented clearances and airflow paths open.", "Use a licensed gasfitter for any fixed nearby treatment."],
      toolActions: [],
      suggestedQuestions: [],
    });
  }

  if (/\b(?:seal|close|block|fill)\b[\s\S]{0,35}\b(?:all|every)\b[\s\S]{0,25}\b(?:gap|crack|opening|leak|air\s+leak)s?\b|\b(?:all|every)\b[\s\S]{0,25}\b(?:gap|crack|air\s+leak)s?\b[\s\S]{0,35}\b(?:seal|close|block|fill)\b/i.test(query)) {
    return structured("draughts_ventilation", {
      directAnswer:
        "Do not seal every gap indiscriminately. First identify permanent ventilation, flues, combustion air, exhaust make-up air, drainage and moisture paths, then distinguish them from unintended leakage. Check bathroom and kitchen exhaust, any gas or solid-fuel appliance and condensation before a whole-home sealing programme; use removable tests on confirmed leaks and verify humidity, odours and equipment operation after each change.",
      status: "needs_context",
      citations: officialCitationsById(["yourhome-ventilation-airtightness", "energy-gov-insulation-draught-proofing", "energy-gov-carbon-monoxide-heater-safety"]),
      confidence: "high",
      practicalSteps: ["Map intentional vents, flues, exhausts and moisture paths.", "Test one confirmed unintended leak with a reversible measure.", "Recheck humidity, odours and appliance operation before more sealing."],
      toolActions: [],
      suggestedQuestions: ["What combustion appliances, exhaust fans and permanent grilles or vents are present?"],
    });
  }

  if (/\b(?:five|5)\b/i.test(query)
    && /\b(?:reversible|temporary|no[- ]drill|renter|rental|tenant)\b/i.test(query)
    && /\b(?:cold|winter|comfort|warm|room|bedroom|measures?|things?|fixes?)\b/i.test(query)) {
    return structured("renters_strata", {
      directAnswer:
        "Five reversible measures are: 1. fit a removable close-fitting curtain and safe pelmet away from heaters; 2. use a door snake only on a confirmed unintended gap, never a vent; 3. add a removable rug with a non-slip backing where permitted; 4. use a compliant portable electric heater to warm the occupied zone, directly from a suitable outlet and clear of combustibles; 5. use safe daytime sun, close coverings before dusk and manage condensation with exhaust and brief ventilation when outdoor air is suitable. Confirm lease, egress, glass and heater instructions before attaching anything.",
      status: "answered",
      citations: officialCitationsById(["energy-gov-renters", "energy-gov-windows", "yourhome-ventilation-airtightness"]),
      confidence: "medium",
      practicalSteps: ["Choose one low-cost measure and record room temperature and condensation before and after.", "Escalate fixed defects through the current tenancy pathway."],
      toolActions: [],
      suggestedQuestions: [],
    });
  }

  if (/\b(?:controlled[ -]load|off[- ]?peak circuit|dedicated hot[- ]?water tariff)\b/i.test(query)
    && /\b(?:heat[- ]?pump|HPHW|HPWH|hot[- ]?water|water heater)\b/i.test(query)) {
    return structured("heat_pump_hot_water", {
      directAnswer:
        "Do not move a heat-pump water heater from controlled load to solar hours from tariff price alone. Check whether the exact model and installation support a timer or energy-management input, the tank's usable volume, cold-condition recovery, household peak draw, the controlled-load availability window and rate, solar surplus and main-tariff rate, and the required bacteria-control cycle. A warmer daytime run can improve heat-pump efficiency and use solar, but an unsupported nightly mains interruption or too-short window can leave the tank unrecovered or interfere with required controls.",
      status: "needs_context",
      citations: officialCitationsById(["energy-gov-smart-hot-water", "energy-made-easy-current-plan-comparison"]),
      confidence: "high",
      practicalSteps: ["Confirm the manufacturer's supported control method and recovery time.", "Compare controlled-load and solar-surplus windows against peak draw.", "Have any circuit or control change designed and completed by the required licensed trade."],
      toolActions: [{ id: "compare-electricity", label: "Compare hot-water tariff windows", href: "/compare" }],
      suggestedQuestions: ["What model, tank volume, peak draw, controlled-load window and available solar surplus apply?"],
    });
  }

  const hpwhDesignDimensionCount = [
    /\b(?:tank|volume|litres?|storage)\b/i,
    /\b(?:recovery|reheat|peak draw|showers?|baths?)\b/i,
    /\b(?:cold|climate|winter|design temperature|defrost)\b/i,
    /\b(?:tariff|controlled load|off[- ]?peak|solar window|timer)\b/i,
  ].filter((signal) => signal.test(query)).length;
  if (/\b(?:HPHW|HPWH|heat[- ]?pump hot[- ]?water|hot[- ]?water heat[- ]?pump)\b/i.test(query)
    && hpwhDesignDimensionCount >= 3
    && /\b(?:compare|choose|size|sizing|suitable|enough|matter|check|how)\b/i.test(query)) {
    return structured("heat_pump_hot_water", {
      directAnswer:
        "Compare heat-pump hot-water options as one demand-and-recovery system. Tank usable volume must cover the household's peak consecutive draw; the exact model's heat-pump capacity, recovery time, defrost and any resistive boost must then restore it at the local cold design condition inside the available controlled-load, off-peak or solar window. Check supported controls and bacteria-control cycles as well as placement, noise, condensate, tempering, circuit, service and warranty. A large tank, high mild-test COP or cheap tariff alone cannot establish suitability.",
      status: "needs_context",
      citations: officialCitationsById(["energy-gov-smart-hot-water", "cer-swh-ashp-register", "energy-made-easy-current-plan-comparison"]),
      confidence: "high",
      assumptions: ["The household peak draw, exact model, cold-condition recovery, supported controls, tariff window and site have not all been verified."],
      practicalSteps: ["Quantify peak consecutive draw and usable tank volume.", "Check cold-condition recovery and boost inside the available heating window.", "Verify controls, hygiene cycle and complete licensed installation scope."],
      toolActions: [],
      suggestedQuestions: ["What peak consecutive draw, exact model, winter design condition and tariff or solar heating window apply?"],
    });
  }

  if (/\b(?:COP|coefficient of performance|headline efficiency)\b/i.test(query)
    && /\b(?:freez|coldest|cold weather|cold mornings?|cold climate|design temperature|design day|defrost|retained capacity|below zero|minus\s*\d+|Ballarat)\b/i.test(query)
    && (/\b(?:heat pump|reverse[- ]?cycle|RCAC|air conditioner|split(?: system)?|HPHW|HPWH)\b/i.test(query)
      || /\b(?:heat capacity|heating capacity|retained capacity|output capacity)\b/i.test(query))) {
    return structured(/\b(?:hot[- ]?water|HPHW|HPWH)\b/i.test(query) ? "heat_pump_hot_water" : "rcac", {
      directAnswer:
        "A headline COP from a mild laboratory point does not establish cold-weather suitability. At the local design temperature, check delivered or retained heating capacity, input power and COP on the same condition, defrost behaviour, backup heat, recovery or room-load requirement and seasonal energy. A unit can remain efficient yet lack enough capacity, or meet capacity with more defrost and backup energy, so size from the design load and cold-condition data rather than the headline COP.",
      status: "needs_context",
      citations: officialCitationsById(["energy-rating-heating-cooling", "energy-rating-zoned-label", "energy-gov-smart-hot-water"]),
      confidence: "high",
      practicalSteps: ["Fix the local design temperature and required load or recovery.", "Compare capacity, input and COP at that condition.", "Check defrost, backup and seasonal energy in the complete design."],
      toolActions: [],
      suggestedQuestions: ["What exact model, local design temperature and required room load or hot-water recovery apply?"],
    });
  }

  if (/\b(?:low|lower)\s+GWP|global warming potential|refrigerant\s+GWP\b/i.test(query)
    && /\b(?:heat pump|air conditioner|RCAC|HPHW|HPWH|best|choose|selection)\b/i.test(query)) {
    return structured("products_ratings", {
      directAnswer:
        "Refrigerant GWP is one disclosed environmental characteristic, not a product ranking, and the reviewed sources here do not establish an exact refrigerant GWP or a site-specific leakage impact for an unnamed unit. First confirm site-sized delivered capacity and seasonal energy at the local conditions, then noise, placement, condensate, electrical and plumbing design, safety, licensed refrigerant work, service, warranty and local parts. Verify the exact refrigerant and charge from current official or manufacturer documentation before comparing GWP as a separate criterion.",
      status: "needs_context",
      citations: officialCitationsById(["energy-rating-heating-cooling", "dcceew-refrigerant-recovery-licensing", "accc-consumer-guarantees"]),
      confidence: "medium",
      practicalSteps: ["Screen for required capacity and site suitability.", "Compare seasonal energy, noise, service and complete installation.", "Then compare refrigerant type, charge, GWP and safety controls."],
      toolActions: [],
      suggestedQuestions: ["Is this space conditioning or hot water, and what load, climate and site constraints apply?"],
    });
  }

  if (/\b(?:STC|SRES|CER|scheme|programme|program)\b/i.test(query)
    && /\b(?:approved|eligible|listed|register|list)\b/i.test(query)
    && /\b(?:best|quality|reliable|reliability|quiet|noise|warranty|rank|recommend|good)\b/i.test(query)) {
    return structured("products_ratings", {
      directAnswer:
        "No. An STC, SRES, CER or programme approved-list entry proves only the list's stated eligibility fact for the exact model and date. It is not a quality ranking and does not prove reliability, noise, site suitability, installer quality, warranty response, local service or overall value. Verify the exact current entry for eligibility, then compare delivered performance at the site conditions, installation design, safety, warranty, service and complete price independently.",
      status: "answered",
      citations: officialCitationsById(["cer-swh-ashp-register", "energy-rating-product-register", "accc-consumer-guarantees"]),
      confidence: "high",
      assumptions: ["The exact product category, model, listing date and site design have not been verified."],
      practicalSteps: ["Verify the exact model and applicable list date.", "Compare site performance and complete installation scope.", "Check warranty, service, parts and remedies separately."],
      toolActions: [],
      suggestedQuestions: [],
    });
  }

  const batteryAggregationOffer = /\b(?:VPP|virtual power plant|battery aggregation|aggregator)\b/i.test(query)
    || /\b(?:battery|storage)\b/i.test(query)
      && /\b(?:provider|retailer|operator|offer|programme|program)\b/i.test(query)
      && /\b(?:control|dispatch|charge|discharge|monthly payment|pays?|payment|reserve|event|exit)\b/i.test(query);
  if (batteryAggregationOffer
    && /\b(?:offer|pay|pays|payment|join|sign|worth|month|control|exit)\b/i.test(query)) {
    const monthlyPayment = numericCapture(query, /\$\s*([\d,]+(?:\.\d+)?)\s*(?:a|per|\/)?\s*month/i);
    const annualText = monthlyPayment === null ? "" : ` The stated $${monthlyPayment.toLocaleString("en-AU")}/month is $${(monthlyPayment * 12).toLocaleString("en-AU")}/year gross before other tariff or battery effects.`;
    return structured("battery_vpp", {
      directAnswer:
        `Do not decide from the monthly payment alone.${annualText} Compare who can remotely charge or discharge the battery, event frequency and duration, minimum reserve and backup impact, import and export tariff changes, data and internet requirements, performance or availability obligations, warranty treatment, contract term, exit fees, ownership and what happens when the programme ends. Model the complete annual bill and battery use with and without the VPP under the same load and solar profile.`,
      status: "needs_context",
      citations: officialCitationsById(["energy-gov-batteries", "energy-gov-solar-batteries", "energy-made-easy-current-plan-comparison"]),
      confidence: "medium",
      practicalSteps: ["Convert every payment and tariff term to an annual value.", "Mark control, reserve, warranty, data and exit rights.", "Compare the same measured profile with and without the VPP."],
      toolActions: [{ id: "compare-electricity", label: "Compare the complete VPP tariff", href: "/compare" }],
      suggestedQuestions: ["What payment, tariff, control, reserve, warranty and exit terms does the VPP contract state?"],
    });
  }

  if (/\b(?:east[- ]?west|east and west|east\/west|east-facing.*west-facing|west-facing.*east-facing)\b/i.test(query)
    && /\b(?:solar|PV|panels?|array|roof)\b/i.test(query)) {
    return structured("solar", {
      directAnswer:
        "East-west solar is not automatically worse than north-facing solar. In many Australian sites, north can maximise annual yield on an unshaded roof, while east-west can spread generation into morning and afternoon and better match household self-consumption or fit more usable roof area. The result depends on pitch, azimuth, shade, inverter and string design, export limits, tariff and load timing. Compare hourly modelled generation and self-consumption on the actual roof, not orientation alone.",
      status: "needs_context",
      citations: officialCitationsById(["energy-gov-solar-consumer-guide", "energy-gov-solar-batteries"]),
      confidence: "medium",
      practicalSteps: ["Map roof pitch, azimuth and shade by array section.", "Overlay household load and export constraints.", "Compare hourly yield and self-consumption for each layout."],
      toolActions: [],
      suggestedQuestions: ["What roof orientations, pitches, shade and daytime load profile are available?"],
    });
  }

  if (/\b(?:shad(?:e|ed|es|ing|ow))\b/i.test(query)
    && /\b(?:panel|module|string|bypass diode|optimiser|optimizer|microinverter|solar|PV)\b/i.test(query)) {
    return structured("solar", {
      directAnswer:
        "Shade can reduce rooftop-solar output, but the symptom alone cannot establish the response of a string, bypass diode, optimiser or microinverter. The reviewed sources support checking the actual shade path, array and inverter design, generation data and fault records; there is no universal component-response rule in those reviewed facts. Compare same-timestamp array, MPPT, string or module data where the installed monitoring exposes it, then have the installer verify the exact wiring and equipment rather than opening connectors or moving rooftop equipment.",
      status: "needs_context",
      citations: officialCitationsById(["energy-gov-solar-consumer-guide", "energy-gov-solar-system-maintenance"]),
      confidence: "medium",
      practicalSteps: ["Record when and where shade crosses each array section.", "Compare string, MPPT or module data at matching clear-sky times.", "Have the installer test persistent mismatch or fault indications."],
      toolActions: [],
      suggestedQuestions: ["When does the shade occur, and what exact array, MPPT, string or module data does the installed monitoring expose?"],
    });
  }

  if (/\b(?:product|equipment|manufacturer)\s+warrant(?:y|ies)\b/i.test(query)
    && /\b(?:labou?r|workmanship|installer|installation)\s+warrant(?:y|ies)\b/i.test(query)) {
    return structured("products_ratings", {
      directAnswer:
        "A product warranty covers the manufacturer's stated equipment defects and remedies; an installer or workmanship warranty covers the installation work and its stated defects. They can have different responsible parties, terms, exclusions, call-out or removal costs and durations, while Australian Consumer Law guarantees may also apply independently. Require both in writing with the exact legal entity, response path, parts and labour coverage, transport or refrigerant costs and what happens if the installer or manufacturer exits the market.",
      status: "answered",
      citations: officialCitationsById(["accc-consumer-guarantees", "accc-solar-consumer-rights"]),
      confidence: "high",
      practicalSteps: ["Separate product, labour and statutory rights in the quote.", "Record responsible entities, durations and excluded costs.", "Check the service process before purchase."],
      toolActions: [],
      suggestedQuestions: [],
    });
  }

  if (/(?:\b(?:local|nearby|Australian)\s+(?:service|technicians?|agents?|parts?|support)\b|\blocal\b[^.\n]{0,45}\b(?:service|technicians?|parts?|support)\b|\bspare parts?\b|\bservice response\b|\bparts availability\b)/i.test(query)
    && /\b(?:heat[- ]?pump|air conditioner|hot[- ]?water|battery|inverter|equipment|product)\b/i.test(query)) {
    return structured("products_ratings", {
      directAnswer:
        "Local service and parts are material selection criteria because a high-efficiency product can still leave the home without heating, cooling or hot water while diagnosis, parts or warranty approval are delayed. Verify who provides local authorised service, normal response times, stocked critical parts, labour and travel charges, refrigerant or tank replacement responsibilities, warranty escalation and support if the installer stops trading. Do not treat a national phone number or approved-register entry as proof of local support.",
      status: "needs_context",
      citations: officialCitationsById(["accc-consumer-guarantees", "energy-rating-product-register"]),
      confidence: "medium",
      practicalSteps: ["Obtain named local service contacts and written response terms.", "Confirm critical parts and labour coverage.", "Check escalation if installer or supplier exits."],
      toolActions: [],
      suggestedQuestions: ["Who is the authorised service provider for the installation postcode and what response and parts terms are written?"],
    });
  }

  if (/\b(?:approved|eligible|listed|on (?:the )?(?:CER|GEMS|scheme|programme) register)\b/i.test(query)
    && /\b(?:reliable|reliability|quiet|noise|quality|best|good|warranty|installer|service)\b/i.test(query)
    && /\b(?:heat pump|HPHW|HPWH|air conditioner|battery|inverter|solar water heater|product|model)\b/i.test(query)) {
    return structured("products_ratings", {
      directAnswer:
        "No. An approved or eligible register entry proves only the register's stated eligibility or regulatory fact for the exact model and date. It does not prove reliability, low noise, site suitability, installer quality, warranty response, local parts or overall value. Verify the register entry, then assess delivered capacity, climate performance, noise, installation design, warranty and service independently.",
      status: "answered",
      citations: officialCitationsById(["energy-rating-product-register", "cer-swh-ashp-register", "accc-consumer-guarantees"]),
      confidence: "high",
      practicalSteps: ["Verify exact model and applicable date.", "Compare site performance and installation scope.", "Check warranty, service and parts separately."],
      toolActions: [],
      suggestedQuestions: [],
    });
  }

  if (/\b(?:heat[- ]?pump (?:clothes )?dryer|heat pump tumble dryer|clothes dryer)\b/i.test(query)) {
    return structured("products_ratings", {
      directAnswer:
        "A heat-pump clothes dryer is a separate appliance decision from heat-pump hot water. Compare the exact dryer's Energy Rating annual kWh on a like-sized load, cycle time, moisture sensing, low-temperature fabric care, condenser and filter cleaning, drain or tank arrangement, room temperature limits, noise, product and labour warranty, service and complete purchase cost. Use household drying frequency to convert the label or measured cycle energy into annual cost; air-drying remains the lowest-energy option when practical and moisture is managed.",
      status: "needs_context",
      citations: officialCitationsById(["energy-gov-energy-rating", "accc-consumer-guarantees"]),
      confidence: "medium",
      practicalSteps: ["Compare like-sized Energy Rating figures and cycle times.", "Multiply cycle or annual kWh by actual use and tariff.", "Check cleaning, drainage, warranty and service."],
      toolActions: [],
      suggestedQuestions: ["How many dryer loads per week, what load size and what electricity rate should be used?"],
    });
  }

  const applianceAnnualValues = [...query.matchAll(/\b([\d,]+(?:\.\d+)?)\s*kWh\s*(?:\/|per)?\s*(?:year|yr|annum)\b/gi)]
    .map((match) => Number(match[1].replaceAll(",", "")))
    .filter((value) => Number.isFinite(value) && value >= 0);
  const applianceAnnualKwhA = numericCapture(query, /\b(?:fridge|freezer|appliance)\s*[Aa1][^\d$]{0,25}([\d,]+(?:\.\d+)?)\s*kWh\s*(?:\/|per)?\s*(?:year|yr|annum)/i)
    ?? (applianceAnnualValues.length >= 2 && /\b(?:fridge|freezer|refrigerator|appliance)\b/i.test(query) ? applianceAnnualValues[0] : null);
  const applianceAnnualKwhB = numericCapture(query, /\b(?:fridge|freezer|appliance)\s*[Bb2][^\d$]{0,25}([\d,]+(?:\.\d+)?)\s*kWh\s*(?:\/|per)?\s*(?:year|yr|annum)/i)
    ?? numericCapture(query, /\b(?:fridge|freezer|appliance)?\s*[Bb2]\b[^\d$]{0,30}([\d,]+(?:\.\d+)?)(?:\s*kWh\s*(?:\/|per)?\s*(?:year|yr|annum))?/i)
    ?? (applianceAnnualValues.length >= 2 && /\b(?:fridge|freezer|refrigerator|appliance)\b/i.test(query) ? applianceAnnualValues[1] : null);
  const applianceTariff = numericCapture(query, /\$\s*(\d+(?:\.\d+)?)\s*(?:\/|per)\s*kWh/i)
    ?? (() => { const cents = numericCapture(query, /\b(\d+(?:\.\d+)?)\s*(?:c|cents?)\s*(?:\/|per)\s*kWh/i); return cents === null ? null : cents / 100; })();
  if (applianceAnnualKwhA !== null && applianceAnnualKwhB !== null && applianceTariff !== null) {
    const energyDelta = Math.abs(applianceAnnualKwhA - applianceAnnualKwhB);
    const moneyDelta = energyDelta * applianceTariff;
    return structured("products_ratings", {
      directAnswer:
        `The supplied annual energy difference is ${energyDelta.toLocaleString("en-AU", { maximumFractionDigits: 2 })} kWh/year. At $${applianceTariff.toLocaleString("en-AU", { maximumFractionDigits: 3 })}/kWh, that is $${moneyDelta.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} per year. Compare products of similar usable size and function, and keep purchase price, food-loss risk, noise, warranty and expected life separate from this label-energy arithmetic.`,
      status: "answered",
      citations: officialCitationsById(["energy-gov-energy-rating"]),
      confidence: "high",
      practicalSteps: ["Verify both label figures use the same annual basis and comparable capacity.", "Use the complete marginal electricity rate for the intended comparison."],
      toolActions: [],
      suggestedQuestions: [],
    });
  }

  const continuousWatts = numericCapture(query, /\b(\d+(?:\.\d+)?)\s*W(?:atts?)?\b/i);
  if (continuousWatts !== null && /\b(?:24\s*\/\s*7|all year|year[- ]round|continuously|constant|always[- ]on|standby|365 days?|in (?:one|a) year)\b/i.test(query)) {
    const annualKwh = continuousWatts * 24 * 365 / 1000;
    return structured("products_ratings", {
      directAnswer:
        `A constant ${continuousWatts.toLocaleString("en-AU")} W load uses about ${annualKwh.toLocaleString("en-AU", { maximumFractionDigits: 1 })} kWh a year: ${continuousWatts} W × 24 hours × 365 days ÷ 1,000. Multiply that by the applicable $/kWh to estimate energy cost. Verify the load with a suitable meter over representative operation because cycling and standby states can make the nameplate figure differ from actual average power.`,
      status: "answered",
      citations: officialCitationsById(["energy-gov-reduce-energy-bills", "energy-gov-energy-rating"]),
      confidence: "high",
      practicalSteps: ["Measure representative average power and operating hours.", "Apply the complete relevant energy rate."],
      toolActions: [],
      suggestedQuestions: [],
    });
  }

  if (/\b(?:300\s*(?:L|litre)|three hundred litre)\b/i.test(query)
    && /\b(?:heat[- ]?pump|HPHW|HPWH|hot[- ]?water)\b/i.test(query)
    && /\b(?:four|4)\s+(?:people|person|occupants?|household)\b/i.test(query)) {
    return structured("heat_pump_hot_water", {
      directAnswer:
        "A 300 L heat-pump water heater is not automatically suitable or unsuitable for four people. Tank volume is only stored energy: peak shower and bath draw, usable delivery temperature and tempering, heat-pump recovery rate at the cold local design condition, resistive boost, tariff or solar heating window, consecutive use, installation space, noise and outage tolerance determine whether it recovers in time. Size from the household's peak-hour draw and recovery window, then verify the exact model's cold-condition recovery and electrical or plumbing design.",
      status: "needs_context",
      citations: officialCitationsById(["energy-gov-smart-hot-water", "cer-swh-ashp-register"]),
      confidence: "medium",
      practicalSteps: ["Estimate peak consecutive hot-water draw, not only daily litres.", "Check usable volume and cold-condition recovery for the exact model.", "Match controls to the tariff or solar window and site."],
      toolActions: [],
      suggestedQuestions: ["How many consecutive showers or baths occur at the peak, and what climate, tariff window and installation space apply?"],
    });
  }

  if (/(?:\b(?:upstairs|upper floor|top floor|upper storey|top storey|upper level|top level|bedroom|room)\b[\s\S]{0,90}\b(?:oven|roasting|hot|heat)\b|\b(?:oven|roasting|hot)\b[\s\S]{0,90}\b(?:upstairs|upper floor|top floor|upper storey|top storey|upper level|top level|bedroom|room)\b)/i.test(query)
    && /\b(?:after sunset|after dark|at night|10\s*pm|midnight|outside|outdoor|night air)\b/i.test(query)
    && /\b(?:cool|cooler|holding|stored|hours?|still)\b/i.test(query)) {
    return structured("comfort_fabric", {
      directAnswer:
        "The upper floor can stay hot after the outdoor air cools because the roof, walls, floors and furnishings absorbed daytime heat and release it later, while buoyant warm air remains trapped by limited cross-flow upstairs. West sun, a hot roof space and patchy ceiling insulation can extend that lag. Shade the daytime gains first, then use cooler outdoor air only when it is genuinely cooler and smoke, humidity, noise and security make opening safe.",
      status: "needs_context",
      citations: officialCitationsById(["yourhome-passive-cooling", "yourhome-thermal-mass", "yourhome-insulation"]),
      confidence: "medium",
      assumptions: ["The orientation, roof and wall build-up, insulation, surface temperatures and safe night-air path have not been checked."],
      practicalSteps: [
        "Record outdoor, downstairs and upstairs temperatures from late afternoon until bedtime and note which surfaces stay hottest.",
        "Block direct sun before it reaches the building and check accessible ceiling-insulation continuity.",
        "When outside air is cooler and safe, create an inlet and outlet path and use a fan across occupied people or to support that purge.",
      ],
      toolActions: [{ id: "open-home-plan", label: "Build a summer heat plan", href: "/plan" }],
      suggestedQuestions: ["Which direction faces the hottest rooms, what is directly above them, and can cooler air safely enter and leave at night?"],
    });
  }

  if (/\b(?:concrete|masonry|thermal mass)\b/i.test(query)
    && /\b(?:tropical|warm humid|hot humid|humid[- ]climate)\b/i.test(query)
    && /\b(?:cool|cooler|cooling|good|help|always|add|adding)\b/i.test(query)) {
    return structured("comfort_fabric", {
      directAnswer:
        "No. Adding indoor concrete does not automatically cool a tropical home. Thermal mass stores heat; it helps only when unwanted sun is excluded and the mass can reliably release heat to cooler air before the next hot period. In a warm humid climate with warm nights or continuous occupancy, extra unshaded mass can retain unwanted heat. Prioritise external shade, a climate-appropriate roof and insulation, controlled air movement and moisture-safe ventilation before adding mass.",
      status: "needs_context",
      citations: officialCitationsById(["yourhome-thermal-mass", "yourhome-design-for-climate", "yourhome-passive-cooling"]),
      confidence: "high",
      assumptions: ["The site's night temperatures, humidity, shade, insulation boundary and occupancy schedule have not been modelled."],
      practicalSteps: [
        "Check whether nights are reliably cooler and whether the proposed mass can be shaded and purged.",
        "Reduce roof, wall and window solar gain before changing the mass.",
        "Model the mass inside the complete climate-specific envelope rather than treating concrete as an isolated product.",
      ],
      toolActions: [{ id: "open-home-plan", label: "Plan climate-specific fabric", href: "/plan" }],
      suggestedQuestions: ["What postcode, night temperature and humidity pattern, shade and occupancy schedule apply?"],
    });
  }

  if (/\b(?:weatherboard|timber[- ]clad|lightweight)\b/i.test(query)
    && /\bwall\b/i.test(query)
    && /\b(?:west|western|afternoon sun|late sun)\b/i.test(query)
    && /\b(?:hot|heat|heats|heating|warm|touch|surface)\b/i.test(query)) {
    return structured("comfort_fabric", {
      directAnswer:
        "The west wall is being heated by low-angle afternoon solar radiation. A lightweight weatherboard surface can heat quickly, and weak insulation, an ineffective cavity or air leakage can let that gain reach the room. Start with safe external shade because it stops radiation before the cladding heats; then verify the complete wall build-up, insulation continuity, cavity and indoor surface-temperature pattern before specifying a retrofit.",
      status: "needs_context",
      citations: officialCitationsById(["yourhome-shading", "yourhome-insulation", "yourhome-construction-systems"]),
      confidence: "medium",
      assumptions: ["The cladding colour, cavity, insulation, air leakage, moisture condition and internal temperatures have not been inspected."],
      practicalSteps: [
        "Record when sun reaches the wall and compare its surface with a shaded wall.",
        "Test safe external shade that preserves ventilation, drainage, access and fire clearances.",
        "Have the complete wall assembly assessed before adding concealed insulation or new cladding layers.",
      ],
      toolActions: [{ id: "open-home-plan", label: "Map the west-wall heat gain", href: "/plan" }],
      suggestedQuestions: ["What colour and build-up does the west wall have, and is the room hottest while the sun is on it or hours later?"],
    });
  }

  if (/\bfan\b/i.test(query)
    && /\b(?:empty|nobody|no one|unoccupied|all day|before I get home|furniture|room air)\b/i.test(query)
    && /\b(?:cool|cooler|colder|temperature|leave|left|run|runs|running)\b/i.test(query)) {
    return structured("comfort_fabric", {
      directAnswer:
        "No. A normal recirculating fan mainly cools an occupied person by increasing air movement and evaporation; it does not refrigerate the room air, cool an empty room or pre-cool furniture. With nobody present it adds a small amount of motor heat, so turn it off unless it is deliberately moving genuinely cooler outdoor air through a safe inlet and outlet or serving another designed ventilation need.",
      status: "answered",
      citations: officialCitationsById(["yourhome-passive-cooling"]),
      confidence: "high",
      assumptions: ["This is a recirculating household fan, not a designed exhaust, whole-house or supply-air system."],
      practicalSteps: [
        "Use the fan across occupied people for comfort.",
        "Turn it off in an empty closed room.",
        "Reduce solar gain and ventilate only when outdoor air is cooler and safe.",
      ],
      toolActions: [],
      suggestedQuestions: ["Is the goal personal comfort or moving cooler outdoor air through the home?"],
    });
  }

  if (/\b(?:SHGC|solar heat gain coefficient|solar heat gain|solar[- ]gain (?:glass|glazing)|high[- ]gain (?:glass|glazing)|low[- ]gain (?:glass|glazing))\b/i.test(query)
    && /\b(?:north|northern|north[- ]facing)\b/i.test(query)
    && /\b(?:Hobart|Tasmania|Tasmanian|cold climate|cool climate|winter sun|glazing|glass|window)\b/i.test(query)) {
    return structured("glazing_shading", {
      directAnswer:
        "Do not choose universally low or high SHGC for north-facing glass. In a cool climate, a higher SHGC can admit useful winter sun where solar access is reliable, but the result also depends on whole-window U-value, frame performance, glazing area, room mass, summer and shoulder-season shading, nearby obstructions and overheating risk. Select SHGC and U-value together from a model of the complete window, orientation and shade, not from climate or one headline number alone.",
      status: "needs_context",
      citations: officialCitationsById(["yourhome-glazing", "yourhome-passive-heating", "yourhome-shading"]),
      confidence: "medium",
      assumptions: ["The exact window orientation, area, U-value, frame, shade, obstructions and room thermal mass have not been supplied."],
      practicalSteps: [
        "Verify true orientation, winter solar access and glazing area.",
        "Compare whole-window U-value and SHGC together with the frame and installation.",
        "Model fixed summer shade and winter gain before choosing the glazing.",
      ],
      toolActions: [{ id: "open-home-plan", label: "Model the glazing and shade", href: "/plan" }],
      suggestedQuestions: ["What is the exact orientation, window area, whole-window U-value, proposed SHGC and external shading geometry?"],
    });
  }

  if ((/\b(?:thermal camera|thermal image|infrared|thermograph)\b/i.test(query)
      || /\b(?:cold|cool|hot|heat)\s+(?:stripe|stripes|line|lines|band|bands)|\b(?:stripe|stripes|line|lines|band|bands)\b[\s\S]{0,35}\b(?:cold|cool|hot|heat)\b/i.test(query))
    && /\b(?:metal|steel)[- ]+(?:stud|studs|frame|framing)|\bstuds?\b/i.test(query)) {
    return structured("insulation", {
      directAnswer:
        "Cold stripes aligned with metal studs are consistent with thermal bridging: the conductive framing bypasses insulation between the studs. Adding more batts only in the cavities may leave the repeating bridge in place. Verify the pattern against framing, moisture and air leakage, then assess a compatible continuous insulation or thermal-break layer and every junction, condensation and fire detail as one wall system.",
      status: "needs_context",
      citations: officialCitationsById(["yourhome-insulation", "yourhome-construction-systems", "ncc-condensation-handbook"]),
      confidence: "medium",
      assumptions: ["A thermal image alone cannot distinguish framing conduction from moisture, air leakage or another concealed defect."],
      practicalSteps: [
        "Compare the stripe spacing with known framing and inspect for moisture and air leakage.",
        "Document indoor and outdoor temperatures and camera settings before treating the image quantitatively.",
        "Assess a continuous layer and junction details rather than specifying cavity batts alone.",
      ],
      toolActions: [{ id: "open-insulation-guide", label: "Open the insulation guide", href: "/guides/insulation-draught-proofing" }],
      suggestedQuestions: ["Do the stripe spacing and wall plans align with metal studs, and is there any dampness or air leakage at the same locations?"],
    });
  }

  if (/\b(?:subfloor|underfloor|under[- ]floor|crawl ?space|floor joists?|beneath the floor)\b/i.test(query)
    && /\b(?:damp|wet|moist|moisture|mould|mold|water|leak)\b/i.test(query)
    && /\b(?:insulation|batts?|insulate)\b/i.test(query)) {
    return structured("insulation", {
      directAnswer:
        "Do not install or enclose subfloor batts while the floor, joists or crawl space are damp. Insulation can conceal the source and slow drying, increasing timber, mould and indoor-air risks. Identify and correct leaks, drainage, ground moisture and ventilation first, verify that the timber has dried to an acceptable condition, then select an underfloor system that remains securely supported and compatible with the floor and moisture pathway.",
      status: "needs_context",
      citations: officialCitationsById(["yourhome-insulation", "yourhome-ventilation-airtightness", "ncc-condensation-handbook"]),
      confidence: "high",
      assumptions: ["The moisture source, timber condition, ground cover, drainage and subfloor ventilation have not been inspected."],
      practicalSteps: [
        "Stop insulation work and trace plumbing, rainwater, drainage and ground-moisture sources.",
        "Repair the source and verify drying and subfloor ventilation before covering the structure.",
        "Choose and document the insulation support and moisture-safe assembly only after that check.",
      ],
      toolActions: [{ id: "open-insulation-guide", label: "Open the insulation guide", href: "/guides/insulation-draught-proofing" }],
      suggestedQuestions: ["Is the moisture from a plumbing leak, rain or drainage, ground evaporation, condensation, or an unknown source?"],
    });
  }

  if (/\b(?:cool roof|white roof|roof\s+(?:painted\s+)?white|paint(?:ing|ed)?\s+(?:a|the)?\s*roof\s+white|light[- ]colou?red roof|reflective(?:\s+cool)? roof|high[- ]reflectance roof)\b/i.test(query)
    && /\b(?:always|every (?:Australian )?climate|all climates|same annual benefit|same benefit|lower (?:annual )?bills?|save money|best|worth|heating|cooling|winter|summer|Darwin|Tasmania|alpine)\b/i.test(query)) {
    return structured("comfort_fabric", {
      directAnswer:
        "No roof colour or reflectance is universally best. A light or cool roof can reduce absorbed summer solar heat and cooling load, but the bill result depends on climate, winter heating, roof insulation, roof-space ventilation, solar exposure, ceiling airtightness and the home's heating and cooling use. Compare annual heating and cooling together, plus glare, planning and roof-condition constraints, rather than promising that a white roof will always lower bills.",
      status: "needs_context",
      citations: officialCitationsById(["yourhome-passive-cooling", "yourhome-design-for-climate", "yourhome-insulation"]),
      confidence: "medium",
      assumptions: ["The climate, roof assembly, insulation, heating and cooling loads, roof condition and planning constraints have not been assessed."],
      practicalSteps: [
        "Check local summer and winter loads and the existing roof and ceiling insulation.",
        "Compare annual heating and cooling effects, not roof-surface temperature alone.",
        "Specify colour, coating and roof repairs within the complete climate and building design.",
      ],
      toolActions: [{ id: "open-home-plan", label: "Compare the roof options", href: "/plan" }],
      suggestedQuestions: ["What postcode, roof material and colour, ceiling insulation and annual heating and cooling pattern apply?"],
    });
  }

  if (/\b(?:NatHERS|whole[- ]of[- ]home|whole[- ]home|home energy rating|star rating|official rating)\b/i.test(query)
    && /\b(?:actual bills?|real bills?|electricity bills?|gas bills?|tariffs?|weather|occupant hours?|family schedule|household schedule|portable heaters?|plug loads?|plug[- ]in appliances?|actual use|real use|behavio[u]?r)\b/i.test(query)) {
    return structured("nathers", {
      directAnswer:
        "An official NatHERS result uses the scheme's standardised climate, occupancy and operating assumptions so dwellings can be compared consistently. Whole-of-home adds defined fixed appliances, on-site generation and storage, but it does not insert this family's actual occupant hours, portable heaters, general plug loads, retail tariff, current weather or measured bill. Use those real household inputs in a separate bill and operational analysis; do not describe the rating as a bill prediction.",
      status: "answered",
      citations: officialCitationsById(["nathers-certificate", "nathers-technical-note", "nathers-guidance-note"]),
      confidence: "high",
      assumptions: ["The question concerns the official NatHERS basis rather than a private bill-calibration model."],
      practicalSteps: [
        "Keep the certificate's standardised rating inputs separate from measured household operation.",
        "Use actual bills, tariffs, weather, plug loads and schedules in a separate analysis.",
        "Explain differences without changing accredited inputs to mimic one household.",
      ],
      toolActions: [{ id: "open-assessments", label: "Open the rating pathway", href: "/assessments" }],
      suggestedQuestions: ["Are you interpreting the official rating or reconciling it with a particular household's measured bill?"],
    });
  }

  if (/\b(?:renovat(?:e|ion|ing)|refurbish|alteration|remodel|fit[- ]out)\b/i.test(query)
    && /\b(?:one|single|a|small)\s+(?:room|bedroom|bathroom|kitchen)|\bpart of (?:the )?(?:home|house|building)\b/i.test(query)
    && /\b(?:NCC|National Construction Code|current code|building code|whole (?:existing )?(?:home|house)|entire (?:home|house))\b/i.test(query)) {
    return structured("comfort_fabric", {
      directAnswer:
        "No. Renovating one room does not automatically mean the whole existing dwelling must be rebuilt to every current NCC provision, and it does not automatically exempt the work either. The applicable NCC edition, state or territory adoption, building classification, approval pathway, alteration scope and any triggered upgrade requirements must be confirmed by the relevant approval authority or building surveyor before design and quoting.",
      status: "needs_context",
      citations: officialCitationsById(["ncc-existing-home-renovations", "ncc-current-edition-jurisdiction"]),
      confidence: "high",
      assumptions: ["The jurisdiction, approval category, building classification and exact structural, fabric and services work are unknown."],
      practicalSteps: [
        "Define the exact room, elements and services being altered.",
        "Confirm the jurisdiction's adopted NCC edition and approval pathway.",
        "Get the written scope of any triggered existing-building upgrades before quoting.",
      ],
      toolActions: [],
      suggestedQuestions: ["Which state or territory, room and exact building or services work are proposed, and what approval pathway has been identified?"],
    });
  }

  if (/\b(?:builder|building contractor|architect|designer|consultant)\b/i.test(query)
    && /\b(?:issue|sign|certify|provide|prepare|give)\b/i.test(query)
    && /\b(?:NatHERS|official (?:existing[- ]home |home )?energy rating|accredited (?:existing[- ]home |home )?energy rating|rating certificate|energy certificate)\b/i.test(query)) {
    return structured("nathers", {
      directAnswer:
        "No. Builder, architect or designer status alone does not authorise someone to issue an official NatHERS rating or certificate. The relevant current accreditation or authorisation, approved software, evidence method and complete dwelling assessment are required. A builder can supply plans, specifications and construction evidence, but the authorised accredited assessor remains responsible for the rating record and certificate.",
      status: "answered",
      citations: officialCitationsById(["nathers-existing-homes", "nathers-certificate", "nathers-technical-note"]),
      confidence: "high",
      assumptions: ["No separate current assessor accreditation or authorisation has been verified for the proposed issuer."],
      practicalSteps: [
        "Check the proposed issuer's current assessor accreditation or authorisation.",
        "Keep builder-supplied plans and evidence separate from assessor responsibility.",
        "Use the approved software and certificate pathway for the complete dwelling.",
      ],
      toolActions: [{ id: "open-assessments", label: "Open the accredited assessment pathway", href: "/assessments" }],
      suggestedQuestions: ["What current assessor accreditation or authorisation does the proposed certificate issuer hold?"],
    });
  }

  if (/\b(?:online|web|digital)\s+(?:questionnaire|survey|quiz|form)\b/i.test(query)
    && /\b(?:accredited|official|certificate|certification|rating|assessment|inspection|assessor)\b/i.test(query)
    && /\b(?:home|house|dwelling|property|energy|thermal|whole[- ]of[- ]home)\b/i.test(query)) {
    return structured("nathers", {
      directAnswer:
        "No. An online questionnaire cannot issue or replace an official NatHERS rating. It can collect preliminary facts, but it cannot replace the accredited existing-home inspection, evidence assessment, approved software modelling and whole-dwelling record required for an official NatHERS certificate. Use it to prepare documents and questions only. Concealed or inaccessible inputs must remain evidenced, unknown or defaulted under the current accredited method rather than being inferred from an owner's answers.",
      status: "answered",
      citations: officialCitationsById(["nathers-certificate", "nathers-technical-note", "nathers-guidance-note"]),
      confidence: "high",
      assumptions: ["The question concerns an official Australian existing-home energy rating rather than a private advice survey."],
      practicalSteps: [
        "Use the questionnaire only to prepare property, construction and equipment records.",
        "Engage the current accredited existing-home pathway for inspection, evidence and software modelling.",
        "Record inaccessible or conflicting inputs under the current method instead of inventing values.",
      ],
      toolActions: [{ id: "open-assessments", label: "Open the assessment pathway", href: "/assessments" }],
      suggestedQuestions: ["Do you need an official certificate or a non-certificate diagnostic plan?"],
    });
  }

  const claimedConcealedRValue = query.match(/\bR\s*[- ]?(\d+(?:\.\d+)?)\b/i)?.[1];
  if (/\b(?:roof|ceiling|attic)(?:\s+(?:cavity|space|void|insulation))?|\b(?:roof|ceiling)\s+void\b|\bhidden ceiling insulation\b/i.test(query)
    && /\b(?:inaccessible|cannot access|can't access|could not (?:access|enter|see)|couldn't (?:access|enter|see)|cannot be accessed|can't be accessed|cannot see|can't see|no one can see|not visible|sealed|no access|closed off|access is impossible|impossible to access)\b/i.test(query)
    && /\b(?:assessor|assessment|rating|certificate|assume|enter|record|use|evidence|R\s*[- ]?\d)\b/i.test(query)) {
    const claimedValue = claimedConcealedRValue ? `R${claimedConcealedRValue}` : "a claimed R-value";
    return structured("nathers", {
      directAnswer:
        `No. An accredited assessor cannot assign ${claimedValue}, or any other concealed insulation value, only from an owner or verbal claim. Tie plans, specifications, invoices or dated construction photos to that exact roof element where possible. If the cavity remains inaccessible and the value cannot be verified, record it as inaccessible or unknown and apply the current Technical Note, Guidance Note and software default rather than inventing coverage or R-value.`,
      status: "needs_context",
      citations: officialCitationsById(["nathers-technical-note", "nathers-guidance-note"]),
      confidence: "high",
      assumptions: ["No property-specific approved plan, dated installation record, construction image or permitted access has been verified."],
      practicalSteps: [
        "Link every available plan, invoice or construction photo to the exact roof area and date.",
        "Record the access limitation and any conflicting evidence explicitly.",
        "Use the current accredited unknown or default treatment for the unresolved input.",
      ],
      toolActions: [{ id: "open-assessments", label: "Open the assessment pathway", href: "/assessments" }],
      suggestedQuestions: ["What dated plans, invoices or construction photos can be tied to that exact roof area?"],
    });
  }

  if (/\bwhole[- ]of[- ]home\s+(?:rating|score|assessment)|\bwhole[- ]home\s+(?:rating|score|assessment)/i.test(query)
    && /\b(?:plug loads?|plug[- ]in appliances?|actual(?:ly)? use|behavio[u]?r|occupant|bill|usage)\b/i.test(query)) {
    return structured("nathers", {
      directAnswer:
        "The whole-of-home rating assesses defined fixed equipment and on-site energy inputs under the scheme's standard assumptions. It is not a prediction of how the occupants will actually use every plug-in appliance and it is not a bill forecast. Keep measured plug loads, schedules, thermostat choices and household behaviour as a separate operational layer when turning the certificate into advice.",
      status: "answered",
      citations: officialCitationsById(["nathers-certificate", "nathers-technical-note", "nathers-guidance-note"]),
      confidence: "high",
      assumptions: ["The question concerns a current NatHERS whole-of-home result, not a private appliance audit or another state rating tool."],
      practicalSteps: [
        "Read the certificate's assessed fixed systems and standard assumptions.",
        "Measure actual plug loads, schedules and bills separately.",
        "Explain any difference without altering the accredited rating inputs to mimic one household's behaviour.",
      ],
      toolActions: [{ id: "open-assessments", label: "Open the rating pathway", href: "/assessments" }],
      suggestedQuestions: ["Are you interpreting a certificate or trying to explain a difference between the rating and measured bills?"],
    });
  }

  if (/\b(?:rent|rental|renter|tenant|lease)\b/i.test(query)
    && /\b(?:magnetic|removable|clip[- ]on|temporary)\b/i.test(query)
    && /\bsecondary glazing\b/i.test(query)) {
    return structured("renters_strata", {
      directAnswer:
        "A removable magnetic secondary-glazing panel can reduce air leakage and heat flow through some rental windows, but it is not automatically suitable or equivalent to tested double glazing. Check written permission and the exact glass, frame, opening, egress, condensation, drainage, thermal-stress and residue risks. Test one window, keep it removable and stop if moisture, glass stress, blocked operation or surface damage appears.",
      status: "needs_context",
      citations: officialCitationsById(["energy-gov-renters", "energy-gov-windows", "yourhome-glazing"]),
      confidence: "medium",
      assumptions: ["The lease, glass type, frame, egress, drainage and moisture pattern have not been checked."],
      practicalSteps: [
        "Get written permission and confirm the product suits the exact glass and frame.",
        "Keep window operation, egress, drainage and required ventilation clear.",
        "Trial one panel and monitor surface temperature, condensation and residue before expanding it.",
      ],
      toolActions: [{ id: "open-home-plan", label: "Plan a renter-safe window test", href: "/plan" }],
      suggestedQuestions: ["What glass, frame, opening and condensation pattern does the window have, and has the owner approved a removable panel?"],
    });
  }

  if (/\b(?:body corporate|owners corporation|strata committee)\b/i.test(query)
    && /\bcharg(?:er|ing)\b/i.test(query)
    && /\b(?:refuse|refused|reject|ban|deny|denied|every|all)\b/i.test(query)) {
    return structured("renters_strata", {
      directAnswer:
        "Do not assume either a blanket right to install or a blanket right to refuse. The owners-corporation process and review options depend on the state or territory, scheme rules and common property. A useful proposal should identify the parking bay and cable route, shared electrical capacity, fire and access controls, metering and cost allocation, future demand and a load-management design. Seek the formal written decision and current jurisdiction-specific strata advice if it is refused.",
      status: "needs_context",
      citations: officialCitationsById(["energy-gov-strata-personal-ev-charger", "energy-gov-ev-home-strata-charging"]),
      confidence: "medium",
      assumptions: ["The jurisdiction, title, by-laws, common-property route, supply study and formal decision have not been reviewed."],
      practicalSteps: [
        "Obtain the current by-laws, application process and building electrical-capacity information.",
        "Submit a licensed concept covering cable route, protection, metering, cost allocation and scalable load management.",
        "Request a formal written decision and use the current jurisdictional review or advice pathway rather than relying on a verbal refusal.",
      ],
      toolActions: [{ id: "open-ev-guide", label: "Open the strata EV guide", href: "/guides/ev-charging" }],
      suggestedQuestions: ["Which state or territory, parking title, common-property route and written refusal apply?"],
    });
  }

  if (/\b(?:own|owner|apartment|unit|strata)\b/i.test(query)
    && /\b(?:balcony|common property|external wall|roof)\b/i.test(query)
    && /\b(?:heat[- ]?pump hot[- ]?water|hot[- ]?water heat[- ]?pump|HPHW|HPWH|water heater)\b/i.test(query)
    && /\b(?:approvals?|permissions?|before quoting|before pricing|before quote|quote|pricing|install)\b/i.test(query)) {
    return structured("renters_strata", {
      directAnswer:
        "Get the approval pathway clear before treating a balcony heat-pump water heater as quote-ready. Check owners-corporation or body-corporate approval and by-laws, structural loading and attachment, appearance and common property, noise, condensate and drainage, plumbing, electrical supply, safe service access, planning or building controls and any network or metering work. A licensed site assessment must still confirm that the selected location and complete system are feasible.",
      status: "needs_context",
      citations: officialCitationsById(["energy-gov-smart-hot-water"]),
      confidence: "medium",
      assumptions: ["The jurisdiction, title boundary, by-laws, structure, services, noise limits and planning controls have not been reviewed."],
      practicalSteps: [
        "Map the title and common-property boundary and obtain the current written approval process.",
        "Commission a site concept covering structure, noise, condensate, plumbing, electrical work and service access.",
        "Seek the required owners-corporation and regulatory approvals before accepting a final quote or starting work.",
      ],
      toolActions: [{ id: "open-home-plan", label: "Plan the apartment hot-water upgrade", href: "/plan" }],
      suggestedQuestions: ["Which state or territory, balcony title boundary, existing hot-water system and owners-corporation process apply?"],
    });
  }

  if (/(?:\b(?:rent|rental|renter|tenant|landlord|lease)\b|\b(?:cannot|can't|no)\s+(?:drill|glue|change (?:the )?fa[cç]ade|make permanent changes?)\b)/i.test(query)
    && /\b(?:west|western|afternoon sun)\b/i.test(query)
    && /\b(?:bedroom|room|window)\b/i.test(query)
    && /\b(?:summer|hot|heat|cool|cooling|unbearable|overheat|boiling)\b/i.test(query)
    && /\b(?:no permanent changes?|cannot make permanent|can't make permanent|not allowed to alter|no alterations?|without fixed alterations?|removable|temporary|cannot drill|can't drill|no[- ]drill|cannot glue|can't glue|no glue|cannot change (?:the )?fa[cç]ade|can't change (?:the )?fa[cç]ade|no fa[cç]ade changes?)\b/i.test(query)) {
    return structured("renters_strata", {
      directAnswer:
        "Use a reversible cooling ladder. Stop the west sun before it reaches the glass with a stable removable external shade only with written permission from the owner or strata and where it is safe; otherwise close a light-coloured close-fitting internal blind or curtain before the sun arrives. Use a fan for occupied-person cooling and purge heat only when outdoor air is cooler and smoke, humidity, noise and security allow. Record the fixed overheating problem for the owner or agent rather than attaching permanent work without approval.",
      status: "needs_context",
      citations: officialCitationsById(["energy-gov-renters", "yourhome-shading", "yourhome-passive-cooling"]),
      confidence: "medium",
      assumptions: ["The glass, existing coverings, safe external fixing points, lease and local heat conditions have not been checked."],
      practicalSteps: [
        "Close existing coverings before the west sun arrives and use a stable fan when the room is occupied.",
        "Use removable external shade only with written permission and a safe design that preserves egress and drainage.",
        "Vent at night only when outdoor conditions are better, and send the owner a dated record if the room remains unsafe or unusable.",
      ],
      toolActions: [{ id: "open-home-plan", label: "Build a renter cooling plan", href: "/plan" }],
      suggestedQuestions: ["What existing blind, curtain, safe opening and owner-approved external shade option does the west window have?"],
    });
  }

  const posedProgrammeJurisdiction = explicitProgramJurisdiction(query);
  if (/\b(?:Victorian|Victoria|VIC)\b/i.test(query)
    && /\b(?:rebate|programme|program|scheme|VEU|Solar Victoria)\b/i.test(query)
    && posedProgrammeJurisdiction
    && !["VIC", "AU"].includes(posedProgrammeJurisdiction[0])) {
    return structured("rebates_certificates", {
      directAnswer:
        `No. A Victorian programme does not apply to an installation property in ${posedProgrammeJurisdiction[1]}. The programme name is not the property's location. Check ${posedProgrammeJurisdiction[1]} and federal pathways separately for the exact applicant, tenure, upgrade and application date, and do not present an unrelated Victorian benefit as available there.`,
      status: "answered",
      citations: officialCitationsById(["energy-gov-rebates"]),
      confidence: "high",
      assumptions: [`The installation property is in ${posedProgrammeJurisdiction[1]} as stated and no separate Victorian property is involved.`],
      practicalSteps: [
        "Use the installation property's jurisdiction, not the programme name or business address.",
        "Filter current local and federal pathways by applicant, tenure, technology and date.",
        "Keep every benefit separate until its administering source confirms the project is eligible.",
      ],
      toolActions: [{ id: "open-rebates", label: "Check the correct jurisdiction", href: "/rebates" }],
      suggestedQuestions: ["What exact upgrade and proposed application or installation date apply at that property?"],
    });
  }

  if (/\b(?:renter|tenant|rental)\b/i.test(query)
    && /\b(?:rebates?|grants?|assistance|programmes?|programs?|schemes?|help)\b/i.test(query)
    && /\b(?:replace|replacing|install|upgrade|alter)\s+(?:absolutely\s+)?nothing\b|\bno\s+(?:replacement|upgrade|installation|alteration|work)\b/i.test(query)) {
    const location = posedProgrammeJurisdiction?.[1] || "the property's jurisdiction";
    return structured("rebates_certificates", {
      directAnswer:
        `No upgrade-specific installation benefit can be identified for a renter in ${location} who is replacing or installing nothing. I will not fill the answer with unrelated solar, EV or owner-only programmes. General bill relief, retailer hardship support or a landlord-delivered upgrade may be separate pathways, but each needs its own current eligibility check and must not be described as a renter installation rebate.`,
      status: "needs_context",
      citations: officialCitationsById(["energy-gov-rebates", "energy-gov-renters"]),
      confidence: "medium",
      assumptions: ["No equipment replacement, fixed alteration or landlord-approved project is proposed."],
      practicalSteps: [
        "Separate immediate bill support from funding for a physical upgrade.",
        "Check current renter and hardship pathways for the supplied jurisdiction without adding unrelated technologies.",
        "If a fixed upgrade is later proposed, confirm owner consent and programme pre-approval before work.",
      ],
      toolActions: [{ id: "open-rebates", label: "Check renter-relevant assistance", href: "/rebates" }],
      suggestedQuestions: ["Is the need immediate bill relief, a landlord-delivered upgrade, or a reversible comfort measure?"],
    });
  }

  if (/\bSTCs?\b/i.test(query)
    && /\b(?:discount|benefit|assignment|quote reduction)\b/i.test(query)
    && /\b(?:cash rebate|government cash|government rebate|cash from government|government payment)\b/i.test(query)) {
    return structured("rebates_certificates", {
      directAnswer:
        "No. An STC benefit is not a universal government cash rebate paid directly to every customer. For an eligible installation, certificates may be created and assigned to a registered agent, and the agent or installer may offer a commercial quote discount based on an estimated certificate value. The quote should show the estimated certificate quantity, stated value, assignment terms and resulting customer price without presenting that commercial amount as guaranteed government cash.",
      status: "answered",
      citations: officialCitationsById(["cer-stc-entitlement-calculation", "cer-small-scale-system-requirements"]),
      confidence: "high",
      assumptions: ["The exact installation, entitlement, assignment contract and quote arithmetic have not been verified."],
      practicalSteps: [
        "Separate certificate quantity from the agent's stated dollar value.",
        "Require the assignment and discount lines to reconcile once to the final customer price.",
        "Verify the current eligibility and quantity before calling the discount available.",
      ],
      toolActions: [{ id: "open-calculator", label: "Check STCs separately", href: "/calculator" }],
      suggestedQuestions: ["What certificate quantity, value per STC, assignment wording and final discount does the quote show?"],
    });
  }

  if (/\b(?:battery|storage)\b/i.test(query)
    && /\b(?:federal|SRES|STCs?|battery discount)\b/i.test(query)
    && /\b(?:installed|commissioned|completed)\b/i.test(query)
    && /\b(?:before|prior to|earlier than)\b/i.test(query)
    && /\b(?:1\s+July\s+2025|01[/-]07[/-]2025|2025-07-01)\b/i.test(query)) {
    return structured("rebates_certificates", {
      directAnswer:
        "No. The federal battery certificate pathway cannot be backdated to a battery installed before its 1 July 2025 commencement. A later application, invoice or module record does not turn an earlier completed installation into a new eligible event. Keep any state incentive, retailer offer and the original installation evidence separate, and do not create federal certificates for that pre-commencement capacity.",
      status: "answered",
      citations: officialCitationsById(["cer-solar-battery-requirements"]),
      confidence: "high",
      assumptions: ["The battery installation and commissioning were completed before 1 July 2025 and no genuinely new eligible post-commencement installation event has been supplied."],
      practicalSteps: [
        "Preserve the original installation and commissioning dates and component records.",
        "Do not re-date, recreate or claim certificates for the earlier installed capacity.",
        "Check any separate later expansion or state benefit against its own current rules and evidence.",
      ],
      toolActions: [{ id: "open-calculator", label: "Check the dated battery pathway", href: "/calculator" }],
      suggestedQuestions: ["Was any genuinely new battery capacity installed and commissioned on or after 1 July 2025, and was the original capacity already claimed?"],
    });
  }

  if (/\bSTCs?\b/i.test(query)
    && /\b(?:(?:state|territory|NSW|VIC|Victoria|QLD|SA|WA|TAS|ACT|NT)\s+(?:cash\s+)?(?:rebate|grant|incentive|discount|programme|program|scheme)|Solar Homes(?:\s+rebate)?|state cash rebate)\b/i.test(query)
    && /\b(?:same|difference|different|separate|instead|versus|vs\.?|also|are|is)\b/i.test(query)) {
    return structured("rebates_certificates", {
      directAnswer:
        "No. STCs and a state or territory rebate are separate benefit types with separate rules. STCs are certificates created for an eligible installation and may be assigned for a commercial quote discount; a state rebate is governed by that programme's applicant, property, product, timing and application rules. Calculate and disclose each line separately, then check both current rules for stacking and eligible-cost limits before combining them.",
      status: "needs_context",
      citations: officialCitationsById(["cer-stc-entitlement-calculation", "energy-gov-rebates"]),
      confidence: "high",
      assumptions: ["The exact state programme, installation, dates and stacking clauses have not been supplied."],
      practicalSteps: [
        "Name the exact state programme and the STC-eligible technology separately.",
        "Verify each current eligibility and application sequence before purchase or installation.",
        "Reconcile both benefits once on the quote without double counting.",
      ],
      toolActions: [{ id: "open-rebates", label: "Check the two pathways", href: "/rebates" }],
      suggestedQuestions: ["Which exact state programme, technology and proposed installation date are being compared?"],
    });
  }

  if (/\b(?:STCs?|certificates?)\b/i.test(query)
    && /\b(?:quantity|count|number|how many)\b/i.test(query)
    && /\b(?:cash|dollars?|amount|credit(?:ed|s)?|discount|retailer|quote)\b/i.test(query)
    && /\b(?:same|equal|difference|different|thing|becomes?|means?)\b/i.test(query)) {
    return structured("rebates_certificates", {
      directAnswer:
        "No. Certificate quantity is a governed count, not the cash amount on a quote. The dollar line depends on the agent or retailer's stated value per certificate, assignment terms and commercial calculation at that time. Show the eligible certificate count, price per certificate, assignment and total customer discount as separate fields, then reconcile the discount once to the final price.",
      status: "answered",
      citations: officialCitationsById(["cer-stc-entitlement-calculation", "cer-small-scale-system-requirements"]),
      confidence: "high",
      assumptions: ["The installation eligibility, certificate count, commercial price and assignment have not been verified."],
      practicalSteps: ["Verify the governed certificate count.", "Record the quoted value per certificate and assignment terms.", "Reconcile one resulting discount to the customer price."],
      toolActions: [{ id: "open-calculator", label: "Check the certificate count", href: "/calculator" }],
      suggestedQuestions: [],
    });
  }

  if (/\b(?:STCs?|certificates?)\b/i.test(query)
    && /\b(?:assigned|assignment|credited|deducted|subtracted|counted)\b/i.test(query)
    && /\b(?:twice|again|double|duplicate|already|second)\b/i.test(query)) {
    return structured("rebates_certificates", {
      directAnswer:
        "No. If the certificate benefit has already been assigned and included in the contract or quote, count that benefit once. Preserve the certificate quantity, stated value per certificate, assignment and final customer discount as a single reconciliation. Do not deduct or count the same entitlement again in a spreadsheet, subtotal or post-GST line; require a corrected quote if the arithmetic cannot prove one treatment.",
      status: "answered",
      citations: officialCitationsById(["cer-stc-entitlement-calculation", "accc-solar-consumer-rights"]),
      confidence: "high",
      assumptions: ["The contract, assignment and quote arithmetic have not been reviewed."],
      practicalSteps: ["Identify the one certificate entitlement and assignment.", "Trace its discount once through every subtotal.", "Require written correction for any unexplained second deduction."],
      toolActions: [{ id: "open-calculator", label: "Check the STC quantity separately", href: "/calculator" }],
      suggestedQuestions: [],
    });
  }

  if (/\bSTCs?\b/i.test(query)
    && /\$\s*[\d,]+(?:\.\d+)?/.test(query)
    && /\b(?:fixed|guaranteed|always|standard|set|government amount|worth|value|rebate)\b/i.test(query)) {
    return structured("rebates_certificates", {
      directAnswer:
        "No. An STC benefit is not a fixed government dollar amount. The governed calculation determines an eligible certificate quantity from the exact technology or model, capacity, installation date, location or zone and remaining deeming period. Any dollar value is a separate commercial market or quote assumption, so the certificate count, price per certificate, assignment and total customer discount must be shown separately and rechecked for the installation date.",
      status: "needs_context",
      citations: officialCitationsById(["cer-stc-entitlement-calculation", "cer-small-scale-system-requirements"]),
      confidence: "high",
      assumptions: ["The quoted dollar amount, certificate quantity, technology, date and assignment terms have not been verified."],
      practicalSteps: [
        "Calculate the governed certificate quantity from the current official inputs.",
        "Ask the agent to state the assumed value per certificate and assignment terms.",
        "Reconcile the commercial discount once to the final customer price.",
      ],
      toolActions: [{ id: "open-calculator", label: "Calculate certificate quantity", href: "/calculator" }],
      suggestedQuestions: ["What technology, exact model or capacity, postcode, installation date and quoted certificate quantity apply?"],
    });
  }

  if (/\b(?:STCs?|certificates?)\b/i.test(query)
    && /\b(?:backdate|backdated|late|deadline|creation period|creation window|after the deadline|out of time|expired)\b/i.test(query)) {
    return structured("rebates_certificates", {
      directAnswer:
        "Do not backdate installation, assignment or certificate records. Whether certificate creation is still permitted depends on the actual installation and commissioning event, technology and the current CER creation rule in force for that event. Preserve the original dates and evidence, check the exact current deadline and any authorised correction pathway, and keep creation blocked if the official rule or record cannot establish that the claim remains in time.",
      status: "source_review_required",
      citations: officialCitationsById(["cer-small-scale-system-requirements", "cer-stc-entitlement-calculation"]),
      confidence: "high",
      assumptions: ["The technology, actual installation date, certificate-creation date and current deadline provision have not been verified."],
      practicalSteps: [
        "Preserve the actual installation, commissioning and assignment evidence unchanged.",
        "Check the current CER rule for that technology and event date.",
        "Use only an authorised correction path and do not create if the time boundary remains unresolved.",
      ],
      toolActions: [{ id: "open-calculator", label: "Check the dated certificate pathway", href: "/calculator" }],
      suggestedQuestions: ["What technology, actual installation date and proposed certificate-creation date apply?"],
    });
  }

  if (/\bSTCs?\b/i.test(query)
    && /\bexport(?:\s+limit| constrained| constraint| capped| cap| zero export)?\b/i.test(query)
    && /\b(?:eligible|eligibility|qualif(?:y|ies|ied|ication)?|claim|receive|lose|remove|disqualif(?:y|ies|ied|ication)?|no longer|still|stop|prevent|affect)\b/i.test(query)) {
    return structured("rebates_certificates", {
      directAnswer:
        "An export limit alone does not automatically remove rooftop-solar STC eligibility. STC eligibility and quantity still depend on the eligible new capacity, exact approved products, installation date, location, accredited and licensed delivery and compliance with the network-approved export-control design. Treat export as a generation and savings constraint in the quote, while checking the certificate pathway separately; a non-compliant or unapproved design can still block the job.",
      status: "needs_context",
      citations: officialCitationsById(["cer-small-scale-system-requirements", "cer-stc-entitlement-calculation", "cer-rooftop-solar-trade-requirements"]),
      confidence: "high",
      assumptions: ["The products, capacity, date, network approval, export-control design and installer records have not been verified."],
      practicalSteps: [
        "Verify the exact eligible products, new capacity, installation date and delivery credentials.",
        "Match the installed export control to the network approval and commissioning evidence.",
        "Model curtailed generation and savings separately from certificate quantity.",
      ],
      toolActions: [{ id: "open-calculator", label: "Check solar eligibility", href: "/calculator" }],
      suggestedQuestions: ["What new solar capacity, inverter, export limit, network approval and installation date apply?"],
    });
  }

  if (/\b(?:Queensland|QLD)\b/i.test(query)
    && /\b(?:heat[- ]?pump hot[- ]?water|hot[- ]?water heat[- ]?pump|HPHW|HPWH|air[- ]source heat pump)\b/i.test(query)
    && /\b(?:Nov(?:ember)?\s+2026|2026|rebate|support|discount|STCs?|SRES|help|incentive)\b/i.test(query)) {
    return structured("rebates_certificates", {
      directAnswer:
        "A Queensland heat-pump hot-water installation in November 2026 may have a federal SRES or STC pathway, but not a guaranteed fixed rebate. The exact registered model and component configuration must be eligible on the installation date, the postcode zone and remaining deeming period drive certificate quantity, and the installation and assignment must meet the current CER requirements. I cannot identify a separate Queensland household rebate from those facts alone, so do not add one unless a current matching programme is verified before commitment.",
      status: "needs_context",
      citations: officialCitationsById(["cer-swh-ashp-register", "cer-stc-entitlement-calculation", "energy-gov-rebates"]),
      confidence: "high",
      assumptions: ["The exact model, postcode, installation date, replaced system, installer and any current Queensland programme have not been verified."],
      practicalSteps: [
        "Check the exact model and configuration in the CER register for the installation date.",
        "Use the Queensland postcode zone and date in the official certificate calculation.",
        "Check for a separate current state programme before signing, without assuming one exists.",
      ],
      toolActions: [{ id: "open-calculator", label: "Check the hot-water pathway", href: "/calculator" }],
      suggestedQuestions: ["What Queensland postcode, exact model, replaced system and proposed November 2026 installation date apply?"],
    });
  }

  if (/\b(?:renter|tenant|rental)\b/i.test(query)
    && /\b(?:rebate|grant|programme|program|scheme|incentive|assistance|help)\b/i.test(query)
    && /\b(?:portable|reversible|temporary|no fixed work|no replacement|replacing nothing|no installation|nothing installed)\b/i.test(query)) {
    const location = explicitProgramJurisdiction(query)?.[1] || "the supplied jurisdiction";
    return structured("rebates_certificates", {
      directAnswer:
        `No matching upgrade-specific renter rebate is established for ${location} from a request involving only portable or reversible measures and no installed replacement. Say that result before offering general tips. Bill relief, retailer hardship support, a landlord-delivered upgrade or a later approved fixed project are separate pathways, each with its own current rule; do not fill the answer with unrelated solar, EV or owner-only programmes.`,
      status: "needs_context",
      citations: officialCitationsById(["energy-gov-rebates", "energy-gov-renters"]),
      confidence: "medium",
      assumptions: ["No fixed replacement or owner-approved installation is proposed, and no current matching programme application has been supplied."],
      practicalSteps: [
        "Separate immediate bill support from funding for a physical upgrade.",
        "Check only current renter-relevant pathways in the actual jurisdiction.",
        "Use reversible comfort measures separately from programme eligibility.",
      ],
      toolActions: [{ id: "open-rebates", label: "Check renter assistance", href: "/rebates" }],
      suggestedQuestions: ["Is the need bill hardship support, an owner-approved fixed upgrade, or only reversible comfort measures?"],
    });
  }

  if (/\b(?:Queensland|QLD)\b/i.test(query)
    && /\b(?:renter|tenant|rental)\b/i.test(query)
    && /\b(?:deduct|subtract|withhold|take|offset)\b/i.test(query)
    && /\b(?:rent|repair cost|work cost|invoice|payment)\b/i.test(query)) {
    return structured("renters_strata", {
      directAnswer:
        "No. Do not unilaterally deduct repair or upgrade costs from Queensland rent. Notify the owner or agent in writing, preserve the condition and urgency evidence, and use the current RTA repair, minimum-housing-standard and dispute process. Emergency arrangements and reimbursement depend on the current tenancy facts and procedure; fixed energy upgrades still need the required owner approval and licensed work.",
      status: "needs_context",
      citations: officialCitationsById(["qld-rental-minimum-housing-standards"]),
      confidence: "high",
      assumptions: ["The defect, urgency, notices, lease and any authorised repair arrangement have not been reviewed."],
      practicalSteps: [
        "Send a dated written repair notice and keep photos, messages and invoices.",
        "Use the current RTA emergency or routine repair process for the actual defect.",
        "Do not withhold rent or arrange fixed upgrade work without the required authority.",
      ],
      toolActions: [],
      suggestedQuestions: ["What defect, urgency and written response from the owner or agent are recorded?"],
    });
  }

  if (/\b(?:quote|proposal|scope)\b/i.test(query)
    && /\b(?:heat[- ]?pump hot[- ]?water|hot[- ]?water heat[- ]?pump|heat[- ]?pump water[- ]?heater|HPHW|HPWH)\b/i.test(query)
    && /\b(?:missing|has no|have no|does not mention|doesn't mention|omits?|without|gap|review|check)\b/i.test(query)
    && /\b(?:condensate|tempering|circuit|commissioning|removal|decommission)\b/i.test(query)) {
    return structured("heat_pump_hot_water", {
      directAnswer:
        "The quote is not decision-ready while those installation items are missing. Require the exact model and usable tank volume; removal and lawful decommissioning of the existing system; base, seismic or weather placement as applicable; cold-condition recovery and boost; condensate route; hot, cold and relief plumbing; tempering valve; dedicated electrical circuit, isolation and switchboard work; controls and tariff setup; noise and clearances; testing, commissioning, settings, handover, product warranty and labour warranty. A certificate discount or model listing does not fill any omitted scope.",
      status: "needs_context",
      citations: officialCitationsById(["energy-gov-smart-hot-water", "cer-swh-ashp-register", "accc-consumer-guarantees"]),
      confidence: "high",
      practicalSteps: ["Send the installer the explicit gap list.", "Require a revised fixed or clearly provisional scope and cash price.", "Verify exact model and licensed design before acceptance."],
      toolActions: [],
      suggestedQuestions: ["What exact model, existing system, site location and revised inclusions does the installer confirm?"],
    });
  }

  if (/\b(?:quote[- ]?ready|ready (?:for|to) quote|viable)\b/i.test(query)
    && /\b(?:lead|enquiry|referral|customer brief)\b/i.test(query)) {
    return structured("trades", {
      directAnswer:
        "A quote-ready energy lead needs the requested service and outcome; property postcode, tenure and dwelling type; occupants or demand; existing equipment and fuel; measured symptom, bill or interval facts; proposed and retained systems; switchboard, phase and known electrical constraints; plumbing, drainage, roof, access, parking or strata constraints relevant to the job; timing, photos or documents the customer has chosen to share; and the customer's contact and site-visit consent. Unknowns stay marked for the trade's site assessment, not guessed into the lead.",
      status: "needs_context",
      citations: [],
      confidence: "high",
      practicalSteps: ["Capture service, site, existing-system and demand facts.", "Record electrical, access and approval constraints.", "Show unknowns and the customer's explicit sharing and contact consent."],
      toolActions: [],
      suggestedQuestions: ["Which service is being quoted so the minimum site and demand fields can be narrowed?"],
    });
  }

  if (/\b(?:draught[- ]?proof|draft[- ]?proof|draught sealing|air sealing)\b/i.test(query)
    && /\b(?:scope|quote|job|evidence|trade|professional)\b/i.test(query)
    && !/\b(?:TLink|Creditex|platform|workspace)\b/i.test(query)) {
    return structured("trades", {
      directAnswer:
        "Write draught-proofing as a bounded building scope: identify and photograph each confirmed unintended leakage location; state the surface, measured length, preparation, removable or permanent seal product and finish; exclude flues, permanent vents, exhaust make-up air, drainage, combustion air, wet or damaged assemblies and concealed electrical work; record before and after condition and functional checks; and require customer handover. Ventilation, moisture and combustion safety remain inspection boundaries, and unverified gaps are not automatically included.",
      status: "needs_context",
      citations: officialCitationsById(["energy-gov-insulation-draught-proofing", "yourhome-ventilation-airtightness"]),
      confidence: "high",
      practicalSteps: ["Map each included leakage path and quantity.", "List safety exclusions and required licensed checks.", "Capture before, installation and after evidence with functional handover."],
      toolActions: [],
      suggestedQuestions: ["What confirmed leakage locations, lengths, surfaces and ventilation or combustion equipment are in scope?"],
    });
  }

  if (/\b(?:share|send|sent|submit|submitted|goes?|leave|leaves)\b/i.test(query)
    && /\b(?:lead|trade|quote request|enquiry)\b/i.test(query)
    && /\b(?:what|exactly|which|leaves?|leave|sent|browser|device|privacy)\b/i.test(query)
    && !/\b(?:withdraw|unsend|recall|cancel|delete|correct|wrong|mistake|change)\b/i.test(query)) {
    return structured("trades", {
      directAnswer:
        "Nothing is sent to a trade until the customer explicitly consents and submits the lead. The lead contains the reviewed contact and project fields needed for quoting, such as name, selected contact details, location, requested services and the structured quote brief. Raw chat history, source document bytes, raw extracted quote text, NMI and interval rows are not included. A separate optional document-summary checkbox can add only the reviewed structured summary, and phone sharing remains a separate choice.",
      status: "answered",
      citations: [],
      confidence: "high",
      assumptions: ["No private lead was opened or submitted by this answer and the current local consent controls have not been changed."],
      practicalSteps: [
        "Review every visible contact, location, service and quote-brief field before consent.",
        "Leave the optional document summary and phone sharing off unless each is necessary and understood.",
        "Submit only after confirming that the selected trade should receive the displayed lead fields.",
      ],
      toolActions: [],
      suggestedQuestions: ["Do you want the minimum fields for an information-only lead or a quote-ready site lead?"],
    });
  }

  if (/\b(?:name|address|street address|personal details?|customer details?)\b/i.test(query)
    && /\b(?:lead summary|optional summary|quote brief|document summary|lead)\b/i.test(query)
    && /\b(?:appear|included|shared|sent|visible|leave)\b/i.test(query)) {
    return structured("trades", {
      directAnswer:
        "Name and address should appear only in the explicit contact and location fields the customer reviews for the lead, not be copied into an optional document summary. The optional summary is for minimum structured technical facts; its automatic redaction catches bounded identifier patterns and is not a guarantee that every personal detail has been removed. Raw file text, document bytes, NMI, account identifiers and signatures remain local. The user must review the displayed summary and lead before consent because a submitted lead is sent to the selected trade and cannot be withdrawn by an unsend function.",
      status: "answered",
      citations: [],
      confidence: "high",
      assumptions: ["No lead or document summary has been submitted and no private record was inspected."],
      practicalSteps: [
        "Keep identity and location in their labelled lead fields and remove them from technical notes.",
        "Review the optional summary for accidental names, addresses, NMI values and account details.",
        "Submit only after the customer understands which displayed fields go to the selected trade.",
      ],
      toolActions: [],
      suggestedQuestions: ["Which contact and site-location fields does the selected trade genuinely need to prepare this quote?"],
    });
  }

  if (/\b(?:optional|redacted|derived|document|quote|lead)\s+summary\b/i.test(query)
    && /\b(?:personal identifiers?|personal information|personal details?|names?|addresses?|redact|removed?|guarantee|always)\b/i.test(query)) {
    return structured("trades", {
      directAnswer:
        "No. Automatic summary redaction catches only bounded identifier patterns and cannot guarantee that every name, address, account reference, NMI or other personal detail has been removed. Raw files remain local, but a summary the user explicitly copies into chat or includes in a submitted lead leaves that local-only boundary. Review the displayed summary line by line, remove unnecessary identity and location text, and share only the minimum technical facts the selected trade needs.",
      status: "answered",
      citations: [],
      confidence: "high",
      assumptions: ["No private summary or lead has been inspected or submitted by this answer."],
      practicalSteps: ["Review the summary for names, addresses, NMI and account references.", "Keep identity in explicit consented contact fields, not technical notes.", "Submit only the minimum reviewed fields needed for the selected purpose."],
      toolActions: [],
      suggestedQuestions: [],
    });
  }

  if (/\b(?:local|derived|redacted|document|quote)\s+summary\b/i.test(query)
    && /\b(?:prove|guarantee|confirm|establish|complete|completeness|eligible|eligibility|compliant|compliance)\b/i.test(query)) {
    return structured("products_ratings", {
      directAnswer:
        "No. A local derived summary can organise the text that the checker found, but it cannot prove that a quote is complete, that omitted work is unnecessary, that a product or customer is eligible, or that the site and installation comply. Check the summary against every original page, resolve missing scope and exclusions with the issuer, verify exact models and dates in the current official registers, and retain licensed site design, approval and commissioning boundaries.",
      status: "needs_context",
      citations: officialCitationsById(["energy-rating-product-register", "accc-consumer-guarantees"]),
      confidence: "high",
      practicalSteps: ["Reconcile the summary to the original quote pages.", "List every missing or ambiguous scope item.", "Verify regulated facts and site conclusions independently."],
      toolActions: [],
      suggestedQuestions: ["What equipment category and material quote gap should be checked first?"],
    });
  }

  if (/\b(?:phone|mobile|camera)\s+(?:photo|image|picture)|\b(?:photo|image|picture)\s+(?:of|from)\b/i.test(query)
    && /\b(?:quote|document|page|PDF|OCR|checker)\b/i.test(query)) {
    return structured("products_ratings", {
      directAnswer:
        "The local checker does not accept a phone photo and does not run OCR. It accepts a bounded text-based PDF quote, so it will not infer model numbers, prices or terms from pixels. Ask the issuer for the original accessible text PDF, or create a necessary OCR copy locally, verify every material field against the original image and remove personal identifiers before selecting that copy.",
      status: "needs_context",
      citations: [],
      confidence: "high",
      assumptions: ["No image or converted document has been selected and no OCR text has been verified."],
      practicalSteps: [
        "Request the original text PDF from the issuer where possible.",
        "If local OCR is necessary, verify model, quantity, capacity, price, exclusions and dates against the image.",
        "Select only the redacted verified text PDF in the local checker.",
      ],
      toolActions: [],
      suggestedQuestions: ["Can the issuer provide the original text PDF, or do you need a checklist for verifying a local OCR copy?"],
    });
  }

  if (/\b(?:encrypted|password[- ]?protected|locked)\b/i.test(query)
    && /\b(?:quote|document|file|PDF)\b/i.test(query)) {
    return structured("products_ratings", {
      directAnswer:
        "The local checker cannot open or decrypt an encrypted or password-protected quote. It will not ask you to send the password and will not upload the document to a server. Ask the issuer for an accessible text PDF, or make an authorised minimal redacted copy on your own device and verify it against the original. The assistant should receive only the reviewed derived summary, never the password, encrypted file contents or unnecessary personal details.",
      status: "needs_context",
      citations: [],
      confidence: "high",
      assumptions: ["The file has not been decrypted, uploaded or opened by the assistant."],
      practicalSteps: [
        "Keep the password out of chat and lead fields.",
        "Request an accessible text PDF or create an authorised redacted copy locally.",
        "Verify the copy against the original before running the local checker.",
      ],
      toolActions: [],
      suggestedQuestions: ["Can the issuer provide an accessible text PDF without unnecessary personal information?"],
    });
  }

  if (/\b(?:chat|conversation|typed messages?|transcript|history)\b/i.test(query)
    && /\b(?:close|closing|reopen|return|come back|remain|saved|stored|persist|tab|browser)\b/i.test(query)) {
    return structured("products_ratings", {
      directAnswer:
        "The browser keeps up to the latest 40 assistant messages locally so the conversation can resume on that device, and clears the saved session after 30 days of inactivity. Closing a tab does not by itself guarantee immediate deletion. The file bytes and raw extracted text stay in the browser; anything you paste into the conversation is part of chat history. The transcript is not uploaded to the assistant server by this local persistence feature, and the user can clear the conversation. Do not type raw quotes, NMI values, account numbers, signatures or unnecessary personal information into chat.",
      status: "answered",
      citations: [],
      confidence: "high",
      assumptions: ["This describes the current local widget behaviour on the same browser and device; private or shared-browser access has not been inspected."],
      practicalSteps: [
        "Use clear conversation before leaving a shared or public device.",
        "Keep raw documents and identifiers in the local checker, not chat.",
        "Review any derived summary before sharing it with a lead.",
      ],
      toolActions: [],
      suggestedQuestions: ["Is this a private device or a shared browser that should be cleared now?"],
    });
  }

  if (/\b(?:tariff|time[- ]of[- ]use|peak|off[- ]peak|controlled load|rate|plan)\b/i.test(query)
    && /\b(?:infer|guess|assume|derive|work out|clock times?|timestamps?)\b/i.test(query)) {
    return structured("bills_tariffs", {
      directAnswer:
        "No. The local CSV analyser does not infer a tariff from clock times. Timestamps show when energy moved, not the retailer plan, distribution area, daylight-saving treatment, demand window, controlled-load rules, supply charge or current rates. Import the interval data for load shape, then enter or verify the complete current tariff separately before calculating cost.",
      status: "needs_context",
      citations: officialCitationsById(["energy-made-easy-current-plan-comparison"]),
      confidence: "high",
      assumptions: ["No complete retailer tariff, distribution area or daylight-saving rule has been supplied."],
      practicalSteps: [
        "Validate the interval timestamps, timezone, daylight-saving handling and units.",
        "Obtain the current plan's supply, usage, demand, controlled-load and export terms.",
        "Apply that verified tariff to the same intervals without guessing missing windows.",
      ],
      toolActions: [{ id: "compare-electricity", label: "Open the local interval checker", href: "/compare" }],
      suggestedQuestions: ["What retailer, exact plan, distribution area and effective date should be applied to the intervals?"],
    });
  }

  if (/\bCSV\b/i.test(query)
    && /\b(?:Usage|Consumption|Energy)\b/i.test(query)
    && /\b(?:no|missing|without|blank|unknown|ambiguous)\s+(?:unit|units)|\bunit\s+(?:missing|unknown|blank|not stated)\b/i.test(query)) {
    return structured("bills_tariffs", {
      directAnswer:
        "Do not import an interval Usage column when its unit is missing or ambiguous. The checker must not guess whether values are Wh, kWh, W, kW or cumulative meter readings because that can change the result by orders of magnitude. Obtain the export specification or a new file with an explicit unit and interval meaning, then verify one known period against the bill before analysis.",
      status: "needs_context",
      citations: officialCitationsById(["aemo-mdff-nem12-nem13-v2-7"]),
      confidence: "high",
      assumptions: ["The column unit, interval duration and whether values are interval or cumulative have not been verified."],
      practicalSteps: [
        "Keep the import blocked and preserve the original file unchanged.",
        "Obtain the meter-export specification or a replacement file with explicit units and interval semantics.",
        "Reconcile a known day or billing period before using the derived load shape.",
      ],
      toolActions: [{ id: "compare-electricity", label: "Open the local interval checker", href: "/compare" }],
      suggestedQuestions: ["Who exported the file, and can they confirm the unit, interval duration and whether Usage is interval or cumulative?"],
    });
  }

  if (/\b(?:two|2|both)\s+(?:PDF\s+)?quotes?\b/i.test(query)
    && /\b(?:one upload|same upload|together|at once|single upload|compare|upload)\b/i.test(query)) {
    return structured("products_ratings", {
      directAnswer:
        "Yes, compare the two supported text PDFs locally, one at a time. The current checker handles one supported text PDF at a time, not two files in one upload. Run each quote locally, review and save each redacted derived summary, then compare those two summaries on the same scope, exact models, capacities, electrical and building work, commissioning, warranties, exclusions, certificate treatment and cash price. Raw PDFs and extracted text stay local and are not combined into chat.",
      status: "needs_context",
      citations: officialCitationsById(["energy-rating-product-register", "accc-consumer-guarantees"]),
      confidence: "high",
      assumptions: ["Neither quote has been locally checked and the equipment category is not yet known."],
      practicalSteps: [
        "Check quote one locally and review its redacted summary.",
        "Clear the file, check quote two and review its redacted summary.",
        "Compare the two summaries against one written job and verify every regulated product claim separately.",
      ],
      toolActions: [],
      suggestedQuestions: ["What upgrade are the quotes for, and which decision matters most after scope is aligned?"],
    });
  }

  if (/\b(?:guide|rule|method|activity|work pack|version)\b/i.test(query)
    && /\b(?:changed|changes|new|updated|effective|commenced)\b/i.test(query)
    && /\b(?:install(?:ed|ation)?|implementation|activity|job|work)\b/i.test(query)
    && /\b(?:date|June|July|before|after|which|apply|applies)\b/i.test(query)) {
    return structured("trades", {
      directAnswer:
        "Use the rule, guide or method version that legally applies to the activity or implementation date, including any transition provision. Do not apply the newest document blindly to earlier work or keep an old version for later work. Record the exact installation event, governing programme, document version, effective dates and any commencement or transitional clause, then keep eligibility and evidence decisions blocked until that dated mapping is verified.",
      status: "source_review_required",
      citations: officialCitationsById([
        ...( /\b(?:VEU|VEEC|Victorian)\b/i.test(query) ? ["veu-water-space-activity-guide-v3-19"] : []),
        ...( /\b(?:ESS|ESC|PDRS|PRC|NSW)\b/i.test(query) ? ["nsw-ess-rule-current-2026", "nsw-pdrs-rule-current-2026"] : []),
      ]),
      confidence: "high",
      assumptions: ["The exact programme, activity, legal implementation date, superseded version and transitional clause have not been supplied."],
      practicalSteps: [
        "Fix the actual activity or implementation date from the original job evidence.",
        "Compare the old and new document effective dates and any transition clause.",
        "Bind the verified version to the work pack and block submission if the mapping remains uncertain.",
      ],
      toolActions: [{ id: "open-creditex-compliance", label: "Open governed work packs", href: "/creditex/compliance" }],
      suggestedQuestions: ["Which programme, activity, implementation date and two document versions are involved?"],
    });
  }

  if (/\b(?:photos?|images?|evidence files?)\b/i.test(query)
    && /\b(?:missing|no|without|lack|lacks|absent)\b/i.test(query)
    && /\b(?:timestamp|time stamp|capture time|geolocation|geo[- ]?location|GPS|location metadata|provenance)\b/i.test(query)) {
    return structured("trades", {
      directAnswer:
        "Treat missing required capture time, location or other provenance as an evidence blocker, not as a detail that can be reconstructed from memory. Preserve the original files and metadata, identify the exact current programme field that is missing and do not edit, re-save or backfill a false value. Use the governed correction or recapture process, and keep the job out of certificate-ready status until an authorised reviewer confirms the evidence treatment.",
      status: "source_review_required",
      citations: officialCitationsById([
        ...( /\b(?:NSW|ESS|ESC)\b/i.test(query) ? ["nsw-ess-rule-current-2026"] : []),
        ...( /\b(?:PDRS|PRC)\b/i.test(query) ? ["nsw-pdrs-rule-current-2026"] : []),
        ...( /\b(?:VEU|VEEC|Victoria)\b/i.test(query) ? ["veu-water-space-activity-guide-v3-19"] : []),
      ]),
      confidence: "high",
      assumptions: ["The exact programme, activity, evidence field and permitted correction process have not been opened."],
      practicalSteps: [
        "Preserve the original byte file and all available metadata without editing it.",
        "Record which governed field is missing and why the file cannot prove it.",
        "Use the authorised recapture or correction path and require review before submission.",
      ],
      toolActions: [{ id: "open-creditex-compliance", label: "Open governed evidence", href: "/creditex/compliance" }],
      suggestedQuestions: ["Which programme, activity and current work-pack field requires the missing provenance?"],
    });
  }

  if ((/\b(?:worker|employee|apprentice|technician|team member)\b/i.test(query)
    && /\b(?:used|using|logged|signed|worked|completed|finished|submitted|uploaded|captured|certified)\b/i.test(query)
    && /\b(?:(?:my|our|another person's|someone else's|the supervisor)\s+(?:account|login|credentials?|password)|(?:account|login)\s+under\s+(?:my|our|the supervisor))\b/i.test(query))
    || /\b(?:someone else|another person|another worker|not me)\b[\s\S]{0,80}\b(?:did|performed|completed|submitted|uploaded)\b[\s\S]{0,80}\b(?:job|work|evidence|submission)\b[\s\S]{0,80}\b(?:my|our)\s+(?:account|login)\b/i.test(query)) {
    return structured("trades", {
      directAnswer:
        "Treat this as a credential-security and audit-attribution incident. Stop further use, secure the account, preserve the audit log and identify every job or submission performed under the wrong identity. Do not delete or rewrite history. Report it through platform support and any affected programme process, then have the correctly authorised person review and correct each record under the governed incident pathway.",
      status: "source_review_required",
      citations: [],
      confidence: "high",
      assumptions: ["The account, audit log, affected jobs, programme and current incident process have not been inspected."],
      practicalSteps: [
        "Stop the shared access, change credentials and revoke exposed sessions or links.",
        "Preserve the audit trail and list every affected job, action, time and actual actor.",
        "Notify platform and programme support and use the authorised correction process without falsifying attribution.",
      ],
      toolActions: [],
      suggestedQuestions: ["Which account, dates, jobs and submissions were affected, and is any certificate or customer evidence already lodged?"],
    });
  }

  const suppliedScopeNotes = query.match(/:\s*([\s\S]+)$/)?.[1]?.trim()
    || query.match(/\bnotes?\s*:\s*([\s\S]+)$/i)?.[1]?.trim();
  if (/\b(?:turn|convert|rewrite|make|draft)\b/i.test(query)
    && /\b(?:notes?|site notes?|rough notes?|dot points?|bullet points?)\b/i.test(query)
    && /\b(?:professional|client[- ]ready|quote[- ]ready|clear|formal)\b/i.test(query)
    && /\b(?:scope|scope of work|work scope|proposal)\b/i.test(query)) {
    return structured("trades", {
      directAnswer: suppliedScopeNotes
        ? `Professional quote scope, based on the supplied notes: ${suppliedScopeNotes.replace(/\s+/g, " ")}. Include site verification; protection and isolation; removal and lawful decommissioning of the stated existing equipment; supply and installation of the selected replacement only after demand, capacity and exact model are confirmed; required plumbing, condensate or drainage, tempering and licensed electrical work; controls; testing, commissioning, settings, evidence and customer handover. Treat switchboard, circuit, access, noise, clearances, approvals and concealed conditions as provisional until inspected. Exclude make-good, authority fees and work outside the stated notes unless expressly included or added by written variation. Do not claim product eligibility or site compliance until the exact model, licensed design and current evidence pathway are verified.`
        : "I can turn supplied notes into a professional bounded scope without inventing site facts or declaring compliance. Structure it as: objective and property area; verified existing conditions; included work and exact quantities or products where known; access, protection and coordination; electrical, plumbing, building or programme responsibilities; testing and commissioning; customer handover; explicit exclusions, assumptions, provisional items and unresolved site questions. Keep every unknown visible for site verification or licensed design.",
      status: suppliedScopeNotes ? "answered" : "needs_context",
      citations: [],
      confidence: "high",
      assumptions: [suppliedScopeNotes
        ? "The supplied notes are treated as unverified source material; no site inspection, governing programme or authorised design has been inferred."
        : "No notes, site inspection, governing programme or authorised design have been supplied in this conversation."],
      practicalSteps: [
        "Paste only de-identified notes and separate observations from customer statements and assumptions.",
        "Identify the trade, upgrade and intended audience for the scope.",
        "Mark quantities, compliance conclusions and concealed conditions as verified, provisional or excluded.",
      ],
      toolActions: [],
      suggestedQuestions: suppliedScopeNotes ? [] : ["What de-identified notes, trade or upgrade, and intended customer or subcontractor audience should the scope cover?"],
    });
  }

  if (/\b(?:street parking|park(?:ing)? on (?:the )?street|kerbside|curbside|no driveway|no garage|no off[- ]street)\b/i.test(query)
    && /\b(?:EV|electric vehicle|electric car|charg(?:e|er|ing))\b/i.test(query)) {
    return structured("ev_charging", {
      directAnswer:
        "Reliable legal charging access is the first decision for a street-parked EV, before charger power or vehicle range. Do not run a private cable across a footpath, roadway, tree verge or shared access unless the council, network and property approvals and an engineered protected crossing explicitly allow it. Check dependable home, workplace, destination and public charging near the actual parking pattern, including availability, connectors, price and backup options.",
      status: "needs_context",
      citations: officialCitationsById(["energy-gov-ev-charging-equipment", "energy-gov-electric-vehicles"]),
      confidence: "medium",
      assumptions: ["The local council rules, parking entitlement, public charging network, vehicle and daily travel have not been checked."],
      practicalSteps: [
        "Map where the car actually parks overnight and identify legal nearby charging options.",
        "Check council, network, owner and strata requirements before proposing any kerb or cable crossing.",
        "Test the vehicle decision against dependable charging availability and a backup site, not an ideal daily scenario.",
      ],
      toolActions: [{ id: "open-ev-guide", label: "Open the EV charging guide", href: "/guides/ev-charging" }],
      suggestedQuestions: ["What postcode, overnight parking control, daily distance and reliable workplace or public charging access apply?"],
    });
  }

  const evsePowerKw = numericCapture(query, /\b(?:EVSE|wallbox|charger|charge point)(?:\s+(?:is|rated|offers?|at))?\s*([\d,]+(?:\.\d+)?)\s*kW\b/i)
    ?? numericCapture(query, /\b([\d,]+(?:\.\d+)?)\s*kW\s+(?:EVSE|wallbox|charger|charge point)\b/i);
  const vehicleAcLimitKw = numericCapture(query, /\b(?:my\s+)?onboard(?: AC)? charger\b[^.\n\d]{0,25}([\d,]+(?:\.\d+)?)\s*kW\b/i)
    ?? numericCapture(query, /\b(?:car|vehicle|EV)(?:'s)?\b[^.\n]{0,45}\b(?:accepts?|takes?|caps?|capped|limited|max(?:imum)?|onboard(?: AC)? charger|AC limit)\b[^.\n\d]{0,18}([\d,]+(?:\.\d+)?)\s*kW\b/i)
    ?? numericCapture(query, /\b(?:accepts?|vehicle limit|vehicle cap)\s+(?:only\s+)?(?:is\s+|at\s+|of\s+|to\s+)?([\d,]+(?:\.\d+)?)\s*kW(?:\s+AC)?\b/i);
  if (/\b(?:EV|electric vehicle|car|charger|EVSE)\b/i.test(query)
    && /\b(?:charg(?:e|er|ing)|EVSE|onboard)\b/i.test(query)
    && evsePowerKw !== null
    && vehicleAcLimitKw !== null) {
    const deliveredCap = Math.min(evsePowerKw, vehicleAcLimitKw);
    return structured("ev_charging", {
      directAnswer:
        `The ${evsePowerKw.toLocaleString("en-AU")} kW charger cannot make a vehicle whose onboard AC limit is ${vehicleAcLimitKw.toLocaleString("en-AU")} kW accept more than about ${deliveredCap.toLocaleString("en-AU")} kW, and the site supply or load management may reduce it further. Charger nameplate power is not charging speed by itself. Daily kilometres determine energy to replace, while efficiency and parked hours determine whether that lower effective rate is sufficient.`,
      status: "needs_context",
      citations: officialCitationsById(["energy-gov-ev-charging-equipment"]),
      confidence: "high",
      assumptions: ["The figures are AC charger and vehicle onboard limits; site capacity, losses, battery state, daily distance and parked window have not been verified."],
      practicalSteps: [
        "Calculate daily energy from kilometres multiplied by the exact vehicle's kWh/100 km.",
        "Divide by the realistic effective charging rate and allow for losses to test the parked window.",
        "Have a licensed electrician verify supply, circuit, protection, load management and final commissioning.",
      ],
      toolActions: [{ id: "open-ev-guide", label: "Open the EV charging guide", href: "/guides/ev-charging" }],
      suggestedQuestions: ["What daily kilometres, vehicle kWh/100 km, parked hours and licensed site-capacity assessment apply?"],
    });
  }

  if (/\bV2L\b|vehicle[- ]to[- ]load/i.test(query)
    && /\b(?:switchboard|house wiring|home wiring|home socket|wall socket|power point|outlet|power the house|backfeed|inlet|transfer switch|generator inlet)\b/i.test(query)) {
    return structured("ev_charging", {
      directAnswer:
        "Do not connect a V2L outlet to a switchboard, socket or improvised lead to backfeed the home. V2L is for compatible plug-in loads within the vehicle manufacturer's limits. Supplying building circuits requires an approved transfer or bidirectional system that prevents network backfeed and unsafe energisation, is compatible with the vehicle and equipment, has the required network approval and islanding protection, and is installed and tested by licensed electrical trades.",
      status: "needs_context",
      citations: officialCitationsById(["act-bidirectional-ev-charging", "nsw-home-electrical-safety"]),
      confidence: "high",
      assumptions: ["The vehicle, V2L limits, building supply and any approved transfer equipment have not been inspected."],
      practicalSteps: [
        "Use V2L only for manufacturer-permitted plug-in loads and never for improvised switchboard backfeed.",
        "List the essential loads and their running and starting power.",
        "Use a licensed designer and electrician for any approved building transfer or bidirectional system and network process.",
      ],
      toolActions: [],
      suggestedQuestions: ["Which exact vehicle, essential loads and approved transfer or bidirectional equipment are proposed?"],
    });
  }

  if (/\b(?:V2H|vehicle[- ]to[- ]home|vehicle to home|bidirectional charging)\b/i.test(query)
    && /\b(?:approvals?|approved|equipment|compatible|compatibility|requirements?|operate|power (?:my|the) (?:home|house)|legally|safely|align)\b/i.test(query)) {
    return structured("ev_charging", {
      directAnswer:
        "Vehicle-to-home requires the complete system to align: a compatible vehicle and firmware, certified bidirectional equipment including a compatible charger or inverter, an engineered switchboard connection with transfer and anti-islanding protection, the distributor or network approval and applicable export or operating limits, and appropriately licensed design, installation, testing and commissioning. A V2L outlet, ordinary EVSE or compatible-looking plug does not authorise building backfeed. Keep operation blocked until the vehicle, hardware, network and licensed commissioning records all confirm the same approved configuration.",
      status: "needs_context",
      citations: officialCitationsById(["act-bidirectional-ev-charging", "nsw-home-electrical-safety"]),
      confidence: "high",
      assumptions: ["The vehicle, firmware, charger, switchboard, network rules and licensed design have not been verified."],
      practicalSteps: ["Verify the exact vehicle and certified bidirectional hardware pairing.", "Obtain network approval and an engineered islanding and load design.", "Use licensed installation and witnessed commissioning before operation."],
      toolActions: [],
      suggestedQuestions: ["What exact vehicle, bidirectional charger, network area and backed-up circuits are proposed?"],
    });
  }

  const annualEvBatteryKwh = numericCapture(query, /\b(?:EV|electric (?:car|vehicle))\b[^.\n]{0,50}\b(?:needs?|uses?|requires?)\s*([\d,]+(?:\.\d+)?)\s*kWh\b[^.\n]{0,45}\b(?:battery|vehicle)\b[^.\n]{0,30}\b(?:year|annual|annually)\b/i)
    ?? numericCapture(query, /\b([\d,]+(?:\.\d+)?)\s*kWh\b[^.\n]{0,30}\b(?:at|into|to)\s+(?:(?:the|an?)\s+)?(?:EV\s+)?battery\b[^.\n]{0,30}\b(?:year|annual|annually)\b/i);
  const annualEvLossPercent = numericCapture(query, /\b(?:add|apply|include|assume)?\s*([\d,]+(?:\.\d+)?)\s*(?:%|percent|per cent)\s+(?:charging\s+)?loss(?:es)?\b/i);
  const annualEvPriceCents = numericCapture(query, /\b(?:price|cost|rate)?\s*(?:grid(?: energy)?\s+)?(?:at\s+)?([\d,]+(?:\.\d+)?)\s*(?:c|cents?)\b/i);
  if (annualEvBatteryKwh !== null && annualEvLossPercent !== null && annualEvPriceCents !== null
    && /\b(?:EV|electric (?:car|vehicle)|charging|grid energy)\b/i.test(query)) {
    const gridKwh = annualEvBatteryKwh * (1 + annualEvLossPercent / 100);
    const annualCost = gridKwh * annualEvPriceCents / 100;
    return structured("ev_charging", {
      directAnswer:
        `Under the supplied additive-loss assumption, ${annualEvBatteryKwh.toLocaleString("en-AU")} kWh delivered to the vehicle plus ${annualEvLossPercent.toLocaleString("en-AU")}% charging loss requires about ${gridKwh.toLocaleString("en-AU", { maximumFractionDigits: 1 })} kWh from the grid. At ${annualEvPriceCents.toLocaleString("en-AU")} c/kWh, that costs about $${annualCost.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} a year. This assumes the stated battery-side energy excludes charging losses and that the same grid price applies to every charging kWh; subscriptions, session fees and solar opportunity cost are separate.`,
      status: "answered",
      citations: officialCitationsById(["energy-gov-ev-charging-equipment", "energy-made-easy-current-plan-comparison"]),
      confidence: "high",
      assumptions: ["Charging loss is treated as an additive uplift on battery-side energy, and the supplied electricity price is treated as a flat marginal rate."],
      practicalSteps: ["Verify that the annual energy figure is battery-side, not already measured at the wall.", "Replace the flat rate with the actual charging-price mix when available."],
      toolActions: [{ id: "compare-electricity", label: "Check the charging tariff", href: "/compare" }],
      suggestedQuestions: [],
    });
  }

  if (/\b(?:Green Vehicle Guide|GVG)\b/i.test(query)
    && /\b(?:two|both|pair|rows?|variants?)\b/i.test(query)
    && /\b(?:same|shared|matching)\s+(?:test\s+)?cycle\b/i.test(query)
    && suppliedVehicleComparisonRows(query).length < 2) {
    return structured("ev_charging", {
      directAnswer:
        "A shared test-cycle label is necessary but not enough to compare two vehicles. I still need each exact model-year variant's official energy use in Wh/km or kWh/100 km, plus certified range if range is part of the question. On the same cycle, the lower energy-use figure is more efficient; keep range, cost, charging access and other vehicle qualities separate.",
      status: "needs_context",
      citations: officialCitationsById(["green-vehicle-guide-compare"]),
      confidence: "high",
      assumptions: ["The exact variant rows and energy-use values have not been supplied."],
      practicalSteps: [
        "Copy the complete model year and variant for both rows.",
        "Copy energy use, certified range and the shared test cycle from each official row.",
        "Compare only the supplied like-for-like facts without choosing a brand or model overall.",
      ],
      toolActions: [{ id: "open-ev-guide", label: "Open the EV comparison guide", href: "/guides/ev-charging" }],
      suggestedQuestions: ["What exact energy-use and certified-range values are shown for each same-cycle variant?"],
    });
  }

  if (/\b(?:at[- ]?wall|from the (?:wall|socket|charger)|grid[- ]side (?:energy|consumption|figure|rating))\b/i.test(query)
    && /\b\d+(?:\.\d+)?\s*kWh\s*(?:\/|per)\s*100(?:\s*km)?\b/i.test(query)
    && /\b(?:add|include|apply|charging losses?|loss factor|extra loss)\b/i.test(query)
    && !/\b(?:annual|annually|per year|yearly)\b/i.test(query)) {
    return structured("ev_charging", {
      directAnswer:
        "Do not add a second generic charging-loss percentage when the supplied EV consumption is explicitly measured or stated at the wall. At-wall kWh/100 km already includes the energy drawn through the charger for that stated basis. Verify that the figure really is grid-side, uses the same test or measured conditions and excludes unrelated standby or preconditioning if that matters; then multiply it by annual kilometres and the applicable charging price. If the value is vehicle-side instead, state one separate loss assumption.",
      status: "needs_context",
      citations: officialCitationsById(["green-vehicle-guide-compare", "energy-gov-ev-charging-equipment"]),
      confidence: "high",
      assumptions: ["The supplied figure is being described as at-wall consumption; its measurement period and included loads have not been verified."],
      practicalSteps: ["Confirm whether the source labels the figure grid-side or vehicle-side.", "Use the at-wall figure once, without a second loss uplift.", "Apply annual kilometres and the actual charging-price mix separately."],
      toolActions: [],
      suggestedQuestions: ["What annual kilometres and home, solar or public charging prices should be applied to the verified at-wall figure?"],
    });
  }

  const vehicleCostInputs = evAnnualSavingsInputs(evSavingsConversation);
  const asksAnnualVehicleEnergyCost = /\b(?:annual|annually|per year|yearly|a year|fuel cost|energy cost|running cost|saving|savings|compare|calculate|cost)\b/i.test(evSavingsConversation);
  const hasFuelCostInputs = vehicleCostInputs.annualKm !== null
    && vehicleCostInputs.fuelLitresPer100Km !== null
    && vehicleCostInputs.fuelDollarsPerLitre !== null;
  const hasEvCostInputs = vehicleCostInputs.annualKm !== null
    && vehicleCostInputs.evKwhPer100Km !== null
    && vehicleCostInputs.blendedCentsPerKwh !== null;
  const hasEvCostIntent = /\b(?:EV|electric vehicle|electric car|kWh\s*(?:\/|per)\s*100\s*km|charging cost)\b/i.test(evSavingsConversation);
  const calculateBothVehicleCosts = hasFuelCostInputs && hasEvCostInputs;
  const calculateFuelOnly = hasFuelCostInputs && !hasEvCostIntent;
  const calculateEvOnly = hasEvCostInputs && !/\b(?:petrol|diesel|fuel|L\s*(?:\/|per)\s*100\s*km)\b/i.test(evSavingsConversation);
  if (asksAnnualVehicleEnergyCost && (calculateBothVehicleCosts || calculateFuelOnly || calculateEvOnly)) {
    const annualKm = vehicleCostInputs.annualKm as number;
    const formatMoney = (value: number) => {
      const cents = Math.round(value * 100) / 100;
      return cents.toLocaleString("en-AU", {
        minimumFractionDigits: Number.isInteger(cents) ? 0 : 2,
        maximumFractionDigits: 2,
      });
    };
    const fuelLitres = hasFuelCostInputs
      ? annualKm * (vehicleCostInputs.fuelLitresPer100Km as number) / 100
      : null;
    const annualFuelCost = fuelLitres === null
      ? null
      : fuelLitres * (vehicleCostInputs.fuelDollarsPerLitre as number);
    const vehicleEvEnergy = hasEvCostInputs
      ? annualKm * (vehicleCostInputs.evKwhPer100Km as number) / 100
      : null;
    const lossPercent = vehicleCostInputs.chargingLossPercent || 0;
    const gridEvEnergy = vehicleEvEnergy === null ? null : vehicleEvEnergy * (1 + lossPercent / 100);
    const annualEvCost = gridEvEnergy === null
      ? null
      : gridEvEnergy * (vehicleCostInputs.blendedCentsPerKwh as number) / 100;
    const lossText = lossPercent > 0
      ? ` With ${lossPercent.toLocaleString("en-AU")}% charging loss, grid energy is about ${gridEvEnergy?.toLocaleString("en-AU", { maximumFractionDigits: 1 })} kWh rather than ${vehicleEvEnergy?.toLocaleString("en-AU", { maximumFractionDigits: 1 })} kWh delivered to the vehicle.`
      : vehicleCostInputs.consumptionIncludesChargingLoss
        ? " The supplied at-wall consumption already includes charging losses, so no additional loss factor is added."
        : " Charging losses are not included unless a loss assumption is supplied.";
    const directAnswer = annualFuelCost !== null && annualEvCost !== null
      ? `At ${annualKm.toLocaleString("en-AU")} km a year, the supplied petrol or diesel inputs use ${fuelLitres?.toLocaleString("en-AU", { maximumFractionDigits: 1 })} L and cost $${formatMoney(annualFuelCost)}. The supplied EV inputs use ${vehicleEvEnergy?.toLocaleString("en-AU", { maximumFractionDigits: 1 })} kWh at the vehicle and cost $${formatMoney(annualEvCost)} from the grid. The indicated energy-cost saving is $${formatMoney(annualFuelCost - annualEvCost)} per year.${lossText} This excludes purchase, finance, servicing, insurance, depreciation and other ownership costs.`
      : annualFuelCost !== null
        ? `At ${annualKm.toLocaleString("en-AU")} km a year and ${(vehicleCostInputs.fuelLitresPer100Km as number).toLocaleString("en-AU")} L/100 km, fuel use is ${fuelLitres?.toLocaleString("en-AU", { maximumFractionDigits: 1 })} L. At $${(vehicleCostInputs.fuelDollarsPerLitre as number).toLocaleString("en-AU", { maximumFractionDigits: 3 })}/L, the supplied annual fuel cost is $${formatMoney(annualFuelCost)}. This is energy arithmetic only; it does not include finance, maintenance, insurance, depreciation or price changes.`
        : `At ${annualKm.toLocaleString("en-AU")} km a year and ${(vehicleCostInputs.evKwhPer100Km as number).toLocaleString("en-AU")} kWh/100 km, the vehicle energy is ${vehicleEvEnergy?.toLocaleString("en-AU", { maximumFractionDigits: 1 })} kWh. At ${(vehicleCostInputs.blendedCentsPerKwh as number).toLocaleString("en-AU", { maximumFractionDigits: 2 })} c/kWh, the supplied annual charging cost is $${formatMoney(annualEvCost as number)}.${lossText} Public charging fees, solar opportunity cost and other ownership costs are separate.`;
    return structured("ev_charging", {
      directAnswer,
      status: "answered",
      citations: officialCitationsById(["green-vehicle-guide-compare", "energy-gov-ev-charging-equipment", "energy-made-easy-current-plan-comparison"]),
      confidence: "medium",
      assumptions: [
        "The supplied distance, consumption and prices are treated as comparable annual assumptions and have not been independently verified.",
        lossPercent > 0
          ? "Charging loss is treated as an uplift on the stated vehicle energy, so grid energy equals vehicle energy multiplied by one plus the supplied loss fraction."
          : "Charging losses, public fees and solar export opportunity cost are not included.",
      ],
      practicalSteps: [
        "Verify annual distance and the exact vehicle consumption on a consistent basis.",
        "Use the complete home and public charging price mix and an explicit charging-loss assumption.",
        "Keep purchase, finance, servicing, insurance and depreciation separate from energy cost.",
      ],
      toolActions: [{ id: "compare-electricity", label: "Check the charging tariff", href: "/compare" }],
      suggestedQuestions: [annualFuelCost !== null && annualEvCost !== null
        ? "Do you want a low and high fuel, electricity and charging-loss sensitivity?"
        : "Do you want to add the other vehicle's consumption and energy price for a like-for-like annual comparison?"],
    });
  }

  const hasCompleteEvChargingPrice = vehicleCostInputs.blendedCentsPerKwh !== null
    || vehicleCostInputs.homeCentsPerKwh !== null
      && vehicleCostInputs.publicCentsPerKwh !== null
      && vehicleCostInputs.homePercent !== null;
  if (asksAnnualVehicleEnergyCost
    && hasFuelCostInputs
    && hasEvCostIntent
    && (vehicleCostInputs.evKwhPer100Km === null || !hasCompleteEvChargingPrice)) {
    const annualKm = vehicleCostInputs.annualKm as number;
    const fuelLitresPer100Km = vehicleCostInputs.fuelLitresPer100Km as number;
    const fuelDollarsPerLitre = vehicleCostInputs.fuelDollarsPerLitre as number;
    const annualFuelLitres = annualKm * fuelLitresPer100Km / 100;
    const annualFuelCost = annualFuelLitres * fuelDollarsPerLitre;
    const missingEvFacts = [
      vehicleCostInputs.evKwhPer100Km === null ? "the exact EV kWh/100 km" : null,
      vehicleCostInputs.blendedCentsPerKwh === null
        && (vehicleCostInputs.homeCentsPerKwh === null
          || vehicleCostInputs.publicCentsPerKwh === null
          || vehicleCostInputs.homePercent === null)
        ? "the effective charging price or home versus public charging price mix"
        : null,
      vehicleCostInputs.chargingLossPercent === null && !vehicleCostInputs.consumptionIncludesChargingLoss
        ? "the charging-loss assumption, or confirmation that the consumption is measured at the wall"
        : null,
    ].filter((fact): fact is string => fact !== null);
    return structured("ev_charging", {
      directAnswer:
        `The current-vehicle side is now defined. Captured: ${annualKm.toLocaleString("en-AU")} km a year, ${fuelLitresPer100Km.toLocaleString("en-AU")} L/100 km and $${fuelDollarsPerLitre.toLocaleString("en-AU", { maximumFractionDigits: 3 })}/L. That is about ${annualFuelLitres.toLocaleString("en-AU", { maximumFractionDigits: 1 })} L and $${annualFuelCost.toLocaleString("en-AU", { maximumFractionDigits: 2 })} a year for fuel. To finish the EV comparison without guessing, I need only ${missingEvFacts.join(", ")}.`,
      status: "needs_context",
      citations: officialCitationsById(["green-vehicle-guide-compare", "energy-gov-ev-charging-equipment", "energy-made-easy-current-plan-comparison"]),
      confidence: "medium",
      assumptions: ["The supplied annual distance, fuel economy and fuel price are treated as the comparison baseline and have not been independently verified."],
      practicalSteps: [
        "Use the exact EV variant's kWh/100 km on a stated vehicle-side or at-wall basis.",
        "Use the actual charging-price mix and one explicit loss assumption.",
      ],
      toolActions: [],
      suggestedQuestions: [`Which remaining input values should I use: ${missingEvFacts.join("; ")}?`],
    });
  }

  const quotedCashPrice = numericCapture(query, /\b(?:cash(?:\s+quote|\s+price)?|paying cash)\s*(?:is|of|:|=)?\s*\$\s*([\d,]+(?:\.\d+)?)/i)
    ?? numericCapture(query, /\$\s*([\d,]+(?:\.\d+)?)\s*(?:cash|cash quote|cash price)\b/i);
  const quotedFinancedPrice = numericCapture(query, /\b(?:financed|finance|credit)\s+(?:quote|price|amount)\s*(?:is|of|:|=)?\s*\$\s*([\d,]+(?:\.\d+)?)/i)
    ?? numericCapture(query, /\$\s*([\d,]+(?:\.\d+)?)\s*(?:financed|finance price|financed quote)\b/i);
  if (quotedCashPrice !== null && quotedFinancedPrice !== null
    && /\b(?:loan|finance|financed|credit|cash)\b/i.test(query)) {
    const uplift = quotedFinancedPrice - quotedCashPrice;
    return structured("bills_tariffs", {
      directAnswer:
        `${uplift >= 0 ? `The $${quotedCashPrice.toLocaleString("en-AU")} cash price is $${Math.abs(uplift).toLocaleString("en-AU")} lower than the $${quotedFinancedPrice.toLocaleString("en-AU")} financed price, so the financed price is $${Math.abs(uplift).toLocaleString("en-AU")} above cash` : `The $${quotedFinancedPrice.toLocaleString("en-AU")} financed price is $${Math.abs(uplift).toLocaleString("en-AU")} lower than the $${quotedCashPrice.toLocaleString("en-AU")} cash price`} on the supplied figures before any interest, unlisted fees, balloon or time-value effect. Compare the total amount repaid and confirm both cover the same scope; keep projected energy savings separate from financing cost. This is comparison arithmetic, not personal financial advice.`,
      status: "needs_context",
      citations: officialCitationsById(["asic-moneysmart-personal-loans"]),
      confidence: "high",
      assumptions: ["The two figures describe the same installed scope and neither complete lender disclosure nor total repayment has been verified."],
      practicalSteps: [
        "Confirm both prices cover the same equipment, installation, support and warranty.",
        "Add deposit, amount financed, term, comparison rate, every fee, balloon and total repayments.",
        "Compare bill savings separately under explicit low and high assumptions.",
      ],
      toolActions: [],
      suggestedQuestions: ["What term, comparison rate, setup and ongoing fees, balloon and total repayments does the finance disclosure state?"],
    });
  }

  const advertisedZeroRate = /\b0(?:\.0+)?\s*(?:%|\bpercent\b)|\bzero[- ]?(?:percent|interest)\b|\binterest[- ]free\b/i.test(query);
  const financeFee = numericCapture(query, /\b(?:setup|establishment|application|origination|admin(?:istration)?)\s+(?:fee|cost|charge)\s*(?:is|of|:|=|costs?)?\s*\$\s*([\d,]+(?:\.\d+)?)/i)
    ?? numericCapture(query, /\$\s*([\d,]+(?:\.\d+)?)\s+(?:setup|establishment|application|origination|admin(?:istration)?)\s+(?:fee|cost|charge)\b/i)
    ?? numericCapture(query, /\b(?:finance|loan|borrowing)\s+(?:fee|charge|cost)\s*(?:is|of|:|=|costs?)?\s*\$\s*([\d,]+(?:\.\d+)?)/i)
    ?? numericCapture(query, /\$\s*([\d,]+(?:\.\d+)?)\s+(?:fee|charge)\b/i);
  const financePrincipal = numericCapture(query, /\$\s*([\d,]+(?:\.\d+)?)\s*(?:upgrade|system|principal|loan|amount borrowed)\b/i)
    ?? numericCapture(query, /\b(?:loan|principal|amount borrowed|upgrade|system)(?:\s+(?:price|cost|amount|principal))?\s*(?:is|of|:|=|costs?)?\s*\$\s*([\d,]+(?:\.\d+)?)/i)
    ?? numericCapture(query, /\$\s*([\d,]+(?:\.\d+)?)[^.\n]{0,25}\b(?:loan|principal|upgrade|system)\b/i);
  if (advertisedZeroRate && financeFee !== null && /\b(?:loan|finance|financing|credit|lender)\b/i.test(query)) {
    return structured("bills_tariffs", {
      directAnswer:
        `No. A loan with a $${financeFee.toLocaleString("en-AU")} setup fee or establishment fee is not free finance even if the advertised interest rate is 0%. The known financing cost is at least $${financeFee.toLocaleString("en-AU")}${financePrincipal && financePrincipal > 0 ? `, which is ${(financeFee / financePrincipal * 100).toLocaleString("en-AU", { maximumFractionDigits: 1 })}% of the supplied $${financePrincipal.toLocaleString("en-AU")} principal or system price` : ""}, before any other fee or price uplift. Compare the cash installed price, financed price, term, repayments, balloon, early-repayment terms and total amount repaid.`,
      status: "needs_context",
      citations: officialCitationsById(["asic-moneysmart-personal-loans"]),
      confidence: "high",
      assumptions: ["Only the advertised rate and one fee are known; the financed price and complete disclosure have not been reviewed."],
      practicalSteps: [
        "Put the cash and financed installed prices side by side.",
        "Add every fee, repayment and balloon to calculate total repayment.",
        "Keep the upgrade's uncertain energy saving separate from the finance comparison.",
      ],
      toolActions: [],
      suggestedQuestions: ["What are the cash price, financed price, term, repayments, all other fees and any balloon?"],
    });
  }

  if (/\b(?:loan|finance|financing|borrow|credit)\b/i.test(query)
    && /\bcash\b/i.test(query)
    && /(?:\$\s*[\d,]+(?:\.\d+)?\s*[kK]?|\b\d+(?:\.\d+)?\s*%)/.test(query)) {
    const amountMatch = query.match(/\$\s*([\d,]+(?:\.\d+)?)\s*([kK])?\b/);
    const amount = amountMatch?.[1]
      ? Number(amountMatch[1].replaceAll(",", "")) * (amountMatch[2] ? 1000 : 1)
      : null;
    const annualRate = numericCapture(query, /\b(\d+(?:\.\d+)?)\s*%/i);
    const wordYears: Readonly<Record<string, number>> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, fifteen: 15, twenty: 20 };
    const termYears = numericCapture(query, /\b([\d,]+(?:\.\d+)?)\s*[- ]?(?:year|yr)s?\b/i)
      ?? (() => {
        const word = query.match(/\b(one|two|three|four|five|six|seven|eight|nine|ten|fifteen|twenty)\s*[- ]?year/i)?.[1]?.toLowerCase();
        return word ? wordYears[word] || null : null;
      })();
    const months = termYears === null ? null : Math.round(termYears * 12);
    const monthlyRate = annualRate === null ? null : annualRate / 1200;
    const monthly = amount !== null && months && monthlyRate !== null
      ? monthlyRate === 0
        ? amount / months
        : amount * monthlyRate * (1 + monthlyRate) ** months / ((1 + monthlyRate) ** months - 1)
      : null;
    const total = monthly !== null && months ? monthly * months : null;
    const arithmetic = amount !== null && annualRate !== null && termYears !== null && monthly !== null && total !== null
      ? ` If $${amount.toLocaleString("en-AU")} is the amount borrowed at a nominal ${annualRate}% charged monthly for ${termYears} years with no fees or balloon, repayments are about $${monthly.toLocaleString("en-AU", { maximumFractionDigits: 2 })} a month and $${total.toLocaleString("en-AU", { maximumFractionDigits: 0 })} in total, about $${(total - amount).toLocaleString("en-AU", { maximumFractionDigits: 0 })} above the amount borrowed.`
      : "";
    return structured("bills_tariffs", {
      directAnswer:
        `Compare the loan against the same installed cash scope and price, not against projected savings alone.${arithmetic} Add the lender's comparison rate, every fee, balloon, early-repayment terms and total repayment because the disclosure can change that simplified result. Keep rebates and energy savings as separate, independently verified lines. Surge can calculate supplied terms but does not give personal financial advice.`,
      status: "needs_context",
      citations: officialCitationsById(["asic-moneysmart-personal-loans", "energy-gov-reduce-energy-bills"]),
      confidence: arithmetic ? "medium" : "low",
      assumptions: ["The cash price, complete lender disclosure, comparison rate, fees, balloon and energy-saving evidence have not all been supplied."],
      practicalSteps: [
        "Confirm the identical cash installed scope and price.",
        "Record amount financed, term, comparison rate, every fee, balloon and total repayments.",
        "Compare energy savings separately under low and high measured-use assumptions.",
      ],
      toolActions: [],
      suggestedQuestions: ["What is the same-scope cash price and the lender's comparison rate, fees, balloon and total repayment?"],
    });
  }

  const currentDomainIntent = assistantDomainIntent(query);
  const domainIntent = currentDomainIntent === "blocked"
    ? "out"
    : playbookId || wholeHomeConversation !== query || (retrievalQuery !== query && looksLikeTerseFollowUp)
      ? "in"
      : currentDomainIntent;
  if (domainIntent === "out") {
    return structured(options.audience === "trade" ? "trades" : "comfort_fabric", {
      directAnswer:
        "Surge only covers Australian home energy, electrification, building performance, current assistance programmes and role-safe TLink or Creditex help. I cannot answer that unrelated request or leave this scope.",
      status: "needs_context",
      citations: [],
      confidence: "low",
      assumptions: ["No Australian home-energy or TLink task was identified."],
      practicalSteps: ["Choose one relevant home, equipment, bill, programme or trade-platform decision."],
      toolActions: [],
      suggestedQuestions: [
        "Why is one room uncomfortable and what should I check first?",
        "How do I compare two energy-upgrade quotes without choosing by brand?",
        "Which rebate facts are needed for my postcode?",
      ],
    });
  }
  if (domainIntent === "ambiguous") {
    return structured("comfort_fabric", {
      directAnswer:
        "Which Australian household-energy decision do you mean: comfort, electricity use, equipment, solar, a programme, or a TLink trade task? Tell me the outcome you want and I will narrow it one step at a time.",
      status: "needs_context",
      citations: [],
      confidence: "low",
      practicalSteps: ["Name the home, equipment, bill, programme or trade task you are trying to decide."],
      toolActions: [],
      suggestedQuestions: [
        "How can I make my home more comfortable?",
        "Which appliance or tariff is driving my bill?",
        "What do I need before requesting an upgrade quote?",
      ],
    });
  }

  if (/\b(?:NatHERS|home energy rating|assessor|evidence)\b/i.test(query)
    && /\b(?:wall|ceiling|floor|roof)\s+insulation\b/i.test(query)
    && /\b(?:cannot see|can't see|not visible|inaccessible|concealed|unknown|evidence|prove|verify)\b/i.test(query)) {
    return structured("nathers", {
      directAnswer:
        "An accredited NatHERS assessor must not invent concealed insulation. Use the strongest available source evidence, such as approved plans and specifications, dated installation records, clear construction photos or a safe accessible inspection that can be tied to the exact building element. Thermal images, owner statements or a small visible sample may support an investigation but do not automatically prove complete coverage or R-value. If the construction still cannot be verified, record the area as inaccessible or unknown and apply the current accredited method's required default rather than assuming insulation is present.",
      status: "needs_context",
      citations: officialCitationsById(["nathers-technical-note", "nathers-guidance-note"]),
      confidence: "high",
      assumptions: ["No plans, installation record, construction photo, accessible inspection or current accredited-software default has been reviewed."],
      practicalSteps: [
        "Link each document or photo to the exact wall, ceiling, floor or roof element and date.",
        "Record inaccessible areas, conflicts and uncertainty instead of extending one observation across the dwelling.",
        "Use the current accredited Technical Note, Guidance Note and software default for every unresolved input.",
      ],
      toolActions: [{ id: "open-assessments", label: "Open the NatHERS assessment pathway", href: "/assessments" }],
      suggestedQuestions: ["What plans, invoices, construction photos or safely accessible parts can be tied to that exact building element?"],
    });
  }

  if (/\b(?:thermal|fabric|heating and cooling)\s+(?:stars?|rating|score)\b/i.test(query)
    && /\bwhole[- ]of[- ]home|whole home|whole[- ]home\b/i.test(query)) {
    return structured("nathers", {
      directAnswer:
        "They measure different parts of the official home rating. The thermal star result describes the modelled heating and cooling load created by the building fabric, orientation and climate under standard assumptions. The whole-of-home result adds the assessed fixed equipment and on-site energy factors, including relevant heating, cooling, hot water, appliances, solar and storage inputs. Neither is a prediction of the occupants' actual bill or behaviour, and both require the current accredited whole-dwelling evidence and software pathway.",
      status: "answered",
      citations: officialCitationsById(["nathers-certificate", "nathers-technical-note", "nathers-guidance-note"]),
      confidence: "high",
      assumptions: ["The question concerns the current NatHERS existing-home certificate rather than an unrelated state scorecard."],
      practicalSteps: [
        "Use the thermal result to understand the fabric heating and cooling demand.",
        "Use the whole-of-home result to review the assessed fixed systems and on-site energy inputs.",
        "Keep actual bills and occupant behaviour as separate measured evidence.",
      ],
      toolActions: [{ id: "open-assessments", label: "Open the rating pathway", href: "/assessments" }],
      suggestedQuestions: ["Are you reading a current NatHERS certificate or comparing it with another state rating scheme?"],
    });
  }

  if (/\b(?:Victoria|Victorian|VIC)\b/i.test(query)
    && /\b(?:rent|rental|renter|tenant)\b/i.test(query)
    && /\b(?:electrical|electricity|switchboard|wiring|socket|power point|shock|sparking)\b/i.test(query)
    && /\b(?:safe|safety|fault|issue|repair|who pays|responsible|landlord|owner)\b/i.test(query)) {
    return structured("renters_strata", {
      directAnswer:
        "Do not repair or test a suspected rental electrical fault yourself. Keep clear, stop using affected equipment if that is safe, and call 000 or the electricity network for immediate danger. Notify the Victorian rental provider or agent in writing with the fault and time; responsibility and the urgent-repair process depend on the actual defect and tenancy facts, so use the current Consumer Affairs Victoria pathway rather than agreeing to pay or arranging fixed work without authority.",
      status: "needs_context",
      citations: officialCitationsById(["vic-rental-minimum-energy-standards"]),
      confidence: "high",
      assumptions: ["The electrical condition, urgency, lease, prior damage and current repair notice have not been inspected."],
      practicalSteps: [
        "Keep people away and use emergency services or the network if there is shock, sparking, smoke, heat or exposed live equipment.",
        "Send the owner or agent a dated written fault notice without opening or altering electrical equipment.",
        "Use the current Victorian urgent-repair or dispute pathway and a licensed electrician for the work.",
      ],
      toolActions: [],
      suggestedQuestions: ["Is there immediate danger such as shock, sparking, smoke, heat or exposed wiring, or is the fault currently isolated?"],
    });
  }

  if (/\b(?:rent|rental|renter|tenant|bond|no drilling|cannot drill|can't drill|no permanent changes?)\b/i.test(query)
    && /\b(?:draught|draft|window|bubble wrap|cold room|hot room|overheat|portable|temporary|reversible|door)\b/i.test(query)
    && !/\b(?:condensation|condense|mould|mold|damp)\b/i.test(query)) {
    const windowFilmQuestion = /\bbubble wrap\b/i.test(query);
    const coldPortableQuestion = /\b(?:portable|one cold room|cold room|no drilling)\b/i.test(query)
      && /\b(?:cold|heat|heater|warm|winter|option)\b/i.test(query);
    const renterSource = rentalSafetySourceId(query);
    return structured("renters_strata", {
      directAnswer: windowFilmQuestion
        ? "Bubble wrap can add a still-air layer, but it is not a universal rental-window fix. It can trap condensation, create uneven solar heating and thermal-stress risk on unsuitable glass, affect visibility or safety glazing, leave residue, interfere with opening and conflict with a glass or window warranty. Start with removable close-fitting curtains and a safe pelmet, draught control and exterior shade where permitted. Use a temporary glazing product only with written permission and confirmation from the product and window guidance that it suits the exact glass, frame, egress and moisture conditions."
        : coldPortableQuestion
          ? "Use safe, removable measures for one cold rental room with no drilling. Start with the occupied person and confirmed heat losses: close a removable well-fitted curtain, use a door snake only on an unintended gap, warm the occupied zone with a compliant portable electric heater used exactly to its instructions, and never use an unflued gas heater or a powerboard for a high-load heater. Portable air conditioners or heat pumps need a safe window duct and can be noisy and less efficient. Use the current official tenancy process for inadequate fixed heating, unsafe equipment or building defects."
          : "Use reversible heat control that will not damage the rental: a removable door snake on a confirmed unintended gap, close-fitting curtains, and portable shade or a fan where stable and safe. Do not block a designed door undercut, vent, flue or egress path, and do not attach film, seals or hardware until the exact glass, surface, lease and written permission are checked. Record fixed defects for the owner or agent through the current state rental repair or alteration pathway.",
      status: "needs_context",
      citations: officialCitationsById([
        ...(renterSource ? [renterSource] : ["energy-gov-renters"]),
        "energy-gov-windows",
        "yourhome-ventilation-airtightness",
      ]),
      confidence: "medium",
      assumptions: ["The state, window or door purpose, heater, moisture, surface condition and lease permissions have not been verified."],
      practicalSteps: [
        "Identify whether the problem is an unintended air gap, cold surface, direct sun or inadequate fixed equipment.",
        "Test one removable measure without covering vents, flues, egress, drainage or heater clearances.",
        "Seek written permission for adhesives or fixed work and report unsafe or defective building elements in writing.",
      ],
      toolActions: [{ id: "open-home-plan", label: "Build a renter-safe comfort plan", href: "/plan" }],
      suggestedQuestions: ["Which state, room, window or door and existing heater or cooling option apply?"],
    });
  }

  if (/\bpassword[- ]?protected|encrypted|locked PDF\b/i.test(query) && /\bPDF\b/i.test(query)) {
    return structured("products_ratings", {
      directAnswer:
        "No. The local checker cannot open or decrypt a password-protected PDF. The assistant will not ask you to send the password and will not upload the document to a server. Ask the issuer for an accessible text PDF, or create a necessary redacted unprotected copy on your own device, verify it against the original and then select that local copy. A readable quote still does not prove product eligibility, installation quality or compliance.",
      status: "needs_context",
      citations: [],
      confidence: "high",
      assumptions: ["The file has not been opened, decrypted or uploaded by the assistant."],
      practicalSteps: [
        "Do not share the PDF password in chat.",
        "Request an accessible text PDF or make a minimal redacted copy locally with authority to do so.",
        "Verify the copy against the original before local quote analysis.",
      ],
      toolActions: [],
      suggestedQuestions: ["Can the issuer provide an accessible text PDF without unnecessary personal information?"],
    });
  }

  if (/\b(?:quote|PDF|document|file|local checker|quote checker|raw bytes?|extracted (?:text|lines?))\b/i.test(query)
    && /\b(?:saved|stored|stays?|remain|history|chat|conversation|server|privacy|device|browser|enter|leaves?|go(?:es)? anywhere|summary|difference|plain English|mean)\b/i.test(query)
    && !/\b(?:NEM12|NMI|CSV|OCR|photo|image|scan(?:ned)?)\b/i.test(query)) {
    return structured("products_ratings", {
      directAnswer:
        "The selected document bytes and raw extracted text stay in the browser on the device; they are not sent to the assistant server. A bounded derived summary enters the question or chat only when the user reviews and chooses to send it. The current typed question and bounded recent typed context are processed statelessly for the answer, while local chat persistence on that browser is separate. A lead is another explicit consent step and does not automatically include the raw file, extracted lines, NMI or chat transcript.",
      status: "answered",
      citations: [],
      confidence: "high",
      assumptions: ["No file has been selected and no private quote text has been pasted into this conversation."],
      practicalSteps: [
        "Keep raw bytes and extracted text in the local checker.",
        "Review and minimise the derived summary before sending it into chat.",
        "Review lead fields separately before any explicit submission.",
      ],
      toolActions: [],
      suggestedQuestions: ["Do you want to compare equipment, scope, warranty, exclusions or financial assumptions from the redacted summary?"],
    });
  }

  if (/\b(?:compare|review|check)\b/i.test(query)
    && /\b(?:two|2|both|these)\b/i.test(query)
    && /\bPDF\b/i.test(query)
    && /\bquotes?\b/i.test(query)) {
    return structured("products_ratings", {
      directAnswer:
        "Yes, compare the two supported text PDFs locally, one at a time. Keep the raw files and extracted text in the browser, review each redacted derived summary, then compare the same fields: exact models, capacities, site assumptions, included electrical or building work, commissioning, warranties, exclusions, certificate or rebate treatment and total cash price. Missing model IDs, conflicting assumptions or unsupported performance claims stay blockers rather than being guessed.",
      status: "needs_context",
      citations: officialCitationsById(["energy-rating-product-register", "accc-consumer-guarantees"]),
      confidence: "high",
      assumptions: ["Neither PDF has been locally checked and the equipment category and decision have not been supplied."],
      practicalSteps: [
        "Run each original text PDF through the local checker and review its redacted summary.",
        "Align equivalent scope, models, assumptions, exclusions and cash price in one comparison.",
        "Verify exact products and regulated claims in the current official sources before acceptance.",
      ],
      toolActions: [],
      suggestedQuestions: ["What equipment or upgrade are the two quotes for, and which decision matters most?"],
    });
  }

  if (/\b(?:photo|image|picture)\b/i.test(query)
    && /\b(?:switchboard|meter box|wiring|electrical panel)\b/i.test(query)
    && /\b(?:safe|safety|compliant|prove|evidence|upload|check|inspect)\b/i.test(query)) {
    return structured("safety_consumer_rights", {
      directAnswer:
        "Do not rely on a switchboard photo to prove electrical safety or compliance. The local checker does not accept photos, and an image cannot establish concealed wiring, protection operation, earthing, fault current, maximum demand, labelling or test results. Keep clear of live parts and covers, describe any visible fault without touching equipment, and use a licensed electrician for an on-site inspection and documented testing.",
      status: "needs_context",
      citations: officialCitationsById(["cer-small-scale-system-requirements"]),
      confidence: "high",
      assumptions: ["No photo or switchboard has been inspected and no electrical test evidence is available."],
      practicalSteps: [
        "Do not remove covers or approach exposed, hot, damaged, smoking or sparking equipment.",
        "Record the concern from a safe distance without customer identifiers.",
        "Arrange a licensed on-site electrical inspection and keep its test record.",
      ],
      toolActions: [],
      suggestedQuestions: ["Is there immediate danger such as exposed live parts, shock, sparking, smoke or heat?"],
    });
  }

  if (options.audience === "trade"
    && /\b(?:draught|draft)[ -]?(?:proof|proofing|seal|sealing)\b/i.test(query)
    && /\b(?:job|scope|work|Victorian|Victoria|VEU)\b/i.test(query)
    && !(/\bdraft\b[^\n]{0,40}\b(?:proof|evidence|note|record)\b/i.test(query)
      && /\b(?:TLink|Creditex|compliance|job)\b/i.test(query)
      && !/\b(?:draught[ -]?(?:proof|proofing|seal|sealing)|air leak|weatherstripp?ing)\b/i.test(query))) {
    return structured("trades", {
      directAnswer:
        "Treat this as draught-sealing scope, not a request to draft compliance proof. Identify each confirmed unintended leakage path, the existing ventilation and any combustion equipment, then specify the exact removable or permanent seal, substrate preparation, access, exclusions and post-work checks. Do not seal permanent vents, flues, designed door undercuts or moisture paths. If the job seeks VEU or another certificate outcome, select the exact current activity and work pack before work and keep any missing evidence or approval blocked.",
      status: "needs_context",
      citations: officialCitationsById(["yourhome-ventilation-airtightness", "energy-gov-insulation-draught-proofing"]),
      confidence: "high",
      assumptions: ["The property, heater, leakage test, ventilation design and programme activity have not been inspected."],
      practicalSteps: [
        "Map confirmed unintended leakage separately from designed ventilation, combustion and moisture paths.",
        "Write each substrate, product, access, exclusion and verification check into the scope.",
        "Bind any programme claim to its current activity, version and evidence pack before work starts.",
      ],
      toolActions: [{ id: "open-creditex-compliance", label: "Open governed work packs", href: "/creditex/compliance" }],
      suggestedQuestions: ["Is this ordinary draught-sealing work or a named programme activity, and what heating or combustion equipment is present?"],
    });
  }

  if (options.audience === "trade"
    && /\b(?:registry|register|submission|queue|pending|stuck)\b/i.test(query)
    && /\b(?:certify|certificate|submit|approve|sign off|continue|proceed)\b/i.test(query)) {
    return structured("trades", {
      directAnswer:
        "No. A registry or submission queue that is pending, stuck or unconfirmed is not authority to certify, duplicate-submit or mark the job complete. Preserve the submission ID, status, timestamp, programme version and error response; verify the current official registry status and escalate through the platform or programme support path. Keep certificate creation and any customer claim blocked until the authoritative status is confirmed and the audit trail shows the permitted next action.",
      status: "source_review_required",
      citations: [],
      confidence: "high",
      assumptions: ["The private submission, programme, registry response and current status have not been opened."],
      practicalSteps: [
        "Do not certify, resubmit or alter the job solely to clear the queue.",
        "Record the submission ID, programme, version, timestamps and exact status or error.",
        "Escalate through the authorised platform or registry path and wait for an authoritative outcome.",
      ],
      toolActions: [{ id: "open-creditex-compliance", label: "Open compliance submissions", href: "/creditex/compliance" }],
      suggestedQuestions: ["Which programme, registry, submission ID and exact status or error are recorded?"],
    });
  }

  if (options.audience === "trade"
    && /\bEV\s*1\s*(?:vs\.?|versus|or|\/|and)\s*EV\s*2\b/i.test(query)
    && /\b(?:platform|application|stage|evidence|form|job|Creditex|TLink)\b/i.test(query)) {
    return structured("trades", {
      directAnswer:
        "Here EV1 and EV2 are being treated as platform or programme stage labels, not vehicle models or charging levels. Do not choose a stage from the label alone. Open the exact job's governed work pack, confirm the programme, activity, implementation date and current version, then use the stage definition and evidence fields shown there. If that mapping is absent or stale, keep the job blocked and escalate it rather than moving evidence into another stage.",
      status: "needs_context",
      citations: [],
      confidence: "high",
      assumptions: ["The private job, programme and current EV1 or EV2 stage definitions have not been opened."],
      practicalSteps: [
        "Open the exact job and its current governed work pack.",
        "Confirm programme, activity, date, version and the stage attached to each evidence field.",
        "Keep the job blocked if EV1 or EV2 is not defined in that current pack.",
      ],
      toolActions: [{ id: "open-creditex-compliance", label: "Open governed evidence", href: "/creditex/compliance" }],
      suggestedQuestions: ["Which programme, activity and work-pack version displays EV1 and EV2?"],
    });
  }

  const gasDailySupplyCents = numericCapture(query, /\b([\d,]+(?:\.\d+)?)\s*(?:c|cents?)\s*(?:\/|per|a)\s*day\b/i);
  const gasDailySupplyDollars = numericCapture(query, /\$\s*([\d,]+(?:\.\d+)?)\s*(?:\/|per|a)\s*day\b/i);
  if (/\bgas\b/i.test(query)
    && /\b(?:daily supply|supply charge|service charge|fixed charge|final|last)\b/i.test(query)
    && /\b(?:save|saving|savings|include|avoid|disconnect|remove|appliance)\b/i.test(query)) {
    const dailyDollars = gasDailySupplyDollars ?? (gasDailySupplyCents === null ? null : gasDailySupplyCents / 100);
    const annualSupply = dailyDollars === null ? null : dailyDollars * 365;
    return structured("bills_tariffs", {
      directAnswer:
        `${annualSupply === null ? "Annual avoided gas supply cost is the daily supply charge multiplied by 365" : `The supplied daily charge is about $${annualSupply.toLocaleString("en-AU", { maximumFractionDigits: 2 })} a year`}, but count it as a saving only if the final gas appliance is removed and the gas account or service is actually disconnected so the charge stops. Include any disconnection or abolishment cost, contract or final-bill charges and future reconnection risk separately. If any gas use or account remains, the daily supply charge is not avoided.`,
      status: annualSupply === null ? "needs_context" : "answered",
      citations: officialCitationsById(["aer-understanding-energy-bill", "energy-made-easy-current-plan-comparison"]),
      confidence: "medium",
      assumptions: ["The retailer tariff, actual disconnection process, residual gas equipment and disconnection or abolishment fees have not been verified."],
      practicalSteps: [
        "Confirm every gas appliance will be removed and whether the retailer or distributor ends the daily charge.",
        "Calculate daily charge times 365 and show disconnection, abolishment and final-bill costs separately.",
        "Keep appliance energy savings separate from the avoided fixed charge.",
      ],
      toolActions: [{ id: "compare-electricity", label: "Compare the complete bills", href: "/compare" }],
      suggestedQuestions: ["What daily gas supply charge and one-off disconnection or abolishment cost are quoted?"],
    });
  }

  if (/\bEV\b/i.test(query)
    && /\b(?:most|more)\s+efficient|best efficiency|lowest energy use\b/i.test(query)
    && !suppliedVehicleComparisonRows(query).length) {
    return structured("ev_charging", {
      directAnswer:
        "There is no independent answer from the model family name alone. Compare exact model-year variants on the same official test cycle using Wh/km or kWh/100 km; the lower figure is more energy efficient on that like-for-like test. Certified range is a separate fact, and neither number proves real-world range, charging cost, safety, reliability, value or the best vehicle for a household.",
      status: "needs_context",
      citations: officialCitationsById(["green-vehicle-guide-compare"]),
      confidence: "high",
      assumptions: ["No two exact same-cycle vehicle variants and official energy-use rows have been supplied."],
      practicalSteps: [
        "Identify the exact model year and variant for each vehicle.",
        "Copy same-cycle official Wh/km and certified range values.",
        "Compare annual energy separately from purchase, charging access, space, safety and ownership costs.",
      ],
      toolActions: [{ id: "open-ev-guide", label: "Open the EV comparison guide", href: "/guides/ev-charging" }],
      suggestedQuestions: ["Which exact model-year variants and same-cycle Wh/km figures do you want compared?"],
    });
  }

  if (/\b(?:fibre[ -]?cement|fiber[ -]?cement)\b/i.test(query)
    && /\b(?:new|modern|current|cladding|sheeting|thermal|insulation|R-value|heat|performance|wall|roof)\b/i.test(query)) {
    return structured("insulation", {
      directAnswer:
        "For confirmed modern fibre-cement construction, assess thermal performance as a complete wall or roof assembly rather than from the sheet alone. Cladding, cavity, bulk insulation, framing, membranes, junctions, air leakage and moisture or fire details determine the system result. Obtain the exact product and assembly data, then compare completed system R-value and continuity for the climate. This answer does not identify old sheeting by sight; suspected legacy material must be assessed before disturbance.",
      status: "needs_context",
      citations: officialCitationsById(["yourhome-construction-systems", "yourhome-insulation"]),
      confidence: "medium",
      assumptions: ["The material is being discussed without a disturbance request and has not been independently identified or inspected."],
      practicalSteps: [
        "Confirm the exact product, installation date and complete wall or roof build-up.",
        "Compare system R-value, insulation continuity, framing, cavity and moisture details.",
        "Use an asbestos assessment before any disturbance if the age or identity is uncertain.",
      ],
      toolActions: [{ id: "open-home-plan", label: "Map the building assembly", href: "/plan" }],
      suggestedQuestions: ["Is this confirmed new material, and what complete wall or roof build-up and climate apply?"],
    });
  }

  if (/\bTLink\b/i.test(query)
    && /\b(?:invite|add|onboard|give access|login)\b/i.test(query)
    && /\b(?:apprentice|worker|employee|staff|team member|technician|teammate)\b/i.test(query)) {
    return structured("trades", {
      directAnswer:
        "In the signed-in TLink dashboard, open Team, choose Add team member, enter the apprentice's details and services, and give only the access they need. Add their email before saving if they need a login; TLink then displays a private link to copy and send only to that person, and it expires after seven days. For a roster-only member added without email, edit the member later, add the email and choose Create login link. Only the owner or a member with team-management access can add them, and only an owner or delegated access manager can grant permissions.",
      status: "answered",
      citations: [],
      confidence: "high",
      assumptions: ["No private team record was opened or changed, and the requester is not assumed to have team-management permission."],
      practicalSteps: [
        "Open TLink dashboard, then Team, and add the apprentice with their real name, services and email only if a login is required.",
        "Apply assigned-job and least-privilege access, save the member, then copy the displayed private login link.",
        "Send the link only to that person and verify their access before assigning work or evidence tasks.",
      ],
      toolActions: [{ id: "open-trade-team", label: "Open TLink team management", href: "/direct-trade/dashboard" }],
      suggestedQuestions: ["Should the apprentice see only assigned jobs, or do they need any additional schedule, customer, quote or field-evidence access?"],
    });
  }

  if (/\b(?:NSW|New South Wales)\b/i.test(query)
    && /\b(?:air conditioner|air conditioning|aircon|RCAC|reverse[ -]cycle|split system)\b/i.test(query)
    && /\b(?:evidence|photos?|photographs?|images?|prove|proof)\b/i.test(query)) {
    return structured("trades", {
      directAnswer:
        "There is no single safe NSW air-conditioner photo list. The required evidence depends on whether the job uses ESS or PDRS, the exact current activity or method, implementation date, baseline equipment and generated work pack. Select that pathway first, then follow every required before, installation and after field in its current guide. Keep original unedited files and capture model, serial, replaced equipment, installed equipment, site context, decommissioning and commissioning only where the selected instrument requires them. Do not invent a generic photo pack or call it compliant before authorised review.",
      status: "needs_context",
      citations: officialCitationsById(["nsw-ess-rule-current-2026", "nsw-pdrs-rule-current-2026"]),
      confidence: "high",
      assumptions: ["The scheme, activity, implementation date, baseline, work-pack version and evidence fields have not been selected."],
      practicalSteps: [
        "Choose ESS or PDRS, the exact current activity or method and the implementation date before capture begins.",
        "Open the governed work pack and capture each required original view with its required time, location, product and job provenance.",
        "Preserve originals and submit the complete pack for authorised review; missing evidence stays a blocker.",
      ],
      toolActions: [{ id: "open-creditex-compliance", label: "Open governed evidence work packs", href: "/creditex/compliance" }],
      suggestedQuestions: ["Is this an ESS or PDRS job, what exact activity or method applies, and what is the implementation date?"],
    });
  }

  if (/\b(?:VEU|VEECs?|Victorian Energy Upgrades)\b/i.test(query)
    && /\b(?:evidence|photos?|forms?|maintenance|service|repair|admin|paperwork|current|version|guide|decommission|invoice|creation form)\b/i.test(query)) {
    const veuSummary = governedSummaryById("veu-water-space-activity-guide-v3-19");
    const veuVersion = veuSummary?.match(/\bVersion\s+([\d.]+)/i)?.[1] || null;
    if (!veuSummary || !veuVersion) {
      return structured("trades", {
        directAnswer:
          "I cannot state a current VEU activity-guide version from an inactive, stale, discovery-only or missing local fact. Keep the job blocked, open the Essential Services Commission's current water-heating and space-heating or cooling guide, and bind its exact version and effective date to the activity before deciding product, co-payment, warranty, decommissioning, invoice, creation-form or evidence fields.",
        status: "source_review_required",
        citations: [],
        confidence: "high",
        assumptions: ["No active governed local VEU activity-guide fact is available for this answer."],
        practicalSteps: [
          "Open the ESC's current activity guide and record its exact version and effective date.",
          "Select the activity, installation date, replaced and installed products and current work pack.",
          "Keep eligibility and submission blocked until the authorised reviewer confirms every required field and original evidence item.",
        ],
        toolActions: [{ id: "open-creditex-compliance", label: "Open governed VEU work packs", href: "/creditex/compliance" }],
        suggestedQuestions: ["What exact VEU activity and installation date apply?"],
      });
    }
    return structured("trades", {
      directAnswer:
        `The active reviewed local fact identifies VEU activity guide version ${veuVersion}. Use that only for the exact water-heating or space-heating and cooling activity and installation date it governs. A service, maintenance or admin record is not automatically installation evidence or a VEEC entitlement. Resolve the replaced equipment, exact approved product, licences, limits, co-payment, warranty, decommissioning, original evidence, invoice and creation-form fields from the current work pack, and leave any missing item blocked for authorised review.`,
      status: "needs_context",
      citations: officialCitationsById(["veu-water-space-activity-guide-v3-19"]),
      confidence: "high",
      assumptions: ["The exact activity, installation date, products, participants and current work-pack fields have not been supplied."],
      practicalSteps: [
        "Bind VEU guide version " + veuVersion + " and its effective date to the exact job activity.",
        "Capture only the current work-pack fields and original evidence for the actual installation event.",
        "Keep every missing, maintenance-only or unverified item as a blocker until authorised review.",
      ],
      toolActions: [{ id: "open-creditex-compliance", label: "Open governed VEU work packs", href: "/creditex/compliance" }],
      suggestedQuestions: ["What exact activity, installation date and current work-pack version are attached to the job?"],
    });
  }

  if (/\b(?:local|browser|on my device|without upload(?:ing)?|not upload(?:ed|ing)?)\b/i.test(query)
    && /\b(?:checker|check|inspect|analyse|analyze|read|open|process)\b/i.test(query)
    && /\bNEM12\b/i.test(query)) {
    return structured("bills_tariffs", {
      directAnswer:
        "Yes. Choose the NEM12 file in the guide's local CSV checker. Analysis runs in this browser and the file and raw rows are not uploaded or stored by the assistant server. The checker validates the NEM12 structure, interval and channel declarations, quality and coverage, then reports a redacted load-shape summary without returning the NMI or meter identifiers. Missing or ambiguous intervals stay visible rather than being filled or guessed.",
      status: "answered",
      citations: officialCitationsById(["aemo-mdff-nem12-nem13-v2-7"]),
      confidence: "high",
      assumptions: ["No file has been selected, and no interval coverage, channel meaning or data quality has been validated."],
      practicalSteps: [
        "Open Check a quote or interval file locally and choose the original NEM12 CSV or text file.",
        "Review channel units, date coverage, missing intervals, quality flags and the redacted import or export summary.",
        "Use only the derived load shape for the next tariff or appliance question and keep identifiers out of chat.",
      ],
      toolActions: [{ id: "compare-electricity", label: "Open the local interval checker", href: "/compare" }],
      suggestedQuestions: ["After the local check, do you want to investigate baseload, time-of-use exposure, solar export or a tariff comparison first?"],
    });
  }

  if (/\b(?:scanned|image[ -]only|scan of|photographed)\b/i.test(query)
    && /\bPDF\b/i.test(query)
    && /\b(?:local|checker|check|analyse|analyze|read|review|upload)\b/i.test(query)
    && !/\b(?:Word|DOCX?|Excel|XLSX?|XLS|HEIC|ZIP)\b/i.test(query)) {
    return structured("products_ratings", {
      directAnswer:
        "No. The local checker reads bounded text-based PDFs and does not run OCR, so it rejects a scanned or image-only PDF rather than guessing from pixels. Ask the supplier for the original accessible text PDF, or create an OCR text copy on your own device and check it carefully against the original before selecting it. Remove unnecessary personal information first. A converted file can support a quote review, but it does not prove the quote, product or installation is compliant.",
      status: "needs_context",
      citations: [],
      confidence: "high",
      assumptions: ["The PDF has not been selected and no OCR text has been verified against the original pages."],
      practicalSteps: [
        "Request the original text PDF from the issuer where possible.",
        "If local OCR is necessary, keep it on your device, compare every material value with the original and redact personal identifiers.",
        "Choose the verified text PDF in the local checker; do not paste the document into chat.",
      ],
      toolActions: [],
      suggestedQuestions: ["Can the issuer provide the original text PDF, or do you need the minimum fields to verify after local OCR?"],
    });
  }

  if (/\bNMI\b/i.test(query)
    && /\b(?:local|browser|device|upload|server|checker|analyse|analyze|process)\b/i.test(query)) {
    return structured("bills_tariffs", {
      directAnswer:
        "No. The raw NMI, selected NEM12 or supported CSV file and raw rows do not leave the browser for assistant analysis. The local checker keeps them on the device and returns only a redacted derived summary that excludes the NMI and meter identifiers. Nothing further is shared unless the user deliberately copies reviewed facts into chat or explicitly submits selected lead fields. Do not paste an NMI, account number or address into the conversation.",
      status: "answered",
      citations: officialCitationsById(["aemo-mdff-nem12-nem13-v2-7"]),
      confidence: "high",
      assumptions: ["No file has been selected and its format, channels, coverage and quality flags have not been validated."],
      practicalSteps: [
        "Choose the original supported NEM12 or interval CSV in the local checker.",
        "Review the redacted summary and confirm the interval units, channels, coverage and missing-data warnings.",
        "Share only a necessary derived summary after checking that it contains no customer identifiers.",
      ],
      toolActions: [{ id: "compare-electricity", label: "Open the local interval checker", href: "/compare" }],
      suggestedQuestions: ["Is the file NEM12 or a header-based interval CSV, and what load question do you want it to answer?"],
    });
  }

  if (/\bNMI\b/i.test(query)
    && /\b(?:data|file|intervals?|read|open|check|inspect|review|analyse|analyze|use)\b/i.test(query)) {
    return structured("bills_tariffs", {
      directAnswer:
        "Use the local interval checker, not chat or a server upload. Select a supported NEM12 or interval CSV in the browser; the raw file stays on the device, and the returned summary excludes the NMI and meter identifiers. The NMI itself is not needed for energy advice. Review the redacted derived result before sharing it and keep names, addresses, account numbers and identifiers out of the conversation.",
      status: "answered",
      citations: officialCitationsById(["aemo-mdff-nem12-nem13-v2-7"]),
      confidence: "high",
      assumptions: ["The file format, interval channels, coverage and quality flags have not been validated."],
      practicalSteps: [
        "Choose the supported file in the browser's local checker.",
        "Verify channels, units, coverage, quality warnings and the redacted summary.",
        "Share only the minimum derived load-shape facts needed for the next question.",
      ],
      toolActions: [{ id: "compare-electricity", label: "Open the local interval checker", href: "/compare" }],
      suggestedQuestions: ["Is it NEM12 or a header-based interval CSV, and what load question should the redacted summary answer?"],
    });
  }

  if (/\bNEM12\b/i.test(query)
    && /\b(?:read|open|check|inspect|analyse|analyze|process|use|review)\b/i.test(query)) {
    return structured("bills_tariffs", {
      directAnswer:
        "Yes, through the local interval checker. Select the original NEM12 file in the browser; its bytes and raw rows stay on the device and are not uploaded to the assistant server. The checker validates interval, channel, unit, quality and coverage fields and returns a redacted derived load-shape summary without the NMI. Missing or ambiguous intervals are not guessed and remain visible as warnings.",
      status: "answered",
      citations: officialCitationsById(["aemo-mdff-nem12-nem13-v2-7"]),
      confidence: "high",
      assumptions: ["No file has been selected and no interval, channel or quality field has been validated."],
      practicalSteps: [
        "Choose the original NEM12 file in the local checker.",
        "Review its units, channels, coverage, quality flags and redaction warning.",
        "Use only the derived summary for the next energy question and keep customer identifiers out of chat.",
      ],
      toolActions: [{ id: "compare-electricity", label: "Open the local interval checker", href: "/compare" }],
      suggestedQuestions: ["Do you want the redacted result used for baseload, tariff exposure, solar export or another load-shape question?"],
    });
  }

  if (/\b(?:Word|DOCX?|Excel|XLSX?|XLS|HEIC|ZIP)\b/i.test(query)
    && /\b(?:file|document|spreadsheet|upload|attach|read|check|review|analyse|analyze|checker)\b/i.test(query)) {
    return structured("products_ratings", {
      directAnswer:
        "No. The local file checker does not read DOC or DOCX Word files, XLS or XLSX workbooks, HEIC or other image files, scanned PDFs or ZIP archives. It accepts one bounded text-based PDF quote at a time and supported CSV, NEM12 or Green Vehicle Guide CSV data; it does not run OCR or unpack archives. Export only the necessary table to a plain CSV, or ask the issuer for an accessible text PDF, then verify the conversion against the original and remove personal identifiers before selecting it.",
      status: "needs_context",
      citations: [],
      confidence: "high",
      assumptions: ["No file has been selected and no conversion has been verified against the original."],
      practicalSteps: [
        "Keep the original document unchanged and export only the necessary non-identifying data locally.",
        "Verify every converted heading, unit and value against the original.",
        "Select the supported CSV, NEM12 or text PDF in the local checker rather than pasting private content into chat.",
      ],
      toolActions: [],
      suggestedQuestions: ["Is the source a quote that can be supplied as a text PDF, or interval data that can be exported as CSV or NEM12?"],
    });
  }

  if (/\b(?:lead|referral|quote request|enquiry)\b/i.test(query)
    && /\b(?:sent|send|submitted|shared|forwarded|already went|went through)\b/i.test(query)
    && /\b(?:withdraw|unsend|recall|cancel|delete|correct|wrong|mistake|change)\b/i.test(query)) {
    return structured("trades", {
      directAnswer:
        "A submitted lead has already been sent to the selected trade and there is no withdrawal or unsend function. Do not tell the customer it was recalled or erased. Send the receiving trade a clear correction immediately, identify which details are wrong and what should replace them, and tell the customer what was corrected. If the lead exposed information without consent or creates a safety or privacy risk, contact platform support as an incident as well.",
      status: "answered",
      citations: [],
      confidence: "high",
      assumptions: ["The private lead record has not been opened and the receiving trade has not been contacted by this answer."],
      practicalSteps: [
        "Write the exact correction without repeating unnecessary personal information.",
        "Send it to the receiving trade through the available lead conversation or support path and record the time.",
        "Notify the customer of the correction and escalate any consent, privacy or safety incident to platform support.",
      ],
      toolActions: [],
      suggestedQuestions: ["Which facts are wrong, and does the correction involve consent, contact details, site safety or only the requested work?"],
    });
  }

  const explicitlySuppliedProgrammeJurisdiction = explicitProgramJurisdiction(query);
  if (/\b(?:VEU|VEECs?|Victorian Energy Upgrades)\b/i.test(query)
    && explicitlySuppliedProgrammeJurisdiction
    && !["VIC", "AU"].includes(explicitlySuppliedProgrammeJurisdiction[0])) {
    return structured("rebates_certificates", {
      directAnswer:
        `No. Victorian Energy Upgrades is a Victorian programme, so a property in ${explicitlySuppliedProgrammeJurisdiction[1]} cannot receive VEU certificates for that installation. Do not substitute a federal or another state's scheme as if it were VEU. Check the current assistance and certificate pathways that actually apply to the property's jurisdiction, technology, applicant and installation date.`,
      status: "answered",
      citations: officialCitationsById(["veu-water-space-activity-guide-v3-19", "energy-gov-rebates"]),
      confidence: "high",
      assumptions: [`The installation property is in ${explicitlySuppliedProgrammeJurisdiction[1]} as stated; no different Victorian project site has been supplied.`],
      practicalSteps: [
        "Use the installation property's state or territory, not the business address, to select the programme.",
        "Check any federal certificate pathway separately for the exact technology and date.",
        "Keep all state programme claims blocked until the current local programme identifies the project as eligible.",
      ],
      toolActions: [{ id: "open-rebates", label: "Check the correct jurisdiction", href: "/rebates" }],
      suggestedQuestions: ["What exact upgrade and installation date are proposed in that state or territory?"],
    });
  }

  if (/\b(?:battery|storage)\b/i.test(query)
    && /\b(?:STCs?|SRES|federal certificates?)\b/i.test(query)
    && /\b(?:already\s+)?(?:expanded|added|installed|extended|increased)|\bexpansion\b/i.test(query)) {
    return structured("rebates_certificates", {
      directAnswer:
        "Do not assume an existing battery expansion creates a new federal STC entitlement. The current CER pathway permits only one eligible battery system claim per premises, and eligibility depends on the dated installed configuration, approved components, capacity limits, accredited participants and complete evidence. Previously claimed modules or an already completed expansion must be reconciled against the original system and claim before any further certificate action. Keep the claim blocked until the current rule and exact configuration are verified.",
      status: "source_review_required",
      citations: officialCitationsById(["cer-solar-battery-requirements"]),
      confidence: "high",
      assumptions: ["The original claim, installed modules, dates, approved configuration and expansion evidence have not been verified."],
      practicalSteps: [
        "Record the original system, claim, modules, serials, installation date and the exact expansion.",
        "Check the complete configuration and installation dates against the current CER battery requirements.",
        "Do not create or assign more STCs until an authorised review confirms the treatment.",
      ],
      toolActions: [{ id: "open-calculator", label: "Check the battery certificate pathway", href: "/calculator" }],
      suggestedQuestions: ["What original battery configuration and STC claim, expansion date and added modules are recorded?"],
    });
  }

  if (/\b(?:STCs?|certificates?)\b/i.test(query)
    && /\b(?:add|added|adding|expand|expanded|expansion|extra|more|later)\b/i.test(query)
    && /\b(?:panels?|solar|PV|array|capacity)\b/i.test(query)) {
    return structured("rebates_certificates", {
      directAnswer:
        "Adding panels later is not automatically a new STC claim for all existing capacity. A governed calculation must isolate the newly eligible capacity and installation event, confirm the existing and added components, current product approvals, system design, accredited delivery, date and evidence, and prevent any certificate from being created twice for the same capacity. Keep the quantity and dollar discount separate and do not promise eligibility before the current CER pathway is checked.",
      status: "source_review_required",
      citations: officialCitationsById(["cer-stc-entitlement-calculation", "cer-small-scale-system-requirements"]),
      confidence: "high",
      assumptions: ["The original array, prior STC claim, proposed added capacity, products, installer and installation date have not been verified."],
      practicalSteps: [
        "Record the original panel and inverter configuration, original installation date and any prior STC assignment.",
        "Record only the exact new capacity, components and proposed installation event.",
        "Run the dated governed calculation and authorised evidence review before quoting certificates or a discount.",
      ],
      toolActions: [{ id: "open-calculator", label: "Check added solar capacity", href: "/calculator" }],
      suggestedQuestions: ["What existing panel and inverter capacity, prior STC claim, new capacity and installation date apply?"],
    });
  }

  if (/\bSTCs?\b/i.test(query)
    && (/\b(?:another|second|twice|double|duplicat(?:e|ed|ion)|two|both|again|already)\b/i.test(query)
      && /\b(?:rebate|discount|benefit|deduct|deducted|subtract|subtracts|subtracted|subtraction|line item|quote line|amount|value|GST)\b/i.test(query)
      || /\b(?:before|pre)\s+GST\b[\s\S]{0,100}\b(?:after|post)\s+GST\b/i.test(query)
      || /\bSTC\s+(?:rebate|discount)\b[^\n]{0,80}\bSTC\s+(?:rebate|discount)\b/i.test(query))) {
    return structured("rebates_certificates", {
      directAnswer:
        "Do not accept two reductions as separate STC benefits without a written reconciliation. One eligible installation creates one governed certificate entitlement for that system and date. A quote may show an estimated STC value, assignment to an agent and the resulting customer discount in more than one place, but it must not subtract the same value twice. Ask for the certificate quantity, the stated value per STC, the total assigned discount and a revised subtotal that proves whether the second line is only explanatory or a duplicate.",
      status: "needs_context",
      citations: officialCitationsById(["cer-stc-entitlement-calculation", "accc-solar-consumer-rights"]),
      confidence: "high",
      assumptions: ["The quote lines, certificate quantity, assignment terms and arithmetic have not been reviewed."],
      practicalSteps: [
        "Circle every rebate, certificate, discount and subtotal line and identify which lines change the amount payable.",
        "Require one certificate quantity, stated STC value and total assignment discount with no duplicate subtraction.",
        "Compare the revised quote with the governed calculator before signing an assignment or contract.",
      ],
      toolActions: [{ id: "open-calculator", label: "Check the STC quantity separately", href: "/calculator" }],
      suggestedQuestions: ["What certificate quantity, value per STC and two quote line amounts are shown?"],
    });
  }

  if (/\b(?:funding|grant|rebate|loan|incentive|programme|program|scheme)\b/i.test(query)
    && /\b(?:body corporate|owners corporation|strata|landlord|conditional approval|pre[ -]?approval|approval before|installed already|start work|signed already)\b/i.test(query)
    && /\b(?:override|skip|without|enough|permission|approval|apply|eligible|still get|go ahead)\b/i.test(query)) {
    return structured("renters_strata", {
      directAnswer:
        "No. Funding eligibility does not replace owner, owners-corporation, network, planning, building or programme pre-approval. Treat each as a separate gate. If the programme requires conditional approval before purchase, contract or installation, starting early can make the project ineligible even if the equipment would otherwise qualify. Keep the work blocked until every required approval is in writing and the current programme page confirms the application sequence.",
      status: "needs_context",
      citations: officialCitationsById([
        /\b(?:body corporate|owners corporation|strata)\b/i.test(query) ? "energy-gov-strata-solar" : "energy-gov-renters",
        "energy-gov-rebates",
      ]),
      confidence: "high",
      assumptions: ["The exact programme, property title, approval sequence and work status have not been verified."],
      practicalSteps: [
        "List the programme, ownership, network, planning, building and strata approvals separately.",
        "Confirm in writing which approvals must exist before quote acceptance, purchase or installation.",
        "Do not start or represent funding as secured until every applicable gate is satisfied.",
      ],
      toolActions: [{ id: "open-rebates", label: "Check the current programme sequence", href: "/rebates" }],
      suggestedQuestions: ["What programme, property type and work or contract stage apply?"],
    });
  }

  if ((/\b(?:stack|stacking|combine|combined|both|alongside|as well as|also use|also claim|use together|claim twice|double count)\b/i.test(query)
      || /\bclaim\b[^\n]{0,80}\bsame\b/i.test(query)
      || /\b(?:state|NSW|VIC|QLD|SA|WA|TAS|ACT|NT)\b[^\n]{0,80}\b(?:rebate|incentive|discount|programme|program|scheme)\b[^\n]{0,100}\b(?:federal|STCs?|SRES|battery discount)\b/i.test(query)
      || /\b(?:two|multiple)\s+(?:state\s+)?(?:rebates?|grants?|schemes?|programmes?|programs?)\b[^\n]{0,100}\b(?:STCs?|VEECs?|ESCs?|PRCs?|certificates?)\b/i.test(query))
    && /\b(?:STCs?|VEECs?|ESCs?|PRCs?|certificates?|rebates?|grants?|loans?|incentives?|schemes?|programmes?|programs?)\b/i.test(query)) {
    return structured("rebates_certificates", {
      directAnswer:
        "Do not assume two schemes can be stacked or applied to the same cost, equipment or energy outcome. Each current rule must expressly allow the other benefit, and the quote must reconcile the eligible cost, certificate assignment, rebate, minimum payment and customer contribution without double counting. If either current rule or application form is missing, keep the combined claim blocked rather than treating silence as permission.",
      status: "source_review_required",
      citations: officialCitationsById([
        ...( /\bSTCs?\b/i.test(query) ? ["cer-stc-entitlement-calculation"] : []),
        ...( /\b(?:federal battery|battery discount|battery STCs?|SRES)\b/i.test(query) ? ["cer-solar-battery-requirements"] : []),
        ...( /\bVEECs?|VEU\b/i.test(query) ? ["veu-water-space-activity-guide-v3-19"] : []),
        ...( /\bESCs?|\bESS\b/i.test(query) ? ["nsw-ess-rule-current-2026"] : []),
        ...( /\bPRCs?|\bPDRS\b/i.test(query) ? ["nsw-pdrs-rule-current-2026"] : []),
        "energy-gov-rebates",
      ]),
      confidence: "high",
      assumptions: ["The exact schemes, dates, costs, equipment and current stacking clauses have not been supplied."],
      practicalSteps: [
        "Identify each exact scheme, rule version, application date and benefit type.",
        "Map each benefit to its eligible cost or certificate outcome and mark every overlap.",
        "Proceed only when both current official rules and the reconciled invoice permit the combination.",
      ],
      toolActions: [{ id: "open-calculator", label: "Check certificate pathways separately", href: "/calculator" }],
      suggestedQuestions: ["Which two exact schemes and installation or application date are being combined?"],
    });
  }

  const paybackIntent = /\b(?:simple\s+)?payback\b/i.test(query)
    || /\b(?:how many|number of)\s+years?\b/i.test(query);
  const paybackDollarValues = [...query.matchAll(/\$\s*([\d,]+(?:\.\d+)?)/g)]
    .map((match) => Number(match[1].replaceAll(",", "")))
    .filter((value) => Number.isFinite(value) && value >= 0);
  const paybackCost = numericCapture(query, /\$\s*([\d,]+(?:\.\d+)?)\s*(?:installed|upfront|purchase|system|project|cost|price|battery|solar|PV|upgrade)/i)
    ?? numericCapture(query, /\b(?:costs?|price|quote|investment|upgrade|system|project|installed costs?)\b[^$\d]{0,25}\$\s*([\d,]+(?:\.\d+)?)/i)
    ?? (paybackIntent && paybackDollarValues.length >= 2 && !/\b(?:per|a)\s+month|\bmonthly\b/i.test(query) ? paybackDollarValues[0] : null);
  const monthlyPaybackBasis = /\b(?:per|a)\s+month|\bmonthly\b/i.test(query);
  const paybackAnnualSaving = numericCapture(query, /\b(?:annual|yearly|expected)\s+savings?\b[^$\d]{0,25}\$\s*([\d,]+(?:\.\d+)?)/i)
    ?? numericCapture(query, /\$\s*([\d,]+(?:\.\d+)?)\s*(?:a year|per year|yearly|annual(?:ly)?|\/\s*(?:year|yr))\b/i)
    ?? numericCapture(query, /\$\s*([\d,]+(?:\.\d+)?)\s*(?:annual|yearly)\s+savings?\b/i)
    ?? (!monthlyPaybackBasis
      ? numericCapture(query, /\b(?:save|saves|saving|savings)\b[^$\d]{0,25}\$\s*([\d,]+(?:\.\d+)?)(?:\s*(?:each|per|a|in)?\s*(?:year|year one|annum|annually|annual))?/i)
      : null)
    ?? (paybackIntent && paybackDollarValues.length >= 2 && !monthlyPaybackBasis ? paybackDollarValues[1] : null);
  if (paybackIntent
    || /\b(?:how many|number of)\s+years?\b/i.test(query) && paybackCost !== null && paybackAnnualSaving !== null) {
    const completePayback = paybackCost !== null && paybackAnnualSaving !== null && paybackAnnualSaving > 0;
    const years = completePayback ? paybackCost / paybackAnnualSaving : null;
    return structured("bills_tariffs", {
      directAnswer: completePayback && years !== null
        ? `Simple payback is about ${years.toLocaleString("en-AU", { maximumFractionDigits: 1 })} years from the supplied assumptions: $${paybackCost.toLocaleString("en-AU")} upfront divided by $${paybackAnnualSaving.toLocaleString("en-AU")} annual savings. That is undiscounted arithmetic, not a guaranteed return. It excludes finance, price and usage changes, maintenance, degradation, replacement, export opportunity cost and any unverified rebate; show those separately before deciding.`
        : "Simple payback is upfront net cost divided by annual net savings, but I will not calculate it without both figures on the same stated basis. Use the cash installed cost after only confirmed support, and an annual saving derived from measured use, the complete tariff and explicit operating assumptions. Keep finance, maintenance, degradation and replacement separate.",
      status: completePayback ? "answered" : "needs_context",
      citations: officialCitationsById([
        ...( /\b(?:solar|PV)\b/i.test(query) ? ["energy-gov-solar-consumer-guide"] : []),
        "energy-gov-reduce-energy-bills",
        "asic-moneysmart-personal-loans",
      ]),
      confidence: completePayback ? "medium" : "low",
      assumptions: completePayback
        ? ["The supplied upfront cost and annual saving are treated as comparable cash figures and remain unverified."]
        : ["A comparable upfront net cost and annual net saving have not both been supplied."],
      practicalSteps: [
        "State the cash installed cost and subtract only independently confirmed support.",
        "State the annual bill saving and every tariff, usage, export and performance assumption.",
        "Test maintenance, degradation, replacement, finance and low-savings cases separately.",
      ],
      toolActions: [],
      suggestedQuestions: completePayback ? ["Do you want a low-savings case with maintenance and degradation shown separately?"] : ["What cash installed cost and annual bill saving should be used?"],
    });
  }

  if (/\b(?:EV|electric vehicle|electric car|vehicle)\b/i.test(query)
    && /\b(?:finance|financing|loan|interest|comparison rate|repayment|balloon|deposit)\b/i.test(query)
    && /(?:\$\s*[\d,]+|\b\d+(?:\.\d+)?\s*%)/.test(query)) {
    return structured("ev_charging", {
      directAnswer:
        "Those dollar or rate figures are finance inputs, not vehicle variants or energy-performance facts. Compare the same vehicle cash price with deposit, amount financed, term, comparison rate, fees, balloon, early-repayment terms and total repayments. Keep running energy, servicing, insurance, depreciation, rebates and resale as separate lines. A lower repayment can still cost more overall, and this assistant does not provide personal financial advice.",
      status: "needs_context",
      citations: officialCitationsById(["asic-moneysmart-personal-loans", "green-vehicle-guide-compare"]),
      confidence: "high",
      assumptions: ["No complete lender disclosure, exact vehicle variant, cash price or total repayment has been verified."],
      practicalSteps: [
        "Identify the exact vehicle variant and its cash drive-away price separately from finance.",
        "Put every lender's deposit, amount financed, term, comparison rate, fees, balloon and total repayments in one table.",
        "Compare energy and ownership costs separately under stated annual-distance assumptions.",
      ],
      toolActions: [],
      suggestedQuestions: ["What are the cash price, deposit, amount financed, term, comparison rate, fees, balloon and total repayments for each offer?"],
    });
  }

  if (/\b(?:battery|storage)\b/i.test(query)
    && /\b(?:approved|eligible|listed|register|list)\b/i.test(query)
    && /\b(?:guarantee|guaranteed|good|quality|suitable|safe|best|reliable)\b/i.test(query)) {
    return structured("battery_vpp", {
      directAnswer:
        "No. Being on an approved battery or component list proves only the listing fact and is one scheme condition. It does not guarantee product quality, site suitability, backup operation, safe or complete installation, savings, warranty service or certificate eligibility for the whole job. Check the exact battery and inverter combination, current listing date, usable capacity and power, site and backup design, installer accreditation and electrical licence, commissioning, recalls, written warranty and local remedy process.",
      status: "needs_context",
      citations: officialCitationsById(["cer-solar-battery-requirements", "product-safety-recalls", "accc-consumer-guarantees"]),
      confidence: "high",
      assumptions: ["The exact products, site design, listing date, installer, commissioning, warranty and recall status have not been verified."],
      practicalSteps: [
        "Verify the exact battery, inverter and configuration in the current official sources for the proposed installation date.",
        "Compare the site-specific design, usable performance, backup circuits, commissioning, warranty and local service in writing.",
        "Check current recalls and keep consumer-guarantee rights separate from the voluntary warranty.",
      ],
      toolActions: [{ id: "open-product-calculator", label: "Check exact products and scheme rules", href: "/calculator" }],
      suggestedQuestions: ["What exact battery and inverter models, installation date, intended job and written backup design apply?"],
    });
  }

  if (/\b(?:off[ -]grid|standalone|not connected to (?:the )?grid)\b/i.test(query)
    && /\b(?:shed|bore pump|outbuilding|non[ -]?residential|unoccupied|not lived in|nobody lives|no one lives)\b/i.test(query)
    && /\b(?:STCs?|certificates?|claim|eligible|eligibility|battery|solar|PV)\b/i.test(query)) {
    const batteryPathway = /\b(?:battery|storage)\b/i.test(query);
    return structured("rebates_certificates", {
      directAnswer: batteryPathway
        ? "No, not on those facts. Under the current CER battery STC pathway, an off-grid battery must serve a dwelling that is lived in. A shed, bore pump or other structure that is not lived in is not eligible merely because it has an off-grid energy system. Do not create, assign or advertise battery STCs unless the actual premises, complete system, products, participants, date and evidence meet the current rule."
        : "The current CER non-lived-in shed exclusion in this corpus is a battery STC rule, so it cannot be reused to decide a solar-PV claim. For off-grid PV, check the current SRES eligible-system, premises, component, installer, date and evidence requirements for that exact installation before quoting any STCs. If a battery is the intended claim, a shed or other structure that is not lived in does not meet the cited off-grid dwelling condition.",
      status: batteryPathway ? "answered" : "needs_context",
      citations: officialCitationsById(["cer-solar-battery-requirements", "cer-small-scale-system-requirements"]),
      confidence: "high",
      assumptions: ["The technology, legal premises, occupancy, complete system and proposed installation date have not been independently verified."],
      practicalSteps: [
        "Identify whether the claim is for PV, a battery or both and record the exact premises use and occupancy.",
        "Apply the current technology-specific CER requirements rather than transferring one pathway's rule to another.",
        "Keep the claim blocked until the governed calculator and authorised evidence review confirm eligibility.",
      ],
      toolActions: [{ id: "open-calculator", label: "Check the exact certificate pathway", href: "/calculator" }],
      suggestedQuestions: ["Is the proposed claim for PV, a battery or both, and is any dwelling on the premises actually lived in?"],
    });
  }

  if (/\b(?:inverter|solar inverter)\b/i.test(query)
    && /\b(?:approved|listed|register|eligible)\b/i.test(query)
    && /\b(?:guarantee|guaranteed|good|quality|suitable|safe|reliable|whole job)\b/i.test(query)) {
    return structured("solar", {
      directAnswer:
        "No. An approved inverter listing proves only the stated listing fact for the exact model and date. It does not guarantee product quality, site suitability, compatibility with the panels or battery, network approval, safe installation, savings, warranty service or eligibility of the whole job. Verify the exact model and current listing, then check the complete design, installer licence and accreditation, network settings, commissioning, recalls, warranty and remedy contact.",
      status: "needs_context",
      citations: officialCitationsById(["cer-small-scale-system-requirements", "cer-rooftop-solar-trade-requirements", "product-safety-recalls"]),
      confidence: "high",
      assumptions: ["The exact inverter, listing date, system design, network approval, installer and commissioning have not been verified."],
      practicalSteps: [
        "Match the full inverter model to the current official listing for the proposed date.",
        "Check panel, battery, phase, export-control and network compatibility in the written design.",
        "Verify installer authority, commissioning, recall status, warranty and local remedy process.",
      ],
      toolActions: [{ id: "open-calculator", label: "Check the exact products and pathway", href: "/calculator" }],
      suggestedQuestions: ["What exact inverter, panels, battery, installation date and network approval are proposed?"],
    });
  }

  const arrayCapacityKw = numericCapture(query, /\b(?:array|panels?|solar|PV)(?:\s+system)?\s*(?:is|of|:|=|rated)?\s*([\d,]+(?:\.\d+)?)\s*kW/i)
    ?? numericCapture(query, /\b([\d,]+(?:\.\d+)?)\s*kW\s+(?:DC\s+)?(?:array|panels?|solar|PV)\b/i);
  const inverterCapacityKw = numericCapture(query, /\binverter(?:\s+capacity)?\s*(?:is|of|:|=|rated)?\s*([\d,]+(?:\.\d+)?)\s*kW/i)
    ?? numericCapture(query, /\b([\d,]+(?:\.\d+)?)\s*kW\s+(?:AC\s+)?inverter\b/i);
  if (/\b(?:solar|PV|array|panels?)\b/i.test(query)
    && /\binverter\b/i.test(query)
    && (arrayCapacityKw !== null && inverterCapacityKw !== null
      || /\b(?:DC\s*[:/]\s*AC|array[- ]to[- ]inverter|oversiz(?:e|ed|ing)|larger array|smaller inverter|clipping)\b/i.test(query))) {
    const ratio = arrayCapacityKw !== null && inverterCapacityKw !== null && inverterCapacityKw > 0
      ? arrayCapacityKw / inverterCapacityKw
      : null;
    return structured("solar", {
      directAnswer:
        `${ratio === null ? "A solar array can be larger than the inverter's AC rating" : `The supplied ${arrayCapacityKw?.toLocaleString("en-AU")} kW array and ${inverterCapacityKw?.toLocaleString("en-AU")} kW inverter give a DC-to-AC ratio of about ${ratio.toLocaleString("en-AU", { maximumFractionDigits: 2 })}`}. That can improve inverter loading in lower light, but it can also clip output when available DC power exceeds the inverter limit. The ratio alone does not prove good design or savings. Check the exact approved components, manufacturer limits, orientation and shading, local yield, network approval, export control and the quote's clipping assumption.` ,
      status: "needs_context",
      citations: officialCitationsById(["energy-gov-solar-consumer-guide", "cer-small-scale-system-requirements"]),
      confidence: ratio === null ? "medium" : "high",
      assumptions: ["The figures are treated as nominal DC array and AC inverter ratings; orientation, temperature, product limits and yield have not been verified."],
      practicalSteps: [
        "Confirm the exact panel count, DC rating, inverter AC rating and manufacturer design limits.",
        "Model orientation, shade, temperature and expected clipping using the site's local yield assumptions.",
        "Verify network approval, export control, product listings and the complete written design.",
      ],
      toolActions: [{ id: "model-solar", label: "Model the site-specific solar design", href: "/compare" }],
      suggestedQuestions: ["What panel orientation, shading, inverter model, network export rule and annual clipping estimate apply?"],
    });
  }

  if (/\b(?:solar|PV|inverter|export)\b/i.test(query)
    && /\bexport(?:ed|ing|s)?\b/i.test(query)
    && /\b(?:drop|drops|dropped|dropping|dip|dipped|falls?|fell|cut(?:s|ting)?|collapse|collapsed|flatline|flatlines|flatlined|low|lower|missing|reduced|declined|from\s+[\d.]+\s*kWh?\s+to\s+[\d.]+\s*kWh?)\b/i.test(query)) {
    return structured("solar", {
      directAnswer:
          "An export drop is not enough to diagnose a solar fault because export is only generation minus household use and battery charging. Cloud, shade or heat can change generation; a new load can reduce export; and the inverter app, meter, battery, fixed or dynamic export control, clipping, high grid voltage, thermal derating or a trip can show different parts of the flow. Compare inverter generation, site load, battery power and grid export over the same timestamps and weather, then check export-control settings, status and event codes. Treat repeated trips, warnings, heat or damaged equipment as an installer issue, not a DIY reset experiment.",
      status: "needs_context",
      citations: officialCitationsById(["energy-gov-solar-batteries", "energy-gov-solar-consumer-guide"]),
      confidence: "medium",
      assumptions: ["Only an export pattern is known; generation, load, battery, voltage, weather and inverter events have not been aligned."],
      practicalSteps: [
        "Align inverter generation, household load, battery charge and grid export for the same clear and cloudy days.",
        "Record export-control settings, grid voltage, inverter temperature, status and event codes without opening equipment.",
        "Send the evidence to the installer or network if the pattern is unexplained or includes trips or warnings.",
      ],
      toolActions: [{ id: "compare-electricity", label: "Check the interval and export pattern", href: "/compare" }],
      suggestedQuestions: ["At the same timestamp, what do inverter generation, household load, battery power, grid export and event status show?"],
    });
  }

  if (/\b(?:battery|storage|V2H|vehicle[- ]to[- ]home|bidirectional charging|EV|electric vehicle)\b/i.test(query)
    && /\b(?:blackout|backup|back[ -]?up|power outage|islanding|essential circuits?|whole home backup)\b/i.test(query)
    && /\b(?:design|work|works|run|power|support|automatic|automatically|guarantee|need|size|what|can|does|do)\b/i.test(query)) {
    const vehicleToHome = /\b(?:V2H|vehicle[- ]to[- ]home|bidirectional|EV|electric vehicle)\b/i.test(query)
      && !/\b(?:home battery|stationary battery)\b/i.test(query);
    return structured("battery_vpp", {
      directAnswer:
        `${vehicleToHome ? "A vehicle and charger do not automatically provide V2H blackout power" : "Battery ownership does not automatically provide blackout power"}. Backup needs an explicitly compatible battery or vehicle, inverter or bidirectional charger, network-approved changeover or islanding design, nominated backed-up circuits, enough discharge power and surge capacity, usable reserve and a tested restart strategy. Whole-home backup can be constrained by large loads. Require a single-line design, backed-up load schedule, network and manufacturer compatibility, commissioning test and safe shutdown instructions.`,
      status: "needs_context",
      citations: officialCitationsById(vehicleToHome
        ? ["act-bidirectional-ev-charging", "nsw-home-electrical-safety"]
        : ["energy-gov-batteries", "cer-solar-battery-inspection-checklist", "cer-solar-battery-requirements"]),
      confidence: "high",
      assumptions: ["The inverter, switchboard, circuits, surge loads, reserve, phase arrangement and islanding design have not been inspected."],
      practicalSteps: [
        "List the circuits and simultaneous appliances that must operate during an outage.",
        "Compare their running and starting power with the proposed backup output, reserve and phase design.",
        "Require labelled commissioning tests for outage transfer, overload, solar restart and safe shutdown.",
      ],
      toolActions: [],
      suggestedQuestions: ["Which circuits and largest starting loads must run together during a blackout?"],
    });
  }

  if (/\b(?:battery|storage)\b/i.test(query)
    && /\b(?:add|adding|expand|expansion|extra|another|more)\b/i.test(query)
    && /\b(?:module|modules|capacity|kWh|battery)\b/i.test(query)) {
    return structured("battery_vpp", {
      directAnswer:
        "Do not assume an extra battery module can be mixed into an existing system or earn another certificate benefit. Expansion must be an exact manufacturer-approved configuration for the installed inverter, battery model, age, firmware, module count and capacity limits, with the current official component listing, warranty, electrical design and commissioning preserved. The current one-eligible-battery-system rule also means an added module is not automatically a second STC claim. Keep eligibility blocked until the dated rule and approved configuration are verified.",
      status: "source_review_required",
      citations: officialCitationsById(["cer-solar-battery-requirements", "cer-solar-battery-inspection-checklist"]),
      confidence: "high",
      assumptions: ["The existing battery, inverter, firmware, age, approved configuration, warranty and proposed installation date are unknown."],
      practicalSteps: [
        "Record every existing battery and inverter model, serial, module count, firmware and installation date.",
        "Obtain the manufacturer's approved expansion configuration and a licensed installer's revised electrical design.",
        "Verify the dated listing, warranty and certificate treatment before purchase or installation.",
      ],
      toolActions: [{ id: "open-calculator", label: "Check the current battery pathway", href: "/calculator" }],
      suggestedQuestions: ["What exact battery, inverter, existing module count, installation date and proposed expansion are involved?"],
    });
  }

  const proposedSolarKw = numericCapture(query, /\b([\d,]+(?:\.\d+)?)\s*kW(?:p)?(?:\s+of)?\s+(?:solar|PV|panels?|array|system)\b/i);
  const exportLimitKw = numericCapture(query, /\b([\d,]+(?:\.\d+)?)\s*kW\s+(?:network\s+)?export(?:\s+limit)?\b/i);
  if (/\b(?:solar|PV|array|panels?|inverter)\b/i.test(query)
    && /\bexport(?:\s+limit| constrained| constraint| capped| cap)?\b/i.test(query)
    && (proposedSolarKw !== null || exportLimitKw !== null)) {
    const sizes = proposedSolarKw !== null && exportLimitKw !== null
      ? `The ${proposedSolarKw.toLocaleString("en-AU")} kW figure is the nominal solar-array capacity, while the ${exportLimitKw.toLocaleString("en-AU")} kW export limit generally caps net power sent to the grid. `
      : "Solar-array capacity and the network export limit are different quantities. ";
    return structured("solar", {
      directAnswer:
        `${sizes}It does not automatically cap total solar production at the export limit: the home may use solar at the same time and a compatible battery may absorb surplus, subject to the approved inverter, export-control design and network conditions. Generation can still be curtailed when production exceeds household use, available charging and permitted export. Require the quote's yield and savings model to use the actual network approval and export-control setting, not unrestricted export.`,
      status: "needs_context",
      citations: officialCitationsById(["energy-gov-solar-consumer-guide", "energy-gov-solar-batteries"]),
      confidence: "medium",
      assumptions: ["The DC array, inverter AC capacity, phase arrangement, dynamic or fixed export control, load profile, battery and network approval have not been verified."],
      practicalSteps: [
        "Obtain the network approval and confirm whether the limit is fixed, dynamic, per phase or measured as total net export.",
        "Compare array and inverter capacity with daytime load, battery charging power and the quote's curtailment assumptions.",
        "Require the generation and savings estimate to show self-use, export and curtailed energy separately.",
      ],
      toolActions: [{ id: "model-solar", label: "Model solar with the export limit", href: "/compare" }],
      suggestedQuestions: ["What inverter AC capacity, network approval, export-control type, daytime load and battery charging power apply?"],
    });
  }

  if (/\b(?:suppliers?|installers?|compan(?:y|ies)|vendors?|exhibitors?|contractors?|providers?)\b/i.test(query)
    && /\b(?:best|most|rank|recommend|trust|trustworth(?:y|iness)|choose|compare|buy|purchase|select|shortlist|claims?|reputable|good)\b/i.test(query)) {
    return structured("products_ratings", {
      directAnswer:
        "Surge does not rank or endorse suppliers, installers, event exhibitors, brands or models. An event listing or marketing badge is not proof of suitability: compare the required licences, official product and recall records, site-specific scope, commissioning, warranty and local remedy process for the same job.",
      status: "needs_context",
      citations: officialCitationsById([
        "energy-rating-product-register",
        "product-safety-recalls",
        "accc-consumer-guarantees",
      ]),
      confidence: "medium",
      assumptions: ["No business, licence, product, site design or written quote has been verified."],
      practicalSteps: [
        "Define the exact service, postcode and required licences or programme roles.",
        "Check each business and exact product in current official registers and recall records.",
        "Compare complete written scope, commissioning, warranty and remedy contacts.",
      ],
      toolActions: [{ id: "open-guides", label: "Open independent comparison criteria", href: "/guides" }],
      suggestedQuestions: ["What service and postcode are involved?"],
    });
  }

  if (/\b(?:upload|attach|send|inspect|view|read|check|review|analyse|analyze|diagnos(?:e|is))\b/i.test(query)
    && /\b(?:photo|image|picture)\b/i.test(query)
    && /\b(?:mould|mold|damp|moisture|condensation)\b/i.test(query)) {
    return structured("draughts_ventilation", {
      directAnswer:
        "This guide cannot accept or analyse photos and cannot identify mould or diagnose its cause from an image. Its local file checker supports bounded text-based PDF quotes and CSV or NEM12 interval files only. Describe the location, affected material, size, timing, odour, moisture sources and any leak or condensation pattern in text; persistent, extensive or concealed damp needs a building-specific moisture assessment, and health symptoms belong with an appropriate health professional.",
      status: "needs_context",
      citations: officialCitationsById(["yourhome-condensation-moisture", "yourhome-indoor-air-quality"]),
      confidence: "high",
      assumptions: ["No image has been analysed and no moisture source, material or health effect has been assessed."],
      practicalSteps: [
        "Do not upload personal images; describe the affected surface and moisture pattern without names, faces or addresses.",
        "Dry active moisture safely, run working exhaust to outdoors and avoid disturbing extensive or concealed mould.",
        "Use an appropriate building or moisture practitioner when damp is persistent, concealed or linked to a leak.",
      ],
      toolActions: [],
      suggestedQuestions: ["Where is the mould, how large is it, when does it return, and is there a leak, condensation or working exhaust nearby?"],
    });
  }

  if (/\b(?:installation|completion|commissioning) date\b/i.test(query)
    && /\b(?:edit|change|alter|correct|backdate|overwrite)\b/i.test(query)
    && /\b(?:sign(?:s|ed|ing)?|signature|accepted|locked|customer)\b/i.test(query)) {
    return structured("trades", {
      directAnswer:
        "Do not overwrite or backdate a signed installation record. Preserve the original exact record, create an auditable correction or addendum with the actual date, reason, author and time, obtain the required customer or reviewer acknowledgement, and rerun every eligibility or certificate decision that depends on that date. A correction must remain distinguishable from the original evidence.",
      status: "answered",
      citations: [],
      confidence: "high",
      assumptions: ["No private job record has been opened and the platform role or programme-specific correction rule has not been verified."],
      practicalSteps: [
        "Keep the signed original immutable and record why it is wrong.",
        "Create the authorised correction or addendum with the actual date, actor, timestamp and linked evidence.",
        "Send it through the required review and recalculate date-sensitive eligibility before submission.",
      ],
      toolActions: [{ id: "open-creditex-compliance", label: "Open compliance evidence", href: "/creditex/compliance" }],
      suggestedQuestions: ["Is the signed value a data-entry error or did the actual installation date change, and which programme submission uses it?"],
    });
  }

  if (/\b(?:quotes?|proposals?|PDF)\b/i.test(query)
    && /\b(?:inverter|panel|battery|heat[- ]?pump|air conditioner|water heater|charger|product)\b/i.test(query)
    && /\b(?:no|missing|without|not shown|not stated)\b[^\n]{0,35}\b(?:model|model number|exact model|brand and model)\b/i.test(query)) {
    return structured("products_ratings", {
      directAnswer:
        "No. A marketing description such as premium is not enough to identify or verify the product. The written quote needs the exact brand and model number, capacity and configuration, applicable current official registration or programme listing, compatibility with the site design, warranty and local remedy contact, plus the complete installed scope. An unknown model stays a quote blocker rather than being assumed eligible or suitable.",
      status: "needs_context",
      citations: officialCitationsById(["energy-rating-product-register", "cer-small-scale-system-requirements", "accc-consumer-guarantees"]),
      confidence: "high",
      assumptions: ["The quote and site have not been locally reviewed, and no exact product has been verified."],
      practicalSteps: [
        "Ask the supplier to revise the quote with every exact model and capacity before acceptance.",
        "Check those exact models in the applicable current official registers and recall records.",
        "Compare compatibility, commissioning, warranty, exclusions and remedy contacts against the site-specific scope.",
      ],
      toolActions: [],
      suggestedQuestions: ["What equipment category and exact site job is the missing model meant to serve?"],
    });
  }

  if (/\b(?:rebate|grant|programme|program|scheme)\b/i.test(query)
    && /\b(?:current|open|still available|available today|today)\b/i.test(query)
    && /\b(?:solar|battery|electrif|heat[- ]?pump|hot[- ]?water)\b/i.test(query)
    && /\b(?:named|called|Solar Homes|home battery rebate)\b/i.test(query)) {
    return structured("rebates_certificates", {
      directAnswer:
        "I will not treat a named programme or older rebate label as open without a current official catalogue entry and effective date. I cannot confirm that exact programme from the maintained current entries here. Check the administering government's current page before purchase, and keep any state rebate, loan or retailer offer separate from federal STCs and from the supplier's commercial discount.",
      status: "source_review_required",
      citations: officialCitationsById(["energy-gov-rebates", "cer-stc-entitlement-calculation"]),
      confidence: "low",
      assumptions: ["The named programme's current status, applicant conditions, product rules and funding availability have not been verified."],
      practicalSteps: [
        "Open the administering government's current programme page and confirm that applications are open on the proposed date.",
        "Check applicant, property, product, supplier and installation conditions before committing.",
        "Calculate any STCs and supplier discount separately from the programme outcome.",
      ],
      toolActions: [{ id: "open-rebates", label: "Check current assistance", href: "/rebates" }],
      suggestedQuestions: ["Which state, exact programme name and proposed application or installation date apply?"],
    });
  }

  const solarChargingDistance = numericCapture(query, /\b([\d,]+(?:\.\d+)?)\s*km\b/i);
  const solarChargingDistanceLabel = solarChargingDistance === null
    ? "Driving distance alone"
    : `${solarChargingDistance.toLocaleString("en-AU")} km alone`;
  if (/\b(?:solar|PV)\b/i.test(query)
    && /\bcharg(?:e|es|ed|ing)\b/i.test(query)
    && /\b(?:EV|electric vehicle|car|drive|driving|km)\b/i.test(query)
    && /\b(?:save|saving|savings|cost|cheaper|value|worth)\b/i.test(query)) {
    return structured("ev_charging", {
      directAnswer:
        `${solarChargingDistanceLabel} cannot determine a solar-charging saving. Annual EV energy is annual distance multiplied by the exact vehicle's kWh/100 km, with charging losses stated separately. The value of the solar share is then the grid or public charging cost avoided minus the feed-in credit or other value forgone for solar that would otherwise be exported. Charging time, genuine solar surplus, home and public prices, subscriptions and finance remain separate inputs.`,
      status: "needs_context",
      citations: officialCitationsById(["green-vehicle-guide-compare", "energy-gov-ev-home-strata-charging", "energy-made-easy-current-plan-comparison"]),
      confidence: "medium",
      assumptions: ["The distance period, exact EV energy use, charging losses, solar share, export opportunity cost and avoided charging price are not complete."],
      practicalSteps: [
        "Confirm annual kilometres and the exact variant's current official kWh/100 km on a consistent test basis.",
        "Measure how much charging can occur from otherwise-exported solar rather than assuming all daytime charging is free.",
        "Compare the forgone feed-in credit with the complete grid or public charging cost avoided, then show losses and fees separately.",
      ],
      toolActions: [{ id: "compare-electricity", label: "Check the charging tariff", href: "/compare" }],
      suggestedQuestions: [solarChargingDistance === null
        ? "How many kilometres do you drive per year, and what is the exact EV's official kWh/100 km?"
        : `Is ${solarChargingDistance.toLocaleString("en-AU")} km your annual distance, and what is the exact EV's official kWh/100 km?`],
    });
  }

  const batteryCapacityKwh = numericCapture(query, /\b([\d,]+(?:\.\d+)?)\s*kWh\s+(?:home\s+)?battery\b/i)
    ?? numericCapture(query, /\b(?:battery|storage)[^\d\n]{0,20}([\d,]+(?:\.\d+)?)\s*kWh\b/i);
  const overnightLoadKwh = numericCapture(query, /\b(?:use|uses|used|using|import|imports|imported|load|consume|consumes|consuming)[^\d\n]{0,24}([\d,]+(?:\.\d+)?)\s*kWh[^\n]{0,24}\b(?:overnight|most nights?|a night|per night|nightly)\b/i)
    ?? numericCapture(query, /\b([\d,]+(?:\.\d+)?)\s*kWh[^\n]{0,24}\b(?:overnight|most nights?|a night|per night|nightly)\b/i);
  const dailyLoadKwh = numericCapture(query, /\b(?:use|uses|used|using|load|consume|consumes|consuming)[^\d\n]{0,24}([\d,]+(?:\.\d+)?)\s*kWh\s*(?:\/\s*day|a day|per day|daily)\b/i);
  const dailyExportKwh = numericCapture(query, /\b(?:export|exports|exported|exporting)[^\d\n]{0,24}([\d,]+(?:\.\d+)?)\s*kWh\s*(?:\/\s*day|a day|per day|daily)\b/i);
  if (/\b(?:battery|storage)\b/i.test(query)
    && /\b(?:size|sizing|capacity|how big|what size|right size)\b/i.test(query)
    && (dailyLoadKwh !== null || dailyExportKwh !== null || overnightLoadKwh !== null)) {
    const knownFlow = [
      dailyLoadKwh === null ? "" : `${dailyLoadKwh.toLocaleString("en-AU")} kWh/day total use`,
      dailyExportKwh === null ? "" : `${dailyExportKwh.toLocaleString("en-AU")} kWh/day export`,
      overnightLoadKwh === null ? "" : `${overnightLoadKwh.toLocaleString("en-AU")} kWh overnight load`,
    ].filter(Boolean).join(" and ");
    return structured("battery_vpp", {
      directAnswer:
        `${knownFlow ? `The supplied ${knownFlow} is useful but` : "Daily totals"} does not determine one battery size. The limiting bill-shifting quantity is the overlap between otherwise-exported solar and later grid import, after usable-capacity reserve, charging and discharge losses and power limits. Backup is a separate job requiring the backed-up circuits, surge power and reserve. Use interval data across representative seasons, then test usable capacity, tariff spread, degradation, warranty throughput and installed cost rather than matching nameplate capacity to one daily total.`,
      status: "needs_context",
      citations: officialCitationsById(["energy-gov-batteries", "energy-gov-solar-batteries", "energy-made-easy-current-plan-comparison"]),
      confidence: "medium",
      assumptions: ["Evening and overnight import, time-aligned solar surplus, seasonal variation, usable capacity, losses, power, reserve and tariff have not been supplied."],
      practicalSteps: [
        "Use validated interval data to total otherwise-exported solar and later grid import on representative days.",
        "Model usable capacity, reserve, losses and charge or discharge power against those same timestamps.",
        "Value bill shifting and any defined backup service separately before comparing installed cost.",
      ],
      toolActions: [{ id: "compare-electricity", label: "Model battery value from intervals", href: "/compare" }],
      suggestedQuestions: ["How many kWh are imported between solar fading and the next morning on representative summer and winter days?"],
    });
  }
  if (/\b(?:battery|storage)\b/i.test(query)
    && /\b(?:save|saving|savings|worth|economic|economics|payback|too (?:big|large)|oversi[sz]ed|right size|make sense)\b/i.test(query)
    && (batteryCapacityKwh !== null || overnightLoadKwh !== null)) {
    const capacityContext = batteryCapacityKwh !== null && overnightLoadKwh !== null
      ? `A ${batteryCapacityKwh.toLocaleString("en-AU")} kWh nameplate battery is larger than the stated ${overnightLoadKwh.toLocaleString("en-AU")} kWh overnight load, so the extra capacity would not create extra daily bill shifting unless other loads, backup reserve or a different operating job uses it. `
      : "Battery nameplate capacity alone does not show how much energy can be shifted or saved. ";
    return structured("battery_vpp", {
      directAnswer:
        `${capacityContext}Test usable capacity after reserve and losses, measured solar surplus, import timing, charge and discharge power, tariff spread, degradation and throughput limits, backup design and total installed cost. A larger battery can still serve backup or future loads, but that is a separate value and does not prove payback.`,
      status: "needs_context",
      citations: officialCitationsById(["energy-gov-batteries", "cer-solar-battery-inspection-checklist", "energy-made-easy-current-plan-comparison"]),
      confidence: "medium",
      assumptions: ["Nameplate capacity may differ from usable capacity, and no interval solar surplus, tariff, losses, reserve, warranty throughput or installed price has been verified."],
      practicalSteps: [
        "Use interval data to total energy imported after solar and energy exported before battery charging on representative days.",
        "Model usable capacity, reserve, losses and power limits against that same load and the complete tariff.",
        "Compare annual bill value and any separately valued backup service with installed cost, degradation and warranty limits.",
      ],
      toolActions: [{ id: "compare-electricity", label: "Model measured battery value", href: "/compare" }],
      suggestedQuestions: ["How much solar is exported before the evening peak, what import and feed-in rates apply, and is the battery for bill shifting, backup or both?"],
    });
  }

  if (/\b(?:close|seal|block|cover|remove)\b/i.test(query)
    && /\b(?:permanent\s+)?(?:wall\s+|floor\s+|ceiling\s+)?vents?\b|\bflues?\b/i.test(query)) {
    return structured("draughts_ventilation", {
      directAnswer:
        "No, do not close or seal a permanent vent or flue until its purpose has been identified. It may provide required combustion air, remove pollutants or moisture, or form part of a compliant ventilation system. Blocking it can create a gas, carbon-monoxide, condensation or indoor-air hazard. Find the appliance or space it serves and use a licensed gasfitter or appropriate building practitioner before changing it; seal only confirmed unintended leakage paths.",
      status: "answered",
      citations: officialCitationsById(["yourhome-ventilation-airtightness", "energy-gov-carbon-monoxide-heater-safety", "ncc-condensation-handbook"]),
      confidence: "high",
      assumptions: ["The vent purpose, connected appliances, flue arrangement and local requirements have not been inspected."],
      practicalSteps: [
        "Leave the vent and every flue unobstructed while identifying what it serves.",
        "Check for gas, wood or other combustion equipment and for kitchen, bathroom or whole-home ventilation paths.",
        "Have a licensed gasfitter or appropriate building practitioner approve any permanent alteration.",
      ],
      toolActions: [],
      suggestedQuestions: ["What appliance or room does the vent serve, and is any gas, wood or other combustion equipment installed?"],
    });
  }

  if (/\b(?:bathroom|shower|ensuite)\b/i.test(query)
    && /\b(?:fan|exhaust)\b/i.test(query)
    && /\b(?:roof space|ceiling cavity|attic)\b/i.test(query)) {
    return structured("draughts_ventilation", {
      directAnswer:
        "A bathroom exhaust that simply discharges into the roof space is not effective outdoor moisture removal. It can move warm wet air into a colder concealed assembly and increase condensation, mould or material damage. Have the fan ducted through a suitable, sealed and supported route to an outdoor termination, with make-up air and the applicable NCC, roof and fire requirements checked for the building.",
      status: "answered",
      citations: officialCitationsById(["yourhome-indoor-air-quality", "yourhome-ventilation-airtightness", "ncc-condensation-handbook"]),
      confidence: "high",
      assumptions: ["The fan flow, duct route, roof construction, outdoor termination and local requirements have not been inspected."],
      practicalSteps: [
        "Do not treat the roof space as the exhaust destination or add more moisture-producing use while active damp is unresolved.",
        "Inspect safely for a connected duct, outdoor termination and moisture damage without entering an unsafe roof space.",
        "Use an appropriate installer or building practitioner to design and verify the outdoor discharge path.",
      ],
      toolActions: [],
      suggestedQuestions: ["Is there any duct or outdoor vent connected now, and does moisture or mould appear in the roof space or bathroom?"],
    });
  }

  if (/\b(?:ceiling|roof)\s+insulation\b/i.test(query)
    && /\b(?:downlights?|light fittings?|electrical|wiring)\b/i.test(query)
    && /\b(?:gap|gaps|fill|cover|clearance|around)\b/i.test(query)) {
    return structured("insulation", {
      directAnswer:
        "Do not fill insulation gaps around downlights or electrical equipment until the exact fitting classification and required clearances are verified. Some fittings may be covered only under their certified installation conditions; others require separation for fire and heat safety. A licensed electrician should identify the fittings and wiring first, then the insulation installer can restore the greatest safe continuity without covering required clearances, transformers, drivers or ventilation paths.",
      status: "needs_context",
      citations: officialCitationsById(["yourhome-insulation", "energy-gov-insulation-draught-proofing"]),
      confidence: "high",
      assumptions: ["The fitting classification, insulation type, wiring condition and required clearances have not been verified."],
      practicalSteps: [
        "Do not push loose insulation into the gaps or cover fittings, drivers or transformers yourself.",
        "Have a licensed electrician identify the fittings, wiring condition and permitted clearances.",
        "Give that clearance schedule to the insulation installer and record completed coverage and protected services.",
      ],
      toolActions: [{ id: "open-insulation-guide", label: "Open the insulation guide", href: "/guides/insulation-draught-proofing" }],
      suggestedQuestions: ["What exact downlight classification and insulation type are installed, and has a licensed electrician checked them?"],
    });
  }

  if (/\b(?:blow[- ]?in|injected|pump(?:ed)?|retrofit)\b/i.test(query)
    && /\b(?:wall|cavity|brick veneer|double brick|weatherboard|masonry)\b/i.test(query)
    && /\binsulat(?:e|ed|ing|ion)\b/i.test(query)) {
    return structured("insulation", {
      directAnswer:
        "There is no safe universal yes or no for retrofit wall-cavity insulation. The existing wall must be identified as an assembly: inner and outer leaves, cavity and drainage function, membranes, weep holes, wiring and services, moisture history, fire details and how the proposed system is installed and dries. Filling a cavity that must drain or ventilate, bridging moisture, obstructing weep holes or hiding unsafe wiring can create damage. Require a building-specific inspection and written system scope rather than relying on the house age or product claim.",
      status: "needs_context",
      citations: officialCitationsById(["yourhome-insulation", "yourhome-construction-systems", "ncc-condensation-handbook"]),
      confidence: "medium",
      assumptions: ["The wall build-up, cavity condition, moisture path, services, fire requirements and product system have not been inspected."],
      practicalSteps: [
        "Verify the wall construction, cavity width and condition, drainage, weep holes, membranes, services and signs of moisture.",
        "Require the proposed installer to state the complete tested system, target system R-value, installation method, moisture and fire controls and completion evidence.",
        "Resolve leaks, damp and unsafe electrical work before any concealed fill is installed.",
      ],
      toolActions: [{ id: "open-insulation-guide", label: "Open the insulation guide", href: "/guides/insulation-draught-proofing" }],
      suggestedQuestions: ["What is the verified wall build-up, and are there weep holes, damp, wiring or other services in the cavity?"],
    });
  }

  if (/\b(?:concrete\s+)?slab\b/i.test(query)
    && /\b(?:cold|rugs?|carpet|floor insulation|insulate|comfort)\b/i.test(query)) {
    return structured("comfort_fabric", {
      directAnswer:
        "A rug can improve immediate foot and local radiant comfort by separating people from a cold slab surface, but it does not automatically fix heat loss through the whole floor. Durable insulation depends on the slab type and what it adjoins: a suspended slab over an accessible unconditioned space, a ground-bearing slab and an exposed slab edge need different details. Check moisture first, then assess edge, under-slab or below-floor options that are actually accessible and compatible with the assembly.",
      status: "needs_context",
      citations: officialCitationsById(["yourhome-thermal-mass", "yourhome-insulation", "yourhome-construction-systems"]),
      confidence: "medium",
      assumptions: ["The slab type, insulation, exposed edges, moisture, floor finishes and space below have not been inspected."],
      practicalSteps: [
        "Use a dry, stable rug and suitable underlay for reversible local comfort without covering damp or a heater clearance.",
        "Identify whether the slab is ground-bearing or suspended and map exposed edges, moisture and accessible surfaces.",
        "Compare a building-specific insulation scope with the measured comfort problem before altering floor levels or finishes.",
      ],
      toolActions: [{ id: "open-home-plan", label: "Build a floor comfort plan", href: "/plan" }],
      suggestedQuestions: ["Is the slab on ground or suspended over another space, and is there any damp or exposed slab edge?"],
    });
  }

  if (/\bthermal bridges?\b/i.test(query)
    || /\b(?:steel|metal|timber)\s+(?:stud|frame|framing)\b/i.test(query)
      && /\b(?:bypass|conduct|bridge|through|insulation|heat flow)\b/i.test(query)) {
    return structured("comfort_fabric", {
      directAnswer:
        "A thermal bridge is a more conductive path through or around insulation, such as framing, slab edges, structural junctions or metal window frames. Heat follows that easier path, lowering the completed assembly's effective R-value and making the inside surface colder in winter or hotter in summer. A cold bridge can also bring a surface closer to the indoor dew point, increasing local condensation and mould risk when moisture is present.",
      status: "answered",
      citations: officialCitationsById(["yourhome-insulation", "yourhome-construction-systems", "ncc-condensation-handbook"]),
      confidence: "high",
      assumptions: ["No junction, surface temperature, moisture level or completed assembly has been inspected."],
      practicalSteps: [
        "Locate the repeating cold, hot or wet line and relate it to framing, edges, junctions or metal components.",
        "Check insulation continuity, air leakage and moisture together rather than covering the symptom alone.",
        "Use an assembly-specific continuous-insulation or junction detail for permanent work.",
      ],
      toolActions: [{ id: "open-home-plan", label: "Map the thermal envelope", href: "/plan" }],
      suggestedQuestions: ["Where is the suspected bridge, and does it show as a cold line, condensation or a comfort problem?"],
    });
  }

  if (/\b(?:windows?|glass|glazing|frames?)\b/i.test(query)
    && /\b(?:drip|drips|dripping|wet|condensation|condense|water on)\b/i.test(query)
    && /\b(?:winter|cold|morning|overnight|humidity|ventilat|glass|frame)\b/i.test(query)
    && !/\b(?:rent|rental|renter|tenant)\b/i.test(query)
    && !(/\b(?:mould|mold)\b/i.test(query) && /\b(?:behind|wardrobe|wall|ceiling|cupboard)\b/i.test(query))) {
    return structured("glazing_shading", {
      directAnswer:
        "Window condensation forms when warm moisture-laden indoor air meets glass or frames cold enough to fall below its dew point. It is not simply a choice between bad glass and bad ventilation. Glazing and frames set the inside surface temperature, while showers, cooking, clothes drying, occupants, heating and ventilation set indoor moisture. Check that moisture balance, window seals and drainage before choosing new glazing; persistent water inside the wall or wetting linked to rain needs a building-specific leak assessment.",
      status: "needs_context",
      citations: officialCitationsById(["yourhome-glazing", "yourhome-condensation-moisture", "yourhome-ventilation-airtightness"]),
      confidence: "medium",
      assumptions: ["Indoor humidity, glass and frame type, surface temperature, exhaust operation, drainage and rain timing have not been checked."],
      practicalSteps: [
        "Record whether wetting follows cold occupied nights, showers or rain, and measure indoor humidity if possible.",
        "Use working kitchen and bathroom exhaust to outdoors, dry wet surfaces and keep designed drainage and vents open.",
        "Assess the complete glazing, frame, seals, heating and moisture source before replacement or permanent sealing.",
      ],
      toolActions: [{ id: "open-home-plan", label: "Build a window and moisture plan", href: "/plan" }],
      suggestedQuestions: ["Does the water form on the room side during cold occupied nights, between panes, or mainly when it rains?"],
    });
  }

  if (/\b(?:aluminium|aluminum|metal)\b/i.test(query)
    && /\b(?:window|frame)\b/i.test(query)
    && /\b(?:drip|drips|dripping|wet|condensation|condense)\b/i.test(query)) {
    return structured("glazing_shading", {
      directAnswer:
        "A metal window frame can be the coldest part of the whole window because aluminium conducts heat readily and may form a thermal bridge around the glazing. Indoor moisture can therefore reach dew point on the frame before it does on the centre of the glass. The pattern does not by itself prove a leak: frame drainage, seals, indoor humidity, room heating, outside temperature and any thermal break still need checking.",
      status: "needs_context",
      citations: officialCitationsById(["yourhome-glazing", "yourhome-condensation-moisture", "ncc-condensation-handbook"]),
      confidence: "medium",
      assumptions: ["The frame type, drainage, seals, surface temperatures, indoor humidity and rain pattern have not been checked."],
      practicalSteps: [
        "Dry the frame, run kitchen and bathroom exhaust to outdoors and record whether wetting follows occupancy, showers, cold weather or rain.",
        "Keep drainage paths open and check seals without blocking designed weep holes or vents.",
        "Assess the whole-window frame, glazing, installation and moisture strategy before replacement or sealing.",
      ],
      toolActions: [{ id: "open-insulation-guide", label: "Open the window and moisture guide", href: "/guides/insulation-draught-proofing" }],
      suggestedQuestions: ["Does the frame wet mainly on cold mornings or during rain, and what indoor humidity and exhaust use apply?"],
    });
  }

  if (/\b(?:stuffy|stale air|CO2|carbon dioxide|ppm|HRV|MVHR|heat recovery ventilation|mechanical heat recovery)\b/i.test(query)
    && /\b(?:seal|sealed|sealing|draught|draft|airtight|bedroom|overnight|ventilat|fresh air|HRV|MVHR)\b/i.test(query)) {
    const mentionsHeatRecovery = /\b(?:HRV|MVHR|heat recovery ventilation|mechanical heat recovery)\b/i.test(query);
    return structured("draughts_ventilation", {
      directAnswer:
        `Stuffiness or a repeatable occupied-room CO2 rise after sealing is a signal to check deliberate fresh-air ventilation, pollutant sources and exhaust, not a reason to reopen random leaks. A consumer CO2 reading is not a complete health diagnosis and must be checked against monitor accuracy and the occupancy pattern. ${mentionsHeatRecovery ? "Heat-recovery ventilation can provide controlled outdoor air while recovering some heat, but it is not automatically required or correctly sized from one symptom or reading. " : ""}First verify bathroom and kitchen exhaust to outdoors, safe make-up air and whether safe window ventilation resolves the pattern; use building-specific design if it persists.`,
      status: "needs_context",
      citations: officialCitationsById(["yourhome-indoor-air-quality", "yourhome-ventilation-airtightness", "ncc-condensation-handbook"]),
      confidence: "medium",
      assumptions: ["Monitor accuracy, room volume, occupancy, outdoor conditions, pollutant sources and ventilation flow have not been measured."],
      practicalSteps: [
        "Check the monitor outdoors or against its instructions, then log room occupancy, doors, windows and readings rather than relying on one peak.",
        "Use working exhaust and safe controllable outdoor air without blocking or altering required vents and flues.",
        "If the pattern or symptoms persist, obtain a building-specific ventilation and source-control assessment before buying an HRV or purifier.",
      ],
      toolActions: [{ id: "open-insulation-guide", label: "Open the ventilation guide", href: "/guides/insulation-draught-proofing" }],
      suggestedQuestions: ["What room volume and occupancy produced the reading, for how long, and what outdoor-air or exhaust path was operating?"],
    });
  }

  if (/\b(?:bedroom|room|upstairs|upper floor|top floor|home|house|unit|apartment)\b/i.test(query)
    && /\b(?:hot|warm|roasting|baking|boiling)\b/i.test(query)
    && /\b(?:at night|overnight|midnight|late at night|after sunset|outdoor air (?:has )?cool(?:s|ed|ing)?|outside (?:has )?cool(?:s|ed|ing)?|evening|night air)\b/i.test(query)) {
    return structured("comfort_fabric", {
      directAnswer:
        "A room can stay hot after outdoors cools because the roof, walls, slab and furnishings absorbed daytime heat and release it later, while warm air is trapped by limited cross-flow or a hotter roof space. Late sun, weak ceiling insulation, dark exposed surfaces, closed internal paths and high outdoor humidity can add to the lag. Remove daytime heat gain first, then use cooler outdoor air only when it is actually cooler and safe.",
      status: "needs_context",
      citations: officialCitationsById(["yourhome-passive-cooling", "yourhome-thermal-mass", "yourhome-insulation"]),
      confidence: "medium",
      assumptions: ["Orientation, shade, roof and wall construction, insulation, night temperatures, humidity and safe opening paths have not been checked."],
      practicalSteps: [
        "Block direct sun before it reaches glass and exposed surfaces, especially late east or west sun.",
        "When outside air is cooler and smoke, humidity, noise and security allow, create a safe cross-flow and use a fan to move cooler air across occupants.",
        "Check ceiling insulation continuity, roof-space heat and the hottest surfaces before adding cooling equipment.",
      ],
      toolActions: [{ id: "open-home-plan", label: "Build a summer comfort plan", href: "/plan" }],
      suggestedQuestions: ["Which direction faces the hot room, what is above it, and can cooler night air safely flow in and out?"],
    });
  }

  if (/\b(?:rent|renter|tenant|rental)\b/i.test(query)
    && /\b(?:cannot|can't|not allowed|without|no permission)\b[^\n]{0,25}\b(?:drill|fix|fixed|alter|install|permission|shade)\b/i.test(query)
    && /\b(?:afternoon|summer|hot|heat|overheat|sun)\b/i.test(query)) {
    return structured("renters_strata", {
      directAnswer:
        "Use reversible heat control first. Close a well-fitted light-coloured blind or curtain before afternoon sun reaches the glass, add a stable portable fan for personal cooling, and use safe cross-ventilation or night purging only when outdoors is cooler and smoke, humidity, noise and security allow. External shade is usually more effective but needs owner or strata permission; removable film or coverings must also suit the exact glass and lease because thermal stress, residue and common-property rules can apply. Use the current state rental repair or alteration pathway for any unsafe condition or fixed work.",
      status: "needs_context",
      citations: officialCitationsById([
        "energy-gov-renters",
        "yourhome-passive-cooling",
        rentalSafetySourceId(query) || "yourhome-shading",
      ]),
      confidence: "medium",
      assumptions: ["Orientation, existing coverings, glass type, lease, strata rules and local heat conditions have not been checked."],
      practicalSteps: [
        "Close existing coverings before the sun arrives and position a portable fan to cool people without overloading an outlet.",
        "Vent only when outside air is cooler and safe, then close up before conditions worsen.",
        "Ask in writing before attaching film, external shade, window hardware or any fixed cooling equipment.",
      ],
      toolActions: [{ id: "open-home-plan", label: "Build a renter cooling plan", href: "/plan" }],
      suggestedQuestions: ["Which direction does the hot window face, and what removable blind, curtain or safe opening is already available?"],
    });
  }

  if (/\b(?:rent|renter|tenant|rental|top-floor unit|top floor unit)\b/i.test(query)
    && /\b(?:heatwave|extreme heat|stay safe|dangerously hot)\b/i.test(query)) {
    return structured("renters_strata", {
      directAnswer:
        "Treat extreme indoor heat as an immediate safety and shelter problem before an equipment purchase. Block sun early, use safe air movement, drink water and reduce indoor heat sources. Vent only when outdoor air is cooler and smoke and security conditions allow. If the home cannot be kept safe, use the current local heat-health service or a cooler public or supported location; call 000 for a medical emergency. Fixed shading or air conditioning needs owner and possibly strata approval, but a dated written request can document the unsafe condition.",
      status: "needs_context",
      citations: officialCitationsById(["energy-gov-renters", "yourhome-passive-cooling"]),
      confidence: "medium",
      assumptions: ["Current indoor temperature, health vulnerability, local heat-health warning, cooling access and tenancy rules are not known."],
      practicalSteps: [
        "Close sun-exposed windows and coverings early, move to the coolest zone and use a stable portable fan only within its safe operating conditions.",
        "Check the current local heat-health advice and move to a cooler supported place if the unit cannot be kept safe.",
        "Record indoor conditions and request urgent owner or agent action for fixed shading, cooling or building faults.",
      ],
      toolActions: [],
      suggestedQuestions: ["What postcode and current indoor temperature apply, and is anyone unable to reach a cooler safe place?"],
    });
  }

  if (/\bVictorian\b|\bVictoria\b|\bVIC\b/.test(query)
    && /\b(?:landlord|renter|tenant|rental)\b/i.test(query)
    && /\bceiling insulation\b/i.test(query)
    && /\b(?:refuse|permission|allow|install|rights?)\b/i.test(query)) {
    return structured("renters_strata", {
      directAnswer:
        "Do not install fixed ceiling insulation without the required written permission and licensed safety checks. Whether a Victorian landlord can refuse depends on the current alteration, repair and minimum-standard rules and the proposed work. The maintained Victorian source must be used, not an ACT insulation rule; additional Victorian energy standards begin in phases from 1 March 2027, so a future requirement must not be presented as already enforceable on 20 August 2026.",
      status: "needs_context",
      citations: officialCitationsById(["vic-rental-minimum-energy-standards", "energy-gov-renters"]),
      confidence: "medium",
      assumptions: ["The lease date, existing insulation, building type, electrical inspection, alteration category and any exemption have not been checked."],
      practicalSteps: [
        "Send the owner or agent a written proposal with the existing-condition evidence, safety inspection and installer scope.",
        "Check the current Consumer Affairs Victoria alteration and minimum-standard process for the lease date.",
        "Use the Victorian dispute or repair pathway if the request also concerns a current legal minimum or urgent building defect.",
      ],
      toolActions: [],
      suggestedQuestions: ["What is the lease start date, current insulation evidence and written reason the landlord gave?"],
    });
  }

  const baseloadWatts = numericCapture(query, /\b([\d,]+(?:\.\d+)?)\s*(?:W|watts?)\b/i)
    ?? (() => {
      const kw = numericCapture(query, /\b([\d,]+(?:\.\d+)?)\s*kW\b/i);
      return kw === null ? null : kw * 1000;
    })();
  const baseloadLabel = baseloadWatts === null
    ? "A steady overnight load"
    : "A steady " + baseloadWatts.toLocaleString("en-AU") + " W overnight load";
  if (/\b(?:baseload|base load|smart meter|overnight load|all night)\b/i.test(query)
    && /\b(?:appliance|cause|causes|causing|find|identify|load|shows?|drawing|using|power|watts?|kW)\b/i.test(query)) {
    return structured("bills_tariffs", {
      directAnswer:
        baseloadLabel + " cannot identify one appliance by itself. Confirm the interval duration and whether a controlled-load channel is separate, then match the pattern to equipment that can run overnight, such as hot water, refrigeration, pool or spa pumps, heating, EV charging and standby loads. Use appliance schedules and safe plug-load tests; do not open a switchboard, disconnect hard-wired equipment or switch off medical, safety or essential loads.",
      status: "needs_context",
      citations: officialCitationsById(["aemo-mdff-nem12-nem13-v2-7", "energy-gov-energy-rating"]),
      confidence: "medium",
      assumptions: ["Meter channels, interval duration, controlled load, appliance schedules and circuit measurements have not been verified."],
      practicalSteps: [
        "Confirm the load is repeatable across several nights and note its start, stop and cycling pattern on the correct import channel.",
        "Match that timing to hot water, refrigeration, pumps, heating, EV charging and other scheduled equipment.",
        "Test only safe user-operated plug loads one at a time; use a licensed electrician or suitable monitor for hard-wired circuits.",
      ],
      toolActions: [{ id: "compare-electricity", label: "Open the interval tools", href: "/compare" }],
      suggestedQuestions: ["How long does the load persist, does it cycle, and are hot water, pumps, heating or EV charging on a separate controlled-load channel?"],
    });
  }

  const applianceDailyKwh = numericCapture(query, /\b([\d,]+(?:\.\d+)?)\s*kWh\s+(?:a|per)\s+day\b/i);
  if (/\b(?:fridge|freezer|refrigerator|appliance)\b/i.test(query)
    && applianceDailyKwh !== null) {
    const annualKwh = Math.round(applianceDailyKwh * 365).toLocaleString("en-AU");
    return structured("products_ratings", {
      directAnswer:
        `${applianceDailyKwh.toLocaleString("en-AU")} kWh a day is about ${annualKwh} kWh a year if that period is representative, but whether it is high depends on the exact appliance category, size, age, climate class, room temperature, settings, door use and condition. Compare the measured annualised figure with the exact model's Energy Rating annual kWh on the same use basis, then check seals, ventilation clearances, temperature settings, frost and cycling before assuming replacement is justified.`,
      status: "needs_context",
      citations: officialCitationsById(["energy-gov-energy-rating"]),
      confidence: "medium",
      assumptions: ["The measurement duration, exact model, storage volume, room conditions and label test figure are not known."],
      practicalSteps: [
        "Measure for at least several representative days and confirm no other load shares the plug or monitor.",
        "Record the exact model, volume, temperature settings, room temperature, door seals, ventilation clearance and frost condition.",
        "Compare annualised measured kWh with the exact label figure and replacement cost before deciding.",
      ],
      toolActions: [],
      suggestedQuestions: ["What exact model, storage volume and label annual kWh apply, and over how many days was the measurement taken?"],
    });
  }

  if (/\b(?:fridge|freezer|refrigerator)\b/i.test(query)
    && /\b(?:too much|high|excess|uses?|using|energy|power|electricity|running|cost)\b/i.test(query)) {
    return structured("products_ratings", {
      directAnswer:
        "First measure the fridge alone over several representative days; a bill or whole-house interval cannot identify it by itself. Then compare annualised measured kWh with the exact model's Energy Rating annual kWh for a similar category and volume. High use can come from warm surroundings, damaged door seals, poor ventilation clearance, frequent opening, unsuitable temperature settings, heavy frost, a dirty accessible condenser area, cycling faults or an old or oversized unit. Check those causes before assuming replacement will save money.",
      status: "needs_context",
      citations: officialCitationsById(["energy-gov-energy-rating"]),
      confidence: "medium",
      assumptions: ["No appliance-only measurement, exact model, volume, label kWh, temperature setting or installation condition has been supplied."],
      practicalSteps: [
        "Measure only the appliance for several representative days without opening electrical panels.",
        "Record exact model, volume, settings, room temperature, seals, frost and manufacturer-required clearances.",
        "Annualise the measured kWh and compare it with the exact label before pricing replacement.",
      ],
      toolActions: [],
      suggestedQuestions: ["What exact model and label annual kWh apply, and what appliance-only kWh did you measure over how many days?"],
    });
  }

  const hotWaterOccupants = numericCapture(query, /\b([\d,]+)\s*(?:people|persons?|occupants?|adults?|family members?)\b/i)
    ?? (/\b(?:five|family of five)\b/i.test(query) ? 5 : null);
  if (/\b(?:heat[- ]?pump|HPWH|HPHW)\b/i.test(query)
    && /\b(?:hot[- ]?water|water heater|tank|storage|HWS)\b/i.test(query)
    && hotWaterOccupants !== null
    && /\b(?:size|sizing|litres?|liters?|capacity|big|large|enough|suitable)\b/i.test(query)) {
    return structured("heat_pump_hot_water", {
      directAnswer:
        `${hotWaterOccupants.toLocaleString("en-AU")} occupants does not determine one safe tank size. Size from peak draw, shower flow and duration, baths and simultaneous use, usable stored volume, cold-water inlet temperature, recovery at the local winter condition, allowed boost, tariff or solar heating window and available space. A larger tank can cover peaks but adds standing loss and cost; a smaller unit may recover too slowly. Require the quote to show demand and recovery, not only nominal litres.` ,
      status: "needs_context",
      citations: officialCitationsById(["energy-gov-electrification", "nsw-iheab-hpwh-fact-sheet-v2-2"]),
      confidence: "medium",
      assumptions: ["Peak hot-water draw, climate, usable volume, recovery, boost and control window have not been supplied."],
      practicalSteps: [
        "Record the busiest-hour showers, baths, appliances and simultaneous draws.",
        "Compare usable tank volume and winter recovery with that peak and the permitted heating window.",
        "Check noise, airflow, condensate, electrical and plumbing scope, warranty and exact-model eligibility separately.",
      ],
      toolActions: [{ id: "open-hot-water-guide", label: "Open the hot-water sizing guide", href: "/guides/hot-water" }],
      suggestedQuestions: ["At the busiest time, how many showers or baths occur, for how long, and must the unit recover within a tariff or solar window?"],
    });
  }

  if (/\b(?:COP|coefficient of performance)\b/i.test(query)
    && /\b(?:mean|real|actual|guarantee|always|year|season|compare|rank|best|good|efficien)\b/i.test(query)) {
    return structured(/\b(?:hot[- ]?water|HPWH|water heater)\b/i.test(query) ? "heat_pump_hot_water" : "rcac", {
      directAnswer:
        "A headline COP is output heat divided by electricity at a stated test condition. It is not a guaranteed seasonal result. Outdoor or source temperature, delivered-water or indoor temperature, part-load cycling, defrost, fans and pumps, resistive boost, controls and installation change real electricity use. Compare exact models at the relevant local design condition and use seasonal or annual energy information on the same capacity basis rather than ranking by one COP.",
      status: "needs_context",
      citations: officialCitationsById(["energy-gov-electrification", "energy-rating-heating-cooling", "energy-rating-zoned-label"]),
      confidence: "high",
      assumptions: ["The COP test point, required output, climate, controls and annual energy have not been supplied."],
      practicalSteps: [
        "Record the temperature and operating condition attached to each COP.",
        "Compare delivered capacity and seasonal or annual energy at the same required load and climate.",
        "Include boost, defrost, pumps, controls and commissioning in the written comparison.",
      ],
      toolActions: [],
      suggestedQuestions: ["What COP test temperature, delivered capacity and local design condition apply to each option?"],
    });
  }

  if (/\b(?:heat[- ]?pump|HPWH)\b/i.test(query)
    && /\b(?:hot[- ]?water|water heater|unit)\b/i.test(query)
    && (/\b(?:turn|switch)\b[^\n]{0,60}\boff\b/i.test(query)
      || /\b(?:timer|schedule|overnight|nightly|every night|10\s*(?:am|a\.m\.)|3\s*(?:pm|p\.m\.))\b/i.test(query))) {
    return structured("heat_pump_hot_water", {
      directAnswer:
        "Do not switch a heat-pump water heater off every night as a generic saving rule. Use its approved timer or control strategy to match genuine solar or cheaper-tariff windows while preserving the manufacturer's temperature, hygiene, defrost and protection cycles and enough recovery for peak hot-water demand. A narrow schedule can cause a cold tank or trigger expensive boost operation if the tank, climate and draw pattern do not fit it.",
      status: "needs_context",
      citations: officialCitationsById(["energy-gov-smart-hot-water", "energy-gov-electrification", "energy-rating-product-register"]),
      confidence: "medium",
      assumptions: ["The exact model instructions, tank volume, draw profile, tariff, solar surplus, ambient temperature and boost control are not known."],
      practicalSteps: [
        "Check the exact model manual for permitted timer, hygiene, frost and restart behaviour rather than cutting supply externally.",
        "Compare household draw and recovery with the intended solar or tariff window over cold and high-use days.",
        "Monitor comfort and total import, including any resistive boost, before keeping the schedule.",
      ],
      toolActions: [{ id: "open-hot-water-guide", label: "Open the hot-water guide", href: "/guides/hot-water" }],
      suggestedQuestions: ["What exact model, tank size, household draw pattern, tariff and solar window apply?"],
    });
  }

  if (/\b(?:induction|electric cooktop)\b/i.test(query)
    && /\b(?:gas|LPG|natural gas)\b/i.test(query)
    && /\b(?:cheap|cheaper|cost|running cost|save|saving|efficient|efficiency|versus|vs\.?|compare)\b/i.test(query)) {
    return structured("induction", {
      directAnswer:
        "Induction usually transfers a larger share of purchased energy into the cookware than a gas or LPG flame, but that does not prove a lower bill for every home. Compare the same cooking task using the complete electricity c/kWh and gas $/MJ or LPG refill cost, realistic appliance energy, and any solar timing. Count gas supply charges as avoidable only if this is the last gas appliance and the service can actually be disconnected; include cookware, circuit, switchboard, installation and gas-disconnection costs separately.",
      status: "needs_context",
      citations: officialCitationsById(["energy-gov-appliances-cooking", "energy-gov-energy-rating", "energy-made-easy-current-plan-comparison"]),
      confidence: "medium",
      assumptions: ["Cooking energy, electricity tariff, gas or LPG price, solar timing, remaining gas appliances and conversion costs are not known."],
      practicalSteps: [
        "Use a representative week of cooking and the complete electricity, gas or LPG prices rather than headline unit rates alone.",
        "Separate variable cooking energy from appliance purchase, cookware, electrical work and licensed gas disconnection.",
        "Test the case with and without an avoidable gas supply charge and with realistic solar self-use.",
      ],
      toolActions: [{ id: "compare-electricity", label: "Check the electricity tariff", href: "/compare" }],
      suggestedQuestions: ["What electricity c/kWh, gas $/MJ or LPG refill cost, cooking pattern and remaining gas appliances apply?"],
    });
  }

  if (/\b(?:Mode\s*2|Mode\s*3)\b/i.test(query)
    && /\b(?:charger|charging|cable|EVSE|wall charger|wallbox|difference|versus|vs\.?)\b/i.test(query)) {
    return structured("ev_charging", {
      directAnswer:
        "Mode 2 and Mode 3 describe charging arrangements, not two vehicle models. Mode 2 commonly uses a portable cable with in-cable control and protection from a suitable outlet. Mode 3 uses dedicated fixed AC charging equipment that communicates with the vehicle and can support higher power or smart controls, subject to the vehicle and site limits. The plug shape alone does not establish the mode, safe current or charging speed; use the exact equipment documentation and a licensed electrician for the outlet, circuit, protection and fixed installation.",
      status: "answered",
      citations: officialCitationsById(["energy-gov-ev-charging-equipment", "energy-gov-ev-home-strata-charging"]),
      confidence: "medium",
      assumptions: ["The exact cable, EVSE, outlet, vehicle input limit and site electrical design have not been verified."],
      practicalSteps: [
        "Identify the exact cable or EVSE model and its documented mode, current, connector and vehicle compatibility.",
        "Have a licensed electrician verify the outlet or dedicated circuit, protection, switchboard and supply capacity.",
        "Choose charging power and controls from daily kilometres, parked time, tariff and solar after applying the site and vehicle limits.",
      ],
      toolActions: [{ id: "open-ev-guide", label: "Open the EV charging guide", href: "/guides/ev-charging" }],
      suggestedQuestions: ["What exact cable or wall charger, vehicle and outlet or circuit are being compared?"],
    });
  }

  if (/\b(?:charger|charging|EVSE|wallbox)\b/i.test(query)
    && /\b7\s*kW\b/i.test(query)
    && /\b11\s*kW\b/i.test(query)) {
    return structured("ev_charging", {
      directAnswer:
        "An 11 kW AC charger is not automatically more useful than 7 kW. About 7 kW commonly aligns with a suitable single-phase installation, while 11 kW normally needs compatible three-phase supply, charger and vehicle onboard AC charging. The car's input limit, daily energy to replace, parked hours, site capacity and simultaneous loads can make both deliver the same practical overnight result. A licensed electrician must design maximum demand, protection and any load management.",
      status: "needs_context",
      citations: officialCitationsById(["energy-gov-ev-charging-equipment", "energy-gov-ev-home-strata-charging"]),
      confidence: "high",
      assumptions: ["The vehicle onboard AC limit, phases, main switch, daily kilometres, parked window and other loads are not known."],
      practicalSteps: [
        "Convert daily kilometres to the kWh that normally needs replacing and divide by parked hours.",
        "Confirm supply phases, service capacity and the exact vehicle's onboard AC limit.",
        "Have a licensed electrician specify circuit protection, allowed current and fail-safe load management.",
      ],
      toolActions: [{ id: "open-ev-guide", label: "Open the EV charging guide", href: "/guides/ev-charging" }],
      suggestedQuestions: ["What vehicle AC limit, daily kilometres, parked hours, supply phase and main-switch rating apply?"],
    });
  }

  if (/\b(?:WLTP|NEDC|ADR\s*81\/02|certified range|rated range)\b/i.test(query)
    && /\b(?:EV|electric vehicle|electric car|range|km|kilometres?|kilometers?)\b/i.test(query)
    && /\b(?:tow|towing|trailer|caravan|winter|cold weather|snow|highway|real world|real-world)\b/i.test(query)) {
    return structured("ev_charging", {
      directAnswer:
        "A WLTP or other certified range is a same-cycle comparison fact, not a promise for towing, winter or a particular highway trip. Speed, cold battery and cabin heating, trailer drag and mass, tyres, elevation, wind, payload and charging reserve can all reduce usable range. Do not apply an invented universal percentage. Plan the hardest regular trip with a conservative reserve, current charger spacing and vehicle-specific evidence, then verify it in similar conditions before relying on it.",
      status: "needs_context",
      citations: officialCitationsById(["green-vehicle-guide-compare", "energy-gov-electric-vehicles"]),
      confidence: "high",
      assumptions: ["The exact vehicle, certified cycle, trailer, temperature, route, speed, load and charger reliability are not known."],
      practicalSteps: [
        "Record the exact variant, same-cycle certified energy use and range, trailer mass and the hardest route conditions.",
        "Plan legs with a conservative arrival reserve and verified compatible chargers, including an alternative stop.",
        "Test the vehicle on a comparable loaded trip before treating the plan as dependable.",
      ],
      toolActions: [{ id: "open-ev-guide", label: "Open the EV comparison guide", href: "/guides/ev-charging" }],
      suggestedQuestions: ["What exact variant, trailer mass, route, winter temperature, cruising speed and minimum arrival reserve apply?"],
    });
  }

  if (/\b(?:charger|EVSE|wall charger|wallbox)\b/i.test(query)
    && /\b(?:single phase|three phase|switchboard|oven|air ?con|maximum demand|load management|circuit capacity)\b/i.test(query)
    && /\b(?:run|running|while|capacity|support|install|kW)\b/i.test(query)) {
    return structured("ev_charging", {
      directAnswer:
        "A charger's nameplate power does not prove the home can run it with the oven, air conditioning and other loads. Single-phase charging may be technically possible, but a licensed electrician must check the service limit, main switch, switchboard, dedicated circuit and protection, maximum demand, voltage effects and the vehicle's onboard AC limit. Dynamic load management can reduce charging when household demand rises, but its fail-safe design and commissioning must be part of the written scope.",
      status: "needs_context",
      citations: officialCitationsById(["energy-gov-ev-charging-equipment", "energy-gov-ev-home-strata-charging"]),
      confidence: "high",
      assumptions: ["Supply rating, phases, main switch, maximum demand, vehicle limit, charger controls and network constraints have not been inspected."],
      practicalSteps: [
        "Give the electrician the service, switchboard, major-load and exact vehicle and charger details.",
        "Require the design to state the dedicated circuit, protection, allowed charging current and any dynamic load-management response.",
        "Commission simultaneous-load and fail-safe behaviour before relying on the advertised charging power.",
      ],
      toolActions: [{ id: "open-ev-guide", label: "Open the EV charging guide", href: "/guides/ev-charging" }],
      suggestedQuestions: ["What supply phase and main-switch rating, exact vehicle AC limit, charger power and major simultaneous loads apply?"],
    });
  }

  if (/\b(?:reverse[ -]cycle|air conditioner|air conditioning|RCAC|split system)\b/i.test(query)
    && /\b(?:size|capacity|how (?:big|large)|what kW)\b/i.test(query)
    && /\b(?:square metres?|m2|m²|room|space)\b/i.test(query)) {
    return structured("rcac", {
      directAnswer:
        "Floor area alone cannot size a reverse-cycle air conditioner. The room heat load also depends on postcode and design temperatures, ceiling height, insulation, glazing area and orientation, external shade, air leakage, adjoining spaces, occupancy and internal heat. An oversized unit can cycle poorly and an undersized unit can miss comfort, so require a room load and compare exact models by retained capacity and seasonal performance at the local conditions.",
      status: "needs_context",
      citations: officialCitationsById(["energy-rating-heating-cooling", "energy-rating-zoned-label", "energy-gov-heating-cooling"]),
      confidence: "high",
      assumptions: ["Only a room area or sizing intent is known; the climate, fabric, glazing, shade and design load have not been calculated."],
      practicalSteps: [
        "Record postcode, dimensions, ceiling height, construction, insulation, glazing orientation and shade for the room.",
        "Ask for a heating and cooling load at local design conditions rather than an area rule of thumb.",
        "Compare the required load with exact-model retained capacity, seasonal energy, noise, placement, drainage and electrical scope.",
      ],
      toolActions: [{ id: "open-heating-guide", label: "Open the heating and cooling guide", href: "/guides/heating" }],
      suggestedQuestions: ["What postcode, room dimensions, insulation, glazing orientation and external shade apply?"],
    });
  }

  if (/\b(?:rent|renter|tenant|rental)\b/i.test(query)
    && /\b(?:portable air conditioner|portable aircon|portable AC|portable RCAC)\b/i.test(query)) {
    return structured("renters_strata", {
      directAnswer:
        "A plug-in portable air conditioner avoids a fixed refrigerant installation, but it still needs a safe suitable outlet, an unobstructed exhaust hose to outdoors, condensate management and a window or door insert that complies with the lease, security and any strata rules. Portable units are generally noisier and less efficient than a suitable fixed system. Do not drill, alter common property or overload an extension lead; obtain written permission for any attached panel or alteration and use the current state rental repair or alteration pathway for fixed defects.",
      status: "needs_context",
      citations: officialCitationsById(["energy-gov-renters", "energy-gov-heating-cooling", ...(rentalSafetySourceId(query) ? [rentalSafetySourceId(query) as string] : [])]),
      confidence: "medium",
      assumptions: ["The lease, strata rules, window type, outlet circuit, exhaust route, condensate and cooling load have not been checked."],
      practicalSteps: [
        "Check the lease and ask in writing about the proposed removable window insert and exhaust arrangement.",
        "Use a suitable wall outlet and manufacturer-approved exhaust and condensate setup without an overloaded extension lead.",
        "Compare noise and label energy use with reversible shading and fan cooling before purchase.",
      ],
      toolActions: [],
      suggestedQuestions: ["What window or door can safely exhaust outdoors, and does the lease or strata rule allow a removable insert?"],
    });
  }

  if (playbookId === "solar_stc") {
    const missing = missingSolarStcSlots(playbookConversation);
    const nextQuestions = missing.slice(0, 1).map((slot) => SOLAR_STC_SLOT_QUESTIONS[slot]);
    const baseCitations = officialCitationsById([
      "cer-stc-entitlement-calculation",
      "cer-small-scale-system-requirements",
      "energy-gov-rebates",
    ]);
    if (missing.length) {
      return structured("rebates_certificates", {
        directAnswer:
          `I cannot safely turn an STC estimate into a dollar rebate from the facts collected so far. I still need only these missing inputs: ${nextQuestions.join(" ")}`,
        status: "needs_context",
        citations: baseCitations,
        confidence: "low",
        assumptions: [
          "Federal STC certificate quantity, an agent or installer discount, and a state rebate or loan are separate outcomes.",
          "No certificate quantity, dollar value, product approval or installer eligibility has been assumed.",
        ],
        practicalSteps: [
          "Reply with the requested facts in one message if convenient.",
          "Keep the exact proposed and existing product details with the quote.",
          "Do not rely on a dollar figure until the governed calculator and quote terms agree.",
        ],
        toolActions: [],
        suggestedQuestions: nextQuestions,
      });
    }

    const jurisdiction = explicitProgramJurisdiction(playbookConversation);
    const wantsSolar = /\b(?:solar PV|PV system|solar system|install(?:ing|ation)? (?:of )?(?:solar|PV)|new (?:solar|PV))\b/i.test(playbookConversation);
    const wantsBattery = /\b(?:home battery|battery system|battery STC|battery capacity|install(?:ing|ation)? (?:of )?(?:a )?battery|new (?:home )?battery)\b/i.test(playbookConversation);
    const statePrograms = jurisdiction && jurisdiction[0] !== "AU"
      ? GOVERNMENT_PROGRAM_TEMPLATES.filter((program) => {
        if (
          (program.catalogueState !== "current" && program.catalogueState !== "limited")
          || program.jurisdiction !== jurisdiction[0]
        ) return false;
        const text = searchable(`${program.name} ${program.officialSourceTitle} ${program.operatingNote}`);
        return (wantsSolar && /\b(?:solar|pv)\b/.test(text))
          || (wantsBattery && /\b(?:battery|storage)\b/.test(text));
      }).slice(0, 2)
      : [];
    const stateContext = statePrograms.length
      ? `Separate ${jurisdiction?.[1]} programmes to check are ${statePrograms.map((program) => `${program.name} (${program.outcomeClass.replaceAll("_", " ")})`).join(" and ")}. They do not change the federal STC calculation.`
      : `No separate state rebate or loan is being assumed for ${jurisdiction?.[1] || "the property"}; Australian Energy Assessments' rebate tool must check that independently.`;
    const technologyBoundary = wantsBattery && wantsSolar
      ? "The PV and battery components must each be checked under their applicable current rules; one component's eligibility does not prove the other's."
      : wantsBattery
        ? "Battery STC rules and approved-product requirements must be checked as a battery pathway, not reused from PV rules."
        : "PV STC rules, added-capacity treatment and approved-product requirements must be checked as a PV pathway, not reused for a battery.";
    const citations = uniqueById(
      [...baseCitations, ...catalogueProgramCitations(statePrograms)],
      4,
    );
    return structured("rebates_certificates", {
      directAnswer:
        `The collected inputs are sufficient to run the governed certificate calculation, but not to invent a dollar rebate. The calculator will map the postcode to the STC zone, which is not a climate zone, apply the installation date and system facts, and return a certificate quantity where the governed pathway supports it. ${technologyBoundary} An installer or agent's dollar discount is a separate commercial quote outcome. ${stateContext}`,
      status: "answered",
      citations,
      confidence: "medium",
      assumptions: [
        "The user-provided products, installer or agent status and existing-system facts still require official verification.",
        "No certificate has been created, assigned, registered or priced by this answer.",
      ],
      practicalSteps: [
        "Run the collected inputs through the source-verified calculator.",
        "Confirm current product approvals and installer or agent eligibility against the installation date.",
        "Compare the calculated certificate quantity with the separately stated quote discount and state programme outcome.",
      ],
      toolActions: [
        { id: "open-calculator", label: "Calculate the certificate quantity", href: "/calculator" },
        { id: "open-rebates", label: "Check separate rebates and loans", href: "/rebates" },
      ],
      suggestedQuestions: [
        "Which exact source and date support the calculation?",
        "Which quote line is the agent or installer discount?",
      ],
    });
  }

  if (
    /\b(?:condensation|wet|damp|moisture|mould|mold)\b/i.test(query)
    && /\b(?:seal(?:ed|ing)?|weatherstripp(?:ed|ing)?|draught|draft|airtight|air leak|window|glass|wall|ceiling|wardrobe|bathroom|shower|bedroom|surface)\b/i.test(query)
    && !/\b(?:no|without)\s+(?:mould|mold|moisture|damp|condensation)\b/i.test(query)
    && !/\b(?:rent|rental|renter|tenant)\b/i.test(query)
    && !/\bsecondary glazing\b/i.test(query)
  ) {
    const followsSealing = /\b(?:seal(?:ed|ing)?|weatherstripp(?:ed|ing)?|draught|draft|airtight|air leak)\b/i.test(query);
    return structured("draughts_ventilation", {
      directAnswer:
        `Condensation and mould form when indoor moisture reaches a surface below its dew point, or when a leak keeps material wet. Showers, cooking, drying clothes and occupants add moisture; cold glass, walls or ceilings and restricted air behind furniture can make it worse. ${followsSealing ? "Recent sealing can reduce uncontrolled drying, but reopening random gaps is not the safe fix. " : ""}Check exhaust to outdoors, safe heating, insulation continuity, leaks and cold bridges together. Persistent mould or concealed damp needs building-specific assessment.`,
      status: "answered",
      citations: officialCitationsById([
        "yourhome-condensation-moisture",
        "yourhome-ventilation-airtightness",
        "ncc-condensation-handbook",
      ]),
      confidence: "medium",
      assumptions: [
        "The moisture source, affected surface, exhaust performance, wall or window construction and heater type have not been inspected.",
        "No claim is made that draught sealing alone caused the mould; leaks, drying, occupancy and pre-existing cold bridges may also matter.",
      ],
      practicalSteps: [
        "Dry wet surfaces, run effective kitchen and bathroom exhaust to outdoors during moisture production, and keep furniture clear of cold external walls while recording when and where moisture returns.",
        "Do not block required vents, flues or combustion air; avoid disturbing extensive mould or concealed damp and use an appropriate moisture or building practitioner when it persists.",
        "Have the sealing scope checked with surface temperatures, insulation gaps, thermal bridges and deliberate ventilation before adding more permanent seals.",
      ],
      toolActions: [{ id: "open-insulation-guide", label: "Open the moisture and draught guide", href: "/guides/insulation-draught-proofing" }],
      suggestedQuestions: ["Where are the wet surfaces and mould, what exhaust fans are used, and is any gas, wood or other combustion heater operating?"],
    });
  }

  if (/\b(?:upload|attach|check|review|analyse|analyze)\b/i.test(query)
    && /\b(?:solar )?quote\b/i.test(query)
    && /\bPDF\b/i.test(query)) {
    return structured("solar", {
      directAnswer:
        "Yes. Use “Check a quote or interval file locally” in this guide and choose the PDF. The browser reads a bounded, text-based PDF locally; the file bytes and extracted text are not posted to the assistant. The check stays brand-neutral and looks for scope, capacity, ratings, warranties, exclusions, rebate claims and missing evidence. Encrypted, scanned or image-only PDFs are rejected rather than guessed, and the result is not a compliance approval or product endorsement.",
      status: "answered",
      citations: officialCitationsById([
        "cer-stc-entitlement-calculation",
        "energy-rating-product-register",
      ]),
      confidence: "high",
      assumptions: ["The PDF has not yet been selected and no quote fact has been verified against the site or current official product lists."],
      practicalSteps: [
        "Open the local file checker in the guide and choose the original text-based PDF; do not paste an NMI, account number or customer identifier into the conversation.",
        "Review the locally extracted scope, evidence gaps and questions against the actual site, exact products and written inclusions or exclusions.",
        "Use the governed calculator separately for any certificate quantity; a quote discount or rebate claim is not proven by the PDF wording.",
      ],
      toolActions: [{ id: "open-calculator", label: "Check any certificate claim", href: "/calculator" }],
      suggestedQuestions: ["After the local check, which missing scope, warranty, rating or rebate claim do you want explained first?"],
    });
  }

  if (/\b(?:NEM12|interval (?:data|file)|meter data file)\b/i.test(query)
    && /\b(?:tariff|plan|cheapest|compare|rate)\b/i.test(query)) {
    return structured("bills_tariffs", {
      directAnswer:
        "NEM12 data can show when grid import and export occurred, but it cannot name the cheapest tariff until its interval length, channel suffixes, units, quality flags, time basis and coverage are validated and the same load is priced against current plans. Use the guide's local CSV checker first; it does not upload the file and does not need the NMI. Then compare supply, usage windows, demand charges, controlled load and export credits using the current government comparator for the property's location. A headline free period or low usage rate is not the whole bill.",
      status: "needs_context",
      citations: officialCitationsById([
        "aemo-mdff-nem12-nem13-v2-7",
        "energy-made-easy-current-plan-comparison",
        "energy-made-easy",
      ]),
      confidence: "medium",
      assumptions: ["No interval file, current tariff, distributor area, solar export or demand-charge terms have been analysed."],
      practicalSteps: [
        "Use the local CSV checker to validate coverage and derive import, export and time-of-day load shape; redact the NMI and account fields.",
        "Collect the current plan's complete rates and current alternative offers for the same postcode or distribution area.",
        "Price every plan against the same validated intervals and report missing data, solar export and demand-charge assumptions explicitly.",
      ],
      toolActions: [{ id: "compare-electricity", label: "Compare current plans after local analysis", href: "/compare" }],
      suggestedQuestions: ["What postcode or distribution area applies, and does the meter data include solar export, a battery or controlled load?"],
    });
  }

  if (
    /\b(?:which|what)\b.*\b(?:appliance|equipment|load)\b.*\b(?:using|uses|drawing|consuming)\b.*\b(?:power|electricity|energy)\b/i.test(query)
    || /\b(?:what is|what's)\b.*\b(?:using|drawing)\b.*\b(?:all|most of)\b.*\b(?:power|electricity|energy)\b/i.test(query)
  ) {
    return structured("bills_tariffs", {
      directAnswer:
        "A bill total cannot identify one appliance. First find the time pattern, then match it to equipment that can run in that window: hot water, space heating or cooling, pool pumps, EV charging, refrigeration and standby loads leave different interval shapes. Use validated interval data, appliance schedules and safe one-at-a-time tests; do not open a switchboard, disconnect hard-wired equipment or switch off medical, safety or essential loads. A suitably rated plug-in meter can help with accessible plug loads, while fixed circuits need a licensed electrician or an appropriate energy monitor.",
      status: "needs_context",
      citations: officialCitationsById([
        "aemo-mdff-nem12-nem13-v2-7",
        "energy-gov-energy-rating",
        "energy-made-easy-current-plan-comparison",
      ]),
      confidence: "medium",
      assumptions: ["No bill, interval file, controlled-load channel, appliance schedule or circuit measurement has been reviewed."],
      practicalSteps: [
        "Check billing days, actual versus estimated meter reads and total kWh, then use interval data to locate the repeatable overnight, daytime or peak-period load.",
        "Write down when major equipment actually runs and compare that log with the interval spikes or steady baseload.",
        "Test only safe user-operated plug loads one at a time; use a licensed electrician for hard-wired circuit measurement or unexplained high baseload.",
      ],
      toolActions: [{ id: "compare-electricity", label: "Open the usage and tariff tools", href: "/compare" }],
      suggestedQuestions: ["Do you have a recent bill or NEM12 interval file, and is the unexplained load steady, overnight, or in short peaks?"],
    });
  }

  if (/\b(?:gas|natural gas|LPG)\b/i.test(query)
    && /\b(?:reverse[ -]cycle|RCAC|heat pump|air conditioner|air conditioning)\b/i.test(query)
    && /\b(?:carbon|emissions?|greenhouse|climate impact)\b/i.test(query)) {
    return structured("rcac", {
      directAnswer:
        "For operational emissions, compare the energy needed to deliver the same room heat, not just gas megajoules with electricity kilowatt-hours. A gas heater releases combustion emissions at the home. Reverse-cycle air conditioning moves heat like a refrigerator in reverse, so one unit of electricity can deliver several units of heat, but its result still depends on seasonal efficiency at local outdoor temperatures and the emissions of electricity at the time it runs, including any matched rooftop solar. That usually makes RCAC a strong option to assess, but this answer cannot declare a winner without the heater, climate and usage facts; embodied impacts and refrigerant leakage are separate life-cycle questions.",
      status: "needs_context",
      citations: officialCitationsById([
        "energy-rating-heating-cooling",
        "energy-gov-electrification-sequence",
        "energy-rating-zoned-label",
      ]),
      confidence: "medium",
      assumptions: ["No gas-heater efficiency, RCAC seasonal performance, local design temperature, usage profile, electricity emissions basis or solar timing has been supplied."],
      practicalSteps: [
        "Estimate the heat actually required by the occupied rooms and the current gas heater's seasonal fuel use and losses.",
        "Compare an appropriately sized RCAC's seasonal electricity use and retained capacity for the local climate, not a headline COP alone.",
        "State the electricity emissions, tariff and solar-timing assumptions separately from upfront cost, comfort and whole-life material impacts.",
      ],
      toolActions: [{ id: "open-heating-guide", label: "Open the heating comparison guide", href: "/guides/heating" }],
      suggestedQuestions: ["What postcode, gas-heater type and annual gas use apply, and when would the RCAC run relative to rooftop solar?"],
    });
  }

  const renterWeekendBudget = numericCapture(query, /\$\s*(\d+(?:\.\d+)?)/)
    ?? numericCapture(query, /\b(\d+(?:\.\d+)?)\s*dollars?\b/i);
  if (/\b(?:rent|rental|renter|tenant)\b/i.test(query)
    && renterWeekendBudget !== null
    && renterWeekendBudget <= 500
    && /\b(?:weekend|budget|safely|first|cold|icy|hot|heat|bill|moisture)\b/i.test(query)) {
    return structured("renters_strata", {
      directAnswer:
        `With a $${renterWeekendBudget.toLocaleString("en-AU")} renter budget, diagnose the worst problem before buying. Use safe reversible measures matched to evidence: a door snake or removable seal on a confirmed gap, a well-fitted curtain, or warming the occupied person or zone safely. Do not cover vents or heater clearances; fixed work needs permission, and leaks, unsafe heating or persistent mould need the owner or agent.`,
      status: "needs_context",
      citations: officialCitationsById([
        "energy-gov-insulation-draught-proofing",
        "yourhome-ventilation-airtightness",
        "yourhome-passive-cooling",
      ]),
      confidence: "medium",
      assumptions: ["The state, main comfort or bill problem, existing heater, moisture signs and lease permissions are not known."],
      practicalSteps: [
        "Spend nothing first: locate the exact draught, sun path or equipment schedule and photograph any damp, mould, leak or fixed-heating fault.",
        "Choose one reversible measure matched to that evidence; keep vents, exhaust paths, electrical loads, flues and heater clearances unobstructed.",
        "Keep receipts and seek written owner or agent permission before adhesive, drilled, wired or other fixed work.",
      ],
      toolActions: [{ id: "open-home-plan", label: "Build a renter-first action plan", href: "/plan" }],
      suggestedQuestions: ["Is the main problem cold, summer heat, a high bill or moisture?"],
    });
  }

  if (/\b(?:roof|roofing|ceiling)\b/i.test(query)
    && /\b(?:foil|reflective|sarking)\b/i.test(query)
    && /\b(?:summer|heat|hot|cool|stop|work|effective)\b/i.test(query)
    && !/\b(?:fan|wiring|wires?|cables?|electrical|staple|install|crawl|enter)\b/i.test(query)) {
    return structured("comfort_fabric", {
      directAnswer:
        "Reflective roof foil reduces radiant heat only when it faces a suitable air space and is part of a correctly detailed roof assembly. It does not stop heat conducted through roof materials, framing, gaps or poorly covered ceiling areas, and dust, contact with other layers, roof colour, ventilation and orientation can change its effect. Check continuous bulk insulation and daytime solar gain as well as the foil; do not treat foil as a substitute for insulation or a complete summer-comfort design.",
      status: "needs_context",
      citations: officialCitationsById(["yourhome-insulation", "yourhome-passive-cooling", "yourhome-construction-systems"]),
      confidence: "medium",
      assumptions: ["The foil orientation, air gap, dust, roof colour, bulk insulation, ceiling coverage and electrical condition have not been inspected."],
      practicalSteps: [
        "Check the roof colour, shade, foil air space and ceiling-insulation coverage as one assembly.",
        "Measure when the ceiling and room peak rather than judging the foil from one hot day.",
        "Use a building-specific safe roof and moisture design for any permanent change.",
      ],
      toolActions: [{ id: "open-home-plan", label: "Build a roof heat plan", href: "/plan" }],
      suggestedQuestions: ["What roof colour, foil air gap, bulk-insulation coverage and time-of-day temperature pattern apply?"],
    });
  }

  if (/\b(?:roof|roofing|ceiling)\b/i.test(query)
    && /\b(?:foil|reflective|sarking|light[- ]colou?red|cool roof)\b/i.test(query)
    && /\b(?:fan|ceiling fan|portable fan|cool|cooling|heat|hot)\b/i.test(query)) {
    return structured("comfort_fabric", {
      directAnswer:
        "Roof and fan measures do different jobs. A climate-appropriate roof, shading and continuous insulation can reduce heat entering the home. Reflective foil works only as part of a correctly designed assembly, including its required air space, moisture path and electrical safety; it is not a universal substitute for bulk insulation. A fan mainly cools people by moving air and does not lower room air temperature. First limit heat gain, then use fans and cooler outdoor air when conditions make them useful.",
      status: "needs_context",
      citations: officialCitationsById(["yourhome-passive-cooling", "yourhome-insulation", "yourhome-construction-systems"]),
      confidence: "medium",
      assumptions: ["The climate, roof colour and assembly, insulation, sarking, wiring, humidity and ventilation path have not been inspected."],
      practicalSteps: [
        "Map when heat enters through sun-exposed glass, roof, walls and air leakage before selecting one product.",
        "Have any foil, sarking or insulation specified as a complete safe roof assembly rather than a loose layer.",
        "Use fans for occupied-person cooling and ventilate only when outdoor air is genuinely more useful.",
      ],
      toolActions: [{ id: "open-home-plan", label: "Build a passive-cooling plan", href: "/plan" }],
      suggestedQuestions: ["What postcode, roof build-up, existing insulation and time-of-day heat pattern apply?"],
    });
  }

  if (/\b(?:ceiling|portable|pedestal|desk)\s+fan\b/i.test(query)
    && /\b(?:cool|colder|temperature|empty|nobody|no one|unoccupied|room)\b/i.test(query)) {
    return structured("comfort_fabric", {
      directAnswer:
        "A fan mainly cools an occupied person by increasing air movement and evaporation; it does not refrigerate the room air. In an empty room it normally adds a small amount of motor heat, so turn it off unless it is deliberately supporting a verified ventilation or equipment need. Use it when people are present, and reduce heat gain or bring in cooler outdoor air separately when conditions are suitable.",
      status: "answered",
      citations: officialCitationsById(["yourhome-passive-cooling"]),
      confidence: "high",
      assumptions: ["This refers to a normal recirculating household fan, not a designed exhaust or supply-air system."],
      practicalSteps: [
        "Use the fan to move air across occupied people.",
        "Turn it off in an empty room unless it serves a defined ventilation or equipment purpose.",
        "Control sun and fabric heat gain, then ventilate only when outdoor air improves indoor conditions.",
      ],
      toolActions: [],
      suggestedQuestions: ["Is the main problem personal comfort, stored building heat or bringing cooler outdoor air into the room?"],
    });
  }

  if (/\b(?:passive design|passive cooling|passive heating|design for climate|orientation|cross ventilation|night ventilation)\b/i.test(query)
    && /\b(?:tropical|humid|hot dry|temperate|alpine|cold|warm|climate|Darwin|Cairns|Brisbane|Sydney|Melbourne|Adelaide|Perth|Hobart|Canberra|Alice Springs)\b/i.test(query)) {
    return structured("comfort_fabric", {
      directAnswer:
        "Passive design must match the actual climate and site. First control unwanted sun and heat flow with orientation, external shade, suitable glazing and continuous insulation. Then use outdoor air only when its temperature and humidity improve indoor conditions: cross-flow and fans can help in warm humid periods, while secure night purging and thermal mass can help where nights cool reliably. Cold climates place more weight on useful winter sun, airtightness and heat retention. Local wind, smoke, noise, elevation and urban heat can change the zone-level strategy.",
      status: "needs_context",
      citations: officialCitationsById(["yourhome-design-for-climate", "yourhome-passive-cooling", "yourhome-passive-heating"]),
      confidence: "medium",
      assumptions: ["The exact postcode, orientation, microclimate, humidity, construction and occupancy pattern have not been supplied."],
      practicalSteps: [
        "Use nearby temperature, humidity, wind and solar data plus the site's orientation and shade.",
        "Separate heat-gain control, heat retention, air movement and outdoor-air ventilation rather than applying one climate slogan.",
        "Model permanent envelope or glazing changes for the actual site and moisture path.",
      ],
      toolActions: [{ id: "open-home-plan", label: "Build a climate-specific home plan", href: "/plan" }],
      suggestedQuestions: ["What postcode, orientation, construction and main summer or winter comfort problem apply?"],
    });
  }

  const climatePostcode = queryAustralianPostcode(query) || "";
  if (/\b(?:climate zone|zone)\b/i.test(query) && climatePostcode) {
    return structured("nathers", {
      directAnswer:
        `Postcode ${climatePostcode} does not have one universal “climate zone”. NatHERS, the NCC and solar STC calculations use different zone systems, and postcode or topography exceptions can apply. An STC zone is not a NatHERS or NCC climate zone, so I will not guess a number until the purpose and exact official map are selected.`,
      status: "needs_context",
      citations: officialCitationsById([
        "nathers-climate-files",
        "abcb-housing-energy-efficiency-handbook",
        "cer-stc-entitlement-calculation",
      ]),
      confidence: "high",
      assumptions: ["Only the postcode is known; exact site topography, assessment purpose and applicable instrument are not."],
      practicalSteps: [
        "For a NatHERS rating, use the current postcode climate file and check any listed alternate-zone or topography rule with the assessor.",
        "For NCC design or compliance, use the adopted NCC climate map and jurisdiction pathway for the project.",
        "For a solar certificate estimate, let the governed calculator map the installation postcode to the separate STC zone.",
      ],
      toolActions: [
        { id: "open-assessments", label: "Open assessment pathways", href: "/assessments" },
        { id: "open-calculator", label: "Open the STC calculator", href: "/calculator" },
      ],
      suggestedQuestions: ["Do you need the zone for NatHERS rating, NCC design or compliance, solar STCs, or general comfort planning?"],
    });
  }

  if (/\b(?:NatHERS|NCC)\b/i.test(query)
    && /\b(?:climate|zone|location|postcode|map|applies|which)\b/i.test(query)) {
    const asksNathers = /\bNatHERS\b/i.test(query);
    const asksNcc = /\bNCC\b/i.test(query);
    return structured("nathers", {
      directAnswer:
        `${climatePostcode ? `Postcode ${climatePostcode} is only a lookup input, not a safe zone answer by itself. ` : "I need the exact property postcode before using an official climate map. "}${asksNathers ? "NatHERS uses its own 69 climate files and can have alternate postcode zones for elevation or topography; it is not a solar STC zone. " : ""}${asksNcc ? "The NCC uses a separate building-code climate map and the adopted edition and jurisdictional variations also matter. " : ""}Neither can be replaced with the solar STC zone. I will not guess the zone number or treat one system's result as another's; use the current official map for the stated purpose and property location.` ,
      status: "needs_context",
      citations: officialCitationsById([
        ...(asksNathers ? ["nathers-climate-files"] : []),
        ...(asksNcc ? ["ncc-current-edition-jurisdiction", "abcb-housing-energy-efficiency-handbook"] : []),
      ]),
      confidence: "high",
      assumptions: ["No current official map result, alternate-zone check, project class, adopted NCC edition or jurisdictional variation has been verified."],
      practicalSteps: [
        "State whether the lookup is for NatHERS modelling or NCC design and compliance.",
        "Use the exact postcode and address context in that system's current official map, including any alternate-zone note.",
        "Keep the resulting NatHERS or NCC zone separate from any STC calculation.",
      ],
      toolActions: [],
      suggestedQuestions: [climatePostcode ? "Is this lookup for NatHERS modelling or NCC design and compliance?" : "What exact postcode and NatHERS or NCC purpose apply?"],
    });
  }

  if (/\bNatHERS\b/i.test(query) && /\b(?:tell|mean|rate|rating|stars?|score|assess|issue|certificate|questionnaire|official)\b/i.test(query)) {
    return structured("nathers", {
      directAnswer:
        "NatHERS compares a home's modelled thermal performance under standard climate and occupancy assumptions; an existing-home certificate can also cover fixed whole-home factors. It does not predict one household's bill or behaviour. This guide cannot issue or replace an official NatHERS rating: a current accredited pathway needs a whole-dwelling inspection, evidence, approved software and recorded unknowns.",
      status: "answered",
      citations: officialCitationsById(["nathers-existing-homes", "nathers-certificate", "nathers-guidance-note"]),
      confidence: "high",
      assumptions: ["No accredited inspection, dwelling evidence or software model has been completed."],
      practicalSteps: [
        "Decide whether you need an official certificate or only upgrade planning.",
        "Collect plans and evidence for construction, insulation, windows, shading, airtightness and fixed services.",
        "Use an accredited assessor for the current whole-dwelling pathway.",
      ],
      toolActions: [{ id: "open-assessments", label: "Explore assessment pathways", href: "/assessments" }],
      suggestedQuestions: ["Do you need an official certificate or practical upgrade priorities?"],
    });
  }

  const statedRoomTemperature = numericCapture(query, /\b(\d+(?:\.\d+)?)\s*(?:°\s*)?(?:C|degrees?(?:\s+Celsius)?)\b/i);
  const statedRoomTemperatureLabel = statedRoomTemperature === null
    ? "a comfortable air temperature"
    : `${statedRoomTemperature}°C`;
  if ((/\bthermal envelope\b/i.test(query)
    || /\b(?:wall|floor|ceiling|window)\b[^\n]{0,70}\b(?:cold|icy|freezing|hot)\b/i.test(query)
    || /\b(?:cold|icy|freezing|hot)\b[^\n]{0,70}\b(?:wall|floor|ceiling|window)\b/i.test(query)
    || /\b(?:sit|stand|feel)\b[^\n]{0,45}\b(?:beside|near|next to)\b[^\n]{0,25}\b(?:wall|window)\b/i.test(query))
    && !/\b(?:west|western|west-facing|west facing)\b/i.test(query)
    && !/\b(?:rent|renter|tenant|rental)\b/i.test(query)) {
    return structured("comfort_fabric", {
      directAnswer:
        `The thermal envelope is the connected boundary between conditioned rooms and outdoors or unconditioned spaces. A cold wall can pull radiant heat from your body even when the air thermometer reads ${statedRoomTemperatureLabel}, so the room feels cold. Missing insulation, conductive brick or framing, thermal bridges, air leakage, shade and moisture can all lower the inside surface temperature.`,
      status: "needs_context",
      citations: officialCitationsById(["yourhome-insulation", "yourhome-construction-systems", "yourhome-condensation-moisture"]),
      confidence: "medium",
      assumptions: ["Surface temperature, insulation, air leakage and moisture have not been measured."],
      practicalSteps: [
        "Map which surfaces feel cold and when, and check safely for damp or visible gaps.",
        "Use reversible curtains or furniture spacing without blocking heaters or vents.",
        "For a durable fix, assess insulation continuity, thermal bridges, leakage and moisture as one assembly.",
      ],
      toolActions: [{ id: "open-home-plan", label: "Build a fabric improvement plan", href: "/plan" }],
      suggestedQuestions: ["Which surface feels cold, and is there damp, a draught or missing insulation there?"],
    });
  }

  if (/\b(?:indoor air quality|IAQ|air quality|fresh air|fumes?|humidity|pollutants?)\b/i.test(query)
    && /\b(?:airtight|airtightness|tighter|seal|weatherstrip|fresh air|electrif|gas|emissions?|ventilat)\b/i.test(query)) {
    return structured("draughts_ventilation", {
      directAnswer:
        "A tighter or electrified home can have healthier air only when pollutant and moisture sources are controlled and kitchens and bathrooms exhaust outdoors with suitable fresh air. Filtration helps some particles but does not remove humidity or replace ventilation. Replacing indoor combustion can reduce combustion pollutants, while operational emissions depend separately on equipment efficiency and electricity supply.",
      status: "needs_context",
      citations: officialCitationsById([
        "yourhome-indoor-air-quality",
        "yourhome-ventilation-airtightness",
        "energy-gov-electrification-sequence",
      ]),
      confidence: "medium",
      assumptions: ["The pollutant source, moisture pattern, exhaust flow, combustion equipment and fresh-air path are not known."],
      practicalSteps: [
        "Control the source first: moisture, smoke, fumes, damp materials or an unsafe combustion appliance.",
        "Check that kitchen and bathroom exhaust reaches outdoors and required vents remain open.",
        "Use building-specific ventilation advice if damp, mould, fumes or stuffiness persists after sealing.",
      ],
      toolActions: [{ id: "open-insulation-guide", label: "Open the ventilation guide", href: "/guides/insulation-draught-proofing" }],
      suggestedQuestions: ["Is the main problem moisture, cooking fumes, combustion, particles or stale air?"],
    });
  }

  if (/\b(?:behaviours?|habits?|no-cost|without sacrificing comfort)\b/i.test(query)
    && /\b(?:appliances?|cooking|laundry|washing|dryer|hot water|dishwasher|standby)\b/i.test(query)) {
    return structured("bills_tariffs", {
      directAnswer:
        "Start with the largest flexible loads, not dozens of tiny sacrifices. Use full dishwasher and washing-machine loads, cold or cooler cycles where suitable, air-dry when practical, avoid unnecessary dryer time, match pots and lids to the cooking task, and shorten avoidable hot-water use without reducing hygiene or safe temperatures. Shift flexible loads only when the tariff or solar timing actually rewards it.",
      status: "needs_context",
      citations: officialCitationsById(["energy-gov-energy-rating", "energy-gov-reduce-energy-bills", "energy-gov-appliances-cooking"]),
      confidence: "medium",
      assumptions: ["The tariff, appliance types, household needs and largest measured loads are not known."],
      practicalSteps: [
        "Identify which of hot water, cooking, laundry or drying uses most energy in this home.",
        "Change one repeatable setting or schedule at a time and preserve hygiene, medical and comfort needs.",
        "Check the next bill or interval pattern before adding more changes.",
      ],
      toolActions: [{ id: "compare-electricity", label: "Check usage against the tariff", href: "/compare" }],
      suggestedQuestions: ["Which load is largest in your bill or interval data: hot water, cooking, washing or drying?"],
    });
  }

  if (/\b(?:embodied carbon|embodied energy)\b/i.test(query)) {
    return structured("comfort_fabric", {
      directAnswer:
        "Embodied carbon is the greenhouse impact associated with making, transporting, installing, maintaining and eventually replacing materials; operational carbon comes from energy used while the home is occupied. It matters because a large replacement can create an upfront impact before it saves any operating energy. The practical response is not 'never retrofit': retain serviceable elements where they can meet the job, avoid excess material, choose durable repairable assemblies, and compare the upfront impact with credible long-term comfort and energy benefits over the expected life.",
      status: "answered",
      citations: officialCitationsById(["yourhome-embodied-energy", "yourhome-construction-systems"]),
      confidence: "high",
      assumptions: ["No product-specific environmental declaration, quantity, transport route, service life or operating-energy model has been supplied."],
      practicalSteps: [
        "Define the service the project must deliver, then compare repair, reuse and replacement scopes on the same functional basis.",
        "Ask for material quantities, durability, maintenance, replaceable parts and product-specific life-cycle evidence where available.",
        "Keep embodied and operational assumptions separate and show the time horizon instead of collapsing them into one unsupported score.",
      ],
      toolActions: [{ id: "open-home-plan", label: "Build a staged retrofit plan", href: "/plan" }],
      suggestedQuestions: ["Is this a renovation, new build or one product replacement, and which material or assembly are you deciding about?"],
    });
  }

  if (/\bthermal mass\b/i.test(query)) {
    return structured("comfort_fabric", {
      directAnswer:
        "Thermal mass releases heat later because dense materials such as concrete and brick take time to warm through. They absorb energy while nearby air and surfaces are warmer, then release it gradually after those surroundings cool. That delay can smooth temperatures when winter sun, summer shade and cool nights are managed well, or prolong overheating when the mass cannot cool down.",
      status: "needs_context",
      citations: officialCitationsById(["yourhome-thermal-mass", "yourhome-passive-design-system"]),
      confidence: "high",
      assumptions: ["The climate, mass location, insulation boundary, solar access, night temperatures and occupancy schedule are not known."],
      practicalSteps: [],
      toolActions: [],
      suggestedQuestions: ["What is the property postcode?"],
    });
  }

  if (/\b(?:Passive House|Passivhaus)\b/i.test(query)) {
    return structured("draughts_ventilation", {
      directAnswer:
        "Passive House is a measured building-performance standard, not just a home with good orientation. It combines continuous insulation, very low tested air leakage, high-performance windows, reduced thermal bridges and designed fresh-air ventilation so comfort needs are small. Airtight does not mean unventilated. It can be applied in Australia when the envelope, shading, moisture strategy, cooling and ventilation are modelled for the actual climate; using some ideas does not make a project certified, and a deep retrofit can be complex where the existing structure, moisture paths or budget prevent continuity.",
      status: "answered",
      citations: officialCitationsById([
        "yourhome-passive-house",
        "yourhome-passive-design-system",
        "ncc-condensation-handbook",
      ]),
      confidence: "high",
      assumptions: ["The project stage, climate, certification goal, existing construction and ventilation strategy are not known."],
      practicalSteps: [
        "Decide whether the goal is formal certification, a modelled deep retrofit or selected comfort principles.",
        "Engage project-specific energy and moisture modelling early enough to coordinate insulation, airtightness, windows, shading, thermal bridges and ventilation.",
        "Require blower-door and commissioning evidence for claimed performance; separately confirm the applicable NCC and local approval pathway.",
      ],
      toolActions: [{ id: "open-assessments", label: "Explore assessment pathways", href: "/assessments" }],
      suggestedQuestions: ["Is this a new build or retrofit, where is it, and do you want certification or simply the best practical comfort improvements?"],
    });
  }

  if (/\bSolar Sharer Offer\b/i.test(query)) {
    return structured("bills_tariffs", {
      directAnswer:
        "The Solar Sharer Offer is a current optional regulated retail offer, not a solar rebate. From 1 July 2026 it provides a defined three-hour middle-of-day free-use window through a participating required retailer for eligible smart-meter households in NSW, South Australia and south-east Queensland Default Market Offer areas. Renting or lacking rooftop solar does not automatically exclude a household. Supply charges, use outside the window, any usage cap, export terms and the retailer's complete rates still decide whether the whole plan is cheaper for the measured load.",
      status: "needs_context",
      citations: officialCitationsById(["energy-gov-solar-sharer-offer", "energy-made-easy-current-plan-comparison"]),
      confidence: "medium",
      assumptions: ["The postcode, Default Market Offer area, smart-meter status, retailer availability and measured load shape have not been checked."],
      practicalSteps: [
        "Confirm the postcode or distribution area, smart-meter eligibility and the current retailer offer terms.",
        "Use local interval analysis to measure how much flexible load can genuinely move into the free-use window.",
        "Compare the offer's complete annual cost with current alternatives using the same load, solar export and controlled-load assumptions.",
      ],
      toolActions: [{ id: "compare-electricity", label: "Compare the complete tariff", href: "/compare" }],
      suggestedQuestions: ["What postcode, smart-meter status and movable middle-of-day load apply?"],
    });
  }

  if (/\bHome Energy Saver\b/i.test(query)) {
    return structured("rebates_certificates", {
      directAnswer:
        "NSW Home Energy Saver zero-interest loan applications are open for eligible homeowners and landlords as reviewed on 20 August 2026. The separate household discounts are still coming soon, so they must not be shown as open. Applicant, income, property, product, supplier and any landlord or strata permission rules still need checking; this support also remains separate from ESS, PDRS and federal STCs.",
      status: "needs_context",
      citations: officialCitationsById(["nsw-home-energy-saver-current"]),
      confidence: "high",
      assumptions: ["The applicant, income, property, product, supplier, contribution and permission conditions have not been checked."],
      practicalSteps: [
        "Treat the loan and future discount as separate offers.",
        "Check the current applicant and property conditions before purchase or commitment.",
        "Calculate any ESS, PDRS or STC outcome separately.",
      ],
      toolActions: [{ id: "open-rebates", label: "Check Home Energy Saver eligibility", href: "/rebates" }],
      suggestedQuestions: ["Are you a NSW homeowner or landlord?"],
    });
  }

  if (/\b(?:SEC|State Electricity Commission)\b/i.test(query)
    && /\b(?:Victoria|Victorian|household|electrif|rebate|support|help|offer)\b/i.test(query)) {
    return structured("rebates_certificates", {
      directAnswer:
        "SEC Victoria currently provides household electrification guidance, savings modelling, product information and access to SEC-endorsed installers across heating and cooling, hot water, cooking, solar, batteries and EV charging. That service is not itself a universal cash rebate, and an endorsement does not prove the best supplier, exact product eligibility, complete scope or household saving.",
      status: "needs_context",
      citations: officialCitationsById(["sec-victoria-household-electrification"]),
      confidence: "high",
      assumptions: ["No household load, tariff, exact product, installer licence, written quote or separate programme eligibility has been checked."],
      practicalSteps: [
        "Use SEC guidance as one input, then verify the exact product register, installer licence, written scope, warranty and alternatives.",
        "Recalculate any saving from the household's actual equipment, energy use, tariff and proposed work.",
        "Check rebates, certificates and finance separately with Australian Energy Assessments before treating any support as available.",
      ],
      toolActions: [{ id: "open-rebates", label: "Check separate support", href: "/rebates" }],
      suggestedQuestions: ["Which household upgrade or cost are you trying to decide?"],
    });
  }

  const comparedQuoteTopic = quoteComparisonTopic(userConversation);
  if (comparedQuoteTopic) {
    const comparison = comparedQuoteTopic === "heat_pump_hot_water"
      ? {
        label: "heat-pump hot-water",
        criteria: "household draw profile, usable tank volume, recovery at local winter conditions, noise, airflow, condensate, electrical and plumbing scope, controls or tariff, exact CER eligibility, warranty and local service",
        evidence: "occupants and peak hot-water demand, site photos and clearances, exact model data, recovery assumptions, every inclusion and exclusion, commissioning and incentive assignment",
        question: "How many people and peak hot-water uses must each quote serve, and what exact model, tank, recovery and site scope does each include?",
        citations: ["energy-gov-electrification", "energy-rating-product-register", "energy-gov-rebates"],
        href: "/guides/hot-water",
      }
      : comparedQuoteTopic === "rcac"
        ? {
          label: "heating and cooling",
          criteria: "room-by-room heat load, local design temperatures, retained capacity, seasonal energy, zoning, noise, outdoor airflow, condensate, circuit and refrigerant work, controls, commissioning, warranty and service",
          evidence: "the rooms and comfort target, load calculation, exact-model official data and a written placement, drainage, electrical and commissioning design",
          question: "Which rooms and design conditions must be served, and does each quote show the load, retained capacity, placement, drainage, electrical work and commissioning?",
          citations: ["energy-rating-heating-cooling", "energy-rating-zoned-label", "energy-rating-product-register"],
          href: "/guides/heating",
        }
        : comparedQuoteTopic === "solar"
          ? {
            label: "solar",
            criteria: "future load timing, usable roof and shading, export limits, array layout, exact panel and inverter models, generation assumptions, warranties, monitoring, switchboard work, commissioning, exclusions and separately stated STC quantity or discount",
            evidence: "interval use, roof and shade design, network/export assumption, exact official products, line-by-line scope and the basis of every yield, saving and certificate claim",
            question: "Do the proposals use the same load, roof, shade and export assumptions, and what exact scope or savings claim differs first?",
            citations: ["cer-stc-entitlement-calculation", "energy-rating-product-register", "energy-gov-rebates"],
            href: "/guides/solar",
          }
          : comparedQuoteTopic === "battery_vpp"
            ? {
              label: "battery",
              criteria: "the required job, measured solar surplus and load, usable capacity and power, backup circuits and islanding, operating reserve, degradation and throughput warranty, controls, VPP terms, site and fire clearances, switchboard work and total installed cost",
              evidence: "interval data, backup priorities, exact model and official eligibility, single-line design, site plan, warranty limits, commissioning and every VPP or rebate condition",
              question: "Is the battery for bill shifting, backup or both, and do both quotes use the same measured load, usable capacity, backup and warranty assumptions?",
              citations: ["cer-solar-battery-inspection-checklist", "energy-rating-product-register", "energy-gov-rebates"],
              href: "/guides/batteries",
            }
            : comparedQuoteTopic === "glazing_shading"
              ? {
                label: "window and glazing",
                criteria: "the room problem, orientation and shade, whole-window U-value and solar heat-gain coefficient, frame and seals, safety glass, waterproof installation, reveals and trim, access, approvals, warranty and disposal",
                evidence: "window schedule and dimensions, orientation and shade, whole-window performance for each exact configuration, installation details and every make-good exclusion",
                question: "Which rooms, orientations and comfort problem are being solved, and do both quotes state whole-window U-value, solar heat gain, frame and full installation scope?",
                citations: ["energy-gov-windows", "yourhome-shading", "abcb-housing-energy-efficiency-handbook"],
                href: "/guides/insulation-draught-proofing",
              }
              : {
                label: "insulation",
                criteria: "the existing assembly and safe access, measured coverage and gaps, material and system R-value, continuity and thermal bridges, moisture, electrical and fire clearances, downlights and services, ventilation, removal, clean-up and installation evidence",
                evidence: "area and construction schedule, safe existing-condition inspection, required R-value and coverage, clearance and moisture plan, product evidence and completion photos",
                question: "Which ceiling, wall or floor assembly is in scope, what existing coverage was verified, and do both quotes state area, system R-value, gaps, clearances and completion evidence?",
                citations: ["yourhome-insulation", "yourhome-construction-systems", "energy-gov-insulation-draught-proofing"],
                href: "/guides/insulation-draught-proofing",
              };
    return structured(comparedQuoteTopic, {
      directAnswer:
        `Compare the ${comparison.label} proposals against one written job and the same evidence before comparing price. Surge does not rank or endorse a brand, supplier or model. Put ${comparison.criteria} side by side. Registration or programme listing proves only the stated official fact; it does not prove site suitability, complete installation or a savings claim. Any unknown remains a quote question or site-visit requirement, not a default.`,
      status: "needs_context",
      citations: officialCitationsById(comparison.citations),
      confidence: "medium",
      assumptions: ["The proposals, site evidence and exact products have not been locally reviewed."],
      practicalSteps: [
        `Create one comparison sheet from ${comparison.evidence}.`,
        "Mark every difference, missing item, provisional sum, owner-supplied task, approval, rebate claim and exclusion; do not award points for brand or marketing language.",
        "Resolve safety, sizing, site design and eligibility gaps in writing before comparing total installed price, warranty and service.",
      ],
      toolActions: [{ id: "open-category-guide", label: `Open the ${comparison.label} guide`, href: comparison.href }],
      suggestedQuestions: [comparison.question],
    });
  }

  const suppliedVehicleRows = suppliedVehicleComparisonRows(query);
  if (suppliedVehicleRows.length === 2) {
    const [left, right] = suppliedVehicleRows;
    const cyclesMatch = Boolean(left.testCycle && right.testCycle && left.testCycle === right.testCycle);
    if (!cyclesMatch) {
      const cycleState = left.testCycle && right.testCycle
        ? `${left.label} is stated as ${left.testCycle}, while ${right.label} is stated as ${right.testCycle}`
        : "one or both supplied rows do not state a test cycle";
      return structured("ev_charging", {
        directAnswer:
          `I cannot make a like-for-like efficiency or certified-range comparison because ${cycleState}. Wh/km and range figures from different or missing test cycles are not safely comparable. I will not call either vehicle more efficient, longer-range or better from those rows. Supply the current official Green Vehicle Guide figures for both exact model-year variants on the same stated cycle, then compare energy use and certified range as separate facts.`,
        status: "needs_context",
        citations: officialCitationsById(["green-vehicle-guide-compare"]),
        confidence: "high",
        assumptions: ["The supplied vehicle rows are user-provided derived values and have not been independently verified against the current official records."],
        practicalSteps: [
          "Confirm the full model year and variant for each vehicle.",
          "Copy Wh/km, certified range and the named test cycle from the current official row for each exact variant.",
          "Compare only figures with the same test cycle and keep price, charging, space, warranty and other needs separate.",
        ],
        toolActions: [{ id: "open-ev-guide", label: "Open the EV comparison guide", href: "/guides/ev-charging" }],
        suggestedQuestions: ["What same-cycle official Wh/km and certified range are shown for both exact variants?"],
      });
    }
    const lower = left.whPerKm <= right.whPerKm ? left : right;
    const higher = lower === left ? right : left;
    const energyDifference = Math.abs(left.whPerKm - right.whPerKm);
    const percentageDifference = energyDifference === 0 ? 0 : energyDifference / higher.whPerKm * 100;
    const energyComparison = energyDifference === 0
      ? `${left.label} and ${right.label} have the same supplied certified energy use of ${left.whPerKm.toLocaleString("en-AU")} Wh/km on the ${left.testCycle} cycle.`
      : `${lower.label} is more energy efficient on the supplied ${left.testCycle} figures: ${lower.whPerKm.toLocaleString("en-AU")} Wh/km versus ${higher.whPerKm.toLocaleString("en-AU")} Wh/km, a difference of ${energyDifference.toLocaleString("en-AU")} Wh/km or about ${percentageDifference.toLocaleString("en-AU", { maximumFractionDigits: 1 })}% less vehicle energy per kilometre than ${higher.label}.`;
    const rangeComparison = left.rangeKm !== null && right.rangeKm !== null
      ? ` The supplied certified ranges are ${left.rangeKm.toLocaleString("en-AU")} km for ${left.label} and ${right.rangeKm.toLocaleString("en-AU")} km for ${right.label}.`
      : " One or both certified range figures are missing, so range is not compared.";
    const annualKm = numericCapture(query, /\b([\d,]+(?:\.\d+)?)\s*km\s*(?:a year|per year|yearly|annually|annual)\b/i)
      ?? numericCapture(query, /\b(?:annual(?:ly)?|yearly)\s+(?:travel|distance|kilometres?|kilometers?|driving)?\s*(?:is|:|=)?\s*([\d,]+(?:\.\d+)?)\s*km\b/i);
    const annualDifferenceKwh = annualKm === null ? null : energyDifference * annualKm / 1000;
    const annualComparison = annualDifferenceKwh === null || annualKm === null
      ? ""
      : ` At ${annualKm.toLocaleString("en-AU")} km a year, that Wh/km difference equals about ${annualDifferenceKwh.toLocaleString("en-AU", { maximumFractionDigits: 1 })} kWh of vehicle energy a year before charging losses.`;
    return structured("ev_charging", {
      directAnswer:
        `${energyComparison}${rangeComparison}${annualComparison} This compares only the supplied same-cycle energy and certified-range facts. It does not prove real-world range, charging cost, reliability, safety, value or which vehicle a household should choose, and Surge does not endorse either model.`,
      status: "answered",
      citations: officialCitationsById(["green-vehicle-guide-compare"]),
      confidence: "medium",
      assumptions: [
        "The supplied vehicle rows are user-provided derived values and have not been independently verified against the current official records.",
        "Charging losses and real-world effects such as speed, temperature, load, tyres and battery state are outside the certified vehicle-energy arithmetic.",
      ],
      practicalSteps: [
        "Verify both exact model-year variants, Wh/km, ranges and shared test cycle against the current official rows.",
        "Use annual distance to compare vehicle energy, then apply the actual home and public charging mix separately.",
        "Compare price, charging access, space, payload, warranty and required trip range as separate decisions.",
      ],
      toolActions: [{ id: "open-ev-guide", label: "Open the EV comparison guide", href: "/guides/ev-charging" }],
      suggestedQuestions: annualKm === null
        ? ["How many kilometres do you drive per year if you want the certified energy difference converted to annual kWh?"]
        : ["Do you want to add the actual home, solar and public charging prices without treating them as vehicle-quality facts?"],
    });
  }

  const comparedVehicles = exactVehiclePair(query);
  if (comparedVehicles) {
    return structured("ev_charging", {
      directAnswer:
        `Surge will not recommend either brand or model from the name alone. “${comparedVehicles.left}” and “${comparedVehicles.right}” may each cover multiple model years and variants, so first compare the exact variants on the same official Green Vehicle Guide test basis: certified electric range and energy use in Wh/km or kWh/100 km. Those laboratory figures are useful for like-for-like comparison, not a promise of usable real-world range; temperature, speed, load, tyres, battery state and charging losses change actual results. The local guide does not hold current variant rows and will not scrape or reverse-engineer the government service, so use the exact current GVG or windscreen-label values supplied for the two variants.`,
      status: "needs_context",
      citations: officialCitationsById(["green-vehicle-guide-compare", "energy-gov-ev-home-strata-charging"]),
      confidence: "medium",
      assumptions: [
        "No exact year, variant, official consumption or range record has been supplied.",
        "No brand, retailer, affiliate or finance preference has been applied.",
      ],
      practicalSteps: [
        "Record the full model year and variant for both vehicles, not just the make and family name.",
        "Copy the current official GVG or windscreen-label electric range and Wh/km or kWh/100 km for both on the same test basis.",
        "Then compare those facts with your annual distance, charging access, space, payload and required trip range; keep finance and rebates as separate decisions.",
      ],
      toolActions: [{ id: "open-ev-guide", label: "Open the EV comparison guide", href: "/guides/ev-charging" }],
      suggestedQuestions: ["What exact model year and variant is each car, and what certified GVG range and energy-consumption figure is shown for each?"],
    });
  }

  if (
    /\b(?:switch(?:ing)?|change|replace)\b[\s\S]{0,500}\b(?:petrol|diesel|fuel)\b[\s\S]{0,500}\b(?:EV|electric vehicle)\b/i.test(evSavingsConversation)
    || /\b(?:EV|electric vehicle)\b[\s\S]{0,600}\b(?:save|saving|savings|running cost|energy[- ]cost difference|cost difference|per year|annual)\b/i.test(evSavingsConversation)
    || /\b(?:save|saving|savings|running cost|energy[- ]cost difference|cost difference|how much)\b[\s\S]{0,240}\b(?:EV|electric vehicle|electric car)\b/i.test(evSavingsConversation)
    || /\b(?:petrol|diesel|fuel|litres?\s+(?:per|every|\/)\s*100\s*km)\b[\s\S]{0,800}\b(?:EV|electric vehicle|kWh\s+(?:per|every|\/)\s*100\s*km)\b[\s\S]{0,800}\b(?:difference|compare|cost|save|annual|yearly)\b/i.test(evSavingsConversation)
  ) {
    const savings = evAnnualSavingsInputs(evSavingsConversation);
    const citations = officialCitationsById([
      "green-vehicle-guide-compare",
      "energy-gov-ev-home-strata-charging",
      "energy-made-easy-current-plan-comparison",
    ]);
    if (
      savings.annualKm === null
      || savings.fuelLitresPer100Km === null
      || savings.fuelDollarsPerLitre === null
    ) {
      return structured("ev_charging", {
        directAnswer:
          "Annual fuel-to-EV savings must use the same distance and user-supplied prices. Start with the current vehicle side: annual kilometres, fuel type, measured or official L/100 km, and the fuel price assumption. After that I will ask for the exact EV's official kWh/100 km and the home, solar and public-charging mix. Finance, purchase price, depreciation, servicing, rebates and green loans remain separate from this energy-cost comparison.",
        status: "needs_context",
        citations,
        confidence: "low",
        assumptions: ["No verified annual distance, current-vehicle fuel economy or fuel price has been supplied."],
        practicalSteps: [
          "Use a full-year odometer distance where possible rather than one unusually busy week.",
          "Use the current vehicle's measured fuel use or exact official variant figure and state whether it is petrol, diesel or hybrid.",
          "Choose an explicit fuel-price assumption and keep it visible for sensitivity testing.",
        ],
        toolActions: [],
        suggestedQuestions: ["What are the annual kilometres, current fuel type and L/100 km, and the fuel price per litre you want to assume?"],
      });
    }
    if (
      savings.evKwhPer100Km === null
      || (savings.blendedCentsPerKwh === null
        && (savings.homeCentsPerKwh === null
          || savings.publicCentsPerKwh === null
          || savings.homePercent === null))
    ) {
      return structured("ev_charging", {
        directAnswer:
          "The current-vehicle side is now defined. To calculate the EV energy cost without guessing, the remaining facts are the exact variant's current official kWh/100 km, the percentage charged at home versus public chargers, and the effective c/kWh for each. If rooftop solar supplies some home charging, state whether its cost is being treated as the foregone export credit or another explicit value. Real charging losses and subscription or session fees should be shown separately.",
        status: "needs_context",
        citations,
        confidence: "medium",
        assumptions: ["The EV consumption, charging split, electricity prices, charging losses and solar opportunity cost are not complete."],
        practicalSteps: [
          "Copy the exact variant's official GVG or windscreen-label kWh/100 km on a consistent test basis.",
          "Estimate the annual home and public charging split from actual parking access, not an ideal scenario.",
          "Use complete home and public energy prices and list charging losses, subscriptions and session fees separately.",
        ],
        toolActions: [{ id: "compare-electricity", label: "Check the home tariff", href: "/compare" }],
        suggestedQuestions: ["What EV kWh/100 km, home/public charging percentages and c/kWh prices should be used, and is home solar part of that price?"],
      });
    }
    const blendedElectricityCents = savings.blendedCentsPerKwh;
    const usingBlendedPrice = blendedElectricityCents !== null;
    const homeShare = savings.homePercent === null ? 1 : savings.homePercent / 100;
    const weightedElectricityDollarsPerKwh = usingBlendedPrice
      ? blendedElectricityCents / 100
      : (
        homeShare * (savings.homeCentsPerKwh || 0)
        + (1 - homeShare) * (savings.publicCentsPerKwh || 0)
      ) / 100;
    const annualFuelCost = savings.annualKm * savings.fuelLitresPer100Km / 100 * savings.fuelDollarsPerLitre;
    const annualEvEnergy = savings.annualKm * savings.evKwhPer100Km / 100;
    const lossMultiplier = savings.consumptionIncludesChargingLoss
      ? 1
      : 1 + (savings.chargingLossPercent || 0) / 100;
    const annualGridEnergy = annualEvEnergy * lossMultiplier;
    const annualEvEnergyCost = annualGridEnergy * weightedElectricityDollarsPerKwh;
    const annualEnergySaving = annualFuelCost - annualEvEnergyCost;
    const dollars = (value: number) => Math.round(value).toLocaleString("en-AU");
    return structured("ev_charging", {
      directAnswer:
        `Using only the supplied energy inputs: the current vehicle uses about ${dollars(savings.annualKm * savings.fuelLitresPer100Km / 100)} litres a year and costs about $${dollars(annualFuelCost)}; the EV needs about ${dollars(annualEvEnergy)} kWh at the vehicle${lossMultiplier > 1 ? ` and about ${dollars(annualGridEnergy)} kWh from the grid after the supplied ${savings.chargingLossPercent}% loss` : ""}, costing about $${dollars(annualEvEnergyCost)} at the ${usingBlendedPrice ? "supplied blended electricity price" : "weighted home/public price"}. The indicated energy saving is about $${dollars(annualEnergySaving)} per year. That is arithmetic from the stated assumptions, not a guaranteed saving; ${lossMultiplier > 1 || savings.consumptionIncludesChargingLoss ? "the supplied charging-loss basis is included, while public session fees, price changes, solar opportunity cost, servicing, insurance, finance, depreciation and purchase price remain separate" : "charging losses, public session fees, price changes, solar opportunity cost, servicing, insurance, finance, depreciation and purchase price are not included"}.`,
      status: "answered",
      citations,
      confidence: "medium",
      assumptions: [
        `Annual distance ${savings.annualKm.toLocaleString("en-AU")} km; fuel use ${savings.fuelLitresPer100Km} L/100 km; fuel $${savings.fuelDollarsPerLitre}/L.`,
        usingBlendedPrice
          ? `EV use ${savings.evKwhPer100Km} kWh/100 km at the supplied blended ${blendedElectricityCents} c/kWh.`
          : `EV use ${savings.evKwhPer100Km} kWh/100 km; ${savings.homePercent}% home charging at ${savings.homeCentsPerKwh} c/kWh and ${100 - (savings.homePercent || 0)}% public charging at ${savings.publicCentsPerKwh} c/kWh.`,
      ],
      practicalSteps: [
        "Add a transparent charging-loss and public-fee sensitivity rather than hiding it in the vehicle consumption figure.",
        "Test higher and lower fuel and electricity prices and any solar export opportunity cost.",
        "Compare vehicle purchase, finance, insurance, servicing and depreciation separately before deciding.",
      ],
      toolActions: [{ id: "compare-electricity", label: "Check the charging tariff", href: "/compare" }],
      suggestedQuestions: ["Do you want to add charging losses and a high/low fuel and electricity price sensitivity?"],
    });
  }

  const financeWordYears: Readonly<Record<string, number>> = {
    one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, fifteen: 15, twenty: 20,
  };
  const financeTermYears = numericCapture(userConversation, /\b([\d,]+(?:\.\d+)?)\s*[- ]?\s*(?:year|yr)s?\b/i)
    ?? (() => {
      const word = userConversation.match(/\b(one|two|three|four|five|six|seven|eight|nine|ten|fifteen|twenty)\s*[- ]?year/i)?.[1]?.toLowerCase();
      return word ? financeWordYears[word] || null : null;
    })();
  const financeAmountMatch = userConversation.match(/\$\s*([\d,]+(?:\.\d+)?)\s*([kK])?\b/);
  const financeAmount = financeAmountMatch?.[1]
    ? Number(financeAmountMatch[1].replaceAll(",", "")) * (financeAmountMatch[2] ? 1000 : 1)
    : null;
  const financeAnnualRate = numericCapture(userConversation, /\b(\d+(?:\.\d+)?)\s*%/i);
  const energyUpgradeFinanceIntent = /\b(?:solar|PV|battery|hot[- ]?water|heat[- ]?pump|insulation|glazing|energy upgrade|electrification)\b/i.test(userConversation)
    && /\b(?:mortgage|home loans?|loans?|finance|financing|borrow|borrowing|refinance)\b/i.test(userConversation);
  if ((
    /\b(?:green loan|Household Energy Upgrades Fund|HEUF|energy upgrade loan)\b/i.test(userConversation)
    || /\b(?:green|sustainable|energy[ -]upgrade)\b[^\n]{0,40}\b(?:loans?|finance|financing)\b/i.test(userConversation)
    || /\b(?:loans?|finance|financing)\b[^\n]{0,40}\b(?:green|sustainable|energy[ -]upgrade)\b/i.test(userConversation)
    || energyUpgradeFinanceIntent
  ) && !(explicitProgramJurisdiction(userConversation)
    && /\b(?:current|available|open|which|what|assistance|scheme|programme|program)\b/i.test(userConversation))) {
    const mortgageBoundary = /\b(?:mortgage|home loan|refinance)\b/i.test(userConversation)
      ? ` Adding the upgrade to ${financeTermYears === null ? "a long mortgage term" : `a ${financeTermYears.toLocaleString("en-AU")}-year mortgage`} may reduce each repayment while increasing total interest and can leave part of the cost financed beyond some component warranty or replacement cycles.`
      : "";
    const repaymentMonths = financeTermYears === null ? null : Math.round(financeTermYears * 12);
    const monthlyRate = financeAnnualRate === null ? null : financeAnnualRate / 1200;
    const calculatedMonthlyRepayment = financeAmount !== null && repaymentMonths && monthlyRate !== null
      ? monthlyRate === 0
        ? financeAmount / repaymentMonths
        : financeAmount * monthlyRate * (1 + monthlyRate) ** repaymentMonths
          / ((1 + monthlyRate) ** repaymentMonths - 1)
      : null;
    const calculatedTotalRepayment = calculatedMonthlyRepayment === null || !repaymentMonths
      ? null
      : calculatedMonthlyRepayment * repaymentMonths;
    const suppliedFinanceArithmetic = calculatedMonthlyRepayment === null || calculatedTotalRepayment === null || financeAmount === null
      ? ""
      : ` If $${financeAmount.toLocaleString("en-AU")} is both the cash price and amount borrowed, ${financeAnnualRate}% is a nominal annual rate charged monthly, the term is ${financeTermYears} years and there are no fees or balloon, the standard repayment is about $${calculatedMonthlyRepayment.toLocaleString("en-AU", { maximumFractionDigits: 2 })} a month and total repayments are about $${calculatedTotalRepayment.toLocaleString("en-AU", { maximumFractionDigits: 0 })}, about $${(calculatedTotalRepayment - financeAmount).toLocaleString("en-AU", { maximumFractionDigits: 0 })} above cash. The lender's comparison rate and disclosure can change that result.`;
    return structured("rebates_certificates", {
      directAnswer:
        `Finance is not a rebate and does not prove that the energy upgrade will save money.${mortgageBoundary}${suppliedFinanceArithmetic} Compare the cash installed price with the added loan amount, term, comparison rate and every fee, and calculate the extra total repayments. Model bill savings separately under low and high cases, and subtract only independently confirmed support. Surge can structure the comparison but does not give personal financial advice.`,
      status: "needs_context",
      citations: officialCitationsById([
        "energy-gov-household-energy-upgrades-fund",
        "asic-moneysmart-personal-loans",
      ]),
      confidence: "medium",
      assumptions: ["No lender offer, comparison rate, fees, repayment schedule, balloon, cash price, confirmed support or measured energy-saving basis has been supplied."],
      practicalSteps: [
        "Put cash price, amount financed, term, comparison rate, every fee, reversion condition, early-repayment cost, balloon and total repayments in one table.",
        "Keep rebates, certificate discounts and projected bill savings as separate lines with eligibility and sensitivity assumptions.",
        "Compare net lifecycle cost and cash flow under low, central and high energy-price or usage cases; seek licensed personal financial advice where needed.",
      ],
      toolActions: [{ id: "open-rebates", label: "Check support separately from finance", href: "/rebates" }],
      suggestedQuestions: ["What are the cash price, added loan amount, term, comparison rate, fees and extra total repayments with and without early repayment?"],
    });
  }

  if (playbookId === "draught") {
    const missing = missingDraughtSlots(playbookConversation);
    const nextQuestions = missing.slice(0, 1).map((slot) => DRAUGHT_SLOT_QUESTIONS[slot]);
    const citations = officialCitationsById([
      "yourhome-ventilation-airtightness",
      "energy-gov-insulation-draught-proofing",
      "ncc-condensation-handbook",
    ]);
    if (missing.length) {
      return structured("draughts_ventilation", {
        directAnswer:
          `Draught proofing reduces unwanted air movement, but sealing the wrong opening can worsen moisture or interfere with safe ventilation and combustion. Before choosing DIY or professional work, I still need only: ${nextQuestions.join(" ")}`,
        status: "needs_context",
        citations,
        confidence: "low",
        assumptions: ["No site inspection, moisture test, ventilation check or combustion-safety check has been completed."],
        practicalSteps: [
          "Use removable door snakes or curtains only where they do not cover a required vent or heater clearance.",
          "Do not seal exhaust outlets, intentional vents or gaps required by combustion equipment.",
          "Reply with the missing building, comfort, moisture and heating facts before selecting permanent work.",
        ],
        toolActions: [],
        suggestedQuestions: nextQuestions,
      });
    }
    return structured("draughts_ventilation", {
      directAnswer:
        "Uncontrolled gaps let outdoor air replace conditioned indoor air, so safe sealing can improve comfort and reduce heating or cooling load. Start with visible seal condition and removable measures. Use a professional site assessment or blower-door test when leakage paths are unclear, the building is complex, or permanent work is planned. Do not block deliberate ventilation, moisture paths, combustion air, flues or electrical clearances.",
      status: "answered",
      citations,
      confidence: "medium",
      assumptions: ["The reported conditions have not been verified on site and concealed moisture or unsafe services may still exist."],
      practicalSteps: [
        "For a renter or temporary fix, use removable door snakes, curtains and replaceable seals without altering required vents.",
        "Inspect window and door seals while also checking condensation, exhaust fans and heater type.",
        "For permanent sealing, ask a qualified assessor for a site-wide leakage, ventilation and combustion-safety scope.",
      ],
      toolActions: [{
        id: "open-insulation-guide",
        label: "Open the insulation and draught guide",
        href: "/guides/insulation-draught-proofing",
      }],
      suggestedQuestions: ["Which leakage checks can I do without altering the property?"],
    });
  }

  if (playbookId === "ev1_ev2") {
    const meaning = evComparisonMeaning(playbookConversation);
    const citations = officialPlaybookCitations(["ev_charging", "bills_tariffs", "products_ratings"]);
    if (!meaning) {
      const question = "Do EV1 and EV2 mean Level 1 and Level 2 charging, two tariffs, or two exact vehicle or charger models?";
      return structured("ev_charging", {
        directAnswer: `EV1 and EV2 are not unambiguous labels. ${question}`,
        status: "needs_context",
        citations,
        confidence: "low",
        practicalSteps: ["State which of the three comparisons you mean before using any speed, cost or product assumption."],
        toolActions: [],
        suggestedQuestions: [question],
      });
    }
    if (meaning === "tariff") {
      return structured("bills_tariffs", {
        directAnswer: "For a tariff comparison, EV1 and EV2 still need the exact retailer and plan names, state or distribution area, charging times and interval usage. A label alone is not enough to decide which plan costs less.",
        status: "needs_context",
        citations,
        confidence: "low",
        practicalSteps: [
          "Provide both exact plan names and the property state or postcode.",
          "Add interval data or expected charging times and energy use.",
          "Compare supply, usage, demand and controlled charging terms together.",
        ],
        toolActions: [{ id: "compare-electricity", label: "Compare electricity plans", href: "/compare" }],
        suggestedQuestions: ["What are the exact retailer and plan names?"],
      });
    }
    if (meaning === "product") {
      return structured("products_ratings", {
        directAnswer: "For a product or model comparison, provide the full brand and model number for EV1 and EV2 and say whether they are vehicles or chargers. Similar labels can represent different electrical, connector, software and warranty requirements.",
        status: "needs_context",
        citations,
        confidence: "low",
        practicalSteps: [
          "Copy both exact model numbers from the quote or product plate.",
          "State the vehicle, connector, site supply and job the product must support.",
          "Compare official specifications and the complete installed scope.",
        ],
        toolActions: [],
        suggestedQuestions: ["What are the two exact brand and model numbers?"],
      });
    }
    const missing = missingEvChargingSlots(playbookConversation);
    const nextQuestions = missing.slice(0, 1).map((slot) => EV_CHARGING_SLOT_QUESTIONS[slot]);
    const chargingExplanation =
      "Level 1 home charging generally uses a compliant portable charging lead from an ordinary outlet and is the lower-power, slower option, commonly used for gradual or overnight top-ups. Level 2 uses a dedicated AC charging unit and circuit, so it can deliver more power and shorten the parked charging window. The actual rate and time are still bounded by the outlet or circuit, site supply, charger, vehicle's onboard AC charger, battery state and load management. A licensed electrician must assess the switchboard, cable route, protection, outlet or charger location and final installation; the level label alone does not prove a charging speed.";
    if (missing.length) {
      return structured("ev_charging", {
        directAnswer: `${chargingExplanation} I still need only: ${nextQuestions.join(" ")}`,
        status: "needs_context",
        citations,
        confidence: "low",
        practicalSteps: [
          "Do not buy from the EV1 or EV2 label alone.",
          "Collect the vehicle, daily-use, site-supply and tariff facts requested.",
          "Use a licensed electrician for the site design and final installation.",
        ],
        toolActions: [],
        suggestedQuestions: nextQuestions,
      });
    }
    return structured("ev_charging", {
      directAnswer: `${chargingExplanation} With the collected facts, compare the two exact charger options against the confirmed site and vehicle limits rather than a generic speed claim.`,
      status: "answered",
      citations,
      confidence: "medium",
      practicalSteps: [
        "Give the confirmed site and vehicle limits to a licensed electrician.",
        "Compare exact charger compatibility, controls, warranty and total installed scope.",
        "Schedule charging against the household tariff and available solar after commissioning.",
      ],
      toolActions: [{ id: "open-ev-guide", label: "Open the EV charging guide", href: "/guides/ev-charging" }],
      suggestedQuestions: ["Which installation details should appear in the quote?"],
    });
  }

  if (playbookId === "heat_pump_selection") {
    const missing = missingHeatPumpSelectionSlots(playbookConversation);
    const nextQuestions = missing.slice(0, 1).map((slot) => HEAT_PUMP_SELECTION_SLOT_QUESTIONS[slot]);
    const citations = officialPlaybookCitations([
      "rcac",
      "heat_pump_hot_water",
      "products_ratings",
      "rebates_certificates",
    ]);
    const independence =
      "Surge does not recommend, rank or endorse a heat-pump, reverse-cycle or solar-water-heater brand, supplier or model. It compares user-supplied options against the same independent criteria and current official facts.";
    const hotWaterPurpose = /\b(?:hot[- ]?water|HWS|HPHW|HPWH|water heater)\b/i.test(playbookConversation);
    const spaceHeatingPurpose = /\b(?:reverse[ -]cycle|RCAC|heater|heating system|air conditioner|air conditioning|space heating|heating and cooling)\b/i.test(playbookConversation);
    const immediateCategoryAnswer = hotWaterPurpose
      ? "A heat-pump water heater can use much less electricity than resistance hot water, but tank size, peak demand, winter recovery, placement, noise, tariff timing and the exact eligible model determine whether it suits this home."
      : spaceHeatingPurpose
        ? "For many Australian homes, a correctly sized reverse-cycle air conditioner is the efficient electric starting point because it provides heating and cooling. Capacity, layout, insulation, glazing, noise and cold-weather performance still determine what will work at this home, and any rebate or certificate support depends on location, the exact eligible product and installation date."
        : "A heat pump can be an efficient electric option, but the correct system type and capacity depend on the home's climate, demand and installation constraints.";
    const hotWaterKnownFacts = hotWaterPurpose ? [
      /\b(?:postcode\s*)?\d{4}\b|\bBallarat\b/i.test(playbookConversation)
        ? "Use the supplied postcode and Ballarat winter conditions for cold-weather recovery and efficiency, not a mild-climate headline COP."
        : null,
      /\b(?:people|persons?|occupants?|showers?|baths?)\b/i.test(playbookConversation)
        ? "The recorded household and morning/evening draw pattern must be tested against usable tank volume, reheating time and boost operation."
        : null,
      /\b(?:bedroom window|beside a bedroom|near a bedroom)\b/i.test(playbookConversation)
        ? "A bedroom-adjacent outdoor location makes rated sound, night operation, clearances and condensate routing decision constraints."
        : null,
      /\bgas storage\b/i.test(playbookConversation)
        ? "The scope must include lawful gas-system removal or isolation, plumbing, tempering and commissioning."
        : null,
      /\bswitchboard(?: capacity)?\s+(?:is\s+)?unknown\b/i.test(playbookConversation)
        ? "Unknown switchboard capacity remains a licensed electrical site check, not an assumed allowance."
        : null,
      /\bsolar\b/i.test(playbookConversation) && /\b(?:time of use|tariff|TOU)\b/i.test(playbookConversation)
        ? "The supported timer and recovery schedule should be compared for solar use and the complete time-of-use tariff without interrupting required hygiene cycles."
        : null,
    ].filter(Boolean).join(" ") : "";
    if (missing.length) {
      return structured(hotWaterPurpose ? "heat_pump_hot_water" : "products_ratings", {
        directAnswer:
          `${immediateCategoryAnswer} ${independence} ${hotWaterKnownFacts}`.trim(),
        status: "needs_context",
        citations,
        confidence: "low",
        assumptions: [
          "No brand, supplier or product preference has been applied.",
          "No site load, hot-water demand, official registration, installation design or complete quote has been verified.",
        ],
        practicalSteps: [],
        toolActions: [],
        suggestedQuestions: nextQuestions,
      });
    }
    return structured("products_ratings", {
      directAnswer:
        `${independence} The collected facts are sufficient for an independent comparison: verify delivered capacity and efficiency at the relevant design temperature, exact official registration and programme eligibility, refrigerant and controls, site and drainage design, written warranty and local service, then compare the complete commissioned scope. This verifies a user-supplied model; it is not an endorsement.`,
      status: "answered",
      citations,
      confidence: "medium",
      assumptions: [
        "Official product facts and programme eligibility still depend on the exact model and proposed installation date.",
        "A licensed installer remains responsible for the final site design and commissioning scope.",
      ],
      practicalSteps: [
        "Check each exact model in the applicable GEMS, Energy Rating, CER or state source.",
        "Put the relevant-temperature capacity, efficiency, refrigerant, controls, noise and drainage facts side by side.",
        "Compare warranty, local service and every quote inclusion and exclusion before deciding.",
      ],
      toolActions: [
        { id: "open-product-calculator", label: "Check approved products and programmes", href: "/calculator" },
        { id: "open-guides", label: "Open independent equipment criteria", href: "/guides" },
      ],
      suggestedQuestions: ["Which official facts differ between these exact models?"],
    });
  }

  if (playbookId === "trade_platform") {
    const matchingTradeTasks = (message: string) => TRADE_PLATFORM_TASKS
      .filter((candidate) => candidate.signals.test(message))
      .sort((left, right) => (right.priority || 0) - (left.priority || 0));
    const task = matchingTradeTasks(query)[0]
      || (/\b(?:draft|write|prepare)\b[^\n]{0,80}\b(?:proof|evidence|job note|record)\b|\b(?:proof|evidence)\b[^\n]{0,80}\b(?:job|TLink|Creditex)\b/i.test(query)
        ? TRADE_PLATFORM_TASKS.find((candidate) => candidate.id === "forms_evidence")
        : undefined)
      || [...priorUserMessages].reverse().flatMap(matchingTradeTasks)[0];
    if (!task) {
      const question = "Do you need the dashboard, jobs or schedule, calculator, forms or evidence, quotes or invoices, or standards?";
      return structured("trades", {
        directAnswer: `I can route the TLink or Creditex task without reading private platform records. ${question}`,
        status: "needs_context",
        citations: [],
        confidence: "low",
        practicalSteps: ["Choose the task area first, then I will give the shortest role-safe route."],
        toolActions: [],
        suggestedQuestions: [question],
      });
    }
    if (task.id === "forms_evidence" && /\b(?:draft|write|prepare|proof|prove|proving|defensible|evidence note|record)\b/i.test(query)) {
      return structured("trades", {
        directAnswer:
          "Draft the proof as a reviewable evidence note, not a conclusion: identify the observation; the exact required fact; the governing source, version and effective date; each original photo or file and its capture provenance; the result against that fact; any uncertainty, missing item or blocker; and the named preparer and reviewer. Keep the note linked to the exact job, product, installer and installation event. Do not state that the work is compliant or certificate-ready until the authorised review is complete.",
        status: "answered",
        citations: [],
        confidence: "high",
        assumptions: [
          "The guide has not read the private job, evidence files or programme pathway.",
          "The exact programme instrument, evidence requirements and reviewer authority must be selected in the signed-in workspace.",
        ],
        practicalSteps: [
          "Header: job and activity, site or asset reference, installation event date, author, reviewer, and exact source title, version and effective date.",
          "Evidence body: required fact, direct observation, result, original photo or file identifier, capture time and provenance, and how that item supports the result.",
          "Review close: uncertainty, missing evidence or blocker, corrective next step, reviewer and review outcome; leave the compliance claim open until authorised review.",
        ],
        toolActions: [...task.actions],
        suggestedQuestions: ["Which programme, activity, required fact and source version does this evidence note need to prove?"],
      });
    }
    return structured("trades", {
      directAnswer: task.directAnswer,
      status: "answered",
      citations: [],
      confidence: "high",
      assumptions: [
        `The request is being treated as ${task.label} navigation for the signed-in trade role.`,
        "The guide has not read or changed any private account, customer, job, quote, invoice or evidence record.",
      ],
      practicalSteps: [...task.steps],
      toolActions: [...task.actions],
      suggestedQuestions: ["What should I verify before completing this task?"],
    });
  }

  if (
    /\b(?:rent|rental|renter|tenant)\b/i.test(query)
    && /\b(?:cold|freezing|hard to heat|cannot keep warm|can't keep warm)\b/i.test(query)
    && !/\b(?:condensation|mould|mold|damp)\b/i.test(query)
  ) {
    const isVictorianRental = /\b(?:Victoria|Victorian|VIC)\b/i.test(query);
    const jurisdictionRentalSource = rentalSafetySourceId(query);
    const victorianBoundary = isVictorianRental
      ? " In Victoria, fixed-heater, repair and minimum-standard questions depend on the property and tenancy facts, so record the problem for the owner or agent and use the current Consumer Affairs Victoria process rather than assuming who must pay."
      : " Fixed-heater, repair and minimum-standard duties depend on the state and tenancy facts, so record the problem for the owner or agent and check the current official tenancy process rather than assuming who must pay.";
    return structured("comfort_fabric", {
      directAnswer:
        `A freezing rental needs a room-by-room diagnosis before buying equipment: missing or patchy insulation, air leaks, cold glazing, shade, moisture and the existing heater can all make the same room feel cold. Start with safe, removable measures and seek permission before adhesive, drilled, electrical or other fixed work.${victorianBoundary}`,
      status: "needs_context",
      citations: jurisdictionRentalSource
        ? officialCitationsById([
          jurisdictionRentalSource,
          "energy-gov-insulation-draught-proofing",
          "yourhome-ventilation-airtightness",
        ])
        : officialPlaybookCitations(["comfort_fabric", "renters_strata", "draughts_ventilation"]),
      confidence: "medium",
      assumptions: [
        "The building type, hardest room, time pattern, existing heating, moisture signs and lease permissions are not known.",
        "Portable heating must be used to its instructions, with electrical and combustion safety clearances preserved.",
      ],
      practicalSteps: [
        "Note which rooms and surfaces are cold, when it happens, visible gaps or condensation, and what heater is available.",
        "Use removable, well-fitted curtains, door snakes and manufacturer-approved temporary seals without covering vents, exhaust paths or heater clearances.",
        "Heat the occupied zone safely, then send the owner or agent a dated written record if fixed heating, draughts, leaks, damp or mould need assessment.",
      ],
      toolActions: [{ id: "open-home-plan", label: "Build a renter comfort plan", href: "/plan" }],
      suggestedQuestions: ["What type of rental is it, which room is worst, when is it cold, and what heating or moisture signs are present?"],
    });
  }

  if (
    /\b(?:rent|rental|tenant)\b/i.test(query)
    && /\b(?:cold|freezing)\b/i.test(query)
    && /\b(?:condensation|mould|mold|damp)\b/i.test(query)
  ) {
    return structured("comfort_fabric", {
      directAnswer:
        "Condensation forms when indoor moisture reaches a cold surface, so the cold bedroom and damp surface are usually one building-and-ventilation problem rather than two unrelated faults. Insulation, glazing, heating, air leakage and deliberate ventilation all affect the surface temperature and moisture level. As a renter, use removable measures first and report persistent condensation, mould, leaks or inadequate fixed equipment to the owner or agent in writing.",
      status: "answered",
      citations: officialPlaybookCitations(["comfort_fabric", "draughts_ventilation", "renters_strata"]),
      confidence: "medium",
      assumptions: [
        "The source of moisture and the wall or window construction are not yet known.",
        "Missing question: does the condensation form mainly on glass, frames, walls or inside a cupboard, and what heating and exhaust ventilation are used?",
      ],
      practicalSteps: [
        "Dry wet surfaces, use working bathroom and kitchen exhaust, and keep furniture clear of cold outside walls while monitoring the pattern.",
        "Use removable curtains and safe door seals, but do not cover required vents or heater clearances.",
        "Ask the owner for a building-specific moisture, ventilation and fixed-heating assessment if it persists.",
      ],
      toolActions: [{ id: "open-home-plan", label: "Build a comfort and moisture plan", href: "/plan" }],
      suggestedQuestions: ["Where does the condensation form and what heating and exhaust ventilation are used?"],
    });
  }

  if (/\b(?:west|western|west-facing|west facing)\b/i.test(query)
    && /\b(?:window|glazing|room|lounge|living area|bedroom)\b/i.test(query)
    && (/\b(?:summer|afternoon|hot|heat|overheat|overheats)\b/i.test(query)
      || (/\b(?:external )?shad(?:e|ing)\b/i.test(query) && /\b(?:glazing|glass|windows?)\b/i.test(query)))
    && !/\bsecondary glazing\b/i.test(query)) {
    return structured("glazing_shading", {
      directAnswer:
        "A west-facing room often overheats because low-angle afternoon sun reaches the glass and other exposed surfaces when the outdoor temperature is already high. Stop that solar gain outside first; internal coverings help but act after more heat reaches the glass. Reducing the gain and then using cooler-night ventilation where it is safe can cut the cooling load, but air conditioning still needs the room area, glazing, fabric and local design conditions rather than a guessed size.",
      status: "answered",
      citations: officialPlaybookCitations(["glazing_shading", "comfort_fabric"]),
      confidence: "medium",
      assumptions: ["Window and wall dimensions, glass and frame type, existing shading, local climate and tenancy or strata constraints are not known."],
      practicalSteps: [
        "Before the afternoon sun arrives, deploy safe external shade where permitted and close a well-fitted light-coloured blind or curtain inside.",
        "Use removable shade or window film only with owner or strata permission and product confirmation that it suits the exact glass, frame, warranty and thermal-stress risk.",
        "Purge heat only when outside air is cooler and security, smoke and moisture conditions allow; assess permanent external shading and the remaining cooling load before changing glazing or air conditioning.",
      ],
      toolActions: [{ id: "open-insulation-guide", label: "Open the building fabric guide", href: "/guides/insulation-draught-proofing" }],
      suggestedQuestions: ["What external shade already blocks the west glass?"],
    });
  }

  if (/\bsecondary glazing\b/i.test(query)
    && /\b(?:worth|work|effective|help|versus|vs\.?|compare|double glazing|insulation|condensation|noise|cold|heat)\b/i.test(query)) {
    return structured("glazing_shading", {
      directAnswer:
        "Secondary glazing can improve an existing window by adding a separated inner layer, but its result depends on the complete window: air gap, airtight perimeter, existing glass and frame, edge details, opening method and installation. It is not automatically equivalent to a tested double-glazed replacement and it does not fix direct summer sun. Compare whole-window heat flow, air leakage, condensation risk, safety, access and external shading against the room's actual problem.",
      status: "needs_context",
      citations: officialCitationsById(["yourhome-glazing", "energy-gov-windows", "yourhome-shading"]),
      confidence: "medium",
      assumptions: ["The climate, orientation, existing glass and frame, leakage, moisture pattern and proposed secondary system have not been inspected."],
      practicalSteps: [
        "Identify whether the room problem is air leakage, conducted heat, direct sun, condensation or noise.",
        "Ask for the complete secondary-glazing build-up, air gap, seals, safety and opening or cleaning details.",
        "Compare it with repaired seals, coverings, external shade and any replacement quote on the same room outcome.",
      ],
      toolActions: [{ id: "open-home-plan", label: "Compare window upgrade stages", href: "/plan" }],
      suggestedQuestions: ["Which window orientation and problem are you solving, and what existing glass, frame and seals are present?"],
    });
  }

  if (/\binsulat(?:e|ed|ing|ion)\b/i.test(query) && /\b(?:double glazing|double-glazing|windows?)\b/i.test(query)
    && /\b(?:first|priority|prioritise|prioritize|versus|vs\.?|or)\b/i.test(query)) {
    return structured("comfort_fabric", {
      directAnswer:
        "There is no safe universal winner between insulation and double glazing. If ceiling insulation is missing, thin, gapped or disturbed, or obvious draughts are present, fixing those large and often lower-cost heat paths is commonly the first stage. Windows can dominate a particular room when the glass area is large, leaky, unshaded or badly oriented, so glazing, frames, seals, coverings and external shade still need room-specific evidence. Prioritise the largest verified heat path and comfort problem, not the most expensive product.",
      status: "answered",
      citations: officialPlaybookCitations(["insulation", "glazing_shading", "comfort_fabric"]),
      confidence: "medium",
      assumptions: ["Existing insulation coverage, construction, climate, window area and orientation have not been measured."],
      practicalSteps: [
        "Safely inspect accessible insulation for coverage, gaps, compression, moisture and service clearances.",
        "Map uncomfortable rooms against window size, orientation, seals, coverings and external shade.",
        "Compare staged scopes from the verified weak points rather than product prices alone.",
      ],
      toolActions: [{ id: "open-home-plan", label: "Build a home fabric priority plan", href: "/plan" }],
      suggestedQuestions: ["What construction, climate, insulation coverage and window orientation apply?"],
    });
  }

  if (/\b(?:high|large|rising|increased|expensive)\b/i.test(query) && /\b(?:bill|electricity cost)\b/i.test(query)
    && /\b(?:tariff|plan|appliance|usage|load)\b/i.test(query)) {
    return structured("bills_tariffs", {
      directAnswer:
        "A high bill can come from using more energy, using it in expensive time or demand windows, a changed tariff, longer billing period, estimated meter read or a failing or newly added appliance. Separate those causes before replacing equipment or changing plans. Interval data shows when energy was used; the bill shows how that timing was priced.",
      status: "answered",
      citations: officialPlaybookCitations(["bills_tariffs", "products_ratings"]),
      confidence: "medium",
      assumptions: ["No bill, meter-read status, interval data, tariff schedule or appliance log has been reviewed."],
      practicalSteps: [
        "Compare billing days, actual versus estimated reads, total kWh, supply charge and any demand or time-of-use charges with the previous period.",
        "Use interval data to find new overnight, daytime or peak-period loads, then match them to heating, hot water, pool, EV or other equipment operation.",
        "Test the existing and alternative tariff against the same measured load before switching plans or appliances.",
      ],
      toolActions: [{ id: "compare-electricity", label: "Compare the tariff against actual use", href: "/compare" }],
      suggestedQuestions: ["Do you have the latest bill and interval data, and which appliance or tariff change happened first?"],
    });
  }

  const programmeAnswer = catalogueProgramAnswer(userConversation);
  if (programmeAnswer) {
    const programmeEffects: Readonly<Record<GovernmentProgramTemplate["outcomeClass"], string>> = {
      tradable_certificate: "is a certificate pathway whose quantity and commercial discount must be calculated separately",
      retailer_obligation_credit: "is delivered through an obligated or accredited programme participant, not as an automatic cash rebate",
      rebate: "may reduce an eligible upfront cost but does not change a federal certificate calculation",
      grant: "may provide conditional funding for an eligible applicant or project",
      loan: "may finance eligible costs and is not the same as a rebate",
      project_credit: "requires a governed project pathway rather than an ordinary household installation claim",
      tariff_only: "changes electricity payment or credit terms rather than installation eligibility",
      procurement_only: "is a controlled delivery programme rather than an open household claim",
    };
    const programmeSummary = programmeAnswer.programs
      .map((program) => program.catalogueState === "limited"
        ? `${program.name} has staged or limited availability (${program.operatingNote}) and ${programmeEffects[program.outcomeClass]}`
        : `${program.name} is listed current and ${programmeEffects[program.outcomeClass]}`)
      .join("; ");
    if (!programmeAnswer.programs.length) {
      return structured("rebates_certificates", {
        directAnswer:
          `Potentially relevant pathways for ${programmeAnswer.jurisdictionLabel} cannot yet be identified from the maintained current and limited catalogue because there is no programme matching all supplied filters. I will not fill the list with unrelated zero-relevance programmes. That is not proof no assistance exists: confirm the postcode, applicant or tenure, exact upgrade and application date, then check the current administering-government directory and any technology-specific federal certificate pathway separately.`,
        status: "needs_context",
        citations: officialCitationsById(["energy-gov-rebates"]),
        confidence: "medium",
        assumptions: ["The answer is limited to current and limited catalogue entries and the applicant and upgrade terms recognised in the question."],
        practicalSteps: [
          "Verify the postcode, applicant or tenure, exact upgrade and proposed application date.",
          "Check the current state or territory assistance directory using those same filters.",
          "Check any federal STC pathway separately without assuming a dollar value or state eligibility.",
        ],
        toolActions: [{ id: "open-rebates", label: "Check current assistance", href: "/rebates" }],
        suggestedQuestions: ["What exact applicant type, upgrade and proposed application date should be checked?"],
      });
    }
    const includeSolarSharer = ["NSW", "SA", "QLD"].includes(programmeAnswer.jurisdictionCode)
      && !programmeAnswer.certificateIntent
      && /\b(?:Solar Sharer|tariffs?|free (?:electricity|power|hours?)|middle[- ]of[- ]day offer)\b/i.test(userConversation);
    const solarSharerCitations = includeSolarSharer
      ? officialCitationsById(["energy-gov-solar-sharer-offer"])
      : [];
    const solarSharerSummary = includeSolarSharer && solarSharerCitations.length
      ? " The Solar Sharer Offer is also current in eligible Default Market Offer areas: it is a smart-meter retail tariff with a three-hour middle-of-day free-use window, not a rebate, and its complete annual tariff must be compared against the measured load."
      : "";
    const includedProgramIds = new Set(programmeAnswer.programs.map((program) => program.templateId));
    const availabilityCitations = officialCitationsById([
      ...(includedProgramIds.has("au-household-energy-upgrades-fund")
        ? ["energy-gov-household-energy-upgrades-fund"]
        : []),
      ...(includedProgramIds.has("nsw-home-energy-saver")
        ? ["nsw-home-energy-saver-current"]
        : []),
    ]);
    const availabilitySummary = [
      includedProgramIds.has("au-household-energy-upgrades-fund")
        ? "The Household Energy Upgrades Fund currently supports discounted finance through participating lenders; lender credit, product, property and evidence rules apply, and it is not a cash rebate."
        : "",
      includedProgramIds.has("nsw-home-energy-saver")
        ? "For NSW Home Energy Saver, zero-interest loan applications are open as reviewed on 20 August 2026, while the separate household discounts are still coming soon."
        : "",
    ].filter(Boolean).join(" ");
    const missingFacts = [
      !/\b\d{4}\b/.test(userConversation) ? "What is the property postcode?" : "",
      !/\b(?:owner|owner-occupier|rent|renter|tenant|landlord|strata|owners corporation|business|community housing)\b/i.test(userConversation)
        ? "Is the applicant an owner-occupier, renter, landlord, strata body or business?"
        : "",
      !/\b(?:solar|PV|battery|hot water|heat pump|heating|cooling|insulation|glazing|draught|EV|charger)\b/i.test(userConversation)
        ? "What exact upgrade is proposed?"
        : "",
      !/\b(?:[0-3]?\d[\/-][01]?\d[\/-]20\d{2}|20\d{2}-[01]\d-[0-3]\d|20\d{2})\b/.test(userConversation)
        ? "What is the proposed installation or application date?"
        : "",
      !/\b(?:brand|model|approved product|exact product)\b/i.test(userConversation)
        ? "What exact product or model is proposed, if the programme is product-based?"
        : "",
    ].filter(Boolean).slice(0, 1);
    const destination = programmeAnswer.certificateIntent ? "/calculator" : "/rebates";
    const secondaryDestination = programmeAnswer.certificateIntent ? "/rebates" : "/calculator";
    return structured("rebates_certificates", {
      directAnswer:
        `Potentially relevant pathways for ${programmeAnswer.jurisdictionLabel}, reviewed ${GOVERNMENT_CATALOGUE_REVIEWED_ON}: ${programmeSummary}. ${availabilitySummary}${solarSharerSummary} This is not an eligibility decision.${missingFacts.length ? ` Next I need: ${missingFacts[0]}` : " The collected facts are ready for Australian Energy Assessments' eligibility and calculation tools."}`,
      status: missingFacts.length ? "needs_context" : "answered",
      citations: uniqueById([
        ...catalogueProgramCitations(programmeAnswer.programs),
        ...availabilityCitations,
        ...solarSharerCitations,
      ], 4),
      confidence: missingFacts.length ? "low" : "medium",
      assumptions: [
        `The jurisdiction was taken from the question as ${programmeAnswer.jurisdictionLabel}.`,
        "No postcode, applicant, property, product, installer or installation-date eligibility check was completed.",
      ],
      practicalSteps: [
        "Add the missing property, applicant, upgrade, product and date facts to the Australian Energy Assessments check.",
        "Use the rebate tool for programme eligibility and the calculator for any governed certificate quantity.",
        "Keep the resulting eligibility basis separate from the installer or agent's commercial discount.",
      ],
      toolActions: [
        {
          id: programmeAnswer.certificateIntent ? "open-calculator" : "open-rebates",
          label: programmeAnswer.certificateIntent
            ? "Open the certificate calculator"
            : "Check rebates and assistance",
          href: destination,
        },
        {
          id: programmeAnswer.certificateIntent ? "open-rebates" : "open-calculator",
          label: programmeAnswer.certificateIntent
            ? "Check rebates and assistance"
            : "Open the certificate calculator",
          href: secondaryDestination,
        },
        ...(includeSolarSharer ? [{
          id: "compare-solar-sharer",
          label: "Compare the Solar Sharer tariff",
          href: "/compare",
        }] : []),
      ],
      suggestedQuestions: missingFacts,
    });
  }

  if (!activeOfficial.length && staleMatches.length) {
    return structured(selectedTopics[0] || fallbackTopic, {
      directAnswer:
        "I found relevant local material, but its scheduled review date has passed or its effective period does not cover today. I will not present it as current advice. Open the cited official source and confirm the current rule or product information before acting.",
      status: "source_review_required",
      citations: citationsFor(staleMatches.slice(0, 4)),
      confidence: "low",
      practicalSteps: [
        "Open the cited official source.",
        "Confirm the current effective date and rule before acting.",
        "Return with the current source or exact product and site details.",
      ],
    });
  }

  if (!activeOfficial.length) {
    return structured(fallbackTopic, {
      directAnswer:
        "Tell me the home or trade decision you are trying to make. Useful details are the postcode, property type, owner or renter status, current equipment and the problem you want to solve. I will narrow the answer to current cited sources.",
      status: "needs_context",
      citations: [],
      confidence: "low",
      practicalSteps: [
        "Provide the postcode and property type.",
        "State whether you own, rent or manage strata property.",
        "Describe the current equipment and the problem to solve.",
      ],
    });
  }

  if (/\b(electrification|electrify|all electric|replace (?:all )?gas)\b/i.test(retrievalQuery)) {
    const sequenceSources = activeOfficial.filter((result) =>
      result.source.id === "energy-gov-electrification-sequence"
      || result.source.id === "energy-gov-electrification");
    if (sequenceSources.length) {
      return structured("comfort_fabric", {
        directAnswer:
          "Build one electrification sequence for the home rather than buying isolated appliances. Start with safety and comfort loads, coordinate switchboard and circuit capacity, replace failing gas heating, hot water and cooking with suitable electric systems, then size solar, battery and EV charging against the resulting load.",
        status: "answered",
        citations: citationsFor(sequenceSources.slice(0, 3)),
        confidence: "high",
        practicalSteps: [
          "Record current equipment, condition, fuel use, comfort problems and likely replacement dates.",
          "Have the fabric, heating, hot water, cooking and electrical capacity assessed as one scope.",
          "Stage solar, battery and EV charging after modelling the future all-electric load and tariff.",
        ],
        suggestedQuestions: ["Which current gas appliance or comfort problem should the plan address first?"],
      });
    }
  }

  const factual = activeOfficial.slice(0, 2);
  const citations = citationsFor(factual);
  const primaryTopic = factual[0].source.topic;
  const directAnswer = factual[0].relevanceScore >= 8
    ? boundedEvidenceSentences(retrievalQuery, factual)
    : "";
  if (!directAnswer) {
    return structured(primaryTopic, {
      directAnswer:
        "I found a related current official source, but the question is not specific enough to extract a reliable fact without guessing. Name the exact home-energy decision, programme, product fact or trade task you want checked.",
      status: "needs_context",
      citations: citations.slice(0, 1),
      confidence: "low",
      assumptions: ["The retrieved source had only weak factual overlap with the question."],
      practicalSteps: ["Name the exact fact or decision to verify."],
      suggestedQuestions: suggestionsFor([primaryTopic]).slice(0, 1),
    });
  }
  const primaryTopicEvidence = factual.filter((result) => result.source.topic === primaryTopic);
  const broadComfortQuestion = /\b(?:freezing|cold|comfortable|comfort|hardest room|hardest rooms)\b/i.test(query);
  const confidence = !broadComfortQuestion && primaryTopicEvidence.length >= 2
    && primaryTopicEvidence[0].relevanceScore >= 12
    ? "high"
    : primaryTopicEvidence[0].relevanceScore >= 4
      ? "medium"
      : "low";
  return structured(primaryTopic, {
    directAnswer,
    status: "answered",
    citations,
    confidence,
    practicalSteps: [...TOPIC_STEPS[primaryTopic]],
    suggestedQuestions: suggestionsFor([primaryTopic]).slice(0, 1),
  });
}
