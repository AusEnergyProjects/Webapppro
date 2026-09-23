export type TradeMapRecord = {
  id: string;
  kind: "customer" | "job";
  title: string;
  reference: string;
  address: string;
  detail: string;
};

export type TradeMapPosition = { lat: number; lng: number };
export type TradeMapGeocodeResult =
  | { status: "located"; position: TradeMapPosition; approximate: boolean }
  | { status: "unlocated"; reason: "missing_address" | "invalid_address" | "zero_results" | "outside_australia" }
  | { status: "error"; reason: "denied" | "quota" | "unavailable" };

export type TradeMapPin = {
  key: string;
  position: TradeMapPosition;
  records: TradeMapRecord[];
};

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

export function tradeMapAddressKey(address: string): string {
  return address.trim().toLocaleLowerCase("en-AU").replace(/,/g, " ").replace(/\s+/g, " ");
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

export function groupTradeMapPins(records: readonly TradeMapRecord[], locations: ReadonlyMap<string, TradeMapGeocodeResult>): TradeMapPin[] {
  const pins = new Map<string, TradeMapPin>();
  for (const record of records) {
    const address = prepareTradeMapAddress(record.address);
    if (!address) continue;
    const result = locations.get(tradeMapAddressKey(address));
    if (result?.status !== "located") continue;
    // Six decimal places group co-located results without merging adjacent properties.
    const key = `${result.position.lat.toFixed(6)},${result.position.lng.toFixed(6)}`;
    const pin = pins.get(key);
    if (pin) pin.records.push(record);
    else pins.set(key, { key, position: result.position, records: [record] });
  }
  return [...pins.values()];
}

export function tradeMapDirectionsUrl(address: string): string | null {
  const prepared = prepareTradeMapAddress(address);
  if (!prepared) return null;
  const params = new URLSearchParams({ api: "1", destination: prepared, travelmode: "driving" });
  return `https://www.google.com/maps/dir/?${params}`;
}

/** Component-lifetime memory only. Requests are sequential, deduplicated and never persisted. */
export function createTradeMapAddressResolver(geocode: (address: string) => Promise<TradeMapGeocodeResult>) {
  const completed = new Map<string, TradeMapGeocodeResult>();
  const pending = new Map<string, Promise<TradeMapGeocodeResult | null>>();
  let tail: Promise<unknown> = Promise.resolve();

  async function resolve(address: string, signal: AbortSignal): Promise<TradeMapGeocodeResult | null> {
    if (signal.aborted) return null;
    const prepared = prepareTradeMapAddress(address);
    if (!prepared) return { status: "unlocated", reason: address.trim() ? "invalid_address" : "missing_address" };
    const key = tradeMapAddressKey(prepared);
    const cached = completed.get(key);
    if (cached) return cached;
    const existing = pending.get(key);
    if (existing) {
      const result = await existing;
      if (signal.aborted) return null;
      // A prior page may have cancelled this address before its request started.
      return result ?? resolve(prepared, signal);
    }
    const request = tail.then(async (): Promise<TradeMapGeocodeResult | null> => {
      if (signal.aborted) return null;
      const result = await geocode(prepared);
      // Transient/service failures are retryable, not cached as missing addresses.
      if (result.status !== "error") completed.set(key, result);
      return result;
    });
    pending.set(key, request);
    tail = request.catch(() => undefined);
    try {
      const result = await request;
      return signal.aborted ? null : result;
    } finally {
      if (pending.get(key) === request) pending.delete(key);
    }
  }

  return resolve;
}
