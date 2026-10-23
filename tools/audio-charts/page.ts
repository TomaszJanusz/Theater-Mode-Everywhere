import type { Panel } from './spectra';

const W = 720, H = 340;
const M = { l: 52, r: 16, t: 14, b: 40 };
const F_MIN = 20, F_MAX = 20000, DB_MIN = -90, DB_MAX = 0;
export const DIALOGUE_BAND: [number, number] = [300, 3400];
export const MARKERS = [{ hz: 80, label: '80 Hz bass' }, { hz: 440, label: '440' }, { hz: 880, label: '880' }];

const x = (hz: number) => M.l + (Math.log10(hz / F_MIN) / Math.log10(F_MAX / F_MIN)) * (W - M.l - M.r);
const y = (level: number) => M.t + ((DB_MAX - Math.max(level, DB_MIN)) / (DB_MAX - DB_MIN)) * (H - M.t - M.b);
const n = (value: number) => value.toFixed(1);
const escape = (text: string) => text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

function axes(): string {
  const grid: string[] = [];
  for (let level = DB_MIN; level <= DB_MAX; level += 10) {
    grid.push(`<line class="grid" x1="${M.l}" x2="${W - M.r}" y1="${n(y(level))}" y2="${n(y(level))}"/><text class="tick" x="${M.l - 6}" y="${n(y(level) + 4)}" text-anchor="end">${level}</text>`);
  }
  for (const hz of [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000]) {
    grid.push(`<line class="grid" x1="${n(x(hz))}" x2="${n(x(hz))}" y1="${M.t}" y2="${H - M.b}"/><text class="tick" x="${n(x(hz))}" y="${H - M.b + 16}" text-anchor="middle">${hz >= 1000 ? (hz / 1000) + 'k' : hz}</text>`);
  }
  return grid.join('')
    + `<text class="axis" x="${(M.l + W - M.r) / 2}" y="${H - 6}" text-anchor="middle">Frequency (Hz, log)</text>`
    + `<text class="axis" transform="translate(12 ${(M.t + H - M.b) / 2}) rotate(-90)" text-anchor="middle">Level (dBFS)</text>`;
}

function reference(): string {
  const [lo, hi] = DIALOGUE_BAND;
  const band = `<rect class="dialogue" x="${n(x(lo))}" y="${M.t}" width="${n(x(hi) - x(lo))}" height="${H - M.t - M.b}"/><text class="note" x="${n((x(lo) + x(hi)) / 2)}" y="${M.t + 12}" text-anchor="middle">dialogue ${lo}–${hi} Hz</text>`;
  const markers = MARKERS.map(({ hz, label }) => `<line class="marker" x1="${n(x(hz))}" x2="${n(x(hz))}" y1="${M.t}" y2="${H - M.b}"/><text class="note" x="${n(x(hz) + 3)}" y="${H - M.b - 5}">${label}</text>`);
  return band + markers.join('');
}

const signed = (value: number) => `${value >= 0 ? '+' : '−'}${Math.abs(value).toFixed(1)}`;

function table(panel: Panel): string {
  const head = `<tr><th>Tone</th><th>Without</th>${panel.variants.map((v) => '<th>' + escape(v) + '</th>').join('')}</tr>`;
  const rows = panel.points.map((p) => `<tr><td>${p.hz} Hz</td><td>${n(p.before)} dB</td>${panel.variants.map((v) => '<td>' + n(p.after[v]) + ' dB (' + signed(p.after[v] - p.before) + ')</td>').join('')}</tr>`);
  return `<table>${head}${rows.join('')}</table>`;
}

/** A line spectrum: one stem per tone, grey without the effect and a colour per variant with it. */
function chart(panel: Panel): string {
  const series = ['before', ...panel.variants];
  const step = 7;
  const stems = panel.points.flatMap((point) => series.map((name, index) => {
    const level = name === 'before' ? point.before : point.after[name];
    const cx = x(point.hz) + (index - (series.length - 1) / 2) * step;
    return `<g class="s${index}"><line class="stem" x1="${n(cx)}" x2="${n(cx)}" y1="${n(y(DB_MIN))}" y2="${n(y(level))}"/><circle cx="${n(cx)}" cy="${n(y(level))}" r="3.5"/></g>`;
  }));
  const legend = series.map((name, index) => `<span class="key s${index}"><i></i>${name === 'before' ? 'without effect' : escape(name)}</span>`).join('');
  const described = panel.points.map((p) => {
    const after = panel.variants.map((v) => n(p.after[v]) + ' dB ' + v).join(', ');
    return `${p.hz} Hz ${n(p.before)} dB without, ${after}`;
  });
  const label = `${panel.title}: ${described.join('; ')}`;
  return `<figure id="${panel.id}"><figcaption><h2>${escape(panel.title)}</h2><p>${escape(panel.caption)}</p></figcaption>
<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${escape(label)}"><title>${escape(panel.title)} (${panel.signal})</title>${axes()}${reference()}${stems.join('')}</svg>
<div class="legend">${legend}<span class="signal">${panel.signal}</span></div>${table(panel)}</figure>`;
}

const STYLE = `
:root{color-scheme:light dark;--bg:#fff;--fg:#1b1f24;--muted:#57606a;--grid:#d8dee4;--band:#0969da18;--marker:#8250df;--s0:#6e7781;--s1:#0969da;--s2:#bc4c00;--s3:#1a7f37;--s4:#cf222e}
@media (prefers-color-scheme:dark){:root{--bg:#0d1117;--fg:#e6edf3;--muted:#9da7b3;--grid:#30363d;--band:#58a6ff22;--marker:#d2a8ff;--s0:#8b949e;--s1:#58a6ff;--s2:#ffa657;--s3:#56d364;--s4:#ff7b72}}
body{margin:0;padding:24px;background:var(--bg);color:var(--fg);font:14px/1.45 system-ui,sans-serif}
main{max-width:760px;margin:auto}h1{font-size:20px}h2{font-size:16px;margin:0}figure{margin:28px 0}figcaption p{margin:2px 0 8px;color:var(--muted)}
svg{width:100%;height:auto}.grid{stroke:var(--grid);stroke-width:1}.tick,.axis,.note{fill:var(--muted);font-size:11px}.axis{font-size:12px}
table{border-collapse:collapse;margin-top:8px;font-size:12px;font-variant-numeric:tabular-nums}th,td{padding:2px 12px 2px 0;text-align:left;border-bottom:1px solid var(--grid)}.dialogue{fill:var(--band)}.marker{stroke:var(--marker);stroke-width:1;stroke-dasharray:4 3}.note{fill:var(--marker)}
.stem{stroke:currentColor;stroke-width:2}.s0{color:var(--s0);fill:var(--s0)}.s1{color:var(--s1);fill:var(--s1)}.s2{color:var(--s2);fill:var(--s2)}.s3{color:var(--s3);fill:var(--s3)}.s4{color:var(--s4);fill:var(--s4)}
.legend{display:flex;gap:16px;flex-wrap:wrap;color:var(--muted)}.key i{display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:6px;background:currentColor}.signal{margin-left:auto}`;

export function renderPage(panels: Panel[]): string {
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Audio effects: spectrum before and after</title><style>${STYLE}</style>
<main><h1>Audio effects: spectrum before and after</h1><p>Test tones rendered offline through the real audio chain (<code>createAudioChain</code>). Same scale for every chart: ${F_MIN}–${F_MAX} Hz, ${DB_MIN}…${DB_MAX} dBFS per tone.</p>${panels.map(chart).join('')}</main></html>\n`;
}
