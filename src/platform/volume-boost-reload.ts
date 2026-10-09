import { DisposableScope } from '../core/disposable-scope';

/** CORS is retained after success for Web Audio; cancellation restores only our attribute. */
export function reloadForVolumeBoost(
  video: HTMLVideoElement,
  options: { signal: AbortSignal; isCurrent(): boolean; canResume(): boolean }
): () => void {
  if (video.crossOrigin || video.srcObject || !(video.currentSrc || video.src) || options.signal.aborted) return () => {};
  const scope = new DisposableScope();
  const savedTime = video.currentTime;
  const wasPlaying = !video.paused;
  const originalCors = video.getAttribute('crossorigin');
  const source = () => JSON.stringify([
    video.getAttribute('src'),
    Array.from(video.querySelectorAll('source')).map(node => [node.getAttribute('src'), node.getAttribute('type'), node.getAttribute('media')])
  ]);
  const originalSource = source();
  const originalCurrentSrc = video.currentSrc || video.src;
  let phase: 'cors' | 'fallback' | 'done' = 'cors';
  const ownsCors = () => video.getAttribute('crossorigin') === 'anonymous';
  const restoreCors = () => {
    if (!ownsCors()) return;
    if (originalCors === null) video.removeAttribute('crossorigin');
    else video.setAttribute('crossorigin', originalCors);
  };
  const cancel = () => {
    if (phase !== 'done') restoreCors();
    phase = 'done';
    scope.dispose();
  };
  const current = () => !scope.isDisposed && !options.signal.aborted && options.isCurrent()
    && video.srcObject === null && source() === originalSource
    && (phase === 'cors' ? ownsCors() : video.getAttribute('crossorigin') === originalCors);
  scope.listen(options.signal, 'abort', cancel, { once: true });
  scope.listen(video, 'canplay', () => {
    if (!current() || (video.currentSrc && video.currentSrc !== originalCurrentSrc)) {
      cancel();
      return;
    }
    phase = 'done';
    scope.dispose();
    if (Number.isFinite(savedTime)) video.currentTime = savedTime;
    if (wasPlaying && options.canResume()) void video.play().catch(() => {});
  });
  scope.listen(video, 'error', () => {
    if (!current() || phase === 'fallback') {
      cancel();
      return;
    }
    restoreCors();
    phase = 'fallback';
    // Keep the host's source selection (including <source> children) intact.
    video.load();
  });
  if (typeof MutationObserver === 'function') {
    const observer = new MutationObserver(() => { if (!current()) cancel(); });
    observer.observe(video, { attributes: true, attributeFilter: ['src', 'crossorigin', 'type', 'media'], childList: true, subtree: true });
    scope.add(() => observer.disconnect());
  }
  video.crossOrigin = 'anonymous';
  try {
    video.load();
  } catch {
    cancel();
  }
  return cancel;
}
