import { afterEach } from 'vitest';

import { languageRuntime } from '../src/i18n-runtime';

import { setSyncStorage } from './chrome-stub';
import type { HudStage } from './hud-stage';
import { renderHud, type Hud, type HudArgs, type HudStoryOptions } from './hud-story';
import { renderNotice, type NoticeArgs } from './notice-story';
import './preview';
import { disposeStage } from './stage-owner';
import { renderStepper, type StepperArgs } from './stepper-story';

// These are executable lifecycle cases, deliberately outside Storybook's visual index.
// They use the same render/stage helpers; there is no second component renderer.
export interface HudCase {
  render(args: HudArgs): HTMLElement;
  play?: () => Promise<void>;
  args?: Partial<HudArgs>;
  globals?: { locale?: string; reduceMotion?: string };
  tags?: string[];
}
export function hudCase(
  trigger: (hud: Hud, stage: HudStage) => void,
  story: Omit<Partial<HudCase>, 'render'> = {},
  options: HudStoryOptions = {}
): HudCase {
  return { ...story, render: args => renderHud(args, trigger, options) };
}
async function prepare(globals: HudCase['globals']): Promise<void> {
  setSyncStorage({ reduceMotion: globals?.reduceMotion ?? 'off' });
  await languageRuntime.set(globals?.locale ?? 'en');
  await Promise.all(['400', '500', '600', '700'].map(weight => document.fonts.load(`${weight} 16px Roboto`)));
}
export async function runHudCase(story: HudCase): Promise<void> {
  await prepare(story.globals);
  story.render({ phase: 'steady', live: false, ...story.args });
  await story.play?.();
}
export interface NoticeCase {
  globals?: HudCase['globals'];
  args?: Partial<NoticeArgs>;
  play?: () => Promise<void>;
}
export async function runNoticeCase(story: NoticeCase): Promise<void> {
  await prepare(story.globals);
  renderNotice({ remainingMs: 4500, ringTurn: 'uniform', progress: 0.5, ...story.args });
  await story.play?.();
}
export interface StepperCase {
  globals?: HudCase['globals'];
  args?: Partial<StepperArgs>;
  play?: () => Promise<void>;
}
export async function runStepperCase(story: StepperCase): Promise<void> {
  await prepare(story.globals);
  renderStepper({ count: 5, index: 2, ...story.args });
  await story.play?.();
}
afterEach(disposeStage);
