import { createNetflixServiceActions } from './netflix/service-actions';
import { isNetflixHost } from './hosts';
import type { ServiceActionSource } from '../core/service-actions';

/** Provider composition belongs here; the shared CTA only consumes actions. */
export function createServiceActions(): ServiceActionSource | null {
  return isNetflixHost() ? createNetflixServiceActions() : null;
}
