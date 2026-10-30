import { MEDIA_PROVIDER_FLAG_KEYS, type MediaProviderId } from '../../src/media-features/provider-flags';

import type { BrowserContext, Page } from './helpers';
import { extensionWorker, THEATER_HTML_CLASS } from './helpers';

/**
 * Every provider whose capability row says `autoTheater: yes` runs this in its installed-extension smoke
 * (`provider-auto-theater.test.ts` keeps the list honest): AutoTheater on, the host's own watch URL, then the
 * host's client-side navigation to another video. A per-host extraction that breaks the watch hook, the watch
 * identity or the navigation signal passes every other provider assertion and fails only here.
 */
export async function assertAutoTheaterEntry(
  page: Page,
  context: BrowserContext,
  provider: MediaProviderId,
  options: {
    url: string;
    /** Opens another video the way the host's own router does, from the page `url` loaded. */
    navigate?(page: Page): Promise<void>;
  }
): Promise<void> {
  const worker = await extensionWorker(context);
  const flag = MEDIA_PROVIDER_FLAG_KEYS[provider];
  const saved = await worker.evaluate(keys => chrome.storage.sync.get(keys), ['autoEnterTheater', 'autoTheaterSkipCountdown', flag]);
  const entered = () => page.waitForFunction(htmlClass => document.documentElement.classList.contains(htmlClass), THEATER_HTML_CLASS, { timeout: 20_000 })
    .catch(() => { throw new Error(`${provider}: AutoTheater did not enter`); });
  const exited = async () => {
    await page.keyboard.press('Escape');
    await page.waitForFunction(htmlClass => !document.documentElement.classList.contains(htmlClass), THEATER_HTML_CLASS);
  };
  // Muted fixture media may need a nudge: the host fixtures load their source asynchronously.
  const play = () => page.waitForFunction(() => {
    const video = [...document.querySelectorAll('video')][0];
    if (!video || video.readyState < 2) return false;
    video.muted = true;
    void video.play();
    return !video.paused;
  });
  try {
    // The countdown itself is covered by the AutoTheater suites; this checks that the provider qualifies at all.
    await worker.evaluate(({ flag }) => chrome.storage.sync.set({ autoEnterTheater: true, autoTheaterSkipCountdown: true, [flag]: true }), { flag });
    await page.goto(options.url);
    await page.waitForFunction(() => document.documentElement.hasAttribute('data-theater-everywhere-entry-shortcuts'));
    await play();
    await entered();
    await exited();
    if (options.navigate) {
      await options.navigate(page);
      await play();
      await entered();
      await exited();
    }
  } finally {
    await worker.evaluate(async ({ saved, keys }) => {
      await chrome.storage.sync.remove(keys);
      await chrome.storage.sync.set(saved);
    }, { saved, keys: ['autoEnterTheater', 'autoTheaterSkipCountdown', flag] });
  }
}
