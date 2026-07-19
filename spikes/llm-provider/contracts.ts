export type StudyProfileV0 = 'mandarin' | 'french';

export type ReflectionWordSnapshotV0 = {
  wordId: string;
  hanzi: string;
  pinyin: string;
  meanings: string[];
  production: {
    relevance: 'normal' | 'suppressed' | 'bad_prompt';
    notes: string[];
  };
};

export type ReflectionCueSnapshotV0 = {
  cueId: string | null;
  cueType: 'definition_gloss' | 'cloze' | 'minimal_context' | 'other';
  displayOrder: number;
  text: string;
  displayedMeanings: string[];
};

export type ReflectionActionAttemptV0 = {
  attemptId: string;
  occurredAt: string;
  actionAttemptSequence: number;
  outcome: 'correct' | 'incorrect';
  rating: 'forgot' | 'hard' | 'good' | 'easy' | null;
  response: string | null;
};

export type ReflectionAttemptShapeV0 = {
  firstResponseOutcome: 'incorrect' | 'no_clue';
  resolution: 'recalled_later' | 'management_action' | 'session_ended' | 'unknown';
  terminalRating: 'forgot' | 'hard' | 'good' | 'easy' | null;
  attemptCountForAction: number;
  managementAction: 'dismissed' | 'suppressed_production' | 'marked_bad_prompt' | null;
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

type ReflectionItemBaseV0 = {
  itemId: string;
  sessionActionId: string | null;
  occurredAt: string | null;
  targetWord: ReflectionWordSnapshotV0 | null;
  sessionNote: string | null;
  existingContent: ReflectionExistingContentV0;
};

export type ProductionMistakeReflectionItemV0 = ReflectionItemBaseV0 & {
  source: 'production_mistake';
  sourceActionKind: 'production';
  targetWord: ReflectionWordSnapshotV0;
  cuesAsShown: ReflectionCueSnapshotV0[];
  rawResponse: string | null;
  submittedWord: ReflectionWordSnapshotV0 | null;
  responseKind: 'matched_known_word' | 'no_clue' | 'unmatched_text';
  attempts: ReflectionActionAttemptV0[];
  attemptShape: ReflectionAttemptShapeV0;
};

export type SessionNoteReflectionItemV0 = ReflectionItemBaseV0 & {
  source: 'session_note';
  sourceActionKind: 'recognition' | 'production' | 'contrast_selection' | null;
  cuesAsShown: ReflectionCueSnapshotV0[];
  relatedWords: ReflectionWordSnapshotV0[];
  linkedAttemptId: string | null;
};

export type ContrastSelectionReflectionItemV0 = ReflectionItemBaseV0 & {
  source: 'contrast_selection';
  sourceActionKind: 'contrast_selection';
  targetWord: ReflectionWordSnapshotV0;
  promptAsShown: {
    promptId: string;
    promptText: string;
    explanationShown: string | null;
    choiceWords: ReflectionWordSnapshotV0[];
    promptTargetWordId: string;
  };
  attempts: ReflectionActionAttemptV0[];
  reflectionSignal: 'clear_now' | 'still_shaky' | 'want_more_practice' | null;
};

export type ReflectionInputItemV0 =
  | ProductionMistakeReflectionItemV0
  | SessionNoteReflectionItemV0
  | ContrastSelectionReflectionItemV0;

export type SessionReflectionBundleV0 = {
  schemaVersion: 'session_reflection_bundle.v0';
  generatedAt: string;
  session: {
    sessionId: string;
    startedAt: string | null;
    endedAt: string | null;
    studyProfile: StudyProfileV0;
  };
  items: ReflectionInputItemV0[];
};

export type ReflectionDiagnosisTagV0 =
  | 'valid_or_near_valid_alternate'
  | 'cue_overlap_hides_usage_difference'
  | 'production_cue_overloaded'
  | 'form_or_sound_interference'
  | 'grammar_or_usage_role_interference'
  | 'ordinary_retrieval_noise'
  | 'persistent_confusion'
  | 'insufficient_evidence';

export type ProductionCueRefV0 = {
  cueId: string | null;
  textAsShown: string;
};

export type ReflectionHandleOperationV0 =
  | {
      kind: 'flag_bad_production_cue';
      wordId: string;
      sourceCue: ProductionCueRefV0;
      issues: Array<
        | 'underdetermined'
        | 'misleading_gloss_overlap'
        | 'overloaded'
        | 'wrong_register_or_domain'
        | 'other'
      >;
      note: string;
    }
  | {
      kind: 'suppress_definition_production';
      wordId: string;
      reason: 'recognition_only_is_better_fit' | 'answer_space_too_open' | 'low_value_for_learner' | 'other';
      note: string;
    }
  | {
      kind: 'upsert_contrast_content';
      destination:
        | { mode: 'create_cluster'; clusterId: null; title: string }
        | { mode: 'extend_cluster'; clusterId: string; title: null };
      clusterNote: string | null;
      members: Array<{ wordId: string; nuanceNote: string | null }>;
      prompts: Array<{
        targetWordId: string;
        promptText: string;
        explanation: string | null;
      }>;
    }
  | {
      kind: 'repair_production_cue';
      wordId: string;
      sourceCue: ProductionCueRefV0;
      replacementCues: Array<{
        cueType: 'definition_gloss' | 'cloze' | 'minimal_context' | 'register_or_domain_hint';
        text: string;
      }>;
      repairIntent:
        | 'narrow_to_learner_relevant_sense'
        | 'add_distinguishing_anchor'
        | 'add_contextual_triangulation'
        | 'split_overloaded_cue';
    }
  | {
      kind: 'accept_production_alternate';
      cue: ProductionCueRefV0;
      targetWordId: string;
      alternateWordId: string;
      acceptance: 'fully_acceptable_for_cue' | 'near_valid_creditworthy_answer';
      subtletyNote: string | null;
    };

export type ReflectionHandleKindV0 = ReflectionHandleOperationV0['kind'];

export type ReflectionHandleProposalV0 = {
  proposalKey: string;
  proposalGroupKey: string | null;
  handleVersion: 1;
  rationale: string;
  operation: ReflectionHandleOperationV0;
};

export type ReflectionItemResultV0 = {
  itemId: string;
  uncertain: boolean;
  diagnosisTags: ReflectionDiagnosisTagV0[];
  observation: string;
  learnerExplanation: string | null;
  proposals: ReflectionHandleProposalV0[];
  questions?: Array<{ questionKey: string; question: string; reason: string }>;
  unhandledNeeds?: Array<{
    needKey: string;
    description: string;
    whyExistingHandlesDoNotFit: string;
  }>;
};

export type SessionReflectionResultV2 = {
  schemaVersion: 'session_reflection_result.v2';
  bundleSchemaVersion: 'session_reflection_bundle.v0';
  summary?: string | null;
  itemResults: ReflectionItemResultV0[];
};

export type FixtureReadinessV0 = 'ready' | 'provisional' | 'blocked';

export type ProposalProfileV0 = {
  requiredKinds: ReflectionHandleKindV0[];
  allowedKinds: ReflectionHandleKindV0[];
  description: string;
};

export type ReflectionProviderFixtureV0 = {
  fixtureVersion: 'reflection_provider_fixture.v0';
  fixtureId: string;
  source:
    | {
        kind: 'workflow_appendix';
        document: 'notes/active/2026-07-06-session-reflection-workflow.md';
        appendixExample: number;
        title: string;
      }
    | {
        kind: 'user_supplied_stress_case';
        suppliedAt: string;
        title: string;
      };
  readiness: FixtureReadinessV0;
  readinessNotes: string[];
  inputBundle: SessionReflectionBundleV0;
  referenceResult: SessionReflectionResultV2 | null;
  evaluation: {
    mode?: 'scored' | 'exploratory';
    requiredDiagnosisTags: ReflectionDiagnosisTagV0[];
    forbiddenDiagnosisTags: ReflectionDiagnosisTagV0[];
    acceptableProposalProfiles: ProposalProfileV0[];
    questionPolicy: 'none_expected' | 'allowed' | 'required';
    unhandledNeedPolicy?: 'none_expected' | 'allowed' | 'required';
    requiredJudgments: string[];
    forbiddenJudgments: string[];
  };
};
