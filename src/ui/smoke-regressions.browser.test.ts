import { it } from 'node:test';

import { chromium, firefox } from 'playwright';

import { assertFullscreenAndHelp, assertPictureLayoutFixture } from '../test-utils/player-scenarios/audio-layout';
import { assertControlsPin } from '../test-utils/player-scenarios/controls-lifecycle';
import { playerFixture } from '../test-utils/player-scenarios/fixture';
import { assertTheaterToggle, assertPictureClickReclaimsKeys, assertThumbPlayerSwap, assertPlayerLocalization } from '../test-utils/player-scenarios/playback';
import { sharedTestBrowser } from '../test-utils/test-browser';
import { testEngines } from '../test-utils/test-engines';

for (const engine of testEngines()) {
  const shared = sharedTestBrowser(({ chromium, firefox })[engine]);
  for (const scenario of [assertTheaterToggle, assertPictureClickReclaimsKeys, assertThumbPlayerSwap, assertControlsPin, assertFullscreenAndHelp, assertPictureLayoutFixture, assertPlayerLocalization]) {
    // ThumbPlayer's standby swap belongs to the Tencent provider, which loads only on its hosts.
    const origin = scenario === assertThumbPlayerSwap ? 'https://v.qq.com' : undefined;
    it(`${engine}: fixture regression ${scenario.name}`, { timeout: 120_000 }, async t => {
      await scenario(await playerFixture(shared, t, origin));
    });
  }
}
