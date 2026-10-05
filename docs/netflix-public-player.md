# Netflix public player

Measured on the public title page `https://www.netflix.com/pl/title/80057281` (Stranger Things), without an account. The page plays a hero preview and, after opening a trailer, a modal player. This pass does not cover a signed-in `/watch` playback session. The T3 preview and an installed Chromium build of the same public page are different players. Neither measurement confirmed a painted subtitle cue.

## What the page actually exposes

- Two hero `<video>` elements stay in the DOM with the modal video. The modal film is the one inside `.nf-player-container`. Hero copies can keep playing or sit paused underneath. One hero is a blurred, low-opacity background.
- `video.textTracks` was empty in both environments below. A mounted `.player-timedtext` node and a successful language acknowledgement mean the host accepted a logical track selection. They do not mean a cue was painted. Signed-in `/watch` was not measured.
- The modal player's live API exposes `getTimedTextTrackList` (36 tracks on the Stranger Things trailer, video `82779520`) and `setTimedTextTrack`. Tracks have `trackId`, `bcp47`, and `displayName`. The Polish off control is labeled `wył.` (`isNoneTrack` is false; `isForcedNarrative` is true). React `memoizedProps.textTracks` and `selectedTextTrack` can stay empty or on Off while that API already has the list. The same object is not `window.netflix.appContext.state.playerApp.getAPI().videoPlayer`; that call was not present.
- `getTrickPlayURL` / `getTrickPlayFrame` appeared on a player props object, but a later mounted tree did not return a thumbnail URL. No sprite, storyboard, or chapter format was confirmed. Chapters and timeline thumbnails are unsupported.
- The public player had no `mediaKeys`. That does not say anything about a signed-in title.

### T3 preview, HTML5 fallback

This player used a progressive MP4 (`nflxso.net` `.mp4`). `.player-timedtext` appeared during loading and was removed once playback started. Sampled at 15, 30, 45, 60, 75, 90, and 105 seconds, the node was absent. The HTML5 prototype methods `setTimedTextTrack` and `getTimedTextTrackList` are stubs (`function(){}` and `return null`). Calling the live wrapper with the raw `polski` object changed `getTimedTextTrack()` from `wył.` to `polski`. That is a logical selection. No cue was drawn.

### Installed Chromium, same public title

This was not that HTML5 fallback. Ancestor fiber state was `fallbackMode: false` and `uiState: 'ps'`. Descendant fibers had no support state. The snapshot published `captions: true` and 36 tracks. `.player-timedtext` stayed mounted while the video played. The media was not a progressive MP4 (kind other, likely a blob). A string request from the extension isolated world, origin `chrome-extension://` and context name Theater Mode Everywhere, reached MAIN. Polish acknowledged `ok: true`. The renderer stayed mounted. The video kept playing (`paused: false`) at 6, 9, and through 33 seconds. `.player-timedtext` `textContent` was empty in all 10 samples. Off then acknowledged `ok: true`. Logical selection and the isolated-to-MAIN string bridge are confirmed. A painted cue is not.

## Why the page showed through Theater Mode

An earlier measurement used a 1280×800 viewport, then a resize to 1440×900. Installed Chromium, hero and modal Raised, filled the viewport at 1024×768. All four corners hit the video. After resize to 1440×900 the corners still hit the video. Escape restored the dialog matrix.

The modal video's ancestor `[role="dialog"]` computes `transform: matrix(1, 0, 0, 1, 0, 0)` from `transform: scale(1)`, with `scale: none`. That identity transform is still a containing block for `position: fixed`. Before the reset the video measured 1030×578 at (125, 111) inside the dialog, not the viewport. Ancestors also use `overflow: hidden` / `auto`, which crop it to that box. The dialog transitions `transform` for 533ms. `transform: none` alone left the used matrix until that transition finished, and the viewport-sized video was measured at y=3381 inside the scrolled containing block. The measured `scale` was already `none`. Setting `transition: none` with `transform: none` in the same turn moved the video to (0, 0) at 1280×800. That reset is on the Netflix stage and the inline pin, not on `.theater-everywhere-parent-active`. `elementFromPoint` on all four corners hit the video. After resize the same pin measured 1440×900 at (0, 0). Removing the overrides restored the dialog matrix and the 1030×578 box.

`#theater-everywhere-stage` is a child of `<html>`. `.theater-everywhere-parent-active` also sets `z-index: 2147483647` on `<body>`, so the page paints above the stage. Gaps around a trapped video show the title page, including the series card.

The visible hero has a different trap. One ancestor uses `filter: drop-shadow(...)`. Two ancestors use `mask-image` gradients (a bottom fade and a radial fade). Those masks clip a `position: fixed` video to the hero shape: the border box can already be the viewport while `elementFromPoint` still hits the page. Clearing `mask-image` (not the `mask` shorthand, which would drop the inline longhand on exit) made the corners hit the video at (0, 0).

Raised mode keeps `object-fit: contain` and `object-position: center top` (`50% 0%`) on that full-viewport video, so the 16:9 picture stays at the top and the video background fills the lower band. Host subtitles (`.player-timedtext`) are pinned into that band with `--theater-letterbox`. Escape removes the inline containment, the Netflix stage class, and the host-control hide rules.

Passing `setTimedTextTrack`'s return value, or reading React `selectedTextTrack`, does not show a getter change. Timeline thumbnails were not available. Visible dialogue is not confirmed in the T3 HTML5 fallback or in the installed Chromium player above.

## What Theater Mode uses

- Current title from the player, the pressed preview control, or the page title with the Netflix site suffix removed. A new video id does not keep the previous title.
- Subtitle languages from the host track list only while captions are available. `fallbackMode` is not true, the player is not in an explicit loading state, and `.player-timedtext` is mounted. Support state is read from descendants and from a bounded parent fiber chain. Any `fallbackMode: true` wins over a `false` read later. An explicit loading state wins over a settled `uiState` or a layout that no longer has the loading class. Meeting that check allows a logical `setTimedTextTrack` selection. It does not mean a cue was painted. The T3 HTML5 fallback fails the check, so the snapshot publishes `captions: false` and an empty track list. The installed Chromium public player above passed it and acknowledged Polish and Off while the renderer text stayed empty. Turning captions off still sends `trackId: null` when that list is empty; MAIN selects the live off track and checks the getter. A language request is refused while captions are unavailable. MAIN answers with a separate JSON acknowledgement only when the live track id matches. Signed-in `/watch` playback was not verified. The extension does not download caption files, manifests, or licenses.
- Chapters and timeline thumbnails are not supported. There is no confirmed preview or chapter format to import.
- Netflix is included in the Rich Theater Experience switch. Stored settings that turned every older provider off, and have no Netflix key, keep Netflix off too.
- Netflix is not on the media fetch allowlist.
