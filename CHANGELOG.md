# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.5.0] - 2026-09-20

Theater Everywhere 1.5.0 is the biggest playback upgrade so far!

Rich TheaterExperience brings service-aware subtitles, chapters, hover previews, and richer timelines to YouTube, Vimeo, Patreon, Twitch, and Disney+, while the core theater mode remains available on any HTML5 video. This release also makes subtitles easier to customize and restore, improves live and DVR playback, and fixes a wide range of player-specific reliability issues.

### Added
- Added a media-features layer for captions, chapters, and hover previews, starting with native HTML5 tracks, YouTube description chapters, YouTube session caption tracks, and YouTube storyboard thumbnails.
- Added word-timed caption rendering for YouTube json3/srv3 tracks, plus subtitle appearance options (text, size, shadow, background) from the CC menu.
- Remember the selected subtitle language per site (by language code, not the menu label) and turn it back on in later theater sessions.
- Theater mode autoloads captions when the last session on that site left them on, even if the next video only has a different language.
- Added a `C` shortcut to toggle subtitles in theater mode, using the remembered language code when turning them back on.
- Added Settings → Features toggles for YouTube, Vimeo, Patreon, Twitch, and Disney+ extras (captions, chapters, previews). Theater mode still works on those sites when a toggle is off.
- Theater chrome now renders in an isolated shadow tree so host page CSS cannot restyle the player UI (including the subtitles menu font).
- Mute and unmute from the theater speaker button or the default `M` shortcut share one action and show the center HUD, same as play/pause and volume.
- Caption HUD has a top-right variant (top-left in RTL) with the same 24px edge inset as the control bar. Captions use it for on/off, a spinner with “Loading subtitles…” while a track is fetching, and the loaded track name on a second line.
- Vimeo timeline hover previews now use the same sprite thumbnails as Vimeo's own scrubber.
- Patreon native Mux videos now use Mux storyboard sprites for timeline hover previews, Mux caption WebVTT when the post has closed captions, plus post-body chapter timestamps when they follow the usual `00:00 Title` pattern.
- Live streams now show a LIVE badge, map the scrubber onto the DVR `seekable` window when one exists, hide seeking on unseekable live, and hide the speed control on all live. Detection is generic from the media element (`duration === Infinity`, sliding DVR ranges) plus host live hints such as YouTube `getVideoData().isLive`, because YouTube Live reports a growing finite duration that would otherwise look like a VOD. On seekable live, clicking LIVE jumps to the live edge.
- Twitch VODs now use page `seekPreviewsURL` sprites for timeline hover previews and `video.moments` game-change markers as chapters, without calling Helix or `gql.twitch.tv`.
- Disney+ theater extras harvest the page's playback JSON and thumbnail index (never by calling BAM GraphQL from the extension). Captions come from the signed HLS master on `*.dssott.com` (`#EXT-X-MEDIA` subtitle playlists and WebVTT segments). Hover previews use the MAIN Roku BIF the page already fetched.
- YouTube theater extras now draw the Most Replayed heatmap above the seek bar from watch-page JSON (`MARKER_TYPE_HEATMAP` / legacy `HEATSEEKER`) already loaded by the player, with the native SVG path as fallback. The chart appears when hovering the seek bar, uses a white ridge and a fade-to-transparent fill, and tints the played side to the accent color. The extension does not POST extra InnerTube requests for it.

### Changed
- New installs no longer exclude `youtube.com` by default. Website exclusions still apply only to the top-level site, so provider embeds keep working.
- Privacy policy now describes in-session provider requests for captions and timeline previews.
- Timeline hover previews now open from the same height as the volume and speed popovers.
- The theater clock uses tabular digits and a duration-stable format so ticking seconds do not resize the scrubber.
- Seekable live that is behind the live edge keeps a LIVE label in the control bar, in the same color as VOD time, instead of a negative clock that can jitter by a second. Hovering the scrubber still shows how far behind you are.
- Captions only lift when a control actually overlaps them, instead of always clearing the tallest open overlay.
- Theater mode now flattens 3D containing blocks on ancestors, so players on sites like Threads fill the viewport instead of staying in the post column.
- The subtitles menu is compact and scrollable, with a sticky header, so long language lists (Disney+ and similar) keep the top of the menu on screen.
- MAIN world always installs Space and volume-boost handlers. Fetch/XHR harvest still patches only on provider hosts.
- `PlayerSession` owns the theater element: enter goes through `rebind`, exit through `dispatch({ type: 'EXIT' })`, and a network EXIT without `sessionId` is ignored.
- Player chrome is split out of `player-runtime.ts` into `hud`, `help`, `discovery`, `toolbar`, and `controls`, sharing a `PlayerChromeContext` so views do not import `src/providers/*`.
- Playback keys and chrome clicks go through `PlayerCommand` (`PLAY_PAUSE`, `SEEK_BY`, `TOGGLE_CAPTIONS`, `CYCLE_VIDEO`, `CYCLE_FIT`, `TOGGLE_HELP`) instead of calling host seek/play APIs from the views.

### Fixed
- The heatmap accent/white split no longer leaves a 1px white fringe at the hover pin.
- Pressing play in theater mode on an unstarted Vimeo (or similar) player now clicks the host Play control instead of calling `video.play()` on an empty element, which left a spinner and never attached media.
- Unmuting from the theater speaker button restores the last audible level (or 100% when the player started at volume 0), instead of leaving autoplay-muted videos silent.
- Native HTML5 captions now render through the same theater overlay as YouTube, so subtitle options apply and host players like AblePlayer no longer show a second unstyled layer.
- Theater time and scrubber no longer treat `video.duration === Infinity` as a VOD at 0%; live DVR can seek inside `video.seekable`.
- MSE/Hive VOD that reports `duration === Infinity` with a seekable range starting at 0 (Disney+ and similar) is no longer labeled LIVE; the scrubber maps onto the known prefix, or the native chrome/session duration when that is available.
- YouTube Live no longer shows about an hour behind the live edge: the media `duration` includes lookahead past the actual head, so theater mode maps the DVR window from YouTube's progress bar and seeks through the player API.
- YouTube VODs are no longer treated as live just because the player has `ytp-livebadge-color`; that class is now on regular watch-page chrome even when `getVideoData().isLive` is false and the Live badge is `display: none`.
- Seeking inside a YouTube Live DVR window no longer snaps the theater scrubber back to the previous click while HTML5 `currentTime` is still catching up.
- Live chrome no longer treats a huge or paused-at-zero `seekable` range as a 300,000-hour DVR window; unseekable live now shows `LIVE` and locks the scrubber.
- Leaving theater mode on YouTube now asks the native player to recompute its chrome width, so the progress bar no longer stays full-viewport.
- Volume and speed hover bridges no longer steal clicks from the top half of their toolbar buttons.
- Advancing a YouTube playlist no longer keeps the previous video's seek-bar thumbnails, chapters, or overlay captions.
- Overlay captions reload for the next YouTube playlist item instead of staying enabled with no text.
- YouTube playlist items no longer show “No subtitles” when the native player has captions: theater was reading the previous video’s `ytInitialPlayerResponse` after SPA navigation, discarding it as stale, and leaving an empty track list. It now prefers the live player response (skipping hidden Shorts leftovers) and a published current-video snapshot.
- Patreon hover previews now read the signed Mux `storyboard.vtt` from the post payload. Mux Player leaves `.storyboard` empty when a playback token is set without a storyboard token, so theater mode previously had no thumbnails even though the sprites existed.
- Patreon captions can be turned on from theater mode. Mux keeps subtitle WebVTT off the inner `<video>` until the host CC menu is used; theater mode now loads `stream.mux.com/.../text/*.vtt` from the post payload.
- Patreon no longer lists the same Mux caption twice (host `English (auto-generated)` plus a generic `Captions` sidecar).
- Subtitle HUD waits for overlay cues, so `C` and the CC icon stay in sync instead of reporting on before captions exist.
- Volume boost stays orange only after the Web Audio graph exists, Picture-in-Picture uses the same active color as CC, and LIVE only offers “Go to live” when playback is behind the live edge.
- Theater mode on players like TikTok that hide the `<video>` under an overlay now keeps native right-click menus: the video is forced visible and clickable, right-button presses are not swallowed, and host `contextmenu` blockers are stopped from reaching the theater video.
- Switch Video no longer appears on a single YouTube watch page just because hover-preview, miniplayer, a hidden leftover Shorts player, or empty leftover `<video>` elements exist. Cycling also skips those dummies, which previously opened theater on an unloaded player and left the loading spinner up.
- YouTube caption tracks now load in theater: unsigned `/api/timedtext` URLs get the same-video `pot` from the player session, instead of hanging on unsigned fetches and then reporting Subtitles off.
- Caption HUD now covers `C`, the CC menu, and a successful auto-restore, names the language when captions turn on, and says the load failed instead of Subtitles off when the track list exists but cues do not.
- HTML5 subtitle tracks that only have a label (no language code) are remembered per site the same way coded tracks are.
- Theater chrome no longer flashes unstyled HTML on enter: the player UI lives in a shadow tree, and `content.css` was loaded there with an async `<link>`. The skin is now inlined before the controls are mounted.
- Disney+ captions follow the Hive player clock (`playheadPositionMs`) instead of MSE `currentTime`, which is a different timeline and made overlay cues look late or early.
- Clicking the theater seek bar on Disney+ no longer leaves a stuck spinner: seeks go through the host player API, and a failed HTML5 `currentTime` assignment is no longer used.
- Disney+ hover previews no longer stick on a gray opening still: theater was keeping the 1-frame `DUB_CARD` BIF that loads after the MAIN timeline file, and MAIN frame timestamps are milliseconds (`multiplier = 1`) rather than seconds.
- Volume, speed, and subtitle popovers no longer stay pinned after a mouse click on their toggle, a click on the video, or the chrome auto-hide timeout. Subtitle language rows now use the full menu width as the hit target.
- YouTube description chapters now accept a two-stamp `Contents:` list (`00:00:00 - Intro` plus a later title). Theater previously required three timestamps, which is YouTube's auto-chapter UI rule, not a useful floor for the scrubber.
- Disney+ theater seek now drives the Hive player on `DISNEY-WEB-PLAYER` / `hive-video`, not the hidden dummy `<video>`, and does not pin the clock or captions to the scrubber target until the host playhead moves. A stuck opening MSE prefix retries with `play`/`scrub` instead of assigning `currentTime`.
- Space and volume boost work again on ordinary HTML5 pages. MAIN still harvests YouTube/Twitch/Disney only on those hosts.

## [1.4.0] - 2026-09-06

### Added
- Added native video fit modes (Fit, Fill, Stretch) in theater mode, with a toolbar button, a `Z` shortcut, HUD feedback, and a persisted preference.
- Added a Report a Bug header action and GitHub issue templates for bug reports and feature requests.
- Added a Privacy Thing promo chip in the settings header using `@privacy-thing/brand`, with a hover popover that explains it is a new, free, open-source privacy extension.
- Added a reusable settings dialog and a What's New header action that opens on the first visit after a new announcement, without tying acknowledgement to every extension version bump.

### Changed
- Renamed the video cycle shortcut to “Switch Video on Page” and explained that it only works when more than one HTML5 video is present.
- Show HUD feedback when `Shift+T` has nothing to switch, including iframe-based players.

## [1.3.1] - 2026-07-20

### Fixed
- Restored automatic hiding of theater controls and the cursor after inactivity in theater and fullscreen modes, including while playback is paused.
- Preserved host-page cursor styles, cleaned up transient player overlays on exit, and removed the page-triggerable CWS capture hook from the production content script.
- Fixed forwarded keyboard shortcuts throwing inside iframe-based players when they attempted to stop event propagation.

## [1.3.0] - 2026-07-10
### Added
- Added Korean locale support, including UI strings, Chrome Web Store and AMO listing copy, Noto Sans KR screenshot font support, and locale-specific promo assets.
- Added a `--locale <code>` option to the CWS screenshot renderer so a single locale can be regenerated without replacing every screenshot.
- Added generated 1280x800 CWS promo screenshots for all supported locales.

### Changed
- Refined French, Italian, Brazilian Portuguese, Korean, and Ukrainian store listing copy for clarity, store limits, and feature accuracy.
- Localized Japanese and Korean copyright footer text.
- Improved RTL direction handling in theater overlays, tooltips, help dialogs, and screenshot fallback rendering.

### Fixed
- Fixed Arabic CWS shortcut screenshots rendering the help dialog in LTR mode when the screenshot fallback mocked extension i18n.
- Fixed Japanese AMO listing copy that mixed a Korean particle into the Vimeo embed sentence.
- Fixed Ukrainian AMO listing copy typo and removed stale context-menu wording from Korean and Ukrainian store listings.

## [1.2.5] - 2026-07-10
### Added
- Added support for new extension locales: French, Brazilian Portuguese, Russian, Japanese, Italian, Arabic, and Ukrainian, including translated site-exception copy and locale-specific assets.
- Added extension homepage link in the settings header, with localized text and an icon-styled home button.
- Added generation of CWS promo screenshots for newly added locales and updated the screenshot pipeline.

### Changed
- Improved localization consistency by adding a localized “Made with ❤ in 🇵🇱” message across all 12 locales and styling it in footer variants.
- Implemented full RTL layout direction compatibility for supported right-to-left locales.
- Styled and localized footer/homepage UI elements (heart accent coloring and homepage button text/icon presentation).
- Updated screenshot tooling configuration to bundle locale-specific fonts (Japanese and Arabic) and run Chrome screenshots in headless mode by default.

### Fixed
- Fixed theater mode video viewport positioning under edge cases.
- Disabled AMO Android compatibility where it caused unsupported behavior.
- Corrected the Japanese translation for “Made in Poland” copy.

## [1.2.0] - 2026-07-09

### Added
- Localized extension UI and manifest metadata for English, Spanish, Simplified Chinese, German, and Polish using WebExtensions `_locales`.
- Paste-ready Chrome Web Store and AMO store listing copy for all supported locales.
- Release helper workflow for ensuring a requested version has a GitHub Release.
- Optional AMO, Chrome Web Store, and Microsoft Edge Add-ons publishing steps for release builds.
- Store publishing setup documentation and helper scripts for Chrome Web Store and Microsoft Edge Add-ons APIs.

### Changed
- Popup, options, and theater overlay text now use shared localization helpers and browser-selected language.
- Build packaging now copies `_locales` into Chrome and Firefox release artifacts.
- Local macOS, editor, and browser extension build artifacts are ignored by Git.

## [1.1.0] - 2026-07-02

Completely redesigned controls experience — volume and speed now live in vertical pop-up panels that appear on hover, the in-player help overlay groups shortcuts just like the settings page, and a new volume/playback HUD gives instant visual feedback when adjusting volume or toggling play/pause with keyboard shortcuts. Volume can now be boosted up to 300% using the Web Audio API with a non-linear slider design prioritizing the 0-100% range, controlled by a new feature toggle in the options panel to enable or disable it. On pages with multiple videos, the extension automatically picks the best candidate based on visibility, playback state, and size — and you can cycle between them with a single shortcut. Fullscreen transitions now automatically resume playback if the site's scripts pause the video during transition. The extension also works on more sites thanks to Shadow DOM support, and the overall look has been refined with glassmorphic tooltips and seek overlays.

### Added
- Shadow DOM traversal to discover video players inside shadow roots.
- Custom glassmorphic tooltips with keyboard shortcut hints on control buttons.
- New icon design with active/disabled states and youtube.com as a default exclusion.
- Vertical pop-up sliders for volume and speed controls replacing the inline horizontal sliders.
- Volume Boost option allowing users to amplify volume up to 300% using the Web Audio API, mapped non-linearly to the top 1/3 of the slider track.
- Volume Boost feature toggle switch in the options page to enable/disable the feature.
- Customizable keyboard shortcuts: Volume Up (`ArrowUp`), Volume Down (`ArrowDown`), Toggle PiP (`P`), Show/Hide Help (`H`).
- macOS/iOS-style volume HUD overlay with dynamic speaker icons and directional zoom-in/zoom-out text animations.
- Play and Pause HUD overlay notifications when using keyboard shortcuts to toggle playback.
- Unified glassmorphic seek overlays matching the volume HUD visual style.
- Help overlay now organized into the same shortcut groups as the settings page.

### Changed
- Website exclusions redesigned from tag/badge cloud to a compact vertical domain list.
- Default frame step shortcuts changed from `N`/`M` to `<`/`>`.
- Migrated from npm to pnpm.
- UI overlay and loading indicator appended to `document.body` for layout isolation.
- `Escape` key now closes the help overlay first instead of exiting theater mode when help is open.

### Fixed
- Mozilla Addons (AMO) validator errors and warnings resolved.
- Security, compatibility, and store compliance issues addressed.
- Player controls, slider styling, www-domain matching, and CI versioning.
- Content script shortcut initialization mapping for new shortcuts.
- CSS `!important` removed from `@keyframes` declarations (browsers ignore it per spec).
- Playback pausing when entering/exiting fullscreen on pages containing multiple video elements.

## [1.0.0] - 2026-06-29

Initial public release of Theater Everywhere.

### Added
- Core theater mode: maximize any HTML5 video to fill the browser viewport with a single keypress (`T`).
- Multi-video cycling with `Shift+T` to switch between videos on a page.
- Full player controls overlay: play/pause, seek bar with buffering indicator, loading spinner, volume and speed sliders.
- Subtitle support with native `textTracks` selection and custom cue styling.
- Configurable keyboard shortcuts with options page and per-key reset buttons.
- Website blacklist to disable the extension on specific domains.
- Dynamic system AccentColor integration for theming.
- ArrowLeft/ArrowRight seek with animated YouTube-style visual overlay indicators.
- Frame-stepping with `N`/`M` keys.
- Fullscreen toggle with `F` key.
- Play/Pause with `Space` key.
- GitHub Actions CI workflow for automated builds and tagged releases.
- Chrome and Firefox extension packaging (MV3).
