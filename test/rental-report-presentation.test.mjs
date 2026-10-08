import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import { PDFArray, PDFDocument, PDFRawStream, PDFName, PDFDict, decodePDFRawStream } from "pdf-lib";
import * as branding from "../src/lib/rental-report-branding.mjs";
import { rentalAssessmentTemplateSnapshot } from "../src/lib/trade-rental-assessment.mjs";
import { rentalReportAnswerPresentation, rentalReportCheckStandard, rentalReportSectionGroups, rentalReportSectionResult, rentalReportScopeText, rentalReportObservationEntries, rentalReportRetainedObservationEntries } from "../src/lib/rental-report-answer.mjs";
import { createRentalAssessmentPdfBytes } from "../src/lib/trade-rental-report-pdf.mjs";

function completedModule() {
  const template = rentalAssessmentTemplateSnapshot(["minimum_standards"], "current_minimum_standards").modules.minimum_standards;
  return { ...template, id: "minimum", required: true, answers: {}, credential: {}, completedAt: "2026-09-23T01:00:00Z",
    sections: template.sections.map((section) => ({ ...section, items: section.checks.map((check) => ({ ...check, id: check.key,
      checkKey: check.key, outcome: "meets", response: {}, standardDescription: rentalReportCheckStandard({ ...check, checkKey: check.key }, { moduleKey: template.key }) })) })) };
}

function pdfText(pdf) {
  return pdf.getPages().flatMap((page) => {
    const contents = page.node.Contents();
    return (contents instanceof PDFArray ? contents.asArray() : contents ? [contents] : []).map((ref) => {
      const stream = pdf.context.lookup(ref);
      if (!(stream instanceof PDFRawStream)) return "";
      return Buffer.from(decodePDFRawStream(stream).getBytes()).toString("latin1")
        .replace(/<([0-9a-fA-F]+)>/g, (_match, hex) => Buffer.from(hex, "hex").toString("latin1"));
    });
  }).join("\n");
}

function reportWithModule(assessmentModule) {
  return { schemaVersion: "tlink-rental-report-v1", report: { number: "TEST-R1", issuedAt: "2026-09-23T01:00:00Z" },
    inspection: { assessmentScope: "current_minimum_standards", assessmentDate: "2026-09-23", rulesEffectiveFrom: "2026-06-30" },
    business: { name: "Australian Energy Assessments", abn: "73675233557" }, property: { address: "1 Example Street" },
    issuer: { name: "Example Assessor" }, modules: [assessmentModule], findings: [], evidence: [], sources: [] };
}

test("the licensed-electrician video-reviewed switchboard stands alone as a complete assessed standard", async () => {
  const assessmentModule = completedModule();
  const section = assessmentModule.sections.find((entry) => entry.key === "electrical_safety");
  assert.deepEqual(section.items.map((item) => item.checkKey), ["outlet_lighting_protection"]);
  const item = section.items[0];
  assert.equal(item.credentialGate, "assigned_assessor");
  assert.equal(item.verificationBasis, "licensed_electrician_video_review");
  assert.match(item.standardDescription, /circuit breaker and safety-switch protection/);
  assessmentModule.sections = [section];
  const snapshot = reportWithModule(assessmentModule);
  const before = structuredClone(snapshot);
  const result = rentalReportSectionResult(rentalReportSectionGroups(assessmentModule).current[0], { moduleKey: assessmentModule.key });
  assert.equal(result.label, "Meets assessed standard");
  assert.equal(rentalReportAnswerPresentation(item, { moduleKey: assessmentModule.key }).label, "Meets");
  const content = pdfText(await PDFDocument.load(await createRentalAssessmentPdfBytes(snapshot)));
  assert.match(content, /Meets assessed standard/);
  assert.match(content, /Meets/);
  assert.doesNotMatch(content, /Partly assessed|Visual check only|Equipment visible|Specialist credential|does not verify circuit protection/);
  assert.deepEqual(snapshot, before);
});

test("historical electrical uncertainty stays unverified when the current capture workflow changes", async () => {
  const assessmentModule = completedModule();
  const section = assessmentModule.sections.find((entry) => entry.key === "electrical_safety");
  section.items = [{ id: "older-protection", checkKey: "outlet_lighting_protection", outcome: "specialist_verification_required", historicalObservation: true,
    prompt: "Earlier circuit-protection check", response: {}, publicNotes: "Verification was not recorded." }];
  assessmentModule.sections = [section];
  const snapshot = reportWithModule(assessmentModule);
  const before = structuredClone(snapshot);
  assert.equal(rentalReportAnswerPresentation(section.items[0], { moduleKey: assessmentModule.key }).label, "Needs verification");
  const content = pdfText(await PDFDocument.load(await createRentalAssessmentPdfBytes(snapshot)));
  assert.match(content, /Earlier result: Needs verification/);
  assert.doesNotMatch(content, /Meets assessed standard|Yes, meets requirement/);
  assert.deepEqual(snapshot, before);
});

test("cooktop cable quoting preserves recorded zero and explicitly marks absent older measurements", async () => {
  const assessmentModule = completedModule();
  const kitchen = assessmentModule.sections.find((entry) => entry.key === "kitchen");
  const cooktop = kitchen.items.find((item) => item.checkKey === "cooktop_function");
  assessmentModule.sections = [kitchen];
  const snapshot = reportWithModule(assessmentModule);
  for (const response of [{}, { cableMeasurementStatus: "Measured", cooktopCableRunMetres: 0, cableRouteBasis: "Existing circuit at the installation position" }]) {
    cooktop.response = response;
    const before = structuredClone(snapshot);
    const entries = Object.fromEntries(rentalReportObservationEntries(cooktop));
    const expected = Object.hasOwn(response, "cooktopCableRunMetres") ? 0 : "Not recorded";
    assert.equal(entries.cooktopCableRunMetres, expected);
    const content = pdfText(await PDFDocument.load(await createRentalAssessmentPdfBytes(snapshot)));
    const drawText = [...content.matchAll(/^(.+) Tj$/gm)].map((match) => match[1]);
    const labelIndex = drawText.indexOf("Cooktop cable length (m)");
    assert.ok(labelIndex >= 0, "The cooktop cable measurement has its own labelled field");
    assert.equal(drawText[labelIndex + 1], String(expected), "The rendered value preserves zero and distinguishes uncaptured data");
    assert.deepEqual(snapshot, before);
  }
});

test("scope copy follows recorded modules and checks instead of the shared inspection enum", () => {
  const full = completedModule();
  const groups = rentalReportSectionGroups(full);
  const currentOnly = { ...full, sections: groups.current };
  const energyOnly = { ...full, sections: groups.future };
  const safetyOnly = { key: "electrical_safety_check", sections: [{ key: "tests", title: "Electrical tests", summary: "Test results", items: [{ checkKey: "rcd_testing", outcome: "meets" }] }] };
  const report = (assessmentModule) => ({ inspection: { assessmentScope: "current_minimum_standards" }, modules: [assessmentModule] });
  const before = structuredClone([full, currentOnly, energyOnly, safetyOnly]);
  assert.match(rentalReportScopeText(report(full)), /rental minimum standards and records its readiness for the new energy standards/);
  assert.match(rentalReportScopeText(report(currentOnly)), /assessed condition against Victoria's rental minimum standards/);
  assert.doesNotMatch(rentalReportScopeText(report(currentOnly)), /readiness|new energy standards/);
  assert.match(rentalReportScopeText(report(energyOnly)), /readiness for Victoria's new rental energy standards/);
  assert.doesNotMatch(rentalReportScopeText(report(energyOnly)), /condition against Victoria's rental minimum standards/);
  assert.match(rentalReportScopeText(report(safetyOnly)), /selected safety checks/);
  assert.doesNotMatch(rentalReportScopeText(report(safetyOnly)), /rental minimum standards|readiness|new energy standards/);
  assert.equal(rentalReportScopeText(currentOnly), rentalReportScopeText(report(currentOnly)));
  assert.equal(rentalReportScopeText(energyOnly), rentalReportScopeText(report(energyOnly)));
  assert.equal(rentalReportScopeText({ inspection: { reportBoundary: "Historical observations-only assessment." }, modules: [] }), "Historical observations-only assessment.");
  const historicalOnly = { ...full, sections: energyOnly.sections.map((section) => ({ ...section, items: section.items.map((item) => ({ ...item, historicalObservation: true })) })) };
  assert.match(rentalReportScopeText(report(historicalOnly)), /retains earlier assessment observations/);
  assert.doesNotMatch(rentalReportScopeText(report(historicalOnly)), /checks the home's readiness/);
  assert.deepEqual([full, currentOnly, energyOnly, safetyOnly], before);
});

test("current categories remain 1-15 and MEES separates four new categories from heating and showers", () => {
  const assessmentModule = completedModule();
  const before = structuredClone(assessmentModule);
  const groups = rentalReportSectionGroups(assessmentModule);
  assert.deepEqual(groups.current.map((section) => section.number), Array.from({ length: 15 }, (_, index) => index + 1));
  assert.deepEqual(groups.future.filter((section) => section.number > 15).map((section) => [section.number, section.key]), [
    [16, "cooling"], [17, "hot_water"], [18, "ceiling_insulation"], [19, "draughtproofing"],
  ]);
  assert.equal(groups.future.find((section) => section.key === "heating").heading, "3. Heating (2027 change)");
  assert.equal(groups.future.find((section) => section.key === "showers").heading, "1. Shower heads (2027 change)");
  const originalIds = assessmentModule.sections.flatMap((section) => section.items.map((item) => item.id));
  assert.deepEqual([...groups.current, ...groups.future].flatMap((section) => section.items.map((item) => item.id)).sort(), originalIds.sort());
  assert.deepEqual(assessmentModule, before);
});

test("category rollups distinguish evidence limits, incomplete checks, future upgrades and visual observations", () => {
  const groups = rentalReportSectionGroups(completedModule());
  const options = { moduleKey: "minimum_standards" };
  const kitchen = groups.current.find((section) => section.key === "kitchen");
  assert.equal(rentalReportSectionResult(kitchen, options).label, "Meets assessed standard");
  assert.equal(rentalReportSectionResult({ ...kitchen, items: kitchen.items.slice(0, 1) }, options).label, "Partly assessed; see details");
  assert.equal(rentalReportSectionResult(kitchen, { ...options, applicabilityLimitation: "Regime unconfirmed" }).label, "Legal applicability unconfirmed");
  assert.equal(rentalReportSectionResult(groups.current.find((section) => section.key === "mould_damp"), options).label, "No issue observed");
  const uncertain = { ...kitchen, items: kitchen.items.map((item, index) => index === 0 ? { ...item, outcome: "specialist_verification_required" } : item) };
  assert.equal(rentalReportSectionResult(uncertain, options).label, "Needs verification");
  const failed = { ...kitchen, items: [{ ...kitchen.items[0], outcome: "does_not_meet" }] };
  assert.equal(rentalReportSectionResult(failed, options).label, "Action required");
  assert.equal(rentalReportSectionResult({ ...failed, readiness: true }, options).label, "Upgrade planning needed");
  assert.equal(rentalReportSectionResult({ ...failed, items: failed.items.map((item) => ({ ...item, historicalObservation: true })) }, options).label, "No current assessment");
  assert.equal(rentalReportSectionResult({ ...kitchen, items: [{ checkKey: "unknown", outcome: "meets" }] }, options).tone, "caution");
});

test("new quoting inputs are unknown for earlier capture and never guessed or added to the saved answer", () => {
  const oldHotWater = { checkKey: "hot_water_2027_readiness", outcome: "does_not_meet", response: { model: "Existing gas system" } };
  const before = structuredClone(oldHotWater);
  const details = Object.fromEntries(rentalReportObservationEntries(oldHotWater));
  assert.equal(details.hotWaterCableRunMetres, "Not recorded");
  assert.equal(details.cableMeasurementStatus, "Not recorded");
  assert.equal(details.cableRouteBasis, "Not recorded");
  assert.deepEqual(oldHotWater, before);
  const measured = Object.fromEntries(rentalReportObservationEntries({ ...oldHotWater, response: { hotWaterCableRunMetres: 12.5, cableMeasurementStatus: "Estimated", cableRouteBasis: "Along the side wall, including rises" } }));
  assert.equal(measured.hotWaterCableRunMetres, 12.5);
  assert.equal(measured.cableMeasurementStatus, "Estimated");
  assert.ok(!Object.hasOwn(measured, "cableLimitationReason"));
  const unable = Object.fromEntries(rentalReportObservationEntries({ ...oldHotWater, response: { cableMeasurementStatus: "Unable to determine", cableLimitationReason: "Concealed route" } }));
  assert.equal(unable.cableLimitationReason, "Concealed route");
  assert.ok(!Object.hasOwn(unable, "hotWaterCableRunMetres"));
  assert.equal(Object.fromEntries(rentalReportObservationEntries({ checkKey: "artificial_lighting", outcome: "meets", response: {} })).nonIc4DownlightCount, "Not recorded");
  assert.ok(!Object.hasOwn(Object.fromEntries(rentalReportObservationEntries({ checkKey: "artificial_lighting", outcome: "meets", response: { downlightCountStatus: "No downlights" } })), "downlightEvidence"));
  assert.equal(Object.fromEntries(rentalReportObservationEntries({ checkKey: "ceiling_2027_readiness", outcome: "meets", response: {} })).joistClearWidthMm, "Not recorded");
  for (const [checkKey, mode] of [["heater_efficiency", "heating"], ["heating_2027_readiness", "heating"], ["cooling_2027_readiness", "cooling"]]) {
    const rating = Object.fromEntries(rentalReportObservationEntries({ checkKey, outcome: "meets", response: { applianceType: "Split system" } }));
    for (const suffix of ["GemsStatus", "EnergyRating", "RatingZone", "RatingBasis", "GemsReference", "RatingLimitation"]) assert.ok(!Object.hasOwn(rating, `${mode}${suffix}`));
  }
  const shared = Object.fromEntries(rentalReportObservationEntries({ checkKey: "hot_water_2027_readiness", outcome: "specialist_verification_required", response: { hotWaterSupplyType: "Shared building system", sharedHotWaterServiceStatus: "Hot water supplied when checked", sharedHotWaterLimitation: "Plant not inspected", cableMeasurementStatus: "Measured", hotWaterCableRunMetres: "15" } }));
  assert.ok(!Object.hasOwn(shared, "hotWaterCableRunMetres"));
});

test("retired rating questions preserve saved values and their active or retained report history", async () => {
  for (const [checkKey, mode] of [["heater_efficiency", "heating"], ["heating_2027_readiness", "heating"], ["cooling_2027_readiness", "cooling"]]) {
    for (const historicalObservation of [false, true]) {
      const assessmentModule = completedModule();
      const section = assessmentModule.sections.find((entry) => entry.items.some((item) => item.checkKey === checkKey));
      const item = section.items.find((entry) => entry.checkKey === checkKey);
      const savedRating = { [`${mode}GemsStatus`]: "Label recorded", [`${mode}EnergyRating`]: "3.5 stars", [`${mode}RatingZone`]: "Cold", [`${mode}RatingBasis`]: "Appliance label", [`${mode}GemsReference`]: "GEMS-RECORDED-REFERENCE", [`${mode}RatingLimitation`]: "Earlier unreadable label" };
      item.response = { applianceType: "Split system", ...savedRating };
      item.historicalObservation = historicalObservation;
      assessmentModule.sections = [{ ...section, items: [item] }];
      const snapshot = reportWithModule(assessmentModule);
      const before = structuredClone(snapshot);
      const active = Object.fromEntries(rentalReportObservationEntries(item));
      const retained = Object.fromEntries(rentalReportRetainedObservationEntries(item));
      const combined = { ...active, ...retained };
      for (const [key, value] of Object.entries(savedRating)) assert.equal(combined[key], value);
      assert.equal((historicalObservation ? active : retained)[`${mode}RatingLimitation`], savedRating[`${mode}RatingLimitation`]);
      const content = pdfText(await PDFDocument.load(await createRentalAssessmentPdfBytes(snapshot)));
      for (const value of Object.values(savedRating)) assert.ok(content.includes(value), `${checkKey}: ${value}`);
      assert.deepEqual(snapshot, before, "Rendering must not change the saved rating, its earlier limitation, or the issued snapshot");
    }
  }
});

test("HomeStar PDF retains TLink, puts the plain summary first, and preserves the data and geotags", async () => {
  const assessmentModule = completedModule();
  const hotWater = assessmentModule.sections.find((section) => section.key === "hot_water").items[0];
  hotWater.outcome = "does_not_meet";
  hotWater.response = { model: "Existing gas system" };
  assessmentModule.answers.homeStarCommissioned = true;
  const snapshot = { schemaVersion: "tlink-rental-report-v1", report: { number: "TEST-R1", issuedAt: "2026-09-23T01:00:00Z", branding: "homestar" },
    inspection: { assessmentScope: "current_minimum_standards", assessmentDate: "2026-09-23", rulesEffectiveFrom: "2026-06-30" },
    business: { name: "Australian Energy Assessments", abn: "73675233557" }, property: { address: "1 Example Street" }, issuer: { name: "Example Assessor" },
    modules: [assessmentModule], findings: [{ id: "hot-water-finding", itemId: hotWater.id, title: "Plan hot-water upgrade", status: "open", severity: "recommended", description: "System photographed", details: {} }],
    evidence: [{ id: "photo", itemId: hotWater.id, contentType: "image/jpeg", fileName: "photo.jpg", caption: "System label", capture: { source: "in_app_camera", capturedAtUtc: "2026-09-23T01:00:00Z", locationCaptured: true, latitude: -37.8, longitude: 145.1, accuracyMetres: 7 } }], sources: [] };
  const before = structuredClone(snapshot);
  const pdf = await PDFDocument.load(await createRentalAssessmentPdfBytes(snapshot), { updateMetadata: false });
  const content = pdfText(pdf);
  assert.equal(pdf.getProducer(), "TLink");
  assert.match(content, /TLink/);
  assert.match(content, /Australian Energy Assessments/);
  assert.match(content, /HomeStar Upgrades/);
  assert.match(content, /Commissioned by/);
  assert.ok(content.indexOf("Current assessment at a glance") < content.indexOf("Observations for quoting"));
  assert.ok(content.indexOf("2027 energy standards") < content.indexOf("Observations for quoting"));
  assert.match(content, /1 March 2027/);
  assert.match(content, /1 July 2027/);
  assert.match(content, /Not recorded/);
  assert.match(content, /-37\.800000, 145\.100000/);
  assert.match(content, /HomeStar Upgrades will be in contact/);
  assert.doesNotMatch(content, /Current issues|Future upgrades|Need verification|Recorded findings/);
  assert.match(content, /Assessed standard:/);
  assert.match(content, /Captured caption: System label/);
  assert.doesNotMatch(content, /Home Star Commissioned/);
  assert.doesNotMatch(content, /No account is required/);
  assert.deepEqual(snapshot, before);
  snapshot.report.branding = "standard";
  const ordinaryText = pdfText(await PDFDocument.load(await createRentalAssessmentPdfBytes(snapshot)));
  assert.match(ordinaryText, /TLink/);
  assert.doesNotMatch(ordinaryText, /HomeStar Upgrades|Commissioned by/);
});

test("the actual conditional brand loader embeds all three logos only on commissioned AEA reports", async () => {
  const source = await readFile(new URL("../src/lib/trade-rental-report-brand.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const images = {};
  for (const name of ["tlink-icon-192.png", "aea-email-signature-brand-lockup.png", "homestar-upgrades.png"]) {
    images[`../../public/${name}?inline`] = { __esModule: true, default: `data:image/png;base64,${(await readFile(new URL(`../public/${name}`, import.meta.url))).toString("base64")}` };
  }
  const dependencies = { ...images, "./rental-report-branding.mjs": branding };
  const output = { exports: {} };
  new Function("require", "module", "exports", compiled)((id) => {
    assert.ok(id in dependencies, `Unexpected brand dependency: ${id}`);
    return dependencies[id];
  }, output, output.exports);
  const snapshot = reportWithModule(completedModule());
  for (const [flag, abn, expectedImages] of [["homestar", "73675233557", 3], ["standard", "73675233557", 1], [undefined, "73675233557", 1], ["homestar", "12345678901", 1]]) {
    snapshot.report.branding = flag;
    snapshot.business.abn = abn;
    const before = structuredClone(snapshot);
    const pdf = await PDFDocument.load(await createRentalAssessmentPdfBytes(snapshot, {}, {}, output.exports.rentalReportBrandBytes(snapshot)));
    const objects = pdf.getPage(0).node.Resources().lookup(PDFName.of("XObject"), PDFDict);
    assert.equal(objects.keys().length, expectedImages, "TLink remains; AEA and HomeStar assets require the frozen AEA commissioning flag");
    assert.deepEqual(snapshot, before);
  }
});

test("future presentation dates do not overwrite an issued check's original effective date or trigger", async () => {
  const snapshot = reportWithModule(completedModule());
  const item = snapshot.modules[0].sections.find((section) => section.key === "draughtproofing").items[0];
  item.effectiveFrom = "2027-07-01";
  item.trigger = "Original frozen trigger: a new agreement from 1 July 2027";
  const before = structuredClone(snapshot);
  const content = pdfText(await PDFDocument.load(await createRentalAssessmentPdfBytes(snapshot)));
  assert.match(content, /1 March 2027/);
  assert.match(content, /Original frozen trigger: a new agreement from 1 July 2027/);
  assert.deepEqual(snapshot, before);
});
