import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const source = fs.readFileSync(new URL('../src/lib/native-system-calls.ts', import.meta.url), 'utf8');
function load(native) {
  const record = { exports: {} };
  const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  new Function('require', 'module', 'exports', code)(id => {
    assert.equal(id, 'expo'); return { requireOptionalNativeModule: () => native };
  }, record, record.exports);
  return record.exports;
}
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const event = (type, overrides = {}) => ({ id: 'event', type, callId: 'f1346c80-a1af-4ef5-901e-5bf21a068a11', threadId: 'thread-123456', mode: 'audio', expiresAt: new Date(Date.now() + 60_000).toISOString(), ...overrides });

test('older binaries do not claim native call capability', async () => {
  const bridge = load(null);
  assert.equal(bridge.nativeSystemCallsAvailable, false);
  assert.deepEqual(await bridge.getNativeCallRegistration(), { voipPushToken: '', nativeCallCapable: false });
});
test('token refresh reads registration without reconfiguring PushKit', async () => {
  const configured = [];
  const bridge = load({ configure: async (...value) => configured.push(value), registration: async () => ({ voipPushToken: 'synthetic', nativeCallCapable: true }) });
  await bridge.getNativeCallRegistration(); await bridge.getNativeCallRegistration(false); await bridge.disableNativeCalls(true); await bridge.disableNativeCalls();
  assert.deepEqual(configured, [[true, false], [false, true], [false, false]]);
});
test('cold-start answer is suppressed when a terminal event is already queued', async () => {
  const seen = [];
  const bridge = load({ addListener: () => ({ remove() {} }), drainEvents: async () => [event('incoming'), event('answer'), event('end')] });
  const remove = bridge.subscribeSystemCalls(async value => seen.push(value.type));
  await flush(); assert.deepEqual(seen, ['end']); remove();
});
test('End interrupts a pending authenticated Answer instead of waiting for permission completion', async () => {
  let listener, resolve;
  const queue = [event('answer')], seen = [];
  const bridge = load({ addListener: (_name, callback) => { listener = callback; return { remove() {} }; }, drainEvents: async () => queue.splice(0) });
  const remove = bridge.subscribeSystemCalls(async value => { seen.push(value.type); if (value.type === 'answer') await new Promise(done => { resolve = done; }); });
  await flush(); queue.push(event('end')); listener(); await flush(); assert.deepEqual(seen, ['answer', 'end']);
  resolve(); await flush(); assert.deepEqual(seen, ['answer', 'end']); remove();
});
test('expired or malformed native invitations cannot be answered', () => {
  const bridge = load(null);
  assert.equal(bridge.currentSystemCall(event('answer')), true);
  assert.equal(bridge.currentSystemCall(event('answer', { expiresAt: '2000-01-01T00:00:00.000Z' })), false);
  assert.equal(bridge.currentSystemCall(event('answer', { callId: 'invalid' })), false);
  assert.equal(bridge.currentSystemCall(event('answer', { mode: 'screen' })), false);
});

test('an accepted Answer keeps bounded connection grace without extending an unanswered invitation', () => {
  const bridge = load(null);
  const began = Date.parse('2026-09-30T00:00:00.000Z');
  const incoming = event('incoming', { expiresAt: new Date(began + 45_000).toISOString() });
  // Native accepted Answer at44 seconds and allows45 seconds for JS/RTC setup.
  const answer = event('answer', { expiresAt: new Date(began + 44_000 + 45_000).toISOString() });
  assert.equal(bridge.currentSystemCall(incoming, began + 46_000), false);
  assert.equal(bridge.currentSystemCall(answer, began + 46_000), true);
  assert.equal(bridge.currentSystemCall(answer, began + 89_000), false);
});

test('authenticated connecting is separate from media connected and tolerates earlier native modules', async () => {
  const seen = [], id = event('answer').callId;
  const bridge = load({ connecting: async value => seen.push(['connecting', value]), connected: async value => seen.push(['connected', value]) });
  await bridge.markSystemCallConnecting(id);
  assert.deepEqual(seen, [['connecting', id]]);
  await bridge.connectSystemCall(id);
  assert.deepEqual(seen, [['connecting', id], ['connected', id]]);
  await load({}).markSystemCallConnecting(id);
  await load(null).markSystemCallConnecting(id);
});

test('native call sound resources are packaged, audible PCM with quiet gaps and no clipped samples', () => {
  const root = new URL('../modules/tlink-calls/ios/', import.meta.url);
  const podspec = fs.readFileSync(new URL('TLinkCalls.podspec', root), 'utf8');
  assert.match(podspec, /s\.resources = 'Resources\/\*\.wav'/);
  const swift = fs.readFileSync(new URL('TLinkCallsModule.swift', root), 'utf8');
  assert.match(swift, /configuration\.ringtoneSound = "TLinkIncoming\.wav"/);
  assert.match(swift, /forResource: "TLinkRingback", withExtension: "wav"/);
  for (const name of ['TLinkIncoming.wav', 'TLinkRingback.wav']) {
    const wav = fs.readFileSync(new URL(`Resources/${name}`, root));
    assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
    assert.equal(wav.toString('ascii', 8, 12), 'WAVE');
    assert.equal(wav.readUInt16LE(20), 1, 'uncompressed PCM');
    assert.equal(wav.readUInt16LE(22), 1, 'mono');
    assert.equal(wav.readUInt16LE(34), 16);
    assert.equal(wav.readUInt32LE(40), wav.length - 44);
    const frames = (wav.length - 44) / 2;
    const duration = frames / wav.readUInt32LE(24);
    assert.ok(duration >= 2 && duration < 30, 'CallKit ringtone stays below 30 seconds');
    let energy = 0, silent = 0, peak = 0;
    for (let i = 0; i < frames; i++) {
      const sample = wav.readInt16LE(44 + i * 2);
      energy += sample * sample;
      peak = Math.max(peak, Math.abs(sample));
      if (sample === 0) silent++;
    }
    assert.ok(Math.sqrt(energy / frames) > 3000, 'tone is audible');
    assert.ok(peak < 32767, 'no clipping');
    assert.ok(silent / frames > .4, 'recognisable ringing cadence, not a continuous alarm');
  }
});
