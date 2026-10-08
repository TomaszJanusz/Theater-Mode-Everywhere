import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { twitchHarvestSnapshotMatchesPage } from './main';

describe('Twitch harvest snapshot binding', () => {
  it('rejects a child snapshot for a different VOD than the top page', () => {
    assert.equal(
      twitchHarvestSnapshotMatchesPage('https://www.twitch.tv/videos/123', '456'),
      false
    );
    assert.equal(
      twitchHarvestSnapshotMatchesPage('https://www.twitch.tv/videos/123', undefined),
      false
    );
  });

  it('accepts a snapshot for the same VOD or when the top page has no VOD id', () => {
    assert.equal(
      twitchHarvestSnapshotMatchesPage('https://www.twitch.tv/videos/123', '123'),
      true
    );
    assert.equal(
      twitchHarvestSnapshotMatchesPage('https://www.twitch.tv/directory', '123'),
      true
    );
  });
});

it('preserves Twitch transport replacements and decorated promises while harvesting response metadata', async () => {
  const { chromium } = await import('playwright');
  const { createRequire } = await import('node:module');
  const esbuild = createRequire(import.meta.url)('esbuild');
  const content = esbuild.buildSync({
    stdin: { contents: `import {installMainWorldRuntime} from './src/platform/main-world-runtime';
      import {readTwitchSnapshot} from './src/providers/twitch/main';
      window.installRuntime = installMainWorldRuntime; window.readSnapshot = readTwitchSnapshot;`, resolveDir: process.cwd() },
    bundle: true, write: false, format: 'iife', platform: 'browser', target: 'es2022', logLevel: 'silent'
  }).outputFiles[0].text;
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.route('https://www.twitch.tv/**', route => route.fulfill({ contentType: 'text/html', body: '<div class="video-player"></div>' }));
    await page.goto('https://www.twitch.tv/videos/123');
    await page.addScriptTag({ content });
    const report = await page.evaluate<{ unchanged: boolean; writable: boolean; sameReplacement: boolean; decorated: boolean; duration: number }>(`(async () => {
      const original = window.fetch;
      window.installRuntime();
      const unchanged = window.fetch === original;
      const writable = Object.getOwnPropertyDescriptor(window, 'fetch').writable === true;
      const response = new Response(JSON.stringify({data:{video:{id:'123',lengthSeconds:1200}}}));
      Object.defineProperty(response, 'url', {value:'https://gql.twitch.tv/gql'});
      const pending = Object.assign(Promise.resolve(response), {abort:()=>42});
      const replacement = () => pending;
      window.fetch = replacement;
      const sameReplacement = window.fetch === replacement;
      const request = window.fetch('https://gql.twitch.tv/gql');
      const decorated = request === pending && request.abort() === 42;
      await (await request).json();
      return {unchanged,writable,sameReplacement,decorated,duration:window.readSnapshot().duration};
    })()`);
    assert.deepEqual(report, { unchanged: true, writable: true, sameReplacement: true, decorated: true, duration: 1200 });
  } finally { await browser.close(); }
});
