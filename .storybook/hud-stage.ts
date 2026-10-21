import type { HudHost } from '../src/ui/hud';
import { t } from '../src/ui/messages';
import { mountPlayerUi, queryPlayerUi, getPlayerUiRoot } from '../src/ui/root';
import type { UiClock } from '../src/ui/ui-clock';

import { paintOverlay } from './player-stage';
import { beginStage } from './stage-owner';

/** A clock the story advances by hand: timers run in due order, including ones scheduled meanwhile. */
export interface ManualClock extends UiClock {
  readonly now: number;
  /** Timers scheduled and not yet fired or cleared. */
  readonly pending: number;
  advance(ms: number): void;
  clear(): void;
}

export function manualClock(): ManualClock {
  let now = 0;
  let nextId = 1;
  const timers = new Map<number, { due: number; handler: () => void }>();
  return {
    get now() { return now; },
    get pending() { return timers.size; },
    setTimeout(handler, delayMs) {
      const id = nextId++;
      timers.set(id, { due: now + Math.max(0, delayMs), handler });
      return id;
    },
    clearTimeout(id) {
      if (id !== undefined) timers.delete(id);
    },
    clear: () => timers.clear(),
    advance(ms) {
      const end = now + ms;
      for (;;) {
        let next: [number, { due: number; handler: () => void }] | undefined;
        for (const entry of timers) if (entry[1].due <= end && (!next || entry[1].due < next[1].due)) next = entry;
        if (!next) break;
        timers.delete(next[0]);
        now = Math.max(now, next[1].due);
        next[1].handler();
      }
      now = end;
    }
  };
}

declare global {
  interface Window {
    /** Moves every running animation to this fraction of its first iteration and holds it there. */
    __storyFrame?: (progress: number) => number;
    /** The fractions worth shooting for this story, when the default sweep misses its motion. */
    __storyFrames?: readonly number[];
  }
}

/** The page's animations and those inside the player UI's shadow root. */
function pageAnimations(): Animation[] {
  return [...new Set([...document.getAnimations(), ...getPlayerUiRoot().getAnimations()])];
}

/**
 * Pins every animation and transition on the page to `progress` of its first iteration, so a frame
 * is the same on every run. Styles are flushed first: a class added a moment ago has not started
 * its transition until they are. Returns how many animations were pinned.
 */
export function freezeAnimations(progress: number): number {
  void document.documentElement.getBoundingClientRect();
  const animations = pageAnimations();
  for (const animation of animations) {
    const timing = animation.effect?.getComputedTiming();
    animation.pause();
    animation.currentTime = Number(timing?.delay ?? 0) + progress * Number(timing?.duration ?? 0);
  }
  return animations.length;
}

/** Animations still alive on the page, running or held. */
export function activeAnimationCount(): number {
  return pageAnimations().length;
}

/** Elements under the player UI root, the stylesheet and the live region excluded. */
export function uiNodeCount(): number {
  return getPlayerUiRoot().querySelectorAll('*:not(style):not(#theater-announcements)').length;
}

export interface HudStage {
  view: HTMLElement;
  readonly disposed: boolean;
  clock: ManualClock;
  host: HudHost;
  /** The session the HUDs guard on; replace `element` or bump `currentEpoch` to make work stale. */
  session: { element: HTMLElement | null; currentEpoch: number };
  /** Advances the clock, then holds any animation that started on the way at the stage's progress. */
  advance(ms: number): void;
  /** Holds animations at `progress` now, and for `window.__storyFrame`. */
  settle(): void;
  /** Runs when the next story replaces this stage, as theater exit tears the player UI down. */
  onDispose(cleanup: () => void): void;
}

/**
 * Starts a player UI for HUD stories: the real shadow root and mount, a session element standing in
 * for the playing video, and a clock the story owns. The previous story's UI is destroyed first.
 * With `progress`, animations are held at that fraction (a deterministic frame); without it they run.
 */
export function mountHudStage(options: { progress?: number; boostReady?: boolean; frames?: readonly number[] } = {}): HudStage {
  const { scope, view } = beginStage();
  const clock = manualClock();
  const video = document.createElement('video');
  video.dataset.theaterBoostReady = String(options.boostReady ?? false);
  const session = { element: video as HTMLElement | null, currentEpoch: 1 };
  scope.add(() => { session.currentEpoch += 1; session.element = null; clock.clear(); });
  let progress = options.progress;
  const settle = () => { if (!scope.isDisposed && progress !== undefined) freezeAnimations(progress); };
  window.__storyFrames = options.frames;
  window.__storyFrame = value => {
    if (scope.isDisposed) return 0;
    progress = value;
    return freezeAnimations(value);
  };
  scope.add(() => { delete window.__storyFrame; delete window.__storyFrames; });
  const stage: HudStage = {
    view,
    get disposed() { return scope.isDisposed; },
    clock,
    session,
    host: {
      session,
      queryPlayerUi: queryPlayerUi as HudHost['queryPlayerUi'],
      mountPlayerUi,
      paintOverlay,
      t,
      ui: () => ({ toolbarVisible: true })
    },
    advance: ms => { if (!scope.isDisposed) { clock.advance(ms); settle(); } },
    settle,
    onDispose: cleanup => { scope.add(cleanup); }
  };
  return stage;
}
