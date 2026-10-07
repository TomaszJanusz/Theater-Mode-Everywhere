import type { ServiceAction, ServiceActionSource } from '../../core/service-actions';
import type { Chapter } from '../../media-features/types';
import { mediaProviderIntegrationEnabled } from '../../media-features/provider-flags';
import { BILIBILI_INTL_SKIP_DURATION_SLACK_SECONDS } from '../../media-features/parsers/bilibili-intl';
import type { PlaybackSurface } from '../../playback-surface';
import { isBilibiliIntlHost } from '../hosts';
import { BILIBILI_INTL_PLAYER_SELECTOR } from '../navigation/bilibili-intl';
import { bilibiliIntlPathKind, bilibiliIntlRouteEpisodeId } from './main';
import {
  nativeServiceActionId, serviceActionRoute, serviceControlLabel, serviceElementToken, servicePlayer,
  usableServiceControl, type NativeServiceActionHooks
} from '../native-service-actions';

export type ServiceActionChapterContext = { mediaId: string; chapters: readonly Chapter[] };
export type BilibiliIntlServiceActionHooks = NativeServiceActionHooks & {
  video?: PlaybackSurface;
  chapters?: () => ServiceActionChapterContext | null;
  label?: (key: 'skipIntro' | 'skipOutro' | 'nextVideo') => string;
  seek?: (time: number) => void;
};

type LiveAction = ServiceAction & { element?: HTMLElement; end?: number };

export function createBilibiliIntlServiceActions(hooks: BilibiliIntlServiceActionHooks = {}): ServiceActionSource {
  const doc = hooks.document ?? document;
  const enabled = hooks.enabled ?? (() => mediaProviderIntegrationEnabled('bilibiliIntl'));
  const host = hooks.host ?? (() => isBilibiliIntlHost());
  const href = hooks.href ?? (() => window.location.href);
  const label = hooks.label ?? (key => ({ skipIntro: 'Skip intro', skipOutro: 'Skip outro', nextVideo: 'Next' })[key]);

  const live = (): LiveAction[] => {
    if (!enabled() || !host()) return [];
    const root = servicePlayer(doc, BILIBILI_INTL_PLAYER_SELECTOR, hooks.video?.element ?? hooks.element);
    if (!root) return [];
    const url = new URL(href());
    // Uploads and premium/error pages must not inherit an episode's skip windows.
    if (bilibiliIntlPathKind(url.pathname) !== 'ogv') return [];
    const episode = doc.documentElement.getAttribute('data-te-bilibili-intl-episode');
    const kind = doc.documentElement.getAttribute('data-te-bilibili-intl-kind');
    const routeEpisode = bilibiliIntlRouteEpisodeId(url.pathname);
    if (!episode || !/^\d{1,20}$/.test(episode) || (kind && kind !== 'ogv')
      || (routeEpisode && routeEpisode !== episode)) return [];
    const video = hooks.video ?? root.querySelector<HTMLVideoElement>('video');
    if (!video || video.readyState < 1 || video.seeking || !Number.isFinite(video.currentTime)
      || !Number.isFinite(video.duration) || video.duration <= 0) return [];
    const route = serviceActionRoute(href());
    const media = hooks.video?.element ?? (video as HTMLVideoElement);
    const native = hooks.video?.nativeMedia ?? (video as HTMLVideoElement);
    const identity = JSON.stringify([route, episode, serviceElementToken(root), serviceElementToken(media),
      native?.currentSrc || '', native?.getAttribute('src') || '']);
    const actions: LiveAction[] = [];
    const context = hooks.chapters?.();
    if (context?.mediaId === `ogv:${episode}`) {
      for (const chapter of context.chapters) {
        const { start, end, title } = chapter;
        if (chapter.source !== 'bilibiliIntl' || chapter.confidence !== 'high'
          || (title !== 'Intro' && title !== 'Outro') || !Number.isFinite(start) || start < 0
          || start >= video.duration || end === undefined || !Number.isFinite(end) || end <= start
          || end > video.duration + BILIBILI_INTL_SKIP_DURATION_SLACK_SECONDS
          || video.currentTime < start || video.currentTime >= Math.min(end, video.duration) || video.ended) continue;
        const target = Math.min(end, video.duration);
        actions.push({ id: `bilibiliIntl:skip:${identity}:${title}:${start}:${end}:${target}`,
          label: label(title === 'Intro' ? 'skipIntro' : 'skipOutro'), end: target });
      }
    }
    // The host announces its next episode during the final five seconds.
    // The persistent toolbar step remains navigation at other times.
    if (video.ended || video.duration - video.currentTime <= 5) {
      const next = root.querySelector<HTMLElement>('.player-mobile-control-btn-next-episode .ip-next-episode');
      if (next && usableServiceControl(next)) {
        const nativeLabel = serviceControlLabel(next) || serviceControlLabel(next.parentElement!);
        actions.push({ id: nativeServiceActionId('bilibiliIntl:next', identity, root, next, media),
          label: nativeLabel || label('nextVideo'), element: next });
      }
    }
    return actions;
  };
  const read = (): LiveAction[] => {
    try { return live(); } catch { return []; }
  };
  return {
    read: () => read().map(({ element: _element, end: _end, ...action }) => action),
    activate(id) {
      const action = read().find(action => action.id === id);
      if (!action) return false;
      if (action.element) { action.element.click(); return true; }
      if (action.end === undefined) return false;
      if (hooks.seek) hooks.seek(action.end);
      else {
        const root = servicePlayer(doc, BILIBILI_INTL_PLAYER_SELECTOR, hooks.video?.element ?? hooks.element);
        const video = hooks.video ?? root?.querySelector<HTMLVideoElement>('video');
        if (!video) return false;
        video.currentTime = action.end;
      }
      return true;
    }
  };
}
