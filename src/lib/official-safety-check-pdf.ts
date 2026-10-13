/// <reference types="vite/client" />
import { PDFDict, PDFDocument, PDFName, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import electricalTemplate from '../../public/forms/official-vic-electrical-safety-check.pdf?inline';
import gasTemplate from '../../public/forms/official-vic-gas-safety-check-june-2022.pdf?inline';
import tlinkLogo from '../../public/tlink-icon-192.png?inline';
import type { SafetyCheckRecord, SafetyCheckBranding } from './job-safety-check';
import type { CustomerPlanPdfFonts } from './customer-plan-pdf-fonts';
import { OFFICIAL_SAFETY_PDF_MAP } from './official-safety-check-forms';
import { activityHash, activityMissing } from './trade-activity-forms';
import { activityOptionLabel, expandedActivityFields } from './trade-activity-form-flow';
import { validateActivityEvidenceBytes } from './trade-activity-forms-pdf';

type Asset = { bytes: Uint8Array; contentType: string };
type Rect = readonly [number, number, number, number];
const sourceHash = {
  electrical: '5eb63d2e684c27951f844680fc242a8450cd5e733914b312121aa6141da73535',
  gas: 'd19910c417ff116801f80254ebd5ada99d5c2aaf56f336bc294a49907e348745',
};
function bytes(data: string) {
  const comma = data.indexOf(',');
  if (comma < 0 || !data.slice(0, comma).endsWith(';base64')) throw new Error('OFFICIAL_SAFETY_ASSET_INVALID');
  return Uint8Array.from(atob(data.slice(comma + 1)), character => character.charCodeAt(0));
}
export function officialSafetyCheckAssets(): Map<string, Asset> {
  return new Map([
    ['official-electrical-template', { bytes: bytes(electricalTemplate), contentType: 'application/pdf' }],
    ['official-gas-template', { bytes: bytes(gasTemplate), contentType: 'application/pdf' }],
    ['tlink-logo', { bytes: bytes(tlinkLogo), contentType: 'image/png' }],
  ]);
}
function wrapped(value: string, font: PDFFont, size: number, width: number) {
  const lines: string[] = [];
  for (const paragraph of value.split(/\r?\n/)) {
    let line = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      if (font.widthOfTextAtSize(word, size) > width) {
        if (line) { lines.push(line); line = ''; }
        let fragment = '';
        for (const character of word) {
          if (fragment && font.widthOfTextAtSize(fragment + character, size) > width) { lines.push(fragment); fragment = ''; }
          fragment += character;
        }
        line = fragment;
      } else if (line && font.widthOfTextAtSize(`${line} ${word}`, size) > width) { lines.push(line); line = word; }
      else line = line ? `${line} ${word}` : word;
    }
    lines.push(line);
  }
  return lines;
}
function date(value: string) { return /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10).split('-').reverse().join('/') : value; }

export async function renderOfficialSafetyCheckPdf(record: SafetyCheckRecord, assets: ReadonlyMap<string, Asset>, fonts: CustomerPlanPdfFonts, branding: SafetyCheckBranding): Promise<Uint8Array> {
  if (record.status !== 'complete' || activityMissing(record).length) throw new Error('OFFICIAL_SAFETY_RECORD_INCOMPLETE');
  for (const evidence of record.evidence) {
    const captured = assets.get(evidence.id);
    if (!captured || captured.contentType !== evidence.contentType || captured.bytes.length !== evidence.size
      || activityHash(captured.bytes) !== evidence.sha256) throw new Error('OFFICIAL_SAFETY_EVIDENCE_INTEGRITY');
    await validateActivityEvidenceBytes(captured.bytes, captured.contentType);
  }
  const asset = assets.get(`official-${record.kind}-template`);
  if (!asset || asset.contentType !== 'application/pdf' || activityHash(asset.bytes) !== sourceHash[record.kind]) throw new Error('OFFICIAL_SAFETY_SOURCE_INTEGRITY');
  const original = await PDFDocument.load(asset.bytes); original.registerFontkit(fontkit);
  const regular = await original.embedFont(fonts.regular, { subset: true });
  const form = original.getForm(), widgetPositions = new Map<string, Rect>();
  for (const field of form.getFields()) {
    const widgets = field.acroField.getWidgets();
    if (widgets.length !== 1) throw new Error(`OFFICIAL_SAFETY_WIDGET_AMBIGUOUS:${field.getName()}`);
    const rect = widgets[0].getRectangle();
    widgetPositions.set(field.getName(), [rect.x, rect.y, rect.x + rect.width, rect.y + rect.height]);
  }
  // The immutable completed copy uses verified answers and vector ink. Some
  // original fields have no normal appearance, so remove widget annotations
  // directly instead of asking PDFForm.removeField to resolve those streams.
  // Printed source text and table borders remain untouched.
  for (const page of original.getPages()) {
    const annotations = page.node.Annots();
    if (!annotations) continue;
    for (let index = annotations.size() - 1; index >= 0; index--) {
      const annotation = original.context.lookup(annotations.get(index), PDFDict);
      if (annotation.get(PDFName.of('Subtype')) === PDFName.of('Widget')) annotations.remove(index);
    }
  }
  original.catalog.delete(PDFName.of('AcroForm'));
  const continuation: { label: string; value: string }[] = [];
  const mapped = new Set<string>(), fields = expandedActivityFields(record.form, record.answers);
  const fieldLabel = (key: string, fallback: string) => {
    const field = fields.find(entry => entry.key === key);
    if (!field?.repeatGroup) return fallback;
    const group = field.repeatGroup === 'appliances' ? 'Appliance' : field.repeatGroup === 'circuits' ? 'Circuit' : 'Fault';
    return `${group} ${field.repeatIndex + 1} / ${fallback}`;
  };
  function write(page: PDFPage, rect: Rect, value: string, label: string) {
    const [left, bottom, right, top] = rect, width = right - left - 3, height = top - bottom - 2;
    if (width <= 2 || height <= 2) throw new Error('OFFICIAL_SAFETY_MAPPING_INVALID');
    let size = Math.min(10, height - 1), lines = wrapped(value, regular, size, width);
    while (size > 6.5 && lines.length * (size + 1) > height) { size -= .5; lines = wrapped(value, regular, size, width); }
    if (lines.length * (size + 1) > height) {
      continuation.push({ label, value }); lines = [`C${continuation.length}`]; size = 6.5;
      if (regular.widthOfTextAtSize(lines[0], size) > width) throw new Error('OFFICIAL_SAFETY_CONTINUATION_REFERENCE_TOO_NARROW');
    }
    lines.forEach((line, index) => page.drawText(line, { x: left + 1.5, y: top - size - 1 - index * (size + 1), size, font: regular, color: rgb(.04, .13, .17) }));
  }
  for (const item of OFFICIAL_SAFETY_PDF_MAP[record.kind]) {
    const page = original.getPage(item.page - 1), rect = item.rect || (item.widgetName ? widgetPositions.get(item.widgetName) : undefined);
    if (!rect) throw new Error(`OFFICIAL_SAFETY_MAPPING_MISSING:${item.key}`);
    const signature = record.signatures.find(entry => entry.declarationKey === item.key);
    if (signature) {
      for (const stroke of signature.strokes) for (let index = 1; index < stroke.points.length; index++) {
        const previous = stroke.points[index - 1], next = stroke.points[index];
        page.drawLine({ start: { x: rect[0] + previous.x * (rect[2] - rect[0]), y: rect[3] - previous.y * (rect[3] - rect[1]) },
          end: { x: rect[0] + next.x * (rect[2] - rect[0]), y: rect[3] - next.y * (rect[3] - rect[1]) }, thickness: 1, color: rgb(.04, .13, .17) });
      }
      continue;
    }
    const signed = item.key.startsWith('$signedAt.') ? record.signatures.find(entry => entry.declarationKey === item.key.slice(10))?.signedAt : undefined;
    if (item.value !== undefined && item.widgetName) page.drawRectangle({ x: rect[0], y: rect[1],
      width: rect[2] - rect[0], height: rect[3] - rect[1], borderWidth: .5, borderColor: rgb(.04, .13, .17) });
    const value = signed || record.answers[item.key];
    if (value === undefined || value === '') continue;
    mapped.add(item.key);
    if (item.value !== undefined) {
      if (value === item.value) {
        const pad = Math.min(2, (rect[2] - rect[0]) / 5, (rect[3] - rect[1]) / 5);
        page.drawLine({ start: { x: rect[0] + pad, y: rect[1] + pad }, end: { x: rect[2] - pad, y: rect[3] - pad }, thickness: 1 });
        page.drawLine({ start: { x: rect[0] + pad, y: rect[3] - pad }, end: { x: rect[2] - pad, y: rect[1] + pad }, thickness: 1 });
      } else if (item.widgetName && value === 'not_included') {
        page.drawText('NI', { x: rect[0], y: rect[1], size: 6, font: regular });
      } else if (item.widgetName && value === 'not_applicable') {
        // The source instructs the inspector to strike out the installation
        // part, rather than tick a not-applicable inspection result.
        const labelLeft = rect[0] < 300 ? 34.8 : item.key.startsWith('electrical.scope.') ? 183.72
          : item.key.startsWith('electrical.visual.') ? 240.48 : 261.72;
        page.drawLine({ start: { x: labelLeft, y: (rect[1] + rect[3]) / 2 }, end: { x: rect[0] - 3, y: (rect[1] + rect[3]) / 2 }, thickness: .6 });
      }
    } else {
      const field = fields.find(entry => entry.key === item.key);
      write(page, rect, field?.type === 'date' || signed ? date(String(value)) : field?.type === 'select' ? activityOptionLabel(String(value), field.optionLabels?.[String(value)]) : String(value), fieldLabel(item.key, item.label));
    }
  }
  for (const field of fields) {
    const value = record.answers[field.key];
    if (field.type === 'photo' || field.type === 'document' || mapped.has(field.key) || value === undefined || value === '') continue;
    continuation.push({ label: `${field.section} / ${fieldLabel(field.key, field.label)}`, value: field.type === 'date' ? date(String(value)) : field.type === 'select' ? activityOptionLabel(String(value), field.optionLabels?.[String(value)]) : String(value) });
  }
  const pdf = await PDFDocument.create(); pdf.registerFontkit(fontkit);
  const bodyFont = await pdf.embedFont(fonts.regular, { subset: true }), bold = await pdf.embedFont(fonts.bold, { subset: true });
  const tlink = assets.get('tlink-logo'); if (!tlink) throw new Error('OFFICIAL_SAFETY_BRAND_MISSING');
  const tlinkImage = await pdf.embedPng(tlink.bytes);
  const businessLogo = branding.logo ? branding.logo.contentType === 'image/png' ? await pdf.embedPng(branding.logo.bytes) : branding.logo.contentType === 'image/jpeg' ? await pdf.embedJpg(branding.logo.bytes) : undefined : undefined;
  const header = (page: PDFPage, label: string) => {
    page.drawRectangle({ x: 0, y: 790, width: 595.28, height: 51.89, color: rgb(.03, .18, .22) });
    let left = 27;
    if (businessLogo) { const ratio = Math.min(55 / businessLogo.width, 31 / businessLogo.height); page.drawImage(businessLogo, { x: 27, y: 801, width: businessLogo.width * ratio, height: businessLogo.height * ratio }); left = 94; }
    let nameSize = 13; while (nameSize > 8 && bold.widthOfTextAtSize(branding.businessName, nameSize) > 395 - left) nameSize -= .5;
    page.drawText(branding.businessName, { x: left, y: 815, size: nameSize, font: bold, color: rgb(1, 1, 1), maxWidth: 395 - left });
    page.drawText(label, { x: left, y: 800, size: 9, font: bodyFont, color: rgb(.67, .92, .85) });
    page.drawImage(tlinkImage, { x: 505, y: 800, width: 30, height: 30 }); page.drawText('TLink', { x: 540, y: 811, size: 11, font: bold, color: rgb(1, 1, 1) });
  };
  // Materialize newly embedded source fonts and flattened widget appearances
  // before copying their resource references into the branded document.
  await original.flush();
  const sourcePages = await pdf.embedPages(original.getPages());
  for (const embedded of sourcePages) {
    const page = pdf.addPage([595.28, 841.89]); header(page, record.form.title);
    const scale = Math.min(541 / embedded.width, 745 / embedded.height);
    page.drawPage(embedded, { x: (595.28 - embedded.width * scale) / 2, y: 34, width: embedded.width * scale, height: embedded.height * scale });
  }
  // Keep only the source form plus actual overflow and qualifications. Audit
  // hashes and original evidence remain in the immutable job record.
  let page: PDFPage | undefined, y = 751;
  const line = (value: string, heading = false) => {
    const font = heading ? bold : bodyFont, size = heading ? 11 : 10;
    for (const text of wrapped(value, font, size, 527)) {
      if (!page || y < 52) { page = pdf.addPage([595.28, 841.89]); header(page, 'Inspection record and continuation'); y = 751; }
      page.drawText(text, { x: 34, y, size, font, color: rgb(.04, .16, .2) }); y -= size + 5;
    }
    y -= 5;
  };
  if (continuation.length) {
    line(record.recordNumber, true); line(`Property: ${record.answers.property_address}`);
    for (const [index, item] of continuation.entries()) { line(`Continuation ${index + 1}: ${item.label}`, true); line(item.value); }
  }
  for (const [index, current] of pdf.getPages().entries()) current.drawText(`${record.recordNumber}  |  ${index + 1} / ${pdf.getPageCount()}`, { x: 34, y: 17, size: 8, font: bodyFont, color: rgb(.3, .43, .47) });
  const completedAt = new Date(record.completedAt); pdf.setCreationDate(completedAt); pdf.setModificationDate(completedAt);
  pdf.setTitle(`${record.form.title} | ${record.recordNumber}`); pdf.setAuthor(branding.businessName);
  return pdf.save({ useObjectStreams: false });
}
