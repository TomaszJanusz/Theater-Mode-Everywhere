import { afterEach, describe, expect, test } from 'vitest';

import { manualClock } from '../../.storybook/manual-clock';
import { manualFrames } from '../../.storybook/manual-frames';
import { DisposableScope } from '../core/disposable-scope';

import { CHAT_SEPARATOR_SETTLE_MS, createChatSeparator } from './chat-separator';

let scope: DisposableScope | undefined;
afterEach(() => { scope?.dispose(); scope = undefined; document.body.replaceChildren(); });

function mount() {
  scope = new DisposableScope();
  const frames = manualFrames();
  const clock = manualClock();
  const applied: number[] = [];
  let width = 360;
  const separator = createChatSeparator({
    scope, label: 'Resize chat', min: 280, max: 600, defaultWidth: 360, clock, frames: frames.source,
    setWidth: next => { applied.push(next); width = next; separator.update({ shown: true, width }); }
  });
  separator.update({ shown: true, width });
  document.body.append(separator.element);
  const element = separator.element;
  const pointer = (type: string, clientX: number) => element.dispatchEvent(new PointerEvent(type, {
    pointerId: 3, pointerType: 'mouse', isPrimary: true, button: 0, buttons: 1, clientX, clientY: 300, bubbles: true, cancelable: true
  }));
  /** The width the separator's drawn edge stands for: the applied width minus its preview offset. */
  const drawnWidth = () => width - Number(/translateX\((-?[\d.]+)px\)/.exec(element.style.transform)?.[1] ?? 0);
  return { frames, clock, applied, element, pointer, drawnWidth, width: () => width };
}

describe('chat separator drag', () => {
  test('resizes live each frame, previews while writes are over budget, and returns to live without a jump', () => {
    const { frames, clock, applied, element, pointer, drawnWidth, width } = mount();
    let x = 1000;
    pointer('pointerdown', x);
    frames.tick(16.7);
    expect(element.dataset.dragMode).toBe('live');

    // Cheap frames: every frame writes the pointer's width and the edge is drawn where the pointer is.
    for (let step = 1; step <= 4; step++) {
      pointer('pointermove', x -= 10);
      frames.tick(16.7);
      expect(width()).toBe(360 + step * 10);
      expect(drawnWidth()).toBe(width());
    }
    expect(applied).toEqual([370, 380, 390, 400]);

    // Writes start costing 50 ms a frame: six of them make the median, then the drag previews.
    let writes = applied.length;
    while (element.dataset.dragMode === 'live') {
      pointer('pointermove', x -= 5);
      frames.tick(50);
      expect(drawnWidth()).toBe(1360 - x);
      expect(applied.length - writes).toBeLessThanOrEqual(7);
    }
    writes = applied.length;
    for (let step = 0; step < 10; step++) {
      pointer('pointermove', x -= 4);
      frames.tick(16.7);
      // The chat waits; the separator alone follows the pointer, exactly.
      expect(applied.length).toBe(writes);
      expect(drawnWidth()).toBe(1360 - x);
    }

    // Resting applies the width. Two pauses whose frames fit the budget bring live resizing back.
    for (let pause = 0; pause < 2; pause++) {
      expect(element.dataset.dragMode).toBe('preview');
      clock.advance(CHAT_SEPARATOR_SETTLE_MS);
      expect(width()).toBe(1360 - x);
      expect(drawnWidth()).toBe(width());
      frames.tick(17);
      frames.tick(17);
      pointer('pointermove', x -= 6);
      frames.tick(16.7);
      expect(drawnWidth()).toBe(1360 - x);
    }
    expect(element.dataset.dragMode).toBe('live');
    // The frame after the switch already applies the pointer's width: the edge never moved away from it.
    expect(width()).toBe(1360 - x);
    pointer('pointermove', x -= 10);
    frames.tick(16.7);
    expect(width()).toBe(1360 - x);

    pointer('pointerup', x);
    expect(element.hasAttribute('data-dragging')).toBe(false);
    expect(element.dataset.dragMode).toBeUndefined();
    expect(element.style.transform).toBe('');
    expect(frames.pending).toBe(0);
    expect(clock.pending).toBe(0);
  });

  test('applies the pointer width on release while previewing, and keys stay immediate', () => {
    const { frames, clock, applied, element, pointer, width } = mount();
    let x = 1000;
    pointer('pointerdown', x);
    frames.tick(16.7);
    // Each tick ends the previous frame: the frame after a write takes 80 ms.
    pointer('pointermove', x -= 8);
    frames.tick(16.7);
    for (let step = 0; step < 7; step++) {
      pointer('pointermove', x -= 8);
      frames.tick(80);
    }
    expect(element.dataset.dragMode).toBe('preview');
    pointer('pointermove', x -= 30);
    frames.tick(16.7);
    const before = applied.length;
    pointer('pointerup', x);
    expect(applied.length).toBe(before + 1);
    expect(width()).toBe(1360 - x);
    expect(clock.pending).toBe(0);

    // A later drag on the same slow host starts previewing straight away.
    pointer('pointerdown', x);
    expect(element.dataset.dragMode).toBe('preview');
    pointer('pointerup', x);

    const keyed = applied.length;
    element.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }));
    expect(applied.length).toBe(keyed + 1);
    expect(width()).toBe(1360 - x + 10);
  });

  test('stops its frames and timer when the owner is disposed mid-drag', () => {
    const { frames, clock, element, pointer } = mount();
    pointer('pointerdown', 1000);
    pointer('pointermove', 950);
    expect(frames.pending).toBe(1);
    expect(clock.pending).toBe(1);
    scope!.dispose();
    expect(frames.pending).toBe(0);
    expect(clock.pending).toBe(0);
    expect(element.querySelector('.theater-chat-separator-overlay')).toBeNull();
  });
});
