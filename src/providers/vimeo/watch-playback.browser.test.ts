import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { it } from 'node:test';

import type { Page } from 'playwright';

import { defaultMediaProviderFlags } from '../../media-features/provider-flags';
import { sharedEngineBrowsers } from '../../test-utils/engine-browsers';
import { bundleModules } from '../../test-utils/player-boot';
import { testEngines } from '../../test-utils/test-engines';
import type { AutoTheaterRuntime, createAutoTheaterRuntime } from '../../ui/auto-theater-runtime';

const BUNDLE = bundleModules([
  "export { exposeFixtureRuntime } from './test-utils/provider-runtime';",
  "export { createAutoTheaterRuntime } from './ui/auto-theater-runtime';",
  "export { installWatchPlaybackQueries, confirmProviderWatchVideo } from './providers/watch-playback';"
], 'VimeoWatchTest');
// The provider's MAIN script, loaded after the runtime like the installed extension does.
const PROVIDER = bundleModules(["import './providers/vimeo/main';"]);
const browsers = sharedEngineBrowsers();
const MEDIA = `data:video/webm;base64,${readFileSync(new URL('../../../test/fixtures/vod.webm', import.meta.url)).toString('base64')}`;

declare global {
  interface Window {
    VimeoWatchTest: {
      exposeFixtureRuntime(world: 'main'): void;
      createAutoTheaterRuntime: typeof createAutoTheaterRuntime;
      installWatchPlaybackQueries(): void;
      confirmProviderWatchVideo(video: HTMLVideoElement): boolean;
    };
    vimeoProbe: { entries: number };
    vimeoRuntime: AutoTheaterRuntime;
    spaTo(id: string): void;
    rebuiltPlaying?: boolean;
  }
}

// vimeo.com clip pages are a Next.js app: no `playerConfig`; the router's `clipId` follows client navigation while
// `__NEXT_DATA__` keeps the first clip. A second video (a hover preview in a popover) sits outside `.player`.
const NEXT_PAGE = `
<div class="player js-player"><video id="main" muted loop style="width:640px;height:360px"></video></div>
<section class="popover"><video id="preview" muted></video></section>
<script>
  window.__NEXT_DATA__ = { props: { pageProps: { clipId: '1160188722' } } };
  window.next = { router: { query: { clipId: '1160188722' } } };
  // The host rebuilds its player for each clip, which is also what makes the runtime look again.
  window.spaTo = id => {
    window.next.router.query = { clipId: id };
    history.pushState(null, '', '/' + id);
    const video = document.createElement('video');
    video.id = 'main'; video.muted = true; video.loop = true; video.src = window.MEDIA; video.style.cssText = 'width:640px;height:360px';
    document.querySelector('.player').replaceChildren(video);
    video.addEventListener('playing', () => { window.rebuiltPlaying = true; });
    video.play();
  };
</script>`;

async function open(page: Page, path: string, body: string): Promise<void> {
  await page.addInitScript('window.__name = target => target;');
  await page.route('https://vimeo.com/**', route => route.fulfill({ contentType: 'text/html', body }));
  await page.route('https://player.vimeo.com/**', route => route.fulfill({ contentType: 'text/html', body }));
  await page.goto(path);
  await page.evaluate(media => {
    (window as unknown as { MEDIA: string }).MEDIA = media;
    const video = document.getElementById('main') as HTMLVideoElement;
    video.src = media;
    return new Promise(resolve => video.addEventListener('loadeddata', resolve, { once: true }));
  }, MEDIA);
  await page.addScriptTag({ content: BUNDLE });
  await page.evaluate(() => window.VimeoWatchTest.exposeFixtureRuntime('main'));
  await page.addScriptTag({ content: PROVIDER });
  await page.evaluate(() => window.VimeoWatchTest.installWatchPlaybackQueries());
}

const confirmed = (page: Page, id = 'main') => page.evaluate(
  videoId => window.VimeoWatchTest.confirmProviderWatchVideo(document.getElementById(videoId) as HTMLVideoElement), id);

for (const engine of testEngines()) {
  it(`Vimeo clip pages in ${engine} confirm the player by the Next router's clip, without a player config`, { timeout: 60_000 }, async t => {
    const page = await (await browsers[engine].newContext(t)).newPage();
    await open(page, 'https://vimeo.com/1160188722', NEXT_PAGE);
    assert.equal(await confirmed(page), true, 'the router names the URL clip');
    assert.equal(await confirmed(page, 'preview'), false, 'the preview video is not the sole player video');

    // Client navigation: the live router follows the URL, so a route the router has not reached never confirms.
    await page.evaluate(() => history.pushState(null, '', '/654321'));
    assert.equal(await confirmed(page), false, 'URL moved before the router did');
    await page.evaluate(() => window.spaTo('654321'));
    assert.equal(await confirmed(page), true, 'router and URL agree on the next clip');

    // An embed keeps publishing its own player config and wins over any router.
    await page.evaluate(() => { (window as unknown as { playerConfig: unknown }).playerConfig = { video: { id: 111 } }; });
    assert.equal(await confirmed(page), false, 'config of another clip');
    await page.evaluate(() => { (window as unknown as { playerConfig: unknown }).playerConfig = { video: { id: 654321 } }; });
    assert.equal(await confirmed(page), true, 'config of this clip');

    // No identity at all (nothing the host publishes): fail closed.
    await page.evaluate(() => { delete (window as unknown as { playerConfig?: unknown }).playerConfig; delete (window as unknown as { next?: unknown }).next; });
    assert.equal(await confirmed(page), false, 'no host identity');
  });

  it(`AutoTheater in ${engine} enters a Vimeo clip on load and after client navigation`, { timeout: 90_000 }, async t => {
    const page = await (await browsers[engine].newContext(t)).newPage();
    await open(page, 'https://vimeo.com/1160188722', NEXT_PAGE);
    await page.clock.install();
    await page.clock.pauseAt(new Date(Date.now() + 60_000));
    await page.evaluate(flags => {
      const probe = { entries: 0, active: false };
      Object.assign(window, { vimeoProbe: probe });
      window.vimeoRuntime = window.VimeoWatchTest.createAutoTheaterRuntime({
        visit: { current: { identity: null, entered: false } },
        enabled: () => true, policyAllowed: () => true, providerFlags: () => flags,
        editableFocused: () => false, theaterActive: () => probe.active, transitioning: () => false,
        findBestVideo: () => document.getElementById('main') as HTMLVideoElement,
        enter: () => { probe.entries++; probe.active = true; },
        showNotice: () => () => {}, noticeDelayMs: 0
      });
    }, defaultMediaProviderFlags());
    const entries = () => page.evaluate(() => window.vimeoProbe.entries);

    await page.evaluate(() => (document.getElementById('main') as HTMLVideoElement).play());
    await page.waitForFunction(() => (document.getElementById('main') as HTMLVideoElement).readyState > 2);
    await page.clock.runFor(6000);
    assert.equal(await entries(), 1, 'entered on load');

    // Exit, then open the next clip through the router: a new identity restarts the visit.
    await page.evaluate(() => { window.vimeoProbe = Object.assign(window.vimeoProbe, { active: false }); });
    await page.evaluate(() => window.spaTo('654321'));
    // The document-level capture listener has run by the time the target's own `playing` listener does.
    await page.waitForFunction(() => window.rebuiltPlaying);
    await page.clock.runFor(6000);
    assert.equal(await entries(), 2, 'entered after client navigation');
  });
}
