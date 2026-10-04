import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium, firefox, type BrowserContext, type Page } from 'playwright';

type SmokeBrowser = 'chromium' | 'firefox';

const ROOT = path.resolve(__dirname, '..');
const PLAYER_FIXTURE = path.join(ROOT, 'test/fixtures/local-player.html');
const IFRAME_FIXTURE = path.join(ROOT, 'test/fixtures/iframe-player.html');
const YOUTUBE_EMBED_FIXTURE = path.join(ROOT, 'test/fixtures/youtube-embed.html');
// Two seconds of neutral 160x90 VP8 frames, with real finite-duration WebM metadata.
const VOD_FIXTURE = path.join(ROOT, 'test/fixtures/vod.webm');
const THEATER_VIDEO_CLASS = 'theater-everywhere-video-active';
const THEATER_HTML_CLASS = 'theater-everywhere-html-active';
const PARENT_HOST = 'child.example.localhost';
const PARENT_BLACKLIST = 'example.localhost';

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function skipLocally(message: string): never {
  if (process.env.CI) fail(message);
  console.warn(message);
  process.exit(0);
}

function requestedBrowsers(): SmokeBrowser[] {
  const arg = process.argv[2];
  if (!arg) return ['chromium', 'firefox'];
  if (arg === 'chromium' || arg === 'firefox') return [arg];
  fail(`Unknown smoke target "${arg}". Use chromium, firefox, or omit for both.`);
}

function playwrightExecutable(kind: SmokeBrowser): string | null {
  try {
    const exe = kind === 'chromium' ? chromium.executablePath() : firefox.executablePath();
    return existsSync(exe) ? exe : null;
  } catch {
    return null;
  }
}

function requireBuiltExtension(kind: SmokeBrowser): string {
  const dir = path.join(ROOT, 'dist', kind === 'chromium' ? 'chrome-unpacked' : 'firefox-unpacked');
  const contentJs = path.join(dir, 'content.js');
  const contentCss = path.join(dir, 'content.css');
  if (!existsSync(contentJs) || !existsSync(contentCss)) {
    fail(`Missing ${dir}. Run pnpm build before smoke tests.`);
  }
  return dir;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function startFixtureServer(): Promise<{ origin: string; close: () => Promise<void> }> {
  const player = readFileSync(PLAYER_FIXTURE);
  const iframe = readFileSync(IFRAME_FIXTURE);
  const youtubeEmbed = readFileSync(YOUTUBE_EMBED_FIXTURE);
  const vod = readFileSync(VOD_FIXTURE);
  const server = createServer((req, res) => {
    const url = req.url || '/';
    if (url.startsWith('/vod.webm')) {
      res.writeHead(200, { 'content-type': 'video/webm', 'content-length': vod.length, 'cache-control': 'no-store' });
      res.end(vod);
      return;
    }
    const body = url.startsWith('/youtube-embed')
      ? youtubeEmbed
      : url.startsWith('/iframe')
        ? iframe
        : player;
    res.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store'
    });
    res.end(body);
  });

  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address() as AddressInfo;
      resolve({
        origin: `http://127.0.0.1:${address.port}`,
        close: () => new Promise((done, failClose) => {
          server.close((err) => (err ? failClose(err) : done()));
        })
      });
    });
    server.on('error', reject);
  });
}

async function waitForPlayer(page: Page): Promise<void> {
  await page.waitForSelector('video#player', { timeout: 15_000 });
  await page.waitForFunction(() => {
    const video = document.querySelector('video#player') as HTMLVideoElement | null;
    if (!video) return false;
    const box = video.getBoundingClientRect();
    return box.width >= 80 && box.height >= 80;
  }, null, { timeout: 15_000 });
}

async function theaterEntered(page: Page): Promise<boolean> {
  return page.evaluate(({ videoClass, htmlClass }) => {
    const video = document.querySelector('video#player');
    return Boolean(video?.classList.contains(videoClass) || document.documentElement.classList.contains(htmlClass));
  }, { videoClass: THEATER_VIDEO_CLASS, htmlClass: THEATER_HTML_CLASS });
}

async function assertTheaterToggle(page: Page): Promise<void> {
  await page.click('video#player');
  await page.keyboard.press('t');
  await page.waitForFunction(({ videoClass, htmlClass }) => {
    const video = document.querySelector('video#player');
    return Boolean(video?.classList.contains(videoClass) || document.documentElement.classList.contains(htmlClass));
  }, { videoClass: THEATER_VIDEO_CLASS, htmlClass: THEATER_HTML_CLASS }, { timeout: 10_000 });

  if (!await theaterEntered(page)) fail('Theater mode did not activate after T.');

  const pausedBefore = await page.evaluate(() => {
    const video = document.querySelector('video#player') as HTMLVideoElement | null;
    return Boolean(video?.paused);
  });
  await page.keyboard.press('Space');
  await delay(400);
  const pausedAfter = await page.evaluate(() => {
    const video = document.querySelector('video#player') as HTMLVideoElement | null;
    return Boolean(video?.paused);
  });
  if (pausedAfter === pausedBefore) {
    const diagnostics = await page.locator('video#player').evaluate((video: HTMLVideoElement) => ({ paused: video.paused, time: video.currentTime, ready: video.readyState, source: Boolean(video.srcObject), error: video.error?.message }));
    fail(`Space did not toggle playback (before=${pausedBefore}, after=${pausedAfter}): ${JSON.stringify(diagnostics)}`);
  }
  if (!pausedAfter) {
    await page.keyboard.press('Space');
    await delay(200);
  }

  await page.keyboard.press('Escape');
  await page.waitForFunction(({ videoClass, htmlClass }) => {
    const video = document.querySelector('video#player');
    return !video?.classList.contains(videoClass) && !document.documentElement.classList.contains(htmlClass);
  }, { videoClass: THEATER_VIDEO_CLASS, htmlClass: THEATER_HTML_CLASS }, { timeout: 10_000 });
}

async function assertControlsPin(page: Page, context?: BrowserContext): Promise<void> {
  const pin = page.locator('.controls-visibility-toggle');
  const controls = page.locator('.theater-controls-wrapper');
  const waitForChrome = async (pinned: boolean, visible: boolean, headerVisible: boolean) => {
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
    const secondary = ['video-fit-btn', 'controls-visibility-toggle', 'help-btn'];
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
  await gear.click();
  await menu.waitFor({ state: 'visible' });
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
  await delay(400);
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
  await delay(400);
  if (process.env.THEATER_SMOKE_SCREENSHOT) {
    await page.screenshot({ path: process.env.THEATER_SMOKE_SCREENSHOT.replace(/\.png$/, '-settings.png') });
  }

  // Moved controls still execute commands, and keyboard activation never toggles video playback.
  const fitBefore = await page.locator('video#player').evaluate(video => getComputedStyle(video).objectFit);
  await menu.locator('.video-fit-btn').click();
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
  await menu.locator('.video-fit-btn').click();
  await menu.locator('.video-fit-btn').click();
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
  if (!await menu.locator('.video-fit-btn').evaluate(button => button.matches(':focus'))) {
    fail('Keyboard opening did not focus the first settings action.');
  }
  await page.keyboard.press('Shift+Tab');
  if (!await gear.evaluate(button => button.matches(':focus')) || !await menu.isVisible()) {
    fail('Shift+Tab from settings did not return to the neighboring trigger.');
  }
  await page.keyboard.press('Tab');
  if (!await menu.locator('.video-fit-btn').evaluate(button => button.matches(':focus'))) {
    fail('Tab from the trigger skipped open settings.');
  }
  await page.keyboard.press('Tab');
  if (!await pin.evaluate(button => button.matches(':focus'))) fail('Tab skipped the controls visibility setting.');
  await page.keyboard.press('Tab');
  if (!await menu.locator('.help-btn').evaluate(button => button.matches(':focus'))) fail('Tab skipped keyboard help.');
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
  await page.locator('.theater-help-close-btn').press('Enter');
  if (await page.locator('.theater-help-overlay').count() || await menu.isVisible()
      || !await gear.evaluate(button => button.matches(':focus'))) fail('Enter closing row-opened help lost focus or reopened settings.');
  // Escape restores the gear; opening help from there must transfer focus into help.
  await gear.press('Enter');
  await page.keyboard.press('Escape');
  await page.keyboard.press('h');
  const helpClose = page.locator('.theater-help-close-btn');
  await helpClose.waitFor();
  if (!await helpClose.evaluate(button => button.matches(':focus'))) fail('Help left focus on the settings gear.');
  for (const key of ['Tab', 'Shift+Tab', 'Shift+Tab']) {
    await page.keyboard.press(key);
    if (!await helpClose.evaluate(button => button.matches(':focus'))) fail('Help let Tab reach controls behind the overlay.');
  }
  const pausedDuringHelp = await page.locator('video#player').evaluate((video: HTMLVideoElement) => video.paused);
  // Even programmatic focus behind help cannot activate a hidden settings control.
  await gear.focus();
  await page.keyboard.press('Space');
  await page.keyboard.press('Enter');
  if (await menu.isVisible() || !await page.locator('.theater-help-overlay').count()) {
    fail('A focused gear activated settings underneath help.');
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
  await gear.press('Enter');
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Shift+Tab');
  if (await menu.isVisible() || !await page.locator('.fullscreen-btn').evaluate(button => button.matches(':focus'))) {
    fail('Leaving the open gear toward fullscreen did not dismiss settings.');
  }
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
  await delay(2800);
  await waitForChrome(true, true, false);
  const timeAfter = await page.locator('video#player').evaluate((video: HTMLVideoElement) => video.currentTime);
  if (process.env.THEATER_SMOKE_SCREENSHOT) await page.screenshot({ path: process.env.THEATER_SMOKE_SCREENSHOT });
  if (timeAfter <= timeBefore) fail('Playback stopped while controls were pinned.');
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
  await delay(2800);
  await waitForChrome(true, true, true);
  await page.evaluate(() => (document.getElementById('theater-everywhere-ui')?.shadowRoot?.activeElement as HTMLElement | null)?.blur());
  await page.locator('.player-settings-btn').hover();
  await delay(2800);
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
  await page.waitForFunction(() => document.querySelector('video#player')!.classList.contains('theater-everywhere-video-active'));
  await assertHelpAfterRebuild();
  await waitForChrome(true, true, true);
  await page.evaluate(() => document.getElementById('other-player')!.remove());
  await page.keyboard.press('Escape');
  await controls.waitFor({ state: 'detached' });
  // T deliberately ignores toggles within 200ms; fast runners can reach this re-entry inside that window.
  await delay(250);
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

  if (context) {
    // Actual extension storage, reload, and the settings page share the same preference.
    const worker = await extensionWorker(context);
    const saved = await worker.evaluate(async () => (await chrome.storage.sync.get('keepControlsVisible')).keepControlsVisible);
    if (saved !== true) fail('Pin preference was not persisted.');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForPlayer(page);
    await page.locator('video#player').click();
    await page.keyboard.press('t');
    await waitForChrome(true, true, true);
    await waitForChrome(true, true, false);
    const options = await context.newPage();
    try {
      await options.goto(new URL('options/options.html', worker.url()).href);
      await options.locator('.te-dialog-btn-primary').click();
      const toggle = options.locator('#keep-controls-visible-toggle');
      await toggle.waitFor({ state: 'attached' });
      await options.waitForFunction(() => (document.getElementById('keep-controls-visible-toggle') as HTMLInputElement)?.checked);
      await options.locator('label.toggle-switch').filter({ has: toggle }).click();
      await waitForChrome(false, true, true);
      await waitForChrome(false, false, false);
      await page.keyboard.press('Shift+H');
      await options.waitForFunction(() => (document.getElementById('keep-controls-visible-toggle') as HTMLInputElement)?.checked);
      await waitForChrome(true, true, false);
      await options.locator('#shortcut-controls-pin').press('Shift+U');
      await options.waitForFunction(async () => (await chrome.storage.sync.get('shortcuts')).shortcuts?.toggleControlsPin === 'Shift+U');
      await options.locator('#shortcut-toggle-mute').press('Control+M');
      await options.waitForFunction(async () => (await chrome.storage.sync.get('shortcuts')).shortcuts?.toggleMute === 'Ctrl+M');
      await options.waitForFunction(() => (document.getElementById('shortcut-controls-pin') as HTMLInputElement)?.value === 'Shift+U');
      const shortcuts = await worker.evaluate(async () => (await chrome.storage.sync.get('shortcuts')).shortcuts);
      if (shortcuts.toggleControlsPin !== 'Shift+U' || shortcuts.toggleMute !== 'Ctrl+M') {
        fail('Editing another shortcut lost the custom pin shortcut.');
      }
      await page.keyboard.press('Shift+U');
      await waitForChrome(false, true, true);
      await worker.evaluate(async () => { await chrome.storage.sync.remove('shortcuts'); });
      // Existing shortcut-removal behavior does not reset the live runtime: reload below.
    } finally {
      await options.close();
    }
  } else {
    await page.keyboard.press('Shift+H');
    await waitForChrome(false, true, true);
  }
  await waitForChrome(false, false, false);
  await page.keyboard.press('Escape');
  await controls.waitFor({ state: 'detached' });
  if (await page.evaluate(() => document.documentElement.classList.contains('theater-everywhere-cursor-hidden'))) {
    fail('Exiting theater mode left the cursor hidden.');
  }
  console.log(`smoke controls pin: idle, playback, repeat, input, focus, hover, captions, popovers, fullscreen and rebuild${context ? ', persistence and settings' : ''} passed`);
}

async function injectBundledPlayer(page: Page, unpackedDir: string): Promise<void> {
  const cssPath = path.join(unpackedDir, 'content.css');
  await page.addStyleTag({ path: cssPath });
  for (const filename of ['mainWorld.js', 'content.js']) {
    const source = readFileSync(path.join(unpackedDir, filename), 'utf8');
    const isModule = /^\s*export\b/m.test(source) || /^\s*import\b/m.test(source);
    // Content scripts have their own global scope; preserve it in the injected fallback.
    await page.addScriptTag({ content: isModule ? source : `(() => {\n${source}\n})();`, type: isModule ? 'module' : undefined });
  }
  await delay(400);
}

async function extensionWorker(context: BrowserContext) {
  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 15_000 });
  return worker;
}

async function setBlacklist(context: BrowserContext, entries: string[]): Promise<void> {
  const worker = await extensionWorker(context);
  await worker.evaluate(async (blacklist) => {
    await chrome.storage.sync.set({ blacklist });
  }, entries);
}

async function assertBlacklistBlocksTheater(page: Page): Promise<void> {
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForPlayer(page);
  await page.click('video#player');
  await page.keyboard.press('t');
  await delay(800);
  if (await theaterEntered(page)) {
    fail('Theater mode activated on a blacklisted host.');
  }
}

async function assertIframeHandshake(page: Page, origin: string): Promise<void> {
  await page.goto(`${origin}/iframe`, { waitUntil: 'domcontentloaded' });
  const frame = page.frameLocator('#child');
  await frame.locator('video#player').click({ timeout: 15_000 });
  await page.keyboard.press('t');
  await page.waitForFunction((videoClass) => {
    const iframe = document.querySelector('#child');
    const childDoc = (iframe as HTMLIFrameElement | null)?.contentDocument;
    const childVideo = childDoc?.querySelector('video#player');
    return Boolean(
      iframe?.classList.contains(videoClass)
      || childVideo?.classList.contains(videoClass)
      || childDoc?.documentElement.classList.contains('theater-everywhere-html-active')
    );
  }, THEATER_VIDEO_CLASS, { timeout: 10_000 });
  // A shortcut focused in the parent must update the child player exactly once.
  await page.locator('body').press('Shift+H');
  await frame.locator('.controls-visibility-toggle[aria-pressed="true"]').waitFor({ state: 'attached' });
  await frame.locator('body').press('Shift+H');
  await frame.locator('.controls-visibility-toggle[aria-pressed="false"]').waitFor({ state: 'attached' });
  await page.keyboard.press('Escape');
  await page.waitForFunction((videoClass) => {
    const iframe = document.querySelector('#child');
    const childDoc = (iframe as HTMLIFrameElement | null)?.contentDocument;
    const childVideo = childDoc?.querySelector('video#player');
    return !iframe?.classList.contains(videoClass)
      && !childVideo?.classList.contains(videoClass)
      && !childDoc?.documentElement.classList.contains('theater-everywhere-html-active');
  }, THEATER_VIDEO_CLASS, { timeout: 10_000 });

  await delay(400);
  await frame.locator('video#player').click({ timeout: 15_000 });
  await delay(200);
  await frame.locator('body').press('t');
  await page.waitForFunction((videoClass) => {
    const iframe = document.querySelector('#child');
    const childDoc = (iframe as HTMLIFrameElement | null)?.contentDocument;
    const childVideo = childDoc?.querySelector('video#player');
    return Boolean(
      iframe?.classList.contains(videoClass)
      || childVideo?.classList.contains(videoClass)
      || childDoc?.documentElement.classList.contains('theater-everywhere-html-active')
    );
  }, THEATER_VIDEO_CLASS, { timeout: 10_000 });
  await delay(400);
  await frame.locator('body').press('Escape');
  await page.waitForFunction((videoClass) => {
    const iframe = document.querySelector('#child');
    const childDoc = (iframe as HTMLIFrameElement | null)?.contentDocument;
    const childVideo = childDoc?.querySelector('video#player');
    return !iframe?.classList.contains(videoClass)
      && !childVideo?.classList.contains(videoClass)
      && !childDoc?.documentElement.classList.contains('theater-everywhere-html-active');
  }, THEATER_VIDEO_CLASS, { timeout: 10_000 });
  console.log('smoke:chromium iframe child T/Escape passed');
}

async function assertParentBlacklist(page: Page, origin: string, context: BrowserContext): Promise<void> {
  await setBlacklist(context, [PARENT_BLACKLIST]);
  const port = new URL(origin).port;
  await page.goto(`http://${PARENT_HOST}:${port}/`, { waitUntil: 'domcontentloaded' });
  await waitForPlayer(page);
  await page.click('video#player');
  await page.keyboard.press('t');
  await delay(800);
  if (await theaterEntered(page)) {
    fail('Theater mode activated under a parent-domain blacklist.');
  }
}

async function smokeChromium(origin: string, unpackedDir: string): Promise<void> {
  if (!playwrightExecutable('chromium')) {
    skipLocally('Skipping smoke:chromium. Run: pnpm exec playwright install chromium firefox');
  }

  const userDataDir = mkdtempSync(path.join(tmpdir(), 'te-smoke-chromium-'));
  let context: BrowserContext | null = null;
  try {
    context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      viewport: { width: 1280, height: 720 },
      args: [
        '--headless=new',
        '--no-sandbox',
        '--disable-dev-shm-usage',
        `--host-resolver-rules=MAP *.example.localhost 127.0.0.1,MAP example.localhost 127.0.0.1`,
        `--disable-extensions-except=${unpackedDir}`,
        `--load-extension=${unpackedDir}`
      ]
    });

    const page = context.pages()[0] || await context.newPage();
    await page.goto(`${origin}/`, { waitUntil: 'domcontentloaded' });
    await waitForPlayer(page);
    await assertTheaterToggle(page);
    console.log('smoke:chromium local player T/Escape passed');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForPlayer(page);
    await assertControlsPin(page, context);

    await setBlacklist(context, ['127.0.0.1']);
    await assertBlacklistBlocksTheater(page);
    await setBlacklist(context, []);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForPlayer(page);
    await assertTheaterToggle(page);
    console.log('smoke:chromium blacklist exact host passed');

    await assertIframeHandshake(page, origin);
    console.log('smoke:chromium same-origin iframe handshake passed');

    await assertParentBlacklist(page, origin, context);
    await setBlacklist(context, []);
    console.log('smoke:chromium parent-domain blacklist passed');
  } finally {
    await context?.close();
    rmSync(userDataDir, { recursive: true, force: true });
  }
}

async function tryFirefoxSideload(origin: string): Promise<boolean> {
  const xpiSource = path.join(ROOT, 'dist/theater-everywhere-firefox.zip');
  if (!existsSync(xpiSource)) return false;
  const userDataDir = mkdtempSync(path.join(tmpdir(), 'te-smoke-firefox-'));
  const extensionsDir = path.join(userDataDir, 'extensions');
  mkdirSync(extensionsDir, { recursive: true });
  copyFileSync(xpiSource, path.join(extensionsDir, 'theater-everywhere@tomaszjanusz.dev.xpi'));
  let context: BrowserContext | null = null;
  let sideloadVerified = false;
  try {
    context = await firefox.launchPersistentContext(userDataDir, {
      headless: true,
      viewport: { width: 1280, height: 720 },
      firefoxUserPrefs: {
        'xpinstall.signatures.required': false,
        'extensions.autoDisableScopes': 0,
        'extensions.enabledScopes': 15,
        'extensions.startupScanScopes': 15,
        'media.videocontrols.picture-in-picture.video-toggle.enabled': false
      }
    });
    const page = context.pages()[0] || await context.newPage();
    await page.goto(`${origin}/`, { waitUntil: 'domcontentloaded' });
    await waitForPlayer(page);
    await page.click('video#player');
    await page.keyboard.press('t');
    await delay(1500);
    const entered = await theaterEntered(page);
    if (!entered) return false;
    sideloadVerified = true;
    await page.keyboard.press('Escape');
    await delay(500);
    await assertControlsPin(page);
    console.log('smoke:firefox passed (sideloaded MV3 xpi)');
    return true;
  } catch (error) {
    if (sideloadVerified) throw error;
    return false;
  } finally {
    await context?.close();
    rmSync(userDataDir, { recursive: true, force: true });
  }
}

async function smokeFirefox(origin: string, unpackedDir: string): Promise<void> {
  if (!playwrightExecutable('firefox')) {
    skipLocally('Skipping smoke:firefox. Run: pnpm exec playwright install chromium firefox');
  }

  if (await tryFirefoxSideload(origin)) return;

  // Playwright cannot sideload an unsigned MV3 Firefox addon. Chromium smoke
  // covers the packaged extension; this path only checks the bundled player
  // script as a local/CI diagnostic, not Firefox permissions or background.

  // Firefox's browser-owned hover PiP widget intercepts clicks above page overlays.
  // Exercise extension UI independently of that native browser widget.
  const browser = await firefox.launch({ headless: true, firefoxUserPrefs: {
    'media.videocontrols.picture-in-picture.video-toggle.enabled': false
  } });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    page.on('pageerror', (error) => console.warn('Firefox page error:', error.message));
    page.on('console', (message) => { if (message.type() === 'error') console.warn('Firefox console:', message.text()); });
    await page.goto(`${origin}/`, { waitUntil: 'domcontentloaded' });
    await waitForPlayer(page);
    await injectBundledPlayer(page, unpackedDir);
    await assertTheaterToggle(page);
    await assertControlsPin(page);
    console.log('smoke:firefox passed (injected bundled mainWorld.js and content.js; sideload of unsigned MV3 xpi is blocked)');
  } finally {
    await browser.close();
  }
}

async function run(): Promise<void> {
  if (!existsSync(PLAYER_FIXTURE) || !existsSync(IFRAME_FIXTURE) || !existsSync(YOUTUBE_EMBED_FIXTURE) || !existsSync(VOD_FIXTURE)) {
    fail('Missing smoke fixtures under test/fixtures.');
  }

  const targets = requestedBrowsers();
  const fixture = await startFixtureServer();
  try {
    for (const kind of targets) {
      const unpackedDir = requireBuiltExtension(kind);
      if (kind === 'chromium') await smokeChromium(fixture.origin, unpackedDir);
      else await smokeFirefox(fixture.origin, unpackedDir);
    }
  } finally {
    await fixture.close();
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
