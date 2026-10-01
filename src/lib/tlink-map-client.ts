import type { TradeMapBounds } from "./trade-map-contract.ts";
import type { TradeMapGeocodeResult } from "./trade-record-map.ts";

export type TLinkMapConfiguration = {
  ok: true;
  provider: "maptiler";
  configured: boolean;
  apiKey: string;
  gnaf: { ready: boolean; version: string; attribution: string };
};

function object(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }

export function isTLinkMapConfiguration(value: unknown): value is TLinkMapConfiguration {
  return object(value) && value.ok === true && value.provider === "maptiler" && typeof value.configured === "boolean"
    && typeof value.apiKey === "string" && (!value.configured || value.apiKey.trim().length > 0)
    && object(value.gnaf) && typeof value.gnaf.ready === "boolean" && typeof value.gnaf.version === "string" && typeof value.gnaf.attribution === "string"
    && (!value.gnaf.ready || Boolean(value.gnaf.version.trim() && value.gnaf.attribution.trim()));
}

export function isTLinkAddressResult(value: unknown): value is { ok: true; result: TradeMapGeocodeResult } {
  if (!object(value) || value.ok !== true || !object(value.result)) return false;
  const result = value.result;
  if (result.status === "located") return object(result.position) && typeof result.position.lat === "number" && Number.isFinite(result.position.lat)
    && result.position.lat >= -55 && result.position.lat <= -9 && typeof result.position.lng === "number" && Number.isFinite(result.position.lng)
    && result.position.lng >= 96 && result.position.lng <= 169 && typeof result.approximate === "boolean";
  return typeof result.reason === "string" && (result.status === "unlocated" && ["missing_address", "invalid_address", "zero_results", "outside_australia", "ambiguous"].includes(result.reason)
    || result.status === "error" && ["denied", "quota", "unavailable"].includes(result.reason));
}

export function tlinkMapBounds(bounds: TradeMapBounds): [[number, number], [number, number]] {
  return [[bounds.west, bounds.south], [bounds.east, bounds.north]];
}

export function tlinkMapFailure(error: unknown): "auth" | "limit" | "unavailable" {
  const status = object(error) ? error.status : undefined;
  if (status === 401 || status === 403) return "auth";
  if (status === 402 || status === 429) return "limit";
  return "unavailable";
}

/** Fixed attribution avoids rendering provider style HTML through MapLibre's attribution sanitizer. */
export function createTLinkMapAttribution(document: Document, className: string) {
  const element = document.createElement("div");
  element.className = `maplibregl-ctrl ${className}`;
  const logo = document.createElement("a");
  logo.href = "https://www.maptiler.com/"; logo.target = "_blank"; logo.rel = "noopener noreferrer";
  const image = document.createElement("img");
  image.src = "https://api.maptiler.com/resources/logo.svg"; image.alt = "MapTiler"; image.width = 100; image.height = 30;
  logo.append(image); element.append(logo);
  const credits = document.createElement("div");
  for (const [title, url] of [["© MapTiler", "https://www.maptiler.com/copyright/"], ["© OpenStreetMap contributors", "https://www.openstreetmap.org/copyright"]]) {
    const link = document.createElement("a");
    link.textContent = title; link.href = url; link.target = "_blank"; link.rel = "noopener noreferrer";
    credits.append(link);
  }
  element.append(credits);
  return { onAdd: () => element, onRemove: () => element.remove() };
}
