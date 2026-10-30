import assert from 'node:assert/strict';
import { it } from 'node:test';

import { chromium, firefox } from 'playwright';

import { readStylesheet } from '../../test-utils/styles';
import { sharedTestBrowser } from '../../test-utils/test-browser';
import { testEngines } from '../../test-utils/test-engines';

const PRESENTATION = readStylesheet(new URL('./presentation.css', import.meta.url));

for (const engine of testEngines()) {
  const shared = sharedTestBrowser(({ chromium, firefox })[engine]);
  it(`Bilibili.tv ${engine} hides its own subtitle layers only in theater, while hidden, with the integration on`, { timeout: 60_000 }, async t => {
    const page = await (await shared.newContext(t)).newPage();
    await page.route('https://www.bilibili.tv/**', route => route.fulfill({ contentType: 'text/html', body: `
      <div class="bstar-player"><div id="bilibiliPlayer"><div class="player-mobile-video-wrap"><video></video></div>
      <div class="player-mobile-ass-subtitle">host ass</div><div class="player-mobile-subtitle">host json</div></div></div>` }));
    await page.goto('https://www.bilibili.tv/en/play/1053337/11371243');
    await page.addStyleTag({ content: PRESENTATION });
    const layers = (state: { theater: boolean; hidden: boolean; off: boolean }) => page.evaluate(({ theater, hidden, off }) => {
      const root = document.documentElement;
      root.classList.toggle('theater-everywhere-html-active', theater);
      root.toggleAttribute('data-te-bilibili-intl-captions-hidden', hidden);
      root.toggleAttribute('data-te-bilibili-intl-integration-off', off);
      return ['.player-mobile-ass-subtitle', '.player-mobile-subtitle'].map(selector => getComputedStyle(document.querySelector(selector)!).display);
    }, state);
    assert.deepEqual(await layers({ theater: true, hidden: true, off: false }), ['none', 'none']);
    assert.deepEqual(await layers({ theater: false, hidden: true, off: false }), ['block', 'block'], 'leaving theater shows them');
    assert.deepEqual(await layers({ theater: true, hidden: false, off: false }), ['block', 'block'], 'a host fallback shows them');
    assert.deepEqual(await layers({ theater: true, hidden: true, off: true }), ['block', 'block'], 'RTE off shows them');
  });
}
