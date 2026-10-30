import assert from 'node:assert/strict';
import { describe, it, type TestContext } from 'node:test';

import type { Page } from 'playwright';

import { sharedEngineBrowsers } from '../test-utils/engine-browsers';
import { bundleModules } from '../test-utils/player-boot';
import { testEngines } from '../test-utils/test-engines';

// The manifest's MAIN order on YouTube in one script: runtime, YouTube's entry, then start.
const shipped = bundleModules([
  "import './entries/main-world';",
  "import './providers/youtube/main';",
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

  // Each case holds one Blob body until `during` has run, then lets it complete; the read began in the visit before.
  const blobHarvest = (navigationApi: boolean) => `(async () => {
    HarvestVeto.exposeFixtureRuntime('main');
    ${navigationApi ? '' : "Object.defineProperty(window, 'navigation', { value: undefined, configurable: true });"}
    window.__seen = [];
    HarvestVeto.providerRuntime('main').register({ id: 'youtube', contractVersion: 1,
      watchPlayback: { pageIdentity: () => null, mainVideo: () => null },
      harvest: { qualify: url => /\\/(meta|other)/.exec(url)?.[1] ?? null, blobTextTargets: ['meta'],
        text: (target, url, text) => window.__seen.push(new URL(url).pathname) } });
    HarvestVeto.installMainWorldRuntime();
    const load = (path, onLoadEnd) => new Promise(resolve => {
      const xhr = new XMLHttpRequest();
      xhr.open('GET', path);
      xhr.responseType = 'blob';
      xhr.send();
      xhr.addEventListener('loadend', () => { onLoadEnd?.(); resolve(); });
    });
    const stream = Blob.prototype.stream;
    window.__held = async (path, during) => {
      let release;
      const gate = new Promise(resolve => { release = resolve; });
      Blob.prototype.stream = function() {
        const real = stream.call(this);
        return new ReadableStream({ async start(control) {
          await gate;
          const reader = real.getReader();
          try { for (let next = await reader.read(); !next.done; next = await reader.read()) control.enqueue(next.value); control.close(); }
          catch { /* the harvest cancelled its reader */ }
        } });
      };
      let settled;
      await load(path, () => { settled = during(); });
      Blob.prototype.stream = stream;
      await settled;
      release();
    };
    window.__load = load;
    await load('/meta/current');
    await load('/other/ignored');
  })()`;
  // Called by the host the way it would call them, not through our wrappers.
  const replaceMethods = `history.pushState = History.prototype.pushState;
    history.replaceState = function(state, title, url) { return History.prototype.replaceState.call(history, state, title, url); };`;

  it('reads opted-in XHR Blob bodies as text and drops a read that any navigation outlived', async t => {
    const page = await open(t, engine);
    await page.addScriptTag({ content: fixture });
    await page.evaluate(blobHarvest(true));
    await page.evaluate(`(async () => {
      await window.__held('/meta/forward', () => history.pushState(null, '', '/watch?v=another1234'));
      await window.__held('/meta/return', () => { const a = location.href; history.pushState(null, '', '/feed/subscriptions'); history.pushState(null, '', a); window.__roundTrips = (window.__roundTrips || 0) + (location.href === a); });
      await window.__held('/meta/state', () => history.replaceState({ scroll: 1 }, ''));
      // An intercepted Navigation API navigation changes the URL without the history methods.
      navigation.addEventListener('navigate', event => { if (event.canIntercept) event.intercept(); });
      await window.__held('/meta/navigate', () => navigation.navigate('?intercepted=1').finished);
      ${replaceMethods}
      await window.__held('/meta/replaced', () => { const a = location.href; history.pushState(null, '', '/feed/subscriptions'); history.replaceState(null, '', a); window.__roundTrips = (window.__roundTrips || 0) + (location.href === a); });
      await window.__load('/meta/after');
    })()`);
    await page.waitForFunction(`window.__seen.includes('/meta/after')`);
    assert.deepEqual(await page.evaluate('window.__seen'), ['/meta/current', '/meta/state', '/meta/after']);
    assert.equal(await page.evaluate('window.__roundTrips'), 2, 'both A→B→A cases end on the URL their read began on');
  });

  it('keeps the guarantee without the Navigation API: wrapped history, a replaced method noticed at completion', async t => {
    const page = await open(t, engine);
    await page.addScriptTag({ content: fixture });
    await page.evaluate(blobHarvest(false));
    await page.evaluate(`(async () => {
      await window.__held('/meta/return', () => { const a = location.href; history.pushState(null, '', '/feed/subscriptions'); history.pushState(null, '', a); window.__roundTrips = (window.__roundTrips || 0) + (location.href === a); });
      await window.__held('/meta/state', () => history.replaceState({ scroll: 1 }, ''));
      // Replaced while the read is pending and used for A→B→A: our wrappers never see it.
      await window.__held('/meta/replaced', () => { const a = location.href; ${replaceMethods} history.pushState(null, '', '/feed/subscriptions'); history.pushState(null, '', a); window.__roundTrips = (window.__roundTrips || 0) + (location.href === a); });
      await window.__load('/meta/after');
    })()`);
    await page.waitForFunction(`window.__seen.includes('/meta/after')`);
    assert.deepEqual(await page.evaluate('window.__seen'), ['/meta/current', '/meta/state', '/meta/after']);
    assert.equal(await page.evaluate('window.__roundTrips'), 2, 'both A→B→A cases end on the URL their read began on');
  });
});
