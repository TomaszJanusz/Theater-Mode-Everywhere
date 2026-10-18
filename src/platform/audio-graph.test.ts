import assert from 'node:assert/strict';
import { it } from 'node:test';
import { DEFAULT_AUDIO_SETTINGS } from '../audio-settings';
import { createAudioChain } from './audio-graph';

it('only connects requested DSP stages, including the neutral path used by boost alone', () => {
  class Param {
    value = 0;
    cancelScheduledValues() {}
    setValueAtTime(value: number) { this.value = value; }
    linearRampToValueAtTime(value: number) { this.value = value; }
    setTargetAtTime(value: number) { this.value = value; }
  }
  class Node {
    outputs = new Set<Node>();
    gain = new Param(); frequency = new Param(); Q = new Param();
    threshold = new Param(); knee = new Param(); ratio = new Param(); attack = new Param(); release = new Param();
    constructor(readonly kind: string) {}
    connect(node: Node) { this.outputs.add(node); return node; }
    disconnect(node?: Node) { if (node) this.outputs.delete(node); else this.outputs.clear(); }
  }
  const ctx = Object.assign(new EventTarget(), {
    currentTime: 0, state: 'suspended',
    createGain: () => new Node('gain'),
    createBiquadFilter: () => new Node('filter'),
    createDynamicsCompressor: () => new Node('compressor'),
    createWaveShaper: () => new Node('shaper'),
    createChannelSplitter: () => new Node('splitter'),
    createChannelMerger: () => new Node('merger')
  });
  const chain = createAudioChain(ctx as unknown as BaseAudioContext);
  const reachable = () => {
    const seen = new Set<Node>();
    const visit = (node: Node) => { if (seen.has(node)) return; seen.add(node); node.outputs.forEach(visit); };
    visit(chain.input as unknown as Node);
    return Object.fromEntries(['filter', 'compressor', 'splitter', 'shaper'].map(kind => [kind, [...seen].filter(node => node.kind === kind).length]));
  };
  try {
    chain.apply(DEFAULT_AUDIO_SETTINGS);
    assert.deepEqual(reachable(), { filter: 0, compressor: 0, splitter: 0, shaper: 0 });
    chain.apply({ ...DEFAULT_AUDIO_SETTINGS, voice: 'strong' });
    assert.deepEqual(reachable(), { filter: 1, compressor: 2, splitter: 1, shaper: 0 });
    chain.apply({ ...DEFAULT_AUDIO_SETTINGS, leveling: 'strong' });
    assert.deepEqual(reachable(), { filter: 0, compressor: 2, splitter: 0, shaper: 0 });
    chain.apply({ ...DEFAULT_AUDIO_SETTINGS, bass: 'more' });
    assert.deepEqual(reachable(), { filter: 1, compressor: 1, splitter: 0, shaper: 0 });
    chain.apply(DEFAULT_AUDIO_SETTINGS);
    assert.deepEqual(reachable(), { filter: 0, compressor: 0, splitter: 0, shaper: 0 });
    chain.apply({ ...DEFAULT_AUDIO_SETTINGS, bass: 'moar' });
    assert.deepEqual(reachable(), { filter: 1, compressor: 1, splitter: 0, shaper: 0 }, 'the soft ceiling stays out below MOAAARR!');
    chain.apply({ ...DEFAULT_AUDIO_SETTINGS, bass: 'moaaarr' });
    assert.deepEqual(reachable(), { filter: 1, compressor: 1, splitter: 0, shaper: 1 });
    chain.apply({ voice: 'strong', leveling: 'strong', bass: 'more' });
    assert.deepEqual(reachable(), { filter: 2, compressor: 3, splitter: 1, shaper: 0 });
  } finally { chain.dispose(); }
  assert.deepEqual(reachable(), { filter: 0, compressor: 0, splitter: 0, shaper: 0 });
});
