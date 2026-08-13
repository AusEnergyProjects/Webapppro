import {
  PDFDocument,
  StandardFonts,
  clip,
  endPath,
  popGraphicsState,
  pushGraphicsState,
  rectangle,
  rgb,
} from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { tradeQuoteDocumentDisplayTotals } from "./trade-quote-document-totals.mjs";

const A4_WIDTH = 595.28;
const A4_HEIGHT = 841.89;
const MARGIN = 42;
const CONTENT_WIDTH = A4_WIDTH - MARGIN * 2;
const MAX_FONT_BYTES = 2_000_000;
const FINAL_PERCENT_DISCOUNT_SECTION = "Overall percentage discount";
const isFinalPercentDiscount = (item) => item?.sectionHeading === FINAL_PERCENT_DISCOUNT_SECTION;

const THEMES = {
  emerald_navy: {
    ink: rgb(0.02, 0.18, 0.23),
    primary: rgb(0.03, 0.37, 0.34),
    accent: rgb(0.04, 0.70, 0.49),
    soft: rgb(0.93, 0.97, 0.96),
    line: rgb(0.79, 0.88, 0.86),
  },
  ocean_mint: {
    ink: rgb(0.03, 0.17, 0.25),
    primary: rgb(0.03, 0.40, 0.55),
    accent: rgb(0.14, 0.72, 0.61),
    soft: rgb(0.92, 0.97, 0.98),
    line: rgb(0.77, 0.88, 0.91),
  },
  cobalt_aqua: {
    ink: rgb(0.04, 0.11, 0.29),
    primary: rgb(0.12, 0.29, 0.72),
    accent: rgb(0.07, 0.71, 0.78),
    soft: rgb(0.94, 0.96, 1),
    line: rgb(0.79, 0.84, 0.94),
  },
  violet_sunset: {
    ink: rgb(0.18, 0.09, 0.28),
    primary: rgb(0.37, 0.20, 0.68),
    accent: rgb(0.90, 0.34, 0.55),
    soft: rgb(0.98, 0.94, 0.98),
    line: rgb(0.88, 0.80, 0.91),
  },
  amber_ink: {
    ink: rgb(0.16, 0.13, 0.08),
    primary: rgb(0.39, 0.29, 0.05),
    accent: rgb(0.91, 0.58, 0.06),
    soft: rgb(0.99, 0.97, 0.91),
    line: rgb(0.90, 0.84, 0.69),
  },
  charcoal_silver: {
    ink: rgb(0.10, 0.12, 0.14),
    primary: rgb(0.20, 0.23, 0.25),
    accent: rgb(0.48, 0.54, 0.57),
    soft: rgb(0.95, 0.96, 0.96),
    line: rgb(0.82, 0.84, 0.85),
  },
  rose_plum: {
    ink: rgb(0.18, 0.08, 0.22),
    primary: rgb(0.35, 0.16, 0.44),
    accent: rgb(0.72, 0.28, 0.40),
    soft: rgb(0.98, 0.94, 0.97),
    line: rgb(0.88, 0.79, 0.86),
  },
  forest_jade: {
    ink: rgb(0.05, 0.18, 0.13),
    primary: rgb(0.07, 0.29, 0.21),
    accent: rgb(0.09, 0.56, 0.41),
    soft: rgb(0.93, 0.97, 0.95),
    line: rgb(0.77, 0.88, 0.82),
  },
  bronze_olive: {
    ink: rgb(0.18, 0.14, 0.05),
    primary: rgb(0.42, 0.25, 0.03),
    accent: rgb(0.42, 0.52, 0.10),
    soft: rgb(0.98, 0.97, 0.91),
    line: rgb(0.88, 0.84, 0.68),
  },
  midnight_rose: {
    ink: rgb(0.07, 0.09, 0.24),
    primary: rgb(0.12, 0.15, 0.38),
    accent: rgb(0.62, 0.25, 0.38),
    soft: rgb(0.96, 0.94, 0.97),
    line: rgb(0.81, 0.79, 0.88),
  },
  teal_indigo: {
    ink: rgb(0.03, 0.17, 0.18),
    primary: rgb(0.03, 0.36, 0.35),
    accent: rgb(0.20, 0.28, 0.60),
    soft: rgb(0.92, 0.97, 0.97),
    line: rgb(0.75, 0.87, 0.87),
  },
  graphite_copper: {
    ink: rgb(0.13, 0.13, 0.15),
    primary: rgb(0.20, 0.20, 0.22),
    accent: rgb(0.58, 0.26, 0.15),
    soft: rgb(0.96, 0.95, 0.94),
    line: rgb(0.84, 0.81, 0.78),
  },
  indigo_orchid: {
    ink: rgb(0.13, 0.12, 0.31),
    primary: rgb(0.19, 0.19, 0.48),
    accent: rgb(0.51, 0.25, 0.57),
    soft: rgb(0.96, 0.94, 0.98),
    line: rgb(0.83, 0.79, 0.89),
  },
  burgundy_slate: {
    ink: rgb(0.24, 0.07, 0.12),
    primary: rgb(0.42, 0.13, 0.22),
    accent: rgb(0.20, 0.29, 0.37),
    soft: rgb(0.97, 0.94, 0.95),
    line: rgb(0.87, 0.78, 0.81),
  },
};

function optionalBytes(value) {
  const result =
    value instanceof Uint8Array
      ? value
      : value instanceof ArrayBuffer
        ? new Uint8Array(value)
        : null;
  return result &&
    result.byteLength >= 10_000 &&
    result.byteLength <= MAX_FONT_BYTES
    ? result
    : null;
}

function characterSet(fontBytes, label) {
  try {
    const font = fontkit.create(fontBytes);
    const values = new Set(font?.characterSet || []);
    if (!values.size) throw new Error("EMPTY_CHARACTER_SET");
    return values;
  } catch {
    throw new TypeError(`The embedded ${label} font could not be read.`);
  }
}

function safeText(value, supported) {
  const clean = String(value || "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]+/g, " ")
    .replace(/[\u2013\u2014]/g, "-");
  let output = "";
  for (const character of clean) {
    if (character === "\n" || supported.has(character.codePointAt(0))) {
      output += character;
    } else {
      output += "?";
    }
  }
  return output;
}

function amount(cents) {
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
  }).format((Number(cents) || 0) / 100);
}

function wrapLine(font, value, size, width) {
  const words = value.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [""];
  const output = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= width) {
      line = candidate;
      continue;
    }
    if (line) {
      output.push(line);
      line = "";
    }
    let remainder = word;
    while (
      remainder &&
      font.widthOfTextAtSize(remainder, size) > width
    ) {
      let split = 1;
      while (
        split < remainder.length &&
        font.widthOfTextAtSize(remainder.slice(0, split + 1), size) <= width
      ) {
        split += 1;
      }
      output.push(remainder.slice(0, split));
      remainder = remainder.slice(split);
    }
    line = remainder;
  }
  if (line) output.push(line);
  return output;
}

function wrapText(font, value, size, width, supported) {
  return safeText(value, supported)
    .split("\n")
    .flatMap((paragraph, index, all) => {
      const lines = wrapLine(font, paragraph, size, width);
      return index < all.length - 1 ? [...lines, ""] : lines;
    });
}

function fitImage(image, maximumWidth, maximumHeight) {
  const scale = Math.min(
    maximumWidth / image.width,
    maximumHeight / image.height,
    1,
  );
  return {
    width: image.width * scale,
    height: image.height * scale,
  };
}

export function tradeQuoteBannerCropForImage(
  suppliedCrop,
  suppliedImageWidth,
  suppliedImageHeight,
) {
  const imageWidth = Math.max(1, Number(suppliedImageWidth) || 1);
  const imageHeight = Math.max(1, Number(suppliedImageHeight) || 1);
  const crop = suppliedCrop && typeof suppliedCrop === "object"
    ? suppliedCrop
    : {};
  const bounded = (value, fallback, minimum = 0) => {
    const number = Number(value);
    return Math.min(
      10_000,
      Math.max(minimum, Number.isFinite(number) ? number : fallback),
    );
  };
  let x =
    (bounded(crop.xBasisPoints, 0) / 10_000) * imageWidth;
  let y =
    (bounded(crop.yBasisPoints, 0) / 10_000) * imageHeight;
  let width =
    (bounded(crop.widthBasisPoints, 10_000, 1) / 10_000) * imageWidth;
  let height =
    (bounded(crop.heightBasisPoints, 10_000, 1) / 10_000) * imageHeight;
  x = Math.min(x, imageWidth - 1);
  y = Math.min(y, imageHeight - 1);
  width = Math.max(1, Math.min(width, imageWidth - x));
  height = Math.max(1, Math.min(height, imageHeight - y));

  if (width / height > 5) {
    const nextWidth = height * 5;
    x += (width - nextWidth) / 2;
    width = nextWidth;
  } else {
    const nextHeight = width / 5;
    y += (height - nextHeight) / 2;
    height = nextHeight;
  }
  return { x, y, width, height };
}

export function contiguousTradeQuoteSections(items = []) {
  return items.reduce((sections, item) => {
    const heading = item.sectionHeading || "Included work";
    const current = sections.at(-1);
    if (current?.heading === heading) {
      current.items.push(item);
    } else {
      sections.push({ heading, items: [item] });
    }
    return sections;
  }, []);
}

async function embeddedImage(pdf, asset) {
  if (
    !asset ||
    !(asset.bytes instanceof Uint8Array) ||
    asset.bytes.byteLength < 20 ||
    asset.bytes.byteLength > 4_000_000
  ) {
    return null;
  }
  try {
    return asset.contentType === "image/png"
      ? await pdf.embedPng(asset.bytes)
      : asset.contentType === "image/jpeg"
        ? await pdf.embedJpg(asset.bytes)
        : null;
  } catch {
    return null;
  }
}

export async function createTradeQuotePdfBytes(
  suppliedSnapshot,
  suppliedFonts = {},
  suppliedAssets = {},
) {
  const snapshot =
    suppliedSnapshot &&
    typeof suppliedSnapshot === "object" &&
    !Array.isArray(suppliedSnapshot)
      ? suppliedSnapshot
      : null;
  if (
    !snapshot ||
    (
      snapshot.schemaVersion !== "trade-quote-document-v1" &&
      snapshot.schemaVersion !== "trade-quote-document-v2"
    ) ||
    !snapshot.quoteNumber ||
    !snapshot.business?.name
  ) {
    throw new TypeError("A valid quote document snapshot is required.");
  }
  const regularBytes = optionalBytes(suppliedFonts?.regular);
  const boldBytes = optionalBytes(suppliedFonts?.bold);
  const useEmbeddedFonts = Boolean(regularBytes && boldBytes);
  const standardCharacters = new Set(
    Array.from({ length: 95 }, (_value, index) => index + 32),
  );
  const regularCharacters = useEmbeddedFonts
    ? characterSet(regularBytes, "regular")
    : standardCharacters;
  const boldCharacters = useEmbeddedFonts
    ? characterSet(boldBytes, "bold")
    : standardCharacters;
  const supported = new Set(
    [...regularCharacters].filter((code) => boldCharacters.has(code)),
  );
  const pdf = await PDFDocument.create();
  if (useEmbeddedFonts) pdf.registerFontkit(fontkit);
  const regular = useEmbeddedFonts
    ? await pdf.embedFont(regularBytes, { subset: false })
    : await pdf.embedFont(StandardFonts.Helvetica);
  const bold = useEmbeddedFonts
    ? await pdf.embedFont(boldBytes, { subset: false })
    : await pdf.embedFont(StandardFonts.HelveticaBold);
  const logo = await embeddedImage(pdf, suppliedAssets.logo);
  const banner = await embeddedImage(pdf, suppliedAssets.banner);
  const palette =
    THEMES[snapshot.business.themeKey] || THEMES.emerald_navy;
  const displayTotals = tradeQuoteDocumentDisplayTotals(snapshot);
  const headlineItems = [
    ...(Array.isArray(snapshot.items) ? snapshot.items : []),
    ...(Array.isArray(snapshot.choices)
      ? snapshot.choices
          .filter((choice) =>
            displayTotals.selectedChoiceIds.includes(String(choice.id || "")),
          )
          .flatMap((choice) =>
            Array.isArray(choice.items) ? choice.items : [],
          )
      : []),
  ];
  const finalPercentItems = headlineItems.filter(isFinalPercentDiscount);
  const finalPercentSubtotalCents = finalPercentItems.reduce(
    (sum, item) => sum + Math.min(0, Number(item.subtotalCents) || 0),
    0,
  );
  const otherDiscountSubtotalCents = headlineItems.reduce(
    (sum, item) =>
      !isFinalPercentDiscount(item) && Number(item.subtotalCents) < 0
        ? sum + Number(item.subtotalCents)
        : sum,
    0,
  );
  const grossSubtotalCents =
    displayTotals.subtotalCents - otherDiscountSubtotalCents - finalPercentSubtotalCents;
  const finalPercentBasisPoints = finalPercentItems.length === 1
    ? Math.round(Number(finalPercentItems[0].quantityMilli) || 0)
    : 0;
  const finalPercentDescription = finalPercentItems.length === 1
    ? String(finalPercentItems[0].description || "").trim().slice(0, 32)
    : "";
  const pages = [];
  let page;
  let y;

  function addPage() {
    page = pdf.addPage([A4_WIDTH, A4_HEIGHT]);
    pages.push(page);
    page.drawRectangle({
      x: 0,
      y: A4_HEIGHT - 8,
      width: A4_WIDTH,
      height: 8,
      color: palette.accent,
    });
    y = A4_HEIGHT - MARGIN;
    return page;
  }

  function ensureSpace(height) {
    if (!page || y - height < 54) addPage();
  }

  function drawText(value, {
    font = regular,
    size = 9.5,
    color = palette.ink,
    x = MARGIN,
    width = CONTENT_WIDTH,
    lineHeight = size * 1.35,
    gapAfter = 0,
  } = {}) {
    const chars = font === bold ? boldCharacters : regularCharacters;
    const lines = wrapText(font, value, size, width, chars);
    ensureSpace(lines.length * lineHeight + gapAfter);
    for (const line of lines) {
      if (line) page.drawText(line, { x, y, font, size, color });
      y -= lineHeight;
    }
    y -= gapAfter;
    return lines.length * lineHeight + gapAfter;
  }

  function label(value) {
    drawText(String(value).toUpperCase(), {
      font: bold,
      size: 7.5,
      color: palette.primary,
      lineHeight: 10,
      gapAfter: 7,
    });
  }

  function rule(gap = 12) {
    ensureSpace(gap * 2 + 1);
    y -= gap;
    page.drawLine({
      start: { x: MARGIN, y },
      end: { x: A4_WIDTH - MARGIN, y },
      thickness: 0.7,
      color: palette.line,
    });
    y -= gap;
  }

  function sectionTitle(kicker, title, description = "") {
    ensureSpace(description ? 73 : 51);
    label(kicker);
    drawText(title, {
      font: bold,
      size: 17,
      lineHeight: 21,
      color: palette.ink,
      gapAfter: description ? 4 : 10,
    });
    if (description) {
      drawText(description, {
        size: 9,
        color: rgb(0.27, 0.39, 0.39),
        lineHeight: 13,
        gapAfter: 10,
      });
    }
  }

  function lineItem(item) {
    const amountWidth = 90;
    const descriptionWidth = CONTENT_WIDTH - amountWidth - 16;
    const lines = wrapText(
      regular,
      item.description,
      9.25,
      descriptionWidth,
      regularCharacters,
    );
    const height = Math.max(22, lines.length * 12 + 9);
    ensureSpace(height);
    for (let index = 0; index < lines.length; index += 1) {
      page.drawText(lines[index], {
        x: MARGIN,
        y: y - index * 12,
        font: index === 0 ? bold : regular,
        size: index === 0 ? 9.25 : 8.5,
        color: palette.ink,
      });
    }
    const amountText = safeText(amount(item.totalCents), boldCharacters);
    page.drawText(amountText, {
      x:
        A4_WIDTH -
        MARGIN -
        bold.widthOfTextAtSize(amountText, 9.25),
      y,
      font: bold,
      size: 9.25,
      color: palette.ink,
    });
    y -= height;
    page.drawLine({
      start: { x: MARGIN, y: y + 3 },
      end: { x: A4_WIDTH - MARGIN, y: y + 3 },
      thickness: 0.45,
      color: palette.line,
    });
  }

  function summaryCell(labelValue, value, x, width, secondary = "") {
    const top = y;
    page.drawText(
      safeText(String(labelValue).toUpperCase(), boldCharacters),
      {
        x,
        y: top,
        font: bold,
        size: 7.25,
        color: palette.primary,
      },
    );
    const valueLines = wrapText(
      bold,
      value,
      10,
      width,
      boldCharacters,
    ).slice(0, 3);
    valueLines.forEach((line, index) => {
      page.drawText(line, {
        x,
        y: top - 16 - index * 13,
        font: bold,
        size: 10,
        color: palette.ink,
      });
    });
    if (secondary) {
      const secondaryLines = wrapText(
        regular,
        secondary,
        7.75,
        width,
        regularCharacters,
      ).slice(0, 2);
      secondaryLines.forEach((line, index) => {
        page.drawText(line, {
          x,
          y: top - 16 - valueLines.length * 13 - index * 10,
          font: regular,
          size: 7.75,
          color: rgb(0.34, 0.45, 0.45),
        });
      });
    }
  }

  addPage();
  if (banner) {
    const boxHeight = A4_WIDTH / 5;
    const crop = tradeQuoteBannerCropForImage(
      snapshot.business.bannerCrop,
      banner.width,
      banner.height,
    );
    const scale = A4_WIDTH / crop.width;
    const boxBottom = A4_HEIGHT - boxHeight;
    page.pushOperators(
      pushGraphicsState(),
      rectangle(0, boxBottom, A4_WIDTH, boxHeight),
      clip(),
      endPath(),
    );
    page.drawImage(banner, {
      x: -crop.x * scale,
      y: A4_HEIGHT + crop.y * scale - banner.height * scale,
      width: banner.width * scale,
      height: banner.height * scale,
      opacity: 0.96,
    });
    page.pushOperators(popGraphicsState());
    y = boxBottom - 18;
  }

  label("Quote from");
  if (logo) {
    const size = fitImage(logo, 96, 52);
    const logoTop = y + 4;
    page.drawImage(logo, {
      x: MARGIN,
      y: logoTop - size.height,
      width: size.width,
      height: size.height,
    });
    const nameTop = y;
    drawText(snapshot.business.name, {
      x: MARGIN + 112,
      width: CONTENT_WIDTH - 112,
      font: bold,
      size: 21,
      lineHeight: 25,
      color: palette.ink,
      gapAfter: 7,
    });
    y = Math.min(y, logoTop - size.height - 8, nameTop - 32);
  } else {
    drawText(snapshot.business.name, {
      font: bold,
      size: 23,
      lineHeight: 27,
      color: palette.ink,
      gapAfter: 7,
    });
  }
  const contact = [
    snapshot.business.phone,
    snapshot.business.email,
    snapshot.business.abn ? `ABN ${snapshot.business.abn}` : "",
  ]
    .filter(Boolean)
    .join(" | ");
  if (contact) {
    drawText(contact, {
      size: 8.5,
      color: rgb(0.31, 0.43, 0.43),
      lineHeight: 12,
      gapAfter: 8,
    });
  }

  ensureSpace(104);
  const summaryTop = y;
  page.drawRectangle({
    x: MARGIN,
    y: y - 94,
    width: CONTENT_WIDTH,
    height: 98,
    color: palette.soft,
    borderColor: palette.line,
    borderWidth: 0.7,
  });
  y -= 16;
  const half = (CONTENT_WIDTH - 30) / 2;
  summaryCell(
    "Quote",
    `${snapshot.quoteNumber} | Version ${snapshot.versionNumber}`,
    MARGIN + 14,
    half,
    `${snapshot.work.title} | ${snapshot.work.number}`,
  );
  summaryCell(
    "Prepared for",
    snapshot.customer.name,
    MARGIN + half + 22,
    half,
    snapshot.site.summary,
  );
  y = summaryTop - 110;
  drawText(
    snapshot.validUntil
      ? `Valid until ${snapshot.validUntil}`
      : "Ask the trade business about validity",
    {
      size: 8.5,
      color: rgb(0.34, 0.45, 0.45),
      lineHeight: 11,
      gapAfter: 8,
    },
  );

  if (snapshot.customerMessage) {
    const messageLineHeight = 13;
    const messageHeight = Math.max(
      19,
      wrapText(
        regular,
        snapshot.customerMessage,
        9.25,
        CONTENT_WIDTH - 14,
        regularCharacters,
      ).length * messageLineHeight + 6,
    );
    ensureSpace(messageHeight + 20);
    page.drawRectangle({
      x: MARGIN,
      y: y - messageHeight + 5,
      width: 4,
      height: messageHeight,
      color: palette.accent,
    });
    drawText(snapshot.customerMessage, {
      x: MARGIN + 14,
      width: CONTENT_WIDTH - 14,
      size: 9.25,
      lineHeight: messageLineHeight,
      color: rgb(0.24, 0.35, 0.35),
      gapAfter: 8,
    });
  }

  const includedItems = snapshot.items?.filter((item) => !isFinalPercentDiscount(item)) || [];
  if (includedItems.length) {
    const sections = contiguousTradeQuoteSections(includedItems);
    for (const section of sections) {
      if (sections.length > 1 || section.heading !== "Included work") {
        ensureSpace(34);
        drawText(section.heading, {
          font: bold,
          size: 10,
          color: palette.primary,
          lineHeight: 13,
          gapAfter: 5,
        });
      }
      section.items.forEach(lineItem);
      y -= 7;
    }
  }

  ensureSpace(104);
  y -= 8;
  page.drawRectangle({
    x: MARGIN,
    y: y - 83,
    width: CONTENT_WIDTH,
    height: 88,
    color: palette.ink,
  });
  page.drawText(
    safeText("TOTAL INCL GST", boldCharacters),
    {
    x: MARGIN + 16,
    y: y - 16,
    font: bold,
    size: 7.5,
    color: palette.accent,
    },
  );
  const total = safeText(amount(displayTotals.totalCents), boldCharacters);
  page.drawText(total, {
    x: MARGIN + 16,
    y: y - 48,
    font: bold,
    size: 25,
    color: rgb(1, 1, 1),
  });
  const breakdownRows = [
    ["Subtotal ex GST", grossSubtotalCents],
    ...(otherDiscountSubtotalCents < 0
      ? [["Rebates and dollar discounts ex GST", otherDiscountSubtotalCents]]
      : []),
    ...(finalPercentSubtotalCents < 0
      ? [[finalPercentBasisPoints > 0
        ? `${finalPercentDescription ? `${finalPercentDescription}\n` : ""}Final ${finalPercentBasisPoints / 10}% on included items ex GST`
        : "Final discount on included items ex GST", finalPercentSubtotalCents]]
      : []),
    ["GST", displayTotals.taxCents],
  ];
  breakdownRows.forEach(([rowLabel, rowAmount], index) => {
    const labelText = safeText(String(rowLabel), regularCharacters);
    const amountText = safeText(amount(Number(rowAmount)), boldCharacters);
    const rowY = y - 18 - index * 17;
    page.drawText(labelText, {
      x: A4_WIDTH - MARGIN - 178,
      y: rowY,
      font: regular,
      size: 8,
      lineHeight: 7,
      color: rgb(0.87, 0.94, 0.93),
    });
    page.drawText(amountText, {
      x: A4_WIDTH - MARGIN - bold.widthOfTextAtSize(amountText, 8.5),
      y: rowY,
      font: bold,
      size: 8.5,
      color: rgb(1, 1, 1),
    });
  });
  y -= 102;

  if (snapshot.choices?.length) {
    sectionTitle(
      "Customer choices",
      "Options to review online",
      "The secure online quote records the exact package, choose-one options and extras selected before acceptance.",
    );
    for (const choice of snapshot.choices) {
      ensureSpace(94);
      page.drawRectangle({
        x: MARGIN,
        y: y - 5,
        width: CONTENT_WIDTH,
        height: 1,
        color: palette.line,
      });
      y -= 18;
      const kind =
        choice.kind === "addon"
          ? "Optional extra"
          : choice.kind === "package"
            ? "Package"
            : "Choose one";
      const headlineChoice = displayTotals.selectedChoiceIds.includes(
        String(choice.id || ""),
      );
      label(
        `${kind}${
          choice.recommended
            ? " | Recommended"
            : headlineChoice
              ? " | Included in headline total"
              : ""
        }`,
      );
      drawText(choice.name, {
        font: bold,
        size: 13.5,
        lineHeight: 17,
        gapAfter: choice.summary ? 2 : 6,
      });
      if (choice.summary) {
        drawText(choice.summary, {
          size: 8.75,
          color: rgb(0.32, 0.43, 0.43),
          lineHeight: 12,
          gapAfter: 5,
        });
      }
      choice.items?.filter((item) => !isFinalPercentDiscount(item)).forEach(lineItem);
      drawText(
        `${
          choice.kind === "addon" ? "Optional extra" : "This choice"
        } adds ${amount(choice.totalCents)} including GST to the included scope`,
        {
        font: bold,
        size: 9.25,
        color: palette.primary,
        lineHeight: 13,
        gapAfter: 10,
        },
      );
    }
  }

  if (snapshot.terms) {
    rule();
    sectionTitle(
      "Recorded terms",
      "Scope, exclusions and completion terms",
    );
    drawText(snapshot.terms, {
      size: 8.75,
      color: rgb(0.24, 0.34, 0.34),
      lineHeight: 12.5,
      gapAfter: 12,
    });
  }

  rule(9);
  drawText(
    `This PDF is a copy of quote ${snapshot.quoteNumber}, version ${snapshot.versionNumber}. Review and acceptance take place through the private quote link sent by ${snapshot.business.name}.`,
    {
      size: 7.75,
      color: rgb(0.39, 0.49, 0.49),
      lineHeight: 10.5,
    },
  );

  pages.forEach((pdfPage, index) => {
    const footer = safeText(
      `${snapshot.quoteNumber} | Page ${index + 1} of ${pages.length}`,
      regularCharacters,
    );
    pdfPage.drawLine({
      start: { x: MARGIN, y: 38 },
      end: { x: A4_WIDTH - MARGIN, y: 38 },
      thickness: 0.5,
      color: palette.line,
    });
    pdfPage.drawText(footer, {
      x: MARGIN,
      y: 24,
      font: regular,
      size: 7.5,
      color: rgb(0.39, 0.49, 0.49),
    });
    const business = safeText(snapshot.business.name, regularCharacters);
    pdfPage.drawText(business, {
      x:
        A4_WIDTH -
        MARGIN -
        regular.widthOfTextAtSize(business, 7.5),
      y: 24,
      font: regular,
      size: 7.5,
      color: rgb(0.39, 0.49, 0.49),
    });
  });

  pdf.setTitle(
    safeText(
      `Quote ${snapshot.quoteNumber} from ${snapshot.business.name}`,
      supported,
    ),
  );
  pdf.setAuthor(safeText(snapshot.business.name, supported));
  pdf.setSubject(
    safeText(
      `Quote for ${snapshot.customer.name}: ${snapshot.work.title}`,
      supported,
    ),
  );
  pdf.setCreator("TLink");
  pdf.setProducer("TLink");
  return pdf.save({ useObjectStreams: false });
}
