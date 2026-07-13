import type { Nem12ChartModel, Nem12Success } from "./nem12-types.ts";

const BINS = 48;

export function buildNem12ChartModel(data: Nem12Success): Nem12ChartModel {
  const average = new Array(BINS).fill(0);
  const weekday = new Array(BINS).fill(0);
  const weekend = new Array(BINS).fill(0);
  const weekdayDays = data.dowCount.slice(0, 5).reduce((sum, count) => sum + count, 0);
  const weekendDays = data.dowCount.slice(5).reduce((sum, count) => sum + count, 0);

  for (let bin = 0; bin < BINS; bin += 1) {
    let all = 0;
    let weekdayTotal = 0;
    let weekendTotal = 0;
    for (let day = 0; day < 7; day += 1) {
      const value = data.grid[day][bin];
      all += value;
      if (day < 5) weekdayTotal += value;
      else weekendTotal += value;
    }
    average[bin] = all / Math.max(1, data.spanDays);
    weekday[bin] = weekdayDays ? weekdayTotal / weekdayDays : average[bin];
    weekend[bin] = weekendDays ? weekendTotal / weekendDays : 0;
  }

  let busiestBin = 0;
  let maximum = 0.001;
  for (let bin = 0; bin < BINS; bin += 1) {
    if (average[bin] > average[busiestBin]) busiestBin = bin;
    maximum = Math.max(maximum, weekday[bin], weekend[bin]);
  }

  let peak = 0;
  let shoulder = 0;
  let offPeak = 0;
  let total = 0;
  for (let day = 0; day < 7; day += 1) {
    for (let bin = 0; bin < BINS; bin += 1) {
      const value = data.grid[day][bin];
      const hour = bin / 2;
      total += value;
      if (day >= 5 || hour < 7 || hour >= 22) offPeak += value;
      else if (hour >= 15 && hour < 21) peak += value;
      else shoulder += value;
    }
  }
  const percent = (value: number) => total > 0 ? Math.round(value / total * 100) : 0;

  return {
    weekday,
    weekend: weekendDays ? weekend : null,
    maximum,
    busiestBin,
    averageDailyKwh: data.importKwh / Math.max(1, data.spanDays),
    peakPercent: percent(peak),
    shoulderPercent: percent(shoulder),
    offPeakPercent: percent(offPeak),
  };
}

export function formatHalfHourBin(bin: number): string {
  const hour = Math.floor(bin / 2);
  const minute = (bin % 2) * 30;
  const suffix = hour >= 12 ? "pm" : "am";
  const hour12 = hour % 12 || 12;
  return `${hour12}${minute ? `.${String(minute).padStart(2, "0")}` : ""}${suffix}`;
}
