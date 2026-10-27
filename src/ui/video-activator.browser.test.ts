import { testEngines } from '../test-utils/test-engines';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { it, type TestContext } from 'node:test';
import { chromium, firefox, type Page } from 'playwright';
import { installChromeStub } from '../test-utils/chrome-stub';
import { bundlePlayer, playerStylesheets } from '../test-utils/player-boot';
import { sharedTestBrowser } from '../test-utils/test-browser';

const BUNDLE = bundlePlayer([
  "export { setActivatorDynamicPlacementForTests } from './ui/video-activator';",
  "export { showAutoTheaterNotice } from './ui/auto-theater-notice';"
]);
const MEDIA = `data:video/webm;base64,${readFileSync(new URL('../../test/fixtures/vod.webm', import.meta.url)).toString('base64')}`;

declare global {
  interface Window {
    TheaterTest: {
      bootstrapPlayerRuntime(): void;
      setActivatorDynamicPlacementForTests(enabled: boolean): void;
      setPlayerUiCss(css: string): void;
      showAutoTheaterNotice(paint: (element: HTMLElement) => void, cancel: () => void, remainingMs: () => number): () => void;
    };
    storageListeners: Array<(changes: Record<string, { newValue?: unknown }>, area: string) => void>;
    pointeroverListeners: number;
    activatorPointerListeners: number;
    activatorPointerRegistrations: number;
    /** Ages the page: added to performance.now(), which the launcher reads as time since load. */
    perfOffset?: number;
  }
}

const PAGE = `<style>
  body { margin: 0; }
  #player { position: absolute; left: 100px; top: 80px; width: 640px; height: 360px; background: #111; }
  video { display: block; width: 640px; height: 360px; }
  .ui { position: absolute; width: 48px; height: 48px; }
  #small { position: absolute; left: 800px; top: 80px; width: 120px; height: 68px; }
</style>
<div id="player"><video id="main"></video></div>
<video id="small"></video>
<p style="position:absolute;top:600px">Outside</p>`;

async function boot(page: Page, stored: Record<string, unknown> = {}, html = PAGE, host = 'activator.test', dynamicPlacement = false): Promise<void> {
  await page.addInitScript(`window.__name = target => target; window.storageListeners = []; window.pointeroverListeners = 0;
    window.activatorPointerListeners = 0; window.activatorPointerRegistrations = 0;
    const perfNow = performance.now.bind(performance);
    performance.now = () => perfNow() + (window.perfOffset || 0);
    const add = EventTarget.prototype.addEventListener;
    const remove = EventTarget.prototype.removeEventListener;
    EventTarget.prototype.addEventListener = function (type, ...rest) { if (type === 'pointerover') window.pointeroverListeners++;
      if (this === document && (type === 'pointermove' || type === 'pointerover')) {
        window.activatorPointerListeners++; window.activatorPointerRegistrations++;
      }
      return add.call(this, type, ...rest); };
    EventTarget.prototype.removeEventListener = function (type, ...rest) {
      if (this === document && (type === 'pointermove' || type === 'pointerover')) window.activatorPointerListeners--;
      return remove.call(this, type, ...rest);
    };`);
  await page.route(`https://${host}/**`, route => route.fulfill({ contentType: 'text/html', body: html }));
  await page.goto(`https://${host}/`);
  await installChromeStub(page, { sync: { keepControlsVisible: true, videoActivator: true, ...stored }, local: {} });
  // The scenarios fire storage changes at the registered listeners directly.
  await page.evaluate(`(() => {
    const addListener = chrome.storage.onChanged.addListener;
    chrome.storage.onChanged.addListener = fn => { window.storageListeners.push(fn); addListener(fn); };
    chrome.runtime.onMessage = { addListener() {} };
  })()`);
  await page.evaluate(media => {
    for (const video of document.querySelectorAll('video')) video.src = media;
  }, MEDIA);
  await page.waitForFunction(() => Array.from(document.querySelectorAll('video')).every(video => video.readyState >= 1));
  await page.addScriptTag({ content: BUNDLE });
  await page.evaluate(({ css, dynamicPlacement }) => {
    if (dynamicPlacement) window.TheaterTest.setActivatorDynamicPlacementForTests(true);
    window.TheaterTest.setPlayerUiCss(css);
    window.TheaterTest.bootstrapPlayerRuntime();
  }, { css: playerStylesheets().ui, dynamicPlacement });
  await page.waitForFunction(() => document.documentElement.hasAttribute('data-theater-everywhere-entry-shortcuts'));
}

/** The launcher's box in viewport coordinates, or null while it is not in the extension's shadow root. */
async function launcher(page: Page): Promise<{ x: number; y: number; width: number; label: string | null } | null> {
  return page.evaluate(() => {
    const button = document.getElementById('theater-everywhere-ui')?.shadowRoot?.querySelector('.theater-video-activator');
    if (!button) return null;
    // Layout position: the entrance animation scales the painted box.
    const box = button as HTMLElement;
    return { x: box.offsetLeft, y: box.offsetTop, width: box.offsetWidth, label: button.getAttribute('aria-label') };
  });
}

async function hover(page: Page, x: number, y: number): Promise<void> {
  await page.mouse.move(2, 590);
  await page.mouse.move(x, y);
}

for (const engine of testEngines()) {
  const shared = sharedTestBrowser(({ chromium, firefox })[engine]);
  const launch = async (t: TestContext, {
    stored, html = PAGE, host = 'activator.test', freezeClock = false, controlClock = false, pageAge = 60_000, dynamicPlacement = false
  }: { stored?: Record<string, unknown>; html?: string; host?: string; freezeClock?: boolean; controlClock?: boolean; pageAge?: number; dynamicPlacement?: boolean } = {}) => {
    const context = await shared.newContext(t, { viewport: { width: 1000, height: 700 } });
    const page = await context.newPage();
    page.setDefaultTimeout(6_000);
    // Most scenarios predate the five-second load window; fresh-page tests pass a negative pageAge.
    await page.addInitScript(`window.perfOffset = ${pageAge};`);
    if (freezeClock || controlClock) {
      // Install before runtime startup so no native timer/frame survives the switch.
      const time = new Date('2026-01-01T00:00:00Z');
      await page.clock.install({ time });
      // install() alone still advances with wall time between Playwright commands.
      if (freezeClock) await page.clock.pauseAt(new Date(time.getTime() + 60_000));
    }
    await boot(page, stored, html, host, dynamicPlacement);
    return page;
  };

  it(`${engine}: activator appears one third down the left edge on hover and leaves with the pointer`, { timeout: 40_000 }, async t => {
    const page = await launch(t);
    assert.equal(await launcher(page), null);
    await hover(page, 400, 260);
    await page.waitForFunction(() => document.getElementById('theater-everywhere-ui')?.shadowRoot?.querySelector('.theater-video-activator'));
    const box = (await launcher(page))!;
    assert.equal(box.label, 'Enter theater mode');
    assert.equal(box.x, 100 + 12);
    assert.equal(box.y, 80 + 120, 'one third of the 360px video height from its top');
    await page.mouse.move(400, 600);
    await page.waitForFunction(() => !document.getElementById('theater-everywhere-ui')?.shadowRoot?.querySelector('.theater-video-activator'));
  });

  it(`${engine}: fixed left-third ignores overlays and native controls without occlusion probes`, { timeout: 40_000 }, async t => {
    const page = await launch(t);
    await page.evaluate(() => {
      // Any occlusion sampling would fail this test, even if its result were ignored.
      document.elementsFromPoint = () => { throw new Error('fixed placement must not sample occlusion'); };
      ShadowRoot.prototype.elementsFromPoint = () => { throw new Error('fixed placement must not sample shadow occlusion'); };
      const overlay = document.createElement('button');
      overlay.textContent = 'Host overlay';
      overlay.style.cssText = 'position:absolute;left:0;top:0;width:180px;height:64px';
      document.getElementById('player')!.append(overlay);
    });
    const button = page.locator('#theater-everywhere-ui .theater-video-activator');
    for (const controls of [false, true]) {
      await page.evaluate(controls => { (document.getElementById('main') as HTMLVideoElement).controls = controls; }, controls);
      await hover(page, 400, 260);
      await button.waitFor();
      assert.deepEqual(await launcher(page), { x: 112, y: 200, width: 40, label: 'Enter theater mode' });
      if (engine === 'chromium' && controls) {
        await button.evaluate(el => Promise.all(el.getAnimations().map(animation => animation.finished)));
        await page.screenshot({ path: '/tmp/tme-launcher-fixed-left-third-chromium.png' });
      }
      await page.mouse.move(400, 600);
      await button.waitFor({ state: 'detached' });
    }
  });

  it(`${engine}: activator avoids page UI and covered corners, and appears nowhere when all are covered`, { timeout: 40_000 }, async t => {
    const page = await launch(t, { dynamicPlacement: true });
    await page.evaluate(() => {
      const share = document.createElement('button');
      share.className = 'ui'; share.id = 'share'; share.textContent = 'Share';
      share.style.cssText = 'right:0;top:0';
      document.getElementById('player')!.append(share);
    });
    await hover(page, 400, 260);
    await page.waitForFunction(() => document.getElementById('theater-everywhere-ui')?.shadowRoot?.querySelector('.theater-video-activator'));
    assert.equal((await launcher(page))!.x, 100 + 12, 'top-right is occupied, so the top-left corner is used');
    // A transparent click-catcher over the whole player is not page UI.
    await page.evaluate(() => {
      const shield = document.createElement('div');
      shield.style.cssText = 'position:absolute;inset:0';
      document.getElementById('player')!.append(shield);
    });
    await hover(page, 420, 280);
    await page.waitForFunction(() => document.getElementById('theater-everywhere-ui')?.shadowRoot?.querySelector('.theater-video-activator'));
    // Cover every remaining slot, then leave so the next appearance probes again.
    await page.evaluate(() => {
      for (const css of ['left:0;top:0', 'left:0;bottom:0', 'right:0;bottom:0', 'left:296px;top:96px', 'left:296px;top:216px']) {
        const ui = document.createElement('a');
        ui.href = '#'; ui.className = 'ui'; ui.style.cssText = css; ui.textContent = 'x';
        document.getElementById('player')!.append(ui);
      }
    });
    await hover(page, 450, 300);
    // Wait for the pointer frame; no candidate can produce a launcher.
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await launcher(page), null);
  });

  it(`${engine}: centre slots avoid occupied corners and stay frozen for each appearance`, { timeout: 40_000 }, async t => {
    const page = await launch(t, { dynamicPlacement: true });
    await page.evaluate(() => {
      for (const css of ['left:0;top:0', 'right:0;top:0', 'left:0;bottom:0', 'right:0;bottom:0']) {
        const ui = document.createElement('button');
        ui.className = 'ui'; ui.style.cssText = css; ui.textContent = 'Host';
        document.getElementById('player')!.append(ui);
      }
    });
    await hover(page, 400, 260);
    const button = page.locator('#theater-everywhere-ui .theater-video-activator');
    await button.waitFor();
    assert.deepEqual(await launcher(page), { x: 400, y: 180, width: 40, label: 'Enter theater mode' });
    const original = await button.elementHandle();
    await button.evaluate(async el => { await Promise.all(el.getAnimations().map(animation => animation.finished)); });
    await page.screenshot({ path: `/tmp/tme-84-${engine}-top-center.png` });
    await page.evaluate(() => {
      const ui = document.createElement('button');
      ui.className = 'ui'; ui.style.cssText = 'left:296px;top:96px'; ui.textContent = 'Host';
      document.getElementById('player')!.append(ui);
    });
    await page.mouse.move(450, 270);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await original!.evaluate(el => el.isConnected), true);
    assert.equal((await launcher(page))!.y, 180, 'occlusion changes do not move a visible launcher');
    await page.mouse.move(400, 600);
    await button.waitFor({ state: 'detached' });
    await hover(page, 400, 260);
    await button.waitFor();
    assert.deepEqual(await launcher(page), { x: 400, y: 300, width: 40, label: 'Enter theater mode' });
    await button.evaluate(async el => { await Promise.all(el.getAnimations().map(animation => animation.finished)); });
    await page.screenshot({ path: `/tmp/tme-84-${engine}-bottom-center.png` });
    await button.click();
    await page.waitForSelector('video[data-theater-everywhere]');
    assert.equal(await launcher(page), null);
  });

  it(`${engine}: previews, tiny videos and extension UI never get an activator`, { timeout: 40_000 }, async t => {
    const page = await launch(t, { controlClock: true });
    await hover(page, 860, 114);
    await page.clock.runFor(150);
    assert.equal(await launcher(page), null, 'a 120x68 video is not a player');
    await page.evaluate(() => {
      const main = document.getElementById('main') as HTMLVideoElement;
      main.muted = true; main.loop = true;
    });
    await hover(page, 400, 260);
    await page.clock.runFor(150);
    assert.equal(await launcher(page), null, 'muted looping video is a preview');
    await page.evaluate(() => { const main = document.getElementById('main') as HTMLVideoElement; main.muted = false; main.loop = false; });
    // The native volumechange event rebinds pointer listeners asynchronously.
    // Send the positive follow-up pointer only after the player is eligible again.
    await page.waitForFunction(() => window.activatorPointerListeners === 2);
    await hover(page, 400, 270);
    await page.waitForFunction(() => document.getElementById('theater-everywhere-ui')?.shadowRoot?.querySelector('.theater-video-activator'));
    // Pointing at the extension's own interface hides it instead of re-evaluating the video beneath.
    await page.evaluate(() => {
      const hud = window.TheaterTest.showAutoTheaterNotice(() => {}, () => {}, () => 3000);
      (window as unknown as { hideNotice: () => void }).hideNotice = hud;
    });
    const notice = page.locator('#theater-everywhere-ui .theater-auto-notice');
    const noticeBox = (await notice.boundingBox())!;
    await page.mouse.move(noticeBox.x + noticeBox.width / 2, noticeBox.y + noticeBox.height / 2);
    await page.waitForFunction(() => !document.getElementById('theater-everywhere-ui')?.shadowRoot?.querySelector('.theater-video-activator'));
  });

  it(`${engine}: click opens theater for the hovered video once and the launcher stays out of theater`, { timeout: 40_000 }, async t => {
    const page = await launch(t, { controlClock: true });
    await hover(page, 400, 260);
    const box = await (async () => { await page.waitForFunction(() => document.getElementById('theater-everywhere-ui')?.shadowRoot?.querySelector('.theater-video-activator')); return (await launcher(page))!; })();
    await page.mouse.click(box.x + 20, box.y + 20);
    await page.waitForSelector('video[data-theater-everywhere]');
    assert.equal(await page.locator('video[data-theater-everywhere]').evaluate(video => video.id), 'main');
    assert.equal(await launcher(page), null);
    await page.mouse.move(300, 300);
    await page.mouse.move(500, 320);
    await page.clock.runFor(150);
    assert.equal(await launcher(page), null, 'no launcher while theater is open');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('video[data-theater-everywhere]'));
    await hover(page, 400, 260);
    await page.waitForFunction(() => document.getElementById('theater-everywhere-ui')?.shadowRoot?.querySelector('.theater-video-activator'));
  });

  it(`${engine}: keyboard focus and Escape`, { timeout: 40_000 }, async t => {
    const page = await launch(t);
    await hover(page, 400, 260);
    await page.waitForFunction(() => document.getElementById('theater-everywhere-ui')?.shadowRoot?.querySelector('.theater-video-activator'));
    await page.evaluate(() => (document.getElementById('theater-everywhere-ui')!.shadowRoot!.querySelector('.theater-video-activator') as HTMLElement).focus());
    await page.keyboard.press('Escape');
    assert.equal(await launcher(page), null);
    await hover(page, 420, 280);
    await page.waitForFunction(() => document.getElementById('theater-everywhere-ui')?.shadowRoot?.querySelector('.theater-video-activator'));
    await page.evaluate(() => (document.getElementById('theater-everywhere-ui')!.shadowRoot!.querySelector('.theater-video-activator') as HTMLElement).focus());
    await page.keyboard.press('Enter');
    await page.waitForSelector('video[data-theater-everywhere]');
  });

  it(`${engine}: replacing or removing the video, and navigating, clear the launcher`, { timeout: 40_000 }, async t => {
    const page = await launch(t);
    await hover(page, 400, 260);
    await page.waitForFunction(() => document.getElementById('theater-everywhere-ui')?.shadowRoot?.querySelector('.theater-video-activator'));
    await page.evaluate(() => document.getElementById('main')!.remove());
    await page.waitForFunction(() => !document.getElementById('theater-everywhere-ui')?.shadowRoot?.querySelector('.theater-video-activator'));
  });

  it(`${engine}: missing and invalid launcher preferences install no pointer listeners`, { timeout: 40_000 }, async t => {
    const page = await launch(t, { stored: { videoActivator: undefined } });
    assert.equal(await page.evaluate(() => window.activatorPointerRegistrations), 0);
    await page.evaluate(() => { for (const listener of window.storageListeners) listener({ videoActivator: { newValue: 'true' } }, 'sync'); });
    assert.equal(await page.evaluate(() => window.activatorPointerRegistrations), 0);
    await hover(page, 400, 260);
    assert.equal(await launcher(page), null);
  });

  it(`${engine}: the setting off installs no listener and no DOM, and applies live`, { timeout: 40_000 }, async t => {
    const page = await launch(t, { stored: { videoActivator: false }, controlClock: true });
    await page.waitForFunction(() => document.documentElement.hasAttribute('data-theater-everywhere-entry-shortcuts'));
    const before = await page.evaluate(() => window.pointeroverListeners);
    assert.equal(await page.evaluate(() => window.activatorPointerRegistrations), 0);
    await hover(page, 400, 260);
    await page.clock.runFor(150);
    assert.equal(await launcher(page), null);
    await page.evaluate(() => { for (const listener of window.storageListeners) listener({ videoActivator: { newValue: true } }, 'sync'); });
    await page.waitForFunction(count => window.pointeroverListeners > count, before);
    await hover(page, 420, 280);
    await page.waitForFunction(() => document.getElementById('theater-everywhere-ui')?.shadowRoot?.querySelector('.theater-video-activator'));
    await page.evaluate(() => { for (const listener of window.storageListeners) listener({ videoActivator: { newValue: false } }, 'sync'); });
    await page.waitForFunction(() => !document.getElementById('theater-everywhere-ui')?.shadowRoot?.querySelector('.theater-video-activator'));
    assert.equal(await page.evaluate(() => window.activatorPointerListeners), 0);
  });

  it(`${engine}: approach shows before reaching the video, the zone passes page clicks, and leaving hides`, { timeout: 40_000 }, async t => {
    const page = await launch(t);
    await page.evaluate(() => {
      const link = document.createElement('button');
      link.id = 'nearby'; link.textContent = 'Page action';
      link.style.cssText = 'position:absolute;left:60px;top:230px;width:35px;height:40px';
      link.onclick = () => link.dataset.clicked = 'yes';
      document.body.append(link);
    });
    await hover(page, 80, 250); // 20px outside the video; its zone margin is 36px.
    await page.waitForFunction(() => document.getElementById('theater-everywhere-ui')?.shadowRoot?.querySelector('.theater-video-activator'));
    assert.equal((await launcher(page))!.x, 112);
    await page.mouse.click(80, 250);
    assert.equal(await page.locator('#nearby').getAttribute('data-clicked'), 'yes');
    await page.mouse.move(63, 250);
    await page.waitForFunction(() => !document.getElementById('theater-everywhere-ui')?.shadowRoot?.querySelector('.theater-video-activator'));
  });

  it(`${engine}: no pointer listeners without videos, outside the viewport, or with only previews`, { timeout: 40_000 }, async t => {
    const page = await launch(t, { html: '<body></body>' });
    assert.equal(await page.evaluate(() => window.activatorPointerRegistrations), 0);
    await page.evaluate(media => {
      const video = document.createElement('video'); video.id = 'added'; video.src = media;
      video.style.cssText = 'position:absolute;left:100px;top:900px;width:640px;height:360px';
      document.body.append(video);
    }, MEDIA);
    await page.waitForFunction(() => (document.getElementById('added') as HTMLVideoElement).readyState >= 1);
    assert.equal(await page.evaluate(() => window.activatorPointerRegistrations), 0);
    await page.evaluate(() => { document.getElementById('added')!.style.top = '80px'; });
    await page.waitForFunction(() => window.activatorPointerListeners === 2);
    await page.evaluate(() => {
      const video = document.getElementById('added') as HTMLVideoElement; video.muted = true; video.loop = true;
    });
    await page.waitForFunction(() => window.activatorPointerListeners === 0);
    await page.evaluate(() => document.getElementById('added')!.remove());
    assert.equal(await page.evaluate(() => window.activatorPointerListeners), 0);
  });

  it(`${engine}: overlapping approach zones select one nearest video and refresh after layout changes`, { timeout: 40_000 }, async t => {
    const page = await launch(t);
    await page.evaluate(media => {
      const video = document.createElement('video'); video.id = 'second'; video.src = media;
      video.style.cssText = 'position:absolute;left:780px;top:80px;width:640px;height:360px';
      document.body.append(video);
    }, MEDIA);
    await page.waitForFunction(() => (document.getElementById('second') as HTMLVideoElement).readyState >= 1);
    await hover(page, 750, 250);
    await page.waitForFunction(() => document.getElementById('theater-everywhere-ui')?.shadowRoot?.querySelector('.theater-video-activator'));
    assert.equal((await launcher(page))!.x, 112);
    await page.mouse.move(770, 250);
    await page.waitForFunction(() => (document.getElementById('theater-everywhere-ui')?.shadowRoot?.querySelector('.theater-video-activator') as HTMLElement)?.offsetLeft === 792);
    assert.equal(await page.locator('#theater-everywhere-ui .theater-video-activator').count(), 1);
    await page.evaluate(() => { document.getElementById('second')!.style.left = '1500px'; });
    await page.waitForFunction(() => (document.getElementById('theater-everywhere-ui')?.shadowRoot?.querySelector('.theater-video-activator') as HTMLElement)?.offsetLeft === 112);
    await page.evaluate(() => { document.getElementById('player')!.style.top = '900px'; });
    await page.waitForFunction(() => window.activatorPointerListeners === 0);
    assert.equal(await launcher(page), null);
  });

  it(`${engine}: approach keeps the 2.5s idle hide, focus exception, touch exclusion and Space activation`, { timeout: 40_000 }, async t => {
    const page = await launch(t, { freezeClock: true });
    await hover(page, 80, 250);
    const activityFrame = page.evaluate(() => new Promise<number>(resolve => requestAnimationFrame(() => resolve(performance.now()))));
    await page.clock.runFor(16); // Resolve the coalesced pointer on the first controlled frame.
    const elapsed = await page.evaluate(start => performance.now() - start, await activityFrame);
    assert.ok(await launcher(page));
    await page.clock.runFor(2499 - elapsed);
    assert.ok(await launcher(page), 'visible until the 2.5s idle deadline');
    await page.clock.runFor(1);
    assert.equal(await launcher(page), null);
    await page.mouse.move(81, 250);
    await page.clock.runFor(50);
    assert.ok(await launcher(page));
    const button = page.locator('#theater-everywhere-ui .theater-video-activator');
    await button.focus();
    const beforeLayout = await button.elementHandle();
    await page.evaluate(() => {
      (document.getElementById('main') as HTMLElement).style.width = '600px';
      // Native ResizeObserver delivery is independent of the fake clock. Invalidate
      // synchronously, then observe the remount before checking focus retention.
      window.dispatchEvent(new Event('resize'));
    });
    await page.clock.runFor(16);
    await page.waitForFunction(element => !element!.isConnected, beforeLayout);
    assert.equal(await page.locator('#theater-everywhere-ui .theater-video-activator').evaluate(button => button.getRootNode() instanceof ShadowRoot
      && (button.getRootNode() as ShadowRoot).activeElement === button), true, 'layout refresh retains focus');
    await page.clock.runFor(2501);
    assert.ok(await launcher(page), 'focus keeps it visible past idle');
    await page.keyboard.press('Escape');
    assert.equal(await launcher(page), null);
    await page.evaluate(() => {
      // Exercise a layout publication arriving after dismissal, as a delayed
      // ResizeObserver callback can: cached pointer work must not reopen it.
      window.dispatchEvent(new Event('resize'));
      document.dispatchEvent(new PointerEvent('pointermove', { pointerType: 'touch', clientX: 80, clientY: 250 }));
    });
    await page.clock.runFor(50);
    assert.equal(await launcher(page), null);
    await page.mouse.move(82, 250);
    await page.clock.runFor(50);
    await page.locator('#theater-everywhere-ui .theater-video-activator').focus();
    await page.keyboard.press('Space');
    await page.clock.runFor(100);
    assert.equal(await page.locator('video[data-theater-everywhere]').count(), 1);
    assert.equal(await page.evaluate(() => window.activatorPointerListeners), 0);
  });

  it(`${engine}: cached pointer movement has no layout reads or DOM queries and coalesces bursts`, { timeout: 40_000 }, async t => {
    const page = await launch(t);
    await hover(page, 80, 250);
    await page.waitForFunction(() => document.getElementById('theater-everywhere-ui')?.shadowRoot?.querySelector('.theater-video-activator'));
    const counts = await page.evaluate(async () => {
      // Let initial observer publications settle, using frames rather than a timing delay.
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      let reads = 0, queries = 0, frames = 0;
      const rect = Element.prototype.getBoundingClientRect;
      const query = Document.prototype.querySelectorAll;
      const raf = window.requestAnimationFrame;
      Element.prototype.getBoundingClientRect = function () { reads++; return rect.call(this); };
      Document.prototype.querySelectorAll = function (...args: [string]) { queries++; return query.apply(this, args); };
      window.requestAnimationFrame = callback => { frames++; return raf.call(window, callback); };
      for (let i = 0; i < 100; i++) document.dispatchEvent(new PointerEvent('pointermove', { clientX: 80, clientY: 240 + i % 20, pointerType: 'mouse' }));
      await new Promise<void>(resolve => raf.call(window, () => resolve()));
      Element.prototype.getBoundingClientRect = rect;
      Document.prototype.querySelectorAll = query;
      window.requestAnimationFrame = raf;
      return { reads, queries, frames };
    });
    assert.deepEqual(counts, { reads: 0, queries: 0, frames: 1 });
  });

  it(`${engine}: removal, navigation, hidden tabs and fullscreen release old pointer work`, { timeout: 40_000 }, async t => {
    const page = await launch(t);
    await hover(page, 80, 250);
    await page.waitForFunction(() => document.getElementById('theater-everywhere-ui')?.shadowRoot?.querySelector('.theater-video-activator'));
    await page.evaluate(() => window.dispatchEvent(new PopStateEvent('popstate')));
    assert.equal(await launcher(page), null);
    assert.equal(await page.evaluate(() => window.activatorPointerListeners), 2, 'one fresh pair, no accumulated listeners');
    await hover(page, 80, 250);
    await page.waitForFunction(() => document.getElementById('theater-everywhere-ui')?.shadowRoot?.querySelector('.theater-video-activator'));
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, value: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    assert.equal(await launcher(page), null);
    assert.equal(await page.evaluate(() => window.activatorPointerListeners), 0);
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, value: false });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.waitForFunction(() => window.activatorPointerListeners === 2);
    await page.evaluate(() => {
      Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: document.body });
      document.dispatchEvent(new Event('fullscreenchange'));
    });
    assert.equal(await page.evaluate(() => window.activatorPointerListeners), 0);
    await page.evaluate(() => {
      Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: null });
      document.dispatchEvent(new Event('fullscreenchange'));
      document.getElementById('main')!.remove();
    });
    await page.waitForFunction(() => window.activatorPointerListeners === 0);
    assert.equal(await launcher(page), null);
  });


  it(`${engine}: appearance freezes across chrome mutations; layout invalidation remounts`, { timeout: 40_000 }, async t => {
    const page = await launch(t, { dynamicPlacement: true });
    await hover(page, 400, 260);
    const button = page.locator('#theater-everywhere-ui .theater-video-activator');
    await button.waitFor();
    const original = await button.elementHandle();
    const position = await launcher(page);
    await page.evaluate(() => {
      const control = document.createElement('button');
      control.style.cssText = 'position:absolute;right:0;top:0;width:60px;height:60px';
      document.getElementById('player')!.append(control);
    });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.deepEqual(await launcher(page), position);
    assert.equal(await original!.evaluate(element => element.isConnected), true);
    await page.evaluate(() => { document.getElementById('player')!.style.left = '120px'; });
    await page.waitForFunction(() => (document.getElementById('theater-everywhere-ui')?.shadowRoot?.querySelector('.theater-video-activator') as HTMLElement)?.offsetLeft !== 688);
    assert.equal(await original!.evaluate(element => element.isConnected), false, 'hard layout change ends the appearance');
    await page.mouse.move(400, 600);
    await hover(page, 400, 260);
    await button.waitFor();
    assert.equal((await launcher(page))!.x, 132, 'the next appearance avoids the occupied corner');
  });

  /** The viewer presses the video and the page's handler starts it, like a host player would. */
  const viewerPlays = async (page: Page) => {
    await page.evaluate(() => {
      const video = document.getElementById('main') as HTMLVideoElement;
      video.muted = true;
      document.addEventListener('pointerdown', () => { void video.play(); }, { once: true });
    });
    await page.mouse.click(400, 262);
    await page.waitForFunction(() => !(document.getElementById('main') as HTMLVideoElement).paused);
    await page.clock.runFor(50);
  };

  it(`${engine}: after the viewer plays, the launcher lingers 3s regardless of the pointer, then hides`, { timeout: 40_000 }, async t => {
    const page = await launch(t, { freezeClock: true });
    await hover(page, 400, 260);
    await page.clock.runFor(50);
    await viewerPlays(page);
    await page.clock.runFor(2800);
    assert.ok(await launcher(page), 'still shown shortly before the 3s deadline');
    await page.mouse.move(410, 262);
    await page.clock.runFor(100);
    assert.ok(await launcher(page), 'pointer movement neither hides nor extends it');
    await page.clock.runFor(150);
    assert.equal(await launcher(page), null, 'hidden once the 3s have passed');
  });

  it(`${engine}: pause, replacement and navigation end the play linger without a stale hide`, { timeout: 40_000 }, async t => {
    const page = await launch(t, { freezeClock: true });
    await hover(page, 400, 260);
    await page.clock.runFor(50);
    await viewerPlays(page);
    await page.evaluate(() => (document.getElementById('main') as HTMLVideoElement).pause());
    await page.clock.runFor(50);
    await page.mouse.move(405, 262);
    await page.clock.runFor(2600);
    assert.equal(await launcher(page), null, 'after a pause the idle window, not the linger, applies');
    // Replacing the video mid-linger: the old deadline must not hide the new video's launcher.
    await hover(page, 405, 264);
    await viewerPlays(page);
    await page.evaluate(() => document.getElementById('main')!.replaceWith(Object.assign(document.createElement('video'),
      { id: 'main', src: document.getElementById('small')!.getAttribute('src')! })));
    await page.waitForFunction(() => (document.getElementById('main') as HTMLVideoElement).readyState >= 1);
    await page.clock.runFor(50);
    await hover(page, 400, 262);
    await page.clock.runFor(1500);
    await page.mouse.move(402, 262);
    await page.clock.runFor(1550); // Past the replaced video's 3s deadline, within the idle window.
    assert.ok(await launcher(page), 'the replaced video\'s deadline does not hide the new launcher');
    await viewerPlays(page);
    await page.evaluate(() => window.dispatchEvent(new PopStateEvent('popstate')));
    await page.clock.runFor(50);
    assert.equal(await launcher(page), null, 'navigation clears the lingering launcher');
  });

  it(`${engine}: YouTube toolbar placement, fallback, RTE gates and cleanup`, { timeout: 40_000 }, async t => {
    const html = PAGE.replace('id="player"', 'id="player" class="html5-video-player"') + `<style>
      /* Mirrors youtube.com: a flex-end, line-height:56px row of display:block 48x100% buttons whose colour is #eee. */
      .ytp-right-controls, .ytp-right-controls-left { position:absolute;right:0;bottom:0;height:40px;display:flex;align-items:flex-end;line-height:56px;color:#eee;background:#222; }
      .ytp-right-controls-left { position:static;background:none; }
      .ytp-button { display:block;width:48px;height:100%;padding:0;border:0;color:#eee;background:none;overflow:hidden; }
    </style>`;
    const page = await launch(t, { html, host: 'www.youtube.com' });
    // Add the native cluster after discovery, as on a late player bind.
    const toolbar = (nested = false) => page.evaluate(nested => {
      document.querySelector('.ytp-right-controls')?.remove();
      const cluster = document.createElement('div'); cluster.className = 'ytp-right-controls';
      cluster.innerHTML = '<button id="sponsorblock" class="ytp-button">SB</button><button class="ytp-button ytp-autonav-toggle" aria-label="Autoplay"><div class="ytp-autonav-toggle-button">A</div></button><button id="settings" class="ytp-button">⚙</button>';
      if (nested) { const group = document.createElement('div'); group.className = 'ytp-right-controls-left'; group.append(...cluster.childNodes); cluster.append(group); }
      document.getElementById('player')!.append(cluster);
    }, nested);
    await toolbar();
    await hover(page, 400, 260);
    const native = page.locator('.ytp-right-controls .theater-video-activator');
    await native.waitFor();
    assert.deepEqual(await page.locator('.ytp-right-controls > *').evaluateAll(elements => elements.map(el => el.id || el.className)),
      ['sponsorblock', 'theater-video-activator ytp-button', 'ytp-button ytp-autonav-toggle', 'settings']);
    const toolbarMark = () => native.evaluate(el => {
      const fill = (selector: string) => getComputedStyle(el.querySelector(selector)!).fill;
      return { background: getComputedStyle(el).backgroundColor, color: getComputedStyle(el).color, accent: getComputedStyle(el).getPropertyValue('--accent-color').trim(), body: fill('.launcher-body'), triangle: fill('.launcher-triangle') };
    });
    const resting = await toolbarMark();
    assert.equal(resting.background, 'rgba(0, 0, 0, 0)');
    assert.equal(resting.body, 'rgb(255, 255, 255)', 'white rhombus at rest, not the toolbar #eee');
    const centres = await page.evaluate(() => {
      const centre = (el: Element) => { const r = el.getBoundingClientRect(); return r.top + r.height / 2; };
      const own = document.querySelector('.ytp-right-controls .theater-video-activator')!;
      return { own: centre(own), mark: centre(own.querySelector('svg')!), sibling: centre(document.getElementById('settings')!) };
    });
    assert.ok(Math.abs(centres.own - centres.sibling) <= 1 && Math.abs(centres.mark - centres.sibling) <= 1, `launcher centre ${JSON.stringify(centres)}`);
    assert.ok(resting.accent, 'the toolbar button keeps the accent token');
    assert.notEqual(resting.triangle, resting.body, 'accent triangle at rest');
    if (engine === 'chromium') await page.screenshot({ path: '/tmp/tme-91-youtube-toolbar.png' });
    await native.hover();
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.ytp-right-controls .theater-video-activator .launcher-triangle')!).fill === 'none');
    await native.evaluate(el => Promise.all(el.getAnimations({ subtree: true }).map(animation => animation.finished)));
    const inverted = await toolbarMark();
    assert.equal(inverted.body, resting.triangle, 'hover fills the rhombus with the accent');
    assert.equal(inverted.triangle, 'none', 'hover cuts the triangle out');
    assert.equal(await native.evaluate(el => getComputedStyle(el.querySelector('.launcher-body')!).transitionDuration), '0.12s', 'same fade as the overlay');
    await page.evaluate(() => document.documentElement.setAttribute('data-theater-everywhere-motion', 'reduced'));
    await page.mouse.move(5, 5);
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.ytp-right-controls .theater-video-activator .launcher-body')!).transitionDuration === '0s');
    await page.evaluate(() => document.documentElement.removeAttribute('data-theater-everywhere-motion'));
    await native.hover();
    if (engine === 'chromium') await page.screenshot({ path: '/tmp/tme-91-youtube-toolbar-hover.png' });
    await hover(page, 400, 260);
    await page.evaluate(() => document.querySelector('.ytp-autonav-toggle-button')!.closest('button')!.remove());
    await native.waitFor({ state: 'detached' });
    await hover(page, 405, 260);
    await page.locator('#theater-everywhere-ui .theater-video-activator').waitFor();
    await toolbar();
    await native.waitFor();
    const old = await native.elementHandle();
    await toolbar(true);
    await native.waitFor();
    assert.equal(await old!.evaluate(el => el.isConnected), false);
    await old!.evaluate(el => el.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    assert.equal(await page.locator('video[data-theater-everywhere]').count(), 0);
    await page.evaluate(() => { chrome.storage.sync.get = (async () => ({ videoActivator: true, youtubeIntegrationEnabled: false })) as typeof chrome.storage.sync.get; for (const listener of window.storageListeners) listener({ youtubeIntegrationEnabled: { newValue: false } }, 'sync'); });
    await native.waitFor({ state: 'detached' });
    await hover(page, 420, 260);
    await page.locator('#theater-everywhere-ui .theater-video-activator').waitFor();
    await page.evaluate(() => { chrome.storage.sync.get = (async () => ({ videoActivator: true, youtubeIntegrationEnabled: true })) as typeof chrome.storage.sync.get; for (const listener of window.storageListeners) listener({ youtubeIntegrationEnabled: { newValue: true } }, 'sync'); });
    await hover(page, 430, 260);
    await native.waitFor();
    await page.evaluate(() => document.dispatchEvent(new Event('yt-page-data-updated')));
    await native.waitFor();
    assert.equal(await native.count(), 1, 'navigation leaves exactly one toolbar button');
    const replaced = await native.elementHandle();
    await page.evaluate(() => {
      const video = document.getElementById('main')!;
      video.replaceWith(video.cloneNode(true));
    });
    await page.waitForFunction(() => (document.getElementById('main') as HTMLVideoElement).readyState >= 1);
    await hover(page, 455, 260);
    await native.waitFor();
    assert.equal(await replaced!.evaluate(el => el.isConnected), false);
    await page.evaluate(() => { for (const listener of window.storageListeners) listener({ videoActivator: { newValue: false } }, 'sync'); });
    await native.waitFor({ state: 'detached' });
    await toolbar();
    assert.equal(await native.count(), 0);
    await page.evaluate(() => { for (const listener of window.storageListeners) listener({ videoActivator: { newValue: true } }, 'sync'); });
    await hover(page, 460, 260);
    await native.waitFor();
    await native.focus();
    await page.keyboard.press('Space');
    await page.waitForSelector('video[data-theater-everywhere]');
    assert.equal(await native.count(), 0, 'native keyboard activation uses the regular theater path');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('video[data-theater-everywhere]'));
    await hover(page, 470, 260);
    await native.waitFor();
    await page.evaluate(() => document.getElementById('main')!.remove());
    await native.waitFor({ state: 'detached' });
    await toolbar();
    assert.equal(await native.count(), 0, 'disposed source cannot reinject after video removal');
  });

  const YOUTUBE_PAGE = PAGE.replace('id="player"', 'id="player" class="html5-video-player"') + `<style>
      .ytp-right-controls { position:absolute;right:0;bottom:0;height:48px;display:flex;color:white;background:#222; }
      .ytp-button { width:48px;height:48px;color:inherit;fill:currentColor; }
    </style>
    <div id="player-late"></div>`;
  const addToolbar = (page: Page) => page.evaluate(() => {
    document.querySelector('.ytp-right-controls')?.remove();
    const cluster = document.createElement('div'); cluster.className = 'ytp-right-controls';
    cluster.innerHTML = '<button class="ytp-button ytp-autonav-toggle" aria-label="Autoplay"><div class="ytp-autonav-toggle-button">A</div></button><button class="ytp-button">⚙</button>';
    document.getElementById('player')!.append(cluster);
  });

  it(`${engine}: the mark is centred in the button and inverts on hover and focus`, { timeout: 40_000 }, async t => {
    const page = await launch(t);
    await hover(page, 400, 260);
    const button = page.locator('#theater-everywhere-ui .theater-video-activator');
    await button.waitFor();
    await button.evaluate(element => Promise.all(element.getAnimations().map(animation => animation.finished)));
    const centre = (selector: string) => button.evaluate((element, selector) => {
      const target = selector ? element.querySelector(selector)! : element;
      const box = target.getBoundingClientRect();
      return [box.left + box.width / 2, box.top + box.height / 2, box.width, box.height];
    }, selector);
    const [bx, by] = await centre('');
    for (const selector of ['svg', '.launcher-body']) {
      const [x, y] = await centre(selector);
      assert.ok(Math.abs(x - bx) <= 0.5 && Math.abs(y - by) <= 0.5, `${selector} centre (${x},${y}) vs button (${bx},${by})`);
    }
    const fills = () => button.evaluate(element => {
      const style = (selector: string) => getComputedStyle(element.querySelector(selector)!);
      return { accent: getComputedStyle(element).getPropertyValue('--accent-color').trim(), body: style('.launcher-body').fill,
        stroke: style('.launcher-body').stroke, triangle: style('.launcher-triangle').fill };
    });
    const rest = await fills();
    assert.equal(rest.body, rest.stroke, 'resting body is filled with the accent');
    assert.equal(rest.triangle, 'rgb(255, 255, 255)');
    await page.mouse.move(await button.evaluate(element => (element as HTMLElement).offsetLeft + 20), await button.evaluate(element => (element as HTMLElement).offsetTop + 20));
    await page.waitForFunction(() => {
      const body = document.getElementById('theater-everywhere-ui')!.shadowRoot!.querySelector('.launcher-body')!;
      return getComputedStyle(body).fill === 'none' || getComputedStyle(body).fill === 'rgba(0, 0, 0, 0)';
    });
    const hovered = await fills();
    assert.equal(hovered.triangle, rest.body, 'hovered mark takes the accent');
    assert.equal(hovered.stroke, rest.stroke, 'the rhombus outline stays');
    if (engine === 'chromium') await page.screenshot({ path: '/tmp/tme-91-launcher-hover.png' });
    // Keyboard focus shows the same inverted state; the transition collapses under Reduce motion.
    await page.mouse.move(400, 260);
    await page.evaluate(() => document.getElementById('theater-everywhere-ui')!.setAttribute('data-motion', 'reduced'));
    await page.keyboard.press('Shift');
    await button.focus();
    await page.waitForFunction(() => document.getElementById('theater-everywhere-ui')!.shadowRoot!.querySelector('.theater-video-activator:focus-visible'));
    await page.waitForFunction(accent => getComputedStyle(document.getElementById('theater-everywhere-ui')!.shadowRoot!
      .querySelector('.launcher-triangle')!).fill === accent, rest.body);
    const duration = await button.evaluate(element => getComputedStyle(element.querySelector('.launcher-body')!).transitionDuration);
    assert.ok(parseFloat(duration) < 0.001, duration);
    await page.evaluate(() => document.getElementById('theater-everywhere-ui')!.setAttribute('data-contrast', 'high'));
    await page.waitForFunction(() => {
      const host = document.getElementById('theater-everywhere-ui')!;
      return host.getAttribute('data-contrast') === 'high'
        && getComputedStyle(host.shadowRoot!.querySelector('.theater-video-activator')!).borderTopWidth === '2px';
    });
    if (engine === 'chromium') await page.screenshot({ path: '/tmp/tme-91-launcher-high-contrast-reduced-motion.png' });
  });

  it(`${engine}: a video the page starts playing keeps the launcher, however late after load`, { timeout: 40_000 }, async t => {
    const page = await launch(t, { pageAge: 60_000 });
    await hover(page, 400, 260);
    const button = page.locator('#theater-everywhere-ui .theater-video-activator');
    await button.waitFor();
    // A press elsewhere (a consent banner) moments before the player autoplays is not the viewer's play.
    await page.mouse.click(10, 650);
    await hover(page, 400, 260);
    await button.waitFor();
    await page.evaluate(async () => { const video = document.getElementById('main') as HTMLVideoElement; video.muted = true; await video.play(); });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await button.count(), 1, 'autoplay long after load does not hide the launcher');
    if (engine === 'chromium') await page.screenshot({ path: '/tmp/tme-launcher-late-autoplay.png' });
  });

  it(`${engine}: the viewer's own play hides the launcher after a 3s linger, and a fresh visit still counts it as autoplay`, { timeout: 40_000 }, async t => {
    const page = await launch(t, { freezeClock: true });
    type Counted = { playEvents: number };
    // 'play' is a queued task; the launcher reacts in an earlier listener, so a later count means it has.
    const played = async (before: number) => {
      await page.waitForFunction(count => (window as unknown as Counted).playEvents > count, before);
      await page.clock.runFor(50);
    };
    await page.evaluate(() => {
      const video = document.getElementById('main') as HTMLVideoElement;
      video.muted = true;
      (window as unknown as Counted).playEvents = 0;
      video.addEventListener('play', () => { (window as unknown as Counted).playEvents++; });
      const player = document.getElementById('player')!;
      player.tabIndex = 0;
      // Like a host player: the press, not the load, starts playback.
      player.addEventListener('pointerdown', () => { void video.play(); });
      player.addEventListener('keydown', event => { if (event.key === ' ') void video.play(); });
    });
    const pause = () => page.evaluate(() => (document.getElementById('main') as HTMLVideoElement).pause());
    const reapproach = async () => {
      await page.mouse.move(2, 590);
      await hover(page, 410, 260);
      await page.clock.runFor(50);
      await page.mouse.move(415, 262); // The pause refreshes geometry first; the next movement selects the video.
      await page.clock.runFor(50);
    };
    await hover(page, 400, 260);
    await page.clock.runFor(50);
    assert.ok(await launcher(page));
    await page.mouse.click(400, 260);
    await played(0);
    assert.ok(await launcher(page), 'a press on the video starts playback but the launcher lingers');
    await page.clock.runFor(3000);
    assert.equal(await launcher(page), null, 'and hides after the linger');
    await pause();
    await reapproach();
    assert.ok(await launcher(page), 'pausing offers it again');
    await page.locator('#player').focus();
    const beforeKey = await page.evaluate(() => (window as unknown as Counted).playEvents);
    await page.keyboard.press('Space');
    await played(beforeKey);
    assert.ok(await launcher(page), 'a key press in the player lingers the launcher too');
    await page.clock.runFor(3000);
    assert.equal(await launcher(page), null, 'a key press in the player starts playback and hides the launcher');
    await pause();
    await page.evaluate(() => window.dispatchEvent(new PopStateEvent('popstate')));
    await page.mouse.click(400, 260);
    await reapproach();
    assert.ok(await launcher(page), 'playback right after a navigation is autoplay even with a press on the video');
  });

  it(`${engine}: the tooltip carries the configured theater shortcut in both surfaces`, { timeout: 40_000 }, async t => {
    const page = await launch(t, { stored: { shortcuts: { toggle: 'Shift+Y' } }, html: YOUTUBE_PAGE, host: 'www.youtube.com' });
    await hover(page, 400, 260);
    const overlay = page.locator('#theater-everywhere-ui .theater-video-activator');
    await overlay.waitFor();
    assert.equal(await overlay.getAttribute('title'), 'Enter theater mode [Shift+Y]');
    assert.equal(await overlay.getAttribute('aria-label'), 'Enter theater mode');
    await addToolbar(page);
    const native = page.locator('.ytp-right-controls .theater-video-activator');
    await native.waitFor();
    assert.equal(await native.getAttribute('title'), 'Enter theater mode [Shift+Y]');
    const change = (toggle: string) => page.evaluate(toggle => {
      for (const listener of window.storageListeners) listener({ shortcuts: { newValue: { toggle } } }, 'sync');
    }, toggle);
    await change('K');
    await page.waitForFunction(() => document.querySelector('.ytp-right-controls .theater-video-activator')?.getAttribute('title') === 'Enter theater mode [K]');
    await change('');
    await page.waitForFunction(() => document.querySelector('.ytp-right-controls .theater-video-activator')?.getAttribute('title') === 'Enter theater mode');
  });

  it(`${engine}: a persistent YouTube slot ignores playback, pointer and idle timing`, { timeout: 40_000 }, async t => {
    const page = await launch(t, { html: YOUTUBE_PAGE, host: 'www.youtube.com', freezeClock: true });
    const native = page.locator('.ytp-right-controls .theater-video-activator');
    await addToolbar(page);
    await page.clock.runFor(50);
    assert.equal(await native.count(), 1, 'shown without any pointer approach');
    assert.equal(await launcher(page), null, 'no overlay competes with the toolbar');
    await page.clock.runFor(10_000);
    assert.equal(await native.count(), 1, 'idle time does not hide it');
    await page.evaluate(async () => { const video = document.getElementById('main') as HTMLVideoElement; video.muted = true; await video.play(); });
    await page.clock.runFor(50);
    assert.equal(await native.count(), 1, 'playback does not hide it');
    await hover(page, 400, 260);
    await page.clock.runFor(2600);
    assert.equal(await native.count(), 1);
    assert.equal(await launcher(page), null);
    // Geometry: the toolbar mark is centred in the toolbar button.
    const [bx, by, mx, my] = await native.evaluate(element => {
      const box = element.getBoundingClientRect(); const mark = element.querySelector('.launcher-body')!.getBoundingClientRect();
      return [box.left + box.width / 2, box.top + box.height / 2, mark.left + mark.width / 2, mark.top + mark.height / 2];
    });
    assert.ok(Math.abs(bx - mx) <= 0.5 && Math.abs(by - my) <= 0.5, `toolbar mark (${mx},${my}) vs button (${bx},${by})`);
    // Removing the anchor falls back to the paused-only overlay rules; the playing video gets none.
    await page.evaluate(() => document.querySelector('.ytp-autonav-toggle-button')!.closest('button')!.remove());
    await page.clock.runFor(50);
    assert.equal(await native.count(), 0);
  });

  it(`${engine}: the entry notice is opaque with a thinner border`, { timeout: 40_000 }, async t => {
    const page = await launch(t);
    await page.evaluate(() => { window.TheaterTest.showAutoTheaterNotice(() => {}, () => {}, () => 3000); });
    const style = await page.evaluate(() => {
      const notice = document.getElementById('theater-everywhere-ui')!.shadowRoot!.querySelector('.theater-auto-notice')!;
      const css = getComputedStyle(notice);
      return { background: css.backgroundColor, filter: css.backdropFilter || css.getPropertyValue('-webkit-backdrop-filter'), border: css.borderTopWidth,
        frost: getComputedStyle(notice, '::before').content };
    });
    assert.equal(style.background, 'rgb(24, 24, 27)');
    assert.ok(style.filter === 'none' || style.filter === '', style.filter);
    assert.equal(style.border, '2px');
    assert.ok(style.frost === 'none' || style.frost === 'normal', style.frost);
  });
}
