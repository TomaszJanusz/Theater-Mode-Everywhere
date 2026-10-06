# Netflix watch player

Verified with an installed Chrome build in Brave Browser Beta, signed in on `/watch/70248290` (House of Cards, Rozdział 2), on 7 October 2026. The browser ran in the background with audio muted. Public trailer behavior remains a separate fallback.

## Integration

MAIN selects the player session whose movie id matches the watch route and whose connected element belongs to `.watch-video [data-uia="player"]`. Background/seamless sessions are excluded. A route change immediately invalidates isolated-world metadata. Initialization supports `document_start`, before `<html>` exists.

- Title comes from the current video's metadata: `House of Cards · Rozdział 2`.
- The native timed-text list exposes 39 languages plus Off. Polish selection and Off were exercised through the installed RTE menu. Polish dialogue was visibly painted in Theater Mode.
- The watch player and video canvas retain viewport dimensions after the video is pinned out of normal flow. Without this, Netflix measured a zero-height caption canvas and stopped drawing subtitles. Host captions use RTE appearance and docking variables.
- Timeline seeking uses the native session clock (milliseconds) and restores play/pause intent. Caption changes are bound to the requested video id.
- Timeline previews use the native `getTrickPlayFrame` JPEG, not a fetched manifest or storyboard URL. The string bridge bounds dimensions, payload size, movie id and requested time; the isolated adapter keeps at most 24 frames.
- The measured `getChapters()` list was empty. No chapter data is invented.

## Service actions

The generic player CTA source exposes one live `{ id, label }` and activation by that id. The glass button appears at the bottom right, above the playback bar when visible, with 14px text and the existing home-pill treatment. Native localized text supplies the label. Mouse clicks and native Enter/Space activation are supported; disposal removes the poll, subscription and node.

Netflix controls are queried within the current watch root. Skip intro takes priority over recap, credits and next/postplay controls. Disabled, disconnected, hidden and `display:none` controls are rejected. Stage-induced `visibility:hidden`, opacity and pointer suppression preserve the host action. Route/root-id disagreement, a replaced button or a stale action id rejects activation.

Netflix unmounts its chrome on idle. For intro only, MAIN preserves an observed native label and reads the current session's `skip_credits` time code (`startOffsetMs` / `endOffsetMs`). The CTA survives native chrome removal only while the playback clock is inside that window. Activation revalidates the session, id and interval, then seeks to its end while preserving playback intent. The snapshot expires after four seconds if updates stop. Outside the interval the action disappears; an expired click cannot skip a later scene.

Live Brave verification confirmed `Pomiń czołówkę` after the native control had unmounted and the RTE bar had hidden. Clicking it moved playback from about 108s to about 152s and kept playback running. The observed intro interval was 60.853–151.402s. Clicking `Następny odcinek` changed the watch route and snapshot to `70248291` while Theater Mode stayed active. A real mouse hover displayed the native JPEG timeline preview at 05:54. Other listed selector variants have browser-fixture coverage and need live validation when Netflix presents them.

## Regression coverage

The browser tests cover early MAIN startup, attached-session selection, title/captions, stale movie requests, seek units and intent, previews, episode invalidation, caption canvas geometry, time-limited intro actions after native unmount, action replacement/disable/removal, click relay, keyboard activation, and teardown. The public-player tests remain in place.

No subtitle file, playback manifest or license is downloaded by this integration. Netflix remains outside the extension's media-fetch allowlist.
