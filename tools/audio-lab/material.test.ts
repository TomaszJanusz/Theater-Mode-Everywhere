import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';

import { loadMaterial } from './load-material';
import { SYNTHETIC_IDS, syntheticMaterial, syntheticVoice } from './synthetic';
import { noise } from './test-utils/signals';
import type { Signal } from './types';
import { writeWav } from './wav';

const energy = (samples: Float32Array) => samples.reduce((sum, value) => sum + value * value, 0);
const errorDb = (test: Float32Array, reference: Float32Array) => 10 * Math.log10(energy(test.map((value, i) => value - reference[i])) / energy(reference));

describe('audio lab: material', () => {
  const directory = mkdtempSync(join(tmpdir(), 'audio-lab-material-'));
  after(() => rmSync(directory, { recursive: true, force: true }));

  // A corpus as the lab expects it: 16 kHz files, a room built from a dry voice and an impulse response.
  const rate = 16000;
  const dry = syntheticVoice(2).filter((_, i) => i % 3 === 0);
  const response = new Float32Array(1600);
  response[40] = 0.8;
  response[40 + 0.015 * rate] = 0.4;
  response[40 + 0.08 * rate] = -0.3;
  const next = noise(12);
  // Unrelated to the voice: a tone between its harmonics, and noise.
  const music = Float32Array.from(dry, (_, i) => 0.05 * Math.sin(2 * Math.PI * 1234.5 * i / rate) + 0.01 * next());
  const mono = (samples: Float32Array): Signal => ({ sampleRate: rate, channels: [samples] });
  writeWav(join(directory, 'dry.wav'), mono(dry));
  writeWav(join(directory, 'ir.wav'), mono(response));
  writeWav(join(directory, 'music-mix.wav'), { sampleRate: rate, channels: [dry.map((value, i) => 0.5 * value + music[i]), dry.map((value, i) => 0.25 * value - music[i])] });
  writeFileSync(join(directory, 'manifest.json'), JSON.stringify({
    entries: [
      { id: 'dry', kind: 'speech', file: 'dry.wav', sha256: 'ignored' },
      { id: 'plain', kind: 'mix', file: 'dry.wav' },
      { id: 'ir', file: 'ir.wav' },
      { id: 'room', file: 'room.wav', dry: 'dry', impulseResponse: 'ir' },
      { id: 'over-music', file: 'music-mix.wav', dry: 'dry' },
      { id: 'fetched', cache: true },
      { id: 'broken', file: 'dry.wav', dry: 'missing' }
    ]
  }));

  it('builds the built-in rooms the same way every time, parts adding up to the mix', () => {
    assert.deepEqual(SYNTHETIC_IDS, ['synthetic-dry', 'synthetic-wall', 'synthetic-room-0.3s', 'synthetic-room-0.8s', 'synthetic-room-1.5s']);
    const first = syntheticMaterial('synthetic-room-0.3s', 2);
    const second = syntheticMaterial('synthetic-room-0.3s', 2);
    assert.deepEqual(first.mix.channels[1], second.mix.channels[1]);
    assert.ok(first.room && first.dry);
    assert.equal(first.room.parts.length, 5);
    for (const channel of [0, 1]) {
      const sum = new Float32Array(first.mix.channels[channel].length);
      for (const part of first.room.parts) part.channels[channel].forEach((value, i) => { sum[i] += value; });
      assert.ok(errorDb(sum, first.mix.channels[channel]) < -100);
    }
    const peak = first.mix.channels.reduce((max, channel) => channel.reduce((m, value) => Math.max(m, Math.abs(value)), max), 0);
    assert.ok(Math.abs(peak - 0.5) < 1e-6);
    assert.notDeepEqual(first.mix.channels[0], first.mix.channels[1], 'the two ears hear different reflections');
    assert.throws(() => syntheticMaterial('synthetic-cathedral'), /Unknown synthetic material/);
  });

  it('brings a manifest clip to 48 kHz stereo', () => {
    const material = loadMaterial('plain', directory);
    assert.equal(material.mix.sampleRate, 48000);
    assert.equal(material.mix.channels.length, 2);
    assert.equal(material.mix.channels[0].length, dry.length * 3);
    assert.deepEqual(material.mix.channels[0], material.mix.channels[1]);
    assert.equal(material.room, undefined);
    assert.equal(material.voice, undefined);
    // A clip of kind "speech" is its own dry voice, so it gets voice rows instead of mix rows.
    const speech = loadMaterial('dry', directory);
    assert.ok(speech.dry && speech.voice);
    assert.ok(errorDb(speech.voice.channels[0], speech.mix.channels[0]) < -100);
  });

  it('rebuilds a room from its dry voice and impulse response, cut at the reference points', () => {
    const { mix, room, dry: voice } = loadMaterial('room', directory);
    assert.ok(room && voice);
    assert.equal(voice.length, dry.length * 3);
    assert.equal(mix.channels[0].length, voice.length);
    // The response's own delay is removed: the direct sound is the dry voice itself, scaled, about 1 ms in (the kept rise).
    const whole = room.parts[0].channels[0];
    const errors = [47, 48, 49, 50].map(delay => {
      const direct = whole.subarray(delay);
      const gain = direct.reduce((sum, value, i) => sum + value * voice[i], 0) / energy(voice);
      return errorDb(direct.map(value => value / gain), voice.subarray(0, direct.length));
    });
    assert.ok(Math.min(...errors) < -30, `direct sound is the dry voice (${errors.map(error => error.toFixed(0)).join(', ')} dB)`);
    const direct = whole;
    assert.ok(energy(room.parts[1].channels[0]) < 1e-6 * energy(direct), 'nothing arrives in the first 10 ms');
    assert.ok(Math.abs(energy(room.parts[2].channels[0]) / energy(direct) - 0.25) < 0.02, 'the 15 ms reflection is 12 dB down');
    assert.ok(Math.abs(room.shares['20ms'] - 0.16 / 0.25) < 0.02 && room.shares['50ms'] === room.shares['20ms']);
  });

  it('finds the dry voice in a mix with other sound, at the gain it has in each channel', () => {
    const { mix, voice, dry: reference, room } = loadMaterial('over-music', directory);
    assert.ok(voice && reference && !room);
    const fitted = (channel: number) => voice.channels[channel].reduce((sum, value, i) => sum + value * reference[i], 0) / energy(reference);
    assert.ok(Math.abs(fitted(0) - 0.5) < 0.01 && Math.abs(fitted(1) - 0.25) < 0.01, `${fitted(0)}, ${fitted(1)}`);
    assert.equal(mix.channels[0].length, reference.length);
  });

  it('reads a WAV path, and says what it looked for when the material is unknown', () => {
    const path = join(directory, 'dry.wav');
    const material = loadMaterial(path, directory);
    assert.equal(material.label, 'dry.wav');
    assert.equal(material.mix.channels[0].length, dry.length * 3);
    assert.throws(() => loadMaterial('no-such-clip', directory), /Unknown material 'no-such-clip'.*synthetic-dry.*over-music/s);
    assert.throws(() => loadMaterial('broken', directory), /refers to 'missing'/);
    assert.throws(() => loadMaterial('fetched', directory), /Material 'fetched' has no audio at .*theater-everywhere.audio-lab.fetched\.wav/);
  });
});
