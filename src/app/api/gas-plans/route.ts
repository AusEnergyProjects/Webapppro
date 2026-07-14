/* CDR retailer payloads vary by retailer and supported API version. */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from "next/server";
import { estimateGasContract, type GasUsageProfile } from "@/lib/gas-tariff-engine";
import { safeCdrBase } from "@/lib/electricity-cdr.mjs";
import { createOperationalRecorder } from "@/lib/operational-events.mjs";
import { resolveCustomerPlanUrl, retailerWebsite } from "@/lib/retailer-links.mjs";

const FEED_URL = "https://jxeeno.github.io/energy-cdr-prd-endpoints/energy-prd-endpoints.json";
const DETAIL_API_VERSION = "3";
const UPSTREAM_TIMEOUT_MS = 10_000;
const MEMORY_TTL_MS = 60 * 60 * 1000;
const planCache = new Map<string, { createdAt: number; body: unknown }>();
async function getJson(url: string, version?: string): Promise<any> {
  const response = await fetch(url, {
    headers: version ? { "x-v": version, "x-min-v": version } : {},
    cache: "no-store",
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error("Retailer returned HTTP " + response.status);
  return response.json();
}

function postcodeMatches(postcode: string, values: unknown): boolean {
  if (!Array.isArray(values)) return false;
  const number = Number(postcode);
  return values.some((item) => {
    const value = String(item).trim();
    if (value === postcode) return true;
    const range = value.split("-").map(Number);
    return range.length === 2 && Number.isFinite(range[0]) && Number.isFinite(range[1]) && number >= range[0] && number <= range[1];
  });
}

export async function GET(request: NextRequest) {
  const operations = createOperationalRecorder({ event: "api.gas_plans" });
  const respond = (body: unknown, status: number, outcome: string, metrics: Record<string, unknown> = {}) => {
    operations.record(outcome, status, metrics);
    return NextResponse.json(body, {
      status,
      headers: {
        "Cache-Control": status === 200 ? "public, s-maxage=3600, stale-while-revalidate=86400" : "no-store",
        "X-Request-Id": operations.requestId,
      },
    });
  };
  const postcode = request.nextUrl.searchParams.get("postcode") || "";
  const annualMj = Number(request.nextUrl.searchParams.get("annualMj"));
  const includeConditional = request.nextUrl.searchParams.get("includeConditional") === "true";
  const usageProfile = (request.nextUrl.searchParams.get("usageProfile") || "heating") as GasUsageProfile;
  if (!/^\d{4}$/.test(postcode) || !Number.isFinite(annualMj) || !(annualMj > 0) || !["heating", "steady"].includes(usageProfile)) {
    return respond({ error: "A valid postcode, annual MJ and gas-use pattern are required." }, 400, "invalid_query");
  }
  const cacheKey = [postcode, annualMj, includeConditional, usageProfile].join(":");
  const cached = planCache.get(cacheKey);
  if (cached && Date.now() - cached.createdAt < MEMORY_TTL_MS) {
    return respond(cached.body, 200, "success", { cache: "memory_hit" });
  }
  try {
    const feed: any = await getJson(FEED_URL);
    const retailers = (feed.data || feed)
      .filter((brand: any) => brand.industries?.includes("energy"))
      .map((brand: any) => ({
        name: brand.brandName,
        base: safeCdrBase(brand.productReferenceDataBaseUri || brand.publicBaseUri),
        retailerUrl: retailerWebsite(brand.productReferenceDataBaseUri || brand.publicBaseUri, brand.brandName),
        logo: brand.logoUri || null,
      }))
      .filter((brand: any) => brand.base);

    const lists = await Promise.all(retailers.map(async (retailer: any) => {
      try {
        const plans: any[] = [];
        const pageSize = 1000;
        let page = 1;
        let totalPages = 1;
        do {
          const url = retailer.base.replace(/\/$/, "") + "/cds-au/v1/energy/plans?fuelType=GAS&effective=CURRENT&page-size=" + pageSize + "&page=" + page;
          const result: any = await getJson(url, "1");
          const batch = result.data?.plans || [];
          plans.push(...batch);
          totalPages = Math.max(Number(result.meta?.totalPages || totalPages), 1);
          page += 1;
          if (!batch.length) break;
        } while (page <= totalPages);
        return { retailer, plans, available: true };
      } catch {
        return { retailer, plans: [], available: false };
      }
    }));

    const candidates = lists.flatMap(({ retailer, plans }: any) => plans
      .filter((plan: any) => {
        const geography = plan.geography || {};
        const now = Date.now();
        const effectiveFrom = plan.effectiveFrom ? Date.parse(plan.effectiveFrom) : null;
        const effectiveTo = plan.effectiveTo ? Date.parse(plan.effectiveTo) : null;
        return String(plan.fuelType || "GAS").toUpperCase() === "GAS"
          && (effectiveFrom == null || Number.isFinite(effectiveFrom) && effectiveFrom <= now)
          && (effectiveTo == null || Number.isFinite(effectiveTo) && effectiveTo > now)
          && (!plan.customerType || plan.customerType === "RESIDENTIAL")
          && !postcodeMatches(postcode, geography.excludedPostcodes)
          && postcodeMatches(postcode, geography.includedPostcodes);
      })
      .map((plan: any) => ({
        id: plan.planId,
        name: plan.displayName,
        brand: plan.brandName || retailer.name,
        base: retailer.base,
        logo: retailer.logo,
        retailerUrl: retailer.retailerUrl,
        sourceRetailer: retailer.name,
        distributors: [...new Set((plan.geography?.distributors || []).map((item: unknown) => String(item).trim()).filter(Boolean))],
        link: plan.applicationUri || plan.additionalInformation?.overviewUri || plan.additionalInformation?.pricingUri || null,
        effectiveFrom: plan.effectiveFrom || null,
        effectiveTo: plan.effectiveTo || null,
        lastUpdated: Number.isFinite(Date.parse(plan.lastUpdated)) ? plan.lastUpdated : null,
      })));

    const outcomes = await Promise.all(candidates.map(async (plan: any) => {
      try {
        const detail: any = await getJson(plan.base.replace(/\/$/, "") + "/cds-au/v1/energy/plans/" + encodeURIComponent(plan.id), DETAIL_API_VERSION);
        const now = Date.now();
        const effectiveFrom = detail.data?.effectiveFrom ? Date.parse(detail.data.effectiveFrom) : null;
        const effectiveTo = detail.data?.effectiveTo ? Date.parse(detail.data.effectiveTo) : null;
        if ((effectiveFrom != null && (!Number.isFinite(effectiveFrom) || effectiveFrom > now)) || (effectiveTo != null && (!Number.isFinite(effectiveTo) || effectiveTo <= now))) return { status: "rejected", plan };
        const result = estimateGasContract(detail.data?.gasContract, annualMj, includeConditional, usageProfile);
        if (!result) return { status: "rejected", plan };
        const additionalInformation = detail.data?.additionalInformation || {};
        const contract = detail.data.gasContract;
        return { status: "passed", plan, result: {
          ...plan,
          ...result,
          link: resolveCustomerPlanUrl(
            [plan.link, additionalInformation.overviewUri, additionalInformation.pricingUri],
            plan.retailerUrl,
          ),
          type: detail.data?.type || "MARKET",
          effectiveFrom: detail.data?.effectiveFrom || plan.effectiveFrom,
          effectiveTo: detail.data?.effectiveTo || plan.effectiveTo,
          lastUpdated: Number.isFinite(Date.parse(detail.data?.lastUpdated)) ? detail.data.lastUpdated : plan.lastUpdated,
          eligibility: contract.eligibility || [],
          eligibilityConfirmations: (contract.eligibility || []).map((item: any) => {
            const type = String(item.type || "Retailer condition").replaceAll("_", " ").toLowerCase();
            const description = item.information || item.description;
            return description ? `${type}: ${description}` : type;
          }),
          feeCount: Array.isArray(contract.fees) ? contract.fees.length : 0,
          incentiveCount: Array.isArray(contract.incentives) ? contract.incentives.length : 0,
          terms: contract.terms || "",
          variation: contract.variation || "",
          onExpiryDescription: contract.onExpiryDescription || "",
        } };
      } catch {
        return { status: "unavailable", plan };
      }
    }));

    const distinct = new Map<string, any>();
    outcomes.filter((outcome) => outcome.status === "passed").forEach((outcome: any) => distinct.set(outcome.result.id, outcome.result));
    const plans = [...distinct.values()].sort((a, b) => a.annualCost - b.annualCost);
    const timestamps = plans.map((plan) => Date.parse(plan.lastUpdated)).filter(Number.isFinite).sort((a, b) => a - b);
    const listFailures = lists.filter((item) => !item.available).length;
    const rejected = outcomes.filter((outcome) => outcome.status === "rejected").length;
    const unavailable = outcomes.filter((outcome) => outcome.status === "unavailable").length;
    const retailerCoverage = retailers.map((retailer: any) => {
      const list = lists.find((item: any) => item.retailer.name === retailer.name);
      const local = candidates.filter((plan: any) => plan.sourceRetailer === retailer.name);
      const localOutcomes = outcomes.filter((outcome) => outcome.plan.sourceRetailer === retailer.name);
      return {
        retailer: retailer.name,
        listAvailable: Boolean(list?.available),
        candidatePlans: local.length,
        detailsPassed: localOutcomes.filter((outcome) => outcome.status === "passed").length,
        detailsRejected: localOutcomes.filter((outcome) => outcome.status === "rejected").length,
        detailsUnavailable: localOutcomes.filter((outcome) => outcome.status === "unavailable").length,
      };
    });
    const body = {
      plans,
      fetchedAt: new Date().toISOString(),
      usageProfile,
      source: {
        directorySource: FEED_URL,
        planDataAuthority: "AER and Victorian government Energy Product Reference Data",
        listApiVersion: "1",
        detailApiVersion: DETAIL_API_VERSION,
        retailersDiscovered: retailers.length,
        listSourcesSucceeded: lists.length - listFailures,
        listSourcesFailed: listFailures,
        candidatePlans: candidates.length,
        detailPlansSucceeded: plans.length,
        detailPlansRejected: rejected,
        detailPlansUnavailable: unavailable,
        plansWithLastUpdated: timestamps.length,
        plansMissingLastUpdated: plans.length - timestamps.length,
        oldestPlanUpdatedAt: timestamps.length ? new Date(timestamps[0]).toISOString() : null,
        newestPlanUpdatedAt: timestamps.length ? new Date(timestamps[timestamps.length - 1]).toISOString() : null,
        retailerCoverage,
        partial: listFailures > 0 || rejected > 0 || unavailable > 0,
      },
    };
    planCache.set(cacheKey, { createdAt: Date.now(), body });
    return respond(body, 200, "success", {
      cache: "miss",
      planCount: plans.length,
      partial: body.source.partial,
      listSourcesSucceeded: body.source.listSourcesSucceeded,
      listSourcesFailed: body.source.listSourcesFailed,
      detailPlansSucceeded: body.source.detailPlansSucceeded,
      detailPlansRejected: body.source.detailPlansRejected,
      detailPlansUnavailable: body.source.detailPlansUnavailable,
      plansWithLastUpdated: body.source.plansWithLastUpdated,
      plansMissingLastUpdated: body.source.plansMissingLastUpdated,
      detailApiVersion: body.source.detailApiVersion,
    });
  } catch (error) {
    return respond(
      { error: "The gas-plan service is temporarily unavailable. Please try again shortly." },
      502,
      "upstream_failure",
      { errorType: error instanceof Error ? error.name : "UnknownError" },
    );
  }
}
