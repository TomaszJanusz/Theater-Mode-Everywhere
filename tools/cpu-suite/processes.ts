import { closeSync, existsSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { performance } from 'node:perf_hooks';
import path from 'node:path';
export type Clock = { now(): number; sleep(ms: number): Promise<void> };
export const clock: Clock = { now: () => performance.now(), sleep: ms => new Promise(resolve => setTimeout(resolve, ms)) };
export function cancellableClock(signal: AbortSignal, timer: Clock = clock): Clock {
  return { now: timer.now, sleep(ms) {
    if (signal.aborted) return Promise.reject(new Error('Experiment interrupted'));
    if (timer === clock) return delay(ms, undefined, { signal });
    return new Promise<void>((resolve, reject) => {
      const abort = () => reject(new Error('Experiment interrupted'));
      signal.addEventListener('abort', abort, { once: true });
      timer.sleep(ms).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    });
  } };
}
export class Resources {
  readonly abort = new AbortController();
  private entries = new Set<() => void | Promise<void>>();
  private closing: Promise<void> | null = null;
  add(dispose: () => void | Promise<void>): () => void {
    if (this.closing) { void dispose(); return () => {}; }
    this.entries.add(dispose);
    return () => { this.entries.delete(dispose); };
  }
  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.abort.abort();
    const entries = [...this.entries].reverse(); this.entries.clear();
    this.closing = (async () => {
      const errors: unknown[] = [];
      for (const dispose of entries) try { await dispose(); } catch (error) { errors.push(error); }
      if (errors.length) throw new AggregateError(errors, 'Cleanup failed');
    })();
    return this.closing;
  }
}
export async function waitFor(check: () => boolean | Promise<boolean>, timeoutMs: number, timer: Clock = clock): Promise<void> {
  const until = timer.now() + timeoutMs;
  while (!(await check())) {
    if (timer.now() >= until) throw new Error('Timed out waiting for readiness');
    await timer.sleep(Math.min(100, until - timer.now()));
  }
}
export function acquireLock(dir: string): () => void {
  const filename = path.join(dir, 'executor.lock');
  let fd: number;
  try { fd = openSync(filename, 'wx'); }
  catch { throw new Error(`Experiment already locked: ${filename}. Do not remove a live executor's lock.`); }
  writeFileSync(fd, `${process.pid}\n`);
  closeSync(fd);
  let released = false;
  return () => { if (!released) { released = true; rmSync(filename); } };
}
async function stopChild(child: ChildProcess): Promise<void> {
  if (child.pid == null || child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>(resolve => child.once('exit', () => resolve()));
  child.kill('SIGTERM');
  const force = setTimeout(() => child.kill('SIGKILL'), 2000);
  try { await exited; } finally { clearTimeout(force); }
}
export async function ensureDisplay(resources: Resources): Promise<{ display: string; backend: string }> {
  if (process.env.DISPLAY) {
    return { display: process.env.DISPLAY, backend: 'external-X11' };
  }
  const original = process.env.DISPLAY;
  // -displayfd lets Xvfb allocate a display atomically, avoiding socket/PID races.
  const child = spawn('Xvfb', ['-displayfd', '1', '-screen', '0', '1920x1080x24', '-nolisten', 'tcp'], { stdio: ['ignore', 'pipe', 'pipe'] });
  const release = resources.add(async () => { await stopChild(child); if (original === undefined) delete process.env.DISPLAY; else process.env.DISPLAY = original; });
  let output = '', stderr = '', failure: Error | null = null;
  child.stdout?.on('data', data => { output += String(data); });
  child.stderr?.on('data', data => { stderr = (stderr + String(data)).slice(-4000); });
  child.on('error', error => { failure = error; });
  try {
    await waitFor(() => {
      if (failure) throw failure;
      if (child.exitCode !== null) throw new Error(`Xvfb exited with ${child.exitCode}: ${stderr}`);
      return /^\d+\n/.test(output);
    }, 5000);
    const display = `:${output.trim()}`;
    await waitFor(() => existsSync(`/tmp/.X11-unix/X${display.slice(1)}`), 5000);
    process.env.DISPLAY = display;
    return { display, backend: 'owned-Xvfb' };
  } catch (error) { await stopChild(child); release(); throw error; }
}
export function readMachineTicks(): { busy: number; total: number } {
  const values = readFileSync('/proc/stat', 'utf8').split('\n')[0].trim().split(/\s+/).slice(1).map(Number);
  // guest and guest_nice are already included in user/nice.
  const total = values.slice(0, 8).reduce((sum, n) => sum + n, 0);
  return { total, busy: total - values[3] - values[4] };
}
export function readProcessTicks(pids: number[]): Map<number, number> {
  return new Map(pids.map(pid => {
    try {
      const text = readFileSync(`/proc/${pid}/stat`, 'utf8');
      const parts = text.slice(text.lastIndexOf(')') + 2).trim().split(/\s+/);
      return [pid, Number(parts[11]) + Number(parts[12])] as const;
    } catch { return [pid, NaN] as const; }
  }));
}
export function cpuDeltas(before: Map<number, number>, after: Map<number, number>, wallSec: number): { seconds: number | null; changed: boolean } {
  const changed = before.size !== after.size || [...before.keys()].some(id => !after.has(id));
  if (changed || wallSec <= 0 || [...before, ...after].some(([, n]) => !Number.isFinite(n))) return { seconds: null, changed };
  let seconds = 0;
  for (const [pid, current] of after) {
    const delta = current - before.get(pid)!;
    if (delta < 0) return { seconds: null, changed };
    seconds += delta;
  }
  return { seconds, changed };
}
export function ticksPerSecond(): number {
  const value = Number(execFileSync('getconf', ['CLK_TCK'], { encoding: 'utf8' }).trim());
  if (!Number.isFinite(value) || value <= 0) throw new Error('Invalid CLK_TCK');
  return value;
}
