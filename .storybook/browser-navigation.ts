import type { Page } from 'playwright';

import { storyUrl, type Profile } from './profiles';

const pageErrors = new WeakMap<Page, string[]>();

function trackErrors(page: Page): string[] {
  let errors = pageErrors.get(page);
  if (errors) return errors;
  errors = [];
  pageErrors.set(page, errors);
  const record = (message: string) => {
    errors.push(message);
    if (errors.length > 20) errors.shift();
  };
  page.on('pageerror', error => record(error.message));
  page.on('console', message => { if (message.type() === 'error') record(message.text()); });
  page.on('requestfailed', request => record(`${request.url()}: ${request.failure()?.errorText}`));
  return errors;
}

export async function waitForStory(page: Page): Promise<void> {
  const errors = trackErrors(page);
  try {
    const phase = await page.waitForFunction(() => {
      const value = (window as unknown as { __STORYBOOK_PREVIEW__?: { currentRender?: { phase?: string } } })
        .__STORYBOOK_PREVIEW__?.currentRender?.phase;
      return value === 'finished' || value === 'errored' || value === 'aborted' ? value : false;
    });
    if (await phase.jsonValue() !== 'finished') throw new Error('Story did not finish');
  } catch (error) {
    const state = await page.evaluate(() => ({
      phase: (window as unknown as { __STORYBOOK_PREVIEW__?: { currentRender?: { phase?: string } } })
        .__STORYBOOK_PREVIEW__?.currentRender?.phase ?? 'missing preview',
      story: window.__storyState,
      body: document.body.innerText.slice(0, 4000)
    })).catch(() => 'page unavailable');
    throw new Error(`Waiting for Storybook render to finish: ${page.url()}\nState: ${JSON.stringify(state)}\nBrowser errors: ${errors.join('\n') || 'none'}`, { cause: error });
  }
}

/** URL args reject punctuation and non-Latin text. Use Storybook's args channel for those values. */
export async function openStory(page: Page, base: string, id: string, profile: Profile): Promise<void> {
  await page.setViewportSize(profile.viewport);
  await page.emulateMedia({ reducedMotion: profile.reducedMotion });
  trackErrors(page).length = 0;
  const response = await page.goto(storyUrl(base, id, profile));
  if (!response?.ok()) throw new Error(`Storybook navigation failed: HTTP ${response?.status()} ${page.url()}`);
  await waitForStory(page);
  if (!Object.keys(profile.args).length) return;
  await page.evaluate(({ storyId, updatedArgs }) => {
    const channel = (window as unknown as { __STORYBOOK_ADDONS_CHANNEL__: { emit(type: string, payload: unknown): void } }).__STORYBOOK_ADDONS_CHANNEL__;
    channel.emit('updateStoryArgs', { storyId, updatedArgs });
  }, { storyId: id, updatedArgs: profile.args });
  await page.waitForFunction(args => Object.entries(args).every(([key, value]) => window.__storyState?.args[key] === value), profile.args);
  await waitForStory(page);
}

export async function selectTimeline(page: Page, timeline: Profile['globals']['timeline']): Promise<void> {
  await page.evaluate(value => {
    const channel = (window as unknown as { __STORYBOOK_ADDONS_CHANNEL__: { emit(type: string, payload: unknown): void } }).__STORYBOOK_ADDONS_CHANNEL__;
    channel.emit('updateGlobals', { globals: { timeline: value } });
  }, timeline);
  await page.waitForFunction(value => window.__storyState?.globals.timeline === value, timeline);
  await waitForStory(page);
}
