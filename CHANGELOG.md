# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
