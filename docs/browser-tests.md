# Local browser tests

Install the dependencies and the browser builds expected by the lockfile:

```sh
pnpm install
pnpm exec playwright install chromium firefox
```

Browser tests run through `pnpm test` or individually with
`pnpm exec tsx --test <test-file>`. Build before running `pnpm smoke:firefox`
or `pnpm smoke:chromium`. The [Firefox smoke script](../scripts/smoke.ts) reports
whether it exercised a sideloaded extension or its fallback diagnostic with
injected bundles. A fallback pass verifies bundled player behavior, but does
not verify Firefox extension installation, permissions, or the background script.

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
