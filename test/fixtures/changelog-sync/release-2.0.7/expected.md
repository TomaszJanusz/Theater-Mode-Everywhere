# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Czech and Slovak translations for settings, the extension popup, player controls and store
- British English wording in the extension and store listings.
- On YouTube, theater now works on the miniplayer: with a video playing in the corner of Home,
- Navigate the player bar from the keyboard: W opens the controls bar and focuses the settings

### Changed

- The Korean store listing now highlights Crunchyroll alongside YouTube, Netflix and Disney+.
- Keyboard shortcuts now show the names printed on the keys, one key cap per key: arrows as ←
- The keyboard shortcuts help is wider and easier to scan. Shortcuts are grouped into Playback,
- The AutoTheater countdown ring now fills to a full circle during the last two seconds, holds,
- Settings with several levels (Voice boost, Reduce loud sounds, Bass and Video fit) now have
- The volume and speed sliders now look and behave alike, with the same marker for 100% and 1x.

### Fixed

- Letter shortcuts now work on Cyrillic, Greek, Hebrew and other non-Latin keyboard layouts:
- Keyboard focus is now visible on the volume and speed sliders, the caption sliders and the
- The player settings menu no longer closes when you click Pin controls, or click a row's label
- The volume and speed sliders no longer stay open after you adjust them with the mouse and move
- On YouTube, AutoTheater now starts when you expand the miniplayer back to the video page, even
- Theater and fullscreen no longer end when a video site briefly hides its player while switching
- Switch Video on Page (Shift+T or the player settings menu) now fills the window with the next

## [2.0.7] - 2026-10-26

### Fixed

- Theater mode now fills the window on pages that list several posts with videos, such as a Telegram

## [2.0.6] - 2026-10-24

### Fixed

- With AutoTheater on, a page opened in a background tab no longer shows its native chat as closed

## [2.0.5] - 2026-10-23

### Fixed

- In Firefox, seeking with the arrow keys, the progress bar or the live button on Netflix, Disney+
- In Firefox, the extension's requests to a site's own scripts for site data on supported sites

## [2.0.4] - 2026-10-21

### Fixed

- Theater mode now exits when you navigate back or forward to a page without the player on single-page

## [2.0.3] - 2026-10-20

### Fixed

- Some websites no longer break when the extension is installed: its page script no longer leaks
- The title bar on Netflix now shows the episode (season marker and episode title) as a styled

## [2.0.2] - 2026-10-19

### Changed

- The Firefox build no longer declares a minimum version for Firefox for Android; Firefox for
