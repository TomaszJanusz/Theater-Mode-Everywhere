// The remote ref a change is compared against: the PR's base branch in CI
// (`main` or the long-lived `dev`), `origin/main` otherwise.
export function baseRef(env = process.env) {
  const branch = env.GITHUB_BASE_REF;
  return branch && /^[\w./-]+$/.test(branch) ? `origin/${branch}` : 'origin/main';
}
