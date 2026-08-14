import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";

export const TRADE_QUOTE_ACCEPTANCE_PDF_VERSION =
  "trade-quote-acceptance-receipt-v1";

const A4_WIDTH = 595.28;
const A4_HEIGHT = 841.89;
const MARGIN = 42;
const CONTENT_WIDTH = A4_WIDTH - MARGIN * 2;
const PRIMARY = rgb(0.027, 0.247, 0.192);
const ACCENT = rgb(0.043, 0.651, 0.475);
const INK = rgb(0.047, 0.184, 0.208);
const MUTED = rgb(0.314, 0.42, 0.388);
const LINE = rgb(0.78, 0.87, 0.84);
const SOFT = rgb(0.94, 0.975, 0.963);
const WARNING = rgb(1, 0.965, 0.82);
const WARNING_INK = rgb(0.36, 0.255, 0.035);
const MAX_FONT_BYTES = 2_000_000;
const STANDARD_CHARACTERS = new Set(
  Array.from({ length: 95 }, (_value, index) => index + 32),
);

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

function safeText(value, supported = STANDARD_CHARACTERS) {
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

function optionalFontBytes(value) {
  const bytes =
    value instanceof Uint8Array
      ? value
      : value instanceof ArrayBuffer
        ? new Uint8Array(value)
        : null;
  return bytes && bytes.byteLength >= 10_000 && bytes.byteLength <= MAX_FONT_BYTES
    ? bytes
    : null;
}

function money(cents) {
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
  }).format(Number(cents || 0) / 100);
}

function date(value) {
  const source = String(value || "");
  const dateOnly = source.match(/^\d{4}-\d{2}-\d{2}/)?.[0];
  const parsed = new Date(dateOnly ? `${dateOnly}T00:00:00Z` : source);
  if (Number.isNaN(parsed.getTime())) return safeText(source || "To be confirmed");
  return new Intl.DateTimeFormat("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(parsed);
}

function wrap(font, value, size, width, supported = STANDARD_CHARACTERS) {
  const output = [];
  for (const paragraph of safeText(value, supported).split("\n")) {
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
      if (font.widthOfTextAtSize(word, size) <= width) {
        line = word;
        continue;
      }
      let remainder = word;
      while (remainder) {
        let chunk = remainder;
        while (
          chunk.length > 1 &&
          font.widthOfTextAtSize(chunk, size) > width
        ) {
          chunk = chunk.slice(0, -1);
        }
        output.push(chunk);
        remainder = remainder.slice(chunk.length);
      }
      line = "";
    }
    if (line) output.push(line);
  }
  return output;
}

function rightText(page, font, value, options, supported = STANDARD_CHARACTERS) {
  const text = safeText(value, supported);
  page.drawText(text, {
    ...options,
    x: options.right - font.widthOfTextAtSize(text, options.size),
    font,
  });
}

function drawFooter(page, regular, pageNumber, pageCount) {
  page.drawLine({
    start: { x: MARGIN, y: 30 },
    end: { x: A4_WIDTH - MARGIN, y: 30 },
    thickness: 0.5,
    color: LINE,
  });
  page.drawText(
    `Server-prepared customer record | ${TRADE_QUOTE_ACCEPTANCE_PDF_VERSION}`,
    { x: MARGIN, y: 17, font: regular, size: 6.5, color: MUTED },
  );
  rightText(page, regular, `Page ${pageNumber} of ${pageCount}`, {
    right: A4_WIDTH - MARGIN,
    y: 17,
    size: 6.5,
    color: MUTED,
  });
}

function drawLabelValue(
  page,
  fonts,
  x,
  y,
  label,
  value,
  width,
  supported = STANDARD_CHARACTERS,
) {
  page.drawText(safeText(label).toUpperCase(), {
    x,
    y,
    font: fonts.bold,
    size: 6.7,
    color: MUTED,
  });
  const lines = wrap(
    fonts.bold,
    value,
    9.4,
    width,
    supported,
  ).slice(0, 2);
  lines.forEach((line, index) =>
    page.drawText(line, {
      x,
      y: y - 15 - index * 11,
      font: fonts.bold,
      size: 9.4,
      color: INK,
    }),
  );
}

function addAcceptanceEvidencePages(
  pdf,
  fonts,
  snapshot,
  supported,
) {
  let page;
  let y;
  const startPage = () => {
    page = pdf.addPage([A4_WIDTH, A4_HEIGHT]);
    page.drawRectangle({
      x: 0,
      y: A4_HEIGHT - 10,
      width: A4_WIDTH,
      height: 10,
      color: ACCENT,
    });
    page.drawText("ACCEPTANCE EVIDENCE", {
      x: MARGIN,
      y: A4_HEIGHT - MARGIN,
      font: fonts.bold,
      size: 18,
      color: INK,
    });
    page.drawText(safeText(snapshot.acceptance.reference, supported), {
      x: MARGIN,
      y: A4_HEIGHT - MARGIN - 22,
      font: fonts.regular,
      size: 7.5,
      color: MUTED,
    });
    y = A4_HEIGHT - MARGIN - 54;
  };
  const ensureSpace = (height) => {
    if (!page || y - height < 50) startPage();
  };
  const drawSection = (heading, value) => {
    const lines = wrap(
      fonts.regular,
      value,
      8.5,
      CONTENT_WIDTH,
      supported,
    );
    ensureSpace(35);
    page.drawText(heading, {
      x: MARGIN,
      y,
      font: fonts.bold,
      size: 7.5,
      color: ACCENT,
    });
    y -= 18;
    for (const line of lines) {
      ensureSpace(12);
      page.drawText(line, {
        x: MARGIN,
        y,
        font: fonts.regular,
        size: 8.5,
        color: INK,
      });
      y -= 11;
    }
    y -= 16;
  };

  startPage();
  drawSection("SIGNED ACCEPTANCE", snapshot.acceptance.statement);
  drawSection(
    "ACCEPTED SCOPE",
    snapshot.quote.selectedChoiceNames.length
      ? `The base issued quote plus: ${snapshot.quote.selectedChoiceNames.join(", ")}.`
      : "The base issued quote with no optional selections.",
  );
  if (snapshot.payment?.terms) {
    drawSection("PAYMENT NOTES", snapshot.payment.terms);
  }
}

function validSnapshot(snapshot) {
  return (
    snapshot &&
    snapshot.schemaVersion === TRADE_QUOTE_ACCEPTANCE_PDF_VERSION &&
    snapshot.quote?.number &&
    Number.isInteger(snapshot.quote?.versionNumber) &&
    snapshot.quote.versionNumber > 0 &&
    snapshot.customer?.name &&
    snapshot.business?.name &&
    snapshot.acceptance?.reference &&
    snapshot.acceptance?.signerName &&
    snapshot.acceptance?.decidedAt &&
    snapshot.acceptance?.statement
  );
}

export async function createTradeQuoteAcceptancePdfBytes(
  snapshot,
  suppliedFonts = {},
) {
  if (!validSnapshot(snapshot)) {
    throw new TypeError("A valid quote acceptance receipt snapshot is required.");
  }

  const pdf = await PDFDocument.create();
  const regularBytes = optionalFontBytes(suppliedFonts.regular);
  const boldBytes = optionalFontBytes(suppliedFonts.bold);
  const useEmbeddedFonts = Boolean(regularBytes && boldBytes);
  const regularCharacters = useEmbeddedFonts
    ? characterSet(regularBytes, "regular")
    : STANDARD_CHARACTERS;
  const boldCharacters = useEmbeddedFonts
    ? characterSet(boldBytes, "bold")
    : STANDARD_CHARACTERS;
  const supported = new Set(
    [...regularCharacters].filter((code) => boldCharacters.has(code)),
  );
  if (useEmbeddedFonts) pdf.registerFontkit(fontkit);
  const regular = useEmbeddedFonts
    ? await pdf.embedFont(regularBytes, { subset: false })
    : await pdf.embedFont(StandardFonts.Helvetica);
  const bold = useEmbeddedFonts
    ? await pdf.embedFont(boldBytes, { subset: false })
    : await pdf.embedFont(StandardFonts.HelveticaBold);
  const fonts = { regular, bold };
  const page = pdf.addPage([A4_WIDTH, A4_HEIGHT]);
  let y = A4_HEIGHT - MARGIN;

  page.drawRectangle({
    x: 0,
    y: A4_HEIGHT - 10,
    width: A4_WIDTH,
    height: 10,
    color: ACCENT,
  });
  page.drawText(safeText(snapshot.business.name, supported), {
    x: MARGIN,
    y,
    font: bold,
    size: 13,
    color: PRIMARY,
  });
  rightText(page, bold, "CUSTOMER RECORD", {
    right: A4_WIDTH - MARGIN,
    y: y + 1,
    size: 8,
    color: ACCENT,
  });
  const businessContact = [
    snapshot.business.phone,
    snapshot.business.email,
    snapshot.business.abn ? `ABN ${snapshot.business.abn}` : "",
  ]
    .filter(Boolean)
    .join(" | ");
  wrap(regular, businessContact, 7.2, CONTENT_WIDTH, supported)
    .slice(0, 2)
    .forEach((line, index) =>
      page.drawText(line, {
        x: MARGIN,
        y: y - 16 - index * 9,
        font: regular,
        size: 7.2,
        color: MUTED,
      }),
    );
  y -= 58;

  page.drawText("QUOTE ACCEPTANCE RECEIPT", {
    x: MARGIN,
    y,
    font: bold,
    size: 22,
    color: INK,
  });
  page.drawText("Decision recorded", {
    x: MARGIN,
    y: y - 22,
    font: bold,
    size: 8.5,
    color: ACCENT,
  });
  page.drawText(
    "This on-demand document records the exact server-saved acceptance and invoice summary.",
    { x: MARGIN, y: y - 39, font: regular, size: 8.5, color: MUTED },
  );
  y -= 67;

  page.drawRectangle({
    x: MARGIN,
    y: y - 104,
    width: CONTENT_WIDTH,
    height: 104,
    color: SOFT,
    borderColor: LINE,
    borderWidth: 0.7,
  });
  const columnWidth = (CONTENT_WIDTH - 42) / 3;
  drawLabelValue(
    page,
    fonts,
    MARGIN + 14,
    y - 18,
    "Quote",
    `${snapshot.quote.number} | Version ${snapshot.quote.versionNumber}`,
    columnWidth,
    supported,
  );
  drawLabelValue(
    page,
    fonts,
    MARGIN + 21 + columnWidth,
    y - 18,
    "Accepted by",
    snapshot.acceptance.signerName,
    columnWidth,
    supported,
  );
  drawLabelValue(
    page,
    fonts,
    MARGIN + 28 + columnWidth * 2,
    y - 18,
    "Recorded",
    date(snapshot.acceptance.decidedAt),
    columnWidth,
    supported,
  );
  drawLabelValue(
    page,
    fonts,
    MARGIN + 14,
    y - 69,
    "Acceptance reference",
    snapshot.acceptance.reference,
    CONTENT_WIDTH - 28,
    supported,
  );
  y -= 124;

  if (snapshot.invoice?.status === "issued") {
    page.drawRectangle({
      x: MARGIN,
      y: y - 92,
      width: CONTENT_WIDTH,
      height: 92,
      color: PRIMARY,
    });
    page.drawText("INVOICE", {
      x: MARGIN + 16,
      y: y - 19,
      font: bold,
      size: 7.2,
      color: rgb(0.72, 0.91, 0.85),
    });
    wrap(
      bold,
      snapshot.invoice.number,
      13.5,
      CONTENT_WIDTH - 32,
      supported,
    ).slice(0, 1).forEach((line) =>
      page.drawText(line, {
        x: MARGIN + 16,
        y: y - 40,
        font: bold,
        size: 13.5,
        color: rgb(1, 1, 1),
      }),
    );
    const invoiceRows = [
      ["AMOUNT DUE", money(snapshot.invoice.totalCents)],
      ["DUE", date(snapshot.invoice.dueAt)],
      ["GST", money(snapshot.invoice.taxCents)],
    ];
    invoiceRows.forEach(([label, value], index) => {
      const x = MARGIN + 16 + index * 166;
      page.drawText(label, {
        x,
        y: y - 61,
        font: bold,
        size: 6.4,
        color: rgb(0.72, 0.91, 0.85),
      });
      page.drawText(safeText(value, supported), {
        x,
        y: y - 78,
        font: bold,
        size: 10.2,
        color: rgb(1, 1, 1),
      });
    });
    y -= 112;
  } else {
    page.drawRectangle({
      x: MARGIN,
      y: y - 64,
      width: CONTENT_WIDTH,
      height: 64,
      color: WARNING,
      borderColor: rgb(0.91, 0.79, 0.45),
      borderWidth: 0.7,
    });
    page.drawText(
      snapshot.invoice?.status === "attention_required"
        ? "INVOICE RECONCILIATION IN PROGRESS"
        : "INVOICE BEING PREPARED",
      {
        x: MARGIN + 14,
        y: y - 20,
        font: bold,
        size: 8.3,
        color: WARNING_INK,
      },
    );
    page.drawText(
      "The acceptance is recorded. Confirm the invoice before making any payment.",
      {
        x: MARGIN + 14,
        y: y - 40,
        font: regular,
        size: 8.1,
        color: WARNING_INK,
      },
    );
    y -= 84;
  }

  if (snapshot.payment?.availability === "bank_transfer") {
    page.drawText("PAY BY BANK TRANSFER", {
      x: MARGIN,
      y,
      font: bold,
      size: 8.2,
      color: ACCENT,
    });
    rightText(page, bold, money(snapshot.payment.amountDueCents), {
      right: A4_WIDTH - MARGIN,
      y: y - 1,
      size: 13,
      color: INK,
    });
    y -= 16;
    const paymentRows = [
      ["Account name", snapshot.payment.accountName],
      ["BSB", snapshot.payment.bsb],
      ["Account number", snapshot.payment.accountNumber],
      ["Reference", snapshot.payment.reference],
    ];
    const boxWidth = (CONTENT_WIDTH - 10) / 2;
    const paymentLines = paymentRows.map(([, value]) =>
      wrap(bold, value, 8.4, boxWidth - 20, supported),
    );
    const rowHeights = [0, 1].map((row) =>
      Math.max(44, 27 + Math.max(
        paymentLines[row * 2].length,
        paymentLines[row * 2 + 1].length,
      ) * 9),
    );
    paymentRows.forEach(([label], index) => {
      const row = Math.floor(index / 2);
      const column = index % 2;
      const x = MARGIN + column * (boxWidth + 10);
      const boxTop = y - (row === 0 ? 0 : rowHeights[0] + 10);
      const boxY = boxTop - rowHeights[row];
      page.drawRectangle({
        x,
        y: boxY,
        width: boxWidth,
        height: rowHeights[row],
        color: SOFT,
        borderColor: LINE,
        borderWidth: 0.6,
      });
      page.drawText(label.toUpperCase(), {
        x: x + 10,
        y: boxTop - 16,
        font: bold,
        size: 6.1,
        color: MUTED,
      });
      paymentLines[index]
        .forEach((line, lineIndex) =>
          page.drawText(line, {
            x: x + 10,
            y: boxTop - 31 - lineIndex * 9,
            font: bold,
            size: 8.4,
            color: INK,
          }),
        );
    });
    y -= rowHeights[0] + rowHeights[1] + 26;
  } else {
    page.drawRectangle({
      x: MARGIN,
      y: y - 52,
      width: CONTENT_WIDTH,
      height: 52,
      color: WARNING,
      borderColor: rgb(0.91, 0.79, 0.45),
      borderWidth: 0.7,
    });
    page.drawText("PAYMENT DETAILS ARE BEING PREPARED", {
      x: MARGIN + 14,
      y: y - 19,
      font: bold,
      size: 8,
      color: WARNING_INK,
    });
    page.drawText("Do not pay using details from an unexpected message.", {
      x: MARGIN + 14,
      y: y - 37,
      font: regular,
      size: 8,
      color: WARNING_INK,
    });
    y -= 72;
  }

  if (snapshot.environmentNotice) {
    const noticeLines = wrap(
      bold,
      snapshot.environmentNotice,
      8.2,
      CONTENT_WIDTH - 28,
      supported,
    ).slice(0, 3);
    const height = Math.max(42, 22 + noticeLines.length * 11);
    page.drawRectangle({
      x: MARGIN,
      y: y - height,
      width: CONTENT_WIDTH,
      height,
      color: WARNING,
      borderColor: rgb(0.91, 0.79, 0.45),
      borderWidth: 0.7,
    });
    noticeLines.forEach((line, index) =>
      page.drawText(line, {
        x: MARGIN + 14,
        y: y - 19 - index * 11,
        font: bold,
        size: 8.2,
        color: WARNING_INK,
      }),
    );
    y -= height + 16;
  }

  const detailRows = [
    ["Prepared for", snapshot.customer.name],
    ["Job", `${snapshot.quote.workNumber} | ${snapshot.quote.workTitle}`],
    ["Site", snapshot.customer.siteSummary || "Not recorded"],
  ];
  detailRows.forEach(([label, value], index) => {
    const rowY = y - index * 24;
    page.drawText(label.toUpperCase(), {
      x: MARGIN,
      y: rowY,
      font: bold,
      size: 6.5,
      color: MUTED,
    });
    wrap(
      index === 0 ? bold : regular,
      value,
      8,
      CONTENT_WIDTH - 92,
      supported,
    ).slice(0, 2).forEach((line, lineIndex) =>
      page.drawText(line, {
        x: MARGIN + 86,
        y: rowY - lineIndex * 9,
        font: index === 0 ? bold : regular,
        size: 8,
        color: INK,
      }),
    );
  });

  addAcceptanceEvidencePages(pdf, fonts, snapshot, supported);

  const pages = pdf.getPages();
  pages.forEach((current, index) =>
    drawFooter(current, regular, index + 1, pages.length),
  );
  pdf.setTitle(
    `Quote acceptance receipt ${safeText(snapshot.acceptance.reference, supported)}`,
  );
  pdf.setAuthor(safeText(snapshot.business.name, supported));
  pdf.setSubject(
    `Accepted quote ${safeText(snapshot.quote.number, supported)} version ${snapshot.quote.versionNumber}`,
  );
  pdf.setKeywords([
    "quote acceptance",
    "invoice summary",
    snapshot.acceptance.reference,
    TRADE_QUOTE_ACCEPTANCE_PDF_VERSION,
  ]);
  pdf.setCreator("TLink by Australian Energy Assessments");
  pdf.setProducer("TLink by Australian Energy Assessments");
  pdf.setCreationDate(new Date(snapshot.acceptance.decidedAt));
  pdf.setModificationDate(new Date(snapshot.acceptance.decidedAt));

  return pdf.save({ useObjectStreams: false });
}
