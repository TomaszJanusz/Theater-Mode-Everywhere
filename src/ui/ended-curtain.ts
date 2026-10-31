import { DisposableScope } from '../core/disposable-scope';
import type { EndScreenSource } from '../core/end-screen';
import type { PlaybackSurface } from '../playback-surface';

import { strokeIcon, type HudHost } from './hud';
import { HUD_PLATE_CLASS } from './hud-plate';
import { announcePlayerStatus } from './root';
import { systemClock, type UiClock } from './ui-clock';

/** A host that hands over to its next item (a playlist, a queue) does so within this, so the curtain never flashes. */
export const ENDED_CURTAIN_DELAY_MS = 300;
export const ENDED_CURTAIN_CLASS = 'theater-ended-curtain';
export const REPLAY_ICON = strokeIcon('<path d="M4 12a8 8 0 1 0 2.3-5.7L4 8.6M4 4v4.6h4.6"/>', 18);

/**
 * Events after which `ended` may have changed: the end, a seek (replaying ended media seeks to the start) and new media,
 * an ad in the same element included (`emptied` too, since a load without a source fires no `loadstart`).
 */
const EVENTS = ['ended', 'seeking', 'emptied', 'loadstart'];

/**
 * Covers the picture in black once the media has really ended. Only `ended` counts: never a pause near the end, a loop
 * (which never ends) or a live stream (infinite duration). It shows after ENDED_CURTAIN_DELAY_MS and leaves on replay,
 * a seek back or new media.
 *
 * In the middle it mirrors `controls`, the bar's play button (which `changed(true)` has just turned into Replay) and
 * its Next: the same label, icon and action, for pointer and keyboard alike. Hidden controls are left out.
 * `scope` owns it: disposal (rebind, theater exit) removes the node, the timer and the listeners, and reports
 * `changed(false)` when it was showing.
 */
// Positional like createHud: content.js keeps every option name, and its size budget is spent.
// eslint-disable-next-line max-params -- the alternative options object costs the shared bundle bytes it does not have
export function mountEndedCurtain(
  ctx: Pick<HudHost, 'mountPlayerUi' | 't'>,
  scope: DisposableScope,
  media: Pick<PlaybackSurface, 'ended' | 'duration' | 'addEventListener' | 'removeEventListener'>,
  controls: readonly [HTMLButtonElement, ...HTMLButtonElement[]],
  changed: (shown: boolean) => void,
  clock: UiClock = systemClock,
  source?: EndScreenSource
): void {
  let curtain: HTMLElement | null = null;
  let timer: number | undefined;
  let mountScope: DisposableScope | undefined;
  const show = (shown: boolean) => {
    if (shown === Boolean(curtain)) return;
    if (curtain) {
      // Focus that leaves with the curtain goes back to the bar, not to the host page.
      const focused = curtain.matches(':focus-within');
      mountScope?.dispose();
      curtain.remove();
      curtain = null;
      changed(false);
      if (focused) controls[0].focus();
      return;
    }
    changed(true);
    curtain = document.createElement('div');
    curtain.className = ENDED_CURTAIN_CLASS;
    for (const control of controls) {
      if (control.hidden) continue;
      // A deep clone carries the label and icon; listeners are not cloned, so a click goes to the control itself.
      const mirror = control.cloneNode(true) as HTMLButtonElement;
      mirror.className = `theater-home-pill ${HUD_PLATE_CLASS}`;
      mirror.addEventListener('click', event => {
        // A pointer press leaves no focus in a control that is about to go, where the host could take it.
        if (event.detail) mirror.blur();
        control.click();
      });
      curtain.append(mirror);
    }
    ctx.mountPlayerUi(curtain);
    if (source) {
      mountScope = new DisposableScope();
      source.mount(curtain, mountScope, ctx.t('endScreenSuggestions'));
    }
    announcePlayerStatus(ctx.t('videoEnded'));
  };
  const ended = () => media.ended && media.duration < Infinity && !source?.hostEndsPlayback();
  const sync = () => {
    if (scope.isDisposed) return;
    clock.clearTimeout(timer);
    if (!ended()) show(false);
    // The timer re-reads the media: what changed meanwhile without an event still counts.
    else if (!curtain) timer = clock.setTimeout(() => { if (!scope.isDisposed && ended()) show(true); }, ENDED_CURTAIN_DELAY_MS);
  };
  for (const type of EVENTS) scope.listen(media, type, sync);
  if (source) scope.add(source.subscribe(sync));
  // A rebuild of the controls, or entry, on media that has already ended shows it too.
  sync();
  scope.add(() => {
    clock.clearTimeout(timer);
    show(false);
    source?.dispose();
  });
}
