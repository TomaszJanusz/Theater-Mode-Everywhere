import type { Page } from 'playwright';
import { fail, enterTheaterFromPicture, exitTheater } from './state';
import type { Locator } from 'playwright';
import { BASS_LEVELS } from '../../audio-settings';
const BASS_LABELS: Record<typeof BASS_LEVELS[number], string> = { less: 'Less', original: 'Original', more: 'More', moar: 'MOAAR', moaaarr: 'MOAAARR!' };
/** The configured bass levels in shortcut order, starting after `from` and ending on it. */
const bassLapFrom = (from: typeof BASS_LEVELS[number]) => {
  const start = BASS_LEVELS.indexOf(from);
  return [...BASS_LEVELS.slice(start + 1), ...BASS_LEVELS.slice(0, start + 1)];
};


export async function assertAudioSettings(page: Page): Promise<void> {
  const video = page.locator('video#player');
  // The fixture is same-origin: all audio controls must retain its decoded
  // frames, including gain enabled before any other effect and reentry.
  await video.evaluate((video: HTMLVideoElement) => {
    video.dataset.smokeAudioEmptied = '0';
    video.addEventListener('emptied', () => { video.dataset.smokeAudioEmptied = '1'; }, { once: true });
  });
  const gear = page.locator('.player-settings-btn');
  const hud = page.locator('.theater-everywhere-volume-overlay.status-hud');
  const shapes = (locator: Locator) => locator.locator('svg').first().evaluate(svg => svg.innerHTML);
  const media = () => video.evaluate((video: HTMLVideoElement) => ({
    voice: video.dataset.theaterVoice, leveling: video.dataset.theaterLeveling, bass: video.dataset.theaterBass
  }));
  const stepTo = async (name: 'voice' | 'leveling' | 'bass', hudLabel: string, detail: string, direction: 1 | -1 = 1) => {
    const row = page.locator(`.audio-${name}-btn`);
    await row.locator(`.theater-stepper-btn[data-direction="${direction}"]`).click();
    await page.waitForFunction(([name, detail]) => document.getElementById('theater-everywhere-ui')?.shadowRoot
      ?.querySelector(`.audio-${name}-btn .theater-stepper-value`)?.textContent === detail, [name, detail]);
    await hud.filter({ hasText: `${hudLabel}: ${detail}` }).waitFor();
    if (await hud.innerText() !== `${hudLabel}: ${detail}`) fail(`${hudLabel} HUD did not confirm ${detail}.`);
    if (await shapes(hud) !== await shapes(row)) fail(`${hudLabel} HUD icon differs from its settings row.`);
  };

  if (!await page.locator('.audio-voice-btn').isVisible()) await gear.press('Enter');
  const section = page.locator('[data-settings-section="audio"]');
  await section.waitFor();
  // The heading can contain a nested New badge; its label is still Audio.
  const audioHeading = await section.locator('.theater-settings-heading').evaluate(heading =>
    Array.from(heading.childNodes).filter(node => node.nodeType === Node.TEXT_NODE).map(node => node.textContent).join('').trim());
  if (audioHeading !== 'Audio') fail(`Audio section heading is missing: ${JSON.stringify(audioHeading)}`);
  const details = await section.locator('.theater-settings-detail, .theater-stepper-value').allInnerTexts();
  if (details.join('|') !== 'Off|Off|Off|Original') fail(`Audio settings should start neutral: ${details.join('|')}`);
  if (await page.locator('.audio-voice-btn').getAttribute('aria-keyshortcuts') !== 'V') fail('Voice boost row does not advertise its shortcut.');
  const slider = page.locator('.theater-volume-slider');
  const boost = page.locator('.volume-boost-btn');
  await boost.click();
  await hud.filter({ hasText: 'Volume boost: On' }).waitFor();
  if (await shapes(hud) !== await shapes(boost)) fail('Volume boost HUD icon differs from its settings row.');
  if (await slider.getAttribute('max') !== '1.5') fail('Volume boost did not raise the volume ceiling.');
  // A drag stops at 100% first, so reach the boosted level in two moves.
  for (const value of ['1', '1.5']) {
    await slider.evaluate((input: HTMLInputElement, value) => {
      input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }, value);
  }
  await page.keyboard.press('Shift+B');
  await hud.filter({ hasText: 'Volume boost: Off' }).waitFor();
  if (await slider.getAttribute('max') !== '1' || await slider.inputValue() !== '1') {
    fail(`Turning volume boost off kept boosted volume: ${await slider.getAttribute('max')} / ${await slider.inputValue()}`);
  }
  if (await video.evaluate((video: HTMLVideoElement) => video.dataset.theaterBoost) !== '1.0') fail('Volume boost kept amplifying after it was turned off.');
  await page.keyboard.press('Shift+B');
  await slider.evaluate((input: HTMLInputElement) => {
    for (const value of ['1.5', '1', '0']) {
      input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });
  await page.keyboard.press('Shift+B');
  await page.keyboard.press('m');
  if (await slider.inputValue() !== '1' || await video.evaluate((video: HTMLVideoElement) => video.dataset.theaterBoost) !== '1.0') {
    fail('Unmute restored a boosted level after volume boost was turned off at zero volume.');
  }
  await stepTo('voice', 'Voice boost', 'Light');
  // The click is the user activation the MAIN world needs to start Web Audio.
  await page.waitForFunction(() => {
    const player = document.querySelector<HTMLVideoElement>('video#player');
    return player?.dataset.theaterVoice === 'light' && player.dataset.theaterBoostReady === 'true';
  });
  await stepTo('leveling', 'Reduce loud sounds', 'Light');
  await stepTo('leveling', 'Reduce loud sounds', 'Strong');
  await stepTo('bass', 'Bass', 'More');
  // One full lap of the configured levels from More, ending on More again.
  for (const level of bassLapFrom('more')) {
    await page.keyboard.press('b');
    await hud.filter({ hasText: `Bass: ${BASS_LABELS[level]}` }).waitFor();
    if (level === 'moar' || level === 'moaaarr') {
      // The shortcut's real HUD, painted with the user's accent inline, must still show the red.
      const colors = await hud.evaluate((overlay: HTMLElement) => ['.volume-hud-text', '.volume-hud-icon'].map(selector => getComputedStyle(overlay.querySelector(selector)!).color));
      if (await hud.getAttribute('data-level') !== level || colors.some(color => color !== 'rgb(239, 68, 68)')) {
        fail(`The ${level} Bass HUD is not red: level ${await hud.getAttribute('data-level')}, colours ${colors.join(' / ')}.`);
      }
    }
  }
  for (const [key, name, label] of [['v', 'voice', 'Voice boost'], ['r', 'leveling', 'Reduce loud sounds']] as const) {
    const initial = (await media())[name];
    for (let step = 0; step < 3; step++) {
      const before = (await media())[name];
      await page.keyboard.press(key);
      await page.waitForFunction(([name, before]) => document.querySelector<HTMLVideoElement>('video#player')
        ?.dataset[name === 'voice' ? 'theaterVoice' : 'theaterLeveling'] !== before, [name, before]);
      const detail = await page.locator(`.audio-${name}-btn .theater-stepper-value`).innerText();
      if (await hud.innerText() !== `${label}: ${detail}`) fail(`${label} shortcut did not confirm its new level.`);
    }
    if ((await media())[name] !== initial) fail(`${label} shortcut did not cycle through all levels.`);
  }
  const beforeGuardedKeys = await media();
  await page.evaluate(() => {
    const input = document.createElement('input');
    input.id = 'audio-shortcut-draft';
    document.body.append(input);
    input.focus();
  });
  await page.keyboard.type('vrbB');
  await page.evaluate(() => document.getElementById('audio-shortcut-draft')?.remove());
  await page.keyboard.press('h');
  await page.locator('.theater-help-overlay').waitFor();
  for (const key of ['v', 'r', 'b', 'Shift+B']) await page.keyboard.press(key);
  await page.locator('.theater-help-overlay .te-dialog-close').press('Enter');
  await page.locator('.theater-help-overlay').waitFor({ state: 'detached' });
  await page.evaluate(() => {
    for (const [key, code, shiftKey] of [['v', 'KeyV', false], ['r', 'KeyR', false], ['b', 'KeyB', false], ['B', 'KeyB', true]] as const) {
      window.dispatchEvent(new KeyboardEvent('keydown', { key, code, shiftKey, repeat: true, bubbles: true, cancelable: true }));
      window.dispatchEvent(new KeyboardEvent('keyup', { key, code, shiftKey, bubbles: true, cancelable: true }));
    }
  });
  if (JSON.stringify(await media()) !== JSON.stringify(beforeGuardedKeys) || await slider.getAttribute('max') !== '1') {
    fail('Audio shortcuts fired in an editable field, behind help, or on key repeat.');
  }
  if (JSON.stringify(await media()) !== JSON.stringify({ voice: 'light', leveling: 'strong', bass: 'more' })) {
    fail(`Audio settings did not reach the media element: ${JSON.stringify(await media())}`);
  }

  const layout = page.locator('.picture-layout-btn');
  // Opening help closes the settings popover; restore it for the next action.
  if (!await layout.isVisible()) await gear.press('Enter');
  // The start layout depends on whether an earlier step ran with storage, so read it instead of assuming.
  const startLayout = (await layout.locator('.theater-settings-detail').innerText()).trim();
  const toggledLayout = startLayout === 'Raised' ? 'Centered' : 'Raised';
  await layout.click();
  await hud.filter({ hasText: toggledLayout }).waitFor();
  if (await shapes(hud) !== await shapes(layout)) fail('Layout HUD icon differs from its settings row.');
  await layout.click();
  await hud.filter({ hasText: startLayout }).waitFor();

  // Session cleanup must bypass gain as well as the three effects, then
  // restore the remembered boosted level without rebuilding/reloading.
  await boost.click();
  await hud.filter({ hasText: 'Volume boost: On' }).waitFor();
  await slider.evaluate((input: HTMLInputElement) => {
    input.value = '1.5';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.keyboard.press('Escape'); // Close settings.
  await exitTheater(page);
  if (JSON.stringify(await media()) !== JSON.stringify({ voice: 'off', leveling: 'off', bass: 'original' })) {
    fail('Audio settings kept processing the host player after theater exit.');
  }
  if (await video.evaluate((video: HTMLVideoElement) => video.dataset.theaterBoost) !== '1.0') fail('Volume boost kept amplifying the host player after theater exit.');
  await enterTheaterFromPicture(page);
  await page.waitForFunction(() => {
    const video = document.querySelector<HTMLVideoElement>('video#player');
    return video?.dataset.theaterLeveling === 'strong' && video.dataset.theaterBoost === '3.0000';
  });
  await gear.click();
  await boost.click();
  await hud.filter({ hasText: 'Volume boost: Off' }).waitFor();
  await page.keyboard.press('Escape'); // Close settings before restoring effects.
    await gear.click();
    // The stepper holds at the top instead of wrapping, so Off is reached by stepping down.
    await stepTo('voice', 'Voice boost', 'Strong');
    await stepTo('voice', 'Voice boost', 'Light', -1);
    await stepTo('voice', 'Voice boost', 'Off', -1);
    await stepTo('leveling', 'Reduce loud sounds', 'Light', -1);
    await stepTo('leveling', 'Reduce loud sounds', 'Off', -1);
    await stepTo('bass', 'Bass', BASS_LABELS.original, -1);
    await page.keyboard.press('Escape');
  if (await video.getAttribute('data-smoke-audio-emptied') !== '0') fail('An audio setting unnecessarily reloaded the same-origin video.');
}

export async function assertFullscreenAndHelp(page: Page): Promise<void> {
  await page.bringToFront();
  await page.locator('video#player').evaluate(async (video: HTMLVideoElement) => {
    video.srcObject = null; video.src = '/vod.webm'; video.loop = true; await video.play();
  });
  await page.locator('video#player').click();
  await page.keyboard.press('f');
  await page.waitForFunction(() => document.fullscreenElement === document.documentElement);
  await page.locator('.theater-controls-wrapper').waitFor();
  await page.keyboard.press('f');
  await page.waitForFunction(() => !document.fullscreenElement);

  await assertAudioSettings(page);
  await page.keyboard.press('h');
  const help = page.locator('.theater-help-overlay');
  await help.waitFor();
  const inspect = () => help.evaluate(overlay => {
    const grid = overlay.querySelector('.theater-help-grid')!;
    return { columns: getComputedStyle(grid).gridTemplateColumns.split(' ').length,
      rows: overlay.querySelectorAll('.theater-help-row').length,
      closeVisible: overlay.querySelector('.te-dialog-close')!.getBoundingClientRect().top >= 0 };
  });
  await page.keyboard.press('Shift+L');
  if (await page.locator('video#player').evaluate(video => getComputedStyle(video).objectPosition) !== '50% 50%') fail('Layout shortcut fired behind keyboard help.');
  const wide = await inspect();
  if (wide.columns !== 2 || wide.rows !== 31 || !wide.closeVisible) fail(`Wide keyboard help lost layout or actions: ${JSON.stringify(wide)}`);
  // Keys read as printed on the keycap: one cap per key, arrows as symbols, never browser names or capitals.
  const keys = await help.evaluate(overlay => [...overlay.querySelectorAll<HTMLElement>('.theater-help-key-wrapper')].map(wrapper => ({
    text: wrapper.innerText.replace(/\s+/g, ''),
    caps: wrapper.querySelectorAll('kbd').length,
    transform: getComputedStyle(wrapper.querySelector('kbd') ?? wrapper).textTransform
  })));
  const shown = keys.map(({ text }) => text);
  for (const expected of ['Space', '←', '→', '↑', '↓', 'Shift+T', 'W'])
    if (!shown.includes(expected)) fail(`Keyboard help does not show ${expected}: ${JSON.stringify(shown)}`);
  if (keys.some(({ text, caps, transform }) => /Arrow|Key[A-Z]|SPACE|Escape/.test(text) || caps !== text.split(/\+(?=.)/).length || transform !== 'none'))
    fail(`Keyboard help shows raw or shouted key names: ${JSON.stringify(keys)}`);
  await help.evaluate(async overlay => { await Promise.all(overlay.getAnimations({ subtree: true }).map(animation => animation.finished)); });
  if (process.env.THEATER_SMOKE_SCREENSHOT) await page.screenshot({ path: process.env.THEATER_SMOKE_SCREENSHOT.replace(/\.png$/, '-help-columns.png') });
  await page.setViewportSize({ width: 540, height: 480 });
  const narrow = await inspect();
  if (narrow.columns !== 1 || narrow.rows !== 31 || !narrow.closeVisible) fail(`Narrow help is inaccessible: ${JSON.stringify(narrow)}`);
  await page.locator('.theater-help-overlay .te-dialog-close').press('Enter');
  await help.waitFor({ state: 'detached' });
  // Control-bar tooltips use the same caps: one per key, as printed.
  await page.locator('.theater-control-btn.play-pause-btn').hover();
  const tooltip = page.locator('.theater-button-tooltip.visible');
  await tooltip.waitFor();
  const tip = await tooltip.evaluate(element => [...element.querySelectorAll('kbd')].map(kbd => `${kbd.textContent}:${getComputedStyle(kbd).textTransform}`));
  if (JSON.stringify(tip) !== JSON.stringify(['Space:none'])) fail(`Play tooltip does not show the Space cap: ${JSON.stringify(tip)}`);
  await page.mouse.move(0, 0);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.keyboard.press('Escape');
  await page.locator('.theater-controls-wrapper').waitFor({ state: 'detached' });
}

export async function assertPictureLayoutFixture(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.locator('video#player').evaluate(async (video: HTMLVideoElement) => {
    video.srcObject = null;
    video.src = '/vod.webm';
    video.loop = true;
    await video.play();
  });
  await page.keyboard.press('t');
  await page.locator('.player-settings-btn').click();
  const row = page.locator('.picture-layout-btn');
  if (await row.getAttribute('aria-keyshortcuts') !== 'Shift+L') fail('Layout shortcut is missing.');
  await page.evaluate(() => chrome.storage.sync.set({ pictureAlign: 'center', raiseOnlyWithSubtitles: false }));
  const waitPosition = (position: string) => page.waitForFunction(position =>
    getComputedStyle(document.querySelector('video#player')!).objectPosition === position, position);
  await page.waitForFunction(() => document.getElementById('theater-everywhere-ui')?.shadowRoot
    ?.querySelector('.picture-layout-btn .theater-settings-detail')?.textContent === 'Centered');
  await row.click();
  await waitPosition('50% 0%');
  if (await row.locator('.theater-settings-detail').innerText() !== 'Raised') fail('Layout click did not update the row.');
  await page.keyboard.down('Shift');
  await page.keyboard.down('l');
  await page.keyboard.down('l');
  await page.keyboard.up('l');
  await page.keyboard.up('Shift');
  await waitPosition('50% 50%');
  if (await row.locator('.theater-settings-detail').innerText() !== 'Centered') fail('Held layout shortcut toggled repeatedly.');
  await page.evaluate(() => {
    const host = document.createElement('div'); host.id = 'layout-input-test';
    const input = document.createElement('input'); host.attachShadow({ mode: 'open' }).append(input);
    document.body.append(host); input.focus();
  });
  await page.keyboard.press('Shift+L');
  if (await page.locator('video#player').evaluate(video => getComputedStyle(video).objectPosition) !== '50% 50%') fail('Layout shortcut fired in a shadow input.');
  await page.evaluate(() => document.getElementById('layout-input-test')?.remove());
  if (!await row.isVisible()) await page.locator('.player-settings-btn').click();
  const fitNext = page.locator('.video-fit-btn .theater-stepper-btn[data-direction="1"]');
  const fitPrevious = page.locator('.video-fit-btn .theater-stepper-btn[data-direction="-1"]');
  await fitNext.click();
  await row.click();
  await waitPosition('50% 50%');
  await fitNext.click();
  await waitPosition('50% 50%');
  // The stepper does not wrap: back to Fit takes two steps down.
  await fitPrevious.click();
  await fitPrevious.click();
  await waitPosition('50% 0%');
}
