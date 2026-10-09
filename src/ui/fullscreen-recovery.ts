import { DisposableScope } from '../core/disposable-scope';
import type { PlaybackSurface } from '../playback-surface';

/** Fullscreen can pause native playback; recovery belongs to that one request. */
export function createFullscreenRecovery(
  owner: DisposableScope,
  video: PlaybackSurface,
  isCurrentMedia: () => boolean,
  playbackDecisionRevision: () => number
) {
  let active: { scope: DisposableScope; schedule: (delay: number) => void } | null = null;
  const invalidate = () => {
    active?.scope.dispose();
    active = null;
  };
  owner.add(invalidate);

  function begin() {
    invalidate();
    const scope = new DisposableScope();
    const wasPlaying = !video.paused;
    const revision = playbackDecisionRevision();
    const native = video.nativeMedia;
    const source = native?.currentSrc;
    const sourceAttribute = native?.getAttribute('src');
    const sourceObject = native?.srcObject;
    const current = () => !owner.isDisposed && !scope.isDisposed && isCurrentMedia()
      && revision === playbackDecisionRevision() && native?.currentSrc === source
      && native?.getAttribute('src') === sourceAttribute && native?.srcObject === sourceObject;
    let scheduled = false;
    const operation = {
      scope,
      isCurrent: current,
      schedule(delay = 150) {
        if (!current() || scheduled) return;
        scheduled = true;
        scope.timeout(() => {
          if (current() && wasPlaying && video.paused) {
            try { void video.play().catch(console.error); } catch (error) { console.error(error); }
          }
          scope.dispose();
          if (active === operation) active = null;
        }, delay);
      },
      cancel() {
        scope.dispose();
        if (active === operation) active = null;
      }
    };
    active = operation;
    return operation;
  }

  return { begin, invalidate, onFullscreenChange: () => active?.schedule(50) };
}
