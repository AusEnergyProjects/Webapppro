import { PDFDocument, rgb, type PDFFont } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import type { SwmsRecord, SWMS_TEMPLATE } from "./trade-swms.ts";

/** Rendering reads only the signed snapshot, with its original server timestamp. */
export async function renderSwmsPdf(record: SwmsRecord, template: typeof SWMS_TEMPLATE, snapshotSha256: string,
  fonts: { regular: Uint8Array; bold: Uint8Array }) {
  if (record.status !== "complete" || !record.signature || !Number.isFinite(Date.parse(record.completedAt))) throw new Error("SWMS_NOT_SIGNED");
  const pdf = await PDFDocument.create(); pdf.registerFontkit(fontkit);
  pdf.setCreationDate(new Date(record.completedAt)); pdf.setModificationDate(new Date(record.completedAt));
  pdf.setTitle(`${template.name} | ${record.context.workNumber}`); pdf.setAuthor(record.context.businessName);
  pdf.setSubject("Job-specific statement prepared and signed by the recorded worker");
  const regular = await pdf.embedFont(fonts.regular, { subset: true }), bold = await pdf.embedFont(fonts.bold, { subset: true });
  const ink = rgb(0.08, 0.15, 0.2), muted = rgb(0.3, 0.38, 0.42), accent = rgb(0.04, 0.36, 0.33);
  let page = pdf.addPage([595.28, 841.89]), y = 788;
  const nextPage = () => { page = pdf.addPage([595.28, 841.89]); y = 788; };
  function wrappedLines(value: string, size: number, font: PDFFont) {
    const clean = value.replace(/\r/g, "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
    const lines: string[] = [];
    for (const paragraph of clean.split("\n")) {
      let line = "";
      for (const word of paragraph.split(/\s+/).filter(Boolean)) {
        if (line && font.widthOfTextAtSize(`${line} ${word}`, size) > 499) { lines.push(line); line = ""; }
        if (font.widthOfTextAtSize(word, size) <= 499) { line = line ? `${line} ${word}` : word; continue; }
        // Split only an individual oversized token, preserving ordinary words.
        for (const character of word) {
          if (font.widthOfTextAtSize(line + character, size) > 499) { lines.push(line); line = ""; }
          line += character;
        }
      }
      lines.push(line || " ");
    }
    return lines;
  }
  function text(value: string, size = 10, font: PDFFont = regular) {
    for (const line of wrappedLines(value, size, font)) {
      if (y < 65) nextPage(); page.drawText(line, { x: 48, y, size, font, color: ink }); y -= size + 5;
    }
  }
  const heading = (label: string) => { if (y < 120) nextPage(); y -= 13; text(label, 12, bold); y -= 3; };
  text(record.context.businessName, 20, bold); if (record.context.abn) text(`ABN ${record.context.abn}`, 10);
  y -= 8; page.drawLine({ start: { x: 48, y }, end: { x: 547, y }, thickness: 1.5, color: accent }); y -= 26;
  text(template.name, 19, bold); text(`Job ${record.context.workNumber} | ${record.context.jobTitle}`, 11);
  if (record.context.siteAddress) text(`Site: ${record.context.siteAddress}`);
  text(`Assigned worker: ${record.context.scheduledWorker.name}`);
  text(`Signed: ${record.completedAt} | Template version ${template.version}`, 9);
  for (const field of template.fields) { heading(field.label); text(record.answers[field.key]); }
  const signedBy = `Authenticated worker | ${record.signature.signedAt}`;
  const signatureHeight = 33 + wrappedLines(template.declaration, 10, regular).length * 15 + 8 + 121
    + wrappedLines(record.signature.signerName, 12, bold).length * 17 + wrappedLines(signedBy, 9, regular).length * 14;
  if (y - signatureHeight < 65) nextPage();
  heading("Worker signature"); text(template.declaration); y -= 8;
  page.drawRectangle({ x: 48, y: y - 104, width: 300, height: 104, borderColor: muted, borderWidth: 0.5 });
  for (const stroke of record.signature.strokes) for (let index = 1; index < stroke.points.length; index++) {
    const a = stroke.points[index - 1], b = stroke.points[index];
    page.drawLine({ start: { x: 54 + a.x * 288, y: y - 4 - a.y * 96 }, end: { x: 54 + b.x * 288, y: y - 4 - b.y * 96 }, thickness: 1.5, color: ink });
  }
  y -= 121; text(record.signature.signerName, 12, bold); text(signedBy, 9);
  heading("Retained job record"); text(`Record ${record.id}`, 8); text(`Signed snapshot SHA-256: ${snapshotSha256}`, 7);
  text("Prepared and signed for this job. Review when the work or site conditions change.", 8);
  const pages = pdf.getPages();
  pages.forEach((sheet, index) => {
    sheet.drawText(`SWMS | ${record.context.workNumber} | ${index + 1} of ${pages.length}`, { x: 48, y: 31, size: 8, font: regular, color: muted });
  });
  return pdf.save();
}
