function activeAreas(value) {
  try {
    const parsed = JSON.parse(String(value || "[]"));
    if (!Array.isArray(parsed)) return { present: false, values: [] };
    return {
      present: parsed.length > 0,
      values: parsed.flatMap((area) => {
        if (!area || typeof area !== "object") return [];
        const postcode = String(area.postcode || "");
        const radiusKm = Number(area.radiusKm);
        return /^\d{4}$/.test(postcode)
          && Number.isFinite(radiusKm)
          && radiusKm >= 1
          ? [{ postcode, radiusKm }]
          : [];
      }),
    };
  } catch {
    return { present: false, values: [] };
  }
}

export function closestQualifyingTradeServiceArea(input, distanceBetween) {
  const configuredAreas = activeAreas(input.activeServiceAreas);
  const areas = configuredAreas.present
    ? configuredAreas.values
    : [{
        postcode: String(input.legacyPostcode || ""),
        radiusKm: Number(input.legacyRadiusKm || 50),
      }];
  return areas
    .map((area) => ({
      ...area,
      distanceKm: distanceBetween(area.postcode, String(input.destinationPostcode || "")),
    }))
    .filter((area) =>
      area.distanceKm !== null
      && Number.isFinite(area.distanceKm)
      && Number.isFinite(area.radiusKm)
      && area.radiusKm >= 1
      && area.distanceKm <= area.radiusKm)
    .sort((left, right) => left.distanceKm - right.distanceKm)[0] || null;
}
