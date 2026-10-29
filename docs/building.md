# Building

Production packages minify JavaScript and CSS with esbuild. Mozilla's source upload is a `git archive` of the release commit, and this file is in that archive. Reviewers can rebuild the submitted extension from the archive plus the lockfile.

esbuild shortens syntax, whitespace, and local identifiers, including function and class names. It leaves property names unchanged. `TME_BUILD=diagnostic` writes the same packages with minification off, which is the readable form for stack traces. Production leaves function names mangled: preserving them with esbuild `keepNames` increased page heap by about 2.6MB against mangled output on a parent document plus 12 frames.

## Requirements

- Node.js 22
- pnpm 12.14.0 (`packageManager` in `package.json`)

## Reproduce the release packages

```sh
pnpm install --frozen-lockfile
CI=true pnpm build
pnpm verify:bundles
```

`CI=true` keeps the packaged manifest version from `package.json`, or from `RELEASE_TAG` when that variable is a version. A build without `CI=true` stamps a date-based version into the packaged manifest only. The root `manifest.json` is rewritten only when `CI=true`.

Outputs:

- `dist/theater-everywhere-firefox.zip` and `dist/firefox-unpacked/`
- `dist/theater-everywhere-chrome.zip` and `dist/chrome-unpacked/`

Content scripts remain self-contained classic scripts, with no static or dynamic imports. `src/providers/*/provider.json` declares each extracted provider's hosts and MAIN/isolated entries. After editing a descriptor, run `pnpm exec tsx scripts/provider-descriptors.ts` to update the checked-in host catalog and manifest rules; builds and consistency tests reject drift. Providers not yet extracted keep their existing shared wiring.

Each world runs its shared runtime, matching provider registration, then startup, in that order within one manifest `js` array at `document_start`. The generic rules exclude extracted hosts; every frame uses its own URL. The provider receives stateful shared services through the runtime API and registers before startup, which closes registration. Missing or rejected registrations retain generic HTML5 entry. JavaScript stays private; no background loader or `scripting` permission is needed. `pnpm verify:bundles` checks the complete inventory and order in both unpacked directories; the build also rejects extracted implementations in shared bundles and duplicated runtime owners in provider bundles.

## Diagnostic build

```sh
CI=true TME_BUILD=diagnostic pnpm build
```

`pnpm build:diagnostic` is the same mode. Add `CI=true` when the packaged version should match `package.json`.

## Source archive

`node_modules/` and `dist/` are gitignored, so they are not in the archive. Install dependencies from `pnpm-lock.yaml`. The release workflow refuses to upload the archive when this file is missing.

## CI for documentation changes

The aggregate `check` job always reports on pull requests. [The classifier](../scripts/ci-changes.mjs) skips dependency installation, typechecking, tests, builds and smoke checks only when every changed path is `README.md`, `AGENTS.md`, `CLAUDE.md`, or Markdown under `docs/` except this file. Other root Markdown files and non-Markdown documentation assets conservatively run everything. Keep the allowlist in sync if tests or build scripts start reading an exempt document. After classification, static checks, unit tests and browser lanes run in parallel; one build artifact supplies bundle verification and smoke. The shared [setup action](../.github/actions/setup/action.yml) also prepares release checks.

`LICENSE` and `PRIVACY.md` are bundled into Options; `CHANGELOG.md` feeds release notes; this file is checked before the Mozilla source upload. They always run full CI, as do store listings (validated against extension locales), locales, manifests, scripts, workflow files, dependency files and unknown paths. The PR diff uses full Git history and includes both paths of renames. Missing metadata, empty diffs or classification errors run everything.

Do not filter the entire CI workflow by path: required checks would remain pending. CodeQL retains its existing advisory workflow and path filters: a no-op `Analyze` job cannot establish that the aggregate code-scanning result succeeds without uploaded analysis. The current repository rulesets require no status checks. Revisit those filters before requiring CodeQL checks. Release and privacy publishing workflows retain their existing triggers.

## Worktrees and the global virtual store

`pnpm-workspace.yaml` sets `virtualStoreType: global`. Local installs link each package from one shared tree under the pnpm store (`<store>/links`) instead of building a `node_modules/.pnpm` per checkout, so a new worktree installs from a warm store in well under a second. pnpm turns the setting off in CI, where the cache is cold, so CI behaves as before.

- **Trust boundary.** The store is writable by every project that uses it. Share it only among worktrees and agents you trust equally; give anything untrusted its own `storeDir`.
- **Cleanup.** Remove a worktree with `git worktree remove <path>`, not `rm -rf`, then run `pnpm store prune` to collect packages no registered project uses. A directory deleted by hand leaves a stale project entry, and its packages stay in the store until `git worktree prune` and another `pnpm store prune`.
- **Resolution.** Direct dependencies resolve normally from any process. Only undeclared dependencies rely on pnpm's `NODE_PATH` and import hook, which exist for processes pnpm starts (`pnpm run`, `pnpm exec`). Declare what a script imports.

## Dependency policies

These settings live in `pnpm-workspace.yaml`, each with a one-line reason there.

- `minimumReleaseAge: 4320` (3 days) keeps brand-new releases out of installs; resolution fails when no allowed version satisfies a range. For an urgent security fix, add the exact `name@version` to `minimumReleaseAgeExclude` with a comment and remove it once the release is old enough.
- `trustPolicy: no-downgrade` rejects a version whose publish trust evidence is weaker than an earlier release's. `trustPolicyExclude` currently names one types-only release without attestation; add entries only with a reason. `trustLockfile` stays off because contributors can edit the lockfile.
- `blockExoticSubdeps` rejects git repositories and direct tarball URLs in transitive dependencies (other trusted sources, such as workspace links, remain allowed), and `strictDepBuilds` rejects unreviewed build scripts. `allowBuilds` lists esbuild only; `dangerouslyAllowAllBuilds` stays off.
- `verifyDepsBeforeRun: warn` reports a stale `node_modules` instead of reinstalling it on its own.
