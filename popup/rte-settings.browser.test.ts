import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { it } from 'node:test';

import { chromium, firefox, type Page } from 'playwright';

import { MEDIA_PROVIDER_IDS, MEDIA_PROVIDER_FLAG_KEYS, resolveMediaProviderFlags } from '../src/media-features/provider-flags';
import { providerDefinition } from '../src/providers/registry';
import { bundleModules } from '../src/test-utils/player-boot';
import { readStylesheet } from '../src/test-utils/styles';
import { sharedTestBrowser } from '../src/test-utils/test-browser';
import { selectTestEngines } from '../src/test-utils/test-engines';

const html = readFileSync(new URL('./popup.html', import.meta.url), 'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '').replace(/<link\b[^>]*>/g, '');
const css = readStylesheet(new URL('./popup.css', import.meta.url));
const bundle = bundleModules(["import { setupPopupRte } from '../popup/rte-settings'; window.stopRte = setupPopupRte(window.host);"]);

type Harness = {
  host: string;
  data: Record<string, unknown>;
  writes: Record<string, unknown>[];
  external(update: Record<string, unknown>, area?: string): void;
  stopRte(): void;
  fail: boolean;
  release(): void;
  listeners: Set<unknown>;
};
async function open(page: Page, host: string, initial: Record<string, unknown> = {}, delayed = false) {
  await page.setContent(html);
  await page.addStyleTag({ content: css });
  await page.addScriptTag({ content: 'window.__name = fn => fn;' });
  await page.evaluate(({ host, initial, delayed }) => {
    const state = window as unknown as Harness;
    state.host = host;
    state.data = initial;
    state.writes = [];
    state.fail = false;
    const listeners = new Set<(changes: Record<string, { newValue: unknown }>, area: string) => void>();
    state.listeners = listeners;
    state.external = (update, area = 'sync') => {
      if (area === 'sync') Object.assign(state.data, update);
      for (const listener of listeners) listener(Object.fromEntries(Object.entries(update).map(([key, newValue]) => [key, { newValue }])), area);
    };
    Object.assign(window, { chrome: { storage: {
      sync: {
        get: async () => { const snapshot = { ...state.data }; if (delayed) await new Promise<void>(resolve => { state.release = resolve; }); return snapshot; },
        set: async (update: Record<string, unknown>) => { if (state.fail) throw new Error('write failed'); state.writes.push(update); state.external(update); }
      },
      onChanged: { addListener: (fn: typeof listeners extends Set<infer T> ? T : never) => listeners.add(fn), removeListener: (fn: typeof listeners extends Set<infer T> ? T : never) => listeners.delete(fn) }
    } } });
  }, { host, initial, delayed });
  await page.addScriptTag({ content: bundle });
}
const toggle = '#rich-theater-experience-toggle';
for (const [name, engine] of selectTestEngines(Object.entries({ chromium, firefox }), ([name]) => name)) {
  const shared = sharedTestBrowser(engine);
  it(`popup resolves services, isolates writes and follows live settings (${name})`, { timeout: 45000 }, async t => {
    const page = await (await shared.newContext(t, { viewport: { width: 360, height: 480 } })).newPage();
    const hosts = ['www.youtube.com', 'player.vimeo.com', 'www.patreon.com', 'player.twitch.tv', 'www.disneyplus.com', 'www.netflix.com', 'www.bilibili.com', 'www.bilibili.tv', 'wetv.vip', 'static.crunchyroll.com'];
    for (const [index, id] of MEDIA_PROVIDER_IDS.entries()) {
      assert.equal(providerDefinition(id).matchesHost(hosts[index]), true);
      await open(page, hosts[index], { youtubeIntegrationEnabled: false, [MEDIA_PROVIDER_FLAG_KEYS[id]]: true });
      await page.waitForFunction(selector => !(document.querySelector(selector) as HTMLInputElement).disabled, toggle);
      assert.equal(await page.locator(toggle).isChecked(), true, 'service state wins over mixed All services state');
      await page.locator('#rich-theater-experience-card .switch').click();
      assert.deepEqual(await page.evaluate(() => (window as unknown as Harness).writes), [{ [MEDIA_PROVIDER_FLAG_KEYS[id]]: false }]);
      await page.evaluate(key => (window as unknown as Harness).external({ [key]: true }), MEDIA_PROVIDER_FLAG_KEYS[id]);
      assert.equal(await page.locator(toggle).isChecked(), true);
    }
    await open(page, 'example.com');
    assert.equal(await page.locator('#rich-theater-experience-card').isVisible(), false, 'generic pages do not control embedded services');
    assert.equal(await page.locator(toggle).isDisabled(), true);

    await open(page, 'youtube-nocookie.com', { youtubeIntegrationEnabled: false }, true);
    await page.evaluate(() => { const state = window as unknown as Harness; state.external({ youtubeIntegrationEnabled: true }); state.release(); });
    await page.waitForFunction(selector => !(document.querySelector(selector) as HTMLInputElement).disabled, toggle);
    assert.equal(await page.locator(toggle).isChecked(), true, 'late snapshot cannot undo storage event');
    await page.evaluate(() => (window as unknown as Harness).external({ youtubeIntegrationEnabled: undefined }));
    assert.equal(await page.locator(toggle).isChecked(), true, 'removal uses shared default');
    await page.evaluate(() => { const state = window as unknown as Harness; state.fail = true; });
    await page.locator('#rich-theater-experience-card .switch').click();
    await page.waitForFunction(selector => !(document.querySelector(selector) as HTMLInputElement).disabled, toggle);
    assert.equal(await page.locator(toggle).isChecked(), true, 'failed writes restore persisted state');
    await page.evaluate(() => (window as unknown as Harness).stopRte());
    assert.equal(await page.evaluate(() => (window as unknown as Harness).listeners.size), 0);

    const legacy = Object.fromEntries(MEDIA_PROVIDER_IDS.slice(0, 5).map(id => [MEDIA_PROVIDER_FLAG_KEYS[id], false]));
    await open(page, 'youtube.com', legacy);
    await page.waitForFunction(selector => !(document.querySelector(selector) as HTMLInputElement).disabled, toggle);
    await page.locator('#rich-theater-experience-card .switch').click();
    const saved = await page.evaluate(() => (window as unknown as Harness).data);
    assert.deepEqual(resolveMediaProviderFlags(saved), { ...Object.fromEntries(MEDIA_PROVIDER_IDS.map(id => [id, false])), youtube: true });

    await open(page, 'youtube.com', {}, true);
    await page.evaluate(() => { const state = window as unknown as Harness; state.stopRte(); state.release(); });
    assert.equal(await page.locator(toggle).isDisabled(), true, 'cleanup rejects pending initialization');
  });
}
