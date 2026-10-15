import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { GenericTitleTracker, parseJsonLdVideoObjects, stripSiteName, type GenericTitleCandidates } from './page-title';

const PAGE_A = 'https://videos.example/watch/a';
const PAGE_B = 'https://videos.example/watch/b';
const MEDIA_A = 'https://cdn.example/a.mp4';

function candidates(overrides: Partial<GenericTitleCandidates> = {}): GenericTitleCandidates {
  return {
    element: null,
    labelledBy: null,
    videoObjects: [],
    openGraph: null,
    twitter: null,
    document: null,
    siteName: null,
    heading: null,
    ...overrides
  };
}

function select(input: GenericTitleCandidates, page = PAGE_A, sources = [MEDIA_A]): string | null {
  return new GenericTitleTracker().select(input, { page, sources });
}

describe('generic title order', () => {
  const all = candidates({
    element: 'Element title',
    labelledBy: 'Labelled title',
    videoObjects: [{ name: 'Schema title', contentUrls: [MEDIA_A], embedUrls: [] }],
    openGraph: 'Open Graph title',
    twitter: 'Twitter title',
    document: 'Document title',
    heading: 'Heading title'
  });

  it('prefers each source over the weaker ones', () => {
    const order: Array<keyof GenericTitleCandidates> = ['element', 'labelledBy', 'videoObjects', 'openGraph', 'twitter', 'document', 'heading'];
    const expected = ['Element title', 'Labelled title', 'Schema title', 'Open Graph title', 'Twitter title', 'Document title', 'Heading title'];
    order.forEach((source, index) => {
      const input = { ...all };
      for (const stronger of order.slice(0, index)) Object.assign(input, { [stronger]: stronger === 'videoObjects' ? [] : null });
      assert.equal(select(input), expected[index], `${source} is used when stronger sources are missing`);
    });
    assert.equal(select(candidates()), null);
  });

  it('sanitizes whitespace and treats blank labels as missing', () => {
    assert.equal(select(candidates({ element: '   ', labelledBy: '  Night \n Drive ', openGraph: 'Page' })), 'Night Drive');
  });

  it('rejects a VideoObject that describes other media', () => {
    const other = { name: 'Related clip', contentUrls: ['https://cdn.example/other.mp4'], embedUrls: ['https://videos.example/embed/other'] };
    assert.equal(select(candidates({ videoObjects: [other], openGraph: 'Playing page' })), 'Playing page');
  });

  it('matches a VideoObject by relative contentUrl, by embedUrl of this page, or by an enclosing scope', () => {
    const relative = { name: 'Relative', contentUrls: ['/a.mp4#t=10'], embedUrls: [] };
    assert.equal(select(candidates({ videoObjects: [relative] }), 'https://cdn.example/page'), 'Relative');
    const embedded = { name: 'Embedded', contentUrls: [], embedUrls: [`${PAGE_A}#autoplay`] };
    assert.equal(select(candidates({ videoObjects: [embedded] }), PAGE_A, ['blob:https://videos.example/1']), 'Embedded');
    const enclosing = { name: 'Enclosing', contentUrls: [], embedUrls: [], containsMedia: true };
    assert.equal(select(candidates({ videoObjects: [enclosing] })), 'Enclosing');
  });

  it('removes the site name from page titles', () => {
    assert.equal(select(candidates({ document: 'Episode 4 | Example TV', siteName: 'Example TV' })), 'Episode 4');
    assert.equal(select(candidates({ openGraph: 'Example TV', document: 'Episode 4 — Example TV', siteName: 'Example TV' })), 'Episode 4');
    assert.equal(stripSiteName('Example TV: Episode 4', 'Example TV'), 'Example TV: Episode 4');
  });
});

describe('JSON-LD VideoObjects', () => {
  it('finds VideoObjects in graphs, arrays and nested entities', () => {
    const objects = parseJsonLdVideoObjects(JSON.stringify([
      { '@context': 'https://schema.org', '@graph': [
        { '@type': 'WebPage', name: 'Page', video: { '@type': 'VideoObject', name: ' Nested ', contentUrl: MEDIA_A } },
        { '@type': ['CreativeWork', 'https://schema.org/VideoObject'], name: 'Typed', embedUrl: [{ '@id': PAGE_A }] }
      ] }
    ]));
    assert.deepEqual(objects, [
      { name: 'Nested', contentUrls: [MEDIA_A], embedUrls: [] },
      { name: 'Typed', contentUrls: [], embedUrls: [PAGE_A] }
    ]);
  });

  it('ignores malformed JSON and other types', () => {
    assert.deepEqual(parseJsonLdVideoObjects('{ not json'), []);
    assert.deepEqual(parseJsonLdVideoObjects('{"@type":"AudioObject","name":"Song"}'), []);
  });
});

describe('client-side navigation', () => {
  it('rejects the previous page title until the page replaces it', () => {
    const tracker = new GenericTitleTracker();
    const media = (page: string) => ({ page, sources: [] });
    const pageA = candidates({ openGraph: 'Episode A', document: 'Episode A | Site', siteName: 'Site', heading: 'Episode A' });
    assert.equal(tracker.select(pageA, media(PAGE_A)), 'Episode A');
    assert.equal(tracker.select(pageA, media(`${PAGE_A}#comments`)), 'Episode A', 'a fragment is the same page');

    // The URL already names episode B, but the head and heading still describe A.
    assert.equal(tracker.select(pageA, media(PAGE_B)), null);
    // Many SPAs update <title> but leave Open Graph from the first page.
    const titleUpdated = { ...pageA, document: 'Episode B | Site' };
    assert.equal(tracker.select(titleUpdated, media(PAGE_B)), 'Episode B');
    const allUpdated = { ...titleUpdated, openGraph: 'Episode B (OG)' };
    assert.equal(tracker.select(allUpdated, media(PAGE_B)), 'Episode B (OG)');

    // Returning to A compares against what B showed, not against A.
    assert.equal(tracker.select(allUpdated, media(PAGE_A)), null);
    assert.equal(tracker.select(pageA, media(PAGE_A)), 'Episode A');
  });

  it('keeps titles tied to the media after a URL change', () => {
    const tracker = new GenericTitleTracker();
    const input = candidates({ element: 'Clip', openGraph: 'Page' });
    tracker.select(input, { page: PAGE_A, sources: [] });
    assert.equal(tracker.select(input, { page: PAGE_B, sources: [] }), 'Clip');
    const schema = candidates({ videoObjects: [{ name: 'Schema B', contentUrls: [MEDIA_A], embedUrls: [] }], openGraph: 'Page' });
    assert.equal(tracker.select(schema, { page: PAGE_A, sources: [MEDIA_A] }), 'Schema B');
  });
});
