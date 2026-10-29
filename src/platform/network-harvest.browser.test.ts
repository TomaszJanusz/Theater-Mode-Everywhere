import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { it } from 'node:test';

import { chromium, firefox, type Page } from 'playwright';

import { sharedEngineBrowsers } from '../test-utils/engine-browsers';
import { BUNDLED_PROVIDERS, bundleModules } from '../test-utils/player-boot';
import { selectTestEngines } from '../test-utils/test-engines';

import { MAX_CAPTION_BYTES } from './media-url-policy';

const bundle = bundleModules([
  ...BUNDLED_PROVIDERS,
  "export { installMainWorldRuntime } from './platform/main-world-runtime';",
  "export { harvestYoutubeHeatmapText, harvestTimedtextJson, readYoutubeSnapshot } from './providers/youtube/player-main';",
  "export { readDisneySnapshot } from './providers/disney/main';",
  "export { readTencentSnapshot } from './providers/tencent/main';",
  "export { readTwitchSnapshot } from './providers/twitch/main';",
  "export { readCrunchyrollSnapshot } from './providers/crunchyroll/main';",
  "export { fetchWithoutHarvest } from './platform/harvest-ownership';",
  "export { createWorldMessage } from './protocol/world-messages';"
], 'HarvestTest');
const browsers = sharedEngineBrowsers();

async function setup(page: Page, pageUrl: string): Promise<void> {
  await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Fixture</title>' }));
  // Snapshot discovery can request skip data itself; isolate that owned read
  // from counters for the host response under test.
  await page.route('**/skip-events/**', route => route.fulfill({ status: 404, body: '' }));
  await page.goto(pageUrl);
  await page.evaluate(`(() => {
    window.counts = {clone:0, consumed:0, stringify:0, decode:0, includes:0, parse:0};
    window.resetCounts = () => Object.keys(window.counts).forEach(key => window.counts[key] = 0);
    const clones = new WeakSet();
    window.originalFetch = window.fetch;
    window.nativeFetch = window.fetch.bind(window);
    const clone = Response.prototype.clone;
    Response.prototype.clone = function() { window.counts.clone++; const result = clone.call(this); clones.add(result); if(result.body) { const getReader = result.body.getReader.bind(result.body); result.body.getReader = function() { window.counts.consumed++; return getReader(); }; } return result; };
    for (const method of ['text','json','arrayBuffer']) {
      const read = Response.prototype[method];
      Response.prototype[method] = function() { if (clones.has(this)) window.counts.consumed++; return read.apply(this, arguments); };
    }
    const stringify = JSON.stringify;
    JSON.stringify = function(value) { if (window.currentXhr && value === window.currentXhr.response) window.counts.stringify++; return stringify.apply(this, arguments); };
    const decode = TextDecoder.prototype.decode;
    TextDecoder.prototype.decode = function() { window.counts.decode++; return decode.apply(this, arguments); };
    const includes = String.prototype.includes;
    String.prototype.includes = function(needle) { if (needle === 'MARKER_TYPE_HEATMAP' || needle === 'HEATSEEKER' || needle === 'heatmapRenderer') window.counts.includes++; return includes.apply(this, arguments); };
    const parse = JSON.parse;
    JSON.parse = function(value) { if (typeof value === 'string' && value.length > 100000) window.counts.parse++; return parse.apply(this, arguments); };
    window.xhrLoad = (url, type) => new Promise((resolve, reject) => {
      const xhr = window.currentXhr || new XMLHttpRequest(); window.currentXhr = xhr;
      xhr.open('GET', url); xhr.responseType = type;
      xhr.onloadend = () => resolve(xhr.status); xhr.onerror = reject; xhr.send();
    });
  })()`);
  await page.addScriptTag({ content: `${bundle}\nwindow.HarvestTest = HarvestTest; document.documentElement.setAttribute('data-te-crunchyroll-integration-off', ''); HarvestTest.installMainWorldRuntime(); document.documentElement.removeAttribute('data-te-crunchyroll-integration-off');` });
}

async function respond(page: Page, url: string, body: string | Buffer, contentType = 'application/json', status = 200): Promise<void> {
  await page.route(url, route => route.fulfill({ status, contentType, body, headers: { 'access-control-allow-origin': '*' } }));
}

type Counts = { clone: number; consumed: number; stringify: number; decode: number; includes: number; parse: number };
const counts = (page: Page): Promise<Counts> => page.evaluate('window.counts');
const reset = (page: Page): Promise<void> => page.evaluate('window.resetCounts()');

for (const browserType of selectTestEngines([chromium, firefox], engine => engine.name())) {
  it(`${browserType.name()}: rejects unrelated fetch/XHR/heatmap before materialization and preserves fetch semantics`, { timeout: 60_000 }, async t => {
    if (!existsSync(browserType.executablePath())) { t.skip('Browser not installed'); return; }
    const page = await (await browsers[browserType.name() as 'chromium' | 'firefox'].newContext(t)).newPage();
    await setup(page, 'https://www.youtube.com/watch?v=abc');
    const unrelated = 'https://www.youtube.com/unrelated.json';
    const large = 'x'.repeat(4_194_304);
    await respond(page, unrelated, large);
    await reset(page);
    assert.equal(await page.evaluate(async url => (await (await fetch(url)).text()).length, unrelated), large.length);
    assert.equal((await counts(page)).clone, 0);
    assert.equal((await counts(page)).includes, 0);
    await page.evaluate(`HarvestTest.harvestYoutubeHeatmapText('${unrelated}', 'MARKER_TYPE_HEATMAP' + 'x'.repeat(4194304))`);
    assert.equal((await counts(page)).parse, 0);
    const arrayUrl = 'https://www.youtube.com/bytes';
    await respond(page, arrayUrl, Buffer.alloc(8 * 1024 * 1024), 'application/octet-stream');
    await page.evaluate(url => window.eval(`window.xhrLoad(${JSON.stringify(url)}, 'arraybuffer')`), arrayUrl);
    const jsonUrl = 'https://www.youtube.com/unrelated-object.json';
    await respond(page, jsonUrl, '{"a":1}');
    await page.evaluate(url => window.eval(`window.xhrLoad(${JSON.stringify(url)}, 'json')`), jsonUrl);
    assert.deepEqual(await counts(page), { clone: 0, consumed: 0, stringify: 0, decode: 0, includes: 0, parse: 0 });

    const timedtext = 'https://www.youtube.com/api/timedtext?v=abc&lang=en&pot=fixture&fmt=json3';
    const captions = '{"events":[{"tStartMs":0,"dDurationMs":1000,"segs":[{"utf8":"Hello"}]}]}';
    await respond(page, timedtext, captions);
    await reset(page);
    assert.deepEqual(await page.evaluate(async url => (await fetch(url)).json(), timedtext), JSON.parse(captions));
    await page.waitForFunction(() => Boolean(document.getElementById('theater-everywhere-youtube-caption-auth')?.textContent?.includes('fixture')));
    assert.equal((await counts(page)).clone, 1);
    assert.equal((await counts(page)).consumed, 1);
    const jsonTimedtext = timedtext.replace('pot=fixture', 'pot=json-xhr');
    await respond(page, jsonTimedtext, captions);
    await reset(page);
    await page.evaluate(url => window.eval(`window.xhrLoad(${JSON.stringify(url)}, 'json')`), jsonTimedtext);
    assert.equal((await counts(page)).stringify, 0);
    assert.equal((await counts(page)).decode, 0);
    assert.equal(await page.evaluate(() => Boolean(document.getElementById('theater-everywhere-youtube-caption-auth')?.textContent?.includes('json-xhr'))), true);
    await reset(page);
    await page.evaluate(url => window.eval(`HarvestTest.fetchWithoutHarvest(${JSON.stringify(url)}).then(r => r.text())`), timedtext);
    assert.equal((await counts(page)).clone, 0);
    await page.evaluate(() => document.documentElement.setAttribute('data-te-youtube-integration-off', ''));
    await reset(page);
    await page.evaluate(async url => (await fetch(url)).text(), timedtext);
    await page.evaluate(`HarvestTest.harvestYoutubeHeatmapText('https://www.youtube.com/youtubei/v1/next', 'MARKER_TYPE_HEATMAP' + 'x'.repeat(4194304))`);
    assert.equal((await counts(page)).clone, 0);
    assert.equal((await counts(page)).includes, 0);
    assert.equal((await counts(page)).parse, 0);
    await page.evaluate(() => document.documentElement.removeAttribute('data-te-youtube-integration-off'));

    const redirect = 'https://www.youtube.com/redirect';
    // Simulate a transport-supplied redirected Response. Playwright routes do
    // not intercept follow-up URLs of a fulfilled 302; no real host is used.
    await page.evaluate(({ body, finalUrl }) => window.eval(`window.fetch = function() { const response = new Response(${JSON.stringify(body)}); Object.defineProperty(response, 'url', {value:${JSON.stringify(finalUrl)}}); Object.defineProperty(response, 'redirected', {value:true}); return Promise.resolve(response); };`), { body: captions, finalUrl: timedtext });
    await reset(page);
    const streamed = await page.evaluate(async url => {
      const response = await fetch(url); const reader = response.body!.getReader(); const decoder = new TextDecoder(); let body = '';
      for (;;) { const { done, value } = await reader.read(); if (done) break; body += decoder.decode(value); }
      return { body, redirected: response.redirected };
    }, redirect);
    assert.deepEqual(streamed, { body: captions, redirected: true });
    assert.equal((await counts(page)).clone, 1);
    await page.evaluate('window.fetch = window.nativeFetch');
    const failed = 'https://www.youtube.com/api/timedtext?v=abc&lang=fr';
    await respond(page, failed, 'failed', 'text/plain', 500);
    await reset(page);
    assert.equal(await page.evaluate(async url => (await (await fetch(url)).text()), failed), 'failed');
    assert.equal((await counts(page)).clone, 0);
    await page.route('https://www.youtube.com/network-error', route => route.abort());
    assert.equal(await page.evaluate(async () => { try { await fetch('/network-error'); return false; } catch { return true; } }), true);
    await page.evaluate(`window.fetch = function() { throw new Error('sync-host-error'); };`);
    assert.equal(await page.evaluate(`(() => {try {fetch('test');} catch(error) {return error.message;}})()`), 'sync-host-error');
    await page.evaluate(`window.fetch = function() { return Promise.resolve(new Response('replacement')); };`);
    await reset(page);
    assert.equal(await page.evaluate(async () => (await (await fetch('/unrelated')).text())), 'replacement');
    assert.equal((await counts(page)).clone, 0);
    assert.equal((await counts(page)).includes, 0, 'known request URL rejects a URL-less replacement response');
    await page.evaluate('window.fetch = window.nativeFetch');
    await respond(page, unrelated, '{invalid JSON');
    assert.equal(await page.evaluate(async url => {
      try { await (await fetch(url)).json(); return false; } catch (error) { return error instanceof SyntaxError; }
    }, unrelated), true);
    assert.equal(await page.evaluate(async url => {
      const response = await fetch(url); await response.text();
      try { await response.text(); return false; } catch (error) { return error instanceof TypeError; }
    }, unrelated), true);
    await page.evaluate(`(() => {
      window.forwarded = null;
      window.fetch = function(input, init) { window.forwarded = {input, init, receiver:this}; return Promise.resolve(new Response('arguments')); };
    })()`);
    assert.equal(await page.evaluate(async () => {
      const request = new Request('https://www.youtube.com/unrelated', { method: 'POST', body: 'host-body' });
      const init = { credentials: 'include' as const }; const receiver = {};
      const response = await window.fetch.call(receiver, request, init);
      return window.eval('window.forwarded').input === request && window.eval('window.forwarded').init === init
        && window.eval('window.forwarded').receiver === receiver && !request.bodyUsed && await response.text() === 'arguments';
    }), true);
  });

  it(`${browserType.name()}: positive provider metadata works as fetch text and XHR JSON before theater; off rejects body work`, { timeout: 60_000 }, async t => {
    if (!existsSync(browserType.executablePath())) { t.skip('Browser not installed'); return; }
    const samples = [
      { page: 'https://www.disneyplus.com/play/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', endpoint: 'https://disney.api.edge.bamgrid.com/playback', body: { runtimeMillis: 1200000 }, reader: 'readDisneySnapshot', field: 'duration', value: 1200, provider: 'disney' },
      { page: 'https://wetv.vip/en/play/cover/h0045v8ky1m-EP1', endpoint: 'https://play.wetv.vip/getvinfo', body: { em: 0, vl: { vi: [{ vid: 'h0045v8ky1m', ti: 'Fixture title', td: '2564' }] } }, reader: 'readTencentSnapshot', field: 'title', value: 'Fixture title', provider: 'tencent' },
      { page: 'https://www.crunchyroll.com/watch/G12345678', endpoint: 'https://www.crunchyroll.com/content/v2/cms/objects/G12345678', body: { data: [{ id: 'G12345678', title: 'Fixture title' }] }, reader: 'readCrunchyrollSnapshot', field: 'title', value: 'Fixture title', provider: 'crunchyroll' },
      { page: 'https://www.twitch.tv/videos/123', endpoint: 'https://gql.twitch.tv/gql', body: { data: { video: { id: '123', lengthSeconds: 1200, title: 'Fixture title', captions: 'https://captions.twitch.tv/123/en/caption.vtt' } } }, reader: 'readTwitchSnapshot', field: 'duration', value: 1200, provider: 'twitch' }
    ];
    for (const sample of samples) {
      const page = await (await browsers[browserType.name() as 'chromium' | 'firefox'].newContext(t)).newPage(); await setup(page, sample.page);
      if (sample.provider === 'twitch') {
        assert.equal(await page.evaluate('window.fetch === window.originalFetch'), true);
        assert.equal(await page.evaluate(`(() => {
          const response = new Response('{}');
          const pending = Object.assign(Promise.resolve(response), {abort: () => 42});
          const saved = window.fetch; const replacement = () => pending; window.fetch = replacement;
          const result = fetch('https://gql.twitch.tv/gql');
          const preserved = window.fetch === replacement && result === pending && result.abort() === 42;
          window.fetch = saved; return preserved;
        })()`), true);
      }
      await respond(page, sample.endpoint, JSON.stringify(sample.body));
      await reset(page);
      await page.evaluate(url => window.eval(`window.xhrLoad(${JSON.stringify(url)}, 'json')`), sample.endpoint);
      assert.equal((await counts(page)).stringify, 0);
      assert.equal((await counts(page)).decode, 0, sample.provider);
      assert.equal((await counts(page)).includes, 0);
      assert.equal(await page.evaluate(`HarvestTest.${sample.reader}()?.${sample.field}`), sample.value, `${sample.provider} JSON`);
      if (sample.provider === 'twitch') assert.equal(await page.evaluate('HarvestTest.readTwitchSnapshot()?.captionTracks?.some(track => track.url.includes("123/en/caption.vtt"))'), true);
      const cloneExpected = sample.provider === 'twitch' ? 0 : 1;
      await reset(page);
      await page.evaluate(async url => (await (await fetch(url)).text()), sample.endpoint);
      if (cloneExpected) await page.waitForFunction(() => window.eval('window.counts.clone === 1 && window.counts.consumed === 1'));
      assert.equal((await counts(page)).clone, cloneExpected, sample.provider);
      const unrelated = new URL('/unrelated', sample.page).href;
      await respond(page, unrelated, Buffer.alloc(8 * 1024 * 1024), 'application/octet-stream');
      await reset(page);
      await page.evaluate(url => window.eval(`window.xhrLoad(${JSON.stringify(url)}, 'arraybuffer')`), unrelated);
      assert.equal((await counts(page)).decode, 0, sample.provider);
      await page.evaluate(provider => document.documentElement.setAttribute(`data-te-${provider}-integration-off`, ''), sample.provider);
      await reset(page);
      await page.evaluate(url => window.eval(`window.xhrLoad(${JSON.stringify(url)}, 'json')`), sample.endpoint);
      await page.evaluate(async url => (await (await fetch(url)).text()), sample.endpoint);
      assert.deepEqual(await counts(page), { clone: 0, consumed: 0, stringify: 0, decode: 0, includes: 0, parse: 0 }, `${sample.provider} off`);
      await page.close();
    }
  });
  it(`${browserType.name()}: snapshot publishes walk the page data for a heatmap once per object`, { timeout: 60_000 }, async t => {
    if (!existsSync(browserType.executablePath())) { t.skip('Browser not installed'); return; }
    const page = await (await browsers[browserType.name() as 'chromium' | 'firefox'].newContext(t)).newPage(); await setup(page, 'https://www.youtube.com/watch?v=abc');
    const walks = async () => await page.evaluate('window.walks') as number;
    await page.evaluate(`(() => {
      window.walks = 0;
      window.ytInitialData = { contents: { get probe() { window.walks++; return {}; } } };
    })()`);
    const trace: number[] = [];
    for (let i = 0; i < 4; i++) { await page.evaluate('HarvestTest.readYoutubeSnapshot()'); trace.push(await walks()); }
    assert.deepEqual(trace, [1, 1, 1, 1], 'one walk for repeated publishes');
    await page.evaluate(`void (window.ytInitialData = { contents: { get probe() { window.walks++; return {}; } } })`);
    await page.evaluate('HarvestTest.readYoutubeSnapshot()');
    assert.equal(await walks(), 2, 'a replaced object is read again');
    await page.evaluate(`void (window.ytInitialData = { videoDetails: { videoId: 'abc' }, markersList: { markerType: 'MARKER_TYPE_HEATMAP', markers: [
      { startMillis: 0, durationMillis: 1000, intensityScoreNormalized: 0.5 },
      { startMillis: 1000, durationMillis: 1000, intensityScoreNormalized: 1 }
    ] } })`);
    assert.equal(await page.evaluate('HarvestTest.readYoutubeSnapshot()?.heatmap?.segments?.length'), 2);
    assert.equal(await page.evaluate('HarvestTest.readYoutubeSnapshot()?.heatmap?.segments?.length'), 2, 'a found heatmap stays available');
    await page.close();
  });
  it(`${browserType.name()}: heatmap scans only qualified text and JSON; BIF stays binary`, { timeout: 60_000 }, async t => {
    if (!existsSync(browserType.executablePath())) { t.skip('Browser not installed'); return; }
    const page = await (await browsers[browserType.name() as 'chromium' | 'firefox'].newContext(t)).newPage(); await setup(page, 'https://www.youtube.com/watch?v=abc');
    const heatmap = { videoDetails: { videoId: 'abc' }, markersList: { markerType: 'MARKER_TYPE_HEATMAP', markers: [
      { startMillis: 0, durationMillis: 1000, intensityScoreNormalized: 0.5 },
      { startMillis: 1000, durationMillis: 1000, intensityScoreNormalized: 1 }
    ] } };
    const endpoint = 'https://www.youtube.com/youtubei/v1/next';
    await reset(page);
    await page.evaluate(`HarvestTest.harvestYoutubeHeatmapText('${endpoint}', 'MARKER_TYPE_HEATMAP' + 'x'.repeat(4194304))`);
    assert.equal((await counts(page)).includes, 0, 'non-JSON format');
    assert.equal((await counts(page)).parse, 0);
    await respond(page, endpoint, JSON.stringify(heatmap));
    await reset(page);
    await page.evaluate(url => window.eval(`window.xhrLoad(${JSON.stringify(url)}, 'json')`), endpoint);
    assert.equal((await counts(page)).includes, 0);
    assert.equal((await counts(page)).stringify, 0);
    assert.equal(await page.evaluate('HarvestTest.readYoutubeSnapshot()?.heatmap?.segments?.length'), 2);
    await reset(page);
    await page.evaluate(url => window.eval(`window.xhrLoad(${JSON.stringify(url)}, 'text')`), endpoint);
    assert.equal((await counts(page)).includes, 1);
    await reset(page);
    await page.evaluate(async url => (await (await fetch(url)).text()), endpoint);
    // The host's own text() read is the only consumer: the wrapper must not clone.
    assert.equal((await counts(page)).clone, 0);
    assert.equal((await counts(page)).includes, 1);
    // A URL-less response from an alternative host transport still harvests.
    await page.evaluate(data => new Response(JSON.stringify(data)).json(), heatmap);
    assert.equal(await page.evaluate('HarvestTest.readYoutubeSnapshot()?.heatmap?.segments?.length'), 2);
    const frameNavigation = page.waitForEvent('framenavigated', frame => frame.url().includes('/embed/abc'));
    await page.evaluate(() => { const iframe = document.createElement('iframe'); iframe.src = '/embed/abc'; document.body.append(iframe); });
    const frame = await frameNavigation;
    await frame.addScriptTag({ content: `${bundle}\nwindow.HarvestTest = HarvestTest;` });
    await frame.evaluate(data => window.eval(`HarvestTest.harvestTimedtextJson('https://www.youtube.com/api/timedtext?v=abc&lang=en&pot=frame-json&fmt=json3', ${JSON.stringify(data)})`), { events: [] });
    await page.waitForFunction(() => Boolean(document.getElementById('theater-everywhere-youtube-caption-auth')?.textContent?.includes('frame-json')));
    await page.close();

    const count = 8;
    const header = 64 + (count + 1) * 8;
    const bytes = Buffer.alloc(header + count * 2);
    bytes.set([0x89, 0x42, 0x49, 0x46, 0x0d, 0x0a, 0x1a, 0x0a]);
    bytes.writeUInt32LE(count, 12); bytes.writeUInt32LE(10000, 16);
    for (let i = 0; i < count; i++) { bytes.writeUInt32LE(i, 64 + i * 8); bytes.writeUInt32LE(header + i * 2, 68 + i * 8); }
    bytes.writeUInt32LE(0xffffffff, 64 + count * 8); bytes.writeUInt32LE(bytes.length, 68 + count * 8);
    for (const provider of ['disney', 'crunchyroll']) {
      const page = await (await browsers[browserType.name() as 'chromium' | 'firefox'].newContext(t)).newPage();
      const pageUrl = provider === 'disney' ? 'https://www.disneyplus.com/play/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' : 'https://www.crunchyroll.com/watch/GR7592K3Y';
      const bif = provider === 'disney' ? 'https://cdn.dssott.com/thumbnails/movie.bif' : 'https://vod-fy-mod.crunchyrollcdn.com/static/e00177755a00269347jajp/1/clean/bif-1789659236.bif?t=fake-signature';
      const reader = provider === 'disney' ? 'readDisneySnapshot' : 'readCrunchyrollSnapshot';
      await setup(page, pageUrl);
      // Bind Crunchyroll's asset through its real playback parser before BIF.
      if (provider === 'crunchyroll') {
        const playback = 'https://www.crunchyroll.com/playback/v3/GR7592K3Y/web/chrome/play';
        await respond(page, playback, JSON.stringify({ assetId: 'e00177755a00269347jajp', url: 'https://www.crunchyroll.com/playback/v2/manifest/GR7592K3Y/static/e00177755a00269347jajp/1/clean/dash/manifest.mpd' }));
        await page.evaluate(url => window.eval(`window.xhrLoad(${JSON.stringify(url)}, 'json')`), playback);
      }
      await respond(page, bif, bytes, 'application/octet-stream');
      await reset(page);
      await page.evaluate(url => window.eval(`window.xhrLoad(${JSON.stringify(url)}, 'arraybuffer')`), bif);
      assert.equal((await counts(page)).decode, 0, `${provider} BIF`);
      assert.equal((await counts(page)).includes, 0);
      assert.equal(await page.evaluate(`Boolean(HarvestTest.${reader}()?.bifBlobUrl)`), true, provider);
      await reset(page);
      assert.equal(await page.evaluate(async url => (await (await fetch(url)).arrayBuffer()).byteLength, bif), bytes.length);
      await page.waitForFunction(() => window.eval('window.counts.clone === 1 && window.counts.consumed === 1'));
      assert.equal((await counts(page)).decode, 0, `${provider} fetch BIF`);
      await page.evaluate(`HarvestTest.harvestYoutubeHeatmapText('', 'MARKER_TYPE_HEATMAP' + 'x'.repeat(4194304))`);
      assert.equal((await counts(page)).includes, 0, 'wrong host');
      await page.evaluate(provider => document.documentElement.setAttribute(`data-te-${provider}-integration-off`, ''), provider);
      await reset(page);
      await page.evaluate(url => window.eval(`window.xhrLoad(${JSON.stringify(url)}, 'arraybuffer')`), bif);
      await page.evaluate(async url => (await (await fetch(url)).arrayBuffer()).byteLength, bif);
      assert.equal((await counts(page)).clone, 0);
      assert.equal((await counts(page)).decode, 0);
      await page.close();
    }
  });

  it(`${browserType.name()}: qualified consumers stop their clone at the text/BIF cap while host playback bytes survive`, { timeout: 60_000 }, async t => {
    if (!existsSync(browserType.executablePath())) { t.skip('Browser not installed'); return; }
    const samples = [
      { page: 'https://www.youtube.com/watch?v=abc', endpoint: 'https://www.youtube.com/api/timedtext?v=abc&lang=en', cap: MAX_CAPTION_BYTES },
      { page: 'https://www.disneyplus.com/play/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', endpoint: 'https://disney.api.edge.bamgrid.com/playback', cap: MAX_CAPTION_BYTES },
      { page: 'https://wetv.vip/en/play/cover/h0045v8ky1m-EP1', endpoint: 'https://play.wetv.vip/getvinfo', cap: MAX_CAPTION_BYTES },
      { page: 'https://www.disneyplus.com/play/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', endpoint: 'https://cdn.dssott.com/thumbnails/movie.bif', cap: 16 * 1024 * 1024 }
    ];
    for (const sample of samples) {
      const page = await (await browsers[browserType.name() as 'chromium' | 'firefox'].newContext(t)).newPage(); await setup(page, sample.page);
      await page.evaluate(({ endpoint, cap }) => window.eval(`(() => {
        window.cancelledClones = 0; window.cloneBytes = 0;
        const originalClone = Response.prototype.clone;
        Response.prototype.clone = function() {
          const clone = originalClone.call(this), getReader = clone.body.getReader.bind(clone.body);
          clone.body.getReader = function() {
            const reader = getReader(), read = reader.read.bind(reader), cancel = reader.cancel.bind(reader);
            reader.read = () => read().then(result => { window.cloneBytes += result.value?.byteLength || 0; return result; });
            reader.cancel = () => { window.cancelledClones++; return cancel(); };
            return reader;
          };
          return clone;
        };
        const chunk = 256 * 1024, total = ${cap} + chunk; let produced = 0;
        const response = new Response(new ReadableStream({pull(c) {
          if (produced === total) { c.close(); return; }
          produced += chunk; c.enqueue(new Uint8Array(chunk).fill(65));
        }}, {highWaterMark:0}), {headers:{'content-length':'1','content-type':'application/octet-stream'}});
        Object.defineProperty(response, 'url', {value:${JSON.stringify(endpoint)}});
        window.fetch = () => Promise.resolve(response);
        window.hostResponse = fetch(${JSON.stringify(endpoint)});
      })()`), sample);
      await page.waitForFunction('window.cancelledClones === 1');
      assert.equal(await page.evaluate('window.cloneBytes'), sample.cap + 256 * 1024);
      assert.deepEqual(await page.evaluate(`(async () => {
        const original = await (await window.hostResponse).arrayBuffer();
        return {length:original.byteLength, valid:new Uint8Array(original).every(byte => byte === 65)};
      })()`), { length: sample.cap + 256 * 1024, valid: true });
      assert.equal((await counts(page)).clone, 1);
      await page.close();
    }
  });

  it(`${browserType.name()}: MAIN page fetch bounds owned bodies, preserves BIF budget, and rejects navigation before headers`, { timeout: 30_000 }, async t => {
    if (!existsSync(browserType.executablePath())) { t.skip('Browser not installed'); return; }
    const page = await (await browsers[browserType.name() as 'chromium' | 'firefox'].newContext(t)).newPage();
    await setup(page, 'https://www.disneyplus.com/play/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
    const results = await page.evaluate(`(async () => {
      let sequence = 0, cancelled = 0;
      const request = url => new Promise(resolve => {
        const message = HarvestTest.createWorldMessage('PAGE_FETCH', {url}, 'bounded-' + ++sequence);
        const {port1, port2} = new MessageChannel();
        port1.onmessage = event => {
          port1.close(); resolve(event.data.payload);
        };
        window.dispatchEvent(new MessageEvent('message', {data:message, origin:location.origin, source:window, ports:[port2]}));
      });
      const caption = 'https://cdn.dssott.com/captions/en.vtt';
      const bif = 'https://cdn.dssott.com/thumbnails/movie.bif';
      const text = ${JSON.stringify('WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nHello')};
      const response = (body, url, init) => { const result = new Response(body, init); Object.defineProperty(result, 'url', {value:url}); return result; };
      window.fetch = () => Promise.resolve(response(text, caption));
      const valid = await request(caption);
      window.fetch = () => Promise.resolve(response(new ReadableStream({
        pull(c) { c.enqueue(new Uint8Array(${MAX_CAPTION_BYTES} + 1)); }, cancel() {cancelled++;}
      }, {highWaterMark:0}), caption, {headers:{'content-length':'1'}}));
      const oversized = await request(caption);
      const bifSize = ${MAX_CAPTION_BYTES} + 1;
      window.fetch = () => Promise.resolve(response(new Uint8Array(bifSize), bif));
      const binary = await request(bif);
      const binarySize = (await (await window.nativeFetch(binary.body)).arrayBuffer()).byteLength;
      URL.revokeObjectURL(binary.body);
      let headers;
      window.fetch = () => new Promise(resolve => {headers = resolve;});
      const stale = request(caption);
      history.pushState(null, '', '/play/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
      headers(response(new ReadableStream({cancel() {cancelled++;}}), caption));
      return {valid, oversized, binaryOk:binary.ok, binarySize, stale:await stale, cancelled};
    })()`);
    assert.deepEqual(results, {
      valid: { ok: true, body: 'WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nHello' },
      oversized: { ok: false, body: undefined }, binaryOk: true, binarySize: MAX_CAPTION_BYTES + 1,
      stale: { ok: false, body: undefined }, cancelled: 2
    });
    assert.equal((await counts(page)).clone, 0, 'extension-owned reads do not reenter host harvest');
  });

}
