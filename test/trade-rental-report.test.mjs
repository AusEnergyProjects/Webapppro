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
