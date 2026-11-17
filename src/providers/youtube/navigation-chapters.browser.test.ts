import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { chromium, type Page } from 'playwright';

import { bundleModules } from '../../test-utils/player-boot';
import { sharedTestBrowser } from '../../test-utils/test-browser';
import { skipUnlessEngine } from '../../test-utils/test-engines';

const chromiumBrowser = sharedTestBrowser(chromium);

const bundle = bundleModules([
  "export { installYoutubeMain, readYoutubeSnapshot } from './providers/youtube/player-main';",
  "export { fetchPageMedia } from './platform/page-fetch';"
], 'ChapterTest');

/** The page data of an in-app navigation to a 77-minute video with 17 description chapters (sanitized, chapters only). */
const recorded = JSON.parse(readFileSync(new URL('../../../test/fixtures/youtube-navigation-chapters.json', import.meta.url), 'utf8')) as {
  capture: { video: string };
  pageData: unknown;
};
const VIDEO = recorded.capture.video;
const LANDING = 'landing0000';

/** A watch page reached in-app: ytInitialData still describes the landing video, with chapters of its own. */
async function setup(page: Page): Promise<void> {
  await page.route('https://www.youtube.com/**', route => route.fulfill({
    status: 200, contentType: 'text/html',
    body: '<!doctype html><ytd-app><div id="movie_player"><video></video></div></ytd-app>'
  }));
  await page.goto(`https://www.youtube.com/watch?v=${VIDEO}`);
  await page.addScriptTag({ content: `${bundle}\nwindow.ChapterTest = ChapterTest;` });
  await page.evaluate(({ video, landing }) => window.eval(`(() => {
    const chapters = [{ chapterRenderer: { title: { simpleText: 'Landing' }, timeRangeStartMillis: 0 } }];
    window.ytInitialData = { currentVideoEndpoint: { watchEndpoint: { videoId: '${landing}' } },
      playerOverlays: { playerOverlayRenderer: { decoratedPlayerBarRenderer: { decoratedPlayerBarRenderer: { playerBar: {
        multiMarkersPlayerBarRenderer: { markersMap: [{ key: 'DESCRIPTION_CHAPTERS', value: { chapters } }] } } } } } } };
    document.getElementById('movie_player').getPlayerResponse = () => ({ videoDetails: { videoId: '${video}', lengthSeconds: '4623' } });
    window.ChapterTest.installYoutubeMain(window.ChapterTest.fetchPageMedia);
  })()`), { video: VIDEO, landing: LANDING });
}

/** YouTube's own completion event, dispatched on ytd-app with the page data it fetched. */
const navigated = (page: Page, pageData: unknown): Promise<void> => page.evaluate(data => {
  document.querySelector('ytd-app')?.dispatchEvent(new CustomEvent('yt-navigate-finish', {
    bubbles: true, composed: true, detail: { pageType: 'watch', response: data }
  }));
}, pageData);

const snapshotMarkers = (page: Page): Promise<Array<{ title?: unknown }>> =>
  page.evaluate('window.ChapterTest.readYoutubeSnapshot()?.markers ?? []');

describe('YouTube chapters after in-app navigation', { skip: skipUnlessEngine('chromium') }, () => {
  it('reads the navigated video\'s chapters, never the landing video\'s', async t => {
    if (!existsSync(chromium.executablePath())) { t.skip('Browser not installed'); return; }
    const context = await chromiumBrowser.newContext(t);
    try {
      const page = await context.newPage();
      await setup(page);
      assert.deepEqual(await snapshotMarkers(page), [], 'ytInitialData names the landing video');

      await navigated(page, recorded.pageData);
      const markers = await snapshotMarkers(page);
      assert.equal(markers.length, 17);
      assert.equal(markers[0].title, 'Intro');
      // The publish on the same event already carries them, so the theater adapter needs no second read.
      await page.waitForFunction(() => {
        const published = document.getElementById('theater-everywhere-youtube-snapshot')?.textContent;
        return Boolean(published) && (JSON.parse(published as string) as { markers?: unknown[] }).markers?.length === 17;
      });

      // Another video's page data (a later navigation the page has not reached) keeps this video's chapters.
      const other = JSON.parse(JSON.stringify(recorded.pageData).replaceAll(VIDEO, 'other000000').replace('"Intro"', '"Other"'));
      await navigated(page, other);
      assert.equal((await snapshotMarkers(page))[0]?.title, 'Intro');
    } finally { await context.close(); }
  });
});
