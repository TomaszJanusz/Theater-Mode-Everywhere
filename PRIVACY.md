# Privacy Policy — Theater Mode Everywhere

**Last updated: 2026-10-16**

Theater Mode Everywhere is developed by Tomasz Janusz. The extension sends no information about you or what you watch to the developer or any unrelated third party. It has no analytics, telemetry or extension account, and does not set cookies or download and run remote code. Direct requests to the video service and browser settings sync are explained below.

## What the extension accesses

To enlarge players and provide playback controls, the extension reads video elements, subtitle and audio tracks and player information on the pages you open, including embedded frames. Optional Rich Theater Experience integrations use titles, chapters, subtitles, timeline previews and other playback information from YouTube, Vimeo, Patreon, Twitch, Disney+, Netflix, Bilibili, Bilibili.tv, Tencent Video / WeTV, Crunchyroll, iQIYI, SOOP and Rakuten Viki. This information is processed in memory, not saved as a viewing history or uploaded elsewhere.

Tab addresses are read to apply website exclusions and show per-site status in the popup and toolbar icon. The extension does not record a list of pages you visit, video titles or viewing timestamps. SponsorBlock markers are read from the installed SponsorBlock extension's page elements; Theater Mode Everywhere does not call the SponsorBlock API.

## Requests to video services

For subtitles, timeline thumbnails, chapters, skip markers and related player metadata, the extension may request files directly from the service you are watching or its content-delivery network. These include YouTube timedtext and storyboard images; Vimeo thumbnail images; Patreon/Mux storyboards and captions; Twitch storyboard files, images and captions; Disney+ subtitle playlists, segments and BIF thumbnails; Bilibili player/subtitle metadata, replay data, captions and preview images; Bilibili.tv episode/subtitle metadata and preview files; Tencent Video / WeTV captions and previews; Crunchyroll skip-marker metadata and previews; SOOP's chapter list for a recording; and Rakuten Viki subtitle files and timeline preview lists named by the episode data the page itself loads. iQIYI uses its native player for subtitles and reads only the page's own play-info for intro/outro windows, without extension downloads. Netflix uses its native player for subtitles and existing player data for previews, without extension caption downloads. A generic player can also use subtitle files referenced by its own track elements.

Requests go from your browser to that service, under its privacy policy. The service receives the requested resource address and normal connection information, such as your IP address. Some requests, including YouTube captions and Bilibili metadata, use your existing login cookies for that service, as the page itself would. The extension does not read or store those cookies. The background fetch helper restricts requests to allowed service hosts and media paths and omits cookies. Responses are used for playback features and are not forwarded to the developer or unrelated parties. The browser may cache downloaded resources normally.

You can disable individual Rich Theater Experience integrations in Settings → Features. Generic theater mode and the page's own playback still work.

## Stored settings

The extension saves preferences with the browser's extension storage:

- Keyboard shortcuts and excluded website host names you add.
- Subtitle appearance and per-site subtitle preferences: on/off, language or track label, and whether the track is automatically generated. These preferences are keyed by site host name.
- Per-site audio language: the language or "original" of the audio track you last chose on that site, keyed by site host name the same way.
- Audio enhancement and volume-boost choices; video fit, picture alignment, subtitle-dependent layout, automatic theater entry and control visibility.
- Native chat visibility, width and theme by service; Rich Theater Experience and SponsorBlock-marker switches.
- Interface language, accent color and accessibility choices (contrast, transparency and motion).

These use `storage.sync`. If browser sync is enabled, settings — including excluded host names and per-site subtitle and audio language preferences — can sync through your Google, Mozilla or Microsoft browser account. They are not accessible to the developer. They are settings, not a browsing-history log.

`storage.local` holds the version of an update whose highlights you have not opened yet, plus a one-time settings-migration flag. The extension persistently stores only settings and these housekeeping flags, not captions, images, page content or playback history. You can change settings in the extension and remove its stored data through your browser's extension-data controls; browser sync is controlled by your browser.

## Permissions

- **storage:** save the settings and flags described above.
- **tabs:** read tab addresses for website exclusions, popup status and background toolbar-icon updates.
- **Access to all websites (`<all_urls>`):** detect and enhance video players on arbitrary sites and in frames, with content scripts in the page and extension worlds; request the service resources described above.
- **theme (Firefox only):** read browser theme colors so the extension interface can match them.

## Limited Use and project website

The extension complies with the Chrome Web Store User Data Policy, including its Limited Use requirements. It uses information only to provide the described playback features and settings. It does not sell data, use it for advertising or credit decisions, or send it to the developer for people to read.

The project website, theater.tomaszjanusz.dev, has no analytics and sets no cookies. Links you choose to open (such as GitHub or extension stores) are subject to those sites' privacy policies.

## Source and contact

The extension is [open source on GitHub](https://github.com/TomaszJanusz/Theater-Mode-Everywhere).
For privacy questions, contact **oss@tomaszjanusz.dev**.
