import type { RunLab } from './types';

/** Placeholder so consumers can build against the contract; the implementation follows on this branch. */
export const runLab: RunLab = (effect, material) =>
  Promise.reject(new Error(`audio lab: runLab('${effect}', '${material}') is not implemented yet`));
