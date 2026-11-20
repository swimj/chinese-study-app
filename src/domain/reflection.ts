

export type ReflectionWordSnapshotV1 = {
  wordId: string;
  hanzi: string;
  pinyin: string;
  meanings: string[];
};

export type ReflectionCueSnapshotV0 = {
  cueId: string | null;
  cueType: 'definition_gloss' | 'cloze' | 'minimal_context' | 'other';
  displayOrder: number;
  text: string;
  displayedMeanings: string[];
};

export type ReflectionExistingContentV0 = {
  contrastClusters: Array<{
    clusterId: string;
    title: string | null;
    memberWordIds: string[];
    promptCount: number;
    notes: string[];
  }>;
  knownAcceptedAlternates: Array<{
    cueId: string | null;
    acceptedWordIds: string[];
    note: string | null;
  }>;
};

type ReflectionItemBaseV1 = {
  itemId: string;
  sessionActionId: string | null;
  occurredAt: string | null;
  targetWord: ReflectionWordSnapshotV1 | null;
  sessionNote: string | null;
  existingContent: ReflectionExistingContentV0;
};

export type ProductionMistakeReflectionItemV1 = ReflectionItemBaseV1 & {
  source: 'production_mistake';
  sourceActionKind: 'production';
  targetWord: ReflectionWordSnapshotV1;
  cuesAsShown: ReflectionCueSnapshotV0[];
  rawResponse: string | null;
  submittedWord: ReflectionWordSnapshotV1 | null;
  responseKind: 'matched_known_word' | 'no_clue' | 'unmatched_text';
};

export type SessionNoteReflectionItemV1 = ReflectionItemBaseV1 & {
  source: 'session_note';
  sourceActionKind: 'recognition' | 'production' | 'contrast_selection' | null;
  cuesAsShown: ReflectionCueSnapshotV0[];
  relatedWords: ReflectionWordSnapshotV1[];
  linkedAttemptId: string | null;
};

export type ContrastSelectionReflectionItemV1 = ReflectionItemBaseV1 & {
  source: 'contrast_selection';
  sourceActionKind: 'contrast_selection';
  targetWord: ReflectionWordSnapshotV1;
  promptAsShown: {
    promptId: string;
    promptText: string;
    explanationShown: string | null;
    choiceWords: ReflectionWordSnapshotV1[];
    promptTargetWordId: string;
  };
  reflectionSignal: 'clear_now' | 'still_shaky' | 'want_more_practice' | null;
};

export type ReflectionInputItemV1 =
  | ProductionMistakeReflectionItemV1
  | SessionNoteReflectionItemV1
  | ContrastSelectionReflectionItemV1;

export type MarkReflectionInboxSeenRequest =
  | { kind: 'proposal'; proposalId: string }
  | { kind: 'explanation'; artifactId: string; itemId: string };
