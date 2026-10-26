import assert from 'node:assert/strict';
import { it } from 'node:test';

import { chromium, firefox, type Page } from 'playwright';

import { bundleModules } from '../test-utils/player-boot';
import { readStylesheet } from '../test-utils/styles';
import { sharedTestBrowser } from '../test-utils/test-browser';
import { testEngines } from '../test-utils/test-engines';

const BUNDLE = bundleModules(["export { showAutoTheaterNotice } from './ui/auto-theater-notice'; export { setAutoTheaterScrimEnabledForTests } from './ui/auto-theater-scrim'; export { setPlayerUiCss } from './ui/root';"], 'ScrimTest');
const CSS = readStylesheet(new URL('./shadow.css', import.meta.url));

declare global {
  interface Window {
    ScrimTest: {
      showAutoTheaterNotice(paint: (element: HTMLElement) => void, cancel: () => void, remainingMs: () => number, ringTurn: undefined,
        scrim: { video(): HTMLVideoElement | null; theaterActive(): boolean }): () => void;
      setPlayerUiCss(css: string): void;
      setAutoTheaterScrimEnabledForTests(enabled: boolean): void;
    };
    scrimHide: () => void;
    scrimTheater: boolean;
    cancelled: number;
  }
}

/** A loading page: skeleton content around a video box at (100, 80), 320x180. */
async function mountScrim(page: Page): Promise<void> {
  await page.addInitScript('window.__name = target => target;');
  await page.goto('about:blank');
  await page.setContent('<body style="margin:0;height:2000px"><div id="skeleton" style="height:600px;background:#555"></div>'
    + '<video id="v" style="position:absolute;left:100px;top:80px;width:320px;height:180px"></video></body>');
  await page.addScriptTag({ content: BUNDLE });
  await page.evaluate(css => {
    window.ScrimTest.setAutoTheaterScrimEnabledForTests(true);
    window.ScrimTest.setPlayerUiCss(css);
    window.scrimTheater = false;
    window.cancelled = 0;
    const video = document.getElementById('v') as HTMLVideoElement;
    window.scrimHide = window.ScrimTest.showAutoTheaterNotice(() => {}, () => { window.cancelled++; }, () => 3000, undefined,
      { video: () => video, theaterActive: () => window.scrimTheater });
  }, CSS);
}

const scrimState = (page: Page) => page.evaluate(() => {
  const root = document.getElementById('theater-everywhere-ui')!.shadowRoot!;
  const scrim = root.querySelector<HTMLElement>('.theater-auto-scrim');
  if (!scrim) return null;
  const style = getComputedStyle(scrim);
  const notice = root.querySelector('.theater-auto-notice');
  return {
    ariaHidden: scrim.getAttribute('aria-hidden'), pointerEvents: style.pointerEvents, leaving: scrim.classList.contains('leaving'),
    clip: scrim.style.clipPath, belowNotice: Boolean(notice && scrim.compareDocumentPosition(notice) & Node.DOCUMENT_POSITION_FOLLOWING),
    zScrim: Number(style.zIndex), zNotice: notice ? Number(getComputedStyle(notice).zIndex) : 0
  };
});

const gone = (page: Page) => page.waitForFunction(() =>
  !document.getElementById('theater-everywhere-ui')!.shadowRoot!.querySelector('.theater-auto-scrim'), undefined, { timeout: 3000 });

for (const engine of testEngines()) {
  const shared = sharedTestBrowser(({ chromium, firefox })[engine]);
  it(`${engine}: the scrim dims the page around the video with the notice, never intercepts input, and fades out on cancel`, { timeout: 40_000 }, async t => {
    const page = await (await shared.newContext(t)).newPage();
    await mountScrim(page);
    const shown = (await scrimState(page))!;
    assert.equal(shown.ariaHidden, 'true');
    assert.equal(shown.pointerEvents, 'none');
    assert.ok(shown.belowNotice && shown.zScrim < shown.zNotice, 'the notice paints above the scrim');
    assert.match(shown.clip, /polygon/);
    assert.match(shown.clip, /100px 80px/, 'the cut-out is the video box');
    assert.match(shown.clip, /420px 260px/);
    // Input falls through to the host page; the notice itself still takes the click.
    assert.equal(await page.evaluate(() => document.elementFromPoint(600, 400)?.id || document.elementFromPoint(600, 400)?.tagName), 'skeleton');
    await page.locator('#theater-everywhere-ui .theater-auto-notice').click();
    assert.equal(await page.evaluate(() => window.cancelled), 1);

    // The cut-out follows the video's box without polling.
    await page.evaluate(() => { document.getElementById('v')!.style.width = '500px'; });
    await page.waitForFunction(() => document.getElementById('theater-everywhere-ui')!.shadowRoot!.querySelector<HTMLElement>('.theater-auto-scrim')!.style.clipPath.includes('600px 260px'));

    await page.evaluate(() => { window.scrimHide(); window.scrimHide(); });
    assert.equal((await scrimState(page))?.leaving ?? true, true, 'cancel fades the scrim out instead of cutting it');
    await gone(page);
    assert.equal(await page.evaluate(() => document.getElementById('theater-everywhere-ui')!.shadowRoot!.querySelectorAll('.theater-auto-notice').length), 0);
  });

  it(`${engine}: the scrim is dropped at once when theater opens or motion is reduced, and is not left behind`, { timeout: 40_000 }, async t => {
    const page = await (await shared.newContext(t)).newPage();
    const present = () => page.evaluate(() => Boolean(document.getElementById('theater-everywhere-ui')!.shadowRoot!.querySelector('.theater-auto-scrim')));

    await mountScrim(page);
    // Entry: the intent hides the notice, then theater opens in the same task.
    await page.evaluate(() => { window.scrimHide(); window.scrimTheater = true; });
    assert.equal(await present(), false, 'no fade over the theater video, so nothing is darkened twice');

    await mountScrim(page);
    await page.evaluate(() => { document.documentElement.dataset.motion = 'reduced'; window.scrimHide(); });
    assert.equal(await present(), false, 'reduced motion removes the scrim without a fade');
  });
}
