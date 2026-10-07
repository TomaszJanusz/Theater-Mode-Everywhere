# Live player CTA verification

Checked on 7 October 2026 using the installed Chromium extension and fresh,
signed-out browser profiles. Pages, player metadata, advertisements and video
streams came directly from the services. No request interception or substitute
player markup was used. Playback was paused and positioned inside episode
windows to make the controls observable; YouTube ads ran at their normal speed.

YouTube and Bilibili.tv were checked with build `ba05dd7`. Bilibili.com exposed
a toast-wrapper layout problem, then was rechecked with the CSS correction in
this PR loaded into a newly launched browser. The correction is scoped to
Bilibili player toast wrappers while theater mode is active.

| Service and action | Observed result |
| --- | --- |
| [YouTube: Skip](https://www.youtube.com/watch?v=plN7JMbadRg) | A real TUI advertisement had time 5.610843 s, duration 15.021 s and `ad-showing`. The extension CTA clicked the native `.ytp-skip-ad-button`. Afterwards `ad-showing` was absent, the video duration was 3478.681 s, content time was 0 s, playback was running, and the CTA disappeared. |
| [Bilibili.com: 不跳过 / Do not skip](https://www.bilibili.com/bangumi/play/ep689147) | After the host had auto-skipped the opening, playback was paused and rewound to 0 s. The native unfolded “即将跳过片头 / 不跳过” toast appeared. Clicking the extension CTA dismissed the native toast and CTA. Playback was resumed briefly, remained in the opening at 2.055257 s, and was paused again. |
| [Bilibili.tv: Skip intro](https://www.bilibili.tv/en/play/1053337/11371243) | Clicking at paused time 100 s moved playback to 227 s, retained pause, and removed the CTA. |
| Bilibili.tv: Skip outro | Clicking at paused time 1450 s moved playback to 1504 s (the media end), retained pause, and removed the outro CTA. |
| Bilibili.tv: Next | At the end of E1 the extension's native Next CTA changed the route to `/en/play/1053337/11371316?bstar_from=bstar-web.pgc-video-detail.episode.manual` (E2). This checks navigation, not premium playback of E2. |

Short YouTube advertisements also ran before the successful skip. The CTA
stayed absent while the native skip was unavailable. A 15-second duration by
itself does not establish that an ad is unskippable: the successful advertisement
offered Skip after its countdown.

## Bilibili.com regression found on the live page

The original fixture omitted `.bpx-player-toast-wrap`. On the real page,
Bilibili sets its inline display to `none` after the theater layout change.
The provider correctly rejected hidden ancestors, but that also rejected the
live native confirmations in this wrapper. The fix retains the wrapper's
layout box while suppressing its rendering. The regression test uses the real
wrapper/row/item structure and the provider stylesheet, checks activation,
and still rejects hidden controls, closed rows and a disabled integration.

## Before and after screenshots

These captures show real service pages with the installed extension.

| Action | Before | After |
| --- | --- | --- |
| YouTube ad skip | [Ad and Skip CTA](screenshots/service-actions/live/youtube-skip-before.png) | [Content resumed](screenshots/service-actions/live/youtube-skip-after.png) |
| Bilibili.com native confirmation | [不跳过 CTA](screenshots/service-actions/live/bilibili-native-confirm-before.png) | [Native toast dismissed](screenshots/service-actions/live/bilibili-native-confirm-after.png) |
| Bilibili.tv intro | [100 s and Skip intro](screenshots/service-actions/live/bilibili-tv-intro-before.png) | [227 s, still paused](screenshots/service-actions/live/bilibili-tv-intro-after.png) |
| Bilibili.tv outro | [1450 s and Skip outro](screenshots/service-actions/live/bilibili-tv-outro-before.png) | [1504 s, still paused](screenshots/service-actions/live/bilibili-tv-outro-after.png) |

These are smoke checks of the observed desktop player variants, not a live
matrix of all accounts, advertisements, embeds or locales. Bilibili.com's
logged-in first-watch “still skip” branch and YouTube's older/embedded selectors
are covered by deterministic browser fixtures. The original synthetic captures
remain documented separately in [service-actions.md](service-actions.md).
