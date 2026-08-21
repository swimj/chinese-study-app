export type Word = {
  id: string;
  hanzi: string;
  traditional: string | null;
  pinyin: string;
  meaning: string;
  meanings: string[];
  personalNotes: string;
  examples: string[];
  status: 'unstudied' | 'learning' | 'review';
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

export type IntakeTriagePriorityWord = PriorityWord & {
  intakeTriage: import('./domain/intake-triage').IntakeTriageAnnotation | null;
};

export type IntakeTriagePriorityWordsResponse = {
  unstudiedTotalCount: number;
  words: IntakeTriagePriorityWord[];
  analysisCandidateCount: number;
};

export type IntakeTriageRunReceipt = {
  runId: string;
  state: 'succeeded';
  includedWordCount: number;
  clientRequestId: string;
  responseId: string | null;
  estimatedCostUsd: number | null;
};

export type ReviewFailureRateDay = {
  dayKey: string;
  completedReviewActionSessions: number;
  failedReviewActionSessions: number;
  failureRate: number | null;
  rolling3DayFailureRate: number | null;
  rolling7DayFailureRate: number | null;
};

export type SessionActiveTimeMetrics = {
  todayActiveDurationMs: number;
  rolling3DayAverageActiveDurationMs: number;
  rolling7DayAverageActiveDurationMs: number;
};

export type ReviewRating = 'forgot' | 'hard' | 'good' | 'easy';
