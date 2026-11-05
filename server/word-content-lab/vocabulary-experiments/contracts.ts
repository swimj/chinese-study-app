import type { WordBootstrapInput } from '../../../src/domain/word-content/application.ts';
import type { WordContentDocument, TeachingPackage } from '../../../src/domain/word-content/types.ts';
import type { JsonSchema } from '../../../src/domain/reflection-result-schema.ts';
import { parseWordContent } from '../../../src/domain/word-content/validation.ts';
import { materializeTeachingPart } from '../../../src/domain/word-content/materialize.ts';
import { normalizePracticeRehearsals, normalizeTeachingBeats, normalizeWordContent } from '../../word-content/authoring.ts';
import { validateJsonSchema } from '../../llm/json-schema-validator.ts';

export type ExperimentInput =
  | { role: 'bootstrap'; word: WordBootstrapInput & { wordId: string } }
  | { role: 'introduction'; content: WordContentDocument }
  | { role: 'teaching_exercises'; content: WordContentDocument;
      introduction: Pick<TeachingPackage, 'id' | 'wordContentId' | 'beats'> }
  | { role: 'general_exercises'; content: WordContentDocument };

const string: JsonSchema = { type: 'string' };
const nullableString: JsonSchema = { type: ['string', 'null'] };
const object = (properties: Record<string, JsonSchema>): JsonSchema => ({
  type: 'object', properties, required: Object.keys(properties), additionalProperties: false,
});
const array = (items: JsonSchema, minItems = 0): JsonSchema => ({ type: 'array', items, minItems });
const kind = (value: string, properties: Record<string, JsonSchema>): JsonSchema => (
  object({ kind: { type: 'string', enum: [value] }, ...properties })
);

/** Captures actual displayed teaching text, not just a package identity or source notes. */
export function projectExperimentInput(input: ExperimentInput): unknown {
  if (!['bootstrap', 'introduction', 'teaching_exercises', 'general_exercises'].includes(input.role)) {
    throw new Error('Unknown experiment role.');
  }
  if (input.role === 'bootstrap') {
    const { wordId, ...word } = input.word;
    if (!wordId.trim() || !word.hanzi.trim() || !word.pinyin.trim()) throw new Error('Expected lexical identity and forms.');
    return { role: input.role, word };
  }
  const content = parseWordContent(input.content);
  if (input.role !== 'teaching_exercises') return { role: input.role, content };
  if (input.introduction.wordContentId !== content.id) throw new Error('Introduction names another source document.');
  const beats = normalizeTeachingBeats({ beats: input.introduction.beats }, content);
  return {
    role: input.role, content,
    deliveredIntroduction: {
      id: input.introduction.id,
      beats: beats.map((beat) => ({ id: beat.id,
        parts: beat.parts.map((part) => ({ text: materializeTeachingPart(part, content), source: part })) })),
    },
  };
}

export function experimentOutputSchema(input: ExperimentInput): JsonSchema {
  if (input.role === 'bootstrap') return object({
    uses: array(object({ id: string, label: string, notes: array(string), exampleIds: array(string, 1) }), 1),
    examples: array(object({ id: string, text: string, translation: string, pronunciation: nullableString }), 1),
  });
  if (input.role === 'introduction') return object({ beats: array(object({ id: string, parts: array({ anyOf: [
    kind('text', { text: string }),
    kind('example', { exampleId: string, field: { type: 'string', enum: ['sentence', 'translation', 'pronunciation'] } }),
    kind('use_note', { useId: string, noteIndex: { type: 'integer' } }),
  ] }, 1) }), 1) });
  // Archived v1 experiments and teaching trials retain their original wire
  // contract. Active shared authoring comparisons use the fidelity trial.
  return object({exercises:array(object({id:string,
    sourceUseId:{type:['string','null'],enum:[null,...input.content.uses.map(use=>use.id)]},
    stimulus:{anyOf:[object({kind:{type:'string',enum:['direct_text']},text:string}),object({kind:{type:'string',enum:['phrase_cloze']},frame:string,text:string})]},
    teachingNote:nullableString}),1)});
}

export type ExercisePreview = {
  id: string; sourceUseId: string | null; cue: string; answer: string; teachingNote: string | null;
};
export type ExperimentValidation = {
  structuralErrors: string[];
  preview: { cards: ExercisePreview[]; introductionBeats: string[][] } | null;
};

/** Structural validity is deliberately separate from editorial or learning judgments. */
export function validateExperimentOutput(input: ExperimentInput, output: unknown): ExperimentValidation {
  const structuralErrors = validateJsonSchema(output, experimentOutputSchema(input));
  if (structuralErrors.length) return { structuralErrors, preview: null };
  try {
    if (input.role === 'bootstrap') {
      const { wordId, hanzi, traditional, pinyin } = input.word;
      normalizeWordContent(output, { wordId, hanzi, traditional, pinyin }, 'experiment-bootstrap');
      return { structuralErrors: [], preview: { cards: [], introductionBeats: [] } };
    }
    if (input.role === 'introduction') {
      const beats = normalizeTeachingBeats(output, input.content);
      return { structuralErrors: [], preview: { cards: [], introductionBeats: beats.map((beat) => (
        beat.parts.map((part) => materializeTeachingPart(part, input.content))
      )) } };
    }
    const wire = output as { exercises: Array<{
      id: string; sourceUseId: string | null;
      stimulus: { kind: 'direct_text'; text: string } | { kind: 'phrase_cloze'; frame: string; text: string };
      teachingNote: string | null;
    }> };
    // Reuse only existing form/blank/leakage guards, not its small-pool editorial policy.
    normalizePracticeRehearsals({ rehearsals: wire.exercises.map(({ id, stimulus }) => ({ id, stimulus })) }, input.content);
    return { structuralErrors: [], preview: { introductionBeats: [], cards: wire.exercises.map((item) => ({
      id: item.id, sourceUseId: item.sourceUseId,
      cue: item.stimulus.kind === 'direct_text' ? item.stimulus.text : `${item.stimulus.frame}\n${item.stimulus.text}`,
      answer: input.content.word.hanzi, teachingNote: item.teachingNote,
    })) } };
  } catch (error) {
    return { structuralErrors: [error instanceof Error ? error.message : 'Output validation failed.'], preview: null };
  }
}
