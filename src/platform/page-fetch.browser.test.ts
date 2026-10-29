import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { it } from 'node:test';

import { chromium, firefox } from 'playwright';

import { PROVIDER_ENTRIES, bundleModules } from '../test-utils/player-boot';
import { sharedTestBrowser } from '../test-utils/test-browser';
import { selectTestEngines } from '../test-utils/test-engines';

const exports = [
  "export { installMainWorldRuntime } from './platform/main-world-runtime';",
  "export { requestPageFetch } from './media-features/probe';",
  "export { fetchPageMedia } from './platform/page-fetch';",
  "export { createWorldMessage } from './protocol/world-messages';",
  "export { readCachedTimedtextBody } from './providers/youtube/player-main';",
  "export { readBoundedBytes } from './platform/bounded-body';",
  "export { readPageResponseBytes } from './platform/page-body';"
];
// Fixture pages register YouTube's MAIN hooks as the shipped scripts do; the installed extension already has its own.
const bundle = bundleModules([...PROVIDER_ENTRIES, ...exports], 'BridgeTest');
const installedRequester = bundleModules(exports, 'BridgeTest');

for (const engine of selectTestEngines([chromium, firefox], engine => engine.name())) {
  const shared = sharedTestBrowser(engine);
  it(`${engine.name()}: private replies reject window forgeries and close on timeout`, { timeout: 30_000 }, async t => {
    if (!existsSync(engine.executablePath())) { t.skip('Browser not installed'); return; }
    const context = await shared.newContext(t);
    const page = await context.newPage();
    await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Fixture</title>' }));
    await page.goto('https://www.patreon.com/posts/123');
    await page.addScriptTag({ content: bundle });
    const result = await page.evaluate(`(async () => {
      BridgeTest.installMainWorldRuntime();
      const url = 'https://image.mux.com/abc/storyboard.vtt';
      let observed = 0, release;
      // These represent host listeners installed after our document_start broker.
      window.addEventListener('message', event => { if (event.data?.type === 'PAGE_FETCH') observed++; }, true);
      window.addEventListener('message', event => { if (event.data?.type === 'PAGE_FETCH_RESULT' && event.data.payload.body === 'genuine') observed++; });
      const nativePost = window.postMessage.bind(window);
      window.postMessage = (request, origin, ports) => {
        if (request.type === 'PAGE_FETCH') {
          // Even full knowledge of the envelope cannot forge a private reply.
          nativePost(BridgeTest.createWorldMessage('PAGE_FETCH_RESULT', {ok:true, body:'forged'}, request.requestId, request.nonce, request.origin), '*');
        }
        return nativePost(request, origin, ports);
      };
      let fetched;
      const started = new Promise(resolve => { fetched = resolve; });
      window.fetch = () => new Promise(resolve => { release = resolve; fetched(); });
      let settled = false;
      const pending = BridgeTest.requestPageFetch(url).then(body => { settled = true; return body; });
      await started;
      // A task boundary after the forged window message, without a timing sleep.
      await new Promise(resolve => { const channel = new MessageChannel(); channel.port1.onmessage = () => {
        channel.port1.close(); channel.port2.close(); resolve();
      }; channel.port2.postMessage(null); });
      const forgedResolved = settled;
      const response = new Response('genuine'); Object.defineProperty(response, 'url', {value:url}); release(response);
      const genuine = await pending;
      // Exercise timeout cleanup with an injected clock and an observable request.
      let expire;
      const nativeTimer = window.setTimeout;
      window.setTimeout = callback => { expire = callback; return 0; };
      const timedOut = BridgeTest.requestPageFetch(url);
      window.setTimeout = nativeTimer;
      expire();
      const timeout = await timedOut;
      return {forgedResolved, genuine, observed, timeout};
    })()`);
    assert.deepEqual(result, { forgedResolved: false, genuine: 'genuine', observed: 0, timeout: null });
  });

  it(`${engine.name()}: every provider rejects off-allowlist redirects before consuming the body`, { timeout: 30_000 }, async t => {
    if (!existsSync(engine.executablePath())) { t.skip('Browser not installed'); return; }
    const context = await shared.newContext(t);
    const page = await context.newPage();
    await page.route('https://example.com/', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Fixture</title>' }));
    await page.goto('https://example.com');
    await page.addScriptTag({ content: bundle });
    const result = await page.evaluate(`(async () => {
      const urls = [
        'https://www.youtube.com/api/timedtext?v=abc&lang=en&pot=token',
        'https://image.mux.com/abc/storyboard.vtt',
        'https://stream.mux.com/abc/text/en.vtt',
        'https://captions.twitch.tv/abc.vtt',
        'https://cdn.dssott.com/captions/en.vtt',
        'https://cdn.dssott.com/thumbnails/abc.bif',
        'https://aisubtitle.hdslb.com/bfs/ai_subtitle/abc.json',
        'https://s.bstarstatic.com/ogv/subtitle/c350955fde09ca9f62098c78ddf0add4.ass',
        'https://subtitle.wetvinfo.com/abc.vtt',
        'https://vod-fy-mod.crunchyrollcdn.com/static/e00177755a00269347jajp/1/clean/subtitle-667360-en-US-1789593448.ass'
      ];
      const results = [];
      for (const url of urls) {
        let cancelled = 0, read = 0;
        window.fetch = async () => {
          const response = new Response(new ReadableStream({pull() {read++;}, cancel() {cancelled++;}}, {highWaterMark:0}));
          Object.defineProperty(response, 'url', {value:'https://untrusted.example/forged.vtt'}); return response;
        };
        const rejected = await BridgeTest.fetchPageMedia(url, {credentials:'omit'});
        // Valid final URLs must keep working through the same shared path.
        window.fetch = async () => { const response = new Response('valid'); Object.defineProperty(response, 'url', {value:url}); return response; };
        const valid = await BridgeTest.fetchPageMedia(url, {credentials:'omit'});
        results.push({url, rejected:rejected === null, cancelled, read, valid:valid && await valid.text()});
      }
      return results;
    })()`);
    for (const row of result as Array<{ url: string; rejected: boolean; cancelled: number; read: number; valid: string }>) {
      assert.deepEqual({ ...row, url: undefined }, { url: undefined, rejected: true, cancelled: 1, read: 0, valid: 'valid' }, row.url);
    }
  });

  it(`${engine.name()}: timedtext harvest accepts a child and ignores self, null and unrelated sources`, { timeout: 30_000 }, async t => {
    if (!existsSync(engine.executablePath())) { t.skip('Browser not installed'); return; }
    const context = await shared.newContext(t);
    const page = await context.newPage();
    await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><iframe src="/child"></iframe>' }));
    await page.goto('https://www.youtube.com/watch?v=abc');
    await page.addScriptTag({ content: bundle });
    const result = await page.evaluate(`(() => {
      BridgeTest.installMainWorldRuntime();
      const url = 'https://www.youtube.com/api/timedtext?v=abc&lang=en';
      const body = JSON.stringify({events:[{tStartMs:0,dDurationMs:1000,segs:[{utf8:'hello'}]}]});
      const send = source => window.dispatchEvent(new MessageEvent('message', {source, origin:location.origin,
        data:{type:'theater-everywhere-timedtext-body', record:{url, body}}}));
      send(window); send(null);
      const detached = document.createElement('iframe'); document.body.append(detached);
      const unrelated = detached.contentWindow; detached.remove(); send(unrelated);
      const rejected = BridgeTest.readCachedTimedtextBody(url);
      send(document.querySelector('iframe').contentWindow);
      return {rejected, accepted:BridgeTest.readCachedTimedtextBody(url), body};
    })()`);
    const report = result as { rejected: string | null; accepted: string | null; body: string };
    assert.equal(report.rejected, null);
    assert.equal(report.accepted, report.body);
  });

  it(`${engine.name()}: abandoning synthetic and HTTP fetch clones leaves the original readable`, { timeout: 30_000 }, async t => {
    if (!existsSync(engine.executablePath())) { t.skip('Browser not installed'); return; }
    const bytes = Buffer.alloc(512 * 1024, 65);
    const server = createServer((req, res) => {
      if (req.url === '/redirect') { res.writeHead(302, { location: '/body' }); res.end(); }
      else if (req.url === '/body') { res.writeHead(200, { 'content-type': 'application/octet-stream' }); res.end(bytes); }
      else { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<!doctype html><title>Fixture</title>'); }
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(() => { server.closeAllConnections(); server.close(); });
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const context = await shared.newContext(t);
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${address.port}`);
    await page.addScriptTag({ content: bundle });
    const result = await page.evaluate(`(async () => {
      const results = [];
      for (const response of [new Response('abcdefghijk'), await fetch('/redirect')]) {
        const clone = response.clone();
        const bounded = await BridgeTest.readBoundedBytes(clone, 4);
        // This line is reached before the original starts reading: awaiting the
        // tee branch's cancel promise would deadlock here in both browsers.
        const original = await response.text();
        results.push({bounded, length:original.length, valid:/^A+$/.test(original) || original === 'abcdefghijk', redirected:response.redirected});
      }
      return results;
    })()`);
    assert.deepEqual(result, [
      { bounded: null, length: 11, valid: true, redirected: false },
      { bounded: null, length: bytes.length, valid: true, redirected: true }
    ]);
  });

  it(`${engine.name()}: cancels page reads on navigation/abort and rejects a changed URL on continuation`, { timeout: 30_000 }, async t => {
    if (!existsSync(engine.executablePath())) { t.skip('Browser not installed'); return; }
    const context = await shared.newContext(t);
    const page = await context.newPage();
    await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html>' }));
    await page.goto('https://fixture.example/first');
    await page.addScriptTag({ content: bundle });
    for (const change of [
      `window.dispatchEvent(new Event('pagehide'))`,
      `history.pushState(null, '', '/next'); window.dispatchEvent(new PopStateEvent('popstate'))`,
      `window.dispatchEvent(new Event('yt-navigate-start'))`,
      `document.dispatchEvent(new Event('yt-navigate-start'))`,
      `controller.abort()`,
      // No navigation event: identity must still be rechecked on continuation.
      `history.replaceState(null, '', '/replaced'); deliver.enqueue(new Uint8Array(1))`
    ]) {
      await page.evaluate(`history.replaceState(null, '', '/first')`);
      assert.deepEqual(await page.evaluate(`(async () => {
        const controller = new AbortController(); let cancelled = 0, deliver;
        const body = new ReadableStream({start(c) {deliver = c;}, cancel() {cancelled++;}});
        const result = BridgeTest.readPageResponseBytes({body}, 8, controller.signal, { navigationStart: ['yt-navigate-start'] });
        ${change};
        return {result:await result, cancelled, locked:body.locked};
      })()`), { result: null, cancelled: 1, locked: false });
    }
  });
}

// Diagnostic requester in the installed extension's actual isolated world. This
// checks the production MAIN listener and port transfer, not just a shared realm.
it('chromium: installed MAIN broker replies privately to the extension isolated world', { timeout: 60_000 }, async t => {
  const extension = path.resolve('dist/chrome-unpacked');
  if (!existsSync(path.join(extension, 'manifest.json'))) { t.skip('Run pnpm build first'); return; }
  if (!existsSync(chromium.executablePath())) { t.skip('Browser not installed'); return; }
  const profile = mkdtempSync(path.join(tmpdir(), 'te-page-fetch-'));
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium', headless: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]
  });
  t.after(async () => { await context.close(); rmSync(profile, { recursive: true, force: true }); }, { timeout: 10_000 });
  const page = await context.newPage();
  await page.route('https://www.patreon.com/**', route => route.fulfill({
    contentType: 'text/html', body: `<!doctype html><script>
      window.observed = 0;
      addEventListener('message', event => {
        if (event.data?.type === 'PAGE_FETCH') {
          window.observed++;
          event.ports[0]?.postMessage({...event.data, type:'PAGE_FETCH_RESULT', payload:{ok:true, body:'port-forgery'}});
        }
      }, true);
    </script><title>Bridge fixture</title>`
  }));
  await page.route('https://image.mux.com/abc/storyboard.vtt', route => route.fulfill({
    contentType: 'text/vtt', body: 'genuine', headers: {'access-control-allow-origin':'*'}
  }));
  const cdp = await context.newCDPSession(page);
  // Navigation can finish before Chromium creates the extension's isolated
  // world. Subscribe before navigating instead of scanning a one-time snapshot.
  const extensionWorld = new Promise<{ id: number }>(resolve => {
    cdp.on('Runtime.executionContextCreated', ({ context: world }) => {
      const isDefault: unknown = world.auxData?.isDefault;
      if (isDefault === false && world.origin.startsWith('chrome-extension://')) {
        resolve(world);
      }
    });
  });
  await cdp.send('Runtime.enable');
  await page.goto('https://www.patreon.com/posts/123');
  const content = await extensionWorld;
  const probe = await cdp.send('Runtime.evaluate', {
    contextId: content.id, returnByValue: true,
    expression: 'typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.id'
  });
  assert.equal(typeof probe.result.value, 'string', 'isolated world belongs to the installed extension');
  // Diagnostic interception supplies the exact envelope to the forgery, while
  // retaining the installed extension's isolated-world MessagePorts and XHRs.
  const result = await cdp.send('Runtime.evaluate', {
    contextId: content.id, awaitPromise: true, returnByValue: true,
    expression: `${installedRequester}; (() => {
      const post = window.postMessage.bind(window);
      window.postMessage = (message, origin, ports) => {
        post({...message, type:'PAGE_FETCH_RESULT', payload:{ok:true, body:'window-forgery'}}, origin);
        post(message, origin, ports);
      };
      return BridgeTest.requestPageFetch('https://image.mux.com/abc/storyboard.vtt');
    })()`
  });
  assert.equal(result.exceptionDetails, undefined);
  assert.equal(result.result.value, 'genuine');
  assert.equal(await page.evaluate('window.observed'), 0);
});
