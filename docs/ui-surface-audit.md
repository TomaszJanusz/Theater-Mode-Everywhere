# UI surface audit for TME-125

Read-only source audit, 2026-10-20, against `origin/dev` at `739f259`.
Recommendation: preserve plain TypeScript and the existing shadow host; consolidate
surface lifecycle at two existing shells before considering further components.
The [proposed ADR](adr/0001-ui-surface-testability.md) is awaiting maintainer acceptance.
This audit changes no runtime, tests, settings or external tracker records.

## Scope and measurements

Inspected all production files directly in `src/ui/`, their browser/unit tests,
shared test helpers, and the modal/accessibility, caption-dialog and native-chat
boundaries. Popup/options were inspected for shared interaction patterns only.
Counts below describe this checkout, not a rerun of the historical CI benchmark.

| Measure | Current source evidence |
| --- | --- |
| Production UI files | **50: 48 TypeScript, 2 CSS**; no runtime UI toolkit |
| UI test files | **54: 38 browser, 16 other `*.test.ts`** |
| Surface/control families | **22** rows below, grouped by interaction/lifetime; variants are listed rather than counted as new components |
| Layer declarations in UI | **44**: 40 in `shadow.css`, 1 in `modal.css`, 2 embedded in `discovery.ts`, 1 quoted style property in `player-runtime.ts` |
| Layer values | **15 distinct numeric literals** in UI CSS/embedded CSS, plus `var(--theater-video-z, 2147483647)` in runtime |
| Wider layer scope | **64 declarations** across production `src/` TS/CSS; options adds 5, popup adds 0. This includes provider presentation and native-chat layers, which a UI surface primitive cannot simply remove |
| Focus touchpoints | **12 UI modules** reference focus/blur, active element, focus events or `containModalFocus`; **9** directly call `.focus()`/`.blur()` |
| Lifetime ownership | **11 UI modules** mention `DisposableScope` (including type-only consumers); modal uses AbortController plus explicit disposers instead |
| Time | **13 UI modules** contain direct `setTimeout` calls; scope timers/RAF and animations add other scheduling paths |
| Stable surface hooks | **0** uses of the proposed `data-te-surface`, `data-te-state`, `data-te-owner` contract |
| Whole-runtime test references | **20 UI browser files** directly reference `bootstrapPlayerRuntime` or call `bootPlayer`; 1 more UI suite boots through `player-scenarios/fixture.ts`. Not every case in those files boots the runtime |

Reproduction: enumerate direct `src/ui/*` files, exclude `*.test.ts`, and group
extensions; enumerate tests by suffix. For layers, inspect `rg -n 'z-index|zIndex'
src popup options` excluding tests/test-utils and comments, including quoted TS
style keys; normalize `!important`, retain variable expressions separately. Focus
touchpoints match `\.focus\(|\.blur\(|focusin|focusout|activeElement|containModalFocus`
in production UI files, with comments excluded. Counts indicate review locations,
not independent implementations or confirmed bugs.

The historical [Notion audit](https://app.notion.com/p/3fd19f2ad838811fa845f7eefb9a93ab)
and [TME-125](https://linear.app/privacybrand/issue/TME-125) report 24 layer values,
about 10 focus modules and a 1.3 MB runtime fixture on `main` at `5d50ba0`.
Those have different dates/scopes. **24 values is not the current `src/ui/` count**;
neither focus search matches nor z-index declarations establish behavioral duplication.
No fresh bundle-size or timing measurement was made here (dependencies are absent).

Two important baseline corrections:

- [root.ts](../src/ui/root.ts) already owns a shadow host with a manual popover,
  through [top-layer.ts](../src/ui/top-layer.ts). The ticket's “no showPopover”
  premise is obsolete; there is still no native `showModal` in the UI implementation.
- [test-utils](../src/test-utils/) already supplies process-cached bundles,
  browser/context ownership, engine selection, CSS loading, storage stubs and media
  fixtures. TME-114 is partly implemented; a component fixture should compose these.

## Surface and control inventory

Layer abbreviations refer to [shadow.css](../src/ui/shadow.css) unless stated:
`max` = 2147483647, `bar` = 2147483646, `menu` = 2000000000 → 2000000003
when open. These are current values, not a proposed scale. Nested decorations
also use -1/0/1; scrubber layers use 1–5. CSS positioning is not native anchoring.
“No Escape” below means that surface does not independently own it; runtime may
still cancel pending entry or exit theater. “DOM lifetime” means listeners attached
to removed nodes, not a claim that all associated work is explicitly scoped.

| # / family and construction | Layer and positioning | Focus, Escape and dismissal | Cleanup, time and present tests/hooks |
| --- | --- | --- | --- |
| 1. Player host + announcement region: [root.ts](../src/ui/root.ts), [top-layer.ts](../src/ui/top-layer.ts) | Manual top layer; fixed viewport, fallback in [host-frame.css](../src/host-frame.css) | Host takes no focus; manual popover ignores Escape/light-dismiss. Live region is `role=status` | Top-layer `DisposableScope` owns listeners, attribute observer and coalesced RAF. Root tears down appearance, modal and announcement timeout. `top-layer.browser.test.ts`; host ID, `:popover-open`, motion attributes |
| 2. Playback toolbar/backing/notch: [controls.ts](../src/ui/controls.ts), [toolbar.ts](../src/ui/toolbar.ts) | Fixed bottom bar; `bar`; local backing/notch layers; picture insets and caption-dock geometry | Focus/hover/drag keeps controls visible; hidden header is inert. Runtime owns theater Escape; picture dismissal and blur are coordinated here | Controls scope + manual `_videoListenersCleanup`; toolbar owns real 2500 ms timer and dock observers/RAF. `playback-chrome`, `controls-notch`, `pinned-controls-backing`, `fullscreen-activity`, `smoke-regressions` browser suites; classes/store |
| 3. Action/toggle buttons: `controls.ts`, [player-settings.ts](../src/ui/player-settings.ts), [chat.ts](../src/ui/chat.ts) | In toolbar/settings flow, common `.theater-control-btn` / settings-row CSS | Native button activation, aria labels/pressed state; mouse activation often blurs. Play/pause, previous/next, fit/layout, cycle, fullscreen, PiP, pin, help, auto entry, extension settings, boost/audio, captions, chat | DOM handlers and controls scope/store subscriptions; command semantics remain with runtime/providers. `accessibility`, `playback-chrome`, `audio-block`, `bass-icon`, `volume-wheel` browser tests. Classes and selected data attributes; no common surface hook |
| 4. Settings menu and section/row controls: `player-settings.ts`, `controls.ts`, `chat.ts` | Absolute anchored panel, `menu`; shared notch; held-left position during settings drags | [bindMenuPopover](../src/ui/menu-popover.ts): hover opens, click pins, keyboard focuses first eligible button. Escape returns trigger focus; focus-leave/outside/window blur closes | Caller `DisposableScope` owns binding; held position released on close/resize. No hide timer. `settings-rows`, `player-settings-order`, `new-badge`, `playback-hud` browser tests; `data-settings-section`, classes, aria-expanded |
| 5. Caption language/search menu: `controls.ts`, [cc-menu.ts](../src/ui/cc-menu.ts) | Same menu shell and layer; scrolling list under fixed header | Shared hover/pin/Escape shell; CC controller owns search, clear-before-close Escape, row arrows and focus preservation after replacement | CC `DisposableScope` and controls scope; list MutationObserver in shell. `cc-menu`, `cc-menu-rows`, `accessibility` browser tests; `data-track-id`, roles/classes |
| 6. Volume and speed slider panels: `controls.ts`, `bindSliderPopover` in `menu-popover.ts` | Absolute vertical panels: 1000 → 2000000003 when exposed; range fill/ticks/value text | Hover/focus opens; panel inert otherwise. Open panel consumes Escape and focuses trigger; next Escape reaches runtime. Outside click blurs; volume button also toggles mute | Controls scope; no independent panel timer; volume wheel uses performance clock. `playback-hud`, `volume-wheel`, `accessibility`, `controls-notch`; input aria values/classes |
| 7. Scrubber, ranges, heatmap/chapter markers and seek preview: `controls.ts` | Relative track layers 1–5; tooltip clamped over timeline (tooltip layer 40) with preview/chapter/time; marker rendering supplied by media features | Slider role and keyboard seek; drag scopes for mouse/pointer/touch. Preview is passive, hides on leave/reset; theater Escape remains runtime-owned | Controls/gesture/seek scopes; RAF tooltip updates and real seek throttle/completion paths. `scrubber-tooltip`, `playback-chrome`, `fullscreen-activity`, `smoke-regressions`; classes, aria-valuetext |
| 8. Button tooltip / playlist preview: [button-tooltip.ts](../src/ui/button-tooltip.ts) | One lazily created shared fixed tooltip, `max`, above/below trigger; horizontal clamp | Mouse enter/leave/click, no independent keyboard focus or Escape; menu descendants excluded | Listeners follow target DOM; tooltip follows root lifetime. No timer; layout reads on show. Indirect playback/accessibility/playlist tests; no dedicated tooltip conformance suite, classes |
| 9. Shared modal shell: [modal.ts](../src/ui/modal.ts), [modal.css](../src/ui/modal.css), [accessibility.ts](../src/accessibility.ts) | Fixed viewport overlay, `max`; ordinary divs with dialog role, **not** native dialog | Initial focus, Tab containment, inert siblings across shadow boundary, guarded focus return; Escape/backdrop/close/actions, optional invocation shortcut | AbortController, branch-removal observer, scroll/focus restoration, abort/pagehide/root disposal; double close guarded. No timers. `modal.browser.test.ts` already covers both engines and repeat cleanup; classes/role, no standard hooks |
| 10. Modal content families: [help.ts](../src/ui/help.ts), [dialog.ts](../src/dialog.ts), [whatsNew.ts](../src/whatsNew.ts), [caption-options-dialog.ts](../src/media-features/caption-options-dialog.ts), [automatic-entry/launcher prompt](../src/ui/auto-theater-settings.ts), options privacy/shortcut flows | Shared modal shell; wide/scrollable variants, palette/range/select/reset controls inside caption form | Shell owns trapping/dismissal. Help maps return focus to surviving menu trigger; captions carry return target/signal; page dialog wraps boolean result and language updates | Content callbacks/subscriptions disposed by wrapper/closed promise. `modal`, `caption-options-close`, options `shortcut-management`, `new-badge`, `smoke-regressions` tests. Content classes/labels |
| 11. Center feedback HUD: [hud.ts](../src/ui/hud.ts) | Fixed picture center, `max`; volume/mute, play/pause and status/audio confirmations reuse plate/slot | Passive, aria-hidden with separate announcement; no focus/Escape or pointer dismissal | Real hide/remove timers; identity + media/epoch checks; explicit timer removal. `playback-hud`, `bass-hud`, `hud-spacing` browser tests; `data-playback-action`, `data-level`, classes |
| 12. Seek circles: `hud.ts` | Picture-side fixed circles, `max`, directional animation | Passive/aria-hidden; announcement separate | Real 650 ms removal callback tied to captured node, not `DisposableScope`; root removal also removes DOM. `playback-hud`, `hud-spacing`; direction classes |
| 13. Caption loading/status HUD: `hud.ts`, [spinner-exit.ts](../src/ui/spinner-exit.ts) | Fixed corner plate, `max`, width morph/spinner/text reveal | Passive; announcement separate; no focus/Escape | Real delayed show/hide/remove timers; identity/media/epoch guards and animation cancellation. Spinner owns observer/alarm/animations and stale callback guard. `caption-loading`, `spinner-exit`, `hud-spacing`; classes |
| 14. Buffering indicator: `controls.ts` | Fixed picture center, `max`, plate/spinner | Passive; no focus/Escape | Controls cleanup clears real delayed-buffer/failsafe timers, fullscreen recovery and node; provider clock determines buffering evidence. `playback-chrome`, `playback-hud`, `fullscreen-activity`; loading classes |
| 15. Header/home/title HUD: `hud.ts`, `toolbar.ts` | Fixed header, `max`; title marquee or static truncation with local backdrop | Home link native focus; title keyboard reveal consumes first Escape by blur; header inert when hidden | Title ResizeObserver/motion observer/RAF cleanup; CSS animation duration from geometry, toolbar hide timer. `title-hud-reduced`, `title-truncation` unit, playback suites; classes/tabindex |
| 16. Automatic-entry countdown notice: [auto-theater-notice.ts](../src/ui/auto-theater-notice.ts), [auto-theater-runtime.ts](../src/ui/auto-theater-runtime.ts) | Corner HUD plate, `max`; decorative digit/ring | `role=status`, click cancels, mousedown prevents focus. Runtime Escape cancels pending intent before exit | Idempotent returned cleanup; real digit timeout + WAAPI ring; remaining-time callback supplied by intent. Runtime scope owns delayed mount; intent has injected clock/timers. `auto-theater-notice`, `auto-theater-runtime`, `auto-theater-storage` browser tests; classes/aria |
| 17. Automatic-entry scrim (disabled experiment): [auto-theater-scrim.ts](../src/ui/auto-theater-scrim.ts) | Fixed viewport, 2147483640; even-odd video cutout | aria-hidden, pointer-events none; no focus/dismissal | Explicit cleanup of resize/scroll/observer/RAF; microtask + transitionend + real removal fallback. Test-only enable seam; `auto-theater-scrim.browser.test.ts` |
| 18. Video activator/launcher: [video-activator.ts](../src/ui/video-activator.ts) | Fixed overlay at `bar`, pure candidate boxes in [placement module](../src/ui/video-activator-placement.ts), or provider-owned native slot | Floating launcher Escape dismisses/blurs; pointer press preserves page focus; re-mount preserves keyboard focus. Persistent slots use host toolbar visibility | Root/tracking/pointer/geometry scopes; real idle timer/performance clock, observers/RAF. `video-activator` browser/unit and placement unit tests; class/native title, provider slot identity |
| 19. Service action CTA stack: [service-actions.ts](../src/ui/service-actions.ts) | Fixed picture corner, `bar`, toolbar lift/insets; progress/sweep decorations | Native buttons; no modal focus or Escape. Suppressed while menu open. Source validates activation | Caller scope, subscriptions/visible refresh, cancellable progress RAF; provider owns expiry/countdowns. `service-actions.browser.test.ts` mounts module independently; data-service-action-id, classes |
| 20. Inline badges, keycaps, icons and time readouts: [new-badge.ts](../src/ui/new-badge.ts), [kbd-text.ts](../src/ui/kbd-text.ts), [svg-icon.ts](../src/ui/svg-icon.ts), [time-readout.ts](../src/ui/time-readout.ts) | Inline/absolute decorations; no independent surface layer | Native semantics of containing control; decorative content hidden appropriately. Beta can retain native title; no independent dismissal | Readout CSS transition + real settle timeout, per-node animation bookkeeping. Badge has optional custom-element registration in Settings and **span fallback in content scripts**. `new-badge`, `time-readout` browser/unit; data-variant/mode/ch/mask |
| 21. Theater stage/backdrop: [theater-layout.ts](../src/ui/theater-layout.ts) | Fixed black viewport backing behind video; `bar` in [content.css](../src/content.css), outside shadow host | aria-hidden and pointer-events none; no focus/dismissal | Explicit mount/unmount from runtime; no timers. Runtime playback suites and layout helpers tested; stage ID, no isolated component conformance |
| 22. Provider picture pointer catcher: `player-runtime.ts`, `toolbar.ts` | Fixed shadow-host shield, local z-index 1, below controls | No focus; forwards click/double-click to existing picture interaction gate; runtime owns keys | `bindWasmCatcher` returns listener/node cleanup, released on provider replacement/exit. Click gate owns delayed-click timers. No direct catcher-named test found; playback gate has unit tests, provider runtime paths have integration tests; `.theater-wasm-catcher` |

Non-rendering UI files do not add further surfaces: `appearance`, `picture-insets`,
`title-truncation`, `video-activator-placement` calculate geometry; `auto-theater`,
`auto-theater-intent`, `controls-visibility`, `picture-click`, `picture-dismiss`,
`seek-completion`, `fullscreen-recovery` model or coordinate behavior;
`auto-theater-settings`, `video-activator-settings`, `volume-boost-settings`,
`sponsorblock-settings`, `shortcuts`, `shortcut-updates`, `entry-shortcuts` own
preferences/commands; `store`, `runtime-context`, `messages` wire state/copy;
`discovery` handles media selection and injected host-shadow CSS;
`picture-in-picture` invokes native browser PiP. `chrome-visibility` observes existing
surfaces. Native PiP windows, host captions and host chat are not extension-built
components.

Caption rendering itself belongs to `src/media-features/`; its placement and
host-caption ownership must remain there. Native chat is also **host-owned**, not
a new extension modal: [ui/chat.ts](../src/ui/chat.ts) builds toggle/settings rows,
while [chat/controller.ts](../src/chat/controller.ts) reparents/restores host chat,
moves focus before hiding it, and owns scope, geometry and theme work. Chat
preferences debounce on a real 350 ms timer and flush on stop/pagehide. Coverage:
`native-chat.browser.test.ts` and chat controller tests. Its active marker deliberately
removes the UI host from the top layer so native popups can cover extension chrome.

## Focus, dismissal and lifetime findings

The 12 focus touchpoints are modal, menu-popover, cc-menu, controls, hud, toolbar,
player-runtime, chat, video-activator, help, chrome-visibility and auto-theater-runtime.
The last three delegate focus or observe it, rather than implementing a new trap.
Outside UI, `accessibility.ts` owns the trap; chat controller and MAIN-world/iframe
key relays are coordination boundaries. They are not ten equivalent focus managers.

Actual overlap is narrower:

- Menu and slider bindings both derive openness from hover/focus, synchronize inert,
  and consume Escape; controls additionally owns outside press/click and window blur,
  toolbar closes those panels again, and runtime recognizes specific focused panels
  before deciding to exit. **Four modules** participate in this dismissal path.
- Modal return/teardown is already centralized. Help's trigger mapping and CC search
  navigation are content policies; replacing them with a universal focus policy
  would lose behavior, not remove duplication.
- Center/caption HUDs each implement timed visible → fading → removed lifetimes.
  Seek removal, scrim fade fallback, buffering and readout timers have different
  semantics. A small owned timed-visibility helper is plausible for the first two;
  a single animation/countdown scheduler for all six is not justified.
- Button tooltips, scrubber preview and options listbox mix box measurement with
  clamping/flip arithmetic. Pure rectangle calculations are extractable; preview
  media loading, pointer tracking, caption collision avoidance and launcher occlusion
  are distinct inputs, not one universal positioning engine.

`DisposableScope` already has child lifetimes, abort, listeners, timeouts and RAF.
Use it rather than inventing another disposal container. Remaining manual ownership
is a review/migration opportunity, not proof of leaks: modal is explicitly idempotent;
HUDs have epoch guards; tooltip listeners are node-owned; seek's late callback only
removes its captured node. Preserve these guarantees when moving code.

## Popup/options pattern check

[Options combobox](../options/combobox.ts) is the clearest additional positioning
consumer: fixed body listbox, z-index 100 in options CSS, RTL alignment, clamp/flip,
outside pointer/scroll/resize/hash dismissal, AbortController + observer cleanup.
Focus stays on the trigger with `aria-activedescendant`; performance time bounds
typeahead. **Do not substitute menu row focus or hover pinning for this behavior.**
`combobox.browser.test.ts` already exercises it independently in both engines.

Options tabs and [choice grid](../options/choice-grid.ts) have roving focus; RTE tiles
preserve focus on sort/filter; shortcut editor restores focus after async save and
uses the shared modal. These are different control semantics. Options appearance,
privacy, highlights and conflict dialogs reuse existing builders. Popup uses native
checkbox/buttons and [RTE settings binding](../popup/rte-settings.ts), with storage
listeners and unload cleanup, no separate floating layer/focus manager. Shared
settings normalization and modal CSS should stay shared; popup/options should not
import the player coordinator or a new universal UI context.

## Tests today and the smallest useful replacement

Whole-runtime references are in these UI browser files (names omit `.browser.test.ts`):
`accessibility`, `audio-block`, `auto-theater-settings`, `auto-theater-storage`,
`caption-loading`, `caption-options-close`, `fullscreen-activity`, `modal`,
`native-chat`, `new-badge`, `playback-chrome`, `playback-hud`, `player-settings-order`,
`scrubber-tooltip`, `spinner-exit`, `title-hud-reduced`, `top-layer`, `video-activator`,
`video-selection`, `volume-wheel`. `smoke-regressions` additionally boots via
[player-scenarios/fixture.ts](../src/test-utils/player-scenarios/fixture.ts).
Outside UI, the provider sponsorblock browser suite also references the runtime.
This list is reproducible with
`rg -l 'bootstrapPlayerRuntime|bootPlayer\(' src/ui/*.browser.test.ts`, plus inspection
of imported fixture helpers; it is not a count of individual boot calls.

Examples worth separating:

- `modal.browser.test.ts` bundles runtime, MAIN world, page wrappers and modal together,
  even for shell/style and repeat-cleanup cases. Keep its host-key/exit integration
  case; mount only the modal for shell conformance.
- `playback-hud.browser.test.ts` boots the player to check center geometry **and**
  to check settings/speed/volume dismissal. Geometry and dismissal shell checks can
  be small fixtures; retain command → HUD and picture-click playback integration.
- `player-settings-order` and the player part of `new-badge` involve the runtime for
  individual settings behavior; move only pure order/badge rendering assertions
  downward, preserving live storage/rebuild integration.
- Counterexamples matter: `cc-menu.browser.test.ts` bundles only `bindMenuPopover`;
  `settings-rows.browser.test.ts` mounts factories with a context rather than booting
  `player-runtime`; `hud-spacing`, notice and service-action suites are already small
  entrypoints. They need reusable fixture setup, not a wholesale test rewrite.

Tests currently assert classes, roles, aria values, text, store data and measured
geometry. Some use `page.clock` already (notice, HUD and top-layer suites); injected
`now/setTimer/clearTimer` already exist in auto-entry intent and the picture-click
gate. WAAPI/CSS animations still use the document timeline: fake JS timers alone
do not make animation pixels deterministic. Observe finished/cancelled state or
use reduced motion for lifecycle checks; retain separate animation integration.

Reuse [player-boot.ts](../src/test-utils/player-boot.ts) `bundleModules` and CSS loaders,
[chrome-stub.ts](../src/test-utils/chrome-stub.ts), [test-browser.ts](../src/test-utils/test-browser.ts)
and [test-engines.ts](../src/test-utils/test-engines.ts). The Chrome stub intentionally
supports seeded sync/local get/set and onChanged, with an empty runtime; it is not
a browser API emulator. Browsers are shared **per file/suite**, not across every
worker/file, and bundles cache per process/entry set.
[scripts/test-harness.ts](../scripts/test-harness.ts) already ratchets direct launches,
esbuild imports and copied stubs, and budgets direct test-utils modules at 150 lines
and four options. Scenario helpers under `player-scenarios/` are integration
scenarios, not an appropriate component base class.

The smallest consolidation is **two retained interaction shells** (modal and
anchored panel, with menu/slider policies), **one shared layer/lifetime boundary**,
and **pure placement helpers extracted only at real consumers**. Keep native buttons,
ranges, badges, forms, toolbar layout, caption dock, host chat and provider clocks
as they are. No monolithic component tree, universal props bag, global overlay bus,
custom-element toolkit, renderer or runtime dependency is warranted.

## Evidence limits

This is source/test inspection, not a fresh test run, installed-extension smoke,
authenticated-host check or visual review. The known late-host-modal and native-chat
limits in [top-layer.md](top-layer.md) remain. No runtime path changed in this PR;
Chromium/Firefox, iframe/isolated-world behavior, generic/RTE playback and reverse
states are proposed validation scope in the ADR, not verified new behavior.
