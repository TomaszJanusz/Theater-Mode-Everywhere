import { describe, expect, test } from 'vitest';
import { userEvent } from 'vitest/browser';

import { APPEARANCE_MODES, blockingViolations } from '../test-utils/axe';
import { mountSurface } from '../test-utils/component-surface';
import { surfaceRegistrations } from '../test-utils/surface-registry';

// Registered surfaces × appearance modes, scanned with axe-core while closed and while open. Serious and
// critical violations fail. A new surface is covered by registering it in test-utils/surface-registry.ts.
for (const registration of surfaceRegistrations) {
  describe(registration.name, () => {
    for (const mode of APPEARANCE_MODES) {
      test(`has no serious accessibility violations: ${mode.name}`, async () => {
        const mounted = mountSurface(registration);
        const host = mounted.root.host as HTMLElement;
        mode.apply(host);
        expect(mode.applied(host), 'the mode is on').toBe(true);
        expect(await blockingViolations(host), 'closed').toEqual([]);
        mounted.trigger.focus();
        await userEvent.keyboard('{Enter}');
        expect(mounted.surface()?.dataset.teState).toBe('open');
        expect(await blockingViolations(host), 'open').toEqual([]);
      });
    }
  });
}
