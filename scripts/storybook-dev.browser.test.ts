import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { stripVTControlCharacters } from 'node:util';

import { chromium, firefox } from 'playwright';

import { waitForStory } from '../.storybook/browser-navigation';
import { PLAYER_STORY } from '../.storybook/profiles';
import { sharedTestBrowser } from '../src/test-utils/test-browser';
import { testEngines } from '../src/test-utils/test-engines';

const fontStories = [
  'components-auto-theater-notice--counting',
  'components-hud--playback',
  'components-title-hud--short',
  PLAYER_STORY
];

const devStories = [...fontStories,
  'components-volume-control--open',
  'components-speed-control--open',
  'components-caption-notice--loading',
  'components-control-button-tooltip--above'
];

for (const engine of testEngines()) {
  const browser = sharedTestBrowser({ chromium, firefox }[engine]);

  test(`Storybook dev: catalog, assets, Player, font fallback and addon panel completion (${engine})`, { timeout: 120000 }, async t => {
    const portServer = createServer();
    portServer.listen(0, '127.0.0.1');
    await once(portServer, 'listening');
    const address = portServer.address();
    assert.ok(address && typeof address !== 'string');
    await new Promise<void>(resolve => portServer.close(() => resolve()));

    const server = spawn(process.execPath, [
      join(dirname(createRequire(import.meta.url).resolve('storybook/package.json')), 'dist/bin/dispatcher.js'),
      'dev', '--ci', '--no-open', '--host', '127.0.0.1', '--port', String(address.port), '--exact-port'
    ], {
      cwd: new URL('..', import.meta.url),
      // CI enables ANSI output; exercise it even when the local agent sets NO_COLOR.
      env: { ...process.env, STORYBOOK_BROWSER: engine, NO_COLOR: undefined, FORCE_COLOR: '1' },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    const exited = once(server, 'exit');
    t.after(async () => { server.kill('SIGTERM'); await exited; });
    let output = '';
    let phase = 'dev server startup';
    t.after(() => {
      if (t.signal.aborted) t.diagnostic(`Storybook timed out during ${phase}:\n${stripVTControlCharacters(output)}`);
    });
    // Use output events, including the panel's actual browser run, rather than a startup sleep.
    const progress = new EventTarget();
    const collect = (chunk: Buffer) => { output += chunk.toString(); progress.dispatchEvent(new Event('output')); };
    server.stdout.on('data', collect);
    server.stderr.on('data', collect);
    const untilOutput = (pattern: RegExp) => new Promise<void>((resolve, reject) => {
      const check = () => {
        const plain = stripVTControlCharacters(output);
        if (/No projects matched|Failed to start (?:Vitest|test runner)/.test(plain)) {
          progress.removeEventListener('output', check);
          reject(new Error(output));
        } else if (pattern.test(plain)) {
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
    const index = await indexResponse.json() as { entries: Record<string, { type: string; title: string }> };
    const stories = Object.keys(index.entries).filter(id => index.entries[id].type === 'story');
    assert.equal(stories.length, 34, '33 component stories plus Extension/Player UI');
    assert.ok(stories.includes(PLAYER_STORY));
    assert.deepEqual([...new Set(stories.map(id => index.entries[id].title))].sort(), [
      'Extension/Player UI',
      'Components/Auto-theater notice', 'Components/Caption notice', 'Components/Control button tooltip',
      'Components/HUD', 'Components/Speed control', 'Components/Stepper', 'Components/Title HUD', 'Components/Volume control'
    ].sort());

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
        phase = `${mode} fonts: ${id}`;
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
    phase = 'manager layout and settings';
    await manager.goto(`${base}/?path=/story/${PLAYER_STORY}`);
    await manager.getByRole('button', { name: 'Move addon panel to bottom', exact: true }).waitFor();
    const player = manager.frameLocator('#storybook-preview-iframe').frameLocator('iframe[title="Fixture document"]');
    await player.locator('.theater-controls-wrapper.visible').waitFor();
    await player.locator('.player-settings-btn').click();
    await player.locator('.theater-settings-menu.visible').waitFor();
    assert.equal(await player.locator('.theater-settings-body').evaluate(body => {
      const panel = body.parentElement!.getBoundingClientRect();
      return panel.top >= 0 && panel.bottom <= innerHeight && panel.left >= 0 && panel.right <= innerWidth
        && body.scrollHeight <= body.clientHeight + 1;
    }), true, 'Controls beside the player leaves the full settings menu inside a typical canvas');
    await player.locator('.player-settings-btn').click();
    await manager.getByRole('button', { name: 'Expand testing module', exact: true }).click();
    assert.equal(await manager.getByRole('checkbox', { name: 'Coverage', exact: true }).count(), 0,
      'coverage is outside the pilot and must not be offered by the addon');
    phase = 'addon panel run';
    await manager.getByRole('button', { name: 'Run tests', exact: true }).filter({ hasText: 'Run tests' }).click();
    await manager.getByRole('button', { name: 'Stop test run', exact: true }).waitFor();
    // Test output precedes coverage reporting. Only the completed manager state proves the run succeeded.
    await manager.getByRole('button', { name: 'Start test run', exact: true }).waitFor();
    await manager.getByRole('button', { name: 'Component tests passed', exact: true }).waitFor();
    assert.match(await manager.locator('body').innerText(), /Test run finished\. 34 components passed\./);
    assert.equal(await manager.getByText('View full error', { exact: true }).count(), 0);
    // The panel above is the completion contract. Vitest's terminal summary inserts ANSI
    // escapes around "34 passed" in CI, so waiting for its uncolored text never finishes.
    assert.doesNotMatch(stripVTControlCharacters(output), /No projects matched|Failed to (?:start (?:Vitest|test runner)|run tests)|Custom report|Coverage enabled|outside of Vite serving allow list/);
  });
}
