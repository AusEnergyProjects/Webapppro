import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Original C-major pentatonic phrase: C5 E5 G5 E5 D5 C5.
// Rounded, mostly fundamental chimes rise and settle before a quiet loop gap.
const sampleRate = 22050;
const duration = 4.4;
const notes = [
  [0.06, 523.251, 0.82],
  [0.38, 659.255, 0.90],
  [0.70, 783.991, 0.86],
  [1.08, 659.255, 0.82],
  [1.40, 587.330, 0.76],
  [1.72, 523.251, 0.90],
];

export function incomingRingtoneWav(peak = 0.42) {
  if (!(peak > 0 && peak <= 0.42)) throw new RangeError('Ringtone peak must be between zero and 0.42.');
  const samples = new Float64Array(Math.round(sampleRate * duration));
  const noteDuration = 0.72;
  for (const [start, frequency, strength] of notes) {
    const offset = Math.round(start * sampleRate);
    for (let i = 0; i < Math.round(noteDuration * sampleRate); i++) {
      const age = i / sampleRate;
      // A 65 ms raised-cosine attack and 240 ms release avoid sharp edges.
      const attack = 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, age / 0.065));
      const release = 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, (noteDuration - age) / 0.24));
      const phase = 2 * Math.PI * frequency * age;
      const voice = Math.sin(phase) + 0.14 * Math.exp(-age / 0.25) * Math.sin(phase * 2)
        + 0.025 * Math.exp(-age / 0.16) * Math.sin(phase * 3);
      samples[offset + i] += strength * attack * release * Math.exp(-age / 0.6) * voice;
    }
  }
  let maximum = 0;
  for (const sample of samples) maximum = Math.max(maximum, Math.abs(sample));
  const wav = Buffer.alloc(44 + samples.length * 2);
  wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(sampleRate, 24); wav.writeUInt32LE(sampleRate * 2, 28);
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36);
  wav.writeUInt32LE(samples.length * 2, 40);
  const gain = peak * 32767 / maximum;
  for (let i = 0; i < samples.length; i++) wav.writeInt16LE(Math.round(samples[i] * gain), 44 + i * 2);
  return wav;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // CallKit follows the phone's ring volume; the foreground fallback retains
  // its quieter asset level as well as the existing player volume setting.
  await writeFile(new URL('../modules/tlink-calls/ios/Resources/TLinkIncoming.wav', import.meta.url), incomingRingtoneWav());
  await writeFile(new URL('../assets/sounds/tlink-call-soft.wav', import.meta.url), incomingRingtoneWav(0.165));
}
