import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { chromium } from 'playwright';
import { emitStorageChange, installChromeStub } from './chrome-stub';
import { bundleModules, bundlePlayer } from './player-boot';
import { sharedTestBrowser } from './test-browser';

describe('player boot helpers', () => {
  const shared = sharedTestBrowser(chromium);

  it('caches one bundle per entry set and global name', () => {
    assert.equal(bundlePlayer(), bundlePlayer());
    assert.notEqual(bundlePlayer(), bundlePlayer(["export { playbackWindow } from './playback-window';"]));
    const entry = ["export * from './ui/time-readout';"];
    assert.equal(bundleModules(entry, 'A'), bundleModules(entry, 'A'));
    assert.notEqual(bundleModules(entry, 'A'), bundleModules(entry, 'B'));
  });

  it('stubs chrome.storage areas with callback and promise reads, writes that notify, only the surface production uses, and manual notifications', async t => {
    const page = await (await shared.newContext(t)).newPage();
    await page.goto('about:blank');
    await installChromeStub(page, { sync: { a: 1 }, local: { b: 2 } });
    await page.evaluate(`window.seen = []; chrome.storage.onChanged.addListener((changes, area) => window.seen.push([area, changes]));`);
    const read = await page.evaluate(`(async () => {
      const viaCallback = await new Promise(resolve => chrome.storage.sync.get(null, resolve));
      return { viaCallback, viaPromise: await chrome.storage.local.get('b'), session: chrome.storage.session, surface: Object.keys(chrome.storage.sync).sort() };
    })()`);
    assert.deepEqual(read, { viaCallback: { a: 1 }, viaPromise: { b: 2 }, session: undefined, surface: ['get', 'set'] });

    await page.evaluate(`chrome.storage.sync.set({ a: 3, c: 4 })`);
    await page.waitForFunction('window.seen.length === 1');
    assert.deepEqual(await page.evaluate('window.seen'), [['sync', { a: { oldValue: 1, newValue: 3 }, c: { newValue: 4 } }]]);
    assert.deepEqual(await page.evaluate(`chrome.storage.sync.get()`), { a: 3, c: 4 });

    await emitStorageChange(page, { x: { newValue: 'y' } }, 'local');
    assert.deepEqual(await page.evaluate('window.seen.at(-1)'), ['local', { x: { newValue: 'y' } }]);
  });
});
