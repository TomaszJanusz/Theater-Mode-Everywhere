# Theater Everywhere — agent guide

This is a TypeScript browser extension for Chromium and Firefox, built with Vite and pnpm. It maximizes video players and adds shared playback UI with optional service integrations. `AGENTS.md` is the canonical instruction file; `CLAUDE.md` must remain a relative symlink to it.

## Engineering principles

- Aim for ambitious outcomes through simple systems and behavior that feels obvious. Understand the real constraint, then choose the smallest model that makes correct behavior unsurprising.
- Measure twice, cut once: trace the relevant execution path, ownership and failure modes before editing. Investigate enough to resolve uncertainty; avoid analysis that does not affect the decision.
- Honor the developer's intent in a minimal, realistic way. Complete the requested behavior, including necessary integration and cleanup, without expanding into adjacent features or unrelated refactors.
- Apply YAGNI: implement today's requirements. Do not add speculative extension points, dependencies, configuration layers or frameworks for architectural appearance.
- Do not preserve accidental complexity merely because it exists. Simplify within the task's scope when the simpler design preserves required behavior and compatibility.
- Apply DRY to knowledge and behavior: one owner for each rule, state transition and calculation. Similar syntax alone does not justify combining code with different responsibilities.

## Code quality and modularity

- Prefer small, cohesive modules with explicit inputs, outputs and ownership. Separate pure parsing/calculation from DOM access, network requests and side effects.
- Search for existing contracts and helpers before adding new ones. Put reusable behavior at the narrowest shared boundary that needs it; avoid copying a feature into each provider or creating a generic utility with unrelated responsibilities.
- Extract abstractions from concrete use cases. A small interface is useful when it isolates a real boundary, even with one implementation; hypothetical future consumers are insufficient justification.
- Keep entrypoints and composition code focused on wiring. Put domain behavior in the module that owns it, and keep provider details out of shared player components.
- Use precise TypeScript types and validate external data at boundaries. Avoid broad `any`, unchecked casts and silent fallbacks that hide invalid state.
- Follow local naming and formatting. Use comments to explain constraints and non-obvious decisions. Remove obsolete code made redundant by the change; avoid unrelated cleanup.

## Repository boundaries

Read [`docs/player-provider-contracts.md`](docs/player-provider-contracts.md) before changing player/provider boundaries, and consult the relevant feature documentation under `docs/`.

- `src/providers/`: host detection, selectors, native player APIs, clocks, availability, presentation and service commands. Providers translate host behavior into shared contracts.
- `src/core/`: player/session ownership, shared lifecycle and coordination. Reuse `PlayerSession` and `DisposableScope` where appropriate.
- `src/ui/`: shared rendering, controls, menus, input and layout. Consume capabilities and contracts rather than adding service-specific branches.
- `src/media-features/`: media adapters, metadata, caption operations, parsing and rendering. Preserve existing host-caption ownership and user preferences.
- `src/platform/` and `src/protocol/`: browser/page integration and cross-world/frame communication. Retain message validation, provenance and session checks.
- `popup/`, `options/`, `_locales/` and `src/i18n.ts`: extension settings and localized UI. Keep message keys, placeholders and fallbacks consistent across catalogs.
- `scripts/`, `manifest.json` and `.github/workflows/`: build, packaging and delivery. `dist/` and ZIPs are generated artifacts; change their sources and do not commit generated packages.

## Runtime invariants

- Async results and observer callbacks must belong to the current session, media and adapter before mutating state or UI. Use existing epoch/identity checks and cancellation; an `AbortSignal` alone does not protect every continuation.
- Every listener, observer, timer, subscription and host mutation needs an owner and cleanup. Rebinding, SPA navigation and theater exit must reject stale work and restore host state. Cleanup must be safe to repeat.
- Revalidate provider actions when activated, including identity and availability. Providers own native timing and expiry; shared UI displays their state.
- Preserve generic HTML5 playback, iframe behavior and Chromium/Firefox compatibility. Unavailable provider features should degrade through existing capability paths.
- Keep keyboard and pointer actions on the same behavior path. Preserve focus, accessible labels, menu handling and editable-field shortcut guards.

## Proportionate verification

Choose checks by the behavior and risk changed. State what each check establishes. Preserve required CI gates; selective local verification is not permission to weaken them.

- Documentation-only changes: inspect content, links/symlinks and whitespace. Application tests, builds and browser smoke runs are unnecessary.
- TypeScript changes: run `pnpm typecheck` and relevant existing tests. Focused tests use `pnpm exec tsx --test <test-file> [...]`; `pnpm test` is an explicit file list in `package.json`, so register new tests there when needed.
- Add regression tests for meaningful failure modes and changed contracts. Assert observable behavior, including lifecycle or stale-result cases when relevant; avoid tests that merely mirror implementation or add maintenance cost without useful coverage.
- Shared lifecycle, protocol or widely used contract changes warrant broader tests. Bundling, entrypoint, manifest or packaging changes warrant `pnpm build` and `pnpm verify:bundles`. Build success does not establish type safety.
- Use smoke tests sparingly. Run or extend them for a concrete integration risk that narrower tests cannot establish, such as installed-extension startup, script-world wiring or iframe entry/exit. Identify that risk first, reuse existing fixtures and avoid duplicating unit coverage. Build before `pnpm smoke:chromium` or `pnpm smoke:firefox`.
- Provider behavior or visual changes that depend on a real host need targeted browser verification. Confirm the intended extension build and active theater/RTE state before measuring; capture screenshots when appearance matters. A fixture smoke test does not prove authenticated host behavior. Report skipped checks and unavailable browser/provider coverage explicitly; a diagnostic injection fallback is not an installed-extension pass.
- Run `git diff --check` before handing off. Repeat successful checks only after relevant edits or new evidence of a problem.

## Sources of truth and progress tracking

- Notion is the source of truth for product requirements, architecture, design decisions and durable project documentation. Consult the relevant project pages when the task depends on that context; flag conflicts with the implementation rather than silently choosing one interpretation.
- Linear is the source of truth for tracking work and progress: tasks, status, priorities, dependencies and completion criteria. Use the relevant issue to understand the scope and track actual progress; mark work complete only when its acceptance criteria are met and verification gaps are explicit.
- GitHub owns code, pull requests, CI and review evidence. When updating documentation or tracking work, link to the relevant Notion pages, Linear issues and GitHub artifacts instead of maintaining competing copies of status or decisions.

## Working and reporting

- Check the current checkout and `git status` first. Preserve unrelated modifications and untracked files. Keep the diff scoped and reviewable.
- Continue within the authorized task; ask only when missing information materially changes the outcome or an action needs additional authority. Do not create branches, commit, push or publish without authorization.
- Report the resulting behavior, important design choices, checks actually run and any remaining gaps. Distinguish source/test evidence from live runtime evidence. Never claim verification that did not happen.
