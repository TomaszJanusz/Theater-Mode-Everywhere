import type { Meta, StoryObj } from '@storybook/html-vite';
import { expect } from 'storybook/test';

import { FRESH_SYNC, renderSetup } from '../.storybook/settings-page';
import { MEDIA_PROVIDER_FLAG_KEYS } from '../src/media-features/provider-flags';
import { PROVIDER_CAPABILITIES } from '../src/providers/capabilities';

import { setupMessage } from './setup-wizard-copy';

/**
 * The production first-run setup in a Settings fixture document with in-memory storage. It shows the shell and
 * its steps, not an install, sync or the installed extension.
 */
const meta: Meta = {
  title: 'Options/Setup wizard',
  tags: ['frames'],
  parameters: { docs: { description: { component: 'Production first-run setup in a Settings fixture document. Not an install or sync.' } } }
};
export default meta;

type Story = StoryObj;
const stage = () => window.__setupStage!;
const query = <T extends Element>(selector: string) => stage().doc.querySelector<T>(selector);
const button = (key: string) => [...stage().doc.querySelectorAll<HTMLButtonElement>('.setup-actions button')]
  .find(candidate => candidate.textContent === setupMessage(key))!;

// A fresh install: the first step, "All supported services" preselected.
export const Services: Story = {
  render: () => renderSetup({ state: { status: 'pending', version: '2.1.0' } }),
  play: async () => {
    await stage().ready;
    await expect(query('.setup-progress')?.textContent).toBe(setupMessage('setupProgress', ['1', '2']));
    await expect(query<HTMLInputElement>('input[value="all"]')?.checked).toBe(true);
    await expect(query('#setup-services')?.hasAttribute('hidden')).toBe(true);
    await expect(query('.setup-actions button[hidden]')?.textContent).toBe(setupMessage('setupBack'));
  }
};

// "Choose services", started with a saved profile that turned one service off.
export const ChooseServices: Story = {
  render: () => renderSetup({ sync: { ...FRESH_SYNC, [MEDIA_PROVIDER_FLAG_KEYS.netflix]: false }, start: {} }),
  play: async () => {
    await stage().ready;
    await expect(query<HTMLInputElement>('input[value="choose"]')?.checked).toBe(true);
    await expect(stage().doc.querySelectorAll('#setup-services [role="switch"]').length).toBe(PROVIDER_CAPABILITIES.length);
    await expect(stage().doc.querySelectorAll('#setup-services [role="switch"]:checked').length).toBe(PROVIDER_CAPABILITIES.length - 1);
  }
};

// The last step after choosing "None": its heading takes focus, nothing is saved before Finish.
export const Summary: Story = {
  render: () => renderSetup({ state: { status: 'pending', version: '2.1.0' } }),
  play: async () => {
    await stage().ready;
    query<HTMLInputElement>('input[value="none"]')!.click();
    button('setupNext').click();
    await expect(stage().doc.activeElement?.textContent).toBe(setupMessage('setupSummaryTitle'));
    await expect(query('.setup-summary dd')?.textContent).toBe(setupMessage('setupServicesNone'));
    await expect(button('setupFinish')).toBeTruthy();
    await expect(stage().saved).toEqual([]);
  }
};

// Settings from another device arrived before the install's setup opened.
export const SettingsFound: Story = {
  render: () => renderSetup({ sync: { ...FRESH_SYNC, language: 'pl' }, state: { status: 'pending', version: '2.1.0' } }),
  play: async () => {
    await stage().ready;
    await expect(query('.setup-notice')?.textContent).toBe(setupMessage('setupProfileFound'));
    await expect(query('.setup-step')).toBe(null);
    await expect(stage().saved).toEqual([{ settings: {}, state: { status: 'profile', version: '2.1.0' } }]);
  }
};
