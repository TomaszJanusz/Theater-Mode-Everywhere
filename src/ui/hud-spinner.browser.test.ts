import assert from 'node:assert/strict';
import { it } from 'node:test';

import { chromium, firefox, type Page } from 'playwright';

import { bundleModules, playerStylesheets } from '../test-utils/player-boot';
import { sharedTestBrowser } from '../test-utils/test-browser';
import { testEngines } from '../test-utils/test-engines';

const browsers = Object.fromEntries(testEngines().map(engine => [engine, sharedTestBrowser({ chromium, firefox }[engine])]));

const bundle = bundleModules([
  "export { createHud } from './ui/hud';",
  "export { setPlayerUiCss } from './ui/root';"
], 'HudSpinnerTest');
const css = playerStylesheets().ui;

/** A HUD host with a buffering spinner plate, driven by the test clock. */
async function setup(page: Page, motion: 'normal' | 'reduced') {
  await page.addInitScript('window.__name = target => target;');
  await page.goto('about:blank');
  await page.addScriptTag({ content: bundle });
  await page.clock.install();
  await page.clock.pauseAt(new Date(Date.now() + 60_000));
  await page.evaluate(`window.session = { element: document.body, currentEpoch: 1 };
    window.host = document.createElement('div');
    host.id = 'theater-everywhere-ui'; host.dataset.motion = '${motion}';
    document.body.append(host);
    const root = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    // Transitions follow wall time, not the test clock: read the settled opacity.
    style.textContent = ${JSON.stringify(css)} + '.theater-loading-indicator.visible{transition:none !important}';
    root.append(style);
    const plate = document.createElement('div');
    plate.className = 'theater-loading-indicator theater-hud-plate visible';
    plate.innerHTML = '<div class="theater-loading-spinner"></div>';
    root.append(plate);
    window.hud = HudSpinnerTest.createHud({ session,
      queryPlayerUi: selector => root.querySelector(selector),
      mountPlayerUi: overlay => root.append(overlay),
      t: key => key, paintOverlay() {} });`);
}

const plateOpacity = (page: Page) => page.evaluate(() => getComputedStyle(
  document.getElementById('theater-everywhere-ui')!.shadowRoot!.querySelector('.theater-loading-indicator')!).opacity);

for (const engine of testEngines()) {
  const shared = browsers[engine];

  it(`${engine}: a centred HUD hides the buffering spinner and gives it back afterwards`, { timeout: 40_000 }, async t => {
    const page = await (await shared.newContext(t)).newPage();
    await setup(page, 'normal');
    assert.equal(await plateOpacity(page), '1');

    await page.evaluate("hud.triggerPlaybackIndicator('pause')");
    assert.equal(await plateOpacity(page), '0', 'the HUD wins the shared centre');

    // Back-to-back HUDs keep one hidden spinner; the earlier HUD's deadline must not bring it back.
    await page.clock.runFor(2000);
    await page.evaluate("hud.triggerVolumeIndicator(0.5, false, 'up')");
    await page.clock.runFor(2000);
    assert.equal(await plateOpacity(page), '0');
    await page.evaluate("hud.triggerStatusIndicator('Bass: More', '')");
    await page.clock.runFor(2799);
    assert.equal(await plateOpacity(page), '0', 'hidden until the HUD is removed');
    await page.clock.runFor(201);
    assert.equal(await page.locator('.theater-everywhere-volume-overlay').count(), 0);
    assert.equal(await plateOpacity(page), '1', 'still buffering: the spinner returns');
  });

  it(`${engine}: a spinner that stopped during the HUD stays gone, and an early dismissal brings it back`, { timeout: 40_000 }, async t => {
    const page = await (await shared.newContext(t)).newPage();
    await setup(page, 'normal');
    await page.evaluate("hud.triggerPlaybackIndicator('pause')");
    await page.evaluate("document.getElementById('theater-everywhere-ui').shadowRoot.querySelector('.theater-loading-indicator').classList.remove('visible')");
    await page.clock.runFor(3000);
    assert.equal(await plateOpacity(page), '0', 'buffering ended: no spinner after the HUD');

    await page.evaluate("document.getElementById('theater-everywhere-ui').shadowRoot.querySelector('.theater-loading-indicator').classList.add('visible')");
    await page.evaluate("hud.triggerPlaybackIndicator('play'); hud.dismissPlaybackIndicator()");
    assert.equal(await plateOpacity(page), '1', 'a withdrawn HUD releases the spinner');
    await page.clock.runFor(5000);
    assert.equal(await plateOpacity(page), '1');
  });

  it(`${engine}: leaving theater or ending the session clears the HUD state`, { timeout: 40_000 }, async t => {
    const page = await (await shared.newContext(t)).newPage();
    await setup(page, 'normal');
    await page.evaluate("hud.triggerStatusIndicator('Bass: More', '')");
    assert.equal(await plateOpacity(page), '0');
    await page.evaluate('hud.removeCenteredHud(); hud.removeCenteredHud()');
    assert.equal(await page.evaluate('host.hasAttribute("data-centered-hud")'), false);
    assert.equal(await plateOpacity(page), '1');
    // A stale deadline of the removed HUD cannot touch a newer one.
    await page.evaluate("hud.triggerStatusIndicator('Again', '')");
    await page.clock.runFor(1000);
    await page.evaluate('hud.removeCenteredHud(); hud.triggerVolumeIndicator(0.5, false, "up")');
    await page.clock.runFor(2799);
    assert.equal(await plateOpacity(page), '0');
  });

  it(`${engine}: reduced motion hides the spinner without a transition`, { timeout: 40_000 }, async t => {
    const page = await (await shared.newContext(t)).newPage();
    await setup(page, 'reduced');
    await page.evaluate("hud.triggerPlaybackIndicator('pause')");
    assert.equal(await plateOpacity(page), '0');
    await page.clock.runFor(3000);
    assert.equal(await plateOpacity(page), '1');
  });
}
