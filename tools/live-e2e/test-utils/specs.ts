import type { Page } from 'playwright';

import { THEATER_VIDEO_ATTR, THEATER_VIDEO_CLASS } from '../../../src/platform/active-video';
import type { Capability, Target } from '../model';

/** Upper bound for the extension to react to a key press; waits end as soon as the state appears. */
export const STATE_TIMEOUT_MS = 10_000;

const HTML_ACTIVE_CLASS = 'theater-everywhere-html-active';
const CONTROLS = '.theater-controls-wrapper';

type Spec = (page: Page, target: Target) => Promise<void>;

// Keys only, no click: a click would toggle host playback and can land on host overlays.
// Hosts can leave focus in an embedded frame (an ad, a widget), so focus the video first.
async function enterTheater(page: Page, target: Target): Promise<void> {
  const video = page.locator(target.videoSelector).first();
  await video.waitFor({ state: 'attached', timeout: STATE_TIMEOUT_MS });
  await video.focus({ timeout: STATE_TIMEOUT_MS });
  await page.keyboard.press('t');
  await page.locator(CONTROLS).waitFor({ timeout: STATE_TIMEOUT_MS });
}

async function exitTheater(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await page.locator(CONTROLS).waitFor({ state: 'detached', timeout: STATE_TIMEOUT_MS });
}

/**
 * One spec per capability. Each asserts the extension's own contract (state classes and
 * attributes, the control bar), never host copy or geometry. Add `captions` / `chat` specs
 * here and to `CAPABILITIES` when their contract has a stable, host-independent signal.
 */
export const SPECS: Record<Capability, Spec> = {
  async theater(page, target) {
    await enterTheater(page, target);
    await page.waitForFunction(cls => document.documentElement.classList.contains(cls), HTML_ACTIVE_CLASS, { timeout: STATE_TIMEOUT_MS });
    await exitTheater(page);
    await page.waitForFunction(cls => !document.documentElement.classList.contains(cls), HTML_ACTIVE_CLASS, { timeout: STATE_TIMEOUT_MS });
  },

  async 'active-video'(page, target) {
    await enterTheater(page, target);
    const marked = `video.${THEATER_VIDEO_CLASS}, video[${THEATER_VIDEO_ATTR}]`;
    await page.locator(marked).first().waitFor({ state: 'attached', timeout: STATE_TIMEOUT_MS });
    await exitTheater(page);
    await page.locator(`video.${THEATER_VIDEO_CLASS}`).first().waitFor({ state: 'detached', timeout: STATE_TIMEOUT_MS });
  }
};
