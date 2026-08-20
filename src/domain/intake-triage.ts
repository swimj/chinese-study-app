import type { JsonSchema } from './reflection-result-schema';

export type IntakeTriageJudgment =
  | 'full_study'
  | 'recognition_only'
  | 'defer_active_study'
  | 'uncertain';

export type IntakeTriageProviderWord = {
  hanzi: string;
  pinyin: string;
  meanings: string[];
  examples: string[];
};

export type IntakeTriageProviderRequest = {
  words: IntakeTriageProviderWord[];
};

export type IntakeTriageProviderAssessment = {
  hanzi: string;
  pinyin: string;
  judgment: IntakeTriageJudgment;
  rationale: string;
};

export type IntakeTriageProviderResponse = {
  assessments: IntakeTriageProviderAssessment[];
};

export type IntakeTriageAssessment = {
  judgment: IntakeTriageJudgment;
  rationale: string;
};

export type IntakeTriageAnnotation =
  | {
      kind: 'recommendation';
      assessmentId: string;
      judgment: Exclude<IntakeTriageJudgment, 'full_study'>;
      rationale: string;
    }
  | {
      kind: 'production_suppressed';
      assessmentId: string | null;
      rationale: string | null;
    };

const judgments: IntakeTriageJudgment[] = [
  'full_study',
  'recognition_only',
  'defer_active_study',
  'uncertain',
];

export const intakeTriageProviderResponseSchema: JsonSchema = {
  type: 'object',
  properties: {
    assessments: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          hanzi: { type: 'string' },
          pinyin: { type: 'string' },
          judgment: { type: 'string', enum: judgments },
          rationale: { type: 'string' },
        },
        required: ['hanzi', 'pinyin', 'judgment', 'rationale'],
        additionalProperties: false,
      },
    },
  },
  required: ['assessments'],
  additionalProperties: false,
};

export function isIntakeTriageJudgment(value: unknown): value is IntakeTriageJudgment {
  return typeof value === 'string' && (judgments as string[]).includes(value);
}

export function validateIntakeTriageProviderResponse(
  value: IntakeTriageProviderResponse,
  request: IntakeTriageProviderRequest,
): string[] {
  const errors: string[] = [];
  if (value.assessments.length !== request.words.length) {
    errors.push('$.assessments: expected exactly one assessment for every input word');
  }
  const remainingInputCounts = new Map<string, number>();
  for (const word of request.words) {
    const key = lexicalReferenceKey(word);
    remainingInputCounts.set(key, (remainingInputCounts.get(key) ?? 0) + 1);
  }
  for (const [index, assessment] of value.assessments.entries()) {
    const path = `$.assessments[${index}]`;
    const key = lexicalReferenceKey(assessment);
    const remaining = remainingInputCounts.get(key) ?? 0;
    if (remaining === 0) {
      errors.push(`${path}: hanzi and pinyin do not identify an unmatched input word`);
    } else {
      remainingInputCounts.set(key, remaining - 1);
    }
    if (!isIntakeTriageJudgment(assessment.judgment)) {
      errors.push(`${path}.judgment: unsupported judgment`);
    }
    const rationale = assessment.rationale.trim();
    if (rationale.length === 0 || rationale.length > 400) {
      errors.push(`${path}.rationale: expected 1 to 400 non-whitespace characters`);
    }
  }
  return errors;
}

export function translateIntakeTriageProviderResponse(
  value: IntakeTriageProviderResponse,
  request: IntakeTriageProviderRequest,
): IntakeTriageAssessment[] {
  const errors = validateIntakeTriageProviderResponse(value, request);
  if (errors.length > 0) {
    throw new Error('Cannot translate an invalid intake triage provider response.');
  }
  const assessmentsByReference = new Map<string, IntakeTriageProviderAssessment[]>();
  for (const assessment of value.assessments) {
    const key = lexicalReferenceKey(assessment);
    const queue = assessmentsByReference.get(key) ?? [];
    queue.push(assessment);
    assessmentsByReference.set(key, queue);
  }
  return request.words.map((word) => {
    const assessment = assessmentsByReference.get(lexicalReferenceKey(word))?.shift();
    if (!assessment) throw new Error('Validated intake triage response lost a lexical reference.');
    return {
      judgment: assessment.judgment,
      rationale: assessment.rationale,
    };
  });
}

function lexicalReferenceKey(value: { hanzi: string; pinyin: string }): string {
  return JSON.stringify([value.hanzi, value.pinyin]);
}
