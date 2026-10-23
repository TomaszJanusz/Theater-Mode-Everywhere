/** The slice of `AudioContext` the playback lifecycle drives; tests inject a fake. */
export type PlaybackContext = {
  readonly state: AudioContextState;
  resume(): Promise<void>;
  suspend(): Promise<void>;
};

export type PlaybackReconciler = {
  /** Brings the context in line with playback; safe to call from any event. */
  reconcile(): void;
  /** Ends the lifecycle: a pending operation completes without further work. */
  dispose(): void;
};

type ReconcilerOptions = {
  context: PlaybackContext;
  isPlaying(): boolean;
  isAttached(): boolean;
  /** The media left its document; the owner must retire the graph. */
  onDetached(): void;
  onError(error: unknown): void;
};

/**
 * Keeps a context running exactly while its media plays. One resume/suspend is
 * in flight at a time; when it settles the state is reconciled again, so a pause
 * or replacement that arrived meanwhile is never lost. A context that is
 * `closed` is never touched.
 */
export function createPlaybackReconciler(options: ReconcilerOptions): PlaybackReconciler {
  const { context, isPlaying, isAttached, onDetached, onError } = options;
  let disposed = false;
  let pending = false;

  function reconcile(): void {
    if (disposed || pending) return;
    if (!isAttached()) { onDetached(); return; }
    const playing = isPlaying();
    if (context.state === 'closed' || (playing ? context.state !== 'suspended' : context.state !== 'running')) return;
    pending = true;
    void (playing ? context.resume() : context.suspend()).then(() => {
      pending = false;
      // A pause or replacement can arrive while resume is pending, and vice versa.
      if (!disposed) reconcile();
    }, error => {
      pending = false;
      if (!disposed) onError(error);
    });
  }

  return { reconcile, dispose() { disposed = true; } };
}

/**
 * Whether a freshly created context may capture the element. A context the
 * autoplay policy holds suspended would silence it, so without activation the
 * context must already run, or the browser must report that it may start
 * (Chromium starts an allowed context synchronously; Firefox reports its policy).
 */
export function contextMayCapture(options: { activated: boolean; state: AudioContextState; policy: string | undefined }): boolean {
  return options.activated || options.state === 'running' || options.policy === 'allowed';
}
