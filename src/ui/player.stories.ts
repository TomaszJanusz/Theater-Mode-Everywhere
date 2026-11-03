import type { Meta, StoryObj } from '@storybook/html-vite';
import { expect } from 'storybook/test';

import { FIXTURE_UPDATE, renderPlayer, SCENARIOS, type Scenario } from '../../.storybook/player-fixture';
import { announcedGeneration } from '../update-notice';

import { t } from './messages';

interface Args { scenario: Scenario }

/**
 * Production player UI composed around local fixture media; synthetic provider data;
 * engines actually tested are listed in the pull request. This is a fixture document running
 * the shipped runtime, not a host page: it establishes layout, z-order, focus flow and menu
 * interplay within this composition, and nothing about host selectors, services, MAIN/isolated
 * worlds or the installed extension.
 */
const meta: Meta<Args> = {
  title: 'Extension/Player UI',
  argTypes: { scenario: { control: 'inline-radio', options: [...SCENARIOS] } },
  args: { scenario: 'watching' },
  parameters: {
    // A bottom addon panel leaves about 460px in a typical window. Keep Controls beside the
    // full player so its production settings menu fits without scrolling; fullscreen alone
    // only removes preview padding, not the manager's addon panel.
    options: { layout: { panelPosition: 'right' } },
    docs: { description: { component: 'Production player UI composed around local fixture media; synthetic provider data. Not host behavior.' } }
  },
  render: ({ scenario }, { globals }) => renderPlayer(
    { locale: String(globals.locale), backdrop: String(globals.backdrop), reduceMotion: String(globals.reduceMotion) }, scenario)
};
export default meta;

export const Composed: StoryObj<Args> = {
  play: async () => {
    await window.__playerFixture!.ready;
    const root = window.__playerFixture!.root;
    await expect(root.querySelector('.theater-controls-wrapper.visible')).not.toBeNull();
  }
};

/**
 * The clip has played to its end: the curtain covers the picture, the bar's play button has become Replay, and the
 * title and controls stay up. That they outlast the idle hide runs on the runtime's own timer, so
 * ended-curtain.browser.test.ts proves it on a held clock.
 */
export const Ended: StoryObj<Args> = {
  args: { scenario: 'ended' },
  play: async () => {
    await window.__playerFixture!.ready;
    const root = window.__playerFixture!.root;
    const replay = root.querySelector('.theater-controls-wrapper .play-pause-btn');
    await expect(replay?.getAttribute('aria-label')).toBe(t('replay'));
    await expect(root.querySelector('.theater-ended-curtain button')?.getAttribute('aria-label')).toBe(t('replay'));
    await expect(root.querySelector('.theater-everywhere-header-hud.visible')).not.toBeNull();
    await expect(root.querySelector('.theater-controls-wrapper.visible')).not.toBeNull();
  }
};

/**
 * An update to a new version is announced: the settings menu's last row names it and leads to Update highlights
 * instead of Settings, with the visible text as its accessible name. Which page the click opens is the background's
 * part; update-notice smoke covers it in the installed extension.
 */
export const UpdateAnnounced: StoryObj<Args> = {
  // The Composed story's `update` profiles take its pictures.
  tags: ['no-shot'],
  args: { scenario: 'update' },
  play: async () => {
    await window.__playerFixture!.ready;
    const row = window.__playerFixture!.root.querySelector('.extension-settings-btn');
    const label = t('updateMenuLabel', announcedGeneration(FIXTURE_UPDATE));
    await expect(row?.querySelector('.theater-settings-label')?.textContent).toBe(label);
    await expect(row?.getAttribute('aria-label')).toBe(label);
  }
};
