# ADR 0001: Small surface lifecycle and component-test contract

Status: **Proposed; implementation requires maintainer confirmation.**
Date: 2026-10-20. Scope: phase 1 of [TME-125](https://linear.app/privacybrand/issue/TME-125),
under [TME-111](https://linear.app/privacybrand/issue/TME-111).
Evidence: [UI audit](../ui-surface-audit.md), baseline `739f259`.
There was no existing ADR directory; this starts a numbered local convention.
The [Notion review](https://app.notion.com/p/3fd19f2ad838811fa845f7eefb9a93ab)
remains the requirements context. This proposal is not an accepted decision or an
update to Notion/Linear; the maintainer can link it there after review.

## Decision proposed

Keep hand-built TypeScript DOM and the existing shadow root. Retain `createModal`,
`bindMenuPopover` and the slider policy as component-facing owners. Extract only their
shared **surface lifetime and dismissal coordination** into `openSurface`; compose a
small component fixture from existing test helpers. Do not migrate the whole UI.

The current host already enters the top layer through
[bindTopLayer](../../src/ui/top-layer.ts), including fullscreen recovery and the
native-chat exception. Keep that single host policy. A surface is a mounted lifetime
inside that host (or the options document), not automatically another native popover.
Native per-surface promotion requires an observed layering gap and its own test.
This reconciles the ticket with [TME-105](https://linear.app/privacybrand/issue/TME-105)'s
maintainer decision to move the current UI as-is, with per-surface adoption only as needed.

### Runtime boundary

Proposed call shape, illustrative rather than a committed API:

```ts
openSurface({ kind: 'popover' | 'dialog' | 'hud', element, owner, anchor? })
// Returns an idempotent close(reason) / dispose() handle.
```

`element` is already rendered DOM; `owner` is the existing `DisposableScope` for
the current mount/session. `anchor` is required for anchored panels and absent for
unanchored dialogs/HUDs; encode this with a discriminated union, not runtime guesses.
Implement only dialog and popover first; add the HUD variant when a timed HUD adopts it.
Names here describe behavior, not a promise to use native `showModal` immediately.

- The boundary owns active-surface order, closed/open state, Escape/outside dismissal
  arbitration and release on owner disposal. At most one eligible surface handles a
  given Escape; no double registration of native and custom dismissal. Register only
  live surfaces, unregister on close; do not add a permanent DOM scanner or polling.
- Dialog policy owns initial focus, inert/trap release and focus return; reuse
  [containModalFocus](../../src/accessibility.ts) while the existing div modal remains.
  Preserve singleton replacement, result promises, language updates and scroll restore.
  Menu policy preserves hover vs pinned state, suppressed reopen, keyboard entry,
  search-first handling and focus-leave; slider policy preserves focused native ranges.
  These policies remain in their small existing modules, not switch branches in a
  new all-purpose manager. Add narrowly typed policy inputs only when these callers
  need them; do not copy `PlayerChromeContext` into the primitive.
- User Escape/close may restore a connected, visible, non-inert trigger; outside
  pointer dismissal must not steal focus. Owner disposal, replacement or navigation
  must not restore focus into a retired session. Reuse current media/epoch guards
  in async content callbacks; an aborted signal alone is insufficient.
- Teardown releases listeners, observers, timers, animations and inert/style changes
  exactly once, preserving prior host values. Use child scopes and existing disposers.
  Playback click suppression stays in the picture-click gate; dismissal reports its
  reason so the existing gate can consume the appropriate click without toggling play.
- Root/top-layer binding remains the sole native host entry/exit owner. If native
  dialog/popover children are later adopted, the boundary owns those calls and their
  ordering with host re-entry. Components do not set overlay z-index or call native
  promotion. Decorative local stacking and provider video/chat layers remain valid.

No production registration catalog is needed. The conformance registry described
below exists only in tests. Do not make a public API for arbitrary surfaces,
portals, nested modal stacks, dependency injection or provider resolution.

### Position and time

Extract rects-in/rect-out functions where tooltip/menu consumers actually need
clamp/flip and logical alignment. Inputs include viewport, measured anchor/panel,
direction and resolved safe insets; outputs contain placement/size constraints.
Node tests cover viewport edges, oversized panels, RTL and supplied safe-area
insets. DOM reads, CSS environment-inset resolution and writes stay in the binder;
resize/scroll updates are event-driven and coalesced. Reuse existing launcher and
caption geometry rules where their semantics match; do not combine occlusion,
caption avoidance, media preview and listbox behavior into a generic layout engine.

Use a fake browser clock installed **before mounting** for real window timers and
performance time. Pure time models retain injected now/timer seams. Add a small
clock dependency to a timed helper only if it must also run outside the browser;
do not pass a clock through every control. Scope owns cancellation. WAAPI/CSS
completion remains observable separately; avoid exact animation pixel assertions.

### Component fixture and hooks

`mountSurface(Component, props)` is a **test helper**, not a new runtime renderer.
`Component` is an ordinary typed mount function taking a parent/owner and plain
props (including capabilities and callbacks); it returns its existing disposer or
handle. An adapter can expose the existing modal/menu factories without requiring
every component to adopt a new object protocol.

The fixture prepares one page/shadow host, production CSS, a trigger, owner scope
and fake clock; it bundles only the chosen factory with `bundleModules`, installs
`installChromeStub`, and returns the handle/locators plus teardown. Reuse
`sharedTestBrowser` and engine selection. Compose hostile hosts separately instead
of growing a helper options bag beyond [existing budgets](../../scripts/test-harness.ts).
Chrome runtime messages/tabs are explicit per-test stubs when needed; no general
extension emulator. No player bootstrap, MAIN runtime, real video, network,
provider imports or storage hydration is necessary for shell conformance.
Fixture injection does not prove Chromium isolated-world installation behavior.

The layer boundary writes stable attributes on its root:

- `data-te-surface`: semantic family, such as `settings` or `help`, not translated text.
- `data-te-owner`: opaque mount identity, stable for that lifetime and renewed on rebind;
  no service name, session secret or random value that tests must hardcode.
- `data-te-state`: `open`, optional `closing` during a real exit, then `closed` before
  unmount. Do not add closing animation just for tests; immediate close can skip it.

Hooks supplement roles, aria and focus assertions. After removal, assert detachment
and settled handle state; do not keep closed nodes alive to satisfy a selector.
No copy/pixel snapshots in the lifecycle suite; locale and visual/layout tests keep
their own responsibilities. Input callbacks still revalidate current capabilities.

### Conformance by registration

One parameterized suite registers factory/props, opening action, trigger/root
locators and a **small explicit policy**: modal, anchored panel, later passive HUD.
Registering another instance of an existing policy supplies common coverage without
a new test file. New interaction semantics still need targeted tests: registration
cannot automatically validate CC search, range input, provider expiry or playback.

| Shared scenario | Required expectation |
| --- | --- |
| Open and state/ARIA | Correct root/owner/state; keyboard dialog/menu entry focuses expected control; pointer hover/passive HUD does not steal focus |
| Escape and outside press | Only active dismissible surface closes; correct focus return; hover/pin suppression preserved; passive HUD ignores these unless explicitly interactive |
| Focus containment | Dialog traps/excludes siblings; non-modal menu permits leaving; HUD never traps |
| Double close / teardown | Idempotent; original inert/scroll/style values restored, no late remount after clock advance; disposed owner cannot open |
| Owner change | Simulate dispose/recreate for navigation, theater exit and rebind; old callbacks cannot mutate new instance or focus it |
| Environment | Shared hostile-host scenarios below; no per-provider CSS patches in component fixtures |

Shared host-hostility fixtures: maximum-z overlay; transformed/contained/filtered
ancestor; aggressive global stylesheet; host popover before/after UI; host modal
before/after UI; and fullscreen. Check overlap by browser hit testing/geometry and
interaction state, not GPU-specific pixels. Run common lifecycle on every registration;
run host stacking/fullscreen on each **layer policy**, not every inline button.

Keep the documented [host limits](../top-layer.md): a later host modal can cover and
make the extension inert, and native-chat mode deliberately uses z-index. “Survives
host dialog” means expected ordering/inert behavior, no crash/leak, and recovery when
it closes; it cannot mean guaranteed clickability above every host modal. Test a
dialog opened before UI separately from one opened after. Do not add page-wide
dialog observers to satisfy an impossible universal assertion.

Component owner-disposal tests model lifecycle invalidation; retain a small player
integration test proving real SPA/rebind/exit wiring, key arbitration through shadow
and MAIN/isolated worlds, and the intended document-element fullscreen target.
Generic HTML5 and RTE on/off command paths, iframe ownership and native caption/chat
restoration still require existing integration/smoke and relevant real-host checks.

## Browser assumptions (verified 2026-10-20)

| Feature | Browser support | Repository consequence |
| --- | --- | --- |
| Popover | [Chromium 114+](https://developer.chrome.com/blog/introducing-popover-api), [Firefox 125+](https://developer.mozilla.org/en-US/docs/Mozilla/Firefox/Releases/125) | Covered by Chromium minimum 114 in [manifest](../../manifest.json) and Firefox minimum 140.0 generated by [build.ts](../../scripts/build.ts) |
| CSS anchor positioning | [Chromium 125+](https://developer.chrome.com/docs/css-ui/anchor-positioning-api), [Firefox 147+ enabled by default](https://developer.mozilla.org/en-US/docs/Mozilla/Firefox/Releases/147) | **Not covered by either manifest minimum**; Firefox 140–146 and Chromium 114–124 remain supported |

Keep manifest minimums. Use current CSS/rect placement as the baseline; no anchor
polyfill or new UI dependency. Defer CSS anchor adoption; if later useful, feature
detect the exact properties/syntax and test both native and forced fallback placement
in each engine, including actual minimum versions separately from current Playwright.
One happy-path test per engine would not establish this compatibility. The current
host's no-Popover z-index fallback remains; unsupported pre-minimum browsers receive
no new compatibility promise. Plain DOM + shadow DOM works in content scripts;
custom-element registries are unavailable in Chromium isolated worlds, as the existing
badge's span fallback already acknowledges. No web-component toolkit or MAIN-world
UI relocation is proposed.

## Phases and Linear-ready follow-ups

Effort below is an estimate in focused engineer-days, not a measured schedule.
The first implementation tranche is approximately **3–5 days**, after acceptance;
runner comparison and broad migration are separate. The ticket's 3–4 days is plausible
for a pilot, not for every surface and every host/runtime path.

| Proposed follow-up (no issues created) | Scope and acceptance criteria | Dependency / estimate |
| --- | --- | --- |
| A. Confirm runner and pilot budget | Use [TME-113](https://linear.app/privacybrand/issue/TME-113) to measure modal/menu fixtures on current Node+Playwright against the alternative; keep Node+Playwright provisionally, no runner migration in TME-125. Record both-engine cold/warm wall time and bundle size; preserve `pnpm test <substring>` | ADR acceptance; TME-113's separate 2-day timebox |
| B. Mount isolated modal and menu | Compose current helpers; two component-only entrypoints, fake clock before mount, minimal Chrome stub, production CSS, teardown and hooks; reject player runtime/provider dependencies. Respect helper budgets and harness ratchet | A, existing [TME-114](https://linear.app/privacybrand/issue/TME-114) helpers; 0.5–1 day |
| C. Share surface lifecycle at existing shells | Introduce narrow `openSurface` boundary with modal/menu adapters; preserve pointer hover/pin, Escape/focus return and invalidation; two-instance stale callback and double-dispose cases. No layout redesign or per-surface native promotion | B; 1–2 days |
| D. Register conformance and hostile hosts | Both engines, modal and menu registered; demonstrate third registration using another menu instance; shared stacking/fullscreen fixtures per policy. Measure total suite wall time including startup/bundle, target <30 s for initial two. Report any miss, no retries or assertion deletion to meet it | C; 1–2 days |
| E. Extract first placement calculation | Extract tooltip clamp at first adopting caller, add edge/RTL/safe-inset node cases and browser wiring proof. Defer CSS anchors and other geometry until an actual need | After pilot; optional 0.5–1 day |
| F. Adopt timed HUD policy | Start with centered/caption timed visibility if audit overlap persists; fake-clock cancellation/rebind coverage, preserve epoch guards and document-timeline animations. Keep provider deadlines external | After pilot; optional 1–2 days |
| G. Ratchet ownership and move narrow assertions | TME-119/121 enforce native overlay calls/overlay layer tokens only at owners, allowing local decoration/provider layers; TME-120 prevents component-provider imports. Move shell assertions out of mixed runtime fixtures, retain integration and installed smoke; update TME-105 cross-reference | After proven adapters; 0.5–1 day for pilot guard/test split, broad migrations separately scoped |

[TME-119](https://linear.app/privacybrand/issue/TME-119) already supplies ESLint/size ratchets in this checkout. Do not recreate it;
coordinate focused ownership enforcement with [TME-120](https://linear.app/privacybrand/issue/TME-120) and
[TME-121](https://linear.app/privacybrand/issue/TME-121). TME-114 owns
browser infrastructure migration, not a new component framework. The maintainer
should reconcile TME-125's outdated premise, host-dialog guarantee and broad
registration claim in Linear; this PR deliberately does not edit tracker records.

Stop after documentation approval for phase 1. No accepted ADR, <30 s measurement,
third registration, browser conformance pass or live-host verification is claimed here.
