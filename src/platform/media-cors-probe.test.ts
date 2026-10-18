import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { probeMediaCors } from './media-cors-probe';

class Probe extends EventTarget {
  src = '';
  crossOrigin: string | null = null;
  loads = 0;
  removeAttribute(name: string) { if (name === 'src') this.src = ''; }
  load() { this.loads += 1; }
}

const probeWith = (probe: Probe, signal = new AbortController().signal) =>
  probeMediaCors('https://cdn.example/a.mp4', signal, () => probe as unknown as HTMLVideoElement);

describe('media CORS probe', () => {
  it('requests the url with CORS on its own element and reports metadata as success', async () => {
    Object.assign(globalThis, { window: globalThis });
    const probe = new Probe();
    const result = probeWith(probe);
    assert.equal(probe.crossOrigin, 'anonymous');
    assert.equal(probe.src, 'https://cdn.example/a.mp4');
    probe.dispatchEvent(new Event('loadedmetadata'));
    assert.equal(await result, true);
    assert.equal(probe.src, '');
    assert.equal(probe.loads, 1);
  });

  it('reports a refused request and an abort as failures', async () => {
    Object.assign(globalThis, { window: globalThis });
    const refused = new Probe();
    const refusedResult = probeWith(refused);
    refused.dispatchEvent(new Event('error'));
    assert.equal(await refusedResult, false);
    const abort = new AbortController();
    const aborted = new Probe();
    const abortedResult = probeWith(aborted, abort.signal);
    abort.abort();
    assert.equal(await abortedResult, false);
    assert.equal(aborted.src, '');
  });
});
