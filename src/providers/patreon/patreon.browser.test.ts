import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { sharedEngineBrowsers } from '../../test-utils/engine-browsers';
import { bundleModules } from '../../test-utils/player-boot';
import { testEngines } from '../../test-utils/test-engines';

import type { PatreonAdapter, PatreonServices } from './adapter';
import type { readPatreonSnapshot } from './snapshot';

const bundle = bundleModules([
  "export { PatreonAdapter } from './providers/patreon/adapter';",
  "export { readPatreonSnapshot } from './providers/patreon/snapshot';"
], 'PatreonSnapshotTest');
const browsers = sharedEngineBrowsers();
declare global {
  interface Window { PatreonSnapshotTest: { PatreonAdapter: new (services: PatreonServices) => PatreonAdapter; readPatreonSnapshot: typeof readPatreonSnapshot } }
}

// Structure of a Patreon post with a Mux Player: the player carries the playback id and storyboard, the page
// state carries the signed caption track, and the description lists the chapters.
const PAGE = `<!doctype html><head><title>Post | Patreon</title></head><body>
<h1 data-tag="post-title">  A   long   post </h1>
<mux-player playback-id="PlayId01" storyboard-src="https://image.mux.com/PlayId01/storyboard.vtt?token=abc"></mux-player>
<div data-tag="post-content">0:00 Intro\n1:00 Main part\n2:00 Outro</div>
<script type="application/json">{"transcript_url":"https:\\/\\/stream.mux.com\\/PlayId01\\/text\\/TrackId01.vtt?token=abc"}</script></body>`;
// Fixture evidence: a public video post's creator data as served on 2026-11-21 (names and ids made up): the
// campaign in `article:author`, and the creator header linking `/cw/<vanity>` around the avatar and the name, next to
// navigation links to the same campaign without an avatar.
const CREATOR_PAGE = (vanity: string) => `<!doctype html><head><meta charset="utf-8"><title>Film club | Patreon</title>
<meta property="article:author" content="https://www.patreon.com/${vanity}"></head><body>
<a data-tag="top-nav-Home" href="https://www.patreon.com/cw/${vanity}"><p>Home</p></a>
<a class="creatorInfoContainer" href="https://www.patreon.com/cw/${vanity}"><div><img src="https://c10.patreonusercontent.com/4/patreon-media/p/campaign/1/a/b/2.png?token-hash=x"></div><p>Digital  Pasta</p></a>
<h1 data-tag="post-title">Film club</h1><video></video></body>`;
const CAPTION = 'WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nHello\n';

for (const engine of testEngines()) describe(`${engine} Patreon snapshot and adapter`, () => {
  it('hands the MAIN snapshot to the adapter as plain data and fetches only Mux URLs', { timeout: 60_000 }, async t => {
    const page = await (await browsers[engine].newContext(t)).newPage();
    await page.route('https://www.patreon.com/**', route => route.fulfill({ contentType: 'text/html', body: PAGE }));
    await page.goto('https://www.patreon.com/posts/my-post-12345678');
    await page.addScriptTag({ content: 'window.__name = fn => fn;' + bundle });
    const report = await page.evaluate(async captionBody => {
      const { PatreonAdapter, readPatreonSnapshot } = window.PatreonSnapshotTest;
      const snapshot = readPatreonSnapshot();
      const fetched: string[] = [];
      const services: PatreonServices = {
        requestPageFetch: async url => { fetched.push(url); return captionBody; },
        // Across the world boundary the snapshot is cloned; a hostile caption URL must not be fetched.
        requestMediaProbe: async () => ({ providers: { patreon: { ...JSON.parse(JSON.stringify(snapshot)), captionTracks: [
          ...snapshot!.captionTracks!, { id: 'evil', url: 'https://evil.test/text/x.vtt', language: 'xx', label: 'Evil' }] } } })
      };
      const adapter = new PatreonAdapter(services);
      const tracks = await adapter.listCaptionTracks();
      const good = await adapter.activateCaptionTrack(tracks[0].id);
      const evil = await adapter.activateCaptionTrack('evil');
      return { playbackId: snapshot?.playbackId, title: adapter.getTitle(), tracks: tracks.map(track => track.source), good: good.status, cues: good.cues.length,
        evil: evil.status, fetched, chapters: (await adapter.getChapters()).map(chapter => chapter.title) };
    }, CAPTION);
    assert.equal(report.playbackId, 'PlayId01');
    assert.equal(report.title, 'A long post');
    assert.deepEqual(report.tracks, ['patreon', 'patreon']);
    assert.deepEqual([report.good, report.cues, report.evil], ['active', 1, 'failed']);
    assert.deepEqual(report.fetched, ['https://image.mux.com/PlayId01/storyboard.vtt?token=abc', 'https://stream.mux.com/PlayId01/text/TrackId01.vtt?token=abc']);
    assert.deepEqual(report.chapters, ['Intro', 'Main part', 'Outro']);
  });

  it('names the post creator from its campaign and header, and nobody for another post or campaign', { timeout: 60_000 }, async t => {
    const page = await (await browsers[engine].newContext(t)).newPage();
    await page.route('https://www.patreon.com/**', route => route.fulfill({ contentType: 'text/html', body: CREATOR_PAGE('pastaclub') }));
    await page.goto('https://www.patreon.com/pastaclub/posts/film-club-175727423');
    await page.addScriptTag({ content: 'window.__name = fn => fn;' + bundle });
    const report = await page.evaluate(async () => {
      const { PatreonAdapter, readPatreonSnapshot } = window.PatreonSnapshotTest;
      const read = async () => {
        const snapshot = JSON.parse(JSON.stringify(readPatreonSnapshot()));
        const adapter = new PatreonAdapter({ requestPageFetch: async () => null, requestMediaProbe: async () => ({ providers: { patreon: snapshot } }) });
        await adapter.probe();
        return adapter;
      };
      const adapter = await read();
      const first = adapter.getAuthors();
      // Client navigation to another creator's post before the page metadata follows.
      history.pushState(null, '', '/othercreator/posts/clip-175700000');
      const kept = adapter.getAuthors();
      const stale = (await read()).getAuthors();
      history.pushState(null, '', '/posts/clip-175700001');
      const bare = (await read()).getAuthors()?.map(author => author.id);
      document.querySelector('.creatorInfoContainer')!.setAttribute('href', 'https://www.patreon.com/cw/someoneelse');
      return { first, kept, stale, bare, unmatched: (await read()).getAuthors() };
    });
    assert.deepEqual(report.first, [{ id: 'pastaclub', name: 'Digital Pasta', url: 'https://www.patreon.com/cw/pastaclub',
      avatarUrl: 'https://c10.patreonusercontent.com/4/patreon-media/p/campaign/1/a/b/2.png?token-hash=x', verified: false, stat: null }]);
    assert.equal(report.kept, null, 'a creator read for another post is not shown');
    assert.equal(report.stale, null, 'a post under another vanity does not take this campaign');
    assert.deepEqual(report.bare, ['pastaclub'], '/posts/<slug> takes the campaign its metadata names');
    assert.equal(report.unmatched, null, 'a header for another campaign names nobody');
  });
});
