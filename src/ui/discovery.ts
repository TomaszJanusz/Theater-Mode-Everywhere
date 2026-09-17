import { selectSwitchableVideos } from '../switchable-videos';
import { STATUS_HUD_SWITCH_ICON } from './hud';
import type { PlayerChromeContext } from './runtime-context';

interface VideoMetrics {
  inViewport: boolean;
  isPlaying: boolean;
  isHovered: boolean;
  visibleRatio: number;
  visibleArea: number;
  distanceToCenter: number;
}

export function isElementInDOMDeep(el: Node | null): boolean {
  let parent = el;
  while (parent) {
    if (parent === document.body) return true;
    if (parent instanceof ShadowRoot) {
      parent = parent.host;
    } else {
      parent = parent.parentNode;
    }
  }
  return false;
}

export function createDiscovery(ctx: PlayerChromeContext) {
  function findAllVideosDeep(root: Document | ShadowRoot = document): HTMLVideoElement[] {
    const videos: HTMLVideoElement[] = Array.from(root.querySelectorAll('video'));
    for (const host of root.querySelectorAll('*')) {
      if (host.shadowRoot) {
        videos.push(...findAllVideosDeep(host.shadowRoot));
      }
    }
    return videos;
  }

  function injectStylesIntoShadowRoot(shadowRoot: ShadowRoot): void {
    if (shadowRoot.getElementById('theater-everywhere-shadow-styles')) return;

    const styleEl = document.createElement('style');
    styleEl.id = 'theater-everywhere-shadow-styles';
    styleEl.textContent = `
    .theater-everywhere-video-active {
      position: fixed !important;
      top: 0 !important;
      left: 0 !important;
      width: 100vw !important;
      height: 100vh !important;
      max-width: 100vw !important;
      max-height: 100vh !important;
      min-width: 100vw !important;
      min-height: 100vh !important;
      z-index: 2147483647 !important;
      background: #000000 !important;
      background-color: #000000 !important;
      object-fit: var(--theater-object-fit, contain) !important;
      opacity: 1 !important;
      pointer-events: auto !important;
      margin: 0 !important;
      padding: 0 !important;
      border: none !important;
      transform: none !important;
      translate: none !important;
      rotate: none !important;
      scale: none !important;
      transform-style: flat !important;
      transition: none !important;
    }
    .theater-everywhere-parent-active {
      position: relative !important;
      overflow: visible !important;
      transform: none !important;
      translate: none !important;
      rotate: none !important;
      scale: none !important;
      transform-style: flat !important;
      filter: none !important;
      perspective: none !important;
      contain: none !important;
      container-type: normal !important;
      backdrop-filter: none !important;
      clip: auto !important;
      clip-path: none !important;
      mask: none !important;
      will-change: auto !important;
      z-index: 2147483647 !important;
    }
    :host-context(html.theater-everywhere-disney-stage) .theater-everywhere-parent-active {
      width: 100% !important;
      height: 100% !important;
      min-width: 100% !important;
      min-height: 100% !important;
      overflow: visible !important;
      background: #000000 !important;
    }
  `;
    shadowRoot.appendChild(styleEl);
  }

  function getVideoMetrics(video: HTMLVideoElement): VideoMetrics {
    const rect = video.getBoundingClientRect();
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight;

    const intersectionLeft = Math.max(rect.left, 0);
    const intersectionRight = Math.min(rect.right, viewportWidth);
    const intersectionTop = Math.max(rect.top, 0);
    const intersectionBottom = Math.min(rect.bottom, viewportHeight);

    const visibleWidth = Math.max(0, intersectionRight - intersectionLeft);
    const visibleHeight = Math.max(0, intersectionBottom - intersectionTop);
    const visibleArea = visibleWidth * visibleHeight;
    const totalArea = rect.width * rect.height;
    const visibleRatio = totalArea > 0 ? visibleArea / totalArea : 0;
    const inViewport = visibleArea > 0 && rect.width > 0 && rect.height > 0;

    const visibleCenterX = intersectionLeft + visibleWidth / 2;
    const visibleCenterY = intersectionTop + visibleHeight / 2;
    const viewportCenterX = viewportWidth / 2;
    const viewportCenterY = viewportHeight / 2;

    const dx = visibleCenterX - viewportCenterX;
    const dy = visibleCenterY - viewportCenterY;
    const distanceToCenter = Math.sqrt(dx * dx + dy * dy);

    const isPlaying = !video.paused && !video.ended && video.readyState > 2;
    const isHovered = video === ctx.refs.activeVideo;

    return {
      inViewport,
      isPlaying,
      isHovered,
      visibleRatio,
      visibleArea,
      distanceToCenter
    };
  }

  function compareVideos(a: HTMLVideoElement, b: HTMLVideoElement): number {
    const aMetrics = getVideoMetrics(a);
    const bMetrics = getVideoMetrics(b);

    if (aMetrics.inViewport !== bMetrics.inViewport) {
      return aMetrics.inViewport ? -1 : 1;
    }

    if (aMetrics.inViewport) {
      if (aMetrics.isPlaying !== bMetrics.isPlaying) {
        return aMetrics.isPlaying ? -1 : 1;
      }
      if (aMetrics.isHovered !== bMetrics.isHovered) {
        return aMetrics.isHovered ? -1 : 1;
      }
      if (Math.abs(aMetrics.visibleRatio - bMetrics.visibleRatio) > 0.2) {
        return aMetrics.visibleRatio > bMetrics.visibleRatio ? -1 : 1;
      }
      if (Math.abs(aMetrics.distanceToCenter - bMetrics.distanceToCenter) > 20) {
        return aMetrics.distanceToCenter < bMetrics.distanceToCenter ? -1 : 1;
      }
      return bMetrics.visibleArea - aMetrics.visibleArea;
    }

    if (aMetrics.isPlaying !== bMetrics.isPlaying) {
      return aMetrics.isPlaying ? -1 : 1;
    }
    if (aMetrics.isHovered !== bMetrics.isHovered) {
      return aMetrics.isHovered ? -1 : 1;
    }
    const aArea = a.offsetWidth * a.offsetHeight;
    const bArea = b.offsetWidth * b.offsetHeight;
    return bArea - aArea;
  }

  function findBestVideo(): HTMLVideoElement | null {
    const videos = findAllVideosDeep(document);
    if (videos.length === 0) return null;
    const pool = selectSwitchableVideos(videos);
    const ranked = pool.length > 0 ? pool : videos;
    if (ranked.length === 1) return ranked[0];

    ranked.sort(compareVideos);
    return ranked[0];
  }

  function switchTheaterVideo(newVideo: HTMLVideoElement): void {
    if (!ctx.session.element || ctx.session.element === newVideo) return;

    if (ctx.session.element.tagName === 'VIDEO') {
      const video = ctx.session.element as HTMLVideoElement;
      video.pause();
      const originalControls = video.dataset.originalControls;
      if (originalControls === 'true') {
        video.setAttribute('controls', 'true');
      } else {
        video.removeAttribute('controls');
      }
      delete video.dataset.originalControls;

      const eventTypes = ['click', 'dblclick', 'mousedown', 'mouseup', 'pointerdown', 'pointerup'];
      eventTypes.forEach(type => {
        video.removeEventListener(type, ctx.actions.preventDoubleToggle, true);
      });

      ctx.actions.destroyCustomControls();
      video.classList.remove('controls-visible');
      video.classList.remove('theater-everywhere-video-active');
      ctx.actions.restoreTheaterElementInlineStyles(video);
    } else {
      ctx.session.element.classList.remove('theater-everywhere-video-active');
      ctx.actions.restoreTheaterElementInlineStyles(ctx.session.element);
    }

    ctx.session.rebind(newVideo, ctx.session.id || undefined, ctx.session.nonce || undefined);
    ctx.session.activate();

    const rootNode = newVideo.getRootNode();
    if (rootNode instanceof ShadowRoot) {
      injectStylesIntoShadowRoot(rootNode);
    }
    newVideo.classList.add('theater-everywhere-video-active');
    ctx.actions.applyTheaterElementInlineStyles(newVideo);

    const originalControls = newVideo.hasAttribute('controls');
    newVideo.dataset.originalControls = originalControls ? 'true' : 'false';
    newVideo.removeAttribute('controls');

    if (newVideo.readyState === 0 && ctx.mediaHasSource(newVideo)) {
      newVideo.preload = 'auto';
      newVideo.load();
    }

    ctx.requestVideoPlay(newVideo);

    const eventTypes = ['click', 'dblclick', 'mousedown', 'mouseup', 'pointerdown', 'pointerup'];
    eventTypes.forEach(type => {
      newVideo.addEventListener(type, ctx.actions.preventDoubleToggle, true);
    });

    ctx.actions.createCustomControls(newVideo);

    ctx.refs.ancestorsList.forEach(parent => {
      if (parent && parent.classList) {
        parent.classList.remove('theater-everywhere-parent-active');
      }
    });
    ctx.refs.ancestorsList = [];

    let parent: Node | null = newVideo.parentNode;
    while (parent && parent !== document.documentElement) {
      if (parent instanceof ShadowRoot) {
        injectStylesIntoShadowRoot(parent);
        parent = parent.host;
      } else {
        if (parent instanceof HTMLElement) {
          parent.classList.add('theater-everywhere-parent-active');
          ctx.refs.ancestorsList.push(parent);
        }
        parent = parent.parentNode;
      }
    }

    ctx.refs.activeVideo = newVideo;
  }

  function cycleTheaterVideo(direction: 'next' | 'prev' = 'next'): void {
    if (!ctx.session.element) return;

    if (ctx.session.element.tagName !== 'VIDEO') {
      ctx.actions.triggerStatusIndicator(ctx.t('cycleIframeHud'), STATUS_HUD_SWITCH_ICON);
      return;
    }

    const currentVideo = ctx.session.element as HTMLVideoElement;
    const videos = selectSwitchableVideos(findAllVideosDeep(document), currentVideo);
    if (videos.length <= 1) {
      ctx.actions.triggerStatusIndicator(ctx.t('onlyOneVideoHud'), STATUS_HUD_SWITCH_ICON);
      return;
    }

    const idx = videos.indexOf(currentVideo);
    if (idx === -1) return;

    let nextIdx;
    if (direction === 'next') {
      nextIdx = (idx + 1) % videos.length;
    } else {
      nextIdx = (idx - 1 + videos.length) % videos.length;
    }

    const nextVideo = videos[nextIdx];
    if (nextVideo && nextVideo !== currentVideo) {
      switchTheaterVideo(nextVideo);
    }
  }

  return {
    findAllVideosDeep,
    findBestVideo,
    switchTheaterVideo,
    cycleTheaterVideo,
    injectStylesIntoShadowRoot
  };
}
