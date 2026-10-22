import { expect, test } from 'vitest';

import { createNavigation } from '../../src/ui/navigation';
import { getPlayerUiRoot } from '../../src/ui/root';
import type { PlayerChromeContext } from '../../src/ui/runtime-context';
import { defaultShortcuts } from '../../src/ui/shortcuts';
import { prepare } from '../fixture-test';
import { renderPlayerBar } from '../player-stage';
import { disposeStage } from '../stage-owner';

// Focus movement and its short settle animation, on the production bar markup. The animation is WAAPI
// (no timers), so no clock is needed: cases read the animations themselves.

function mount(): ReturnType<typeof createNavigation> & { calls: { showToolbar: number; hideToolbar: number } } {
  renderPlayerBar(() => ['.player-settings-btn', '.cc-btn', '.pip-btn'].map(selector => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `theater-control-btn ${selector.slice(1)}`;
    button.textContent = selector.slice(1, 3);
    return button;
  }));
  const calls = { showToolbar: 0, hideToolbar: 0 };
  const ctx = {
    queryPlayerUi: (selector: string) => getPlayerUiRoot().querySelector(selector),
    refs: { toolbarKeyboardInteractionActive: false },
    actions: {
      showToolbar: () => { calls.showToolbar += 1; },
      hideToolbar: () => { calls.hideToolbar += 1; },
      focusTheaterPage: () => {},
      scheduleToolbarHide: () => {},
      updateCaptionDock: () => {}
    }
  } as unknown as PlayerChromeContext;
  return Object.assign(createNavigation(ctx), { calls });
}

const key = (code: string) => new KeyboardEvent('keydown', { code, key: code.slice(3).toLowerCase(), bubbles: true, cancelable: true });
const button = (name: string) => getPlayerUiRoot().querySelector<HTMLElement>(`.${name}`)!;
const active = () => getPlayerUiRoot().activeElement as HTMLElement | null;
const running = (element: HTMLElement) => element.getAnimations().filter(animation => animation.effect && !(animation instanceof CSSTransition));

test('FocusMovesAtOnceAndSettlesFromTheDirectionOfTravel', async () => {
  await prepare({});
  const navigation = mount();
  expect(navigation.handleKeydown(key('KeyW'), defaultShortcuts)).toBe(true);
  expect(active()).toBe(button('player-settings-btn'));
  // From the first button, D lands on the next one immediately; the settle only paints.
  expect(navigation.handleKeydown(key('KeyD'), defaultShortcuts)).toBe(true);
  expect(active()).toBe(button('cc-btn'));
  const settle = running(button('cc-btn'));
  expect(settle.length).toBe(1);
  const frames = (settle[0].effect as KeyframeEffect).getKeyframes();
  expect(Object.keys(frames[0])).toEqual(expect.arrayContaining(['translate', 'scale', 'opacity']));
  expect(String(frames[0].translate)).toMatch(/^-4px( 0px)?$/);
  expect(Number(settle[0].effect!.getTiming().duration)).toBeLessThanOrEqual(200);
});

test('AQuickerMoveReplacesTheSettleInFlight', async () => {
  await prepare({});
  const navigation = mount();
  navigation.handleKeydown(key('KeyW'), defaultShortcuts);
  navigation.handleKeydown(key('KeyD'), defaultShortcuts);
  const first = running(button('cc-btn'))[0];
  navigation.handleKeydown(key('KeyD'), defaultShortcuts);
  expect(active()).toBe(button('pip-btn'));
  expect(first.playState).toBe('idle');
  expect(running(button('pip-btn')).length).toBe(1);
});

test('OtherKeysAndInactiveMovesPassThrough', async () => {
  await prepare({});
  const navigation = mount();
  for (const code of ['KeyA', 'KeyS', 'KeyD']) expect(navigation.handleKeydown(key(code), defaultShortcuts)).toBe(false);
  expect(active()).toBeNull();
  navigation.handleKeydown(key('KeyW'), defaultShortcuts);
  expect(navigation.handleKeydown(key('KeyB'), defaultShortcuts)).toBe(false);
});

test('EndingTheModeCancelsMotionAndDropsFocusTracking', async () => {
  await prepare({});
  const navigation = mount();
  navigation.handleKeydown(key('KeyW'), defaultShortcuts);
  navigation.handleKeydown(key('KeyD'), defaultShortcuts);
  expect(navigation.isActive()).toBe(true);
  navigation.end();
  navigation.end();
  expect(navigation.isActive()).toBe(false);
  expect(running(button('cc-btn')).length).toBe(0);
  // Without the mode a lone D is the page's again.
  expect(navigation.handleKeydown(key('KeyD'), defaultShortcuts)).toBe(false);
});

test('BottomRowDownHidesTheBarOnceAndLeavesTheMode', async () => {
  await prepare({});
  const navigation = mount();
  navigation.handleKeydown(key('KeyW'), defaultShortcuts);
  expect(navigation.handleKeydown(key('KeyS'), defaultShortcuts)).toBe(true);
  expect(navigation.calls.hideToolbar).toBe(1);
  expect(navigation.isActive()).toBe(false);
  expect(active()).toBeNull();
});

test('ReducedMotionMovesFocusWithoutMovement', async () => {
  await prepare({ reduceMotion: 'on' });
  const navigation = mount();
  navigation.handleKeydown(key('KeyW'), defaultShortcuts);
  navigation.handleKeydown(key('KeyD'), defaultShortcuts);
  expect(active()).toBe(button('cc-btn'));
  expect(running(button('cc-btn')).length).toBe(0);
});

test('DisposingTheStageEndsNothingLeftBehind', async () => {
  await prepare({});
  const navigation = mount();
  navigation.handleKeydown(key('KeyW'), defaultShortcuts);
  disposeStage();
  expect(navigation.handleKeydown(key('KeyD'), defaultShortcuts)).toBe(false);
  expect(navigation.isActive()).toBe(false);
});
