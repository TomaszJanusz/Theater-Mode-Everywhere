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

The generic player CTA source exposes an array of live `{ id, label, progress? }` actions and activation by id. Glass buttons appear at the bottom right, above the playback bar when visible, with 14px text and the existing home-pill treatment. Open player menus hide the stack and remain above it in the stacking order. Stable button nodes preserve focus across polls. Native localized text supplies labels. Mouse clicks and native Enter/Space activation are supported; disposal removes polling, animation frames, subscriptions and nodes.

Netflix controls are queried within the current watch root. Contextual skip, credits and next/postplay controls can coexist; the persistent toolbar's `control-next` is navigation and is excluded from CTAs. Disabled, disconnected, hidden and `display:none` controls are rejected. Stage-induced `visibility:hidden`, opacity and pointer suppression preserve the host action. Route/root-id disagreement, a replaced button or a stale action id rejects activation. The source follows provider enablement changes during the current theater session.

The toolbar's next-episode control is registered through `providers/navigation/netflix.ts` and the existing generic playlist navigation contract. No previous control or next movie id is invented. Contextual CTA types live in `core/service-actions.ts`; native caption geometry and observation live in the Netflix provider, while the shared toolbar consumes `HostCaptionLayout`. Host clocks, discovery, stage policies and CSS are composed through provider factories. See [player/provider contracts](player-provider-contracts.md) for the shared interfaces and extension points.

Netflix unmounts its chrome on idle. For intro only, MAIN preserves an observed native label and reads the current session's `skip_credits` time code (`startOffsetMs` / `endOffsetMs`). The CTA survives native chrome removal only while the playback clock is inside that window. Activation revalidates the session, id and interval, then seeks to its end while preserving playback intent. The snapshot expires after four seconds if updates stop. Outside the interval the action disappears; an expired click cannot skip a later scene.

Live Brave verification confirmed `Pomiń czołówkę` after the native control had unmounted and the RTE bar had hidden. Clicking it moved playback from about 108s to about 152s and kept playback running. The observed intro interval was 60.853–151.402s. A real mouse hover displayed the native JPEG timeline preview at 05:54.

On `/watch/70248292`, ending offset 2,767,098ms, Netflix presents `watch-credits-seamless-button` and `next-episode-seamless-button-draining` together. Both were rendered and the latter's `.inner` uses a five-second linear transform transition. RTE samples the native animation's actual progress on animation frames, with a computed-transform fallback. It does not start an independent countdown or activate autoplay. Live samples matched the native progress; opening and closing Settings hid/restored the stack without resetting the animation. Netflix advanced once to `70248293` about 5.3 seconds after the first observed button. Recap and other postplay selector variants retain fixture coverage.

## Caption docking and fullscreen follow-up

Native captions dock using painted direct-child cue spans rather than their empty 80vw host. Cue replacement updates docking before paint, retaining the last measurement through empty cue gaps; rewritten native inline styles cannot reintroduce a bottom transition at rest. Raised captions use the same black background and configured opacity as the YouTube overlay. In live Polish dialogue at 210–220s, successive two-row cues and their intervening gaps kept a 34px dock offset after the toolbar hid; no contextual CTA appeared during regular dialogue.

Fullscreen investigation must distinguish the DOM API from the browser window. The issue was reproduced with CDP focus emulation enabled: a trusted RTE click entered DOM fullscreen on HTML, but Brave's window remained `maximized` and the viewport stayed 1334×911. With focus emulation disabled, the same click set the browser window to `fullscreen` and the viewport to 1512×949; the second click exited. A false/true/false comparison reproduced this reliably. Focus emulation from background testing was cleared; future probes must explicitly disable it in cleanup before detaching. A duplicate-click hypothesis was rejected after the installed extension issued exactly one activated HTML request. No fullscreen handler change was needed.

## Regression coverage

The browser tests cover early MAIN startup, attached-session selection, title/captions, stale movie requests, seek units and intent, previews, episode invalidation, caption canvas geometry and replacement before paint, time-limited intro actions after native unmount, simultaneous end actions, native countdown progress through menu changes, action replacement/disable/removal, click relay, keyboard activation, and teardown. The public-player tests remain in place.

No subtitle file, playback manifest or license is downloaded by this integration. Netflix remains outside the extension's media-fetch allowlist.
