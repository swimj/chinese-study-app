export type ModelTarget = {
  id: string;
  provider: string;
  model: string;
  reasoningEffort: 'high' | 'xhigh' | 'max';
};

export const modelTargets: ModelTarget[] = [
  { id: 'gpt-5.6-terra-high', provider: 'openai', model: 'gpt-5.6-terra', reasoningEffort: 'high' },
  { id: 'gpt-5.6-terra-xhigh', provider: 'openai', model: 'gpt-5.6-terra', reasoningEffort: 'xhigh' },
  { id: 'gpt-5.6-luna-high', provider: 'openai', model: 'gpt-5.6-luna', reasoningEffort: 'high' },
  { id: 'gpt-5.6-luna-xhigh', provider: 'openai', model: 'gpt-5.6-luna', reasoningEffort: 'xhigh' },
  { id: 'gpt-5.4-mini-high', provider: 'openai', model: 'gpt-5.4-mini', reasoningEffort: 'high' },
  { id: 'gpt-5.4-mini-xhigh', provider: 'openai', model: 'gpt-5.4-mini', reasoningEffort: 'xhigh' },
  { id: 'glm-5.3-high', provider: 'zai', model: 'glm-5.3', reasoningEffort: 'high' },
  { id: 'glm-5.3-max', provider: 'zai', model: 'glm-5.3', reasoningEffort: 'max' },
  { id: 'qwen3.8-max', provider: 'dashscope', model: 'qwen3.8-max', reasoningEffort: 'high' },
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
