/**
 * The audio lab's data contract (TME-280). The lab runs an effect over a piece of test material
 * and reports what changed; charts and reports consume only these shapes, so they stay plain data:
 * no classes, no functions, JSON-serialisable apart from the sample arrays.
 */

/** Decoded audio: one Float32Array per channel, all of the same length, samples in -1 to 1. */
export type Signal = { sampleRate: number; channels: Float32Array[] };

/**
 * One metric measured without (`before`) and with (`after`) the effect, in `unit`. A value the
 * material cannot provide (no known room, no speech) is NaN, never a made-up number.
 */
export type MetricRow = { id: string; label: string; unit: string; before: number; after: number; higherIsBetter?: boolean; note?: string };

/**
 * One effect on one material. `output` is aligned with `input`: the effect's latency is already
 * removed and both signals have the same length and sample rate.
 */
export type LabRun = { effect: string; material: string; input: Signal; output: Signal; metrics: MetricRow[] };

/** `effect` is an id from `LAB_EFFECTS`; `material` a corpus manifest id, a built-in synthetic id or a WAV path. */
export type RunLab = (effect: string, material: string) => Promise<LabRun>;

export { runLab } from './run-lab';
