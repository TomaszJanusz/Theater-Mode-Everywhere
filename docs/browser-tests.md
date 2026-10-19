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
`scripts/test-determinism.test.ts` scans tests, `tools/**` and `scripts/smoke*.ts`,
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

Register a launched browser with `ownTestBrowser(t, browser)` from
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

The registered suite limits test-file concurrency to two. CI caps the test step
at ten minutes and the job at fifteen, and cancels superseded runs for the same
ref. These limits fail stalled checks; they do not turn them into passing tests.

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
