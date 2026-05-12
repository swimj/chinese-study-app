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
};

export type ReviewItem = {
  id: string;
  wordId: string;
  direction: 'forward' | 'reverse';
  intervalHours: number;
  lastReviewedAt: string | null;
  nextDueAt: string | null;
  easeFactor: number;
};

export type ReviewFailureRateDay = {
  dayKey: string;
  completedReviewItemSessions: number;
  failedReviewItemSessions: number;
  failureRate: number | null;
  rolling3DayFailureRate: number | null;
  rolling7DayFailureRate: number | null;
};

export type ProductionMistakeCandidate = {
  id: string;
  targetWordId: string;
  targetHanzi: string;
  attemptedHanzi: string;
  matchedWordId: string | null;
  createdAt: string;
  note: string;
};

export type ReviewRating = 'forgot' | 'hard' | 'good' | 'easy';

export type SessionItemWithWord = {
  reviewItem: ReviewItem;
  word: Word;
};

export type SessionItemBuckets = {
  review: SessionItemWithWord[];
  learning: SessionItemWithWord[];
  unstudied: SessionItemWithWord[];
};
