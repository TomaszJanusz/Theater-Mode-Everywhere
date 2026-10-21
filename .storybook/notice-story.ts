import type { StoryObj } from '@storybook/html-vite';

import { showAutoTheaterNotice, type CountdownRingTurn } from '../src/ui/auto-theater-notice';
import { queryPlayerUi } from '../src/ui/root';

import { mountHudStage, type HudStage } from './hud-stage';
import type { Phase } from './hud-story';

export interface NoticeArgs {
  /** Internal projection of the opt-in timeline global; not component Controls. */
  phase?: Phase;
  live?: boolean;
  /** Time left on the intent's own clock when the notice appears. */
  remainingMs: number;
  ringTurn: CountdownRingTurn;
  /** Held at this fraction of each animation's first iteration; the shots script sweeps it. */
  progress: number;
  frames?: readonly number[];
}

export type NoticeStoryObj = StoryObj<NoticeArgs>;

export const NOTICE = '.theater-auto-notice';

/** The countdown a story drives by hand: the intent's clock and the UI timers move together. */
export interface NoticeRun {
  stage: HudStage;
  cancel: { calls: number };
  /** Lets `ms` pass in small steps so each timer re-reads the clock as it would in real time. */
  elapse(ms: number): void;
  remaining(): number;
  stop(): void;
}

let current: NoticeRun | undefined;
export const run = (): NoticeRun => current!;

export function renderNotice(args: NoticeArgs): HTMLElement {
  const phaseIndex = args.phase === 'entering' ? 0 : args.phase === 'leaving' ? 2 : 1;
  const progress = args.phase ? (args.frames ?? [0.5, 1, 0.5])[phaseIndex] : args.progress;
  const stage = mountHudStage({ progress: args.live ? undefined : progress, frames: args.frames });
  const started = performance.now();
  let remaining = args.remainingMs;
  const cancel = { calls: 0 };
  const stop = showAutoTheaterNotice(
    stage.host.paintOverlay, () => { cancel.calls += 1; }, () => args.live ? Math.max(0, args.remainingMs - (performance.now() - started)) : remaining,
    args.ringTurn, undefined, args.live ? undefined : stage.clock
  );
  stage.onDispose(stop);
  current = {
    stage, cancel, stop,
    remaining: () => remaining,
    elapse(ms) {
      if (stage.disposed) return;
      for (let left = ms; left > 0; left -= 50) {
        const step = Math.min(50, left);
        remaining = Math.max(0, remaining - step);
        stage.clock.advance(step);
      }
      stage.settle();
    }
  };
  if (!args.live && args.phase === 'leaving') current.elapse(Math.max(0, args.remainingMs - 900));
  stage.settle();
  return stage.view;
}

export const notice = (): HTMLElement | null => queryPlayerUi<HTMLElement>(NOTICE);
/** The digit currently shown, not one rolling out. */
export const digit = (): string | null | undefined =>
  notice()?.querySelector('.theater-time-glyph:not(.is-leaving)')?.textContent;
