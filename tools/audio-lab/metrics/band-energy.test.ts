import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { stereo, tone } from '../test-utils/signals';

import { bandLevel, bandsOf } from './band-energy';
import { powerGrid } from './grid';

describe('audio lab: band energies', () => {
  const all = (frames: number) => new Uint8Array(frames).fill(1);

  it('labels each band with the range its bins really cover', () => {
    const grid = powerGrid(stereo(tone(1000, 0.2)));
    const bands = bandsOf(grid);
    assert.deepEqual(bands.map(band => band.label), [
      '70 to 258 Hz', '258 to 492 Hz', '492 to 1008 Hz', '1008 to 1992 Hz', '1992 to 4008 Hz', '4008 to 7992 Hz', '7992 to 16008 Hz'
    ]);
    for (const [index, band] of bands.entries()) {
      assert.equal(band.lowHz, (band.bins[0] - 0.5) * grid.binHz);
      assert.equal(band.highHz, (band.bins[1] - 0.5) * grid.binHz);
      if (index > 0) assert.equal(band.bins[0], bands[index - 1].bins[1], 'bands are contiguous');
      assert.equal(band.id, `band-${Math.round(band.lowHz)}-${Math.round(band.highHz)}`);
    }
  });

  it('follows the bin grid of the sample rate instead of repeating round numbers', () => {
    const grid = powerGrid({ sampleRate: 44100, channels: [tone(1000, 0.2, 1, 44100)] });
    assert.equal(bandsOf(grid)[0].label, '65 to 237 Hz');
  });

  it('puts a tone in the band whose label contains it', () => {
    for (const [hz, expected] of [[150, 0], [370, 1], [1500, 3], [6000, 5]] as const) {
      const grid = powerGrid(stereo(tone(hz, 0.5)));
      const levels = bandsOf(grid).map(band => bandLevel(grid, band, all(grid.frames)));
      const loudest = levels.indexOf(Math.max(...levels));
      assert.equal(loudest, expected, `${hz} Hz`);
      assert.ok(levels.every((level, index) => index === expected || level < levels[expected] - 20), `${hz} Hz stays out of the other bands`);
    }
  });

  it('does not count 47 Hz as part of the lowest band, as the old "80-250 Hz" did', () => {
    const level = (hz: number) => {
      const grid = powerGrid(stereo(tone(hz, 0.5)));
      return bandLevel(grid, bandsOf(grid)[0], all(grid.frames));
    };
    // Not silent there: the window lets a tone one bin below the band leak in, about 10 dB down.
    assert.ok(level(46.875) < level(150) - 9, `${(level(46.875) - level(150)).toFixed(1)} dB`);
  });
});
