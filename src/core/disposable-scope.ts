type Disposer = () => void;

export class DisposableScope {
  private disposed = false;
  private readonly disposers: Disposer[] = [];
  private readonly abort = new AbortController();

  get signal(): AbortSignal {
    return this.abort.signal;
  }

  get isDisposed(): boolean {
    return this.disposed;
  }

  add(dispose: Disposer): void {
    if (this.disposed) {
      dispose();
      return;
    }
    this.disposers.push(dispose);
  }

  listen(
    target: EventTarget,
    type: string,
    listener: EventListenerOrEventListenerObject | ((event: any) => void),
    options?: boolean | AddEventListenerOptions
  ): void {
    const wrapped = listener as EventListenerOrEventListenerObject;
    target.addEventListener(type, wrapped, options);
    this.add(() => target.removeEventListener(type, wrapped, options as boolean | EventListenerOptions));
  }

  timeout(handler: () => void, ms: number): ReturnType<typeof setTimeout> {
    const id = setTimeout(handler, ms);
    this.add(() => clearTimeout(id));
    return id;
  }

  raf(handler: FrameRequestCallback): number {
    if (typeof requestAnimationFrame !== 'function') {
      const id = this.timeout(() => handler(0), 0);
      return id as unknown as number;
    }
    const id = requestAnimationFrame(handler);
    this.add(() => cancelAnimationFrame(id));
    return id;
  }

  child(): DisposableScope {
    const child = new DisposableScope();
    this.add(() => child.dispose());
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
    for (const dispose of this.disposers.splice(0).reverse()) {
      try {
        dispose();
      } catch {
        // Isolation: one failing disposer must not skip the rest.
      }
    }
  }
}
