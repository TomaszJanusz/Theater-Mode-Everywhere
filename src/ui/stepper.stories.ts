import type { Meta, StoryObj } from '@storybook/html-vite';
import { expect } from 'storybook/test';

import { arrow, arrowDisabled, renderStepper, segments, stepperValue, thumb, type StepperArgs } from '../../.storybook/stepper-story';

const meta: Meta<StepperArgs> = {
  title: 'Components/Stepper',
  argTypes: { count: { control: { type: 'range', min: 2, max: 7, step: 1 } }, index: { control: { type: 'range', min: 0, max: 6, step: 1 } } },
  args: { count: 5, index: 2 },
  render: args => renderStepper(args)
};
export default meta;

type Story = StoryObj<StepperArgs>;

export const Middle: Story = {
  play: async ({ args }) => {
    await expect(stepperValue().textContent).toBe(`Option ${args.index + 1}`);
    await expect(segments().length).toBe(args.count);
    await expect(segments().findIndex(segment => segment.dataset.current === 'true')).toBe(args.index);
    await expect(arrowDisabled(-1)).toBe(args.index === 0);
    await expect(arrowDisabled(1)).toBe(args.index === args.count - 1);
  }
};
// The ends disable their arrow instead of wrapping.
export const First: Story = { ...Middle, args: { index: 0 } };
export const Last: Story = { ...Middle, args: { index: 4 } };
export const ThreeOptions: Story = { ...Middle, args: { count: 3, index: 1 } };
// Off and On: a toggle reads as two segments, with the lower arrow blocked until it is on.
export const TwoOptions: Story = { ...Middle, args: { count: 2, index: 0 } };
// Both arrows blocked and no segment lit, as AutoTheater on a page without support.
export const Disabled: Story = {
  args: { count: 2, index: 1, disabled: true },
  play: async () => {
    await expect(stepperValue().textContent).toBe('Unavailable');
    await expect(arrowDisabled(-1)).toBe(true);
    await expect(arrowDisabled(1)).toBe(true);
    await expect(getComputedStyle(thumb()).backgroundColor).toBe('rgba(0, 0, 0, 0)');
  }
};
// Reduce motion keeps every state and removes the movement. A lifecycle assertion, nothing worth a picture.
export const ReducedMotion: Story = {
  ...Middle,
  tags: ['no-shot'],
  globals: { reduceMotion: 'on' },
  play: async context => {
    await Middle.play!(context);
    arrow(1).click();
    await expect(stepperValue().getAnimations().length).toBe(0);
    await expect(getComputedStyle(thumb()).transitionDuration).toBe('0s');
  }
};
