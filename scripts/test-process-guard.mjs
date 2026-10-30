// Preloaded (`--import`) into every node:test file process by scripts/run-tests.mjs.
//
// It replaces `--test-force-exit`, which made the runner process exit while the reporters still held
// results from the file processes, so identical runs reported different test counts with exit code 0.
// Here a file process is allowed to end by itself; only one that is still alive a grace period after its
// tests finished is ended, and that names the handles that kept it alive. It also counts the tests that
// ran so the runner can compare them with what its reporters received.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

// The runner passes its options in the preload URL, which file processes inherit with their execArgv:
// `tally` is the directory for this file's record, `graceMs` overrides the default below.
const options = new URL(import.meta.url).searchParams;
// Far longer than flushing a finished file's last events takes, short enough to bound a hung file.
const DEFAULT_LEAK_GRACE_MS = 1000;

const stdio = new Set([process.stdin, process.stdout, process.stderr]);

function describeHandle(handle) {
  const name = handle?.constructor?.name ?? typeof handle;
  if (name === 'ChildProcess') return `ChildProcess(pid ${handle.pid}, ${handle.spawnfile})`;
  if (name === 'Server') return `Server(${JSON.stringify(handle.address?.() ?? null)})`;
  if (name === 'Socket') return handle.remoteAddress ? `Socket(${handle.remoteAddress}:${handle.remotePort})` : 'Socket(local)';
  return name;
}

// Timers are not in `_getActiveHandles()`, so they come from the resource list.
function leakedHandles() {
  const handles = process._getActiveHandles().filter(handle => !stdio.has(handle)).map(describeHandle);
  const timers = process.getActiveResourcesInfo().filter(name => name === 'Timeout').length;
  return timers > 0 ? [...handles, `Timeout x${timers}`] : handles;
}

// Only file processes started by the runner (`NODE_TEST_CONTEXT`) take part; the runner process itself loads
// this module too because it passes its own preloads on to the files.
if (process.env.NODE_TEST_CONTEXT && options.has('tally')) {
  const { after, afterEach } = await import('node:test');
  const directory = options.get('tally');
  const graceMs = Number(options.get('graceMs')) || DEFAULT_LEAK_GRACE_MS;
  const file = process.argv[1];
  let tests = 0;
  let leaks = [];

  // Root hooks run for every test body, nested ones included. Skipped tests have no body and are not counted.
  afterEach(() => { tests += 1; });

  after(() => {
    // An unref'd timer still fires while a leaked handle keeps the event loop alive, and lets a clean process end.
    setTimeout(() => {
      leaks = leakedHandles();
      if (leaks.length > 0) process.exit();
    }, graceMs).unref();
  });

  // The tally is written synchronously, so it survives the `process.exit()` above.
  process.on('exit', () => {
    writeFileSync(join(directory, `file-${process.pid}.json`), JSON.stringify({ file, tests, leaks }));
  });
}
