import assert from 'node:assert/strict';
import { describe, it, type TestContext } from 'node:test';

import type { Page } from 'playwright';

import { sharedEngineBrowsers } from '../test-utils/engine-browsers';
import { bundleModules } from '../test-utils/player-boot';
import { testEngines } from '../test-utils/test-engines';

// The shipped MAIN order in one script: runtime API, bundled provider registration, then start.
const shipped = bundleModules([
  "import './entries/main-world';",
  "import './entries/main-world-start';",
  "export { readCachedTimedtextBody } from './providers/youtube/player-main';",
  "export { providerRuntime } from './providers/provider-api';",
  "export { requestMediaProbe } from './media-features/probe';"
], 'ShippedMain');
const fixture = bundleModules([
  "export { exposeFixtureRuntime } from './test-utils/provider-runtime';",
  "export { providerRuntime } from './providers/provider-api';",
  "export { installMainWorldRuntime } from './platform/main-world-runtime';"
], 'HarvestVeto');
const browsers = sharedEngineBrowsers();

const TIMEDTEXT = 'https://www.youtube.com/api/timedtext?v=abcdefghijk&lang=en&pot=first-load&fmt=json3';
const BODY = JSON.stringify({ events: [{ tStartMs: 0, dDurationMs: 1000, segs: [{ utf8: 'first load' }] }] });

const WATCH = `<!doctype html><body><div id="movie_player"><video></video></div>
<script>window.ytInitialPlayerResponse = { videoDetails: { videoId: 'abcdefghijk', title: 'Probe title', lengthSeconds: '60' } };</script></body>`;

async function open(t: TestContext, engine: keyof typeof browsers): Promise<Page> {
  const page = await (await browsers[engine].newContext(t)).newPage();
  await page.route('https://www.youtube.com/**', route => route.request().url().includes('/api/timedtext')
    ? route.fulfill({ contentType: 'application/json', body: BODY })
    : route.fulfill({ contentType: 'text/html; charset=utf-8', body: WATCH }));
  await page.goto('https://www.youtube.com/watch?v=abcdefghijk');
  await page.addScriptTag({ content: 'window.__name = fn => fn;' });
  return page;
}

for (const engine of testEngines()) describe(`${engine} registered MAIN harvest`, () => {
  it('harvests the page\'s first response after startup and rejects a registration after it', async t => {
    const page = await open(t, engine);
    // The page fetches in the same task as startup: the observers must already exist.
    await page.addScriptTag({ content: `${shipped}\nwindow.__first = fetch(${JSON.stringify(TIMEDTEXT)}).then(response => response.json());` });
    await page.evaluate('window.__first');
    await page.waitForFunction(url => (window as unknown as { ShippedMain: { readCachedTimedtextBody(url: string): string | null } }).ShippedMain.readCachedTimedtextBody(url) !== null, TIMEDTEXT);
    assert.equal(await page.evaluate(`ShippedMain.providerRuntime('main').register({ id: 'youtube', contractVersion: 1,
      watchPlayback: { pageIdentity: () => null, mainVideo: () => null }, harvest: { qualify: () => 'late' } })`), false,
    'registration is closed once the observers are installed');
  });

  it('answers the snapshot probe through the registered provider, under its own id', async t => {
    const page = await open(t, engine);
    await page.addScriptTag({ content: shipped });
    const probed = await page.evaluate(`ShippedMain.requestMediaProbe().then(result => ({ keys: Object.keys(result.providers), title: result.providers.youtube?.title }))`);
    assert.deepEqual(probed, { keys: ['youtube'], title: 'Probe title' });
  });

  it('leaves the page\'s fetch unwrapped when a registered provider vetoes the wrapper', async t => {
    const wrapped = async (wrapFetch: boolean | undefined) => {
      const page = await open(t, engine);
      await page.addScriptTag({ content: fixture });
      return page.evaluate(`(() => {
        HarvestVeto.exposeFixtureRuntime('main');
        const native = window.fetch;
        HarvestVeto.providerRuntime('main').register({ id: 'youtube', contractVersion: 1,
          watchPlayback: { pageIdentity: () => null, mainVideo: () => null },
          harvest: { qualify: () => null${wrapFetch === undefined ? '' : `, wrapFetch: ${wrapFetch}`} } });
        HarvestVeto.installMainWorldRuntime();
        return window.fetch !== native;
      })()`);
    };
    assert.equal(await wrapped(undefined), true, 'a registered harvest wraps fetch by default');
    assert.equal(await wrapped(false), false, 'wrapFetch: false keeps the host transport untouched');
  });
});
