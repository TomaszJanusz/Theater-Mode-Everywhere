import type { Page } from 'playwright';
import { fail, theaterEntered } from './state';
import { preparePinAndMenus } from './controls-settings';
export async function assertControlsPin(page: Page): Promise<void> {
  const { pin, controls, waitForChrome, gear, menu, helpClose } = await preparePinAndMenus(page);
  // Editable fields must not consume the shortcut.
  await page.evaluate(() => {
    const input = document.createElement('input');
    input.id = 'pin-test-input';
    document.body.appendChild(input);
    input.focus();
  });
  await page.keyboard.press('Shift+H');
  if (await pin.getAttribute('aria-pressed') !== 'true') fail('Pin shortcut fired in an input.');
  await page.evaluate(() => document.getElementById('pin-test-input')?.remove());

  // Keyboard focus keeps Home reachable, and hovering the bar keeps the cursor usable.
  await page.locator('.player-settings-btn').focus();
  await page.keyboard.press('Tab');
  await waitForChrome(true, true, true);
  await page.clock.runFor(2800);
  await waitForChrome(true, true, true);
  await page.evaluate(() => (document.getElementById('theater-everywhere-ui')?.shadowRoot?.activeElement as HTMLElement | null)?.blur());
  await page.locator('.player-settings-btn').hover();
  await page.clock.runFor(2800);
  const cursorHiddenOverControls = await page.evaluate(() =>
    document.documentElement.classList.contains('theater-everywhere-cursor-hidden'));
  if (cursorHiddenOverControls || await page.locator('.player-settings-btn').evaluate((el) => getComputedStyle(el).cursor) === 'none') {
    fail('Cursor is hidden over a pinned control.');
  }
  await page.mouse.move(640, 300);
  await waitForChrome(true, true, false);

  // Idle header changes must not dismiss the menu on the pinned playback bar.
  await page.locator('.cc-btn').click();
  await page.mouse.move(640, 300);
  await waitForChrome(true, true, false);
  if (!await page.locator('.theater-cc-menu.visible').count()) fail('Idle chrome dismissed the pinned captions menu.');
  await page.locator('.cc-btn').click();
  await page.mouse.move(640, 300);

  await page.keyboard.press('f');
  await page.waitForFunction(() => Boolean(document.fullscreenElement));
  await waitForChrome(true, true, false);
  await page.keyboard.press('f');
  await page.waitForFunction(() => !document.fullscreenElement);

  // Rebuild the UI, retaining the saved/local preference.
  await page.keyboard.press('Escape');
  await controls.waitFor({ state: 'detached' });
  await page.keyboard.press('t');
  await waitForChrome(true, true, true);
  await waitForChrome(true, true, false);

  // Speed stays directly accessible for VOD; live streams keep their existing hidden-speed policy.
  await page.locator('video#player').evaluate(async (video: HTMLVideoElement & { _smokeStream?: MediaProvider | null }) => {
    video._smokeStream = video.srcObject;
    video.srcObject = null;
    video.src = '/vod.webm';
    video.loop = true;
    await video.play();
  });
  await page.locator('.speed-btn').waitFor({ state: 'visible' });
  const rateBefore = await page.locator('video#player').evaluate((video: HTMLVideoElement) => video.playbackRate);
  await page.locator('.speed-btn').click();
  const rateAfter = await page.locator('video#player').evaluate((video: HTMLVideoElement) => video.playbackRate);
  if (rateBefore === rateAfter) fail('Primary speed control stopped working for VOD.');
  await page.locator('.speed-btn').click();
  // Returning to live hides Speed and moves CC into its place. Keep the cursor
  // over the picture so that relayout cannot open captions and consume Escape.
  await page.mouse.move(640, 300);
  await page.locator('video#player').evaluate(async (video: HTMLVideoElement & { _smokeStream?: MediaProvider | null }) => {
    video.removeAttribute('src');
    video.srcObject = video._smokeStream ?? null;
    delete video._smokeStream;
    video.loop = false;
    await video.play();
  });
  await page.locator('.speed-btn').waitFor({ state: 'hidden' });

  // A second real player must keep switching available in settings, including after rebuilds.
  await page.evaluate(async () => {
    const original = document.querySelector<HTMLVideoElement>('video#player')!;
    const other = document.createElement('video');
    other.id = 'other-player';
    other.muted = true;
    other.playsInline = true;
    other.srcObject = original.srcObject;
    other.style.cssText = 'width:240px;height:135px';
    document.body.append(other);
    await other.play();
  });
  await page.waitForFunction(() => document.querySelector<HTMLVideoElement>('#other-player')!.readyState >= 2);
  await page.locator('.theater-menu.is-open').waitFor({ state: 'hidden' });
  await page.keyboard.press('Escape');
  await controls.waitFor({ state: 'detached' });
  await page.locator('video#player').click();
  await page.keyboard.press('t');
  await gear.click();
  const switchButton = menu.locator('.switch-video-btn');
  if (await page.locator('.switch-video-btn').count() !== 1 || !await switchButton.isVisible()) {
    fail('Conditional player switching was lost or duplicated in settings.');
  }
  await switchButton.click();
  await page.waitForFunction(() => document.querySelector('#other-player')!.classList.contains('theater-everywhere-video-active'));
  const assertHelpAfterRebuild = async () => {
    if (await page.locator('.theater-help-overlay').count()) fail('Help remained mounted after rebuilding controls.');
    await gear.focus();
    await page.keyboard.press('Tab');
    if (!await page.locator('.close-btn').evaluate(button => button.matches(':focus'))) fail('Detached help trapped Tab after a player rebuild.');
    await gear.focus();
    await page.keyboard.press('h');
    await helpClose.waitFor();
    await page.keyboard.press('Escape');
    if (await page.locator('.theater-help-overlay').count() || !await theaterEntered(page)
        || !await gear.evaluate(button => button.matches(':focus'))) fail('Help did not reopen and close normally after a player rebuild.');
  };
  await page.keyboard.press('h');
  await helpClose.waitFor();
  await page.keyboard.press('Shift+T');
  if (!await page.locator('#other-player').evaluate(video => video.classList.contains('theater-everywhere-video-active'))) fail('Player switching fired behind the modal.');
  // Simulate a host-driven player rebuild while modal focus is active.
  await switchButton.evaluate((button: HTMLElement) => button.click());
  await page.waitForFunction(() => document.querySelector('video#player')!.classList.contains('theater-everywhere-video-active'));
  await assertHelpAfterRebuild();
  await waitForChrome(true, true, true);
  await page.evaluate(() => document.getElementById('other-player')!.remove());
  await page.keyboard.press('Escape');
  await controls.waitFor({ state: 'detached' });
  // T deliberately ignores toggles within 200ms; fast runners can reach this re-entry inside that window.
  await page.clock.runFor(250);
  await page.keyboard.press('t');
  await waitForChrome(true, true, true);
  if (await page.locator('.switch-video-btn').count()) fail('Unavailable switching remained after returning to a single player.');

  // Host-driven video replacement while help owns focus must clear the same state.
  await page.keyboard.press('h');
  await helpClose.waitFor();
  await page.locator('video#player').evaluate((original: HTMLVideoElement) => {
    const replacement = document.createElement('video');
    replacement.id = 'player';
    replacement.muted = true;
    replacement.playsInline = true;
    replacement.srcObject = original.srcObject;
    original.replaceWith(replacement);
  });
  await page.waitForFunction(() => {
    const video = document.querySelector<HTMLVideoElement>('video#player')!;
    return video.classList.contains('theater-everywhere-video-active') && video.readyState >= 2 && !video.paused;
  });
  await assertHelpAfterRebuild();
  // Recover if a host removes just the overlay node without rebuilding controls.
  await gear.focus();
  await page.keyboard.press('h');
  await helpClose.waitFor();
  await page.locator('.theater-help-overlay').evaluate(overlay => overlay.remove());
  await page.keyboard.press('Enter');
  if (await menu.isVisible() || await gear.evaluate(button => button.matches(':focus'))) fail('Host-removed help restored and activated the settings trigger.');
  await page.mouse.move(640, 300);
  await waitForChrome(true, true, false);
  // Set an explicit starting focus instead of assuming page focus returns to the gear.
  await gear.focus();
  await page.keyboard.press('Tab');
  if (!await page.locator('.close-btn').evaluate(button => button.matches(':focus'))) fail('Host-removed help left a hidden Tab trap.');
  await page.keyboard.press('h');
  await helpClose.waitFor();
  await page.keyboard.press('Escape');
  if (!await theaterEntered(page)) fail('Disconnected help recovery exited theater.');
  await page.evaluate(() => (document.getElementById('theater-everywhere-ui')?.shadowRoot?.activeElement as HTMLElement | null)?.blur());
  await page.mouse.move(640, 300);

    await page.keyboard.press('Shift+H');
    await waitForChrome(false, true, true);
  await waitForChrome(false, false, false);
  await page.keyboard.press('Escape');
  await controls.waitFor({ state: 'detached' });
  if (await page.evaluate(() => document.documentElement.classList.contains('theater-everywhere-cursor-hidden'))) {
    fail('Exiting theater mode left the cursor hidden.');
  }
}
