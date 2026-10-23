import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { describe, it } from 'node:test';
import { chromium, type BrowserType } from 'playwright';
import { sharedTestBrowser } from './test-browser';

for (const fixture of ['browser-timeout', 'shared-browser-timeout']) it(`${fixture}: timeout fails and exits without an orphan transport`, { timeout: 45_000 }, async t => {
  if (!existsSync(chromium.executablePath())) { t.skip('Chromium is not installed'); return; }
  const env = { ...process.env };
  // The child is an independent runner, rather than another worker of this test.
  delete env.NODE_TEST_CONTEXT;
  const child = spawn(process.execPath, ['--import', 'tsx', '--test',
    new URL(`../../test/fixtures/${fixture}.mjs`, import.meta.url).pathname], {
    env, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe']
  });
  let output = '';
  child.stdout.on('data', data => { output += data; });
  child.stderr.on('data', data => { output += data; });
  const kill = () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    // On Unix the child runner and its browser belong to our own process group.
    if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGKILL');
    else child.kill('SIGKILL');
  };
  t.after(kill);
  let killed = false;
  const deadline = setTimeout(() => { killed = true; kill(); }, 30_000);
  const result = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code, signal) => resolve({ code, signal }));
  }).finally(() => clearTimeout(deadline));
  assert.equal(killed, false, output);
  assert.equal(result.signal, null, output);
  assert.equal(result.code, 1, output);
  assert.match(output, /pending-evaluation-started/);
  assert.match(output, /test timed out after (?:100|1000)ms/);
  assert.match(output, /timeout-browser-disconnected/);
  if (fixture === 'shared-browser-timeout') {
    assert.match(output, /timeout-context-closed/);
    assert.match(output, /shared-browser-survived-timeout/);
  }
});

const shared = sharedTestBrowser(chromium);
it('shared browser contexts isolate cookies, local storage, routes and pages', { timeout: 30_000 }, async t => {
  const first = await shared.newContext(t);
  const second = await shared.newContext(t);
  assert.equal(first.browser(), second.browser(), 'the browser process is reused');
  await first.addCookies([{ name: 'session', value: 'first', url: 'https://fixture.test/' }]);
  await first.route('**/*', route => route.fulfill({ body: '<title>first</title>' }));
  await second.route('**/*', route => route.fulfill({ body: '<title>second</title>' }));
  const a = await first.newPage();
  const b = await second.newPage();
  await a.goto('https://fixture.test/');
  await a.evaluate(() => localStorage.setItem('session', 'first'));
  await b.goto('https://fixture.test/');
  assert.equal(await b.title(), 'second');
  assert.equal(await b.evaluate(() => localStorage.getItem('session')), null);
  assert.deepEqual(await second.cookies(), []);
  await first.close();
  assert.equal(b.isClosed(), false);
  assert.equal(await b.title(), 'second');
});

const closed: string[] = [];
const healthy = { launch: async () => ({ newContext: async () => ({ close: async () => undefined }), close: async () => { closed.push('healthy'); } }) } as unknown as BrowserType;
const missing = { launch: async () => { throw new Error('browserType.launch: Executable does not exist'); } } as unknown as BrowserType;

// A lane can lack one engine (the Firefox job once installed only Firefox). The failed launch must be
// reported to the tests that asked for it, and must not abort teardown of the browsers that did start:
// a Firefox left running keeps the test process alive until the CI step times out and the report is lost.
describe('sharedTestBrowser teardown', () => {
  const unavailable = sharedTestBrowser(missing);
  const available = sharedTestBrowser(healthy);

  it('reports the launch error to every test that needs the missing engine', async t => {
    await assert.rejects(unavailable.newContext(t), /Executable does not exist/);
    await assert.rejects(unavailable.newContext(t), /Executable does not exist/);
    await available.newContext(t);
  });
});

describe('after a sibling suite lost an engine', () => {
  it('closed the browsers that did launch', () => {
    assert.deepEqual(closed, ['healthy']);
  });
});
