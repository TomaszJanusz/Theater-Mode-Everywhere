# Player service actions

`src/providers/service-actions.ts` composes contextual actions for Netflix,
YouTube, Bilibili.com and Bilibili.tv. The shared player CTA consumes only
`ServiceActionSource`; providers own availability, identity and activation.
The source is bound to the current theater playback surface and checks the
provider's Rich Theater Experience flag on every read and activation.

## YouTube

While the player has `ad-showing`, the source forwards one available native
`.ytp-skip-ad-button`, `.ytp-ad-skip-button` or `.ytp-ad-skip-button-modern`.
Labels come from the native text or accessibility label. Countdown messages,
ordinary Next buttons and non-skippable ads do not produce an action.
`aria-hidden="true"` on the button or its container means the skip is not yet
available, even though YouTube keeps it in the DOM with only opacity changed.

This supports watch and embedded players, including youtube-nocookie.com.
It clicks the native skip control; it does not seek over ads or remove them.
The watch video, playlist and index identify the route; tracking parameters
leave the same action intact.

Selectors and `aria-hidden` behavior were checked against YouTube's current
[www-player.css](https://www.youtube.com/s/player/1b3be681/www-player.css)
on 7 October 2026. Asset hashes can change.

## Bilibili.com

The source forwards confirmations inside live native toast rows:
`.bpx-player-toast-row.bpx-player-toast-unfold .bpx-player-toast-confirm`.
These include the host's skip, cancel-skip and resume actions. The action uses
exactly the native label and click handler, so native confirmation toasts for
other player features can appear too. Notifications without confirmations,
close icons, closing rows and persistent toolbar navigation are excluded.
Changing the native label invalidates an old action. The route includes `p`
so switching video parts also invalidates it.

On the live player, theater entry makes Bilibili set `display:none` on
`.bpx-player-toast-wrap` even while its unfolded confirmations remain active.
Provider presentation keeps that wrapper `display:block` with visibility,
opacity and pointer events suppressed. Rows and buttons still undergo their
normal hidden/disabled/lifecycle checks, and the override ends on theater exit.

The toast markup and click handlers were checked against the official
[player widget](https://s1.hdslb.com/bfs/static/player/main/widgets/npd.911.a6141530.js)
and [bangumi helper](https://s1.hdslb.com/bfs/static/player/main/widgets/npd.bangumi-helper.0a32a4c2.js).
The bangumi helper offers both “do not skip” and “still skip”; the extension
preserves that distinction instead of guessing the action from the toast body.

## Bilibili.tv

The existing metadata adapter imports opening/ending windows from
`ogv/play/episode`. Its high-confidence `Intro` and `Outro` windows become
localized skip actions only while the playback time is inside `[start, end)`.
Activating seeks to the window's end through the player's existing seek path
and preserves playback intent. No extra metadata requests or timer are added.

The controller selects Bilibili.tv's skip windows independently of the preferred
timeline chapters, so native chapter tracks cannot mask the episode actions.
The adapter reuses its loaded metadata. The controller exposes this chapter context only for the currently loaded media,
when it is not refreshing. The provider checks `ogv:<episode>`, the published
DOM episode/kind and the route together. Uploads, route/id disagreement,
invalid or out-of-duration windows, unready media and in-flight seeks produce
no skip action. The same one-second duration rounding tolerance as the parser
applies; an accepted end beyond the media duration is clamped to the duration,
and the action expires at that clamped boundary. A native next-episode action appears during the final five
seconds or after the video ends, provided the native control is available.
The rest of the time, Next remains in the toolbar. The five-second announcement
and next control were checked against the official
[international player](https://p.bstarstatic.com/fe-static/bstar-web-new/client/assets/biliintl-player-dfb25af7.js).

## Stale controls and validation

Native action identity includes route, root, button, video, current media URL,
source attribute and label. Timed actions also include episode and interval.
Activation rereads availability before clicking/seeking. Disconnected,
disabled, inert, hidden, `aria-hidden` and `display:none` controls are rejected;
visibility, opacity and pointer suppression applied by theater CSS preserve
native controls' usability.

`src/providers/service-actions.browser.test.ts` covers provider composition,
ad availability, legacy/current/embedded selectors, route/button/root/video/
source replacement, toast lifecycle, skip-window boundaries, episode mismatch,
provider flags and CTA disposal. The installed Chromium extension fixture in
`src/providers/bilibili-intl/runtime.browser.test.ts` exercises the imported
intro window through the actual content-world CTA and checks pause preservation.
Live page checks and before/after captures are recorded in
[service-actions-live.md](service-actions-live.md). The live Bilibili.com check
uses its native “do not skip” confirmation; a logged-in first-watch “still skip”
confirmation remains covered by the fixture rather than a live session.

## Screenshots

Live screenshots are linked from [the live verification report](service-actions-live.md).
The captures below are the original deterministic fixtures.

Captured from the installed Chromium extension with deterministic page/player
fixtures and a synthetic video. These show the actual extension UI, not live
advertising or logged-in Bilibili playback.

- [YouTube: native ad skip](screenshots/service-actions/youtube.png)
- [Bilibili.com: native skip confirmation](screenshots/service-actions/bilibili.png)
- [Bilibili.tv: intro skip](screenshots/service-actions/bilibili-tv.png)
- [Bilibili.tv: outro and next episode](screenshots/service-actions/bilibili-tv-outro.png)
