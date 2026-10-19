import { selectTestEngines } from '../test-utils/test-engines';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { it } from 'node:test';
import { chromium, firefox } from 'playwright';
import { ownTestBrowser } from '../test-utils/test-browser';

const require = createRequire(import.meta.url);
const esbuild = require(createRequire(require.resolve('vite')).resolve('esbuild')) as {
  buildSync(options: Record<string, unknown>): { outputFiles: Array<{ text: string }> };
};
const bundle = esbuild.buildSync({
  stdin: { contents: `export { readBoundedBytes } from './platform/bounded-body';
    export { readPageResponseBytes } from './platform/page-body';`,
    resolveDir: path.resolve(new URL('..', import.meta.url).pathname), loader: 'ts' },
  bundle: true, write: false, format: 'iife', globalName: 'BoundedTest', platform: 'browser', target: 'es2022'
}).outputFiles[0].text;

for (const browserType of selectTestEngines([chromium, firefox], engine => engine.name())) {
  it(`${browserType.name()}: abandoning synthetic and HTTP fetch clones leaves the original readable`, { timeout: 30_000 }, async t => {
    if (!existsSync(browserType.executablePath())) { t.skip('Browser not installed'); return; }
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
    const browser = await browserType.launch({ headless: true });
    ownTestBrowser(t, browser);
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${address.port}`);
    await page.addScriptTag({ content: bundle });
    const result = await page.evaluate(`(async () => {
      const results = [];
      for (const response of [new Response('abcdefghijk'), await fetch('/redirect')]) {
        const clone = response.clone();
        const bounded = await BoundedTest.readBoundedBytes(clone, 4);
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
    await browser.close();
  });

  it(`${browserType.name()}: bounds streamed bytes and cancels pending reads on navigation/abort`, { timeout: 30_000 }, async t => {
    if (!existsSync(browserType.executablePath())) { t.skip('Browser not installed'); return; }
    const browser = await browserType.launch({ headless: true }); ownTestBrowser(t, browser);
    const page = await browser.newPage();
    await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html>' }));
    await page.goto('https://fixture.example/first');
    await page.addScriptTag({ content: bundle });
    assert.deepEqual(await page.evaluate(`(async () => {
      const results = [];
      for (const length of [null, '0', '1', 'invalid']) {
        let pulled = 0, cancelled = 0;
        const body = new ReadableStream({pull(c) {pulled += 4; c.enqueue(new Uint8Array(4));}, cancel() {cancelled++;}}, {highWaterMark:0});
        const result = await BoundedTest.readBoundedBytes({body, headers:new Headers(length === null ? {} : {'content-length':length})}, 8);
        results.push({result, pulled, cancelled, locked:body.locked});
      }
      return results;
    })()`), Array.from({ length: 4 }, () => ({ result: null, pulled: 12, cancelled: 1, locked: false })));
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
        const result = BoundedTest.readPageResponseBytes({body}, 8, controller.signal);
        ${change};
        return {result:await result, cancelled, locked:body.locked};
      })()`), { result: null, cancelled: 1, locked: false });
    }
    // A deterministic mechanism diagnostic, not a heap/RAM measurement.
    const diagnostic = await page.evaluate(`(async () => {
      const total = 32 * 1024 * 1024, cap = 8 * 1024 * 1024, chunk = 256 * 1024;
      const run = async bounded => {
        let produced = 0, cancelled = false;
        const body = new ReadableStream({pull(c) {if(produced === total) {c.close(); return;} produced += chunk; c.enqueue(new Uint8Array(chunk));}, cancel() {cancelled = true;}}, {highWaterMark:0});
        if (bounded) await BoundedTest.readBoundedBytes({body}, cap); else await new Response(body).arrayBuffer();
        return {produced, cancelled};
      };
      return {full:await run(false), bounded:await run(true)};
    })()`);
    assert.deepEqual(diagnostic, { full: { produced: 32 * 1024 * 1024, cancelled: false }, bounded: { produced: 8 * 1024 * 1024 + 256 * 1024, cancelled: true } });
    t.diagnostic(`${browserType.name()} produced-byte fixture (not heap): ${JSON.stringify(diagnostic)}`);
    await browser.close();
  });
}
