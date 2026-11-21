import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { sharedEngineBrowsers } from '../../test-utils/engine-browsers';
import { bundleModules } from '../../test-utils/player-boot';
import { testEngines } from '../../test-utils/test-engines';

import type { VimeoAdapter, VimeoServices } from './adapter';
import type { readVimeoSnapshot } from './snapshot';

const bundle = bundleModules([
  "export { VimeoAdapter } from './providers/vimeo/adapter';",
  "export { readVimeoSnapshot } from './providers/vimeo/snapshot';"
], 'VimeoSnapshotTest');
const browsers = sharedEngineBrowsers();
declare global {
  interface Window { VimeoSnapshotTest: { VimeoAdapter: new (services: VimeoServices) => VimeoAdapter; readVimeoSnapshot: typeof readVimeoSnapshot } }
}

// A Vimeo watch page keeps its player config on the page's window; the title falls back to the open-graph tag.
const PAGE = `<!doctype html><head><meta charset="utf-8"><title>Les Bêtes | Videos & Movies on Vimeo</title><meta property="og:title" content="Les Bêtes"></head><body>
<div class="player"><video></video></div>
<script>window.playerConfig = { video: { id: 123456, duration: 635,
  owner: { id: 152184, name: 'Vimeo', url: '', img: 'https://i.vimeocdn.com/portrait/121863746_60x60?r=cover', img_2x: 'https://i.vimeocdn.com/portrait/121863746_120x120?r=cover', account_type: 'enterprise' } },
  embed: { chapters: [{ startTime: 0, title: 'Intro' }, { startTime: 60, title: 'Main' }] },
  request: { thumb_preview: { url: 'https://videoapi-sprites.vimeocdn.com/video-sprites/image/abc.0.webp?s=1', width: 4686, height: 2640, frame_width: 426, frame_height: 240, columns: 11, frames: 120 } } };</script></body>`;

// Fixture evidence: the JSON-LD graph of vimeo.com/1084537 as served on 2026-11-21 (trimmed); the page has no player config.
const LINKED_PAGE = `<!doctype html><head><meta charset="utf-8"><meta property="og:title" content="Big Buck Bunny">
<script type="application/ld+json">${JSON.stringify({ '@context': 'http://schema.org', '@graph': [
  { '@type': 'VideoObject', url: 'https://vimeo.com/1084537', name: 'Big Buck Bunny', author: { '@type': 'Person', name: 'Blender', url: 'https://vimeo.com/yourown3dsoftware', identifier: 508904, image: 'https://i.vimeocdn.com/portrait/24871548_120x120?v=1' } },
  { '@type': 'BreadcrumbList' }
] })}</script></head><body><div class="player"><video></video></div></body>`;

for (const engine of testEngines()) describe(`${engine} Vimeo snapshot and adapter`, () => {
  it('hands the MAIN snapshot to the adapter as plain data and rejects a foreign sprite host', { timeout: 60_000 }, async t => {
    const page = await (await browsers[engine].newContext(t)).newPage();
    await page.route('https://vimeo.com/**', route => route.fulfill({ contentType: 'text/html', body: PAGE }));
    await page.goto('https://vimeo.com/123456');
    await page.addScriptTag({ content: 'window.__name = fn => fn;' + bundle });
    const report = await page.evaluate(async () => {
      const { VimeoAdapter, readVimeoSnapshot } = window.VimeoSnapshotTest;
      const snapshot = JSON.parse(JSON.stringify(readVimeoSnapshot()));
      const adapter = new VimeoAdapter({ requestMediaProbe: async () => ({ providers: { vimeo: snapshot } }) });
      const capabilities = await adapter.probe();
      const hostile = new VimeoAdapter({ requestMediaProbe: async () => ({ providers: { vimeo: { ...snapshot, thumbPreview: { ...snapshot.thumbPreview, url: 'https://evil.test/a.0.webp' } } } }) });
      return { title: adapter.getTitle(), id: adapter.mediaId(), capabilities, chapters: (await adapter.getChapters()).map(chapter => chapter.title),
        frame: adapter.getPreviewFrame(10, 635)?.image.url, hostile: (await hostile.probe()).previews, authors: adapter.getAuthors() };
    });
    assert.equal(report.id, '123456');
    assert.equal(report.title, 'Les Bêtes');
    assert.deepEqual(report.capabilities, { captions: false, chapters: true, previews: true });
    assert.deepEqual(report.chapters, ['Intro', 'Main']);
    assert.match(report.frame ?? '', /^https:\/\/videoapi-sprites\.vimeocdn\.com\//);
    assert.equal(report.hostile, false);
    // Fixture evidence: the owner's shape from player.vimeo.com/video/76979871 (2026-11-21), whose `url` was empty.
    assert.deepEqual(report.authors, [{ id: '152184', name: 'Vimeo', url: null, avatarUrl: 'https://i.vimeocdn.com/portrait/121863746_120x120?r=cover', verified: false, stat: null }]);
  });

  it('names the clip owner from the watch page JSON-LD, and nobody once the page shows another clip', { timeout: 60_000 }, async t => {
    const page = await (await browsers[engine].newContext(t)).newPage();
    await page.route('https://vimeo.com/**', route => route.fulfill({ contentType: 'text/html', body: LINKED_PAGE }));
    await page.goto('https://vimeo.com/1084537');
    await page.addScriptTag({ content: 'window.__name = fn => fn;' + bundle });
    const report = await page.evaluate(async () => {
      const { VimeoAdapter, readVimeoSnapshot } = window.VimeoSnapshotTest;
      const read = async () => {
        const snapshot = JSON.parse(JSON.stringify(readVimeoSnapshot()));
        const adapter = new VimeoAdapter({ requestMediaProbe: async () => ({ providers: { vimeo: snapshot } }) });
        await adapter.probe();
        return adapter;
      };
      const adapter = await read();
      const first = adapter.getAuthors();
      // Client navigation: the JSON-LD still describes the first clip.
      history.pushState(null, '', '/76979871');
      return { first, kept: adapter.getAuthors(), next: (await read()).getAuthors() };
    });
    assert.deepEqual(report.first, [{ id: '508904', name: 'Blender', url: 'https://vimeo.com/yourown3dsoftware', avatarUrl: 'https://i.vimeocdn.com/portrait/24871548_120x120?v=1', verified: false, stat: null }]);
    assert.equal(report.kept, null, 'an owner read for another clip is not shown');
    assert.equal(report.next, null, 'stale JSON-LD names nobody');
  });
});
