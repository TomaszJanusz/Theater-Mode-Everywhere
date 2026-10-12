import type { Session } from './browser';
import { readPlayer } from './browser';
import { cpuDeltas, readMachineTicks, readProcessTicks, ticksPerSecond, clock, type Clock } from './processes';
import { median, type Measurement } from './model';
type ProcessInfo = { id: number; type: string; cpuTime: number };
export function parseProcesses(value: unknown): ProcessInfo[] {
  if (!Array.isArray(value)) throw new Error('Missing CDP process counters');
  const rows = value.map((row: unknown) => {
    if (!row || typeof row !== 'object' || !('id' in row) || !('type' in row) || !('cpuTime' in row)
        || typeof row.id !== 'number' || !Number.isInteger(row.id) || row.id <= 0 || typeof row.type !== 'string'
        || typeof row.cpuTime !== 'number' || !Number.isFinite(row.cpuTime) || row.cpuTime < 0) throw new Error('Invalid CDP process counter');
    return { id: row.id, type: row.type, cpuTime: row.cpuTime };
  });
  if (!rows.length || new Set(rows.map(r => r.id)).size !== rows.length) throw new Error('Empty/duplicate CDP process counters');
  return rows;
}
export function metricDelta(before: Record<string, number>, after: Record<string, number>, name: string): number | null {
  const a = before[name], b = after[name];
  return Number.isFinite(a) && Number.isFinite(b) && b >= a ? b - a : null;
}
export async function measure(session: Session, windowMs: number, timer: Clock = clock): Promise<Measurement> {
  await session.pageCdp.send('Performance.enable', { timeDomain: 'timeTicks' });
  const pre = await readPlayer(session.page);
  const start = timer.now();
  const metrics = async () => {
    const result = await session.pageCdp.send('Performance.getMetrics');
    return Object.fromEntries(result.metrics.map((m: { name: string; value: number }) => [m.name, m.value])) as Record<string, number>;
  };
  const processes = async () => parseProcesses((await session.browserCdp.send('SystemInfo.getProcessInfo')).processInfo);
  const metricsBefore = await metrics(), processesBefore = await processes();
  const machineBefore = readMachineTicks(), ticksBefore = readProcessTicks(processesBefore.map(p => p.id));
  await timer.sleep(windowMs);
  const metricsAfter = await metrics(), processesAfter = await processes();
  const machineAfter = readMachineTicks(), ticksAfter = readProcessTicks(processesAfter.map(p => p.id));
  const wallSec = (timer.now() - start) / 1000;
  const post = await readPlayer(session.page), tickRate = ticksPerSecond();
  const tickDelta = cpuDeltas(ticksBefore, ticksAfter, wallSec);
  const beforeById = new Map(processesBefore.map(p => [p.id, p]));
  let processSetChanged = tickDelta.changed, familySeconds = 0, gpuSeconds = 0;
  let counterError: string | null = null;
  for (const proc of processesAfter) {
    const prev = beforeById.get(proc.id);
    if (!prev || prev.type !== proc.type) { processSetChanged = true; continue; }
    const delta = proc.cpuTime - prev.cpuTime;
    if (delta < 0) counterError = 'Process counter reset';
    familySeconds += delta;
    if (proc.type.toLowerCase() === 'gpu') gpuSeconds += delta;
  }
  const renderer = metricDelta(metricsBefore, metricsAfter, 'ProcessTime'), thread = metricDelta(metricsBefore, metricsAfter, 'ThreadTime');
  const elapsed = metricDelta(metricsBefore, metricsAfter, 'Timestamp');
  if (renderer == null || thread == null || elapsed == null || elapsed <= 0 || tickDelta.seconds == null) counterError = 'Missing/reset CPU counters';
  const machineDelta = machineAfter.busy - machineBefore.busy;
  if (machineDelta < 0 || machineAfter.total <= machineBefore.total) counterError = 'Machine counter reset';
  const pct = (seconds: number) => 100 * seconds / wallSec;
  return { wallSec, rendererPct: renderer == null || !elapsed ? null : 100 * renderer / elapsed,
    threadPct: thread == null || !elapsed ? null : 100 * thread / elapsed, familyPct: pct(familySeconds), gpuPct: pct(gpuSeconds),
    nonChromePct: tickDelta.seconds == null ? null : Math.max(0, 100 * (machineDelta - tickDelta.seconds) / tickRate / wallSec),
    counterError, processSetChanged, pre, post };
}
export async function observeLoad(timer: Clock = clock): Promise<{ median: number; p95: number; samples: number[]; threshold: number }> {
  const samples: number[] = [], tickRate = ticksPerSecond();
  let prev = readMachineTicks(), at = timer.now();
  for (let i = 0; i < 60; i++) {
    await timer.sleep(1000);
    const now = readMachineTicks(), end = timer.now();
    const elapsed = (end - at) / 1000;
    if (elapsed <= 0 || now.busy < prev.busy) throw new Error('Invalid background load interval');
    samples.push(100 * (now.busy - prev.busy) / tickRate / elapsed);
    prev = now; at = end;
  }
  const sorted = [...samples].sort((a, b) => a - b), p95 = sorted[Math.ceil(sorted.length * 0.95) - 1];
  return { median: median(samples)!, p95, samples, threshold: Math.max(p95 * 2, p95 + 40) };
}
