/** node --experimental-strip-types scripts/import-council-demographics.mjs [POA.zip STE.zip]
 * Downloads official ABS DataPacks when local archives are not supplied.
 * Only G01, G02 and G37 aggregate counts are retained. No person-level data.
 */
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { unzipSync, strFromU8 } from "fflate";
import { COUNCIL_DEMOGRAPHICS_SOURCE, parseCouncilDemographics } from "../src/lib/council-demographics.ts";

export const SOURCES = ["POA", "STE"].map(geography => ({ geography, url: `https://www.abs.gov.au/census/find-census-data/datapacks/download/2021_GCP_${geography}_for_AUS_short-header.zip` }));
const stateCodes = ["NSW", "VIC", "QLD", "SA", "WA", "TAS", "NT", "ACT", "OT"];
const digest = bytes => createHash("sha256").update(bytes).digest("hex");

export function censusTable(text, geography) {
  const [header, ...lines] = text.replace(/^\uFEFF/, "").trim().split(/\r?\n/);
  const fields = header.split(",");
  if (fields[0] !== `${geography}_CODE_2021` || new Set(fields).size !== fields.length) throw new Error("Unexpected Census table header");
  const rows = new Map();
  for (const line of lines) {
    const values = line.split(",");
    if (values.length !== fields.length || rows.has(values[0])) throw new Error("Invalid or duplicate Census record");
    const row = Object.fromEntries(fields.slice(1).map((field, index) => {
      const raw = values[index + 1];
      if (raw !== "" && !/^\d+(?:\.\d+)?$/.test(raw)) throw new Error("Unexpected Census numeric value");
      return [field, raw === "" ? null : Number(raw)];
    }));
    rows.set(values[0], row);
  }
  return rows;
}

function value(row, key) {
  if (!Object.hasOwn(row, key)) throw new Error(`Missing Census column ${key}`);
  return row[key];
}
function sum(row, keys) {
  const values = keys.map(key => value(row, key));
  return values.some(value => value === null) ? null : values.reduce((total, value) => total + value, 0);
}
function percent(numerator, denominator) {
  // Perturbation can make very small counts inconsistent. Do not clamp them into invented percentages.
  return numerator === null || denominator === null || denominator <= 0 || numerator > denominator ? null : Math.round(numerator / denominator * 1000) / 10;
}
function median(number) { return number === 0 ? null : number; }

export function demographicRow(code, people, medians, homes) {
  const population = value(people, "Tot_P_P"), occupiedPrivateDwellings = value(homes, "Total_Total");
  return { code, population, medianAge: median(value(medians, "Median_age_persons")),
    aged65PlusPercent: percent(sum(people, ["Age_65_74_yr_P", "Age_75_84_yr_P", "Age_85ov_P"]), population),
    medianWeeklyHouseholdIncome: median(value(medians, "Median_tot_hhd_inc_weekly")),
    renterPercent: percent(value(homes, "R_Tot_Total"), occupiedPrivateDwellings),
    ownerOccupierPercent: percent(sum(homes, ["O_OR_Total", "O_MTG_Total"]), occupiedPrivateDwellings),
    separateHousePercent: percent(value(homes, "Total_DS_Sep_house"), occupiedPrivateDwellings),
    apartmentPercent: percent(value(homes, "Total_DS_Flat_apart"), occupiedPrivateDwellings),
    occupiedPrivateDwellings, averageHouseholdSize: median(value(medians, "Average_household_size")) };
}

export function importArchive(bytes, geography) {
  const files = unzipSync(bytes, { filter: file => new RegExp(`2021Census_(G01|G02|G37)_AUST_${geography}\\.csv$`).test(file.name) });
  const tables = ["G01", "G02", "G37"].map(table => {
    const matches = Object.keys(files).filter(name => name.endsWith(`2021Census_${table}_AUST_${geography}.csv`));
    if (matches.length !== 1) throw new Error(`Missing or duplicate ${table} source`);
    return censusTable(strFromU8(files[matches[0]]), geography);
  });
  if (tables.some(table => table.size !== tables[0].size)) throw new Error("Census table coverage differs");
  const omittedCodes = [], rows = [];
  for (const [rawCode, people] of tables[0]) {
    if (!tables[1].has(rawCode) || !tables[2].has(rawCode)) throw new Error("Census table geography differs");
    const code = geography === "POA" ? rawCode.replace(/^POA/, "") : stateCodes[Number(rawCode) - 1];
    if (geography === "POA" && ["9494", "9797", "ZZZZ"].includes(code)) { omittedCodes.push(code); continue; }
    if (!code || (geography === "POA" && !/^\d{4}$/.test(code))) throw new Error("Unexpected Census geography");
    rows.push(demographicRow(code, people, tables[1].get(rawCode), tables[2].get(rawCode)));
  }
  rows.sort((a, b) => a.code.localeCompare(b.code));
  return { rows, omittedCodes, tables: Object.entries(files).map(([name, bytes]) => ({ name, sha256: digest(bytes) })) };
}

async function main() {
  const inputs = process.argv.slice(2), captures = [];
  for (const [index, source] of SOURCES.entries()) {
    const bytes = inputs[index] ? await readFile(inputs[index]) : new Uint8Array(await (await fetch(source.url).then(response => {
      if (!response.ok) throw new Error(`ABS download failed: ${response.status}`);
      return response;
    })).arrayBuffer());
    captures.push({ ...source, bytes: bytes.length, sha256: digest(bytes), ...importArchive(bytes, source.geography) });
  }
  const snapshot = { version: 1, censusDate: COUNCIL_DEMOGRAPHICS_SOURCE.censusDate, rows: captures[0].rows, states: captures[1].rows };
  parseCouncilDemographics(snapshot);
  if (snapshot.rows.length !== 2641 || snapshot.states.length !== 9) throw new Error("Incomplete ABS 2021 geographic coverage");
  const destination = new URL("../public/data/council-demographics/", import.meta.url);
  await mkdir(destination, { recursive: true });
  const data = JSON.stringify(snapshot) + "\n";
  await writeFile(new URL("abs-2021.json", destination), data);
  await writeFile(new URL("manifest.json", destination), JSON.stringify({ ...COUNCIL_DEMOGRAPHICS_SOURCE, retrievedAt: new Date().toISOString(),
    geography: "ASGS Edition 3 Postal Areas 2021, whole areas; State and Territory benchmarks",
    censusPopulationBasis: "People: place of usual residence. Housing: occupied private dwellings, excluding visitor-only and other non-classifiable households (G37).",
    transformations: ["Age 65+ is the sum of G01 Age_65_74_yr_P, Age_75_84_yr_P and Age_85ov_P divided by Tot_P_P.",
      "Housing shares divide G37 category counts by Total_Total, including not-stated categories in the denominator. Owner occupation adds owned outright and owned with a mortgage.",
      "Shares rounded to one decimal place. Zero-denominator or perturbation-inconsistent shares remain null. Blank values remain null; zero medians and averages are treated as unavailable, not genuine zero values.",
      "No demographics are inferred for absent postcodes. No upgrade adoption rates or causal relationships are derived."],
    columns: { G01: ["Tot_P_P", "Age_65_74_yr_P", "Age_75_84_yr_P", "Age_85ov_P"], G02: ["Median_age_persons", "Median_tot_hhd_inc_weekly", "Average_household_size"], G37: ["Total_Total", "R_Tot_Total", "O_OR_Total", "O_MTG_Total", "Total_DS_Sep_house", "Total_DS_Flat_apart"] },
    sources: captures.map(({ rows, ...source }) => ({ ...source, rows: rows.length })), file: { name: "abs-2021.json", rows: snapshot.rows.length, bytes: Buffer.byteLength(data), sha256: digest(data) },
  }, null, 2) + "\n");
  console.log(JSON.stringify({ rows: snapshot.rows.length, states: snapshot.states.length, bytes: Buffer.byteLength(data), sha256: digest(data) }));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
