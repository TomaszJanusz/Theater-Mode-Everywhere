import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { chromium, firefox } from 'playwright';

import { bootPlayer, enterTheater } from '../test-utils/player-boot';
import { sharedTestBrowser } from '../test-utils/test-browser';
import { testEngines } from '../test-utils/test-engines';
import { serveFixture, vodVideoFixture } from '../test-utils/video-fixtures';

const FIXTURE = vodVideoFixture({ title: 'Focus frame', pageTitle: 'Focus frame fixture' });

describe('keyboard focus frame', () => {
  for (const engine of testEngines()) {
    const shared = sharedTestBrowser(({ chromium, firefox })[engine]);

    it(`every control in the bar, its menus and its slider panels shows where focus is in ${engine}`, { timeout: 60_000 }, async t => {
      const page = await (await shared.newContext(t, { viewport: { width: 1280, height: 720 } })).newPage();
      await serveFixture(page, FIXTURE);
      await bootPlayer(page, { settings: { keepControlsVisible: true } });
      await page.waitForFunction(() => Boolean(document.querySelector('video')?.readyState && document.querySelector('video')!.readyState >= 2));
      await enterTheater(page);

      const unframed = await page.evaluate(() => {
        const root = document.getElementById('theater-everywhere-ui')!.shadowRoot!;
        const missing: string[] = [];
        const frame = (element: HTMLElement) => {
          element.focus({ focusVisible: true } as FocusOptions);
          // A stepper's arrows hand the frame to their row.
          const framed = [element, element.closest('.theater-settings-stepper-row')].some(owner => {
            const style = owner && getComputedStyle(owner);
            return style && style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0;
          });
          if (!element.matches(':focus-visible') || !framed) missing.push(`${element.tagName.toLowerCase()}.${[...element.classList].join('.')}`);
        };
        const controls = (container: ParentNode) => [...container.querySelectorAll<HTMLElement>('button, input, select, [tabindex]')]
          .filter(element => !(element as HTMLButtonElement).disabled && element.getClientRects().length > 0 && !element.closest('[hidden], [inert]'));
        controls(root.querySelector('.theater-controls-wrapper')!).forEach(frame);
        for (const trigger of root.querySelectorAll<HTMLButtonElement>('.theater-menu > button')) {
          trigger.click();
          controls(trigger.parentElement!.querySelector('.theater-menu-panel')!).forEach(frame);
          trigger.parentElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        }
        for (const name of ['volume', 'speed']) {
          root.querySelector<HTMLElement>(`.${name}-btn`)!.focus({ focusVisible: true } as FocusOptions);
          frame(root.querySelector<HTMLElement>(`.theater-${name}-container input[type="range"]`)!);
        }
        return missing;
      });
      assert.deepEqual(unframed, []);
    });
  }
});
