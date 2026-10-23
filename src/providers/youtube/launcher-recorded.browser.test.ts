import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { it } from 'node:test';

import { chromium, firefox } from 'playwright';

import { committedFixture } from '../../../tools/host-fixtures/committed';
import { signatureScript } from '../../../tools/host-fixtures/page-inspect';
import { RECIPES } from '../../../tools/host-fixtures/recipes';
import { fixtureDocument } from '../../../tools/host-fixtures/render';
import { bundleModules } from '../../test-utils/player-boot';
import { sharedTestBrowser } from '../../test-utils/test-browser';
import { selectTestEngines } from '../../test-utils/test-engines';

// Recorded from a public watch page (test/host-fixtures, docs/browser-tests.md). Fixture evidence:
// the nightly drift check and real-host checks establish that the player still looks like this.
const fixture = committedFixture('youtube-watch-player');
const bundle = bundleModules(["export { youtubeLauncherPlacement } from './providers/youtube/launcher-placement';"], 'Launcher');

for (const engine of selectTestEngines([chromium, firefox], engine => engine.name())) {
  const shared = sharedTestBrowser(engine);
  it(`${engine.name()}: mounts the launcher before the recorded autoplay toggle without moving native controls`, async t => {
    if (!existsSync(engine.executablePath())) { t.skip('Browser not installed'); return; }
    const context = await shared.newContext(t, { viewport: fixture.viewport });
    const page = await context.newPage();
    await page.setContent(fixtureDocument(fixture));
    assert.deepEqual(await page.evaluate(signatureScript(RECIPES[fixture.id].probes)), fixture.signature);
    await page.addScriptTag({ content: bundle });
    const report = await page.evaluate(`(() => {
      const controls = document.querySelector('.ytp-right-controls');
      const before = [...controls.querySelectorAll('*')];
      const placement = Launcher.youtubeLauncherPlacement(document.querySelector('.html5-video-player video'), () => {});
      const slot = placement.read();
      if (!slot) return null;
      const button = document.createElement('button');
      slot.mount(button);
      const after = [...controls.querySelectorAll('*')].filter(node => node !== button && !button.contains(node));
      const report = {
        persistent: slot.persistent,
        anchorIsToggle: Boolean(slot.before.querySelector('.ytp-autonav-toggle-button')),
        insertedBefore: button.nextElementSibling === slot.before,
        nativeOrderKept: after.length === before.length && after.every((node, index) => node === before[index])
      };
      placement.dispose();
      return report;
    })()`);
    assert.deepEqual(report, { persistent: true, anchorIsToggle: true, insertedBefore: true, nativeOrderKept: true });
  });
}
