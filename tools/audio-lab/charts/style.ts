export const reportStyle = `
:root {
  color-scheme: light dark;
  --paper: #f0eee7;
  --panel: #fbf9f2;
  --ink: #191f29;
  --muted: #545e6c;
  --rule: #c2c2b8;
  --grid: #d7d8cf;
  --plot: #f5f3ec;
  --before: #354a68;
  --after: #9c431a;
  --positive: #176242;
  --negative: #9a3040;
}
@media (prefers-color-scheme: dark) {
  :root {
    --paper: #151a24;
    --panel: #1c2330;
    --ink: #f4eee3;
    --muted: #bcc5d5;
    --rule: #546171;
    --grid: #3b4859;
    --plot: #171d28;
    --before: #a8c8ee;
    --after: #ffac76;
    --positive: #91ddad;
    --negative: #ffb1ba;
  }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--paper); color: var(--ink); font: 1rem/1.5 Georgia, serif; }
main { width: min(1140px, calc(100% - 32px)); margin: 22px auto 48px; }
header { border-block-start: 4px solid var(--ink); padding: 22px 2px 20px; }
.report-name, .run-meta, figcaption, .trace-key, .audio-label, table, svg {
  font-family: "DejaVu Sans Mono", "Courier New", monospace;
}
.report-name { color: var(--muted); font-size: .78rem; text-transform: uppercase; letter-spacing: .09em; }
h1, h2, p, figure { margin: 0; }
h1 { font-size: clamp(2.3rem, 6vw, 4rem); line-height: 1.05; font-weight: 500; margin-block: 9px 10px; overflow-wrap: anywhere; }
h2 { font-size: 1.5rem; line-height: 1.2; font-weight: 500; }
.run-meta { color: var(--muted); font-size: .83rem; display: flex; flex-wrap: wrap; gap: 4px 18px; overflow-wrap: anywhere; }
.run-meta strong { color: var(--before); }
.panel { background: var(--panel); border: 1px solid var(--rule); margin-block-end: 13px; padding: clamp(12px, 2vw, 22px); }
.description { color: var(--muted); margin-block: 5px 14px; }
.comparison { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
figcaption, .audio-label { font-size: .82rem; font-weight: 700; color: var(--series); }
figcaption { border-block-start: 2px solid var(--series); padding-block-start: 6px; }
.before { --series: var(--before); }
.after { --series: var(--after); }
.chart, .color-scale svg { display: block; width: 100%; height: auto; }
svg text { fill: var(--muted); font-size: 12px; }
svg .axis { fill: var(--ink); }
.plot-bg { fill: var(--plot); }
.grid { stroke: var(--grid); stroke-width: 1; }
.envelope { fill: none; stroke: var(--series); stroke-width: 1.4; stroke-linecap: round; }
.trace { fill: none; stroke: var(--series); stroke-width: 2.5; stroke-linejoin: round; }
.trace.before { stroke-dasharray: 6 4; }
.color-scale { width: min(100%, 380px); margin: 0 auto; }
.trace-key { display: flex; flex-wrap: wrap; gap: 12px 20px; margin: 4px 0 8px 54px; font-size: .8rem; }
.trace-key span { display: inline-flex; align-items: center; gap: 7px; color: var(--series); }
.trace-key span::before { content: ""; width: 26px; border-block-start: 2px solid currentColor; }
.trace-key .before::before { border-block-start-style: dashed; }
.table-wrap, .tail-scroll { overflow-x: auto; }
.table-wrap:focus-visible, .tail-scroll:focus-visible { outline: 2px solid var(--before); outline-offset: 2px; }
table { width: 100%; border-collapse: collapse; font-size: .83rem; }
th, td { padding: 9px 12px; border-block-end: 1px solid var(--grid); }
thead th { background: var(--plot); color: var(--muted); }
th:first-child { text-align: left; }
th, td { text-align: right; }
td { white-space: nowrap; }
th small, .unit { color: var(--muted); font-weight: 400; }
th small { display: block; max-width: 70ch; }
.unit { padding-inline-start: 9px; }
.verdict { display: block; font-size: .72rem; }
.improved { color: var(--positive); }
.regressed { color: var(--negative); }
.listen-track { min-width: 0; border-block-start: 2px solid var(--series); padding-block-start: 6px; }
.audio-label { display: flex; justify-content: space-between; align-items: baseline; gap: 6px; }
.audio-label span { color: var(--muted); font-weight: 400; }
audio { display: block; width: 100%; margin-block-start: 8px; }
@media (max-width: 660px) {
  main { width: calc(100% - 20px); }
  .comparison { grid-template-columns: 1fr; }
  .trace-key { margin-inline-start: 0; }
  .tail-scroll .chart { min-width: 560px; }
}
`;
