import fontkit from "@pdf-lib/fontkit";
import {
  PDFDocument,
  PageSizes,
  rgb,
} from "pdf-lib";
import {
  CUSTOMER_PLAN_PUBLIC_ORIGIN,
} from "./customer-plan-document.mjs";

export const CUSTOMER_PLAN_PDF_VERSION =
  "2026-07-29-direct-download-pdf-v1";

const [PAGE_WIDTH, PAGE_HEIGHT] = PageSizes.A4;
const MARGIN = 42;
const CONTENT_WIDTH = PAGE_WIDTH - (MARGIN * 2);
const CONTENT_BOTTOM = 50;
const CARD_GAP = 10;
const CONTINUATION_MINIMUM_SPACE = 120;

const palette = {
  navyDark: rgb(0.018, 0.122, 0.184),
  green: rgb(0.039, 0.455, 0.333),
  teal: rgb(0.078, 0.678, 0.541),
  mint: rgb(0.925, 0.969, 0.953),
  cream: rgb(1, 0.973, 0.906),
  creamBorder: rgb(0.882, 0.749, 0.376),
  ink: rgb(0.075, 0.216, 0.176),
  body: rgb(0.239, 0.365, 0.325),
  muted: rgb(0.376, 0.475, 0.439),
  border: rgb(0.761, 0.851, 0.816),
  white: rgb(1, 1, 1),
  pale: rgb(0.969, 0.988, 0.98),
  darkBody: rgb(0.855, 0.922, 0.906),
};

function normalizedText(value, maximum = 8_000) {
  const supplied = String(value ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/\t/g, " ")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .normalize("NFC");
  return Array.from(supplied).slice(0, maximum).join("");
}

function requiredFontBytes(value, label) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  throw new TypeError(`${label} must be supplied as font bytes.`);
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

function wrapText(font, size, value, maximumWidth, supportedCharacters) {
  const supplied = Array.from(normalizedText(value)).map((character) => {
    if (character === "\n") return character;
    const codePoint = character.codePointAt(0);
    if (supportedCharacters.has(codePoint)) return character;
    const decomposed = character.normalize("NFD");
    if (
      decomposed !== character
      && Array.from(decomposed).every((part) =>
        supportedCharacters.has(part.codePointAt(0))
      )
    ) {
      return decomposed;
    }
    throw new Error(
      `The supplied PDF font does not support U+${
        codePoint.toString(16).toUpperCase().padStart(4, "0")
      }.`,
    );
  }).join("");

  const lines = [];
  const paragraphs = supplied.split("\n");
  for (const paragraph of paragraphs) {
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

function lineHeightTotal(lines) {
  return lines.reduce(
    (total, line) => total + line.gapBefore + line.lineHeight,
    0,
  );
}

function appendLineGroup(target, lines, gapBefore = 0) {
  lines.forEach((line, index) => {
    target.push({
      ...line,
      gapBefore: index === 0 ? gapBefore : 0,
    });
  });
}

export async function createCustomerPlanPdfBytes(
  suppliedReport,
  {
    regularFontBytes,
    boldFontBytes,
  } = {},
) {
  const report = requiredReport(suppliedReport);
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const regular = await pdf.embedFont(
    requiredFontBytes(regularFontBytes, "regularFontBytes"),
    { subset: true },
  );
  const bold = await pdf.embedFont(
    requiredFontBytes(boldFontBytes, "boldFontBytes"),
    { subset: true },
  );
  const fontCharacters = new Map([
    [regular, new Set(regular.getCharacterSet())],
    [bold, new Set(bold.getCharacterSet())],
  ]);
  const pages = [];
  let page;
  let y;

  const textLines = (
    font,
    size,
    value,
    width,
    {
      color = palette.body,
      lineHeight = size * 1.4,
      xOffset = 0,
      underline = false,
    } = {},
  ) => wrapText(
    font,
    size,
    value,
    width,
    fontCharacters.get(font),
  ).map((text) => ({
    text,
    font,
    size,
    color,
    lineHeight,
    xOffset,
    underline,
    gapBefore: 0,
  }));

  pdf.setTitle(normalizedText(report.heading, 180));
  pdf.setAuthor("Australian Energy Assessments");
  pdf.setSubject("Independent home energy planning roadmap");
  pdf.setCreator("Australian Energy Assessments");
  pdf.setProducer("Australian Energy Assessments");
  pdf.setKeywords([
    "home energy plan",
    "Australian Energy Assessments",
    CUSTOMER_PLAN_PDF_VERSION,
  ]);
  const preparedDate = reportDate(report.preparedDate);
  if (preparedDate) {
    const metadataDate = new Date(`${preparedDate}T00:00:00.000Z`);
    pdf.setCreationDate(metadataDate);
    pdf.setModificationDate(metadataDate);
  }

  function addPage(first = false) {
    page = pdf.addPage(PageSizes.A4);
    pages.push(page);
    page.drawRectangle({
      x: 0,
      y: 0,
      width: PAGE_WIDTH,
      height: PAGE_HEIGHT,
      color: palette.white,
    });
    if (first) {
      page.drawRectangle({
        x: 0,
        y: PAGE_HEIGHT - 118,
        width: PAGE_WIDTH,
        height: 118,
        color: palette.navyDark,
      });
      page.drawRectangle({
        x: 0,
        y: PAGE_HEIGHT - 123,
        width: PAGE_WIDTH,
        height: 5,
        color: palette.teal,
      });
      page.drawText("AUSTRALIAN ENERGY ASSESSMENTS", {
        x: MARGIN,
        y: PAGE_HEIGHT - 34,
        size: 8,
        font: bold,
        color: rgb(0.39, 0.93, 0.8),
        characterSpacing: 1.1,
      });
      const headingLines = textLines(
        bold,
        24,
        report.heading,
        CONTENT_WIDTH - 120,
        {
          color: palette.white,
          lineHeight: 26,
        },
      ).slice(0, 2);
      headingLines.forEach((line, index) => {
        page.drawText(line.text, {
          x: MARGIN,
          y: PAGE_HEIGHT - 62 - (index * 26),
          size: line.size,
          font: line.font,
          color: line.color,
        });
      });
      const preparedLabel = preparedDate
        ? `Prepared ${preparedDate}`
        : "Independent planning copy";
      page.drawText(preparedLabel, {
        x: PAGE_WIDTH - MARGIN
          - regular.widthOfTextAtSize(preparedLabel, 8),
        y: PAGE_HEIGHT - 35,
        size: 8,
        font: regular,
        color: rgb(0.78, 0.88, 0.9),
      });
      y = PAGE_HEIGHT - 146;
      return;
    }
    page.drawText("AUSTRALIAN ENERGY ASSESSMENTS", {
      x: MARGIN,
      y: PAGE_HEIGHT - 31,
      size: 7.5,
      font: bold,
      color: palette.green,
      characterSpacing: 0.8,
    });
    page.drawLine({
      start: { x: MARGIN, y: PAGE_HEIGHT - 40 },
      end: { x: PAGE_WIDTH - MARGIN, y: PAGE_HEIGHT - 40 },
      thickness: 1,
      color: palette.border,
    });
    y = PAGE_HEIGHT - 61;
  }

  function ensureSpace(requiredHeight) {
    if (y - requiredHeight >= CONTENT_BOTTOM) return;
    addPage(false);
  }

  function drawFreeText(
    value,
    {
      font = regular,
      size = 9.2,
      color = palette.body,
      lineHeight = 13,
      width = CONTENT_WIDTH,
      x = MARGIN,
      after = 8,
    } = {},
  ) {
    const lines = textLines(font, size, value, width, {
      color,
      lineHeight,
    });
    for (const line of lines) {
      ensureSpace(line.lineHeight);
      if (line.text) {
        page.drawText(line.text, {
          x,
          y,
          size: line.size,
          font: line.font,
          color: line.color,
        });
      }
      y -= line.lineHeight;
    }
    y -= after;
  }

  function drawSectionTitle(eyebrow, title, description = "") {
    const eyebrowLines = textLines(
      bold,
      7.2,
      normalizedText(eyebrow).toUpperCase(),
      CONTENT_WIDTH,
      {
        color: palette.green,
        lineHeight: 10,
      },
    );
    const titleLines = textLines(bold, 18, title, CONTENT_WIDTH, {
      color: palette.ink,
      lineHeight: 21,
    });
    const descriptionLines = description
      ? textLines(regular, 8.5, description, CONTENT_WIDTH, {
        color: palette.muted,
        lineHeight: 12,
      })
      : [];
    const height = lineHeightTotal(eyebrowLines)
      + 4
      + lineHeightTotal(titleLines)
      + (descriptionLines.length
        ? 2 + lineHeightTotal(descriptionLines)
        : 0)
      + 10;
    ensureSpace(height);
    for (const line of eyebrowLines) {
      if (line.text) {
        page.drawText(line.text, {
          x: MARGIN,
          y,
          size: line.size,
          font: line.font,
          color: line.color,
          characterSpacing: 0.6,
        });
      }
      y -= line.lineHeight;
    }
    y -= 4;
    for (const line of titleLines) {
      if (line.text) {
        page.drawText(line.text, {
          x: MARGIN,
          y,
          size: line.size,
          font: line.font,
          color: line.color,
        });
      }
      y -= line.lineHeight;
    }
    if (descriptionLines.length) y -= 2;
    for (const line of descriptionLines) {
      if (line.text) {
        page.drawText(line.text, {
          x: MARGIN,
          y,
          size: line.size,
          font: line.font,
          color: line.color,
        });
      }
      y -= line.lineHeight;
    }
    y -= 10;
  }

  function drawCard({
    eyebrow = "",
    title = "",
    body = "",
    bullets = [],
    linkLabel = "",
    linkHref = "",
    fill = palette.pale,
    border = palette.border,
    accent = palette.green,
    priority = false,
    eyebrowColor = accent,
    titleColor = palette.ink,
    bodyColor = palette.body,
    linkColor = palette.green,
  }) {
    const innerWidth = CONTENT_WIDTH - 28;
    const contentLines = [];
    const eyebrowLines = eyebrow
      ? textLines(
        bold,
        7.2,
        normalizedText(eyebrow).toUpperCase(),
        innerWidth,
        {
          color: eyebrowColor,
          lineHeight: 10,
        },
      )
      : [];
    const titleLines = title
      ? textLines(
        bold,
        priority ? 15 : 13.5,
        title,
        innerWidth,
        {
          color: titleColor,
          lineHeight: priority ? 18 : 16,
        },
      )
      : [];
    const bodyLines = body
      ? textLines(regular, 8.5, body, innerWidth, {
        color: bodyColor,
        lineHeight: 12,
      })
      : [];
    const bulletLines = (Array.isArray(bullets) ? bullets : []).flatMap(
      (item) => textLines(
        regular,
        8.2,
        `- ${normalizedText(item)}`,
        innerWidth - 4,
        {
          color: bodyColor,
          lineHeight: 11,
          xOffset: 4,
        },
      ),
    );
    const suppliedHref = absoluteGuideHref(linkHref);
    const linkLines = suppliedHref
      ? textLines(
        regular,
        7.2,
        `${normalizedText(linkLabel) || "Related guide"}: ${suppliedHref}`,
        innerWidth,
        {
          color: linkColor,
          lineHeight: 10,
          underline: true,
        },
      )
      : [];
    appendLineGroup(contentLines, eyebrowLines);
    appendLineGroup(
      contentLines,
      titleLines,
      eyebrowLines.length ? 3 : 0,
    );
    appendLineGroup(
      contentLines,
      bodyLines,
      titleLines.length ? 5 : 0,
    );
    appendLineGroup(
      contentLines,
      bulletLines,
      bodyLines.length ? 5 : 0,
    );
    appendLineGroup(
      contentLines,
      linkLines,
      linkLines.length ? 7 : 0,
    );

    const continuationTitle = normalizedText(
      title || eyebrow || "Plan detail",
      180,
    );
    const continuationLines = () => textLines(
      bold,
      10.5,
      `${continuationTitle} (continued)`,
      innerWidth,
      {
        color: titleColor,
        lineHeight: 13,
      },
    );

    const drawChunk = (lines) => {
      const height = Math.max(42, lineHeightTotal(lines) + 26);
      const cardBottom = y - height;
      page.drawRectangle({
        x: MARGIN,
        y: cardBottom,
        width: CONTENT_WIDTH,
        height,
        color: fill,
        borderColor: border,
        borderWidth: priority ? 1.6 : 0.8,
      });
      if (priority) {
        page.drawRectangle({
          x: MARGIN,
          y: cardBottom,
          width: 4,
          height,
          color: accent,
        });
      }
      let textY = y - 15;
      for (const line of lines) {
        textY -= line.gapBefore;
        if (line.text) {
          const textX = MARGIN + 14 + line.xOffset;
          page.drawText(line.text, {
            x: textX,
            y: textY,
            size: line.size,
            font: line.font,
            color: line.color,
          });
          if (line.underline) {
            page.drawLine({
              start: { x: textX, y: textY - 1.5 },
              end: {
                x: textX + line.font.widthOfTextAtSize(line.text, line.size),
                y: textY - 1.5,
              },
              thickness: 0.4,
              color: line.color,
            });
          }
        }
        textY -= line.lineHeight;
      }
      y = cardBottom - CARD_GAP;
    };

    const totalHeight = Math.max(42, lineHeightTotal(contentLines) + 26);
    const fullPageCardHeight = (PAGE_HEIGHT - 61) - CONTENT_BOTTOM;
    if (totalHeight <= fullPageCardHeight) {
      ensureSpace(totalHeight + CARD_GAP);
      drawChunk(contentLines);
      return;
    }

    let remainingLines = [...contentLines];
    let firstChunk = true;
    while (remainingLines.length) {
      if (y - CONTENT_BOTTOM < CONTINUATION_MINIMUM_SPACE) addPage(false);
      const prefixLines = firstChunk ? [] : continuationLines();
      const availableLineHeight =
        y - CONTENT_BOTTOM - CARD_GAP - 26 - lineHeightTotal(prefixLines);
      if (availableLineHeight <= 0) {
        addPage(false);
        continue;
      }
      let consumedHeight = 0;
      let take = 0;
      while (take < remainingLines.length) {
        const line = remainingLines[take];
        const lineHeight = line.gapBefore + line.lineHeight;
        if (take > 0 && consumedHeight + lineHeight > availableLineHeight) {
          break;
        }
        if (take === 0 && lineHeight > availableLineHeight) {
          addPage(false);
          break;
        }
        consumedHeight += lineHeight;
        take += 1;
      }
      if (!take) continue;
      drawChunk([
        ...prefixLines,
        ...remainingLines.slice(0, take),
      ]);
      remainingLines = remainingLines.slice(take);
      firstChunk = false;
      if (remainingLines.length) addPage(false);
    }
  }

  addPage(true);
  drawFreeText(report.planTitle, {
    font: bold,
    size: 17,
    color: palette.ink,
    lineHeight: 20,
    after: 5,
  });
  drawFreeText(report.summary, { size: 9.2, after: 12 });

  drawSectionTitle("Your planning snapshot", "What this plan is based on");
  drawCard({
    bullets: report.planningSnapshot.map(
      (item) => `${normalizedText(item?.label)}: ${normalizedText(item?.value)}`,
    ),
    fill: palette.mint,
  });

  if (report.climate) {
    drawCard({
      eyebrow: "Broad climate planning context",
      title: report.climate.label,
      body: report.climate.summary,
      fill: palette.mint,
      accent: palette.teal,
      priority: true,
    });
  }

  drawCard({
    eyebrow: "Before spending money",
    title: report.readiness?.message,
    body: report.readiness?.boundary,
    fill: palette.cream,
    border: palette.creamBorder,
    accent: rgb(0.49, 0.36, 0.04),
  });

  if (Array.isArray(report.questions) && report.questions.length) {
    drawSectionTitle(
      "Questions that can change the plan",
      "Check these before treating the order as final",
    );
    for (const question of report.questions) {
      drawCard({
        eyebrow: `Question ${Number(question?.number) || 1}`,
        title: question?.prompt,
        body: question?.whyItMatters,
        fill: palette.cream,
        border: palette.creamBorder,
      });
    }
  }

  if (report.professionalReview) {
    drawSectionTitle(
      "Professional review, self-declared",
      "Review attribution supplied by the named adviser",
    );
    drawCard({
      title: report.professionalReview.statement,
      body: [
        report.professionalReview.notes
          ? `Adviser notes:\n${report.professionalReview.notes}`
          : "",
        report.professionalReview.boundary,
      ].filter(Boolean).join("\n\n"),
      fill: palette.mint,
      accent: palette.teal,
      priority: true,
    });
  }

  if (Array.isArray(report.everydayActions) && report.everydayActions.length) {
    drawSectionTitle(
      "Helpful things you can try now",
      "Useful alongside the roadmap",
      report.everydayActionsBoundary,
    );
    for (const action of report.everydayActions) {
      drawCard({
        eyebrow: action?.category,
        title: action?.title,
        body: action?.description,
        fill: palette.mint,
      });
    }
  }

  drawSectionTitle("Why this order", "How the roadmap was prioritised");
  drawCard({
    bullets: Array.isArray(report.decisionBasis) ? report.decisionBasis : [],
    fill: palette.pale,
  });

  drawSectionTitle(
    "Your ordered roadmap",
    "What to consider, in order",
    "The first three unfinished steps are highlighted. Remaining steps keep their recorded order.",
  );
  report.actions.forEach((action, index) => {
    const number = Number.isFinite(Number(action?.number))
      ? Number(action.number)
      : index + 1;
    drawCard({
      eyebrow: `${
        action?.completed ? "Completed" : String(number).padStart(2, "0")
      } | ${normalizedText(action?.stage)}`,
      title: action?.title,
      body: action?.description,
      linkLabel: action?.guideLabel,
      linkHref: action?.guideHref,
      fill: action?.priority ? palette.mint : palette.white,
      border: action?.priority
        ? rgb(0.47, 0.77, 0.67)
        : palette.border,
      accent: action?.completed ? palette.green : palette.teal,
      priority: action?.priority === true,
    });
  });

  drawCard({
    eyebrow: "What could change this order",
    body: report.changeBoundary,
    fill: palette.cream,
    border: palette.creamBorder,
  });
  drawCard({
    eyebrow: "Before engaging a trade",
    bullets: Array.isArray(report.beforeTrade) ? report.beforeTrade : [],
    fill: palette.pale,
  });
  drawCard({
    eyebrow: "Private by design",
    body: `${normalizedText(report.privacyNote)}\n\n${
      normalizedText(report.adviceBoundary)
    }`,
    fill: palette.navyDark,
    border: palette.navyDark,
    accent: palette.teal,
    eyebrowColor: rgb(0.39, 0.93, 0.8),
    titleColor: palette.white,
    bodyColor: palette.darkBody,
    linkColor: palette.darkBody,
  });

  pages.forEach((currentPage, index) => {
    currentPage.drawLine({
      start: { x: MARGIN, y: 31 },
      end: { x: PAGE_WIDTH - MARGIN, y: 31 },
      thickness: 0.7,
      color: palette.border,
    });
    currentPage.drawText(
      "Independent, product-neutral home energy guidance",
      {
        x: MARGIN,
        y: 18,
        size: 6.8,
        font: regular,
        color: palette.muted,
      },
    );
    const pageLabel = `Page ${index + 1} of ${pages.length}`;
    currentPage.drawText(pageLabel, {
      x: PAGE_WIDTH - MARGIN - regular.widthOfTextAtSize(pageLabel, 6.8),
      y: 18,
      size: 6.8,
      font: regular,
      color: palette.muted,
    });
  });

  return pdf.save();
}
