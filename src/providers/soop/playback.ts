import { SOOP_PLAYER_SELECTOR, soopRoute } from './dom';

/** MAIN-world, document lifetime; the host alone owns loading the broadcast and its terms dialog. */
export function installSoopPlayback(): () => void {
  const onPlay = (event: Event): void => {
    const video = event.target;
    if (!(video instanceof HTMLVideoElement) || video.id !== 'livePlayer'
      || !video.matches('.theater-everywhere-video-active')
      || !video.currentSrc.startsWith('data:video/')) return;
    if (soopRoute(new URL(location.href))?.kind !== 'live') return;
    const player = video.closest(SOOP_PLAYER_SELECTOR);
    if (!player?.classList.contains('play_start')
      || player.querySelector('video#livePlayer') !== video) return;
    const overlay = player.querySelector<HTMLElement>('.nextvideo');
    if (!overlay || overlay.hidden || overlay.style.display === 'none') return;
    // play() succeeds on SOOP's 0.128 s placeholder without loading the stream. The overlay's
    // handler hides itself, plays the placeholder and requests the broadcast through the host.
    overlay.click();
  };
  document.addEventListener('play', onPlay, true);
  return () => document.removeEventListener('play', onPlay, true);
}
