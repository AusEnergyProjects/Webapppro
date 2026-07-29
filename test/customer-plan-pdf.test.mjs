import assert from "node:assert/strict";
import test from "node:test";
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFRawStream,
  decodePDFRawStream,
} from "pdf-lib";
import {
  createCustomerPlanReportView,
} from "../src/lib/customer-plan-document.mjs";
import {
  AEA_BRANDMARK_PNG_DATA_URI,
} from "../src/lib/aea-brand-assets.mjs";
import {
  CUSTOMER_PLAN_PDF_VERSION,
  createCustomerPlanPdfBytes,
  customerPlanPdfFileName,
} from "../src/lib/customer-plan-pdf.mjs";

const A4_WIDTH_POINTS = 595.28;
const A4_HEIGHT_POINTS = 841.89;
const EVERYDAY_ACTION_IDS = [
  "moisture-safe-routine",
  "personal-warmth-first",
  "use-existing-controls",
  "safe-seasonal-airflow",
  "seasonal-window-and-landscape",
  "renter-friendly-diy-boundary",
];
function reportDocument(overrides = {}) {
  return {
    heading: "Your independent home energy plan",
    planTitle: "A clear staged roadmap",
    summary:
      "Start with safe evidence and low-cost comfort measures before committing to fixed work.",
    preparedDate: "2026-07-29",
    overview: {
      goals: ["Lower energy bills", "Improve comfort"],
      propertyType: "Detached house",
      tenure: "I own the home",
      approval: "No shared-property approval known",
      pace: "Stage improvements over time",
      budget: "$2,000 to $10,000",
      state: "VIC",
    },
    climate: {
      label: "Cool temperate planning profile",
      summary:
        "Prioritise safe draught control, insulation, window heat loss and efficient heating.",
    },
    existingFeatures: [],
    everydayActions: EVERYDAY_ACTION_IDS.map((id, index) => ({
      id,
      category: `Everyday category ${index + 1}`,
      title: `Everyday action ${index + 1}`,
      description: `Practical household guidance ${index + 1}.`,
    })),
    everydayActionsBoundary:
      "These are optional household actions, not substitute trade work.",
    actions: [
      {
        number: 1,
        id: "first-safe-step",
        stage: "Start with evidence",
        title: "Confirm the home's main comfort constraint",
        description:
          "Record when and where the home feels too hot, too cold, draughty or damp.",
        completed: false,
        guideLabel: "Review the home comfort guide",
        guideHref: "/guides/building-fabric",
      },
    ],
    privacyNote:
      "Private account details and customer-written notes are not included in this shared copy.",
    adviceBoundary:
      "This is independent general guidance, not a quote, rating or savings promise.",
    ...overrides,
  };
}

function normalizedReport(overrides = {}) {
  return createCustomerPlanReportView(reportDocument(overrides));
}

function assertEveryPageIsA4(pdf) {
  assert.ok(pdf.getPageCount() > 0);
  for (const [index, page] of pdf.getPages().entries()) {
    const { width, height } = page.getSize();
    assert.ok(
      Math.abs(width - A4_WIDTH_POINTS) < 0.02,
      `page ${index + 1} width was ${width}`,
    );
    assert.ok(
      Math.abs(height - A4_HEIGHT_POINTS) < 0.02,
      `page ${index + 1} height was ${height}`,
    );
  }
}

function decodedPdfContent(pdf) {
  const content = [];
  for (const page of pdf.getPages()) {
    const contents = page.node.lookup(PDFName.of("Contents"));
    const references = contents instanceof PDFArray
      ? Array.from({ length: contents.size() }, (_, index) => contents.get(index))
      : [contents];
    for (const reference of references) {
      const stream = pdf.context.lookup(reference);
      if (!(stream instanceof PDFRawStream)) continue;
      const decoded = Buffer.from(
        decodePDFRawStream(stream).getBytes(),
      ).toString("latin1");
      content.push(decoded);
    }
  }
  return content.join("\n");
}

function extractedPdfText(pdf) {
  const text = [];
  for (const match of decodedPdfContent(pdf).matchAll(
    /<([0-9a-f]+)>\s*Tj/gi,
  )) {
    text.push(Buffer.from(match[1], "hex").toString("latin1"));
  }
  return text.join(" ");
}

test("the shared report brandmark is the exact 96px AEA PNG", () => {
  assert.match(AEA_BRANDMARK_PNG_DATA_URI, /^data:image\/png;base64,/);
  const png = Buffer.from(
    AEA_BRANDMARK_PNG_DATA_URI.replace(/^data:image\/png;base64,/, ""),
    "base64",
  );

  assert.deepEqual(
    [...png.subarray(0, 8)],
    [137, 80, 78, 71, 13, 10, 26, 10],
  );
  assert.equal(png.readUInt32BE(16), 96);
  assert.equal(png.readUInt32BE(20), 96);
});

test("direct plan PDF preserves the exact household and self-declared review boundaries", async () => {
  const householdBoundary =
    "These details were supplied by the household and have not been professionally checked.";
  const professionalBoundary =
    "These home answers are marked as reviewed by the self-declared accredited adviser named below. Australian Energy Assessments has not independently checked that review.";
  const householdReport = normalizedReport({
    readiness: {
      answered: 14,
      total: 14,
      notSure: 0,
      linked: 0,
      missing: 0,
      missingLabels: [],
      message: "All questions addressed.",
      boundary: householdBoundary,
    },
  });
  const professionalReport = normalizedReport({
    readiness: {
      answered: 14,
      total: 14,
      notSure: 0,
      linked: 0,
      missing: 0,
      missingLabels: [],
      message: "All questions addressed.",
      boundary: professionalBoundary,
    },
    professionalReview: {
      adviserName: "Alex Example",
      roleLabel: "Accredited energy adviser",
      accreditationScheme: "Example scheme",
      accreditationReference: "ACC-123456",
      notes: "",
      boundary:
        "This professional status is self-declared. Australian Energy Assessments has not checked the adviser's identity, credentials or observations.",
    },
  });

  const householdPdf = await PDFDocument.load(
    await createCustomerPlanPdfBytes(householdReport),
  );
  const professionalPdf = await PDFDocument.load(
    await createCustomerPlanPdfBytes(professionalReport),
  );
  const householdText = extractedPdfText(householdPdf);
  const professionalText = extractedPdfText(professionalPdf);

  assert.equal(
    householdText.split(householdBoundary).length - 1,
    1,
  );
  assert.equal(
    professionalText.split(professionalBoundary).length - 1,
    1,
  );
});

test("completed-plan PDF reports progress without inventing a next step", async () => {
  const completedReport = normalizedReport({
    actions: reportDocument().actions.map((action) => ({
      ...action,
      completed: true,
    })),
  });
  const pdf = await PDFDocument.load(
    await createCustomerPlanPdfBytes(completedReport),
  );
  const text = extractedPdfText(pdf);

  assert.match(text, /STEPS COMPLETE/);
  assert.match(text, /LEFT TO PLAN/);
  assert.match(text, /Every current step is marked complete/);
  assert.doesNotMatch(text, /PLAN NEXT/);
  assert.doesNotMatch(text, /YOUR NEXT MOVE/);
});

test("direct plan PDF bytes load as an A4 document with useful metadata", async () => {
  const report = normalizedReport();
  const bytes = await createCustomerPlanPdfBytes(report);

  assert.equal(
    CUSTOMER_PLAN_PDF_VERSION,
    "2026-07-30-tech-presentation-pdf-v2",
  );
  assert.equal(
    Buffer.from(bytes.subarray(0, 5)).toString("ascii"),
    "%PDF-",
  );
  const pdf = await PDFDocument.load(bytes);
  assertEveryPageIsA4(pdf);
  assert.equal(pdf.getTitle(), report.heading);
  assert.equal(pdf.getAuthor(), "Australian Energy Assessments");
  assert.equal(
    pdf.getSubject(),
    "Independent home energy planning roadmap",
  );
  assert.equal(pdf.getCreator(), "Australian Energy Assessments");
  assert.match(pdf.getKeywords() || "", /home energy plan/i);
  assert.match(pdf.getKeywords() || "", new RegExp(CUSTOMER_PLAN_PDF_VERSION));
  const content = decodedPdfContent(pdf);
  assert.match(content, /\bW\s+n\b/, "rounded panels should use clipping paths");
  assert.match(content, /\bc\b/, "rounded panels should use curved corners");
});

test("direct plan PDF keeps friendly guide labels clickable", async () => {
  const report = normalizedReport({
    actions: [{
      number: 1,
      id: "heating-guide-step",
      stage: "Use what is already installed",
      title: "Check the existing heating system",
      description:
        "Record controls, filters, condition and recent servicing before changing equipment.",
      completed: false,
      guideLabel: "Review heating and cooling guidance",
      guideHref: "/guides/heating",
    }],
  });
  const bytes = await createCustomerPlanPdfBytes(report);
  const pdf = await PDFDocument.load(bytes);
  const urls = [];

  for (const page of pdf.getPages()) {
    const annotations = page.node.lookupMaybe(
      PDFName.of("Annots"),
      PDFArray,
    );
    if (!annotations) continue;
    for (const reference of annotations.asArray()) {
      const annotation = pdf.context.lookup(reference, PDFDict);
      const action = annotation.lookup(PDFName.of("A"), PDFDict);
      urls.push(action.get(PDFName.of("URI")).decodeText());
    }
  }

  assert.deepEqual(urls, [
    "https://compare.ausenergyassessments.com/guides/heating",
  ]);
});

test("direct plan PDF filename is fixed, dated and independent of private fields", () => {
  const privateCanaries = [
    "PRIVATE_PROJECT_7429",
    "3006",
    "SECRET_ROOM_LABEL",
    "customer@example.com",
  ];
  const report = normalizedReport({
    planTitle: privateCanaries[0],
    postcode: privateCanaries[1],
    privateNotes: privateCanaries[2],
    privateEmail: privateCanaries[3],
  });
  const fileName = customerPlanPdfFileName(report);

  assert.equal(fileName, "home-energy-plan-2026-07-29.pdf");
  assert.match(fileName, /^[a-z0-9-]+\.pdf$/);
  for (const canary of privateCanaries) {
    assert.doesNotMatch(fileName, new RegExp(canary, "i"));
  }
});

test("direct plan PDF accepts common adviser names, temperatures and smart punctuation", async () => {
  const unicodeReport = {
    ...normalizedReport(),
    professionalReview: {
      role: "accredited-energy-adviser",
      roleLabel: "Accredited energy adviser",
      adviserName: "José Māori",
      accreditationScheme: "Example accreditation scheme",
      accreditationReference: "ACC-123456",
      notes: "José Māori recorded 22 °C – smart “quotes”.",
      statement:
        "These home details were reviewed by José Māori, who declares they are an accredited energy adviser.",
      readinessBoundary:
        "The named adviser declares these details were professionally checked.",
      boundary:
        "Australian Energy Assessments has not independently verified the adviser identity, accreditation, reference or home observations.",
    },
  };

  const bytes = await createCustomerPlanPdfBytes(unicodeReport);
  const pdf = await PDFDocument.load(bytes);

  assertEveryPageIsA4(pdf);
  assert.ok(bytes.length > 0);
});

test("maximum bounded roadmap produces a complete multi-page A4 PDF", async () => {
  const actions = Array.from({ length: 40 }, (_, index) => ({
    number: index + 1,
    id: `maximum-action-${String(index + 1).padStart(2, "0")}`,
    stage: `Stage ${Math.floor(index / 5) + 1}`,
    title: `Maximum roadmap action ${String(index + 1).padStart(2, "0")}`,
    description:
      `This is bounded action ${index + 1}. Confirm the relevant evidence, permissions, safety constraints and written scope before committing to work.`,
    completed: index % 11 === 0,
    guideLabel: `Open guide ${index + 1}`,
    guideHref: `/guides/maximum-${index + 1}`,
  }));
  const maximumReport = {
    ...normalizedReport({
      planTitle: "Maximum bounded home energy roadmap",
      actions,
    }),
    professionalReview: {
      role: "accredited-energy-adviser",
      roleLabel: "Accredited energy adviser",
      adviserName: "Alex Example",
      accreditationScheme: "Example accreditation scheme",
      accreditationReference: "ACC-123456",
      notes:
        "The adviser checked the supplied home details and recorded a bounded professional note.",
      statement:
        "These home details were reviewed by Alex Example, who declares they are an accredited energy adviser.",
      readinessBoundary:
        "The named adviser declares these details were professionally checked.",
      boundary:
        "Australian Energy Assessments has not independently verified the adviser identity, accreditation, reference or home observations.",
    },
  };
  assert.equal(maximumReport.actions.length, 40);
  assert.equal(maximumReport.everydayActions.length, 6);
  assert.ok(maximumReport.professionalReview);

  const minimalBytes = await createCustomerPlanPdfBytes(
    normalizedReport({ everydayActions: [], actions: actions.slice(0, 1) }),
  );
  const maximumBytes = await createCustomerPlanPdfBytes(maximumReport);
  const pdf = await PDFDocument.load(maximumBytes);

  assertEveryPageIsA4(pdf);
  assert.ok(
    pdf.getPageCount() >= 8,
    `maximum report rendered only ${pdf.getPageCount()} pages`,
  );
  assert.ok(
    pdf.getPageCount() <= 60,
    `maximum report unexpectedly rendered ${pdf.getPageCount()} pages`,
  );
  assert.ok(
    maximumBytes.length > minimalBytes.length + 8_000,
    `maximum PDF was ${maximumBytes.length} bytes and minimal PDF was ${minimalBytes.length} bytes`,
  );
  assert.ok(
    maximumBytes.length < 2_000_000,
    `maximum PDF unexpectedly reached ${maximumBytes.length} bytes`,
  );
});
