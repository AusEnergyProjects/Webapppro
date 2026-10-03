import { canonicalGoogleBusinessProfileUrl } from "./trade-google-business-profile.mjs";

export type CustomerHubBusinessProfile = { id: string; name: string; websiteUrl: string; googleProfileUrl: string };
export type CustomerHubBusinessLocation = { suburb: string; addressState: string; postcode: string };
export type CustomerHubBusinessRating = { status: "unavailable" } | {
  status: "available"; rating: number; reviewCount: number; googleMapsUrl: string;
  attributions: { name: string; url: string }[];
};
type PlaceIdentity = { placeId: string; cid: string };
type ObjectValue = Record<string, unknown>;
const text = (value: unknown, maximum = 160) => typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, maximum) : "";
const object = (value: unknown): ObjectValue | null => value !== null && typeof value === "object" && !Array.isArray(value) ? value as ObjectValue : null;
const unavailable = (): CustomerHubBusinessRating => ({ status: "unavailable" });

function httpsLink(value: unknown) {
  if (typeof value !== "string" || value.length > 2048 || /[\s\\\u0000-\u001f\u007f]/u.test(value)) return "";
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.port ? url.href : "";
  } catch { return ""; }
}

/** Projects only owner-supplied public links; never returns account/contact fields. */
export function customerHubBusinessProfile(row: Readonly<Record<string, unknown>>): CustomerHubBusinessProfile {
  return { id: text(row.business_id, 120), name: text(row.business_name),
    websiteUrl: httpsLink(typeof row.business_website === "string" ? row.business_website.trim() : ""),
    googleProfileUrl: canonicalGoogleBusinessProfileUrl(row.google_business_profile_url) || "" };
}

function canonicalCid(value: string) {
  if (!/^(?:[0-9]{1,20}|0x[0-9a-f]{1,16})$/i.test(value)) return "";
  const parsed = BigInt(value);
  return parsed > BigInt(0) && parsed <= BigInt("18446744073709551615") ? parsed.toString() : "";
}

/** URL formats are compatibility inputs, not fuzzy evidence of business identity. */
function placeIdentity(value: string): PlaceIdentity | null {
  const safe = canonicalGoogleBusinessProfileUrl(value);
  if (!safe) return null;
  const url = new URL(safe), ids = new Set<string>(), cids = new Set<string>();
  const addId = (id: string) => { if (/^[A-Za-z0-9_-]{10,512}$/.test(id)) ids.add(id); };
  for (const key of ["query_place_id", "place_id"]) {
    for (const id of url.searchParams.getAll(key)) {
      if (!/^[A-Za-z0-9_-]{10,512}$/.test(id)) return null;
      addId(id);
    }
  }
  for (const key of ["q", "query"]) {
    const match = url.searchParams.get(key)?.match(/^place_id:([A-Za-z0-9_-]{10,512})$/); if (match) addId(match[1]);
  }
  for (const value of url.searchParams.getAll("cid")) {
    const cid = canonicalCid(value); if (!cid) return null;
    cids.add(cid);
  }
  let decoded: string;
  try { decoded = decodeURIComponent(url.pathname); } catch { return null; }
  for (const match of decoded.matchAll(/!1s([A-Za-z0-9_-]{10,512})(?=!|\/|$)/g)) addId(match[1]);
  for (const source of [decoded, url.searchParams.get("ftid") || ""]) {
    for (const match of source.matchAll(/(?:!1s|^)(0x[0-9a-f]+):(0x[0-9a-f]+)(?=!|\/|$)/gi)) {
      const found = canonicalCid(match[2]); if (found) cids.add(found);
    }
  }
  if (ids.size > 1 || cids.size > 1 || (!ids.size && !cids.size)) return null;
  return { placeId: [...ids][0] || "", cid: [...cids][0] || "" };
}

async function resolveListing(value: string, fetchImpl: typeof fetch, signal: AbortSignal) {
  let current = canonicalGoogleBusinessProfileUrl(value);
  const visited = new Set<string>();
  for (let attempt = 0; current && attempt < 4; attempt++) {
    const identity = placeIdentity(current); if (identity) return identity;
    const url = new URL(current);
    if (!["maps.app.goo.gl", "g.page"].includes(url.hostname) || visited.has(current)) return null;
    visited.add(current);
    // No API credential, customer context, cookies or referrer reaches a short link.
    const response = await fetchImpl(current, { method: "GET", redirect: "manual", cache: "no-store", credentials: "omit",
      referrerPolicy: "no-referrer", signal, headers: { Accept: "text/html" } });
    await response.body?.cancel();
    if (![301, 302, 303, 307, 308].includes(response.status)) return null;
    const location = response.headers.get("location"); if (!location) return null;
    current = canonicalGoogleBusinessProfileUrl(new URL(location, current).href);
  }
  return current ? placeIdentity(current) : null;
}

async function boundedJson(response: Response): Promise<unknown> {
  if (!response.ok || !response.body || Number(response.headers.get("content-length") || 0) > 65536) throw new Error("GOOGLE_RATING_UNAVAILABLE");
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let bytes = 0, body = "";
  try {
    while (true) {
      const item = await reader.read(); if (item.done) break;
      bytes += item.value.byteLength;
      if (bytes > 65536) throw new Error("GOOGLE_RATING_UNAVAILABLE");
      body += decoder.decode(item.value, { stream: true });
    }
    return JSON.parse(body + decoder.decode());
  } finally { await reader.cancel(); }
}

function matchingRating(place: ObjectValue, identity: PlaceIdentity): CustomerHubBusinessRating {
  const id = typeof place.id === "string" ? place.id : "";
  const mapsUrl = canonicalGoogleBusinessProfileUrl(place.googleMapsUri) || "";
  if (!id || !mapsUrl || (identity.placeId && id !== identity.placeId)
    || (identity.cid && placeIdentity(mapsUrl)?.cid !== identity.cid)) return unavailable();
  const rating = place.rating, count = place.userRatingCount;
  if (typeof rating !== "number" || !Number.isFinite(rating) || rating < 1 || rating > 5
    || typeof count !== "number" || !Number.isSafeInteger(count) || count <= 0) return unavailable();
  const attributions: { name: string; url: string }[] = [];
  if (place.attributions !== undefined && !Array.isArray(place.attributions)) return unavailable();
  for (const entry of Array.isArray(place.attributions) ? place.attributions : []) {
    const attribution = object(entry), name = text(attribution?.provider, 200), url = httpsLink(attribution?.providerUri);
    // Do not display Google content if its required provider attribution is unusable.
    if (!name || !url) return unavailable();
    attributions.push({ name, url });
  }
  return { status: "available", rating, reviewCount: count, googleMapsUrl: mapsUrl, attributions };
}

/** No persistent rating cache. Inputs are public business metadata only. */
export async function fetchCustomerHubBusinessRating(profile: CustomerHubBusinessProfile, location: CustomerHubBusinessLocation,
  dependencies: { env?: Readonly<Record<string, string | undefined>>; fetchImpl?: typeof fetch } = {}): Promise<CustomerHubBusinessRating> {
  const env = dependencies.env || process.env, fetchImpl = dependencies.fetchImpl || fetch;
  const token = (env.TLINK_ADDRESS_AUTOCOMPLETE_TOKEN || "").trim();
  if (env.TLINK_ADDRESS_AUTOCOMPLETE_ENDPOINT !== "https://places.googleapis.com/v1/places:autocomplete" || !token || !profile.googleProfileUrl) return unavailable();
  try {
    const signal = AbortSignal.timeout(8000), identity = await resolveListing(profile.googleProfileUrl, fetchImpl, signal);
    if (!identity) return unavailable();
    const headers = { Accept: "application/json", "Content-Type": "application/json", "X-Goog-Api-Key": token,
      "X-Goog-FieldMask": "id,rating,userRatingCount,googleMapsUri,attributions" };
    const request = { headers, signal, cache: "no-store" as const, redirect: "manual" as const, credentials: "omit" as const, referrerPolicy: "no-referrer" as const };
    if (identity.placeId) {
      const result = object(await boundedJson(await fetchImpl(`https://places.googleapis.com/v1/places/${encodeURIComponent(identity.placeId)}?languageCode=en-AU&regionCode=au`, request)));
      return result ? matchingRating(result, identity) : unavailable();
    }
    const name = text(profile.name); if (!name) return unavailable();
    const query = [name, text(location.suburb, 80), text(location.addressState, 10), text(location.postcode, 12), "Australia"].filter(Boolean).join(" ");
    const result = object(await boundedJson(await fetchImpl("https://places.googleapis.com/v1/places:searchText", { ...request, method: "POST",
      headers: { ...headers, "X-Goog-FieldMask": "places.id,places.rating,places.userRatingCount,places.googleMapsUri,places.attributions" },
      body: JSON.stringify({ textQuery: query, regionCode: "au", languageCode: "en-AU", includePureServiceAreaBusinesses: true, pageSize: 10 }) })));
    const candidates = (Array.isArray(result?.places) ? result.places : []).map(object).filter((place): place is ObjectValue => Boolean(place));
    const matches = candidates.filter(place => placeIdentity(String(place.googleMapsUri || ""))?.cid === identity.cid);
    return matches.length === 1 ? matchingRating(matches[0], identity) : unavailable();
  } catch { return unavailable(); }
}
