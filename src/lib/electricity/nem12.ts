import type {
  HalfHourlyGrid,
  Nem12DaySeries,
  Nem12ParseResult,
  Nem12Register,
  Nem12RegisterAllocationResult,
  Nem12RegisterDay,
  RegisterRole,
} from "./nem12-types.ts";

const HALF_HOUR_BINS = 48;
const VALID_INTERVALS = new Set([5, 15, 30]);

interface ParsedDate {
  stamp: number;
  dow: number;
}

interface Channel {
  nmi: string;
  registerId: string;
  suffix: string;
  meter: string;
  direction: "import" | "export" | null;
  scale: number;
  interval: 5 | 15 | 30 | null;
}

interface IntervalRecord {
  channel: Channel & { direction: "import" | "export"; interval: 5 | 15 | 30 };
  date: string;
  parsedDate: ParsedDate;
  values: number[];
  quality: string[];
}

interface RegisterBucket {
  channel: IntervalRecord["channel"];
  days: Map<string, Nem12RegisterDay>;
}

function emptyGrid(): HalfHourlyGrid {
  return Array.from({ length: 7 }, () => new Array(HALF_HOUR_BINS).fill(0));
}

function parseLocalDate(value: string): ParsedDate | null {
  if (!/^\d{8}$/.test(value)) return null;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(4, 6));
  const day = Number(value.slice(6, 8));
  const stamp = Date.UTC(year, month - 1, day);
  const check = new Date(stamp);
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
  return { stamp, dow: (check.getUTCDay() + 6) % 7 };
}

function suggestedRegisterRole(registerId: string, suffix: string): {
  role: RegisterRole | null;
  confidence: Nem12Register["roleConfidence"];
} {
  const value = `${registerId} ${suffix}`.toUpperCase();
  if (/CONTROL|CTRL|OFF[ _-]?PEAK|HOT[ _-]?WATER|\bCL\d*\b/.test(value)) return { role: "controlled", confidence: "explicit" };
  if (/^E1(?:\s|$)/.test(value) || /\sE1$/.test(value)) return { role: "general", confidence: "likely" };
  return { role: null, confidence: "review" };
}

function aggregateRecord(values: number[], interval: 5 | 15 | 30, target: number[]): void {
  values.forEach((value, index) => {
    const bin = Math.min(HALF_HOUR_BINS - 1, Math.floor((index * interval) / 30));
    target[bin] += value;
  });
}

function averageWeeklyProfile(grid: HalfHourlyGrid, dayCounts: number[]): HalfHourlyGrid {
  return grid.map((row, day) => row.map((value) => dayCounts[day] ? value / dayCounts[day] : 0));
}

export function allocateNem12Registers(registers: Nem12Register[], roles: Record<string, RegisterRole | undefined>): Nem12RegisterAllocationResult {
  const unresolved = registers.filter((register) => roles[register.id] !== "general" && roles[register.id] !== "controlled");
  if (unresolved.length) return { ok: false, unresolved: unresolved.map((register) => register.id) };
  const dates = new Map<string, { date: string; dow: number; stamp: number; general: number[]; controlled: number[] }>();
  let generalObservedKwh = 0;
  let controlledObservedKwh = 0;
  registers.forEach((register) => {
    const role = roles[register.id] as RegisterRole;
    if (role === "general") generalObservedKwh += register.observedKwh;
    else controlledObservedKwh += register.observedKwh;
    register.series.forEach((day) => {
      if (!dates.has(day.date)) dates.set(day.date, { date: day.date, dow: day.dow, stamp: day.stamp, general: new Array(48).fill(0), controlled: new Array(48).fill(0) });
      const target = dates.get(day.date)![role];
      day.values.forEach((value, bin) => { target[bin] += value; });
    });
  });
  const series = [...dates.values()].sort((a, b) => a.date.localeCompare(b.date));
  const generalGrid = emptyGrid();
  const controlledGrid = emptyGrid();
  const dayCounts = new Array(7).fill(0);
  series.forEach((day) => {
    dayCounts[day.dow] += 1;
    for (let bin = 0; bin < 48; bin += 1) {
      generalGrid[day.dow][bin] += day.general[bin];
      controlledGrid[day.dow][bin] += day.controlled[bin];
    }
  });
  const observedDays = Math.max(1, series.length);
  return {
    ok: true,
    series,
    generalObservedKwh,
    controlledObservedKwh,
    annualGeneralKwh: generalObservedKwh / observedDays * 365,
    annualControlledKwh: controlledObservedKwh / observedDays * 365,
    generalProfile: averageWeeklyProfile(generalGrid, dayCounts),
    controlledProfile: averageWeeklyProfile(controlledGrid, dayCounts),
    controlledRegisterIds: registers.filter((register) => roles[register.id] === "controlled").map((register) => register.id),
  };
}

export function scaleNem12AnnualAllocation(
  allocation: Extract<Nem12RegisterAllocationResult, { ok: true }>,
  targetAnnualKwh: number,
): { scale: number; annualGeneralKwh: number; annualControlledKwh: number } | null {
  const sourceTotal = allocation.annualGeneralKwh + allocation.annualControlledKwh;
  if (!(sourceTotal > 0) || !(targetAnnualKwh > 0) || !Number.isFinite(targetAnnualKwh)) return null;
  const scale = targetAnnualKwh / sourceTotal;
  return {
    scale,
    annualGeneralKwh: allocation.annualGeneralKwh * scale,
    annualControlledKwh: allocation.annualControlledKwh * scale,
  };
}

export function parseNem12(text: string): Nem12ParseResult {
  const lines = String(text || "").replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim() !== "");
  let channel: Channel | null = null;
  let lastRecord: IntervalRecord | null = null;
  let found100 = false;
  let found200 = false;
  let found300 = false;
  let found900 = false;
  let outOfOrder = false;
  let duplicateRecords = 0;
  const previousDateByChannel = new Map<string, string>();
  const nmis = new Set<string>();
  const importChannels = new Set<string>();
  const exportChannels = new Set<string>();
  const records = new Map<string, IntervalRecord>();

  lines.forEach((raw) => {
    const fields = raw.split(",");
    const type = String(fields[0] || "").trim();
    if (type === "100") {
      found100 = String(fields[1] || "").trim().toUpperCase() === "NEM12";
      return;
    }
    if (type === "200") {
      lastRecord = null;
      found200 = true;
      const nmi = String(fields[1] || "").trim();
      const registerId = String(fields[3] || "").trim();
      const suffix = String(fields[4] || "").trim().toUpperCase();
      const meter = String(fields[6] || "").trim();
      const unit = String(fields[7] || "").trim().toUpperCase();
      const parsedInterval = Number.parseInt(fields[8] || "", 10);
      if (nmi) nmis.add(nmi);
      const activeEnergy = unit === "WH" || unit === "KWH" || unit === "MWH";
      const direction = activeEnergy && suffix.startsWith("E") ? "import" : activeEnergy && suffix.startsWith("B") ? "export" : null;
      channel = {
        nmi,
        registerId,
        suffix,
        meter,
        direction,
        scale: unit === "WH" ? 0.001 : unit === "MWH" ? 1000 : 1,
        interval: VALID_INTERVALS.has(parsedInterval) ? parsedInterval as 5 | 15 | 30 : null,
      };
      if (direction === "import") importChannels.add(suffix);
      if (direction === "export") exportChannels.add(suffix);
      return;
    }
    if (type === "300" && channel?.direction && channel.interval) {
      found300 = true;
      const date = String(fields[1] || "").trim();
      const parsedDate = parseLocalDate(date);
      const count = 1440 / channel.interval;
      if (!parsedDate || fields.length < 2 + count) return;
      const orderKey = [channel.nmi, channel.suffix, channel.registerId, channel.meter].join("|");
      const previousDate = previousDateByChannel.get(orderKey);
      if (previousDate && date < previousDate) outOfOrder = true;
      previousDateByChannel.set(orderKey, date);
      const qualityMethod = String(fields[2 + count] || "").trim().toUpperCase() || "U";
      const values = new Array<number>(count);
      const quality = new Array<string>(count);
      for (let index = 0; index < count; index += 1) {
        const value = Number(fields[2 + index]);
        values[index] = Number.isFinite(value) && value >= 0 ? value * channel.scale : 0;
        quality[index] = qualityMethod.charAt(0) || "U";
      }
      const record: IntervalRecord = {
        channel: { ...channel, direction: channel.direction, interval: channel.interval },
        date,
        parsedDate,
        values,
        quality,
      };
      const key = [channel.nmi, channel.suffix, channel.registerId, channel.meter, date].join("|");
      if (records.has(key)) duplicateRecords += 1;
      records.set(key, record);
      lastRecord = record;
      return;
    }
    if (type === "400" && lastRecord) {
      const start = Math.max(1, Number.parseInt(fields[1] || "", 10) || 1);
      const end = Math.min(lastRecord.quality.length, Number.parseInt(fields[2] || "", 10) || lastRecord.quality.length);
      const flag = String(fields[3] || "U").trim().toUpperCase().charAt(0) || "U";
      for (let index = start - 1; index < end; index += 1) lastRecord.quality[index] = flag;
      return;
    }
    if (type === "900") found900 = true;
  });

  if (!found100 || !found200 || !found300 || !found900) {
    return { ok: false, err: "This is not a complete NEM12 file. It must contain valid 100, 200, 300 and 900 records." };
  }
  if (nmis.size > 1) return { ok: false, err: "This file contains more than one NMI. Please export one connection point at a time so separate households are not combined." };
  if (!importChannels.size) return { ok: false, err: "No active-energy usage channel was found. Please download detailed NEM12 consumption data for this NMI." };

  const byDate = new Map<string, Nem12DaySeries>();
  const registerDates = new Map<string, RegisterBucket>();
  const qualityCounts: Record<string, number> = {};
  const intervalLengths = new Set<5 | 15 | 30>();
  records.forEach((record) => {
    const direction = record.channel.direction;
    intervalLengths.add(record.channel.interval);
    if (!byDate.has(record.date)) {
      byDate.set(record.date, {
        date: record.date,
        dow: record.parsedDate.dow,
        stamp: record.parsedDate.stamp,
        import: new Array(HALF_HOUR_BINS).fill(0),
        export: new Array(HALF_HOUR_BINS).fill(0),
        importSeen: false,
        exportSeen: false,
      });
    }
    const day = byDate.get(record.date)!;
    if (direction === "import") day.importSeen = true;
    else day.exportSeen = true;
    aggregateRecord(record.values, record.channel.interval, day[direction]);
    if (direction === "import") {
      record.quality.forEach((flag) => { qualityCounts[flag || "U"] = (qualityCounts[flag || "U"] || 0) + 1; });
      const registerKey = [record.channel.suffix, record.channel.registerId, record.channel.meter].join("|");
      if (!registerDates.has(registerKey)) registerDates.set(registerKey, { channel: record.channel, days: new Map() });
      const bucket = registerDates.get(registerKey)!;
      if (!bucket.days.has(record.date)) {
        bucket.days.set(record.date, { date: record.date, dow: record.parsedDate.dow, stamp: record.parsedDate.stamp, values: new Array(HALF_HOUR_BINS).fill(0) });
      }
      aggregateRecord(record.values, record.channel.interval, bucket.days.get(record.date)!.values);
    }
  });

  const series = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  const importDays = series.filter((day) => day.importSeen);
  const exportDays = series.filter((day) => day.exportSeen);
  if (importDays.length < 7) return { ok: false, err: `The file covers less than a week of usage (${importDays.length} days). Please download at least a few weeks, ideally 12 months.` };

  const grid = emptyGrid();
  const exportGrid = emptyGrid();
  const dowCount = new Array(7).fill(0);
  const exportDowCount = new Array(7).fill(0);
  let importKwh = 0;
  let exportKwh = 0;
  importDays.forEach((day) => {
    dowCount[day.dow] += 1;
    for (let bin = 0; bin < HALF_HOUR_BINS; bin += 1) {
      grid[day.dow][bin] += day.import[bin];
      importKwh += day.import[bin];
    }
  });
  exportDays.forEach((day) => {
    exportDowCount[day.dow] += 1;
    for (let bin = 0; bin < HALF_HOUR_BINS; bin += 1) {
      exportGrid[day.dow][bin] += day.export[bin];
      exportKwh += day.export[bin];
    }
  });

  const first = importDays[0];
  const last = importDays[importDays.length - 1];
  const dateSpanDays = Math.round((last.stamp - first.stamp) / 86400000) + 1;
  const coverageRatio = dateSpanDays > 0 ? importDays.length / dateSpanDays : 0;
  const qualityTotal = Object.values(qualityCounts).reduce((sum, count) => sum + count, 0);
  const actualPct = qualityTotal ? (qualityCounts.A || 0) / qualityTotal : 0;
  const fullYear = importDays.length >= 330 && dateSpanDays >= 330 && coverageRatio >= 0.9;
  const annualImport = importKwh / importDays.length * 365;
  const annualExport = exportDays.length ? exportKwh / exportDays.length * 365 : 0;
  const registers: Nem12Register[] = [...registerDates.values()].map((bucket) => {
    const registerSeries = [...bucket.days.values()].sort((a, b) => a.date.localeCompare(b.date));
    const observedKwh = registerSeries.reduce((total, day) => total + day.values.reduce((sum, value) => sum + value, 0), 0);
    const suggestion = suggestedRegisterRole(bucket.channel.registerId, bucket.channel.suffix);
    return {
      id: "",
      registerId: bucket.channel.registerId,
      suffix: bucket.channel.suffix,
      direction: "import" as const,
      intervalMinutes: bucket.channel.interval,
      observedKwh,
      annualKwh: registerSeries.length ? observedKwh / registerSeries.length * 365 : 0,
      observedDays: registerSeries.length,
      suggestedRole: suggestion.role,
      roleConfidence: suggestion.confidence,
      series: registerSeries,
    };
  }).sort((a, b) => `${a.suffix}|${a.registerId}`.localeCompare(`${b.suffix}|${b.registerId}`));
  registers.forEach((register, index) => { register.id = `import-${index + 1}`; });

  let confidence: "low" | "indicative" | "good" | "high" = "low";
  if (fullYear && actualPct >= 0.9) confidence = "high";
  else if (importDays.length >= 180 && coverageRatio >= 0.85) confidence = "good";
  else if (importDays.length >= 28) confidence = "indicative";
  const warnings: string[] = [];
  if (!fullYear) warnings.push(`Annual usage is extrapolated from ${importDays.length} days and may not capture seasonal heating, cooling or holiday behaviour.`);
  if (coverageRatio < 0.9) warnings.push(`Only ${Math.round(coverageRatio * 100)}% of calendar days in the file span contain usage records.`);
  if (actualPct < 0.9) warnings.push(`${Math.round(actualPct * 100)}% of usage intervals are marked actual; the remainder include estimated, substituted or unknown quality data.`);
  if (outOfOrder) warnings.push("Daily records were out of order. They were sorted before analysis.");
  if (duplicateRecords) warnings.push(`${duplicateRecords} duplicate channel-day record${duplicateRecords === 1 ? " was" : "s were"} replaced by the latest record.`);
  if (importChannels.size > 1) warnings.push("Multiple consumption registers were preserved separately. Confirm which register is general usage and which is controlled load before comparing plans.");

  return {
    ok: true,
    nmi: [...nmis][0] || null,
    importKwh,
    exportKwh,
    annualImport,
    annualExport,
    spanDays: importDays.length,
    dateSpanDays,
    coverageRatio,
    startDate: first.date,
    endDate: last.date,
    fullYear,
    confidence,
    actualPct,
    warnings,
    profile: grid,
    grid,
    exportProfile: exportGrid,
    exportGrid,
    dowCount,
    exportDowCount,
    series,
    eChannels: importChannels,
    bChannels: exportChannels,
    intervalLengths: [...intervalLengths].sort((a, b) => a - b),
    qualityCounts,
    registers,
  };
}
