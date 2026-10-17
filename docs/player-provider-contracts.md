# Player and provider boundaries

The player owns the interface and the behavior of its features. Providers translate host services into those features: read host data, observe changes, validate identity and availability, and execute host interactions. Adding a service must not add its selectors or timing rules to a player component.

## Contextual actions

`core/service-actions.ts` defines `ServiceActionSource`: `read()` supplies current actions with an opaque ID, a label, and optional progress in `[0, 1]`; `activate(id)` revalidates the action before executing it. Optional `subscribe(onChange)` reports availability or structural changes, and `readProgress(id)` reads only the cached action's native progress (`null` invalidates its identity, `undefined` means no progress). Subscribed sources own their observers and visible-document fallback, and return idempotent cleanup; the UI supplies the fallback only for legacy sources without a subscription. Discovery is coalesced after relevant mutations/events, with a fallback no faster than 1 Hz in visible documents; hidden documents stop it. The CTA animation reads only progress for visible, current actions and stops while menus or the document hide it. The shared component in `ui/service-actions.ts` renders multiple actions, handles focus and activation, clears open menus, and follows the player chrome's placement lifecycle.

The provider owns action availability, expiry, stale-click rejection, and any countdown. The player displays the supplied progress and never starts or restarts the host timer. Netflix's intro and postplay actions implement this contract in `providers/netflix/service-actions.ts`. Another service can implement the same source and register it in `providers/service-actions.ts` without changing the CTA component.

Persistent previous/next controls belong to playlist navigation, not contextual actions. Netflix's toolbar next-episode control uses the same `PlaylistAction` / `PlaylistNavState` contract and player controls as YouTube playlist navigation. Host selectors and preview rules live in `providers/navigation/`; `playlist-nav.ts` owns the shared state and preview validation. One `PlaylistNavState` snapshot supplies both buttons, labels, previews and the existing iframe availability message. Provider-selected DOM surfaces (including open shadow roots) trigger coalesced refreshes; the active session keeps a visible-document fallback at most once per second for model-only changes. Activation still reads and revalidates the live target. The existing iframe navigation protocol is unchanged.

## Captions

Shared caption rendering and dock calculations stay in `media-features/` and `ui/toolbar.ts`. Native caption providers expose `HostCaptionLayout` geometry and an optional motion target through the composite adapter. Their observers own host mutations, cached measurements, and cleanup. The controller connects and disconnects subscriptions when rebinding or disposing; callbacks from an old adapter cannot affect the current player.

`MediaFeaturesController.runCaptionOperation` owns the complete caption request lifecycle. Menu selection, keyboard toggling, saved-language restoration, retries and cue-window downloads all pass through it. It publishes the loading HUD and CC busy state before calling the provider, applies the result once, and reports success or failure. Cue-window success dismisses the spinner without repeating the “Subtitles on” notification. Invalidation, media changes, adapter replacement and disposal dismiss pending loading UI and reject stale results and queued selections. Callers cannot opt out of loading feedback.

The HUD waits 400 ms before rendering the loading message, so quick downloads do not flash a spinner. A result or dismissal cancels the pending message; delayed rendering also checks the player session epoch and element. The CC busy state still updates immediately.

Providers that load captions in windows implement `prepareCaptionCueRefresh(id, time)`. It must synchronously return `null` when no download is needed, or return a lazy request that does no work until the controller calls it. The composite delegates to the adapter that activated the current track, so polling never rediscovers tracks or initiates an invisible download. Providers keep their network fallback, parsing and cache policies inside that request. Track discovery and timeline metadata do not activate a caption track and do not show caption loading UI.

Netflix native cue measurement lives in `providers/netflix/host-captions.ts`, and Crunchyroll native caption measurement lives in `providers/crunchyroll/host-surface.ts`. Native presentation remains available when a provider's data integration is disabled; the integration flag still controls its data adapter and host interactions.

## Titles

Adapters supply `getTitle()` and optional `observeTitle(onChange)`; `MediaFeaturesController` publishes the title chip for the current epoch and adapter, and drops notifications from a replaced adapter. A service adapter's title outranks the native adapter's. Without a service integration, the native adapter also falls back to page metadata: selection lives in `media-features/page-title.ts`, DOM reading and observation in `providers/native/page-title.ts`. A VideoObject must match the playing media, and a heading must be tied to it. A client-side navigation can change the URL before `<title>`, meta tags or the heading, so page values left over from the previous URL are rejected; scoped observers on those elements report the replacement during theater mode only.

## Playback and presentation

`playback-surface.ts` defines the player's playback surface and capabilities. `playback-window.ts` handles shared timeline geometry, seek clamping, and pending-seek state. Host clocks and seek dispatch policies live in `providers/timeline/`. Controls consume the generic clock reader and observer rather than reading service-specific datasets or events.

`providers/playback-session.ts` selects theater targets and opens provider-owned playback sessions. A session supplies a `PlaybackSurface`, a pointer-catcher capability, a replacement notification and idempotent disposal. Tencent owns WASM discovery, bridge setup and replacement observation; shared UI handles controls and viewport restoration when it receives a replacement.

Provider presentation code owns host containers, discovery preferences, native renderer styling, and stage policies. Shared UI owns viewport geometry, chrome, input, and teardown. Factories under `providers/` compose host implementations; their explicit provider selection is intentional. Cross-world and iframe protocols remain platform responsibilities and must retain their provenance checks.

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
refresh. YouTube observes only the main player's ad-state classes, since ad
completion need not emit another playing event. The opt-in preference defaults
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
While the notice shows, the same UI layer mounts a non-interactive scrim (`ui/auto-theater-scrim.ts`)
that dims the loading host page around the video's box. It is owned by the notice's lifecycle, so the
grace keeps it and every close removes it: cancellation fades it out, entry drops it in the same task
(the theater video already covers the viewport), and Reduce motion removes it without a fade. The cut-out
is re-read only on resize, scroll and video resize. The digit is the full seconds left (4, 3, 2, 1, 0; the first frame shows 4), so 0 is the last second, in which the ring exits before entry. Click or Escape cancels it and consumes the visit.
The optional AutoTheater Skip countdown preference bypasses the notice and its timer;
it still waits for active playback and revalidates every entry condition. Changing
this preference clears a pending notice without consuming the visit. Automatic entry requires an enabled provider, an allowed domain, a
top-level document, active playback, no fullscreen and no focused editable field.

YouTube `/watch?v=…`, ordinary Vimeo clip pages, Netflix `/watch/<numeric-id>`,
Disney+ `/play/<uuid>` (with an optional locale prefix) and Patreon posts
(`/posts/<slug>-<id>`, `/<creator>/posts/<slug>-<id>`) declare this capability.
Netflix requires its watch-page player; Disney+ requires the primary Hive video
inside `disney-web-player` and excludes the auxiliary BTM media client. Catalog
pages stay ineligible, even when previews are playing. Vimeo pages whose video
lives in an iframe remain ineligible. A Patreon post qualifies only when its page holds
exactly one `mux-player` whose single `<video>` (reached through open shadow roots) is not a live
stream and no other video is playing; galleries, related-post players and embedded iframes stay
manual, and identity is the URL's post id only. Patreon is a pushState SPA whose route changes fire
no `popstate`, so its MAIN-world hook (`providers/patreon/navigation.ts`) publishes one window event
per `pushState`/`replaceState` for the runtime to refresh on. Twitch uses
stitched ads; Bilibili and Bilibili.tv need qualified main-player/content identity
and ad guards; Tencent
also has WASM/iframe playback; Crunchyroll commonly plays in a separate frame.
These providers remain undeclared until those content boundaries are qualified.
Vimeo showcases, live events and OTT pages are also excluded.

## Video launcher

`ProviderDefinition.launcherPlacement` supplies an optional `LauncherPlacement`
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
declares the slot `persistent`. A missing anchor falls back to the overlay. The native `ytp-button` class supplies
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
hides the overlay launcher only when the viewer started it: a pointer press on the video, or a
key press inside its container, within `ACTIVATOR_PRESS_WINDOW_MS` before `play`. Any other
start is autoplay and leaves the launcher available, however long after the load (a press
elsewhere, such as accepting a consent banner, does not count; nor does `userActivation`, which
that click would also satisfy), as does any start within `ACTIVATOR_PLAY_GRACE_MS` of the page load
(or of an SPA visit's start, when the navigation click still lands on the page). The classification
is latched per video at `play` and discovery; no timer ends it. Pausing makes it eligible again through the same proximity selection.
There is no additional polling.

## Native chat

`chat/types.ts` defines `ChatSurface`, a description of the page's existing chat container, identity, live/replay kind, optional iframe and ancestors needed for presentation. It does not render messages or expose account actions. `chat/detect.ts` owns service detection and identity checks; `ChatController` owns visibility, width, geometry, observation and cleanup. The player runtime starts and stops the chat session on theater entry and exit. `ui/chat.ts` renders one shared toggle, width slider and theme select, and persists visibility, width and theme per service; pending writes flush on session stop and `pagehide`.

`ChatThemeSession` owns palette readiness, document identity and restoration. `ChatThemeAdapter` supplies `apply` and `restore`; Twitch discovers the complete native palette class, while YouTube maps known compiled aliases to existing native palette tokens in the original chat document. An unavailable palette restores service appearance and keeps the requested preference. Chat layout and theme changes preserve the native container and iframe. Native menus, portals, keyboard events and chat-only documents retain service ownership. [Usage and qualification](research/native-chat-validation.md) distinguish the implemented behavior from replay/account/browser coverage still needed before release.

## Adding a feature or provider

1. Define a small shared contract for the feature, including availability and cleanup where needed.
2. Implement the interface once in the player using only that contract.
3. Implement each host's data and commands inside its provider and register it in the composition factory.
4. Test provider identity/expiry guards separately from generic rendering and lifecycle behavior. Verify the installed extension on the real host for behavior that a DOM fixture cannot prove.
