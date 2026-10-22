import type { Page } from 'playwright';
import { fail, theaterEntered } from './state';
export async function preparePinAndMenus(page: Page) {
  const pin = page.locator('.controls-visibility-toggle');
  const controls = page.locator('.theater-controls-wrapper');
  const waitForChrome = async (pinned: boolean, visible: boolean, headerVisible: boolean) => {
    // Own idle deadlines in the fixture instead of waiting for wall time at every state change.
    if (!headerVisible) await page.clock.runFor(2800);
    await page.waitForFunction(({ pinned, visible, headerVisible }) => {
      const root = document.getElementById('theater-everywhere-ui')?.shadowRoot;
      const bar = root?.querySelector('.theater-controls-wrapper');
      const button = root?.querySelector('.controls-visibility-toggle');
      const header = root?.querySelector('.theater-everywhere-header-hud');
      return Boolean(bar && button && header
        && button.getAttribute('aria-pressed') === String(pinned)
        && bar.classList.contains('visible') === visible
        && header.classList.contains('visible') === headerVisible
        && (header as HTMLElement).inert === !headerVisible);
    }, { pinned, visible, headerVisible });
  };

  await page.locator('video#player').evaluate((video: HTMLVideoElement) => video.play());
  await page.locator('video#player').evaluate((video: HTMLVideoElement) => {
    const track = video.addTextTrack('subtitles', 'Smoke captions', 'en');
    track.addCue(new VTTCue(0, 3600, 'Pinned controls keep captions clear'));
    track.mode = 'hidden';
  });
  await page.locator('video#player').click();
  await page.keyboard.press('t');
  await page.keyboard.press('c');
  await page.locator('.theater-caption-overlay.visible').waitFor();
  await page.mouse.move(640, 300);
  await waitForChrome(false, true, true);
  await waitForChrome(false, false, false);

  // Pin an already hidden bar, suppress repeats, and keep the header idle.
  await page.keyboard.down('Shift');
  await page.keyboard.down('h');
  await pin.waitFor({ state: 'attached' });
  await page.keyboard.down('h');
  await page.keyboard.up('h');
  await page.keyboard.up('Shift');
  await waitForChrome(true, true, false);

  // Every existing action retains exactly one home, including conditional actions.
  const placement = await page.evaluate(() => {
    const root = document.getElementById('theater-everywhere-ui')!.shadowRoot!;
    const primary = ['play-pause-btn', 'playlist-prev-btn', 'playlist-next-btn', 'volume-btn', 'speed-btn', 'cc-btn', 'pip-btn', 'fullscreen-btn', 'close-btn'];
    const secondary = ['video-fit-btn', 'picture-layout-btn', 'controls-visibility-toggle', 'help-btn', 'auto-theater-btn'];
    return [...primary.map(name => ({ name, expected: '.theater-controls-row' })), ...secondary.map(name => ({ name, expected: '.theater-settings-menu' }))]
      .filter(({ name, expected }) => {
        const buttons = root.querySelectorAll(`.${name}`);
        return buttons.length !== 1 || !buttons[0].closest(expected)
          || (expected === '.theater-controls-row' && Boolean(buttons[0].closest('.theater-settings-menu')));
      });
  });
  if (placement.length) fail(`Toolbar actions were lost, duplicated or misplaced: ${JSON.stringify(placement)}`);
  const gear = page.locator('.player-settings-btn');
  const menu = page.locator('.theater-settings-menu');
  await gear.evaluate(async button => {
    const bar = button.closest('.theater-controls-wrapper')!;
    await Promise.all(bar.getAnimations({ subtree: true }).map(animation => animation.finished));
  });
  const closedGearIcon = await gear.locator('svg').boundingBox();
  await gear.focus();
  await gear.press('Enter');
  await menu.waitFor({ state: 'visible' });
  const openGearIcon = await gear.locator('svg').boundingBox();
  // Layout animations can leave subpixel rounding differences in the bounds.
  if (!closedGearIcon || !openGearIcon
      || (['x', 'y', 'width', 'height'] as const).some(key => Math.abs(openGearIcon[key] - closedGearIcon[key]) >= 0.5)) {
    fail(`Opening settings moved its icon: ${JSON.stringify({ closedGearIcon, openGearIcon })}`);
  }
  await page.mouse.move(640, 300);
  await waitForChrome(true, true, false);
  if (!await menu.isVisible()) fail('Idle header dismissed player settings on a pinned bar.');
  await page.waitForFunction(() => {
    const header = document.getElementById('theater-everywhere-ui')!.shadowRoot!.querySelector('.theater-everywhere-header-hud')!;
    return getComputedStyle(header).opacity === '0';
  });
  const menuClearance = await page.evaluate(() => {
    const root = document.getElementById('theater-everywhere-ui')!.shadowRoot!;
    const caption = root.querySelector('.theater-caption-overlay')!.getBoundingClientRect();
    const settings = root.querySelector('.theater-settings-menu')!.getBoundingClientRect();
    return caption.right <= settings.left || caption.left >= settings.right || caption.bottom <= settings.top;
  });
  if (!menuClearance) fail('Player settings overlap captions.');
  await page.setViewportSize({ width: 640, height: 720 });
  await page.mouse.move(320, 300);
  await page.waitForFunction(() => {
    const root = document.getElementById('theater-everywhere-ui')!.shadowRoot!;
    const caption = root.querySelector('.theater-caption-overlay')!.getBoundingClientRect();
    const settings = root.querySelector('.theater-settings-menu')!.getBoundingClientRect();
    return settings.left >= 0 && settings.right <= window.innerWidth
      && (caption.right <= settings.left || caption.left >= settings.right || caption.bottom <= settings.top + 1);
  });
  const narrowClearance = await page.evaluate(() => {
    const root = document.getElementById('theater-everywhere-ui')!.shadowRoot!;
    const caption = root.querySelector('.theater-caption-overlay')!.getBoundingClientRect();
    const settings = root.querySelector('.theater-settings-menu')!.getBoundingClientRect();
    return settings.left >= 0 && settings.right <= window.innerWidth
      && (caption.right <= settings.left || caption.left >= settings.right || caption.bottom <= settings.top + 1);
  });
  if (!narrowClearance) fail('Settings clip or overlap captions on a narrow player.');
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.mouse.move(640, 300);
  await waitForChrome(true, true, false);
  await page.waitForFunction(() => {
    const host = document.getElementById('theater-everywhere-ui')!;
    return host.getBoundingClientRect().width === window.innerWidth
      && !host.shadowRoot!.getAnimations().some(animation => animation.playState === 'running');
  });
  const settingsLayout = await page.evaluate(() => {
    const root = document.getElementById('theater-everywhere-ui')!.shadowRoot!;
    return ['.controls-visibility-toggle', '.help-btn', '.video-fit-btn'].map((selector) => {
      const row = root.querySelector(selector)!;
      const label = row.querySelector('.theater-settings-label')!.getBoundingClientRect();
      const keys = row.querySelector('.theater-settings-keys')!.getBoundingClientRect();
      const detail = row.querySelector('.theater-settings-detail, .theater-stepper')!.getBoundingClientRect();
      return {
        selector,
        kbds: [...row.querySelectorAll('.theater-settings-keys kbd')].map((key) => key.textContent),
        joiner: [...row.querySelector('.theater-settings-keys')!.childNodes]
          .filter((node) => node.nodeType === Node.TEXT_NODE)
          .map((node) => node.textContent)
          .join(''),
        value: row.querySelector('.theater-settings-detail, .theater-stepper-value')!.textContent ?? '',
        shortcutInValue: Boolean(row.querySelector('.theater-settings-detail kbd')),
        labelToKeys: Math.round(keys.left - label.right),
        keysToValue: detail.width === 0 ? null : Math.round(detail.left - keys.right),
      };
    });
  });
  const [pinLayout, helpLayout, fitLayout] = settingsLayout;
  if (!pinLayout || !helpLayout || !fitLayout
    || pinLayout.shortcutInValue || helpLayout.shortcutInValue || fitLayout.shortcutInValue
    || pinLayout.kbds.join('+') !== 'Shift+H' || pinLayout.joiner !== '+'
    || helpLayout.kbds.join('+') !== 'H' || helpLayout.value !== ''
    || fitLayout.kbds.join('+') !== 'Z' || fitLayout.value === ''
    || pinLayout.value === ''
    || pinLayout.labelToKeys > 16
    || pinLayout.keysToValue === null
    || pinLayout.keysToValue <= pinLayout.labelToKeys) {
    fail(`Player settings should keep shortcuts beside the name and values on the right: ${JSON.stringify(settingsLayout)}`);
  }
  if (process.env.THEATER_SMOKE_SCREENSHOT) {
    await page.screenshot({ path: process.env.THEATER_SMOKE_SCREENSHOT.replace(/\.png$/, '-settings.png') });
  }

  // A constrained viewport must scroll rows without moving the menu shell or
  // hiding its last action. Exercise both inline directions with the real UI.
  await page.setViewportSize({ width: 800, height: 280 });
  // The resize handler updates theater geometry on an animation frame.
  // Measure the constrained layout only once that update has reached the UI.
  await page.waitForFunction(() => {
    const menu = document.getElementById('theater-everywhere-ui')!.shadowRoot!.querySelector('.theater-settings-menu')!;
    const rect = menu.getBoundingClientRect();
    return rect.top >= 0 && rect.bottom <= window.innerHeight;
  }, null, { timeout: 5000 });
  const scrollChecks = await page.evaluate(() => {
    const root = document.getElementById('theater-everywhere-ui')!.shadowRoot!;
    const bar = root.querySelector<HTMLElement>('.theater-controls-wrapper')!;
    const menu = root.querySelector<HTMLElement>('.theater-settings-menu')!;
    const body = root.querySelector<HTMLElement>('.theater-settings-body')!;
    const originalDir = bar.getAttribute('dir');
    const results = ['ltr', 'rtl'].map(dir => {
      bar.setAttribute('dir', dir);
      body.scrollTop = 0;
      const before = menu.getBoundingClientRect();
      // Chat's hidden section can precede the player rows on ordinary videos.
      // Measure a rendered action rather than that zero-size section wrapper.
      const first = [...body.querySelectorAll<HTMLElement>('.theater-settings-row')]
        .find(row => row.getClientRects().length > 0)!;
      const firstBefore = first.getBoundingClientRect().top;
      body.scrollTop = body.scrollHeight;
      const after = menu.getBoundingClientRect();
      const last = body.lastElementChild!.getBoundingClientRect();
      return { dir, scrollTop: body.scrollTop, firstBefore,
        firstAfter: first.getBoundingClientRect().top,
        before: before.toJSON(), after: after.toJSON(), last: last.toJSON(),
        lastClass: body.lastElementChild!.className, passed: body.scrollTop > 0
        && first.getBoundingClientRect().top < firstBefore
        && before.top === after.top && before.bottom === after.bottom
        && after.top >= 0 && after.bottom <= window.innerHeight
        && last.top >= after.top && last.bottom <= after.bottom };
    });
    if (originalDir === null) bar.removeAttribute('dir');
    else bar.setAttribute('dir', originalDir);
    body.scrollTop = 0;
    return results;
  });
  if (scrollChecks.some(result => !result.passed)) fail(`Settings scroll clipped actions or moved its shell: ${JSON.stringify(scrollChecks)}`);
  await page.setViewportSize({ width: 1280, height: 720 });

  // Moved controls still execute commands, and keyboard activation never toggles video playback.
  const fitBefore = await page.locator('video#player').evaluate(video => getComputedStyle(video).objectFit);
  await menu.locator('.video-fit-btn [data-direction="1"]').click();
  await page.waitForFunction((before) => getComputedStyle(document.querySelector('video#player')!).objectFit !== before, fitBefore, { timeout: 5000 }).catch(async () => {
    const details = await page.evaluate(() => {
      const root = document.getElementById('theater-everywhere-ui')!.shadowRoot!;
      const video = document.querySelector<HTMLVideoElement>('video#player')!;
      const row = root.querySelector('.video-fit-btn')!;
      return { fit: getComputedStyle(video).objectFit, inline: video.style.cssText, row: row.textContent, menu: root.querySelector('.theater-settings-menu')!.className, active: document.querySelector('.theater-everywhere-video-active')?.id };
    });
    if (process.env.THEATER_SMOKE_SCREENSHOT) await page.screenshot({ path: process.env.THEATER_SMOKE_SCREENSHOT.replace(/\.png$/, '-failed.png') });
    fail(`Video fit stopped working after moving into settings: ${JSON.stringify(details)}`);
  });
  const fitAfter = await page.locator('video#player').evaluate(video => getComputedStyle(video).objectFit);
  if (fitBefore === fitAfter) fail('Video fit stopped working after moving into settings.');
  // Steps do not wrap: Fill back down to Fit takes two.
  await menu.locator('.video-fit-btn [data-direction="1"]').click();
  await menu.locator('.video-fit-btn [data-direction="-1"]').click();
  await menu.locator('.video-fit-btn [data-direction="-1"]').click();
  await pin.focus();
  const pausedBeforeSettings = await page.locator('video#player').evaluate((video: HTMLVideoElement) => video.paused);
  await page.keyboard.press('Space');
  if (await pin.getAttribute('aria-pressed') !== 'false') fail('Space did not activate settings visibility toggle.');
  await page.keyboard.press('Enter');
  if (await pin.getAttribute('aria-pressed') !== 'true') fail('Enter did not activate settings visibility toggle.');
  if (await page.locator('video#player').evaluate((video: HTMLVideoElement) => video.paused) !== pausedBeforeSettings) {
    fail('Activating a settings button also toggled playback.');
  }
  await page.keyboard.press('Escape');
  if (await menu.isVisible() || !await theaterEntered(page)
      || !await gear.evaluate(button => button.matches(':focus'))) {
    fail('Escape did not dismiss settings and return focus without leaving theater mode.');
  }
  await gear.press('Enter');
  if (!await menu.locator('.volume-boost-btn').evaluate(button => button.matches(':focus'))) {
    fail('Keyboard opening did not focus the first settings action.');
  }
  await page.keyboard.press('Shift+Tab');
  if (!await gear.evaluate(button => button.matches(':focus')) || !await menu.isVisible()) {
    fail('Shift+Tab from settings did not return to the neighboring trigger.');
  }
  await page.keyboard.press('Tab');
  if (!await menu.locator('.volume-boost-btn').evaluate(button => button.matches(':focus'))) {
    fail('Tab from the trigger skipped open settings.');
  }
  // A disabled arrow is not a tab stop: Voice and Leveling start at Off (no previous), Bass at Original (both),
  // Video fit at Fit (no previous).
  for (const [name, direction] of [['voice', 1], ['leveling', 1], ['bass', -1], ['bass', 1]] as const) {
    await page.keyboard.press('Tab');
    if (!await menu.locator(`.audio-${name}-btn [data-direction="${direction}"]`).evaluate(button => button.matches(':focus'))) fail(`Tab skipped the ${name} audio setting.`);
  }
  await page.keyboard.press('Tab');
  if (!await menu.locator('.video-fit-btn [data-direction="1"]').evaluate(button => button.matches(':focus'))) fail('Tab skipped the video fit setting.');
  await page.keyboard.press('Tab');
  if (!await menu.locator('.picture-layout-btn').evaluate(button => button.matches(':focus'))) fail('Tab skipped the picture layout setting.');
  await page.keyboard.press('Tab');
  if (!await pin.evaluate(button => button.matches(':focus'))) fail('Tab skipped the controls visibility setting.');
  await page.keyboard.press('Tab');
  const autoTheater = menu.locator('.auto-theater-btn');
  if (!await autoTheater.evaluate(button => button.matches(':focus'))) fail('Tab skipped automatic theater entry.');
  // The generic fixture has no watch-page support, so the row stays focusable but
  // reads unavailable and Space/Enter leave it untouched (toggling is covered by assertAutoTheater).
  if (await autoTheater.getAttribute('aria-disabled') !== 'true') fail('AutoTheater was not unavailable on a generic player.');
  const autoBefore = await autoTheater.getAttribute('aria-pressed');
  await page.keyboard.press('Space');
  await page.keyboard.press('Enter');
  if (await autoTheater.getAttribute('aria-pressed') !== autoBefore) fail('Unavailable automatic theater entry toggled.');
  if (await page.locator('video#player').evaluate((video: HTMLVideoElement) => video.paused) !== pausedBeforeSettings) {
    fail('Auto theater keyboard activation changed playback.');
  }
  await page.keyboard.press('Tab');
  if (!await menu.locator('.help-btn').evaluate(button => button.matches(':focus')
      && button.nextElementSibling?.classList.contains('extension-settings-btn'))) {
    fail('Keyboard shortcuts must be the last action above extension settings.');
  }
  await page.keyboard.press('Tab');
  if (!await menu.locator('.extension-settings-btn').evaluate(button => button.matches(':focus'))) {
    fail('Tab skipped extension settings.');
  }
  await page.keyboard.press('Tab');
  if (await menu.isVisible() || !await page.locator('.close-btn').evaluate(button => button.matches(':focus'))) {
    fail('Tab from the last settings row did not close the panel and reach the next toolbar action.');
  }
  await gear.press('Enter');
  await menu.locator('.help-btn').click();
  await page.locator('.theater-help-overlay').waitFor();
  if (await menu.isVisible()) fail('Settings stayed open over keyboard help.');
  await page.keyboard.press('Escape');
  if (!await gear.evaluate(button => button.matches(':focus'))) fail('Closing row-opened help did not focus the settings trigger.');
  await gear.press('Enter');
  await page.keyboard.press('h');
  await page.locator('.theater-help-overlay').waitFor();
  if (await menu.isVisible()) fail('Help shortcut left player settings open underneath.');
  await page.keyboard.press('Escape');
  if (await page.locator('.theater-help-overlay').count() || !await theaterEntered(page)) {
    fail('One Escape did not dismiss shortcut-opened help while retaining theater mode.');
  }
  if (!await gear.evaluate(button => button.matches(':focus'))) fail('Closing help from a settings row did not focus the gear.');
  await page.keyboard.press('Tab');
  if (!await page.locator('.close-btn').evaluate(button => button.matches(':focus'))) fail('Tab after help closure restarted outside the toolbar.');
  // Keyboard activation of the help row also returns to the gear, not a hidden row.
  await gear.press('Enter');
  await menu.locator('.help-btn').focus();
  await page.keyboard.press('Enter');
  await page.locator('.theater-help-overlay .te-dialog-close').press('Enter');
  if (await page.locator('.theater-help-overlay').count() || await menu.isVisible()
      || !await gear.evaluate(button => button.matches(':focus'))) fail('Enter closing row-opened help lost focus or reopened settings.');
  // Escape restores the gear; opening help from there must transfer focus into help.
  await gear.press('Enter');
  await page.keyboard.press('Escape');
  await page.keyboard.press('h');
  const helpClose = page.locator('.theater-help-overlay .te-dialog-close');
  await helpClose.waitFor();
  if (!await helpClose.evaluate(button => button.matches(':focus'))) fail('Help left focus on the settings gear.');
  const pinnedDuringHelp = await pin.getAttribute('aria-pressed');
  await page.keyboard.press('Shift+H');
  if (await pin.getAttribute('aria-pressed') !== pinnedDuringHelp) fail('Controls visibility preference changed behind help.');
  for (const key of ['Tab', 'Shift+Tab', 'Shift+Tab']) {
    await page.keyboard.press(key);
    if (!await page.locator('.theater-help-overlay .te-dialog').evaluate(dialog => dialog.contains((dialog.getRootNode() as Document | ShadowRoot).activeElement))) fail('Help let Tab reach controls behind the overlay.');
  }
  const pausedDuringHelp = await page.locator('video#player').evaluate((video: HTMLVideoElement) => video.paused);
  // Inert modal surroundings reject even programmatic focus behind help.
  await helpClose.focus();
  await gear.focus();
  if (await gear.evaluate(button => button.matches(':focus'))
      || !await helpClose.evaluate(button => button.matches(':focus'))
      || await menu.isVisible() || !await page.locator('.theater-help-overlay').count()) {
    fail('Help allowed focus or settings activation behind its modal.');
  }
  await page.keyboard.press('Escape');
  if (await page.locator('.theater-help-overlay').count() || !await theaterEntered(page)) {
    fail('One Escape did not close help after blocked gear activation.');
  }
  if (!await gear.evaluate(button => button.matches(':focus'))) fail('Escape from help did not restore the gear.');
  // Open help from the gear while the menu is open; Space natively closes help.
  await gear.press('Enter');
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('h');
  await helpClose.waitFor();
  await page.keyboard.press('Space');
  if (await page.locator('.theater-help-overlay').count() || await menu.isVisible()
      || !await theaterEntered(page)
      || await page.locator('video#player').evaluate((video: HTMLVideoElement) => video.paused) !== pausedDuringHelp) {
    fail('Space on help close activated hidden settings or playback.');
  }
  if (!await gear.evaluate(button => button.matches(':focus'))) fail('Space closing help did not restore focus to the gear.');
  // Other connected controls retain their own focus, rather than always using the gear.
  await page.locator('.cc-btn').focus();
  await page.keyboard.press('h');
  await helpClose.waitFor();
  await page.keyboard.press('Escape');
  if (!await page.locator('.cc-btn').evaluate(button => button.matches(':focus'))) fail('Help did not restore its original toolbar control.');
  await page.locator('.cc-btn').click();
  await page.locator('.theater-cc-menu.visible button').first().focus();
  await page.keyboard.press('h');
  await helpClose.waitFor();
  await page.keyboard.press('Escape');
  if (!await page.locator('.cc-btn').evaluate(button => button.matches(':focus'))) fail('Help did not return a hidden caption menu item to its trigger.');
  const cc = page.locator('.cc-btn');
  const captionsMenu = page.locator('.theater-cc-menu');
  const pausedBeforeCaptionMenu = await page.locator('video#player').evaluate((video: HTMLVideoElement) => video.paused);
  await cc.press('Enter');
  await page.locator('.theater-cc-menu-options').press('Space');
  const captionOptions = page.locator('.theater-caption-options-dialog');
  await captionOptions.waitFor();
  if (await page.locator('video#player').evaluate((video: HTMLVideoElement) => video.paused) !== pausedBeforeCaptionMenu) {
    fail('Space on caption Options toggled playback.');
  }
  await page.keyboard.press('Escape');
  await captionOptions.waitFor({ state: 'detached' });
  // This is a keyboard dismissal check. Hover must not open a different menu
  // as the dialog disappears and the caption/player layout settles.
  await page.mouse.move(640, 300);
  await cc.press('Enter');
  await captionsMenu.waitFor();
  await page.waitForFunction(() => {
    const root = document.getElementById('theater-everywhere-ui')!.shadowRoot!;
    const menu = root.querySelector('.theater-cc-menu')!;
    return menu.parentElement!.classList.contains('is-open')
      && root.querySelector('.cc-btn')!.getAttribute('aria-expanded') === 'true'
      && Boolean(root.activeElement && menu.contains(root.activeElement));
  });
  await page.keyboard.press('Escape');
  await captionsMenu.waitFor({ state: 'hidden' });
  if (await captionsMenu.isVisible() || !await theaterEntered(page)
      || !await cc.evaluate(button => button.matches(':focus'))) {
    const state = await page.evaluate(() => {
      const root = document.getElementById('theater-everywhere-ui')?.shadowRoot;
      return { htmlClasses: document.documentElement.className,
        focused: root?.activeElement?.outerHTML ?? document.activeElement?.outerHTML,
        captionHost: root?.querySelector('.theater-cc-menu')?.parentElement?.className,
        settingsHost: root?.querySelector('.theater-settings-menu')?.parentElement?.className,
        expanded: root?.querySelector('.cc-btn')?.getAttribute('aria-expanded') };
    });
    fail(`Escape did not dismiss captions and return focus without leaving theater mode: ${JSON.stringify(state)}`);
  }
  await gear.press('Enter');
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Shift+Tab');
  if (await menu.isVisible() || !await page.locator('.fullscreen-btn').evaluate(button => button.matches(':focus'))) {
    fail('Leaving the open gear toward fullscreen did not dismiss settings.');
  }
  await gear.hover();
  await menu.waitFor({ state: 'visible' });
  await gear.click();
  if (!await menu.isVisible()) fail('Clicking the settings gear toggled its menu closed.');
  await page.mouse.move(640, 300);
  if (!await menu.isVisible()) fail('Click did not keep the settings menu open.');
  await gear.click();
  await menu.waitFor({ state: 'hidden' });
  await gear.click();
  await page.locator('.cc-btn').click();
  if (await menu.isVisible()) fail('Captions did not dismiss player settings.');
  await page.locator('.cc-btn').click();
  await gear.click();
  await page.mouse.click(640, 300);
  if (await menu.isVisible()) fail('Outside click did not dismiss settings.');
  await page.locator('video#player').evaluate((video: HTMLVideoElement) => video.play());
  await page.mouse.move(640, 300);
  await waitForChrome(true, true, false);
  const timeBefore = await page.locator('video#player').evaluate((video: HTMLVideoElement) => video.currentTime);
  await page.waitForFunction(before => {
    const root = document.getElementById('theater-everywhere-ui')!.shadowRoot!;
    return document.querySelector<HTMLVideoElement>('video#player')!.currentTime > before
      && document.documentElement.classList.contains('theater-everywhere-cursor-hidden')
      && getComputedStyle(root.querySelector('.theater-everywhere-header-hud')!).opacity === '0';
  }, timeBefore);
  await waitForChrome(true, true, false);
  const timeAfter = await page.locator('video#player').evaluate((video: HTMLVideoElement) => video.currentTime);
  if (process.env.THEATER_SMOKE_SCREENSHOT) await page.screenshot({ path: process.env.THEATER_SMOKE_SCREENSHOT });
  if (timeAfter <= timeBefore) fail('Playback stopped while controls were pinned.');
  const dock = await page.evaluate(() => {
    const host = document.getElementById('theater-everywhere-ui')!;
    const bar = host.shadowRoot!.querySelector('.theater-controls-wrapper')!;
    const view = host.getBoundingClientRect();
    const box = bar.getBoundingClientRect();
    const video = document.querySelector('video#player')!.getBoundingClientRect();
    const plate = getComputedStyle(bar, '::before');
    return { left: box.left - view.left, right: view.right - box.right, bottom: view.bottom - box.bottom,
      pictureGap: box.top - video.bottom, radius: plate.borderTopLeftRadius,
      leftBorder: plate.borderLeftWidth, rightBorder: plate.borderRightWidth };
  });
  if (Math.abs(dock.left) > 1 || Math.abs(dock.right) > 1 || Math.abs(dock.bottom) > 1
      || Math.abs(dock.pictureGap) > 1 || dock.radius !== '0px'
      || dock.leftBorder !== '0px' || dock.rightBorder !== '0px') {
    fail(`Pinned controls did not dock and reserve picture space: ${JSON.stringify(dock)}`);
  }

  const idle = await page.evaluate(() => {
    const root = document.getElementById('theater-everywhere-ui')?.shadowRoot;
    const header = root?.querySelector('.theater-everywhere-header-hud');
    const home = root?.querySelector('.theater-home-pill');
    return {
      cursorHidden: document.documentElement.classList.contains('theater-everywhere-cursor-hidden'),
      headerOpacity: header ? getComputedStyle(header).opacity : null,
      homePointerEvents: home ? getComputedStyle(home).pointerEvents : null,
      captionsLifted: document.querySelector('video#player')?.classList.contains('controls-visible'),
      captionBottom: parseFloat(document.documentElement.style.getPropertyValue('--theater-caption-bottom'))
    };
  });
  if (!idle.cursorHidden || idle.headerOpacity !== '0' || idle.homePointerEvents !== 'none'
      || !idle.captionsLifted || !(idle.captionBottom > 48)) {
    fail(`Pinned idle chrome or caption clearance is incorrect: ${JSON.stringify(idle)}`);
  }

  return { pin, controls, waitForChrome, gear, menu, helpClose };
}
