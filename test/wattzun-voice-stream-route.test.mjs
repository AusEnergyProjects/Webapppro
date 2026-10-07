import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import * as contract from '../src/lib/wattzun-portal.ts';
import * as greeting from '../src/lib/wattzun-greeting.ts';
import * as workflowContract from '../src/lib/wattzun-workflow.ts';
import * as workflowReply from '../src/lib/wattzun-workflow-reply.ts';
import * as formGuideContract from '../src/lib/wattzun-form-guide.ts';
import * as formStepContract from '../src/lib/wattzun-form-step.ts';
import { turnAuthorityContract } from './helpers/wattzun-turn-authority-fixture.mjs';
import { readWattzunVoiceStream } from '../src/lib/wattzun-voice-stream.ts';
import { syntheticWorkContext, workContextContract, workContextGateway } from './helpers/wattzun-work-context-fixture.mjs';

const contextGateway = workContextGateway();

class AccessError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
class UsageError extends Error {
  constructor(code) { super(`WATTZUN_USAGE_${code.toUpperCase()}`); this.code = code; }
}
class WorkflowError extends Error { constructor(status, message) { super(message); this.status = status; } }
class GuidedValidationError extends WorkflowError {}
class ExistingQuoteError extends Error { constructor(status, message) { super(message); this.status = status; } }
class FormError extends Error { constructor(status, message) { super(message); this.status = status; } }
const route = {};
const executable = ts.transpileModule(readFileSync(new URL('../src/lib/wattzun-portal-route.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
Function('require', 'exports', executable)(name => {
  if (name === './wattzun-portal') return contract;
  if (name === './wattzun-greeting') return greeting;
  if (name === './wattzun-portal-access-server') return {
    WattzunAccessError: AccessError,
    wattzunAccessFailure: error => error instanceof AccessError ? { status: error.status, message: error.message } : null,
  };
  if (name === './wattzun-portal-ai-server' || name === './wattzun-realtime-server' || name === './wattzun-usage') return {};
  if (name === './wattzun-turn-authority-server') return turnAuthorityContract;
  if (name === './wattzun-form-guide') return formGuideContract;
  if (name === './wattzun-form-step') return formStepContract;
  if (name === './wattzun-usage-server') return { WattzunUsageError: UsageError };
  if (name === './wattzun-work-context' || name === './wattzun-work-context.ts') return workContextContract;
  if (name === './wattzun-work-context-server') return contextGateway;
  if (name === './wattzun-workflow') return workflowContract;
  if (name === './wattzun-workflow-reply') return workflowReply;
  if (name === './wattzun-workflow-server') return { WattzunWorkflowError: WorkflowError, WattzunGuidedFormValidationError: GuidedValidationError };
  if (name === './wattzun-existing-quote-server') return { WattzunExistingQuoteError: ExistingQuoteError };
  if (name === './wattzun-form-server') return { WattzunFormError: FormError };
  throw new Error(`Unexpected route dependency: ${name}`);
}, route);

const input = { portal: 'trade', scopeId: 'synthetic-business', requestId: 'synthetic-stream-request-0001', message: '',
  history: [{ role: 'user', content: 'Please help prepare a new quote.' }], preferences: { speed: 1.15 } };
const access = { db: { synthetic: true }, actorUid: 'synthetic-owner', scope: { portal: 'trade', scopeId: input.scopeId, label: 'Synthetic business' } };
const transcript = 'Please prepare my new quote.';
const reply = { kind: 'clarification', message: 'I can help prepare your quote.', questions: ['Which customer is it for?'], links: [] };
const matchesReply = value => JSON.stringify(value) === JSON.stringify(reply);
const workflowProposal = { kind: 'invoice_reminder', jobQuery: 'that job last week in Frankston', jobId: '', invoiceId: '', channel: 'sms', body: '' };
const workflowReview = { state: 'review', reviewId: 'wattzun-review-current-123', expiresAt: '2026-10-07T12:15:00Z', kind: 'invoice_reminder', heading: 'Review invoice reminder', summary: 'An unpaid invoice reminder is ready for John Smith.', confirmationLabel: 'Send reminder', lines: [{ label: 'Invoice', value: 'INV-123' }], preview: { subject: '', body: 'Please check your unpaid invoice INV-123.' }, href: '/direct-trade/dashboard?workspace=connect' };

test('native and streaming voice prepare actual workflow reviews before narration', async () => {
  for (const accept of [contract.WATTZUN_VOICE_STREAM_TYPE, contract.WATTZUN_REALTIME_VOICE_STREAM_TYPE]) {
    const f = fixture({ reply: { ...reply, action: workflowProposal }, workflowResult: workflowReview });
    const { response } = await f.post(accept); assert.equal(response.status, 200);
    assert.equal(f.workflowCalls[0].proposal.jobQuery, workflowProposal.jobQuery); assert.equal(f.workflowCalls[0].current.actorUid, access.actorUid);
    assert.equal(f.workflowCalls[0].requestId, input.requestId);
    assert.ok(f.events.indexOf('prepareWorkflow') < f.events.indexOf(accept === contract.WATTZUN_REALTIME_VOICE_STREAM_TYPE ? 'nativeSpeech' : 'streamSpeak'));
    assert.deepEqual(f.speechContexts[0].reply.workflow, workflowReview);
    const result = await readWattzunVoiceStream(response, f.controller.signal, value => workflowContract.isWattzunWorkflowResult(value.workflow));
    assert.deepEqual(result.reply.workflow, workflowReview); await result.audio.stream.cancel();
  }
});
test('native workflow uses one initial snapshot and one final source and authority handoff', async () => {
  const workContext = syntheticWorkContext();
  const f = fixture({ input: { ...input, workReference: workContext.reference }, workContext,
    reply: { ...reply, action: workflowProposal }, workflowResult: workflowReview });
  const { response } = await f.post(contract.WATTZUN_REALTIME_VOICE_STREAM_TYPE); assert.equal(response.status, 200);
  assert.equal(f.events.filter(value => value === 'context').length, 2);
  assert.deepEqual(f.events.slice(f.events.indexOf('realtime') + 1, f.events.indexOf('prepareWorkflow') + 1), ['prepareWorkflow']);
  assert.deepEqual(f.events.slice(f.events.indexOf('prepareWorkflow') + 1), ['nativeSpeech', 'recordUsage', 'context', 'workflowReview', 'access']);
  assert.equal(f.recorded.length, 1); await response.body.cancel();
});
test('a selected source changed after native preparation cancels buffered speech before any disclosure', async () => {
  const workContext = syntheticWorkContext();
  const f = fixture({ input: { ...input, workReference: workContext.reference }, workContext, contextChangedAt: 2,
    reply: { ...reply, action: workflowProposal }, workflowResult: workflowReview });
  const { response } = await f.post(contract.WATTZUN_REALTIME_VOICE_STREAM_TYPE); assert.equal(response.status, 409);
  assert.equal(f.events.includes('prepareWorkflow'), true); assert.equal(f.events.includes('nativeSpeech'), true);
  assert.equal(f.recorded.length, 1); assert.equal(f.audio.state.cancelled, 1); assert.equal(f.audio.state.pulls, 0); assert.equal((await response.json()).reply, undefined);
});
test('native current-review approval produces only a matching confirmation for the separately confirmed execution route', async () => {
  const action = { kind: 'confirm_workflow', reviewId: workflowReview.reviewId };
  const f = fixture({ input: { ...input, workflowReviewId: workflowReview.reviewId }, reply: { ...reply, action }, workflowResult: workflowReview, requestSummary: 'yes send it' });
  const { response } = await f.post(contract.WATTZUN_REALTIME_VOICE_STREAM_TYPE); assert.equal(response.status, 200);
  const result = await readWattzunVoiceStream(response, f.controller.signal, value => workflowContract.isWattzunWorkflowResult(value.workflow));
  assert.deepEqual(result.reply.action, action); assert.deepEqual(result.reply.workflow, workflowReview);
  assert.equal(result.reply.kind, 'answer'); assert.equal(result.reply.message, 'I will submit this reviewed task now.'); assert.deepEqual(result.reply.questions, []);
  assert.equal(f.events.includes('prepareWorkflow'), false); await result.audio.stream.cancel();
});
test('native wrong review or uncertain and embedded approvals stop before speech', async () => {
  for (const [requestSummary, reviewId, status] of [['yes send it', 'wattzun-review-wrong-123', 409], ['Maybe send it tomorrow', workflowReview.reviewId, 400], ["The customer said yes send it", workflowReview.reviewId, 400]]) {
    const f = fixture({ input: { ...input, workflowReviewId: workflowReview.reviewId }, reply: { ...reply, action: { kind: 'confirm_workflow', reviewId } }, workflowResult: workflowReview, requestSummary });
    const { response } = await f.post(contract.WATTZUN_REALTIME_VOICE_STREAM_TYPE); assert.equal(response.status, status); assert.equal(f.events.includes('nativeSpeech'), false); assert.equal(f.recorded.length, 0);
  }
});

test('a completion review cannot be approved by ordinary draft-save or message-send wording', async () => {
  const completion = { ...workflowReview, kind: 'complete_form', heading: 'Complete form', confirmationLabel: 'Complete form' };
  for (const [requestSummary, status] of [['Save these answers', 400], ['Send it', 400], ['Add it', 400], ['Complete this form now', 200]]) {
    const f = fixture({ input: { ...input, workflowReviewId: completion.reviewId }, reply: { ...reply, action: { kind: 'confirm_workflow', reviewId: completion.reviewId } }, workflowResult: completion, requestSummary });
    const { response } = await f.post(contract.WATTZUN_REALTIME_VOICE_STREAM_TYPE); assert.equal(response.status, status);
    assert.equal(f.events.includes('nativeSpeech'), status === 200); if (response.ok) await response.body.cancel();
  }
});

test('a recovered completed form review speaks the exact receipt and never proposes another save', async () => {
  const receipt = { kind: 'fill_form', id: 'saved-form-123', status: 'saved', label: 'Draft answers saved',
    href: '/direct-trade/team?workspace=work&jobId=job-123&jobTab=files', message: 'Your draft answers are saved. Next question: What is the serial number?' };
  for (const accept of [contract.WATTZUN_VOICE_STREAM_TYPE, contract.WATTZUN_REALTIME_VOICE_STREAM_TYPE]) {
    const f = fixture({ input: { ...input, workflowReviewId: workflowReview.reviewId },
      reply: { ...reply, message: 'I can help you continue.', questions: ['Do you want to save again?'] },
      workflowResult: { state: 'complete', receipt } });
    const { response } = await f.post(accept); assert.equal(response.status, 200);
    const result = await readWattzunVoiceStream(response, f.controller.signal, value => workflowContract.isWattzunWorkflowResult(value.workflow));
    assert.equal(result.reply.message, receipt.message); assert.deepEqual(result.reply.questions, []);
    assert.equal(result.reply.action, null); assert.equal(result.reply.lookup, null);
    assert.deepEqual(result.reply.workflow, { state: 'complete', receipt });
    assert.equal(f.events.includes('prepareWorkflow'), false); await result.audio.stream.cancel();
  }
});
test('workflow revocation or source change after usage cancels unhanded native and streaming audio', async () => {
  for (const accept of [contract.WATTZUN_VOICE_STREAM_TYPE, contract.WATTZUN_REALTIME_VOICE_STREAM_TYPE]) for (const changed of [false, true]) {
    const f = fixture({ input: { ...input, workflowReviewId: workflowReview.reviewId }, workflowResult: workflowReview,
      ...(changed ? { workflowChangedDuringUsage: { ...workflowReview, summary: 'Another session changed this review.' } } : { workflowErrorDuringUsage: new WorkflowError(403, 'Review access revoked.') }) });
    const { response } = await f.post(accept); assert.equal(response.status, changed ? 409 : 403);
    assert.equal(f.audio.state.cancelled, 1); assert.equal(f.audio.state.pulls, 0); assert.equal(f.recorded.length, 1); assert.equal((await response.json()).reply, undefined);
  }
});
test('workflow and quote preparation failures retain status before any native or streaming speech request', async () => {
  for (const accept of [contract.WATTZUN_VOICE_STREAM_TYPE, contract.WATTZUN_REALTIME_VOICE_STREAM_TYPE]) for (const ErrorType of [WorkflowError, ExistingQuoteError]) {
    const f = fixture({ reply: { ...reply, action: workflowProposal }, workflowError: new ErrorType(409, 'The selected quote changed.') });
    const { response } = await f.post(accept); assert.equal(response.status, 409); assert.equal((await response.json()).error, 'The selected quote changed.');
    assert.equal(f.events.includes('nativeSpeech'), false); assert.equal(f.events.includes('streamSpeak'), false); assert.equal(f.recorded.length, 0);
  }
});

test('new model reviews are strictly revalidated before audio disclosure; native synthesis remains private until then', async () => {
  for (const accept of [contract.WATTZUN_VOICE_STREAM_TYPE, contract.WATTZUN_REALTIME_VOICE_STREAM_TYPE]) {
    for (const boundary of ['beforeSpeech', 'afterUsage']) for (const changed of [false, true]) {
      const f = fixture({ reply: { ...reply, action: workflowProposal }, workflowResult: workflowReview });
      f.deps.prepareProposedWorkflow = async () => { f.events.push('prepareProposedWorkflow'); return workflowReview; };
      const original = f.deps.workflowReview;
      f.deps.workflowReview = async (...args) => {
        const result = await original(...args);
        if (boundary === 'afterUsage' && !f.recorded.length) return result;
        if (!changed) throw new WorkflowError(403, 'Current quote access is required.');
        return { ...workflowReview, summary: 'The source quote changed after preparation.' };
      };
      const { response } = await f.post(accept); assert.equal(response.status, changed ? 409 : 403);
      assert.equal((await response.json()).reply, undefined);
      assert.equal(f.events.includes('prepareProposedWorkflow'), true); assert.equal(f.events.includes('prepareWorkflow'), false);
      assert.equal(f.audio.state.pulls, 0);
      if (boundary === 'beforeSpeech' && accept !== contract.WATTZUN_REALTIME_VOICE_STREAM_TYPE) {
        assert.equal(f.events.includes('nativeSpeech'), false); assert.equal(f.events.includes('streamSpeak'), false);
        assert.equal(f.recorded.length, 0);
      } else {
        assert.equal(f.audio.state.cancelled, 1); assert.equal(f.recorded.length, 1);
      }
    }
  }
});

function providerAudio() {
  let controller;
  const state = { cancelled: 0, ended: false, pulls: 0 };
  const stream = new ReadableStream({
    start(value) { controller = value; },
    pull() { state.pulls++; },
    cancel() { state.cancelled++; },
  }, { highWaterMark: 0 });
  return { stream, state,
    push(value) { controller.enqueue(value); },
    finish() { state.ended = true; controller.close(); },
    fail(error) { controller.error(error); },
  };
}

function fixture(options = {}) {
  const audio = providerAudio(), events = [], recorded = [], providerSignals = [], providerContexts = [], workflowCalls = [], speechContexts = [];
  let accessChecks = 0, contextChecks = 0;
  const turnInput = options.input || input;
  const controller = new AbortController();
  const deps = {
    authenticate: async () => { events.push('authenticate'); },
    scopes: async () => [],
    access: async (_request, portal, scopeId) => {
      events.push('access'); accessChecks++;
      assert.equal(portal, input.portal); assert.equal(scopeId, input.scopeId);
      if (accessChecks === options.revokeAt) throw new AccessError(403, 'Current business access is required.');
      if (options.revokeDuringUsage && recorded.length) throw new AccessError(403, 'Business access was revoked during usage recording.');
      return accessChecks > 1 && options.changed ? options.changed : access;
    },
    context: async (_, current, reference) => {
      events.push('context'); contextChecks++;
      assert.equal(current.actorUid, access.actorUid); assert.deepEqual(reference, turnInput.workReference);
      if (options.contextError && contextChecks === (options.contextErrorAt || 1)) throw options.contextError;
      if (options.contextErrorDuringUsage && recorded.length) throw options.contextErrorDuringUsage;
      return contextChecks === options.contextChangedAt || (options.contextChangedDuringUsage && recorded.length)
        ? { ...options.workContext, sourceSha256: 'b'.repeat(64) } : options.workContext;
    },
    transcribe: async context => {
      events.push('transcribe'); providerSignals.push(context.signal);
      assert.equal(context.actorUid, access.actorUid); assert.ok(context.audio instanceof Blob);
      if (options.abortAt === 'transcribe') controller.abort();
      return options.transcript || transcript;
    },
    reply: async context => {
      events.push('reply'); providerSignals.push(context.signal);
      assert.equal(context.actorUid, access.actorUid);
      providerContexts.push(context);
      assert.deepEqual(context.input, { ...turnInput, message: options.transcript || transcript });
      if (options.abortAt === 'reply') controller.abort();
      return options.reply || reply;
    },
    streamSpeak: async context => {
      events.push('streamSpeak'); providerSignals.push(context.signal); speechContexts.push(context);
      if (!options.workflowResult) assert.deepEqual(context.reply, options.reply || reply);
      assert.equal(context.input.preferences.speed, 1.15);
      if (options.providerError) throw options.providerError;
      if (options.abortAt === 'streamSpeak') controller.abort();
      return audio.stream;
    },
    speak: async context => {
      events.push('speak'); providerSignals.push(context.signal);
      return { base64: 'AAA=', mimeType: 'audio/mpeg' };
    },
    realtime: async context => {
      events.push('realtime'); providerSignals.push(context.signal);
      providerContexts.push(context);
      assert.equal(context.audio.type,'audio/wav'); assert.deepEqual(context.input,turnInput);
      if(options.providerError) throw options.providerError;
      const processed = context.transformReply ? await context.transformReply(options.reply || reply, options.requestSummary || 'Prepare a new quote. Customer details are still needed.') : options.reply || reply;
      await context.beforeSpeech(); events.push('nativeSpeech'); speechContexts.push({ ...context, reply: processed });
      if(options.abortAt==='realtime') controller.abort();
      return {reply:processed,audio:audio.stream,requestSummary:options.requestSummary || 'Prepare a new quote. Customer details are still needed.',timings:options.timings};
    },
    recordUsage: async value => {
      events.push('recordUsage');
      assert.deepEqual(value, { access, requestId: input.requestId, kind: 'voice' });
      if (options.usageError) throw options.usageError;
      if (options.abortAt === 'usage') controller.abort();
      recorded.push(value);
    },
    usage: async () => { throw new Error('Unexpected usage read.'); },
    prepareWorkflow: async (request, current, proposal, requestId) => {
      events.push('prepareWorkflow'); workflowCalls.push({ request, current, proposal, requestId });
      if (options.workflowError) throw options.workflowError; return options.workflowResult;
    },
    workflowReview: async (_request, current, reviewId) => {
      events.push('workflowReview'); workflowCalls.push({ current, reviewId });
      if (options.workflowError) throw options.workflowError;
      if (options.workflowErrorDuringUsage && recorded.length) throw options.workflowErrorDuringUsage;
      return options.workflowChangedDuringUsage && recorded.length ? options.workflowChangedDuringUsage : options.workflowResult;
    },
  };
  deps.turnAuthority = async (request, portal, scopeId, previous) => {
    const current = await deps.access(request, portal, scopeId);
    if (previous && (current.actorUid !== previous.access.actorUid || JSON.stringify(current.scope) !== JSON.stringify(previous.access.scope))) throw new AccessError(403, 'Your workspace changed.');
    return { access: current };
  };
  deps.prepareTurnWorkflow = async (request, authority, proposal, requestId) => (deps.prepareProposedWorkflow || deps.prepareWorkflow)(request, authority.access, proposal, requestId);
  deps.reviewTurnWorkflow = async (request, authority, reviewId, refresh) => {
    const result = await deps.workflowReview(request, authority.access, reviewId);
    return { result, authority: await refresh() };
  };
  deps.verifyTurnWorkflow = async (request, authority, proposal, requestId, refresh) => {
    const result = await deps.prepareWorkflow(request, authority.access, proposal, requestId);
    await refresh(); return result;
  };
  async function post(accept = contract.WATTZUN_VOICE_STREAM_TYPE) {
    const form = new FormData();
    form.set('request', JSON.stringify(turnInput));
    const native = accept === contract.WATTZUN_REALTIME_VOICE_STREAM_TYPE;
    form.set('audio', new Blob([new Uint8Array(options.audioBytes||300)], { type: options.audioType || (native ? 'audio/wav' : 'audio/webm;codecs=opus') }), native?'synthetic.wav':'synthetic.webm');
    const request = new Request('https://example.test/api/wattzun/voice', {
      method: 'POST', headers: { origin: 'https://example.test', accept }, body: form, signal: controller.signal,
    });
    const response = await route.postWattzunVoice(request, deps);
    return { request, response };
  }
  return { audio, events, recorded, providerSignals, providerContexts, workflowCalls, speechContexts, controller, deps, post };
}

function guidedRouteFixture() {
  const reference = { kind: 'trade_form', formKind: 'job_form', recordId: 'form-one', jobId: 'job-one' };
  const guideInput = { sessionId: '00000000-0000-4000-8000-000000000001', stage: 'continue', authorization: 'ordinary_form_answers', sourceSha256: '1'.repeat(64), questionKey: 'notes', skippedFieldKeys: [] };
  const turnInput = { ...input, workReference: reference, formGuide: guideInput };
  const options = { input: turnInput, requestSummary: 'Side gate', reply: { kind: 'answer', message: 'An untrusted success phrase.', questions: [], links: [], action: { kind: 'fill_form', jobQuery: '', jobId: 'job-one', formKind: 'job_form', formId: 'form-one', answers: [{ fieldKey: 'notes', value: 'Side gate' }] } } };
  const f = fixture(options), state = { revision: 1, answers: {}, writes: 0, failAfterSave: false, invalidAnswer: false, completed: false, step: null }, journal = new Map(), audios = [];
  const team = { actorUid: access.actorUid, ownerUid: access.scope.scopeId, businessName: access.scope.label, canViewFieldEvidence: true, canManageFieldEvidence: true };
  const source = () => String(state.revision).repeat(64);
  const progress = raw => {
    const next = state.step ? 'governed' : ['notes', 'serial'].find(key => !state.answers[key] && !raw.skippedFieldKeys.includes(key));
    const guide = { sessionId: guideInput.sessionId, reference, requestedReference: reference, recordId: reference.recordId, revision: state.revision, sourceSha256: source(),
      state: raw.paused ? 'paused' : state.completed ? 'complete' : next ? 'question' : 'ready_to_complete',
      next: raw.paused || state.completed || !next ? null : { kind: 'question', fieldKey: next, label: next === 'notes' ? 'Where is site access?' : 'What is the serial number?', type: state.step?.kind || 'text', options: [], ...(state.step ? { step: state.step } : {}) },
      counts: { visible: 2, answered: Object.keys(state.answers).length, unanswered: 2 - Object.keys(state.answers).length, evidenceMissing: 0, manualMissing: 0, skipped: raw.skippedFieldKeys.length },
      skippedFieldKeys: raw.skippedFieldKeys, completion: { ready: !next, missing: next ? [next] : [], status: state.completed ? 'complete' : 'draft' },
      ...(state.completed ? { receipt: { ...[...journal.values()].at(-1).result.receipt, status: 'submitted' } } : {}), ...(raw.productSearch ? { productSearch: raw.productSearch } : {}) };
    return { guide, context: syntheticWorkContext({ reference, sourceSha256: source(), facts: { form: { title: 'Fixture form', answers: structuredClone(state.answers) } } }) };
  };
  const originalAuthority = f.deps.turnAuthority;
  f.deps.turnAuthority = async (...args) => ({ ...await originalAuthority(...args), tradeTeam: { ...team } });
  f.deps.guide = async (_request, current, selected, raw) => {
    f.events.push('guide'); assert.equal(current.actorUid, access.actorUid); assert.deepEqual(selected, reference);
    const result = progress(raw);
    if (raw.stage === 'continue' && (raw.sourceSha256 !== source() || raw.questionKey !== (result.guide.next?.fieldKey || ''))) throw new FormError(409, 'The form question changed.');
    return result;
  };
  f.deps.guideControl = async (_request, _access, _reference, raw, control) => progress({ ...raw, paused: control.command === 'pause', skippedFieldKeys: control.command === 'skip' ? [...raw.skippedFieldKeys, control.fieldKey] : raw.skippedFieldKeys });
  f.deps.searchFormProducts = async (_request, _access, _reference, raw, action) => {
    assert.equal(action.dependencyKey, state.step.dependencyKey); assert.equal(state.step.kind, 'official_product');
    state.step = { ...state.step, search: action.search, choices: [{ selectionId: 'product-one', snapshotId: 'snapshot-one', label: 'Synthetic Model One', brand: 'Synthetic', model: 'Model One' }] };
    return progress({ ...raw, productSearch: { dependencyKey: action.dependencyKey, search: action.search } });
  };
  f.deps.executeGuidedForm = async (_request, _authority, selected, proposal, raw, requestId) => {
    assert.deepEqual(selected, reference); assert.equal(raw.sourceSha256, source());
    if (state.invalidAnswer) throw new GuidedValidationError(400, 'Choose a valid date in day, month and year format.');
    if (proposal.kind === 'fill_form') for (const answer of proposal.answers) state.answers[answer.fieldKey] = answer.value;
    else if (proposal.kind === 'form_step') state.step = null;
    else state.completed = true;
    state.revision++; state.writes++;
    const result = { state: 'complete', receipt: { kind: proposal.kind, id: reference.recordId, status: proposal.kind === 'complete_form' ? 'submitted' : 'saved', label: 'Open form', href: '/direct-trade/dashboard?workspace=work&jobId=job-one&jobTab=files', message: proposal.kind === 'fill_form' ? 'The answers are saved.' : proposal.kind === 'form_step' ? 'The calculator result is saved and remains pending independent Creditex review.' : 'The form is complete.' } };
    const executed = { result, reviewId: 'guided-review-1234567890', deferredFieldKeys: [] }; journal.set(requestId, executed);
    if (state.failAfterSave) throw new FormError(503, 'The save acknowledgement was lost.');
    return executed;
  };
  f.deps.recoverGuidedForm = async (_request, _authority, selected, raw, requestId) => {
    f.events.push('recoverGuide'); assert.deepEqual(selected, reference); assert.equal(raw.sessionId, guideInput.sessionId);
    return journal.has(requestId) ? { state: 'saved', ...journal.get(requestId) } : { state: 'not_saved' };
  };
  f.deps.reviewTurnWorkflow = async (_request, _authority, reviewId, refresh) => {
    assert.equal(reviewId, 'guided-review-1234567890'); return { result: [...journal.values()].at(-1).result, authority: await refresh() };
  };
  const freshAudio = () => { const audio = providerAudio(); audios.push(audio); audio.push(Uint8Array.from([0, 1, 2, 3])); audio.finish(); return audio.stream; };
  f.deps.realtime = async context => { f.events.push('realtime'); assert.ok(context.formGuideProgress); const reply = await context.transformReply(options.reply, options.requestSummary); await context.beforeSpeech(); return { reply, audio: freshAudio(), requestSummary: options.requestSummary }; };
  f.deps.streamSpeak = async context => { f.events.push('streamSpeak'); f.speechContexts.push(context); return freshAudio(); };
  f.deps.recordUsage = async value => { f.events.push('recordUsage'); f.recorded.push(value); };
  return { ...f, state, journal, options, turnInput, source, progress, audios,
    control: () => route.postWattzunFormGuide(new Request('https://example.test/api/wattzun/form-guide', { method: 'POST', headers: { origin: 'https://example.test', 'content-type': 'application/json' }, body: JSON.stringify({ ...turnInput, message: turnInput.message || 'Start guided form completion' }) }), f.deps) };
}

test('deterministic guided start speaks the real first question, counts its prepared speech and never calls the model or saves', async () => {
  const f = guidedRouteFixture(); f.turnInput.formGuide = { ...f.turnInput.formGuide, stage: 'start' };
  const response = await f.control(); assert.equal(response.status, 200);
  const result = await readWattzunVoiceStream(response, f.controller.signal, reply => Boolean(formGuideContract.readWattzunFormGuideProgress(reply.formGuide)));
  assert.match(result.reply.message, /Where is site access/); assert.equal(result.reply.formGuide.next.fieldKey, 'notes');
  assert.equal(f.events.includes('realtime'), false); assert.equal(f.state.writes, 0); assert.equal(f.recorded.length, 1);
  assert.deepEqual(result.reply.formGuideRecovery, { requestId: input.requestId, state: 'not_saved' }); await result.audio.stream.cancel();
});

test('an invalid guided value before journal dispatch speaks its actual correction question and keeps the same task ready to answer', async () => {
  const f = guidedRouteFixture(); f.state.invalidAnswer = true;
  const invalid = await f.post(contract.WATTZUN_REALTIME_VOICE_STREAM_TYPE); assert.equal(invalid.response.status, 200);
  const clarification = await readWattzunVoiceStream(invalid.response, f.controller.signal, reply => Boolean(reply.formGuide));
  assert.equal(clarification.reply.kind, 'clarification'); assert.match(clarification.reply.message, /valid date/); assert.match(clarification.reply.questions[0], /site access/);
  assert.deepEqual(clarification.reply.formGuideRecovery, { requestId: input.requestId, state: 'not_saved' }); assert.equal(f.state.writes, 0); assert.equal(f.journal.size, 0); await clarification.audio.stream.cancel();
  f.state.invalidAnswer = false; f.turnInput.requestId = 'guided-valid-answer-000002';
  const valid = await f.post(contract.WATTZUN_REALTIME_VOICE_STREAM_TYPE); assert.equal(valid.response.status, 200);
  const saved = await readWattzunVoiceStream(valid.response, f.controller.signal, reply => reply.workflow?.receipt?.kind === 'fill_form');
  assert.equal(f.state.writes, 1); assert.equal(saved.reply.formGuide.next.fieldKey, 'serial'); await saved.audio.stream.cancel();
});

test('a guided native lost save response recovers the original journal before the model and continues with the next answer', async () => {
  const f = guidedRouteFixture(); f.state.failAfterSave = true;
  const first = await f.post(contract.WATTZUN_REALTIME_VOICE_STREAM_TYPE); assert.equal(first.response.status, 503);
  const error = await first.response.json(); assert.deepEqual(error.formGuideRecovery, { requestId: input.requestId, state: 'uncertain' }); assert.doesNotMatch(error.error, /records.*not changed/); assert.equal(f.state.writes, 1);
  f.state.failAfterSave = false; f.turnInput.requestId = 'guided-recovery-request-0002'; f.turnInput.formGuide.pendingRequestId = input.requestId;
  const recovered = await f.post(contract.WATTZUN_REALTIME_VOICE_STREAM_TYPE); assert.equal(recovered.response.status, 200);
  const result = await readWattzunVoiceStream(recovered.response, f.controller.signal, reply => reply.workflow?.state === 'complete');
  assert.equal(result.reply.formGuide.next.fieldKey, 'serial'); assert.match(result.reply.message, /serial number/);
  assert.deepEqual(result.reply.formGuideRecovery, { requestId: input.requestId, state: 'saved' }); assert.equal(f.state.writes, 1); assert.equal(f.events.filter(event => event === 'realtime').length, 1); await result.audio.stream.cancel();
  f.turnInput.requestId = 'guided-next-answer-000003'; f.turnInput.formGuide = { ...f.turnInput.formGuide, sourceSha256: f.source(), questionKey: 'serial', pendingRequestId: undefined };
  f.options.reply.action = { ...f.options.reply.action, answers: [{ fieldKey: 'serial', value: 'ABC123' }] }; f.options.requestSummary = 'ABC123';
  const next = await f.post(contract.WATTZUN_REALTIME_VOICE_STREAM_TYPE); assert.equal(next.response.status, 200);
  const final = await readWattzunVoiceStream(next.response, f.controller.signal, reply => reply.workflow?.state === 'complete');
  assert.equal(f.state.writes, 2); assert.equal(f.state.completed, false); assert.equal(final.reply.formGuide.state, 'ready_to_complete'); assert.match(final.reply.message, /Would you like.*complete/); await final.audio.stream.cancel();
});

test('guided completion rejects draft-save approval and requires a separate current completion phrase', async () => {
  const f = guidedRouteFixture(); f.state.answers = { notes: 'Side gate', serial: 'ABC123' }; f.turnInput.formGuide.questionKey = '';
  f.options.reply.action = { kind: 'form_guide_control', command: 'complete', fieldKey: '' }; f.options.requestSummary = 'Save these answers';
  const invalid = await f.post(contract.WATTZUN_REALTIME_VOICE_STREAM_TYPE); assert.equal(invalid.response.status, 400); assert.equal(f.state.writes, 0);
  f.turnInput.requestId = 'guided-complete-00000002'; f.options.requestSummary = 'Complete this form now';
  const confirmed = await f.post(contract.WATTZUN_REALTIME_VOICE_STREAM_TYPE); assert.equal(confirmed.response.status, 200);
  const result = await readWattzunVoiceStream(confirmed.response, f.controller.signal, reply => reply.workflow?.receipt?.kind === 'complete_form');
  assert.equal(f.state.writes, 1); assert.equal(f.state.completed, true); assert.equal(result.reply.formGuide.state, 'complete'); await result.audio.stream.cancel();
});

test('governed native steps reject unrelated approvals before writes and speak the actual pending-review receipt', async () => {
  const f = guidedRouteFixture(); f.state.step = { kind: 'calculator', dependencyKey: 'calculation-one' }; f.turnInput.formGuide.questionKey = 'governed';
  f.options.reply.action = { kind: 'form_step', jobQuery: '', jobId: 'job-one', formKind: 'job_form', formId: 'form-one', step: { kind: 'calculator', dependencyKey: 'calculation-one' } };
  f.options.requestSummary = 'Save this quote';
  const denied = await f.post(contract.WATTZUN_REALTIME_VOICE_STREAM_TYPE); assert.equal(denied.response.status, 200);
  const clarification = await readWattzunVoiceStream(denied.response, f.controller.signal, reply => Boolean(reply.formGuide));
  assert.equal(clarification.reply.kind, 'clarification'); assert.equal(clarification.reply.formGuideRecovery.state, 'not_saved'); assert.equal(f.state.writes, 0); await clarification.audio.stream.cancel();
  f.turnInput.requestId = 'guided-calculator-000002'; f.options.requestSummary = 'Run the calculator now';
  const valid = await f.post(contract.WATTZUN_REALTIME_VOICE_STREAM_TYPE); assert.equal(valid.response.status, 200);
  const result = await readWattzunVoiceStream(valid.response, f.controller.signal, reply => reply.workflow?.receipt?.kind === 'form_step');
  assert.match(result.reply.message, /pending independent Creditex review/); assert.match(result.reply.message, /Where is site access/); assert.equal(f.state.writes, 1); assert.equal(f.state.completed, false); await result.audio.stream.cancel();
});

test('a lost governed save recovers the original receipt and its pending-review warning without calling the model or running twice', async () => {
  const f = guidedRouteFixture(); f.state.step = { kind: 'calculator', dependencyKey: 'calculation-one' }; f.turnInput.formGuide.questionKey = 'governed'; f.state.failAfterSave = true;
  f.options.reply.action = { kind: 'form_step', jobQuery: '', jobId: 'job-one', formKind: 'job_form', formId: 'form-one', step: { kind: 'calculator', dependencyKey: 'calculation-one' } }; f.options.requestSummary = 'Run the calculator now';
  assert.equal((await f.post(contract.WATTZUN_REALTIME_VOICE_STREAM_TYPE)).response.status, 503); assert.equal(f.state.writes, 1);
  f.state.failAfterSave = false; f.turnInput.requestId = 'guided-step-recover-00002'; f.turnInput.formGuide.pendingRequestId = input.requestId;
  const recovered = await f.post(contract.WATTZUN_REALTIME_VOICE_STREAM_TYPE); assert.equal(recovered.response.status, 200);
  const result = await readWattzunVoiceStream(recovered.response, f.controller.signal, reply => reply.workflow?.receipt?.kind === 'form_step');
  assert.match(result.reply.message, /pending independent Creditex review/); assert.equal(result.reply.formGuideRecovery.state, 'saved'); assert.equal(f.state.writes, 1); assert.equal(f.events.filter(event => event === 'realtime').length, 1); await result.audio.stream.cancel();
});

test('official product search is read-only and returns canonical choices before a separate scoped selection', async () => {
  const f = guidedRouteFixture(); f.state.step = { kind: 'official_product', dependencyKey: 'product-dependency', minimumCount: 1, maximumCount: 1, search: '', truncated: false, choices: [] }; f.turnInput.formGuide.questionKey = 'governed';
  f.options.reply.action = { kind: 'search_form_products', dependencyKey: 'product-dependency', search: 'Model One' }; f.options.requestSummary = 'Find Model One';
  const searched = await f.post(contract.WATTZUN_REALTIME_VOICE_STREAM_TYPE); assert.equal(searched.response.status, 200);
  const choices = await readWattzunVoiceStream(searched.response, f.controller.signal, reply => reply.formGuide?.next?.step?.kind === 'official_product');
  assert.equal(choices.reply.formGuide.next.step.choices[0].selectionId, 'product-one'); assert.equal(f.state.writes, 0); assert.equal(f.journal.size, 0); assert.equal(choices.reply.formGuideRecovery.state, 'not_saved'); await choices.audio.stream.cancel();
  f.turnInput.requestId = 'guided-select-product-0002'; f.turnInput.formGuide.productSearch = choices.reply.formGuide.productSearch;
  f.options.reply.action = { kind: 'form_step', jobQuery: '', jobId: 'job-one', formKind: 'job_form', formId: 'form-one', step: { kind: 'official_product', dependencyKey: 'product-dependency', search: 'Model One', selections: [{ selectionId: 'product-one', snapshotId: 'snapshot-one', quantity: 1 }] } }; f.options.requestSummary = 'Use Model One';
  const selected = await f.post(contract.WATTZUN_REALTIME_VOICE_STREAM_TYPE); assert.equal(selected.response.status, 200); assert.equal(f.state.writes, 1); await selected.response.body.cancel();
});

test('guided source or permission change during usage cancels prepared PCM and retains uncertain original request recovery', async () => {
  for (const reason of ['source', 'permission']) {
    const f = guidedRouteFixture(), original = f.deps.recordUsage;
    f.deps.recordUsage = async value => { await original(value); if (reason === 'source') f.state.revision++; else f.deps.turnAuthority = async () => { throw new AccessError(403, 'Permission revoked.'); }; };
    const { response } = await f.post(contract.WATTZUN_REALTIME_VOICE_STREAM_TYPE); assert.equal(response.status, reason === 'source' ? 409 : 403);
    const body = await response.json(); assert.equal(body.reply, undefined); assert.equal(body.audio, undefined); assert.equal(body.formGuideRecovery.state, 'uncertain');
    assert.equal(f.state.writes, 1); assert.equal(f.audios[0].state.cancelled, 1); assert.equal(f.audios[0].state.pulls, 0);
  }
});

test('native work context is checked before provider input and final handoff; only source metadata is published', async () => {
  const workContext = syntheticWorkContext();
  const f = fixture({ input: { ...input, workReference: workContext.reference }, workContext });
  const { response } = await f.post(contract.WATTZUN_REALTIME_VOICE_STREAM_TYPE);
  assert.equal(response.status, 200); assert.equal(f.providerContexts[0].workContext, workContext);
  assert.deepEqual(f.events, ['authenticate', 'access', 'context', 'realtime', 'nativeSpeech', 'recordUsage', 'context', 'access']);
  const result = await readWattzunVoiceStream(response, f.controller.signal, value => Boolean(value.workContext));
  assert.deepEqual(result.reply.workContext, contextGateway.wattzunWorkContextInfo(workContext));
  assert.equal(result.reply.workContext.facts, undefined);
  assert.doesNotMatch(JSON.stringify(result.reply), /switchboard|operationalStage|trade_job_overview/);
  await result.audio.stream.cancel();
});

test('native stale or revoked sources cancel private prepared audio and never publish a reply or PCM', async () => {
  const workContext = syntheticWorkContext();
  for (const options of [
    { contextChangedAt: 2, status: 409 },
    { contextError: new workContextContract.WattzunWorkContextError(403, 'Job access was revoked.'), contextErrorAt: 2, status: 403 },
    { contextChangedDuringUsage: true, status: 409 },
  ]) {
    const f = fixture({ ...options, input: { ...input, workReference: workContext.reference }, workContext });
    const { response } = await f.post(contract.WATTZUN_REALTIME_VOICE_STREAM_TYPE);
    assert.equal(response.status, options.status);
    const body = await response.json();
    assert.equal(body.reply, undefined); assert.equal(body.audio, undefined);
    assert.equal(f.events.includes('nativeSpeech'), true);
    assert.equal(f.audio.state.cancelled, 1); assert.equal(f.audio.state.pulls, 0);
    assert.equal(f.recorded.length, 1);
  }
});

test('legacy streamed speech is cancelled if source changes after synthesis, before publishing audio or usage', async () => {
  const workContext = syntheticWorkContext();
  const f = fixture({ input: { ...input, workReference: workContext.reference }, workContext, contextChangedAt: 4 });
  const { response } = await f.post();
  assert.equal(response.status, 409);
  assert.equal(f.events.includes('streamSpeak'), true);
  assert.equal(f.audio.state.cancelled, 1); assert.equal(f.recorded.length, 0);
  const body = await response.json();
  assert.equal(body.reply, undefined); assert.equal(body.audio, undefined);
});

test('source changes or record access revoked during usage recording cancel unhanded native and legacy PCM', async () => {
  const workContext = syntheticWorkContext();
  for (const accept of [contract.WATTZUN_REALTIME_VOICE_STREAM_TYPE, contract.WATTZUN_VOICE_STREAM_TYPE]) {
    for (const options of [
      { contextChangedDuringUsage: true, status: 409 },
      { contextErrorDuringUsage: new workContextContract.WattzunWorkContextError(403, 'Job access was revoked.'), status: 403 },
      { revokeDuringUsage: true, status: 403 },
    ]) {
      const f = fixture({ ...options, input: { ...input, workReference: workContext.reference }, workContext });
      const { response } = await f.post(accept);
      assert.equal(response.status, options.status); assert.match(response.headers.get('content-type'), /json/);
      const body = await response.json();
      assert.equal(body.ok, false);
      assert.equal(body.reply, undefined); assert.equal(body.audio, undefined); assert.equal(body.transcript, undefined);
      assert.equal(f.recorded.length, 1);
      assert.equal(f.audio.state.pulls, 0); assert.equal(f.audio.state.cancelled, 1);
      assert.ok(Math.max(f.events.lastIndexOf('access'), f.events.lastIndexOf('context')) > f.events.indexOf('recordUsage'));
    }
  }
});

test('workspace revocation during usage recording also cancels existing PCM calls without selected context', async () => {
  for (const accept of [contract.WATTZUN_REALTIME_VOICE_STREAM_TYPE, contract.WATTZUN_VOICE_STREAM_TYPE]) {
    const f = fixture({ revokeDuringUsage: true });
    const { response } = await f.post(accept);
    assert.equal(response.status, 403);
    assert.equal((await response.json()).reply, undefined);
    assert.equal(f.recorded.length, 1); assert.equal(f.events.includes('context'), false);
    assert.equal(f.audio.state.pulls, 0); assert.equal(f.audio.state.cancelled, 1);
  }
});

test('oversized voice context blocks every provider stage and usage operation', async () => {
  const workContext = syntheticWorkContext({ facts: { oversized: '界'.repeat(9000) } });
  for (const accept of [contract.WATTZUN_VOICE_STREAM_TYPE, contract.WATTZUN_REALTIME_VOICE_STREAM_TYPE]) {
    const f = fixture({ input: { ...input, workReference: workContext.reference }, workContext });
    const { response } = await f.post(accept);
    assert.equal(response.status, 413);
    assert.deepEqual(f.providerContexts, []); assert.deepEqual(f.providerSignals, []); assert.deepEqual(f.recorded, []);
  }
});

test('the authorised streaming response and first audio arrive before provider EOF without waiting for full synthesis', async () => {
  const f = fixture();
  const { response, request } = await f.post();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), contract.WATTZUN_VOICE_STREAM_TYPE);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(f.audio.state.ended, false);
  assert.equal(f.audio.state.pulls, 0);
  assert.deepEqual(f.events, ['authenticate', 'access', 'transcribe', 'access', 'reply', 'access', 'streamSpeak', 'access', 'recordUsage', 'access']);
  assert.equal(f.recorded.length, 1);
  for (const signal of f.providerSignals) assert.equal(signal, request.signal);
  const result = await readWattzunVoiceStream(response, f.controller.signal, matchesReply);
  assert.equal(result.transcript, transcript); assert.deepEqual(result.reply, reply);
  assert.equal(f.audio.state.pulls, 0);
  const reader = result.audio.stream.getReader(), pending = reader.read();
  f.audio.push(Uint8Array.from([0, 1, 2, 3]));
  assert.deepEqual((await pending).value, Uint8Array.from([0, 1, 2, 3]));
  assert.equal(f.audio.state.ended, false);
  f.audio.finish();
  assert.deepEqual(await reader.read(), { done: true, value: undefined });
  reader.releaseLock();
  assert.equal(f.audio.stream.locked, false);
  assert.doesNotMatch(response.headers.get('server-timing'), /synthetic-owner|synthetic-business|Please|provider|Bearer/);
});

test('native audio bypasses transcription and legacy LLM/TTS while retaining access checks and usage',async()=>{
  const f=fixture();const {response,request}=await f.post(contract.WATTZUN_REALTIME_VOICE_STREAM_TYPE);
  assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),contract.WATTZUN_REALTIME_VOICE_STREAM_TYPE);
  assert.deepEqual(f.events,['authenticate','access','realtime','nativeSpeech','recordUsage','access']);
  assert.equal(f.recorded.length,1);assert.equal(f.providerSignals[0],request.signal);
  const result=await readWattzunVoiceStream(response,f.controller.signal,matchesReply);
  assert.equal(result.transcript,'');assert.deepEqual(result.reply,reply);
  assert.equal(result.requestSummary,'Prepare a new quote. Customer details are still needed.');
  const reader=result.audio.stream.getReader(),pending=reader.read(); f.audio.push(Uint8Array.from([0,1]));
  assert.deepEqual((await pending).value,Uint8Array.from([0,1]));assert.equal(f.audio.state.ended,false);
  f.audio.finish();assert.equal((await reader.read()).done,true);reader.releaseLock();
  assert.match(response.headers.get('server-timing'),/realtime;dur=/);assert.doesNotMatch(response.headers.get('server-timing'),/stt;|llm;|tts;/);
});

test('native audio cannot release speech when access is revoked or its usage write fails',async()=>{
  for(const options of [{revokeAt:1},{revokeAt:2},{usageError:new UsageError('unavailable')},{abortAt:'realtime'}]){
    const f=fixture(options);const {response}=await f.post(contract.WATTZUN_REALTIME_VOICE_STREAM_TYPE);
    assert.ok(response.status>=400);assert.match(response.headers.get('content-type'),/json/);assert.equal(f.recorded.length,options.revokeAt===2?1:0);
    if(options.revokeAt===2||options.usageError||options.abortAt) assert.equal(f.audio.state.cancelled,1);
  }
});

test('queued native PCM stays private while the final authority gate runs and is discarded on denial or cancellation', async () => {
  for (const outcome of ['allow', 'deny', 'cancel']) {
    const f = fixture(); let release, entered;
    const gate = new Promise(resolve => { release = resolve; }), started = new Promise(resolve => { entered = resolve; });
    const original = f.deps.turnAuthority;
    f.deps.turnAuthority = async (...args) => {
      if (args[3]) { entered(); await gate; if (outcome === 'deny') throw new AccessError(403, 'Current access was revoked.'); }
      return original(...args);
    };
    let handedOff = false;
    const pending = f.post(contract.WATTZUN_REALTIME_VOICE_STREAM_TYPE).then(value => { handedOff = true; return value; });
    await started;
    f.audio.push(Uint8Array.from([0, 1, 2, 3])); f.audio.finish();
    assert.equal(f.events.includes('nativeSpeech'), true); assert.equal(f.recorded.length, 1);
    assert.equal(handedOff, false); assert.equal(f.audio.state.pulls, 0);
    if (outcome === 'cancel') f.controller.abort(); release();
    const { response } = await pending;
    if (outcome === 'allow') {
      const result = await readWattzunVoiceStream(response, f.controller.signal, matchesReply), reader = result.audio.stream.getReader();
      assert.deepEqual((await reader.read()).value, Uint8Array.from([0, 1, 2, 3])); assert.equal((await reader.read()).done, true); reader.releaseLock();
    } else {
      assert.equal(response.status, outcome === 'deny' ? 403 : 409); const body = await response.json();
      assert.equal(body.reply, undefined); assert.equal(body.audio, undefined); assert.equal(body.transcript, undefined);
      assert.equal(f.audio.state.cancelled, 1); assert.equal(f.audio.state.pulls, 0);
    }
  }
});

test('native provider timing headers allow only bounded numeric phase measurements',async()=>{
  const f=fixture({timings:{rt_guard:20.2,rt_connect:120,rt_config:40,rt_proposal:1500,rt_first_argument:1100,
    rt_validate:1,rt_approval:200,secret:'private value',rt_fake:123,rt_unknown:NaN}});
  const {response}=await f.post(contract.WATTZUN_REALTIME_VOICE_STREAM_TYPE);
  assert.match(response.headers.get('server-timing'),/rt_guard;dur=20.2/);
  assert.match(response.headers.get('server-timing'),/rt_proposal;dur=1500.0/);
  assert.doesNotMatch(response.headers.get('server-timing'),/secret|private|fake|unknown|NaN/);await response.body.cancel();
  for(const duration of [-1,55001,Infinity,'300',null]){
    const invalid=fixture({timings:{rt_proposal:duration}});const {response}=await invalid.post(contract.WATTZUN_REALTIME_VOICE_STREAM_TYPE);
    assert.doesNotMatch(response.headers.get('server-timing'),/rt_proposal/);await response.body.cancel();
  }
});

function greetingRequest(body={},headers={},signal) {
  return new Request('https://example.test/api/wattzun/greeting',{method:'POST',signal,
    headers:{origin:'https://example.test','content-type':'application/json',...headers},
    body:JSON.stringify({portal:input.portal,scopeId:input.scopeId,requestId:input.requestId,name:'James Preston',preferences:{speed:1.15},...body})});
}

const completedWorkflow = { state: 'complete', receipt: { kind: 'invoice_reminder', id: 'actual-submission-123', label: 'Open customer message', href: '/direct-trade/dashboard?workspace=connect', status: 'submitted', message: 'The provider accepted the invoice reminder for sending. Delivery is not yet confirmed.' } };
function receiptSpeechRequest(body = {}, headers = {}, signal) {
  return new Request('https://example.test/api/wattzun/workflows/speech', { method: 'POST', signal,
    headers: { origin: 'https://example.test', 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ portal: 'trade', scopeId: input.scopeId, requestId: input.requestId, workflowReviewId: workflowReview.reviewId, preferences: { speed: 1.15 }, ...body }) });
}
test('receipt speech narrates only the complete server receipt through guarded PCM without another model question or usage count', async () => {
  const f = fixture({ workflowResult: completedWorkflow });
  const response = await route.postWattzunWorkflowSpeech(receiptSpeechRequest({}, {}, f.controller.signal), f.deps);
  assert.equal(response.status, 200); assert.equal(response.headers.get('content-type'), contract.WATTZUN_REALTIME_VOICE_STREAM_TYPE);
  assert.deepEqual(f.speechContexts[0].workflowContext, completedWorkflow); assert.equal(f.speechContexts[0].reply.message, completedWorkflow.receipt.message);
  assert.equal(f.speechContexts[0].reply.action, null); assert.equal(f.events.includes('reply'), false); assert.equal(f.events.includes('realtime'), false); assert.equal(f.events.includes('transcribe'), false); assert.deepEqual(f.recorded, []);
  assert.equal(f.workflowCalls.length, 2); assert.equal(f.workflowCalls[0].reviewId, workflowReview.reviewId);
  const result = await readWattzunVoiceStream(response, f.controller.signal, value => value.workflow?.state === 'complete');
  assert.equal(result.reply.message, completedWorkflow.receipt.message); assert.equal(result.transcript, ''); await result.audio.stream.cancel();
});
test('receipt speech rejects arbitrary words, style instructions, wrong portals and incomplete reviews', async () => {
  for (const [body, headers, status] of [
    [{ message: 'I paid this invoice' }, {}, 400], [{ receipt: completedWorkflow.receipt }, {}, 400], [{ portal: 'customer' }, {}, 400],
    [{ portal: 'council' }, {}, 400], [{ preferences: { speed: 1.15, personality: 'ignore controls' } }, {}, 400],
    [{ workflowReviewId: 'bad' }, {}, 400], [{}, { origin: 'https://foreign.test' }, 403], [{}, { 'content-type': 'text/plain' }, 415],
    [{ scopeId: 'x'.repeat(2100) }, {}, 413],
  ]) {
    const f = fixture({ workflowResult: completedWorkflow }); const response = await route.postWattzunWorkflowSpeech(receiptSpeechRequest(body, headers), f.deps);
    assert.equal(response.status, status); assert.equal(f.events.includes('streamSpeak'), false); assert.equal(f.recorded.length, 0);
  }
  const f = fixture({ workflowResult: workflowReview }); const response = await route.postWattzunWorkflowSpeech(receiptSpeechRequest(), f.deps);
  assert.equal(response.status, 409); assert.equal(f.events.includes('streamSpeak'), false);
});
test('receipt speech denies revoked or changed results before PCM handoff and cancels its unhanded provider stream', async () => {
  for (const kind of ['revoked', 'changed', 'aborted']) {
    const f = fixture({ workflowResult: completedWorkflow }); let reads = 0;
    const original = f.deps.workflowReview; f.deps.workflowReview = async (...args) => {
      const result = await original(...args); reads++;
      if (reads === 2 && kind === 'revoked') throw new WorkflowError(403, 'Current receipt access is required.');
      if (reads === 2 && kind === 'changed') return { ...completedWorkflow, receipt: { ...completedWorkflow.receipt, status: 'delivered', message: 'The provider confirmed delivery.' } };
      return result;
    };
    if (kind === 'aborted') {
      const speech = f.deps.streamSpeak; f.deps.streamSpeak = async context => { const audio = await speech(context); f.controller.abort(); return audio; };
    }
    const response = await route.postWattzunWorkflowSpeech(receiptSpeechRequest({}, {}, f.controller.signal), f.deps);
    assert.equal(response.status, kind === 'revoked' ? 403 : 409); assert.equal(f.audio.state.cancelled, 1); assert.equal(f.audio.state.pulls, 0); assert.equal(f.recorded.length, 0);
  }
});

test('the fixed personalised greeting streams before EOF without transcription, reasoning or question usage',async()=>{
  const f=fixture();const expected={kind:'answer',message:"Hi James, I'm here. What can I help you with?",questions:[],links:[]};
  const request=greetingRequest({}, {},f.controller.signal);
  f.deps.streamSpeak=async context=>{
    f.events.push('streamSpeak');assert.deepEqual(context.reply,expected);assert.equal(context.input.message,expected.message);
    assert.deepEqual(context.input.history,[]);assert.equal(context.input.preferences.speed,1.15);assert.equal(context.signal,request.signal);
    return f.audio.stream;
  };
  const response=await route.postWattzunGreeting(request,f.deps);
  assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),contract.WATTZUN_REALTIME_VOICE_STREAM_TYPE);
  assert.equal(response.headers.get('cache-control'),'private, no-store');
  assert.deepEqual(f.events,['authenticate','access','streamSpeak','access']);assert.deepEqual(f.recorded,[]);
  const result=await readWattzunVoiceStream(response,f.controller.signal,value=>JSON.stringify(value)===JSON.stringify(expected));
  assert.equal(result.transcript,'');assert.equal(result.requestSummary,undefined);
  const reader=result.audio.stream.getReader(),pending=reader.read();f.audio.push(Uint8Array.from([0,1]));
  assert.deepEqual((await pending).value,Uint8Array.from([0,1]));assert.equal(f.audio.state.ended,false);
  f.audio.finish();assert.equal((await reader.read()).done,true);reader.releaseLock();
  assert.doesNotMatch(response.headers.get('server-timing'),/stt;|llm;|realtime;|usage;|James/);
});

test('greetings stop before audio disclosure after revocation, scope change, cancellation or provider failure',async()=>{
  for(const options of [{revokeAt:1},{revokeAt:2},{changed:{...access,actorUid:'another-actor'}},{abort:true},{providerError:true}]){
    const f=fixture(options);
    f.deps.streamSpeak=async()=>{
      f.events.push('streamSpeak');if(options.providerError)throw new Error('provider unavailable');
      if(options.abort)f.controller.abort();return f.audio.stream;
    };
    const response=await route.postWattzunGreeting(greetingRequest({}, {},f.controller.signal),f.deps);
    assert.ok(response.status>=400);assert.equal((await response.json()).reply,undefined);assert.equal(f.recorded.length,0);
    if(options.revokeAt===2||options.changed||options.abort)assert.equal(f.audio.state.cancelled,1);
  }
});

test('greeting requests reject cross origin, unsupported portal, voice overrides, extra instructions and oversized bodies',async()=>{
  for(const [body,headers,status] of [[{}, {origin:'https://foreign.test'},403],[{}, {'content-type':'text/plain'},415],
    [{portal:'customer'}, {},400],[{preferences:{speed:1,voice:'other'}}, {},400],[{message:'arbitrary speech'}, {},400],
    [{name:'x'.repeat(2100)}, {},413]]){
    const f=fixture();const response=await route.postWattzunGreeting(greetingRequest(body,headers),f.deps);
    assert.equal(response.status,status);assert.equal(f.events.includes('streamSpeak'),false);assert.equal(f.recorded.length,0);
  }
});

test('native WAV admits the exact 45 second PCM bound and rejects overflow or other encodings',async()=>{
  const exact=fixture({audioBytes:contract.WATTZUN_MAX_WAV_AUDIO_BYTES});
  const {response}=await exact.post(contract.WATTZUN_REALTIME_VOICE_STREAM_TYPE);assert.equal(response.status,200);await response.body.cancel();
  for(const options of [{audioBytes:contract.WATTZUN_MAX_WAV_AUDIO_BYTES+1},{audioType:'audio/webm'}]){
    const f=fixture(options);const {response}=await f.post(contract.WATTZUN_REALTIME_VOICE_STREAM_TYPE);
    assert.equal(response.status,400);assert.equal(f.events.includes('realtime'),false);
  }
});

test('route splits large provider chunks into bounded frames while preserving exact binary PCM order', async () => {
  const f = fixture(), expected = Uint8Array.from({ length: 70000 }, (_, index) => index % 256);
  f.audio.push(expected); f.audio.finish();
  const { response } = await f.post();
  const frames = (await response.text()).trim().split('\n').map(line => JSON.parse(line));
  assert.equal(frames[0].type, 'reply'); assert.equal(frames.at(-1).type, 'done');
  const chunks = frames.slice(1, -1).map(value => {
    assert.equal(value.type, 'audio');
    const bytes = Buffer.from(value.data, 'base64'); assert.ok(bytes.byteLength <= 32000);
    return bytes;
  });
  assert.deepEqual(chunks.map(value => value.byteLength), [32000, 32000, 6000]);
  assert.deepEqual(Buffer.concat(chunks), Buffer.from(expected));
});

test('revocation before or after every voice stage suppresses metadata and audio and cancels any acquired TTS stream', async () => {
  for (const revokeAt of [1, 2, 3, 4]) {
    const f = fixture({ revokeAt }), { response } = await f.post();
    assert.equal(response.status, 403);
    const body = await response.json();
    assert.deepEqual(body, { ok: false, error: 'Current business access is required.' });
    assert.equal(f.events.includes('transcribe'), revokeAt > 1);
    assert.equal(f.events.includes('reply'), revokeAt > 2);
    assert.equal(f.events.includes('streamSpeak'), revokeAt > 3);
    assert.equal(f.recorded.length, 0);
    assert.equal(f.audio.state.cancelled, revokeAt === 4 ? 1 : 0);
    assert.equal(f.audio.state.pulls, 0);
    assert.equal(f.audio.stream.locked, false);
  }
});

test('a changed actor, business ID, portal or business label cannot release a streaming reply', async () => {
  for (const changed of [
    { ...access, actorUid: 'other-owner' },
    { ...access, scope: { ...access.scope, scopeId: 'other-business' } },
    { ...access, scope: { ...access.scope, portal: 'creditex' } },
    { ...access, scope: { ...access.scope, label: 'Other business' } },
  ]) {
    const f = fixture({ changed }), { response } = await f.post();
    assert.equal(response.status, 403);
    const body = await response.json();
    assert.equal(body.ok, false); assert.equal(body.reply, undefined); assert.equal(body.transcript, undefined); assert.equal(body.audio, undefined);
    assert.equal(f.events.includes('reply'), false); assert.equal(f.recorded.length, 0);
  }
});

test('usage persistence failure cancels acquired TTS and returns no untracked metadata or audio', async () => {
  const f = fixture({ usageError: new UsageError('unavailable') }), { response } = await f.post();
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { ok: false, error: 'Wattzun usage could not be saved or loaded. Please try again.' });
  assert.equal(f.audio.state.cancelled, 1); assert.equal(f.audio.state.pulls, 0);
  assert.equal(f.recorded.length, 0); assert.equal(f.audio.stream.locked, false);
});

test('provider failure before handoff returns generic JSON without leaking provider details', async () => {
  const f = fixture({ providerError: new Error('provider-private-key bearer-secret synthetic-owner') }), { response } = await f.post();
  assert.equal(response.status, 503);
  const text = await response.text();
  assert.doesNotMatch(text, /provider-private-key|bearer-secret|synthetic-owner/);
  assert.deepEqual(JSON.parse(text), { ok: false, error: 'Wattzun could not confirm this turn. Check the same task before starting another action.' });
  assert.equal(f.recorded.length, 0);
});

test('provider failure after handoff is sanitised and cannot add done or private error content', async () => {
  const f = fixture(), { response } = await f.post();
  const reader = response.body.getReader(), decoder = new TextDecoder();
  assert.equal(JSON.parse(decoder.decode((await reader.read()).value)).type, 'reply');
  const pending = reader.read();
  f.audio.fail(new Error('private-provider-body sk-test-secret'));
  await assert.rejects(pending, error => {
    assert.equal(error.message, 'Wattzun audio stopped before the reply finished.');
    assert.doesNotMatch(error.message, /private-provider-body|sk-test-secret/);
    return true;
  });
  reader.releaseLock();
});

test('hang-up during any pre-output stage suppresses subsequent work and cancels TTS when acquired', async () => {
  for (const abortAt of ['transcribe', 'reply', 'streamSpeak', 'usage']) {
    const f = fixture({ abortAt }), { response } = await f.post();
    assert.equal(response.status, 409);
    const body = await response.json();
    assert.equal(body.ok, false); assert.equal(body.reply, undefined); assert.equal(body.transcript, undefined); assert.equal(body.audio, undefined);
    assert.equal(f.audio.state.cancelled, abortAt === 'streamSpeak' || abortAt === 'usage' ? 1 : 0);
    assert.equal(f.audio.state.pulls, 0);
  }
});

test('canceling the delivered stream during synthesis immediately cancels the provider reader', async () => {
  const f = fixture(), { response } = await f.post();
  const reader = response.body.getReader();
  await reader.read();
  const pending = reader.read();
  await reader.cancel();
  assert.deepEqual(await pending, { done: true, value: undefined });
  assert.equal(f.audio.state.cancelled, 1);
  reader.releaseLock();
});

test('hang-up after streaming handoff cannot emit additional provider audio', async () => {
  const f = fixture(), { response } = await f.post();
  const reader = response.body.getReader();
  await reader.read();
  const pending = reader.read();
  f.controller.abort(); f.audio.push(Uint8Array.from([1, 2]));
  await assert.rejects(pending, /Wattzun audio stopped before the reply finished/);
  assert.equal(f.audio.state.cancelled, 1);
  reader.releaseLock();
});

test('structured quote proposals pass through the streaming reply unchanged and never execute a save', async () => {
  const quote = { kind: 'clarification', message: 'Review the quote details first.', questions: ['What is the price before GST?'], links: [],
    action: { kind: 'prepare_quote', firstName: 'Jane', lastName: 'Smith', email: '', phone: '', addressQuery: '', serviceCategory: '', description: '',
      lines: [{ lineType: 'product', description: 'Heat pump', quantity: 1, unitPrice: null, taxCode: null }] }, lookup: null };
  const f = fixture({ reply: quote }), { response } = await f.post();
  const result = await readWattzunVoiceStream(response, f.controller.signal, value => JSON.stringify(value) === JSON.stringify(quote));
  assert.deepEqual(result.reply, quote);
  assert.doesNotMatch(f.events.join(' '), /create|save|send/);
  await result.audio.stream.cancel();
  assert.equal(f.audio.state.cancelled, 1);
});

test('an existing client without streaming negotiation retains the JSON and MP3 call response', async () => {
  const f = fixture(), { response } = await f.post('application/json');
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /^application\/json/);
  assert.deepEqual(await response.json(), { ok: true, transcript, reply, audio: { base64: 'AAA=', mimeType: 'audio/mpeg' } });
  assert.equal(f.events.includes('streamSpeak'), false); assert.equal(f.events.includes('speak'), true);
  assert.equal(f.audio.state.pulls, 0); assert.equal(f.audio.state.cancelled, 0);
});
