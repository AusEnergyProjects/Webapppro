import climateZoneArtifact from "../data/energy-rating-climate-zones.json" with { type: "json" };

const CLIMATE_BANDS = new Set(["hot", "average", "cold"]);
const zones = climateZoneArtifact.zones;

export const ENERGY_RATING_CLIMATE_SOURCE = Object.freeze({
  sourceUrl: climateZoneArtifact.source,
  retrievedAt: climateZoneArtifact.retrievedAt,
});

export function energyRatingClimateForPostcode(value) {
  const postcode = String(value || "").trim();
  if (!/^\d{4}$/.test(postcode)) return null;
  const record = Object.hasOwn(zones, postcode) ? zones[postcode] : null;
  if (!record || !CLIMATE_BANDS.has(record.band)) return null;
  const choices = [...new Set(record.choices)].filter((choice) => CLIMATE_BANDS.has(choice));
  if (!choices.includes(record.band)) choices.push(record.band);
  return Object.freeze({
    band: record.band,
    choices: Object.freeze(choices),
    hasMultipleBands: choices.length > 1,
  });
}

export function energyRatingClimateBandForPostcode(value) {
  return energyRatingClimateForPostcode(value)?.band ?? null;
}
