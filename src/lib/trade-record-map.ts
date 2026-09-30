import type { JobRegisterOperationalStatus } from "./trade-crm-job-register.ts";
import { TRADE_JOB_LIFECYCLE_LABELS, TRADE_JOB_LIFECYCLE_STATUSES } from "./trade-job-lifecycle.ts";

export type TradeMapRecord = {
  id: string;
  kind: "customer" | "job";
  title: string;
  reference: string;
  address: string;
  detail: string;
  jobStatus?: JobRegisterOperationalStatus;
};

export type TradeMapPinCategory = JobRegisterOperationalStatus | "customer" | "unknown" | "mixed" | "mixed_records";

export const TRADE_MAP_PIN_CATEGORY_ORDER: readonly TradeMapPinCategory[] = [
  "customer", ...TRADE_JOB_LIFECYCLE_STATUSES, "unknown", "mixed", "mixed_records",
];

export const TRADE_MAP_PIN_LABELS: Record<TradeMapPinCategory, string> = {
  ...TRADE_JOB_LIFECYCLE_LABELS,
  customer: "Customer",
  unknown: "Status unavailable",
  mixed: "Mixed statuses",
  mixed_records: "Mixed records",
};

export function tradeMapRecordCategory(record: TradeMapRecord): TradeMapPinCategory {
  return record.kind === "customer" ? "customer" : record.jobStatus ?? "unknown";
}

export type TradeMapPosition = { lat: number; lng: number };
export type TradeMapGeocodeResult =
  | { status: "located"; position: TradeMapPosition; approximate: boolean }
  | { status: "unlocated"; reason: "missing_address" | "invalid_address" | "zero_results" | "outside_australia" }
  | { status: "error"; reason: "denied" | "quota" | "unavailable" };

type GeocodeCandidate = {
  address_components?: readonly { short_name: string; types: readonly string[] }[];
  partial_match?: boolean;
  geometry?: {
    location?: { lat: () => number; lng: () => number };
    location_type?: string;
  };
};

/** Only the address is a geocoding input. Empty/withheld records remain in the list. */
export function prepareTradeMapAddress(address: string): string | null {
  const cleaned = address.trim().replace(/\s+/g, " ").replace(/(?:\s*,\s*)+/g, ", ").replace(/^,\s*|,\s*$/g, "");
  if (cleaned.length < 4 || cleaned.length > 500) return null;
  if (!/[a-z]/i.test(cleaned) || !/\d/.test(cleaned)) return null;
  if (/[<>@\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(cleaned) || /https?:\/\//i.test(cleaned)) return null;
  if (/\b(?:withheld|redacted|address unavailable|address not available|po box|p\.o\. box|locked bag)\b/i.test(cleaned)) return null;
  return cleaned;
}

/** Translate Google statuses without confusing an API failure with an unmatched address. */
export function interpretTradeMapGeocode(status: string, results: readonly GeocodeCandidate[] | null): TradeMapGeocodeResult {
  if (status === "ZERO_RESULTS") return { status: "unlocated", reason: "zero_results" };
  if (status === "REQUEST_DENIED") return { status: "error", reason: "denied" };
  if (status === "OVER_QUERY_LIMIT" || status === "OVER_DAILY_LIMIT") return { status: "error", reason: "quota" };
  if (status !== "OK" || !results?.length) return { status: "error", reason: "unavailable" };

  const result = results.find((candidate) => candidate.address_components?.some(
    (component) => component.types.includes("country") && component.short_name === "AU",
  ));
  if (!result) return { status: "unlocated", reason: "outside_australia" };
  const location = result.geometry?.location;
  if (!location) return { status: "error", reason: "unavailable" };
  const position = { lat: location.lat(), lng: location.lng() };
  if (!Number.isFinite(position.lat) || !Number.isFinite(position.lng)
    || Math.abs(position.lat) > 90 || Math.abs(position.lng) > 180) {
    return { status: "error", reason: "unavailable" };
  }
  return {
    status: "located",
    position,
    approximate: result.partial_match === true || result.geometry?.location_type !== "ROOFTOP",
  };
}

export function tradeMapDirectionsUrl(address: string): string | null {
  const prepared = prepareTradeMapAddress(address);
  if (!prepared) return null;
  const params = new URLSearchParams({ api: "1", destination: prepared, travelmode: "driving" });
  return `https://www.google.com/maps/dir/?${params}`;
}
