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
});
