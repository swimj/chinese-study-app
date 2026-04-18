export type Word = {
  id: string;
  hanzi: string;
  traditional: string | null;
  pinyin: string;
  meaning: string;
  meanings: string[];
  examples: string[];
  status: 'unstudied' | 'learning' | 'review';
  priority: number;
  createdAt: string;
  learningStreak: number;
  lastLearningSuccessOn: string | null;
  lastLearningCoveredOn: string | null;
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

export type WordItem = {
  id: string;
  english: string;
  chinese: string;
  pinyin: string;
  category: string;
  example: string;
};
