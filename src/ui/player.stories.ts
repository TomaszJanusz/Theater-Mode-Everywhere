import type { Meta, StoryObj } from '@storybook/html-vite';
import { expect } from 'storybook/test';

import { renderPlayer, SCENARIOS, type Scenario } from '../../.storybook/player-fixture';

interface Args { scenario: Scenario }

/**
 * Production player UI composed around local fixture media; synthetic provider data;
 * engines actually tested are listed in the pull request. This is a fixture document running
 * the shipped runtime, not a host page: it establishes layout, z-order, focus flow and menu
 * interplay within this composition, and nothing about host selectors, services, MAIN/isolated
 * worlds or the installed extension.
 */
const meta: Meta<Args> = {
  title: 'Player/Composed player',
  argTypes: { scenario: { control: 'inline-radio', options: [...SCENARIOS] } },
  args: { scenario: 'watching' },
  parameters: { docs: { description: { component: 'Production player UI composed around local fixture media; synthetic provider data. Not host behavior.' } } },
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
