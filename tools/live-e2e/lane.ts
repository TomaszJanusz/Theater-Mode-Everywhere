import type { Status, SpecResult } from './model';

export interface AttemptOutcome {
  results: SpecResult[];
}

/**
 * Runs `attempt` until it has no failed spec or the retries are used up. Environment skips
 * and passes are final at once: only a genuine failure earns the single retry. The last
 * attempt's results win, and a pass after a retry is flagged so flakiness stays visible.
 */
export async function runWithRetries(attempt: (n: number) => Promise<AttemptOutcome>, retries: number): Promise<{ results: SpecResult[]; attempts: number }> {
  let outcome = await attempt(1);
  let attempts = 1;
  while (outcome.results.some(r => r.status === 'failed') && attempts <= retries) {
    attempts += 1;
    outcome = await attempt(attempts);
  }
  const results = attempts > 1 && !outcome.results.some(r => r.status === 'failed')
    ? outcome.results.map(r => r.status === 'passed' ? { ...r, detail: 'passed on retry' } : r)
    : outcome.results;
  return { results, attempts };
}

export function overall(results: readonly SpecResult[]): Status {
  if (results.some(r => r.status === 'failed')) return 'failed';
  return results.length && results.every(r => r.status === 'skipped') ? 'skipped' : 'passed';
}
