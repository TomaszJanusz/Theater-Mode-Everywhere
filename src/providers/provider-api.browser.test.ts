import assert from 'node:assert/strict';
import { describe, it, type TestContext } from 'node:test';

import type { Page } from 'playwright';

import { sharedEngineBrowsers } from '../test-utils/engine-browsers';
import { bundleModules } from '../test-utils/player-boot';
import { testEngines } from '../test-utils/test-engines';

// The manifest's MAIN order on YouTube in one script: runtime, YouTube's entry, then start.
const entries = [
  "import './entries/main-world';", "import './providers/youtube/main';", "import './entries/main-world-start';",
  "export { providerRuntime } from './providers/provider-api';", "export { readCachedTimedtextBody } from './providers/youtube/player-main';"
];
const installed = bundleModules(entries, 'InstalledMain');
// A later build of the same runtime: its own module instances, as a patch update reinjects them into the open page.
const reinjected = bundleModules(entries, 'ReinjectedMain');
const browsers = sharedEngineBrowsers();

const TIMEDTEXT = 'https://www.youtube.com/api/timedtext?v=abcdefghijk&lang=en&pot=first-load&fmt=json3';
const BODY = JSON.stringify({ events: [{ tStartMs: 0, dDurationMs: 1000, segs: [{ utf8: 'first load' }] }] });
const WATCH = `<!doctype html><body><div id="movie_player"><video></video></div>
<script>window.ytInitialPlayerResponse = { videoDetails: { videoId: 'abcdefghijk', title: 'Probe title', lengthSeconds: '60' } };</script></body>`;

async function open(t: TestContext, engine: keyof typeof browsers): Promise<{ page: Page; errors: string[] }> {
  const page = await (await browsers[engine].newContext(t)).newPage();
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('https://www.youtube.com/**', route => route.request().url().includes('/api/timedtext')
    ? route.fulfill({ contentType: 'application/json', body: BODY })
    : route.fulfill({ contentType: 'text/html; charset=utf-8', body: WATCH }));
  await page.goto('https://www.youtube.com/watch?v=abcdefghijk');
  await page.addScriptTag({ content: 'window.__name = fn => fn;' });
  return { page, errors };
}

for (const engine of testEngines()) describe(`${engine} MAIN runtime reinjection`, () => {
  it('keeps the page\'s runtime through a same-version and a later injection, without errors', async t => {
    const { page, errors } = await open(t, engine);
    await page.addScriptTag({ content: installed });
    await page.evaluate(`window.__first = InstalledMain; window.__runtime = InstalledMain.providerRuntime('main')`);
    // A same-version reinjection, then a later build whose own exports never reach the page's first runtime.
    await page.addScriptTag({ content: installed });
    await page.addScriptTag({ content: reinjected });
    assert.deepEqual(errors, []);
    assert.equal(await page.evaluate(`ReinjectedMain.providerRuntime('main') === window.__runtime`), true, 'the first runtime stays exposed');
    // The runtime still works: the first injection's harvest observers see the page's fetch.
    await page.evaluate(`fetch(${JSON.stringify(TIMEDTEXT)}).then(response => response.json())`);
    await page.waitForFunction(url => (window as unknown as { __first: { readCachedTimedtextBody(url: string): string | null } })
      .__first.readCachedTimedtextBody(url) !== null, TIMEDTEXT);
    assert.equal(await page.evaluate(`ReinjectedMain.providerRuntime('main').register({ id: 'youtube', contractVersion: 1,
      watchPlayback: { pageIdentity: () => null, mainVideo: () => null } })`), false, 'registration stays closed after startup');
  });
});
