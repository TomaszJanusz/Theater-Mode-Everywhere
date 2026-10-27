import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { IqiyiAdapter } from './adapter';
import { iqiyiPlayId } from './page';

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
});

describe('iQIYI adapter without caption data', () => {
  it('advertises no tracks and fails a track request without touching the host', async () => {
    const adapter = new IqiyiAdapter();
    assert.deepEqual(await adapter.probe(), { captions: false, chapters: false, previews: false });
    assert.deepEqual(await adapter.listCaptionTracks(), []);
    assert.equal((await adapter.activateCaptionTrack('anything')).status, 'failed');
    assert.equal((await adapter.activateCaptionTrack(null)).status, 'off');
  });
});
