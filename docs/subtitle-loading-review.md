# Subtitle loading review

The review covers every production caller of `activateCaptionTrack` and the Disney+ cue-window refresh path. Track discovery reads available languages and metadata; activation and window requests load or enable the selected captions.

## Findings and completed work

- [x] Saved-language restoration used `hud: 'on'`, which omitted the loading spinner and suppressed failures. Removed the optional HUD policy: every caption activation now publishes loading and a result.
- [x] Programmatic `activate(id)` calls could silently load captions when no HUD option was supplied. They now use the same operation as menu selection and keyboard toggling.
- [x] Disney+ downloaded caption windows through a separate result/failure path without loading feedback. It now prepares a lazy request and passes it through the shared operation. Loaded windows, including the final cached segment, return no request and show no loading UI.
- [x] A rejected window request only logged an error and left captions marked active. The shared operation now deactivates failed captions, clears their cues/layout, and reports the failure.
- [x] Invalidation, media changes, adapter replacement and disposal could leave a spinner visible or let stale completion events replace the current HUD. These transitions dismiss loading immediately; stale results and queued selections cannot publish a result for another lifecycle.
- [x] Successful host-delivered restoration was retried because success was tested using `usingOverlayCaptions`. Retries now follow a failed activation, and a newer user request cancels the pending retry.
- [x] Native `textTracks` events could trigger automatic restoration immediately after a failed manual language selection, overwriting its error. Restoration is now an explicit pending intent for the media/track lifecycle, rather than an effect of every metadata refresh.
- [x] The CC icon now pulses from white to the configured accent while the shared caption state is `loading`. `aria-busy` follows that state; reduced motion shows a steady accent instead of pulsing.

The provider boundary is documented in [player-provider-contracts.md](player-provider-contracts.md). Providers own downloads, retries within a download, parsing and caching. The controller owns request serialization, loading UI, result application, preferences, layout and cancellation feedback.

## Verification and screenshots

Controller regressions cover manual activation, toggling, saved-language restoration, cancellation, stale queues, host-delivered success, cue-window success/no-op/failure and metadata events after a failed selection. Browser tests run the production player runtime with a delayed native VTT response, measure both animation endpoints, check reduced motion, select a failing language, and exercise the real Disney adapter/composite with routed HLS/VTT responses.

The screenshots show the production player on a deterministic local canvas video fixture, with mocked extension settings and controlled network responses. They are not captures from a signed-in streaming service.

Local validation: `pnpm typecheck`, `pnpm build`, `pnpm verify:bundles` and all 50 controller/caption browser regressions passed. Full `xvfb-run --auto-servernum pnpm smoke:chromium` passed, including installed-extension startup, video switching, pinned controls, caption menus, shortcut management, fullscreen/help, blacklist and iframe behavior.

The full test run timed out in Netflix document-start session discovery in `src/ui/netflix-runtime.browser.test.ts:476`. That failure was reproduced on unchanged `main` at `3eb6747`; the full local test suite is not reported as passing.

The optional local Firefox smoke did not pass its caption-menu Escape/focus assertion. CI treats Firefox smoke as diagnostic-only because unsigned MV3 sideload is blocked in Playwright.

The full Chromium smoke also exposed a fixture problem reproduced on that same `main`: its cursor stayed over Speed while switching from VOD to live. Hiding Speed moved CC under the cursor and opened captions on hover, so Escape correctly closed that menu instead of leaving theater mode. The smoke now moves the cursor onto the picture before restoring live playback and checks that no menu is open before testing Escape. The settings-icon geometry check also tolerates differences below half a CSS pixel instead of failing on browser subpixel rounding. Shortcut appearance checks bring the options tab to the foreground so its CSS transitions can finish.

Reproduce them with:

```sh
CAPTION_SCREENSHOT_DIR=docs/screenshots/subtitle-loading pnpm exec tsx --test src/ui/caption-loading.browser.test.ts
```

Loading, white phase:

![Saved captions loading with a white CC icon](screenshots/subtitle-loading/restore-loading-white.png)

Loading, accent phase:

![Saved captions loading with an accent CC icon](screenshots/subtitle-loading/restore-loading-accent.png)

Successful restoration:

![Saved captions restored with their language in the HUD](screenshots/subtitle-loading/restore-complete.png)

Failed language selection:

![Caption failure HUD and an inactive CC icon](screenshots/subtitle-loading/load-failed.png)
