import { BASS_MOAAARR_ENABLED, type AudioSettings } from '../../src/audio-settings';
import {
  BASS_BANDS, BASS_SCENE, LEVELING_OPTIONS, STEREO_BANDS, STEREO_SCENE, settings,
  type Render, type RenderOptions
} from '../../src/test-utils/audio-render';

/** One tone of the test signal: its frequency and level without the effect and with each variant, in dBFS. */
export type SpectrumPoint = { hz: number; before: number; after: Record<string, number> };
export type Panel = { id: string; title: string; caption: string; signal: 'Mid' | 'Side' | 'Quiet passage' | 'Loud passage'; variants: string[]; points: SpectrumPoint[] };

const dbfs = (level: number) => 20 * Math.log10(Math.max(level, 1e-6));

/**
 * Renders `options` untouched and once per variant through the real audio chain, using the same
 * single-bin band levels the audio graph assertions use, and reads `bands` as one spectrum.
 */
async function measure(
  render: Render, options: RenderOptions, variants: Record<string, AudioSettings>, bands: Record<string, number>
): Promise<{ hz: number; before: number; after: Record<string, number> }[]> {
  const before = await render(null, options);
  const after: Record<string, Record<string, number>> = {};
  for (const [name, applied] of Object.entries(variants)) after[name] = await render(applied, options);
  return Object.entries(bands).map(([band, hz]) => ({
    hz,
    before: dbfs(before[band]),
    after: Object.fromEntries(Object.keys(variants).map((name) => [name, dbfs(after[name][band])]))
  }));
}

const split = (bands: NonNullable<RenderOptions['bands']>, kind: 'mid' | 'side') =>
  Object.fromEntries(Object.entries(bands).filter(([, [k]]) => k === kind).map(([name, [, hz]]) => [name, hz]));

/** The effects TME-122 asserts on, as before/after spectra of their test signals. */
export async function measureEffects(render: Render): Promise<Panel[]> {
  const voice = { light: settings({ voice: 'light' }), strong: settings({ voice: 'strong' }) };
  const stereo = { options: { scene: STEREO_SCENE, bands: STEREO_BANDS }, bands: STEREO_BANDS! };
  const mid = await measure(render, stereo.options, voice, split(stereo.bands, 'mid'));
  const side = await measure(render, stereo.options, voice, split(stereo.bands, 'side'));

  const bassLevels: Array<AudioSettings['bass']> = ['less', 'more', 'moar', ...(BASS_MOAAARR_ENABLED ? ['moaaarr' as const] : [])];
  const bass = await measure(
    render, { scene: BASS_SCENE, bands: BASS_BANDS },
    Object.fromEntries(bassLevels.map((level) => [level, settings({ bass: level })])),
    split(BASS_BANDS!, 'mid')
  );

  const leveling = { light: settings({ leveling: 'light' }), strong: settings({ leveling: 'strong' }) };
  const passage = async (range: [number, number]) => measure(
    render, { ...LEVELING_OPTIONS, bands: { 'tone 440': ['mid', 440], 'tone 1300': ['mid', 1300] }, range }, leveling,
    { 'tone 440': 440, 'tone 1300': 1300 }
  );
  const quiet = await passage([1, 2]);
  const loud = await passage([2.5, 4]);

  return [
    { id: 'voice', title: 'Voice: dialogue lift', caption: 'Centre (mid) of the stereo test scene. The 1500 Hz speech tone rises with the voice level; the 80 Hz bass tone stays put.', signal: 'Mid', variants: Object.keys(voice), points: mid },
    { id: 'stereo', title: 'Stereo: ambience reduction', caption: 'Side (L−R) of the same scene. The wide 440 Hz tone falls as the voice level rises.', signal: 'Side', variants: Object.keys(voice), points: side },
    { id: 'bass', title: 'Bass', caption: 'Low shelf at 60 Hz; the 1 kHz tone shows the midrange stays put.', signal: 'Mid', variants: bassLevels, points: bass },
    { id: 'leveling-quiet', title: 'Volume leveling: quiet passage', caption: 'Quiet passage of a scene that gets about 22 dB louder; leveling lifts it.', signal: 'Quiet passage', variants: Object.keys(leveling), points: quiet },
    { id: 'leveling-loud', title: 'Volume leveling: loud passage', caption: 'Loud passage of the same scene; light leveling leaves it near its level.', signal: 'Loud passage', variants: Object.keys(leveling), points: loud }
  ];
}
