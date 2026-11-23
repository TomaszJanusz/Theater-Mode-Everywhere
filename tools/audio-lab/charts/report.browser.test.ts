import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { it } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import { chromium } from 'playwright';

import { sharedTestBrowser } from '../../../src/test-utils/test-browser';
import { skipUnlessEngine } from '../../../src/test-utils/test-engines';

const shared = sharedTestBrowser(chromium);
const runCli = promisify(execFile);

it('exports standalone HTML and readable PNGs through the report CLI', { skip: skipUnlessEngine('chromium') }, async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'tme-audio-report-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const runFile = join(dir, 'manual run.json');
  const samples = Array.from({ length: 4096 }, (_, i) => 0.4 * Math.sin(i / 7) * (1 - i / 4096));
  const input = { sampleRate: 16000, channels: [samples] };
  const output = { sampleRate: 16000, channels: [samples.map((sample) => sample / 2)] };
  await writeFile(runFile, JSON.stringify({
    effect: 'Fixture', material: 'Tone decay', input, output,
    metrics: [{ id: 'tail', label: 'Tail level', unit: 'dBFS', before: -20, after: -26, higherIsBetter: false }],
  }));
  const out = join(dir, 'report output');
  const cli = fileURLToPath(new URL('./cli.ts', import.meta.url));
  await runCli(process.execPath, ['--import', 'tsx', cli, runFile, '--out', out]);

  for (const name of ['spectrogram', 'waveform', 'reverb-tail', 'metrics']) {
    const bytes = await readFile(join(out, `${name}.png`));
    assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.equal(bytes.toString('ascii', 12, 16), 'IHDR');
    assert.ok(bytes.readUInt32BE(16) >= 1000, `${name} captures the full panel width`);
    assert.ok(bytes.readUInt32BE(20) > 100, `${name} includes the panel content`);
  }

  const context = await shared.newContext(t, { colorScheme: 'dark', viewport: { width: 390, height: 844 } });
  // Everything, including the two WAVs and spectrogram rasters, is available offline.
  await context.setOffline(true);
  const page = await context.newPage();
  await page.goto(pathToFileURL(join(out, 'index.html')).href);
  assert.equal(await page.locator('h1').textContent(), 'Fixture');
  assert.ok((await page.locator('.delta.improved').textContent())?.includes('Improved'));
  assert.equal(await page.locator('#spectrogram svg image').count(), 2);
  assert.equal(await page.locator('body').evaluate((el) => getComputedStyle(el).backgroundColor), 'rgb(21, 26, 36)');
  assert.ok(await page.locator('main').evaluate((el) => el.scrollWidth <= innerWidth));
  const [before, after] = await page.locator('#spectrogram figure').all();
  assert.ok((await before.boundingBox())!.y < (await after.boundingBox())!.y, 'the comparison stacks on narrow screens');

  const durations = await page.locator('audio').evaluateAll((players) => Promise.all(players.map((el) => {
    if (!(el instanceof HTMLAudioElement)) throw new Error('Expected an audio player');
    if (el.readyState >= HTMLMediaElement.HAVE_METADATA) return el.duration;
    return new Promise<number>((resolve, reject) => {
      el.addEventListener('loadedmetadata', () => resolve(el.duration), { once: true });
      el.addEventListener('error', () => reject(new Error('Embedded audio could not be decoded')), { once: true });
      el.preload = 'metadata';
      el.load();
    });
  })));
  assert.deepEqual(durations, [0.256, 0.256]);
});
