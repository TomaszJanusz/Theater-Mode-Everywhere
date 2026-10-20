import type { Meta, StoryObj } from '@storybook/html-vite';
import { expect } from 'storybook/test';

import { paintOverlay, renderPlayerBar } from '../../.storybook/player-stage';

import { createButtonTooltip, type ButtonTooltipPlace } from './button-tooltip';
import { renderKbdText } from './kbd-text';
import { t } from './messages';
import { mountPlayerUi, queryPlayerUi } from './root';
import { setSvgIcon } from './svg-icon';

interface Args {
  tooltip: 'fullscreenTooltip' | 'exitTheaterModeTooltip';
  place: ButtonTooltipPlace;
  disabled: boolean;
}

const SHORTCUT_KEYS = { fullscreenTooltip: ['F'], exitTheaterModeTooltip: ['Esc', 'T'] } satisfies Record<Args['tooltip'], string[]>;

const FULLSCREEN_ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"></path></svg>';

const meta: Meta<Args> = {
  title: 'Player/Control button tooltip',
  args: { tooltip: 'fullscreenTooltip', place: 'above', disabled: false },
  render: ({ tooltip, place, disabled }) => renderPlayerBar(() => {
    // The player runtime supplies the real mount and paint; only the caption dock is an edge no-op.
    const tooltips = createButtonTooltip({
      paintOverlay,
      mountPlayerUi,
      actions: { updateCaptionDock: () => {}, setTooltipContent: renderKbdText }
    });
    const button = document.createElement('button');
    button.className = 'theater-control-btn fullscreen-btn';
    button.setAttribute('aria-label', t('toggleFullscreen'));
    button.disabled = disabled;
    setSvgIcon(button, FULLSCREEN_ICON);
    tooltips.bind(button, () => t(tooltip, SHORTCUT_KEYS[tooltip]), undefined, place);
    return [button];
  }, { liftBar: place === 'below' })
};
export default meta;

type Story = StoryObj<Args>;

const button = () => queryPlayerUi<HTMLButtonElement>('.fullscreen-btn')!;
const tooltip = () => queryPlayerUi<HTMLElement>('.theater-button-tooltip');

export const Default: Story = {
  play: async () => {
    await expect(tooltip()).toBeNull();
    await expect(button().hasAttribute('title')).toBe(false);
  }
};

export const Open: Story = {
  play: async () => {
    button().dispatchEvent(new MouseEvent('mouseenter'));
    await expect(tooltip()?.classList.contains('visible')).toBe(true);
    await expect(tooltip()?.querySelector('kbd')?.textContent).toBe('F');
    button().dispatchEvent(new MouseEvent('mouseleave'));
    await expect(tooltip()?.classList.contains('visible')).toBe(false);
    button().dispatchEvent(new MouseEvent('mouseenter'));
  }
};

export const Disabled: Story = { args: { disabled: true } };

export const Below: Story = {
  args: { place: 'below' },
  play: async () => {
    button().dispatchEvent(new MouseEvent('mouseenter'));
    await expect(tooltip()?.classList.contains('is-below')).toBe(true);
  }
};

/** The longest tooltip string in the catalogs (German, 62 characters). */
export const LongLabelGerman: Story = {
  args: { tooltip: 'exitTheaterModeTooltip' },
  globals: { locale: 'de' },
  play: async () => {
    button().dispatchEvent(new MouseEvent('mouseenter'));
    await expect(tooltip()?.classList.contains('visible')).toBe(true);
  }
};

export const Arabic: Story = {
  globals: { locale: 'ar' },
  play: async () => {
    button().dispatchEvent(new MouseEvent('mouseenter'));
    await expect(tooltip()?.classList.contains('visible')).toBe(true);
  }
};
