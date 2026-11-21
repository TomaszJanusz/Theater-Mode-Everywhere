import assert from 'node:assert/strict';
import { describe, it, type TestContext } from 'node:test';

import type { Page } from 'playwright';

import { sharedEngineBrowsers } from '../../test-utils/engine-browsers';
import { bundleModules } from '../../test-utils/player-boot';
import { testEngines } from '../../test-utils/test-engines';

// The manifest's MAIN order on Twitch in one script: runtime, Twitch's entry, then start.
const shipped = bundleModules([
  "import './entries/main-world';",
  "import './providers/twitch/main';",
  "import './entries/main-world-start';",
  "export { requestMediaProbe } from './media-features/probe';"
], 'TwitchMain');
const adapterBundle = bundleModules([
  "export { TwitchAdapter } from './providers/twitch/adapter';",
  "export { observeProviderDom } from './providers/dom-watch';"
], 'TwitchAdapterTest');
const browsers = sharedEngineBrowsers();

const VOD = 'https://www.twitch.tv/videos/123';
const STORYBOARD = 'https://vod-storyboards.twitch.tv/storyboards/123-info.json';
const GQL = JSON.stringify({ data: { video: { id: '123', lengthSeconds: 1200, title: 'Fixture VOD' } } });
const CORS = { 'access-control-allow-origin': '*' };

async function open(t: TestContext, engine: keyof typeof browsers, url: string, off = false): Promise<Page> {
  const page = await (await browsers[engine].newContext(t)).newPage();
  await page.route('https://gql.twitch.tv/**', route => route.fulfill({ contentType: 'application/json', headers: CORS, body: GQL }));
  await page.route('https://vod-storyboards.twitch.tv/**', route => route.fulfill({ contentType: 'application/json', headers: CORS, body: '[]' }));
  await page.route('https://www.twitch.tv/**', route => route.fulfill({ contentType: 'text/html',
    body: `<!doctype html><html${off ? ' data-te-twitch-integration-off=""' : ''}><body><div class="video-player"></div></body></html>` }));
  await page.goto(url);
  await page.addScriptTag({ content: 'window.__name = fn => fn; window.__fetch = window.fetch; window.__json = Response.prototype.json;' });
  await page.addScriptTag({ content: shipped });
  return page;
}

/** One XHR the way Twitch's own clients send it; resolves on loadend, after the harvest observer. */
const xhr = (page: Page, url: string, responseType: XMLHttpRequestResponseType) => page.evaluate(([url, responseType]) => new Promise<void>(resolve => {
  const request = new XMLHttpRequest();
  request.open('POST', url);
  request.responseType = responseType;
  request.addEventListener('loadend', () => resolve());
  request.send('{}');
}), [url, responseType] as const);

const probe = (page: Page) => page.evaluate(`TwitchMain.requestMediaProbe().then(result => result.providers.twitch)`) as
  Promise<{ duration?: number; title?: string; seekPreviewsURL?: string } | null>;

for (const engine of testEngines()) describe(`${engine} Twitch provider`, () => {
  it('harvests Blob GraphQL and the storyboard URL through its registration, leaving fetch to the host', async t => {
    const page = await open(t, engine, VOD);
    assert.equal(await page.evaluate('window.fetch === window.__fetch'), true, 'wrapFetch: false keeps the host transport');
    assert.equal(await page.evaluate('Response.prototype.json === window.__json'), false, 'the Response observers are installed');
    await xhr(page, 'https://gql.twitch.tv/gql', 'blob');
    await xhr(page, STORYBOARD, '');
    await page.waitForFunction(`TwitchMain.requestMediaProbe().then(result => result.providers.twitch?.duration === 1200)`);
    const snapshot = await probe(page);
    assert.deepEqual([snapshot?.title, snapshot?.seekPreviewsURL], ['Fixture VOD', STORYBOARD]);
  });

  it('names the owner again on returning in-app to a video whose metadata Twitch serves from its cache', async t => {
    const page = await open(t, engine, VOD);
    const video = (id: string, login: string) => JSON.stringify({ data: { video: { id, lengthSeconds: 600, title: `VOD ${id}`, owner: { login, displayName: login } } } });
    let body = video('123', 'quiet_harbor');
    await page.unroute('https://gql.twitch.tv/**');
    await page.route('https://gql.twitch.tv/**', route => route.fulfill({ contentType: 'application/json', headers: CORS, body }));
    const owner = () => page.evaluate(`TwitchMain.requestMediaProbe().then(result => result.providers.twitch?.videoId + ':' + result.providers.twitch?.owner?.channel)`);
    await xhr(page, 'https://gql.twitch.tv/gql', 'json');
    assert.equal(await owner(), '123:quiet_harbor');
    await page.evaluate(`history.pushState(null, '', '/videos/456')`);
    body = video('456', 'bottlewright');
    await xhr(page, 'https://gql.twitch.tv/gql', 'json');
    assert.equal(await owner(), '456:bottlewright');
    // Back to the first video: Twitch answers from its cache, so no response arrives for it.
    await page.evaluate(`history.pushState(null, '', '/videos/123')`);
    assert.equal(await owner(), '123:quiet_harbor');
  });

  it('reports no snapshot and harvests nothing with the integration off', async t => {
    const page = await open(t, engine, VOD, true);
    await xhr(page, 'https://gql.twitch.tv/gql', 'json');
    assert.equal(await probe(page), null);
    assert.equal(await page.evaluate(`document.getElementById('theater-everywhere-twitch-harvest')`), null);
  });

  it('keeps the MAIN runtime out of a chat-only popout', async t => {
    const page = await open(t, engine, 'https://www.twitch.tv/popout/somechannel/chat');
    assert.equal(await page.evaluate('Response.prototype.json === window.__json'), true);
  });

  it('follows in-app navigation between live channels through the header, never naming the previous channel', async t => {
    const page = await (await browsers[engine].newContext(t)).newPage();
    // The channel header as read live on 2026-11-21 (class hashes dropped): name link, avatar, stream title.
    const header = (login: string, name: string, title: string) => `<section class="channel-info-content">
      <img class="tw-image-avatar" src="https://static-cdn.jtvnw.net/jtv_user_pictures/${login}-profile_image-70x70.png">
      <div><a href="/${login}"><h1 class="tw-title">${name}</h1></a></div>
      <p data-a-target="stream-title">${title}</p></section>`;
    await page.route('https://www.twitch.tv/**', route => route.fulfill({ contentType: 'text/html',
      body: `<!doctype html><body><main>${header('quiet_harbor', 'QuietHarbor', 'Harbor stream')}</main></body>` }));
    await page.goto('https://www.twitch.tv/quiet_harbor');
    await page.addScriptTag({ content: 'window.__name = fn => fn;' + adapterBundle });
    const read = () => page.evaluate(`({ title: adapter.getTitle(), authors: adapter.getAuthors()?.map(author => author.name) ?? null })`);
    await page.evaluate(`(async () => {
      window.published = 0;
      window.adapter = new TwitchAdapterTest.TwitchAdapter({ requestPageFetch: async () => null, parseCaptionPayload: () => [],
        observeProviderDom: TwitchAdapterTest.observeProviderDom,
        requestMediaProbe: async () => ({ providers: { twitch: { title: document.querySelector('[data-a-target="stream-title"]').textContent } } }) });
      await adapter.reload();
      adapter.observeTitle(() => { window.published++; });
    })()`);
    assert.deepEqual(await read(), { title: 'Harbor stream', authors: ['QuietHarbor'] });

    // Twitch changes the address first; the header and the loaded snapshot still describe the previous channel.
    await page.evaluate(`history.pushState(null, '', '/bottlewright')`);
    assert.deepEqual(await read(), { title: null, authors: null }, 'the previous channel is never shown for the new one');
    // Twitch can point the header's link at the new channel before its name, avatar and title follow.
    await page.evaluate(`document.querySelector('.channel-info-content a').setAttribute('href', '/bottlewright')`);
    assert.deepEqual(await read(), { title: null, authors: null }, 'a half-switched header names nobody');
    const before = await page.evaluate('window.published');
    await page.evaluate(`document.querySelector('main').innerHTML = ${JSON.stringify(header('bottlewright', 'Bottlewright', 'Bottle stream'))}`);
    await page.waitForFunction(`window.published > ${before}`);
    assert.deepEqual(await read(), { title: 'Bottle stream', authors: ['Bottlewright'] }, 'the new header republishes before any reload');
    // Twitch swaps the stream's media on navigation; the reset drops the snapshot without loading another.
    await page.evaluate('adapter.invalidate()');
    assert.deepEqual(await read(), { title: 'Bottle stream', authors: ['Bottlewright'] }, 'a media reset keeps the header-read title and channel');

    await page.evaluate(`document.querySelector('[data-a-target="stream-title"]').textContent = 'Renamed stream'`);
    await page.waitForFunction(`adapter.getTitle() === 'Renamed stream'`);
  });

  it('validates the MAIN snapshot it reads across the world boundary', async t => {
    const page = await (await browsers[engine].newContext(t)).newPage();
    await page.route('https://www.twitch.tv/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><body></body>' }));
    await page.goto(VOD);
    await page.addScriptTag({ content: 'window.__name = fn => fn;' + adapterBundle });
    const report = await page.evaluate(`(async () => {
      const probed = [];
      const adapter = new TwitchAdapterTest.TwitchAdapter({ requestPageFetch: async () => null, parseCaptionPayload: () => [],
        requestMediaProbe: async timeout => { probed.push(timeout); return { providers: { twitch: {
        videoId: '123', title: { toString: () => 'object title' }, duration: '1200',
        moments: [{ startTime: 5, title: 'Chapter' }, 'junk', { startTime: 'x', title: 'Bad start' }],
        captionTracks: [{ id: 'en', url: 'https://captions.twitch.tv/123/en.vtt', language: 'en', label: 'English' },
          { id: 'evil', url: 'https://evil.test/en.vtt', language: 'xx', label: 'Evil' }, { url: 'https://captions.twitch.tv/no-id.vtt' }]
      } } }; } });
      const tracks = await adapter.listCaptionTracks();
      return { probed, title: adapter.getTitle(), tracks: tracks.map(track => track.id),
        chapters: (await adapter.getChapters()).map(chapter => chapter.title) };
    })()`);
    assert.deepEqual(report, { probed: [1500], title: null, tracks: ['en'], chapters: ['Chapter'] });
  });
});
