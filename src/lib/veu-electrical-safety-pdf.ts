import { PDFDocument, rgb, type PDFPage, type PDFFont } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import type { ActivitySignature } from './trade-activity-form-types';
import type { PiesaRecord } from './veu-electrical-assessment';
import { activityHash, validateActivityStrokes } from './trade-activity-forms.ts';
import { expandedActivityFields } from './trade-activity-form-flow.ts';
import { validateActivityEvidenceBytes } from './trade-activity-forms-pdf.ts';
import { VEU_ELECTRICAL_SOURCE_SHA256, veuElectricalCompletion } from './veu-electrical-safety-form.ts';
import { VEU_ELECTRICAL_TEMPLATE_BASE64, VEU_ELECTRICAL_TEMPLATE_SHA256 } from './veu-electrical-safety-template.ts';
import { VEU_ELECTRICAL_PDF_WIDGETS } from './veu-electrical-safety-pdf-map.ts';

type Rect = readonly [number, number, number, number];
type Mapping = { key: string; page: number; name: string; values?: readonly (string | boolean)[] };
const mapping: Mapping[] = [
  { key: 'job_reference', page: 0, name: 'Job reference ID' }, { key: 'property_address', page: 0, name: 'Address' }, { key: 'inspection_date', page: 0, name: 'Date of inspection' },
  { key: 'life_support', page: 0, name: 'Life support', values: [true, false] }, { key: 'life_support_consent', page: 0, name: 'Radio Button 2', values: [true] }, { key: 'life_support_plan', page: 0, name: 'Radio Button 3', values: [true] },
  ...['mains_identified', 'main_switch_accessible', 'main_switch_isolates', 'main_switch_secured', 'mains_deenergised', 'rcd_present'].map((key, i) => ({ key, page: 0, name: `Radio Button ${i + 4}`, values: [true, false] })),
  ...['rcd_tested', 'alternative_supply', 'alternative_instructions', 'alternative_isolator', 'alternative_conduit', 'alternative_protected', 'clear_conductive_conduit', 'cables_supported', 'cables_thermal_treatment'].map((key, i) => ({ key, page: 1, name: `Radio Button ${i + 10}`, values: [true, false] })),
  { key: 'tps_safe', page: 1, name: 'Radio Button 19', values: ['yes', 'no', 'not_applicable'] },
  ...['terminations_protected', 'plug_bases_fixed', 'conductive_insulation_safe', 'non_tps_cables', 'split_metal_conduit', 'damaged_cables'].map((key, i) => ({ key, page: 1, name: `Radio Button ${i + 20}`, values: [true, false] })),
  { key: 'recessed_luminaires', page: 2, name: 'Radio Button 26', values: [true, false] }, { key: 'luminaire_count', page: 2, name: 'Number of luminaries' },
  ...['prohibited_luminaires', 'ceiling_appliances', 'ceiling_flues'].map((key, i) => ({ key, page: 2, name: `Radio Button ${i + 27}`, values: [true, false] })),
  { key: 'hazard_actions', page: 2, name: 'Actions undertaken to minimise risk' }, { key: 'hazard_actions_effective', page: 3, name: 'Radio Button 30', values: [true, false] },
  { key: 'assessment_outcome', page: 3, name: 'Radio Button 31', values: ['no_rectification', 'rectification_required', 'onsite_isolation'] },
  ...['work_luminaires', 'work_circuit_rating', 'work_rcd', 'work_tps', 'work_basic_protection', 'work_other'].map((key, i) => ({ key, page: 4, name: `Check Box ${[6, 7, 8, 9, 30, 10][i]}`, values: [true] })),
  { key: 'rectification_notes', page: 4, name: 'Actions undertaken to minimise risk 2' },
  ...[['initial_electrician_licence', 'LE - IA - Licence no'], ['initial_electrician_name', 'LE - IA- Full name'], ['initial_rec_name', 'REC - IA - Name'], ['initial_rec_number', 'REC - IA - Reg no'], ['initial_rec_phone', 'REC - IA - Phone']].map(([key, name]) => ({ key, name, page: 4 })),
  { key: 'initial_correct', page: 4, name: 'Check Box 12', values: [true] },
  ...[['rectification_electrician_licence', 'LE - R - Licence no'], ['rectification_electrician_name', 'LE - R - Full name'], ['rectification_rec_name', 'REC - R - Name 2'], ['rectification_rec_number', 'REC - R - Reg no 2'], ['rectification_rec_phone', 'REC - R - Phone 2']].map(([key, name]) => ({ key, name, page: 5 })),
  ...['rectification_complete', 'rectification_luminaires', 'rectification_rcd', 'rectification_tps', 'rectification_protection', 'rectification_hazards', 'rectification_correct'].map((key, i) => ({ key, page: 5, name: `Check Box ${[18, 19, 33, 32, 31, 20, 21][i]}`, values: [true] })),
  { key: 'rectification_date', page: 5, name: 'Date of completion' }, { key: 'coes_number', page: 5, name: 'Certificate of Electrical Safety number' }, { key: 'certification_date', page: 5, name: 'Date of certification' },
  ...['owner_access', 'owner_assessment', 'owner_rectification', 'owner_information'].map((key, i) => ({ key, page: 6, name: `Check Box ${26 + i}`, values: [true] })),
  { key: 'owner_name', page: 6, name: 'Property owner name' }, { key: 'owner_date', page: 6, name: 'Date' },
];
export const VEU_ELECTRICAL_PDF_FIELD_MAP: readonly Mapping[] = mapping;

function wrapped(text: string, font: PDFFont, size: number, width: number) {
  const lines: string[] = [];
  for (const paragraph of text.split(/\r?\n/)) {
    let line = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      if (line && font.widthOfTextAtSize(`${line} ${word}`, size) > width) { lines.push(line); line = ''; }
      for (const char of `${line ? ' ' : ''}${word}`) {
        if (line && font.widthOfTextAtSize(line + char, size) > width) { lines.push(line); line = ''; }
        line += char;
      }
    }
    lines.push(line);
  }
  return lines;
}
function stroke(page: PDFPage, signature: ActivitySignature, rect: Rect) {
  const [x1, y1, x2, y2] = rect;
  for (const item of validateActivityStrokes(signature.strokes)) for (let i = 1; i < item.points.length; i++) {
    const a = item.points[i - 1], b = item.points[i];
    page.drawLine({ start: { x: x1 + a.x * (x2 - x1), y: y2 - a.y * (y2 - y1) }, end: { x: x1 + b.x * (x2 - x1), y: y2 - b.y * (y2 - y1) }, thickness: 0.8, color: rgb(0.02, 0.08, 0.15) });
  }
}
/** Completed static copy of the official seven pages, plus labelled overflow and retained attachments. */
export async function renderVeuElectricalSafetyPdf(record: PiesaRecord, assets: Map<string, Uint8Array>, fonts: { regular: Uint8Array; bold: Uint8Array }, documentDate = new Date(record.completedAt)) {
  const completion = veuElectricalCompletion(record);
  if (!completion.ready || !Number.isFinite(documentDate.getTime())) throw new Error('VEU_ELECTRICAL_PDF_INCOMPLETE');
  const bytes = Uint8Array.from(atob(VEU_ELECTRICAL_TEMPLATE_BASE64), (char) => char.charCodeAt(0));
  if (activityHash(bytes) !== VEU_ELECTRICAL_TEMPLATE_SHA256) throw new Error('VEU_ELECTRICAL_TEMPLATE_HASH_MISMATCH');
  const pdf = await PDFDocument.load(bytes); pdf.registerFontkit(fontkit);
  pdf.setCreationDate(documentDate); pdf.setModificationDate(documentDate);
  pdf.setTitle(`${record.recordNumber} - VEU pre-installation electrical safety assessment`);
  pdf.setSubject(`Official March 2026 form; assessment outcome: ${completion.outcome}; source SHA256 ${VEU_ELECTRICAL_SOURCE_SHA256}`);
  const regular = await pdf.embedFont(fonts.regular, { subset: true }); const bold = await pdf.embedFont(fonts.bold, { subset: true });
  // The original option circles live in widget appearance streams, not page
  // content. Restore their outlines after removing interactive annotations.
  for (const item of VEU_ELECTRICAL_PDF_WIDGETS.filter((item) => item.type === '/Btn')) {
    const [x1, y1, x2, y2] = item.rect;
    pdf.getPage(item.page).drawEllipse({ x: (x1 + x2) / 2, y: (y1 + y2) / 2, xScale: (x2 - x1) / 2, yScale: (y2 - y1) / 2, borderWidth: 0.35, borderColor: rgb(0.3, 0.3, 0.3) });
  }
  const fields = expandedActivityFields(record.form, record.answers); const visible = new Set(fields.map((field) => field.key));
  const overflow: { label: string; value: string }[] = [];
  const widget = (page: number, name: string) => VEU_ELECTRICAL_PDF_WIDGETS.filter((item) => item.page === page && item.name === name);
  const text = (page: number, rect: Rect, value: string, label: string) => {
    if (!value) return;
    const [x1, y1, x2, y2] = rect; const width = x2 - x1 - 2, height = y2 - y1;
    let size = 9; let lines = wrapped(value, regular, size, width);
    while (size > 7 && lines.length * (size + 1) > height) { size -= 0.5; lines = wrapped(value, regular, size, width); }
    if (lines.length * (size + 1) > height) {
      overflow.push({ label, value }); size = 7;
      lines = [`See continuation ${overflow.length}`];
      if (regular.widthOfTextAtSize(lines[0], size) > width) throw new Error('VEU_ELECTRICAL_PDF_FIELD_TOO_NARROW');
    }
    for (let i = 0; i < lines.length; i++) pdf.getPage(page).drawText(lines[i], { x: x1 + 1, y: y2 - size - 0.5 - i * (size + 1), size, font: regular, color: rgb(0.02, 0.08, 0.15) });
  };
  for (const item of mapping) {
    if (!visible.has(item.key)) continue;
    const value = record.answers[item.key]; if (value === undefined || value === '') continue;
    const positions = widget(item.page, item.name);
    if (positions.length !== (item.values?.length || 1)) throw new Error(`VEU_ELECTRICAL_PDF_MAPPING_${item.key}`);
    if (item.values) {
      const index = typeof value === 'number' ? -1 : item.values.indexOf(value); if (index < 0) continue;
      const [x1, y1, x2, y2] = positions[index].rect;
      pdf.getPage(item.page).drawLine({ start: { x: x1 + 2, y: y1 + 2 }, end: { x: x2 - 2, y: y2 - 2 }, thickness: 1 });
      pdf.getPage(item.page).drawLine({ start: { x: x1 + 2, y: y2 - 2 }, end: { x: x2 - 2, y: y1 + 2 }, thickness: 1 });
    } else text(item.page, positions[0].rect, String(value), fields.find((field) => field.key === item.key)?.label || item.key);
  }
  const table = (page: number, keys: string[], names: string[][], capacity: number) => {
    for (const field of fields.filter((item) => keys.includes(item.baseKey))) {
      const value = String(record.answers[field.key] ?? ''); if (!value) continue;
      if (field.repeatIndex >= capacity) { overflow.push({ label: `${field.label}, row ${field.repeatIndex + 1}`, value }); continue; }
      const name = names[keys.indexOf(field.baseKey)][field.repeatIndex]; const position = widget(page, name)[0];
      if (!position) throw new Error('VEU_ELECTRICAL_PDF_TABLE_MAPPING');
      text(page, position.rect, value, `${field.label}, row ${field.repeatIndex + 1}`);
    }
  };
  table(2, ['appliance', 'appliance_location', 'appliance_hazard'], [Array.from({ length: 10 }, (_, i) => `Appliance ${i + 1}`), Array.from({ length: 10 }, (_, i) => `Location ${i + 1}`), [1, 8, 9, 6, 7, 11, 12, 13, 14, 15].map((n) => `Hazard ${n}`)], 10);
  table(3, ['other_hazard', 'other_hazard_action'], [[1, 2, 3, 4, 5, 10, 16, 17, 18, 19, 20, 21, 22, 23].map((n) => `Hazard ${n}`), Array.from({ length: 14 }, (_, i) => `Hazard mitigation action taken ${i + 1}`)], 14);
  for (const [key, page, name] of [['rectification_electrician', 5, 'Signature - Privacy Statement'], ['property_owner', 6, 'Property owner - Signature']] as const) {
    const signature = record.signatures.find((item) => item.declarationKey === key);
    if (signature && record.form.declarations.some((item) => item.key === key) && (key === 'property_owner' || completion.outcome === 'rectification_required')) stroke(pdf.getPage(page), signature, widget(page, name)[0].rect);
  }
  // Keep outcome qualification and cryptographic record bindings with the exported signed document.
  let appendix = pdf.addPage([595.28, 841.89]); let y = 789;
  const appendixPages = [appendix];
  const newPage = () => { appendix = pdf.addPage([595.28, 841.89]); appendixPages.push(appendix); y = 789;
    appendix.drawText(`${record.recordNumber} | Assessment continuation`, { x: 48, y, size: 9, font: bold }); y -= 28; };
  const write = (value: string, size = 10, heading = false) => {
    const font = heading ? bold : regular;
    const lines = wrapped(value, font, size, 499);
    if (heading && y - lines.length * (size + 5) - 25 < 50) newPage();
    for (const line of lines) { if (y < 50) newPage(); appendix.drawText(line, { x: 48, y, size, font }); y -= size + 5; }
    y -= 5;
  };
  write('Assessment record and continuation', 18, true);
  write(`${record.recordNumber} | Record ${record.id} | Revision ${record.revision}`);
  write(`Recorded outcome: ${record.form.fields.find((field) => field.key === 'assessment_outcome')?.optionLabels?.[completion.outcome] || completion.outcome}`, 11, true);
  if (completion.outcome === 'onsite_isolation') write('CONDITIONAL: an electrician must attend at the start of insulation installation to isolate the relevant supply, lock out and tag, and confirm the work area is electrically safe. This report does not confirm that future attendance has occurred.', 10, true);
  write(`Completed record: ${record.completedAt}\nOfficial source SHA256: ${VEU_ELECTRICAL_SOURCE_SHA256}\nSaved form SHA256: ${record.formSha256}`, 8);
  write('B3 initial assessment attestation', 11, true);
  write(`${record.answers.initial_electrician_name} | Licence ${record.answers.initial_electrician_licence} | REC ${record.answers.initial_rec_name} (${record.answers.initial_rec_number}). Original declaration checkbox recorded as ${record.answers.initial_correct === true ? 'confirmed' : 'not confirmed'}. The official B3 section does not ask for a drawn signature.`, 9);
  if (record.initialAttestation) write(`Confirmed ${record.initialAttestation.confirmedAt} by actor ${record.initialAttestation.actorUid}\nAttested assessment scope SHA256 ${record.initialAttestation.scopeSha256}`, 8);
  for (const signature of record.signatures.filter((item) => item.declarationKey === 'property_owner' || completion.outcome === 'rectification_required')) {
    write(`${signature.signerName} | ${signature.declarationKey} | signed ${signature.signedAt}`, 10, true);
    write(`Actor ${signature.actorUid}\nDeclaration SHA256 ${signature.declarationSha256}\nSigned scope SHA256 ${signature.scopeSha256}`, 8);
  }
  for (let i = 0; i < overflow.length; i++) { write(`Continuation ${i + 1}: ${overflow[i].label}`, 11, true); write(overflow[i].value); }
  for (const evidence of record.evidence.filter((item) => visible.has(item.fieldKey))) {
    const content = assets.get(evidence.id);
    if (!content || content.byteLength !== evidence.size || activityHash(content) !== evidence.sha256) throw new Error('VEU_ELECTRICAL_EVIDENCE_UNAVAILABLE');
    await validateActivityEvidenceBytes(content, evidence.contentType);
    write(`Retained attachment: ${evidence.fileName}\nField: ${evidence.fieldKey}\nSHA256 ${evidence.sha256}`, 9);
    if (evidence.contentType === 'application/pdf') {
      const attachment = await PDFDocument.load(content);
      const pages = await pdf.copyPages(attachment, attachment.getPageIndices()); for (const page of pages) pdf.addPage(page);
    } else {
      const image = evidence.contentType === 'image/png' ? await pdf.embedPng(content) : await pdf.embedJpg(content);
      const page = pdf.addPage([595.28, 841.89]); const scale = Math.min(499 / image.width, 720 / image.height);
      page.drawText(evidence.fileName, { x: 48, y: 795, size: 9, font: regular });
      page.drawImage(image, { x: 48, y: 50, width: image.width * scale, height: image.height * scale });
    }
  }
  for (let i = 0; i < appendixPages.length; i++) appendixPages[i].drawText(`${record.recordNumber} | Record appendix ${i + 1} of ${appendixPages.length}`, { x: 48, y: 28, size: 8, font: regular });
  return pdf.save();
}
