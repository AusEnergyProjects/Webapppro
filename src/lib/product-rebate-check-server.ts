import modelEvidence from "../data/product-rebate-models.json";
import { resolveAddressLocalityTuple } from "./address-localities.mjs";
import {
  exactRebateIdentity, hotWaterVeuActivity, ProductRebateCheckError, wholeCertificateQuantity,
  type ProductRebateCheckRequest, type ProductRebateCheckResult, type ProductRebateProgramResult,
} from "./product-rebate-check.ts";
import { estimateCreditexSresQuote } from "./creditex-sres-calculator-estimator.ts";
import { searchCerSresProducts } from "./creditex-sres-registry-server.ts";
import { CreditexSresRegistryError, CER_SRES_PRODUCT_REGISTER_URL } from "./creditex-sres-registry.ts";
import { CreditexStcEstimateError } from "./creditex-stc-estimator.ts";
import {
  CreditexOfficialProductError, deriveCreditexVeuOfficialProductInputs,
  type CreditexOfficialProductSelection,
} from "./creditex-official-product-registry.ts";
import { searchOfficialProducts, validateOfficialProductSelections } from "./creditex-official-product-registry-server.ts";
import {
  CreditexVeuEstimateError, estimateCreditexVeu, type CreditexVeuProductEvidence,
} from "./creditex-veu-calculator-estimator.ts";
import { CreditexVeuPostcodeError, resolveCreditexVeuPostcode } from "./creditex-veu-postcode-resolver.ts";
import { describeCreditexCalculatorRouteError } from "./creditex-calculator-route-response.ts";

type SolarVictoriaProduct = {
  brand: string; model: string; approvedFrom: string; eligibleTo: string;
  equipmentCategory: string; localContent: boolean;
  localContentAdded: string | null; localContentRemoved: string | null;
};
type RebateModel = {
  id: string; name: string; brand: string; models: string[]; brands: string[];
  modelSourceUrl: string; solarVictoria: SolarVictoriaProduct[]; solarVictoriaLocal: SolarVictoriaProduct[];
};
const models: readonly RebateModel[] = modelEvidence.products;
const VEU_PRODUCT_SOURCE = "https://veu.esc.vic.gov.au/vpr/s/productregister";
const HOUSEHOLD_CONDITION = "This example is for one water heater in a home. Your installer must confirm eligibility.";
const VEU_HISTORY_CONDITION = "This example does not include an earlier hot-water upgrade claim. The company arranging your rebate must check the home's claim history.";

export type ProductRebateDependencies = {
  searchSres: typeof searchCerSresProducts;
  estimateSres: typeof estimateCreditexSresQuote;
  searchVeu: typeof searchOfficialProducts;
  validateVeu: typeof validateOfficialProductSelections;
  estimateVeu: typeof estimateCreditexVeu;
};
const defaultDependencies: ProductRebateDependencies = {
  searchSres: searchCerSresProducts, estimateSres: estimateCreditexSresQuote,
  searchVeu: searchOfficialProducts, validateVeu: validateOfficialProductSelections,
  estimateVeu: estimateCreditexVeu,
};

function result(program: ProductRebateProgramResult["program"], summary: string): ProductRebateProgramResult {
  const sources = program === "sres"
    ? [{ title: "Clean Energy Regulator product register", url: CER_SRES_PRODUCT_REGISTER_URL }]
    : program === "veu"
      ? [{ title: "VEU official product register", url: VEU_PRODUCT_SOURCE }]
      : [
          { title: "Solar Victoria hot-water rebate rules", url: modelEvidence.solarVictoria.rulesSourceUrl },
          { title: "Eligible products", url: modelEvidence.solarVictoria.generalSourceUrl, version: modelEvidence.solarVictoria.sourceDate },
        ];
  return {
    program, label: program === "sres" ? "Federal rebate (STCs)" : program === "veu" ? "Victorian upgrade discount (VEECs)" : "Solar Victoria rebate",
    status: "not-confirmed", quantity: null, unit: null, maximumAmountAud: null,
    summary, conditions: [HOUSEHOLD_CONDITION], sources,
    matchedModel: null, sourceCheckedAt: null, receiptHash: null,
    issueCode: "OFFICIAL_MODEL_NOT_CONFIRMED", retryable: false,
  };
}

function matchesModel(product: { brand: string; model: string }, model: RebateModel): boolean {
  return model.brands.some(brand => exactRebateIdentity(product.brand, brand))
    && model.models.some(name => exactRebateIdentity(product.model, name));
}

function expectedFailure(base: ProductRebateProgramResult, error: unknown): ProductRebateProgramResult {
  const descriptor = describeCreditexCalculatorRouteError(error);
  if (descriptor) return {
    ...base, summary: "The official product data is not ready for this check. No certificate quantity has been assumed.",
    issueCode: descriptor.code,
    retryable: descriptor.code === "CREDITEX_SCHEMA_GUARDS_INSTALLING" || descriptor.code === "OFFICIAL_PRODUCT_FLEET_BUSY",
  };
  if (error instanceof CreditexSresRegistryError || error instanceof CreditexStcEstimateError
      || error instanceof CreditexOfficialProductError || error instanceof CreditexVeuEstimateError
      || error instanceof CreditexVeuPostcodeError) return {
    ...base, summary: error.message, issueCode: error.code,
    retryable: /UNAVAILABLE|STALE|BUSY|CUSTODY|INTEGRITY/.test(error.code),
  };
  throw error;
}

async function federalResult(db: D1Database, request: ProductRebateCheckRequest, model: RebateModel, deps: ProductRebateDependencies) {
  const base = result("sres", "The exact registered model could not be confirmed. Ask the installer to check its STC registration.");
  try {
    const searches = await Promise.all(model.models.map(modelName => deps.searchSres(db, {
      technology: "air_source_heat_pump", installationDate: request.installationDate,
      category: "capacity_at_most_425l", query: modelName,
      limit: 50, allowStaleAcceptedSnapshot: true,
    })));
    // Candidate search may be broad; only full model and reviewed brand identities below can be selected.
    if (searches.some(search => search.products.length >= 50)) {
      return { ...base, issueCode: "OFFICIAL_MODEL_MATCH_OVERFLOW", summary: "The product search needs a narrower official identity before STCs can be confirmed." };
    }
    const candidates = [...new Map(searches.flatMap(search => search.products)
      .filter(product => matchesModel(product, model)).map(product => [product.sourceRecordKey, product])).values()];
    if (candidates.length !== 1) {
      if (candidates.length > 1) base.summary = "More than one exact registration matches this model. Its registration must be confirmed before showing STCs.";
      return base;
    }
    const product = candidates[0];
    const estimate = await deps.estimateSres(db, {
      estimatePurpose: "quote", technology: "air_source_heat_pump",
      installationDate: request.installationDate, postcode: request.postcode,
      productKey: product.sourceRecordKey, unitQuantity: "1",
    }, { allowStaleAcceptedSnapshot: true });
    const resolvedBrand = estimate.resolution?.brand;
    const resolvedModel = estimate.resolution?.model;
    if (typeof resolvedBrand !== "string" || typeof resolvedModel !== "string"
        || !matchesModel({ brand: resolvedBrand, model: resolvedModel }, model)) {
      throw new CreditexSresRegistryError("SRES_PRODUCT_REGISTRY_CHANGED", 409,
        "The registered model changed while this check was running. Try the exact model again.");
    }
    return {
      ...base, status: "calculated" as const, quantity: wholeCertificateQuantity(estimate.output.quantity), unit: "STC" as const,
      issueCode: null, retryable: false,
      summary: "Calculated from the exact registered model, your postcode zone and planned installation year.",
      matchedModel: `${product.brand} ${product.model}`,
      sourceCheckedAt: typeof estimate.resolution?.registryLastCheckedAt === "string" ? estimate.resolution.registryLastCheckedAt : null,
      receiptHash: estimate.resolvedReceiptHash || estimate.receiptHash,
      conditions: [...base.conditions, "This is a certificate quantity, not a guaranteed customer discount. Product, installation and certificate-assignment requirements still apply."],
      sources: [...base.sources, { title: "Registered postcode-zone source", url: String(estimate.resolution?.postcodeSourceUrl || CER_SRES_PRODUCT_REGISTER_URL) }],
    };
  } catch (error) {
    return expectedFailure(base, error);
  }
}

function veuProductEvidence(selection: CreditexOfficialProductSelection): CreditexVeuProductEvidence {
  const productId = selection.attributes.veuProductId;
  const activityCategory = selection.attributes.veuProductCategoryNumber;
  if (typeof productId !== "string" || !productId || typeof activityCategory !== "string"
      || (selection.approvalStatus !== "approved" && selection.approvalStatus !== "legacy")
      || selection.registryCode !== "veu-approved-products" || !/^[a-f0-9]{64}$/.test(selection.sourceSha256)) {
    throw new CreditexOfficialProductError("OFFICIAL_PRODUCT_REGISTRY_INTEGRITY_FAILED", 503,
      "The approved model's registration could not be verified.");
  }
  return {
    registry: "VEU", productId, activityCategory,
    status: selection.approvalStatus === "approved" ? "Approved" : "Legacy",
    effectiveFrom: selection.eligibleFrom, effectiveTo: selection.eligibleTo,
    sourceSnapshotHash: `sha256:${selection.sourceSha256}`,
  };
}

async function victorianResult(db: D1Database, request: ProductRebateCheckRequest, model: RebateModel, deps: ProductRebateDependencies) {
  const base = result("veu", "The exact VEU model and its approved performance values could not be confirmed.");
  if (request.state !== "VIC") return { ...base, status: "not-applicable" as const, issueCode: null, summary: "VEU is a Victorian programme. Your selected suburb is outside Victoria." };
  const activity = hotWaterVeuActivity(request.currentSystem);
  if (!activity) return {
    ...base, status: request.currentSystem === "new-installation" ? "not-applicable" as const : "not-confirmed" as const,
    summary: request.currentSystem === "new-installation"
      ? "This VEU example covers replacement of an existing electric-storage or gas/LPG water heater."
      : "This existing system needs a provider assessment. We have not assumed an electric-storage or gas/LPG replacement.",
  };
  base.conditions.push(VEU_HISTORY_CONDITION);
  try {
    const postcode = resolveCreditexVeuPostcode({ postcode: request.postcode, installationDate: request.installationDate });
    const searches = await Promise.all(model.models.map(modelName => deps.searchVeu(db, {
      productKind: "veu_water_heater", installationDate: request.installationDate,
      veuActivityCode: activity, query: modelName, limit: 100,
    }, { allowStaleAcceptedSnapshot: true })));
    if (searches.some(search => search.products.length >= 100 || search.matchCount > 100)) {
      return { ...base, issueCode: "OFFICIAL_MODEL_MATCH_OVERFLOW", summary: "The product search needs a narrower official identity before VEECs can be confirmed." };
    }
    const candidates = [...new Map(searches.flatMap(search => search.products)
      .filter(product => matchesModel(product, model)).map(product => [product.id, product])).values()];
    if (candidates.length !== 1) {
      if (candidates.length > 1) base.summary = "More than one VEU approval matches this model. Its exact approved configuration must be confirmed.";
      return base;
    }
    const validated = await deps.validateVeu(db, {
      installationDate: request.installationDate, requiredKinds: ["veu_water_heater"],
      selectedProductIds: { veu_water_heater: candidates[0].id },
    }, { allowStaleAcceptedSnapshot: true });
    const selected = validated.selections[0];
    if (validated.selections.length !== 1 || selected.id !== candidates[0].id || !matchesModel(selected, model)) {
      throw new CreditexOfficialProductError("OFFICIAL_PRODUCT_REGISTRY_INTEGRITY_FAILED", 503,
        "The approved model changed while this check was running. Try the exact model again.");
    }
    const inputs = deriveCreditexVeuOfficialProductInputs(activity, {
      premises: "residential", prior_relevant_period_water_heater_products: "0",
      geography: postcode.geography, climate_zone: postcode.climateZone,
    }, validated.selections);
    // Part 3 has no geography wire input. All documentary gates remain quote-mode assumptions.
    if (activity === "3C") delete inputs.geography;
    const estimate = deps.estimateVeu({
      activityCode: activity, installationDate: request.installationDate,
      estimatePurpose: "quote", inputs, product: veuProductEvidence(selected),
    });
    const registry = searches.find(search => search.products.some(product => product.id === selected.id))?.registry;
    return {
      ...base, status: "calculated" as const, quantity: wholeCertificateQuantity(estimate.output.wholeCertificates), unit: "VEEC" as const,
      issueCode: null, retryable: false,
      summary: `Calculated for replacing ${activity === "1D" ? "an electric hot-water tank" : "mains or bottled gas hot water"} with this exact approved heat pump.`,
      matchedModel: `${selected.brand} ${selected.model}`, sourceCheckedAt: registry?.lastCheckedAt || null,
      receiptHash: estimate.receiptHash,
      conditions: [...base.conditions,
        "The building must be at least two years old, and the old heater must meet the replacement requirements.",
        "The customer must contribute at least $200 including GST per installed product. It cannot be rebated or reimbursed.",
        "The company arranging your rebate must confirm the required advice, removal of the old system, your contribution and warranty.",
      ],
      sources: [...base.sources, { title: estimate.officialSourceTitle, url: estimate.officialSourceUrl, version: estimate.specificationVersion }, { title: postcode.source.title, url: postcode.source.sourceUrl, version: postcode.source.specificationVersion }],
    };
  } catch (error) {
    return expectedFailure(base, error);
  }
}

function solarVictoriaResult(request: ProductRebateCheckRequest, model: RebateModel): ProductRebateProgramResult {
  const base = result("solar-victoria", "This exact model was not confirmed on the reviewed Solar Victoria list. Ask an authorised retailer to verify it.");
  base.sourceCheckedAt = modelEvidence.checkedAt;
  if (request.state !== "VIC") return { ...base, status: "not-applicable", issueCode: null, summary: "Solar Victoria hot-water rebates are for eligible Victorian homes." };
  if (request.currentSystem === "new-installation") return { ...base, status: "not-applicable", issueCode: null, summary: "This rebate requires an existing home and replacement of an existing hot-water system at least three years old." };
  if (request.installationDate < "2026-07-01" || request.installationDate > "2027-06-30") {
    return { ...base, issueCode: "SOLAR_VICTORIA_RULE_PERIOD_UNCONFIRMED", summary: "This planned date needs a separate check of Solar Victoria's rules. The reviewed example covers 1 July 2026 to 30 June 2027." };
  }
  const eligible = model.solarVictoria.filter(row => matchesModel(row, model)
    && row.equipmentCategory === "Water heater - Heat pump"
    && row.approvedFrom <= request.installationDate && row.eligibleTo >= request.installationDate);
  if (eligible.length !== 1) return base;
  const row = eligible[0];
  const local = model.solarVictoriaLocal.some(local => exactRebateIdentity(local.brand, row.brand)
    && exactRebateIdentity(local.model, row.model) && local.approvedFrom <= request.installationDate
    && local.eligibleTo >= request.installationDate && local.localContent
    && local.localContentAdded !== null && local.localContentAdded <= request.installationDate
    && (local.localContentRemoved === null || local.localContentRemoved > request.installationDate));
  return {
    ...base, status: "potential", issueCode: null, retryable: false, maximumAmountAud: local ? modelEvidence.solarVictoria.rules.localContentCap : modelEvidence.solarVictoria.rules.standardCap,
    matchedModel: `${row.brand} ${row.model}`,
    summary: "You may qualify for this rebate. The amount depends on your household eligibility and final installer quote.",
    conditions: [...base.conditions,
      "The owner must live in an existing home valued below $3 million, with combined owner taxable income below $150,000.",
      "The existing hot-water system must be at least three years old. Previous Solar Homes hot-water or battery rebates at this address must be checked.",
      "The rebate is limited to 50% of eligible system cost after STC and VEEC discounts, up to the applicable cap.",
      "Use an authorised retailer and get approval before installation. Approval has an installation deadline. Rules may change before your planned date.",
    ],
    sources: local ? [...base.sources, { title: "Locally made eligible products", url: modelEvidence.solarVictoria.localSourceUrl, version: modelEvidence.solarVictoria.sourceDate }] : base.sources,
  };
}

export async function checkProductRebates(db: D1Database, request: ProductRebateCheckRequest, options: {
  now?: Date; dependencies?: Partial<ProductRebateDependencies>;
} = {}): Promise<ProductRebateCheckResult> {
  const model = models.find(product => product.id === request.productId);
  if (!model) throw new ProductRebateCheckError("Choose a current heat-pump hot-water product from this catalogue.");
  const locality = resolveAddressLocalityTuple(request);
  if (!locality) throw new ProductRebateCheckError("Choose the matching suburb and state for your postcode.");
  const exactRequest = { ...request, ...locality };
  const dependencies = { ...defaultDependencies, ...options.dependencies };
  const [sres, veu] = await Promise.all([
    federalResult(db, exactRequest, model, dependencies), victorianResult(db, exactRequest, model, dependencies),
  ]);
  return {
    ok: true, productId: model.id, productName: model.name,
    checkedAt: (options.now || new Date()).toISOString(), location: locality,
    installationDate: exactRequest.installationDate, currentSystem: exactRequest.currentSystem,
    results: [sres, veu, solarVictoriaResult(exactRequest, model)],
  };
}
