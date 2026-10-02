import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import * as pdfLib from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { emptyMemberEngagement } from '../src/lib/trade-member-engagement.ts';
import * as agreement from '../src/lib/trade-member-agreement.ts';

const fonts = Object.fromEntries(['regular', 'bold'].map(weight => [weight, fs.readFileSync(new URL(`../public/fonts/LiberationSans-${weight === 'regular' ? 'Regular' : 'Bold'}.ttf`, import.meta.url))]));
const source = fs.readFileSync(new URL('../src/lib/trade-member-agreement-pdf.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
const moduleRecord = { exports: {} };
new Function('require', 'module', 'exports', compiled)(name => {
  if (name === 'pdf-lib') return pdfLib; if (name === '@pdf-lib/fontkit') return fontkit;
  if (name === './trade-member-agreement') return agreement; throw Error(name);
}, moduleRecord, moduleRecord.exports);
const { renderMemberAgreementPdf } = moduleRecord.exports;

test('templates prefill names and agreed terms without copying private identifiers', () => {
  const details = { ...emptyMemberEngagement, engagementType: 'employee', rateBasis: 'hourly', rateAmount: '48.50', paymentFrequency: 'weekly', startDate: '2026-10-05', bankAccountNumber: '9912345678', bankBsb: '999123', superMemberNumber: 'SECRET-SUPER' };
  for (const kind of ['employee', 'contractor']) {
    const body = agreement.memberAgreementTemplate(kind, 'Example Trade Pty Ltd', 'Alex Sample', details);
    assert.match(body, /Example Trade Pty Ltd/); assert.match(body, /Alex Sample/); assert.match(body, /AUD 48.50 per hour/); assert.match(body, /Weekly/); assert.match(body, /2026-10-05/);
    assert.doesNotMatch(body, /9912345678|999123|SECRET-SUPER/); assert.match(body, /signature: _+/); assert.match(body, /\[Complete\]/);
  }
});

test('employment terms and contractor status remain distinct and missing terms are explicit', () => {
  const employee = agreement.memberAgreementTemplate('employee', '', '', emptyMemberEngagement);
  const contractor = agreement.memberAgreementTemplate('contractor', '', '', { ...emptyMemberEngagement, rateBasis: 'per_job', rateAmount: '250.00' });
  assert.match(employee, /award or agreement entitlements/); assert.match(employee, /\[Full-time, part-time or casual/); assert.match(employee, /\[Agreed amount and pay basis\]/);
  assert.match(contractor, /AUD 250.00 per job/); assert.match(contractor, /contractor label does not determine legal worker status/); assert.match(contractor, /GST treatment/);
  assert.doesNotMatch(employee + contractor, /no super|waive|non.compete|restraint of trade/i);
});

test('stored business ABN and address prefill without claiming legal-name verification', () => {
  const body = agreement.memberAgreementTemplate('employee', 'Old name', 'Alex', emptyMemberEngagement, { businessName: 'Current Business', abn: '73675233557', address: '1 Example St, Melbourne' });
  assert.match(body, /Business name \(verify legal name\): Current Business/); assert.match(body, /Business ABN: 73675233557/); assert.match(body, /1 Example St, Melbourne/); assert.doesNotMatch(body, /Old name/);
});

test('both default agreements generate readable paginated unsigned PDFs', async () => {
  for (const kind of ['employee', 'contractor']) {
    const body = agreement.memberAgreementTemplate(kind, 'Example Trade Pty Ltd', 'Alex Sample', emptyMemberEngagement);
    const bytes = await renderMemberAgreementPdf(kind, body, fonts); const document = await pdfLib.PDFDocument.load(bytes);
    assert.match(document.getTitle(), /draft/); assert.equal(document.getForm().getFields().length, 0);
    assert.ok(document.getPageCount() >= 1 && document.getPageCount() <= 3);
    assert.ok(bytes.byteLength > 1000 && bytes.byteLength < 12 * 1024 * 1024);
  }
});

test('long words and extended names paginate; empty and excessive drafts are rejected', async () => {
  const bytes = await renderMemberAgreementPdf('employee', `Élodie O’Connor\n${'X'.repeat(2000)}\n${'Extra agreed term.\n'.repeat(300)}`, fonts);
  assert.ok((await pdfLib.PDFDocument.load(bytes)).getPageCount() > 2);
  await assert.rejects(() => renderMemberAgreementPdf('employee', '', fonts), /between 1 and 20,000/);
  await assert.rejects(() => renderMemberAgreementPdf('employee', 'x'.repeat(20001), fonts), /between 1 and 20,000/);
});

test('template saving uses the private owner file pathway and does not send or sign', () => {
  const ui = fs.readFileSync(new URL('../src/components/TradeMemberAgreementTemplates.tsx', import.meta.url), 'utf8');
  assert.match(ui, /form.set\('scope', 'employment'\)/); assert.match(ui, /form.set\('category', 'other'\)/);
  assert.match(ui, /result.file.memberId !== memberId/); assert.match(ui, /useTradeBusinessFetch/);
  assert.match(ui, /beforeunload/); assert.match(ui, /AGREEMENT_GUIDANCE\[kind\]/);
  assert.doesNotMatch(ui, /localStorage|dangerouslySetInnerHTML|sendEmail|signedAt|signature:/);
});
