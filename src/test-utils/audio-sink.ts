import { errors, type Browser, type BrowserContext, type LaunchOptions } from 'playwright';

import type { TestEngine } from './test-engines';

/** Native audio cases fail with an environment error, not a 30 s wait, when no output device answers. */
export const AUDIO_SINK_TIMEOUT_MS = 5_000;

/**
 * Launch options for cases that play real audio. They admit contexts without a
 * user gesture, so a context's state follows playback alone and never the
 * browser's autoplay policy; the runtime's policy gate is covered with a
 * controlled context instead.
 */
export function nativeAudioLaunchOptions(engine: TestEngine): LaunchOptions {
  return engine === 'chromium'
    ? { headless: true, args: ['--autoplay-policy=no-user-gesture-required'] }
    : { headless: true, firefoxUserPrefs: { 'media.autoplay.default': 0, 'media.autoplay.block-webaudio': false } };
}

const checked = new WeakMap<Browser, Promise<void>>();

/** Starts a context in a scratch page and waits for its clock to advance. The verdict is cached per browser. */
export function requireAudioSink(context: BrowserContext): Promise<void> {
  const browser = context.browser();
  if (!browser) throw new Error('requireAudioSink needs a context that belongs to a browser');
  let verdict = checked.get(browser);
  if (!verdict) {
    verdict = probe(context);
    checked.set(browser, verdict);
  }
  return verdict;
}

function noSink(detail: string): Error {
  return new Error(`environment: no audio sink. A Web Audio context did not start within ${AUDIO_SINK_TIMEOUT_MS} ms (${detail}). Start an audio server with a null sink (see docs/browser-tests.md) and rerun; this is not a lifecycle failure.`);
}

async function probe(context: BrowserContext): Promise<void> {
  const page = await context.newPage();
  try {
    const sink = await page.evaluateHandle(() => {
      const audio = new AudioContext();
      void audio.resume().catch(() => undefined);
      return audio;
    }).catch((error: Error) => { throw noSink(`creating a context failed: ${error.message}`); });
    try {
      await page.waitForFunction(audio => audio.state === 'running' && audio.currentTime > 0, sink, { timeout: AUDIO_SINK_TIMEOUT_MS });
    } catch (error) {
      if (!(error instanceof errors.TimeoutError)) throw error;
      throw noSink(await sink.evaluate(audio => `${audio.state}, currentTime ${audio.currentTime}`));
    }
    await sink.evaluate(audio => audio.close());
  } finally {
    await page.close();
  }
}
