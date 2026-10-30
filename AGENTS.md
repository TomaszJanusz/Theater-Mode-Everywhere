# Theater Everywhere

## Product

Theater Everywhere is a TypeScript extension for Chromium and Firefox, built with Vite and pnpm. It maximizes HTML5 players and adds shared playback controls; Rich Theater Experience (RTE) supplies optional service integrations. Protect generic playback, native host behavior, browser compatibility and low overhead. The extension should improve watching without getting in the way.

`AGENTS.md` is the canonical guide. Keep `CLAUDE.md` as a relative symlink to it. Follow the developer's explicit instructions when they override these defaults.

## Progress tracking
- Linear (main), `TME` prefix
- GitHub Issues 

## Taste

Aim high with a simple design. Understand the constraint, then choose the smallest model that makes correct behavior obvious. Measure twice, cut once; apply YAGNI and DRY. Simplify accidental complexity within the task's scope, preserve required behavior, and finish the requested integration without expanding into adjacent work.

- **Keep modules cohesive.** Make inputs, outputs and ownership explicit. Separate parsing and calculation from DOM, network and other side effects. Entrypoints wire modules together.
- **Reuse behavior, not coincidence.** Find existing contracts and helpers first. Share rules at the narrowest useful boundary; similar syntax is not enough. A small interface can isolate a real boundary with one implementation. Future consumers alone do not justify machinery.
- **Keep types honest.** Use strict TypeScript and validate external data. Avoid broad `any`, unchecked casts and fallbacks that conceal invalid state.
- **Give shared UI one owner.** Reuse tokens, control states and layout rules. Fix the shared component or lifecycle before adding per-button, per-screen or per-provider exceptions.
- **Keep settings consistent.** Reuse shared defaults and normalization, such as appearance resolvers and `withShortcutDefaults`. UI and runtime must interpret saved preferences alike; avoid independent inline defaults.
- **Explain the surprising part.** Follow local naming and formatting. Comments explain intent or constraints. Remove code made obsolete by the change; keep unrelated cleanup out.

## Code boundaries

Read [`docs/player-provider-contracts.md`](docs/player-provider-contracts.md) before changing player/provider boundaries.

- `src/providers/` owns host detection, selectors, native APIs, clocks, availability, presentation and commands. Translate host quirks into shared contracts here.
- **New RTE integrations are per-host providers.** Every new integration uses the asynchronous, descriptor-loaded model: one `src/providers/<id>/provider.json` (id, hosts, entries) is the source of truth, the manifest `content_scripts` are generated from it with static `matches`, and the provider's code loads only on its hosts and registers through `ProviderHooks`. Add no service code, host checks, selectors or branches to the shared `content.js`/`mainWorld.js` or to shared code (`src/ui`, `src/core`, `src/platform`, `src/chat`, `src/media-features`, `src/protocol`); extend a shared contract instead. Shared files get declarative registrations only. SOOP and YouTube are the references; the how-to is in [`docs/player-provider-contracts.md`](docs/player-provider-contracts.md). Legacy bundled integrations (Netflix, Disney+, Crunchyroll, Bilibili, ...) migrate one by one; a PR may change their code in place but must not add shared-code coupling.
- `src/core/` owns sessions, lifecycle and coordination. Reuse `PlayerSession` and `DisposableScope` where appropriate.
- `src/ui/` owns shared controls, menus, rendering, input and layout. Consume contracts and capabilities instead of service-specific branches.
- `src/media-features/` owns adapters, metadata, caption operations, parsing and rendering.
- `src/platform/` and `src/protocol/` own browser/page integration and cross-world/frame communication.
- `popup/` and `options/` own extension settings UI. Keep `_locales/` keys, placeholders and `src/i18n.ts` fallbacks consistent.
- `scripts/`, `manifest.json` and `.github/workflows/` own build and delivery. Change sources, not generated `dist/` output or ZIPs; do not commit generated packages.

## Runtime

- **Reject stale work.** Async results and callbacks must still match the current session, media and adapter before mutating state or UI. Use existing epoch/identity guards and cancellation. An `AbortSignal` alone does not protect every continuation.
- **Own cleanup.** Listeners, observers, timers, subscriptions and host mutations need an owner. Rebinding, SPA navigation and theater exit must invalidate old work and restore host state. Cleanup must be safe to repeat.
- **Let providers own host behavior.** Revalidate identity and availability when activating an action. Providers own native timing and expiry; UI displays their state. Preserve host-caption ownership and user preferences.
- **Keep boundaries checked.** Retain message validation, provenance and session checks. Unavailable provider features degrade through existing capability paths.
- **Share interaction behavior.** Keyboard and pointer actions use the same implementation. Preserve focus, accessible labels, menu handling and shortcut guards for editable fields.
- **Keep frequent callbacks cheap.** Avoid repeated DOM scans, JSON parsing, network requests and layout reads on playback or observer updates. Reuse computed data within its valid lifetime. Prefer events to new polling; scope observers and animations to when needed, and stop them on cleanup.

## Affected paths

Before calling a cross-cutting change done, account for the paths it affects:

- **Entry points:** controls, shortcuts, player settings, popup and options.
- **Playback:** generic HTML5, relevant providers, RTE enabled/disabled and unsupported capabilities.
- **Execution:** top-level pages, iframes and MAIN/isolated worlds where applicable. A per-host provider must also stay absent from non-matching hosts and frames.
- **Browsers:** Chromium and Firefox, including known differences.
- **Reverse states:** enter/exit, enable/disable, replacement, navigation and restoration. Keep both behavior and visible state correct.

This is an impact check, not a demand to run every browser or smoke test. Verify applicable paths proportionately; state when a path is unaffected or unverified.

## Verification

Use the smallest useful proof. Broaden checks when risk crosses shared contracts, browser targets or packaging. Preserve CI gates.

- **Docs only:** check content, links, symlinks and whitespace. Skip application tests and builds.
- **Lint:** run `pnpm lint`; see [docs/code-style.md](docs/code-style.md). Lower existing allowances with `pnpm lint:suppressions:prune`. The baseline may only shrink without review.
- **Repository gates:** `pnpm check` runs ESLint, typecheck, test-policy ratchets, module boundaries (known violations may only shrink; `pnpm check:boundaries --update` drops fixed ones) and the shared CSS ratchet (`pnpm lint:css`; `--update` locks in an improvement); `pnpm lint:fix` applies ESLint fixes. `pnpm verify` adds tests, build and bundle verification. Host knowledge in shared code may only shrink: `pnpm check:shared-hosts` (in `pnpm check`) counts per-service host references and `pnpm verify:bundles` ratchets the minified `content.js`/`mainWorld.js`, with `pnpm check:shared-hosts --update` and, after a build, `pnpm check:bundle-size --update` locking in an improvement; leftovers of an extraction go in the [debt ledger](https://app.notion.com/p/40819f2ad83881cdbf86cd0de4c78203). `pnpm check:unused` reports Knip findings; CI treats it as diagnostic only.
- **TypeScript:** run `pnpm typecheck` and relevant tests with `pnpm exec tsx --test <test-file> [...]`. `pnpm test` discovers every `*.test.ts`/`*.test.mjs` through `scripts/run-tests.mjs`; name new tests that way and do not register them. Narrow a run with `pnpm test <path-or-substring>`.
- **Test layers:** put a case in the cheapest layer that can fail for the right reason: node `*.test.ts` (`--lane=unit`), `*.component.test.ts` (Vitest browser mode, shared UI without the runtime; run through `pnpm test`, not `tsx --test`), `*.browser.test.ts` (Playwright, via the shared harness in `src/test-utils/`), then installed-extension smoke. Surfaces get the conformance and axe accessibility matrix by registering in `src/test-utils/surface-registry.ts`. [`docs/browser-tests.md`](docs/browser-tests.md) has the lanes, harness, ratchets and CI jobs.
- **Regressions:** cover meaningful behavior and failure modes, including stale results and cleanup where relevant. Tests should catch a plausible bug, not mirror implementation. Simple reversible changes do not automatically need new tests.
- **Determinism:** wait for observable state. Use fake timers or an injected clock for time semantics. Avoid arbitrary sleeps and retries that mask races; do not assert exact GPU-dependent output.
- **Builds:** bundling, entrypoint, manifest and packaging changes warrant `pnpm build` and `pnpm verify:bundles`. A build does not establish type safety.
- **Smoke:** run or extend smoke tests only for a named integration risk narrower checks cannot establish, such as installed startup, script-world wiring or iframe entry/exit. Reuse fixtures and build before `pnpm smoke:chromium` or `pnpm smoke:firefox` (both install the built extension; Firefox smoke is advisory in PR CI until TME-112's ten-green-runs condition).
- **CI:** PRs run only affected tests (`scripts/test-impact.mjs`), Chromium by default and Firefox for shared-infrastructure paths; the `check` job aggregates the gates. Merges to `main`/`dev` start no test round: the full suite runs nightly and on release. Live-service E2E is a separate nightly, non-blocking lane (`live-e2e.yml`). Preserve these lanes; see [`docs/browser-tests.md`](docs/browser-tests.md).
- **Local browser setup:** see [`docs/browser-tests.md`](docs/browser-tests.md) for matching Playwright builds and the macOS 27 Firefox app-data access workaround.
- **Real hosts:** verify host-dependent behavior with the intended extension build and active theater/RTE state. Capture screenshots for appearance, video for timing when useful. Fixture checks do not prove authenticated host behavior; diagnostic injection is not an installed-extension pass. Recorded host fixtures (`test/host-fixtures`) are still fixture evidence; PRs label which kind they provide.
- **Finish:** run `git diff --check`. Report skips and coverage gaps. Repeat successful checks only after relevant edits or new evidence.

## Storybook

Storybook (HTML, no framework; `.storybook/`, `*.stories.ts` beside the component) renders the production player UI from `src/ui` against the real stylesheets, in the real shadow root, with only `chrome.storage` and the language catalog stubbed. It proves component rendering and behavior, not host behavior.

- **Commands:** `pnpm storybook` (dev server), `pnpm storybook:test` (story `play` functions and component cases in a real browser; `STORYBOOK_BROWSER=firefox` for Firefox), `pnpm storybook:shots` (deterministic PNGs in `output/storybook-shots/chromium/`; `storybook:shots:firefox` for Firefox).
- **Screenshots in PRs:** UI screenshots come from `pnpm storybook:shots`, or are explicitly labeled as real-host captures. Do not attach hand-drawn or mocked images.
- **Stories render production components.** If a component reaches into `PlayerSession`, providers or `chrome.*`, extract explicit inputs (state, callbacks, strings) as `volume-control.ts` does; do not re-implement it in a story.
- **Animated UI (HUDs, notices) takes its clock.** Timed UI accepts a `UiClock` (`src/ui/ui-clock.ts`); stories pass a manual clock from `.storybook/hud-stage.ts` and advance it instead of waiting. Stories tagged `frames` are shot with every animation held at fixed fractions (`window.__storyFrame`); `no-shot` stories are lifecycle assertions with nothing worth a picture, `live` ones run on real time. Assert lifecycle (shows, hides after its timeout, re-trigger resets, cleanup leaves no nodes, timers or animations), not elapsed milliseconds.
- Storybook is a devDependency only; nothing under `.storybook/` or `*.stories.ts` is imported by an extension entry point.

## Docs and tracking

- **Notion** is the source of truth for requirements, architecture and durable decisions. Consult relevant pages when needed; flag conflicts with implementation.
- **Linear** tracks scope, status, priorities, dependencies and acceptance criteria. Mark work complete when those criteria are met and verification gaps are explicit.
- **GitHub** records code, PRs, CI and reviews. Link related artifacts instead of keeping competing status copies.
- **Notion, not `docs/`, for decisions.** ADRs, audits, research, proposals, plans and status notes go to Notion and are linked from Linear or the PR. Never commit them under `docs/` or as new top-level files unless the maintainer explicitly asks. If a decision needs a page, write it in Notion or hand the text to the maintainer instead of adding a file.
- **Document the reason.** Local `docs/` is only for contracts, constraints and procedures that must change together with code and are maintained alongside it. Keep local explanations in comments; use documentation for reasoning that crosses boundaries. Link to code instead of enumerating its fields or narrating control flow.
- **Keep guidance current.** Rewrite or remove outdated text when a decision changes. Most UI tweaks need no new page. Temporary plans, scratch files and diagnostic captures stay outside committed source unless explicitly requested or needed as durable project evidence.

## Changelog entries on a development branch

- Keep task-owned entries in `## [Unreleased]` of `CHANGELOG.md` as a concise summary of the branch's final user-visible outcome. Review the complete branch diff (`git diff <target>...HEAD`) and the related existing Unreleased entries when writing or updating that summary.
- As development proceeds, rewrite or consolidate the entry for the feature. Fold implementation corrections, review feedback, UI iterations and changed approaches into its final description. Remove duplicates and descriptions of abandoned behavior. Keep commit-by-commit history in commits and PR discussions.
- Choose `Added`, `Changed` or `Fixed` against the behavior users already received in a release. Use `Fixed` for a bug in released behavior. Corrections to a feature still under development belong in that feature's `Added` or `Changed` entry, including when an earlier part of it has already merged into main but is unreleased.
- Describe what users can do and any important scope or limits. Omit internal debugging, temporary defects, performance counters and implementation details that do not affect the user-facing result.
- Before publishing or updating the PR, reread its changelog diff as release notes: it must cover the net result of all development on the branch without requiring the reader to know its intermediate versions. Preserve unrelated entries and released sections; do not create a version or release date without explicit approval.
- Example: adding Raised captions and then correcting their placement during development yields one `Added` entry describing Raised captions in the letterbox band. The placement corrections are folded into that description, not listed under `Fixed`.

## Delivery

- **Branch model.** `main` is releasable: fixes and 2.0.x work land there. `dev` is the 2.1 integration branch for large changes (Linear milestone 2.1); PRs for 2.1 work target `dev`, and agents branch from `origin/dev`. `.github/workflows/sync-dev.yml` merges `main` into `dev` every two days (or on dispatch); on conflicts it opens an issue, resolve with `git switch dev && git merge --no-ff --no-commit origin/main` (a merge commit, never squash or rebase). After a successful sync the workflow runs `pnpm lint` and `pnpm typecheck` on `dev` (read-only, no caches) and opens an issue titled "dev ← main sync broke lint/typecheck" on failure; the run ends red but the merge stays pushed. Merge `dev` into `main` once, for the 2.1 release, by a rebase merge or a local merge commit, **not** a squash. GitHub deletes PR head branches on merge (`delete_branch_on_merge`), so protect `dev` from deletion before ever opening a PR with `dev` as its head.
- **Changelog across branches.** 2.1 features go in `[Unreleased]` on `dev`; fixes shipped from `main` go in `main`'s `[Unreleased]`. When merging `main` into `dev`, run `node scripts/merge-changelog.mjs` before committing, even without a conflict: it places `main`'s new release sections below `dev`'s `[Unreleased]` and drops entries `main` released from it. If it declines (usually because `main`'s `[Unreleased]` has entries not yet released), fold those into `dev`'s `[Unreleased]` by hand; the sync workflow runs the script itself and opens its issue only in that case or for other conflicts.
- Check the checkout and `git status` first. Preserve unrelated changes and untracked files; keep the diff reviewable.
- Continue within the authorized scope. Ask when missing information changes the outcome or additional authority is needed. Branches, commits, pushes and publishing require authorization; permission to commit or push does not authorize a version bump, release tag or release workflow.
- Stop only processes or browser sessions you started for the task, using their recorded identity. Preserve the developer's running sessions and settings.
- Never create a branch, commit or gist just to host screenshots, videos or other PR media. Upload them with `gh pr create|edit|comment --attach './file.png#alt text'` and reference them from the PR body; commit an asset only when it is durable project documentation under `docs/`.
- Report the resulting behavior, important choices, checks actually run and remaining gaps. Distinguish source/test evidence from live runtime evidence.

## Pull requests

- **Link the Linear issue when there is one.** Linear is the maintainer's tracker; outside contributors have no access, so a Linear key is never required of them and its absence never blocks a PR. For maintainer and agent work, remote branches stay `feature/*`, so Linear cannot match a PR by branch name. Put the issue key in the PR description (or title) with a magic word: `Closes TME-123` when merging completes the issue, `Part of TME-123` when it only advances it. Use the issue's acceptance criteria to choose. If the task has an issue, never leave the PR unlinked; if it is unclear which issue applies, ask. Reference public GitHub issues with `Fixes #123` as usual.
- **Let Linear move status.** Do not edit issue status by hand to mirror the PR; the GitHub integration handles open, review and merge transitions. Add a Linear comment only for facts the PR cannot show, such as live-host verification.
- **Title in Conventional Commits form.** `type(scope): description` with `feat`, `fix`, `docs`, `refactor`, `perf`, `test`, `chore`, `build`, `ci`, `copy` or `revert`; the squash-merge keeps it as the commit subject. `.github/workflows/pr-title.yml` warns when it does not match.
- **Use the PR template.** Structure the PR body with `.github/pull_request_template.md`; `gh pr create --body` does not apply it automatically.
- **Describe the PR for a reviewer.** State the user-visible outcome, why, the checks run and remaining gaps (see Verification and Delivery). Attach screenshots or video with `--attach`.
- **Keep one outcome per PR.** For stacked work, target the parent branch, say so in the description, and link every layer to its issue.
