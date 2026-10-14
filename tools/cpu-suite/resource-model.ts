import path from 'node:path';
import type { Build } from './model';
import { counterDelta, type Counters } from './resource-probe';
export const FIXTURES = ['generic-mousemove', 'generic-iframes', 'generic-late-shadow',
  'chat-absent', 'chat-live', 'chat-replay', 'chat-hidden', 'chat-portals',
  'disney-catalog', 'disney-playback', 'disney-pause-seek', 'disney-hidden', 'disney-spa',
  'youtube-stream', 'youtube-captions'] as const;
export type Fixture = typeof FIXTURES[number];
export type Options = { buildA: string; buildB?: string; output: string; browser: 'chromium' | 'firefox'; rounds: number; cycles: number; sha?: string; heap: boolean; fixtures: Fixture[] };
export function resourceOptions(args: string[]): Options {
  const values: Record<string, string> = {};
  const flags = ['--build-a', '--build-b', '--output', '--browser', '--rounds', '--cycles', '--sha', '--heap', '--fixtures'];
  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i], value = args[i + 1];
    if (!flags.includes(flag) || values[flag] !== undefined || !value || value.startsWith('--')) throw new Error(`Invalid option: ${flag}`);
    values[flag] = value;
  }
  if (!values['--build-a'] || !values['--output']) throw new Error('--build-a and --output are required');
  const browser = values['--browser'] ?? 'chromium';
  if (browser !== 'chromium' && browser !== 'firefox') throw new Error('Expected chromium or firefox');
  const rounds = Number(values['--rounds'] ?? 3), cycles = Number(values['--cycles'] ?? 20);
  if (!Number.isInteger(rounds) || rounds < 1 || rounds > 10 || !Number.isInteger(cycles) || cycles < 20 || cycles > 100) throw new Error('rounds: 1–10; cycles: 20–100');
  if (values['--heap'] && !['true', 'false'].includes(values['--heap'])) throw new Error('--heap expects true/false');
  if (browser === 'firefox' && values['--heap'] === 'true') throw new Error('CDP heap diagnostics require Chromium');
  const names = values['--fixtures']?.split(',') ?? [...FIXTURES];
  const fixtures = names.map(name => {
    const fixture = FIXTURES.find(item => item === name);
    if (!fixture) throw new Error(`Unknown fixture: ${name}`);
    return fixture;
  });
  if (new Set(fixtures).size !== fixtures.length) throw new Error('Duplicate fixtures');
  return { fixtures, buildA: path.resolve(values['--build-a']), ...(values['--build-b'] ? { buildB: path.resolve(values['--build-b']) } : {}),
    output: path.resolve(values['--output']), browser, rounds, cycles, sha: values['--sha'], heap: values['--heap'] === 'true' };
}
export type ResourceSample = { fixture: Fixture; build: Build; round: number; accepted: boolean; reason: string | null;
  phases: { name: string; before: Counters; after: Counters; delta: Record<string, number>; state: Record<string, unknown>; input: Record<string, unknown>; heapBytes: number | null }[];
  errors: string[]; heap: Record<string, unknown> | null };
export const phase = (name: string, before: Counters, after: Counters, state: Record<string, unknown>, heapBytes: number | null, input: Record<string, unknown> = {}) =>
  ({ name, before, after, delta: counterDelta(before, after), state, input, heapBytes });
export function resourceReport(samples: ResourceSample[]): string {
  return ['# Resource fixture audit', '',
    'Diagnostic bundle injection in one page world; NOT an installed-extension or real-host profile. Controlled clock; counters include fixture actions and in-phase validation. No CPU/GPU measurements.',
    'Heap endpoints and sampled allocations are not peak memory or proof of a leak. Firefox CDP heap unavailable. RTE and state evidence are in raw phases.', '',
    '| Fixture / phase | Build / round | Accepted | video queries | rect / style | observer callbacks | interval callbacks | clones | active observers / intervals | heap bytes |',
    '|---|---|---|---|---|---|---|---|---|---|',
    ...samples.flatMap(s => s.phases.map(p => `| ${s.fixture} / ${p.name} | ${s.build.id} / ${s.round} | ${s.accepted} | ${p.delta.videoQueries ?? 0} | ${p.delta.rect ?? 0} / ${p.delta.computedStyle ?? 0} | ${p.delta.observerCallbacks ?? 0} | ${p.delta.setIntervalCallbacks ?? 0} | ${p.delta.responseClone ?? 0} | ${p.after.active.observers} / ${p.after.active.intervals} | ${p.heapBytes ?? 'unavailable'} |`)),
    '', `Rejected samples: ${samples.filter(s => !s.accepted).length}.`,
    ...samples.filter(s => !s.accepted).map(s => `- ${s.fixture}/${s.build.id}/${s.round}: ${(s.reason ?? '').replaceAll('\n', ' ').replaceAll('|', '\\|')}`), ''].join('\n');
}
/** A rejected member excludes the entire pair; raw rows remain reviewable. */
export function completeResourcePair(rows: ResourceSample[], expectedBuilds: number): void {
  if (rows.length !== expectedBuilds || rows.some(row => !row.accepted)) {
    for (const row of rows) { row.accepted = false; row.reason ??= 'Incomplete A/B pair'; }
    return;
  }
  const first = rows[0];
  if (!first) return;
  if (rows.some(row => row.fixture !== first.fixture || row.round !== first.round
    || row.phases.map(p => p.name).join('/') !== first.phases.map(p => p.name).join('/'))) {
    for (const row of rows) { row.accepted = false; row.reason = 'Mismatched fixture phases'; }
  }
}
