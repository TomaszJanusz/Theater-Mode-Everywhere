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

    it(`a focused menu or slider trigger is framed like any bar button and expands only once entered in ${engine}`, { timeout: 60_000 }, async t => {
      const page = await (await shared.newContext(t, { viewport: { width: 1280, height: 720 } })).newPage();
      await serveFixture(page, FIXTURE);
      await bootPlayer(page, { settings: { keepControlsVisible: true } });
      await page.waitForFunction(() => Boolean(document.querySelector('video')?.readyState && document.querySelector('video')!.readyState >= 2));
      await enterTheater(page);
      await page.mouse.move(640, 100);

      const states = await page.evaluate(() => {
        const root = document.getElementById('theater-everywhere-ui')!.shadowRoot!;
        const state = (trigger: HTMLElement) => {
          const host = trigger.parentElement!;
          const panel = host.querySelector<HTMLElement>('.theater-menu-panel, .theater-volume-panel, .theater-speed-panel')!;
          const style = getComputedStyle(trigger);
          return {
            framed: trigger.matches(':focus-visible') && style.outlineStyle !== 'none',
            width: Math.round(trigger.getBoundingClientRect().width),
            panel: getComputedStyle(panel).display !== 'none' && getComputedStyle(panel).opacity === '1'
          };
        };
        const result: Record<string, unknown> = {};
        for (const name of ['player-settings', 'cc', 'volume', 'speed']) {
          const trigger = root.querySelector<HTMLElement>(`.${name}-btn`);
          if (!trigger || trigger.getClientRects().length === 0) continue;
          trigger.focus({ focusVisible: true } as FocusOptions);
          const focusedOnly = state(trigger);
          // Entering: a keyboard click opens a menu; a slider panel opens with focus on its slider.
          const slider = trigger.parentElement!.querySelector<HTMLElement>(':scope.theater-popover input[type="range"]');
          if (slider) slider.focus({ focusVisible: true } as FocusOptions);
          else trigger.click();
          const entered = { ...state(trigger), focusInPanel: !trigger.matches(':focus') };
          trigger.parentElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
          result[name] = { focusedOnly, entered };
        }
        return result;
      }) as Record<string, { focusedOnly: { framed: boolean; width: number; panel: boolean }; entered: { width: number; panel: boolean; focusInPanel: boolean } }>;

      assert.deepEqual(Object.keys(states).filter(name => name !== 'cc'), ['player-settings', 'volume', 'speed'], 'the bar has the triggers under test');
      for (const [name, { focusedOnly, entered }] of Object.entries(states)) {
        assert.deepEqual(focusedOnly, { framed: true, width: 32, panel: false }, `${name}: focus alone frames the 32px button and leaves its panel closed`);
        assert.ok(entered.panel && entered.focusInPanel && entered.width > 32, `${name}: entering opens the panel and its notch (${JSON.stringify(entered)})`);
      }
    });
  }
});
