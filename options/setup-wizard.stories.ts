import type { Meta, StoryObj } from '@storybook/html-vite';
import { expect, waitFor } from 'storybook/test';

import { FRESH_SYNC, renderSetup, renderSetupActions } from '../.storybook/settings-page';
import { INSTALL_SHORTCUTS } from '../src/first-run-setup';
import { t } from '../src/i18n';
import { LANGUAGES } from '../src/language';
import { MEDIA_PROVIDER_FLAG_KEYS } from '../src/media-features/provider-flags';
import { PROVIDER_CAPABILITIES } from '../src/providers/capabilities';

import { defaultSetupAnswers } from './setup-answers';
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
/** Next until the step headed by message `title`; each new step takes focus. */
const toStep = (title: string) => {
  while (query('.setup-step-title')?.textContent !== setupMessage(title)) button('setupNext').click();
};
const pending = { state: { status: 'pending', version: '2.1.0' } } as const;

// A fresh install: the first step, Settings' language menu at Automatic.
export const Language: Story = {
  render: () => renderSetup(pending),
  play: async () => {
    await stage().ready;
    await expect(query('.setup-progress')?.textContent).toBe(setupMessage('setupProgress', ['1', '8']));
    await expect(query('.setup-language')?.textContent).toBe(t('languageAutomatic'));
    await expect(query('.setup-actions button[hidden]')?.textContent).toBe(setupMessage('setupBack'));
  }
};

// The language menu open: every language in its own name, as in Settings.
export const LanguageMenu: Story = {
  render: () => renderSetup(pending),
  play: async () => {
    await stage().ready;
    query<HTMLButtonElement>('.setup-language')!.click();
    await expect(query('#setup-language-listbox')?.hasAttribute('hidden')).toBe(false);
    await expect(stage().doc.querySelectorAll('#setup-language-listbox [role="option"]').length).toBe(LANGUAGES.length + 1);
  }
};

// Step 2: "All supported services" preselected.
export const Services: Story = {
  render: () => renderSetup(pending),
  play: async () => {
    await stage().ready;
    toStep('setupServicesTitle');
    await expect(query('.setup-progress')?.textContent).toBe(setupMessage('setupProgress', ['2', '8']));
    await expect(query<HTMLInputElement>('input[value="all"]')?.checked).toBe(true);
    await expect(query('#setup-services')?.hasAttribute('hidden')).toBe(true);
  }
};

// "Choose services", started with a saved profile that turned one service off.
export const ChooseServices: Story = {
  render: () => renderSetup({ sync: { ...FRESH_SYNC, [MEDIA_PROVIDER_FLAG_KEYS.netflix]: false }, start: {} }),
  play: async () => {
    await stage().ready;
    toStep('setupServicesTitle');
    await expect(query<HTMLInputElement>('input[value="choose"]')?.checked).toBe(true);
    await expect(stage().doc.querySelectorAll('#setup-services [role="switch"]').length).toBe(PROVIDER_CAPABILITIES.length);
    await expect(stage().doc.querySelectorAll('#setup-services [role="switch"]:checked').length).toBe(PROVIDER_CAPABILITIES.length - 1);
  }
};


// Step 2 with "Start automatically" chosen: its "Skip countdown" switch appears under it.
export const StartAutomatically: Story = {
  render: () => renderSetup(pending),
  play: async () => {
    await stage().ready;
    toStep('setupStartTitle');
    await expect(stage().doc.activeElement?.textContent).toBe(setupMessage('setupStartTitle'));
    await expect(query<HTMLInputElement>('input[value="key"]')?.checked).toBe(true);
    query<HTMLInputElement>('input[value="auto"]')!.click();
    await expect(query('#setup-skip-countdown')?.closest('[hidden]')).toBe(null);
  }
};

// Step 2 after choosing "None": "Start automatically" stays visible, unavailable, and says why.
export const StartUnavailable: Story = {
  render: () => renderSetup(pending),
  play: async () => {
    await stage().ready;
    toStep('setupServicesTitle');
    query<HTMLInputElement>('input[value="none"]')!.click();
    toStep('setupStartTitle');
    await expect(query<HTMLInputElement>('input[value="auto"]')?.disabled).toBe(true);
    await expect(query('#setup-choice-auto-unavailable')?.textContent).toBe(setupMessage('setupStartAutoUnavailable'));
  }
};

// Step 4: hold for 2x on and volume boost off, the fresh-install defaults.
export const KeysAndSound: Story = {
  render: () => renderSetup(pending),
  play: async () => {
    await stage().ready;
    toStep('setupKeysTitle');
    await expect(stage().doc.activeElement?.textContent).toBe(setupMessage('setupKeysTitle'));
    await expect(query<HTMLInputElement>('#setup-seek-hold')?.checked).toBe(true);
    await expect(query<HTMLInputElement>('#setup-volume-boost')?.checked).toBe(false);
  }
};

// Step 5 after choosing Green: the fixture page takes the accent at once.
export const AccentColor: Story = {
  render: () => renderSetup(pending),
  play: async () => {
    await stage().ready;
    toStep('accentColorLabel');
    const before = stage().doc.documentElement.style.getPropertyValue('--accent-color');
    query<HTMLButtonElement>('.setup-accent [data-choice="green"]')!.click();
    await expect(query('.setup-accent [data-choice="green"]')?.getAttribute('aria-checked')).toBe('true');
    await expect(stage().doc.documentElement.style.getPropertyValue('--accent-color')).not.toBe(before);
  }
};

// Step 6: Settings' layouts with their pictures; Raised and its subtitles switch are the defaults.
export const Layout: Story = {
  render: () => renderSetup(pending),
  play: async () => {
    await stage().ready;
    toStep('pictureAlignLabel');
    await expect(stage().doc.querySelectorAll('.setup-choice.has-picture svg').length).toBe(2);
    await expect(query<HTMLInputElement>('input[value="top"]')?.checked).toBe(true);
    await expect(query<HTMLInputElement>('#setup-raise-subtitles')?.checked).toBe(true);
  }
};

// Step 7: pinned controls, off as on a fresh install.
export const PinControls: Story = {
  render: () => renderSetup(pending),
  play: async () => {
    await stage().ready;
    toStep('setupControlsTitle');
    await expect(query<HTMLInputElement>('#setup-pin-controls')?.checked).toBe(false);
  }
};

// The last step after choosing "None": its heading takes focus, nothing is saved before Finish.
export const Summary: Story = {
  render: () => renderSetup(pending),
  play: async () => {
    await stage().ready;
    toStep('setupServicesTitle');
    query<HTMLInputElement>('input[value="none"]')!.click();
    toStep('setupSummaryTitle');
    await expect(stage().doc.activeElement?.textContent).toBe(setupMessage('setupSummaryTitle'));
    await expect([...stage().doc.querySelectorAll('.setup-summary dd')].map(value => value.textContent)).toEqual([
      t('languageAutomatic'), setupMessage('setupServicesNone'), setupMessage('setupSummaryStartKey', 'T'), setupMessage('setupSummaryOn'),
      setupMessage('setupSummaryOff'), t('accentColorSystem'), t('pictureAlignSubtitlesOnlyTitle'), setupMessage('setupSummaryOff')
    ]);
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

/** Someone's settings after a while: a custom theater key, an exclusion and AutoTheater on. */
const USED_SYNC = { shortcuts: { ...INSTALL_SHORTCUTS, toggle: 'G' }, blacklist: ['example.com'], autoEnterTheater: true, accentColor: 'green' };
const actions = () => window.__setupActionsStage!;
const actionButton = (label: string) => [...actions().doc.querySelectorAll<HTMLButtonElement>('button')].find(candidate => candidate.textContent === label)!;
/** Opens the reset confirmation in the fixture document. */
async function openReset(): Promise<HTMLElement> {
  await actions().ready;
  actionButton(t('resetToDefaults')).click();
  // The confirmation opens in the click.
  return actions().doc.querySelector<HTMLElement>('.te-dialog')!;
}

// Settings → About: run the setup again over the saved settings, or reset first.
export const SetupAgain: Story = {
  render: () => renderSetupActions(USED_SYNC),
  play: async () => {
    await actions().ready;
    await expect(actions().doc.querySelector('#setup-actions h2')?.textContent).toBe(setupMessage('setupAgainTitle'));
    actionButton(setupMessage('setupRunAgain')).click();
    await expect(actions().started).toEqual([undefined]);
  }
};

// The reset confirmation: Cancel focused, excluded websites and shortcuts kept unless ticked.
export const ResetConfirmation: Story = {
  render: () => renderSetupActions(USED_SYNC),
  play: async () => {
    const dialog = await openReset();
    await expect(dialog.querySelector('[id$="-title"], h2')?.textContent).toBe(setupMessage('setupResetTitle'));
    await expect(actions().doc.activeElement?.textContent).toBe(setupMessage('setupResetCancel'));
    await expect(dialog.querySelector<HTMLInputElement>('.setup-reset-also input')?.checked).toBe(false);
  }
};

// Confirming with the checkbox ticked: one remove and one set, then the setup starts at its defaults.
export const ResetConfirmed: Story = {
  tags: ['no-shot'],
  render: () => renderSetupActions(USED_SYNC),
  play: async () => {
    const dialog = await openReset();
    dialog.querySelector<HTMLInputElement>('.setup-reset-also input')!.click();
    actionButton(setupMessage('setupResetConfirm')).click();
    await waitFor(() => expect(actions().started.length).toBe(1));
    await expect(actions().started).toEqual([defaultSetupAnswers()]);
    await expect(actions().resets).toEqual([{
      remove: ['accentColor'], set: { autoEnterTheater: false, shortcuts: { ...INSTALL_SHORTCUTS }, blacklist: [] }
    }]);
    await expect(actions().doc.querySelector('.te-dialog')).toBe(null);
  }
};
