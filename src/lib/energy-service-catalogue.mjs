export const ENERGY_SERVICE_CATALOGUE = Object.freeze([
  Object.freeze({ id: "assessment", label: "Energy assessment" }),
  Object.freeze({ id: "blower-door-testing", label: "Blower door testing" }),
  Object.freeze({ id: "thermal-imaging", label: "Thermal imaging inspection" }),
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

export function isEnergyServiceId(value) {
  return typeof value === "string" && energyServiceIdSet.has(value);
}

export function normalizeEnergyServiceIds(value) {
  if (!Array.isArray(value)) return null;
  if (!value.every((item) => isEnergyServiceId(item))) return null;
  return [...new Set(value)];
}
