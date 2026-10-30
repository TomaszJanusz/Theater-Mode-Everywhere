import type { BrowserContext, Page } from 'playwright';
import { extensionWorker, fail, timeScenario } from './helpers';

/** Real storage and the installed isolated-to-MAIN audio bridge; UI cycles live in the fixture suite. */
export async function assertAudioWorld(page: Page, context: BrowserContext): Promise<void> {
  await timeScenario('assertAudioWorld', async () => {
    const worker = await extensionWorker(context);
    const keys = ['voiceBoost', 'volumeLeveling', 'bassLevel', 'volumeBoostEnabled'];
    await page.locator('video#player').evaluate(async (video: HTMLVideoElement) => {
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
    await page.waitForFunction(() => {
      const video = document.querySelector<HTMLVideoElement>('video#player');
      return video?.dataset.theaterVoice === 'light' && video.dataset.theaterLeveling === 'strong'
        && video.dataset.theaterBass === 'more' && video.dataset.theaterBoostReady === 'true';
    });
    const saved = await worker.evaluate(keys => chrome.storage.sync.get(keys), keys);
    if (saved.voiceBoost !== 'light' || saved.volumeLeveling !== 'strong' || saved.bassLevel !== 'more' || saved.volumeBoostEnabled !== false) {
      fail(`Audio settings were not saved: ${JSON.stringify(saved)}`);
    }
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await page.locator('.theater-controls-wrapper').waitFor({ state: 'detached' });
    await page.waitForFunction(() => {
      const video = document.querySelector<HTMLVideoElement>('video#player');
      return video?.dataset.theaterVoice === 'off' && video.dataset.theaterLeveling === 'off'
        && video.dataset.theaterBass === 'original' && video.dataset.theaterBoost === '1.0';
    });
    if (await page.locator('video#player').getAttribute('data-smoke-audio-emptied') !== '0') fail('Audio bridge reloaded the media.');
    await worker.evaluate(keys => chrome.storage.sync.remove(keys), keys);
  });
}
