import {
  SURGE_ASSESSOR_EDUCATION_REVIEW,
  type SurgeAssessorEducationSourceId,
} from "./surge-assessor-education-sources.ts";

export const SURGE_ASSESSOR_EDUCATION_TOPIC_IDS = [
  "identity",
  "answer_first_novice_teaching",
  "highest_value_follow_up",
  "good_better_best",
  "building_diagnostics",
  "draught_ventilation_moisture",
  "insulation_windows",
  "heating_cooling",
  "hot_water",
  "appliances",
  "solar",
  "battery",
  "tariffs",
  "ev_mobility",
  "renter_strata",
  "safety_escalation",
  "product_model_comparison",
  "rebates_current_data",
  "evidence_uncertainty",
] as const;

export type SurgeAssessorEducationTopicId =
  (typeof SURGE_ASSESSOR_EDUCATION_TOPIC_IDS)[number];

export type SurgeAssessorEducationPageReference = {
  sourceId: SurgeAssessorEducationSourceId;
  pageStart: number;
  pageEnd: number;
};

export type SurgeAssessorEducationLadder = {
  good: string;
  better: string;
  best: string;
};

export type SurgeAssessorEducationCard = {
  id: string;
  topics: readonly SurgeAssessorEducationTopicId[];
  title: string;
  answerFirst: string;
  why: string;
  decisionQuestions: readonly string[];
  optionalLadder: SurgeAssessorEducationLadder | null;
  safetyBoundary: string;
  relatedOfficialSourceIds: readonly string[];
  pageReferences: readonly SurgeAssessorEducationPageReference[];
  currentFactBoundary: "verify_with_current_official_sources";
  review: typeof SURGE_ASSESSOR_EDUCATION_REVIEW;
};

type EducationCardInput = Omit<
  SurgeAssessorEducationCard,
  "currentFactBoundary" | "review"
>;

const reviewedCard = (input: EducationCardInput): SurgeAssessorEducationCard =>
  Object.freeze({
    ...input,
    topics: Object.freeze([...input.topics]),
    decisionQuestions: Object.freeze([...input.decisionQuestions]),
    optionalLadder: input.optionalLadder
      ? Object.freeze({ ...input.optionalLadder })
      : null,
    relatedOfficialSourceIds: Object.freeze([...input.relatedOfficialSourceIds]),
    pageReferences: Object.freeze(
      input.pageReferences.map((reference) => Object.freeze({ ...reference })),
    ),
    currentFactBoundary: "verify_with_current_official_sources",
    review: SURGE_ASSESSOR_EDUCATION_REVIEW,
  });

const pages = (
  sourceId: SurgeAssessorEducationSourceId,
  pageStart: number,
  pageEnd = pageStart,
): SurgeAssessorEducationPageReference => ({ sourceId, pageStart, pageEnd });

export const SURGE_ASSESSOR_EDUCATION_CARDS = Object.freeze([
  reviewedCard({
    id: "surge-identity-provider-neutral-guide",
    topics: ["identity"],
    title: "Who Wattzun AI is",
    answerFirst:
      "Wattzun AI is a provider-neutral Australian home-energy guide that helps a household make a sound decision. It teaches the reasoning, prepares practical next steps and does not sell a brand, installer, retailer, tariff or finance product.",
    why:
      "A clear identity keeps advice useful and independent while preventing education from drifting into sales or unsupported authority.",
    decisionQuestions: [
      "What outcome is the household actually trying to achieve?",
      "Which constraints and facts has the household already provided?",
    ],
    optionalLadder: null,
    safetyBoundary:
      "Emergency, hazard and regulated-work boundaries take priority over the ordinary education flow.",
    relatedOfficialSourceIds: [],
    pageReferences: [
      pages("electric-saul-editorial", 1),
      pages("community-informed-response-guide", 1, 3),
      pages("community-informed-response-guide", 6, 7),
    ],
  }),
  reviewedCard({
    id: "teach-answer-first-for-novices",
    topics: ["answer_first_novice_teaching"],
    title: "Teach from the answer outward",
    answerFirst:
      "Lead with the practical conclusion in plain language, then explain one idea at a time, why it matters here, the main trade-off and the next action. Define a technical term only when it helps the current decision.",
    why:
      "A novice can act on a short answer and still build understanding without first decoding a technical lecture.",
    decisionQuestions: [
      "What does the user need to know or do after the first two sentences?",
      "Which single concept would make the recommendation understandable?",
    ],
    optionalLadder: null,
    safetyBoundary:
      "If the question signals immediate danger, give the stop and escalation action before any teaching detail.",
    relatedOfficialSourceIds: [],
    pageReferences: [
      pages("community-informed-response-guide", 2, 3),
      pages("community-informed-response-guide", 6, 7),
      pages("power-you-control", 11, 15),
      pages("drive-the-transition", 11, 13),
    ],
  }),
  reviewedCard({
    id: "ask-one-decision-changing-question",
    topics: ["highest_value_follow_up"],
    title: "Ask the question that can change the answer",
    answerFirst:
      "Use saved context, identify the largest unresolved decision risk and ask one focused question about it. Prefer measured data, an exact model, a dated bill, a photo or a site constraint over a broad questionnaire.",
    why:
      "One high-value question moves the decision forward faster and reduces the chance of a confident answer built on the wrong assumption.",
    decisionQuestions: [
      "Which missing fact could reverse the current recommendation?",
      "What is the least burdensome evidence the household can provide to resolve it?",
    ],
    optionalLadder: null,
    safetyBoundary:
      "Do not delay urgent safety advice while collecting additional context.",
    relatedOfficialSourceIds: [],
    pageReferences: [
      pages("community-informed-response-guide", 2),
      pages("community-informed-response-guide", 6, 7),
      pages("comfort-you-control", 11, 12),
      pages("power-you-control", 13, 18),
    ],
  }),
  reviewedCard({
    id: "good-better-best-by-evidence-and-fit",
    topics: ["good_better_best"],
    title: "Use a good, better, best ladder",
    answerFirst:
      "Offer a small ladder when several levels of effort are reasonable. Rank the steps by evidence quality, fit, durability and verification, not by purchase price or technical complexity.",
    why:
      "A ladder gives the household a safe entry point while showing what stronger evidence or a more complete method would add.",
    decisionQuestions: [
      "What is the smallest useful step that preserves safety and future options?",
      "What extra evidence or verification would materially improve the decision?",
    ],
    optionalLadder: {
      good: "Use available household facts to choose a low-risk next step.",
      better: "Add measurements and compare feasible options on the same scope.",
      best: "Verify the preferred option against site evidence, current sources and completion evidence.",
    },
    safetyBoundary:
      "Every level must remain safe and lawful; an unsafe shortcut is not a valid first rung.",
    relatedOfficialSourceIds: [],
    pageReferences: [
      pages("comfort-you-control", 7, 8),
      pages("comfort-by-design", 7, 10),
      pages("home-by-evidence", 38, 43),
      pages("drive-the-transition", 69, 81),
    ],
  }),
  reviewedCard({
    id: "diagnose-the-home-before-prescribing",
    topics: ["building_diagnostics"],
    title: "Diagnose before prescribing",
    answerFirst:
      "Start with the symptom, location, timing and conditions. Build a baseline from safe observations and measurements, test the simplest plausible causes, then escalate to the right assessment when the evidence or access is beyond the household.",
    why:
      "Comfort, moisture and bill problems can share symptoms but need different remedies. Diagnosis avoids buying equipment that treats the wrong cause.",
    decisionQuestions: [
      "Where and when does the problem occur, and what changed before it began?",
      "Which safe measurement can separate the leading explanations?",
    ],
    optionalLadder: {
      good: "Record the symptom, weather, room conditions and recent changes.",
      better: "Add a room log, bills or interval data and low-risk instrument readings.",
      best: "Use a qualified assessment with a written brief, calibrated tools and post-work verification.",
    },
    safetyBoundary:
      "Do not enter unsafe roof, ceiling, subfloor or electrical areas; stop for suspected asbestos, live electrical risk, combustion danger, structural damage or significant mould.",
    relatedOfficialSourceIds: [
      "nathers-how-get-assessment",
      "aer-understanding-energy-bill",
      "yourhome-condensation-moisture",
    ],
    pageReferences: [
      pages("comfort-you-control", 11, 12),
      pages("comfort-by-design", 14, 16),
      pages("home-by-evidence", 38, 43),
      pages("home-by-evidence", 94, 97),
    ],
  }),
  reviewedCard({
    id: "control-water-and-ventilation-before-sealing",
    topics: ["draught_ventilation_moisture"],
    title: "Separate draughts, ventilation and moisture",
    answerFirst:
      "Find the water source and confirm which openings are unintended leakage and which serve ventilation, exhaust or combustion. Control moisture at the source, exhaust it outdoors where required and seal only confirmed unwanted gaps.",
    why:
      "Random leakage wastes energy, but indiscriminate sealing can trap moisture or interfere with safe combustion and ventilation.",
    decisionQuestions: [
      "Is the moisture from a leak, indoor generation, poor extraction, cold surfaces or a combination?",
      "Which vents, flues, chimneys, exhausts and make-up-air paths must remain functional?",
    ],
    optionalLadder: {
      good: "Measure temperature and humidity and control obvious indoor moisture sources.",
      better: "Map leakage and verify exhaust paths before targeted reversible sealing.",
      best: "Use a whole-home ventilation and airtightness assessment with commissioning after work.",
    },
    safetyBoundary:
      "Do not block a required vent, flue, chimney or exhaust, and escalate persistent damp, mould, leaks or combustion concerns.",
    relatedOfficialSourceIds: [
      "yourhome-ventilation-airtightness",
      "yourhome-condensation-moisture",
      "ncc-condensation-handbook",
      "energy-gov-insulation-draught-proofing",
    ],
    pageReferences: [
      pages("comfort-you-control", 15, 17),
      pages("comfort-you-control", 28, 29),
      pages("comfort-by-design", 35, 39),
      pages("community-informed-response-guide", 4, 5),
    ],
  }),
  reviewedCard({
    id: "treat-insulation-and-windows-as-systems",
    topics: ["insulation_windows"],
    title: "Treat the envelope as a continuous system",
    answerFirst:
      "Identify the thermal boundary and its gaps before choosing a product. For windows, separate air leakage, conductive heat flow and solar gain, then compare the whole window, frame, seals, shade, installation and warranty.",
    why:
      "Insulation value on a label or glass performance alone does not show how the completed room or building will perform.",
    decisionQuestions: [
      "Where is the thermal and air-control layer incomplete or poorly connected?",
      "Is the window problem leakage, winter heat loss, summer sun, condensation, noise or several of these?",
    ],
    optionalLadder: {
      good: "Repair defects, use suitable seals and add effective seasonal coverings or shade.",
      better: "Improve insulation continuity and compare whole-window performance for the actual orientation.",
      best: "Specify the complete envelope result, installation details, hold points and completion evidence.",
    },
    safetyBoundary:
      "Check moisture, asbestos, electrical clearances, glazing safety, access and fire requirements before disturbing building fabric.",
    relatedOfficialSourceIds: [
      "yourhome-insulation",
      "yourhome-glazing",
      "yourhome-shading",
      "energy-gov-windows",
    ],
    pageReferences: [
      pages("comfort-you-control", 18, 25),
      pages("comfort-by-design", 17, 34),
      pages("comfort-by-design", 64, 67),
      pages("home-by-evidence", 27, 33),
    ],
  }),
  reviewedCard({
    id: "reduce-heating-and-cooling-load-first",
    topics: ["heating_cooling"],
    title: "Reduce the load, then size the system",
    answerFirst:
      "Start with occupied rooms, local climate, comfort hours, insulation, leakage, glazing and shade. Compare correctly sized systems using retained capacity, seasonal efficiency, airflow, noise, controls, installation scope and local service.",
    why:
      "A larger unit can cycle poorly or miss the real comfort problem, while a suitable system in a lower-load room can deliver more useful comfort with less energy.",
    decisionQuestions: [
      "Which rooms need comfort, at what times and under which outdoor conditions?",
      "What building improvements or zoning could reduce the required capacity?",
    ],
    optionalLadder: {
      good: "Use fans, shade, doors and sensible controls to improve occupied-room comfort.",
      better: "Reduce obvious envelope loads and compare suitable zoned equipment.",
      best: "Use room loads, design conditions, verified product data and commissioned installation.",
    },
    safetyBoundary:
      "Licensed people must complete fixed electrical and refrigerant work, and combustion systems require safe ventilation and servicing.",
    relatedOfficialSourceIds: [
      "energy-gov-heating-cooling",
      "energy-rating-zoned-label",
      "yourhome-heating-cooling",
      "energy-gov-carbon-monoxide-heater-safety",
    ],
    pageReferences: [
      pages("comfort-you-control", 30, 32),
      pages("power-you-control", 57, 62),
      pages("home-by-evidence", 54, 59),
    ],
  }),
  reviewedCard({
    id: "size-hot-water-around-real-demand",
    topics: ["hot_water"],
    title: "Match hot water to demand and constraints",
    answerFirst:
      "Reduce avoidable demand, then compare systems using household draw pattern, storage, recovery, climate, available energy, noise, location, tariff timing, resilience and the complete installed scope.",
    why:
      "A technology label does not show whether a household will run out of hot water, disturb neighbours, miss a solar window or need extra electrical and plumbing work.",
    decisionQuestions: [
      "How many people use hot water, when do uses cluster and what recovery is needed?",
      "What location, noise, drainage, tariff and electrical constraints apply?",
    ],
    optionalLadder: {
      good: "Measure demand and improve fixtures and operating settings where safe.",
      better: "Compare feasible system types on demand, recovery, energy and full installation scope.",
      best: "Verify the exact model, climate performance, controls, licensed design and commissioning evidence.",
    },
    safetyBoundary:
      "Plumbing, gas, refrigerant and fixed electrical work require appropriately licensed people, and safe water-temperature controls must be preserved.",
    relatedOfficialSourceIds: [
      "yourhome-hot-water-systems",
      "energy-gov-smart-hot-water",
      "cer-swh-ashp-register",
    ],
    pageReferences: [
      pages("comfort-you-control", 33, 34),
      pages("power-you-control", 63, 65),
      pages("community-informed-response-guide", 4),
    ],
  }),
  reviewedCard({
    id: "compare-appliances-by-the-job-and-annual-energy",
    topics: ["appliances"],
    title: "Compare appliances by the job they must do",
    answerFirst:
      "Confirm capacity, household use and installation constraints before comparing annual energy, relevant rating-zone data, controls, noise, repair support, warranty and complete ownership cost for exact models.",
    why:
      "Star ratings and purchase price can mislead when products have different capacities, duty cycles, features or installation needs.",
    decisionQuestions: [
      "What service, capacity and usage pattern must the appliance reliably meet?",
      "Which standard test result and operating cost are comparable for the exact models?",
    ],
    optionalLadder: null,
    safetyBoundary:
      "Follow product instructions and use licensed trades for fixed wiring, gas, plumbing, refrigerant or structural work.",
    relatedOfficialSourceIds: [
      "energy-rating-understand-label",
      "energy-gov-appliances-cooking",
      "yourhome-appliances-technology",
    ],
    pageReferences: [
      pages("comfort-you-control", 35, 36),
      pages("power-you-control", 66, 70),
      pages("electric-saul-editorial", 6, 8),
    ],
  }),
  reviewedCard({
    id: "size-solar-from-site-and-load-profile",
    topics: ["solar"],
    title: "Size solar from the site and load profile",
    answerFirst:
      "Check roof condition, shade, orientation, network limits and the household's interval use, including planned electrification. Compare complete designs on generation profile, self-use, export assumptions, equipment architecture, installation quality and handover evidence.",
    why:
      "Nameplate capacity alone does not show when the system will generate, how much the household can use or whether the site and network can support the design.",
    decisionQuestions: [
      "When does the household use energy now and after planned upgrades?",
      "Which roof, shading, switchboard, metering and network constraints shape the feasible design?",
    ],
    optionalLadder: {
      good: "Use bills and a shade and roof check to test basic feasibility.",
      better: "Use interval data and compare like-for-like site-specific designs.",
      best: "Verify the design, approvals, exact equipment, installation, monitoring and commissioning evidence.",
    },
    safetyBoundary:
      "Do not inspect a roof or alter electrical equipment without safe access and appropriately licensed people.",
    relatedOfficialSourceIds: [
      "energy-gov-solar-batteries",
      "energy-gov-solar-consumer-guide",
      "cer-rooftop-solar-trade-requirements",
    ],
    pageReferences: [
      pages("power-you-control", 20, 36),
      pages("power-you-control", 95),
      pages("community-informed-response-guide", 3, 4),
    ],
  }),
  reviewedCard({
    id: "give-the-battery-a-measured-job",
    topics: ["battery"],
    title: "Give the battery a measured job",
    answerFirst:
      "Define whether the battery is for solar shifting, tariff response, backup or another service. Size usable energy and power from interval data, losses, reserve, outage loads and operating limits, then test economics under more than one scenario.",
    why:
      "A large nominal capacity can still miss peak power, backup architecture or household timing needs, and a favourable retail plan may change.",
    decisionQuestions: [
      "What exact job must the battery perform and during which hours?",
      "What usable capacity, power, losses, reserve and fallback does that job require?",
    ],
    optionalLadder: {
      good: "Measure the evening load and clarify whether backup is required.",
      better: "Model usable capacity, power, losses and tariff scenarios from interval data.",
      best: "Verify site design, safety placement, compatibility, commissioning, warranty and adverse economics.",
    },
    safetyBoundary:
      "Damaged, hot, swollen, smoking, flooded or recalled batteries require immediate isolation from people and emergency or specialist advice; do not touch or move them.",
    relatedOfficialSourceIds: [
      "energy-gov-batteries",
      "cer-solar-battery-requirements",
      "product-safety-recalls",
      "frnsw-lithium-battery-fire-response",
    ],
    pageReferences: [
      pages("power-you-control", 37, 47),
      pages("power-you-control", 95),
      pages("community-informed-response-guide", 3, 4),
      pages("community-informed-response-guide", 5, 6),
    ],
  }),
  reviewedCard({
    id: "compare-the-whole-tariff-with-real-loads",
    topics: ["tariffs"],
    title: "Compare the whole tariff against real use",
    answerFirst:
      "Use interval data where available and compare supply charges, usage periods, demand charges, export treatment, caps, fees and control terms across representative seasons. Show which loads must move and whether that remains practical.",
    why:
      "A cheap or free window can be outweighed by other rates, limits, household demand or a plan structure that changes.",
    decisionQuestions: [
      "How much energy can safely and realistically move into the preferred period?",
      "What happens to annual cost if usage, solar, exports or the plan terms change?",
    ],
    optionalLadder: null,
    safetyBoundary:
      "Do not advise unsafe unattended operation or electrical overloading to chase a tariff window.",
    relatedOfficialSourceIds: [
      "energy-made-easy-current-plan-comparison",
      "aer-understanding-energy-bill",
    ],
    pageReferences: [
      pages("power-you-control", 15, 19),
      pages("power-you-control", 46, 47),
      pages("community-informed-response-guide", 3, 4),
    ],
  }),
  reviewedCard({
    id: "solve-the-mobility-need-before-the-vehicle",
    topics: ["ev_mobility"],
    title: "Solve the mobility need before choosing a vehicle",
    answerFirst:
      "Start with required trips, passengers, accessibility, cargo, towing, parking, charging access and the repeated difficult day. Consider walking, cycling, public transport, sharing or hiring where they genuinely meet the need before sizing the everyday vehicle and charging system.",
    why:
      "Headline range or maximum charging speed does not prove that a vehicle fits the household's journeys, parking, payload, fallback or budget.",
    decisionQuestions: [
      "What is the longest regularly repeated difficult day, including weather, load and reserve?",
      "Where can the vehicle lawfully park and charge, for how long, with what fallback?",
    ],
    optionalLadder: {
      good: "Record a normal week of trips, parking and passenger or cargo needs.",
      better: "Log several weeks and test difficult-day range, charging energy and total cost.",
      best: "Pass every mandatory journey, parking, payload, charging, repair, safety, affordability and fallback gate.",
    },
    safetyBoundary:
      "Licensed people must design fixed charging work; do not use improvised leads or backfeeding, and move away and call 000 for a suspected vehicle or lithium-battery fire.",
    relatedOfficialSourceIds: [
      "green-vehicle-guide-compare",
      "energy-gov-electric-vehicles",
      "energy-gov-ev-charging-equipment",
      "energy-gov-ev-home-strata-charging",
    ],
    pageReferences: [
      pages("drive-the-transition", 8, 40),
      pages("drive-the-transition", 57, 81),
      pages("power-you-control", 51, 55),
    ],
  }),
  reviewedCard({
    id: "adapt-the-path-for-renters-and-strata",
    topics: ["renter_strata"],
    title: "Separate control, permission and common property",
    answerFirst:
      "For renters, start with account choices, reversible actions, maintenance evidence and a clear written request. For strata, identify title boundaries, common property, approvals, shared capacity, metering, billing, maintenance, future uptake and who carries each cost and risk.",
    why:
      "A technically useful upgrade can fail when the person lacks permission or a one-lot solution shifts cost and capacity problems to the wider building.",
    decisionQuestions: [
      "What can the occupant control now, and what requires owner or owners-corporation approval?",
      "Which building-wide capacity, access, billing and future-expansion issues must the proposal address?",
    ],
    optionalLadder: {
      good: "Document the problem and use safe no-alteration actions.",
      better: "Make an evidence-backed request with costs, benefits and responsibilities.",
      best: "Use a building-wide, supplier-neutral plan with staged capacity, approvals and transparent allocation.",
    },
    safetyBoundary:
      "Do not alter the building, common property, fixed services or electrical equipment without required permission and licensed work.",
    relatedOfficialSourceIds: [
      "energy-gov-renters",
      "energy-gov-strata-solar",
      "energy-gov-strata-personal-ev-charger",
    ],
    pageReferences: [
      pages("comfort-you-control", 13, 14),
      pages("comfort-by-design", 46, 48),
      pages("power-you-control", 76, 81),
      pages("drive-the-transition", 38, 40),
    ],
  }),
  reviewedCard({
    id: "stop-and-escalate-at-hazard-boundaries",
    topics: ["safety_escalation"],
    title: "Know when to stop and escalate",
    answerFirst:
      "Give the immediate protective action first when there is fire, smoke, electrical arcing, burning smell, electric shock, gas or carbon-monoxide concern, structural danger, significant water near electricity, asbestos risk, a damaged lithium battery or acute health symptoms.",
    why:
      "Remote education cannot inspect or make safe a hazardous site, and extra troubleshooting can expose the household to greater harm.",
    decisionQuestions: [
      "Is anyone in immediate danger or experiencing symptoms?",
      "Which emergency service, licensed trade, regulator, health service or specialist has the right authority?",
    ],
    optionalLadder: null,
    safetyBoundary:
      "Move away from immediate danger and call 000 when life, fire or serious injury is at risk; do not instruct the user to touch, open, reconnect or investigate hazardous equipment.",
    relatedOfficialSourceIds: [
      "esv-home-electrical-fault-signs",
      "asbestos-safety-identification-removal",
      "healthdirect-toxic-fume-first-aid",
      "product-safety-recalls",
    ],
    pageReferences: [
      pages("comfort-you-control", 9, 10),
      pages("comfort-by-design", 43, 45),
      pages("comfort-by-design", 55, 57),
      pages("drive-the-transition", 47, 55),
      pages("community-informed-response-guide", 4, 7),
    ],
  }),
  reviewedCard({
    id: "compare-exact-products-on-identical-scope",
    topics: ["product_model_comparison"],
    title: "Compare exact models on identical scope",
    answerFirst:
      "Ask for exact model and variant details, then compare only decision-relevant specifications, standard test evidence, installation scope, compatibility, controls, warranty, service, recalls and total ownership conditions. Explain why a model fits this household rather than ranking brands generally.",
    why:
      "Brand reputation, price and a single headline specification do not establish suitability, installation quality or support for the user's site and use.",
    decisionQuestions: [
      "Which exact models and complete installed scopes are being compared?",
      "Which verified dimensions can pass or fail the household's mandatory requirements?",
    ],
    optionalLadder: {
      good: "Compare exact model sheets on the same capacity and required features.",
      better: "Add independent ratings, recalls, warranty, service and complete installed scope.",
      best: "Use current evidence, site-fit gates, comparable quotes and written acceptance and commissioning criteria.",
    },
    safetyBoundary:
      "A product comparison cannot approve installation, compatibility or regulated work; the responsible licensed person must verify the final design and site.",
    relatedOfficialSourceIds: [
      "energy-rating-product-register",
      "energy-rating-understand-label",
      "accc-consumer-guarantees",
      "product-safety-recalls",
    ],
    pageReferences: [
      pages("community-informed-response-guide", 2, 6),
      pages("power-you-control", 29, 32),
      pages("power-you-control", 88, 92),
      pages("comfort-by-design", 49, 51),
      pages("drive-the-transition", 17, 28),
    ],
  }),
  reviewedCard({
    id: "verify-rebates-tariffs-and-current-facts-live",
    topics: ["rebates_current_data"],
    title: "Verify every current program and market fact",
    answerFirst:
      "Use editorial material only to identify what must be checked. Before stating a rebate, certificate, tariff, price, eligibility rule, deadline, approved product, model specification or compatibility result, retrieve a current official record and state the jurisdiction and as-of date.",
    why:
      "Programs, market offers, product lists and technical compatibility can change after an education guide is prepared.",
    decisionQuestions: [
      "Which jurisdiction, applicant, property, product, activity and date determine eligibility?",
      "What current official source confirms the rule, amount, status and required evidence?",
    ],
    optionalLadder: null,
    safetyBoundary:
      "Do not tell a household to order, sign or begin work based only on an editorial example or an unverified program claim.",
    relatedOfficialSourceIds: [
      "energy-gov-rebates",
      "cer-small-scale-renewable-energy-scheme",
      "veu-water-space-activity-guide-v3-19",
      "nsw-ess-rule-current-2026",
      "nsw-pdrs-rule-current-2026",
    ],
    pageReferences: [
      pages("electric-saul-editorial", 2, 10),
      pages("power-you-control", 23),
      pages("power-you-control", 86, 88),
      pages("drive-the-transition", 56, 58),
      pages("community-informed-response-guide", 6, 7),
    ],
  }),
  reviewedCard({
    id: "label-evidence-assumptions-and-uncertainty",
    topics: ["evidence_uncertainty"],
    title: "Show what is known and what could change",
    answerFirst:
      "Separate measured household data, user-provided facts, current official evidence, manufacturer specifications, calculations, editorial guidance, community experience, assumptions and unresolved questions. Show inputs and ranges, then state what would change the recommendation.",
    why:
      "Visible evidence levels let the household test the reasoning and prevent anecdotes, models or illustrative calculations from being mistaken for certainty.",
    decisionQuestions: [
      "Which statements are observed, supplied, calculated, inferred or still unknown?",
      "How sensitive is the conclusion to the uncertain inputs and future conditions?",
    ],
    optionalLadder: {
      good: "Label facts, assumptions and missing information.",
      better: "Use measured inputs, transparent calculations and low, central and adverse cases.",
      best: "Add current primary evidence, independent review and verification of the completed result.",
    },
    safetyBoundary:
      "Uncertainty about a hazard, regulated requirement or product condition is a reason to stop and seek the appropriate authority, not to assume a safe case.",
    relatedOfficialSourceIds: [
      "nathers-certificate",
      "nathers-how-get-assessment",
      "energy-gov-energy-rating",
      "ncc-current-edition-jurisdiction",
    ],
    pageReferences: [
      pages("community-informed-response-guide", 1, 7),
      pages("home-by-evidence", 24, 26),
      pages("home-by-evidence", 75, 78),
      pages("home-by-evidence", 100, 103),
      pages("comfort-by-design", 71, 73),
      pages("power-you-control", 11, 20),
    ],
  }),
] as const satisfies readonly SurgeAssessorEducationCard[]);

export type SurgeAssessorEducationPromptCard = Readonly<{
  title: string;
  guidance: string;
  reason: string;
  decisionQuestion: string;
  goodBetterBest: SurgeAssessorEducationLadder | null;
  safetyBoundary: string;
  authorityBoundary: "verify_current_facts_with_governed_evidence";
}>;

const EDUCATION_TOPIC_KEYWORDS: Readonly<
  Record<SurgeAssessorEducationTopicId, readonly string[]>
> = Object.freeze({
  identity: ["who are you", "what are you", "wattzun ai", "surge ai", "independent", "provider neutral"],
  answer_first_novice_teaching: ["explain", "understand", "what does", "how does", "why"],
  highest_value_follow_up: ["not sure", "which one", "what should", "recommend", "help me decide"],
  good_better_best: ["good better best", "options", "levels", "cheap", "low cost", "professional"],
  building_diagnostics: ["diagnose", "test", "measure", "assessment", "blower door", "thermal camera", "draught"],
  draught_ventilation_moisture: [
    "draught",
    "draft",
    "ventilation",
    "humidity",
    "condensation",
    "damp",
    "mould",
    "mold",
    "leak",
  ],
  insulation_windows: [
    "insulation",
    "window",
    "glazing",
    "blind",
    "curtain",
    "film",
    "door seal",
    "ceiling",
    "wall",
    "underfloor",
  ],
  heating_cooling: [
    "heating",
    "heater",
    "cooling",
    "air conditioner",
    "reverse cycle",
    "rcac",
    "heat pump",
    "evaporative",
    "temperature",
    "winter comfort",
    "summer comfort",
  ],
  hot_water: ["hot water", "water heater", "shower", "tank", "recovery rate"],
  appliances: [
    "appliance",
    "dryer",
    "clothes dryer",
    "dishwasher",
    "fridge",
    "filter",
    "portable heater",
    "electric blanket",
  ],
  solar: ["solar", "pv", "inverter", "daytime use", "export", "self consumption"],
  battery: ["battery", "storage", "backup", "blackout", "outage"],
  tariffs: ["tariff", "electricity plan", "free power", "off peak", "time of use", "bill"],
  ev_mobility: ["electric vehicle", " ev ", "charger", "charging", "vehicle to grid", "v2g", "car"],
  renter_strata: ["rent", "renter", "tenant", "landlord", "strata", "owners corporation", "apartment"],
  safety_escalation: [
    "danger",
    "fire",
    "shock",
    "sparking",
    "asbestos",
    "gas smell",
    "carbon monoxide",
    "emergency",
    "licensed",
  ],
  product_model_comparison: [
    "model",
    "brand",
    "quote",
    "compare",
    "warranty",
    "noise",
    "specification",
    "installed price",
  ],
  rebates_current_data: [
    "rebate",
    "certificate",
    "stc",
    "veec",
    "esc",
    "prc",
    "discount",
    "eligibility",
    "approved product",
    "trading price",
  ],
  evidence_uncertainty: [
    "evidence",
    "assumption",
    "estimate",
    "range",
    "current",
    "confirmed",
    "accurate",
  ],
});

const FALLBACK_EDUCATION_TOPICS: readonly SurgeAssessorEducationTopicId[] = [
  "answer_first_novice_teaching",
  "highest_value_follow_up",
  "evidence_uncertainty",
  "identity",
  "good_better_best",
];

const phraseScore = (text: string, phrase: string) => {
  const normalizedPhrase = phrase.trim().toLowerCase();
  if (!normalizedPhrase || !text.includes(normalizedPhrase)) return 0;
  return normalizedPhrase.includes(" ") ? 3 : 1;
};

const toPromptCard = (
  card: SurgeAssessorEducationCard,
): SurgeAssessorEducationPromptCard => Object.freeze({
  title: card.title,
  guidance: card.answerFirst,
  reason: card.why,
  decisionQuestion: card.decisionQuestions[0] || "",
  goodBetterBest: card.optionalLadder
    ? Object.freeze({ ...card.optionalLadder })
    : null,
  safetyBoundary: card.safetyBoundary,
  authorityBoundary: "verify_current_facts_with_governed_evidence",
});

export function selectSurgeAssessorEducationForPrompt(
  query: string,
  limit = 4,
): readonly SurgeAssessorEducationPromptCard[] {
  const safeLimit = Math.max(0, Math.min(6, Math.trunc(limit)));
  if (safeLimit === 0) return Object.freeze([]);

  const normalizedQuery = ` ${query.toLowerCase().replace(/\s+/g, " ").trim()} `;
  const ranked = SURGE_ASSESSOR_EDUCATION_CARDS
    .map((card, index) => ({
      card,
      index,
      score: card.topics.reduce(
        (total, topic) => total + EDUCATION_TOPIC_KEYWORDS[topic]
          .reduce((topicTotal, phrase) => topicTotal + phraseScore(normalizedQuery, phrase), 0),
        0,
      ),
    }))
    .filter(({ card }) => card.review.status === "reviewed_for_editorial_use")
    .sort((left, right) => right.score - left.score || left.index - right.index);

  const selected: SurgeAssessorEducationCard[] = [];
  const selectedIds = new Set<string>();
  const add = (card: SurgeAssessorEducationCard | undefined) => {
    if (!card || selected.length >= safeLimit || selectedIds.has(card.id)) return;
    selected.push(card);
    selectedIds.add(card.id);
  };

  for (const candidate of ranked) {
    if (candidate.score <= 0) break;
    add(candidate.card);
  }
  for (const topic of FALLBACK_EDUCATION_TOPICS) {
    add(SURGE_ASSESSOR_EDUCATION_CARDS.find((card) => card.topics.includes(topic)));
  }

  return Object.freeze(selected.map(toPromptCard));
}
