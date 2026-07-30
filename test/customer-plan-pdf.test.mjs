import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  PDFArray,
  PDFBool,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
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
  CUSTOMER_PLAN_PDF_CONTRAST_COLORS,
  CUSTOMER_PLAN_PDF_VERSION,
  CustomerPlanPdfUnsupportedTextError,
  createCustomerPlanPdfBytes,
  customerPlanPdfFileName,
} from "../src/lib/customer-plan-pdf.mjs";
import {
  CUSTOMER_PROFESSIONAL_REVIEW_DECLARATION_VERSION,
} from "../src/lib/customer-projects.mjs";

const A4_WIDTH_POINTS = 595.28;
const A4_HEIGHT_POINTS = 841.89;
const PDF_FONTS = {
  regular: readFileSync(new URL(
    "../public/fonts/LiberationSans-Regular.ttf",
    import.meta.url,
  )),
  bold: readFileSync(new URL(
    "../public/fonts/LiberationSans-Bold.ttf",
    import.meta.url,
  )),
};
const PDF_ROUTE_SOURCE = readFileSync(
  new URL("../src/app/api/customer-plan-pdf/route.ts", import.meta.url),
  "utf8",
);
const createPdf = (report) => createCustomerPlanPdfBytes(report, PDF_FONTS);
const professionalReviewInput = (overrides = {}) => ({
  enabled: true,
  role: "accredited-energy-adviser",
  adviserName: "Alex Example",
  accreditationScheme: "Example accreditation scheme",
  accreditationReference: "ACC-123456",
  notes: "",
  declarationAccepted: true,
  declarationVersion: CUSTOMER_PROFESSIONAL_REVIEW_DECLARATION_VERSION,
  ...overrides,
});
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

function relativeLuminance(hex) {
  const channels = hex.match(/[0-9a-f]{2}/gi).map((value) =>
    Number.parseInt(value, 16) / 255
  ).map((value) =>
    value <= 0.04045
      ? value / 12.92
      : ((value + 0.055) / 1.055) ** 2.4
  );
  return (
    (0.2126 * channels[0])
    + (0.7152 * channels[1])
    + (0.0722 * channels[2])
  );
}

function contrastRatio(foreground, background) {
  const foregroundLuminance = relativeLuminance(foreground);
  const backgroundLuminance = relativeLuminance(background);
  return (
    (Math.max(foregroundLuminance, backgroundLuminance) + 0.05)
    / (Math.min(foregroundLuminance, backgroundLuminance) + 0.05)
  );
}

function decodedPdfPageContents(pdf) {
  const pageContent = [];
  for (const page of pdf.getPages()) {
    const content = [];
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
    pageContent.push(content.join("\n"));
  }
  return pageContent;
}

function decodedPdfContent(pdf) {
  return decodedPdfPageContents(pdf).join("\n");
}

function extractedPdfPageTexts(pdf) {
  const pageTexts = pdf.getPages().map(() => []);
  const pageIndexes = new Map(
    pdf.getPages().map((page, index) => [page.ref.toString(), index]),
  );
  const structureRoot = pdf.catalog.lookup(
    PDFName.of("StructTreeRoot"),
    PDFDict,
  );

  function visit(value, inheritedPageIndex = null) {
    const resolved = pdf.context.lookup(value);
    if (resolved instanceof PDFArray) {
      for (const child of resolved.asArray()) {
        visit(child, inheritedPageIndex);
      }
      return;
    }
    if (!(resolved instanceof PDFDict)) return;

    const pageReference = resolved.get(PDFName.of("Pg"));
    const pageIndex = pageReference
      ? pageIndexes.get(pageReference.toString()) ?? inheritedPageIndex
      : inheritedPageIndex;
    const actualText = resolved.get(PDFName.of("ActualText"));
    if (
      pageIndex !== null
      && actualText
      && typeof actualText.decodeText === "function"
    ) {
      pageTexts[pageIndex].push(actualText.decodeText());
    }

    const kids = resolved.get(PDFName.of("K"));
    if (kids) visit(kids, pageIndex);
  }

  visit(structureRoot.get(PDFName.of("K")));
  return pageTexts.map((parts) => parts.join(" "));
}

function extractedPdfText(pdf) {
  return extractedPdfPageTexts(pdf).join(" ");
}

function decodedToUnicodeCMaps(pdf) {
  const streams = new Set();
  const decoded = [];
  for (const page of pdf.getPages()) {
    const resources = page.node.lookup(PDFName.of("Resources"), PDFDict);
    const fonts = resources.lookup(PDFName.of("Font"), PDFDict);
    for (const key of fonts.keys()) {
      const font = fonts.lookup(key, PDFDict);
      const toUnicode = font.lookup(PDFName.of("ToUnicode"), PDFRawStream);
      if (streams.has(toUnicode)) continue;
      streams.add(toUnicode);
      decoded.push(
        Buffer.from(decodePDFRawStream(toUnicode).getBytes()).toString("ascii"),
      );
    }
  }
  return decoded;
}

function documentStructureRoles(pdf, structureRoot) {
  const roles = [];

  function visit(value) {
    const resolved = pdf.context.lookup(value);
    if (resolved instanceof PDFArray) {
      for (const child of resolved.asArray()) visit(child);
      return;
    }
    if (!(resolved instanceof PDFDict)) return;
    const role = resolved.get(PDFName.of("S"));
    if (role instanceof PDFName) roles.push(role.decodeText());
    const kids = resolved.get(PDFName.of("K"));
    if (kids) visit(kids);
  }

  visit(structureRoot.get(PDFName.of("K")));
  return roles;
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
    professionalReview: professionalReviewInput(),
  });

  const householdPdf = await PDFDocument.load(
    await createPdf(householdReport),
  );
  const professionalPdf = await PDFDocument.load(
    await createPdf(professionalReport),
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
    await createPdf(completedReport),
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
  const bytes = await createPdf(report);

  assert.equal(
    CUSTOMER_PLAN_PDF_VERSION,
    "2026-07-31-tagged-plan-pdf-v6",
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

test("direct plan PDF small blue and muted copy meets WCAG AA contrast", () => {
  for (const foreground of [
    CUSTOMER_PLAN_PDF_CONTRAST_COLORS.oceanBlue,
    CUSTOMER_PLAN_PDF_CONTRAST_COLORS.muted,
  ]) {
    for (const background of [
      CUSTOMER_PLAN_PDF_CONTRAST_COLORS.paper,
      CUSTOMER_PLAN_PDF_CONTRAST_COLORS.canvas,
    ]) {
      const ratio = contrastRatio(foreground, background);
      assert.ok(
        ratio >= 4.5,
        `${foreground} on ${background} only reached ${ratio.toFixed(2)}:1`,
      );
    }
  }
});

test("direct plan PDF exposes a bounded tagged-document foundation", async () => {
  const pdf = await PDFDocument.load(
    await createPdf(normalizedReport()),
  );
  const language = pdf.catalog.get(PDFName.of("Lang"));
  const markInfo = pdf.catalog.lookup(PDFName.of("MarkInfo"), PDFDict);
  const structureRoot = pdf.catalog.lookup(
    PDFName.of("StructTreeRoot"),
    PDFDict,
  );
  const metadata = pdf.catalog.lookup(PDFName.of("Metadata"), PDFRawStream);
  const viewerPreferences = pdf.catalog.lookup(
    PDFName.of("ViewerPreferences"),
    PDFDict,
  );
  const parentTree = structureRoot.lookup(
    PDFName.of("ParentTree"),
    PDFDict,
  );
  const parentTreeNumbers = parentTree.lookup(PDFName.of("Nums"), PDFArray);
  const documentKids = structureRoot.lookup(PDFName.of("K"), PDFArray);
  const documentElement = pdf.context.lookup(
    documentKids.get(0),
    PDFDict,
  );
  const documentSections = documentElement.lookup(
    PDFName.of("K"),
    PDFArray,
  );
  const structureRoles = documentStructureRoles(pdf, structureRoot);

  assert.equal(language.decodeText(), "en-AU");
  assert.equal(
    viewerPreferences.lookup(
      PDFName.of("DisplayDocTitle"),
      PDFBool,
    ).asBoolean(),
    true,
  );
  assert.equal(
    markInfo.lookup(PDFName.of("Marked"), PDFBool).asBoolean(),
    true,
  );
  assert.equal(
    documentElement.lookup(PDFName.of("S"), PDFName).decodeText(),
    "Document",
  );
  assert.ok(documentSections.size() >= 5);
  assert.ok(parentTreeNumbers.size() >= pdf.getPageCount() * 2);
  assert.equal(
    metadata.dict.lookup(PDFName.of("Subtype"), PDFName).decodeText(),
    "XML",
  );
  assert.match(
    new TextDecoder().decode(metadata.contents),
    /<dc:language>[\s\S]*<rdf:li>en-AU<\/rdf:li>/,
  );
  assert.doesNotMatch(
    new TextDecoder().decode(metadata.contents),
    /pdfuaid:/i,
    "the technical foundation must not claim unverified PDF/UA conformance",
  );

  const pageParentKeys = [];
  let embeddedFontCount = 0;
  for (const page of pdf.getPages()) {
    pageParentKeys.push(
      page.node.lookup(PDFName.of("StructParents"), PDFNumber).asNumber(),
    );
    assert.equal(
      page.node.lookup(PDFName.of("Tabs"), PDFName).decodeText(),
      "S",
    );
    const resources = page.node.lookup(PDFName.of("Resources"), PDFDict);
    const fonts = resources.lookup(PDFName.of("Font"), PDFDict);
    for (const key of fonts.keys()) {
      const font = fonts.lookup(key, PDFDict);
      assert.equal(
        font.lookup(PDFName.of("Subtype"), PDFName).decodeText(),
        "Type0",
      );
      font.lookup(PDFName.of("ToUnicode"), PDFRawStream);
      const descendants = font.lookup(
        PDFName.of("DescendantFonts"),
        PDFArray,
      );
      const descendant = pdf.context.lookup(descendants.get(0), PDFDict);
      const descriptor = descendant.lookup(
        PDFName.of("FontDescriptor"),
        PDFDict,
      );
      descriptor.lookup(PDFName.of("FontFile2"), PDFRawStream);
      embeddedFontCount += 1;
    }
  }
  assert.ok(embeddedFontCount >= 2);
  const indexedParentKeys = [];
  for (let index = 0; index < parentTreeNumbers.size(); index += 2) {
    indexedParentKeys.push(
      parentTreeNumbers.lookup(index, PDFNumber).asNumber(),
    );
  }
  for (const parentKey of pageParentKeys) {
    assert.ok(indexedParentKeys.includes(parentKey));
  }

  const content = decodedPdfContent(pdf);
  assert.match(content, /\/Artifact\s+BMC/);
  assert.match(content, /\/H1\s+<<\s*\/MCID\s+\d+\s*>>\s+BDC/);
  assert.match(content, /\/H2\s+<<\s*\/MCID\s+\d+\s*>>\s+BDC/);
  assert.match(content, /\/P\s+<<\s*\/MCID\s+\d+\s*>>\s+BDC/);
  assert.match(content, /\/Span\s+<<\s*\/MCID\s+\d+\s*>>\s+BDC/);
  assert.match(content, /\bEMC\b/);
  assert.ok(structureRoles.includes("P"));
  assert.ok(structureRoles.includes("Span"));
  for (const role of ["L", "LI", "Lbl", "LBody"]) {
    assert.ok(
      structureRoles.includes(role),
      `the tagged report must expose the ${role} list role`,
    );
  }
  assert.match(
    content,
    /\/Lbl\s+<<\s*\/MCID\s+\d+\s*>>\s+BDC/,
  );
  assert.match(
    content,
    /\/LBody\s+<<\s*\/MCID\s+\d+\s*>>\s+BDC/,
  );
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
  const bytes = await createPdf(report);
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
      assert.match(
        annotation.get(PDFName.of("Contents")).decodeText(),
        /guidance/i,
      );
      assert.ok(
        annotation.lookup(PDFName.of("StructParent"), PDFNumber).asNumber()
          >= 0,
      );
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
  const adviserName = "José Māori";
  const professionalNote =
    "José Māori recorded 22 °C – smart “quotes” and a €120 allowance.";
  const unicodeReport = normalizedReport({
    professionalReview: professionalReviewInput({
      adviserName,
      notes: professionalNote,
    }),
  });

  const bytes = await createPdf(unicodeReport);
  const pdf = await PDFDocument.load(bytes);
  const taggedText = extractedPdfText(pdf);
  const toUnicode = decodedToUnicodeCMaps(pdf).join("\n").toUpperCase();

  assertEveryPageIsA4(pdf);
  assert.ok(bytes.length > 0);
  assert.match(taggedText, new RegExp(adviserName, "u"));
  assert.match(taggedText, /22 °C – smart “quotes” and a €120 allowance\./u);
  for (const unicodeDestination of [
    "00E9",
    "0101",
    "00B0",
    "2013",
    "201C",
    "201D",
    "20AC",
  ]) {
    assert.match(
      toUnicode,
      new RegExp(`<${unicodeDestination}>`),
      `the embedded ToUnicode map must expose U+${unicodeDestination}`,
    );
  }
});

test("direct plan PDF rejects unsupported scripts instead of corrupting visible text", async () => {
  const unsupportedExamples = [
    ["CJK", "张"],
    ["Arabic", "م"],
    ["Devanagari", "प"],
    ["Vietnamese", "ệ"],
  ];

  for (const [script, character] of unsupportedExamples) {
    const report = normalizedReport({
      professionalReview: professionalReviewInput({
        adviserName: `Alex ${character}`,
        notes: `Professional note containing ${character}.`,
      }),
    });
    await assert.rejects(
      createPdf(report),
      (error) => {
        assert.ok(
          error instanceof CustomerPlanPdfUnsupportedTextError,
          `${script} text should raise the explicit font-coverage error`,
        );
        assert.equal(error.code, "CUSTOMER_PLAN_PDF_UNSUPPORTED_TEXT");
        assert.ok(
          error.unsupportedCharacters.includes(character),
          `${script} unsupported character should be identified`,
        );
        assert.doesNotMatch(
          error.message,
          new RegExp(character, "u"),
          "the error message must not echo customer or adviser text",
        );
        return true;
      },
    );
  }
});

test("PDF route returns a clear unsupported-text response", () => {
  assert.match(
    PDF_ROUTE_SOURCE,
    /error instanceof CustomerPlanPdfUnsupportedTextError/,
  );
  assert.match(
    PDF_ROUTE_SOURCE,
    /cannot display some characters in this plan yet/,
  );
  assert.match(
    PDF_ROUTE_SOURCE,
    /before downloading\.",\s*422/,
  );
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
  const maximumReport = normalizedReport({
    planTitle: "Maximum bounded home energy roadmap",
    actions,
    professionalReview: professionalReviewInput({
      notes:
        "The adviser checked the supplied home details and recorded a bounded professional note.",
    }),
  });
  assert.equal(maximumReport.actions.length, 40);
  assert.equal(maximumReport.everydayActions.length, 6);
  assert.ok(maximumReport.professionalReview);

  const minimalBytes = await createPdf(
    normalizedReport({ everydayActions: [], actions: actions.slice(0, 1) }),
  );
  const maximumBytes = await createPdf(maximumReport);
  const pdf = await PDFDocument.load(maximumBytes);
  const pageTexts = extractedPdfPageTexts(pdf);
  const roadmapHeadingPage = pageTexts.find((text) =>
    text.includes("Build the rest of your roadmap")
  );
  const decisionHeadingPage = pageTexts.find((text) =>
    text.includes("How your priorities were chosen")
  );

  assertEveryPageIsA4(pdf);
  assert.match(
    roadmapHeadingPage || "",
    /Maximum roadmap action 01/,
    "the roadmap heading must stay with its first action card",
  );
  assert.match(
    decisionHeadingPage || "",
    /The sequence reflects the goals, home context, budget and pace/,
    "the rationale heading must stay with its first information panel",
  );
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
