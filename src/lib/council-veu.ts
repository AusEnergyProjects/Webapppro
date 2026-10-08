export const COUNCIL_VEU_SOURCE_URL = "https://veu.esc.vic.gov.au/vpr/s/public-registry";
export type CouncilVeuPeriodKey = "quarter" | "year" | "all";
export type CouncilVeuPeriod = { key: CouncilVeuPeriodKey; label: string; startDate: string | null; endDate: string | null; dateBasis: "activity_date" };
export type CouncilVeuMeasures = { activities: number | null; reportedVeecEquivalents: number | null; estimatedLifetimeTonnesCo2e: number | null };
export type CouncilVeuActivity = CouncilVeuMeasures & { activity: string };
export type CouncilVeuSectorKey = "business" | "residential" | "unclassified";
export type CouncilVeuRow = { activity: string; postcode: string; activities: number; reportedVeecEquivalents: number | null; sector?: CouncilVeuSectorKey; sourceSector?: string | null };
export type CouncilVeuSnapshot = {
  sectorBasis?: "official_activity_sector";
  version: 1; postcodes: string[]; period: CouncilVeuPeriod; rows: CouncilVeuRow[];
  totals: { activities: number; reportedVeecEquivalents: number | null };
  fetchedAt: string; sourceRefreshedAt: string;
  provenance: { responseSha256: string; querySha256: string; modelSha256: string; schemaSha256: string };
};
export type CouncilVeuReport = {
  sectors?: { basis: "official_activity_sector"; rows: Array<{ key: CouncilVeuSectorKey; label: string; totals: CouncilVeuMeasures; activities: CouncilVeuActivity[]; postcodes: Array<CouncilVeuMeasures & { postcode: string }> }>; note: string };
  scope: { councilId: string; name: string; state: string; postcodes: string[] };
  period: CouncilVeuPeriod;
  totals: CouncilVeuMeasures;
  postcodes: Array<CouncilVeuMeasures & { postcode: string; activityBreakdown: CouncilVeuActivity[] | null }>;
  activities: CouncilVeuActivity[];
  source: { url: typeof COUNCIL_VEU_SOURCE_URL; refreshedAt: string; fetchedAt: string; checkedAt: string; stale: boolean; refreshFailed: boolean; dataOrigin: "live" | "cache" | "baseline" };
  provenance: CouncilVeuSnapshot["provenance"];
  coverage: { availablePostcodes: number; requestedPostcodes: number; missingVeecGroups: number; installerLocality: "unavailable" };
  notes: string[];
};

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("VEU source object changed");
  return Object.fromEntries(Object.entries(value));
}
function list(value: unknown): unknown[] { if (!Array.isArray(value)) throw new Error("VEU source list changed"); return value; }
function amount(value: unknown): number | null {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1e12) throw new Error("Invalid VEU quantity");
  return value;
}
function count(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > 1e12) throw new Error("Invalid VEU activity count");
  return value;
}
const rounded = (value: number) => Math.round(value * 1e6) / 1e6;
const sameNumber = (a: number | null, b: number | null) => a === null || b === null ? a === b : Math.abs(a - b) <= 0.00001;
const date = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const instant = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value));

export function councilVeuPostcodes(postcodes: string[]): string[] {
  if (!Array.isArray(postcodes) || postcodes.length < 1 || postcodes.length > 100 || postcodes.some(postcode => typeof postcode !== "string" || !/^\d{4}$/.test(postcode))) throw new Error("Invalid VEU postcode scope");
  return [...new Set(postcodes)].sort();
}

export function councilVeuPeriod(key: CouncilVeuPeriodKey, now = new Date()): CouncilVeuPeriod {
  if (!["quarter", "year", "all"].includes(key) || !Number.isFinite(now.getTime())) throw new Error("Invalid VEU period");
  if (key === "all") return { key, label: "All published history", startDate: null, endDate: null, dateBasis: "activity_date" };
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Melbourne", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now).map(part => [part.type, part.value]));
  const startDate = `${parts.year}-${key === "year" ? "01" : String(Math.floor((Number(parts.month) - 1) / 3) * 3 + 1).padStart(2, "0")}-01`;
  return { key, label: key === "quarter" ? "This calendar quarter" : "This calendar year", startDate, endDate: `${parts.year}-${parts.month}-${parts.day}`, dateBasis: "activity_date" };
}

const column = (source: string, property: string) => ({ Column: { Expression: { SourceRef: { Source: source } }, Property: property } });
export function councilVeuQuery(postcodes: string[], period: CouncilVeuPeriod): Record<string, unknown> {
  const area = councilVeuPostcodes(postcodes);
  if (!["quarter", "year", "all"].includes(period.key) || period.dateBasis !== "activity_date" || (period.key === "all" && (period.startDate !== null || period.endDate !== null))) throw new Error("Invalid VEU period");
  const where: unknown[] = [
    { Condition: { In: { Expressions: [column("f", "Activity_Status__c")], Values: [[{ Literal: { Value: "'Approved'" } }]] } } },
    { Condition: { In: { Expressions: [column("r", "Postcode__c")], Values: area.map(postcode => [{ Literal: { Value: `'${postcode}'` } }]) } } },
  ];
  if (period.key !== "all") {
    if (!date(period.startDate) || !date(period.endDate) || period.startDate > period.endDate) throw new Error("Invalid VEU date window");
    const nextDay = new Date(Date.parse(period.endDate) + 86400_000).toISOString().slice(0, 10);
    for (const [kind, boundary] of [[2, period.startDate], [3, nextDay]]) where.push({ Condition: { Comparison: { ComparisonKind: kind, Left: column("f", "Activity_Date__c"), Right: { Literal: { Value: `datetime'${boundary}T00:00:00'` } } } } });
  }
  return {
    Query: { Version: 2, From: [{ Name: "f", Entity: "Fact_Activity", Type: 0 }, { Name: "r", Entity: "Ref_Address", Type: 0 }],
      Select: [ { ...column("f", "Activity_Type__c"), Name: "activity" }, { ...column("r", "Postcode__c"), Name: "postcode" },
        { ...column("f", "Sector__c"), Name: "sector" },
        { Aggregation: { Expression: column("f", "VEECs__c"), Function: 0 }, Name: "certificates" },
        { Aggregation: { Expression: column("f", "Activity_Type__c"), Function: 5 }, Name: "activities" } ], Where: where },
    Binding: { DataReduction: { DataVolume: 6, Primary: { Window: { Count: 15000 } } }, Primary: { Groupings: [{ Projections: [0, 1, 2, 3, 4], Subtotal: 1 }] }, Version: 1 }, ExecutionMetricsKind: 1,
  };
}

/** Decode the report's compressed aggregate table, including repeat and null masks. */
function cells(rows: unknown[], expected: Array<[string, number]>, dictionaries: Record<string, unknown>): unknown[][] {
  let schema: Record<string, unknown>[] = [];
  let previous: unknown[] | null = null;
  return rows.map((raw, index) => {
    const row = record(raw);
    if (!index) {
      schema = list(row.S).map(record);
      if (schema.length !== expected.length || schema.some((field, i) => field.N !== expected[i][0] || field.T !== expected[i][1] || (field.DN !== undefined && (expected[i][1]!==1 || typeof field.DN !== "string" || !/^D\d+$/.test(field.DN))))) throw new Error("VEU aggregate schema changed");
    } else if (row.S !== undefined) throw new Error("Repeated VEU aggregate schema");
    const source = row.C === undefined ? [] : list(row.C);
    const repeat = row.R ?? 0, absent = row["Ø"] ?? 0;
    if (typeof repeat !== "number" || typeof absent !== "number" || !Number.isInteger(repeat) || !Number.isInteger(absent) || repeat < 0 || absent < 0 || repeat >= 2 ** expected.length || absent >= 2 ** expected.length || (repeat & absent)) throw new Error("Invalid VEU compression masks");
    let used = 0;
    const decoded = schema.map((field, i) => {
      if ((repeat & (1 << i)) !== 0) { if (!previous) throw new Error("Invalid first VEU repeat"); return previous[i]; }
      if ((absent & (1 << i)) !== 0) return null;
      if (used >= source.length) throw new Error("Missing VEU aggregate cell");
      const value = source[used++];
      if (field.DN !== undefined) {
        if (typeof field.DN !== "string" || typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new Error("Invalid VEU dictionary index");
        const dictionary = list(dictionaries[field.DN]);
        if (value >= dictionary.length) throw new Error("VEU dictionary index out of range");
        return dictionary[value];
      }
      // Power BI can encode decimal measures as JSON-number strings.
      // Decode only schema-validated numeric cells, not counts or snapshot data.
      if (field.T === 3 && typeof value === "string") {
        if (!/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(value)) throw new Error("Invalid VEU numeric cell");
        return amount(Number(value));
      }
      return value;
    });
    if (used !== source.length) throw new Error("Unused VEU aggregate cells");
    previous = decoded;
    return decoded;
  });
}

const sectorKey=(value: string | null): CouncilVeuSectorKey=>value==="Business" ? "business" : value==="Residential" ? "residential" : "unclassified";
const sectorValues=[{key:"business",label:"Business"},{key:"residential",label:"Residential"},{key:"unclassified",label:"Not classified"}] as const;
export function parseCouncilVeuResponse(raw: string, postcodes: string[]): Pick<CouncilVeuSnapshot, "rows" | "totals" | "sectorBasis"> {
  if (raw.length > 8_000_000) throw new Error("VEU response too large");
  const area = new Set(councilVeuPostcodes(postcodes));
  const results = list(record(JSON.parse(raw)).results);
  if (results.length !== 1) throw new Error("VEU result count changed");
  const data = record(record(record(results[0]).result).data);
  const select = list(record(data.descriptor).Select).map(record);
  const projections=JSON.stringify(select.map(item=>[item.Name,item.Value]));
  const hasSectors=projections===JSON.stringify([["activity","G0"],["postcode","G1"],["sector","G2"],["certificates","M0"],["activities","M1"]]);
  if (!hasSectors && projections!==JSON.stringify([["activity", "G0"], ["postcode", "G1"], ["certificates", "M0"], ["activities", "M1"]])) throw new Error("VEU projections changed");
  if (hasSectors) {
    const keys=list(select[2].GroupKeys);
    if (keys.length!==1) throw new Error("VEU sector source changed");
    const source=record(record(keys[0]).Source);
    if (source.Entity!=="Fact_Activity" || source.Property!=="Sector__c") throw new Error("VEU sector source changed");
  }
  const basis=hasSectors ? {sectorBasis:"official_activity_sector" as const} : {};
  const datasets = list(record(data.dsr).DS);
  if (datasets.length !== 1) throw new Error("VEU dataset count changed");
  const dataset = record(datasets[0]);
  if (dataset.IC !== true || dataset.HAD !== true || dataset.RT !== undefined) throw new Error("VEU aggregate is incomplete");
  const phases = list(dataset.PH);
  if (phases.length !== 2) throw new Error("VEU aggregate phases changed");
  const grandRows = list(record(phases[0]).DM0), detailRows = list(record(phases[1]).DM1);
  if (grandRows.length !== 1 || detailRows.length >= (hasSectors ? 15000 : 5000)) throw new Error("VEU aggregate window exceeded");
  const dictionary = dataset.ValueDicts === undefined ? {} : record(dataset.ValueDicts);
  const grand = cells(grandRows, [["A0", 3], ["A1", 4]], {})[0];
  if (!detailRows.length && grand.every(value => value === null || value === 0)) return { ...basis,rows: [], totals: { activities: 0, reportedVeecEquivalents: 0 } };
  const officialVeecs = amount(grand[0]), officialActivities = count(grand[1]);
  const seen = new Set<string>();
  const fields:Array<[string,number]>=[["G0",1],["G1",1],...(hasSectors ? [["G2",1] as [string,number]] : []),["M0",3],["M1",4]];
  const rows = cells(detailRows, fields, dictionary).map(values => {
    const [activity,postcode]=values;
    const [sourceSector,veecs,activities]=hasSectors ? values.slice(2) : [undefined,...values.slice(2)];
    if (typeof activity !== "string" || !activity.trim() || activity.length > 300 || /[\u0000-\u001f\u007f]/.test(activity) || typeof postcode !== "string" || !area.has(postcode)) throw new Error("Invalid VEU activity or postcode");
    if (hasSectors && (sourceSector!==null && (typeof sourceSector!=="string" || sourceSector.length>100 || /[\u0000-\u001f\u007f]/.test(sourceSector)))) throw new Error("Invalid VEU sector");
    const key = JSON.stringify([postcode,activity,sourceSector]);
    if (seen.has(key)) throw new Error("Duplicate VEU aggregate group");
    seen.add(key);
    const row: CouncilVeuRow = { activity, postcode, activities: count(activities), reportedVeecEquivalents: amount(veecs) };
    if (hasSectors) { const rawSector=typeof sourceSector==="string" ? sourceSector : null; row.sector=sectorKey(rawSector);row.sourceSector=rawSector; }
    if (row.activities === 0) throw new Error("VEU detail group contains no activity");
    return row;
  });
  const knownVeecs = rounded(rows.reduce((sum, row) => sum + (row.reportedVeecEquivalents ?? 0), 0));
  if (rows.reduce((sum, row) => sum + row.activities, 0) !== officialActivities || (officialVeecs !== null ? !sameNumber(knownVeecs, officialVeecs) : rows.some(row => row.reportedVeecEquivalents !== null))) throw new Error("VEU aggregates do not reconcile with the source total");
  return { ...basis,rows, totals: { activities: officialActivities, reportedVeecEquivalents: rows.some(row => row.reportedVeecEquivalents === null) ? null : officialVeecs } };
}

export function isCouncilVeuSnapshot(value: unknown): value is CouncilVeuSnapshot {
  try {
    const item = record(value), period = record(item.period), totals = record(item.totals), provenance = record(item.provenance);
    if (item.version !== 1 || !instant(item.fetchedAt) || !instant(item.sourceRefreshedAt) || Date.parse(item.sourceRefreshedAt) > Date.parse(item.fetchedAt) + 600_000) return false;
    const codes = list(item.postcodes);
    if (!codes.every((code): code is string => typeof code === "string") || JSON.stringify(councilVeuPostcodes(codes)) !== JSON.stringify(codes)) return false;
    if ((period.key !== "quarter" && period.key !== "year" && period.key !== "all") || period.dateBasis !== "activity_date" || typeof period.label !== "string") return false;
    if (period.key === "all" ? period.startDate !== null || period.endDate !== null : !date(period.startDate) || !date(period.endDate) || period.startDate > period.endDate) return false;
    const expectedPeriod = councilVeuPeriod(period.key, period.key === "all" ? new Date(item.fetchedAt) : new Date(`${period.endDate}T00:00:00Z`));
    if (period.startDate !== expectedPeriod.startDate || period.label !== expectedPeriod.label) return false;
    if (["responseSha256", "querySha256", "modelSha256", "schemaSha256"].some(key => typeof provenance[key] !== "string" || !/^[a-f0-9]{64}$/.test(provenance[key]))) return false;
    if (item.sectorBasis!==undefined && item.sectorBasis!=="official_activity_sector") return false;
    const rows = list(item.rows); if (rows.length >= (item.sectorBasis ? 15000 : 5000)) return false;
    let activities = 0, veecs = 0, unknown = false; const seen = new Set<string>();
    for (const raw of rows) {
      const row = record(raw);
      if (item.sectorBasis) {
        if (row.sourceSector!==null && (typeof row.sourceSector!=="string" || row.sourceSector.length>100 || /[\u0000-\u001f\u007f]/.test(row.sourceSector))) return false;
        if (row.sector!==sectorKey(row.sourceSector)) return false;
      } else if (row.sector!==undefined || row.sourceSector!==undefined) return false;
      const identity=JSON.stringify([row.postcode,row.activity,row.sourceSector]);
      if (typeof row.activity !== "string" || !row.activity.trim() || row.activity.length > 300 || /[\u0000-\u001f\u007f]/.test(row.activity) || typeof row.postcode !== "string" || !codes.includes(row.postcode) || seen.has(identity)) return false;
      seen.add(identity);
      const quantity = count(row.activities); if (!quantity) return false;
      activities += quantity; const units = amount(row.reportedVeecEquivalents); unknown ||= units === null; veecs += units ?? 0;
    }
    return count(totals.activities) === activities && sameNumber(amount(totals.reportedVeecEquivalents), unknown ? null : rounded(veecs));
  } catch { return false; }
}

function measures(rows: CouncilVeuRow[], known = true): CouncilVeuMeasures {
  const veecs = !known || rows.some(row => row.reportedVeecEquivalents === null) ? null : rounded(rows.reduce((sum, row) => sum + (row.reportedVeecEquivalents ?? 0), 0));
  return { activities: known ? rows.reduce((sum, row) => sum + row.activities, 0) : null, reportedVeecEquivalents: veecs, estimatedLifetimeTonnesCo2e: veecs };
}

export function councilVeuReport(snapshot: CouncilVeuSnapshot, scope: CouncilVeuReport["scope"], freshness: Pick<CouncilVeuReport["source"], "checkedAt" | "refreshFailed" | "dataOrigin">, now = Date.now()): CouncilVeuReport {
  if (!isCouncilVeuSnapshot(snapshot) || scope.state !== "VIC") throw new Error("Invalid Victorian council snapshot");
  const area = councilVeuPostcodes(scope.postcodes);
  const rows = snapshot.rows.filter(row => area.includes(row.postcode));
  const available = area.filter(postcode => snapshot.postcodes.includes(postcode));
  const complete = available.length === area.length;
  const activities=(values: CouncilVeuRow[],known=complete)=>[...new Set(values.map(row=>row.activity))].sort().map(activity=>({activity,...measures(values.filter(row=>row.activity===activity),known)}));
  return {
    scope: { ...scope, postcodes: area }, period: snapshot.period, totals: measures(rows, complete),
    postcodes: area.map(postcode => {
      const postcodeRows = rows.filter(row => row.postcode === postcode), known = available.includes(postcode);
      return { postcode, ...measures(postcodeRows, known), activityBreakdown: known ? activities(postcodeRows,true) : null };
    }),
    activities: activities(rows),
    ...(snapshot.sectorBasis ? {sectors:{basis:snapshot.sectorBasis,rows:sectorValues.map(sector=>{
      const matches=rows.filter(row=>row.sector===sector.key);
      return {...sector,totals:measures(matches,complete),activities:activities(matches),postcodes:area.map(postcode=>({postcode,...measures(matches.filter(row=>row.postcode===postcode),available.includes(postcode))}))};
    }),note:"Business and residential are the official public activity record's Sector field, not the installing trade's business status or an inference from upgrade type. Unrecognised and missing sector values remain not classified. Activities are not unique premises, equipment units or jobs. VEU activity data has no installed generation/storage capacity or metered generation measure. Older retained snapshots may not include sector data."}} : {}),
    source: { url: COUNCIL_VEU_SOURCE_URL, refreshedAt: snapshot.sourceRefreshedAt, fetchedAt: snapshot.fetchedAt, ...freshness,
      stale: freshness.refreshFailed || now - Date.parse(snapshot.sourceRefreshedAt) > 48 * 3600_000 || now - Date.parse(freshness.checkedAt) > 24 * 3600_000 },
    provenance: snapshot.provenance, coverage: { availablePostcodes: available.length, requestedPostcodes: area.length, missingVeecGroups: rows.filter(row => row.reportedVeecEquivalents === null).length, installerLocality: "unavailable" },
    notes: [
      "Official VEU public Activities report, filtered to approved activities in the selected postcodes. Dates are activity dates, not certificate creation or registration dates.",
      "Business and residential activity uses the official Sector field. It does not infer land use from activity type. The sector totals reconcile to the same approved postcode/activity source total; they are a split of that total, not additional upgrades.",
      "Reported VEEC equivalents come from the activity report's No. of VEECs field and can include fractional values. They are not a verified count of registered or issued certificates.",
      "Estimated lifetime CO2-e uses one reported VEEC equivalent per tonne under the VEU method. It is a deemed lifetime estimate, not measured emissions or annual savings.",
      "Community VEU, CER installations, TLink work and council referrals may describe the same upgrades. Never add these totals together or claim all community activity was caused by the council.",
      "Installer identities and locality are unavailable in this dataset. No activity is assigned to a local or outside business. Postcodes can cross council boundaries, and activity counts are not unique homes or jobs.",
      "The public register normally refreshes overnight. This workspace checks for an updated snapshot when opened after the daily cache expires. Snapshots replace previous totals; corrections can reduce them. Daily changes do not represent work completed that day.",
      "Coverage reflects records available in the current public registry. Historical invalid or expired certificates may not have migrated, and status may not be real time. Missing snapshot postcodes are unavailable, not zero.",
    ],
  };
}
