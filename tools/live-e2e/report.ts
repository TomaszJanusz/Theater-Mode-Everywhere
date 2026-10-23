import type { SpecResult, Status } from './model';

export interface PageTypeReport { pageType: string; status: Status; attempts: number; results: SpecResult[] }

export function logLine(pageType: string, r: SpecResult, redact: (text: string) => string): string {
  const detail = r.detail ? ` - ${r.detail}` : '';
  return redact(`${r.status.toUpperCase().padEnd(7)} ${pageType} ${r.capability}${detail}`);
}

/** The uploaded `results.json`. The whole document is redacted, so a field added later cannot leak a target. */
export const serializeResults = (date: string, pageTypes: readonly PageTypeReport[], redact: (text: string) => string): string =>
  redact(JSON.stringify({ date, pageTypes }, null, 2));
