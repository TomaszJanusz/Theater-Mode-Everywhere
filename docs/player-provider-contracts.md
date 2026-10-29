# Player and provider boundaries

The enforced import rules live in [dependency-cruiser](../config/dependency-cruiser.cjs).

The player owns the interface and the behavior of its features. Providers translate host services into those features: read host data, observe changes, validate identity and availability, and execute host interactions. Adding a service must not add its selectors or timing rules to a player component.

## Contextual actions

`core/service-actions.ts` defines `ServiceActionSource`: `read()` supplies current actions with an opaque ID, a label, and optional progress in `[0, 1]`; `activate(id)` revalidates the action before executing it. Optional `subscribe(onChange)` reports availability or structural changes, and `readProgress(id)` reads only the cached action's native progress (`null` invalidates its identity, `undefined` means no progress). Subscribed sources own their observers and visible-document fallback, and return idempotent cleanup; the UI supplies the fallback only for legacy sources without a subscription. Discovery is coalesced after relevant mutations/events, with a fallback no faster than 1 Hz in visible documents; hidden documents stop it. A provider that knows when mutations cannot reveal a change may pass `needsFallback` to `observeProviderDom` and have the timer armed only then: YouTube's skip-ad source needs it only while the player has `ad-showing`. The CTA animation reads only progress for visible, current actions and stops while menus or the document hide it. The shared component in `ui/service-actions.ts` renders multiple actions, handles focus and activation, clears open menus, and follows the player chrome's placement lifecycle.

The provider owns action availability, expiry, stale-click rejection, and any countdown. The player displays the supplied progress and never starts or restarts the host timer. Netflix's intro and postplay actions implement this contract in `providers/netflix/service-actions.ts`. Another service implements the same source and supplies it as `ProviderHooks.serviceActions` (SOOP: `providers/soop/service-actions.ts`) without changing the CTA component; Netflix's wiring in `providers/service-actions.ts` is legacy.

Persistent previous/next controls belong to playlist navigation, not contextual actions. Netflix's toolbar next-episode control uses the same `PlaylistAction` / `PlaylistNavState` contract and player controls as YouTube playlist navigation. Host selectors and preview rules live in `providers/navigation/`; `playlist-nav.ts` owns the shared state and preview validation. One `PlaylistNavState` snapshot supplies both buttons, labels, previews and the existing iframe availability message. Provider-selected DOM surfaces (including open shadow roots) trigger coalesced refreshes; the active session keeps a visible-document fallback at most once per second for model-only changes. Activation still reads and revalidates the live target. The existing iframe navigation protocol is unchanged.

## Captions

Shared caption rendering and dock calculations stay in `media-features/` and `ui/toolbar.ts`. Native caption providers expose `HostCaptionLayout` geometry and an optional motion target through the composite adapter. Their observers own host mutations, cached measurements, and cleanup. The controller connects and disconnects subscriptions when rebinding or disposing; callbacks from an old adapter cannot affect the current player.

`MediaFeaturesController.runCaptionOperation` owns the complete caption request lifecycle. Menu selection, keyboard toggling, saved-language restoration, retries and cue-window downloads all pass through it. It publishes the loading HUD and CC busy state before calling the provider, applies the result once, and reports success or failure. Cue-window success dismisses the spinner without repeating the “Subtitles on” notification. Invalidation, media changes, adapter replacement and disposal dismiss pending loading UI and reject stale results and queued selections. Callers cannot opt out of loading feedback.

The HUD waits 400 ms before rendering the loading message, so quick downloads do not flash a spinner. A result or dismissal cancels the pending message; delayed rendering also checks the player session epoch and element. The CC busy state still updates immediately.

Providers that load captions in windows implement `prepareCaptionCueRefresh(id, time)`. It must synchronously return `null` when no download is needed, or return a lazy request that does no work until the controller calls it. The composite delegates to the adapter that activated the current track, so polling never rediscovers tracks or initiates an invisible download. Providers keep their network fallback, parsing and cache policies inside that request. Track discovery and timeline metadata do not activate a caption track and do not show caption loading UI.

Netflix native cue measurement lives in `providers/netflix/host-captions.ts`, and Crunchyroll native caption measurement lives in `providers/crunchyroll/host-surface.ts`. Native presentation remains available when a provider's data integration is disabled; the integration flag still controls its data adapter and host interactions.

## Audio tracks

Adapters that can list and switch audio implement `listAudioTracks()`, `selectAudioTrack(id, mediaId)` and `observeAudioTracks(onChange)` from `media-features/types.ts`. A list names the media item it describes (`mediaId`) and reports `blocked` while the host plays something else in the same player, such as an ad; each track carries an opaque `id`, a BCP-47 `languageTag` (empty when the host gives none), the host `label`, a `kind` (`original`, `dub`, `description`, `commentary`, `unknown`) and `selected`. Listing has no side effects and is cheap enough for every notification. Selection revalidates the item, the track and the blocking state against the live host before acting, and resolves to whether the host accepted it. The composite prefers a service adapter's tracks over the element's own and routes selection to the adapter that listed them.

`media-features/audio-tracks.ts` owns the list for the current adapter epoch. An item is evaluated once, when it first lists two or more tracks outside a block: the saved preference is applied at most once, a viewer's choice ends evaluation for that item, and later host changes (including the host restoring its own remembered choice) are left alone. Results for an earlier item, adapter or binding are dropped. The preference is per service, stored like the subtitle preference (`audioPreferenceByHost`, keyed by `captionPreferenceHost`, see `media-features/audio-preference.ts`): `original` or a language tag, saved when the viewer picks a track and removed by the Default button. Automatic selection never chooses description or commentary tracks. After a viewer's pick, or the saved preference (also when it was already playing), the controller reports through `onResult` the track now playing and, for a refused pick, the track asked for; nothing is reported for a result that went stale, or when no preference matches. The UI shows these, and the track kept by the Default button, as the audio rows of the language notice (`ui/language-hud.ts`), which never replace the subtitles row.

The UI shows the Audio track row and its list only with two or more tracks and reads nothing but this contract. The generic adapter reads `HTMLMediaElement.audioTracks` where the browser exposes it; YouTube reads its watch, miniplayer and embed player through the MAIN-world bridge in `media-features/youtube-audio-tracks.ts`. Rakuten Viki lists the tracks from its own Video.js audio menu (`.vmp-audio-tracks-menu li`, present in the DOM while the menu is closed) and selects by clicking the host's row, so the player, the ad state and the track are revalidated first and the pick counts only once the host moves its check mark. The rows carry a label in the viewer's interface language and no tag, so the tag comes from the episode's `audio_languages` and the original from its recorded language; rows that cannot be matched stay untagged. Viki lists the viewer's current choice first, so a row's id is its label, not its position. Providers without any of these declare the `audio` capability `no`.

## Titles

Adapters supply `getTitle()` and optional `observeTitle(onChange)`; `MediaFeaturesController` publishes the title chip for the current epoch and adapter, and drops notifications from a replaced adapter. A service adapter's title outranks the native adapter's. Without a service integration, the native adapter also falls back to page metadata: selection lives in `media-features/page-title.ts`, DOM reading and observation in `providers/native/page-title.ts`. A VideoObject must match the playing media, and a heading must be tied to it. A client-side navigation can change the URL before `<title>`, meta tags or the heading, so page values left over from the previous URL are rejected; scoped observers on those elements report the replacement during theater mode only.

## Playback and presentation

`playback-surface.ts` defines the player's playback surface and capabilities. `playback-window.ts` handles shared timeline geometry, seek clamping, and pending-seek state. Host clocks and seek dispatch policies live in `providers/timeline/`. Controls consume the generic clock reader and observer rather than reading service-specific datasets or events.

`providers/playback-session.ts` selects theater targets and opens provider-owned playback sessions. A session supplies a `PlaybackSurface`, a pointer-catcher capability, a replacement notification and idempotent disposal. Tencent owns WASM discovery, bridge setup and replacement observation; shared UI handles controls and viewport restoration when it receives a replacement.

Provider presentation code owns host containers, discovery preferences, native renderer styling, and stage policies. Shared UI owns viewport geometry, chrome, input, and teardown. Legacy factories under `providers/` compose host implementations by explicit provider selection; a new provider contributes the same pieces through its hooks instead of joining a factory. Cross-world and iframe protocols remain platform responsibilities and must retain their provenance checks.

## Automatic theater entry

`ProviderDefinition.watchPlayback` separates two steps: `pageIdentity` qualifies a
provider's watch URL and returns a stable identity without tracking parameters;
`mainVideo` confirms the primary watch player in MAIN, excluding auxiliary players
and validating host content identity where available. Providers own further
filters: YouTube rejects ads and stale player identities; Netflix also checks its
native session identity when the API is available. Netflix and Disney+ treat ads
inside the primary watch player as part of the selected watch session, so missing
ad-plan discrimination does not block automatic entry on those services.

YouTube's player API can still report buffering at the native `playing` event;
playback readiness therefore comes from the video, while the provider confirms
content identity and excludes ads. Providers without this declaration never enter
automatically. The synchronous string bridge in `providers/watch-playback.ts`
confirms the exact element; the runtime also applies the existing switchable-video
filters and discovery ranking.

`ui/auto-theater-runtime.ts` listens for playback and existing provider navigation
publications, provider-declared watch refresh events, and focus/fullscreen gate
releases, and calls the regular theater entry path. Transition completion also
re-evaluates entry. A released gate can enter the same unentered visit while
playback remains active. Failed provider observation is retried on the next
refresh. YouTube observes the main player's ad-state classes, since ad
completion need not emit another playing event. A provider may also declare
`WatchPlayback.observeReveal`, attached while an entry is still possible and before any
video is found, for host reveals with no event of their own: YouTube's expanding the
miniplayer un-hides the watch page with attribute flips shortly after its last publication
and moves the player into the watch page's container later still, which can land after the
countdown has run out. The opt-in preference defaults
off; a visit records entry so exiting or changing preferences cannot reenter the
same content. New content identities reset
Entry is announced first: once the provider confirms the main video's identity and
playback has been requested (not paused or ended, no media error, a source loading) —
even before the stream can play (`ui/auto-theater-intent.ts`) — a corner notice shows for at
least 5 s from that moment, and entry waits for both that time and actual playback; a
stream still loading when the time ends is simply awaited. The provider bridge confirms identity only;
the runtime decides playing versus loading.

A provider may also declare the optional `WatchPlayback.preparingVideo`, a looser,
countdown-only confirmation for the window after an SPA entry when the host has not yet
revealed, sourced or sized its player. It may return a hidden, sourceless or unsized
content video (a requested play on a sourceless one counts as loading), but never an ad,
an auxiliary player or one whose loaded identity differs from the URL's. It only starts or
keeps the notice; entry at the end of the timer still needs `mainVideo` plus the
switchable-video checks and actual playback, and leaving the watch URL cancels without
consuming the visit. YouTube declares it and also refreshes on `yt-navigate-start` and
`yt-page-type-changed`, because the later publications arrive only once the watch page is
revealed when entering from Home or search. It is a separate bridge query (same
string-only, top-frame, href-checked protocol as `mainVideo`). The notice is keyed by content identity.
Transient losses — pause, end, media error/abort/emptied, `mainVideo`/`preparing` confirmation, a
replaced video element, a YouTube ad — only start a grace (`AUTO_ENTER_CANCEL_GRACE_MS`, one timer
owned by the intent and cleared on dispose). If eligibility returns within it, the same notice and
original deadline continue and the appear animation does not replay; the grace is not extended by
repeated refreshes, which therefore need no coalescing. Once it lapses the notice closes without
consuming the visit and the countdown restarts from the full 5 s when playback resumes. Definitive
changes skip the grace: Click/Escape, a new content identity or leaving the watch URL, a disabled
setting or blocked policy, theater active, fullscreen, a transition, Skip countdown and disposal.
The notice can also mount a non-interactive scrim (`ui/auto-theater-scrim.ts`; currently switched off by
`AUTO_THEATER_SCRIM_ENABLED`, so the page is not dimmed). When enabled it dims the loading host page around the video's box. It is owned by the notice's lifecycle, so the
grace keeps it and every close removes it: cancellation fades it out, entry drops it in the same task
(the theater video already covers the viewport), and Reduce motion removes it without a fade. The cut-out
is re-read only on resize, scroll and video resize. The digit is the full seconds left (4, 3, 2, 1, 0; the first frame shows 4), so 0 is the last second, in which the ring exits before entry. Click or Escape cancels it and consumes the visit.
The optional AutoTheater Skip countdown preference bypasses the notice and its timer;
it still waits for active playback and revalidates every entry condition. Changing
this preference clears a pending notice without consuming the visit. Automatic entry requires an enabled provider, an allowed domain, a
top-level document, active playback, no fullscreen and no focused editable field.

YouTube `/watch?v=…`, ordinary Vimeo clip pages, Netflix `/watch/<numeric-id>`,
Disney+ `/play/<uuid>` (with an optional locale prefix), iQIYI `/play/<slug>-<id>` on www.iq.com, SOOP `play.sooplive.com/<bj>/<number>` (live) and `vod.sooplive.com/player/<number>` (recording), Bilibili `/video/BV…`
(with `p` identifying each part), Bilibili.tv `/<locale>/video/<id>` and
`/<locale>/play/<series>/<episode>`, and Patreon posts
(`/posts/<slug>-<id>`, `/<creator>/posts/<slug>-<id>`) declare this capability.
Netflix requires its watch-page player; Disney+ requires the primary Hive video
inside `disney-web-player` and excludes the auxiliary BTM media client. Catalog
pages stay ineligible, even when previews are playing. Vimeo pages whose video
lives in an iframe remain ineligible. A Patreon post qualifies only when its page holds
exactly one `mux-player` whose single `<video>` (reached through open shadow roots) is not a live
stream and no other video is playing. Pages without `mux-player` (Patreon's own player) qualify when
they hold exactly one non-live `<video>`; galleries, related-post players and embedded iframes stay
manual, and identity is the URL's post id only. Patreon is a pushState SPA whose route changes fire
no `popstate`, so its MAIN-world hook (`providers/patreon/navigation.ts`) publishes one window event
per `pushState`/`replaceState` for the runtime to refresh on. Twitch declares VOD pages
only (`/videos/<id>`); live channels, clips and embeds stay manual. A VOD qualifies when its page
holds exactly one `<video>`, inside the player's `video-ref`, with a non-infinite duration (the
previous channel's live video during SPA entry is therefore rejected). Ads stitched into the VOD
stream are part of the watch session, as on Netflix and Disney+. Twitch is a pushState SPA too and
reuses the shared history publication (`providers/history-publication.ts`). Tencent
also has WASM/iframe playback; Crunchyroll commonly plays in a separate frame.
These providers remain undeclared until those content boundaries are qualified.
Bilibili confirms the live bpx player manifest (upload kind, BV id and part) and
its exact primary media element, excluding preview and mini-player surfaces.
Patched ad playlists reuse that element; because the public `hasValidAdv()` API
only identifies the playlist, those entire sessions stay manual (including content
after an ad). Missing or throwing player APIs also fail closed.
Its MAIN-world history hook publishes route changes, including part changes;
stale manifests fail closed during SPA transitions. The preparing confirmation
uses the same identity checks while allowing the content video to load.
Bilibili.tv uses a separate provider for its top-document `.bstar-player`: the
live DASH instance must own the exact primary video, and its static manifest
watch URL must match the current content identity. Locale and tracking changes
do not create new visits. Mini-player modes and visible/loading in-stream ad
surfaces fail closed; their mode/style changes refresh eligibility. Missing DASH
state, iframe players and season-only URLs remain manual. Both Bilibili providers
reuse the history publication and shared countdown runtime.
iQIYI confirms the single `iqp-player`'s own direct child video (ad videos sit in its ad container), requires the host's highlighted episode to match the URL, and refreshes on a MAIN-world `pushState` publication. SOOP confirms the one streamed `blob:` video of its `#webplayer #player` (`video#livePlayer`, infinite duration, on live; `video#video`, finite, on recordings), so the placeholder shown before the player terms are accepted and the separate ad element never qualify. Vimeo showcases, live events and OTT pages are also excluded.
Rakuten Viki declares `/videos/<id>v` (with an optional slug) on viki.com. Its player is the page's only
Video.js `video.vjs-tech`, and the player is rebuilt on every episode change without any id on the element, so
identity is the episode whose DASH manifest the page requested last (read from the resource timeline, which
fails closed when its buffer is full); another episode's video is rejected during SPA navigation. Ads share the
element and stay part of the visit. Route changes need no history hook: the rebuilt video's playback events
refresh entry.

A theater session that starts on a declared watch route ends through the
normal exit path when navigation leaves that route, independent of media state or
other videos on the destination page. History traversal, provider navigation
publications and replacement discovery revalidate the route. Replacement videos
on routes with a declared content identity must pass the provider's current
`mainVideo` identity check through the same string-only bridge, including with RTE
disabled. The replacement purpose accepts paused primary media; automatic entry retains its
integration gate. Sessions entered outside declared watch routes retain generic
video discovery and replacement behavior. A provider's optional `playbackPage`
can preserve manual playback routes without a stable URL content identity (such
as season pages); those retain generic replacement behavior and remain ineligible
for automatic entry.

A provider may declare `WatchPlayback.miniplayerVideo` for a player the host parks in a
miniplayer on non-watch routes. MAIN returns the parked video with the content identity its
player reports, or null while that identity is unknown, disagrees between player reads, or
belongs to an ad; a separate bridge query (same string-only, top-frame, href-checked protocol,
also with the integration disabled) carries the identity. The miniplayer is never a discovery,
Switch Video or AutoTheater candidate: `findProviderTheaterTarget` offers it to manual entry
only, when it is pointed at or chosen with the launcher, or when nothing else is a target. A
session entered there is keyed to the miniplayer, not the route: navigation between listing
pages keeps it, the next queue item on the same element keeps it (title, chapters, heatmap and
captions are cleared until the player confirms the new identity, then reloaded), and closing
the miniplayer ends it after the lost-surface grace. Expanding it continues the session as a
watch session once the provider confirms the player for the watch route. YouTube declares it
for `ytd-app[miniplayer-is-active] ytd-miniplayer`; entry re-pins the video after the ancestor
overrides, which remove the miniplayer's containing block, and the YouTube stage hides the
listing page behind it.

The YouTube data readers in both worlds resolve one expected content id: the URL's on watch
routes, otherwise the parked player's confirmed id while the miniplayer shows (MAIN reads it
from the player, the adapter through the miniplayer bridge for its bound video). In that case
matching is strict: data without that id, or any data while it is unknown, is rejected, and the
page-DOM fallbacks (watch heading, `og:title`, document title, rendered heatmap) are skipped
because they describe the page. An empty title hides the chip.

## Video launcher

`ProviderDefinition.launcherPlacement` (for a registered provider, `ProviderHooks.launcherPlacement`) supplies an optional `LauncherPlacement`
(`providers/launcher-placement.ts`). Its `read()` revalidates the current video,
player and native insertion anchor; `null` uses the generic overlay. The separate
RTE `launcher` capability describes this placement support, not automatic entry.
Disabled integrations never create a placement source. Providers own scoped
observation, native control styling and idempotent disposal; shared UI owns the
button, activation, playback gating and removal. Sources are disposed on video
removal, setting changes and navigation. Provider navigation publications reset
pointer selection before a new appearance, including YouTube SPA updates.

A slot may declare `persistent`: the native toolbar then owns when the button is
visible, and shared UI skips the overlay timing (paused-only eligibility, pointer
approach, idle hide, hide-on-play). The button stays mounted while the player,
anchor and the usual gates (setting, RTE, size, picture-in-picture, fullscreen and
theater exclusions) allow it. Without `persistent`, a slot follows the overlay's
pointer timing. The tooltip always carries the user's theater shortcut in square
brackets, whichever surface renders the button.

YouTube inserts immediately before the autoplay control in the right cluster,
without moving any existing controls, including other extensions' buttons, and
declares the slot `persistent`. A missing anchor falls back to the overlay, as does the
miniplayer, which keeps the right cluster hidden. The native `ytp-button` class supplies
control color and the monochrome mark uses `currentColor` with a transparent
play cutout and no background. Generic overlays use the `left-third` slot: a 12 px inset from the left edge and
one third of the video height down (clamped inside the margins for tiny videos),
regardless of page overlays or native controls. Dynamic placement is
intentionally retained behind `ACTIVATOR_DYNAMIC_PLACEMENT` in
`ui/video-activator.ts` for possible reuse; it is disabled by default and the pure
placement algorithm remains independent of that runtime flag. Provider slots
still take precedence. Generic overlay slots remain frozen for each
appearance despite page chrome mutations. A changed video rectangle or viewport
removes and remounts the button rather than moving the mounted control. Playback
ends the overlay launcher only when the viewer started it: a pointer press on the video, or a
key press inside its container, within `ACTIVATOR_PRESS_WINDOW_MS` before `play`. Any other
start is autoplay and leaves the launcher available, however long after the load (a press
elsewhere, such as accepting a consent banner, does not count; nor does `userActivation`, which
that click would also satisfy), as does any start within `ACTIVATOR_PLAY_GRACE_MS` of the page load
(or of an SPA visit's start, when the navigation click still lands on the page). The classification
is latched per video at `play` and discovery. When the viewer starts playback while the launcher is
shown, it stays for `PLAY_LINGER_MS` (3 s) and then hides like the idle fade; pointer movement does
not extend that, keyboard focus on the launcher keeps it, and pause, removal, navigation and entering
theater cancel it (persistent provider slots have no such timing). Pausing makes it eligible again through the same proximity selection.
There is no additional polling.

## Native chat

`chat/types.ts` defines `ChatSurface`, a description of the page's existing chat container, identity, live/replay kind, optional iframe and ancestors needed for presentation. It does not render messages or expose account actions. Twitch's detection and identity checks live in `chat/detect.ts`; registered providers supply theirs through `ProviderChat` (`providers/youtube/chat.ts`, `providers/soop/chat.ts`), registered in both worlds so MAIN's entry shortcut capture also leaves chat keys alone, with the palette adapter only in the isolated world. `ChatController` owns visibility, width, geometry, observation and cleanup. It runs no timer on a page without chat: routes are noticed through `popstate`, YouTube's `yt-navigate-finish` / `yt-page-data-updated` and the Twitch and SOOP history publications, and shells through a mutation observer scoped to watch routes. The one timer left re-reads every 2 s while a native control is waiting to open the chat, unless the provider's `observeVisibility` watches the bound surface for open/close flips that change no structure; that watch belongs to the surface and is dropped when it is replaced and on stop. The player runtime starts and stops the chat session on theater entry and exit. `ui/chat.ts` renders one shared toggle, width slider and theme select, and persists visibility, width and theme per service; pending writes flush on session stop and `pagehide`.

On entry and each new watch identity, native visibility from the service adapter takes precedence over saved visibility. A collapsed native activation starts hidden; unavailable measurement falls back to the saved choice. In-theater toggles override that seed for the current content and remain saved for this fallback. Width and theme still persist independently; saved data is retained. Visibility discovery is synchronous and uses the same content identity checks as surface discovery.

SOOP's chat is in the same document as its player (`#chatting_area`, with the panel `.chatbox` inside, shown while `#webplayer` has `chat_open`); it has no palette adapter, so a non-native theme choice stays unavailable and the service keeps its appearance. The player's own chat button opens a panel closed before theater, and the panel's close button hides it by dropping `chat_open` and the column's display; neither raises a structural mutation, so SOOP observes only `#webplayer`'s class for `chat_open` flips. A close in theater counts as hiding the chat with the theater toggle (the picture takes the column, and the choice is saved); the toggle reopens it through the player button. `ChatThemeSession` owns palette readiness, document identity and restoration. `ChatThemeAdapter` supplies `apply` and `restore`; Twitch discovers the complete native palette class, while YouTube maps known compiled aliases to existing native palette tokens in the original chat document. An unavailable palette restores service appearance and keeps the requested preference. Chat layout and theme changes preserve the native container and iframe. Native menus, portals, keyboard events and chat-only documents retain service ownership. [Usage and qualification](research/native-chat-validation.md) distinguish the implemented behavior from replay/account/browser coverage still needed before release.

## Adding a feature

1. Define a small shared contract for the feature, including availability and cleanup where needed.
2. Implement the interface once in the player using only that contract.
3. Implement each host's data and commands inside its provider (see below), exposed through a hook on that contract.
4. Test provider identity/expiry guards separately from generic rendering and lifecycle behavior. Verify the installed extension on the real host for behavior that a DOM fixture cannot prove.

## Adding a service integration

Every new RTE integration is a per-host provider that loads asynchronously with its host and registers itself; none is added to the shared bundles. [SOOP](../src/providers/soop/) and [YouTube](../src/providers/youtube/) are the references; start from `soop/provider.json`, `soop/isolated.ts` and `soop/main.ts`. Netflix, Disney+, Twitch, Crunchyroll, Bilibili, Patreon, Viki, iQIYI and the other services still wired into the shared scripts are legacy and migrate one by one. A change may edit their code in place but must not add shared-code coupling.

- **Descriptor.** `src/providers/<id>/provider.json` is the single source of truth for the provider's id, hosts, entry files and injection time; the parser in [`scripts/provider-descriptors.ts`](../scripts/provider-descriptors.ts) defines the fields. The id is one of `MEDIA_PROVIDER_IDS`. After editing it, run `pnpm exec tsx scripts/provider-descriptors.ts` to regenerate the host catalog (`providers/catalog.ts`) and the manifest `content_scripts`. Never hand-edit those. Build and packaging details are in [building.md](building.md).
- **Loading.** The generator emits static `matches` for the descriptor's hosts (both dotted DNS spellings) and excludes them from the generic rules, so the provider's isolated and MAIN scripts load at `document_start` only on its hosts, in every frame of those hosts, and nowhere else. Never gate loading on `t`, theater entry or `document_idle`.
- **Hooks and registration.** The isolated and MAIN entries each call `providerRuntime(world)?.register(hooks)` with `ProviderHooks` (`providers/provider-api.ts`): adapter, watch playback, timeline, launcher placement, service actions, navigation, chat, MAIN-world harvest, page fetch, seek, probe and install. Each hook belongs to one world (adapter, timeline, launcher placement, navigation and service actions: isolated; `install`, harvest, page fetch, seek and probe: MAIN); `watchPlayback` and `chat` register in both, so MAIN's entry shortcut capture also leaves the chat alone. Stateful shared owners (page fetch, probe, element tokens) come from `ProviderServices` on the runtime API, never from a second bundled copy. Registration runs before the shared runtime starts and is closed afterwards; the registry (`providers/runtime-registration.ts`) refuses hooks for a host that does not match the descriptor, and a missing or rejected registration leaves generic HTML5 behavior. Shared code reads the registered hooks and capabilities and never imports the provider.
- **What stays out of shared code.** No service code, host checks, selectors or branches in `entries/content.ts`, `entries/main-world.ts`, `src/ui`, `src/core`, `src/platform`, `src/chat`, `src/media-features`, `src/protocol` or the shared `providers/` files. A missing capability gets a new generic hook or contract that the provider fills (see Adding a feature), not a branch. The shared edits a new integration may make are declarative: its id and flag in `media-features/provider-flags.ts`, its row in `providers/capabilities.ts`, and `_locales/` strings. The build rejects provider code in the shared scripts and runtime owners duplicated into a provider script (`provider-boundaries` in [`scripts/build.ts`](../scripts/build.ts)).
- **Consistency test.** [`scripts/provider-descriptors.test.ts`](../scripts/provider-descriptors.test.ts) fails when the descriptors, generated catalog, `manifest.json`, provider registry and entry inventory disagree, on overlapping or malformed hosts, and when provider modules leak into shared bundles. Do not edit it to make a new provider pass; fix the descriptor or regenerate.
- **Verification.** Prove load scope as well as behavior: the provider is present on its hosts and frames, absent from look-alike hosts, and generic playback is unchanged with RTE off. The installed-extension smoke for this is in [`scripts/smoke/providers.ts`](../scripts/smoke/providers.ts).
