import { DisposableScope } from '../core/disposable-scope';
import type { PlaybackSurface } from '../playback-surface';

/** Removes the temporary media listener as soon as seek, timeout or exit wins. */
export function waitForSeekCompletion(
  scope: DisposableScope,
  video: PlaybackSurface,
  complete: () => void
): void {
  const finish = () => {
    if (scope.isDisposed) return;
    scope.dispose();
    complete();
  };
  video.addEventListener('seeked', finish);
  scope.add(() => video.removeEventListener('seeked', finish));
  scope.timeout(finish, 150);
}
