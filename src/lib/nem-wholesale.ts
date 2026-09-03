export const NEM_SOURCE_URL = "https://www.aemo.com.au/energy-systems/electricity/national-electricity-market-nem/data-nem/data-dashboard-nem";
export const NEM_INTERVAL_MS = 5 * 60 * 1000;
export const NEM_DAY_MS = 24 * 60 * 60 * 1000;
export const NEM_STALE_MS = 15 * 60 * 1000;
export const NEM_REGIONS = [
  { id: "NSW1", label: "NSW / ACT", name: "New South Wales & ACT", colour: "#63cfff" },
  { id: "QLD1", label: "QLD", name: "Queensland", colour: "#ffd078" },
  { id: "VIC1", label: "VIC", name: "Victoria", colour: "#baa4ff" },
  { id: "SA1", label: "SA", name: "South Australia", colour: "#ff95aa" },
  { id: "TAS1", label: "TAS", name: "Tasmania", colour: "#70e7bf" },
] as const;
export type NemRegionId = typeof NEM_REGIONS[number]["id"];
export type NemPoint = { time: number; centsPerKwh: number | null };
export type NemRegion = { id: NemRegionId; points: NemPoint[] };
export type NemFlow = { id: string; from: NemRegionId; to: NemRegionId; mw: number; time: number };
export type NemSnapshot = {
  fetchedAt: number;
  windowEnd: number;
  regions: NemRegion[];
  flows: NemFlow[];
  refreshFailed: boolean;
};

export const NEM_CONNECTORS: readonly { id: string; label: string; from: NemRegionId; to: NemRegionId }[] = [
  { id: "NSW1-QLD1", label: "Queensland to New South Wales link", from: "NSW1", to: "QLD1" },
  { id: "N-Q-MNSP1", label: "Terranora", from: "NSW1", to: "QLD1" },
  { id: "VIC1-NSW1", label: "Victoria to New South Wales link", from: "VIC1", to: "NSW1" },
  { id: "V-SA", label: "Heywood", from: "VIC1", to: "SA1" },
  { id: "V-S-MNSP1", label: "Murraylink", from: "VIC1", to: "SA1" },
  { id: "T-V-MNSP1", label: "Basslink", from: "TAS1", to: "VIC1" },
];

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isRegionId(value: unknown): value is NemRegionId {
  return NEM_REGIONS.some((region) => region.id === value);
}
function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

// AEMO's timezone-less interval end is AEST (UTC+10), including during daylight saving.
export function parseNemTime(value: unknown): number | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00$/.test(value)) return null;
  const timestamp = Date.parse(`${value}+10:00`);
  if (!Number.isFinite(timestamp) || timestamp % NEM_INTERVAL_MS !== 0) return null;
  if (new Date(timestamp + 10 * 60 * 60 * 1000).toISOString().slice(0, 19) !== value) return null;
  return timestamp;
}

export function normaliseNemHistory(payload: unknown, now: number): Pick<NemSnapshot, "windowEnd" | "regions"> {
  if (!isRecord(payload) || !Array.isArray(payload["5MIN"]) || payload["5MIN"].length > 10000) throw new Error("Invalid AEMO price response");
  const records = new Map<NemRegionId, Map<number, number | null>>(NEM_REGIONS.map(({ id }) => [id, new Map()]));
  let windowEnd = 0;
  for (const row of payload["5MIN"]) {
    if (!isRecord(row) || row.PERIODTYPE !== "ACTUAL" || !isRegionId(row.REGIONID)) continue;
    const time = parseNemTime(row.SETTLEMENTDATE);
    if (time === null || time > now + NEM_INTERVAL_MS || time < now - NEM_DAY_MS * 2) continue;
    const points = records.get(row.REGIONID)!;
    const value = finite(row.RRP) ? row.RRP / 10 : null; // $/MWh -> c/kWh. Negative prices remain negative.
    if (points.has(time) && points.get(time) !== value) points.set(time, null);
    else points.set(time, value);
  }
  for (const points of records.values()) {
    for (const [time, value] of points) if (value !== null) windowEnd = Math.max(windowEnd, time);
  }
  if (!windowEnd || now - windowEnd > NEM_DAY_MS) throw new Error("No recent AEMO price readings");
  return {
    windowEnd,
    regions: NEM_REGIONS.map(({ id }) => ({
      id,
      points: Array.from({ length: 288 }, (_, index) => {
        const time = windowEnd - (287 - index) * NEM_INTERVAL_MS;
        return { time, centsPerKwh: records.get(id)!.get(time) ?? null };
      }),
    })),
  };
}

export function normaliseNemFlows(payload: unknown, now: number): NemFlow[] {
  if (!isRecord(payload) || !Array.isArray(payload.ELEC_NEM_SUMMARY)) return [];
  const found = new Map<string, NemFlow>();
  const conflicts = new Set<string>();
  for (const row of payload.ELEC_NEM_SUMMARY) {
    if (!isRecord(row) || !isRegionId(row.REGIONID) || typeof row.INTERCONNECTORFLOWS !== "string" || row.INTERCONNECTORFLOWS.length > 20000) continue;
    const time = parseNemTime(row.SETTLEMENTDATE);
    if (time === null || time > now + NEM_INTERVAL_MS || now - time > NEM_DAY_MS) continue;
    let values: unknown;
    try { values = JSON.parse(row.INTERCONNECTORFLOWS); } catch { continue; }
    if (!Array.isArray(values)) continue;
    for (const value of values) {
      if (!isRecord(value) || !finite(value.value)) continue;
      const connector = NEM_CONNECTORS.find(({ id }) => id === value.name);
      if (!connector || (row.REGIONID !== connector.from && row.REGIONID !== connector.to)) continue;
      const existing = found.get(connector.id);
      const flow = { id: connector.id, from: value.value < 0 ? connector.to : connector.from, to: value.value < 0 ? connector.from : connector.to, mw: Math.abs(value.value), time };
      if (existing && existing.time > time) continue;
      if (existing && existing.time === time && (existing.mw !== flow.mw || existing.from !== flow.from)) conflicts.add(connector.id);
      else if (!existing || existing.time < time) conflicts.delete(connector.id);
      found.set(connector.id, flow);
    }
  }
  return NEM_CONNECTORS.flatMap(({ id }) => found.has(id) && !conflicts.has(id) ? [found.get(id)!] : []);
}

export function isNemSnapshot(value: unknown): value is NemSnapshot {
  if (!isRecord(value) || !finite(value.fetchedAt) || !finite(value.windowEnd) || typeof value.refreshFailed !== "boolean" || !Array.isArray(value.regions) || value.regions.length !== 5 || !Array.isArray(value.flows) || value.flows.length > 6) return false;
  const regionIds = new Set();
  let hasReading = false;
  for (const region of value.regions) {
    if (!isRecord(region) || !isRegionId(region.id) || regionIds.has(region.id) || !Array.isArray(region.points) || region.points.length !== 288) return false;
    regionIds.add(region.id);
    if (!region.points.every((point, index) => isRecord(point) && point.time === Number(value.windowEnd) - (287 - index) * NEM_INTERVAL_MS && (point.centsPerKwh === null || finite(point.centsPerKwh)))) return false;
    if (region.points.some((point) => isRecord(point) && finite(point.centsPerKwh))) hasReading = true;
  }
  return hasReading && value.flows.every((flow) => isRecord(flow) && NEM_CONNECTORS.some(({id}) => id === flow.id) && isRegionId(flow.from) && isRegionId(flow.to) && flow.from !== flow.to && finite(flow.mw) && flow.mw >= 0 && finite(flow.time));
}

export function latestNemPoint(region: NemRegion): NemPoint | null {
  return region.points.findLast((point) => point.centsPerKwh !== null) ?? null;
}

export function nemTimeLabel(time: number, withDate = false): string {
  return new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Brisbane", hour: "2-digit", minute: "2-digit", hour12: false, ...(withDate ? { day: "numeric", month: "short" } : {}) }).format(time);
}

// Segment breaks preserve missing intervals instead of drawing invented values across gaps.
export function nemChartPath(points: readonly NemPoint[], xFor: (time: number) => number, yFor: (value: number) => number): string {
  let connected = false;
  return points.map((point) => {
    if (point.centsPerKwh === null) { connected = false; return ""; }
    const command = connected ? "L" : "M";
    connected = true;
    return `${command}${xFor(point.time).toFixed(2)},${yFor(point.centsPerKwh).toFixed(2)}`;
  }).join(" ");
}
