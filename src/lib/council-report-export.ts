import type { CouncilReport } from "./council-reporting.ts";

function csvCell(value: string | number | null) {
  const text = value === null ? "Withheld or unavailable" : String(value);
  // Prevent spreadsheet formula execution in editable council/campaign names.
  const safe = /^[=+@\-\t\r\n]/.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"','""')}"`;
}
export function councilReportCsv(report: CouncilReport) {
  const rows: Array<Array<string | number | null>> = [
    [report.mode === "demonstration" ? "TLINK DEMONSTRATION ONLY - fictional data" : "TLink council aggregate report"],
    ["Council",report.scope.name], ["Approved reporting postcodes",report.scope.postcodes.join(", ")],
    ["Period",report.period.label,report.period.start,report.period.end,report.period.timeZone],
    ["Generated at",report.generatedAt], ["Coverage",report.dataQuality.coverageNote], [],
    ["Metric","Value"],
    ["Completed jobs",report.metrics.completedJobs],
    ["Completed work value (AUD excluding GST)",report.metrics.completedValueCents === null ? null : report.metrics.completedValueCents / 100],
    ["Jobs delivered by local businesses",report.metrics.localJobs],
    ["Jobs delivered by businesses outside the area",report.metrics.outsideJobs],
    ["Jobs with unknown business locality",report.metrics.unknownLocalityJobs],
    ["Local business share (%)",report.metrics.localSharePercent],
    ["Registered local trade businesses",report.metrics.registeredLocalBusinesses],
    ["TLink community enquiries",report.enquiries?.total ?? null],
    ["Council-attributed enquiries",report.metrics.attributedEnquiries],
    ["Council-attributed completed jobs",report.metrics.attributedCompletedJobs],
    ["Provider-accepted VEEC quantity",report.metrics.veecQuantity],
    ["Provider-accepted STC quantity",report.metrics.stcQuantity],
    ["Deemed lifetime VEU abatement (tCO2e)",report.metrics.estimatedTonnesCo2e], [],
    ["Breakdown","Area or activity","Completed jobs","Work value AUD ex GST","Local jobs","VEEC quantity","STC quantity","Estimated lifetime tCO2e"],
  ];
  for (const [kind,values] of [["Activity",report.activities],["Postcode",report.postcodes],["Month",report.trend]] as const) {
    for (const row of values) rows.push([kind,row.label,row.completedJobs,row.completedValueCents === null ? null : row.completedValueCents / 100,row.localJobs,row.veecQuantity,row.stcQuantity,row.estimatedTonnesCo2e]);
  }
  if (report.sectors) {
    rows.push([], ["TLink business and residential outcomes"], ["Sector classification and evidence",report.sectors.coverageNote],
      ["Customer sector","Completed jobs","Work value AUD ex GST","VEEC quantity","STC quantity","Deemed lifetime tCO2e","Evidence-backed generation installations","Rated generation capacity kW","Evidence-backed battery installations","Usable storage capacity kWh","Measured electricity generated kWh"]);
    for (const row of report.sectors.rows) {
      const m=row.metrics;
      rows.push([row.label,m.completedJobs,m.completedValueCents===null ? null : m.completedValueCents/100,m.veecQuantity,m.stcQuantity,m.estimatedTonnesCo2e,m.generationInstallations,m.generationCapacityKw,m.storageInstallations,m.storageCapacityKwh,m.measuredGenerationKwh]);
    }
    rows.push([], ["Customer sector","Breakdown","Area or activity","Completed jobs","Work value AUD ex GST","VEEC quantity","STC quantity","Deemed lifetime tCO2e"]);
    for (const sector of report.sectors.rows) for (const [kind,values] of [["Activity",sector.activities],["Postcode",sector.postcodes],["Month",sector.trend]] as const) for (const row of values) rows.push([sector.label,kind,row.label,row.completedJobs,row.completedValueCents===null ? null : row.completedValueCents/100,row.veecQuantity,row.stcQuantity,row.estimatedTonnesCo2e]);
  }
  rows.push([], ["Campaign","Reference","Attributed enquiries","Completed jobs","Work value AUD ex GST"]);
  for (const row of report.campaigns) rows.push([row.name,row.referenceCode,row.enquiries,row.completedJobs,row.completedValueCents === null ? null : row.completedValueCents / 100]);
  rows.push([], ["Map postcode","Locality","Completed upgrades","Onboarded local businesses"]);
  for (const cell of report.map.cells) rows.push([cell.postcode,cell.label,cell.completedJobs,cell.registeredLocalBusinesses]);
  rows.push(["Map location basis",report.map.boundaryNote]);
  if (report.enquiries) {
    if (report.enquiries.sectors) {
      rows.push([], ["Community enquiry customer sector","Enquiries"]);
      for (const row of report.enquiries.sectors.rows) rows.push([row.label,row.count]);
    }
    rows.push([], ["Community enquiries by postcode","Enquiries"]);
    for (const row of report.enquiries.postcodes) rows.push([row.postcode,row.count]);
    rows.push([], ["Community enquiries by month","Enquiries"]);
    for (const row of report.enquiries.trend) rows.push([row.month,row.count]);
  }
  rows.push([], ["Reporting methodology"], ...report.methodology.map(note => [note]));
  return "\uFEFF" + rows.map(row => row.map(csvCell).join(",")).join("\r\n");
}
