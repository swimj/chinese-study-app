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

export type WordItem = {
  id: string;
  english: string;
  chinese: string;
  pinyin: string;
  category: string;
  example: string;
};
