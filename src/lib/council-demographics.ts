/** Whole-area public Census statistics. Never interpret these as a resident's attributes. */
export const COUNCIL_DEMOGRAPHICS_SOURCE = {
  name: "ABS 2021 Census, General Community Profile",
  url: "https://www.abs.gov.au/census/find-census-data/datapacks",
  geographyUrl: "https://www.abs.gov.au/statistics/standards/australian-statistical-geography-standard-asgs/edition-3-july-2021-june-2026/non-abs-structures/postal-areas",
  censusDate: "2021-08-10",
  licence: "https://creativecommons.org/licenses/by/4.0/",
  attribution: "Based on Australian Bureau of Statistics data. ABS data used with permission from the Australian Bureau of Statistics.",
} as const;

export const COUNCIL_DEMOGRAPHIC_METRICS = [
  { key: "population", label: "Population", unit: "people", format: "number" },
  { key: "medianAge", label: "Median age", unit: "years", format: "number" },
  { key: "aged65PlusPercent", label: "People aged 65 and over", unit: "% of people", format: "percent" },
  { key: "medianWeeklyHouseholdIncome", label: "Median weekly household income", unit: "$ per week", format: "money" },
  { key: "renterPercent", label: "Rented homes", unit: "% of occupied private dwellings", format: "percent" },
  { key: "ownerOccupierPercent", label: "Owner-occupied homes", unit: "% of occupied private dwellings", format: "percent" },
  { key: "separateHousePercent", label: "Separate houses", unit: "% of occupied private dwellings", format: "percent" },
  { key: "apartmentPercent", label: "Flats and apartments", unit: "% of occupied private dwellings", format: "percent" },
] as const;
export type CouncilDemographicMetric = typeof COUNCIL_DEMOGRAPHIC_METRICS[number];
export type CouncilDemographicRow = { code: string; occupiedPrivateDwellings: number | null; averageHouseholdSize: number | null }
  & Record<CouncilDemographicMetric["key"], number | null>;
export type CouncilDemographics = {
  rows: CouncilDemographicRow[];
  states: CouncilDemographicRow[];
  missingPostcodes: string[];
};
export type CouncilDemographicsStatus = { data: CouncilDemographics | null; loading: boolean; error: boolean };

const STATE_CODES = ["NSW", "VIC", "QLD", "SA", "WA", "TAS", "NT", "ACT", "OT"];
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function numeric(row: Record<string, unknown>, key: keyof CouncilDemographicRow): number | null {
  const value = row[key];
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || (key.endsWith("Percent") && value > 100)) throw new Error("Invalid Census value");
  if ((key === "population" || key === "occupiedPrivateDwellings") && !Number.isInteger(value)) throw new Error("Invalid Census count");
  return value;
}

function parseRows(value: unknown, states: boolean): CouncilDemographicRow[] {
  if (!Array.isArray(value) || value.length > 3000) throw new Error("Invalid Census rows");
  const seen = new Set<string>();
  return value.map(row => {
    if (!record(row) || typeof row.code !== "string" || (states ? !STATE_CODES.includes(row.code) : !/^\d{4}$/.test(row.code) || ["9494", "9797"].includes(row.code)) || seen.has(row.code)) throw new Error("Invalid Census area");
    seen.add(row.code);
    // Construct the validated public contract explicitly; ignore unrelated source fields.
    return { code: row.code, population: numeric(row, "population"), medianAge: numeric(row, "medianAge"),
      aged65PlusPercent: numeric(row, "aged65PlusPercent"), medianWeeklyHouseholdIncome: numeric(row, "medianWeeklyHouseholdIncome"),
      renterPercent: numeric(row, "renterPercent"), ownerOccupierPercent: numeric(row, "ownerOccupierPercent"),
      separateHousePercent: numeric(row, "separateHousePercent"), apartmentPercent: numeric(row, "apartmentPercent"),
      occupiedPrivateDwellings: numeric(row, "occupiedPrivateDwellings"), averageHouseholdSize: numeric(row, "averageHouseholdSize") };
  });
}

export function parseCouncilDemographics(value: unknown): Pick<CouncilDemographics, "rows" | "states"> {
  if (!record(value) || value.version !== 1 || value.censusDate !== COUNCIL_DEMOGRAPHICS_SOURCE.censusDate) throw new Error("Unsupported Census snapshot");
  return { rows: parseRows(value.rows, false), states: parseRows(value.states, true) };
}

export async function loadCouncilDemographics(postcodes: readonly string[], signal?: AbortSignal): Promise<CouncilDemographics> {
  const requested = new Set(postcodes);
  if ([...requested].some(postcode => !/^\d{4}$/.test(postcode))) throw new Error("Invalid Census postcode scope");
  if (!requested.size) return { rows: [], states: [], missingPostcodes: [] };
  const response = await fetch("/data/council-demographics/abs-2021.json", { signal });
  if (!response.ok) throw new Error("Census data could not be loaded");
  const source = parseCouncilDemographics(await response.json());
  const rows = source.rows.filter(row => requested.has(row.code));
  const found = new Set(rows.map(row => row.code));
  return { rows, states: source.states, missingPostcodes: [...requested].filter(postcode => !found.has(postcode)).sort() };
}

export function councilDemographicValue(value: number | null, format: CouncilDemographicMetric["format"] = "number"): string {
  if (value === null) return "Not available";
  const number = value.toLocaleString("en-AU", { maximumFractionDigits: 1 });
  return format === "percent" ? `${number}%` : format === "money" ? `$${number}` : number;
}

/** Differences compare the same Census year and denominator, never current upgrade adoption. */
export function councilDemographicComparison(value: number | null, benchmark: number | null, format: CouncilDemographicMetric["format"]): string | null {
  if (value === null || benchmark === null) return null;
  const difference = Math.round((value - benchmark) * 10) / 10;
  if (difference === 0) return "Same as state";
  const amount = councilDemographicValue(Math.abs(difference), format === "percent" ? "number" : format);
  return `${amount}${format === "percent" ? " percentage points" : ""} ${difference > 0 ? "above" : "below"} state`;
}
