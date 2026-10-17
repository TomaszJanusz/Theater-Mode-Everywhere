/**
 * Separates a picture click (play/pause) from a double-click (fullscreen).
 *
 * A click waits out a short window before playback toggles, so a double-click
 * never pauses and resumes visibly. Like YouTube, a second click cancels the
 * pending one rather than restarting it, and the dblclick that follows in the
 * same task turns the pair into fullscreen. When the browser sends no dblclick
 * (pointer slop, different targets) a zero-delay fallback still commits one
 * toggle, so a pair of clicks is never silently dropped.
 *
 * `preview` runs immediately on the first click so feedback does not wait for
 * the window; `revoke` withdraws it when the click turns out to be half of a
 * double-click or the gate is cancelled.
 *
 * Limit: a pair slower than the window but inside the browser's dblclick
 * threshold commits the first click before the dblclick arrives; fullscreen
 * still toggles once, but the first click's play/pause has already happened.
 */
export const PICTURE_DOUBLE_CLICK_MS = 200;

export interface PictureClickGate {
  click(): void;
  doubleClick(): void;
  /** Drop a pending click. Safe to repeat. */
  cancel(): void;
}

export interface PictureClickActions {
  commit: () => void;
  fullscreen: () => void;
  preview?: () => void;
  revoke?: () => void;
}

export function createPictureClickGate(
  actions: PictureClickActions,
  timers: {
    set: (fn: () => void, ms: number) => unknown;
    clear: (id: unknown) => void;
  } = {
    set: (fn, ms) => window.setTimeout(fn, ms),
    clear: id => window.clearTimeout(id as number)
  }
): PictureClickGate {
  let pending: unknown = null;
  let previewed = false;
  const drop = () => {
    if (pending == null) return;
    timers.clear(pending);
    pending = null;
  };
  const revoke = () => {
    if (!previewed) return;
    previewed = false;
    actions.revoke?.();
  };
  const schedule = (ms: number) => {
    pending = timers.set(() => {
      pending = null;
      previewed = false;
      actions.commit();
    }, ms);
  };
  return {
    click() {
      if (pending != null) {
        // Second click of a pair: wait for its dblclick in the same task.
        drop();
        schedule(0);
        return;
      }
      actions.preview?.();
      previewed = actions.preview != null;
      schedule(PICTURE_DOUBLE_CLICK_MS);
    },
    doubleClick() {
      drop();
      revoke();
      actions.fullscreen();
    },
    cancel() {
      drop();
      revoke();
    }
  };
}
