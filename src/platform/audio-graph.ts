import type { VoiceBoostLevel } from '../ui/voice-boost-settings';

type Preset = {
  /** Dialogue band added on top of the centre (mid) signal. */
  dialogue: number;
  /** Level of the stereo difference (side) signal, where music and ambience spread. */
  side: number;
  threshold: number;
  ratio: number;
  /** Offsets the compressor's automatic makeup gain so levels stay comparable. */
  trim: number;
};

const PRESETS: Record<Exclude<VoiceBoostLevel, 'off'>, Preset> = {
  light: { dialogue: 1, side: 0.8, threshold: -24, ratio: 2.5, trim: 0.8 },
  strong: { dialogue: 2.5, side: 0.55, threshold: -30, ratio: 4, trim: 0.85 }
};

const FADE_SECONDS = 0.03;

export type VoiceBoostChain = {
  readonly input: AudioNode;
  readonly output: AudioNode;
  setLevel(level: VoiceBoostLevel): void;
};

/**
 * Dialogue is mixed to the centre of almost every stereo track, so the chain
 * lifts the speech band of mid = (L+R)/2 and lowers side = (L-R)/2, then
 * compresses and limits. "Off" crossfades to the untouched signal.
 */
export function createVoiceBoostChain(ctx: BaseAudioContext): VoiceBoostChain {
  const gain = (value: number) => {
    const node = ctx.createGain();
    node.gain.value = value;
    return node;
  };

  const input = gain(1);
  const output = gain(1);
  const dry = gain(1);
  const wet = gain(0);
  input.connect(dry).connect(output);

  // Splitting 5.1 discretely would keep only front left/right and drop the
  // centre channel that carries dialogue; downmix to stereo first.
  const stereo = gain(1);
  stereo.channelCount = 2;
  stereo.channelCountMode = 'explicit';
  stereo.channelInterpretation = 'speakers';
  input.connect(stereo);
  const split = ctx.createChannelSplitter(2);
  stereo.connect(split);

  const mid = gain(0.5);
  split.connect(mid, 0);
  split.connect(mid, 1);
  const side = gain(1);
  const sideLeft = gain(0.5);
  const sideRight = gain(-0.5);
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
  const dialogue = gain(0);
  const midOut = gain(1);
  mid.connect(midOut);
  mid.connect(band).connect(dialogue).connect(midOut);
  const sideOut = gain(1);
  side.connect(sideOut);

  const merge = ctx.createChannelMerger(2);
  const sideInverted = gain(-1);
  midOut.connect(merge, 0, 0);
  sideOut.connect(merge, 0, 0);
  midOut.connect(merge, 0, 1);
  sideOut.connect(sideInverted).connect(merge, 0, 1);

  const compressor = ctx.createDynamicsCompressor();
  compressor.knee.value = 12;
  compressor.attack.value = 0.005;
  compressor.release.value = 0.25;
  const trim = gain(1);
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -1;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.002;
  limiter.release.value = 0.1;
  merge.connect(compressor).connect(trim).connect(limiter).connect(wet).connect(output);

  const glide = (param: AudioParam, value: number) => {
    param.cancelScheduledValues(ctx.currentTime);
    param.setTargetAtTime(value, ctx.currentTime, FADE_SECONDS);
  };

  return {
    input,
    output,
    setLevel(level) {
      if (level === 'off') {
        glide(dry.gain, 1);
        glide(wet.gain, 0);
        return;
      }
      const preset = PRESETS[level];
      dialogue.gain.value = preset.dialogue;
      sideOut.gain.value = preset.side;
      compressor.threshold.value = preset.threshold;
      compressor.ratio.value = preset.ratio;
      trim.gain.value = preset.trim;
      glide(dry.gain, 0);
      glide(wet.gain, 1);
    }
  };
}
