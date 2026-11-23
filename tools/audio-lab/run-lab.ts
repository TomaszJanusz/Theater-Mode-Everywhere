import { LAB_EFFECTS } from './effects';
import { loadMaterial } from './load-material';
import { measure } from './measure';
import type { RunLab } from './types';

export const runLab: RunLab = async (effectId, materialId) => {
  const effect = LAB_EFFECTS.find(candidate => candidate.id === effectId);
  if (!effect) throw new Error(`Unknown effect '${effectId}'. Known: ${LAB_EFFECTS.map(candidate => candidate.id).join(', ')}`);
  const material = loadMaterial(materialId);
  const result = await effect.run(material.mix);
  return { effect: effect.id, material: material.id, input: material.mix, output: result.output, metrics: measure(material, result) };
};
