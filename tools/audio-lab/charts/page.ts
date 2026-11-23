import { amplitudeDb, chartDocument, escapeHtml } from '../../audio-charts/plot';
import type { LabRun, MetricRow } from '../types';

import { listeningGains, listeningWav } from './levels';
import { comparisonPanels } from './panels';
import { reportStyle } from './style';

type Delta = { value: number; status: 'improved' | 'regressed' | 'neutral' };

export function metricDelta(row: MetricRow): Delta {
  const value = row.after - row.before;
  if (!Number.isFinite(value) || value === 0 || row.higherIsBetter === undefined) return { value, status: 'neutral' };
  return { value, status: (value > 0) === row.higherIsBetter ? 'improved' : 'regressed' };
}

const number = new Intl.NumberFormat('en', { maximumFractionDigits: 3, useGrouping: false });

function format(value: number): string {
  if (!Number.isFinite(value)) return '—';
  return Math.abs(value) > 0 && Math.abs(value) < 0.001 ? value.toExponential(2) : number.format(value);
}

function metrics(rows: MetricRow[]): string {
  const body = rows.map((row) => {
    const { value, status } = metricDelta(row);
    const sign = Number.isFinite(value) && value > 0 ? '+' : '';
    const unit = row.unit ? `<span class="unit">${escapeHtml(row.unit)}</span>` : '';
    const note = row.note ? `<small>${escapeHtml(row.note)}</small>` : '';
    const direction = status === 'improved' ? 'Improved' : 'Worsened';
    const verdict = status === 'neutral' ? '' : `<span class="verdict">${direction}</span>`;
    return `<tr><th scope="row">${escapeHtml(row.label)}${unit}${note}</th>
<td>${format(row.before)}</td><td>${format(row.after)}</td><td class="delta ${status}">${sign}${format(value)}${verdict}</td></tr>`;
  }).join('');
  const table = rows.length > 0 ? `<div class="table-wrap" tabindex="0" role="region" aria-labelledby="metrics-title">
<table><thead><tr><th scope="col">Measurement</th><th scope="col">Before</th><th scope="col">After</th><th scope="col">Δ</th></tr></thead>
<tbody>${body}</tbody></table></div>` : '<p>No measurements were supplied for this run.</p>';
  return `<section class="panel" id="metrics" aria-labelledby="metrics-title"><h2 id="metrics-title">Metrics</h2>
<p class="description">Δ is after minus before. Direction is shown where the metric defines a preferred change.</p>${table}</section>`;
}

function listening(run: LabRun): string {
  const gains = listeningGains(run.input, run.output);
  const players = [run.input, run.output].map((signal, side) => {
    const label = side === 0 ? 'Before' : 'After';
    return `<div class="listen-track ${label.toLowerCase()}"><div class="audio-label">
<strong id="listen-${side}">${label}</strong><span>${amplitudeDb(gains[side]).toFixed(1)} dB gain</span></div>
<audio controls preload="none" aria-labelledby="listen-${side}" src="${listeningWav(signal, gains[side])}"></audio></div>`;
  });
  // Native players retain independent seek controls. Starting one pauses the other.
  return `<section class="panel listen" id="listening" aria-labelledby="listen-title">
<h2 id="listen-title">A/B listening</h2>
<p class="description">Whole-clip RMS matched downward with 1 dB of peak headroom. Silence stays silent. Charts and metrics use the original levels.</p>
<div class="comparison">${players.join('')}</div></section>
<script>
const players = [...document.querySelectorAll('audio')];
for (const player of players) player.addEventListener('play', () => {
  for (const other of players) if (other !== player) other.pause();
});
</script>`;
}

export function renderReport(run: LabRun): string {
  const { input } = run;
  const seconds = input.channels[0].length / input.sampleRate;
  return chartDocument(`Audio lab · ${run.effect} · ${run.material}`, reportStyle, `
<main><header><div class="report-name">Theater Everywhere / Audio lab</div>
<h1>${escapeHtml(run.effect)}</h1>
<p class="run-meta"><strong>${escapeHtml(run.material)}</strong> <span>${seconds.toFixed(2)} s · ${input.sampleRate / 1000} kHz · ${input.channels.length === 1 ? 'Mono' : 'Stereo'}</span></p>
</header>
${comparisonPanels(run)}
${metrics(run.metrics)}
${listening(run)}
</main>`);
}
