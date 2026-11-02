import type { Meta, StoryObj } from '@storybook/html-vite';
import { expect } from 'storybook/test';

import { renderWhatsNew } from '../.storybook/settings-page';

/**
 * The production highlights dialog in a Settings fixture document. It shows the shared modal shell, the
 * scroll shadow and the thanks note, not an install, acknowledgement or update.
 */
const meta: Meta = {
  title: 'Options/What\'s new',
  tags: ['frames'],
  parameters: { docs: { description: { component: 'Production highlights dialog in a Settings fixture document. Not an install or update.' } } }
};
export default meta;

type Story = StoryObj;
const stage = () => window.__whatsNewStage!;
const body = () => stage().doc.querySelector<HTMLElement>('.te-dialog-body')!;
const note = () => stage().doc.querySelector<HTMLElement>('.te-dialog-note')!;

/** Scrolls the highlights to `fraction` of their range, waits for the paint and proves the scroll really happened. */
async function scrollTo(fraction: number) {
  await stage().ready;
  const range = body().scrollHeight - body().clientHeight;
  // A list that fits would pass every state vacuously.
  await expect(range).toBeGreaterThan(0);
  body().scrollTop = range * fraction;
  await new Promise<void>(done => requestAnimationFrame(() => requestAnimationFrame(() => done())));
  await expect(Math.abs(body().scrollTop - range * fraction)).toBeLessThan(1);
}

/** The scroll shadow is painted on the body's bottom edge; it must meet the note's separator exactly. */
const expectJoined = () => expect(Math.abs(note().getBoundingClientRect().top - body().getBoundingClientRect().bottom)).toBeLessThan(0.5);

// Both releases, so the list scrolls inside the small viewport; shadow below only.
export const ScrolledTop: Story = {
  render: () => renderWhatsNew('1.9'),
  play: async () => {
    await scrollTo(0);
    await expectJoined();
    await expect(body().scrollTop).toBe(0);
  }
};

// Shadow above and below.
export const ScrolledMiddle: Story = {
  render: () => renderWhatsNew('1.9'),
  play: async () => {
    await scrollTo(0.5);
    await expectJoined();
  }
};

// Shadow above only.
export const ScrolledBottom: Story = {
  render: () => renderWhatsNew('1.9'),
  play: async () => {
    await scrollTo(1);
    await expectJoined();
  }
};

// Keys render as shared key caps.
export const Keys: Story = {
  render: () => renderWhatsNew('2.0'),
  play: async () => {
    await stage().ready;
    const caps = [...stage().doc.querySelectorAll('.whats-new-content kbd')].map(key => key.textContent);
    await expect(caps).toEqual(['<', '>', 'W', 'A', 'S', 'D']);
  }
};
