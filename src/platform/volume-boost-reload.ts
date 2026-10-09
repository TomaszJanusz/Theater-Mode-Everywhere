import { DisposableScope } from '../core/disposable-scope';

/** CORS stays after success for Web Audio. Cancelling an in-flight CORS load reloads without it. */
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
  const cancel = (recoverLoad: boolean) => {
    const loadInFlight = phase === 'cors' && ownsCors();
    if (phase !== 'done') restoreCors();
    phase = 'done';
    scope.dispose();
    // load() pauses the media and resets its position, so the replacement
    // request needs its own canplay handler after the scoped listener is gone.
    if (!recoverLoad || !loadInFlight || video.srcObject !== null || source() !== originalSource
      || video.getAttribute('crossorigin') !== originalCors) return;
    const stop = () => {
      video.removeEventListener('canplay', recover);
      video.removeEventListener('error', stop);
    };
    const recover = () => {
      stop();
      if (video.srcObject !== null || source() !== originalSource
        || video.getAttribute('crossorigin') !== originalCors) return;
      if (video.currentSrc && video.currentSrc !== originalCurrentSrc) return;
      if (Number.isFinite(savedTime)) video.currentTime = savedTime;
      if (wasPlaying && options.canResume()) void video.play().catch(() => {});
    };
    video.addEventListener('canplay', recover);
    video.addEventListener('error', stop);
    try { video.load(); } catch { stop(); }
  };
  const current = () => !scope.isDisposed && !options.signal.aborted && options.isCurrent()
    && video.srcObject === null && source() === originalSource
    && (phase === 'cors' ? ownsCors() : video.getAttribute('crossorigin') === originalCors);
  scope.listen(options.signal, 'abort', () => cancel(true), { once: true });
  scope.listen(video, 'canplay', () => {
    if (!current() || (video.currentSrc && video.currentSrc !== originalCurrentSrc)) {
      cancel(false);
      return;
    }
    phase = 'done';
    scope.dispose();
    if (Number.isFinite(savedTime)) video.currentTime = savedTime;
    if (wasPlaying && options.canResume()) void video.play().catch(() => {});
  });
  scope.listen(video, 'error', () => {
    if (!current() || phase === 'fallback') {
      cancel(false);
      return;
    }
    restoreCors();
    phase = 'fallback';
    // Keep the host's source selection (including <source> children) intact.
    video.load();
  });
  if (typeof MutationObserver === 'function') {
    const observer = new MutationObserver(() => { if (!current()) cancel(false); });
    observer.observe(video, { attributes: true, attributeFilter: ['src', 'crossorigin', 'type', 'media'], childList: true, subtree: true });
    scope.add(() => observer.disconnect());
  }
  video.crossOrigin = 'anonymous';
  try {
    video.load();
  } catch {
    cancel(false);
  }
  return () => cancel(true);
}
