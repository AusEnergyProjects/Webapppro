import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { isWattzunWorkflowProposal, isWattzunWorkflowResult, WATTZUN_WORKFLOW_PROPOSAL_SCHEMAS } from '../src/lib/wattzun-workflow.ts';
import { parseWattzunTurn } from '../src/lib/wattzun-portal.ts';
import { PRICE_BOOK_ITEM_TYPES, PRICE_BOOK_UNITS } from '../src/lib/trade-price-book.ts';

const exports = {};
const code = ts.transpileModule(readFileSync(new URL('../src/lib/wattzun-workflow-reply.ts', import.meta.url), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
Function('exports', code)(exports);
const { isWattzunWorkflowApproval, isWattzunFormCompletionApproval, isWattzunFormStepApproval, wattzunWorkflowReply } = exports;
const proposal = { kind: 'add_price_book_item', name: 'Installation', description: '', itemType: 'labour', unitLabel: null, unitPrice: '99.50', supplierCost: null, taxCode: 'gst' };
const quote = { kind: 'draft_job_quote', jobQuery: 'Frankston last week', jobId: '', mode: 'append', description: 'Confirmed work', lines: [{ lineType: 'labour', description: 'Fit unit', quantity: '2', unitPrice: '125', taxCode: 'gst' }] };
const input = { portal: 'trade', scopeId: 'business-one', requestId: '00000000-0000-4000-8000-000000000001', message: 'Yes send it', history: [] };
const base = { kind: 'answer', message: 'An untrusted proposed answer', questions: [], links: [], action: quote };

test('form proposals preserve typed answers and reject duplicate, unsafe and oversized patches', () => {
  const form = { kind: 'fill_form', jobQuery: '', jobId: 'job-one', formKind: 'work_pack', formId: 'form-one', answers: [
    { fieldKey: 'units[instance-one].quantity', value: 2 }, { fieldKey: 'site.access', value: false }, { fieldKey: 'notes', value: 'Side gate' }] };
  assert.equal(isWattzunWorkflowProposal(form), true);
  for (const answers of [[], Array(21).fill({ fieldKey: 'notes', value: 'x' }), [{ fieldKey: 'notes', value: 'x' }, { fieldKey: 'notes', value: 'y' }],
    [{ fieldKey: '__proto__', value: 'x' }], [{ fieldKey: 'a.constructor.x', value: true }], [{ fieldKey: 'notes', value: 'x'.repeat(2001) }], [{ fieldKey: 'quantity', value: Infinity }], [{ fieldKey: 'notes', value: { nested: true } }]]) {
    assert.equal(isWattzunWorkflowProposal({ ...form, answers }), false);
  }
  const review = { state: 'review', reviewId: 'review-1234567890', expiresAt: '2026-10-07T12:00:00.000Z', kind: 'fill_form', heading: 'Save form answers', summary: 'These are draft answers.', confirmationLabel: 'Save form answers', lines: [{ label: 'Site access', value: 'Side gate' }] };
  assert.equal(isWattzunWorkflowResult(review), true);
  const reply = wattzunWorkflowReply(base, review);
  assert.match(reply.message, /Site access: Side gate/); assert.match(reply.questions[0], /save these answers.*draft/);
});

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

test('canonical repeat keys and multiselect arrays are bounded without accepting arbitrary answer structures', () => {
  const form = { kind: 'fill_form', jobQuery: '', jobId: 'job-one', formKind: 'work_pack', formId: 'form-one', answers: [{ fieldKey: 'choices', value: ['a', 'b'] }] };
  assert.equal(isWattzunWorkflowProposal(form), true);
  const longest = `${'s'.repeat(180)}[${'i'.repeat(180)}].${'p'.repeat(180)}`;
  for (const key of [longest, '$repeat.units', '$repeat.units[]']) assert.equal(isWattzunWorkflowProposal({ ...form, answers: [{ fieldKey: key, value: 2 }] }), true, key);
  for (const key of ['$other.units', '$repeat.', '$repeat.units[other]', '$repeat.constructor', '$repeat.units.__proto__', 'a'.repeat(601)]) assert.equal(isWattzunWorkflowProposal({ ...form, answers: [{ fieldKey: key, value: 2 }] }), false, key);
  for (const value of [Array(101).fill('a'), ['a', 'a'], ['a', 1], [true], ['x'.repeat(2001)], [{ option: 'a' }]]) assert.equal(isWattzunWorkflowProposal({ ...form, answers: [{ fieldKey: 'choices', value }] }), false);
  const schema = WATTZUN_WORKFLOW_PROPOSAL_SCHEMAS.find(item => item.properties.kind.enum[0] === 'fill_form');
  assert.equal(schema.properties.answers.items.properties.fieldKey.maxLength, 600);
  const arrays = schema.properties.answers.items.properties.value.anyOf.find(item => item.type === 'array');
  assert.equal(arrays.maxItems, 100); assert.equal(arrays.uniqueItems, true);
});

test('completion identifies only the current form and requires a distinct present confirmation', () => {
  const completion = { kind: 'complete_form', jobQuery: '', jobId: 'job-one', formKind: 'job_form', formId: 'form-one' };
  assert.equal(isWattzunWorkflowProposal(completion), true);
  for (const change of [{ jobId: '' }, { formId: '' }, { formKind: 'arbitrary' }, { signature: 'spoken' }, { answers: [] }]) assert.equal(isWattzunWorkflowProposal({ ...completion, ...change }), false);
  const review = { state: 'review', reviewId: 'review-1234567890', expiresAt: '2026-10-07T12:00:00.000Z', kind: 'complete_form', heading: 'Complete installation form', summary: 'The recorded answers and required evidence are ready.', confirmationLabel: 'Complete form', lines: [{ label: 'Form', value: 'Installation' }] };
  const result = wattzunWorkflowReply(base, review); assert.match(result.questions[0], /complete and submit/); assert.match(result.message, /Form: Installation/);
  for (const phrase of ['Complete this form now', 'Yes, submit it', 'Please complete and submit this form', 'Yes please']) assert.equal(isWattzunFormCompletionApproval(phrase), true);
  for (const phrase of ['Save these answers', 'Send it', 'Add it', 'Save the quote', 'When we are done complete it', 'The customer said submit it', 'Maybe complete this form tomorrow']) assert.equal(isWattzunFormCompletionApproval(phrase), false);
});

test('governed form steps require present consent for the exact current source or operation and cannot sign or declare by voice', () => {
  const variants = [
    [{ kind: 'reference_document', fieldKey: 'source', sourceArtifactId: 'artifact-one', acknowledged: true }, { kind: 'reference_document', fieldKey: 'source', sourceArtifactId: 'artifact-one', sourceArtifactSha256: 'a'.repeat(64), title: 'Official instructions', text: 'Read these supplied instructions.', mode: 'confirmed' }, 'I have read and understood that document'],
    [{ kind: 'calculator', dependencyKey: 'calculator-one' }, { kind: 'calculator', dependencyKey: 'calculator-one' }, 'Run the calculator now'],
    [{ kind: 'prepare_signing' }, { kind: 'prepare_signing' }, 'Prepare signing now'],
    [{ kind: 'scenario', dependencyKey: 'scenario-one', scenarioCode: 'A1' }, { kind: 'scenario', dependencyKey: 'scenario-one', scenarioCodes: ['A1'] }, 'Use scenario A1'],
  ];
  for (const [step, current, phrase] of variants) {
    const proposal = { kind: 'form_step', jobQuery: '', jobId: 'job-one', formKind: 'work_pack', formId: 'pack-one', step };
    assert.equal(isWattzunWorkflowProposal(proposal), true); assert.equal(isWattzunFormStepApproval(phrase, step, current), true, phrase);
    assert.equal(isWattzunFormStepApproval('Yes', step, current), true);
    for (const refused of ['Save this quote', 'Send it', 'Save these answers', 'Do not do it', 'Maybe tomorrow', 'The customer said yes', 'If I say yes', 'Yes, but change it', 'Yes?']) assert.equal(isWattzunFormStepApproval(refused, step, current), false, refused);
    assert.equal(isWattzunFormStepApproval('Yes', step, { kind: 'calculator', dependencyKey: 'different' }), false);
  }
  const source = variants[0]; assert.equal(isWattzunFormStepApproval('Yes', { ...source[0], sourceArtifactId: 'different' }, source[1]), false);
  for (const step of [{ kind: 'declaration', fieldKey: 'declaration', acknowledged: true }, { kind: 'signature', fieldKey: 'signature', signed: true }]) {
    assert.equal(isWattzunWorkflowProposal({ kind: 'form_step', jobQuery: '', jobId: 'job-one', formKind: 'work_pack', formId: 'pack-one', step }), false);
    assert.equal(isWattzunFormStepApproval('I confirm this declaration', step, step), false);
    assert.equal(isWattzunFormStepApproval('Yes', step, step), false);
  }
});

test('official product and scenario approval binds exact candidate pairs and never guesses an ambiguous yes or quantity', () => {
  const current = { kind: 'official_product', dependencyKey: 'product-one', minimumCount: 1, maximumCount: 2, search: 'heat pump', truncated: false,
    choices: [{ selectionId: 'p1', snapshotId: 'snapshot1', label: 'Brand A Model One', brand: 'Brand A', model: 'Model One' }, { selectionId: 'p2', snapshotId: 'snapshot2', label: 'Brand B Model Two', brand: 'Brand B', model: 'Model Two' }] };
  const step = { kind: 'official_product', dependencyKey: 'product-one', search: 'heat pump', selections: [{ selectionId: 'p2', snapshotId: 'snapshot2', quantity: 1 }] };
  for (const phrase of ['Use the second one', 'Select Model Two', 'Option 2']) assert.equal(isWattzunFormStepApproval(phrase, step, current), true, phrase);
  for (const phrase of ['Yes', 'Use the first one', 'I used Model Two yesterday', 'I used Model Two', 'I will use Model Two', 'I think Model Two', 'The customer chose Model Two', 'Maybe Model Two', 'The customer said use Model Two']) assert.equal(isWattzunFormStepApproval(phrase, step, current), false, phrase);
  assert.equal(isWattzunFormStepApproval('Use Model Two', { ...step, selections: [{ ...step.selections[0], snapshotId: 'wrong' }] }, current), false);
  assert.equal(isWattzunFormStepApproval('Use Model Two', { ...step, selections: [{ ...step.selections[0], quantity: 3 }] }, current), false);
  assert.equal(isWattzunFormStepApproval('Use 3 Model Two', { ...step, selections: [{ ...step.selections[0], quantity: 3 }] }, current), true);
  const ambiguous = { ...current, choices: [{ ...current.choices[0], model: 'Model10' }, { ...current.choices[1], model: 'Model100' }] };
  assert.equal(isWattzunFormStepApproval('Use Model100', { ...step, selections: [{ selectionId: 'p1', snapshotId: 'snapshot1', quantity: 1 }] }, ambiguous), false);
  const duplicates = { ...current, choices: current.choices.map(choice => ({ ...choice, model: 'Shared Model' })) };
  assert.equal(isWattzunFormStepApproval('Use Shared Model', step, duplicates), false); assert.equal(isWattzunFormStepApproval('Use the second one', step, duplicates), true);
  const scenario = { kind: 'scenario', dependencyKey: 'scenario-one', scenarioCode: 'A1' }, choices = { ...scenario, scenarioCodes: ['A1', 'B2'] };
  assert.equal(isWattzunFormStepApproval('Yes', scenario, choices), false); assert.equal(isWattzunFormStepApproval('Use scenario A1', scenario, choices), true);
  assert.equal(isWattzunFormStepApproval('Use scenario B2', scenario, choices), false);
});

test('price-book proposals expose the native type and unit choices to the provider while preserving unknowns', () => {
  const schema = WATTZUN_WORKFLOW_PROPOSAL_SCHEMAS.find(item => item.properties.kind.enum[0] === 'add_price_book_item');
  assert.deepEqual(schema.properties.itemType.enum, [...PRICE_BOOK_ITEM_TYPES, null]);
  assert.deepEqual(schema.properties.unitLabel.enum, [...PRICE_BOOK_UNITS.map(([value]) => value), null]);
  assert.ok(!schema.properties.unitLabel.enum.includes('installation'));
  assert.ok(schema.properties.unitLabel.enum.includes('each'));
  assert.ok(schema.properties.unitLabel.enum.includes(null));
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
  for (const text of ['save these answers', 'Yep, save those form answers.', 'please save the answers', 'yes save these answers']) assert.equal(isWattzunWorkflowApproval(text), true, text);
  for (const text of ['Do not save these answers', 'save these answers tomorrow', 'save these answers but change the quantity']) assert.equal(isWattzunWorkflowApproval(text), false, text);
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
