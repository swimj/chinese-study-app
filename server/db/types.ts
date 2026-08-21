import type {
  ContrastCluster,
  ContrastClusterMember,
  ContrastPrompt,
  SessionStudyItemBuckets,
  ProductionAnswerWord,
  StudyActionKind,
  StudyManagementActionKind,
  StudySessionRecord,
  WordSkillRelevanceState,
} from '../../src/domain/study-actions.ts';

export type WordStatus = 'unstudied' | 'learning' | 'review';

export type Word = {
  id: string;
  hanzi: string;
  traditional: string | null;
  pinyin: string;
  meaning: string;
  meanings: string[];
  personalNotes: string;
  examples: string[];
  status: WordStatus;
  priority: number;
  createdAt: string;
  learningStreak: number;
  lastLearningSuccessOn: string | null;
  lastLearningCoveredOn: string | null;
};

export type WordMeaning = {
  id: string;
  wordId: string;
  position: number;
  text: string;
  showOnProductionPrompt: boolean;
  createdAt: string;
  updatedAt: string;
};

export type PriorityWord = {
  word: Word;
  bumpCount: number;
  forceTop: boolean;
  requiredForNextSession: boolean;
  effectivePriority: number;
  effectiveRank: number;
  overlayUpdatedAt: string | null;
};

export type PriorityWordsPayload = {
  unstudiedTotalCount: number;
  words: PriorityWord[];
};

export type ReviewFailureRateDay = {
  dayKey: string;
  completedReviewActionSessions: number;
  failedReviewActionSessions: number;
  failureRate: number | null;
  rolling3DayFailureRate: number | null;
  rolling7DayFailureRate: number | null;
};

export type ContrastClusterContent = ContrastCluster & {
  members: Array<ContrastClusterMember & {
    word: Word;
    productionSuppressed: boolean;
    badProductionPromptReported: boolean;
  }>;
  prompts: ContrastPromptContent[];
};

export type ContrastPromptContent = ContrastPrompt & {
  feedback: {
    flagged: boolean;
    badPromptCount: number;
    latestBadPromptAt: string | null;
    notes: string[];
  };
};

export type ReviewRating = 'forgot' | 'hard' | 'good' | 'easy';
export type ReviewPassRating = 'hard' | 'good' | 'easy';
export type StudySessionProcessingState = StudySessionRecord['processingState'];

export type ReviewAttemptCommitIntent = {
  type: 'commit-review-action-session';
  sessionActionId: string;
  targetWordId: string;
  actionKind: Extract<StudyActionKind, 'recognition' | 'production'>;
  sampledSkillIds: StudySkillId[];
  failureCount: number;
  terminalRating: ReviewPassRating | null;
};

export type WordRow = {
  id: string;
  hanzi: string;
  traditional: string | null;
  pinyin: string;
  meaning: string;
  meanings_json: string;
  personal_notes: string;
  examples_json: string;
  status: WordStatus;
  priority: number;
  created_at: string;
  learning_streak: number;
  last_learning_success_on: string | null;
  last_learning_covered_on: string | null;
};

export type WordMeaningRow = {
  id: string;
  word_id: string;
  position: number;
  text: string;
  show_on_production_prompt: number;
  created_at: string;
  updated_at: string;
};

export type UserWordPriorityRow = {
  word_id: string;
  bump_count: number;
  force_top: number;
  priority_tier: number;
  required_for_next_session: number;
  updated_at: string;
};

export type UserWordPriorityPatch = {
  bumpDelta?: number;
  forceTop?: boolean;
  reset?: boolean;
  requiredForNextSession?: boolean;
};

export type ReviewSessionResultRow = {
  day_key: string;
  completed_count: number;
  failed_count: number;
};

export type StudySessionRow = {
  id: string;
  started_at: string;
  ended_at: string | null;
  processing_state: StudySessionProcessingState;
  processed_at: string | null;
};

export type StudySkillId = 'recognition' | 'production' | 'contextual_selection';
export type WordStudyPhase = 'review';

export type WordStudyAdmissionState = {
  wordId: string;
  studyPhase: WordStudyPhase;
  earliestNextStudyAt: string | null;
};

export type WordSkillState = {
  wordId: string;
  skillId: StudySkillId;
  enabled: boolean;
  intervalHours: number;
  lastStudiedAt: string;
  nextDueAt: string | null;
  easeFactor: number;
};

export type WordStudyAdmissionStateRow = {
  word_id: string;
  study_phase: WordStudyPhase;
  earliest_next_study_at: string | null;
};

export type WordSkillStateRow = {
  word_id: string;
  skill_id: StudySkillId;
  enabled: number;
  interval_hours: number;
  last_studied_at: string;
  next_due_at: string | null;
  ease_factor: number;
};

export type StudyAttemptEventRow = {
  id: string;
  occurred_at: string;
  session_id: string;
  session_action_id: string;
  session_event_sequence: number;
  action_attempt_sequence: number;
  action_kind: StudyActionKind;
  target_word_id: string;
  sampled_skill_ids_json: string;
  response: string | null;
  outcome: StudyAttemptOutcome;
  rating: ReviewRating | null;
  content_ref_json: string | null;
  metadata_json: string;
  projected_at: string | null;
};

export type StudyEventRow = {
  id: string;
  occurred_at: string;
  session_id: string | null;
  session_action_id: string | null;
  session_event_sequence: number | null;
  event_type: StudyEventType;
  target_word_id: string | null;
  action_kind: StudyActionKind | null;
  sampled_skill_ids_json: string;
  content_ref_json: string | null;
  payload_json: string;
  projected_at: string | null;
};

export type WordSkillRelevance = {
  wordId: string;
  skillId: StudySkillId;
  relevanceState: WordSkillRelevanceState;
  updatedAt: string;
  sourceEventId: string | null;
};

export type WordSkillRelevanceRow = {
  word_id: string;
  skill_id: StudySkillId;
  relevance_state: WordSkillRelevanceState;
  updated_at: string;
  source_event_id: string | null;
};

export type ContrastCandidateIntake = {
  id: string;
  createdAt: string;
  targetWordId: string;
  sourceEventId: string | null;
  sourceActionKind: StudyActionKind | null;
  sourceContentRef: StudyContentRef | null;
  candidateText: string | null;
  matchedWordId: string | null;
  note: string;
  status: 'open' | 'accepted' | 'dismissed' | 'resolved';
};

export type ContrastCandidateIntakeRow = {
  id: string;
  created_at: string;
  target_word_id: string;
  source_event_id: string | null;
  source_action_kind: StudyActionKind | null;
  source_content_ref_json: string | null;
  candidate_text: string | null;
  matched_word_id: string | null;
  note: string;
  status: 'open' | 'accepted' | 'dismissed' | 'resolved';
};

export type StudyContentFeedback = {
  id: string;
  createdAt: string;
  targetType: 'generated_prompt' | 'contrast_prompt';
  targetId: string;
  targetWordId: string;
  actionKind: StudyActionKind;
  feedbackType: 'bad_prompt';
  feedbackAction: 'reported' | 'resolved';
  sourceEventId: string | null;
  note: string;
};

export type StudyContentFeedbackRow = {
  id: string;
  created_at: string;
  target_type: 'generated_prompt' | 'contrast_prompt';
  target_id: string;
  target_word_id: string;
  action_kind: StudyActionKind;
  feedback_type: 'bad_prompt';
  feedback_action: 'reported' | 'resolved';
  source_event_id: string | null;
  note: string;
};

export type RecordStudyManagementActionInput = {
  sessionId: string;
  sessionActionId: string;
  targetWordId: string;
  actionKind: Extract<StudyActionKind, 'production' | 'contrast_selection'>;
  sampledSkillIds: StudySkillId[];
  contentRef: StudyContentRef | null;
  managementAction: StudyManagementActionKind;
  note?: string;
};

export type ContrastClusterRow = {
  id: string;
  title: string;
  note: string;
};

export type ContrastClusterMemberRow = {
  cluster_id: string;
  word_id: string;
  nuance_note: string;
  display_order: number | null;
};

export type ContrastPromptRow = {
  id: string;
  cluster_id: string;
  target_word_id: string;
  prompt_text: string;
  explanation: string;
};

export type StudySchedulerStateInvariantViolation = {
  wordId: string;
  skillId: StudySkillId | null;
  problem: string;
};

export type DailyNewWordIntakeRow = {
  day_key: string;
  new_study_count: number;
};

export type SeedData = {
  words: Word[];
  wordMeanings: WordMeaning[];
  wordStudyAdmissionStates: WordStudyAdmissionState[];
  wordSkillStates: WordSkillState[];
  wordSkillRelevances: WordSkillRelevance[];
  contrastClusters: ContrastCluster[];
  contrastClusterMembers: ContrastClusterMember[];
  contrastPrompts: ContrastPrompt[];
};

export type SessionPayload = {
  buckets: SessionStudyItemBuckets;
  productionAnswerWords: ProductionAnswerWord[];
};

export type WordSessionRow = {
  id: string;
  hanzi: string;
  traditional: string | null;
  pinyin: string;
  meaning: string;
  meanings_json: string;
  personal_notes: string;
  examples_json: string;
  status: WordStatus;
  priority: number;
  created_at: string;
  learning_streak: number;
  last_learning_success_on: string | null;
  last_learning_covered_on: string | null;
};

export type ReviewSessionItemWithSkillRow = WordSessionRow & {
  skill_id: StudySkillId;
  skill_enabled: number;
  skill_interval_hours: number;
  skill_last_studied_at: string;
  skill_next_due_at: string | null;
  skill_ease_factor: number;
  earliest_next_study_at: string | null;
  skill_relevance_state: WordSkillRelevanceState | null;
};

export type ReviewSessionItemCandidate = {
  item: SessionStudyItem;
  wordId: string;
  skillId: StudySkillId;
  urgency: number;
  nextDueAt: string | null;
};

export type PriorityWordRow = WordRow & {
  bump_count: number;
  force_top: number;
  priority_tier: number;
  required_for_next_session: number;
  effective_priority: number;
  effective_rank: number;
  overlay_updated_at: string | null;
};

export const DEFAULT_DAILY_NEW_WORD_LIMIT = 10;
export const PRIORITY_BUMP_UNIT = 12248;
export const UNSTUDIED_COUNT_BASELINE = 116000;
export const PRIORITY_MAX_BASELINE = PRIORITY_BUMP_UNIT * 10;
export const INITIAL_REVIEW_EASE_FACTOR = 2.5;
export const INITIAL_CONTEXTUAL_SELECTION_INTERVAL_HOURS = 6;
export const PRIORITY_TIER_TOP = 1;
export const PRIORITY_TIER_REGULAR = 0;
export const PRIORITY_TIER_SUNK = -1;
export const REVIEW_PHASE_RECENCY_GUARD_HOURS = 6;
export const REVIEW_SKILL_URGENCY_TIE_EPSILON = 0.000001;

export type {
  WordMeaning,
  ReviewFailureRateDay,
  ReviewPassRating,
  ReviewRating,
  SessionPayload,
  ContrastCluster,
  ContrastClusterContent,
  ContrastClusterMember,
  ContrastPrompt,
  ContrastPromptContent,
  ContrastCandidateIntake,
  PriorityWord,
  PriorityWordsPayload,
  StudyContentFeedback,
  StudyEvent,
  StudyManagementActionKind,
  StudySchedulerStateInvariantViolation,
  StudySkillId,
  WordSkillRelevance,
  WordSkillRelevanceState,
  WordSkillState,
  WordStudyAdmissionState,
  Word,
  WordStatus,
};
