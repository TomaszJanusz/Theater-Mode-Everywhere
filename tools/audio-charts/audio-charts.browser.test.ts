import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import type { Browser } from 'playwright';

import {
  BASS_BANDS, BASS_SCENE, STEREO_BANDS, STEREO_SCENE, db, openAudioRenderer, settings, type Render
} from '../../src/test-utils/audio-render';

import { MARKERS, renderPage } from './page';
import { measureEffects, type Panel } from './spectra';

describe('audio effect charts', () => {
  let browser: Browser | null = null;
  let render: Render | null = null;
  let panels: Panel[] = [];
  before(async () => {
    const opened = await openAudioRenderer();
    if (!opened) return;
    ({ browser, render } = opened);
    panels = await measureEffects(opened.render);
  });
  after(async () => { await browser?.close(); });

  const level = (id: string, hz: number, variant: string) => {
    const point = panels.find((panel) => panel.id === id)?.points.find((p) => p.hz === hz);
    assert.ok(point, `${id} charts ${hz} Hz`);
    return { before: point.before, after: point.after[variant] };
  };

  it('charts the same band levels the audio graph assertions measure', async () => {
    if (!render) return;
    // Direct renders of the assertion scenes, compared with what the chart reports for them.
    const stereo = { scene: STEREO_SCENE, bands: STEREO_BANDS };
    const ref = await render(null, stereo);
    const strong = await render(settings({ voice: 'strong' }), stereo);
    const speech = level('voice', 1500, 'strong');
    assert.ok(Math.abs((speech.after - speech.before) - db(strong.speech, ref.speech)) < 0.05, 'voice gain on the chart equals the asserted gain');
    const side = level('stereo', 440, 'strong');
    assert.ok(Math.abs((side.after - side.before) - db(strong.side, ref.side)) < 0.05, 'ambience change on the chart equals the asserted change');

    const bass = { scene: BASS_SCENE, bands: BASS_BANDS };
    const bassRef = await render(null, bass);
    const more = await render(settings({ bass: 'more' }), bass);
    const low = level('bass', 60, 'more');
    assert.ok(Math.abs((low.after - low.before) - db(more.low, bassRef.low)) < 0.05, 'bass gain on the chart equals the asserted gain');
  });

  it('shows each effect doing its job', () => {
    if (!render) return;
    const gain = (id: string, hz: number, variant: string) => { const l = level(id, hz, variant); return l.after - l.before; };
    assert.ok(gain('voice', 1500, 'light') > 3 && gain('voice', 1500, 'strong') > gain('voice', 1500, 'light') + 1, 'voice lifts speech');
    assert.ok(gain('voice', 80, 'strong') < 1, 'voice leaves bass alone');
    assert.ok(gain('stereo', 440, 'light') < 0 && gain('stereo', 440, 'strong') < gain('stereo', 440, 'light') - 2, 'voice lowers ambience');
    assert.ok(gain('bass', 60, 'less') < -4, 'less cuts bass');
    assert.ok(Math.abs(gain('bass', 60, 'more') - 6) < 1.5 && Math.abs(gain('bass', 60, 'moar') - 9) < 1.5, 'more and moar lift bass');
    assert.ok(Math.abs(gain('bass', 1000, 'moar')) < 0.5, 'bass leaves the midrange alone');
    assert.ok(gain('leveling-quiet', 440, 'light') > 4, 'leveling lifts quiet passages');
    assert.ok(Math.abs(gain('leveling-loud', 440, 'light')) < 1.5, 'light leveling leaves loud passages near their level');
  });

  it('renders a self-contained page with the shared scale and markers', () => {
    if (!render) return;
    const html = renderPage(panels);
    assert.ok(!/<(?:script|link|img)\b|https?:\/\//.test(html), 'no external or scripted content');
    assert.equal(html.match(/<svg /g)?.length, panels.length);
    for (const { label } of MARKERS) assert.ok(html.includes(label), `${label} marker`);
    assert.ok(html.includes('prefers-color-scheme:dark'));
  });
});
