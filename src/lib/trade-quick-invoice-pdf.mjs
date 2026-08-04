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

const A4_WIDTH = 595.28;
const A4_HEIGHT = 841.89;
const MARGIN = 40;
const CONTENT_WIDTH = A4_WIDTH - MARGIN * 2;
const BANNER_HEIGHT = A4_WIDTH / 5;
const MAX_FONT_BYTES = 2_000_000;

const THEMES = {
  emerald_navy: ["#062d3d", "#0d765f"],
  ocean_mint: ["#0b405f", "#087966"],
  cobalt_aqua: ["#16378b", "#08778b"],
  violet_sunset: ["#4b2a84", "#b14f69"],
  amber_ink: ["#8a5306", "#162533"],
  charcoal_silver: ["#111827", "#4b5563"],
  rose_plum: ["#5a296f", "#b94767"],
  forest_jade: ["#123d2d", "#17725f"],
  bronze_olive: ["#6b4108", "#4d6120"],
  midnight_rose: ["#121942", "#9d3f61"],
  teal_indigo: ["#075b58", "#34479a"],
  graphite_copper: ["#25262b", "#954326"],
  indigo_orchid: ["#31317a", "#824091"],
  burgundy_slate: ["#6b2038", "#34495e"],
};

function colour(hex) {
  const value = String(hex).replace("#", "");
  return rgb(
    Number.parseInt(value.slice(0, 2), 16) / 255,
    Number.parseInt(value.slice(2, 4), 16) / 255,
    Number.parseInt(value.slice(4, 6), 16) / 255,
  );
}

function optionalBytes(value) {
  const bytes =
    value instanceof Uint8Array
      ? value
      : value instanceof ArrayBuffer
        ? new Uint8Array(value)
        : null;
  return bytes &&
    bytes.byteLength >= 10_000 &&
    bytes.byteLength <= MAX_FONT_BYTES
    ? bytes
    : null;
}

function safeText(value) {
  return String(value || "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]+/g, " ")
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/[^\x20-\x7e\n]/g, "?");
}

function money(cents) {
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
  }).format(Math.max(0, Number(cents) || 0) / 100);
}

function wrap(font, value, size, width) {
  const output = [];
  for (const paragraph of safeText(value).split("\n")) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (!words.length) {
      output.push("");
      continue;
    }
    let line = "";
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= width) {
        line = candidate;
        continue;
      }
      if (line) output.push(line);
      line = word;
    }
    if (line) output.push(line);
  }
  return output;
}

function ellipsise(font, value, size, width) {
  const source = safeText(value).replace(/\s+/g, " ").trim();
  if (font.widthOfTextAtSize(source, size) <= width) return source;
  const suffix = "...";
  let output = source;
  while (
    output &&
    font.widthOfTextAtSize(`${output}${suffix}`, size) > width
  ) {
    output = output.slice(0, -1).trimEnd();
  }
  return output ? `${output}${suffix}` : suffix;
}

export function resolveInvoiceBusinessNameLayout(font, value, width) {
  const source = safeText(value).replace(/\s+/g, " ").trim();
  const maximumWidth = Math.max(40, Number(width) || 0);
  for (let size = 19; size >= 14; size -= 1) {
    if (font.widthOfTextAtSize(source, size) <= maximumWidth) {
      return { lines: [source], size, lineHeight: size + 3 };
    }
  }
  for (let size = 14; size >= 11; size -= 1) {
    const lines = wrap(font, source, size, maximumWidth);
    if (
      lines.length <= 2 &&
      lines.every(
        (line) => font.widthOfTextAtSize(line, size) <= maximumWidth,
      )
    ) {
      return { lines, size, lineHeight: size + 3 };
    }
  }
  const size = 11;
  const lines = wrap(font, source, size, maximumWidth);
  return {
    lines: [
      ellipsise(font, lines[0] || source, size, maximumWidth),
      ...(lines.length > 1
        ? [
            ellipsise(
              font,
              lines.slice(1).join(" "),
              size,
              maximumWidth,
            ),
          ]
        : []),
    ],
    size,
    lineHeight: size + 3,
  };
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

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function resolveInvoiceBannerCropPixels(image, suppliedCrop) {
  const sourceWidth = Math.max(1, Number(image?.width) || 1);
  const sourceHeight = Math.max(1, Number(image?.height) || 1);
  const crop = suppliedCrop || {};
  const xBp = clamp(Number(crop.xBasisPoints) || 0, 0, 9_999);
  const yBp = clamp(Number(crop.yBasisPoints) || 0, 0, 9_999);
  const x = sourceWidth * xBp / 10_000;
  const y = sourceHeight * yBp / 10_000;
  const storedWidth = clamp(
    sourceWidth * (Number(crop.widthBasisPoints) || 10_000) / 10_000,
    1,
    sourceWidth - x,
  );
  const storedHeight = clamp(
    sourceHeight * (Number(crop.heightBasisPoints) || 10_000) / 10_000,
    1,
    sourceHeight - y,
  );
  let width = storedWidth;
  let height = storedHeight;
  let cropX = x;
  let cropY = y;
  const targetRatio = 5;
  if (width / height > targetRatio) {
    width = height * targetRatio;
    cropX += (storedWidth - width) / 2;
  } else {
    height = width / targetRatio;
    cropY += (storedHeight - height) / 2;
  }
  return { x: cropX, y: cropY, width, height };
}

function drawBanner(page, image, crop) {
  const targetY = A4_HEIGHT - BANNER_HEIGHT;
  const source = resolveInvoiceBannerCropPixels(image, crop);
  const scale = A4_WIDTH / source.width;
  const drawWidth = image.width * scale;
  const drawHeight = image.height * scale;
  const drawX = -source.x * scale;
  const drawY =
    targetY + BANNER_HEIGHT - (image.height - source.y) * scale;
  page.pushOperators(
    pushGraphicsState(),
    rectangle(0, targetY, A4_WIDTH, BANNER_HEIGHT),
    clip(),
    endPath(),
  );
  page.drawImage(image, {
    x: drawX,
    y: drawY,
    width: drawWidth,
    height: drawHeight,
  });
  page.pushOperators(popGraphicsState());
}

export async function createTradeQuickInvoicePdfBytes(
  snapshot,
  suppliedFonts = {},
  suppliedAssets = {},
) {
  if (
    !snapshot ||
    snapshot.schemaVersion !== "trade-quick-invoice-document-v1" ||
    !snapshot.invoiceNumber ||
    !snapshot.business?.name ||
    !Array.isArray(snapshot.lines) ||
    !snapshot.lines.length
  ) {
    throw new TypeError("A valid invoice document snapshot is required.");
  }
  const regularBytes = optionalBytes(suppliedFonts.regular);
  const boldBytes = optionalBytes(suppliedFonts.bold);
  const pdf = await PDFDocument.create();
  if (regularBytes && boldBytes) pdf.registerFontkit(fontkit);
  const regular =
    regularBytes && boldBytes
      ? await pdf.embedFont(regularBytes, { subset: false })
      : await pdf.embedFont(StandardFonts.Helvetica);
  const bold =
    regularBytes && boldBytes
      ? await pdf.embedFont(boldBytes, { subset: false })
      : await pdf.embedFont(StandardFonts.HelveticaBold);
  const banner = await embeddedImage(pdf, suppliedAssets.banner);
  const logo = await embeddedImage(pdf, suppliedAssets.logo);
  const [primaryHex, accentHex] =
    THEMES[snapshot.business.themeKey] || THEMES.emerald_navy;
  const primary = colour(primaryHex);
  const accent = colour(accentHex);
  const ink = colour("#102f35");
  const muted = colour("#577074");
  const line = colour("#d4e2df");
  const soft = colour("#f1f7f5");
  const page = pdf.addPage([A4_WIDTH, A4_HEIGHT]);
  let y = A4_HEIGHT - MARGIN;

  if (banner) {
    drawBanner(page, banner, snapshot.business.bannerCrop);
    y = A4_HEIGHT - BANNER_HEIGHT - 22;
  } else {
    page.drawRectangle({
      x: 0,
      y: A4_HEIGHT - 10,
      width: A4_WIDTH,
      height: 10,
      color: accent,
    });
  }

  if (logo) {
    const scale = Math.min(78 / logo.width, 44 / logo.height, 1);
    page.drawImage(logo, {
      x: MARGIN,
      y: y - logo.height * scale,
      width: logo.width * scale,
      height: logo.height * scale,
    });
  }
  const identityX = logo ? MARGIN + 94 : MARGIN;
  const invoiceTitle = "INVOICE";
  const invoiceTitleSize = 21;
  const invoiceTitleX =
    A4_WIDTH - MARGIN - bold.widthOfTextAtSize(invoiceTitle, invoiceTitleSize);
  const businessNameLayout = resolveInvoiceBusinessNameLayout(
    bold,
    snapshot.business.name,
    invoiceTitleX - identityX - 16,
  );
  businessNameLayout.lines.forEach((line, index) => {
    page.drawText(line, {
      x: identityX,
      y: y - 7 - index * businessNameLayout.lineHeight,
      font: bold,
      size: businessNameLayout.size,
      color: primary,
    });
  });
  const businessNameBottom =
    7 + (businessNameLayout.lines.length - 1) * businessNameLayout.lineHeight;
  const businessContactOffset = Math.max(25, businessNameBottom + 18);
  const businessContact = [
    snapshot.business.phone,
    snapshot.business.email,
    snapshot.business.abn ? `ABN ${snapshot.business.abn}` : "",
  ]
    .filter(Boolean)
    .join(" | ");
  page.drawText(safeText(businessContact), {
    x: identityX,
    y: y - businessContactOffset,
    font: regular,
    size: 7.8,
    color: muted,
  });
  page.drawText(invoiceTitle, {
    x: invoiceTitleX,
    y: y - 7,
    font: bold,
    size: invoiceTitleSize,
    color: primary,
  });
  y -= Math.max(66, businessContactOffset + 41);

  page.drawRectangle({
    x: MARGIN,
    y: y - 77,
    width: CONTENT_WIDTH,
    height: 82,
    color: soft,
    borderColor: line,
    borderWidth: 0.7,
  });
  const meta = [
    ["Invoice", snapshot.invoiceNumber],
    ["Issue date", (snapshot.issuedAt || snapshot.capturedAt).slice(0, 10)],
    ["Due date", snapshot.dueAt],
  ];
  meta.forEach(([label, value], index) => {
    const x = MARGIN + 14 + index * 112;
    page.drawText(label.toUpperCase(), {
      x,
      y: y - 15,
      font: bold,
      size: 7,
      color: accent,
    });
    page.drawText(safeText(value), {
      x,
      y: y - 32,
      font: bold,
      size: 9,
      color: ink,
    });
  });
  page.drawText("BILL TO", {
    x: MARGIN + 355,
    y: y - 15,
    font: bold,
    size: 7,
    color: accent,
  });
  page.drawText(safeText(snapshot.customer.name), {
    x: MARGIN + 355,
    y: y - 32,
    font: bold,
    size: 9,
    color: ink,
  });
  const addressLines = wrap(
    regular,
    snapshot.site.summary,
    7.4,
    CONTENT_WIDTH - 365,
  ).slice(0, 3);
  addressLines.forEach((value, index) =>
    page.drawText(value, {
      x: MARGIN + 355,
      y: y - 45 - index * 10,
      font: regular,
      size: 7.4,
      color: muted,
    }),
  );
  y -= 97;

  page.drawText(safeText(snapshot.work.title), {
    x: MARGIN,
    y,
    font: bold,
    size: 13,
    color: ink,
  });
  page.drawText(safeText(`Job ${snapshot.work.number}`), {
    x: MARGIN,
    y: y - 15,
    font: regular,
    size: 8,
    color: muted,
  });
  y -= 37;

  page.drawRectangle({
    x: MARGIN,
    y: y - 23,
    width: CONTENT_WIDTH,
    height: 26,
    color: primary,
  });
  const columns = [
    ["Description", MARGIN + 10],
    ["Qty", MARGIN + 302],
    ["Unit", MARGIN + 342],
    ["GST", MARGIN + 413],
    ["Amount", MARGIN + 468],
  ];
  columns.forEach(([label, x]) =>
    page.drawText(label, {
      x,
      y: y - 14,
      font: bold,
      size: 7.6,
      color: rgb(1, 1, 1),
    }),
  );
  y -= 35;
  for (const item of snapshot.lines) {
    const description = wrap(regular, item.description, 8.3, 275).slice(0, 2);
    description.forEach((value, index) =>
      page.drawText(value, {
        x: MARGIN + 10,
        y: y - index * 10,
        font: index === 0 ? bold : regular,
        size: 8.3,
        color: ink,
      }),
    );
    page.drawText(String(item.quantity || 1), {
      x: MARGIN + 307,
      y,
      font: regular,
      size: 8.3,
      color: ink,
    });
    page.drawText(safeText(money(item.unitPriceCentsExGst)), {
      x: MARGIN + 342,
      y,
      font: regular,
      size: 8.3,
      color: ink,
    });
    page.drawText(item.taxCode === "gst" ? "10%" : "Free", {
      x: MARGIN + 418,
      y,
      font: regular,
      size: 8.3,
      color: ink,
    });
    const total = safeText(money(item.subtotalCents));
    page.drawText(total, {
      x: A4_WIDTH - MARGIN - 9 - regular.widthOfTextAtSize(total, 8.3),
      y,
      font: regular,
      size: 8.3,
      color: ink,
    });
    y -= Math.max(26, description.length * 11 + 9);
    page.drawLine({
      start: { x: MARGIN, y: y + 7 },
      end: { x: A4_WIDTH - MARGIN, y: y + 7 },
      thickness: 0.5,
      color: line,
    });
  }

  y -= 4;
  const summaryY = y;
  const paymentRows = [
    ["Account name", snapshot.payment.accountName],
    ["BSB", snapshot.payment.bsb],
    ["Account number", snapshot.payment.accountNumber],
    ["Reference", snapshot.payment.reference],
  ].filter(([, value]) => value);
  if (paymentRows.length) {
    page.drawText("PAYMENT DETAILS", {
      x: MARGIN,
      y: summaryY,
      font: bold,
      size: 8,
      color: accent,
    });
    paymentRows.forEach(([label, value], index) => {
      page.drawText(label, {
        x: MARGIN,
        y: summaryY - 17 - index * 14,
        font: regular,
        size: 8,
        color: muted,
      });
      page.drawText(safeText(value), {
        x: MARGIN + 82,
        y: summaryY - 17 - index * 14,
        font: bold,
        size: 8,
        color: ink,
      });
    });
  }
  const totals = [
    ["Subtotal", snapshot.subtotalCents],
    ...(snapshot.discountCents
      ? [["Discount (ex GST)", -snapshot.discountCents]]
      : []),
    ["GST", snapshot.taxCents],
  ];
  totals.forEach(([label, cents], index) => {
    const amount = `${Number(cents) < 0 ? "-" : ""}${money(Math.abs(Number(cents)))}`;
    page.drawText(label, {
      x: MARGIN + 350,
      y: y - index * 17,
      font: regular,
      size: 9,
      color: muted,
    });
    page.drawText(amount, {
      x: A4_WIDTH - MARGIN - bold.widthOfTextAtSize(amount, 9),
      y: y - index * 17,
      font: bold,
      size: 9,
      color: ink,
    });
  });
  y -= totals.length * 17 + 8;
  page.drawRectangle({
    x: MARGIN + 337,
    y: y - 32,
    width: CONTENT_WIDTH - 337,
    height: 38,
    color: accent,
  });
  page.drawText("TOTAL DUE", {
    x: MARGIN + 350,
    y: y - 17,
    font: bold,
    size: 8,
    color: rgb(1, 1, 1),
  });
  const totalDue = safeText(money(snapshot.totalCents));
  page.drawText(totalDue, {
    x: A4_WIDTH - MARGIN - 12 - bold.widthOfTextAtSize(totalDue, 15),
    y: y - 20,
    font: bold,
    size: 15,
    color: rgb(1, 1, 1),
  });
  y -= 56;

  if (snapshot.payment.terms && y > 110) {
    page.drawText("PAYMENT TERMS", {
      x: MARGIN,
      y,
      font: bold,
      size: 8,
      color: accent,
    });
    y -= 15;
    const terms = wrap(
      regular,
      snapshot.payment.terms,
      7.6,
      CONTENT_WIDTH,
    ).slice(0, Math.max(1, Math.floor((y - 58) / 10)));
    terms.forEach((value, index) =>
      page.drawText(value, {
        x: MARGIN,
        y: y - index * 10,
        font: regular,
        size: 7.6,
        color: muted,
      }),
    );
  }

  page.drawLine({
    start: { x: MARGIN, y: 43 },
    end: { x: A4_WIDTH - MARGIN, y: 43 },
    thickness: 0.6,
    color: line,
  });
  const footerLeft = safeText(
    [snapshot.business.phone, snapshot.business.email]
      .filter(Boolean)
      .join(" | "),
  );
  page.drawText(footerLeft, {
    x: MARGIN,
    y: 26,
    font: regular,
    size: 7,
    color: muted,
  });
  const footerRight = safeText(`${snapshot.invoiceNumber} | Page 1 of 1`);
  page.drawText(footerRight, {
    x: A4_WIDTH - MARGIN - regular.widthOfTextAtSize(footerRight, 7),
    y: 26,
    font: regular,
    size: 7,
    color: muted,
  });

  pdf.setTitle(
    safeText(`Invoice ${snapshot.invoiceNumber} from ${snapshot.business.name}`),
  );
  pdf.setAuthor(safeText(snapshot.business.name));
  pdf.setSubject(
    safeText(`Invoice for ${snapshot.customer.name}: ${snapshot.work.title}`),
  );
  pdf.setCreator("TLink");
  pdf.setProducer("TLink");
  return pdf.save({ useObjectStreams: false });
}
