import type { NemRegionId } from "./nem-wholesale.ts";

export const GAS_DAY_MS = 24 * 60 * 60 * 1000;
export const GAS_HISTORY_MS = 7 * GAS_DAY_MS;

export const GAS_MARKETS = [
  {
    regionId: "NSW1",
    label: "Sydney gas",
    description: "Daily Sydney hub price, not a NSW or ACT-wide price",
    cadence: "Daily ex-ante hub price",
    source: "sttm",
  },
  {
    regionId: "QLD1",
    label: "Brisbane gas",
    description: "Daily Brisbane hub price, not a statewide price",
    cadence: "Daily ex-ante hub price",
    source: "sttm",
  },
  {
    regionId: "VIC1",
    label: "Victorian gas",
    description: "Victorian wholesale gas market schedule",
    cadence: "Scheduled market price",
    source: "dwgm",
  },
  {
    regionId: "SA1",
    label: "Adelaide gas",
    description: "Daily Adelaide hub price, not a statewide price",
    cadence: "Daily ex-ante hub price",
    source: "sttm",
  },
] as const satisfies readonly {
  regionId: NemRegionId;
  label: string;
  description: string;
  cadence: string;
  source: "sttm" | "dwgm";
}[];

export type GasRegionId = typeof GAS_MARKETS[number]["regionId"];
export type GasSource = typeof GAS_MARKETS[number]["source"];
export type GasPriceStatus = "verified" | "forecast";
export type GasPoint = {
  time: number;
  validUntil: number;
  centsPerKwh: number;
  dollarsPerGj: number;
  basis: "daily-ex-ante" | "schedule";
  status: GasPriceStatus;
};
export type GasRegion = { id: GasRegionId; points: GasPoint[] };
export type GasSnapshot = {
  fetchedAt: number;
  regions: GasRegion[];
  refreshFailed: boolean;
  failedSources: GasSource[];
};

type CsvRow = Record<string, string>;
type GasValueSlot = { verified?: number | null; forecast?: number | null };

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function parseNumber(value: string | undefined): number | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') { cell += '"'; index += 1; }
      else quoted = !quoted;
    } else if (character === "," && !quoted) {
      cells.push(cell.trim());
      cell = "";
    } else cell += character;
  }
  if (quoted) throw new Error("Invalid gas CSV quoting");
  cells.push(cell.trim());
  return cells;
}

function parseCsv(text: string, expectedHeaders: readonly string[]): CsvRow[] {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim() !== "");
  if (lines.length < 2 || lines.length > 1000) throw new Error("Invalid gas CSV row count");
  const headers = splitCsvLine(lines[0]);
  if (headers.length !== expectedHeaders.length || !headers.every((header, index) => header === expectedHeaders[index])) throw new Error("Invalid gas CSV headers");
  return lines.slice(1).map((line) => {
    const cells = splitCsvLine(line);
    if (cells.length !== headers.length) throw new Error("Invalid gas CSV row");
    return Object.fromEntries(headers.map((header, index) => [header, cells[index]]));
  });
}

function parseAestDateTime(value: string | undefined): number | null {
  const match = /^(\d{4})\/(\d{2})\/(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(value ?? "");
  if (!match) return null;
  const local = `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}`;
  const timestamp = Date.parse(`${local}+10:00`);
  if (!Number.isFinite(timestamp) || new Date(timestamp + 10 * 60 * 60 * 1000).toISOString().slice(0, 19) !== local) return null;
  return timestamp;
}

function gasDayStart(value: string | undefined): number | null {
  const timestamp = parseAestDateTime(value);
  if (timestamp === null || !value?.endsWith(" 00:00:00")) return null;
  return timestamp + 6 * 60 * 60 * 1000;
}

export function dollarsPerGjToCentsPerKwh(value: number): number {
  return value * 0.36;
}

function regionForHub(hub: string): GasRegionId | null {
  if (hub === "Sydney") return "NSW1";
  if (hub === "Brisbane") return "QLD1";
  if (hub === "Adelaide") return "SA1";
  return null;
}

function nextDwgmSchedule(time: number): number {
  const local = new Date(time + 10 * 60 * 60 * 1000);
  const minutes = local.getUTCHours() * 60 + local.getUTCMinutes();
  const next = [6 * 60, 10 * 60, 14 * 60, 18 * 60, 22 * 60].find((schedule) => schedule > minutes);
  return time + ((next ?? 30 * 60) - minutes) * 60_000;
}

function isStandardDwgmSchedule(time: number, interval: number): boolean {
  const local = new Date(time + 10 * 60 * 60 * 1000);
  const scheduledHour = [6, 10, 14, 18, 22][interval - 1];
  return scheduledHour !== undefined
    && local.getUTCHours() === scheduledHour
    && local.getUTCMinutes() === 0
    && local.getUTCSeconds() === 0;
}

function gasPriceStatus(value: string | undefined): GasPriceStatus | null {
  if (value === "ACTUAL") return "verified";
  if (value === "FORECAST") return "forecast";
  return null;
}

function recordGasValue<Key>(values: Map<Key, GasValueSlot>, key: Key, status: GasPriceStatus, price: number): void {
  const slot = values.get(key) ?? {};
  if (!(status in slot)) slot[status] = price;
  else if (slot[status] !== price) slot[status] = null;
  values.set(key, slot);
}

function resolvedGasValue(slot: GasValueSlot): { dollarsPerGj: number; status: GasPriceStatus } | null {
  if ("verified" in slot) return slot.verified === null || slot.verified === undefined ? null : { dollarsPerGj: slot.verified, status: "verified" };
  return slot.forecast === null || slot.forecast === undefined ? null : { dollarsPerGj: slot.forecast, status: "forecast" };
}

function pointsFromMap(values: Map<number, GasValueSlot>, basis: GasPoint["basis"]): GasPoint[] {
  const ordered = [...values.entries()].flatMap(([time, slot]) => {
    const resolved = resolvedGasValue(slot);
    return resolved ? [{ time, ...resolved }] : [];
  }).sort((left, right) => left.time - right.time);
  return ordered.map(({ time, dollarsPerGj, status }, index) => ({
    time,
    validUntil: basis === "daily-ex-ante" ? time + GAS_DAY_MS : Math.min(ordered[index + 1]?.time ?? Infinity, nextDwgmSchedule(time)),
    dollarsPerGj,
    centsPerKwh: dollarsPerGjToCentsPerKwh(dollarsPerGj),
    basis,
    status,
  }));
}

function retainEffectiveTime(time: number, now: number): boolean {
  return time <= now + 5 * 60 * 1000 && time >= now - GAS_HISTORY_MS;
}

export function normaliseSttmGas(csv: string, now: number): GasRegion[] {
  const rows = parseCsv(csv, ["GAS_DATE", "HUB_DESCRIPTION", "EX_ANTE_PRICE", "EX_ANTE_TJ", "EX_POST_PRICE", "EX_POST_TJ", "PERIODTYPE"]);
  const values = new Map<GasRegionId, Map<number, GasValueSlot>>([
    ["NSW1", new Map()], ["QLD1", new Map()], ["SA1", new Map()],
  ]);
  for (const row of rows) {
    const status = gasPriceStatus(row.PERIODTYPE);
    const id = regionForHub(row.HUB_DESCRIPTION);
    const time = gasDayStart(row.GAS_DATE);
    const price = parseNumber(row.EX_ANTE_PRICE);
    if (!status || !id || time === null || price === null || !retainEffectiveTime(time, now)) continue;
    recordGasValue(values.get(id)!, time, status, price);
  }
  const regions = [...values.entries()].map(([id, points]) => ({ id, points: pointsFromMap(points, "daily-ex-ante") }));
  if (!regions.some((region) => region.points.length)) throw new Error("No recent STTM gas prices");
  return regions;
}

export function normaliseDwgmGas(csv: string, now: number): GasRegion {
  const rows = parseCsv(csv, ["DATETIME", "INTERVAL_NO", "TRANSMISSION_ID", "PRICE", "DEMAND", "PERIODTYPE"]);
  const values = new Map<number, GasValueSlot>();
  const intervalKeys = new Map<string, GasValueSlot>();
  for (const row of rows) {
    const status = gasPriceStatus(row.PERIODTYPE);
    const time = parseAestDateTime(row.DATETIME);
    const interval = parseNumber(row.INTERVAL_NO);
    const price = parseNumber(row.PRICE);
    if (!status || time === null || interval === null || !Number.isInteger(interval) || !isStandardDwgmSchedule(time, interval) || price === null || !retainEffectiveTime(time, now)) continue;
    const key = `${time}:${interval}`;
    recordGasValue(intervalKeys, key, status, price);
  }
  for (const [key, slot] of intervalKeys) {
    const resolved = resolvedGasValue(slot);
    if (!resolved) continue;
    const time = Number(key.split(":", 1)[0]);
    recordGasValue(values, time, resolved.status, resolved.dollarsPerGj);
  }
  const region = { id: "VIC1" as const, points: pointsFromMap(values, "schedule") };
  if (!region.points.length) throw new Error("No recent DWGM gas prices");
  return region;
}

export function gasMarketForRegion(id: NemRegionId) {
  return GAS_MARKETS.find((market) => market.regionId === id) ?? null;
}

export function gasPointAt(points: readonly GasPoint[], time: number): GasPoint | null {
  return points.findLast((point) => point.time <= time && time < point.validUntil) ?? null;
}

// Gas prices apply until the next published daily or scheduled market price, so the line is stepped rather than interpolated.
export function gasChartPath(points: readonly GasPoint[], start: number, end: number, xFor: (time: number) => number, yFor: (value: number) => number, status?: GasPriceStatus): string {
  const ordered = points.filter((point) => point.time < end && point.validUntil > start && (!status || point.status === status)).toSorted((left, right) => left.time - right.time);
  let path = "";
  let previousEnd: number | null = null;
  for (const point of ordered) {
    const segmentStart = Math.max(start, point.time);
    const segmentEnd = Math.min(end, point.validUntil);
    if (segmentEnd <= segmentStart) continue;
    const command = previousEnd === segmentStart ? "L" : "M";
    path += `${path ? " " : ""}${command}${xFor(segmentStart).toFixed(2)},${yFor(point.centsPerKwh).toFixed(2)} L${xFor(segmentEnd).toFixed(2)},${yFor(point.centsPerKwh).toFixed(2)}`;
    previousEnd = segmentEnd;
  }
  return path;
}

export function isGasSnapshot(value: unknown): value is GasSnapshot {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const snapshot = value as Partial<GasSnapshot>;
  if (!finite(snapshot.fetchedAt) || typeof snapshot.refreshFailed !== "boolean" || !Array.isArray(snapshot.failedSources) || snapshot.failedSources.some((source) => source !== "sttm" && source !== "dwgm") || new Set(snapshot.failedSources).size !== snapshot.failedSources.length || snapshot.refreshFailed !== (snapshot.failedSources.length > 0) || !Array.isArray(snapshot.regions) || snapshot.regions.length !== GAS_MARKETS.length) return false;
  const ids = new Set<GasRegionId>();
  for (const region of snapshot.regions) {
    if (typeof region !== "object" || region === null || !GAS_MARKETS.some(({ regionId }) => regionId === region.id) || ids.has(region.id) || !Array.isArray(region.points) || region.points.length > 100) return false;
    const market = GAS_MARKETS.find(({ regionId }) => regionId === region.id)!;
    const expectedBasis = market.source === "sttm" ? "daily-ex-ante" : "schedule";
    ids.add(region.id);
    let previous = -Infinity;
    for (const point of region.points) {
      if (typeof point !== "object" || point === null || !finite(point.time) || point.time <= previous || !finite(point.validUntil) || point.validUntil <= point.time || point.validUntil - point.time > GAS_DAY_MS || point.time < snapshot.fetchedAt - GAS_HISTORY_MS || point.time > snapshot.fetchedAt + 5 * 60_000 || !finite(point.centsPerKwh) || !finite(point.dollarsPerGj) || point.basis !== expectedBasis || (point.status !== "verified" && point.status !== "forecast")) return false;
      if (Math.abs(point.centsPerKwh - dollarsPerGjToCentsPerKwh(point.dollarsPerGj)) > 1e-9) return false;
      previous = point.time;
    }
  }
  return ids.size === GAS_MARKETS.length && snapshot.regions.some((region) => region.points.length > 0);
}
