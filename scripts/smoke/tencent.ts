import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { FRAME_HTML, FRAME_URL, PAGE_URL, PLAYER_HTML } from '../../src/providers/tencent/test-utils/wasm-fixture';

import { extensionWorker, ROOT, type BrowserContext, type Page, type Route } from './helpers';

const ID = 'h0045v8ky1m';
const CAPTION = 'https://subtitle.tc.qq.com/fixture.vtt';
const metadata = { em: 0, sfl: { fi: [{ id: 1, lang: 'en', name: 'English', captionType: 1, url: CAPTION }] },
  vl: { vi: [{ vid: ID, ti: 'Tencent fixture episode', td: '2' }] } };
const nativeHtml = `<!doctype html><html><head><title>Native fixture</title><script>
window.earlyWrapped = !/\\[native code\\]/.test(Function.prototype.toString.call(fetch));
window.VIDEO_INFO = { vid: '${ID}' };
window.getinfo_callback_smoke = function() { window.hostCallback = true; };
const metadata = document.createElement('script'); metadata.src = 'https://play.wetv.vip/getvinfo?callback=getinfo_callback_smoke'; document.head.append(metadata);
</script></head><body><div class="txp_player"><div class="txp_videos_container">
<video muted style="width:640px;height:360px"></video></div>
<button class="txp_btn_next_u" onclick="window.nextClicks=(window.nextClicks||0)+1">Next</button></div>
<script>fetch('/fixture.webm').then(response => response.blob()).then(blob => { document.querySelector('video').src = URL.createObjectURL(blob); });</script></body></html>`;

const ready = (page: Page) => page.waitForFunction(() => document.documentElement.hasAttribute('data-theater-everywhere-entry-shortcuts'));
const entered = (page: Page) => page.locator('.theater-controls-wrapper').waitFor();
const exited = (page: Page) => page.locator('.theater-controls-wrapper').waitFor({ state: 'detached' });

/** Ask the shipped MAIN broker, never inject provider implementations. */
const probe = (page: Page): Promise<Record<string, { videoId?: string; captionTracks?: unknown[] }>> => page.evaluate(`new Promise(resolve => {
  const listener = event => {
    const detail = event.detail;
    if (detail?.requestId !== 812345) return;
    window.removeEventListener('theater-everywhere-media-probe-result', listener);
    resolve(detail.providers ?? {});
  };
  window.addEventListener('theater-everywhere-media-probe-result', listener);
  window.dispatchEvent(new CustomEvent('theater-everywhere-media-probe', { detail: JSON.stringify({ requestId: 812345 }) }));
})`);

async function assertNative(page: Page, context: BrowserContext): Promise<void> {
  for (const host of ['wetv.vip', 'wetv.vip.', 'v.qq.com']) {
    await page.goto(`https://${host}/en/play/cover/${ID}-EP1`);
    await ready(page);
    await page.waitForFunction(() => Boolean((window as unknown as { hostCallback?: boolean }).hostCallback) && (document.querySelector('video')?.readyState ?? 0) >= 2);
    assert.equal(await page.evaluate('window.earlyWrapped'), true, 'harvest must install at document_start');
    assert.equal((await probe(page)).tencent?.captionTracks?.length, 1, 'early JSONP is harvested before host execution');
    await page.keyboard.press('t');
    await entered(page);
    await page.locator('.theater-title-hud-text', { hasText: 'Tencent fixture episode' }).first().waitFor({ state: 'attached' });
    if (host === 'wetv.vip') {
      await page.locator('.cc-btn').click();
      await page.locator('.theater-cc-menu-item').filter({ hasText: 'English' }).click();
      await page.waitForFunction(() => document.documentElement.hasAttribute('data-te-tencent-captions-hidden'));
    }
    await page.locator('.playlist-next-btn').click();
    assert.equal(await page.evaluate('window.nextClicks'), 1, 'navigation comes from the registered provider');
    await page.keyboard.press('Escape');
    await exited(page);
    assert.equal(await page.evaluate(() => document.documentElement.hasAttribute('data-te-tencent-captions-hidden')), false, 'exit restores native captions');
  }
  const worker = await extensionWorker(context);
  await worker.evaluate(() => chrome.storage.sync.set({ tencentIntegrationEnabled: false }));
  await page.reload(); await ready(page);
  await page.waitForFunction(() => document.documentElement.hasAttribute('data-te-tencent-integration-off') && (document.querySelector('video')?.readyState ?? 0) >= 2);
  assert.equal((await probe(page)).tencent, null, 'RTE off denies provider metadata');
  await page.keyboard.press('t'); await entered(page);
  await page.keyboard.press('Escape'); await exited(page);
  await worker.evaluate(() => chrome.storage.sync.set({ tencentIntegrationEnabled: true }));
  for (const host of ['wetv.vip.evil.test', 'v.qq.com.evil.test', 'generic.example.test']) {
    await page.goto(`https://${host}/en/play/cover/${ID}-EP1`); await ready(page);
    await page.waitForFunction(() => (document.querySelector('video')?.readyState ?? 0) >= 2);
    assert.equal(await page.evaluate('window.earlyWrapped'), false, 'no Tencent harvest on nonmatching hosts');
    assert.equal((await probe(page)).tencent, undefined);
    await page.keyboard.press('t'); await entered(page);
    assert.equal(await page.evaluate(() => document.documentElement.classList.contains('theater-everywhere-tencent-stage')), false);
    await page.keyboard.press('Escape'); await exited(page);
  }
  // A matching child registers independently; the generic parent carries no Tencent implementation.
  await page.evaluate(url => { const iframe = document.createElement('iframe'); iframe.src = url; document.body.append(iframe); }, `https://wetv.vip/en/play/cover/${ID}-EP1`);
  const child = page.frameLocator('iframe');
  await child.locator('video').waitFor();
  const frame = page.frames().find(frame => frame.url().startsWith('https://wetv.vip/'))!;
  await frame.waitForFunction(() => document.documentElement.hasAttribute('data-theater-everywhere-entry-shortcuts') && (document.querySelector('video')?.readyState ?? 0) >= 2);
  await frame.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 't', code: 'KeyT', bubbles: true, cancelable: true })));
  await child.locator('.theater-title-hud-text', { hasText: 'Tencent fixture episode' }).first().waitFor({ state: 'attached' });
  assert.equal((await probe(page)).tencent, undefined);
}

async function assertWasm(page: Page, context: BrowserContext): Promise<void> {
  const worker = await extensionWorker(context);
  await worker.evaluate(() => chrome.storage.sync.set({ tencentIntegrationEnabled: false }));
  await page.goto(PAGE_URL); await ready(page);
  await page.keyboard.press('t'); await entered(page);
  assert.equal(await page.locator('#player').evaluate(element => element.hasAttribute('data-theater-everywhere')), true);
  assert.equal(await page.evaluate(() => document.documentElement.classList.contains('theater-everywhere-tencent-stage')), true, 'WASM stage survives RTE off');
  await page.keyboard.press(' ');
  await page.waitForFunction(() => (document.getElementById('player') as HTMLElement & { pauseCalls: number }).pauseCalls === 1);
  await page.keyboard.press('ArrowRight');
  await page.waitForFunction(() => (document.getElementById('player') as HTMLElement & { seekSets: number[] }).seekSets[0] === 15);
  await page.keyboard.press('Escape'); await exited(page);
  assert.equal(await page.locator('#chrome').evaluate(element => getComputedStyle(element).visibility), 'visible');
  const frame = page.frames().find(frame => frame.url() === FRAME_URL)!;
  await frame.waitForFunction(() => document.documentElement.hasAttribute('data-theater-everywhere-entry-shortcuts'));
  await frame.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 't', code: 'KeyT', bubbles: true, cancelable: true }))); await entered(page);
  assert.equal(await frame.evaluate(() => document.documentElement.classList.contains('theater-everywhere-html-active')), false, 'player frame delegates entry to its parent');
  await page.evaluate(() => {
    const next = document.createElement('fake-iframe-video'); next.id = 'replacement'; next.style.cssText = 'display:block;width:800px;height:450px';
    document.getElementById('player')!.replaceWith(next);
  });
  await page.waitForFunction(() => document.getElementById('replacement')?.hasAttribute('data-theater-everywhere'));
  await page.keyboard.press('Escape'); await exited(page);
}

/** Installed extension on routed synthetic players; real Tencent/WeTV accounts and streams remain unverified. */
export async function assertTencentProvider(page: Page, context: BrowserContext): Promise<void> {
  const worker = await extensionWorker(context);
  const keys = ['autoEnterTheater', 'tencentIntegrationEnabled', 'captionPreferenceByHost'];
  const saved = await worker.evaluate(keys => chrome.storage.sync.get(keys), keys);
  const media = readFileSync(path.join(ROOT, 'test/fixtures/vod.webm'));
  const hosts = /^https:\/\/(?:v\.qq\.com(?:\.evil\.test)?\.?|wetv\.vip(?:\.evil\.test)?\.?|play\.wetv\.vip|vm\.gtimg\.cn|subtitle\.tc\.qq\.com|generic\.example\.test)\//;
  const handler = async (route: Route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/fixture.webm') await route.fulfill({ contentType: 'video/webm', body: media });
    else if (url.pathname === '/getvinfo') await route.fulfill({ contentType: 'application/javascript', body: `getinfo_callback_smoke(${JSON.stringify(metadata)});` });
    else if (url.href === CAPTION) await route.fulfill({ contentType: 'text/vtt', headers: { 'access-control-allow-origin': '*' }, body: 'WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nFixture cue\n' });
    else {
      const player = url.href === PAGE_URL ? PLAYER_HTML : nativeHtml;
      await route.fulfill({ contentType: 'text/html; charset=utf-8', body: url.href === FRAME_URL ? FRAME_HTML : player });
    }
  };
  await context.route(hosts, handler);
  try {
    await worker.evaluate(() => chrome.storage.sync.set({ autoEnterTheater: false, tencentIntegrationEnabled: true }));
    await assertNative(page, context);
    await assertWasm(page, context);
    console.log('smoke Tencent: early MAIN harvest/probe, native metadata/Next, DNS dot, RTE off, generic/lookalike hosts, matching child, WASM bridge/seek/parent-frame toggle/replacement/cleanup passed (installed synthetic fixtures)');
  } finally {
    await context.unroute(hosts, handler);
    await worker.evaluate(async ({ keys, saved }) => { await chrome.storage.sync.remove(keys); await chrome.storage.sync.set(saved); }, { keys, saved });
  }
}
