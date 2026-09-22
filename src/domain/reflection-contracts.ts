export const CURRENT_INITIAL_REFLECTION_FLOW_VERSION = 'initial_post_session_reflection.v4' as const;
export const CURRENT_DEFERRED_SECOND_OPINION_FLOW_VERSION = 'deferred_second_opinion.v3' as const;

export const STAGED_REFLECTION_DIAGNOSIS_PROMPT_VERSION = 'reflection-staged-v1' as const;
export const PURE_CUE_PROMOTION_PROMPT_VERSION = 'pure-cue-promotion-v1' as const;

export type ReflectionGenerationStage = 'diagnosis' | 'promotion';

export function isCurrentReflectionGenerationStage(input: {
  reflectionFlowVersion: string;
  stage: ReflectionGenerationStage;
  bundleSchemaVersion: string | null;
  promptVersion: string;
}): boolean {
  if (input.stage === 'promotion') {
    return isCurrentReflectionFlowVersion(input.reflectionFlowVersion)
      && input.bundleSchemaVersion === 'pure_cue_promotion_bundle.v1'
      && input.promptVersion === PURE_CUE_PROMOTION_PROMPT_VERSION;
  }
  if (input.promptVersion !== STAGED_REFLECTION_DIAGNOSIS_PROMPT_VERSION) return false;
  return (
    input.reflectionFlowVersion === CURRENT_INITIAL_REFLECTION_FLOW_VERSION
    && input.bundleSchemaVersion === 'session_reflection_bundle.v4'
  ) || (
    input.reflectionFlowVersion === CURRENT_DEFERRED_SECOND_OPINION_FLOW_VERSION
    && input.bundleSchemaVersion === 'curated_reflection_diagnosis_bundle.v2'
  );
}

export function isCurrentReflectionArtifactContract(input: {
  reflectionFlowVersion: string;
  bundleSchemaVersion: string;
  resultSchemaVersion: string;
  promptVersion: string;
}): boolean {
  if (input.resultSchemaVersion !== 'session_reflection_result.v8') return false;
  if (
    input.promptVersion !== STAGED_REFLECTION_DIAGNOSIS_PROMPT_VERSION
    && input.promptVersion !== PURE_CUE_PROMOTION_PROMPT_VERSION
  ) return false;
  return (
    input.reflectionFlowVersion === CURRENT_INITIAL_REFLECTION_FLOW_VERSION
    && input.bundleSchemaVersion === 'session_reflection_bundle.v5'
  ) || (
    input.reflectionFlowVersion === CURRENT_DEFERRED_SECOND_OPINION_FLOW_VERSION
    && input.bundleSchemaVersion === 'curated_reflection_bundle.v2'
  );
}

export function isCurrentReflectionFlowVersion(value: string): boolean {
  return value === CURRENT_INITIAL_REFLECTION_FLOW_VERSION
    || value === CURRENT_DEFERRED_SECOND_OPINION_FLOW_VERSION;
}
