import type { Meta, StoryObj } from '@storybook/html-vite';
import { expect } from 'storybook/test';

import { mountHudStage } from '../../../.storybook/hud-stage';
import { DisposableScope } from '../../core/disposable-scope';
import type { EndScreenSource } from '../../core/end-screen';
import { ENDED_CURTAIN_DELAY_MS, mountEndedCurtain, REPLAY_ICON } from '../../ui/ended-curtain';
import { t } from '../../ui/messages';
import { queryPlayerUi } from '../../ui/root';
import { setSvgIcon } from '../../ui/svg-icon';

import type { EndScreenItem } from './end-screen-model';
import { renderEndScreen } from './end-screen-view';

interface Args { count: number; missingThumbnail: boolean }

/** Illustrative story content; the renderer, stylesheet, curtain and shadow root are production code. */
const items: readonly EndScreenItem[] = [
  { id: 'one', href: '/one', kind: 'video', title: 'A quiet journey through the mountains — a long title that wraps onto two lines', channel: 'Open landscapes', meta: '125K views • 2 weeks ago', durationText: '18:06' },
  { id: 'two', href: '/two', kind: 'video', title: 'The night sky above us', channel: 'After dark', meta: '1M views • 1 year ago', durationText: '1:01:17' },
  { id: 'three', href: '/three', kind: 'video', title: 'Small moments by the sea', channel: 'Coastal stories', meta: '48K views • 3 days ago', durationText: '6:43' }
];
const image = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="480" height="270"><rect width="480" height="270" fill="#263845"/><path d="M0 240L150 65L270 200L350 120L480 270H0" fill="#557064"/></svg>');

function render({ count, missingThumbnail }: Args): HTMLElement {
  const stage = mountHudStage({ progress: 0.5, frames: [0, 0.5, 1] });
  const scope = new DisposableScope();
  stage.onDispose(() => scope.dispose());
  const media = Object.assign(new EventTarget(), { ended: true, duration: 2 });
  const replay = document.createElement('button');
  replay.setAttribute('aria-label', t('replay'));
  setSvgIcon(replay, REPLAY_ICON);
  const source: EndScreenSource = {
    mount(container, owner, label) {
      const grid = renderEndScreen({ read: () => ({ mediaId: 'story',
        items: items.slice(0, count).map(item => ({ ...item, thumbnailUrl: missingThumbnail ? undefined : image })) }),
      activate: () => true }, label, owner);
      if (grid) container.append(grid);
      owner.add(() => grid?.remove());
    },
    hostEndsPlayback: () => false, subscribe: () => () => {}, dispose() {}
  };
  mountEndedCurtain(stage.host, scope, media, [replay], () => {}, stage.clock, source);
  stage.advance(ENDED_CURTAIN_DELAY_MS);
  stage.settle();
  return stage.view;
}

const meta: Meta<Args> = {
  title: 'Components/YouTube end screen', tags: ['frames'], args: { count: 3, missingThumbnail: false }, render
};
export default meta;

export const ThreeSuggestions: StoryObj<Args> = { play: async () => {
  await expect(queryPlayerUi('.theater-end-screen')?.querySelectorAll('button').length).toBe(3);
} };
export const TwoSuggestions: StoryObj<Args> = { args: { count: 2 } };
export const OneSuggestion: StoryObj<Args> = { args: { count: 1 } };
export const MissingThumbnails: StoryObj<Args> = { args: { missingThumbnail: true }, play: async () => {
  await expect(queryPlayerUi('.theater-end-screen')?.querySelector('img')).toBeNull();
} };
