import assert from 'node:assert/strict';
import { test } from 'node:test';

import { chromium, firefox } from 'playwright';

import deCatalog from '../_locales/de/messages.json';
import { installChromeStub } from '../src/test-utils/chrome-stub';
import { bundleModules, playerStylesheets } from '../src/test-utils/player-boot';
import { sharedTestBrowser } from '../src/test-utils/test-browser';
import { testEngines } from '../src/test-utils/test-engines';

type StageApi = typeof import('../.storybook/hud-story') & typeof import('../.storybook/player-stage')
  & typeof import('../.storybook/notice-story') & typeof import('../.storybook/stage-owner')
  & typeof import('../src/ui/root') & typeof import('../src/i18n-runtime');
declare global { interface Window { StoryStages: StageApi } }
const bundle = bundleModules([
  "export * from '../.storybook/hud-story';",
  "export * from '../.storybook/player-stage';",
  "export * from '../.storybook/notice-story';",
  "export * from '../.storybook/stage-owner';",
  "export { setPlayerUiCss, peekPlayerUiRoot } from './ui/root';",
  "export { languageRuntime } from './i18n-runtime';"
], 'StoryStages');

for (const engine of testEngines()) {
  const browser = sharedTestBrowser({ chromium, firefox }[engine]);
  test(`Storybook stage ownership across navigation, replay and stale callbacks (${engine})`, async t => {
    const context = await browser.newContext(t);
    const page = await context.newPage();
    await page.setContent('<body></body>');
    await page.addScriptTag({ content: 'window.__name = fn => fn;' });
    await installChromeStub(page, { sync: { reduceMotion: 'off' } });
    await page.evaluate(catalog => { Object.assign(chrome.runtime, { sendMessage: async () => catalog }); }, deCatalog);
    await page.addScriptTag({ content: bundle });
    await page.evaluate(css => window.StoryStages.setPlayerUiCss(css), playerStylesheets().ui);
    const result = await page.evaluate(async () => {
      const api = window.StoryStages;
      const args = { phase: 'steady' as const, live: false };
      api.renderHud(args, h => h.triggerPlaybackIndicator('play'), {});
      const first = api.stage();
      const frame = window.__storyFrame!;
      api.renderPlayerBar(scope => {
        scope.listen(document, 'storybook-probe', () => { listenerCalls += 1; });
        return [document.createElement('button')];
      });
      let listenerCalls = 0;
      const hudDisposed = first.disposed && first.clock.pending === 0 && first.session.element === null;
      const barHasNoFrame = !window.__storyFrame;
      api.renderNotice({ remainingMs: 4500, ringTurn: 'uniform', progress: 0.5 });
      document.dispatchEvent(new Event('storybook-probe'));
      const noticeRun = api.run();
      api.renderHud(args, h => h.syncContentTitle({ title: 'Title', subtitle: null }), {});
      const titleStage = api.stage();
      const oldTitle = api.playerUiRoot().querySelector('.theater-everywhere-title-hud')!;
      api.renderPlayerBar(() => [document.createElement('button')]);
      noticeRun.elapse(5000);
      first.advance(10000);
      const staleFrameCount = frame(0.9);
      const retired = titleStage.disposed && !oldTitle.isConnected && !api.playerUiRoot().querySelector('.theater-auto-notice');
      // Repeated args/global replacement always builds fresh session and clock owners.
      let replays = true;
      for (const phase of ['leaving', 'entering', 'steady', 'entering'] as const) {
        api.renderHud({ ...args, phase }, h => h.triggerPlaybackIndicator('pause'), {});
        const before = api.stage();
        await api.languageRuntime.set('de');
        api.renderHud(args, h => h.triggerPlaybackIndicator('play'), {});
        replays &&= before.disposed && api.playerUiRoot().host.getAttribute('lang') === 'de' && before.clock.pending === 0 && api.stage() !== before;
      }
      api.disposeStage();
      api.disposeStage();
      return { hudDisposed, barHasNoFrame, listenerCalls, staleFrameCount, retired, replays, noRoot: api.peekPlayerUiRoot() === null };
    });
    assert.deepEqual(result, { hudDisposed: true, barHasNoFrame: true, listenerCalls: 0, staleFrameCount: 0, retired: true, replays: true, noRoot: true });
  });
}
