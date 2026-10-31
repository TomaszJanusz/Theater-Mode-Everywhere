import type { Meta, StoryObj } from '@storybook/html-vite';
import { expect } from 'storybook/test';

import { activeAnimationCount, mountHudStage, uiNodeCount, type HudStage } from '../../.storybook/hud-stage';
import { DisposableScope } from '../core/disposable-scope';

import { ENDED_CURTAIN_CLASS, ENDED_CURTAIN_DELAY_MS, mountEndedCurtain, REPLAY_ICON } from './ended-curtain';
import { t } from './messages';
import { getPlayerUiRoot, queryPlayerUi } from './root';
import { setSvgIcon } from './svg-icon';

interface Args {
  /** Playlist navigation offers a next item, so the bar shows Next and the curtain mirrors it. */
  next: boolean;
}

// Shapes of the bar's own play and Next icons (controls.ts); the curtain clones whatever the bar shows.
const PLAY_ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>';
const NEXT_ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M5 4 15.5 12 5 20z"/><rect x="17.8" y="3" width="2.2" height="18" rx="0.4"/></svg>';

/** Media the story drives by hand; each change fires the event an element would. */
class StoryMedia extends EventTarget {
  ended = false;
  duration = 2;
  emit(type: string, ended: boolean): void {
    this.ended = ended;
    this.dispatchEvent(new Event(type));
  }
}

interface Mounted { stage: HudStage; media: StoryMedia; scope: DisposableScope; play: HTMLButtonElement; reports: boolean[] }
let active: Mounted | undefined;

/** The curtain on a manual clock, with the bar controls it mirrors (play, which turns into Replay, and Next). */
function render({ next }: Args, options: { progress?: number; end?: boolean }): HTMLElement {
  const stage = mountHudStage({ progress: options.progress, frames: [0, 0.5, 1] });
  const scope = new DisposableScope();
  stage.onDispose(() => { scope.dispose(); active = undefined; });
  const media = new StoryMedia();
  const button = (label: string, icon: string, hidden = false) => {
    const element = document.createElement('button');
    element.className = 'theater-control-btn';
    element.setAttribute('aria-label', label);
    element.hidden = hidden;
    setSvgIcon(element, icon);
    return element;
  };
  const play = button(t('play'), PLAY_ICON);
  const reports: boolean[] = [];
  mountEndedCurtain(stage.host, scope, media, [play, button(t('nextVideo'), NEXT_ICON, !next)], shown => {
    reports.push(shown);
    play.setAttribute('aria-label', t(shown ? 'replay' : 'play'));
    setSvgIcon(play, shown ? REPLAY_ICON : PLAY_ICON);
  }, stage.clock);
  active = { stage, media, scope, play, reports };
  if (options.end ?? true) {
    media.emit('ended', true);
    stage.advance(ENDED_CURTAIN_DELAY_MS);
  }
  stage.settle();
  return stage.view;
}

const curtain = () => queryPlayerUi<HTMLElement>(`.${ENDED_CURTAIN_CLASS}`);
const labels = () => [...curtain()?.querySelectorAll('button') ?? []].map(button => button.getAttribute('aria-label'));

const meta: Meta<Args> = {
  title: 'Components/Ended curtain', tags: ['frames'], args: { next: false },
  argTypes: { next: { control: 'boolean' } },
  render: args => render(args, { progress: 1 })
};
export default meta;

/** The fade over the last frame: the picture goes black and Replay sits in the middle. */
export const Replay: StoryObj<Args> = {
  play: async () => {
    await expect(labels()).toEqual([t('replay')]);
    await expect(active?.reports).toEqual([true]);
  }
};

/** Playlist navigation offers a next item, so Next sits beside Replay. */
export const ReplayAndNext: StoryObj<Args> = {
  args: { next: true },
  play: async () => {
    await expect(labels()).toEqual([t('replay'), t('nextVideo')]);
  }
};

/** Reduce motion: the curtain is there at once, with nothing left to animate. */
export const ReducedMotion: StoryObj<Args> = {
  tags: ['no-shot'],
  render: args => {
    const view = render(args, { end: false });
    const host = getPlayerUiRoot().host as HTMLElement;
    host.dataset.motion = 'reduced';
    const { stage, media } = active!;
    stage.onDispose(() => { delete host.dataset.motion; });
    media.emit('ended', true);
    stage.advance(ENDED_CURTAIN_DELAY_MS);
    return view;
  },
  play: async () => {
    const timing = curtain()?.getAnimations()[0]?.effect?.getComputedTiming();
    await expect(Number(timing?.duration ?? 0)).toBeLessThan(1);
  }
};

/** Lifecycle: the grace, a hand-off inside it, replay and a seek back, a new end, and teardown. */
export const Lifecycle: StoryObj<Args> = {
  tags: ['no-shot'],
  args: { next: true },
  render: args => render(args, { end: false }),
  play: async () => {
    const { stage, media, scope, reports } = active!;
    const before = uiNodeCount();
    media.emit('ended', true);
    stage.advance(ENDED_CURTAIN_DELAY_MS - 1);
    await expect(curtain()).toBeNull();
    // The host loads its next item inside the grace: nothing flashes.
    media.emit('loadstart', false);
    stage.advance(ENDED_CURTAIN_DELAY_MS);
    await expect(curtain()).toBeNull();
    media.emit('ended', true);
    stage.advance(ENDED_CURTAIN_DELAY_MS);
    await expect(curtain()).not.toBeNull();
    // Replay seeks the ended media to the start.
    media.emit('seeking', false);
    await expect(curtain()).toBeNull();
    media.emit('ended', true);
    stage.advance(ENDED_CURTAIN_DELAY_MS);
    await expect(labels()).toEqual([t('replay'), t('nextVideo')]);
    scope.dispose();
    await expect(curtain()).toBeNull();
    await expect(uiNodeCount()).toBe(before);
    await expect(stage.clock.pending).toBe(0);
    await expect(activeAnimationCount()).toBe(0);
    await expect(reports).toEqual([true, false, true, false]);
  }
};
