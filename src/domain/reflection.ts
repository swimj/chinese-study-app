import { STAGED_REFLECTION_DIAGNOSIS_PROMPT_VERSION } from './reflection-contracts';

export type StudyProfileV0 = 'mandarin' | 'french';

export const SYNTHETIC_REFLECTION_ATTEMPT_ID_PREFIX = 'synthetic-reflection-attempt:';

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

export type ReflectionServedCueSnapshotV1 = {
  cueId: string | null;
  cueType: ProductionCueTypeV0;
  text: string;
  acceptedWordIds: string[];
};

export type ReflectionServedCueSupplementSnapshotV1 = {
  supplementId: string;
  englishFrame: string;
  exampleSentence: string;
  exampleTranslation: string;
};

export type ReflectionServedCueSnapshotV2 = ReflectionServedCueSnapshotV1 & {
  supplement: ReflectionServedCueSupplementSnapshotV1 | null;
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

export type SessionReflectionBundleV1 = {
  schemaVersion: 'session_reflection_bundle.v1';
  generatedAt: string;
  session: {
    sessionId: string;
    startedAt: string | null;
    endedAt: string | null;
    studyProfile: StudyProfileV0;
  };
  items: ReflectionInputItemV1[];
};

export type ProductionMistakeReflectionItemV2 = Omit<
  ProductionMistakeReflectionItemV1,
  'cuesAsShown' | 'responseKind'
> & {
  sourceAttemptId: string;
  servedCue: ReflectionServedCueSnapshotV1;
  responseKind: ProductionMistakeReflectionItemV1['responseKind'];
};

export type ReflectionInputItemV2 = ProductionMistakeReflectionItemV2;

export type SessionReflectionBundleV2 = {
  schemaVersion: 'session_reflection_bundle.v2';
  generatedAt: string;
  session: SessionReflectionBundleV1['session'];
  items: ReflectionInputItemV2[];
};

export type ReflectionItemV3 = Omit<ProductionMistakeReflectionItemV2, 'responseKind'> & {
  /** Optional learner annotation; the base item still represents ordinary failure evidence when absent. */
  learnerRequestedReview?: true;
  responseKind: ProductionMistakeReflectionItemV2['responseKind'] | null;
};

export type SessionReflectionBundleV3 = {
  schemaVersion: 'session_reflection_bundle.v3';
  generatedAt: string;
  session: SessionReflectionBundleV1['session'];
  items: ReflectionItemV3[];
};

export type ReflectionItemV4 = Omit<ReflectionItemV3, 'servedCue'> & {
  servedCue: ReflectionServedCueSnapshotV2;
};

export type SessionReflectionBundleV4 = {
  schemaVersion: 'session_reflection_bundle.v4';
  generatedAt: string;
  session: SessionReflectionBundleV1['session'];
  items: ReflectionItemV4[];
};

export type PureCuePromotionProductionCueSnapshotV1 = {
  cueId: string;
  taskId: string;
  cueType: ProductionCueTypeV0;
  text: string;
  acceptedWordIds: string[];
};

export type PureCuePromotionPureCueSnapshotV1 = {
  id: string;
  stimulus: string;
  axisNote: string;
  acceptedWordIds: string[];
};

export type PureCuePromotionWordEvidenceV1 = {
  wordId: string;
  activeProductionCues: PureCuePromotionProductionCueSnapshotV1[];
};

export type PureCuePromotionEvidenceV1 = {
  diagnosisTags: ReflectionDiagnosisTagV1[];
  words: PureCuePromotionWordEvidenceV1[];
  intersectingPureCues: PureCuePromotionPureCueSnapshotV1[];
};

export type ReflectionItemV5 = ReflectionItemV4 & {
  promotionEvidence: PureCuePromotionEvidenceV1 | null;
};

export type SessionReflectionBundleV5 = {
  schemaVersion: 'session_reflection_bundle.v5';
  generatedAt: string;
  session: SessionReflectionBundleV1['session'];
  items: ReflectionItemV5[];
};

export type SharedAxisHandoffV1 = {
  axis: string;
  boundaries: string;
  responseValidity: string;
};

/** Exact provider-independent input retained before a promotion-specific call. */
export type PureCuePromotionBundleV1 = {
  schemaVersion: 'pure_cue_promotion_bundle.v1';
  generatedAt: string;
  sourceSessionId: string | null;
  studyProfile: StudyProfileV0;
  items: Array<{
    itemId: string;
    sourceAttemptId: string;
    targetWord: ReflectionWordSnapshotV1;
    responseWord: ReflectionWordSnapshotV1;
    servedCue: ReflectionServedCueSnapshotV2;
    handoff: SharedAxisHandoffV1;
    promotionEvidence: PureCuePromotionEvidenceV1;
  }>;
};

export type PureCuePromotionDecisionV1Wire =
  | {
      kind: 'promote';
      rationale: string;
      learnerExplanation: string;
      operation: PromotePureElicitationOperationV1Wire;
    }
  | {
      kind: 'disagreement';
      learnerExplanation: string;
    };

export type PureCuePromotionResultV1Wire = {
  schemaVersion: 'pure_cue_promotion_result.v1';
  itemResults: Array<{
    itemId: string;
    decision: PureCuePromotionDecisionV1Wire;
  }>;
};

/**
 * A deliberately curated, non-session reflection request. It is the provider
 * wire format for a cross-session second opinion, so it contains only the
 * immutable evidence the provider should reason from. Selection provenance is
 * retained privately with the generation run rather than sent to the model.
 */
export type CuratedReflectionBundleV1 = {
  schemaVersion: 'curated_reflection_bundle.v1';
  generatedAt: string;
  items: ReflectionItemV4[];
};

/** Sessionless first-stage evidence for new staged second opinions. */
export type CuratedReflectionDiagnosisBundleV2 = {
  schemaVersion: 'curated_reflection_diagnosis_bundle.v2';
  generatedAt: string;
  studyProfile: StudyProfileV0;
  items: ReflectionItemV4[];
};

/** New staged second-opinion evidence keeps profile identity without inventing a session. */
export type CuratedReflectionBundleV2 = {
  schemaVersion: 'curated_reflection_bundle.v2';
  generatedAt: string;
  studyProfile: StudyProfileV0;
  items: ReflectionItemV5[];
};

export type ReflectionDiagnosisBundle =
  | SessionReflectionBundleV2
  | SessionReflectionBundleV3
  | SessionReflectionBundleV4
  | CuratedReflectionBundleV1
  | CuratedReflectionDiagnosisBundleV2;

export type SessionReflectionBundle =
  | SessionReflectionBundleV1
  | SessionReflectionBundleV2
  | SessionReflectionBundleV3
  | SessionReflectionBundleV4
  | SessionReflectionBundleV5
  | CuratedReflectionBundleV1
  | CuratedReflectionBundleV2
  | SessionReflectionBundleV6
  | CuratedReflectionBundleV3;

export type ReflectionDiagnosisTagV1 =
  | 'valid_or_near_valid_alternate'
  | 'cue_overlap_hides_usage_difference'
  | 'production_cue_overloaded'
  | 'form_or_sound_interference'
  | 'grammar_or_usage_role_interference'
  | 'ordinary_retrieval_noise'
  | 'persistent_confusion'
  | 'insufficient_evidence';

export type SuppressDefinitionProductionOperationV1 = {
  kind: 'suppress_definition_production';
  version: 1;
  wordId: string;
};

type CreateContrastClusterOperationBase = {
  kind: 'create_contrast_cluster';
  title: string;
  clusterNote: string | null;
  members: Array<{
    wordId: string;
    nuanceNote: string | null;
  }>;
  prompts: Array<{
    targetWordId: string;
    promptText: string;
    explanation: string | null;
  }>;
};

export type CreateContrastClusterOperationV1 = CreateContrastClusterOperationBase & {
  version: 1;
};

export type CreateContrastClusterOperationV2 = CreateContrastClusterOperationBase & {
  version: 2;
};

export type CreateContrastClusterOperation =
  | CreateContrastClusterOperationV1
  | CreateContrastClusterOperationV2;

export type RepairProductionCueOperationV1 = {
  kind: 'repair_production_cue';
  version: 1;
  wordId: string;
  proposedCues: Array<{
    cueType:
      | 'definition_gloss'
      | 'cloze'
      | 'minimal_context'
      | 'register_or_domain_hint';
    text: string;
  }>;
  repairIntent:
    | 'narrow_to_learner_relevant_sense'
    | 'add_distinguishing_anchor'
    | 'add_contextual_triangulation'
    | 'split_overloaded_cue';
};

export type ProductionCueTypeV0 =
  | 'definition_gloss'
  | 'minimal_context'
  | 'circumstance';

export type ProductionCueDraftV2 = {
  cueType: ProductionCueTypeV0;
  text: string;
  acceptedWordIds: string[];
};

export type ProductionCueChangeV2 =
  | {
      kind: 'create';
      cue: ProductionCueDraftV2;
    }
  | {
      kind: 'replace';
      cueId: string;
      replacements: ProductionCueDraftV2[];
    }
  | {
      kind: 'deactivate';
      cueId: string;
    };

export type CueEvidenceJudgmentV2 =
  | {
      kind: 'accepted_answer_space_omission';
      sourceAttemptId: string;
      submittedWordId: string;
    }
  | {
      kind: 'misleading_or_overloaded_cue';
      sourceAttemptId: string;
    };

/** Provider-facing judgments deliberately omit backend-owned attempt provenance. */
export type CueEvidenceJudgmentV2Wire =
  | {
      kind: 'accepted_answer_space_omission';
      submittedWordId: string;
    }
  | {
      kind: 'misleading_or_overloaded_cue';
    };

export type RepairProductionCueOperationV2 = {
  kind: 'repair_production_cue';
  version: 2;
  wordId: string;
  taskId: string;
  changes: ProductionCueChangeV2[];
  sourceAttemptJudgments: CueEvidenceJudgmentV2[];
};

export type RepairProductionCueOperationV2Wire = Omit<
  RepairProductionCueOperationV2,
  'version' | 'taskId' | 'sourceAttemptJudgments'
> & {
  sourceAttemptJudgments: CueEvidenceJudgmentV2Wire[];
};

export type AddProductionCueSupplementOperationV1 = {
  kind: 'add_production_cue_supplement';
  version: 1;
  wordId: string;
  taskId: string;
  cueId: string | null;
  englishFrame: string;
  exampleSentence: string;
  exampleTranslation: string;
};

export type AddProductionCueSupplementOperationV1Wire = Omit<
  AddProductionCueSupplementOperationV1,
  'version' | 'taskId' | 'cueId'
>;

export type AcceptProductionAlternateOperationV1 = {
  kind: 'accept_production_alternate';
  version: 1;
  targetWordId: string;
  alternateWordId: string;
};

export type PureCueDistinctiveProductionCueDraftV1 = {
  cueType: ProductionCueTypeV0;
  text: string;
};

export type PromotePureElicitationWordPlanV1 = {
  wordId: string;
  deactivateCueIds: string[];
  distinctiveCueDrafts: PureCueDistinctiveProductionCueDraftV1[];
};

export type PromotePureElicitationDestinationV1 =
  | {
      kind: 'existing';
      pureCueId: string;
    }
  | {
      kind: 'create';
      stimulus: string;
      axisNote: string;
    };

export type PromotePureElicitationOperationV1 = {
  kind: 'promote_pure_elicitation';
  version: 1;
  sourceAttemptId: string;
  targetWordId: string;
  responseWordId: string;
  destination: PromotePureElicitationDestinationV1;
  wordPlans: PromotePureElicitationWordPlanV1[];
};

/** Provider-authored fields only; source and pair identity are stamped by the server. */
export type PromotePureElicitationOperationV1Wire = Omit<
  PromotePureElicitationOperationV1,
  'kind' | 'version' | 'sourceAttemptId' | 'targetWordId' | 'responseWordId'
>;


export type PureCuePromotionPureCueSnapshotV2 = PureCuePromotionPureCueSnapshotV1 & {
  teachingNote: string;
  acceptedMembers: Array<{ wordId: string; hanzi: string }>;
};
export type PureCuePromotionEvidenceV2 = Omit<PureCuePromotionEvidenceV1, 'intersectingPureCues'> & {
  intersectingPureCues: PureCuePromotionPureCueSnapshotV2[];
};
export type ReflectionItemV6 = ReflectionItemV4 & { promotionEvidence: PureCuePromotionEvidenceV2 | null };
export type SessionReflectionBundleV6 = Omit<SessionReflectionBundleV5, 'schemaVersion' | 'items'> & {
  schemaVersion: 'session_reflection_bundle.v6'; items: ReflectionItemV6[];
};
export type CuratedReflectionBundleV3 = Omit<CuratedReflectionBundleV2, 'schemaVersion' | 'items'> & {
  schemaVersion: 'curated_reflection_bundle.v3'; items: ReflectionItemV6[];
};
export type AmbiguousPairHandoffV1 = { ambiguityReason: string };
export type PureCuePromotionBundleV2 = Omit<PureCuePromotionBundleV1, 'schemaVersion' | 'items'> & {
  schemaVersion: 'pure_cue_promotion_bundle.v2';
  items: Array<Omit<PureCuePromotionBundleV1['items'][number], 'handoff' | 'promotionEvidence'> & {
    handoff: AmbiguousPairHandoffV1; promotionEvidence: PureCuePromotionEvidenceV2;
  }>;
};
export type ReconcileProductionCuesDestinationV1 =
  | { kind: 'existing'; pureCueId: string; teachingNote: string; expectedAcceptedWordIds: string[]; expectedTeachingNote: string }
  | { kind: 'create'; stimulus: string; axisNote: string; teachingNote: string };
export type ReconcileProductionCuesOperationV1 = {
  kind: 'reconcile_production_cues'; version: 1;
  sourceAttemptId: string; targetWordId: string; responseWordId: string;
  destination: ReconcileProductionCuesDestinationV1 | null;
  wordPlans: PromotePureElicitationWordPlanV1[];
  sourceAttemptFairness: 'fair' | 'misleading_or_overloaded_cue';
};
export type ReconcileProductionCuesOperationV1Wire = Omit<ReconcileProductionCuesOperationV1,
  'kind' | 'version' | 'sourceAttemptId' | 'targetWordId' | 'responseWordId' | 'destination'> & {
  destination: null | Extract<ReconcileProductionCuesDestinationV1, { kind: 'create' }>
    | { kind: 'existing'; pureCueId: string; teachingNote: string };
};
export type PureCuePromotionResultV2Wire = {
  schemaVersion: 'pure_cue_promotion_result.v2';
  itemResults: Array<{ itemId: string; decision:
    | { kind: 'reconcile'; rationale: string; learnerExplanation: string; operation: ReconcileProductionCuesOperationV1Wire }
    | { kind: 'explanation_only'; learnerExplanation: string }
  }>;
};
export type StagedReflectionDiagnosisAmbiguousPairResultV2 = {
  kind: 'ambiguous_pair'; itemId: string; diagnosisTags: StagedReflectionDiagnosisTagV1[]; handoff: AmbiguousPairHandoffV1;
};
export type StagedReflectionDiagnosisResultV2Wire = {
  schemaVersion: 'staged_reflection_diagnosis_result.v2';
  itemResults: Array<StagedReflectionDiagnosisOrdinaryResultV1Wire | StagedReflectionDiagnosisAmbiguousPairResultV2>;
};
export type StagedReflectionDiagnosisResultV2 = {
  schemaVersion: 'staged_reflection_diagnosis_result.v2';
  itemResults: Array<StagedReflectionDiagnosisOrdinaryResultV1 | StagedReflectionDiagnosisAmbiguousPairResultV2>;
};
export type SessionReflectionResultV9 = {
  schemaVersion: 'session_reflection_result.v9'; itemResults: ReflectionItemResultV2[];
};

export type ReflectionOperation =
  | SuppressDefinitionProductionOperationV1
  | CreateContrastClusterOperation
  | RepairProductionCueOperationV1
  | RepairProductionCueOperationV2
  | AddProductionCueSupplementOperationV1
  | AcceptProductionAlternateOperationV1
  | PromotePureElicitationOperationV1
  | ReconcileProductionCuesOperationV1;

export type ReflectionOperationV5Wire =
  | SuppressDefinitionProductionOperationV1
  | CreateContrastClusterOperationV2
  | RepairProductionCueOperationV2Wire;

export type ReflectionOperationV7Wire =
  | ReflectionOperationV5Wire
  | AddProductionCueSupplementOperationV1Wire;

export type ReflectionProposalV1 = {
  proposalGroupKey: string | null;
  rationale: string;
  operation: ReflectionOperation;
};

export type ReflectionClarifyingQuestionV1 = {
  question: string;
  reason: string;
};

export type ReflectionUnhandledNeedV1 = {
  description: string;
  whyRegisteredOperationsDoNotFit: string;
};

export type ReflectionItemResultV1 = {
  itemId: string;
  diagnosisTags: ReflectionDiagnosisTagV1[];
  observation: string;
  learnerExplanation: string | null;
  proposals: ReflectionProposalV1[];
  questions: ReflectionClarifyingQuestionV1[];
  unhandledNeeds: ReflectionUnhandledNeedV1[];
};

export type ReflectionItemResultV2 = {
  itemId: string;
  diagnosisTags: ReflectionDiagnosisTagV1[];
  learnerExplanation: string;
  promotionOutcome?: 'promoted' | 'disagreement' | 'reconciled' | 'explanation_only';
  proposals: ReflectionProposalV1[];
  questions: ReflectionClarifyingQuestionV1[];
};

export type ReflectionItemResult = ReflectionItemResultV1 | ReflectionItemResultV2;

export type SessionReflectionResultV4 = {
  schemaVersion: 'session_reflection_result.v4';
  itemResults: ReflectionItemResultV1[];
};

export type ReflectionProposalV5Wire = Omit<ReflectionProposalV1, 'operation'> & {
  operation: ReflectionOperationV5Wire;
};

export type ReflectionItemResultV5Wire = Omit<ReflectionItemResultV1, 'proposals'> & {
  proposals: ReflectionProposalV5Wire[];
};

export type SessionReflectionResultV5Wire = {
  schemaVersion: 'session_reflection_result.v5';
  itemResults: ReflectionItemResultV5Wire[];
};

export type SessionReflectionResultV5 = {
  schemaVersion: 'session_reflection_result.v5';
  itemResults: ReflectionItemResultV1[];
};

export type ReflectionItemResultV6Wire = Omit<ReflectionItemResultV2, 'proposals'> & {
  proposals: ReflectionProposalV5Wire[];
};

export type SessionReflectionResultV6Wire = {
  schemaVersion: 'session_reflection_result.v6';
  itemResults: ReflectionItemResultV6Wire[];
};

export type SessionReflectionResultV6 = {
  schemaVersion: 'session_reflection_result.v6';
  itemResults: ReflectionItemResultV2[];
};

export type ReflectionProposalV7Wire = Omit<ReflectionProposalV1, 'operation'> & {
  operation: ReflectionOperationV7Wire;
};

export type ReflectionItemResultV7Wire = Omit<ReflectionItemResultV2, 'proposals'> & {
  proposals: ReflectionProposalV7Wire[];
};

export type SessionReflectionResultV7Wire = {
  schemaVersion: 'session_reflection_result.v7';
  itemResults: ReflectionItemResultV7Wire[];
};

export type SessionReflectionResultV7 = {
  schemaVersion: 'session_reflection_result.v7';
  itemResults: ReflectionItemResultV2[];
};

export type StagedReflectionDiagnosisTagV1 = Exclude<
  ReflectionDiagnosisTagV1,
  'persistent_confusion'
>;

export type StagedRepairProductionCueOperationV1Wire = {
  kind: 'repair_production_cue';
  replacementCues: Array<{
    cueType: ProductionCueTypeV0;
    text: string;
  }>;
  sourceAttemptJudgments: Array<{
    kind: 'misleading_or_overloaded_cue';
  }>;
};

export type StagedReflectionOperationV1Wire =
  | Omit<SuppressDefinitionProductionOperationV1, 'wordId'>
  | CreateContrastClusterOperationV2
  | StagedRepairProductionCueOperationV1Wire
  | Omit<AddProductionCueSupplementOperationV1Wire, 'wordId'>;

export type StagedReflectionProposalV1Wire = Omit<ReflectionProposalV1, 'operation'> & {
  operation: StagedReflectionOperationV1Wire;
};

export type StagedReflectionDiagnosisOrdinaryResultV1Wire = {
  kind: 'ordinary';
  itemId: string;
  diagnosisTags: StagedReflectionDiagnosisTagV1[];
  learnerExplanation: string;
  proposals: StagedReflectionProposalV1Wire[];
  questions: ReflectionClarifyingQuestionV1[];
};

export type StagedReflectionDiagnosisSharedAxisResultV1 = {
  kind: 'shared_axis';
  itemId: string;
  diagnosisTags: StagedReflectionDiagnosisTagV1[];
  handoff: SharedAxisHandoffV1;
};

export type StagedReflectionDiagnosisResultV1Wire = {
  schemaVersion: 'staged_reflection_diagnosis_result.v1';
  itemResults: Array<
    | StagedReflectionDiagnosisOrdinaryResultV1Wire
    | StagedReflectionDiagnosisSharedAxisResultV1
  >;
};

export type StagedReflectionDiagnosisOrdinaryResultV1 = Omit<
  StagedReflectionDiagnosisOrdinaryResultV1Wire,
  'proposals'
> & {
  proposals: ReflectionProposalV1[];
};

export type StagedReflectionDiagnosisResultV1 = {
  schemaVersion: 'staged_reflection_diagnosis_result.v1';
  itemResults: Array<
    | StagedReflectionDiagnosisOrdinaryResultV1
    | StagedReflectionDiagnosisSharedAxisResultV1
  >;
};

export type SessionReflectionResultV8 = {
  schemaVersion: 'session_reflection_result.v8';
  itemResults: ReflectionItemResultV2[];
};

export type SessionReflectionResult =
  | SessionReflectionResultV4
  | SessionReflectionResultV5
  | SessionReflectionResultV6
  | SessionReflectionResultV7
  | SessionReflectionResultV8
  | SessionReflectionResultV9;

export type EffectRef = {
  type: string;
  id: string;
};

export type ProductionCueEffectRef =
  | { type: 'production_cue'; id: string }
  | { type: 'production_cue_lifecycle_event'; id: string }
  | { type: 'production_cue_evidence_judgment'; id: string };

export type ProductionCueSupplementEffectRef = {
  type: 'production_cue_supplement';
  id: string;
};

export type ProposalSupersession = {
  source: 'competing_proposal' | 'user_replacement' | 'external_state';
  actor: 'user' | 'system';
  reason: string;
  replacementProposalId: string | null;
  replacementInvocationId: string | null;
  satisfyingEffectRefs: EffectRef[];
};

export type ProposalReviewDisposition =
  | { kind: 'pending' }
  | { kind: 'deferred' }
  | {
      kind: 'accepted';
      acceptanceMode: 'exact' | 'revised';
      acceptedInvocationId: string;
    }
    | {
        kind: 'dismissed';
        reason: string | null;
      }
    | { kind: 'requested_second_opinion' }
    | {
        kind: 'superseded';
        supersession: ProposalSupersession;
      };

export type ProposalReviewStatus = {
  proposalId: string;
  updatedAt: string;
  disposition: ProposalReviewDisposition;
};

export type OperationInvocation = {
  invocationId: string;
  createdAt: string;
  origin:
    | { kind: 'proposal_acceptance'; proposalId: string }
    | { kind: 'user_replacement'; supersededProposalId: string }
    | { kind: 'manual' };
  operation: ReflectionOperation;
};

export type OperationApplicationState =
  | {
      kind: 'unsupported';
      reason: string;
    }
  | {
      kind: 'pending';
    }
  | {
      kind: 'applied';
      appliedAt: string;
      effectRefs: EffectRef[];
    }
  | {
      kind: 'failed';
      error: string;
    }
  | {
      kind: 'stale';
      reason: string;
    }
  | {
      kind: 'already_satisfied';
      satisfyingEffectRefs: EffectRef[];
    }
  | {
      kind: 'authorization_withdrawn';
    };

export type OperationApplicationStatus = {
  invocationId: string;
  updatedAt: string;
  state: OperationApplicationState;
};

/** Closed dogfood tag set on a reflection item; praise may coexist with critiques. */
export type ReflectionQualityTag =
  | 'praise'
  | 'wrong_diagnosis'
  | 'wrong_intervention'
  | 'missed_intervention'
  | 'low_quality_content'
  | 'inconsistent'
  | 'other';

/**
 * Quality-comparison identity for the current staged flow.
 * Diagnosis and promotion calls share this version instead of splitting by stage prompt.
 */
export const CURRENT_REFLECTION_PROMPT_VERSION = STAGED_REFLECTION_DIAGNOSIS_PROMPT_VERSION;

export const REFLECTION_QUALITY_TAGS = [
  'praise',
  'wrong_diagnosis',
  'wrong_intervention',
  'missed_intervention',
  'low_quality_content',
  'inconsistent',
  'other',
] as const satisfies ReadonlyArray<ReflectionQualityTag>;

/** @deprecated Prefer ReflectionQualityTag; kept for transitional call sites. */
export type ReflectionQualityCritiqueReason = Exclude<ReflectionQualityTag, 'praise'>;

export const REFLECTION_QUALITY_CRITIQUE_REASONS = [
  'wrong_diagnosis',
  'wrong_intervention',
  'missed_intervention',
  'low_quality_content',
  'inconsistent',
  'other',
] as const satisfies ReadonlyArray<ReflectionQualityCritiqueReason>;

export type ReflectionQualityItemTags = {
  annotationId: string;
  artifactId: string;
  itemId: string;
  tags: ReflectionQualityTag[];
  note: string | null;
  createdAt: string;
  updatedAt: string;
};

export type UpsertReflectionQualityRequest = {
  artifactId: string;
  itemId: string;
  tags: ReflectionQualityTag[];
  note?: string | null;
};

export type ClearReflectionQualityRequest = {
  artifactId: string;
  itemId: string;
};

/** Open Help inbox membership for an explanation-only reflection item. */
export type ReflectionHelpInboxEntry = {
  inboxId: string;
  artifactId: string;
  itemId: string;
  openedAt: string;
};

export type MarkReflectionHelpInboxDoneRequest = {
  artifactId: string;
  itemId: string;
};

export type MarkReflectionInboxSeenRequest =
  | { kind: 'proposal'; proposalId: string }
  | { kind: 'explanation'; artifactId: string; itemId: string };

export type AuthorizeManualReflectionOperationRequest = {
  artifactId: string;
  itemId: string;
  operation: ReflectionOperation;
};

export type ReviewProposalRequest =
  | { action: 'defer' }
  | {
      action: 'dismiss';
      reason: string | null;
    }
  | { action: 'reopen' }
  | { action: 'accept'; operation: ReflectionOperation }
  | { action: 'replace'; operation: ReflectionOperation };

export function isReflectionQualityTag(value: unknown): value is ReflectionQualityTag {
  return typeof value === 'string'
    && (REFLECTION_QUALITY_TAGS as readonly string[]).includes(value);
}

export function isReflectionQualityCritiqueReason(
  value: unknown,
): value is ReflectionQualityCritiqueReason {
  return typeof value === 'string'
    && (REFLECTION_QUALITY_CRITIQUE_REASONS as readonly string[]).includes(value);
}

export type ReflectionOperationRegistration = {
  kind: ReflectionOperation['kind'];
  version: 1 | 2;
  editorAvailable: true;
  applySupport: 'supported' | 'unsupported';
};

export const REFLECTION_OPERATION_REGISTRY = [
  {
    kind: 'suppress_definition_production',
    version: 1,
    editorAvailable: true,
    applySupport: 'supported',
  },
  {
    kind: 'create_contrast_cluster',
    version: 1,
    editorAvailable: true,
    applySupport: 'supported',
  },
  {
    kind: 'create_contrast_cluster',
    version: 2,
    editorAvailable: true,
    applySupport: 'supported',
  },
  {
    kind: 'repair_production_cue',
    version: 1,
    editorAvailable: true,
    applySupport: 'unsupported',
  },
  {
    kind: 'repair_production_cue',
    version: 2,
    editorAvailable: true,
    applySupport: 'supported',
  },
  {
    kind: 'add_production_cue_supplement',
    version: 1,
    editorAvailable: true,
    applySupport: 'supported',
  },
  {
    kind: 'accept_production_alternate',
    version: 1,
    editorAvailable: true,
    applySupport: 'unsupported',
  },
  { kind: 'reconcile_production_cues', version: 1, editorAvailable: true, applySupport: 'supported' },
  {
    kind: 'promote_pure_elicitation',
    version: 1,
    editorAvailable: true,
    applySupport: 'supported',
  },
] as const satisfies readonly ReflectionOperationRegistration[];

export function getReflectionOperationRegistration(
  kind: string,
  version: number,
): ReflectionOperationRegistration | null {
  return REFLECTION_OPERATION_REGISTRY.find(
    (registration) => registration.kind === kind && registration.version === version,
  ) ?? null;
}

type UnknownRecord = Record<string, unknown>;

export type ReflectionOperationValidationOptions = {
  allowedWordIds?: ReadonlySet<string>;
  evidenceItemId?: string;
  path?: string;
};

const diagnosisTags = new Set<ReflectionDiagnosisTagV1>([
  'valid_or_near_valid_alternate',
  'cue_overlap_hides_usage_difference',
  'production_cue_overloaded',
  'form_or_sound_interference',
  'grammar_or_usage_role_interference',
  'ordinary_retrieval_noise',
  'persistent_confusion',
  'insufficient_evidence',
]);

const cueTypes = new Set([
  'definition_gloss',
  'cloze',
  'minimal_context',
  'register_or_domain_hint',
]);

const productionCueTypesV0 = new Set<ProductionCueTypeV0>([
  'definition_gloss',
  'minimal_context',
  'circumstance',
]);

const productionCueChangeKindsV2 = new Set<ProductionCueChangeV2['kind']>([
  'create',
  'replace',
  'deactivate',
]);

const cueEvidenceJudgmentKindsV2 = new Set<CueEvidenceJudgmentV2['kind']>([
  'accepted_answer_space_omission',
  'misleading_or_overloaded_cue',
]);

const repairIntents = new Set([
  'narrow_to_learner_relevant_sense',
  'add_distinguishing_anchor',
  'add_contextual_triangulation',
  'split_overloaded_cue',
]);

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateObjectFields(
  value: unknown,
  fields: readonly string[],
  path: string,
): string[] {
  if (!isRecord(value)) return [`${path}: expected object`];
  const errors: string[] = [];
  for (const field of fields) {
    if (!Object.hasOwn(value, field)) errors.push(`${path}.${field}: required property is missing`);
  }
  for (const field of Object.keys(value)) {
    if (!fields.includes(field)) errors.push(`${path}.${field}: unknown property`);
  }
  return errors;
}

function validateObjectFieldsWithOptional(
  value: unknown,
  requiredFields: readonly string[],
  optionalFields: readonly string[],
  path: string,
): string[] {
  if (!isRecord(value)) return [`${path}: expected object`];
  const errors: string[] = [];
  for (const field of requiredFields) {
    if (!Object.hasOwn(value, field)) errors.push(`${path}.${field}: required property is missing`);
  }
  for (const field of Object.keys(value)) {
    if (!requiredFields.includes(field) && !optionalFields.includes(field)) {
      errors.push(`${path}.${field}: unknown property`);
    }
  }
  return errors;
}

function validateString(value: unknown, path: string, nonEmpty = false): string[] {
  if (typeof value !== 'string') return [`${path}: expected string`];
  if (nonEmpty && value.trim().length === 0) return [`${path}: must not be empty`];
  return [];
}

function validateNullableString(value: unknown, path: string): string[] {
  return value === null ? [] : validateString(value, path);
}

function validateWordReference(
  value: unknown,
  path: string,
  options: ReflectionOperationValidationOptions,
): string[] {
  const errors = validateString(value, path, true);
  if (errors.length > 0 || options.allowedWordIds === undefined) return errors;
  const wordId = value as string;
  if (options.allowedWordIds.has(wordId)) return errors;
  const detail = options.evidenceItemId === undefined
    ? 'is not known and visible'
    : `is not present in item ${options.evidenceItemId}`;
  errors.push(`${path}: word id ${wordId} ${detail}`);
  return errors;
}

export function reflectionOperationWordReferences(operation: ReflectionOperation): string[] {
  switch (operation.kind) {
    case 'suppress_definition_production':
      return [operation.wordId];
    case 'repair_production_cue':
      if (operation.version === 1) return [operation.wordId];
      return [
        operation.wordId,
        ...operation.changes.flatMap((change) => {
          switch (change.kind) {
            case 'create':
              return change.cue.acceptedWordIds;
            case 'replace':
              return change.replacements.flatMap((cue) => cue.acceptedWordIds);
            case 'deactivate':
              return [];
          }
        }),
        ...operation.sourceAttemptJudgments.flatMap((judgment) => (
          judgment.kind === 'accepted_answer_space_omission'
            ? [judgment.submittedWordId]
            : []
        )),
      ];
    case 'add_production_cue_supplement':
      return [operation.wordId];
    case 'create_contrast_cluster':
      return operation.members.map((member) => member.wordId);
    case 'accept_production_alternate':
      return [operation.targetWordId, operation.alternateWordId];
    case 'reconcile_production_cues':
    case 'promote_pure_elicitation':
      return [
        operation.targetWordId,
        operation.responseWordId,
        ...operation.wordPlans.map((plan) => plan.wordId),
      ];
  }
}

export function validateReflectionOperation(
  value: unknown,
  options: ReflectionOperationValidationOptions = {},
): string[] {
  const path = options.path ?? '$';
  if (!isRecord(value)) return [`${path}: expected object`];
  const kind = value.kind;
  const version = value.version;
  if (typeof kind !== 'string') return [`${path}.kind: expected string`];
  if (typeof version !== 'number' || !Number.isInteger(version)) {
    return [`${path}.version: expected integer`];
  }
  if (getReflectionOperationRegistration(kind, version) === null) {
    return [`${path}: unknown operation kind/version ${kind}@${version}`];
  }

  const errors: string[] = [];
  switch (kind) {
    case 'suppress_definition_production': {
      errors.push(...validateObjectFields(value, ['kind', 'version', 'wordId'], path));
      errors.push(...validateWordReference(value.wordId, `${path}.wordId`, options));
      break;
    }
    case 'create_contrast_cluster': {
      errors.push(...validateObjectFields(
        value,
        ['kind', 'version', 'title', 'clusterNote', 'members', 'prompts'],
        path,
      ));
      errors.push(...validateString(value.title, `${path}.title`, true));
      errors.push(...validateNullableString(value.clusterNote, `${path}.clusterNote`));

      if (!Array.isArray(value.members)) {
        errors.push(`${path}.members: expected array`);
      } else {
        const memberIds: string[] = [];
        for (const [index, member] of value.members.entries()) {
          const memberPath = `${path}.members[${index}]`;
          errors.push(...validateObjectFields(member, ['wordId', 'nuanceNote'], memberPath));
          if (!isRecord(member)) continue;
          errors.push(...validateWordReference(member.wordId, `${memberPath}.wordId`, options));
          errors.push(...validateNullableString(member.nuanceNote, `${memberPath}.nuanceNote`));
          if (typeof member.wordId === 'string') memberIds.push(member.wordId);
        }
        if (new Set(memberIds).size < 2) {
          errors.push(`${path}.members: at least two distinct words are required`);
        }
        if (new Set(memberIds).size !== memberIds.length) {
          errors.push(`${path}.members: duplicate word id`);
        }
      }

      if (!Array.isArray(value.prompts)) {
        errors.push(`${path}.prompts: expected array`);
      } else {
        const memberIds = new Set(
          Array.isArray(value.members)
            ? value.members.flatMap((member) => (
              isRecord(member) && typeof member.wordId === 'string' ? [member.wordId] : []
            ))
            : [],
        );
        const promptKeys = new Set<string>();
        const promptCountByTarget = new Map<string, number>();
        for (const [index, prompt] of value.prompts.entries()) {
          const promptPath = `${path}.prompts[${index}]`;
          errors.push(...validateObjectFields(
            prompt,
            ['targetWordId', 'promptText', 'explanation'],
            promptPath,
          ));
          if (!isRecord(prompt)) continue;
          errors.push(...validateWordReference(
            prompt.targetWordId,
            `${promptPath}.targetWordId`,
            options,
          ));
          errors.push(...validateString(prompt.promptText, `${promptPath}.promptText`, true));
          errors.push(...validateNullableString(prompt.explanation, `${promptPath}.explanation`));
          if (typeof prompt.targetWordId === 'string' && !memberIds.has(prompt.targetWordId)) {
            errors.push(`${path}.prompts: every target must be a member`);
          }
          if (typeof prompt.targetWordId === 'string' && memberIds.has(prompt.targetWordId)) {
            promptCountByTarget.set(
              prompt.targetWordId,
              (promptCountByTarget.get(prompt.targetWordId) ?? 0) + 1,
            );
          }
          if (typeof prompt.targetWordId === 'string' && typeof prompt.promptText === 'string') {
            const promptKey = `${prompt.targetWordId}\u0000${prompt.promptText.trim()}`;
            if (promptKeys.has(promptKey)) {
              errors.push(`${path}.prompts: duplicate prompt`);
            }
            promptKeys.add(promptKey);
          }
        }
        if (version === 1 && value.prompts.length === 0) {
          errors.push(`${path}.prompts: at least one prompt is required`);
        }
        if (version === 2) {
          for (const memberId of memberIds) {
            if ((promptCountByTarget.get(memberId) ?? 0) < 2) {
              errors.push(`${path}.prompts: member ${memberId} requires at least two prompts`);
            }
          }
        }
      }
      break;
    }
    case 'repair_production_cue': {
      if (version === 2) {
        errors.push(...validateRepairProductionCueOperationV2(value, options));
        break;
      }
      errors.push(...validateObjectFields(
        value,
        ['kind', 'version', 'wordId', 'proposedCues', 'repairIntent'],
        path,
      ));
      errors.push(...validateWordReference(value.wordId, `${path}.wordId`, options));
      if (!Array.isArray(value.proposedCues)) {
        errors.push(`${path}.proposedCues: expected array`);
      } else {
        if (value.proposedCues.length === 0) {
          errors.push(`${path}.proposedCues: at least one replacement is required`);
        }
        for (const [index, cue] of value.proposedCues.entries()) {
          const cuePath = `${path}.proposedCues[${index}]`;
          errors.push(...validateObjectFields(cue, ['cueType', 'text'], cuePath));
          if (!isRecord(cue)) continue;
          if (typeof cue.cueType !== 'string' || !cueTypes.has(cue.cueType)) {
            errors.push(`${cuePath}.cueType: value is not in the allowed enum`);
          }
          errors.push(...validateString(cue.text, `${cuePath}.text`, true));
        }
      }
      if (typeof value.repairIntent !== 'string' || !repairIntents.has(value.repairIntent)) {
        errors.push(`${path}.repairIntent: value is not in the allowed enum`);
      }
      break;
    }
    case 'add_production_cue_supplement': {
      errors.push(...validateObjectFields(
        value,
        [
          'kind',
          'version',
          'wordId',
          'taskId',
          'cueId',
          'englishFrame',
          'exampleSentence',
          'exampleTranslation',
        ],
        path,
      ));
      errors.push(...validateWordReference(value.wordId, `${path}.wordId`, options));
      errors.push(...validateString(value.taskId, `${path}.taskId`, true));
      errors.push(...validateNullableString(value.cueId, `${path}.cueId`));
      errors.push(...validateString(value.englishFrame, `${path}.englishFrame`, true));
      errors.push(...validateString(value.exampleSentence, `${path}.exampleSentence`, true));
      errors.push(...validateString(value.exampleTranslation, `${path}.exampleTranslation`, true));
      break;
    }
    case 'accept_production_alternate': {
      errors.push(...validateObjectFields(
        value,
        ['kind', 'version', 'targetWordId', 'alternateWordId'],
        path,
      ));
      errors.push(...validateWordReference(value.targetWordId, `${path}.targetWordId`, options));
      errors.push(...validateWordReference(value.alternateWordId, `${path}.alternateWordId`, options));
      if (
        typeof value.targetWordId === 'string'
        && value.targetWordId === value.alternateWordId
      ) {
        errors.push(`${path}: target and alternate words must be distinct`);
      }
      break;
    }
    case 'reconcile_production_cues': {
      errors.push(...validateObjectFields(value, ['kind', 'version', 'sourceAttemptId', 'targetWordId', 'responseWordId', 'destination', 'wordPlans', 'sourceAttemptFairness'], path));
      const { sourceAttemptFairness, destination, ...base } = value;
      errors.push(...validateReflectionOperation({ ...base, kind: 'promote_pure_elicitation', destination: { kind: 'create', stimulus: 'validation', axisNote: 'validation' } }, options));
      if (sourceAttemptFairness !== 'fair' && sourceAttemptFairness !== 'misleading_or_overloaded_cue') errors.push(`${path}.sourceAttemptFairness: expected fair or misleading_or_overloaded_cue`);
      if (destination !== null) {
        if (!isRecord(destination)) errors.push(`${path}.destination: expected object or null`);
        else {
          const fields = destination.kind === 'existing'
            ? ['kind', 'pureCueId', 'teachingNote', 'expectedAcceptedWordIds', 'expectedTeachingNote']
            : ['kind', 'stimulus', 'axisNote', 'teachingNote'];
          errors.push(...validateObjectFields(destination, fields, `${path}.destination`));
          errors.push(...validateString(destination.teachingNote, `${path}.destination.teachingNote`, true));
          if (destination.kind === 'existing') {
            errors.push(...validateString(destination.pureCueId, `${path}.destination.pureCueId`, true));
            errors.push(...validateString(destination.expectedTeachingNote, `${path}.destination.expectedTeachingNote`, false));
            if (!Array.isArray(destination.expectedAcceptedWordIds) || destination.expectedAcceptedWordIds.length < 2
              || destination.expectedAcceptedWordIds.some((id) => typeof id !== 'string' || !id.trim())
              || new Set(destination.expectedAcceptedWordIds).size !== destination.expectedAcceptedWordIds.length) errors.push(`${path}.destination.expectedAcceptedWordIds: expected distinct member ids`);
          } else if (destination.kind === 'create') {
            errors.push(...validateString(destination.stimulus, `${path}.destination.stimulus`, true));
            errors.push(...validateString(destination.axisNote, `${path}.destination.axisNote`, true));
          } else errors.push(`${path}.destination.kind: expected existing or create`);
        }
      }
      if (destination === null && Array.isArray(value.wordPlans) && !value.wordPlans.some((plan) => isRecord(plan) && ((Array.isArray(plan.deactivateCueIds) && plan.deactivateCueIds.length > 0) || (Array.isArray(plan.distinctiveCueDrafts) && plan.distinctiveCueDrafts.length > 0)))) errors.push(`${path}: reconciliation must change content; use explanation_only for no change`);
      break;
    }
    case 'promote_pure_elicitation': {
      errors.push(...validateObjectFields(
        value,
        [
          'kind',
          'version',
          'sourceAttemptId',
          'targetWordId',
          'responseWordId',
          'destination',
          'wordPlans',
        ],
        path,
      ));
      errors.push(...validateString(value.sourceAttemptId, `${path}.sourceAttemptId`, true));
      errors.push(...validateWordReference(value.targetWordId, `${path}.targetWordId`, options));
      errors.push(...validateWordReference(value.responseWordId, `${path}.responseWordId`, options));
      if (
        typeof value.targetWordId === 'string'
        && value.targetWordId === value.responseWordId
      ) {
        errors.push(`${path}: target and response words must be distinct`);
      }

      if (!isRecord(value.destination)) {
        errors.push(`${path}.destination: expected object`);
      } else if (value.destination.kind === 'existing') {
        errors.push(...validateObjectFields(
          value.destination,
          ['kind', 'pureCueId'],
          `${path}.destination`,
        ));
        errors.push(...validateString(
          value.destination.pureCueId,
          `${path}.destination.pureCueId`,
          true,
        ));
      } else if (value.destination.kind === 'create') {
        errors.push(...validateObjectFields(
          value.destination,
          ['kind', 'stimulus', 'axisNote'],
          `${path}.destination`,
        ));
        errors.push(...validateString(
          value.destination.stimulus,
          `${path}.destination.stimulus`,
          true,
        ));
        errors.push(...validateString(
          value.destination.axisNote,
          `${path}.destination.axisNote`,
          true,
        ));
      } else {
        errors.push(`${path}.destination.kind: value is not in the allowed enum`);
      }

      if (!Array.isArray(value.wordPlans)) {
        errors.push(`${path}.wordPlans: expected array`);
      } else {
        const planWordIds: string[] = [];
        for (const [index, plan] of value.wordPlans.entries()) {
          const planPath = `${path}.wordPlans[${index}]`;
          errors.push(...validateObjectFields(
            plan,
            ['wordId', 'deactivateCueIds', 'distinctiveCueDrafts'],
            planPath,
          ));
          if (!isRecord(plan)) continue;
          errors.push(...validateWordReference(plan.wordId, `${planPath}.wordId`, options));
          if (typeof plan.wordId === 'string') planWordIds.push(plan.wordId);
          if (!Array.isArray(plan.deactivateCueIds)) {
            errors.push(`${planPath}.deactivateCueIds: expected array`);
          } else {
            const cueIds: string[] = [];
            plan.deactivateCueIds.forEach((cueId, cueIndex) => {
              errors.push(...validateString(
                cueId,
                `${planPath}.deactivateCueIds[${cueIndex}]`,
                true,
              ));
              if (typeof cueId === 'string') cueIds.push(cueId);
            });
            if (new Set(cueIds).size !== cueIds.length) {
              errors.push(`${planPath}.deactivateCueIds: duplicate cue id`);
            }
          }
          if (!Array.isArray(plan.distinctiveCueDrafts)) {
            errors.push(`${planPath}.distinctiveCueDrafts: expected array`);
          } else {
            plan.distinctiveCueDrafts.forEach((draft, draftIndex) => {
              const draftPath = `${planPath}.distinctiveCueDrafts[${draftIndex}]`;
              errors.push(...validateObjectFields(draft, ['cueType', 'text'], draftPath));
              if (!isRecord(draft)) return;
              if (
                typeof draft.cueType !== 'string'
                || !productionCueTypesV0.has(draft.cueType as ProductionCueTypeV0)
              ) {
                errors.push(`${draftPath}.cueType: value is not in the allowed enum`);
              }
              errors.push(...validateString(draft.text, `${draftPath}.text`, true));
            });
          }
        }
        if (new Set(planWordIds).size !== planWordIds.length) {
          errors.push(`${path}.wordPlans: duplicate word plan`);
        }
        if (
          typeof value.targetWordId === 'string'
          && typeof value.responseWordId === 'string'
          && (
            planWordIds.length !== 2
            || !planWordIds.includes(value.targetWordId)
            || !planWordIds.includes(value.responseWordId)
          )
        ) {
          errors.push(`${path}.wordPlans: exactly one plan is required for each affected word`);
        }
      }
      break;
    }
  }
  return errors;
}

function validateProductionCueDraftV2(
  value: unknown,
  path: string,
  anchorWordId: unknown,
  options: ReflectionOperationValidationOptions,
): string[] {
  const errors = validateObjectFields(value, ['cueType', 'text', 'acceptedWordIds'], path);
  if (!isRecord(value)) return errors;
  if (
    typeof value.cueType !== 'string'
    || !productionCueTypesV0.has(value.cueType as ProductionCueTypeV0)
  ) {
    errors.push(`${path}.cueType: value is not in the allowed enum`);
  }
  errors.push(...validateString(value.text, `${path}.text`, true));
  if (!Array.isArray(value.acceptedWordIds)) {
    errors.push(`${path}.acceptedWordIds: expected array`);
    return errors;
  }
  if (value.acceptedWordIds.length === 0) {
    errors.push(`${path}.acceptedWordIds: at least one word is required`);
  }
  const acceptedWordIds: string[] = [];
  for (const [index, acceptedWordId] of value.acceptedWordIds.entries()) {
    errors.push(...validateWordReference(
      acceptedWordId,
      `${path}.acceptedWordIds[${index}]`,
      options,
    ));
    if (typeof acceptedWordId === 'string') acceptedWordIds.push(acceptedWordId);
  }
  if (new Set(acceptedWordIds).size !== acceptedWordIds.length) {
    errors.push(`${path}.acceptedWordIds: duplicate word id`);
  }
  if (typeof anchorWordId === 'string' && !acceptedWordIds.includes(anchorWordId)) {
    errors.push(`${path}.acceptedWordIds: must include anchor word ${anchorWordId}`);
  }
  return errors;
}

function validateRepairProductionCueOperationV2(
  value: UnknownRecord,
  options: ReflectionOperationValidationOptions,
): string[] {
  const path = options.path ?? '$';
  const errors = validateObjectFields(
    value,
    ['kind', 'version', 'wordId', 'taskId', 'changes', 'sourceAttemptJudgments'],
    path,
  );
  errors.push(...validateWordReference(value.wordId, `${path}.wordId`, options));
  errors.push(...validateString(value.taskId, `${path}.taskId`, true));

  const changedCueIds: string[] = [];
  const authoredAcceptedWordIds = new Set<string>();
  if (!Array.isArray(value.changes)) {
    errors.push(`${path}.changes: expected array`);
  } else {
    if (value.changes.length === 0) {
      errors.push(`${path}.changes: at least one cue change is required`);
    }
    for (const [index, change] of value.changes.entries()) {
      const changePath = `${path}.changes[${index}]`;
      if (!isRecord(change)) {
        errors.push(`${changePath}: expected object`);
        continue;
      }
      if (
        typeof change.kind !== 'string'
        || !productionCueChangeKindsV2.has(change.kind as ProductionCueChangeV2['kind'])
      ) {
        errors.push(`${changePath}.kind: value is not in the allowed enum`);
        continue;
      }
      switch (change.kind) {
        case 'create': {
          errors.push(...validateObjectFields(change, ['kind', 'cue'], changePath));
          errors.push(...validateProductionCueDraftV2(
            change.cue,
            `${changePath}.cue`,
            value.wordId,
            options,
          ));
          if (isRecord(change.cue) && Array.isArray(change.cue.acceptedWordIds)) {
            for (const wordId of change.cue.acceptedWordIds) {
              if (typeof wordId === 'string') authoredAcceptedWordIds.add(wordId);
            }
          }
          break;
        }
        case 'replace': {
          errors.push(...validateObjectFields(
            change,
            ['kind', 'cueId', 'replacements'],
            changePath,
          ));
          errors.push(...validateString(change.cueId, `${changePath}.cueId`, true));
          if (typeof change.cueId === 'string') changedCueIds.push(change.cueId);
          if (!Array.isArray(change.replacements)) {
            errors.push(`${changePath}.replacements: expected array`);
          } else {
            if (change.replacements.length === 0) {
              errors.push(`${changePath}.replacements: at least one replacement is required`);
            }
            for (const [replacementIndex, replacement] of change.replacements.entries()) {
              errors.push(...validateProductionCueDraftV2(
                replacement,
                `${changePath}.replacements[${replacementIndex}]`,
                value.wordId,
                options,
              ));
              if (isRecord(replacement) && Array.isArray(replacement.acceptedWordIds)) {
                for (const wordId of replacement.acceptedWordIds) {
                  if (typeof wordId === 'string') authoredAcceptedWordIds.add(wordId);
                }
              }
            }
          }
          break;
        }
        case 'deactivate': {
          errors.push(...validateObjectFields(change, ['kind', 'cueId'], changePath));
          errors.push(...validateString(change.cueId, `${changePath}.cueId`, true));
          if (typeof change.cueId === 'string') changedCueIds.push(change.cueId);
          break;
        }
      }
    }
  }
  if (new Set(changedCueIds).size !== changedCueIds.length) {
    errors.push(`${path}.changes: a cue id may be referenced by only one change`);
  }

  if (!Array.isArray(value.sourceAttemptJudgments)) {
    errors.push(`${path}.sourceAttemptJudgments: expected array`);
  } else {
    const judgmentKeys = new Set<string>();
    for (const [index, judgment] of value.sourceAttemptJudgments.entries()) {
      const judgmentPath = `${path}.sourceAttemptJudgments[${index}]`;
      if (!isRecord(judgment)) {
        errors.push(`${judgmentPath}: expected object`);
        continue;
      }
      if (
        typeof judgment.kind !== 'string'
        || !cueEvidenceJudgmentKindsV2.has(judgment.kind as CueEvidenceJudgmentV2['kind'])
      ) {
        errors.push(`${judgmentPath}.kind: value is not in the allowed enum`);
        continue;
      }
      const judgmentKey = `${judgment.kind}\u0000${String(judgment.sourceAttemptId)}`;
      if (judgmentKeys.has(judgmentKey)) {
        errors.push(`${path}.sourceAttemptJudgments: duplicate judgment`);
      }
      judgmentKeys.add(judgmentKey);
      switch (judgment.kind) {
        case 'accepted_answer_space_omission':
          errors.push(...validateObjectFields(
            judgment,
            ['kind', 'sourceAttemptId', 'submittedWordId'],
            judgmentPath,
          ));
          errors.push(...validateString(
            judgment.sourceAttemptId,
            `${judgmentPath}.sourceAttemptId`,
            true,
          ));
          errors.push(...validateWordReference(
            judgment.submittedWordId,
            `${judgmentPath}.submittedWordId`,
            options,
          ));
          if (
            typeof judgment.submittedWordId === 'string'
            && !authoredAcceptedWordIds.has(judgment.submittedWordId)
          ) {
            errors.push(
              `${judgmentPath}.submittedWordId: must be admitted by a created or replacement cue`,
            );
          }
          break;
        case 'misleading_or_overloaded_cue':
          errors.push(...validateObjectFields(
            judgment,
            ['kind', 'sourceAttemptId'],
            judgmentPath,
          ));
          errors.push(...validateString(
            judgment.sourceAttemptId,
            `${judgmentPath}.sourceAttemptId`,
            true,
          ));
          break;
      }
    }
  }
  return errors;
}

export function visibleWordIds(
  item: ReflectionInputItemV1 | ReflectionInputItemV2 | ReflectionItemV3 | ReflectionItemV4 | ReflectionItemV5,
): Set<string> {
  const ids = new Set<string>();
  if (item.targetWord !== null) ids.add(item.targetWord.wordId);
  if ('submittedWord' in item && item.submittedWord !== null) {
    ids.add(item.submittedWord.wordId);
  }
  if (item.source === 'session_note') {
    for (const relatedWord of item.relatedWords) ids.add(relatedWord.wordId);
  }
  if (item.source === 'contrast_selection') {
    for (const choiceWord of item.promptAsShown.choiceWords) ids.add(choiceWord.wordId);
  }
  if ('servedCue' in item) {
    for (const acceptedWordId of item.servedCue.acceptedWordIds) ids.add(acceptedWordId);
  }
  return ids;
}

export function validateSessionReflectionResult(
  value: unknown,
  bundle: SessionReflectionBundleV1,
): string[] {
  return validateSessionReflectionResultVersion(
    value,
    bundle,
    'session_reflection_result.v4',
  );
}

export function validateSessionReflectionResultV5(
  value: unknown,
  bundle: SessionReflectionBundleV2 | SessionReflectionBundleV3,
): string[] {
  return validateSessionReflectionResultVersion(
    value,
    bundle,
    'session_reflection_result.v5',
  );
}

export function validateSessionReflectionResultV6(
  value: unknown,
  bundle: SessionReflectionBundleV2 | SessionReflectionBundleV3,
): string[] {
  return validateSessionReflectionResultVersion(
    value,
    bundle,
    'session_reflection_result.v6',
  );
}

export function validateSessionReflectionResultV7(
  value: unknown,
  bundle: ReflectionDiagnosisBundle,
): string[] {
  return validateSessionReflectionResultVersion(
    value,
    bundle,
    'session_reflection_result.v7',
  );
}

export function validateSessionReflectionResultV8(
  value: unknown,
  bundle: SessionReflectionBundleV5 | CuratedReflectionBundleV2,
): string[] {
  return validateSessionReflectionResultVersion(
    value,
    bundle,
    'session_reflection_result.v8',
  );
}

export function validateStagedReflectionDiagnosisResultV1(
  value: unknown,
  bundle: SessionReflectionBundleV4 | CuratedReflectionDiagnosisBundleV2,
): string[] {
  const errors = validateObjectFields(value, ['schemaVersion', 'itemResults'], '$');
  if (!isRecord(value)) return errors;
  if (value.schemaVersion !== 'staged_reflection_diagnosis_result.v1') {
    errors.push('$.schemaVersion: expected staged_reflection_diagnosis_result.v1');
  }
  if (!Array.isArray(value.itemResults)) {
    errors.push('$.itemResults: expected array');
    return errors;
  }

  const expectedItems = new Map(bundle.items.map((item) => [item.itemId, item]));
  const seen = new Set<string>();
  value.itemResults.forEach((itemResult, itemIndex) => {
    const path = `$.itemResults[${itemIndex}]`;
    if (!isRecord(itemResult)) {
      errors.push(`${path}: expected object`);
      return;
    }
    const ordinary = itemResult.kind === 'ordinary';
    const sharedAxis = itemResult.kind === 'shared_axis';
    if (!ordinary && !sharedAxis) {
      errors.push(`${path}.kind: expected ordinary or shared_axis`);
      return;
    }
    errors.push(...validateObjectFields(
      itemResult,
      ordinary
        ? ['kind', 'itemId', 'diagnosisTags', 'learnerExplanation', 'proposals', 'questions']
        : ['kind', 'itemId', 'diagnosisTags', 'handoff'],
      path,
    ));
    errors.push(...validateString(itemResult.itemId, `${path}.itemId`, true));
    const itemId = typeof itemResult.itemId === 'string' ? itemResult.itemId : '';
    if (seen.has(itemId)) errors.push(`${path}.itemId: duplicate item id`);
    seen.add(itemId);
    errors.push(...validateStagedDiagnosisTagList(
      itemResult.diagnosisTags,
      `${path}.diagnosisTags`,
    ));

    const inputItem = expectedItems.get(itemId);
    if (ordinary) {
      errors.push(...validateString(
        itemResult.learnerExplanation,
        `${path}.learnerExplanation`,
        true,
      ));
      errors.push(...validateStagedOrdinaryProposals(
        itemResult.proposals,
        inputItem,
        `${path}.proposals`,
      ));
      errors.push(...validateClarifyingQuestions(itemResult.questions, `${path}.questions`));
      return;
    }

    errors.push(...validateSharedAxisHandoff(itemResult.handoff, `${path}.handoff`));
    if (inputItem !== undefined && !isSharedAxisDiagnosisEligible(inputItem)) {
      errors.push(
        `${path}: shared_axis requires a rejected strict target-only production attempt with a known distinct response`,
      );
    }
  });
  if (seen.size !== expectedItems.size || [...expectedItems.keys()].some((itemId) => !seen.has(itemId))) {
    errors.push('$.itemResults: every diagnosis input item must appear exactly once and no unknown item is allowed');
  }
  return errors;
}

export function validateStagedReflectionDiagnosisResultV2(
  value: unknown,
  bundle: SessionReflectionBundleV4 | CuratedReflectionDiagnosisBundleV2,
): string[] {
  const errors = validateObjectFields(value, ['schemaVersion', 'itemResults'], '$');
  if (!isRecord(value)) return errors;
  if (value.schemaVersion !== 'staged_reflection_diagnosis_result.v2') {
    errors.push('$.schemaVersion: expected staged_reflection_diagnosis_result.v2');
  }
  if (!Array.isArray(value.itemResults)) {
    errors.push('$.itemResults: expected array');
    return errors;
  }

  const expectedItems = new Map(bundle.items.map((item) => [item.itemId, item]));
  const seen = new Set<string>();
  value.itemResults.forEach((itemResult, itemIndex) => {
    const path = `$.itemResults[${itemIndex}]`;
    if (!isRecord(itemResult)) {
      errors.push(`${path}: expected object`);
      return;
    }
    const ordinary = itemResult.kind === 'ordinary';
    const sharedAxis = itemResult.kind === 'ambiguous_pair';
    if (!ordinary && !sharedAxis) {
      errors.push(`${path}.kind: expected ordinary or ambiguous_pair`);
      return;
    }
    errors.push(...validateObjectFields(
      itemResult,
      ordinary
        ? ['kind', 'itemId', 'diagnosisTags', 'learnerExplanation', 'proposals', 'questions']
        : ['kind', 'itemId', 'diagnosisTags', 'handoff'],
      path,
    ));
    errors.push(...validateString(itemResult.itemId, `${path}.itemId`, true));
    const itemId = typeof itemResult.itemId === 'string' ? itemResult.itemId : '';
    if (seen.has(itemId)) errors.push(`${path}.itemId: duplicate item id`);
    seen.add(itemId);
    errors.push(...validateStagedDiagnosisTagList(
      itemResult.diagnosisTags,
      `${path}.diagnosisTags`,
    ));

    const inputItem = expectedItems.get(itemId);
    if (ordinary) {
      errors.push(...validateString(
        itemResult.learnerExplanation,
        `${path}.learnerExplanation`,
        true,
      ));
      errors.push(...validateStagedOrdinaryProposals(
        itemResult.proposals,
        inputItem,
        `${path}.proposals`,
      ));
      errors.push(...validateClarifyingQuestions(itemResult.questions, `${path}.questions`));
      return;
    }

    errors.push(...validateAmbiguousPairHandoff(itemResult.handoff, `${path}.handoff`));
    if (inputItem !== undefined && !isSharedAxisDiagnosisEligible(inputItem)) {
      errors.push(
        `${path}: ambiguous_pair requires a rejected strict target-only production attempt with a known distinct response`,
      );
    }
  });
  if (seen.size !== expectedItems.size || [...expectedItems.keys()].some((itemId) => !seen.has(itemId))) {
    errors.push('$.itemResults: every diagnosis input item must appear exactly once and no unknown item is allowed');
  }
  return errors;
}

function validateDiagnosisTagList(value: unknown, path: string): string[] {
  if (!Array.isArray(value)) return [`${path}: expected array`];
  const tags = value.filter(
    (tag): tag is ReflectionDiagnosisTagV1 => (
      typeof tag === 'string' && diagnosisTags.has(tag as ReflectionDiagnosisTagV1)
    ),
  );
  const errors: string[] = [];
  if (tags.length !== value.length) errors.push(`${path}: value is not in the allowed enum`);
  if (new Set(tags).size !== tags.length) errors.push(`${path}: duplicate tag`);
  return errors;
}

function validateStagedDiagnosisTagList(value: unknown, path: string): string[] {
  const errors = validateDiagnosisTagList(value, path);
  if (Array.isArray(value) && value.includes('persistent_confusion')) {
    errors.push(`${path}: persistent_confusion is not available in staged diagnosis`);
  }
  return errors;
}

function validateSharedAxisHandoff(value: unknown, path: string): string[] {
  const errors = validateObjectFields(
    value,
    ['axis', 'boundaries', 'responseValidity'],
    path,
  );
  if (!isRecord(value)) return errors;
  errors.push(...validateString(value.axis, `${path}.axis`, true));
  errors.push(...validateString(value.boundaries, `${path}.boundaries`, true));
  errors.push(...validateString(value.responseValidity, `${path}.responseValidity`, true));
  return errors;
}

function isSharedAxisDiagnosisEligible(item: unknown): boolean {
  if (
    !isRecord(item)
    || !isRecord(item.targetWord)
    || typeof item.targetWord.wordId !== 'string'
    || !isRecord(item.submittedWord)
    || typeof item.submittedWord.wordId !== 'string'
    || !isRecord(item.servedCue)
    || !Array.isArray(item.servedCue.acceptedWordIds)
  ) return false;
  return item.source === 'production_mistake'
    && item.sourceActionKind === 'production'
    && item.responseKind === 'matched_known_word'
    && item.submittedWord.wordId !== item.targetWord.wordId
    && item.servedCue.acceptedWordIds.length === 1
    && item.servedCue.acceptedWordIds[0] === item.targetWord.wordId;
}

function validateStagedOrdinaryProposals(
  value: unknown,
  inputItem: ReflectionItemV4 | undefined,
  path: string,
): string[] {
  if (!Array.isArray(value)) return [`${path}: expected array`];
  const errors: string[] = [];
  value.forEach((proposal, proposalIndex) => {
    const proposalPath = `${path}[${proposalIndex}]`;
    errors.push(...validateObjectFields(
      proposal,
      ['proposalGroupKey', 'rationale', 'operation'],
      proposalPath,
    ));
    if (!isRecord(proposal)) return;
    errors.push(...validateNullableString(proposal.proposalGroupKey, `${proposalPath}.proposalGroupKey`));
    errors.push(...validateString(proposal.rationale, `${proposalPath}.rationale`, true));
    errors.push(...validateReflectionOperation(proposal.operation, {
      allowedWordIds: inputItem === undefined ? undefined : visibleWordIds(inputItem),
      evidenceItemId: inputItem?.itemId,
      path: `${proposalPath}.operation`,
    }));
    if (isRecord(proposal.operation) && (proposal.operation.kind === 'promote_pure_elicitation' || proposal.operation.kind === 'reconcile_production_cues')) {
      errors.push(`${proposalPath}.operation: promotion is reserved for the promotion stage`);
    }
    errors.push(...validateOwnerOnlyCueDrafts(proposal.operation, `${proposalPath}.operation`));
    if (inputItem !== undefined) {
      errors.push(...validateReflectionOperationEvidenceContext(
        proposal.operation,
        inputItem,
        `${proposalPath}.operation`,
      ));
    }
  });
  return errors;
}

function validateClarifyingQuestions(value: unknown, path: string): string[] {
  if (!Array.isArray(value)) return [`${path}: expected array`];
  const errors: string[] = [];
  value.forEach((question, questionIndex) => {
    const questionPath = `${path}[${questionIndex}]`;
    errors.push(...validateObjectFields(question, ['question', 'reason'], questionPath));
    if (!isRecord(question)) return;
    errors.push(...validateString(question.question, `${questionPath}.question`, true));
    errors.push(...validateString(question.reason, `${questionPath}.reason`, true));
  });
  return errors;
}

export function validatePureCuePromotionResultV1(
  value: unknown,
  bundle: PureCuePromotionBundleV1,
): string[] {
  const errors = validateObjectFields(value, ['schemaVersion', 'itemResults'], '$');
  if (!isRecord(value)) return errors;
  if (value.schemaVersion !== 'pure_cue_promotion_result.v1') {
    errors.push('$.schemaVersion: expected pure_cue_promotion_result.v1');
  }
  if (!Array.isArray(value.itemResults)) {
    errors.push('$.itemResults: expected array');
    return errors;
  }

  const expectedItems = new Map(bundle.items.map((item) => [item.itemId, item]));
  const seen = new Set<string>();
  value.itemResults.forEach((itemResult, itemIndex) => {
    const path = `$.itemResults[${itemIndex}]`;
    errors.push(...validateObjectFields(itemResult, ['itemId', 'decision'], path));
    if (!isRecord(itemResult)) return;
    errors.push(...validateString(itemResult.itemId, `${path}.itemId`, true));
    const itemId = typeof itemResult.itemId === 'string' ? itemResult.itemId : '';
    if (seen.has(itemId)) errors.push(`${path}.itemId: duplicate item id`);
    seen.add(itemId);
    const evidence = expectedItems.get(itemId);
    const decisionPath = `${path}.decision`;
    const decision = itemResult.decision;
    if (!isRecord(decision)) {
      errors.push(`${decisionPath}: expected object`);
      return;
    }
    if (decision.kind === 'disagreement') {
      errors.push(...validateObjectFields(decision, ['kind', 'learnerExplanation'], decisionPath));
      errors.push(...validateString(
        decision.learnerExplanation,
        `${decisionPath}.learnerExplanation`,
        true,
      ));
      return;
    }
    if (decision.kind !== 'promote') {
      errors.push(`${decisionPath}.kind: expected promote or disagreement`);
      return;
    }
    errors.push(...validateObjectFields(
      decision,
      ['kind', 'rationale', 'learnerExplanation', 'operation'],
      decisionPath,
    ));
    errors.push(...validateString(decision.rationale, `${decisionPath}.rationale`, true));
    errors.push(...validateString(
      decision.learnerExplanation,
      `${decisionPath}.learnerExplanation`,
      true,
    ));
    if (evidence === undefined) return;
    const operation = decision.operation;
    if (!isRecord(operation)) {
      errors.push(`${decisionPath}.operation: expected object`);
      return;
    }
    const stamped: PromotePureElicitationOperationV1 = {
      ...(operation as PromotePureElicitationOperationV1Wire),
      kind: 'promote_pure_elicitation',
      version: 1,
      sourceAttemptId: evidence.sourceAttemptId,
      targetWordId: evidence.targetWord.wordId,
      responseWordId: evidence.responseWord.wordId,
    };
    errors.push(...validateReflectionOperation(stamped, {
      allowedWordIds: new Set([evidence.targetWord.wordId, evidence.responseWord.wordId]),
      evidenceItemId: evidence.itemId,
      path: `${decisionPath}.operation`,
    }));
    const enrichedItem: ReflectionItemV5 = {
      ...evidence,
      source: 'production_mistake',
      sourceActionKind: 'production',
      sessionActionId: null,
      occurredAt: null,
      sessionNote: null,
      existingContent: { contrastClusters: [], knownAcceptedAlternates: [] },
      rawResponse: null,
      submittedWord: evidence.responseWord,
      responseKind: 'matched_known_word',
    };
    errors.push(...validatePureCuePromotionEvidenceContext(
      stamped,
      enrichedItem,
      `${decisionPath}.operation`,
    ));
  });
  if (seen.size !== expectedItems.size || [...expectedItems.keys()].some((itemId) => !seen.has(itemId))) {
    errors.push('$.itemResults: every promotion input item must appear exactly once and no unknown item is allowed');
  }
  return errors;
}

function validateSessionReflectionResultVersion(
  value: unknown,
  bundle: SessionReflectionBundle | CuratedReflectionDiagnosisBundleV2,
  schemaVersion: SessionReflectionResult['schemaVersion'],
): string[] {
  const isV9 = schemaVersion === 'session_reflection_result.v9';
  const isStaged = isV9 || schemaVersion === 'session_reflection_result.v8';
  const promotionKind = isV9 ? 'reconcile_production_cues' : 'promote_pure_elicitation';
  const changedOutcome = isV9 ? 'reconciled' : 'promoted';
  const unchangedOutcome = isV9 ? 'explanation_only' : 'disagreement';
  const errors = validateObjectFields(
    value,
    ['schemaVersion', 'itemResults'],
    '$',
  );
  if (!isRecord(value)) return errors;
  if (value.schemaVersion !== schemaVersion) {
    errors.push(`$.schemaVersion: expected ${schemaVersion}`);
  }
  if (!Array.isArray(value.itemResults)) {
    errors.push('$.itemResults: expected array');
    return errors;
  }

  const inputItemIds = bundle.items.map((item) => item.itemId);
  const resultItemIds = value.itemResults.flatMap((item) => (
    isRecord(item) && typeof item.itemId === 'string' ? [item.itemId] : []
  ));
  if (new Set(resultItemIds).size !== resultItemIds.length) {
    errors.push('$.itemResults: duplicate itemId');
  }
  if (
    inputItemIds.length !== resultItemIds.length
    || !inputItemIds.every((itemId) => resultItemIds.includes(itemId))
  ) {
    errors.push('$.itemResults: every input item must appear exactly once and no unknown item is allowed');
  }

  const inputItemsById = new Map(bundle.items.map((item) => [item.itemId, item]));
  const usesStreamlinedItemResult = schemaVersion === 'session_reflection_result.v6'
    || schemaVersion === 'session_reflection_result.v7'
    || isStaged;
  for (const [itemIndex, itemResult] of value.itemResults.entries()) {
    const itemPath = `$.itemResults[${itemIndex}]`;
    const requiredItemFields = usesStreamlinedItemResult
      ? ['itemId', 'diagnosisTags', 'learnerExplanation', 'proposals', 'questions']
      : [
          'itemId',
          'diagnosisTags',
          'observation',
          'learnerExplanation',
          'proposals',
          'questions',
          'unhandledNeeds',
        ];
    errors.push(...(
      isStaged
        ? validateObjectFieldsWithOptional(
            itemResult,
            requiredItemFields,
            ['promotionOutcome'],
            itemPath,
          )
        : validateObjectFields(itemResult, requiredItemFields, itemPath)
    ));
    if (!isRecord(itemResult)) continue;
    errors.push(...validateString(itemResult.itemId, `${itemPath}.itemId`, true));
    if (usesStreamlinedItemResult) {
      errors.push(...validateString(
        itemResult.learnerExplanation,
        `${itemPath}.learnerExplanation`,
        true,
      ));
    } else {
      errors.push(...validateString(itemResult.observation, `${itemPath}.observation`, true));
      errors.push(...validateNullableString(
        itemResult.learnerExplanation,
        `${itemPath}.learnerExplanation`,
      ));
    }

    if (!Array.isArray(itemResult.diagnosisTags)) {
      errors.push(`${itemPath}.diagnosisTags: expected array`);
    } else {
      const tags = itemResult.diagnosisTags.filter(
        (tag): tag is ReflectionDiagnosisTagV1 => typeof tag === 'string' && diagnosisTags.has(tag as ReflectionDiagnosisTagV1),
      );
      if (tags.length !== itemResult.diagnosisTags.length) {
        errors.push(`${itemPath}.diagnosisTags: value is not in the allowed enum`);
      }
      if (new Set(tags).size !== tags.length) {
        errors.push(`${itemPath}.diagnosisTags: duplicate tag`);
      }
    }

    const itemId = typeof itemResult.itemId === 'string' ? itemResult.itemId : null;
    const inputItem = itemId === null ? undefined : inputItemsById.get(itemId);
    const savedPromotionEvidence = inputItem !== undefined
      && 'promotionEvidence' in inputItem
      && isRecord(inputItem.promotionEvidence)
      ? inputItem.promotionEvidence
      : null;
    if (isStaged) {
      const hasPromotionOutcome = Object.hasOwn(itemResult, 'promotionOutcome');
      if (savedPromotionEvidence !== null && !hasPromotionOutcome) {
        errors.push(`${itemPath}.promotionOutcome: routed promotion evidence requires an outcome`);
      }
      if (savedPromotionEvidence === null && hasPromotionOutcome) {
        errors.push(`${itemPath}.promotionOutcome: outcome requires routed promotion evidence`);
      }
    }
    if (
      isStaged
      && Object.hasOwn(itemResult, 'promotionOutcome')
      && itemResult.promotionOutcome !== changedOutcome
      && itemResult.promotionOutcome !== unchangedOutcome
    ) {
      errors.push(`${itemPath}.promotionOutcome: expected promoted or disagreement`);
    }
    if (
      isStaged
      && savedPromotionEvidence !== null
      && Array.isArray(savedPromotionEvidence.diagnosisTags)
      && Array.isArray(itemResult.diagnosisTags)
    ) {
      const finalTags = itemResult.diagnosisTags.filter((tag): tag is string => typeof tag === 'string');
      const savedTags = savedPromotionEvidence.diagnosisTags.filter(
        (tag): tag is string => typeof tag === 'string',
      );
      if (
        finalTags.length !== savedTags.length
        || finalTags.some((tag) => !savedTags.includes(tag))
      ) {
        errors.push(`${itemPath}.diagnosisTags: must preserve the saved first-stage diagnosis tags`);
      }
    }
    if (
      inputItem !== undefined
      && 'learnerRequestedReview' in inputItem
      && inputItem.learnerRequestedReview === true
      && itemResult.learnerExplanation === null
    ) {
      errors.push(`${itemPath}.learnerExplanation: learner-requested evidence requires feedback`);
    }
    if (!Array.isArray(itemResult.proposals)) {
      errors.push(`${itemPath}.proposals: expected array`);
    } else {
      for (const [proposalIndex, proposal] of itemResult.proposals.entries()) {
        const proposalPath = `${itemPath}.proposals[${proposalIndex}]`;
        errors.push(...validateObjectFields(
          proposal,
          ['proposalGroupKey', 'rationale', 'operation'],
          proposalPath,
        ));
        if (!isRecord(proposal)) continue;
        errors.push(...validateNullableString(proposal.proposalGroupKey, `${proposalPath}.proposalGroupKey`));
        errors.push(...validateString(proposal.rationale, `${proposalPath}.rationale`, true));
        errors.push(...validateReflectionOperation(proposal.operation, {
          allowedWordIds: inputItem === undefined ? undefined : visibleWordIds(inputItem),
          evidenceItemId: inputItem?.itemId,
          path: `${proposalPath}.operation`,
        }));
        if (isRecord(proposal.operation) && proposal.operation.kind === 'reconcile_production_cues' && !isV9) errors.push(`${proposalPath}.operation: reconciliation is reserved for V9 results`);
        if (
          schemaVersion !== 'session_reflection_result.v8'
          && isRecord(proposal.operation)
          && proposal.operation.kind === 'promote_pure_elicitation'
        ) {
          errors.push(`${proposalPath}.operation: promotion is reserved for V8 results`);
        }
        if (
          schemaVersion !== 'session_reflection_result.v4'
          && inputItem !== undefined
          && 'servedCue' in inputItem
        ) {
          errors.push(...validateReflectionOperationEvidenceContext(
            proposal.operation,
            inputItem,
            `${proposalPath}.operation`,
          ));
        }
      }
      if (isStaged && inputItem !== undefined) {
        errors.push(...(isV9 ? validateV9ProposalSet : validateV8ProposalSet)(
          itemResult.proposals,
          inputItem as ReflectionItemV6,
          `${itemPath}.proposals`,
        ));
      }
    }

    if (!Array.isArray(itemResult.questions)) {
      errors.push(`${itemPath}.questions: expected array`);
    } else {
      for (const [questionIndex, question] of itemResult.questions.entries()) {
        const questionPath = `${itemPath}.questions[${questionIndex}]`;
        errors.push(...validateObjectFields(question, ['question', 'reason'], questionPath));
        if (!isRecord(question)) continue;
        errors.push(...validateString(question.question, `${questionPath}.question`, true));
        errors.push(...validateString(question.reason, `${questionPath}.reason`, true));
      }
    }

    if (
      isStaged
      && itemResult.promotionOutcome === unchangedOutcome
    ) {
      if (Array.isArray(itemResult.proposals) && itemResult.proposals.length > 0) {
        errors.push(`${itemPath}.proposals: disagreement must not expose proposals`);
      }
      if (Array.isArray(itemResult.questions) && itemResult.questions.length > 0) {
        errors.push(`${itemPath}.questions: disagreement must not expose questions`);
      }
      if (
        savedPromotionEvidence === null
        || !isSharedAxisDiagnosisEligible(inputItem)
      ) {
        errors.push(`${itemPath}.promotionOutcome: disagreement requires valid routed promotion evidence`);
      }
    }
    if (
      isStaged
      && itemResult.promotionOutcome === changedOutcome
    ) {
      const promotionProposalCount = Array.isArray(itemResult.proposals)
        ? itemResult.proposals.filter((proposal) => (
            isRecord(proposal)
            && isRecord(proposal.operation)
            && proposal.operation.kind === promotionKind
          )).length
        : 0;
      if (
        !Array.isArray(itemResult.proposals)
        || itemResult.proposals.length !== 1
        || promotionProposalCount !== 1
      ) {
        errors.push(`${itemPath}.proposals: promoted must expose exactly one pure-elicitation promotion and no ordinary proposals`);
      }
      if (Array.isArray(itemResult.questions) && itemResult.questions.length > 0) {
        errors.push(`${itemPath}.questions: promoted must not expose questions`);
      }
      if (
        savedPromotionEvidence === null
        || !isSharedAxisDiagnosisEligible(inputItem)
      ) {
        errors.push(`${itemPath}.promotionOutcome: promoted requires valid routed promotion evidence`);
      }
    }

    const unhandledNeeds = itemResult.unhandledNeeds;
    if (!usesStreamlinedItemResult && !Array.isArray(unhandledNeeds)) {
      errors.push(`${itemPath}.unhandledNeeds: expected array`);
    } else if (!usesStreamlinedItemResult && Array.isArray(unhandledNeeds)) {
      for (const [needIndex, need] of unhandledNeeds.entries()) {
        const needPath = `${itemPath}.unhandledNeeds[${needIndex}]`;
        errors.push(...validateObjectFields(
          need,
          ['description', 'whyRegisteredOperationsDoNotFit'],
          needPath,
        ));
        if (!isRecord(need)) continue;
        errors.push(...validateString(need.description, `${needPath}.description`, true));
        errors.push(...validateString(
          need.whyRegisteredOperationsDoNotFit,
          `${needPath}.whyRegisteredOperationsDoNotFit`,
          true,
        ));
      }
    }
  }
  if (isStaged) {
    errors.push(...validateV8BundleWideProposalConflicts(value.itemResults));
  }
  return errors;
}

function validateV8BundleWideProposalConflicts(itemResults: unknown[]): string[] {
  const errors: string[] = [];
  const operations = itemResults.flatMap((itemResult, itemIndex) => {
    if (!isRecord(itemResult) || !Array.isArray(itemResult.proposals)) return [];
    return itemResult.proposals.flatMap((proposal, proposalIndex) => (
      isRecord(proposal) && isRecord(proposal.operation)
        ? [{ operation: proposal.operation, path: `$.itemResults[${itemIndex}].proposals[${proposalIndex}].operation` }]
        : []
    ));
  });
  const promotions = operations.filter(({ operation }) => (
    (operation.kind === 'promote_pure_elicitation' || operation.kind === 'reconcile_production_cues')
  ));
  const promotionPathByWordId = new Map<string, string>();
  for (const promotion of promotions) {
    for (const wordId of [promotion.operation.targetWordId, promotion.operation.responseWordId]) {
      if (typeof wordId !== 'string') continue;
      if (!promotionPathByWordId.has(wordId)) promotionPathByWordId.set(wordId, promotion.path);
    }
  }
  for (const candidate of operations) {
    const operation = candidate.operation;
    if (
      operation.kind !== 'suppress_definition_production'
      && operation.kind !== 'repair_production_cue'
      && operation.kind !== 'add_production_cue_supplement'
    ) continue;
    if (typeof operation.wordId !== 'string') continue;
    const promotionPath = promotionPathByWordId.get(operation.wordId);
    if (promotionPath !== undefined) {
      errors.push(
        `${candidate.path}: conflicts with ${promotionPath} for affected word ${operation.wordId}`,
      );
    }
  }
  return errors;
}

function validateOwnerOnlyCueDrafts(value: unknown, path: string): string[] {
  if (!isRecord(value) || value.kind !== 'repair_production_cue' || value.version !== 2
    || !Array.isArray(value.changes)) return [];
  const errors: string[] = [];
  value.changes.forEach((change, changeIndex) => {
    if (!isRecord(change)) return;
    const drafts = change.kind === 'create' ? [change.cue]
      : change.kind === 'replace' && Array.isArray(change.replacements) ? change.replacements : [];
    drafts.forEach((draft, draftIndex) => {
      if (isRecord(draft) && (!Array.isArray(draft.acceptedWordIds)
        || draft.acceptedWordIds.length !== 1 || draft.acceptedWordIds[0] !== value.wordId)) {
        errors.push(`${path}.changes[${changeIndex}].drafts[${draftIndex}]: V8 word-owned cues must accept exactly their owner`);
      }
    });
  });
  return errors;
}

function validateV8ProposalSet(
  proposals: unknown[],
  item: ReflectionItemV5,
  path: string,
): string[] {
  const errors: string[] = [];
  const promotionOperations = proposals.flatMap((proposal) => (
    isRecord(proposal)
    && isRecord(proposal.operation)
    && proposal.operation.kind === 'promote_pure_elicitation'
      ? [proposal.operation]
      : []
  ));
  if (promotionOperations.length > 1) {
    errors.push(`${path}: at most one pure-elicitation promotion is allowed`);
  }

  for (const [proposalIndex, proposal] of proposals.entries()) {
    if (!isRecord(proposal) || !isRecord(proposal.operation)) continue;
    errors.push(...validateOwnerOnlyCueDrafts(proposal.operation, `${path}[${proposalIndex}].operation`));
  }

  const promotion = promotionOperations[0];
  if (promotion === undefined) return errors;
  const promotionPath = `${path}[${proposals.findIndex((proposal) => (
    isRecord(proposal) && proposal.operation === promotion
  ))}].operation`;
  errors.push(...validatePureCuePromotionEvidenceContext(promotion, item, promotionPath));

  const affectedWordIds = new Set([
    promotion.targetWordId,
    promotion.responseWordId,
  ].filter((wordId): wordId is string => typeof wordId === 'string'));
  proposals.forEach((proposal, proposalIndex) => {
    if (!isRecord(proposal) || !isRecord(proposal.operation)) return;
    const operation = proposal.operation;
    if (operation === promotion) return;
    const conflicts = (
      operation.kind === 'suppress_definition_production'
      || operation.kind === 'repair_production_cue'
      || operation.kind === 'add_production_cue_supplement'
    ) && typeof operation.wordId === 'string' && affectedWordIds.has(operation.wordId);
    if (conflicts) {
      errors.push(
        `${path}[${proposalIndex}].operation: conflicts with promotion policy for an affected word`,
      );
    }
  });
  return errors;
}

export function validatePureCuePromotionEvidenceContext(
  value: unknown,
  item: ReflectionItemV5,
  path = '$',
): string[] {
  if (!isRecord(value) || value.kind !== 'promote_pure_elicitation') return [];
  const errors: string[] = [];
  const responseWordId = item.submittedWord?.wordId ?? null;
  if (item.servedCue.acceptedWordIds.length !== 1
    || item.servedCue.acceptedWordIds[0] !== item.targetWord.wordId
    || responseWordId === item.targetWord.wordId) {
    errors.push(`${path}: promotion requires strict target-only evidence and a distinct response word`);
  }
  if (item.promotionEvidence === null) {
    return [`${path}: promotion requires enriched promotion evidence`];
  }
  if (responseWordId === null) {
    errors.push(`${path}.responseWordId: promotion requires a resolved response word`);
  }
  if (value.sourceAttemptId !== item.sourceAttemptId) {
    errors.push(`${path}.sourceAttemptId: must match the evidence source attempt`);
  }
  if (value.targetWordId !== item.targetWord.wordId) {
    errors.push(`${path}.targetWordId: must match the evidence target word`);
  }
  if (value.responseWordId !== responseWordId) {
    errors.push(`${path}.responseWordId: must match the resolved response word`);
  }

  const evidenceWords = new Map(
    item.promotionEvidence.words.map((word) => [word.wordId, word]),
  );
  const expectedWordIds = new Set([item.targetWord.wordId, responseWordId].filter(
    (wordId): wordId is string => wordId !== null,
  ));
  if (
    evidenceWords.size !== expectedWordIds.size
    || [...expectedWordIds].some((wordId) => !evidenceWords.has(wordId))
  ) {
    errors.push(`${path}: promotion evidence must contain exactly the target-response pair`);
  }

  if (isRecord(value.destination) && value.destination.kind === 'existing') {
    const allowedPureCueIds = new Set(
      item.promotionEvidence.intersectingPureCues.map((cue) => cue.id),
    );
    if (
      typeof value.destination.pureCueId === 'string'
      && !allowedPureCueIds.has(value.destination.pureCueId)
    ) {
      errors.push(`${path}.destination.pureCueId: must reference an enriched intersecting pure cue`);
    }
  }

  if (Array.isArray(value.wordPlans)) {
    value.wordPlans.forEach((plan, planIndex) => {
      if (!isRecord(plan) || typeof plan.wordId !== 'string') return;
      const evidenceWord = evidenceWords.get(plan.wordId);
      if (evidenceWord === undefined || !Array.isArray(plan.deactivateCueIds)) return;
      const allowedCueIds = new Set(evidenceWord.activeProductionCues.map((cue) => cue.cueId));
      plan.deactivateCueIds.forEach((cueId, cueIndex) => {
        if (typeof cueId === 'string' && !allowedCueIds.has(cueId)) {
          errors.push(
            `${path}.wordPlans[${planIndex}].deactivateCueIds[${cueIndex}]`
            + ': must reference an enriched active cue for that word',
          );
        }
      });
    });
  }
  return errors;
}

export function validateReflectionOperationEvidenceContext(
  value: unknown,
  item: ProductionMistakeReflectionItemV2 | ReflectionItemV3 | ReflectionItemV4 | ReflectionItemV5,
  path: string,
): string[] {
  if (!isRecord(value)) return [];
  const errors: string[] = [];
  if ('promotionEvidence' in item) {
    errors.push(...validateOwnerOnlyCueDrafts(value, path));
  }
  if (value.kind === 'reconcile_production_cues') {
    if (!('promotionEvidence' in item) || item.promotionEvidence === null
      || item.promotionEvidence.intersectingPureCues.some((cue) => !('teachingNote' in cue) || !('acceptedMembers' in cue))) {
      return [`${path}: reconciliation requires current enriched evidence`];
    }
    return validateReconcileProductionCuesEvidenceContext(value, item as ReflectionItemV6, path);
  }
  if (value.kind === 'promote_pure_elicitation') {
    return 'promotionEvidence' in item
      ? validatePureCuePromotionEvidenceContext(value, item, path)
      : [`${path}: promotion requires V5 enriched evidence`];
  }
  if (item.responseKind === 'no_clue') {
    if (value.kind === 'create_contrast_cluster') {
      errors.push(`${path}: no-clue evidence cannot ground contrast content`);
    }
    if (value.kind === 'accept_production_alternate') {
      errors.push(`${path}: no-clue evidence cannot ground an alternate-answer claim`);
    }
  }
  if (value.kind === 'add_production_cue_supplement' && value.version === 1) {
    if (value.wordId !== item.targetWord.wordId) {
      errors.push(`${path}.wordId: must match the evidence target word`);
    }
    if (value.taskId !== `production-task:${item.targetWord.wordId}:default_production`) {
      errors.push(`${path}.taskId: must match the target word's default production task`);
    }
    if (value.cueId !== item.servedCue.cueId) {
      errors.push(`${path}.cueId: must match the exact served cue`);
    }
    if (item.servedCue.cueType !== 'definition_gloss') {
      errors.push(`${path}: supplements require definition-gloss evidence`);
    }
    if (!('supplement' in item.servedCue)) {
      errors.push(`${path}: supplement proposals require a V4 evidence snapshot`);
    } else if (item.servedCue.supplement !== null) {
      errors.push(`${path}: the served definition exercise already has a supplement`);
    }
    if (
      typeof value.exampleSentence === 'string'
      && !value.exampleSentence.includes(item.targetWord.hanzi)
    ) {
      errors.push(`${path}.exampleSentence: must contain the target expression`);
    }
    return errors;
  }
  if (value.kind !== 'repair_production_cue' || value.version !== 2) return errors;
  if (value.wordId !== item.targetWord.wordId) {
    errors.push(`${path}.wordId: must match the evidence target word`);
  }
  if (value.taskId !== `production-task:${item.targetWord.wordId}:default_production`) {
    errors.push(`${path}.taskId: must match the target word's default production task`);
  }
  const servedCueId = item.servedCue.cueId;
  if (Array.isArray(value.changes)) {
    for (const [index, change] of value.changes.entries()) {
      if (isRecord(change) && change.kind === 'create' && servedCueId !== null) {
        errors.push(`${path}.changes[${index}]: create is allowed only for fallback evidence`);
      }
      if (
        isRecord(change)
        && change.kind !== 'create'
        && typeof change.cueId === 'string'
        && change.cueId !== servedCueId
      ) {
        errors.push(`${path}.changes[${index}].cueId: must match the exact served cue`);
      }
    }
  }
  const servedCue = item.servedCue;
  if (Array.isArray(value.sourceAttemptJudgments)) {
    for (const [index, judgment] of value.sourceAttemptJudgments.entries()) {
      if (!isRecord(judgment)) continue;
      const judgmentPath = `${path}.sourceAttemptJudgments[${index}]`;
      if (item.responseKind === 'no_clue' && judgment.kind === 'accepted_answer_space_omission') {
        errors.push(`${judgmentPath}: no-clue evidence cannot ground an alternate-answer claim`);
      }
      if (
        judgment.kind === 'accepted_answer_space_omission'
        && judgment.submittedWordId !== item.submittedWord?.wordId
      ) {
        errors.push(`${judgmentPath}.submittedWordId: must match the resolved submitted word`);
      }
      if (
        (judgment.kind === 'accepted_answer_space_omission'
          || judgment.kind === 'misleading_or_overloaded_cue')
        && !hasExactServedCueRepair(value.changes, servedCue.cueId, judgment.submittedWordId)
      ) {
        errors.push(`${judgmentPath}: must repair the exact served cue contract`);
      }
    }
  }
  return errors;
}

function hasExactServedCueRepair(
  changes: unknown,
  servedCueId: string | null,
  submittedWordId: unknown,
): boolean {
  if (!Array.isArray(changes)) return false;
  if (submittedWordId === undefined) {
    return changes.some((change) => (
      isRecord(change)
      && (
        (servedCueId === null && change.kind === 'create' && isRecord(change.cue))
        || (
          servedCueId !== null
          && change.cueId === servedCueId
          && (
            (change.kind === 'replace' && Array.isArray(change.replacements))
            || change.kind === 'deactivate'
          )
        )
      )
    ));
  }
  const drafts = changes.flatMap((change) => {
    if (!isRecord(change)) return [];
    if (servedCueId === null && change.kind === 'create' && isRecord(change.cue)) {
      return [change.cue];
    }
    if (
      servedCueId !== null
      && change.kind === 'replace'
      && change.cueId === servedCueId
      && Array.isArray(change.replacements)
    ) {
      return change.replacements.filter(isRecord);
    }
    return [];
  });
  return drafts.some((draft) => (
    Array.isArray(draft.acceptedWordIds)
    && draft.acceptedWordIds.includes(submittedWordId)
  ));
}

export function normalizeSessionReflectionResultV5(
  value: SessionReflectionResultV5Wire,
  bundle: SessionReflectionBundleV2 | SessionReflectionBundleV3,
): SessionReflectionResultV5 {
  return {
    schemaVersion: 'session_reflection_result.v5',
    itemResults: value.itemResults.map((itemResult) => {
      const sourceAttemptId = bundle.items.find(
        (item) => item.itemId === itemResult.itemId,
      )?.sourceAttemptId ?? '';
      return {
        ...itemResult,
        proposals: itemResult.proposals.map((proposal) => ({
          ...proposal,
          operation: proposal.operation.kind === 'repair_production_cue'
            ? {
                ...proposal.operation,
                version: 2,
                taskId: `production-task:${proposal.operation.wordId}:default_production`,
                sourceAttemptJudgments: proposal.operation.sourceAttemptJudgments.map((judgment) => ({
                  ...judgment,
                  sourceAttemptId,
                })),
              }
            : proposal.operation,
        })),
      };
    }),
  };
}

export function normalizeSessionReflectionResultV6(
  value: SessionReflectionResultV6Wire,
  bundle: SessionReflectionBundleV2 | SessionReflectionBundleV3,
): SessionReflectionResultV6 {
  return {
    schemaVersion: 'session_reflection_result.v6',
    itemResults: value.itemResults.map((itemResult) => {
      const sourceAttemptId = bundle.items.find(
        (item) => item.itemId === itemResult.itemId,
      )?.sourceAttemptId ?? '';
      return {
        ...itemResult,
        proposals: itemResult.proposals.map((proposal) => ({
          ...proposal,
          operation: proposal.operation.kind === 'repair_production_cue'
            ? {
                ...proposal.operation,
                version: 2,
                taskId: `production-task:${proposal.operation.wordId}:default_production`,
                sourceAttemptJudgments: proposal.operation.sourceAttemptJudgments.map((judgment) => ({
                  ...judgment,
                  sourceAttemptId,
                })),
              }
            : proposal.operation,
        })),
      };
    }),
  };
}

export function normalizeSessionReflectionResultV7(
  value: SessionReflectionResultV7Wire,
  bundle: ReflectionDiagnosisBundle,
): SessionReflectionResultV7 {
  return {
    schemaVersion: 'session_reflection_result.v7',
    itemResults: value.itemResults.map((itemResult) => {
      const item = bundle.items.find((candidate) => candidate.itemId === itemResult.itemId);
      const sourceAttemptId = item?.sourceAttemptId ?? '';
      const omitSourceAttemptJudgments = sourceAttemptId.startsWith(
        SYNTHETIC_REFLECTION_ATTEMPT_ID_PREFIX,
      );
      return {
        ...itemResult,
        proposals: itemResult.proposals.map((proposal) => normalizeReflectionProposalV7Wire(
          proposal,
          sourceAttemptId,
          item?.servedCue.cueId ?? null,
          omitSourceAttemptJudgments,
        )),
      };
    }),
  };
}

export function normalizeStagedReflectionDiagnosisResultV1(
  value: StagedReflectionDiagnosisResultV1Wire,
  bundle: SessionReflectionBundleV4 | CuratedReflectionDiagnosisBundleV2,
): StagedReflectionDiagnosisResultV1 {
  return {
    schemaVersion: 'staged_reflection_diagnosis_result.v1',
    itemResults: value.itemResults.map((itemResult) => {
      if (itemResult.kind === 'shared_axis') return itemResult;
      const item = bundle.items.find((candidate) => candidate.itemId === itemResult.itemId);
      if (!item) throw new Error(`Unknown staged reflection item: ${itemResult.itemId}`);
      const sourceAttemptId = item.sourceAttemptId;
      const wordId = item.targetWord.wordId;
      return {
        ...itemResult,
        proposals: itemResult.proposals.map((proposal) => {
          const operation = proposal.operation;
          if (operation.kind === 'repair_production_cue') {
            const replacementCues = operation.replacementCues.map((cue) => ({
              ...cue,
              acceptedWordIds: [wordId],
            }));
            const servedCueId = item?.servedCue.cueId ?? null;
            return {
              ...proposal,
              operation: {
                kind: 'repair_production_cue' as const,
                version: 2 as const,
                wordId,
                taskId: `production-task:${wordId}:default_production`,
                changes: servedCueId === null
                  ? replacementCues.map((cue) => ({ kind: 'create' as const, cue }))
                  : [{
                      kind: 'replace' as const,
                      cueId: servedCueId,
                      replacements: replacementCues,
                    }],
                sourceAttemptJudgments: sourceAttemptId.startsWith(
                  SYNTHETIC_REFLECTION_ATTEMPT_ID_PREFIX,
                )
                  ? []
                  : operation.sourceAttemptJudgments.map((judgment) => ({
                      ...judgment,
                      sourceAttemptId,
                    })),
              },
            };
          }
          if (operation.kind === 'add_production_cue_supplement') {
            return {
              ...proposal,
              operation: {
                ...operation,
                version: 1 as const,
                wordId,
                taskId: `production-task:${wordId}:default_production`,
                cueId: item?.servedCue.cueId ?? null,
              },
            };
          }
          if (operation.kind === 'suppress_definition_production') {
            return { ...proposal, operation: { ...operation, wordId } };
          }
          return { ...proposal, operation };
        }),
      };
    }),
  };
}

export function normalizeStagedReflectionDiagnosisResultV2(
  value: StagedReflectionDiagnosisResultV2Wire,
  bundle: SessionReflectionBundleV4 | CuratedReflectionDiagnosisBundleV2,
): StagedReflectionDiagnosisResultV2 {
  return {
    schemaVersion: 'staged_reflection_diagnosis_result.v2',
    itemResults: value.itemResults.map((itemResult) => {
      if (itemResult.kind === 'ambiguous_pair') return itemResult;
      const item = bundle.items.find((candidate) => candidate.itemId === itemResult.itemId);
      if (!item) throw new Error(`Unknown staged reflection item: ${itemResult.itemId}`);
      const sourceAttemptId = item.sourceAttemptId;
      const wordId = item.targetWord.wordId;
      return {
        ...itemResult,
        proposals: itemResult.proposals.map((proposal) => {
          const operation = proposal.operation;
          if (operation.kind === 'repair_production_cue') {
            const replacementCues = operation.replacementCues.map((cue) => ({
              ...cue,
              acceptedWordIds: [wordId],
            }));
            const servedCueId = item?.servedCue.cueId ?? null;
            return {
              ...proposal,
              operation: {
                kind: 'repair_production_cue' as const,
                version: 2 as const,
                wordId,
                taskId: `production-task:${wordId}:default_production`,
                changes: servedCueId === null
                  ? replacementCues.map((cue) => ({ kind: 'create' as const, cue }))
                  : [{
                      kind: 'replace' as const,
                      cueId: servedCueId,
                      replacements: replacementCues,
                    }],
                sourceAttemptJudgments: sourceAttemptId.startsWith(
                  SYNTHETIC_REFLECTION_ATTEMPT_ID_PREFIX,
                )
                  ? []
                  : operation.sourceAttemptJudgments.map((judgment) => ({
                      ...judgment,
                      sourceAttemptId,
                    })),
              },
            };
          }
          if (operation.kind === 'add_production_cue_supplement') {
            return {
              ...proposal,
              operation: {
                ...operation,
                version: 1 as const,
                wordId,
                taskId: `production-task:${wordId}:default_production`,
                cueId: item?.servedCue.cueId ?? null,
              },
            };
          }
          if (operation.kind === 'suppress_definition_production') {
            return { ...proposal, operation: { ...operation, wordId } };
          }
          return { ...proposal, operation };
        }),
      };
    }),
  };
}

function normalizeReflectionProposalV7Wire(
  proposal: ReflectionProposalV7Wire,
  sourceAttemptId: string,
  servedCueId: string | null,
  omitSourceAttemptJudgments: boolean,
): ReflectionProposalV1 {
  return {
    ...proposal,
    operation: proposal.operation.kind === 'repair_production_cue'
      ? {
          ...proposal.operation,
          version: 2,
          taskId: `production-task:${proposal.operation.wordId}:default_production`,
          sourceAttemptJudgments: omitSourceAttemptJudgments
            ? []
            : proposal.operation.sourceAttemptJudgments.map((judgment) => ({
                ...judgment,
                sourceAttemptId,
              })),
        }
      : proposal.operation.kind === 'add_production_cue_supplement'
        ? {
            ...proposal.operation,
            version: 1,
            taskId: `production-task:${proposal.operation.wordId}:default_production`,
            cueId: servedCueId,
          }
        : proposal.operation,
  };
}

/**
 * Legacy V5 output may contain model-authored attempt ids. They are neither
 * part of the current wire contract nor trusted provenance, so strip them
 * before strict schema validation and canonicalization.
 */
export function stripLegacySourceAttemptIdsFromV5Wire(value: unknown): unknown {
  return stripLegacySourceAttemptIdsFromReflectionWire(value);
}

export function stripLegacySourceAttemptIdsFromReflectionWire(value: unknown): unknown {
  if (!isRecord(value) || !Array.isArray(value.itemResults)) return value;
  return {
    ...value,
    itemResults: value.itemResults.map((itemResult) => {
      if (!isRecord(itemResult) || !Array.isArray(itemResult.proposals)) return itemResult;
      return {
        ...itemResult,
        proposals: itemResult.proposals.map((proposal) => {
          if (!isRecord(proposal) || !isRecord(proposal.operation)
            || proposal.operation.kind !== 'repair_production_cue'
            || !Array.isArray(proposal.operation.sourceAttemptJudgments)) return proposal;
          return {
            ...proposal,
            operation: {
              ...proposal.operation,
              sourceAttemptJudgments: proposal.operation.sourceAttemptJudgments.map((judgment) => {
                if (!isRecord(judgment)) return judgment;
                const { sourceAttemptId: _legacySourceAttemptId, ...wireJudgment } = judgment;
                return wireJudgment;
              }),
            },
          };
        }),
      };
    }),
  };
}

function structurallyEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left)
      && Array.isArray(right)
      && left.length === right.length
      && left.every((value, index) => structurallyEqual(value, right[index]));
  }
  if (!isRecord(left) || !isRecord(right)) return false;
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key, index) => (
      key === rightKeys[index] && structurallyEqual(left[key], right[key])
    ));
}

export function classifyProposalAcceptance(
  proposed: ReflectionOperation,
  authorized: ReflectionOperation,
): 'exact' | 'revised' {
  if (proposed.kind !== authorized.kind || proposed.version !== authorized.version) {
    throw new Error('A revised proposal acceptance must preserve operation kind and version.');
  }
  return structurallyEqual(proposed, authorized) ? 'exact' : 'revised';
}

export type ProposalReviewDispositionKind = ProposalReviewDisposition['kind'];
export type OperationApplicationStateKind = OperationApplicationState['kind'];

const proposalReviewTransitions: Record<
  ProposalReviewDispositionKind,
  ReadonlySet<ProposalReviewDispositionKind>
> = {
  pending: new Set(['deferred', 'accepted', 'dismissed', 'superseded']),
  deferred: new Set(['accepted', 'dismissed', 'superseded', 'requested_second_opinion']),
  dismissed: new Set(['pending']),
  accepted: new Set(),
  requested_second_opinion: new Set(),
  superseded: new Set(),
};

const operationApplicationTransitions: Record<
  OperationApplicationStateKind,
  ReadonlySet<OperationApplicationStateKind>
> = {
  unsupported: new Set(['pending', 'authorization_withdrawn']),
  pending: new Set([
    'applied',
    'failed',
    'stale',
    'already_satisfied',
    'authorization_withdrawn',
  ]),
  applied: new Set(),
  failed: new Set(),
  stale: new Set(),
  already_satisfied: new Set(),
  authorization_withdrawn: new Set(),
};

export function isProposalReviewTransitionAllowed(
  from: ProposalReviewDispositionKind,
  to: ProposalReviewDispositionKind,
): boolean {
  return proposalReviewTransitions[from].has(to);
}

export function assertProposalReviewTransition(
  from: ProposalReviewDispositionKind,
  to: ProposalReviewDispositionKind,
): void {
  if (!isProposalReviewTransitionAllowed(from, to)) {
    throw new Error(`Invalid proposal review transition: ${from} -> ${to}.`);
  }
}

export function isOperationApplicationTransitionAllowed(
  from: OperationApplicationStateKind,
  to: OperationApplicationStateKind,
): boolean {
  return operationApplicationTransitions[from].has(to);
}

export function assertOperationApplicationTransition(
  from: OperationApplicationStateKind,
  to: OperationApplicationStateKind,
): void {
  if (!isOperationApplicationTransitionAllowed(from, to)) {
    throw new Error(`Invalid operation application transition: ${from} -> ${to}.`);
  }
}

function validateAmbiguousPairHandoff(value: unknown, path: string): string[] {
  const errors = validateObjectFields(value, ['ambiguityReason'], path);
  if (isRecord(value)) errors.push(...validateString(value.ambiguityReason, `${path}.ambiguityReason`, true));
  return errors;
}

export function validateSessionReflectionResultV9(value: unknown, bundle: SessionReflectionBundleV6 | CuratedReflectionBundleV3): string[] {
  return validateSessionReflectionResultVersion(value, bundle, 'session_reflection_result.v9');
}
function validateV9ProposalSet(proposals: unknown[], item: ReflectionItemV6, path: string): string[] {
  const errors: string[] = [];
  proposals.forEach((proposal, index) => {
    if (!isRecord(proposal) || !isRecord(proposal.operation)) return;
    errors.push(...validateOwnerOnlyCueDrafts(proposal.operation, `${path}[${index}].operation`));
    errors.push(...validateReconcileProductionCuesEvidenceContext(proposal.operation, item, `${path}[${index}].operation`));
  });
  return errors;
}
export function validateReconcileProductionCuesEvidenceContext(value: unknown, item: ReflectionItemV6, path = '$'): string[] {
  if (!isRecord(value) || value.kind !== 'reconcile_production_cues') return [];
  const errors = validatePureCuePromotionEvidenceContext({ ...value, kind: 'promote_pure_elicitation' }, item, path);
  if (isRecord(value.destination) && value.destination.kind === 'existing') {
    const destination = value.destination;
    const saved = item.promotionEvidence?.intersectingPureCues.find((cue) => cue.id === destination.pureCueId);
    if (saved && (!structurallyEqual(destination.expectedAcceptedWordIds, saved.acceptedWordIds) || destination.expectedTeachingNote !== saved.teachingNote)) errors.push(`${path}.destination: expected state must match the supplied pure cue`);
    const changesWords = Array.isArray(value.wordPlans) && value.wordPlans.some((plan) => isRecord(plan)
      && ((Array.isArray(plan.deactivateCueIds) && plan.deactivateCueIds.length > 0)
        || (Array.isArray(plan.distinctiveCueDrafts) && plan.distinctiveCueDrafts.length > 0)));
    if (saved && saved.acceptedWordIds.includes(item.targetWord.wordId)
      && item.submittedWord !== null && saved.acceptedWordIds.includes(item.submittedWord.wordId)
      && destination.teachingNote === saved.teachingNote && !changesWords) {
      errors.push(`${path}: reconciliation must change content; use explanation_only for an unchanged destination`);
    }

  }
  return errors;
}
export function stampReconcileProductionCuesOperation(
  operation: ReconcileProductionCuesOperationV1Wire,
  item: { sourceAttemptId: string; targetWord: ReflectionWordSnapshotV1; responseWord: ReflectionWordSnapshotV1; promotionEvidence: PureCuePromotionEvidenceV2 },
): ReconcileProductionCuesOperationV1 {
  const destination = operation.destination;
  let stampedDestination: ReconcileProductionCuesDestinationV1 | null = null;
  if (destination?.kind === 'existing') {
    const existing = item.promotionEvidence.intersectingPureCues.find((cue) => cue.id === destination.pureCueId);
    if (!existing) throw new Error(`Unknown pure cue destination: ${destination.pureCueId}`);
    stampedDestination = { ...destination, expectedAcceptedWordIds: [...existing.acceptedWordIds], expectedTeachingNote: existing.teachingNote };
  } else stampedDestination = destination;
  return { ...operation, destination: stampedDestination, kind: 'reconcile_production_cues', version: 1, sourceAttemptId: item.sourceAttemptId, targetWordId: item.targetWord.wordId, responseWordId: item.responseWord.wordId };
}

export function validatePureCuePromotionResultV2(
  value: unknown,
  bundle: PureCuePromotionBundleV2,
): string[] {
  const errors = validateObjectFields(value, ['schemaVersion', 'itemResults'], '$');
  if (!isRecord(value)) return errors;
  if (value.schemaVersion !== 'pure_cue_promotion_result.v2') {
    errors.push('$.schemaVersion: expected pure_cue_promotion_result.v2');
  }
  if (!Array.isArray(value.itemResults)) {
    errors.push('$.itemResults: expected array');
    return errors;
  }

  const expectedItems = new Map(bundle.items.map((item) => [item.itemId, item]));
  const seen = new Set<string>();
  value.itemResults.forEach((itemResult, itemIndex) => {
    const path = `$.itemResults[${itemIndex}]`;
    errors.push(...validateObjectFields(itemResult, ['itemId', 'decision'], path));
    if (!isRecord(itemResult)) return;
    errors.push(...validateString(itemResult.itemId, `${path}.itemId`, true));
    const itemId = typeof itemResult.itemId === 'string' ? itemResult.itemId : '';
    if (seen.has(itemId)) errors.push(`${path}.itemId: duplicate item id`);
    seen.add(itemId);
    const evidence = expectedItems.get(itemId);
    const decisionPath = `${path}.decision`;
    const decision = itemResult.decision;
    if (!isRecord(decision)) {
      errors.push(`${decisionPath}: expected object`);
      return;
    }
    if (decision.kind === 'explanation_only') {
      errors.push(...validateObjectFields(decision, ['kind', 'learnerExplanation'], decisionPath));
      errors.push(...validateString(
        decision.learnerExplanation,
        `${decisionPath}.learnerExplanation`,
        true,
      ));
      return;
    }
    if (decision.kind !== 'reconcile') {
      errors.push(`${decisionPath}.kind: expected reconcile or explanation_only`);
      return;
    }
    errors.push(...validateObjectFields(
      decision,
      ['kind', 'rationale', 'learnerExplanation', 'operation'],
      decisionPath,
    ));
    errors.push(...validateString(decision.rationale, `${decisionPath}.rationale`, true));
    errors.push(...validateString(
      decision.learnerExplanation,
      `${decisionPath}.learnerExplanation`,
      true,
    ));
    if (evidence === undefined) return;
    const operation = decision.operation;
    if (!isRecord(operation)) {
      errors.push(`${decisionPath}.operation: expected object`);
      return;
    }
    errors.push(...validateObjectFields(operation, ['destination', 'wordPlans', 'sourceAttemptFairness'], `${decisionPath}.operation`));
    if (isRecord(operation.destination)) errors.push(...validateObjectFields(operation.destination, operation.destination.kind === 'existing' ? ['kind', 'pureCueId', 'teachingNote'] : ['kind', 'stimulus', 'axisNote', 'teachingNote'], `${decisionPath}.operation.destination`));
    let stamped: ReconcileProductionCuesOperationV1;
    try { stamped = stampReconcileProductionCuesOperation(operation as ReconcileProductionCuesOperationV1Wire, evidence); }
    catch { errors.push(`${decisionPath}.operation.destination: unknown existing pure cue`); return; }
    errors.push(...validateReflectionOperation(stamped, {
      allowedWordIds: new Set([evidence.targetWord.wordId, evidence.responseWord.wordId]),
      evidenceItemId: evidence.itemId,
      path: `${decisionPath}.operation`,
    }));
    const enrichedItem: ReflectionItemV6 = {
      ...evidence,
      source: 'production_mistake',
      sourceActionKind: 'production',
      sessionActionId: null,
      occurredAt: null,
      sessionNote: null,
      existingContent: { contrastClusters: [], knownAcceptedAlternates: [] },
      rawResponse: null,
      submittedWord: evidence.responseWord,
      responseKind: 'matched_known_word',
    };
    errors.push(...validateReconcileProductionCuesEvidenceContext(
      stamped,
      enrichedItem,
      `${decisionPath}.operation`,
    ));
  });
  if (seen.size !== expectedItems.size || [...expectedItems.keys()].some((itemId) => !seen.has(itemId))) {
    errors.push('$.itemResults: every promotion input item must appear exactly once and no unknown item is allowed');
  }
  return errors;
}
