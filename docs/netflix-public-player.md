# Netflix public player

Measured on the public title page `https://www.netflix.com/pl/title/80057281` (Stranger Things), without an account. The page plays a hero preview and, after opening a trailer, a modal player. This pass does not cover a signed-in `/watch` playback session.

## What the page actually exposes

- Two hero `<video>` elements stay in the DOM with the modal video. The modal film is the one inside `.nf-player-container`. Hero copies can keep playing or sit paused underneath. One hero is a blurred, low-opacity background.
- `video.textTracks` was empty. Netflix can draw cues in `.player-timedtext` only while that renderer stays mounted after the player leaves its loading UI. On this public HTML5 fallback the node appears during loading and is removed once playback starts, so no cue is drawn. A signed-in `/watch` player was not measured.
- The modal player's live API exposes `getTimedTextTrackList` (36 tracks on the Stranger Things trailer, video `82779520`) and `setTimedTextTrack`. Tracks have `trackId`, `bcp47`, and `displayName`. The Polish off control is labeled `wył.` (`isNoneTrack` is false; `isForcedNarrative` is true). React `memoizedProps.textTracks` and `selectedTextTrack` can stay empty or on Off while that API already has the list. The HTML5 fallback methods `setTimedTextTrack` and `getTimedTextTrackList` are stubs (`function(){}` and `return null`). The same object is not `window.netflix.appContext.state.playerApp.getAPI().videoPlayer`; that call was not present.
- `getTrickPlayURL` / `getTrickPlayFrame` appeared on a player props object, but a later mounted tree did not return a thumbnail URL. No sprite, storyboard, or chapter format was confirmed. Chapters and timeline thumbnails are unsupported.
- The public player had no `mediaKeys`. That does not say anything about a signed-in title.

## Why the page showed through Theater Mode

Measured in a 1280×800 viewport, then again after resizing to 1440×900.

The modal video's ancestor `[role="dialog"]` computes `transform: matrix(1, 0, 0, 1, 0, 0)` from `transform: scale(1)`, with `scale: none`. That identity transform is still a containing block for `position: fixed`. Before the reset the video measured 1030×578 at (125, 111) inside the dialog, not the viewport. Ancestors also use `overflow: hidden` / `auto`, which crop it to that box. The dialog transitions `transform` for 533ms. `transform: none` alone left the used matrix until that transition finished, and the viewport-sized video was measured at y=3381 inside the scrolled containing block. The measured `scale` was already `none`. Setting `transition: none` with `transform: none` in the same turn moved the video to (0, 0) at 1280×800. That reset is on the Netflix stage and the inline pin, not on `.theater-everywhere-parent-active`. `elementFromPoint` on all four corners hit the video. After resize the same pin measured 1440×900 at (0, 0). Removing the overrides restored the dialog matrix and the 1030×578 box.

`#theater-everywhere-stage` is a child of `<html>`. `.theater-everywhere-parent-active` also sets `z-index: 2147483647` on `<body>`, so the page paints above the stage. Gaps around a trapped video show the title page, including the series card.

The visible hero has a different trap. One ancestor uses `filter: drop-shadow(...)`. Two ancestors use `mask-image` gradients (a bottom fade and a radial fade). Those masks clip a `position: fixed` video to the hero shape: the border box can already be the viewport while `elementFromPoint` still hits the page. Clearing `mask-image` (not the `mask` shorthand, which would drop the inline longhand on exit) made the corners hit the video at (0, 0).

Raised mode keeps `object-fit: contain` and `object-position: center top` (`50% 0%`) on that full-viewport video, so the 16:9 picture stays at the top and the video background fills the lower band. Host subtitles (`.player-timedtext`) are pinned into that band with `--theater-letterbox`. Escape removes the inline containment, the Netflix stage class, and the host-control hide rules.

Calling `setTimedTextTrack` with the raw `polski` object changed `getTimedTextTrack()` from `wył.` to `polski`. Passing that same call's return value, or reading React `selectedTextTrack`, does not show that change. The playing media was a progressive MP4 (`nflxso.net` `.mp4`), `video.textTracks` stayed empty, and `.player-timedtext` was absent while the trailer played. Sampled at 15, 30, 45, 60, 75, 90, and 105 seconds, neither Polish nor English produced a cue. There is no visible dialogue to confirm on this public player. Timeline thumbnails were not available.

## What Theater Mode uses

- Current title from the player, the pressed preview control, or the page title with the Netflix site suffix removed. A new video id does not keep the previous title.
- Subtitle languages from the host track list only while captions are actually available. That means `fallbackMode` is not true, the player is no longer in its loading UI, and `.player-timedtext` is mounted. A loading-only node does not count. When the renderer disappears, the snapshot publishes `captions: false` and an empty track list. Turning captions off still sends `trackId: null` with that empty snapshot; MAIN selects the live off track and checks the getter. A language request is refused while captions are unavailable. MAIN answers with a separate JSON acknowledgement only when the live track id matches. A language acknowledgement uses the same availability check, because a setter return does not mean a cue was drawn. Signed-in `/watch` playback was not verified. The extension does not download caption files, manifests, or licenses.
- Chapters and timeline thumbnails are not supported. There is no confirmed preview or chapter format to import.
- Netflix is included in the Rich Theater Experience switch. Stored settings that turned every older provider off, and have no Netflix key, keep Netflix off too.
- Netflix is not on the media fetch allowlist.
