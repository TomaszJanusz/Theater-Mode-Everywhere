import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// Only reviewed prose and repo-hosting config are exempt. LICENSE and PRIVACY.md are bundled into
// Options; CHANGELOG.md and docs/building.md are release inputs; translation-issue.yml is read by a
// test. Unknown paths run CI.
const EXEMPT_FILES = new Set([
  'README.md', 'AGENTS.md', 'CLAUDE.md', '.coderabbit.yaml', '.github/pull_request_template.md',
  '.github/ISSUE_TEMPLATE/bug_report.yml', '.github/ISSUE_TEMPLATE/feature_request.yml', '.github/ISSUE_TEMPLATE/config.yml',
]);

export function shouldRunChecks(files) {
  if (!Array.isArray(files) || files.length === 0) return true;
  return files.some(file => {
    if (typeof file !== 'string' || !file || file.split('/').some(part => !part || part === '.' || part === '..')) return true;
    if (EXEMPT_FILES.has(file)) return false;
    return !(file.startsWith('docs/') && file.endsWith('.md') && file !== 'docs/building.md');
  });
}

// Deliberately broad: shared browser infrastructure and build/world boundaries
// warrant the full Firefox matrix. UI/provider-only changes use Chromium on PRs.
export function shouldRunFirefox(files) {
  if (!Array.isArray(files) || files.length === 0) return true;
  return files.some(file => typeof file !== 'string' || !file ||
    file.split('/').some(part => !part || part === '.' || part === '..') ||
    ['manifest.json', 'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'tsconfig.json'].includes(file) ||
    ['src/platform/', 'src/protocol/', 'src/test-utils/', 'test/', 'scripts/', '.github/actions/', '.github/ci-image/', '.github/workflows/'].some(prefix => file.startsWith(prefix)));
}

export function checksForEvent(eventName, event, git = execFileSync, classify = shouldRunChecks) {
  if (eventName !== 'pull_request') return true;
  try {
    const base = event?.pull_request?.base?.sha;
    if (typeof base !== 'string' || !/^[a-f0-9]{40}$/.test(base)) return true;
    // Checkout fetches full history, including the PR merge commit and base.
    // Disable rename detection so moving a code input into docs cannot hide it.
    const diff = git('git', ['diff', '--name-only', '--no-renames', '-z', `${base}...HEAD`, '--'], { encoding: 'utf8' });
    if (typeof diff !== 'string' || !diff.endsWith('\0')) return true;
    return classify(diff.slice(0, -1).split('\0'));
  } catch {
    return true;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let run = true;
  let firefox = true;
  try {
    const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
    run = checksForEvent(process.env.GITHUB_EVENT_NAME, event);
    firefox = checksForEvent(process.env.GITHUB_EVENT_NAME, event, execFileSync, shouldRunFirefox);
  } catch {
    console.warn('Could not determine changed files; running all checks.');
  }
  console.log(run ? 'Running all CI checks.' : 'Only reviewed documentation changed; skipping expensive CI steps.');
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `run=${run}\nfirefox=${firefox}\n`);
}
