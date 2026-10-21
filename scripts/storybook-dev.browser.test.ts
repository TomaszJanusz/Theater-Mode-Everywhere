import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { dirname, join } from 'node:path';
import { test } from 'node:test';

import { chromium } from 'playwright';

import { sharedTestBrowser } from '../src/test-utils/test-browser';

const browser = sharedTestBrowser(chromium);

const stories = [
  'player-auto-theater-notice--counting',
  'player-hud--playback',
  'player-title-hud--short'
];

test('Storybook dev serves bundled fonts and renders even when fonts fail or stall', { timeout: 90000 }, async t => {
  const portServer = createServer();
  portServer.listen(0, '127.0.0.1');
  await once(portServer, 'listening');
  const address = portServer.address();
  assert.ok(address && typeof address !== 'string');
  await new Promise<void>(resolve => portServer.close(() => resolve()));

  const server = spawn(process.execPath, [
    join(dirname(createRequire(import.meta.url).resolve('storybook/package.json')), 'dist/bin/dispatcher.js'),
    'dev', '--ci', '--no-open', '--host', '127.0.0.1', '--port', String(address.port), '--exact-port'
  ], { cwd: new URL('..', import.meta.url), stdio: ['ignore', 'pipe', 'pipe'] });
  const exited = once(server, 'exit');
  t.after(async () => { server.kill('SIGTERM'); await exited; });
  let output = '';
  await new Promise<void>((resolve, reject) => {
    const collect = (chunk: Buffer) => {
      output += chunk.toString();
      if (output.includes('Storybook ready!')) resolve();
    };
    server.stdout.on('data', collect);
    server.stderr.on('data', collect);
    server.once('error', reject);
    server.once('exit', () => reject(new Error(output)));
  });
  const context = await browser.newContext(t);
  const failures: string[] = [];
  for (const mode of ['normal', 'failed', 'stalled']) {
    const page = await context.newPage();
    page.on('pageerror', error => failures.push(error.message));
    if (mode === 'failed') await page.route(/\.woff2?(\?|$)/, route => route.abort());
    // Leave intercepted requests pending until page.close(), proving the loader has a bounded wait.
    if (mode === 'stalled') await page.route(/\.woff2?(\?|$)/, () => {});
    for (const id of stories) {
      await page.goto(`http://127.0.0.1:${address.port}/iframe.html?id=${id}&viewMode=story`);
      await page.waitForFunction(() => {
        const preview = (window as unknown as { __STORYBOOK_PREVIEW__?: { currentRender?: { phase?: string } } }).__STORYBOOK_PREVIEW__;
        return preview?.currentRender?.phase === 'finished';
      });
      assert.doesNotMatch(await page.locator('body').innerText(), /component failed to render/i, `${mode}: ${id}`);
      await page.waitForFunction(() => document.querySelector('#theater-everywhere-ui')?.shadowRoot?.childElementCount);
      if (mode === 'normal') {
        assert.equal(await page.evaluate(() => ['400', '500', '600', '700'].every(weight => document.fonts.check(`${weight} 16px Roboto`))), true);
      }
    }
    await page.close();
  }
  assert.deepEqual(failures, []);
  assert.doesNotMatch(output, /outside of Vite serving allow list/);
});
