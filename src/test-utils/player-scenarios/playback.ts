import { assertLocalized } from '../language-audit';
import type { Page } from 'playwright';
import { fail, theaterEntered, enterTheaterFromPicture, exitTheater, THEATER_VIDEO_CLASS, THEATER_HTML_CLASS } from './state';
export async function assertTheaterToggle(page: Page): Promise<void> {
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
  await page.clock.runFor(300);
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
  await page.waitForFunction(before => document.querySelector<HTMLVideoElement>('video#player')!.paused !== before, pausedBefore);
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
    await page.waitForFunction(() => document.querySelector<HTMLVideoElement>('video#player')!.paused);
  }

  await page.keyboard.press('t');
  await page.waitForFunction((videoClass) => !document.querySelector('video#player')?.classList.contains(videoClass),
    THEATER_VIDEO_CLASS, { timeout: 10_000 });
  if (await page.evaluate(() => (window as Window & { theaterShortcutSpy?: { releases: number } }).theaterShortcutSpy?.releases) !== 0) {
    fail('The host received the T keyup after exiting theater mode.');
  }
  await page.clock.runFor(250);
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

export async function assertPictureClickReclaimsKeys(page: Page): Promise<void> {
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

export async function assertScrubberPreviewLeaves(page: Page): Promise<void> {
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

    return element.closest('.theater-controls-row')?.querySelector('.theater-scrubber-tooltip')?.classList.contains('visible');
  }, box.x + box.width / 3);
  await page.clock.runFor(40);
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

export async function assertThumbPlayerSwap(page: Page): Promise<void> {
  await page.clock.runFor(250);
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


export async function assertPlayerLocalization(page: Page): Promise<void> {
  await page.keyboard.press('t');
  await page.locator('.theater-controls-wrapper').waitFor();
  for (const locale of ['pl', 'ar']) {
    await page.evaluate(`SmokeRegressions.languageRuntime.set('${locale}')`);
    await page.locator(`.theater-controls-wrapper[lang="${locale}"]`).waitFor();
    await assertLocalized(page, locale, '#theater-everywhere-ui');
  }
}
