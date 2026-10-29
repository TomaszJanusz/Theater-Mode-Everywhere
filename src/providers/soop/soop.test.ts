import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parseSoopChapters, soopChaptersUrl } from './chapters';
import { soopChat } from './chat';
import { soopRoute, soopRouteKey } from './dom';
import { allowsSoopMediaFetch as isAllowedMediaFetchUrl } from './fetch-policy';
import { soopWatchPlayback } from './watch-playback';

const route = (href: string) => soopRoute(new URL(href));
const chapterBody = (data: unknown, result: unknown = 1) => JSON.stringify({ result, message: 'SUCCESS', data, data_type: 'TITLE_HISTORY' });

describe('SOOP routes', () => {
  it('identifies a live broadcast and a recording, whatever the tracking parameters', () => {
    assert.deepEqual(route('https://play.sooplive.com/battleland/297994793?from=list'), { kind: 'live', bj: 'battleland', id: '297994793' });
    assert.deepEqual(route('https://play.sooplive.com/BattleLand/297994793/'), { kind: 'live', bj: 'battleland', id: '297994793' });
    assert.deepEqual(route('https://vod.sooplive.com/player/211006561?change_second=30'), { kind: 'vod', id: '211006561' });
    assert.equal(soopRouteKey(route('https://play.sooplive.com/battleland/297994793')!), 'live:battleland/297994793');
    assert.equal(soopRouteKey(route('https://vod.sooplive.com/player/211006561')!), 'vod:211006561');
  });

  it('rejects channel addresses, catch clips, other hosts and insecure or spoofed URLs', () => {
    for (const href of ['https://play.sooplive.com/battleland', 'https://vod.sooplive.com/player/catch', 'https://vod.sooplive.com/player/210981903/catch',
      'https://vod.sooplive.com/', 'https://www.sooplive.com/station/battleland', 'http://play.sooplive.com/battleland/297994793',
      'https://play.sooplive.com.evil.test/battleland/297994793', 'https://vod.sooplive.com/player/21100656a']) {
      assert.equal(route(href), null, href);
    }
  });

  it('declares AutoTheater for both routes and nothing else', () => {
    const page = (href: string) => {
      const identity = soopWatchPlayback.pageIdentity(new URL(href));
      return identity ? { provider: 'soop', identity } : null;
    };
    assert.deepEqual([page('https://play.sooplive.com/battleland/297994793')?.provider, page('https://play.sooplive.com/battleland/297994793')?.identity], ['soop', 'live:battleland/297994793']);
    assert.deepEqual([page('https://vod.sooplive.com/player/211006561')?.provider, page('https://vod.sooplive.com/player/211006561')?.identity], ['soop', 'vod:211006561']);
    assert.equal(page('https://vod.sooplive.com/player/catch'), null);
  });
});

describe('SOOP chapters', () => {
  it('builds the page-owned chapter request only for a numeric recording id', () => {
    assert.equal(soopChaptersUrl('211006561'), 'https://stbbs.sooplive.com/api/chapter/Controllers/ChapterListController.php?nTitleNo=211006561&szFileType=REVIEW');
    assert.equal(soopChaptersUrl('211006561&x=1'), null);
    assert.equal(soopChaptersUrl(''), null);
  });

  it('allows exactly that request through the page-fetch allowlist', () => {
    const allowed = (url: string) => isAllowedMediaFetchUrl({ provider: 'soop', kind: 'chapters', url });
    assert.equal(allowed(soopChaptersUrl('211006561')!), true);
    for (const url of [
      'http://stbbs.sooplive.com/api/chapter/Controllers/ChapterListController.php?nTitleNo=1&szFileType=REVIEW',
      'https://stbbs.sooplive.com.evil.test/api/chapter/Controllers/ChapterListController.php?nTitleNo=1&szFileType=REVIEW',
      'https://stbbs.sooplive.com/api/chapter/Controllers/ChapterListController.php?nTitleNo=1&szFileType=REVIEW&token=1',
      'https://stbbs.sooplive.com/api/chapter/Controllers/ChapterListController.php?nTitleNo=abc&szFileType=REVIEW',
      'https://stbbs.sooplive.com/api/chapter/Controllers/ChapterListController.php?nTitleNo=1',
      'https://stbbs.sooplive.com/api/other.php?nTitleNo=1&szFileType=REVIEW',
      'https://user@stbbs.sooplive.com/api/chapter/Controllers/ChapterListController.php?nTitleNo=1&szFileType=REVIEW'
    ]) assert.equal(allowed(url), false, url);
    assert.equal(isAllowedMediaFetchUrl({ provider: 'soop', kind: 'caption-track', url: soopChaptersUrl('1')! }), false, 'only as chapters');
  });

  it('turns the title history into chapters that end where the next begins', () => {
    const chapters = parseSoopChapters(chapterBody([
      { title: 'Second game', time_sec: 600, time_stamp: '10:00' }, { title: 'Intro', time_sec: 0 }, { title: 'Late', time_sec: 1000 }
    ]), 1159);
    assert.deepEqual(chapters.map(({ title, start, end }) => ({ title, start, end })), [
      { title: 'Intro', start: 0, end: 600 }, { title: 'Second game', start: 600, end: 1000 }, { title: 'Late', start: 1000, end: 1159 }
    ]);
    assert.ok(chapters.every(chapter => chapter.source === 'soop' && chapter.confidence === 'high'));
  });

  it('drops untitled, repeated, negative and out-of-range entries, and any failed or malformed answer', () => {
    assert.deepEqual(parseSoopChapters(chapterBody([
      { title: '  ', time_sec: 5 }, { title: 'A', time_sec: 10 }, { title: 'dup', time_sec: 10 }, { title: 'neg', time_sec: -1 }, { title: 'past', time_sec: 1159 }, { title: 'str', time_sec: '20' }, null
    ]), 1159).map(chapter => chapter.title), ['A']);
    assert.deepEqual(parseSoopChapters(chapterBody([{ title: 'A', time_sec: 0 }], 0), 1159), []);
    assert.deepEqual(parseSoopChapters('not json', 1159), []);
    assert.deepEqual(parseSoopChapters(chapterBody({ title: 'A' }), 1159), []);
    assert.deepEqual(parseSoopChapters(chapterBody([{ title: 'A', time_sec: 0 }]), Number.NaN), []);
  });
});

it('names SOOP live and replay chat and rejects clips and spoofed hosts', () => {
  const parse = (href: string) => soopChat.parseLocation(new URL(href));
  assert.deepEqual(parse('https://play.sooplive.com/AA/123?x=1'), {
    role: 'watch', provider: 'soop', contentKey: 'aa/123', kind: 'live'
  });
  assert.deepEqual(parse('https://vod.sooplive.com/player/211006561'), {
    role: 'watch', provider: 'soop', contentKey: '211006561', kind: 'replay'
  });
  for (const href of ['https://play.sooplive.com/battleland', 'https://vod.sooplive.com/player/catch',
    'http://play.sooplive.com/battleland/297994793', 'https://play.sooplive.com.evil.test/battleland/297994793']) assert.equal(parse(href), null);
  assert.equal(soopChat.matchesHost('play.sooplive.com'), true);
  assert.equal(soopChat.matchesHost('vod.sooplive.com'), true);
  assert.equal(soopChat.matchesHost('www.sooplive.com'), false);
});
