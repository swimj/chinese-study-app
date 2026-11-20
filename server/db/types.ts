import type { ContrastCluster, ContrastClusterMember, ContrastPrompt, WordSkillRelevanceState } from '../../src/domain/study-actions.ts';

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
  overlayUpdatedAt: string | null;
};

export type PriorityWordsPayload = {
  words: PriorityWord[];
};

export type ReviewFailureRateDay = {
  dayKey: string;
  completedReviewActionSessions: number;
  failedReviewActionSessions: number;
  compensatedReviewActionSessions: number;
  failureRate: number | null;
  rolling3DayFailureRate: number | null;
  rolling7DayFailureRate: number | null;
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

export type WordSkillStateRow = {
  word_id: string;
  skill_id: StudySkillId;
  enabled: number;
  interval_hours: number;
  last_studied_at: string;
  next_due_at: string | null;
  ease_factor: number;
};

export type WordSkillRelevance = {
  wordId: string;
  skillId: StudySkillId;
  relevanceState: WordSkillRelevanceState;
  updatedAt: string;
  sourceEventId: string | null;
};

export type SeedData = {
  wordIntroductionFixtureIds?: string[];
  words: Word[];
  wordMeanings: WordMeaning[];
  wordStudyAdmissionStates: WordStudyAdmissionState[];
  wordSkillStates: WordSkillState[];
  wordSkillRelevances: WordSkillRelevance[];
  contrastClusters: ContrastCluster[];
  contrastClusterMembers: ContrastClusterMember[];
  contrastPrompts: ContrastPrompt[];
};

export type PriorityWordRow = WordRow & {
  bump_count: number;
  force_top: number;
  priority_tier: number;
  required_for_next_session: number;
  overlay_updated_at: string | null;
};

export const DEFAULT_DAILY_NEW_WORD_LIMIT = 5;
export const INITIAL_REVIEW_EASE_FACTOR = 2.5;
export const INITIAL_CONTEXTUAL_SELECTION_INTERVAL_HOURS = 6;
export const PRIORITY_TIER_TOP = 1;
export const PRIORITY_TIER_REGULAR = 0;
export const REVIEW_PHASE_RECENCY_GUARD_HOURS = 6;
export const REVIEW_SKILL_URGENCY_TIE_EPSILON = 0.000001;

export type {
  ContrastCluster,
  ContrastClusterMember,
  ContrastPrompt,
  WordSkillRelevanceState,
};
