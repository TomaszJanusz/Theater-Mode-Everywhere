# Local browser tests

Install the dependencies and the browser builds expected by the lockfile:

```sh
pnpm install
pnpm exec playwright install chromium firefox
```

Browser tests (`*.browser.test.ts`) run through `pnpm test` or individually with
`pnpm exec tsx --test <test-file>`; component tests (`*.component.test.ts`) run only
through `pnpm test` (see Component tests). `pnpm test` discovers test files by name
(`scripts/run-tests.mjs`); `pnpm test <path-or-substring> [--test-name-pattern=…]`
runs a subset. Build before running `pnpm smoke:firefox`
or `pnpm smoke:chromium`.

## Firefox smoke installs the built extension

`pnpm smoke:firefox` launches Playwright's Firefox with `-start-debugger-server`
and installs `dist/firefox-unpacked` as a temporary add-on over Firefox's remote
debugging protocol, the way `web-ext run` does
([`scripts/smoke/firefox-rdp.ts`](../scripts/smoke/firefox-rdp.ts); Playwright has no
API for Firefox extensions). The extension's background, permissions, storage and
isolated/MAIN content scripts are therefore the real ones.

Playwright cannot drive `moz-extension:` pages in Firefox, so scenarios that open
Settings or the popup stay Chromium-only (their UI is covered by the Firefox
browser tests). The same RDP connection evaluates code in the background page,
which stands in for the Chromium service worker: `extensionWorker(context)` returns
it, so shared scenarios read and write real extension storage on both engines.
Firefox runs startup, storage-to-worlds propagation, the installed audio graph,
exact/parent blacklists and the iframe and embedded-fullscreen scenarios. The
background page's idle timeout is raised for the run because the debugger evaluates
inside it.

`THEATER_SMOKE_FIREFOX_INJECT=1` runs a local diagnostic that injects `content.js`
and `mainWorld.js` into a page with no extension installed. It checks bundled player
behavior only, never Firefox installation, permissions, storage or the background,
and CI does not use it. A failed install fails the smoke; there is no fallback.

## Chromium smoke stays inside the `chrome.storage.sync` quota

Chrome drops `chrome.storage.sync` writes beyond 120 per minute with `This request exceeds the
MAX_WRITE_OPERATIONS_PER_MINUTE quota`, and a CI-speed Chromium smoke makes more changes than that. A dropped write
shows up as an unrelated UI timeout in whichever scenario writes next. Every `timeScenario(name, { syncWrites }, ...)`
therefore declares the most sync changes it makes ([`sync-quota.ts`](../scripts/smoke/sync-quota.ts)):

- **Gate.** A recorder in the extension worker timestamps every `sync` change (options pages, popup and content
  scripts included). Before a scenario starts, the runner waits, on a clock `smoke.ts` injects, until a rolling minute
  has room for its budget under a ceiling of 110.
- **Guard.** A scenario that measures more than it declared fails naming the scenario and both counts, so the
  budget cannot drift silently. A quota error that a page or the worker logs fails the scenario by name instead of
  surfacing as a timeout.
- **Maintaining.** Adding a scenario or a write to one: run `THEATER_SMOKE_TIMING=1 pnpm smoke:chromium`, read the
  `SYNCWRITES <scenario> <measured>/<declared>` rows and set the budget to the measured count. Scenarios that wrap
  others declare the total; a nested one is covered by its parent.
- **Firefox** has no per-minute sync quota, so its smoke is neither gated nor counted.

## Deterministic waits

Wait for observable DOM/media state; use fake timers or `page.clock` for deadlines.
`scripts/test-determinism.test.ts` scans tests, `src/test-utils/**`, `tools/**`,
`scripts/smoke*.ts` and `scripts/smoke/**/*.ts`,
including serialized browser code. Its textual rules conservatively count timers,
frames, sleep helpers, timer imports and named retry loops, including mocks and
watchdogs; review clock ownership and aliases separately. Per-file/per-kind counts
must match `scripts/test-determinism-baseline.json` and cannot grow past the
baseline at the merge base with the PR base (`origin/$GITHUB_BASE_REF` in CI; locally `origin/main` or `origin/dev`, whichever `HEAD` diverged from last, `origin/main` on a tie). CI requires that ref and full history;
locally a missing ref logs a skipped history comparison while inventory checks still run.
After removing calls, run `pnpm exec tsx scripts/test-determinism.ts --update`;
it only accepts reductions. Omit `--update` to print counts. Do not hide waits in
other helpers or raise allowances. The baseline lists the remaining legacy waits and only shrinks.

## Timeouts and browser ownership

Browser files create one lazy browser per engine with `sharedTestBrowser(engine)`
(direct `.launch(` calls are the legacy form, ratcheted below) and give every test a fresh context (`shared.newContext(t, options)`); a context
is the isolation boundary, so storage, routes, clocks and init scripts never
leak between tests. A launch that needs its own browser flags registers it with
`ownTestBrowser(t, browser)`. Both live in
`src/test-utils/test-browser.ts`. A `node:test` timeout fails the test but does
not settle an outstanding Playwright evaluation; a `finally` block alone can
leave the browser transport alive and prevent the runner from exiting. The
test-owned hook closes it even when the body is still waiting. The regression
in `test-browser.test.ts` deliberately times out a child runner and checks its
failure, disconnection and exit rather than weakening the timeout assertion.

The runner does not pass `--test-force-exit`: forcing the exit cut off results the
reporters still held, so identical runs reported different test counts (and
incomplete JUnit files) with exit code 0. Instead each test-file process loads
`scripts/test-process-guard.mjs`. A process that a leaked handle keeps alive one
second after its tests finished is ended, and the runner prints which handles it
found; fix the leak where the test creates it. The guard also counts the test
bodies that ran, and the runner fails the run (`Test results were lost between the
test files and the reporters`) if `scripts/test-tally-reporter.mjs` received fewer.

Audio is tested in three tiers; put a new case in the cheapest one that can fail
for the right reason:

- **Node** (`media-audio-lifecycle.test.ts`, `audio-graph.test.ts`,
  `audio-crossfade.test.ts`): the suspend/resume/retire rules run against an injected
  context facade whose `resume()`/`suspend()` the test settles by hand, so races such
  as a pause during a pending resume are exact. The DSP graph topology is checked
  against a fake context.
- **Browser, no audio device** (`audio-graph.browser.test.ts` renders through
  `OfflineAudioContext`; `media-audio-runtime-wiring.browser.test.ts` drives the real
  runtime against a controlled `AudioContext` stand-in for events, observers,
  activation and iframes). Neither needs an audio server.
- **Native** (`media-audio-runtime.browser.test.ts`, at most three cases per engine):
  real playback, pause, reload, reparenting and removal on a real context, and the
  spectrum of the stereo tone fixture. These launch with the autoplay policy relaxed
  (`nativeAudioLaunchOptions`), so a context follows playback and not the browser's
  gesture rules; the runtime's policy gate is covered by the tiers above. The tone case
  puts an `AnalyserNode` after the runtime's last node and compares band levels within
  one run (gain +6 dB, bass shelf, voice stereo leakage and dialogue lift) with
  tolerances; never assert exact samples or absolute dB, which depend on the engine.
  `test/fixtures/tone.md` documents the fixture and its regeneration command.

On headless Linux, native Firefox Web Audio needs an audio server and an output
device. Firefox CI lanes start PulseAudio with a null sink; the browser still executes
native DSP without requiring speakers. Playwright's system dependencies provide
libraries, but do not start that server, and the Playwright image ships none (an ALSA
`null` device does not substitute: Firefox's context stays `suspended`). `requireAudioSink` (`src/test-utils/audio-sink.ts`)
runs before the first native case of each browser and fails within five seconds with
`environment: no audio sink` when a context never starts, instead of a 30 s
`waitForFunction` timeout that looks like a lifecycle regression. Treat that error as
an environment failure, never as a passing lifecycle check.

On a local Linux machine, reuse its audio server, or start a throwaway null sink:

```sh
pactl load-module module-null-sink sink_name=te_null   # PulseAudio, or PipeWire with pipewire-pulse
pactl set-default-sink te_null
# when done:
pactl unload-module module-null-sink
```

On macOS and Windows the system audio device is used and nothing needs starting.

`pnpm audio:charts [dir]` (default `output/audio-charts`) renders one self-contained
HTML page showing, for voice, stereo ambience, bass and volume leveling, the spectrum
of the audio graph's test tones without and with the effect. It renders offline through
the real chain with the same band-level helper as `audio-graph.browser.test.ts`
(`src/test-utils/audio-render.ts`), so charts and assertions measure the same thing;
`tools/audio-charts/audio-charts.browser.test.ts` cross-checks them. Crossfade is not
charted (it has no steady spectrum), and there is no Storybook story. It needs Chromium.

## CI browser image

The Chromium lanes, the Firefox lane and smoke run as job containers (`container:` in
[`ci.yml`](../.github/workflows/ci.yml)) from `ghcr.io/<repository>/ci-browsers`: the
`mcr.microsoft.com/playwright:v<version>-noble` image plus PulseAudio
([`Dockerfile`](../.github/ci-image/Dockerfile)). Browsers, Xvfb and the audio daemon are in the
image, so these lanes never run `apt-get` and cannot stall on the runner's Ubuntu mirror (TME-157:
single packages took 60-150 s there, ending the setup step at its limit). They pass `prebuilt: 'true'` to the
[setup action](../.github/actions/setup/action.yml), which then only verifies the browsers.

- **One version source.** The Playwright version is the one `pnpm-lock.yaml` resolves
  ([`scripts/ci-image.mjs`](../scripts/ci-image.mjs) reads it); the image tag is
  `pw<version>-<hash of the Dockerfile>`, so the browser revisions always match `pnpm exec playwright`.
- **Pinned.** The `image` job in `ci.yml` resolves the tag and hands the lanes `ref@sha256:...`. The
  base image is pinned by digest when the image is built.
- **Self-building.** The `image` job builds and pushes a missing tag (for example after a Playwright bump or a
  Dockerfile edit) with `packages: write`. A run that cannot push (forks, Dependabot's read-only token) fails
  with a message: run the `CI browser image` workflow on that branch, then re-run. The same workflow
  rebuilds `main` and `dev` weekly so base-image security fixes arrive without a version bump.
- **`HOME=/root`.** The runner sets `HOME=/github/home`, which Firefox refuses as root; the lane jobs
  override it.
- **Package visibility.** Make the `ci-browsers` package public once (package settings), so fork PRs can pull it.
- **Release and nightly** still run on the bare runner and use apt. The setup action gives apt a shared
  210 s budget and fails with `Setup budget exceeded` instead of waiting for the step limit; setup steps
  are capped at 4 minutes in CI and 6 in release (cold pnpm store, browser download, apt budget).
  Releases cannot use the image: they check out tags older than it.

To reproduce a lane locally with Docker: `docker run --rm -it -v "$PWD":/work -w /work -e HOME=/root
mcr.microsoft.com/playwright:v<version>-noble bash`, then install PulseAudio inside it for Firefox audio.

The registered suite limits test-file concurrency to two. PR CI is one workflow of parallel
jobs ([`ci.yml`](../.github/workflows/ci.yml)); the `check` job aggregates them and is the
status to require. It cancels superseded runs for the same PR, and every step has a timeout
there, so a stalled check fails instead of hanging.

| Job | Runs |
| --- | --- |
| `changes` | Classifies changed files (`ci-changes.mjs`) and selects affected tests (`test-impact.mjs`). |
| `image` | Resolves, and if missing builds, the browser image above. |
| `build`, `static` | One production build; `pnpm lint`, `pnpm typecheck` and `pnpm verify:bundles` against it (which includes the shared bundle size ratchet). |
| `boundaries`, `css-and-unused` | `pnpm check:boundaries`, `pnpm check:shared-hosts`, `pnpm lint:css`; Knip is reported only (`pnpm check:unused`). |
| `unit` | `pnpm test --lane=unit` on the selection. |
| `browser-chromium` | Two shards of `pnpm test --lane=browser` on Chromium; shard 1 also runs `pnpm storybook:test`. |
| `browser-firefox` | Three shards of `pnpm test --lane=browser` on Firefox, only when `ci-changes.mjs` selects it, balanced by measured file cost (below); shard 1 also runs `pnpm storybook:test` for Firefox. |
| `smoke` | Chromium smoke when shipped inputs are affected; Firefox smoke with the installed extension when Firefox is selected. |

## Booting the player in a test

`src/test-utils/` holds small independent pieces: `bundlePlayer()` / `bundleModules()`
(one cached esbuild bundle per process and entry set; each `*.test.ts` file runs in its
own process, so a file builds each distinct bundle once), `playerStylesheets()`,
`installChromeStub()` / `emitStorageChange()` (`chrome.storage.{sync,local}` and
`onChanged`, the surface the player uses; `set` notifies listeners and `get`
returns the whole area), and `canvasVideoFixture()` / `vodVideoFixture()` /
`serveFixture()`. `bootPlayer(page, { settings, mainWorld?, bundle? })` only composes
them in the extension's order on a navigated page; waiting for media and `enterTheater(page)`
stay with the test. Extend by composition: call the pieces yourself instead of adding options.

`scripts/test-harness.ts` ratchets what these helpers replace: direct `.launch(`
calls, `'esbuild'` imports and `window.chrome =` stubs in `*.test.ts` files outside
`src/test-utils/`. Counts per file must match `scripts/test-harness-baseline.json` and cannot
grow past the baseline at the merge base with the PR base (same `origin/$GITHUB_BASE_REF`
rule and local skip as the determinism guard). After migrating a file, run
`pnpm exec tsx scripts/test-harness.ts --update`; it only accepts reductions.
Omit `--update` to print the counts. The same guard budgets `src/test-utils/*.ts`
at 150 lines per file and four properties per exported `*Options` interface.

## Component tests

`*.component.test.ts` files run in Vitest browser mode (the `components` project in
`vitest.config.ts`), inside Vitest's tester iframe, in Chromium and Firefox per
`THEATER_TEST_ENGINES`. They mount production UI in the real player UI root without the
player runtime, MAIN world, video, providers or network; those paths stay in
`*.browser.test.ts`, smoke and real-host checks. `pnpm test` dispatches them to Vitest in
the browser lane, so selectors, `--files-from`, `--test-name-pattern` (as `-t`),
`--test-shard` and `--report-dir` work as for other files:

```sh
pnpm test surfaces.component
THEATER_TEST_ENGINES=firefox pnpm test --lane=browser surfaces.component
```

`src/test-utils/component-setup.ts` installs the typed in-page chrome stub
(`page-chrome-stub.ts`, shared with Storybook) and the player UI skin before each test and
removes the player UI root after it. Use `userEvent` from `vitest/browser` for input (it is
trusted) and `vi.useFakeTimers()` installed before mount for time. Engine-only cases use
`test.skipIf(server.browser !== 'firefox')` from `vitest/browser`, not a new file suffix.

**Top-layer surfaces.** `src/ui/surfaces.component.test.ts` is the conformance suite for
modal and anchored-menu surfaces. Their owners write `data-te-surface` (family),
`data-te-owner` (opaque per mount) and `data-te-state` (`open`/`closed`); tests read state
through these hooks, roles, ARIA and focus, never copy. A new surface with an existing
policy needs only an entry in `surfaceRegistrations`
([`surface-registry.ts`](../src/test-utils/surface-registry.ts)): `mount({ root, stage, owner })` builds its
trigger in `stage` and returns `{ trigger, surface(), close() }`; disposing `owner` must
close the surface and release what it holds. New interaction semantics need a policy or
targeted tests. Hostile host pages (maximum z-index overlay, transformed/contained/filtered
ancestors, an aggressive global stylesheet, page popovers and modal dialogs before and
after opening, document fullscreen) run once per policy, on its first registration.

**Accessibility matrix.** `src/ui/accessibility.component.test.ts` scans every registered
surface, closed and open, with axe-core (`src/test-utils/axe.ts`) under each appearance mode
in `APPEARANCE_MODES` (default, high contrast, reduced transparency, RTL, reduced motion);
serious and critical violations fail. Registering a surface adds it to both suites. Fix a
violation in the component; `AXE_ALLOW_LIST` takes only a documented false positive (rule,
selector and reason), never a whole rule.

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
use `.browser.test.ts` or `.component.test.ts`, or import Playwright (including legacy names such as
`playlist-nav.test.ts`). Each discovered file belongs to exactly one lane.
Selectors and Node test flags work within either lane. Without `--lane`, all
tests run. `THEATER_TEST_ENGINES` selects parameterized browser cases; unset means
both engines, preserving local, nightly and release coverage. Comma-separated `chromium`
and `firefox` are accepted; empty, duplicate or unknown values fail. Existing
cases explicitly tied to Chromium still use Chromium in either browser lane;
the switch does not claim to port those cases to Firefox.

**Shards.** `--test-shard=<i>/<n>` splits a lane. With `--shard-costs=<table>` the runner itself partitions the
lane's files (node:test and Vitest alike) greedily by seconds, so shards finish together
instead of holding equal file counts. The Firefox lane passes
[`scripts/test-shard-costs.json`](../scripts/test-shard-costs.json); Chromium keeps the count-based split.
Every shard derives the same partition from the same inputs, so each selected file runs in exactly one shard. A file missing
from the table weighs the median measured file, and a stale entry is ignored: drift costs balance, never a test. `overhead`
holds non-test work a shard runs (Storybook on shard 1). To recalibrate after the suite changed
materially, download the `test-reports-firefox-<shard>` artifacts of a recent full run (each job uploads its `--report-dir`, kept
three days) and run `node scripts/test-shard-costs.mjs --overhead=1:<storybook seconds> <dir>... > scripts/test-shard-costs.json`
(see the script header). A job needs `matrix.shard` and the same `<n>` in `--test-shard`; the `check` job
requires the whole `browser-firefox` matrix (`needs.<job>.result` aggregates its shards), so a red shard is one red `check`.

PRs run the jobs above on the affected tests (see below). The build artifact is shared
with verification and smoke. Each test lane publishes its 15 slowest tests and failures
in the job summary.
`scripts/ci-changes.mjs` additionally enables Firefox browser coverage and Firefox smoke when any changed path is:

- `manifest.json`, `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, or `tsconfig.json`;
- under `src/platform/`, `src/protocol/`, `src/test-utils/`, or `test/`;
- under `scripts/` (including build, packaging and smoke scripts), `.github/actions/`, `.github/ci-image/`, or `.github/workflows/`.

Both sides of renames count. Missing or invalid change metadata enables Firefox.
This deliberately broad infrastructure rule avoids a per-test exception list;
UI/provider-only changes use Chromium on PRs. Reviewed prose-only changes retain
the existing inexpensive CI pass.

PR and release Firefox smoke remain non-blocking (`continue-on-error`) but never
pass silently: a failure adds a warning annotation and a job-summary line, and a
pass adds a summary line. TME-112 owns making it blocking after ten consecutive
green CI runs of the installed-extension path.

Merging to main starts **no CI test round**. The coverage model is affected tests
on PRs, the full suite nightly, and the full suite on release. Nightly runs on `main`
and on the 2.1 integration branch `dev` (two independent jobs with literal refs, so one
ref's failure does not hide the other) at 02:23 UTC and can also be dispatched manually: unrestricted `pnpm test`
(unit tests and both browser engines, without lane or engine overrides), followed
by Storybook components on both engines (`pnpm storybook:test`) and both smokes. Full history preserves the suite's baseline/history guards. The
suite has a 25-minute limit inside the existing 30-minute job. Failures fail the
job and appear in its summary; the Storybook and smoke steps still run after a test failure unless
the run is cancelled. Firefox smoke failures are not suppressed. Regressions outside a
PR's selected paths can first surface in the full nightly run rather than block
that PR. Release also retains unrestricted `pnpm test`.

## Affected tests on pull requests

PR CI uses `node scripts/test-impact.mjs` after dependency installation. It compares
`HEAD` with the merge base of the PR base branch (`origin/main` or `origin/dev`; full checkout history is required),
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
roots (`scripts/build.ts` and `config/vite.config.ts`). Repository-wide
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
and remain covered by the determinism guard. The same installed scope applies to
Firefox, which installs the built add-on (see above) but cannot open extension pages.

Set `THEATER_SMOKE_TIMING=1` on either smoke command to print seconds for each
`assert*` scenario and a `TOTAL` wall duration including browser startup/cleanup.
Rows are inclusive: a nested scenario's time is part of its parent's row. Repeated startup rows distinguish initial entry from entry after blacklist
restoration. The existing `THEATER_SMOKE_*_ONLY` switches select the corresponding
installed-storage scenario (shortcuts mode retains its existing skip-pin meaning).
Installed smoke (`scripts/smoke/`) keeps only what needs the real extension:
startup and the exact/parent blacklists, the isolated-to-MAIN audio graph, RTE,
shortcut, pin and layout storage written through Settings, AutoTheater defaults and
live preference changes, the language catalog delivered by the background, the update
notice (toolbar badge, popup panel, player menu label and acknowledgement from each route,
then the badge after a browser restart in a profile of its own), a fresh install in a profile of its own (one first-run setup tab, AutoTheater stored off, the installed Settings page finishing every setup step over real storage, and no tab on a relaunch; the shared Chromium and Firefox profiles are fresh installs too, so they first assert and close that tab), appearance modes across Settings,
popup and player, and the iframe and embedded-fullscreen scenarios. Presentation,
input and lifecycle checks for those features belong in fixture browser tests.

## Live E2E lane (TME-124)

`.github/workflows/live-e2e.yml` runs nightly (and on dispatch) against real public
pages to catch host DOM or API changes before users do. It is never a required check
and never runs on pull requests, so PR CI does not depend on third-party sites. It
builds the ref it runs on (`main` for the schedule), installs the unpacked Chromium build in a fresh profile per attempt,
and runs [`tools/live-e2e`](../tools/live-e2e).

- **Target configuration.** The page types and URLs come from the `LIVE_E2E_TARGETS`
  Actions repository variable (a JSON array of `{ pageType, url, capabilities?, videoSelector? }`); the
  repository holds none. `pageType` is an opaque kebab-case id that also names the
  rolling issue, so keep it generic. Without the variable the workflow reports that
  nothing ran.
- **One spec per capability** in `test-utils/specs.ts` (`theater`, `active-video`). Specs assert the
  extension's contract (state classes and attributes, the control bar), never host
  copy or geometry. A new capability needs a stable, host-independent signal first.
- **Pre-flight classification.** Before any assertion the page is classified
  (`classify.ts`, `test-utils/signals.ts`): consent wall, challenge or bot check, geo block, ad break, or an
  unreachable page. Those results are `skipped` (environment), not `failed`. A
  skipped night neither opens nor closes an issue.
- **Retry and evidence.** A failing page type is retried once, in a fresh profile; only
  this lane retries. The repository is public, so nothing that can show a target is
  published: no trace, video or screenshot is kept, and every URL, host and path of a
  target is replaced by its `pageType` in logs, `results.json` (the only artifact, 7 days)
  and issue text. GitHub Actions does not mask repository variables, so the runner
  `::add-mask::`s each target URL, origin, host and path before other output. To
  investigate a failure, run the lane locally with the target list.
- **Quarantine.** `tools/live-e2e/quarantine.json` lists page types to skip, each with
  an `owner`, an `expires` date (`YYYY-MM-DD`) and a `reason`. An expired entry fails
  the run instead of hiding the page type for good.
- **Alerting.** One rolling issue (`Live E2E: <pageType>`, label `live-e2e`) per failing
  page type is created or updated by the workflow's `alert` job, the only job with
  `issues: write`. It closes itself after three consecutive green nights. A failed build or
  a live job that wrote no results opens `Live E2E: lane` the same way.

Locally, `tools/live-e2e/live-e2e.browser.test.ts` runs the same runner against a
fixture server (a generic player page and pages standing in for each environment
block) with the player injected, and `live-e2e.test.ts` covers classification,
config parsing, retry and the issue state machine. These verify the harness, not
any real host or the installed extension; only the nightly does. To try the installed
path by hand: `pnpm build`, then
`LIVE_E2E_TARGETS='[{"pageType":"demo","url":"<public page>"}]' pnpm exec tsx tools/live-e2e/test-utils/run.ts dist/chrome-unpacked /tmp/live-e2e-out`.

## Recorded host fixtures (TME-134)

Provider tests and stories can run on structure and data recorded from a real service
instead of hand-written approximations. A recording is one JSON file in
[`test/host-fixtures/`](../test/host-fixtures) named after its recipe in
[`tools/host-fixtures/recipes.ts`](../tools/host-fixtures/recipes.ts) (format and
validation: [`format.ts`](../tools/host-fixtures/format.ts)). It holds:

- **`dom`:** a trimmed fragment of the host page: the `<body>`, the elements matched by the
  recipe's probes (the selectors the provider itself uses, imported from it where it exports
  them), their ancestors and a few descendants. Computed layout (display, position, size,
  transform, visibility) is inlined, so it renders without the host's stylesheets.
- **`signature`:** per probe, how many nodes match, whether the first is laid out with a size,
  whether it is transformed and which other probes contain it. A test that renders the fragment
  first asserts that it reproduces this signature, so a trimming or rendering error cannot pass
  silently.
- **`media` / `playback`:** provider-shaped data (title, caption tracks, chapters, live/paused
  state) read through the installed extension's own MAIN-world probe.
  [`recordedMediaAdapter`](../tools/host-fixtures/recorded-adapter.ts) serves it through the
  `MediaFeaturesAdapter` contract.
- **`capture`:** date, extension and host build versions, browser, and how it was captured.
  Never the page URL.

Capture with the built extension installed, logged out, on a public page, for a few seconds:

```sh
pnpm build
pnpm exec tsx tools/host-fixtures/test-utils/capture.ts twitch-chat-expanded --url '<public live channel>'
# or a page type from the live E2E target list:
LIVE_E2E_TARGETS='[…]' pnpm exec tsx tools/host-fixtures/test-utils/capture.ts <recipe> --page-type <id>
```

The tool opens the page in a fresh profile, stops on a consent wall, challenge or other
environment block (the live E2E lane's classification), waits until the probes settle,
performs the recipe's single optional click, and records. Sanitization is automatic and has
no manual step ([`sanitize.ts`](../tools/host-fixtures/sanitize.ts)): text nodes, URLs, SVG
artwork and unlisted attributes are never read; ids carrying numbers are renumbered;
`aria-label`s other than the native control labels the provider reads keep only their length;
titles, labels and chapter names become same-length filler; host content ids keep their
shape. The tool then refuses to write a file in which a URL, e-mail, token, UUID, long number
or a string identifying the page (its URL path and query, title parts, recorded titles)
survived, or one over the 24 KB budget. `tools/host-fixtures/host-fixtures.test.ts` repeats
the leak, metadata and budget checks for every committed recording; import a new recording
there and in the test that consumes it. Content behind a login, which cannot be sanitized
automatically, is out of scope.

Recordings in the repository: `twitch-chat-expanded` and `twitch-chat-collapsed` (the chat
column, used by `src/chat/twitch-recorded.browser.test.ts` and the title HUD story),
`youtube-watch-player` (the launcher's native slot and a caption track list, used by
`src/providers/youtube/launcher-recorded.browser.test.ts`). Register a new one in
[`committed.ts`](../tools/host-fixtures/committed.ts).

**Drift.** The nightly live E2E lane runs
[`drift-run.ts`](../tools/host-fixtures/test-utils/drift-run.ts) after its page checks: for
every recording it opens the recipe's `pageType` from `LIVE_E2E_TARGETS` with the built
extension, as the capture did, and compares the live probe signature with the recorded one.
A difference is `DRIFT` (one line per changed probe field, a warning annotation, the job
summary and a rolling `Host drift: <recording>` issue under the same rules as the lane's
issues: one retry, skipped nights change nothing, closed after three green nights). It never
fails the step. A recipe whose page type has no target is skipped, and an environment block
is a skip, not drift. Output carries the recording id and page type, never a target URL. On
drift, refresh the recording first, then fix the provider if its tests fail on the new one.

`test/host-fixtures/` is `export-ignore`d (source archives) and `pnpm verify:bundles` fails
if a recording reaches an extension package. A recording is **fixture evidence**: it shows
the provider handles the structure the host had on the capture date, not that the host
still has it. PRs say which kind of evidence they provide; behavior that depends on the
live host still needs a real-host check. The maintainers' refresh procedure is in Notion:
[TME-134: Refreshing recorded host fixtures](https://app.notion.com/p/TME-134-Refreshing-recorded-host-fixtures-40219f2ad83881fd8afaca7c0ad68347).
