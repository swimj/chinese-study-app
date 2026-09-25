import type { ProductionCueType } from '../../src/domain/study-actions.ts';
import type { ContentExercise, ContentStimulus, WordContentDocument } from '../../src/domain/word-content/types.ts';
import type { ReviewSupplementSource } from '../../src/domain/word-content/review-compat.ts';
import { materializeExercise } from '../../src/domain/word-content/materialize.ts';
import { assertUniqueIds, freezeContent, parseContentExercise, parseWordContent } from '../../src/domain/word-content/validation.ts';

export type AuthoredReviewExercise = {
  exercise: ContentExercise;
  cueType: ProductionCueType;
  supplement: ReviewSupplementSource | null;
};

type RecordValue = Record<string, unknown>;
function record(value: unknown, keys: string[], name: string): RecordValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${name} must be an object.`);
  const result = value as RecordValue;
  if (Object.keys(result).some((key) => !keys.includes(key)) || keys.some((key) => !Object.hasOwn(result, key))) {
    throw new Error(`${name} has unsupported or missing fields.`);
  }
  return result;
}
function nonempty(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} must be nonempty text.`);
  return value;
}

function stimulus(value: unknown, content: WordContentDocument): ContentStimulus {
  if (typeof value === 'object' && value !== null && 'kind' in value && value.kind === 'direct_text') {
    const source = record(value, ['kind', 'text'], 'Direct review stimulus');
    return { kind: 'direct_text', text: nonempty(source.text, 'Review stimulus') };
  }
  const source = record(value, ['kind', 'exampleId', 'occurrenceIndexes', 'frame'], 'Review cloze');
  if (source.kind !== 'example_cloze') throw new Error('Unknown review stimulus kind.');
  const example = content.examples.find((entry) => entry.id === source.exampleId);
  if (!example) throw new Error('Review cloze names an unknown source example.');
  if (!Array.isArray(source.occurrenceIndexes) || source.occurrenceIndexes.length < 1 || source.occurrenceIndexes.length > 4) {
    throw new Error('Review cloze must hide one to four target occurrences.');
  }
  const points = Array.from(example.text);
  const target = Array.from(content.word.hanzi);
  const occurrences: number[] = [];
  for (let index = 0; index <= points.length - target.length; index += 1) {
    if (target.every((point, offset) => points[index + offset] === point)) occurrences.push(index);
  }
  let previous = -1;
  const blanks = source.occurrenceIndexes.map((raw: unknown) => {
    if (typeof raw !== 'number' || !Number.isSafeInteger(raw) || raw <= previous || raw >= occurrences.length) {
      throw new Error('Review occurrence indexes must be ordered, unique, and in range.');
    }
    previous = raw;
    const start = occurrences[raw]!;
    return { start, end: start + target.length, expectedText: content.word.hanzi };
  });
  return {
    kind: 'example_cloze', example: { contentId: content.id, exampleId: example.id }, blanks,
    frame: source.frame === null ? null : nonempty(source.frame, 'Review frame'),
  };
}

/** Author review independently: a teaching example's presence does not certify a fair cloze. */
export function normalizeReviewExercises(
  value: unknown, rawContent: WordContentDocument, idFor: (localId: string) => string,
): AuthoredReviewExercise[] {
  const content = parseWordContent(rawContent);
  const root = record(value, ['exercises'], 'Review authoring result');
  if (!Array.isArray(root.exercises) || root.exercises.length < 1 || root.exercises.length > 3) {
    throw new Error('Review authoring requires one to three exercises.');
  }
  const localIds: string[] = [];
  const result = root.exercises.map((raw): AuthoredReviewExercise => {
    const item = record(raw, ['id', 'cueType', 'stimulus', 'supplement'], 'Review exercise');
    const localId = nonempty(item.id, 'Review local ID');
    localIds.push(localId);
    if (item.cueType !== 'definition_gloss' && item.cueType !== 'minimal_context' && item.cueType !== 'circumstance') {
      throw new Error('Unknown review cue type.');
    }
    const id = nonempty(idFor(localId), 'Review exercise ID');
    const source = stimulus(item.stimulus, content);
    if (source.kind === 'example_cloze' && item.cueType !== 'minimal_context') {
      throw new Error('An example cloze must use minimal_context.');
    }
    const exercise = parseContentExercise({
      id, responseMode: 'hanzi_entry', instruction: '',
      contract: { kind: 'targeted_review', wordId: content.word.wordId },
      stimulus: source,
      acceptedAnswers: [{ wordId: content.word.wordId, hanzi: content.word.hanzi, traditional: content.word.traditional }],
    });
    const snapshot = materializeExercise(exercise, [content]);
    const forms = [content.word.hanzi, content.word.traditional].filter((form): form is string => form !== null);
    if (forms.some((form) => snapshot.stimulus.text.includes(form))) throw new Error('Review stimulus exposes its target answer.');
    let supplement: ReviewSupplementSource | null = null;
    if (item.supplement !== null) {
      if (item.cueType !== 'definition_gloss') throw new Error('Only definition_gloss supports a review supplement.');
      const rawSupplement = record(item.supplement, ['exampleId', 'englishFrame'], 'Review supplement');
      const example = content.examples.find((entry) => entry.id === rawSupplement.exampleId);
      if (!example || !forms.some((form) => example.text.includes(form))) {
        throw new Error('Review supplement must reference an example showing the target word.');
      }
      supplement = {
        kind: 'example', supplementId: `${id}:supplement`,
        englishFrame: nonempty(rawSupplement.englishFrame, 'Supplement frame'),
        example: { contentId: content.id, exampleId: example.id },
      };
    }
    return { exercise, cueType: item.cueType, supplement };
  });
  assertUniqueIds(localIds, 'Review local IDs');
  assertUniqueIds(result.map((item) => item.exercise.id), 'Review exercise IDs');
  if (!result.some((item) => item.cueType === 'circumstance' || item.exercise.stimulus.kind === 'example_cloze')) {
    throw new Error('Review requires at least one contextual cloze or circumstance exercise.');
  }
  return freezeContent(result);
}
