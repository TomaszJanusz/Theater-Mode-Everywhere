import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

/**
 * A throwaway repository whose `origin/main` records `baseSource` at `path`, with this branch's own
 * (possibly raised) `branchSource` committed on top. Mirrors a PR that edits a ratchet baseline.
 */
export function repoWithBase(path: string, baseSource: string, branchSource: string): string {
  const directory = mkdtempSync(join(tmpdir(), 'ratchet-base-'));
  // The tests run git from the developer's PATH, as the other git-based script tests do; the arguments are fixed.
  // eslint-disable-next-line sonarjs/no-os-command-from-path -- test fixture shells out to git on purpose
  const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], { cwd: directory, stdio: 'pipe' });
  const write = (source: string) => {
    mkdirSync(join(directory, dirname(path)), { recursive: true });
    writeFileSync(join(directory, path), source);
    git('add', '-A');
    git('commit', '--quiet', '--allow-empty', '-m', 'baseline');
  };
  git('init', '--quiet');
  write(baseSource);
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  write(branchSource);
  return directory;
}
