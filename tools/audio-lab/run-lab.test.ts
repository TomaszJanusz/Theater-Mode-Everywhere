import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';

import { LAB_EFFECTS, latencyOf } from './effects';
import { measure } from './measure';
import { decodeRun, encodeRun } from './run-json';
import { runLab } from './run-lab';
import { syntheticMaterial, syntheticVoice } from './synthetic';
import { formatRun } from './table';
import { noise } from './test-utils/signals';
import type { LabRun } from './types';
import { writeWav } from './wav';

const ids = (run: { metrics: { id: string }[] }) => run.metrics.map(row => row.id);

describe('audio lab: runs', () => {
  const directory = mkdtempSync(join(tmpdir(), 'audio-lab-run-'));
  after(() => rmSync(directory, { recursive: true, force: true }));

  it('lists the echo presets and the audio chain effects', () => {
    const known = LAB_EFFECTS.map(effect => effect.id);
    for (const id of ['echo-light', 'echo-strong', 'voice-light', 'voice-strong', 'bass-less', 'bass-more', 'leveling-light', 'leveling-strong']) assert.ok(known.includes(id), id);
    assert.equal(new Set(known).size, known.length);
  });

  it('runs an effect over a WAV file and returns aligned 48 kHz stereo with mix-only rows', async () => {
    const path = join(directory, 'clip.wav');
    writeWav(path, { sampleRate: 16000, channels: [syntheticVoice(2).filter((_, i) => i % 3 === 0)] });
    const run = await runLab('echo-strong', path);
    assert.equal(run.effect, 'echo-strong');
    assert.equal(run.material, path);
    assert.equal(run.input.sampleRate, 48000);
    assert.equal(run.output.sampleRate, 48000);
    assert.deepEqual(run.output.channels.map(channel => channel.length), [96000, 96000]);
    assert.deepEqual(run.input.channels.map(channel => channel.length), [96000, 96000]);
    assert.deepEqual(ids(run).filter(id => !id.startsWith('band-')), ['voice-level-mix', 'word-ending-level-mix', 'level-movement-mix', 'tail-level-mix', 'srmr', 'loudness']);
    const voice = run.metrics[0];
    assert.ok(voice.after < voice.before - 1 && voice.after > voice.before - 6, `${voice.before} to ${voice.after}`);
    assert.equal(voice.label, 'Level while speaking (whole mix)');
    assert.match(voice.note ?? '', /Measured on the whole mix/);
    // What comes back is what the report tool reads.
    const decoded = decodeRun(encodeRun(run));
    assert.deepEqual(decoded.output.channels[1], run.output.channels[1]);
    assert.deepEqual(ids(decoded), ids(run));
  });

  it('measures voice and room separately at every reference point when the room is known', async () => {
    const material = syntheticMaterial('synthetic-wall', 3);
    const strong = LAB_EFFECTS.find(effect => effect.id === 'echo-strong')!;
    const rows = measure(material, await strong.run(material.mix));
    const run = { metrics: rows };
    assert.equal(new Set(ids(run)).size, rows.length, 'row ids are unique');
    for (const key of ['direct', '10ms', '20ms', '50ms']) {
      for (const metric of ['voice-level', 'word-ending-level', 'level-movement', 'room-level', 'estoi']) assert.ok(ids(run).includes(`${metric}-${key}`), `${metric}-${key}`);
    }
    assert.equal(ids(run).filter(id => id.startsWith('tail-level')).join(), 'tail-level');
    assert.ok(rows.every(row => Number.isFinite(row.before) && Number.isFinite(row.after)), 'every row has a value');
    const row = (id: string) => rows.find(candidate => candidate.id === id)!;
    assert.match(row('voice-level-50ms').note ?? '', /91 % of this room's reflected energy/);
    // The later the reference point, the more of the room counts as voice and the less as room.
    assert.ok(row('voice-level-50ms').before > row('voice-level-direct').before + 3);
    assert.ok(row('room-level-50ms').before < row('room-level-direct').before - 3);
    assert.equal(row('level-movement-direct').before, 0);
    assert.ok(row('tail-level').after < row('tail-level').before - 8);
    assert.equal(row('tail-level').higherIsBetter, false);
    // The tail is the late reverb: before the effect it is the room's sound behind the 50 ms cut, heard in the pauses.
    assert.match(row('tail-level').label, /^Late reverb in pause tails \(after the first 50 ms/);
    assert.ok(row('tail-level').before < row('room-level-50ms').before);
    assert.equal(row('estoi-50ms').unit, '');
    assert.equal(row('word-ending-level-direct').label, 'Speech in the last 60 ms before a pause (direct sound)');
    assert.equal(row('voice-level-direct').higherIsBetter, true);
  });

  it('measures a dry voice as the voice, with no room rows', async () => {
    const material = syntheticMaterial('synthetic-dry', 3);
    const light = LAB_EFFECTS.find(effect => effect.id === 'echo-light')!;
    const rows = measure(material, await light.run(material.mix));
    assert.deepEqual(ids({ metrics: rows }).filter(id => !id.startsWith('band-')), ['voice-level-direct', 'word-ending-level-direct', 'level-movement-direct', 'estoi-direct', 'srmr', 'loudness']);
    assert.ok(Math.abs(rows.find(row => row.id === 'estoi-direct')!.before - 1) < 1e-9, 'an untouched dry voice is fully intelligible');
  });

  it('judges a clip with sound on one side only by that side', async () => {
    const voice = syntheticVoice(2);
    const material = { id: 'right-only', label: 'right-only', mix: { sampleRate: 48000, channels: [new Float32Array(voice.length), voice] } };
    const strong = LAB_EFFECTS.find(effect => effect.id === 'echo-strong')!;
    const rows = measure(material, await strong.run(material.mix));
    const srmr = rows.find(row => row.id === 'srmr')!;
    assert.ok(Number.isFinite(srmr.before) && Number.isFinite(srmr.after), `SRMR ${srmr.before} to ${srmr.after}`);
    const both = measure({ ...material, mix: { sampleRate: 48000, channels: [voice, voice] } }, await strong.run({ sampleRate: 48000, channels: [voice, voice] }));
    assert.ok(Math.abs(both.find(row => row.id === 'srmr')!.before - srmr.before) < 1e-9, 'the silent side does not change the score');
  });

  it('rejects an effect it does not know and names the ones it does', async () => {
    await assert.rejects(runLab('echo-extreme', 'synthetic-dry'), /Unknown effect 'echo-extreme'.*echo-light, echo-strong/);
    await assert.rejects(runLab('echo-light', 'no-such-material'), /Unknown material 'no-such-material'/);
  });

  it('finds the delay of an effect so its output can be aligned', () => {
    const next = noise(3);
    const input = Float32Array.from({ length: 20000 }, next);
    const delayed = new Float32Array(21000);
    delayed.set(input.map(value => 0.5 * value), 288);
    assert.equal(latencyOf([input], [delayed], 960), 288);
    assert.equal(latencyOf([input], [input], 960), 0);
    // Sound on the right only: the silent left channel must not vote for "no delay".
    const silent = new Float32Array(21000);
    assert.equal(latencyOf([silent.subarray(0, 20000), input], [silent, delayed], 960), 288);
  });

  it('prints one line per metric with its change, and each note once', () => {
    const signal = { sampleRate: 48000, channels: [new Float32Array(24000), new Float32Array(24000)] };
    const run: LabRun = {
      effect: 'echo-light', material: 'clip', input: signal, output: signal,
      metrics: [
        { id: 'a', label: 'Voice level', unit: 'dBFS', before: -20, after: -21.5, note: 'shared note' },
        { id: 'b', label: 'ESTOI', unit: '0 to 1', before: 0.5, after: 0.5321 },
        { id: 'c', label: 'Tail', unit: 'dBFS', before: Number.NaN, after: -40, note: 'shared note' }
      ]
    };
    const text = formatRun(run);
    assert.match(text, /^echo-light on clip \(0\.5 s at 48000 Hz\)$/m);
    assert.match(text, /^Voice level\s+-20\.00\s+-21\.50\s+-1\.500\s+dBFS$/m);
    assert.match(text, /^ESTOI\s+0\.500\s+0\.532\s+\+0\.032\s+0 to 1$/m);
    assert.match(text, /^Tail\s+n\/a\s+-40\.00\s+n\/a\s+dBFS$/m);
    assert.equal(text.match(/shared note/g)?.length, 2, 'a note is printed with each metric it belongs to');
  });
});
