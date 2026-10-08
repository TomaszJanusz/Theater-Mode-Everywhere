import { firefox } from 'playwright';
import { writeFileSync } from 'node:fs';

// Native YouTube comparison, with no extension. Run from the repository root.
const url = process.argv[2] ?? 'https://www.youtube.com/watch?v=ORf39npHolQ';
const browser = await firefox.launch({ headless: false,
  firefoxUserPrefs: { 'media.autoplay.default': 0, 'media.autoplay.blocking_policy': 0 } });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'en-US' });
page.setDefaultTimeout(15000);
const report = { at: new Date().toISOString(), url, addonInstalled: false, firefoxAutoplayAllowed: true };
const snapshot = () => page.evaluate(() => {
  const video = document.querySelector('video'), player = document.querySelector('#movie_player');
  return { ua: navigator.userAgent, time: video?.currentTime, duration: video?.duration,
    readyState: video?.readyState, paused: video?.paused, playerClasses: player?.className,
    adState: player?.getAdState?.(), error: document.querySelector('.ytp-error-content-wrap')?.innerText };
});
try {
  await page.goto(url, { waitUntil: 'commit', timeout: 45000 });
  await page.waitForFunction(() => document.querySelector('video')?.readyState === 4);
  const consent = page.locator('button').filter({ hasText: /^(Reject all|Accept all)$/ }).first();
  await consent.waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
  if (await consent.isVisible().catch(() => false)) {
    await consent.click();
    await consent.waitFor({ state: 'hidden' });
  }
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.querySelector('video')?.readyState === 4);
  if (await page.evaluate(() => document.querySelector('video').paused)) await page.locator('.ytp-play-button').click();
  await page.waitForFunction(() => !document.querySelector('video').paused);
  report.before = await snapshot();
  const bar = page.locator('.ytp-progress-bar');
  await page.mouse.move(700, 400);
  const bounds = await bar.boundingBox();
  report.target = 300;
  await bar.click({ position: { x: bounds.width * report.target / report.before.duration, y: bounds.height / 2 } });
  await page.waitForTimeout(10000);
  report.after = await snapshot();
  report.status = report.after.readyState === 4 && Math.abs(report.after.time - report.target) < 15
    ? 'native seek completed' : 'native seek did not finish buffering within 10 seconds';
} catch (error) {
  report.error = String(error);
  report.after = await snapshot().catch(() => null);
} finally {
  await browser.close();
  writeFileSync('docs/research/screenshots/current/firefox-native-youtube-replay-baseline.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
}
