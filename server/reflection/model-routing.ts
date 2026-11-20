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

/** Equal-probability policy; learner feedback excludes GLM's JSON-object-only route. */
export function routeIndividualReflectionModel(random = Math.random, kind?: 'learner_feedback' | 'exercise_improvement'): ReflectionModelChoice {
  const arms = REFLECTION_MODEL_ARMS.filter(arm => arm.enabledByDefault
    && (kind !== 'learner_feedback' || reflectionConfigForChoice(arm.choice).provider !== 'zai'));
  if (!arms.length) throw new Error('No offered reflection model');
  return arms[Math.min(Math.floor(random() * arms.length), arms.length - 1)]!.choice;
}
