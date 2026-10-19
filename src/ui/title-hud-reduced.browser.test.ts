import { testEngines } from '../test-utils/test-engines';
import assert from 'node:assert/strict';
import { it } from 'node:test';
import type { Locator, Page } from 'playwright';
import { emitStorageChange } from '../test-utils/chrome-stub';
import { bootPlayer, enterTheater } from '../test-utils/player-boot';
import { canvasVideoFixture, serveFixture } from '../test-utils/video-fixtures';
import { ownTestBrowser } from '../test-utils/test-browser';

const TITLE = 'A Remarkably Long Documentary About Mountain Weather Systems, Part 12 - Summit Day';
const FIXTURE = canvasVideoFixture({ title: TITLE });

const style = (hud: Locator, selector: string, property: string) =>
  hud.evaluate((el, [sel, prop]) => getComputedStyle(el.querySelector(sel)!).getPropertyValue(prop), [selector, property]);

const titleFocused = (page: Page, visibly = false) => page.evaluate(visible => {
  const title = document.querySelector('#theater-everywhere-ui')!.shadowRoot!.querySelector('.theater-everywhere-title-hud')!;
  return title.getRootNode() instanceof ShadowRoot && (title.getRootNode() as ShadowRoot).activeElement === title && (!visible || title.matches(':focus-visible'));
}, visibly);

async function boot(page: Page, dir: 'ltr' | 'rtl'): Promise<void> {
  await serveFixture(page, FIXTURE, 'http://title-hud.test/');
  await bootPlayer(page, { settings: { keepControlsVisible: true, reduceMotion: 'on' } });
  await page.waitForFunction(() => { const v = document.querySelector('video'); return Boolean(v && v.readyState >= 2 && !v.paused); });
  await enterTheater(page);
  await page.locator('.theater-everywhere-title-hud.marquee').waitFor();
  await page.evaluate(d => document.querySelector('#theater-everywhere-ui')!.shadowRoot!.querySelector('.theater-everywhere-title-hud')!.setAttribute('dir', d), dir);
}

for (const engine of testEngines()) for (const dir of ['ltr', 'rtl'] as const) {
  it(`${engine}/${dir}: reduced-motion title keeps head and tail, reveals in full, and follows the setting live`, { timeout: 60_000 }, async t => {
    const browser = await (await import('playwright'))[engine].launch({ headless: true });
    ownTestBrowser(t, browser);
    const page = await browser.newPage({ viewport: { width: 700, height: 600 } });
    await boot(page, dir);
    const hud = page.locator('.theater-everywhere-title-hud');

    // Resting: static head…tail; the real text stays in the accessibility tree.
    assert.equal(await style(hud, '.theater-title-hud-smart', 'display'), 'flex');
    assert.equal(await style(hud, '.theater-title-hud-track', 'animation-name'), 'none');
    const rest = await hud.evaluate(el => {
      const head = el.querySelector<HTMLElement>('.theater-title-hud-head')!;
      const tail = el.querySelector<HTMLElement>('.theater-title-hud-tail')!;
      const box = el.getBoundingClientRect(), tailBox = tail.getBoundingClientRect();
      return { truncated: head.scrollWidth > head.clientWidth, tail: tail.textContent, inside: tailBox.left >= box.left && tailBox.right <= box.right,
        label: el.querySelector('.theater-title-hud-text')!.textContent, tab: el.getAttribute('tabindex'), title: el.getAttribute('title') };
    });
    assert.equal(rest.truncated, true);
    assert.ok(rest.tail && TITLE.endsWith(rest.tail.trim()) && rest.inside, JSON.stringify(rest));
    assert.equal(rest.label, TITLE);
    assert.equal(rest.tab, '0');
    assert.equal(rest.title, null);
    const restHeight = (await hud.boundingBox())!.height;

    // Keyboard focus reveals it; the first Escape closes the reveal and theater stays open.
    // Backwards from the page start, focus wraps to the last item: the title (Chromium first leaves the page).
    for (let i = 0; i < 6 && !(await titleFocused(page)); i++) await page.keyboard.press('Shift+Tab');
    assert.equal(await titleFocused(page, true), true, 'Shift+Tab reaches the title');
    assert.equal(await style(hud, '.theater-title-hud-smart', 'display'), 'none');
    await page.keyboard.press('Escape');
    assert.equal(await style(hud, '.theater-title-hud-smart', 'display'), 'flex');
    assert.equal(await page.locator('.theater-controls-wrapper').count(), 1, 'theater was not exited');

    // Hover reveals the whole title on wrapped lines, without motion.
    await hud.hover();
    assert.equal(await style(hud, '.theater-title-hud-smart', 'display'), 'none');
    // Poll the settled layout: the wrapped height lands a frame after :hover applies.
    await page.waitForFunction(rest => {
      const title = document.querySelector('#theater-everywhere-ui')!.shadowRoot!.querySelector('.theater-everywhere-title-hud')!;
      return title.getBoundingClientRect().height > rest * 1.4;
    }, restHeight, { timeout: 5000 });
    assert.equal(await style(hud, '.theater-title-hud-text-clone', 'display'), 'none', 'the scroll clone never shows twice');
    await page.mouse.move(5, 500);
    assert.equal(await style(hud, '.theater-title-hud-smart', 'display'), 'flex');

    // Turning the setting off restores the scrolling title live.
    await emitStorageChange(page, { reduceMotion: { newValue: 'off' } });
    await page.waitForFunction(() => !document.querySelector('#theater-everywhere-ui')!.shadowRoot!.querySelector('.theater-everywhere-title-hud')!.hasAttribute('tabindex'));
    assert.equal(await style(hud, '.theater-title-hud-track', 'animation-name'), dir === 'rtl' ? 'theater-title-marquee-rtl' : 'theater-title-marquee');
    assert.equal(await style(hud, '.theater-title-hud-smart', 'display'), 'none');
    assert.equal(await hud.getAttribute('title'), TITLE);
  });
}
