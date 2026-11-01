import type { PlaylistAction } from '../../playlist-nav';
import { usableControlIndexes, type PlaylistHelpers } from '../playlist-controls';
import { providerRegistry } from '../runtime-registration';

import { DAILYMOTION_PLAYER_SELECTOR, readDailymotionControls } from './dailymotion';
import { findDisneyPlaylistActions } from './disney';
import { readTencentControls, TENCENT_PLAYER_SELECTOR } from './tencent';
import { readVideoJsControls, peerTubeNeighborPreviews, VIDEOJS_PLAYER_SELECTOR } from './videojs';

export const HOST_PLAYER_SCOPE = [
  VIDEOJS_PLAYER_SELECTOR,
  DAILYMOTION_PLAYER_SELECTOR,
  TENCENT_PLAYER_SELECTOR
].join(', ');

export function findProviderPlaylistActions(
  root: ParentNode,
  video: HTMLVideoElement | null | undefined,
  helpers: PlaylistHelpers
): PlaylistAction[] {
  const queues = providerRegistry.all().flatMap(hooks => hooks.navigation?.queue?.(root, video, helpers) ?? []);
  const queued = new Set(queues.flatMap(queue => [...queue.claimed]));
  const host = queues.flatMap(queue => queue.actions).concat(hostActions(root, video, helpers).filter(action => !queued.has(action.direction)));
  const href = () => pageHref(root);
  const dedicated = [
    ...providerRegistry.all().flatMap(hooks => hooks.navigation?.fallback?.(root, video, href) ?? []),
    ...findDisneyPlaylistActions(root, href)
  ];
  const claimed = new Set(host.map((action) => action.direction));
  return host.concat(dedicated.filter((action) => !claimed.has(action.direction)))
    .sort((a, b) => a.direction === b.direction ? 0 : a.direction === 'previous' ? -1 : 1);
}

function hostActions(
  root: ParentNode,
  video: HTMLVideoElement | null | undefined,
  helpers: PlaylistHelpers
): PlaylistAction[] {
  const scope = scopedRoot(root, video);
  const scoped = readHostControls(scope);
  const controls = scoped.length > 0 || scope === root ? scoped : readHostControls(root);
  const page = previewRoot(root);
  const neighbors = peerTubeNeighborPreviews(page, pageHref(page), helpers);
  const width = viewportWidth(root);
  return usableControlIndexes(controls.map((entry) => entry.snapshot), width).map(({ index, direction }) => {
    const entry = controls[index];
    const described = entry?.describe({ direction, page, helpers, neighbors });
    return {
      direction,
      preview: described?.preview ?? null,
      restarts: described?.restarts ?? false,
      activate() {
        entry?.element.click();
      }
    };
  });
}

function readHostControls(root: ParentNode) {
  return [
    ...readVideoJsControls(root),
    ...readDailymotionControls(root),
    ...readTencentControls(root),
    ...providerRegistry.all().flatMap(hooks => hooks.navigation?.readControls?.(root) ?? [])
  ];
}

function scopedRoot(root: ParentNode, video?: HTMLVideoElement | null): ParentNode {
  const player = video?.closest([HOST_PLAYER_SCOPE, ...providerRegistry.all().flatMap(hooks => hooks.navigation?.playerSelector ?? [])].join(', '));
  return player ?? root;
}

function viewportWidth(root: ParentNode): number {
  const width = viewOf(root)?.innerWidth ?? 0;
  return width > 0 ? width : 1280;
}

function previewRoot(root: ParentNode): ParentNode {
  if (root instanceof ShadowRoot) return root.host.ownerDocument;
  return root;
}

function pageHref(root: ParentNode): string {
  return viewOf(root)?.location.href || '';
}

function viewOf(root: ParentNode): Window | null {
  const node = root as Node;
  const doc = node.nodeType === Node.DOCUMENT_NODE ? node as Document : node.ownerDocument;
  return doc?.defaultView ?? null;
}
