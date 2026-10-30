import { type Page } from 'playwright';

import { fail, THEATER_VIDEO_CLASS, timeScenario } from './helpers';
export async function assertEmbeddedKeysAndFullscreen(page: Page, origin: string): Promise<void> {
  return timeScenario('assertEmbeddedKeysAndFullscreen', { syncWrites: 0 }, async () => {
    await page.goto(`${origin}/iframe-key-capture`, { waitUntil: 'domcontentloaded' });
    const frame = page.frameLocator('#child');
    const fullscreen = () => page.evaluate(() => document.fullscreenElement?.tagName ?? null);
    const theater = () => page.evaluate((videoClass) => document.getElementById('child')?.classList.contains(videoClass) === true, THEATER_VIDEO_CLASS);
    await frame.locator('video#player').click({ timeout: 15_000 });
    await page.locator('body').evaluate(body => { body.tabIndex = -1; });
    await page.locator('body').focus();
    await page.keyboard.press('t');
    await page.waitForFunction((videoClass) => document.getElementById('child')?.classList.contains(videoClass), THEATER_VIDEO_CLASS, { timeout: 10_000 });
    // Entered from the embedding page, left from the frame: a frame must not stack fullscreen on its parent.
    await page.keyboard.press('f');
    await page.waitForFunction(() => document.fullscreenElement === document.documentElement);
    await frame.locator('video#player').click();
    await frame.locator('body').press('f');
    await page.waitForFunction(() => !document.fullscreenElement, undefined, { timeout: 5_000 }).catch(async () => {
      fail(`Fullscreen left from the frame stacked instead (top ${await fullscreen()}).`);
    });
    // Entered from the frame, left from the embedding page.
    await frame.locator('body').press('f');
    await page.waitForFunction(() => Boolean(document.fullscreenElement), undefined, { timeout: 5_000 });
    await page.locator('body').focus();
    await page.keyboard.press('f');
    await page.waitForFunction(() => !document.fullscreenElement, undefined, { timeout: 5_000 });
    // The framed player enters fullscreen by itself; the shortcut still leaves it.
    await frame.locator('body').evaluate(() => document.documentElement.requestFullscreen());
    await page.waitForFunction(() => document.fullscreenElement?.id === 'child');
    await page.locator('body').focus();
    await page.keyboard.press('f');
    await page.waitForFunction(() => !document.fullscreenElement, undefined, { timeout: 5_000 });
    // Escape reaches the session although the host claimed it first.
    await page.keyboard.press('Escape');
    await page.waitForFunction((videoClass) => !document.getElementById('child')?.classList.contains(videoClass), THEATER_VIDEO_CLASS, { timeout: 10_000 });
    if (await theater()) fail('Escape did not leave theater after the host claimed it.');
  });
}
