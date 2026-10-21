import type { Meta, StoryObj } from '@storybook/html-vite';
import { expect, waitFor } from 'storybook/test';

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
  open: boolean;
}

const SHORTCUT_KEYS = { fullscreenTooltip: ['F'], exitTheaterModeTooltip: ['T', 'Esc'] } satisfies Record<Args['tooltip'], string[]>;

const FULLSCREEN_ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"></path></svg>';

const EXIT_ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="20" y1="4" x2="4" y2="20"></line><line x1="4" y1="4" x2="20" y2="20"></line></svg>';
const ACTIONS = {
  fullscreenTooltip: { label: 'toggleFullscreen', icon: FULLSCREEN_ICON, className: 'fullscreen-btn' },
  exitTheaterModeTooltip: { label: 'exitTheaterMode', icon: EXIT_ICON, className: 'close-btn' }
} satisfies Record<Args['tooltip'], { label: string; icon: string; className: string }>;

const meta: Meta<Args> = {
  title: 'Player/Control button tooltip',
  argTypes: { tooltip: { control: 'select', options: ['fullscreenTooltip', 'exitTheaterModeTooltip'] }, place: { control: 'select', options: ['above', 'below'] }, disabled: { control: 'boolean' }, open: { control: 'boolean' } },
  args: { tooltip: 'fullscreenTooltip', place: 'above', disabled: false, open: false },
  render: ({ tooltip, place, disabled, open }) => renderPlayerBar(scope => {
    // The player runtime supplies the real mount and paint; only the caption dock is an edge no-op.
    const tooltips = createButtonTooltip({
      paintOverlay,
      mountPlayerUi,
      actions: { updateCaptionDock: () => {}, setTooltipContent: renderKbdText }
    });
    const button = document.createElement('button');
    // The action's label and icon match its tooltip; this fixture does not execute host commands.
    const action = ACTIONS[tooltip];
    button.className = `theater-control-btn ${action.className}`;
    button.setAttribute('aria-label', t(action.label));
    button.disabled = disabled;
    setSvgIcon(button, action.icon);
    tooltips.bind(button, () => t(tooltip, SHORTCUT_KEYS[tooltip]), undefined, place);
    scope.raf(() => { if (open && !disabled) button.dispatchEvent(new MouseEvent('mouseenter')); });
    return [button];
  }, { liftBar: place === 'below' })
};
export default meta;

type Story = StoryObj<Args>;

const button = () => queryPlayerUi<HTMLButtonElement>('.theater-control-btn')!;
const tooltip = () => queryPlayerUi<HTMLElement>('.theater-button-tooltip');

export const Closed: Story = {
  play: async ({ args }) => {
    await expect(button().getAttribute('aria-label')).toBe(t(ACTIONS[args.tooltip].label));
    await expect(button().getAttribute('aria-label')).not.toContain('<');
    await expect(button().hasAttribute('title')).toBe(false);
    await expect(button().disabled).toBe(args.disabled);
    await waitFor(() => expect(tooltip()?.classList.contains('visible') ?? false).toBe(args.open && !args.disabled));
    if (args.open && !args.disabled) {
      await expect(tooltip()?.querySelector('kbd')?.textContent).toBe(SHORTCUT_KEYS[args.tooltip][0]);
      await expect(tooltip()?.classList.contains('is-below')).toBe(args.place === 'below');
    }
  }
};
export const Above: Story = { ...Closed, args: { open: true } };
export const Below: Story = { ...Closed, args: { open: true, place: 'below' } };
