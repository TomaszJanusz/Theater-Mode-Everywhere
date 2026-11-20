import type { BrowserContext, Page } from 'playwright';

import { extensionWorker, fail, timeScenario } from './helpers';

/**
 * Real storage and the installed isolated-to-MAIN audio bridge; UI cycles live in the fixture suite. Echo
 * reduction also proves the installed wiring the fixtures cannot: the isolated world's handoff of the
 * web-accessible worklet URLs (dynamic in Chromium) and the MAIN-world worklet compiling the packaged DSP.
 */
export async function assertAudioWorld(page: Page, context: BrowserContext): Promise<void> {
  await timeScenario('assertAudioWorld', { syncWrites: 8 }, async () => {
    const worker = await extensionWorker(context);
    const keys = ['voiceBoost', 'volumeLeveling', 'bassLevel', 'echoReduction', 'volumeBoostEnabled'];
    await page.locator('video#player').evaluate(async (video: HTMLVideoElement) => {
      // The worklet's one reply (whether the DSP compiled), seen from the page like any page script could.
      const Native = AudioWorkletNode;
      window.AudioWorkletNode = class extends Native {
        constructor(...args: ConstructorParameters<typeof AudioWorkletNode>) {
          super(...args);
          this.port.addEventListener('message', event => { video.dataset.smokeEchoReply ??= String(event.data); });
        }
      };
      video.srcObject = null;
      video.src = '/vod.webm';
      video.loop = true;
      await video.play();
      video.dataset.smokeAudioEmptied = '0';
      video.addEventListener('emptied', () => { video.dataset.smokeAudioEmptied = '1'; }, { once: true });
    });
    await page.keyboard.press('t');
    await page.locator('.player-settings-btn').click();
    // On, then back to Off: the stepper holds at either end, so each press is a different arrow.
    await page.locator('.volume-boost-btn .theater-stepper-btn[data-direction="1"]').click();
    await page.locator('.volume-boost-btn .theater-stepper-btn[data-direction="-1"]').click();
    await page.locator('.audio-voice-btn .theater-stepper-btn[data-direction="1"]').click();
    await page.locator('.audio-leveling-btn .theater-stepper-btn[data-direction="1"]').click();
    await page.locator('.audio-leveling-btn .theater-stepper-btn[data-direction="1"]').click();
    await page.locator('.audio-bass-btn .theater-stepper-btn[data-direction="1"]').click();
    await page.locator('.audio-echo-btn .theater-stepper-btn[data-direction="1"]').click();
    await page.waitForFunction(() => {
      const video = document.querySelector<HTMLVideoElement>('video#player');
      return video?.dataset.theaterVoice === 'light' && video.dataset.theaterLeveling === 'strong'
        && video.dataset.theaterBass === 'more' && video.dataset.theaterEcho === 'light'
        && video.dataset.theaterBoostReady === 'true' && video.dataset.smokeEchoReply !== undefined;
    });
    const echo = await page.locator('video#player').evaluate((video: HTMLVideoElement) => ({
      reply: video.dataset.smokeEchoReply, unavailable: video.dataset.theaterEchoUnavailable
    }));
    if (echo.reply !== 'true' || echo.unavailable !== undefined) fail(`Echo reduction did not load in the MAIN world: ${JSON.stringify(echo)}`);
    const saved = await worker.evaluate(keys => chrome.storage.sync.get(keys), keys);
    if (saved.voiceBoost !== 'light' || saved.volumeLeveling !== 'strong' || saved.bassLevel !== 'more'
      || saved.echoReduction !== 'light' || saved.volumeBoostEnabled !== false) {
      fail(`Audio settings were not saved: ${JSON.stringify(saved)}`);
    }
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await page.locator('.theater-controls-wrapper').waitFor({ state: 'detached' });
    await page.waitForFunction(() => {
      const video = document.querySelector<HTMLVideoElement>('video#player');
      return video?.dataset.theaterVoice === 'off' && video.dataset.theaterLeveling === 'off'
        && video.dataset.theaterBass === 'original' && video.dataset.theaterEcho === 'off' && video.dataset.theaterBoost === '1.0';
    });
    if (await page.locator('video#player').getAttribute('data-smoke-audio-emptied') !== '0') fail('Audio bridge reloaded the media.');
    await worker.evaluate(keys => chrome.storage.sync.remove(keys), keys);
  });
}
