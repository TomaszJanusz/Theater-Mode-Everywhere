import type { LauncherPlacementFactory } from '../launcher-placement';

/** Never rearrange host or extension controls: insert only against the live autoplay anchor. */
export const youtubeLauncherPlacement: LauncherPlacementFactory = (video, onChange) => {
  let player: Element | null = null;
  let disposed = false;
  const observer = new MutationObserver(() => { if (!disposed) onChange(); });
  return {
    read() {
      if (disposed || !video.isConnected) return null;
      const current = video.closest('.html5-video-player');
      if (current !== player) {
        observer.disconnect();
        player = current;
        if (player) observer.observe(player, { childList: true, subtree: true });
      }
      if (!player || player.querySelector('video') !== video) return null;
      const toggle = player.querySelector<HTMLElement>('.ytp-right-controls .ytp-autonav-toggle-button');
      const before = toggle?.closest<HTMLElement>('button');
      if (!before) return null;
      return {
        before,
        persistent: true,
        mount(button) {
          button.classList.add('ytp-button');
          // YT's control class supplies color (normally white), including theme overrides.
          button.style.cssText = 'background:transparent;border:0;padding:0;vertical-align:top;cursor:pointer';
          const svg = button.querySelector('svg');
          if (svg) svg.style.cssText = 'width:24px;height:100%;display:block;margin:auto;fill:currentColor;pointer-events:none';
          before.before(button);
        }
      };
    },
    dispose() { disposed = true; observer.disconnect(); player = null; }
  };
};
