import { createCrunchyrollServiceActions } from './crunchyroll/service-actions';
import { createDisneyServiceActions } from './disney/service-actions';
import { createNetflixServiceActions } from './netflix/service-actions';
import { isCrunchyrollHost, isDisneyHost, isNetflixHost } from './hosts';
import type { ServiceActionSource } from '../core/service-actions';

/** Provider composition belongs here; the shared CTA only consumes actions. */
export function createServiceActions(): ServiceActionSource | null {
  if (isNetflixHost()) return createNetflixServiceActions();
  if (isDisneyHost()) return createDisneyServiceActions();
  if (isCrunchyrollHost()) return createCrunchyrollServiceActions();
  return null;
}
