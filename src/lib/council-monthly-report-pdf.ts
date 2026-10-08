import { PDFDocument, StandardFonts, rgb, type PDFPage, type PDFFont } from "pdf-lib";
import { COMMUNITY_METRICS, CER_COMMUNITY_URL } from "./council-community.ts";
import { COUNCIL_VEU_SOURCE_URL } from "./council-veu.ts";
import { councilMonthlyScopeKey, type CouncilMonthlyReportBundle } from "./council-monthly-report.ts";
import { councilThemeVariables } from "./council-theme.ts";

const text = (value: string) => value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[–—]/g, "-").replace(/₂/g, "2").replace(/…/g, "...").replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[^\x20-\x7e\n]/g, " ");
const number = (value: number | null, decimals = 0) => value === null ? "Unavailable" : new Intl.NumberFormat("en-AU", { maximumFractionDigits: decimals }).format(value);
const date = (value: string) => new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Melbourne", day: "numeric", month: "short", year: "numeric" }).format(new Date(value));
const colour = (hex: string) => /^#[0-9a-f]{6}$/i.test(hex) ? rgb(parseInt(hex.slice(1, 3), 16) / 255, parseInt(hex.slice(3, 5), 16) / 255, parseInt(hex.slice(5, 7), 16) / 255) : rgb(.06, .30, .46);

/** The PDF consumes only the same protected aggregate reports shown in the council workspace. */
export async function createCouncilMonthlyReportPdf(bundle: CouncilMonthlyReportBundle): Promise<Uint8Array> {
  const { profile, community, veu, tlink } = bundle;
  const scope = councilMonthlyScopeKey(profile);
  if (scope !== councilMonthlyScopeKey(community.scope) || scope !== councilMonthlyScopeKey(tlink.scope) || (veu && scope !== councilMonthlyScopeKey(veu.scope))) throw new Error("Council PDF scope mismatch.");
  if (!Number.isFinite(Date.parse(bundle.generatedAt)) || bundle.demonstration !== (tlink.mode === "demonstration")) throw new Error("Council PDF identity mismatch.");
  const doc = await PDFDocument.create();
  doc.setTitle(`${bundle.demonstration ? "Demonstration: " : ""}${profile.name} - community energy progress`);
  doc.setAuthor("TLink Council"); doc.setSubject("Official community energy data and separately identified TLink participation");
  doc.setCreationDate(new Date(bundle.generatedAt)); doc.setModificationDate(new Date(bundle.generatedAt));
  const regular = await doc.embedFont(StandardFonts.Helvetica), bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(.07, .16, .22), muted = rgb(.30, .39, .43), pale = rgb(.94, .97, .98), line = rgb(.82, .88, .90), white = rgb(1, 1, 1);
  const tokens = councilThemeVariables(profile.theme, "day");
  const brand = colour(tokens["--c-sidebar"]), accent = colour(profile.theme.accentColor);
  const W = 595.28, H = 841.89, margin = 40, width = W - margin * 2;
  let page: PDFPage, y = H - 118, section = "";
  let logo: Awaited<ReturnType<PDFDocument["embedPng"]>> | undefined;
  if (profile.logoDataUrl) {
    const match = /^data:image\/(png|jpeg);base64,([a-zA-Z0-9+/=]+)$/.exec(profile.logoDataUrl);
    if (match) { const bytes = Uint8Array.from(atob(match[2]), char => char.charCodeAt(0)); logo = match[1] === "png" ? await doc.embedPng(bytes) : await doc.embedJpg(bytes); }
  }
  function draw(value: string, x: number, top: number, size = 10, font: PDFFont = regular, fill = ink) { page.drawText(text(value), { x, y: top - size, size, font, color: fill }); }
  function lines(value: string, available: number, size: number, font = regular): string[] {
    const result: string[] = [];
    for (const paragraph of text(value).split("\n")) {
      let current = "";
      for (const word of paragraph.split(/\s+/)) {
        if (!word) continue;
        if (font.widthOfTextAtSize(current ? `${current} ${word}` : word, size) <= available) { current = current ? `${current} ${word}` : word; continue; }
        if (current) result.push(current); current = "";
        let rest = word;
        while (font.widthOfTextAtSize(rest, size) > available) { let length = 1; while (length < rest.length && font.widthOfTextAtSize(rest.slice(0, length + 1), size) <= available) length++; result.push(rest.slice(0, length)); rest = rest.slice(length); }
        current = rest;
      }
      result.push(current);
    }
    return result;
  }
  function newPage(title: string, subtitle: string) {
    section = title; page = doc.addPage([W, H]); y = H - 136;
    page.drawRectangle({ x: 0, y: H - 98, width: W, height: 98, color: brand });
    page.drawRectangle({ x: 0, y: H - 102, width: W, height: 4, color: accent });
    let offset = 0;
    if (logo) {
      const scale = Math.min(104 / logo.width, 44 / logo.height), logoWidth = logo.width * scale, logoHeight = logo.height * scale;
      page.drawRectangle({ x: margin, y: H - 76, width: logoWidth + 16, height: 52, color: white });
      page.drawImage(logo, { x: margin + 8, y: H - 50 - logoHeight / 2, width: logoWidth, height: logoHeight });
      offset = logoWidth + 28;
    }
    const councilName = lines(profile.name, width - offset - 138, 15, bold).slice(0, 2);
    councilName.forEach((row, index) => draw(row, margin + offset, H - 20 - index * 18, 15, bold, white));
    draw(bundle.demonstration ? "DEMONSTRATION" : "COMMUNITY ENERGY", margin + offset, H - 68, 8, bold, white);
    draw(`CER edition ${community.sourceAsOf}`, W - margin - 126, H - 24, 9, regular, white);
    draw(`Prepared ${date(bundle.generatedAt)}`, W - margin - 126, H - 42, 9, regular, white);
    draw(title, margin, H - 119, 17, bold); y -= 18;
    paragraph(subtitle, 9, muted, 4);
  }
  function space(height: number) { if (y - height < 66) newPage(`${section} / continued`, "Approved postcode area. Sources and coverage remain separate."); }
  function paragraph(value: string, size = 10, fill = muted, after = 10) { const rows = lines(value, width, size); space(rows.length * (size + 4) + after); for (const row of rows) { draw(row, margin, y, size, regular, fill); y -= size + 4; } y -= after; }
  function heading(value: string) { space(34); y -= 5; draw(value, margin, y, 13, bold); y -= 25; }
  function card(x: number, top: number, cardWidth: number, title: string, value: string, note: string) {
    page.drawRectangle({ x, y: top - 106, width: cardWidth, height: 106, color: pale });
    const titleRows = lines(title, cardWidth - 22, 9, bold);
    titleRows.forEach((row, index) => draw(row, x + 11, top - 10 - index * 12, 9, bold));
    let size = 24; while (size > 12 && bold.widthOfTextAtSize(text(value), size) > cardWidth - 22) size--;
    draw(value, x + 11, top - 42, size, bold, brand);
    lines(note, cardWidth - 22, 8).slice(0, 3).forEach((row, index) => draw(row, x + 11, top - 76 - index * 10, 8, regular, muted));
  }
  function table(headers: string[], rows: string[][], widths: number[], compact = false) {
    function header() { space(35); page.drawRectangle({ x: margin, y: y - 26, width, height: 26, color: brand }); let x = margin; headers.forEach((label, index) => { draw(label, x + 7, y - 8, 8, bold, white); x += widths[index]; }); y -= 26; }
    header();
    for (const row of rows) {
      const values = row.map((cell, index) => lines(cell, widths[index] - 14, 9));
      const height = Math.max(...values.map(value => value.length)) * 12 + (compact ? 6 : 14);
      if (y - height < 66) { newPage(`${section} / continued`, "Approved postcode area. Sources and coverage remain separate."); header(); }
      page.drawLine({ start: { x: margin, y }, end: { x: W - margin, y }, color: line, thickness: .5 });
      let x = margin; values.forEach((value, index) => { value.forEach((cell, offset) => draw(cell, x + 7, y - (compact ? 3 : 7) - offset * 12, 9, index === 0 ? bold : regular)); x += widths[index]; }); y -= height;
    }
    y -= 14;
  }
  newPage("Community progress", "Official energy upgrade and installation data, followed by your council's separately identified TLink participation.");
  if (bundle.demonstration) paragraph(`Preview for ${profile.name}. This is a TLink demonstration with no council affiliation or endorsement. Official figures are real public data; every TLink participation figure is fictional.`, 9);
  paragraph(`Reporting area: ${profile.postcodes.join(", ")}. Postcodes can cross council boundaries; this is a postcode report, not an exact municipal-boundary total.`, 9);
  heading("Installations across your community");
  paragraph(`Clean Energy Regulator / ${community.period.label}: ${community.period.startMonth} to ${community.period.endMonth}. Residential and business combined.`, 9);
  const cw = (width - 20) / 3; space(228);
  COMMUNITY_METRICS.forEach((metric, index) => { const coverage = community.coverage[metric.id], whole = community.totals[metric.id], partial = whole === null; card(margin + (index % 3) * (cw + 10), y - Math.floor(index / 3) * 116, cw, metric.label, number(partial ? community.reportedTotals[metric.id] : whole, metric.unit === "systems" ? 0 : 1), `${metric.unit}${partial ? " / partial" : ""} | ${coverage.availablePostcodes}/${coverage.requestedPostcodes} postcodes`); }); y -= 238;
  paragraph("Installed solar kW is power capacity. Battery kWh is usable storage capacity. Neither is electricity generated. CER postcode files do not identify residential versus business installations or measured CO2 savings.", 9);
  heading("Business and residential upgrades");
  if (veu?.sectors) {
    table(["Official VEU sector", "Approved activities", "Lifetime CO2-e (t)"], veu.sectors.rows.map(row => [row.label, number(row.totals.activities), number(row.totals.estimatedLifetimeTonnesCo2e, 1)]), [215, 150, width - 365]);
    paragraph(`${veu.period.label} by activity date. Source refreshed ${date(veu.source.refreshedAt)}. Sector comes from the official activity record. Activities are not unique premises or equipment units. Lifetime CO2-e is deemed from reported VEEC equivalents, not annual or measured savings.`, 9);
  } else paragraph(profile.state === "VIC" ? "Official VEU sector data is unavailable in this retained snapshot. The next successful source refresh can supply the official split. No sector has been inferred." : "A business/residential activity register is not connected for this state. CER installation figures remain useful and are reported above without an invented sector split.", 9);

  newPage("Local upgrades and activity", "Victorian Energy Upgrades / approved public activity records. These totals overlap other datasets and must not be added to CER or TLink totals.");
  if (veu) {
    paragraph(`${veu.period.label}: ${veu.period.startDate ?? "earliest published history"} to ${veu.period.endDate ?? date(veu.source.refreshedAt)}. Coverage ${veu.coverage.availablePostcodes}/${veu.coverage.requestedPostcodes} postcodes. ${veu.source.stale ? "Retained data: source refresh is overdue or failed." : "Source checked " + date(veu.source.checkedAt) + "."}`, 9);
    heading("Where upgrades are happening");
    table(["Postcode", "Business", "Residential", "Other / unknown", "All activities"], veu.postcodes.map(row => [row.postcode, ...["business", "residential", "unclassified"].map(key => number(veu.sectors?.rows.find(sector => sector.key === key)?.postcodes.find(item => item.postcode === row.postcode)?.activities ?? null)), number(row.activities)]), [80, 106, 106, 117, width - 409]);
    for (const sector of veu.sectors?.rows ?? []) {
      heading(`${sector.label} / upgrade activity`);
      const sorted = [...sector.activities].sort((a, b) => (b.activities ?? -1) - (a.activities ?? -1));
      if (!sorted.length) paragraph("No approved activities recorded for this sector in this period.", 9);
      else table(["Activity", "Activities", "Lifetime CO2-e (t)"], sorted.map(row => [row.activity, number(row.activities), number(row.estimatedLifetimeTonnesCo2e, 1)]), [310, 75, width - 385]);
    }
    if (!veu.sectors) table(["Activity / combined sectors", "Activities", "Lifetime CO2-e (t)"], veu.activities.map(row => [row.activity, number(row.activities), number(row.estimatedLifetimeTonnesCo2e, 1)]), [310, 75, width - 385]);
  } else paragraph("No official VEU activity dataset is available for this report. Its figures have not been filled with TLink participation or assumed to be zero.");

  newPage("Solar and storage by postcode", `Clean Energy Regulator / ${community.period.label}. Data through ${date(community.sourceAsOf)}.`);
  table(["Postcode", "Solar systems", "Solar kW", "Batteries", "Storage kWh"], community.postcodes.map(row => [row.postcode, number(row.values.solarInstallations), number(row.values.solarCapacityKw, 1), number(row.values.batteryInstallations), number(row.values.batteryCapacityKwh, 1)]), [79, 109, 109, 109, width - 406], true);
  heading("Published monthly installation trend");
  table(["Month", "Solar systems", "Coverage", "Batteries", "Coverage"], community.trend.map(row => [row.month, number(row.reportedValues.solarInstallations), `${row.coverage.solarInstallations.availablePostcodes}/${row.coverage.solarInstallations.requestedPostcodes}`, number(row.reportedValues.batteryInstallations), `${row.coverage.batteryInstallations.availablePostcodes}/${row.coverage.batteryInstallations.requestedPostcodes}`]), [79, 109, 109, 109, width - 406], true);
  paragraph("A partial series sums available postcode observations only. Changing coverage can affect the trend. Blank or missing source data remains unavailable, never zero. Recent CER totals can be revised for up to 12 months as certificates are created. Batteries begin in July 2025.", 9);
  if (community.stale) paragraph("Retained CER snapshot: data is overdue or a refresh failed. Read the source date and coverage before using these figures.", 9);

  newPage(bundle.demonstration ? "Sample TLink participation" : "Your TLink participation", `${tlink.period.label}: ${tlink.period.start} to ${tlink.period.end}. This section includes only protected work and enquiries recorded in TLink.`);
  paragraph(bundle.demonstration ? "Every figure in this section is fictional demonstration data. It illustrates the format and cannot be cited as actual council outcomes." : tlink.dataQuality.coverageNote, 9);
  const sectorRows = tlink.sectors?.rows ?? [];
  table(["Recorded customer sector", "Completed jobs", "Work value / ex GST"], sectorRows.map(row => [row.label, number(row.metrics.completedJobs), row.metrics.completedValueCents === null ? "Unavailable" : "$" + number(row.metrics.completedValueCents / 100, 2)]), [215, 135, width - 350]);
  heading("Supported outcomes in TLink");
  table(["Sector", "Generation capacity kW", "Storage kWh", "Lifetime CO2-e (t)"], sectorRows.map(row => [row.label, number(row.metrics.generationCapacityKw, 1), number(row.metrics.storageCapacityKwh, 1), number(row.metrics.estimatedTonnesCo2e, 1)]), [145, 123, 123, width - 391]);
  paragraph(tlink.sectors?.coverageNote ?? "The protected sector breakdown is unavailable.", 9);
  paragraph("Actual electricity generated is unavailable. Capacity covers only current reviewed, provider-accepted evidence. Carbon uses supported VEU lifetime evidence and excludes STCs. Protected small groups are unavailable. Work value excludes GST and is not council revenue or total economic impact.", 9);
  heading("Council referral activity");
  if (tlink.campaigns.length) table(["Campaign", "Enquiries", "Completed jobs"], tlink.campaigns.map(row => [row.name, number(row.enquiries), number(row.completedJobs)]), [310, 95, width - 405]);
  else paragraph("No publishable council campaign outcomes for this period.", 9);
  paragraph("An attributed referral records a council link. It does not prove that the council caused the upgrade. Private customer names, contacts, addresses and job identifiers are excluded. Minimum TLink cohort: five distinct customer records with complementary suppression.", 9);

  newPage("Sources and reporting notes", "A transparent record of the reporting area, publication dates and interpretation limits.");
  heading("Clean Energy Regulator");
  paragraph(`${CER_COMMUNITY_URL}\nData through ${community.sourceAsOf}; fetched ${date(community.fetchedAt)}; checked ${date(community.checkedAt)}. Community installations with validly created certificates. Based on CER material under Creative Commons Attribution 4.0; filtered and aggregated for selected postcodes.`, 9);
  heading("Victorian Energy Upgrades");
  paragraph(`${COUNCIL_VEU_SOURCE_URL}\n${veu ? `Public Activities report refreshed ${veu.source.refreshedAt}; fetched ${veu.source.fetchedAt}. Approved activities, grouped by official Sector and postcode. Reported VEEC equivalents are not independently verified registered certificates.` : "Not available for this report."}`, 9);
  paragraph("One reported VEEC equivalent represents one deemed lifetime tonne of CO2-e under VEU. No annual or actual measured carbon reduction is reported. Activity date and certificate date differ. Revisions can reduce totals.", 9);
  heading("Use each source for its own purpose");
  paragraph("CER installations, VEU activities and TLink jobs can describe the same upgrade. They are presented separately and never added together. Official source data describes community-wide uptake, while TLink measures platform participation. Sector is supplied by the official VEU record or the recorded CRM customer type; installation size and the trade's business status are never used to infer customer sector.", 9);
  paragraph(`Approved postcode area: ${profile.postcodes.join(", ")}. Postcodes cross municipal boundaries. Capacity is not generation. Unknowns and protected cohorts remain unavailable. This PDF is a dated snapshot; consult the workspace for updated information.`, 9);
  if (bundle.demonstration) paragraph(`${profile.name} only, without council affiliation or endorsement. Selected representative postcodes across SECCCA member areas are not a complete alliance boundary. No monthly email subscription is enabled by viewing this demonstration.`, 9);
  const pages = doc.getPages();
  pages.forEach((item, index) => { item.drawLine({ start: { x: margin, y: 49 }, end: { x: W - margin, y: 49 }, color: line, thickness: .7 }); item.drawText(text(`${bundle.demonstration ? "DEMONSTRATION | " : ""}TLink Council | Official data and platform participation reported separately`), { x: margin, y: 32, size: 7, font: regular, color: muted }); item.drawText(`${index + 1} / ${pages.length}`, { x: W - margin - 30, y: 32, size: 8, font: bold, color: ink }); });
  return doc.save();
}
