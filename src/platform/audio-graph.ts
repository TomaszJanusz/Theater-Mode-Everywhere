import { isNeutralAudio, type AudioSettings } from '../audio-settings';
import { AUDIO_FADE_SECONDS, createAudioCrossfade } from './audio-crossfade';

type VoicePreset = {
  /** Dialogue band added on top of the centre (mid) signal. */
  dialogue: number;
  /** Level of the stereo difference (side) signal, where music and ambience spread. */
  side: number;
  threshold: number;
  ratio: number;
  /** Offsets the compressor's automatic makeup gain so levels stay comparable. */
  trim: number;
};

const VOICE_PRESETS: Record<Exclude<AudioSettings['voice'], 'off'>, VoicePreset> = {
  light: { dialogue: 1, side: 0.8, threshold: -24, ratio: 2.5, trim: 0.8 },
  strong: { dialogue: 2.5, side: 0.55, threshold: -30, ratio: 4, trim: 0.85 }
};

type LevelingPreset = { threshold: number; knee: number; ratio: number; attack: number; release: number; trim: number };

/**
 * A low threshold with the compressor's automatic makeup gain lifts quiet
 * passages and quiet videos while holding loud ones back. "Strong" is the
 * night setting: explosions barely rise above dialogue.
 */
const LEVELING_PRESETS: Record<Exclude<AudioSettings['leveling'], 'off'>, LevelingPreset> = {
  light: { threshold: -32, knee: 18, ratio: 2.5, attack: 0.02, release: 0.8, trim: 0.9 },
  strong: { threshold: -40, knee: 12, ratio: 6, attack: 0.004, release: 0.5, trim: 1 }
};

/**
 * "MOAAR" (+9 dB) is the highest lift a near-full-scale bass tone survives under the limiter alone:
 * its 2 ms attack lets a 60 Hz peak through from +10 dB. "MOAAARR!" (+11 dB) therefore adds a
 * soft ceiling after the limiter (see `ceilingStage`). It stops at +11: a hard 60 Hz kick at +12 ducks speech by about 2 dB through the shared limiter, at +11 by about 1.6 dB. Light voice lifts speech by +6 dB, strong by up to +10.9 dB.
 */
const BASS_SHELF_DB: Record<AudioSettings['bass'], number> = { less: -6, original: 0, more: 6, moar: 9, moaaarr: 11 };

/** Linear up to the knee, then a tanh roll-off that approaches but never reaches full scale. */
const CEILING_KNEE = 0.85;
function ceilingCurve(): Float32Array<ArrayBuffer> {
  const size = 2049;
  const curve = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    const x = (i / (size - 1)) * 2 - 1;
    const over = Math.abs(x) - CEILING_KNEE;
    curve[i] = over <= 0 ? x : Math.sign(x) * (CEILING_KNEE + (1 - CEILING_KNEE) * Math.tanh(over / (1 - CEILING_KNEE)));
  }
  return curve;
}

/** Catches the limiter's attack overshoot. Disconnected, like every effect, unless MOAAARR! is selected. */
function ceilingStage(ctx: BaseAudioContext) {
  const shaper = ctx.createWaveShaper();
  shaper.curve = ceilingCurve();
  shaper.oversample = '2x';
  return createAudioCrossfade(ctx, { input: shaper, output: shaper });
}

export type AudioChain = {
  readonly input: AudioNode;
  readonly output: AudioNode;
  apply(settings: AudioSettings): void;
  dispose(): void;
};

function gainNode(ctx: BaseAudioContext, value: number): GainNode {
  const node = ctx.createGain();
  node.gain.value = value;
  return node;
}

function glide(ctx: BaseAudioContext, param: AudioParam, value: number): void {
  param.cancelScheduledValues(ctx.currentTime);
  param.setTargetAtTime(value, ctx.currentTime, AUDIO_FADE_SECONDS);
}

/**
 * Dialogue is mixed to the centre of almost every stereo track, so the voice
 * stage lifts the speech band of mid = (L+R)/2 and lowers side = (L-R)/2,
 * then compresses.
 */
function voiceStage(ctx: BaseAudioContext) {
  // Splitting 5.1 discretely would keep only front left/right and drop the
  // centre channel that carries dialogue; downmix to stereo first.
  const stereo = gainNode(ctx, 1);
  stereo.channelCount = 2;
  stereo.channelCountMode = 'explicit';
  stereo.channelInterpretation = 'speakers';
  const split = ctx.createChannelSplitter(2);
  stereo.connect(split);

  const mid = gainNode(ctx, 0.5);
  split.connect(mid, 0);
  split.connect(mid, 1);
  const side = gainNode(ctx, 1);
  const sideLeft = gainNode(ctx, 0.5);
  const sideRight = gainNode(ctx, -0.5);
  split.connect(sideLeft, 0);
  split.connect(sideRight, 1);
  sideLeft.connect(side);
  sideRight.connect(side);

  // A bandpass never shifts phase past 90 degrees, so adding it to the
  // original can only lift the band and never cancels part of it.
  const band = ctx.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.value = 2000;
  band.Q.value = 0.6;
  const dialogue = gainNode(ctx, 0);
  const midOut = gainNode(ctx, 1);
  mid.connect(midOut);
  mid.connect(band).connect(dialogue).connect(midOut);
  const sideOut = gainNode(ctx, 1);
  side.connect(sideOut);

  const merge = ctx.createChannelMerger(2);
  const sideInverted = gainNode(ctx, -1);
  midOut.connect(merge, 0, 0);
  sideOut.connect(merge, 0, 0);
  midOut.connect(merge, 0, 1);
  sideOut.connect(sideInverted).connect(merge, 0, 1);

  const compressor = ctx.createDynamicsCompressor();
  compressor.knee.value = 12;
  compressor.attack.value = 0.005;
  compressor.release.value = 0.25;
  const trim = gainNode(ctx, 1);
  merge.connect(compressor).connect(trim);

  const fade = createAudioCrossfade(ctx, { input: stereo, output: trim });
  return {
    input: fade.input,
    output: fade.output,
    dispose: fade.dispose,
    set(level: AudioSettings['voice']) {
      if (level === 'off') return fade.setActive(false);
      const preset = VOICE_PRESETS[level];
      dialogue.gain.value = preset.dialogue;
      sideOut.gain.value = preset.side;
      compressor.threshold.value = preset.threshold;
      compressor.ratio.value = preset.ratio;
      trim.gain.value = preset.trim;
      fade.setActive(true);
    }
  };
}

function bassStage(ctx: BaseAudioContext) {
  // A neutral shelf is disconnected rather than processing a 0 dB filter.
  const shelf = ctx.createBiquadFilter();
  shelf.type = 'lowshelf';
  shelf.frequency.value = 150;
  shelf.gain.value = 0;
  const fade = createAudioCrossfade(ctx, { input: shelf, output: shelf });
  return {
    input: fade.input,
    output: fade.output,
    dispose: fade.dispose,
    set(level: AudioSettings['bass']) {
      if (level !== 'original') glide(ctx, shelf.gain, BASS_SHELF_DB[level]);
      fade.setActive(level !== 'original');
    }
  };
}

function levelingStage(ctx: BaseAudioContext) {
  const compressor = ctx.createDynamicsCompressor();
  const trim = gainNode(ctx, 1);
  compressor.connect(trim);
  const fade = createAudioCrossfade(ctx, { input: compressor, output: trim });
  return {
    input: fade.input,
    output: fade.output,
    dispose: fade.dispose,
    set(level: AudioSettings['leveling']) {
      if (level === 'off') return fade.setActive(false);
      const preset = LEVELING_PRESETS[level];
      compressor.threshold.value = preset.threshold;
      compressor.knee.value = preset.knee;
      compressor.ratio.value = preset.ratio;
      compressor.attack.value = preset.attack;
      compressor.release.value = preset.release;
      trim.gain.value = preset.trim;
      fade.setActive(true);
    }
  };
}

/** Voice, then bass, then leveling, with one limiter guarding full scale. */
export function createAudioChain(ctx: BaseAudioContext): AudioChain {
  const voice = voiceStage(ctx);
  const bass = bassStage(ctx);
  const leveling = levelingStage(ctx);
  const threshold = -1;
  const ratio = 20;
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = threshold;
  limiter.knee.value = 0;
  limiter.ratio.value = ratio;
  limiter.attack.value = 0.002;
  limiter.release.value = 0.1;
  // Web Audio applies makeup gain of 0.6 x the full-scale reduction; undo it
  // so the limiter only touches peaks. Untouched audio bypasses it entirely.
  const makeupDb = 0.6 * (-threshold - -threshold / ratio);
  const unmakeup = gainNode(ctx, 10 ** (-makeupDb / 20));
  limiter.connect(unmakeup);
  const guard = createAudioCrossfade(ctx, { input: limiter, output: unmakeup });
  voice.output.connect(bass.input);
  bass.output.connect(leveling.input);
  leveling.output.connect(guard.input);
  const ceiling = ceilingStage(ctx);
  guard.output.connect(ceiling.input);

  return {
    input: voice.input,
    output: ceiling.output,
    apply(settings) {
      voice.set(settings.voice);
      bass.set(settings.bass);
      leveling.set(settings.leveling);
      guard.setActive(!isNeutralAudio(settings));
      ceiling.setActive(settings.bass === 'moaaarr');
    },
    dispose() {
      voice.dispose();
      bass.dispose();
      leveling.dispose();
      guard.dispose();
      ceiling.dispose();
    }
  };
}
