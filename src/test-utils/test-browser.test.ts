import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { it } from 'node:test';
import { chromium } from 'playwright';

it('a timeout with a pending browser evaluation fails and exits without an orphan transport', { timeout: 45_000 }, async t => {
  if (!existsSync(chromium.executablePath())) { t.skip('Chromium is not installed'); return; }
  const env = { ...process.env };
  // The child is an independent runner, rather than another worker of this test.
  delete env.NODE_TEST_CONTEXT;
  const child = spawn(process.execPath, ['--import', 'tsx', '--test',
    new URL('../../test/fixtures/browser-timeout.mjs', import.meta.url).pathname], {
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
  assert.match(output, /test timed out after 100ms/);
  assert.match(output, /timeout-browser-disconnected/);
});
