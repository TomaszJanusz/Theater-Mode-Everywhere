import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { validatePair } from './validation';
import { median, type Manifest, type Sample } from './model';
export function completeRows(manifest: Manifest, rows: Sample[]): Sample[] {
  const accepted = rows.filter(r => r.accepted && r.measurement);
  if (manifest.mode !== 'compare') {
    const unique = new Map<string, Sample>();
    for (const row of accepted) unique.set(`${row.scenarioId}/${row.round}/${row.buildId}`, row);
    return [...unique.values()];
  }
  const pairs = new Map<string, Sample[]>();
  for (const row of rows) {
    if (!row.pairId) continue;
    const key = `${row.scenarioId}/${row.round}/${row.attempt}/${row.pairId}`;
    const pair = pairs.get(key) ?? []; pair.push(row); pairs.set(key, pair);
  }
  const rounds = new Map<string, Sample[]>();
  for (const pair of pairs.values()) {
    const scenario = manifest.scenarios.find(s => s.id === pair[0].scenarioId)!;
    const ids = scenario.expected.extension ? manifest.builds.map(b => b.id) : ['native'];
    if (validatePair(pair) || pair.length !== ids.length || ids.some(id => pair.filter(r => r.buildId === id && r.accepted && r.measurement).length !== 1)) continue;
    rounds.set(`${pair[0].scenarioId}/${pair[0].round}`, pair);
  }
  return [...rounds.values()].flat();
}
export function countRounds(manifest: Manifest, rows: Sample[], scenarioId: string): number {
  return new Set(completeRows(manifest, rows).filter(r => r.scenarioId === scenarioId && r.round <= manifest.config.rounds).map(r => r.round)).size;
}
export function incomplete(manifest: Manifest, rows: Sample[]): boolean {
  return manifest.scenarios.some(s => countRounds(manifest, rows, s.id) < manifest.config.rounds);
}
export function scatter(manifest: Manifest, rows: Sample[], scenarioId: string): boolean {
  const accepted = completeRows(manifest, rows).filter(r => r.scenarioId === scenarioId);
  return [...new Set(accepted.map(r => r.buildId))].some(id => {
    const values = accepted.filter(r => r.buildId === id).map(r => r.measurement!.rendererPct!).filter(Number.isFinite);
    return values.length >= 3 && Math.max(...values) - Math.min(...values) > manifest.config.scatterPp;
  });
}
export function pairedDeltas(manifest: Manifest, rows: Sample[], scenarioId: string, metric: 'rendererPct' | 'familyPct' | 'gpuPct') {
  const valid = completeRows(manifest, rows).filter(r => r.scenarioId === scenarioId);
  const pairs = [...new Set(valid.map(r => r.round))].map(round => valid.filter(r => r.round === round));
  const deltas: number[] = [], relative: number[] = [];
  for (const pair of pairs) {
    const a = pair.find(r => r.buildId === manifest.builds[0].id)?.measurement?.[metric];
    const b = pair.find(r => r.buildId === manifest.builds[1].id)?.measurement?.[metric];
    if (a == null || b == null) continue;
    deltas.push(b - a);
    if (a !== 0) relative.push(100 * (b - a) / a);
  }
  return { pp: median(deltas), relative: relative.length === deltas.length ? median(relative) : null, n: deltas.length };
}
export function csvCell(value: unknown): string {
  const text = value == null ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
function md(value: string): string { return value.replaceAll('|', '\\|').replaceAll('\n', ' '); }
function summary(values: number[]): string {
  return values.length ? `${median(values)!.toFixed(2)} (${Math.min(...values).toFixed(2)}–${Math.max(...values).toFixed(2)})` : 'unavailable';
}
export function renderReport(manifest: Manifest, rows: Sample[]): { markdown: string; csv: string } {
  const valid = completeRows(manifest, rows), config = manifest.config;
  const body = [`# YouTube CPU suite — ${manifest.id}`, '',
    `Status: **${incomplete(manifest, rows) ? 'INCOMPLETE' : 'COMPLETE'}**. ${manifest.createdAt}. Mode: ${manifest.mode}.`,
    'CPU percentages use one core as 100%. GPU process CPU is not GPU utilization.',
    'Medians and ranges are descriptive; three rounds do not establish statistical significance. Instrumented, browser-muted playback is a diagnostic workload.', '',
    ...manifest.builds.map(b => `Build ${md(b.id)}: version ${md(b.version)}, SHA256 \`${b.hash}\`, declared source SHA: ${b.sourceSha ?? 'unavailable'}.`),
    '', `Environment: ${md(JSON.stringify(manifest.environment))}`, '',
    '| Scenario | Build | Rounds / required | Renderer CPU | Browser family CPU | GPU process CPU | Dropped frames Δ | Stability |',
    '|---|---|---|---|---|---|---|---|'];
  for (const scenario of manifest.scenarios) {
    const builds = scenario.expected.extension ? manifest.builds.map(b => b.id) : ['native'];
    for (const id of builds) {
      const items = valid.filter(r => r.scenarioId === scenario.id && r.buildId === id);
      const metric = (key: 'rendererPct' | 'familyPct' | 'gpuPct') => summary(items.map(r => r.measurement![key]!).filter(Number.isFinite));
      const dropped = items.flatMap(r => {
        const pre = r.measurement!.pre.video?.dropped, post = r.measurement!.post.video?.dropped;
        return pre == null || post == null ? [] : [post - pre];
      });
      body.push(`| ${scenario.id} | ${md(id)} | ${items.length} / ${config.rounds} | ${metric('rendererPct')} | ${metric('familyPct')} | ${metric('gpuPct')} | ${summary(dropped)} | ${scatter(manifest, rows, scenario.id) ? 'UNSTABLE' : items.length < 3 ? 'insufficient data' : 'within scatter limit'} |`);
    }
  }
  if (manifest.mode === 'compare') {
    body.push('', '## Paired differences B − A', '', '| Scenario | Metric | Δ percentage points | Δ relative % | Complete pairs |', '|---|---|---|---|---|');
    for (const s of manifest.scenarios.filter(s => s.expected.extension)) for (const metric of ['rendererPct', 'familyPct', 'gpuPct'] as const) {
      const d = pairedDeltas(manifest, rows, s.id, metric);
      body.push(`| ${s.id} | ${metric} | ${d.pp?.toFixed(2) ?? 'unavailable'} | ${d.relative?.toFixed(2) ?? 'unavailable'} | ${d.n} |`);
    }
  }
  const nativeAll = valid.filter(r => r.state === 'native-all');
  body.push('', '## Actual native-all settings', ...nativeAll.map(r => `- Round ${r.round}: ${JSON.stringify(r.measurement!.post.native)}`), '',
    `Rejected attempts: ${rows.filter(r => !r.accepted).length}. Accepted rows excluded from incomplete pairs: ${rows.filter(r => r.accepted).length - valid.length}.`,
    ...rows.filter(r => !r.accepted).map(r => `- ${r.scenarioId}/${md(r.buildId)} round ${r.round} attempt ${r.attempt}: ${md(r.reason!.code)} — ${md(r.reason!.detail)}`));
  const header = ['experiment', 'scenario', 'build', 'round', 'attempt', 'pair', 'accepted', 'included', 'reasonCode', 'reasonDetail', 'rendererPct', 'familyPct', 'gpuPct', 'threadPct', 'wallSec', 'droppedFramesDelta'];
  const included = new Set(valid);
  const csv = [header.join(','), ...rows.map(r => {
    const m = r.measurement, pre = m?.pre.video?.dropped, post = m?.post.video?.dropped;
    return [r.experimentId, r.scenarioId, r.buildId, r.round, r.attempt, r.pairId, r.accepted, included.has(r), r.reason?.code, r.reason?.detail,
      m?.rendererPct, m?.familyPct, m?.gpuPct, m?.threadPct, m?.wallSec, pre == null || post == null ? null : post - pre].map(csvCell).join(',');
  })].join('\n') + '\n';
  return { markdown: body.join('\n') + '\n', csv };
}
export function writeReport(dir: string, manifest: Manifest, rows: Sample[]): number {
  const report = renderReport(manifest, rows);
  writeFileSync(path.join(dir, 'SUMMARY.md'), report.markdown);
  writeFileSync(path.join(dir, 'samples.csv'), report.csv);
  return incomplete(manifest, rows) ? 2 : 0;
}
