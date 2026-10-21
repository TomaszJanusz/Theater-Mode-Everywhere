# UI test coverage audit

Test-only cleanup against `origin/dev` at `8f2e9d9d0dd448718b3d328c963cd0471edd6fad`
(Storybook #237 and shared sliders #240 included). The tables compare assertions,
not screenshots or story names. KEEP applies to every scenario in a named file
unless a MOVE is listed explicitly below. No product behavior changes.

## Behavior → coverage

Paths below are relative to `src/ui/`, except component cases under
[`.storybook/cases/`](../.storybook/cases/). Stories and cases use production
components in the real shadow root; their fake session/audio/storage boundaries
cannot establish installed extension behavior.

| Behavior | Unit coverage (`*.test.ts`) | Classic browser coverage (`*.browser.test.ts`) | Story play / component cases | Decision and boundary |
| --- | --- | --- | --- | --- |
| Volume stepping, 100% stop and boost percentage | `volume-level`: seven tests, including floating-point drift, arbitrary starting values, downward stop, lowered ceiling and full walks | `volume-wheel`: native wheel, disabled event consumption, momentum, unmute, units and retired listeners | `volume-control` Closed/Open/Muted/Boosted | KEEP units and wheel: stories assert labels/states, not stepping or event delivery. |
| Slider markers, labels, inert/disabled states | — | `vertical-slider` marker geometry moves; real pointer press/drag merges into `volume-wheel`; `accessibility` keeps native slider keys and exposed controls | `speed-control` Closed/Open; `volume-control` Closed/Open/Muted/Boosted, now checking painted marker geometry through `slider-assertions` | MOVE marker geometry; KEEP native pointer capture and accessibility. |
| HUD labels, one plate, timers and stale work | — | All six `playback-hud` scenarios remain: picture centering/fit/resize/restoration, spinner/seek axis, real boost/mute tint, control/video/key playback, dismissal and stale/double clicks | `hud.stories`; `hud.cases`; `hud-behavior.cases` (echo, cancellation, timers, stale epoch, no session, cleanup, rapid actions) | KEEP player wiring; component state coverage alone would miss those bugs. |
| Bass HUD color and icon shape | — | `bass-hud` moves; `bass-icon` stays: arcs, mirroring, cabinet geometry, period, settings-row colors/focus/sweep and reduced motion | HUD bass stories/cases; new green-accent color case | MOVE only the isolated HUD color test. KEEP settings icon behavior not asserted by HUD stories. |
| HUD optical spacing | — | `hud-spacing`: 17 icons × two scales × LTR/RTL × both engines, SVG painted bounds and 10px text gap | HUD stories show these states but do not measure ink | KEEP: screenshots and label assertions do not catch the same spacing bug. |
| Title truncation and reveal | `title-truncation`: word boundaries, segment styling and surrogate pairs | `title-hud-reduced`: LTR/RTL tail containment, keyboard reachability, first Escape, hover wrapping and live preference change | `title-hud` stories and cases: text/subtitle, marquee, clone hidden, reduced-motion tab stop and clear | KEEP: stories lack real focus/hover flow and live storage propagation. |
| Countdown digits, ring and cleanup | `auto-theater-intent`: deadline math, minimum visible time, stale intent, grace and cancellation | Component countdown/ring moves from `auto-theater-notice`; continuously sampled opacity in all four appearance modes merges into `spinner-exit` | Notice stories; `auto-theater-notice*.cases`, including countdown/zero hold, reduced-motion roll, per-digit replacement | MOVE component assertions; KEEP real WAAPI/continuous paint sampling. |
| Automatic entry, discovery, settings and scrim | `auto-theater`, `auto-theater-intent`, `auto-theater-settings` | `auto-theater-runtime`, `auto-theater-storage`, `auto-theater-settings`, `auto-theater-scrim`: full runtime, provider bridges, SPA identity, storage races, focus/fullscreen gates, offer dialog and scrim input/restoration | Notice stories show the notice component only | KEEP every scenario: component mocks cannot prove eligibility or entry. |
| Caption loading and result | — | Component-only loading test moves; `caption-loading` keeps saved-caption runtime/network loading, CC pulse/reduced motion/error and Disney/composite lazy windows; caption dialog close scenarios merge here | Caption stories; `caption-hud*.cases`: delayed/fast loading, status/duration, replacement, stale session/media, cleanup, new pre-delay status cancellation | MOVE isolated timer assertions; KEEP actual adapter and player callbacks. |
| Spinner exit and width morph | — | All original `spinner-exit` scenarios plus notice opacity sampling | Caption/notice/HUD held frames and manual-clock cases | KEEP native finish/cancel, width morph trajectories, edge anchoring, rapid toggles and live reduced-motion changes. |
| Button versus scrubber tooltips | `shortcuts`: kbd rendering | `scrubber-tooltip`: production pointer/seek, chapter/sprite, identity/geometry budgets, cancelled frames, dock clearance; `accessibility`: real localized buttons; `video-activator`: configured shortcut in both surfaces | `button-tooltip` Closed/Above/Below asserts label, no native title, shortcut and placement | KEEP: these are different tooltip producers or full runtime localization, not duplicate button stories. |
| Captions layout and menus | `appearance`, `netflix-stage` cover letterbox/dock math | `caption-dock-lifecycle`, `caption-overlay-width`, `cc-menu`, `cc-menu-rows`: coalescing, cleanup, wrapping, sticky header/scroll, locale rows, controller tracks, search/focus/iframe | No corresponding menu/dock story | KEEP every scenario. |
| Controls/chrome/layout | `appearance`, `theater-layout`, `controls-visibility`, `store` | `playback-chrome`, `controls-notch`, `pinned-controls-backing`, `fullscreen-activity`: measured layout, clocks, snapshots, visibility/resize, captions and fullscreen | `player.stories` composes fake controls | KEEP: full player layout/event and cleanup assertions. |
| Menus, modal and accessibility | `shortcuts` migration, parsing, storage concurrency/errors | `accessibility`, `modal`, `player-settings-order`, `settings-rows`, caption close scenarios: tree/keyboard/dialog lifecycle, background command, ordering, locale sizing and sweeps | Component stories assert local attributes only | KEEP all; move Extension settings presentation from installed smoke to existing order test. |
| Audio capability gates | — | `audio-block`: DRM capability becoming unavailable/available and correct HUD/menu | Volume stories fake a ready/absent graph | KEEP both full runtime capability scenarios. |
| Discovery, launcher and video selection | `video-activator`, `video-activator-placement`, `netflix-stage` | `discovery`, `video-activator`, `video-selection`: bounded queries, pointer ranking, occlusion, native controls, replacement, navigation, idle, provider fallback and stale work | No launcher/discovery story | KEEP every scenario; unit geometry does not establish DOM integration. |
| Provider presentation/chat/actions | `presentation-lifecycle`, `netflix-stage` | `native-chat`, `netflix-runtime`, `service-actions`, `top-layer`: provider behavior, real DOM/MAIN seams, reparenting, native popovers, cleanup/restoration | No equivalent provider stories | KEEP every scenario. |
| Digit rolling | `time-readout`: width, duration, signs and stagger math | `time-readout`: stable scrubber, painted color/motion/carry/overshoot, reduced motion and rapid updates | Countdown stories reuse digits but not playback readout integration | KEEP both levels. |
| New badges | — | `new-badge`: catalog/expiry, accessible text, styles/RTL, local/sync state, stale hydration, language, rebuilds and cleanup | No equivalent badge stories | KEEP every scenario. |
| Fixture smoke regressions | `picture-click`, `picture-dismiss`, `shortcuts` cover smaller rules | `smoke-regressions`: eight parameterized full-runtime scenario functions | Player/HUD stories use fake command boundaries | KEEP except scrubber preview scenario: its exact leave-before-frame regression already runs through the production player in `scrubber-tooltip` (see smoke audit). |

## Exact moved / removed classic tests

`${engine}` expands to Chromium and Firefox. These are full test names from the
base, with their surviving failure detector, not merely a related component.

| Base file and test name | Decision | Surviving assertion |
| --- | --- | --- |
| `bass-hud.browser.test.ts`: `turns red at MOAAR and MOAAARR! despite a user accent in ${engine}` | MOVE | `hud-behavior.cases.ts` / `Bass colors override the painted user accent only at the top levels`: all levels, green inline paint, red text/icon/SVG and distinct outline. Real shortcut color checks also stay in fixture `assertFullscreenAndHelp` → `assertAudioSettings`. |
| `vertical-slider.browser.test.ts`: `sits on the thumb path for 1x and 100%${boost ? ' with the boost ceiling' : ''} in ${engine}` | MOVE | `speed-control.stories.ts` / Open and `volume-control.stories.ts` / Open/Boosted call `expectSliderMarker`: thumb-path and horizontal centers within 0.75px, shared dimensions; Closed/Muted assert the no-boost marker is hidden. Both Storybook engines are checked during migration. |
| `vertical-slider.browser.test.ts`: `takes a press beside the ${name} track and drags from there in ${engine}` | KEEP + MERGE | Same name in `volume-wheel.browser.test.ts`, same VOD fixture and real pointer/padding/capture/focus/ARIA/inert assertions, sharing a browser with wheel cases. |
| `auto-theater-notice.browser.test.ts`: `${engine}: the notice counts the remaining seconds with the shared digit roll and stops on cleanup` | MOVE | `auto-theater-notice-behavior.cases.ts` / `Countdown rolls to zero, holds, announces politely and cleans up`, `Reduced motion swaps the countdown without rolling or turning`, existing `RingTurnSurvivesTicks`, `Digit cleanup belongs to the notice clock and cancellation clears it`, `CleanupLeavesNothing`. Exact second boundaries, hidden decorative counter, roll, uniform timing/easing, zero hold, polite label, reduced motion and repeated cleanup all survive. |
| `auto-theater-notice.browser.test.ts`: `${engine}: the per-digit ring mode restarts one eased turn with each digit change` | MOVE | Same cases file / `Per-digit ring replaces its eased turn on each digit change`: digit, one replacement animation, cancelled predecessor, fresh timeline and nonlinear easing. |
| `auto-theater-notice.browser.test.ts`: `${engine}: the notice plate stays opaque through appear, countdown, ring exit and 0 (${mode})` | KEEP + MERGE | Same name and 40ms sampling/assertions in `spinner-exit.browser.test.ts`, sharing its per-engine browser. All four modes, both engines and the complete real animation timeline stay. |
| `caption-loading.browser.test.ts`: `delays the spinner and cancels pending feedback on completion, dismissal and session replacement` | MOVE | `caption-hud-behavior.cases.ts` / `FastLoadNeverFlashes`, `LoadingStaysUntilDone`, `StaleLoadingNeverShows`, new `Status before loading delay cancels the pending spinner`; `caption-hud.cases.ts` / Loading. Delayed show, dismiss before/after show, pre-delay status and stale epoch all survive. |
| `caption-options-close.browser.test.ts`: `closes with the ${method} like a dismissal, keeping playback and theater and restoring focus` | KEEP + MERGE | Same name in `caption-loading.browser.test.ts`, both X/Escape variants, same fixture and assertions. |
| `caption-options-close.browser.test.ts`: `reaches the X button by keyboard and activates it with Enter` | KEEP + MERGE | Same name in `caption-loading.browser.test.ts`, same native Enter activation. Loading and close cases now use one shared Chromium browser with fresh contexts. |
| `smoke-regressions.browser.test.ts`: `${engine}: fixture regression assertScrubberPreviewLeaves` | DELETE | `scrubber-tooltip.browser.test.ts` / `updates extras in place and cancels leave/reset/exit/replacement frames in ${engine}`: production player boot, queues mousemove then mouseleave, advances 40ms, asserts no update and old tooltip not visible. The fixture scenario's stream roundtrip only establishes its own VOD setup/teardown. |

## Counting and timing method

Source counts parse TypeScript/JavaScript ASTs in discovered `*.test.ts` and
`*.test.mjs` files, counting `it(...)`, `test(...)`, their skip/only/todo variants,
and nested `t.test(...)` separately. They exclude `describe`, string snippets,
RegExp `.test`, story exports and `.cases.ts` calls. This avoids the false matches
in a raw `rg 'test\\('` count. The current base differs from the earlier rough
171-file/1,083-site estimate.

Runtime counts come from runner summaries. Node expands engine/provider/locale/
scenario loops, counts nested subtests and excludes suites from its `tests`
summary. The runner emits separate summaries for `.mjs` and TS tests. CI also
selects affected files and partitions unit/browser lanes. In #240's successful CI
run `39680564875`, unit summaries were **111 + 745**, Chromium **414** and Firefox
**414** (50 suites in each browser lane); 414 is neither a repository source count
nor a total across lanes/engines. Chromium-only legacy tests may still execute in
the Firefox lane, as documented in `browser-tests.md`.

Local before/after runs use exactly `pnpm test src/ui`, both engines, configured
file concurrency two, with no task-owned Storybook/smoke/test workload alongside.
They include UI unit files and browser files and measure pnpm startup through
cleanup using `/usr/bin/time -p`. One pair is evidence of this local run, not a
statistical benchmark. Full `pnpm test` is separate verification. CI affected-test
selection and runner load make its overall `check` duration observational, not a
controlled speed comparison. Results are recorded in the PR body.
