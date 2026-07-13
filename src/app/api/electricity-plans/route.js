import { NextResponse } from "next/server";
import {
  loadElectricityPlans,
  validateElectricityPlanQuery,
} from "@/lib/electricity-cdr.mjs";
import { createOperationalRecorder } from "@/lib/operational-events.mjs";

export const runtime = "nodejs";

const MEMORY_TTL_MS = 60 * 60 * 1000;
const planCache = new Map();

function responseHeaders(requestId) {
  return {
    "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
    "X-Request-Id": requestId,
  };
}

async function cachedPlans(postcode, customerType) {
  const key = postcode + ":" + customerType;
  const existing = planCache.get(key);
  if (existing && Date.now() - existing.createdAt < MEMORY_TTL_MS) {
    return { result: await existing.promise, cache: "memory_hit" };
  }
  const promise = loadElectricityPlans({ postcode, customerType }).catch((error) => {
    if (planCache.get(key)?.promise === promise) planCache.delete(key);
    throw error;
  });
  planCache.set(key, { createdAt: Date.now(), promise });
  return { result: await promise, cache: "miss" };
}

export async function GET(request) {
  const operations = createOperationalRecorder({ event: "api.electricity_plans" });
  const query = validateElectricityPlanQuery(
    request.nextUrl.searchParams.get("postcode"),
    request.nextUrl.searchParams.get("customerType"),
  );
  if (!query.ok) {
    operations.record("invalid_query", 400);
    return NextResponse.json(
      { error: query.error },
      { status: 400, headers: { "Cache-Control": "no-store", "X-Request-Id": operations.requestId } },
    );
  }

  try {
    const { result, cache } = await cachedPlans(query.postcode, query.customerType);
    operations.record("success", 200, {
      cache,
      planCount: result.plans.length,
      partial: result.source.partial,
      listSourcesSucceeded: result.source.listSourcesSucceeded,
      listSourcesFailed: result.source.listSourcesFailed,
      detailPlansSucceeded: result.source.detailPlansSucceeded,
      detailPlansRejected: result.source.detailPlansRejected,
      detailPlansUnavailable: result.source.detailPlansUnavailable,
      plansWithLastUpdated: result.source.plansWithLastUpdated,
      plansMissingLastUpdated: result.source.plansMissingLastUpdated,
      detailApiVersion: result.source.detailApiVersion,
    });
    return NextResponse.json(result, { headers: responseHeaders(operations.requestId) });
  } catch (error) {
    operations.record("upstream_failure", 502, {
      errorType: error instanceof Error ? error.name : "UnknownError",
    });
    return NextResponse.json(
      { error: "The electricity-plan service is temporarily unavailable. Please try again shortly." },
      { status: 502, headers: { "Cache-Control": "no-store", "X-Request-Id": operations.requestId } },
    );
  }
}
