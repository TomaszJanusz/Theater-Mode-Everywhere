import type { Meta, StoryObj } from '@storybook/html-vite';
import { expect, waitFor } from 'storybook/test';

import { mountHudStage, type HudStage } from '../../.storybook/hud-stage';
import { DisposableScope } from '../core/disposable-scope';
import type { ServiceAction } from '../core/service-actions';

import { queryPlayerUi } from './root';
import { mountServiceActionCta } from './service-actions';

let active: { stage: HudStage; scope: DisposableScope; update(progress: number): void; clicks: string[] };

/** Production CTA with host snapshots; no story timer advances or navigates the host. */
function render(): HTMLElement {
  const stage = mountHudStage({ progress: 0.5 });
  const scope = new DisposableScope();
  stage.onDispose(() => scope.dispose());
  let actions: ServiceAction[] = [{ id: 'play', label: 'Play Now', progress: 0.5 }, { id: 'cancel', label: 'Cancel' }];
  let changed = () => {};
  const clicks: string[] = [];
  mountServiceActionCta(scope, {
    source: {
      read: () => actions,
      subscribe: fn => { changed = fn; return () => { changed = () => {}; }; },
      activate(id) { clicks.push(id); actions = []; changed(); return true; }
    },
    mount: stage.host.mountPlayerUi, toolbarVisible: () => true, controlsLift: () => 0,
    subscribeToolbar: () => () => {}
  });
  active = { stage, scope, clicks, update: progress => { actions[0]!.progress = progress; changed(); } };
  stage.settle();
  return stage.view;
}

const meta: Meta = { title: 'Components/Service actions', tags: ['frames'], render };
export default meta;

/** The same host-owned countdown CTA used for Netflix post-play and YouTube autoplay. */
export const Countdown: StoryObj = {
  play: async () => {
    await expect(queryPlayerUi('.theater-service-action-host')?.textContent).toBe('Play NowCancel');
    await expect(queryPlayerUi<HTMLElement>('.theater-service-action-progress')?.style.transform).toBe('scaleX(0.5)');
  }
};

export const Lifecycle: StoryObj = {
  tags: ['no-shot'],
  play: async () => {
    active.update(0.75);
    await waitFor(() => expect(queryPlayerUi<HTMLElement>('.theater-service-action-progress')?.style.transform).toBe('scaleX(0.75)'));
    queryPlayerUi<HTMLButtonElement>('.theater-service-action')!.click();
    await expect(active.clicks).toEqual(['play']);
    active.scope.dispose(); active.scope.dispose();
    await expect(queryPlayerUi('.theater-service-action-host')).toBeNull();
    await expect(active.stage.clock.pending).toBe(0);
  }
};
