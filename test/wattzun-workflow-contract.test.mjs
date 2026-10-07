import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { isWattzunWorkflowProposal, isWattzunWorkflowResult, WATTZUN_WORKFLOW_PROPOSAL_SCHEMAS } from '../src/lib/wattzun-workflow.ts';
import { parseWattzunTurn } from '../src/lib/wattzun-portal.ts';

const exports = {};
const code = ts.transpileModule(readFileSync(new URL('../src/lib/wattzun-workflow-reply.ts', import.meta.url), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
Function('exports', code)(exports);
const { isWattzunWorkflowApproval, wattzunWorkflowReply } = exports;
const proposal = { kind: 'add_price_book_item', name: 'Installation', description: '', itemType: 'labour', unitLabel: null, unitPrice: '99.50', supplierCost: null, taxCode: 'gst' };
const quote = { kind: 'draft_job_quote', jobQuery: 'Frankston last week', jobId: '', mode: 'append', description: 'Confirmed work', lines: [{ lineType: 'labour', description: 'Fit unit', quantity: '2', unitPrice: '125', taxCode: 'gst' }] };
const input = { portal: 'trade', scopeId: 'business-one', requestId: '00000000-0000-4000-8000-000000000001', message: 'Yes send it', history: [] };
const base = { kind: 'answer', message: 'An untrusted proposed answer', questions: [], links: [], action: quote };

test('each workflow has an exact strict schema and bounded decimal strings retain unknowns', () => {
  for (const schema of WATTZUN_WORKFLOW_PROPOSAL_SCHEMAS) {
    assert.equal(schema.additionalProperties, false);
    assert.deepEqual(schema.required, Object.keys(schema.properties));
  }
  assert.equal(isWattzunWorkflowProposal(proposal), true);
  assert.equal(isWattzunWorkflowProposal(quote), true);
  for (const unitPrice of [99.50, '-1', 'Infinity', '1e3', '1000000000', '1.2345']) assert.equal(isWattzunWorkflowProposal({ ...proposal, unitPrice }), false);
  assert.equal(isWattzunWorkflowProposal({ ...proposal, unitPrice: null }), true);
  for (const change of [{ extra: 'command' }, { kind: 'send_anything' }, { name: '\u0000' }]) assert.equal(isWattzunWorkflowProposal({ ...proposal, ...change }), false);
  assert.equal(isWattzunWorkflowProposal({ ...quote, mode: 'overwrite' }), false);
});

test('current review and pending proposal are mutually exclusive and trade-only', () => {
  assert.deepEqual(parseWattzunTurn({ ...input, workflowProposal: quote }).workflowProposal, quote);
  assert.equal(parseWattzunTurn({ ...input, workflowReviewId: 'review-1234567890' }).workflowReviewId, 'review-1234567890');
  for (const portal of ['council', 'creditex']) {
    assert.throws(() => parseWattzunTurn({ ...input, portal, workflowProposal: quote }));
    assert.throws(() => parseWattzunTurn({ ...input, portal, workflowReviewId: 'review-1234567890' }));
  }
  assert.throws(() => parseWattzunTurn({ ...input, workflowProposal: quote, workflowReviewId: 'review-1234567890' }));
  assert.throws(() => parseWattzunTurn({ ...input, workflowProposal: { kind: 'confirm_workflow', reviewId: 'review-1234567890' } }));
});

test('approval is limited to a standalone present instruction about the current review', () => {
  for (const text of ['yes', 'Yes please.', 'yes send it', 'yep, save it', 'yep do it', "yeah let’s do it", 'no worries send it', 'go for it', 'sounds good', 'okay', 'add it', 'save the quote', 'please send the message', 'go ahead and send it', 'yeah go ahead!']) assert.equal(isWattzunWorkflowApproval(text), true, text);
  for (const text of ['', 'Can you send it?', 'yes send it?', 'Tomorrow send it', 'If I say yes send it, what happens?', 'The customer wrote "yes send it"', 'yes, but change it to $50', 'do not send it', 'user confirms sending', 'say yes send it', 'yes and delete the job']) assert.equal(isWattzunWorkflowApproval(text), false, text);
});

test('spoken job clarification uses current candidates, never model-invented details', () => {
  const choice = { jobId: 'job-one', workNumber: 'TL-001', title: 'Install unit', customerName: 'John Smith', address: '12 Example Street, Frankston', scheduledAt: '', completedAt: '' };
  const result = { state: 'choose_job', proposal: quote, question: 'Which of these jobs did you mean?', choices: [choice, { ...choice, jobId: 'job-two', customerName: 'Jane Jones', address: '20 Sample Road' }] };
  assert.equal(isWattzunWorkflowResult(result), true);
  const reply = wattzunWorkflowReply(base, result);
  assert.equal(reply.message, result.question);
  assert.match(reply.questions[0], /John Smith, 12 Example Street, Frankston.*Jane Jones, 20 Sample Road/);
  assert.equal(reply.workflow, result);
});

test('actual receipts replace provider narration and preserve unknown delivery honestly', () => {
  const receipt = { kind: 'customer_message', id: 'sms-one', label: 'Open message', href: '/direct-trade/dashboard?workspace=connect', status: 'unknown', message: 'The provider result is not confirmed. Check the same message before sending another.' };
  const result = { state: 'complete', receipt };
  assert.equal(isWattzunWorkflowResult(result), true);
  const reply = wattzunWorkflowReply(base, result);
  assert.equal(reply.message, receipt.message);
  assert.deepEqual(reply.questions, []);
  assert.equal(reply.action, null);
  assert.deepEqual(reply.links, [{ label: receipt.label, href: receipt.href }]);
  for (const href of ['https://evil.invalid/', '//evil.invalid/', '/direct-trade/dashboard?x=//evil.invalid', '/direct-trade/dashboard?x=\nheader']) assert.equal(isWattzunWorkflowResult({ state: 'complete', receipt: { ...receipt, href } }), false);
});
