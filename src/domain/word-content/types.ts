import type { AcceptedCueAnswer } from '../cues';
import type { StudyProfileId } from '../../study-profile';

/** Content IDs name immutable documents, not mutable word-level slots. */
export type WordContentDocument = {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly word: {
    readonly wordId: string;
    readonly hanzi: string;
    readonly traditional: string | null;
    readonly pinyin: string;
  };
  readonly uses: readonly WordUse[];
  readonly examples: readonly WordExample[];
};

export type WordUse = {
  readonly id: string;
  readonly label: string;
  readonly notes: readonly string[];
  readonly exampleIds: readonly string[];
};

export type WordExample = {
  readonly id: string;
  readonly text: string;
  readonly translation: string;
  readonly pronunciation: string | null;
};

export type ExampleRef = {
  readonly contentId: string;
  readonly exampleId: string;
};

/** Half-open Unicode code-point offsets, not UTF-16 indices. */
export type ClozeBlank = {
  readonly start: number;
  readonly end: number;
  readonly expectedText: string;
};

export type ContentStimulus =
  | { readonly kind: 'direct_text'; readonly text: string }
  | {
    readonly kind: 'example_cloze';
    readonly example: ExampleRef;
    readonly blanks: readonly ClozeBlank[];
    readonly frame: string | null;
  };

export type ExerciseContract =
  | { readonly kind: 'target_rehearsal'; readonly wordId: string }
  | { readonly kind: 'targeted_review'; readonly wordId: string }
  | { readonly kind: 'pure_review'; readonly axisNote: string };

export type ContentExercise = {
  readonly id: string;
  /** One typed answer; for multiple gaps, that same answer fills every gap. */
  readonly responseMode: 'hanzi_entry';
  readonly contract: ExerciseContract;
  readonly instruction: string;
  readonly stimulus: ContentStimulus;
  readonly acceptedAnswers: readonly Readonly<AcceptedCueAnswer>[];
};

/** An ordered group of parts is one learner-advanced beat, not a chat turn. */
export type TeachingPart =
  | { readonly kind: 'text'; readonly text: string }
  | {
    readonly kind: 'example';
    readonly exampleId: string;
    readonly field: 'sentence' | 'translation' | 'pronunciation';
  }
  | { readonly kind: 'use_note'; readonly useId: string; readonly noteIndex: number };

export type TeachingPackage = {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly wordContentId: string;
  readonly beats: readonly {
    readonly id: string;
    readonly parts: readonly TeachingPart[];
  }[];
  readonly rehearsals: readonly ContentExercise[];
};

export type MaterializedStimulus = {
  readonly text: string;
  readonly source: ContentStimulus;
};

/** Frozen content only: no scheduling, assessment credit, or publication authority. */
export type ContentExerciseSnapshot = {
  readonly exerciseId: string;
  readonly responseMode: 'hanzi_entry';
  readonly matchingProfile: StudyProfileId;
  readonly contract: ExerciseContract;
  readonly instruction: string;
  readonly stimulus: MaterializedStimulus;
  readonly acceptedAnswers: readonly Readonly<AcceptedCueAnswer>[];
};

export type TeachingPackageSnapshot = {
  readonly packageId: string;
  readonly wordContentId: string;
  readonly wordId: string;
  readonly beats: readonly {
    readonly id: string;
    readonly parts: readonly {
      readonly text: string;
      readonly source: TeachingPart;
    }[];
  }[];
  readonly rehearsals: readonly ContentExerciseSnapshot[];
};
