# Installed smoke coverage audit (TME-106)

Smoke exercises the extension boundary: installed startup, MAIN/isolated execution,
background requests, real extension storage across pages and frames, and browser
fullscreen/iframe ownership. Layout, idle chrome and ordinary input belong in
fixture browser tests. This audit compares `origin/main` at `c6f121e` with this
change. No application, manifest, packaging, changelog or Firefox installation
policy changes are part of the audit.

## Timing method

`THEATER_SMOKE_TIMING=1 pnpm smoke:chromium` prints inclusive seconds for each
scenario and `TOTAL` for the browser run (including launch/cleanup, excluding
pnpm/tsx startup). The baseline used the same instrumentation temporarily on the
original runner. The final comparison uses three sequential before runs followed
by three sequential after runs, without other task-owned browser/test jobs.
Earlier overlapping diagnostic runs are excluded. One pre-final reduced run
failed when audio entry followed startup exit inside the existing 200 ms T
guard; independent entry scenarios now reload the fixture rather than sleeping.
The after series below was restarted after that correction. These are local
headless Linux measurements, not CI measurements or authenticated-host verification.

| Chromium browser run | Run 1 (s) | Run 2 (s) | Run 3 (s) | Median (s) |
| --- | ---: | ---: | ---: | ---: |
| Before | 167.491 | 119.766 | 149.263 | 149.263 |
| After | 51.908 | 55.082 | 55.125 | 55.082 |

**Median reduction: 63.1%** (36.9% of baseline; target ≤ 50%).

| Scenario | Before median (s) | After median (s) | After identity |
| --- | ---: | ---: | --- |
| `assertTheaterToggle` | 1.742 | 0.630 | `assertInstalledStartup` |
| `assertPictureClickReclaimsKeys` | 0.595 | — | fixture suite |
| `assertScrubberPreviewLeaves` | 0.570 | — | fixture suite |
| `assertThumbPlayerSwap` | 0.481 | — | fixture suite |
| `assertControlsPin` | 50.113 | 4.063 | `assertPinStorage` |
| `assertShortcutManagement` | 5.141 | 4.344 | same |
| `assertRteSettings` | 0.896 | 0.860 | same |
| `assertPictureLayout` | 9.497 | 9.320 | same |
| `assertAudioSettings` | 3.046 | 1.351 | `assertAudioWorld` |
| `assertFullscreenAndHelp` | 13.458 | — | fixture suite |
| `assertBlacklistBlocksTheater` | 1.053 | 1.009 | same |
| `assertIframeHandshake` | 1.923 | 2.233 | same |
| `assertEmbeddedKeysAndFullscreen` | 0.844 | 0.982 | same |
| `assertAutoTheater` | 10.284 | 9.296 | same |
| `assertParentBlacklist` | 1.141 | 1.197 | same |
| `assertLanguageMenu` | 4.321 | 4.803 | same |
| `assertBadgeWorld` | 0.009 | 0.011 | same |
| `assertFeatureHighlights` | 7.044 | 2.001 | same |
| `assertAppearanceModes` | 43.719 | 5.732 | same |

Line counts below include the function and its following separator line, excluding
imports/helpers; nested rows are inclusive and cannot be added to their parents.
Repeated theater-toggle/startup timings are summed within each run before taking
the median.

## Scenario decisions

`P` means [the shared fixture regression suite](../src/ui/smoke-regressions.browser.test.ts),
whose exact test names are `${engine}: fixture regression <function>` for Chromium
and Firefox. Its [support modules](../src/test-utils/player-scenarios/) are also
scanned by the determinism guard. Every MOVE preserves the original observable
assertions; real storage checks extracted from those functions stay in smoke.

| Original scenario | Lines | Decision | Surviving capability or test |
| --- | ---: | --- | --- |
| `assertTheaterToggle` | 109 | KEEP + MOVE | Installed T/Escape startup and blacklist restoration become `scripts/smoke/browsers.ts::assertInstalledStartup`. Repeat, host key releases, cancelled/unclaimed keys, editable guards and playback assertions move to P `assertTheaterToggle` ([playback.ts](../src/test-utils/player-scenarios/playback.ts)). |
| `assertPictureClickReclaimsKeys` | 20 | MOVE | P `assertPictureClickReclaimsKeys`: picture click reclaims keyboard focus from a host field. |
| `assertScrubberPreviewLeaves` | 41 | MOVE | P `assertScrubberPreviewLeaves`: a queued hover frame cannot revive a departed preview; clock-controlled frame completion retains the race assertion. |
| `assertThumbPlayerSwap` | 46 | MOVE | P `assertThumbPlayerSwap`: replacement and return to the original media, then exit/host restoration. |
| `assertControlsPin` | 711 | KEEP + MOVE | Real options-page opening through background messaging, saved pin/reload, live options/player changes and independent shortcut writes stay in `scripts/smoke/pin-storage.ts::assertPinStorage`. All chrome/menu/modal/keyboard/hover/idle/caption geometry, player rebuilding, host replacement and host-removed modal recovery move to P `assertControlsPin` ([settings](../src/test-utils/player-scenarios/controls-settings.ts), [lifecycle](../src/test-utils/player-scenarios/controls-lifecycle.ts)). Controlled time owns the three former real waits and the idle-state deadlines. |
| `assertRteSettings` | 44 | KEEP | `scripts/smoke/settings.ts::assertRteSettings`: actual extension defaults, one-provider writes, unrelated-provider preservation, and live storage updates. Screenshot synchronization uses the observable scroll offset. |
| `assertShortcutManagement` | 119 | KEEP + MOVE | Background conflict cancel/transfer, persisted unbinding/reload/reset, concurrent Settings edits and live custom MAIN fullscreen/theater keys stay in smoke. Color/focus, Tab and reserved Escape move to [options/shortcut-management.browser.test.ts](../options/shortcut-management.browser.test.ts): `${engine}: shortcut conflicts stay visible on focus, Tab escapes recording and Escape is reserved`. |
| `assertPictureLayout` | 105 | KEEP + MOVE | Installed defaults, options/player preference sharing and live shortcut replacement stay in `scripts/smoke/settings.ts::assertPictureLayout`. Row/shortcut feedback, repeats, shadow-input exclusion and Fit/Fill/Stretch restoration move to P `assertPictureLayoutFixture` ([audio-layout.ts](../src/test-utils/player-scenarios/audio-layout.ts)). |
| `assertAudioSettings` | 184 | KEEP + MOVE | `scripts/smoke/audio.ts::assertAudioWorld` retains the real isolated-to-MAIN graph readiness, saved voice/leveling/bass/boost values, no media reload and exit bypass. Full control/shortcut cycles, HUD icons/colors, editable/modal/repeat guards, gain ceiling/unmute and saved gain/effect restoration move to P `assertFullscreenAndHelp`, which calls `assertAudioSettings`. |
| `assertFullscreenAndHelp` | 41 | KEEP + MOVE + MERGE | Responsive 27-row help, keyboard layout guard and ordinary fullscreen move to P `assertFullscreenAndHelp`. Early MAIN interception/repeat is also exercised by surviving installed `assertShortcutManagement`; frame fullscreen ownership remains in both frame scenarios. Nested layout/audio checks are classified separately above. |
| `assertBlacklistBlocksTheater` | 12 | KEEP | Actual saved host policy suppresses initialization and early MAIN fullscreen/theater interception. |
| `assertEmbeddedKeysAndFullscreen` | 36 | KEEP | `scripts/smoke/frames.ts`: installed frame/parent shortcut relays, native versus extension fullscreen ownership and host-claimed Escape. |
| `assertIframeHandshake` | 118 | KEEP | Parent/child entry and exit, live navigation availability/claims, action dispatch once, layout/pin relay and cleanup on child reload all require the installed all-frames/MAIN/isolated wiring. |
| `assertParentBlacklist` | 13 | KEEP | Saved parent-domain policy reaches a fresh child host through the extension. |
| `assertAutoTheater` | 210 | KEEP + MOVE + DELETE | Default/saved options state, live options/player writes, launcher-offer acknowledgement, saved document reentry, two MAIN provider bridges and iframe exclusion stay in `scripts/smoke/auto-theater.ts`. Detailed deletions and the moved discovery guards are listed below. |
| `assertLanguageMenu` | 128 | KEEP + MOVE + DELETE | Real background catalog delivery and storage propagation to two Settings pages, popup, isolated player and a fresh frame, RTL/Automatic restoration and unchanged playback remain. Full player-copy audits move to P `assertPlayerLocalization`; duplicate combobox/accent/catalog audits have citations below. |
| `assertBadgeWorld` | 49 | KEEP | CDP explicitly selects the installed isolated world and tests its unavailable-custom-elements fallback. A page-world probe cannot replace this test. |
| `assertFeatureHighlights` | 112 | KEEP + MERGE + DELETE | `scripts/smoke/highlights.ts`: real local/sync preference, acknowledgement write, isolated-player badge update and reload persistence stay. Repeated tabs, catalog generation and presentation checks have surviving coverage below. |
| `assertAppearanceModes` | 107 | KEEP + MERGE + MOVE + DELETE | `scripts/smoke/appearance.ts`: one real Settings write reaches popup and the isolated shadow owner; stored contrast/transparency hydrate a fresh owner on reentry. Detailed styling moves/deletions and repeated-tab coverage are below. |

## Removed and merged sub-scenarios

Each citation names the test as written in source (engine placeholders denote its
parameterized Chromium/Firefox cases). These tests were checked against their
actual assertions, not just similar file names.

| Sub-scenario | Decision | Surviving test and observable outcome |
| --- | --- | --- |
| AutoTheater same-visit exit, preference off/on after exit, Vimeo same-visit exit | DELETE | [auto-theater-storage.browser.test.ts](../src/ui/auto-theater-storage.browser.test.ts), `AutoTheater in ${engine} skips the notice only when enabled, preserving playback gates and visit ownership`: preference changes cannot reenter an exited visit. The installed Vimeo MAIN bridge entry remains in smoke. |
| AutoTheater stale SPA identity and ad completion | DELETE | [auto-theater-runtime.browser.test.ts](../src/ui/auto-theater-runtime.browser.test.ts), `auto entry in ${engine} accepts native playing before YouTube state catches up, but rejects ads and stale content`; [auto-theater-storage.browser.test.ts](../src/ui/auto-theater-storage.browser.test.ts), `auto-theater storage in ${engine} refreshes all policy dependencies and rejects stale hydration`: stale/blocked state never enters, matching ad completion refreshes and enters. |
| AutoTheater home feed | DELETE | [watch-playback.test.ts](../src/providers/watch-playback.test.ts), `declares YouTube watch videos and keeps identity stable across incidental navigation`, rejects `/`; [auto-theater-storage.browser.test.ts](../src/ui/auto-theater-storage.browser.test.ts), `auto-theater storage in ${engine} preserves opt-out, generic and iframe guards`, verifies unqualified URLs do not enter the full runtime. |
| AutoTheater disabled RTE and blacklist | DELETE | [auto-theater-storage.browser.test.ts](../src/ui/auto-theater-storage.browser.test.ts), `auto-theater storage in ${engine} refreshes all policy dependencies and rejects stale hydration`, explicitly blocks/re-enables the YouTube flag and parent blacklist through storage, rejects stale reads and enters only after the current allowed policy. Installed policy and RTE storage smoke remain. |
| AutoTheater editable focus and fullscreen | DELETE | [auto-theater-runtime.browser.test.ts](../src/ui/auto-theater-runtime.browser.test.ts), `YouTube auto entry in ${engine} re-evaluates ${scenario} without another playing event` with `focus` and `fullscreen`: entry is blocked until the gate is released. |
| AutoTheater paused content | DELETE | [auto-theater-runtime.browser.test.ts](../src/ui/auto-theater-runtime.browser.test.ts), `${fixture.provider} auto entry in ${engine} qualifies the URL before the player and preserves session guards`: paused primary media does not enter; playback does. [auto-theater-storage.browser.test.ts](../src/ui/auto-theater-storage.browser.test.ts), `AutoTheater in ${engine} skips the notice only when enabled, preserving playback gates and visit ownership`, also asserts skip still waits for playback. |
| AutoTheater tiny player and auxiliary hover preview | MOVE | [auto-theater-storage.browser.test.ts](../src/ui/auto-theater-storage.browser.test.ts), **new** `auto-theater in ${engine} rejects tiny players and auxiliary hover previews`. Preserves both original full-runtime discovery assertions rather than relying only on unit filtering. |
| Language combobox cancellation/focus and browsing without committing | DELETE | [combobox.browser.test.ts](../options/combobox.browser.test.ts), `select-only combobox keeps focus, separates browsing from selection and owns popup lifecycle in ${engine}`. Real option selection and keyboard commit still happen in smoke. |
| Language accent-only green/system change and dropdown presentation | DELETE | [choice-grid.browser.test.ts](../options/choice-grid.browser.test.ts), `choice grids share accent selection, roving focus and live relabeling in ${engine}`, verifies selection/focus on click and keys. [localization.browser.test.ts](../options/localization.browser.test.ts), `Settings catalog audit relabels all five tabs and dynamic exclusions (2 rows) without reload`, clicks a real Settings accent and preserves its checked state through relabeling. [appearance.browser.test.ts](../src/appearance.browser.test.ts), `${engine.name()}: appearance across Settings, popup root and player; live storage, system and cleanup`: accent/appearance matrix, selected dropdown colors, focus, narrow/RTL layout and cleanup. |
| Language whole-Settings and popup English-leftover audits | DELETE | [localization.browser.test.ts](../options/localization.browser.test.ts), `Settings catalog audit relabels all five tabs and dynamic exclusions (2 rows) without reload`, `Settings catalog audit relabels the empty exclusions list`, and `popup catalog audit refreshes dynamic domain/status (${url || 'no tab'})`. [locales.test.ts](../scripts/locales.test.ts), `lists every bundled locale exactly once in the language menu`, covers menu inventory. Representative installed labels/direction still prove catalog delivery; whole-player audits MOVE to P `assertPlayerLocalization`. |
| Highlights every Settings item, remount without acknowledgement, second Settings tab and same-generation additions | DELETE + MERGE | [new-badge.browser.test.ts](../src/ui/new-badge.browser.test.ts), `${engine}: development Settings restores only newly added items after an acknowledged catalog`, `${engine} ${version}: Settings badges, acknowledgement, preference and language update live and clean up`, and `${engine}: player gear dot and new menu rows follow local/sync changes, language and rebuilds`. These assert item filtering, acknowledgement, unchanged remount and player updates. Real cross-tab storage is retained in language/shortcuts; real highlight acknowledgement and player propagation remain in smoke. |
| Highlights English content in localized dialogs, scrolling, End key and visible actions | DELETE | [whatsNew-content.browser.test.ts](../src/whatsNew-content.browser.test.ts), `renders static English semantic content safely and refreshes localized dialog labels in place`, and `${browserType.name()}: highlights keep thanks and actions visible while scrolling and resizing`. |
| Appearance repeated second Settings tab, contrast-off/transparency-on and restore toggles, toolbar fill | DELETE + MERGE | [appearance.browser.test.ts](../src/appearance.browser.test.ts), `${engine.name()}: appearance across Settings, popup root and player; live storage, system and cleanup`: second Settings selection, live matrix, opaque `rgb(24, 24, 27)` toolbar fill and restored system modes. Installed appearance still checks distinct real option-to-popup/player propagation and shadow reentry. |
| Appearance RTE decoration animation suppression | MOVE | The same [appearance.browser.test.ts](../src/appearance.browser.test.ts) test now checks both hidden decoration content and `animationName === 'none'`, preserving the stronger original smoke assertion. |

## Retained overlaps and contract review

- The moved pin fixture retains coupled menu/caption geometry and focus sequences
  despite partial overlap with playback-chrome and controls-notch. Those suites do
  not replace its host-removed modal and replacement/rebuild sequence. Controlled
  idle time keeps this conservative coverage out of the installed lane.
- Pin/shortcut/layout tests retain their options/player interactions because actual
  background opening, serialized shortcut writes and storage events are the
  integration under test. Their detailed fixture presentation/input checks move
  down a layer. Repeated pin idle visibility assertions no longer run in smoke.
- Language, appearance and highlights share the storage transport, but retain one
  installed consumer-specific path each: language catalogs require background
  delivery, appearance owns a rebuilt shadow root, and highlights use local plus
  sync acknowledgement state and an isolated-world badge fallback.
- Audio controls retain a compact installed MAIN graph/persistence/exit proof.
  DSP, HUD styling and all control cycles belong to browser/unit tests. Native
  audio lifecycle/DSP tests are unchanged.
- Both frame tests remain: same-origin handshake/reload cleanup is distinct from
  a host that claims keys and owns fullscreen. The language frame additionally
  proves saved catalog hydration and live storage restoration.
- AutoTheater retains one ordinary installed default-entry/countdown path and
  saved/live preference entry. It does not assert countdown presentation/timing
  again. YouTube and Vimeo exercise distinct provider MAIN confirmations.
- Provider identity, stale hydration and cleanup assertions survive at their
  existing lower layers or in the moved replacement/modal tests. No message
  validator or provider/session implementation changes. Generic HTML5 and RTE
  disabled/unsupported paths remain covered by fixture/unit tests; real hosts
  were not exercised.
- Firefox's unsigned-XPI attempt and diagnostic injection fallback are unchanged;
  only the duplicate fixture scenarios leave that runner. TME-112 still owns
  installed Firefox coverage and advisory/blocking policy.

## Harness guards and verification

The smoke selector and determinism inventory include nested `scripts/smoke/**/*.ts`;
both have discovery/regression tests. The inventory additionally scans all
`src/test-utils/**/*.ts` so moved fixture support cannot hide waits. The baseline
was reduced using `pnpm exec tsx scripts/test-determinism.ts --update`: smoke
sleep matches **13 → 6**, frame matches **6 → 1**, timer matches **1 → 1**; no new
allowances. Existing real blacklist/debounce waits stay in the original entry file
instead of resetting their per-file allowance through a move.

- `pnpm install --frozen-lockfile` passed.
- `pnpm typecheck` passed.
- `pnpm build` and `pnpm verify:bundles` passed; production inputs are unchanged.
- `pnpm test --lane=unit`: **726 passed**, none skipped.
- `THEATER_TEST_ENGINES=chromium,firefox pnpm exec tsx --test --test-concurrency=2 src/ui/smoke-regressions.browser.test.ts src/ui/auto-theater-storage.browser.test.ts src/appearance.browser.test.ts options/shortcut-management.browser.test.ts`: **36 passed**, none skipped. Focused fullscreen/help recheck after removing the obsolete installed-only branch: **2 passed**.
- Three final full `pnpm smoke:chromium` runs passed; samples above.
- `pnpm smoke:firefox` passed through the **existing injected diagnostic fallback**; unsigned-XPI installation remains unverified, unchanged and owned by TME-112.
- All five standalone switches passed independently: `THEATER_SMOKE_AUTO_THEATER_ONLY`, `THEATER_SMOKE_APPEARANCE_ONLY`, `THEATER_SMOKE_LANGUAGE_ONLY`, `THEATER_SMOKE_HIGHLIGHTS_ONLY`, `THEATER_SMOKE_SHORTCUTS_ONLY`.
- `pnpm exec tsx --test scripts/test-determinism.test.ts scripts/test-impact.test.mjs`: **23 passed**, including inventory/history ratchet and nested-module selector coverage.
- Named test citations, local document links, relative `CLAUDE.md` symlink, module sizes, and `git diff --check` checked.

No authenticated real hosts or optional screenshot captures were exercised. Local
measurements do not establish CI timings. Firefox real installation/permissions/
background coverage remains the pre-existing diagnostic gap; no advisory policy
or `check` job changes were made.
