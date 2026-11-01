import type { Meta, StoryObj } from '@storybook/html-vite';
import { expect, waitFor } from 'storybook/test';

import { mountHudStage } from '../../../.storybook/hud-stage';
import recorded from '../../../test/host-fixtures/bilibili-end-screen.html?raw';
import { DisposableScope } from '../../core/disposable-scope';
import type { EndScreenSource } from '../../core/end-screen';
import { ENDED_CURTAIN_DELAY_MS, mountEndedCurtain, REPLAY_ICON } from '../../ui/ended-curtain';
import { t } from '../../ui/messages';
import { queryPlayerUi } from '../../ui/root';
import { setSvgIcon } from '../../ui/svg-icon';
import { mountEndScreenSettings, type EndScreenItem } from '../end-screen-view';

import { readBilibiliEndTiles } from './end-screen-model';
import { createBilibiliSettings } from './settings';

interface Args { recommendations: boolean; panelOnly: boolean }

const image = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="480" height="270"><rect width="480" height="270" fill="#263845"/><path d="M0 240L150 65L270 200L350 120L480 270H0" fill="#557064"/></svg>');

/**
 * The provider's own extraction runs on the recorded host DOM (fixture evidence, not a live capture); only the covers
 * are replaced, so the story never contacts Bilibili's image hosts. `panelOnly` drops the sidebar cards, leaving what the
 * ending panel alone carries: a title and a cover.
 */
function items(panelOnly: boolean): EndScreenItem[] {
  const host = new DOMParser().parseFromString(recorded, 'text/html').body;
  if (panelOnly) host.querySelector('.recommend-list-v1')?.remove();
  return readBilibiliEndTiles(host, host).map(({ item }) => ({ ...item, thumbnailUrl: image }));
}

function render({ recommendations, panelOnly }: Args): HTMLElement {
  const stage = mountHudStage({ progress: 0.5, frames: [0, 0.5, 1] });
  const scope = new DisposableScope();
  stage.onDispose(() => scope.dispose());
  const media = Object.assign(new EventTarget(), { ended: true, duration: 2 });
  const replay = document.createElement('button');
  replay.setAttribute('aria-label', t('replay'));
  setSvgIcon(replay, REPLAY_ICON);
  const settings = createBilibiliSettings();
  void settings.ready.then(() => settings.set('bilibili', 'showRecommendations', recommendations));
  scope.add(() => settings.dispose());
  const snapshot = { mediaId: 'story', items: items(panelOnly) };
  const source: EndScreenSource = {
    mount(container, owner, label) {
      mountEndScreenSettings(container, { read: () => snapshot, activate: () => true }, { label, scope: owner, settings, provider: 'bilibili' });
    },
    hostEndsPlayback: () => false, subscribe: () => () => {}, dispose() {}
  };
  mountEndedCurtain(stage.host, scope, media, [replay], () => {}, stage.clock, source);
  stage.advance(ENDED_CURTAIN_DELAY_MS);
  stage.settle();
  return stage.view;
}

const meta: Meta<Args> = { title: 'Components/Bilibili end screen', tags: ['frames'], args: { recommendations: true, panelOnly: false }, render };
export default meta;

/** Uploader, views and duration come from the sidebar card that matches each panel tile. */
export const RecordedTiles: StoryObj<Args> = { play: async () => {
  await waitFor(() => expect(queryPlayerUi('.theater-end-screen')?.querySelectorAll('button').length).toBe(3));
  await expect(queryPlayerUi('.theater-end-screen-channel')?.textContent).toBe('ammmx');
  await expect(queryPlayerUi('.theater-end-screen-duration')?.textContent).toBe('00:15');
} };

export const PanelTitleAndCoverOnly: StoryObj<Args> = { args: { panelOnly: true }, play: async () => {
  await waitFor(() => expect(queryPlayerUi('.theater-end-screen')?.querySelectorAll('button').length).toBe(3));
  await expect(queryPlayerUi('.theater-end-screen-channel')).toBeNull();
} };

export const RecommendationsOff: StoryObj<Args> = { args: { recommendations: false }, play: async () => {
  await waitFor(() => expect(queryPlayerUi<HTMLInputElement>('.theater-recommendations-setting input')?.checked).toBe(false));
  await expect(queryPlayerUi('.theater-end-screen')).toBeNull();
} };
