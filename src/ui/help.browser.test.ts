import assert from 'node:assert/strict';
import { describe, it, type TestContext } from 'node:test';

import { chromium, firefox, type Page } from 'playwright';

import { installChromeStub } from '../test-utils/chrome-stub';
import { readCatalog } from '../test-utils/language-audit';
import { bundlePlayer, enterTheater, playerStylesheets } from '../test-utils/player-boot';
import { sharedTestBrowser } from '../test-utils/test-browser';
import { selectTestEngines } from '../test-utils/test-engines';
import { serveFixture, vodVideoFixture } from '../test-utils/video-fixtures';

import { defaultShortcuts } from './shortcuts';

const FIXTURE = vodVideoFixture({ title: 'Shortcuts help' });
const CATALOGS = { ar: readCatalog('ar') };
const CUSTOM = { playPause: 'K', seekBack: 'Ctrl+Alt+Shift+ArrowLeft', seekForward: 'Ctrl+Alt+Shift+ArrowRight', toggleChat: '', frameForward: '' };

/** `bootPlayer`'s steps, with a runtime that serves language catalogs and records Settings requests. */
async function boot(page: Page, settings: Record<string, unknown> = {}): Promise<void> {
  await serveFixture(page, FIXTURE, 'http://help.test/');
  await installChromeStub(page, { sync: { keepControlsVisible: true, ...settings } });
  await page.evaluate(`window.__name = fn => fn; window.sentMessages = [];
    chrome.runtime.sendMessage = (message, reply) => {
      window.sentMessages.push(message);
      const response = message.action === 'get-language-catalog' ? ${JSON.stringify(CATALOGS)}[message.locale] : { ok: true };
      reply?.(response);
      return Promise.resolve(response);
    };`);
  const styles = playerStylesheets();
  await page.addStyleTag({ content: styles.page });
  await page.addScriptTag({ content: bundlePlayer() });
  await page.evaluate(`TheaterTest.setPlayerUiCss(${JSON.stringify(styles.ui)}); TheaterTest.bootstrapPlayerRuntime();`);
  await page.waitForFunction(() => (document.querySelector('video')?.readyState ?? 0) >= 2);
  await enterTheater(page);
  if (settings.language) await page.waitForFunction(lang => document.getElementById('theater-everywhere-ui')?.getAttribute('lang') === lang, settings.language);
}

async function openHelp(page: Page): Promise<void> {
  await page.keyboard.press('h');
  const overlay = page.locator('.theater-help-overlay');
  await overlay.waitFor();
  await overlay.evaluate(element => Promise.all(element.getAnimations({ subtree: true }).map(animation => animation.finished)));
}

/** Every row as rendered: the actions it lists, its label and, per action, the caps or the unassigned mark. */
const readRows = (page: Page) => page.locator('.theater-help-overlay').evaluate(overlay =>
  [...overlay.querySelectorAll<HTMLElement>('.theater-help-row')].map(row => ({
    group: row.closest<HTMLElement>('.theater-help-group')!.dataset.group,
    actions: row.dataset.actions!.split(' '),
    label: row.querySelector('dt')!.textContent,
    keys: row.querySelector('dd')!.textContent!.replace(/\s+/g, ''),
    unassigned: row.querySelector('dd > .theater-help-unassigned')?.textContent ?? null,
    bindings: [...row.querySelectorAll<HTMLElement>('.theater-help-binding')].map(binding => ({
      name: binding.getAttribute('aria-label'),
      text: binding.textContent,
      unassigned: binding.querySelector('.theater-help-unassigned')?.getAttribute('aria-label') ?? null,
      // One combination never wraps: all its caps share a line.
      lines: new Set([...binding.querySelectorAll('kbd')].map(kbd => Math.round(kbd.getBoundingClientRect().top))).size
    })),
    overflows: row.querySelector('dd')!.getBoundingClientRect().right > row.getBoundingClientRect().right + 0.5
      || row.querySelector('dd')!.getBoundingClientRect().left < row.getBoundingClientRect().left - 0.5
  })));

for (const [engine, browserType] of selectTestEngines(Object.entries({ chromium, firefox }), ([name]) => name)) {
  describe(`shortcuts help in ${engine}`, () => {
    const shared = sharedTestBrowser(browserType);
    const testPage = async (t: TestContext, viewport: { width: number; height: number }, run: (page: Page) => Promise<void>) => {
      const page = await (await shared.newContext(t, { viewport })).newPage();
      page.setDefaultTimeout(8_000);
      const errors: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      await run(page);
      assert.deepEqual(errors, []);
    };

    it('lists every shortcut in the registry exactly once, with customised and unassigned keys', { timeout: 30_000 }, async t => {
      await testPage(t, { width: 1280, height: 900 }, async page => {
        await boot(page, { shortcuts: CUSTOM });
        await openHelp(page);
        const rows = await readRows(page);
        assert.deepEqual(rows.flatMap(row => row.actions).sort(), Object.keys(defaultShortcuts).sort(), 'every registered action has one row');
        assert.deepEqual([...new Set(rows.map(row => row.group))], ['playback', 'audio', 'captions', 'view', 'layout', 'navigation']);
        const row = (action: string) => rows.find(candidate => candidate.actions.includes(action))!;
        assert.equal(row('playPause').keys, 'K');
        assert.equal(row('toggleChat').unassigned, 'Not assigned');
        assert.deepEqual(row('seekBack').bindings.map(({ name, text, lines }) => ({ name, text, lines })), [
          { name: 'Seek Backward (5s)', text: 'Ctrl+Alt+Shift+←', lines: 1 },
          { name: 'Seek Forward (5s)', text: '/Ctrl+Alt+Shift+→', lines: 1 }
        ]);
        assert.deepEqual(row('frameBack').bindings.map(({ name, unassigned }) => ({ name, unassigned })), [
          { name: 'Frame Step Backward', unassigned: null },
          { name: 'Frame Step Forward', unassigned: 'Not assigned' }
        ]);
        assert.equal(row('navigateUp').keys, 'WASD');
        assert.deepEqual(rows.filter(candidate => candidate.overflows).map(candidate => candidate.label), []);
        assert.match(await page.locator('[data-group="navigation"] .theater-help-hint').innerText(), /^W opens the controls bar.*S from its bottom row closes it\. Esc ends navigation\.$/s);
        // Holding seek forward is named with the customised key.
        assert.equal(await page.locator('[data-group="playback"] .theater-help-hint').innerText(), 'Hold Ctrl+Alt+Shift+→ to play at 2x until you let go.');
      });
    });

    it('is wide with two columns, one column on a narrow screen, and mirrors in right-to-left languages', { timeout: 30_000 }, async t => {
      await testPage(t, { width: 1280, height: 900 }, async page => {
        await boot(page, { language: 'ar' });
        await openHelp(page);
        const layout = () => page.locator('.theater-help-overlay').evaluate(overlay => {
          const box = (selector: string) => overlay.querySelector(selector)!.getBoundingClientRect();
          const groups = [...overlay.querySelectorAll('.theater-help-group')].map(group => group.getBoundingClientRect());
          const seek = [...overlay.querySelectorAll('[data-actions="seekBack seekForward"] .theater-help-binding')].map(binding => binding.getBoundingClientRect().left);
          return {
            dialog: Math.round(box('.te-dialog').width),
            columns: new Set(groups.map(group => Math.round(group.left))).size,
            playbackRightOfView: box('[data-group="playback"]').left > box('[data-group="view"]').left,
            labelRightOfKeys: box('[data-actions="playPause"] dt').left > box('[data-actions="playPause"] dd').left,
            keysLtr: getComputedStyle(overlay.querySelector('.theater-help-keys')!).direction,
            backBeforeForward: seek[0] < seek[1],
            fitsViewport: box('.te-dialog').right <= innerWidth && box('.te-dialog').left >= 0
          };
        });
        assert.deepEqual(await layout(), { dialog: 920, columns: 2, playbackRightOfView: true, labelRightOfKeys: true, keysLtr: 'ltr', backBeforeForward: true, fitsViewport: true });
        await page.setViewportSize({ width: 420, height: 800 });
        // The theater surface follows the viewport on its resize event; the dialog then fits.
        await page.waitForFunction(() => document.getElementById('theater-everywhere-ui')!.shadowRoot!
          .querySelector('.te-dialog')!.getBoundingClientRect().right <= innerWidth);
        const narrow = await layout();
        assert.equal(narrow.columns, 1);
        assert.equal(narrow.fitsViewport, true);
        assert.equal(narrow.labelRightOfKeys, true);
      });
    });

    it('is a labelled dialog with labelled groups, a predictable focus order and focus returned to its trigger', { timeout: 30_000 }, async t => {
      await testPage(t, { width: 1280, height: 900 }, async page => {
        await boot(page);
        await page.locator('.player-settings-btn').click();
        await page.locator('.help-btn').click();
        const dialog = page.getByRole('dialog', { name: 'Keyboard Shortcuts' });
        await dialog.waitFor();
        const tree = await dialog.ariaSnapshot();
        for (const name of ['Playback', 'Audio', 'Subtitles', 'Theater, Fullscreen & PiP', 'Picture and layout', 'Navigation']) {
          assert.match(tree, new RegExp(`group "${name.replace(/[&]/g, '\\$&')}"`), name);
        }
        assert.match(tree, /heading "Playback" \[level=3\]/);
        const focusedClass = () => page.evaluate(() => {
          const root = document.getElementById('theater-everywhere-ui')!.shadowRoot!;
          return root.activeElement?.className ?? '';
        });
        const order = [await focusedClass()];
        for (let step = 0; step < 3; step++) {
          await page.keyboard.press('Tab');
          order.push(await focusedClass());
        }
        assert.deepEqual(order, ['te-dialog-close', 'te-dialog-body', 'te-dialog-btn te-dialog-btn-secondary', 'te-dialog-close']);
        await page.keyboard.press('Escape');
        await dialog.waitFor({ state: 'detached' });
        assert.equal(await focusedClass(), 'theater-control-btn player-settings-btn');

        // The Settings button asks for the Shortcuts tab, then gives the keyboard back to the player.
        await page.keyboard.press('h');
        await page.getByRole('button', { name: 'Customize shortcuts' }).click();
        await dialog.waitFor({ state: 'detached' });
        assert.deepEqual(await page.evaluate(() => (window as unknown as { sentMessages: object[] }).sentMessages.at(-1)),
          { action: 'open-options-page', section: 'shortcuts' });
      });
    });
  });
}
