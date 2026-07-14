const SOURCES = {
  "electricity-solar": { label: "electricity solar scenario", returnHref: "/compare" },
  "electricity-battery": { label: "electricity battery scenario", returnHref: "/compare" },
  "gas-heating": { label: "gas heating upgrade estimate", returnHref: "/gas-compare" },
  "gas-hot-water": { label: "gas hot-water upgrade estimate", returnHref: "/gas-compare" },
};

const SERVICES = new Set(["assessment", "solar", "battery", "heating-cooling", "hot-water", "insulation-draughts", "ev-charging", "other"]);
const PRIORITIES = new Set(["lower-running-costs", "improve-comfort", "replace-equipment", "move-from-gas", "solar-storage", "assessment-compliance", "need-advice"]);

function sourceInfo(value) {
  const key = typeof value === "string" ? value : "";
  return Object.hasOwn(SOURCES, key) ? SOURCES[key] : null;
}

function safeList(value, allowed, maximum) {
  const items = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
  return [...new Set(items.map((item) => String(item).trim()).filter((item) => allowed.has(item)))].slice(0, maximum);
}

export function createDirectTradeHandoffUrl(input) {
  const source = sourceInfo(input?.source) ? input.source : "";
  const services = safeList(input?.services, SERVICES, 8);
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
    services: safeList(params.get("services") || "", SERVICES, 8),
    priorities: safeList(params.get("priorities") || "", PRIORITIES, 7),
    postcode: /^\d{4}$/.test(params.get("postcode") || "") ? params.get("postcode") : "",
  };
}

export function directTradeSourceLabel(source) {
  return sourceInfo(source)?.label || "";
}
