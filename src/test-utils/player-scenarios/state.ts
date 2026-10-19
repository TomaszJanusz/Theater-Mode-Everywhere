import type { Page } from 'playwright';

// Supplied by test/fixtures/local-player.html before the player runtime loads.
declare global { interface Window { hostEntryKeys: string[]; } }
export const THEATER_VIDEO_CLASS = 'theater-everywhere-video-active';
export const THEATER_HTML_CLASS = 'theater-everywhere-html-active';
export function fail(message: string): never { throw new Error(message); }
export async function theaterEntered(page: Page): Promise<boolean> {
  return page.evaluate(({ videoClass, htmlClass }) => {
    const video = document.querySelector('video#player');
    return Boolean(video?.classList.contains(videoClass) || document.documentElement.classList.contains(htmlClass));
  }, { videoClass: THEATER_VIDEO_CLASS, htmlClass: THEATER_HTML_CLASS });
}

export async function enterTheaterFromPicture(page: Page): Promise<void> {
  await page.clock.runFor(250);
  await page.locator('video#player').click();
  await page.keyboard.press('t');
  await page.waitForFunction((videoClass) => document.querySelector('video#player')?.classList.contains(videoClass),
    THEATER_VIDEO_CLASS, { timeout: 10_000 });
}

export async function exitTheater(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await page.waitForFunction((htmlClass) => !document.documentElement.classList.contains(htmlClass),
    THEATER_HTML_CLASS, { timeout: 10_000 });
}
