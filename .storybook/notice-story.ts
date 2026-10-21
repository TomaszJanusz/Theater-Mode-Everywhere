import type { StoryObj } from '@storybook/html-vite';

import { showAutoTheaterNotice, type CountdownRingTurn } from '../src/ui/auto-theater-notice';
import { queryPlayerUi } from '../src/ui/root';

import { mountHudStage, type HudStage } from './hud-stage';

export interface NoticeArgs {
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
  const stage = mountHudStage({ progress: args.progress, frames: args.frames });
  let remaining = args.remainingMs;
  const cancel = { calls: 0 };
  const stop = showAutoTheaterNotice(
    stage.host.paintOverlay, () => { cancel.calls += 1; }, () => remaining, args.ringTurn, undefined, stage.clock
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
  stage.settle();
  return stage.view;
}

export const notice = (): HTMLElement | null => queryPlayerUi<HTMLElement>(NOTICE);
/** The digit currently shown, not one rolling out. */
export const digit = (): string | null | undefined =>
  notice()?.querySelector('.theater-time-glyph:not(.is-leaving)')?.textContent;
