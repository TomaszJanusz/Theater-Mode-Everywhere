import type { Meta, StoryObj } from '@storybook/html-vite';
import { expect, waitFor } from 'storybook/test';

import { mountHudStage } from '../../../.storybook/hud-stage';
import { DisposableScope } from '../../core/disposable-scope';
import type { EndScreenSource } from '../../core/end-screen';
import { CaptionRenderer } from '../../media-features/caption-renderer';
import { ENDED_CURTAIN_DELAY_MS, mountEndedCurtain, REPLAY_ICON } from '../../ui/ended-curtain';
import { t } from '../../ui/messages';
import { queryPlayerUi } from '../../ui/root';
import { setSvgIcon } from '../../ui/svg-icon';

import type { EndScreenItem } from './end-screen-model';
import { mountEndScreenSettings } from './end-screen-view';
import { createYouTubeSettings } from './settings';

interface Args { count: number; missingThumbnail: boolean; recommendations: boolean; captions: boolean }

/** Illustrative story content; the renderer, stylesheet, curtain and shadow root are production code. */
const items: readonly EndScreenItem[] = [
  { id: 'one', href: '/one', kind: 'video', title: 'A quiet journey through the mountains — a long title that wraps onto two lines', channel: 'Open landscapes', meta: '125K views • 2 weeks ago', durationText: '18:06' },
  { id: 'two', href: '/two', kind: 'video', title: 'The night sky above us', channel: 'After dark', meta: '1M views • 1 year ago', durationText: '1:01:17' },
  { id: 'three', href: '/three', kind: 'video', title: 'Small moments by the sea', channel: 'Coastal stories', meta: '48K views • 3 days ago', durationText: '6:43' }
];
const image = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="480" height="270"><rect width="480" height="270" fill="#263845"/><path d="M0 240L150 65L270 200L350 120L480 270H0" fill="#557064"/></svg>');

function render({ count, missingThumbnail, recommendations, captions }: Args): HTMLElement {
  const stage = mountHudStage({ progress: 0.5, frames: [0, 0.5, 1] });
  const scope = new DisposableScope();
  stage.onDispose(() => scope.dispose());
  if (captions) {
    // The player's caption overlay, showing the video's last cue as the media ends; the curtain hides it.
    const renderer = new CaptionRenderer();
    renderer.setCues([{ start: 0, end: 3, text: 'Thanks for watching.\nSee you in the next one.' }]);
    renderer.update(2);
    scope.add(() => renderer.dispose());
  }
  const media = Object.assign(new EventTarget(), { ended: true, duration: 2 });
  const replay = document.createElement('button');
  replay.setAttribute('aria-label', t('replay'));
  setSvgIcon(replay, REPLAY_ICON);
  const settings = createYouTubeSettings();
  void settings.ready.then(() => settings.set('youtube', 'showRecommendations', recommendations));
  scope.add(() => settings.dispose());
  const source: EndScreenSource = {
    mount(container, owner, label) {
      mountEndScreenSettings(container, { read: () => ({ mediaId: 'story',
        items: items.slice(0, count).map(item => ({ ...item, thumbnailUrl: missingThumbnail ? undefined : image })) }),
      activate: () => true }, { label, scope: owner, settings });
    },
    hostEndsPlayback: () => false, subscribe: () => () => {}, dispose() {}
  };
  mountEndedCurtain(stage.host, scope, media, [replay], () => {}, stage.clock, source);
  stage.advance(ENDED_CURTAIN_DELAY_MS);
  stage.settle();
  return stage.view;
}

const meta: Meta<Args> = {
  title: 'Components/YouTube end screen', tags: ['frames'], args: { count: 3, missingThumbnail: false, recommendations: true, captions: true }, render
};
export default meta;

/** The switch sits centred under `above` on the stage; the captions under the curtain stay hidden. */
async function expectLayout(above: string): Promise<void> {
  const stage = queryPlayerUi('.theater-ended-curtain')!.getBoundingClientRect();
  const box = queryPlayerUi('.theater-recommendations-setting')!.getBoundingClientRect();
  await expect(box.top).toBeGreaterThanOrEqual(queryPlayerUi(above)!.getBoundingClientRect().bottom);
  await expect(Math.abs(box.left + box.width / 2 - (stage.left + stage.width / 2))).toBeLessThan(1);
  await expect(getComputedStyle(queryPlayerUi('.theater-caption-overlay')!).visibility).toBe('hidden');
}

export const ThreeSuggestions: StoryObj<Args> = { play: async () => {
  await waitFor(() => expect(queryPlayerUi('.theater-end-screen')?.querySelectorAll('button').length).toBe(3));
  await expectLayout('.theater-end-screen');
} };
export const TwoSuggestions: StoryObj<Args> = { args: { count: 2 } };
export const OneSuggestion: StoryObj<Args> = { args: { count: 1 } };
export const MissingThumbnails: StoryObj<Args> = { args: { missingThumbnail: true }, play: async () => {
  await waitFor(() => expect(queryPlayerUi('.theater-end-screen')?.querySelectorAll('button').length).toBe(3));
  await expect(queryPlayerUi('.theater-end-screen')?.querySelector('img')).toBeNull();
} };

export const RecommendationsOff: StoryObj<Args> = { args: { recommendations: false }, play: async () => {
  await waitFor(() => expect(queryPlayerUi<HTMLInputElement>('.theater-recommendations-setting input')?.checked).toBe(false));
  await expect(queryPlayerUi('.theater-end-screen')).toBeNull();
  await expectLayout('.theater-ended-curtain button');
} };
