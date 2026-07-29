import {
  PDFDocument,
  PDFName,
  PDFString,
  PageSizes,
  StandardFonts,
  rgb,
} from "pdf-lib";
import {
  CUSTOMER_PLAN_PUBLIC_ORIGIN,
} from "./customer-plan-document.mjs";

export const CUSTOMER_PLAN_PDF_VERSION =
  "2026-07-29-premium-report-pdf-v3";

const [PAGE_WIDTH, PAGE_HEIGHT] = PageSizes.A4;
const MARGIN = 44;
const CONTENT_WIDTH = PAGE_WIDTH - (MARGIN * 2);
const CONTENT_BOTTOM = 52;
const CARD_GAP = 12;

const palette = Object.freeze({
  navy: rgb(0.024, 0.173, 0.196),
  navyDeep: rgb(0.012, 0.153, 0.196),
  inkSoft: rgb(0.047, 0.294, 0.29),
  green: rgb(0.071, 0.651, 0.416),
  greenDark: rgb(0.031, 0.475, 0.298),
  teal: rgb(0.125, 0.847, 0.757),
  mint: rgb(0.929, 0.973, 0.957),
  mintStrong: rgb(0.875, 0.953, 0.922),
  white: rgb(1, 1, 1),
  canvas: rgb(0.933, 0.961, 0.949),
  text: rgb(0.094, 0.2, 0.173),
  body: rgb(0.247, 0.365, 0.329),
  muted: rgb(0.4, 0.478, 0.447),
  line: rgb(0.843, 0.898, 0.875),
  cream: rgb(1, 0.969, 0.898),
  creamLine: rgb(0.91, 0.776, 0.435),
  creamText: rgb(0.427, 0.325, 0.082),
  seaGlass: rgb(0.729, 0.902, 0.839),
  heroBody: rgb(0.827, 0.925, 0.902),
});

const FONT_FALLBACKS = new Map([
  ["\u2010", "-"],
  ["\u2011", "-"],
  ["\u2012", "-"],
  ["\u2013", "-"],
  ["\u2014", "-"],
  ["\u2018", "'"],
  ["\u2019", "'"],
  ["\u201c", "\""],
  ["\u201d", "\""],
  ["\u2022", "-"],
  ["\u2026", "..."],
]);

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
  ]) {
    if (!Array.isArray(value[field]) || value[field].length > maximum) {
      throw new TypeError(
        "A bounded privacy-filtered customer plan report is required.",
      );
    }
  }
  return value;
}

function reportDate(value) {
  const supplied = normalizedText(value, 20);
  return /^\d{4}-\d{2}-\d{2}$/.test(supplied) ? supplied : "";
}

export function customerPlanPdfFileName(report) {
  const normalizedReport = requiredReport(report);
  const preparedDate = reportDate(normalizedReport.preparedDate);
  return preparedDate
    ? `home-energy-plan-${preparedDate}.pdf`
    : "home-energy-plan.pdf";
}

function absoluteGuideHref(value) {
  const supplied = normalizedText(value, 240).trim();
  if (!supplied) return "";
  try {
    const origin = new URL(CUSTOMER_PLAN_PUBLIC_ORIGIN);
    const resolved = new URL(supplied, origin);
    return resolved.origin === origin.origin ? resolved.toString() : "";
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

function fontSafeText(value, font, supportedCharacters) {
  return Array.from(normalizedText(value)).map((character) => {
    if (character === "\n") return character;
    const codePoint = character.codePointAt(0);
    if (supportedCharacters.has(codePoint)) return character;
    const approximation = character
      .normalize("NFD")
      .replace(/\p{Mark}/gu, "");
    if (
      approximation
      && approximation !== character
      && Array.from(approximation).every((part) =>
        supportedCharacters.has(part.codePointAt(0))
      )
    ) {
      return approximation;
    }
    const fallback = FONT_FALLBACKS.get(character) || "?";
    return Array.from(fallback).every((part) =>
      supportedCharacters.has(part.codePointAt(0))
    )
      ? fallback
      : "";
  }).join("");
}

function wrapText(font, size, value, maximumWidth, supportedCharacters) {
  const supplied = fontSafeText(value, font, supportedCharacters);
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

export async function createCustomerPlanPdfBytes(suppliedReport) {
  const report = requiredReport(suppliedReport);
  const copy = report.copy || {};
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const serif = await pdf.embedFont(StandardFonts.TimesRoman);
  const serifBold = await pdf.embedFont(StandardFonts.TimesRomanBold);
  const supportedCharacters = new Map(
    [regular, bold, serif, serifBold].map((font) => [
      font,
      new Set(font.getCharacterSet()),
    ]),
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

  pdf.setTitle(normalizedText(report.heading, 180));
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

  function addLinkAnnotation({ x, y: linkY, width, height, href }) {
    const safeHref = absoluteGuideHref(href);
    if (!safeHref || width <= 0 || height <= 0) return;
    const annotation = pdf.context.register(pdf.context.obj({
      Type: PDFName.of("Annot"),
      Subtype: PDFName.of("Link"),
      Rect: [x, linkY, x + width, linkY + height],
      Border: [0, 0, 0],
      A: {
        Type: PDFName.of("Action"),
        S: PDFName.of("URI"),
        URI: PDFString.of(safeHref),
      },
    }));
    page.node.addAnnot(annotation);
  }

  function addContentPage(section = "") {
    pageSection = normalizedText(section, 80);
    page = pdf.addPage(PageSizes.A4);
    pages.push(page);
    page.drawRectangle({
      x: 0,
      y: 0,
      width: PAGE_WIDTH,
      height: PAGE_HEIGHT,
      color: palette.white,
    });
    page.drawRectangle({
      x: 0,
      y: PAGE_HEIGHT - 7,
      width: PAGE_WIDTH,
      height: 7,
      color: palette.teal,
    });
    page.drawText("AUSTRALIAN ENERGY ASSESSMENTS", {
      x: MARGIN,
      y: PAGE_HEIGHT - 31,
      size: 7.2,
      font: bold,
      color: palette.greenDark,
      characterSpacing: 0.75,
    });
    if (pageSection) {
      const safeSection = fontSafeText(
        pageSection.toUpperCase(),
        regular,
        supportedCharacters.get(regular),
      );
      page.drawText(safeSection, {
        x: PAGE_WIDTH
          - MARGIN
          - regular.widthOfTextAtSize(safeSection, 7.2),
        y: PAGE_HEIGHT - 31,
        size: 7.2,
        font: regular,
        color: palette.muted,
        characterSpacing: 0.55,
      });
    }
    page.drawLine({
      start: { x: MARGIN, y: PAGE_HEIGHT - 42 },
      end: { x: PAGE_WIDTH - MARGIN, y: PAGE_HEIGHT - 42 },
      thickness: 0.75,
      color: palette.line,
    });
    y = PAGE_HEIGHT - 67;
  }

  function addCoverPage() {
    pageSection = "";
    page = pdf.addPage(PageSizes.A4);
    pages.push(page);
    page.drawRectangle({
      x: 0,
      y: 0,
      width: PAGE_WIDTH,
      height: PAGE_HEIGHT,
      color: palette.white,
    });
    page.drawRectangle({
      x: 0,
      y: PAGE_HEIGHT - 334,
      width: PAGE_WIDTH,
      height: 334,
      color: palette.navy,
    });
    page.drawRectangle({
      x: 0,
      y: PAGE_HEIGHT - 341,
      width: PAGE_WIDTH,
      height: 7,
      color: palette.teal,
    });

    page.drawRectangle({
      x: MARGIN,
      y: PAGE_HEIGHT - 74,
      width: 42,
      height: 42,
      color: palette.white,
      opacity: 0.13,
      borderColor: palette.seaGlass,
      borderWidth: 0.8,
    });
    page.drawText("AEA", {
      x: MARGIN + 8,
      y: PAGE_HEIGHT - 58,
      size: 10,
      font: bold,
      color: palette.white,
      characterSpacing: 0.6,
    });
    page.drawText("AUSTRALIAN ENERGY ASSESSMENTS", {
      x: MARGIN + 54,
      y: PAGE_HEIGHT - 51,
      size: 8.4,
      font: bold,
      color: palette.teal,
      characterSpacing: 0.95,
    });
    page.drawText(
      fontSafeText(
        report.displayDate || preparedDate,
        regular,
        supportedCharacters.get(regular),
      ),
      {
        x: PAGE_WIDTH - MARGIN - regular.widthOfTextAtSize(
          fontSafeText(
            report.displayDate || preparedDate,
            regular,
            supportedCharacters.get(regular),
          ),
          8.2,
        ),
        y: PAGE_HEIGHT - 51,
        size: 8.2,
        font: regular,
        color: palette.heroBody,
      },
    );

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
    drawLines(eyebrowLines, {
      startY: PAGE_HEIGHT - 114,
      characterSpacing: 0.9,
    });
    const titleLines = linesFor(
      copy.heroTitle || "A clearer path to a more comfortable home",
      {
        font: serifBold,
        size: 31,
        width: CONTENT_WIDTH - 18,
        lineHeight: 34,
        color: palette.white,
      },
    ).slice(0, 3);
    const titleBottom = drawLines(titleLines, {
      startY: PAGE_HEIGHT - 141,
    });
    const planTitleLines = linesFor(report.planTitle, {
      font: regular,
      size: 13.2,
      width: CONTENT_WIDTH - 18,
      lineHeight: 19,
      color: palette.heroBody,
    }).slice(0, 2);
    const planTitleBottom = drawLines(planTitleLines, {
      startY: titleBottom - 7,
    });
    const summaryLines = linesFor(report.summary, {
      font: regular,
      size: 10,
      width: CONTENT_WIDTH - 18,
      lineHeight: 14.5,
      color: palette.heroBody,
    }).slice(0, 4);
    drawLines(summaryLines, {
      startY: planTitleBottom - 5,
    });
    y = PAGE_HEIGHT - 376;
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
      color: palette.greenDark,
    });
    const titleLines = linesFor(title, {
      font: serifBold,
      size: 21,
      width: CONTENT_WIDTH,
      lineHeight: 24,
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
    y = drawLines(eyebrowLines, { startY: y, characterSpacing: 0.65 });
    y -= 12;
    y = drawLines(titleLines, { startY: y });
    if (introLines.length) {
      y -= 4;
      y = drawLines(introLines, { startY: y });
    }
    y -= 14;
  }

  function drawSnapshotGrid() {
    const cellGap = 10;
    const cellWidth = (CONTENT_WIDTH - cellGap) / 2;
    for (
      let index = 0;
      index < report.planningSnapshot.length;
      index += 2
    ) {
      const pair = report.planningSnapshot.slice(index, index + 2);
      const prepared = pair.map((item) => {
        const labelLines = linesFor(normalizedText(item?.label).toUpperCase(), {
          font: bold,
          size: 7.2,
          width: cellWidth - 28,
          lineHeight: 9.5,
          color: palette.greenDark,
        });
        const valueLines = linesFor(item?.value, {
          font: regular,
          size: 10,
          width: cellWidth - 28,
          lineHeight: 14.5,
          color: palette.text,
        });
        return { labelLines, valueLines };
      });
      const rowHeight = Math.max(
        ...prepared.map(({ labelLines, valueLines }) =>
          26 + measureLines(labelLines) + 5 + measureLines(valueLines)
        ),
        72,
      );
      ensureSpace(rowHeight + cellGap);
      prepared.forEach(({ labelLines, valueLines }, pairIndex) => {
        const x = MARGIN + (pairIndex * (cellWidth + cellGap));
        const bottom = y - rowHeight;
        page.drawRectangle({
          x,
          y: bottom,
          width: cellWidth,
          height: rowHeight,
          color: palette.mint,
          borderColor: palette.line,
          borderWidth: 0.8,
        });
        let cursor = y - 17;
        cursor = drawLines(labelLines, {
          x: x + 14,
          startY: cursor,
          characterSpacing: 0.5,
        });
        cursor -= 5;
        drawLines(valueLines, { x: x + 14, startY: cursor });
      });
      y -= rowHeight + cellGap;
    }
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
        : palette.mint;
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
    const innerWidth = CONTENT_WIDTH - 36;
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
        font: serifBold,
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
    const bulletLines = bullets.flatMap((item) => linesFor(
      `- ${normalizedText(item)}`,
      {
        font: regular,
        size: 9.5,
        width: innerWidth - 5,
        lineHeight: 13.5,
        color: bodyColor,
      },
    ));
    const contentHeight = measureLines(eyebrowLines)
      + (eyebrowLines.length && titleLines.length ? 4 : 0)
      + measureLines(titleLines)
      + (bodyLines.length && (titleLines.length || eyebrowLines.length) ? 5 : 0)
      + measureLines(bodyLines)
      + (bulletLines.length ? 5 : 0)
      + measureLines(bulletLines);
    const height = Math.max(58, contentHeight + 30);
    ensureSpace(height + CARD_GAP);
    const bottom = y - height;
    page.drawRectangle({
      x: MARGIN,
      y: bottom,
      width: CONTENT_WIDTH,
      height,
      color: fill,
      borderColor: border,
      borderWidth: 0.8,
    });
    page.drawRectangle({
      x: MARGIN,
      y: bottom,
      width: 5,
      height,
      color: tone === "cream" ? palette.creamLine : palette.teal,
    });
    let cursor = y - 18;
    if (eyebrowLines.length) {
      cursor = drawLines(eyebrowLines, {
        x: MARGIN + 18,
        startY: cursor,
        characterSpacing: 0.55,
      });
    }
    if (titleLines.length) {
      if (eyebrowLines.length) cursor -= 4;
      cursor = drawLines(titleLines, {
        x: MARGIN + 18,
        startY: cursor,
      });
    }
    if (bodyLines.length) {
      if (titleLines.length || eyebrowLines.length) cursor -= 5;
      cursor = drawLines(bodyLines, {
        x: MARGIN + 18,
        startY: cursor,
      });
    }
    if (bulletLines.length) {
      cursor -= 5;
      drawLines(bulletLines, {
        x: MARGIN + 22,
        startY: cursor,
      });
    }
    y = bottom - CARD_GAP;
  }

  function drawActionCard(action, priority = false) {
    const numberLabel = action?.completed
      ? "DONE"
      : String(Number(action?.number) || 1).padStart(2, "0");
    const numberWidth = 44;
    const innerX = MARGIN + numberWidth + 24;
    const innerWidth = CONTENT_WIDTH - numberWidth - 42;
    const stageText = priority
      ? `START HERE | ${normalizedText(action?.stage)}`
      : normalizedText(action?.stage);
    const stageLines = linesFor(stageText.toUpperCase(), {
      font: bold,
      size: 7.1,
      width: innerWidth,
      lineHeight: 9.5,
      color: palette.greenDark,
    });
    const titleLines = linesFor(action?.title, {
      font: serifBold,
      size: priority ? 15.5 : 14.2,
      width: innerWidth,
      lineHeight: priority ? 18.5 : 17,
      color: palette.navy,
    });
    const bodyLines = linesFor(action?.description, {
      font: regular,
      size: 10,
      width: innerWidth,
      lineHeight: 14.5,
      color: palette.body,
    });
    const safeHref = absoluteGuideHref(action?.guideHref);
    const linkLabel = normalizedText(
      action?.guideLabel || copy.guideLabel || "Open the helpful guide",
      140,
    );
    const linkLines = safeHref
      ? linesFor(linkLabel, {
        font: bold,
        size: 9.2,
        width: innerWidth,
        lineHeight: 12.5,
        color: palette.greenDark,
      })
      : [];
    const contentHeight = measureLines(stageLines)
      + 4
      + measureLines(titleLines)
      + 5
      + measureLines(bodyLines)
      + (linkLines.length ? 8 + measureLines(linkLines) : 0);
    const height = Math.max(86, contentHeight + 30);
    ensureSpace(height + CARD_GAP, priority ? "Start here" : "Your plan");
    const bottom = y - height;
    page.drawRectangle({
      x: MARGIN,
      y: bottom,
      width: CONTENT_WIDTH,
      height,
      color: priority ? palette.mint : palette.white,
      borderColor: priority ? palette.seaGlass : palette.line,
      borderWidth: priority ? 1.4 : 0.8,
    });
    if (priority) {
      page.drawRectangle({
        x: MARGIN,
        y: bottom,
        width: 5,
        height,
        color: palette.teal,
      });
    }
    page.drawRectangle({
      x: MARGIN + 16,
      y: y - 58,
      width: numberWidth,
      height: 40,
      color: action?.completed ? palette.greenDark : palette.navy,
    });
    const safeNumber = fontSafeText(
      numberLabel,
      bold,
      supportedCharacters.get(bold),
    );
    page.drawText(safeNumber, {
      x: MARGIN + 16
        + ((numberWidth - bold.widthOfTextAtSize(safeNumber, 9)) / 2),
      y: y - 42,
      size: 9,
      font: bold,
      color: palette.white,
    });
    let cursor = y - 19;
    cursor = drawLines(stageLines, {
      x: innerX,
      startY: cursor,
      characterSpacing: 0.45,
    });
    cursor -= 4;
    cursor = drawLines(titleLines, { x: innerX, startY: cursor });
    cursor -= 5;
    cursor = drawLines(bodyLines, { x: innerX, startY: cursor });
    if (linkLines.length) {
      cursor -= 8;
      const linkTop = cursor;
      cursor = drawLines(linkLines, { x: innerX, startY: cursor });
      const linkWidth = Math.min(
        innerWidth,
        Math.max(...linkLines.map((line) =>
          line.font.widthOfTextAtSize(line.text, line.size)
        )),
      );
      page.drawLine({
        start: { x: innerX, y: linkTop - 2 },
        end: { x: innerX + linkWidth, y: linkTop - 2 },
        thickness: 0.5,
        color: palette.greenDark,
      });
      addLinkAnnotation({
        x: innerX,
        y: cursor + 1,
        width: linkWidth,
        height: measureLines(linkLines) + 6,
        href: safeHref,
      });
    }
    y = bottom - CARD_GAP;
  }

  function drawEverydayCard(action) {
    const labelLines = linesFor(normalizedText(action?.category).toUpperCase(), {
      font: bold,
      size: 7.1,
      width: CONTENT_WIDTH - 36,
      lineHeight: 9.5,
      color: palette.greenDark,
    });
    const titleLines = linesFor(action?.title, {
      font: serifBold,
      size: 14.5,
      width: CONTENT_WIDTH - 36,
      lineHeight: 17.5,
      color: palette.navy,
    });
    const bodyLines = linesFor(action?.description, {
      font: regular,
      size: 10,
      width: CONTENT_WIDTH - 36,
      lineHeight: 14.5,
      color: palette.body,
    });
    const height = measureLines(labelLines)
      + 4
      + measureLines(titleLines)
      + 5
      + measureLines(bodyLines)
      + 28;
    ensureSpace(height + 8, "Easy things to try");
    const bottom = y - height;
    page.drawRectangle({
      x: MARGIN,
      y: bottom,
      width: CONTENT_WIDTH,
      height,
      color: palette.mint,
      borderColor: palette.line,
      borderWidth: 0.7,
    });
    page.drawRectangle({
      x: MARGIN,
      y: bottom,
      width: 5,
      height,
      color: palette.green,
    });
    let cursor = y - 17;
    cursor = drawLines(labelLines, {
      x: MARGIN + 18,
      startY: cursor,
      characterSpacing: 0.5,
    });
    cursor -= 4;
    cursor = drawLines(titleLines, {
      x: MARGIN + 18,
      startY: cursor,
    });
    cursor -= 5;
    drawLines(bodyLines, {
      x: MARGIN + 18,
      startY: cursor,
    });
    y = bottom - 8;
  }

  addCoverPage();
  drawSectionHeading(
    copy.snapshotEyebrow || "Your home at a glance",
    copy.snapshotTitle || "The choices shaping this plan",
  );
  drawSnapshotGrid();

  const readiness = report.readinessPresentation || {
    title: report.readiness?.message,
    body: report.readiness?.boundary,
  };
  const priorityActions = Array.isArray(report.priorityActions)
    ? report.priorityActions
    : report.actions.filter((action) => action?.priority);
  const laterActions = Array.isArray(report.laterActions)
    ? report.laterActions
    : report.actions.filter((action) => !action?.priority);
  pageSection = priorityActions.length
    ? copy.startEyebrow || "Start here"
    : copy.completedEyebrow || "Plan progress";
  drawInfoPanel({
    eyebrow: copy.readinessEyebrow || "Before you spend",
    title: readiness.title,
    body: [
      readiness.body,
      report.readiness?.boundary,
    ].filter(Boolean).join("\n\n"),
    tone: report.questions.length ? "cream" : "mint",
  });

  if (priorityActions.length) {
    if (pages.length === 1 || y < 500) {
      addContentPage(copy.startEyebrow || "Start here");
    }
    drawSectionHeading(
      copy.startEyebrow || "Start here",
      copy.startTitle || "Your first three steps",
      copy.startIntro,
    );
    priorityActions.forEach((action) => drawActionCard(action, true));
  }

  if (laterActions.length) {
    pageSection = priorityActions.length
      ? copy.roadmapEyebrow || "Your plan"
      : copy.completedEyebrow || "Plan progress";
    drawSectionHeading(
      priorityActions.length
        ? copy.roadmapEyebrow || "Your step-by-step plan"
        : copy.completedEyebrow || "Plan progress",
      priorityActions.length
        ? copy.roadmapTitle || "What to consider next"
        : copy.completedTitle || "Every step in this plan is marked complete",
      priorityActions.length ? copy.roadmapIntro : copy.completedIntro,
    );
    laterActions.forEach((action) => drawActionCard(action, false));
  }

  pageSection = copy.everydayEyebrow || "Easy things to try";
  if (y < 520) addContentPage(copy.everydayEyebrow || "Easy things to try");
  if (report.everydayActions.length) {
    drawSectionHeading(
      copy.everydayEyebrow || "Easy things to try",
      copy.everydayTitle || "Small comfort wins for everyday life",
      copy.everydayIntro,
    );
    report.everydayActions.forEach((action) => drawEverydayCard(action));
    drawInfoPanel({
      body: report.everydayActionsBoundary,
      tone: "mint",
    });
  }

  if (report.climate) {
    drawInfoPanel({
      eyebrow: copy.climateEyebrow || "Planning for your climate",
      title: report.climate.label,
      body: report.climate.summary,
      tone: "dark",
    });
  }

  pageSection = "Plan checks";
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

  if (report.questions.length) {
    drawInfoPanel({
      eyebrow: "Home details to check",
      title: `${report.questions.length} answer${
        report.questions.length === 1 ? "" : "s"
      } could make this plan more precise`,
      bullets: report.questions.map((question) =>
        `${normalizedText(question?.prompt)}: ${
          normalizedText(question?.whyItMatters)
        }`
      ),
      tone: "cream",
    });
  }

  const professional = report.professionalPresentation;
  if (professional) {
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
  drawSectionHeading(
    copy.tradeEyebrow || "Before you book a trade",
    copy.tradeTitle || "Three checks that protect your budget",
  );
  drawInfoPanel({
    bullets: report.beforeTrade,
    tone: "mint",
  });
  drawInfoPanel({
    eyebrow: copy.privacyEyebrow || "Private by design",
    title: copy.privacyTitle
      || "Useful detail without exposing private information",
    body: `${normalizedText(report.privacyNote)}\n\n${
      normalizedText(report.adviceBoundary)
    }`,
    tone: "dark",
  });

  pages.forEach((currentPage, index) => {
    currentPage.drawLine({
      start: { x: MARGIN, y: 34 },
      end: { x: PAGE_WIDTH - MARGIN, y: 34 },
      thickness: 0.7,
      color: palette.line,
    });
    currentPage.drawText(
      fontSafeText(
        copy.footer || "Independent, product-neutral home energy guidance",
        regular,
        supportedCharacters.get(regular),
      ),
      {
        x: MARGIN,
        y: 19,
        size: 6.8,
        font: regular,
        color: palette.muted,
      },
    );
    const pageLabel = `Page ${index + 1} of ${pages.length}`;
    currentPage.drawText(pageLabel, {
      x: PAGE_WIDTH - MARGIN - regular.widthOfTextAtSize(pageLabel, 6.8),
      y: 19,
      size: 6.8,
      font: regular,
      color: palette.muted,
    });
  });

  return pdf.save();
}
