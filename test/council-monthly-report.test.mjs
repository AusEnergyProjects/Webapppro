import test from "node:test";
import assert from "node:assert/strict";
import { extractText } from "unpdf";
import { PDFDict, PDFDocument, PDFName } from "pdf-lib";
import { councilMonthlyDemoBundle } from "../src/lib/council-monthly-demo.ts";
import { createCouncilMonthlyReportPdf } from "../src/lib/council-monthly-report-pdf.ts";
import { councilMonthlyScopeKey, parseCouncilMonthlySettings } from "../src/lib/council-monthly-report.ts";

const now = new Date("2026-10-08T00:00:00Z");
test("recipient settings reject malformed addresses, header injection and invented controls", () => {
  assert.deepEqual(parseCouncilMonthlySettings({ enabled: true, recipients: ["  Reports@Council.gov.au ", "reports@council.gov.au"] }), { enabled: true, recipients: ["reports@council.gov.au"] });
  for (const value of [
    { enabled: true, recipients: [] }, { enabled: true, recipients: ["valid@council.gov.au\r\nBcc: other@bad.test"] },
    { enabled: true, recipients: ["not-an-email"] }, { enabled: true, recipients: Array(11).fill("valid@council.gov.au") },
    { enabled: true, recipients: ["valid@council.gov.au"], sendNow: true },
  ]) assert.throws(() => parseCouncilMonthlySettings(value));
  assert.deepEqual(parseCouncilMonthlySettings({ enabled: false, recipients: [] }), { enabled: false, recipients: [] });
});
test("scope identity is order independent and changes for another council, state or postcode", () => {
  const scope = { id: "council", state: "VIC", postcodes: ["3182", "3205"] };
  assert.equal(councilMonthlyScopeKey(scope), councilMonthlyScopeKey({ ...scope, postcodes: ["3205", "3182"] }));
  for (const change of [{ id: "other" }, { state: "NSW" }, { postcodes: ["3182", "3206"] }]) assert.notEqual(councilMonthlyScopeKey(scope), councilMonthlyScopeKey({ ...scope, ...change }));
});
test("a public demonstration PDF uses real official sector data and clearly labels fictional TLink figures", async () => {
  const bundle = await councilMonthlyDemoBundle(now);
  assert.equal(bundle.profile.name, "SECCCA Demonstration");
  assert.equal(bundle.veu.sectors.basis, "official_activity_sector");
  assert.equal(bundle.veu.sectors.rows.reduce((sum, sector) => sum + sector.totals.activities, 0), bundle.veu.totals.activities);
  const bytes = await createCouncilMonthlyReportPdf(bundle);
  const pdf = await PDFDocument.load(bytes);
  assert.ok(pdf.getPageCount() >= 5); assert.ok(pdf.getPageCount() <= 12);
  assert.ok(pdf.getPages().every(page => Math.abs(page.getWidth() - 595.28) < .1 && Math.abs(page.getHeight() - 841.89) < .1));
  assert.ok(bundle.profile.logoDataUrl?.startsWith("data:image/png;base64,"));
  assert.ok(pdf.getPages().every(page => {
    const images = page.node.Resources().lookup(PDFName.of("XObject"), PDFDict);
    return images.keys().some(key => images.lookup(key).dict.get(PDFName.of("Subtype"))?.toString() === "/Image");
  }), "Council logo is embedded on every report page");
  const result = await extractText(bytes, { mergePages: true });
  for (const required of ["SECCCA Demonstration", "DEMONSTRATION", "official activity record", "fictional", "Residential", "Business", "not annual or measured", "Postcodes", "Storage kWh", "Source", "Actual electricity generated is unavailable"])
    assert.ok(result.text.includes(required), required);
});
test("PDF generation rejects mixed council scopes and an unlabeled demonstration", async () => {
  const bundle = await councilMonthlyDemoBundle(now);
  for (const section of ["community", "tlink", "veu"]) {
    const changed = structuredClone(bundle); changed[section].scope.councilId = "another-council";
    await assert.rejects(createCouncilMonthlyReportPdf(changed), /scope mismatch/);
  }
  await assert.rejects(createCouncilMonthlyReportPdf({ ...bundle, demonstration: false }), /identity mismatch/);
});
test("unknown and protected metrics stay unavailable, and private extra fields never enter the PDF", async () => {
  const bundle = await councilMonthlyDemoBundle(now);
  for (const row of bundle.tlink.sectors.rows) for (const key of Object.keys(row.metrics)) row.metrics[key] = null;
  bundle.community.totals.solarInstallations = null; bundle.community.reportedTotals.solarInstallations = 23;
  bundle.community.coverage.solarInstallations.availablePostcodes = 6;
  bundle.customerEmail = "private-person@example.test"; bundle.jobId = "TLJ-PRIVATE-1234";
  const { text } = await extractText(await createCouncilMonthlyReportPdf(bundle), { mergePages: true });
  assert.ok(text.includes("systems / partial")); assert.ok(text.includes("6/7 postcodes"));
  assert.ok(text.includes("Unavailable")); assert.ok(!text.includes(bundle.customerEmail)); assert.ok(!text.includes(bundle.jobId));
});
