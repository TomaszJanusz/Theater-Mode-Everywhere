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
          // `.ytp-button` supplies the size; its colour is #eee, while native icons hard-code white, so set white here.
          // The right cluster is a line-height:56px flex row with align-items:flex-end, so a centred flex box
          // with an explicit 24px mark is the only layout that lands on the native centre line at any player size.
          // Assign, never replace cssText: the shared launcher already set its accent and fade tokens inline.
          Object.assign(button.style, {
            display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#fff',
            background: 'transparent', border: '0', padding: '0', verticalAlign: 'top', cursor: 'pointer'
          });
          const svg = button.querySelector('svg');
          if (svg) svg.style.cssText = 'width:24px;height:24px;display:block;flex:none;fill:currentColor;pointer-events:none';
          before.before(button);
        }
      };
    },
    dispose() { disposed = true; observer.disconnect(); player = null; }
  };
};
