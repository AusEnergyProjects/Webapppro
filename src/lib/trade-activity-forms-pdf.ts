import { PDFDocument, rgb, type PDFFont } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { type ActivityRecord } from "./trade-activity-forms.ts";
import { expandedActivityFields } from "./trade-activity-form-flow.ts";
import { rentalImageWithinReportLimit } from "./trade-rental-image-dimensions.mjs";
import creditexProvider from "../data/creditex-declaration-provider.json" with { type: "json" };

export const CREDITEX_VEU_RIGHTS_VERSION = "veu-rights-v1";
export const CREDITEX_VEU_RIGHTS_SOURCE = "https://www.energy.vic.gov.au/victorian-energy-upgrades/about/your-rights";
// Provider-authored consumer handout. The retained government consumer factsheet
// is supplied alongside it; this is not a signed assignment or government form.
export const CREDITEX_VEU_RIGHTS_SECTIONS = [
  { title: "Your choice", text: "Joining VEU is voluntary. You must receive truthful information without pressure. Providers must identify themselves; unsolicited VEU marketing calls and doorknocking are prohibited. You can refuse an offer or ask a representative to leave." },
  { title: "Before you agree", text: "Receive your upgrade details, written quote, additional charges, decommissioning arrangements, work schedule, applicable cooling-off rights and installer contact details. Ask for explanations before signing. The contracting customer must be an adult who understands the agreement." },
  { title: "During and after the upgrade", text: "Work requires your permission. The installer must explain the work and any interruption to essential services. Afterwards, receive the operating instructions, warranty information and dispute contacts. Keep your contract, invoices and signed documents." },
  { title: "Questions or complaints", text: "Contact Creditex using the details below. A complaint must be acknowledged within five business days and reasonable steps taken to resolve it within 20 business days. Unresolved complaints can be raised with the Essential Services Commission or Consumer Affairs Victoria." },
] as const;

export async function renderCreditexConsumerRightsPdf(fonts: { regular: Uint8Array; bold: Uint8Array }) {
  const provider = creditexProvider;
  const pdf = await PDFDocument.create(); pdf.registerFontkit(fontkit);
  const documentVersionDate = new Date("2026-09-07T00:00:00.000Z");
  pdf.setCreationDate(documentVersionDate);
  pdf.setModificationDate(documentVersionDate);
  const regular = await pdf.embedFont(fonts.regular, { subset: true }); const bold = await pdf.embedFont(fonts.bold, { subset: true });
  const page = pdf.addPage([595.28, 841.89]); const ink = rgb(0.035, 0.1, 0.15); let y = 779;
  const write = (text: string, size = 11, font = regular) => {
    let current = "";
    for (const word of text.split(/\s+/)) {
      if (current && font.widthOfTextAtSize(`${current} ${word}`, size) > 499) {
        page.drawText(current, { x: 48, y, size, font, color: ink }); y -= size + 5; current = word;
      } else current += `${current ? " " : ""}${word}`;
    }
    page.drawText(current, { x: 48, y, size, font, color: ink }); y -= size + 5;
  };
  write("CREDITEX", 23, bold); y -= 7; write("Statement of Rights", 21, bold);
  write("Victorian Energy Upgrades", 12); y -= 20;
  for (const section of CREDITEX_VEU_RIGHTS_SECTIONS) { write(section.title, 13, bold); write(section.text); y -= 15; }
  write(provider.legalName, 12, bold); write(`ABN ${provider.abn} | ${provider.phone} | ${provider.email}`, 10); y -= 11;
  write("Further help", 11, bold);
  write("Essential Services Commission: esc.vic.gov.au | veu@esc.vic.gov.au", 10);
  write("Consumer Affairs Victoria: consumer.vic.gov.au", 10); y -= 15;
  write("Read this with the VEU consumer factsheet and your upgrade contract.", 10);
  write("Government consumer rights guidance:", 9); write(CREDITEX_VEU_RIGHTS_SOURCE, 8);
  page.drawText(`Creditex provider handout | ${CREDITEX_VEU_RIGHTS_VERSION} | 7 September 2026`, { x: 48, y: 35, size: 8, font: regular, color: ink });
  if (y < 55) throw new Error("CONSUMER_RIGHTS_PDF_LAYOUT_OVERFLOW");
  pdf.setTitle("Creditex Statement of Rights | Victorian Energy Upgrades"); pdf.setAuthor(provider.legalName);
  pdf.setSubject("Consumer handout to be provided before the upgrade contract");
  return pdf.save();
}

export async function validateActivityEvidenceBytes(bytes: Uint8Array, contentType: string) {
  try {
    if (contentType === "application/pdf") {
      const document = await PDFDocument.load(bytes);
      if (document.isEncrypted || document.getPageCount() < 1 || document.getPageCount() > 100) throw new Error("INVALID_ACTIVITY_FILE");
      return;
    }
    if (!rentalImageWithinReportLimit(bytes, contentType, { maxDimension: 8192, maxPixels: 25_000_000 })) throw new Error("INVALID_ACTIVITY_FILE");
    const document = await PDFDocument.create();
    const image = contentType === "image/jpeg" ? await document.embedJpg(bytes)
      : contentType === "image/png" ? await document.embedPng(bytes) : null;
    if (!image || image.width > 8192 || image.height > 8192 || image.width * image.height > 25_000_000) throw new Error("INVALID_ACTIVITY_FILE");
  } catch { throw new Error("INVALID_ACTIVITY_FILE"); }
}

export async function renderActivityFieldPdf(record: ActivityRecord,
  assets: Map<string, Uint8Array>, fonts: { regular: Uint8Array; bold: Uint8Array }) {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const regular = await pdf.embedFont(fonts.regular, { subset: true });
  const bold = await pdf.embedFont(fonts.bold, { subset: true });
  pdf.setTitle(`${record.form.title} | TLink field record`);
  pdf.setAuthor("TLink | CREDITEX PTY LTD");
  pdf.setSubject("Completed trade activity record provided to Creditex for review");
  const ink = rgb(0.035, 0.1, 0.15); const muted = rgb(0.28, 0.37, 0.4);
  let page = pdf.addPage([595.28, 841.89]); let y = 789;
  const nextPage = () => { page = pdf.addPage([595.28, 841.89]); y = 789; };
  function line(text: string, size = 10, font: PDFFont = regular) {
    const clean = text.replace(/\r/g, "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
    for (const paragraph of clean.split("\n")) {
      let current = "";
      for (const character of paragraph) {
        if (font.widthOfTextAtSize(current + character, size) > 499) {
          if (y < 55) nextPage();
          page.drawText(current, { x: 48, y, size, font, color: ink }); y -= size + 5; current = "";
        }
        current += character;
      }
      if (y < 55) nextPage();
      page.drawText(current || " ", { x: 48, y, size, font, color: ink }); y -= size + 5;
    }
  }
  function heading(text: string) {
    if (y < 105) nextPage();
    y -= 12; line(text, 13, bold); y -= 5;
  }
  line("TLink / Creditex", 22, bold);
  line(record.form.title, 16, bold);
  line(`Field record ${record.id} | Form version ${record.form.version}`, 9);
  line(`Submitted ${record.submittedAt} | Job ${record.workOrderId}`, 9);
  line("Completed field record provided to Creditex. Creditex reviews the records and manages certificate creation with the relevant program administrator.", 10);
  let section = "";
  const renderedImages = new Set<string>();
  for (const field of expandedActivityFields(record.form, record.answers)) {
    if (field.section !== section) { section = field.section; heading(section); }
    if (field.type === "photo" || field.type === "document") {
      line(`${field.label}${field.repeatGroup ? ` | Item ${field.repeatIndex + 1}` : ""}`, 10, bold);
      const evidence = record.evidence.filter((item) => item.fieldKey === field.key);
      if (!evidence.length) line("No file supplied (optional).", 9);
      for (const item of evidence) {
        line(item.fileName, 9);
        line(`Captured: ${item.capturedAt || "Capture time unavailable"} | Uploaded: ${item.uploadedAt}`, 8);
        line(`Location: ${item.latitude !== null && item.longitude !== null ? `${item.latitude}, ${item.longitude} | Accuracy ${item.accuracy ?? "unavailable"} m` : "Location unavailable"} | ${item.metadataOrigin === "device_capture" ? "Device capture" : "Uploaded file"}`, 8);
        line(`Original SHA-256: ${item.sha256}`, 7);
        if (item.previewSha256) line(`Report preview SHA-256: ${item.previewSha256} (original retained separately)`, 7);
        const bytes = assets.get(item.id);
        if (!bytes) throw new Error("ACTIVITY_EVIDENCE_UNAVAILABLE");
        if (item.contentType === "image/jpeg" || item.contentType === "image/png") {
          const embedded = item.previewObjectKey || item.contentType === "image/jpeg" ? await pdf.embedJpg(bytes) : await pdf.embedPng(bytes);
          const scale = Math.min(499 / embedded.width, 285 / embedded.height);
          const width = embedded.width * scale; const height = embedded.height * scale;
          if (y - height < 55) nextPage();
          page.drawImage(embedded, { x: 48, y: y - height, width, height }); y -= height + 14;
          renderedImages.add(item.id);
        }
      }
    } else {
      line(field.label, 10, bold);
      const value = record.answers[field.key];
      line(value === undefined ? "Not provided (optional)." : typeof value === "boolean" ? value ? "Yes" : "No" : String(value));
      y -= 3;
    }
  }
  const additionalImages = record.evidence.filter((item) => item.contentType.startsWith("image/") && !renderedImages.has(item.id));
  if (additionalImages.length) heading("Additional retained evidence");
  for (const item of additionalImages) {
    line(item.fileName, 10, bold);
    line(`Original question: ${item.fieldKey} | Captured: ${item.capturedAt || "Time unavailable"}`, 9);
    line(`Location: ${item.latitude === null || item.longitude === null ? "Unavailable" : `${item.latitude}, ${item.longitude}`} | Original SHA-256: ${item.sha256}`, 8);
    const bytes = assets.get(item.id);
    if (!bytes) throw new Error("ACTIVITY_EVIDENCE_UNAVAILABLE");
    const embedded = item.previewObjectKey || item.contentType === "image/jpeg" ? await pdf.embedJpg(bytes) : await pdf.embedPng(bytes);
    const scale = Math.min(499 / embedded.width, 285 / embedded.height); const width = embedded.width * scale; const height = embedded.height * scale;
    if (y - height < 55) nextPage();
    page.drawImage(embedded, { x: 48, y: y - height, width, height }); y -= height + 14;
  }
  heading("Declarations and signatures");
  for (const signature of record.signatures) {
    const declaration = record.form.declarations.find((item) => item.key === signature.declarationKey);
    if (!declaration) throw new Error("ACTIVITY_DECLARATION_INVALID");
    heading(declaration.title);
    line(signature.phase === "before" ? "Signed before work" : "Signed after work", 10, bold);
    line(signature.declarationText, 9);
    if (y < 175) nextPage();
    for (const stroke of signature.strokes) for (let index = 1; index < stroke.points.length; index++) {
      const a = stroke.points[index - 1]; const b = stroke.points[index];
      page.drawLine({ start: { x: 48 + a.x * 285, y: y - a.y * 100 }, end: { x: 48 + b.x * 285, y: y - b.y * 100 }, thickness: 1.5, color: ink });
    }
    y -= 115;
    line(`${signature.signerName} | ${signature.role} | ${signature.signedAt}`, 9);
    line(`Statement SHA-256: ${signature.declarationSha256}`, 7);
    line(`Signed record scope SHA-256: ${signature.scopeSha256}`, 7);
  }
  heading("Regulator sources");
  for (const source of record.form.sources) { line(source.title, 9, bold); line(source.url, 8); if (source.sha256) line(`Source SHA-256: ${source.sha256}`, 7); }
  if (record.form.reviewNotes.length) {
    heading("Creditex review notes");
    for (const note of record.form.reviewNotes) line(note, 9);
  }
  for (const item of record.evidence.filter((entry) => entry.contentType === "application/pdf")) {
    const bytes = assets.get(item.id);
    if (!bytes) throw new Error("ACTIVITY_EVIDENCE_UNAVAILABLE");
    const attachment = await PDFDocument.load(bytes);
    if (attachment.getPageCount() > 100) throw new Error("ACTIVITY_DOCUMENT_PAGE_LIMIT");
    const pages = await pdf.copyPages(attachment, attachment.getPageIndices());
    for (const attached of pages) pdf.addPage(attached);
  }
  const pages = pdf.getPages();
  for (let index = 0; index < pages.length; index++) pages[index].drawText(`TLink | ${record.id} | ${index + 1} / ${pages.length}`, { x: 48, y: 27, size: 7, font: regular, color: muted });
  return pdf.save();
}
