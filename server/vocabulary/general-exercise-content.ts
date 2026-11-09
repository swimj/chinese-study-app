import type { VocabularyContentDraft, VocabularyJson } from '../../src/domain/vocabulary-content.ts';
import { vocabularyPhraseClozePrompt } from '../../src/domain/vocabulary-production-coverage.ts';
import type { GeneralExerciseOutput, GeneralExerciseSource } from './general-exercise-authoring.ts';

/** Shared materialization for background preparation and offline repertoire publication. */
export function generalExerciseContent(input: {
  contentId: string; word: GeneralExerciseSource['word']; exercise: GeneralExerciseOutput['exercises'][number];
  senseId: string; source: VocabularyJson; serviceId: string; now: string;
}): VocabularyContentDraft {
  const { exercise, word } = input;
  return { contentId: input.contentId, kind: 'exercise', payloadVersion: 1,
    body: { prompt: exercise.stimulus.kind === 'direct_text' ? exercise.stimulus.text : vocabularyPhraseClozePrompt(exercise.stimulus.frame, exercise.stimulus.text),
      instruction: '', stimulus: exercise.stimulus as unknown as VocabularyJson, reveal: { teachingNote: exercise.teachingNote }, source: input.source },
    exerciseType: exercise.stimulus.kind === 'phrase_cloze' ? 'cloze' : 'definition_gloss', skill: 'production', exerciseRole: 'general',
    assessment: { responseMode: 'hanzi_entry', matchingProfile: 'mandarin' }, accessScope: 'shared', availability: 'active', originKind: 'model',
    authorKind: 'service', authorId: input.serviceId,
    words: [{ wordId: word.wordId, relation: 'target', senseId: input.senseId, senseMappingEstablishedAt: input.now }],
    answers: [{ wordId: word.wordId, acceptedForms: [...new Set([word.hanzi, word.traditional].filter((form): form is string => form !== null))] }] };
}
