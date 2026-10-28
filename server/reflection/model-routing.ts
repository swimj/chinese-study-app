import { REFLECTION_MODEL_ARMS, LUNA_REFLECTION_MODEL_CHOICE, type ReflectionModelChoice } from './model-arms.ts';
import { LUNA_REFLECTION_MODEL_CONFIG, type ReflectionProviderConfig } from './luna-provider.ts';
import { GLM_REFLECTION_MODEL_CONFIG } from './glm-provider.ts';

export function reflectionConfigForChoice(choice: ReflectionModelChoice): ReflectionProviderConfig {
  if (choice === LUNA_REFLECTION_MODEL_CHOICE) return LUNA_REFLECTION_MODEL_CONFIG;
  if (choice === 'zai:glm-5.3-flash-max') return GLM_REFLECTION_MODEL_CONFIG;
  const config = REFLECTION_MODEL_ARMS.find(arm => arm.choice === choice)?.config;
  if (!config) throw new Error(`Unsupported reflection model choice: ${choice}`);
  return config;
}

/** Size-weighted policy for batched reflection requests. */
export function routeBatchedReflectionModel(itemCount: number, random = Math.random): ReflectionModelChoice {
  if (!Number.isInteger(itemCount) || itemCount < 1) throw new Error('Reflection routing requires a positive item count');
  const arms = REFLECTION_MODEL_ARMS.flatMap(arm => {
    const weight = itemCount <= 10 ? arm.dogfoodSelectionWeight.smallBundle : arm.dogfoodSelectionWeight.largeBundle;
    return arm.enabledByDefault && weight > 0 ? [{choice:arm.choice,weight}] : [];
  });
  if (!arms.length) throw new Error('No offered reflection model has a positive weight');
  let ticket = random() * arms.reduce((sum, arm) => sum + arm.weight, 0);
  for (const arm of arms) {
    if (ticket < arm.weight) return arm.choice;
    ticket -= arm.weight;
  }
  return arms[arms.length-1]!.choice;
}

/** Equal-probability policy for individual reflection jobs, regardless of evidence count. */
export function routeIndividualReflectionModel(random = Math.random): ReflectionModelChoice {
  const arms = REFLECTION_MODEL_ARMS.filter(arm => arm.enabledByDefault);
  if (!arms.length) throw new Error('No offered reflection model');
  return arms[Math.min(Math.floor(random() * arms.length), arms.length - 1)]!.choice;
}
