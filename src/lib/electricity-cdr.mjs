import {
  ELECTRICITY_TARIFF_SCHEMA_VERSION,
  sha256,
  tariffSourceHash,
  validateElectricityTariff,
} from "./electricity-tariff-validation.mjs";
import { resolveCustomerPlanUrl, retailerWebsite } from "./retailer-links.mjs";

export const ELECTRICITY_CDR_DIRECTORY_URL =
  "https://jxeeno.github.io/energy-cdr-prd-endpoints/energy-prd-endpoints.json";

const DETAIL_API_VERSION = "3";
const MAX_LIST_PAGES = 5;
const PAGE_SIZE = 1000;

export function validateElectricityPlanQuery(postcode, customerType) {
  const normalizedType = String(customerType || "").toUpperCase();
  if (!/^\d{4}$/.test(String(postcode || ""))) {
    return { ok: false, error: "A valid 4 digit postcode is required." };
  }
  if (!['RESIDENTIAL', 'BUSINESS'].includes(normalizedType)) {
    return { ok: false, error: "Customer type must be RESIDENTIAL or BUSINESS." };
  }
  return { ok: true, postcode: String(postcode), customerType: normalizedType };
}

export function safeCdrBase(value) {
  try {
    const url = new URL(String(value || ""));
    const host = url.hostname.toLowerCase();
    if (url.protocol !== "https:" || url.username || url.password) return null;
    if (host === "localhost" || host.endsWith(".localhost") || host === "::1") return null;
    if (/^127\./.test(host) || /^10\./.test(host) || /^169\.254\./.test(host) || /^192\.168\./.test(host)) return null;
    const private172 = host.match(/^172\.(\d{1,3})\./);
    if (private172 && Number(private172[1]) >= 16 && Number(private172[1]) <= 31) return null;
    return url.origin + url.pathname.replace(/\/$/, "");
  } catch {
    return null;
  }
}

export function postcodeMatches(postcode, values) {
  if (!Array.isArray(values)) return false;
  const numericPostcode = Number(postcode);
  return values.some((item) => {
    const value = String(item).trim();
    if (value === String(postcode)) return true;
    const range = value.split("-").map((part) => Number(part.trim()));
    return range.length === 2
      && range.every(Number.isFinite)
      && numericPostcode >= range[0]
      && numericPostcode <= range[1];
  });
}

export function normalizeDistributor(name) {
  if (!name) return null;
  const value = String(name);
  const normalized = value.toLowerCase();
  if (normalized.includes("ausgrid")) return "Ausgrid";
  if (normalized.includes("endeavour")) return "Endeavour Energy";
  if (normalized.includes("essential")) return "Essential Energy";
  if (normalized.includes("evo") || normalized.includes("actew")) return "Evoenergy";
  if (normalized.includes("energex")) return "Energex";
  if (normalized.includes("ergon")) return "Ergon Energy";
  if (normalized.includes("sa power") || normalized.includes("sapn")) return "SA Power Networks";
  if (normalized.includes("tasnetworks") || normalized.includes("aurora")) return "TasNetworks";
  if (normalized.includes("citipower")) return "CitiPower";
  if (normalized.includes("powercor")) return "Powercor";
  if (normalized.includes("jemena")) return "Jemena";
  if (normalized.includes("united")) return "United Energy";
  if (normalized.includes("ausnet") || normalized.includes("sp ausnet")) return "AusNet Services";
  return value;
}

export function normalizeRetailerDirectory(payload) {
  const records = Array.isArray(payload?.data) ? payload.data : payload;
  if (!Array.isArray(records)) return [];
  return records
    .filter((record) => Array.isArray(record?.industries) && record.industries.includes("energy"))
    .map((record) => {
      const base = safeCdrBase(record.productReferenceDataBaseUri || record.publicBaseUri);
      return {
      name: String(record.brandName || "Retailer"),
      logo: record.logoUri || null,
      base,
      retailerUrl: retailerWebsite(base, record.brandName),
      };
    })
    .filter((record) => record.base);
}

export function normalizePlanSummary(plan, retailer, postcode, customerType) {
  if (!plan || !retailer?.base || !plan.planId) return null;
  if (plan.customerType && String(plan.customerType).toUpperCase() !== customerType) return null;
  if (plan.fuelType && !["ELECTRICITY", "DUAL"].includes(String(plan.fuelType).toUpperCase())) return null;
  const geography = plan.geography || {};
  if (postcodeMatches(postcode, geography.excludedPostcodes)) return null;
  if (!Array.isArray(geography.includedPostcodes) || !geography.includedPostcodes.length) return null;
  if (!postcodeMatches(postcode, geography.includedPostcodes)) return null;
  const now = Date.now();
  const effectiveFrom = plan.effectiveFrom ? Date.parse(plan.effectiveFrom) : null;
  const effectiveTo = plan.effectiveTo ? Date.parse(plan.effectiveTo) : null;
  if (effectiveFrom != null && (!Number.isFinite(effectiveFrom) || effectiveFrom > now)) return null;
  if (effectiveTo != null && (!Number.isFinite(effectiveTo) || effectiveTo <= now)) return null;
  const information = plan.additionalInformation || {};
  return {
    planId: String(plan.planId),
    name: String(plan.displayName || plan.planId),
    brand: String(plan.brandName || retailer.name),
    logo: retailer.logo || null,
    base: retailer.base,
    retailerUrl: retailer.retailerUrl || null,
    type: plan.type || "MARKET",
    distributors: [...new Set((geography.distributors || []).map(normalizeDistributor).filter(Boolean))],
    app: plan.applicationUri || null,
    info: information.overviewUri || information.pricingUri || null,
    effectiveFrom: plan.effectiveFrom || null,
    effectiveTo: plan.effectiveTo || null,
    lastUpdated: Number.isFinite(Date.parse(plan.lastUpdated)) ? plan.lastUpdated : null,
  };
}

export function normalizePlanDetail(summary, payload) {
  const data = payload?.data || payload;
  const contract = data?.electricityContract;
  if (!contract) return null;
  const information = data.additionalInformation || {};
  return {
    ...summary,
    type: data.type || summary.type || "MARKET",
    contract,
    link: resolveCustomerPlanUrl(
      [summary.app, information.overviewUri, summary.info, information.pricingUri],
      summary.retailerUrl,
    ),
    eligibility: Array.isArray(contract.eligibility) ? contract.eligibility : [],
    fees: Array.isArray(contract.fees) ? contract.fees.length : 0,
    effectiveFrom: data.effectiveFrom || summary.effectiveFrom || null,
    effectiveTo: data.effectiveTo || summary.effectiveTo || null,
    lastUpdated: Number.isFinite(Date.parse(data.lastUpdated)) ? data.lastUpdated : summary.lastUpdated,
  };
}

async function fetchJson(url, { fetchImpl, version, timeoutMs }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      headers: version ? { "x-v": version, "x-min-v": version } : {},
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) throw new Error("Retailer returned HTTP " + response.status);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function mapWithConcurrency(items, limit, task) {
  const results = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      try {
        results[index] = { ok: true, value: await task(items[index], index) };
      } catch (error) {
        results[index] = { ok: false, error };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

export async function loadElectricityPlans({
  postcode,
  customerType,
  fetchImpl = fetch,
  timeoutMs = 15000,
}) {
  const query = validateElectricityPlanQuery(postcode, customerType);
  if (!query.ok) throw new Error(query.error);
  const directoryPayload = await fetchJson(ELECTRICITY_CDR_DIRECTORY_URL, { fetchImpl, timeoutMs });
  const retailers = normalizeRetailerDirectory(directoryPayload);
  if (!retailers.length) throw new Error("No electricity retailers were present in the CDR directory.");

  const listResults = await mapWithConcurrency(retailers, 10, async (retailer) => {
    const plans = [];
    let page = 1;
    let totalPages = 1;
    while (page <= totalPages && page <= MAX_LIST_PAGES) {
      const url = retailer.base + "/cds-au/v1/energy/plans?fuelType=ELECTRICITY&effective=CURRENT&page-size=" + PAGE_SIZE + "&page=" + page;
      const payload = await fetchJson(url, { fetchImpl, version: "1", timeoutMs });
      const batch = Array.isArray(payload?.data?.plans) ? payload.data.plans : [];
      plans.push(...batch);
      totalPages = Math.max(1, Number(payload?.meta?.totalPages || 1));
      if (!batch.length) break;
      page += 1;
    }
    return plans.map((plan) => normalizePlanSummary(plan, retailer, query.postcode, query.customerType)).filter(Boolean);
  });

  const summaries = listResults.flatMap((result) => result.ok ? result.value : []);
  const distinctSummaries = [...new Map(summaries.map((plan) => [plan.base + "|" + plan.planId, plan])).values()];
  const marketSummaries = distinctSummaries.filter((plan) => plan.type !== "REGULATED");
  const detailResults = await mapWithConcurrency(marketSummaries, 12, async (summary) => {
    const payload = await fetchJson(
      summary.base + "/cds-au/v1/energy/plans/" + encodeURIComponent(summary.planId),
      { fetchImpl, version: DETAIL_API_VERSION, timeoutMs },
    );
    const detail = normalizePlanDetail(summary, payload);
    if (!detail) throw new Error("Electricity contract missing from plan detail.");
    const validation = validateElectricityTariff(detail.contract);
    if (!validation.valid) {
      const error = new Error("Electricity tariff failed validation.");
      error.code = "INVALID_TARIFF";
      error.validationErrors = validation.errors;
      throw error;
    }
    const tariffHash = sha256({
      planId: detail.planId,
      brand: detail.brand,
      type: detail.type,
      distributors: detail.distributors,
      effectiveFrom: detail.effectiveFrom,
      effectiveTo: detail.effectiveTo,
      lastUpdated: detail.lastUpdated,
      contract: detail.contract,
    });
    return {
      ...detail,
      tariffHash,
      validation: {
        schemaVersion: validation.schemaVersion,
        limitations: validation.limitations,
      },
    };
  });

  const plans = detailResults.filter((result) => result.ok).map((result) => result.value);
  const listSourcesSucceeded = listResults.filter((result) => result.ok).length;
  const detailPlansSucceeded = plans.length;
  const invalidResults = detailResults.filter((result) => !result.ok && result.error?.code === "INVALID_TARIFF");
  const validationFailures = {};
  invalidResults.forEach((result) => {
    (result.error.validationErrors || ["Unknown validation failure"]).forEach((message) => {
      const category = String(message).replace(/tariffPeriod\[\d+\]/g, "tariffPeriod[]");
      validationFailures[category] = (validationFailures[category] || 0) + 1;
    });
  });
  const updatedTimes = plans
    .map((plan) => Date.parse(plan.lastUpdated))
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  const eligibilityTypes = {};
  plans.forEach((plan) => {
    (plan.eligibility || []).forEach((condition) => {
      const type = String(condition?.type || "UNSPECIFIED").toUpperCase();
      eligibilityTypes[type] = (eligibilityTypes[type] || 0) + 1;
    });
  });
  const retailerCoverage = retailers.map((retailer, retailerIndex) => {
    const summaryIndexes = marketSummaries
      .map((summary, index) => summary.base === retailer.base ? index : -1)
      .filter((index) => index >= 0);
    const results = summaryIndexes.map((index) => detailResults[index]);
    return {
      retailer: retailer.name,
      listAvailable: Boolean(listResults[retailerIndex]?.ok),
      candidatePlans: summaryIndexes.length,
      detailsPassed: results.filter((result) => result?.ok).length,
      detailsRejected: results.filter((result) => !result?.ok && result?.error?.code === "INVALID_TARIFF").length,
      detailsUnavailable: results.filter((result) => !result?.ok && result?.error?.code !== "INVALID_TARIFF").length,
    };
  });
  const source = {
    directorySource: ELECTRICITY_CDR_DIRECTORY_URL,
    planDataAuthority: "Australian Energy Regulator and Victorian government product reference data",
    listApiVersion: "1",
    detailApiVersion: DETAIL_API_VERSION,
    retailersDiscovered: retailers.length,
    listSourcesSucceeded,
    listSourcesFailed: retailers.length - listSourcesSucceeded,
    candidatePlans: marketSummaries.length,
    detailPlansSucceeded,
    detailPlansFailed: marketSummaries.length - detailPlansSucceeded,
    detailPlansRejected: invalidResults.length,
    detailPlansUnavailable: marketSummaries.length - detailPlansSucceeded - invalidResults.length,
    validationFailures,
    retailerCoverage,
    plansWithEligibility: plans.filter((plan) => plan.eligibility?.length).length,
    eligibilityTypes,
    plansWithLastUpdated: updatedTimes.length,
    plansMissingLastUpdated: plans.length - updatedTimes.length,
    oldestPlanUpdatedAt: updatedTimes.length ? new Date(updatedTimes[0]).toISOString() : null,
    newestPlanUpdatedAt: updatedTimes.length ? new Date(updatedTimes.at(-1)).toISOString() : null,
    partial: listSourcesSucceeded < retailers.length || detailPlansSucceeded < marketSummaries.length,
  };
  return {
    plans,
    fetchedAt: new Date().toISOString(),
    sourceHash: tariffSourceHash(plans),
    tariffSchemaVersion: ELECTRICITY_TARIFF_SCHEMA_VERSION,
    source,
  };
}
