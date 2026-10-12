import path from 'node:path';
import { DEFAULT_STATES, STATES, type Config, type StateName, type VideoSpec } from './model';
export type Command = 'run' | 'compare' | 'probe' | 'topup' | 'report' | 'help';
export type Cli = { command: Command; configPath?: string; runDir?: string; states?: string;
  profile?: string; buildA?: string; buildB?: string };
export function parseCli(args: string[]): Cli {
  if (args.length === 1 && ['--help', '-h'].includes(args[0])) return { command: 'help' };
  const command = args[0] ?? 'run';
  if (!['run', 'compare', 'probe', 'topup', 'report'].includes(command)) throw new Error(`Unknown command: ${command}. Use --help.`);
  const cli: Cli = { command: command as Command };
  const flags = { '--config': 'configPath', '--run-dir': 'runDir', '--states': 'states', '--profile': 'profile',
    '--build-a': 'buildA', '--build-b': 'buildB' } as const;
  for (let i = 1; i < args.length; i += 2) {
    const flag = args[i];
    if (!(flag in flags)) throw new Error(`Unknown option: ${flag}`);
    const key = flags[flag as keyof typeof flags], value = args[i + 1];
    if (!value || value.startsWith('--') || cli[key] !== undefined) throw new Error(`Missing or duplicate value: ${flag}`);
    cli[key] = value;
  }
  if (command === 'report' || command === 'topup') {
    if (!cli.runDir) throw new Error(`${command} requires --run-dir`);
    if (cli.states || cli.profile || cli.buildA || cli.buildB || (command === 'report' && cli.configPath)) {
      throw new Error(`${command} uses the saved experiment; overrides are not allowed`);
    }
  } else if (cli.runDir) throw new Error('--run-dir is only valid for report/topup');
  if (command === 'probe' && cli.states) throw new Error('probe checks the fixed native feature matrix; --states requires run/compare');
  if (command === 'compare' && (!cli.buildA || !cli.buildB)) throw new Error('compare requires --build-a and --build-b');
  if (command !== 'compare' && (cli.buildA || cli.buildB)) throw new Error('Build A/B options require compare');
  return cli;
}
export function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Invalid ${label}`);
  return value as Record<string, unknown>;
}
function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Invalid ${label}`);
  return value;
}
function number(value: unknown, label: string, integer = false, zero = false): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || (zero ? value < 0 : value <= 0) || (integer && !Number.isInteger(value))) {
    throw new Error(`Invalid ${label}`);
  }
  return value;
}
function video(urlValue: unknown, idValue: unknown, startValue: unknown): VideoSpec {
  const url = text(urlValue, 'video URL'), id = text(idValue, 'video id'), parsed = new URL(url);
  if (parsed.protocol !== 'https:' || !['youtube.com', 'www.youtube.com'].includes(parsed.hostname)
      || parsed.pathname !== '/watch' || parsed.searchParams.get('v') !== id || !/^[\w-]{11}$/.test(id)) {
    throw new Error('Expected a matching HTTPS YouTube watch URL and videoId');
  }
  return { url, id, quality: 'medium', width: 640, height: 360, fps: null,
    startSec: number(startValue ?? 10, 'startSec', false, true) };
}
export function parseConfig(value: unknown, root: string, cli?: Cli): Config {
  const raw = object(value, 'config'), ext = object(raw.extension, 'extension');
  if (raw.outDir !== undefined) throw new Error('outDir is obsolete: each experiment gets a unique temp directory');
  const profile = cli?.profile ?? raw.profile ?? 'default';
  if (profile !== 'default' && profile !== 'extended') throw new Error('profile must be default or extended');
  const rawStates: unknown = cli?.states ? cli.states.split(',') : raw.states ?? [...DEFAULT_STATES,
    ...(profile === 'extended' ? ['after-exit', 'after-navigation'] : [])];
  if (!Array.isArray(rawStates) || !rawStates.length || rawStates.some(s => typeof s !== 'string' || !Object.hasOwn(STATES, s))) {
    throw new Error('Unknown/empty states; disabled was renamed to effects-disabled');
  }
  const states = rawStates as StateName[];
  if (new Set(states).size !== states.length) throw new Error('Duplicate states');
  const navigationVideo = raw.navigationVideo == null ? null : (() => {
    const nav = object(raw.navigationVideo, 'navigationVideo');
    return video(nav.url, nav.id, nav.startSec);
  })();
  const mainVideo = video(raw.videoUrl, raw.videoId, raw.startSec);
  if (states.includes('after-navigation') && (!navigationVideo || navigationVideo.id === mainVideo.id)) {
    throw new Error('after-navigation requires navigationVideo with a different video id');
  }
  return { video: mainVideo, navigationVideo, states, profile,
    warmupMs: number(raw.warmupMs ?? 6000, 'warmupMs'), windowMs: number(raw.windowMs ?? 20000, 'windowMs'),
    rounds: number(raw.rounds ?? 3, 'rounds', true), attempts: number(raw.attempts ?? 3, 'attempts', true),
    scatterPp: number(raw.scatterPp ?? 5, 'scatterPp', false, true), scatterExtra: number(raw.scatterExtra ?? 2, 'scatterExtra', true, true),
    extension: { name: text(ext.name, 'extension.name'), path: path.resolve(root, text(ext.path, 'extension.path')),
      ...(ext.sha === undefined ? {} : { sha: text(ext.sha, 'extension.sha') }) } };
}
