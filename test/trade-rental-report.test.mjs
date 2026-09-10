import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFRawStream,
  decodePDFRawStream,
} from "pdf-lib";
import { createRentalAssessmentPdfBytes } from "../src/lib/trade-rental-report-pdf.mjs";
import { RENTAL_OBSERVATION_NUMBER_FIELDS, rentalObservationResponseLabel } from "../src/lib/rental-quotation.mjs";
import * as answerPresentation from "../src/lib/rental-report-answer.mjs";

function decodedPageContent(pdf) {
  const output = [];
  for (const page of pdf.getPages()) {
    const contents = page.node.Contents();
    const streams = contents instanceof PDFArray ? contents.asArray() : contents ? [contents] : [];
    for (const streamReference of streams) {
      const stream = pdf.context.lookup(streamReference);
      if (!(stream instanceof PDFRawStream)) continue;
      const decoded = Buffer.from(decodePDFRawStream(stream).getBytes()).toString("latin1");
      output.push(decoded.replace(/<([0-9a-fA-F]+)>/g, (_match, hex) => Buffer.from(hex, "hex").toString("latin1")));
    }
  }
  return output.join("\n");
}

function reportSnapshot() {
  return {
    schemaVersion: "tlink-rental-report-v1",
    report: { id: "report-1", number: "RI-1001-R1", revision: 1, issuedAt: "2026-08-24T03:00:00.000Z" },
    inspection: { number: "RI-1001", assessmentDate: "2026-08-24", rulesEffectiveFrom: "2026-06-30" },
    property: { address: "10 Example Street, Melbourne VIC 3000", customerName: "Example Agent", customerEmail: "agent@example.com", customerPhone: "0400000000" },
    business: { name: "Example Trade Business", abn: "12345678901", email: "office@example.com", phone: "0390000000" },
    issuer: { name: "Alex Assessor", role: "Assessor", qualificationType: "Qualified assessor", qualificationNumber: "QA-100", declaration: "Assessment declaration accepted.", authenticatedAt: "2026-08-24T03:00:00.000Z" },
    modules: [{
      id: "module-1",
      key: "minimum_standards",
      title: "Rental minimum standards",
      required: true,
      completedAt: "2026-08-24T02:55:00.000Z",
      reportBoundary: "Assessment of the current Victorian rental minimum standards.",
      answers: { assessmentDate: "2026-08-24", assessorDeclaration: true, internalNotes: "MODULE SECRET" },
      sections: [{
        key: "bathroom",
        title: "Bathroom",
        summary: "Bathroom fixtures and water supply.",
        items: [{
          id: "item-1",
          prompt: "The bathroom has the required fixtures and water supply.",
          outcome: "does_not_meet",
          locationLabel: "Main bathroom",
          publicNotes: "PUBLIC DEFECT DETAIL",
          internalNotes: "ITEM SECRET",
          response: { make: "Example", internal_notes: "RESPONSE SECRET" },
        }],
      }],
    }],
    findings: [{
      id: "finding-1",
      itemId: "item-1",
      title: "Repair the bathroom fixture",
      description: "The fixture did not operate during assessment.",
      status: "open",
      severity: "repair_required",
      tradeCategory: "plumber",
      locationLabel: "Main bathroom",
      recommendedAction: "Inspect and repair the fixture.",
      scopeSummary: "Supply labour and materials to repair the bathroom fixture.",
      quantityMilli: 1000,
      unitLabel: "each",
      internalNotes: "FINDING SECRET",
      details: { access: "Normal access", internalNotes: "NESTED SECRET" },
    }],
    evidence: [],
    sources: [{ title: "Current Victorian source", url: "https://example.com/source", effectiveFrom: "2026-06-30" }],
  };
}

test("readiness PDF names the future scope and avoids presenting a planning gap as today's non-compliance", async () => {
  const snapshot = reportSnapshot();
  snapshot.inspection = { ...snapshot.inspection, title: "2027 Victorian rental energy readiness assessment",
    assessmentScope: "energy_readiness_2027", rulesEffectiveFrom: "2027-03-01",
    reportBoundary: "Energy readiness assessment for phased future requirements. Planning findings do not establish non-compliance with current rental law." };
  snapshot.modules[0].assessmentScope = "energy_readiness_2027";
  snapshot.modules[0].title = "2027 rental energy readiness";
  snapshot.modules[0].sections[0].items[0].trigger = "New agreement or periodic conversion from 1 March 2027";
  const pdf = await PDFDocument.load(await createRentalAssessmentPdfBytes(snapshot));
  assert.equal(pdf.getSubject(), snapshot.inspection.title);
  const content = decodedPageContent(pdf);
  assert.match(content, /2027 Victorian rental energy/);
  assert.match(content, /FIRST PHASE STARTS/);
  assert.match(content, /Upgrade planning required/);
  assert.match(content, /Planning findings do not establish/);
  assert.match(content, /New agreement or periodic conversion from 1 March 2027/);
});

test("rental assessment PDF is readable, branded and excludes internal notes recursively", async () => {
  const snapshot = reportSnapshot();
  snapshot.evidence = [{
    id: "evidence-gps",
    itemId: "item-1",
    findingId: "finding-1",
    fileName: "bathroom-photo.jpg",
    contentType: "image/jpeg",
    sizeBytes: 18,
    originalSha256: "c".repeat(64),
    caption: "Bathroom fixture evidence",
    capture: {
      source: "in_app_camera",
      capturedAtUtc: "2026-08-24T02:46:00.000Z",
      locationCaptured: true,
      latitude: -37.813629,
      longitude: 144.963058,
      accuracyMetres: 6.7,
    },
  }];
  const bytes = await createRentalAssessmentPdfBytes(snapshot);
  assert.ok(bytes.byteLength > 4_000);
  const pdf = await PDFDocument.load(bytes);
  assert.ok(pdf.getPageCount() >= 3);
  assert.equal(pdf.getTitle(), "Rental assessment RI-1001-R1");
  assert.equal(pdf.getSubject(), "Victorian rental minimum standards assessment");
  const content = decodedPageContent(pdf);
  assert.match(content, /PUBLIC DEFECT DETAIL/);
  assert.match(content, /Device-reported GPS/);
  assert.match(content, /-37\.813629, 144\.963058/);
  assert.match(content, /7 metres/);
  assert.doesNotMatch(content, /NaN/);
  assert.doesNotMatch(content, /plumber|Responsible trade|Further information required before quoting|Ready to quote/);
  assert.match(content, /Observations for quoting/);
  for (const secret of ["MODULE SECRET", "ITEM SECRET", "RESPONSE SECRET", "FINDING SECRET", "NESTED SECRET"]) {
    assert.doesNotMatch(content, new RegExp(secret));
  }
});

test("evidence-only finding shows assessor details before photos without promising a trade scope", async () => {
  const snapshot = reportSnapshot();
  snapshot.findings[0] = { ...snapshot.findings[0], scopeSummary: "", recommendedAction: "", quantityMilli: 0, details: {} };
  snapshot.modules[0].sections[0].items[0].response = { measurement: "Bedroom window is 1200 x 1500 mm", model: "Readable label: SAMPLE-42", limitationReason: "Upper frame could not be reached safely" };
  snapshot.evidence = [{ id: "photo-1", itemId: "item-1", findingId: "finding-1", fileName: "window-photo.jpg", caption: "WINDOW EVIDENCE MARKER", contentType: "image/jpeg" }];
  const pdf = await PDFDocument.load(await createRentalAssessmentPdfBytes(snapshot));
  const content = decodedPageContent(pdf);
  assert.doesNotMatch(content, /Not measured; confirm before pricing|Each scope includes access requirements|Measured work, specifications|Quantity/);
  assert.match(content, /Observations for quoting/);
  for (const value of Object.values(snapshot.modules[0].sections[0].items[0].response)) {
    const position = content.indexOf(value);
    assert.ok(position >= 0 && position < content.indexOf("WINDOW EVIDENCE MARKER"), `${value} must appear in the finding before its evidence`);
  }
});

test("finding details retain a real quantity and do not repeat identical legacy quotation measurements", async () => {
  const snapshot = reportSnapshot();
  snapshot.findings[0].quantityMilli = 24000;
  snapshot.findings[0].unitLabel = "m2";
  snapshot.findings[0].details.quotation = { measurements: "UNIQUE MEASURED AREA 24 m2" };
  snapshot.modules[0].sections[0].items[0].response = { measurement: "UNIQUE MEASURED AREA 24 m2" };
  const content = decodedPageContent(await PDFDocument.load(await createRentalAssessmentPdfBytes(snapshot)));
  assert.match(content, /24 m2/);
  assert.equal(content.split("UNIQUE MEASURED AREA 24 m2").length - 1, 2, "The value appears once in the finding and once in the detailed assessment checklist");
});

test("structured assessment measurements print their units in both finding and checklist", async () => {
  const snapshot = reportSnapshot();
  snapshot.findings[0].quantityMilli = 0;
  snapshot.findings[0].details.quotation = { measurements: "4" };
  snapshot.modules[0].sections[0].items[0].response = Object.fromEntries(Object.keys(RENTAL_OBSERVATION_NUMBER_FIELDS).map((key) => [key, "4"]));
  const content = decodedPageContent(await PDFDocument.load(await createRentalAssessmentPdfBytes(snapshot)));
  for (const key of Object.keys(RENTAL_OBSERVATION_NUMBER_FIELDS)) {
    assert.equal(content.split(rentalObservationResponseLabel(key)).length - 1, 2, `${key} retains a readable unit even when a legacy free-text value has the same number`);
  }
});

test("rental assessment PDF rejects an incomplete report snapshot", async () => {
  await assert.rejects(() => createRentalAssessmentPdfBytes({ schemaVersion: "tlink-rental-report-v1" }), /valid rental assessment report snapshot/);
});

test("photo register renders every photo with its capture record on the same page and reuses embedded images", async () => {
  const snapshot = reportSnapshot();
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=", "base64");
  const assets = {};
  snapshot.evidence = Array.from({ length: 13 }, (_, index) => {
    const id = `photo-${index}`;
    assets[id] = { bytes: png, contentType: "image/png" };
    return { id, itemId: "item-1", fileName: `${id}.png`, contentType: "image/png", caption: `VISIBLE PHOTO ${index}`,
      originalSha256: String(index).padStart(64, "0"), capture: { source: "in_app_camera", capturedAtUtc: "2026-09-10T03:00:00Z", locationCaptured: true, latitude: -37.813629, longitude: 144.963058, accuracyMetres: 7 } };
  });
  const original = structuredClone(snapshot);
  const pdf = await PDFDocument.load(await createRentalAssessmentPdfBytes(snapshot, assets));
  const galleryPages = pdf.getPages().map((page) => ({ page, content: decodedPageContent({ context: pdf.context, getPages: () => [page] }) }))
    .filter(({ content }) => content.includes("Photo register"));
  assert.ok(galleryPages.length >= 3, "A real multi-page gallery is required");
  let photos = 0;
  for (const { content } of galleryPages) {
    const references = [...content.matchAll(/\bE\d{3} Tj/g)];
    const draws = [...content.matchAll(/\/Image-[^\s]+ Do/g)];
    assert.equal(draws.length, references.length, "Each evidence record must display its photo on that page");
    assert.ok(draws.length >= 1 && draws.length <= 6);
    assert.equal((content.match(/SHA-256:/g) || []).length, references.length, "Integrity data stays with the photo card");
    assert.equal((content.match(/Reported accuracy/g) || []).length, references.length);
    photos += draws.length;
  }
  assert.equal(photos, 13, "Every photo must be visible in the gallery, including those shown earlier");
  const imageObjects = pdf.context.enumerateIndirectObjects().filter(([, object]) => object instanceof PDFRawStream && object.dict.get(PDFName.of("Subtype")) === PDFName.of("Image"));
  assert.equal(imageObjects.length, 13, "Gallery reuse must not duplicate photo bytes embedded for the assessment");
  assert.deepEqual(snapshot, original);
});

test("oversized evidence captions continue without dropping text and unavailable files are labelled accurately", async () => {
  const snapshot = reportSnapshot();
  snapshot.findings = [];
  snapshot.evidence = [{ id: "long", fileName: "not-supplied.jpg", contentType: "image/jpeg", caption: `${"Detailed observation. ".repeat(900)}CAPTION END RETAINED`, originalSha256: "a".repeat(64) },
    { id: "attachment", fileName: "support.pdf", contentType: "application/pdf", caption: "Supporting document" }];
  const pdf = await PDFDocument.load(await createRentalAssessmentPdfBytes(snapshot, { attachment: { contentType: "application/pdf", bytes: new TextEncoder().encode("supporting document bytes") } }));
  const content = decodedPageContent(pdf);
  assert.match(content, /details continued/);
  assert.match(content, /CAPTION END RETAINED/);
  assert.match(content, /Preview unavailable; file not supplied/);
  assert.match(content, /Open the file in PDF attachments/);
  assert.equal((content.match(/Detailed/g) || []).length, 900);
  assert.equal((content.match(/observation\./g) || []).length, 900);
  const firstGalleryPage = pdf.getPages().map((page) => decodedPageContent({ context: pdf.context, getPages: () => [page] })).find((page) => page.includes("Photo register"));
  assert.match(firstGalleryPage, /E001 Tj/, "A long first caption must not strand the gallery heading on an empty page");
});

test("customer report uses occupancy option labels and hides the shower implementation version without changing answers", async () => {
  const snapshot = reportSnapshot();
  snapshot.modules[0].answers.occupancyAtAssessment = "occupied_renter_present";
  snapshot.modules[0].answers.dwellingClass = "townhouse";
  snapshot.modules[0].sections[0].items[0].response = { showerCaptureVersion: 1, welsRating: "4 stars or above", flowLitresPerMinute: "4" };
  const original = structuredClone(snapshot);
  const content = decodedPageContent(await PDFDocument.load(await createRentalAssessmentPdfBytes(snapshot)));
  assert.match(content, /Occupied, renter present/);
  assert.match(content, /Townhouse/);
  assert.match(content, /4 stars or above/);
  assert.match(content, /Water flow \(L\/min\)/);
  assert.doesNotMatch(content, /occupied_renter_present|Shower Capture Version|showerCaptureVersion/);
  assert.deepEqual(snapshot, original, "Formatting must not change the immutable input snapshot");
});

test("earlier faults retain their status and evidence in history without entering the current cover counts or work list", async () => {
  const snapshot = reportSnapshot();
  const item = snapshot.modules[0].sections[0].items[0];
  item.historicalObservation = true;
  item.prompt = "Earlier observation: historical fixture fault";
  snapshot.findings[0].title = "Earlier observation: historical fixture fault";
  snapshot.findings[0].status = "non_compliant";
  snapshot.findings[0].historicalObservation = true;
  snapshot.findings[0].severity = "urgent";
  snapshot.evidence = [{ id: "old-photo", itemId: item.id, findingId: "finding-1", caption: "HISTORICAL EVIDENCE RETAINED", contentType: "image/jpeg" }];
  snapshot.modules[0].sections[0].items.push({ id: "current-item", outcome: "meets", prompt: "Current dwelling condition", response: {} });
  const original = structuredClone(snapshot);
  const pdf = await PDFDocument.load(await createRentalAssessmentPdfBytes(snapshot));
  const cover = decodedPageContent({ getPages: () => [pdf.getPage(0)], context: pdf.context });
  const coverText = [...cover.matchAll(/^(.+) Tj$/gm)].map((match) => match[1]);
  const workCountLabel = coverText.indexOf("Work items");
  const issueCountLabel = coverText.indexOf("Current issues");
  assert.ok(workCountLabel > 0 && issueCountLabel > 0);
  assert.equal(coverText[workCountLabel - 1], "0");
  assert.equal(coverText[issueCountLabel - 1], "0");
  assert.doesNotMatch(cover, /historical fixture fault/);
  assert.match(cover, /1 earlier finding is/);
  assert.match(cover, /An earlier urgent finding remains/);
  assert.doesNotMatch(cover, /No immediate or urgent safety finding/);
  const content = decodedPageContent(pdf);
  assert.match(content, /Earlier observations/);
  assert.match(content, /Recorded status/);
  assert.match(content, /Non Compliant/);
  assert.match(content, /Earlier result: Does not meet/);
  assert.match(content, /HISTORICAL EVIDENCE RETAINED/);
  assert.deepEqual(snapshot, original);
});

test("rental assessment PDF embeds Unicode fonts, paginates long scopes and attaches non-image evidence", async () => {
  const snapshot = reportSnapshot();
  snapshot.property.address = "10 Éxample Street, Montréal VIC 3000";
  snapshot.findings[0].scopeSummary = `${"Supply labour, materials and certification for the quoted repair. ".repeat(90)}Final scope line.`;
  snapshot.evidence = [{
    id: "evidence-1",
    itemId: "item-1",
    findingId: "finding-1",
    fileName: "supporting-certificate.pdf",
    contentType: "application/pdf",
    sizeBytes: 28,
    originalSha256: "a".repeat(64),
    caption: "Électrical supporting record",
    capture: {
      source: "web_file_upload",
      capturedAtUtc: "2026-08-24T02:45:00.000Z",
      locationCaptured: false,
      latitude: null,
      longitude: null,
      accuracyMetres: null,
    },
  }, {
    id: "evidence-2",
    itemId: "item-1",
    findingId: "finding-1",
    fileName: "mislabelled-photo.jpg",
    contentType: "image/jpeg",
    sizeBytes: 18,
    originalSha256: "b".repeat(64),
    caption: "Photo bytes requiring attachment fallback",
    capture: {
      source: "in_app_camera",
      capturedAtUtc: "2026-08-24T02:46:00.000Z",
      locationCaptured: true,
      latitude: -37.813629,
      longitude: 144.963058,
      accuracyMetres: 6.7,
    },
  }];
  const [regular, bold] = await Promise.all([
    readFile(new URL("../public/fonts/LiberationSans-Regular.ttf", import.meta.url)),
    readFile(new URL("../public/fonts/LiberationSans-Bold.ttf", import.meta.url)),
  ]);
  const bytes = await createRentalAssessmentPdfBytes(snapshot, {
    "evidence-1": {
      bytes: new TextEncoder().encode("supporting evidence contents"),
      contentType: "application/pdf",
    },
    "evidence-2": {
      bytes: new TextEncoder().encode("not a jpeg image"),
      contentType: "image/jpeg",
    },
  }, { regular: new Uint8Array(regular), bold: new Uint8Array(bold) });
  const pdf = await PDFDocument.load(bytes);
  assert.ok(bytes.byteLength > 50_000);
  assert.ok(pdf.getPageCount() >= 5);
  const names = pdf.catalog.lookup(PDFName.of("Names"), PDFDict);
  const embeddedFiles = names.lookup(PDFName.of("EmbeddedFiles"), PDFDict);
  const attachmentNames = embeddedFiles.lookup(PDFName.of("Names"), PDFArray).asArray()
    .filter((_entry, index) => index % 2 === 0)
    .map((entry) => entry.decodeText());
  assert.deepEqual(attachmentNames.sort(), ["001-supporting-certificate.pdf", "002-mislabelled-photo.jpg"]);
});

test("report issue records cleanup manifests before R2 writes and stale recovery deletes only after winning", async () => {
  const source = await readFile(new URL("../src/lib/trade-rental-report-server.ts", import.meta.url), "utf8");
  const stage = source.indexOf("const stageResults = await db.batch");
  const evidenceWrite = source.indexOf("await storePreparedRentalEvidence(preparedObjects");
  const pdfPlan = source.indexOf("const pdfPlan = await db.prepare");
  const pdfWrite = source.indexOf("stored = await storeImmutableIssuedPdf");
  assert.ok(stage >= 0 && evidenceWrite > stage, "the staged snapshot must exist before immutable evidence is written");
  assert.ok(pdfPlan > evidenceWrite && pdfWrite > pdfPlan, "the planned PDF reference must be durable before its object is written");
  assert.match(source, /recovered = number\(recoveryResults\[0\]\?\.meta\.changes\) === 1[\s\S]*recoveryResults\[3\][\s\S]*=== 0/);
  assert.match(source, /if \(!recovered\) continue;[\s\S]*?await cleanupFailedRentalReportObjects\(row, ownerUid\)/);
  assert.match(source, /function failedReportEvidenceKeys[\s\S]*parsedObject\(row\.report_snapshot\)\.evidence/);
  assert.match(source, /async function cleanupFailedRentalReportObjects[\s\S]*deleteImmutableIssuedPdf[\s\S]*cleanupCompletedAt/);
  assert.match(source, /async function retryFailedRentalReportCleanup[\s\S]*status = 'failed'[\s\S]*cleanupFailedRentalReportObjects/);
});

async function renderReportSnapshot(snapshot) {
  const [ts, React, jsxRuntime, { renderToStaticMarkup }, quotation, assessment] = await Promise.all([
    import("typescript").then((value) => value.default), import("react"), import("react/jsx-runtime"), import("react-dom/server"),
    import("../src/lib/rental-quotation.mjs"), import("../src/lib/trade-rental-assessment.mjs"),
  ]);
  const source = await readFile(new URL("../src/components/RentalReportViewer.tsx", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  } }).outputText;
  let stateIndex = 0;
  const dependencies = {
    react: { ...React, useState: () => [[{ ok: true, report: snapshot }, false, ""][stateIndex++], () => {}], useEffect: () => {}, useMemo: (callback) => callback() },
    "react/jsx-runtime": jsxRuntime,
    "next/link": { __esModule: true, default: ({ children, ...props }) => React.createElement("a", props, children) },
    "@/lib/rental-quotation.mjs": quotation,
    "@/lib/trade-rental-assessment.mjs": assessment,
    "@/lib/rental-report-answer.mjs": answerPresentation,
    "./RentalReportViewer.module.css": { __esModule: true, default: new Proxy({}, { get: (_target, key) => String(key) }) },
  };
  const output = { exports: {} };
  new Function("require", "module", "exports", compiled)((id) => {
    assert.ok(id in dependencies, `Unexpected dependency ${id}`);
    return dependencies[id];
  }, output, output.exports);
  return renderToStaticMarkup(React.createElement(output.exports.RentalReportViewer, { token: "test-token" }));
}

test("online report uses option labels and keeps earlier findings out of current work without losing history", async () => {
  const snapshot = reportSnapshot();
  snapshot.access = { pdfUrl: "/test.pdf", expiresAt: "2026-11-10" };
  const reportModule = snapshot.modules[0];
  reportModule.credential = {};
  reportModule.answers = { occupancyAtAssessment: "occupied_renter_present" };
  const item = reportModule.sections[0].items[0];
  item.historicalObservation = true;
  item.response = { showerCaptureVersion: 1, measuredFlowLpm: 7.5 };
  const finding = snapshot.findings[0];
  finding.itemId = item.id;
  finding.category = "bathroom";
  finding.status = "non_compliant";
  finding.severity = "urgent";
  const before = structuredClone(snapshot);
  const html = await renderReportSnapshot(snapshot);
  assert.match(html, /Current findings<\/span><strong>0<\/strong>/);
  assert.match(html, /No current work scopes recorded/);
  assert.match(html, /Earlier observations are not counted as current or marked resolved/);
  assert.match(html, /Its resolution is not confirmed in this report/);
  assert.match(html, /Recorded status<\/dt><dd>Non Compliant/);
  assert.ok(html.includes(finding.scopeSummary));
  assert.match(html, /Earlier result:/);
  assert.match(html, /Occupied, renter present/);
  assert.doesNotMatch(html, /occupied_renter_present|[Ss]hower ?[Cc]apture ?[Vv]ersion/);
  assert.match(html, /7\.5/);
  assert.deepEqual(snapshot, before, "presentation must preserve the issued snapshot");
});

test("PDF and viewer show the selected answers with polarity, ratings, limitations and frozen wording", async () => {
  const cases = [
    ["kitchen_preparation", "meets", {}, "Yes, an area is provided"],
    ["kitchen_sink_water", "meets", {}, "Yes, both work"],
    ["cooktop_function", "meets", { workingBurners: 2 }, "At least two burners work"],
    ["oven_function", "meets", {}, "Oven works"],
    ["mould_damp_observation", "meets", {}, "No mould or damp seen"],
    ["mould_damp_observation", "does_not_meet", {}, "Mould or damp seen"],
    ["mould_damp_observation", "specialist_verification_required", {}, "Needs verification"],
    ["windows_2027_readiness", "meets", {}, "Yes, all edges are sealed"],
    ["doors_2027_readiness", "does_not_meet", { sealLengthMetres: 14.5 }, "Seals are missing or damaged"],
    ["vents_2027_readiness", "not_applicable", {}, "No wall vents"],
    ["showerhead_rating", "meets", { welsRating: "4 stars or above", flowLitresPerMinute: 7.5 }, "4 stars or above"],
    ["shower_2027_readiness", "does_not_meet", { welsRating: "3 stars", flowLitresPerMinute: 8 }, "3 stars"],
    ["showerhead_rating", "specialist_verification_required", { welsRating: "4 stars or above" }, "Rating not confirmed"],
    ["showerhead_rating", "not_applicable", { showerCaptureVersion: 1 }, "No shower"],
    ["ceiling_2027_readiness", "meets", { insulationRating: "Below R5" }, "Present throughout the accessible ceiling; existing insulation: Below R5"],
    ["ceiling_2027_readiness", "does_not_meet", { insulationRating: "None", areaSquareMetres: 85 }, "None, or some bare areas; existing insulation: None"],
    ["ceiling_2027_readiness", "not_accessible", {}, "Could not check"],
    ["unknown_check", "meets", {}, "Meets"],
  ];
  const snapshot = reportSnapshot();
  snapshot.access = { pdfUrl: "/test.pdf", expiresAt: "2026-11-10" };
  snapshot.findings = [];
  snapshot.modules[0].credential = {};
  const items = cases.map(([checkKey, outcome, response], index) => ({ id: `answer-${index}`, checkKey,
    prompt: `Recorded check ${index + 1}`, outcome, response, locationLabel: "Property" }));
  items.push({ id: "frozen", checkKey: "mould_damp_observation", prompt: "Earlier area check", outcome: "meets",
    answerLabel: "No mould seen in the checked area", historicalObservation: true, response: {} });
  items.push({ id: "fixed", checkKey: "window_operation_security", prompt: "Fixed glazing check", outcome: "not_applicable",
    publicNotes: "Fixed glazing; this window is not designed to open.", response: {} });
  snapshot.modules[0].sections[0].items = items;
  const before = structuredClone(snapshot);
  const html = await renderReportSnapshot(snapshot);
  const pdf = await PDFDocument.load(await createRentalAssessmentPdfBytes(snapshot));
  const content = decodedPageContent(pdf);
  for (const [index, [, , , expected]] of cases.entries()) {
    assert.equal(answerPresentation.rentalReportAnswerPresentation(items[index], { moduleKey: "minimum_standards" }).label, expected);
    const article = [...html.matchAll(/<article class="answer">[\s\S]*?<\/article>/g)]
      .find(([value]) => value.includes(`<h4>Recorded check ${index + 1}</h4>`))?.[0] || "";
    assert.ok(article.includes(expected), `Viewer answer ${index + 1}: ${expected}`);
    assert.ok(content.includes(expected), `PDF answer ${index + 1}: ${expected}`);
  }
  for (const text of ["Earlier result: No mould seen in the checked area", "Fixed window; opening check does not apply", "Upgrade planning required", "14.5", "7.5", "85"]) {
    assert.ok(html.includes(text), text);
    assert.ok(content.includes(text), text);
  }
  assert.deepEqual(snapshot, before, "Neither presentation path rewrites the issued record");
  assert.equal(answerPresentation.rentalReportAnswerPresentation({ outcome: "meets", prompt: "Is mould present?" }).label, "Meets", "An unknown check must not guess Yes or No from its status");
  assert.equal(answerPresentation.rentalReportAnswerPresentation({ checkKey: "unknown_check", outcome: "meets" }, {
    moduleKey: "minimum_standards", check: { key: "unknown_check", prompt: "Is a problem present?" },
  }).label, "Meets", "A frozen unknown question does not supply its answer choices");
  assert.equal(answerPresentation.rentalReportAnswerPresentation({ checkKey: "mould_damp_observation", outcome: "meets" }, {
    check: { key: "mould_damp_observation", outcomeOptions: [{ value: "meets", label: "Frozen original answer" }] },
  }).label, "Frozen original answer");
  for (const key of ["kitchen_preparation", "kitchen_sink_water", "cooktop_function", "oven_function"]) {
    assert.equal(answerPresentation.rentalReportAnswerPresentation({ checkKey: key, outcome: "meets" }, {
      moduleKey: "minimum_standards", check: { key, outcomeOptions: [{ value: "meets", label: "Yes" }] },
    }).label, "Yes", "An explicit original Yes choice is preserved exactly");
    assert.notEqual(answerPresentation.rentalReportAnswerPresentation({ checkKey: key, outcome: "meets" }, {
      moduleKey: "minimum_standards", check: { key, outcomeOptions: [{ value: "meets", label: "Meets" }] },
    }).label, "Meets", "A generic status is not the selected semantic answer");
  }
  const limited = answerPresentation.rentalReportAnswerPresentation(items.find((item) => item.checkKey === "mould_damp_observation"), { moduleKey: "minimum_standards", applicabilityLimitation: "Tenancy not confirmed" });
  assert.equal(limited.label, "No mould or damp seen");
  assert.equal(limited.context, "Legal applicability unconfirmed");
});
