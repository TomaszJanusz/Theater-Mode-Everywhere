import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { ECHO_PRESETS, echoStage, type EchoCommand, type EchoLoader } from './echo-reduction';

class Param {
  value = 0;
  cancelScheduledValues() {}
  setValueAtTime(value: number) { this.value = value; }
  linearRampToValueAtTime(value: number) { this.value = value; }
}
class Node {
  outputs = new Set<Node>();
  gain = new Param();
  connect(node: Node) { this.outputs.add(node); return node; }
  disconnect(node?: Node) { if (node) this.outputs.delete(node); else this.outputs.clear(); }
}
class FakeWorkletNode extends Node {
  static created: FakeWorkletNode[] = [];
  sent: EchoCommand[] = [];
  closed = false;
  onprocessorerror: (() => void) | null = null;
  port = {
    onmessage: null as ((event: { data: unknown }) => void) | null,
    postMessage: (message: EchoCommand) => { this.sent.push(message); },
    close: () => { this.closed = true; }
  };
  constructor(readonly ctx: unknown, readonly name: string) {
    super();
    FakeWorkletNode.created.push(this);
  }
  reply(type: 'ready' | 'failed') { this.port.onmessage?.({ data: { type } }); }
}

/** A suspended context: crossfades settle at once, so reachability shows the effective state. */
function context() {
  return Object.assign(new EventTarget(), { currentTime: 0, state: 'suspended', createGain: () => new Node() });
}

function deferred() {
  let resolve!: (bytes: ArrayBuffer) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<ArrayBuffer>((ok, fail) => { resolve = ok; reject = fail; });
  const loader: EchoLoader & { calls: number } = Object.assign(() => { loader.calls++; return promise; }, { calls: 0 });
  return { loader, resolve, reject };
}

const flush = () => new Promise(resolve => setImmediate(resolve));

function setup(loader?: EchoLoader) {
  const ctx = context();
  let unavailable = 0;
  const stage = echoStage(ctx as unknown as BaseAudioContext, loader, () => { unavailable++; });
  const reaches = (node: Node) => {
    const seen = new Set<Node>();
    const visit = (next: Node) => { if (seen.has(next)) return; seen.add(next); next.outputs.forEach(visit); };
    visit(stage.input as unknown as Node);
    return seen.has(node);
  };
  return { stage, reaches, unavailable: () => unavailable };
}

describe('echo reduction stage', () => {
  const original = (globalThis as { AudioWorkletNode?: unknown }).AudioWorkletNode;
  beforeEach(() => {
    FakeWorkletNode.created = [];
    (globalThis as { AudioWorkletNode?: unknown }).AudioWorkletNode = FakeWorkletNode;
  });
  afterEach(() => { (globalThis as { AudioWorkletNode?: unknown }).AudioWorkletNode = original; });

  it('loads nothing while off, and stays dry until the worklet has compiled the DSP', async () => {
    const { loader, resolve } = deferred();
    const { stage, reaches } = setup(loader);
    stage.set('off');
    assert.equal(loader.calls, 0, 'off never loads the worklet');
    stage.set('light');
    stage.set('strong');
    assert.equal(loader.calls, 1, 'one load per stage');
    resolve(new ArrayBuffer(8));
    await flush();
    const [node] = FakeWorkletNode.created;
    assert.equal(node.sent[0].type, 'load');
    assert.equal(reaches(node), false, 'still dry while the worklet compiles');
    node.reply('ready');
    assert.equal(reaches(node), true);
    assert.deepEqual(node.sent.at(-1), { type: 'configure', ...ECHO_PRESETS.strong }, 'the level chosen meanwhile applies');
    stage.set('off');
    assert.equal(reaches(node), false, 'off disconnects the worklet');
    stage.set('light');
    assert.deepEqual(node.sent.at(-1), { type: 'configure', ...ECHO_PRESETS.light });
    assert.equal(reaches(node), true, 'and the same node comes back');
    stage.dispose();
    assert.equal(node.closed, true);
  });

  it('reports a failed compile once and stays dry for good', async () => {
    const { loader, resolve } = deferred();
    const { stage, reaches, unavailable } = setup(loader);
    stage.set('strong');
    resolve(new ArrayBuffer(8));
    await flush();
    const [node] = FakeWorkletNode.created;
    node.reply('failed');
    assert.equal(unavailable(), 1);
    assert.equal(node.closed, true);
    stage.set('light');
    node.reply('ready');
    assert.equal(loader.calls, 1, 'no retry on the same page');
    assert.equal(reaches(node), false);
    assert.equal(unavailable(), 1);
  });

  it('reports a page that cannot load the worklet', async () => {
    const { loader, reject } = deferred();
    const { stage, unavailable } = setup(loader);
    stage.set('light');
    reject(new Error('no AudioWorklet'));
    await flush();
    assert.equal(unavailable(), 1);
    assert.equal(FakeWorkletNode.created.length, 0);
    const withoutLoader = setup(undefined);
    withoutLoader.stage.set('light');
    assert.equal(withoutLoader.unavailable(), 1, 'a chain without a loader cannot reduce echo either');
  });

  it('ignores a load or a reply that arrives after the stage was disposed', async () => {
    const first = deferred();
    const early = setup(first.loader);
    early.stage.set('light');
    early.stage.dispose();
    first.resolve(new ArrayBuffer(8));
    await flush();
    assert.equal(FakeWorkletNode.created.length, 0, 'no node for a retired chain');

    const second = deferred();
    const late = setup(second.loader);
    late.stage.set('light');
    second.resolve(new ArrayBuffer(8));
    await flush();
    const [node] = FakeWorkletNode.created;
    late.stage.dispose();
    node.reply('failed');
    node.reply('ready');
    assert.equal(late.unavailable(), 0, 'a disposed stage reports nothing');
    assert.equal(late.reaches(node), false);
  });
});
