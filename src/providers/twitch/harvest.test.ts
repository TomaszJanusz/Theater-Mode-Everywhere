import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { chromium } from 'playwright';

import { bundleModules } from '../../test-utils/player-boot';
import { sharedTestBrowser } from '../../test-utils/test-browser';

import { twitchHarvestSnapshotMatchesPage } from './main';

const shared = sharedTestBrowser(chromium);

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

it('preserves Twitch transport replacements and decorated promises while harvesting response metadata', async t => {
  const content = bundleModules([`import { installMainWorldRuntime } from './platform/main-world-runtime';
      import { readTwitchSnapshot } from './providers/twitch/main';
      window.installRuntime = installMainWorldRuntime; window.readSnapshot = readTwitchSnapshot;`]);
  const context = await shared.newContext(t);
  try {
    const page = await context.newPage();
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
  } finally { await context.close(); }
});

it('parses native JSON metadata and caption URLs without serializing or reparsing the body', async () => {
  const { parseTwitchGraphqlData } = await import('../../media-features/parsers/twitch-page');
  const data = { data: { video: {
    id: '123', lengthSeconds: 1200, title: 'Fixture title',
    moments: [{ positionMilliseconds: 1000, title: 'Chapter' }],
    captions: { url: 'https://captions.twitch.tv/123/en/caption.vtt' }
  } } };
  const originalStringify = JSON.stringify;
  const originalParse = JSON.parse;
  let parsed: ReturnType<typeof parseTwitchGraphqlData>;
  try {
    JSON.stringify = () => { throw new Error('Unexpected body serialization'); };
    JSON.parse = () => { throw new Error('Unexpected body parse'); };
    parsed = parseTwitchGraphqlData(data, '123');
  } finally {
    JSON.stringify = originalStringify;
    JSON.parse = originalParse;
  }
  assert.equal(parsed.duration, 1200);
  assert.equal(parsed.title, 'Fixture title');
  assert.deepEqual(parsed.moments, [{ start: 1, end: undefined, title: 'Chapter' }]);
  assert.equal(parsed.captions?.[0].url, data.data.video.captions.url);
  assert.equal(parseTwitchGraphqlData(data, '456').duration, undefined);
});
