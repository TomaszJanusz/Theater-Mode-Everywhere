# Netflix public player

Measured on the public title page `https://www.netflix.com/pl/title/80057281` (Stranger Things), without an account. The page plays a hero preview and, after opening a trailer, a modal player. This pass does not cover a signed-in `/watch` playback session.

## What the page actually exposes

- Two hero `<video>` elements stay in the DOM with the modal video. The modal film is the one inside `.nf-player-container`. Hero copies can keep playing or sit paused underneath. One hero is a blurred, low-opacity background.
- `video.textTracks` was empty. Subtitles are drawn by Netflix in `.player-timedtext`.
- While the modal player is mounted, its React props include `textTracks`, `getTimedTextTrackList`, and `setTimedTextTrack`. Tracks have `trackId`, `bcp47`, and `displayName`. The Polish off control is labeled `wył.` The same props object is not `window.netflix.appContext.state.playerApp.getAPI().videoPlayer`; that call was not present.
- `getTrickPlayURL` / `getTrickPlayFrame` appeared on a player props object, but a later mounted tree did not return a thumbnail URL. No sprite or storyboard response was confirmed, so timeline thumbnails and chapters are not invented.
- The public player had no `mediaKeys`. That does not say anything about a signed-in title.

## Why the page showed through Theater Mode

Measured in a 1280×800 viewport, then again after resizing to 1440×900.

The modal video's ancestor `[role="dialog"]` computes `transform: matrix(1, 0, 0, 1, 0, 0)` from `transform: scale(1)`, with `scale: none`. That identity transform is still a containing block for `position: fixed`. Before the reset the video measured 1030×578 at (125, 111) inside the dialog, not the viewport. Ancestors also use `overflow: hidden` / `auto`, which crop it to that box. The dialog transitions `transform` for 533ms. `.theater-everywhere-parent-active` already sets `transform: none`, but until `transition: none` is set the used value stays a matrix, and the viewport-sized video was measured at y=3381 inside the scrolled containing block. Setting `transition: none` and `transform: none` in the same turn moved it to (0, 0) at 1280×800. `elementFromPoint` on all four corners hit the video. After resize the same pin measured 1440×900 at (0, 0). Removing the overrides restored the dialog matrix and the 1030×578 box.

`#theater-everywhere-stage` is a child of `<html>`. `.theater-everywhere-parent-active` also sets `z-index: 2147483647` on `<body>`, so the page paints above the stage. Gaps around a trapped video show the title page, including the series card.

The visible hero has a different trap. One ancestor uses `filter: drop-shadow(...)`. Two ancestors use `mask-image` gradients (a bottom fade and a radial fade). Those masks clip a `position: fixed` video to the hero shape: the border box can already be the viewport while `elementFromPoint` still hits the page. `mask: none` cleared that, and the corners then hit the video at (0, 0).

Raised mode keeps `object-fit: contain` and `object-position: center top` (`50% 0%`) on that full-viewport video, so the 16:9 picture stays at the top and the video background fills the lower band. Host subtitles (`.player-timedtext`) are pinned into that band with `--theater-letterbox`. Escape removes the inline containment, the Netflix stage class, and the host-control hide rules.

`setTimedTextTrack` with the Polish track made a dialogue cue appear in `.player-timedtext`. Selecting the `wył.` track suppressed that dialogue. Forced narrative cards can still appear on the off track. Native `video.textTracks` stayed empty. Timeline thumbnails were not available.

## What Theater Mode uses

- Current title from the player, the pressed preview control, or the page title with the Netflix site suffix removed. A new video id does not keep the previous title.
- Subtitle languages from the host track list, switched with `setTimedTextTrack`. Netflix keeps drawing them. The extension does not download caption files, manifests, or licenses.
- No chapters and no timeline thumbnails unless a later measurement finds a real preview source.
- Netflix is included in the Rich Theater Experience switch. Stored settings that turned every older provider off, and have no Netflix key, keep Netflix off too.
- Netflix is not on the media fetch allowlist.
