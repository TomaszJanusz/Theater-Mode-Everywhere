import type { Meta, StoryObj } from '@storybook/html-vite';
import { expect, waitFor } from 'storybook/test';

import { mountHudStage } from '../../.storybook/hud-stage';
import { ACCENT_COLOR_PRESETS, applyAccentColorPreset, type AccentColorPreset } from '../accentTheme';
import { DEFAULT_CHAT_WIDTH_PX, MAX_CHAT_WIDTH_PX, MIN_CHAT_WIDTH_PX } from '../chat';
import { DisposableScope } from '../core/disposable-scope';

import { CHAT_SEPARATOR_SETTLE_MS, createChatSeparator } from './chat-separator';
import { applyUiDirection, t } from './messages';
import { mountPlayerUi, queryPlayerUi } from './root';

type HandleState = 'idle' | 'hover' | 'focus' | 'dragging';
interface Args { state: HandleState; accent: AccentColorPreset; width: number; settle?: boolean }

/**
 * The production separator in the real player-UI root, beside a stand-in chat column. The story owns
 * the width as the chat controller does: `setWidth` moves the picture/chat edge and reports back through
 * `update`. The chat column follows the backdrop global, so the dark and light shots show the handle
 * against a dark and a light chat. A drag applies its width after a pause on the stage's manual clock,
 * so `dragging` holds the preview: the separator 60 px left of the applied edge. Transitions are held at
 * the swept fractions (`frames`).
 */
const meta: Meta<Args> = {
  title: 'Components/Chat separator',
  tags: ['frames'],
  argTypes: {
    state: { control: 'select', options: ['idle', 'hover', 'focus', 'dragging'] },
    accent: { control: 'select', options: [...ACCENT_COLOR_PRESETS] },
    width: { control: { type: 'range', min: MIN_CHAT_WIDTH_PX, max: MAX_CHAT_WIDTH_PX, step: 10 } }
  },
  args: { state: 'idle', accent: 'system', width: DEFAULT_CHAT_WIDTH_PX },
  render: (args, { globals }) => {
    const stage = mountHudStage({ progress: 1 });
    const scope = new DisposableScope();
    stage.onDispose(() => scope.dispose());
    const root = document.documentElement;
    scope.add(() => root.style.removeProperty('--theater-video-width'));

    const picture = document.createElement('div');
    picture.style.cssText = 'position:fixed;inset:0;background:#000';
    const chat = document.createElement('div');
    const light = globals.backdrop === 'light';
    chat.style.cssText = `position:fixed;top:0;right:0;bottom:0;box-sizing:border-box;padding:12px;font:13px/1.5 system-ui,sans-serif;background:${light ? '#ffffff' : '#18181b'};color:${light ? '#0e0e10' : '#efeff1'}`;
    for (const [name, message] of [['viewer_one', 'what a save'], ['night_owl', 'replay that please'], ['moderator', 'be kind in chat']]) {
      const line = document.createElement('p');
      line.style.margin = '0 0 8px';
      const author = document.createElement('b');
      author.textContent = name;
      line.append(author, ` ${message}`);
      chat.append(line);
    }
    stage.view.append(picture, chat);

    const separator = createChatSeparator({
      scope,
      label: t('nativeChatResize'),
      min: MIN_CHAT_WIDTH_PX,
      max: MAX_CHAT_WIDTH_PX,
      defaultWidth: DEFAULT_CHAT_WIDTH_PX,
      setWidth: next => show(next),
      clock: stage.clock
    });
    function show(width: number): void {
      root.style.setProperty('--theater-video-width', `calc(100vw - ${width}px)`);
      chat.style.width = `${width}px`;
      separator.update({ shown: true, width });
    }
    show(args.width);
    mountPlayerUi(separator.element);
    const host = document.getElementById('theater-everywhere-ui')!;
    // The runtime paints the UI host with the configured accent; the separator inherits it.
    applyUiDirection(host);
    applyAccentColorPreset(host, args.accent);
    scope.add(() => separator.element.remove());

    const element = separator.element;
    if (args.state === 'hover') element.dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'mouse' }));
    if (args.state === 'focus') element.focus();
    if (args.state === 'dragging') {
      element.dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'mouse' }));
      const box = element.getBoundingClientRect();
      const pointer = { pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0, buttons: 1, clientY: box.top + box.height / 2, bubbles: true, cancelable: true };
      element.dispatchEvent(new PointerEvent('pointerdown', { ...pointer, clientX: box.left + box.width / 2 }));
      element.dispatchEvent(new PointerEvent('pointermove', { ...pointer, clientX: box.left + box.width / 2 - 60 }));
      if (args.settle) stage.advance(CHAT_SEPARATOR_SETTLE_MS);
    }
    stage.settle();
    return stage.view;
  }
};
export default meta;

type Story = StoryObj<Args>;

const separator = () => queryPlayerUi<HTMLElement>('.theater-chat-separator')!;

export const Idle: Story = {
  play: async ({ args }) => {
    await expect(separator().getAttribute('role')).toBe('separator');
    await expect(separator().getAttribute('aria-orientation')).toBe('vertical');
    await expect(separator().getAttribute('aria-label')).toBe(t('nativeChatResize'));
    await expect(separator().getAttribute('aria-valuenow')).toBe(String(args.width + (args.settle ? 60 : 0)));
    await expect(separator().getAttribute('aria-valuemin')).toBe(String(MIN_CHAT_WIDTH_PX));
    await expect(separator().getAttribute('aria-valuemax')).toBe(String(MAX_CHAT_WIDTH_PX));
    await expect(separator().hasAttribute('data-hover')).toBe(args.state === 'hover' || args.state === 'dragging');
    await expect(separator().hasAttribute('data-dragging')).toBe(args.state === 'dragging');
    await expect(separator().querySelectorAll('.theater-chat-separator-overlay').length).toBe(args.state === 'dragging' ? 1 : 0);
    if (args.state === 'focus') await waitFor(() => expect(separator().matches(':focus')).toBe(true));
    // The preview frame follows the pointer before the chat takes the width.
    if (args.state === 'dragging') await waitFor(() => expect(separator().style.transform).toBe(args.settle ? '' : 'translateX(-60px)'));
  }
};
export const Hover: Story = { ...Idle, args: { state: 'hover' } };
export const Focus: Story = { ...Idle, args: { state: 'focus' } };
export const Dragging: Story = { ...Idle, args: { state: 'dragging' } };
export const PaleAccent: Story = { ...Idle, args: { state: 'hover', accent: 'yellow' } };

/** Resting the pointer applies the previewed width while the drag goes on. */
export const DragSettles: Story = {
  tags: ['no-shot'],
  args: { state: 'dragging', settle: true },
  play: async context => { await Idle.play?.(context); }
};

/** Keyboard steps and the double-click reset go through the same `setWidth` as a drag. */
export const KeyboardAndReset: Story = {
  tags: ['no-shot'],
  args: { width: 400 },
  play: async () => {
    const element = separator();
    element.focus();
    const press = (key: string, shiftKey = false) => element.dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true, composed: true }));
    press('ArrowLeft');
    await expect(element.getAttribute('aria-valuenow')).toBe('410');
    press('ArrowRight', true);
    await expect(element.getAttribute('aria-valuenow')).toBe('360');
    press('End');
    await expect(element.getAttribute('aria-valuenow')).toBe(String(MAX_CHAT_WIDTH_PX));
    press('ArrowLeft');
    await expect(element.getAttribute('aria-valuenow')).toBe(String(MAX_CHAT_WIDTH_PX));
    press('Home');
    await expect(element.getAttribute('aria-valuenow')).toBe(String(MIN_CHAT_WIDTH_PX));
    element.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
    await expect(element.getAttribute('aria-valuenow')).toBe(String(DEFAULT_CHAT_WIDTH_PX));
  }
};
