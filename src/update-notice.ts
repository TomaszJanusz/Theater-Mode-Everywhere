/** The update announcement's state and rules; deliberately independent of browser APIs. */
export type Generation = `${number}.${number}`;

/** chrome.storage.local, written only by the background: `{ version, since }` until Update highlights are opened. */
export const PENDING_UPDATE_KEY = 'pendingUpdate';
export type PendingUpdate = { version: string; since: Generation };

/** Storage of the removed NEW badges and of the automatic Settings prompt after an update. */
export const OBSOLETE_LOCAL_KEYS = [
  'newFeaturesSeenThrough', 'newFeaturesSeenItems', 'newFeaturesWindow', 'newFeaturesHiddenThrough',
  'whatsNewAcknowledgedId', 'whatsNewAutoOpened', 'migration:bound-whats-new-auto-open:v1'
];
export const OBSOLETE_LOCAL_PREFIX = 'whatsNewAutoOpenedRelease:';
export const OBSOLETE_SYNC_KEYS = ['highlightNewFeatures'];

function isGeneration(value: unknown): value is Generation {
  return typeof value === 'string' && /^(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value)
    && value.split('.').every(part => Number.isSafeInteger(Number(part)));
}

/** The major.minor part of a manifest version, or undefined for anything else. */
export function versionGeneration(version: unknown): Generation | undefined {
  if (typeof version !== 'string') return undefined;
  const generation = version.split('.').slice(0, 2).join('.');
  return isGeneration(generation) ? generation : undefined;
}

export function compareGenerations(left: Generation, right: Generation): number {
  const [major, minor] = left.split('.').map(Number);
  const [otherMajor, otherMinor] = right.split('.').map(Number);
  return major - otherMajor || minor - otherMinor;
}

export function resolvePendingUpdate(value: unknown): PendingUpdate | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const { version, since } = value as Record<string, unknown>;
  return versionGeneration(version) && isGeneration(since) ? { version: version as string, since } : undefined;
}

/**
 * The pending announcement after `onInstalled`, or undefined when it does not change.
 *
 * Only an update to a newer major or minor generation is announced: patch updates, reloads of the
 * same build and downgrades stay silent. Local builds carry a date-based `0.YY.MMDD.HHMM` version
 * (scripts/build.ts) and never announce, so a development rebuild cannot raise the badge.
 * An announcement still pending keeps its `since`, so skipped versions add up.
 */
export function pendingAfterInstall(
  details: { reason: string; previousVersion?: string },
  version: string,
  current: PendingUpdate | undefined
): PendingUpdate | undefined {
  const next = versionGeneration(version);
  const previous = versionGeneration(details.previousVersion);
  if (details.reason !== 'update' || !next || !previous || next.startsWith('0.')
    || compareGenerations(next, previous) <= 0) return undefined;
  return { version, since: current && compareGenerations(current.since, previous) < 0 ? current.since : previous };
}

/** The X.Y the popup and the player menu name. */
export function announcedGeneration(update: PendingUpdate): Generation {
  return versionGeneration(update.version)!;
}
