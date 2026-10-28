# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Czech and Slovak translations for settings, the extension popup, player controls and store listings.
- British English wording in the extension and store listings.
- On YouTube, theater now works on the miniplayer: with a video playing in the corner of Home, search or another page, press the theater shortcut or the video launcher on the miniplayer to fill the window with it. The title, chapters, heatmap, previews and subtitles are that video's own, never the page's or a previous video's. It stays in theater when the next video of a playlist or queue starts there, and the title and timeline follow it and when you move between pages; expanding the miniplayer keeps theater on the video page, and closing it or leaving theater puts the miniplayer back in its corner, still playing. AutoTheater never starts on the miniplayer, hover previews and Shorts are still never a target, and leaving a video page in theater still ends theater.
- Navigate the player bar from the keyboard: W opens the controls bar and focuses the settings button, then W, A, S and D move up, left, down and right across the bar and into its menus. W on a menu button opens the menu on its bottom row, the one nearest the bar (scrolling a long menu to it), and S below that row closes it again. The time readouts and the progress bar are passed over; Tab still reaches them. On a setting with several levels, A and D lower and raise the value, and while that row has keyboard focus its arrows show those keys instead; S on the bar's bottom row hides the bar, and Escape ends navigation (a second Escape leaves theater as before). The four keys are one "Navigation" group in the shortcut settings and the shortcuts help, and they work by position, so the same cluster is under your left hand on QWERTY, QWERTZ and AZERTY keyboards. Outside theater, and while typing in a field, the keys stay the page's own.
- Playback speed shortcuts, as on YouTube: < and > (Shift+, and Shift+.) lower and raise the speed one step of the speed menu (0.25x to 2x), and the new speed shows on screen; Frame step moves to the unshifted , and . keys. Like the speed button, they do nothing on live streams. They can be changed in Settings and are listed in the shortcuts help; if you had already given < or > to another action, that key stays where it is and the speed shortcut starts unassigned.

### Changed

- The Korean store listing now highlights Crunchyroll alongside YouTube, Netflix and Disney+.
- Keyboard shortcuts now show the names printed on the keys, one key cap per key: arrows as ← ↑ → ↓, Space, Esc and Page Up instead of browser names in capitals such as ARROWLEFT or SPACE, and Ctrl, Alt, Shift and Win (Super on Linux), with ⌃ ⌥ ⇧ ⌘ on macOS. This applies to the shortcut fields and conflict messages in Settings, the shortcuts help, the player settings menu, the player button tooltips (where a shortcut such as Ctrl++ no longer loses its plus key), the popup, the AutoTheater notice and the video launcher tooltip. Navigation keys show the letter your keyboard layout prints in that position where the browser reports it (Chromium), and the QWERTY letter otherwise. Screen readers hear symbol and abbreviated keys as words in the interface language (for example "Left arrow" for ←). Saved shortcuts are unchanged.
- The keyboard shortcuts help is wider and easier to scan. Shortcuts are grouped into Playback, Audio, Subtitles, Theater, Fullscreen & PiP, Picture and layout, and Navigation, most-used first, in two columns that become one on a narrow window and mirror in right-to-left languages. Opposite actions share a row (seek back / forward, volume down / up, previous / next video), a long combination wraps between keys, never inside one, and an unassigned shortcut reads "Not assigned". A short hint under Navigation explains, with your own keys, how to reach the controls bar, open a menu and leave it, and Customize shortcuts opens Settings at the Keyboard Shortcuts tab.
- The AutoTheater countdown ring now fills to a full circle during the last two seconds, holds, then zooms out just before entry. If the video is still not ready when the countdown ends, the notice waits a moment and then shows an animated ellipsis until it is. With reduced motion the ring switches to full and disappears without animating.
- Settings with several levels (Voice boost, Reduce loud sounds, Bass and Video fit) now have a stepper: arrows lower or raise the value one step at a time without wrapping around, and a row of segments under the value shows how many options there are and which one is active. Lowering Bass no longer means cycling up through every level. The whole row highlights on hover and keyboard focus like the other rows. The highlight slides between segments, the value slides in and a press at the end of the range gives a small nudge, all of it short and switched off by Reduce motion. The cycle shortcuts keep wrapping as before.
- The volume and speed sliders now look and behave alike, with the same marker for 100% and 1x. Scrolling or using the volume keys always stops at 100% before going into boost, and stops there again on the way back down.

### Fixed

- Letter shortcuts now work on Cyrillic, Greek, Hebrew and other non-Latin keyboard layouts: M mutes and Shift+T cycles on the key in that position without switching layout. Shortcuts recorded on such a layout are saved as the Latin letter of that position, so they also work on any other layout. QWERTY, AZERTY, QWERTZ and Dvorak keep going by the letter the key prints.
- Keyboard focus is now visible on the volume and speed sliders, the caption sliders and the time-remaining button, which showed no focus frame before. A focused volume or speed button now shows the same focus frame as the other bar buttons instead of opening its panel around it; the panel opens when you point at it or move into the slider.
- The player settings menu no longer closes when you click Pin controls, or click a row's label or an empty part of the menu after changing another setting.
- The volume and speed sliders no longer stay open after you adjust them with the mouse and move away: they close five seconds after the pointer leaves, unless you are still dragging or reached them with the keyboard.
- On YouTube, AutoTheater now starts when you expand the miniplayer back to the video page, even if the page is slow to show the player.
- Theater and fullscreen no longer end when a video site briefly hides its player while switching videos; they still end when the player stays gone.
- Switch Video on Page (Shift+T or the player settings menu) now fills the window with the next video on pages that list several videos, such as a Telegram channel's post list (t.me/s/…). The next video could appear shifted up and to the left, partly or entirely off-screen, with the page showing around it.
- Theater mode now fills the window on pages that list several posts with videos, such as a Telegram channel's post list (t.me/s/…). The video could instead appear shifted up and to the left, cut off at the top-left corner of the window, with the page showing around it.

## [2.0.7] - 2026-10-26

### Fixed

- Theater mode now fills the window on pages that list several posts with videos, such as a Telegram channel's post list (t.me/s/…). The video could instead appear shifted up and to the left, cut off at the top-left corner of the window, with the page showing around it.

## [2.0.6] - 2026-10-24

### Fixed

- With AutoTheater on, a page opened in a background tab no longer shows its native chat as closed when you switch to it if the site's chat was already open.

## [2.0.5] - 2026-10-23

### Fixed

- In Firefox, seeking with the arrow keys, the progress bar or the live button on Netflix, Disney+ and live YouTube streams now reaches the site's own player. The request was blocked by Firefox's cross-script isolation, so those seeks were dropped and each one logged a "Permission denied" error in the page console. Chromium was not affected.
- In Firefox, the extension's requests to a site's own scripts for site data on supported sites and for switching YouTube's and Twitch's built-in captions were also blocked by Firefox's cross-script isolation and never answered, so YouTube caption tracks waited several seconds to switch. They now go through. Chromium was not affected.

## [2.0.4] - 2026-10-21

### Fixed

- Theater mode now exits when you navigate back or forward to a page without the player on single-page sites, instead of leaving the stage on screen or switching it to another video.

## [2.0.3] - 2026-10-20

### Fixed

- Some websites no longer break when the extension is installed: its page script no longer leaks names into the page's global scope, which could replace or clash with the site's own globals (for example a third-party login page whose analytics call failed with a TypeError). Synthetic key events from page scripts no longer raise errors from the extension either.
- The title bar on Netflix now shows the episode (season marker and episode title) as a styled subtitle after the show title, instead of one run-on title.

## [2.0.2] - 2026-10-19

### Changed

- The Firefox build no longer declares a minimum version for Firefox for Android; Firefox for Android is not supported.

## [2.0.1] - 2026-10-19

### Added

- AutoTheater now works on Twitch past broadcasts (videos); live channels and clips stay manual.

### Changed

- The chat panel now follows whether the site's own chat was visible when you entered theater; your last choice is used only when the site's state cannot be read.
- The Firefox build requires Firefox for Android 142 or newer; the minimum for desktop Firefox is unchanged.
- Translated text and icons are now built without HTML injection, a hardening change with no visible difference.

### Fixed

- On YouTube, theater no longer starts on a hover preview or the miniplayer, and leaves theater when you navigate away from the video instead of leaving the page broken.
- The subtitle overlay now uses the full video width instead of half of it.
- The seek circles now sit on the same horizontal line as the buffering spinner and volume indicator, centred on the picture, when the picture is not centred in the window.
- With an audio effect or Volume Boost enabled, entering theater on a video whose server does not allow audio processing no longer makes the site's player stop with an "unavailable or not supported" error; playback continues and the audio option shows as unavailable.
- Pinned controls no longer let busy page content show through them.
- On Twitch, after the player reloads itself following an error, theater follows the new video and the remaining time keeps updating.

## [2.0.0] - 2026-10-18

### Added

- Adjust volume with the mouse wheel or trackpad over the theater volume controls, including optional boost.
- **Video launcher (BETA):** Enter theater directly from a video; enable it in Settings → Features (off by default). It appears beside videos or in YouTube's native toolbar with Rich Theater Experience enabled, shows your shortcut, and can be dismissed with Escape. It remains available for autoplay after navigation, hiding during user-initiated playback or inactivity except while YouTube controls are available. Tiny videos, muted looping previews, and videos already in theater, fullscreen or picture-in-picture are excluded. Disabling AutoTheater offers to enable it once.
- **Theater playback controls:** Double-click the video to toggle fullscreen without leaving theater; single-click to play or pause with visual feedback. Clicking an open player panel only closes it, and double-clicking controls or menus has no effect. Outside theater, page behavior is unchanged.
- **Accessibility and appearance:** Settings → Appearance offers independent High contrast, Reduce transparency and Reduce motion preferences with Auto / On / Off choices. Auto follows system preferences; changes apply immediately to Settings, the popup and player without changing subtitle styling. Reduce motion disables decorative animation and replaces scrolling titles with text that expands on hover or focus.
- Report translation problems from Settings → Language with a GitHub issue form prefilled with your language and extension version.
- Read the English-only privacy policy in Settings → About, or open its online version.

#### Rich Theater Experience

- **Service settings:** Settings → Features offers individual service switches, capability details and filters, including AutoTheater and Playlists. Playlists covers playlists, queues and episode navigation on YouTube, Vimeo, Netflix, Disney+, Bilibili and Tencent Video / WeTV. All services changes only the displayed services; Clear filter resets filtering. Disabled services remain configurable. The popup switch controls the active tab's supported service and stays synchronized with Settings.
- Bilibili and Tencent Video / WeTV gain titles, subtitles, chapters, timeline previews and native previous/next navigation where available, including Tencent's WebAssembly player.
- Bilibili.tv episode and upload pages gain titles, subtitles, timeline previews, Intro/Outro markers and next-episode navigation.
- Crunchyroll gains episode titles, intro/credits chapters, timeline previews and subtitle selection; burned-in subtitles have no misleading Off option.
- Netflix gains trailer/preview support, plus episode titles, native subtitle selection and timeline previews on watch pages, preserving existing RTE preferences.
- Skip intro, credits, recap and up-next actions appear over supported Netflix, Disney+, Crunchyroll and Bilibili videos, alongside YouTube's native ad-skip action, following host availability and countdowns.
- **AutoTheater:** Automatic entry now supports Bilibili `/video/BV…` pages and separate parts, Bilibili.tv videos/episodes, Netflix, Disney+ and Patreon posts with one native video in either player variant. Mini players, in-stream ads, Bilibili ad playlists, and Patreon multi-video posts, live streams and embeds stay manual. A playback notification counts down for at least five seconds; click it or press Esc to cancel for that video. YouTube starts counting down on navigation; brief interruptions do not reset it, while longer pauses, ads or errors cancel it. Settings → Features → Rich Theater Experience → Skip countdown enters as soon as playback is ready. Unsupported pages show AutoTheater as Unavailable in Player settings.

#### Chat, layout and player controls

- Search longer subtitle lists by track name or language, ignoring accents, with keyboard selection; Escape clears search before closing.
- **Native chat:** Keep Twitch and YouTube chat beside the picture or below it in narrow windows. Toggle it from the toolbar or Alt+R, including while YouTube chat has focus; collapsed YouTube chat reopens natively. Player settings remembers width and Light / Service settings / Dark themes per service. Unsupported replays show no chat controls. [Usage and availability](docs/research/native-chat-validation.md).
- Choose Centered or Raised picture layout in Settings → Appearance, Player settings or with configurable Shift+L. Raised is the default, placing widescreen video above captions when space allows; Raised only with subtitles is on by default. Turn it off to raise the picture without subtitles. Fill and Stretch stay centered; returning to Fit restores Raised.
- Raised captions use the space below the picture; both layouts use the subtitle background opacity you choose.
- Pin playback controls and the progress bar in Player settings, Settings → Appearance or with configurable Shift+H; the choice persists across videos and tabs while the title and cursor still hide when idle. Thanks to [@liango2](https://github.com/liango2) for suggesting this in [#3](https://github.com/TomaszJanusz/Theater-Mode-Everywhere/issues/3).
- Previous/next controls support YouTube playlists and queues, PeerTube / video.js, Dailymotion, Vimeo Showcase and RTE episode navigation, appearing only when usable and previewing targets where available.
- Player controls show the video title and a home button, including titles from supported sites and same-origin embeds; the configured fullscreen shortcut enters theater with its controls and overrides host shortcuts, while F can open fullscreen without theater.
- Click the trailing time readout to switch between remaining time and total duration.
- Choose any bundled interface language or Automatic (browser language) in Settings → Appearance; open Settings, popup and player controls update immediately.
- Screen-reader labels, states and announcements, keyboard seeking, and focus handling for player and Settings popovers/dialogs.
- **Settings overhaul:** Appearance, Features, Website Exclusions, Keyboard Shortcuts and About tabs replace the long page, with linkable sections such as `options.html#shortcuts`. About includes the author's note, installed version and MIT license. Shortcut conflicts let you keep an assignment or move it, leaving the previous action unassigned; existing duplicates are highlighted and edits across Settings tabs are preserved.
- **Audio effects:** Player settings → Audio offers Volume boost, Voice boost (light/strong dialogue enhancement), Reduce loud sounds and Bass (Less, Original, More, MOAAR, MOAAARR!), with shortcuts V, R, B and Shift+B. Active effects are highlighted; audio is processed only while an effect is on. DRM-protected media and servers refusing cross-origin access are unsupported, with the reason shown in the menu.
- Display installed SponsorBlock markers and notices on YouTube; toggle support in Settings → Features.

### Changed

- Centred playback, volume and status confirmations stay visible two seconds longer; Play/Pause notices no longer animate their text, and theater entry notices have a solid appearance.
- Chromium extension names include the translated tagline; Firefox keeps the plain name.
- Store descriptions, summaries and keywords are translated and updated for 2.0.
- Settings and player dialogs share accessible keyboard behavior, High contrast and right-to-left support; subtitle options returns focus to CC.
- The privacy policy explains browser settings sync and direct video-service requests.
- Refreshed Settings/footer, standalone popup/Settings logo, accent-colored scrollbars, layout previews and Privacy Thing promo.
- Update highlights presents the English 2.0 announcement with localized controls and acknowledgements; new-feature badges expire after 30 days or opening Update highlights, not merely viewing Settings. Settings → Appearance → Highlight new features toggles badges; Hide until next version / Restore badges controls reminders without marking features seen. Fresh installs start acknowledged; development builds remember acknowledgements and highlight new additions after rebuilds.
- Improved translations, control labels and theater terminology, including the About tagline.
- Player settings opens on hover and groups fit, player switching, controls visibility, audio and keyboard help; playback, captions, speed, PiP, fullscreen and exit stay directly accessible.
- Keyboard help adapts to narrow windows; Help and Settings regroup shortcuts into Theater, Fullscreen & PiP, Playback & Volume Controls (including frame stepping), and Player Controls.
- Settings uses grouped panels, with accessibility and Pin controls together in Appearance.
- Subtitle menus open at the active track and preserve subsequent scrolling; long menu labels have full-name tooltips.
- Subtitle loading uses a CC indicator and delayed notice; completion shows the language, and Reduce motion removes loading transitions.
- Disney+ titles include episode labels, and captions remain clear of playback controls.
- Reduced background CPU and memory use.

### Fixed

- Loading indicators clear after unrecoverable video resets and stay hidden when the reset video is paused.
- Videos without subtitles no longer show an empty subtitle-menu rectangle.
- Theater exits when an embedded player frame reloads or navigates.
- Embedded-player fullscreen exits consistently via F, double-click or button, regardless of which frame has focus.
- Escape exits theater even when the page intercepts the key.
- YouTube AutoTheater resumes after player readiness, leaving focused fields/fullscreen or expanding the miniplayer.
- Clicking the picture or controls restores play/pause feedback; closing a menu by clicking the picture does not pause.
- Disney+ next episodes keep the picture visible and support seeking across the full timeline.
- Seeking by progress bar or keyboard shows loading until the requested position is ready.
- Playback and volume feedback remain centered on the picture, including in Raised layout.
- YouTube captions retain the selected track.
- Cancelling Volume Boost during loading restores host playback.
- Navigation and theater-exit races no longer disrupt the player.

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
