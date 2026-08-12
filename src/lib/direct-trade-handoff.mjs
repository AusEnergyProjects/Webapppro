import { ENERGY_SERVICE_IDS } from "./energy-service-catalogue.mjs";

const SOURCES = {
  "electricity-solar": { label: "electricity solar scenario", returnHref: "/compare" },
  "electricity-battery": { label: "electricity battery scenario", returnHref: "/compare" },
  "gas-heating": { label: "gas heating upgrade estimate", returnHref: "/gas-compare" },
  "gas-hot-water": { label: "gas hot-water upgrade estimate", returnHref: "/gas-compare" },
};

const SERVICES = new Set(ENERGY_SERVICE_IDS);
const LEGACY_SERVICE_ALIASES = {
  "insulation-draughts": ["insulation", "draught-proofing"],
};
const PRIORITIES = new Set(["lower-running-costs", "improve-comfort", "replace-equipment", "move-from-gas", "solar-storage", "assessment-compliance", "need-advice"]);

function sourceInfo(value) {
  const key = typeof value === "string" ? value : "";
  return Object.hasOwn(SOURCES, key) ? SOURCES[key] : null;
}

function safeList(value, allowed, maximum) {
  const items = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
  return [...new Set(items.map((item) => String(item).trim()).filter((item) => allowed.has(item)))].slice(0, maximum);
}

function safeServices(value) {
  const items = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
  const normalized = items.flatMap((item) => {
    const service = String(item).trim();
    return LEGACY_SERVICE_ALIASES[service] || [service];
  });
  return [...new Set(normalized.filter((item) => SERVICES.has(item)))].slice(
    0,
    SERVICES.size,
  );
}

export function createDirectTradeHandoffUrl(input) {
  const source = sourceInfo(input?.source) ? input.source : "";
  const services = safeServices(input?.services);
  const priorities = safeList(input?.priorities, PRIORITIES, 7);
  const postcode = /^\d{4}$/.test(String(input?.postcode || "")) ? String(input.postcode) : "";
  const params = new URLSearchParams();
  if (source) params.set("from", source);
  if (services.length) params.set("services", services.join(","));
  if (priorities.length) params.set("priorities", priorities.join(","));
  if (postcode) params.set("postcode", postcode);
  const query = params.toString();
  return `/direct-trade${query ? `?${query}` : ""}`;
}

export function parseDirectTradeHandoff(search) {
  const params = new URLSearchParams(String(search || "").replace(/^\?/, ""));
  const requestedSource = params.get("from");
  const info = sourceInfo(requestedSource);
  const source = info ? requestedSource : "";
  return {
    source,
    sourceLabel: info?.label || "",
    returnHref: info?.returnHref || "",
    services: safeServices(params.get("services") || ""),
    priorities: safeList(params.get("priorities") || "", PRIORITIES, 7),
    postcode: /^\d{4}$/.test(params.get("postcode") || "") ? params.get("postcode") : "",
  };
}

export function directTradeSourceLabel(source) {
  return sourceInfo(source)?.label || "";
}
