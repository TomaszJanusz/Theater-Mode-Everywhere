import assert from 'node:assert/strict';
import { it } from 'node:test';

import { logFraction } from '../../audio-charts/plot';
import { decodeRun, encodeRun } from '../run-json';
import type { LabRun, Signal } from '../types';

import { envelope, listeningGains, tailLevels } from './levels';
import { metricDelta, renderReport } from './page';
import { timeAxis } from './panels';
import { DB_MIN, spectrogram, spectrumColor, spectrumLayout } from './spectrogram';

const signal = (...channels: number[][]): Signal => ({
  sampleRate: 16000,
  channels: channels.map((samples) => Float32Array.from(samples)),
});
const row = { id: 'tail', label: 'Tail level', unit: 'dBFS', before: -18, after: -23 };

it('places frequency octaves at equal intervals and keeps short tail ticks distinct in long runs', () => {
  const firstOctave = logFraction(200, 100, 3200) - logFraction(100, 100, 3200);
  const lastOctave = logFraction(3200, 100, 3200) - logFraction(1600, 100, 3200);
  assert.ok(Math.abs(firstOctave - lastOctave) < 1e-12);
  const timeline = timeAxis(118.5, 120);
  assert.deepEqual(timeline.ticks, [118.5, 118.875, 119.25, 119.625, 120]);
  assert.equal(new Set(timeline.ticks.map(timeline.format!)).size, timeline.ticks.length);
  assert.deepEqual(spectrumColor(DB_MIN - 15), spectrumColor(DB_MIN));
  assert.notDeepEqual(spectrumColor(-40), spectrumColor(-20));
  assert.deepEqual(spectrumColor(3), spectrumColor(0));
});

it('keeps a 6 dB difference and anti-phase stereo in the same spectral bins', () => {
  const tone = Array.from({ length: 3200 }, (_, i) => 0.5 * Math.sin(2 * Math.PI * 1000 * i / 16000));
  const before = signal(tone, tone.map((sample) => -sample));
  const after = signal(tone.map((sample) => sample / 2));
  const layout = spectrumLayout(before);
  const a = spectrogram(before, layout);
  const b = spectrogram(after, layout);
  const peak = Math.max(...a);
  const at = a.indexOf(peak);
  assert.ok(Math.abs(peak - 20 * Math.log10(0.5)) < 0.02);
  assert.ok(Math.abs(peak - b[at] - 6.0206) < 0.02);
  const rowHz = layout.maxHz * (layout.minHz / layout.maxHz) ** ((Math.floor(at / layout.columns) + 0.5) / layout.rows);
  assert.ok(Math.abs(rowHz - 1000) < 45);
});

it('preserves transient extrema and plots tail energy on the absolute timeline', () => {
  const audio = signal([0.1, -0.6, 0, 0.2], [-0.7, 0.4, 0.85, -0.2]);
  const peaks = envelope(audio, 2);
  assert.deepEqual(peaks, [
    { min: Math.fround(-0.7), max: Math.fround(0.4) },
    { min: Math.fround(-0.2), max: Math.fround(0.85) },
  ]);
  const tail = tailLevels(signal([...Array(320).fill(0), ...Array(320).fill(0.1), ...Array(320).fill(0.01)]),
    { start: 0.02, end: 0.06 });
  assert.deepEqual(tail.map(({ time }) => time), [0.03, 0.05]);
  assert.deepEqual(tail.map(({ db }) => Math.round(db)), [-20, -40]);
});

it('matches RMS across uneven waveforms without clipping and keeps silence silent', () => {
  const reference = signal([1, 0, 0, 0], [1, 0, 0, 0]);
  const comparison = signal([0.2, 0.2, 0.2, 0.2]);
  const [before, after] = listeningGains(reference, comparison);
  assert.ok(Math.abs(before * 0.5 - after * Math.fround(0.2)) < 1e-10);
  assert.equal(after, 1);
  assert.deepEqual(listeningGains(signal([0]), reference), [1, 10 ** (-1 / 20)]);
  const [peakGain, matchingGain] = listeningGains(reference, signal([0.8, 0.8]));
  assert.ok(Math.abs(peakGain * 0.5 - matchingGain * Math.fround(0.8)) < 1e-10);
  assert.ok(peakGain <= 10 ** (-1 / 20));
});

it('respects both metric directions and leaves unspecified or unavailable deltas neutral', () => {
  assert.deepEqual(metricDelta({ ...row, higherIsBetter: false }), { value: -5, status: 'improved' });
  assert.deepEqual(metricDelta({ ...row, higherIsBetter: true }), { value: -5, status: 'regressed' });
  assert.equal(metricDelta(row).status, 'neutral');
  assert.equal(metricDelta({ ...row, after: NaN, higherIsBetter: true }).status, 'neutral');
});

it('round-trips portable LabRun JSON and escapes untrusted labels in the standalone HTML', () => {
  const run: LabRun = {
    effect: 'probe <x>',
    material: 'local & "mine"',
    input: signal([0, 0.1, -0.9]),
    output: signal([0, 0.08, -0.8]),
    metrics: [{ ...row, after: NaN, note: 'no measured <tail>' }],
  };
  const encoded = encodeRun(run);
  const decoded = decodeRun(encoded);
  assert.deepEqual(decoded.input, run.input);
  assert.deepEqual(decoded.output, run.output);
  assert.ok(Number.isNaN(decoded.metrics[0].after));
  const html = renderReport(decoded);
  assert.ok(html.includes('probe &lt;x&gt;'));
  assert.ok(html.includes('local &amp; &quot;mine&quot;'));
  assert.ok(html.includes('no measured &lt;tail&gt;'));
  assert.equal(html.match(/data:audio\/wav;base64,/g)?.length, 2);
  assert.equal(html.match(/data:image\/png;base64,/g)?.length, 2);

  for (const input of [
    { sampleRate: 48000, channels: [[0, 0, 0]] },
    { sampleRate: 16000, channels: ['not a channel'] },
    { sampleRate: 16000, channels: [[]] },
  ]) assert.throws(() => decodeRun(JSON.stringify({ ...JSON.parse(encoded), input })));
});
