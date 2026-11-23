import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createAudioCrossfade } from './audio-crossfade';

function fixture(latency?: number) {
  class Param {
    value = 1;
    ramps: number[] = [];
    /** The level held from each time, and the ramp towards each level that ends at its time. */
    schedule: ['hold' | 'ramp', number, number][] = [];
    cancelScheduledValues(time: number) { this.schedule = this.schedule.filter(([, , at]) => at < time); }
    setValueAtTime(value: number, time: number) { this.value = value; this.schedule.push(['hold', value, time]); }
    linearRampToValueAtTime(value: number, time: number) { this.ramps.push(value); this.schedule.push(['ramp', value, time]); }
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
  const effect = { input: new Node(), output: new Node(), latency };
  const fade = createAudioCrossfade(ctx as unknown as BaseAudioContext, effect as unknown as { input: AudioNode; output: AudioNode; latency?: number }, {
    set(callback) { const id = next++; pending.set(id, callback); return id; },
    clear(handle) { pending.delete(handle as number); }
  });
  const [dry] = [...(fade.input as unknown as Node).outputs];
  return {
    fade, ctx, pending, dry: dry.gain,
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

  it('holds the dry path at full level until a freshly connected effect answers, then fades', () => {
    // An effect with latency is silent at first. Lowering the dry path meanwhile would dip the sound
    // and let it jump back when the effect's output arrives.
    const f = fixture(0.02);
    f.ctx.currentTime = 1;
    f.fade.setActive(true);
    assert.deepEqual(f.dry.schedule, [['hold', 1, 1], ['hold', 1, 1.02], ['ramp', 0, 1.05]]);
    f.tick(0.03);
    assert.equal(f.pending.size, 1, 'the fade is not settled before it has run');
    f.tick(0.021);
    assert.equal(f.pending.size, 0);

    // Off and on again before the effect was disconnected: it is still running, nothing to wait for.
    f.fade.setActive(false);
    f.tick(0.01);
    f.fade.setActive(true);
    const [, , rampStart] = f.dry.schedule.at(-2) ?? [];
    assert.equal(rampStart, f.ctx.currentTime, 'the fade back in starts at once');
  });

  it('waits for the effect to answer when it is turned off and on again within its latency', () => {
    const f = fixture(0.02);
    f.fade.setActive(true);
    f.tick(0.005);
    f.fade.setActive(false);
    f.tick(0.005);
    f.fade.setActive(true);
    assert.deepEqual(f.dry.schedule.slice(-2), [['hold', 1, 0.02], ['ramp', 0, 0.05]]);
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
