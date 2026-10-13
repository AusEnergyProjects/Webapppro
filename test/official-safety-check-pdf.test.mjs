import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import * as pdfLib from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import * as forms from '../src/lib/official-safety-check-forms.ts';
import * as activity from '../src/lib/trade-activity-forms.ts';
import * as flow from '../src/lib/trade-activity-form-flow.ts';
import { rentalImageWithinReportLimit } from '../src/lib/trade-rental-image-dimensions.mjs';

const read = name => fs.readFileSync(new URL(name, import.meta.url));
const validatorSource = ts.createSourceFile('validator.ts', read('../src/lib/trade-activity-forms-pdf.ts').toString(), ts.ScriptTarget.Latest, true);
const declaration = validatorSource.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'validateActivityEvidenceBytes');
const validatorCode = ts.transpileModule(declaration.getText(validatorSource).replace('export ', ''), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
const validateActivityEvidenceBytes = new Function('PDFDocument', 'rentalImageWithinReportLimit', `${validatorCode}; return validateActivityEvidenceBytes;`)(pdfLib.PDFDocument, rentalImageWithinReportLimit);
const compiled = ts.transpileModule(read('../src/lib/official-safety-check-pdf.ts').toString(), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
const loaded = { exports: {} };
new Function('require', 'module', 'exports', compiled)(specifier => {
  if (specifier === 'pdf-lib') return pdfLib;
  if (specifier === '@pdf-lib/fontkit') return fontkit;
  if (specifier === './official-safety-check-forms') return forms;
  if (specifier === './trade-activity-forms') return activity;
  if (specifier === './trade-activity-form-flow') return flow;
  if (specifier === './trade-activity-forms-pdf') return { validateActivityEvidenceBytes };
  if (specifier.endsWith('?inline')) {
    const file = specifier.slice(0, -7).replace('../../public/', '../public/');
    const mime = file.endsWith('.pdf') ? 'application/pdf' : 'image/png';
    return `data:${mime};base64,${read(file).toString('base64')}`;
  }
  throw new Error(`Unresolved renderer dependency ${specifier}`);
}, loaded, loaded.exports);
const { officialSafetyCheckAssets, renderOfficialSafetyCheckPdf } = loaded.exports;
const fonts = { regular: read('../public/fonts/LiberationSans-Regular.ttf'), bold: read('../public/fonts/LiberationSans-Bold.ttf') };
const photo = read('../public/tlink-icon-192.png');
function assertResourceFonts(document, resources, seen = new Set()) {
  if (!resources || seen.has(resources)) return;
  seen.add(resources);
  const fonts = resources.lookupMaybe(pdfLib.PDFName.of('Font'), pdfLib.PDFDict);
  for (const [name, reference] of fonts?.entries() || []) {
    assert.ok(document.context.lookup(reference) instanceof pdfLib.PDFDict, `Font ${name} must be materialized before source page embedding`);
  }
  const objects = resources.lookupMaybe(pdfLib.PDFName.of('XObject'), pdfLib.PDFDict);
  for (const [, reference] of objects?.entries() || []) {
    const object = document.context.lookup(reference);
    if (object instanceof pdfLib.PDFRawStream) assertResourceFonts(document, object.dict.lookupMaybe(pdfLib.PDFName.of('Resources'), pdfLib.PDFDict), seen);
  }
}

async function fixture(kind, repeats = 1) {
  const form = forms.createOfficialSafetyCheckForm(kind), answers = {};
  if (kind === 'gas') answers['$repeat.appliances'] = repeats;
  if (kind === 'electrical') answers['$repeat.circuits'] = repeats;
  for (const field of flow.expandedActivityFields(form, answers)) {
    if (field.type === 'photo' || field.type === 'document') continue;
    answers[field.key] = field.type === 'date' ? field.key.includes('next') ? field.key.includes('smoke') ? '2027-10-13' : '2028-10-13' : '2026-10-13'
      : field.type === 'boolean' ? true : field.type === 'number' ? 1 : field.type === 'select' ? field.options[0]
        : field.key === 'inspector_name' ? 'Example Inspector' : field.key === 'property_address' ? 'Example property, Victoria'
          : field.key === 'inspector_licence' ? 'EXAMPLE-ONLY' : `Example ${field.label}`;
  }
  const supporting = await pdfLib.PDFDocument.create(); supporting.addPage(); const supportingBytes = await supporting.save();
  const assets = officialSafetyCheckAssets(), evidence = [];
  for (const field of flow.expandedActivityFields(form, answers).filter(item => item.type === 'photo' || item.type === 'document')) {
    const id = `evidence-${evidence.length + 1}`, isPhoto = field.type === 'photo', bytes = isPhoto ? photo : supportingBytes;
    const contentType = isPhoto ? 'image/png' : 'application/pdf'; assets.set(id, { bytes, contentType });
    evidence.push({ id, fieldKey: field.key, fileName: `${id}.${isPhoto ? 'png' : 'pdf'}`, contentType, size: bytes.length,
      sha256: activity.activityHash(bytes), objectKey: `example/${id}`, capturedAt: '', uploadedAt: '2026-10-13T00:00:00.000Z',
      latitude: null, longitude: null, accuracy: null, metadataOrigin: 'file_upload' });
  }
  const record = { id: `example-${kind}`, ownerUid: 'example-owner', workOrderId: 'example-job', kind,
    recordNumber: `EXAMPLE-${kind.toUpperCase()}-NOT-A-LIVE-INSPECTION`, revision: 2, status: 'complete', form,
    formSha256: activity.activityHash(form), answers, evidence, signatures: [], signerDefaults: { customer: '', technician: 'Example Inspector' },
    createdAt: '2026-10-13T00:00:00.000Z', updatedAt: '2026-10-13T00:00:00.000Z', completedAt: '2026-10-13T00:00:00.000Z' };
  for (const item of form.declarations) {
    const declarationText = activity.activityDeclarationText(item, answers);
    record.signatures.push({ id: 'example-signature', declarationKey: item.key, signerName: 'Example Inspector', role: item.role,
      phase: item.phase, declarationText, declarationSha256: activity.activityHash(declarationText),
      scopeSha256: activity.activitySigningScope(record, item.phase), signedAt: '2026-10-13T00:00:00.000Z', actorUid: 'example-worker',
      strokes: [{ points: [{ x: .1, y: .2 }, { x: .4, y: .7 }, { x: .8, y: .3 }] }] });
  }
  const branding = { businessName: 'Example business | Demonstration only', businessEmail: 'example@example.test', businessPhone: '', logo: { bytes: photo, contentType: 'image/png' } };
  return { record, assets, branding };
}

for (const kind of ['electrical', 'gas']) test(`${kind} fills the retained official pages, uses real vector ink and keeps all completed fields in its continuation`, async () => {
  const value = await fixture(kind, kind === 'electrical' ? 12 : 5);
  assert.deepEqual(activity.activityMissing(value.record), []);
  const bytes = await renderOfficialSafetyCheckPdf(value.record, value.assets, fonts, value.branding);
  const pdf = await pdfLib.PDFDocument.load(bytes);
  assert.ok(pdf.getPageCount() >= 3); assert.equal(pdf.getForm().getFields().length, 0);
  assert.match(pdf.getTitle(), /Safety Check/); assert.ok(bytes.length > 50_000);
  for (const page of pdf.getPages()) {
    assert.equal(page.node.Annots()?.size() || 0, 0);
    assertResourceFonts(pdf, page.node.Resources());
  }
  const directory = process.env.SAFETY_PDF_QA_DIR;
  if (directory) { fs.mkdirSync(directory, { recursive: true }); fs.writeFileSync(path.join(directory, `official-${kind}-example.pdf`), bytes); }
});
test('source template alteration fails before any completed PDF is produced', async () => {
  const value = await fixture('electrical');
  value.assets.set('official-electrical-template', { bytes: photo, contentType: 'application/pdf' });
  await assert.rejects(renderOfficialSafetyCheckPdf(value.record, value.assets, fonts, value.branding), /SOURCE_INTEGRITY/);
});
test('missing genuine signature or required source answer cannot produce a completed report', async () => {
  const value = await fixture('gas'); value.record.signatures = [];
  await assert.rejects(renderOfficialSafetyCheckPdf(value.record, value.assets, fonts, value.branding), /RECORD_INCOMPLETE/);
});
test('required saved evidence must still match its retained bytes and checksum', async () => {
  const value = await fixture('gas'); value.assets.delete(value.record.evidence[0].id);
  await assert.rejects(renderOfficialSafetyCheckPdf(value.record, value.assets, fonts, value.branding), /EVIDENCE_INTEGRITY/);
});
