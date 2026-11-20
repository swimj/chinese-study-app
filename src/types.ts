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

export type PriorityWord = {
  word: Word;
  bumpCount: number;
  forceTop: boolean;
  requiredForNextSession: boolean;
  overlayUpdatedAt: string | null;
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

export type SessionActiveTimeMetrics = {
  todayActiveDurationMs: number;
  rolling3DayAverageActiveDurationMs: number;
  rolling7DayAverageActiveDurationMs: number;
};
