/* CDR retailer payloads vary by retailer and supported API version. */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from "next/server";

const FEED_URL = "https://jxeeno.github.io/energy-cdr-prd-endpoints/energy-prd-endpoints.json";
const GST = 1.1;
const RETAILER_WEBSITES: Record<string, string> = {
  "agl": "https://www.agl.com.au/",
  "alinta energy": "https://www.alintaenergy.com.au/",
  "arcline by racv": "https://energy.arcline.com.au/",
  "arcline by racv - energy": "https://energy.arcline.com.au/",
  "covau": "https://covau.com.au/",
  "dodo power & gas": "https://www.dodo.com/",
  "energy locals": "https://energylocals.com.au/",
  "energyaustralia": "https://www.energyaustralia.com.au/",
  "engie": "https://www.engie.com.au/",
  "globird energy": "https://www.globirdenergy.com.au/",
  "kogan energy": "https://www.koganenergy.com.au/",
  "lumo energy": "https://www.lumoenergy.com.au/",
  "momentum energy": "https://www.momentumenergy.com.au/",
  "origin energy": "https://www.originenergy.com.au/",
  "powershop": "https://www.powershop.com.au/",
  "red energy": "https://www.redenergy.com.au/",
  "tango energy": "https://www.tangoenergy.com/",
  "1st energy": "https://1stenergy.com.au/",
};

function retailerWebsite(name: string, logoUri: string | null): string | null {
  const normalized = name.toLowerCase().replace(/\s+/g, " ").trim();
  if (RETAILER_WEBSITES[normalized]) return RETAILER_WEBSITES[normalized];
  try {
    const hostname = new URL(logoUri || "").hostname.replace(/^www\./, "");
    if (hostname && !/(cloudinary|pcdn|2mdn|public\.energylocals)/i.test(hostname)) return "https://" + hostname + "/";
  } catch {
    return null;
  }
  return null;
}

async function getJson(url: string, version?: string): Promise<any> {
  const response = await fetch(url, { headers: version ? { "x-v": version } : {}, cache: "no-store" });
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

function blockCost(rates: any[], usageMj: number, days: number, ratePeriod?: string): number {
  let remaining = usageMj;
  let total = 0;
  rates.forEach((rate, index) => {
    if (remaining <= 0) return;
    let volume = rate.volume == null ? Infinity : Number(rate.volume);
    if (ratePeriod === "P1D") volume *= days;
    if (index === rates.length - 1) volume = Infinity;
    const used = Math.min(remaining, volume);
    total += used * Number(rate.unitPrice || 0);
    remaining -= used;
  });
  return total;
}

function dayOfYear(month: number, day: number): number {
  const date = new Date(Date.UTC(2025, month - 1, day));
  return Math.floor((date.getTime() - Date.UTC(2025, 0, 1)) / 86400000) + 1;
}

function periodDays(period: any): number {
  const [startMonth, startDay] = String(period.startDate || "01-01").split("-").map(Number);
  const [endMonth, endDay] = String(period.endDate || "12-31").split("-").map(Number);
  const start = dayOfYear(startMonth || 1, startDay || 1);
  const end = dayOfYear(endMonth || 12, endDay || 31);
  return end >= start ? end - start + 1 : 365 - start + 1 + end;
}

function estimate(contract: any, annualMj: number, includeConditional: boolean) {
  const periods = Array.isArray(contract?.tariffPeriod) ? contract.tariffPeriod : [];
  const priceablePeriods = periods.filter((period: any) => Array.isArray(period?.singleRate?.rates) && period.singleRate.rates.length);
  if (!priceablePeriods.length) return null;

  const usagePerDay = annualMj / 365;
  const breakdown = priceablePeriods.map((period: any) => {
    const days = periodDays(period);
    const rates = period.singleRate.rates;
    return {
      period,
      days,
      supply: Number(period.dailySupplyCharges ?? period.dailySupplyCharge ?? 0) * days,
      usage: blockCost(rates, usagePerDay * days, days, period.singleRate.period),
      rates,
    };
  });
  const supply = breakdown.reduce((total: number, item: any) => total + item.supply, 0) * GST;
  const usage = breakdown.reduce((total: number, item: any) => total + item.usage, 0) * GST;
  let discount = 0;
  const conditionalDiscounts: string[] = [];
  for (const item of contract.discounts || []) {
    const conditional = String(item.type || "").toUpperCase() === "CONDITIONAL";
    if (conditional) conditionalDiscounts.push(item.displayName || "Conditional discount");
    if (conditional && !includeConditional) continue;
    if (item.methodUType === "percentOfBill") discount += (supply + usage) * Number(item.percentOfBill?.rate || 0);
    if (item.methodUType === "percentOfUse") discount += usage * Number(item.percentOfUse?.rate || 0);
    if (item.methodUType === "fixedAmount") discount += Number(item.fixedAmount?.amount || 0);
  }
  const firstPeriod = breakdown[0];
  return {
    annualCost: supply + usage - discount,
    supply,
    usage,
    supplyChargeDaily: Number(firstPeriod.period.dailySupplyCharges ?? firstPeriod.period.dailySupplyCharge ?? 0) * GST * 100,
    rates: firstPeriod.rates.map((rate: any, index: number) => ({
      label: rate.volume && index < firstPeriod.rates.length - 1 ? "first " + rate.volume + (firstPeriod.period.singleRate.period === "P1D" ? " MJ/day" : " MJ") : index ? "remaining usage" : "all usage",
      centsPerMj: Number(rate.unitPrice || 0) * GST * 100,
    })),
    seasonal: breakdown.length > 1,
    seasons: breakdown.map((item: any) => ({
      label: item.period.displayName || "Seasonal rate",
      days: item.days,
      supply: item.supply * GST,
      usage: item.usage * GST,
      rates: item.rates.map((rate: any, index: number) => ({
        label: rate.volume && index < item.rates.length - 1 ? "first " + rate.volume + (item.period.singleRate.period === "P1D" ? " MJ/day" : " MJ") : index ? "remaining usage" : "all usage",
        centsPerMj: Number(rate.unitPrice || 0) * GST * 100,
      })),
    })),
    conditionalDiscounts,
    discounts: discount,
  };
}

export async function GET(request: NextRequest) {
  const postcode = request.nextUrl.searchParams.get("postcode") || "";
  const annualMj = Number(request.nextUrl.searchParams.get("annualMj"));
  const includeConditional = request.nextUrl.searchParams.get("includeConditional") !== "false";
  if (!/^\d{4}$/.test(postcode) || !(annualMj > 0)) {
    return NextResponse.json({ error: "A valid postcode and annual MJ are required." }, { status: 400 });
  }
  try {
    const feed: any = await getJson(FEED_URL);
    const retailers = (feed.data || feed)
      .filter((brand: any) => brand.industries?.includes("energy"))
      .map((brand: any) => ({
        name: brand.brandName,
        base: brand.productReferenceDataBaseUri || brand.publicBaseUri,
        retailerUrl: retailerWebsite(brand.brandName, brand.logoUri || null),
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
        return { retailer, plans };
      } catch {
        return { retailer, plans: [] };
      }
    }));

    const candidates = lists.flatMap(({ retailer, plans }: any) => plans
      .filter((plan: any) => {
        const geography = plan.geography || {};
        return (!plan.customerType || plan.customerType === "RESIDENTIAL")
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
        link: plan.applicationUri || plan.additionalInformation?.overviewUri || plan.additionalInformation?.pricingUri || null,
      })));

    const priced = await Promise.all(candidates.map(async (plan: any) => {
      try {
        let detail: any = null;
        for (const version of ["3", "2", "1"]) {
          try {
            detail = await getJson(plan.base.replace(/\/$/, "") + "/cds-au/v1/energy/plans/" + encodeURIComponent(plan.id), version);
            break;
          } catch {
            if (version === "1") throw new Error("Gas plan details unavailable");
          }
        }
        const result = estimate(detail.data?.gasContract, annualMj, includeConditional);
        const additionalInformation = detail.data?.additionalInformation || {};
        return result ? {
          ...plan,
          ...result,
          link: plan.link || additionalInformation.overviewUri || additionalInformation.pricingUri || plan.retailerUrl || null,
          type: detail.data?.type || "MARKET",
          eligibility: detail.data?.gasContract?.eligibility || [],
          terms: detail.data?.gasContract?.terms || "",
        } : null;
      } catch {
        return null;
      }
    }));

    const distinct = new Map<string, any>();
    priced.filter(Boolean).forEach((plan: any) => distinct.set(plan.id, plan));
    const plans = [...distinct.values()].sort((a, b) => a.annualCost - b.annualCost);
    return NextResponse.json({ plans });
  } catch {
    return NextResponse.json({ error: "The gas-plan service is temporarily unavailable. Please try again shortly." }, { status: 502 });
  }
}
