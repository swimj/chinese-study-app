import type { JsonSchema } from './reflection-result-schema.js';

export const DIET_INTAKE_PLACEMENT_REQUEST_VERSION = 'diet_intake_placement_request.v1' as const;
export const DIET_INTAKE_PLACEMENT_RESULT_VERSION = 'diet_intake_placement_result.v1' as const;
export const DIET_INTAKE_MAX_ANSWERS = 2;
export const DIET_INTAKE_MAX_PROMPT_LENGTH = 200;
export const DIET_INTAKE_MAX_ANSWER_LENGTH = 2_000;
export const DIET_INTAKE_MAX_TOTAL_ANSWER_LENGTH = 4_000;

export type DietIntakePlacementAnswer = { prompt: string; answer: string };
export type DietIntakePlacementRequest = { schemaVersion: typeof DIET_INTAKE_PLACEMENT_REQUEST_VERSION; answers: DietIntakePlacementAnswer[] };
export type DietIntakePlacementResult = { schemaVersion: typeof DIET_INTAKE_PLACEMENT_RESULT_VERSION; nextLearningLevel: 1 | 2 | 3 | 4 | 5 | 6; rationale: string };

export const dietIntakePlacementResultSchema: JsonSchema = {
  type: 'object', properties: {
    schemaVersion: { type: 'string', enum: [DIET_INTAKE_PLACEMENT_RESULT_VERSION] },
    nextLearningLevel: { type: 'integer', enum: [1, 2, 3, 4, 5, 6] }, rationale: { type: 'string' },
  }, required: ['schemaVersion', 'nextLearningLevel', 'rationale'], additionalProperties: false,
};

export function validateDietIntakePlacementResult(value: DietIntakePlacementResult): string[] {
  const rationale = value.rationale.trim();
  return rationale.length === 0 || rationale.length > 400 ? ['$.rationale: expected 1 to 400 non-whitespace characters'] : [];
}

export function isDietIntakePlacementAnswers(value: unknown): value is DietIntakePlacementAnswer[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > DIET_INTAKE_MAX_ANSWERS) return false;
  let totalLength = 0;
  return value.every((answer) => {
    if (typeof answer !== 'object' || answer === null || Array.isArray(answer)) return false;
    const record = answer as Record<string, unknown>;
    if (Object.keys(record).length !== 2 || !Object.hasOwn(record, 'prompt') || !Object.hasOwn(record, 'answer')) return false;
    if (typeof record.prompt !== 'string' || typeof record.answer !== 'string') return false;
    const prompt = record.prompt.trim(); const response = record.answer.trim(); totalLength += record.answer.length;
    return prompt.length > 0 && record.prompt.length <= DIET_INTAKE_MAX_PROMPT_LENGTH
      && response.length > 0 && record.answer.length <= DIET_INTAKE_MAX_ANSWER_LENGTH
      && totalLength <= DIET_INTAKE_MAX_TOTAL_ANSWER_LENGTH;
  });
}
