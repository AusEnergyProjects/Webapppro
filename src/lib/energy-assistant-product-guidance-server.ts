import { residentialStateFromPostcode } from "./australian-postcodes.mjs";
import {
  CERTIFICATE_PRICE_SOURCE_URL,
  loadCertificatePriceDataset,
} from "./certificate-prices-server.ts";
import { estimateCreditexSresQuote } from "./creditex-sres-calculator-estimator.ts";
import {
  CREDITEX_OFFICIAL_PRODUCT_KINDS,
  officialProductKindLabel,
  type CreditexOfficialProductKind,
} from "./creditex-official-product-registry.ts";
import { searchOfficialProducts } from "./creditex-official-product-registry-server.ts";
import type { EnergyAssistantAnswer, EnergyAssistantCitation } from "./energy-assistant.ts";
import type { SurgeModelRequest } from "./energy-assistant-model.ts";

const PRODUCT_INTENT = /\b(?:rebate|discount|certificate|stc|veec|esc|prc|model|brand|quote|compare|eligible|approved|buy|replace|system|appliance|product)\b/i;
const PUBLIC_PRODUCT_KINDS = CREDITEX_OFFICIAL_PRODUCT_KINDS.filter((kind) => (
  !kind.startsWith("veu_")
  && !kind.startsWith("wa_")
)) as CreditexOfficialProductKind[];

const CATEGORY_ALIASES: Partial<Record<CreditexOfficialProductKind, RegExp>> = {
  sres_solar_water_heater: /\bsolar\s+(?:hot\s+water|water\s+heater)\b/i,
  sres_air_source_heat_pump: /\b(?:heat\s*pump\s+(?:hot\s+water|water\s+heater)|hot\s+water\s+heat\s*pump|hot\s+water|hws)\b/i,
  pv_module: /\b(?:solar\s+panel|pv\s+module|photovoltaic)\b/i,
  inverter: /\b(?:solar\s+)?inverter\b/i,
  cec_battery: /\b(?:home\s+)?(?:battery|energy\s+storage)\b/i,
  air_conditioner: /\b(?:air\s*conditioner|reverse\s*cycle|split\s+system|rcac)\b/i,
  close_control_air_conditioner: /\bclose\s+control\s+air\s*conditioner\b/i,
  electric_water_heater: /\belectric\s+(?:hot\s+water|water\s+heater)\b/i,
  gas_water_heater: /\bgas\s+(?:hot\s+water|water\s+heater)\b/i,
  refrigerator_freezer: /\b(?:refrigerator|fridge|freezer)\b/i,
  television: /\b(?:television|\btv\b)\b/i,
  clothes_dryer: /\b(?:clothes|heat\s*pump)\s+dryer\b/i,
  pool_pump: /\bpool\s+pump\b/i,
  electric_motor: /\belectric\s+motor\b/i,
  commercial_refrigerator: /\bcommercial\s+(?:refrigerator|refrigeration)\b/i,
  chiller: /\bchiller\b/i,
};

const SOLAR_VICTORIA_HOT_WATER = {
  reviewedOn: "2026-08-23",
  standardMaximum: "$1,000",
  locallyMadeMaximum: "$1,400",
};

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

const CER_STC_CALCULATOR_URL = "https://cer.gov.au/schemes/renewable-energy-target/small-scale-renewable-energy-scheme/small-scale-technology-certificates/calculate-small-scale-technology-certificate-entitlements";
const SOLAR_VICTORIA_HOT_WATER_URL = "https://www.solar.vic.gov.au/hot-water-rebate";

type SearchProducts = typeof searchOfficialProducts;
type EstimateSres = typeof estimateCreditexSresQuote;
type LoadPrices = typeof loadCertificatePriceDataset;

export type SurgeProductGuidanceDependencies = {
  searchProducts?: SearchProducts;
  estimateSres?: EstimateSres;
  loadPrices?: LoadPrices;
};

function normalise(value: unknown) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function conversationText(request: SurgeModelRequest) {
  return [
    ...request.recentTurns.map((turn) => turn.content),
    request.message,
  ].join("\n");
}

function productKindFor(text: string): CreditexOfficialProductKind | null {
  for (const kind of PUBLIC_PRODUCT_KINDS) {
    const alias = CATEGORY_ALIASES[kind];
    if (alias?.test(text)) return kind;
  }
  const comparable = normalise(text);
  return PUBLIC_PRODUCT_KINDS.find((kind) => comparable.includes(normalise(officialProductKindLabel(kind)))) || null;
}

function productKindForRequest(request: SurgeModelRequest) {
  const currentKind = productKindFor(request.message);
  if (currentKind) return currentKind;
  for (let index = request.recentTurns.length - 1; index >= 0; index -= 1) {
    const previousKind = productKindFor(request.recentTurns[index].content);
    if (previousKind) return previousKind;
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

function capacityLitres(text: string) {
  return [...new Set([...text.matchAll(/\b(\d{2,4})\s*(?:l|litre|litres)\b/gi)].map((match) => match[1]))];
}

function productLabel(product: { brand?: string | null; manufacturer?: string | null; model?: string | null }) {
  return [product.brand || product.manufacturer, product.model].filter(Boolean).join(" ").trim();
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
  return `${lines.join("; ")}. These are gross market references and can move like a share price. A customer's actual discount is normally lower after registry, compliance, administration and aggregator costs. Those deductions vary, so I will not guess them.`;
}

function certificateCodes(kind: CreditexOfficialProductKind, state: string) {
  const codes: string[] = [];
  if (["sres_air_source_heat_pump", "sres_solar_water_heater"].includes(kind)) {
    codes.push("STC");
  }
  if (state === "VIC" && ["sres_air_source_heat_pump", "sres_solar_water_heater"].includes(kind)) {
    codes.push("VEEC");
  }
  return codes;
}

function reviewDue(now: Date, days = 30) {
  return new Date(now.getTime() + days * 86_400_000).toISOString().slice(0, 10);
}

function citation(
  id: string,
  source: { title: string; publisher: string; url: string },
  now: Date,
  options: Partial<Pick<EnergyAssistantCitation, "sourceTier" | "jurisdiction" | "lastChecked" | "storagePolicy">> = {},
): EnergyAssistantCitation {
  return {
    id,
    title: source.title,
    publisher: source.publisher,
    url: source.url,
    sourceTier: options.sourceTier || "primary_official",
    jurisdiction: options.jurisdiction || "Australia",
    effectiveFrom: null,
    effectiveTo: null,
    lastChecked: options.lastChecked || now.toISOString().slice(0, 10),
    reviewDue: reviewDue(now),
    storagePolicy: options.storagePolicy || "local_factual_summary",
    stale: false,
  };
}

function officialProductSource(kind: CreditexOfficialProductKind) {
  if (kind in OFFICIAL_PRODUCT_SOURCES) {
    return OFFICIAL_PRODUCT_SOURCES[kind as keyof typeof OFFICIAL_PRODUCT_SOURCES];
  }
  return GEMS_PRODUCT_SOURCE;
}

function uniqueCitations(citations: readonly EnergyAssistantCitation[]) {
  return [...new Map(citations.map((item) => [item.id, item] as const)).values()];
}

function answer(
  directAnswer: string,
  question: string,
  status: EnergyAssistantAnswer["status"],
  confidence: EnergyAssistantAnswer["confidence"],
  citations: readonly EnergyAssistantCitation[],
): EnergyAssistantAnswer {
  return {
    directAnswer,
    practicalSteps: [],
    nextAction: question,
    status,
    citations: uniqueCitations(citations),
    assumptions: [],
    confidence,
    suggestedQuestions: [question],
    toolActions: [],
    sourceBoundary: "Current official product registry, governed certificate calculator and current certificate market reference evidence only.",
  };
}

export function createSurgeGroundedProductGuidanceResolver(
  db: D1Database,
  dependencies: SurgeProductGuidanceDependencies = {},
) {
  const searchProducts = dependencies.searchProducts || searchOfficialProducts;
  const estimateSres = dependencies.estimateSres || estimateCreditexSresQuote;
  const loadPrices = dependencies.loadPrices || loadCertificatePriceDataset;

  return async (request: SurgeModelRequest): Promise<EnergyAssistantAnswer | null> => {
    const text = conversationText(request);
    const kind = productKindForRequest(request);
    if (!kind || !PRODUCT_INTENT.test(text)) return null;

    const installationDate = request.asOf.toISOString().slice(0, 10);
    const initial = await searchProducts(db, { productKind: kind, installationDate, limit: 100 }, { now: request.asOf });
    const brands = mentionedFacets(text, initial.facets.brands);
    const brandMatches: Array<{
      brand: string;
      model: string;
      branded: Awaited<ReturnType<SearchProducts>>;
      exact: Awaited<ReturnType<SearchProducts>> | null;
    }> = [];
    for (const brand of brands) {
      const branded = await searchProducts(db, { productKind: kind, installationDate, brand, limit: 100 }, { now: request.asOf });
      const model = mentionedFacets(text, branded.facets.models, 1)[0] || "";
      const exact = model
        ? await searchProducts(db, { productKind: kind, installationDate, brand, model, limit: 10 }, { now: request.asOf })
        : null;
      brandMatches.push({ brand, model, branded, exact });
    }
    const litres = capacityLitres(text);
    const candidatePool = brandMatches.length
      ? brandMatches.flatMap((match) => match.exact?.products.length ? match.exact.products : match.branded.products)
      : initial.products;
    const capacityCandidates = candidatePool.filter((product) => (
      !litres.length || litres.some((litre) => normalise(JSON.stringify(product)).includes(litre))
    ));
    const candidates = [...new Map((capacityCandidates.length ? capacityCandidates : candidatePool)
      .map((product) => [product.sourceRecordKey, product] as const)).values()].slice(0, 4);
    const exactProducts = [...new Map(brandMatches
      .flatMap((match) => match.exact?.products || [])
      .map((product) => [product.sourceRecordKey, product] as const)).values()];
    const allNamedModelsResolved = brands.length > 0
      && brandMatches.every((match) => Boolean(match.model) && Boolean(match.exact?.products.length));
    const postcode = postcodeFor(request, text);
    const state = stateFor(request, postcode);
    const relevantCertificateCodes = certificateCodes(kind, state);
    const prices = relevantCertificateCodes.length
      ? await loadPrices(db, { now: request.asOf }).catch(() => null)
      : null;
    const market = prices ? marketReference(prices, relevantCertificateCodes) : "";
    const category = officialProductKindLabel(kind);
    const possibleModels = candidates.map(productLabel).filter(Boolean);
    const citations: EnergyAssistantCitation[] = [citation(
      `surge-product-registry-${kind}`,
      officialProductSource(kind),
      request.asOf,
    )];

    let direct = `I found the current official ${category.toLowerCase()} registry, which covers every listed brand rather than a fixed brand shortlist.`;
    if (possibleModels.length) {
      direct += ` Possible current matches from the details supplied are ${possibleModels.join(", ")}. Treat these as candidates until the exact model number is confirmed.`;
    } else if (brands.length) {
      direct += ` I found the named brand or brands in the current registry, but the information supplied is not enough to identify one exact approved model for each option.`;
    }
    if (brands.length > 1) {
      direct += ` I can compare official approval and governed certificate support across these brands. A defensible comparison of noise, recovery, retained capacity or efficiency needs the verified specification sheet for each exact model, so I will not invent brand differences.`;
    }

    if (state === "VIC" && ["sres_air_source_heat_pump", "sres_solar_water_heater"].includes(kind)) {
      direct += ` Solar Victoria currently offers up to ${SOLAR_VICTORIA_HOT_WATER.standardMaximum} for an eligible hot-water replacement, or up to ${SOLAR_VICTORIA_HOT_WATER.locallyMadeMaximum} for an eligible locally made product. Household, property, product and installation eligibility still apply. This was reviewed on ${SOLAR_VICTORIA_HOT_WATER.reviewedOn}.`;
      citations.push(citation("surge-solar-victoria-hot-water", {
        title: "Hot water rebate",
        publisher: "Solar Victoria",
        url: SOLAR_VICTORIA_HOT_WATER_URL,
      }, request.asOf, { jurisdiction: "Victoria" }));
    }

    if (exactProducts.length === 1 && postcode && ["sres_air_source_heat_pump", "sres_solar_water_heater"].includes(kind)) {
      const product = exactProducts[0];
      const estimate = await estimateSres(db, {
        estimatePurpose: "quote",
        technology: kind === "sres_air_source_heat_pump" ? "air_source_heat_pump" : "solar_water_heater",
        installationDate,
        postcode,
        productKey: product.sourceRecordKey,
        unitQuantity: "1",
      }, { now: request.asOf });
      direct += ` For ${productLabel(product)}, the governed quote calculator resolves ${estimate.output.quantity} STCs for postcode ${postcode} on the selected installation date. This is a quote estimate, not final eligibility or certificate creation. An exact VEEC quantity also needs the governed Victorian activity and installation scenario, so I will not infer it from brand or tank size alone.`;
      citations.push(citation("surge-cer-stc-entitlements", {
        title: "Calculate small-scale technology certificate entitlements",
        publisher: "Clean Energy Regulator",
        url: CER_STC_CALCULATOR_URL,
      }, request.asOf));
    } else if (certificateCodes(kind, state).length) {
      direct += ` Exact certificate quantities need the exact approved model plus the installation inputs used by the governed calculator. I will not estimate them from a brand name, tank size or marketing description alone.`;
    }
    if (market) {
      direct += ` ${market}`;
      citations.push(citation("surge-certificate-market-reference", {
        title: "Certificate prices",
        publisher: "Demand Manager",
        url: CERTIFICATE_PRICE_SOURCE_URL,
      }, request.asOf, {
        sourceTier: "independent_link_only",
        lastChecked: prices?.source.lastCheckedAt.slice(0, 10),
        storagePolicy: "link_only",
      }));
    } else if (relevantCertificateCodes.length && prices?.source.status === "stale") {
      direct += ` I could not verify a current certificate market reference, so I will not present an older trade as current.`;
    }

    const question = !postcode && /\b(?:rebate|discount|certificate|stc|veec|esc|prc)\b/i.test(text)
      ? "What is the property's postcode?"
      : !brands.length
        ? "What brand and exact model number appear on the quote or product label?"
        : !allNamedModelsResolved
          ? "What exact model number appears on each quote or product label?"
          : brands.length > 1
            ? "What are the complete installed quotes and verified specification sheets for these exact models?"
            : "What is the complete installed quote after every claimed rebate and certificate discount?";
    return answer(
      direct,
      question,
      allNamedModelsResolved ? "answered" : "needs_context",
      allNamedModelsResolved ? "high" : "medium",
      citations,
    );
  };
}
