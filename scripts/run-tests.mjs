import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Discovery is the registry: every `*.test.{ts,mjs}` outside the skipped
// directories runs, so adding a test never requires editing package.json.
// Skip generated or vendored trees only; a test must never be excluded by omission.
const SKIPPED_DIRS = new Set(['node_modules', 'dist', 'coverage']);
const TEST_FILE = /\.test\.(?:ts|mjs)$/;

export function discoverTests(root) {
  const found = [];
  const walk = dir => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || SKIPPED_DIRS.has(entry.name)) continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile() && TEST_FILE.test(entry.name)) found.push(relative(root, path).split(sep).join('/'));
    }
  };
  walk(root);
  return found.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

// Flags go to the runner. Other arguments select tests: an exact discovered path,
// or a substring of one (`pnpm test sponsorblock`). `--` separators are ignored.
export function planRun(discovered, args) {
  const flags = [];
  const selectors = [];
  for (const arg of args) {
    if (arg === '--') continue;
    (arg.startsWith('-') ? flags : selectors).push(arg);
  }
  const files = selectors.length === 0
    ? discovered
    : discovered.filter(file => selectors.some(selector => file === selector || file.includes(selector)));
  if (selectors.length > 0 && files.length === 0) throw new Error(`No test file matches: ${selectors.join(' ')}`);
  return {
    // Plain-JS tests need no TypeScript loader; everything else runs under tsx.
    node: { files: files.filter(file => file.endsWith('.mjs')), flags },
    tsx: { files: files.filter(file => !file.endsWith('.mjs')), flags },
  };
}

// Run tsx through its JS entry with the current node binary: forwarded arguments
// reach the child as argv and never pass through a shell (no `.cmd` shim on Windows).
function tsxEntry() {
  const manifest = createRequire(import.meta.url).resolve('tsx/package.json');
  const bin = JSON.parse(readFileSync(manifest, 'utf8')).bin;
  return join(dirname(manifest), typeof bin === 'string' ? bin : bin.tsx);
}

function run(spawn, args, label) {
  const result = spawn(process.execPath, args, { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    console.error(`${label} tests failed.`);
    return result.status ?? 1;
  }
  return 0;
}

export function main(args, root = fileURLToPath(new URL('..', import.meta.url)), spawn = spawnSync) {
  let plan;
  try {
    plan = planRun(discoverTests(root), args);
  } catch (error) {
    console.error(error.message);
    return 1;
  }
  if (plan.node.files.length > 0) {
    const status = run(spawn, ['--test', ...plan.node.flags, ...plan.node.files], 'Node');
    if (status !== 0) return status;
  }
  if (plan.tsx.files.length > 0) {
    return run(spawn, [tsxEntry(), '--test', '--test-concurrency=2', ...plan.tsx.flags, ...plan.tsx.files], 'tsx');
  }
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2));
}
