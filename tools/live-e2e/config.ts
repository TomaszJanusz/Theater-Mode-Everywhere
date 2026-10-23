import { readFileSync } from 'node:fs';

import { CAPABILITIES, LANE_ID, type Capability, type QuarantineEntry, type Target } from './model';

/** The lane's only retry: one second attempt per target, never more. */
export const RETRIES = 1;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown, what: string): string => {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${what} must be a non-empty string`);
  return value;
};

/** Validates the private `LIVE_E2E_TARGETS` JSON (an array of targets). */
export function parseTargets(raw: string | undefined): Target[] {
  if (!raw?.trim()) throw new Error('LIVE_E2E_TARGETS is empty; the lane needs a private target list');
  let json: unknown;
  try { json = JSON.parse(raw); } catch { throw new Error('LIVE_E2E_TARGETS is not valid JSON'); }
  if (!Array.isArray(json) || !json.length) throw new Error('LIVE_E2E_TARGETS must be a non-empty array');
  const seen = new Set<string>();
  return json.map((entry, index): Target => {
    if (!isRecord(entry)) throw new Error(`target ${index} must be an object`);
    const pageType = text(entry.pageType, `target ${index} pageType`);
    if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(pageType)) throw new Error(`target ${index} pageType must be a short kebab-case id`);
    if (pageType === LANE_ID) throw new Error(`pageType ${LANE_ID} is reserved for the lane's own health`);
    if (seen.has(pageType)) throw new Error(`duplicate pageType ${pageType}`);
    seen.add(pageType);
    const url = text(entry.url, `${pageType} url`);
    if (!/^https?:\/\//.test(url)) throw new Error(`${pageType} url must be http(s)`);
    const capabilities = entry.capabilities ?? ['theater'];
    if (!Array.isArray(capabilities) || !capabilities.length
      || !capabilities.every((c): c is Capability => (CAPABILITIES as readonly unknown[]).includes(c))) {
      throw new Error(`${pageType} capabilities must be a non-empty subset of ${CAPABILITIES.join(', ')}`);
    }
    const videoSelector = entry.videoSelector === undefined ? 'video' : text(entry.videoSelector, `${pageType} videoSelector`);
    return { pageType, url, capabilities, videoSelector };
  });
}

/** Reads `quarantine.json`: page types whose failures are reported as skipped until they expire. */
export function parseQuarantine(raw: string): QuarantineEntry[] {
  const json: unknown = JSON.parse(raw);
  if (!Array.isArray(json)) throw new Error('quarantine must be an array');
  return json.map((entry, index): QuarantineEntry => {
    if (!isRecord(entry)) throw new Error(`quarantine ${index} must be an object`);
    const expires = text(entry.expires, `quarantine ${index} expires`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(expires) || Number.isNaN(Date.parse(expires))) throw new Error(`quarantine ${index} expires must be YYYY-MM-DD`);
    return { pageType: text(entry.pageType, `quarantine ${index} pageType`), owner: text(entry.owner, `quarantine ${index} owner`), expires, reason: text(entry.reason, `quarantine ${index} reason`) };
  });
}

export function loadQuarantine(): QuarantineEntry[] {
  return parseQuarantine(readFileSync(new URL('./quarantine.json', import.meta.url), 'utf8'));
}

/** Entries still in force on `today` (`YYYY-MM-DD`) and those past their expiry. */
export function splitQuarantine(entries: QuarantineEntry[], today: string): { active: QuarantineEntry[]; expired: QuarantineEntry[] } {
  return { active: entries.filter(e => e.expires >= today), expired: entries.filter(e => e.expires < today) };
}
