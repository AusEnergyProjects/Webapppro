import { NextResponse } from "next/server";
import {
  loadElectricityPlans,
  validateElectricityPlanQuery,
} from "@/lib/electricity-cdr.mjs";

export const runtime = "nodejs";

const MEMORY_TTL_MS = 60 * 60 * 1000;
const planCache = new Map();

function responseHeaders() {
  return {
    "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
  };
}

async function cachedPlans(postcode, customerType) {
  const key = postcode + ":" + customerType;
  const existing = planCache.get(key);
  if (existing && Date.now() - existing.createdAt < MEMORY_TTL_MS) {
    return existing.promise;
  }
  const promise = loadElectricityPlans({ postcode, customerType }).catch((error) => {
    if (planCache.get(key)?.promise === promise) planCache.delete(key);
    throw error;
  });
  planCache.set(key, { createdAt: Date.now(), promise });
  return promise;
}

export async function GET(request) {
  const query = validateElectricityPlanQuery(
    request.nextUrl.searchParams.get("postcode"),
    request.nextUrl.searchParams.get("customerType"),
  );
  if (!query.ok) {
    return NextResponse.json({ error: query.error }, { status: 400 });
  }

  try {
    const result = await cachedPlans(query.postcode, query.customerType);
    return NextResponse.json(result, { headers: responseHeaders() });
  } catch (error) {
    console.error("Electricity plan service failed", error);
    return NextResponse.json(
      { error: "The electricity-plan service is temporarily unavailable. Please try again shortly." },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
