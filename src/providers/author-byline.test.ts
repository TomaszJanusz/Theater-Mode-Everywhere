import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { allowedHttpsUrl, bylineNames, checkedAuthors, MAX_AUTHORS, monogram, providerAuthorHosts } from './author-byline';

const HOSTS = providerAuthorHosts([{ domain: 'youtube.com', includeSubdomains: true }], ['yt3.ggpht.com']);
const author = (overrides: Record<string, unknown> = {}) => ({
  id: 'UC1', name: 'Harbour Films', url: 'https://www.youtube.com/@harbour', avatarUrl: 'https://yt3.ggpht.com/a=s88',
  verified: true, stat: '1.26M subscribers', ...overrides
});

describe('author byline boundary check', () => {
  it('keeps links on the provider\'s hosts and avatars on its declared image hosts only', () => {
    const youtube = (url: string) => allowedHttpsUrl(url, HOSTS.link);
    assert.equal(youtube('https://www.youtube.com/@harbour'), 'https://www.youtube.com/@harbour');
    assert.equal(youtube('https://m.youtube.com/channel/UC1'), 'https://m.youtube.com/channel/UC1');
    for (const url of [
      'http://www.youtube.com/@harbour', 'https://user:pw@www.youtube.com/@harbour', 'https://www.youtube.com:8443/@harbour',
      'https://youtube.com.evil.example/@harbour', 'https://evil-youtube.com/', 'javascript:alert(1)', '//www.youtube.com/@x',
      '/@harbour', `https://www.youtube.com/${'a'.repeat(2000)}`
    ]) assert.equal(youtube(url), null, url);
    assert.equal(allowedHttpsUrl('https://yt3.ggpht.com/a', HOSTS.image), 'https://yt3.ggpht.com/a');
    // Image hosts are exact: a subdomain or the link hosts do not count.
    for (const url of ['https://x.yt3.ggpht.com/a', 'https://www.youtube.com/a.png', 'https://i.ytimg.com/a.jpg']) {
      assert.equal(allowedHttpsUrl(url, HOSTS.image), null, url);
    }
  });

  it('drops a link or avatar alone, but an author without an id or a name entirely', () => {
    assert.deepEqual(checkedAuthors([author({ url: 'https://evil.example/', avatarUrl: 'https://evil.example/a.png' })], HOSTS),
      [{ ...author(), url: null, avatarUrl: null }]);
    assert.deepEqual(checkedAuthors([author({ id: '' }), author({ name: '   ' }), author({ name: 7 }), null, 'x'], HOSTS), []);
    assert.deepEqual(checkedAuthors({ authors: [author()] }, HOSTS), []);
  });

  it('cleans names and figures, caps their length and keeps only a strict verified flag', () => {
    const [checked] = checkedAuthors([author({ name: `  Harbour\n\tFilms ${'x'.repeat(200)}`, stat: ' 1.26M\nsubscribers ', verified: 'yes' })], HOSTS);
    assert.equal(checked.name.length, 80);
    assert.ok(checked.name.startsWith('Harbour Films x'));
    assert.equal(checked.stat, '1.26M subscribers');
    assert.equal(checked.verified, false);
  });

  it('keeps host order, drops repeated ids and stops at the maximum', () => {
    const many = Array.from({ length: 12 }, (_, index) => author({ id: `UC${index % 10}`, name: `Channel ${index}` }));
    const checked = checkedAuthors(many, HOSTS);
    assert.equal(checked.length, MAX_AUTHORS);
    assert.deepEqual(checked.map(item => item.name), ['Channel 0', 'Channel 1', 'Channel 2', 'Channel 3', 'Channel 4', 'Channel 5', 'Channel 6', 'Channel 7']);
  });
});

describe('author byline labels', () => {
  const named = (...names: string[]) => names.map((name, index) => ({ ...author({ id: String(index), name }) }) as ReturnType<typeof checkedAuthors>[number]);

  it('names one author, two as "A & B" and three or more as "A +N"', () => {
    assert.deepEqual(bylineNames(named('A')), { names: ['A'], more: 0 });
    assert.deepEqual(bylineNames(named('A', 'B')), { names: ['A', 'B'], more: 0 });
    assert.deepEqual(bylineNames(named('A', 'B', 'C')), { names: ['A'], more: 2 });
    assert.deepEqual(bylineNames([]), { names: [], more: 0 });
  });

  it('draws a monogram from two words or the first two letters, whatever the script', () => {
    assert.equal(monogram('Harbour Films'), 'HF');
    assert.equal(monogram('quiet_harbor'), 'QH');
    assert.equal(monogram('Blender'), 'BL');
    assert.equal(monogram('影视飓风'), '影视');
    assert.equal(monogram('😀 Fun'), '😀F');
  });
});
