import assert from 'node:assert/strict';
import { describe, it, type TestContext } from 'node:test';

import type { Page } from 'playwright';

import { sharedEngineBrowsers } from '../../test-utils/engine-browsers';
import { bootPlayer, bundlePlayer, enterTheater } from '../../test-utils/player-boot';
import { readStylesheet } from '../../test-utils/styles';
import { testEngines } from '../../test-utils/test-engines';
import { vodVideoFixture } from '../../test-utils/video-fixtures';

const browsers = sharedEngineBrowsers();
const PLAY = '86e14fdb-3841-4282-ad38-07c8c4aab4b6';
const BASE = 'https://vod-akc-euwest1.media.dssott.com/ps01/';
const PRESENTATION = readStylesheet(new URL('./presentation.css', import.meta.url));

/** The Disney+ watch page: Hive's player on `disney-web-player`, and the native cue layer with the line it paints. */
const playerPage = vodVideoFixture({ title: 'Film', pageTitle: 'Film | Disney+' })
  .replace('<video id="player"', '<disney-web-player><video id="player" class="hive-video"')
  .replace('</video>', '</video></disney-web-player><timed-text-override-region></timed-text-override-region>');

/**
 * Hive's `mediaPlayer.captions` as recorded on a signed-in watch page (test/host-fixtures/disney-watch-player.json):
 * `enabled`, and the same ids as the HLS renditions with `isSelected` and `hasDescribesMusicAndSound` ("[CC]").
 * English [CC] is what the account had on. Writing any of it is a test failure: theater must leave the setting alone.
 */
const fakeHive = (enabled: boolean) => `(() => {
  const web = document.querySelector('disney-web-player');
  const track = (id, name, language, cc, isSelected = false) => ({ id, name, language, hasDescribesMusicAndSound: cc, isSelected });
  const captions = { enabled: ${enabled}, availableTracks: [track(8, 'English [CC]', 'en', true, true), track(9, 'English', 'en', false), track(25, 'Polish', 'pl', false)] };
  const writes = [];
  web.mediaPlayer = {
    audio: { availableTracks: [], selectedTrack: null, setTrack() {} },
    captions: new Proxy(captions, { set(target, key, value) { writes.push(String(key)); target[key] = value; return true; } })
  };
  window.__hive = { captions, writes, state: () => JSON.stringify(captions) };
  const shadow = document.querySelector('timed-text-override-region').attachShadow({ mode: 'open' });
  shadow.innerHTML = '<div class="hive-subtitle-renderer-line">Native cue</div>';
})()`;

type Hive = { writes: string[]; state(): string };

async function open(test: TestContext, engine: 'chromium' | 'firefox', hive: { enabled: boolean; polish?: number }): Promise<Page> {
  const page = await (await browsers[engine].newContext(test, { viewport: { width: 1280, height: 720 } })).newPage();
  await page.route('https://www.disneyplus.com/**', route => route.fulfill({ status: 200, contentType: 'text/html', body: playerPage }));
  await page.route('https://disney.playback.edge.bamgrid.com/**', route => route.fulfill({
    contentType: 'application/json', headers: { 'access-control-allow-origin': '*' },
    body: JSON.stringify({ stream: { complete: { url: `${BASE}una-ctr-all-test.m3u8` } } })
  }));
  await page.route(`${BASE}**`, route => {
    const pathname = new URL(route.request().url()).pathname;
    const polish = pathname.includes('_pl_') || pathname.endsWith('/pl.vtt');
    const cue = 'WEBVTT\n\n00:00:00.000 --> 00:59:00.000\n' + (polish ? 'Polish cue' : 'TME cue') + '\n';
    const media = (name: string) => `#EXTM3U\n#EXTINF:3600,\ntext/${name}.vtt\n`;
    const body = pathname.endsWith('una-ctr-all-test.m3u8')
      ? '#EXTM3U\n'
        + '#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="English",LANGUAGE="en",FORCED=NO,URI="r/composite_en_NORMAL_test.m3u8"\n'
        + '#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="English SDH",LANGUAGE="en",FORCED=NO,CHARACTERISTICS="public.accessibility.describes-music-and-sound",URI="r/composite_en_SDH_test.m3u8"\n'
        + '#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="Polish",LANGUAGE="pl",FORCED=NO,URI="r/composite_pl_NORMAL_test.m3u8"\n'
      : pathname.endsWith('.m3u8') ? media(polish ? 'pl' : 'en')
        : cue;
    // A Polish pick that cannot load stands in for a rendition the CDN refuses.
    if (hive.polish && polish && pathname.endsWith('.vtt')) return route.fulfill({ status: hive.polish });
    return route.fulfill({ contentType: pathname.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'text/vtt', headers: { 'access-control-allow-origin': '*' }, body });
  });
  await page.goto(`https://www.disneyplus.com/pl-pl/play/${PLAY}`);
  await page.waitForFunction(() => (document.querySelector('video')?.readyState ?? 0) >= 2);
  await page.evaluate(fakeHive(hive.enabled));
  await bootPlayer(page, {
    mainWorld: true,
    bundle: bundlePlayer(["import './providers/disney/isolated';", "import './providers/disney/main-entry';"])
  });
  await page.addStyleTag({ content: PRESENTATION });
  await enterTheater(page);
  await page.evaluate(() => { void fetch('https://disney.playback.edge.bamgrid.com/v7/playback/ctr-regular', { method: 'POST' }); });
  return page;
}

const ready = (page: Page, checked: string, cue: string) => page.waitForFunction(([checked, cue]) => {
  const root = document.getElementById('theater-everywhere-ui')?.shadowRoot;
  const active = Array.from(root?.querySelectorAll('.theater-cc-menu-item.active') ?? []).map(node => node.textContent?.replace(/[\s✓]+$/, '').trim());
  return active.length === 1 && active[0] === checked && (root?.querySelector('.theater-caption-overlay-text')?.textContent ?? '') === cue;
}, [checked, cue]);
const native = (page: Page) => page.evaluate(() => {
  const line = document.querySelector('timed-text-override-region')!.shadowRoot!.querySelector('.hive-subtitle-renderer-line')!;
  return { painted: getComputedStyle(line).visibility === 'visible', attr: document.documentElement.hasAttribute('data-te-disney-captions-hidden') };
});
async function choose(page: Page, label: string): Promise<void> {
  if (!await page.locator('.theater-cc-menu.visible').count()) {
    await page.mouse.move(320, 240);
    await page.mouse.move(640, 700);
    await page.locator('.cc-btn').click();
  }
  await page.locator('.theater-cc-menu-item').filter({ hasText: label }).first().click();
}

describe('Disney+ native captions and the TME subtitle menu', () => {
  for (const engine of testEngines()) {
    it(`opens on the caption Disney+ shows, draws it once, honours Off, and restores Disney+'s own layer on exit, in ${engine}`, { timeout: 60_000 }, async t => {
      const page = await open(t, engine, { enabled: true });
      const before = await page.evaluate(() => (window as unknown as { __hive: Hive }).__hive.state());
      // The viewer had English [CC] on: the menu opens on the matching rendition, TME draws it, the native layer is hidden.
      await ready(page, 'English SDH', 'TME cue');
      assert.deepEqual(await native(page), { painted: false, attr: true });

      await choose(page, 'Polish');
      await ready(page, 'Polish', 'Polish cue');
      assert.equal((await native(page)).painted, false, 'a TME language: only the TME cue');

      // Off: no cue anywhere, and Disney+'s own setting is not turned off.
      await choose(page, 'Off');
      await ready(page, 'Off', '');
      assert.deepEqual(await native(page), { painted: false, attr: true });

      // Back from Off to a language, and the media reload an audio switch causes, keep the same state.
      await choose(page, 'English');
      await ready(page, 'English', 'TME cue');
      await page.evaluate(() => {
        const video = document.querySelector('video')!;
        video.dispatchEvent(new Event('emptied'));
        video.dispatchEvent(new Event('loadstart'));
        video.dispatchEvent(new Event('loadedmetadata'));
      });
      await ready(page, 'English', 'TME cue');
      assert.equal((await native(page)).painted, false);

      const hive = await page.evaluate(() => { const hive = (window as unknown as { __hive: Hive }).__hive; return { writes: hive.writes, state: hive.state() }; });
      assert.deepEqual(hive, { writes: [], state: before }, 'Disney+\'s caption setting was never written');

      await page.keyboard.press('Escape');
      await page.locator('.theater-controls-wrapper').waitFor({ state: 'detached' });
      assert.deepEqual(await native(page), { painted: true, attr: false }, 'leaving theater gives Disney+ its own cue back');
    });

    it(`says Off and paints nothing when Disney+ shows no caption, in ${engine}`, { timeout: 60_000 }, async t => {
      const page = await open(t, engine, { enabled: false });
      await ready(page, 'Off', '');
      assert.deepEqual(await native(page), { painted: false, attr: true });
      await choose(page, 'Polish');
      await ready(page, 'Polish', 'Polish cue');
      await choose(page, 'Off');
      await ready(page, 'Off', '');
      assert.equal((await page.evaluate(() => (window as unknown as { __hive: Hive }).__hive.writes)).length, 0);
      await page.keyboard.press('Escape');
      await page.locator('.theater-controls-wrapper').waitFor({ state: 'detached' });
      assert.deepEqual(await native(page), { painted: true, attr: false });
    });

    it(`keeps Disney+'s own cue when a TME language cannot load, in ${engine}`, { timeout: 60_000 }, async t => {
      const page = await open(t, engine, { enabled: true, polish: 404 });
      await ready(page, 'English SDH', 'TME cue');
      await choose(page, 'Polish');
      await ready(page, 'Off', '');
      assert.deepEqual(await native(page), { painted: true, attr: false }, 'the menu says Off, so Disney+\'s own cue stands in');
      await choose(page, 'English');
      await ready(page, 'English', 'TME cue');
      assert.equal((await native(page)).painted, false);
    });
  }
});
