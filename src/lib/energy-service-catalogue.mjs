import { AEA_SERVICE_IDENTITIES, AEA_BUNDLE_IDENTITIES, isAeaReservedService } from "./aea-service-identity.mjs";

/** @type {Readonly<Record<string, string>>} */
export const LEGACY_ENERGY_SERVICE_ALIASES = Object.freeze({ "rental-inspection": "minimum-rental-standards" });

export const ENERGY_SERVICE_CATALOGUE = Object.freeze([
  Object.freeze({ id: "assessment", label: "Energy assessment" }),
  ...Object.values(AEA_SERVICE_IDENTITIES).map((service) => Object.freeze({ id: service.id, label: service.name })),
  ...Object.values(AEA_BUNDLE_IDENTITIES).map((bundle) => Object.freeze({ id: bundle.id, label: `${bundle.name} (2 years)` })),
  Object.freeze({ id: "blower-door-testing", label: "Blower door testing" }),
  Object.freeze({ id: "thermal-imaging", label: "Thermal imaging inspection" }),
  Object.freeze({ id: "electrical", label: "General electrical work" }),
  Object.freeze({ id: "plumbing", label: "Plumbing services" }),
  Object.freeze({ id: "solar", label: "Rooftop solar" }),
  Object.freeze({ id: "battery", label: "Home battery" }),
  Object.freeze({ id: "heating-cooling", label: "Heating and cooling" }),
  Object.freeze({ id: "hot-water", label: "Hot water" }),
  Object.freeze({ id: "electric-cooking", label: "Electric cooking and cooktops" }),
  Object.freeze({ id: "draught-proofing", label: "Draught-proofing" }),
  Object.freeze({ id: "insulation", label: "Insulation" }),
  Object.freeze({ id: "glazing", label: "Glazing" }),
  Object.freeze({ id: "window-coverings", label: "Blinds, shutters and external shading" }),
  Object.freeze({ id: "ev-charging", label: "EV charging" }),
  Object.freeze({ id: "other", label: "Other energy upgrade" }),
]);

export const ENERGY_SERVICE_IDS = Object.freeze(
  ENERGY_SERVICE_CATALOGUE.map((service) => service.id),
);

export const ENERGY_SERVICE_OPTIONS = ENERGY_SERVICE_CATALOGUE.map(
  (service) => [service.id, service.label],
);

export const ENERGY_SERVICE_LABELS = Object.freeze(
  Object.fromEntries(ENERGY_SERVICE_CATALOGUE.map((service) => [service.id, service.label])),
);

const energyServiceIdSet = new Set(ENERGY_SERVICE_IDS);

export const TRADE_SERVICE_CATALOGUE = ENERGY_SERVICE_CATALOGUE.filter(({ id }) => !isAeaReservedService(id));
export const TRADE_SERVICE_OPTIONS = TRADE_SERVICE_CATALOGUE.map(({ id, label }) => [id, label]);
export const TRADE_SERVICE_IDS = Object.freeze(TRADE_SERVICE_OPTIONS.map(([id]) => id));

export function normalizeTradeServiceIds(value) {
  const normalized = normalizeEnergyServiceIds(value);
  return normalized && !normalized.some(isAeaReservedService) ? normalized : null;
}

export function isEnergyServiceId(value) {
  return typeof value === "string" && energyServiceIdSet.has(value);
}

export function normalizeEnergyServiceIds(value) {
  if (!Array.isArray(value)) return null;
  if (!value.every((item) => isEnergyServiceId(item))) return null;
  return [...new Set(value)];
}
