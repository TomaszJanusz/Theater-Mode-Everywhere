import { it } from 'node:test';
import { chromium, firefox } from 'playwright';
import { sharedTestBrowser } from '../test-utils/test-browser';
import { testEngines } from '../test-utils/test-engines';
import { playerFixture } from '../test-utils/player-scenarios/fixture';
import { assertTheaterToggle, assertPictureClickReclaimsKeys, assertScrubberPreviewLeaves, assertThumbPlayerSwap, assertPlayerLocalization } from '../test-utils/player-scenarios/playback';
import { assertControlsPin } from '../test-utils/player-scenarios/controls-lifecycle';
import { assertFullscreenAndHelp, assertPictureLayoutFixture } from '../test-utils/player-scenarios/audio-layout';

for (const engine of testEngines()) {
  const shared = sharedTestBrowser(({ chromium, firefox })[engine]);
  for (const scenario of [assertTheaterToggle, assertPictureClickReclaimsKeys, assertScrubberPreviewLeaves, assertThumbPlayerSwap, assertControlsPin, assertFullscreenAndHelp, assertPictureLayoutFixture, assertPlayerLocalization]) {
    it(`${engine}: fixture regression ${scenario.name}`, { timeout: 120_000 }, async t => {
      await scenario(await playerFixture(shared, t));
    });
  }
}
