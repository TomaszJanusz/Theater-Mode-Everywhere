import type { Meta, StoryObj } from '@storybook/html-vite';
import { expect } from 'storybook/test';

import { arrow, renderStepper, segments, stepperValue, type StepperArgs } from '../../.storybook/stepper-story';

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
    await expect(arrow(-1).disabled).toBe(args.index === 0);
    await expect(arrow(1).disabled).toBe(args.index === args.count - 1);
  }
};
// The ends disable their arrow instead of wrapping.
export const First: Story = { ...Middle, args: { index: 0 } };
export const Last: Story = { ...Middle, args: { index: 4 } };
export const ThreeOptions: Story = { ...Middle, args: { count: 3, index: 1 } };
