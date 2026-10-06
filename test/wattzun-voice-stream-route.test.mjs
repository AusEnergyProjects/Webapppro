import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import * as contract from '../src/lib/wattzun-portal.ts';
import { readWattzunVoiceStream } from '../src/lib/wattzun-voice-stream.ts';

class AccessError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
class UsageError extends Error {
  constructor(code) { super(`WATTZUN_USAGE_${code.toUpperCase()}`); this.code = code; }
}
const route = {};
const executable = ts.transpileModule(readFileSync(new URL('../src/lib/wattzun-portal-route.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
Function('require', 'exports', executable)(name => {
  if (name === './wattzun-portal') return contract;
  if (name === './wattzun-portal-access-server') return {
    WattzunAccessError: AccessError,
    wattzunAccessFailure: error => error instanceof AccessError ? { status: error.status, message: error.message } : null,
  };
  if (name === './wattzun-portal-ai-server' || name === './wattzun-realtime-server' || name === './wattzun-usage') return {};
  if (name === './wattzun-usage-server') return { WattzunUsageError: UsageError };
  throw new Error(`Unexpected route dependency: ${name}`);
}, route);

const input = { portal: 'trade', scopeId: 'synthetic-business', requestId: 'synthetic-stream-request-0001', message: '',
  history: [{ role: 'user', content: 'Please help prepare a new quote.' }], preferences: { speed: 1.15 } };
const access = { db: { synthetic: true }, actorUid: 'synthetic-owner', scope: { portal: 'trade', scopeId: input.scopeId, label: 'Synthetic business' } };
const transcript = 'Please prepare my new quote.';
const reply = { kind: 'clarification', message: 'I can help prepare your quote.', questions: ['Which customer is it for?'], links: [] };
const matchesReply = value => JSON.stringify(value) === JSON.stringify(reply);

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
  const audio = providerAudio(), events = [], recorded = [], providerSignals = [];
  let accessChecks = 0;
  const controller = new AbortController();
  const deps = {
    authenticate: async () => { events.push('authenticate'); },
    scopes: async () => [],
    access: async (_request, portal, scopeId) => {
      events.push('access'); accessChecks++;
      assert.equal(portal, input.portal); assert.equal(scopeId, input.scopeId);
      if (accessChecks === options.revokeAt) throw new AccessError(403, 'Current business access is required.');
      return accessChecks > 1 && options.changed ? options.changed : access;
    },
    transcribe: async context => {
      events.push('transcribe'); providerSignals.push(context.signal);
      assert.equal(context.actorUid, access.actorUid); assert.ok(context.audio instanceof Blob);
      if (options.abortAt === 'transcribe') controller.abort();
      return transcript;
    },
    reply: async context => {
      events.push('reply'); providerSignals.push(context.signal);
      assert.equal(context.actorUid, access.actorUid);
      assert.deepEqual(context.input, { ...input, message: transcript });
      if (options.abortAt === 'reply') controller.abort();
      return options.reply || reply;
    },
    streamSpeak: async context => {
      events.push('streamSpeak'); providerSignals.push(context.signal);
      assert.deepEqual(context.reply, options.reply || reply);
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
      assert.equal(context.audio.type,'audio/wav'); assert.deepEqual(context.input,input);
      if(options.providerError) throw options.providerError;
      await context.beforeSpeech(); events.push('nativeSpeech');
      if(options.abortAt==='realtime') controller.abort();
      return {reply:options.reply||reply,audio:audio.stream,requestSummary:'Prepare a new quote. Customer details are still needed.'};
    },
    recordUsage: async value => {
      events.push('recordUsage');
      assert.deepEqual(value, { access, requestId: input.requestId, kind: 'voice' });
      if (options.usageError) throw options.usageError;
      if (options.abortAt === 'usage') controller.abort();
      recorded.push(value);
    },
    usage: async () => { throw new Error('Unexpected usage read.'); },
  };
  async function post(accept = contract.WATTZUN_VOICE_STREAM_TYPE) {
    const form = new FormData();
    form.set('request', JSON.stringify(input));
    const native = accept === contract.WATTZUN_REALTIME_VOICE_STREAM_TYPE;
    form.set('audio', new Blob([new Uint8Array(options.audioBytes||300)], { type: options.audioType || (native ? 'audio/wav' : 'audio/webm;codecs=opus') }), native?'synthetic.wav':'synthetic.webm');
    const request = new Request('https://example.test/api/wattzun/voice', {
      method: 'POST', headers: { origin: 'https://example.test', accept }, body: form, signal: controller.signal,
    });
    const response = await route.postWattzunVoice(request, deps);
    return { request, response };
  }
  return { audio, events, recorded, providerSignals, controller, deps, post };
}

test('the authorised streaming response and first audio arrive before provider EOF without waiting for full synthesis', async () => {
  const f = fixture();
  const { response, request } = await f.post();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), contract.WATTZUN_VOICE_STREAM_TYPE);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(f.audio.state.ended, false);
  assert.equal(f.audio.state.pulls, 0);
  assert.deepEqual(f.events, ['authenticate', 'access', 'transcribe', 'access', 'reply', 'access', 'streamSpeak', 'access', 'recordUsage']);
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
  assert.deepEqual(f.events,['authenticate','access','realtime','access','nativeSpeech','access','recordUsage']);
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
