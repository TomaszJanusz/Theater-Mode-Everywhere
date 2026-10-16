import { readFileSync } from 'node:fs';
import { installedGeneration, previousGeneration } from '../feature-highlights';

/** The shipped manifest is the single source of the version that tests treat as "current". */
export const CURRENT_VERSION: string = JSON.parse(
  readFileSync(new URL('../../manifest.json', import.meta.url), 'utf8')
).version;
export const CURRENT_GENERATION = installedGeneration(CURRENT_VERSION);
export const PREVIOUS_GENERATION = previousGeneration(CURRENT_GENERATION);
