import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createAudioCrossfade } from './audio-crossfade';

function fixture() {
  class Param {
    value = 1;
    ramps: number[] = [];
    cancelScheduledValues() {}
    setValueAtTime(value: number) { this.value = value; }
    linearRampToValueAtTime(value: number) { this.ramps.push(value); }
  }
  class Node {
    gain = new Param();
    outputs = new Set<Node>();
    connect(node: Node) { this.outputs.add(node); return node; }
    disconnect(node?: Node) { if (node) this.outputs.delete(node); else this.outputs.clear(); }
  }
  const ctx = Object.assign(new EventTarget(), { currentTime: 0, state: 'running', createGain: () => new Node() });
  let next = 0;
  const pending = new Map<number, () => void>();
  const effect = { input: new Node(), output: new Node() };
  const fade = createAudioCrossfade(ctx as unknown as BaseAudioContext, effect as unknown as { input: AudioNode; output: AudioNode }, {
    set(callback) { const id = next++; pending.set(id, callback); return id; },
    clear(handle) { pending.delete(handle as number); }
  });
  return {
    fade, ctx, pending,
    connected: () => (fade.input as unknown as Node).outputs.has(effect.input) && effect.output.outputs.size === 1,
    tick(seconds: number) { ctx.currentTime += seconds; const tasks = [...pending.values()]; pending.clear(); tasks.forEach(task => task()); }
  };
}

describe('audio crossfade ownership', () => {
  it('starts disconnected and disconnects only after the audio deadline', () => {
    const f = fixture();
    assert.equal(f.connected(), false);
    f.fade.setActive(true);
    f.tick(0.03);
    assert.equal(f.connected(), true);
    f.fade.setActive(false);
    f.tick(0.029);
    assert.equal(f.connected(), true, 'a wall timer cannot cut the audio fade short');
    f.tick(0.002);
    assert.equal(f.connected(), false);
    assert.equal(f.pending.size, 0);
  });

  it('cancels old retirement when reenabled and ignores redundant settings', () => {
    const f = fixture();
    f.fade.setActive(true);
    f.tick(0.03);
    f.fade.setActive(false);
    f.tick(0.01);
    f.fade.setActive(true);
    f.fade.setActive(true);
    assert.equal(f.pending.size, 1);
    f.tick(0.04);
    assert.equal(f.connected(), true);
    assert.equal(f.pending.size, 0);
  });

  it('settles a suspended fade without waiting for frozen audio time', () => {
    const f = fixture();
    f.fade.setActive(true);
    f.tick(0.03);
    f.fade.setActive(false);
    f.ctx.state = 'suspended';
    f.ctx.dispatchEvent(new Event('statechange'));
    assert.equal(f.connected(), false);
    assert.equal(f.pending.size, 0);
    f.fade.setActive(true);
    assert.equal(f.connected(), true);
    assert.equal(f.pending.size, 0);
  });

  it('disposes pending work once and never reconnects', () => {
    const f = fixture();
    f.fade.setActive(true);
    f.fade.dispose();
    f.fade.dispose();
    f.fade.setActive(true);
    f.tick(1);
    assert.equal(f.connected(), false);
    assert.equal(f.pending.size, 0);
  });
});
