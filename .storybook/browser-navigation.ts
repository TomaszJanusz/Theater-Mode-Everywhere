import type { Page } from 'playwright';

import { storyUrl, type Profile } from './profiles';

export async function waitForStory(page: Page): Promise<void> {
  const phase = await page.waitForFunction(() => {
    const value = (window as unknown as { __STORYBOOK_PREVIEW__?: { currentRender?: { phase?: string } } })
      .__STORYBOOK_PREVIEW__?.currentRender?.phase;
    return value === 'finished' || value === 'errored' || value === 'aborted' ? value : false;
  });
  if (await phase.jsonValue() !== 'finished') throw new Error(`Story did not finish: ${page.url()}`);
}

/** URL args reject punctuation and non-Latin text. Use Storybook's args channel for those values. */
export async function openStory(page: Page, base: string, id: string, profile: Profile): Promise<void> {
  await page.setViewportSize(profile.viewport);
  await page.emulateMedia({ reducedMotion: profile.reducedMotion });
  await page.goto(storyUrl(base, id, profile));
  await waitForStory(page);
  if (!Object.keys(profile.args).length) return;
  await page.evaluate(({ storyId, updatedArgs }) => {
    const channel = (window as unknown as { __STORYBOOK_ADDONS_CHANNEL__: { emit(type: string, payload: unknown): void } }).__STORYBOOK_ADDONS_CHANNEL__;
    channel.emit('updateStoryArgs', { storyId, updatedArgs });
  }, { storyId: id, updatedArgs: profile.args });
  await page.waitForFunction(args => Object.entries(args).every(([key, value]) => window.__storyState?.args[key] === value), profile.args);
  await waitForStory(page);
}
