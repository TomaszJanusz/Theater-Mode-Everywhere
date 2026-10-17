import { defaultMediaProviderFlags, mediaProviderFlagStorageKeys, mediaProviderFlagStorageUpdate } from '../src/media-features/provider-flags';
import { createServer } from 'node:http';
import { assertLocalized } from '../src/test-utils/language-audit';
import { WHATS_NEW_ACK_STORAGE_KEY, WHATS_NEW_RELEASE } from '../src/whatsNew-release';
import { WHATS_NEW_CONTENT } from '../src/whatsNew-content';
import { NEW_FEATURE_ITEMS, featureHighlightsAcknowledgement, resolveFeatureHighlights, SEEN_ITEMS_STORAGE_KEY } from '../src/feature-highlights';
import { shouldOfferVideoActivator } from '../src/ui/video-activator-settings';
import type { AddressInfo } from 'node:net';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium, firefox, type BrowserContext, type Locator, type Page } from 'playwright';

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
  await page.waitForSelector('video#player', { timeout: 15_000 }).catch(async error => {
    console.error('Player fixture readiness:', await page.evaluate(() => {
      const video = document.querySelector('video#player');
      const rect = video?.getBoundingClientRect();
      const style = video ? getComputedStyle(video) : null;
      return { url: location.href, ready: document.readyState, title: document.title,
        videoCount: document.querySelectorAll('video').length,
        rect: rect?.toJSON(), display: style?.display, visibility: style?.visibility };
    }));
    if (process.env.THEATER_SMOKE_SCREENSHOT) {
      await page.screenshot({ path: process.env.THEATER_SMOKE_SCREENSHOT.replace(/\.png$/, '-player-missing.png') });
    }
    throw error;
  });
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
  await page.evaluate(() => {
    const state = { releases: 0, exits: 0, nextReleases: 0 };
    (window as Window & { theaterShortcutSpy?: typeof state }).theaterShortcutSpy = state;
    document.addEventListener('keyup', (event) => {
      if (event.key === 't') state.releases++;
      if (event.key === 'Escape') state.exits++;
      if (event.code === 'KeyN') state.nextReleases++;
    });
  });
  await page.click('video#player');
  await page.keyboard.down('t');
  // Repeated keydown used to toggle again after the 200ms transition guard.
  // Explicit repeat also works with Firefox's synthetic keyboard transport.
  await delay(300);
  await page.dispatchEvent('video#player', 'keydown', { key: 't', code: 'KeyT', repeat: true, bubbles: true });
  await page.keyboard.up('t');
  await page.waitForFunction(({ videoClass, htmlClass }) => {
    const video = document.querySelector('video#player');
    return Boolean(video?.classList.contains(videoClass) || document.documentElement.classList.contains(htmlClass));
  }, { videoClass: THEATER_VIDEO_CLASS, htmlClass: THEATER_HTML_CLASS }, { timeout: 10_000 });

  if (!await theaterEntered(page)) fail('Theater mode did not activate after T.');
  const hostReleases = await page.evaluate(() => (window as Window & {
    theaterShortcutSpy?: { releases: number }
  }).theaterShortcutSpy?.releases);
  if (hostReleases !== 0) fail('The host received the T keyup and could toggle its own theater mode.');

  await page.keyboard.press('Shift+N');
  if (await page.evaluate(() => (window as Window & {
    theaterShortcutSpy?: { nextReleases: number }
  }).theaterShortcutSpy?.nextReleases) !== 1) {
    fail('An unavailable next-video shortcut was incorrectly swallowed on keyup.');
  }

  const unclaimedReleases = await page.evaluate(`(() => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    const releases = [];
    const observe = (event) => releases.push(event.type + ':' + event.code);
    document.addEventListener('keyup', observe);
    document.addEventListener('keypress', observe);
    const dispatch = (target, key, code, shiftKey = false) => {
      const options = { key, code, shiftKey, bubbles: true, cancelable: true, composed: true };
      const down = new KeyboardEvent('keydown', options);
      // A host listener may cancel keydown before the extension sees it.
      down.preventDefault();
      target.dispatchEvent(down);
      target.dispatchEvent(new KeyboardEvent('keypress', options));
      target.dispatchEvent(new KeyboardEvent('keyup', options));
    };
    input.focus();
    dispatch(input, 'ArrowRight', 'ArrowRight');
    input.blur();
    const video = document.querySelector('video#player');
    dispatch(video, 'F9', 'F9');
    dispatch(video, 'P', 'KeyP', true);
    input.remove();
    document.removeEventListener('keyup', observe);
    document.removeEventListener('keypress', observe);
    return releases;
  })()`) as string[];
  const expectedReleases = ['keypress:ArrowRight', 'keyup:ArrowRight', 'keypress:F9', 'keyup:F9', 'keypress:KeyP', 'keyup:KeyP'];
  if (JSON.stringify(unclaimedReleases) !== JSON.stringify(expectedReleases)) {
    fail(`Host-cancelled unclaimed keys lost their releases: ${JSON.stringify(unclaimedReleases)}`);
  }

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

  await page.keyboard.press('t');
  await page.waitForFunction((videoClass) => !document.querySelector('video#player')?.classList.contains(videoClass),
    THEATER_VIDEO_CLASS, { timeout: 10_000 });
  if (await page.evaluate(() => (window as Window & { theaterShortcutSpy?: { releases: number } }).theaterShortcutSpy?.releases) !== 0) {
    fail('The host received the T keyup after exiting theater mode.');
  }
  await delay(250);
  await page.keyboard.press('t');
  await page.waitForFunction((videoClass) => document.querySelector('video#player')?.classList.contains(videoClass),
    THEATER_VIDEO_CLASS, { timeout: 10_000 });

  await page.keyboard.press('Escape');
  await page.waitForFunction(({ videoClass, htmlClass }) => {
    const video = document.querySelector('video#player');
    return !video?.classList.contains(videoClass) && !document.documentElement.classList.contains(htmlClass);
  }, { videoClass: THEATER_VIDEO_CLASS, htmlClass: THEATER_HTML_CLASS }, { timeout: 10_000 });
  if (await page.evaluate(() => (window as Window & {
    theaterShortcutSpy?: { exits: number }
  }).theaterShortcutSpy?.exits) !== 0) {
    fail('The host received Escape keyup after exiting theater mode.');
  }
}

async function enterTheaterFromPicture(page: Page): Promise<void> {
  await delay(250);
  await page.locator('video#player').click();
  await page.keyboard.press('t');
  await page.waitForFunction((videoClass) => document.querySelector('video#player')?.classList.contains(videoClass),
    THEATER_VIDEO_CLASS, { timeout: 10_000 });
}

async function exitTheater(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await page.waitForFunction((htmlClass) => !document.documentElement.classList.contains(htmlClass),
    THEATER_HTML_CLASS, { timeout: 10_000 });
}

async function assertPictureClickReclaimsKeys(page: Page): Promise<void> {
  await enterTheaterFromPicture(page);
  // Focus left in a host field behind theater, as after typing in chat or search.
  await page.evaluate(() => {
    const field = document.createElement('input');
    field.id = 'smoke-host-field';
    document.body.prepend(field);
    field.focus();
  });
  const mutedBefore = await page.locator('video#player').evaluate((video: HTMLVideoElement) => video.muted);
  await page.mouse.click(640, 300);
  await page.keyboard.press('m');
  const mutedAfter = await page.locator('video#player').evaluate((video: HTMLVideoElement) => video.muted);
  if (mutedAfter === mutedBefore) fail('A click on the theater picture did not take keyboard focus back from the page.');
  await page.keyboard.press('m');
  await page.mouse.click(640, 300);
  await page.evaluate(() => document.querySelector('#smoke-host-field')?.remove());
  await exitTheater(page);
}

async function assertScrubberPreviewLeaves(page: Page): Promise<void> {
  await enterTheaterFromPicture(page);
  await page.locator('video#player').evaluate(async (video: HTMLVideoElement & { _smokeStream?: MediaProvider | null }) => {
    video._smokeStream = video.srcObject;
    video.srcObject = null;
    video.src = '/vod.webm';
    video.loop = true;
    await video.play();
  });
  await page.waitForFunction(() => {
    const video = document.querySelector<HTMLVideoElement>('video#player');
    return Boolean(video && Number.isFinite(video.duration) && video.seekable.length > 0);
  });
  const scrubber = page.locator('.theater-scrubber-container');
  const box = await scrubber.boundingBox();
  if (!box) fail('Scrubber is not laid out.');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  const tooltip = page.locator('.theater-scrubber-tooltip');
  await page.waitForFunction(() => document.querySelector('#theater-everywhere-ui')?.shadowRoot
    ?.querySelector('.theater-scrubber-tooltip.visible'));
  await page.mouse.move(640, 200);
  // A pointer that leaves before the queued hover frame must not bring the preview back.
  const lingering = await scrubber.evaluate(async (element, x) => {
    element.dispatchEvent(new MouseEvent('mousemove', { clientX: x, bubbles: true, composed: true }));
    element.dispatchEvent(new MouseEvent('mouseleave'));
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return element.closest('.theater-controls-row')?.querySelector('.theater-scrubber-tooltip')?.classList.contains('visible');
  }, box.x + box.width / 3);
  if (lingering || await tooltip.evaluate((element) => element.classList.contains('visible'))) {
    fail('The scrubber preview stayed visible after the pointer left the scrubber.');
  }
  await page.locator('video#player').evaluate(async (video: HTMLVideoElement & { _smokeStream?: MediaProvider | null }) => {
    video.removeAttribute('src');
    video.srcObject = video._smokeStream ?? null;
    delete video._smokeStream;
    video.loop = false;
    await video.play();
  });
  await exitTheater(page);
}

async function assertThumbPlayerSwap(page: Page): Promise<void> {
  await delay(250);
  await page.evaluate(() => {
    const video = document.querySelector('video#player') as HTMLVideoElement;
    const container = document.createElement('div');
    container.className = 'txp_videos_container';
    video.before(container);
    container.appendChild(video);
  });
  await page.keyboard.press('t');
  await page.waitForFunction(() => document.querySelector('video#player')?.classList.contains('theater-everywhere-video-active'));
  await page.evaluate(() => {
    const current = document.querySelector('video#player') as HTMLVideoElement;
    const replacement = document.createElement('video');
    replacement.id = 'thumbplayer-replacement';
    replacement.muted = true;
    replacement.playsInline = true;
    replacement.style.width = '640px';
    replacement.style.height = '360px';
    current.parentElement!.appendChild(replacement);
    current.style.visibility = 'hidden';
    replacement.srcObject = current.srcObject;
    void replacement.play();
  });
  await page.waitForFunction(() => document.querySelector('#thumbplayer-replacement')?.classList.contains('theater-everywhere-video-active'));
  await page.evaluate(() => {
    const original = document.querySelector('video#player') as HTMLVideoElement;
    const replacement = document.querySelector('#thumbplayer-replacement') as HTMLVideoElement;
    replacement.style.visibility = 'hidden';
    original.style.visibility = 'visible';
    void original.play();
  });
  await page.waitForFunction(() => document.querySelector('video#player')?.classList.contains('theater-everywhere-video-active'));
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.documentElement.classList.contains('theater-everywhere-html-active'));
  await page.evaluate(() => {
    document.querySelector('#thumbplayer-replacement')?.remove();
    const original = document.querySelector('video#player') as HTMLVideoElement;
    const container = original.closest('.txp_videos_container');
    if (container) {
      container.before(original);
      container.remove();
    }
  });
}

async function declineVideoActivatorPrompt(page: Page): Promise<void> {
  const dialog = page.getByRole('dialog');
  await dialog.waitFor();
  const decline = dialog.locator('.te-dialog-btn-secondary');
  if (!await decline.evaluate(button => button.matches(':focus'))) {
    fail('The Video launcher offer must initially focus No.');
  }
  await decline.press('Enter');
  await dialog.waitFor({ state: 'detached' });
  // Moving focus into the modal can dismiss the settings popover.
  if (!await page.locator('.theater-settings-menu').isVisible()) {
    await page.locator('.player-settings-btn').press('Enter');
  }
  await page.locator('.auto-theater-btn').focus();
}

async function assertControlsPin(page: Page, context?: BrowserContext, installed = !!context): Promise<void> {
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
  const settingsLayout = await page.evaluate(() => {
    const root = document.getElementById('theater-everywhere-ui')!.shadowRoot!;
    return ['.controls-visibility-toggle', '.help-btn', '.video-fit-btn'].map((selector) => {
      const row = root.querySelector(selector)!;
      const label = row.querySelector('.theater-settings-label')!.getBoundingClientRect();
      const keys = row.querySelector('.theater-settings-keys')!.getBoundingClientRect();
      const detail = row.querySelector('.theater-settings-detail')!.getBoundingClientRect();
      return {
        selector,
        kbds: [...row.querySelectorAll('.theater-settings-keys kbd')].map((key) => key.textContent),
        joiner: [...row.querySelector('.theater-settings-keys')!.childNodes]
          .filter((node) => node.nodeType === Node.TEXT_NODE)
          .map((node) => node.textContent)
          .join(''),
        value: row.querySelector('.theater-settings-detail')!.textContent ?? '',
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
  for (const name of ['voice', 'leveling', 'bass']) {
    await page.keyboard.press('Tab');
    if (!await menu.locator(`.audio-${name}-btn`).evaluate(button => button.matches(':focus'))) fail(`Tab skipped the ${name} audio setting.`);
  }
  await page.keyboard.press('Tab');
  if (!await menu.locator('.video-fit-btn').evaluate(button => button.matches(':focus'))) fail('Tab skipped the video fit setting.');
  await page.keyboard.press('Tab');
  if (!await menu.locator('.picture-layout-btn').evaluate(button => button.matches(':focus'))) fail('Tab skipped the picture layout setting.');
  await page.keyboard.press('Tab');
  if (!await pin.evaluate(button => button.matches(':focus'))) fail('Tab skipped the controls visibility setting.');
  await page.keyboard.press('Tab');
  const autoTheater = menu.locator('.auto-theater-btn');
  if (!await autoTheater.evaluate(button => button.matches(':focus'))) fail('Tab skipped automatic theater entry.');
  const autoBefore = await autoTheater.getAttribute('aria-pressed');
  await page.keyboard.press('Space');
  if (await autoTheater.getAttribute('aria-pressed') === autoBefore) fail('Space did not toggle automatic theater entry.');
  await page.keyboard.press('Enter');
  // Turning AutoTheater off now offers the default-off launcher in installed builds.
  // Answer it before checking menu navigation; the modal owns focus until dismissed.
  if (installed) await declineVideoActivatorPrompt(page);
  await page.waitForFunction(before => document.getElementById('theater-everywhere-ui')?.shadowRoot
    ?.querySelector('.auto-theater-btn')?.getAttribute('aria-pressed') === before, autoBefore);
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
    await page.mouse.move(640, 300);
    await waitForChrome(true, true, false);
    await gear.click();
    await menu.waitFor({ state: 'visible' });
    const extensionRow = await menu.locator('.extension-settings-btn').evaluate((row) => ({
      keys: row.querySelectorAll('kbd').length,
      value: row.querySelector('.theater-settings-detail')?.textContent ?? '',
      shortcut: row.getAttribute('aria-keyshortcuts')
    }));
    if (extensionRow.keys !== 0 || extensionRow.value !== '' || extensionRow.shortcut) {
      fail(`Extension settings row should not show a shortcut or value: ${JSON.stringify(extensionRow)}`);
    }
    const openedOptions = context.waitForEvent('page', { timeout: 10_000 });
    await menu.locator('.extension-settings-btn').click();
    const opened = await openedOptions;
    await opened.waitForLoadState('domcontentloaded');
    if (!opened.url().includes('options/options.html')) fail(`Extension settings opened ${opened.url()}`);
    await opened.close();
    await page.bringToFront();

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
    // Release installs start seen, while date-version builds have unseen development items.
    // Seed the same unacknowledged state in both builds so this page must auto-open highlights.
    const highlightKeys = [WHATS_NEW_ACK_STORAGE_KEY, 'newFeaturesSeenThrough', SEEN_ITEMS_STORAGE_KEY];
    const originalHighlights = await worker.evaluate(keys => chrome.storage.local.get(keys), highlightKeys);
    await worker.evaluate(key => chrome.storage.local.set({
      [key]: 'smoke:unacknowledged', newFeaturesSeenThrough: '0.0', newFeaturesSeenItems: []
    }), WHATS_NEW_ACK_STORAGE_KEY);
    const options = await context.newPage();
    try {
      await options.goto(new URL('options/options.html', worker.url()).href);
      const highlights = options.getByRole('dialog', { name: 'Update highlights', exact: true });
      await highlights.waitFor();
      await highlights.locator('.te-dialog-btn-primary').click();
      await highlights.waitFor({ state: 'detached' });
      await options.locator('#tab-appearance').click();
      const toggle = options.locator('#keep-controls-visible-toggle');
      await toggle.waitFor({ state: 'attached' });
      await options.waitForFunction(() => (document.getElementById('keep-controls-visible-toggle') as HTMLInputElement)?.checked);
      await options.locator('label.toggle-switch').filter({ has: toggle }).click();
      await waitForChrome(false, true, true);
      await waitForChrome(false, false, false);
      await page.keyboard.press('Shift+H');
      await options.waitForFunction(() => (document.getElementById('keep-controls-visible-toggle') as HTMLInputElement)?.checked);
      await waitForChrome(true, true, false);
      await options.locator('#tab-shortcuts').click();
      await options.locator('.options-body[aria-busy="false"]').waitFor();
      await options.locator('#shortcut-controls-pin').press('Shift+U');
      await options.waitForFunction(async () => (await chrome.storage.sync.get('shortcuts')).shortcuts?.toggleControlsPin === 'Shift+U');
      // A storage write can finish before the editor accepts the next recording.
      await options.locator('.options-body[aria-busy="false"]').waitFor();
      await options.locator('#shortcut-toggle-mute').press('Control+M');
      await options.waitForFunction(async () => (await chrome.storage.sync.get('shortcuts')).shortcuts?.toggleMute === 'Ctrl+M');
      await options.locator('.options-body[aria-busy="false"]').waitFor();
      await options.waitForFunction(() => (document.getElementById('shortcut-controls-pin') as HTMLInputElement)?.value === 'Shift+U');
      const shortcuts = await worker.evaluate(async () => (await chrome.storage.sync.get('shortcuts')).shortcuts);
      if (shortcuts.toggleControlsPin !== 'Shift+U' || shortcuts.toggleMute !== 'Ctrl+M') {
        fail('Editing another shortcut lost the custom pin shortcut.');
      }
      await page.keyboard.press('Shift+U');
      await waitForChrome(false, true, true);
      await worker.evaluate(async () => { await chrome.storage.sync.remove('shortcuts'); });
      // Removing the saved map restores canonical defaults in the live runtime.
    } finally {
      await options.close();
      await worker.evaluate(async ({ keys, original }) => {
        await chrome.storage.local.remove(keys.filter(key => !(key in original)));
        await chrome.storage.local.set(original);
      }, { keys: highlightKeys, original: originalHighlights });
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

async function assertRteSettings(context: BrowserContext): Promise<void> {
  const worker = await extensionWorker(context);
  const page = await context.newPage();
  const keys = [...mediaProviderFlagStorageKeys(), 'language'];
  const original = await worker.evaluate(keys => chrome.storage.sync.get(keys), keys);
  const captureDir = process.env.THEATER_RTE_SCREENSHOT_DIR;
  const capture = async (name: string, fullPage = true) => {
    if (captureDir) {
      mkdirSync(captureDir, { recursive: true });
      if (fullPage) {
        await page.evaluate(() => scrollTo(0, 0));
        await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      }
      await page.screenshot({ path: path.join(captureDir, name), fullPage });
    }
  };
  const settle = async () => {
    await page.evaluate(async () => { await Promise.all(document.getAnimations().filter(animation => animation instanceof CSSTransition).map(animation => animation.finished)); });
  };
  try {
    await worker.evaluate(async ({ key, id }) => { await chrome.storage.local.set({ [key]: id }); }, { key: WHATS_NEW_ACK_STORAGE_KEY, id: WHATS_NEW_RELEASE.id });
    await worker.evaluate(update => chrome.storage.sync.set(update), { ...mediaProviderFlagStorageUpdate(defaultMediaProviderFlags()), language: 'en' });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(new URL('options/options.html#features', worker.url()).href);
    await page.waitForFunction(() => document.querySelectorAll('.rte-tile').length === 10 && [...document.querySelectorAll<HTMLInputElement>('.rte-tile input')].every(input => input.checked));
    await capture('tme60-section.png');
    if (captureDir) await page.locator('#rte-tiles').screenshot({ path: path.join(captureDir, 'tme60-tiles.png') });
    const netflix = page.locator('[data-provider="netflix"]');
    const ring = () => netflix.evaluate(el => ({ opacity: getComputedStyle(el, '::before').opacity, playState: getComputedStyle(el, '::before').animationPlayState }));
    if ((await ring()).opacity !== '0') fail('A resting RTE tile shows brand colors.');
    await netflix.hover();
    await page.waitForTimeout(250);
    if (captureDir) await netflix.screenshot({ path: path.join(captureDir, 'tme60-hover-1.png') });
    await page.waitForTimeout(450);
    if (captureDir) await netflix.screenshot({ path: path.join(captureDir, 'tme60-hover-2.png') });
    await settle(); // the boost transition; the steady orbit itself never finishes
    if ((await ring()).playState !== 'running' || (await ring()).opacity !== '1') fail('The RTE tile stopped showing its orbiting colors while hovered.');
    if (captureDir) await netflix.screenshot({ path: path.join(captureDir, 'tme60-dwell.png') });
    await page.mouse.move(2, 2);
    await settle();
    if ((await ring()).opacity !== '0') fail('The RTE border did not rest after the pointer left.');
    await page.locator('#rte-all').click();
    await page.waitForFunction(() => [...document.querySelectorAll<HTMLInputElement>('.rte-tile input')].every(input => !input.checked));
    if (captureDir) {
      await page.locator('#rte-tiles').screenshot({ path: path.join(captureDir, 'tme60-tiles-off.png') });
    }
    await page.locator('#rte-all').click();
    await page.locator('[data-provider="netflix"] .rte-control').click();
    await page.waitForFunction(() => (document.getElementById('rte-all') as HTMLInputElement).indeterminate);
    const saved = await worker.evaluate(async () => chrome.storage.sync.get(['netflixIntegrationEnabled', 'youtubeIntegrationEnabled']));
    if (saved.netflixIntegrationEnabled !== false || saved.youtubeIntegrationEnabled !== true) fail('RTE tile changed an unrelated provider flag.');
    await capture('tme47-rte-partial.png');
    await worker.evaluate(() => chrome.storage.sync.set({ netflixIntegrationEnabled: true }));
    await page.waitForFunction(() => (document.getElementById('rte-netflix') as HTMLInputElement).checked);
    await page.locator('#rte-filter-buttons [data-capability="chapters"]').click();
    await page.locator('#rte-filter-buttons [data-capability="quickActions"]').click();
    if (await page.locator('.rte-tile:visible').count() !== 5 || await page.locator('#rte-all-label').textContent() !== 'All shown services') fail('RTE capability filter is not reflected in master control.');
    await capture('tme60-filter.png');
    await page.locator('#rte-all').click();
    const filtered = await worker.evaluate(async () => chrome.storage.sync.get(['netflixIntegrationEnabled', 'youtubeIntegrationEnabled']));
    if (filtered.netflixIntegrationEnabled !== true || filtered.youtubeIntegrationEnabled !== false) fail('Filtered RTE master changed a hidden provider.');
    await page.locator('#rte-clear').click();
    await page.locator('#rte-all').click();
    const details = netflix.locator('.rte-details-toggle');
    await details.press('Enter');
    if (await details.getAttribute('aria-expanded') !== 'true' || !await page.locator('#rte-netflix').isChecked()) fail('RTE Details toggled the provider or did not expand.');
    await page.locator('[data-provider="tencent"] .rte-details-toggle').click();
    await settle(); // the details height transition
    await capture('tme47-rte-details.png');
    await details.click();
    await page.locator('[data-provider="tencent"] .rte-details-toggle').click();
    await page.setViewportSize({ width: 420, height: 850 });
    await capture('tme60-narrow.png');
    if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) fail('Narrow RTE settings overflow the viewport.');
    await page.setViewportSize({ width: 1440, height: 1000 });
    await worker.evaluate(() => chrome.storage.sync.set({ language: 'ar' }));
    await page.waitForFunction(() => document.documentElement.dir === 'rtl');
    await capture('tme60-ar.png');
    await worker.evaluate(() => chrome.storage.sync.set({ language: 'en' }));
    await page.waitForFunction(() => document.documentElement.dir === 'ltr');
    await page.locator('#tab-shortcuts').click();
    await page.setViewportSize({ width: 1440, height: 600 });
    await page.evaluate(() => scrollTo(0, document.getElementById('shortcuts')!.offsetTop + 300));
    const sticky = await page.locator('#shortcuts .card-heading-inner').boundingBox();
    if (!sticky || Math.abs(sticky.y - 16) > 2) fail('Settings heading did not follow the long section.');
    await capture('tme47-sticky.png', false);
    console.log('smoke RTE settings: installed tiles, flags, mixed/filtered master, details, live storage/language, RTL, narrow and sticky heading passed');
  } finally {
    await worker.evaluate(async ({ keys, original }) => {
      await chrome.storage.sync.remove(keys);
      await chrome.storage.sync.set(original);
    }, { keys, original });
    await page.close();
  }
}

async function assertShortcutManagement(page: Page, context: BrowserContext): Promise<void> {
  const worker = await extensionWorker(context);
  await worker.evaluate(async ({ key, id }) => { await chrome.storage.local.set({ [key]: id }); }, { key: WHATS_NEW_ACK_STORAGE_KEY, id: WHATS_NEW_RELEASE.id });
  const options = await context.newPage();
  const second = await context.newPage();
  const screenshot = async (target: Page, suffix: string) => {
    if (process.env.THEATER_SMOKE_SCREENSHOT) await target.screenshot({ path: process.env.THEATER_SMOKE_SCREENSHOT.replace(/\.png$/, `-${suffix}.png`) });
  };
  try {
    await options.goto(new URL('options/options.html#shortcuts', worker.url()).href);
    // The second tab starts in front; visual transitions need an active page.
    await options.bringToFront();
    await options.waitForSelector('.options-body[aria-busy="false"]');
    // Legacy/synced duplicates must be visibly marked, including while focused.
    const previousShortcuts = await worker.evaluate(async () => (await chrome.storage.sync.get('shortcuts')).shortcuts);
    await worker.evaluate(async shortcuts => {
      await chrome.storage.sync.set({ shortcuts: { ...shortcuts, toggleMute: 'F', toggleFullscreen: 'F' } });
    }, previousShortcuts);
    await options.locator('#shortcut-conflict-status').waitFor({ state: 'visible' });
    const assertConflictColor = async () => {
      await options.waitForFunction(() => ['shortcut-toggle-mute', 'shortcut-toggle-fullscreen'].every(id => {
        const input = document.getElementById(id)!;
        return input.getAttribute('aria-invalid') === 'true' && getComputedStyle(input).borderTopColor === 'rgb(245, 158, 11)';
      }), null, { timeout: 3000 });
    };
    await assertConflictColor();
    await options.locator('#shortcut-toggle-mute').focus();
    await assertConflictColor();
    await worker.evaluate(async shortcuts => {
      if (shortcuts) await chrome.storage.sync.set({ shortcuts });
      else await chrome.storage.sync.remove('shortcuts');
    }, previousShortcuts);
    await options.waitForSelector('#shortcut-toggle-mute[aria-invalid="false"]');
    await options.locator('#shortcut-toggle-mute').press('f');
    const dialog = options.locator('.te-dialog-overlay');
    await dialog.waitFor();
    await options.waitForFunction(() => document.activeElement?.classList.contains('te-dialog-btn-secondary'));
    await dialog.evaluate(async overlay => { await Promise.all(overlay.getAnimations({ subtree: true }).map(animation => animation.finished)); });
    await screenshot(options, 'shortcut-conflict');
    await options.keyboard.press('Enter'); // Safe initial focus preserves the existing owner.
    await dialog.waitFor({ state: 'detached' });
    if (await options.locator('#shortcut-toggle-mute').inputValue() !== 'M') fail('Cancelling a shortcut conflict changed the assignment.');
    await options.waitForSelector('.options-body[aria-busy="false"]');
    await options.locator('#shortcut-toggle-mute').press('f');
    await dialog.locator('.te-dialog-btn-primary').click();
    await options.waitForFunction(async () => {
      const { shortcuts } = await chrome.storage.sync.get('shortcuts');
      return shortcuts?.toggleMute === 'F' && shortcuts?.toggleFullscreen === '';
    });
    await options.waitForFunction(() => (document.getElementById('shortcut-toggle-fullscreen') as HTMLInputElement).value === '');
    await options.reload();
    await options.waitForSelector('.options-body[aria-busy="false"]');
    if (await options.locator('#shortcut-toggle-fullscreen').inputValue() !== '') fail('Unassigned shortcut reverted to its default on reload.');
    await options.waitForSelector('.options-body[aria-busy="false"]');
    await options.locator('[data-shortcut="toggleFullscreen"]').click();
    await dialog.waitFor();
    await options.keyboard.press('Escape');
    await dialog.waitFor({ state: 'detached' });
    if (await options.locator('#shortcut-toggle-fullscreen').inputValue() !== '') fail('Single reset bypassed conflict validation.');
    await options.waitForSelector('.options-body[aria-busy="false"]');
    await options.locator('[data-shortcut="toggleFullscreen"]').click();
    await dialog.locator('.te-dialog-btn-primary').click();
    await options.waitForFunction(async () => (await chrome.storage.sync.get('shortcuts')).shortcuts?.toggleFullscreen === 'F');
    await options.waitForSelector('.options-body[aria-busy="false"]');
    await options.locator('#shortcut-toggle-fullscreen').press('Tab');
    if (await options.locator('#shortcut-toggle-fullscreen').evaluate(el => el === document.activeElement)) fail('Shortcut recording trapped Tab.');
    await options.waitForSelector('.options-body[aria-busy="false"]');
    await options.locator('#shortcut-toggle-mute').press('Escape');
    await dialog.waitFor();
    if (!(await dialog.innerText()).includes('reserved')) fail('Escape was not protected as a safety exit key.');
    await dialog.locator('.te-dialog-btn-primary').click();
    await options.waitForSelector('.options-body[aria-busy="false"]');
    await options.locator('#reset-shortcuts-btn').click();
    await options.waitForFunction(async () => (await chrome.storage.sync.get('shortcuts')).shortcuts?.toggleMute === 'M');
    await second.goto(new URL('options/options.html#shortcuts', worker.url()).href);
    await options.waitForSelector('.options-body[aria-busy="false"]');
    await second.waitForSelector('.options-body[aria-busy="false"]');
    await Promise.all([options.locator('#shortcut-toggle-mute').press('Control+M'), second.locator('#shortcut-controls-pin').press('Shift+U')]);
    await options.waitForFunction(async () => {
      const { shortcuts } = await chrome.storage.sync.get('shortcuts');
      return shortcuts?.toggleMute === 'Ctrl+M' && shortcuts?.toggleControlsPin === 'Shift+U';
    });
    // Live custom entry keys replace their defaults without a reload.
    await options.waitForSelector('.options-body[aria-busy="false"]');
    await options.locator('#shortcut-toggle-fullscreen').press('g');
    await options.waitForSelector('.options-body[aria-busy="false"]');
    await options.locator('#shortcut-toggle').press('Shift+T');
    await dialog.locator('.te-dialog-btn-primary').click(); // Move from Cycle video.
    await options.waitForFunction(async () => (await chrome.storage.sync.get('shortcuts')).shortcuts?.toggle === 'Shift+T');
    await page.waitForFunction(() => document.documentElement.getAttribute('data-theater-everywhere-entry-shortcuts')?.includes('"fullscreen":"G"') && document.documentElement.getAttribute('data-theater-everywhere-entry-shortcuts')?.includes('"toggle":"Shift+T"'));
    await page.bringToFront();
    await page.locator('video#player').click();
    await page.keyboard.press('f');
    if (await theaterEntered(page)) fail('The old fullscreen key still activates TME.');
    await page.keyboard.press('g');
    await page.waitForFunction(() => document.fullscreenElement === document.documentElement);
    await page.locator('.theater-controls-wrapper').waitFor();
    if (await page.evaluate(() => (window as any).hostEntryKeys.includes('KeyG'))) fail('Early host window capture won over the configured fullscreen shortcut.');
    await page.keyboard.down('g');
    await page.keyboard.down('g'); // repeat must be claimed but must not reopen fullscreen.
    await page.keyboard.up('g');
    await page.waitForFunction(() => !document.fullscreenElement);
    await page.keyboard.press('Escape');
    await page.locator('.theater-controls-wrapper').waitFor({ state: 'detached' });
    await delay(250); // Existing theater-entry debounce.
    await page.keyboard.press('Shift+T');
    try { await page.locator('.theater-controls-wrapper').waitFor(); } catch (error) {
      console.error('Custom theater diagnostics', await page.evaluate(() => ({ config: document.documentElement.getAttribute('data-theater-everywhere-entry-shortcuts'), classes: document.documentElement.className, active: document.activeElement?.outerHTML, hostKeys: (window as any).hostEntryKeys })));
      throw error;
    }
    await page.keyboard.press('Escape');
    await worker.evaluate(async () => { await chrome.storage.sync.remove('shortcuts'); });
    await page.waitForFunction(() => document.documentElement.getAttribute('data-theater-everywhere-entry-shortcuts')?.includes('"toggle":"T"'));
  } finally {
    await options.close(); await second.close();
  }
  console.log('smoke shortcuts: conflict cancel/transfer, unbinding, reset, Tab, reserved Escape, concurrent tabs and live custom fullscreen/theater keys passed');
}


async function assertPictureLayout(page: Page, context?: BrowserContext): Promise<void> {
  const video = page.locator('video#player');
  const gear = page.locator('.player-settings-btn');
  const row = page.locator('.picture-layout-btn');
  await page.setViewportSize({ width: 1280, height: 900 });
  await gear.click();
  await row.waitFor();
  if (await row.getAttribute('aria-keyshortcuts') !== 'Shift+L') fail('Layout shortcut is missing from player settings.');
  const waitPosition = async (position: string) => {
    await page.waitForFunction(position => getComputedStyle(document.querySelector('video#player')!).objectPosition === position, position, { timeout: 5000 });
  };
  await row.click();
  await waitPosition('50% 0%');
  if (await row.locator('.theater-settings-detail').innerText() !== 'Raised') fail('Layout row did not update after a click.');
  await page.keyboard.down('Shift');
  await page.keyboard.down('l');
  await page.keyboard.down('l');
  await page.keyboard.up('l');
  await page.keyboard.up('Shift');
  await waitPosition('50% 50%');
  if (await row.locator('.theater-settings-detail').innerText() !== 'Centered') fail('Held layout shortcut toggled repeatedly.');
  await page.evaluate(() => {
    const host = document.createElement('div'); host.id = 'layout-input-test';
    const input = document.createElement('input'); host.attachShadow({ mode: 'open' }).append(input);
    document.body.append(host); input.focus();
  });
  await page.keyboard.press('Shift+L');
  if (await video.evaluate(video => getComputedStyle(video).objectPosition) !== '50% 50%') fail('Layout shortcut fired in a shadow input.');
  await page.evaluate(() => document.getElementById('layout-input-test')?.remove());
  if (!await row.isVisible()) await gear.click();
  const fit = page.locator('.video-fit-btn');
  await fit.click(); // Fill keeps the chosen layout preference, but centers the picture.
  await row.click();
  await waitPosition('50% 50%');
  await fit.click(); // Stretch.
  await waitPosition('50% 50%');
  await fit.click(); // Back to Fit restores Raised.
  await waitPosition('50% 0%');
  if (context) {
    const worker = await extensionWorker(context);
    const options = await context.newPage();
    try {
      await options.goto(new URL('options/options.html', worker.url()).href);
      await options.waitForSelector('[data-picture-align="top"][aria-checked="true"]');
      await options.locator('#tab-shortcuts').click();
      await options.waitForSelector('.options-body[aria-busy="false"]');
      await options.locator('#shortcut-cycle-layout').press('Shift+K');
      await page.waitForFunction(() => document.getElementById('theater-everywhere-ui')?.shadowRoot?.querySelector('.picture-layout-btn')?.getAttribute('aria-keyshortcuts') === 'Shift+K');
      await page.bringToFront();
      await page.keyboard.press('Shift+L');
      if (await video.evaluate(video => getComputedStyle(video).objectPosition) !== '50% 0%') fail('Old layout shortcut remained active after customization.');
      await page.keyboard.press('Shift+K');
      await waitPosition('50% 50%');
      await options.locator('#tab-appearance').click();
      await options.waitForSelector('[data-picture-align="center"][aria-checked="true"]');
      await options.locator('[data-picture-align="center"]').focus();
      await page.keyboard.press('Shift+K');
      await waitPosition('50% 0%');
      await options.waitForFunction(() => document.activeElement?.matches('[data-picture-align="top"][aria-checked="true"][tabindex="0"]'));
      await options.bringToFront();
      await options.keyboard.press('Enter');
      await waitPosition('50% 0%');
      await options.locator('[data-picture-align="center"]').click();
      await waitPosition('50% 50%');
      await options.locator('[data-picture-align="top"]').click();
      await waitPosition('50% 0%');
      await options.locator('#tab-shortcuts').click();
      await options.locator('[data-shortcut="cycleLayout"]').click();
      await page.waitForFunction(() => document.getElementById('theater-everywhere-ui')?.shadowRoot?.querySelector('.picture-layout-btn')?.getAttribute('aria-keyshortcuts') === 'Shift+L');
    } finally { await options.close(); }
    await page.bringToFront();
    if (!await row.isVisible()) await gear.click();
  }
  if (process.env.THEATER_SMOKE_SCREENSHOT) {
    await page.mouse.move(640, 300);
    await row.focus();
    await page.locator('.theater-everywhere-volume-overlay.status-hud').waitFor({ state: 'detached' });
    await page.screenshot({ path: process.env.THEATER_SMOKE_SCREENSHOT.replace(/\.png$/, '-layout.png') });
  }
  await row.click(); // Restore Centered for the remaining smoke scenarios.
  await waitPosition('50% 50%');
  await page.keyboard.press('Escape'); // Close settings while keeping the session active.
  await page.setViewportSize({ width: 1280, height: 720 });
  console.log('smoke layout: settings row, repeat/input/help guards, Fit/Fill/Stretch, saved preference and live shortcut updates passed');
}

async function assertAudioSettings(page: Page, context?: BrowserContext): Promise<void> {
  const video = page.locator('video#player');
  // The fixture is same-origin: all audio controls must retain its decoded
  // frames, including gain enabled before any other effect and reentry.
  await video.evaluate((video: HTMLVideoElement) => {
    video.dataset.smokeAudioEmptied = '0';
    video.addEventListener('emptied', () => { video.dataset.smokeAudioEmptied = '1'; }, { once: true });
  });
  const gear = page.locator('.player-settings-btn');
  const hud = page.locator('.theater-everywhere-volume-overlay.status-hud');
  const shapes = (locator: Locator) => locator.locator('svg').first().evaluate(svg => svg.innerHTML);
  const media = () => video.evaluate((video: HTMLVideoElement) => ({
    voice: video.dataset.theaterVoice, leveling: video.dataset.theaterLeveling, bass: video.dataset.theaterBass
  }));
  const cycleTo = async (name: 'voice' | 'leveling' | 'bass', hudLabel: string, detail: string) => {
    const row = page.locator(`.audio-${name}-btn`);
    await row.click();
    await page.waitForFunction(([name, detail]) => document.getElementById('theater-everywhere-ui')?.shadowRoot
      ?.querySelector(`.audio-${name}-btn .theater-settings-detail`)?.textContent === detail, [name, detail]);
    if (await hud.innerText() !== `${hudLabel}: ${detail}`) fail(`${hudLabel} HUD did not confirm ${detail}.`);
    if (await shapes(hud) !== await shapes(row)) fail(`${hudLabel} HUD icon differs from its settings row.`);
  };

  if (!await page.locator('.audio-voice-btn').isVisible()) await gear.click();
  const section = page.locator('[data-settings-section="audio"]');
  await section.waitFor();
  // The heading can contain a nested New badge; its label is still Audio.
  const audioHeading = await section.locator('.theater-settings-heading').evaluate(heading =>
    Array.from(heading.childNodes).filter(node => node.nodeType === Node.TEXT_NODE).map(node => node.textContent).join('').trim());
  if (audioHeading !== 'Audio') fail(`Audio section heading is missing: ${JSON.stringify(audioHeading)}`);
  const details = await section.locator('.theater-settings-detail').allInnerTexts();
  if (details.join('|') !== 'Off|Off|Off|Original') fail(`Audio settings should start neutral: ${details.join('|')}`);
  if (await page.locator('.audio-voice-btn').getAttribute('aria-keyshortcuts') !== 'V') fail('Voice boost row does not advertise its shortcut.');
  const slider = page.locator('.theater-volume-slider');
  const boost = page.locator('.volume-boost-btn');
  await boost.click();
  await hud.filter({ hasText: 'Volume boost: On' }).waitFor();
  if (await shapes(hud) !== await shapes(boost)) fail('Volume boost HUD icon differs from its settings row.');
  if (await slider.getAttribute('max') !== '1.5') fail('Volume boost did not raise the volume ceiling.');
  await slider.evaluate((input: HTMLInputElement) => {
    input.value = '1.5';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.keyboard.press('Shift+B');
  await hud.filter({ hasText: 'Volume boost: Off' }).waitFor();
  if (await slider.getAttribute('max') !== '1.0' || await slider.inputValue() !== '1') {
    fail(`Turning volume boost off kept boosted volume: ${await slider.getAttribute('max')} / ${await slider.inputValue()}`);
  }
  if (await video.evaluate((video: HTMLVideoElement) => video.dataset.theaterBoost) !== '1.0') fail('Volume boost kept amplifying after it was turned off.');
  await page.keyboard.press('Shift+B');
  await slider.evaluate((input: HTMLInputElement) => {
    for (const value of ['1.5', '0']) {
      input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });
  await page.keyboard.press('Shift+B');
  await page.keyboard.press('m');
  if (await slider.inputValue() !== '1' || await video.evaluate((video: HTMLVideoElement) => video.dataset.theaterBoost) !== '1.0') {
    fail('Unmute restored a boosted level after volume boost was turned off at zero volume.');
  }
  await cycleTo('voice', 'Voice boost', 'Light');
  // The click is the user activation the MAIN world needs to start Web Audio.
  await page.waitForFunction(() => {
    const player = document.querySelector<HTMLVideoElement>('video#player');
    return player?.dataset.theaterVoice === 'light' && player.dataset.theaterBoostReady === 'true';
  });
  await cycleTo('leveling', 'Reduce loud sounds', 'Light');
  await cycleTo('leveling', 'Reduce loud sounds', 'Strong');
  await cycleTo('bass', 'Bass', 'More');
  await page.keyboard.press('b');
  await hud.filter({ hasText: 'Bass: Less' }).waitFor();
  await page.keyboard.press('b');
  await hud.filter({ hasText: 'Bass: Original' }).waitFor();
  await page.keyboard.press('b');
  await hud.filter({ hasText: 'Bass: More' }).waitFor();
  for (const [key, name, label] of [['v', 'voice', 'Voice boost'], ['r', 'leveling', 'Reduce loud sounds']] as const) {
    const initial = (await media())[name];
    for (let step = 0; step < 3; step++) {
      const before = (await media())[name];
      await page.keyboard.press(key);
      await page.waitForFunction(([name, before]) => document.querySelector<HTMLVideoElement>('video#player')
        ?.dataset[name === 'voice' ? 'theaterVoice' : 'theaterLeveling'] !== before, [name, before]);
      const detail = await page.locator(`.audio-${name}-btn .theater-settings-detail`).innerText();
      if (await hud.innerText() !== `${label}: ${detail}`) fail(`${label} shortcut did not confirm its new level.`);
    }
    if ((await media())[name] !== initial) fail(`${label} shortcut did not cycle through all levels.`);
  }
  const beforeGuardedKeys = await media();
  await page.evaluate(() => {
    const input = document.createElement('input');
    input.id = 'audio-shortcut-draft';
    document.body.append(input);
    input.focus();
  });
  await page.keyboard.type('vrbB');
  await page.evaluate(() => document.getElementById('audio-shortcut-draft')?.remove());
  await page.keyboard.press('h');
  await page.locator('.theater-help-overlay').waitFor();
  for (const key of ['v', 'r', 'b', 'Shift+B']) await page.keyboard.press(key);
  await page.locator('.theater-help-overlay .te-dialog-close').press('Enter');
  await page.locator('.theater-help-overlay').waitFor({ state: 'detached' });
  await page.evaluate(() => {
    for (const [key, code, shiftKey] of [['v', 'KeyV', false], ['r', 'KeyR', false], ['b', 'KeyB', false], ['B', 'KeyB', true]] as const) {
      window.dispatchEvent(new KeyboardEvent('keydown', { key, code, shiftKey, repeat: true, bubbles: true, cancelable: true }));
      window.dispatchEvent(new KeyboardEvent('keyup', { key, code, shiftKey, bubbles: true, cancelable: true }));
    }
  });
  if (JSON.stringify(await media()) !== JSON.stringify(beforeGuardedKeys) || await slider.getAttribute('max') !== '1.0') {
    fail('Audio shortcuts fired in an editable field, behind help, or on key repeat.');
  }
  if (JSON.stringify(await media()) !== JSON.stringify({ voice: 'light', leveling: 'strong', bass: 'more' })) {
    fail(`Audio settings did not reach the media element: ${JSON.stringify(await media())}`);
  }
  if (context) {
    const worker = await extensionWorker(context);
    const saved = await worker.evaluate(() => chrome.storage.sync.get(['voiceBoost', 'volumeLeveling', 'bassLevel', 'volumeBoostEnabled']));
    if (saved.voiceBoost !== 'light' || saved.volumeLeveling !== 'strong' || saved.bassLevel !== 'more' || saved.volumeBoostEnabled !== false) {
      fail(`Audio settings were not saved: ${JSON.stringify(saved)}`);
    }
  }

  const layout = page.locator('.picture-layout-btn');
  // Opening help closes the settings popover; restore it for the next action.
  if (!await layout.isVisible()) await gear.click();
  await layout.click();
  await hud.filter({ hasText: 'Raised' }).waitFor();
  if (await shapes(hud) !== await shapes(layout)) fail('Layout HUD icon differs from its settings row.');
  await layout.click();
  await hud.filter({ hasText: 'Centered' }).waitFor();

  // Session cleanup must bypass gain as well as the three effects, then
  // restore the remembered boosted level without rebuilding/reloading.
  await boost.click();
  await hud.filter({ hasText: 'Volume boost: On' }).waitFor();
  await slider.evaluate((input: HTMLInputElement) => {
    input.value = '1.5';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.keyboard.press('Escape'); // Close settings.
  await exitTheater(page);
  if (JSON.stringify(await media()) !== JSON.stringify({ voice: 'off', leveling: 'off', bass: 'original' })) {
    fail('Audio settings kept processing the host player after theater exit.');
  }
  if (await video.evaluate((video: HTMLVideoElement) => video.dataset.theaterBoost) !== '1.0') fail('Volume boost kept amplifying the host player after theater exit.');
  await enterTheaterFromPicture(page);
  await page.waitForFunction(() => {
    const video = document.querySelector<HTMLVideoElement>('video#player');
    return video?.dataset.theaterLeveling === 'strong' && video.dataset.theaterBoost === '3.0000';
  });
  await gear.click();
  await boost.click();
  await hud.filter({ hasText: 'Volume boost: Off' }).waitFor();
  await page.keyboard.press('Escape'); // Close settings before restoring effects.
  if (context) {
    const worker = await extensionWorker(context);
    await worker.evaluate(() => chrome.storage.sync.remove(['voiceBoost', 'volumeLeveling', 'bassLevel']));
    await page.waitForFunction(() => {
      const player = document.querySelector<HTMLVideoElement>('video#player');
      return player?.dataset.theaterVoice === 'off' && player.dataset.theaterLeveling === 'off' && player.dataset.theaterBass === 'original';
    });
  } else {
    await gear.click();
    await cycleTo('voice', 'Voice boost', 'Strong');
    await cycleTo('voice', 'Voice boost', 'Off');
    await cycleTo('leveling', 'Reduce loud sounds', 'Off');
    await cycleTo('bass', 'Bass', 'Less');
    await cycleTo('bass', 'Bass', 'Original');
    await page.keyboard.press('Escape');
  }
  if (await video.getAttribute('data-smoke-audio-emptied') !== '0') fail('An audio setting unnecessarily reloaded the same-origin video.');
  console.log('smoke audio: no media reload, section, volume boost, three settings, shortcuts, HUD icons, MAIN-world graph, saved levels and exit restore passed');
}

async function assertFullscreenAndHelp(page: Page, earlyHost = false, context?: BrowserContext): Promise<void> {
  await page.bringToFront();
  await page.locator('video#player').evaluate(async (video: HTMLVideoElement) => {
    video.srcObject = null; video.src = '/vod.webm'; video.loop = true; await video.play();
  });
  await page.locator('video#player').click();
  const hostCountBefore = await page.evaluate(() => (window as any).hostEntryKeys.filter((key: string) => key === 'KeyF').length);
  await page.keyboard.press('f');
  await page.waitForFunction(() => document.fullscreenElement === document.documentElement);
  await page.locator('.theater-controls-wrapper').waitFor();
  if (earlyHost && await page.evaluate(() => (window as any).hostEntryKeys.filter((key: string) => key === 'KeyF').length) !== hostCountBefore) fail('Host fullscreen keydown was not intercepted.');
  await page.keyboard.press('f');
  await page.waitForFunction(() => !document.fullscreenElement);
  await assertPictureLayout(page, context);
  await assertAudioSettings(page, context);
  await page.keyboard.press('h');
  const help = page.locator('.theater-help-overlay');
  await help.waitFor();
  const inspect = () => help.evaluate(overlay => {
    const grid = overlay.querySelector('.theater-help-grid')!;
    return { columns: getComputedStyle(grid).gridTemplateColumns.split(' ').length,
      rows: overlay.querySelectorAll('.theater-help-row').length,
      closeVisible: overlay.querySelector('.te-dialog-close')!.getBoundingClientRect().top >= 0 };
  });
  await page.keyboard.press('Shift+L');
  if (await page.locator('video#player').evaluate(video => getComputedStyle(video).objectPosition) !== '50% 50%') fail('Layout shortcut fired behind keyboard help.');
  const wide = await inspect();
  if (wide.columns !== 2 || wide.rows !== 27 || !wide.closeVisible) fail(`Wide keyboard help lost layout or actions: ${JSON.stringify(wide)}`);
  await help.evaluate(async overlay => { await Promise.all(overlay.getAnimations({ subtree: true }).map(animation => animation.finished)); });
  if (process.env.THEATER_SMOKE_SCREENSHOT) await page.screenshot({ path: process.env.THEATER_SMOKE_SCREENSHOT.replace(/\.png$/, '-help-columns.png') });
  await page.setViewportSize({ width: 540, height: 480 });
  const narrow = await inspect();
  if (narrow.columns !== 1 || narrow.rows !== 27 || !narrow.closeVisible) fail(`Narrow help is inaccessible: ${JSON.stringify(narrow)}`);
  await page.locator('.theater-help-overlay .te-dialog-close').press('Enter');
  await help.waitFor({ state: 'detached' });
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.keyboard.press('Escape');
  await page.locator('.theater-controls-wrapper').waitFor({ state: 'detached' });
  console.log('smoke fullscreen/help: TME document fullscreen, host interception, all 27 shortcuts in responsive two/one-column help passed');
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
  if (await theaterEntered(page)) fail('Theater mode activated on a blacklisted host.');
  await page.keyboard.press('f');
  if (await theaterEntered(page) || await page.evaluate(() => Boolean(document.fullscreenElement))) fail('Fullscreen captured a key on a blacklisted host.');
  if (await page.evaluate(() => document.documentElement.hasAttribute('data-theater-everywhere-entry-shortcuts'))) fail('Blacklisting retained the early shortcut configuration.');
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
  await page.waitForFunction(videoClass => document.getElementById('child')?.classList.contains(videoClass), THEATER_VIDEO_CLASS);
  // Make parent focus explicit; a body without tabindex leaves focus in the iframe.
  await page.locator('body').evaluate(body => { body.tabIndex = -1; });
  await page.evaluate(`(() => {
    window.iframeNavigationSpy = { nextReleases: 0, previousReleases: 0, navigation: null };
    document.addEventListener('keyup', event => {
      if (event.code === 'KeyN') window.iframeNavigationSpy.nextReleases++;
      if (event.code === 'KeyP') window.iframeNavigationSpy.previousReleases++;
    });
    window.addEventListener('message', event => {
      if (event.source === document.getElementById('child').contentWindow
          && event.data?.type === 'PLAYLIST_NAV_QUERY') {
        window.iframeNavigationSpy.navigation = event.data.payload;
      }
    });
  })()`);
  await page.locator('body').press('Shift+N');
  await page.locator('body').press('Shift+P');
  const releases = await page.evaluate(`({ next: window.iframeNavigationSpy.nextReleases, previous: window.iframeNavigationSpy.previousReleases })`) as { next: number; previous: number };
  if (releases.next !== 1 || releases.previous !== 1) fail('Unavailable iframe navigation swallowed parent host releases.');
  await frame.locator('body').evaluate(body => {
    const button = document.createElement('button');
    button.id = 'iframe-next';
    button.className = 'vjs-next-video';
    button.textContent = 'Next';
    button.style.cssText = 'position:fixed;left:10px;top:10px;width:50px;height:30px';
    button.dataset.activations = '0';
    button.addEventListener('click', () => { button.dataset.activations = String(Number(button.dataset.activations) + 1); });
    body.appendChild(button);
  });
  await page.waitForFunction(`window.iframeNavigationSpy.navigation?.next === true`);
  await page.locator('body').focus();
  await page.keyboard.down('Shift');
  await page.keyboard.down('n');
  await page.locator('body').dispatchEvent('keydown', { key: 'N', code: 'KeyN', shiftKey: true, repeat: true, bubbles: true, cancelable: true });
  await page.keyboard.up('n');
  await page.keyboard.up('Shift');
  await frame.locator('#iframe-next[data-activations="1"]').waitFor({ state: 'attached' });
  if (await page.evaluate(`window.iframeNavigationSpy.nextReleases`) !== 1) fail('Available iframe navigation leaked a host release.');
  await frame.locator('#iframe-next').evaluate((button: HTMLButtonElement) => { button.disabled = true; });
  await page.waitForFunction(`window.iframeNavigationSpy.navigation?.next === false`);
  await page.locator('body').press('Shift+N');
  if (await page.evaluate(`window.iframeNavigationSpy.nextReleases`) !== 2) fail('Disabled iframe navigation retained its shortcut claim.');
  await frame.locator('#iframe-next').evaluate(button => button.remove());
  // Parent focus in an iframe session must still toggle TME document fullscreen.
  await page.locator('body').press('f');
  await page.waitForFunction(() => document.fullscreenElement === document.documentElement);
  await page.locator('body').press('f');
  await page.waitForFunction(() => !document.fullscreenElement);
  await page.locator('body').press('Shift+L');
  await frame.locator('.picture-layout-btn .theater-settings-detail').filter({ hasText: 'Raised' }).waitFor({ state: 'attached' });
  await frame.locator('body').press('Shift+L');
  await frame.locator('.picture-layout-btn .theater-settings-detail').filter({ hasText: 'Centered' }).waitFor({ state: 'attached' });
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
  // A frame that reloads while the page is in theater drops its session; the page must not stay pinned around it.
  await delay(400);
  await frame.locator('video#player').click({ timeout: 15_000 });
  await frame.locator('body').press('t');
  await page.waitForFunction(videoClass => document.getElementById('child')?.classList.contains(videoClass), THEATER_VIDEO_CLASS, { timeout: 10_000 });
  await page.evaluate(() => (document.getElementById('child') as HTMLIFrameElement).contentWindow?.location.reload());
  await page.waitForFunction((videoClass) => !document.getElementById('child')?.classList.contains(videoClass)
    && !document.documentElement.classList.contains('theater-everywhere-html-active'), THEATER_VIDEO_CLASS, { timeout: 10_000 });
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

async function assertAutoTheater(page: Page, context: BrowserContext): Promise<void> {
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const fixture = readFileSync(path.join(ROOT, 'test/fixtures/youtube-watch.html'), 'utf8');
  await context.route('https://www.youtube.com/**', route => route.fulfill({ contentType: 'text/html', body: fixture }));
  await context.route('https://player.vimeo.com/**', route => route.fulfill({ contentType: 'text/html', body: fixture
    .replace('class="html5-video-player"', 'class="player"')
    .replace("player.contentId = new URL(location.href).searchParams.get('v');", "window.playerConfig = { video: { id: 123456 } }; player.contentId = '123456';") }));
  const url = 'https://www.youtube.com/watch?v=abcdefghijk&state=3';
  const playEvent = async () => {
    await page.waitForFunction(() => document.querySelector<HTMLVideoElement>('video#player')!.readyState > 2);
    await page.locator('video#player').evaluate((video: HTMLVideoElement) => {
      video.dispatchEvent(new Event('playing'));
    });
  };
  const assertIdle = async (reason: string) => {
    // MAIN query and theater entry are synchronous. The rAF also lets queued
    // provider/mutation notifications finish before checking the visible state.
    await playEvent();
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
    if (await theaterEntered(page)) throw new Error(`Auto theater entered for ${reason}`);
  };
  const waitEntered = () => page.waitForFunction(() => document.documentElement.classList.contains('theater-everywhere-html-active'));
  const waitIdle = () => page.waitForFunction(() => !document.documentElement.classList.contains('theater-everywhere-html-active'));
  try {
    await worker.evaluate(() => chrome.storage.sync.set({ autoEnterTheater: false }));
    await page.goto(url);
    await waitForPlayer(page);
    await page.waitForFunction(() => document.documentElement.hasAttribute('data-theater-everywhere-entry-shortcuts'));
    await assertIdle('disabled setting');
    // The actual options toggle persists and live-enables an already playing video.
    const options = await context.newPage();
    try {
      await worker.evaluate(({ key, release }) => chrome.storage.local.set({ [key]: release }),
        { key: WHATS_NEW_ACK_STORAGE_KEY, release: WHATS_NEW_RELEASE.id });
      await options.goto(new URL('options/options.html', worker.url()).href);
      await options.locator('#tab-features').click();
      const toggle = options.locator('#auto-enter-theater-toggle');
      await toggle.waitFor({ state: 'attached' });
      if (await toggle.isChecked()) throw new Error('Auto theater options default must be off');
      await options.locator('label.toggle-switch').filter({ has: toggle }).click();
      await options.waitForFunction(async () => (await chrome.storage.sync.get('autoEnterTheater')).autoEnterTheater === true);
      await waitEntered();
      const gear = page.locator('.player-settings-btn');
      await gear.press('Enter');
      const auto = page.locator('.auto-theater-btn');
      await auto.waitFor({ state: 'visible' });
      if (await auto.getAttribute('aria-pressed') !== 'true') throw new Error('Player menu did not reflect the options preference');
      if (process.env.THEATER_SMOKE_SCREENSHOT) {
        await page.screenshot({ path: process.env.THEATER_SMOKE_SCREENSHOT.replace(/\.png$/, '-auto-entry.png') });
      }
      const offerLauncher = shouldOfferVideoActivator(await worker.evaluate(() =>
        chrome.storage.sync.get(['videoActivator', 'videoActivatorPromptAnswer'])));
      await auto.press('Enter');
      await options.waitForFunction(() => !(document.getElementById('auto-enter-theater-toggle') as HTMLInputElement).checked);
      await options.waitForFunction(async () => (await chrome.storage.sync.get('autoEnterTheater')).autoEnterTheater === false);
      // This path also runs alone with a fresh profile, before the controls smoke.
      if (offerLauncher) {
        await declineVideoActivatorPrompt(page);
        await options.waitForFunction(async () => (await chrome.storage.sync.get('videoActivatorPromptAnswer')).videoActivatorPromptAnswer === false);
      }
      await auto.press('Space');
      await options.waitForFunction(() => (document.getElementById('auto-enter-theater-toggle') as HTMLInputElement).checked);
      await options.waitForFunction(async () => (await chrome.storage.sync.get('autoEnterTheater')).autoEnterTheater === true);
      if (await auto.getAttribute('aria-pressed') !== 'true') throw new Error('Player menu did not retain the enabled preference');
      await page.keyboard.press('Escape'); // Close only the settings panel.
    } finally {
      await options.close();
    }
    await page.keyboard.press('Escape');
    await waitIdle();
    await assertIdle('the same video after exit');
    await worker.evaluate(() => chrome.storage.sync.set({ autoEnterTheater: false }));
    await worker.evaluate(() => chrome.storage.sync.set({ autoEnterTheater: true }));
    await assertIdle('preference off/on after exit');

    // A new document enters with the saved preference while YouTube's API still
    // reports buffering. No synthetic second playing event may be needed.
    await page.goto(url);
    await waitEntered();
    await page.keyboard.press('Escape');
    await waitIdle();

    // URL changes before the live player identity: never maximize stale content.
    await page.evaluate(() => {
      history.pushState({}, '', '/watch?v=lmnopqrstuv');
      document.dispatchEvent(new Event('yt-navigate-finish'));
    });
    await assertIdle('stale video after SPA navigation');
    await page.evaluate(() => {
      const player = document.getElementById('movie_player') as HTMLElement & { contentId: string };
      player.contentId = 'lmnopqrstuv';
    });
    await playEvent();
    await waitEntered();
    await page.keyboard.press('Escape');
    await waitIdle();

    await page.goto(`${url}&ad=1`);
    await waitForPlayer(page);
    await page.waitForFunction(() => document.documentElement.hasAttribute('data-theater-everywhere-entry-shortcuts'));
    await assertIdle('an ad in the main player');
    await page.evaluate(() => document.getElementById('movie_player')?.classList.remove('ad-showing'));
    await waitEntered();
    await page.keyboard.press('Escape');
    await waitIdle();

    await page.goto('https://www.youtube.com/');
    await waitForPlayer(page);
    await assertIdle('the home feed');
    await worker.evaluate(() => chrome.storage.sync.set({ youtubeIntegrationEnabled: false }));
    await page.goto(url);
    await waitForPlayer(page);
    await page.waitForFunction(() => document.documentElement.hasAttribute('data-te-youtube-integration-off'));
    await assertIdle('disabled RTE');
    await page.locator('#search').focus();
    await worker.evaluate(() => chrome.storage.sync.set({ youtubeIntegrationEnabled: true }));
    await page.waitForFunction(() => !document.documentElement.hasAttribute('data-te-youtube-integration-off'));
    await assertIdle('a focused editable field');
    await page.locator('#search').evaluate((input: HTMLInputElement) => input.blur());
    await page.evaluate(() => {
      const watch = document.querySelector('ytd-watch-flexy')!;
      const preview = document.createElement('ytd-video-preview');
      watch.replaceWith(preview);
      preview.appendChild(watch);
    });
    await assertIdle('an auxiliary hover preview');

    await worker.evaluate(() => chrome.storage.sync.set({ blacklist: ['youtube.com'] }));
    await page.goto(url);
    await waitForPlayer(page);
    await assertIdle('a blacklisted domain');
    await worker.evaluate(() => chrome.storage.sync.set({ blacklist: [], youtubeIntegrationEnabled: false }));
    await page.goto(url);
    await waitForPlayer(page);
    await page.waitForFunction(() => document.documentElement.hasAttribute('data-te-youtube-integration-off'));
    await page.locator('video#player').evaluate((video: HTMLVideoElement) => { video.style.width = '40px'; video.style.height = '30px'; });
    await worker.evaluate(() => chrome.storage.sync.set({ youtubeIntegrationEnabled: true }));
    await page.waitForFunction(() => !document.documentElement.hasAttribute('data-te-youtube-integration-off'));
    await assertIdle('a micro video');

    await worker.evaluate(() => chrome.storage.sync.set({ autoEnterTheater: false }));
    await page.goto(url);
    await waitForPlayer(page);
    await page.waitForFunction(() => document.querySelector<HTMLVideoElement>('video#player')!.readyState > 2);
    await page.locator('video#player').evaluate((video: HTMLVideoElement) => video.pause());
    await worker.evaluate(() => chrome.storage.sync.set({ autoEnterTheater: true }));
    await assertIdle('paused content');
    // A trusted click grants fullscreen; enabling auto entry must leave it alone.
    await page.locator('video#player').evaluate((video: HTMLVideoElement) => {
      video.addEventListener('click', () => { void video.requestFullscreen(); }, { once: true });
    });
    await page.locator('video#player').click();
    await page.waitForFunction(() => Boolean(document.fullscreenElement));
    await page.locator('video#player').evaluate((video: HTMLVideoElement) => video.play());
    await assertIdle('document fullscreen');
    await page.evaluate(() => document.exitFullscreen());

    // A supported provider in a child frame must not send FRAME_ENTER upwards.
    await page.goto('https://www.youtube.com/');
    await page.locator('video#player').evaluate(video => video.remove());
    await page.evaluate(() => {
      const child = document.createElement('iframe');
      child.id = 'auto-child'; child.src = '/watch?v=abcdefghijk';
      document.body.appendChild(child);
    });
    const child = page.frameLocator('#auto-child');
    await child.locator('video#player').waitFor();
    await child.locator('video#player').evaluate((video: HTMLVideoElement) => video.dispatchEvent(new Event('playing')));
    await child.locator('html[data-theater-everywhere-entry-shortcuts]').waitFor();
    if (await child.locator('video#player').evaluate(video => video.classList.contains('theater-everywhere-video-active'))
        || await theaterEntered(page)) throw new Error('Auto theater entered inside an iframe');

    await page.goto('https://player.vimeo.com/video/123456');
    await waitForPlayer(page);
    await waitEntered();
    await page.keyboard.press('Escape');
    await waitIdle();
    await assertIdle('the same Vimeo clip after exit');
    console.log('smoke:chromium installed auto theater: options/menu sync, saved setting, buffering API, exit, SPA identity, ads, feed, RTE, focus, preview, blacklist, micro video, paused content, fullscreen, iframe and Vimeo passed');
  } finally {
    await worker.evaluate(() => chrome.storage.sync.remove(['autoEnterTheater', 'youtubeIntegrationEnabled', 'blacklist']));
    await context.unroute('https://www.youtube.com/**');
    await context.unroute('https://player.vimeo.com/**');
  }
}

/** Installed-extension proof for storage propagation and isolated-world catalog delivery. */
async function assertLanguageMenu(page: Page, origin: string, context: BrowserContext): Promise<void> {
  const worker = await extensionWorker(context);
  const catalog = (locale: string): Record<string, { message: string }> => JSON.parse(
    readFileSync(path.join(ROOT, '_locales', locale, 'messages.json'), 'utf8'));
  const english = catalog('en');
  const polish = catalog('pl');
  const arabic = catalog('ar');
  await worker.evaluate(({ key, release }) => chrome.storage.local.set({ [key]: release }),
    { key: WHATS_NEW_ACK_STORAGE_KEY, release: WHATS_NEW_RELEASE.id });
  const options = await context.newPage();
  const otherOptions = await context.newPage();
  const popup = await context.newPage();
  try {
    await worker.evaluate(() => chrome.storage.sync.remove('language'));
    await page.goto(`${origin}/`);
    await waitForPlayer(page);
    await page.locator('video#player').click();
    await page.keyboard.press('t');
    await page.locator('.player-settings-btn').waitFor({ state: 'attached' });
    const extensionUrl = new URL('options/options.html#appearance', worker.url()).href;
    await options.setViewportSize({ width: 1280, height: 1100 });
    await options.goto(extensionUrl);
    await otherOptions.goto(extensionUrl);
    await popup.goto(new URL('popup/popup.html', worker.url()).href);
    await popup.locator('#domain-name').filter({ hasText: 'System page' }).waitFor();
    await options.waitForFunction(() => document.querySelectorAll('#language-combobox-listbox [role=option]').length === 14);
    const combo = options.locator('#language-combobox');
    const list = options.locator('#language-combobox-listbox');
    // Diagnostic captures only; they follow the same THEATER_SMOKE_SCREENSHOT gate as the other smoke screenshots.
    const languageScreenshot = async (name: string) => {
      if (process.env.THEATER_SMOKE_SCREENSHOT) {
        await options.screenshot({ path: process.env.THEATER_SMOKE_SCREENSHOT.replace(/\.png$/, `-${name}.png`), fullPage: true, animations: 'disabled' });
      }
    };
    if (await options.locator('#language-combobox-listbox [aria-selected=true]').getAttribute('data-value') !== 'automatic') throw new Error('Language must default to Automatic');
    const before = await page.locator('video#player').evaluate((v: HTMLVideoElement) => ({ paused: v.paused, source: v.currentSrc }));
    await languageScreenshot('lang-dropdown-en');
    await combo.click();
    await list.waitFor();
    await languageScreenshot('lang-combobox-open');
    await options.keyboard.press('End');
    await options.keyboard.press('Escape');
    if (await combo.getAttribute('aria-expanded') !== 'false' || await combo.evaluate(el => el !== document.activeElement)) throw new Error('Escape must close and retain trigger focus');
    if (await options.locator('#language-combobox-listbox [aria-selected=true]').getAttribute('data-value') !== 'automatic') throw new Error('Escape committed a language');
    await combo.focus();
    await languageScreenshot('lang-dropdown-hover');
    await options.locator('#accent-color-grid [data-choice=green]').click();
    await options.locator('#accent-color-grid [data-choice=green].selected').waitFor();
    await combo.focus();
    await languageScreenshot('lang-dropdown-green');
    await options.locator('#accent-color-grid [data-choice=system]').click();
    await options.locator('#accent-color-grid [data-choice=system].selected').waitFor();
    await combo.click();
    await options.getByRole('option', { name: 'Polski', exact: true }).click();
    await options.locator('#tab-appearance').filter({ hasText: polish.appearanceTitle.message }).waitFor();
    await otherOptions.waitForFunction(() => document.querySelector('#language-combobox-listbox [aria-selected=true]')?.getAttribute('data-value') === 'pl');
    await popup.locator('[data-i18n="websiteLabel"]').filter({ hasText: polish.websiteLabel.message }).waitFor();
    await page.locator('.player-settings-btn').and(page.getByLabel(polish.playerSettingsLabel.message, { exact: true })).waitFor({ state: 'attached' });
    if (await popup.locator('#domain-name').textContent() !== polish.systemPage.message) throw new Error('Popup dynamic domain state lost its translation');
    await assertLocalized(options, 'pl');
    await assertLocalized(otherOptions, 'pl');
    await assertLocalized(popup, 'pl');
    await assertLocalized(page, 'pl', '#theater-everywhere-ui');
    await languageScreenshot('lang-dropdown-pl');
    await combo.focus();
    await options.keyboard.press('ArrowDown');
    await options.keyboard.press('End'); // Arabic is the last endonym.
    await options.keyboard.press('Enter');
    await options.waitForFunction(() => document.documentElement.dir === 'rtl' && document.documentElement.lang === 'ar');
    await otherOptions.waitForFunction(() => document.documentElement.dir === 'rtl');
    await popup.waitForFunction(() => document.documentElement.dir === 'rtl');
    await page.locator('.theater-controls-wrapper[dir="rtl"][lang="ar"]').waitFor({ state: 'attached' });
    await page.locator('.player-settings-btn').and(page.getByLabel(arabic.playerSettingsLabel.message, { exact: true })).waitFor({ state: 'attached' });
    await assertLocalized(options, 'ar');
    await assertLocalized(popup, 'ar');
    await assertLocalized(page, 'ar', '#theater-everywhere-ui');
    await languageScreenshot('lang-dropdown-ar');
    await combo.click();
    await languageScreenshot('lang-combobox-open-ar');
    await options.keyboard.press('Escape');
    if (process.env.THEATER_SMOKE_SCREENSHOT) {
      await options.screenshot({ path: process.env.THEATER_SMOKE_SCREENSHOT.replace(/\.png$/, '-language-ar-options.png'), fullPage: true });
      await page.bringToFront();
      await page.locator('.player-settings-btn').press('Enter');
      await page.locator('.theater-settings-menu.visible').waitFor();
      await page.screenshot({ path: process.env.THEATER_SMOKE_SCREENSHOT.replace(/\.png$/, '-language-ar-player.png') });
    }
    const after = await page.locator('video#player').evaluate((v: HTMLVideoElement) => ({ paused: v.paused, source: v.currentSrc }));
    if (JSON.stringify(before) !== JSON.stringify(after) || !await theaterEntered(page)) throw new Error('Language switch changed playback or exited theater');
    if (await page.locator('html').getAttribute('dir') !== null) throw new Error('Player localization changed host document direction');

    // Saved override on a fresh child document, then a live change back to Automatic.
    await page.goto(`${origin}/iframe`);
    const frame = page.frameLocator('#child');
    await frame.locator('video#player').click();
    await frame.locator('body').press('t');
    await frame.locator('.theater-controls-wrapper[dir="rtl"]').waitFor({ state: 'attached' });
    await combo.focus();
    await options.keyboard.press('ArrowUp');
    await options.keyboard.press('Home');
    await options.keyboard.press('Enter');
    await options.waitForFunction(() => document.documentElement.dir === 'ltr' && document.documentElement.lang.startsWith('en'));
    await otherOptions.waitForFunction(() => document.querySelector('#language-combobox-listbox [aria-selected=true]')?.getAttribute('data-value') === 'automatic');
    await frame.locator('.theater-controls-wrapper[dir="ltr"]').waitFor({ state: 'attached' });
    await frame.locator('.player-settings-btn').and(frame.getByLabel(english.playerSettingsLabel.message, { exact: true })).waitFor({ state: 'attached' });
    await popup.waitForFunction(() => document.documentElement.dir === 'ltr');
    await popup.locator('#status-text').filter({ hasText: english.statusInactiveSystem.message }).waitFor();
    await frame.locator('body').press('Escape');
    await options.locator('#tab-about').click();
    await languageScreenshot('lang-about');
    console.log('smoke:chromium language menu: two Settings pages, popup, player, keyboard selection, saved iframe override, RTL/Automatic restoration and playback preservation passed');
  } finally {
    await worker.evaluate(() => chrome.storage.sync.remove('language'));
    await options.close();
    await otherOptions.close();
    await popup.close();
  }
}

/** Probe the extension's isolated world, since a page-world registry proves nothing here. */
async function assertBadgeWorld(page: Page, context: BrowserContext): Promise<void> {
  const client = await context.newCDPSession(page);
  const worlds: number[] = [];
  client.on('Runtime.executionContextCreated', ({ context }) => {
    const isDefault: unknown = context.auxData?.isDefault;
    if (isDefault === false) worlds.push(context.id);
  });
  try {
    await client.send('Runtime.enable');
    for (const contextId of worlds) {
      const { result, exceptionDetails } = await client.send('Runtime.evaluate', {
        contextId, returnByValue: true,
        expression: `(() => {
          if (typeof chrome === 'undefined' || !chrome.runtime?.id) return null;
          const root = document.getElementById('theater-everywhere-ui')?.shadowRoot;
          if (!root) throw new Error('Player shadow root is missing');
          try {
            if (!globalThis.customElements) {
              const badge = root.querySelector('.te-new-badge');
              if (badge?.localName !== 'span' || getComputedStyle(badge).fontSize !== '9.5px') {
                throw new Error('Isolated-world badge fallback is missing or unstyled');
              }
              return {registry: 'unavailable', upgraded: false, badge: badge.localName};
            }
            const tag = 'tme-smoke-badge-probe';
            if (!customElements.get(tag)) customElements.define(tag, class extends HTMLElement {
              connectedCallback() { this.textContent = 'upgraded'; }
            });
            const badge = document.createElement(tag);
            root.append(badge);
            const upgraded = badge.textContent === 'upgraded';
            badge.remove();
            return {registry: 'available', upgraded};
          } catch (error) { return {registry: String(error), upgraded: false}; }
        })()`
      });
      if (exceptionDetails) throw new Error(exceptionDetails.text);
      if (result.value) {
        if (!['available', 'unavailable'].includes(result.value.registry)) throw new Error(result.value.registry);
        console.log('smoke:chromium badge custom-element feasibility (installed isolated world):', result.value);
        return;
      }
    }
    throw new Error('No extension isolated world was found for the badge feasibility check');
  } finally {
    await client.detach();
  }
}

/** Installed storage/world wiring, including date-version builds and same-generation item additions. */
async function assertFeatureHighlights(page: Page, origin: string, context: BrowserContext): Promise<void> {
  const worker = await extensionWorker(context);
  const localKeys = [WHATS_NEW_ACK_STORAGE_KEY, 'newFeaturesSeenThrough', SEEN_ITEMS_STORAGE_KEY];
  const originalLocal = await worker.evaluate(keys => chrome.storage.local.get(keys), localKeys);
  await worker.evaluate(({ key, release }) => chrome.storage.local.set({
    [key]: release, newFeaturesSeenThrough: '0.0', newFeaturesSeenItems: []
  }), { key: WHATS_NEW_ACK_STORAGE_KEY, release: WHATS_NEW_RELEASE.id });
  const options = await context.newPage();
  const second = await context.newPage();
  try {
    await page.goto(origin);
    await waitForPlayer(page);
    await page.locator('video#player').click();
    await page.keyboard.press('t');
    await page.locator('.player-settings-btn').waitFor();
    await page.locator('.player-settings-btn .te-new-badge[data-variant="dot"]').waitFor();
    await assertBadgeWorld(page, context);
    await page.locator('.player-settings-btn').press('Enter');
    await page.locator('[data-settings-section=audio] .te-new-badge').waitFor();
    await page.locator('.player-settings-btn').press('Enter');
    const url = new URL('options/options.html#appearance', worker.url()).href;
    await options.goto(url); await second.goto(url);
    await options.locator('#whats-new-btn.has-unseen').waitFor();
    await second.locator('#whats-new-btn.has-unseen').waitFor();
    for (const { id } of NEW_FEATURE_ITEMS.filter(item => !item.id.startsWith('player'))) {
      await options.locator(`[data-new-feature="${id}"] .te-new-badge`).waitFor({ state: 'attached' });
    }
    // Viewing Settings and using the player do not themselves acknowledge badges.
    await options.reload();
    await options.locator('[data-new-feature=settingsLanguage] .te-new-badge').waitFor({ state: 'attached' });
    await options.locator('label.toggle-switch').filter({ has: options.locator('#highlight-new-features-toggle') }).click();
    await second.waitForFunction(() => !(document.getElementById('highlight-new-features-toggle') as HTMLInputElement).checked);
    await options.locator('#whats-new-btn.has-unseen').waitFor({ state: 'hidden' });
    await second.locator('#whats-new-btn.has-unseen').waitFor({ state: 'hidden' });
    await page.waitForFunction(() => !document.getElementById('theater-everywhere-ui')?.shadowRoot?.querySelector('.te-new-badge'));
    await options.locator('label.toggle-switch').filter({ has: options.locator('#highlight-new-features-toggle') }).click();
    await second.waitForFunction(() => (document.getElementById('highlight-new-features-toggle') as HTMLInputElement).checked);
    await worker.evaluate(() => chrome.storage.local.set({ newFeaturesSeenThrough: '0.0', newFeaturesSeenItems: [] }));
    await options.locator('#whats-new-btn.has-unseen').waitFor();
    await options.getByRole('button', { name: 'Update highlights', exact: true }).click();
    await options.getByRole('dialog', { name: 'Update highlights' }).waitFor();
    await second.locator('#whats-new-btn.has-unseen').waitFor({ state: 'hidden' });
    for (const locale of ['en', 'pl', 'ar']) {
      const messages = JSON.parse(readFileSync(path.join(ROOT, '_locales', locale, 'messages.json'), 'utf8'));
      await worker.evaluate(language => chrome.storage.sync.set({ language }), locale);
      await options.getByRole('dialog', { name: messages.whatsNewDialogTitle.message, exact: true }).waitFor();
      await options.getByRole('button', { name: messages.dialogAcknowledge.message, exact: true }).waitFor();
      const content = options.locator('.whats-new-content[lang="en"][dir="ltr"]');
      await content.getByRole('heading', { name: WHATS_NEW_CONTENT.heading, exact: true }).waitFor();
      if (await content.locator('li').count() !== WHATS_NEW_CONTENT.items.length) throw new Error('Announcement must contain every English release item');
      await options.locator('.whats-new-thanks em').waitFor();
      await options.waitForFunction(locale => document.documentElement.dir === (locale === 'ar' ? 'rtl' : 'ltr'), locale);
      const scroll = options.locator('.te-dialog-body');
      await scroll.focus();
      await scroll.press('End');
      await options.waitForFunction(() => {
        const content = document.querySelector('.te-dialog-body');
        return content && content.scrollTop > 0 && content.scrollTop + content.clientHeight >= content.scrollHeight - 1;
      });
      const screenshotDir = process.env.SMOKE_SCREENSHOT_DIR;
      if (screenshotDir) {
        await options.locator('.te-dialog-overlay').evaluate(async overlay => {
          await Promise.all(overlay.getAnimations({ subtree: true }).map(animation => animation.finished));
        });
        await options.locator('.te-dialog-btn-primary').focus();
        await scroll.evaluate(el => { el.scrollTop = 0; });
        await options.screenshot({ path: path.join(screenshotDir, `tme58-dialog-${locale}.png`) });
        await scroll.evaluate(el => { el.scrollTop = el.scrollHeight; });
        await options.screenshot({ path: path.join(screenshotDir, `tme58-dialog-${locale}-end.png`) });
      }
      const scrollable = await scroll.evaluate(el => el.scrollHeight > el.clientHeight);
      if (!scrollable) throw new Error('Long announcement should scroll within the dialog');
    }
    const version = await worker.evaluate(() => chrome.runtime.getManifest().version);
    const seen = await worker.evaluate(() => chrome.storage.local.get(['newFeaturesSeenThrough', 'newFeaturesSeenItems']));
    const expected = featureHighlightsAcknowledgement(resolveFeatureHighlights(version, {}, { newFeaturesSeenThrough: '0.0' }));
    for (const [key, value] of Object.entries(expected)) {
      if (JSON.stringify(seen[key]) !== JSON.stringify(value)) throw new Error(`Opening Update highlights did not acknowledge ${key}`);
    }
    await page.waitForFunction(() => !document.getElementById('theater-everywhere-ui')?.shadowRoot?.querySelector('.te-new-badge'));
    await options.reload();
    await options.locator('#whats-new-btn:not(.has-unseen)').waitFor();
    if (await options.locator('.te-new-badge').count()) throw new Error('Unchanged development items reappeared after reload');
    if (resolveFeatureHighlights(version).development) {
      // Persisted catalog from a build before these two items joined the same generation.
      const earlierItems = NEW_FEATURE_ITEMS.filter(item => !['settingsLanguage', 'playerAudio'].includes(item.id))
        .map(item => `${item.id}@${item.since}`);
      await worker.evaluate(({ key, items }) => chrome.storage.local.set({ [key]: items }), { key: SEEN_ITEMS_STORAGE_KEY, items: earlierItems });
      await options.locator('[data-new-feature=settingsLanguage] .te-new-badge').waitFor({ state: 'attached' });
      await second.locator('[data-new-feature=settingsLanguage] .te-new-badge').waitFor({ state: 'attached' });
      await page.locator('.player-settings-btn .te-new-badge').waitFor();
      await page.locator('.player-settings-btn').press('Enter');
      await page.locator('[data-settings-section=audio] .te-new-badge').waitFor();
      if (await page.locator('.picture-layout-btn .te-new-badge').count()) throw new Error('Previously acknowledged player item reappeared');
      const screenshotDir = process.env.SMOKE_SCREENSHOT_DIR;
      if (screenshotDir) {
        await options.locator('#tab-appearance').click();
        await options.screenshot({ path: path.join(screenshotDir, 'badges-after-settings.png'), fullPage: true });
        await page.screenshot({ path: path.join(screenshotDir, 'badges-after-player.png') });
      }
    }
    console.log('smoke:chromium feature highlights: installed Settings/player wiring, version gate, cross-tab preference and acknowledgement passed');
  } finally {
    await worker.evaluate(async ({ keys, original }) => {
      await chrome.storage.local.remove(keys.filter(key => !(key in original)));
      await chrome.storage.local.set(original);
      await chrome.storage.sync.remove(['highlightNewFeatures', 'language']);
    }, { keys: localKeys, original: originalLocal });
    await options.close(); await second.close();
  }
}

/** Installed-extension proof: a Settings write reaches two pages, popup and shadow chrome. */
async function assertAppearanceModes(context: BrowserContext, origin: string): Promise<void> {
  const worker = await extensionWorker(context);
  const keys = ['highContrast', 'reduceTransparency', 'accentColor', 'keepControlsVisible', 'language'];
  const original = await worker.evaluate(keys => chrome.storage.sync.get(keys), keys);
  const options = await context.newPage();
  const second = await context.newPage();
  const player = await context.newPage();
  const popup = await context.newPage();
  const captureDir = process.env.THEATER_APPEARANCE_SCREENSHOT_DIR;
  const capture = async (page: Page, name: string, fullPage = false) => {
    if (!captureDir) return;
    mkdirSync(captureDir, { recursive: true });
    await page.screenshot({ path: path.join(captureDir, `tme48a-${name}.png`), fullPage, animations: 'disabled' });
  };
  const waitModes = async (contrast: string, transparency: string) => {
    for (const page of [options, second, popup]) await page.waitForFunction(({ contrast, transparency }) =>
      document.documentElement.dataset.contrast === contrast && document.documentElement.dataset.transparency === transparency,
    { contrast, transparency });
    await player.waitForFunction(({ contrast, transparency }) => {
      const host = document.getElementById('theater-everywhere-ui');
      return host?.dataset.contrast === contrast && host.dataset.transparency === transparency;
    }, { contrast, transparency });
  };
  try {
    await worker.evaluate(({ key, id }) => chrome.storage.local.set({ [key]: id }), { key: WHATS_NEW_ACK_STORAGE_KEY, id: WHATS_NEW_RELEASE.id });
    await worker.evaluate(() => chrome.storage.sync.set({ highContrast: 'off', reduceTransparency: 'off', accentColor: 'purple', keepControlsVisible: true, language: 'en' }));
    for (const page of [options, second]) {
      await page.setViewportSize({ width: 1440, height: 1100 });
      await page.goto(new URL('options/options.html#appearance', worker.url()).href);
      await page.locator('#highContrast-combobox-listbox [aria-selected="true"]').waitFor({ state: 'attached' });
    }
    await popup.setViewportSize({ width: 300, height: 300 });
    await popup.goto(new URL('popup/popup.html', worker.url()).href);
    await player.setViewportSize({ width: 1440, height: 900 });
    await player.goto(origin);
    await waitForPlayer(player);
    await player.keyboard.press('t');
    await player.locator(`html.${THEATER_HTML_CLASS}`).waitFor({ state: 'attached' });
    await waitModes('normal', 'normal');
    await capture(options, 'settings-normal', true);
    await player.locator('.player-settings-btn').focus();
    await player.locator('.player-settings-btn').press('Enter');
    await player.locator('.theater-settings-menu').waitFor({ state: 'visible' });
    await capture(player, 'player-normal');
    await options.locator('#highContrast-combobox').click();
    await options.locator('#highContrast-combobox-listbox [data-value="on"]').click();
    await waitModes('high', 'normal');
    if (await second.locator('#highContrast-combobox-listbox [data-value="on"]').getAttribute('aria-selected') !== 'true') fail('Appearance choice did not sync between Settings pages.');
    await capture(options, 'settings-contrast', true);
    if (captureDir) {
      const first = await options.locator('#highContrast-combobox').locator('..').boundingBox();
      const last = await options.locator('#highlight-new-features-toggle').locator('..').locator('..').boundingBox();
      if (!first || !last) throw new Error('Appearance blocks have no layout');
      await options.screenshot({ path: path.join(captureDir, 'tme48a-appearance-blocks.png'), clip: {
        x: first.x, y: first.y, width: first.width, height: last.y + last.height - first.y
      } });
    }
    await options.locator('#highContrast-combobox').click();
    await options.locator('#highContrast-combobox-listbox').waitFor();
    await capture(options, 'appearance-dropdown');
    await options.locator('#highContrast-combobox').press('Escape');
    await capture(player, 'player-contrast');
    await capture(popup, 'popup-contrast');
    await options.locator('#tab-features').click();
    await options.locator('[data-provider="netflix"]').hover();
    const decoration = await options.locator('[data-provider="netflix"]').evaluate(tile => ({
      content: getComputedStyle(tile, '::before').content,
      animation: getComputedStyle(tile, '::before').animationName
    }));
    if (decoration.content !== 'none' || decoration.animation !== 'none') fail('High contrast did not flatten the RTE decoration.');
    await capture(options, 'rte-contrast', true);
    await options.locator('#whats-new-btn').click();
    await options.locator('.te-dialog').waitFor();
    await capture(options, 'update-highlights-contrast');
    await options.locator('.te-dialog-btn-primary').click();
    await options.locator('.te-dialog').waitFor({ state: 'detached' });
    await options.locator('#tab-appearance').click();
    await options.locator('#highContrast-combobox').click();
    await options.locator('#highContrast-combobox-listbox [data-value="off"]').click();
    await options.locator('#reduceTransparency-combobox').click();
    await options.locator('#reduceTransparency-combobox-listbox [data-value="on"]').click();
    await waitModes('normal', 'reduced');
    const fill = await player.locator('.theater-controls-wrapper').evaluate(el => getComputedStyle(el, '::before').backgroundColor);
    if (fill !== 'rgb(24, 24, 27)') fail(`Reduced transparency kept a translucent toolbar: ${fill}`);
    await capture(player, 'player-transparency');
    await options.locator('#reduceTransparency-combobox').click();
    await options.locator('#reduceTransparency-combobox-listbox [data-value="off"]').click();
    await waitModes('normal', 'normal');
    // Exit/reenter creates a fresh shadow owner and hydrates the saved preferences.
    await worker.evaluate(() => chrome.storage.sync.set({ highContrast: 'on', reduceTransparency: 'on' }));
    await waitModes('high', 'reduced');
    await player.locator('.player-settings-btn').press('Escape'); // First dismiss the menu.
    await player.keyboard.press('Escape');
    await player.waitForFunction(() => !document.documentElement.classList.contains('theater-everywhere-html-active'));
    await player.locator('#theater-everywhere-ui').waitFor({ state: 'detached' });
    await player.keyboard.press('t');
    await waitModes('high', 'reduced');
    console.log('smoke:chromium appearance: installed Settings, cross-tab storage, popup, shadow player, RTE, restoration and reentry passed');
  } finally {
    await worker.evaluate(async ({ keys, original }) => {
      await chrome.storage.sync.remove(keys.filter(key => !(key in original)));
      await chrome.storage.sync.set(original);
    }, { keys, original });
    await Promise.all([options, second, player, popup].map(page => page.close()));
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

    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    // Escape is always an exit alias, including with a remapped exit shortcut.
    await worker.evaluate(() => chrome.storage.sync.set({ shortcuts: { exit: 'X' } }));

    const page = context.pages()[0] || await context.newPage();
    if (process.env.THEATER_SMOKE_HIGHLIGHTS_ONLY === '1') {
      await assertFeatureHighlights(page, origin, context);
      return;
    }
    if (process.env.THEATER_SMOKE_APPEARANCE_ONLY === '1') {
      await assertAppearanceModes(context, origin);
      return;
    }
    if (process.env.THEATER_SMOKE_LANGUAGE_ONLY === '1') {
      await assertLanguageMenu(page, origin, context);
      return;
    }
    if (process.env.THEATER_SMOKE_AUTO_THEATER_ONLY === '1') {
      await assertAutoTheater(page, context);
      return;
    }
    await page.goto(`${origin}/`, { waitUntil: 'domcontentloaded' });
    await waitForPlayer(page);
    await assertTheaterToggle(page);
    console.log('smoke:chromium local player T/Escape passed');
    await assertPictureClickReclaimsKeys(page);
    await assertScrubberPreviewLeaves(page);
    console.log('smoke:chromium picture focus and scrubber preview passed');
    await assertThumbPlayerSwap(page);
    console.log('smoke:chromium ThumbPlayer video swap passed');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForPlayer(page);
    if (process.env.THEATER_SMOKE_SHORTCUTS_ONLY !== '1') await assertControlsPin(page, context);
    await assertShortcutManagement(page, context);
    await assertRteSettings(context);
    await assertFullscreenAndHelp(page, true, context);

    await setBlacklist(context, ['127.0.0.1']);
    await assertBlacklistBlocksTheater(page);
    await setBlacklist(context, []);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForPlayer(page);
    await assertTheaterToggle(page);
    console.log('smoke:chromium blacklist exact host passed');

    await assertIframeHandshake(page, origin);
    console.log('smoke:chromium same-origin iframe handshake passed');

    await assertAutoTheater(page, context);
    await assertParentBlacklist(page, origin, context);
    await setBlacklist(context, []);
    console.log('smoke:chromium parent-domain blacklist passed');
    await assertLanguageMenu(page, origin, context);
    await assertFeatureHighlights(page, origin, context);
    await assertAppearanceModes(context, origin);
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
    await assertControlsPin(page, undefined, true);
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
    await assertThumbPlayerSwap(page);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForPlayer(page);
    await injectBundledPlayer(page, unpackedDir);
    await assertControlsPin(page);
    await assertFullscreenAndHelp(page);
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
