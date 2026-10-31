import { afterEach, describe, expect, test } from 'vitest';
import { userEvent } from 'vitest/browser';

import { manualClock } from '../../.storybook/manual-clock';
import { DisposableScope } from '../core/disposable-scope';
import type { EndScreenSource } from '../core/end-screen';
import type { ServiceActionSource } from '../core/service-actions';
import { APPEARANCE_MODES, blockingViolations } from '../test-utils/axe';

import { ENDED_CURTAIN_CLASS, ENDED_CURTAIN_DELAY_MS, mountEndedCurtain, REPLAY_ICON } from './ended-curtain';
import { t } from './messages';
import { getPlayerUiRoot, mountPlayerUi, queryPlayerUi } from './root';
import { setSvgIcon } from './svg-icon';

/** The media state the curtain reads, driven like an element: each change fires the event a real one would. */
class FakeMedia extends EventTarget {
  ended = false;
  duration = 2;
  emit(type: string, ended = this.ended): void {
    this.ended = ended;
    this.dispatchEvent(new Event(type));
  }
}

let scope: DisposableScope | undefined;
afterEach(() => { scope?.dispose(); scope = undefined; });

function bar(label: string, hidden = false): HTMLButtonElement {
  const button = document.createElement('button');
  button.className = 'theater-control-btn';
  button.setAttribute('aria-label', label);
  button.hidden = hidden;
  setSvgIcon(button, REPLAY_ICON);
  return button;
}

/**
 * A service-action source whose host may offer its own next step after the end. Like a provider's DOM watch, a
 * subscription reads at once; `live` counts the subscriptions still open.
 */
function hostSource(offers = false) {
  const host = { offers, live: 0, subscribed: 0, changed: () => {} };
  const source: ServiceActionSource = {
    read: () => [], activate: () => false,
    hostEndsPlayback: () => host.offers,
    subscribe(changed) {
      host.live += 1;
      host.subscribed += 1;
      host.changed = changed;
      changed();
      return () => { host.live -= 1; host.changed = () => {}; };
    }
  };
  const set = (value: boolean) => { host.offers = value; host.changed(); };
  return { host, source, set };
}

function mount({ next = false, duration = 2, source = undefined as EndScreenSource | undefined,
  host = undefined as ServiceActionSource | undefined } = {}) {
  scope = new DisposableScope();
  const clock = manualClock();
  const media = new FakeMedia();
  media.duration = duration;
  const play = bar(t('play'));
  const nextButton = bar(t('nextVideo'), !next);
  // The production bar lives in the same root; the curtain hands focus back to it.
  const row = document.createElement('div');
  row.style.pointerEvents = 'auto';
  row.append(play, nextButton);
  mountPlayerUi(row);
  const reports: boolean[] = [];
  const clicks: string[] = [];
  play.addEventListener('click', () => clicks.push('play'));
  nextButton.addEventListener('click', () => clicks.push('next'));
  mountEndedCurtain({ mountPlayerUi, t }, scope, media, [play, nextButton], shown => {
    reports.push(shown);
    // As the bar does: the play button turns into Replay before the curtain mirrors it.
    play.setAttribute('aria-label', t(shown ? 'replay' : 'play'));
  }, clock, source, host);
  const curtain = () => queryPlayerUi<HTMLElement>(`.${ENDED_CURTAIN_CLASS}`);
  const mirrors = () => [...curtain()?.querySelectorAll('button') ?? []];
  const end = () => { media.emit('ended', true); clock.advance(ENDED_CURTAIN_DELAY_MS); };
  return { scope, clock, media, play, nextButton, reports, clicks, curtain, mirrors, end };
}

describe('ended curtain', () => {
  test('a provider gets a fresh mount epoch, disposed before hide and on controls teardown', () => {
    const mounts: DisposableScope[] = [];
    let disposed = false;
    const source: EndScreenSource = {
      mount(container, owner, label) {
        mounts.push(owner);
        const node = document.createElement('div');
        node.textContent = label;
        container.append(node);
        owner.add(() => node.remove());
      },
      hostEndsPlayback: () => false, subscribe: () => () => {}, dispose: () => { disposed = true; }
    };
    const { end, media, curtain, scope: owner } = mount({ source });
    end();
    expect(curtain()!.textContent).toContain(t('endScreenSuggestions'));
    media.emit('seeking', false);
    expect(mounts[0]!.isDisposed).toBe(true);
    end();
    expect(mounts[1]).not.toBe(mounts[0]);
    expect(mounts[1]!.isDisposed).toBe(false);
    owner.dispose();
    owner.dispose();
    expect(mounts[1]!.isDisposed).toBe(true);
    expect(disposed).toBe(true);
    expect(curtain()).toBeNull();
  });
  test('yields the entire curtain to a host countdown and restores the plain fallback', () => {
    let owned = true;
    let changed = () => {};
    const source: EndScreenSource = { mount() {}, hostEndsPlayback: () => owned,
      subscribe: fn => { changed = fn; return () => {}; }, dispose() {} };
    const { end, curtain, clock } = mount({ source });
    end();
    expect(curtain()).toBeNull();
    owned = false;
    changed();
    clock.advance(ENDED_CURTAIN_DELAY_MS);
    expect(curtain()).not.toBeNull();
    expect(curtain()!.querySelector('.theater-end-screen')).toBeNull();
    owned = true;
    changed();
    expect(curtain()).toBeNull();
  });
  test('yields to the host only while it offers its own next step, read when the grace ends', () => {
    const finale = hostSource();
    const { end, curtain, clock, media } = mount({ host: finale.source });
    end();
    expect(curtain(), 'a finale without a host step gets the curtain').not.toBeNull();
    finale.set(true);
    expect(curtain(), 'a next step that appears late takes it down').toBeNull();
    finale.set(false);
    clock.advance(ENDED_CURTAIN_DELAY_MS - 1);
    expect(curtain(), 'a cancelled countdown waits out the grace').toBeNull();
    clock.advance(1);
    expect(curtain()).not.toBeNull();
    media.emit('seeking', false);
    expect(curtain()).toBeNull();
    scope!.dispose();

    const offered = hostSource(true);
    const next = mount({ host: offered.source });
    next.media.emit('ended', true);
    offered.set(false);
    offered.set(true);
    next.clock.advance(ENDED_CURTAIN_DELAY_MS);
    expect(next.curtain(), 'evaluated when the grace ends, not when it starts').toBeNull();
    expect(next.reports).toEqual([]);
  });

  test('watches the host only while ended, and never one without a next step to offer', () => {
    const { host, source } = hostSource();
    const { media, end, scope: owner } = mount({ host: source });
    expect(host.live, 'no watch during playback').toBe(0);
    end();
    media.emit('ended', true);
    expect([host.live, host.subscribed]).toEqual([1, 1]);
    for (const leave of ['seeking', 'loadstart', 'emptied']) {
      media.emit(leave, false);
      expect(host.live, leave).toBe(0);
      end();
      expect(host.live, leave).toBe(1);
    }
    owner.dispose();
    owner.dispose();
    expect(host.live, 'disposal ends the watch once').toBe(0);

    let subscribed = 0;
    const plain: ServiceActionSource = { read: () => [], activate: () => false, subscribe: () => { subscribed += 1; return () => {}; } };
    const other = mount({ host: plain });
    other.end();
    expect(other.curtain()).not.toBeNull();
    expect(subscribed).toBe(0);
  });

  test('shows only after the grace on a real end, and announces it once', async () => {
    const { clock, media, curtain, reports } = mount();
    // Paused a moment before the end: not an end.
    media.emit('pause', false);
    clock.advance(ENDED_CURTAIN_DELAY_MS * 4);
    expect(curtain()).toBeNull();
    media.emit('ended', true);
    clock.advance(ENDED_CURTAIN_DELAY_MS - 1);
    expect(curtain(), 'a hand-off inside the grace never flashes it').toBeNull();
    clock.advance(1);
    expect(curtain()).not.toBeNull();
    expect(reports).toEqual([true]);
    await expect.poll(() => getPlayerUiRoot().getElementById('theater-announcements')?.textContent).toBe(t('videoEnded'));
  });

  test('new media inside the grace cancels it', () => {
    for (const type of ['loadstart', 'emptied']) {
      const { clock, media, curtain, reports } = mount();
      media.emit('ended', true);
      media.emit(type, false);
      clock.advance(ENDED_CURTAIN_DELAY_MS * 2);
      expect(curtain(), type).toBeNull();
      expect(reports, type).toEqual([]);
      expect(clock.pending, type).toBe(0);
      scope!.dispose();
    }
  });

  test('a live stream (infinite duration) never shows it', () => {
    const { clock, media, curtain } = mount({ duration: Infinity });
    media.emit('ended', true);
    clock.advance(ENDED_CURTAIN_DELAY_MS * 2);
    expect(curtain()).toBeNull();
  });

  test('replay, a seek back and new media take it down; a new end brings it back', () => {
    const { media, curtain, reports, end } = mount();
    for (const leave of ['seeking', 'loadstart', 'emptied']) {
      end();
      expect(curtain(), leave).not.toBeNull();
      media.emit(leave, false);
      expect(curtain(), leave).toBeNull();
    }
    // A seek that lands on the end again keeps it.
    end();
    media.emit('seeking', true);
    expect(curtain()).not.toBeNull();
    expect(reports).toEqual([true, false, true, false, true, false, true]);
  });

  test('mirrors the bar: Replay always, Next only while playlist navigation offers it', () => {
    const hidden = mount();
    hidden.end();
    expect(hidden.mirrors().map(button => button.getAttribute('aria-label'))).toEqual([t('replay')]);
    expect(hidden.mirrors()[0]!.querySelector('svg')).not.toBeNull();
    scope!.dispose();
    const shown = mount({ next: true });
    shown.end();
    expect(shown.mirrors().map(button => button.getAttribute('aria-label'))).toEqual([t('replay'), t('nextVideo')]);
  });

  test('pointer and keyboard activate the bar control itself; focus never stays in a leaving curtain', async () => {
    const { media, mirrors, clicks, play, nextButton, end } = mount({ next: true });
    end();
    await userEvent.click(mirrors()[1]!);
    expect(clicks).toEqual(['next']);
    expect(getPlayerUiRoot().activeElement, 'a pointer press leaves no focus behind').not.toBe(mirrors()[1]);
    mirrors()[0]!.focus();
    await userEvent.keyboard('{Enter}');
    expect(clicks).toEqual(['next', 'play']);
    media.emit('seeking', false);
    expect(getPlayerUiRoot().activeElement, 'keyboard focus returns to the bar').toBe(play);
    expect(nextButton.isConnected).toBe(true);
  });

  test('fades in, and appears at once with Reduce motion', () => {
    const { end, curtain } = mount();
    end();
    const fade = () => curtain()!.getAnimations()[0]?.effect?.getComputedTiming().duration;
    expect(fade()).toBe(240);
    scope!.dispose();
    const host = getPlayerUiRoot().host as HTMLElement;
    host.dataset.motion = 'reduced';
    try {
      const reduced = mount();
      reduced.end();
      expect(Number(fade())).toBeLessThan(1);
    } finally {
      delete host.dataset.motion;
    }
  });

  test('disposal removes the node, the timer and the listeners, and is safe to repeat', () => {
    const { scope: owner, clock, media, curtain, reports, end } = mount();
    end();
    media.emit('ended', true);
    owner.dispose();
    owner.dispose();
    expect(curtain()).toBeNull();
    expect(reports).toEqual([true, false]);
    media.emit('ended', true);
    expect(clock.pending, 'no listener schedules after disposal').toBe(0);
    // Pending grace at disposal is dropped too.
    const pending = mount();
    pending.media.emit('ended', true);
    pending.scope.dispose();
    expect(pending.clock.pending).toBe(0);
    expect(pending.reports).toEqual([]);
  });

  for (const mode of APPEARANCE_MODES) {
    test(`has no serious accessibility violations: ${mode.name}`, async () => {
      const host = getPlayerUiRoot().host as HTMLElement;
      mode.apply(host);
      await expect.poll(() => mode.applied(host)).toBe(true);
      mount({ next: true }).end();
      expect(await blockingViolations(host)).toEqual([]);
    });
  }
});
