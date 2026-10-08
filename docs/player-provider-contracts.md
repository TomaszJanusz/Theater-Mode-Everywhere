# Player and provider boundaries

The player owns the interface and the behavior of its features. Providers translate host services into those features: read host data, observe changes, validate identity and availability, and execute host interactions. Adding a service must not add its selectors or timing rules to a player component.

## Contextual actions

`core/service-actions.ts` defines `ServiceActionSource`: `read()` supplies current actions with an opaque ID, a label, and optional progress in `[0, 1]`; `activate(id)` revalidates the action before executing it. The shared component in `ui/service-actions.ts` renders multiple actions, handles focus and activation, clears open menus, and follows the player chrome's placement lifecycle.

The provider owns action availability, expiry, stale-click rejection, and any countdown. The player displays the supplied progress and never starts or restarts the host timer. Netflix's intro and postplay actions implement this contract in `providers/netflix/service-actions.ts`. Another service can implement the same source and register it in `providers/service-actions.ts` without changing the CTA component.

Persistent previous/next controls belong to playlist navigation, not contextual actions. Netflix's toolbar next-episode control uses the same `PlaylistAction` / `PlaylistNavState` contract and player controls as YouTube playlist navigation. Host selectors and preview rules live in `providers/navigation/`; `playlist-nav.ts` owns the shared state and preview validation. The existing iframe navigation protocol is unchanged.

## Captions

Shared caption rendering and dock calculations stay in `media-features/` and `ui/toolbar.ts`. Native caption providers expose `HostCaptionLayout` geometry and an optional motion target through the composite adapter. Their observers own host mutations, cached measurements, and cleanup. The controller connects and disconnects subscriptions when rebinding or disposing; callbacks from an old adapter cannot affect the current player.

`MediaFeaturesController.runCaptionOperation` owns the complete caption request lifecycle. Menu selection, keyboard toggling, saved-language restoration, retries and cue-window downloads all pass through it. It publishes the loading HUD and CC busy state before calling the provider, applies the result once, and reports success or failure. Cue-window success dismisses the spinner without repeating the “Subtitles on” notification. Invalidation, media changes, adapter replacement and disposal dismiss pending loading UI and reject stale results and queued selections. Callers cannot opt out of loading feedback.

Providers that load captions in windows implement `prepareCaptionCueRefresh(id, time)`. It must synchronously return `null` when no download is needed, or return a lazy request that does no work until the controller calls it. The composite delegates to the adapter that activated the current track, so polling never rediscovers tracks or initiates an invisible download. Providers keep their network fallback, parsing and cache policies inside that request. Track discovery and timeline metadata do not activate a caption track and do not show caption loading UI.

Netflix native cue measurement lives in `providers/netflix/host-captions.ts`, and Crunchyroll native caption measurement lives in `providers/crunchyroll/host-surface.ts`. Native presentation remains available when a provider's data integration is disabled; the integration flag still controls its data adapter and host interactions.

## Playback and presentation

`playback-surface.ts` defines the player's playback surface and capabilities. `playback-window.ts` handles shared timeline geometry, seek clamping, and pending-seek state. Host clocks and seek dispatch policies live in `providers/timeline/`. Controls consume the generic clock reader and observer rather than reading service-specific datasets or events.

Provider presentation code owns host containers, discovery preferences, native renderer styling, and stage policies. Shared UI owns viewport geometry, chrome, input, and teardown. Factories under `providers/` compose host implementations; their explicit provider selection is intentional. Cross-world and iframe protocols remain platform responsibilities and must retain their provenance checks.

## Native chat

`chat/types.ts` defines `ChatSurface`, a description of the page's existing chat container, identity, live/replay kind, optional iframe and ancestors needed for presentation. It does not render messages or expose account actions. `chat/detect.ts` owns service detection and identity checks; `ChatController` owns visibility, width, geometry, observation and cleanup. The player runtime starts and stops the chat session on theater entry and exit. `ui/chat.ts` renders one shared toggle, width slider and theme select, and persists visibility, width and theme per service; pending writes flush on session stop and `pagehide`.

`ChatThemeSession` owns palette readiness, document identity and restoration. `ChatThemeAdapter` supplies `apply` and `restore`; Twitch discovers the complete native palette class, while YouTube maps known compiled aliases to existing native palette tokens in the original chat document. An unavailable palette restores service appearance and keeps the requested preference. Chat layout and theme changes preserve the native container and iframe. Native menus, portals, keyboard events and chat-only documents retain service ownership. [Usage and qualification](research/native-chat-validation.md) distinguish the implemented behavior from replay/account/browser coverage still needed before release.

## Adding a feature or provider

1. Define a small shared contract for the feature, including availability and cleanup where needed.
2. Implement the interface once in the player using only that contract.
3. Implement each host's data and commands inside its provider and register it in the composition factory.
4. Test provider identity/expiry guards separately from generic rendering and lifecycle behavior. Verify the installed extension on the real host for behavior that a DOM fixture cannot prove.
