import {
  currentOfficialProductGuidanceSources,
  currentReviewedCertificatePathwayCoverage,
  currentReviewedPracticalTips,
  isCurrentReviewedProductGuidanceCategory,
  resolveReviewedProductGuidanceIntent,
  reviewedCertificatePathwaysFor,
  reviewedProductGuidanceCategoryForProductKind,
  type ReviewedProductComparisonDimension,
  type ReviewedProductGuidanceCategory,
} from "../data/energy-assistant-reviewed-product-guidance.ts";
import type { EnergyAssistantKnowledgeSource } from "../data/energy-assistant-knowledge.ts";
import {
  SURGE_ASSESSOR_EDUCATION_CARDS,
  type SurgeAssessorEducationCard,
} from "../data/surge-assessor-education.ts";
import { residentialStateFromPostcode } from "./australian-postcodes.mjs";
import {
  CERTIFICATE_PRICE_SOURCE_URL,
  loadCertificatePriceDataset,
} from "./certificate-prices-server.ts";
import { estimateCreditexSresQuote } from "./creditex-sres-calculator-estimator.ts";
import type { CreditexOfficialProductKind } from "./creditex-official-product-registry.ts";
import { searchOfficialProducts } from "./creditex-official-product-registry-server.ts";
import {
  isThreePhaseSupplyUpgradeQuestion,
  isSurgeServiceOrCompetingQuoteRequest,
  type EnergyAssistantAnswer,
  type EnergyAssistantCitation,
} from "./energy-assistant.ts";
import type { SurgeModelRequest } from "./energy-assistant-model.ts";
import {
  classifySurgeConversationTurn,
  surgeConversationDecisionContext,
} from "./energy-assistant-conversation.ts";

const CERTIFICATE_INTENT = /\b(?:rebate|discount|certificate|stc|veec|esc|prc|incentive|support)\b/i;
const COMPARISON_INTENT = /\b(?:compare|comparison|versus|vs\.?|better|best|quieter|faster|efficien(?:t|cy)|specification|specs?)\b/i;
const BROAD_EDUCATIONAL_TOPIC_INTENT = /^\s*(?:ok(?:ay)?[,.]?\s*)?(?:(?:tell|teach)\s+me\s+about|explain(?:\s+to\s+me)?|help\s+me\s+understand)\s+(?:home\s+)?(?:insulation|glazing|draughts?|draught\s+(?:proofing|control)|hot\s+water|heat\s+pumps?|heating(?:\s+and\s+cooling)?|air\s+conditioning|solar|home\s+batter(?:y|ies)|ev\s+charging|electric\s+vehicle\s+charging|induction\s+cooking|electric\s+cooking|appliances?)\s*(?:please)?[?.!]*\s*$/i;
const RETAIL_PLAN_DECISION_INTENT = /\b(?:electricity|energy|retailer)\s+plans?\b|\btariffs?\b|\bfeed[- ]?in\b|\bFIT\b|\bdaily\s+(?:supply\s+)?(?:charge|rate)\b|\b(?:free\s+hours?|hours?\s+free)\b|\b(?:import|export|usage)\s+rates?\b/i;
const ORDINARY_HEATING_CHOICE_INTENT = /\b(?:most\s+efficient|efficient|best|cheapest|running\s+cost|cost\s+less)\b/i;
const COLD_HOME_INTENT = /\b(?:cold|freez(?:e|ing)|chilly)\b/i;
const COMBINATION_FOLLOW_UP = /^\s*(?:i\s+(?:think|feel|reckon)\s+)?(?:it(?:'?s|\s+is)\s+)?(?:a\s+)?(?:combination|mix|both)(?:\s+of\s+(?:them|those))?[.!?]*\s*$/i;

const PRODUCT_KIND_ALIASES: readonly [CreditexOfficialProductKind, RegExp][] = [
  ["sres_solar_water_heater", /\bsolar\s+(?:hot\s+water|water\s+heater)\b/i],
  ["sres_air_source_heat_pump", /\b(?:heat\s*pump\s+(?:hot\s+water|water\s+heater)|hot\s+water\s+heat\s*pump)\b/i],
  ["electric_water_heater", /\belectric\s+(?:hot\s+water|water\s+heater)\b/i],
  ["gas_water_heater", /\bgas\s+(?:hot\s+water|water\s+heater)\b/i],
  ["pv_module", /\b(?:solar\s+panel|pv\s+module|photovoltaic\s+module)\b/i],
  ["inverter", /\b(?:solar\s+)?inverter\b/i],
  ["cec_battery", /\b(?:home\s+)?(?:battery|energy\s+storage)\b/i],
  ["close_control_air_conditioner", /\bclose\s+control\s+air\s*conditioner\b/i],
  ["air_conditioner", /\b(?:air\s*conditioner|reverse\s*cycle|split\s+system|multi[- ]?(?:head|split)|wall[- ]?mounted split|rcac)\b/i],
  ["refrigerator_freezer", /\b(?:refrigerator|fridge|freezer)\b/i],
  ["clothes_dryer", /\b(?:clothes|heat\s*pump)\s+dryer\b/i],
  ["television", /\b(?:television|tv)\b/i],
];

const OFFICIAL_PRODUCT_SOURCES = {
  pv_module: {
    title: "CEC approved PV modules",
    publisher: "Clean Energy Regulator",
    url: "https://cer.gov.au/document/cec-approved-pv-modules-0",
  },
  inverter: {
    title: "CEC approved inverters",
    publisher: "Clean Energy Regulator",
    url: "https://cer.gov.au/document/cec-approved-inverters-0",
  },
  battery: {
    title: "Approved products data",
    publisher: "Clean Energy Council",
    url: "https://cleanenergycouncil.org.au/industry-programs/data",
  },
  cec_battery: {
    title: "Approved products data",
    publisher: "Clean Energy Council",
    url: "https://cleanenergycouncil.org.au/industry-programs/data",
  },
  sres_air_source_heat_pump: {
    title: "Register of solar water heaters",
    publisher: "Clean Energy Regulator",
    url: "https://cer.gov.au/schemes/renewable-energy-target/small-scale-renewable-energy-scheme/small-scale-renewable-energy-systems/solar-water-heaters/register-solar-water-heaters",
  },
  sres_solar_water_heater: {
    title: "Register of solar water heaters",
    publisher: "Clean Energy Regulator",
    url: "https://cer.gov.au/schemes/renewable-energy-target/small-scale-renewable-energy-scheme/small-scale-renewable-energy-systems/solar-water-heaters/register-solar-water-heaters",
  },
} as const satisfies Partial<Record<CreditexOfficialProductKind, {
  title: string;
  publisher: string;
  url: string;
}>>;

const GEMS_PRODUCT_SOURCE = {
  title: "Registered appliance and equipment data",
  publisher: "GEMS Regulator",
  url: "https://www.energyrating.gov.au/about-us/gems-regulator/registered-appliance-and-equipment-data",
} as const;

type SearchProducts = typeof searchOfficialProducts;
type SearchResult = Awaited<ReturnType<SearchProducts>>;
type SearchProduct = SearchResult["products"][number];
type RegistryStatus = SearchResult["registry"];
type EstimateSres = typeof estimateCreditexSresQuote;
type LoadPrices = typeof loadCertificatePriceDataset;

export type SurgeProductGuidanceDependencies = {
  searchProducts?: SearchProducts;
  estimateSres?: EstimateSres;
  loadPrices?: LoadPrices;
};

type BrandMatch = {
  brand: string;
  branded: SearchResult;
  modelMatches: Array<{
    model: string;
    result: SearchResult;
  }>;
};

type ComparableSpecification = {
  dimension: ReviewedProductComparisonDimension;
  attributeKey: string;
  condition: string;
  unit: string;
  values: Array<{ label: string; value: string }>;
};

function normalise(value: unknown) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function isoDay(value: string | Date) {
  const parsed = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new Error("A valid guidance date is required.");
  return parsed.toISOString().slice(0, 10);
}

function conversationText(request: SurgeModelRequest) {
  return [...request.recentTurns.map((turn) => turn.content), request.message].join("\n");
}

function categoryForRequest(request: SurgeModelRequest) {
  if (isSurgeServiceOrCompetingQuoteRequest(request.message)) return null;
  if (BROAD_EDUCATIONAL_TOPIC_INTENT.test(request.message)) return null;
  if (ORDINARY_HEATING_CHOICE_INTENT.test(request.message)
    && (/\b(?:portable|plug[- ]?in)\s+(?:electric\s+)?heaters?\b/i.test(request.message)
      || (/\breverse[- ]cycle\b/i.test(request.message) && /\bgas\b/i.test(request.message)))) return null;
  // A product mentioned as background must not take over a bill or retailer-plan decision.
  // For example, "ducted heating" can explain seasonal use without making heating the topic.
  if (RETAIL_PLAN_DECISION_INTENT.test(request.message)) return null;
  if (isThreePhaseSupplyUpgradeQuestion(request.message)) return null;
  if (COLD_HOME_INTENT.test(request.message)
    && /\b(?:home|house|room|winter|warm)\b/i.test(request.message)) {
    return resolveReviewedProductGuidanceIntent("cold home draught insulation");
  }
  const current = resolveReviewedProductGuidanceIntent(request.message);
  if (current) return current;
  const turnIntent = classifySurgeConversationTurn(
    request.message,
    request.continuation,
    request.recentTurns,
  );
  if (turnIntent === "new_question"
    || turnIntent === "topic_change"
    || turnIntent === "correction_and_topic_change") return null;
  return resolveReviewedProductGuidanceIntent(surgeConversationDecisionContext(
    request.message,
    request.continuation,
    request.recentTurns,
  ));
}

function productKindForText(
  text: string,
  category: ReviewedProductGuidanceCategory,
) {
  return PRODUCT_KIND_ALIASES.find(([kind, pattern]) => (
    category.productKinds.some((candidate) => candidate === kind)
    && pattern.test(text)
  ))?.[0] || null;
}

function productKindForRequest(
  request: SurgeModelRequest,
  category: ReviewedProductGuidanceCategory,
) {
  const current = productKindForText(request.message, category);
  if (current) return current;
  for (let index = request.recentTurns.length - 1; index >= 0; index -= 1) {
    const previous = productKindForText(request.recentTurns[index].content, category);
    if (previous) return previous;
  }
  return null;
}

function postcodeFor(request: SurgeModelRequest, text: string) {
  const fact = request.planContext?.facts.find((item) => /postcode/i.test(item.key));
  return String(fact?.value || text.match(/\b\d{4}\b/)?.[0] || "").trim();
}

function stateFor(request: SurgeModelRequest, postcode: string) {
  const fact = request.planContext?.facts.find((item) => /(?:state|territory)/i.test(item.key));
  return String(fact?.value || (postcode ? residentialStateFromPostcode(postcode) : "") || "").toUpperCase();
}

function mentionedFacets(
  text: string,
  options: readonly { value: string; label: string; count: number }[],
  limit = 4,
) {
  const comparable = ` ${normalise(text)} `;
  return [...new Map([...options]
    .sort((left, right) => normalise(right.label).length - normalise(left.label).length)
    .filter((option) => comparable.includes(` ${normalise(option.label)} `))
    .map((option) => [option.value, option] as const)).values()]
    .slice(0, limit)
    .map((option) => option.value);
}

function capacityValues(text: string) {
  return [...new Set([...text.matchAll(/\b(\d+(?:\.\d+)?)\s*(l|litres?|kg|kwh|kw)\b/gi)]
    .map((match) => `${Number(match[1])}:${normalise(match[2])}`))];
}

function productLabel(product: Pick<SearchProduct, "brand" | "manufacturer" | "model">) {
  return [product.brand || product.manufacturer, product.model].filter(Boolean).join(" ").trim();
}

function productMatchesCapacity(
  product: SearchProduct,
  category: ReviewedProductGuidanceCategory,
  requested: readonly string[],
) {
  if (!requested.length) return true;
  const capacityDimensions = category.comparisonDimensions.filter((dimension) => (
    /capacity|volume|power/i.test(dimension.id)
  ));
  return capacityDimensions.some((dimension) => dimension.attributeKeys.some((key) => {
    const value = product.attributes[key];
    if (typeof value !== "number" || !Number.isFinite(value)) return false;
    const unit = normalise(dimension.unit || key.match(/(litres|kg|kwh|kw)$/i)?.[1] || "");
    return requested.some((candidate) => {
      const [requestedValue, requestedUnit] = candidate.split(":");
      const unitsMatch = unit === requestedUnit
        || (unit === "l" && requestedUnit.startsWith("litre"))
        || (unit === "litres" && requestedUnit === "l");
      return unitsMatch && Number(requestedValue) === value;
    });
  }));
}

function assertCurrentRegistry(result: SearchResult) {
  const status = result.registry;
  if (
    status.status !== "current"
    || !status.snapshotId
    || !status.sourceSha256
    || !status.lastCheckedAt
    || !Number.isFinite(new Date(status.lastCheckedAt).getTime())
  ) {
    throw new Error("Current official product registry metadata is unavailable.");
  }
}

function currentProduct(product: SearchProduct, installationDate: string) {
  return Boolean(
    product.sourceRecordKey
    && product.approvalStatus
    && (!product.eligibleFrom || product.eligibleFrom <= installationDate)
    && (!product.eligibleTo || product.eligibleTo >= installationDate),
  );
}

function exactProduct(result: SearchResult, installationDate: string) {
  if (result.matchCount !== 1 || result.products.length !== 1) return null;
  return currentProduct(result.products[0], installationDate) ? result.products[0] : null;
}

function scalar(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (typeof value === "string" && value.trim()) return value.trim();
  return null;
}

function sharedAttribute(products: readonly SearchProduct[], keys: readonly string[]) {
  for (const key of keys) {
    const values = products.map((product) => scalar(product.attributes[key]));
    if (values.every((value) => value !== null)) return { key, values: values as string[] };
  }
  return null;
}

function sharedTestCondition(
  products: readonly SearchProduct[],
  dimension: ReviewedProductComparisonDimension,
  attributeKey: string,
) {
  const conditionKeys = [
    `${attributeKey}TestCondition`,
    `${dimension.id}TestCondition`,
    `${attributeKey}TestStandard`,
    `${dimension.id}TestStandard`,
  ];
  for (const key of conditionKeys) {
    const conditions = products.map((product) => scalar(product.attributes[key]));
    if (
      conditions.every((condition) => condition !== null)
      && conditions.every((condition) => normalise(condition) === normalise(conditions[0]))
    ) return conditions[0] as string;
  }
  return null;
}

function sharedUnit(
  products: readonly SearchProduct[],
  dimension: ReviewedProductComparisonDimension,
  attributeKey: string,
) {
  const declared = products.map((product) => scalar(product.attributes[`${attributeKey}Unit`]));
  if (declared.some((unit) => unit !== null)) {
    if (
      declared.some((unit) => unit === null)
      || declared.some((unit) => normalise(unit) !== normalise(declared[0]))
      || (dimension.unit && normalise(declared[0]) !== normalise(dimension.unit))
    ) return null;
    return declared[0] as string;
  }
  return dimension.unit || "published rating";
}

function comparableSpecifications(
  category: ReviewedProductGuidanceCategory,
  products: readonly SearchProduct[],
) {
  if (products.length < 2) return [];
  return category.comparisonDimensions.flatMap((dimension): ComparableSpecification[] => {
    const attribute = sharedAttribute(products, dimension.attributeKeys);
    if (!attribute) return [];
    const condition = sharedTestCondition(products, dimension, attribute.key);
    const unit = sharedUnit(products, dimension, attribute.key);
    if (!condition || !unit) return [];
    return [{
      dimension,
      attributeKey: attribute.key,
      condition,
      unit,
      values: products.map((product, index) => ({
        label: productLabel(product),
        value: attribute.values[index],
      })),
    }];
  });
}

function requestedComparisonDimensionIds(
  text: string,
  category: ReviewedProductGuidanceCategory,
) {
  const comparable = normalise(text);
  const aliases: Record<string, RegExp> = {
    noise: /\b(?:noise|sound|quiet|quieter)\b/i,
    recovery: /\b(?:recovery|recover|fast|faster|speed)\b/i,
    efficiency: /\b(?:efficiency|efficient|energy use|running cost|star rating)\b/i,
    seasonal_efficiency: /\b(?:efficiency|efficient|seasonal|energy use|running cost|star rating)\b/i,
    annual_energy: /\b(?:annual energy|energy use|running cost|efficient|efficiency)\b/i,
    climate: /\b(?:climate|cold weather|ambient temperature)\b/i,
    operating_range: /\b(?:operating range|temperature|cold weather|hot weather)\b/i,
    warranty: /\b(?:warranty|service|repair)\b/i,
    backup: /\b(?:backup|blackout|outage)\b/i,
  };
  return category.comparisonDimensions
    .filter((dimension) => (
      aliases[dimension.id]?.test(text)
      || comparable.includes(normalise(dimension.consumerLabel))
    ))
    .map((dimension) => dimension.id);
}

function knowledgeCitation(source: EnergyAssistantKnowledgeSource): EnergyAssistantCitation {
  return {
    id: source.id,
    title: source.title,
    publisher: source.publisher,
    url: source.url,
    sourceTier: "primary_official",
    jurisdiction: source.jurisdiction,
    effectiveFrom: source.effectiveFrom,
    effectiveTo: source.effectiveTo,
    lastChecked: source.reviewedAt,
    reviewDue: source.reviewDue,
    storagePolicy: source.storagePolicy,
    stale: false,
  };
}

function officialProductSource(kind: CreditexOfficialProductKind) {
  return OFFICIAL_PRODUCT_SOURCES[kind as keyof typeof OFFICIAL_PRODUCT_SOURCES]
    || GEMS_PRODUCT_SOURCE;
}

function registryReviewDue(status: RegistryStatus) {
  const checkedAt = new Date(status.lastCheckedAt || "");
  return new Date(
    checkedAt.getTime() + status.freshnessWindowHours * 60 * 60 * 1000,
  ).toISOString().slice(0, 10);
}

function registryCitation(
  kind: CreditexOfficialProductKind,
  status: RegistryStatus,
): EnergyAssistantCitation {
  const source = officialProductSource(kind);
  return {
    id: `surge-product-registry-${kind}`,
    title: source.title,
    publisher: source.publisher,
    url: source.url,
    sourceTier: "primary_official",
    jurisdiction: "Australia",
    effectiveFrom: null,
    effectiveTo: null,
    lastChecked: isoDay(status.lastCheckedAt || ""),
    reviewDue: registryReviewDue(status),
    storagePolicy: "local_factual_summary",
    stale: false,
  };
}

function marketCitation(lastCheckedAt: string): EnergyAssistantCitation {
  const checkedDay = isoDay(lastCheckedAt);
  return {
    id: "surge-certificate-market-reference",
    title: "Certificate prices",
    publisher: "Demand Manager",
    url: CERTIFICATE_PRICE_SOURCE_URL,
    sourceTier: "independent_link_only",
    jurisdiction: "Australia",
    effectiveFrom: null,
    effectiveTo: null,
    lastChecked: checkedDay,
    reviewDue: checkedDay,
    storagePolicy: "link_only",
    stale: false,
  };
}

function uniqueCitations(citations: readonly EnergyAssistantCitation[]) {
  return [...new Map(citations.map((item) => [item.id, item] as const)).values()];
}

function reviewedProductComparisonMethod(): SurgeAssessorEducationCard {
  const card = SURGE_ASSESSOR_EDUCATION_CARDS.find((item) => (
    item.id === "compare-exact-products-on-identical-scope"
    && item.topics.includes("product_model_comparison")
  ));
  if (
    !card
    || card.review.status !== "reviewed_for_editorial_use"
    || card.currentFactBoundary !== "verify_with_current_official_sources"
  ) {
    throw new Error("Approved product comparison education is unavailable.");
  }
  return card;
}

function answer(input: {
  directAnswer: string;
  practicalSteps: readonly string[];
  question: string;
  status: EnergyAssistantAnswer["status"];
  confidence: EnergyAssistantAnswer["confidence"];
  citations: readonly EnergyAssistantCitation[];
  sourceBoundary: string;
}): EnergyAssistantAnswer {
  return {
    directAnswer: input.directAnswer,
    practicalSteps: [...input.practicalSteps],
    nextAction: input.question,
    status: input.status,
    citations: uniqueCitations(input.citations),
    assumptions: [],
    confidence: input.confidence,
    suggestedQuestions: [input.question],
    toolActions: [],
    sourceBoundary: input.sourceBoundary,
  };
}

function failClosedAnswer(
  category: ReviewedProductGuidanceCategory,
  asOf: Date,
): EnergyAssistantAnswer {
  const sources = currentOfficialProductGuidanceSources(category.sourceIds, asOf);
  const question = "Can you try again after the current official product evidence is available?";
  return answer({
    directAnswer: `I matched your ${category.consumerLabel.toLowerCase()} question, but the governed product evidence could not be verified. I will not fall back to unreviewed product claims, guessed certificate quantities or guessed rebate amounts.`,
    practicalSteps: [],
    question,
    status: "source_review_required",
    confidence: "low",
    citations: sources.map(knowledgeCitation),
    sourceBoundary: "The governed product resolver matched this request and failed closed because its required current evidence was unavailable.",
  });
}

function comparisonSentence(specification: ComparableSpecification) {
  const values = specification.values
    .map((item) => `${item.label}: ${item.value} ${specification.unit}`)
    .join("; ");
  return `${specification.dimension.consumerLabel}: ${values}. Same published test condition: ${specification.condition}.`;
}

function marketReference(
  dataset: Awaited<ReturnType<LoadPrices>>,
  codes: readonly string[],
) {
  if (dataset.source.status !== "current") return "";
  const lines = dataset.certificates
    .filter((series) => codes.includes(series.code) && series.latest)
    .map((series) => {
      const latest = series.latest!;
      return `${series.code} last reported at $${(latest.priceCents / 100).toFixed(2)} on ${latest.tradedOn}`;
    });
  if (!lines.length) return "";
  return `${lines.join("; ")}. These are gross market references, not a customer discount. I will not multiply a certificate quantity by a trade price and call the result the customer's discount. Registry, compliance, administration and aggregation deductions may apply, but this evidence does not verify their amounts, so I will not guess fees.`;
}

async function resolveMatchedGuidance(
  db: D1Database,
  request: SurgeModelRequest,
  category: ReviewedProductGuidanceCategory,
  dependencies: Required<SurgeProductGuidanceDependencies>,
) {
  if (!isCurrentReviewedProductGuidanceCategory(category, request.asOf)) {
    throw new Error("Reviewed product guidance is not current.");
  }

  const text = conversationText(request);
  const decisionText = surgeConversationDecisionContext(
    request.message,
    request.continuation,
    request.recentTurns,
  );
  const installationDate = request.asOf.toISOString().slice(0, 10);
  const certificateIntent = CERTIFICATE_INTENT.test(decisionText);
  const comparisonIntent = COMPARISON_INTENT.test(decisionText);
  const postcode = postcodeFor(request, text);
  const state = stateFor(request, postcode);
  const kind = productKindForRequest(request, category);
  const tips = currentReviewedPracticalTips(category.id, request.asOf);
  const pathwayCoverage = currentReviewedCertificatePathwayCoverage(category.id, request.asOf);
  const applicablePathways = state
    ? reviewedCertificatePathwaysFor({ categoryId: category.id, jurisdiction: state, asOf: request.asOf })
    : pathwayCoverage;
  const sourceIds = new Set([
    ...category.sourceIds,
    ...tips.flatMap((tip) => tip.sourceIds),
    ...applicablePathways.flatMap((pathway) => pathway.sourceIds),
  ]);
  const citations: EnergyAssistantCitation[] = currentOfficialProductGuidanceSources(
    [...sourceIds],
    request.asOf,
  ).map(knowledgeCitation);
  const practicalSteps = tips.slice(0, 3).map((tip) => (
    tip.safetyBoundary ? `${tip.guidance} ${tip.safetyBoundary}` : tip.guidance
  ));
  const comparisonMethod = reviewedProductComparisonMethod();
  const dimensions = category.comparisonDimensions.map((dimension) => dimension.consumerLabel);
  const coldHomeIntent = category.id === "insulation_glazing_draughts"
    && COLD_HOME_INTENT.test(text);
  const combinationFollowUp = coldHomeIntent && COMBINATION_FOLLOW_UP.test(request.message);

  let direct = combinationFollowUp
    ? "If it feels like a combination, start with the two biggest heat-loss paths: draughts and the ceiling. Use a door snake and removable seals on obvious gaps, then have the ceiling insulation checked for thin, missing or disturbed sections and safe clearances. Keep using reverse-cycle heating in occupied rooms while you work through those fixes. If the home is still cold after that, look at close-fitting window coverings and whether the heater is sized and positioned well."
    : coldHomeIntent
      ? "Cold homes usually lose heat through a mix of draughts, thin or patchy ceiling insulation and poorly insulated windows. Start with the cheap checks: use a door snake and removable seals on obvious gaps, then check whether the ceiling insulation is continuous and in good condition. If you have reverse-cycle heating, use it in occupied rooms and clean the filters. Fixing the largest heat-loss paths before buying a bigger heater often improves comfort and lowers running costs."
      : comparisonIntent
    ? `To compare ${category.consumerLabel.toLowerCase()} properly, provide the exact model number and complete installed scope for each option. The useful comparison points are ${dimensions.join(", ")}. A brand name, price or headline specification alone does not establish which option fits the home.`
    : certificateIntent
      ? `For ${category.consumerLabel.toLowerCase()}, rebates and certificates depend on the location, existing equipment, exact proposed product and installation details. I will only give an exact quantity when every required input is verified.`
      : `For ${category.consumerLabel.toLowerCase()}, start here: ${practicalSteps[0] || "describe the problem you want to solve and the current equipment or building condition."}`;
  let initial: SearchResult | null = null;
  let brands: string[] = [];
  let brandMatches: BrandMatch[] = [];
  let candidates: SearchProduct[] = [];
  let exactProducts: SearchProduct[] = [];
  let allNamedModelsResolved = false;
  let comparable: ComparableSpecification[] = [];
  let comparisonVerified = !comparisonIntent;

  if (kind) {
    const registryCategory = reviewedProductGuidanceCategoryForProductKind(kind);
    if (!registryCategory || registryCategory.id !== category.id) {
      throw new Error("Product kind is outside the reviewed category.");
    }
    initial = await dependencies.searchProducts(
      db,
      { productKind: kind, installationDate, limit: 100 },
      { now: request.asOf },
    );
    assertCurrentRegistry(initial);
    brands = mentionedFacets(text, initial.facets.brands);
    brandMatches = await Promise.all(brands.map(async (brand): Promise<BrandMatch> => {
      const branded = await dependencies.searchProducts(
        db,
        { productKind: kind, installationDate, brand, limit: 100 },
        { now: request.asOf },
      );
      assertCurrentRegistry(branded);
      const models = mentionedFacets(text, branded.facets.models);
      const modelMatches = await Promise.all(models.map(async (model) => {
        const result = await dependencies.searchProducts(
          db,
          { productKind: kind, installationDate, brand, model, limit: 10 },
          { now: request.asOf },
        );
        assertCurrentRegistry(result);
        return { model, result };
      }));
      return { brand, branded, modelMatches };
    }));

    const requestedCapacity = capacityValues(request.message);
    const candidatePool = brandMatches.length
      ? brandMatches.flatMap((match) => match.branded.products)
      : [];
    candidates = [...new Map(candidatePool
      .filter((product) => currentProduct(product, installationDate))
      .filter((product) => productMatchesCapacity(product, category, requestedCapacity))
      .map((product) => [product.sourceRecordKey, product] as const)).values()].slice(0, 6);
    exactProducts = [...new Map(brandMatches
      .flatMap((match) => match.modelMatches)
      .flatMap((match) => {
        const product = exactProduct(match.result, installationDate);
        return product ? [product] : [];
      })
      .map((product) => [product.sourceRecordKey, product] as const)).values()];
    const namedModelCount = brandMatches.reduce((count, match) => count + match.modelMatches.length, 0);
    allNamedModelsResolved = brands.length > 0
      && namedModelCount > 0
      && brandMatches.every((match) => (
        match.modelMatches.length > 0
        && match.modelMatches.every((model) => Boolean(exactProduct(model.result, installationDate)))
      ));
    comparable = comparableSpecifications(category, exactProducts);
    citations.push(registryCitation(kind, initial.registry));
    direct += ` The official registry snapshot was checked on ${isoDay(initial.registry.lastCheckedAt || "")} and is current for the selected installation date.`;

    if (candidates.length && !allNamedModelsResolved) {
      direct += ` Possible registry candidates from the brand and capacity supplied are ${candidates.map(productLabel).join(", ")}. Brand and capacity are candidate filters only, not exact model identification.`;
    } else if (brands.length && !allNamedModelsResolved) {
      direct += " I found the named brand in the current registry, but I could not resolve one current approval record for every exact model.";
    }
    if (allNamedModelsResolved) {
      direct += ` Exact current registry matches are ${exactProducts.map(productLabel).join(", ")}.`;
    }
  }

  if (comparisonIntent) {
    const requestedDimensionIds = requestedComparisonDimensionIds(request.message, category);
    const comparableIds = new Set(comparable.map((item) => item.dimension.id));
    comparisonVerified = requestedDimensionIds.length > 0
      ? requestedDimensionIds.every((id) => comparableIds.has(id))
      : comparable.length > 0;
    if (comparable.length) {
      direct += ` Verified like-for-like model facts are ${comparable.map(comparisonSentence).join(" ")}`;
    }
    const unverified = category.comparisonDimensions
      .filter((dimension) => !comparableIds.has(dimension.id))
      .filter((dimension) => (
        requestedDimensionIds.length === 0
        || requestedDimensionIds.includes(dimension.id)
      ))
      .map((dimension) => dimension.consumerLabel);
    if (!comparisonVerified || unverified.length) {
      const scope = unverified.length ? ` for ${unverified.join(", ")}` : "";
      direct += ` I cannot verify a like-for-like model performance difference${scope} from the current reviewed evidence. Exact model numbers, the same units and the same published test conditions are required before saying one option is quieter, faster, more efficient or better.`;
    }
  }

  const pathwayCodes = [...new Set(applicablePathways.map((pathway) => pathway.code))];
  if (certificateIntent && pathwayCodes.length) {
    const place = state ? `For ${state}` : "Depending on the state or territory";
    direct += ` ${place}, the currently maintained pathways to check are ${pathwayCodes.join(", ")}. That does not by itself confirm eligibility, a certificate quantity or the customer's discount.`;
  }

  let sresQuantityResolved = false;
  if (
    certificateIntent
    && exactProducts.length === 1
    && allNamedModelsResolved
    && postcode
    && (kind === "sres_air_source_heat_pump" || kind === "sres_solar_water_heater")
  ) {
    const product = exactProducts[0];
    const estimate = await dependencies.estimateSres(db, {
      estimatePurpose: "quote",
      technology: kind === "sres_air_source_heat_pump" ? "air_source_heat_pump" : "solar_water_heater",
      installationDate,
      postcode,
      productKey: product.sourceRecordKey,
      unitQuantity: "1",
    }, { now: request.asOf });
    const quantity = String(estimate.output.quantity || "");
    if (!/^\d+$/.test(quantity)) throw new Error("The governed STC quantity is invalid.");
    direct += ` For ${productLabel(product)}, the existing governed quote calculator resolves ${quantity} STCs for postcode ${postcode} and installation date ${installationDate}. This is a non-claimable quote estimate, not final eligibility, certificate creation or a customer discount.`;
    sresQuantityResolved = true;
  } else if (certificateIntent) {
    direct += " Exact quantities require every input declared by the applicable governed calculator. I will not infer STCs, VEECs, ESCs or PRCs from a brand, capacity, product family or advertised discount.";
  }

  if (certificateIntent && state) {
    const marketCodes = pathwayCodes.filter((code) => code !== "REBATE");
    if (marketCodes.length) {
      const prices = await dependencies.loadPrices(db, { now: request.asOf }).catch(() => null);
      const market = prices ? marketReference(prices, marketCodes) : "";
      if (market && prices) {
        direct += ` ${market}`;
        citations.push(marketCitation(prices.source.lastCheckedAt));
      } else {
        direct += " A current certificate trade reference could not be verified, so I will not state a market price or derive a customer discount.";
      }
    }
  }

  let question = combinationFollowUp
    ? "Which feels worse: cold air near doors and windows, or rooms that stay cold even when the heater is running?"
    : coldHomeIntent
      ? "Do you notice more cold air around doors and windows, or does the whole house stay cold?"
      : comparisonIntent
    ? comparisonMethod.decisionQuestions[1]
    : category.contextQuestions[0] || comparisonMethod.decisionQuestions[0];
  let status: EnergyAssistantAnswer["status"] = "answered";
  let confidence: EnergyAssistantAnswer["confidence"] = "high";
  if (certificateIntent && !postcode) {
    question = "What is the property's postcode?";
    status = "needs_context";
    confidence = "medium";
  } else if ((comparisonIntent || certificateIntent) && kind && !allNamedModelsResolved) {
    question = "What exact brand and model number appear on each quote or product label?";
    status = "needs_context";
    confidence = "medium";
  } else if (comparisonIntent && !comparisonVerified) {
    question = "Can you provide the verified specification sheet for each exact model?";
    status = "needs_context";
    confidence = "medium";
  } else if (certificateIntent && !sresQuantityResolved) {
    question = category.contextQuestions.find((item) => /replaced|existing/i.test(item))
      || "What existing equipment and exact proposed product are involved?";
    status = "needs_context";
    confidence = "medium";
  }

  if (certificateIntent && status === "needs_context") {
    const jurisdictionNames: Readonly<Record<string, string>> = {
      ACT: "the ACT",
      NSW: "New South Wales",
      NT: "the Northern Territory",
      QLD: "Queensland",
      SA: "South Australia",
      TAS: "Tasmania",
      VIC: "Victoria",
      WA: "Western Australia",
    };
    const certificateCodes = pathwayCodes.filter((code) => code !== "REBATE");
    const place = jurisdictionNames[state] || state || "the property's jurisdiction";
    const concise: string[] = certificateCodes.length
      ? [`Yes, ${category.consumerLabel.toLowerCase()} may qualify for ${certificateCodes.join(" and ")} support in ${place}, but the amount is not fixed.`]
      : [`For ${category.consumerLabel.toLowerCase()} in ${place}, directory coverage alone does not establish that a rebate is available or that the household qualifies. Current programme availability and eligibility still need checking against the live official rules.`];
    if (candidates.length && !allNamedModelsResolved) {
      concise.push(`Possible current registry candidates are ${candidates.map(productLabel).join(", ")}. Brand and capacity are candidate filters only, not exact model identification.`);
    } else if (allNamedModelsResolved) {
      concise.push(`Exact current registry matches are ${exactProducts.map(productLabel).join(", ")}.`);
    }
    const currentMarket = direct.match(/\b(?:STC|VEEC|ESC|PRC) last reported at \$\d+(?:\.\d{2})? on \d{4}-\d{2}-\d{2}(?:; (?:STC|VEEC|ESC|PRC) last reported at \$\d+(?:\.\d{2})? on \d{4}-\d{2}-\d{2})*\./)?.[0];
    if (currentMarket) concise.push(`${currentMarket} This is a gross market reference before provider costs, not the customer's discount.`);
    concise.push("I will not infer STCs, VEECs, ESCs or PRCs from a brand, capacity or product family.");
    concise.push(`To check the amount, ${question.replace(/^[A-Z]/, (letter) => letter.toLowerCase()).replace(/\?$/, ".")}`);
    direct = concise.join(" ");
    practicalSteps.length = 0;
  }

  const registryBoundary = initial
    ? ` Official product registry snapshot ${initial.registry.snapshotId} was checked at ${initial.registry.lastCheckedAt}.`
    : "";
  return answer({
    directAnswer: direct,
    practicalSteps,
    question,
    status,
    confidence,
    citations,
    sourceBoundary: `Approved reviewed category guidance and current official sources only.${registryBoundary} Reviewed assessor education is used only for the comparison method and follow-up selection. It does not establish current eligibility, product specifications, certificate quantities, prices or compatibility. Quantities and amounts come only from callable governed resolvers or reported source data.`,
  });
}

export function createSurgeGroundedProductGuidanceResolver(
  db: D1Database,
  dependencies: SurgeProductGuidanceDependencies = {},
) {
  const resolvedDependencies: Required<SurgeProductGuidanceDependencies> = {
    searchProducts: dependencies.searchProducts || searchOfficialProducts,
    estimateSres: dependencies.estimateSres || estimateCreditexSresQuote,
    loadPrices: dependencies.loadPrices || loadCertificatePriceDataset,
  };

  return async (request: SurgeModelRequest): Promise<EnergyAssistantAnswer | null> => {
    const category = categoryForRequest(request);
    if (!category) return null;
    try {
      return await resolveMatchedGuidance(db, request, category, resolvedDependencies);
    } catch {
      return failClosedAnswer(category, request.asOf);
    }
  };
}
