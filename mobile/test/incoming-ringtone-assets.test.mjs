import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { incomingRingtoneWav } from '../scripts/generate-incoming-ringtone.mjs';

const files = [
  ['CallKit', '../modules/tlink-calls/ios/Resources/TLinkIncoming.wav', 0.42],
  ['foreground', '../assets/sounds/tlink-call-soft.wav', 0.165],
];

function readAudio(path) {
  const wav = readFileSync(new URL(path, import.meta.url));
  const rate = wav.readUInt32LE(24);
  const samples = Array.from({ length: (wav.length - 44) / 2 }, (_, i) => wav.readInt16LE(44 + i * 2));
  return { wav, rate, samples };
}

function rms(samples) {
  return Math.sqrt(samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length);
}

function spectralPower(samples, rate, start, frequency) {
  const count = Math.round(0.12 * rate), offset = Math.round(start * rate);
  let real = 0, imaginary = 0;
  for (let i = 0; i < count; i++) {
    const window = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (count - 1));
    const sample = samples[offset + i] * window;
    const phase = 2 * Math.PI * frequency * i / rate;
    real += sample * Math.cos(phase); imaginary += sample * Math.sin(phase);
  }
  return real * real + imaginary * imaginary;
}

for (const [name, path, level] of files) {
  test(`${name} incoming melody is reproducible, compact and valid mono PCM`, () => {
    const { wav, rate, samples } = readAudio(path);
    assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
    assert.equal(wav.toString('ascii', 8, 16), 'WAVEfmt ');
    assert.equal(wav.readUInt32LE(4), wav.length - 8);
    assert.equal(wav.readUInt16LE(20), 1);
    assert.equal(wav.readUInt16LE(22), 1);
    assert.equal(rate, 22050);
    assert.equal(wav.readUInt16LE(34), 16);
    assert.equal(wav.toString('ascii', 36, 40), 'data');
    assert.equal(wav.readUInt32LE(40), wav.length - 44);
    assert.ok(samples.length / rate >= 4 && samples.length / rate < 5);
    assert.ok(wav.length < 200000);
    assert.deepEqual(wav, incomingRingtoneWav(level), 'Checked-in audio must match its original deterministic generator');
  });

  test(`${name} melody has gentle edges, audible headroom and a quiet repeat gap`, () => {
    const { rate, samples } = readAudio(path);
    const peak = samples.reduce((maximum, sample) => Math.max(maximum, Math.abs(sample)), 0);
    const normalizedRms = rms(samples) / level;
    assert.ok(peak < 14000 && peak > 5000, 'Comfortable level without hard limiting or clipping');
    assert.ok(normalizedRms > 8000 && normalizedRms < 10000, 'Keep the melody audible without returning to the loud pulse');
    assert.ok(samples.filter(sample => sample === 0).length / samples.length > 0.44);
    assert.ok(samples.slice(-Math.round(rate * 1.9)).every(sample => sample === 0), 'Long quiet gap between repeated phrases');
    assert.ok(samples.slice(0, Math.round(rate * 0.06)).every(sample => sample === 0));
    assert.equal(samples[0], 0); assert.equal(samples.at(-1), 0);
    const initialAttack = rms(samples.slice(Math.round(rate * 0.06), Math.round(rate * 0.07)));
    const settledNote = rms(samples.slice(Math.round(rate * 0.13), Math.round(rate * 0.14)));
    assert.ok(initialAttack < settledNote * 0.12, 'First note fades in instead of starting at full amplitude');
    assert.ok(rms(samples.slice(Math.round(rate * 2.43), Math.round(rate * 2.44))) < peak * 0.002, 'Last note fades to silence before the repeat gap');
    for (let i = 1; i < samples.length; i++) assert.ok(Math.abs(samples[i] - samples[i - 1]) < level * 8500, 'No abrupt sample discontinuities');
  });

  test(`${name} phrase rises and falls through distinct consonant musical notes`, () => {
    const { rate, samples } = readAudio(path);
    const pitches = [523.251, 587.330, 659.255, 783.991];
    const phrase = [[0.20, 0], [0.52, 2], [0.84, 3], [1.22, 2], [1.54, 1], [1.86, 0]];
    for (const [time, expected] of phrase) {
      const powers = pitches.map(frequency => spectralPower(samples, rate, time, frequency));
      assert.ok(powers[expected] > Math.max(...powers.filter((_, index) => index !== expected)) * 2,
        `Expected a distinct melodic note near ${pitches[expected]} Hz at ${time} seconds`);
    }
    const fundamental = spectralPower(samples, rate, 0.20, pitches[0]);
    assert.ok(spectralPower(samples, rate, 0.20, pitches[0] * 2) < fundamental * 0.04, 'Soft timbre remains dominated by the fundamental');
  });
}
