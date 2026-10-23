import type { ProbeState, Signature } from './format';

/**
 * Host drift: the live page's probe signature no longer matches its recording. The recording is
 * then stale, and with it every fixture test built on it: refresh the recording first, then fix
 * the provider if its tests fail on the new one (docs/browser-tests.md, "Recorded host fixtures").
 */
export interface DriftResult {
  fixture: string;
  status: 'passed' | 'failed' | 'skipped';
  /** One line per difference, or the reason for a skip. Never a URL. */
  detail?: string;
}

const describe = (state: ProbeState | undefined, field: keyof ProbeState): string => {
  if (!state) return 'missing probe';
  const value = state[field];
  return Array.isArray(value) ? `[${value.join(', ')}]` : String(value);
};

/** Every probe field that differs, as `probe.field: recorded X, live Y`. */
export function compareSignatures(recorded: Signature, live: Signature): string[] {
  const names = [...new Set([...Object.keys(recorded), ...Object.keys(live)])].sort();
  const fields: Array<keyof ProbeState> = ['count', 'rendered', 'transformed', 'within'];
  return names.flatMap(name => fields
    .filter(field => describe(recorded[name], field) !== describe(live[name], field))
    .map(field => `${name}.${field}: recorded ${describe(recorded[name], field)}, live ${describe(live[name], field)}`));
}

export function driftLine(result: DriftResult): string {
  const label = result.status === 'failed' ? 'DRIFT' : result.status.toUpperCase();
  return [`${label} ${result.fixture}`, ...(result.detail ? [result.detail.replace(/\n/g, '; ')] : [])].join(' - ');
}
