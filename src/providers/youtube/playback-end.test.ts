import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { countdownProgress } from './autonav';
import { youtubeContentEnded } from './playback-end-model';

const recorded = readFileSync(new URL('../../../test/host-fixtures/youtube-autonav.html', import.meta.url), 'utf8');
const classes = /id="movie_player" class="([^"]+)"/.exec(recorded)![1];
const seconds = Number(/countdown-number">(\d+)</.exec(recorded)![1]);

test('recorded YouTube ended class survives post-roll empty media; ads, live and loops override it (fixture evidence)', () => {
  assert.equal(youtubeContentEnded(classes, false, NaN), true);
  for (const flag of ['ad-showing', 'ad-interrupting', 'ytp-live', 'ytp-live-dvr']) {
    assert.equal(youtubeContentEnded(classes + ' ' + flag, false, NaN), false, flag);
  }
  assert.equal(youtubeContentEnded(classes, true, 19), false, 'Shorts/loops');
  assert.equal(youtubeContentEnded(classes, false, Infinity), false);
  assert.equal(youtubeContentEnded('paused-mode', false, 19), false, 'a pause near the end is not an end');
});

test('progress follows native digits, holds while the host pauses, and supports another native countdown length', () => {
  assert.equal(seconds, 8);
  assert.equal(countdownProgress(seconds, seconds), 0);
  assert.equal(countdownProgress(4, seconds), 0.5);
  assert.equal(countdownProgress(4, seconds), 0.5);
  assert.equal(countdownProgress(0, seconds), 1);
  assert.equal(countdownProgress(2, 5), 0.6);
  assert.equal(countdownProgress(null, seconds), undefined);
  assert.equal(countdownProgress(0, 0), undefined);
});
