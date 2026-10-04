export const CER_COMMUNITY_URL = "https://cer.gov.au/markets/reports-and-data/small-scale-installation-postcode-data";
export const COMMUNITY_METRICS = [
  { id: "solarInstallations", label: "Solar systems installed", unit: "systems", path: "sgu-solar-installations-2011-to-present-and-totals", column: "Installation Quantity", historic: "Historic Total Installation Quantity (2001 - 2010)" },
  { id: "solarCapacityKw", label: "Solar capacity installed", unit: "kW", path: "sgu-solar-capacity-2011-to-present-and-totals", column: "Rated Power Output in kW", historic: "Historic Total Rated Power Output In kW (2001 - 2010)" },
  { id: "heatPumpInstallations", label: "Heat pump water heaters installed", unit: "systems", path: "swh-air-source-heat-pump-installations-2011-to-present-and-totals", column: "Installation Quantity", historic: "Historic Total Installation Quantity (2001 - 2010)" },
  { id: "solarHotWaterInstallations", label: "Solar water heaters installed", unit: "systems", path: "swh-solar-installations-2011-to-present-and-totals", column: "Installation Quantity", historic: "Historic Total Installation Quantity (2001 - 2010)" },
  { id: "batteryInstallations", label: "Batteries installed", unit: "systems", path: "sgu-battery-installations-2011-to-present-and-totals", column: "Installation Quantity", historic: null },
  { id: "batteryCapacityKwh", label: "Battery storage installed", unit: "kWh", path: "sgu-battery-capacity-2011-to-present-and-totals", column: "Usable capacity in kWh", historic: null },
] as const;
export type CommunityMetricId = typeof COMMUNITY_METRICS[number]["id"];
export type CommunityMeasures = Record<CommunityMetricId, number | null>;
export type CommunityCoverage = Record<CommunityMetricId, { availablePostcodes: number; requestedPostcodes: number }>;
export type CommunityPeriodKey = "quarter" | "year" | "all";
export type CommunityDataRow = { postcode: string; total: number | null; monthly: Array<number | null> };
export type CommunityDataset = { id: CommunityMetricId; url: string; sha256: string; months: string[]; rows: CommunityDataRow[] };
export type CommunitySnapshot = { version: 1; sourceAsOf: string; fetchedAt: string; sourcePage: { url: string; sha256: string }; datasets: CommunityDataset[] };
export type CommunitySource = { id: "cer" | "veu" | "solar_victoria"; name: string; url: string; status: "connected" | "not_connected" | "separate_report"; cadence: string; coverage: string; note: string };
export type CouncilCommunityReport = {
  scope: { councilId: string; name: string; state: string; postcodes: string[] };
  period: { key: CommunityPeriodKey; label: string; startMonth: string; endMonth: string };
  sourceAsOf: string; fetchedAt: string; checkedAt: string; refreshFailed: boolean; stale: boolean;
  dataOrigin: "live" | "cache" | "baseline";
  totals: CommunityMeasures;
  reportedTotals: CommunityMeasures;
  coverage: CommunityCoverage;
  postcodes: Array<{ postcode: string; values: CommunityMeasures }>;
  trend: Array<{ month: string; values: CommunityMeasures; reportedValues: CommunityMeasures; coverage: CommunityCoverage }>;
  sources: CommunitySource[];
  provenance: Array<{ metric: CommunityMetricId; url: string; sha256: string }>;
  notes: string[];
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const clean = (text: string) => text.replace(/^\uFEFF/, "").replace(/\u00a0/g, " ").trim();
const monthIndex = (month: string) => Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1;
const fromMonthIndex = (index: number) => `${Math.floor(index / 12)}-${String(index % 12 + 1).padStart(2, "0")}`;
const validMonth = (month: unknown): month is string => typeof month === "string" && /^(20\d{2})-(0[1-9]|1[0-2])$/.test(month);
const finiteValue = (value: unknown): value is number | null => value === null || (typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1e12);
const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** CER uses quoted thousands separators. Empty cells remain unknown. Multiline fields are not part of this numeric schema. */
function csvCells(line: string): string[] {
  const cells: string[] = [];
  let cell = "", quoted = false, closed = false;
  for (let index = 0; index < line.length; index++) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') { cell += '"'; index++; }
      else if (quoted) { quoted = false; closed = true; }
      else if (!cell && !closed) quoted = true;
      else throw new Error("Invalid CER CSV quoting");
    } else if (char === "," && !quoted) { cells.push(clean(cell)); cell = ""; closed = false; }
    else if (closed) throw new Error("Invalid CER CSV quoting");
    else cell += char;
  }
  if (quoted) throw new Error("Invalid CER CSV quoting");
  cells.push(clean(cell));
  return cells;
}

function numericCell(cell: string, integer: boolean): number | null {
  if (cell === "") return null;
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,6})?$/.test(cell)) throw new Error("Invalid CER numeric cell");
  const value = Number(cell.replaceAll(",", ""));
  if (!finiteValue(value) || (integer && !Number.isSafeInteger(value))) throw new Error("Invalid CER numeric value");
  return value;
}

export function parseCerPostcodeCsv(text: string, id: CommunityMetricId, sourceAsOf: string): Pick<CommunityDataset, "id" | "months" | "rows"> {
  const metric = COMMUNITY_METRICS.find(item => item.id === id);
  if (!metric || !/^20\d{2}-\d{2}-\d{2}$/.test(sourceAsOf)) throw new Error("Invalid CER dataset identity");
  if (text.length > 5_000_000) throw new Error("CER CSV exceeds size limit");
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter(line => line.trim() !== "");
  if (lines.length < 2 || lines.length > 6001) throw new Error("Invalid CER row count");
  const headers = csvCells(lines[0]);
  if (headers.length > 400 || !["Small Unit Installation Postcode", "Small unit postcode"].includes(headers[0])) throw new Error("Invalid CER postcode header");
  const start = metric.historic ? 2 : 1;
  if (metric.historic && headers[1] !== metric.historic) throw new Error("Invalid CER history header");
  if (headers.at(-1)?.toLowerCase() !== `Total ${metric.column}`.toLowerCase()) throw new Error("Invalid CER total header");
  const months = headers.slice(start, -1).map(header => {
    const match = /^([A-Z][a-z]{2}) (20\d{2}) - (.+)$/.exec(header);
    if (!match || !MONTHS.includes(match[1]) || match[3] !== metric.column) throw new Error("Invalid CER monthly header");
    return `${match[2]}-${String(MONTHS.indexOf(match[1]) + 1).padStart(2, "0")}`;
  });
  if (months.length === 0 || months[0] !== (metric.historic ? "2011-01" : "2025-07") || months.at(-1) !== sourceAsOf.slice(0, 7)
      || months.some((month, index) => index > 0 && monthIndex(month) !== monthIndex(months[index - 1]) + 1)) throw new Error("CER month coverage does not match publication date");
  const seen = new Set<string>();
  const rows = lines.slice(1).map(line => {
    const cells = csvCells(line);
    if (cells.length !== headers.length || !/^\d{4}$/.test(cells[0]) || seen.has(cells[0])) throw new Error("Invalid or duplicate CER postcode row");
    seen.add(cells[0]);
    const numeric = cells.slice(1).map(cell => numericCell(cell, metric.unit === "systems"));
    const total = numeric.at(-1)!;
    const parts = numeric.slice(0, -1);
    // Missing observations never turn into zeros, even if a separate total exists.
    // Capacity cells are published to three decimal places, independently of the total.
    // Allow only the maximum accumulated rounding error, not a percentage discrepancy.
    const roundingLimit = metric.unit === "systems" ? 0 : (parts.length + 1) * 0.0005 + 1e-7;
    if (total !== null && parts.every(value => value !== null) && Math.abs(parts.reduce((sum, value) => sum + value, 0) - total) > roundingLimit) throw new Error("CER row total does not reconcile");
    return { postcode: cells[0], total, monthly: numeric.slice(metric.historic ? 1 : 0, -1).slice(-24) };
  });
  return { id, months: months.slice(-24), rows };
}

export function isCommunitySnapshot(value: unknown): value is CommunitySnapshot {
  if (!record(value) || value.version !== 1 || typeof value.sourceAsOf !== "string" || !/^20\d{2}-\d{2}-\d{2}$/.test(value.sourceAsOf)
    || !Number.isFinite(Date.parse(value.sourceAsOf)) || typeof value.fetchedAt !== "string" || !Number.isFinite(Date.parse(value.fetchedAt))
    || !record(value.sourcePage) || value.sourcePage.url !== CER_COMMUNITY_URL || typeof value.sourcePage.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(value.sourcePage.sha256)
    || !Array.isArray(value.datasets) || value.datasets.length !== COMMUNITY_METRICS.length) return false;
  const sourceAsOf = value.sourceAsOf;
  const sourceDate = new Date(sourceAsOf);
  if (sourceDate.toISOString().slice(0, 10) !== sourceAsOf || Date.parse(sourceAsOf) > Date.parse(value.fetchedAt)
    || sourceDate.getUTCDate() !== new Date(Date.UTC(sourceDate.getUTCFullYear(), sourceDate.getUTCMonth() + 1, 0)).getUTCDate()) return false;
  const ids = new Set<string>();
  return value.datasets.every(dataset => {
    if (!record(dataset) || typeof dataset.id !== "string" || ids.has(dataset.id)) return false;
    const metric = COMMUNITY_METRICS.find(item => item.id === dataset.id);
    if (!metric || dataset.url !== `https://cer.gov.au/document/${metric.path}` || typeof dataset.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(dataset.sha256)
      || !Array.isArray(dataset.months) || dataset.months.length < 1 || dataset.months.length > 24 || !dataset.months.every(validMonth)
      || dataset.months.at(-1) !== sourceAsOf.slice(0, 7) || dataset.months.some((month, index, list) => index > 0 && monthIndex(month) !== monthIndex(list[index - 1]) + 1)
      || !Array.isArray(dataset.rows) || dataset.rows.length < 1 || dataset.rows.length > 6000) return false;
    ids.add(dataset.id);
    const months = dataset.months;
    const seen = new Set<string>();
    return dataset.rows.every(row => {
      if (!record(row) || typeof row.postcode !== "string" || !/^\d{4}$/.test(row.postcode) || seen.has(row.postcode) || !finiteValue(row.total)
        || !Array.isArray(row.monthly) || row.monthly.length !== months.length || !row.monthly.every(finiteValue)) return false;
      if (metric.unit === "systems" && [row.total, ...row.monthly].some(item => item !== null && !Number.isSafeInteger(item))) return false;
      if (row.total !== null && row.monthly.every(item => item !== null) && row.monthly.reduce((sum: number, item: number) => sum + item, 0) > row.total + 0.02) return false;
      seen.add(row.postcode);
      return true;
    });
  });
}

const blankMeasures = (): CommunityMeasures => ({ solarInstallations: null, solarCapacityKw: null, heatPumpInstallations: null, solarHotWaterInstallations: null, batteryInstallations: null, batteryCapacityKwh: null });
const sumKnown = (values: Array<number | null>) => values.length && values.every(value => value !== null) ? Math.round(values.reduce((sum, value) => sum + value, 0) * 1000) / 1000 : null;
const sumReported = (values: Array<number | null>) => sumKnown(values.filter(value => value !== null));
function blankCoverage(requestedPostcodes: number): CommunityCoverage {
  const empty = () => ({ availablePostcodes: 0, requestedPostcodes });
  return { solarInstallations: empty(), solarCapacityKw: empty(), heatPumpInstallations: empty(), solarHotWaterInstallations: empty(), batteryInstallations: empty(), batteryCapacityKwh: empty() };
}

export function communityReport(snapshot: CommunitySnapshot, scope: CouncilCommunityReport["scope"], period: CommunityPeriodKey,
  freshness: Pick<CouncilCommunityReport, "checkedAt" | "refreshFailed" | "dataOrigin">, now = Date.now()): CouncilCommunityReport {
  if (!["quarter", "year", "all"].includes(period) || scope.postcodes.length > 100 || scope.postcodes.some(code => !/^\d{4}$/.test(code))) throw new Error("Invalid community report scope");
  const postcodes = [...new Set(scope.postcodes)].sort();
  const endMonth = snapshot.sourceAsOf.slice(0, 7);
  const startMonth = period === "all" ? "2001-01" : fromMonthIndex(monthIndex(endMonth) - (period === "quarter" ? 2 : 11));
  const trendMonths = Array.from({ length: period === "quarter" ? 3 : 12 }, (_, index) => fromMonthIndex(monthIndex(endMonth) - (period === "quarter" ? 2 : 11) + index));
  const areas = postcodes.map(postcode => ({ postcode, values: blankMeasures() }));
  const trend = trendMonths.map(month => ({ month, values: blankMeasures(), reportedValues: blankMeasures(), coverage: blankCoverage(postcodes.length) }));
  const totals = blankMeasures();
  const reportedTotals = blankMeasures();
  const coverage = blankCoverage(postcodes.length);
  for (const dataset of snapshot.datasets) {
    const rows = new Map(dataset.rows.map(row => [row.postcode, row]));
    for (const area of areas) {
      const row = rows.get(area.postcode);
      area.values[dataset.id] = !row ? null : period === "all" ? row.total : sumKnown(trendMonths.map(month => {
        const index = dataset.months.indexOf(month);
        return index < 0 ? null : row.monthly[index];
      }));
    }
    totals[dataset.id] = sumKnown(areas.map(area => area.values[dataset.id]));
    reportedTotals[dataset.id] = sumReported(areas.map(area => area.values[dataset.id]));
    coverage[dataset.id] = { availablePostcodes: areas.filter(area => area.values[dataset.id] !== null).length, requestedPostcodes: postcodes.length };
    for (const point of trend) {
      const values = postcodes.map(postcode => {
        const index = dataset.months.indexOf(point.month);
        return index < 0 ? null : rows.get(postcode)?.monthly[index] ?? null;
      });
      point.values[dataset.id] = sumKnown(values);
      point.reportedValues[dataset.id] = sumReported(values);
      point.coverage[dataset.id] = { availablePostcodes: values.filter(value => value !== null).length, requestedPostcodes: postcodes.length };
    }
  }
  return {
    scope: { ...scope, postcodes }, period: { key: period, label: period === "all" ? "All published history" : period === "quarter" ? "Latest 3 published months" : "Latest 12 published months", startMonth, endMonth },
    sourceAsOf: snapshot.sourceAsOf, fetchedAt: snapshot.fetchedAt, checkedAt: freshness.checkedAt, refreshFailed: freshness.refreshFailed, dataOrigin: freshness.dataOrigin,
    stale: freshness.refreshFailed || now - Date.parse(snapshot.sourceAsOf) > 75 * 86400_000 || now - Date.parse(freshness.checkedAt) > 86400_000,
    totals, reportedTotals, coverage, postcodes: areas, trend,
    provenance: snapshot.datasets.map(dataset => ({ metric: dataset.id, url: dataset.url, sha256: dataset.sha256 })),
    sources: [
      { id: "cer", name: "Clean Energy Regulator", url: CER_COMMUNITY_URL, status: "connected", cadence: "Monthly", coverage: "Installation postcode and month", note: "Systems with validly created certificates. Recent figures can increase as certificates are lodged, up to 12 months after installation." },
      { id: "veu", name: "Victorian Energy Upgrades", url: "https://veu.esc.vic.gov.au/vpr/s/public-registry", status: "separate_report", cadence: "Public register updates overnight", coverage: "Activity and postcode", note: "Approved activity aggregates and estimated lifetime impact are available in the separate community upgrade report. They are not added to these installation totals." },
      { id: "solar_victoria", name: "Solar Victoria", url: "https://www.solar.vic.gov.au/solar-homes-program-reporting", status: "not_connected", cadence: "Quarterly council files", coverage: "Local Government Area", note: "Rebated installations are published by council, not postcode. They overlap with CER and VEU activity and are not added to these totals." },
    ],
    notes: [
      "These are community installations reported to the Clean Energy Regulator, not work delivered by TLink or caused by a council campaign. Never add the two datasets together.",
      "The selected period ends at the latest published month. This is not a live count. Recent installation figures can be revised for up to 12 months.",
      "Counts include new systems, upgrades and off-grid systems. They are not a count of unique homes. Postcodes can cross council boundaries.",
      "Battery coverage starts in July 2025. Missing postcodes or blank cells remain unavailable and are never assumed to be zero. Full-area totals are unavailable when any selected postcode is missing. Reported totals sum only postcodes with complete observations for the selected period and must be read with their coverage counts; they are partial when coverage is incomplete.",
      "Monthly reported figures sum available postcode observations for that month. Monthly coverage can differ, so changes in a partial series can reflect coverage as well as installations. No available observations means unavailable, including in reported totals.",
      "Capacity is installed solar power (kW) or usable battery storage (kWh), not energy produced or carbon saved. Installer locality is unavailable in this source.",
      "Based on Clean Energy Regulator material licensed under a Creative Commons Attribution 4.0 licence. Data has been filtered and aggregated for the council's selected postcodes.",
    ],
  };
}
