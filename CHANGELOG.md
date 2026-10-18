# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Adjust volume with the mouse wheel or trackpad over the theater speaker, volume slider, or the gap between them, with the same volume feedback and optional boost as keyboard shortcuts. Vertical resize arrows on hover indicate the gesture.
- **Video launcher (BETA):** Enable it in Settings → Features (off by default) to enter theater mode directly from a video. The accent-colored button appears along the video's left edge, or in YouTube's native toolbar with Rich Theater Experience enabled. It hides during user-initiated playback or inactivity but remains available for autoplay, including shortly after navigation. The YouTube version stays visible whenever player controls are available, with an overlay fallback. Hover or focus changes its appearance, the tooltip shows your shortcut, and Escape temporarily dismisses it. Tiny videos, muted looping previews, and videos already in theater, fullscreen or picture-in-picture are excluded. Disabling AutoTheater offers to enable the launcher once. The theater entry notice also has a cleaner, solid appearance.
- **Theater playback controls:** Double-click the video to toggle fullscreen without leaving theater mode. Single-click to play or pause, with immediate visual feedback and a brief delay to prevent accidental toggling on double-click. Clicking an open player panel only closes it. Double-clicking controls or menus has no effect, and normal page behavior remains unchanged outside theater mode.
- **Accessibility and appearance:** Independently configure High contrast, Reduce transparency, and the new Reduce motion setting under Settings → Appearance, each with Auto / On / Off options. Auto follows system preferences, and changes apply instantly across Settings, the popup, and the theater player. High contrast improves readability and focus visibility; Reduce transparency uses solid backgrounds. Reduce motion removes decorative animations, freezes animated indicators, and replaces scrolling titles with truncated text that expands on hover or focus. High contrast also simplifies decorative tile borders. Subtitle styling preferences remain intact.
- Read the privacy policy inside the extension: Settings → About has a Privacy policy section whose button opens the full policy in a scrollable dialog, with an Open online version link. The policy text is English only.

#### Rich Theater Experience

- **Service settings:** Settings → Features now displays interactive service tiles with individual switches, capability badges, expandable details and filters, including AutoTheater and Playlists. The latter covers supported playlists, queues and episode navigation across YouTube, Vimeo, Netflix, Disney+, Bilibili and Tencent Video / WeTV. All services applies changes to currently displayed services, while Clear filter resets filtering. Tiles feature service-specific brand colors and animated effects, simplified when Reduce motion is enabled. Disabled services remain configurable with neutral styling. The popup switch controls only the active tab's supported service and stays synchronized with Settings. Service counts and sticky section headings improve navigation.
- **Bilibili and Tencent Video / WeTV:** Added theater integration with titles, subtitles, chapters, timeline previews and native previous/next navigation where available. Tencent's WebAssembly player is also supported.
- **Bilibili.tv:** Dedicated integration for episode and upload pages, including titles, subtitles, timeline previews, Intro/Outro markers and next-episode navigation.
- **Crunchyroll:** Added episode titles, intro and credits chapters, timeline previews and subtitle selection. Burned-in subtitles no longer display a misleading Off option.
- **Netflix:** Added theater support for trailers and previews, plus episode titles, native subtitle selection and timeline previews on watch pages. Existing Rich Theater Experience preferences are preserved.
- **Contextual player actions:** Skip intro, credits, recap and up-next buttons now appear directly over supported Netflix, Disney+, Crunchyroll and Bilibili videos, alongside YouTube's native ad-skip action. Buttons follow the host player's availability and countdown, adapt to letterboxing and different theater layouts, and feature a brief accent animation unless Reduce motion is enabled.
- **Automatic theater entry:** Bilibili `/video/BV…` pages (including separate parts; mini players and ad playlists stay manual), Bilibili.tv video and episode pages (excluding mini players and in-stream ads), Netflix, Disney+ and Patreon posts with a single native video, in either of Patreon's player variants (several videos, live streams and embedded players stay manual) now support automatic theater entry on watch pages, accompanied by a corner notification.
- **AutoTheater countdown:** Automatic entry now displays a notification a moment after playback is requested (skipped if the page moves on first), with a minimum five-second countdown before theater mode opens. Animated digits (4–0) and a synchronized spinner provide visual feedback, respecting Reduce motion and transparency settings. On YouTube, the countdown begins immediately after navigating to a video, even before loading finishes. Brief playback interruptions no longer reset it; longer pauses, ads or errors cancel it, while a new video resets the process. Click the notification or press Esc to cancel entry for that video. The new Skip countdown option in Settings → Features → Rich Theater Experience enters theater as soon as playback is ready. AutoTheater remains visible but marked Unavailable in player settings when the current service or page lacks support.

#### Chat, layout and player controls

- Search subtitle lists with eight or more tracks by track name or language, ignoring accents. The CC menu now uses the same airy, regular-weight rows as Player settings, with keyboard search and selection; Escape clears the search before closing.
- Preserve existing Twitch and YouTube chat in theater mode, beside the picture or below it in narrow windows. Show/hide chat from the player toolbar or Alt+R, also while the YouTube chat itself has focus (a chat the viewer collapsed is reopened natively), and choose its width and Light / Service settings / Dark theme from Player settings; preferences are remembered per service. Replay that the service does not offer shows no chat controls. [Usage, validation and remaining release qualification](docs/research/native-chat-validation.md).
- Raised is the default picture layout, shown only while subtitles are on. Choose a Centered or Raised picture layout from Settings → Appearance, Player settings or the configurable Shift+L shortcut. Raised pins a widescreen picture to the top of a taller screen (16:10, 4:3) whenever the spare black can hold one caption line with padding and an edge gap, leaving that space below for captions and controls. Raised only with subtitles, on by default, keeps the picture centered until subtitles are on; turn it off to raise the picture always. Fill and Stretch stay centered, and the saved Raised choice returns when Video Fit is set back to Fit.
- Raised captions use the space below the picture. One or two lines stay centered in a short 16:10 letterbox when they fit, three or more stick to the bottom of the screen, and a deeper band centers a short block no more than 48px below the picture. The default background in both Centered and Raised uses the video black at the opacity chosen in subtitle options.
- Keep the playback controls and progress bar visible in theater mode using Player settings → Pin controls, the configurable Shift+H shortcut, or Settings → Appearance → Pin controls. Pinned controls dock flush to the player’s bottom and side edges, with the picture and centered or raised captions kept above the bar. The preference is remembered across videos and tabs; the title and cursor still hide when idle. Thanks to [@liango2](https://github.com/liango2) for suggesting this feature in [#3](https://github.com/TomaszJanusz/Theater-Mode-Everywhere/issues/3).
- Previous and next buttons sit beside play and appear only while the host can actually use them. They work for YouTube playlists and queues (even when YouTube hides its own buttons), PeerTube / video.js, Dailymotion, Vimeo Showcase and the Rich Theater Experience services that expose next-episode navigation, and preview the target on hover where the host provides one.
- The player shows the title beside the controls, with a home button. Rich Theater Experience titles take priority; on other sites the title comes from the video's own label, a schema.org VideoObject for the playing video, the page's Open Graph, Twitter or document title, or a heading that belongs to the video. Site-name-only titles are omitted; a player embedded in a same-origin frame can fall back to its parent page, including adjacent series and episode headings. When a site switches videos without reloading, the previous title is hidden until the page shows the new one. The F shortcut opens fullscreen without theater mode; the configured fullscreen shortcut enters TME with its controls and takes precedence over host player shortcuts.
- The time readout shows elapsed time, the scrubber, then time remaining; click the trailing clock to switch to the total duration. Digits change in fixed slots, so the bar never shifts. Changing digits roll left to right with a short stagger and settle with a small bounce past their resting line (a plain swap with Reduce motion).
- Choose a language for Settings, the popup and in-page player controls from the language menu in Settings → Appearance. All 13 bundled languages are available; Automatic keeps following the browser language. Open interfaces update without reloading, including accent labels, exclusion controls and dialogs.
- Screen-reader labels, states and status announcements in Settings and the player, with keyboard seeking and focus handling for popovers and dialogs.
- Settings are split into tabs — Appearance, Features, Website Exclusions, Keyboard Shortcuts and About — instead of one long page. The open tab is kept in the address (for example `options.html#shortcuts`), so a reload or link returns to the same section. About carries a short note from the author, the logo, tagline and installed version, and the MIT license text. Scrollbar thumbs in Settings and the player settings menu use the accent color.
- Shortcut conflict validation in Settings: keep the existing assignment or move it to another action, leaving the previous action unassigned. Existing duplicate shortcuts are highlighted, and edits from several Settings tabs are saved in order.
- Player settings gain an Audio section: Volume boost, Voice boost (light or strong dialogue enhancement), Reduce loud sounds and Bass (Less, Original, More, or the extra-heavy MOAAARR), with shortcuts V, R, B and Shift+B. Rows with a non-default level are highlighted in the accent colour, and Bass shows a subwoofer whose sound waves grow with the level; MOAAARR turns it red and rocks it from foot to foot (still when Reduce motion is on). Audio is processed only while a setting is on. On protected (DRM) media, or when the server refuses cross-origin access, the section explains why audio settings are unavailable instead of listing dead rows. Every Player settings row stays on one line in all 13 languages: the compact menu keeps shortcuts and short status values visible, with an ellipsis and full-name tooltip for long labels. The menu keeps the same width when a value such as On / Off changes. The subtitle language menu follows the same rules: rows and header stay on one line, and long track names are shortened with an ellipsis (full name on hover).
- Show installed SponsorBlock markers in the YouTube theater timeline with SponsorBlock’s colors, exactly the scrubber track’s height and accent-contrasting side edges so segments remain distinct from played progress, with a tick at the start and end of each segment (merged with chapter ticks on the same position; chapter ticks cut the track in the player bar’s colour instead of white), keep its notices visible, and enable or disable markers with SponsorBlock support in Settings → Features.

### Changed

- The Play and Pause notice in theater mode no longer animates its text.
- The extension name in Chromium browsers now carries a translation of the tagline, for example “Theater Mode Everywhere — One player to rule them all”, in every supported language. Firefox keeps the plain name.
- Refreshed and fully translated the store listing descriptions, summaries and keywords in all supported languages to cover the 2.0 features.
- Settings and player dialogs share one layout, close control, scrolling area and keyboard behavior, including High contrast and right-to-left layouts. Update highlights keeps its acknowledgements visible; subtitle options returns focus to the CC button.
- Updated the privacy policy to explain browser settings sync and direct video-service requests, and linked it from Settings → About.

- Settings footer uses a single row where space permits, with larger text and no divider above it.
- Show the logo on its own, without the accent-colored square, in the popup and Settings header.
- Update highlights carries the full 2.0 announcement in English, including SponsorBlock compatibility, AutoTheater's countdown, the Video launcher, fullscreen by double-click and system accessibility preferences, with localized dialog title and buttons. Its wider dialog has a close button, styled scrollbar and directional scroll shadows, with acknowledgements always visible. New feature badges in Settings (including AutoTheater, High contrast, Reduce transparency, Reduce motion and the Bilibili, Bilibili.tv, Tencent Video / WeTV, Crunchyroll and Netflix tiles) and Player settings, with dots on player row icons and the settings gear, and one badge for the whole Audio section, highlight recent additions until you open Update highlights or 30 days pass for that generation. Merely viewing Settings does not mark features as seen. Highlight new features in Appearance hides the badges while off and restores unseen badges when turned back on, and its Hide until next version button (then Restore badges) silences the badges and the Update highlights indicator in Settings and the player until the next release, without marking anything as seen; fresh release installs start with the current update marked as seen. Development builds remember the unreleased features acknowledged in that profile and highlight newly added items after a rebuild within the same 30-day window.
- Corrected misleading control labels, grammar and inconsistent theater-mode terminology across extension languages, including picture layout, the video launcher, accent colors and service counts. The About tagline is now localized in every supported language.
- Group video fit, player switching, controls visibility, audio and keyboard help in a labeled Player settings panel that opens on hover; Keyboard Shortcuts stays last, above Extension settings. Playback, captions, speed, PiP, fullscreen and exit remain directly available. Menus keep their position next to their buttons.
- Keyboard help uses two columns on wide screens and a scrollable single column on narrow screens.
- Keyboard shortcuts are regrouped in Help and Settings: a new first section, Theater, Fullscreen & PiP, holds theater, exit, fullscreen and Picture-in-Picture; frame stepping moves to Playback & Volume Controls, and the remaining section is renamed Player Controls.
- Settings and keyboard shortcuts share grouped panels and matching rows. Appearance groups accessibility preferences together and includes Pin controls.
- Settings Appearance is a full-width card. Layout sits above accent colors, each choice shows a wireframe and which screens it suits, and the Privacy Thing promo is a short strip under the header.
- The subtitles menu opens scrolled so the active track sits as close to the middle of the list as possible, with keyboard or pointer, and keeps your own scroll position once you move the list.
- Subtitle loading shows a pulsing CC icon, and the "Loading subtitles…" HUD appears only if loading takes noticeable time, so quick loads no longer flash it. On completion, the same spinner shrinks away over half a second while the language name gently appears beneath “Subtitles on”, with its space preserved to keep the label steady; turning subtitles off and on again reveals the language name the same way. The notice eases smoothly (about 0.2 s) between its sizes instead of jumping, with its text staying anchored to the corner edge. The video buffering spinner sits in a round HUD plate centred over the picture; when loading ends the plate and its ring shrink away together; Reduce motion makes all of this instant.
- Disney+ titles include the episode label, for example "VisionQuest — S1:O1 Wyzwolenie", and Disney+ captions sit above the picture and clear of the controls, including while the bar fades out. Caption movement keeps its glide when the controls appear.
- Lower background CPU and memory use. Plain mouse movement no longer scans the page for video, chat watching and timers run only on Twitch and YouTube watch pages and pause in hidden tabs, the Disney clock follows native player events instead of a constant poll, and unrelated network responses are no longer cloned or decoded. Captions caches and body reads are size-bounded, the scrubber tooltip reuses its elements, and release packages are minified with a readable diagnostic build available through `TME_BUILD=diagnostic`.

### Fixed

- The loading spinner no longer stays on screen after the video resets and never recovers: it clears after a few seconds, and does not appear at all when the reset video is paused.
- The subtitles menu on a video without subtitles no longer shows a dark rectangle over its bottom corner and the video; only the CC icon is dimmed.
- A page embedding a player in a frame leaves theater when that frame reloads or navigates, instead of staying pinned around a frame without controls.
- Fullscreen in a player embedded in a frame follows one owner: pressing F, double-clicking or using the fullscreen button leaves fullscreen the same way it was entered, whether focus is in the embedding page or the player. Previously, entering from one and leaving from the other stacked a second fullscreen, so the shortcut seemed to do nothing.
- Escape leaves theater mode even when the page claims that key in the capture phase first, as the theater and fullscreen shortcuts already did.
- YouTube automatic theater entry resumes when watch-player data catches up, a focused field or fullscreen is left, or the miniplayer expands to the watch page, without waiting for another playback event.
- Clicking the picture or a control shows the play/pause HUD again, and clicking the picture closes an open player menu without pausing.
- Disney+ next-episode playback keeps the picture visible and follows the current episode's full timeline, including seeking beyond a shorter reported runtime.
- Seeking from the progress bar or keyboard shows loading immediately and keeps it visible until the requested position is ready.
- Playback and volume feedback stay centered vertically on the displayed picture, including in Raised layout.
- YouTube captions stay on the track selected in the menu.
- Cancelling Volume Boost while its media is still loading restores host playback.
- Several player lifecycle races on navigation and theater exit, found in an audit, are fixed.

## [1.5.0] - 2026-09-20

Theater Everywhere 1.5.0 is the biggest playback upgrade so far. Rich Theater
Experience brings service-aware subtitles, chapters, hover previews, and richer
timelines to YouTube, Vimeo, Patreon, Twitch, and Disney+, while the core theater
mode remains available on any HTML5 video. This release also makes subtitles
easier to customize and restore, improves live and DVR playback, and fixes a
wide range of player-specific reliability issues.

**Highlights:**
- Choose, style, and remember subtitles directly in theater mode.
- Preview scenes, jump between chapters, and see YouTube's Most Replayed moments on supported services.
- Navigate live streams and DVR windows with clearer LIVE state and more reliable seeking.
- Enjoy more consistent controls, HUD feedback, layout isolation, and playback across complex video sites.

### Added

#### Subtitles and player interface

- Added a media-features layer for captions, chapters, and hover previews, starting with native HTML5 tracks, YouTube description chapters, YouTube session caption tracks, and YouTube storyboard thumbnails.
- Added word-timed caption rendering for YouTube json3/srv3 tracks, plus subtitle appearance options (text, size, shadow, background) from the CC menu.
- Remember the selected subtitle language per site (by language code, not the menu label) and turn it back on in later theater sessions.
- Theater mode autoloads captions when the last session on that site left them on, even if the next video only has a different language.
- Added a `C` shortcut to toggle subtitles in theater mode, using the remembered language code when turning them back on.
- Added Settings → Features toggles for YouTube, Vimeo, Patreon, Twitch, and Disney+ extras (captions, chapters, previews). Theater mode still works on those sites when a toggle is off.
- Theater chrome now renders in an isolated shadow tree so host page CSS cannot restyle the player UI (including the subtitles menu font).
- Mute and unmute from the theater speaker button or the default `M` shortcut share one action and show the center HUD, same as play/pause and volume.
- Caption HUD has a top-right variant (top-left in RTL) with the same 24px edge inset as the control bar. Captions use it for on/off, a spinner with “Loading subtitles…” while a track is fetching, and the loaded track name on a second line.

#### Rich Theater Experience integrations

- Vimeo timeline hover previews now use the same sprite thumbnails as Vimeo's own scrubber.
- Patreon native Mux videos now use Mux storyboard sprites for timeline hover previews, Mux caption WebVTT when the post has closed captions, plus post-body chapter timestamps when they follow the usual `00:00 Title` pattern.
- Live streams now show a LIVE badge, map the scrubber onto the DVR `seekable` window when one exists, hide seeking on unseekable live, and hide the speed control on all live. Detection is generic from the media element (`duration === Infinity`, sliding DVR ranges) plus host live hints such as YouTube `getVideoData().isLive`, because YouTube Live reports a growing finite duration that would otherwise look like a VOD. On seekable live, clicking LIVE jumps to the live edge.
- Twitch VODs now use page `seekPreviewsURL` sprites for timeline hover previews and `video.moments` game-change markers as chapters, without calling Helix or `gql.twitch.tv`.
- Disney+ theater extras harvest the page's playback JSON and thumbnail index (never by calling BAM GraphQL from the extension). Captions come from the signed HLS master on `*.dssott.com` (`#EXT-X-MEDIA` subtitle playlists and WebVTT segments). Hover previews use the MAIN Roku BIF the page already fetched.
- YouTube theater extras now draw the Most Replayed heatmap above the seek bar from watch-page JSON (`MARKER_TYPE_HEATMAP` / legacy `HEATSEEKER`) already loaded by the player, with the native SVG path as fallback. The chart appears when hovering the seek bar, uses a white ridge and a fade-to-transparent fill, and tints the played side to the accent color. The extension does not POST extra InnerTube requests for it.

### Changed

#### Playback and presentation

- New installs no longer exclude `youtube.com` by default. Website exclusions still apply only to the top-level site, so provider embeds keep working.
- Privacy policy now describes in-session provider requests for captions and timeline previews.
- Timeline hover previews now open from the same height as the volume and speed popovers.
- The theater clock uses tabular digits and a duration-stable format so ticking seconds do not resize the scrubber.
- Seekable live that is behind the live edge keeps a LIVE label in the control bar, in the same color as VOD time, instead of a negative clock that can jitter by a second. Hovering the scrubber still shows how far behind you are.
- Captions only lift when a control actually overlaps them, instead of always clearing the tallest open overlay.
- Theater mode now flattens 3D containing blocks on ancestors, so players on sites like Threads fill the viewport instead of staying in the post column.
- The subtitles menu is compact and scrollable, with a sticky header, so long language lists (Disney+ and similar) keep the top of the menu on screen.

#### Runtime architecture

- MAIN world always installs Space and volume-boost handlers. Fetch/XHR harvest still patches only on provider hosts.
- `PlayerSession` owns the theater element: enter goes through `rebind`, exit through `dispatch({ type: 'EXIT' })`, and a network EXIT without `sessionId` is ignored.
- Player chrome is split out of `player-runtime.ts` into `hud`, `help`, `discovery`, `toolbar`, and `controls`, sharing a `PlayerChromeContext` so views do not import `src/providers/*`.
- Playback keys and chrome clicks go through `PlayerCommand` (`PLAY_PAUSE`, `SEEK_BY`, `TOGGLE_CAPTIONS`, `CYCLE_VIDEO`, `CYCLE_FIT`, `TOGGLE_HELP`) instead of calling host seek/play APIs from the views.

### Fixed

#### Playback, live video, and controls

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

#### YouTube playlists and subtitles

- Advancing a YouTube playlist no longer keeps the previous video's seek-bar thumbnails, chapters, or overlay captions.
- Overlay captions reload for the next YouTube playlist item instead of staying enabled with no text.
- YouTube playlist items no longer show “No subtitles” when the native player has captions: theater was reading the previous video’s `ytInitialPlayerResponse` after SPA navigation, discarding it as stale, and leaving an empty track list. It now prefers the live player response (skipping hidden Shorts leftovers) and a published current-video snapshot.

#### Patreon

- Patreon hover previews now read the signed Mux `storyboard.vtt` from the post payload. Mux Player leaves `.storyboard` empty when a playback token is set without a storyboard token, so theater mode previously had no thumbnails even though the sprites existed.
- Patreon captions can be turned on from theater mode. Mux keeps subtitle WebVTT off the inner `<video>` until the host CC menu is used; theater mode now loads `stream.mux.com/.../text/*.vtt` from the post payload.
- Patreon no longer lists the same Mux caption twice (host `English (auto-generated)` plus a generic `Captions` sidecar).

#### Subtitle feedback and player discovery

- Subtitle HUD waits for overlay cues, so `C` and the CC icon stay in sync instead of reporting on before captions exist.
- Volume boost stays orange only after the Web Audio graph exists, Picture-in-Picture uses the same active color as CC, and LIVE only offers “Go to live” when playback is behind the live edge.
- Theater mode on players like TikTok that hide the `<video>` under an overlay now keeps native right-click menus: the video is forced visible and clickable, right-button presses are not swallowed, and host `contextmenu` blockers are stopped from reaching the theater video.
- Switch Video no longer appears on a single YouTube watch page just because hover-preview, miniplayer, a hidden leftover Shorts player, or empty leftover `<video>` elements exist. Cycling also skips those dummies, which previously opened theater on an unloaded player and left the loading spinner up.
- YouTube caption tracks now load in theater: unsigned `/api/timedtext` URLs get the same-video `pot` from the player session, instead of hanging on unsigned fetches and then reporting Subtitles off.
- Caption HUD now covers `C`, the CC menu, and a successful auto-restore, names the language when captions turn on, and says the load failed instead of Subtitles off when the track list exists but cues do not.
- HTML5 subtitle tracks that only have a label (no language code) are remembered per site the same way coded tracks are.
- Theater chrome no longer flashes unstyled HTML on enter: the player UI lives in a shadow tree, and `content.css` was loaded there with an async `<link>`. The skin is now inlined before the controls are mounted.

#### Disney+ and remaining platform fixes

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
