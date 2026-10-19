# Local browser tests

Install the dependencies and the browser builds expected by the lockfile:

```sh
pnpm install
pnpm exec playwright install chromium firefox
```

Browser tests (`*.browser.test.ts`) run through `pnpm test` or individually with
`pnpm exec tsx --test <test-file>`. `pnpm test` discovers test files by name
(`scripts/run-tests.mjs`); `pnpm test <path-or-substring> [--test-name-pattern=…]`
runs a subset. Build before running `pnpm smoke:firefox`
or `pnpm smoke:chromium`. The [Firefox smoke script](../scripts/smoke.ts) reports
whether it exercised a sideloaded extension or its fallback diagnostic with
injected bundles. A fallback pass verifies bundled player behavior, but does
not verify Firefox extension installation, permissions, or the background script.

## Deterministic waits

Wait for observable DOM/media state; use fake timers or `page.clock` for deadlines.
`scripts/test-determinism.test.ts` scans tests, `src/test-utils/**`, `tools/**`,
`scripts/smoke*.ts` and `scripts/smoke/**/*.ts`,
including serialized browser code. Its textual rules conservatively count timers,
frames, sleep helpers, timer imports and named retry loops, including mocks and
watchdogs; review clock ownership and aliases separately. Per-file/per-kind counts
must match `scripts/test-determinism-baseline.json` and cannot grow past the
baseline at the merge base with `origin/main`. CI requires that ref and full history;
locally a missing ref logs a skipped history comparison while inventory checks still run.
After removing calls, run `pnpm exec tsx scripts/test-determinism.ts --update`;
it only accepts reductions. Omit `--update` to print counts. Do not hide waits in
other helpers or raise allowances; remaining legacy waits are tracked in TME-116.

## Timeouts and browser ownership

Browser files create one lazy browser per engine with `sharedTestBrowser(engine)`
and give every test a fresh context (`shared.newContext(t, options)`); a context
is the isolation boundary, so storage, routes, clocks and init scripts never
leak between tests. A launch that needs its own browser flags registers it with
`ownTestBrowser(t, browser)`. Both live in
`src/test-utils/test-browser.ts`. A `node:test` timeout fails the test but does
not settle an outstanding Playwright evaluation; a `finally` block alone can
leave the browser transport alive and prevent the runner from exiting. The
test-owned hook closes it even when the body is still waiting. The regression
in `test-browser.test.ts` deliberately times out a child runner and checks its
failure, disconnection and exit rather than weakening the timeout assertion.

The audio lifecycle cases exercise real Web Audio. The delayed-operation case
controls the context's state and promise completion: native Firefox autoplay
can resume without invoking the overridden `resume()` method. That controlled
case checks reconciliation after pause and retirement independently of native
autoplay policy. It also forces an external auto-resume notification and checks
that paused media suspends again; native autoplay policy and statechange timing
vary across platforms. The separate native case checks real
playback, pause, reload, replacement, reparenting and removal.

The registered suite limits test-file concurrency to two. CI caps Chromium browser
tests at ten minutes, Firefox at fifteen, and the job at thirty, and cancels
superseded runs for the same PR. These limits fail stalled checks; they do not turn them into passing tests.

On headless Linux, native Firefox Web Audio also needs an audio server and an
output device. CI starts PulseAudio with a null sink for the job; the browser
still executes native DSP without requiring speakers. Playwright's system
dependencies provide libraries, but do not start that server. On a local Linux
machine, use its existing audio server or an isolated null sink before running
the native lifecycle cases. A context that stays suspended during playback is
an environment failure, not a passing lifecycle check.

## Firefox on macOS 27

Playwright 1.63.0's Firefox 155 (revision 1543) can exit at launch with
`Could not find profile folder.` even though Playwright created the temporary
profile successfully. Firefox also reads its shared app-data directory at
`~/Library/Application Support/Firefox`; macOS privacy protection can deny the
terminal or editor access to that directory. Changing `TMPDIR` or reinstalling
the same browser revision does not resolve that access denial.

Check the distinction with `ls "$HOME/Library/Application Support/Firefox"`.
If it reports `Operation not permitted`, use a separate CoreFoundation home
for the test process, scoped to each command:

```sh
te_playwright_home="$HOME/Library/Caches/theater-everywhere/playwright-home"
mkdir -p "$te_playwright_home"
CFFIXED_USER_HOME="$te_playwright_home" pnpm exec tsx --test src/ui/native-chat.browser.test.ts
CFFIXED_USER_HOME="$te_playwright_home" pnpm test
pnpm build
CFFIXED_USER_HOME="$te_playwright_home" pnpm smoke:firefox
```

This keeps browser app data in the test cache and leaves the normal Firefox
profile and macOS permissions intact. Playwright still creates its usual
temporary profiles. Keep the variable scoped to these commands; it redirects
CoreFoundation home-directory lookups for child processes as well.

See [Playwright issue #42768](https://github.com/microsoft/playwright/issues/42768)
for upstream fix status. After upgrading Playwright and installing its matching
Firefox build, verify an unprefixed launch before removing the workaround.

## Test lanes and CI coverage

```sh
pnpm test --lane=unit
THEATER_TEST_ENGINES=chromium pnpm test --lane=browser
THEATER_TEST_ENGINES=firefox pnpm test --lane=browser
```

The runner partitions discovered tests into `unit` and `browser`: browser files
use `.browser.test.ts`, or import Playwright (including legacy names such as
`playlist-nav.test.ts`). Each discovered file belongs to exactly one lane.
Selectors and Node test flags work within either lane. Without `--lane`, all
tests run. `THEATER_TEST_ENGINES` selects parameterized browser cases; unset means
both engines, preserving local, nightly and release coverage. Comma-separated `chromium`
and `firefox` are accepted; empty, duplicate or unknown values fail. Existing
cases explicitly tied to Chromium still use Chromium in either browser lane;
the switch does not claim to port those cases to Firefox.

PRs run typecheck, build, bundle verification, affected unit/Chromium browser
tests, and Chromium smoke when shipped inputs are affected (see below).
`scripts/ci-changes.mjs` additionally enables Firefox browser coverage and Firefox smoke when any changed path is:

- `manifest.json`, `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, or `tsconfig.json`;
- under `src/platform/`, `src/protocol/`, `src/test-utils/`, or `test/`;
- under `scripts/` (including build, packaging and smoke scripts), `.github/actions/`, or `.github/workflows/`.

Both sides of renames count. Missing or invalid change metadata enables Firefox.
This deliberately broad infrastructure rule avoids a per-test exception list;
UI/provider-only changes use Chromium on PRs. Reviewed prose-only changes retain
the existing inexpensive CI pass. The CI workflow and `check` job names are
unchanged for branch-protection compatibility.

PR Firefox smoke remains non-blocking and emits a warning annotation on failure.
TME-112 owns making it blocking after ten consecutive green runs on the real
installed-extension path; diagnostic injection does not meet that requirement.

Merging to main starts **no CI test round**. The coverage model is affected tests
on PRs, the full suite nightly, and the full suite on release. Nightly runs on `main`
and on the 2.1 integration branch `dev` (a matrix with `fail-fast: false`, so one
ref's failure does not hide the other) at 02:23 UTC and can also be dispatched manually: unrestricted `pnpm test`
(unit tests and both browser engines, without lane or engine overrides), followed
by both smokes. Full history preserves the suite's baseline/history guards. The
suite has a 25-minute limit inside the existing 30-minute job. Failures fail the
job and appear in its summary; both smokes still run after a test failure unless
the run is cancelled. Firefox smoke failures are not suppressed. Its unsigned
extension injection fallback is still diagnostic-only. Regressions outside a
PR's selected paths can first surface in the full nightly run rather than block
that PR. Release also retains unrestricted `pnpm test`.

The shared-browser pilot in `test-browser.ts` launches lazily once per engine
per file/suite. Each test owns a fresh context, with a cleanup hook registered
before page setup; cookies, storage, routes, clocks and pages do not cross test
boundaries. File/suite cleanup closes the browser. The pilot covers
`video-activator`, `auto-theater-storage`, and options `rte-settings`; other files
retain their current browser ownership.

## Affected tests on pull requests

PR CI uses `node scripts/test-impact.mjs` after dependency installation. It compares
`HEAD` with the merge base of `origin/main` (full checkout history is required),
then writes `.test-impact.json`. Each `pnpm test --lane=unit|browser
--files-from=.test-impact.json` invocation runs the exact selected files in its
lane. An empty selection is valid only when classification succeeded. Local
`pnpm test`, nightly and release invocations without `--files-from` still discover
and run their full configured suites.

A test is selected when it changed or transitively depends on a changed file.
The selector unions esbuild metafile graphs from the merge base and current tree,
so deleted files, removed imports and both sides of renames retain their impact.
Packages are external: dependency/lockfile changes instead run all tests. Graph
construction reads source; it never executes tests or their browser harnesses.

Browser harnesses often bundle imports inside strings or read source directly.
Literal paths, including type-only imports, are conservatively matched against
all repository path suffixes; ambiguous names select every match. Tests reading
`dist/` depend on all five installed extension script entrypoints and the build
roots (`scripts/build.ts` and `vite.config.ts`). Repository-wide
DOM and determinism guards have explicit dependency edges for the trees they scan.
Catalog changes select localization/i18n tests and consumers of `_locales`, rather
than unrelated playback tests. Chromium smoke runs when the entrypoint graph is
affected, a shipped asset/build input changes, or classification fails. Otherwise
the summary explicitly records its skip. Firefox still uses the existing
`ci-changes.mjs` infrastructure rule; when enabled, it runs the selected browser
files and existing Firefox smoke. `scripts/smoke.ts` and other
`scripts/smoke*.ts` and `scripts/smoke/**/*.ts` harness entries are additional smoke
roots, so their own changes and transitive dependencies also run Chromium smoke. These harness roots
are separate from the build/installed roots that dist-dependent tests consume.

Shared inputs force all test files: package/lock/workspace files, root tsconfigs,
manifest, Vite config, `scripts/build*`, the runner, CI classifier and selector,
`test-utils/**`, `src/test-utils/**`, `test/fixtures/**`, and GitHub workflows/actions.
Stylesheets use the dependency graph described below. Extend `isFullRun` in
[`scripts/test-impact.mjs`](../scripts/test-impact.mjs) for a new shared input;
add a selector regression case alongside it. Extend the explicit graph edges
when adding a directory-scanning guard or a harness with computed source inputs
that cannot be resolved from literals; put such an input in the full-run set
until its dependency can be represented. Build inputs also keep Chromium smoke.

CSS is selected through the same graph: esbuild parses stylesheet `@import`
and asset `url()` dependencies separately from JS string loaders. `?raw` and
`?inline` imports, literal `readFileSync`/`readStylesheet` paths and bundled runtime
entrypoints retain canonical CSS edges. Popup/options HTML also links its surface
stylesheet, covering tests that compute the surface path. A changed stylesheet
with no modeled test consumer, a missing import or parser warning falls back to
all tests and smoke.

Missing history, unreadable/unbuildable graphs, unknown changed inputs or invalid
selection files fall back to all tests, with a reason in the job summary. Selection
errors also keep Chromium smoke enabled. The summary lists every selected test.
This is static impact analysis: it cannot prove unrelated runtime paths still
work, or infer arbitrary computed dependencies. PRs no longer prove the entire
Chromium/unit suite on every change. Nightly and release run the full
default suite; nightly also runs both smokes with blocking failures. No
authenticated host verification is implied by any of these fixture suites.

## Installed smoke scope and timing

Smoke protects installation/startup, background messages, MAIN/isolated wiring,
real extension storage shared by Settings/popup/player, and iframe ownership.
Fixture-only interaction regressions run in `src/ui/smoke-regressions.browser.test.ts`
with `sharedTestBrowser`; its support modules live in `src/test-utils/player-scenarios/`
and remain covered by the determinism guard. No Firefox installation or CI
advisory policy changes are implied by this split.

Set `THEATER_SMOKE_TIMING=1` on either smoke command to print seconds for each
`assert*` scenario and a `TOTAL` wall duration including browser startup/cleanup.
Rows are inclusive: do not add nested `assertBadgeWorld` to its parent highlights
row. Repeated startup rows distinguish initial entry from entry after blacklist
restoration. The existing `THEATER_SMOKE_*_ONLY` switches select the corresponding
installed-storage scenario (shortcuts mode retains its existing skip-pin meaning).
See [the scenario audit](smoke-coverage.md) for the retained capabilities and
removed/moved coverage.
