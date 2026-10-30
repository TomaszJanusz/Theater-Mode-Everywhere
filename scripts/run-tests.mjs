import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
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

// Component tests run in Vitest browser mode (`components` project in vitest.config.ts), in the browser lane.
const isComponentTest = file => file.endsWith('.component.test.ts');

// Flags go to the runner. Other arguments select tests: an exact discovered path,
// or a substring of one (`pnpm test sponsorblock`). `--` separators are ignored.
export function isBrowserTest(file) {
  return file.endsWith('.browser.test.ts') || isComponentTest(file)
    || /(?:from\s*|import\s*\()\s*['"]playwright['"]/.test(readFileSync(file, 'utf8'));
}

export function planRun(discovered, args, classify = file => file.endsWith('.browser.test.ts') || isComponentTest(file)) {
  const flags = [];
  const selectors = [];
  let lane = 'all';
  for (const arg of args) {
    if (arg === '--') continue;
    if (arg.startsWith('--lane=')) { lane = arg.slice(7); continue; }
    (arg.startsWith('-') ? flags : selectors).push(arg);
  }
  if (!['all', 'unit', 'browser'].includes(lane)) throw new Error(`Unknown test lane: ${lane}`);
  const laneFiles = discovered.filter(file => lane === 'all' || (lane === 'browser') === classify(file));
  const files = selectors.length === 0
    ? laneFiles
    : laneFiles.filter(file => selectors.some(selector => file === selector || file.includes(selector)));
  if (selectors.length > 0 && files.length === 0) throw new Error(`No test file matches: ${selectors.join(' ')}`);
  return {
    // Plain-JS tests need no TypeScript loader; component tests need Vitest; everything else runs under tsx.
    node: { files: files.filter(file => file.endsWith('.mjs')), flags },
    tsx: { files: files.filter(file => !file.endsWith('.mjs') && !isComponentTest(file)), flags },
    vitest: { files: files.filter(isComponentTest), flags: vitestFlags(flags) },
  };
}

// node:test flags with a Vitest equivalent are translated; the rest only concern node:test.
export function vitestFlags(flags) {
  return flags.flatMap(flag => {
    const [, name, value] = /^(--[\w-]+)=(.*)$/s.exec(flag) ?? [];
    if (name === '--test-name-pattern') return ['-t', value];
    // A shard can hold no component file; that is not a failure.
    if (name === '--test-shard') return [`--shard=${value}`, '--passWithNoTests'];
    return [];
  });
}

// Run tsx through its JS entry with the current node binary: forwarded arguments
// reach the child as argv and never pass through a shell (no `.cmd` shim on Windows).
function tsxEntry() {
  const manifest = createRequire(import.meta.url).resolve('tsx/package.json');
  const bin = JSON.parse(readFileSync(manifest, 'utf8')).bin;
  return join(dirname(manifest), typeof bin === 'string' ? bin : bin.tsx);
}

function vitestEntry() {
  const manifest = createRequire(import.meta.url).resolve('vitest/package.json');
  const bin = JSON.parse(readFileSync(manifest, 'utf8')).bin;
  return join(dirname(manifest), typeof bin === 'string' ? bin : bin.vitest);
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

function runTsxTests(spawn, plan, root, reportDirectory) {
  // Static-preview tests need a fresh production Storybook, including in selected CI lanes.
  // Build once before starting test workers so parallel files cannot race over the output.
  if (plan.files.some(file => /from\s*['"]\.\.\/\.storybook\/static-server(?:\.ts)?['"]/.test(readFileSync(join(root, file), 'utf8')))) {
    const manifest = createRequire(import.meta.url).resolve('storybook/package.json');
    const result = spawn(process.execPath, [join(dirname(manifest), 'dist/bin/dispatcher.js'), 'build', '--output-dir', 'output/storybook-static'], { cwd: root, stdio: 'inherit' });
    if (result.error) throw result.error;
    if (result.status !== 0) return result.status ?? 1;
  }
  return runNodeTests(spawn, [tsxEntry(), '--test', '--test-concurrency=2'], plan, { label: 'tsx', reportDirectory });
}

function runVitestTests(spawn, plan, reportDirectory) {
  const reporters = reportDirectory
    ? ['--reporter=default', '--reporter=junit', `--outputFile.junit=${join(reportDirectory, 'vitest.xml')}`]
    : [];
  if (reportDirectory) mkdirSync(reportDirectory, { recursive: true });
  return run(spawn, [vitestEntry(), 'run', '--config', 'vitest.config.ts', '--project', 'components', ...reporters, ...plan.flags, ...plan.files], 'Vitest');
}

// Never `--test-force-exit`: it ends the runner while the reporters still hold results from the file
// processes, so a run reported a random subset of its tests with exit code 0. The guard preloaded into each file
// process ends one that a leaked handle keeps alive, and counts the tests that ran; the tally reporter counts the
// ones that reached the reporters. See scripts/test-process-guard.mjs.
const GUARD = new URL('./test-process-guard.mjs', import.meta.url);
const TALLY_REPORTER = new URL('./test-tally-reporter.mjs', import.meta.url).href;
const TALLY_REPORTED = 'reported.json';

function reporterFlags(name, directory, tally) {
  const flags = ['--test-reporter=spec', '--test-reporter-destination=stdout'];
  if (directory) {
    mkdirSync(directory, { recursive: true });
    flags.push('--test-reporter=junit', `--test-reporter-destination=${join(directory, name + '.xml')}`);
  }
  return [...flags, `--test-reporter=${TALLY_REPORTER}`, `--test-reporter-destination=${join(tally, TALLY_REPORTED)}`];
}

// Runs one node:test group; `lead` holds the arguments that precede its flags.
function runNodeTests(spawn, lead, plan, { label, reportDirectory }) {
  const tally = mkdtempSync(join(tmpdir(), 'tme-test-tally-'));
  try {
    const guard = new URL(GUARD);
    guard.searchParams.set('tally', tally);
    const status = run(spawn, [...lead, `--import=${guard.href}`, ...reporterFlags(label.toLowerCase(), reportDirectory, tally), ...plan.flags, ...plan.files], label);
    return verifyTally(tally, status) ?? status;
  } finally {
    rmSync(tally, { recursive: true, force: true });
  }
}

// `ran` maps each test file to the number of test bodies its process ran, `reported` to the number the reporters
// received (null when the reporters never finished). Returns what is missing, empty when the run is complete.
export function tallyProblems(ran, reported, status) {
  const total = [...ran.values()].reduce((sum, count) => sum + count, 0);
  if (reported === null) return total > 0 ? [`the reporters wrote no tally, but ${total} tests ran`] : [];
  const problems = [];
  for (const [file, count] of ran) {
    const received = reported[file] ?? 0;
    // After a failure the reporters may add entries for files that crashed; a green run has to match exactly.
    if (received < count || (status === 0 && received > count)) problems.push(`${file}: ${count} tests ran, ${received} reached the reporters`);
  }
  if (status === 0) {
    for (const file of Object.keys(reported)) if (!ran.has(file)) problems.push(`${file}: reported, but its process left no record`);
  }
  return problems;
}

function verifyTally(directory, status) {
  const records = readdirSync(directory).filter(name => name.startsWith('file-'))
    .map(name => JSON.parse(readFileSync(join(directory, name), 'utf8')));
  const reportedPath = join(directory, TALLY_REPORTED);
  const reportedText = existsSync(reportedPath) ? readFileSync(reportedPath, 'utf8') : '';
  const problems = tallyProblems(
    new Map(records.map(record => [record.file, record.tests])),
    reportedText === '' ? null : JSON.parse(reportedText),
    status,
  );
  for (const { file, leaks } of records) {
    if (leaks.length === 0) continue;
    const handles = leaks.join(', ');
    console.warn(`${relative(process.cwd(), file)} left handles alive after its tests finished (${handles}); the runner ended it. Close or unref them where the test creates them.`);
  }
  if (problems.length === 0) return undefined;
  console.error(['Test results were lost between the test files and the reporters:', ...problems.map(problem => '  ' + problem)].join('\n'));
  return status || 1;
}

export function main(args, root = fileURLToPath(new URL('..', import.meta.url)), spawn = spawnSync) {
  let plan;
  const reportArg = args.find(arg => arg.startsWith('--report-dir='));
  const reportDirectory = reportArg?.slice('--report-dir='.length);
  if (reportArg) args = args.filter(arg => arg !== reportArg);
  try {
    let discovered = discoverTests(root);
    const selectionArg = args.find(arg => arg.startsWith('--files-from='));
    if (selectionArg) {
      args = args.filter(arg => arg !== selectionArg);
      try {
        const selection = JSON.parse(readFileSync(join(root, selectionArg.slice(13)), 'utf8'));
        if (!Array.isArray(selection.files) || selection.total !== discovered.length
          || selection.files.some(file => typeof file !== 'string' || !discovered.includes(file))
          || new Set(selection.files).size !== selection.files.length) throw new Error('Invalid or stale selection');
        discovered = selection.files;
      } catch (error) {
        const message = `Test selection unavailable (${error.message}); running all tests in this lane.`;
        console.warn(message);
        if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\n${message}\n\n${discovered.map(file => '- `' + file + '`').join('\n')}\n`);
      }
    }
    plan = planRun(discovered, args, file => isBrowserTest(join(root, file)));
  } catch (error) {
    console.error(error.message);
    return 1;
  }
  // Groups run in order and stop at the first failure.
  const groups = [
    [plan.node, () => runNodeTests(spawn, ['--test'], plan.node, { label: 'Node', reportDirectory })],
    [plan.tsx, () => runTsxTests(spawn, plan.tsx, root, reportDirectory)],
    [plan.vitest, () => runVitestTests(spawn, plan.vitest, reportDirectory)],
  ];
  for (const [group, start] of groups) {
    if (group.files.length === 0) continue;
    const status = start();
    if (status !== 0) return status;
  }
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2));
}
