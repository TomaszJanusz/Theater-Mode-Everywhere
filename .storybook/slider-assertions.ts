import { expect } from 'storybook/test';

/** Check painted geometry, not just the fraction supplied to the stylesheet. */
export async function expectSliderMarker(slider: HTMLInputElement, marker: HTMLElement, value: number): Promise<void> {
  const previous = slider.value;
  try {
    slider.value = String(value);
    const track = slider.getBoundingClientRect();
    const dot = marker.getBoundingClientRect();
    const fraction = (Number(slider.value) - Number(slider.min)) / (Number(slider.max) - Number(slider.min));
    const thumb = 12;
    const centre = track.bottom - thumb / 2 - fraction * (track.height - thumb);
    await expect(marker.hidden).toBe(false);
    await expect(dot.width).toBeGreaterThan(0);
    await expect(Math.abs(dot.top + dot.height / 2 - centre)).toBeLessThan(0.75);
    await expect(Math.abs(dot.left + dot.width / 2 - track.left - track.width / 2)).toBeLessThan(0.75);
    // Both controls use the same marker dimensions.
    await expect(dot.width).toBe(4);
    await expect(dot.height).toBe(2);
  } finally {
    slider.value = previous;
  }
}
