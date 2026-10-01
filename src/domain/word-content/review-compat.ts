import type { StudyProfileId } from '../../study-profile';
import {
  assertStrictTargetOnlyProductionSnapshot,
  type ProductionCueSupplementSnapshot,
  type ProductionCueType,
  type ProductionExerciseSnapshot,
} from '../study-actions';
import { materializeExercise, resolveWordExample } from './materialize';
import type {
  ContentExercise,
  ContentExerciseSnapshot,
  ExampleRef,
  WordContentDocument,
} from './types';
import { freezeContent } from './validation';

export type ReviewSupplementSource =
  | { readonly kind: 'snapshot'; readonly value: ProductionCueSupplementSnapshot }
  | {
      readonly kind: 'example';
      readonly supplementId: string;
      readonly englishFrame: string;
      readonly example: ExampleRef;
    };

/** Existing review-cue identity and reinforcement stay separate from authored exercises. */
export type ReviewSourceMetadata = {
  readonly taskId: string;
  readonly cueId: string | null;
  readonly cueType: ProductionCueType;
  readonly supplement: ReviewSupplementSource | null;
};

export type ReviewCompatibleExerciseSnapshot = {
  readonly origin: 'legacy' | 'content';
  readonly exercise: ContentExerciseSnapshot;
  readonly review: Omit<ReviewSourceMetadata, 'supplement'> & {
    readonly supplementSource: ReviewSupplementSource | null;
    readonly supplement: ProductionCueSupplementSnapshot | null;
  };
};

/** Legacy cue text is opaque, including text that happens to look like a cloze. */
export function adaptLegacyProductionSnapshot(
  snapshot: ProductionExerciseSnapshot,
  targetWordId: string,
  profile: StudyProfileId = 'mandarin',
): ReviewCompatibleExerciseSnapshot {
  if (profile !== 'mandarin' && profile !== 'french') throw new Error('Unknown matching profile.');
  assertStrictTargetOnlyProductionSnapshot(snapshot, targetWordId);
  const supplement = snapshot.supplement === null ? null : { ...snapshot.supplement };
  return freezeContent({
    origin: 'legacy',
    exercise: {
      exerciseId: snapshot.cueId ?? snapshot.taskId,
      contract: { kind: 'targeted_review', wordId: targetWordId },
      // The existing served snapshot has no instruction field; do not invent one.
      instruction: '',
      responseMode: 'hanzi_entry',
      matchingProfile: profile,
      stimulus: {
        text: snapshot.text,
        source: { kind: 'direct_text', text: snapshot.text },
      },
      acceptedAnswers: snapshot.acceptedAnswers.map((answer) => ({ ...answer })),
    },
    review: {
      taskId: snapshot.taskId,
      cueId: snapshot.cueId,
      cueType: snapshot.cueType,
      supplementSource: supplement === null ? null : { kind: 'snapshot', value: { ...supplement } },
      supplement,
    },
  });
}

/** An authored review exercise must cross the review boundary explicitly. */
export function adaptTargetedReviewExercise(
  exercise: ContentExercise,
  contents: readonly WordContentDocument[],
  review: ReviewSourceMetadata,
  profile: StudyProfileId = 'mandarin',
): ReviewCompatibleExerciseSnapshot {
  if (exercise.contract.kind !== 'targeted_review') {
    throw new Error('Only targeted review exercises can become word-owned production snapshots.');
  }
  if (exercise.instruction !== '') {
    throw new Error('The legacy production snapshot cannot preserve a separate review instruction.');
  }
  if (review.taskId.trim() === '' || review.cueId === null || review.cueId.trim() === '') {
    throw new Error('Authored targeted review requires an exact durable cue and task identity.');
  }
  if (exercise.stimulus.kind === 'example_cloze' && review.cueType !== 'minimal_context') {
    throw new Error('Authored example clozes require a minimal-context review cue.');
  }
  if (review.supplement !== null && review.cueType !== 'definition_gloss') {
    throw new Error('Post-reveal review supplements require a definition-gloss cue.');
  }
  const materialized = materializeExercise(exercise, contents, profile);
  assertStrictTargetOnlyProductionSnapshot(
    { acceptedAnswers: [...materialized.acceptedAnswers] },
    exercise.contract.wordId,
  );
  return freezeContent({
    origin: 'content',
    exercise: materialized,
    review: {
      taskId: review.taskId,
      cueId: review.cueId,
      cueType: review.cueType,
      supplementSource: copySupplementSource(review.supplement),
      supplement: materializeSupplement(review.supplement, contents, exercise.contract.wordId),
    },
  });
}

/** Export only the fields understood by the existing production matcher/evidence path. */
export function toProductionExerciseSnapshot(
  value: ReviewCompatibleExerciseSnapshot,
): ProductionExerciseSnapshot {
  if (value.exercise.contract.kind !== 'targeted_review') {
    throw new Error('Only targeted review exercises can become word-owned production snapshots.');
  }
  if (value.exercise.instruction !== '') {
    throw new Error('The legacy production snapshot cannot preserve a separate review instruction.');
  }
  assertStrictTargetOnlyProductionSnapshot(
    { acceptedAnswers: [...value.exercise.acceptedAnswers] },
    value.exercise.contract.wordId,
  );
  return {
    taskId: value.review.taskId,
    cueId: value.review.cueId,
    cueType: value.review.cueType,
    text: value.exercise.stimulus.text,
    acceptedAnswers: value.exercise.acceptedAnswers.map((answer) => ({ ...answer })),
    supplement: value.review.supplement === null ? null : { ...value.review.supplement },
  };
}

function copySupplementSource(source: ReviewSupplementSource | null): ReviewSupplementSource | null {
  if (source === null) return null;
  return source.kind === 'snapshot'
    ? { kind: 'snapshot', value: { ...source.value } }
    : { ...source, example: { ...source.example } };
}

function materializeSupplement(
  source: ReviewSupplementSource | null,
  contents: readonly WordContentDocument[],
  wordId: string,
): ProductionCueSupplementSnapshot | null {
  if (source === null) return null;
  if (source.kind === 'snapshot') return { ...source.value };
  if (source.supplementId.trim() === '' || source.englishFrame.trim() === '') {
    throw new Error('Source-linked supplement needs identity and English frame.');
  }
  const example = resolveWordExample(source.example, contents);
  const content = contents.find((candidate) => candidate.id === source.example.contentId);
  if (content === undefined) throw new Error(`Missing supplement content ${source.example.contentId}.`);
  if (content.word.wordId !== wordId) throw new Error('Supplement example must belong to the reviewed word.');
  if (!example.text.includes(content.word.hanzi)
    && (content.word.traditional === null || !example.text.includes(content.word.traditional))) {
    throw new Error('Supplement example must show the reviewed word.');
  }
  return {
    supplementId: source.supplementId,
    englishFrame: source.englishFrame,
    exampleSentence: example.text,
    exampleTranslation: example.translation,
  };
}
