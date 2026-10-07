import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { PDFDocument } from 'pdf-lib';
import { renderVeuElectricalSafetyPdf, VEU_ELECTRICAL_PDF_FIELD_MAP } from '../src/lib/veu-electrical-safety-pdf.ts';
import { VEU_ELECTRICAL_PDF_WIDGETS } from '../src/lib/veu-electrical-safety-pdf-map.ts';
import { VEU_ELECTRICAL_TEMPLATE_BASE64, VEU_ELECTRICAL_TEMPLATE_SHA256 } from '../src/lib/veu-electrical-safety-template.ts';
import { activityHash } from '../src/lib/trade-activity-forms.ts';
import { createVeuElectricalForm } from '../src/lib/veu-electrical-safety-form.ts';
import { electricalFixture, signElectricalFixture } from './helpers/veu-electrical-fixture.mjs';
const fonts = { regular: fs.readFileSync(new URL('../public/fonts/LiberationSans-Regular.ttf', import.meta.url)), bold: fs.readFileSync(new URL('../public/fonts/LiberationSans-Bold.ttf', import.meta.url)) };

test('exact original widget map covers every official question or explicit table/evidence/control', () => {
  const mappings = VEU_ELECTRICAL_PDF_FIELD_MAP;
  assert.equal(new Set(mappings.map((item) => item.key)).size, mappings.length);
  const special = new Set(['life_support_record', 'appliance', 'appliance_location', 'appliance_hazard', 'other_hazards_present', 'other_hazard', 'other_hazard_action', 'electrical_works_performed']);
  assert.deepEqual(createVeuElectricalForm().fields.filter((field) => !special.has(field.key) && !mappings.some((item) => item.key === field.key)), []);
  for (const item of mappings) {
    const widgets = VEU_ELECTRICAL_PDF_WIDGETS.filter((widget) => widget.page === item.page && widget.name === item.name);
    assert.equal(widgets.length, item.values?.length || 1, item.key);
    for (const widget of widgets) assert.ok(widget.rect[0] < widget.rect[2] && widget.rect[1] < widget.rect[3]);
  }
});
test('official seven-page template is content-preserving and static with no writable fields', async () => {
  const bytes = Buffer.from(VEU_ELECTRICAL_TEMPLATE_BASE64, 'base64');
  assert.equal(activityHash(bytes), VEU_ELECTRICAL_TEMPLATE_SHA256);
  const pdf = await PDFDocument.load(bytes);
  assert.equal(pdf.getPageCount(), 7);
  assert.equal(pdf.catalog.has(pdf.context.obj('AcroForm')), false);
  assert.equal(pdf.getPages().some((page) => page.node.Annots()?.size()), false);
});
test('signed report preserves original pages plus traceable appendix and reproduces exact immutable bytes', async () => {
  const record = signElectricalFixture(electricalFixture());
  const first = await renderVeuElectricalSafetyPdf(record, new Map(), fonts);
  const second = await renderVeuElectricalSafetyPdf(record, new Map(), fonts);
  assert.deepEqual(first, second);
  const pdf = await PDFDocument.load(first);
  assert.ok(pdf.getPageCount() >= 8);
  assert.equal(pdf.getPages().some((page) => page.node.Annots()?.size()), false);
  assert.match(pdf.getSubject(), /no_rectification/);
});
test('rectification, repeated rows, long text and conditional onsite-isolation render without dropping values', async () => {
  const record = signElectricalFixture(electricalFixture({ assessment_outcome: 'rectification_required', work_tps: true, non_tps_cables: true, electrical_works_performed: true,
    ceiling_appliances: true, '$repeat.appliances': 12, other_hazards_present: true, '$repeat.other_hazards': 17,
    property_address: 'A long address '.repeat(35), hazard_actions: 'A documented risk control with a lengthy explanation. '.repeat(100) }));
  const bytes = await renderVeuElectricalSafetyPdf(record, new Map(), fonts);
  const pdf = await PDFDocument.load(bytes);
  assert.ok(pdf.getPageCount() > 9, 'full overflow is carried to continuation pages');
  const conditional = await renderVeuElectricalSafetyPdf(signElectricalFixture(electricalFixture({ main_switch_secured: false, assessment_outcome: 'onsite_isolation' })), new Map(), fonts);
  assert.match((await PDFDocument.load(conditional)).getSubject(), /onsite_isolation/);
});
test('renderer refuses unsigned, stale signatures and missing or modified life-support attachment', async () => {
  await assert.rejects(renderVeuElectricalSafetyPdf(electricalFixture(), new Map(), fonts), /INCOMPLETE/);
  const record = signElectricalFixture(electricalFixture()); record.answers.property_address = 'different';
  await assert.rejects(renderVeuElectricalSafetyPdf(record, new Map(), fonts), /INCOMPLETE/);
  const support = electricalFixture({ life_support: true, life_support_consent: true });
  const attachmentPdf = await PDFDocument.create(); attachmentPdf.addPage(); const bytes = await attachmentPdf.save();
  support.evidence.push({ id: 'consent', fieldKey: 'life_support_record', fileName: 'consent.pdf', contentType: 'application/pdf', size: bytes.length, sha256: activityHash(bytes), objectKey: 'private-consent', capturedAt: '', uploadedAt: support.completedAt, latitude: null, longitude: null, accuracy: null, metadataOrigin: 'file_upload' });
  signElectricalFixture(support);
  await assert.rejects(renderVeuElectricalSafetyPdf(support, new Map(), fonts), /EVIDENCE_UNAVAILABLE/);
  await assert.rejects(renderVeuElectricalSafetyPdf(support, new Map([['consent', new Uint8Array(bytes.length)]]), fonts), /EVIDENCE_UNAVAILABLE/);
  const good = await renderVeuElectricalSafetyPdf(support, new Map([['consent', bytes]]), fonts);
  assert.equal((await PDFDocument.load(good)).getPageCount(), 9);
});
