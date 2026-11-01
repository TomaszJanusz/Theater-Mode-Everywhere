import { execFileSync } from 'node:child_process';

const LONG_LIVED = ['origin/main', 'origin/dev'];

// Commits on HEAD that `ref` lacks, or undefined when the ref does not exist.
function commitsAhead(ref, cwd) {
  try {
    // eslint-disable-next-line sonarjs/no-os-command-from-path -- the same git as the other ratchet scripts, fixed arguments
    return Number(execFileSync('git', ['rev-list', '--count', 'HEAD', `^refs/remotes/${ref}`], { cwd, encoding: 'utf8', stdio: 'pipe' }));
  } catch {
    return undefined;
  }
}

// The remote ref a change is compared against: the PR's base branch in CI
// (`main` or the long-lived `dev`). Locally there is no PR, so it is the
// long-lived branch HEAD diverged from last (fewest commits since the merge
// base), so a branch cut from `dev` is not diffed against a far older `main`.
// A tie, or neither ref existing, keeps `origin/main`.
export function baseRef(env = process.env, cwd = process.cwd()) {
  const branch = env.GITHUB_BASE_REF;
  if (branch && /^[\w./-]+$/.test(branch)) return `origin/${branch}`;
  let best = 'origin/main';
  let fewest = Infinity;
  for (const ref of LONG_LIVED) {
    const ahead = commitsAhead(ref, cwd);
    if (ahead !== undefined && ahead < fewest) [best, fewest] = [ref, ahead];
  }
  return best;
}
