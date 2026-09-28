import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";
import type { AcceptedInvoiceDocumentSnapshot } from "./trade-accepted-invoice";
import { drawTradeDocumentHeader, drawTradeDocumentMetadata } from "./trade-document-pdf-layout.mjs";

export function acceptedInvoicePdfFilename(snapshot: AcceptedInvoiceDocumentSnapshot) {
  return `${snapshot.invoice.number.replace(/[^A-Za-z0-9_-]+/g, "-").slice(0, 100) || "invoice"}.pdf`;
}

const money = (cents: number) => new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(cents / 100);
function clean(value: string, font: PDFFont) {
  const supported = new Set(font.getCharacterSet());
  return Array.from(value.replace(/[\u2013\u2014]/g, "-")).map(character => character === "\n" || supported.has(character.codePointAt(0) ?? 0) ? character : "?").join("");
}
function wrap(font: PDFFont, value: string, size: number, width: number) {
  const lines: string[] = [];
  for (const paragraph of clean(value, font).split("\n")) {
    let line = "";
    for (const character of paragraph) {
      if (font.widthOfTextAtSize(line + character, size) > width) {
        const space = line.lastIndexOf(" ");
        lines.push(space > 0 ? line.slice(0, space) : line);
        line = space > 0 ? line.slice(space + 1) : "";
      }
      line += character;
    }
    lines.push(line);
  }
  return lines;
}

/** Renders the signed accepted scope directly, preserving negative certificate credits. */
export async function renderAcceptedInvoicePdf(snapshot: AcceptedInvoiceDocumentSnapshot): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setCreationDate(new Date(snapshot.invoice.issuedAt)); pdf.setModificationDate(new Date(snapshot.invoice.issuedAt));
  pdf.setTitle(`${snapshot.invoice.documentLabel} ${snapshot.invoice.number}`); pdf.setProducer("TLink");
  const regular = await pdf.embedFont(StandardFonts.Helvetica), bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(.04, .18, .2), accent = rgb(.05, .45, .36), muted = rgb(.35, .43, .43), line = rgb(.8, .86, .85);
  const margin = 42, width = 511.28, height = 841.89;
  let page = pdf.addPage([595.28, height]), y = height - margin;
  const nextPage = () => { page = pdf.addPage([595.28, height]); y = height - margin; };
  const need = (space: number) => { if (y - space < 55) nextPage(); };
  const text = (value: string, size = 10, strong = false) => {
    for (const valueLine of wrap(strong ? bold : regular, value, size, width)) {
      need(size + 5); page.drawText(valueLine, { x: margin, y, font: strong ? bold : regular, size, color: ink }); y -= size + 5;
    }
  };
  const business = Object.fromEntries(Object.entries(snapshot.business).map(([key, value]) => [key, clean(value, regular)]));
  y = drawTradeDocumentHeader(page, { business, logo: null, regular, bold, ink, accent, muted, margin, width, height, wrap });
  text(`${snapshot.invoice.documentLabel} ${snapshot.invoice.number}`, 18, true); y -= 12;
  y = drawTradeDocumentMetadata(page, [
    ["Prepared for", snapshot.customer.name], ["Issued", snapshot.invoice.issuedAt.slice(0, 10)], ["Due", snapshot.invoice.dueAt],
    ["Job", snapshot.work.number], ["Service address", snapshot.site.summary], ["Currency", "AUD"],
  ], { y, margin, width, regular, bold, ink, accent, line, wrap });
  text(snapshot.work.title, 12, true); y -= 12;
  for (const item of snapshot.lines) {
    const description = wrap(regular, item.description, 10, width - 125);
    need(Math.min(description.length * 15 + 40, height - margin - 55));
    const amount = money(item.totalCents);
    page.drawText(amount, { x: margin + width - bold.widthOfTextAtSize(amount, 10), y, font: bold, size: 10, color: ink });
    for (const part of description) { need(15); page.drawText(part, { x: margin, y, font: regular, size: 10, color: ink }); y -= 15; }
    text(`${item.section ? `${item.section} | ` : ""}Quantity ${item.quantityMilli / 1000}`, 8); y -= 8;
    page.drawLine({ start: { x: margin, y }, end: { x: margin + width, y }, thickness: .4, color: line }); y -= 20;
  }
  need(100);
  for (const [label, cents] of [["Subtotal ex GST", snapshot.totals.subtotalCents], ["GST", snapshot.totals.taxCents], ["Invoice total", snapshot.totals.totalCents]] as const) {
    const amount = money(cents); page.drawText(label, { x: margin + 260, y, font: bold, size: 10, color: ink });
    page.drawText(amount, { x: margin + width - bold.widthOfTextAtSize(amount, 10), y, font: bold, size: 10, color: ink }); y -= 23;
  }
  if (snapshot.payment.available) {
    y -= 20; need(110); text("Pay by bank transfer", 12, true);
    text(`Account: ${snapshot.payment.accountName}`); text(`BSB: ${snapshot.payment.bsb}   Account number: ${snapshot.payment.accountNumber}`);
    text(`Reference: ${snapshot.payment.reference}`);
    if (snapshot.payment.terms) { y -= 15; text("Payment terms", 11, true); text(snapshot.payment.terms, 9); }
  }
  const pages = pdf.getPages();
  pages.forEach((item, index) => item.drawText(`${clean(snapshot.invoice.number, regular)} | Page ${index + 1} of ${pages.length}`, { x: margin, y: 25, font: regular, size: 8, color: muted }));
  return pdf.save({ useObjectStreams: true });
}
