import { afterEach, describe, expect, test } from 'vitest';
import { userEvent } from 'vitest/browser';

import { DisposableScope } from '../core/disposable-scope';
import { fakeQualitySource, qualityMenuHost, sampleQuality } from '../test-utils/video-quality-fixture';
import { getPlayerUiRoot, mountPlayerUi } from '../ui/root';

import { mountVideoQualityMenu } from './video-quality-view';

let scope: DisposableScope;
afterEach(() => scope?.dispose());

function mount(initial = sampleQuality() as ReturnType<typeof sampleQuality> | null) {
  scope = new DisposableScope();
  const host = qualityMenuHost(scope);
  // The bar markup the extension builds: the player UI root only takes pointer input inside it.
  const wrapper = document.createElement('div');
  wrapper.className = 'theater-controls-wrapper visible';
  const bar = document.createElement('div');
  bar.className = 'theater-controls-row';
  const right = document.createElement('div');
  right.className = 'theater-controls-right';
  right.append(host.settings.container);
  bar.append(right);
  wrapper.append(bar);
  mountPlayerUi(wrapper);
  scope.add(() => wrapper.remove());
  const fake = fakeQualitySource(initial);
  const { row } = mountVideoQualityMenu(fake.source, host);
  const choices = () => [...host.settings.subview.querySelectorAll<HTMLButtonElement>('#theater-video-quality-list button')];
  const listed = () => choices().map(button => `${button.querySelector('.theater-cc-menu-label')!.textContent}${button.getAttribute('aria-pressed') === 'true' ? ' ✓' : ''}`);
  const open = async () => {
    if (host.settings.panel.closest('.theater-settings-container')?.querySelector('[aria-expanded="true"]')) return;
    await userEvent.click(host.settings.button);
  };
  return { host, row, fake, choices, listed, open };
}

describe('Video quality row and list', () => {
  test('shows the levels with Auto naming what plays, and a pointer pick names the item it was made for', async () => {
    const { row, fake, choices, listed, open, host } = mount();
    await open();
    expect(row.hidden).toBe(false);
    await expect.element(row).toHaveAccessibleName('Video quality: Auto (720p60)');
    await userEvent.click(row);
    expect(host.settings.subview.hidden).toBe(false);
    expect(listed()).toEqual(['Auto (720p60) ✓', '2160p60', '1440p60', '1080p60', '720p60', '480p', '360p', '240p', '144p']);
    // Eight levels are still a short, ordered list: no search field.
    expect(host.settings.subview.querySelector<HTMLElement>('.theater-cc-search')!.hidden).toBe(true);
    await userEvent.click(choices()[3]!);
    expect(fake.selections).toEqual([['hd1080', 'aqz-KE-bpKQ']]);
    expect(host.settings.panel.closest('.theater-settings-container')!.querySelector('[aria-expanded="true"]')).toBeNull();
    await open();
    await expect.element(row).toHaveAccessibleName('Video quality: 1080p60');
  });

  test('keyboard activation opens the list on its first choice and Enter picks like a click', async () => {
    const { row, fake, open } = mount(sampleQuality({ fixed: 'large', playing: 'large' }));
    await open();
    row.focus();
    await userEvent.keyboard('{Enter}');
    const root = getPlayerUiRoot();
    expect(root.activeElement?.textContent).toContain('Auto (480p)');
    await userEvent.keyboard('{Enter}');
    expect(fake.selections).toEqual([[null, 'aqz-KE-bpKQ']]);
  });

  test('follows host changes: another item re-renders the open list, none hides the row and closes it', async () => {
    const { row, fake, listed, open, host } = mount();
    await open();
    await userEvent.click(row);
    fake.update(sampleQuality({ mediaId: 'next-video0', levels: sampleQuality().levels.slice(2, 5), playing: 'large' }));
    await expect.poll(listed).toEqual(['Auto (480p) ✓', '1080p60', '720p60', '480p']);
    fake.update(null);
    await expect.poll(() => row.hidden).toBe(true);
    expect(host.settings.subview.hidden).toBe(true);
  });

  test('bursts of host changes cost one read per frame', async () => {
    const { fake } = mount();
    const before = fake.reads();
    for (let i = 0; i < 5; i += 1) fake.update(sampleQuality({ playing: i % 2 ? 'hd720' : 'large' }));
    expect(fake.reads()).toBe(before);
    // Nothing notifies after the burst, so the count it settles on is the whole cost.
    await expect.poll(() => fake.reads() - before).toBeGreaterThan(0);
    expect(fake.reads() - before).toBe(1);
  });

  test('every opening of the menu re-reads, so an unreported change never offers a stale list', async () => {
    const { row, fake, open } = mount();
    fake.replace(null);
    await open();
    expect(row.hidden).toBe(true);
  });

  test('starts hidden without levels and releases its subscription with the controls', async () => {
    const { row, fake } = mount(null);
    expect(row.hidden).toBe(true);
    expect(fake.subscriptions()).toBe(1);
    scope.dispose();
    expect(fake.subscriptions()).toBe(0);
    // Nothing is subscribed any more, so the host's report reaches no one.
    fake.update(sampleQuality());
    expect(row.hidden).toBe(true);
  });
});
