import assert from 'node:assert/strict';
import { describe, it } from 'node:test';


import { iqiyiPlayId } from './page';
import { iqiyiChapters, normalizeIqiyiPlayInfo, parseIqiyiSnapshot, type IqiyiSnapshot } from './play-info';
import { iqiyiWatchPlayback } from './watch-playback';

const playInfo = (overrides: Record<string, unknown> = {}, program: unknown = { video: [{ duration: 2569 }] }) => ({
  data: { tvid: 4546375215960300, program, p: { bt: 14, et: 2415, ete: 2568, ...overrides } }
});
const snapshot: IqiyiSnapshot = { tvid: '4546375215960300', duration: 2569, introEnd: 14, outroStart: 2415, outroEnd: 2568 };

describe('iQIYI play identity', () => {
  it('takes the id after the last hyphen, whatever the language slug', () => {
    assert.equal(iqiyiPlayId('/play/spring-of-the-blade-episode-1-198yzaqjce8'), '198yzaqjce8');
    assert.equal(iqiyiPlayId('/play/spring-of-the-blade-zdvopqlcc8/'), 'zdvopqlcc8');
    assert.equal(iqiyiPlayId('/play/198yzaqjce8'), '198yzaqjce8');
  });

  it('rejects pages that are not an episode', () => {
    for (const path of ['/', '/album/spring-of-the-blade-2026-1nby7voujqx', '/play/', '/play/a/b-c', '/channel/play-x']) {
      assert.equal(iqiyiPlayId(path), null, path);
    }
  });

  it('declares AutoTheater only for https www.iq.com episode pages', () => {
    const read = (href: string) => iqiyiWatchPlayback.pageIdentity(new URL(href));
    assert.equal(read('https://www.iq.com/play/spring-of-the-blade-episode-2-1w9dte7osf8?lang=en_us'), '1w9dte7osf8');
    for (const href of ['https://www.iq.com/', 'https://www.iq.com/album/spring-of-the-blade-2026-1nby7voujqx',
      'http://www.iq.com/play/x-1w9dte7osf8', 'https://www.iq.com.evil.test/play/x-1w9dte7osf8']) {
      assert.equal(read(href), null, href);
    }
  });
});

describe('iQIYI play info', () => {
  it('keeps the episode id, duration and skip windows of a valid response', () => {
    assert.deepEqual(normalizeIqiyiPlayInfo(playInfo()), snapshot);
  });

  it('rejects a response without an episode id or duration, and drops invalid skip times', () => {
    assert.equal(normalizeIqiyiPlayInfo(null), null);
    assert.equal(normalizeIqiyiPlayInfo({ data: { program: { video: [{ duration: 10 }] } } }), null);
    assert.equal(normalizeIqiyiPlayInfo(playInfo({}, { video: [] })), null);
    assert.equal(normalizeIqiyiPlayInfo({ data: { tvid: '12; DROP', program: { video: [{ duration: 10 }] } } }), null);
    assert.deepEqual(normalizeIqiyiPlayInfo(playInfo({ bt: -1, et: '2415', ete: 1e9 })), { ...snapshot, introEnd: null, outroStart: null, outroEnd: null });
  });

  it('turns the skip windows into Intro and Outro chapters', () => {
    assert.deepEqual(iqiyiChapters(snapshot, 2570).map(({ start, end, title }) => ({ start, end, title })), [
      { start: 0, end: 14, title: 'Intro' }, { start: 2415, end: 2568, title: 'Outro' }
    ]);
    assert.deepEqual(iqiyiChapters({ ...snapshot, introEnd: 0, outroStart: null }, 2570), []);
  });

  it('validates the cross-world snapshot again instead of trusting its shape', () => {
    assert.deepEqual(parseIqiyiSnapshot({ ...snapshot }), snapshot);
    assert.deepEqual(parseIqiyiSnapshot({ ...snapshot, introEnd: -1, outroStart: 'x' }), { ...snapshot, introEnd: null, outroStart: null });
    for (const bad of [null, 'x', [], {}, { ...snapshot, tvid: 4546375215960300 }, { ...snapshot, tvid: '1; DROP' }, { ...snapshot, duration: 0 }]) {
      assert.equal(parseIqiyiSnapshot(bad), null, JSON.stringify(bad));
    }
  });

  it('ignores data that describes another episode or an impossible window', () => {
    assert.deepEqual(iqiyiChapters(snapshot, 1320), []);
    assert.deepEqual(iqiyiChapters(snapshot, Number.NaN), []);
    assert.deepEqual(iqiyiChapters(null, 2570), []);
    assert.deepEqual(iqiyiChapters({ ...snapshot, outroStart: 2568, outroEnd: 2415 }, 2570).map(c => c.title), ['Intro']);
    assert.deepEqual(iqiyiChapters({ ...snapshot, outroEnd: 3600 }, 2570).map(c => c.title), ['Intro']);
  });
});
