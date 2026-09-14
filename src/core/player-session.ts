import { DisposableScope } from './disposable-scope';
import { createSessionId } from '../protocol/frame-messages';
import { emptyMediaSnapshot, type MediaSnapshot } from './media-snapshot';

export type SessionKind = 'idle' | 'binding' | 'active' | 'exiting' | 'disposed';
export type ExitOrigin = 'local' | 'network';
export type ExitFrom = 'parent' | 'child' | 'self';

export type SessionState =
  | { kind: 'idle' }
  | { kind: 'binding'; epoch: number }
  | { kind: 'active'; epoch: number; snapshot: MediaSnapshot }
  | { kind: 'exiting'; epoch: number }
  | { kind: 'disposed' };

export type PlayerCommand =
  | { type: 'EXIT'; origin?: ExitOrigin; sessionId?: string; from?: ExitFrom }
  | { type: 'PLAY_PAUSE' }
  | { type: 'SEEK_BY'; delta: number }
  | { type: 'TOGGLE_CAPTIONS' }
  | { type: 'CYCLE_VIDEO'; direction?: 'next' | 'prev' }
  | { type: 'CYCLE_FIT' }
  | { type: 'TOGGLE_HELP' };

export class PlayerSession {
  private epoch = 0;
  private scope = new DisposableScope();
  private abort = new AbortController();
  private kind: SessionKind = 'idle';
  private snapshot: MediaSnapshot = emptyMediaSnapshot();
  private host: HTMLElement | null = null;
  id: string | null = null;
  nonce: string | null = null;

  get state(): SessionState {
    if (this.kind === 'idle') return { kind: 'idle' };
    if (this.kind === 'disposed') return { kind: 'disposed' };
    if (this.kind === 'binding') return { kind: 'binding', epoch: this.epoch };
    if (this.kind === 'exiting') return { kind: 'exiting', epoch: this.epoch };
    return { kind: 'active', epoch: this.epoch, snapshot: this.snapshot };
  }

  get currentEpoch(): number {
    return this.epoch;
  }

  get runtimeScope(): DisposableScope {
    return this.scope;
  }

  get signal(): AbortSignal {
    return this.abort.signal;
  }

  get element(): HTMLElement | null {
    return this.host;
  }

  get isExiting(): boolean {
    return this.kind === 'exiting';
  }

  get isIdle(): boolean {
    return this.kind === 'idle' || this.kind === 'disposed';
  }

  get hasUi(): boolean {
    return this.host != null || (this.id != null && !this.isIdle);
  }

  ensureNonce(): string {
    if (!this.nonce) this.nonce = createSessionId();
    return this.nonce;
  }

  matches(sessionId?: string, source: ExitOrigin = 'local'): boolean {
    if (source === 'network') {
      if (!sessionId) return !this.id;
      if (!this.id) return true;
      return sessionId === this.id;
    }
    if (!sessionId) return true;
    if (!this.id) return true;
    return sessionId === this.id;
  }

  bind(sessionId?: string, nonce?: string): { epoch: number; id: string; nonce: string } {
    this.epoch += 1;
    if (!this.abort.signal.aborted) this.abort.abort();
    this.abort = new AbortController();
    this.id = sessionId || this.id || createSessionId();
    this.nonce = nonce || this.nonce || createSessionId();
    this.kind = 'binding';
    this.snapshot = emptyMediaSnapshot();
    return { epoch: this.epoch, id: this.id, nonce: this.nonce };
  }

  rebind(
    element: HTMLElement,
    sessionId?: string,
    nonce?: string
  ): { epoch: number; id: string; nonce: string } {
    const bound = this.bind(sessionId, nonce);
    this.host = element;
    return bound;
  }

  activate(epoch = this.epoch): boolean {
    if (this.kind === 'active' && this.epoch === epoch) return true;
    if (this.kind !== 'binding' || this.epoch !== epoch) return false;
    this.kind = 'active';
    return true;
  }

  publishSnapshot(snapshot: MediaSnapshot, epoch: number): boolean {
    if (this.kind !== 'active' || this.epoch !== epoch) return false;
    this.snapshot = snapshot;
    return true;
  }

  dispatch(command: PlayerCommand): boolean {
    if (command.type === 'EXIT') {
      return this.beginExit(command.sessionId, command.origin ?? 'local');
    }
    if (!this.host || this.kind === 'exiting' || this.kind === 'disposed') return false;
    return true;
  }

  beginExit(sessionId?: string, source: ExitOrigin = 'local'): boolean {
    if (this.kind === 'exiting' || this.kind === 'disposed') return false;
    if (!this.host && !this.id) return false;
    if (!this.matches(sessionId, source)) return false;
    this.kind = 'exiting';
    return true;
  }

  tryBeginExit(): boolean {
    return this.beginExit(undefined, 'local');
  }

  finishExit(): void {
    this.host = null;
    this.id = null;
    this.nonce = null;
    this.snapshot = emptyMediaSnapshot();
    this.kind = this.kind === 'disposed' ? 'disposed' : 'idle';
  }

  resetRuntimeScope(): DisposableScope {
    this.scope.dispose();
    this.scope = new DisposableScope();
    return this.scope;
  }

  dispose(): void {
    if (this.kind === 'disposed') return;
    this.kind = 'disposed';
    this.host = null;
    this.id = null;
    this.nonce = null;
    this.snapshot = emptyMediaSnapshot();
    if (!this.abort.signal.aborted) this.abort.abort();
    this.scope.dispose();
  }
}
