import {
  appendBezierCurve,
  clip,
  closePath,
  endPath,
  lineTo,
  moveTo,
  PDFBool,
  PDFDocument,
  PDFName,
  PDFString,
  PageSizes,
  popGraphicsState,
  pushGraphicsState,
  rgb,
} from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import {
  CUSTOMER_PLAN_PUBLIC_ORIGIN,
} from "./customer-plan-document.mjs";
import {
  AEA_BRANDMARK_PNG_DATA_URI,
} from "./aea-brand-assets.mjs";
import {
  customerPlanReportLayout,
} from "./customer-plan-report-design.mjs";
import {
  createCustomerPlanPdfTagger,
} from "./customer-plan-pdf-tags.mjs";

export const CUSTOMER_PLAN_PDF_VERSION =
  "2026-08-10-personalised-plan-pdf-v7";
export const CUSTOMER_PLAN_PDF_CONTRAST_COLORS = Object.freeze({
  oceanBlue: "#006da6",
  muted: "#536c78",
  paper: "#f8fcfd",
  canvas: "#eaf4f7",
});
export class CustomerPlanPdfUnsupportedTextError extends TypeError {
  constructor(unsupportedCharacters = []) {
    super(
      "The customer plan contains text the embedded PDF fonts cannot display.",
    );
    this.name = "CustomerPlanPdfUnsupportedTextError";
    this.code = "CUSTOMER_PLAN_PDF_UNSUPPORTED_TEXT";
    this.unsupportedCharacters = Array.from(
      new Set(unsupportedCharacters),
    ).slice(0, 24);
  }
}

const [PAGE_WIDTH, PAGE_HEIGHT] = PageSizes.A4;
const MARGIN = 44;
const CONTENT_WIDTH = PAGE_WIDTH - (MARGIN * 2);
const CONTENT_BOTTOM = 52;
const PDF_LAYOUT = customerPlanReportLayout.pdf;
const CARD_GAP = PDF_LAYOUT.cardGap;

const ARC_CONTROL = 0.5522847498307936;

function pdfColor(value) {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(value);
  if (!match) throw new TypeError(`Invalid PDF colour: ${value}`);
  return rgb(
    Number.parseInt(match[1], 16) / 255,
    Number.parseInt(match[2], 16) / 255,
    Number.parseInt(match[3], 16) / 255,
  );
}

function roundedRectanglePath(x, y, width, height, radius) {
  const safeRadius = Math.max(
    0,
    Math.min(radius, width / 2, height / 2),
  );
  const control = safeRadius * ARC_CONTROL;
  return [
    moveTo(x + safeRadius, y),
    lineTo(x + width - safeRadius, y),
    appendBezierCurve(
      x + width - safeRadius + control,
      y,
      x + width,
      y + safeRadius - control,
      x + width,
      y + safeRadius,
    ),
    lineTo(x + width, y + height - safeRadius),
    appendBezierCurve(
      x + width,
      y + height - safeRadius + control,
      x + width - safeRadius + control,
      y + height,
      x + width - safeRadius,
      y + height,
    ),
    lineTo(x + safeRadius, y + height),
    appendBezierCurve(
      x + safeRadius - control,
      y + height,
      x,
      y + height - safeRadius + control,
      x,
      y + height - safeRadius,
    ),
    lineTo(x, y + safeRadius),
    appendBezierCurve(
      x,
      y + safeRadius - control,
      x + safeRadius - control,
      y,
      x + safeRadius,
      y,
    ),
    closePath(),
  ];
}

function withRoundedClip(target, {
  x,
  y,
  width,
  height,
  radius = PDF_LAYOUT.panelRadius,
}, draw) {
  target.pushOperators(
    pushGraphicsState(),
    ...roundedRectanglePath(x, y, width, height, radius),
    clip(),
    endPath(),
  );
  draw();
  target.pushOperators(popGraphicsState());
}

function drawRoundedRectangle(target, {
  x,
  y,
  width,
  height,
  radius = PDF_LAYOUT.panelRadius,
  color,
  opacity,
  borderColor,
  borderOpacity,
  borderWidth = 0,
}) {
  const safeBorder = borderColor
    ? Math.max(0, Math.min(borderWidth, width / 4, height / 4))
    : 0;
  withRoundedClip(target, { x, y, width, height, radius }, () => {
    target.drawRectangle({
      x,
      y,
      width,
      height,
      color: safeBorder ? borderColor : color,
      opacity: safeBorder ? borderOpacity : opacity,
    });
  });
  if (!safeBorder) return;
  const innerX = x + safeBorder;
  const innerY = y + safeBorder;
  const innerWidth = width - (safeBorder * 2);
  const innerHeight = height - (safeBorder * 2);
  withRoundedClip(target, {
    x: innerX,
    y: innerY,
    width: innerWidth,
    height: innerHeight,
    radius: Math.max(0, radius - safeBorder),
  }, () => {
    target.drawRectangle({
      x: innerX,
      y: innerY,
      width: innerWidth,
      height: innerHeight,
      color,
      opacity,
    });
  });
}

const palette = Object.freeze({
  navy: rgb(0.024, 0.204, 0.282),
  navyDeep: rgb(0.004, 0.082, 0.145),
  inkSoft: rgb(0.043, 0.322, 0.42),
  electricBlue: rgb(0, 0.663, 0.91),
  oceanBlue: pdfColor(CUSTOMER_PLAN_PDF_CONTRAST_COLORS.oceanBlue),
  green: rgb(0.063, 0.725, 0.506),
  greenDark: rgb(0.016, 0.471, 0.341),
  teal: rgb(0.125, 0.847, 0.757),
  aqua: rgb(0.455, 0.945, 0.843),
  mint: rgb(0.91, 0.969, 0.961),
  mintStrong: rgb(0.843, 0.953, 0.933),
  white: rgb(1, 1, 1),
  paper: pdfColor(CUSTOMER_PLAN_PDF_CONTRAST_COLORS.paper),
  canvas: pdfColor(CUSTOMER_PLAN_PDF_CONTRAST_COLORS.canvas),
  text: rgb(0.031, 0.165, 0.227),
  body: rgb(0.212, 0.329, 0.404),
  muted: pdfColor(CUSTOMER_PLAN_PDF_CONTRAST_COLORS.muted),
  line: rgb(0.788, 0.875, 0.898),
  cream: rgb(1, 0.969, 0.898),
  creamLine: rgb(0.91, 0.776, 0.435),
  creamText: rgb(0.427, 0.325, 0.082),
  seaGlass: rgb(0.455, 0.945, 0.843),
  heroBody: rgb(0.796, 0.925, 0.953),
  glass: rgb(0.08, 0.298, 0.396),
});

const gradients = Object.freeze({
  hero: Object.freeze({
    from: Object.freeze([0, 21, 43]),
    to: Object.freeze([5, 91, 116]),
  }),
  header: Object.freeze({
    from: Object.freeze([0, 21, 43]),
    to: Object.freeze([4, 80, 103]),
  }),
  signal: Object.freeze({
    from: Object.freeze([5, 68, 94]),
    to: Object.freeze([5, 135, 148]),
  }),
  priority: Object.freeze({
    from: Object.freeze([4, 48, 72]),
    to: Object.freeze([5, 105, 123]),
  }),
});

function normalizedText(value, maximum = 8_000) {
  const supplied = String(value ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/\t/g, " ")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .normalize("NFC");
  return Array.from(supplied).slice(0, maximum).join("");
}

function requiredReport(value) {
  if (
    !value
    || typeof value !== "object"
    || Array.isArray(value)
    || !Array.isArray(value.planningSnapshot)
    || !Array.isArray(value.actions)
  ) {
    throw new TypeError(
      "A normalized privacy-filtered customer plan report is required.",
    );
  }
  for (const [field, maximum] of [
    ["planningSnapshot", 12],
    ["actions", 40],
    ["everydayActions", 12],
    ["questions", 12],
    ["decisionBasis", 24],
    ["beforeTrade", 24],
    ["resources", 12],
  ]) {
    if (!Array.isArray(value[field]) || value[field].length > maximum) {
      throw new TypeError(
        "A bounded privacy-filtered customer plan report is required.",
      );
    }
  }
  return value;
}

function requiredFontBytes(value, label) {
  const bytes = value instanceof Uint8Array
    ? value
    : value instanceof ArrayBuffer
      ? new Uint8Array(value)
      : null;
  if (!bytes || bytes.byteLength < 10_000 || bytes.byteLength > 2_000_000) {
    throw new TypeError(`A valid embedded ${label} font is required.`);
  }
  return bytes;
}

function requiredPdfFonts(value) {
  const supplied =
    value && typeof value === "object" && !Array.isArray(value)
      ? value
      : {};
  return {
    regular: requiredFontBytes(supplied.regular, "regular"),
    bold: requiredFontBytes(supplied.bold, "bold"),
  };
}

function embeddedFontCharacterSet(fontkitCreate, bytes, label) {
  try {
    const font = fontkitCreate(bytes);
    const characterSet = new Set(font?.characterSet || []);
    if (!characterSet.size) throw new Error("EMPTY_FONT_CHARACTER_SET");
    return characterSet;
  } catch {
    throw new TypeError(`The embedded ${label} font could not be read.`);
  }
}

function sharedFontCharacterSet(regularCharacters, boldCharacters) {
  return new Set(
    [...regularCharacters].filter((codePoint) =>
      boldCharacters.has(codePoint)
    ),
  );
}

function reportTextValues(value, output = [], seen = new Set(), depth = 0) {
  if (typeof value === "string") {
    output.push(value);
    return output;
  }
  if (!value || typeof value !== "object" || depth > 10) return output;
  if (seen.has(value)) return output;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) {
      reportTextValues(item, output, seen, depth + 1);
    }
    return output;
  }
  for (const item of Object.values(value)) {
    reportTextValues(item, output, seen, depth + 1);
  }
  return output;
}

function assertReportFontCoverage(report, supportedCharacters) {
  const unsupportedCharacters = new Set();
  for (const value of reportTextValues(report)) {
    for (const character of Array.from(normalizedText(value))) {
      if (
        character !== "\n"
        && !supportedCharacters.has(character.codePointAt(0))
      ) {
        unsupportedCharacters.add(character);
      }
    }
  }
  if (unsupportedCharacters.size) {
    throw new CustomerPlanPdfUnsupportedTextError(
      [...unsupportedCharacters],
    );
  }
}

function reportDate(value) {
  const supplied = normalizedText(value, 20);
  return /^\d{4}-\d{2}-\d{2}$/.test(supplied) ? supplied : "";
}

function xmlText(value, maximum = 500) {
  return normalizedText(value, maximum)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&apos;");
}

export function customerPlanPdfFileName(report) {
  const normalizedReport = requiredReport(report);
  const preparedDate = reportDate(normalizedReport.preparedDate);
  const prefix = normalizedReport.preparedFor
    ? "personalised-home-energy-plan"
    : "home-energy-plan";
  return preparedDate
    ? `${prefix}-${preparedDate}.pdf`
    : `${prefix}.pdf`;
}

const TRUSTED_EXTERNAL_REPORT_URLS = new Set([
  "https://www.energy.gov.au/households",
  "https://www.energy.gov.au/households/household-guides/reduce-energy-bills",
  "https://www.energy.gov.au/households/insulation-and-draught-proofing",
  "https://www.energy.gov.au/households/quick-wins",
  "https://www.energy.gov.au/rebates",
  "https://www.homeenergyrating.gov.au/",
  "https://www.homeenergyrating.gov.au/resources/existing-homes-guidance-note",
  "https://www.homeenergyrating.gov.au/resources/existing-homes-technical-note",
  "https://www.homeenergyrating.gov.au/households/existing-homes/measuring-energy-efficiency-existing-homes",
  "https://www.yourhome.gov.au/passive-design/introduction",
  "https://www.yourhome.gov.au/passive-design/insulation",
]);

function absoluteGuideHref(value) {
  const supplied = normalizedText(value, 240).trim();
  if (!supplied) return "";
  try {
    const origin = new URL(CUSTOMER_PLAN_PUBLIC_ORIGIN);
    const resolved = new URL(supplied, origin);
    const resolvedUrl = resolved.toString();
    return resolved.origin === origin.origin
      || TRUSTED_EXTERNAL_REPORT_URLS.has(resolvedUrl)
      ? resolvedUrl
      : "";
  } catch {
    return "";
  }
}

function splitLongToken(font, size, token, maximumWidth) {
  const pieces = [];
  let current = "";
  for (const character of token) {
    const candidate = `${current}${character}`;
    if (
      current
      && font.widthOfTextAtSize(candidate, size) > maximumWidth
    ) {
      pieces.push(current);
      current = character;
    } else {
      current = candidate;
    }
  }
  if (current) pieces.push(current);
  return pieces;
}

function fontSafeText(value, supportedCharacters) {
  const supplied = normalizedText(value);
  const unsupportedCharacters = Array.from(supplied).filter((character) =>
    character !== "\n"
    && !supportedCharacters.has(character.codePointAt(0))
  );
  if (unsupportedCharacters.length) {
    throw new CustomerPlanPdfUnsupportedTextError(unsupportedCharacters);
  }
  return supplied;
}

function wrapText(font, size, value, maximumWidth, supportedCharacters) {
  const supplied = fontSafeText(value, supportedCharacters);
  const lines = [];
  for (const paragraph of supplied.split("\n")) {
    const words = paragraph.trim().split(/\s+/).filter(Boolean);
    if (!words.length) {
      lines.push("");
      continue;
    }
    let current = "";
    for (const suppliedWord of words) {
      const pieces = font.widthOfTextAtSize(suppliedWord, size) > maximumWidth
        ? splitLongToken(font, size, suppliedWord, maximumWidth)
        : [suppliedWord];
      for (const word of pieces) {
        const candidate = current ? `${current} ${word}` : word;
        if (
          current
          && font.widthOfTextAtSize(candidate, size) > maximumWidth
        ) {
          lines.push(current);
          current = word;
        } else {
          current = candidate;
        }
      }
    }
    if (current) lines.push(current);
  }
  return lines;
}

export async function createCustomerPlanPdfBytes(
  suppliedReport,
  suppliedFonts,
) {
  const report = requiredReport(suppliedReport);
  const fontBytes = requiredPdfFonts(suppliedFonts);
  const copy = report.copy || {};
  const priorityActions = Array.isArray(report.priorityActions)
    ? report.priorityActions
    : report.actions.filter((action) => action?.priority);
  const laterActions = Array.isArray(report.laterActions)
    ? report.laterActions
    : report.actions.filter((action) => !action?.priority);
  const planComplete = report.actions.length > 0
    && report.actions.every((action) => action.completed);
  const completedCount = report.actions
    .filter((action) => action.completed)
    .length;
  const fontkitCreate = fontkit?.create;
  if (typeof fontkitCreate !== "function") {
    throw new TypeError("The embedded PDF font engine is unavailable.");
  }
  const regularCharacters = embeddedFontCharacterSet(
    fontkitCreate,
    fontBytes.regular,
    "regular",
  );
  const boldCharacters = embeddedFontCharacterSet(
    fontkitCreate,
    fontBytes.bold,
    "bold",
  );
  assertReportFontCoverage(
    report,
    sharedFontCharacterSet(regularCharacters, boldCharacters),
  );
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const pdfTags = createCustomerPlanPdfTagger(pdf);
  const regular = await pdf.embedFont(fontBytes.regular, { subset: false });
  const bold = await pdf.embedFont(fontBytes.bold, { subset: false });
  const brandmark = await pdf.embedPng(AEA_BRANDMARK_PNG_DATA_URI);
  const supportedCharacters = new Map(
    [
      [regular, regularCharacters],
      [bold, boldCharacters],
    ],
  );
  const pages = [];
  let page;
  let y;
  let pageSection = "";

  const linesFor = (
    value,
    {
      font = regular,
      size = 9.5,
      width = CONTENT_WIDTH,
      lineHeight = size * 1.45,
      color = palette.body,
    } = {},
  ) => wrapText(
    font,
    size,
    value,
    width,
    supportedCharacters.get(font),
  ).map((text) => ({
    text,
    font,
    size,
    lineHeight,
    color,
  }));

  const measureLines = (lines) => lines.reduce(
    (total, line) => total + line.lineHeight,
    0,
  );

  const drawLines = (
    lines,
    {
      x = MARGIN,
      startY = y,
      characterSpacing = 0,
    } = {},
  ) => {
    let cursor = startY;
    for (const line of lines) {
      if (line.text) {
        page.drawText(line.text, {
          x,
          y: cursor,
          size: line.size,
          font: line.font,
          color: line.color,
          characterSpacing,
        });
      }
      cursor -= line.lineHeight;
    }
    return cursor;
  };

  function gradientColor(from, to, progress) {
    return rgb(
      (from[0] + ((to[0] - from[0]) * progress)) / 255,
      (from[1] + ((to[1] - from[1]) * progress)) / 255,
      (from[2] + ((to[2] - from[2]) * progress)) / 255,
    );
  }

  function drawHorizontalGradient(
    target,
    {
      x = 0,
      gradientY = 0,
      width = PAGE_WIDTH,
      height = PAGE_HEIGHT,
      from,
      to,
      steps = 40,
    },
  ) {
    const stripeWidth = width / steps;
    for (let index = 0; index < steps; index += 1) {
      target.drawRectangle({
        x: x + (stripeWidth * index),
        y: gradientY,
        width: stripeWidth + 0.8,
        height,
        color: gradientColor(from, to, index / Math.max(steps - 1, 1)),
      });
    }
  }

  function drawBrandLockup({
    x = MARGIN,
    lockupY,
    compact = false,
    date = "",
  }) {
    const tile = compact ? 31 : 46;
    const logoSize = compact ? 22 : 34;
    drawRoundedRectangle(page, {
      x,
      y: lockupY,
      width: tile,
      height: tile,
      radius: compact ? 7 : PDF_LAYOUT.badgeRadius,
      color: palette.white,
      opacity: 0.09,
      borderColor: palette.aqua,
      borderWidth: 0.8,
      borderOpacity: 0.42,
    });
    page.drawImage(brandmark, {
      x: x + ((tile - logoSize) / 2),
      y: lockupY + ((tile - logoSize) / 2),
      width: logoSize,
      height: logoSize,
    });
    const brandX = x + tile + (compact ? 9 : 12);
    page.drawText("AUSTRALIAN ENERGY ASSESSMENTS", {
      x: brandX,
      y: lockupY + (compact ? 18 : 28),
      size: compact ? 7 : 8.8,
      font: bold,
      color: palette.white,
      characterSpacing: compact ? 0.45 : 0.7,
    });
    page.drawText("INDEPENDENT ENERGY ASSESSMENTS", {
      x: brandX,
      y: lockupY + (compact ? 8 : 13),
      size: compact ? 5.8 : 6.8,
      font: regular,
      color: palette.heroBody,
      characterSpacing: 0.5,
    });
    if (date) {
      const safeDate = fontSafeText(
        date,
        supportedCharacters.get(regular),
      );
      page.drawText(safeDate, {
        x: PAGE_WIDTH - MARGIN - regular.widthOfTextAtSize(
          safeDate,
          compact ? 7 : 8.2,
        ),
        y: lockupY + (compact ? 12 : 22),
        size: compact ? 7 : 8.2,
        font: regular,
        color: palette.heroBody,
      });
    }
  }

  pdf.setLanguage("en-AU");
  pdf.catalog.set(
    PDFName.of("ViewerPreferences"),
    pdf.context.obj({ DisplayDocTitle: PDFBool.True }),
  );
  pdf.setTitle(normalizedText(report.heading, 180), {
    showInWindowTitleBar: true,
  });
  pdf.setAuthor("Australian Energy Assessments");
  pdf.setSubject("Independent home energy planning roadmap");
  pdf.setCreator("Australian Energy Assessments");
  pdf.setProducer("Australian Energy Assessments");
  pdf.setKeywords([
    "home energy plan",
    "Australian Energy Assessments",
    CUSTOMER_PLAN_PDF_VERSION,
    normalizedText(report.designVersion, 100),
  ]);
  const preparedDate = reportDate(report.preparedDate);
  if (preparedDate) {
    const metadataDate = new Date(`${preparedDate}T00:00:00.000Z`);
    pdf.setCreationDate(metadataDate);
    pdf.setModificationDate(metadataDate);
  }
  const xmpDate = preparedDate
    ? `${preparedDate}T00:00:00.000Z`
    : "";
  const xmpMetadata = `<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description rdf:about=""
      xmlns:dc="http://purl.org/dc/elements/1.1/"
      xmlns:pdf="http://ns.adobe.com/pdf/1.3/"
      xmlns:xmp="http://ns.adobe.com/xap/1.0/">
      <dc:format>application/pdf</dc:format>
      <dc:language><rdf:Bag><rdf:li>en-AU</rdf:li></rdf:Bag></dc:language>
      <dc:title><rdf:Alt><rdf:li xml:lang="x-default">${xmlText(report.heading, 180)}</rdf:li></rdf:Alt></dc:title>
      <dc:creator><rdf:Seq><rdf:li>Australian Energy Assessments</rdf:li></rdf:Seq></dc:creator>
      <pdf:Producer>Australian Energy Assessments</pdf:Producer>
      <xmp:CreatorTool>Australian Energy Assessments</xmp:CreatorTool>
      ${xmpDate ? `<xmp:CreateDate>${xmpDate}</xmp:CreateDate><xmp:ModifyDate>${xmpDate}</xmp:ModifyDate>` : ""}
    </rdf:Description>
  </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;
  const metadataStream = pdf.context.stream(
    new TextEncoder().encode(xmpMetadata),
    {
      Type: PDFName.of("Metadata"),
      Subtype: PDFName.of("XML"),
    },
  );
  pdf.catalog.set(
    PDFName.of("Metadata"),
    pdf.context.register(metadataStream),
  );

  function addLinkAnnotation({
    x,
    y: linkY,
    width,
    height,
    href,
    label = "",
    structure = null,
  }) {
    const safeHref = absoluteGuideHref(href);
    if (!safeHref || width <= 0 || height <= 0) return null;
    const annotation = pdf.context.obj({
      Type: PDFName.of("Annot"),
      Subtype: PDFName.of("Link"),
      Rect: [x, linkY, x + width, linkY + height],
      Border: [0, 0, 0],
      Contents: PDFString.of(normalizedText(label, 180)),
      A: {
        Type: PDFName.of("Action"),
        S: PDFName.of("URI"),
        URI: PDFString.of(safeHref),
      },
    });
    const annotationRef = pdf.context.register(annotation);
    page.node.addAnnot(annotationRef);
    if (structure) {
      pdfTags.associateAnnotation(
        page,
        structure,
        annotation,
        annotationRef,
      );
    }
    return annotationRef;
  }

  function addContentPage(section = "") {
    pageSection = normalizedText(section, 80);
    page = pdf.addPage(PageSizes.A4);
    pages.push(page);
    pdfTags.registerPage(page);
    pdfTags.artifact(page, () => {
      page.drawRectangle({
        x: 0,
        y: 0,
        width: PAGE_WIDTH,
        height: PAGE_HEIGHT,
        color: palette.canvas,
      });
      drawHorizontalGradient(page, {
        x: 0,
        gradientY: PAGE_HEIGHT - 60,
        width: PAGE_WIDTH,
        height: 60,
        from: gradients.header.from,
        to: gradients.header.to,
        steps: 34,
      });
      page.drawCircle({
        x: PAGE_WIDTH - 38,
        y: PAGE_HEIGHT - 4,
        size: 82,
        color: palette.electricBlue,
        opacity: 0.13,
      });
      page.drawRectangle({
        x: 0,
        y: PAGE_HEIGHT - 64,
        width: PAGE_WIDTH,
        height: 4,
        color: palette.teal,
      });
      drawBrandLockup({
        x: MARGIN,
        lockupY: PAGE_HEIGHT - 47,
        compact: true,
      });
      if (pageSection) {
        const safeSection = fontSafeText(
          pageSection.toUpperCase(),
          supportedCharacters.get(bold),
        );
        page.drawText(`SECTION | ${safeSection}`, {
          x: PAGE_WIDTH
            - MARGIN
            - bold.widthOfTextAtSize(`SECTION | ${safeSection}`, 7),
          y: PAGE_HEIGHT - 29,
          size: 7,
          font: bold,
          color: palette.aqua,
          characterSpacing: 0.55,
        });
      }
    });
    y = PAGE_HEIGHT - 89;
  }

  function addCoverPage() {
    pageSection = "";
    page = pdf.addPage(PageSizes.A4);
    pages.push(page);
    pdfTags.registerPage(page);
    pdfTags.artifact(page, () => {
      drawHorizontalGradient(page, {
        x: 0,
        gradientY: 0,
        width: PAGE_WIDTH,
        height: PAGE_HEIGHT,
        from: gradients.hero.from,
        to: gradients.hero.to,
        steps: 56,
      });
      page.drawCircle({
        x: PAGE_WIDTH - 34,
        y: PAGE_HEIGHT - 92,
        size: 178,
        color: palette.electricBlue,
        opacity: 0.12,
      });
      page.drawCircle({
        x: PAGE_WIDTH - 112,
        y: PAGE_HEIGHT - 160,
        size: 112,
        color: palette.teal,
        opacity: 0.09,
      });
      page.drawCircle({
        x: 30,
        y: 28,
        size: 138,
        color: palette.oceanBlue,
        opacity: 0.13,
      });
      page.drawLine({
        start: { x: PAGE_WIDTH - 250, y: PAGE_HEIGHT },
        end: { x: PAGE_WIDTH, y: PAGE_HEIGHT - 250 },
        thickness: 1,
        color: palette.aqua,
        opacity: 0.22,
      });
      page.drawLine({
        start: { x: PAGE_WIDTH - 186, y: PAGE_HEIGHT },
        end: { x: PAGE_WIDTH, y: PAGE_HEIGHT - 186 },
        thickness: 4,
        color: palette.electricBlue,
        opacity: 0.13,
      });
      drawBrandLockup({
        x: MARGIN,
        lockupY: PAGE_HEIGHT - 92,
        date: report.displayDate || preparedDate,
      });
    });

    const eyebrowLines = linesFor(
      copy.heroEyebrow || "Your personalised home energy plan",
      {
        font: bold,
        size: 8.4,
        width: CONTENT_WIDTH,
        lineHeight: 11,
        color: palette.teal,
      },
    );
    pdfTags.beginSection(
      copy.heroTitle || "Your home energy roadmap",
    );
    pdfTags.mark(page, "P", () => {
      drawLines(eyebrowLines, {
        startY: PAGE_HEIGHT - 151,
        characterSpacing: 0.9,
      });
    }, {
      actualText: copy.heroEyebrow
        || "Your personalised home energy plan",
    });
    const titleLines = linesFor(
      copy.heroTitle || "Your home energy roadmap",
      {
        font: bold,
        size: 38,
        width: CONTENT_WIDTH - 28,
        lineHeight: 42,
        color: palette.white,
      },
    ).slice(0, 3);
    let titleBottom = PAGE_HEIGHT - 182;
    pdfTags.mark(page, "H1", () => {
      titleBottom = drawLines(titleLines, {
        startY: PAGE_HEIGHT - 182,
      });
    }, {
      actualText: copy.heroTitle || "Your home energy roadmap",
    });
    const planTitleLines = linesFor(report.planTitle, {
      font: bold,
      size: 17,
      width: CONTENT_WIDTH - 50,
      lineHeight: 23,
      color: palette.aqua,
    }).slice(0, 2);
    let planTitleBottom = titleBottom - 12;
    pdfTags.mark(page, "H2", () => {
      planTitleBottom = drawLines(planTitleLines, {
        startY: titleBottom - 12,
      });
    }, {
      actualText: report.planTitle,
    });
    const summaryLines = linesFor(report.summary, {
      font: regular,
      size: 11.2,
      width: CONTENT_WIDTH - 76,
      lineHeight: 16.5,
      color: palette.heroBody,
    }).slice(0, 4);
    pdfTags.mark(page, "P", () => {
      drawLines(summaryLines, {
        startY: planTitleBottom - 8,
      });
    }, {
      actualText: report.summary,
    });

    const customerLine = [
      report.preparedFor
        ? `Prepared for ${normalizedText(report.preparedFor, 120)}`
        : "",
      normalizedText(report.customerSummary, 220),
    ].filter(Boolean).join(" | ");
    if (customerLine) {
      const customerLines = linesFor(customerLine, {
        font: bold,
        size: 8.7,
        width: CONTENT_WIDTH - 32,
        lineHeight: 11,
        color: palette.white,
      }).slice(0, 2);
      pdfTags.artifact(page, () => {
        drawRoundedRectangle(page, {
          x: MARGIN,
          y: 322,
          width: CONTENT_WIDTH,
          height: 36,
          radius: 9,
          color: palette.white,
          opacity: 0.09,
          borderColor: palette.aqua,
          borderWidth: 0.7,
          borderOpacity: 0.42,
        });
      });
      pdfTags.mark(page, "P", () => {
        drawLines(customerLines, {
          x: MARGIN + 16,
          startY: customerLines.length > 1 ? 344 : 338,
        });
      }, { actualText: customerLine });
    }

    pdfTags.artifact(page, () => {
      page.drawLine({
        start: { x: MARGIN, y: 303 },
        end: { x: PAGE_WIDTH - MARGIN, y: 303 },
        thickness: 1.2,
        color: palette.aqua,
        opacity: 0.48,
      });
      const route = [
        ["01", "UNDERSTAND"],
        ["02", "PRIORITISE"],
        ["03", "TAKE ACTION"],
      ];
      route.forEach(([number, label], index) => {
        const routeX = MARGIN + (index * ((CONTENT_WIDTH - 22) / 3));
        page.drawCircle({
          x: routeX + 9,
          y: 303,
          size: 9,
          color: index === 0 ? palette.teal : palette.oceanBlue,
          borderColor: palette.aqua,
          borderWidth: 0.8,
        });
        page.drawText(number, {
          x: routeX + 3.7,
          y: 299.8,
          size: 5.5,
          font: bold,
          color: palette.white,
        });
        page.drawText(label, {
          x: routeX,
          y: 278,
          size: 7.2,
          font: bold,
          color: palette.heroBody,
          characterSpacing: 0.8,
        });
      });
    });

    pdfTags.mark(page, "H2", () => {
      page.drawText("YOUR PLAN AT A GLANCE", {
        x: MARGIN,
        y: 236,
        size: 7.8,
        font: bold,
        color: palette.teal,
        characterSpacing: 1,
      });
    }, {
      actualText: "Your plan at a glance",
    });
    const metrics = planComplete
      ? [
        {
          value: String(completedCount),
          label: completedCount === 1 ? "STEP COMPLETE" : "STEPS COMPLETE",
        },
        {
          value: "0",
          label: "LEFT TO PLAN",
        },
        {
          value: String(report.actions.length),
          label: "CHECKLISTS INCLUDED",
        },
      ]
      : [
        {
          value: String(priorityActions.length),
          label: priorityActions.length === 1
            ? "MOVE TO START"
            : "MOVES TO START",
        },
        {
          value: String(laterActions.length),
          label: laterActions.length === 1 ? "STEP TO PLAN" : "STEPS TO PLAN",
        },
        {
          value: String(report.actions.length),
          label: "CHECKLISTS INCLUDED",
        },
      ];
    const metricGap = 10;
    const metricWidth = (CONTENT_WIDTH - (metricGap * 2)) / 3;
    metrics.forEach((metric, index) => {
      const metricX = MARGIN + (index * (metricWidth + metricGap));
      pdfTags.artifact(page, () => {
        drawRoundedRectangle(page, {
          x: metricX,
          y: 112,
          width: metricWidth,
          height: 102,
          radius: PDF_LAYOUT.panelRadius,
          color: palette.white,
          opacity: 0.08,
          borderColor: index === 0 ? palette.teal : palette.electricBlue,
          borderWidth: index === 0 ? 1.5 : 0.8,
          borderOpacity: 0.64,
        });
        drawRoundedRectangle(page, {
          x: metricX,
          y: 208,
          width: metricWidth,
          height: 6,
          radius: 3,
          color: index === 0 ? palette.teal : palette.electricBlue,
          opacity: index === 0 ? 1 : 0.76,
        });
      });
      pdfTags.mark(page, "P", () => {
        page.drawText(metric.value, {
          x: metricX + 16,
          y: 158,
          size: 30,
          font: bold,
          color: palette.white,
        });
        page.drawText(metric.label, {
          x: metricX + 16,
          y: 133,
          size: 6.8,
          font: bold,
          color: palette.heroBody,
          characterSpacing: 0.65,
        });
      }, {
        actualText: `${metric.value} ${metric.label}`,
      });
    });
    pdfTags.artifact(page, () => {
      page.drawText(
        "INDEPENDENT | BRAND NEUTRAL | BUILT AROUND YOUR HOME",
        {
          x: MARGIN,
          y: 58,
          size: 7,
          font: bold,
          color: palette.aqua,
          characterSpacing: 0.72,
        },
      );
    });
    y = 0;
  }

  function ensureSpace(requiredHeight, section = pageSection) {
    if (y - requiredHeight >= CONTENT_BOTTOM) return;
    addContentPage(section);
  }

  function drawSectionHeading(eyebrow, title, intro = "") {
    const eyebrowLines = linesFor(normalizedText(eyebrow).toUpperCase(), {
      font: bold,
      size: 7.5,
      width: CONTENT_WIDTH,
      lineHeight: 10,
      color: palette.oceanBlue,
    });
    const titleLines = linesFor(title, {
      font: bold,
      size: 22,
      width: CONTENT_WIDTH,
      lineHeight: 25,
      color: palette.navy,
    });
    const introLines = intro
      ? linesFor(intro, {
        font: regular,
        size: 10,
        width: CONTENT_WIDTH,
        lineHeight: 14.5,
        color: palette.muted,
      })
      : [];
    const height = measureLines(eyebrowLines)
      + 12
      + measureLines(titleLines)
      + (introLines.length ? 4 + measureLines(introLines) : 0)
      + 14;
    ensureSpace(height);
    pdfTags.artifact(page, () => {
      drawRoundedRectangle(page, {
        x: MARGIN,
        y: y + 4,
        width: 28,
        height: 3,
        radius: 1.5,
        color: palette.teal,
      });
    });
    y -= 6;
    pdfTags.mark(page, "P", () => {
      y = drawLines(eyebrowLines, {
        startY: y,
        characterSpacing: 0.65,
      });
    }, { actualText: eyebrow });
    y -= 12;
    pdfTags.mark(page, "H2", () => {
      y = drawLines(titleLines, { startY: y });
    }, { actualText: title });
    if (introLines.length) {
      y -= 4;
      pdfTags.mark(page, "P", () => {
        y = drawLines(introLines, { startY: y });
      }, { actualText: intro });
    }
    y -= 14;
  }

  function drawSnapshotGrid() {
    if (!report.planningSnapshot.length) return;
    const [lead, ...remaining] = report.planningSnapshot;
    const leadLabelLines = linesFor(normalizedText(lead?.label).toUpperCase(), {
      font: bold,
      size: 7.2,
      width: CONTENT_WIDTH - 36,
      lineHeight: 9.5,
      color: palette.aqua,
    });
    const leadValueLines = linesFor(lead?.value, {
      font: bold,
      size: 12.2,
      width: CONTENT_WIDTH - 70,
      lineHeight: 17,
      color: palette.white,
    });
    const leadHeight = Math.max(
      86,
      36
        + measureLines(leadLabelLines)
        + PDF_LAYOUT.labelTitleGap
        + measureLines(leadValueLines),
    );
    ensureSpace(leadHeight + 12);
    const leadBottom = y - leadHeight;
    pdfTags.artifact(page, () => {
      withRoundedClip(page, {
        x: MARGIN,
        width: CONTENT_WIDTH,
        y: leadBottom,
        height: leadHeight,
        radius: PDF_LAYOUT.panelRadius,
      }, () => {
        drawHorizontalGradient(page, {
          x: MARGIN,
          gradientY: leadBottom,
          width: CONTENT_WIDTH,
          height: leadHeight,
          from: gradients.signal.from,
          to: gradients.signal.to,
          steps: 36,
        });
        page.drawCircle({
          x: PAGE_WIDTH - MARGIN - 8,
          y: leadBottom + 10,
          size: 80,
          color: palette.electricBlue,
          opacity: 0.11,
        });
      });
      drawRoundedRectangle(page, {
        x: MARGIN + 7,
        y: leadBottom + 10,
        width: 6,
        height: leadHeight - 20,
        radius: 3,
        color: palette.teal,
      });
    });
    let leadCursor = y - 22;
    pdfTags.mark(page, "P", () => {
      leadCursor = drawLines(leadLabelLines, {
        x: MARGIN + 24,
        startY: leadCursor,
        characterSpacing: 0.6,
      });
    }, { actualText: lead?.label });
    leadCursor -= PDF_LAYOUT.labelTitleGap;
    pdfTags.mark(page, "P", () => {
      drawLines(leadValueLines, {
        x: MARGIN + 24,
        startY: leadCursor,
      });
    }, { actualText: lead?.value });
    y = leadBottom - 12;

    const cellGap = 10;
    const cellWidth = (CONTENT_WIDTH - cellGap) / 2;
    for (
      let index = 0;
      index < remaining.length;
      index += 2
    ) {
      const pair = remaining.slice(index, index + 2);
      const currentCellWidth = pair.length === 1 ? CONTENT_WIDTH : cellWidth;
      const prepared = pair.map((item) => {
        const labelLines = linesFor(normalizedText(item?.label).toUpperCase(), {
          font: bold,
          size: 7.2,
          width: currentCellWidth - 28,
          lineHeight: 9.5,
          color: palette.oceanBlue,
        });
        const valueLines = linesFor(item?.value, {
          font: regular,
          size: 10,
          width: currentCellWidth - 28,
          lineHeight: 14.5,
          color: palette.text,
        });
        return { labelLines, valueLines };
      });
      const rowHeight = Math.max(
        ...prepared.map(({ labelLines, valueLines }) =>
          32
            + measureLines(labelLines)
            + PDF_LAYOUT.labelTitleGap
            + measureLines(valueLines)
        ),
        72,
      );
      ensureSpace(rowHeight + cellGap);
      prepared.forEach(({ labelLines, valueLines }, pairIndex) => {
        const item = pair[pairIndex];
        const x = MARGIN + (pairIndex * (currentCellWidth + cellGap));
        const bottom = y - rowHeight;
        pdfTags.artifact(page, () => {
          drawRoundedRectangle(page, {
            x,
            y: bottom,
            width: currentCellWidth,
            height: rowHeight,
            radius: PDF_LAYOUT.compactRadius,
            color: palette.paper,
            borderColor: palette.line,
            borderWidth: 0.8,
          });
          drawRoundedRectangle(page, {
            x: x + 12,
            y: y - 4,
            width: currentCellWidth - 24,
            height: 4,
            radius: 2,
            color: pairIndex === 0 ? palette.electricBlue : palette.teal,
          });
        });
        let cursor = y - 20;
        pdfTags.mark(page, "P", () => {
          cursor = drawLines(labelLines, {
            x: x + 14,
            startY: cursor,
            characterSpacing: 0.5,
          });
        }, { actualText: item?.label });
        cursor -= PDF_LAYOUT.labelTitleGap;
        pdfTags.mark(page, "P", () => {
          drawLines(valueLines, { x: x + 14, startY: cursor });
        }, { actualText: item?.value });
      });
      y -= rowHeight + cellGap;
    }
  }

  function drawPlanSignalStrip() {
    const height = 76;
    ensureSpace(height + CARD_GAP);
    const bottom = y - height;
    pdfTags.artifact(page, () => {
      withRoundedClip(page, {
        x: MARGIN,
        width: CONTENT_WIDTH,
        y: bottom,
        height,
        radius: PDF_LAYOUT.panelRadius,
      }, () => {
        drawHorizontalGradient(page, {
          x: MARGIN,
          gradientY: bottom,
          width: CONTENT_WIDTH,
          height,
          from: gradients.header.from,
          to: gradients.signal.to,
          steps: 36,
        });
      });
    });
    const signals = planComplete
      ? [
        [String(completedCount), "STEPS COMPLETE"],
        ["0", "LEFT TO PLAN"],
        [String(report.actions.length), "CHECKLISTS"],
      ]
      : [
        [String(priorityActions.length), "START NOW"],
        [String(laterActions.length), "PLAN NEXT"],
        [String(report.actions.length), "CHECKLISTS"],
      ];
    const columnWidth = CONTENT_WIDTH / signals.length;
    signals.forEach(([value, label], index) => {
      const columnX = MARGIN + (columnWidth * index);
      if (index > 0) {
        pdfTags.artifact(page, () => {
          page.drawLine({
            start: { x: columnX, y: bottom + 15 },
            end: { x: columnX, y: y - 15 },
            thickness: 0.7,
            color: palette.aqua,
            opacity: 0.32,
          });
        });
      }
      pdfTags.mark(page, "P", () => {
        page.drawText(value, {
          x: columnX + 18,
          y: bottom + 34,
          size: 22,
          font: bold,
          color: palette.white,
        });
        page.drawText(label, {
          x: columnX + 18,
          y: bottom + 18,
          size: 6.5,
          font: bold,
          color: palette.aqua,
          characterSpacing: 0.55,
        });
      }, {
        actualText: `${value} ${label}`,
      });
    });
    y = bottom - CARD_GAP;
  }

  function drawInfoPanel({
    eyebrow = "",
    title = "",
    body = "",
    bullets = [],
    tone = "mint",
  }) {
    const fill = tone === "dark"
      ? palette.navy
      : tone === "cream"
        ? palette.cream
        : palette.paper;
    const border = tone === "dark"
      ? palette.navy
      : tone === "cream"
        ? palette.creamLine
        : palette.line;
    const labelColor = tone === "dark"
      ? palette.teal
      : tone === "cream"
        ? palette.creamText
        : palette.greenDark;
    const titleColor = tone === "dark"
      ? palette.white
      : tone === "cream"
        ? palette.creamText
        : palette.navy;
    const bodyColor = tone === "dark"
      ? palette.heroBody
      : tone === "cream"
        ? palette.creamText
        : palette.body;
    const innerWidth = CONTENT_WIDTH - (PDF_LAYOUT.panelPaddingX * 2);
    const eyebrowLines = eyebrow
      ? linesFor(normalizedText(eyebrow).toUpperCase(), {
        font: bold,
        size: 7.2,
        width: innerWidth,
        lineHeight: 9.5,
        color: labelColor,
      })
      : [];
    const titleLines = title
      ? linesFor(title, {
        font: bold,
        size: 15,
        width: innerWidth,
        lineHeight: 18,
        color: titleColor,
      })
      : [];
    const bodyLines = body
      ? linesFor(body, {
        font: regular,
        size: 10,
        width: innerWidth,
        lineHeight: 14.5,
        color: bodyColor,
      })
      : [];
    const bulletEntries = bullets.map((item) => ({
      actualText: normalizedText(item),
      lines: linesFor(
        normalizedText(item),
        {
          font: regular,
          size: 9.5,
          width: innerWidth - 18,
          lineHeight: 13.5,
          color: bodyColor,
        },
      ),
    }));
    const bulletContentHeight = bulletEntries.reduce(
      (total, entry, index) =>
        total
        + measureLines(entry.lines)
        + (index > 0 ? 4 : 0),
      0,
    );
    const contentHeight = measureLines(eyebrowLines)
      + (
        eyebrowLines.length && titleLines.length
          ? PDF_LAYOUT.labelTitleGap
          : 0
      )
      + measureLines(titleLines)
      + (
        bodyLines.length && (titleLines.length || eyebrowLines.length)
          ? PDF_LAYOUT.titleBodyGap
          : 0
      )
      + measureLines(bodyLines)
      + (bulletEntries.length ? PDF_LAYOUT.titleBodyGap : 0)
      + bulletContentHeight;
    const height = Math.max(
      64,
      contentHeight + (PDF_LAYOUT.panelPaddingY * 2),
    );
    ensureSpace(height + CARD_GAP);
    const bottom = y - height;
    pdfTags.artifact(page, () => {
      if (tone === "dark") {
        withRoundedClip(page, {
          x: MARGIN,
          width: CONTENT_WIDTH,
          y: bottom,
          height,
          radius: PDF_LAYOUT.panelRadius,
        }, () => {
          drawHorizontalGradient(page, {
            x: MARGIN,
            gradientY: bottom,
            width: CONTENT_WIDTH,
            height,
            from: gradients.header.from,
            to: gradients.signal.to,
            steps: 36,
          });
        });
      } else {
        drawRoundedRectangle(page, {
          x: MARGIN,
          y: bottom,
          width: CONTENT_WIDTH,
          height,
          radius: PDF_LAYOUT.panelRadius,
          color: fill,
          borderColor: border,
          borderWidth: 0.8,
        });
      }
      drawRoundedRectangle(page, {
        x: MARGIN + 7,
        y: bottom + 10,
        width: 5,
        height: height - 20,
        radius: 2.5,
        color: tone === "cream" ? palette.creamLine : palette.teal,
      });
    });
    let cursor = y - PDF_LAYOUT.panelPaddingY;
    if (eyebrowLines.length) {
      pdfTags.mark(page, "P", () => {
        cursor = drawLines(eyebrowLines, {
          x: MARGIN + PDF_LAYOUT.panelPaddingX,
          startY: cursor,
          characterSpacing: 0.55,
        });
      }, { actualText: eyebrow });
    }
    if (titleLines.length) {
      if (eyebrowLines.length) cursor -= PDF_LAYOUT.labelTitleGap;
      pdfTags.mark(page, "H3", () => {
        cursor = drawLines(titleLines, {
          x: MARGIN + PDF_LAYOUT.panelPaddingX,
          startY: cursor,
        });
      }, { actualText: title });
    }
    if (bodyLines.length) {
      if (titleLines.length || eyebrowLines.length) {
        cursor -= PDF_LAYOUT.titleBodyGap;
      }
      pdfTags.mark(page, "P", () => {
        cursor = drawLines(bodyLines, {
          x: MARGIN + PDF_LAYOUT.panelPaddingX,
          startY: cursor,
        });
      }, { actualText: body });
    }
    if (bulletEntries.length) {
      cursor -= PDF_LAYOUT.titleBodyGap;
      const list = pdfTags.beginContainer("L", {
        title: title || eyebrow || "Information list",
      });
      bulletEntries.forEach((entry, index) => {
        if (index > 0) cursor -= 4;
        const item = pdfTags.beginContainer("LI", { parent: list });
        pdfTags.mark(page, "Lbl", () => {
          page.drawText("\u2022", {
            x: MARGIN + PDF_LAYOUT.panelPaddingX + 4,
            y: cursor,
            size: 9.5,
            font: bold,
            color: bodyColor,
          });
        }, {
          actualText: "\u2022",
          parent: item,
        });
        pdfTags.mark(page, "LBody", () => {
          cursor = drawLines(entry.lines, {
            x: MARGIN + PDF_LAYOUT.panelPaddingX + 18,
            startY: cursor,
          });
        }, {
          actualText: entry.actualText,
          parent: item,
        });
      });
    }
    y = bottom - CARD_GAP;
  }

  function drawActionCard(action, priority = false) {
    const numberLabel = action?.completed
      ? "DONE"
      : String(Number(action?.number) || 1).padStart(2, "0");
    const numberWidth = 44;
    const contentX = MARGIN + 24;
    const contentWidth = CONTENT_WIDTH - 48;
    const headerX = MARGIN + numberWidth + 34;
    const headerWidth = CONTENT_WIDTH - numberWidth - 58;
    const columnGap = 16;
    const columnWidth = (contentWidth - columnGap) / 2;
    const bodyColor = priority ? palette.heroBody : palette.body;
    const labelColor = priority ? palette.aqua : palette.oceanBlue;
    const titleColor = priority ? palette.white : palette.navy;
    const stageText = priority
      ? `START HERE | ${normalizedText(action?.stage)}`
      : normalizedText(action?.stage);
    const stageLines = linesFor(stageText.toUpperCase(), {
      font: bold,
      size: 7.1,
      width: headerWidth,
      lineHeight: 9.5,
      color: labelColor,
    });
    const titleLines = linesFor(action?.title, {
      font: bold,
      size: priority ? 15.5 : 14.2,
      width: headerWidth,
      lineHeight: priority ? 18.5 : 17,
      color: titleColor,
    });

    const paragraphBlock = (label, text, width = contentWidth) => {
      const actualText = normalizedText(text, 900);
      if (!actualText) return null;
      const labelLines = linesFor(label, {
        font: bold,
        size: 6.7,
        width,
        lineHeight: 8.7,
        color: labelColor,
      });
      const bodyLines = linesFor(actualText, {
        font: regular,
        size: width === contentWidth ? 8.8 : 8.25,
        width,
        lineHeight: width === contentWidth ? 12.2 : 11.3,
        color: bodyColor,
      });
      return {
        label,
        actualText,
        labelLines,
        bodyLines,
        height: measureLines(labelLines) + 3 + measureLines(bodyLines),
      };
    };
    const listBlock = (label, values) => {
      const items = (Array.isArray(values) ? values : [])
        .map((value) => normalizedText(value, 260))
        .filter(Boolean)
        .slice(0, 3)
        .map((actualText) => ({
          actualText,
          lines: linesFor(actualText, {
            font: regular,
            size: 8.05,
            width: columnWidth - 17,
            lineHeight: 10.9,
            color: bodyColor,
          }),
        }));
      if (!items.length) return null;
      const labelLines = linesFor(label, {
        font: bold,
        size: 6.7,
        width: columnWidth,
        lineHeight: 8.7,
        color: labelColor,
      });
      return {
        label,
        labelLines,
        items,
        height: measureLines(labelLines)
          + 4
          + items.reduce((total, item, index) => (
            total + measureLines(item.lines) + (index ? 3 : 0)
          ), 0),
      };
    };
    const whatToDo = paragraphBlock(
      "WHAT TO DO",
      action?.whatToDo || action?.description,
    );
    const whyItMatters = paragraphBlock(
      "WHY IT MATTERS",
      action?.whyItMatters,
      columnWidth,
    );
    const householdReason = paragraphBlock(
      "WHY THIS APPLIES TO YOUR HOME",
      action?.householdReason,
      columnWidth,
    );
    const confirmations = listBlock(
      "CONFIRM BEFORE QUOTING",
      action?.confirmBeforeWork,
    );
    const quoteChecklist = listBlock(
      "QUOTE AND EVIDENCE CHECKLIST",
      action?.quoteChecklist,
    );
    const sequence = paragraphBlock(
      "SEQUENCE AND DEPENDENCIES",
      action?.sequence,
      columnWidth,
    );
    const safety = paragraphBlock(
      "SAFETY BOUNDARY",
      action?.safety,
      columnWidth,
    );
    const links = (Array.isArray(action?.links) ? action.links : [])
      .concat(
        action?.guideHref
          ? [{
            label: action?.guideLabel || copy.guideLabel,
            href: action.guideHref,
          }]
          : [],
      )
      .flatMap((link) => {
        const safeHref = absoluteGuideHref(link?.href);
        const label = normalizedText(link?.label, 140);
        return safeHref && label ? [{ safeHref, label }] : [];
      })
      .filter((link, index, values) => (
        values.findIndex((candidate) => candidate.safeHref === link.safeHref)
          === index
      ))
      .slice(0, 3)
      .map((link) => ({
        ...link,
        lines: linesFor(link.label, {
          font: bold,
          size: 8,
          width: contentWidth - 16,
          lineHeight: 10.6,
          color: priority ? palette.aqua : palette.greenDark,
        }),
      }));
    const headerHeight = measureLines(stageLines)
      + PDF_LAYOUT.labelTitleGap
      + measureLines(titleLines);
    const rowHeight = (left, right) => Math.max(
      left?.height || 0,
      right?.height || 0,
    );
    const linksHeight = links.length
      ? 8.7
        + 4
        + links.reduce((total, link, index) => (
          total + measureLines(link.lines) + (index ? 3 : 0)
        ), 0)
      : 0;
    const contentHeight = headerHeight
      + 15
      + (whatToDo?.height || 0)
      + 13
      + rowHeight(whyItMatters, householdReason)
      + 13
      + rowHeight(confirmations, quoteChecklist)
      + 13
      + rowHeight(sequence, safety)
      + (linksHeight ? 13 + linksHeight : 0);
    const height = Math.max(220, contentHeight + 38);
    ensureSpace(height + CARD_GAP, priority ? "Start here" : "Your plan");
    const bottom = y - height;
    pdfTags.artifact(page, () => {
      if (priority) {
        withRoundedClip(page, {
          x: MARGIN,
          width: CONTENT_WIDTH,
          y: bottom,
          height,
          radius: PDF_LAYOUT.panelRadius,
        }, () => {
          drawHorizontalGradient(page, {
            x: MARGIN,
            gradientY: bottom,
            width: CONTENT_WIDTH,
            height,
            from: gradients.priority.from,
            to: gradients.priority.to,
            steps: 38,
          });
          page.drawCircle({
            x: PAGE_WIDTH - MARGIN - 8,
            y: bottom + 8,
            size: 64,
            color: palette.electricBlue,
            opacity: 0.1,
          });
        });
      } else {
        drawRoundedRectangle(page, {
          x: MARGIN,
          y: bottom,
          width: CONTENT_WIDTH,
          height,
          radius: PDF_LAYOUT.panelRadius,
          color: palette.paper,
          borderColor: palette.line,
          borderWidth: 0.8,
        });
        drawRoundedRectangle(page, {
          x: MARGIN + 12,
          y: y - 4,
          width: CONTENT_WIDTH - 24,
          height: 4,
          radius: 2,
          color: palette.electricBlue,
        });
      }
      if (priority) {
        drawRoundedRectangle(page, {
          x: MARGIN + 7,
          y: bottom + 10,
          width: 5,
          height: height - 20,
          radius: 2.5,
          color: palette.teal,
        });
      }
      drawRoundedRectangle(page, {
        x: MARGIN + 16,
        y: y - 58,
        width: numberWidth,
        height: 40,
        radius: PDF_LAYOUT.badgeRadius,
        color: action?.completed
          ? palette.greenDark
          : priority
            ? palette.electricBlue
            : palette.navy,
      });
    });
    const safeNumber = fontSafeText(
      numberLabel,
      supportedCharacters.get(bold),
    );
    pdfTags.mark(page, "Span", () => {
      page.drawText(safeNumber, {
        x: MARGIN + 16
          + ((numberWidth - bold.widthOfTextAtSize(safeNumber, 9)) / 2),
        y: y - 42,
        size: 9,
        font: bold,
        color: palette.white,
      });
    }, { actualText: numberLabel });
    let cursor = y - PDF_LAYOUT.panelPaddingY;
    pdfTags.mark(page, "P", () => {
      cursor = drawLines(stageLines, {
        x: headerX,
        startY: cursor,
        characterSpacing: 0.45,
      });
    }, { actualText: stageText });
    cursor -= PDF_LAYOUT.labelTitleGap;
    pdfTags.mark(page, "H3", () => {
      cursor = drawLines(titleLines, { x: headerX, startY: cursor });
    }, { actualText: action?.title });

    const drawParagraphBlock = (block, x, startY) => {
      if (!block) return startY;
      let blockCursor = startY;
      pdfTags.mark(page, "P", () => {
        blockCursor = drawLines(block.labelLines, {
          x,
          startY: blockCursor,
          characterSpacing: 0.45,
        });
      }, { actualText: block.label });
      blockCursor -= 3;
      pdfTags.mark(page, "P", () => {
        blockCursor = drawLines(block.bodyLines, {
          x,
          startY: blockCursor,
        });
      }, { actualText: block.actualText });
      return blockCursor;
    };
    const drawListBlock = (block, x, startY) => {
      if (!block) return startY;
      let blockCursor = startY;
      pdfTags.mark(page, "P", () => {
        blockCursor = drawLines(block.labelLines, {
          x,
          startY: blockCursor,
          characterSpacing: 0.45,
        });
      }, { actualText: block.label });
      blockCursor -= 4;
      const list = pdfTags.beginContainer("L", { title: block.label });
      block.items.forEach((item, index) => {
        if (index) blockCursor -= 3;
        const listItem = pdfTags.beginContainer("LI", { parent: list });
        pdfTags.mark(page, "Lbl", () => {
          page.drawCircle({
            x: x + 3.5,
            y: blockCursor - 3.2,
            size: 2.3,
            color: priority ? palette.teal : palette.electricBlue,
          });
        }, { actualText: "Bullet", parent: listItem });
        pdfTags.mark(page, "LBody", () => {
          blockCursor = drawLines(item.lines, {
            x: x + 14,
            startY: blockCursor,
          });
        }, { actualText: item.actualText, parent: listItem });
      });
      return blockCursor;
    };
    const drawPair = (left, right, startY, drawBlock) => {
      if (left) drawBlock(left, contentX, startY);
      if (right) drawBlock(
        right,
        contentX + columnWidth + columnGap,
        startY,
      );
      return startY - rowHeight(left, right);
    };

    cursor -= 15;
    cursor = drawParagraphBlock(whatToDo, contentX, cursor);
    cursor -= 13;
    cursor = drawPair(
      whyItMatters,
      householdReason,
      cursor,
      drawParagraphBlock,
    );
    cursor -= 13;
    cursor = drawPair(
      confirmations,
      quoteChecklist,
      cursor,
      drawListBlock,
    );
    cursor -= 13;
    cursor = drawPair(sequence, safety, cursor, drawParagraphBlock);

    if (links.length) {
      cursor -= 13;
      const linkLabelLines = linesFor("HELPFUL LINKS", {
        font: bold,
        size: 6.7,
        width: contentWidth,
        lineHeight: 8.7,
        color: labelColor,
      });
      pdfTags.mark(page, "P", () => {
        cursor = drawLines(linkLabelLines, {
          x: contentX,
          startY: cursor,
          characterSpacing: 0.45,
        });
      }, { actualText: "Helpful links" });
      cursor -= 4;
      links.forEach((link, index) => {
        if (index) cursor -= 3;
        const linkTop = cursor;
        const linkStructure = pdfTags.mark(page, "Link", () => {
          cursor = drawLines(link.lines, {
            x: contentX + 14,
            startY: cursor,
          });
        }, { actualText: link.label });
        const linkWidth = Math.min(
          contentWidth - 14,
          Math.max(...link.lines.map((line) =>
            line.font.widthOfTextAtSize(line.text, line.size)
          )),
        );
        pdfTags.artifact(page, () => {
          page.drawCircle({
            x: contentX + 3.5,
            y: linkTop - 3.2,
            size: 2.3,
            color: priority ? palette.teal : palette.greenDark,
          });
          page.drawLine({
            start: { x: contentX + 14, y: linkTop - 2 },
            end: { x: contentX + 14 + linkWidth, y: linkTop - 2 },
            thickness: 0.45,
            color: priority ? palette.aqua : palette.greenDark,
          });
        });
        addLinkAnnotation({
          x: contentX + 14,
          y: cursor + 1,
          width: linkWidth,
          height: measureLines(link.lines) + 6,
          href: link.safeHref,
          label: link.label,
          structure: linkStructure,
        });
      });
    }
    y = bottom - CARD_GAP;
  }

  function drawEverydayGrid(actions) {
    const gap = 11;
    const inset = 18;
    const outcomeWidth = 158;
    const textWidth = CONTENT_WIDTH - (inset * 2) - outcomeWidth - 22;
    for (const [index, action] of actions.entries()) {
      const labelLines = linesFor(
        normalizedText(action?.category).toUpperCase(),
        {
          font: bold,
          size: 6.8,
          width: textWidth,
          lineHeight: 9,
          color: palette.oceanBlue,
        },
      );
      const titleLines = linesFor(action?.title, {
        font: bold,
        size: 12.8,
        width: textWidth,
        lineHeight: 15.3,
        color: palette.navy,
      });
      const bodyLines = linesFor(action?.description, {
        font: regular,
        size: 9.2,
        width: textWidth,
        lineHeight: 12.9,
        color: palette.body,
      });
      const outcomeText = normalizedText(
        action?.outcome
          || "A practical, low-friction step that can improve comfort or reduce avoidable energy use.",
        260,
      );
      const outcomeLabelLines = linesFor("WHY TRY IT", {
        font: bold,
        size: 6.6,
        width: outcomeWidth - 24,
        lineHeight: 8.6,
        color: palette.greenDark,
      });
      const outcomeLines = linesFor(outcomeText, {
        font: regular,
        size: 8.5,
        width: outcomeWidth - 24,
        lineHeight: 11.6,
        color: palette.body,
      });
      const leftHeight = measureLines(labelLines)
        + PDF_LAYOUT.labelTitleGap
        + measureLines(titleLines)
        + PDF_LAYOUT.titleBodyGap
        + measureLines(bodyLines);
      const rightHeight = measureLines(outcomeLabelLines)
        + 4
        + measureLines(outcomeLines);
      const rowHeight = Math.max(leftHeight, rightHeight) + 34;
      ensureSpace(rowHeight + gap, "Energy-saving actions");
      const bottom = y - rowHeight;
      const outcomeX = MARGIN + CONTENT_WIDTH - inset - outcomeWidth;
      pdfTags.artifact(page, () => {
        drawRoundedRectangle(page, {
          x: MARGIN,
          y: bottom,
          width: CONTENT_WIDTH,
          height: rowHeight,
          radius: PDF_LAYOUT.compactRadius,
          color: palette.paper,
          borderColor: palette.line,
          borderWidth: 0.7,
        });
        drawRoundedRectangle(page, {
          x: MARGIN + 10,
          y: bottom + 10,
          width: 5,
          height: rowHeight - 20,
          radius: 2.5,
          color: index % 2 === 0 ? palette.teal : palette.electricBlue,
        });
        drawRoundedRectangle(page, {
          x: outcomeX,
          y: bottom + 12,
          width: outcomeWidth,
          height: rowHeight - 24,
          radius: 7,
          color: palette.mint,
          borderColor: palette.line,
          borderWidth: 0.5,
        });
      });
      let cursor = y - 17;
      pdfTags.mark(page, "P", () => {
        cursor = drawLines(labelLines, {
          x: MARGIN + inset,
          startY: cursor,
          characterSpacing: 0.45,
        });
      }, { actualText: action?.category });
      cursor -= PDF_LAYOUT.labelTitleGap;
      pdfTags.mark(page, "H3", () => {
        cursor = drawLines(titleLines, {
          x: MARGIN + inset,
          startY: cursor,
        });
      }, { actualText: action?.title });
      cursor -= PDF_LAYOUT.titleBodyGap;
      pdfTags.mark(page, "P", () => {
        drawLines(bodyLines, {
          x: MARGIN + inset,
          startY: cursor,
        });
      }, { actualText: action?.description });
      let outcomeCursor = y - 22;
      pdfTags.mark(page, "P", () => {
        outcomeCursor = drawLines(outcomeLabelLines, {
          x: outcomeX + 12,
          startY: outcomeCursor,
          characterSpacing: 0.45,
        });
      }, { actualText: "Why try it" });
      outcomeCursor -= 4;
      pdfTags.mark(page, "P", () => {
        drawLines(outcomeLines, {
          x: outcomeX + 12,
          startY: outcomeCursor,
        });
      }, { actualText: outcomeText });
      y = bottom - gap;
    }
  }

  function drawResourceGrid(resources) {
    const gap = 12;
    const cellWidth = (CONTENT_WIDTH - gap) / 2;
    for (let index = 0; index < resources.length; index += 2) {
      const pair = resources.slice(index, index + 2);
      const prepared = pair.flatMap((resource) => {
        const safeHref = absoluteGuideHref(resource?.href);
        if (!safeHref) return [];
        const sourceLabel = safeHref.startsWith(CUSTOMER_PLAN_PUBLIC_ORIGIN)
          ? "AUSTRALIAN ENERGY ASSESSMENTS"
          : "OFFICIAL RESOURCE";
        const labelLines = linesFor(sourceLabel, {
          font: bold,
          size: 6.8,
          width: cellWidth - 36,
          lineHeight: 9,
          color: palette.oceanBlue,
        });
        const titleLines = linesFor(resource?.label, {
          font: bold,
          size: 12.4,
          width: cellWidth - 36,
          lineHeight: 15.2,
          color: palette.navy,
        });
        const bodyLines = linesFor(resource?.description, {
          font: regular,
          size: 9.2,
          width: cellWidth - 36,
          lineHeight: 13.2,
          color: palette.body,
        });
        const linkLabel = "Open trusted resource";
        const linkLines = linesFor(linkLabel, {
          font: bold,
          size: 8.8,
          width: cellWidth - 36,
          lineHeight: 11.5,
          color: palette.greenDark,
        });
        return [{
          resource,
          safeHref,
          sourceLabel,
          labelLines,
          titleLines,
          bodyLines,
          linkLabel,
          linkLines,
        }];
      });
      const rowHeight = Math.max(
        ...prepared.map((card) =>
          measureLines(card.labelLines)
            + PDF_LAYOUT.labelTitleGap
            + measureLines(card.titleLines)
            + PDF_LAYOUT.titleBodyGap
            + measureLines(card.bodyLines)
            + PDF_LAYOUT.bodyLinkGap
            + measureLines(card.linkLines)
            + (PDF_LAYOUT.panelPaddingY * 2)
        ),
        140,
      );
      ensureSpace(rowHeight + gap, "Trusted resources");
      const bottom = y - rowHeight;
      prepared.forEach((card, pairIndex) => {
        const x = MARGIN + (pairIndex * (cellWidth + gap));
        pdfTags.artifact(page, () => {
          drawRoundedRectangle(page, {
            x,
            y: bottom,
            width: cellWidth,
            height: rowHeight,
            radius: PDF_LAYOUT.compactRadius,
            color: palette.paper,
            borderColor: palette.line,
            borderWidth: 0.7,
          });
          drawRoundedRectangle(page, {
            x: x + 12,
            y: y - 5,
            width: cellWidth - 24,
            height: 5,
            radius: 2.5,
            color: pairIndex === 0 ? palette.teal : palette.electricBlue,
          });
        });
        let cursor = y - PDF_LAYOUT.panelPaddingY;
        pdfTags.mark(page, "P", () => {
          cursor = drawLines(card.labelLines, {
            x: x + 18,
            startY: cursor,
            characterSpacing: 0.45,
          });
        }, { actualText: card.sourceLabel });
        cursor -= PDF_LAYOUT.labelTitleGap;
        pdfTags.mark(page, "H3", () => {
          cursor = drawLines(card.titleLines, {
            x: x + 18,
            startY: cursor,
          });
        }, { actualText: card.resource?.label });
        cursor -= PDF_LAYOUT.titleBodyGap;
        pdfTags.mark(page, "P", () => {
          cursor = drawLines(card.bodyLines, {
            x: x + 18,
            startY: cursor,
          });
        }, { actualText: card.resource?.description });
        cursor -= PDF_LAYOUT.bodyLinkGap;
        const linkTop = cursor;
        const linkStructure = pdfTags.mark(page, "Link", () => {
          cursor = drawLines(card.linkLines, {
            x: x + 18,
            startY: cursor,
          });
        }, { actualText: card.linkLabel });
        const linkWidth = Math.max(...card.linkLines.map((line) =>
          line.font.widthOfTextAtSize(line.text, line.size)
        ));
        pdfTags.artifact(page, () => {
          page.drawLine({
            start: { x: x + 18, y: linkTop - 2 },
            end: { x: x + 18 + linkWidth, y: linkTop - 2 },
            thickness: 0.5,
            color: palette.greenDark,
          });
        });
        addLinkAnnotation({
          x: x + 18,
          y: cursor + 1,
          width: linkWidth,
          height: measureLines(card.linkLines) + 6,
          href: card.safeHref,
          label: card.linkLabel,
          structure: linkStructure,
        });
      });
      y = bottom - gap;
    }
  }

  addCoverPage();
  addContentPage(copy.snapshotEyebrow || "Home snapshot");
  pdfTags.beginSection(copy.snapshotTitle || "Your plan in one view");
  drawSectionHeading(
    copy.snapshotEyebrow || "Your home at a glance",
    copy.snapshotTitle || "Your plan in one view",
  );
  drawSnapshotGrid();
  drawPlanSignalStrip();

  const readiness = report.readinessPresentation || {
    title: report.readiness?.message,
    body: report.readiness?.boundary,
  };
  pageSection = priorityActions.length
    ? copy.startEyebrow || "Start here"
    : copy.completedEyebrow || "Plan progress";
  pdfTags.beginSection("Plan confidence");
  drawInfoPanel({
    eyebrow: copy.readinessEyebrow || "Before you spend",
    title: readiness.title,
    body: readiness.body,
    tone: "mint",
  });

  if (priorityActions.length) {
    if (pages.length === 1 || y < 500) {
      addContentPage(copy.startEyebrow || "Start here");
    }
    pdfTags.beginSection(
      copy.startTitle || "Start with these three moves",
    );
    drawSectionHeading(
      copy.startEyebrow || "Start here",
      copy.startTitle || "Start with these three moves",
      copy.startIntro,
    );
    priorityActions.forEach((action) => drawActionCard(action, true));
  }

  if (laterActions.length) {
    pageSection = priorityActions.length
      ? copy.roadmapEyebrow || "Your plan"
      : copy.completedEyebrow || "Plan progress";
    ensureSpace(650, pageSection);
    pdfTags.beginSection(
      priorityActions.length
        ? copy.roadmapTitle || "Build the rest of your roadmap"
        : copy.completedTitle || "Plan progress",
    );
    drawSectionHeading(
      priorityActions.length
        ? copy.roadmapEyebrow || "Your step-by-step plan"
        : copy.completedEyebrow || "Plan progress",
      priorityActions.length
        ? copy.roadmapTitle || "Build the rest of your roadmap"
        : copy.completedTitle || "Every step in this plan is marked complete",
      priorityActions.length ? copy.roadmapIntro : copy.completedIntro,
    );
    laterActions.forEach((action) => drawActionCard(action, false));
  }

  pageSection = copy.everydayEyebrow || "Easy things to try";
  if (report.everydayActions.length) {
    pdfTags.beginSection(
      copy.everydayTitle || "Comfort wins you can try this week",
    );
    // Keep the section introduction with at least the first useful action.
    // An orphaned heading at the foot of a roadmap page makes the report feel
    // unfinished even when the following page contains the action cards.
    ensureSpace(390, copy.everydayEyebrow || "Quick comfort wins");
    drawSectionHeading(
      copy.everydayEyebrow || "Easy things to try",
      copy.everydayTitle || "Comfort wins you can try this week",
      copy.everydayIntro,
    );
    drawEverydayGrid(report.everydayActions);
    drawInfoPanel({
      body: report.everydayActionsBoundary,
      tone: "mint",
    });
  }

  if (report.climate) {
    pdfTags.beginSection(
      copy.climateEyebrow || "Planning for your climate",
    );
    drawInfoPanel({
      eyebrow: copy.climateEyebrow || "Planning for your climate",
      title: report.climate.label,
      body: report.climate.summary,
      tone: "dark",
    });
  }

  pageSection = "Plan checks";
  ensureSpace(180, pageSection);
  pdfTags.beginSection(copy.whyTitle || "How your priorities were chosen");
  drawSectionHeading(
    copy.whyEyebrow || "Why this order",
    copy.whyTitle || "How your priorities were chosen",
  );
  drawInfoPanel({
    bullets: report.decisionBasis,
    tone: "mint",
  });
  drawInfoPanel({
    eyebrow: "When to review this plan",
    body: report.changeBoundary,
    tone: "cream",
  });

  const professional = report.professionalPresentation;
  if (professional) {
    pdfTags.beginSection("Professional review");
    drawInfoPanel({
      eyebrow: professional.eyebrow,
      title: professional.title,
      body: [
        [professional.role, professional.scheme, professional.reference]
          .filter(Boolean)
          .join(" | "),
        professional.notes ? `Adviser note: ${professional.notes}` : "",
        professional.boundary,
      ].filter(Boolean).join("\n\n"),
      tone: "mint",
    });
  }

  pageSection = copy.tradeEyebrow || "Before you book a trade";
  pdfTags.beginSection(
    copy.tradeTitle || "Three checks that protect your budget",
  );
  ensureSpace(330, pageSection);
  drawSectionHeading(
    copy.tradeEyebrow || "Before you book a trade",
    copy.tradeTitle || "Three checks that protect your budget",
  );
  drawInfoPanel({
    bullets: report.beforeTrade,
    tone: "mint",
  });
  if (report.resources.length) {
    pageSection = "Trusted resources";
    ensureSpace(250, pageSection);
    pdfTags.beginSection("Trusted resources and useful links");
    drawSectionHeading(
      "Useful next steps",
      "Trusted tools and official information",
      "Use these independent tools and government sources to check the plan, current support and next decisions.",
    );
    drawResourceGrid(report.resources);
  }
  pdfTags.beginSection(
    copy.privacyTitle || "Useful detail without exposing private information",
  );
  drawInfoPanel({
    eyebrow: copy.privacyEyebrow || "Private by design",
    title: copy.privacyTitle
      || "Useful detail without exposing private information",
    body: `${normalizedText(report.privacyNote)}\n\n${
      normalizedText(report.adviceBoundary)
    }`,
    tone: "dark",
  });

  const closingAction = planComplete ? null : priorityActions[0];
  pageSection = "What to do next";
  ensureSpace(560, pageSection);
  pdfTags.beginSection(
    closingAction?.title || "Plan progress",
  );
  drawSectionHeading(
    "What to do next",
    "Turn this roadmap into a clear first conversation",
    "Use the first move below, take this report with you and confirm site-specific details before committing to work.",
  );
  drawInfoPanel({
    eyebrow: closingAction ? "Your next move" : "Plan progress",
    title: closingAction?.title
      || (
        planComplete
          ? "Every current step is marked complete"
          : "Use this plan as your project checklist"
      ),
    body: closingAction?.whatToDo || report.changeBoundary,
    tone: "dark",
  });
  drawInfoPanel({
    eyebrow: "Have these ready",
    title: "Prepare once for an assessor or trade",
    bullets: [
      "This report and the home details marked for checking.",
      "Safe, clear photos of existing equipment, model labels and the switchboard where relevant.",
      "Any written owner, agent, strata or owners-corporation approval and the preferred project stage.",
    ],
    tone: "mint",
  });
  drawResourceGrid([
    {
      label: "Compare your electricity options",
      description: "Start the guided electricity comparison when you are ready for the next household cost check.",
      href: "/compare",
    },
    {
      label: "Compare your gas options",
      description: "Use the guided gas comparison if the home still has an active gas account.",
      href: "/gas-compare",
    },
    {
      label: "Check current rebates and assistance",
      description: "Review current support before accepting a quote or ordering equipment.",
      href: "/rebates",
    },
    {
      label: "Estimate certificate or rebate value",
      description: "Use the Australian Energy Assessments calculator for an early, plain-English estimate.",
      href: "/calculator",
    },
  ]);

  pages.forEach((currentPage, index) => {
    pdfTags.artifact(currentPage, () => {
      currentPage.drawRectangle({
        x: 0,
        y: 0,
        width: PAGE_WIDTH,
        height: 40,
        color: palette.navyDeep,
        opacity: index === 0 ? 0.34 : 1,
      });
      currentPage.drawRectangle({
        x: 0,
        y: 40,
        width: PAGE_WIDTH,
        height: 2,
        color: index === 0 ? palette.aqua : palette.teal,
        opacity: 0.82,
      });
      currentPage.drawText(
        fontSafeText(
          copy.footer || "Independent, product-neutral home energy guidance",
          supportedCharacters.get(regular),
        ),
        {
          x: MARGIN,
          y: 17,
          size: 7,
          font: regular,
          color: palette.heroBody,
        },
      );
      const pageLabel = `Page ${index + 1} of ${pages.length}`;
      currentPage.drawText(pageLabel, {
        x: PAGE_WIDTH - MARGIN - bold.widthOfTextAtSize(pageLabel, 7),
        y: 17,
        size: 7,
        font: bold,
        color: palette.aqua,
      });
    });
  });

  pdfTags.finalize();
  return pdf.save();
}
