import assert from 'node:assert/strict';
import test from 'node:test';
import { readWattzunVoiceStream } from '../src/lib/wattzun-voice-stream.ts';
import { WATTZUN_MAX_AUDIO_BYTES, WATTZUN_VOICE_STREAM_TYPE, WATTZUN_REALTIME_VOICE_STREAM_TYPE } from '../src/lib/wattzun-portal.ts';

const encoder = new TextEncoder();
const reply = { kind: 'clarification', message: 'I can help with that quote.', questions: ['Which job is this for?'], links: [] };
const metadata = { type: 'reply', transcript: 'Prépare a quote for Zoë.', reply };
const frame = value => encoder.encode(JSON.stringify(value) + '\n');
const audioFrame = bytes => frame({ type: 'audio', data: Buffer.from(bytes).toString('base64') });
const matchesReply = value => JSON.stringify(value) === JSON.stringify(reply);
const unreadableMessage = /^Wattzun returned an unreadable voice reply\. Try again\.$/;
const unreadable = error => { assert.match(error.message, unreadableMessage); return true; };

function network() {
  let controller;
  const state = { cancelled: 0, pulls: 0, ended: false };
  const stream = new ReadableStream({
    start(value) { controller = value; },
    pull() { state.pulls++; },
    cancel() { state.cancelled++; },
  }, { highWaterMark: 0 });
  return {
    stream, state,
    push(bytes) { controller.enqueue(bytes); },
    finish() { state.ended = true; controller.close(); },
    fail(error) { controller.error(error); },
    response(contentType = WATTZUN_VOICE_STREAM_TYPE) { return new Response(stream, { headers: { 'Content-Type': contentType } }); },
  };
}

async function resultFor(frames, predicate = matchesReply) {
  const wire = network();
  for (const bytes of frames) wire.push(bytes);
  const signal = new AbortController();
  return { wire, result: await readWattzunVoiceStream(wire.response(), signal.signal, predicate), signal };
}

async function collect(stream) {
  const reader = stream.getReader();
  const chunks = [];
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) return Buffer.concat(chunks.map(chunk => Buffer.from(chunk)));
      chunks.push(next.value);
    }
  } finally { reader.releaseLock(); }
}

test('validated metadata returns before audio and playback consumes the first PCM bytes before network EOF', async () => {
  const wire = network();
  wire.push(frame(metadata));
  let validated = 0;
  const result = await readWattzunVoiceStream(wire.response(), new AbortController().signal, value => {
    validated++; assert.deepEqual(value, reply); return true;
  });
  assert.equal(validated, 1);
  assert.equal(result.ok, true);
  assert.equal(result.transcript, metadata.transcript);
  assert.deepEqual(result.reply, reply);
  assert.equal(result.audio.mimeType, 'audio/pcm');
  assert.equal(wire.state.ended, false);
  const reader = result.audio.stream.getReader();
  const pending = reader.read();
  wire.push(audioFrame([0, 1, 254, 255]));
  assert.deepEqual(await pending, { done: false, value: Uint8Array.from([0, 1, 254, 255]) });
  assert.equal(wire.state.ended, false);
  wire.push(frame({ type: 'done' }));
  assert.deepEqual(await reader.read(), { done: true, value: undefined });
  assert.equal(wire.state.cancelled, 1);
  reader.releaseLock();
  assert.equal(wire.stream.locked, false);
});

test('native audio metadata starts playback without requiring a transcript', async () => {
  const requestSummary='Prepare a new quote for Zoë. The job is not yet identified.';
  const wire = network(); wire.push(frame({ ...metadata, transcript: '', requestSummary }));
  const result = await readWattzunVoiceStream(wire.response(WATTZUN_REALTIME_VOICE_STREAM_TYPE),new AbortController().signal,matchesReply);
  assert.equal(result.transcript,''); assert.deepEqual(result.reply,reply); assert.equal(result.requestSummary,requestSummary);
  const pending=collect(result.audio.stream); wire.push(audioFrame([1,2])); wire.push(frame({type:'done'}));
  assert.deepEqual(await pending,Buffer.from([1,2])); assert.equal(wire.state.cancelled,1);
});

test('native request summaries are bounded strings and cannot arrive on the legacy wire',async()=>{
  for(const [contentType,requestSummary] of [[WATTZUN_REALTIME_VOICE_STREAM_TYPE,''],[WATTZUN_REALTIME_VOICE_STREAM_TYPE,'x'.repeat(1801)],
    [WATTZUN_REALTIME_VOICE_STREAM_TYPE,{text:'unvalidated'}],[WATTZUN_VOICE_STREAM_TYPE,'Unnegotiated context']]){
    const wire=network();wire.push(frame({...metadata,requestSummary}));
    await assert.rejects(readWattzunVoiceStream(wire.response(contentType),new AbortController().signal,matchesReply),unreadable);
    assert.equal(wire.state.cancelled,1);
  }
});

test('invalid metadata or audio before the reply is rejected before the audio stream is exposed', async () => {
  for (const invalid of [
    { type: 'audio', data: 'AAA=' },
    { type: 'reply', transcript: '', reply },
    { type: 'reply', transcript: 'a'.repeat(4001), reply },
    { type: 'reply', transcript: metadata.transcript, reply: null },
    { type: 'done' },
  ]) {
    const wire = network(); wire.push(frame(invalid)); wire.push(audioFrame([1, 2]));
    await assert.rejects(readWattzunVoiceStream(wire.response(), new AbortController().signal, matchesReply), unreadable);
    assert.equal(wire.state.cancelled, 1);
    assert.equal(wire.stream.locked, false);
  }
});

test('the supplied reply validator must admit metadata before any PCM is returned', async () => {
  const wire = network(); wire.push(frame(metadata)); wire.push(audioFrame([1, 2]));
  let checks = 0;
  await assert.rejects(readWattzunVoiceStream(wire.response(), new AbortController().signal, () => { checks++; return false; }), unreadable);
  assert.equal(checks, 1); assert.equal(wire.state.cancelled, 1);
});

test('split JSON and multibyte UTF-8 frames preserve the transcript, clarification and exact PCM byte order', async () => {
  const bytes = Buffer.concat([
    Buffer.from(frame(metadata)), Buffer.from(audioFrame([0, 255, 3])),
    Buffer.from(audioFrame([4, 0, 128, 127, 64])), Buffer.from(frame({ type: 'done' })),
  ]);
  const wire = network();
  for (let offset = 0; offset < bytes.length; offset++) wire.push(Uint8Array.from([bytes[offset]]));
  const result = await readWattzunVoiceStream(wire.response(), new AbortController().signal, matchesReply);
  assert.equal(result.transcript, metadata.transcript);
  assert.deepEqual(result.reply, reply);
  assert.deepEqual(await collect(result.audio.stream), Buffer.from([0, 255, 3, 4, 0, 128, 127, 64]));
  assert.equal(wire.state.cancelled, 1);
});

test('a reviewed quote proposal survives metadata transport without losing names, unknown prices or lookup boundaries', async () => {
  const proposedReply = { kind: 'clarification', message: 'Review the details before saving.', questions: ['What is the unit price before GST?'], links: [],
    action: { kind: 'prepare_quote', firstName: 'Zoë', lastName: "O'Connor", email: '', phone: '', addressQuery: '152 Elizabeth Street Melbourne',
      serviceCategory: '', description: 'Replace hot water unit.', lines: [{ lineType: 'product', description: 'Hot water unit', quantity: 1, unitPrice: null, taxCode: null }] }, lookup: null };
  const wire = network(); wire.push(frame({ ...metadata, reply: proposedReply }));
  wire.push(audioFrame([1, 2])); wire.push(frame({ type: 'done' }));
  const result = await readWattzunVoiceStream(wire.response(), new AbortController().signal, value => JSON.stringify(value) === JSON.stringify(proposedReply));
  assert.deepEqual(result.reply, proposedReply);
  assert.deepEqual(await collect(result.audio.stream), Buffer.from([1, 2]));
});

test('the exact cumulative 2 MB PCM boundary succeeds without trusting individual frame sizes', async () => {
  const frames = [frame(metadata)];
  let remaining = WATTZUN_MAX_AUDIO_BYTES;
  while (remaining > 0) { const size = Math.min(32000, remaining); frames.push(audioFrame(new Uint8Array(size))); remaining -= size; }
  frames.push(frame({ type: 'done' }));
  const { wire, result } = await resultFor(frames);
  assert.equal((await collect(result.audio.stream)).byteLength, WATTZUN_MAX_AUDIO_BYTES);
  assert.equal(wire.state.cancelled, 1);
});

test('cumulative PCM overflow cancels the stream even when every individual frame is small and valid', async () => {
  const frames = [frame(metadata)];
  let remaining = WATTZUN_MAX_AUDIO_BYTES;
  while (remaining > 0) { const size = Math.min(32000, remaining); frames.push(audioFrame(new Uint8Array(size))); remaining -= size; }
  frames.push(audioFrame([1, 2])); frames.push(frame({ type: 'done' }));
  const { wire, result } = await resultFor(frames);
  await assert.rejects(collect(result.audio.stream), unreadable);
  assert.equal(wire.state.cancelled, 1);
  assert.equal(wire.stream.locked, false);
});

test('empty, odd-length and malformed PCM streams fail closed and cancel upstream', async () => {
  for (const body of [
    [frame({ type: 'done' })],
    [audioFrame([1]), frame({ type: 'done' })],
    [frame({ type: 'audio', data: '' })],
    [frame({ type: 'audio', data: '@@==' })],
    [frame({ type: 'audio', data: 'A' })],
    [frame({ type: 'unknown', data: 'AAA=' })],
    [frame(metadata)],
  ]) {
    const { wire, result } = await resultFor([frame(metadata), ...body]);
    await assert.rejects(collect(result.audio.stream), unreadable);
    assert.equal(wire.state.cancelled, 1);
    assert.equal(wire.stream.locked, false);
  }
});

test('missing done and partial final JSON cannot turn a truncated response into successful audio', async () => {
  for (const trailing of [new Uint8Array(), encoder.encode('{"type":"done"'), encoder.encode('{"type":"done"}')]) {
    const { wire, result } = await resultFor([frame(metadata), audioFrame([1, 2]), trailing]);
    wire.finish();
    await assert.rejects(collect(result.audio.stream), unreadable);
    assert.equal(wire.stream.locked, false);
  }
});

test('oversized unterminated frames are rejected while still arriving rather than waiting for EOF', async () => {
  const { wire, result } = await resultFor([frame(metadata), encoder.encode('x'.repeat(64001))]);
  await assert.rejects(collect(result.audio.stream), unreadable);
  assert.equal(wire.state.ended, false);
  assert.equal(wire.state.cancelled, 1);
});

test('malformed JSON and invalid UTF-8 are sanitised without echoing private wire contents', async () => {
  for (const bad of [encoder.encode('{"private-provider-secret":bad}\n'), Uint8Array.from([0xff, 0xfe, 0x0a])]) {
    const { wire, result } = await resultFor([frame(metadata), bad]);
    await assert.rejects(collect(result.audio.stream), error => {
      assert.match(error.message, unreadableMessage);
      assert.doesNotMatch(error.message, /private-provider-secret|Unexpected token|encoded data/);
      return true;
    });
    assert.equal(wire.state.cancelled, 1);
  }
});

test('hanging up while metadata is pending cancels the network reader and never exposes a reply', async () => {
  const wire = network(), controller = new AbortController();
  const pending = readWattzunVoiceStream(wire.response(), controller.signal, matchesReply);
  controller.abort();
  await assert.rejects(pending, /Call ended\.|unreadable voice reply/);
  assert.equal(wire.state.cancelled, 1);
  assert.equal(wire.stream.locked, false);
});

test('hanging up during a blocked PCM read cancels upstream and prevents further bytes', async () => {
  const { wire, result, signal } = await resultFor([frame(metadata)]);
  const reader = result.audio.stream.getReader();
  const pending = reader.read();
  signal.abort();
  await assert.rejects(pending, /Call ended\.|unreadable voice reply/);
  assert.equal(wire.state.cancelled, 1);
  reader.releaseLock(); assert.equal(wire.stream.locked, false);
});

test('consumer cancellation after the first audio frame releases the network reader exactly once', async () => {
  const { wire, result } = await resultFor([frame(metadata), audioFrame([1, 2])]);
  const reader = result.audio.stream.getReader();
  assert.deepEqual((await reader.read()).value, Uint8Array.from([1, 2]));
  await reader.cancel(); reader.releaseLock();
  assert.equal(wire.state.cancelled, 1);
  assert.equal(wire.stream.locked, false);
});

test('streaming success requires the negotiated content type and server errors retain actionable safe messages', async () => {
  await assert.rejects(readWattzunVoiceStream(new Response('not a voice stream', { headers: { 'Content-Type': 'text/plain' } }), new AbortController().signal, matchesReply), unreadable);
  await assert.rejects(readWattzunVoiceStream(Response.json({ ok: false, error: 'Current business access is required.' }, { status: 403 }), new AbortController().signal, matchesReply), /^Error: Current business access is required\.$/);
  await assert.rejects(readWattzunVoiceStream(new Response('provider-private-wire', { status: 503 }), new AbortController().signal, matchesReply), /^Error: Wattzun could not complete that request\. Try again\.$/);
});
