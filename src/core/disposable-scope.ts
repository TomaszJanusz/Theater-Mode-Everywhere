type Disposer = () => void;

export class DisposableScope {
  private disposed = false;
  private readonly disposers = new Set<Disposer>();
  private readonly abort = new AbortController();

  get signal(): AbortSignal {
    return this.abort.signal;
  }

  get isDisposed(): boolean {
    return this.disposed;
  }

  /** Registers a distinct cleanup entry and returns a function that forgets it. */
  add(dispose: Disposer): Disposer {
    if (this.disposed) {
      dispose();
      return () => {};
    }
    // Wrapping preserves multiple registrations of the same disposer.
    const entry = () => dispose();
    this.disposers.add(entry);
    return () => { this.disposers.delete(entry); };
  }

  listen<K extends keyof WindowEventMap>(
    target: Window, type: K, listener: (event: WindowEventMap[K]) => void, options?: boolean | AddEventListenerOptions
  ): void;
  listen<K extends keyof DocumentEventMap>(
    target: Document, type: K, listener: (event: DocumentEventMap[K]) => void, options?: boolean | AddEventListenerOptions
  ): void;
  listen<K extends keyof HTMLElementEventMap>(
    target: HTMLElement, type: K, listener: (event: HTMLElementEventMap[K]) => void, options?: boolean | AddEventListenerOptions
  ): void;
  listen(
    target: EventTarget, type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions
  ): void;
  listen(
    target: EventTarget,
    type: string,
    listener: EventListenerOrEventListenerObject | ((event: never) => void),
    options?: boolean | AddEventListenerOptions
  ): void {
    const wrapped = listener as EventListenerOrEventListenerObject;
    target.addEventListener(type, wrapped, options);
    this.add(() => target.removeEventListener(type, wrapped, options));
  }

  timeout(handler: () => void, ms: number): ReturnType<typeof setTimeout> {
    // Keep the opaque-handle API without creating work for a disposed scope.
    if (this.disposed) return 0 as unknown as ReturnType<typeof setTimeout>;
    let unregister: Disposer = () => {};
    const id = setTimeout(() => {
      unregister();
      if (!this.disposed) handler();
    }, ms);
    unregister = this.add(() => clearTimeout(id));
    return id;
  }

  raf(handler: FrameRequestCallback): number {
    if (this.disposed) return 0;
    if (typeof requestAnimationFrame !== 'function') {
      const id = this.timeout(() => handler(0), 0);
      return id as unknown as number;
    }
    let unregister: Disposer = () => {};
    const id = requestAnimationFrame((time) => {
      unregister();
      if (!this.disposed) handler(time);
    });
    unregister = this.add(() => cancelAnimationFrame(id));
    return id;
  }

  child(): DisposableScope {
    const child = new DisposableScope();
    const unregister = this.add(() => child.dispose());
    child.add(unregister);
    return child;
  }

  /**
   * Aborts the scope and runs its cleanup callbacks once, in reverse registration order.
   * Cleanup failures do not prevent remaining callbacks from running.
   */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (!this.abort.signal.aborted) {
      this.abort.abort();
    }
    const pending = Array.from(this.disposers).reverse();
    this.disposers.clear();
    for (const dispose of pending) {
      try {
        dispose();
      } catch {
        // Isolation: one failing disposer must not skip the rest.
      }
    }
  }
}
