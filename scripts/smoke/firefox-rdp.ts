import net from 'node:net';

/**
 * Minimal Firefox remote-debugging (RDP) client: installs a temporary add-on the way
 * `web-ext run` does and evaluates code in its background context. Playwright cannot
 * drive `moz-extension:` pages in Firefox, so this is the only route to extension storage.
 * Packets are `<byte length>:<json>`; an actor answers one request at a time, so replies
 * are matched by their `from` actor.
 */
interface RdpPacket { from?: string; type?: string; error?: string; message?: string; [key: string]: unknown }

const REQUEST_TIMEOUT_MS = 30_000;

export class FirefoxRemote {
  private buffer = Buffer.alloc(0);
  private readonly replies = new Map<string, (packet: RdpPacket) => void>();
  private readonly evaluations = new Map<string, (packet: RdpPacket) => void>();
  private readonly settled = new Map<string, RdpPacket>();
  private readonly targets: Array<{ addonId?: string; url: string; consoleActor: string }> = [];
  private readonly failures = new Set<(error: Error) => void>();
  private failure: Error | null = null;

  private constructor(private readonly socket: net.Socket) {
    socket.on('data', chunk => this.receive(chunk));
    socket.on('error', error => this.fail(error));
    socket.on('close', () => this.fail(new Error('Firefox closed the debugger connection.')));
  }

  /** Connects once; Firefox has been listening by the time Playwright's launch resolves. */
  static connect(port: number): Promise<FirefoxRemote> {
    const remote = new FirefoxRemote(net.createConnection({ port, host: '127.0.0.1' }));
    // Firefox greets every client with a root packet before it accepts requests.
    return remote.expect('root').then(() => remote);
  }

  close(): void { this.socket.destroy(); }

  /** Installs the unpacked extension in `addonPath` as a temporary add-on and returns its id. */
  async installTemporaryAddon(addonPath: string): Promise<string> {
    const root = await this.request({ to: 'root', type: 'getRoot' });
    if (typeof root.addonsActor !== 'string') throw new Error('This Firefox build has no add-ons actor for temporary installation.');
    const installed = await this.request({ to: root.addonsActor, type: 'installTemporaryAddon', addonPath, openDevTools: false });
    const id = (installed.addon as { id?: unknown } | undefined)?.id;
    if (typeof id !== 'string') throw new Error(`Firefox did not report the installed add-on: ${JSON.stringify(installed)}`);
    return id;
  }

  /**
   * Console actor and `moz-extension:` origin of the add-on's background page, where
   * `browser`/`chrome` APIs are available. Watching frame targets reports every live
   * target before the request is acknowledged, so no polling is needed.
   */
  async background(addonId: string): Promise<{ consoleActor: string; origin: string }> {
    const { addons } = await this.request({ to: 'root', type: 'listAddons' }) as { addons?: Array<{ id: string; actor: string }> };
    const addon = addons?.find(candidate => candidate.id === addonId);
    if (!addon) throw new Error(`Firefox does not list add-on ${addonId}.`);
    const { actor: watcher } = await this.request({ to: addon.actor, type: 'getWatcher' }) as { actor?: string };
    if (!watcher) throw new Error(`Firefox gave no target watcher for add-on ${addonId}.`);
    await this.request({ to: watcher, type: 'watchTargets', targetType: 'frame' });
    const page = this.targets.find(target => target.addonId === addonId && target.url.endsWith('/_generated_background_page.html'));
    if (!page) throw new Error(`Add-on ${addonId} has no running background page.`);
    return { consoleActor: page.consoleActor, origin: page.url.slice(0, page.url.indexOf('/', 'moz-extension://'.length) + 1) };
  }

  /** Evaluates `expression`, which must be a promise of a string (the debugger awaits it), and returns that string. */
  async evaluateString(consoleActor: string, expression: string): Promise<string> {
    const { resultID } = await this.request({ to: consoleActor, type: 'evaluateJSAsync', text: expression, mapped: { await: true } }) as { resultID?: string };
    if (!resultID) throw new Error('Firefox debugger did not accept the evaluation.');
    const packet = await this.evaluationResult(resultID);
    if (packet.exception) throw new Error(`Background evaluation threw: ${String(packet.exceptionMessage ?? JSON.stringify(packet.exception))}`);
    const result = packet.result;
    if (typeof result === 'string') return result;
    const grip = result as { type?: string; actor?: string; length?: number } | undefined;
    if (grip?.type === 'longString' && grip.actor) {
      const { substring } = await this.request({ to: grip.actor, type: 'substring', start: 0, end: grip.length }) as { substring?: string };
      if (typeof substring === 'string') return substring;
    }
    throw new Error(`Background evaluation did not produce a string: ${JSON.stringify(result)}`);
  }

  private request(packet: { to: string; type: string; [key: string]: unknown }): Promise<RdpPacket> {
    const reply = this.expect(packet.to);
    const body = JSON.stringify(packet);
    this.socket.write(`${Buffer.byteLength(body)}:${body}`);
    return reply;
  }

  private expect(actor: string): Promise<RdpPacket> {
    return this.waitFor(packet => this.replies.set(actor, packet), () => this.replies.delete(actor), `an answer from ${actor}`);
  }

  private evaluationResult(resultID: string): Promise<RdpPacket> {
    const early = this.settled.get(resultID);
    if (early) { this.settled.delete(resultID); return Promise.resolve(early); }
    return this.waitFor(packet => this.evaluations.set(resultID, packet), () => this.evaluations.delete(resultID), `evaluation ${resultID}`);
  }

  private waitFor(register: (listener: (packet: RdpPacket) => void) => void, unregister: () => void, what: string): Promise<RdpPacket> {
    if (this.failure) return Promise.reject(this.failure);
    return new Promise((resolve, reject) => {
      const deadline = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
      const finish = () => { deadline.removeEventListener('abort', expire); this.failures.delete(abort); unregister(); };
      const abort = (error: Error) => { finish(); reject(error); };
      const expire = () => abort(new Error(`Firefox debugger sent no ${what} within ${REQUEST_TIMEOUT_MS} ms.`));
      deadline.addEventListener('abort', expire);
      this.failures.add(abort);
      register(packet => {
        finish();
        if (packet.error) reject(new Error(`Firefox debugger ${what}: ${packet.error} ${packet.message ?? ''}`.trim()));
        else resolve(packet);
      });
    });
  }

  private receive(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    for (;;) {
      const separator = this.buffer.indexOf(':');
      if (separator < 1) return;
      const length = Number(this.buffer.subarray(0, separator).toString());
      if (!Number.isInteger(length)) return this.fail(new Error('Malformed Firefox debugger packet length.'));
      const end = separator + 1 + length;
      if (this.buffer.length < end) return;
      const packet = JSON.parse(this.buffer.subarray(separator + 1, end).toString()) as RdpPacket;
      this.buffer = this.buffer.subarray(end);
      this.dispatch(packet);
    }
  }

  private dispatch(packet: RdpPacket): void {
    if (packet.type === 'evaluationResult' && typeof packet.resultID === 'string') {
      const listener = this.evaluations.get(packet.resultID);
      if (listener) listener(packet); else this.settled.set(packet.resultID, packet);
      return;
    }
    if (packet.type === 'target-available-form') {
      this.targets.push(packet.target as { addonId?: string; url: string; consoleActor: string });
      return;
    }
    // Other unsolicited events (tab list changes and the like) have no waiter and are dropped.
    const listener = packet.from ? this.replies.get(packet.from) : undefined;
    if (listener) listener(packet);
  }

  private fail(error: Error): void {
    if (this.failure) return;
    this.failure = error;
    for (const listener of [...this.failures]) listener(error);
    this.socket.destroy();
  }
}
