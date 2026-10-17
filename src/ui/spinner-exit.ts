import { isMotionReduced } from '../appearance-runtime';

export const SPINNER_DEADLINE_START_MS = 1000;
export const SPINNER_DEADLINE_END_MS = 500;
export const SPINNER_PASSIVE_EXIT_MS = 500;

type ExitMode = { mode: 'passive' } | { mode: 'deadline'; remainingMs: () => number };

/** Owns one exit, including its deadline alarm, motion subscription and reveal.
 * Scale is independent of transform so the existing rotating ring keeps spinning.
 * Callers cancel before dismissing/replacing their UI; cancelled finishes do nothing.
 */
export function exitSpinner(element: HTMLElement, options: ExitMode & {
  isCurrent?: () => boolean;
  onStart?: () => void;
  onFinish?: () => void;
  reveal?: HTMLElement;
}): () => void {
  let stopped = false;
  let started = false;
  let timer: number | undefined;
  const animations: Animation[] = [];
  const doc = element.ownerDocument;
  const root = element.getRootNode();
  const host = root instanceof ShadowRoot ? root.host : doc.documentElement;
  const reduced = () => host.getAttribute('data-motion') === 'reduced' || isMotionReduced(doc);
  const current = () => element.isConnected && (options.isCurrent?.() ?? true);
  const dispose = () => {
    if (stopped) return;
    stopped = true;
    window.clearTimeout(timer);
    motion.disconnect();
    for (const animation of animations) {
      animation.onfinish = null;
      animation.cancel();
    }
  };
  const finish = () => {
    if (stopped) return;
    const valid = current();
    dispose();
    if (!valid) return;
    element.remove();
    options.onFinish?.();
  };
  const motion = new MutationObserver(() => {
    if (started && reduced()) finish();
  });
  motion.observe(host, { attributes: true, attributeFilter: ['data-motion', 'data-theater-everywhere-motion'] });
  if (host !== doc.documentElement) {
    motion.observe(doc.documentElement, { attributes: true, attributeFilter: ['data-motion', 'data-theater-everywhere-motion'] });
  }
  const start = () => {
    if (stopped) return;
    if (!current()) { dispose(); return; }
    const remaining = options.mode === 'deadline' ? options.remainingMs() : 0;
    if (options.mode === 'deadline' && remaining > SPINNER_DEADLINE_START_MS) {
      timer = window.setTimeout(start, Math.ceil(remaining - SPINNER_DEADLINE_START_MS));
      return;
    }
    started = true;
    options.onStart?.();
    if (reduced() || (options.mode === 'deadline' && remaining <= SPINNER_DEADLINE_END_MS)) {
      finish();
      return;
    }
    const duration = options.mode === 'deadline'
      ? SPINNER_DEADLINE_START_MS - SPINNER_DEADLINE_END_MS : SPINNER_PASSIVE_EXIT_MS;
    const elapsed = options.mode === 'deadline' ? SPINNER_DEADLINE_START_MS - remaining : 0;
    const animation = element.animate([
      { scale: '1', opacity: 1 }, { scale: '0', opacity: 0 }
    ], { duration, easing: 'cubic-bezier(0.4, 0, 0.2, 1)', fill: 'both' });
    animations.push(animation);
    animation.currentTime = elapsed;
    animation.onfinish = finish;
    if (options.reveal) {
      // Keep the language's final width from the start; reveal it as the ring clears.
      const reveal = options.reveal.animate([
        { opacity: 0, translate: '0 3px', offset: 0 },
        { opacity: 0, translate: '0 3px', offset: 0.6 },
        { opacity: 1, translate: '0 0', offset: 1 }
      ], { duration, easing: 'ease-out', fill: 'both' });
      animations.push(reveal);
      reveal.currentTime = elapsed;
    }
  };
  start();
  return dispose;
}
