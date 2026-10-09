# Theater Everywhere

## Product

Theater Everywhere is a TypeScript extension for Chromium and Firefox, built with Vite and pnpm. It maximizes HTML5 players and adds shared playback controls; Rich Theater Experience (RTE) supplies optional service integrations. Protect generic playback, native host behavior, browser compatibility and low overhead. The extension should improve watching without getting in the way.

`AGENTS.md` is the canonical guide. Keep `CLAUDE.md` as a relative symlink to it. Follow the developer's explicit instructions when they override these defaults.

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
- **Execution:** top-level pages, iframes and MAIN/isolated worlds where applicable.
- **Browsers:** Chromium and Firefox, including known differences.
- **Reverse states:** enter/exit, enable/disable, replacement, navigation and restoration. Keep both behavior and visible state correct.

This is an impact check, not a demand to run every browser or smoke test. Verify applicable paths proportionately; state when a path is unaffected or unverified.

## Verification

Use the smallest useful proof. Broaden checks when risk crosses shared contracts, browser targets or packaging. Preserve CI gates.

- **Docs only:** check content, links, symlinks and whitespace. Skip application tests and builds.
- **TypeScript:** run `pnpm typecheck` and relevant tests with `pnpm exec tsx --test <test-file> [...]`. `pnpm test` lists files explicitly in `package.json`; register new tests there when needed.
- **Regressions:** cover meaningful behavior and failure modes, including stale results and cleanup where relevant. Tests should catch a plausible bug, not mirror implementation. Simple reversible changes do not automatically need new tests.
- **Determinism:** wait for observable state. Use fake timers or an injected clock for time semantics. Avoid arbitrary sleeps and retries that mask races; do not assert exact GPU-dependent output.
- **Builds:** bundling, entrypoint, manifest and packaging changes warrant `pnpm build` and `pnpm verify:bundles`. A build does not establish type safety.
- **Smoke:** run or extend smoke tests only for a named integration risk narrower checks cannot establish, such as installed startup, script-world wiring or iframe entry/exit. Reuse fixtures and build before `pnpm smoke:chromium` or `pnpm smoke:firefox`.
- **Real hosts:** verify host-dependent behavior with the intended extension build and active theater/RTE state. Capture screenshots for appearance, video for timing when useful. Fixture checks do not prove authenticated host behavior; diagnostic injection is not an installed-extension pass.
- **Finish:** run `git diff --check`. Report skips and coverage gaps. Repeat successful checks only after relevant edits or new evidence.

## Docs and tracking

- **Notion** is the source of truth for requirements, architecture and durable decisions. Consult relevant pages when needed; flag conflicts with implementation.
- **Linear** tracks scope, status, priorities, dependencies and acceptance criteria. Mark work complete when those criteria are met and verification gaps are explicit.
- **GitHub** records code, PRs, CI and reviews. Link related artifacts instead of keeping competing status copies.
- **Document the reason.** Local `docs/` hold code-adjacent contracts, constraints and procedures. Keep local explanations in comments; use documentation for reasoning that crosses boundaries. Link to code instead of enumerating its fields or narrating control flow.
- **Keep guidance current.** Rewrite or remove outdated text when a decision changes. Most UI tweaks need no new page. Temporary plans, scratch files and diagnostic captures stay outside committed source unless explicitly requested or needed as durable project evidence.

## Delivery

- Check the checkout and `git status` first. Preserve unrelated changes and untracked files; keep the diff reviewable.
- Continue within the authorized scope. Ask when missing information changes the outcome or additional authority is needed. Branches, commits, pushes and publishing require authorization; permission to commit or push does not authorize a version bump, release tag or release workflow.
- Stop only processes or browser sessions you started for the task, using their recorded identity. Preserve the developer's running sessions and settings.
- Report the resulting behavior, important choices, checks actually run and remaining gaps. Distinguish source/test evidence from live runtime evidence.
