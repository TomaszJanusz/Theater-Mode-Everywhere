# Player and provider boundaries

The player owns the interface and the behavior of its features. Providers translate host services into those features: read host data, observe changes, validate identity and availability, and execute host interactions. Adding a service must not add its selectors or timing rules to a player component.

## Contextual actions

`core/service-actions.ts` defines `ServiceActionSource`: `read()` supplies current actions with an opaque ID, a label, and optional progress in `[0, 1]`; `activate(id)` revalidates the action before executing it. The shared component in `ui/service-actions.ts` renders multiple actions, handles focus and activation, clears open menus, and follows the player chrome's placement lifecycle.

The provider owns action availability, expiry, stale-click rejection, and any countdown. The player displays the supplied progress and never starts or restarts the host timer. Netflix's intro and postplay actions implement this contract in `providers/netflix/service-actions.ts`. Another service can implement the same source and register it in `providers/service-actions.ts` without changing the CTA component.

Persistent previous/next controls belong to playlist navigation, not contextual actions. Netflix's toolbar next-episode control uses the same `PlaylistAction` / `PlaylistNavState` contract and player controls as YouTube playlist navigation. Host selectors and preview rules live in `providers/navigation/`; `playlist-nav.ts` owns the shared state and preview validation. The existing iframe navigation protocol is unchanged.

## Captions

Shared caption rendering and dock calculations stay in `media-features/` and `ui/toolbar.ts`. Native caption providers expose `HostCaptionLayout` geometry and an optional motion target through the composite adapter. Their observers own host mutations, cached measurements, and cleanup. The controller connects and disconnects subscriptions when rebinding or disposing; callbacks from an old adapter cannot affect the current player.

Netflix native cue measurement lives in `providers/netflix/host-captions.ts`, and Crunchyroll native caption measurement lives in `providers/crunchyroll/host-surface.ts`. Native presentation remains available when a provider's data integration is disabled; the integration flag still controls its data adapter and host interactions.

## Playback and presentation

`playback-surface.ts` defines the player's playback surface and capabilities. `playback-window.ts` handles shared timeline geometry, seek clamping, and pending-seek state. Host clocks and seek dispatch policies live in `providers/timeline/`. Controls consume the generic clock reader and observer rather than reading service-specific datasets or events.

Provider presentation code owns host containers, discovery preferences, native renderer styling, and stage policies. Shared UI owns viewport geometry, chrome, input, and teardown. Factories under `providers/` compose host implementations; their explicit provider selection is intentional. Cross-world and iframe protocols remain platform responsibilities and must retain their provenance checks.

## Adding a feature or provider

1. Define a small shared contract for the feature, including availability and cleanup where needed.
2. Implement the interface once in the player using only that contract.
3. Implement each host's data and commands inside its provider and register it in the composition factory.
4. Test provider identity/expiry guards separately from generic rendering and lifecycle behavior. Verify the installed extension on the real host for behavior that a DOM fixture cannot prove.
