import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import * as contract from '../src/lib/wattzun-portal.ts';
import * as greeting from '../src/lib/wattzun-greeting.ts';
import * as workflowContract from '../src/lib/wattzun-workflow.ts';
import * as workflowReply from '../src/lib/wattzun-workflow-reply.ts';
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
class ExistingQuoteError extends Error { constructor(status, message) { super(message); this.status = status; } }
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
  if (name === './wattzun-usage-server') return { WattzunUsageError: UsageError };
  if (name === './wattzun-work-context' || name === './wattzun-work-context.ts') return workContextContract;
  if (name === './wattzun-work-context-server') return contextGateway;
  if (name === './wattzun-workflow') return workflowContract;
  if (name === './wattzun-workflow-reply') return workflowReply;
  if (name === './wattzun-workflow-server') return { WattzunWorkflowError: WorkflowError };
  if (name === './wattzun-existing-quote-server') return { WattzunExistingQuoteError: ExistingQuoteError };
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
test('native workflow skips a duplicate pre-preparation snapshot while retaining speech, pre-usage and final selected-source gates', async () => {
  const workContext = syntheticWorkContext();
  const f = fixture({ input: { ...input, workReference: workContext.reference }, workContext,
    reply: { ...reply, action: workflowProposal }, workflowResult: workflowReview });
  const { response } = await f.post(contract.WATTZUN_REALTIME_VOICE_STREAM_TYPE); assert.equal(response.status, 200);
  assert.equal(f.events.filter(value => value === 'context').length, 4);
  assert.deepEqual(f.events.slice(f.events.indexOf('realtime') + 1, f.events.indexOf('prepareWorkflow') + 1), ['access', 'prepareWorkflow']);
  assert.deepEqual(f.events.slice(f.events.indexOf('prepareWorkflow') + 1, f.events.indexOf('nativeSpeech')), ['access', 'context', 'workflowReview']);
  assert.equal(f.recorded.length, 1); await response.body.cancel();
});
test('a selected source changed after native workflow preparation still stops speech and usage', async () => {
  const workContext = syntheticWorkContext();
  const f = fixture({ input: { ...input, workReference: workContext.reference }, workContext, contextChangedAt: 2,
    reply: { ...reply, action: workflowProposal }, workflowResult: workflowReview });
  const { response } = await f.post(contract.WATTZUN_REALTIME_VOICE_STREAM_TYPE); assert.equal(response.status, 409);
  assert.equal(f.events.includes('prepareWorkflow'), true); assert.equal(f.events.includes('nativeSpeech'), false);
  assert.equal(f.recorded.length, 0); assert.equal(f.audio.state.pulls, 0); assert.equal((await response.json()).reply, undefined);
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

test('native work context is checked before speech and only source metadata is published', async () => {
  const workContext = syntheticWorkContext();
  const f = fixture({ input: { ...input, workReference: workContext.reference }, workContext });
  const { response } = await f.post(contract.WATTZUN_REALTIME_VOICE_STREAM_TYPE);
  assert.equal(response.status, 200); assert.equal(f.providerContexts[0].workContext, workContext);
  assert.deepEqual(f.events, ['authenticate', 'access', 'context', 'realtime', 'access', 'context', 'nativeSpeech', 'access', 'context', 'recordUsage', 'access', 'context']);
  const result = await readWattzunVoiceStream(response, f.controller.signal, value => Boolean(value.workContext));
  assert.deepEqual(result.reply.workContext, contextGateway.wattzunWorkContextInfo(workContext));
  assert.equal(result.reply.workContext.facts, undefined);
  assert.doesNotMatch(JSON.stringify(result.reply), /switchboard|operationalStage|trade_job_overview/);
  await result.audio.stream.cancel();
});

test('native stale or revoked sources stop narration, cancel prepared audio and never publish a reply or usage', async () => {
  const workContext = syntheticWorkContext();
  for (const options of [
    { contextChangedAt: 2, status: 409, speechStarted: false },
    { contextError: new workContextContract.WattzunWorkContextError(403, 'Job access was revoked.'), contextErrorAt: 2, status: 403, speechStarted: false },
    { contextChangedAt: 3, status: 409, speechStarted: true },
  ]) {
    const f = fixture({ ...options, input: { ...input, workReference: workContext.reference }, workContext });
    const { response } = await f.post(contract.WATTZUN_REALTIME_VOICE_STREAM_TYPE);
    assert.equal(response.status, options.status);
    const body = await response.json();
    assert.equal(body.reply, undefined); assert.equal(body.audio, undefined);
    assert.equal(f.events.includes('nativeSpeech'), options.speechStarted);
    assert.equal(f.audio.state.cancelled, Number(options.speechStarted));
    assert.equal(f.recorded.length, 0);
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
      assert.ok(f.events.lastIndexOf('access') > f.events.indexOf('recordUsage'));
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
  assert.deepEqual(f.events,['authenticate','access','realtime','access','nativeSpeech','access','recordUsage','access']);
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
  for(const options of [{revokeAt:1},{revokeAt:2},{revokeAt:3},{usageError:new UsageError('unavailable')},{abortAt:'realtime'}]){
    const f=fixture(options);const {response}=await f.post(contract.WATTZUN_REALTIME_VOICE_STREAM_TYPE);
    assert.ok(response.status>=400);assert.match(response.headers.get('content-type'),/json/);assert.equal(f.recorded.length,0);
    if(options.revokeAt===3||options.usageError||options.abortAt) assert.equal(f.audio.state.cancelled,1);
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
  assert.deepEqual(JSON.parse(text), { ok: false, error: 'Wattzun could not complete this turn. Your records have not changed. Try again, or continue by typing.' });
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
