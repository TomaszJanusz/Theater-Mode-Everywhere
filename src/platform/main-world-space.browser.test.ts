import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { Page } from 'playwright';

import { sharedEngineBrowsers } from '../test-utils/engine-browsers';
import { bootPlayer, enterTheater } from '../test-utils/player-boot';
import { testEngines } from '../test-utils/test-engines';
import { serveFixture } from '../test-utils/video-fixtures';

const browsers = sharedEngineBrowsers();

/**
 * A playing canvas-stream video, `depth` open shadow roots deep (0 is the page DOM), with a text
 * field beside it in the same tree. A page Space listener counts the keys that reach the host.
 */
function fixture(depth: number): string {
  return `<!doctype html><html><head><title>Shadow Space fixture</title>
    <style>body { margin:0; background:#111; }</style></head><body><script>
    const css = 'video { width:960px; height:540px; display:block; }';
    let root = document.body;
    for (let level = 0; level < ${depth}; level++) {
      const host = document.createElement('web-player-' + level);
      root.append(host);
      root = host.attachShadow({ mode: 'open' });
    }
    root.innerHTML = '<style>' + css + '</style><video title="Shadow Space" muted playsinline></video><input id="note">';
    const canvas = document.createElement('canvas');
    canvas.width = 1280; canvas.height = 720;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#1c2634'; ctx.fillRect(0, 0, 1280, 720);
    const video = root.querySelector('video');
    video.srcObject = canvas.captureStream(12);
    setInterval(() => { ctx.fillRect(0, 0, 1, 1); }, 100);
    video.play();
    window.fixtureVideo = video;
    window.fixtureInput = root.querySelector('#note');
    window.hostSpaceKeys = 0;
    window.addEventListener('keydown', event => { if (event.key === ' ') window.hostSpaceKeys++; });
  </script></body></html>`;
}

type FixtureWindow = Window & { fixtureVideo: HTMLVideoElement; fixtureInput: HTMLInputElement; hostSpaceKeys: number };

const paused = (page: Page) => page.evaluate(() => (window as unknown as FixtureWindow).fixtureVideo.paused);
const hostSpaceKeys = (page: Page) => page.evaluate(() => (window as unknown as FixtureWindow).hostSpaceKeys);

/**
 * Waits for the theater's live region to announce the playback action that Space caused.
 * @param page Theater page under test.
 * @param action Expected action.
 */
async function waitForAnnouncement(page: Page, action: 'Play' | 'Pause'): Promise<void> {
  await page.waitForFunction(expected => document.querySelector('#theater-everywhere-ui')?.shadowRoot
    ?.getElementById('theater-announcements')?.textContent === expected, action);
}

describe('Space toggles the theater video from the MAIN world', () => {
  for (const engine of testEngines()) {
    for (const depth of [0, 1, 2]) {
      const where = depth === 0 ? 'the page DOM' : `${depth} open shadow root${depth > 1 ? 's' : ''}`;
      it(`${engine}: a video in ${where} pauses and plays on Space, keeps the text-field guard and lets Space go after exit`, { timeout: 40_000 }, async t => {
        const page = await (await browsers[engine].newContext(t, { viewport: { width: 1280, height: 900 } })).newPage();
        page.setDefaultTimeout(8000);
        await serveFixture(page, fixture(depth), 'http://shadow-space.test/');
        await bootPlayer(page, { settings: { keepControlsVisible: true }, mainWorld: true });
        await page.waitForFunction(() => {
          const video = (window as unknown as FixtureWindow).fixtureVideo;
          return video.readyState >= 2 && !video.paused;
        });
        await enterTheater(page);

        await page.keyboard.press('Space');
        await page.waitForFunction(() => (window as unknown as FixtureWindow).fixtureVideo.paused);
        await waitForAnnouncement(page, 'Pause');
        await page.keyboard.press('Space');
        await page.waitForFunction(() => !(window as unknown as FixtureWindow).fixtureVideo.paused);
        await waitForAnnouncement(page, 'Play');
        assert.equal(await hostSpaceKeys(page), 0, 'theater Space must not reach the host page');

        // A text field in the same tree keeps its Space: it types, and playback is untouched.
        await page.evaluate(() => (window as unknown as FixtureWindow).fixtureInput.focus());
        await page.keyboard.press('Space');
        assert.equal(await page.evaluate(() => (window as unknown as FixtureWindow).fixtureInput.value), ' ');
        assert.equal(await paused(page), false);
        await page.evaluate(() => (window as unknown as FixtureWindow).fixtureInput.blur());

        // After exit nothing is marked, so the MAIN world neither toggles nor swallows Space.
        const before = await hostSpaceKeys(page);
        await page.keyboard.press('Escape');
        await page.locator('video[data-theater-everywhere]').waitFor({ state: 'detached' });
        assert.equal(await page.evaluate(() => {
          const marked: Element[] = [];
          const collect = (root: Document | ShadowRoot) => {
            marked.push(...root.querySelectorAll('.theater-everywhere-parent-active'));
            for (const element of root.querySelectorAll('*')) if (element.shadowRoot) collect(element.shadowRoot);
          };
          collect(document);
          return marked.length;
        }), 0, 'exit clears every marked ancestor, shadow hosts included');
        await page.keyboard.press('Space');
        await page.waitForFunction(count => (window as unknown as FixtureWindow).hostSpaceKeys > count, before);
        assert.equal(await paused(page), false);
        await page.close();
      });
    }
  }
});
