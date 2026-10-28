import { readFileSync } from 'node:fs';
import { installedGeneration, previousGeneration, runningGeneration } from '../feature-highlights';

/** The shipped manifest's version: what the last release (or release preparation) declared. */
export const MANIFEST_VERSION: string = JSON.parse(
  readFileSync(new URL('../../manifest.json', import.meta.url), 'utf8')
).version;
export const MANIFEST_GENERATION = installedGeneration(MANIFEST_VERSION);
/**
 * The version tests treat as "current": the generation the running code behaves as. It is the
 * manifest's, until the catalog registers items of a newer generation than the last release.
 */
export const CURRENT_VERSION: string = `${runningGeneration(MANIFEST_VERSION)}.${MANIFEST_VERSION.split('.')[2] ?? 0}`;
export const CURRENT_GENERATION = installedGeneration(CURRENT_VERSION);
export const PREVIOUS_GENERATION = previousGeneration(CURRENT_GENERATION);
