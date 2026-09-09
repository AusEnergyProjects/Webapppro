/** Availability is checked at use time, including when a cached plan is served. */
export function isElectricityPlanAvailable(plan, now = Date.now()) {
  const from = plan.effectiveFrom == null || plan.effectiveFrom === "" ? null : Date.parse(plan.effectiveFrom);
  const to = plan.effectiveTo == null || plan.effectiveTo === "" ? null : Date.parse(plan.effectiveTo);
  return (from === null || (Number.isFinite(from) && from <= now))
    && (to === null || (Number.isFinite(to) && to > now))
    && (from === null || to === null || from < to);
}

/** Match the engine's 365-day annual estimate; never fill gaps with guessed rates. */
export function electricitySeasonCoverageError(periods) {
  const energy = periods.filter((period) => period.rateBlockUType !== "demandCharges");
  if (!energy.length) return "No energy tariff seasons were published.";
  const ranges = [];
  for (const period of energy) {
    if (period.startDate == null && period.endDate == null) {
      ranges.push([101, 1231]);
      continue;
    }
    const values = [period.startDate, period.endDate].map((value) => {
      if (!/^\d{2}-\d{2}$/.test(value || "")) return null;
      const [month, day] = value.split("-").map(Number);
      const date = new Date(Date.UTC(2024, month - 1, day));
      return date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? month * 100 + day : null;
    });
    if (values.some((value) => value === null)) return "Tariff season dates are incomplete or invalid.";
    ranges.push(values);
  }
  for (let day = 0; day < 365; day += 1) {
    const date = new Date(Date.UTC(2025, 0, day + 1));
    const monthDay = (date.getUTCMonth() + 1) * 100 + date.getUTCDate();
    const count = ranges.filter(([start, end]) => start <= end
      ? monthDay >= start && monthDay <= end
      : monthDay >= start || monthDay <= end).length;
    if (count !== 1) return count === 0
      ? "Published tariff seasons do not cover a complete year."
      : "Published tariff seasons overlap, so the annual cost is ambiguous.";
  }
  return null;
}

const DAY_INDEX = { MON: 0, TUE: 1, WED: 2, THU: 3, FRI: 4, SAT: 5, SUN: 6 };

function matchesWindow(day, bin, windows) {
  const hour = bin / 2 + 0.25;
  return windows.some((window) => {
    const days = window.days.map((value) => String(value).toUpperCase());
    if (!days.includes('ALL') && !days.some((value) => DAY_INDEX[value] === day || (['WEEKDAYS', 'BUSINESS_DAYS'].includes(value) && day < 5))) return false;
    const decimal = (value) => Number(value.slice(0, 2)) + Number(value.slice(3, 5)) / 60;
    const start = decimal(window.startTime);
    const end = decimal(window.endTime) || 24;
    return start <= end ? hour >= start && hour < end : hour >= start || hour < end;
  });
}

export function electricityFeedInLimitation(contract, annualExportKwh, exportProfile) {
  if (!(Number(annualExportKwh) > 0)) return null;
  const tariffs = (contract.solarFeedInTariff || []).filter((tariff) => !String(tariff.scheme || "").toUpperCase().includes("PREMIUM"));
  if (tariffs.length > 1) return "Multiple solar feed-in tariffs need an eligibility check before this plan can be ranked.";
  const tariff = tariffs[0];
  if (!tariff) return null;
  if (tariff.startDate || tariff.endDate) return "Dated solar feed-in rates need a matching export period before this plan can be ranked.";
  const flatRate = (rates) => rates?.length === 1
    && rates[0].volume == null
    && (rates[0].measureUnit == null || rates[0].measureUnit === "KWH")
    && rates[0].unitPrice != null && rates[0].unitPrice !== ""
    && Number.isFinite(Number(rates[0].unitPrice)) && Number(rates[0].unitPrice) >= 0;
  if (tariff.singleTariff && !tariff.timeVaryingTariffs?.length && flatRate(tariff.singleTariff.rates)) return null;
  const variations = tariff.timeVaryingTariffs;
  if (tariff.singleTariff || !variations?.length || variations.some((variation) => !flatRate(variation.rates))) {
    return "Stepped or unsupported solar feed-in rates cannot yet be ranked accurately for your exports.";
  }
  if (!exportProfile) return "Time-varying solar feed-in rates require an export profile.";
  const validTime = (value) => typeof value === "string"
    && /^(?:[01]\d|2[0-3]):[0-5]\d(?::00)?$|^24:00(?::00)?$/.test(value);
  const validDay = (value) => ["BUSINESS_DAYS", "WEEKDAYS"].includes(value)
    || DAY_INDEX[value] != null;
  if (variations.some((variation) => {
    const windows = variation.timeVariations || variation.timeOfUse;
    return !windows?.length || windows.some((window) => !window.days?.length
      || window.days.some((day) => !validDay(String(day).toUpperCase()))
      || !validTime(window.startTime) || !validTime(window.endTime));
  })) return "Solar feed-in time windows are missing or invalid.";
  for (let day = 0; day < 7; day += 1) for (let bin = 0; bin < 48; bin += 1) {
    if (variations.filter((variation) => matchesWindow(day, bin, variation.timeVariations || variation.timeOfUse)).length !== 1) {
      return "Solar feed-in time windows are incomplete or overlapping.";
    }
  }
  return null;
}
