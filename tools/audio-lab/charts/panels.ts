import { logFraction } from '../../audio-charts/plot';
import type { LabRun, Signal } from '../types';

import { envelope, TAIL_SECONDS, tailLevels } from './levels';
import { DB_MAX, DB_MIN, SPECTRUM_COLORS, spectrogram, spectrumImage, spectrumLayout, type SpectrumLayout } from './spectrogram';

type Axis = {
  from: number;
  to: number;
  ticks: number[];
  label: string;
  project?: (value: number) => number;
  format?: (value: number) => string;
};
type View = { x: Axis; y: Axis; height: number; width: number };
const LEFT = 54;
const TOP = 10;

const coord = (value: number) => value.toFixed(2);
const compact = new Intl.NumberFormat('en', { maximumSignificantDigits: 3, useGrouping: false });
const label = (value: number) => compact.format(value);
const frequency = (hz: number) => hz >= 1000 ? `${label(hz / 1000)}k` : label(hz);
const ratio = (value: number, axis: Axis) => axis.project?.(value) ?? (value - axis.from) / (axis.to - axis.from);
const xOf = (time: number, view: View) => LEFT + view.width * ratio(time, view.x);
const yOf = (value: number, view: View) => TOP + view.height * (1 - Math.max(0, Math.min(1, ratio(value, view.y))));

/** Both columns share tick positions and endpoints, and never renormalize the before and after data. */
export function timeAxis(start: number, end: number): Axis {
  const interval = (end - start) / 4;
  const order = Math.floor(Math.log10(interval));
  const unit = 10 ** order;
  const factor = [1, 2, 5, 10].find((multiple) => multiple * unit >= interval) ?? 10;
  const step = factor * unit;
  const decimals = Math.max(0, -order - (factor === 10 ? 1 : 0));
  const ticks: number[] = [];
  // The tolerance only compensates for binary arithmetic at a tick boundary.
  for (let tick = Math.ceil(start / step - 1e-9); tick <= end / step + 1e-9; tick++) {
    ticks.push(Number((tick * step).toFixed(decimals)));
  }
  return { from: start, to: end, ticks, label: 'Time (s)', format: (value) => value.toFixed(decimals) };
}

function plot(view: View, description: string, content: string): string {
  const { x, y, width, height } = view;
  const bottom = TOP + height;
  const right = LEFT + width;
  const timeGrid = x.ticks.map((tick) => {
    const cx = coord(xOf(tick, view));
    return `<line class="grid" x1="${cx}" x2="${cx}" y1="${TOP}" y2="${bottom}"/>
<text x="${cx}" y="${bottom + 16}" text-anchor="middle">${x.format?.(tick) ?? label(tick)}</text>`;
  });
  const valueGrid = y.ticks.map((tick) => {
    const cy = coord(yOf(tick, view));
    const text = y.format?.(tick) ?? label(tick);
    return `<line class="grid" x1="${LEFT}" x2="${right}" y1="${cy}" y2="${cy}"/>
<text x="${LEFT - 6}" y="${cy}" dy=".32em" text-anchor="end">${text}</text>`;
  });
  return `<svg class="chart" viewBox="0 0 ${right + 20} ${bottom + 42}" role="img" aria-label="${description}">
<rect class="plot-bg" x="${LEFT}" y="${TOP}" width="${width}" height="${height}"/>
<g>${timeGrid.join('')}${valueGrid.join('')}</g>${content}
<text class="axis" x="${LEFT + width / 2}" y="${bottom + 35}" text-anchor="middle">${x.label}</text>
<text class="axis" transform="translate(14 ${TOP + height / 2}) rotate(-90)" text-anchor="middle">${y.label}</text></svg>`;
}

function heatmap(signal: Signal, layout: SpectrumLayout, view: View): string {
  return `<image href="${spectrumImage(spectrogram(signal, layout), layout)}" x="${LEFT}" y="${TOP}"
    width="${view.width}" height="${view.height}" preserveAspectRatio="none"/>`;
}

function colorScale(): string {
  const gradient = SPECTRUM_COLORS.map((color, i) => `<stop offset="${i / (SPECTRUM_COLORS.length - 1)}" stop-color="${color}"/>`).join('');
  return `<div class="color-scale"><svg viewBox="0 0 380 43" role="img" aria-label="Spectrogram level from −90 to 0 dBFS">
<defs><linearGradient id="spectrum-ramp">${gradient}</linearGradient></defs>
<rect x="21" y="3" width="298" height="10" fill="url(#spectrum-ramp)"/>
<text x="21" y="33" text-anchor="middle">−90</text><text x="120" y="33" text-anchor="middle">−60</text>
<text x="220" y="33" text-anchor="middle">−30</text><text x="319" y="33" text-anchor="middle">0</text>
<text x="337" y="33">dBFS</text></svg></div>`;
}

export function comparisonPanels(run: LabRun): string {
  const { input, output } = run;
  const end = input.channels[0].length / input.sampleRate;
  const fullTime = timeAxis(0, end);
  const layout = spectrumLayout(input);
  const { minHz, maxHz } = layout;
  const frequencyAxis: Axis = {
    from: minHz, to: maxHz, label: 'Frequency (Hz, log)',
    ticks: [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000].filter((hz) => hz >= minHz && hz <= maxHz),
    project: (hz) => logFraction(hz, minHz, maxHz),
    format: frequency,
  };
  const spectrum: View = { x: fullTime, y: frequencyAxis, width: 444, height: 216 };
  const before = plot(spectrum, 'Before spectrogram on a log-frequency axis', heatmap(input, layout, spectrum));
  const after = plot(spectrum, 'After spectrogram on a log-frequency axis', heatmap(output, layout, spectrum));
  return `<section class="panel" id="spectrogram" aria-labelledby="spectrum-title">
<h2 id="spectrum-title">Spectrogram</h2>
<p class="description">Shared −90 to 0 dBFS scale. The brightest areas contain the strongest frequency components.</p>
${pair(before, after)}${colorScale()}</section>
${waveforms(input, output, fullTime)}
${tail(input, output, end)}`;
}

function pair(before: string, after: string): string {
  return `<div class="comparison">
<figure class="before"><figcaption>Before</figcaption>${before}</figure>
<figure class="after"><figcaption>After</figcaption>${after}</figure>
</div>`;
}

function waveforms(input: Signal, output: Signal, x: Axis): string {
  const ranges = [envelope(input, 444), envelope(output, 444)];
  const peak = Math.max(...ranges.flatMap((bins) => bins.flatMap(({ min, max }) => [-min, max])));
  const limit = Math.max(0.05, Math.ceil(peak * 1.1 * 20) / 20);
  const view: View = { x, y: { from: -limit, to: limit, ticks: [-limit, 0, limit], label: 'Amplitude' }, width: 444, height: 106 };
  const [before, after] = ranges.map((bins, side) => {
    const path = bins.map(({ min, max }, index) => {
      const x = coord(LEFT + (index + 0.5) * view.width / bins.length);
      return `M${x} ${coord(yOf(min, view))}V${coord(yOf(max, view))}`;
    }).join('');
    return plot(view, `${side ? 'After' : 'Before'} waveform envelope`, `<path class="envelope" d="${path}"/>`);
  });
  return `<section class="panel" id="waveform" aria-labelledby="waveform-title">
<h2 id="waveform-title">Waveform envelope</h2>
<p class="description">Minimum and maximum sample values across channels. Both plots use the same amplitude scale with at least 10% headroom.</p>
${pair(before, after)}</section>`;
}

function tail(input: Signal, output: Signal, end: number): string {
  const start = Math.max(0, end - TAIL_SECONDS);
  const x = timeAxis(start, end);
  const view: View = {
    x, width: 970, height: 170,
    y: { from: DB_MIN, to: DB_MAX, ticks: [DB_MIN, -60, -30, DB_MAX], label: 'RMS (dBFS)' },
  };
  const lines = [input, output].map((signal, side) => {
    const coords = tailLevels(signal, { start, end }).map(({ time, db }) => `${coord(xOf(time, view))},${coord(yOf(db, view))}`);
    return `<polyline class="trace ${side ? 'after' : 'before'}" points="${coords.join(' ')}"/>`;
  });
  return `<section class="panel" id="reverb-tail" aria-labelledby="tail-title">
<h2 id="tail-title">Reverb tail</h2>
<p class="description">RMS in 20 ms windows over the final ${label(end - start)} s. Use this view where the excerpt ends with a decay.</p>
<div class="trace-key"><span class="before">Before</span><span class="after">After</span></div>
<div class="tail-scroll" tabindex="0" role="region" aria-label="Reverb tail plot">
${plot(view, 'Before and after energy over the closing part of the excerpt', lines.join(''))}</div></section>`;
}
