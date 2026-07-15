export type ModelTarget = {
  id: string;
  provider: string;
  model: string;
};

export const modelTargets: ModelTarget[] = [
  { id: 'gpt-5.6-terra', provider: 'openai', model: 'gpt-5.6-terra' },
  { id: 'gpt-5.6-luna', provider: 'openai', model: 'gpt-5.6-luna' },
  { id: 'gpt-5.4', provider: 'openai', model: 'gpt-5.4' },
  { id: 'gpt-5.4-mini', provider: 'openai', model: 'gpt-5.4-mini' },
  { id: 'gpt-5.4-nano', provider: 'openai', model: 'gpt-5.4-nano' },
  { id: 'glm-5.2', provider: 'zai', model: 'glm-5.2' },
  { id: 'glm-5', provider: 'zai', model: 'glm-5' },
  { id: 'glm-4.7', provider: 'zai', model: 'glm-4.7' },
  { id: 'glm-4.7-flashx', provider: 'zai', model: 'glm-4.7-flashx' },
  { id: 'glm-4.7-flash', provider: 'zai', model: 'glm-4.7-flash' },
];

const targetsById = new Map<string, ModelTarget>();
for (const target of modelTargets) {
  if (targetsById.has(target.id)) throw new Error(`Duplicate model target id: ${target.id}`);
  targetsById.set(target.id, target);
}

export function getModelTarget(targetId: string): ModelTarget {
  const target = targetsById.get(targetId);
  if (target === undefined) {
    throw new Error(`Unknown model ${targetId}. Available models: ${modelTargets.map((item) => item.id).join(', ')}`);
  }
  return target;
}
