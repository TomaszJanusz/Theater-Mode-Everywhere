import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { it } from 'node:test';

import { chromium, firefox } from 'playwright';

import collapsedJson from '../../test/host-fixtures/twitch-chat-collapsed.json';
import expandedJson from '../../test/host-fixtures/twitch-chat-expanded.json';
import { parseHostFixture } from '../../tools/host-fixtures/format';
import { signatureScript } from '../../tools/host-fixtures/page-inspect';
import { RECIPES } from '../../tools/host-fixtures/recipes';
import { fixtureDocument } from '../../tools/host-fixtures/render';
import { bundleModules } from '../test-utils/player-boot';
import { sharedTestBrowser } from '../test-utils/test-browser';
import { selectTestEngines } from '../test-utils/test-engines';

// Recorded from a live channel (test/host-fixtures, docs/browser-tests.md): the expanded column and
// its wrapper are zero-width and the visible 340 px shell is a translated descendant; collapsing
// hides the shell's wrapper. Fixture evidence only: the nightly drift check and real-host checks
// establish that Twitch still looks like this.
const CASES = [
  { fixture: parseHostFixture(expandedJson), expected: { initiallyVisible: true, visible: true } },
  // Unmeasurable, so the saved (hidden) preference decides.
  { fixture: parseHostFixture(collapsedJson), expected: { initiallyVisible: null, visible: false } }
];
// Twitch's chat hook registers only on its own host, as its isolated entry does in the manifest.
const bundle = bundleModules(["import './test-utils/fixture-runtimes';", "import './providers/twitch/isolated';",
  "export { detectChatSurface } from './chat/detect';", "export { ChatController } from './chat/controller';"], 'NativeChat');

for (const engine of selectTestEngines([chromium, firefox], engine => engine.name())) {
  const shared = sharedTestBrowser(engine);
  for (const { fixture, expected } of CASES) {
    it(`${engine.name()}: reads ${fixture.id} despite a saved hidden preference`, async t => {
      if (!existsSync(engine.executablePath())) { t.skip('Browser not installed'); return; }
      const context = await shared.newContext(t, { viewport: fixture.viewport });
      const page = await context.newPage();
      await page.route('https://www.twitch.tv/**', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: fixtureDocument(fixture) }));
      await page.goto('https://www.twitch.tv/somechannel');
      // The rendered fragment must reproduce what was recorded, or the assertions below prove nothing.
      assert.deepEqual(await page.evaluate(signatureScript(RECIPES[fixture.id].probes)), fixture.signature);
      await page.addScriptTag({ content: bundle });
      const report = await page.evaluate(`(() => {
        const href = 'https://www.twitch.tv/somechannel';
        const surface = NativeChat.detectChatSurface(document, href);
        const controller = new NativeChat.ChatController({
          document, href: () => href, onChange() {}, onLayoutChange() {},
          initialPreferences: { twitch: { visible: false, width: 360 } }
        });
        const report = { initiallyVisible: surface.initiallyVisible, visible: controller.state.visible };
        controller.dispose();
        return report;
      })()`);
      assert.deepEqual(report, expected);
    });
  }
}
