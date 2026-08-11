import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
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
  createPublicPlanCustomerReportView,
} from "../src/lib/customer-plan-document.mjs";
import {
  CUSTOMER_PLAN_PDF_CONTRAST_COLORS,
  CustomerPlanPdfUnsupportedTextError,
  createCustomerPlanPdfBytes,
} from "../src/lib/customer-plan-pdf.mjs";

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

function extractedTaggedText(pdf) {
  const parts = [];
  const structureRoot = pdf.catalog.lookup(
    PDFName.of("StructTreeRoot"),
    PDFDict,
  );

  function visit(value) {
    const resolved = pdf.context.lookup(value);
    if (resolved instanceof PDFArray) {
      for (const child of resolved.asArray()) visit(child);
      return;
    }
    if (!(resolved instanceof PDFDict)) return;
    const actualText = resolved.get(PDFName.of("ActualText"));
    if (actualText && typeof actualText.decodeText === "function") {
      parts.push(actualText.decodeText());
    }
    const kids = resolved.get(PDFName.of("K"));
    if (kids) visit(kids);
  }

  visit(structureRoot.get(PDFName.of("K")));
  return parts.join(" ");
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

const outputPath = path.resolve(
  process.argv[2]
    || "synthetic-test-output/customer-plan-accessibility-audit.pdf",
);
const pdfFonts = {
  regular: await readFile(path.resolve(
    "public/fonts/LiberationSans-Regular.ttf",
  )),
  bold: await readFile(path.resolve(
    "public/fonts/LiberationSans-Bold.ttf",
  )),
};

const actions = Array.from({ length: 18 }, (_, index) => ({
  number: index + 1,
  id: `synthetic-step-${index + 1}`,
  stage: index < 3 ? "Confirm the basics" : "Plan ahead",
  title: `Clear home energy step ${index + 1}`,
  description:
    "Confirm what is installed, what the household needs and what a licensed trade must check before work begins.",
  completed: index % 5 === 0,
  guideLabel: "Read the independent planning guide",
  guideHref: "/guides/project-preparation#evidence-first",
}));

// Exercise maximum repeated-card structure separately from the representative
// public customer artifact rendered below.
createCustomerPlanReportView({
  heading: "Jamie Customer's home energy plan",
  preparedFor: "Jamie Customer",
  customerSummary: "Townhouse or terrace | postcode 3000 | VIC",
  planTitle: "A clear, staged roadmap for this home at 22 °C",
  summary:
    "Start with the safest useful checks, then spend only where the evidence supports it.",
  preparedDate: "2026-07-31",
  overview: {
    goals: [
      "Lower energy bills",
      "Improve winter and summer comfort",
      "Reduce household emissions",
    ],
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
      "Prioritise moisture-safe draught control, insulation, window heat loss and efficient heating.",
  },
  existingFeatures: [],
  actions,
  readiness: {
    answered: 12,
    total: 14,
    notSure: 2,
    linked: 3,
    missing: 0,
    missingLabels: [],
    message: "Two details are marked Not sure.",
    boundary:
      "These details were supplied by the household and have not been professionally checked.",
  },
  privacyNote:
    "Private account details and customer-written notes are not included in this shared copy.",
  adviceBoundary:
    "This is independent general guidance, not a quote, rating or savings promise.",
  resources: [
    { label: "Review the Australian Energy Assessments home energy plan", description: "Update the plan when the home or priorities change.", href: "/plan" },
    { label: "Find current rebates", description: "Check government support and official eligibility rules.", href: "/rebates" },
    { label: "Estimate rebate value", description: "Prepare an indicative scheme estimate.", href: "/calculator" },
    { label: "Compare electricity plans", description: "Compare current electricity options.", href: "/compare" },
    { label: "Compare gas plans", description: "Compare current gas options where relevant.", href: "/gas-compare" },
    { label: "Prepare for an assessment", description: "Understand the independent assessment path.", href: "/assessments" },
    { label: "Australian Government household hub", description: "National household energy guidance.", href: "https://www.energy.gov.au/households" },
    { label: "Australian Government quick wins", description: "Low-cost and no-cost actions.", href: "https://www.energy.gov.au/households/quick-wins" },
    { label: "Official rebate finder", description: "Search current government rebates.", href: "https://www.energy.gov.au/rebates" },
    { label: "Reduce household energy bills", description: "Official Australian Government household guidance.", href: "https://www.energy.gov.au/households/household-guides/reduce-energy-bills" },
    { label: "Insulation and draught proofing", description: "Official comfort and ventilation guidance.", href: "https://www.energy.gov.au/households/insulation-and-draught-proofing" },
    { label: "Existing Homes Guidance Note, July 2026", description: "Current NatHERS guidance for formal existing-home assessments.", href: "https://www.homeenergyrating.gov.au/resources/existing-homes-guidance-note" },
    { label: "Existing Homes Technical Note, July 2026", description: "Current NatHERS technical requirements for formal assessments.", href: "https://www.homeenergyrating.gov.au/resources/existing-homes-technical-note" },
  ],
});

const representativeReport = createPublicPlanCustomerReportView({
  name: "Jamie Customer",
  postcode: "3000",
  projectCategories: [
    "heating-cooling",
    "hot-water",
    "draught-proofing",
    "glazing",
  ],
  preparedAt: "2026-08-11T04:05:06.000Z",
  snapshot: {
    goals: ["lower-bills", "improve-comfort"],
    pace: "staged",
    situation: "owner",
    approvalContext: "strata",
    budgetRange: "2_10k",
    addressState: "VIC",
    features: [
      "reverse-cycle",
      "gas-heating",
      "gas-storage-hot-water",
      "gas-cooking",
      "single-glazing",
      "draughty",
      "ceiling-insulation-unknown",
      "open-unused-chimney",
    ],
    propertyContext: {
      propertyType: "townhouse",
      storeys: "two",
      floorArea: "100_199",
      occupants: "three_four",
      sharedWalls: "one_side",
      ageBand: "1960_1999",
      roofType: "tile",
      roofColour: "dark",
      roofForm: "pitched",
      roofCondition: "weathered",
      switchboard: "older_fuses",
      wallConstruction: "brick_veneer",
      floorConstruction: "suspended_timber",
    },
  },
});
assert.match(representativeReport.customerSummary, /Townhouse/);
assert.match(
  representativeReport.planningSnapshot.find((item) => item.label === "Size and occupancy")?.value || "",
  /Two storeys.*100 to 199 m2.*Three or four people/,
);
assert.match(
  representativeReport.planningSnapshot.find((item) => item.label === "Age and shared walls")?.value || "",
  /1960.*1999.*One side shared/,
);
assert.match(
  representativeReport.planningSnapshot.find((item) => item.label === "Roof")?.value || "",
  /tiles.*Pitched.*Dark.*weathered/i,
);
assert.ok(representativeReport.actions.length >= 8);
assert.ok(representativeReport.actions.every((item) => !/^Clear home energy step/.test(item.title)));
assert.equal(representativeReport.questions.length, 0);
assert.ok(representativeReport.actions.every((item) => (
  item.whatToDo
  && item.whyItMatters
  && item.householdReason
  && item.confirmBeforeWork.length
  && item.quoteChecklist.length
  && item.sequence
  && item.safety
)));
assert.equal(representativeReport.electrificationMoves.length, 3);
assert.ok(representativeReport.actions.some((item) => item.solutionOptions.length === 3));
assert.match(representativeReport.privacyNote, /emailed only to the customer/i);
assert.doesNotMatch(representativeReport.privacyNote, /shared copy/i);

const bytes = await createCustomerPlanPdfBytes(representativeReport, pdfFonts);
await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, bytes);

const unsupportedScriptGate = [
  ["CJK", "张"],
  ["Arabic", "م"],
  ["Devanagari", "प"],
  ["Vietnamese", "ệ"],
];
for (const [script, character] of unsupportedScriptGate) {
  await assert.rejects(
    createCustomerPlanPdfBytes(
      { ...representativeReport, planTitle: `Unsupported ${script} check ${character}` },
      pdfFonts,
    ),
    (error) =>
      error instanceof CustomerPlanPdfUnsupportedTextError
      && error.code === "CUSTOMER_PLAN_PDF_UNSUPPORTED_TEXT"
      && error.unsupportedCharacters.includes(character),
    `${script} text must fail before a visually corrupted PDF is saved`,
  );
}

const pdf = await PDFDocument.load(bytes);
const language = pdf.catalog.get(PDFName.of("Lang"));
const markInfo = pdf.catalog.lookup(PDFName.of("MarkInfo"), PDFDict);
const viewerPreferences = pdf.catalog.lookup(
  PDFName.of("ViewerPreferences"),
  PDFDict,
);
const structureRoot = pdf.catalog.lookup(
  PDFName.of("StructTreeRoot"),
  PDFDict,
);
const parentTree = structureRoot.lookup(PDFName.of("ParentTree"), PDFDict);
const parentTreeNumbers = parentTree.lookup(PDFName.of("Nums"), PDFArray);
const structureKids = structureRoot.lookup(PDFName.of("K"), PDFArray);
const documentElement = pdf.context.lookup(
  structureKids.get(0),
  PDFDict,
);
const metadata = pdf.catalog.lookup(PDFName.of("Metadata"), PDFRawStream);
const xmp = new TextDecoder().decode(metadata.contents);
const structureRoles = documentStructureRoles(pdf, structureRoot);
const taggedText = extractedTaggedText(pdf);

assert.equal(language?.decodeText(), "en-AU");
assert.equal(
  markInfo.lookup(PDFName.of("Marked"), PDFBool).asBoolean(),
  true,
);
assert.equal(
  viewerPreferences.lookup(
    PDFName.of("DisplayDocTitle"),
    PDFBool,
  ).asBoolean(),
  true,
);
assert.equal(
  documentElement.lookup(PDFName.of("S"), PDFName).decodeText(),
  "Document",
);
assert.ok(parentTreeNumbers.size() >= pdf.getPageCount() * 2);
assert.ok(pdf.getPageCount() <= 28, `representative report has ${pdf.getPageCount()} pages`);
assert.equal(
  metadata.dict.lookup(PDFName.of("Subtype"), PDFName).decodeText(),
  "XML",
);
assert.match(xmp, /<dc:language>[\s\S]*<rdf:li>en-AU<\/rdf:li>/);
assert.match(xmp, /<dc:title>/);
assert.doesNotMatch(xmp, /pdfuaid:/i);
for (const role of ["L", "LI", "Lbl", "LBody"]) {
  assert.ok(
    structureRoles.includes(role),
    `the tagged report must expose the ${role} list role`,
  );
}
assert.equal(pdf.catalog.has(PDFName.of("OpenAction")), false);
assert.equal(pdf.catalog.has(PDFName.of("AA")), false);
assert.equal(pdf.catalog.has(PDFName.of("AcroForm")), false);
assert.match(taggedText, /Australian Energy Assessments/);
assert.match(taggedText, /WHAT THIS MEANS/);
assert.match(taggedText, /WHY IT HELPS/);
assert.match(taggedText, /WHY IT IS IN YOUR PLAN/);
assert.match(taggedText, /CHECK FIRST/);
assert.match(taggedText, /WHAT TO ASK FOR/);
assert.match(taggedText, /WHEN TO DO IT/);
assert.match(taggedText, /SAFETY/);
assert.match(taggedText, /YOUR ELECTRIFICATION PATH/);
assert.match(taggedText, /Try now:/);
assert.match(taggedText, /Better fix:/);
assert.match(taggedText, /Long-term upgrade:/);
assert.match(taggedText, /bubble wrap or (?:purpose-made )?shrink film/i);
assert.match(taggedText, /little or no direct sun/i);
assert.match(taggedText, /low-e or solar-control film/i);
assert.match(taggedText, /clear acrylic secondary panel/i);
assert.match(taggedText, /full double glazing/i);
assert.doesNotMatch(taggedText, /\bAEA\b/);
assert.doesNotMatch(taggedText, /Questions that could|Home details to check/i);
for (const foreground of [
  CUSTOMER_PLAN_PDF_CONTRAST_COLORS.oceanBlue,
  CUSTOMER_PLAN_PDF_CONTRAST_COLORS.muted,
]) {
  for (const background of [
    CUSTOMER_PLAN_PDF_CONTRAST_COLORS.paper,
    CUSTOMER_PLAN_PDF_CONTRAST_COLORS.canvas,
  ]) {
    assert.ok(contrastRatio(foreground, background) >= 4.5);
  }
}

let linkCount = 0;
const linkTargets = new Set();
let checkedFontResources = 0;
const embeddedFontPrograms = new Set();
const toUnicodeCMaps = new Set();
for (const page of pdf.getPages()) {
  page.node.lookup(PDFName.of("StructParents"), PDFNumber);
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
    const toUnicode = font.lookup(PDFName.of("ToUnicode"), PDFRawStream);
    toUnicodeCMaps.add(
      Buffer.from(decodePDFRawStream(toUnicode).getBytes()).toString("ascii"),
    );
    const descendants = font.lookup(PDFName.of("DescendantFonts"), PDFArray);
    const descendant = pdf.context.lookup(descendants.get(0), PDFDict);
    const descriptor = descendant.lookup(
      PDFName.of("FontDescriptor"),
      PDFDict,
    );
    const fontFileReference = descriptor.get(PDFName.of("FontFile2"));
    descriptor.lookup(PDFName.of("FontFile2"), PDFRawStream);
    embeddedFontPrograms.add(fontFileReference.toString());
    checkedFontResources += 1;
  }
  const annotations = page.node.lookupMaybe(
    PDFName.of("Annots"),
    PDFArray,
  );
  if (!annotations) continue;
  for (const annotationRef of annotations.asArray()) {
    const annotation = pdf.context.lookup(annotationRef, PDFDict);
    assert.equal(
      annotation.lookup(PDFName.of("Subtype"), PDFName).decodeText(),
      "Link",
    );
    annotation.lookup(PDFName.of("StructParent"), PDFNumber);
    const action = annotation.lookup(PDFName.of("A"), PDFDict);
    assert.equal(
      action.lookup(PDFName.of("S"), PDFName).decodeText(),
      "URI",
    );
    assert.ok(annotation.has(PDFName.of("Contents")));
    linkTargets.add(action.get(PDFName.of("URI")).decodeText());
    linkCount += 1;
  }
}
assert.ok(linkCount > 0);
for (const href of [
  "https://compare.ausenergyassessments.com/calculator",
  "https://compare.ausenergyassessments.com/rebates",
  "https://compare.ausenergyassessments.com/compare",
  "https://compare.ausenergyassessments.com/gas-compare",
  "https://www.homeenergyrating.gov.au/resources/existing-homes-guidance-note",
  "https://www.homeenergyrating.gov.au/resources/existing-homes-technical-note",
]) {
  assert.ok(linkTargets.has(href), `missing trusted report link: ${href}`);
}
assert.ok(checkedFontResources >= 2);
assert.ok(embeddedFontPrograms.size >= 2);
const allToUnicode = Array.from(toUnicodeCMaps).join("\n").toUpperCase();
for (const unicodeDestination of ["00B0", "2013"]) {
  assert.match(allToUnicode, new RegExp(`<${unicodeDestination}>`));
}

process.stdout.write(`${JSON.stringify({
  artifact: outputPath,
  bytes: bytes.length,
  pages: pdf.getPageCount(),
  tagged: true,
  language: "en-AU",
  displayDocumentTitle: true,
  xmpMetadata: true,
  checkedFontResources,
  embeddedFontPrograms: embeddedFontPrograms.size,
  toUnicodeMaps: toUnicodeCMaps.size,
  semanticLists: true,
  structuredLinks: linkCount,
  activeContent: false,
  pdfUaClaim: false,
  unsupportedTextPolicy: "fail-before-save",
  unsupportedScriptGate: unsupportedScriptGate.map(([script]) => script),
  claimBoundary:
    "Automated technical foundation check only; not an independent PDF/UA conformance certification.",
}, null, 2)}\n`);
