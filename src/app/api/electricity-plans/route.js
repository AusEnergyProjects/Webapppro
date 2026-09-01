import { NextResponse } from "next/server";
import {
  loadElectricityPlans,
  validateElectricityPlanQuery,
} from "@/lib/electricity-cdr.mjs";
import { createElectricityPlanCache } from "@/lib/electricity-plan-cache.mjs";
import { createOperationalRecorder } from "@/lib/operational-events.mjs";

export const runtime = "nodejs";

const planCache = createElectricityPlanCache({
  loadPlans: ({ postcode, customerType }) => loadElectricityPlans({ postcode, customerType }),
});

function responseHeaders(requestId, cache) {
  const fallback = cache.startsWith("last_known_good");
  return {
    "Cache-Control": fallback
      ? "public, s-maxage=60, stale-while-revalidate=300"
      : "public, s-maxage=3600, stale-while-revalidate=86400",
    ...(fallback ? { Warning: '110 - "Response is stale"' } : {}),
    "X-Electricity-Plan-Cache": cache,
    "X-Request-Id": requestId,
  };
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
    const { result, cache } = await planCache.get(query.postcode, query.customerType);
    const fallback = cache.startsWith("last_known_good");
    operations.record(fallback ? "degraded_success" : "success", 200, {
      cache,
      planCount: result.plans.length,
      partial: result.source.partial,
      listSourcesSucceeded: result.source.listSourcesSucceeded,
      listSourcesFailed: result.source.listSourcesFailed,
      listSourcesTimedOut: result.source.listSourcesTimedOut,
      listSourcesSkipped: result.source.listSourcesSkipped,
      detailPlansSucceeded: result.source.detailPlansSucceeded,
      detailPlansRejected: result.source.detailPlansRejected,
      detailPlansUnavailable: result.source.detailPlansUnavailable,
      detailPlansTimedOut: result.source.detailPlansTimedOut,
      detailPlansSkipped: result.source.detailPlansSkipped,
      deadlineExceeded: result.source.deadlineExceeded,
      cacheFallback: result.source.cacheFallback,
      cacheFallbackAgeSeconds: result.source.cacheFallbackAgeSeconds,
      plansWithLastUpdated: result.source.plansWithLastUpdated,
      plansMissingLastUpdated: result.source.plansMissingLastUpdated,
      detailApiVersion: result.source.detailApiVersion,
    });
    return NextResponse.json(result, { headers: responseHeaders(operations.requestId, cache) });
  } catch (error) {
    operations.record("upstream_failure", 502, {
      errorType: error instanceof Error ? error.name : "UnknownError",
      errorCode: error?.code || "UNKNOWN_UPSTREAM_FAILURE",
      listSourcesSucceeded: error?.source?.listSourcesSucceeded,
      listSourcesFailed: error?.source?.listSourcesFailed,
      listSourcesTimedOut: error?.source?.listSourcesTimedOut,
      listSourcesSkipped: error?.source?.listSourcesSkipped,
      detailPlansSucceeded: error?.source?.detailPlansSucceeded,
      detailPlansRejected: error?.source?.detailPlansRejected,
      detailPlansUnavailable: error?.source?.detailPlansUnavailable,
      detailPlansTimedOut: error?.source?.detailPlansTimedOut,
      detailPlansSkipped: error?.source?.detailPlansSkipped,
      deadlineExceeded: error?.source?.deadlineExceeded,
    });
    return NextResponse.json(
      { error: "The electricity-plan service is temporarily unavailable. Please try again shortly." },
      { status: 502, headers: { "Cache-Control": "no-store", "X-Request-Id": operations.requestId } },
    );
  }
}
