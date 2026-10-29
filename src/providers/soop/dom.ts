/** SOOP routes and selectors shared by the provider and the shared playlist navigation. */
export const SOOP_PLAYER_SELECTOR = '#webplayer #player';

export type SoopRoute =
  | { kind: 'live'; bj: string; id: string }
  | { kind: 'vod'; id: string };

/**
 * A live broadcast is `play.sooplive.com/<bj>/<broadcast number>` and a recording is
 * `vod.sooplive.com/player/<number>`. A bare channel address, `/catch` clips and every other
 * page are not a stable watch identity.
 */
export function soopRoute(url: URL): SoopRoute | null {
  if (url.protocol !== 'https:') return null;
  if (url.hostname === 'play.sooplive.com') {
    const match = /^\/([a-z0-9_]{2,30})\/(\d{1,12})\/?$/i.exec(url.pathname);
    return match ? { kind: 'live', bj: match[1].toLowerCase(), id: match[2] } : null;
  }
  if (url.hostname === 'vod.sooplive.com') {
    const match = /^\/player\/(\d{1,12})\/?$/.exec(url.pathname);
    return match ? { kind: 'vod', id: match[1] } : null;
  }
  return null;
}

export function soopRouteKey(route: SoopRoute): string {
  return route.kind === 'live' ? `live:${route.bj}/${route.id}` : `vod:${route.id}`;
}
