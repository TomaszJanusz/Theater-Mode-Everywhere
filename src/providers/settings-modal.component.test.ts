import { afterEach, expect, test } from 'vitest';
import { userEvent } from 'vitest/browser';

import css from '../../options/options.css?inline';
import { openProviderSettings } from '../../options/provider-settings';
import { blockingViolations } from '../test-utils/axe';
import { createChromeStub } from '../test-utils/page-chrome-stub';

import { createProviderSettings, type SettingsProvider } from './settings';

let dispose = () => {};
afterEach(() => dispose());

test('options modal uses descriptor copy, sync updates, keyboard, focus trap, backdrop and cleanup', async () => {
  const edge = createChromeStub();
  globalThis.chrome = edge.chrome;
  const provider: SettingsProvider & { name: string } = { id: 'sample', name: 'Sample', settings: [{ id: 'enabled', type: 'boolean',
    default: true, label: 'providerShowRecommendations', description: 'providerShowRecommendationsDescription' }] };
  const store = createProviderSettings([provider]);
  await store.ready;
  const style = document.createElement('style');
  style.textContent = css;
  const trigger = document.createElement('button');
  trigger.textContent = 'Settings';
  document.body.append(style, trigger);
  let modal: ReturnType<typeof openProviderSettings>;
  trigger.onclick = () => { modal = openProviderSettings(provider, store); };
  dispose = () => { modal?.dispose(); store.dispose(); edge.dispose(); };
  await userEvent.click(trigger);
  const input = document.querySelector<HTMLInputElement>('.provider-setting input')!;
  await expect.element(input).toHaveAccessibleName('Show recommendations');
  expect(modal!.dialog.getAttribute('aria-describedby')).toBeTruthy();
  input.focus();
  await userEvent.keyboard(' ');
  await expect.poll(() => store.values.sample.enabled).toBe(false);
  expect(document.activeElement).toBe(input);
  edge.setSyncStorage({ providerSettings: { sample: { enabled: true } } });
  expect(input.checked).toBe(true);
  for (let index = 0; index < 4; index++) {
    await userEvent.tab();
    expect(modal!.dialog.contains(document.activeElement)).toBe(true);
  }
  await Promise.all(modal!.overlay.getAnimations({ subtree: true }).map(animation => animation.finished));
  expect(await blockingViolations(modal!.overlay)).toEqual([]);
  await userEvent.keyboard('{Escape}');
  expect(document.activeElement).toBe(trigger);
  await userEvent.click(trigger);
  modal!.overlay.click();
  expect(document.activeElement).toBe(trigger);
  modal!.dispose(); modal!.dispose();
  store.dispose(); store.dispose();
  await expect.poll(() => edge.listenerCount).toBe(0);
});
