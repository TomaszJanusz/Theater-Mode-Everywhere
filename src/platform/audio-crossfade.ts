export const AUDIO_FADE_SECONDS = 0.03;

type Stage = { input: AudioNode; output: AudioNode };
type Scheduler = { set(callback: () => void, delay: number): unknown; clear(handle: unknown): void };
const scheduler: Scheduler = {
  set: (callback, delay) => setTimeout(callback, delay),
  clear: handle => clearTimeout(handle as ReturnType<typeof setTimeout>)
};

/** Only the dry path stays connected while an effect is off. */
export function createAudioCrossfade(ctx: BaseAudioContext, effect: Stage, timers: Scheduler = scheduler) {
  const input = ctx.createGain();
  const output = ctx.createGain();
  const dry = ctx.createGain();
  const wet = ctx.createGain();
  dry.gain.value = 1;
  wet.gain.value = 0;
  input.connect(dry).connect(output);
  wet.connect(output);
  let active = false;
  let connected = false;
  let disposed = false;
  let timer: unknown;
  let start = ctx.currentTime;
  let from = 0;
  let target = 0;

  const mix = () => from + (target - from) * Math.min(1, Math.max(0, (ctx.currentTime - start) / AUDIO_FADE_SECONDS));
  const cancel = () => { if (timer !== undefined) timers.clear(timer); timer = undefined; };
  const detach = () => {
    if (!connected) return;
    input.disconnect(effect.input);
    effect.output.disconnect(wet);
    connected = false;
  };
  const finish = () => {
    cancel();
    from = target;
    for (const [param, value] of [[wet.gain, target], [dry.gain, 1 - target]] as const) {
      param.cancelScheduledValues(ctx.currentTime);
      param.setValueAtTime(value, ctx.currentTime);
    }
    if (!active) detach();
  };
  const check = () => {
    timer = undefined;
    if (disposed) return;
    const remaining = start + AUDIO_FADE_SECONDS - ctx.currentTime;
    // Audio time stops on suspend. No audible transition needs to finish there.
    if (ctx.state !== 'running' || remaining <= 0) finish();
    else timer = timers.set(check, Math.max(1, remaining * 1000));
  };
  const stateChanged = () => { if (ctx.state !== 'running') finish(); };
  ctx.addEventListener('statechange', stateChanged);

  return {
    input,
    output,
    setActive(next: boolean) {
      if (disposed || active === next) return;
      const current = mix();
      cancel();
      active = next;
      from = current;
      target = next ? 1 : 0;
      start = ctx.currentTime;
      if (next && !connected) {
        input.connect(effect.input);
        effect.output.connect(wet);
        connected = true;
      }
      if (ctx.state !== 'running') return finish();
      for (const [param, value, end] of [[wet.gain, current, target], [dry.gain, 1 - current, 1 - target]] as const) {
        param.cancelScheduledValues(start);
        param.setValueAtTime(value, start);
        param.linearRampToValueAtTime(end, start + AUDIO_FADE_SECONDS);
      }
      timer = timers.set(check, AUDIO_FADE_SECONDS * 1000);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      cancel();
      ctx.removeEventListener('statechange', stateChanged);
      detach();
      input.disconnect();
      output.disconnect();
      dry.disconnect();
      wet.disconnect();
    }
  };
}
