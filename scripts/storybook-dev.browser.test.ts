import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { dirname, join } from 'node:path';
import { test } from 'node:test';

import { chromium, firefox } from 'playwright';

import { waitForStory } from '../.storybook/browser-navigation';
import { PLAYER_STORY } from '../.storybook/profiles';
import { sharedTestBrowser } from '../src/test-utils/test-browser';
import { testEngines } from '../src/test-utils/test-engines';

const fontStories = [
  'player-auto-theater-notice--counting',
  'player-hud--playback',
  'player-title-hud--short',
  PLAYER_STORY
];

const devStories = [...fontStories,
  'player-volume-control--open',
  'player-speed-control--open',
  'player-caption-notice--loading',
  'player-control-button-tooltip--above'
];

for (const engine of testEngines()) {
  const browser = sharedTestBrowser({ chromium, firefox }[engine]);

  test(`Storybook dev: catalog, assets, Player, font fallback and addon test discovery (${engine})`, { timeout: 120000 }, async t => {
    const portServer = createServer();
    portServer.listen(0, '127.0.0.1');
    await once(portServer, 'listening');
    const address = portServer.address();
    assert.ok(address && typeof address !== 'string');
    await new Promise<void>(resolve => portServer.close(() => resolve()));

    const server = spawn(process.execPath, [
      join(dirname(createRequire(import.meta.url).resolve('storybook/package.json')), 'dist/bin/dispatcher.js'),
      'dev', '--ci', '--no-open', '--host', '127.0.0.1', '--port', String(address.port), '--exact-port'
    ], { cwd: new URL('..', import.meta.url), env: { ...process.env, STORYBOOK_BROWSER: engine }, stdio: ['ignore', 'pipe', 'pipe'] });
    const exited = once(server, 'exit');
    t.after(async () => { server.kill('SIGTERM'); await exited; });
    let output = '';
    // Use output events, including the panel's actual browser run, rather than a startup sleep.
    const progress = new EventTarget();
    const collect = (chunk: Buffer) => { output += chunk.toString(); progress.dispatchEvent(new Event('output')); };
    server.stdout.on('data', collect);
    server.stderr.on('data', collect);
    const untilOutput = (pattern: RegExp) => new Promise<void>((resolve, reject) => {
      const check = () => {
        if (/No projects matched|Failed to start (?:Vitest|test runner)/.test(output)) {
          progress.removeEventListener('output', check);
          reject(new Error(output));
        } else if (pattern.test(output)) {
          progress.removeEventListener('output', check);
          resolve();
        }
      };
      progress.addEventListener('output', check);
      server.once('error', reject);
      server.once('exit', () => reject(new Error(output)));
      check();
    });
    await untilOutput(/Storybook ready!/);
    const base = `http://127.0.0.1:${address.port}`;
    const context = await browser.newContext(t);
    const indexResponse = await context.request.get(`${base}/index.json`);
    assert.equal(indexResponse.status(), 200);
    const index = await indexResponse.json() as { entries: Record<string, { type: string }> };
    const stories = Object.keys(index.entries).filter(id => index.entries[id].type === 'story');
    assert.equal(stories.length, 28, '27 component stories plus the composed Player');
    assert.ok(stories.includes(PLAYER_STORY));

    const failures: string[] = [];
    for (const mode of ['normal', 'failed', 'stalled']) {
      const page = await context.newPage();
      const expectedFontFailure = (url: string) => mode !== 'normal' && /\.woff2?(\?|$)/.test(url);
      page.on('pageerror', error => failures.push(error.message));
      page.on('console', message => {
        // Firefox reports aborted fonts as console errors with no location; the source URL
        // lives in the diagnostic text. Only ignore fonts deliberately intercepted in this mode.
        const failedFont = /downloadable font: download failed.*source: ([^"]+)/.exec(message.text())?.[1];
        const expected = expectedFontFailure(message.location().url) || (failedFont && expectedFontFailure(failedFont));
        if (message.type() === 'error' && !expected) failures.push(message.text());
      });
      page.on('response', response => { if (response.status() >= 400) failures.push(`${response.status()} ${response.url()}`); });
      page.on('requestfailed', request => {
        if (!expectedFontFailure(request.url())) failures.push(`${request.url()}: ${request.failure()?.errorText}`);
      });
      if (mode === 'failed') await page.route(/\.woff2?(\?|$)/, route => route.abort());
      // Leave requests pending until page.close(), proving both document loaders have a bounded wait.
      if (mode === 'stalled') await page.route(/\.woff2?(\?|$)/, () => {});
      for (const id of mode === 'normal' ? devStories : fontStories) {
        await page.goto(`${base}/iframe.html?id=${id}&viewMode=story`, { waitUntil: 'domcontentloaded' });
        await waitForStory(page);
        assert.doesNotMatch(await page.locator('body').innerText(), /component failed to render/i, `${mode}: ${id}`);
        await page.waitForFunction(() => (window.__storyDocument ?? document).querySelector('#theater-everywhere-ui')?.shadowRoot?.childElementCount);
        if (id === PLAYER_STORY) {
          await page.frameLocator('iframe[title="Fixture document"]').locator('.theater-controls-wrapper.visible').waitFor();
          assert.equal(await page.evaluate(() => window.__storyDocument?.querySelector('video')?.readyState), 4, 'fixture clip decoded');
        }
        if (mode === 'normal') {
          assert.equal(await page.evaluate(() => ['400', '500', '600', '700'].every(weight => document.fonts.check(`${weight} 16px Roboto`))), true);
        }
      }
      await page.close();
    }
    assert.deepEqual(failures, []);

    // CLI --config used to hide a broken root-config discovery path. Exercise the actual dev panel.
    const manager = await context.newPage();
    await manager.goto(`${base}/?path=/story/${PLAYER_STORY}`);
    await manager.getByRole('button', { name: 'Run tests', exact: true }).filter({ hasText: 'Run tests' }).click();
    await untilOutput(/Tests\s+28 passed \(28\)/);
    assert.doesNotMatch(output, /No projects matched|Failed to start (?:Vitest|test runner)|outside of Vite serving allow list/);
  });
}
