/**
 * The first-run setup's install rules: which steps exist, what this device remembers, and when an install
 * gets the setup at all. Deliberately independent of browser APIs and light, because the background loads
 * it; how answers become settings is the Settings page's (options/setup-answers.ts).
 */
import { AUTO_THEATER_STORAGE_KEY } from './auto-theater-preferences';
import { LEGACY_YOUTUBE_EXCLUSION_MIGRATION_KEY } from './platform/legacy-youtube-exclusion';
import { OBSOLETE_LOCAL_KEYS, OBSOLETE_LOCAL_PREFIX } from './update-notice';

/** Settings opens the setup at this hash. Not an `OPTIONS_SECTIONS` entry: only the background opens it. */
export const SETUP_HASH = 'setup';

/**
 * Every step in order. A step is `ready` once its UI ships; the setup shows ready steps only and is offered
 * on install only when none is pending, so a partial setup never reaches a fresh install.
 */
export const SETUP_STEPS = [
  { id: 'services', ready: true },
  { id: 'start', ready: true },
  { id: 'keys', ready: true },
  { id: 'summary', ready: true }
] as const satisfies readonly { id: string; ready: boolean }[];
export type SetupStepId = (typeof SETUP_STEPS)[number]['id'];

export const shownSetupSteps = (): SetupStepId[] => SETUP_STEPS.filter(step => step.ready).map(step => step.id);
export const setupComplete = (): boolean => SETUP_STEPS.every(step => step.ready);

/** `storage.local`, per device: why this device has, or has not, been through the setup. */
export const SETUP_STATE_KEY = 'firstRunSetup';
export type SetupStatus = 'pending' | 'completed' | 'skipped' | 'profile';
export interface SetupState { status: SetupStatus; version: string }

export function resolveSetupState(value: unknown): SetupState | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const { status, version } = value as Record<string, unknown>;
  return (status === 'pending' || status === 'completed' || status === 'skipped' || status === 'profile') && typeof version === 'string'
    ? { status, version } : undefined;
}

/** What an install writes into `shortcuts`; `withShortcutDefaults` fills the rest. */
export const INSTALL_SHORTCUTS = { toggle: 'T', exit: 'Escape', seekBack: 'ArrowLeft', seekForward: 'ArrowRight' } as const;

/**
 * Settings a fresh install starts with that differ from the code defaults. AutoTheater starts off, so nothing
 * rearranges a page before the setup asked; existing profiles keep the code default (on) because nothing is written.
 */
export const FRESH_INSTALL_SETTINGS: Readonly<Record<string, unknown>> = { [AUTO_THEATER_STORAGE_KEY]: false };

function sameShortcuts(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const entries = Object.entries(value as Record<string, unknown>);
  return entries.length === Object.keys(INSTALL_SHORTCUTS).length
    && entries.every(([key, shortcut]) => INSTALL_SHORTCUTS[key as keyof typeof INSTALL_SHORTCUTS] === shortcut);
}

/**
 * Whether sync already holds someone's settings. Every install writes the install shortcuts, an empty
 * exclusion list and the fresh-install settings, so those values alone are not a profile.
 */
export function hasSettingsProfile(sync: Record<string, unknown>): boolean {
  return Object.entries(sync).some(([key, value]) => {
    if (value === undefined) return false;
    if (key === 'shortcuts') return !sameShortcuts(value);
    if (key === 'blacklist') return !Array.isArray(value) || value.length > 0;
    if (Object.hasOwn(FRESH_INSTALL_SETTINGS, key)) return value !== FRESH_INSTALL_SETTINGS[key];
    return true;
  });
}

/**
 * Whether `storage.local` shows this profile ran 2.0.x. A 2.0.x profile that never left its defaults looks like a fresh
 * one in sync, yet 2.0.x also wrote the feature-highlight and what's-new markers (no install since 2.1 writes them) and
 * the YouTube migration marker (only an update writes it), so those are positive evidence of a previous install.
 */
export function hasLegacyInstall(local: Record<string, unknown>): boolean {
  return Object.keys(local).some(key => key === LEGACY_YOUTUBE_EXCLUSION_MIGRATION_KEY
    || OBSOLETE_LOCAL_KEYS.includes(key) || key.startsWith(OBSOLETE_LOCAL_PREFIX));
}

export interface InstallPlan {
  /** One `storage.sync.set`, read before anything was written. */
  sync: Record<string, unknown>;
  /** The setup state to store, if any. */
  state?: SetupState;
  /** Open Settings at the setup. */
  openSetup: boolean;
}

/**
 * The `onInstalled` `install` handling. `sync` and `local` are read before any write. The setup is offered
 * only when it is complete, neither sync nor this device's earlier 2.0.x install holds a profile, and this
 * device has no setup state yet (a Firefox temporary add-on reports every reload as an install).
 */
export function installPlan(sync: Record<string, unknown>, local: Record<string, unknown>, version: string, complete = setupComplete()): InstallPlan {
  const defaults: Record<string, unknown> = {};
  if (!sync.shortcuts) defaults.shortcuts = { ...INSTALL_SHORTCUTS };
  if (!sync.blacklist) defaults.blacklist = [];
  if (!complete || resolveSetupState(local[SETUP_STATE_KEY])) return { sync: defaults, openSetup: false };
  if (hasSettingsProfile(sync) || hasLegacyInstall(local)) return { sync: defaults, state: { status: 'profile', version }, openSetup: false };
  return { sync: { ...defaults, ...FRESH_INSTALL_SETTINGS }, state: { status: 'pending', version }, openSetup: true };
}
